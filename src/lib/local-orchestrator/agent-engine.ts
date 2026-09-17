import fs from "fs";
import path from "path";
import { localProjectStore } from "./project-store";
import { localFileManager } from "./file-manager";
import { localSandboxManager } from "./sandbox-manager";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { multiModelRouter } from "./multi-model-router";
import { ensureWorkspaceDependencies } from "./dependency-scanner";
import { purgeInvalidStaticHtml } from "./starter-template";
import type { ConversationMessage } from "@/lib/vcaas-types";
import { withDesignSystemPrompt } from "@/lib/design-system-prompt";
import { buildReferenceSiteContext } from "./reference-site";
import { figmaConnector } from "./figma-connector";

const SYSTEM_PROMPT = `You are an expert product designer and full-stack engineer. Build complete web apps using Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, and libSQL/Turso.

## CRITICAL RULES

**OUTPUT FORMAT: You MUST output ONLY file blocks. Do NOT write explanations, plans, or thinking. Start your response IMMEDIATELY with the first file block. No prose before, between, or after code blocks.**

1. Runtime — This is a real full-stack Next.js App Router app. Use Server Components by default. Add 'use client' only to components that need hooks or browser APIs. Use route handlers and server actions for backend behavior, Zod for request validation, and \`@/lib/db\` for durable data. Never expose secret environment variables to client code.

2. Output Format — Each file with markdown heading + code block:
### File: src/app/page.tsx
\`\`\`tsx
import { useState } from 'react';
// code
\`\`\`

The FIRST file block MUST be src/app/page.tsx, followed by src/app/globals.css when styling changes. Include src/app/layout.tsx when metadata changes. Route handlers use src/app/api/<name>/route.ts. Put optional components after required entry files so a token limit can never leave the app disconnected.

3. Dependencies — Installed and ready: next, react, react-dom (v19), @libsql/client, zod, tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, motion, gsap, zustand, recharts, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, react-day-picker, cmdk, next-themes, lodash, and sonner. Prefer these. Also use @/components/ui/button, @/components/ui/card, @/lib/db, and @/lib/utils (cn) — they already exist. Do not import another local UI component unless you output that file.

4. Styling — Use Tailwind utilities and src/app/globals.css for tokens, keyframes, and special effects. NO styled-jsx, CSS modules, or @apply rules. Keep @import "tailwindcss" as the first non-comment rule in globals.css. All CSS properties MUST be inside a selector.

5. Structure — src/app/page.tsx is the main app, src/app/layout.tsx owns product-specific Metadata, src/app/globals.css contains global styles, src/app/api/**/route.ts owns JSON APIs, and reusable sections belong in src/components/*.tsx. The runtime entrypoint and database client already exist; do not output src/main.tsx.

6. Quality — Complete working code with finished copy and working interactions. No placeholders, dead controls, empty hrefs, or TODOs. Use semantic HTML, accessible labels, keyboard focus states, and responsive layouts at mobile/tablet/desktop sizes.

7. Visual craft — Build a subject-specific art direction, strong hierarchy, intentional typography, varied section rhythm, restrained motion, and cohesive design tokens. Prefer 4-7 substantial sections over generic card grids. Honor every concrete detail in the user's prompt.

8. Assets — Prefer CSS, inline SVG, and lucide-react for reliable visuals. When reference-site analysis supplies public image URLs and the user asks for a close match, you may use those URLs with useful alt text, fixed aspect-ratio containers, object-fit, and an onError/CSS fallback. Never use the temporary Firecrawl screenshot URL as an app asset. Do not fetch or import external font files; reproduce the hierarchy with the system font stack.

9. DON'T — NO react-dom/client imports. NO require(). NO package.json/vite.config/tsconfig/postcss/src/main output. NO secrets or database calls in client components. NO explanatory text — ONLY code files. **NEVER output standalone HTML files like index.html** — always build inside the App Router. **NEVER copy JSX such as \`{children}\` into an HTML file.**
`;

const RETRY_PROMPT = `Your previous response did not contain valid code files. You MUST respond with ONLY code file blocks in this exact format — no explanations, no thinking, no plans:

### File: src/app/page.tsx
\`\`\`tsx
// complete code here
\`\`\`

Start your response with a COMPLETE src/app/page.tsx file, then src/app/globals.css, then any supporting files. The page must import and render its supporting components. Generate the complete application now.`;

const SNAPSHOT_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);

type SharedAgentRunState = {
  runs: Map<string, Promise<void>>;
};

const agentRunStateKey = Symbol.for("bigbag.local-orchestrator.agent-runs");
const agentGlobalState = globalThis as typeof globalThis & {
  [agentRunStateKey]?: SharedAgentRunState;
};
const sharedAgentRunState = agentGlobalState[agentRunStateKey] || {
  runs: new Map<string, Promise<void>>(),
};
agentGlobalState[agentRunStateKey] = sharedAgentRunState;

function snapshotWorkspace(projectId: string): Map<string, Buffer> {
  const root = localProjectStore.getWorkspaceDir(projectId);
  const snapshot = new Map<string, Buffer>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SNAPSHOT_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) snapshot.set(path.relative(root, fullPath), fs.readFileSync(fullPath));
    }
  };
  walk(root);
  return snapshot;
}

function restoreWorkspace(projectId: string, snapshot: Map<string, Buffer>): void {
  const root = localProjectStore.getWorkspaceDir(projectId);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SNAPSHOT_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
  for (const [relativePath, content] of snapshot) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

function workspaceRepairContext(projectId: string): string {
  const sourceExtensions = /\.(?:tsx?|jsx?|css)$/;
  const entries = localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file" && sourceExtensions.test(entry.path));
  let remaining = 40_000;
  const chunks: string[] = [];
  for (const entry of entries) {
    if (remaining <= 0) break;
    const file = localFileManager.getContent(projectId, entry.path);
    if (!file || file.encoding !== "utf8") continue;
    const content = file.content.slice(0, remaining);
    remaining -= content.length;
    chunks.push(`### File: ${entry.path}\n\`\`\`\n${content}\n\`\`\``);
  }
  return chunks.join("\n\n");
}


function extractFilesFromMarkdown(text: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  // Pattern 1: Any markdown heading or line declaring a file path
  // Matches:
  // ### File: src/app/page.tsx
  // ### src/app/page.tsx
  // ## File: src/app/page.tsx
  // **File: src/app/page.tsx**
  // File: src/app/page.tsx
  // followed by a code block, whether closed by ``` or unclosed at the end of string
  const fileHeaderRegex = /(?:^|[\r\n])\s*(?:#{1,4}\s*(?:File:\s*)?|\*{1,2}File:\s*\*?\*?|File:\s*)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*[\r\n]+\s*```[a-zA-Z0-9_-]*\s*[\r\n]/gi;

  const matches: Array<{ path: string; contentStart: number; matchIndex: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = fileHeaderRegex.exec(text)) !== null) {
    matches.push({
      path: m[1].trim(),
      contentStart: m.index + m[0].length,
      matchIndex: m.index,
    });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextMatch = matches[i + 1];
      const rawChunk = nextMatch
        ? text.slice(current.contentStart, nextMatch.matchIndex)
        : text.slice(current.contentStart);

      let content = rawChunk;
      const closingFence = content.lastIndexOf("```");
      if (closingFence !== -1) {
        content = content.slice(0, closingFence);
      }
      content = content.trim();

      if (content.length > 0) {
        files.push({
          path: current.path,
          content,
        });
      }
    }
  }

  // Pattern 2: ```tsx file="src/app/page.tsx" or ```tsx path="src/app/page.tsx"
  if (files.length === 0) {
    const p2 = /```[a-zA-Z0-9_-]*\s+(?:file|path)=["']?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)["']?\s*[\r\n]([\s\S]*?)(?:```|$)/gi;
    while ((m = p2.exec(text)) !== null) {
      const content = m[2].trim();
      if (content.length > 0) {
        files.push({ path: m[1].trim(), content });
      }
    }
  }

  // Pattern 3: First line comment // src/app/page.tsx or // File: src/app/page.tsx
  if (files.length === 0) {
    const p3 = /```(?:tsx|ts|jsx|js|css|html)\s*[\r\n]\/\/\s*(?:File:\s*)?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*[\r\n]([\s\S]*?)(?:```|$)/gi;
    while ((m = p3.exec(text)) !== null) {
      const content = m[2].trim();
      if (content.length > 0) {
        files.push({ path: m[1].trim(), content });
      }
    }
  }

  // Pattern 4: Single raw TSX/JSX code fence without file annotations.
  // Raw HTML is intentionally rejected: the generated app always enters through
  // src/app/page.tsx and the runtime owns the root index.html document.
  if (files.length === 0) {
    const rawFence = /```(?:tsx|ts|jsx|js|javascript|typescript)?\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(text);
    const candidateCode = rawFence ? rawFence[1].trim() : text.trim();
    if (
      candidateCode.includes("export default") ||
      candidateCode.includes("return (") ||
      candidateCode.includes("function")
    ) {
      let code = candidateCode;
      if (!code.includes("export default") && code.includes("function")) {
        const funcMatch = /function\s+([a-zA-Z0-9_$]+)/.exec(code);
        if (funcMatch) {
          code += `\nexport default ${funcMatch[1]};`;
        }
      }
      files.push({
        path: "src/app/page.tsx",
        content: code,
      });
    }
  }

  return files;
}

function hasRequiredEntrypoint(files: Array<{ path: string; content: string }>): boolean {
  return files.some((file) => file.path.replace(/^\.\//, "") === "src/app/page.tsx");
}

function hasGenerationPlaceholder(files: Array<{ path: string; content: string }>): boolean {
  return files.some(
    (file) =>
      file.content.includes("Generation Issue") &&
      file.content.includes("Awaiting Retry")
  );
}

function assertUsableGeneratedFiles(
  files: Array<{ path: string; content: string }>,
  phase: "generation" | "repair"
): void {
  if (files.length === 0) {
    throw new Error(`The AI ${phase} returned no valid source files`);
  }
  if (!hasRequiredEntrypoint(files)) {
    throw new Error(`The AI ${phase} omitted the required src/app/page.tsx entrypoint`);
  }
  if (hasGenerationPlaceholder(files)) {
    throw new Error(`The AI ${phase} still contained placeholder source files`);
  }
}

function mergeGeneratedFiles(
  original: Array<{ path: string; content: string }>,
  retry: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  const merged = new Map(original.map((file) => [file.path.replace(/^\.\//, ""), file]));
  for (const file of retry) merged.set(file.path.replace(/^\.\//, ""), file);
  return [...merged.values()];
}

function fixCssImportOrder(css: string): string {
  const lines = css.split("\n");
  const urlImports: string[] = [];
  const tailwindImport: string[] = [];
  const rest: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@import url(")) {
      urlImports.push(line);
    } else if (trimmed.startsWith('@import "tailwindcss"') || trimmed.startsWith("@import 'tailwindcss'")) {
      tailwindImport.push(line);
    } else {
      rest.push(line);
    }
  }

  if (urlImports.length === 0 || tailwindImport.length === 0) {
    return css;
  }

  return [...urlImports, ...tailwindImport, ...rest].join("\n");
}

/**
 * Fix AI-generated CSS that has properties floating outside any selector.
 * Tailwind 4 / PostCSS will reject these with a parse error.
 * Wraps any orphaned property lines in a `body {}` block.
 */
function sanitizeOrphanedCssProperties(css: string): string {
  const lines = css.split("\n");
  const result: string[] = [];
  const orphans: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes("{")) depth += (trimmed.match(/{/g) || []).length;
    if (trimmed.includes("}")) depth -= (trimmed.match(/}/g) || []).length;

    if (
      depth === 0 &&
      trimmed.length > 0 &&
      !trimmed.startsWith("@") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith(":") &&
      !trimmed.startsWith(".") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("[") &&
      !trimmed.includes("{") &&
      !trimmed.includes("}") &&
      trimmed.includes(":") &&
      trimmed.endsWith(";")
    ) {
      orphans.push(line);
    } else {
      result.push(line);
    }
  }

  if (orphans.length > 0) {
    console.log(`[localAgentEngine] Wrapped ${orphans.length} orphaned CSS properties in body {}`);
    result.push("body {");
    result.push(...orphans.map(l => "  " + l.trim()));
    result.push("}");
  }

  return result.join("\n");
}

/**
 * Post-process AI-generated files to fix common issues that cause runtime crashes.
 * This is a safety net — the system prompt should prevent these, but the AI
 * sometimes ignores instructions.
 */
function postProcessGeneratedFiles(files: Array<{ path: string; content: string }>): void {
  // Generated output must never replace the Vite runtime document. This also
  // drops JSX fragments that a model incorrectly labels as HTML.
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file.path.endsWith(".html")) {
      console.log(`[localAgentEngine] Dropped generated HTML file: ${file.path}`);
      files.splice(i, 1);
    }
  }

  const REACT_HOOK_PATTERN = /\b(useState|useEffect|useRef|useCallback|useMemo|useReducer|useContext|useLayoutEffect|useImperativeHandle|useDebugValue|useDeferredValue|useTransition|useId|useSyncExternalStore)\b/;
  const BROWSER_API_PATTERN = /\b(window\.|document\.|localStorage\.|sessionStorage\.|navigator\.)\b/;

  for (const file of files) {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) continue;

    let content = file.content;

    // Reject files that are clearly not code (AI "thinking" dumped as code)
    const looksLikeCode =
      content.includes("import ") ||
      content.includes("export ") ||
      content.includes("function ") ||
      content.includes("const ") ||
      content.includes("return (") ||
      content.includes("React") ||
      content.includes("<div") ||
      content.includes("<main");

    if (!looksLikeCode) {
      console.warn(`[localAgentEngine] Rejected non-code content in ${file.path} — replacing with placeholder`);
      content = `'use client';

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-gray-950 via-gray-900 to-black text-white">
      <div className="max-w-md p-8 bg-gray-900/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-800">
        <h1 className="text-xl font-semibold tracking-tight text-white mb-2">Generation Issue</h1>
        <p className="text-sm text-gray-400 mb-4">The AI produced text instead of code. Please try again with your prompt.</p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          Awaiting Retry
        </div>
      </div>
    </main>
  );
}
`;
    }

    // Skip layout files — they should be Server Components
    if (file.path.includes("layout.tsx") || file.path.includes("layout.jsx")) {
      file.content = content;
      continue;
    }

    // Remove react-dom/client imports (never needed in Next.js App Router)
    content = content.replace(/^\s*import\s+.*from\s+['"]react-dom\/client['"];?\s*$/gm, "");

    // Remove styled-jsx <style jsx> blocks
    content = content.replace(/<style\s+jsx[^>]*>[\s\S]*?<\/style>/gi, "");

    // Auto-inject 'use client' if hooks or browser APIs are used
    const needsUseClient =
      REACT_HOOK_PATTERN.test(content) ||
      BROWSER_API_PATTERN.test(content);

    const hasUseClient =
      content.trimStart().startsWith("'use client'") ||
      content.trimStart().startsWith('"use client"');

    if (needsUseClient && !hasUseClient) {
      content = "'use client';\n" + content;
      console.log(`[localAgentEngine] Auto-injected 'use client' into ${file.path}`);
    }

    file.content = content;
  }
}

export const localAgentEngine = {
  async runPrompt(projectId: string, prompt: string): Promise<void> {
    const record = localProjectStore.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);

    const now = new Date().toISOString();

    // 1. Add user message
    const userMsg: ConversationMessage = {
      author: "user",
      message: prompt,
      messageType: "regular",
      createdAt: now,
    };

    const startMsg: ConversationMessage = {
      author: "agent",
      message: `Starting AI Composer...`,
      messageType: "starting",
      createdAt: new Date().toISOString(),
    };

    const conversation = [...(record.conversation || []), userMsg, startMsg];
    localProjectStore.update(projectId, {
      status: "init",
      conversation,
    });

    // Serialize detached generations per project. Each queued run snapshots the
    // workspace only when it actually starts, so a failed older request can
    // never restore stale files over a newer request.
    const previousRun = sharedAgentRunState.runs.get(projectId) || Promise.resolve();
    const run = previousRun.catch(() => undefined).then(async () => {
      let previousWorkspace: Map<string, Buffer> | null = null;

      try {
        // Keep template and snapshot I/O inside the guarded path so a filesystem
        // failure is reported instead of leaving the project stuck in `init`.
        // The preview starts only after generated code passes a real compile.
        localSandboxManager.ensureProjectTemplate(projectId);
        previousWorkspace = snapshotWorkspace(projectId);

        const providers = multiModelRouter.getProviders();
        if (providers.length === 0) {
          let starterPreview: string | undefined;
          try {
            starterPreview = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
          } catch (error) {
            console.error("[localAgentEngine] Starter preview failed:", error);
          }
          const warnMsg: ConversationMessage = {
            author: "agent",
            message: starterPreview
              ? "⚠️ No AI API keys found in `.env.local`.\n\nPlease add your API keys to `.env.local` to enable full autonomous code generation. In the meantime, the starter template is running in the live preview."
              : "No AI API keys are configured, and the starter preview could not be started. Add an AI provider key to `.env.local`, verify the sandbox configuration, and retry.",
            messageType: starterPreview ? "finished" : "error",
            createdAt: new Date().toISOString(),
          };
          const currentConversation =
            localProjectStore.getRecord(projectId)?.conversation || conversation;
          localProjectStore.update(projectId, {
            status: "done",
            conversation: [...currentConversation, warnMsg],
            previewUrl: starterPreview,
            serverStatus: starterPreview ? "Active" : "Error",
          });
          return;
        }

        // Include existing code context if iterating on an existing project
        let userPromptContent = prompt;
        const existingPage = localFileManager.getContent(projectId, "src/app/page.tsx");
        const existingStyles = localFileManager.getContent(projectId, "src/app/globals.css");
        const pageCode = existingPage?.content || "";
        if (
          pageCode &&
          !pageCode.includes("AI is assembling your application") &&
          !pageCode.includes("Ready for Prompt") &&
          !pageCode.includes("Generation Issue")
        ) {
          const truncatedCode = pageCode.length > 10_000 ? pageCode.substring(0, 10_000) + "\n... (truncated)" : pageCode;
          const styles = existingStyles?.content
            ? existingStyles.content.slice(0, 5_000)
            : "";
          userPromptContent = `Current page:\n\`\`\`tsx\n${truncatedCode}\n\`\`\`\n\nCurrent global styles:\n\`\`\`css\n${styles}\n\`\`\`\n\nUser Request: ${prompt}\n\nUpdate the application completely enough to fulfill this request while preserving working features.`;
        }

        const appendStatus = (message: string) => {
          const current = localProjectStore.getRecord(projectId);
          const statusMessage: ConversationMessage = {
            author: "agent",
            message,
            messageType: "building",
            createdAt: new Date().toISOString(),
          };
          localProjectStore.update(projectId, {
            conversation: [...(current?.conversation || []), statusMessage],
          });
        };
        const referenceContext = await buildReferenceSiteContext(prompt, appendStatus);
        if (referenceContext) {
          userPromptContent = `${userPromptContent}\n\n${referenceContext}`;
        }
        const figmaContext = await figmaConnector.contextForPrompt(projectId, prompt);
        if (figmaContext) {
          appendStatus("Reading the connected Figma design system…");
          userPromptContent = `${userPromptContent}\n\n${figmaContext}`;
        }

        // MotionSites-style prompts carry precise layout, motion and art direction.
        // Keep them intact and apply our quality constraints at the model boundary,
        // not to the conversation stored and shown to the user.
        userPromptContent = withDesignSystemPrompt(userPromptContent);

        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPromptContent },
        ];

        const routerResult = await multiModelRouter.complete(messages, (statusMsg) => {
          const currentRec = localProjectStore.getRecord(projectId);
          const switchMsg: ConversationMessage = {
            author: "agent",
            message: statusMsg,
            messageType: "building",
            createdAt: new Date().toISOString(),
          };
          localProjectStore.update(projectId, {
            conversation: [...(currentRec?.conversation || []), switchMsg],
          });
        });

        const content = routerResult.text;
        const usedModel = routerResult.usedModel;

        // Extract files from generated markdown, with auto-retry on failure
        let files = extractFilesFromMarkdown(content);
        postProcessGeneratedFiles(files);

        // Check if any file is a placeholder (non-code detected)
        const hasPlaceholder = hasGenerationPlaceholder(files);

        // Auto-retry if no files extracted or all files are placeholders
        if (files.length === 0 || hasPlaceholder || !hasRequiredEntrypoint(files)) {
          console.log(`[localAgentEngine] Generation was incomplete, auto-retrying...`);

          const retryStatusMsg: ConversationMessage = {
            author: "agent",
            message: "Retrying generation with stricter instructions...",
            messageType: "building",
            createdAt: new Date().toISOString(),
          };
          const currentRecRetry = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [...(currentRecRetry?.conversation || []), retryStatusMsg],
          });

          const retryMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPromptContent },
            { role: "assistant", content: content.substring(0, 500) },
            { role: "user", content: RETRY_PROMPT },
          ];

          try {
            const retryResult = await multiModelRouter.complete(retryMessages, () => {});
            const retryFiles = extractFilesFromMarkdown(retryResult.text);
            postProcessGeneratedFiles(retryFiles);

            const retryHasPlaceholder = hasGenerationPlaceholder(retryFiles);

            if (retryFiles.length > 0 && !retryHasPlaceholder) {
              files = mergeGeneratedFiles(files, retryFiles);
              postProcessGeneratedFiles(files);
              console.log(`[localAgentEngine] Retry succeeded: ${retryFiles.length} files extracted`);
            } else {
              console.warn(`[localAgentEngine] Retry also failed, using placeholder`);
            }
          } catch (retryErr: any) {
            console.error(`[localAgentEngine] Retry failed:`, retryErr.message || retryErr);
          }
        }

        assertUsableGeneratedFiles(files, "generation");

        const currentRec = localProjectStore.getRecord(projectId);
        const newMessages: ConversationMessage[] = [...(currentRec?.conversation || [])];

        for (const file of files) {
          let fileContent = file.content;

          if (file.path.endsWith(".css")) {
            fileContent = sanitizeOrphanedCssProperties(fileContent);
          }

          if (file.path.endsWith("globals.css") || file.path.endsWith("global.css")) {
            fileContent = fixCssImportOrder(fileContent);
          }

          localFileManager.writeContent(projectId, file.path, fileContent, "utf8");
          console.log(`[localAgentEngine] Wrote ${file.path} (${fileContent.length} bytes)`);

          newMessages.push({
            author: "agent",
            message: `Created file \`${file.path}\``,
            messageType: "building",
            createdAt: new Date().toISOString(),
          });
        }

        purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));

        // Add detected dependencies to this generated app. Installation happens
        // inside its sandbox, never in the platform's own production process.
        const allFiles = files.length > 0 ? files : [];
        const existingPageForDeps = localFileManager.getContent(projectId, "src/app/page.tsx");
        if (existingPageForDeps?.content && !allFiles.some(f => f.path.includes("page.tsx"))) {
          allFiles.push({ path: "src/app/page.tsx", content: existingPageForDeps.content });
        }
        if (allFiles.length > 0) {
          try {
            const depResult = ensureWorkspaceDependencies(
              allFiles,
              localProjectStore.getWorkspaceDir(projectId)
            );
            if (depResult.added.length > 0) {
              newMessages.push({
                author: "agent",
                message: `Added dependencies: ${depResult.added.join(", ")}`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
          } catch (depErr: any) {
            console.error("[localAgentEngine] Dependency auto-install error:", depErr);
          }
        }

        newMessages.push({
          author: "agent",
          message: "Validating the generated app and preparing its live preview...",
          messageType: "building",
          createdAt: new Date().toISOString(),
        });

        // Compile before success is shown. This is the reliability boundary that
        // prevents a model response from becoming a broken user-facing preview.
        try {
          const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
          console.log(`[localAgentEngine] Sandbox confirmed ready for ${projectId}, preview: ${previewUrl}`);

          newMessages.push({
            author: "agent",
            message: `Application generated successfully with ${usedModel}! Generated ${files.length || 1} files and verified the live preview.`,
            messageType: "finished",
            createdAt: new Date().toISOString(),
          });
          localProjectStore.update(projectId, {
            status: "done",
            conversation: newMessages,
            previewUrl: previewUrl.includes("http") ? previewUrl : `/api/preview/${projectId}`,
            serverStatus: "Active",
          });
        } catch (sandboxErr) {
          console.error(`[localAgentEngine] Sandbox startup failed:`, sandboxErr);
          const buildError = sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr);
          newMessages.push({
            author: "agent",
            message: "Preview validation found a build issue. Repairing the generated code automatically...",
            messageType: "building",
            createdAt: new Date().toISOString(),
          });
          localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });

          try {
            const repairResult = await multiModelRouter.complete(
              [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: `The generated app for this request failed its production build. Fix the implementation without weakening the requested design or removing working features. Return ONLY complete corrected file blocks. Never use @apply in CSS.\n\nOriginal request:\n${prompt}\n\nBuild error:\n${buildError}\n\nCurrent source:\n${workspaceRepairContext(projectId)}`,
                },
              ],
              () => undefined
            );
            const repairFiles = extractFilesFromMarkdown(repairResult.text);
            postProcessGeneratedFiles(repairFiles);
            assertUsableGeneratedFiles(repairFiles, "repair");

            for (const file of repairFiles) {
              let fileContent = file.content;
              if (file.path.endsWith(".css")) fileContent = sanitizeOrphanedCssProperties(fileContent);
              if (file.path.endsWith("globals.css") || file.path.endsWith("global.css")) {
                fileContent = fixCssImportOrder(fileContent);
              }
              localFileManager.writeContent(projectId, file.path, fileContent, "utf8");
            }
            purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
            ensureWorkspaceDependencies(repairFiles, localProjectStore.getWorkspaceDir(projectId));

            const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
            newMessages.push({
              author: "agent",
              message: `Application generated, automatically repaired, and verified in the live preview using ${repairResult.usedModel}.`,
              messageType: "finished",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, {
              status: "done",
              conversation: newMessages,
              previewUrl,
              serverStatus: "Active",
            });
          } catch (repairError) {
            console.error(`[localAgentEngine] Automatic repair failed:`, repairError);
            if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);

            let restoredPreviewUrl: string | undefined;
            try {
              restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
            } catch (restoreError) {
              console.error(`[localAgentEngine] Previous preview restore failed:`, restoreError);
            }

            newMessages.push({
              author: "agent",
              message: restoredPreviewUrl
                ? "The requested change could not be compiled safely, so the previous working version was restored. Please retry or adjust the prompt."
                : `Generation failed validation and the preview could not be restored: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
              messageType: "error",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, {
              status: "done",
              conversation: newMessages,
              previewUrl: restoredPreviewUrl,
              serverStatus: restoredPreviewUrl ? "Active" : "Error",
            });
          }
        }
      } catch (err: any) {
        console.error("[localAgentEngine error]", err);
        if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
        let restoredPreviewUrl: string | undefined;
        try {
          restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
        } catch (restoreError) {
          console.error("[localAgentEngine] Could not restore previous preview:", restoreError);
        }
        const current = localProjectStore.getRecord(projectId);
        const errorMsg: ConversationMessage = {
          author: "agent",
          message: `Generation encountered an issue: ${err.message || String(err)}`,
          messageType: "error",
          createdAt: new Date().toISOString(),
        };
        localProjectStore.update(projectId, {
          status: "done",
          conversation: [...(current?.conversation || []), errorMsg],
          previewUrl: restoredPreviewUrl,
          serverStatus: restoredPreviewUrl ? "Active" : "Error",
        });
      }
    });

    sharedAgentRunState.runs.set(projectId, run);
    const clearRun = () => {
      if (sharedAgentRunState.runs.get(projectId) === run) {
        sharedAgentRunState.runs.delete(projectId);
      }
    };
    void run.then(clearRun, clearRun);
  },
};

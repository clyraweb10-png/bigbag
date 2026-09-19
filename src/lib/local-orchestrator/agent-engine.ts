import fs from "fs";
import path from "path";
import { localProjectStore } from "./project-store";
import { localFileManager } from "./file-manager";
import { localSandboxManager } from "./sandbox-manager";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { multiModelRouter } from "./multi-model-router";
import { ensureWorkspaceDependencies } from "./dependency-scanner";
import { purgeInvalidStaticHtml } from "./starter-template";
import type { ConversationMessage } from "../vcaas-types";
import { withDesignSystemPrompt } from "../design-system-prompt";
import { analyzeWebsiteDesign, extractWebsiteUrl } from "./firecrawl-design";
import {
  containsGenerationPlaceholder,
  generationValidationIssues,
  isRuntimeOwnedGeneratedPath,
  normalizeGeneratedPath,
  type GeneratedSourceFile,
} from "./generation-validator";

const SYSTEM_PROMPT = `You are an expert product designer and frontend engineer. Build complete web apps using Vite, React 19, TypeScript, and Tailwind CSS 4.

## CRITICAL RULES

**OUTPUT FORMAT: You MUST output ONLY file blocks. Do NOT write explanations, plans, or thinking. Start your response IMMEDIATELY with the first file block. No prose before, between, or after code blocks.**

1. Runtime — This is a Vite React client backed by platform server APIs, even though its editable entry file is named src/app/page.tsx. Components may use hooks and browser APIs. Never use Next.js APIs, Server Components, server actions, Node built-ins, or direct database/provider SDKs in browser code. For persistent records, use ONLY this exact browser-safe database API: \`import db from "@/lib/db"; const items = db.collection("items"); const { records } = await items.list(); await items.create(data); await items.update(record._id, data); await items.remove(record._id);\`. The only collection methods are \`list\`, \`get\`, \`create\`, \`update\`, and \`remove\`. Never invent \`db.list\`, \`db.putMany\`, \`db.query\`, or another API. When the user asks for durable/full-stack data, the platform database is authoritative; do not silently substitute localStorage or in-memory state for failed writes.

2. Output Format — Each file with markdown heading + code block:
### File: src/app/page.tsx
\`\`\`tsx
import { useState } from 'react';
// code
\`\`\`

The FIRST file block MUST be src/app/page.tsx, followed by src/app/globals.css when styling changes. Keep the complete implementation self-contained in src/app/page.tsx by default. Do not import a custom local component unless you also output its complete file in the same response. Put optional components after those required entry files so a token limit can never leave the app disconnected. The runtime already owns index.html, src/main.tsx, src/app/layout.tsx, package.json, and build configuration. Never output or replace them.

3. Dependencies — Installed and ready: react, react-dom (v19), tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, gsap, zustand, recharts, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, sonner. Prefer these. Also use @/components/ui/button, @/components/ui/card, @/lib/utils (cn), and @/lib/db (durable CRUD) — they already exist.

4. Styling — Use Tailwind utilities and src/app/globals.css for tokens, keyframes, and special effects. NO styled-jsx, CSS modules, or @apply rules. Keep @import "tailwindcss" as the first non-comment rule in globals.css. All CSS properties MUST be inside a selector.

5. Structure — src/app/page.tsx is the main app and src/app/globals.css contains global styles. Prefer small helper components in page.tsx so the response cannot be truncated between files. Use src/components/*.tsx only when the complete page and every imported component fit in this response. The runtime entrypoint already exists; do not output src/main.tsx.

6. Quality — Complete working code with finished copy and working interactions. No placeholders, dead controls, empty hrefs, TODOs, fake save buttons, or in-memory-only persistence when the request needs data. Use semantic HTML, accessible labels, keyboard focus states, loading/empty/error states, and responsive layouts at mobile/tablet/desktop sizes. If the user requests multiple pages, implement every named page as working client-side routes/views with real navigation and URL history; do not return one long landing page or create Next.js route files that this Vite runtime will not mount.

7. Visual craft — Build a subject-specific art direction, strong hierarchy, intentional typography, varied section rhythm, restrained motion, and cohesive design tokens. Prefer 4-7 substantial sections over generic card grids when the request is a site; use information-dense task layouts when it is an app. Honor every concrete detail in the user's prompt. Explicit user constraints outrank all default design guidance: never add sections, effects, colours, copy, or features the user excluded.

8. Images and icons — Use user-supplied and reference-analysis image URLs exactly when relevant and licensing permits, preserving meaningful alt text. When the brief benefits from photography and supplies no asset, use a stable, direct, known-valid royalty-free image URL rather than substituting a generic CSS/SVG geometric illustration; never use dynamic random-image endpoints or pretend a decorative mockup is a real product screenshot. Use lucide-react icons with accessible labels; never use emoji or text glyphs as UI icons.

9. Build efficiency — Prefer lightweight CSS and responsive inline SVG for decorative data visualizations. Import a charting library only when the user explicitly requires that library or the requested interaction cannot reasonably be built with SVG; large chart bundles can exhaust small preview workers.

10. DON'T — NO react-dom/client imports. NO require(). NO next/* imports. NO Node built-ins. NO direct use of process.env or secret keys in client files. NO package.json/vite.config/tsconfig/postcss/src/main output. NO layout.tsx. NO explanatory text — ONLY code files. **NEVER output standalone HTML files like index.html** — always build inside src/app/page.tsx. **NEVER copy JSX such as \`{children}\` into an HTML file.**
`;

const RETRY_PROMPT = `Your previous response did not contain valid code files. You MUST respond with ONLY code file blocks in this exact format — no explanations, no thinking, no plans:

### File: src/app/page.tsx
\`\`\`tsx
// complete code here
\`\`\`

Return one complete, self-contained src/app/page.tsx with all requested views and custom sections defined in that file. You may import installed packages and the existing @/components/ui/button, @/components/ui/card, and @/lib/utils modules, but do not import any other local component. Then output src/app/globals.css if needed. Do not output runtime-owned files such as src/app/layout.tsx, src/main.tsx, index.html, package.json, or build configuration. Do not abbreviate code with ellipses. Generate the complete application now.`;

/**
 * Appended to the system prompt when the user is iterating on an existing project.
 * Without this, the design-system prompt's strong push toward "build a unique website"
 * causes the AI to ignore the existing code and generate something entirely new.
 */
const FOLLOW_UP_SUFFIX = `

## FOLLOW-UP MODE — YOU ARE MODIFYING AN EXISTING APPLICATION

The user's current project files are provided below. This is NOT a new project.
You MUST:
1. Read and understand the existing code before making changes.
2. ONLY change what the user explicitly asked for.
3. Keep ALL existing functionality, structure, design, content, and styling intact.
4. Output the COMPLETE updated file(s) — not just the changed lines.
5. If the user asks for a small change (like changing a color), make ONLY that change.
6. Do NOT redesign, restructure, or replace the existing application.
7. Do NOT add new sections, features, or content unless explicitly asked.
`;

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


export function extractFilesFromMarkdown(text: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  // Pattern 1: Any markdown heading or line declaring a file path
  // Matches:
  // ### File: src/app/page.tsx
  // ### src/app/page.tsx
  // ## File: src/app/page.tsx
  // **File: src/app/page.tsx**
  // File: src/app/page.tsx
  // followed by a code block, whether closed by ``` or unclosed at the end of string
  const fileHeaderRegex = /(?:^|[\r\n])\s*(?:#{1,4}\s*(?:File:\s*)?|\*{1,2}File:\s*\*?\*?|File:\s*)\s*`?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`?\s*[\r\n]+\s*```[a-zA-Z0-9_-]*\s*[\r\n]/gi;

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

  // Pattern 2: file metadata carried on the opening code fence.
  if (files.length === 0) {
    const metadataFences = [
      /```[a-zA-Z0-9_-]*\s+(?:file|path|title)=["']?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)["']?\s*[\r\n]([\s\S]*?)(?:```|$)/gi,
      /```[a-zA-Z0-9_-]*:([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*[\r\n]([\s\S]*?)(?:```|$)/gi,
    ];
    for (const pattern of metadataFences) {
      while ((m = pattern.exec(text)) !== null) {
        const content = m[2].trim();
        if (content.length > 0) files.push({ path: m[1].trim(), content });
      }
      if (files.length > 0) break;
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

  // Pattern 4: common coding-agent XML file actions.
  if (files.length === 0) {
    const xmlFile = /<(?:boltAction|file)\b[^>]*(?:filePath|path)=["']([a-zA-Z0-9_\-\.\/\[\]]+\.[a-zA-Z0-9]+)["'][^>]*>([\s\S]*?)<\/(?:boltAction|file)>/gi;
    while ((m = xmlFile.exec(text)) !== null) {
      const content = m[2].trim().replace(/^```[a-zA-Z0-9_-]*\s*[\r\n]/, "").replace(/[\r\n]\s*```$/, "").trim();
      if (content.length > 0) files.push({ path: m[1].trim(), content });
    }
  }

  // Pattern 5: structured JSON responses such as
  // {"files":[{"path":"src/app/page.tsx","content":"..."}]}.
  if (files.length === 0) {
    const fencedJson = /```json\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(text)?.[1];
    const candidate = (fencedJson || text).trim();
    const jsonStart = Math.min(
      ...[candidate.indexOf("{"), candidate.indexOf("[")].filter((index) => index >= 0)
    );
    const jsonEnd = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (Number.isFinite(jsonStart) && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
        const entries = Array.isArray(parsed) ? parsed : parsed?.files;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const filePath = entry?.path || entry?.file || entry?.filePath;
            const content = entry?.content || entry?.code;
            if (typeof filePath === "string" && typeof content === "string" && content.trim()) {
              files.push({ path: filePath.trim(), content: content.trim() });
            }
          }
        }
      } catch {
        // A malformed JSON-looking response may still be a raw code fence below.
      }
    }
  }

  // Pattern 6: Single raw TSX/JSX code fence without file annotations.
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

function assertUsableGeneratedFiles(
  files: GeneratedSourceFile[],
  phase: "generation" | "repair",
  existingPaths: Iterable<string>
): void {
  const existing = [...existingPaths];
  const hasExistingEntrypoint = existing
    .map(normalizeGeneratedPath)
    .includes("src/app/page.tsx");
  const issues = generationValidationIssues(files, existing, {
    requireEntrypoint: phase === "generation" || !hasExistingEntrypoint,
  });
  if (issues.length > 0) throw new Error(`The AI ${phase} was incomplete: ${issues.join("; ")}`);
}

function mergeGeneratedFiles(
  original: Array<{ path: string; content: string }>,
  retry: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  const merged = new Map(original.map((file) => [normalizeGeneratedPath(file.path), file]));
  for (const file of retry) merged.set(normalizeGeneratedPath(file.path), file);
  return [...merged.values()];
}

function availableWorkspacePaths(projectId: string): string[] {
  return localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file")
    .filter((entry) => {
      const file = localFileManager.getContent(projectId, entry.path);
      return Boolean(file && file.encoding === "utf8" && !containsGenerationPlaceholder(file.content));
    })
    .map((entry) => normalizeGeneratedPath(entry.path));
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
 * Tailwind 4 rejects `@apply` for semantic utilities that have not been declared
 * through its theme system (the most common generated example is
 * `@apply bg-background text-foreground`). Generated pages already carry their
 * visual utilities in JSX, so dropping these optional convenience declarations
 * is safer than turning an otherwise valid app into a blank preview.
 */
export function stripGeneratedApplyRules(css: string): string {
  const unsupportedSemanticUtility = /\b(?:bg-background|text-foreground|border-border|ring-ring|bg-card|text-card-foreground|bg-popover|text-popover-foreground)\b/;
  return css
    .replace(/^[\t ]*@apply\s+[^;{}]+;[\t ]*$/gm, (declaration) =>
      unsupportedSemanticUtility.test(declaration) ? "" : declaration
    )
    .replace(/@apply\s+[^;{}]+;/g, (declaration) =>
      unsupportedSemanticUtility.test(declaration) ? "" : declaration
    );
}

/**
 * Post-process AI-generated files to fix common issues that cause runtime crashes.
 * This is a safety net — the system prompt should prevent these, but the AI
 * sometimes ignores instructions.
 */
export function postProcessGeneratedFiles(files: Array<{ path: string; content: string }>): void {
  // A useful model response can include a complete page plus an unnecessary
  // runtime file. Drop those runtime-owned extras instead of allowing one
  // disallowed block to poison an otherwise valid generation and its retry.
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (isRuntimeOwnedGeneratedPath(file.path)) {
      console.log(`[localAgentEngine] Dropped runtime-owned generated file: ${file.path}`);
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
      agentStartedAt: now,
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

        // ═══⭐⭐ FOLLOW-UP AWARENESS ══════════════════════════════════════════
        //
        // Detect whether this is a follow-up prompt (existing real source code in
        // the workspace) and, if so, include ALL project source files plus prior
        // conversation history so the AI modifies the existing project instead of
        // generating a brand-new website from scratch.

        let userPromptContent = prompt;
        let isFollowUp = false;

        // Gather ALL source files in the project, not just page.tsx
        const sourceExtensions = /\.(?:tsx?|jsx?|css)$/;
        const allSourceEntries = localFileManager
          .getTree(projectId)
          .entries.filter(
            (e) => e.type === "file" && sourceExtensions.test(e.path)
          );

        // Check if there's real existing code (not a placeholder template)
        const existingPage = localFileManager.getContent(projectId, "src/app/page.tsx");
        const pageCode = existingPage?.content || "";
        const isPlaceholder =
          !pageCode ||
          pageCode.includes("AI is assembling your application") ||
          pageCode.includes("Ready for Prompt") ||
          pageCode.includes("Generation Issue");

        if (!isPlaceholder && allSourceEntries.length > 0) {
          isFollowUp = true;

          // Build source context from ALL project files, not just page.tsx
          let charBudget = 30_000;
          const sourceChunks: string[] = [];
          for (const entry of allSourceEntries) {
            if (charBudget <= 0) break;
            const file = localFileManager.getContent(projectId, entry.path);
            if (!file || file.encoding !== "utf8") continue;
            // Skip placeholder content
            if (containsGenerationPlaceholder(file.content)) continue;
            const content = file.content.slice(0, charBudget);
            charBudget -= content.length;
            sourceChunks.push(`### File: ${entry.path}\n\`\`\`\n${content}\n\`\`\``);
          }

          if (sourceChunks.length > 0) {
            userPromptContent = `Here are the current project files:\n\n${sourceChunks.join("\n\n")}\n\nUser Request: ${prompt}\n\nIMPORTANT: This is a FOLLOW-UP request on an existing project. Modify the existing code to fulfill this request. Preserve ALL existing structure, design, content, and working features. Only change what the user explicitly asked for. Output the complete updated files.`;
          }
        }

        const referenceUrl = extractWebsiteUrl(prompt);
        if (referenceUrl) {
          const current = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [
              ...(current?.conversation || []),
              {
                author: "agent",
                message: "Analyzing the reference website's design with Firecrawl...",
                messageType: "building",
                createdAt: new Date().toISOString(),
              },
            ],
          });
          try {
            const design = await analyzeWebsiteDesign(referenceUrl);
            userPromptContent = `${userPromptContent}\n\n${design.context}`;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Firecrawl] Design analysis failed for ${referenceUrl}: ${message}`);
            const currentAfterFailure = localProjectStore.getRecord(projectId);
            localProjectStore.update(projectId, {
              conversation: [
                ...(currentAfterFailure?.conversation || []),
                {
                  author: "agent",
                  message: "Firecrawl could not analyze that reference, so generation is continuing from your prompt.",
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                },
              ],
            });
          }
        }

        // MotionSites-style prompts carry precise layout, motion and art direction.
        // Keep them intact and apply our quality constraints at the model boundary,
        // not to the conversation stored and shown to the user.
        userPromptContent = withDesignSystemPrompt(userPromptContent);

        // ═══⭐⭐ BUILD CONVERSATION HISTORY FOR THE AI ═════════════════════════
        //
        // Include prior user/agent exchanges so the AI has context about what was
        // previously requested and generated. Without this, every prompt is treated
        // as a brand-new project and the AI generates from scratch.
        const conversationHistory: Array<{ role: string; content: string }> = [];
        if (isFollowUp) {
          const priorConversation = localProjectStore.getRecord(projectId)?.conversation || [];
          for (const msg of priorConversation) {
            // Include previous user prompts (but not the current one — it's in userPromptContent)
            if (msg.author === "user" && msg.message !== prompt) {
              conversationHistory.push({ role: "user", content: msg.message });
            }
            // Include agent "finished" summaries so the AI knows what it produced
            else if (msg.author === "agent" && msg.messageType === "finished") {
              conversationHistory.push({ role: "assistant", content: msg.message });
            }
          }
        }

        const systemPromptForRun = isFollowUp
          ? SYSTEM_PROMPT + FOLLOW_UP_SUFFIX
          : SYSTEM_PROMPT;

        const messages = [
          { role: "system", content: systemPromptForRun },
          ...conversationHistory,
          { role: "user", content: userPromptContent },
        ];

        const routerResult = await multiModelRouter.complete(
          messages,
          (statusMsg) => {
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
          },
          { perProviderTimeoutMs: 120_000, totalTimeoutMs: 240_000 }
        );

        const content = routerResult.text;
        let usedModel = routerResult.usedModel;
        let usedProviderId = routerResult.providerId;

        // Extract files from generated markdown, with auto-retry on failure
        let files = extractFilesFromMarkdown(content);
        postProcessGeneratedFiles(files);

        const existingPaths = availableWorkspacePaths(projectId);
        let validationIssues = generationValidationIssues(files, existingPaths);

        // Auto-retry incomplete or disconnected output before it touches the workspace.
        if (validationIssues.length > 0) {
          console.log(`[localAgentEngine] Generation was incomplete: ${validationIssues.join("; ")}`);

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
            {
              role: "user",
              content: `${RETRY_PROMPT}\n\nThe previous output failed these checks:\n- ${validationIssues.join("\n- ")}`,
            },
          ];

          try {
            const retryResult = await multiModelRouter.complete(retryMessages, () => {}, {
              deprioritizeProviderId: routerResult.providerId,
              perProviderTimeoutMs: 120_000,
              totalTimeoutMs: 210_000,
            });
            const retryFiles = extractFilesFromMarkdown(retryResult.text);
            postProcessGeneratedFiles(retryFiles);
            const mergedFiles = mergeGeneratedFiles(files, retryFiles);
            postProcessGeneratedFiles(mergedFiles);
            validationIssues = generationValidationIssues(mergedFiles, existingPaths);
            if (validationIssues.length > 0) {
              throw new Error(`Retry remained incomplete: ${validationIssues.join("; ")}`);
            }
            files = mergedFiles;
            usedModel = retryResult.usedModel;
            usedProviderId = retryResult.providerId;
            console.log(`[localAgentEngine] Retry succeeded: ${retryFiles.length} files extracted`);
          } catch (retryErr: any) {
            console.error(`[localAgentEngine] Retry failed:`, retryErr.message || retryErr);
          }
        }

        assertUsableGeneratedFiles(files, "generation", existingPaths);

        const currentRec = localProjectStore.getRecord(projectId);
        const newMessages: ConversationMessage[] = [...(currentRec?.conversation || [])];

        for (const file of files) {
          let fileContent = file.content;

          if (file.path.endsWith(".css")) {
            fileContent = sanitizeOrphanedCssProperties(stripGeneratedApplyRules(fileContent));
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
          console.log(`[localAgentEngine] Disposable build passed and persistent preview deployed for ${projectId}`);

          newMessages.push({
            author: "agent",
            message: `Application generated successfully with ${usedModel}! Generated ${files.length || 1} files, verified the disposable build, and deployed the persistent preview.`,
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
              () => undefined,
              {
                deprioritizeProviderId: usedProviderId,
                perProviderTimeoutMs: 120_000,
                totalTimeoutMs: 210_000,
              }
            );
            const repairFiles = extractFilesFromMarkdown(repairResult.text);
            postProcessGeneratedFiles(repairFiles);
            assertUsableGeneratedFiles(repairFiles, "repair", availableWorkspacePaths(projectId));

            for (const file of repairFiles) {
              let fileContent = file.content;
              if (file.path.endsWith(".css")) fileContent = sanitizeOrphanedCssProperties(stripGeneratedApplyRules(fileContent));
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
      void localProjectStore.flush(projectId).catch((error) => {
        console.error(`[localAgentEngine] Final project persistence failed for ${projectId}:`, error);
      });
    };
    void run.then(clearRun, clearRun);
  },
};

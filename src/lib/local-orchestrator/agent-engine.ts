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
import { resolvePexelsImagery } from "./pexels-imagery";
import {
  containsGenerationPlaceholder,
  generationValidationIssues,
  isRuntimeOwnedGeneratedPath,
  normalizeGeneratedPath,
  type GeneratedSourceFile,
} from "./generation-validator";

const SYSTEM_PROMPT = `You are an expert full-stack software engineer and product designer. Build production-quality, modular web applications using React, TypeScript, and modern styling.

## CRITICAL RULES

**OUTPUT FORMAT: You MUST output ONLY file blocks. Do NOT write explanations, conversational filler, plans, or thinking before, between, or after code blocks. Start your response immediately with the first file block.**

1. Architecture & Multi-File Structure
- Build complete, modular, real-world applications with clean separation of concerns.
- Split code across logical files: entry points, components, hooks, utilities, styles, and types.
- Standard structure:
  - Entry point: \`src/App.tsx\` or \`src/app/page.tsx\`
  - Components: \`src/components/<ComponentName>.tsx\`
  - Styles: \`src/index.css\` or \`src/app/globals.css\`
  - Utilities: \`src/lib/utils.ts\`
  - Types: \`src/types/<module>.ts\`
- For multi-view or multi-page flows, create dedicated view components with client-side routing and clean state management.
- When importing a custom local module (e.g. \`import { TaskList } from './components/TaskList'\`), you MUST output the complete code for that file in the same response.

2. Output Format
Each file must be preceded by a clear file header and markdown code fence:
### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

To delete an obsolete file, output:
### Delete: path/to/file.tsx

3. Dependencies & Standard Libraries
- Pre-installed and ready: react, react-dom (v19), tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, gsap, zustand, recharts, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, sonner.
- Pre-existing UI primitives: @/components/ui/button, @/components/ui/card, and @/lib/utils (cn).
- For durable database storage, use: \`import db from "@/lib/db"; const items = db.collection("items"); const { records } = await items.list(); await items.create(data); await items.update(record._id, data); await items.remove(record._id);\`.
- If you import additional packages, the system automatically detects them, adds them to package.json, and installs them.

4. Styling & Visual Craft
- Use Tailwind CSS utilities. In CSS files, ensure all rules are inside standard selectors (no orphaned CSS properties).
- Keep \`@import "tailwindcss";\` at the top of the global CSS file.
- Deliver rich, responsive layouts (mobile, tablet, desktop) with intentional typography, deliberate color palettes, and accessible contrast.
- Ensure all interactive elements (buttons, links, inputs) have active, focus-visible, and disabled states.

5. Real Behavior & Code Quality
- Output complete, working, production-ready code. Never leave TODOs, placeholders, empty stubs, or ellipses (\`// ...\`).
- Never simulate actions with fake timers or pretend success. Provide honest loading, error, and empty states.
- Ensure all imports and exports match across files. Default export your main entry point component.
`;

const RETRY_PROMPT = `Your previous response was incomplete or contained validation issues.
You MUST respond with ONLY complete code file blocks in this exact format — no explanations, no thinking, no prose:

### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

Make sure all imported local files are provided, all syntax is valid, and the app has a complete, working entrypoint (e.g. src/App.tsx or src/app/page.tsx). Generate the complete corrected files now.`;

/**
 * Appended to the system prompt when the user is iterating on an existing project.
 */
const FOLLOW_UP_SUFFIX = `

## FOLLOW-UP MODE — INCREMENTAL EDITING ON EXISTING PROJECT

The user's current project files and directory structure are provided below. This is an iteration on an EXISTING application.
You MUST:
1. Inspect the existing file tree and files carefully.
2. Determine precisely which file(s) need to be modified, created, or deleted to satisfy the user's request.
3. Output the COMPLETE updated code for ONLY the files being changed or newly created.
4. Do NOT output unchanged files — they will remain untouched on disk.
5. Preserve all existing structure, design, functionality, and styling of untouched areas.
6. If a file is no longer needed, output \`### Delete: path/to/file.tsx\`.
`;

const SNAPSHOT_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);
const MAX_BUILD_REPAIR_ATTEMPTS = 5;
const MAX_PREVIEW_INFRASTRUCTURE_RETRIES = 2;
const BUILD_REPAIR_STRATEGIES = [
  "Fix the direct compiler or runtime cause with the smallest targeted change.",
  "Simplify only the failing implementation while preserving the requested behavior and visual quality.",
  "Remove or replace the failing optional dependency with the installed React, Tailwind, or native browser stack.",
  "Rebuild only the affected component using known installed dependencies and keep every passing area unchanged.",
  "Use the most conservative complete fallback that preserves the core requested functionality and compiles reliably.",
] as const;

export function isSourceBuildFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Generated app failed to compile");
}

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
  const sourceExtensions = /\.(?:tsx?|jsx?|css|json|html)$/;
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

  // Pattern 6: Single raw TSX/JSX/HTML code fence without file annotations.
  if (files.length === 0) {
    const rawFence = /```(?:tsx|ts|jsx|js|javascript|typescript|html|css)?\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(text);
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
        path: "src/App.tsx",
        content: code,
      });
    } else if (candidateCode.includes("<!DOCTYPE") || candidateCode.includes("<html") || candidateCode.includes("<body")) {
      files.push({
        path: "index.html",
        content: candidateCode,
      });
    }
  }

  return files;
}

export function extractDeletionsFromMarkdown(text: string): string[] {
  const deletions: string[] = [];
  const deletePattern = /(?:^|[\r\n])\s*(?:###\s*Delete:\s*|<delete\s+(?:filePath|path)=["'])(`?[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+`?)/gi;
  let m: RegExpExecArray | null;
  while ((m = deletePattern.exec(text)) !== null) {
    deletions.push(m[1].replace(/[`"']/g, "").trim());
  }
  return deletions;
}

function assertUsableGeneratedFiles(
  files: GeneratedSourceFile[],
  phase: "generation" | "repair",
  existingPaths: Iterable<string>
): void {
  const existing = [...existingPaths].map(normalizeGeneratedPath);
  const VALID_ENTRYPOINTS = new Set([
    "src/app/page.tsx",
    "src/app/page.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "src/app.tsx",
    "src/app.jsx",
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "app/page.tsx",
    "app/page.jsx",
    "pages/index.tsx",
    "pages/index.jsx",
    "index.html",
  ]);
  const hasExistingEntrypoint = existing.some(
    (p) => VALID_ENTRYPOINTS.has(p) || p.endsWith("/page.tsx") || p.endsWith("/page.jsx") || p === "index.html"
  );
  const issues = generationValidationIssues(files, existing, {
    requireEntrypoint: phase === "generation" && !hasExistingEntrypoint,
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
  // A model response can include an unnecessary runtime file or layout snippet.
  // Drop those runtime-owned extras before validation.
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (isRuntimeOwnedGeneratedPath(file.path, file.content)) {
      console.log(`[localAgentEngine] Dropped runtime-owned generated file: ${file.path}`);
      files.splice(i, 1);
    }
  }

  const REACT_HOOK_PATTERN = /\b(useState|useEffect|useRef|useCallback|useMemo|useReducer|useContext|useLayoutEffect|useImperativeHandle|useDebugValue|useDeferredValue|useTransition|useId|useSyncExternalStore)\b/;
  const BROWSER_API_PATTERN = /\b(window\.|document\.|localStorage\.|sessionStorage\.|navigator\.)\b/;

  for (const file of files) {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) continue;

    let content = file.content;

    // Detect non-code content
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
      console.warn(`[localAgentEngine] Non-code content detected in ${file.path}`);
    }

    // Remove react-dom/client imports (never needed in component files)
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

        const tree = localFileManager.getTree(projectId);
        const sourceExtensions = /\.(?:tsx?|jsx?|css|json|html)$/;
        const allSourceEntries = tree.entries.filter(
          (e) =>
            e.type === "file" &&
            sourceExtensions.test(e.path) &&
            !e.path.includes("node_modules") &&
            !e.path.startsWith(".")
        );

        // Check if there is real code in the workspace (not just the initial placeholder)
        const nonPlaceholderEntries = allSourceEntries.filter((entry) => {
          const file = localFileManager.getContent(projectId, entry.path);
          return file && file.encoding === "utf8" && !containsGenerationPlaceholder(file.content);
        });

        const hasRealExistingCode = nonPlaceholderEntries.some((entry) => {
          const p = entry.path;
          return (
            p === "src/App.tsx" ||
            p === "src/app/page.tsx" ||
            (p.startsWith("src/components/") && !p.includes("src/components/ui/")) ||
            p.startsWith("src/pages/") ||
            (p.endsWith(".html") && p !== "public/index.html")
          );
        });

        if (hasRealExistingCode && nonPlaceholderEntries.length > 0) {
          isFollowUp = true;

          // Build a clean file tree summary
          const treeSummary = allSourceEntries
            .map((e) => ` - ${e.path} (${e.size} bytes)`)
            .join("\n");

          // Build source context with a 35,000 char budget
          let charBudget = 35_000;
          const sourceChunks: string[] = [];
          for (const entry of nonPlaceholderEntries) {
            if (charBudget <= 0) break;
            const file = localFileManager.getContent(projectId, entry.path);
            if (!file || file.encoding !== "utf8") continue;
            const content = file.content.slice(0, charBudget);
            charBudget -= content.length;
            sourceChunks.push(`### File: ${entry.path}\n\`\`\`\n${content}\n\`\`\``);
          }

          if (sourceChunks.length > 0) {
            userPromptContent = `Project File Tree:\n${treeSummary}\n\nCurrent Project Source Files:\n\n${sourceChunks.join("\n\n")}\n\nUser Request: ${prompt}\n\nIMPORTANT: This is an incremental follow-up request on an existing project. Modify ONLY the files needed to satisfy the request. Leave all other files untouched. Output the complete updated code for each changed file, or create new files as needed. If removing an obsolete file, output ### Delete: path/to/file.`;
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

        // Photography-heavy prompts can receive real, server-resolved image
        // candidates. This is optional by design: missing credentials, empty
        // searches, or provider failures fall through to the design system's
        // explicit CSS/SVG fallback instead of blocking generation.
        try {
          const imageryContext = await resolvePexelsImagery(prompt);
          if (imageryContext) userPromptContent = `${userPromptContent}\n\n${imageryContext}`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Pexels] Image sourcing failed; using designed fallbacks: ${message}`);
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
        let usedPublicModelName = routerResult.publicModelName;
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
            usedPublicModelName = retryResult.publicModelName;
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

        const deletions = extractDeletionsFromMarkdown(content);
        for (const delPath of deletions) {
          if (localFileManager.deleteFile(projectId, delPath)) {
            newMessages.push({
              author: "agent",
              message: `Deleted file \`${delPath}\``,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
          }
        }

        purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));

        // Add detected dependencies to this generated app and install if missing
        const allFiles = files.length > 0 ? [...files] : [];
        const existingEntryForDeps =
          localFileManager.getContent(projectId, "src/app/page.tsx") ||
          localFileManager.getContent(projectId, "src/App.tsx");
        if (existingEntryForDeps?.content && !allFiles.some((f) => f.path.includes("page.tsx") || f.path.includes("App.tsx"))) {
          allFiles.push({ path: existingEntryForDeps.path, content: existingEntryForDeps.content });
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
            if (depResult.installed.length > 0) {
              newMessages.push({
                author: "agent",
                message: `Installed packages: ${depResult.installed.join(", ")}`,
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

        const recoverPreviewInfrastructure = async (
          initialError: unknown,
          recoveredMessage: string
        ): Promise<void> => {
          let infrastructureError = initialError;
          for (let attempt = 1; attempt <= MAX_PREVIEW_INFRASTRUCTURE_RETRIES; attempt += 1) {
            newMessages.push({
              author: "agent",
              message: `Preview infrastructure failed. Retrying startup (${attempt} of ${MAX_PREVIEW_INFRASTRUCTURE_RETRIES}) without changing your source...`,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });
            try {
              const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
              newMessages.push({
                author: "agent",
                message: recoveredMessage,
                messageType: "finished",
                createdAt: new Date().toISOString(),
              });
              localProjectStore.update(projectId, {
                status: "done",
                conversation: newMessages,
                previewUrl,
                serverStatus: "Active",
              });
              return;
            } catch (retryError) {
              infrastructureError = retryError;
              console.error(`[localAgentEngine] Preview infrastructure retry ${attempt} failed:`, retryError);
            }
          }

          if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
          let restoredPreviewUrl: string | undefined;
          try {
            restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
          } catch (restoreError) {
            console.error(`[localAgentEngine] Previous preview restore failed after infrastructure error:`, restoreError);
          }
          newMessages.push({
            author: "agent",
            message: restoredPreviewUrl
              ? "Preview infrastructure remained unavailable for the new build, so the previous working version was restored."
              : `Preview infrastructure remained unavailable and the previous preview could not be restored: ${infrastructureError instanceof Error ? infrastructureError.message : String(infrastructureError)}`,
            messageType: "error",
            createdAt: new Date().toISOString(),
          });
          localProjectStore.update(projectId, {
            status: "done",
            conversation: newMessages,
            previewUrl: restoredPreviewUrl,
            serverStatus: restoredPreviewUrl ? "Active" : "Error",
          });
        };

        // Compile before success is shown. This is the reliability boundary that
        // prevents a model response from becoming a broken user-facing preview.
        try {
          const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
          console.log(`[localAgentEngine] Disposable build passed and persistent preview deployed for ${projectId}`);

          newMessages.push({
            author: "agent",
            message: `Application generated successfully with ${usedPublicModelName}! Generated ${files.length || 1} files, verified the disposable build, and deployed the persistent preview.`,
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

          // Provisioning, persistence, dependency installation and preview
          // readiness failures do not prove the generated source is wrong. Retry
          // the real startup operation without asking a model to rewrite code.
          if (!isSourceBuildFailure(sandboxErr)) {
            await recoverPreviewInfrastructure(
              sandboxErr,
              `Application generated with ${usedPublicModelName}, then verified after the preview infrastructure recovered.`
            );
            return;
          }

          let repairError: unknown = sandboxErr;
          let repaired = false;

          for (let attempt = 1; attempt <= MAX_BUILD_REPAIR_ATTEMPTS; attempt += 1) {
            const strategy = BUILD_REPAIR_STRATEGIES[attempt - 1];
            const buildError = repairError instanceof Error ? repairError.message : String(repairError);
            newMessages.push({
              author: "agent",
              message: `Build validation failed. Running repair attempt ${attempt} of ${MAX_BUILD_REPAIR_ATTEMPTS}: ${strategy}`,
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
                    content: `The generated app failed real production validation. Repair the implementation and return ONLY complete corrected file blocks. Never use @apply in CSS. Preserve every working feature and do not report success; the platform will rebuild and verify it.\n\nRepair strategy for this attempt:\n${strategy}\n\nOriginal request:\n${prompt}\n\nLatest validation error:\n${buildError}\n\nCurrent source:\n${workspaceRepairContext(projectId)}`,
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

              let previewUrl: string;
              try {
                previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
              } catch (deploymentError) {
                if (isSourceBuildFailure(deploymentError)) throw deploymentError;
                console.error(`[localAgentEngine] Repair attempt ${attempt} reached preview infrastructure failure:`, deploymentError);
                await recoverPreviewInfrastructure(
                  deploymentError,
                  `Application generated, repaired on attempt ${attempt}, and verified after the preview infrastructure recovered.`
                );
                repaired = true;
                break;
              }
              newMessages.push({
                author: "agent",
                message: `Application generated, repaired on attempt ${attempt}, and verified in the live preview using ${repairResult.publicModelName}.`,
                messageType: "finished",
                createdAt: new Date().toISOString(),
              });
              localProjectStore.update(projectId, {
                status: "done",
                conversation: newMessages,
                previewUrl,
                serverStatus: "Active",
              });
              repaired = true;
              break;
            } catch (attemptError) {
              repairError = attemptError;
              console.error(`[localAgentEngine] Repair attempt ${attempt} failed:`, attemptError);
            }
          }

          if (!repaired) {
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
                ? `The requested change did not pass validation after ${MAX_BUILD_REPAIR_ATTEMPTS} repair attempts, so the previous working version was restored. Please retry or adjust the prompt.`
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

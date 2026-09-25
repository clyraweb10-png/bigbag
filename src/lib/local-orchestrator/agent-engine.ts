import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { localProjectStore, persistentPreviewPath } from "./project-store";
import { localFileManager } from "./file-manager";
import { localSandboxManager } from "./sandbox-manager";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { multiModelRouter } from "./multi-model-router";
import { ensureWorkspaceDependencies } from "./dependency-scanner";
import { purgeInvalidStaticHtml } from "./starter-template";
import type { ConversationMessage } from "../vcaas-types";
import { withDesignSystemPrompt } from "../design-system-prompt";
import { analyzeWebsiteDesign, extractWebsiteUrl } from "./firecrawl-design";
import { ReferenceAnalysisError, runReferenceAnalysis } from "./reference-analysis";
import { resolvePexelsImagery } from "./pexels-imagery";
import {
  APPLICATION_ENTRYPOINT_PATHS,
  containsGenerationPlaceholder,
  generationValidationIssues,
  isRuntimeOwnedGeneratedPath,
  normalizeGeneratedPath,
  type GeneratedSourceFile,
} from "./generation-validator";

const SYSTEM_PROMPT = `You are the code-generation engine for BigBag AI App Builder. Generate complete, working full-stack React and TypeScript applications from plain-English requests. Follow-up requests are incremental edits to the existing project.

## CRITICAL RULES

OUTPUT FORMAT: Return ONLY complete file blocks. Do not return explanations, plans, thinking, summaries, or prose before, between, or after file blocks.

1. Mandatory entrypoint contract
- For every initial build, the FIRST file block must be exactly one application entrypoint. Prefer \`src/App.tsx\`. \`src/app/page.tsx\` or \`src/pages/index.tsx\` are also supported when the user explicitly asks for those conventions.
- The entrypoint must be non-empty, syntactically valid, and have a default export.
- Never output more than one application entrypoint.
- The BigBag runtime owns \`index.html\`, \`src/main.tsx\`, \`src/app/layout.tsx\`, \`src/lib/db.ts\`, build configuration, and package metadata. Import the existing database client but never output or replace it. Do not output or import framework-only server modules such as \`next/*\`.
- Secondary routes and components come only after the complete entrypoint. If output might be truncated, finish the current file instead of starting another one.

2. File integrity
- Use plain ASCII punctuation and spaces. Never emit curly quotes, em dash, en dash, ellipsis characters, non-breaking spaces, zero-width characters, or byte-order marks. Unicode text is allowed only when the user explicitly requests localized content, and never in code syntax or file paths.
- Every file must be complete. Never end mid-token, mid-import, mid-string, or mid-JSX tag.
- Every TypeScript, JavaScript, JSX, TSX, CSS, and JSON file must parse. Match all braces, brackets, parentheses, quotes, template literals, and JSX tags. JSON must not contain comments or trailing commas.
- Do not emit TODO, FIXME, lorem ipsum, fake success, fake timers, placeholders, pseudo-code, empty stubs, or comments standing in for behavior.
- Every local import must resolve to a file you return in this response or an existing file shown in project context.

3. Output format
Each file must be preceded by a clear file header and markdown code fence:
### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

To delete an obsolete file, output:
### Delete: path/to/file.tsx

4. Full-stack behavior and dependencies
- Pre-installed and ready: react, react-dom (v19), tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, gsap, zustand, recharts, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, sonner.
- Pre-existing UI primitives: @/components/ui/button, @/components/ui/card, and @/lib/utils (cn).
- For durable database storage, use exactly: \`import db from "@/lib/db"; const items = db.collection("items"); const { records } = await items.list(); await items.create(data); await items.update(record._id, data); await items.remove(record._id);\`.
- When the request needs persisted records, implement real initial loading plus create/update/delete flows through that database client. Show honest loading, empty, and recoverable error states. Do not substitute hardcoded rows for requested persistence.
- The database client is browser-safe and project-scoped. Never import server-only database libraries, expose credentials, or invent database methods.
- Do not reference environment variables unless the user explicitly requests an external integration and you also return a complete \`.env.example\` declaration. Browser variables must use the \`VITE_\` prefix and \`import.meta.env.VITE_NAME\`. Never hardcode keys or secrets.
- If you import additional packages, the system automatically detects them, adds them to package.json, and installs them.

5. Architecture and visual craft
- Build modular applications with logical components, hooks, utilities, and types. For multi-view flows, use explicit view components and working client-side navigation.
- Use Tailwind CSS utilities. In CSS files, ensure all rules are inside standard selectors (no orphaned CSS properties).
- Keep \`@import "tailwindcss";\` at the top of the global CSS file.
- Deliver rich, responsive layouts (mobile, tablet, desktop) with intentional typography, deliberate color palettes, and accessible contrast.
- Ensure all interactive elements (buttons, links, inputs) have active, focus-visible, and disabled states.

6. Silent self-check before returning
- Confirm exactly one supported entrypoint exists, is the first file block on initial generation, and has a default export.
- Confirm every local import resolves and every imported package is real.
- Confirm no forbidden Unicode punctuation or invisible characters exist.
- Confirm no file is truncated and every source, CSS, and JSON file parses.
- Confirm requested interactions and persistence are implemented rather than described.
- If any check fails, repair it before returning. Never rely on a later retry.
`;

const RETRY_PROMPT = `Your previous response was incomplete or failed validation.
Return ONLY complete corrected file blocks in this exact format - no explanations, thinking, summaries, or prose:

### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

For an initial build, return the complete application entrypoint as the first file block. Use exactly one entrypoint. Replace every file named by the validation report with a complete corrected version. Preserve valid requested behavior, provide every missing local import, use plain ASCII punctuation, and finish every file. Generate the corrected files now.`;

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
const MAX_STATIC_VALIDATION_RETRIES = 3;
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
  return message.includes("Generated app failed to compile") && !isBuildResourceFailure(error);
}

export function isBuildResourceFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:exit status 137|signal SIGKILL|out of memory|\bKilled\b)/i.test(message);
}

type SharedAgentRunState = {
  runs: Map<string, Promise<void>>;
  controllers: Map<string, { generationId: string; controller: AbortController }>;
};

const agentRunStateKey = Symbol.for("bigbag.local-orchestrator.agent-runs");
const agentGlobalState = globalThis as typeof globalThis & {
  [agentRunStateKey]?: SharedAgentRunState;
};
const sharedAgentRunState = agentGlobalState[agentRunStateKey] || {
  runs: new Map<string, Promise<void>>(),
  controllers: new Map<string, { generationId: string; controller: AbortController }>(),
};
sharedAgentRunState.controllers ||= new Map();
agentGlobalState[agentRunStateKey] = sharedAgentRunState;

class GenerationCancelledError extends Error {
  constructor() {
    super("Generation stopped by the user");
  }
}

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
  existingPaths: Iterable<string>,
  existingEnvironmentExample?: string
): void {
  const existing = [...existingPaths].map(normalizeGeneratedPath);
  const hasExistingEntrypoint = existing.some((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry));
  const issues = generationValidationIssues(files, existing, {
    requireEntrypoint: phase === "generation" && !hasExistingEntrypoint,
    requireEntrypointFirst: phase === "generation" && !hasExistingEntrypoint,
    existingEnvironmentExample,
  });
  if (issues.length > 0) throw new Error(`The AI ${phase} was incomplete: ${issues.join("; ")}`);
}

function mergeGeneratedFiles(
  original: Array<{ path: string; content: string }>,
  retry: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  const merged = new Map(original.map((file) => [normalizeGeneratedPath(file.path), file]));
  for (const file of retry) {
    const normalized = normalizeGeneratedPath(file.path);
    merged.delete(normalized);
    merged.set(normalized, { ...file, path: normalized });
  }
  return [...merged.values()];
}

export function mergeGeneratedActions(
  currentFiles: GeneratedSourceFile[],
  currentDeletions: Iterable<string>,
  replacementFiles: GeneratedSourceFile[],
  replacementDeletions: Iterable<string>
): { files: GeneratedSourceFile[]; deletions: Set<string> } {
  const deletions = new Set([...currentDeletions].map(normalizeGeneratedPath));
  const removedPaths = new Set([...replacementDeletions].map(normalizeGeneratedPath));
  const withoutDeletedFiles = currentFiles.filter(
    (file) => !removedPaths.has(normalizeGeneratedPath(file.path))
  );
  for (const removedPath of removedPaths) deletions.add(removedPath);

  const files = mergeGeneratedFiles(withoutDeletedFiles, replacementFiles);
  // A later response that recreates a path wins over an earlier delete. This is
  // also the conservative choice for a contradictory single response: keep the
  // complete file the model supplied instead of deleting it after validation.
  for (const file of replacementFiles) deletions.delete(normalizeGeneratedPath(file.path));
  return { files, deletions };
}

function availableWorkspacePaths(projectId: string): string[] {
  const paths = localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file")
    .filter((entry) => {
      const file = localFileManager.getContent(projectId, entry.path);
      return Boolean(
        file &&
        file.encoding === "utf8" &&
        !containsGenerationPlaceholder(file.content) &&
        !isRuntimeOwnedGeneratedPath(entry.path, file.content)
      );
    })
    .map((entry) => normalizeGeneratedPath(entry.path));
  // Runtime-owned files are not user-generated source and must stay out of
  // follow-up context, but generated code is allowed to import this injected
  // project-scoped database client.
  if (localFileManager.getContent(projectId, "src/lib/db.ts")) paths.push("src/lib/db.ts");
  return paths;
}

function workspaceEnvironmentExample(projectId: string): string | undefined {
  const file = localFileManager.getContent(projectId, ".env.example");
  return file?.encoding === "utf8" ? file.content : undefined;
}

export function hasRealGeneratedSource(files: GeneratedSourceFile[]): boolean {
  return files.some((file) => {
    const normalized = normalizeGeneratedPath(file.path);
    if (containsGenerationPlaceholder(file.content) || isRuntimeOwnedGeneratedPath(normalized, file.content)) {
      return false;
    }
    return (
      APPLICATION_ENTRYPOINT_PATHS.has(normalized) ||
      (normalized.startsWith("src/components/") && !normalized.startsWith("src/components/ui/")) ||
      (normalized.endsWith(".html") && normalized !== "public/index.html")
    );
  });
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
    const normalizedPath = normalizeGeneratedPath(file.path);
    const isReactEntry = /^src\/(?:main|index)\.(?:tsx|jsx)$/.test(normalizedPath);

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

    // Component files must not mount a second React tree. Browser entrypoints,
    // however, own createRoot and must retain (or recover) this import.
    if (isReactEntry) {
      const usesBareCreateRoot = /\bcreateRoot\s*\(/.test(content);
      const importsCreateRoot = /import\s*{[^}]*\bcreateRoot\b[^}]*}\s*from\s*['"]react-dom\/client['"]/.test(content);
      if (usesBareCreateRoot && !importsCreateRoot) {
        content = `import { createRoot } from "react-dom/client";\n${content}`;
        console.log(`[localAgentEngine] Restored createRoot import in ${file.path}`);
      }
    } else {
      content = content.replace(/^\s*import\s+.*from\s+['"]react-dom\/client['"];?\s*$/gm, "");
    }

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
  async runPrompt(
    projectId: string,
    prompt: string,
    options: { visualReferenceUrl?: string; displayPrompt?: string } = {}
  ): Promise<void> {
    const record = localProjectStore.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);
    if (record.status === "init" || sharedAgentRunState.runs.has(projectId)) {
      throw new Error("A generation is already running or stopping for this project");
    }
    const priorDeployment = record.deployment?.status === "success" ? {
      deployment: { ...record.deployment },
      previewUrl: record.previewUrl || persistentPreviewPath(projectId),
      productionProjectUrl: record.productionProjectUrl,
    } : null;
    const generationId = randomUUID();
    const controller = new AbortController();
    sharedAgentRunState.controllers.set(projectId, { generationId, controller });
    const checkCancelled = () => {
      const current = localProjectStore.getRecord(projectId);
      if (controller.signal.aborted || current?.activeGenerationId !== generationId || current.cancellationRequestedAt) {
        throw new GenerationCancelledError();
      }
    };

    const now = new Date().toISOString();
    const priorMessages = record.conversation || [];

    // 1. Add user message
    const userMsg: ConversationMessage = {
      author: "user",
      message: options.displayPrompt?.trim() || prompt,
      messageType: "regular",
      createdAt: now,
    };

    const startMsg: ConversationMessage = {
      author: "agent",
      message: `Starting AI Composer...`,
      messageType: "starting",
      createdAt: new Date().toISOString(),
      generationEvent: { type: "generation_started", status: "started", generationId },
    };

    // /generate persists the whole conversation before starting the first run.
    // Reuse its existing user request instead of echoing it a second time.
    const alreadyInInitialConversation = !priorMessages.some((message) => message.generationEvent?.type === "generation_started") &&
      priorMessages.some((message) => message.author === "user" && message.message === userMsg.message);
    const conversation = [...priorMessages, ...(alreadyInInitialConversation ? [] : [userMsg]), startMsg];
    localProjectStore.update(projectId, {
      status: "init",
      activeGenerationId: generationId,
      cancellationRequestedAt: undefined,
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
        checkCancelled();
        // Keep template and snapshot I/O inside the guarded path so a filesystem
        // failure is reported instead of leaving the project stuck in `init`.
        // The preview starts only after generated code passes a real compile.
        localSandboxManager.ensureProjectTemplate(projectId);
        previousWorkspace = snapshotWorkspace(projectId);

        const providers = multiModelRouter.getProviders().filter((provider) => provider.id === "telnyx-glm" && /GLM-5\.3-Flash/i.test(provider.model));
        if (providers.length === 0) {
          throw new Error("GLM 5.3 Flash is required for code generation; configure TELNYX_MODEL and TELNYX_API_KEY");
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
          return file &&
            file.encoding === "utf8" &&
            !containsGenerationPlaceholder(file.content) &&
            !isRuntimeOwnedGeneratedPath(entry.path, file.content);
        });

        const hasRealExistingCode = hasRealGeneratedSource(
          nonPlaceholderEntries.flatMap((entry) => {
            const file = localFileManager.getContent(projectId, entry.path);
            return file && file.encoding === "utf8"
              ? [{ path: entry.path, content: file.content }]
              : [];
          })
        );

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

        const referenceUrl = options.visualReferenceUrl
          ? extractWebsiteUrl(options.visualReferenceUrl)
          : null;
        if (options.visualReferenceUrl && !referenceUrl) {
          throw new Error("The submitted visual reference URL is invalid.");
        }
        if (referenceUrl) {
          const crawlStartedAt = Date.now();
          const current = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [
              ...(current?.conversation || []),
              {
                author: "agent",
                message: "Analyzing the reference website's design with Firecrawl...",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: {
                  type: "crawl_started",
                  status: "started",
                  sourceUrl: referenceUrl,
                },
              },
            ],
          });
          let referenceFailurePhase: "crawl" | "vision" = "crawl";
          try {
            const design = await analyzeWebsiteDesign(referenceUrl);
            checkCancelled();
            const afterCrawl = localProjectStore.getRecord(projectId);
            const crawlAssetMessages: ConversationMessage[] = design.referencePackage.assets.map((asset, imageIndex) => ({
              author: "agent" as const,
              message: `Fetched visual reference ${imageIndex + 1}.`,
              messageType: "building" as const,
              createdAt: new Date().toISOString(),
              files: [{
                name: asset.role === "screenshot" ? "reference-page-screenshot.png" : `reference-asset-${imageIndex + 1}`,
                url: asset.url,
                imageDescription: `Firecrawl visual reference ${imageIndex + 1} from ${design.sourceUrl}`,
                mimeType: asset.contentType || "image/unknown",
              }],
              generationEvent: {
                type: "crawl_asset_received" as const,
                status: "completed" as const,
                assetUrl: asset.url,
                sourceUrl: design.sourceUrl,
                source: "crawl" as const,
              },
            }));
            localProjectStore.update(projectId, {
              conversation: [
                ...(afterCrawl?.conversation || []),
                {
                  author: "agent",
                  message: `Firecrawl completed — ${design.assetUrls.length} visual reference${design.assetUrls.length === 1 ? "" : "s"}; ${design.imageUrls.length} selected for analysis.`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: "crawl_completed",
                    status: "completed",
                    sourceUrl: design.sourceUrl,
                    durationMs: Date.now() - crawlStartedAt,
                    source: "crawl",
                  },
                },
                ...crawlAssetMessages,
                {
                  author: "agent",
                  message: "Analyzing visual references with GLM...",
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: { type: "visual_analysis_started", status: "started", source: "vision" },
                },
              ],
            });
            referenceFailurePhase = "vision";

            const visualAnalysis = await runReferenceAnalysis(design);
            checkCancelled();

            const afterVision = localProjectStore.getRecord(projectId);
            const visualMessages: ConversationMessage[] = [{
              author: "agent",
              message: `Reference analysis completed. ${visualAnalysis.specification.design_summary}`,
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: {
                type: "visual_analysis_completed",
                status: "completed",
                source: "vision",
                referenceAnalysis: visualAnalysis.diagnostics,
              },
            }];
            localProjectStore.update(projectId, {
              conversation: [...(afterVision?.conversation || []), ...visualMessages],
            });
            userPromptContent = `${userPromptContent}\n\n${visualAnalysis.implementationContext}`;
          } catch (error) {
            checkCancelled();
            const message = error instanceof Error ? error.message : String(error);
            const diagnostics = error instanceof ReferenceAnalysisError ? error.diagnostics : undefined;
            console.warn(`[ReferenceAnalysis] ${JSON.stringify({
              event: "reference_pipeline_failed",
              sourceUrl: referenceUrl,
              phase: referenceFailurePhase,
              errorCategory: diagnostics?.errorCategory || (referenceFailurePhase === "crawl" ? "crawl_error" : "unknown"),
              reason: message,
            })}`);
            const afterReferenceFailure = localProjectStore.getRecord(projectId);
            localProjectStore.update(projectId, {
              conversation: [
                ...(afterReferenceFailure?.conversation || []),
                {
                  author: "agent",
                  message: `Reference website analysis failed: ${message}`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: referenceFailurePhase === "crawl" ? "crawl_completed" : "visual_analysis_failed",
                    status: "failed",
                    sourceUrl: referenceUrl,
                    ...(referenceFailurePhase === "crawl" ? { durationMs: Date.now() - crawlStartedAt } : {}),
                    source: referenceFailurePhase,
                    error: message,
                    ...(diagnostics ? { referenceAnalysis: diagnostics } : {}),
                  },
                },
              ],
            });
            throw new Error(`Reference website analysis failed: ${message}`);
          }
        }

        // Photography-heavy prompts can receive real, server-resolved image
        // candidates. This is optional by design: missing credentials, empty
        // searches, or provider failures fall through to the design system's
        // explicit CSS/SVG fallback instead of blocking generation.
        try {
          const imageryContext = await resolvePexelsImagery(prompt);
          checkCancelled();
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
          for (const msg of priorMessages) {
            // The current message is not part of this immutable pre-run snapshot.
            if (msg.author === "user") {
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

        const beforeGeneration = localProjectStore.getRecord(projectId);
        localProjectStore.update(projectId, {
          conversation: [
            ...(beforeGeneration?.conversation || []),
            {
              author: "agent",
              message: "Generating the implementation from the approved project context...",
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: { type: "file_generation_started", status: "started" },
            },
          ],
        });

        const routerResult = await multiModelRouter.complete(
          messages,
          (statusMsg) => {
            if (controller.signal.aborted) return;
            const currentRec = localProjectStore.getRecord(projectId);
            const switchMsg: ConversationMessage = {
              author: "agent",
              message: statusMsg,
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: { type: "file_generation_started", status: "started" },
            };
            localProjectStore.update(projectId, {
              conversation: [...(currentRec?.conversation || []), switchMsg],
            });
          },
          { perProviderTimeoutMs: 120_000, totalTimeoutMs: 240_000, onlyProviderId: "telnyx-glm", signal: controller.signal, requestLabel: "code_generation" }
        );
        checkCancelled();

        const content = routerResult.text;
        let usedProviderId = routerResult.providerId;

        // Extract files from generated markdown, with auto-retry on failure
        let files = extractFilesFromMarkdown(content);
        postProcessGeneratedFiles(files);
        let finalDeletions = new Set(extractDeletionsFromMarkdown(content).map(normalizeGeneratedPath));
        for (const file of files) finalDeletions.delete(normalizeGeneratedPath(file.path));

        const existingPaths = availableWorkspacePaths(projectId);
        const existingEnvironmentExample = workspaceEnvironmentExample(projectId);
        let effectiveExistingEnvironmentExample = finalDeletions.has(".env.example")
          ? undefined
          : existingEnvironmentExample;
        const initialGeneration = !isFollowUp;
        let effectiveExistingPaths = existingPaths.filter((entry) => !finalDeletions.has(entry));
        let validationIssues = generationValidationIssues(files, effectiveExistingPaths, {
          requireEntrypoint: initialGeneration,
          requireEntrypointFirst: initialGeneration,
          existingEnvironmentExample: effectiveExistingEnvironmentExample,
        });

        // Auto-retry incomplete or disconnected output before it touches the workspace.
        for (
          let retryAttempt = 1;
          validationIssues.length > 0 && retryAttempt <= MAX_STATIC_VALIDATION_RETRIES;
          retryAttempt += 1
        ) {
          console.log(`[localAgentEngine] Static validation attempt ${retryAttempt} required: ${validationIssues.join("; ")}`);
          const currentRecRetry = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [
              ...(currentRecRetry?.conversation || []),
              {
                author: "agent",
                message: `Correcting generated files before build (${retryAttempt} of ${MAX_STATIC_VALIDATION_RETRIES})...`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              },
            ],
          });

          const extractedContext = files
            .map((file) => `### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
            .join("\n\n")
            .slice(0, 48_000);
          try {
            const retryResult = await multiModelRouter.complete(
              [
                { role: "system", content: systemPromptForRun },
                { role: "user", content: userPromptContent },
                { role: "assistant", content: extractedContext },
                {
                  role: "user",
                  content: `${RETRY_PROMPT}\n\nValidation pass ${retryAttempt} failed:\n- ${validationIssues.join("\n- ")}`,
                },
              ],
              () => {},
              {
                onlyProviderId: "telnyx-glm",
                signal: controller.signal,
                perProviderTimeoutMs: 120_000,
                totalTimeoutMs: 210_000,
              }
            );
            checkCancelled();
            const retryFiles = extractFilesFromMarkdown(retryResult.text);
            postProcessGeneratedFiles(retryFiles);
            const mergedActions = mergeGeneratedActions(
              files,
              finalDeletions,
              retryFiles,
              extractDeletionsFromMarkdown(retryResult.text)
            );
            files = mergedActions.files;
            finalDeletions = mergedActions.deletions;
            effectiveExistingEnvironmentExample = finalDeletions.has(".env.example")
              ? undefined
              : existingEnvironmentExample;
            postProcessGeneratedFiles(files);
            usedProviderId = retryResult.providerId;
            effectiveExistingPaths = existingPaths.filter((entry) => !finalDeletions.has(entry));
            validationIssues = generationValidationIssues(files, effectiveExistingPaths, {
              requireEntrypoint: initialGeneration,
              requireEntrypointFirst: initialGeneration,
              existingEnvironmentExample: effectiveExistingEnvironmentExample,
            });
            if (validationIssues.length === 0) {
              console.log(`[localAgentEngine] Static correction succeeded with ${retryFiles.length} replacement files`);
            }
          } catch (retryError) {
            checkCancelled();
            console.error(`[localAgentEngine] Static correction request failed:`, retryError);
            break;
          }
        }

        assertUsableGeneratedFiles(
          files,
          "generation",
          effectiveExistingPaths,
          effectiveExistingEnvironmentExample
        );

        const currentRec = localProjectStore.getRecord(projectId);
        const newMessages: ConversationMessage[] = [...(currentRec?.conversation || [])];

        for (const file of files) {
          checkCancelled();
          const existedBeforeWrite = Boolean(localFileManager.getContent(projectId, file.path));
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
            message: `${existedBeforeWrite ? "Updated" : "Created"} file \`${file.path}\``,
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: {
              type: existedBeforeWrite ? "file_updated" : "file_created",
              status: "completed",
              path: file.path,
              source: "generator",
            },
          });
          localProjectStore.update(projectId, { conversation: newMessages });
        }

        for (const delPath of finalDeletions) {
          checkCancelled();
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
          generationEvent: { type: "build_started", status: "started" },
        });
        newMessages.push({
          author: "agent",
          message: "Running generated-source, type, and production build validation...",
          messageType: "building",
          createdAt: new Date().toISOString(),
          generationEvent: { type: "validation_started", status: "started", source: "build" },
        });
        newMessages.push({
          author: "agent",
          message: "Starting the preview only after validation succeeds...",
          messageType: "building",
          createdAt: new Date().toISOString(),
          generationEvent: { type: "preview_started", status: "started", source: "runtime" },
        });
        localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });

        const recoverPreviewInfrastructure = async (
          initialError: unknown,
          recoveredMessage: string
        ): Promise<void> => {
          let infrastructureError = initialError;
          const maxInfrastructureRetries = isBuildResourceFailure(initialError) ? 0 : MAX_PREVIEW_INFRASTRUCTURE_RETRIES;
          for (let attempt = 1; attempt <= maxInfrastructureRetries; attempt += 1) {
            newMessages.push({
              author: "agent",
              message: `Preview infrastructure failed. Retrying startup (${attempt} of ${MAX_PREVIEW_INFRASTRUCTURE_RETRIES}) without changing your source...`,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });
            try {
              checkCancelled();
              const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
              checkCancelled();
              newMessages.push({
                author: "agent",
                message: "Validation and preview startup succeeded after infrastructure recovery.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "validation_completed", status: "completed", source: "infrastructure" },
              });
              newMessages.push({
                author: "agent",
                message: "Live preview is ready.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
              });
              newMessages.push({
                author: "agent",
                message: recoveredMessage,
                messageType: "finished",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "generation_completed", status: "completed" },
              });
              localProjectStore.update(projectId, {
                status: "done",
                conversation: newMessages,
                previewUrl,
                serverStatus: "Active",
              });
              return;
            } catch (retryError) {
              checkCancelled();
              infrastructureError = retryError;
              console.error(`[localAgentEngine] Preview infrastructure retry ${attempt} failed:`, retryError);
            }
          }

          checkCancelled();
          if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
          let restoredPreviewUrl = priorDeployment?.previewUrl;
          if (!restoredPreviewUrl && !isBuildResourceFailure(initialError) && previousWorkspace) {
            try {
              restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
            } catch (restoreError) {
              checkCancelled();
              console.error(`[localAgentEngine] Previous preview restore failed after infrastructure error:`, restoreError);
            }
          }
          if (restoredPreviewUrl && priorDeployment) {
            localProjectStore.update(projectId, {
              deployment: priorDeployment.deployment,
              productionProjectUrl: priorDeployment.productionProjectUrl,
              previewUrl: restoredPreviewUrl,
              serverStatus: "Active",
            });
          }
          const failureMessage = isBuildResourceFailure(infrastructureError)
            ? "The sandbox ran out of memory during the production build (exit 137). The generated source was not marked successful; a larger build sandbox is required."
            : `Preview infrastructure could not validate the application: ${infrastructureError instanceof Error ? infrastructureError.message : String(infrastructureError)}`;
          newMessages.push({
            author: "agent",
            message: failureMessage,
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: {
              type: "preview_failed",
              status: "failed",
              source: "infrastructure",
              error: failureMessage,
            },
          });
          newMessages.push({
            author: "agent",
            message: restoredPreviewUrl ? `${failureMessage} The previous validated preview remains available.` : failureMessage,
            messageType: "error",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "generation_failed", status: "failed", source: "infrastructure", error: failureMessage },
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
          checkCancelled();
          const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
          checkCancelled();
          console.log(`[localAgentEngine] Disposable build passed and persistent preview deployed for ${projectId}`);

          newMessages.push({
            author: "agent",
            message: "Production validation completed successfully.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "build_completed", status: "completed" },
          });
          newMessages.push({
            author: "agent",
            message: "Generated source, TypeScript, production build, and preview server validation passed.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "validation_completed", status: "completed", source: "build" },
          });
          newMessages.push({
            author: "agent",
            message: "Live preview is ready.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
          });

          newMessages.push({
            author: "agent",
            message: `All done. Generated ${files.length || 1} files, verified the build, and deployed the live preview.`,
            messageType: "finished",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "generation_completed", status: "completed" },
          });
          localProjectStore.update(projectId, {
            status: "done",
            conversation: newMessages,
            previewUrl: previewUrl.includes("http") ? previewUrl : `/api/preview/${projectId}`,
            serverStatus: "Active",
          });
        } catch (sandboxErr) {
          checkCancelled();
          console.error(`[localAgentEngine] Sandbox startup failed:`, sandboxErr);

          // Provisioning, persistence, dependency installation and preview
          // readiness failures do not prove the generated source is wrong. Retry
          // the real startup operation without asking a model to rewrite code.
          if (!isSourceBuildFailure(sandboxErr)) {
            await recoverPreviewInfrastructure(
              sandboxErr,
              "Application generated and verified after the preview infrastructure recovered."
            );
            return;
          }

          let repairError: unknown = sandboxErr;
          let repaired = false;

          for (let attempt = 1; attempt <= MAX_BUILD_REPAIR_ATTEMPTS; attempt += 1) {
            checkCancelled();
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
                  onlyProviderId: "telnyx-glm",
                  signal: controller.signal,
                  perProviderTimeoutMs: 120_000,
                  totalTimeoutMs: 210_000,
                }
              );
              checkCancelled();
              const repairFiles = extractFilesFromMarkdown(repairResult.text);
              postProcessGeneratedFiles(repairFiles);
              const repairDeletions = new Set(
                extractDeletionsFromMarkdown(repairResult.text).map(normalizeGeneratedPath)
              );
              for (const file of repairFiles) repairDeletions.delete(normalizeGeneratedPath(file.path));
              const repairExistingPaths = availableWorkspacePaths(projectId)
                .filter((entry) => !repairDeletions.has(entry));
              const replacementEnvironmentExample = repairFiles.find(
                (file) => normalizeGeneratedPath(file.path) === ".env.example"
              )?.content;
              const repairEnvironmentExample = replacementEnvironmentExample ??
                (repairDeletions.has(".env.example")
                  ? undefined
                  : workspaceEnvironmentExample(projectId));
              assertUsableGeneratedFiles(
                repairFiles,
                "repair",
                repairExistingPaths,
                repairEnvironmentExample
              );

              for (const file of repairFiles) {
                checkCancelled();
                const existedBeforeRepair = Boolean(localFileManager.getContent(projectId, file.path));
                let fileContent = file.content;
                if (file.path.endsWith(".css")) fileContent = sanitizeOrphanedCssProperties(stripGeneratedApplyRules(fileContent));
                if (file.path.endsWith("globals.css") || file.path.endsWith("global.css")) {
                  fileContent = fixCssImportOrder(fileContent);
                }
                localFileManager.writeContent(projectId, file.path, fileContent, "utf8");
                newMessages.push({
                  author: "agent",
                  message: `${existedBeforeRepair ? "Updated" : "Created"} file \`${file.path}\` during repair`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: existedBeforeRepair ? "file_updated" : "file_created",
                    status: "completed",
                    path: file.path,
                    source: "generator",
                  },
                });
                localProjectStore.update(projectId, { conversation: newMessages });
              }
              for (const deletedPath of repairDeletions) {
                localFileManager.deleteFile(projectId, deletedPath);
              }
              purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
              ensureWorkspaceDependencies(repairFiles, localProjectStore.getWorkspaceDir(projectId));

              let previewUrl: string;
              try {
                previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
                checkCancelled();
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
                message: "Production validation completed successfully after repair.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "validation_completed", status: "completed", source: "build" },
              });
              newMessages.push({
                author: "agent",
                message: "Live preview is ready.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
              });
              newMessages.push({
                author: "agent",
                message: `All done. The application was repaired on attempt ${attempt} and verified in the live preview.`,
                messageType: "finished",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "generation_completed", status: "completed" },
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
              checkCancelled();
              repairError = attemptError;
              console.error(`[localAgentEngine] Repair attempt ${attempt} failed:`, attemptError);
            }
          }

          if (!repaired) {
            checkCancelled();
            if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);

            let restoredPreviewUrl: string | undefined;
            try {
              restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
            } catch (restoreError) {
              checkCancelled();
              console.error(`[localAgentEngine] Previous preview restore failed:`, restoreError);
            }

            newMessages.push({
              author: "agent",
              message: restoredPreviewUrl
                ? `The requested change did not pass validation after ${MAX_BUILD_REPAIR_ATTEMPTS} repair attempts, so the previous working version was restored. Please retry or adjust the prompt.`
                : `Generation failed validation and the preview could not be restored: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
              messageType: "error",
              createdAt: new Date().toISOString(),
              generationEvent: {
                type: "generation_failed",
                status: "failed",
                source: "build",
                error: repairError instanceof Error ? repairError.message : String(repairError),
              },
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
        if (controller.signal.aborted || err instanceof GenerationCancelledError || localProjectStore.getRecord(projectId)?.cancellationRequestedAt) {
          if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
          if (priorDeployment) localProjectStore.update(projectId, {
            deployment: priorDeployment.deployment,
            previewUrl: priorDeployment.previewUrl,
            productionProjectUrl: priorDeployment.productionProjectUrl,
            serverStatus: "Active",
          });
          return;
        }
        console.error("[localAgentEngine error]", err);
        if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
        let restoredPreviewUrl: string | undefined;
        try {
          restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
        } catch (restoreError) {
          console.error("[localAgentEngine] Could not restore previous preview:", restoreError);
        }
        const current = localProjectStore.getRecord(projectId);
        const errorMsg: ConversationMessage = {
          author: "agent",
          message: `Generation encountered an issue: ${err.message || String(err)}`,
          messageType: "error",
          createdAt: new Date().toISOString(),
          generationEvent: {
            type: "generation_failed",
            status: "failed",
            error: err.message || String(err),
            source: "generator",
          },
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
      if (sharedAgentRunState.controllers.get(projectId)?.generationId === generationId) sharedAgentRunState.controllers.delete(projectId);
      void localProjectStore.flush(projectId).catch((error) => {
        console.error(`[localAgentEngine] Final project persistence failed for ${projectId}:`, error);
      });
    };
    void run.then(clearRun, clearRun);
  },

  async cancelPrompt(projectId: string, generationId?: string): Promise<boolean> {
    const record = localProjectStore.getRecord(projectId);
    const currentGenerationId = record?.activeGenerationId;
    if (!record || record.status !== "init" || !currentGenerationId ||
        (generationId && generationId !== currentGenerationId)) return false;
    const currentRun = sharedAgentRunState.controllers.get(projectId);
    if (currentRun?.generationId !== currentGenerationId) return false;
    localProjectStore.update(projectId, { cancellationRequestedAt: new Date().toISOString() });
    currentRun.controller.abort(new GenerationCancelledError());
    await e2bSandboxManager.cancelBuild(projectId);
    const latest = localProjectStore.getRecord(projectId);
    if (latest?.activeGenerationId !== currentGenerationId) return false;
    localProjectStore.update(projectId, {
      status: "done",
      conversation: [...latest.conversation, {
        author: "agent",
        message: "Generation stopped. No further files, build, or preview will be started.",
        messageType: "finished",
        createdAt: new Date().toISOString(),
        generationEvent: { type: "generation_cancelled", status: "cancelled", generationId: currentGenerationId },
      }],
    });
    await localProjectStore.flush(projectId);
    // Wait for the aborted worker to restore its previous source before the UI
    // confirms Stop or allows another generation to enter this workspace.
    await sharedAgentRunState.runs.get(projectId);
    await localProjectStore.flush(projectId);
    return true;
  },
};

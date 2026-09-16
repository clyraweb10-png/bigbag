import { localProjectStore } from "./project-store";
import { localFileManager } from "./file-manager";
import { localSandboxManager } from "./sandbox-manager";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { multiModelRouter } from "./multi-model-router";
import { autoInstallDependencies } from "./dependency-scanner";
import { isCompleteHtmlDocument, purgeInvalidStaticHtml } from "./starter-template";
import type { ConversationMessage } from "@/lib/vcaas-types";
import { withDesignSystemPrompt } from "@/lib/design-system-prompt";

const SYSTEM_PROMPT = `You are an expert full-stack web developer AI. Build complete web apps using Next.js (App Router), React 19, TypeScript, and Tailwind CSS 4.

## CRITICAL RULES

**OUTPUT FORMAT: You MUST output ONLY file blocks. Do NOT write explanations, plans, or thinking. Start your response IMMEDIATELY with the first file block. No prose before, between, or after code blocks.**

1. "use client" — Add as FIRST LINE for any .tsx/.jsx using React hooks (useState, useEffect, etc.) or browser APIs. src/app/ files are Server Components by default. layout.tsx is ALWAYS a Server Component — NO hooks.

2. Output Format — Each file with markdown heading + code block:
### File: src/app/page.tsx
\`\`\`tsx
'use client';
import { useState } from 'react';
// code
\`\`\`

3. Dependencies — Preinstalled and ready: react, react-dom (v19), next, tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, gsap, zustand, recharts, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, sonner. Prefer these. Also use @/components/ui/button, @/components/ui/card, and @/lib/utils (cn) — they already exist.

4. Styling — Tailwind utility classes ONLY. NO styled-jsx, CSS modules, or inline styles. Use @import "tailwindcss" in globals.css (NOT @tailwind directives). All CSS properties MUST be inside a selector — never place bare properties at the top level.

5. Structure — src/app/page.tsx (main), src/app/layout.tsx (root layout), src/app/globals.css, src/components/*.tsx. Add 'use client' to components using hooks.

6. Quality — Complete working code. No placeholders. TypeScript. Export default functions. Responsive, polished UI. Semantic HTML.

7. DON'T — NO react-dom/client imports. NO require(). NO external images/fonts (use gradients or lucide-react icons). NO package.json/next.config/tsconfig/postcss output. NO layout.tsx unless requested. NO explanatory text — ONLY code files. **NEVER output standalone HTML files like index.html** — always build inside src/app/page.tsx as a React component. **NEVER copy JSX such as \`{children}\` into an HTML file.**
`;

const RETRY_PROMPT = `Your previous response did not contain valid code files. You MUST respond with ONLY code file blocks in this exact format — no explanations, no thinking, no plans:

### File: src/app/page.tsx
\`\`\`tsx
// complete code here
\`\`\`

Start your response with the first ### File: heading immediately. Generate the complete application now.`;


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

  // Pattern 4: Standalone HTML document ONLY — never JSX from layout.tsx
  const hasHtmlTag = text.includes("<!DOCTYPE html") || /<html[\s>]/i.test(text);
  const hasPublicIndex = files.some((f) => f.path.includes("index.html"));
  const alreadyHasReactApp = files.some(
    (f) => f.path.includes("page.tsx") || f.path.includes("layout.tsx")
  );

  if (!hasPublicIndex && hasHtmlTag && !alreadyHasReactApp) {
    let htmlStart = text.indexOf("<!DOCTYPE html");
    if (htmlStart === -1) htmlStart = text.search(/<html[\s>]/i);

    let htmlEnd = text.lastIndexOf("</html>");
    let htmlContent = "";
    if (htmlEnd !== -1 && htmlEnd > htmlStart) {
      htmlContent = text.slice(htmlStart, htmlEnd + 7).trim();
    } else {
      let raw = text.slice(htmlStart);
      const fenceEnd = raw.indexOf("```");
      if (fenceEnd !== -1) raw = raw.slice(0, fenceEnd);
      raw = raw.trim();
      if (!raw.includes("</body>")) raw += "\n</body>";
      if (!raw.includes("</html>")) raw += "\n</html>";
      htmlContent = raw;
    }

    if (isCompleteHtmlDocument(htmlContent)) {
      files.push({
        path: "public/index.html",
        content: htmlContent,
      });
    }
  }

  // If public/index.html exists but no src/app/page.tsx, automatically generate the preview iframe
  const hasPageTsx = files.some((f) => f.path.includes("page.tsx") || f.path.includes("page.jsx"));
  const hasHtmlFile = files.some((f) => f.path.endsWith(".html"));
  if (hasHtmlFile && !hasPageTsx) {
    files.push({
      path: "src/app/page.tsx",
      content: `'use client';

export default function Home() {
  return (
    <iframe
      src="/index.html"
      className="fixed inset-0 w-screen h-screen border-none m-0 p-0"
      style={{ width: '100vw', height: '100vh', border: 'none', overflow: 'auto' }}
    />
  );
}
`,
    });
  }

  // Pattern 5: Single raw TSX/JSX code fence without file annotations
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
  // Drop JSX fragments that were mis-labelled as HTML
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file.path.endsWith(".html") && !isCompleteHtmlDocument(file.content)) {
      console.log(`[localAgentEngine] Dropped invalid HTML dump: ${file.path}`);
      files.splice(i, 1);
    }
  }

  // Remap root-level HTML files to public/ so Next.js static serving works
  for (const file of files) {
    if (file.path === "index.html" || file.path === "./index.html") {
      file.path = "public/index.html";
      console.log(`[localAgentEngine] Remapped index.html → public/index.html for Next.js static serving`);
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

function autoHealMissingImports(projectId: string, newMessages: ConversationMessage[]): void {
  const pageFile = localFileManager.getContent(projectId, "src/app/page.tsx");
  if (!pageFile?.content) return;

  const content = pageFile.content;
  const importRegex = /import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from\s+['"](?:@\/components\/|\.\/components\/|\.\.\/components\/)([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const namedImports = match[1]
      ? match[1].split(",").map((s: string) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      : [];
    const defaultImport = match[2] ? match[2].trim() : null;
    const componentPath = match[3];

    let targetRelPath = `src/components/${componentPath}`;
    if (!targetRelPath.endsWith(".tsx") && !targetRelPath.endsWith(".ts")) {
      targetRelPath += ".tsx";
    }

    const existing = localFileManager.getContent(projectId, targetRelPath);
    if (!existing) {
      console.log(`[localAgentEngine] Auto-healing missing component: ${targetRelPath}`);
      const componentNames = defaultImport ? [defaultImport, ...namedImports] : namedImports;
      const primaryName = componentNames[0] || "Section";

      let stubExports = "";
      for (const name of componentNames) {
        stubExports += `
export function ${name}() {
  return (
    <section className="py-16 px-6 max-w-7xl mx-auto text-center border-t border-slate-800/60">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-medium mb-4">
        ${name}
      </div>
      <h3 className="text-2xl font-bold text-white mb-2">${name}</h3>
      <p className="text-slate-400 max-w-lg mx-auto text-sm">
        Customizable component ready for additional features.
      </p>
    </section>
  );
}
`;
      }

      const fileContent = `'use client';
import React from 'react';
${stubExports}
export default ${primaryName};
`;
      localFileManager.writeContent(projectId, targetRelPath, fileContent, "utf8");
      newMessages.push({
        author: "agent",
        message: `Created component \`${targetRelPath}\``,
        messageType: "building",
        createdAt: new Date().toISOString(),
      });
    }
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

    // Ensure template exists
    localSandboxManager.ensureProjectTemplate(projectId);
    localSandboxManager.startDevServer(projectId).catch(console.error);

    // Run async in background
    (async () => {
      try {
        const providers = multiModelRouter.getProviders();
        if (providers.length === 0) {
          const warnMsg: ConversationMessage = {
            author: "agent",
            message:
              "⚠️ No AI API keys found in `.env.local`.\n\nPlease add your API keys to `.env.local` to enable full autonomous code generation. In the meantime, the starter template has been loaded and is running live in the preview sandbox!",
            messageType: "finished",
            createdAt: new Date().toISOString(),
          };
          localProjectStore.update(projectId, {
            status: "done",
            conversation: [...conversation, warnMsg],
          });
          return;
        }

        // Include existing code context if iterating on an existing project
        let userPromptContent = prompt;
        const existingPage = localFileManager.getContent(projectId, "src/app/page.tsx");
        const pageCode = existingPage?.content || "";
        if (
          pageCode &&
          !pageCode.includes("AI is assembling your application") &&
          !pageCode.includes("Ready for Prompt") &&
          !pageCode.includes("Generation Issue")
        ) {
          // Limit context to first 2000 characters to reduce token usage and speed up generation
          const truncatedCode = pageCode.length > 2000 ? pageCode.substring(0, 2000) + "\n... (truncated)" : pageCode;
          userPromptContent = `Current code (truncated): \n\`\`\`tsx\n${truncatedCode}\n\`\`\`\n\nUser Request: ${prompt}\n\nPlease update or enhance the application to fulfill this request.`;
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
        const hasPlaceholder = files.some(f =>
          f.content.includes("Generation Issue") && f.content.includes("Awaiting Retry")
        );

        // Auto-retry if no files extracted or all files are placeholders
        if (files.length === 0 || (files.length === 1 && hasPlaceholder)) {
          console.log(`[localAgentEngine] No valid code generated, auto-retrying...`);

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

            const retryHasPlaceholder = retryFiles.some(f =>
              f.content.includes("Generation Issue") && f.content.includes("Awaiting Retry")
            );

            if (retryFiles.length > 0 && !retryHasPlaceholder) {
              files = retryFiles;
              console.log(`[localAgentEngine] Retry succeeded: ${retryFiles.length} files extracted`);
            } else {
              console.warn(`[localAgentEngine] Retry also failed, using placeholder`);
            }
          } catch (retryErr: any) {
            console.error(`[localAgentEngine] Retry failed:`, retryErr.message || retryErr);
          }
        }

        const currentRec = localProjectStore.getRecord(projectId);
        const newMessages: ConversationMessage[] = [...(currentRec?.conversation || [])];

        if (files.length > 0) {
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

            // Sync file to E2B cloud sandbox if active
            e2bSandboxManager.syncFile(projectId, file.path, fileContent).catch(() => {});

            newMessages.push({
              author: "agent",
              message: `Created file \`${file.path}\``,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
          }
        } else {
          // Fallback: if no structured files extracted, detect whether content is HTML or React
          if (content.includes("<!DOCTYPE html") || content.includes("<html")) {
            let html = content;
            const fenceMatch = /```(?:html)?\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(content);
            if (fenceMatch) html = fenceMatch[1];
            if (!html.includes("</body>")) html += "\n</body>";
            if (!html.includes("</html>")) html += "\n</html>";
            if (isCompleteHtmlDocument(html.trim())) {
              localFileManager.writeContent(projectId, "public/index.html", html.trim(), "utf8");
              const iframePage = `'use client';\n\nexport default function Home() {\n  return (\n    <iframe\n      src="/index.html"\n      className="fixed inset-0 w-screen h-screen border-none m-0 p-0"\n      style={{ width: '100vw', height: '100vh', border: 'none', overflow: 'auto' }}\n    />\n  );\n}\n`;
              localFileManager.writeContent(projectId, "src/app/page.tsx", iframePage, "utf8");
              e2bSandboxManager.syncFile(projectId, "public/index.html", html.trim()).catch(() => {});
              e2bSandboxManager.syncFile(projectId, "src/app/page.tsx", iframePage).catch(() => {});
              newMessages.push({
                author: "agent",
                message: "Generated `public/index.html` and live preview frame",
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
          } else if (content.includes("export default") || content.includes("return (") || content.includes("function")) {
            const cleanCode = content.replace(/^```[a-z]*\s*[\r\n]/i, "").replace(/```\s*$/i, "").trim();
            localFileManager.writeContent(projectId, "src/app/page.tsx", cleanCode, "utf8");
            e2bSandboxManager.syncFile(projectId, "src/app/page.tsx", cleanCode).catch(() => {});
            newMessages.push({
              author: "agent",
              message: "Updated `src/app/page.tsx`",
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
          }
        }

        // Auto-heal any components imported in page.tsx that were omitted by the AI
        autoHealMissingImports(projectId, newMessages);

        purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));

        // Auto-detect and install any third-party npm packages used by the AI
        const allFiles = files.length > 0 ? files : [];
        const existingPageForDeps = localFileManager.getContent(projectId, "src/app/page.tsx");
        if (existingPageForDeps?.content && !allFiles.some(f => f.path.includes("page.tsx"))) {
          allFiles.push({ path: "src/app/page.tsx", content: existingPageForDeps.content });
        }
        if (allFiles.length > 0) {
          try {
            const depResult = autoInstallDependencies(allFiles, process.cwd());
            if (depResult.installed.length > 0) {
              newMessages.push({
                author: "agent",
                message: `Auto-installed dependencies: ${depResult.installed.join(", ")}`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
            if (depResult.failed.length > 0) {
              newMessages.push({
                author: "agent",
                message: `⚠️ Could not install: ${depResult.failed.join(", ")}`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
          } catch (depErr: any) {
            console.error("[localAgentEngine] Dependency auto-install error:", depErr);
          }
        }

        const finishMsg: ConversationMessage = {
          author: "agent",
          message:
            files.length > 0
              ? `Application generated successfully! Generated ${files.length} files. Live preview is updated.`
              : "Application updated. Live preview is updated.",
          messageType: "finished",
          createdAt: new Date().toISOString(),
        };

        newMessages.push(finishMsg);

        localProjectStore.update(projectId, {
          status: "done",
          conversation: newMessages,
        });

        // Ensure dev server is up and update preview URL
        try {
          const previewUrl = await e2bSandboxManager.startDevServer(projectId);
          console.log(`[localAgentEngine] Sandbox confirmed ready for ${projectId}, preview: ${previewUrl}`);
          
          // Update project record with current preview URL
          localProjectStore.update(projectId, {
            previewUrl: previewUrl.includes("http") ? previewUrl : `/api/preview/${projectId}`,
            serverStatus: "Active"
          });
        } catch (sandboxErr) {
          console.error(`[localAgentEngine] Sandbox startup failed:`, sandboxErr);
          // Try local fallback
          try {
            await localSandboxManager.startDevServer(projectId);
            localProjectStore.update(projectId, {
              previewUrl: `/api/preview/${projectId}`,
              serverStatus: "Active"
            });
          } catch (localErr) {
            console.error(`[localAgentEngine] Local sandbox also failed:`, localErr);
          }
        }
      } catch (err: any) {
        console.error("[localAgentEngine error]", err);
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
        });
      }
    })();
  },
};

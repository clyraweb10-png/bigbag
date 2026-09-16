import fs from "fs";
import path from "path";

/**
 * Packages every generated app can import without waiting on npm.
 * They are installed on the platform itself; each workspace `node_modules`
 * is a junction/symlink to that shared tree (Lovable-style preinstall).
 */
export const PREINSTALLED_DEPENDENCIES: Record<string, string> = {
  react: "^19.0.0",
  "react-dom": "^19.0.0",
  "lucide-react": "^0.536.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.3.1",
  "class-variance-authority": "^0.7.1",
  "framer-motion": "^13.3.0",
  gsap: "^3.15.0",
  zustand: "^5.0.15",
  recharts: "^3.10.1",
  "date-fns": "^4.4.0",
  axios: "^1.20.0",
  "@tanstack/react-query": "^5.102.8",
  "canvas-confetti": "^1.9.4",
  "usehooks-ts": "^3.1.1",
  "embla-carousel-react": "^8.6.0",
  "@radix-ui/react-slot": "^1.2.3",
  "react-hook-form": "^7.62.0",
  sonner: "^2.0.7",
  "@libsql/client": "^0.14.0",
};

export const PREINSTALLED_DEV_DEPENDENCIES: Record<string, string> = {
  vite: "^5.4.21",
  "@vitejs/plugin-react": "^4.7.0",
  typescript: "^5.8.0",
  "@types/node": "^22.0.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
  tailwindcss: "^4.1.1",
  "@tailwindcss/postcss": "^4.1.4",
  postcss: "^8.5.6",
};

export const ALWAYS_AVAILABLE_PACKAGES = new Set([
  ...Object.keys(PREINSTALLED_DEPENDENCIES),
  ...Object.keys(PREINSTALLED_DEV_DEPENDENCIES),
]);

function write(dir: string, relative: string, content: string) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function writeIfMissing(dir: string, relative: string, content: string): void {
  const full = path.join(dir, relative);
  if (!fs.existsSync(full)) write(dir, relative, content);
}

function readLayoutMetadata(
  dir: string,
  projectId: string
): { title: string; description: string } {
  const defaults = {
    title: projectId,
    description: "Built with AI App Builder",
  };
  try {
    const layout = fs.readFileSync(path.join(dir, "src/app/layout.tsx"), "utf-8");
    return {
      title: layout.match(/\btitle\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] || defaults.title,
      description:
        layout.match(/\bdescription\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ||
        defaults.description,
    };
  } catch {
    return defaults;
  }
}

/**
 * Keep older generated Next workspaces previewable without rewriting the user's
 * page. Vite mounts the existing `src/app/page.tsx` directly and uses a fraction
 * of the memory required by `next dev` in the small E2B VM.
 */
function ensureViteRuntime(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    // A malformed package file is repaired below while preserving source files.
  }

  const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, string>;
  const dependencies = (pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {}) as Record<string, string>;
  const devDependencies = (pkg.devDependencies && typeof pkg.devDependencies === "object" ? pkg.devDependencies : {}) as Record<string, string>;

  pkg = {
    ...pkg,
    name: typeof pkg.name === "string" ? pkg.name : projectId,
    version: typeof pkg.version === "string" ? pkg.version : "0.1.0",
    private: true,
    scripts: {
      ...scripts,
      dev: "vite --host 0.0.0.0",
      build: "vite build",
      preview: "vite preview --host 0.0.0.0",
    },
    dependencies: {
      ...PREINSTALLED_DEPENDENCIES,
      ...dependencies,
    },
    devDependencies: {
      ...PREINSTALLED_DEV_DEPENDENCIES,
      ...devDependencies,
    },
  };
  write(dir, "package.json", JSON.stringify(pkg, null, 2));

  const postcssConfig = `import tailwindcss from "@tailwindcss/postcss";

export default {
  plugins: [tailwindcss()],
};
`;
  const postcssPath = path.join(dir, "postcss.config.mjs");
  if (!fs.existsSync(postcssPath)) {
    write(dir, "postcss.config.mjs", postcssConfig);
  } else {
    const currentPostcss = fs.readFileSync(postcssPath, "utf-8");
    // Tailwind 4 rejects the legacy direct `tailwindcss` PostCSS plugin. Repair
    // only that known-incompatible migration case; preserve every other custom
    // or generated configuration.
    if (
      /(?:from\s+["']tailwindcss["']|\btailwindcss\s*:)/.test(currentPostcss) &&
      !currentPostcss.includes("@tailwindcss/postcss")
    ) {
      write(dir, "postcss.config.mjs", postcssConfig);
    }
  }

  writeIfMissing(dir, "src/app/globals.css", `@import "tailwindcss";\n`);

  writeIfMissing(
    dir,
    "index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#09090b" />
    <title>${projectId}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  );

  writeIfMissing(
    dir,
    "vite.config.ts",
    `import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: [".e2b.app"] },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
`
  );

  const metadata = readLayoutMetadata(dir, projectId);
  writeIfMissing(
    dir,
    "src/main.tsx",
    `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/page";
import "./app/globals.css";

document.title = ${JSON.stringify(metadata.title)};
let descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (!descriptionMeta) {
  descriptionMeta = document.createElement("meta");
  descriptionMeta.name = "description";
  document.head.appendChild(descriptionMeta);
}
descriptionMeta.content = ${JSON.stringify(metadata.description)};

const fallbackImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1000' viewBox='0 0 1600 1000'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23dedbd4'/%3E%3Cstop offset='1' stop-color='%238b877f'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1600' height='1000' fill='url(%23g)'/%3E%3Cpath d='M0 760L430 390l230 205 220-175 720 580H0Z' fill='%23181715' opacity='.28'/%3E%3C/svg%3E";

document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallbackApplied !== "true") {
    image.dataset.fallbackApplied = "true";
    image.src = fallbackImage;
  }
}, true);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`
  );
}

/** Seed a Lovable-style Vite + React + Tailwind app. Idempotent. */
export function writeStarterTemplate(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    ensureViteRuntime(dir, projectId);
    return;
  }

  write(
    dir,
    "package.json",
    JSON.stringify(
      {
        name: projectId,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "vite --host 0.0.0.0",
          build: "vite build",
          preview: "vite preview --host 0.0.0.0",
        },
        dependencies: PREINSTALLED_DEPENDENCIES,
        devDependencies: PREINSTALLED_DEV_DEPENDENCIES,
      },
      null,
      2
    )
  );

  write(
    dir,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src", "vite.config.ts"],
        exclude: ["node_modules"],
      },
      null,
      2
    )
  );

  write(
    dir,
    "src/app/globals.css",
    `@import "tailwindcss";

:root {
  --background: 248 250 252;
  --foreground: 15 23 42;
  --primary: 79 70 229;
  --primary-foreground: 255 255 255;
  --muted: 241 245 249;
  --muted-foreground: 100 116 139;
  --border: 226 232 240;
  --ring: 79 70 229;
}

body {
  color: rgb(var(--foreground));
  background: rgb(var(--background));
  min-height: 100vh;
}

@theme inline {
  --color-background: rgb(var(--background));
  --color-foreground: rgb(var(--foreground));
  --color-primary: rgb(var(--primary));
  --color-primary-foreground: rgb(var(--primary-foreground));
  --color-muted: rgb(var(--muted));
  --color-muted-foreground: rgb(var(--muted-foreground));
  --color-border: rgb(var(--border));
  --color-ring: rgb(var(--ring));
}
`
  );

  write(
    dir,
    "src/app/layout.tsx",
    `import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '${projectId}',
  description: 'Built with AI App Builder',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`
  );

  write(
    dir,
    "src/app/page.tsx",
    `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-md p-8 bg-slate-900/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-800">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-white mb-2">
          ${projectId}
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          AI is assembling your application. Preview will update live as files are generated.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
          Ready for Prompt
        </div>
      </div>
    </main>
  );
}
`
  );

  write(
    dir,
    "src/lib/utils.ts",
    `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`
  );

  write(
    dir,
    "src/lib/db.ts",
    `import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const localDbPath = path.join(dataDir, "app.db").replace(/\\\\/g, "/");
const url = process.env.TURSO_DATABASE_URL || \`file:\${localDbPath}\`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({
  url,
  authToken,
});

export default db;
`
  );

  write(
    dir,
    "src/components/ui/button.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-indigo-600 text-white hover:bg-indigo-500",
        variant === "outline" && "border border-slate-300 bg-white hover:bg-slate-50 text-slate-900",
        variant === "ghost" && "hover:bg-slate-100 text-slate-900",
        variant === "secondary" && "bg-slate-100 text-slate-900 hover:bg-slate-200",
        size === "default" && "h-10 px-4 py-2",
        size === "sm" && "h-9 px-3",
        size === "lg" && "h-11 px-8",
        size === "icon" && "h-10 w-10",
        className
      )}
      {...props}
    />
  );
}
`
  );

  write(
    dir,
    "src/components/ui/card.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-slate-500", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
`
  );

  ensureViteRuntime(dir, projectId);
}

/** True when a file is a JSX/TSX snippet, not a real HTML document. */
export function isJsxHtmlSnippet(content: string): boolean {
  return (
    /\{children\}/.test(content) ||
    /className=\{/.test(content) ||
    /import\s+.+from\s+['"]next/.test(content) ||
    /export\s+default\s+function/.test(content)
  );
}

export function isCompleteHtmlDocument(content: string): boolean {
  const trimmed = content.trim();
  if (isJsxHtmlSnippet(trimmed)) return false;
  if (trimmed.length < 80) return false;
  const hasDoctype = /<!DOCTYPE html/i.test(trimmed);
  const hasHtml = /<html[\s>]/i.test(trimmed);
  const hasBody = /<body[\s>]/i.test(trimmed);
  return (hasDoctype || hasHtml) && hasBody && !/\{[a-zA-Z_][\w.]*\}/.test(trimmed);
}

/** Remove JSX dumps that were wrongly saved as public/index.html. */
export function purgeInvalidStaticHtml(dir: string): void {
  for (const rel of ["public/index.html", "index.html"]) {
    const full = path.join(/* turbopackIgnore: true */ dir, rel);
    if (!fs.existsSync(/* turbopackIgnore: true */ full)) continue;
    try {
      const content = fs.readFileSync(/* turbopackIgnore: true */ full, "utf-8");
      if (!isCompleteHtmlDocument(content)) {
        fs.unlinkSync(full);
        console.log(`[starter-template] Removed invalid static HTML: ${rel}`);
      }
    } catch {
      // ignore
    }
  }
}

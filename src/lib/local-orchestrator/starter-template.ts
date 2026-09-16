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
  next: "^16.0.0",
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
};

export const PREINSTALLED_DEV_DEPENDENCIES: Record<string, string> = {
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

/** Seed a Lovable-style Next.js + Tailwind + shadcn-lite app. Idempotent. */
export function writeStarterTemplate(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) return;

  write(
    dir,
    "package.json",
    JSON.stringify(
      {
        name: projectId,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
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
    "next.config.mjs",
    `/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};
export default nextConfig;
`
  );

  write(
    dir,
    "postcss.config.mjs",
    `const config = {
  plugins: ['@tailwindcss/postcss'],
};
export default config;
`
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
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./src/*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2
    )
  );

  write(
    dir,
    "next-env.d.ts",
    `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`
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

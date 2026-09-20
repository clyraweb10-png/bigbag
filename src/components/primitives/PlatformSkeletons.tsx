import { SkeletonBox, SkeletonText } from "./Skeletons";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PLATFORM SKELETON SCREENS & ELEMENT PRELOADERS
 * 
 * High-fidelity skeletons matching exact platform component layouts.
 * Seamlessly adapts to light and dark modes with luminous shimmer sheen.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Single project card skeleton matching dashboard project cards in page.tsx */
export function SkeletonProjectCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-colors",
        className
      )}
    >
      {/* Thumbnail placeholder with 16:9 aspect ratio */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
        <SkeletonBox className="h-full w-full rounded-none border-0" />
      </div>

      {/* Card meta */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBox className="h-4 w-3/4 rounded-md" />
            <SkeletonBox className="h-3 w-1/3 rounded-sm opacity-80" />
          </div>
          <SkeletonBox className="size-7 shrink-0 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Grid of project cards */
export function SkeletonProjectGrid({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}
      role="status"
      aria-label="Loading projects"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonProjectCard key={i} />
      ))}
    </div>
  );
}

/** Table row skeleton matching dashboard table view */
export function SkeletonProjectTableRow() {
  return (
    <tr className="border-b border-border/60">
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-3">
          <SkeletonBox className="size-9 shrink-0 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <SkeletonBox className="h-3.5 w-36" />
            <SkeletonBox className="h-2.5 w-24 opacity-75" />
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-3 sm:table-cell">
        <SkeletonBox className="h-3 w-28" />
      </td>
      <td className="hidden px-3 py-3 md:table-cell">
        <SkeletonBox className="h-3 w-20" />
      </td>
      <td className="py-3 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <SkeletonBox className="size-7 rounded-lg" />
        </div>
      </td>
    </tr>
  );
}

/** Table view skeleton for dashboard */
export function SkeletonProjectTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="py-3 pl-4 pr-3 font-medium">Project</th>
              <th className="hidden px-3 py-3 font-medium sm:table-cell">Identifier</th>
              <th className="hidden px-3 py-3 font-medium md:table-cell">Updated</th>
              <th className="py-3 pl-3 pr-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {Array.from({ length: rows }).map((_, i) => (
              <SkeletonProjectTableRow key={i} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Full Dashboard Screen Preloader */
export function SkeletonDashboard({ viewMode = "cards" }: { viewMode?: "cards" | "table" }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Dashboard Header Bar */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <SkeletonBox className="h-8 w-28 rounded-xl" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-8 w-8 rounded-full" />
            <SkeletonBox className="h-9 w-32 rounded-full" />
          </div>
        </div>
      </header>

      {/* Main Dashboard Body */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {/* Hero Prompt Box Skeleton */}
        <div className="mx-auto mb-10 max-w-2xl text-center space-y-4">
          <div className="space-y-2 flex flex-col items-center">
            <SkeletonBox className="h-7 w-64 rounded-lg" />
            <SkeletonBox className="h-4 w-80 rounded-md opacity-75" />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm text-left space-y-4">
            <SkeletonBox className="h-20 w-full rounded-xl opacity-60" />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <SkeletonBox className="h-7 w-18 rounded-lg" />
                <SkeletonBox className="h-7 w-20 rounded-lg" />
              </div>
              <SkeletonBox className="size-8 rounded-full" />
            </div>
          </div>
        </div>

        {/* Projects Toolbar Skeleton */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SkeletonBox className="h-5 w-24 rounded-md" />
            <SkeletonBox className="h-5 w-8 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-9 w-48 rounded-xl" />
            <SkeletonBox className="h-9 w-24 rounded-xl" />
            <SkeletonBox className="h-9 w-18 rounded-xl" />
          </div>
        </div>

        {/* Project List */}
        {viewMode === "table" ? <SkeletonProjectTable rows={4} /> : <SkeletonProjectGrid count={3} />}
      </main>
    </div>
  );
}

/** Simulated Application Preview (used inside PreviewPanel during initial build & iframe load) */
export function SkeletonAppPreview({ className, mobile = false }: { className?: string; mobile?: boolean }) {
  return (
    <div
      className={cn(
        "h-full w-full bg-background flex flex-col overflow-hidden select-none",
        mobile ? "p-3" : "p-6 sm:p-8",
        className
      )}
    >
      {/* App Navbar Skeleton */}
      <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-6">
        <div className="flex items-center gap-2.5">
          <SkeletonBox className="size-7 rounded-lg" />
          <SkeletonBox className="h-4 w-24 rounded" />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <SkeletonBox className="h-3 w-14 rounded" />
          <SkeletonBox className="h-3 w-14 rounded" />
          <SkeletonBox className="h-3 w-14 rounded" />
        </div>
        <SkeletonBox className="h-7 w-20 rounded-lg" />
      </div>

      {/* App Hero Skeleton */}
      <div className="space-y-4 max-w-xl mb-8">
        <SkeletonBox className="h-5 w-32 rounded-full" />
        <SkeletonBox className="h-8 sm:h-10 w-4/5 rounded-xl" />
        <SkeletonBox className="h-4 w-full rounded-md opacity-80" />
        <SkeletonBox className="h-4 w-2/3 rounded-md opacity-70" />
        <div className="flex items-center gap-3 pt-2">
          <SkeletonBox className="h-9 w-28 rounded-xl" />
          <SkeletonBox className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* App Content Cards Grid */}
      <div className={cn("grid gap-4 flex-1", mobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
            <SkeletonBox className="size-8 rounded-lg" />
            <SkeletonBox className="h-4 w-3/4 rounded" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full Workspace Screen Preloader (/project/[projectId]) */
export function SkeletonWorkspace() {
  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Workspace Header Bar */}
      <header className="h-12 shrink-0 border-b border-border bg-card px-3 flex items-center justify-between gap-2 z-30">
        {/* Left: back button, logo, project id */}
        <div className="flex items-center gap-2 min-w-0">
          <SkeletonBox className="size-7 rounded-lg" />
          <SkeletonBox className="h-6 w-20 rounded-md hidden sm:block" />
          <div className="h-4 w-px bg-border/80 mx-1 hidden sm:block" />
          <SkeletonBox className="h-6 w-32 rounded-lg" />
        </div>

        {/* Center: Tabs switcher */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50">
          <SkeletonBox className="h-7 w-18 rounded-lg" />
          <SkeletonBox className="h-7 w-16 rounded-lg" />
          <SkeletonBox className="h-7 w-20 rounded-lg" />
        </div>

        {/* Right: Actions, Deploy, Theme, Avatar */}
        <div className="flex items-center gap-1.5">
          <div className="hidden md:flex items-center gap-1">
            <SkeletonBox className="h-7 w-18 rounded-lg" />
            <SkeletonBox className="h-7 w-18 rounded-lg" />
            <SkeletonBox className="h-7 w-18 rounded-lg" />
          </div>
          <SkeletonBox className="h-7 w-20 rounded-lg" />
          <SkeletonBox className="size-7 rounded-full" />
          <SkeletonBox className="size-7 rounded-full" />
        </div>
      </header>

      {/* Split Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Panel Skeleton */}
        <div className="w-full md:w-[420px] lg:w-[460px] shrink-0 border-r border-border bg-card flex flex-col">
          {/* Messages Area */}
          <div className="flex-1 p-4 space-y-4 overflow-hidden">
            {/* Assistant message 1 */}
            <div className="flex items-start gap-3">
              <SkeletonBox className="size-8 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1 rounded-2xl rounded-tl-md border border-border bg-muted/30 p-3.5">
                <SkeletonBox className="h-4 w-1/3 rounded" />
                <SkeletonText lines={2} />
              </div>
            </div>

            {/* User message */}
            <div className="flex items-start justify-end gap-3 pl-8">
              <div className="space-y-2 flex-1 rounded-2xl rounded-tr-md border border-primary/20 bg-primary/5 p-3.5">
                <SkeletonBox className="h-4 w-4/5 rounded" />
              </div>
              <SkeletonBox className="size-8 rounded-full shrink-0" />
            </div>

            {/* Assistant response */}
            <div className="flex items-start gap-3">
              <SkeletonBox className="size-8 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1 rounded-2xl rounded-tl-md border border-border bg-muted/30 p-3.5">
                <SkeletonBox className="h-4 w-2/3 rounded" />
                <SkeletonText lines={3} />
              </div>
            </div>
          </div>

          {/* Bottom Chat Composer Box */}
          <div className="p-3 border-t border-border/80">
            <div className="rounded-2xl border border-border bg-background p-3 space-y-3">
              <SkeletonBox className="h-12 w-full rounded-lg opacity-60" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SkeletonBox className="h-6 w-14 rounded-md" />
                  <SkeletonBox className="h-6 w-14 rounded-md" />
                  <SkeletonBox className="h-6 w-14 rounded-md" />
                </div>
                <SkeletonBox className="size-7 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview Panel Skeleton */}
        <div className="hidden md:flex flex-1 flex-col bg-background overflow-hidden">
          {/* Preview Address Bar */}
          <div className="h-10 border-b border-border/80 bg-muted/20 px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SkeletonBox className="size-6 rounded-md" />
              <SkeletonBox className="h-6 w-52 rounded-lg" />
            </div>
            <div className="flex items-center gap-1.5">
              <SkeletonBox className="h-6 w-16 rounded-md" />
              <SkeletonBox className="size-6 rounded-md" />
            </div>
          </div>

          {/* Preview Viewport */}
          <div className="flex-1 p-6 flex items-center justify-center">
            <div className="h-full w-full rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <SkeletonAppPreview />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Monaco IDE / Code Panel Skeleton */
export function SkeletonCodeEditor({ hideSidebar = false }: { hideSidebar?: boolean }) {
  return (
    <div className="h-full w-full flex bg-[#1e1e1e] text-zinc-300 font-mono text-xs overflow-hidden select-none">
      {/* File Tree Sidebar */}
      {!hideSidebar && (
        <div className="w-56 shrink-0 border-r border-zinc-800 bg-[#181818] p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <SkeletonBox className="h-3 w-16 rounded-sm bg-zinc-800 border-0" />
            <SkeletonBox className="size-4 rounded-sm bg-zinc-800 border-0" />
          </div>
          {/* File items */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 px-1">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-20 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 pl-4">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-28 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 pl-4">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-24 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 px-1">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-16 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 pl-4">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-32 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 pl-4">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-20 rounded-sm bg-zinc-800 border-0" />
            </div>
            <div className="flex items-center gap-2 px-1">
              <SkeletonBox className="size-3.5 rounded-sm bg-zinc-800 border-0" />
              <SkeletonBox className="h-3 w-24 rounded-sm bg-zinc-800 border-0" />
            </div>
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="flex-1 flex flex-col bg-[#1e1e1e]">
        {/* Tab Header Bar */}
        <div className="h-9 border-b border-zinc-800 bg-[#181818] px-3 flex items-center justify-between">
          <div className="flex items-center gap-2 bg-[#1e1e1e] px-3 py-1.5 rounded-t border-t-2 border-primary">
            <SkeletonBox className="size-3.5 rounded-sm bg-zinc-700 border-0" />
            <SkeletonBox className="h-3 w-24 rounded-sm bg-zinc-700 border-0" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-6 w-16 rounded-md bg-zinc-800 border-0" />
            <SkeletonBox className="h-6 w-20 rounded-md bg-zinc-800 border-0" />
          </div>
        </div>

        {/* Code Lines with Line Numbers */}
        <div className="flex-1 p-4 overflow-hidden flex gap-4">
          {/* Gutter numbers */}
          <div className="w-6 shrink-0 text-right space-y-2 select-none opacity-30">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="text-[11px] leading-4">{i + 1}</div>
            ))}
          </div>
          {/* Simulated Code Lines */}
          <div className="flex-1 space-y-2 pt-0.5">
            <SkeletonBox className="h-3 w-64 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-80 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-48 bg-zinc-800/80 border-0 rounded-sm" />
            <div className="h-2" />
            <SkeletonBox className="h-3 w-72 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-96 ml-4 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-64 ml-4 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-80 ml-8 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-52 ml-8 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-36 ml-4 bg-zinc-800/80 border-0 rounded-sm" />
            <div className="h-2" />
            <SkeletonBox className="h-3 w-56 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-84 ml-4 bg-zinc-800/80 border-0 rounded-sm" />
            <SkeletonBox className="h-3 w-40 ml-4 bg-zinc-800/80 border-0 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Terminal / Console Logs Skeleton */
export function SkeletonTerminalLogs() {
  return (
    <div className="h-full w-full flex flex-col bg-zinc-950 font-mono text-xs rounded-xl overflow-hidden p-3 space-y-3">
      {/* Header controls */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-6 w-16 rounded-md bg-zinc-800 border-0" />
          <SkeletonBox className="h-6 w-16 rounded-md bg-zinc-800 border-0" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-6 w-36 rounded-md bg-zinc-800 border-0" />
          <SkeletonBox className="size-6 rounded-md bg-zinc-800 border-0" />
        </div>
      </div>

      {/* Log lines */}
      <div className="flex-1 space-y-2 overflow-hidden pt-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <SkeletonBox className="h-3 w-16 rounded-sm bg-zinc-800/60 border-0 shrink-0" />
            <SkeletonBox className="h-3.5 w-12 rounded-sm bg-zinc-700/60 border-0 shrink-0" />
            <SkeletonBox
              className={cn(
                "h-3 rounded-sm bg-zinc-800/80 border-0 flex-1",
                i % 3 === 0 ? "max-w-md" : i % 2 === 0 ? "max-w-lg" : "max-w-sm"
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Diff Viewer Skeleton */
export function SkeletonDiffViewer() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card space-y-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="space-y-1.5">
          <SkeletonBox className="h-4 w-44 rounded" />
          <SkeletonBox className="h-3 w-28 rounded opacity-75" />
        </div>
        <SkeletonBox className="h-7 w-20 rounded-lg" />
      </div>

      {/* Diff file container */}
      <div className="rounded-lg border border-border/70 overflow-hidden font-mono text-xs">
        <div className="bg-muted/60 px-3 py-2 border-b border-border flex items-center justify-between">
          <SkeletonBox className="h-3.5 w-48 rounded" />
          <div className="flex gap-2">
            <SkeletonBox className="h-3.5 w-10 rounded bg-emerald-500/20 border-0" />
            <SkeletonBox className="h-3.5 w-10 rounded bg-rose-500/20 border-0" />
          </div>
        </div>

        {/* Diff lines */}
        <div className="p-2 space-y-1.5 bg-background">
          <div className="flex items-center gap-2 py-0.5">
            <SkeletonBox className="h-3 w-8 bg-zinc-500/20 border-0" />
            <SkeletonBox className="h-3 w-72" />
          </div>
          <div className="flex items-center gap-2 py-0.5 bg-rose-500/10 px-1 rounded">
            <SkeletonBox className="h-3 w-8 bg-rose-500/30 border-0" />
            <SkeletonBox className="h-3 w-64 bg-rose-500/20 border-0" />
          </div>
          <div className="flex items-center gap-2 py-0.5 bg-emerald-500/10 px-1 rounded">
            <SkeletonBox className="h-3 w-8 bg-emerald-500/30 border-0" />
            <SkeletonBox className="h-3 w-80 bg-emerald-500/20 border-0" />
          </div>
          <div className="flex items-center gap-2 py-0.5">
            <SkeletonBox className="h-3 w-8 bg-zinc-500/20 border-0" />
            <SkeletonBox className="h-3 w-60" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** GitHub Status Skeleton for GithubModal */
export function SkeletonGithubModal() {
  return (
    <div className="space-y-4 py-2">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <SkeletonBox className="size-8 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <SkeletonBox className="h-4 w-40 rounded" />
            <SkeletonBox className="h-3 w-24 rounded opacity-75" />
          </div>
          <SkeletonBox className="h-6 w-16 rounded-full" />
        </div>
        <SkeletonBox className="h-10 w-full rounded-lg opacity-60" />
      </div>
      <div className="flex justify-end gap-2">
        <SkeletonBox className="h-8 w-24 rounded-lg" />
        <SkeletonBox className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}

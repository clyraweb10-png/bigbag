import { SkeletonBox, SkeletonText } from "@/components/primitives";

export default function GenerateLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border/70 px-4 py-3 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SkeletonBox className="size-8 rounded-lg" />
          <SkeletonBox className="h-6 w-24 rounded-lg" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBox className="size-8 rounded-full" />
          <SkeletonBox className="size-8 rounded-full" />
        </div>
      </header>

      {/* Conversation Skeleton */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 flex flex-col justify-between">
        <div className="space-y-6">
          {/* User prompt message */}
          <div className="flex items-start justify-end gap-3 pl-12">
            <div className="space-y-2 rounded-2xl rounded-tr-md border border-primary/25 bg-primary/5 p-4 flex-1">
              <SkeletonBox className="h-4 w-3/4" />
            </div>
            <SkeletonBox className="size-8 rounded-full shrink-0" />
          </div>

          {/* Assistant message */}
          <div className="flex items-start gap-3 pr-12">
            <SkeletonBox className="size-8 rounded-xl shrink-0" />
            <div className="space-y-3 rounded-2xl rounded-tl-md border border-border bg-card p-4 flex-1">
              <SkeletonBox className="h-4 w-1/2" />
              <SkeletonText lines={3} />
            </div>
          </div>
        </div>

        {/* Composer skeleton */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <SkeletonBox className="h-16 w-full rounded-xl opacity-60" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SkeletonBox className="h-7 w-16 rounded-lg" />
              <SkeletonBox className="h-7 w-20 rounded-lg" />
            </div>
            <SkeletonBox className="size-8 rounded-full" />
          </div>
        </div>
      </main>
    </div>
  );
}

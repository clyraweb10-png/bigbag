import { cn } from "@/lib/utils"

function Skeleton({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-xl bg-zinc-200/75 dark:bg-[#252525] border border-border/40",
        className
      )}
      {...props}
    >
      {children}
      <span className="tp-shimmer absolute inset-0 pointer-events-none" />
    </div>
  )
}

export { Skeleton }

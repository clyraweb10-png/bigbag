import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive select-none cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-[0.98]",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border bg-card/70 backdrop-blur-sm shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-primary/40 active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 active:scale-[0.98]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
        link: "text-primary underline-offset-4 hover:underline",
        // 21st.dev signature styles
        shimmer:
          "relative overflow-hidden bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] border border-primary/40",
        glow:
          "bg-primary text-primary-foreground shadow-[0_0_16px_-3px_var(--primary)] hover:shadow-[0_0_24px_-2px_var(--primary)] hover:bg-primary/95 transition-all active:scale-[0.98]",
        pill:
          "rounded-full border border-border bg-card/80 backdrop-blur-sm hover:bg-accent hover:border-primary/40 text-foreground shadow-xs hover:shadow-sm active:scale-[0.98]",
        pearl:
          "rounded-xl border border-border/80 bg-gradient-to-b from-card to-secondary/60 hover:to-secondary shadow-xs hover:border-primary/50 text-foreground transition-all active:scale-[0.98]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5 text-xs",
        lg: "h-11 rounded-xl px-6 has-[>svg]:px-4 text-base font-semibold",
        icon: "size-9 rounded-lg",
        "icon-sm": "size-7 rounded-md",
        pill: "h-8 px-4 rounded-full text-xs font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

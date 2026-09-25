import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  size?: "xs" | "sm" | "default" | "lg" | "icon";
  isLoading?: boolean;
  asChild?: boolean;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  isLoading = false,
  asChild = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const buttonClass = cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] whitespace-nowrap select-none",
    variant === "default" && "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 shadow-subtle",
    variant === "secondary" && "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--muted)]",
    variant === "outline" && "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]",
    variant === "ghost" && "bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]",
    variant === "destructive" && "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
    variant === "link" && "bg-transparent text-[var(--primary)] underline-offset-4 hover:underline p-0 h-auto",
    size === "xs" && "h-7 px-2.5 text-xs",
    size === "sm" && "h-8 px-3 text-sm",
    size === "default" && "h-9 px-4 text-sm",
    size === "lg" && "h-11 px-8 text-base",
    size === "icon" && "h-9 w-9 p-0",
    className
  );
  if (asChild) {
    return <Slot
      {...props}
      className={buttonClass}
      aria-disabled={disabled || isLoading || undefined}
      tabIndex={disabled || isLoading ? -1 : props.tabIndex}
      onClick={(event) => {
        if (disabled || isLoading) { event.preventDefault(); return; }
        props.onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      }}
    >{children}</Slot>;
  }
  return (
    <button
      disabled={disabled || isLoading}
      className={buttonClass}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {children}
        </>
      ) : children}
    </button>
  );
}

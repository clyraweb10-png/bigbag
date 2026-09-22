"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FloatingOnboardingQuestionPanelProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  className?: string;
}

/**
 * Layout-only shell for onboarding questions. It deliberately renders in normal
 * document flow so its position and width are owned by the chat composer rather
 * than the viewport.
 */
export function FloatingOnboardingQuestionPanel({
  open,
  title,
  description,
  children,
  footer,
  icon,
  busy = false,
  onClose,
  className,
}: FloatingOnboardingQuestionPanelProps) {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!present) return null;

  return (
    <section
      aria-label={title}
      aria-hidden={!open}
      className={cn(
        "mb-2.5 grid max-h-[min(62dvh,36rem)] min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[22px] border border-border/90 bg-card shadow-[0_18px_60px_-28px_rgba(0,0,0,0.72)] transition-[opacity,transform] duration-200 ease-out",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className
      )}
    >
      <header className="relative flex shrink-0 items-start gap-3 border-b border-border/75 px-4 py-3.5 pr-12 sm:px-5 sm:py-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          {icon ?? <Sparkles className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6 text-foreground sm:text-lg">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close onboarding question"
          disabled={busy}
          onClick={onClose}
          className="absolute right-2.5 top-2.5 h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>

      <footer className="shrink-0 border-t border-border/75 bg-background/35 px-4 py-3 sm:px-5">
        {footer}
      </footer>
    </section>
  );
}

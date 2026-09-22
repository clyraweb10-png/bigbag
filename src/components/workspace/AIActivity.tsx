"use client";

import { useState } from "react";
import { Loader2, Check, CheckCircle2, ChevronDown, ChevronRight, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerationEvent } from "@/lib/vcaas-types";

/**
 * A single step in the AI activity log.
 *
 * `status` lifecycle:
 *  - "pending"   → ○ empty circle (step hasn't started yet)
 *  - "running"   → ⏳ animated spinner (currently executing)
 *  - "completed" → ✓ green check (done)
 *  - "failed"    → ✗ red alert icon
 */
export interface ActivityStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  /** Display string like "0.4s" or "2.3s". Optional. */
  duration?: string;
  /** Optional file path annotation shown in muted text. */
  file?: string;
}

export interface AIActivityProps {
  steps: ActivityStep[];
  /** True while the agent run is in progress. Controls the header icon and the
   * collapsed/expanded default state. */
  isBuilding: boolean;
  /** Optional CSS class for the outer wrapper. */
  className?: string;
}

function StepIcon({ status }: { status: ActivityStep["status"] }) {
  switch (status) {
    case "completed":
      return <Check className="w-3 h-3 text-emerald-500 shrink-0" />;
    case "running":
      return <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />;
    case "failed":
      return <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />;
    case "pending":
    default:
      return (
        <span className="w-3 h-3 rounded-full border border-border/60 inline-block shrink-0" />
      );
  }
}

/**
 * Expandable / collapsible AI Activity widget.
 *
 * While building: shows a live step checklist (auto-expanded by default).
 * After completion: collapses to a one-line summary badge.
 *
 * @example
 * // Used by ChatPanel for the planning phase (Groq/GLM)
 * <AIActivity steps={planningSteps} isBuilding={isPlannerRunning} />
 */
export function AIActivity({ steps, isBuilding, className }: AIActivityProps) {
  const [isOpen, setIsOpen] = useState(true);

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalCount = steps.length;

  // Summary stats for the collapsed state
  const fileSteps = steps.filter(
    (s) =>
      s.status === "completed" &&
      (s.file || s.label.toLowerCase().includes("created") || s.label.toLowerCase().includes("updated"))
  );
  const totalDurationSec = steps
    .filter((s) => s.duration)
    .reduce((acc, s) => acc + parseFloat(s.duration ?? "0"), 0);

  const summaryText = !isBuilding
    ? [
        fileSteps.length > 0 ? `${fileSteps.length} file${fileSteps.length !== 1 ? "s" : ""} updated` : null,
        totalDurationSec > 0 ? `${totalDurationSec.toFixed(1)}s total` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden my-2",
        className
      )}
    >
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors bg-secondary/20 hover:bg-secondary/40"
      >
        <div className="flex items-center gap-2">
          {isBuilding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
          <Zap className="w-3 h-3 text-yellow-500" />
          <span className="font-semibold">Build progress</span>

          {/* Collapsed summary */}
          {!isOpen && !isBuilding && summaryText ? (
            <span className="text-[10px] text-muted-foreground/70 ml-1">{summaryText}</span>
          ) : (
            <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded-full border border-border/40 ml-1">
              {completedCount}/{totalCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-muted-foreground/60">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </div>
      </button>

      {/* ── Step checklist ─────────────────────────────────────────── */}
      {isOpen && (
        <div className="p-2.5 space-y-1.5">
          {steps.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 font-mono py-0.5">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span>Initializing…</span>
            </div>
          )}

          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "flex items-center justify-between gap-2 text-xs font-mono py-0.5",
                step.status === "running"
                  ? "text-foreground"
                  : step.status === "completed"
                  ? "text-muted-foreground"
                  : step.status === "failed"
                  ? "text-red-500"
                  : "text-muted-foreground/50"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <StepIcon status={step.status} />
                <span
                  className={cn(
                    "truncate",
                    step.status === "running" && "font-medium"
                  )}
                >
                  {step.label}
                </span>
                {step.file && (
                  <span className="text-[10px] text-muted-foreground/50 hidden sm:inline truncate">
                    {step.file}
                  </span>
                )}
              </div>
              {step.duration && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
                  ({step.duration})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Derive `ActivityStep[]` from raw `building`-type ConversationMessages.
 *
 * Called by `BuildGroup` (in `ChatPanel.tsx`) so the AI Activity widget can
 * be driven entirely by the existing `building` message stream — no engine
 * changes required.
 *
 * @param buildMsgs   The `buildMsgs` array from a `MessageGroup`.
 * @param isComplete  True when a `finished` or `error` message has been received.
 * @param startTime   The ISO string `createdAt` from the `starting` message.
 */
export function activityStepsFromBuildMsgs(
  buildMsgs: Array<{ message: string; createdAt?: string; generationEvent?: GenerationEvent }>,
  isComplete: boolean,
  startTime?: string
): ActivityStep[] {
  // Provider retries, output continuations, and failover are one generation phase,
  // not separate user tasks. Keep only the latest privacy-safe status so the UI
  // never becomes a noisy provider-by-provider timeline.
  const isModelProgress = (label: string) =>
    /^(?:Building your project|Still working|Continuing generation)/.test(label);
  let latestModelProgress = -1;
  buildMsgs.forEach((msg, index) => {
    if (isModelProgress(msg.message)) latestModelProgress = index;
  });
  const visibleMessages = buildMsgs.filter(
    (msg, index) => !isModelProgress(msg.message) || index === latestModelProgress
  );
  const eventTypes = new Set(buildMsgs.flatMap((message) => message.generationEvent?.type || []));
  const completionForStartedEvent: Partial<Record<GenerationEvent["type"], GenerationEvent["type"][]>> = {
    crawl_started: ["crawl_completed"],
    visual_analysis_started: ["visual_analysis_completed"],
    file_generation_started: ["file_created", "file_updated", "generation_completed", "generation_failed"],
    build_started: ["build_completed", "generation_failed"],
    validation_started: ["validation_completed", "generation_failed"],
    preview_started: ["preview_ready", "preview_failed", "generation_failed"],
  };

  return visibleMessages.map((msg, i) => {
    const originalIndex = buildMsgs.indexOf(msg);
    const event = msg.generationEvent;
    const completionEvents = event ? completionForStartedEvent[event.type] : undefined;
    const hasRealCompletion = completionEvents?.some((type) => eventTypes.has(type)) || false;
    const status: ActivityStep["status"] = event?.status === "failed"
      ? "failed"
      : event?.status === "completed" || hasRealCompletion
        ? "completed"
        : event?.status === "started"
          ? "running"
          : isComplete || i < visibleMessages.length - 1
            ? "completed"
            : "running";

    // Duration: diff between this message's timestamp and the previous one.
    let duration: string | undefined;
    const previousVisibleMessage = i === 0 ? undefined : visibleMessages[i - 1];
    const prevTime = previousVisibleMessage?.createdAt || startTime;
    if (prevTime && msg.createdAt) {
      const diffMs = Date.parse(msg.createdAt) - Date.parse(prevTime);
      if (!isNaN(diffMs) && diffMs > 0) {
        duration = (diffMs / 1000).toFixed(1) + "s";
      }
    }

    return {
      id: event?.eventId || `${originalIndex}-${msg.message.slice(0, 20)}`,
      label: msg.message,
      status,
      duration: status === "running" ? undefined : event?.durationMs
        ? `${(event.durationMs / 1000).toFixed(1)}s`
        : duration,
    };
  });
}

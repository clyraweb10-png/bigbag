"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { ArrowRight, Loader2, Wand2, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FloatingOnboardingQuestionPanel } from "@/components/generate/FloatingOnboardingQuestionPanel";
import type {
  OnboardingQuestion,
  PaletteDirection,
  ProjectContext,
  ProjectTypeId,
} from "@/lib/local-orchestrator/onboarding-context";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingAnswer = Partial<ProjectContext>;

interface SmartQuestionCardProps {
  open: boolean;
  question: OnboardingQuestion | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (answer: OnboardingAnswer) => void;
  onSkip: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RadioChoiceCard({
  value,
  selected,
  title,
  description,
  palette,
}: {
  value: string;
  selected: boolean;
  title: string;
  description: string;
  palette?: PaletteDirection;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors sm:px-4",
        selected
          ? "border-primary bg-primary/8 ring-1 ring-primary/25"
          : "border-border bg-background/45 hover:border-primary/40 hover:bg-accent/45"
      )}
    >
      <RadioGroupItem value={value} aria-label={title} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
        )}
        {palette && (
          <span className="mt-2 flex gap-1.5" aria-label={`${title} colour preview`}>
            {palette.colours.map((colour) => (
              <span
                key={colour}
                className="h-5 flex-1 rounded-md border border-black/10 shadow-inner sm:max-w-12"
                style={{ backgroundColor: colour }}
              />
            ))}
          </span>
        )}
      </span>
    </label>
  );
}

function MultiChoiceRow({
  id,
  checked,
  onToggle,
  title,
  description,
}: {
  id: string;
  checked: boolean;
  onToggle: (id: string) => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors sm:px-4",
        checked
          ? "border-primary bg-primary/8 ring-1 ring-primary/25"
          : "border-border bg-background/45 hover:border-primary/40 hover:bg-accent/45"
      )}
    >
      <Checkbox
        id={`mc-${id}`}
        checked={checked}
        onCheckedChange={() => onToggle(id)}
        className="mt-0.5 shrink-0"
        aria-label={title}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SmartQuestionCard({
  open,
  question,
  busy,
  onOpenChange,
  onSubmit,
  onSkip,
}: SmartQuestionCardProps) {
  // Single-choice / colour-direction
  const [selection, setSelection] = useState("");
  const [customValue, setCustomValue] = useState("");

  // Multi-choice
  const [multiSelections, setMultiSelections] = useState<Set<string>>(new Set());

  // Free text / project details
  const [textValue, setTextValue] = useState("");
  const [projectName, setProjectName] = useState("");

  // Yes / No
  const [yesNo, setYesNo] = useState<"yes" | "no" | null>(null);

  const firstInputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  // Reset local state when the question changes
  useEffect(() => {
    setSelection("");
    setCustomValue("");
    setMultiSelections(new Set());
    setTextValue("");
    setProjectName("");
    setYesNo(null);
  }, [question?.kind, question?.title]);

  // Auto-focus first text field
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, question?.kind]);

  const kind = question?.kind ?? null;

  const isChoiceStep = kind === "project_type" || kind === "colour_direction";
  const isMultiChoice = kind === "multi_choice";
  const isYesNo = kind === "yes_no";
  const isTextStep = kind === "project_details" || kind === "free_text";
  const isUrlStep = kind === "reference_url";

  const canSubmit = useMemo(() => {
    if (!question || busy) return false;
    if (isChoiceStep) {
      return Boolean(selection && (selection !== "other" || customValue.trim()));
    }
    if (isMultiChoice) {
      return multiSelections.size > 0 || question.optional;
    }
    if (isYesNo) {
      return yesNo !== null;
    }
    if (isTextStep) {
      return Boolean(textValue.trim()) || question.optional;
    }
    if (isUrlStep) {
      return true; // URL is always optional
    }
    return false;
  }, [busy, customValue, isChoiceStep, isMultiChoice, isTextStep, isUrlStep, isYesNo, multiSelections.size, question, selection, textValue, yesNo]);

  const toggleMulti = (id: string) => {
    setMultiSelections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (!question || !canSubmit) return;

    if (kind === "project_type") {
      if (selection === "other") {
        onSubmit({ projectType: "custom", customProjectType: customValue.trim() });
      } else {
        onSubmit({ projectType: selection as ProjectTypeId });
      }
      return;
    }

    if (kind === "colour_direction") {
      if (selection === "other") {
        onSubmit({ colourDirection: customValue.trim(), customPaletteDirection: customValue.trim() });
      } else {
        const palette = question.paletteChoices.find((c) => c.id === selection) || null;
        onSubmit({
          colourDirection: palette ? `${palette.label}: ${palette.description}` : selection,
          paletteSelection: palette,
        });
      }
      return;
    }

    if (kind === "multi_choice") {
      // Encode multi-choice selections into projectDescription extension
      const selected = question.options?.filter((o) => multiSelections.has(o.id)).map((o) => o.label) ?? [];
      const existing = textValue.trim();
      const combined = existing
        ? `${existing}\n\nSelected: ${selected.join(", ")}`
        : `Selected: ${selected.join(", ")}`;
      onSubmit({ projectDescription: combined });
      return;
    }

    if (kind === "yes_no") {
      onSubmit({ projectDescription: yesNo === "yes" ? "Yes" : "No" });
      return;
    }

    if (kind === "reference_url") {
      onSubmit({ referenceUrl: textValue.trim() || null });
      return;
    }

    // project_details / free_text
    onSubmit({
      projectDescription: textValue.trim() || null,
      projectName: question.requestProjectName ? projectName.trim() || null : null,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && (isUrlStep || (isTextStep && !question?.multiline))) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      onOpenChange(false);
    }
  };

  if (!question) return null;

  const showCustomInput = isChoiceStep && selection === "other";

  return (
    <FloatingOnboardingQuestionPanel
      open={open}
      title={question.title}
      description={question.description}
      icon={<Wand2 className="h-4 w-4" />}
      busy={busy}
      onClose={() => onOpenChange(false)}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="min-w-28 gap-2"
            aria-label="Submit answer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue
            {!busy ? <ArrowRight className="h-4 w-4" /> : null}
          </Button>
        </div>
      }
    >
      <div onKeyDown={handleKeyDown}>
        {/* ── Single choice (project_type / colour_direction) ── */}
        {isChoiceStep && (
          <RadioGroup value={selection} onValueChange={setSelection} className="gap-2.5">
            {kind === "project_type" && (
              <>
                {(question.options ?? DEFAULT_PROJECT_TYPES).map((opt) => (
                  <RadioChoiceCard
                    key={opt.id}
                    value={opt.id}
                    selected={selection === opt.id}
                    title={opt.label}
                    description={opt.description}
                  />
                ))}
                {question.allowOther !== false && (
                  <RadioChoiceCard
                    value="other"
                    selected={selection === "other"}
                    title="Something else…"
                    description="Describe a different kind of project in your own words"
                  />
                )}
              </>
            )}
            {kind === "colour_direction" && (
              <>
                {question.paletteChoices.map((palette) => (
                  <RadioChoiceCard
                    key={palette.id}
                    value={palette.id}
                    selected={selection === palette.id}
                    title={palette.label}
                    description={palette.description}
                    palette={palette}
                  />
                ))}
                {question.allowOther !== false && (
                  <RadioChoiceCard
                    value="other"
                    selected={selection === "other"}
                    title="Describe your own…"
                    description="Tell me the exact colour mood, contrast, and accents you want"
                  />
                )}
              </>
            )}
          </RadioGroup>
        )}

        {/* Custom text when "other" is chosen */}
        {showCustomInput && (
          <Textarea
            ref={firstInputRef as React.RefObject<HTMLTextAreaElement>}
            autoFocus
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder={question.placeholder || "Describe your preference…"}
            className="mt-3 min-h-20 resize-y rounded-xl bg-background"
            maxLength={500}
          />
        )}

        {/* ── Multi-choice ── */}
        {isMultiChoice && (
          <div className="flex flex-col gap-2.5" role="group" aria-label={question.title}>
            {(question.options ?? []).map((opt) => (
              <MultiChoiceRow
                key={opt.id}
                id={opt.id}
                checked={multiSelections.has(opt.id)}
                onToggle={toggleMulti}
                title={opt.label}
                description={opt.description}
              />
            ))}
          </div>
        )}

        {/* ── Yes / No ── */}
        {isYesNo && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setYesNo("yes")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-semibold transition-colors",
                yesNo === "yes"
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "border-border bg-background/45 text-foreground hover:border-primary/40 hover:bg-accent/45"
              )}
              aria-pressed={yesNo === "yes"}
            >
              {yesNo === "yes" ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              Yes
            </button>
            <button
              type="button"
              onClick={() => setYesNo("no")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-semibold transition-colors",
                yesNo === "no"
                  ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "border-border bg-background/45 text-foreground hover:border-primary/40 hover:bg-accent/45"
              )}
              aria-pressed={yesNo === "no"}
            >
              {yesNo === "no" ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              No
            </button>
          </div>
        )}

        {/* ── Project details (text group with optional name) ── */}
        {isTextStep && (
          <div className="space-y-4">
            {question.requestProjectName && (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  Project name{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <Input
                  ref={firstInputRef as React.RefObject<HTMLInputElement>}
                  autoFocus
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. TaskFlow"
                  className="h-11 rounded-xl bg-background"
                  maxLength={100}
                />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">
                {question.fieldLabel || "Tell me more"}
                {question.optional && (
                  <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>
                )}
              </span>
              {question.multiline !== false ? (
                <Textarea
                  ref={!question.requestProjectName ? (firstInputRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                  autoFocus={!question.requestProjectName}
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder={question.placeholder || "Describe what you have in mind…"}
                  className="min-h-28 resize-y rounded-xl bg-background"
                  maxLength={1_000}
                />
              ) : (
                <Input
                  ref={!question.requestProjectName ? (firstInputRef as React.RefObject<HTMLInputElement>) : undefined}
                  autoFocus={!question.requestProjectName}
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder={question.placeholder || "Type your answer…"}
                  className="h-11 rounded-xl bg-background"
                  maxLength={300}
                />
              )}
            </label>
          </div>
        )}

        {/* ── URL input ── */}
        {isUrlStep && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              Paste a URL you want to reference{" "}
              <span className="font-normal">(optional)</span>
            </span>
            <Input
              ref={firstInputRef as React.RefObject<HTMLInputElement>}
              autoFocus
              type="url"
              inputMode="url"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={question.placeholder || "https://example.com"}
              className="h-11 rounded-xl bg-background"
              maxLength={500}
            />
          </label>
        )}
      </div>
    </FloatingOnboardingQuestionPanel>
  );
}

// ---------------------------------------------------------------------------
// Static default options (used when the AI doesn't supply custom options)
// ---------------------------------------------------------------------------

const DEFAULT_PROJECT_TYPES: Array<{ id: string; label: string; description: string }> = [
  {
    id: "website",
    label: "Website / landing page",
    description: "A public-facing site with sections, content, and a clear visitor action",
  },
  {
    id: "web-app",
    label: "Web app or tool",
    description: "An interactive product with workflows, forms, dashboards, or saved data",
  },
  {
    id: "store",
    label: "Online store",
    description: "A site to sell or display products, with a catalog and optional checkout",
  },
  {
    id: "portfolio-blog",
    label: "Portfolio / blog",
    description: "A content-driven site presenting work, writing, or a personal brand",
  },
  {
    id: "dashboard",
    label: "Dashboard or admin panel",
    description: "Data views, reports, controls, and actions for internal or customer use",
  },
  {
    id: "saas",
    label: "SaaS product",
    description: "A subscription-based service with accounts, teams, billing, and features",
  },
];

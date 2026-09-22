"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type {
  OnboardingQuestion,
  PaletteDirection,
  ProjectContext,
  ProjectTypeId,
} from "@/lib/local-orchestrator/onboarding-context";
import { cn } from "@/lib/utils";

const PROJECT_TYPES: Array<{
  id: Exclude<ProjectTypeId, "custom">;
  title: string;
  description: string;
}> = [
  {
    id: "website",
    title: "A website / landing page",
    description: "A landing page or personal site with hero, sections, and contact info",
  },
  {
    id: "web-app",
    title: "A web app / tool",
    description: "An interactive tool with forms, dashboards, or data — e.g. a tracker, planner, or calculator",
  },
  {
    id: "store",
    title: "An online store",
    description: "A site to sell or present products, with a catalog and checkout options",
  },
  {
    id: "portfolio-blog",
    title: "A portfolio / blog",
    description: "A blog, portfolio, or content-driven site with pages and posts",
  },
];

export type OnboardingAnswer = Partial<ProjectContext>;

interface ProjectOnboardingDialogProps {
  open: boolean;
  question: OnboardingQuestion | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (answer: OnboardingAnswer) => void;
  onSkip: () => void;
}

function ChoiceCard({
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
        "flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors sm:px-4",
        selected
          ? "border-primary bg-primary/8 ring-1 ring-primary/25"
          : "border-border bg-background/45 hover:border-primary/40 hover:bg-accent/45"
      )}
    >
      <RadioGroupItem value={value} aria-label={title} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
        {palette ? (
          <span className="mt-2 flex gap-1.5" aria-label={`${title} colour preview`}>
            {palette.colours.map((colour) => (
              <span
                key={colour}
                className="h-5 flex-1 rounded-md border border-black/10 shadow-inner sm:max-w-12"
                style={{ backgroundColor: colour }}
              />
            ))}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function ProjectOnboardingDialog({
  open,
  question,
  busy,
  onOpenChange,
  onSubmit,
  onSkip,
}: ProjectOnboardingDialogProps) {
  const [selection, setSelection] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    setSelection("");
    setCustomValue("");
    setTextValue("");
    setProjectName("");
  }, [question?.kind, question?.title]);

  const canSubmit = useMemo(() => {
    if (!question || busy) return false;
    if (question.kind === "project_type" || question.kind === "colour_direction") {
      return Boolean(selection && (selection !== "custom" || customValue.trim()));
    }
    return Boolean(textValue.trim()) || question.optional;
  }, [busy, customValue, question, selection, textValue]);

  const submit = () => {
    if (!question || !canSubmit) return;
    if (question.kind === "project_type") {
      onSubmit(selection === "custom"
        ? { projectType: "custom", customProjectType: customValue.trim() }
        : { projectType: selection as ProjectTypeId });
      return;
    }
    if (question.kind === "colour_direction") {
      if (selection === "custom") {
        onSubmit({ colourDirection: customValue.trim(), customPaletteDirection: customValue.trim() });
        return;
      }
      const palette = question.paletteChoices.find((choice) => choice.id === selection) || null;
      onSubmit({
        colourDirection: palette ? `${palette.label}: ${palette.description}` : selection,
        paletteSelection: palette,
      });
      return;
    }
    if (question.kind === "reference_url") {
      onSubmit({ referenceUrl: textValue.trim() || null });
      return;
    }
    onSubmit({
      projectDescription: textValue.trim(),
      projectName: question.requestProjectName ? projectName.trim() || null : null,
    });
  };

  if (!question) return null;

  const isChoiceStep = question.kind === "project_type" || question.kind === "colour_direction";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[min(88dvh,760px)] w-[calc(100%-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:w-full sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Palette className="h-4.5 w-4.5" />
          </div>
          <DialogTitle className="text-lg leading-6 sm:text-xl">{question.title}</DialogTitle>
          <DialogDescription className="leading-5">{question.description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {question.kind === "project_type" ? (
            <RadioGroup value={selection} onValueChange={setSelection} className="gap-2.5">
              {PROJECT_TYPES.map((option) => (
                <ChoiceCard
                  key={option.id}
                  value={option.id}
                  selected={selection === option.id}
                  title={option.title}
                  description={option.description}
                />
              ))}
              <ChoiceCard
                value="custom"
                selected={selection === "custom"}
                title="Write your own…"
                description="Describe a different kind of project in your own words"
              />
            </RadioGroup>
          ) : null}

          {question.kind === "colour_direction" ? (
            <RadioGroup value={selection} onValueChange={setSelection} className="gap-2.5">
              {question.paletteChoices.map((palette) => (
                <ChoiceCard
                  key={palette.id}
                  value={palette.id}
                  selected={selection === palette.id}
                  title={palette.label}
                  description={palette.description}
                  palette={palette}
                />
              ))}
              <ChoiceCard
                value="custom"
                selected={selection === "custom"}
                title="Write your own…"
                description="Describe the exact colour mood, contrast, and accents you want"
              />
            </RadioGroup>
          ) : null}

          {isChoiceStep && selection === "custom" ? (
            <Textarea
              autoFocus
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              placeholder={question.placeholder}
              className="mt-3 min-h-24 resize-y rounded-xl bg-background"
              maxLength={500}
            />
          ) : null}

          {question.kind === "project_details" ? (
            <div className="space-y-4">
              {question.requestProjectName ? (
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Project name <span className="font-normal text-muted-foreground">(optional)</span></span>
                  <Input
                    autoFocus
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="e.g. TaskFlow"
                    className="h-11 rounded-xl bg-background"
                    maxLength={100}
                  />
                </label>
              ) : null}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">What should it do?</span>
                <Textarea
                  autoFocus={!question.requestProjectName}
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  placeholder={question.placeholder}
                  className="min-h-28 resize-y rounded-xl bg-background"
                  maxLength={1_000}
                />
              </label>
            </div>
          ) : null}

          {question.kind === "reference_url" ? (
            <Input
              autoFocus
              type="url"
              inputMode="url"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder={question.placeholder}
              className="h-11 rounded-xl bg-background"
              onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
            />
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between border-t border-border bg-background/35 px-4 py-3 sm:px-6 sm:py-4">
          <Button type="button" variant="ghost" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit} className="min-w-28">
            {busy ? <Loader2 className="animate-spin" /> : null}
            Submit
            {!busy ? <ArrowRight /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const PROJECT_TYPE_IDS = [
  "website",
  "web-app",
  "store",
  "portfolio-blog",
  "custom",
] as const;

export type ProjectTypeId = (typeof PROJECT_TYPE_IDS)[number];

export type OnboardingQuestionKind =
  | "project_type"
  | "project_details"
  | "colour_direction"
  | "reference_url";

export interface PaletteDirection {
  id: string;
  label: string;
  description: string;
  /** Model-supplied preview swatches. The UI never owns palette values. */
  colours: string[];
}

export interface ProjectContext {
  projectType: ProjectTypeId | null;
  customProjectType: string | null;
  projectName: string | null;
  projectDescription: string | null;
  colourDirection: string | null;
  paletteSelection: PaletteDirection | null;
  customPaletteDirection: string | null;
  referenceUrl: string | null;
  skippedQuestions: OnboardingQuestionKind[];
}

export interface OnboardingQuestion {
  kind: OnboardingQuestionKind;
  title: string;
  description: string;
  placeholder: string;
  optional: boolean;
  /** True only when the agent determined the name is still missing. */
  requestProjectName: boolean;
  paletteChoices: PaletteDirection[];
}

export interface OnboardingAnalysis {
  context: ProjectContext;
  nextQuestion: OnboardingQuestion | null;
}

export function questionAlreadyAnswered(
  context: ProjectContext,
  kind: OnboardingQuestionKind
): boolean {
  if (kind === "project_type") {
    return Boolean(context.projectType && (context.projectType !== "custom" || context.customProjectType));
  }
  if (kind === "project_details") return Boolean(context.projectName && context.projectDescription);
  if (kind === "colour_direction") {
    return Boolean(context.colourDirection || context.paletteSelection || context.customPaletteDirection);
  }
  return Boolean(context.referenceUrl);
}

export const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  projectType: null,
  customProjectType: null,
  projectName: null,
  projectDescription: null,
  colourDirection: null,
  paletteSelection: null,
  customPaletteDirection: null,
  referenceUrl: null,
  skippedQuestions: [],
};

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : null;
}

function cleanColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const colour = value.trim();
  return /^#[0-9a-f]{6}$/i.test(colour) ? colour : null;
}

function cleanPalette(value: unknown): PaletteDirection | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 64);
  const label = cleanText(record.label, 80);
  const description = cleanText(record.description, 180);
  const colours = Array.isArray(record.colours)
    ? record.colours.map(cleanColour).filter((item): item is string => Boolean(item)).slice(0, 5)
    : [];
  if (!id || !label || !description || colours.length < 3) return null;
  return { id, label, description, colours };
}

function isProjectType(value: unknown): value is ProjectTypeId {
  return typeof value === "string" && PROJECT_TYPE_IDS.includes(value as ProjectTypeId);
}

function isQuestionKind(value: unknown): value is OnboardingQuestionKind {
  return value === "project_type" || value === "project_details" ||
    value === "colour_direction" || value === "reference_url";
}

export function mergeProjectContext(
  current: ProjectContext,
  incoming: Partial<ProjectContext>
): ProjectContext {
  const incomingSkipped = Array.isArray(incoming.skippedQuestions)
    ? incoming.skippedQuestions.filter(isQuestionKind)
    : [];
  const projectType = current.projectType || (isProjectType(incoming.projectType) ? incoming.projectType : null);
  return {
    projectType,
    customProjectType: projectType === "custom"
      ? current.customProjectType || cleanText(incoming.customProjectType, 160)
      : null,
    projectName: current.projectName || cleanText(incoming.projectName, 100),
    projectDescription: current.projectDescription || cleanText(incoming.projectDescription, 1_000),
    colourDirection: current.colourDirection || cleanText(incoming.colourDirection, 240),
    paletteSelection: current.paletteSelection || cleanPalette(incoming.paletteSelection),
    customPaletteDirection: current.customPaletteDirection || cleanText(incoming.customPaletteDirection, 240),
    referenceUrl: current.referenceUrl || cleanText(incoming.referenceUrl, 500),
    skippedQuestions: [...new Set([...current.skippedQuestions, ...incomingSkipped])],
  };
}

function jsonCandidate(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const source = (fenced || raw).trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The onboarding agent returned no structured context");
  return source.slice(start, end + 1);
}

export function parseOnboardingOutput(
  raw: string,
  current: ProjectContext,
  options: { allowAnsweredQuestion?: boolean } = {}
): OnboardingAnalysis {
  const parsed = JSON.parse(jsonCandidate(raw)) as Record<string, unknown>;
  const incoming = parsed.context && typeof parsed.context === "object"
    ? parsed.context as Partial<ProjectContext>
    : {};
  const context = mergeProjectContext(current, incoming);
  const rawQuestion = parsed.nextQuestion;
  if (!rawQuestion || typeof rawQuestion !== "object") return { context, nextQuestion: null };

  const question = rawQuestion as Record<string, unknown>;
  if (
    !isQuestionKind(question.kind) ||
    context.skippedQuestions.includes(question.kind) ||
    (!options.allowAnsweredQuestion && questionAlreadyAnswered(context, question.kind))
  ) {
    return { context, nextQuestion: null };
  }
  const title = cleanText(question.title, 180);
  if (!title) return { context, nextQuestion: null };
  const paletteChoices = Array.isArray(question.paletteChoices)
    ? question.paletteChoices.map(cleanPalette).filter((item): item is PaletteDirection => Boolean(item)).slice(0, 5)
    : [];

  return {
    context,
    nextQuestion: {
      kind: question.kind,
      title: question.kind === "colour_direction"
        ? "Which colour family feels right for your brand?"
        : title,
      description: cleanText(question.description, 280) || "Share only what matters for this project.",
      placeholder: cleanText(question.placeholder, 160) || "Type your answer...",
      optional: question.optional === true,
      requestProjectName: question.requestProjectName === true && !context.projectName,
      paletteChoices,
    },
  };
}

export function projectContextForPrompt(originalPrompt: string, context: ProjectContext): string {
  const fields = [
    ["Original request", originalPrompt.trim()],
    ["Project type", context.customProjectType || context.projectType],
    ["Project name", context.projectName],
    ["Project description", context.projectDescription],
    ["Colour direction", context.customPaletteDirection || context.colourDirection],
    ["Selected palette", context.paletteSelection
      ? `${context.paletteSelection.label}: ${context.paletteSelection.description} (${context.paletteSelection.colours.join(", ")})`
      : null],
    ["Reference URL", context.referenceUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return [
    "Use the following user-approved project context as the source of truth.",
    ...fields.map(([label, value]) => `${label}: ${value}`),
    "Do not ask for information already present above. Continue through the existing plan and confirmation flow.",
  ].join("\n");
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserAvatar } from "@/components/auth/AuthProvider";
import {
  ArrowLeft, ArrowRight, Loader2, AlertCircle, Lightbulb, ArrowUpRight,
} from "lucide-react";
import { vcaasApi } from "@/lib/vcaas";
import { uploadFilesToProjectDetailed, splitBySize, MAX_UPLOAD_MB, TOO_LARGE_ADVICE } from "@/lib/upload";
import { AttachChainIcon } from "@/components/prompt/ComposerIcons";
import { filesFromClipboard } from "@/lib/attachments";
import { AttachmentPreviews } from "@/components/workspace/AttachmentPreview";
import { FigmaPromptButton } from "@/components/prompt/FigmaPromptButton";
import { FigmaModal } from "@/components/workspace/FigmaModal";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { t } from "@/i18n";
import { classifyIntent, type ProjectStage, type UserIntent } from "@/lib/local-orchestrator/intent-router";
import { readPlannerStream } from "@/lib/local-orchestrator/planner-stream";
import { SmartQuestionCard, type OnboardingAnswer } from "@/components/generate/SmartQuestionCard";
import {
  EMPTY_PROJECT_CONTEXT,
  mergeProjectContext,
  projectContextForPrompt,
  type OnboardingAnalysis,
  type OnboardingQuestion,
  type ProjectContext,
} from "@/lib/local-orchestrator/onboarding-context";

type Message = { role: "user" | "assistant"; content: string };
type DirectBuildRequest = { instruction: string; projectId: string };

const PROJECT_TYPE_QUESTION: OnboardingQuestion = {
  kind: "project_type",
  title: "What would you like me to build?",
  description: "Choose the closest match — I\u2019ll only ask for details that genuinely matter.",
  placeholder: "Describe the kind of project you have in mind\u2026",
  optional: true,
  requestProjectName: false,
  paletteChoices: [],
  allowOther: true,
  multiline: false,
  options: [
    { id: "website", label: "Website or landing page", description: "A public-facing site with sections, content, and a clear visitor action" },
    { id: "web-app", label: "Web app or tool", description: "An interactive product with forms, dashboards, data, or workflows" },
    { id: "store", label: "Online store", description: "A product catalog with a shopping experience and optional checkout" },
    { id: "portfolio-blog", label: "Portfolio or blog", description: "A content-driven site presenting work, writing, or a personal brand" },
    { id: "dashboard", label: "Dashboard or admin panel", description: "Data views, reports, and controls for internal or customer use" },
    { id: "saas", label: "SaaS product", description: "A subscription service with accounts, billing, and core product features" },
  ],
};

function normalizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 35);
}

function MessageContent({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const key = `${i}-${line.slice(0, 10)}`;
        if (line.startsWith("## ")) return <h2 key={key} className="pt-2 text-base font-semibold text-foreground">{line.slice(3)}</h2>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={key} className="pt-1 font-semibold text-foreground">{line.slice(2, -2)}</p>;
        if (line.startsWith("- ") || line.startsWith("✓ ")) return <p key={key} className="flex gap-2"><span className="text-primary">•</span><span>{line.replace(/^[-✓]\s*/, "")}</span></p>;
        if (line === "---") return <hr key={key} className="my-3 border-border" />;
        if (!line.trim()) return <div key={key} className="h-1" />;
        return <p key={key}>{line.replace(/\*\*/g, "")}</p>;
      })}
    </div>
  );
}

function TypingMessage({ text, active, onComplete }: { text: string; active: boolean; onComplete: () => void }) {
  const [len, setLen] = useState(active ? 0 : text.length);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setLen(text.length); return; }
    setLen(0);
    const t = setInterval(() => setLen((c) => Math.min(text.length, c + Math.max(4, Math.ceil(text.length / 30)))), 14);
    return () => clearInterval(t);
  }, [active, text]);
  useEffect(() => {
    if (!active || len < text.length) return;
    const t = setTimeout(() => onCompleteRef.current(), 80);
    return () => clearTimeout(t);
  }, [active, text.length, len]);

  return (
    <>
      <div aria-hidden="true">
        <MessageContent text={text.slice(0, len)} />
        {active && len < text.length && <span className="assistant-cursor" aria-hidden="true" />}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {active && len < text.length ? "" : text}
      </p>
    </>
  );
}

export default function GeneratePage() {
  const router = useRouter();
  const { user, status } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [stage, setStage] = useState<ProjectStage>("idle");
  const [plannerRunning, setPlannerRunning] = useState(false);
  const [approvedPrompt, setApprovedPrompt] = useState("");
  const [planRequest, setPlanRequest] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typingIndex, setTypingIndex] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [projectContext, setProjectContext] = useState<ProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [onboardingQuestion, setOnboardingQuestion] = useState<OnboardingQuestion | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingRunning, setOnboardingRunning] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [sourcePrompt, setSourcePrompt] = useState("");
  const [pendingDirectBuild, setPendingDirectBuild] = useState<DirectBuildRequest | null>(null);

  const [prompt, setPrompt] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; imageDescription: string; file: File }[]>([]);
  const [uploading, setUploading] = useState(false);

  const [figmaToken, setFigmaToken] = useState<string | null>(null);
  const [figmaModalOpen, setFigmaModalOpen] = useState(false);

  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [buildName, setBuildName] = useState("");
  const [buildCreating, setBuildCreating] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const directBuildStartedRef = useRef<DirectBuildRequest | null>(null);
  const createdProjectRetryRef = useRef<{ projectId: string; instruction: string } | null>(null);

  /* ── Auth guard ── */
  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated" || !user) {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
    }
  }, [status, user, router]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, plannerRunning, suggestions]);

  /* ── Initialize from URL prompt ── */
  const sendToPlanner = useCallback(async (
    message: string,
    history: Message[],
    intent: Extract<UserIntent, "chat" | "plan" | "update_plan">
  ) => {
    setPlannerRunning(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, message, history: history.slice(-10), stream: intent === "chat" }),
      });
      if (intent === "chat") {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        await readPlannerStream(res, (text) => setMessages((prev) => [
          ...prev.slice(0, -1), { role: "assistant", content: text },
        ]));
        return;
      }
      const payload = await res.json() as { ok: boolean; data?: { text?: string; suggestions?: string[] }; error?: string };
      if (!payload.ok || !payload.data?.text) throw new Error(payload.error || "Assistant unavailable");
      setTypingIndex(null);
      setMessages((prev) => [...prev, { role: "assistant", content: payload.data!.text! }]);
      setSuggestions(Array.isArray(payload.data.suggestions) ? payload.data.suggestions.slice(0, 10) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the assistant");
      if (intent === "chat") setMessages((prev) => prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev);
    } finally {
      setPlannerRunning(false);
    }
  }, []);

  const continueToBuild = useCallback(async (
    originalPrompt: string,
    context: ProjectContext,
    _history: Message[]
  ) => {
    const buildInstruction = projectContextForPrompt(originalPrompt, context);
    const displayPrompt = originalPrompt.trim() || context.projectDescription || context.customProjectType || "Create a complete project";
    const idSource = context.projectName || context.customProjectType || context.projectDescription || originalPrompt || "new project";
    const normalizedProjectId = normalizeId(idSource.split(/\s+/).slice(0, 5).join("-"));
    const projectId = normalizedProjectId.length >= 3
      ? normalizedProjectId
      : `app-${Math.random().toString(36).slice(2, 7)}`;
    setApprovedPrompt(buildInstruction);
    setPlanRequest(displayPrompt);
    setOnboardingQuestion(null);
    setOnboardingOpen(false);
    setStage("building");
    setPendingDirectBuild({ instruction: buildInstruction, projectId });
  }, []);

  const requestOnboarding = useCallback(async (
    originalPrompt: string,
    history: Message[],
    currentContext: ProjectContext
  ) => {
    setOnboardingRunning(true);
    setOnboardingError(null);
    setSuggestions([]);
    try {
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "onboard",
          message: originalPrompt.trim() || "Help me create a new project.",
          history: history.slice(-10),
          context: currentContext,
        }),
      });
      const payload = await res.json() as {
        ok: boolean;
        data?: { onboarding?: OnboardingAnalysis };
        error?: string;
      };
      if (!payload.ok || !payload.data?.onboarding) {
        throw new Error(payload.error || "Could not inspect the project context");
      }
      const analysis = payload.data.onboarding;
      setProjectContext(analysis.context);
      if (analysis.nextQuestion) {
        setOnboardingQuestion(analysis.nextQuestion);
        setOnboardingOpen(true);
      } else {
        await continueToBuild(originalPrompt, analysis.context, history);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not inspect the project context";
      setOnboardingError(message);
      toast.error(message);
      setStage("idle");
      setOnboardingOpen(true);
    } finally {
      setOnboardingRunning(false);
    }
  }, [continueToBuild]);

  useEffect(() => {
    if (status !== "authenticated" || !user || initialized) return;
    setInitialized(true);
    const initial = (() => { try { return sessionStorage.getItem("bigbag:pending-prompt") || ""; } catch { return ""; } })();
    if (initial) {
      try { sessionStorage.removeItem("bigbag:pending-prompt"); } catch { /* ok */ }
      const intent = classifyIntent(initial, "idle");
      const plannerIntent = intent === "plan" ? "plan" : "chat";
      if (plannerIntent === "plan") {
        setSourcePrompt(initial);
        setStage("planning");
      }
      const userMsg: Message = { role: "user", content: initial };
      setMessages([userMsg]);
      if (plannerIntent === "plan") void requestOnboarding(initial, [], EMPTY_PROJECT_CONTEXT);
      else void sendToPlanner(initial, [], plannerIntent);
    } else {
      setOnboardingQuestion(PROJECT_TYPE_QUESTION);
      setOnboardingOpen(true);
    }
  }, [status, user, initialized, requestOnboarding, sendToPlanner]);

  /* ── Submit new message ── */
  const handleSubmit = async () => {
    const msg = prompt.trim();
    if ((!msg && attachedFiles.length === 0) || plannerRunning || onboardingRunning || buildCreating) return;

    if (!msg) {
      const attachmentPrompt = "Build a complete application using the attached files as reference.";
      const next = [...messages, { role: "user" as const, content: attachmentPrompt }];
      setMessages(next);
      setSourcePrompt(attachmentPrompt);
      setStage("planning");
      await requestOnboarding(attachmentPrompt, messages, projectContext);
      return;
    }

    // Natural-language answer: if a question card is visible, treat the composer
    // message as the answer and fold it into the context instead of starting a
    // new plan/chat round. The card closes and context continues.
    if (onboardingQuestion && onboardingOpen) {
      const next: Message[] = [...messages, { role: "user", content: msg }];
      setMessages(next);
      setPrompt("");
      // Apply the free-text answer to the appropriate context field based on kind
      const kind = onboardingQuestion.kind;
      let answerContext: Partial<typeof projectContext> = {};
      if (kind === "project_type" || kind === "free_text" || kind === "multi_choice" || kind === "yes_no") {
        // For type questions, set as custom type; for others, extend description
        if (kind === "project_type") {
          answerContext = { projectType: "custom", customProjectType: msg };
        } else {
          const existing = projectContext.projectDescription;
          answerContext = {
            projectDescription: existing ? `${existing}\n\n${msg}` : msg,
          };
        }
      } else if (kind === "project_details") {
        answerContext = {
          projectDescription: msg,
        };
      } else if (kind === "colour_direction") {
        answerContext = { colourDirection: msg, customPaletteDirection: msg };
      } else if (kind === "reference_url") {
        // Detect if it looks like a URL
        answerContext = { referenceUrl: msg.startsWith("http") ? msg : null };
      } else {
        answerContext = { projectDescription: msg };
      }
      const nextContext = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
        ...projectContext,
        ...answerContext,
        skippedQuestions: projectContext.skippedQuestions,
      });
      setProjectContext(nextContext);
      void requestOnboarding(sourcePrompt, next, nextContext);
      return;
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
    const intent = classifyIntent(msg, stage, lastAssistant);

    const next: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setPrompt("");
    if (intent === "plan") {
      setSourcePrompt(msg);
      setStage("planning");
      await requestOnboarding(msg, messages, projectContext);
      return;
    }
    const plannerIntent = intent === "update_plan" ? intent : "chat";
    await sendToPlanner(msg, messages, plannerIntent);
  };

  /* ── Build modal helpers ── */
  const confirmBuild = async (nameOverride?: string, instructionOverride?: string) => {
    const id = normalizeId(nameOverride || buildName);
    if (!id || id.length < 3) { setBuildError("Project name must be at least 3 characters"); return; }
    setBuildCreating(true);
    setBuildError(null);

    const buildInstruction = instructionOverride?.trim() ||
      (createdProjectRetryRef.current?.projectId === id ? createdProjectRetryRef.current.instruction : "") || approvedPrompt.trim() ||
      messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n") ||
      "Build a complete modern web application.";

    const retryExisting = createdProjectRetryRef.current?.projectId === id;
    const res = retryExisting ? null : await vcaasApi.projects.create({ projectId: id, description: buildInstruction.slice(0, 200) });
    if (res && !res.ok) {
      setBuildError(res.error || `Could not create "${id}"`);
      setBuildCreating(false);
      setNameModalOpen(true);
      return;
    }

    const id2 = res?.data?.projectId || id;
    if (id2 !== id) toast.info(`"${id}" was taken — your project is "${id2}"`);

    if (figmaToken) {
      const fig = await vcaasApi.figma.connect(id2, { token: figmaToken });
      setFigmaToken(null);
      if (!fig.ok) toast.warning(t("workspace.figma.pendingConnectFailed"), { description: fig.error || undefined });
    }

    setUploading(true);
    const upload = await uploadFilesToProjectDetailed(id2, attachedFiles.map((f) => f.file));
    setUploading(false);
    for (const fail of upload.failed) toast.error(`${fail.name}: ${fail.reason}`);

    const displayPrompt = planRequest || approvedPrompt || buildInstruction;
    const conversation = messages.length > 0 ? messages : [{ role: "user" as const, content: displayPrompt }];
    if (process.env.NEXT_PUBLIC_ORCHESTRATOR_MODE === "local") {
      const persisted = await vcaasApi.agent.appendConversation(id2, conversation.slice(-50).map((message) => ({
        author: message.role === "user" ? "user" as const : "agent" as const,
        message: message.content,
        messageType: "regular" as const,
        createdAt: new Date().toISOString(),
      })), {
        originalPrompt: displayPrompt,
        projectName: projectContext.projectName,
        projectType: projectContext.projectType,
        onboardingAnswers: { ...projectContext },
        referenceUrl: projectContext.referenceUrl,
      });
      if (!persisted.ok) {
        createdProjectRetryRef.current = { projectId: id2, instruction: buildInstruction };
        setBuildName(id2);
        setBuildError(`Project ${id2} was created, but its conversation could not be saved: ${persisted.error || "try again"}. Retry to save it without creating another project.`);
        setBuildCreating(false);
        setNameModalOpen(true);
        return;
      }
    }
    createdProjectRetryRef.current = null;

    try {
      sessionStorage.setItem(`bigbag:pendingPrompt:${id2}`, buildInstruction);
      sessionStorage.setItem(`bigbag:pendingDisplayPrompt:${id2}`, displayPrompt);
      if (projectContext.referenceUrl) {
        sessionStorage.setItem(`bigbag:pendingVisualReferenceUrl:${id2}`, projectContext.referenceUrl);
      }
      if (upload.uploaded.length > 0) sessionStorage.setItem(`bigbag:pendingFiles:${id2}`, JSON.stringify(upload.uploaded));
    } catch { /* ok */ }

    router.push(`/project/${id2}`);
  };

  useEffect(() => {
    if (!pendingDirectBuild || buildCreating) return;
    const request = pendingDirectBuild;
    if (directBuildStartedRef.current === request) return;
    directBuildStartedRef.current = request;
    setPendingDirectBuild(null);
    setBuildName(request.projectId);
    void confirmBuild(request.projectId, request.instruction);
    // The request object is the single trigger. confirmBuild intentionally uses
    // the latest attachments and integration state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDirectBuild]);

  const submitOnboardingAnswer = (answer: OnboardingAnswer) => {
    if (!onboardingQuestion || onboardingRunning) return;
    // A direct user answer is authoritative over an earlier model inference.
    const nextContext = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
      ...projectContext,
      ...answer,
      skippedQuestions: projectContext.skippedQuestions,
    });
    setProjectContext(nextContext);
    void requestOnboarding(sourcePrompt, messages, nextContext);
  };

  const skipOnboardingQuestion = () => {
    if (!onboardingQuestion || onboardingRunning) return;
    const nextContext = mergeProjectContext(projectContext, {
      ...(onboardingQuestion.kind === "project_type" ? { projectType: "website" as const } : {}),
      skippedQuestions: [onboardingQuestion.kind],
    });
    setProjectContext(nextContext);
    void requestOnboarding(sourcePrompt, messages, nextContext);
  };

  const attachLocalFiles = useCallback((files: File[]) => {
    const { allowed, tooLarge } = splitBySize(files);
    if (tooLarge.length === 1) toast.error(t("prompt.attachments.tooLarge", { name: tooLarge[0].name, size: MAX_UPLOAD_MB }), { description: TOO_LARGE_ADVICE });
    else if (tooLarge.length > 1) toast.error(t("prompt.attachments.tooLargeMany", { count: tooLarge.length, size: MAX_UPLOAD_MB }), { description: TOO_LARGE_ADVICE });
    if (allowed.length === 0) return;
    setAttachedFiles((p) => [...p, ...allowed.map((f) => ({ name: f.name, imageDescription: f.name, file: f }))]);
  }, []);

  /* ── Render ── */
  if (status === "loading" || (status !== "authenticated" && !user)) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <header className="relative z-50 border-b border-border/70 bg-background/90 backdrop-blur-md shrink-0">
        <div className="mx-auto flex h-11 max-w-4xl items-center justify-between px-3 sm:px-4">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground shadow-2xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back</span>
          </button>
          <div className="text-center">
            <h1 className="text-xs font-semibold text-foreground">Build something remarkable</h1>
            <p className="text-[10px] text-muted-foreground">Ask questions or describe what to build</p>
          </div>
          <div className="w-14" aria-hidden="true" />
        </div>
      </header>

      {/* ── Chat area ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-3 sm:px-4 py-4 space-y-3.5">
          {messages.length === 0 && !plannerRunning && (
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
                <span className="font-mono text-[9px] font-bold">&lt;/&gt;</span>
              </div>
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-xs border border-border/70 bg-card/60 px-3.5 py-2.5 text-foreground/85">
                <div className="text-xs sm:text-sm leading-relaxed">
                  Hey! I&apos;m your AI assistant. Whether you have a quick question about how bigbag works, need help refining an app idea, or are ready to start building something amazing — I&apos;m here to help. What&apos;s on your mind?
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex items-end justify-end gap-2">
                <div className="max-w-[78%] rounded-xl rounded-br-xs border border-border/80 bg-[color:var(--user-bubble)] px-3.5 py-2 text-xs sm:text-sm leading-relaxed text-foreground shadow-2xs">
                  {msg.content}
                </div>
                <UserAvatar user={user} className="mb-0.5 h-6 w-6 shrink-0" />
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
                  <span className="font-mono text-[9px] font-bold">&lt;/&gt;</span>
                </div>
                <div className="min-w-0 flex-1 rounded-xl rounded-tl-xs border border-border/70 bg-card/60 px-3.5 py-2.5 text-foreground/85">
                  <TypingMessage
                    text={msg.content}
                    active={typingIndex === i}
                    onComplete={() => setTypingIndex(null)}
                  />
                </div>
              </div>
            )
          )}

          {(plannerRunning || onboardingRunning) && (
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground animate-in fade-in duration-200" role="status">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground shadow-2xs">
                <span className="font-mono text-[9px] font-bold">&lt;/&gt;</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-foreground/85">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span>{onboardingRunning ? "Understanding your project…" : "Thinking…"}</span>
              </div>
            </div>
          )}

          {onboardingQuestion && !onboardingOpen && !onboardingRunning && (
            <div className="pl-0 sm:pl-9.5">
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg gap-1.5 cursor-pointer" onClick={() => setOnboardingOpen(true)}>
                <span>Continue project setup</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {onboardingError && !onboardingQuestion && !onboardingRunning && (
            <div className="pl-0 sm:pl-9.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs rounded-lg gap-1.5 cursor-pointer"
                onClick={() => void requestOnboarding(sourcePrompt, messages, projectContext)}
              >
                <span>Retry project setup</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Suggestion chips */}
          {suggestions.length > 0 && !plannerRunning && (
            <section className="pl-0 sm:pl-9.5" aria-labelledby="ideas-heading">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
                <Lightbulb className="h-3 w-3 text-[color:var(--studio-coral)]" />
                <h3 id="ideas-heading">Ideas generated for this conversation</h3>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {suggestions.map((s, i) => (
                  <button
                    key={`${i}-${s.slice(0, 8)}`}
                    type="button"
                    onClick={() => { setPrompt(s); setTimeout(() => textareaRef.current?.focus(), 0); }}
                    className="group flex min-h-8 items-start gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-2 text-left text-xs leading-snug text-foreground/75 transition-colors hover:border-primary/45 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                  >
                    <span className="mt-0.5 font-mono text-[9px] font-semibold text-primary">{String(i + 1).padStart(2, "0")}</span>
                    <span className="group-hover:text-foreground line-clamp-2">{s}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-border/70 bg-background/95 backdrop-blur-md px-3 py-2.5 sm:px-4">
        <div className="mx-auto max-w-2xl">
          <SmartQuestionCard
            open={onboardingOpen}
            question={onboardingQuestion}
            busy={onboardingRunning}
            onOpenChange={setOnboardingOpen}
            onSubmit={submitOnboardingAnswer}
            onSkip={skipOnboardingQuestion}
          />
          <div className="rounded-xl bg-card border border-border/80 shadow-2xs focus-within:ring-1 focus-within:ring-ring/50 focus-within:border-primary/60 transition-all flex flex-col justify-between overflow-hidden">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask a question, or describe what to build…"
              className="w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-xs sm:text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground min-h-[44px] max-h-32"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
              onPaste={(e) => { const f = filesFromClipboard(e.clipboardData); if (f.length) { e.preventDefault(); attachLocalFiles(f); } }}
            />
            <AttachmentPreviews
              className="px-3.5 pb-1.5"
              items={attachedFiles.map((f) => ({ name: f.name, file: f.file, type: f.file.type, size: f.file.size }))}
              onRemove={(i) => setAttachedFiles((p) => p.filter((_, j) => j !== i))}
            />
            <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border/40 bg-muted/15">
              <div className="flex items-center gap-1">
                <label className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted/70">
                  <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) { attachLocalFiles(Array.from(e.target.files)); e.target.value = ""; } }} accept="image/*,.pdf,.svg" />
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AttachChainIcon className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline font-medium text-[11px]">Attach</span>
                </label>
                <FigmaPromptButton
                  onAdd={(text) => setPrompt((p) => p ? `${p}\n\n${text}` : text)}
                  hasText={prompt.trim().length > 0}
                  onConnect={() => setFigmaModalOpen(true)}
                  connected={!!figmaToken}
                  onDisconnect={() => { setFigmaToken(null); toast.success(t("workspace.figma.pendingForgotten")); }}
                  disconnectConfirm={t("workspace.figma.disconnectPendingConfirm")}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={(!prompt.trim() && attachedFiles.length === 0) || plannerRunning || onboardingRunning || buildCreating}
                aria-label="Send"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {plannerRunning || onboardingRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Name modal ── */}
      <Dialog open={nameModalOpen} onOpenChange={(o) => { if (!buildCreating) setNameModalOpen(o); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground font-semibold">Name your project</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Choose a unique name for your project. It will be used in the URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-foreground">Project name</Label>
              <Input
                autoFocus
                placeholder="my-awesome-app"
                value={buildName}
                onChange={(e) => { setBuildName(e.target.value); if (buildError) setBuildError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !buildCreating) void confirmBuild(); }}
                className="mt-1.5 bg-card border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">
                3–35 chars, lowercase, hyphens allowed. ID:{" "}
                <span className="font-mono text-foreground font-medium">{normalizeId(buildName) || "…"}</span>
              </p>
            </div>
            {buildError && (
              <div className="flex items-start gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{buildError}</span>
              </div>
            )}
            <Button
              className="w-full"
              variant="glow"
              onClick={() => void confirmBuild()}
              disabled={buildCreating || normalizeId(buildName).length < 3}
            >
              {buildCreating
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
                : <><ArrowUpRight className="w-4 h-4 mr-2" />Create &amp; Build</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FigmaModal
        open={figmaModalOpen}
        onOpenChange={setFigmaModalOpen}
        onStatusChange={() => {}}
        onPendingToken={(token) => setFigmaToken(token)}
      />
    </div>
  );
}

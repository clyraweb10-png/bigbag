"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { classifyIntent, type ProjectStage } from "@/lib/local-orchestrator/intent-router";

type Message = { role: "user" | "assistant"; content: string };

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
    const t = setInterval(() => setLen((c) => Math.min(text.length, c + Math.max(2, Math.ceil(text.length / 180)))), 18);
    return () => clearInterval(t);
  }, [active, text]);
  useEffect(() => {
    if (!active || len < text.length) return;
    const t = setTimeout(() => onCompleteRef.current(), 180);
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
  const searchParams = useSearchParams();
  const { user, status } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [stage, setStage] = useState<ProjectStage>("idle");
  const [plannerRunning, setPlannerRunning] = useState(false);
  const [approvedPrompt, setApprovedPrompt] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typingIndex, setTypingIndex] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);

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

  /* ── Auth guard ── */
  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated" || !user) {
      const urlPrompt = searchParams.get("prompt") || "";
      if (urlPrompt) sessionStorage.setItem("bigbag:pending-prompt", urlPrompt);
      const returnPath = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
    }
  }, [status, user, router, searchParams]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, plannerRunning, suggestions]);

  /* ── Initialize from URL prompt ── */
  const sendToPlanner = useCallback(async (message: string, history: Message[]) => {
    setPlannerRunning(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "chat", message, history: history.slice(-10) }),
      });
      const payload = await res.json() as { ok: boolean; data?: { text?: string; suggestions?: string[] }; error?: string };
      if (!payload.ok || !payload.data?.text) throw new Error(payload.error || "Assistant unavailable");
      setTypingIndex(history.length);
      setMessages((prev) => [...prev, { role: "assistant", content: payload.data!.text! }]);
      setSuggestions(Array.isArray(payload.data.suggestions) ? payload.data.suggestions.slice(0, 10) : []);
      setStage("awaiting_confirmation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the assistant");
      setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't reach the assistant. Try sending your message again." }]);
    } finally {
      setPlannerRunning(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !user || initialized) return;
    setInitialized(true);
    const urlPrompt = searchParams.get("prompt") || "";
    const saved = (() => { try { return sessionStorage.getItem("bigbag:pending-prompt") || ""; } catch { return ""; } })();
    const initial = urlPrompt || saved;
    if (initial) {
      try { sessionStorage.removeItem("bigbag:pending-prompt"); } catch { /* ok */ }
      setApprovedPrompt(initial);
      const userMsg: Message = { role: "user", content: initial };
      setMessages([userMsg]);
      void sendToPlanner(initial, []);
    }
  }, [status, user, initialized, searchParams, sendToPlanner]);

  /* ── Submit new message ── */
  const handleSubmit = async () => {
    const msg = prompt.trim();
    if ((!msg && attachedFiles.length === 0) || plannerRunning || buildCreating) return;

    if (!msg) {
      setApprovedPrompt("Build a complete application using the attached files as reference.");
      openBuildModal("Build a complete application using the attached files as reference.");
      return;
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
    const intent = classifyIntent(msg, stage, lastAssistant);

    if (intent === "confirm_build") {
      setApprovedPrompt(msg);
      setPrompt("");
      openBuildModal(msg);
      return;
    }

    const next: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setPrompt("");
    if (!approvedPrompt) setApprovedPrompt(msg);
    await sendToPlanner(msg, messages);
  };

  /* ── Build modal helpers ── */
  const openBuildModal = (promptOverride?: string) => {
    const bp = promptOverride?.trim() || approvedPrompt.trim() ||
      messages.filter((m) => m.role === "user").map((m) => m.content).filter(Boolean).join(" ");
    if (!bp && attachedFiles.length === 0) return;
    const words = bp.split(/\s+/).slice(0, 4).join("-");
    setBuildName(normalizeId(words) || `app-${Math.random().toString(36).slice(2, 7)}`);
    setBuildError(null);
    setNameModalOpen(true);
  };

  const confirmBuild = async () => {
    const id = normalizeId(buildName);
    if (!id || id.length < 3) { setBuildError("Project name must be at least 3 characters"); return; }
    setBuildCreating(true);
    setBuildError(null);

    const buildInstruction = approvedPrompt.trim() ||
      messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n") ||
      "Build a complete modern web application.";

    const res = await vcaasApi.projects.create({ projectId: id, description: buildInstruction.slice(0, 200) });
    if (!res.ok) { setBuildError(res.error || `Could not create "${id}"`); setBuildCreating(false); return; }

    const id2 = res.data?.projectId || id;
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

    try {
      sessionStorage.setItem(`bigbag:pendingPrompt:${id2}`, buildInstruction);
      sessionStorage.setItem(`bigbag:pendingDisplayPrompt:${id2}`, approvedPrompt);
      if (upload.uploaded.length > 0) sessionStorage.setItem(`bigbag:pendingFiles:${id2}`, JSON.stringify(upload.uploaded));
    } catch { /* ok */ }

    router.push(`/project/${id2}`);
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
      <header className="relative z-50 border-b border-border bg-background/92 backdrop-blur-xl shrink-0">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center hidden sm:block">
            <h1 className="text-sm font-semibold">Build something remarkable</h1>
            <p className="text-xs text-muted-foreground">Ask questions or chat</p>
          </div>
        </div>
      </header>

      {/* ── Chat area ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
          {messages.length === 0 && !plannerRunning && (
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/15">
                <span className="font-mono text-[10px] font-bold">&lt;/&gt;</span>
              </div>
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-background/55 px-4 py-3 text-foreground/80">
                <div className="text-sm leading-relaxed">
                  Hey! I&apos;m your bigbag AI assistant. Whether you have a quick question about how bigbag works, need help refining an app idea, or are ready to start building something amazing — I&apos;m here to help you every step of the way. What&apos;s on your mind today?
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex items-end justify-end gap-2.5">
                <div className="max-w-[82%] rounded-2xl rounded-br-md border border-border bg-[color:var(--user-bubble)] px-4 py-3 text-sm leading-6 text-foreground shadow-sm">
                  {msg.content}
                </div>
                <UserAvatar user={user} className="mb-0.5 h-8 w-8 shrink-0" />
              </div>
            ) : (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/15">
                  <span className="font-mono text-[10px] font-bold">&lt;/&gt;</span>
                </div>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-background/55 px-4 py-3 text-foreground/80">
                  <TypingMessage
                    text={msg.content}
                    active={typingIndex === i}
                    onComplete={() => setTypingIndex(null)}
                  />
                </div>
              </div>
            )
          )}

          {plannerRunning && (
            <div className="flex items-center gap-3 text-sm text-foreground/65" role="status">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <span className="font-mono text-[10px] font-bold">&lt;/&gt;</span>
              </div>
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking…
              </span>
            </div>
          )}

          {/* Proceed to build */}
          {messages.length > 0 && !plannerRunning && (
            <div className="pl-11">
              <Button
                onClick={() => openBuildModal()}
                className="h-10 rounded-xl px-4 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              >
                <svg className="mr-2 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="7 8 3 12 7 16" />
                  <line x1="14" y1="4" x2="10" y2="20" strokeWidth="2.2" />
                  <polyline points="17 8 21 12 17 16" />
                </svg>
                Proceed to build
              </Button>
            </div>
          )}

          {/* Suggestion chips */}
          {suggestions.length > 0 && !plannerRunning && (
            <section className="pl-0 sm:pl-11" aria-labelledby="ideas-heading">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground/70">
                <Lightbulb className="h-3.5 w-3.5 text-[color:var(--studio-coral)]" />
                <h3 id="ideas-heading">Ideas generated for this conversation</h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((s, i) => (
                  <button
                    key={`${i}-${s.slice(0, 8)}`}
                    type="button"
                    onClick={() => { setPrompt(s); setTimeout(() => textareaRef.current?.focus(), 0); }}
                    className="group flex min-h-11 items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs leading-5 text-foreground/75 transition-colors hover:border-primary/45 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="mt-0.5 font-mono text-[10px] font-semibold text-primary">{String(i + 1).padStart(2, "0")}</span>
                    <span className="group-hover:text-foreground">{s}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl bg-card dark:bg-[#252525] border border-border/80 dark:border-0 overflow-hidden focus-within:ring-2 focus-within:ring-ring/25 transition-all">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask a question, or describe what to build…"
              className="w-full resize-none bg-transparent p-5 pb-3 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground min-h-[82px] max-h-40"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
              onPaste={(e) => { const f = filesFromClipboard(e.clipboardData); if (f.length) { e.preventDefault(); attachLocalFiles(f); } }}
            />
            <AttachmentPreviews
              className="px-5 pb-2"
              items={attachedFiles.map((f) => ({ name: f.name, file: f.file, type: f.file.type, size: f.file.size }))}
              onRemove={(i) => setAttachedFiles((p) => p.filter((_, j) => j !== i))}
            />
            <div className="flex items-center justify-between px-3 py-3 sm:px-4">
              <div className="flex items-center gap-1.5">
                <label className="cursor-pointer flex items-center gap-1.5 text-xs text-[#003399] hover:text-[#002266] dark:text-[#60a5fa] dark:hover:text-[#93c5fd] transition-colors px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                  <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) { attachLocalFiles(Array.from(e.target.files)); e.target.value = ""; } }} accept="image/*,.pdf,.svg" />
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AttachChainIcon className="w-4 h-4" />}
                  <span className="hidden sm:inline font-medium">Attach</span>
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
                disabled={(!prompt.trim() && attachedFiles.length === 0) || plannerRunning || buildCreating}
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-full colourless-glass shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {plannerRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
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

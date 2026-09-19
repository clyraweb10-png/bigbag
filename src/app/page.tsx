"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { vcaasApi } from "@/lib/vcaas";
import {
  CloneProjectDialog,
  ExportProjectDialog,
  ImportProjectDialog,
} from "@/components/workspace/ProjectTransferDialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FigmaModal } from "@/components/workspace/FigmaModal";
import { FigmaPromptButton } from "@/components/prompt/FigmaPromptButton";
import { AttachmentPreviews } from "@/components/workspace/AttachmentPreview";
import { filesFromClipboard } from "@/lib/attachments";
import { t } from "@/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Loader2, Trash2, ArrowRight, Paperclip, X, ArrowUpRight, CopyCheck, DownloadCloud, FileDown,
  Search, Grid2X2, Rows3, SlidersHorizontal, ChevronLeft, ChevronRight,
  AlertCircle, MoreVertical, AlertTriangle, ArrowLeft, CodeXml, Lightbulb,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { toast } from "sonner";
import { uploadFilesToProjectDetailed, splitBySize, MAX_UPLOAD_MB, TOO_LARGE_ADVICE } from "@/lib/upload";
import { SetupBanners } from "@/components/SetupBanners";
import { BigBagLogo } from "@/components/BigBagLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthUserMenu, UserAvatar, useAuth } from "@/components/auth/AuthProvider";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";
import { classifyIntent, type ProjectStage } from "@/lib/local-orchestrator/intent-router";

type ViewMode = "cards" | "table";
type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = "bigbag:dashboard-view";
const LANDING_SESSION_KEY_PREFIX = "bigbag:landing-conversation:v2";


// --- Deterministic gradient + initials for the placeholder thumbnail ---
const GRADIENTS: [string, string][] = [
  ["#6554E8", "#3F8CFF"], ["#FF6B6B", "#8C3F8D"], ["#18A981", "#245A73"],
  ["#4037A4", "#18182A"], ["#D95872", "#532C68"], ["#3F8CFF", "#174B6C"],
  ["#6A5DE8", "#D15A8B"], ["#159B89", "#283C78"],
];
function gradientFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function ProjectThumbnail({
  project, variant = "card",
}: {
  project: { projectId: string; label?: string; previewImageUrl?: string | null };
  variant?: "card" | "row";
}) {
  const { projectId, previewImageUrl } = project;
  const name = project.label || projectId;
  const [imgState, setImgState] = useState<"idle" | "ready" | "failed">("idle");
  const [iframeReady, setIframeReady] = useState(false);
  const [c1, c2] = gradientFor(projectId);
  const isRow = variant === "row";

  // Try loading previewImageUrl as an image (upstream Totalum screenshot)
  useEffect(() => {
    setImgState("idle");
    if (!previewImageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.src = previewImageUrl;
    img
      .decode()
      .then(() => { if (!cancelled) setImgState("ready"); })
      .catch(() => { if (!cancelled) setImgState("failed"); });
    return () => { cancelled = true; };
  }, [previewImageUrl]);

  const hasImage = previewImageUrl && imgState !== "failed";
  // Show live iframe preview when no screenshot image is available.
  // In row variant, iframe is too small to be useful, so skip it.
  const showIframe = !hasImage && !isRow;
  const previewSrc = `/api/preview/${encodeURIComponent(projectId)}/`;

  const placeholder = (
    <div
      className="w-full h-full flex items-center justify-center relative overflow-hidden px-2"
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      <span
        className={`font-semibold text-white/95 tracking-tight text-center leading-tight break-words ${isRow ? "text-[9px] line-clamp-2" : "text-[12px] line-clamp-3"}`}
        title={name}
      >
        {name}
      </span>
      <CodeXml className={`absolute text-white/15 ${isRow ? "w-4 h-4 -right-0.5 -bottom-0.5" : "w-10 h-10 -right-1 -bottom-1"}`} />
    </div>
  );

  return (
    <div className="w-full h-full relative overflow-hidden bg-muted/50">
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImageUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${imgState === "ready" ? "opacity-100" : "opacity-0"}`}
          />
          {imgState !== "ready" && <div className="absolute inset-0">{placeholder}</div>}
        </>
      ) : showIframe ? (
        <>
          {/* Live iframe preview: render the project's preview page scaled down.
           * The iframe is 1280×800 (desktop viewport) shrunk via CSS transform
           * to fit the card thumbnail area. Non-interactive (pointer-events: none). */}
          <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: "none" }}>
            <iframe
              src={previewSrc}
              title={`Preview of ${name}`}
              loading="lazy"
              sandbox="allow-scripts"
              tabIndex={-1}
              onLoad={() => setIframeReady(true)}
              className="border-0 origin-top-left"
              style={{
                width: "1280px",
                height: "800px",
                transform: "scale(0.28)",
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            />
          </div>
          {/* Show placeholder gradient until the iframe loads */}
          {!iframeReady && <div className="absolute inset-0">{placeholder}</div>}
        </>
      ) : (
        placeholder
      )}
    </div>
  );
}

function normalizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 35);
}

type LandingMessage = { role: "user" | "assistant"; content: string };

function LandingMessageContent({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, index) => {
        const key = `${index}-${line.slice(0, 12)}`;
        if (line.startsWith("## ")) return <h2 key={key} className="pt-2 text-base font-semibold text-foreground">{line.slice(3)}</h2>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={key} className="pt-1 font-semibold text-foreground">{line.slice(2, -2)}</p>;
        if (line.startsWith("- ") || line.startsWith("✓ ") || line.startsWith("✗ ")) {
          return <p key={key} className="flex gap-2"><span className="text-primary">•</span><span>{line.replace(/^[-✓✗]\s*/, "")}</span></p>;
        }
        if (line === "---") return <hr key={key} className="my-3 border-border" />;
        if (!line.trim()) return <div key={key} className="h-1" />;
        return <p key={key}>{line.replace(/\*\*/g, "")}</p>;
      })}
    </div>
  );
}

function TypingAssistantMessage({
  text,
  active,
  onComplete,
}: {
  text: string;
  active: boolean;
  onComplete: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(active ? 0 : text.length);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleLength(text.length);
      return;
    }
    setVisibleLength(0);
    const timer = window.setInterval(() => {
      setVisibleLength((current) => Math.min(text.length, current + Math.max(2, Math.ceil(text.length / 180))));
    }, 18);
    return () => window.clearInterval(timer);
  }, [active, text]);

  useEffect(() => {
    if (!active || visibleLength < text.length) return;
    const completionTimer = window.setTimeout(() => onCompleteRef.current(), 180);
    return () => window.clearTimeout(completionTimer);
  }, [active, text.length, visibleLength]);

  return (
    <>
      <div aria-hidden="true">
      <LandingMessageContent text={text.slice(0, visibleLength)} />
      {active && visibleLength < text.length && <span className="assistant-cursor" aria-hidden="true" />}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {active && visibleLength < text.length ? "" : text}
      </p>
    </>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [projects, setProjects] = useState<VcaasProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstPrompt, setFirstPrompt] = useState("");
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [landingMessages, setLandingMessages] = useState<LandingMessage[]>([]);
  const [landingStage, setLandingStage] = useState<ProjectStage>("idle");
  const [plannerRunning, setPlannerRunning] = useState(false);
  const [approvedPrompt, setApprovedPrompt] = useState("");
  const [landingSuggestions, setLandingSuggestions] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [typingMessageIndex, setTypingMessageIndex] = useState<number | null>(null);
  const [conversationHydrated, setConversationHydrated] = useState(false);
  const [hydratedSessionKey, setHydratedSessionKey] = useState<string | null>(null);
  const landingSessionKey = user?.uid ? `${LANDING_SESSION_KEY_PREFIX}:${user.uid}` : null;

  const [attachedFiles, setAttachedFiles] = useState<{ name: string; imageDescription: string; file: File }[]>([]);
  const [uploading, setUploading] = useState(false);

  const [figmaModalOpen, setFigmaModalOpen] = useState(false);
  const [figmaToken, setFigmaToken] = useState<string | null>(null);

  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [buildName, setBuildName] = useState("");
  const [buildCreating, setBuildCreating] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date-desc");
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [page, setPage] = useState(1);

  const [exportTarget, setExportTarget] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const heroTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversationHydrated(false);
    if (!landingSessionKey) {
      setHydratedSessionKey(null);
      return;
    }
    try {
      const saved = sessionStorage.getItem(landingSessionKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          messages?: LandingMessage[];
          stage?: ProjectStage;
          approvedPrompt?: string;
          suggestions?: string[];
          chatOpen?: boolean;
        };
        setLandingMessages(Array.isArray(parsed.messages) ? parsed.messages : []);
        setLandingStage(parsed.stage ?? "idle");
        setApprovedPrompt(typeof parsed.approvedPrompt === "string" ? parsed.approvedPrompt : "");
        setLandingSuggestions(Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 10) : []);
        setChatOpen(parsed.chatOpen === true);
      } else {
        setLandingMessages([]);
        setLandingStage("idle");
        setApprovedPrompt("");
        setLandingSuggestions([]);
        setChatOpen(false);
      }
    } catch {
      setLandingMessages([]);
      setLandingStage("idle");
      setApprovedPrompt("");
      setLandingSuggestions([]);
      setChatOpen(false);
    }
    setHydratedSessionKey(landingSessionKey);
    setConversationHydrated(true);
  }, [landingSessionKey]);

  useEffect(() => {
    if (!landingSessionKey || !conversationHydrated || hydratedSessionKey !== landingSessionKey) return;
    try {
      sessionStorage.setItem(landingSessionKey, JSON.stringify({
        messages: landingMessages,
        stage: landingStage,
        approvedPrompt,
        suggestions: landingSuggestions,
        chatOpen,
      }));
    } catch { /* storage unavailable */ }
  }, [approvedPrompt, chatOpen, conversationHydrated, hydratedSessionKey, landingMessages, landingSessionKey, landingStage, landingSuggestions]);

  useEffect(() => {
    if (!chatOpen) return;
    window.scrollTo(0, 0);
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatOpen, landingMessages, plannerRunning, landingSuggestions]);

  useEffect(() => {
    api.get<{ configured: boolean }>("/api/config").then((r) => {
      setKeyConfigured(r.ok && r.data ? r.data.configured : false);
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await vcaasApi.projects.list();
    if (res.ok && res.data) {
      const list = Array.isArray(res.data) ? res.data : [];
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProjects(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === "cards" || saved === "table") setViewMode(saved);
    } catch { /* storage unavailable */ }
  }, []);

  const chooseView = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch { /* storage unavailable */ }
  };

  const resolvedView: ViewMode = viewMode ?? "cards";

  const attachLocalFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const { allowed, tooLarge } = splitBySize(files);
    if (tooLarge.length === 1) {
      toast.error(t("prompt.attachments.tooLarge", { name: tooLarge[0].name, size: MAX_UPLOAD_MB }), { description: TOO_LARGE_ADVICE });
    } else if (tooLarge.length > 1) {
      toast.error(t("prompt.attachments.tooLargeMany", { count: tooLarge.length, size: MAX_UPLOAD_MB }), { description: TOO_LARGE_ADVICE });
    }
    if (allowed.length === 0) return;
    setAttachedFiles((prev) => [...prev, ...allowed.map((file) => ({ name: file.name, imageDescription: file.name, file }))]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    attachLocalFiles(files);
    e.target.value = "";
  };

  const handleHeroPaste = useCallback((event: React.ClipboardEvent) => {
    const pasted = filesFromClipboard(event.clipboardData);
    if (!pasted.length) return;
    event.preventDefault();
    attachLocalFiles(pasted);
  }, [attachLocalFiles]);

  const appendToPrompt = (text: string) => {
    setFirstPrompt((prev) => (prev ? `${prev}\n\n${text}` : text));
    heroTextareaRef.current?.focus();
  };

  const focusComposer = () => {
    heroTextareaRef.current?.focus();
    heroTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const takenNames = useMemo(() => new Set(projects.map((p) => p.projectId)), [projects]);

  const filtered = useMemo(() => {
    let list = [...projects];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => (p.label || p.projectId).toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      switch (sortKey) {
        case "date-asc": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "name-asc": return (a.label || a.projectId).localeCompare(b.label || b.projectId);
        case "name-desc": return (b.label || b.projectId).localeCompare(a.label || a.projectId);
        case "date-desc":
        default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return list;
  }, [projects, search, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openBuildModal = (promptOverride?: string) => {
    const buildPrompt = promptOverride?.trim() || approvedPrompt.trim();
    if (!buildPrompt && attachedFiles.length === 0) return;
    const words = buildPrompt.split(/\s+/).slice(0, 4).join("-");
    const auto = normalizeId(words) || `app-${Math.random().toString(36).slice(2, 7)}`;
    setBuildName(auto);
    setBuildError(null);
    setNameModalOpen(true);
  };

  const submitLandingMessage = async () => {
    const message = firstPrompt.trim();
    if ((!message && attachedFiles.length === 0) || plannerRunning || buildCreating) return;
    setChatOpen(true);
    setLandingSuggestions([]);
    if (!message) {
      const attachmentPrompt = "Build a complete application using the attached files as the primary product and visual reference.";
      setApprovedPrompt(attachmentPrompt);
      setFirstPrompt("");
      openBuildModal(attachmentPrompt);
      return;
    }

    const lastAgentMessage = [...landingMessages].reverse().find((entry) => entry.role === "assistant")?.content;
    const intent = classifyIntent(message, landingStage, lastAgentMessage);
    if (intent === "confirm_build") {
      setFirstPrompt("");
      openBuildModal();
      return;
    }

    const plannerIntent = intent === "direct_edit" ? "plan" : intent;
    if (plannerIntent !== "chat" && plannerIntent !== "plan" && plannerIntent !== "update_plan") return;

    const nextHistory = [...landingMessages, { role: "user" as const, content: message }];
    setLandingMessages(nextHistory);
    setFirstPrompt("");
    setPlannerRunning(true);
    if (plannerIntent === "plan") {
      setLandingStage("planning");
      setApprovedPrompt(message);
    }

    try {
      const response = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: plannerIntent, message, history: landingMessages.slice(-10) }),
      });
      const payload = await response.json() as { ok: boolean; data?: { text?: string; suggestions?: string[] }; error?: string };
      if (!payload.ok || !payload.data?.text) throw new Error(payload.error || "The assistant is unavailable.");

      setTypingMessageIndex(nextHistory.length);
      setLandingMessages((current) => [...current, { role: "assistant", content: payload.data!.text! }]);
      setLandingSuggestions(Array.isArray(payload.data.suggestions) ? payload.data.suggestions.slice(0, 10) : []);
      if (plannerIntent === "plan" || plannerIntent === "update_plan") setLandingStage("awaiting_confirmation");
    } catch (error) {
      setLandingMessages([...nextHistory, {
        role: "assistant",
        content: "I couldn’t reach the planning service. Your message is saved here—try sending it again when the connection is ready.",
      }]);
      setFirstPrompt(message);
      setLandingStage(landingMessages.length === 0 ? "idle" : landingStage);
      toast.error(error instanceof Error ? error.message : "The assistant is unavailable.");
    } finally {
      setPlannerRunning(false);
    }
  };

  const confirmBuild = async () => {
    const id = normalizeId(buildName);
    if (!id || id.length < 3) {
      setBuildError("Project name must be at least 3 characters");
      return;
    }
    if (takenNames.has(id)) {
      setBuildError(`"${id}" is already in use`);
      return;
    }

    setBuildCreating(true);
    setBuildError(null);
    const latestPlan = [...landingMessages].reverse().find((entry) => entry.role === "assistant" && entry.content.includes("Implementation Plan"))?.content;
    const buildInstruction = latestPlan
      ? `Build the complete application from this approved request and implementation plan.\n\nOriginal request:\n${approvedPrompt}\n\n${latestPlan}`
      : approvedPrompt;

    const res = await vcaasApi.projects.create({ projectId: id, description: approvedPrompt.slice(0, 200) });
    if (!res.ok) {
      setBuildError(res.error || `Could not create "${id}".`);
      setBuildCreating(false);
      return;
    }
    const requested = id;
    const id2 = res.data?.projectId || requested;
    if (id2 !== requested) toast.info(`"${requested}" was taken — your project is "${id2}".`);
    if (figmaToken) {
      const figma = await vcaasApi.figma.connect(id2, { token: figmaToken });
      setFigmaToken(null);
      if (!figma.ok) toast.warning(t("workspace.figma.pendingConnectFailed"), { description: figma.error || undefined });
    }
    let uploadedFiles: { name: string; url: string; imageDescription: string }[] = [];
    setUploading(true);
    const upload = await uploadFilesToProjectDetailed(id2, attachedFiles.map((f) => f.file));
    uploadedFiles = upload.uploaded;
    setUploading(false);
    for (const failure of upload.failed) {
      toast.error(`${failure.name}: ${failure.reason}`, { description: "The agent will not see this file." });
    }
    try {
      sessionStorage.setItem(`bigbag:pendingPrompt:${id2}`, buildInstruction);
      sessionStorage.setItem(`bigbag:pendingDisplayPrompt:${id2}`, approvedPrompt);
      if (uploadedFiles.length > 0) sessionStorage.setItem(`bigbag:pendingFiles:${id2}`, JSON.stringify(uploadedFiles));
    } catch { /* ignore */ }
    router.push(`/project/${id2}`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await vcaasApi.projects.remove(deleteTarget);
    if (res.ok) {
      toast.success("Project deleted");
      setProjects((prev) => prev.filter((p) => p.projectId !== deleteTarget));
      setDeleteTarget(null);
    } else {
      toast.error(res.error || "Failed to delete project");
    }
    setDeleting(false);
  };

  const hasProjects = projects.length > 0;

  return (
    <div className={`${chatOpen ? "h-[100dvh] overflow-hidden" : "min-h-screen overflow-hidden"} relative bg-background text-foreground transition-colors duration-200`}>
      {/* Background */}
      <div className="fixed inset-0 -z-10 bg-background pointer-events-none" />

      {/* Header */}
      {chatOpen ? (
        <header className="relative z-50 border-b border-border bg-background/92 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h1 className="sr-only sm:hidden">Build something remarkable</h1>
            <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 text-center sm:block">
              <h1 className="text-sm font-semibold">Build something remarkable</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Your planning conversation</p>
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-50 border-b border-border/80 bg-background/88 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <BigBagLogo size="md" />
            <div className="flex items-center gap-2">
              <ThemeToggle showLabel={false} />
              <AuthUserMenu />
            </div>
          </div>
        </header>
      )}

      <div className={chatOpen ? "mx-auto flex h-[calc(100dvh-4rem)] max-w-5xl flex-col px-3 py-3 sm:px-6 sm:py-5" : "mx-auto max-w-5xl px-4 py-10 sm:px-6"}>
        {/* Hero prompt */}
        {!loading && (
          <div className={chatOpen ? "flex min-h-0 flex-1 flex-col" : hasProjects || keyConfigured === false ? "mb-10" : "flex min-h-[58vh] flex-col items-center justify-center"}>
            <div className={chatOpen ? "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col" : "mx-auto w-full max-w-2xl"}>
              {!chatOpen && !hasProjects && (
                <div className="mb-8 text-left sm:text-center">
                  <div className="mb-5 flex sm:justify-center"><BigBagLogo size="lg" /></div>
                  <h1 className="text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">Build something remarkable.</h1>
                  <p className="mt-4 text-base leading-7 text-foreground/65">Start with the rough idea. BigBag will help shape the plan before a single file is generated.</p>
                </div>
              )}

              <div className={chatOpen ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
                {landingMessages.length > 0 && (
                  <div className={`${chatOpen ? "min-h-0 flex-1" : "max-h-[430px]"} space-y-6 overflow-y-auto px-1 py-4 sm:px-2 bg-transparent`}>
                    {landingMessages.map((message, index) => message.role === "user" ? (
                      <div key={index} className="flex items-end justify-end gap-2.5">
                        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[color:var(--user-bubble)] px-4 py-3 text-sm leading-6 text-foreground shadow-sm">
                          {message.content}
                        </div>
                        <UserAvatar user={user} className="mb-0.5 h-8 w-8 shrink-0" />
                      </div>
                    ) : (
                      <div key={index} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/15">
                          <span className="font-mono text-[10px] font-bold">&lt;/&gt;</span>
                        </div>
                        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-border bg-background/55 px-4 py-3 text-foreground/80">
                          <TypingAssistantMessage
                            text={message.content}
                            active={typingMessageIndex === index}
                            onComplete={() => setTypingMessageIndex(null)}
                          />
                        </div>
                      </div>
                    ))}
                    {plannerRunning && (
                      <div className="flex items-center gap-3 text-sm text-foreground/65" role="status">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground"><span className="font-mono text-[10px] font-bold">&lt;/&gt;</span></div>
                        <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{landingStage === "planning" ? "Shaping the implementation plan…" : "Thinking through the next move…"}</span>
                      </div>
                    )}
                    {landingStage === "awaiting_confirmation" && !plannerRunning && (
                      <div className="pl-11">
                        <Button onClick={() => openBuildModal()} className="h-10 rounded-xl px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium">
                          <svg
                            className="mr-2 h-4 w-4 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="7 8 3 12 7 16" />
                            <line x1="14" y1="4" x2="10" y2="20" strokeWidth="2.2" />
                            <polyline points="17 8 21 12 17 16" />
                          </svg>
                          Proceed to build
                        </Button>
                      </div>
                    )}
                    {landingSuggestions.length > 0 && !plannerRunning && (
                      <section className="pl-0 sm:pl-11" aria-labelledby="next-ideas-heading">
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground/70">
                          <Lightbulb className="h-3.5 w-3.5 text-[color:var(--studio-coral)]" />
                          <h3 id="next-ideas-heading">Ideas generated for this conversation</h3>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {landingSuggestions.map((suggestion, index) => (
                            <button
                              key={`${index}-${suggestion}`}
                              type="button"
                              onClick={() => {
                                setFirstPrompt(suggestion);
                                window.setTimeout(() => heroTextareaRef.current?.focus(), 0);
                              }}
                              className="group flex min-h-11 items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs leading-5 text-foreground/75 transition-colors hover:border-primary/45 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="mt-0.5 font-mono text-[10px] font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                              <span className="group-hover:text-foreground">{suggestion}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    <div ref={conversationEndRef} />
                  </div>
                )}

                {/* Prompt area - colour + rounded only */}
                <div className={`${landingMessages.length > 0 ? "mt-3 shrink-0" : ""} rounded-2xl bg-[#252525] overflow-hidden focus-within:ring-2 focus-within:ring-ring/25 transition-all`}>
                  <textarea
                    ref={heroTextareaRef}
                    value={firstPrompt}
                    onChange={(e) => setFirstPrompt(e.target.value)}
                    placeholder={landingStage === "awaiting_confirmation" ? "Tell me what to change, or click Proceed…" : "Say hi, or describe the app you want to build…"}
                    className={`w-full resize-none bg-transparent p-5 pb-3 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground ${chatOpen ? "min-h-[104px] max-h-44" : landingMessages.length ? "min-h-[82px]" : "min-h-[112px] sm:min-h-[132px]"}`}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitLandingMessage(); } }}
                    onPaste={handleHeroPaste}
                  />

                  {/* Attachments */}
                  <AttachmentPreviews
                    className="px-5 pb-2"
                    items={attachedFiles.map((f) => ({ name: f.name, file: f.file, type: f.file.type, size: f.file.size }))}
                    onRemove={(index) => setAttachedFiles((prev) => prev.filter((_, j) => j !== index))}
                  />

                  <div className="flex items-center justify-between bg-transparent px-3 py-3 sm:px-4">
                    <div className="flex items-center gap-1.5">
                      <label className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-white/5">
                        <input type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*,.pdf,.svg" />
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">Attach</span>
                      </label>

                      <FigmaPromptButton
                        onAdd={appendToPrompt}
                        hasText={firstPrompt.trim().length > 0}
                        onConnect={() => setFigmaModalOpen(true)}
                        connected={!!figmaToken}
                        onDisconnect={() => {
                          setFigmaToken(null);
                          toast.success(t("workspace.figma.pendingForgotten"));
                        }}
                        disconnectConfirm={t("workspace.figma.disconnectPendingConfirm")}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void submitLandingMessage()}
                      disabled={(!firstPrompt.trim() && attachedFiles.length === 0) || plannerRunning || buildCreating}
                      aria-label="Send"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#948BE8] text-white shadow-xs transition-all hover:bg-[#8379dc] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {plannerRunning ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <ArrowRight className="h-4 w-4 text-white" />}
                    </button>
                  </div>
                </div>
              </div>

              {!chatOpen && keyConfigured === false && <SetupBanners />}
            </div>
          </div>
        )}

        {/* Projects */}
        {!chatOpen && hasProjects && (
          <>
            {/* Toolbar: search, sort, view toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Projects</h2>
                <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2.5 py-0.5 border border-border/50">
                  {filtered.length}
                </span>
              </div>

              <div className="flex-1 flex flex-wrap items-center gap-2 sm:justify-end">
                {/* Search */}
                <div className="relative flex-1 sm:flex-none sm:w-56 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects..."
                    className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-border bg-card/70 text-foreground outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Sort */}
                <div className="relative">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="h-8 pl-8 pr-6 text-xs rounded-lg border border-border bg-card/70 text-foreground outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer"
                  >
                    <option value="date-desc">Newest first</option>
                    <option value="date-asc">Oldest first</option>
                    <option value="name-asc">Name A–Z</option>
                    <option value="name-desc">Name Z–A</option>
                  </select>
                </div>

                {/* View toggle */}
                <div className="flex items-center rounded-lg border border-border bg-card p-0.5 shadow-xs">
                  <button
                    onClick={() => chooseView("cards")}
                    title="Card view"
                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-all ${resolvedView === "cards" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Grid2X2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => chooseView("table")}
                    title="Table view"
                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-all ${resolvedView === "table" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Rows3 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Import */}
                <button
                  onClick={() => setImportOpen(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 rounded-lg border border-border bg-card/70 hover:bg-card transition-colors shadow-xs"
                  title="Import a project"
                >
                  <DownloadCloud className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Import</span>
                </button>

                {/* New project */}
                <button
                  onClick={focusComposer}
                  className="flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 h-8 px-3 rounded-lg transition-all shadow-xs"
                  title="New project"
                >
                  <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New</span>
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No projects match &ldquo;{search}&rdquo;</p>
              </div>
            ) : resolvedView === "cards" ? (
              /* ── CARD VIEW ── */
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pageItems.map((p) => (
                  <Link key={p.projectId} href={`/project/${p.projectId}`}>
                    <div className="lovable-card bg-card border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary/50 transition-all duration-200 cursor-pointer group h-full flex flex-col">
                      <div className="h-32 relative overflow-hidden bg-muted/40">
                        <ProjectThumbnail project={p} />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-primary/5 transition-colors pointer-events-none" />
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between mb-1">
                            <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate flex-1">
                              {p.projectId}
                            </h3>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  title="Options"
                                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all shrink-0 ml-2"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 bg-card border-border" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setCloneTarget(p.projectId); }}
                                >
                                  <CopyCheck className="w-3.5 h-3.5 mr-2" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setExportTarget(p.projectId); }}
                                >
                                  <FileDown className="w-3.5 h-3.5 mr-2" /> Export…
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setDeleteTarget(p.projectId); }}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">{p.description || "No description"}</p>
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                          <span className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              /* ── TABLE VIEW ── */
              <div className="lovable-card bg-card border border-border rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="font-medium px-4 py-2.5 w-16">Preview</th>
                        <th className="font-medium px-2 py-2.5">Project</th>
                        <th className="font-medium px-2 py-2.5 hidden md:table-cell">Description</th>
                        <th className="font-medium px-2 py-2.5 whitespace-nowrap">Created</th>
                        <th className="font-medium px-4 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((p) => (
                        <tr
                          key={p.projectId}
                          onClick={() => router.push(`/project/${p.projectId}`)}
                          className="border-b border-border/60 last:border-0 hover:bg-accent/40 cursor-pointer transition-colors group"
                        >
                          <td className="px-4 py-2">
                            <div className="w-11 h-8 rounded-md overflow-hidden border border-border">
                              <ProjectThumbnail project={p} variant="row" />
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{p.projectId}</span>
                          </td>
                          <td className="px-2 py-2 hidden md:table-cell">
                            <span className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">{p.description || "No description"}</span>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  title="Options"
                                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 bg-card border-border" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setCloneTarget(p.projectId); }}
                                >
                                  <CopyCheck className="w-3.5 h-3.5 mr-2" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setExportTarget(p.projectId); }}
                                >
                                  <FileDown className="w-3.5 h-3.5 mr-2" /> Export…
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer"
                                  onSelect={(e) => { e.preventDefault(); setDeleteTarget(p.projectId); }}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pagination */}
            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-muted-foreground px-2">Page {safePage} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}

        {!chatOpen && loading && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-xl bg-card/60" />)}
          </div>
        )}
      </div>

      {/* Name modal for the Build flow */}
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
                onKeyDown={(e) => { if (e.key === "Enter" && !buildCreating) confirmBuild(); }}
                className="mt-1.5 bg-card border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">3-35 chars, lowercase, hyphens allowed. Final id: <span className="font-mono text-foreground font-medium">{normalizeId(buildName) || "…"}</span></p>
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
              onClick={confirmBuild}
              disabled={buildCreating || normalizeId(buildName).length < 3}
            >
              {buildCreating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : <><ArrowUpRight className="w-4 h-4 mr-2" /> Create & Build</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Destructive confirmation modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md overflow-hidden p-0 gap-0 bg-card border-border">
          <div className="relative bg-gradient-to-br from-red-500/10 to-rose-500/15 px-6 pt-7 pb-6 text-center border-b border-border">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-card shadow-sm border border-border flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <DialogHeader className="mt-4">
              <DialogTitle className="text-center text-lg font-semibold text-foreground">Delete this project?</DialogTitle>
              <DialogDescription className="sr-only">Confirm permanent deletion of the project</DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-foreground text-center leading-relaxed">
              You&rsquo;re about to permanently delete{" "}
              <span className="font-semibold text-foreground font-mono break-all">{deleteTarget}</span>.
            </p>
            <div className="flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This action is <strong>irreversible</strong>. Once deleted, the project and all its data cannot be recovered.</span>
            </div>

            <div className="flex gap-2.5 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
                ) : (
                  <><Trash2 className="w-4 h-4 mr-2" /> Delete forever</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Figma modal */}
      <FigmaModal
        open={figmaModalOpen}
        onOpenChange={setFigmaModalOpen}
        onStatusChange={() => {}}
        onPendingToken={token => setFigmaToken(token)}
      />

      {/* Export / Import / Duplicate dialogs */}
      <ExportProjectDialog
        open={exportTarget !== null}
        onOpenChange={open => {
          if (!open) setExportTarget(null);
        }}
        projectId={exportTarget ?? ""}
      />
      <ImportProjectDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        takenNames={takenNames}
        onImported={fetchData}
      />
      <CloneProjectDialog
        open={cloneTarget !== null}
        onOpenChange={open => {
          if (!open) setCloneTarget(null);
        }}
        projectId={cloneTarget ?? ""}
        takenNames={takenNames}
        onCloned={fetchData}
      />
    </div>
  );
}

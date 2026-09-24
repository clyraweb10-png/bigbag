"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { LandingPageMarketing } from "@/components/marketing/LandingPage";
import { vcaasApi } from "@/lib/vcaas";
import {
  CloneProjectDialog,
  ExportProjectDialog,
  ImportProjectDialog,
} from "@/components/workspace/ProjectTransferDialogs";
import { ConnectorsModal } from "@/components/workspace/ConnectorsModal";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FigmaModal } from "@/components/workspace/FigmaModal";
import { FigmaPromptButton } from "@/components/prompt/FigmaPromptButton";
import { AttachmentPreviews } from "@/components/workspace/AttachmentPreview";
import { filesFromClipboard } from "@/lib/attachments";
import { t } from "@/i18n";
import { AttachChainIcon } from "@/components/prompt/ComposerIcons";
import {
  Plus, Loader2, Trash2, ArrowRight, X, ArrowUpRight, CopyCheck, DownloadCloud, FileDown,
  Search, Grid2X2, Rows3, SlidersHorizontal, ChevronLeft, ChevronRight,
  AlertCircle, MoreVertical, AlertTriangle, ArrowLeft, Lightbulb, Plug2,
} from "lucide-react";

import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { toast } from "sonner";
import { uploadFilesToProjectDetailed, splitBySize, MAX_UPLOAD_MB, TOO_LARGE_ADVICE } from "@/lib/upload";
import { SetupBanners } from "@/components/SetupBanners";
import { SkeletonProjectGrid, SkeletonProjectTable } from "@/components/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserAvatar, useAuth } from "@/components/auth/AuthProvider";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { SidebarExpandIcon } from "@/components/SidebarIcons";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";

import type { ProjectStage } from "@/lib/local-orchestrator/intent-router";
import { getCachedScreenshot } from "@/lib/project-screenshot";
import { StarterTemplateGallery } from "@/components/dashboard/StarterTemplateGallery";

type ViewMode = "cards" | "table";
type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = "bigbag:dashboard-view";
const LANDING_SESSION_KEY_PREFIX = "bigbag:landing-conversation:v2";
const SIDEBAR_STORAGE_KEY = "bigbag:dashboard-sidebar-open";


function ProjectThumbnail({
  project, variant = "card",
}: {
  project: { projectId: string; label?: string; previewImageUrl?: string | null };
  variant?: "card" | "row";
}) {
  const { projectId, previewImageUrl } = project;
  const name = project.label || projectId;
  const [imgState, setImgState] = useState<"idle" | "ready" | "failed">("idle");
  const isRow = variant === "row";

  // Prefer the locally-cached Firecrawl screenshot (most recent run) over the
  // Totalum-supplied previewImageUrl (retaken by account-backend, may lag).
  // Initialised as null to be SSR-safe; populated on first client render.
  const [cachedScreenshot, setCachedScreenshot] = useState<string | null>(null);
  useEffect(() => {
    setCachedScreenshot(getCachedScreenshot(projectId));
  }, [projectId]);

  // Listen for new screenshots captured while this tab is open (e.g. after
  // navigating back from the workspace). Storage events fire across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === `bigbag:preview-screenshot:${projectId}` && e.newValue) {
        try {
          const entry = JSON.parse(e.newValue) as { url: string };
          if (entry.url) setCachedScreenshot(entry.url);
        } catch { /* malformed entry */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  // The effective image to display — cached screenshot wins, then Totalum's.
  const effectiveImageUrl = cachedScreenshot ?? previewImageUrl ?? null;

  // Try loading effectiveImageUrl as an image
  useEffect(() => {
    setImgState("idle");
    if (!effectiveImageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.src = effectiveImageUrl;
    img
      .decode()
      .then(() => { if (!cancelled) setImgState("ready"); })
      .catch(() => { if (!cancelled) setImgState("failed"); });
    return () => { cancelled = true; };
  }, [effectiveImageUrl]);

  const hasImage = Boolean(effectiveImageUrl && imgState !== "failed");

  // Dark neutral fallback — just the </> logo, no gradient, no project name.
  const placeholder = (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: "#111113" }}
    >
      <span
        className={`font-mono font-bold select-none text-white/20 ${isRow ? "text-[10px]" : "text-2xl"}`}
        aria-hidden="true"
      >
        {"</>"}
      </span>
    </div>
  );

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#111113]" title={name}>
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={effectiveImageUrl!}
            alt={name}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${imgState === "ready" ? "opacity-100" : "opacity-0"}`}
          />
          {imgState !== "ready" && <div className="absolute inset-0">{placeholder}</div>}
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

/** Root page — shows marketing landing to guests, dashboard to signed-in users */
export default function RootPage() {
  const { user, status } = useAuth();
  // Show marketing landing for unauthenticated visitors (including loading state)
  if (status !== "authenticated" || !user) {
    return <LandingPageMarketing />;
  }
  return <DashboardContent />;
}

export function DashboardContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [projects, setProjects] = useState<VcaasProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [firstPrompt, setFirstPrompt] = useState("");
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [landingMessages, setLandingMessages] = useState<LandingMessage[]>([]);
  const [landingStage, setLandingStage] = useState<ProjectStage>("idle");
  const [plannerRunning] = useState(false);
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
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [dashTab, setDashTab] = useState<"projects" | "starter">("projects");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved !== null) {
        setSidebarOpen(saved === "true");
      } else if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
          return;
        }
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleSidebar]);


  const heroTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await vcaasApi.projects.list();
      if (!res.ok) throw new Error(res.error || "Could not load projects");
      const list = Array.isArray(res.data) ? res.data : [];
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProjects(list);
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Could not load projects");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-switch new users (no projects yet) to the Starter tab so they land on templates.
  useEffect(() => {
    if (!projectsLoading && projects.length === 0 && !projectsError) {
      setDashTab("starter");
    }
  }, [projectsLoading, projects.length, projectsError]);

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
    const buildPrompt =
      promptOverride?.trim() ||
      approvedPrompt.trim() ||
      landingMessages
        .filter((m) => m.role === "user")
        .map((m) => m.content.trim())
        .filter(Boolean)
        .join(" ");
    if (!buildPrompt && attachedFiles.length === 0) return;
    setBuildName("");
    setBuildError(null);
    setNameModalOpen(true);
  };

  const submitLandingMessage = async () => {
    const message = firstPrompt.trim();
    if ((!message && attachedFiles.length === 0) || plannerRunning || buildCreating) return;

    // Redirect to the dedicated generation/chat page
    try {
      if (message) sessionStorage.setItem("bigbag:pending-prompt", message);
    } catch { /* storage unavailable */ }
    setFirstPrompt("");
    router.push("/generate");
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
    const userMessages = landingMessages
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.content.trim())
      .filter(Boolean);
    const conversationPrompt = userMessages.length > 0 ? userMessages.join("\n\n") : "";
    const buildInstruction = approvedPrompt.trim() || conversationPrompt || "Build a complete modern web application.";

    const res = await vcaasApi.projects.create({ projectId: id, description: buildInstruction.slice(0, 200) });
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
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 -z-10 bg-background pointer-events-none" />

      {/* Sidebar */}
      <DashboardSidebar
        projects={projects}
        isOpen={sidebarOpen}
        onClose={() => {
          setSidebarOpen(false);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
          } catch {}
        }}
        onOpen={() => {
          setSidebarOpen(true);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
          } catch {}
        }}
        onToggle={handleToggleSidebar}
        onConnectorsOpen={() => setConnectorsOpen(true)}
        onSearchFocus={() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onNewProject={focusComposer}
      />

      {/* Main content */}
      <div className={`flex-1 overflow-y-auto ${chatOpen ? "overflow-hidden" : ""}`}>
        {/* Top bar: mobile sidebar open button + theme toggle */}
        {!chatOpen && (
          <div className="flex items-center justify-between gap-2 px-6 pt-4 pb-0">
            <div>
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setSidebarOpen(true);
                    try {
                      localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
                    } catch {}
                  }}
                  className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/80 bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-all shadow-2xs text-xs font-medium cursor-pointer group"
                  title="Open sidebar (Ctrl+B)"
                  aria-label="Open sidebar"
                >
                  <SidebarExpandIcon className="w-4 h-4 text-foreground/80 group-hover:text-foreground" />
                  <span className="hidden sm:inline">Sidebar</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle showLabel={false} />
            </div>
          </div>
        )}
        {chatOpen && (
          <div className="flex h-16 items-center justify-between px-6 border-b border-border/80 bg-background/88 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setSidebarOpen(true);
                    try {
                      localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
                    } catch {}
                  }}
                  className="md:hidden p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Open sidebar (Ctrl+B)"
                  aria-label="Open sidebar"
                >
                  <SidebarExpandIcon className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle showLabel={false} />
            </div>
          </div>
        )}

      <div className={chatOpen ? "mx-auto flex h-[calc(100dvh-4rem)] max-w-5xl flex-col px-3 py-3 sm:px-6 sm:py-5" : "mx-auto max-w-6xl px-6 py-6"}>
        {/* Hero prompt */}
        <div className={chatOpen ? "flex min-h-0 flex-1 flex-col" : hasProjects || projectsLoading || keyConfigured === false || dashTab === "starter" ? "mb-12 sm:mb-14" : "flex min-h-[55vh] flex-col items-center justify-center"}>
            <div className={chatOpen ? "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col" : "mx-auto w-full max-w-2xl"}>
              {!chatOpen && landingMessages.length === 0 && (
                <div className="mb-8 text-center">
                  <div className="mb-4 flex justify-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/70 dark:bg-white/5 px-3.5 py-1 text-xs font-medium text-foreground/80 shadow-xs backdrop-blur-sm">
                      <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 text-primary font-mono text-[11px] font-bold">
                        &lt;/&gt;
                      </div>
                      <span>AI App Builder</span>
                    </div>
                  </div>
                  <h1 className="text-balance text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.08] tracking-[-0.035em] text-foreground">
                    Think it, build it <span className="font-mono font-bold text-primary">&lt;/&gt;</span>
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                    Describe the app you want to build, or ask any questions to get started.
                  </p>
                </div>
              )}

              <div className={chatOpen ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
                {landingMessages.length > 0 && (
                  <div className={`${chatOpen ? "min-h-0 flex-1" : "max-h-[430px]"} space-y-6 overflow-y-auto px-1 py-4 sm:px-2 bg-transparent`}>
                    {landingMessages.map((message, index) => message.role === "user" ? (
                      <div key={index} className="flex items-end justify-end gap-2.5">
                        <div className="max-w-[82%] rounded-2xl rounded-br-md border border-border bg-[color:var(--user-bubble)] px-4 py-3 text-sm leading-6 text-foreground shadow-sm">
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
                        <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking…</span>
                      </div>
                    )}
                    {landingMessages.length > 0 && !plannerRunning && (
                      <div className="pl-11">
                        <Button onClick={() => openBuildModal()} className="h-10 rounded-xl px-4 colourless-glass transition-all font-medium cursor-pointer">
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
                <div className={`${landingMessages.length > 0 ? "mt-3 shrink-0" : ""} rounded-2xl bg-card dark:bg-[#444444] border border-border/80 dark:border-0 overflow-hidden focus-within:ring-2 focus-within:ring-ring/25 transition-all`}>
                  <textarea
                    ref={heroTextareaRef}
                    value={firstPrompt}
                    onChange={(e) => setFirstPrompt(e.target.value)}
                    placeholder={chatOpen ? "Ask a question, or describe what to build…" : "Ask a question, or describe the app you want to build…"}
                    className={`w-full resize-none bg-transparent p-5 pb-3 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground ${chatOpen ? "min-h-[83px] max-h-36" : landingMessages.length ? "min-h-[66px]" : "min-h-[90px] sm:min-h-[106px]"}`}
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
                      <label className="cursor-pointer flex items-center gap-1.5 text-xs text-[#003399] hover:text-[#002266] dark:text-[#60a5fa] dark:hover:text-[#93c5fd] transition-colors px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                        <input type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*,.pdf,.svg" />
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#003399] dark:text-[#60a5fa]" /> : <AttachChainIcon className="w-4 h-4 text-[#003399] dark:text-[#60a5fa]" />}
                        <span className="hidden sm:inline font-medium">Attach</span>
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
                      className="flex h-8 w-8 items-center justify-center rounded-full colourless-glass shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {plannerRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {!chatOpen && keyConfigured === false && <SetupBanners />}
            </div>
          </div>

        {!chatOpen && projectsLoading && (
          <div className="mb-6">
            {viewMode === "table" ? (
              <SkeletonProjectTable rows={4} />
            ) : (
              <SkeletonProjectGrid count={3} />
            )}
          </div>
        )}

        {!chatOpen && !projectsLoading && projectsError && !hasProjects && (
          <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-8 text-center" role="alert">
            <AlertCircle className="h-6 w-6 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-foreground">Projects could not be loaded</p>
              <p className="mt-1 text-xs text-muted-foreground">{projectsError}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchData()}>Try again</Button>
          </div>
        )}

        {!chatOpen && !projectsLoading && projectsError && hasProjects && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-xs font-semibold text-foreground">Showing your last loaded projects</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Refresh failed: {projectsError}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchData()}>Retry refresh</Button>
          </div>
        )}

        {/* Projects + Starter — always visible for logged-in users */}
        {!chatOpen && !projectsLoading && (
          <>


            {/* ── Tab switcher: Projects | Templates ── */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <div className="flex items-center gap-1 p-0.5 rounded-xl border border-border bg-card shadow-xs">
                <button
                  onClick={() => setDashTab("starter")}
                  className={`flex items-center gap-1.5 h-7 px-3.5 rounded-lg text-xs font-medium transition-all ${dashTab === "starter" ? "colourless-glass text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Templates
                </button>
                <button
                  onClick={() => setDashTab("projects")}
                  className={`flex items-center gap-1.5 h-7 px-3.5 rounded-lg text-xs font-medium transition-all ${dashTab === "projects" ? "colourless-glass text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Projects
                  <span className={`text-[10px] rounded-full px-1.5 py-0.5 transition-colors ${dashTab === "projects" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                    {filtered.length}
                  </span>
                </button>
              </div>

              {dashTab === "projects" && (
              <div className="flex-1 flex flex-wrap items-center gap-2 sm:justify-end">
                {/* Search */}
                <div className="relative flex-1 sm:flex-none sm:w-56 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
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
                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-all ${resolvedView === "cards" ? "colourless-glass font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Grid2X2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => chooseView("table")}
                    title="Table view"
                    className={`h-7 w-7 flex items-center justify-center rounded-md transition-all ${resolvedView === "table" ? "colourless-glass font-medium" : "text-muted-foreground hover:text-foreground"}`}
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

                {/* Connect */}
                <button
                  onClick={() => setConnectorsOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 rounded-lg border border-border bg-card/70 hover:bg-card transition-colors shadow-xs"
                  title="Add a connector"
                >
                  <Plug2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Connect</span>
                </button>

                {/* New project */}
                <button
                  onClick={focusComposer}
                  className="flex items-center gap-1 text-xs colourless-glass h-8 px-3 rounded-lg transition-all shadow-xs cursor-pointer"
                  title="New project"
                >
                  <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New</span>
                </button>
              </div>
              )}
            </div>

            {/* ── Projects tab content ── */}
            {dashTab === "projects" && (<>
            {!hasProjects ? (
              <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary font-mono text-lg font-bold">{"</>"}</div>
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">No projects yet</p>
                <p className="text-xs text-muted-foreground mb-4">Start building from a prompt above, or pick a template from the <button onClick={() => setDashTab("starter")} className="underline hover:text-foreground transition-colors">Templates</button> tab.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No projects match &ldquo;{search}&rdquo;</p>
              </div>
            ) : resolvedView === "cards" ? (
              /* ── CARD VIEW (image-4 style) ── */
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pageItems.map((p) => {
                  const initial = (user?.displayName || user?.email || "U")[0].toUpperCase();
                  const editedAt = p.lastModifiedAt ?? p.createdAt;
                  const diffMs = Date.now() - new Date(editedAt).getTime();
                  const diffMins = Math.floor(diffMs / 60000);
                  const relTime = diffMins < 60
                    ? `${diffMins || 1} min${diffMins !== 1 ? "s" : ""} ago`
                    : diffMins < 1440
                    ? `${Math.floor(diffMins / 60)} hour${Math.floor(diffMins / 60) !== 1 ? "s" : ""} ago`
                    : diffMins < 43200
                    ? `${Math.floor(diffMins / 1440)} day${Math.floor(diffMins / 1440) !== 1 ? "s" : ""} ago`
                    : new Date(editedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  return (
                    <div key={p.projectId} className="group relative">
                      <Link href={`/project/${p.projectId}`}>
                        <div className="bg-card rounded-2xl overflow-hidden hover:ring-1 hover:ring-white/20 dark:hover:ring-white/15 transition-all duration-200 cursor-pointer">
                          {/* Thumbnail */}
                          <div className="h-44 relative overflow-hidden bg-muted/40">
                            <ProjectThumbnail project={p} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                          </div>
                          {/* Meta */}
                          <div className="p-3.5 flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shrink-0">
                              {initial}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                {p.label || p.projectId}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">Edited {relTime}</p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  title="Options"
                                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all shrink-0"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 bg-card border-border" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem className="cursor-pointer" onSelect={(e) => { e.preventDefault(); setCloneTarget(p.projectId); }}>
                                  <CopyCheck className="w-3.5 h-3.5 mr-2" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer" onSelect={(e) => { e.preventDefault(); setExportTarget(p.projectId); }}>
                                  <FileDown className="w-3.5 h-3.5 mr-2" /> Export…
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer" onSelect={(e) => { e.preventDefault(); setDeleteTarget(p.projectId); }}>
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </Link>
                    </div>
                  );
                })}
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
            </>)}

            {/* ── Starter tab content: Rich Template Gallery ── */}
            {dashTab === "starter" && (
              <StarterTemplateGallery />
            )}
          </>
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

      {/* Connectors modal */}
      <ConnectorsModal open={connectorsOpen} onOpenChange={setConnectorsOpen} />
      </div>
    </div>
  );
}

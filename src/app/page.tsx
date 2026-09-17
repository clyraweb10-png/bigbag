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
  Plus, Loader2, Trash2, SendHorizontal, Paperclip, X, ArrowUpRight, CopyCheck, DownloadCloud, FileDown,
  Search, Grid2X2, Rows3, SlidersHorizontal, ChevronLeft, ChevronRight,
  AlertCircle, MoreVertical, AlertTriangle, CodeXml, Braces, Sparkles,
  Link2, Palette, ShieldCheck,
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
import { UserMenu } from "@/components/auth/UserMenu";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";

type ViewMode = "cards" | "table";
type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const PAGE_SIZE = 20;
const VIEW_MODE_KEY = "bigbag:dashboard-view";


// --- Deterministic gradient + initials for the placeholder thumbnail ---
const GRADIENTS: [string, string][] = [
  ["#5B7A8C", "#3A3A3A"], ["#001f24", "#3A3A3A"], ["#4A6574", "#2B353F"],
  ["#003842", "#0B0B0A"], ["#3A3A3A", "#1E1E1C"], ["#5B7A8C", "#001f24"],
  ["#3A5B6A", "#1A262E"], ["#005563", "#001f24"],
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
  const [state, setState] = useState<"idle" | "ready" | "failed">("idle");
  const [c1, c2] = gradientFor(projectId);
  const isRow = variant === "row";

  useEffect(() => {
    setState("idle");
    if (!previewImageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.src = previewImageUrl;
    img
      .decode()
      .then(() => { if (!cancelled) setState("ready"); })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; };
  }, [previewImageUrl]);

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
      {previewImageUrl && state !== "failed" ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImageUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`}
          />
          {state !== "ready" && <div className="absolute inset-0">{placeholder}</div>}
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

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<VcaasProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstPrompt, setFirstPrompt] = useState("");
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);

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

  const openBuildModal = () => {
    if (!firstPrompt.trim() && attachedFiles.length === 0) return;
    const words = firstPrompt.trim().split(/\s+/).slice(0, 4).join("-");
    const auto = normalizeId(words) || `app-${Math.random().toString(36).slice(2, 7)}`;
    setBuildName(auto);
    setBuildError(null);
    setNameModalOpen(true);
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

    if (attachedFiles.length === 0) {
      const launched = await vcaasApi.projects.launch({
        projectId: id,
        prompt: firstPrompt.trim(),
        description: firstPrompt.trim().slice(0, 200),
        ...(figmaToken ? { figma: { token: figmaToken } } : {}),
      });
      setFigmaToken(null);

      if (!launched.ok || !launched.data) {
        setBuildError(launched.error || `Could not create "${id}". Please try a different name.`);
        setBuildCreating(false);
        return;
      }

      const created = launched.data.projectId;
      if (launched.data.requestedProjectId && launched.data.requestedProjectId !== created) {
        toast.info(`"${launched.data.requestedProjectId}" was taken — your project is "${created}".`);
      }
      if (!launched.data.agent?.started) {
        launched.data.warnings?.forEach(w => w?.step !== "figma" && w?.message && toast.warning(w.message));
        try {
          sessionStorage.setItem(`bigbag:pendingPrompt:${created}`, firstPrompt.trim());
        } catch { /* ignore */ }
      }
      if (launched.data.warnings?.some(w => w?.step === "figma")) {
        toast.warning(t("workspace.figma.pendingConnectFailed"));
      }
      router.push(`/project/${created}`);
      return;
    }

    const res = await vcaasApi.projects.create({ projectId: id, description: firstPrompt.trim().slice(0, 200) });
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
      sessionStorage.setItem(`bigbag:pendingPrompt:${id2}`, firstPrompt.trim());
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
  const referenceUrl = firstPrompt.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,;:!?]+$/, "");

  return (
    <div className="min-h-screen relative overflow-hidden bg-background text-foreground transition-colors duration-200">
      <div className="studio-grid fixed inset-0 -z-20 pointer-events-none" />
      <div className="studio-orb studio-orb-one fixed -z-10 pointer-events-none" />
      <div className="studio-orb studio-orb-two fixed -z-10 pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/75 border-b border-border/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <BigBagLogo size="md" />
          <div className="flex items-center gap-1.5">
            {hasProjects && (
              <button
                onClick={focusComposer}
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New project
              </button>
            )}
            <ThemeToggle showLabel={false} />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero prompt */}
        {!loading && (
          <section className={hasProjects || keyConfigured === false ? "mb-12" : "flex flex-col items-center justify-center min-h-[66vh]"}>
            <div className="w-full max-w-3xl mx-auto">
              {!hasProjects && (
                <div className="mb-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-700">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary mb-5">
                    <Sparkles className="w-3.5 h-3.5" /> AI product studio
                  </div>
                  <h1 className="text-balance text-4xl sm:text-5xl md:text-[3.5rem] md:leading-[1.02] font-semibold tracking-[-0.045em] text-foreground">
                    Turn an idea into a product<br className="hidden sm:block" /> people want to use.
                  </h1>
                  <p className="mt-5 mx-auto max-w-xl text-sm sm:text-base leading-7 text-muted-foreground">
                    Describe the experience—or paste a website you love. BigBag designs, builds, checks, and previews the complete app in one flow.
                  </p>
                </div>
              )}

              <div className="composer-shell rounded-[1.35rem] border border-border/80 bg-card/90 backdrop-blur-xl transition-all duration-300 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                    <Braces className="w-3.5 h-3.5 text-primary" /> What should we build?
                  </div>
                  {referenceUrl && (
                    <div className="max-w-[48%] inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary" title={referenceUrl}>
                      <Link2 className="w-3 h-3 shrink-0" />
                      <span className="truncate">Reference detected</span>
                    </div>
                  )}
                </div>
                <textarea
                  ref={heroTextareaRef}
                  value={firstPrompt}
                  onChange={(e) => setFirstPrompt(e.target.value)}
                  aria-label="Describe the app you want to build"
                  placeholder="Build a calm finance dashboard for freelancers—or recreate the visual direction from https://example.com"
                  className="w-full min-h-[116px] sm:min-h-[142px] resize-none text-[15px] sm:text-base px-5 py-4 outline-none placeholder:text-muted-foreground/55 bg-transparent text-foreground leading-7"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); openBuildModal(); } }}
                  onPaste={handleHeroPaste}
                />

                {/* Attachments */}
                <AttachmentPreviews
                  className="px-5 pb-2"
                  items={attachedFiles.map((f) => ({ name: f.name, file: f.file, type: f.file.type, size: f.file.size }))}
                  onRemove={(index) => setAttachedFiles((prev) => prev.filter((_, j) => j !== index))}
                />

                <div className="flex items-center justify-between px-3.5 sm:px-4 py-3 border-t border-border/60 bg-secondary/25">
                  <div className="flex items-center gap-1.5">
                    <label className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-secondary/60 dark:hover:bg-white/5">
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

                  <Button
                    onClick={openBuildModal}
                    disabled={(!firstPrompt.trim() && attachedFiles.length === 0) || buildCreating}
                    size="sm"
                    className="flex items-center gap-1.5 font-semibold px-4 h-9 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-40 shadow-sm shadow-primary/20"
                  >
                    <SendHorizontal className="w-3.5 h-3.5" />
                    <span>Build App</span>
                  </Button>
                </div>
              </div>

              {!hasProjects && (
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left">
                  {[
                    { icon: Link2, title: "Match a reference", copy: "Paste any public URL" },
                    { icon: Palette, title: "Designer-level system", copy: "Type, color, rhythm" },
                    { icon: ShieldCheck, title: "Verified preview", copy: "Build + auto-repair" },
                  ].map(({ icon: Icon, title, copy }) => (
                    <div key={title} className="rounded-xl border border-border/65 bg-card/55 px-3.5 py-3 flex items-center gap-3 backdrop-blur-sm">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{copy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {keyConfigured === false && <SetupBanners />}
            </div>
          </section>
        )}

        {/* Projects */}
        {hasProjects && (
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

        {loading && (
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

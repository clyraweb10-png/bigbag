"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Copy,
  Check,
  ArrowRight,
  Sparkles,
  Layers,
  X,
  Eye,
  Terminal,
  Loader2,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import {
  STARTER_TEMPLATES,
  STARTER_CATEGORIES,
  type StarterCategory,
  type StarterTemplate,
} from "@/lib/starter-templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { useAuth } from "@/components/auth/AuthProvider";

interface StarterTemplateGalleryProps {
  /** Legacy prop kept for compatibility — no longer used for template installs */
  onSelectTemplate?: (template: StarterTemplate) => void;
}

export function StarterTemplateGallery({ onSelectTemplate: _onSelectTemplate }: StarterTemplateGalleryProps) {
  const router = useRouter();
  const { user, status } = useAuth();
  const isAuthenticated = status === "authenticated" && !!user;

  const [activeCategory, setActiveCategory] = useState<StarterCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<StarterTemplate | null>(null);
  /** ID of template currently being installed (shows spinner) */
  const [installingId, setInstallingId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return STARTER_TEMPLATES.filter((tpl) => {
      if (activeCategory !== "All") {
        if (activeCategory === "Recent") {
          if (!tpl.isRecent) return false;
        } else if (tpl.category.toLowerCase() !== activeCategory.toLowerCase()) {
          const tagMatches = tpl.tags?.some(
            (t) => t.toLowerCase() === activeCategory.toLowerCase()
          );
          if (!tagMatches) return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inTitle    = tpl.title.toLowerCase().includes(q);
        const inBadge    = tpl.badge.toLowerCase().includes(q);
        const inDesc     = tpl.description.toLowerCase().includes(q);
        const inCategory = tpl.category.toLowerCase().includes(q);
        const inTags     = tpl.tags?.some((t) => t.toLowerCase().includes(q));
        if (!inTitle && !inBadge && !inDesc && !inCategory && !inTags) return false;
      }

      return true;
    });
  }, [activeCategory, searchQuery]);

  // Handle post-login scroll and highlight (without auto-starting creation)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let targetId: string | null = null;
    let targetAction: "copy" | "create" | null = null;

    try {
      const params = new URLSearchParams(window.location.search);
      targetId = params.get("template");
      targetAction = (params.get("action") as "copy" | "create" | null) || null;

      const stored = sessionStorage.getItem("bigbag:target-starter-template");
      if (stored) {
        const parsed = JSON.parse(stored) as { id: string; action?: "copy" | "create" };
        if (parsed.id) {
          targetId = targetId || parsed.id;
          targetAction = targetAction || parsed.action || null;
        }
        sessionStorage.removeItem("bigbag:target-starter-template");
      }
    } catch {}

    if (!targetId) return;

    const targetTemplate = STARTER_TEMPLATES.find((t) => t.id === targetId);
    if (!targetTemplate) return;

    // Ensure category is "All" so the card is visible in the grid
    setActiveCategory("All");
    setSearchQuery("");
    setHighlightedId(targetId);

    // Scroll smoothly to the target template
    const scrollTimer = window.setTimeout(() => {
      const element = document.getElementById(`starter-template-${targetId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 350);

    // If user intended to copy the prompt, perform copy now
    if (targetAction === "copy") {
      try {
        navigator.clipboard.writeText(targetTemplate.prompt);
        setCopiedId(targetTemplate.id);
        toast.success(`Copied "${targetTemplate.title}" prompt to clipboard!`);
        window.setTimeout(() => {
          setCopiedId((curr) => (curr === targetTemplate.id ? null : curr));
        }, 3000);
      } catch {}
    } else {
      // Intended to create/select — scroll only, do NOT start creating automatically
      toast.info(`Selected "${targetTemplate.title}"`, {
        description: "Click the arrow when you are ready to build.",
      });
    }

    // Clean up URL parameters cleanly
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("template");
      url.searchParams.delete("action");
      window.history.replaceState({}, "", url.toString());
    } catch {}

    // Fade highlight after 4.5 seconds
    const fadeTimer = window.setTimeout(() => {
      setHighlightedId((curr) => (curr === targetId ? null : curr));
    }, 4500);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  const handleCopyPrompt = (template: StarterTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isAuthenticated) {
      try {
        sessionStorage.setItem(
          "bigbag:target-starter-template",
          JSON.stringify({ id: template.id, action: "copy" })
        );
      } catch {}
      toast.info("Please sign in to copy this prompt", {
        description: `We'll bring you right back to "${template.title}".`,
      });
      router.push(
        `/login?next=${encodeURIComponent(`/dashboard?tab=starter&template=${template.id}&action=copy#starter-template-${template.id}`)}`
      );
      return;
    }

    if (!template.prompt) return;
    try {
      navigator.clipboard.writeText(template.prompt);
      setCopiedId(template.id);
      toast.success(`Copied "${template.title}" prompt to clipboard!`);
      setTimeout(() => {
        setCopiedId((curr) => (curr === template.id ? null : curr));
      }, 2200);
    } catch {
      toast.error("Failed to copy prompt to clipboard");
    }
  };

  /**
   * Install a pre-built template:
   *  1. Call POST /api/starter-install
   *  2. Store template info in sessionStorage so the workspace shows it in chat
   *  3. Navigate to /project/:id — the build runs in the background
   *
   * This creates a FRESH copy of the template for this user.
   * Modifying it never affects the original template or other users.
   */
  const handleStartBuild = async (template: StarterTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isAuthenticated) {
      try {
        sessionStorage.setItem(
          "bigbag:target-starter-template",
          JSON.stringify({ id: template.id, action: "create" })
        );
      } catch {}
      toast.info("Please sign in to start with this template", {
        description: `We'll bring you right back to "${template.title}".`,
      });
      router.push(
        `/login?next=${encodeURIComponent(`/dashboard?tab=starter&template=${template.id}&action=create#starter-template-${template.id}`)}`
      );
      return;
    }

    if (installingId) return; // debounce

    setInstallingId(template.id);
    try {
      const res = await fetch("/api/starter-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId:   template.id,
          templateName: template.title,
          prompt:       template.prompt,
        }),
      });

      const data: { ok: boolean; data?: { projectId: string }; error?: string } = await res.json();

      if (!data.ok || !data.data?.projectId) {
        toast.error(data.error ?? "Failed to create template project");
        setInstallingId(null);
        return;
      }

      const { projectId } = data.data;

      // Store template context so the workspace page can show it in the chat composer.
      // We use a DIFFERENT key from pendingPrompt so the agent is NOT auto-fired.
      try {
        sessionStorage.setItem(
          `bigbag:starterTemplate:${projectId}`,
          JSON.stringify({
            templateId:   template.id,
            templateName: template.title,
            description:  template.description,
            prompt:       template.prompt,
          })
        );
      } catch { /* storage unavailable */ }

      // Navigate — setInstallingId stays set so we don't flash back to "Continue"
      router.push(`/project/${projectId}`);
    } catch (err) {
      console.error("[StarterTemplateGallery] Install failed:", err);
      toast.error("Failed to install template. Please try again.");
      setInstallingId(null);
    }
  };

  const isInstalling = (id: string) => installingId === id;

  return (
    <div className="w-full space-y-5">
      {/* ── Filter Bar ── */}
      <div className="flex flex-col gap-3">
        {/* Top row: search + count */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-9 pr-7 py-2 text-sm bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-white/[0.08] focus:border-zinc-400 dark:focus:border-blue-500/50 focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-blue-500/20 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 outline-none transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium whitespace-nowrap tabular-nums">
            {filteredTemplates.length} templates
          </span>
        </div>

        {/* Category pills — wrap naturally, no scrollbar */}
        <div
          ref={scrollContainerRef}
          className="flex flex-wrap items-center gap-2"
        >
          {STARTER_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer border ${
                  isActive
                    ? "bg-zinc-900 text-white border-zinc-900 shadow-xs font-semibold dark:bg-white dark:text-zinc-950 dark:border-white dark:shadow-sm"
                    : "bg-zinc-100/90 text-zinc-600 border-zinc-200/80 hover:text-zinc-900 hover:bg-zinc-200/80 hover:border-zinc-300 dark:bg-zinc-900/60 dark:text-zinc-400 dark:border-white/[0.07] dark:hover:text-white dark:hover:bg-zinc-800/80 dark:hover:border-white/[0.12]"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Template Cards Grid ── */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/20">
          <Sparkles className="w-8 h-8 text-zinc-400 dark:text-zinc-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-300">No templates found</p>
          <p className="text-xs text-zinc-500 mt-1">
            Try adjusting your search query or switching categories.
          </p>
          <button
            type="button"
            onClick={() => { setActiveCategory("All"); setSearchQuery(""); }}
            className="mt-4 px-4 py-1.5 text-xs rounded-full bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => {
            const isCopied    = copiedId === template.id;
            const installing  = isInstalling(template.id);
            return (
              <div
                key={template.id}
                id={`starter-template-${template.id}`}
                onClick={() => !installingId && handleStartBuild(template)}
                className={`group relative flex flex-col rounded-xl border transition-all duration-300 overflow-hidden bg-card dark:bg-[#111114] ${
                  highlightedId === template.id
                    ? "border-blue-500 ring-2 ring-blue-500/80 ring-offset-2 ring-offset-background shadow-xl shadow-blue-500/25 scale-[1.01]"
                    : "border-zinc-200/90 dark:border-white/[0.1] hover:border-zinc-400 dark:hover:border-zinc-500 shadow-xs hover:shadow-md"
                } ${installingId ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                {/* ── Preview Thumbnail with Motion Support ── */}
                <TemplatePreviewThumbnail
                  template={template}
                  isInstalling={installing}
                  installingId={installingId}
                  onStartBuild={(e) => handleStartBuild(template, e)}
                  onOpenDetails={(e) => {
                    e.stopPropagation();
                    setPreviewTemplate(template);
                  }}
                />

                {/* ── Card Footer ── */}
                <div className="p-3.5 flex items-center justify-between gap-3 bg-card dark:bg-[#111114]">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[14px] font-semibold text-foreground dark:text-white tracking-tight truncate group-hover:text-primary dark:group-hover:text-blue-400 transition-colors">
                      {template.title}
                    </h4>
                    <p className="text-[11px] text-muted-foreground dark:text-zinc-400 font-medium capitalize mt-0.5 truncate">
                      {template.badge}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Copy prompt button */}
                    <button
                      type="button"
                      title={isCopied ? "Copied!" : "Copy prompt"}
                      onClick={(e) => handleCopyPrompt(template, e)}
                      className={`p-2 rounded-lg border transition-colors duration-150 cursor-pointer ${
                        isCopied
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "bg-secondary/70 hover:bg-secondary border-border/80 text-muted-foreground hover:text-foreground dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:border-white/[0.06] dark:text-zinc-400 dark:hover:text-white"
                      }`}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    {/* Continue button */}
                    <button
                      type="button"
                      title={installing ? "Installing…" : "Continue & Build"}
                      onClick={(e) => { e.stopPropagation(); !installingId && handleStartBuild(template, e); }}
                      disabled={!!installingId}
                      className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
                    >
                      {installing
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </button>
                  </div>
                </div>

                {/* Installing overlay */}
                {installing && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 rounded-2xl z-10">
                    <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                    <p className="text-xs text-zinc-300 font-medium">Creating project…</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Prompt Inspection & Preview Modal ── */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl bg-card dark:bg-[#111114] border-border dark:border-white/[0.1] text-foreground dark:text-white">
          {previewTemplate && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 text-xs text-primary dark:text-blue-400 font-semibold uppercase tracking-wider">
                  <Terminal className="w-3.5 h-3.5" />
                  {previewTemplate.badge} · {previewTemplate.category}
                </div>
                <DialogTitle className="text-xl font-bold text-foreground dark:text-white mt-1">
                  {previewTemplate.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground dark:text-zinc-400 mt-1">
                  {previewTemplate.description}
                </DialogDescription>
              </DialogHeader>

              {/* Preview media */}
              <div className="relative rounded-xl overflow-hidden aspect-[16/9] border border-border dark:border-white/[0.08] bg-muted dark:bg-black my-2">
                {previewTemplate.previewVideo ? (
                  <video
                    src={previewTemplate.previewVideo}
                    poster={previewTemplate.previewImage}
                    autoPlay
                    loop
                    muted
                    playsInline
                    controls
                    className="w-full h-full object-cover"
                  />
                ) : previewTemplate.previewGif ? (
                  <img
                    src={previewTemplate.previewGif}
                    alt={previewTemplate.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={previewTemplate.previewImage}
                    alt={previewTemplate.title}
                    className="w-full h-full object-cover"
                  />
                )}
                {previewTemplate.previewVideo && (
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-[11px] font-medium text-white flex items-center gap-1.5 shadow-sm pointer-events-none">
                    <Sparkles className="w-3 h-3 text-blue-400" />
                    <span>Live Motion Hero Preview</span>
                  </div>
                )}
              </div>

              {/* Prompt Snippet */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground dark:text-zinc-400">Prompt Specification:</span>
                <div className="max-h-48 overflow-y-auto rounded-lg bg-zinc-950 p-3 border border-zinc-800 text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap selection:bg-blue-500/30">
                  {previewTemplate.prompt}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleCopyPrompt(previewTemplate)}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-border dark:border-white/[0.1] bg-secondary hover:bg-secondary/80 text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.1] dark:text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Prompt
                </button>
                <button
                  type="button"
                  disabled={!!installingId}
                  onClick={() => {
                    const tpl = previewTemplate;
                    setPreviewTemplate(null);
                    handleStartBuild(tpl);
                  }}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer hover:scale-105 active:scale-95"
                >
                  {installingId
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Installing…</>
                    : <><span>Continue & Build</span><ArrowRight className="w-4 h-4 stroke-[2.5]" /></>}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplatePreviewThumbnail({
  template,
  isInstalling,
  installingId,
  onStartBuild,
  onOpenDetails,
}: {
  template: StarterTemplate;
  isInstalling: boolean;
  installingId: string | null;
  onStartBuild: (e: React.MouseEvent) => void;
  onOpenDetails: (e: React.MouseEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const hasMotion = !!(template.previewVideo || template.previewGif);

  // Auto-play looping video continuously when visible (always in motion without mouse hover)
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !template.previewVideo || videoError) return;

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined" && container) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              video.play().catch(() => {});
            } else {
              video.pause();
            }
          });
        },
        { rootMargin: "150px 0px" }
      );
      observer.observe(container);
    } else {
      video.play().catch(() => {});
    }

    return () => {
      observer?.disconnect();
    };
  }, [template.previewVideo, videoError]);

  const handleMouseEnter = () => {
    if (template.previewVideo && videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-950 border-b border-zinc-200/80 dark:border-white/[0.08]"
      onMouseEnter={handleMouseEnter}
    >
      {/* ── Base static screenshot (Always present for instant load) ── */}
      <img
        src={template.previewImage}
        alt={template.title}
        loading="lazy"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = "none";
          const fallback = target.nextElementSibling;
          if (fallback) (fallback as HTMLElement).style.display = "flex";
        }}
        className="w-full h-full object-cover object-top block"
      />

      {/* Fallback Graphic */}
      <div
        style={{ display: "none" }}
        className="absolute inset-0 flex-col items-center justify-center p-4 bg-zinc-100 dark:bg-zinc-900 text-center"
      >
        <Layers className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mb-2" />
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">{template.title}</span>
        <span className="text-[10px] text-zinc-500 mt-0.5">{template.badge}</span>
      </div>

      {/* ── Looping Video Preview (Always in motion without hover) ── */}
      {template.previewVideo && !videoError && (
        <video
          ref={videoRef}
          src={template.previewVideo}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => {
            setVideoLoaded(true);
            videoRef.current?.play().catch(() => {});
          }}
          onError={() => setVideoError(true)}
          className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-300 pointer-events-none ${
            videoLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* ── GIF Preview Alternative (Always in motion without hover) ── */}
      {template.previewGif && !template.previewVideo && (
        <img
          src={template.previewGif}
          alt={template.title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover object-top opacity-100 pointer-events-none"
        />
      )}

      {/* ── Subtle Motion Badge ── */}
      {hasMotion && (
        <div className="absolute top-2.5 right-2.5 z-10 px-2 py-0.5 rounded-full bg-black/60 dark:bg-black/70 backdrop-blur-md border border-white/15 text-[10px] font-semibold text-white/90 flex items-center gap-1 shadow-xs pointer-events-none transition-transform duration-200 group-hover:scale-105">
          <Play className="w-2.5 h-2.5 fill-blue-400 text-blue-400" />
          <span>Motion</span>
        </div>
      )}

      {/* Clean hover action buttons */}
      <div className="absolute inset-0 z-20 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-3">
        <button
          type="button"
          title={isInstalling ? "Installing…" : "Continue & Build"}
          onClick={onStartBuild}
          disabled={!!installingId}
          className="w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-sm"
        >
          {isInstalling
            ? <Loader2 className="w-5 h-5 animate-spin" />
            : <ArrowRight className="w-5 h-5 stroke-[2.5]" />}
        </button>
        <button
          type="button"
          title="View Details"
          onClick={onOpenDetails}
          className="w-9 h-9 rounded-full bg-white/95 hover:bg-white text-zinc-800 dark:bg-zinc-800/90 dark:hover:bg-zinc-700 dark:text-zinc-200 shadow-sm flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <Eye className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

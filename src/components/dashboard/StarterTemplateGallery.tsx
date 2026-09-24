"use client";

import { useState, useMemo, useRef } from "react";
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

interface StarterTemplateGalleryProps {
  onSelectTemplate?: (template: StarterTemplate) => void;
}

export function StarterTemplateGallery({ onSelectTemplate }: StarterTemplateGalleryProps) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<StarterCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<StarterTemplate | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return STARTER_TEMPLATES.filter((tpl) => {
      // Category match
      if (activeCategory !== "All") {
        if (activeCategory === "Recent") {
          if (!tpl.isRecent) return false;
        } else if (tpl.category.toLowerCase() !== activeCategory.toLowerCase()) {
          // Check tags as well for flexible categorization
          const tagMatches = tpl.tags?.some(
            (t) => t.toLowerCase() === activeCategory.toLowerCase()
          );
          if (!tagMatches) return false;
        }
      }

      // Search match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inTitle = tpl.title.toLowerCase().includes(q);
        const inBadge = tpl.badge.toLowerCase().includes(q);
        const inDesc = tpl.description.toLowerCase().includes(q);
        const inCategory = tpl.category.toLowerCase().includes(q);
        const inTags = tpl.tags?.some((t) => t.toLowerCase().includes(q));
        if (!inTitle && !inBadge && !inDesc && !inCategory && !inTags) {
          return false;
        }
      }

      return true;
    });
  }, [activeCategory, searchQuery]);

  const handleCopyPrompt = (template: StarterTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  const handleStartBuild = (template: StarterTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Stash prompt in sessionStorage for the generate workflow
    try {
      sessionStorage.setItem("bigbag:pending-prompt", template.prompt);
    } catch {}

    if (onSelectTemplate) {
      onSelectTemplate(template);
    } else {
      router.push("/generate");
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* ── Category Pill Bar (Reference: Image 1) ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Pills container */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-1 bg-zinc-900/60 dark:bg-[#121216] border border-white/[0.08] rounded-full max-w-full"
        >
          {STARTER_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-white text-black dark:bg-white dark:text-zinc-950 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Search & Count */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-zinc-900/60 dark:bg-[#121216] border border-white/[0.08] focus:border-blue-500/50 rounded-full text-white placeholder-zinc-500 outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <span className="text-[11px] text-zinc-400 font-medium px-2 py-1 bg-zinc-900/60 rounded-full border border-white/[0.06] whitespace-nowrap">
            {filteredTemplates.length} templates
          </span>
        </div>
      </div>

      {/* ── Template Cards Grid (Reference: Image 2) ── */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20">
          <Sparkles className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-300">No templates found</p>
          <p className="text-xs text-zinc-500 mt-1">
            Try adjusting your search query or switching categories.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveCategory("All");
              setSearchQuery("");
            }}
            className="mt-4 px-4 py-1.5 text-xs rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTemplates.map((template) => {
            const isCopied = copiedId === template.id;
            return (
              <div
                key={template.id}
                onClick={() => handleStartBuild(template)}
                className="group relative flex flex-col rounded-2xl border border-white/[0.08] bg-[#111114] hover:border-zinc-700/80 hover:shadow-2xl hover:shadow-black/60 transition-all duration-200 overflow-hidden cursor-pointer"
              >
                {/* ── Preview Thumbnail ── */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-950/80 border-b border-white/[0.06]">
                  {/* Thumbnail Image */}
                  <img
                    src={template.previewImage}
                    alt={template.title}
                    loading="lazy"
                    onError={(e) => {
                      // Fallback gradient if image hasn't finished screenshotting
                      const target = e.currentTarget;
                      target.style.display = "none";
                      const fallback = target.nextElementSibling;
                      if (fallback) (fallback as HTMLElement).style.display = "flex";
                    }}
                    className="w-full h-full object-cover object-top group-hover:scale-[1.04] transition-transform duration-300"
                  />

                  {/* Fallback Graphic (hidden by default) */}
                  <div
                    style={{ display: "none" }}
                    className="absolute inset-0 flex-col items-center justify-center p-4 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black text-center"
                  >
                    <Layers className="w-8 h-8 text-zinc-600 mb-2" />
                    <span className="text-xs font-semibold text-zinc-300">
                      {template.title}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">
                      {template.badge}
                    </span>
                  </div>

                  {/* Dark subtle overlay at bottom */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-black/20 pointer-events-none" />

                  {/* Hover Continue Action (Reference Image 3: Blue circular arrow button) */}
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      title="Continue & Build"
                      onClick={(e) => handleStartBuild(template, e)}
                      className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-xl shadow-blue-600/40 transition-transform duration-200 hover:scale-110 active:scale-95 cursor-pointer"
                    >
                      <ArrowRight className="w-6 h-6 stroke-[2.5]" />
                    </button>
                    <button
                      type="button"
                      title="View Details"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewTemplate(template);
                      }}
                      className="w-9 h-9 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* ── Card Content & Actions (Reference Image 2) ── */}
                <div className="p-3.5 flex items-center justify-between gap-3 bg-[#111114]">
                  {/* Left: Title & Category */}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[14px] font-semibold text-white tracking-tight truncate group-hover:text-blue-400 transition-colors">
                      {template.title}
                    </h4>
                    <p className="text-[11px] text-zinc-400 font-medium capitalize mt-0.5 truncate">
                      {template.badge}
                    </p>
                  </div>

                  {/* Right: Copy Prompt Button & Direct Arrow */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      title={isCopied ? "Copied!" : "Copy prompt"}
                      onClick={(e) => handleCopyPrompt(template, e)}
                      className={`p-2 rounded-lg border transition-all duration-200 cursor-pointer ${
                        isCopied
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-zinc-400 hover:text-white"
                      }`}
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Compact Image 3 Continue Icon Button */}
                    <button
                      type="button"
                      title="Start build"
                      onClick={(e) => handleStartBuild(template, e)}
                      className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-sm shadow-blue-600/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Prompt Inspection & Preview Modal ── */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl bg-[#111114] border border-white/[0.1] text-white">
          {previewTemplate && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 text-xs text-blue-400 font-semibold uppercase tracking-wider">
                  <Terminal className="w-3.5 h-3.5" />
                  {previewTemplate.badge} · {previewTemplate.category}
                </div>
                <DialogTitle className="text-xl font-bold text-white mt-1">
                  {previewTemplate.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400 mt-1">
                  {previewTemplate.description}
                </DialogDescription>
              </DialogHeader>

              {/* Preview image */}
              <div className="relative rounded-xl overflow-hidden aspect-[16/9] border border-white/[0.08] bg-black my-2">
                <img
                  src={previewTemplate.previewImage}
                  alt={previewTemplate.title}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Prompt Snippet */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-zinc-400">Prompt Specification:</span>
                <div className="max-h-48 overflow-y-auto rounded-lg bg-black/60 p-3 border border-white/[0.08] text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap selection:bg-blue-500/30">
                  {previewTemplate.prompt}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleCopyPrompt(previewTemplate)}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Prompt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tpl = previewTemplate;
                    setPreviewTemplate(null);
                    handleStartBuild(tpl);
                  }}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer hover:scale-105 active:scale-95"
                >
                  <span>Continue & Build</span>
                  <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

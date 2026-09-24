"use client";

import { useEffect, useState, useMemo } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Diamond,
  Plus,
  Plug2,
  Sun,
  Moon,
  ArrowRight,
  Layers,
  Sparkles,
  Search,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { formatRelativeDate } from "@/lib/format";

interface DashboardSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: VcaasProjectSummary[];
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  onConnectorsOpen: () => void;
  onBrowseTemplates?: () => void;
  onFilterOnDashboard?: (query: string) => void;
}

export function DashboardSearchDialog({
  open,
  onOpenChange,
  projects,
  onSelectProject,
  onNewProject,
  onConnectorsOpen,
  onBrowseTemplates,
  onFilterOnDashboard,
}: DashboardSearchDialogProps) {
  const [query, setQuery] = useState("");
  const { resolvedTheme, setTheme } = useTheme();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        (navigator.platform?.toUpperCase().includes("MAC") ||
          navigator.userAgent?.toUpperCase().includes("MAC"))
    );
  }, []);

  // Reset query whenever the dialog opens/closes
  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const isDark = resolvedTheme === "dark";

  // Pre-sort projects by recency
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const timeA = new Date(a.lastModifiedAt || a.createdAt).getTime();
      const timeB = new Date(b.lastModifiedAt || b.createdAt).getTime();
      return timeB - timeA;
    });
  }, [projects]);

  // Featured starter templates (limit to 6 for clean display)
  const featuredTemplates = useMemo(() => {
    return STARTER_TEMPLATES.slice(0, 12);
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Projects & Actions"
      description="Quickly search projects, starter templates, and workspace actions"
      showCloseButton={false}
      className="gap-0 p-0 sm:max-w-xl md:max-w-2xl bg-card text-foreground border border-border/80 shadow-2xl rounded-2xl overflow-hidden"
    >
      <CommandInput
        placeholder={`Search projects, templates, actions... (${isMac ? "⌘K" : "Ctrl+K"})`}
        value={query}
        onValueChange={setQuery}
        className="h-12 text-sm text-foreground placeholder:text-muted-foreground border-b border-border/80"
      />

      <CommandList className="max-h-[380px] sm:max-h-[440px] overflow-y-auto p-2 custom-scrollbar">
        <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
          <p className="font-medium text-foreground">No matching results found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try searching with a different keyword or create a new project.
          </p>
          {query.trim() && onFilterOnDashboard && (
            <button
              type="button"
              onClick={() => {
                onFilterOnDashboard(query.trim());
                onOpenChange(false);
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-accent/60 hover:bg-accent text-foreground transition-colors cursor-pointer"
            >
              <Search className="w-3 h-3" />
              Filter &ldquo;{query.trim()}&rdquo; on dashboard page
            </button>
          )}
        </CommandEmpty>

        {/* Dynamic dashboard search jump if query is typed */}
        {query.trim().length > 0 && onFilterOnDashboard && (
          <>
            <CommandGroup heading="Dashboard View">
              <CommandItem
                value={`filter dashboard search ${query.trim()}`}
                onSelect={() => {
                  onFilterOnDashboard(query.trim());
                  onOpenChange(false);
                }}
                className="cursor-pointer flex items-center justify-between py-2 px-3 rounded-xl hover:bg-accent group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Search className="w-4 h-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      Filter dashboard for &ldquo;
                      <span className="font-semibold text-primary">
                        {query.trim()}
                      </span>
                      &rdquo;
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Switch to dashboard projects grid with this filter
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground shrink-0 flex items-center gap-1">
                  View grid <ArrowRight className="w-3 h-3" />
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator className="my-1.5" />
          </>
        )}

        {/* User's Projects */}
        <CommandGroup
          heading={
            projects.length > 0
              ? `Projects (${projects.length})`
              : "Projects"
          }
        >
          {sortedProjects.map((p) => {
            const displayName = p.label || p.projectId;
            const updated = p.lastModifiedAt || p.createdAt;
            const relTime = formatRelativeDate(updated, "en");

            return (
              <CommandItem
                key={p.projectId}
                value={`project ${displayName} ${p.projectId} ${p.description || ""}`}
                onSelect={() => {
                  onSelectProject(p.projectId);
                  onOpenChange(false);
                }}
                className="cursor-pointer flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors group"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                    <Diamond className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {displayName}
                      </span>
                      {p.label && p.label !== p.projectId && (
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
                          {p.projectId}
                        </span>
                      )}
                    </div>
                    {p.description ? (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {p.description}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                        Updated {relTime}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    {relTime}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CommandItem>
            );
          })}

          {projects.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              No projects created yet.
            </div>
          )}
        </CommandGroup>

        <CommandSeparator className="my-1.5" />

        {/* Starter Templates */}
        <CommandGroup heading="Starter Templates">
          {featuredTemplates.map((tpl) => (
            <CommandItem
              key={tpl.id}
              value={`template ${tpl.title} ${tpl.category} ${tpl.badge} ${tpl.description} ${(tpl.tags || []).join(" ")}`}
              onSelect={() => {
                onBrowseTemplates?.();
                onOpenChange(false);
              }}
              className="cursor-pointer flex items-center justify-between py-2 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                <div className="w-7 h-7 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0 text-foreground/80">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {tpl.title}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {tpl.badge || tpl.category}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {tpl.description}
                  </p>
                </div>
              </div>

              <span className="text-[11px] text-primary hidden sm:inline shrink-0 font-medium">
                Template
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator className="my-1.5" />

        {/* Quick Actions */}
        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="action new project create build app"
            onSelect={() => {
              onNewProject();
              onOpenChange(false);
            }}
            className="cursor-pointer flex items-center gap-2.5 py-2 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
              <Plus className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">New Project</p>
              <p className="text-xs text-muted-foreground">
                Describe an app and build from scratch
              </p>
            </div>
          </CommandItem>

          {onBrowseTemplates && (
            <CommandItem
              value="action browse templates gallery explore"
              onSelect={() => {
                onBrowseTemplates();
                onOpenChange(false);
              }}
              className="cursor-pointer flex items-center gap-2.5 py-2 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0 text-foreground/80">
                <Layers className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Browse Starter Templates
                </p>
                <p className="text-xs text-muted-foreground">
                  View 40+ production-ready app and landing page templates
                </p>
              </div>
            </CommandItem>
          )}

          <CommandItem
            value="action connectors integrations figma github totalum"
            onSelect={() => {
              onConnectorsOpen();
              onOpenChange(false);
            }}
            className="cursor-pointer flex items-center gap-2.5 py-2 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0 text-foreground/80">
              <Plug2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Connectors</p>
              <p className="text-xs text-muted-foreground">
                Manage GitHub, Figma, and integration tokens
              </p>
            </div>
          </CommandItem>

          <CommandItem
            value="action theme dark light mode toggle"
            onSelect={() => {
              setTheme(isDark ? "light" : "dark");
            }}
            className="cursor-pointer flex items-center gap-2.5 py-2 px-3 rounded-xl hover:bg-accent data-[selected=true]:bg-accent/80 transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0 text-foreground/80">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Toggle Theme</p>
              <p className="text-xs text-muted-foreground">
                Switch to {isDark ? "light" : "dark"} mode
              </p>
            </div>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Footer keybinding guide */}
      <div className="flex items-center justify-between border-t border-border/80 px-4 py-2.5 text-[11px] text-muted-foreground bg-muted/20 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono">
              ↑
            </kbd>
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono">
              ↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono">
              ↵
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono">
              Esc
            </kbd>
            Close
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 font-medium">
          <span>{isMac ? "⌘K" : "Ctrl+K"}</span>
        </div>
      </div>
    </CommandDialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  LayoutGrid, Search, Plug2,
  Diamond, Plus, ChevronDown,
} from "lucide-react";
import { BigBagLogo } from "@/components/BigBagLogo";
import { useAuth, AuthUserMenu } from "@/components/auth/AuthProvider";
import { extractCleanUserName } from "@/lib/user-name";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";
import { SidebarCollapseIcon, SidebarExpandIcon } from "@/components/SidebarIcons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  projects: VcaasProjectSummary[];
  isOpen?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
  onToggle?: () => void;
  onConnectorsOpen: () => void;
  onSearchFocus?: () => void;
  onSearchOpen?: () => void;
  onNewProject: () => void;
}

export function DashboardSidebar({
  projects,
  isOpen = true,
  onClose,
  onOpen,
  onToggle,
  onConnectorsOpen,
  onSearchFocus,
  onSearchOpen,
  onNewProject,
}: Props) {
  const { user } = useAuth();
  const [recentsExpanded, setRecentsExpanded] = useState(true);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        (navigator.platform?.toUpperCase().includes("MAC") ||
          navigator.userAgent?.toUpperCase().includes("MAC"))
    );
  }, []);

  const handleSearchClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768 && onClose) {
      onClose();
    }
    if (onSearchOpen) {
      onSearchOpen();
    } else if (onSearchFocus) {
      onSearchFocus();
    }
  };

  const searchShortcut = isMac ? "⌘K" : "Ctrl+K";

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const rawDisplayName = user?.displayName || (user?.email ? extractCleanUserName(user.email) : "") || "Workspace";
  const displayName = extractCleanUserName(rawDisplayName) || rawDisplayName;
  const initial = (displayName || "U")[0]?.toUpperCase() ?? "U";

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`h-full flex flex-col bg-[#fcfcfd] dark:bg-[#121214] border-r border-zinc-200/80 dark:border-white/6 select-none transition-all duration-200 ease-in-out ${
          isOpen
            ? "fixed inset-y-0 left-0 z-50 w-[260px] md:relative md:z-20 md:w-[250px] shadow-2xl md:shadow-none translate-x-0 opacity-100"
            : "fixed inset-y-0 left-0 z-50 w-[260px] -translate-x-full md:relative md:z-20 md:w-[60px] md:shadow-none md:translate-x-0 md:opacity-100"
        }`}
      >
        <div className={`h-full flex flex-col overflow-hidden transition-all duration-200 ${isOpen ? "w-[260px] md:w-[250px]" : "w-[260px] md:w-[60px]"}`}>
          {/* Top header row: Logo + Close / Open sidebar button */}
          {isOpen ? (
            <div className="flex items-center justify-between px-3.5 pt-4 pb-2.5 shrink-0">
              <BigBagLogo size="md" />
              <button
                type="button"
                onClick={onClose || onToggle}
                title="Collapse sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <SidebarCollapseIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center pt-3.5 pb-2.5 shrink-0">
              <button
                type="button"
                onClick={onOpen || onToggle}
                title="Expand sidebar (Ctrl+B)"
                aria-label="Expand sidebar"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer border border-transparent hover:border-zinc-200/80 dark:hover:border-white/10"
              >
                <SidebarExpandIcon className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Workspace selector */}
          {isOpen ? (
            <div className="mx-3 my-2 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200/70 dark:bg-[#1e1e20] dark:hover:bg-[#252528] border border-zinc-200/80 dark:border-white/8 px-3 py-2 cursor-pointer transition-colors text-left group select-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#8570e8] text-black font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                      {initial}
                    </div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate flex-1">
                      {displayName}&apos;s Works...
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 p-1.5">
                  <DropdownMenuLabel className="font-normal text-xs text-muted-foreground pb-1">
                    <p className="font-semibold text-foreground truncate">{displayName}&apos;s Workspace</p>
                    <p className="text-[11px] truncate">{user?.email || "Personal Workspace"}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onNewProject} className="cursor-pointer text-xs">
                    <Plus className="w-3.5 h-3.5 mr-2" />
                    New Project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onConnectorsOpen} className="cursor-pointer text-xs">
                    <Plug2 className="w-3.5 h-3.5 mr-2" />
                    Connectors
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="my-2 flex justify-center shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={`${displayName}'s Workspace`}
                    aria-label={`${displayName}'s Workspace`}
                    className="w-9 h-9 rounded-xl bg-zinc-100 hover:bg-zinc-200/70 dark:bg-[#1e1e20] dark:hover:bg-[#252528] border border-zinc-200/80 dark:border-white/8 flex items-center justify-center cursor-pointer transition-colors shadow-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#8570e8] text-black font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                      {initial}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-56 p-1.5">
                  <DropdownMenuLabel className="font-normal text-xs text-muted-foreground pb-1">
                    <p className="font-semibold text-foreground truncate">{displayName}&apos;s Workspace</p>
                    <p className="text-[11px] truncate">{user?.email || "Personal Workspace"}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onNewProject} className="cursor-pointer text-xs">
                    <Plus className="w-3.5 h-3.5 mr-2" />
                    New Project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onConnectorsOpen} className="cursor-pointer text-xs">
                    <Plug2 className="w-3.5 h-3.5 mr-2" />
                    Connectors
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Navigation */}
          <nav className={isOpen ? "px-2.5 space-y-1 shrink-0 pt-1" : "space-y-1.5 shrink-0 pt-1 flex flex-col items-center"}>
            <NavItem
              icon={<LayoutGrid className="w-4 h-4" />}
              label="Dashboard"
              href="/"
              active
              collapsed={!isOpen}
            />
            <NavItem
              icon={<Search className="w-4 h-4" />}
              label="Search"
              onClick={handleSearchClick}
              collapsed={!isOpen}
              shortcut={searchShortcut}
            />
            <NavItem
              icon={<Plug2 className="w-4 h-4" />}
              label="Connectors"
              onClick={onConnectorsOpen}
              collapsed={!isOpen}
            />
          </nav>

          {/* Recents section or spacer */}
          {isOpen ? (
            <div className="flex-1 min-h-0 overflow-y-auto mt-4 px-2.5 custom-scrollbar">
              <div className="flex items-center justify-between px-2 mb-1.5">
                <button
                  type="button"
                  onClick={() => setRecentsExpanded((prev) => !prev)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white transition-colors uppercase tracking-wider cursor-pointer"
                >
                  <span>RECENTS</span>
                  <ChevronDown
                    className={`w-3 h-3 text-zinc-500 dark:text-zinc-400 transition-transform duration-200 ${
                      recentsExpanded ? "" : "-rotate-90"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onNewProject}
                  title="New project"
                  className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-white/10 transition-colors rounded cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {recentsExpanded && (
                <div className="space-y-0.5">
                  {recentProjects.map((p) => (
                    <Link
                      key={p.projectId}
                      href={`/project/${p.projectId}`}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group"
                    >
                      <Diamond className="w-3 h-3 shrink-0 text-zinc-400 dark:text-zinc-500 stroke-[1.8] group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors" />
                      <span className="text-[13px] truncate font-normal text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-950 dark:group-hover:text-white transition-colors">
                        {p.label || p.projectId}
                      </span>
                    </Link>
                  ))}
                  {recentProjects.length === 0 && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500/70 px-2 py-1.5">
                      No projects yet
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0" />
          )}

          {/* Bottom user profile section */}
          <div className={isOpen ? "shrink-0 px-3 pb-3 pt-2.5 border-t border-zinc-200/80 dark:border-white/6 mt-2" : "shrink-0 pb-3 pt-2.5 border-t border-zinc-200/80 dark:border-white/6 mt-2 flex justify-center"}>
            <AuthUserMenu showLabel collapsed={!isOpen} />
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  icon,
  label,
  href,
  onClick,
  active,
  collapsed = false,
  shortcut,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  collapsed?: boolean;
  shortcut?: string;
}) {
  const tooltipText = shortcut ? `${label} (${shortcut})` : label;
  const cls = collapsed
    ? `w-9 h-9 flex items-center justify-center rounded-xl transition-all mx-auto cursor-pointer ${
        active
          ? "bg-zinc-200/80 text-zinc-950 font-semibold dark:bg-[#252528] dark:text-white shadow-2xs"
          : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100/90 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5"
      }`
    : `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all w-full text-left cursor-pointer group ${
        active
          ? "bg-zinc-200/80 text-zinc-950 font-semibold dark:bg-[#252528] dark:text-white shadow-2xs"
          : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100/90 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5"
      }`;

  const iconCls = active
    ? "text-zinc-950 dark:text-white shrink-0"
    : "text-zinc-500 group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-white shrink-0 transition-colors";

  const content = collapsed ? (
    <span className={iconCls}>{icon}</span>
  ) : (
    <>
      <span className={iconCls}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <kbd className="hidden sm:inline-flex items-center justify-center text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-200/70 dark:bg-white/8 px-1.5 py-0.5 rounded border border-zinc-200/80 dark:border-white/10 shrink-0">
          {shortcut}
        </kbd>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls} title={collapsed ? tooltipText : undefined}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cls} title={collapsed ? tooltipText : undefined}>
      {content}
    </button>
  );
}

"use client";

import Link from "next/link";
import {
  LayoutDashboard, Search, Plug2, MessageSquare,
  Diamond, Plus, ChevronDown, Zap, Gift,
} from "lucide-react";
import { BigBagLogo } from "@/components/BigBagLogo";
import { useAuth } from "@/components/auth/AuthProvider";
import type { VcaasProjectSummary } from "@/lib/vcaas-types";

interface Props {
  projects: VcaasProjectSummary[];
  onConnectorsOpen: () => void;
  onSearchFocus: () => void;
  onNewProject: () => void;
}

export function DashboardSidebar({ projects, onConnectorsOpen, onSearchFocus, onNewProject }: Props) {
  const { user } = useAuth();
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 7);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Workspace";
  const initial = displayName[0]?.toUpperCase() ?? "W";

  return (
    <aside className="w-[240px] shrink-0 h-full flex flex-col bg-[#161616] border-r border-white/5 overflow-hidden">
      {/* Logo */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <BigBagLogo size="md" />
      </div>

      {/* Workspace selector */}
      <div className="mx-3 mb-3 shrink-0">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/8 px-3 py-2 cursor-pointer hover:bg-white/8 transition-colors select-none">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shrink-0">
            {initial}
          </div>
          <span className="text-sm font-medium text-foreground/90 truncate flex-1">
            {displayName}&apos;s Workspace
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-2 space-y-0.5 shrink-0">
        <NavItem icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" href="/" active />
        <NavItem icon={<Search className="w-4 h-4" />} label="Search" onClick={onSearchFocus} />
        <NavItem icon={<Plug2 className="w-4 h-4" />} label="Connectors" onClick={onConnectorsOpen} />
        <div className="h-px bg-white/5 mx-2 my-1.5" />
        <NavItem icon={<MessageSquare className="w-4 h-4" />} label="Chats" href="/generate" />
        <NavItem icon={<Diamond className="w-4 h-4" />} label="Projects" href="#projects" />
      </nav>

      {/* Recents */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-4 px-2">
        <div className="flex items-center justify-between px-2 mb-1.5">
          <button className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider">
            Recents <ChevronDown className="w-3 h-3" />
          </button>
          <button
            onClick={onNewProject}
            title="New project"
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-0.5">
          {recentProjects.map((p) => (
            <Link
              key={p.projectId}
              href={`/project/${p.projectId}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground group"
            >
              <Diamond className="w-3 h-3 shrink-0 opacity-60" />
              <span className="text-xs truncate">{p.label || p.projectId}</span>
            </Link>
          ))}
          {recentProjects.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50 px-2 py-1">No projects yet</p>
          )}
        </div>
      </div>

      {/* Bottom */}
      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-white/5 space-y-1 mt-2">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Upgrade to Pro</p>
            <p className="text-[10px] text-muted-foreground">Unlock more features</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 cursor-pointer transition-colors">
          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
            <Gift className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Share</p>
            <p className="text-[10px] text-muted-foreground">100 credits per referral</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 pt-1">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shrink-0">
            {initial}
          </div>
          <span className="text-[11px] text-muted-foreground truncate">{user?.email}</span>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  icon, label, href, onClick, active,
}: {
  icon: React.ReactNode; label: string; href?: string; onClick?: () => void; active?: boolean;
}) {
  const cls = `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors w-full text-left cursor-pointer ${
    active
      ? "bg-white/8 text-foreground font-medium"
      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
  }`;
  if (href) return <Link href={href} className={cls}>{icon}<span>{label}</span></Link>;
  return <button onClick={onClick} className={cls}>{icon}<span>{label}</span></button>;
}

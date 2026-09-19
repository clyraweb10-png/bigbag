"use client";

import { KeyRound, Server, Database, Sparkles, Globe, Github, Box } from "lucide-react";

// Shown on the dashboard when no LLM API key or orchestrator is configured.
export function SetupBanners() {
  const FEATURES = [
    { icon: Server, label: "Self-hosted Dev Server" },
    { icon: Database, label: "Built-in Data Storage" },
    { icon: Sparkles, label: "Multi-Model AI (Gemini, Telnyx)" },
    { icon: Globe, label: "Custom Domains" },
    { icon: Github, label: "GitHub Integration" },
    { icon: Box, label: "Sandboxes & Live Preview" },
  ];

  return (
    <div className="space-y-4 mt-10">
      {/* ── Setup: configure AI providers ── */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/40 bg-card shadow-lg shadow-emerald-500/5">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" />
        <div className="flex items-start gap-4 p-5 sm:p-6 pl-6 sm:pl-7">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm">
            <KeyRound className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 rounded-full px-2 py-0.5">
              Configuration required
            </span>
            <h2 className="text-lg font-bold text-foreground mt-2">Configure BigBag AI App Builder</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Create a{" "}
              <code className="font-mono text-[13px] font-semibold bg-muted text-foreground px-1.5 py-0.5 rounded">.env.local</code>{" "}
              file in the project root and provide your preferred LLM provider:
            </p>
            <div className="mt-2.5 rounded-lg bg-gray-950 text-white font-mono text-xs p-3.5 space-y-1 overflow-x-auto ring-1 ring-white/10">
              <div><span className="text-emerald-400">ORCHESTRATOR_MODE</span>=<span className="text-gray-400">local</span></div>
              <div><span className="text-emerald-400">GEMINI_API_KEY</span>=<span className="text-gray-400">your_gemini_key</span> <span className="text-gray-400"># primary</span></div>
              <div><span className="text-emerald-400">TELNYX_API_KEY</span>=<span className="text-gray-400">your_telnyx_key</span> <span className="text-gray-400"># fallback</span></div>
              <div><span className="text-emerald-400">E2B_API_KEY</span>=<span className="text-gray-400">your_e2b_key</span></div>
              <div><span className="text-emerald-400">FIRECRAWL_API_KEY</span>=<span className="text-gray-400">your_firecrawl_key</span></div>
              <div><span className="text-emerald-400">TURSO_DATABASE_URL</span>=<span className="text-gray-400">libsql://...</span></div>
              <div><span className="text-emerald-400">TURSO_AUTH_TOKEN</span>=<span className="text-gray-400">your_turso_token</span></div>
              <div><span className="text-emerald-400">TENANT_COOKIE_SECRET</span>=<span className="text-gray-400">a_dedicated_random_secret</span></div>
            </div>
            <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">
              BigBag runs self-hosted with support for multiple AI models, automatic dependency scanning, and sandbox live previews.
            </p>
          </div>
        </div>
      </div>

      {/* ── Value pitch ── */}
      <div
        className="rounded-2xl p-5 sm:p-6 text-white"
        style={{ background: "linear-gradient(135deg,#0f172a 0%,#0f3f39 100%)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-400/15 ring-1 ring-emerald-400/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight">Everything included.</h2>
            <p className="text-[13px] text-white/60">Self-hosted, open source, and multi-model ready.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2"
            >
              <Icon className="w-4 h-4 text-emerald-300 shrink-0" />
              <span className="text-[13px] font-medium text-white/90 truncate">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

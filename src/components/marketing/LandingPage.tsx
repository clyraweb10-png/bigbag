"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import {
  ArrowRight, Loader2, Check, Zap, Eye, Globe, GitBranch, Database, Wand2,
  ArrowUpRight, Users, Code2, Shield, ChevronRight, ChevronDown, Sparkles,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { filesFromClipboard } from "@/lib/attachments";
import { splitBySize, MAX_UPLOAD_MB, TOO_LARGE_ADVICE } from "@/lib/upload";
import { AttachChainIcon } from "@/components/prompt/ComposerIcons";
import { StarterTemplateGallery } from "@/components/dashboard/StarterTemplateGallery";

/* ─── Prompt example chips ─── */
const EXAMPLE_PROMPTS = [
  "A SaaS dashboard for managing subscriptions and billing",
  "A marketplace app where users can buy and sell digital goods",
  "A project management tool with kanban boards and task tracking",
  "A portfolio website for a creative agency with animations",
];

/* ─── Features ─── */
const FEATURES = [
  {
    icon: <Wand2 className="w-5 h-5" />,
    title: "AI App Builder",
    desc: "Describe your app in plain language. Our AI generates complete, production-ready full-stack code in minutes.",
    color: "text-[#948be8]",
    bg: "bg-[#948be8]/10",
  },
  {
    icon: <Eye className="w-5 h-5" />,
    title: "Visual Editor",
    desc: "Click any element in the live preview to edit it directly. Design-to-app without touching code.",
    color: "text-[#3f8cff]",
    bg: "bg-[#3f8cff]/10",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Real-time Preview",
    desc: "See your app running live as it's being built. Every iteration is instantly visible in the browser.",
    color: "text-[#18a981]",
    bg: "bg-[#18a981]/10",
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: "One-click Deploy",
    desc: "Ship to production with a single click. Custom domains, automatic SSL, global CDN — all included.",
    color: "text-[#ff6b6b]",
    bg: "bg-[#ff6b6b]/10",
  },
  {
    icon: <GitBranch className="w-5 h-5" />,
    title: "GitHub Sync",
    desc: "Your code, your repository. Bidirectional GitHub sync so you always own what you build.",
    color: "text-[#948be8]",
    bg: "bg-[#948be8]/10",
  },
  {
    icon: <Database className="w-5 h-5" />,
    title: "Database & CMS",
    desc: "Auto-configured database with a visual data editor. Create, read, update, delete — no SQL needed.",
    color: "text-[#3f8cff]",
    bg: "bg-[#3f8cff]/10",
  },
];

/* ─── Steps ─── */
const STEPS = [
  {
    step: "01",
    title: "Describe",
    desc: "Type your app idea in plain language. Attach designs, screenshots, or Figma files for extra context.",
  },
  {
    step: "02",
    title: "Build",
    desc: "Watch as AI generates your full-stack app live. Edit, iterate, and refine through conversation.",
  },
  {
    step: "03",
    title: "Ship",
    desc: "Deploy to the web instantly. Share your app, connect a custom domain, and grow from there.",
  },
];

/* ─── Pricing tiers ─── */
const PLANS = [
  {
    name: "Hobby",
    price: "Free",
    per: "",
    desc: "Perfect for side projects, experiments, and learning.",
    cta: "Start for free",
    features: [
      "5 daily credits (up to 30/mo)",
      "bigbag.app domain",
      "Real-time preview",
      "GitHub sync",
      "Community support",
    ],
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$2",
    per: "/month",
    desc: "Designed for fast-moving teams building together in real time.",
    cta: "Get Pro",
    badge: "Most popular",
    features: [
      "20 Pro credits + 5 daily credits",
      "Credit rollovers & top-ups",
      "Custom domains + SSL",
      "Remove bigbag badge",
      "User roles & permissions",
      "Per-member credit limits",
      "Design systems",
      "Email support",
    ],
    highlighted: true,
  },
  {
    name: "Business",
    price: "$25",
    per: "/month",
    desc: "Advanced controls and power features for growing departments.",
    cta: "Get Business",
    features: [
      "Everything in Pro",
      "Unlimited team seats",
      "SSO (SAML / OIDC)",
      "Advanced security controls",
      "Audit logs",
      "Priority support",
      "Dedicated workspace",
    ],
    highlighted: false,
  },
];

/* ─── Testimonials ─── */
const TESTIMONIALS = [
  {
    quote: "Built our SaaS MVP in 2 days. Would have taken the dev team three months. BigBag is genuinely magic.",
    name: "Sarah K.",
    role: "Co-Founder, Fieldwise",
    avatar: "SK",
    avatarColor: "bg-[#6554e8]",
  },
  {
    quote: "The visual editor completely changed how our design team works. We ship at 10× speed now, no exaggeration.",
    name: "Marcus L.",
    role: "Design Lead, Volta Studio",
    avatar: "ML",
    avatarColor: "bg-[#087a5c]",
  },
  {
    quote: "My whole team makes changes without waiting on engineering. The real-time preview is brilliant.",
    name: "Priya M.",
    role: "Head of Product, Launchflow",
    avatar: "PM",
    avatarColor: "bg-[#c83f50]",
  },
];

/* ─── Solutions ─── */
const SOLUTIONS = [
  { label: "For Work", desc: "Run on what you build.", href: "/solutions#work" },
  { label: "Founders", desc: "Ship before you pitch.", href: "/solutions#founders" },
  { label: "Product Managers", desc: "Prototype, don't spec.", href: "/solutions#product" },
  { label: "Designers", desc: "Your designs, built.", href: "/solutions#designers" },
  { label: "Marketers", desc: "Launch pages in minutes.", href: "/solutions#marketers" },
  { label: "Sales", desc: "Build the demo live.", href: "/solutions#sales" },
  { label: "Ops", desc: "Tools that fit your flow.", href: "/solutions#ops" },
  { label: "People", desc: "HR tools your team loves.", href: "/solutions#people" },
];

/* ─── Stats ─── */
const STATS = [
  { value: "12,000+", label: "Apps built" },
  { value: "8,500+", label: "Builders worldwide" },
  { value: "< 5 min", label: "Avg. first deploy" },
  { value: "99.9%", label: "Platform uptime" },
];

export function LandingPageMarketing() {
  const router = useRouter();
  const { user, status } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const attachFiles = useCallback((files: File[]) => {
    const { allowed, tooLarge } = splitBySize(files);
    if (tooLarge.length > 0) {
      toast.error(`File too large (max ${MAX_UPLOAD_MB} MB)`, { description: TOO_LARGE_ADVICE });
    }
    setAttachedFiles((prev) => [...prev, ...allowed]);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const pasted = filesFromClipboard(e.clipboardData);
    if (pasted.length) { e.preventDefault(); attachFiles(pasted); }
  }, [attachFiles]);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    setSubmitting(true);
    try {
      if (trimmed) sessionStorage.setItem("bigbag:pending-prompt", trimmed);
      if (status === "authenticated" && user) {
        router.push(`/generate?prompt=${encodeURIComponent(trimmed || "Build something amazing")}`);
      } else {
        router.push("/login");
      }
    } catch {
      setSubmitting(false);
    }
  };

  const pickExample = (ex: string) => {
    setPrompt(ex);
    textareaRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* ═══════ HERO (90vh) ═══════ */}
      <section className="relative min-h-[90vh] flex flex-col justify-center items-center pt-28 pb-14 sm:pt-36 sm:pb-20 overflow-hidden">
        {/* Subtle grid bg */}
        <div className="studio-grid absolute inset-0 -z-10 pointer-events-none" />

        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          {/* Badge */}
          <div className="mb-5 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/60 dark:bg-white/5 px-3.5 py-1 text-xs font-medium text-foreground/80 backdrop-blur-sm">
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 text-primary font-mono text-[11px] font-bold">
                &lt;/&gt;
              </div>
              <span>AI App Builder</span>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.06] tracking-[-0.04em] text-balance">
            Think it, build it{" "}
            <span className="font-mono text-primary">&lt;/&gt;</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg leading-relaxed text-muted-foreground text-balance">
            Describe the app you want to build. BigBag turns your idea into a
            production-ready full-stack app — UI, backend, database, and deployment
            — in minutes.
          </p>

          {/* Prompt composer */}
          <div className="mt-8 mx-auto max-w-2xl">
            <div className="rounded-2xl bg-card dark:bg-[#444444] border border-border/80 dark:border-0 overflow-hidden focus-within:ring-2 focus-within:ring-ring/30 transition-all shadow-sm">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onPaste={handlePaste}
                placeholder="Describe the app you want to build…"
                rows={3}
                className="w-full resize-none bg-transparent p-5 pb-3 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                }}
              />

              {/* Attached files preview */}
              {attachedFiles.length > 0 && (
                <div className="px-5 pb-2 flex flex-wrap gap-2">
                  {attachedFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-secondary rounded-md px-2 py-1">
                      {f.name}
                      <button onClick={() => setAttachedFiles((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">×</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer flex items-center gap-1.5 text-xs text-[#003399] hover:text-[#002266] dark:text-[#60a5fa] dark:hover:text-[#93c5fd] transition-colors px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      accept="image/*,.pdf,.svg"
                      onChange={(e) => { if (e.target.files) { attachFiles(Array.from(e.target.files)); e.target.value = ""; } }}
                    />
                    <AttachChainIcon className="w-4 h-4" />
                    <span className="hidden sm:inline font-medium">Attach</span>
                  </label>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={(!prompt.trim() && attachedFiles.length === 0) || submitting}
                  aria-label="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-full colourless-glass transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {submitting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Example chips */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => pickExample(ex)}
                  className="text-xs text-muted-foreground border border-border/70 hover:border-primary/40 hover:text-foreground hover:bg-accent/50 rounded-full px-3 py-1 transition-all"
                >
                  {ex.length > 40 ? ex.slice(0, 40) + "…" : ex}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              No credit card required · Free to start · Deploy in minutes
            </p>

            <a
              href="#starters"
              className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
            >
              <span>Explore pre-built starters</span>
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
            </a>
          </div>
        </div>
      </section>

      {/* ═══════ STARTERS (at 90vh) ═══════ */}
      <section id="starters" className="py-16 sm:py-24 border-t border-border bg-background relative">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3.5 py-1 text-xs font-medium text-foreground/80 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Starter Templates</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Production-ready starters to kickstart your build
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
              Explore hand-crafted starters with live motion, modern tech stack, and full prompt specifications.
            </p>
          </div>

          <StarterTemplateGallery />
        </div>
      </section>

      {/* ═══════ STATS BAR ═══════ */}
      <section className="border-y border-border bg-secondary/30 dark:bg-card/30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{s.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ FEATURES ═══════ */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
              Features
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Everything you need to build fast
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
              From idea to deployed app — BigBag handles the full stack so you can focus on what matters.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-card p-6 hover:border-primary/30 transition-colors"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${f.bg} ${f.color}`}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-foreground mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ HOW IT WORKS ═══════ */}
      <section className="py-20 sm:py-28 bg-secondary/20 dark:bg-card/20 border-y border-border">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
              How it works
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              From idea to shipped in minutes
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-8 relative">
            {/* Connector lines for desktop */}
            <div className="hidden sm:block absolute top-6 left-1/3 right-1/3 h-px bg-border" />
            {STEPS.map((step, i) => (
              <div key={step.step} className="relative text-center sm:text-left">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-background border border-border shadow-sm mb-5">
                  <span className="font-mono text-sm font-bold text-primary">{step.step}</span>
                </div>
                <h3 className="font-semibold text-lg text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="sm:hidden w-5 h-5 text-muted-foreground mx-auto mt-4" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ WORKSPACE SHOWCASE ═══════ */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              The workspace built for speed
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto text-sm sm:text-base">
              Chat with AI, see live previews, edit code, manage your database — all in one place.
            </p>
          </div>

          {/* Workspace mockup */}
          <div className="rounded-2xl border border-border overflow-hidden shadow-xl bg-[#252525]">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 border-b border-[#333332] bg-[#252525]">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#333332]" />
                <div className="w-3 h-3 rounded-full bg-[#333332]" />
                <div className="w-3 h-3 rounded-full bg-[#333332]" />
              </div>
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#6554e8] text-white text-xs font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  Preview
                </div>
                <div className="hidden sm:block px-3 py-1 rounded-full border border-[#333332] text-[#aaaab6] text-xs">Database</div>
                <div className="hidden sm:block px-3 py-1 rounded-full border border-[#333332] text-[#aaaab6] text-xs">Code</div>
                <div className="px-3 py-1 rounded-full bg-[#087a5c] text-white text-xs font-medium sm:ml-2">Publish</div>
              </div>
            </div>
            {/* Content area */}
            <div className="flex h-[30rem] flex-col divide-y divide-[#333332] sm:h-80 sm:flex-row sm:divide-x sm:divide-y-0">
              {/* Left: Chat panel */}
              <div className="flex h-52 w-full shrink-0 flex-col gap-3 overflow-hidden p-4 sm:h-auto sm:w-64">
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 shrink-0 rounded-xl bg-[#6554e8] flex items-center justify-center text-white font-mono text-[9px] font-bold">&lt;/&gt;</div>
                  <div className="rounded-xl rounded-tl-none bg-[#252525] px-3 py-2 text-[11px] text-[#f4f4f7] leading-relaxed">
                    I&apos;ve generated your SaaS landing page with hero, pricing, and testimonials sections.
                  </div>
                </div>
                <div className="self-end bg-[#252525] border border-[#333332] rounded-xl rounded-br-none px-3 py-2 text-[11px] text-[#f4f4f7] max-w-[80%]">
                  Add a dark mode toggle
                </div>
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 shrink-0 rounded-xl bg-[#6554e8] flex items-center justify-center text-white font-mono text-[9px] font-bold">&lt;/&gt;</div>
                  <div className="rounded-xl rounded-tl-none bg-[#252525] px-3 py-2 text-[11px] text-[#f4f4f7]">
                    Dark mode added ✓
                  </div>
                </div>
                <div className="mt-auto px-3 py-2 rounded-xl border border-[#333332] bg-[#444444] text-[11px] text-[#aaaab6]">
                  Ask anything…
                </div>
              </div>
              {/* Right: Preview */}
              <div className="flex-1 bg-white flex items-center justify-center overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#f7f7fa] to-[#efeff5]" />
                <div className="relative flex h-full w-full flex-col gap-3 p-4 opacity-90 sm:p-6">
                  <div className="h-7 w-32 rounded-full bg-[#948be8]/20 border border-[#948be8]/30" />
                  <div className="h-10 w-3/4 rounded-xl bg-foreground/10" />
                  <div className="h-5 w-1/2 rounded-lg bg-foreground/7" />
                  <div className="mt-2 grid grid-cols-3 gap-3 flex-1">
                    <div className="rounded-xl bg-white border border-gray-200 shadow-sm" />
                    <div className="rounded-xl bg-white border border-gray-200 shadow-sm" />
                    <div className="rounded-xl bg-white border border-gray-200 shadow-sm" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SOLUTIONS ═══════ */}
      <section className="py-20 sm:py-28 bg-secondary/20 dark:bg-card/20 border-y border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start">
            <div className="lg:w-80 shrink-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
                Solutions
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Who is it for?
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                BigBag works for every kind of builder. Whether you write code daily or never — if you have an idea, you can ship it.
              </p>
              <Link
                href="/solutions"
                className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Explore solutions <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="flex-1 grid sm:grid-cols-2 gap-3">
              {SOLUTIONS.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  className="group flex items-start justify-between rounded-xl border border-border bg-card px-4 py-3.5 hover:border-primary/40 hover:bg-accent/30 transition-all"
                >
                  <div>
                    <div className="font-medium text-foreground text-sm group-hover:text-primary transition-colors">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ PRICING PREVIEW ═══════ */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
              Pricing
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Start free, scale as you grow
            </h2>
            <p className="mt-3 text-muted-foreground text-sm sm:text-base">
              No credit card required. Upgrade when you&apos;re ready.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  plan.highlighted
                    ? "border-primary bg-primary/5 dark:bg-primary/10"
                    : "border-border bg-card"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground">
                      {plan.badge}
                    </span>
                  </div>
                )}
                <div className="mb-4">
                  <h3 className="font-bold text-foreground">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                    {plan.per && <span className="text-sm text-muted-foreground">{plan.per}</span>}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{plan.desc}</p>
                </div>

                <ul className="flex-1 space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/login"
                  className={`w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border bg-background hover:bg-accent text-foreground"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <div className="text-center mt-6">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
              See full pricing details <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════ TESTIMONIALS ═══════ */}
      <section className="py-20 sm:py-28 bg-secondary/20 dark:bg-card/20 border-y border-border">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Built by real teams, for real products
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-4">
                <p className="text-sm text-foreground leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${t.avatarColor}`}>
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ COMMUNITY STRIP ═══════ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <div className="flex -space-x-2 justify-center mb-5">
            {["bg-[#6554e8]","bg-[#087a5c]","bg-[#c83f50]","bg-[#2563b8]","bg-[#6554e8]"].map((c, i) => (
              <div key={i} className={`w-9 h-9 rounded-full border-2 border-background ${c} flex items-center justify-center text-white text-[10px] font-bold`}>
                {["AB","CD","EF","GH","IJ"][i]}
              </div>
            ))}
            <div className="w-9 h-9 rounded-full border-2 border-background bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground">
              +8k
            </div>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Join 8,500+ builders in the community
          </h2>
          <p className="mt-3 text-muted-foreground text-sm max-w-md mx-auto">
            Get help, share what you&apos;re building, attend hackathons and events near you. Real people, real projects.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <Link href="/community" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Users className="w-4 h-4" />
              Join the community
            </Link>
            <Link href="/community#events" className="inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-medium hover:bg-accent transition-colors">
              View events
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════ FINAL CTA ═══════ */}
      <section className="py-20 sm:py-24 bg-foreground dark:bg-card border-t border-border">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Code2 className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-background dark:text-foreground tracking-tight">
            Ready to bring your idea to life?
          </h2>
          <p className="mt-4 text-background/70 dark:text-muted-foreground max-w-lg mx-auto text-sm sm:text-base">
            Join thousands of founders, designers, and product teams who build faster with BigBag. Start for free — no credit card needed.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Start building for free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 py-3 bg-background/10 dark:bg-accent text-background dark:text-foreground border border-background/20 dark:border-border rounded-full text-sm font-medium hover:bg-background/20 dark:hover:bg-accent/80 transition-colors"
            >
              View pricing
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-center gap-5 text-xs text-background/50 dark:text-muted-foreground">
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Free to start</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />No credit card</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />Deploy in minutes</span>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

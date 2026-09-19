import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Solutions — BigBag AI App Builder",
  description: "BigBag works for every kind of builder — founders, designers, product managers, marketers, and teams.",
};

const SOLUTIONS = [
  {
    id: "work",
    audience: "For Work",
    tagline: "Run on what you build.",
    headline: "Build internal tools your team actually uses",
    body: "Stop paying for bloated software that doesn&apos;t quite fit. With BigBag, your operations team can build custom dashboards, approval workflows, and internal tools tailored to your exact process — no engineering bottleneck, no waiting in the sprint queue.",
    benefits: [
      "Custom dashboards in hours, not sprints",
      "Connect to your existing data sources",
      "Role-based access for every team member",
      "Deploy internally with one click",
    ],
    cta: "Start building for your team",
    emoji: "🏢",
    color: "bg-[#948be8]/10 border-[#948be8]/20",
    accent: "text-[#948be8]",
  },
  {
    id: "founders",
    audience: "Founders",
    tagline: "Ship before you pitch.",
    headline: "Validate your idea before hiring a single engineer",
    body: "The best pitch deck is a working product. BigBag lets you build a functional, full-stack app from your idea in a single afternoon — fast enough to show investors, real enough to onboard your first users.",
    benefits: [
      "Full-stack app from a single prompt",
      "Live demo URL in minutes",
      "GitHub sync from day one",
      "Iterate in real time during calls",
    ],
    cta: "Launch your MVP today",
    emoji: "🚀",
    color: "bg-[#3f8cff]/10 border-[#3f8cff]/20",
    accent: "text-[#3f8cff]",
  },
  {
    id: "product",
    audience: "Product Managers",
    tagline: "Prototype, don't spec.",
    headline: "Show the team exactly what you mean",
    body: "Stop writing requirements documents that engineering misinterprets. Build a real, interactive prototype in BigBag and share the URL. Everyone sees the same thing — no ambiguity, no misalignment, no wasted sprints.",
    benefits: [
      "Interactive prototypes, not static mockups",
      "Share a live URL with anyone",
      "Iterate without engineering cycles",
      "Test with real users before committing",
    ],
    cta: "Build your first prototype",
    emoji: "📋",
    color: "bg-[#18a981]/10 border-[#18a981]/20",
    accent: "text-[#18a981]",
  },
  {
    id: "designers",
    audience: "Designers",
    tagline: "Your designs, built.",
    headline: "Go from Figma to fully deployed in the same session",
    body: "Import your Figma designs and watch BigBag bring them to life with real code. Use the visual editor to tweak pixel-perfect details in the live preview. No hand-off. No lost translation. Your design, exactly as you envisioned it.",
    benefits: [
      "Figma import — design becomes code",
      "Visual editor for pixel-perfect edits",
      "Real responsive behaviour, not static",
      "Deploy with your own domain",
    ],
    cta: "Import your Figma design",
    emoji: "🎨",
    color: "bg-[#ff6b6b]/10 border-[#ff6b6b]/20",
    accent: "text-[#ff6b6b]",
  },
  {
    id: "marketers",
    audience: "Marketers",
    tagline: "Launch pages in minutes.",
    headline: "Campaign landing pages that don't require a ticket",
    body: "Need a landing page for next week&apos;s campaign? Build it yourself. BigBag creates high-converting landing pages from a simple description — complete with forms, animations, and SEO-ready markup. No designer needed, no developer queue.",
    benefits: [
      "Landing pages from a description",
      "Built-in forms and lead capture",
      "SEO-optimised markup out of the box",
      "Custom domain, live in minutes",
    ],
    cta: "Launch your next campaign",
    emoji: "📣",
    color: "bg-[#948be8]/10 border-[#948be8]/20",
    accent: "text-[#948be8]",
  },
  {
    id: "sales",
    audience: "Sales",
    tagline: "Build the demo live.",
    headline: "Show prospects exactly what their experience will look like",
    body: "Win deals by building the prospect&apos;s dream version of your product live in the call. With BigBag, you can customise a demo app on the fly — their logo, their data, their use case — while they watch. Close while the wow is fresh.",
    benefits: [
      "Live customisation during sales calls",
      "Branded demo environments in minutes",
      "Share a URL, no install needed",
      "Iterate based on feedback in real time",
    ],
    cta: "Build your sales demo",
    emoji: "💼",
    color: "bg-[#3f8cff]/10 border-[#3f8cff]/20",
    accent: "text-[#3f8cff]",
  },
  {
    id: "ops",
    audience: "Ops",
    tagline: "Tools that fit your flow.",
    headline: "Replace spreadsheets with apps that actually work",
    body: "Every ops team runs on a collection of spreadsheets, Notion docs, and workarounds. BigBag lets you replace them with proper apps — request trackers, inventory systems, approval flows — built around your exact process.",
    benefits: [
      "Replace spreadsheets with real apps",
      "Custom approval and request flows",
      "Connect to your existing data",
      "Role-based permissions built in",
    ],
    cta: "Streamline your operations",
    emoji: "⚙️",
    color: "bg-[#18a981]/10 border-[#18a981]/20",
    accent: "text-[#18a981]",
  },
  {
    id: "people",
    audience: "People",
    tagline: "HR tools your team loves.",
    headline: "Build HR experiences that feel as good as consumer apps",
    body: "Your people team deserves tools that match the quality of your product. Build employee onboarding portals, feedback tools, benefits dashboards, and org charts that your team actually wants to use — not generic SaaS with a company logo pasted on top.",
    benefits: [
      "Onboarding portals in hours",
      "Feedback and survey tools",
      "Benefits and PTO dashboards",
      "Data stays in your own infrastructure",
    ],
    cta: "Build your HR tooling",
    emoji: "👥",
    color: "bg-[#ff6b6b]/10 border-[#ff6b6b]/20",
    accent: "text-[#ff6b6b]",
  },
];

export default function SolutionsPage() {
  return (
    <div className="bg-background text-foreground">
      {/* Hero */}
      <section className="py-20 sm:py-28 text-center border-b border-border">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            Solutions
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-foreground">
            Who is BigBag for?
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            If you have an idea and want to ship it — BigBag is for you. Here&apos;s how different teams use it every day.
          </p>
        </div>
      </section>

      {/* Quick links */}
      <section className="py-8 border-b border-border bg-secondary/20 dark:bg-card/20 sticky top-16 z-40 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {SOLUTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-accent/50 transition-all whitespace-nowrap"
              >
                <span>{s.emoji}</span>
                <span>{s.audience}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Solution sections */}
      <div className="divide-y divide-border">
        {SOLUTIONS.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            className={`py-16 sm:py-24 scroll-mt-32 ${i % 2 === 1 ? "bg-secondary/10 dark:bg-card/20" : ""}`}
          >
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className={`flex flex-col ${i % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse"} gap-12 lg:gap-20 items-center`}>
                {/* Text side */}
                <div className="flex-1">
                  <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium mb-4 ${s.color}`}>
                    <span>{s.emoji}</span>
                    <span className={s.accent}>{s.audience}</span>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{s.tagline}</p>
                  <h2 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight tracking-tight mb-4">
                    {s.headline}
                  </h2>
                  <p
                    className="text-muted-foreground leading-relaxed mb-6 text-sm sm:text-base"
                    dangerouslySetInnerHTML={{ __html: s.body }}
                  />
                  <ul className="space-y-2.5 mb-8">
                    {s.benefits.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm">
                        <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${s.accent.replace("text-", "bg-")}`} />
                        <span className="text-foreground/80">{b}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/login"
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors ${s.accent} border ${s.color.replace("bg-", "border-").replace("/10", "/30")} hover:opacity-80`}
                  >
                    {s.cta}
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                </div>

                {/* Visual side */}
                <div className="flex-1 w-full max-w-lg">
                  <div className={`rounded-2xl border ${s.color} p-8 aspect-video flex items-center justify-center`}>
                    <span className="text-7xl">{s.emoji}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Final CTA */}
      <section className="py-16 sm:py-20 bg-foreground dark:bg-card border-t border-border text-center">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-background dark:text-foreground tracking-tight">
            Whatever you build, start here
          </h2>
          <p className="mt-3 text-sm text-background/70 dark:text-muted-foreground">
            Free to start. No credit card needed. Deployed in minutes.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Start building for free
          </Link>
        </div>
      </section>
    </div>
  );
}

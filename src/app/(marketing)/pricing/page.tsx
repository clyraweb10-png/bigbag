import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing — BigBag AI App Builder",
  description: "Start free, scale as you grow. Simple and transparent pricing for every kind of builder.",
};

const PLANS = [
  {
    name: "Hobby",
    price: "$0",
    per: "",
    badge: null,
    tagline: "Perfect for side projects, experiments, and learning.",
    cta: "Start for free",
    ctaHref: "/login",
    ctaStyle: "border border-border bg-background hover:bg-accent text-foreground",
    features: [
      { text: "5 daily credits (up to 30/month)", highlight: false },
      { text: "bigbag.app subdomain", highlight: false },
      { text: "Real-time app preview", highlight: false },
      { text: "AI app builder", highlight: false },
      { text: "GitHub sync", highlight: false },
      { text: "Visual editor", highlight: false },
      { text: "Community support", highlight: false },
    ],
    notIncluded: [
      "Custom domains",
      "Credit rollovers",
      "Remove bigbag badge",
      "User roles",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$2",
    per: "/month",
    badge: "Most popular",
    tagline: "Designed for fast-moving teams building together in real time.",
    cta: "Get Pro",
    ctaHref: "/login",
    ctaStyle: "bg-primary text-primary-foreground hover:bg-primary/90",
    features: [
      { text: "All Free features", highlight: false },
      { text: "20 Pro credits per month", highlight: true },
      { text: "5 daily credits (up to 30/month)", highlight: false },
      { text: "Credit rollovers", highlight: false },
      { text: "On-demand credit top-ups", highlight: false },
      { text: "Unlimited bigbag.app domains", highlight: false },
      { text: "Custom domains + SSL", highlight: true },
      { text: "User roles & permissions", highlight: false },
      { text: "Per-member credit limits", highlight: false },
      { text: "Remove the bigbag badge", highlight: false },
      { text: "Design systems", highlight: false },
      { text: "Email support", highlight: false },
    ],
    notIncluded: [],
  },
  {
    name: "Business",
    price: "$25",
    per: "/month",
    badge: null,
    tagline: "Advanced controls and power features for growing departments.",
    cta: "Get Business",
    ctaHref: "/login",
    ctaStyle: "border border-border bg-background hover:bg-accent text-foreground",
    features: [
      { text: "Everything in Pro", highlight: false },
      { text: "Unlimited team members", highlight: true },
      { text: "SSO via SAML / OIDC", highlight: true },
      { text: "Advanced security controls", highlight: false },
      { text: "Audit logs", highlight: false },
      { text: "Custom publishing approval flows", highlight: false },
      { text: "Dedicated workspace", highlight: false },
      { text: "Priority support + onboarding", highlight: false },
      { text: "SLA guarantee", highlight: false },
    ],
    notIncluded: [],
  },
];

const FAQS = [
  {
    q: "What is a credit?",
    a: "A credit represents one AI-powered operation — generating or editing your app. Each time the AI builds, edits, or refines your app, it uses one credit. Previewing, deploying, and using the visual editor are always free.",
  },
  {
    q: "What happens when I run out of credits?",
    a: "Your app and all previews stay live. You just can't send new AI prompts until your credits reset. Pro and Business users can top up instantly — credits are added within seconds.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, absolutely. Cancel from your account settings at any time. Your apps stay live and your code stays yours forever, even after cancellation.",
  },
  {
    q: "Do unused credits roll over?",
    a: "On the Pro plan, unused monthly Pro credits roll over to the next month (up to 3× your monthly allowance). Daily credits do not roll over. Hobby plan credits do not roll over.",
  },
  {
    q: "Is there a free trial for Pro?",
    a: "The Hobby plan is completely free and gives you a genuine feel for the platform. If you want to try Pro features, you can upgrade for $2 and cancel within the first month for a full refund.",
  },
  {
    q: "What does 'remove the bigbag badge' mean?",
    a: "All apps built with the Hobby plan show a small 'Built with bigbag' footer badge. Pro and Business subscribers can remove it for a fully white-label experience.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. Upgrade or downgrade at any time. When upgrading, you get Pro or Business credits immediately. When downgrading, the change takes effect at the end of your billing period.",
  },
  {
    q: "Do you offer discounts for students or nonprofits?",
    a: "Yes — students get 50% off Pro with a valid .edu email address. Nonprofits and open-source projects can apply for a sponsored plan. Reach out at hello@bigbag.app.",
  },
];

export default function PricingPage() {
  return (
    <div className="bg-background text-foreground">
      {/* ── Hero ── */}
      <section className="py-20 sm:py-28 text-center border-b border-border">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            Pricing
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-foreground">
            Start free.<br />Scale when you&apos;re ready.
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            No credit card required to get started. Pick the plan that fits your pace — upgrade or downgrade anytime.
          </p>
        </div>
      </section>

      {/* ── Plans ── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid sm:grid-cols-3 gap-5">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border flex flex-col ${
                  plan.badge
                    ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-md"
                    : "border-border bg-card"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground shadow-sm">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="p-6 border-b border-border">
                  <h2 className="text-lg font-bold text-foreground">{plan.name}</h2>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight text-foreground">{plan.price}</span>
                    {plan.per && <span className="text-sm text-muted-foreground">{plan.per}</span>}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{plan.tagline}</p>
                  <Link
                    href={plan.ctaHref}
                    className={`mt-4 w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${plan.ctaStyle}`}
                  >
                    {plan.cta}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                <div className="p-6 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    What&apos;s included
                  </p>
                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2.5 text-sm">
                        <Check className={`w-4 h-4 shrink-0 mt-0.5 ${f.highlight ? "text-primary" : "text-muted-foreground"}`} />
                        <span className={f.highlight ? "text-foreground font-medium" : "text-foreground/80"}>
                          {f.text}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {plan.notIncluded.length > 0 && (
                    <ul className="mt-4 space-y-2.5">
                      {plan.notIncluded.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-sm">
                          <span className="w-4 h-4 shrink-0 mt-0.5 text-border font-bold text-lg leading-none">—</span>
                          <span className="text-muted-foreground/60">{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Enterprise CTA */}
          <div className="mt-8 rounded-2xl border border-border bg-card p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-lg font-bold text-foreground">Enterprise</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Volume pricing, SCIM provisioning, audit logs, GitHub Enterprise integration, dedicated support, and custom SLAs. Let&apos;s talk.
              </p>
            </div>
            <Link
              href="mailto:enterprise@bigbag.app"
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-full text-sm font-semibold hover:bg-foreground/90 transition-colors"
            >
              Contact sales
            </Link>
          </div>
        </div>
      </section>

      {/* ── Credit system explainer ── */}
      <section className="py-16 sm:py-20 bg-secondary/20 dark:bg-card/20 border-y border-border">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            How credits work
          </h2>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Credits are used each time the AI builds or edits your app. Previewing, publishing, deploying, using the visual editor, browsing your database, and syncing with GitHub are always free.
          </p>
          <div className="mt-8 grid sm:grid-cols-3 gap-4 text-left">
            {[
              { label: "Uses a credit", items: ["AI prompt (build or edit)", "Starting a new conversation", "Restoring a version"] },
              { label: "Always free", items: ["Live preview", "Visual editor clicks", "GitHub sync", "Database browsing", "Publishing & deploy"] },
              { label: "Top-ups", items: ["Buy extra credits anytime", "Credits added instantly", "No subscription required", "Pro plan only"] },
            ].map((col) => (
              <div key={col.label} className="rounded-xl border border-border bg-card p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{col.label}</div>
                <ul className="space-y-2">
                  {col.items.map((item) => (
                    <li key={item} className="text-sm text-foreground/80 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center text-foreground mb-10">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-xl border border-border bg-card overflow-hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 font-medium text-sm text-foreground list-none [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="shrink-0 text-muted-foreground text-lg group-open:rotate-45 transition-transform duration-200">+</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-16 sm:py-20 bg-foreground dark:bg-card border-t border-border text-center">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-background dark:text-foreground tracking-tight">
            Ready to build your idea?
          </h2>
          <p className="mt-3 text-sm text-background/70 dark:text-muted-foreground">
            Start free and upgrade when you need more power.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Start building for free
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

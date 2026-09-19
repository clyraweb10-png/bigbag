import type { Metadata } from "next";
import Link from "next/link";
import { Shield, Lock, Globe, Database, Eye, Zap, Server, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Security — BigBag AI App Builder",
  description: "Secure by design. Choose where your data lives, enforce SSO and role-based access, and keep your code out of model training.",
};

const SECURITY_SECTIONS = [
  {
    icon: <Users className="w-6 h-6" />,
    title: "Access and control",
    body: "BigBag integrates with SAML and OIDC providers including Okta, Azure AD, and Google. SCIM supports automated provisioning and deprovisioning. Permissions are role-based and enforced server-side across viewing, editing, approving, and publishing.",
    details: [
      "SAML 2.0 and OIDC single sign-on",
      "Okta, Azure AD, and Google Workspace support",
      "SCIM for automated user provisioning",
      "Role-based access: viewer, editor, approver, publisher",
      "Permissions enforced server-side on every request",
    ],
  },
  {
    icon: <Lock className="w-6 h-6" />,
    title: "Guardrails for building and publishing",
    body: "Editing, approval, and publishing are separate permissions. Public access is controlled by role and environment settings, so teams can move quickly without risking accidental exposure.",
    details: [
      "Separate edit, approve, and publish permissions",
      "Environment-gated publishing (dev / staging / prod)",
      "Approval workflows before public deployment",
      "Public access controlled at the workspace level",
    ],
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Secrets are handled securely",
    body: "Secrets are encrypted at rest and access-controlled by role. They are not exposed in plaintext in logs or interfaces. Access is limited to authorised environments and actions.",
    details: [
      "AES-256 encryption at rest",
      "Secrets never appear in logs or UI",
      "Role-scoped secret access",
      "Separate secrets per environment",
    ],
  },
  {
    icon: <Globe className="w-6 h-6" />,
    title: "Data residency",
    body: "BigBag supports regional data hosting in the EU, US, and Asia Pacific. Customer data remains in the region you select and does not move across regions by default. We are transparent about our infrastructure and subprocessors.",
    details: [
      "EU, US, and Asia Pacific region options",
      "Data stays in your selected region",
      "No cross-region data movement by default",
      "Full subprocessor transparency",
    ],
  },
  {
    icon: <Database className="w-6 h-6" />,
    title: "Your data is not used to train models",
    body: "Business plan data is not used to train AI models. Free and Pro subscribers can opt out in account settings. Contractual agreements with AI providers restrict training on customer data. Your work stays your work.",
    details: [
      "Business plan: training opt-out by default",
      "Free / Pro: opt out in account settings",
      "Contractual restrictions on AI provider training",
      "You retain full ownership of your code and prompts",
    ],
  },
  {
    icon: <Eye className="w-6 h-6" />,
    title: "Isolation by design",
    body: "Each workspace and project is logically separated. Customer data is not accessible across accounts. Environment boundaries are explicitly defined and evaluated before changes are published.",
    details: [
      "Logical separation per workspace and project",
      "No cross-account data access",
      "Explicit dev/prod environment boundaries",
      "Evaluated before every publish action",
    ],
  },
  {
    icon: <Zap className="w-6 h-6" />,
    title: "Continuous monitoring and abuse detection",
    body: "BigBag continuously monitors platform activity for misuse, anomalous behaviour, and compromise. Automated systems enforce rate limits and detect abuse across users and workspaces, with high-risk activity reviewed by our trust and safety team.",
    details: [
      "Real-time anomaly detection",
      "Automated rate limiting at IP, user, and workspace level",
      "High-risk activity review by trust & safety",
      "24/7 platform monitoring",
    ],
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Automatic security scanning",
    body: "A basic security scan runs automatically every time you publish, checking database configurations, RLS rules, cloud project settings, and known misconfiguration patterns — in about 10–15 seconds. A deep scan is available on demand and takes about 3 minutes. Workspace admins can block publishing on critical findings.",
    details: [
      "Auto-scan on every publish (10–15 sec)",
      "Deep AI-powered scan on demand (~3 min)",
      "Checks RLS rules, DB config, cloud settings",
      "Block publishing on critical findings",
      "Recurring scheduled deep scans (Business plan)",
    ],
  },
  {
    icon: <Server className="w-6 h-6" />,
    title: "Protected infrastructure",
    body: "BigBag Cloud is protected by web application firewall (WAF) controls, network isolation, encrypted data storage, and adaptive rate limiting at the IP, user, and workspace level.",
    details: [
      "WAF protection on all endpoints",
      "Network isolation and private VPC",
      "Encrypted data at rest and in transit (TLS 1.3)",
      "Adaptive rate limiting",
    ],
  },
];

const FAQS = [
  { q: "Where is customer data stored?", a: "Customer data is stored in the region you select at workspace creation. Available regions: EU (Frankfurt), US (Virginia), and Asia Pacific (Singapore). Data does not move across regions by default." },
  { q: "Is customer data used to train AI?", a: "Business plan data is never used to train AI models. Free and Pro subscribers can opt out at any time in their account settings. We have contractual agreements with all AI providers restricting training use of customer data." },
  { q: "Is BigBag multi-tenant, and how is customer data isolated?", a: "Yes. BigBag is a multi-tenant SaaS platform. Each workspace is logically isolated — data is segregated at the database and application layer. We do not share compute or storage resources between customers for sensitive data." },
  { q: "Which subprocessors does BigBag use?", a: "We maintain a public subprocessor list available at bigbag.app/legal/subprocessors. Key subprocessors include Google Cloud (infrastructure), Google Gemini (AI generation), and Cloudflare (CDN/WAF). We notify customers of new subprocessors with 30 days notice." },
  { q: "Does BigBag access or clone our source code?", a: "BigBag generates and stores your source code to enable the workspace, preview, and deploy features. Workspace admins can export or delete all code at any time. Code is not shared with other customers or used for model training on Business plans." },
  { q: "How does BigBag enforce role-based access control (RBAC)?", a: "Permissions are enforced server-side on every API request. Frontend UI restrictions are supplementary — all access decisions are made in the backend. Roles include: Owner, Admin, Editor, Approver, Viewer, and Guest." },
  { q: "How are secrets and API credentials managed?", a: "Secrets are encrypted at rest using AES-256 and never exposed in plaintext in logs, UI, or AI responses. Each secret is scoped to an environment (development or production) and a role. Secrets are injected at runtime, never stored in source code." },
  { q: "Is BigBag SOC 2 or GDPR compliant?", a: "BigBag is in the process of SOC 2 Type II certification. We are GDPR compliant — we offer data processing agreements (DPAs), support data subject access requests (DSARs), and process data lawfully. Contact privacy@bigbag.app for a DPA." },
];

export default function SecurityPage() {
  return (
    <div className="bg-background text-foreground">
      {/* Hero */}
      <section className="py-20 sm:py-28 text-center border-b border-border">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            Security
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] text-foreground">
            Secure by design
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Choose where your data lives, enforce SSO and role-based access, control publishing with approvals, and keep your code and prompts out of model training.
          </p>

          {/* Trust logos (placeholder) */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
            {["GDPR Compliant", "SOC 2 Type II", "TLS 1.3", "AES-256", "EU / US / APAC"].map((badge) => (
              <div key={badge} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium text-muted-foreground">
                <Shield className="w-3.5 h-3.5 text-primary" />
                {badge}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security sections */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-xl font-bold text-foreground mb-2">Enterprise security controls</h2>
          <p className="text-sm text-muted-foreground mb-10 max-w-2xl">
            BigBag is built for teams that take security seriously. Here is everything we do to keep your data safe, your access controlled, and your workflows auditable.
          </p>

          <div className="grid sm:grid-cols-2 gap-5">
            {SECURITY_SECTIONS.map((section) => (
              <div key={section.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  {section.icon}
                </div>
                <h3 className="font-bold text-foreground mb-2">{section.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{section.body}</p>
                <ul className="space-y-1.5">
                  {section.details.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Founder security */}
      <section className="py-16 sm:py-20 bg-secondary/20 dark:bg-card/20 border-y border-border">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid sm:grid-cols-2 gap-8">
            <div>
              <div className="w-10 h-10 rounded-xl bg-[#948be8]/10 text-[#948be8] flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-3">AI penetration testing</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Get an audit-ready security report for SOC 2, ISO 27001, and investor due diligence, proving your app is secure before your team grows.
              </p>
              <p className="text-xs text-muted-foreground">Available on Business plan</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-xl bg-[#3f8cff]/10 text-[#3f8cff] flex items-center justify-center mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-3">Find vulnerabilities before they find you</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                A basic security scan runs automatically before every publish. Run a deep AI-powered scan on demand to analyse your full codebase. Dependency checks run continuously in the background as you build.
              </p>
              <p className="text-xs text-muted-foreground">Basic scan: all plans · Deep scan: Pro and above</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center text-foreground mb-10">
            Frequently asked questions
          </h2>
          <div className="space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-xl border border-border bg-card overflow-hidden">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 font-medium text-sm text-foreground list-none [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="shrink-0 text-muted-foreground text-lg group-open:rotate-45 transition-transform duration-200">+</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 border-t border-border text-center">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-foreground">Have specific security requirements?</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We work with enterprise teams on custom security configurations, dedicated environments, and compliance reviews.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <Link href="mailto:security@bigbag.app" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              Contact our security team
            </Link>
            <Link href="/pricing" className="inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-medium hover:bg-accent transition-colors">
              View Business plan
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

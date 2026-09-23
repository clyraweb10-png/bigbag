"use client";

import { useState, useMemo } from "react";
import { X, Search, ChevronLeft, ArrowRight, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ── Connector catalogue ── */

type ConnectorCategory =
  | "Backend / Core"
  | "Commerce & Payments"
  | "AI & Automation"
  | "Data & Analytics"
  | "Communications"
  | "Business & CRM"
  | "Maps & Media";

interface Connector {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  color: string; // icon background colour
  initials: string;
  capabilities: string[];
}

const CONNECTORS: Connector[] = [
  // Backend / Core (2)
  {
    id: "supabase",
    name: "Supabase",
    description: "Postgres database, auth, storage in one platform",
    category: "Backend / Core",
    color: "#3ECF8E",
    initials: "SB",
    capabilities: [
      "Connect a Postgres database to your app.",
      "Add auth (magic link, OAuth, email/password).",
      "Store and serve files from Supabase Storage.",
      "Subscribe to real-time database changes.",
    ],
  },
  {
    id: "amazon-s3",
    name: "Amazon S3",
    description: "File/data storage for images and assets",
    category: "Backend / Core",
    color: "#FF9900",
    initials: "S3",
    capabilities: [
      "Upload and retrieve images, videos, and documents.",
      "Generate pre-signed download URLs for secure access.",
      "List and delete objects in a bucket.",
      "Sync assets between your app and S3.",
    ],
  },
  // Commerce & Payments (7)
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, billing, subscriptions",
    category: "Commerce & Payments",
    color: "#635BFF",
    initials: "ST",
    capabilities: [
      "Sell products or subscriptions and get paid online.",
      "Create and manage payment intents from your app.",
      "Issue refunds and handle disputes.",
      "Webhook events for successful charges and failures.",
    ],
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Storefront, products, order data",
    category: "Commerce & Payments",
    color: "#96BF48",
    initials: "SH",
    capabilities: [
      "Read and display products and collections.",
      "Create orders and manage customer records.",
      "Sync inventory levels in real time.",
      "Trigger fulfilment workflows on new orders.",
    ],
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    description: "Products, orders, coupons",
    category: "Commerce & Payments",
    color: "#7F54B3",
    initials: "WC",
    capabilities: [
      "Read and update products and stock levels.",
      "Fetch and process orders from your store.",
      "Create and redeem discount coupons.",
      "Sync customer data with your app.",
    ],
  },
  {
    id: "chargebee",
    name: "Chargebee",
    description: "Subscription/invoice billing",
    category: "Commerce & Payments",
    color: "#FF6844",
    initials: "CB",
    capabilities: [
      "Create and manage subscriptions for your users.",
      "Generate and send invoices automatically.",
      "Handle plan upgrades, downgrades, and cancellations.",
      "Expose billing history to customers in your app.",
    ],
  },
  {
    id: "xero",
    name: "Xero",
    description: "Accounting, invoices, financial reports",
    category: "Commerce & Payments",
    color: "#13B5EA",
    initials: "XR",
    capabilities: [
      "Create and send invoices from your app.",
      "Read account balances and transactions.",
      "Sync contacts and suppliers.",
      "Pull profit-and-loss and balance-sheet reports.",
    ],
  },
  {
    id: "wix",
    name: "Wix",
    description: "Sites, ecommerce, bookings, CMS",
    category: "Commerce & Payments",
    color: "#0C6EFC",
    initials: "WX",
    capabilities: [
      "Read and update CMS collections.",
      "Sync product catalogue and inventory.",
      "Manage bookings and appointments.",
      "Retrieve site analytics and visitor data.",
    ],
  },
  {
    id: "polar",
    name: "Polar.sh",
    description: "Revenue dashboards on billing data",
    category: "Commerce & Payments",
    color: "#5B67F2",
    initials: "PL",
    capabilities: [
      "Pull MRR, ARR, and churn metrics.",
      "Display subscriber counts and revenue trends.",
      "Track product and plan performance.",
      "Receive webhook events on subscription changes.",
    ],
  },
  // AI & Automation (7)
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Real-time web search with cited sources, no API key needed",
    category: "AI & Automation",
    color: "#20B2AA",
    initials: "PX",
    capabilities: [
      "Perform real-time web searches from your app.",
      "Return answers with source citations.",
      "Ask follow-up questions in a conversation.",
      "No API key required for basic usage.",
    ],
  },
  {
    id: "replicate",
    name: "Replicate",
    description: "Run AI models for images, video, audio, text",
    category: "AI & Automation",
    color: "#7C3AED",
    initials: "RP",
    capabilities: [
      "Generate images with Stable Diffusion or FLUX.",
      "Transcribe audio with Whisper.",
      "Run video generation models.",
      "Execute any open-source model via the API.",
    ],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Human-sounding voice generation",
    category: "AI & Automation",
    color: "#000000",
    initials: "EL",
    capabilities: [
      "Convert text to natural-sounding speech.",
      "Clone voices from audio samples.",
      "Stream audio in real time to your app.",
      "Choose from 900+ voices and languages.",
    ],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Scrape websites into clean structured data",
    category: "AI & Automation",
    color: "#FF4500",
    initials: "FC",
    capabilities: [
      "Scrape any public URL into clean Markdown.",
      "Crawl entire sites and return structured content.",
      "Extract specific fields using AI.",
      "Take screenshots of any web page.",
    ],
  },
  {
    id: "gemini-enterprise",
    name: "Gemini Enterprise",
    description: "Search/query/summarize across Google data sources",
    category: "AI & Automation",
    color: "#4285F4",
    initials: "GE",
    capabilities: [
      "Query Google Workspace documents and emails.",
      "Summarize long documents in seconds.",
      "Generate structured data from unstructured text.",
      "Search across Drive, Docs, and Gmail.",
    ],
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Automate across 400+ services",
    category: "AI & Automation",
    color: "#EA4B71",
    initials: "N8",
    capabilities: [
      "Trigger workflows from your app via webhook.",
      "Chain 400+ service integrations without code.",
      "Run scheduled automations on a cron.",
      "Return data back to your app from a workflow.",
    ],
  },
  {
    id: "custom-mcp",
    name: "Custom (MCP)",
    description: "Connect literally any API or MCP server not on the list",
    category: "AI & Automation",
    color: "#6554E8",
    initials: "MC",
    capabilities: [
      "Connect any REST API with a custom MCP server.",
      "Define tools and schemas for AI agents.",
      "Reuse across multiple projects.",
      "Full control over auth and rate limiting.",
    ],
  },
  // Data & Analytics (5)
  {
    id: "algolia",
    name: "Algolia",
    description: "AI search and discovery for your site",
    category: "Data & Analytics",
    color: "#003DFF",
    initials: "AL",
    capabilities: [
      "Add instant full-text search to your app.",
      "Sync records to an Algolia index.",
      "Display search results with highlighting.",
      "Personalise results per user.",
    ],
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Page views, events, conversions",
    category: "Data & Analytics",
    color: "#E37400",
    initials: "GA",
    capabilities: [
      "Track page views and user sessions.",
      "Send custom events from your app.",
      "Measure goal conversions and funnels.",
      "Pull report data into your dashboards.",
    ],
  },
  {
    id: "amplitude",
    name: "Amplitude",
    description: "Real user behaviour analytics",
    category: "Data & Analytics",
    color: "#1A66FF",
    initials: "AM",
    capabilities: [
      "Track user events and session replays.",
      "Build funnels and retention charts.",
      "Segment users by behaviour.",
      "Pull cohort data into your app.",
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Analytics, feature flags, experiments",
    category: "Data & Analytics",
    color: "#F54E00",
    initials: "PH",
    capabilities: [
      "Track events and sessions.",
      "Roll out features with flag controls.",
      "Run A/B tests and measure impact.",
      "Query events with SQL in your app.",
    ],
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    description: "SEO/search performance data",
    category: "Data & Analytics",
    color: "#34A853",
    initials: "SC",
    capabilities: [
      "Pull click, impression, and position data.",
      "Monitor crawl errors and coverage.",
      "Track top queries and landing pages.",
      "Display SEO KPIs in your dashboard.",
    ],
  },
  // Communications (5)
  {
    id: "resend",
    name: "Resend",
    description: "Transactional email at scale",
    category: "Communications",
    color: "#000000",
    initials: "RS",
    capabilities: [
      "Send transactional emails via API.",
      "Use React or HTML email templates.",
      "Track open and click events.",
      "Manage domains and DNS records.",
    ],
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "SMS, calls, two-way messaging",
    category: "Communications",
    color: "#F22F46",
    initials: "TW",
    capabilities: [
      "Send SMS messages to any number.",
      "Make and receive phone calls.",
      "Build two-way messaging flows.",
      "Use WhatsApp messaging via the API.",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Notifications and team updates",
    category: "Communications",
    color: "#4A154B",
    initials: "SL",
    capabilities: [
      "Post messages to channels from your app.",
      "Send direct messages to users.",
      "Create interactive Slack bots.",
      "Listen to events via webhooks.",
    ],
  },
  {
    id: "firebase-fcm",
    name: "Firebase Cloud Messaging",
    description: "Push notifications",
    category: "Communications",
    color: "#FFCA28",
    initials: "FM",
    capabilities: [
      "Send push notifications to iOS and Android.",
      "Target individual devices or topics.",
      "Schedule notification campaigns.",
      "Track delivery and open rates.",
    ],
  },
  {
    id: "mailgun",
    name: "Mailgun",
    description: "Transactional email + delivery tracking",
    category: "Communications",
    color: "#F06B26",
    initials: "MG",
    capabilities: [
      "Send transactional and bulk emails.",
      "Parse inbound emails and route them.",
      "Track opens, clicks, and bounces.",
      "Manage mailing lists and suppressions.",
    ],
  },
  // Business & CRM (2)
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM, marketing, sales workflows",
    category: "Business & CRM",
    color: "#FF7A59",
    initials: "HS",
    capabilities: [
      "Create and update contacts and companies.",
      "Log deals and track pipeline stages.",
      "Trigger marketing emails and workflows.",
      "Sync form submissions to HubSpot CRM.",
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "CRM data integration",
    category: "Business & CRM",
    color: "#00A1E0",
    initials: "SF",
    capabilities: [
      "Read and write Salesforce objects.",
      "Sync leads and opportunities.",
      "Run SOQL queries from your app.",
      "Trigger Salesforce flows via API.",
    ],
  },
  // Maps & Media (2)
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Address search, maps, routing",
    category: "Maps & Media",
    color: "#4285F4",
    initials: "GM",
    capabilities: [
      "Embed interactive maps in your app.",
      "Autocomplete address inputs.",
      "Calculate routes and distances.",
      "Reverse-geocode coordinates to addresses.",
    ],
  },
  {
    id: "logo-dev",
    name: "Logo.dev",
    description: "Auto-display company logos by domain",
    category: "Maps & Media",
    color: "#18181B",
    initials: "LD",
    capabilities: [
      "Fetch company logos by domain name.",
      "Display brand icons in tables and cards.",
      "High-res SVG/PNG logos for 100k+ companies.",
      "No API key required for basic use.",
    ],
  },
];

const CATEGORIES: ConnectorCategory[] = [
  "Backend / Core",
  "Commerce & Payments",
  "AI & Automation",
  "Data & Analytics",
  "Communications",
  "Business & CRM",
  "Maps & Media",
];

/* ── ConnectorIcon ── */

function ConnectorIcon({ connector, size = "md" }: { connector: Connector; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "w-12 h-12 text-base rounded-xl" : size === "sm" ? "w-8 h-8 text-[9px] rounded-lg" : "w-10 h-10 text-xs rounded-xl";
  return (
    <div
      className={`${sizeClass} flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: connector.color === "#000000" || connector.color === "#18181B" ? "#333" : connector.color }}
    >
      {connector.initials}
    </div>
  );
}

/* ── ConnectorsModal ── */

interface ConnectorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorsModal({ open, onOpenChange }: ConnectorsModalProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ConnectorCategory | "All">("All");
  const [selected, setSelected] = useState<Connector | null>(null);
  const [connectorType, setConnectorType] = useState<"shared" | "user">("shared");

  const filtered = useMemo(() => {
    let list = CONNECTORS;
    if (activeCategory !== "All") list = list.filter((c) => c.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return list;
  }, [search, activeCategory]);

  const grouped = useMemo(() => {
    if (search.trim() || activeCategory !== "All") return null;
    const map = new Map<ConnectorCategory, Connector[]>();
    for (const cat of CATEGORIES) {
      const items = CONNECTORS.filter((c) => c.category === cat);
      if (items.length) map.set(cat, items);
    }
    return map;
  }, [search, activeCategory]);

  const handleClose = () => {
    setSelected(null);
    setSearch("");
    setActiveCategory("All");
    setConnectorType("shared");
    onOpenChange(false);
  };

  const handleNext = () => {
    toast.info("Coming soon", {
      description: "API connection setup is handled inside your project workspace once you add the connector.",
    });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="bg-card border-border max-w-2xl w-full max-h-[88vh] overflow-hidden p-0 flex flex-col gap-0">
        {selected ? (
          /* ── Detail screen ── */
          <>
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <button
                onClick={() => setSelected(null)}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <ConnectorIcon connector={selected} size="sm" />
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold text-foreground">{selected.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground truncate">{selected.description}</DialogDescription>
              </div>
              <button
                onClick={handleClose}
                className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Connector type */}
              <div>
                <p className="text-xs font-semibold text-foreground/80 mb-3">Select which type of connector to add</p>
                <div className="space-y-2">
                  {(["shared", "user"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setConnectorType(type)}
                      className={`w-full flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                        connectorType === type
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-border/80 hover:bg-accent/50"
                      }`}
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        connectorType === type ? "border-primary" : "border-muted-foreground/50"
                      }`}>
                        {connectorType === type && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {type === "shared" ? "Shared connector" : "App user connector"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {type === "shared"
                            ? "Connect once as the builder. Every user of your app shares this connection."
                            : "Each user of your app connects their own account and only sees their own data."}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Capabilities */}
              <div>
                <p className="text-xs font-semibold text-foreground/80 mb-3">What you can do with {selected.name}</p>
                <ul className="space-y-2">
                  {selected.capabilities.map((cap, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                      <span>{cap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="border-t border-border px-5 py-4 flex items-center justify-between">
              <button
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div className="flex items-center gap-2.5">
                <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
                <Button size="sm" onClick={handleNext} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Next <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* ── List screen ── */
          <>
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center justify-between mb-1">
                <DialogTitle className="text-base font-semibold text-foreground">Connectors</DialogTitle>
                <button
                  onClick={handleClose}
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <DialogDescription className="text-xs text-muted-foreground mb-4">
                Connect tools and data sources to power your app.
              </DialogDescription>

              {/* Search + filter row */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setActiveCategory("All"); }}
                    placeholder="Search connectors..."
                    className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <select
                  value={activeCategory}
                  onChange={(e) => { setActiveCategory(e.target.value as ConnectorCategory | "All"); setSearch(""); }}
                  className="h-8 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                >
                  <option value="All">All categories</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No connectors match &ldquo;{search}&rdquo;</p>
                </div>
              ) : grouped ? (
                /* Grouped by category */
                <div className="space-y-6">
                  {CATEGORIES.map((cat) => {
                    const items = grouped.get(cat);
                    if (!items?.length) return null;
                    return (
                      <div key={cat}>
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{cat}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {items.map((c) => (
                            <ConnectorCard key={c.id} connector={c} onClick={() => setSelected(c)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Flat filtered list */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filtered.map((c) => (
                    <ConnectorCard key={c.id} connector={c} onClick={() => setSelected(c)} />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border px-5 py-3">
              <p className="text-[10px] text-muted-foreground text-center">
                We never use your data. We don&apos;t store or train on it.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── ConnectorCard ── */

function ConnectorCard({ connector, onClick }: { connector: Connector; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-border bg-background/50 hover:border-primary/40 hover:bg-accent/50 p-3.5 text-left transition-all group w-full"
    >
      <ConnectorIcon connector={connector} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{connector.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{connector.description}</p>
      </div>
    </button>
  );
}

"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { X, Search, ChevronLeft, Check, Eye, EyeOff, Unlink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ─────────────────── Types ─────────────────── */

type Category =
  | "Backend / Core"
  | "Commerce & Payments"
  | "AI & Automation"
  | "Data & Analytics"
  | "Communications"
  | "Business & CRM"
  | "Maps & Media";

interface CredField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
}

interface Connector {
  id: string;
  name: string;
  description: string;
  category: Category;
  color: string;
  initials: string;
  docsHint: string;
  fields: CredField[];
  capabilities: string[];
}

/* ─────────────────── Credential Storage ─────────────────── */

const LS_KEY = (id: string) => `bigbag:connector:${id}`;

function removeCreds(id: string) {
  localStorage.removeItem(LS_KEY(id));
}

function maskValue(val: string): string {
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

/* ─────────────────── Connector catalogue ─────────────────── */

const CONNECTORS: Connector[] = [
  {
    id: "supabase", name: "Supabase", description: "Postgres database, auth, storage in one platform",
    category: "Backend / Core", color: "#3ECF8E", initials: "SB",
    docsHint: "Find these in your Supabase project → Settings → API",
    fields: [
      { key: "projectUrl", label: "Project URL", placeholder: "https://xxxx.supabase.co" },
      { key: "anonKey", label: "Anon Key", placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", secret: true },
      { key: "serviceKey", label: "Service Role Key", placeholder: "eyJ...", secret: true, optional: true, hint: "Only for server-side admin operations" },
    ],
    capabilities: ["Connect Postgres DB to your app", "Auth (magic link, OAuth, email)", "File storage with signed URLs", "Real-time subscriptions"],
  },
  {
    id: "amazon-s3", name: "Amazon S3", description: "File/data storage for images and assets",
    category: "Backend / Core", color: "#FF9900", initials: "S3",
    docsHint: "Find these in AWS Console → IAM → Users → Security credentials",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIAIOSFODNN7EXAMPLE" },
      { key: "secretAccessKey", label: "Secret Access Key", placeholder: "wJalrXUtnFEMI...", secret: true },
      { key: "region", label: "Region", placeholder: "us-east-1" },
      { key: "bucket", label: "Bucket Name", placeholder: "my-app-assets" },
    ],
    capabilities: ["Upload and retrieve files", "Pre-signed download URLs", "List and delete objects", "Sync assets with your app"],
  },
  {
    id: "stripe", name: "Stripe", description: "Payments, billing, subscriptions",
    category: "Commerce & Payments", color: "#635BFF", initials: "ST",
    docsHint: "Find these in Stripe Dashboard → Developers → API keys",
    fields: [
      { key: "secretKey", label: "Secret Key", placeholder: "sk_live_...", secret: true, hint: "Use sk_test_ for testing" },
      { key: "webhookSecret", label: "Webhook Secret", placeholder: "whsec_...", secret: true, optional: true, hint: "From Stripe → Webhooks → your endpoint" },
      { key: "publishableKey", label: "Publishable Key", placeholder: "pk_live_...", hint: "Safe to expose in client code" },
    ],
    capabilities: ["Accept payments online", "Manage subscriptions and billing", "Issue refunds and handle disputes", "Receive webhook events"],
  },
  {
    id: "shopify", name: "Shopify", description: "Storefront, products, order data",
    category: "Commerce & Payments", color: "#96BF48", initials: "SH",
    docsHint: "Create a private app in Shopify Admin → Apps → Develop apps",
    fields: [
      { key: "storeDomain", label: "Store Domain", placeholder: "your-store.myshopify.com" },
      { key: "apiKey", label: "Admin API Access Token", placeholder: "shpat_...", secret: true },
    ],
    capabilities: ["Read and display products", "Create and manage orders", "Sync inventory levels", "Trigger fulfilment workflows"],
  },
  {
    id: "woocommerce", name: "WooCommerce", description: "Products, orders, coupons",
    category: "Commerce & Payments", color: "#7F54B3", initials: "WC",
    docsHint: "Create keys in WooCommerce → Settings → Advanced → REST API",
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://yourstore.com" },
      { key: "consumerKey", label: "Consumer Key", placeholder: "ck_..." },
      { key: "consumerSecret", label: "Consumer Secret", placeholder: "cs_...", secret: true },
    ],
    capabilities: ["Read and update products", "Fetch and process orders", "Create and redeem coupons", "Sync customer data"],
  },
  {
    id: "chargebee", name: "Chargebee", description: "Subscription/invoice billing",
    category: "Commerce & Payments", color: "#FF6844", initials: "CB",
    docsHint: "Find in Chargebee Dashboard → Settings → Configure Chargebee → API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
      { key: "site", label: "Site Name", placeholder: "your-site", hint: "The subdomain from your-site.chargebee.com" },
    ],
    capabilities: ["Create and manage subscriptions", "Generate and send invoices", "Handle plan changes", "Billing history in your app"],
  },
  {
    id: "xero", name: "Xero", description: "Accounting, invoices, financial reports",
    category: "Commerce & Payments", color: "#13B5EA", initials: "XR",
    docsHint: "Create an OAuth 2.0 app at developer.xero.com → My Apps",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "..." },
      { key: "clientSecret", label: "Client Secret", placeholder: "...", secret: true },
    ],
    capabilities: ["Create and send invoices", "Read balances and transactions", "Sync contacts and suppliers", "Pull P&L and balance sheets"],
  },
  {
    id: "wix", name: "Wix", description: "Sites, ecommerce, bookings, CMS",
    category: "Commerce & Payments", color: "#0C6EFC", initials: "WX",
    docsHint: "Find in Wix Dev Center → Manage API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
      { key: "siteId", label: "Site ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    ],
    capabilities: ["Read and update CMS collections", "Sync product catalogue", "Manage bookings and appointments", "Retrieve site analytics"],
  },
  {
    id: "polar", name: "Polar.sh", description: "Revenue dashboards on billing data",
    category: "Commerce & Payments", color: "#5B67F2", initials: "PL",
    docsHint: "Find in Polar dashboard → Settings → API Tokens",
    fields: [
      { key: "apiKey", label: "Access Token", placeholder: "polar_at_...", secret: true },
    ],
    capabilities: ["Pull MRR, ARR, and churn metrics", "Display subscriber counts", "Track product performance", "Webhook events on changes"],
  },
  {
    id: "perplexity", name: "Perplexity", description: "Real-time web search with cited sources",
    category: "AI & Automation", color: "#20B2AA", initials: "PX",
    docsHint: "Find in Perplexity settings → API → Generate",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "pplx-...", secret: true },
    ],
    capabilities: ["Real-time web searches from your app", "Answers with source citations", "Follow-up question conversations", "Domain-scoped searches"],
  },
  {
    id: "replicate", name: "Replicate", description: "Run AI models for images, video, audio, text",
    category: "AI & Automation", color: "#7C3AED", initials: "RP",
    docsHint: "Find at replicate.com → Account → API tokens",
    fields: [
      { key: "apiKey", label: "API Token", placeholder: "r8_...", secret: true },
    ],
    capabilities: ["Generate images with FLUX/SD", "Transcribe audio with Whisper", "Video generation models", "Any open-source model via API"],
  },
  {
    id: "elevenlabs", name: "ElevenLabs", description: "Human-sounding voice generation",
    category: "AI & Automation", color: "#333", initials: "EL",
    docsHint: "Find in ElevenLabs → Profile → API Key",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
    ],
    capabilities: ["Convert text to natural speech", "Clone voices from audio samples", "Stream audio in real time", "900+ voices and languages"],
  },
  {
    id: "firecrawl", name: "Firecrawl", description: "Scrape websites into clean structured data",
    category: "AI & Automation", color: "#FF4500", initials: "FC",
    docsHint: "Find at firecrawl.dev → Dashboard → API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "fc-...", secret: true },
    ],
    capabilities: ["Scrape any URL into clean Markdown", "Crawl entire sites", "Extract specific fields with AI", "Screenshots of any web page"],
  },
  {
    id: "gemini-enterprise", name: "Gemini Enterprise", description: "Query/summarize across Google data sources",
    category: "AI & Automation", color: "#4285F4", initials: "GE",
    docsHint: "Get a key at aistudio.google.com → Get API key",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "AIza...", secret: true },
    ],
    capabilities: ["Query Google Workspace documents", "Summarize long documents", "Generate structured data", "Search across Drive, Docs, Gmail"],
  },
  {
    id: "n8n", name: "n8n", description: "Automate across 400+ services",
    category: "AI & Automation", color: "#EA4B71", initials: "N8",
    docsHint: "Find in n8n → Settings → API → API keys",
    fields: [
      { key: "instanceUrl", label: "Instance URL", placeholder: "https://your-n8n.cloud" },
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
    ],
    capabilities: ["Trigger workflows via webhook", "Chain 400+ integrations", "Scheduled automations", "Return data from workflows"],
  },
  {
    id: "custom-mcp", name: "Custom (MCP)", description: "Connect any API or MCP server",
    category: "AI & Automation", color: "#6554E8", initials: "MC",
    docsHint: "Enter the URL and auth details for your custom MCP server",
    fields: [
      { key: "serverUrl", label: "MCP Server URL", placeholder: "https://your-mcp-server.com" },
      { key: "authToken", label: "Auth Token (optional)", placeholder: "Bearer ...", secret: true, optional: true },
    ],
    capabilities: ["Connect any REST API", "Define tools and schemas for AI", "Reuse across multiple projects", "Full control over auth and rate limiting"],
  },
  {
    id: "algolia", name: "Algolia", description: "AI search and discovery for your site",
    category: "Data & Analytics", color: "#003DFF", initials: "AL",
    docsHint: "Find in Algolia Dashboard → Settings → API Keys",
    fields: [
      { key: "appId", label: "Application ID", placeholder: "XXXXXXXXXX" },
      { key: "apiKey", label: "Admin API Key", placeholder: "...", secret: true },
      { key: "searchKey", label: "Search-Only API Key", placeholder: "...", hint: "Safe for client-side use" },
    ],
    capabilities: ["Instant full-text search", "Sync records to an index", "Search results with highlighting", "Personalise results per user"],
  },
  {
    id: "google-analytics", name: "Google Analytics", description: "Page views, events, conversions",
    category: "Data & Analytics", color: "#E37400", initials: "GA",
    docsHint: "Find Measurement ID in GA4 Admin → Data Streams → your stream",
    fields: [
      { key: "measurementId", label: "Measurement ID", placeholder: "G-XXXXXXXXXX" },
      { key: "apiSecret", label: "API Secret (for server-side events)", placeholder: "...", secret: true, optional: true },
    ],
    capabilities: ["Track page views and sessions", "Send custom events", "Measure goal conversions", "Pull report data into dashboards"],
  },
  {
    id: "amplitude", name: "Amplitude", description: "Real user behaviour analytics",
    category: "Data & Analytics", color: "#1A66FF", initials: "AM",
    docsHint: "Find in Amplitude → Settings → Projects → API keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
    ],
    capabilities: ["Track user events and sessions", "Build funnels and retention charts", "Segment users by behaviour", "Pull cohort data"],
  },
  {
    id: "posthog", name: "PostHog", description: "Analytics, feature flags, experiments",
    category: "Data & Analytics", color: "#F54E00", initials: "PH",
    docsHint: "Find in PostHog → Project Settings → Project API Key",
    fields: [
      { key: "apiKey", label: "Project API Key", placeholder: "phc_...", secret: true },
      { key: "host", label: "Host (optional)", placeholder: "https://app.posthog.com", optional: true },
    ],
    capabilities: ["Track events and sessions", "Feature flag rollouts", "A/B tests and experiments", "SQL event queries"],
  },
  {
    id: "google-search-console", name: "Google Search Console", description: "SEO/search performance data",
    category: "Data & Analytics", color: "#34A853", initials: "SC",
    docsHint: "Create a service account at console.cloud.google.com and share the property",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', secret: true, hint: "Paste the full JSON key file" },
      { key: "siteUrl", label: "Site URL", placeholder: "https://yoursite.com" },
    ],
    capabilities: ["Pull click/impression/position data", "Monitor crawl errors", "Track top queries", "SEO KPIs in your dashboard"],
  },
  {
    id: "resend", name: "Resend", description: "Transactional email at scale",
    category: "Communications", color: "#333", initials: "RS",
    docsHint: "Find at resend.com → API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "re_...", secret: true },
      { key: "fromDomain", label: "From Domain", placeholder: "mail.yourdomain.com" },
    ],
    capabilities: ["Send transactional emails via API", "React or HTML email templates", "Track open and click events", "Manage domains and DNS"],
  },
  {
    id: "twilio", name: "Twilio", description: "SMS, calls, two-way messaging",
    category: "Communications", color: "#F22F46", initials: "TW",
    docsHint: "Find in Twilio Console → Account Info",
    fields: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "authToken", label: "Auth Token", placeholder: "...", secret: true },
      { key: "fromNumber", label: "From Number", placeholder: "+1xxxxxxxxxx" },
    ],
    capabilities: ["Send SMS to any number", "Make and receive phone calls", "Two-way messaging flows", "WhatsApp messaging via API"],
  },
  {
    id: "slack", name: "Slack", description: "Notifications and team updates",
    category: "Communications", color: "#4A154B", initials: "SL",
    docsHint: "Create a Slack app at api.slack.com/apps → OAuth & Permissions",
    fields: [
      { key: "botToken", label: "Bot User OAuth Token", placeholder: "xoxb-...", secret: true },
      { key: "webhookUrl", label: "Incoming Webhook URL (optional)", placeholder: "https://hooks.slack.com/services/...", optional: true },
    ],
    capabilities: ["Post messages to channels", "Send direct messages", "Interactive Slack bots", "Listen to events via webhooks"],
  },
  {
    id: "firebase-fcm", name: "Firebase Cloud Messaging", description: "Push notifications",
    category: "Communications", color: "#FFCA28", initials: "FM",
    docsHint: "Find in Firebase Console → Project Settings → Service accounts → Generate key",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', secret: true, hint: "Paste the full JSON key file" },
      { key: "projectId", label: "Project ID", placeholder: "your-firebase-project-id" },
    ],
    capabilities: ["Push notifications to iOS and Android", "Target devices or topics", "Schedule campaigns", "Track delivery rates"],
  },
  {
    id: "mailgun", name: "Mailgun", description: "Transactional email + delivery tracking",
    category: "Communications", color: "#F06B26", initials: "MG",
    docsHint: "Find in Mailgun Dashboard → API Security → Private API Keys",
    fields: [
      { key: "apiKey", label: "Private API Key", placeholder: "key-...", secret: true },
      { key: "domain", label: "Sending Domain", placeholder: "mg.yourdomain.com" },
    ],
    capabilities: ["Send transactional and bulk emails", "Parse inbound emails", "Track opens, clicks, bounces", "Manage mailing lists"],
  },
  {
    id: "hubspot", name: "HubSpot", description: "CRM, marketing, sales workflows",
    category: "Business & CRM", color: "#FF7A59", initials: "HS",
    docsHint: "Create a private app in HubSpot → Settings → Integrations → Private Apps",
    fields: [
      { key: "apiKey", label: "Private App Access Token", placeholder: "pat-na1-...", secret: true },
    ],
    capabilities: ["Create and update contacts", "Log deals and pipeline stages", "Trigger marketing workflows", "Sync form submissions"],
  },
  {
    id: "salesforce", name: "Salesforce", description: "CRM data integration",
    category: "Business & CRM", color: "#00A1E0", initials: "SF",
    docsHint: "Create a Connected App in Salesforce Setup → Apps → App Manager",
    fields: [
      { key: "instanceUrl", label: "Instance URL", placeholder: "https://yourorg.my.salesforce.com" },
      { key: "accessToken", label: "Access Token", placeholder: "...", secret: true },
      { key: "clientId", label: "Consumer Key", placeholder: "..." },
      { key: "clientSecret", label: "Consumer Secret", placeholder: "...", secret: true },
    ],
    capabilities: ["Read and write Salesforce objects", "Sync leads and opportunities", "Run SOQL queries from your app", "Trigger Salesforce flows"],
  },
  {
    id: "google-maps", name: "Google Maps", description: "Address search, maps, routing",
    category: "Maps & Media", color: "#4285F4", initials: "GM",
    docsHint: "Create a key in Google Cloud Console → APIs & Services → Credentials",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "AIza...", secret: true, hint: "Enable Maps JS API, Places API, and Geocoding API" },
    ],
    capabilities: ["Embed interactive maps", "Autocomplete address inputs", "Calculate routes and distances", "Reverse-geocode coordinates"],
  },
  {
    id: "logo-dev", name: "Logo.dev", description: "Auto-display company logos by domain",
    category: "Maps & Media", color: "#18181B", initials: "LD",
    docsHint: "Get a key at logo.dev → Dashboard → API",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "pk_...", secret: true, optional: true, hint: "Optional — free tier works without a key" },
    ],
    capabilities: ["Fetch logos by domain name", "Display brand icons in tables", "High-res SVG/PNG logos for 100k+ companies", "No key needed for basic use"],
  },
];

const CATEGORIES = [
  "Backend / Core",
  "Commerce & Payments",
  "AI & Automation",
  "Data & Analytics",
  "Communications",
  "Business & CRM",
  "Maps & Media",
] as const;

/* ─────────────────── ConnectorIcon ─────────────────── */

function ConnectorIcon({ c, size = "md" }: { c: Connector; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "w-11 h-11 text-sm rounded-xl" : size === "sm" ? "w-8 h-8 text-[10px] rounded-lg" : "w-10 h-10 text-xs rounded-xl";
  const bg = ["#000000", "#18181B", "#333", "#1a1a1a"].includes(c.color) ? "#2a2a2a" : c.color;
  return (
    <div className={`${dim} flex items-center justify-center font-bold text-white shrink-0`} style={{ background: bg }}>
      {c.initials}
    </div>
  );
}

/* ─────────────────── ConnectorsModal ─────────────────── */

interface Props { open: boolean; onOpenChange: (o: boolean) => void; }

export function ConnectorsModal({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<"Enabled" | "All" | Category>("All");
  const [selected, setSelected] = useState<Connector | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  // Older builds stored connector secrets in browser storage and reported a
  // successful connection without contacting the provider. Purge that unsafe
  // legacy state as soon as this always-mounted landing-page component starts,
  // even when the modal is never opened.
  useEffect(() => {
    CONNECTORS.forEach((connector) => removeCreds(connector.id));
  }, []);

  const filtered = useMemo(() => {
    let list = CONNECTORS;
    if (activeCategory === "Enabled") list = list.filter((c) => connectedIds.has(c.id));
    else if (activeCategory !== "All") list = list.filter((c) => c.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return list;
  }, [search, activeCategory, connectedIds]);

  const grouped = useMemo(() => {
    if (search.trim() || activeCategory !== "All") return null;
    const map = new Map<string, Connector[]>();
    for (const cat of CATEGORIES) {
      const items = CONNECTORS.filter((c) => c.category === cat);
      if (items.length) map.set(cat, items);
    }
    return map;
  }, [search, activeCategory]);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSearch("");
    setActiveCategory("All");
    onOpenChange(false);
  }, [onOpenChange]);

  const handleConnected = useCallback((id: string) => {
    setConnectedIds((prev) => new Set([...prev, id]));
    setSelected(null);
  }, []);

  const handleDisconnected = useCallback((id: string) => {
    setConnectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setSelected(null);
  }, []);

  const enabledCount = connectedIds.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="bg-[#1a1a1a] border border-white/10 max-w-3xl w-full max-h-[88vh] overflow-hidden p-0 flex gap-0">
        {/* Left panel: categories */}
        <div className="w-52 shrink-0 flex flex-col border-r border-white/8 overflow-hidden">
          <div className="px-3 pt-4 pb-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveCategory("All"); }}
                placeholder="Search"
                className="w-full h-8 pl-8 pr-2.5 text-xs rounded-lg border border-white/10 bg-white/5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            <CategoryItem
              label="Enabled" count={enabledCount} active={activeCategory === "Enabled"}
              onClick={() => { setActiveCategory("Enabled"); setSearch(""); }}
            />
            <CategoryItem
              label="All" count={CONNECTORS.length} active={activeCategory === "All" && !search.trim()}
              onClick={() => { setActiveCategory("All"); setSearch(""); }}
            />
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 pt-4 pb-1.5">Categories</p>
            {CATEGORIES.map((cat) => (
              <CategoryItem
                key={cat}
                label={cat}
                count={CONNECTORS.filter((c) => c.category === cat).length}
                active={activeCategory === cat}
                onClick={() => { setActiveCategory(cat); setSearch(""); }}
              />
            ))}

            <div className="mt-4 pt-3 border-t border-white/8 space-y-2">
              <div className="px-2">
                <p className="text-xs text-muted-foreground mb-1.5">Missing a connector?</p>
                <button
                  disabled
                  title="Connector request intake is not implemented"
                  className="w-full cursor-not-allowed text-xs text-center border border-white/10 rounded-lg py-1.5 text-muted-foreground/60"
                >
                  Request unavailable
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {selected ? (
            <CredentialsPanel
              connector={selected}
              connected={connectedIds.has(selected.id)}
              onBack={() => setSelected(null)}
              onClose={handleClose}
              onConnected={handleConnected}
              onDisconnected={handleDisconnected}
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
                <div>
                  <DialogTitle className="text-sm font-semibold text-foreground">Connectors</DialogTitle>
                  <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                    Review planned integrations. Unimplemented connectors remain unavailable.
                  </DialogDescription>
                </div>
                <button onClick={handleClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {filtered.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{activeCategory === "Enabled" ? "No connectors connected yet." : `No connectors match "${search}"`}</p>
                  </div>
                ) : grouped ? (
                  <div className="space-y-6">
                    {CATEGORIES.map((cat) => {
                      const items = grouped.get(cat);
                      if (!items?.length) return null;
                      return (
                        <div key={cat}>
                          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2.5">{cat}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {items.map((c) => (
                              <ConnectorCard key={c.id} c={c} connected={connectedIds.has(c.id)} onClick={() => setSelected(c)} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filtered.map((c) => (
                      <ConnectorCard key={c.id} c={c} connected={connectedIds.has(c.id)} onClick={() => setSelected(c)} />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-white/8 px-5 py-2.5 shrink-0">
                <p className="text-[10px] text-muted-foreground text-center">Credentials are not collected until a server-side provider verification flow is implemented.</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── CategoryItem ─────────────────── */

function CategoryItem({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
        active ? "bg-white/8 text-foreground font-medium" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`ml-2 text-[10px] shrink-0 ${active ? "text-muted-foreground" : "text-muted-foreground/50"}`}>{count}</span>
    </button>
  );
}

/* ─────────────────── ConnectorCard ─────────────────── */

function ConnectorCard({ c, connected, onClick }: { c: Connector; connected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6 p-3.5 text-left transition-all group w-full relative"
    >
      <ConnectorIcon c={c} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{c.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{c.description}</p>
      </div>
      {connected && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Connected
        </div>
      )}
    </button>
  );
}

/* ─────────────────── CredentialsPanel ─────────────────── */

interface CredPanelProps {
  connector: Connector;
  connected: boolean;
  onBack: () => void;
  onClose: () => void;
  onConnected: (id: string) => void;
  onDisconnected: (id: string) => void;
}

function CredentialsPanel({ connector, connected, onBack, onClose, onConnected, onDisconnected }: CredPanelProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    for (const f of connector.fields) {
      if (!f.optional && !form[f.key]?.trim()) {
        errs[f.key] = `${f.label} is required`;
      }
    }
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    toast.error(`${connector.name} is not available`, {
      description: "A server-side connection and real provider verification flow has not been implemented.",
    });
  };

  const handleDisconnect = () => {
    removeCreds(connector.id);
    toast.success(`${connector.name} disconnected`);
    onDisconnected(connector.id);
  };

  const savedCreds: Record<string, string> | null = null;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4 shrink-0">
        <button onClick={onBack} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" aria-label="Back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <ConnectorIcon c={connector} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{connector.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{connector.description}</p>
        </div>
        {connected && (
          <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Connected
          </div>
        )}
        <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Docs hint */}
        <div className="text-[11px] text-muted-foreground bg-white/3 border border-white/8 rounded-lg px-3 py-2.5">
          <span className="font-semibold text-foreground/70">Where to find credentials:</span>{" "}
          {connector.docsHint}
        </div>

        <div role="status" className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
          Not implemented: BigBag cannot mark this connector connected until credentials are stored server-side and a real provider operation succeeds.
        </div>

        {/* Credential fields */}
        <div className="space-y-3">
          {connector.fields.map((f) => {
            const isSecret = f.secret;
            const shown = showFields[f.key];
            const savedVal = savedCreds?.[f.key];
            return (
              <div key={f.key}>
                <label className="block text-xs font-medium text-foreground/80 mb-1.5">
                  {f.label}
                  {f.optional && <span className="ml-1.5 text-[10px] text-muted-foreground/60 font-normal">(optional)</span>}
                </label>
                <div className="relative">
                  {isSecret ? (
                    <>
                      <input
                        type={shown ? "text" : "password"}
                        disabled
                        value={form[f.key] ?? ""}
                        onChange={(e) => { setForm((p) => ({ ...p, [f.key]: e.target.value })); setErrors((p) => { const n = { ...p }; delete n[f.key]; return n; }); }}
                        placeholder={savedVal ? maskValue(savedVal) : f.placeholder}
                        className={`w-full h-9 pl-3 pr-9 text-xs rounded-lg border bg-white/4 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring transition-colors ${errors[f.key] ? "border-red-500/60" : "border-white/10 focus:border-white/20"}`}
                      />
                      <button
                        type="button"
                        disabled
                        onClick={() => setShowFields((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <input
                      type="text"
                      disabled
                      value={form[f.key] ?? ""}
                      onChange={(e) => { setForm((p) => ({ ...p, [f.key]: e.target.value })); setErrors((p) => { const n = { ...p }; delete n[f.key]; return n; }); }}
                      placeholder={savedVal ?? f.placeholder}
                      className={`w-full h-9 px-3 text-xs rounded-lg border bg-white/4 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring transition-colors ${errors[f.key] ? "border-red-500/60" : "border-white/10 focus:border-white/20"}`}
                    />
                  )}
                </div>
                {errors[f.key] && <p className="text-[10px] text-red-400 mt-1">{errors[f.key]}</p>}
                {f.hint && !errors[f.key] && <p className="text-[10px] text-muted-foreground/60 mt-1">{f.hint}</p>}
              </div>
            );
          })}
        </div>

        {/* Capabilities */}
        <div>
          <p className="text-xs font-semibold text-foreground/70 mb-2.5">What you can do with {connector.name}</p>
          <ul className="space-y-1.5">
            {connector.capabilities.map((cap, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400 mt-0.5" />
                {cap}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/8 px-5 py-4 flex items-center justify-between shrink-0">
        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex items-center gap-2">
          {connected && (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/25 hover:border-red-500/50 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Unlink className="w-3 h-3" /> Disconnect
            </button>
          )}
          <Button size="sm" onClick={handleSave} disabled className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[100px]">
            Unavailable
          </Button>
        </div>
      </div>
    </>
  );
}

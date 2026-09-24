"use client";

import { useState, useMemo, useCallback } from "react";
import { X, Search, ChevronLeft, Check, Eye, EyeOff, Unlink, Plug } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ConnectorBrandIcon } from "./ConnectorBrandIcons";

/* ─────────────────── Types ─────────────────── */

export type Category =
  | "All"
  | "Enabled"
  | "Ecommerce"
  | "Marketing"
  | "Messaging"
  | "Productivity"
  | "Sales"
  | "Google"
  | "Microsoft"
  | "AI & Automation"
  | "Backend / Core";

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
  categories: Category[];
  color: string;
  docsHint: string;
  fields: CredField[];
  capabilities: string[];
}

/* ─────────────────── Credential Storage ─────────────────── */

const LS_KEY = (id: string) => `bigbag:connector:${id}`;
const CONNECTED_SET_KEY = "bigbag:connected_connectors";

function getStoredConnected(): Set<string> {
  if (typeof window === "undefined") {
    return new Set(["google-search-console", "firecrawl", "google-sheets", "google-maps", "resend"]);
  }
  try {
    const raw = localStorage.getItem(CONNECTED_SET_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // fallback
  }
  return new Set(["google-search-console", "firecrawl", "google-sheets", "google-maps", "resend"]);
}

function persistConnected(set: Set<string>) {
  try {
    localStorage.setItem(CONNECTED_SET_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

function removeCreds(id: string) {
  try {
    localStorage.removeItem(LS_KEY(id));
  } catch {
    // ignore
  }
}

function saveCreds(id: string, data: Record<string, string>) {
  try {
    localStorage.setItem(LS_KEY(id), JSON.stringify(data));
  } catch {
    // ignore
  }
}

function maskValue(val: string): string {
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

/* ─────────────────── Categories List ─────────────────── */

const CATEGORIES_NAV: Category[] = [
  "Ecommerce",
  "Marketing",
  "Messaging",
  "Productivity",
  "Sales",
  "Google",
  "Microsoft",
  "AI & Automation",
  "Backend / Core",
];

/* ─────────────────── Connector catalogue (ordered as in Image 3) ─────────────────── */

const CONNECTORS: Connector[] = [
  {
    id: "google-search-console",
    name: "Google Search Console",
    description: "Read Search Console analytics and manage sites",
    categories: ["Google", "Marketing"],
    color: "#34A853",
    docsHint: "Create a service account at console.cloud.google.com and share property access",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', secret: true, hint: "Paste full JSON key" },
      { key: "siteUrl", label: "Site URL", placeholder: "https://yoursite.com" },
    ],
    capabilities: ["Pull click/impression/position data", "Monitor crawl errors", "Track top search queries", "SEO KPIs in your dashboard"],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "AI-powered scraper, search and retrieval tool",
    categories: ["AI & Automation", "Productivity"],
    color: "#FF4500",
    docsHint: "Find at firecrawl.dev → Dashboard → API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "fc-...", secret: true },
    ],
    capabilities: ["Scrape any URL into clean Markdown", "Crawl entire websites", "Extract structured data with AI", "Full-page screenshots"],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and update spreadsheet data",
    categories: ["Google", "Productivity"],
    color: "#0F9D58",
    docsHint: "Enable Google Sheets API in Google Cloud Console or connect via OAuth",
    fields: [
      { key: "spreadsheetId", label: "Spreadsheet ID", placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" },
      { key: "apiKey", label: "API Key / Service Account", placeholder: "AIza...", secret: true },
    ],
    capabilities: ["Read rows and columns in real-time", "Append and update cells", "Sync tables with your UI", "Export records to spreadsheets"],
  },
  {
    id: "google-maps",
    name: "Google Maps Platform",
    description: "Maps, geocoding, directions, and places APIs",
    categories: ["Google", "Productivity"],
    color: "#4285F4",
    docsHint: "Create API key in Google Cloud Console → APIs & Services → Credentials",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "AIza...", secret: true, hint: "Enable Maps JS API, Places API, and Geocoding API" },
    ],
    capabilities: ["Embed interactive maps", "Autocomplete addresses in forms", "Calculate routes and distances", "Reverse geocode coordinates"],
  },
  {
    id: "resend",
    name: "Resend",
    description: "Email API for developers",
    categories: ["Messaging", "Marketing"],
    color: "#000000",
    docsHint: "Find at resend.com → API Keys",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "re_...", secret: true },
      { key: "fromDomain", label: "From Domain", placeholder: "mail.yourdomain.com" },
    ],
    capabilities: ["Send transactional emails", "React and HTML templates", "Track opens, clicks, and deliveries", "Manage DKIM and DNS records"],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, send, and manage your emails",
    categories: ["Google", "Messaging", "Productivity"],
    color: "#EA4335",
    docsHint: "Enable Gmail API in Google Cloud Console or configure OAuth 2.0",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "clientSecret", label: "Client Secret", placeholder: "...", secret: true },
    ],
    capabilities: ["Send emails directly from your app", "Read inbox and search threads", "Create email drafts", "Listen to incoming email webhooks"],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Upload and download files to and from Google Drive",
    categories: ["Google", "Productivity"],
    color: "#0066DA",
    docsHint: "Enable Drive API in Google Cloud Console → APIs & Services",
    fields: [
      { key: "apiKey", label: "API Key / Service Account", placeholder: "AIza...", secret: true },
      { key: "folderId", label: "Root Folder ID (optional)", placeholder: "1a2b3c...", optional: true },
    ],
    capabilities: ["Upload images, docs, and assets", "Generate public or restricted download URLs", "List and organize folders", "Search files by name and type"],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Create and manage Google Calendar events",
    categories: ["Google", "Productivity"],
    color: "#4285F4",
    docsHint: "Enable Calendar API in Google Cloud Console or connect OAuth",
    fields: [
      { key: "calendarId", label: "Calendar ID", placeholder: "primary" },
      { key: "apiKey", label: "API Key / Service Account", placeholder: "...", secret: true },
    ],
    capabilities: ["Schedule meetings and appointments", "Check real-time availability", "Send invites and calendar notifications", "Sync user agendas"],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Messaging platform with Bot API for automated interactions",
    categories: ["Messaging"],
    color: "#229ED9",
    docsHint: "Create a bot using @BotFather on Telegram to get your token",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ...", secret: true },
      { key: "chatId", label: "Default Chat / Channel ID", placeholder: "@yourchannel or -100xxxx", optional: true },
    ],
    capabilities: ["Send instant alerts and notifications", "Interactive Telegram bot commands", "Send rich media, keyboards, and buttons", "Receive webhook messages"],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "AI voice generation, text-to-speech, and speech-to-text",
    categories: ["AI & Automation"],
    color: "#000000",
    docsHint: "Find in ElevenLabs → Profile → API Key",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
    ],
    capabilities: ["Convert text to natural speech", "Clone custom voices from samples", "Low-latency streaming audio", "Support for 29+ languages"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Add Notion pages and databases to your app",
    categories: ["Productivity"],
    color: "#000000",
    docsHint: "Create an integration at notion.so/my-integrations and share your database",
    fields: [
      { key: "apiKey", label: "Internal Integration Secret", placeholder: "secret_...", secret: true },
      { key: "databaseId", label: "Database ID", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    ],
    capabilities: ["Query and filter database records", "Create and update Notion pages", "Sync CMS content with your app", "Add comments and blocks"],
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit Google Docs documents",
    categories: ["Google", "Productivity"],
    color: "#4285F4",
    docsHint: "Enable Google Docs API in Google Cloud Console",
    fields: [
      { key: "apiKey", label: "API Key / Service Account", placeholder: "AIza...", secret: true },
    ],
    capabilities: ["Generate formatted documents", "Extract plain text and headings", "Insert dynamic tables and charts", "Collaborative live doc links"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages and interact with Slack workspaces",
    categories: ["Messaging", "Productivity"],
    color: "#4A154B",
    docsHint: "Create a Slack app at api.slack.com/apps → OAuth & Permissions",
    fields: [
      { key: "botToken", label: "Bot User OAuth Token", placeholder: "xoxb-...", secret: true },
      { key: "webhookUrl", label: "Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/...", optional: true },
    ],
    capabilities: ["Post alerts to public/private channels", "Interactive Slack buttons and modals", "Direct messages to team members", "Handle slash commands"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "CRM platform for sales, marketing, and customer service",
    categories: ["Marketing", "Sales"],
    color: "#FF7A59",
    docsHint: "Create a private app in HubSpot → Settings → Integrations → Private Apps",
    fields: [
      { key: "apiKey", label: "Private App Access Token", placeholder: "pat-na1-...", secret: true },
    ],
    capabilities: ["Create and update CRM contacts", "Log deals and pipeline stages", "Trigger marketing workflows", "Sync form submissions"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "AI-powered search and answer engine",
    categories: ["AI & Automation"],
    color: "#20B2AA",
    docsHint: "Find in Perplexity settings → API → Generate",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "pplx-...", secret: true },
    ],
    capabilities: ["Real-time web searches with citations", "Direct synthesized answers", "Domain-scoped queries", "Structured fact extraction"],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Postgres database, auth, storage in one platform",
    categories: ["Backend / Core"],
    color: "#3ECF8E",
    docsHint: "Find in your Supabase project → Settings → API",
    fields: [
      { key: "projectUrl", label: "Project URL", placeholder: "https://xxxx.supabase.co" },
      { key: "anonKey", label: "Anon Key", placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", secret: true },
      { key: "serviceKey", label: "Service Role Key", placeholder: "eyJ...", secret: true, optional: true },
    ],
    capabilities: ["Full PostgreSQL database", "User Auth & session management", "File storage with signed URLs", "Real-time subscriptions"],
  },
  {
    id: "amazon-s3",
    name: "Amazon S3",
    description: "File/data storage for images and assets",
    categories: ["Backend / Core"],
    color: "#FF9900",
    docsHint: "Find in AWS Console → IAM → Users → Security credentials",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIAIOSFODNN7EXAMPLE" },
      { key: "secretAccessKey", label: "Secret Access Key", placeholder: "wJalrXUtnFEMI...", secret: true },
      { key: "region", label: "Region", placeholder: "us-east-1" },
      { key: "bucket", label: "Bucket Name", placeholder: "my-app-assets" },
    ],
    capabilities: ["Upload and retrieve files", "Pre-signed download URLs", "List and delete S3 objects", "Asset hosting at cloud scale"],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, billing, subscriptions",
    categories: ["Ecommerce", "Sales"],
    color: "#635BFF",
    docsHint: "Find in Stripe Dashboard → Developers → API keys",
    fields: [
      { key: "secretKey", label: "Secret Key", placeholder: "sk_live_...", secret: true },
      { key: "publishableKey", label: "Publishable Key", placeholder: "pk_live_...", hint: "Safe for client code" },
      { key: "webhookSecret", label: "Webhook Secret", placeholder: "whsec_...", secret: true, optional: true },
    ],
    capabilities: ["Accept credit cards and Apple Pay", "Recurring subscription billing", "Hosted customer portal", "Real-time webhook verification"],
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Storefront, products, order data",
    categories: ["Ecommerce"],
    color: "#96BF48",
    docsHint: "Create a private app in Shopify Admin → Apps → Develop apps",
    fields: [
      { key: "storeDomain", label: "Store Domain", placeholder: "your-store.myshopify.com" },
      { key: "apiKey", label: "Admin API Access Token", placeholder: "shpat_...", secret: true },
    ],
    capabilities: ["Fetch product catalog and variants", "Create and manage customer orders", "Sync inventory levels in real-time", "Trigger fulfillment updates"],
  },
  {
    id: "replicate",
    name: "Replicate",
    description: "Run AI models for images, video, audio, text",
    categories: ["AI & Automation"],
    color: "#7C3AED",
    docsHint: "Find at replicate.com → Account → API tokens",
    fields: [
      { key: "apiKey", label: "API Token", placeholder: "r8_...", secret: true },
    ],
    capabilities: ["Generate images with FLUX & SD", "Transcribe audio with Whisper", "Run open-source LLMs", "Video generation models"],
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Automate across 400+ services",
    categories: ["AI & Automation"],
    color: "#EA4B71",
    docsHint: "Find in n8n → Settings → API → API keys",
    fields: [
      { key: "instanceUrl", label: "Instance URL", placeholder: "https://your-n8n.cloud" },
      { key: "apiKey", label: "API Key", placeholder: "...", secret: true },
    ],
    capabilities: ["Trigger workflows via webhook", "Chain 400+ third-party APIs", "Scheduled background automation", "Two-way data sync"],
  },
  {
    id: "custom-mcp",
    name: "Custom (MCP)",
    description: "Connect any API or MCP server",
    categories: ["AI & Automation", "Backend / Core"],
    color: "#6554E8",
    docsHint: "Enter the URL and authentication for your MCP server",
    fields: [
      { key: "serverUrl", label: "MCP Server URL", placeholder: "https://your-mcp-server.com" },
      { key: "authToken", label: "Auth Token (optional)", placeholder: "Bearer ...", secret: true, optional: true },
    ],
    capabilities: ["Expose custom tools to AI", "Connect proprietary internal APIs", "Standard Model Context Protocol", "Secure authentication tokens"],
  },
  {
    id: "algolia",
    name: "Algolia",
    description: "AI search and discovery for your site",
    categories: ["Backend / Core"],
    color: "#003DFF",
    docsHint: "Find in Algolia Dashboard → Settings → API Keys",
    fields: [
      { key: "appId", label: "Application ID", placeholder: "XXXXXXXXXX" },
      { key: "apiKey", label: "Admin API Key", placeholder: "...", secret: true },
      { key: "searchKey", label: "Search-Only API Key", placeholder: "...", hint: "Safe for client use" },
    ],
    capabilities: ["Typo-tolerant instant search", "Real-time index updates", "Faceted search filters", "Personalized search ranking"],
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Page views, events, conversions",
    categories: ["Google", "Marketing"],
    color: "#E37400",
    docsHint: "Find Measurement ID in GA4 Admin → Data Streams → your stream",
    fields: [
      { key: "measurementId", label: "Measurement ID", placeholder: "G-XXXXXXXXXX" },
      { key: "apiSecret", label: "API Secret", placeholder: "...", secret: true, optional: true },
    ],
    capabilities: ["Track visitor traffic & sessions", "Custom event conversion tracking", "E-commerce revenue analytics", "Audience breakdown reporting"],
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Analytics, feature flags, experiments",
    categories: ["Marketing", "Backend / Core"],
    color: "#F54E00",
    docsHint: "Find in PostHog → Project Settings → Project API Key",
    fields: [
      { key: "apiKey", label: "Project API Key", placeholder: "phc_...", secret: true },
      { key: "host", label: "Host (optional)", placeholder: "https://app.posthog.com", optional: true },
    ],
    capabilities: ["Event analytics & session replays", "Feature flags and remote config", "A/B testing and experimentation", "Self-hosted or cloud"],
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "SMS, calls, two-way messaging",
    categories: ["Messaging"],
    color: "#F22F46",
    docsHint: "Find in Twilio Console → Account Info",
    fields: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "authToken", label: "Auth Token", placeholder: "...", secret: true },
      { key: "fromNumber", label: "From Number", placeholder: "+1xxxxxxxxxx" },
    ],
    capabilities: ["Send & receive SMS worldwide", "Automated phone voice calls", "WhatsApp business messaging", "Phone number verification"],
  },
  {
    id: "firebase-fcm",
    name: "Firebase Cloud Messaging",
    description: "Push notifications",
    categories: ["Messaging"],
    color: "#FFCA28",
    docsHint: "Find in Firebase Console → Project Settings → Service accounts",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', secret: true },
      { key: "projectId", label: "Project ID", placeholder: "your-firebase-project-id" },
    ],
    capabilities: ["Push alerts to iOS and Android", "Target specific topics or users", "Schedule automated campaigns", "Delivery & click analytics"],
  },
  {
    id: "mailgun",
    name: "Mailgun",
    description: "Transactional email + delivery tracking",
    categories: ["Messaging", "Marketing"],
    color: "#F06B26",
    docsHint: "Find in Mailgun Dashboard → API Security → Private API Keys",
    fields: [
      { key: "apiKey", label: "Private API Key", placeholder: "key-...", secret: true },
      { key: "domain", label: "Sending Domain", placeholder: "mg.yourdomain.com" },
    ],
    capabilities: ["High-deliverability transactional email", "Inbound email parsing webhooks", "Email validation API", "Real-time delivery logs"],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "CRM data integration",
    categories: ["Sales"],
    color: "#00A1E0",
    docsHint: "Create a Connected App in Salesforce Setup → Apps → App Manager",
    fields: [
      { key: "instanceUrl", label: "Instance URL", placeholder: "https://yourorg.my.salesforce.com" },
      { key: "accessToken", label: "Access Token", placeholder: "...", secret: true },
    ],
    capabilities: ["Sync leads, contacts, and accounts", "Track sales opportunities and deals", "Run SOQL queries from your app", "Trigger Salesforce Flows"],
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    description: "Office documents, Graph API, OneDrive",
    categories: ["Microsoft", "Productivity"],
    color: "#00A4EF",
    docsHint: "Register an app in Azure Portal → Microsoft Entra ID → App registrations",
    fields: [
      { key: "clientId", label: "Application (Client) ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "tenantId", label: "Directory (Tenant) ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "clientSecret", label: "Client Secret", placeholder: "...", secret: true },
    ],
    capabilities: ["Access Microsoft Graph API", "Sync with OneDrive and SharePoint", "Read and send Outlook emails", "Corporate single sign-on"],
  },
];

/* ─────────────────── ConnectorsModal Component ─────────────────── */

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function ConnectorsModal({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [selected, setSelected] = useState<Connector | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => getStoredConnected());

  const handleClose = useCallback(() => {
    setSelected(null);
    setSearch("");
    setActiveCategory("All");
    onOpenChange(false);
  }, [onOpenChange]);

  const handleConnected = useCallback((id: string) => {
    setConnectedIds((prev) => {
      const next = new Set([...prev, id]);
      persistConnected(next);
      return next;
    });
    setSelected(null);
  }, []);

  const handleDisconnected = useCallback((id: string) => {
    setConnectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      persistConnected(next);
      return next;
    });
    setSelected(null);
  }, []);

  const filtered = useMemo(() => {
    let list = CONNECTORS;
    if (activeCategory === "Enabled") {
      list = list.filter((c) => connectedIds.has(c.id));
    } else if (activeCategory !== "All") {
      list = list.filter((c) => c.categories.includes(activeCategory));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.categories.some((cat) => cat.toLowerCase().includes(q))
      );
    }
    return list;
  }, [search, activeCategory, connectedIds]);

  const enabledCount = connectedIds.size;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      {/*
        showCloseButton={false} disables the duplicate absolute close button
        rendered by DialogContent, leaving strictly ONE close button in the header.
      */}
      <DialogContent
        showCloseButton={false}
        className="bg-[#18181b] border border-white/10 max-w-4xl w-full h-[620px] max-h-[88vh] overflow-hidden p-0 flex rounded-2xl shadow-2xl"
      >
        {/* Left panel: Search & Categories */}
        <div className="w-56 shrink-0 flex flex-col border-r border-white/8 bg-[#141416]/60 overflow-hidden">
          {/* Search box */}
          <div className="px-3 pt-3.5 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (activeCategory !== "All") setActiveCategory("All");
                }}
                placeholder="Search"
                className="w-full h-8 pl-8 pr-2.5 text-xs rounded-lg border border-white/10 bg-[#222225] text-white placeholder:text-zinc-500 outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 transition-all"
              />
            </div>
          </div>

          {/* Categories Nav */}
          <div className="flex-1 overflow-y-auto px-2 pb-3 custom-scrollbar">
            <CategoryItem
              label="Enabled"
              count={enabledCount}
              active={activeCategory === "Enabled"}
              onClick={() => {
                setActiveCategory("Enabled");
                setSearch("");
              }}
            />
            <CategoryItem
              label="All"
              count={CONNECTORS.length}
              active={activeCategory === "All" && !search.trim()}
              onClick={() => {
                setActiveCategory("All");
                setSearch("");
              }}
            />

            <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-2.5 pt-3.5 pb-1">
              Categories
            </p>

            {CATEGORIES_NAV.map((cat) => {
              const count = CONNECTORS.filter((c) => c.categories.includes(cat)).length;
              return (
                <CategoryItem
                  key={cat}
                  label={cat}
                  count={count}
                  active={activeCategory === cat}
                  onClick={() => {
                    setActiveCategory(cat);
                    setSearch("");
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Right panel: Header & Cards Grid */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#18181b]">
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
              {/* Header with single close button */}
              <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/8 shrink-0">
                <div className="flex items-center gap-2.5">
                  <Plug className="w-4 h-4 text-zinc-400" />
                  <DialogTitle className="text-sm font-semibold text-white">
                    Connectors
                  </DialogTitle>
                </div>
                <button
                  onClick={handleClose}
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Cards Grid */}
              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                {filtered.length === 0 ? (
                  <div className="text-center py-20 text-zinc-500">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">
                      {activeCategory === "Enabled"
                        ? "No connectors connected yet."
                        : `No connectors match "${search}"`}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filtered.map((c) => (
                      <ConnectorCard
                        key={c.id}
                        c={c}
                        connected={connectedIds.has(c.id)}
                        onClick={() => setSelected(c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── CategoryItem ─────────────────── */

function CategoryItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
        active
          ? "bg-white/10 text-white font-medium"
          : "text-zinc-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`ml-2 text-[11px] shrink-0 ${active ? "text-zinc-300" : "text-zinc-500"}`}>
        {count}
      </span>
    </button>
  );
}

/* ─────────────────── ConnectorCard (matches 3rd Image) ─────────────────── */

function ConnectorCard({
  c,
  connected,
  onClick,
}: {
  c: Connector;
  connected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start p-3.5 rounded-xl bg-[#222225] border border-white/5 hover:border-white/15 hover:bg-[#28282c] transition-all text-left group w-full cursor-pointer relative"
    >
      {connected && (
        <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
          Enabled
        </span>
      )}
      <ConnectorBrandIcon id={c.id} size="lg" className="mb-2.5" />
      <p className="text-[13px] font-semibold text-white group-hover:text-primary transition-colors truncate w-full leading-tight">
        {c.name}
      </p>
      <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-snug">
        {c.description}
      </p>
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

function CredentialsPanel({
  connector,
  connected,
  onBack,
  onClose,
  onConnected,
  onDisconnected,
}: CredPanelProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    for (const f of connector.fields) {
      if (!f.optional && !form[f.key]?.trim() && !connected) {
        errs[f.key] = `${f.label} is required`;
      }
    }
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    saveCreds(connector.id, form);
    toast.success(`${connector.name} connected successfully`);
    onConnected(connector.id);
  };

  const handleDisconnect = () => {
    removeCreds(connector.id);
    toast.success(`${connector.name} disconnected`);
    onDisconnected(connector.id);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-6 py-3.5 shrink-0">
        <button
          onClick={onBack}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <ConnectorBrandIcon id={connector.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{connector.name}</p>
          <p className="text-xs text-zinc-400 truncate">{connector.description}</p>
        </div>
        {connected && (
          <span className="text-xs font-medium text-emerald-400 shrink-0 mr-2">
            Enabled
          </span>
        )}
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
        {/* Docs hint */}
        <div className="text-xs text-zinc-300 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <span className="font-semibold text-white">Where to find credentials:</span>{" "}
          {connector.docsHint}
        </div>

        {/* Credential fields */}
        <div className="space-y-3.5">
          {connector.fields.map((f) => {
            const isSecret = f.secret;
            const shown = showFields[f.key];
            return (
              <div key={f.key}>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  {f.label}
                  {f.optional && (
                    <span className="ml-1.5 text-[10px] text-zinc-500 font-normal">
                      (optional)
                    </span>
                  )}
                </label>
                <div className="relative">
                  {isSecret ? (
                    <>
                      <input
                        type={shown ? "text" : "password"}
                        value={form[f.key] ?? ""}
                        onChange={(e) => {
                          setForm((p) => ({ ...p, [f.key]: e.target.value }));
                          setErrors((p) => {
                            const n = { ...p };
                            delete n[f.key];
                            return n;
                          });
                        }}
                        placeholder={f.placeholder}
                        className={`w-full h-9 pl-3 pr-9 text-xs rounded-lg border bg-[#222225] text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-white/20 transition-colors ${
                          errors[f.key] ? "border-red-500/60" : "border-white/10 focus:border-white/20"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowFields((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
                      >
                        {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <input
                      type="text"
                      value={form[f.key] ?? ""}
                      onChange={(e) => {
                        setForm((p) => ({ ...p, [f.key]: e.target.value }));
                        setErrors((p) => {
                          const n = { ...p };
                          delete n[f.key];
                          return n;
                        });
                      }}
                      placeholder={f.placeholder}
                      className={`w-full h-9 px-3 text-xs rounded-lg border bg-[#222225] text-white placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-white/20 transition-colors ${
                        errors[f.key] ? "border-red-500/60" : "border-white/10 focus:border-white/20"
                      }`}
                    />
                  )}
                </div>
                {errors[f.key] && (
                  <p className="text-[11px] text-red-400 mt-1">{errors[f.key]}</p>
                )}
                {f.hint && !errors[f.key] && (
                  <p className="text-[11px] text-zinc-500 mt-1">{f.hint}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Capabilities */}
        <div>
          <p className="text-xs font-semibold text-zinc-300 mb-2.5">
            What you can do with {connector.name}
          </p>
          <ul className="space-y-1.5">
            {connector.capabilities.map((cap, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400 mt-0.5" />
                {cap}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/8 px-6 py-3.5 flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex items-center gap-2.5">
          {connected && (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/25 hover:border-red-500/50 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Unlink className="w-3 h-3" /> Disconnect
            </button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[100px] text-xs h-8 rounded-lg"
          >
            {connected ? "Save" : "Connect"}
          </Button>
        </div>
      </div>
    </>
  );
}

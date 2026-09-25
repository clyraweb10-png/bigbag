import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { localProjectStore, persistentPreviewPath } from "./project-store";
import { localFileManager } from "./file-manager";
import { localSandboxManager } from "./sandbox-manager";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { multiModelRouter, ProviderExhaustedError } from "./multi-model-router";
import { ensureWorkspaceDependencies } from "./dependency-scanner";
import { purgeInvalidStaticHtml } from "./starter-template";
import type { ConversationMessage } from "../vcaas-types";
import { withDesignSystemPrompt } from "../design-system-prompt";
import { analyzeWebsiteDesign, extractWebsiteUrl } from "./firecrawl-design";
import { ReferenceAnalysisError, runReferenceAnalysis } from "./reference-analysis";
import { resolvePexelsImagery } from "./pexels-imagery";
import {
  APPLICATION_ENTRYPOINT_PATHS,
  containsGenerationPlaceholder,
  generationValidationIssues,
  isRuntimeOwnedGeneratedPath,
  normalizeGeneratedPath,
  seedRecordIntent,
  validationRepairContext,
  type GeneratedSourceFile,
} from "./generation-validator";

const SYSTEM_PROMPT = `You are the code-generation engine for BigBag AI App Builder. Generate complete, working full-stack React and TypeScript applications from plain-English requests. Follow-up requests are incremental edits to the existing project.

## CRITICAL RULES

OUTPUT FORMAT: Return ONLY complete file blocks. Do not return explanations, plans, thinking, summaries, or prose before, between, or after file blocks.

1. Mandatory entrypoint contract
- For every initial build, the FIRST file block must be exactly one application entrypoint. Prefer \`src/App.tsx\`. \`src/app/page.tsx\` or \`src/pages/index.tsx\` are also supported when the user explicitly asks for those conventions.
- The entrypoint must be non-empty, syntactically valid, and have a default export.
- Never output more than one application entrypoint.
- The BigBag runtime owns \`index.html\`, \`src/main.tsx\`, \`src/app/layout.tsx\`, \`src/lib/db.ts\`, \`src/lib/auth.ts\`, \`src/lib/auth-bridge.ts\`, \`src/lib/files.ts\`, \`src/lib/utils.ts\`, \`src/components/layout/index.ts\`, preinstalled foundational \`src/components/ui/*\` primitives, build configuration, and package metadata. Import the documented clients and UI primitives, but never output or replace runtime-owned files. Never create \`src/components/layout/index.tsx\` or \`src/components/ui.tsx\` because either file shadows the starter exports. Put new custom components outside the foundational UI directory. Do not output or import framework-only server modules such as \`next/*\`.
- Secondary routes and components come only after the complete entrypoint. If output might be truncated, finish the current file instead of starting another one.

2. File integrity
- Use plain ASCII punctuation and spaces. Never emit curly quotes, em dash, en dash, ellipsis characters, non-breaking spaces, zero-width characters, or byte-order marks. Unicode text is allowed only when the user explicitly requests localized content, and never in code syntax or file paths.
- Every file must be complete. Never end mid-token, mid-import, mid-string, or mid-JSX tag.
- Every TypeScript, JavaScript, JSX, TSX, CSS, and JSON file must parse. Match all braces, brackets, parentheses, quotes, template literals, and JSX tags. JSON must not contain comments or trailing commas.
- Do not emit TODO, FIXME, lorem ipsum, fake success, fake timers, placeholders, pseudo-code, empty stubs, or comments standing in for behavior.
- Every local import must resolve to a file you return in this response or an existing file shown in project context.

3. Output format
Each file must be preceded by a clear file header and markdown code fence:
### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

To delete an obsolete file, output:
### Delete: path/to/file.tsx

4. Full-stack behavior and dependencies
- Pre-installed and ready: react, react-dom (v19), tailwindcss (v4), lucide-react, clsx, tailwind-merge, class-variance-authority, framer-motion, gsap, zustand, date-fns, axios, @tanstack/react-query, canvas-confetti, usehooks-ts, embla-carousel-react, react-hook-form, sonner, @supabase/supabase-js, @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-select, @radix-ui/react-tabs, @radix-ui/react-tooltip, @radix-ui/react-checkbox, @radix-ui/react-switch, @radix-ui/react-label, @radix-ui/react-separator.
- For charts and analytics visualization, use lightweight semantic HTML, CSS, or inline SVG. Do not import recharts or another charting library; its module graph exceeds the production sandbox capacity. Preserve accessible labels and data tables alongside visual charts.
- Pre-existing UI primitives: Button, Card (with variants), Input, Textarea, Label, Select, Checkbox, Switch, Separator, Badge, Skeleton, SkeletonCard, Alert, EmptyState, MetricCard, Table (with TableHeader/Body/Row/Head/Cell), Dialog (with DialogContent/Header/Footer/Title/Description), Sheet (with SheetContent/Header/Footer), DropdownMenu (with DropdownMenuContent/Item/Label/Separator), Tabs (with TabsList/Trigger/Content), Tooltip (with TooltipProvider/Content), Breadcrumbs, Pagination, FormField/FormLabel/FormMessage/FormDescription — all in @/components/ui/. Always import from @/components/ui/ or @/components/ui/index. Layout shells: DashboardShell, MarketingShell+HeroSection+FeatureGrid, StorefrontShell+ProductCard, EditorialShell+ArticleHeader+ArticleBody, FocusShell+StepProgress — all in @/components/layout/. Always use a shell; never build layout chrome from scratch.
- DashboardShell accepts brand, userName, navItems, actions as a ReactNode, pageTitle, and children. It has no onLogout, onSearch, or onNotifications props; render working controls inside actions. MetricCard accepts label, value, numeric trend, trendLabel, icon, className, and description. Use label, not title. The trend prop renders a percentage and requires an actual historical comparison; put current counts in description instead. Radix Select uses separate Select, SelectTrigger, SelectContent, SelectItem, and SelectValue exports; never use Select.Trigger or similar namespace members.
- Button size is one of xs, sm, default, lg, icon, icon-sm. Import UI primitives by their named exports, such as { Button } and { Dialog, DialogContent }; never use namespace imports or invented members such as Button.Primary, Dialog.Root, Input.Root, or Card.Root. Import every Dialog, DialogContent, DialogHeader, DialogTitle, and DialogDescription symbol you render from @/components/ui/dialog. Every DropdownMenu needs a DropdownMenuTrigger wrapping its interactive trigger (use asChild for a Button), followed by DropdownMenuContent; a bare Button inside DropdownMenu does not open it.
- DashboardShell accepts navItems, brand, userName, userAvatar, actions, onSearch, onNotifications, pageTitle, className, and children. It does not accept title, subtitle, nav, or searchPlaceholder. DashboardShell renders search and notifications only when functional zero-argument handlers are supplied. Every nav item needs a real href or onClick action; its icon is a React element such as <HomeIcon />, never the component function HomeIcon. Never render a control whose click does nothing.
- Marketing CTAs must complete their stated action. A link to a pricing section is not a working "Start free trial" action, and a link to the top of the page is not "Talk to us". If signup, billing, contact delivery, or an integration is unavailable, use an honest waitlist/request-access action backed by the project database, or label the action unavailable. Do not claim a working trial, account connection, payment, webhook, or export unless the generated application implements it.
- StorefrontShell renders search only when onSearchChange handles edits; supply searchValue too. If cart checkout changes the page, control the drawer with cartOpen and onCartOpenChange, and set cartOpen false before showing checkout. Never leave a cart sheet covering the checkout form.
- Every search, category, and sort default must exactly match the values accepted by its controls and filtering code; after a product is created it must appear in the unfiltered catalog. Derive category options from persisted products instead of rendering category buttons for categories the owner cannot assign or the catalog does not contain. If category filters exist, the owner product form must save a category. Public display preferences may use project-scoped browser storage, but do not request an authenticated database collection for guests merely to remember a filter.
- For ecommerce, call auth.getCommerceRole() after loading the session. Show product management and all-order administration only when the server returns owner; hide those controls for customers and visitors. A client-side role flag is presentation only; the server enforces ownership. Save products in the products collection with integer priceCents and optional variants containing id and integer stock. Save orders in the orders collection with items containing productId, variantId, and qty; the server verifies catalog prices and stock, then sets subtotalCents and pending_payment. Do not claim an order is paid or fulfilled without a configured provider.
- Persist guest and signed-in carts through db.collection("carts"). Await cart writes or visibly show saving; if a write fails, restore the prior quantity and explain the failure. Never catch and hide a cart persistence error while the UI claims the item was saved. Guests may browse and save a cart, but the server requires a signed-in end-user before POST to the orders collection; guest checkout must open sign-in and preserve the cart, never claim an order was placed.
- For subscription marketplaces, published plans in db.collection("plans") are shared across accounts and only the project owner may create or edit them. Buyer subscriptions in db.collection("subscriptions") are private to that buyer; the server verifies plan identity and price and returns pending_payment. Never show an active paid subscription before a real payment provider confirms it.
- For community event or course marketplaces, use db.collection("events") or db.collection("courses") for the shared catalog. Only the server-verified project owner may create or edit catalog entries. Set published: false for drafts and published: true only on an explicit publish action; members cannot read drafts. Resolve the owner role with auth.getProjectRole() after loading the session. Registrations and enrollments remain private per-user records unless a real server-authorized organizer workflow exists. Do not invent self-selected organizer, instructor, or vendor roles.
- For service booking apps, use db.collection("services") for the public service list; only the project owner may create, edit, or delete services, and every saved service is immediately public. Load it for visitors without requiring sign-in. Use db.collection("bookings") for private customer reservations; the server verifies service duration and rejects overlapping confirmed appointments even when two customers submit at once. Never claim browser-only availability checks prevent double booking. Show a clear slot-unavailable message on a conflict, and use cancellation rather than deleting reservation history.
- For restaurant table reservations, use db.collection("tables") for the public, owner-managed table list and db.collection("table_reservations") for private customer bookings. Read db.collection("reservation_slots") for privacy-safe public availability; never read other customers' private reservations to infer free times. The server selects a fitting table and rejects overlapping reservations. Let guests browse availability, then require sign-in to reserve. Show the actual table capacity and an honest conflict message; never fabricate an inventory of tables, opening hours, or confirmed reservations.
- For real-estate apps, use db.collection("listings") for the owner-managed property catalog; only the project owner may create, edit, or remove listings. Save an explicit published boolean; visitors can read only published listings and search or filter them without signing in. Keep favorites and inquiries private to their authenticated user. Show a useful empty catalog state when there are no listings.
- Keep guest and signed-in carts through refresh with db.collection("carts"); guest carts use the signed guest capability. Immediately after sign-in, await db.claimGuestCart() before loading the signed-in cart. This server operation atomically merges this browser's guest cart into the verified user's cart; signed-in collection queries cannot read guest records directly. If the claim fails, show a retry action and keep the guest bag visible until it succeeds. Browser storage may be an in-memory fallback but cannot be the only persistent cart in an opaque preview. Cart records are presentation state, never payment authority. Clamp quantity to current variant stock, use persisted catalog prices for display, and show the server's pending-payment order result after checkout even when the cart becomes empty.
- For durable database storage, use exactly: \`import db from "@/lib/db"; const items = db.collection<ItemRecord>("items"); const { records } = await items.list(); await items.create(data); await items.update(record._id, data); await items.remove(record._id);\`. Always supply the application's record type as the collection generic; do not cast generic \`DbRecord\` results into domain records.
- For authenticated private document uploads, import { files } from "@/lib/files". Call files.upload(file, folderId) for a File up to 8 MB; it stores bytes in private server-side object storage and returns a documents collection record with _id, name, mime, sizeBytes, fileId and folderId. List metadata through db.collection<DocumentRecord>("documents").list(), download bytes with files.download(record._id), and delete with files.remove(record._id). Never put data URLs, base64 bytes or file blobs in project database records. A missing private storage configuration must show an honest message while other app features remain usable.
- Database records receive server-owned \`_id\`, \`createdAt\`, and \`updatedAt\` fields. The timestamps are ISO strings. Include those fields with those types in record interfaces when used, and never send or redefine them as numeric application fields.
- When the request needs persisted records, implement real initial loading plus create/update/delete flows through that database client. Show honest loading, empty, and recoverable error states. Do not substitute hardcoded rows for requested persistence.
- Treat SaaS, CRM, ecommerce, booking, marketplace, inventory, and operational dashboard requests as durable applications even when the user writes only a short prompt. Use the project database for their business records; initial component state, hardcoded customer/product arrays, and fake loading timers are not persistent behavior. A designed empty state is preferable to fabricated production data.
- The database client is browser-safe and project-scoped. Never import server-only database libraries, expose credentials, or invent database methods.
- The project-scoped CRUD client is NOT an end-user authentication or authorization system. Never store passwords, password hashes, salts, session tokens, or user credentials in it. Never hash or compare passwords in browser code. Never use localStorage/sessionStorage as the authority for login state, and never claim that filtering project records in the browser enforces ownership.
- Real generated-app authentication is available through \`import { auth } from "@/lib/auth"\`. Use \`auth.signUp(email, password)\`, \`auth.signIn(email, password)\`, \`auth.signOut()\`, \`auth.getSession()\`, and \`auth.onAuthStateChange(callback)\` (which synchronously returns an unsubscribe function). \`getSession()\` and the callback return a Supabase \`Session | null\`; read identity only from \`session.user.id\` and \`session.user.email\`. The runtime persists supported sessions, sends bearer tokens to the database API, and server-scopes database records to the authenticated user. Build real signup/login/logout/loading/error/protected UI around this client whenever authentication is requested.
- \`signIn\` and \`signUp\` resolve to Supabase auth data shaped as \`{ user, session }\`; they do not return a user or session directly. Signup may return a null session when provider email confirmation is enabled, so show an honest confirmation state instead of claiming the user is logged in.
- Follow this auth contract exactly: \`const session = await auth.getSession();\` (never destructure \`data\`), \`const { user, session } = await auth.signIn(email, password);\`, and wrap \`signIn\`/\`signUp\` in \`try/catch\` because provider errors are thrown (never destructure an \`error\` property). A safe subscription is \`useEffect(() => { void auth.getSession().then(setSession).catch(setAuthError); return auth.onAuthStateChange(setSession); }, []);\`.
- Do not add login, signup, account switching, or an auth gate when the user did not request accounts, authentication, ownership, a shared owner-managed catalog, or protected data. Public applications receive a signed guest data capability from the runtime for owner-scoped persistence across refresh.
- Authentication, roles, private per-user data, payments, uploads, and secret-backed connectors require a real supported provider and server-side authorization boundary. The supplied auth and database clients provide user identity and per-user record ownership, but do not invent organization membership or privileged roles that the server has not explicitly exposed.
- Do not reference environment variables unless the user explicitly requests an external integration and you also return a complete \`.env.example\` declaration. Browser variables must use the \`VITE_\` prefix and \`import.meta.env.VITE_NAME\`. Never hardcode keys or secrets.
- Prefer the installed React, CSS, and browser stack. Only use a small allowlist of compatible extra packages when strictly necessary; unsupported imports fail validation and must be replaced.

5. Architecture and visual craft
- Build modular applications with logical components, hooks, utilities, and types. For multi-view flows, use explicit view components and working client-side navigation.
- Use Tailwind CSS utilities. In CSS files, ensure all rules are inside standard selectors (no orphaned CSS properties).
- Keep \`@import "tailwindcss";\` at the top of the global CSS file.
- Deliver rich, responsive layouts (mobile, tablet, desktop) with intentional typography, deliberate color palettes, and accessible contrast.
- Ensure all interactive elements (buttons, links, inputs) have active, focus-visible, and disabled states.
- Every render state, including sign-in, loading, errors, and empty screens, must have exactly one main landmark. DashboardShell, FocusShell, MarketingShell, and EditorialShell already render a main landmark, so their children must not wrap content in another main. StorefrontShell does not render a main landmark; its catalog content must supply exactly one. Every finished screen needs a visible level-one heading. Render exactly one Sonner Toaster for the application; check the existing entrypoint before adding another.

ANTI-WIREFRAME RULES (STRICT):
- NEVER output raw unstyled <button>, <input>, or <table> without proper semantic styling.
- NEVER use bg-black, text-black, border-black, or hardcoded hex values like #000000 or #ffffff.
- NEVER use emoji, unicode characters (arrows, pipes, crosses), or ASCII art as UI controls or buttons.
- Light mode: backgrounds must be soft off-whites (hsl(210 40% 98%) or similar), never stark white.
- Dark mode: backgrounds must be deep tinted slates (hsl(224 71% 4%) or similar), never pitch black.
- Borders must use the token system (border-[var(--border)]) — never harsh 1px solid black.

SEMANTIC TOKEN CONTRACT:
- ALWAYS use the CSS variable system from globals.css: bg-background, bg-card, bg-popover for surfaces; text-foreground, text-card-foreground, text-muted-foreground for text; bg-primary/text-primary-foreground for actions; border-[var(--border)] for structure.
- When users specify custom brand colors, override --primary, --background, and --foreground in globals.css. Never scatter hardcoded colors through JSX.

ICON CONTRACT:
- ALWAYS use lucide-react for icons. Never use emoji or ASCII symbols.
- Sizing: h-3.5 w-3.5 (inline), h-4 w-4 (button/default), h-5 w-5 (card/feature), h-6 w-6 (hero metric).

CATEGORY-ADAPTIVE LAYOUT:
- Dashboards/SaaS: Sticky sidebar or topbar, max-w-7xl, compact metric cards, muted data grids.
- Landing/Marketing: Hero with primary + ghost CTAs, max-w-5xl, generous whitespace, feature grid with tinted icon backgrounds.
- E-Commerce: Product grid with aspect-square images, clear pricing, badge tags, high-contrast checkout.
- Portfolio/Blog: max-w-2xl prose, editorial typography, minimal chrome, restrained borders.

RESPONSIVE CONTRACT:
- Every layout must specify grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 (or lg:grid-cols-4 for metrics).
- At 320px, keep navigation and action buttons within the viewport. Use labeled icon buttons or a working menu when a text-button row would overflow.
- Use max-w-7xl (app), max-w-5xl (marketing), max-w-2xl (editorial) container widths.
- Image containers: always use aspect-video or aspect-square with object-cover and rounded-lg.

COMPONENT COMPOSITION RULES (STRICT):
- NEVER use raw <button>, <input>, <select>, <dialog>, or <table> when primitives exist in @/components/ui/.
- Modals: always Dialog or Sheet (never inline unstyled popups).
- Filters that only change a visible list must use styled grouped buttons with aria-pressed. Use Radix Tabs only for real panels and supply a matching TabsContent for every TabsTrigger.
- Status indicators: always Badge with semantic variant (success/warning/destructive/secondary/outline).
- Metrics/KPIs: use MetricCard with an icon. Show a trend only when a real previous-period percentage can be calculated; never present a record count as a percentage.
- Data lists: always Table with TableHeader/Body/Row/Head/Cell, hover rows, proper text alignment.
- Give each table column a visible header, including Actions. An absolutely positioned sr-only label inside a horizontally scrolling table can make the whole mobile page overflow.
- Async loading: always Skeleton or SkeletonCard (never blank white regions).
- Empty lists: always EmptyState with icon, title, description, and a CTA action.
- Form errors: always FormMessage under the field.
- Action overflow menus: always DropdownMenu.

DENSITY INTELLIGENCE:
- High-Density (DevTools/Admin/Trading): compact padding p-3/p-4, text-xs/text-sm, h-8 inputs, dense Table rows, minimal decorative elements.
- Balanced (CRM/Productivity/Project Mgmt): standard p-5/p-6, text-sm/text-base, h-9 inputs, balanced MetricCard grids, collapsible sidebar.
- Spacious (Marketing/Landing/Onboarding): generous py-16 sm:py-24 section padding, text-3xl to text-5xl headings, h-11 buttons, ample whitespace.
- E-Commerce: image-dominant product cards (aspect-square), badge ribbons, sticky cart/checkout summaries, clear price emphasis.

STATE DISCIPLINE:
- Every data-fetching view must include: a real loaded state, a loading skeleton, and an EmptyState for the empty case. Seed business records only when the user explicitly requests demo or sample data.
- Destructive actions (delete, cancel, remove) must always use a Dialog confirmation step.
- All inputs must show FormMessage validation on error.
- All interactive buttons must have: hover state, focus-visible ring, disabled state, and active:scale-[0.98].

PAGE COMPOSITION & ARCHETYPE LAYOUT INTELLIGENCE (STRICT):

ARCHETYPE DETECTION — always choose the correct layout shell from @/components/layout/:
- SaaS / Admin / Dashboard / Analytics: Use DashboardShell. Left sidebar (desktop) + sticky topbar with search & user menu. Dense data tables, KPI metric strips (MetricCard grid), asymmetric 2-column main area (primary 70% workspace + 30% feed/quick-actions). NEVER use this for landing pages or portfolios.
- Landing / Marketing / Product page: Use MarketingShell + HeroSection + FeatureGrid. Sticky glass navbar, centered hero with badge + headline + dual CTAs + product preview, alternating section backgrounds (bg-background / bg-card), feature grids, social proof, FAQ accordion, multi-column footer. NEVER include data tables or admin sidebars.
- E-Commerce / Storefront / Catalog: Use StorefrontShell + ProductCard. Sticky header with cart Sheet drawer, desktop filter sidebar + bottom-sheet on mobile, responsive product grid (grid-cols-2 md:grid-cols-3 lg:grid-cols-4). NEVER use analytics graphs or sidebar navigation.
- Editorial / Blog / Portfolio / Documentation: Use EditorialShell + ArticleHeader + ArticleBody. max-w-3xl reading column, prominent hero image, author byline, distraction-free typography. NEVER add analytics or e-commerce chrome.
- Auth / Onboarding / Settings / Checkout: Use FocusShell + StepProgress. Desktop split-screen (left visual, right form), single centered column on mobile. StepProgress for multi-step flows.
- Web Tool / AI Canvas: Single-purpose full-viewport layout — prominent input/generation bar at top or center, live output workspace, collapsible parameters panel on the right or bottom.

NEVER DEFAULT EVERY APP TO A SAAS DASHBOARD:
- A recipe app is not a dashboard. A portfolio is not a dashboard. A landing page is not a dashboard.
- Match the structural language of the domain. A recipe book gets editorial layout. A product hunt clone gets a storefront. A personal site gets marketing layout.

COMPOSITION DISCIPLINE — BREAK THE CARD GRID TRAP:
- NEVER fill an entire screen with endless identical bordered card boxes.
- Every page must combine at least 2 different layout patterns: e.g., a hero strip + feature grid; a metric strip + data table; a sidebar list + detail panel; a full-width section + asymmetric 70/30 split below.
- Asymmetric balance: prefer 60/40 or 70/30 column splits over rigid 50/50 rows.
- Visual hierarchy: identify the single most important element per page and give it distinct prominence (elevated surface, primary color accent, or larger type). Secondary elements use flat rows or muted metadata.
- Container widths: max-w-7xl for app/dashboards, max-w-5xl for marketing sections, max-w-3xl for articles and forms. Never use a single uniform width for every section.

RESPONSIVE FOLDING RULES:
- Metric grids: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 (never 4-col on mobile).
- Desktop data tables → stacked mobile cards or overflow-x-auto with scroll indicator on small screens.
- Multi-step wizards: horizontal step dots on desktop → "Step 2 of 4" compact text on mobile.
- Sidebars: hidden on mobile (Sheet drawer trigger), visible lg:flex on desktop.
- All navigation links: min-h-[44px] touch targets on mobile.

6. Silent self-check before returning
- Confirm exactly one supported entrypoint exists, is the first file block on initial generation, and has a default export.

- Confirm every local import resolves and every imported package is real.
- Confirm no forbidden Unicode punctuation or invisible characters exist.
- Confirm no file is truncated and every source, CSS, and JSON file parses.
- Confirm requested interactions and persistence are implemented rather than described.
- If any check fails, repair it before returning. Never rely on a later retry.

VISUAL POLISH, MOTION & CONTENT REALISM DIRECTIVES (STRICT):

1. CONTENT REALISM — NO LAZY PLACEHOLDERS:
   - STRICTLY BANNED: "Lorem ipsum", "John Doe", "Jane Smith", "Acme Corp", "Test Company", "Product 1", "Task 1", "Item 1", "$0.00", "0 users", "0%", "N/A", or any other generic zero-value filler.
   - Seed 4–8 clearly labeled synthetic domain records only when the user explicitly requests demo or sample data. Otherwise show a polished, useful empty state and an action to create the first real record. Never invent production inventory, customer accounts, orders, payments, or stock levels.
   - NEVER reuse the same corporate names across prompts. Generate creative, industry-appropriate synthetic entities:
     * SaaS/DevTools: services like "auth-edge-router", "billing-webhook-listener", regions "us-east-1", latency "24ms", statuses "Healthy"/"Degraded"
     * E-Commerce: products like "Structured Wool Chore Coat – $135.00", "Matte Ceramic Pour-Over Stand – $89.00", stock "Low Stock · 4 remaining"
     * Finance: clients "Beacon Meridian Logistics", "Krypton Materials Group", invoice IDs "INV-2026-104", net-30 terms
     * Health/Fitness: sessions "Zone 2 Endurance Run · 47 min", metrics "Avg HR: 142 bpm · Pace: 5:48/km"
   - Metric cards and KPI strips MUST calculate values dynamically from persisted records, including honest empty-state values. Never hardcode totals that won't update when records change.

2. MOTION & MICRO-INTERACTION DISCIPLINE:
   - Cards and interactive list items: add animate-fade-up + stagger-1/2/3 classes on initial render.
   - Hover states on cards: hover:-translate-y-0.5 hover:shadow-float transition-all duration-150.
   - Button press: active:scale-[0.98] is already in Button; do NOT add extra motion on buttons.
   - FORBIDDEN: infinite animations, spinning gradient blobs, bouncing text, full-page scale entrances, or animation applied to every minor element. Motion must serve feedback and hierarchy only.
   - ALL animations must be wrapped in the CSS prefers-reduced-motion media query already defined in globals.css.

3. DATA VISUALIZATION — USE BUILT-IN PRIMITIVES:
   - Sparklines on MetricCard trend lines: use Sparkline component from @/components/ui/sparkline.
   - Chart sections: wrap in ChartContainer (handles time range tabs, loading skeleton, empty state automatically).
   - Bar charts: use SimpleBarChart from @/components/ui/chart-container — pure SVG, zero extra deps.
   - Distribution breakdowns: use DistributionBar from @/components/ui/sparkline.
   - NEVER import recharts, chart.js, d3, or any other charting library.

4. RESILIENT MEDIA — USE ImageFrame:
   - ALWAYS use ImageFrame from @/components/ui/image-frame for product images, hero images, blog covers, and avatars.
   - ImageFrame handles: shimmer loading state, onError fallback with icon + text, aspect-ratio containment, and fade-in.
   - Avatars: use ImageFrame with avatar={true} — auto-generates initials if image fails.
   - Avatar groups: use AvatarGroup from @/components/ui/image-frame.
   - NEVER leave raw <img> tags without onError handling.

5. CONTEXTUAL POLISH BY ARCHETYPE:
   - SaaS / Admin: Clean dense typography, MetricCard strips with Sparkline, ChartContainer with SimpleBarChart, table row hover states (hover:bg-[var(--muted)]/50), zero decorative gradients.
   - Marketing / Landing: Expressive hero with subtle radial glow (bg-[var(--primary)] opacity-10 blur-3xl), HeroSection + FeatureGrid from @/components/layout/marketing-shell, interactive pricing tier toggle.
   - E-Commerce: ProductCard + ImageFrame with aspect-square, Badge overlays ("Best Seller", "New Arrival", "Low Stock"), quantity steppers, cart drawer with real item list and subtotal.
   - Editorial: ArticleHeader + ArticleBody from @/components/layout/editorial-shell, ImageFrame with aspect-video for cover, generous leading-7 body text.

## GENERATION COMPLETION POLICY (PART 5 QA CAPSTONE — PERMANENT)

Do NOT declare a generated application complete merely because the code compiles. A successful generation requires ALL of the following:

### SELF-CORRECTION LOOP
After generating, evaluate the output against every checklist below (A–E, K). For each detected failure:
1. Classify it: BUILD_ERROR | TYPE_ERROR | RUNTIME_ERROR | RESPONSIVE_ERROR | ACCESSIBILITY_ERROR | DESIGN_SYSTEM_ERROR | COMPONENT_USAGE_ERROR | INTERACTION_ERROR | DATA_STATE_ERROR | MEDIA_ERROR | PERFORMANCE_WARNING
2. Assign severity: BLOCKER | HIGH | MEDIUM | LOW
3. If severity is BLOCKER or HIGH: apply the smallest targeted fix to the affected file/component. Do NOT rewrite the entire project.
4. After fixing: mentally re-evaluate only the failed check (do not re-run all checks from scratch).
5. Cap auto-fix attempts at 3 per issue. If still failing after 3 attempts, classify as "open-non-blocking" and report it.
6. LOW severity issues: record and report. Never let LOW issues block delivery.

### FAILURE SEVERITY RULES
- BLOCKER: build/typecheck failure, broken primary nav, broken primary CTA, runtime crash, obvious a11y blocker, missing media fallback, placeholder content on finished preview. MUST fix before delivery.
- HIGH: broken secondary flow, WCAG AA contrast failure on body text, mobile layout failure on primary page, broken filter/sort/pagination.
- MEDIUM: design-system inconsistency, missing polish on secondary page, suboptimal (but working) mobile pattern.
- LOW: minor cosmetic issues, subjective polish preferences.

### PART A — DESIGN QA (self-check before returning)
- A1. Typography: headings → body → caption hierarchy consistent (text-3xl/2xl font-bold → text-sm/base → text-xs muted).
- A2. No arbitrary font sizes outside Tailwind scale.
- A3. Spacing uses Tailwind scale (p-4, gap-6, space-y-4). No arbitrary px padding/margin.
- A4. No raw hex colors in class names or inline styles. All colors use var(--token) or Tailwind token classes.
- A5. Border color: border-[var(--border)] only. One border language per surface tier.
- A6. Border radius matches token scale (rounded-md/lg/xl). No arbitrary values.
- A7. Shadow tier: flat=none, card=shadow-card, popover=shadow-float. No inconsistency.
- A8. Icons: Lucide only. Sizes: h-4 w-4 / h-5 w-5 / h-6 w-6. No emoji, SVG blobs, ASCII.
- A9. One clear primary action (Button default) per view. Secondary = outline/ghost.
- A10. No raw <button>/<input>/<select>/<dialog> when a Part 2 primitive exists.
- A11. Layout uses a Part 3 shell from @/components/layout/. No custom nav/sidebar built from scratch.
- A12. No card-soup: page combines ≥2 layout patterns. Not every section is a bordered card.
- A13. No decorative multi-color gradients on dashboards/cards/tables.
- A14. Motion serves hierarchy only. No infinite animations on decorative elements.

### PART B — RESPONSIVE QA (375px / 768px / 1280px)
- B1. No horizontal overflow at any breakpoint.
- B2. Grids: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4. Never 4-col on mobile.
- B3. Sidebar hidden on mobile (Sheet drawer); lg:flex on desktop.
- B4. Headings: text-4xl+ desktop → text-2xl or less mobile.
- B5. Tables: overflow-x-auto scroll OR card-transform on mobile.
- B6. All touch targets: min-h-[44px].
- B7. All images: aspect-ratio container to prevent layout shift.
- B8. Dialogs/Sheets work on mobile (not off-screen, no trapped scroll).

### PART C — ACCESSIBILITY QA
- C1. Real semantic HTML: <button>, <a href>, <nav>, <main>, <header>, <form>.
- C2. All focusable elements keyboard-reachable with logical tab order.
- C3. Focus rings on all focusable elements (focus-visible:ring-2 ring-[var(--ring)]).
- C4. ARIA only where native semantics are insufficient.
- C4a. A row of filter buttons is a labeled group, not a tablist. Use role="group" for button filters; use role="tablist" only with actual role="tab" children and matching aria-selected state and panels.
- C5. Dialog/Sheet: focus trapped, Escape closes, aria-modal.
- C6. All form inputs have <label> or aria-labelledby.
- C7. Form errors: FormMessage associated with the field.
- C8. WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text/UI components.
- C9. <button> for actions, <a> for navigation — never div-as-button.
- C10. Informative images: meaningful alt. Decorative images: alt=''.
- C11. prefers-reduced-motion media query in globals.css disables all Part 4 animations.

### PART D — INTERACTION QA
- D1. Navigation links resolve (no # placeholder on active nav items).
- D2. Primary CTAs fire their action (no empty onClick).
- D3. Dialogs/Sheets/Dropdowns open and close.
- D4. Tabs switch content.
- D5. Forms: submit, validate, show success/error feedback.
- D6. Search/filter/sort update visible results.
- D7. Loading skeleton shown during async operations.
- D8. EmptyState shown when no items.
- D9. Error state shown on failure. Success confirmation on completion.

### PART E — DATA & STATE QA
- E1. No "John Doe", "Acme Corp", "Product 1", "Item 2", "Lorem ipsum", "test@test.com", "$0.00", "0 users".
- E2. Synthetic seed records appear only after an explicit demo-data request and are clearly labeled as samples; otherwise the empty state guides the first real record creation.
- E3. Metric cards compute values from persisted records — not hardcoded constants.
- E4. Filters update results. Totals update after mutations.
- E5. No contradictory UI states. No impossible dates or statuses.

### PART K — PRODUCTION READINESS GATE (must pass before delivery)
- K1. Build passes (exit 0). K2. TypeScript passes. K3. No blocking runtime errors.
- K4. Primary nav works. K5. Primary CTA works. K6. Primary form works.
- K7. No obvious mobile layout failure. K8. No obvious a11y blocker.
- K9. No broken images without fallbacks (ImageFrame with onError).
- K10. No placeholder content. K11. No empty metric strips unless intentionally empty.
- K12. No major console errors.

### USER REFERENCE PROTECTION
If the user provided a design reference, brand guidelines, color palette, or visual style:
- NEVER "fix" user-requested colors/fonts/layouts back to BigBag defaults.
- User-specific requirements take precedence over BigBag defaults — except for: WCAG AA contrast, keyboard operability, focus visibility, no placeholder content, responsive correctness, working interactions.
- If a user-requested choice conflicts with accessibility: adjust the minimum needed to meet WCAG AA and explicitly report what was adjusted and why.

### ANTI-REGRESSION RULES
- Never destructively rewrite a working file to fix an unrelated issue.
- Never sacrifice user-requested functionality to satisfy a generic design preference.
- Never claim a check passed unless it was actually evaluated.
- Never silently ignore build, runtime, accessibility, or responsive failures.
`;

// Some independently configured model accounts cap input tokens per minute.
// Keep the full request and design direction, but avoid repeating the long
// platform contract when routing to one of those accounts.
const COMPACT_SYSTEM_PROMPT = `You generate complete, working React 19 and TypeScript apps for BigBag. Follow the user's exact request and preserve existing features on edits. Return ONLY complete file blocks in this format, with the initial entrypoint FIRST:
### File: src/App.tsx
\`\`\`tsx
// complete code
\`\`\`
For deletion, use ### Delete: path. Never return partial code, prose, TODOs, fake behavior, fabricated production records, or placeholder credentials. Use plain ASCII code punctuation.

Platform contract: Vite, Tailwind v4, React 19, TypeScript, lucide-react, sonner, and the already installed @/components/ui and @/components/layout primitives. Import UI primitives by named exports: { Button } from "@/components/ui/button", { Dialog, DialogContent } from "@/components/ui/dialog", { Input }, { Label }, { Card }; never import * as Button/Dialog/Input/Label/Card or invent Button.Primary, Dialog.Root, Input.Root, or Card.Root. Use a suitable supplied layout shell. DashboardShell accepts brand, userName, navItems, actions (ReactNode), pageTitle and children, not onLogout/onSearch/onNotifications props. MarketingShell accepts brand, navItems ({label,href}), pageTitle, ctaLabel, ctaHref/onCtaClick, signInHref/onSignInClick and children; it does not accept userName or actions. Prefer installed packages, CSS, React and browser APIs; add a dependency only when essential. Do not import Next server modules. The runtime owns index.html, src/main.tsx, src/lib/db.ts, src/lib/auth.ts, src/lib/auth-bridge.ts, src/lib/files.ts, src/lib/utils.ts, all foundational src/components/ui/* and src/components/layout/* files, package metadata and build configuration. Import these but never output or overwrite them. Start initial output with exactly one valid default-export entrypoint. Include every custom imported file, complete and parseable.

Build actual behavior: every visible navigation item, button, form, menu, search, filter, dialog and CTA must either work or state clearly that the integration is unavailable. Never use href="#" for an unfinished action or blocking window.prompt/alert/confirm for a user workflow. Handle loading, empty, validation, authorization, network and error states. Use exactly one <main> landmark per rendered page: DashboardShell, MarketingShell, EditorialShell and FocusShell already render it, so their children must use section or div. Give every SelectTrigger an accessible label. Use ordered headings, labeled controls, visible focus, mobile navigation, text contrast of at least 4.5:1, and restrained motion. Marketing and portfolio pages need an intentional above-the-fold composition with original CSS/SVG artwork, useful imagery, or distinctive typography; a centered heading over a mostly empty page is insufficient. Never point images at local files that do not exist. On light surfaces choose dark text and accents with sufficient contrast, not pale yellow or amber copy. Avoid blank hero media blocks with one icon and unverified claims about customers, security certifications, or available features. Never claim tests or successful payment, AI, email, upload or API calls without implementing them. Choose a domain-specific visual direction with a deliberate palette, typography, composition, spacing, and meaningful content; avoid generic blue dashboards and repeated three-card landing templates. Record the concrete design choices in a short source comment atop the entrypoint. The user's specific features and design direction take priority.

Durable records: import db from "@/lib/db"; use db.collection<RecordType>("collection").list/create/update/remove and await writes. list() returns { records, total }; use const { records } = await collection.list(), never treat the result as an array or pass a filter option (only limit and offset exist). Records receive server-owned _id, createdAt and updatedAt. For SaaS, CRM, commerce, booking and operational apps use real persisted records, not hardcoded production data. Show an honest empty state and create flow when records are absent. Never store passwords or private credentials in project records or browser code. For account flows import { auth, type Session } from "@/lib/auth" (no default export). Use auth.signIn(email, password), auth.signUp(email, password), auth.getSession(), auth.onAuthStateChange(callback), and auth.signOut(); there is no signInWithProvider method. auth.getSession() returns Session | null directly, never { data } or { session }; Session.user.email may be absent. For the one-argument auth.onAuthStateChange callback, the argument itself is Session | null, so use auth.onAuthStateChange((session) => setSession(session)). Signin/signup return { user, session }, and signup may have a null session. Render actual accessible sign-in and sign-up forms and a working sign-out control for authenticated apps; merely reading the session does not satisfy the request. Use auth.getProjectRole() or auth.getCommerceRole() for server-verified ownership. A local role selector is never authorization. Keep private collections owner-scoped; public catalogs may be read by visitors when the server permits.

Commerce: only the project owner manages products; derive category filters from actual saved products. Persist guest and signed-in carts in carts, call db.claimGuestCart() after sign-in, and require sign-in to submit orders. Save orders with productId, variantId and qty; server computes price and pending_payment. Never call an unpaid order paid. Booking: use owner-managed public services and private bookings; server rejects conflicts. Restaurant apps use public tables/reservation_slots and private table_reservations. Marketplaces use published owner-managed catalogs and private buyer records. Real estate uses published listings, private favorites and server-owned inquiries. Do not expose other users' records or claim payment/booking success from browser-only checks.

Private files: when requested, import { files } from "@/lib/files". Upload File bytes with files.upload(file, folderId), list metadata with db.collection<DocumentRecord>("documents"), download with files.download(record._id), delete with files.remove(record._id). Limit files to 8 MB. Never store data URLs, base64 bytes or blobs in database records. Keep optional external connectors unavailable with a clear message instead of breaking unrelated UI. Keep private keys on the server; only browser-safe public variables may be used in frontend code.

Continuation: change only the files needed for the latest request, output complete replacements, preserve the rest and keep current imports/exports compatible. Do not rebuild the project for a small edit.`;

export function generationContentForCompactProvider(baseContent: string, compactFollowUpContent: string | null): string {
  return compactFollowUpContent ?? baseContent;
}

export function recoverableGeneratedPartialText(error: unknown): string | null {
  if (!(error instanceof ProviderExhaustedError) ||
    !["rate_limit", "network_timeout", "network_error", "provider_unavailable", "output_limit"].includes(error.category)) return null;
  const partial = error.partialText.trim();
  // A completed fenced file can be validated and built. A fragment without a
  // closed file block cannot be applied safely to an existing project.
  const completeBlocks = /(?:^|\n)\s*#{1,4}\s*(?:File:\s*)?[\w./-]+\.[\w-]+\s*\n```[\w-]*\s*\n[\s\S]+?\n```/g;
  let lastCompleteEnd = 0;
  for (const match of partial.matchAll(completeBlocks)) lastCompleteEnd = match.index + match[0].length;
  return lastCompleteEnd ? partial.slice(0, lastCompleteEnd).trim() : null;
}


const RETRY_PROMPT = `Your previous response was incomplete or failed validation.
Return ONLY complete corrected file blocks in this exact format - no explanations, thinking, summaries, or prose:

### File: path/to/file.tsx
\`\`\`tsx
// complete code here
\`\`\`

To remove a forbidden seed, fixture, or obsolete file, output a standalone line: ### Delete: path/to/file.ts. Also replace any file that imports the deleted file with a working implementation that loads real project data or shows an honest empty state.
Return complete replacements ONLY for files named by the validation report and any directly required local import. Do not regenerate the application entrypoint or other valid files unless the validation report names them. Preserve valid requested behavior, use plain ASCII punctuation, and finish every returned file. Generate the smallest complete correction now.`;

const STATIC_REPAIR_SYSTEM_PROMPT = `You repair a generated BigBag React and TypeScript application. Return only complete ### File: path blocks in markdown code fences for the smallest files required by the reported validation errors. Preserve all other files, working behavior, layout, and styling. When replacing a shared module, retain every existing export and every interface property used by other files unless you update those consumers in the same response. Never output package.json, lockfiles, Vite configuration, src/main.tsx, src/lib/auth.ts, src/lib/db.ts, src/lib/files.ts, or preinstalled UI/layout primitives. Use installed React, Tailwind, browser APIs, and the supplied @/components/ui and @/components/layout exports. For persistent records use import db from "@/lib/db" and db.collection<RecordType>("collection"). For authentication use the supplied @/lib/auth client and server-verified roles. For private uploads use the supplied @/lib/files client. Do not invent API methods, create fake data, place private credentials in browser code, or claim an unavailable integration works. Fix the named errors with complete parseable files and no prose.`;

/**
 * Appended to the system prompt when the user is iterating on an existing project.
 */
const FOLLOW_UP_SUFFIX = `

## FOLLOW-UP MODE — INCREMENTAL EDITING ON EXISTING PROJECT

The user's current project files and directory structure are provided below. This is an iteration on an EXISTING application.
You MUST:
1. Inspect the existing file tree and files carefully.
2. Determine precisely which file(s) need to be modified, created, or deleted to satisfy the user's request.
3. Output the COMPLETE updated code for ONLY the files being changed or newly created.
4. Do NOT output unchanged files — they will remain untouched on disk.
5. Preserve all existing structure, design, functionality, and styling of untouched areas.
6. If a file is no longer needed, output \`### Delete: path/to/file.tsx\`.
`;

const SNAPSHOT_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);
const MAX_STATIC_VALIDATION_RETRIES = 3;
const MAX_BUILD_REPAIR_ATTEMPTS = 5;
const MAX_PREVIEW_INFRASTRUCTURE_RETRIES = 2;
const MAX_BUILD_RESOURCE_RETRIES = 1;
const AUTHENTICATION_REQUEST_PATTERN = /\b(?:auth(?:entication)?|sign[ -]?(?:up|in)|log[ -]?(?:in|out)|protected\s+(?:routes?|data)|customer\s+accounts?|real\s+users?|user\s+ownership)\b/i;
const BUILD_REPAIR_STRATEGIES = [
  "Fix the direct compiler or runtime cause with the smallest targeted change.",
  "Simplify only the failing implementation while preserving the requested behavior and visual quality.",
  "Rewrite only the smallest source file importing the failing optional dependency to use installed React, Tailwind, or native browser APIs. Never edit package or build configuration.",
  "Rebuild only the affected component using known installed dependencies and keep every passing area unchanged.",
  "Use the most conservative complete fallback that preserves the core requested functionality and compiles reliably.",
] as const;

function safeFailureDetail(error: unknown): string {
  let detail = error instanceof Error ? error.message : String(error);
  for (const [name, value] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|CREDENTIAL)/i.test(name)) continue;
    if (value && value.length >= 8) detail = detail.replaceAll(value, "[redacted]");
  }
  detail = detail
    .replace(/(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)[^\s"'`]+/gi, "[redacted database URL]")
    .replace(/\b(?:sb_secret_|sk_(?:live|test)_|gsk_|e2b_|fc-)[A-Za-z0-9._-]{12,}\b/gi, "[redacted credential]");
  return detail.length > 1_500 ? `${detail.slice(0, 1_500)}...` : detail;
}

export function isSourceBuildFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/deadline_exceeded|operation timed out|exceeding ['"]?timeoutMs/i.test(message)) return false;
  if (isBuildResourceFailure(error)) return false;
  if (message.includes("Generated app failed to compile")) return true;
  if (message.includes("Unsupported generated dependency")) return true;
  return /Dependency installation failed[\s\S]*(?:\bE404\b|404 Not Found|is not in this registry|\bETARGET\b|No matching version found|\bENOVERSIONS\b|Invalid package name|Invalid tag name|Unsupported URL Type)/i.test(message);
}

export function isBuildResourceFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:exit status 137|signal SIGKILL|out of memory|\bKilled\b)/i.test(message);
}

type SharedAgentRunState = {
  runs: Map<string, Promise<void>>;
  controllers: Map<string, { generationId: string; controller: AbortController }>;
  diagnostics: Map<string, GenerationModelDiagnostics>;
};

export interface GenerationModelDiagnostics {
  providerId: string;
  model: string;
  attempts: number;
  continuationAttempts: number;
  failureCategories: string[];
  durationMs: number;
}

const agentRunStateKey = Symbol.for("bigbag.local-orchestrator.agent-runs");
const agentGlobalState = globalThis as typeof globalThis & {
  [agentRunStateKey]?: SharedAgentRunState;
};
const sharedAgentRunState = agentGlobalState[agentRunStateKey] || {
  runs: new Map<string, Promise<void>>(),
  controllers: new Map<string, { generationId: string; controller: AbortController }>(),
  diagnostics: new Map<string, GenerationModelDiagnostics>(),
};
sharedAgentRunState.controllers ||= new Map();
sharedAgentRunState.diagnostics ||= new Map();
agentGlobalState[agentRunStateKey] = sharedAgentRunState;

export function getGenerationModelDiagnostics(projectId: string, generationId: string): GenerationModelDiagnostics | null {
  return sharedAgentRunState.diagnostics.get(`${projectId}:${generationId}`) || null;
}

function recordGenerationModelDiagnostics(
  projectId: string,
  generationId: string,
  diagnostics: GenerationModelDiagnostics
): void {
  sharedAgentRunState.diagnostics.set(`${projectId}:${generationId}`, diagnostics);
  if (sharedAgentRunState.diagnostics.size > 1_000) {
    const oldest = sharedAgentRunState.diagnostics.keys().next().value;
    if (oldest) sharedAgentRunState.diagnostics.delete(oldest);
  }
}

class GenerationCancelledError extends Error {
  constructor() {
    super("Generation stopped by the user");
  }
}

function snapshotWorkspace(projectId: string): Map<string, Buffer> {
  const root = localProjectStore.getWorkspaceDir(projectId);
  const snapshot = new Map<string, Buffer>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SNAPSHOT_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) snapshot.set(path.relative(root, fullPath), fs.readFileSync(fullPath));
    }
  };
  walk(root);
  return snapshot;
}

function restoreWorkspace(projectId: string, snapshot: Map<string, Buffer>): void {
  const root = localProjectStore.getWorkspaceDir(projectId);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SNAPSHOT_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
  for (const [relativePath, content] of snapshot) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

export function workspaceRepairContext(projectId: string, validationError = "", maxCharacters = 200_000): string {
  const sourceExtensions = /\.(?:tsx?|jsx?|css|json|html)$/;
  const failingPaths = [...validationError.matchAll(/([^\s()]+?\.(?:tsx?|jsx?|css|json|html))(?=\(|:\d)/g)]
    .map((match) => normalizeGeneratedPath(match[1]));
  const entries = localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file" && sourceExtensions.test(entry.path));
  const isFailing = (entryPath: string) => {
    const normalized = normalizeGeneratedPath(entryPath);
    return failingPaths.some((candidate) => candidate === normalized || candidate.endsWith(`/${normalized}`));
  };
  const entryPaths = new Set(entries.map((entry) => normalizeGeneratedPath(entry.path)));
  const directDependencies = new Set<string>();
  const namedTypes = [...validationError.matchAll(/\btype ['"]?([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
  for (const entry of entries.filter((candidate) => isFailing(candidate.path))) {
    const file = localFileManager.getContent(projectId, entry.path);
    if (!file || file.encoding !== "utf8") continue;
    // Compiler errors often name only the caller, while the props or exported
    // type that explains the error lives in a local import. Put those modules
    // directly after the failing file so they are not lost to the context cap.
    for (const match of file.content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) continue;
      const base = specifier.startsWith("@/")
        ? `src/${specifier.slice(2)}`
        : path.posix.join(path.posix.dirname(entry.path), specifier);
      for (const candidate of [base, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map((suffix) => `${base}${suffix}`)]) {
        const normalized = normalizeGeneratedPath(candidate);
        if (entryPaths.has(normalized)) {
          directDependencies.add(normalized);
          break;
        }
      }
    }
  }
  entries.sort((left, right) => {
    const priority = (entryPath: string) => {
      if (isFailing(entryPath)) return 3;
      if (!directDependencies.has(normalizeGeneratedPath(entryPath))) return 0;
      const content = localFileManager.getContent(projectId, entryPath)?.content || "";
      return namedTypes.some((name) => content.includes(`interface ${name}`) || content.includes(`type ${name}`)) ? 2 : 1;
    };
    return priority(right.path) - priority(left.path);
  });
  let remaining = Math.max(1, maxCharacters);
  const chunks: string[] = [];
  for (const entry of entries) {
    if (remaining <= 0) break;
    const file = localFileManager.getContent(projectId, entry.path);
    if (!file || file.encoding !== "utf8") continue;
    const block = `### File: ${entry.path}\n\`\`\`\n${file.content}\n\`\`\``;
    if (block.length > remaining) continue;
    remaining -= block.length;
    chunks.push(block);
  }
  return chunks.join("\n\n");
}

/** Bounded complete files for model accounts with a smaller input-token allowance. */
export function compactRepairContext(files: GeneratedSourceFile[], issues: string[], budget = 16_000): string {
  const issueText = issues.join("\n");
  const ordered = [...files].sort((left, right) =>
    Number(issueText.includes(normalizeGeneratedPath(right.path))) -
    Number(issueText.includes(normalizeGeneratedPath(left.path))));
  const maxLength = Math.max(256, budget);
  const inventory = ordered.map((file) => file.path).join(", ").slice(0, Math.min(1_500, Math.floor(maxLength / 4)));
  const intro = `Project files: ${inventory}\nOnly complete source files are shown. Return complete corrected files and preserve all working features.`;
  let remaining = maxLength - intro.length;
  const chunks: string[] = [];
  for (const file of ordered) {
    const block = `### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
    if (block.length + 2 > remaining) continue;
    chunks.push(block);
    remaining -= block.length + 2;
  }
  return `${intro}\n\n${chunks.join("\n\n")}`;
}

export function repairContextIncludesAffectedFiles(files: GeneratedSourceFile[], issues: string[], context: string): boolean {
  const issueText = issues.join("\n");
  return files.filter((file) => issueText.includes(normalizeGeneratedPath(file.path)))
    .every((file) => context.includes(`### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``));
}


export function extractFilesFromMarkdown(text: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  // Pattern 1: Any markdown heading or line declaring a file path
  // Matches:
  // ### File: src/app/page.tsx
  // ### src/app/page.tsx
  // ## File: src/app/page.tsx
  // **File: src/app/page.tsx**
  // File: src/app/page.tsx
  // followed by a code block, whether closed by ``` or unclosed at the end of string
  const fileHeaderRegex = /(?:^|[\r\n])\s*(?:#{1,4}\s*(?:File:\s*)?|\*{1,2}File:\s*\*?\*?|File:\s*)\s*`?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`?\s*[\r\n]+\s*```[a-zA-Z0-9_-]*\s*[\r\n]/gi;

  const matches: Array<{ path: string; contentStart: number; matchIndex: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = fileHeaderRegex.exec(text)) !== null) {
    matches.push({
      path: m[1].trim(),
      contentStart: m.index + m[0].length,
      matchIndex: m.index,
    });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextMatch = matches[i + 1];
      const rawChunk = nextMatch
        ? text.slice(current.contentStart, nextMatch.matchIndex)
        : text.slice(current.contentStart);

      let content = rawChunk;
      const closingFence = content.lastIndexOf("```");
      if (closingFence !== -1) {
        content = content.slice(0, closingFence);
      }
      content = content.trim();

      if (content.length > 0) {
        files.push({
          path: current.path,
          content,
        });
      }
    }
  }

  // Pattern 2: file metadata carried on the opening code fence.
  if (files.length === 0) {
    const metadataFences = [
      /```[a-zA-Z0-9_-]*\s+(?:file|path|title)=["']?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)["']?\s*[\r\n]([\s\S]*?)(?:```|$)/gi,
      /```[a-zA-Z0-9_-]*:([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*[\r\n]([\s\S]*?)(?:```|$)/gi,
    ];
    for (const pattern of metadataFences) {
      while ((m = pattern.exec(text)) !== null) {
        const content = m[2].trim();
        if (content.length > 0) files.push({ path: m[1].trim(), content });
      }
      if (files.length > 0) break;
    }
  }

  // Pattern 3: First line comment // src/app/page.tsx or // File: src/app/page.tsx
  if (files.length === 0) {
    const p3 = /```(?:tsx|ts|jsx|js|css|html)\s*[\r\n]\/\/\s*(?:File:\s*)?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*[\r\n]([\s\S]*?)(?:```|$)/gi;
    while ((m = p3.exec(text)) !== null) {
      const content = m[2].trim();
      if (content.length > 0) {
        files.push({ path: m[1].trim(), content });
      }
    }
  }

  // Pattern 4: common coding-agent XML file actions.
  if (files.length === 0) {
    const xmlFile = /<(?:boltAction|file)\b[^>]*(?:filePath|path)=["']([a-zA-Z0-9_\-\.\/\[\]]+\.[a-zA-Z0-9]+)["'][^>]*>([\s\S]*?)<\/(?:boltAction|file)>/gi;
    while ((m = xmlFile.exec(text)) !== null) {
      const content = m[2].trim().replace(/^```[a-zA-Z0-9_-]*\s*[\r\n]/, "").replace(/[\r\n]\s*```$/, "").trim();
      if (content.length > 0) files.push({ path: m[1].trim(), content });
    }
  }

  // Pattern 5: structured JSON responses such as
  // {"files":[{"path":"src/app/page.tsx","content":"..."}]}.
  if (files.length === 0) {
    const fencedJson = /```json\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(text)?.[1];
    const candidate = (fencedJson || text).trim();
    const jsonStart = Math.min(
      ...[candidate.indexOf("{"), candidate.indexOf("[")].filter((index) => index >= 0)
    );
    const jsonEnd = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (Number.isFinite(jsonStart) && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
        const entries = Array.isArray(parsed) ? parsed : parsed?.files;
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const filePath = entry?.path || entry?.file || entry?.filePath;
            const content = entry?.content || entry?.code;
            if (typeof filePath === "string" && typeof content === "string" && content.trim()) {
              files.push({ path: filePath.trim(), content: content.trim() });
            }
          }
        }
      } catch {
        // A malformed JSON-looking response may still be a raw code fence below.
      }
    }
  }

  // Pattern 6: Single raw TSX/JSX/HTML code fence without file annotations.
  if (files.length === 0) {
    const rawFence = /```(?:tsx|ts|jsx|js|javascript|typescript|html|css)?\s*[\r\n]([\s\S]*?)(?:```|$)/i.exec(text);
    const candidateCode = rawFence ? rawFence[1].trim() : text.trim();
    if (
      candidateCode.includes("export default") ||
      candidateCode.includes("return (") ||
      candidateCode.includes("function")
    ) {
      let code = candidateCode;
      if (!code.includes("export default") && code.includes("function")) {
        const funcMatch = /function\s+([a-zA-Z0-9_$]+)/.exec(code);
        if (funcMatch) {
          code += `\nexport default ${funcMatch[1]};`;
        }
      }
      files.push({
        path: "src/App.tsx",
        content: code,
      });
    } else if (candidateCode.includes("<!DOCTYPE") || candidateCode.includes("<html") || candidateCode.includes("<body")) {
      files.push({
        path: "index.html",
        content: candidateCode,
      });
    }
  }

  return files;
}

export function extractDeletionsFromMarkdown(text: string): string[] {
  const deletions: string[] = [];
  const deletePattern = /(?:^|[\r\n])\s*(?:###\s*Delete:\s*|<delete\s+(?:filePath|path)=["'])(`?[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+`?)/gi;
  let m: RegExpExecArray | null;
  while ((m = deletePattern.exec(text)) !== null) {
    const candidate = normalizeGeneratedPath(m[1].replace(/[`"']/g, "").trim());
    if (!isRuntimeOwnedGeneratedPath(candidate)) deletions.push(candidate);
  }
  return deletions;
}

function assertUsableGeneratedFiles(
  files: GeneratedSourceFile[],
  phase: "generation" | "repair",
  existingPaths: Iterable<string>,
  existingEnvironmentExample?: string,
  existingSources: GeneratedSourceFile[] = [],
  allowSeedData = true,
  allowAuthentication = true,
  requirePersistence = false,
  requireAuthentication = false,
  requireCommerceRole = false
): void {
  const existing = [...existingPaths].map(normalizeGeneratedPath);
  const hasExistingEntrypoint = existing.some((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry));
  const issues = generationValidationIssues(files, existing, {
    requireEntrypoint: phase === "generation" && !hasExistingEntrypoint,
    requireEntrypointFirst: phase === "generation" && !hasExistingEntrypoint,
    existingEnvironmentExample,
    existingSources,
    allowSeedData,
    allowAuthentication,
    requirePersistence,
    requireAuthentication,
    requireCommerceRole,
  });
  if (issues.length > 0) throw new Error(`The AI ${phase} was incomplete: ${issues.join("; ")}`);
}

function mergeGeneratedFiles(
  original: Array<{ path: string; content: string }>,
  retry: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  const merged = new Map(original.map((file) => [normalizeGeneratedPath(file.path), file]));
  for (const file of retry) {
    const normalized = normalizeGeneratedPath(file.path);
    merged.delete(normalized);
    merged.set(normalized, { ...file, path: normalized });
  }
  const files = [...merged.values()];
  const entrypointCandidates = files
    .map((file, index) => ({ file, index, path: normalizeGeneratedPath(file.path) }))
    .filter((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry.path));
  if (entrypointCandidates.length > 1) {
    const preferred = entrypointCandidates.find((entry) => entry.path === "src/App.tsx") || entrypointCandidates[0];
    for (const entry of [...entrypointCandidates].sort((left, right) => right.index - left.index)) {
      if (entry.index === preferred.index) continue;
      console.log(`[localAgentEngine] Dropped redundant application entrypoint: ${entry.file.path}`);
      files.splice(entry.index, 1);
    }
  }
  const entrypointIndex = files.findIndex((file) =>
    APPLICATION_ENTRYPOINT_PATHS.has(normalizeGeneratedPath(file.path))
  );
  if (entrypointIndex > 0) {
    const [entrypoint] = files.splice(entrypointIndex, 1);
    files.unshift(entrypoint);
  }
  return files;
}

export function mergeGeneratedActions(
  currentFiles: GeneratedSourceFile[],
  currentDeletions: Iterable<string>,
  replacementFiles: GeneratedSourceFile[],
  replacementDeletions: Iterable<string>
): { files: GeneratedSourceFile[]; deletions: Set<string> } {
  const deletions = new Set([...currentDeletions].map(normalizeGeneratedPath));
  const removedPaths = new Set([...replacementDeletions].map(normalizeGeneratedPath));
  const withoutDeletedFiles = currentFiles.filter(
    (file) => !removedPaths.has(normalizeGeneratedPath(file.path))
  );
  for (const removedPath of removedPaths) deletions.add(removedPath);

  const files = mergeGeneratedFiles(withoutDeletedFiles, replacementFiles);
  // A later response that recreates a path wins over an earlier delete. This is
  // also the conservative choice for a contradictory single response: keep the
  // complete file the model supplied instead of deleting it after validation.
  for (const file of replacementFiles) deletions.delete(normalizeGeneratedPath(file.path));
  return { files, deletions };
}

function availableWorkspacePaths(projectId: string): string[] {
  const paths = localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file")
    .filter((entry) => {
      const file = localFileManager.getContent(projectId, entry.path);
      return Boolean(
        file &&
        file.encoding === "utf8" &&
        !containsGenerationPlaceholder(file.content) &&
        !isRuntimeOwnedGeneratedPath(entry.path, file.content)
      );
    })
    .map((entry) => normalizeGeneratedPath(entry.path));
  // Runtime-owned files are not user-generated source and must stay out of
  // follow-up context, but generated code is allowed to import these injected
  // project-scoped database and authentication clients.
  if (localFileManager.getContent(projectId, "src/lib/db.ts")) paths.push("src/lib/db.ts");
  if (localFileManager.getContent(projectId, "src/lib/auth.ts")) paths.push("src/lib/auth.ts");
  if (localFileManager.getContent(projectId, "src/lib/files.ts")) paths.push("src/lib/files.ts");
  return paths;
}

export function isWorkspaceSourcePath(filePath: string): boolean {
  const normalized = normalizeGeneratedPath(filePath);
  const sourceDirectory = /^(?:src|app|pages|components|lib)\//.test(normalized);
  const rootSource = !normalized.includes("/") && /\.(?:[cm]?[jt]sx?|css)$/.test(normalized) &&
    !/^(?:vite|vitest|tailwind|postcss|eslint|next|jest|babel|prettier|playwright|tsup|webpack|rollup|astro|svelte|nuxt)\.config\./.test(normalized);
  return (sourceDirectory || rootSource) &&
    /\.(?:[cm]?[jt]sx?|css|json|html)$/.test(normalized) &&
    !/(?:^|\/)(?:node_modules|dist|build|\.vite|\.next|coverage|\.git)(?:\/|$)/.test(normalized);
}

function availableWorkspaceSources(projectId: string): GeneratedSourceFile[] {
  return localFileManager
    .getTree(projectId)
    .entries.filter((entry) => entry.type === "file" && isWorkspaceSourcePath(entry.path))
    .flatMap((entry) => {
      const file = localFileManager.getContent(projectId, entry.path);
      if (
        !file ||
        file.encoding !== "utf8" ||
        containsGenerationPlaceholder(file.content) ||
        isRuntimeOwnedGeneratedPath(entry.path, file.content)
      ) return [];
      return [{ path: normalizeGeneratedPath(entry.path), content: file.content }];
    });
}

export function promptRequestsAuthentication(prompt: string): boolean {
  // Safety instructions in a prompt often mention authentication to forbid
  // browser-only passwords or to say "when requested". They are constraints,
  // not a request to put a sign-in wall in every public application.
  const affirmative = prompt
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence
      .replace(/\buse\s+real\s+supported\s+authentication\b[^.\n]*?\bwhen\s+requested\b/gi, "")
      .split(/\b(?:do not|don't|never|avoid|without|must not|no fake|no simulated)\b/i)[0]);
  if (affirmative.some((sentence) => AUTHENTICATION_REQUEST_PATTERN.test(sentence))) return true;
  if (/\b(?:do not|don't|never|avoid|without|must not|no)\s+(?:(?:any|a|an|user|users|add|include|require|use|implement|create|force|to)\s+){0,4}(?:auth(?:entication)?|log[ -]?in|sign[ -]?in|accounts?)\b/i.test(prompt)) return false;
  const requested = affirmative.join(" ");
  if (/\b(?:landing page|marketing site|portfolio|brochure site)\b/i.test(requested)) return false;
  return /\b(?:crm|project management|inventory (?:manager|management)|expense tracker|support ticket(?: system)?|document manager|people operations|hr application)\b/i.test(requested) ||
    /\bsaas\b/i.test(requested);
}

export function promptRequestsPersistence(prompt: string): boolean {
  const affirmativeText = prompt
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.split(/\b(?:do not|don't|never|avoid|without|must not|no fake|no simulated|no\s+(?:database|data|persistence|backend|storage|crud))\b/i)[0])
    .join(" ");
  const explicitData = /\b(?:persist(?:ent|ence)?|database|crud|full[- ]stack|cart|checkout|orders|inventory|booking|reservation|customer records?)\b/i.test(affirmativeText);
  if (/\b(?:landing page|marketing site|portfolio|brochure site)\b/i.test(affirmativeText) && !explicitData) return false;
  return explicitData || /\b(?:saas|crm|e-?commerce|marketplace|storefront|project management|analytics dashboard|admin dashboard)\b/i.test(affirmativeText);
}

export function promptRequestsCommerce(prompt: string): boolean {
  // Exclude prohibitions and generic safety requirements from feature inference.
  // Qualification and real user prompts often say "do not invent products or
  // orders" even when the requested app has nothing to do with commerce.
  const affirmativeText = prompt
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.split(/\b(?:do not|don't|never|avoid|without|must not|no fake|no simulated)\b/i)[0])
    .join(" ");
  if (/\b(?:e-?commerce|online store|storefront|shopping cart)\b/i.test(affirmativeText)) return true;
  if (/\bmarketplace\b/i.test(affirmativeText) &&
      /\b(?:subscriptions?|plans?|vendors?|sellers?|products?|buyers?|customers?|checkout|cart|orders?)\b/i.test(affirmativeText)) return true;
  return /\b(?:store|shop|boutique)\b/i.test(affirmativeText) &&
    /\b(?:products?|catalog(?:ue)?|cart|checkout|inventory|orders?)\b/i.test(affirmativeText);
}

export function promptRequestsPrivateFiles(prompt: string): boolean {
  const affirmative = prompt
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.split(/\b(?:do not|don't|never|avoid|without|must not|no fake|no simulated)\b/i)[0])
    .join(" ");
  return /\bdocument (?:manager|management)\b/i.test(affirmative) ||
    /\b(?:upload(?:s|ing)?|attachments?)\b/i.test(affirmative) &&
    /\b(?:files?|documents?|photos?|images?|attachments?)\b/i.test(affirmative);
}

export function requestedSharedCatalogCollections(prompt: string): Array<"events" | "courses" | "services" | "tables" | "listings"> {
  const collections: Array<"events" | "courses" | "services" | "tables" | "listings"> = [];
  if (/\b(?:community\s+events?|event\s+management|event\s+marketplace|public\s+events?)\b/i.test(prompt) &&
      /\b(?:registrations?|attendees?|tickets?|bookings?|community|public)\b/i.test(prompt)) {
    collections.push("events");
  }
  if (/\b(?:lms|courses?|learning management(?: system)?|online learning platform)\b/i.test(prompt) &&
      /\b(?:marketplace|catalog(?:ue)?|enrollments?|students?|instructors?)\b/i.test(prompt)) {
    collections.push("courses");
  }
  if (/\b(?:bookings?|appointments?|reservations?|scheduling)\b/i.test(prompt) &&
      /\b(?:services?|providers?)\b/i.test(prompt)) {
    collections.push("services");
  }
  if (/\b(?:restaurant|dining|hospitality)\b/i.test(prompt) &&
      /\b(?:reservations?|bookings?)\b/i.test(prompt) &&
      /\b(?:tables?|seating)\b/i.test(prompt)) {
    collections.push("tables");
  }
  if (/\b(?:real[ -]?estate|property|properties|homes? for sale|rental listings?)\b/i.test(prompt) &&
      /\b(?:listings?|search|browse|catalog(?:ue)?|properties|homes?)\b/i.test(prompt)) {
    collections.push("listings");
  }
  return collections;
}

export function generatedSourcesRequireEndUserAuth(files: GeneratedSourceFile[]): boolean {
  return files.some((file) =>
    /(?:from\s*["'][^"']*\/lib\/auth["']|\bauth\.(?:signUp|signIn|signOut|getSession|getUser|onAuthStateChange)\b)/.test(file.content)
  );
}

function workspaceRequiresEndUserAuth(projectId: string): boolean {
  return generatedSourcesRequireEndUserAuth(availableWorkspaceSources(projectId));
}

function workspaceEnvironmentExample(projectId: string): string | undefined {
  const file = localFileManager.getContent(projectId, ".env.example");
  return file?.encoding === "utf8" ? file.content : undefined;
}

export function hasRealGeneratedSource(files: GeneratedSourceFile[]): boolean {
  return files.some((file) => {
    const normalized = normalizeGeneratedPath(file.path);
    if (containsGenerationPlaceholder(file.content) || isRuntimeOwnedGeneratedPath(normalized, file.content)) {
      return false;
    }
    return (
      APPLICATION_ENTRYPOINT_PATHS.has(normalized) ||
      (normalized.startsWith("src/components/") && !normalized.startsWith("src/components/ui/")) ||
      (normalized.endsWith(".html") && normalized !== "public/index.html")
    );
  });
}

export function fixCssImportOrder(css: string): string {
  const lines = css.split("\n");
  const urlImports: string[] = [];
  const tailwindImport: string[] = [];
  const rest: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@import url(")) {
      urlImports.push(line);
    } else if (trimmed.startsWith('@import "tailwindcss"') || trimmed.startsWith("@import 'tailwindcss'")) {
      tailwindImport.push(line);
    } else {
      rest.push(line);
    }
  }

  // Generated styles frequently replace the starter file and omit the
  // Tailwind entrypoint. The build can still pass while every utility class
  // silently disappears from the preview.
  if (tailwindImport.length === 0) tailwindImport.push('@import "tailwindcss";');
  return [...urlImports, ...tailwindImport, ...rest].join("\n");
}

const SEMANTIC_CSS_FALLBACKS: Record<string, string> = {
  background: "hsl(210 40% 98%)",
  foreground: "hsl(222 47% 11%)",
  card: "var(--surface, hsl(0 0% 100%))",
  "card-foreground": "var(--foreground)",
  popover: "var(--surface-elevated, var(--card))",
  "popover-foreground": "var(--foreground)",
  primary: "hsl(239 84% 42%)",
  "primary-foreground": "hsl(0 0% 100%)",
  secondary: "hsl(214 32% 94%)",
  "secondary-foreground": "var(--foreground)",
  muted: "var(--secondary)",
  "muted-foreground": "hsl(215 16% 40%)",
  accent: "hsl(239 84% 95%)",
  "accent-foreground": "var(--foreground)",
  destructive: "var(--error, hsl(0 72% 45%))",
  "destructive-foreground": "hsl(0 0% 100%)",
  border: "hsl(214 32% 88%)",
  input: "var(--border)",
  ring: "var(--primary)",
};

export function completeSemanticCss(css: string): string {
  const missingRoots = Object.entries(SEMANTIC_CSS_FALLBACKS)
    .filter(([token]) => !new RegExp(`--${token}\\s*:`).test(css))
    .map(([token, value]) => `  --${token}: ${value};`);
  const missingTheme = Object.keys(SEMANTIC_CSS_FALLBACKS)
    .filter((token) => !new RegExp(`--color-${token}\\s*:`).test(css))
    .map((token) => `  --color-${token}: var(--${token});`);
  return css +
    (missingRoots.length ? `\n:root {\n${missingRoots.join("\n")}\n}\n` : "") +
    (missingTheme.length ? `\n@theme inline {\n${missingTheme.join("\n")}\n}\n` : "");
}

/**
 * Fix AI-generated CSS that has properties floating outside any selector.
 * Tailwind 4 / PostCSS will reject these with a parse error.
 * Wraps any orphaned property lines in a `body {}` block.
 */
function sanitizeOrphanedCssProperties(css: string): string {
  const lines = css.split("\n");
  const result: string[] = [];
  const orphans: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes("{")) depth += (trimmed.match(/{/g) || []).length;
    if (trimmed.includes("}")) depth -= (trimmed.match(/}/g) || []).length;

    if (
      depth === 0 &&
      trimmed.length > 0 &&
      !trimmed.startsWith("@") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith(":") &&
      !trimmed.startsWith(".") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("[") &&
      !trimmed.includes("{") &&
      !trimmed.includes("}") &&
      trimmed.includes(":") &&
      trimmed.endsWith(";")
    ) {
      orphans.push(line);
    } else {
      result.push(line);
    }
  }

  if (orphans.length > 0) {
    console.log(`[localAgentEngine] Wrapped ${orphans.length} orphaned CSS properties in body {}`);
    result.push("body {");
    result.push(...orphans.map(l => "  " + l.trim()));
    result.push("}");
  }

  return result.join("\n");
}

/**
 * Tailwind 4 rejects `@apply` for semantic utilities that have not been declared
 * through its theme system (the most common generated example is
 * `@apply bg-background text-foreground`). Generated pages already carry their
 * visual utilities in JSX, so dropping these optional convenience declarations
 * is safer than turning an otherwise valid app into a blank preview.
 */
export function stripGeneratedApplyRules(css: string): string {
  const unsupportedSemanticUtility = /\b(?:bg-background|text-foreground|border-border|ring-ring|bg-card|text-card-foreground|bg-popover|text-popover-foreground)\b/;
  return css
    .replace(/^[\t ]*@apply\s+[^;{}]+;[\t ]*$/gm, (declaration) =>
      unsupportedSemanticUtility.test(declaration) ? "" : declaration
    )
    .replace(/@apply\s+[^;{}]+;/g, (declaration) =>
      unsupportedSemanticUtility.test(declaration) ? "" : declaration
    );
}

/**
 * Post-process AI-generated files to fix common issues that cause runtime crashes.
 * This is a safety net — the system prompt should prevent these, but the AI
 * sometimes ignores instructions.
 */
export function postProcessGeneratedFiles(
  files: Array<{ path: string; content: string }>,
  existingSources: Array<{ path: string; content: string }> = []
): void {
  // A model response can include an unnecessary runtime file or layout snippet.
  // Drop those runtime-owned extras before validation.
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (isRuntimeOwnedGeneratedPath(file.path, file.content)) {
      console.log(`[localAgentEngine] Dropped runtime-owned generated file: ${file.path}`);
      files.splice(i, 1);
    }
  }
  // A second Sonner mount creates duplicate notification landmarks and fires
  // each toast twice. Keep the application's mount when both files are newly
  // generated; otherwise preserve the already-working entrypoint mount.
  const generatedMain = files.find((file) => /^src\/(?:main|index)\.[jt]sx$/.test(normalizeGeneratedPath(file.path)));
  const generatedApp = files.find((file) => normalizeGeneratedPath(file.path) === "src/App.tsx");
  const existingMain = existingSources.find((file) => /^src\/(?:main|index)\.[jt]sx$/.test(normalizeGeneratedPath(file.path)));
  const toasterInMain = /<Toaster\b/.test(generatedMain?.content || existingMain?.content || "");
  if (generatedApp && toasterInMain && /<Toaster\b[^>]*\/>/.test(generatedApp.content)) {
    generatedApp.content = generatedApp.content.replace(/<Toaster\b[^>]*\/>/g, "").replace(
      /import\s*\{([^}]+)\}\s*from\s*(["'])(sonner|@\/components\/ui\/sonner)\2;?/g,
      (_statement, imports: string, quote: string, moduleName: string) => {
        const retained = imports.split(",").map((name) => name.trim()).filter((name) => name && name !== "Toaster");
        return retained.length ? `import { ${retained.join(", ")} } from ${quote}${moduleName}${quote};` : "";
      }
    );
    console.log("[localAgentEngine] Removed duplicate application toaster mount");
  }
  // The runtime entrypoint imports src/app/globals.css. Models often write
  // src/globals.css or src/index.css without importing it, which otherwise
  // builds successfully while silently discarding the intended design.
  const canonicalCss = "src/app/globals.css";
  const hasCanonicalCss = files.some((file) => normalizeGeneratedPath(file.path) === canonicalCss);
  if (!hasCanonicalCss) {
    const legacyCss = files.find((file) => ["src/globals.css", "src/index.css"].includes(normalizeGeneratedPath(file.path)));
    const legacyBaseName = legacyCss?.path.split("/").at(-1);
    const replacedPaths = new Set(files.map((file) => normalizeGeneratedPath(file.path)));
    const effectiveSources = [...files, ...existingSources.filter((file) => !replacedPaths.has(normalizeGeneratedPath(file.path)))];
    const importedByGeneratedSource = Boolean(legacyBaseName && effectiveSources.some((file) =>
      /\.[cm]?[jt]sx?$/.test(file.path) &&
      new RegExp(`\\bimport\\s+(?:[^;\\n]+?\\s+from\\s+)?["'][^"']*${legacyBaseName.replace(".", "\\.")}["']`).test(file.content)
    ));
    if (legacyCss && !importedByGeneratedSource) {
      console.log(`[localAgentEngine] Routed unimported ${legacyCss.path} to ${canonicalCss}`);
      legacyCss.path = canonicalCss;
    }
  }
  for (const file of files) {
    if (normalizeGeneratedPath(file.path) === canonicalCss) {
      file.content = completeSemanticCss(file.content);
    }
  }
  // Keep a generated palette intact while giving Tailwind colors stable CSS
  // tokens. This is a semantics-preserving fix for the model's common raw-hex
  // utility output and avoids spending a repair attempt on every color class.
  const generatedColors = new Map<string, string>();
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path)) continue;
    file.content = file.content.replace(/\bclassName\s*=\s*(["'`])([^"'`]*?)\1/g,
      (attribute, quote: string, classes: string) => {
        const normalized = classes.replace(/\b(text|bg|border)-\[#([0-9a-fA-F]{3,8})\]/g,
          (_match, utility: string, rawHex: string) => {
            const hex = rawHex.toLowerCase();
            const token = `--bb-generated-${hex}`;
            generatedColors.set(token, `#${hex}`);
            return `${utility}-[var(${token})]`;
          });
        return normalized === classes ? attribute : `className=${quote}${normalized}${quote}`;
      });
  }
  if (generatedColors.size > 0) {
    let cssFile = files.find((file) => normalizeGeneratedPath(file.path) === canonicalCss);
    if (!cssFile) {
      const existingCss = existingSources.find((file) => normalizeGeneratedPath(file.path) === canonicalCss);
      cssFile = { path: canonicalCss, content: existingCss?.content || '@import "tailwindcss";\n' };
      files.push(cssFile);
    }
    const declarations = [...generatedColors].filter(([token, color]) =>
      !new RegExp(`${token}\\s*:\\s*${color}\\s*;`, "i").test(cssFile!.content))
      .map(([token, color]) => `  ${token}: ${color};`);
    if (declarations.length > 0) cssFile.content += `\n:root {\n${declarations.join("\n")}\n}\n`;
  }
  const entrypointCandidates = files
    .map((file, index) => ({ file, index, path: normalizeGeneratedPath(file.path) }))
    .filter((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry.path));
  if (entrypointCandidates.length > 1) {
    const preferred = entrypointCandidates.find((entry) => entry.path === "src/App.tsx") || entrypointCandidates[0];
    for (const entry of [...entrypointCandidates].sort((left, right) => right.index - left.index)) {
      if (entry.index === preferred.index) continue;
      console.log(`[localAgentEngine] Dropped redundant application entrypoint: ${entry.file.path}`);
      files.splice(entry.index, 1);
    }
  }
  const entrypointIndex = files.findIndex((file) =>
    APPLICATION_ENTRYPOINT_PATHS.has(normalizeGeneratedPath(file.path))
  );
  if (entrypointIndex > 0) {
    const [entrypoint] = files.splice(entrypointIndex, 1);
    files.unshift(entrypoint);
    console.log(`[localAgentEngine] Moved ${entrypoint.path} to the first generated file block`);
  }

  // Model prose inside JSX frequently contains typographic punctuation even
  // when the code contract requests ASCII. Normalize it without introducing
  // quote delimiters that could change JavaScript string syntax.
  for (const file of files) {
    file.content = file.content
      .replace(/[\u00a0\u200b-\u200d\u2060\ufeff]/g, " ")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2018\u2019\u201c\u201d]/g, "")
      .replace(/\u2026/g, "...");
  }

  const REACT_HOOK_PATTERN = /\b(useState|useEffect|useRef|useCallback|useMemo|useReducer|useContext|useLayoutEffect|useImperativeHandle|useDebugValue|useDeferredValue|useTransition|useId|useSyncExternalStore)\b/;
  const BROWSER_API_PATTERN = /\b(window\.|document\.|localStorage\.|sessionStorage\.|navigator\.)\b/;

  for (const file of files) {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) continue;

    let content = file.content;
    const normalizedPath = normalizeGeneratedPath(file.path);
    const isReactEntry = /^src\/(?:main|index)\.(?:tsx|jsx)$/.test(normalizedPath);

    // Detect non-code content
    const looksLikeCode =
      content.includes("import ") ||
      content.includes("export ") ||
      content.includes("function ") ||
      content.includes("const ") ||
      content.includes("return (") ||
      content.includes("React") ||
      content.includes("<div") ||
      content.includes("<main");

    if (!looksLikeCode) {
      console.warn(`[localAgentEngine] Non-code content detected in ${file.path}`);
    }

    // Component files must not mount a second React tree. Browser entrypoints,
    // however, own createRoot and must retain (or recover) this import.
    if (isReactEntry) {
      const usesBareCreateRoot = /\bcreateRoot\s*\(/.test(content);
      const importsCreateRoot = /import\s*{[^}]*\bcreateRoot\b[^}]*}\s*from\s*['"]react-dom\/client['"]/.test(content);
      if (usesBareCreateRoot && !importsCreateRoot) {
        content = `import { createRoot } from "react-dom/client";\n${content}`;
        console.log(`[localAgentEngine] Restored createRoot import in ${file.path}`);
      }
    } else {
      content = content.replace(/^\s*import\s+.*from\s+['"]react-dom\/client['"];?\s*$/gm, "");
    }

    // Remove styled-jsx <style jsx> blocks
    content = content.replace(/<style\s+jsx[^>]*>[\s\S]*?<\/style>/gi, "");

    // The generated auth wrapper intentionally exposes the session-first
    // callback documented in SYSTEM_PROMPT. Models sometimes copy Supabase's
    // two-argument callback but name the unused first argument `_event`; make
    // that common form session-first so TypeScript can contextually type it and
    // the runtime delivers the value the callback actually consumes.
    content = content.replace(
      /(?<![\w$.])auth\.onAuthStateChange\(\(\s*_event\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g,
      "auth.onAuthStateChange(($1) =>"
    );

    // Auto-inject 'use client' if hooks or browser APIs are used
    const needsUseClient =
      REACT_HOOK_PATTERN.test(content) ||
      BROWSER_API_PATTERN.test(content);

    const hasUseClient =
      content.trimStart().startsWith("'use client'") ||
      content.trimStart().startsWith('"use client"');

    if (needsUseClient && !hasUseClient) {
      content = "'use client';\n" + content;
      console.log(`[localAgentEngine] Auto-injected 'use client' into ${file.path}`);
    }

    file.content = content;
  }
}

export const localAgentEngine = {
  async runPrompt(
    projectId: string,
    prompt: string,
    options: { visualReferenceUrl?: string; displayPrompt?: string } = {}
  ): Promise<void> {
    const record = localProjectStore.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);
    if (record.status === "init" || sharedAgentRunState.runs.has(projectId)) {
      throw new Error("A generation is already running or stopping for this project");
    }
    const priorDeployment = record.deployment?.status === "success" ? {
      deployment: { ...record.deployment },
      previewUrl: record.previewUrl || persistentPreviewPath(projectId),
      productionProjectUrl: record.productionProjectUrl,
    } : null;
    const hadValidatedPreview = Boolean(priorDeployment) || record.conversation.some((message) =>
      message.generationEvent?.type === "preview_ready" && message.generationEvent.status === "completed"
    );
    const generationId = randomUUID();
    const controller = new AbortController();
    sharedAgentRunState.controllers.set(projectId, { generationId, controller });
    const checkCancelled = () => {
      const current = localProjectStore.getRecord(projectId);
      if (controller.signal.aborted || current?.activeGenerationId !== generationId || current.cancellationRequestedAt) {
        throw new GenerationCancelledError();
      }
    };

    const now = new Date().toISOString();
    const priorMessages = record.conversation || [];

    // 1. Add user message
    const userMsg: ConversationMessage = {
      author: "user",
      message: options.displayPrompt?.trim() || prompt,
      messageType: "regular",
      createdAt: now,
    };

    const startMsg: ConversationMessage = {
      author: "agent",
      message: `Starting AI Composer...`,
      messageType: "starting",
      createdAt: new Date().toISOString(),
      generationEvent: { type: "generation_started", status: "started", generationId },
    };

    // /generate persists the whole conversation before starting the first run.
    // Reuse its existing user request instead of echoing it a second time.
    const alreadyInInitialConversation = !priorMessages.some((message) => message.generationEvent?.type === "generation_started") &&
      priorMessages.some((message) => message.author === "user" && message.message === userMsg.message);
    const conversation = [...priorMessages, ...(alreadyInInitialConversation ? [] : [userMsg]), startMsg];
    localProjectStore.update(projectId, {
      status: "init",
      activeGenerationId: generationId,
      cancellationRequestedAt: undefined,
      agentStartedAt: now,
      conversation,
    });

    // Serialize detached generations per project. Each queued run snapshots the
    // workspace only when it actually starts, so a failed older request can
    // never restore stale files over a newer request.
    const previousRun = sharedAgentRunState.runs.get(projectId) || Promise.resolve();
    const run = previousRun.catch(() => undefined).then(async () => {
      let previousWorkspace: Map<string, Buffer> | null = null;

      try {
        checkCancelled();
        // Keep template and snapshot I/O inside the guarded path so a filesystem
        // failure is reported instead of leaving the project stuck in `init`.
        // The preview starts only after generated code passes a real compile.
        localSandboxManager.ensureProjectTemplate(projectId);
        previousWorkspace = snapshotWorkspace(projectId);

        if (multiModelRouter.getProviders().length === 0) {
          throw new Error("AI generation is unavailable because no server-side model provider is configured");
        }

        // ═══⭐⭐ FOLLOW-UP AWARENESS ══════════════════════════════════════════
        //
        // Detect whether this is a follow-up prompt (existing real source code in
        // the workspace) and, if so, include ALL project source files plus prior
        // conversation history so the AI modifies the existing project instead of
        // generating a brand-new website from scratch.

        let userPromptContent = prompt;
        let compactFollowUpContent: string | null = null;
        let isFollowUp = false;
        const appendGenerationContext = (context: string) => {
          userPromptContent += `\n\n${context}`;
          if (compactFollowUpContent) compactFollowUpContent += `\n\n${context}`;
        };

        const tree = localFileManager.getTree(projectId);
        const sourceExtensions = /\.(?:tsx?|jsx?|css|json|html)$/;
        const allSourceEntries = tree.entries.filter(
          (e) =>
            e.type === "file" &&
            sourceExtensions.test(e.path) &&
            !e.path.includes("node_modules") &&
            !e.path.startsWith(".") &&
            !e.path.startsWith("dist/") &&
            !e.path.startsWith("build/") &&
            !e.path.includes("/dist/") &&
            !e.path.includes("/build/")
        );

        // Check if there is real code in the workspace (not just the initial placeholder)
        const nonPlaceholderEntries = allSourceEntries.filter((entry) => {
          const file = localFileManager.getContent(projectId, entry.path);
          return file &&
            file.encoding === "utf8" &&
            !containsGenerationPlaceholder(file.content) &&
            !isRuntimeOwnedGeneratedPath(entry.path, file.content);
        });

        // Prioritize key application source files first so they fit in the context budget
        nonPlaceholderEntries.sort((a, b) => {
          const score = (p: string) => {
            if (p === "src/App.tsx" || p === "src/App.jsx" || p === "src/app/page.tsx") return 0;
            if (p.startsWith("src/") && (p.endsWith(".tsx") || p.endsWith(".jsx"))) return 1;
            if (p === "src/index.css" || p === "src/globals.css") return 2;
            if (p === "index.html") return 3;
            if (p.endsWith(".json")) return 4;
            return 5;
          };
          return score(a.path) - score(b.path);
        });

        const hasRealExistingCode = hasRealGeneratedSource(
          nonPlaceholderEntries.flatMap((entry) => {
            const file = localFileManager.getContent(projectId, entry.path);
            return file && file.encoding === "utf8"
              ? [{ path: entry.path, content: file.content }]
              : [];
          })
        );

        if (hasRealExistingCode && nonPlaceholderEntries.length > 0) {
          isFollowUp = true;

          // Build a clean file tree summary
          const treeSummary = allSourceEntries
            .map((e) => ` - ${e.path} (${e.size} bytes)`)
            .join("\n");

          // Build source context with a 35,000 char budget
          let charBudget = 35_000;
          const sourceChunks: string[] = [];
          for (const entry of nonPlaceholderEntries) {
            if (charBudget <= 0) break;
            const file = localFileManager.getContent(projectId, entry.path);
            if (!file || file.encoding !== "utf8") continue;
            const content = file.content.slice(0, charBudget);
            charBudget -= content.length;
            sourceChunks.push(`### File: ${entry.path}\n\`\`\`\n${content}\n\`\`\``);
          }

          if (sourceChunks.length > 0) {
            userPromptContent = `Project File Tree:\n${treeSummary}\n\nCurrent Project Source Files:\n\n${sourceChunks.join("\n\n")}\n\nUser Request: ${prompt}\n\nIMPORTANT: This is an incremental follow-up request on an existing project. Modify ONLY the files needed to satisfy the request. Leave all other files untouched. Output the complete updated code for each changed file, or create new files as needed. If removing an obsolete file, output ### Delete: path/to/file.`;

            // The small-account fallback has a lower input-token allowance.
            // Give it complete, relevant project files rather than a truncated
            // copy of every file. The full-context providers keep the 35k view.
            const editTerms = [...new Set((prompt.toLowerCase().match(/[a-z]{4,}/g) || [])
              .filter((term) => !["add", "change", "make", "with", "without", "existing", "preserve", "working", "file", "code"].includes(term)))];
            const relevantEntries = [...nonPlaceholderEntries].sort((left, right) => {
              const rank = (entry: typeof left) => {
                if (entry.path === "src/App.tsx" || entry.path === "src/app/page.tsx") return 1_000;
                const source = localFileManager.getContent(projectId, entry.path)?.content.toLowerCase() || "";
                return editTerms.reduce((score, term) => score + (entry.path.toLowerCase().includes(term) ? 25 : source.includes(term) ? 1 : 0), 0);
              };
              return rank(right) - rank(left);
            });
            const compactChunks: string[] = [];
            let compactBudget = 16_000;
            for (const entry of relevantEntries) {
              const file = localFileManager.getContent(projectId, entry.path);
              if (!file || file.encoding !== "utf8" || file.content.length > compactBudget) continue;
              compactChunks.push(`### File: ${entry.path}\n\`\`\`\n${file.content}\n\`\`\``);
              compactBudget -= file.content.length;
              if (compactBudget <= 0) break;
            }
            compactFollowUpContent = `Project File Tree:\n${treeSummary}\n\nRelevant Existing Source Files:\n\n${compactChunks.join("\n\n") || "No complete source file fits the compact context."}\n\nUser Request: ${prompt}\n\nModify only necessary files; preserve all unlisted files and existing behavior. Return complete replacements or ### Delete: path.`;
          }
        }

        // A failed or cancelled build must not change authorization for the
        // previously verified app. Failed first attempts can still retry with
        // preserved source before any preview has been accepted.
        const enableCommerce = !record.commerceEnabled && promptRequestsCommerce(prompt);
        const enablePrivateFiles = Boolean(record.privateFilesEnabled || promptRequestsPrivateFiles(prompt));
        const sharedCatalogCollections = Array.from(new Set<"events" | "courses" | "services" | "tables" | "listings">([
          ...(record.sharedCatalogCollections || []),
          ...requestedSharedCatalogCollections(prompt),
        ]));

        const referenceUrl = options.visualReferenceUrl
          ? extractWebsiteUrl(options.visualReferenceUrl)
          : null;
        if (options.visualReferenceUrl && !referenceUrl) {
          throw new Error("The submitted visual reference URL is invalid.");
        }
        if (referenceUrl) {
          const crawlStartedAt = Date.now();
          const current = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [
              ...(current?.conversation || []),
              {
                author: "agent",
                message: "Analyzing the reference website's design with Firecrawl...",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: {
                  type: "crawl_started",
                  status: "started",
                  sourceUrl: referenceUrl,
                },
              },
            ],
          });
          let referenceFailurePhase: "crawl" | "vision" = "crawl";
          try {
            const design = await analyzeWebsiteDesign(referenceUrl);
            checkCancelled();
            const afterCrawl = localProjectStore.getRecord(projectId);
            const crawlAssetMessages: ConversationMessage[] = design.referencePackage.assets.map((asset, imageIndex) => ({
              author: "agent" as const,
              message: `Fetched visual reference ${imageIndex + 1}.`,
              messageType: "building" as const,
              createdAt: new Date().toISOString(),
              files: [{
                name: asset.role === "screenshot" ? "reference-page-screenshot.png" : `reference-asset-${imageIndex + 1}`,
                url: asset.url,
                imageDescription: `Firecrawl visual reference ${imageIndex + 1} from ${design.sourceUrl}`,
                mimeType: asset.contentType || "image/unknown",
              }],
              generationEvent: {
                type: "crawl_asset_received" as const,
                status: "completed" as const,
                assetUrl: asset.url,
                sourceUrl: design.sourceUrl,
                source: "crawl" as const,
              },
            }));
            localProjectStore.update(projectId, {
              conversation: [
                ...(afterCrawl?.conversation || []),
                {
                  author: "agent",
                  message: `Firecrawl completed — ${design.assetUrls.length} visual reference${design.assetUrls.length === 1 ? "" : "s"}; ${design.imageUrls.length} selected for analysis.`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: "crawl_completed",
                    status: "completed",
                    sourceUrl: design.sourceUrl,
                    durationMs: Date.now() - crawlStartedAt,
                    source: "crawl",
                  },
                },
                ...crawlAssetMessages,
                {
                  author: "agent",
                  message: "Analyzing visual references with GLM...",
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: { type: "visual_analysis_started", status: "started", source: "vision" },
                },
              ],
            });
            referenceFailurePhase = "vision";

            const visualAnalysis = await runReferenceAnalysis(design);
            checkCancelled();

            const afterVision = localProjectStore.getRecord(projectId);
            const visualMessages: ConversationMessage[] = [{
              author: "agent",
              message: `Reference analysis completed. ${visualAnalysis.specification.design_summary}`,
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: {
                type: "visual_analysis_completed",
                status: "completed",
                source: "vision",
                referenceAnalysis: visualAnalysis.diagnostics,
              },
            }];
            localProjectStore.update(projectId, {
              conversation: [...(afterVision?.conversation || []), ...visualMessages],
            });
            appendGenerationContext(visualAnalysis.implementationContext);
          } catch (error) {
            checkCancelled();
            const message = safeFailureDetail(error);
            const diagnostics = error instanceof ReferenceAnalysisError ? error.diagnostics : undefined;
            console.warn(`[ReferenceAnalysis] ${JSON.stringify({
              event: "reference_pipeline_failed",
              sourceUrl: referenceUrl,
              phase: referenceFailurePhase,
              errorCategory: diagnostics?.errorCategory || (referenceFailurePhase === "crawl" ? "crawl_error" : "unknown"),
              reason: message,
            })}`);
            const afterReferenceFailure = localProjectStore.getRecord(projectId);
            localProjectStore.update(projectId, {
              conversation: [
                ...(afterReferenceFailure?.conversation || []),
                {
                  author: "agent",
                  message: `Reference website analysis is unavailable: ${message}. Continuing with an original design based on your prompt.`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: referenceFailurePhase === "crawl" ? "crawl_completed" : "visual_analysis_failed",
                    status: "failed",
                    sourceUrl: referenceUrl,
                    ...(referenceFailurePhase === "crawl" ? { durationMs: Date.now() - crawlStartedAt } : {}),
                    source: referenceFailurePhase,
                    error: message,
                    ...(diagnostics ? { referenceAnalysis: diagnostics } : {}),
                  },
                },
              ],
            });
            appendGenerationContext("The optional visual reference could not be analyzed. Create an original, polished design from the user's written prompt without copying or inventing content from the reference URL.");
          }
        }

        // Photography-heavy prompts can receive real, server-resolved image
        // candidates. This is optional by design: missing credentials, empty
        // searches, or provider failures fall through to the design system's
        // explicit CSS/SVG fallback instead of blocking generation.
        try {
          const imageryContext = await resolvePexelsImagery(prompt);
          checkCancelled();
          if (imageryContext) appendGenerationContext(imageryContext);
        } catch (error) {
          const message = safeFailureDetail(error);
          console.warn(`[Pexels] Image sourcing failed; using designed fallbacks: ${message}`);
        }

        // MotionSites-style prompts carry precise layout, motion and art direction.
        // Keep them intact and apply our quality constraints at the model boundary,
        // not to the conversation stored and shown to the user.
        const compactBaseUserContent = userPromptContent;
        userPromptContent = withDesignSystemPrompt(userPromptContent);
        // The compact system prompt already carries the design and platform
        // contract. Repeating the full design manual for small-provider
        // accounts pushes valid requests past their input limits.
        const compactGenerationUserContent = generationContentForCompactProvider(
          compactBaseUserContent,
          compactFollowUpContent,
        );

        // ═══⭐⭐ BUILD CONVERSATION HISTORY FOR THE AI ═════════════════════════
        //
        // Include prior user/agent exchanges so the AI has context about what was
        // previously requested and generated. Without this, every prompt is treated
        // as a brand-new project and the AI generates from scratch.
        const conversationHistory: Array<{ role: string; content: string }> = [];
        if (isFollowUp) {
          for (const msg of priorMessages) {
            // The current message is not part of this immutable pre-run snapshot.
            if (msg.author === "user") {
              conversationHistory.push({ role: "user", content: msg.message });
            }
            // Include agent "finished" summaries so the AI knows what it produced
            else if (msg.author === "agent" && msg.messageType === "finished") {
              conversationHistory.push({ role: "assistant", content: msg.message });
            }
          }
        }

        const systemPromptForRun = isFollowUp
          ? SYSTEM_PROMPT + FOLLOW_UP_SUFFIX
          : SYSTEM_PROMPT;

        const messages = [
          { role: "system", content: systemPromptForRun },
          ...conversationHistory,
          { role: "user", content: userPromptContent },
        ];

        const beforeGeneration = localProjectStore.getRecord(projectId);
        localProjectStore.update(projectId, {
          conversation: [
            ...(beforeGeneration?.conversation || []),
            {
              author: "agent",
              message: "Generating the implementation from the approved project context...",
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: { type: "file_generation_started", status: "started" },
            },
          ],
        });

        const generationStartedAt = Date.now();
        let content: string;
        try {
          const routerResult = await multiModelRouter.complete(
          messages,
          (statusMsg) => {
            if (controller.signal.aborted) return;
            const currentRec = localProjectStore.getRecord(projectId);
            const switchMsg: ConversationMessage = {
              author: "agent",
              message: statusMsg,
              messageType: "building",
              createdAt: new Date().toISOString(),
              generationEvent: { type: "file_generation_started", status: "started" },
            };
            localProjectStore.update(projectId, {
              conversation: [...(currentRec?.conversation || []), switchMsg],
            });
          },
          {
            perProviderTimeoutMs: 150_000,
            totalTimeoutMs: 420_000,
            signal: controller.signal,
            requestLabel: "code_generation",
            providerMessageTransform: (providerId, providerMessages) => (providerId === "above-glm53")
              ? providerMessages.map((message) => message.role === "system"
                ? { ...message, content: COMPACT_SYSTEM_PROMPT }
                : message === providerMessages.at(-1)
                  ? { ...message, content: compactGenerationUserContent }
                  : message)
              : providerMessages,
          }
          );
          checkCancelled();
          recordGenerationModelDiagnostics(projectId, generationId, {
            providerId: routerResult.providerId,
            model: routerResult.usedModel,
            attempts: routerResult.attempts,
            continuationAttempts: routerResult.continuationAttempts,
            failureCategories: routerResult.failureCategories,
            durationMs: routerResult.durationMs,
          });
          content = routerResult.text;
        } catch (error) {
          checkCancelled();
          const partial = recoverableGeneratedPartialText(error);
          if (!partial) throw error;
          console.warn(`[localAgentEngine] Validating ${partial.length} characters of complete file blocks after model interruption`);
          const current = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [...(current?.conversation || []), {
              author: "agent",
              message: "The model response was interrupted. BigBag is validating the completed files and will repair any missing or broken part before showing a preview.",
              messageType: "building",
              createdAt: new Date().toISOString(),
            }],
          });
          recordGenerationModelDiagnostics(projectId, generationId, {
            providerId: "interrupted-response",
            model: "unknown",
            attempts: error instanceof ProviderExhaustedError ? error.attempts : 0,
            continuationAttempts: 0,
            failureCategories: error instanceof ProviderExhaustedError ? [error.category] : [],
            durationMs: Date.now() - generationStartedAt,
          });
          content = partial;
        }
        // Extract files from generated markdown, with auto-retry on failure
        let files = extractFilesFromMarkdown(content);
        postProcessGeneratedFiles(files, availableWorkspaceSources(projectId));
        let finalDeletions = new Set(extractDeletionsFromMarkdown(content).map(normalizeGeneratedPath));
        for (const file of files) finalDeletions.delete(normalizeGeneratedPath(file.path));

        const existingPaths = availableWorkspacePaths(projectId);
        const existingSources = availableWorkspaceSources(projectId);
        const existingEnvironmentExample = workspaceEnvironmentExample(projectId);
        let effectiveExistingEnvironmentExample = finalDeletions.has(".env.example")
          ? undefined
          : existingEnvironmentExample;
        const initialGeneration = !isFollowUp;
        const explicitlyRequestedSeedData = [record.description || "", ...priorMessages
          .filter((message) => message.author === "user")
          .map((message) => message.message), prompt]
          .reduce((permitted, request) => seedRecordIntent(request) ?? permitted, false);
        const explicitlyRequestedAuthentication = promptRequestsAuthentication(prompt);
        const requireCommerceRole = Boolean(record.commerceEnabled || enableCommerce);
        const requireAuthentication = explicitlyRequestedAuthentication || promptRequestsAuthentication(record.description || "") ||
          requireCommerceRole || Boolean(sharedCatalogCollections?.length);
        const allowAuthentication = !initialGeneration || requireAuthentication || requireCommerceRole;
        const requirePersistence = enablePrivateFiles || promptRequestsPersistence(prompt) || promptRequestsPersistence(record.description || "") ||
          Boolean(sharedCatalogCollections?.length);
        let effectiveExistingPaths = existingPaths.filter((entry) => !finalDeletions.has(entry));
        let validationIssues = generationValidationIssues(files, effectiveExistingPaths, {
          requireEntrypoint: initialGeneration,
          requireEntrypointFirst: initialGeneration,
          existingEnvironmentExample: effectiveExistingEnvironmentExample,
          existingSources: existingSources.filter((file) => !finalDeletions.has(file.path)),
          allowSeedData: explicitlyRequestedSeedData,
          allowAuthentication,
          requirePersistence,
          requireAuthentication,
          requireCommerceRole,
        });

        // Auto-retry incomplete or disconnected output before it touches the workspace.
        for (
          let retryAttempt = 1;
          validationIssues.length > 0 && retryAttempt <= MAX_STATIC_VALIDATION_RETRIES;
          retryAttempt += 1
        ) {
          console.log(`[localAgentEngine] Static validation attempt ${retryAttempt} required: ${validationIssues.join("; ")}`);
          const currentRecRetry = localProjectStore.getRecord(projectId);
          localProjectStore.update(projectId, {
            conversation: [
              ...(currentRecRetry?.conversation || []),
              {
                author: "agent",
                message: `Correcting generated files before build (${retryAttempt} of ${MAX_STATIC_VALIDATION_RETRIES})...`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              },
            ],
          });

          const repairSources = [
            ...files,
            ...existingSources.filter((file) =>
              !files.some((generated) => normalizeGeneratedPath(generated.path) === normalizeGeneratedPath(file.path)) &&
              !finalDeletions.has(normalizeGeneratedPath(file.path))
            ),
          ];
          const extractedContext = validationRepairContext(repairSources, validationIssues, 200_000);
          const fullContextComplete = repairContextIncludesAffectedFiles(repairSources, validationIssues, extractedContext);
          try {
            const retryResult = await multiModelRouter.complete(
              [
                { role: "system", content: STATIC_REPAIR_SYSTEM_PROMPT },
                { role: "user", content: `Original request: ${prompt}` },
                { role: "assistant", content: extractedContext },
                {
                  role: "user",
                  content: `${RETRY_PROMPT}\n\nValidation pass ${retryAttempt} failed:\n- ${validationIssues.join("\n- ")}`,
                },
              ],
              () => {},
              {
                signal: controller.signal,
                perProviderTimeoutMs: 180_000,
                totalTimeoutMs: 300_000,
                requestLabel: "code_repair",
                providerMessageTransform: (_providerId, providerMessages) =>
                  fullContextComplete ? providerMessages : null,
              }
            );
            checkCancelled();
            const retryFiles = extractFilesFromMarkdown(retryResult.text);
            postProcessGeneratedFiles(retryFiles, existingSources);
            const mergedActions = mergeGeneratedActions(
              files,
              finalDeletions,
              retryFiles,
              extractDeletionsFromMarkdown(retryResult.text)
            );
            files = mergedActions.files;
            finalDeletions = mergedActions.deletions;
            effectiveExistingEnvironmentExample = finalDeletions.has(".env.example")
              ? undefined
              : existingEnvironmentExample;
            postProcessGeneratedFiles(files, existingSources);
            effectiveExistingPaths = existingPaths.filter((entry) => !finalDeletions.has(entry));
            validationIssues = generationValidationIssues(files, effectiveExistingPaths, {
              requireEntrypoint: initialGeneration,
              requireEntrypointFirst: initialGeneration,
              existingEnvironmentExample: effectiveExistingEnvironmentExample,
              existingSources: existingSources.filter((file) => !finalDeletions.has(file.path)),
              allowSeedData: explicitlyRequestedSeedData,
              allowAuthentication,
              requirePersistence,
              requireAuthentication,
              requireCommerceRole,
            });
            if (validationIssues.length === 0) {
              console.log(`[localAgentEngine] Static correction succeeded with ${retryFiles.length} replacement files`);
            }
          } catch (retryError) {
            checkCancelled();
            console.error(`[localAgentEngine] Static correction request failed: ${safeFailureDetail(retryError)}`);
            break;
          }
        }

        assertUsableGeneratedFiles(
          files,
          "generation",
          effectiveExistingPaths,
          effectiveExistingEnvironmentExample,
          existingSources.filter((file) => !finalDeletions.has(file.path)),
          explicitlyRequestedSeedData,
          allowAuthentication,
          requirePersistence,
          requireAuthentication,
          requireCommerceRole
        );

        const currentRec = localProjectStore.getRecord(projectId);
        const newMessages: ConversationMessage[] = [...(currentRec?.conversation || [])];

        for (const file of files) {
          checkCancelled();
          const existedBeforeWrite = Boolean(localFileManager.getContent(projectId, file.path));
          let fileContent = file.content;

          if (file.path.endsWith(".css")) {
            fileContent = sanitizeOrphanedCssProperties(stripGeneratedApplyRules(fileContent));
          }

          if (file.path.endsWith("globals.css") || file.path.endsWith("global.css") || file.path === "src/index.css") {
            fileContent = fixCssImportOrder(fileContent);
          }

          localFileManager.writeContent(projectId, file.path, fileContent, "utf8");
          console.log(`[localAgentEngine] Wrote ${file.path} (${fileContent.length} bytes)`);

          newMessages.push({
            author: "agent",
            message: `${existedBeforeWrite ? "Updated" : "Created"} file \`${file.path}\``,
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: {
              type: existedBeforeWrite ? "file_updated" : "file_created",
              status: "completed",
              path: file.path,
              source: "generator",
            },
          });
          localProjectStore.update(projectId, { conversation: newMessages });
        }

        for (const delPath of finalDeletions) {
          checkCancelled();
          if (localFileManager.deleteFile(projectId, delPath)) {
            newMessages.push({
              author: "agent",
              message: `Deleted file \`${delPath}\``,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
          }
        }

        purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));

        // Add detected dependencies to this generated app and install if missing
        const allFiles = files.length > 0 ? [...files] : [];
        const existingEntryForDeps =
          localFileManager.getContent(projectId, "src/app/page.tsx") ||
          localFileManager.getContent(projectId, "src/App.tsx");
        if (existingEntryForDeps?.content && !allFiles.some((f) => f.path.includes("page.tsx") || f.path.includes("App.tsx"))) {
          allFiles.push({ path: existingEntryForDeps.path, content: existingEntryForDeps.content });
        }
        let dependencyError: unknown;
        if (allFiles.length > 0) {
          try {
            const depResult = await ensureWorkspaceDependencies(
              allFiles,
              localProjectStore.getWorkspaceDir(projectId),
              controller.signal
            );
            if (depResult.added.length > 0) {
              newMessages.push({
                author: "agent",
                message: `Added dependencies: ${depResult.added.join(", ")}`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
            if (depResult.installed.length > 0) {
              newMessages.push({
                author: "agent",
                message: `Installed packages: ${depResult.installed.join(", ")}`,
                messageType: "building",
                createdAt: new Date().toISOString(),
              });
            }
          } catch (depErr) {
            dependencyError = depErr;
          }
        }

        newMessages.push({
          author: "agent",
          message: "Validating the generated app and preparing its live preview...",
          messageType: "building",
          createdAt: new Date().toISOString(),
          generationEvent: { type: "build_started", status: "started" },
        });
        newMessages.push({
          author: "agent",
          message: "Running generated-source, type, and production build validation...",
          messageType: "building",
          createdAt: new Date().toISOString(),
          generationEvent: { type: "validation_started", status: "started", source: "build" },
        });
        newMessages.push({
          author: "agent",
          message: "Starting the preview only after validation succeeds...",
          messageType: "building",
          createdAt: new Date().toISOString(),
          generationEvent: { type: "preview_started", status: "started", source: "runtime" },
        });
        localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });

        const recoverPreviewInfrastructure = async (
          initialError: unknown,
          recoveredMessage: string,
          deferRepeatedResourceFailure = false
        ): Promise<void> => {
          let infrastructureError = initialError;
          const maxInfrastructureRetries = isBuildResourceFailure(initialError)
            ? MAX_BUILD_RESOURCE_RETRIES
            : MAX_PREVIEW_INFRASTRUCTURE_RETRIES;
          for (let attempt = 1; attempt <= maxInfrastructureRetries; attempt += 1) {
            newMessages.push({
              author: "agent",
              message: `Preview infrastructure failed. Retrying startup (${attempt} of ${maxInfrastructureRetries}) without changing your source...`,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });
            try {
              checkCancelled();
              const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
              checkCancelled();
              newMessages.push({
                author: "agent",
                message: "Production build completed successfully after infrastructure recovery.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "build_completed", status: "completed" },
              });
              newMessages.push({
                author: "agent",
                message: "Validation and preview startup succeeded after infrastructure recovery.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "validation_completed", status: "completed", source: "infrastructure" },
              });
              newMessages.push({
                author: "agent",
                message: "Live preview is ready.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
              });
              newMessages.push({
                author: "agent",
                message: recoveredMessage,
                messageType: "finished",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "generation_completed", status: "completed" },
              });
              localProjectStore.update(projectId, {
                status: "done",
                commerceEnabled: Boolean(record.commerceEnabled || enableCommerce),
                privateFilesEnabled: enablePrivateFiles,
                sharedCatalogCollections,
                conversation: newMessages,
                previewUrl: /^https?:\/\//.test(previewUrl) ? previewUrl : persistentPreviewPath(projectId),
                serverStatus: "Active",
                requiresEndUserAuth: workspaceRequiresEndUserAuth(projectId),
              });
              return;
            } catch (retryError) {
              checkCancelled();
              infrastructureError = retryError;
              console.error(`[localAgentEngine] Preview infrastructure retry ${attempt} failed: ${safeFailureDetail(retryError)}`);
            }
          }

          checkCancelled();
          if (deferRepeatedResourceFailure && isBuildResourceFailure(infrastructureError)) {
            throw infrastructureError;
          }
          if (hadValidatedPreview && previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
          // Local preview URLs point to an ephemeral process that the failed
          // rebuild may have stopped. Only the durable preview route can be
          // reused without another readiness check.
          let restoredPreviewUrl = priorDeployment?.previewUrl === persistentPreviewPath(projectId)
            ? priorDeployment.previewUrl
            : undefined;
          if (!restoredPreviewUrl && hadValidatedPreview && !isBuildResourceFailure(initialError) && previousWorkspace) {
            try {
              restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
            } catch (restoreError) {
              checkCancelled();
              console.error(`[localAgentEngine] Previous preview restore failed after infrastructure error: ${safeFailureDetail(restoreError)}`);
            }
          }
          if (restoredPreviewUrl && priorDeployment) {
            localProjectStore.update(projectId, {
              deployment: priorDeployment.deployment,
              productionProjectUrl: priorDeployment.productionProjectUrl,
              previewUrl: restoredPreviewUrl,
              serverStatus: "Active",
            });
          }
          const failureMessage = isBuildResourceFailure(infrastructureError)
            ? "The sandbox ran out of memory during the production build (exit 137). The generated source was not marked successful; a larger build sandbox is required."
            : `Preview infrastructure could not validate the application: ${safeFailureDetail(infrastructureError)}`;
          newMessages.push({
            author: "agent",
            message: failureMessage,
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: {
              type: "preview_failed",
              status: "failed",
              source: "infrastructure",
              error: failureMessage,
            },
          });
          newMessages.push({
            author: "agent",
            message: restoredPreviewUrl ? `${failureMessage} The previous validated preview remains available.` : failureMessage,
            messageType: "error",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "generation_failed", status: "failed", source: "infrastructure", error: failureMessage },
          });
          localProjectStore.update(projectId, {
            status: "done",
            conversation: newMessages,
            previewUrl: restoredPreviewUrl,
            serverStatus: restoredPreviewUrl ? "Active" : "Error",
          });
        };

        // Compile before success is shown. This is the reliability boundary that
        // prevents a model response from becoming a broken user-facing preview.
        try {
          checkCancelled();
          if (dependencyError) throw dependencyError;
          const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
          checkCancelled();
          console.log(`[localAgentEngine] Disposable build passed and persistent preview deployed for ${projectId}`);

          newMessages.push({
            author: "agent",
            message: "Production validation completed successfully.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "build_completed", status: "completed" },
          });
          newMessages.push({
            author: "agent",
            message: "Generated source, TypeScript, production build, and preview server validation passed.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "validation_completed", status: "completed", source: "build" },
          });
          newMessages.push({
            author: "agent",
            message: "Live preview is ready.",
            messageType: "building",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
          });

          newMessages.push({
            author: "agent",
            message: `All done. Generated ${files.length || 1} files, verified the build, and deployed the live preview.`,
            messageType: "finished",
            createdAt: new Date().toISOString(),
            generationEvent: { type: "generation_completed", status: "completed" },
          });
          localProjectStore.update(projectId, {
            status: "done",
            commerceEnabled: Boolean(record.commerceEnabled || enableCommerce),
            privateFilesEnabled: enablePrivateFiles,
            sharedCatalogCollections,
            conversation: newMessages,
            previewUrl: /^https?:\/\//.test(previewUrl) ? previewUrl : persistentPreviewPath(projectId),
            serverStatus: "Active",
            requiresEndUserAuth: workspaceRequiresEndUserAuth(projectId),
          });
        } catch (sandboxErr) {
          checkCancelled();
          console.error(`[localAgentEngine] Sandbox startup failed: ${safeFailureDetail(sandboxErr)}`);

          // Provisioning, persistence, dependency installation and preview
          // readiness failures do not prove the generated source is wrong. Retry
          // the real startup operation without asking a model to rewrite code.
          // A production-build exit 137 proves resource pressure, not a source
          // defect. Retry the exact durable source through preview recovery and
          // never ask a model to mutate working code without a source diagnostic.
          let repairError: unknown = sandboxErr;
          if (!isSourceBuildFailure(sandboxErr)) {
            try {
              await recoverPreviewInfrastructure(
                sandboxErr,
                "Application generated and verified after the preview infrastructure recovered.",
                isBuildResourceFailure(sandboxErr)
              );
              return;
            } catch (repeatedResourceError) {
              checkCancelled();
              if (!isBuildResourceFailure(repeatedResourceError)) throw repeatedResourceError;
              repairError = repeatedResourceError;
              console.error(`[localAgentEngine] Resource failure persisted after unchanged-source retry; entering targeted dependency repair: ${safeFailureDetail(repeatedResourceError)}`);
            }
          }
          let repaired = false;

          for (let attempt = 1; attempt <= MAX_BUILD_REPAIR_ATTEMPTS; attempt += 1) {
            checkCancelled();
            const attemptSnapshot = snapshotWorkspace(projectId);
            const strategy = isBuildResourceFailure(repairError)
              ? "Remove or replace memory-heavy optional dependencies with lightweight React, CSS, SVG, or native browser code while preserving the requested behavior."
              : BUILD_REPAIR_STRATEGIES[attempt - 1];
            const buildError = repairError instanceof Error ? repairError.message : String(repairError);
            newMessages.push({
              author: "agent",
              message: `Build validation failed. Running repair attempt ${attempt} of ${MAX_BUILD_REPAIR_ATTEMPTS}: ${strategy}`,
              messageType: "building",
              createdAt: new Date().toISOString(),
            });
            localProjectStore.update(projectId, { conversation: newMessages, serverStatus: "Starting" });

            try {
              const repairRequest = `The generated app failed real production validation. Repair the implementation and return ONLY complete corrected file blocks. Never use @apply in CSS. Preserve every working feature and do not report success; the platform will rebuild and verify it.\n\nRepair strategy for this attempt:\n${strategy}\n\nOriginal request:\n${prompt}\n\nLatest validation error:\n${buildError}\n\nCurrent source (files named by the error are first):\n`;
              const fullBuildContext = workspaceRepairContext(projectId, buildError);
              const buildSources = availableWorkspaceSources(projectId);
              const fullBuildContextComplete = repairContextIncludesAffectedFiles(buildSources, [buildError], fullBuildContext);
              const repairResult = await multiModelRouter.complete(
                [
                  {
                    role: "system",
                    content: `${STATIC_REPAIR_SYSTEM_PROMPT}\n\nBUILD REPAIR MODE: The workspace already contains a complete application. Use only the reported compiler, dependency, build, or preview error and the supplied source. For a dependency failure, replace that import with installed packages or browser APIs. DashboardShell accepts navItems ({ label, href or onClick, icon }), brand, userName, actions, pageTitle, and children; it has no links, onNavigate, session, or onSignOut props. Preserve every other file unchanged.`,
                  },
                  {
                    role: "user",
                    content: repairRequest + fullBuildContext,
                  },
                ],
                () => undefined,
                {
                  signal: controller.signal,
                  perProviderTimeoutMs: 180_000,
                  totalTimeoutMs: 300_000,
                  requestLabel: "code_repair",
                  providerMessageTransform: (_providerId, providerMessages) =>
                    fullBuildContextComplete ? providerMessages : null,
                }
              );
              checkCancelled();
              const repairFiles = extractFilesFromMarkdown(repairResult.text);
              postProcessGeneratedFiles(repairFiles, availableWorkspaceSources(projectId));
              const repairDeletions = new Set(
                extractDeletionsFromMarkdown(repairResult.text).map(normalizeGeneratedPath)
              );
              for (const file of repairFiles) repairDeletions.delete(normalizeGeneratedPath(file.path));
              const repairExistingPaths = availableWorkspacePaths(projectId)
                .filter((entry) => !repairDeletions.has(entry));
              const replacementEnvironmentExample = repairFiles.find(
                (file) => normalizeGeneratedPath(file.path) === ".env.example"
              )?.content;
              const repairEnvironmentExample = replacementEnvironmentExample ??
                (repairDeletions.has(".env.example")
                  ? undefined
                  : workspaceEnvironmentExample(projectId));
              assertUsableGeneratedFiles(
                repairFiles,
                "repair",
                repairExistingPaths,
                repairEnvironmentExample,
                availableWorkspaceSources(projectId).filter(
                  (file) => !repairDeletions.has(file.path)
                ),
                explicitlyRequestedSeedData,
                allowAuthentication,
                requirePersistence,
                requireAuthentication,
                requireCommerceRole
              );

              for (const file of repairFiles) {
                checkCancelled();
                const existedBeforeRepair = Boolean(localFileManager.getContent(projectId, file.path));
                let fileContent = file.content;
                if (file.path.endsWith(".css")) fileContent = sanitizeOrphanedCssProperties(stripGeneratedApplyRules(fileContent));
                if (file.path.endsWith("globals.css") || file.path.endsWith("global.css") || file.path === "src/index.css") {
                  fileContent = fixCssImportOrder(fileContent);
                }
                localFileManager.writeContent(projectId, file.path, fileContent, "utf8");
                newMessages.push({
                  author: "agent",
                  message: `${existedBeforeRepair ? "Updated" : "Created"} file \`${file.path}\` during repair`,
                  messageType: "building",
                  createdAt: new Date().toISOString(),
                  generationEvent: {
                    type: existedBeforeRepair ? "file_updated" : "file_created",
                    status: "completed",
                    path: file.path,
                    source: "generator",
                  },
                });
                localProjectStore.update(projectId, { conversation: newMessages });
              }
              for (const deletedPath of repairDeletions) {
                localFileManager.deleteFile(projectId, deletedPath);
              }
              purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
              await ensureWorkspaceDependencies(repairFiles, localProjectStore.getWorkspaceDir(projectId), controller.signal);

              let previewUrl: string;
              try {
                previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
                checkCancelled();
              } catch (deploymentError) {
                if (isSourceBuildFailure(deploymentError)) throw deploymentError;
                console.error(`[localAgentEngine] Repair attempt ${attempt} reached preview infrastructure failure: ${safeFailureDetail(deploymentError)}`);
                await recoverPreviewInfrastructure(
                  deploymentError,
                  `Application generated, repaired on attempt ${attempt}, and verified after the preview infrastructure recovered.`,
                  isBuildResourceFailure(deploymentError)
                );
                repaired = true;
                break;
              }
              newMessages.push({
                author: "agent",
                message: "Production build completed successfully after repair.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "build_completed", status: "completed" },
              });
              newMessages.push({
                author: "agent",
                message: "Production validation completed successfully after repair.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "validation_completed", status: "completed", source: "build" },
              });
              newMessages.push({
                author: "agent",
                message: "Live preview is ready.",
                messageType: "building",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "preview_ready", status: "completed", source: "runtime" },
              });
              newMessages.push({
                author: "agent",
                message: `All done. The application was repaired on attempt ${attempt} and verified in the live preview.`,
                messageType: "finished",
                createdAt: new Date().toISOString(),
                generationEvent: { type: "generation_completed", status: "completed" },
              });
              localProjectStore.update(projectId, {
                status: "done",
                commerceEnabled: Boolean(record.commerceEnabled || enableCommerce),
                privateFilesEnabled: enablePrivateFiles,
                sharedCatalogCollections,
                conversation: newMessages,
                previewUrl: /^https?:\/\//.test(previewUrl) ? previewUrl : persistentPreviewPath(projectId),
                serverStatus: "Active",
                requiresEndUserAuth: workspaceRequiresEndUserAuth(projectId),
              });
              repaired = true;
              break;
            } catch (attemptError) {
              checkCancelled();
              const sameFailure = safeFailureDetail(attemptError) === safeFailureDetail(repairError);
              const incompleteRepair = safeFailureDetail(attemptError).includes("The AI repair was incomplete");
              if (sameFailure || incompleteRepair) restoreWorkspace(projectId, attemptSnapshot);
              else repairError = attemptError;
              console.error(`[localAgentEngine] Repair attempt ${attempt} failed: ${safeFailureDetail(attemptError)}`);
            }
          }

          if (!repaired) {
            checkCancelled();
            if (hadValidatedPreview && previousWorkspace) restoreWorkspace(projectId, previousWorkspace);

            let restoredPreviewUrl: string | undefined;
            if (hadValidatedPreview) {
              try {
                restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
              } catch (restoreError) {
                checkCancelled();
                console.error(`[localAgentEngine] Previous preview restore failed: ${safeFailureDetail(restoreError)}`);
              }
            }

            const blockingError = safeFailureDetail(repairError);
            newMessages.push({
              author: "agent",
              message: `Automatic repair stopped after ${MAX_BUILD_REPAIR_ATTEMPTS} attempts. Blocking validation error: ${blockingError}. ${restoredPreviewUrl ? "The previous verified preview is still available." : "The generated source was retained for a targeted follow-up repair; no preview is marked ready."}`,
              messageType: "error",
              createdAt: new Date().toISOString(),
              generationEvent: {
                type: "generation_failed",
                status: "failed",
                source: "build",
                error: blockingError,
              },
            });
            localProjectStore.update(projectId, {
              status: "done",
              conversation: newMessages,
              previewUrl: restoredPreviewUrl,
              serverStatus: restoredPreviewUrl ? "Active" : "Error",
            });
          }
        }
      } catch (err: any) {
        if (controller.signal.aborted || err instanceof GenerationCancelledError || localProjectStore.getRecord(projectId)?.cancellationRequestedAt) {
          if (previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
          if (priorDeployment) localProjectStore.update(projectId, {
            deployment: priorDeployment.deployment,
            previewUrl: priorDeployment.previewUrl,
            productionProjectUrl: priorDeployment.productionProjectUrl,
            serverStatus: "Active",
          });
          return;
        }
        console.error(`[localAgentEngine error] ${safeFailureDetail(err)}`);
        if (hadValidatedPreview && previousWorkspace) restoreWorkspace(projectId, previousWorkspace);
        let restoredPreviewUrl: string | undefined;
        if (hadValidatedPreview) {
          try {
            restoredPreviewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true, signal: controller.signal });
          } catch (restoreError) {
            console.error(`[localAgentEngine] Could not restore previous preview: ${safeFailureDetail(restoreError)}`);
          }
        }
        const current = localProjectStore.getRecord(projectId);
        const blockingError = safeFailureDetail(err);
        const errorMsg: ConversationMessage = {
          author: "agent",
          message: `Generation stopped after automatic corrections. Blocking error: ${blockingError}. ${restoredPreviewUrl ? "The previous verified preview remains available." : "No preview is marked ready."}`,
          messageType: "error",
          createdAt: new Date().toISOString(),
          generationEvent: {
            type: "generation_failed",
            status: "failed",
            error: blockingError,
            source: "generator",
          },
        };
        localProjectStore.update(projectId, {
          status: "done",
          conversation: [...(current?.conversation || []), errorMsg],
          previewUrl: restoredPreviewUrl,
          serverStatus: restoredPreviewUrl ? "Active" : "Error",
        });
      }
    });

    sharedAgentRunState.runs.set(projectId, run);
    const clearRun = () => {
      if (sharedAgentRunState.runs.get(projectId) === run) {
        sharedAgentRunState.runs.delete(projectId);
      }
      if (sharedAgentRunState.controllers.get(projectId)?.generationId === generationId) sharedAgentRunState.controllers.delete(projectId);
      void localProjectStore.flush(projectId).catch((error) => {
        console.error(`[localAgentEngine] Final project persistence failed for ${projectId}: ${safeFailureDetail(error)}`);
      });
    };
    void run.then(clearRun, clearRun);
  },

  async cancelPrompt(projectId: string, generationId?: string): Promise<boolean> {
    const record = localProjectStore.getRecord(projectId);
    const currentGenerationId = record?.activeGenerationId;
    if (!record || record.status !== "init" || !currentGenerationId ||
        (generationId && generationId !== currentGenerationId)) return false;
    const currentRun = sharedAgentRunState.controllers.get(projectId);
    if (currentRun?.generationId !== currentGenerationId) return false;
    localProjectStore.update(projectId, { cancellationRequestedAt: new Date().toISOString() });
    currentRun.controller.abort(new GenerationCancelledError());
    await e2bSandboxManager.cancelBuild(projectId);
    const latest = localProjectStore.getRecord(projectId);
    if (latest?.activeGenerationId !== currentGenerationId) return false;
    localProjectStore.update(projectId, {
      status: "done",
      conversation: [...latest.conversation, {
        author: "agent",
        message: "Generation stopped. No further files, build, or preview will be started.",
        messageType: "finished",
        createdAt: new Date().toISOString(),
        generationEvent: { type: "generation_cancelled", status: "cancelled", generationId: currentGenerationId },
      }],
    });
    await localProjectStore.flush(projectId);
    // Wait for the aborted worker to restore its previous source before the UI
    // confirms Stop or allows another generation to enter this workspace.
    await sharedAgentRunState.runs.get(projectId);
    await localProjectStore.flush(projectId);
    return true;
  },
};

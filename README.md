<div align="center">

# 🪄 bigbag-vibe-coding

### Type a prompt, get a working full-stack **Next.js** app — hosted, with a database, auth, a visual editor, GitHub sync, Figma and custom domains already built in.

**A free, self-hosted, white-label alternative to [v0](https://v0.dev), [Lovable](https://lovable.dev), [Bolt](https://bolt.new) and [Replit](https://replit.com).**
Run it for yourself, or put an AI app builder inside your own product.

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#-license)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

[**🚀 Quick Start**](#-quick-start) · [**🧩 Put it in your product**](#-put-it-inside-your-own-product) · [**☁️ Deploy**](#️-deploy-it) · [**📚 Docs**](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding) · [**⭐ Star this repo**](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding)

<br/>

<img src=".github/assets/ai_app_builder_open_demo.gif" alt="Demo: typing a prompt and watching the AI build, preview and deploy a full-stack Next.js app" width="90%" />

*From prompt to deployed app — live preview, code editor, database and deploy, all in one place.*

</div>

---

## What is this?

A ready-to-run AI app builder, open source under MIT.

A user types what they want, for example *"a CRM with kanban boards and Stripe billing"*. The AI builds a real full-stack **Next.js** app, shows it live in the browser, and publishes it to a public URL when the user is happy.

Everything a builder like this normally needs is already handled:

- **The hard part is done by the [BigBag AI Engine](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/api/overview).** BigBag runs the AI agent that writes the code, and hosts every generated app with its database, file storage, SSL, CDN, deploys and custom domains. One API key gives you all of it.
- **This repo is the product on top.** It is the user interface: the prompt box, the live preview, the code editor, the visual editor, the database browser, the logs, the version history and everything else you see in the demo.

> **In one sentence:** clone this repo, paste one API key, and you have your own AI app builder running in minutes, for yourself or for your customers.

---

## 🌟 Who is it for?

| You are… | What you get |
| --- | --- |
| 🧑‍💻 **A builder or indie hacker** | Your own free, self-hosted v0 / Lovable / Bolt alternative. Prompt → deployed app. |
| 🏢 **A SaaS or software company** | Let *your* users build full-stack apps inside *your* product, without building the infrastructure. |
| 🎨 **An agency or no-code team** | Ship client apps faster, under your own brand. |
| 🧪 **Curious, not technical** | No servers to manage. One key, and everything works. |

---

## ✨ What it does

All of this works with **one API key**. No other cloud accounts, no glue code:

- 🤖 **Prompt → full-stack app.** Describe an app in plain English and the AI agent builds a complete Next.js project.
- 👀 **Live preview.** Watch the running app update while the agent works.
- 🖱️ **Visual editor.** Click any element in the preview and change its text, size, colours or image. The change is written back to the exact file and line, and the app rebuilds.
- 🧑‍💻 **Code editor.** A Monaco (VS Code) editor to read and edit every generated file. Save, rebuild, done.
- 🗄️ **Database.** Every app gets a real database. Browse, query and edit its records from the UI.
- 🔐 **Secrets and environment variables.** Managed per project and per environment.
- 🚀 **Hosting and one-click deploy.** Every project has a live URL. Publish to production in one click.
- 🌐 **Custom domains.** Attach your own domain with guided DNS setup and watch it go live.
- 🔗 **GitHub sync.** Connect a repo and push or pull changes in both directions.
- 🎨 **Figma.** Paste a Figma frame link in the chat and the agent builds from the design.
- 📦 **Export, import and duplicate projects.** Package a whole project into an import code, restore it, or clone it in one action.
- 🕓 **Version history.** Every AI build is a restorable checkpoint, with a diff viewer showing exactly what changed.
- 📜 **Logs.** Read runtime logs from the preview server and from production.
- 🧱 **Isolated sandboxes.** Each project runs in its own environment. A sleeping one wakes on demand, and the UI tells the user instead of failing silently.
- 🏢 **Multi-tenant.** Create isolated projects per user or per customer with no extra work.
- 🌍 **Deploy anywhere.** Vercel, Docker, or any Node.js host.

---

## 🚀 Quick Start

You can have it running locally in about three minutes.

### 1. Clone and install

```bash
git clone https://github.com/codewithumesh00-sketch/bigbag-vibe-coding.git
cd ai-app-builder-open
npm install
```

### 2. Configure Environment

Create a `.env.local` file in the project root:

```bash
ORCHESTRATOR_MODE=local
SANDBOX_PROVIDER=e2b

# Gemini is primary; Telnyx GLM-5.3-Flash is the automatic fallback:
GEMINI_API_KEY=your_gemini_api_key
TELNYX_API_KEY=your_telnyx_api_key

# Fast chat and planning tier:
GROQ_API_KEY=your_groq_api_key
GLM_API_KEY=your_zhipu_bigmodel_api_key

E2B_API_KEY=your_e2b_api_key
FIRECRAWL_API_KEY=your_firecrawl_api_key
# Optional: licensed image candidates for image-forward websites
PEXELS_API_KEY=your_pexels_api_key
SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

### 3. Run it

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**, type what you want to build, and watch it happen. 🎉

**Requirements:** [Node.js](https://nodejs.org) 20.19+ and npm.

---

## ⚙️ Environment variables

| Variable | Required | What it is |
| --- | :---: | --- |
| `ORCHESTRATOR_MODE` | ⬜ Optional | Set to `local` to use the built-in multi-model local orchestrator. |
| `SANDBOX_PROVIDER` | ⬜ Optional | Sandbox runtime (`local` or `e2b`). |
| `GEMINI_API_KEY` | ⬜ Optional | Google Gemini API key for code generation (`gemini-2.5-flash`). |
| `TELNYX_API_KEY` | ⬜ Optional | Telnyx API key for fallback inference (`zai-org/GLM-5.3-Flash`). |
| `GROQ_API_KEY` | ⬜ Optional | Primary fast provider for chat, implementation planning, and plan refinement. |
| `GLM_API_KEY` | ⬜ Optional | Zhipu BigModel fallback for chat and planning (`GLM-4.7-Flash`, then `glm-4.5-flash`). |
| `E2B_API_KEY` | ✅ E2B mode | Disposable coding/build sandboxes. Hobby's one-hour maximum is supported. |
| `FIRECRAWL_API_KEY` | ⬜ URL prompts | Extracts branding, layout, typography, imagery and responsive design facts before generation. |
| `PEXELS_API_KEY` | ⬜ Image prompts | Supplies licensed, theme-specific image candidates to image-forward generations; absent/failed searches use designed CSS/SVG fallbacks. |
| `SUPABASE_DATABASE_URL` | ✅ Local orchestrator | Supabase PostgreSQL storage for durable metadata, generated source, and compiled preview artifacts. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Supabase SDK | Server-only secret key for Supabase administrative operations (bypasses RLS). |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Supabase client | Public URL for Supabase API endpoints. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Supabase client | Public anonymous key for client-side queries (enforces RLS). |
| `TENANT_COOKIE_SECRET` | ✅ Production | Dedicated random secret used only to sign anonymous tenant cookies. |
| `VCAAS_OPERATOR_UIDS` | ✅ Cloud mode | Comma-separated operator user IDs allowed to use the single cloud operator credential. |
| `NEXT_PUBLIC_APP_URL` | ⬜ Optional | The public URL of your deployment, e.g. `https://your-domain.com`. |

### E2B and persistent Render previews

E2B is a disposable build worker, not a host. Before a sandbox is created, the complete generated project is saved to Supabase PostgreSQL. A successful build is health-checked inside E2B, copied back to Supabase, and served by this existing Render web service at the stable path `/api/preview/<projectId>/`; the E2B sandbox is then destroyed. Returning later restores the saved source into a fresh sandbox, rebuilds it, and replaces the deployed artifact without changing the preview URL.

Prompts containing a public website URL are analyzed by Firecrawl first. Only design facts are supplied to the generator, with instructions to create original React code and avoid copying proprietary source or unnecessary content.

To start from the example file:

```bash
cp .env.example .env.local
```

> 🔒 **Security:** the API key is only read in `src/lib/vcaas-server.ts`, which never ships to the browser. It is deliberately **not** a `NEXT_PUBLIC_` variable.

---

## ☁️ Deploy it

This is a standard Next.js app with no platform lock-in. It runs wherever Next.js runs.

> ### Authentication setup
>
> The builder includes Supabase Google sign-in and signed HttpOnly sessions. Configure
> `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, enable Google in Supabase
> Authentication (Providers -> Google), add your Supabase callback URI to Google Cloud OAuth,
> and set a strong private `TENANT_COOKIE_SECRET`.

### Vercel, one click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/codewithumesh00-sketch/bigbag-vibe-coding)

Import the repo, configure your model keys under **Environment Variables**, and deploy.

### Any Node.js host (VM, Docker, Railway, Render, Fly.io…)

```bash
npm run build
npm start          # serves on $PORT (default 3000)
```

Set your model environment variables in the host's environment and point your process manager or container at `npm start`.

---

## 🧩 Put it inside your own product

This is not only a standalone tool. It is a drop-in AI app-builder layer for a SaaS you are launching or already run.

- 🏢 **Multi-tenant by design.** Every generated app is an isolated BigBag project. Create one per user, team or customer.
- 🎨 **White-label.** It is your codebase and your UI. Rebrand it, restyle it, embed it in your dashboard.
- 🔌 **One integration.** A single API key gives your users hosting, databases, AI, domains, GitHub and sandboxes. You do not stitch together five vendors.
- 📈 **A new revenue stream.** Resell app building, hosting or premium AI credits on top of your product.

> **The pitch to your customers:** *"Build and ship a full-stack app right here, inside our platform."*

> ⚠️ **Before reselling cloud mode, read `src/app/api/vcaas/_shared.ts`.** Supabase protects the builder and local projects are tenant-scoped, but one cloud operator key still needs an upstream user-to-project ownership map and billing controls.

### Two ways to integrate

- **Run it beside your product.** Deploy it on a subdomain, configure Supabase Google sign-in, rebrand it, and link or iframe to it. Hours, not weeks.
- **Port the flow into your stack.** Keep the contract, not the UI: a server-side proxy that adds the `api-key` header, then `launch` → poll agent status → show the preview URL → follow-up prompts → deploy. One BigBag project per customer, ownership checked on every proxied call. The step-by-step version, with the exact files to mirror, is in [`AGENTS.md`](AGENTS.md#adding-an-ai-app-builder-to-an-existing-product-any-stack).

### Use it as a boilerplate: login + payments

Want to ship this as your own product? Supabase Google sign-in, Supabase PostgreSQL, and local tenant isolation are included. Add **Stripe** for payments if desired. The concrete checklist is in [`AGENTS.md`](AGENTS.md#boilerplate-mode-optional-supabase-migration-and-stripe-payments).

---

## 🔐 Auth, database and third-party providers

Two different things live here, and it is worth keeping them apart:

- **The apps the AI builds for you** come with a managed database, hosting, auth and everything else they need to run — all provided by the BigBag AI Engine. Nothing to install.
- **This builder UI itself** uses Supabase Google sign-in and a server-verified signed session. Payment remains optional; the step-by-step for billing or replacing the auth/data layer is in [`AGENTS.md`](AGENTS.md#boilerplate-mode-optional-supabase-migration-and-stripe-payments):

  - **Auth**: Supabase Auth, Better Auth, Clerk, Auth0 or your own.
  - **Payments**: Stripe, or any provider — for credit packs or plans.
  - **Database (for your own users/billing)**: Supabase, Postgres, PlanetScale, MongoDB, anything.

Add a provider by installing its SDK and setting its key in the **Secrets** panel.

### What this repo actually depends on

The builder runs on **Next.js 16 / React 19 / TypeScript / Tailwind 4**. The only other runtime dependencies are UI and utility libraries:

| Area | Packages |
|---|---|
| UI primitives | Radix UI, `lucide-react`, `sonner`, `cmdk`, `next-themes`, `class-variance-authority`, `clsx`, `tailwind-merge` |
| Code editor | `@monaco-editor/react` |
| Forms | `react-hook-form` |
| Dates / archives | `react-day-picker`, `fflate` |



---

## 🏗️ How it works

```
┌──────────────────────────────────────────────────────────────┐
│  This repo (the Next.js front-end, or your own SaaS)         │
│                                                              │
│   UI components ──► API client (src/lib/vcaas.ts)            │
│                        │  same-origin fetch                  │
│                        ▼                                     │
│   /api/vcaas/*  (server proxy routes) ──► adds the api-key   │
└────────────────────────────┬─────────────────────────────────┘
                             │  HTTPS + your secret API key
                             ▼
        ╔═══════════════════════════════════════════╗
        ║   BigBag AI Engine                              ║
        ║   AI agent · hosting · sandboxes           ║
        ║   database · deploys · domains · GitHub    ║
        ╚═══════════════════════════════════════════╝
```

Three things worth knowing:

- **The browser never sees your API key.** Client code calls same-origin proxy routes under `/api/vcaas/*`. The server adds the key and forwards the request to BigBag.
- **Every BigBag call goes through one file.** The client side is `src/lib/vcaas.ts`, with its types in `src/lib/vcaas-types.ts`. The part that holds the key is `src/lib/vcaas-server.ts`. If you want to see how an endpoint is really called, polled and error-handled, read there.
- **Credits belong to the operator.** Every action runs on the one API key in your environment. When that account runs out of credits the app says so once and links to the billing page. ⚠️ That message is for **you**, not your users. Remove it before you sell this to customers.

---

## 📚 API reference

Everything this app calls is documented in one Markdown file, written to be read by people and by AI coding assistants alike:

### 👉 **[www.bigbag.app/bigbag-api.md](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/bigbag-api.md)**

It covers the whole core API (account and credits, projects, the AI agent, deployments, server and logs, versions, secrets, custom domains, analytics) and links to the optional areas (GitHub, Figma, database, webhooks, files, project transfer, project groups). The browsable docs are at [www.bigbag.app/docs](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding), with the [quickstart](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/quickstart) and the [OpenAPI spec](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/openapi.json).

Working on this repo with an AI agent? Start from [`AGENTS.md`](AGENTS.md). It is the short, agent-oriented map of the project: commands, architecture, where each feature lives, the rules that are not obvious from the code, and how to take the next steps.

---

## 🗂️ Project structure

```
src/
├─ app/
│  ├─ page.tsx                 # Dashboard: prompt box, your projects, import/duplicate
│  ├─ project/[projectId]/     # The workspace (chat, preview, code, database, …)
│  └─ api/
│     ├─ vcaas/[...path]/      # Server proxy to the BigBag AI Engine
│     ├─ preview/[projectId]/  # Same-origin proxy of a project, needed by the visual editor
│     ├─ visual-edit/…/apply   # Turns visual changes into real source edits
│     └─ config/               # Reports whether the API key is configured
├─ components/
│  └─ workspace/               # Chat, Preview, Code, Database, GitHub, Figma, Logs…
│     └─ visual-editor/        # Inspector panel, changes bar, the editor's own hook
├─ i18n/                       # One English dictionary + `useT()`
├─ lib/
│  ├─ vcaas.ts                 # 🧠 The BigBag AI Engine client (browser side)
│  ├─ vcaas-server.ts          # The half that holds the API key, server only
│  ├─ vcaas-types.ts           # Shared API types
│  └─ visual-edit*.ts          # Matching a clicked element back to its source
└─ proxy.ts                    # CORS / CSP boundary
AGENTS.md                      # The map for AI coding agents working on this repo
```

---

## ❓ FAQ

<details>
<summary><b>Is it really free?</b></summary>

The code is free and open source. Running it needs a BigBag AI Engine key, which is free to start (the first 50 AI credits are included). You pay only as usage grows. See [pricing](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/api#pricing).
</details>

<details>
<summary><b>Do I need to set up a database, hosting or an AI provider?</b></summary>

No. The single BigBag AI Engine key provides hosting, databases, AI, domains, GitHub and sandboxes. You can still add your own providers such as Supabase or Stripe if you want them.
</details>

<details>
<summary><b>Can my users build apps inside my own product?</b></summary>

Yes. It is multi-tenant and white-label by design. See [Put it inside your own product](#-put-it-inside-your-own-product).
</details>

<details>
<summary><b>What can it build?</b></summary>

Full-stack Next.js web apps: dashboards, CRMs, internal tools, marketplaces, SaaS MVPs, landing pages with a backend, and more.
</details>

<details>
<summary><b>Where is the API key stored? Is it safe?</b></summary>

Server side only. It is read in `src/lib/vcaas-server.ts` and never shipped to the browser. Client requests go through same-origin proxy routes that add the key on the server.
</details>

<details>
<summary><b>Can I self-host without Vercel?</b></summary>

Yes. `npm run build && npm start` runs on any Node.js host: a VM, Docker, Railway, Render, Fly.io and so on.
</details>

---

## 🆚 How it compares

| | **AI App Builder Open** | v0 · Lovable · Bolt · Replit |
| --- | :---: | :---: |
| Open source | ✅ | ❌ |
| Self-hostable | ✅ | ❌ |
| White-label, embeddable in your SaaS | ✅ | ❌ |
| Multi-tenant out of the box | ✅ | Limited |
| Hosting + database + domains + GitHub included | ✅ (one key) | Varies |
| Bring your own providers (Supabase, Stripe…) | ✅ | Limited |
| Deploy anywhere | ✅ | ❌ |

---

## 🤝 Contributing

Contributions are welcome, whether a bug fix, a new panel, docs or a feature idea:

1. Fork the repo and create a branch: `git checkout -b my-feature`
2. Read [`AGENTS.md`](AGENTS.md) for the layout and the rules, make your changes, and run `npm run build` to check them.
3. Open a pull request describing what you changed and why.

Found a bug or have an idea? [Open an issue](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/issues).

---

## 📄 License

Released under the **MIT License**. Free for personal and commercial use. See [`LICENSE`](LICENSE).

---

<div align="center">

### If this project helps you, please give it a ⭐. It helps others find it.

**Open-source AI app builder** · self-hosted **v0 / Lovable / Bolt / Replit alternative** · prompt-to-app · full-stack Next.js · multi-tenant · embeddable AI app builder for your SaaS.

Built with ❤️ on the [BigBag AI Engine](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/api) · [Docs](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding) · [Get your free API key](https://github.com/codewithumesh00-sketch/bigbag-vibe-coding/api)

</div>

# bigbag
# bigbaggy

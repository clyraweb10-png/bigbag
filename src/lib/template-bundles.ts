/**
 * Pre-built starter template code bundles.
 *
 * Each bundle contains a complete set of source files that can be written
 * directly to a project workspace and built — no AI generation needed.
 * Users get an instant preview and can then iterate with the AI.
 *
 * File format: { path: string; content: string }[]
 * These are written by the /api/starter-install route via localFileManager.writeContent.
 */

export interface TemplateBundleFile {
  path: string;
  content: string;
}

export interface TemplateBundle {
  id: string;
  name: string;
  description: string;
  files: TemplateBundleFile[];
}

// ─── SaaS Landing Page ────────────────────────────────────────────────────────

const SAAS_LANDING_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { Menu, X, Zap, Shield, BarChart3, Globe, ArrowRight, Check, Star } from "lucide-react";

const NAV_LINKS = ["Features", "Pricing", "About", "Blog"];

const FEATURES = [
  { icon: Zap, title: "Lightning Fast", description: "Deploy in seconds with our optimized infrastructure. Zero cold starts, instant scaling." },
  { icon: Shield, title: "Enterprise Security", description: "Bank-grade encryption, SOC 2 certified, and compliant with GDPR, HIPAA, and more." },
  { icon: BarChart3, title: "Advanced Analytics", description: "Real-time dashboards with predictive insights to help you make data-driven decisions." },
  { icon: Globe, title: "Global CDN", description: "Serve your users from 200+ edge locations worldwide for ultra-low latency." },
];

const PLANS = [
  { name: "Starter", price: 0, period: "month", features: ["Up to 3 projects", "1 GB storage", "Community support", "Basic analytics"], cta: "Get started free", highlight: false },
  { name: "Pro", price: 29, period: "month", features: ["Unlimited projects", "50 GB storage", "Priority support", "Advanced analytics", "Custom domains", "Team collaboration"], cta: "Start free trial", highlight: true },
  { name: "Enterprise", price: 99, period: "month", features: ["Everything in Pro", "500 GB storage", "24/7 dedicated support", "SSO & SAML", "SLA guarantee", "Custom contracts"], cta: "Contact sales", highlight: false },
];

const TESTIMONIALS = [
  { name: "Sarah Chen", role: "CTO at Nexus", text: "Switched our entire stack in a weekend. The performance gains were immediate and dramatic.", avatar: "SC" },
  { name: "Marcus Webb", role: "Founder at Launchpad", text: "Finally, a platform that scales with us. From 10 to 100k users without a single hiccup.", avatar: "MW" },
  { name: "Priya Sharma", role: "Lead Dev at Orbit", text: "The developer experience is unmatched. Ship features faster than ever before.", avatar: "PS" },
];

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [billingYearly, setBillingYearly] = useState(false);

  return (
    <div className="min-h-screen bg-[#050508] text-white font-sans">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] bg-[#050508]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">Nexus</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(l => (
              <a key={l} href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">{l}</a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button className="text-sm text-zinc-400 hover:text-white px-4 py-2 transition-colors">Log in</button>
            <button className="text-sm bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-zinc-100 transition-colors">
              Start free
            </button>
          </div>
          <button className="md:hidden p-2 text-zinc-400" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-[#050508] px-5 py-4 space-y-3">
            {NAV_LINKS.map(l => <a key={l} href="#" className="block text-sm text-zinc-400 py-2">{l}</a>)}
            <button className="w-full text-sm bg-white text-black font-semibold py-2.5 rounded-lg">Start free</button>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-24 px-5 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-violet-900/20 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
            <Star className="w-3 h-3" />
            Trusted by 10,000+ developers
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-6">
            Build. Deploy.
            <br />
            <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">Scale.</span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-10 leading-relaxed">
            The platform that takes your idea from prototype to production in minutes, not months.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button className="inline-flex items-center justify-center gap-2 bg-white text-black font-bold px-7 py-3.5 rounded-xl hover:bg-zinc-100 transition-colors text-sm">
              Get started free <ArrowRight className="w-4 h-4" />
            </button>
            <button className="inline-flex items-center justify-center gap-2 border border-white/10 text-zinc-300 font-medium px-7 py-3.5 rounded-xl hover:border-white/20 hover:text-white transition-colors text-sm">
              Watch demo
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-5">No credit card required · Free forever plan</p>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-5 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything you need</h2>
            <p className="text-zinc-400 max-w-lg mx-auto">One platform, infinite possibilities. Stop juggling tools.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 hover:border-white/10 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-violet-400" />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-5 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple pricing</h2>
            <div className="inline-flex items-center gap-2 bg-white/[0.05] border border-white/[0.08] rounded-full p-1 mt-4">
              <button onClick={() => setBillingYearly(false)} className={\`px-4 py-1.5 rounded-full text-sm font-medium transition-colors \${!billingYearly ? "bg-white text-black" : "text-zinc-400"}\`}>Monthly</button>
              <button onClick={() => setBillingYearly(true)} className={\`px-4 py-1.5 rounded-full text-sm font-medium transition-colors \${billingYearly ? "bg-white text-black" : "text-zinc-400"}\`}>
                Yearly <span className="text-green-400 text-xs">-20%</span>
              </button>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PLANS.map(plan => (
              <div key={plan.name} className={\`relative rounded-2xl border p-7 \${plan.highlight ? "border-violet-500/40 bg-violet-500/[0.07]" : "border-white/[0.06] bg-white/[0.02]"}\`}>
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <p className="text-sm font-medium text-zinc-400 mb-1">{plan.name}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black">\${billingYearly ? Math.round(plan.price * 0.8) : plan.price}</span>
                    <span className="text-zinc-400 text-sm">/{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-300">
                      <Check className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button className={\`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors \${plan.highlight ? "bg-violet-500 hover:bg-violet-400 text-white" : "bg-white/[0.05] hover:bg-white/10 text-white"}\`}>
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-5 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-14">Loved by developers</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold">{t.avatar}</div>
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-zinc-500">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-5 border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-black mb-4">Ready to launch?</h2>
          <p className="text-zinc-400 mb-8">Join 10,000+ developers shipping faster with Nexus.</p>
          <button className="inline-flex items-center gap-2 bg-white text-black font-bold px-8 py-4 rounded-xl hover:bg-zinc-100 transition-colors">
            Get started for free <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10 px-5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold text-sm">Nexus</span>
          </div>
          <p className="text-xs text-zinc-500">© 2025 Nexus. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";

.bg-gradient-radial {
  background-image: radial-gradient(ellipse at center, var(--tw-gradient-stops));
}
`,
  },
];

// ─── Analytics Dashboard ──────────────────────────────────────────────────────

const ANALYTICS_DASHBOARD_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { LayoutDashboard, BarChart3, Users, TrendingUp, Settings, Bell, Search, ArrowUpRight, ArrowDownRight, Activity, Globe, ShoppingCart, DollarSign, Menu, X } from "lucide-react";

const METRICS = [
  { label: "Total Revenue", value: "$48,295", change: "+12.5%", up: true, icon: DollarSign, color: "violet" },
  { label: "Active Users", value: "8,421", change: "+8.2%", up: true, icon: Users, color: "blue" },
  { label: "Conversion Rate", value: "3.28%", change: "-0.4%", up: false, icon: TrendingUp, color: "emerald" },
  { label: "Avg. Order Value", value: "$127", change: "+5.1%", up: true, icon: ShoppingCart, color: "amber" },
];

const RECENT_ORDERS = [
  { id: "#3421", customer: "Alice Johnson", product: "Pro Plan", amount: "$49", status: "Paid", avatar: "AJ" },
  { id: "#3420", customer: "Bob Smith", product: "Starter Plan", amount: "$9", status: "Paid", avatar: "BS" },
  { id: "#3419", customer: "Carol White", product: "Enterprise", amount: "$299", status: "Pending", avatar: "CW" },
  { id: "#3418", customer: "David Kim", product: "Pro Plan", amount: "$49", status: "Paid", avatar: "DK" },
  { id: "#3417", customer: "Eva Martinez", product: "Starter Plan", amount: "$9", status: "Failed", avatar: "EM" },
];

const TOP_PAGES = [
  { path: "/pricing", visits: 12450, bounce: "32%" },
  { path: "/features", visits: 9821, bounce: "28%" },
  { path: "/dashboard", visits: 8305, bounce: "18%" },
  { path: "/blog/launch", visits: 6204, bounce: "45%" },
];

const BAR_DATA = [65, 48, 72, 55, 83, 92, 78, 65, 88, 75, 95, 82];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const colorMap: Record<string, string> = {
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: BarChart3, label: "Analytics" },
  { icon: Users, label: "Customers" },
  { icon: Globe, label: "Traffic" },
  { icon: Settings, label: "Settings" },
];

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className={\`\${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static inset-y-0 left-0 z-50 w-60 bg-[#0f0f17] border-r border-white/[0.06] flex flex-col transition-transform duration-200\`}>
        <div className="h-16 flex items-center gap-2 px-5 border-b border-white/[0.06]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-sm tracking-tight">Analytics Pro</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ icon: Icon, label, active }) => (
            <button key={label} className={\`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors \${active ? "bg-violet-500/10 text-violet-300 border border-violet-500/20" : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"}\`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xs font-bold">A</div>
            <div>
              <p className="text-xs font-medium">Admin User</p>
              <p className="text-[10px] text-zinc-500">admin@nexus.io</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-white/[0.06] bg-[#0a0a0f] flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3">
            <button className="md:hidden p-1 text-zinc-400" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input placeholder="Search..." className="pl-9 pr-4 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-lg text-xs text-zinc-300 placeholder-zinc-600 outline-none w-48 focus:border-white/10" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="relative p-2 text-zinc-400 hover:text-white">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-violet-500 rounded-full" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Welcome back. Here's what's happening.</p>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {METRICS.map(({ label, value, change, up, icon: Icon, color }) => (
              <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <div className={\`w-8 h-8 rounded-lg border flex items-center justify-center \${colorMap[color]}\`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{value}</p>
                <div className={\`flex items-center gap-1 mt-1 text-xs \${up ? "text-emerald-400" : "text-red-400"}\`}>
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {change} vs last month
                </div>
              </div>
            ))}
          </div>

          {/* Revenue Chart */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-sm">Revenue Overview</h2>
              <select className="text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-zinc-400 outline-none">
                <option>Last 12 months</option>
              </select>
            </div>
            <div className="flex items-end gap-1.5 h-36">
              {BAR_DATA.map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div style={{ height: \`\${h}%\` }} className="w-full rounded-t bg-gradient-to-t from-violet-600 to-violet-400 opacity-80 hover:opacity-100 transition-opacity" />
                  <span className="text-[9px] text-zinc-600">{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Grid */}
          <div className="grid lg:grid-cols-5 gap-4">
            {/* Orders table */}
            <div className="lg:col-span-3 bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-4">Recent Orders</h2>
              <div className="space-y-3">
                {RECENT_ORDERS.map(o => (
                  <div key={o.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold">{o.avatar}</div>
                      <div>
                        <p className="text-xs font-medium">{o.customer}</p>
                        <p className="text-[10px] text-zinc-500">{o.id} · {o.product}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold">{o.amount}</p>
                      <span className={\`text-[10px] px-1.5 py-0.5 rounded \${o.status === "Paid" ? "bg-emerald-500/10 text-emerald-400" : o.status === "Pending" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}\`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top pages */}
            <div className="lg:col-span-2 bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-4">Top Pages</h2>
              <div className="space-y-3">
                {TOP_PAGES.map(p => (
                  <div key={p.path}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-300 font-medium">{p.path}</span>
                      <span className="text-zinc-500">{p.visits.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div style={{ width: \`\${(p.visits / 12450) * 100}%\` }} className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── E-Commerce Store ─────────────────────────────────────────────────────────

const ECOMMERCE_STORE_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { ShoppingCart, Search, Star, Heart, Filter, X, Plus, Minus, Trash2, ArrowRight } from "lucide-react";

const PRODUCTS = [
  { id: 1, name: "Minimal Desk Lamp", price: 89, rating: 4.8, reviews: 124, category: "Lighting", img: "💡", badge: "Bestseller", color: "from-amber-400/20 to-orange-500/10" },
  { id: 2, name: "Ergonomic Chair", price: 349, rating: 4.9, reviews: 89, category: "Furniture", img: "🪑", badge: "New", color: "from-blue-400/20 to-cyan-500/10" },
  { id: 3, name: "Mechanical Keyboard", price: 159, rating: 4.7, reviews: 256, category: "Electronics", img: "⌨️", badge: null, color: "from-violet-400/20 to-purple-500/10" },
  { id: 4, name: "Noise Cancelling Headphones", price: 279, rating: 4.6, reviews: 412, category: "Electronics", img: "🎧", badge: "Sale", color: "from-rose-400/20 to-pink-500/10" },
  { id: 5, name: "Standing Desk Mat", price: 45, rating: 4.5, reviews: 178, category: "Accessories", img: "🟫", badge: null, color: "from-emerald-400/20 to-green-500/10" },
  { id: 6, name: "Monitor Light Bar", price: 69, rating: 4.8, reviews: 93, category: "Lighting", img: "🔆", badge: "Popular", color: "from-yellow-400/20 to-amber-500/10" },
];

const CATS = ["All", "Lighting", "Furniture", "Electronics", "Accessories"];

type CartItem = { id: number; name: string; price: number; qty: number; img: string };

export default function App() {
  const [cat, setCat] = useState("All");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [wishlist, setWishlist] = useState<Set<number>>(new Set());

  const filtered = PRODUCTS.filter(p => (cat === "All" || p.category === cat) && p.name.toLowerCase().includes(query.toLowerCase()));
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const addToCart = (p: typeof PRODUCTS[0]) => {
    setCart(c => {
      const ex = c.find(i => i.id === p.id);
      if (ex) return c.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...c, { id: p.id, name: p.name, price: p.price, qty: 1, img: p.img }];
    });
  };

  const updateQty = (id: number, delta: number) => {
    setCart(c => c.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const toggleWish = (id: number) => {
    setWishlist(w => { const n = new Set(w); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <div className="min-h-screen bg-[#fafaf8] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-zinc-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <h1 className="text-xl font-black tracking-tight text-zinc-900">MINIMAL<span className="text-violet-500">.</span></h1>
          <div className="flex-1 max-w-xs relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products..." className="w-full pl-9 pr-4 py-2 bg-zinc-100 rounded-xl text-sm text-zinc-700 placeholder-zinc-400 outline-none focus:bg-zinc-200 transition-colors" />
          </div>
          <button onClick={() => setCartOpen(true)} className="relative flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors">
            <ShoppingCart className="w-4 h-4" />
            Cart
            {totalItems > 0 && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-violet-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center">{totalItems}</span>}
          </button>
        </div>
      </header>

      {/* Category Pills */}
      <div className="sticky top-16 z-30 bg-white border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-5 h-12 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {CATS.map(c => (
            <button key={c} onClick={() => setCat(c)} className={\`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all \${cat === c ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"}\`}>{c}</button>
          ))}
        </div>
      </div>

      {/* Products */}
      <main className="max-w-6xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-zinc-500">{filtered.length} products</p>
          <button className="flex items-center gap-2 text-sm text-zinc-500 border border-zinc-200 px-3 py-1.5 rounded-lg hover:border-zinc-300 transition-colors">
            <Filter className="w-3.5 h-3.5" />Sort
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-zinc-100 overflow-hidden hover:shadow-md transition-shadow group">
              <div className={\`bg-gradient-to-br \${p.color} aspect-square flex items-center justify-center relative\`}>
                <span className="text-6xl">{p.img}</span>
                {p.badge && (
                  <span className="absolute top-3 left-3 bg-white text-zinc-800 text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">{p.badge}</span>
                )}
                <button onClick={() => toggleWish(p.id)} className={\`absolute top-3 right-3 p-2 bg-white rounded-full shadow-sm transition-colors \${wishlist.has(p.id) ? "text-rose-500" : "text-zinc-300 hover:text-zinc-500"}\`}>
                  <Heart className="w-3.5 h-3.5" fill={wishlist.has(p.id) ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="p-4">
                <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider mb-1">{p.category}</p>
                <h3 className="text-sm font-semibold text-zinc-900 leading-tight mb-2">{p.name}</h3>
                <div className="flex items-center gap-1 mb-3">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span className="text-xs font-medium text-zinc-700">{p.rating}</span>
                  <span className="text-xs text-zinc-400">({p.reviews})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-black text-zinc-900">\${p.price}</span>
                  <button onClick={() => addToCart(p)} className="bg-zinc-900 text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-violet-600 transition-colors flex items-center gap-1.5">
                    <Plus className="w-3 h-3" />Add
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full">
            <div className="flex items-center justify-between p-5 border-b border-zinc-100">
              <h2 className="font-bold text-zinc-900">Your Cart ({totalItems})</h2>
              <button onClick={() => setCartOpen(false)}><X className="w-5 h-5 text-zinc-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-zinc-400">
                  <ShoppingCart className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">Your cart is empty</p>
                </div>
              ) : cart.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-zinc-50 rounded-xl p-3">
                  <span className="text-3xl">{item.img}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{item.name}</p>
                    <p className="text-xs text-zinc-500">\${item.price}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.id, -1)} className="w-6 h-6 rounded-full bg-white border border-zinc-200 flex items-center justify-center hover:border-zinc-300 transition-colors">
                      {item.qty === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3 h-3" />}
                    </button>
                    <span className="text-sm font-bold w-5 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="w-6 h-6 rounded-full bg-white border border-zinc-200 flex items-center justify-center hover:border-zinc-300 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="p-5 border-t border-zinc-100">
                <div className="flex justify-between text-sm mb-4">
                  <span className="text-zinc-500">Subtotal</span>
                  <span className="font-bold text-zinc-900">\${totalPrice.toFixed(2)}</span>
                </div>
                <button className="w-full bg-zinc-900 text-white font-bold py-3 rounded-xl hover:bg-violet-600 transition-colors flex items-center justify-center gap-2">
                  Checkout <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Kanban Project Tracker ───────────────────────────────────────────────────

const KANBAN_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { Plus, MoreHorizontal, X, CheckCircle2, Circle, Clock, AlertCircle, Flame } from "lucide-react";

type Priority = "low" | "medium" | "high" | "urgent";
type Status = "backlog" | "todo" | "in-progress" | "done";

interface Task {
  id: string;
  title: string;
  priority: Priority;
  assignee: string;
  tags: string[];
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; icon: typeof Circle }> = {
  low: { label: "Low", color: "text-zinc-400", icon: Circle },
  medium: { label: "Medium", color: "text-blue-400", icon: Clock },
  high: { label: "High", color: "text-amber-400", icon: AlertCircle },
  urgent: { label: "Urgent", color: "text-red-400", icon: Flame },
};

const COLUMNS: { id: Status; label: string; icon: typeof CheckCircle2; color: string }[] = [
  { id: "backlog", label: "Backlog", icon: Circle, color: "text-zinc-400" },
  { id: "todo", label: "To Do", icon: Clock, color: "text-blue-400" },
  { id: "in-progress", label: "In Progress", icon: AlertCircle, color: "text-amber-400" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "text-emerald-400" },
];

const INITIAL_TASKS: Record<Status, Task[]> = {
  backlog: [
    { id: "1", title: "Research competitor pricing models", priority: "low", assignee: "AJ", tags: ["research"] },
    { id: "2", title: "Update onboarding flow documentation", priority: "medium", assignee: "BS", tags: ["docs"] },
  ],
  todo: [
    { id: "3", title: "Design new dashboard layout", priority: "high", assignee: "CW", tags: ["design", "ui"] },
    { id: "4", title: "Fix auth session expiry bug", priority: "urgent", assignee: "DK", tags: ["bug"] },
    { id: "5", title: "Set up CI/CD pipeline", priority: "medium", assignee: "AJ", tags: ["devops"] },
  ],
  "in-progress": [
    { id: "6", title: "Implement real-time notifications", priority: "high", assignee: "CW", tags: ["feature"] },
    { id: "7", title: "Migrate database to PostgreSQL", priority: "urgent", assignee: "BS", tags: ["backend"] },
  ],
  done: [
    { id: "8", title: "Launch beta program", priority: "high", assignee: "DK", tags: ["launch"] },
    { id: "9", title: "Write unit tests for API", priority: "medium", assignee: "AJ", tags: ["testing"] },
  ],
};

const TAG_COLORS: Record<string, string> = {
  design: "bg-violet-500/10 text-violet-300",
  ui: "bg-blue-500/10 text-blue-300",
  bug: "bg-red-500/10 text-red-300",
  feature: "bg-emerald-500/10 text-emerald-300",
  backend: "bg-amber-500/10 text-amber-300",
  devops: "bg-cyan-500/10 text-cyan-300",
  docs: "bg-zinc-500/10 text-zinc-300",
  research: "bg-pink-500/10 text-pink-300",
  testing: "bg-indigo-500/10 text-indigo-300",
  launch: "bg-orange-500/10 text-orange-300",
};

export default function App() {
  const [columns, setColumns] = useState(INITIAL_TASKS);
  const [newTaskModal, setNewTaskModal] = useState<Status | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [dragging, setDragging] = useState<{ task: Task; from: Status } | null>(null);

  const addTask = () => {
    if (!newTitle.trim() || !newTaskModal) return;
    const task: Task = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      priority: newPriority,
      assignee: "ME",
      tags: [],
    };
    setColumns(c => ({ ...c, [newTaskModal]: [...c[newTaskModal], task] }));
    setNewTitle("");
    setNewPriority("medium");
    setNewTaskModal(null);
  };

  const removeTask = (status: Status, id: string) => {
    setColumns(c => ({ ...c, [status]: c[status].filter(t => t.id !== id) }));
  };

  const dropTask = (target: Status) => {
    if (!dragging || dragging.from === target) { setDragging(null); return; }
    setColumns(c => ({
      ...c,
      [dragging.from]: c[dragging.from].filter(t => t.id !== dragging.task.id),
      [target]: [...c[target], dragging.task],
    }));
    setDragging(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#0f0f17] px-6 h-16 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">Project Board</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{Object.values(columns).flat().length} tasks total</p>
        </div>
        <div className="flex items-center gap-2">
          {["AJ","BS","CW","DK"].map(a => (
            <div key={a} className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold border-2 border-[#0a0a0f]">{a}</div>
          ))}
        </div>
      </header>

      {/* Board */}
      <div className="p-5 flex gap-4 overflow-x-auto min-h-[calc(100vh-4rem)]">
        {COLUMNS.map(col => {
          const tasks = columns[col.id];
          const Icon = col.icon;
          return (
            <div
              key={col.id}
              className="flex-shrink-0 w-72 flex flex-col"
              onDragOver={e => e.preventDefault()}
              onDrop={() => dropTask(col.id)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={\`w-4 h-4 \${col.color}\`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="bg-white/[0.07] text-zinc-400 text-xs px-1.5 py-0.5 rounded-full font-medium">{tasks.length}</span>
                </div>
                <button onClick={() => setNewTaskModal(col.id)} className="text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-white/[0.05] transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Tasks */}
              <div className="flex-1 space-y-2">
                {tasks.map(task => {
                  const { icon: PIcon, color: pc, label: pl } = PRIORITY_CONFIG[task.priority];
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragging({ task, from: col.id })}
                      className="bg-[#161621] border border-white/[0.06] rounded-xl p-3.5 cursor-grab active:cursor-grabbing hover:border-white/10 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <p className="text-sm text-zinc-200 leading-snug flex-1">{task.title}</p>
                        <button onClick={() => removeTask(col.id, task.id)} className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-0.5 shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {task.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2.5">
                          {task.tags.map(tag => (
                            <span key={tag} className={\`text-[10px] px-1.5 py-0.5 rounded font-medium \${TAG_COLORS[tag] || "bg-zinc-500/10 text-zinc-400"}\`}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className={\`flex items-center gap-1 \${pc}\`}>
                          <PIcon className="w-3 h-3" />
                          <span className="text-[10px] font-medium">{pl}</span>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[9px] font-bold">{task.assignee}</div>
                      </div>
                    </div>
                  );
                })}

                {/* Add task button */}
                <button onClick={() => setNewTaskModal(col.id)} className="w-full py-2.5 border border-dashed border-white/[0.08] rounded-xl text-xs text-zinc-600 hover:text-zinc-400 hover:border-white/[0.14] transition-colors flex items-center justify-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />Add task
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Task Modal */}
      {newTaskModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161621] border border-white/[0.08] rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">Add to {COLUMNS.find(c => c.id === newTaskModal)?.label}</h2>
              <button onClick={() => setNewTaskModal(null)}><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTask()}
              placeholder="Task title..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/50 mb-3"
            />
            <div className="flex items-center gap-2 mb-4">
              {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, { label, color }]) => (
                <button key={key} onClick={() => setNewPriority(key)} className={\`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors \${newPriority === key ? "border-violet-500 bg-violet-500/10 text-violet-300" : "border-white/[0.06] text-zinc-500 hover:border-white/10"}\`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setNewTaskModal(null)} className="flex-1 py-2 border border-white/[0.08] rounded-xl text-sm text-zinc-400 hover:border-white/14 transition-colors">Cancel</button>
              <button onClick={addTask} disabled={!newTitle.trim()} className="flex-1 py-2 bg-violet-500 rounded-xl text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50 transition-colors">Add Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Portfolio ────────────────────────────────────────────────────────────────

const PORTFOLIO_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { Github, Linkedin, Twitter, ExternalLink, Mail, ArrowUpRight, Code2, Palette, Zap, Globe } from "lucide-react";

const PROJECTS = [
  { title: "NexusAI Dashboard", desc: "Real-time AI analytics platform with live metrics and predictive insights.", tags: ["React", "TypeScript", "D3.js"], emoji: "🧠", color: "from-violet-500/20 to-indigo-500/10", link: "#" },
  { title: "Commerce Engine", desc: "Headless e-commerce platform processing 10k+ orders daily.", tags: ["Next.js", "PostgreSQL", "Stripe"], emoji: "🛍️", color: "from-blue-500/20 to-cyan-500/10", link: "#" },
  { title: "DesignSystem.io", desc: "Open-source component library with 200+ production-ready components.", tags: ["React", "Tailwind", "Storybook"], emoji: "🎨", color: "from-emerald-500/20 to-teal-500/10", link: "#" },
  { title: "Velocity CLI", desc: "Developer productivity tool with 5,000+ GitHub stars.", tags: ["Go", "Cobra", "Open Source"], emoji: "⚡", color: "from-amber-500/20 to-orange-500/10", link: "#" },
];

const SKILLS = [
  { icon: Code2, label: "Engineering", items: ["React", "TypeScript", "Node.js", "Go", "PostgreSQL", "Redis"] },
  { icon: Palette, label: "Design", items: ["Figma", "Tailwind CSS", "Motion Design", "Design Systems"] },
  { icon: Zap, label: "Infrastructure", items: ["AWS", "Docker", "Kubernetes", "CI/CD", "Monitoring"] },
  { icon: Globe, label: "Practices", items: ["TDD", "Agile", "Code Review", "Mentoring", "Open Source"] },
];

export default function App() {
  const [activeSection, setActiveSection] = useState("work");

  return (
    <div className="min-h-screen bg-[#fafaf9] font-sans">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="#" className="font-black text-lg text-zinc-900 tracking-tight">
            alex.<span className="text-violet-500">dev</span>
          </a>
          <div className="flex items-center gap-6">
            {["work", "skills", "about"].map(s => (
              <button key={s} onClick={() => setActiveSection(s)} className={\`text-sm font-medium capitalize transition-colors \${activeSection === s ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}\`}>{s}</button>
            ))}
            <a href="mailto:hello@alex.dev" className="flex items-center gap-1.5 bg-zinc-900 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-zinc-700 transition-colors">
              <Mail className="w-3.5 h-3.5" />Hire me
            </a>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        {/* Hero */}
        <section className="py-16">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
            <div className="relative">
              <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-5xl shadow-2xl shadow-violet-500/20">
                👨‍💻
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-emerald-400 rounded-full border-2 border-white" />
            </div>
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Available for projects
              </div>
              <h1 className="text-4xl md:text-5xl font-black text-zinc-900 tracking-tight leading-none mb-3">
                Alex Morgan
              </h1>
              <p className="text-xl text-zinc-500 mb-4 font-medium">Full-Stack Engineer & Open Source Contributor</p>
              <p className="text-base text-zinc-500 max-w-xl leading-relaxed">
                I build things for the web. Focused on performant, accessible UIs and scalable backend systems. 6 years shipping products used by millions.
              </p>
              <div className="flex items-center gap-3 mt-6">
                {[
                  { icon: Github, label: "GitHub" },
                  { icon: Linkedin, label: "LinkedIn" },
                  { icon: Twitter, label: "Twitter" },
                ].map(({ icon: Icon, label }) => (
                  <a key={label} href="#" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-3 py-2 rounded-lg hover:border-zinc-300 transition-colors">
                    <Icon className="w-3.5 h-3.5" />{label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Conditional Sections */}
        {activeSection === "work" && (
          <section>
            <h2 className="text-2xl font-black text-zinc-900 mb-8">Selected Work</h2>
            <div className="grid md:grid-cols-2 gap-5">
              {PROJECTS.map(p => (
                <div key={p.title} className="group bg-white border border-zinc-100 rounded-2xl overflow-hidden hover:shadow-lg hover:border-zinc-200 transition-all cursor-pointer">
                  <div className={\`bg-gradient-to-br \${p.color} h-40 flex items-center justify-center\`}>
                    <span className="text-6xl">{p.emoji}</span>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-zinc-900 text-lg">{p.title}</h3>
                      <a href={p.link} className="p-1.5 text-zinc-400 hover:text-violet-500 transition-colors">
                        <ArrowUpRight className="w-4 h-4" />
                      </a>
                    </div>
                    <p className="text-sm text-zinc-500 leading-relaxed mb-4">{p.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {p.tags.map(t => (
                        <span key={t} className="text-xs font-medium bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeSection === "skills" && (
          <section>
            <h2 className="text-2xl font-black text-zinc-900 mb-8">Skills & Tools</h2>
            <div className="grid md:grid-cols-2 gap-5">
              {SKILLS.map(({ icon: Icon, label, items }) => (
                <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-violet-600" />
                    </div>
                    <h3 className="font-bold text-zinc-900">{label}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {items.map(item => (
                      <span key={item} className="text-sm bg-zinc-50 text-zinc-600 border border-zinc-100 px-3 py-1.5 rounded-lg font-medium">{item}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeSection === "about" && (
          <section>
            <h2 className="text-2xl font-black text-zinc-900 mb-8">About Me</h2>
            <div className="grid md:grid-cols-3 gap-5">
              <div className="md:col-span-2 bg-white border border-zinc-100 rounded-2xl p-8">
                <div className="prose prose-zinc max-w-none">
                  <p className="text-zinc-600 leading-relaxed text-base mb-4">
                    Hey! I'm a full-stack engineer with 6 years of experience building products from 0 to 1 and scaling them to millions of users.
                  </p>
                  <p className="text-zinc-600 leading-relaxed text-base mb-4">
                    I care deeply about the intersection of great engineering and great design. I believe the best products are those where you can't tell where the design ends and the engineering begins.
                  </p>
                  <p className="text-zinc-600 leading-relaxed text-base">
                    When I'm not coding, I'm contributing to open source, mentoring junior developers, or writing about web performance on my blog.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { label: "Location", value: "San Francisco, CA" },
                  { label: "Experience", value: "6+ years" },
                  { label: "Focus", value: "Full-Stack & Systems" },
                  { label: "Status", value: "Open to work" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white border border-zinc-100 rounded-xl p-4">
                    <p className="text-xs text-zinc-400 font-medium mb-1">{label}</p>
                    <p className="text-sm font-semibold text-zinc-800">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Notes App ────────────────────────────────────────────────────────────────

const NOTES_APP_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState, useMemo } from "react";
import { Plus, Search, Trash2, Star, StarOff, Tag, Hash, Menu, X, Edit3 } from "lucide-react";

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  starred: boolean;
  createdAt: Date;
  updatedAt: Date;
  color: string;
}

const NOTE_COLORS = ["bg-white", "bg-amber-50", "bg-blue-50", "bg-violet-50", "bg-emerald-50", "bg-rose-50"];

const INITIAL_NOTES: Note[] = [
  { id: "1", title: "Getting started", content: "Welcome to Notes! Click any note to edit it, or create a new one with the + button.", tags: ["tutorial"], starred: true, createdAt: new Date("2025-01-01"), updatedAt: new Date(), color: "bg-amber-50" },
  { id: "2", title: "Meeting notes - Q1 Planning", content: "Key points:\\n- Launch new feature by March\\n- Hire 3 engineers\\n- Improve onboarding by 40%\\n- Review pricing model", tags: ["work", "meetings"], starred: false, createdAt: new Date("2025-01-10"), updatedAt: new Date(), color: "bg-blue-50" },
  { id: "3", title: "Book recommendations", content: "Books to read:\\n1. The Pragmatic Programmer\\n2. Clean Code\\n3. Designing Data-Intensive Applications\\n4. System Design Interview", tags: ["books", "learning"], starred: false, createdAt: new Date("2025-01-15"), updatedAt: new Date(), color: "bg-violet-50" },
  { id: "4", title: "Project ideas", content: "Side project ideas:\\n- AI writing assistant\\n- Personal finance tracker\\n- Habit streaks app\\n- Open source contribution bot", tags: ["ideas", "tech"], starred: true, createdAt: new Date("2025-01-20"), updatedAt: new Date(), color: "bg-emerald-50" },
];

export default function App() {
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [selected, setSelected] = useState<Note | null>(notes[0]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(false);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    notes.forEach(n => n.tags.forEach(t => tags.add(t)));
    return [...tags].sort();
  }, [notes]);

  const filtered = useMemo(() => notes.filter(n => {
    if (activeTag && !n.tags.includes(activeTag)) return false;
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt.getTime() - a.updatedAt.getTime()), [notes, search, activeTag]);

  const createNote = () => {
    const note: Note = {
      id: Date.now().toString(),
      title: "Untitled",
      content: "",
      tags: [],
      starred: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    };
    setNotes(n => [note, ...n]);
    setSelected(note);
    setSidebarOpen(false);
  };

  const updateNote = (id: string, patch: Partial<Note>) => {
    const updated = { ...patch, updatedAt: new Date() };
    setNotes(n => n.map(note => note.id === id ? { ...note, ...updated } : note));
    if (selected?.id === id) setSelected(s => s ? { ...s, ...updated } : s);
  };

  const deleteNote = (id: string) => {
    setNotes(n => n.filter(note => note.id !== id));
    if (selected?.id === id) setSelected(filtered.find(n => n.id !== id) || null);
  };

  const toggleStar = (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note) updateNote(id, { starred: !note.starred });
  };

  return (
    <div className="h-screen bg-zinc-100 flex font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className={\`\${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static inset-y-0 left-0 z-50 w-72 bg-white border-r border-zinc-200 flex flex-col transition-transform duration-200 shadow-xl md:shadow-none\`}>
        <div className="p-4 border-b border-zinc-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1">
              <h1 className="font-black text-lg text-zinc-900">Notes</h1>
              <p className="text-xs text-zinc-400">{notes.length} notes</p>
            </div>
            <button onClick={createNote} className="w-8 h-8 bg-zinc-900 text-white rounded-xl flex items-center justify-center hover:bg-violet-600 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
            <button className="md:hidden p-1" onClick={() => setSidebarOpen(false)}><X className="w-4 h-4" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..." className="w-full pl-9 pr-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-700 outline-none focus:border-zinc-300 transition-colors" />
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="p-3 border-b border-zinc-100">
            <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-2 px-1">Tags</p>
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
                <button key={tag} onClick={() => setActiveTag(t => t === tag ? null : tag)} className={\`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors \${activeTag === tag ? "bg-violet-100 text-violet-700" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}\`}>
                  <Hash className="w-2.5 h-2.5" />{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-zinc-400">
              <Tag className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No notes found</p>
            </div>
          ) : filtered.map(note => (
            <button key={note.id} onClick={() => { setSelected(note); setSidebarOpen(false); }} className={\`w-full text-left p-3 rounded-xl mb-1 transition-colors group \${selected?.id === note.id ? "bg-violet-50 border border-violet-200" : "hover:bg-zinc-50"}\`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {note.starred && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                    <p className="text-sm font-semibold text-zinc-900 truncate">{note.title || "Untitled"}</p>
                  </div>
                  <p className="text-xs text-zinc-400 truncate leading-relaxed">{note.content.replace(/\\n/g, " ") || "No content"}</p>
                  <p className="text-[10px] text-zinc-300 mt-1">{note.updatedAt.toLocaleDateString()}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className={\`border-b border-zinc-200 px-6 py-3 flex items-center justify-between \${selected.color}\`}>
              <button className="md:hidden mr-3 p-1" onClick={() => setSidebarOpen(true)}><Menu className="w-5 h-5 text-zinc-500" /></button>
              <div className="flex-1">
                {editTitle ? (
                  <input autoFocus value={selected.title} onChange={e => updateNote(selected.id, { title: e.target.value })} onBlur={() => setEditTitle(false)} onKeyDown={e => e.key === "Enter" && setEditTitle(false)} className="text-xl font-black text-zinc-900 bg-transparent outline-none w-full" />
                ) : (
                  <div className="flex items-center gap-2" onClick={() => setEditTitle(true)}>
                    <h2 className="text-xl font-black text-zinc-900 truncate">{selected.title || "Untitled"}</h2>
                    <Edit3 className="w-3.5 h-3.5 text-zinc-400 opacity-0 group-hover:opacity-100" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {NOTE_COLORS.map(c => (
                  <button key={c} onClick={() => updateNote(selected.id, { color: c })} className={\`w-5 h-5 rounded-full border-2 transition-all \${c} \${selected.color === c ? "border-zinc-400 scale-110" : "border-transparent"}\`} />
                ))}
                <button onClick={() => toggleStar(selected.id)} className={\`p-1.5 rounded-lg transition-colors \${selected.starred ? "text-amber-500 bg-amber-50" : "text-zinc-400 hover:text-zinc-600"}\`}>
                  {selected.starred ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
                </button>
                <button onClick={() => deleteNote(selected.id)} className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <textarea
              value={selected.content}
              onChange={e => updateNote(selected.id, { content: e.target.value })}
              placeholder="Start writing..."
              className={\`flex-1 p-6 text-zinc-700 text-base leading-relaxed outline-none resize-none \${selected.color}\`}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
            <button className="md:hidden absolute top-4 left-4 p-2" onClick={() => setSidebarOpen(true)}><Menu className="w-5 h-5" /></button>
            <Edit3 className="w-12 h-12 mb-3 opacity-20" />
            <p className="font-medium mb-1">No note selected</p>
            <button onClick={createNote} className="text-sm text-violet-500 hover:text-violet-600">Create your first note</button>
          </div>
        )}
      </div>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Chat Interface ────────────────────────────────────────────────────────────

const CHAT_INTERFACE_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, MoreVertical, Phone, Video, Search, Smile, Paperclip, MessageCircle, Users, Settings, Bell, Moon, Hash, Check, CheckCheck } from "lucide-react";

interface Message {
  id: string;
  text: string;
  from: "user" | "other";
  time: string;
  status?: "sent" | "delivered" | "read";
}

interface Channel {
  id: string;
  name: string;
  type: "dm" | "group";
  lastMsg: string;
  time: string;
  unread: number;
  avatar: string;
  online?: boolean;
}

const CHANNELS: Channel[] = [
  { id: "1", name: "Aria Chen", type: "dm", lastMsg: "Sounds great! See you then.", time: "2m", unread: 2, avatar: "AC", online: true },
  { id: "2", name: "Design Team", type: "group", lastMsg: "Marcus: Updated the mockups", time: "14m", unread: 5, avatar: "DT" },
  { id: "3", name: "Sam Nakamura", type: "dm", lastMsg: "Thanks for the feedback!", time: "1h", unread: 0, avatar: "SN", online: true },
  { id: "4", name: "Engineering", type: "group", lastMsg: "Deploy scheduled for 3pm", time: "2h", unread: 0, avatar: "EN" },
  { id: "5", name: "Priya Mehta", type: "dm", lastMsg: "Can you review my PR?", time: "3h", unread: 1, avatar: "PM" },
];

const INITIAL_MESSAGES: Message[] = [
  { id: "1", text: "Hey! Did you get a chance to look at the new design system?", from: "other", time: "10:30 AM", status: "read" },
  { id: "2", text: "Yes! I love the new color tokens. Much more consistent.", from: "user", time: "10:32 AM", status: "read" },
  { id: "3", text: "Exactly! And the spacing scale is so much cleaner now. Fewer magic numbers.", from: "other", time: "10:33 AM", status: "read" },
  { id: "4", text: "Agreed. Should we schedule a handoff call with engineering?", from: "user", time: "10:35 AM", status: "read" },
  { id: "5", text: "Sounds great! See you then.", from: "other", time: "10:36 AM", status: "read" },
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [activeChannel, setActiveChannel] = useState(CHANNELS[0]);
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const msg: Message = { id: Date.now().toString(), text: input.trim(), from: "user", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), status: "sent" };
    setMessages(m => [...m, msg]);
    setInput("");
    setTimeout(() => {
      const replies = ["Got it, thanks!", "I'll take a look 👀", "Sounds good!", "On it!", "Can we discuss this in the standup?"];
      setMessages(m => [...m, { id: Date.now().toString(), text: replies[Math.floor(Math.random() * replies.length)], from: "other", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    }, 1200);
  };

  const bg = dark ? "bg-[#0f0f17]" : "bg-zinc-50";
  const surface = dark ? "bg-[#161621]" : "bg-white";
  const border = dark ? "border-white/[0.06]" : "border-zinc-200";
  const text = dark ? "text-white" : "text-zinc-900";
  const muted = dark ? "text-zinc-500" : "text-zinc-400";

  return (
    <div className={\`h-screen flex font-sans \${bg} \${text}\`}>
      {/* Sidebar */}
      <aside className={\`\${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static inset-y-0 left-0 z-50 w-72 \${surface} border-r \${border} flex flex-col transition-transform duration-200\`}>
        {/* Sidebar Header */}
        <div className={\`p-4 border-b \${border}\`}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-black text-base">Messages</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setDark(!dark)} className={\`p-1.5 rounded-lg \${muted} hover:text-current transition-colors\`}><Moon className="w-4 h-4" /></button>
              <button className={\`p-1.5 rounded-lg \${muted} hover:text-current transition-colors\`}><Settings className="w-4 h-4" /></button>
            </div>
          </div>
          <div className={\`flex items-center gap-2 \${dark ? "bg-white/[0.06]" : "bg-zinc-100"} rounded-xl px-3 py-2\`}>
            <Search className={\`w-3.5 h-3.5 \${muted}\`} />
            <input placeholder="Search..." className={\`bg-transparent flex-1 text-xs outline-none \${muted} placeholder-current\`} />
          </div>
        </div>
        {/* Channel List */}
        <div className="flex-1 overflow-y-auto p-2">
          {CHANNELS.map(ch => (
            <button key={ch.id} onClick={() => { setActiveChannel(ch); setSidebarOpen(false); }} className={\`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors mb-0.5 \${activeChannel.id === ch.id ? (dark ? "bg-white/[0.08]" : "bg-violet-50 border border-violet-100") : (dark ? "hover:bg-white/[0.04]" : "hover:bg-zinc-50")}\`}>
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">{ch.avatar}</div>
                {ch.online && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-current" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-sm font-semibold truncate">{ch.name}</span>
                  <span className={\`text-[10px] \${muted} shrink-0 ml-2\`}>{ch.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <p className={\`text-xs \${muted} truncate flex-1\`}>{ch.lastMsg}</p>
                  {ch.unread > 0 && <span className="ml-2 bg-violet-500 text-white text-[10px] font-bold w-4.5 h-4.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0">{ch.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        {/* User */}
        <div className={\`p-3 border-t \${border} flex items-center gap-3\`}>
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white">ME</div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-current" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">You</p>
            <p className={\`text-[10px] \${muted}\`}>Active now</p>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat Header */}
        <div className={\`h-16 \${surface} border-b \${border} flex items-center justify-between px-4 shrink-0\`}>
          <div className="flex items-center gap-3">
            <button className="md:hidden p-1" onClick={() => setSidebarOpen(true)}><MessageCircle className="w-5 h-5" /></button>
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">{activeChannel.avatar}</div>
              {activeChannel.online && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-current" />}
            </div>
            <div>
              <p className="text-sm font-semibold">{activeChannel.name}</p>
              <p className={\`text-[10px] \${muted}\`}>{activeChannel.online ? "Active now" : "Offline"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className={\`p-2 \${muted} hover:text-current rounded-xl transition-colors\`}><Phone className="w-4 h-4" /></button>
            <button className={\`p-2 \${muted} hover:text-current rounded-xl transition-colors\`}><Video className="w-4 h-4" /></button>
            <button className={\`p-2 \${muted} hover:text-current rounded-xl transition-colors\`}><MoreVertical className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className={\`flex \${msg.from === "user" ? "justify-end" : "justify-start"} items-end gap-2\`}>
              {msg.from === "other" && (
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">{activeChannel.avatar}</div>
              )}
              <div className={\`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl \${msg.from === "user" ? "bg-violet-500 text-white rounded-br-md" : (dark ? "bg-white/[0.07] text-white" : "bg-white border border-zinc-100 text-zinc-800") + " rounded-bl-md"}\`}>
                <p className="text-sm leading-relaxed">{msg.text}</p>
                <div className={\`flex items-center justify-end gap-1 mt-1 \${msg.from === "user" ? "text-violet-200" : muted}\`}>
                  <span className="text-[10px]">{msg.time}</span>
                  {msg.from === "user" && msg.status === "read" && <CheckCheck className="w-3 h-3" />}
                  {msg.from === "user" && msg.status === "delivered" && <Check className="w-3 h-3" />}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className={\`\${surface} border-t \${border} p-4\`}>
          <div className={\`flex items-end gap-3 \${dark ? "bg-white/[0.05]" : "bg-zinc-100"} rounded-2xl px-4 py-3\`}>
            <button className={\`\${muted} hover:text-current transition-colors p-1 shrink-0\`}><Paperclip className="w-4 h-4" /></button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Type a message..."
              rows={1}
              className={\`flex-1 bg-transparent outline-none text-sm resize-none \${muted} placeholder-current leading-relaxed max-h-24\`}
            />
            <button className={\`\${muted} hover:text-current transition-colors p-1 shrink-0\`}><Smile className="w-4 h-4" /></button>
            <button onClick={send} disabled={!input.trim()} className="bg-violet-500 text-white w-8 h-8 rounded-xl flex items-center justify-center hover:bg-violet-400 disabled:opacity-40 transition-colors shrink-0">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Pomodoro Timer ────────────────────────────────────────────────────────────

const POMODORO_TIMER_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState, useEffect, useCallback } from "react";
import { Play, Pause, RotateCcw, Settings, X, Coffee, Brain, CheckCircle, Volume2 } from "lucide-react";

type Mode = "focus" | "short-break" | "long-break";

const DEFAULTS: Record<Mode, number> = {
  "focus": 25,
  "short-break": 5,
  "long-break": 15,
};

const MODE_CONFIG: Record<Mode, { label: string; color: string; gradient: string; icon: typeof Brain }> = {
  "focus": { label: "Focus", color: "text-violet-400", gradient: "from-violet-600 to-indigo-700", icon: Brain },
  "short-break": { label: "Short Break", color: "text-emerald-400", gradient: "from-emerald-600 to-teal-700", icon: Coffee },
  "long-break": { label: "Long Break", color: "text-blue-400", gradient: "from-blue-600 to-cyan-700", icon: Coffee },
};

interface Task {
  id: string;
  text: string;
  done: boolean;
  pomodoros: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return \`\${m}:\${s}\`;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("focus");
  const [durations, setDurations] = useState(DEFAULTS);
  const [seconds, setSeconds] = useState(DEFAULTS.focus * 60);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", text: "Review design specs", done: false, pomodoros: 2 },
    { id: "2", text: "Write unit tests for auth module", done: false, pomodoros: 1 },
    { id: "3", text: "Deploy staging environment", done: true, pomodoros: 3 },
  ]);
  const [newTask, setNewTask] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [tempDurations, setTempDurations] = useState(DEFAULTS);

  const total = durations[mode] * 60;
  const progress = 1 - seconds / total;

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setSeconds(durations[m] * 60);
    setRunning(false);
  }, [durations]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          setRunning(false);
          if (mode === "focus") setSessions(n => n + 1);
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, mode]);

  const reset = () => { setSeconds(durations[mode] * 60); setRunning(false); };

  const addTask = () => {
    if (!newTask.trim()) return;
    setTasks(t => [...t, { id: Date.now().toString(), text: newTask.trim(), done: false, pomodoros: 1 }]);
    setNewTask("");
  };

  const config = MODE_CONFIG[mode];
  const ModeIcon = config.icon;
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white font-sans flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-md px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold">Pomodoro</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/[0.06] px-3 py-1.5 rounded-full text-xs">
            <CheckCircle className="w-3 h-3 text-violet-400" />
            <span>{sessions} sessions today</span>
          </div>
          <button onClick={() => { setTempDurations(durations); setShowSettings(true); }} className="p-2 text-zinc-500 hover:text-white transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-8 w-full max-w-md">
        {/* Mode Switcher */}
        <div className="flex bg-white/[0.06] rounded-full p-1 mb-10">
          {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([key, { label }]) => (
            <button key={key} onClick={() => switchMode(key)} className={\`px-4 py-1.5 rounded-full text-xs font-medium transition-all \${mode === key ? \`bg-gradient-to-r \${config.gradient} text-white shadow-lg\` : "text-zinc-400 hover:text-white"}\`}>
              {label}
            </button>
          ))}
        </div>

        {/* Timer Circle */}
        <div className="relative mb-10">
          <svg width="240" height="240" className="-rotate-90">
            <circle cx="120" cy="120" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
            <circle
              cx="120" cy="120" r={radius}
              fill="none"
              stroke="url(#grad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-all duration-1000"
            />
            <defs>
              <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <ModeIcon className={\`w-5 h-5 \${config.color} mb-2\`} />
            <span className="text-5xl font-black tabular-nums">{formatTime(seconds)}</span>
            <span className={\`text-xs font-medium mt-1 \${config.color}\`}>{config.label}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-10">
          <button onClick={reset} className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <RotateCcw className="w-5 h-5" />
          </button>
          <button onClick={() => setRunning(!running)} className={\`w-16 h-16 rounded-full bg-gradient-to-br \${config.gradient} flex items-center justify-center shadow-2xl hover:scale-105 transition-transform active:scale-95\`}>
            {running ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
          <button className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <Volume2 className="w-5 h-5" />
          </button>
        </div>

        {/* Tasks */}
        <div className="w-full">
          <h2 className="text-sm font-semibold text-zinc-400 mb-3">Tasks</h2>
          <div className="space-y-2 mb-3">
            {tasks.map(task => (
              <div key={task.id} className={\`flex items-center gap-3 p-3 rounded-xl border transition-colors \${task.done ? "bg-white/[0.02] border-white/[0.04] opacity-50" : "bg-white/[0.05] border-white/[0.08]"}\`}>
                <button onClick={() => setTasks(t => t.map(t2 => t2.id === task.id ? { ...t2, done: !t2.done } : t2))} className={\`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors \${task.done ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"}\`}>
                  {task.done && <CheckCircle className="w-3 h-3" />}
                </button>
                <span className={\`flex-1 text-sm \${task.done ? "line-through text-zinc-500" : "text-zinc-200"}\`}>{task.text}</span>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Brain className="w-3 h-3 text-violet-400" />
                  <span>{task.pomodoros}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a task..." className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/40" />
            <button onClick={addTask} className="bg-violet-500 hover:bg-violet-400 px-4 py-2 rounded-xl text-sm font-medium transition-colors">Add</button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a2e] border border-white/[0.08] rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold">Timer Settings</h2>
              <button onClick={() => setShowSettings(false)}><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            {(Object.entries(DEFAULTS) as [Mode, number][]).map(([key]) => (
              <div key={key} className="flex items-center justify-between mb-4">
                <span className="text-sm text-zinc-300">{MODE_CONFIG[key].label}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTempDurations(d => ({ ...d, [key]: Math.max(1, d[key] - 1) }))} className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center text-zinc-300 hover:bg-white/10 transition-colors">-</button>
                  <span className="text-sm font-bold w-8 text-center">{tempDurations[key]}m</span>
                  <button onClick={() => setTempDurations(d => ({ ...d, [key]: Math.min(60, d[key] + 1) }))} className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center text-zinc-300 hover:bg-white/10 transition-colors">+</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowSettings(false)} className="flex-1 py-2 border border-white/[0.08] rounded-xl text-sm text-zinc-400">Cancel</button>
              <button onClick={() => { setDurations(tempDurations); setSeconds(tempDurations[mode] * 60); setRunning(false); setShowSettings(false); }} className="flex-1 py-2 bg-violet-500 hover:bg-violet-400 rounded-xl text-sm font-semibold transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Blog ─────────────────────────────────────────────────────────────────────

const BLOG_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { Search, ArrowRight, Clock, Tag, Twitter, Github, Rss, BookOpen, TrendingUp } from "lucide-react";

const POSTS = [
  { id: 1, title: "Building Scalable React Apps: Lessons from 2 Years of Production", slug: "scalable-react", excerpt: "What I learned shipping React apps to millions of users — architecture decisions, performance tricks, and the mistakes I'd avoid.", category: "Engineering", readTime: "8 min", date: "Jan 28, 2025", emoji: "⚛️", featured: true, tags: ["React", "Architecture", "Performance"] },
  { id: 2, title: "The Hidden Cost of Technical Debt", slug: "tech-debt", excerpt: "Technical debt isn't just slow features — it's team morale, hiring, and compounding interest on every future decision.", category: "Engineering", readTime: "6 min", date: "Jan 20, 2025", emoji: "💸", featured: false, tags: ["Engineering", "Teams"] },
  { id: 3, title: "Design Systems: The Investment that Pays for Itself", slug: "design-systems", excerpt: "Why building a design system felt slow at first — and how it became our biggest productivity multiplier.", category: "Design", readTime: "10 min", date: "Jan 14, 2025", emoji: "🎨", featured: false, tags: ["Design", "Productivity"] },
  { id: 4, title: "On Writing Code for the Next Developer", slug: "readable-code", excerpt: "Code is read far more often than it's written. Here's how I think about clarity, naming, and leaving the codebase better than I found it.", category: "Engineering", readTime: "5 min", date: "Jan 7, 2025", emoji: "📝", featured: false, tags: ["Code Quality", "Best Practices"] },
  { id: 5, title: "How to Actually Get Faster at Coding", slug: "coding-speed", excerpt: "Speed isn't about typing faster. It's about making fewer decisions under uncertainty — and how you can get there.", category: "Productivity", readTime: "7 min", date: "Dec 30, 2024", emoji: "🚀", featured: false, tags: ["Productivity", "Learning"] },
];

const CATS = ["All", "Engineering", "Design", "Productivity"];

export default function App() {
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedPost, setSelectedPost] = useState<typeof POSTS[0] | null>(null);

  const filtered = POSTS.filter(p => (cat === "All" || p.category === cat) && (p.title.toLowerCase().includes(search.toLowerCase()) || p.excerpt.toLowerCase().includes(search.toLowerCase())));
  const featured = filtered.find(p => p.featured);
  const rest = filtered.filter(p => !p.featured);

  if (selectedPost) {
    return (
      <div className="min-h-screen bg-white font-sans">
        <nav className="border-b border-zinc-100 sticky top-0 bg-white/80 backdrop-blur-xl z-10">
          <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
            <button onClick={() => setSelectedPost(null)} className="text-sm font-medium text-zinc-500 hover:text-zinc-900 flex items-center gap-1">
              ← Back to blog
            </button>
            <span className="text-xs text-zinc-400">{selectedPost.readTime} read</span>
          </div>
        </nav>
        <article className="max-w-3xl mx-auto px-5 py-12">
          <div className="text-6xl mb-6">{selectedPost.emoji}</div>
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-violet-50 text-violet-600 text-xs font-semibold px-2.5 py-1 rounded-full">{selectedPost.category}</span>
            <span className="text-xs text-zinc-400 flex items-center gap-1"><Clock className="w-3 h-3" />{selectedPost.readTime}</span>
            <span className="text-xs text-zinc-400">{selectedPost.date}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-zinc-900 leading-tight mb-5">{selectedPost.title}</h1>
          <p className="text-lg text-zinc-500 leading-relaxed mb-8 border-l-4 border-violet-200 pl-5">{selectedPost.excerpt}</p>
          <div className="prose prose-zinc max-w-none">
            <p className="text-zinc-600 leading-relaxed text-base">This is where the full article content would appear. You can connect this to a CMS like Contentful, Sanity, or use MDX files to render rich content here.</p>
            <p className="text-zinc-600 leading-relaxed text-base mt-4">The template is designed to be extended with your own content management system or static content approach.</p>
          </div>
          <div className="flex flex-wrap gap-2 mt-8 pt-8 border-t border-zinc-100">
            {selectedPost.tags.map(tag => (
              <span key={tag} className="text-xs bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                <Tag className="w-2.5 h-2.5" />{tag}
              </span>
            ))}
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-500" />
            <span className="font-black text-lg text-zinc-900">alexblog<span className="text-violet-500">.</span></span>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            {[Twitter, Github, Rss].map((Icon, i) => (
              <a key={i} href="#" className="p-2 text-zinc-400 hover:text-zinc-700 transition-colors"><Icon className="w-4 h-4" /></a>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-10">
        {/* Hero */}
        <div className="mb-12">
          <p className="text-violet-500 text-sm font-semibold mb-2">Writing about engineering & design</p>
          <h1 className="text-4xl font-black text-zinc-900 mb-3">Thoughts, patterns, and things I've learned.</h1>
          <p className="text-zinc-500 text-lg">A slow-drip newsletter from someone who loves shipping things.</p>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search articles..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-700 outline-none focus:border-violet-300 transition-colors" />
          </div>
          <div className="flex gap-1">
            {CATS.map(c => (
              <button key={c} onClick={() => setCat(c)} className={\`px-3 py-2 rounded-xl text-sm font-medium transition-colors \${cat === c ? "bg-zinc-900 text-white" : "bg-white border border-zinc-200 text-zinc-500 hover:border-zinc-300"}\`}>{c}</button>
            ))}
          </div>
        </div>

        {/* Featured */}
        {featured && (
          <div onClick={() => setSelectedPost(featured)} className="bg-white border border-zinc-200 rounded-2xl p-7 mb-8 cursor-pointer hover:border-violet-200 hover:shadow-md transition-all group">
            <div className="flex items-start gap-5">
              <div className="text-5xl">{featured.emoji}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-violet-50 text-violet-600 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" />Featured</span>
                  <span className="bg-zinc-100 text-zinc-500 text-xs px-2 py-0.5 rounded-full">{featured.category}</span>
                  <span className="text-xs text-zinc-400 flex items-center gap-1"><Clock className="w-3 h-3" />{featured.readTime}</span>
                </div>
                <h2 className="text-2xl font-black text-zinc-900 leading-tight mb-3 group-hover:text-violet-600 transition-colors">{featured.title}</h2>
                <p className="text-zinc-500 leading-relaxed text-sm mb-4">{featured.excerpt}</p>
                <div className="flex items-center gap-2 text-violet-500 text-sm font-semibold">Read article <ArrowRight className="w-4 h-4" /></div>
              </div>
            </div>
          </div>
        )}

        {/* Posts grid */}
        <div className="grid md:grid-cols-2 gap-5">
          {rest.map(post => (
            <article key={post.id} onClick={() => setSelectedPost(post)} className="bg-white border border-zinc-200 rounded-2xl p-6 cursor-pointer hover:border-violet-200 hover:shadow-md transition-all group">
              <div className="text-4xl mb-4">{post.emoji}</div>
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-zinc-100 text-zinc-500 text-xs px-2 py-0.5 rounded-full">{post.category}</span>
                <span className="text-xs text-zinc-400 flex items-center gap-1"><Clock className="w-3 h-3" />{post.readTime}</span>
              </div>
              <h2 className="text-base font-bold text-zinc-900 leading-snug mb-2 group-hover:text-violet-600 transition-colors">{post.title}</h2>
              <p className="text-sm text-zinc-500 leading-relaxed line-clamp-2">{post.excerpt}</p>
              <p className="text-xs text-zinc-400 mt-3">{post.date}</p>
            </article>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-zinc-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No articles found</p>
            <button onClick={() => { setSearch(""); setCat("All"); }} className="text-sm text-violet-500 mt-2">Clear filters</button>
          </div>
        )}
      </main>
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Habit Tracker ────────────────────────────────────────────────────────────

const HABIT_TRACKER_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { Plus, Flame, Check, Trophy, Target, X, Calendar, TrendingUp } from "lucide-react";

interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  completedDays: Set<number>;
  goal: number;
}

const COLORS = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500"];

const DAYS_BACK = 21;
const today = new Date();
const dayLabels = Array.from({ length: DAYS_BACK }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - (DAYS_BACK - 1 - i));
  return { date: d, dayIndex: i, label: d.toLocaleDateString("en", { weekday: "short" }).slice(0, 2), dateNum: d.getDate() };
});

const INITIAL_HABITS: Habit[] = [
  { id: "1", name: "Morning run", emoji: "🏃", color: "bg-violet-500", completedDays: new Set([0,1,3,4,5,7,8,9,10,11,12,14,15,16,17,18,19,20]), goal: 7 },
  { id: "2", name: "Read 30 minutes", emoji: "📚", color: "bg-blue-500", completedDays: new Set([1,2,3,5,6,8,9,11,12,13,15,16,18,19,20]), goal: 7 },
  { id: "3", name: "Meditate", emoji: "🧘", color: "bg-emerald-500", completedDays: new Set([2,4,6,8,10,12,14,16,18,20]), goal: 5 },
  { id: "4", name: "Drink 2L water", emoji: "💧", color: "bg-cyan-500", completedDays: new Set([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]), goal: 7 },
];

function calcStreak(habit: Habit): number {
  let streak = 0;
  for (let i = DAYS_BACK - 1; i >= 0; i--) {
    if (habit.completedDays.has(i)) streak++;
    else break;
  }
  return streak;
}

export default function App() {
  const [habits, setHabits] = useState<Habit[]>(INITIAL_HABITS);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("⭐");
  const [newColor, setNewColor] = useState(COLORS[0]);

  const toggle = (habitId: string, dayIndex: number) => {
    setHabits(h => h.map(habit => {
      if (habit.id !== habitId) return habit;
      const days = new Set(habit.completedDays);
      days.has(dayIndex) ? days.delete(dayIndex) : days.add(dayIndex);
      return { ...habit, completedDays: days };
    }));
  };

  const addHabit = () => {
    if (!newName.trim()) return;
    setHabits(h => [...h, { id: Date.now().toString(), name: newName.trim(), emoji: newEmoji, color: newColor, completedDays: new Set(), goal: 5 }]);
    setNewName(""); setNewEmoji("⭐"); setShowAdd(false);
  };

  const todayCompleted = habits.filter(h => h.completedDays.has(DAYS_BACK - 1)).length;
  const todayTotal = habits.length;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/[0.06] px-5 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-black">Daily Habits</h1>
              <p className="text-xs text-zinc-500 mt-0.5">{today.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p>
            </div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
              <Plus className="w-4 h-4" />New
            </button>
          </div>

          {/* Today's progress */}
          <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Target className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Today's Progress</p>
              <p className="text-xs text-zinc-500">{todayCompleted} of {todayTotal} completed</p>
              <div className="h-1.5 bg-white/[0.06] rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500" style={{ width: \`\${todayTotal ? (todayCompleted / todayTotal) * 100 : 0}%\` }} />
              </div>
            </div>
            {todayCompleted === todayTotal && todayTotal > 0 && <Trophy className="w-6 h-6 text-amber-400" />}
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="max-w-3xl mx-auto px-4 py-6 overflow-x-auto">
        {/* Day labels */}
        <div className="flex gap-1 mb-2" style={{ paddingLeft: "160px" }}>
          {dayLabels.map((d, i) => (
            <div key={i} className={\`flex-shrink-0 w-8 text-center \${i === DAYS_BACK - 1 ? "text-violet-400 font-bold" : "text-zinc-600"}\`}>
              <div className="text-[9px]">{d.label}</div>
              <div className="text-[9px]">{d.dateNum}</div>
            </div>
          ))}
        </div>

        {/* Habits */}
        <div className="space-y-2">
          {habits.map(habit => {
            const streak = calcStreak(habit);
            const completedThis7 = [...habit.completedDays].filter(d => d >= DAYS_BACK - 7).length;
            return (
              <div key={habit.id} className="flex items-center gap-1">
                {/* Label */}
                <div className="w-40 flex-shrink-0 flex items-center gap-2 pr-2">
                  <span className="text-lg">{habit.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{habit.name}</p>
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Flame className={\`w-2.5 h-2.5 \${streak > 0 ? "text-orange-400" : ""}\`} />
                      <span>{streak}d</span>
                    </div>
                  </div>
                </div>

                {/* Cells */}
                {dayLabels.map((d, i) => {
                  const done = habit.completedDays.has(i);
                  const isToday = i === DAYS_BACK - 1;
                  return (
                    <button
                      key={i}
                      onClick={() => toggle(habit.id, i)}
                      className={\`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all \${done ? \`\${habit.color} shadow-sm\` : isToday ? "bg-white/[0.08] border border-white/10" : "bg-white/[0.03] hover:bg-white/[0.07]"}\`}
                    >
                      {done && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  );
                })}

                {/* Stats */}
                <div className="ml-2 text-[10px] text-zinc-500 flex items-center gap-1 flex-shrink-0">
                  <TrendingUp className="w-2.5 h-2.5" />
                  {completedThis7}/{Math.min(7, habit.goal)}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#161621] border border-white/[0.08] rounded-2xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold">New Habit</h2>
              <button onClick={() => setShowAdd(false)}><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <div className="flex gap-3 mb-4">
              <input value={newEmoji} onChange={e => setNewEmoji(e.target.value.slice(-2) || "⭐")} className="w-14 text-center text-2xl bg-white/[0.05] border border-white/[0.08] rounded-xl outline-none" />
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addHabit()} placeholder="Habit name..." className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500/40" />
            </div>
            <div className="flex gap-2 mb-5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)} className={\`w-7 h-7 rounded-full \${c} transition-all \${newColor === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#161621] scale-110" : ""}\`} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2 border border-white/[0.08] rounded-xl text-sm text-zinc-400">Cancel</button>
              <button onClick={addHabit} disabled={!newName.trim()} className="flex-1 py-2 bg-violet-500 hover:bg-violet-400 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">Add Habit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Restaurant Menu ──────────────────────────────────────────────────────────

const RESTAURANT_MENU_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState } from "react";
import { ShoppingBag, Plus, Minus, X, Star, Clock, ChefHat, ArrowRight, MapPin } from "lucide-react";

const MENU = {
  "Starters": [
    { id: 1, name: "Truffle Arancini", desc: "Crispy risotto balls with black truffle and mozzarella", price: 14, emoji: "🧆", veg: true, popular: true },
    { id: 2, name: "Burrata Caprese", desc: "Fresh burrata, heirloom tomatoes, aged balsamic", price: 17, emoji: "🧀", veg: true, popular: false },
    { id: 3, name: "Beef Carpaccio", desc: "Thinly sliced beef, capers, parmesan, olive oil", price: 19, emoji: "🥩", veg: false, popular: true },
  ],
  "Mains": [
    { id: 4, name: "Wagyu Burger", desc: "A5 Wagyu beef, aged cheddar, truffle mayo, brioche bun", price: 38, emoji: "🍔", veg: false, popular: true },
    { id: 5, name: "Lobster Linguine", desc: "Half Boston lobster, cherry tomatoes, fresh pasta, bisque", price: 52, emoji: "🦞", veg: false, popular: false },
    { id: 6, name: "Wild Mushroom Risotto", desc: "Arborio rice, porcini, parmesan, truffle oil", price: 28, emoji: "🍄", veg: true, popular: false },
    { id: 7, name: "Duck Confit", desc: "48h confit duck leg, cherry reduction, potato gratin", price: 42, emoji: "🦆", veg: false, popular: true },
  ],
  "Desserts": [
    { id: 8, name: "Chocolate Fondant", desc: "Warm dark chocolate cake, vanilla ice cream, raspberry coulis", price: 13, emoji: "🍫", veg: true, popular: true },
    { id: 9, name: "Crème Brûlée", desc: "Classic vanilla custard, caramelized sugar crust", price: 11, emoji: "🍮", veg: true, popular: false },
  ],
};

type OrderItem = { id: number; name: string; price: number; qty: number; emoji: string };

export default function App() {
  const [activeSection, setActiveSection] = useState("Starters");
  const [order, setOrder] = useState<OrderItem[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);

  const addItem = (item: { id: number; name: string; price: number; emoji: string }) => {
    setOrder(o => {
      const ex = o.find(i => i.id === item.id);
      if (ex) return o.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      return [...o, { ...item, qty: 1 }];
    });
  };

  const updateQty = (id: number, delta: number) => {
    setOrder(o => o.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const totalItems = order.reduce((s, i) => s + i.qty, 0);
  const subtotal = order.reduce((s, i) => s + i.price * i.qty, 0);
  const sections = Object.keys(MENU);

  return (
    <div className="min-h-screen bg-[#0f0b08] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/[0.08] bg-[#0f0b08]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <ChefHat className="w-5 h-5 text-amber-400" />
                <h1 className="font-black text-xl tracking-tight">Maison Noir</h1>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400 fill-amber-400" />4.9 (284)</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />30-45 min</span>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />0.3 mi</span>
              </div>
            </div>
            <button onClick={() => setOrderOpen(true)} className="relative flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors">
              <ShoppingBag className="w-4 h-4" />
              Order
              {totalItems > 0 && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center">{totalItems}</span>}
            </button>
          </div>

          {/* Section Tabs */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {sections.map(s => (
              <button key={s} onClick={() => setActiveSection(s)} className={\`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all \${activeSection === s ? "bg-amber-500 text-black font-bold" : "text-zinc-400 hover:text-white"}\`}>{s}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Menu */}
      <main className="max-w-5xl mx-auto px-5 py-8">
        <h2 className="text-xl font-black mb-6 text-zinc-200">{activeSection}</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {MENU[activeSection as keyof typeof MENU].map(item => {
            const inOrder = order.find(o => o.id === item.id);
            return (
              <div key={item.id} className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-5 flex gap-4 hover:border-white/10 transition-colors">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 flex items-center justify-center text-4xl shrink-0">
                  {item.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-1">
                    <h3 className="font-bold text-sm leading-tight flex-1">{item.name}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.veg && <span className="text-[9px] text-emerald-400 border border-emerald-400/40 px-1 py-0.5 rounded">VEG</span>}
                      {item.popular && <span className="text-[9px] text-amber-400 border border-amber-400/40 px-1 py-0.5 rounded">POPULAR</span>}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed mb-3">{item.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-black text-amber-400">\${item.price}</span>
                    {inOrder ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-lg bg-white/[0.07] flex items-center justify-center hover:bg-white/10 transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold w-4 text-center">{inOrder.qty}</span>
                        <button onClick={() => addItem(item)} className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center hover:bg-amber-400 transition-colors">
                          <Plus className="w-3.5 h-3.5 text-black" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => addItem(item)} className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-2 rounded-xl transition-colors">
                        <Plus className="w-3.5 h-3.5" />Add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Order Drawer */}
      {orderOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOrderOpen(false)} />
          <div className="relative w-full max-w-sm bg-[#151009] border-l border-white/[0.08] flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/[0.08]">
              <h2 className="font-black text-lg">Your Order</h2>
              <button onClick={() => setOrderOpen(false)}><X className="w-5 h-5 text-zinc-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {order.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                  <ShoppingBag className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">Your order is empty</p>
                </div>
              ) : order.map(item => (
                <div key={item.id} className="flex items-center gap-3 bg-white/[0.04] rounded-xl p-3">
                  <span className="text-2xl">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.name}</p>
                    <p className="text-amber-400 text-sm font-bold">\${(item.price * item.qty).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateQty(item.id, -1)} className="w-6 h-6 rounded-lg bg-white/[0.07] flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                    <span className="text-sm font-bold w-4 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(item.id, 1)} className="w-6 h-6 rounded-lg bg-white/[0.07] flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
            {order.length > 0 && (
              <div className="p-4 border-t border-white/[0.08]">
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm"><span className="text-zinc-400">Subtotal</span><span>\${subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-zinc-400">Service (12%)</span><span>\${(subtotal * 0.12).toFixed(2)}</span></div>
                  <div className="flex justify-between font-black text-base border-t border-white/[0.08] pt-2 mt-2">
                    <span>Total</span><span className="text-amber-400">\${(subtotal * 1.12).toFixed(2)}</span>
                  </div>
                </div>
                <button className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                  Place Order <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Budget Tracker ───────────────────────────────────────────────────────────

const BUDGET_TRACKER_FILES: TemplateBundleFile[] = [
  {
    path: "src/App.tsx",
    content: `import { useState, useMemo } from "react";
import { Plus, ArrowUpRight, ArrowDownLeft, Wallet, TrendingUp, TrendingDown, DollarSign, Trash2, X } from "lucide-react";

type TxType = "income" | "expense";
interface Tx {
  id: string;
  description: string;
  amount: number;
  type: TxType;
  category: string;
  date: string;
}

const CATEGORIES: Record<TxType, string[]> = {
  income: ["Salary", "Freelance", "Investments", "Other"],
  expense: ["Housing", "Food", "Transport", "Entertainment", "Health", "Shopping", "Bills", "Other"],
};

const CAT_EMOJIS: Record<string, string> = {
  Salary: "💼", Freelance: "💻", Investments: "📈", Housing: "🏠", Food: "🍔", Transport: "🚗",
  Entertainment: "🎬", Health: "💊", Shopping: "🛍️", Bills: "⚡", Other: "📦",
};

const INITIAL_TX: Tx[] = [
  { id: "1", description: "Monthly salary", amount: 5200, type: "income", category: "Salary", date: "2025-01-25" },
  { id: "2", description: "Freelance project - Nexus", amount: 1800, type: "income", category: "Freelance", date: "2025-01-22" },
  { id: "3", description: "Apartment rent", amount: 1400, type: "expense", category: "Housing", date: "2025-01-01" },
  { id: "4", description: "Groceries - Weekly", amount: 120, type: "expense", category: "Food", date: "2025-01-24" },
  { id: "5", description: "Netflix & Spotify", amount: 28, type: "expense", category: "Entertainment", date: "2025-01-15" },
  { id: "6", description: "Gym membership", amount: 45, type: "expense", category: "Health", date: "2025-01-03" },
  { id: "7", description: "Electricity bill", amount: 85, type: "expense", category: "Bills", date: "2025-01-10" },
  { id: "8", description: "Uber rides", amount: 67, type: "expense", category: "Transport", date: "2025-01-20" },
];

export default function App() {
  const [transactions, setTransactions] = useState<Tx[]>(INITIAL_TX);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ description: "", amount: "", type: "expense" as TxType, category: "Food" });
  const [filter, setFilter] = useState<"all" | TxType>("all");

  const totalIncome = useMemo(() => transactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0), [transactions]);
  const balance = totalIncome - totalExpense;

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter(t => t.type === "expense").forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [transactions]);

  const filtered = useMemo(() => [...transactions].filter(t => filter === "all" || t.type === filter).sort((a, b) => b.date.localeCompare(a.date)), [transactions, filter]);

  const addTx = () => {
    const amount = parseFloat(form.amount);
    if (!form.description.trim() || isNaN(amount) || amount <= 0) return;
    const tx: Tx = { id: Date.now().toString(), description: form.description.trim(), amount, type: form.type, category: form.category, date: new Date().toISOString().slice(0, 10) };
    setTransactions(t => [tx, ...t]);
    setForm({ description: "", amount: "", type: "expense", category: "Food" });
    setShowAdd(false);
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-violet-500" />
            <span className="font-black text-zinc-900 text-lg">Budget</span>
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
            <Plus className="w-4 h-4" />Add
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-6 space-y-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Balance", value: balance, icon: DollarSign, color: balance >= 0 ? "text-emerald-500" : "text-red-500", bg: balance >= 0 ? "bg-emerald-50" : "bg-red-50" },
            { label: "Income", value: totalIncome, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-50" },
            { label: "Expenses", value: totalExpense, icon: TrendingDown, color: "text-red-500", bg: "bg-red-50" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-4">
              <div className={\`w-8 h-8 \${bg} rounded-xl flex items-center justify-center mb-3\`}>
                <Icon className={\`w-4 h-4 \${color}\`} />
              </div>
              <p className="text-xs text-zinc-400 font-medium">{label}</p>
              <p className={\`text-xl font-black mt-0.5 \${color}\`}>
                {value < 0 ? "-" : ""}\${Math.abs(value).toLocaleString("en", { minimumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>

        {/* Spending breakdown */}
        {byCategory.length > 0 && (
          <div className="bg-white border border-zinc-100 rounded-2xl p-5">
            <h2 className="font-bold text-zinc-900 text-sm mb-4">Top Spending</h2>
            <div className="space-y-3">
              {byCategory.map(([cat, amount]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-600 font-medium flex items-center gap-1.5">
                      <span>{CAT_EMOJIS[cat] || "📦"}</span>{cat}
                    </span>
                    <span className="text-zinc-900 font-bold">\${amount.toFixed(0)}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div style={{ width: \`\${(amount / byCategory[0][1]) * 100}%\` }} className="h-full bg-gradient-to-r from-violet-400 to-violet-600 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transactions */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-zinc-900 text-sm">Transactions</h2>
            <div className="flex gap-1">
              {(["all", "income", "expense"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={\`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors \${filter === f ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100"}\`}>{f}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {filtered.slice(0, 20).map(tx => (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-50 transition-colors group">
                <div className={\`w-9 h-9 rounded-xl flex items-center justify-center text-lg \${tx.type === "income" ? "bg-emerald-50" : "bg-red-50"}\`}>
                  {CAT_EMOJIS[tx.category] || "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{tx.description}</p>
                  <p className="text-xs text-zinc-400">{tx.category} · {new Date(tx.date).toLocaleDateString("en", { month: "short", day: "numeric" })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={\`text-sm font-bold flex items-center gap-0.5 \${tx.type === "income" ? "text-emerald-500" : "text-red-500"}\`}>
                    {tx.type === "income" ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                    \${tx.amount.toFixed(2)}
                  </span>
                  <button onClick={() => setTransactions(t => t.filter(x => x.id !== tx.id))} className="opacity-0 group-hover:opacity-100 p-1 text-zinc-300 hover:text-red-400 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-zinc-900">Add Transaction</h2>
              <button onClick={() => setShowAdd(false)}><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <div className="flex gap-2 mb-4">
              {(["expense", "income"] as TxType[]).map(t => (
                <button key={t} onClick={() => { setForm(f => ({ ...f, type: t, category: CATEGORIES[t][0] })); }} className={\`flex-1 py-2 rounded-xl text-sm font-semibold capitalize transition-colors \${form.type === t ? (t === "income" ? "bg-emerald-500 text-white" : "bg-red-500 text-white") : "bg-zinc-100 text-zinc-500"}\`}>{t}</button>
              ))}
            </div>
            <div className="space-y-3">
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 outline-none focus:border-violet-300" />
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount ($)" className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 outline-none focus:border-violet-300" />
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 outline-none focus:border-violet-300">
                {CATEGORIES[form.type].map(c => <option key={c} value={c}>{CAT_EMOJIS[c]} {c}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-500">Cancel</button>
              <button onClick={addTx} disabled={!form.description.trim() || !form.amount} className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 transition-colors">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `@import "tailwindcss";
`,
  },
];

// ─── Bundle Registry ──────────────────────────────────────────────────────────

export const TEMPLATE_BUNDLES: Record<string, TemplateBundleFile[]> = {
  // Exact match by template id or name keyword
  "saas-landing": SAAS_LANDING_FILES,
  "analytics-dashboard": ANALYTICS_DASHBOARD_FILES,
  "ecommerce-store": ECOMMERCE_STORE_FILES,
  "kanban-tracker": KANBAN_FILES,
  "portfolio": PORTFOLIO_FILES,
  "notes-app": NOTES_APP_FILES,
  "chat-interface": CHAT_INTERFACE_FILES,
  "pomodoro-timer": POMODORO_TIMER_FILES,
  "blog": BLOG_FILES,
  "habit-tracker": HABIT_TRACKER_FILES,
  "restaurant-menu": RESTAURANT_MENU_FILES,
  "budget-tracker": BUDGET_TRACKER_FILES,
};

/**
 * Find the best bundle for a template by checking its id and name keywords.
 */
export function findBundleForTemplate(templateId: string, templateName: string): TemplateBundleFile[] | null {
  // Direct id match
  if (TEMPLATE_BUNDLES[templateId]) return TEMPLATE_BUNDLES[templateId];

  // Keyword match on normalized name
  const normalized = templateName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const keywords: Array<[string, string]> = [
    ["saas", "saas-landing"],
    ["landing", "saas-landing"],
    ["analytics", "analytics-dashboard"],
    ["dashboard", "analytics-dashboard"],
    ["ecommerce", "ecommerce-store"],
    ["commerce", "ecommerce-store"],
    ["shop", "ecommerce-store"],
    ["store", "ecommerce-store"],
    ["kanban", "kanban-tracker"],
    ["project-tracker", "kanban-tracker"],
    ["tracker", "kanban-tracker"],
    ["portfolio", "portfolio"],
    ["notes", "notes-app"],
    ["note", "notes-app"],
    ["chat", "chat-interface"],
    ["message", "chat-interface"],
    ["pomodoro", "pomodoro-timer"],
    ["timer", "pomodoro-timer"],
    ["blog", "blog"],
    ["article", "blog"],
    ["habit", "habit-tracker"],
    ["restaurant", "restaurant-menu"],
    ["menu", "restaurant-menu"],
    ["budget", "budget-tracker"],
    ["finance", "budget-tracker"],
    ["expense", "budget-tracker"],
  ];

  for (const [keyword, bundleKey] of keywords) {
    if (normalized.includes(keyword)) return TEMPLATE_BUNDLES[bundleKey] || null;
  }

  // Default: SaaS landing as a universally useful fallback
  return SAAS_LANDING_FILES;
}

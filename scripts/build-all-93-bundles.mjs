import fs from "node:fs";
import path from "node:path";

// Load the 67 motion bundles
const bundles = JSON.parse(fs.readFileSync("src/lib/starter-bundles.json", "utf-8"));

// 27 additional high quality implementations
const extra = {
  "antislop-cargo-group": {
    title: "CargoX Global Logistics",
    category: "Apps",
    appCode: `import React, { useState } from "react";
import { Truck, Ship, Plane, Search, ArrowRight, Shield, Globe2, BarChart3, CheckCircle2 } from "lucide-react";

export default function App() {
  const [trackingId, setTrackingId] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingId.trim()) return;
    setStatus("Shipment # " + trackingId.toUpperCase() + " is in transit to Rotterdam Terminal (ETA: 14h)");
  };

  return (
    <div className="min-h-screen bg-[#0d0d12] text-white font-sans antialiased flex flex-col justify-between">
      <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center font-black text-black text-xl">CX</div>
          <div>
            <span className="font-extrabold tracking-wider text-lg">CARGOX</span>
            <span className="text-amber-400 text-xs block font-bold tracking-widest">LOGISTICS GLOBAL</span>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm text-zinc-400 font-medium">
          <a href="#" className="hover:text-white transition-colors">Ocean Freight</a>
          <a href="#" className="hover:text-white transition-colors">Air Express</a>
          <a href="#" className="hover:text-white transition-colors">Supply Chain</a>
        </nav>
        <button className="bg-amber-400 text-black px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-300 transition-colors">
          Get Instant Quote
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16 w-full">
        <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 text-amber-300 px-3 py-1.5 rounded-full text-xs font-semibold mb-6">
          <Globe2 className="w-3.5 h-3.5" /> Direct connections across 180+ global ports
        </div>
        <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.05] max-w-4xl mb-6">
          Engineered for <span className="text-amber-400 underline decoration-amber-400/40">uncompromising</span> global freight velocity.
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mb-10">
          Real-time telemetry, automated customs clearance, and carbon-neutral routing for modern enterprise supply networks.
        </p>

        <form onSubmit={handleTrack} className="bg-white/5 border border-white/10 p-2 rounded-2xl max-w-2xl flex items-center gap-2 mb-6">
          <Search className="w-5 h-5 text-zinc-500 ml-3" />
          <input
            type="text"
            value={trackingId}
            onChange={(e) => setTrackingId(e.target.value)}
            placeholder="Enter Container or B/L Number (e.g. CX-98214)..."
            className="bg-transparent flex-1 px-2 py-3 text-sm text-white placeholder-zinc-500 outline-none"
          />
          <button type="submit" className="bg-amber-400 text-black font-bold px-6 py-3 rounded-xl hover:bg-amber-300 flex items-center gap-2 transition-colors">
            Track Cargo <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {status && (
          <div className="bg-amber-400/10 border border-amber-400/20 text-amber-300 p-4 rounded-xl max-w-2xl flex items-center gap-3 text-sm mb-12">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{status}</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-10 border-t border-white/10 mt-12">
          {[
            { label: "On-time arrival rate", value: "99.4%" },
            { label: "Active vessels tracked", value: "1,420+" },
            { label: "Average customs clearance", value: "2.4 hrs" },
            { label: "CO2 reduced in 2025", value: "480k tons" }
          ].map(k => (
            <div key={k.label} className="bg-white/[0.03] border border-white/[0.06] p-4 rounded-xl">
              <p className="text-2xl font-black text-white">{k.value}</p>
              <p className="text-xs text-zinc-400 mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-white/10 px-8 py-6 text-center text-xs text-zinc-600">
        © 2026 CargoX Global Logistics Inc.
      </footer>
    </div>
  );
}`
  },

  "antislop-celestial-renewal": {
    title: "Celestial Sanctuary",
    category: "Hero",
    appCode: `import React from "react";
import { Sparkles, Moon, ArrowRight } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#05040a] text-zinc-100 font-sans antialiased flex flex-col justify-between relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(120,80,240,0.15),transparent_70%)] pointer-events-none" />
      <header className="px-8 py-6 flex justify-between items-center max-w-6xl mx-auto w-full z-10">
        <div className="flex items-center gap-2">
          <Moon className="w-5 h-5 text-indigo-400" />
          <span className="font-serif tracking-widest text-lg font-medium">CELESTIAL</span>
        </div>
        <button className="text-xs uppercase tracking-widest border border-indigo-400/30 px-5 py-2 rounded-full hover:bg-indigo-500/10 transition-colors">
          Experience
        </button>
      </header>

      <main className="max-w-4xl mx-auto text-center px-6 py-20 z-10">
        <div className="inline-flex items-center gap-2 text-indigo-300 text-xs tracking-widest uppercase mb-6 bg-indigo-950/40 border border-indigo-500/20 px-4 py-1.5 rounded-full">
          <Sparkles className="w-3.5 h-3.5" /> Solstice Retreat 2026
        </div>
        <h1 className="text-6xl md:text-8xl font-serif font-light tracking-tight leading-none mb-8 bg-gradient-to-b from-white via-indigo-100 to-indigo-400/60 bg-clip-text text-transparent">
          Align with the infinite silence.
        </h1>
        <p className="text-lg text-indigo-200/70 max-w-xl mx-auto mb-10 font-light leading-relaxed">
          A bespoke sanctuary for high-performing minds seeking restorative stillness, cognitive clarity, and celestial attunement.
        </p>
        <button className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-medium px-8 py-4 rounded-full shadow-lg shadow-indigo-500/25 hover:scale-105 transition-transform flex items-center gap-2 mx-auto">
          Reserve Your Journey <ArrowRight className="w-4 h-4" />
        </button>
      </main>

      <footer className="text-center text-xs tracking-widest text-zinc-600 uppercase py-8 border-t border-white/5 z-10">
        Sanctuary in Kyoto · Zurich · Atacama
      </footer>
    </div>
  );
}`
  },

  "antislop-coffee-rewards": {
    title: "Aroma Pass Coffee",
    category: "Apps",
    appCode: `import React, { useState } from "react";
import { Coffee, Gift, Award, Flame, Check } from "lucide-react";

export default function App() {
  const [stamps, setStamps] = useState(7);
  const totalStamps = 10;

  return (
    <div className="min-h-screen bg-[#1c1512] text-[#f4efe8] font-sans p-6 max-w-md mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4">
        <div>
          <span className="text-xs tracking-wider text-[#b89f82] uppercase font-bold">Good morning</span>
          <h1 className="text-2xl font-black text-[#f4efe8]">Aroma Pass™</h1>
        </div>
        <div className="w-10 h-10 rounded-full bg-[#34241d] flex items-center justify-center border border-[#523d32]">
          <Coffee className="w-5 h-5 text-[#d4a373]" />
        </div>
      </header>

      <div className="bg-[#281c16] border border-[#483327] rounded-3xl p-6 shadow-xl relative overflow-hidden my-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <span className="text-xs font-semibold text-[#b89f82] uppercase">Loyalty Card</span>
            <p className="text-lg font-bold text-white">Buy 10, Get 1 Free</p>
          </div>
          <div className="bg-[#483327] text-[#d4a373] text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" /> {stamps}/{totalStamps}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: totalStamps }).map((_, i) => (
            <button
              key={i}
              onClick={() => setStamps(i + 1)}
              className={\`aspect-square rounded-2xl flex items-center justify-center transition-all \${
                i < stamps
                  ? "bg-[#d4a373] text-[#1c1512] shadow-md shadow-[#d4a373]/20 font-black scale-105"
                  : "bg-[#34241d] border border-dashed border-[#523d32] text-[#6d5142]"
              }\`}
            >
              {i < stamps ? <Check className="w-4 h-4 stroke-[3]" /> : <Coffee className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#b89f82] text-center mt-5">
          {totalStamps - stamps === 0 ? "🎉 Free drink ready to claim!" : \`\${totalStamps - stamps} stamps left to your free reward.\`}
        </p>
      </div>

      <button className="w-full bg-[#d4a373] text-[#1c1512] font-black py-4 rounded-2xl hover:bg-[#c29162] transition-colors shadow-lg shadow-[#d4a373]/20">
        Scan At Register
      </button>
    </div>
  );
}`
  },

  "antislop-cozypaws": {
    title: "CozyPaws Sanctuary",
    category: "Apps",
    appCode: `import React, { useState } from "react";
import { Heart, Search, Calendar, ShieldCheck, MapPin } from "lucide-react";

export default function App() {
  const [filter, setFilter] = useState("all");
  const pets = [
    { name: "Mochi", breed: "Golden Retriever Puppy", age: "4 mos", emoji: "🐕", tag: "Gentle" },
    { name: "Luna", breed: "Scottish Fold", age: "1 yr", emoji: "🐈", tag: "Cuddly" },
    { name: "Barnaby", breed: "Holland Lop", age: "6 mos", emoji: "🐇", tag: "Quiet" }
  ];

  return (
    <div className="min-h-screen bg-[#faf8f5] text-zinc-900 font-sans p-6 max-w-4xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐾</span>
          <span className="font-extrabold text-xl text-amber-900">CozyPaws</span>
        </div>
        <button className="bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-amber-700 transition-colors">
          Adopt a Friend
        </button>
      </header>

      <main className="my-8">
        <h1 className="text-4xl md:text-5xl font-black text-amber-950 mb-3">
          Find your lifelong companion.
        </h1>
        <p className="text-zinc-600 mb-8 max-w-lg">
          Every rescue pet is vaccinated, microchipped, and behavioral-screened with loving foster families.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {pets.map(p => (
            <div key={p.name} className="bg-white border border-amber-100 rounded-3xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-44 bg-amber-50 rounded-2xl flex items-center justify-center text-7xl mb-4">
                {p.emoji}
              </div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-lg text-zinc-900">{p.name}</h3>
                <span className="text-xs bg-amber-100 text-amber-800 font-medium px-2 py-0.5 rounded-full">{p.tag}</span>
              </div>
              <p className="text-xs text-zinc-500 mb-4">{p.breed} · {p.age}</p>
              <button className="w-full bg-zinc-900 text-white text-xs font-semibold py-2.5 rounded-xl hover:bg-zinc-800 transition-colors">
                Meet {p.name}
              </button>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-400 py-4 border-t border-zinc-200">
        CozyPaws Non-Profit Animal Rescue Network
      </footer>
    </div>
  );
}`
  },

  "antislop-creative-portfolio": {
    title: "Aura Creative Portfolio",
    category: "Portfolio",
    appCode: `import React, { useState } from "react";
import { ArrowUpRight, Sparkles, Mail } from "lucide-react";

export default function App() {
  const projects = [
    { title: "Krypton Spatial OS", year: "2026", cat: "Interface Architecture", client: "VisionLab" },
    { title: "Aeon Neural Audio", year: "2025", cat: "Sound & Motion", client: "Aeon Labs" },
    { title: "Novalith Design System", year: "2025", cat: "Design Engineering", client: "Novalith Inc" }
  ];

  return (
    <div className="min-h-screen bg-black text-white font-sans antialiased p-8 max-w-5xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">Lucas Vance / Direction</span>
        <span className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-3 py-1 rounded-full">Available Q2</span>
      </header>

      <main className="my-16">
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.95] mb-12">
          Design direction for synthetic realities.
        </h1>

        <div className="divide-y divide-white/10 border-y border-white/10">
          {projects.map((p, i) => (
            <div key={p.title} className="py-6 flex justify-between items-center group cursor-pointer hover:px-4 transition-all">
              <div>
                <span className="text-xs font-mono text-zinc-500 block mb-1">0{i+1} · {p.year}</span>
                <h3 className="text-2xl font-bold group-hover:text-emerald-400 transition-colors">{p.title}</h3>
                <span className="text-xs text-zinc-400">{p.cat}</span>
              </div>
              <ArrowUpRight className="w-6 h-6 text-zinc-600 group-hover:text-white transition-colors" />
            </div>
          ))}
        </div>
      </main>

      <footer className="flex justify-between items-center text-xs text-zinc-500 pt-6 border-t border-white/10">
        <span>© 2026 Lucas Vance</span>
        <span className="hover:text-white cursor-pointer">lucas@aura-direction.design</span>
      </footer>
    </div>
  );
}`
  },

  "antislop-cross-border": {
    title: "Velo Cross-Border Payments",
    category: "Apps",
    appCode: `import React, { useState } from "react";
import { ArrowRightLeft, ShieldCheck, Check, ArrowRight } from "lucide-react";

export default function App() {
  const [send, setSend] = useState("1000");
  const rate = 0.92;
  const receive = (parseFloat(send || "0") * rate).toFixed(2);

  return (
    <div className="min-h-screen bg-[#070b12] text-white font-sans p-6 max-w-4xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold">V</div>
          <span className="font-extrabold tracking-tight text-lg">VELO FX</span>
        </div>
        <button className="text-xs bg-white/10 px-4 py-2 rounded-lg font-medium hover:bg-white/20 transition-colors">Sign In</button>
      </header>

      <main className="grid md:grid-cols-2 gap-12 items-center my-12">
        <div>
          <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">Zero-Markup Settlement</span>
          <h1 className="text-5xl font-black tracking-tight mt-2 mb-4 leading-tight">Global liquidity at mid-market rates.</h1>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6">Execute cross-border payouts to 140+ countries in seconds with bank-grade multi-signature compliance.</p>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> FCA Regulated & ISO 27001 Certified
          </div>
        </div>

        {/* Currency Card */}
        <div className="bg-[#0f1724] border border-blue-500/20 p-6 rounded-3xl shadow-2xl">
          <div className="space-y-4">
            <div className="bg-black/40 border border-white/10 p-3.5 rounded-2xl">
              <span className="text-[10px] text-zinc-400 block font-medium">YOU SEND</span>
              <div className="flex justify-between items-center mt-1">
                <input type="number" value={send} onChange={e => setSend(e.target.value)} className="bg-transparent text-2xl font-bold outline-none w-36" />
                <span className="bg-white/10 px-3 py-1 rounded-lg text-xs font-bold">USD 🇺🇸</span>
              </div>
            </div>

            <div className="flex justify-center -my-2 relative z-10">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center shadow-lg"><ArrowRightLeft className="w-4 h-4" /></div>
            </div>

            <div className="bg-black/40 border border-white/10 p-3.5 rounded-2xl">
              <span className="text-[10px] text-zinc-400 block font-medium">RECIPIENT GETS (GUARANTEED)</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-2xl font-bold text-emerald-400">{receive}</span>
                <span className="bg-white/10 px-3 py-1 rounded-lg text-xs font-bold">EUR 🇪🇺</span>
              </div>
            </div>
          </div>

          <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-2xl mt-6 transition-colors flex items-center justify-center gap-2">
            Continue Transfer <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/5">
        © 2026 Velo Financial Technologies Ltd.
      </footer>
    </div>
  );
}`
  },

  "antislop-prompt-hero": {
    title: "Prompt Canvas Studio",
    category: "Ai",
    appCode: `import React, { useState } from "react";
import { Sparkles, Terminal, Copy, Play, Cpu, Check } from "lucide-react";

export default function App() {
  const [model, setModel] = useState("Claude 3.7 Sonnet");
  const [copied, setCopied] = useState(false);

  return (
    <div className="min-h-screen bg-[#09090d] text-white font-sans p-6 max-w-5xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <div className="flex items-center gap-2 font-mono font-bold text-sm">
          <Terminal className="w-4 h-4 text-violet-400" /> PROMPT.CANVAS
        </div>
        <div className="flex gap-2 text-xs">
          {["Claude 3.7 Sonnet", "GPT-4o", "DeepSeek R1"].map(m => (
            <button key={m} onClick={() => setModel(m)} className={\`px-3 py-1.5 rounded-lg transition-colors \${model === m ? "bg-violet-600 font-bold" : "bg-white/5 text-zinc-400"}\`}>{m}</button>
          ))}
        </div>
      </header>

      <main className="my-10 space-y-6">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight max-w-2xl">
          Visual IDE for calibrated frontier prompts.
        </h1>
        <div className="bg-[#12121a] border border-white/10 rounded-2xl p-5 font-mono text-xs text-zinc-300 relative">
          <div className="flex justify-between items-center text-zinc-500 pb-3 border-b border-white/5 mb-3">
            <span>system_directive.ts</span>
            <button onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="hover:text-white flex items-center gap-1">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="leading-relaxed text-violet-200">
            You are an expert design-technologist. Prioritize precision, aesthetic restraint, and intentional whitespace. Eliminate generic template cliches. Return production TypeScript components.
          </p>
        </div>
        <div className="flex gap-4">
          <button className="bg-white text-black font-bold px-6 py-3 rounded-xl flex items-center gap-2 text-sm hover:bg-zinc-200 transition-colors">
            <Play className="w-4 h-4" /> Run Benchmark
          </button>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/10">
        Prompt Canvas v2.4 · 100% Client-Side Evaluation
      </footer>
    </div>
  );
}`
  },

  "antislop-stillmind": {
    title: "Stillmind Meditation",
    category: "Apps",
    appCode: `import React, { useState, useEffect } from "react";
import { Play, Pause, RotateCcw, Volume2, Wind } from "lucide-react";

export default function App() {
  const [breathing, setBreathing] = useState(false);
  const [phase, setPhase] = useState("Breathe in");

  useEffect(() => {
    if (!breathing) return;
    const interval = setInterval(() => {
      setPhase(p => p === "Breathe in" ? "Hold" : p === "Hold" ? "Breathe out" : "Breathe in");
    }, 4000);
    return () => clearInterval(interval);
  }, [breathing]);

  return (
    <div className="min-h-screen bg-[#0e1111] text-[#e8ece9] font-sans p-6 max-w-md mx-auto flex flex-col justify-between text-center">
      <header className="py-4">
        <span className="text-xs uppercase tracking-widest text-emerald-400/80 font-medium">Stillmind</span>
      </header>

      <main className="my-auto flex flex-col items-center">
        <div className={\`w-52 h-52 rounded-full border border-emerald-500/30 flex items-center justify-center transition-all duration-1000 \${breathing ? "scale-110 bg-emerald-500/10 shadow-2xl shadow-emerald-500/20" : "scale-95 bg-white/5"}\`}>
          <div className="space-y-2">
            <Wind className="w-8 h-8 text-emerald-400 mx-auto animate-pulse" />
            <p className="text-lg font-medium">{breathing ? phase : "Ready"}</p>
          </div>
        </div>

        <button onClick={() => setBreathing(!breathing)} className="mt-12 bg-emerald-600 hover:bg-emerald-500 text-black font-bold px-8 py-3.5 rounded-full transition-colors">
          {breathing ? "Pause Session" : "Begin Breathing"}
        </button>
      </main>

      <footer className="text-xs text-zinc-600 py-4">Box Breathing: 4s inhale · 4s hold · 4s exhale</footer>
    </div>
  );
}`
  },

  "antislop-subscription-agency": {
    title: "Studio Scale Agency",
    category: "Agency",
    appCode: `import React, { useState } from "react";
import { Check, ArrowRight, Zap, Star } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#070709] text-white font-sans p-6 max-w-5xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <span className="font-black text-xl tracking-tight">KONTRAST.</span>
        <button className="bg-white text-black text-xs font-bold px-4 py-2 rounded-full">Book Call</button>
      </header>

      <main className="my-16 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-3 py-1 rounded-full mb-6 font-semibold">
          <Star className="w-3.5 h-3.5 fill-amber-400" /> Only 1 slot left for March
        </div>
        <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-6">
          Senior design team for one flat monthly rate.
        </h1>
        <p className="text-lg text-zinc-400 mb-10 max-w-xl mx-auto">
          Pause or cancel anytime. Get high-converting landing pages, UI/UX, and design systems delivered in 48 hours.
        </p>

        <div className="bg-[#111116] border border-white/10 rounded-3xl p-8 max-w-md mx-auto text-left shadow-2xl">
          <div className="flex justify-between items-baseline mb-6">
            <div>
              <h3 className="font-bold text-xl">Standard Pro</h3>
              <p className="text-xs text-zinc-400">One request at a time</p>
            </div>
            <div className="text-right">
              <span className="text-4xl font-black">$4,995</span>
              <span className="text-xs text-zinc-500 block">/month</span>
            </div>
          </div>
          <ul className="space-y-3 text-sm text-zinc-300 mb-8">
            {["One request at a time", "Average 48 hour turnaround", "Unlimited revisions", "Native React / Tailwind code", "Pause or cancel anytime"].map(f => (
              <li key={f} className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> {f}</li>
            ))}
          </ul>
          <button className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2">
            Get Started <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/10">© 2026 Kontrast Design Collective</footer>
    </div>
  );
}`
  },

  "antislop-tech-forward": {
    title: "Vektor Edge Compute",
    category: "Technology",
    appCode: `import React, { useState } from "react";
import { Terminal, Cpu, Zap, Copy, Check } from "lucide-react";

export default function App() {
  const [tab, setTab] = useState("bash");

  return (
    <div className="min-h-screen bg-[#06080d] text-zinc-100 font-sans p-6 max-w-5xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <span className="font-mono font-bold text-sm tracking-widest text-cyan-400">VEKTOR.IO</span>
        <button className="bg-cyan-500 text-black text-xs font-bold px-4 py-2 rounded-lg">Deploy Node</button>
      </header>

      <main className="my-16 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-xs font-mono text-cyan-400 uppercase tracking-widest">Sub-5ms Execution</span>
          <h1 className="text-5xl font-black tracking-tight mt-2 mb-4 leading-none">Instant serverless compute at the edge.</h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">Deploy WebAssembly microservices globally with zero cold starts and millisecond replication.</p>
        </div>

        <div className="bg-[#0b101a] border border-cyan-500/20 rounded-2xl p-5 font-mono text-xs">
          <div className="flex gap-2 mb-4 border-b border-white/10 pb-2 text-zinc-500">
            <span className="text-cyan-400 font-bold">$ curl -sSL https://vektor.run | sh</span>
          </div>
          <p className="text-zinc-400 leading-relaxed mb-2">✔ Connected to global mesh (42 regions)</p>
          <p className="text-zinc-400 leading-relaxed mb-2">✔ Binary compiled to WASM in 140ms</p>
          <p className="text-emerald-400 font-bold">🚀 Live at: https://edge.vektor.io/app-9812</p>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/5">Vektor Compute Engine · Global Anycast Network</footer>
    </div>
  );
}`
  },

  "antislop-travel-journal": {
    title: "Nomad Travel Journal",
    category: "Travel",
    appCode: `import React from "react";
import { Compass, MapPin, Camera, ArrowRight } from "lucide-react";

export default function App() {
  const journeys = [
    { dest: "Lofoten Islands", country: "Norway", temp: "-2°C", emoji: "🏔️" },
    { dest: "Kyoto Backstreets", country: "Japan", temp: "14°C", emoji: "⛩️" },
    { dest: "Sahara Dunes", country: "Morocco", temp: "28°C", emoji: "🐪" }
  ];

  return (
    <div className="min-h-screen bg-[#0c0d10] text-[#eee] font-sans p-6 max-w-4xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Compass className="w-5 h-5 text-amber-400" />
          <span className="font-bold tracking-tight text-lg">WAYFARER</span>
        </div>
        <span className="text-xs text-zinc-400 font-mono">ISSUE NO. 42</span>
      </header>

      <main className="my-12">
        <h1 className="text-5xl font-black tracking-tight mb-8">Stories from the quiet edges of the world.</h1>
        <div className="grid md:grid-cols-3 gap-6">
          {journeys.map(j => (
            <div key={j.dest} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-amber-400/40 transition-colors">
              <span className="text-4xl block mb-3">{j.emoji}</span>
              <h3 className="font-bold text-lg mb-1">{j.dest}</h3>
              <p className="text-xs text-zinc-400 mb-4">{j.country} · {j.temp}</p>
              <button className="text-xs text-amber-400 font-bold flex items-center gap-1 hover:underline">Read Dispatch <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/10">Wayfarer Dispatch & Photography Archive</footer>
    </div>
  );
}`
  },

  "antislop-vision-reveal": {
    title: "Vision Pro Spatial UI",
    category: "Hero",
    appCode: `import React, { useState } from "react";
import { Eye, Layers, Sparkles } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white font-sans p-8 flex flex-col justify-between items-center text-center">
      <header className="w-full max-w-5xl flex justify-between items-center py-4">
        <span className="font-semibold tracking-widest text-xs uppercase text-zinc-400">IRIS 3D</span>
        <button className="text-xs border border-white/20 px-4 py-2 rounded-full">Spec Sheet</button>
      </header>
      <main className="max-w-3xl my-auto">
        <div className="inline-flex items-center gap-2 text-xs text-cyan-300 bg-cyan-950/40 border border-cyan-500/20 px-4 py-1 rounded-full mb-6">
          <Sparkles className="w-3.5 h-3.5" /> Spatial Computing Framework
        </div>
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-none mb-6 bg-gradient-to-r from-white via-cyan-100 to-cyan-500 bg-clip-text text-transparent">
          Dissolve the glass.
        </h1>
        <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-8">
          Natural gaze navigation, sub-millimeter hand tracking, and photorealistic depth planes.
        </p>
        <button className="bg-white text-black font-bold px-8 py-3.5 rounded-full hover:bg-zinc-200 transition-colors">
          Experience Demo
        </button>
      </main>
      <footer className="text-xs text-zinc-600 py-4">Next-generation spatial canvas</footer>
    </div>
  );
}`
  },

  "antislop-wellbeing-os": {
    title: "Aura Health OS",
    category: "Apps",
    appCode: `import React from "react";
import { Heart, Moon, Activity, Flame, ArrowUp } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#070b0c] text-white font-sans p-6 max-w-md mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4">
        <h1 className="text-xl font-bold">Health OS</h1>
        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full font-bold">Sync Active</span>
      </header>

      <main className="space-y-4 my-auto">
        <div className="bg-[#101719] border border-white/10 rounded-3xl p-6 text-center">
          <span className="text-xs text-zinc-400 uppercase font-bold tracking-wider">Daily Recovery</span>
          <p className="text-6xl font-black text-emerald-400 my-2">94%</p>
          <p className="text-xs text-zinc-400">Optimal strain capacity today</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#101719] border border-white/10 rounded-2xl p-4">
            <Moon className="w-5 h-5 text-indigo-400 mb-2" />
            <p className="text-2xl font-bold">8h 12m</p>
            <p className="text-[10px] text-zinc-400">Sleep Duration</p>
          </div>
          <div className="bg-[#101719] border border-white/10 rounded-2xl p-4">
            <Heart className="w-5 h-5 text-rose-400 mb-2" />
            <p className="text-2xl font-bold">54 bpm</p>
            <p className="text-[10px] text-zinc-400">Resting HR</p>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4">Continuous Biometric Telemetry</footer>
    </div>
  );
}`
  },

  "antislop-wellness-balance": {
    title: "Prana Balance Yoga",
    category: "Hero",
    appCode: `import React from "react";
import { Sparkles, Calendar, Clock, ArrowRight } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#14120e] text-[#ede8e1] font-sans p-6 max-w-4xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <span className="font-serif tracking-widest text-lg">PRANA STUDIO</span>
        <button className="bg-[#c4a47c] text-black text-xs font-bold px-4 py-2 rounded-full">Book Mat</button>
      </header>

      <main className="my-16 text-center max-w-2xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-serif font-light mb-6">Movement for the unhurried spirit.</h1>
        <p className="text-zinc-400 mb-8 leading-relaxed">Heated vinyasa, restorative sound baths, and breathwork guidance in downtown Seattle.</p>
        <button className="bg-[#c4a47c] text-black font-semibold px-8 py-3.5 rounded-full hover:bg-[#b08e64] transition-colors">View Class Schedule</button>
      </main>

      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/5">© 2026 Prana Yoga Studio</footer>
    </div>
  );
}`
  },

  "antislop-wellness-companion": {
    title: "Mindful Companion",
    category: "Apps",
    appCode: `import React, { useState } from "react";
import { Smile, Sun, Cloud, Moon, Heart } from "lucide-react";

export default function App() {
  const [mood, setMood] = useState("peaceful");

  return (
    <div className="min-h-screen bg-[#111618] text-[#e0e8e6] font-sans p-6 max-w-md mx-auto flex flex-col justify-between">
      <header className="py-4 text-center">
        <h1 className="text-lg font-bold">Evening Reflection</h1>
      </header>

      <main className="space-y-6 my-auto text-center">
        <p className="text-2xl font-semibold">How was your headspace today?</p>
        <div className="flex justify-center gap-3">
          {[
            { id: "calm", icon: Sun, label: "Calm" },
            { id: "peaceful", icon: Heart, label: "Grateful" },
            { id: "busy", icon: Cloud, label: "Busy" },
            { id: "tired", icon: Moon, label: "Tired" }
          ].map(m => (
            <button key={m.id} onClick={() => setMood(m.id)} className={\`p-4 rounded-2xl flex flex-col items-center gap-2 transition-all \${mood === m.id ? "bg-teal-700 text-white scale-105" : "bg-white/5 text-zinc-400"}\`}>
              <m.icon className="w-6 h-6" />
              <span className="text-[10px] font-bold">{m.label}</span>
            </button>
          ))}
        </div>
        <textarea placeholder="Write a short thought or gratitude..." className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm outline-none resize-none h-28" />
      </main>

      <button className="w-full bg-teal-600 text-black font-bold py-3.5 rounded-2xl">Save Check-In</button>
    </div>
  );
}`
  },

  "uilib-hero-dark-grow": {
    title: "Grow SaaS Platform",
    category: "Saas",
    appCode: `import React from "react";
import { TrendingUp, ArrowRight, ShieldCheck, Zap } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#07070a] text-white font-sans p-8 flex flex-col justify-between">
      <header className="flex justify-between items-center max-w-6xl mx-auto w-full py-4 border-b border-white/10">
        <span className="font-black text-xl text-emerald-400">GROW.IO</span>
        <button className="bg-emerald-500 text-black font-bold px-4 py-2 rounded-xl text-xs">Start Trial</button>
      </header>
      <main className="max-w-4xl mx-auto text-center my-auto py-12">
        <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-6">Scale B2B revenue on autopilot.</h1>
        <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-8">AI pipeline acceleration, inbound deal scoring, and automated SDR follow-ups in one workspace.</p>
        <button className="bg-white text-black font-bold px-8 py-4 rounded-xl hover:bg-zinc-200 transition-colors">Book 15-Min Demo</button>
      </main>
      <footer className="text-center text-xs text-zinc-600 py-4">Trusted by 450+ high-growth B2B teams</footer>
    </div>
  );
}`
  },

  "uilib-hero-dark-video-mindloop": {
    title: "Mindloop Newsletter",
    category: "Saas",
    appCode: `import React from "react";
import { Mail, ArrowRight } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white font-sans p-8 flex flex-col justify-between items-center text-center">
      <header className="w-full max-w-5xl flex justify-between items-center py-4">
        <span className="font-mono text-sm tracking-widest">MINDLOOP</span>
      </header>
      <main className="max-w-2xl my-auto">
        <h1 className="text-6xl md:text-7xl font-bold tracking-tight mb-6">Signals in the machine.</h1>
        <p className="text-zinc-400 mb-8">A weekly dispatch on artificial intelligence, systems engineering, and creative computing.</p>
        <div className="flex gap-2 max-w-md mx-auto">
          <input placeholder="Enter your email..." className="flex-1 bg-white/10 px-4 py-3 rounded-xl text-sm outline-none border border-white/10" />
          <button className="bg-white text-black font-bold px-6 py-3 rounded-xl text-sm">Subscribe</button>
        </div>
      </main>
      <footer className="text-xs text-zinc-600 py-4">Every Sunday morning. No spam.</footer>
    </div>
  );
}`
  },

  "uilib-hero-light-dashboard-nexora": {
    title: "Nexora Light Analytics",
    category: "Saas",
    appCode: `import React from "react";
import { BarChart3, Users, DollarSign, ArrowUpRight } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans p-8 flex flex-col justify-between">
      <header className="max-w-6xl mx-auto w-full flex justify-between items-center py-4 border-b border-slate-200">
        <span className="font-black text-xl text-indigo-600">NEXORA</span>
        <button className="bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-lg">Launch Console</button>
      </header>
      <main className="max-w-6xl mx-auto w-full my-8">
        <h1 className="text-4xl font-black mb-6">Real-Time Enterprise Telemetry</h1>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { label: "Active Nodes", val: "48,290", change: "+14%" },
            { label: "Throughput (GB/s)", val: "1.42 GB/s", change: "+8%" },
            { label: "Error Budget", val: "99.98%", change: "Healthy" }
          ].map(k => (
            <div key={k.label} className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
              <span className="text-xs text-slate-400 font-bold uppercase">{k.label}</span>
              <p className="text-3xl font-black text-slate-900 my-2">{k.val}</p>
              <span className="text-xs text-emerald-600 font-semibold">{k.change}</span>
            </div>
          ))}
        </div>
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">Nexora Observability Suite</footer>
    </div>
  );
}`
  },

  "uilib-card-frosted-glass": {
    title: "Frosted Glass Showcase",
    category: "Sections",
    appCode: `import React from "react";
import { Layers, Sparkles } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-black to-slate-950 text-white font-sans p-8 flex flex-col items-center justify-center">
      <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl max-w-md w-full shadow-2xl">
        <Sparkles className="w-8 h-8 text-indigo-300 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Liquid Glass Elevation</h2>
        <p className="text-sm text-zinc-300 leading-relaxed mb-6">Sub-pixel borders, dynamic luminance backdrop filtering, and multi-layer depth shadow.</p>
        <button className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-zinc-200 transition-colors">Inspect Element</button>
      </div>
    </div>
  );
}`
  },

  "uilib-navbar-liquid-glass": {
    title: "Liquid Glass Navbar",
    category: "Sections",
    appCode: `import React from "react";
import { Zap } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans flex flex-col items-center p-8">
      <nav className="fixed top-8 bg-white/10 backdrop-blur-2xl border border-white/20 px-6 py-3 rounded-full flex items-center gap-8 shadow-2xl">
        <div className="font-bold flex items-center gap-1.5"><Zap className="w-4 h-4 text-amber-400" /> APEX</div>
        <div className="flex gap-6 text-xs text-zinc-300">
          <a href="#" className="hover:text-white">Features</a>
          <a href="#" className="hover:text-white">Docs</a>
          <a href="#" className="hover:text-white">Pricing</a>
        </div>
        <button className="bg-white text-black text-xs font-bold px-4 py-1.5 rounded-full">Sign Up</button>
      </nav>
      <main className="my-auto text-center max-w-xl">
        <h1 className="text-4xl font-bold mb-4">Floating Dynamic Island</h1>
        <p className="text-zinc-400 text-sm">Inspect and customize this responsive liquid navigation bar component.</p>
      </main>
    </div>
  );
}`
  },

  // 7 Presets
  "preset-linear": {
    title: "Linear Precision Theme",
    category: "Saas",
    appCode: `import React, { useState } from "react";
import { CheckCircle2, Circle, AlertCircle, Plus, Search } from "lucide-react";

export default function App() {
  const issues = [
    { id: "LIN-104", title: "Migrate realtime WebSocket to multi-region cluster", prio: "Urgent", status: "In Progress" },
    { id: "LIN-103", title: "Implement keyboard shortcuts for command menu", prio: "High", status: "Done" },
    { id: "LIN-102", title: "Refactor database query planner to prevent lock starvation", prio: "Medium", status: "Todo" }
  ];

  return (
    <div className="min-h-screen bg-[#0e0e11] text-zinc-200 font-sans p-6 max-w-5xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-indigo-500 flex items-center justify-center font-bold text-xs">L</div>
          <span className="font-bold text-sm">Linear Project Workspace</span>
        </div>
        <button className="bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> New Issue</button>
      </header>
      <main className="my-8">
        <h1 className="text-2xl font-bold mb-4">Cycle 42 · Sprint Backlog</h1>
        <div className="bg-[#141419] border border-white/10 rounded-2xl divide-y divide-white/5">
          {issues.map(i => (
            <div key={i.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-zinc-500">{i.id}</span>
                <span className="text-sm font-medium text-white">{i.title}</span>
              </div>
              <span className="text-xs bg-white/5 px-2.5 py-1 rounded text-zinc-400">{i.status}</span>
            </div>
          ))}
        </div>
      </main>
      <footer className="text-xs text-zinc-600 py-4">Keyboard navigation: Press C to create, / to search</footer>
    </div>
  );
}`
  },

  "preset-notion": {
    title: "Notion Workspace Theme",
    category: "Apps",
    appCode: `import React from "react";
import { BookOpen, FileText, CheckSquare, Sparkles } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans p-8 max-w-3xl mx-auto">
      <div className="text-5xl mb-4">📝</div>
      <h1 className="text-4xl font-black mb-3">Engineering Wiki</h1>
      <p className="text-sm text-zinc-500 mb-8">Central documentation, architecture roadmaps, and team procedures.</p>
      <div className="space-y-3">
        {["Architecture Decision Records (ADRs)", "API Reference & OpenAPI Specification", "Deployment & Runbook Guidelines"].map(doc => (
          <div key={doc} className="p-3 border border-zinc-200 rounded-xl hover:bg-zinc-50 cursor-pointer flex items-center gap-3 text-sm font-medium">
            <FileText className="w-4 h-4 text-zinc-400" />
            <span>{doc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}`
  },

  "preset-raycast": {
    title: "Raycast Command Theme",
    category: "Sections",
    appCode: `import React, { useState } from "react";
import { Search, Terminal, ArrowRight, Command } from "lucide-react";

export default function App() {
  const commands = [
    { title: "Search Documentation", shortcut: "↵", cat: "Developer" },
    { title: "Toggle Dark Mode", shortcut: "⌘D", cat: "System" },
    { title: "Deploy to Production", shortcut: "⌘P", cat: "DevOps" }
  ];

  return (
    <div className="min-h-screen bg-black/90 p-8 flex items-center justify-center font-sans">
      <div className="bg-[#1a1a22] border border-white/20 rounded-2xl w-full max-w-lg shadow-2xl p-4">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Search className="w-4 h-4 text-zinc-400" />
          <input placeholder="Type a command or search..." className="bg-transparent flex-1 text-sm text-white outline-none" autoFocus />
        </div>
        <div className="pt-3 space-y-1">
          {commands.map(c => (
            <div key={c.title} className="flex justify-between items-center p-2 rounded-lg hover:bg-white/10 cursor-pointer text-xs">
              <span className="font-medium text-white">{c.title}</span>
              <kbd className="bg-white/10 px-2 py-0.5 rounded font-mono text-zinc-400">{c.shortcut}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`
  },

  "preset-stripe": {
    title: "Stripe Iridescent Theme",
    category: "Saas",
    appCode: `import React from "react";
import { CreditCard, Shield, ArrowRight } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a2540] text-white font-sans p-8 flex flex-col justify-between relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-tr from-[#635bff]/40 via-transparent to-[#00d4ff]/20 pointer-events-none" />
      <header className="flex justify-between items-center max-w-6xl mx-auto w-full z-10 py-4">
        <span className="font-extrabold text-2xl tracking-tight">stripe</span>
        <button className="bg-white/20 text-white font-semibold text-xs px-4 py-2 rounded-full">Sign In</button>
      </header>
      <main className="max-w-4xl mx-auto z-10 my-auto py-16 text-center">
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-none mb-6">
          Financial infrastructure for the internet.
        </h1>
        <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">Millions of companies of all sizes use Stripe online and in person to accept payments and manage their businesses.</p>
        <button className="bg-[#635bff] text-white font-bold px-8 py-4 rounded-full shadow-xl shadow-[#635bff]/40 hover:bg-[#534be5] transition-colors">Start now →</button>
      </main>
      <footer className="text-center text-xs text-slate-400 py-4 border-t border-white/10 z-10">Stripe Payments Europe Ltd</footer>
    </div>
  );
}`
  },

  "preset-superhuman": {
    title: "Superhuman Inbox Theme",
    category: "Apps",
    appCode: `import React from "react";
import { Mail, Zap, Check } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#111] text-zinc-100 font-sans p-8 max-w-3xl mx-auto flex flex-col justify-between">
      <header className="flex justify-between items-center py-4 border-b border-white/10">
        <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">SUPERHUMAN · INBOX ZERO</span>
        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full font-bold">Inbox Zero Achieved</span>
      </header>
      <main className="my-auto text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6 text-emerald-400">
          <Check className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-black mb-2">You're all done for today.</h1>
        <p className="text-zinc-500 text-sm">Hit ⌘K anytime to search your archives or compose a message.</p>
      </main>
      <footer className="text-xs text-zinc-600 text-center py-4">Engineered for pure speed</footer>
    </div>
  );
}`
  },

  "preset-vercel": {
    title: "Vercel Developer Theme",
    category: "Technology",
    appCode: `import React from "react";
import { Triangle, ArrowRight, Github } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white font-sans p-8 flex flex-col justify-between">
      <header className="flex justify-between items-center max-w-6xl mx-auto w-full py-4 border-b border-white/10">
        <div className="flex items-center gap-2 font-bold"><Triangle className="w-5 h-5 fill-white" /> Vercel</div>
        <button className="bg-white text-black font-semibold text-xs px-4 py-2 rounded-lg">Deploy Project</button>
      </header>
      <main className="max-w-4xl mx-auto text-center my-auto py-16">
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-none mb-6">Build when inspiration strikes.</h1>
        <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-8">Vercel provides the developer tools and cloud infrastructure to build, scale, and secure a faster web.</p>
        <button className="bg-white text-black font-bold px-8 py-4 rounded-xl hover:bg-zinc-200 transition-colors">Start Deploying Free</button>
      </main>
      <footer className="text-center text-xs text-zinc-600 py-4 border-t border-white/10">Vercel Global Edge Network</footer>
    </div>
  );
}`
  },

  "preset-vs-code": {
    title: "VS Code Editor Theme",
    category: "Technology",
    appCode: `import React from "react";
import { Code, Terminal, Play, FolderTree } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#1e1e1e] text-zinc-300 font-mono text-xs flex flex-col justify-between">
      <header className="bg-[#323233] px-4 py-2 flex justify-between items-center text-zinc-400">
        <span>App.tsx - vibecode - Visual Studio Code</span>
        <button className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Run & Debug</button>
      </header>
      <main className="flex-1 p-6 space-y-2">
        <p className="text-blue-400 font-semibold">// Welcome to VS Code Browser Workspace</p>
        <p><span className="text-purple-400">import</span> React <span className="text-purple-400">from</span> <span className="text-emerald-300">"react"</span>;</p>
        <p><span className="text-purple-400">export default function</span> <span className="text-yellow-300">App</span>() &#123;</p>
        <p className="pl-4"><span className="text-purple-400">return</span> &lt;<span className="text-blue-300">div</span>&gt;Hello World&lt;/<span className="text-blue-300">div</span>&gt;;</p>
        <p>&#125;</p>
      </main>
      <footer className="bg-[#007acc] text-white px-4 py-1 flex justify-between text-[11px]">
        <span>main* · TypeScript 5.8</span>
        <span>UTF-8 · Ln 1, Col 1</span>
      </footer>
    </div>
  );
}`
  }
};

// Add all 27 extra templates with HTML + React code
for (const [id, def] of Object.entries(extra)) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${def.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black text-white font-sans antialiased overflow-x-hidden min-h-screen flex flex-col justify-between">
  <div id="root" class="min-h-screen w-full flex flex-col justify-between">
    <header class="border-b border-white/10 px-8 py-5 flex items-center justify-between">
      <div class="font-black text-xl tracking-tight">${def.title}</div>
      <span class="text-xs bg-white/10 px-3 py-1 rounded-full text-zinc-300">${def.category}</span>
    </header>
    <main class="max-w-4xl mx-auto px-6 py-20 text-center">
      <h1 class="text-5xl md:text-7xl font-black tracking-tight mb-6 bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">${def.title}</h1>
      <p class="text-lg text-zinc-400 max-w-xl mx-auto mb-8">Production-ready template with calibrated animations, responsive layout, and clean React code.</p>
      <button class="bg-white text-black font-bold px-8 py-3.5 rounded-full hover:bg-zinc-200 transition-colors">Explore Template</button>
    </main>
    <footer class="border-t border-white/10 px-8 py-5 text-center text-xs text-zinc-600">
      ${def.title} · Pre-installed starter template
    </footer>
  </div>
</body>
</html>`;

  const item = {
    appCode: def.appCode,
    css: `@import "tailwindcss";\n`,
    html
  };

  bundles[id] = item;
  bundles[id.replace(/^(antislop|uilib|preset)-/, "")] = item;
}

console.log(`Writing complete bundles catalog... Total keys: ${Object.keys(bundles).length}`);
fs.writeFileSync("src/lib/starter-bundles.json", JSON.stringify(bundles), "utf-8");
console.log(`Saved src/lib/starter-bundles.json (${Math.round(fs.statSync("src/lib/starter-bundles.json").size / 1024)} KB)`);

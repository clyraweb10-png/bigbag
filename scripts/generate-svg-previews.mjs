import fs from "node:fs";
import path from "node:path";

const missingIds = [
  { id: "antislop-cargo-group", title: "CargoX Logistics", cat: "Logistics", gradient: ["#1e1b4b", "#0f172a"], accent: "#f59e0b" },
  { id: "antislop-celestial-renewal", title: "Celestial Sanctuary", cat: "Retreat", gradient: ["#020617", "#1e1b4b"], accent: "#818cf8" },
  { id: "antislop-coffee-rewards", title: "Aroma Pass Coffee", cat: "Mobile App", gradient: ["#1c1917", "#292524"], accent: "#d97706" },
  { id: "antislop-cozypaws", title: "CozyPaws Rescue", cat: "Pet Sanctuary", gradient: ["#fffbeb", "#fef3c7"], accent: "#b45309", light: true },
  { id: "antislop-creative-portfolio", title: "Aura Creative Studio", cat: "Portfolio", gradient: ["#09090b", "#18181b"], accent: "#10b981" },
  { id: "antislop-cross-border", title: "Velo FX Payments", cat: "Fintech", gradient: ["#082f49", "#0f172a"], accent: "#38bdf8" },
  { id: "antislop-prompt-hero", title: "Prompt Canvas", cat: "AI Tooling", gradient: ["#030712", "#111827"], accent: "#a855f7" },
  { id: "antislop-stillmind", title: "Stillmind Meditation", cat: "Mindfulness", gradient: ["#022c22", "#064e3b"], accent: "#34d399" },
  { id: "antislop-subscription-agency", title: "Kontrast Agency", cat: "Agency", gradient: ["#0a0a0a", "#171717"], accent: "#e5e5e5" },
  { id: "antislop-tech-forward", title: "Vektor Edge Compute", cat: "DevOps", gradient: ["#083344", "#0f172a"], accent: "#06b6d4" },
  { id: "antislop-travel-journal", title: "Wayfarer Travel", cat: "Journal", gradient: ["#1c1917", "#0c0a09"], accent: "#fbbf24" },
  { id: "antislop-vision-reveal", title: "Iris Spatial 3D", cat: "Spatial UI", gradient: ["#000000", "#164e63"], accent: "#22d3ee" },
  { id: "antislop-wellbeing-os", title: "Aura Health OS", cat: "Biometrics", gradient: ["#064e3b", "#022c22"], accent: "#10b981" },
  { id: "antislop-wellness-balance", title: "Prana Yoga Studio", cat: "Wellness", gradient: ["#1c1917", "#292524"], accent: "#d97706" },
  { id: "antislop-wellness-companion", title: "Mindful Companion", cat: "Health", gradient: ["#134e4a", "#042f2e"], accent: "#2dd4bf" },
  { id: "uilib-hero-dark-grow", title: "Grow B2B SaaS", cat: "SaaS", gradient: ["#022c22", "#09090b"], accent: "#10b981" },
  { id: "uilib-hero-dark-video-mindloop", title: "Mindloop Dispatch", cat: "Newsletter", gradient: ["#000000", "#18181b"], accent: "#f43f5e" },
  { id: "uilib-hero-light-dashboard-nexora", title: "Nexora Telemetry", cat: "Analytics", gradient: ["#f1f5f9", "#e2e8f0"], accent: "#4f46e5", light: true },
  { id: "uilib-card-frosted-glass", title: "Liquid Glass Elevation", cat: "Component", gradient: ["#312e81", "#09090b"], accent: "#c084fc" },
  { id: "uilib-navbar-liquid-glass", title: "Dynamic Island Navbar", cat: "Component", gradient: ["#030712", "#111827"], accent: "#38bdf8" },
  { id: "preset-linear", title: "Linear Precision UI", cat: "Theme", gradient: ["#0e0e11", "#181820"], accent: "#5e6ad2" },
  { id: "preset-notion", title: "Notion Clean Workspace", cat: "Theme", gradient: ["#ffffff", "#f4f4f5"], accent: "#18181b", light: true },
  { id: "preset-raycast", title: "Raycast Command Palette", cat: "Theme", gradient: ["#181820", "#09090b"], accent: "#ff6363" },
  { id: "preset-stripe", title: "Stripe Iridescent Gradient", cat: "Theme", gradient: ["#0a2540", "#635bff"], accent: "#00d4ff" },
  { id: "preset-superhuman", title: "Superhuman Inbox Zero", cat: "Theme", gradient: ["#000000", "#1c1917"], accent: "#10b981" },
  { id: "preset-vercel", title: "Vercel Edge Platform", cat: "Theme", gradient: ["#000000", "#09090b"], accent: "#ffffff" },
  { id: "preset-vs-code", title: "VS Code Cloud Editor", cat: "Theme", gradient: ["#1e1e1e", "#252526"], accent: "#007acc" }
];

for (const t of missingIds) {
  const textColor = t.light ? "#0f172a" : "#ffffff";
  const subColor = t.light ? "#64748b" : "#94a3b8";
  const pillBg = t.light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";
  const pillBorder = t.light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.12)";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="1280" height="800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${t.gradient[0]}" />
      <stop offset="100%" stop-color="${t.gradient[1]}" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0" />
    </radialGradient>
  </defs>
  
  <rect width="1280" height="800" fill="url(#bg)" />
  <rect width="1280" height="800" fill="url(#glow)" />
  
  <!-- Subtle grid lines -->
  <g opacity="0.08" stroke="#ffffff" stroke-width="1">
    <line x1="0" y1="160" x2="1280" y2="160" />
    <line x1="0" y1="320" x2="1280" y2="320" />
    <line x1="0" y1="480" x2="1280" y2="480" />
    <line x1="0" y1="640" x2="1280" y2="640" />
    <line x1="320" y1="0" x2="320" y2="800" />
    <line x1="640" y1="0" x2="640" y2="800" />
    <line x1="960" y1="0" x2="960" y2="800" />
  </g>
  
  <!-- Top bar / badge -->
  <rect x="520" y="220" width="240" height="40" rx="20" fill="${pillBg}" stroke="${pillBorder}" stroke-width="1" />
  <circle cx="544" cy="240" r="5" fill="${t.accent}" />
  <text x="562" y="246" font-family="-apple-system, system-ui, sans-serif" font-size="14" font-weight="600" fill="${t.accent}" letter-spacing="1">${t.cat.toUpperCase()}</text>
  
  <!-- Title -->
  <text x="640" y="360" font-family="-apple-system, system-ui, sans-serif" font-size="56" font-weight="800" fill="${textColor}" text-anchor="middle" letter-spacing="-1.5">${t.title}</text>
  
  <!-- Subtitle -->
  <text x="640" y="420" font-family="-apple-system, system-ui, sans-serif" font-size="20" font-weight="400" fill="${subColor}" text-anchor="middle">Pre-built interactive starter template with live preview</text>
  
  <!-- Mock Button -->
  <rect x="540" y="470" width="200" height="52" rx="26" fill="${t.accent}" />
  <text x="640" y="502" font-family="-apple-system, system-ui, sans-serif" font-size="16" font-weight="700" fill="${t.light ? '#ffffff' : '#000000'}" text-anchor="middle">Explore Template →</text>
</svg>`;

  const outPathPng = path.join("public/templates", `${t.id}.png`);
  // Save as SVG with png name or svg name
  fs.writeFileSync(outPathPng, svg, "utf-8");
}

console.log(`Generated all ${missingIds.length} missing preview images in public/templates/`);

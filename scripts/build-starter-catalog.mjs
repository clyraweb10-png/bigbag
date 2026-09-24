import fs from "node:fs";
import path from "node:path";

const motionsitesPromptsDir = "E:\\New folder\\motionsites-prompt-collection\\prompts";
const antiSlopDir = "E:\\New folder\\anti-slop-website-prompts\\prompts";
const uiPromptLibSaas = "E:\\New folder\\ui-prompt-library\\saas";
const uiPromptLibComp = "E:\\New folder\\ui-prompt-library\\components";
const uxuiPresets = "E:\\New folder\\uxui-AI-Prompt\\design-presets";
const uxuiExamples = "E:\\New folder\\uxui-AI-Prompt\\examples";

const outputFile = "e:\\ai-app-builder-open\\src\\lib\\starter-templates.ts";

export const CATEGORIES = [
  "All",
  "Recent",
  "Apps",
  "Sections",
  "Hero",
  "Landing Page",
  "Saas",
  "Agency",
  "Creative",
  "Portfolio",
  "Ai",
  "Technology",
  "Travel",
  "Web3",
];

const templates = [];

// 1. Process motionsites-prompt-collection
if (fs.existsSync(motionsitesPromptsDir)) {
  const files = fs.readdirSync(motionsitesPromptsDir).filter(f => f.endsWith(".md"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(motionsitesPromptsDir, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const catMatch = raw.match(/>\s+\*\*Category:\*\*\s*(.+)$/m);
    const typeMatch = raw.match(/>\s+\*\*Type:\*\*\s*(.+)$/m);
    
    // Extract prompt block
    const promptMatch = raw.match(/```text\s*([\s\S]*?)```/);
    const promptText = promptMatch ? promptMatch[1].trim() : raw.trim();

    const title = titleMatch ? titleMatch[1].trim() : name.replace(/_/g, " ");
    const rawCat = catMatch ? catMatch[1].trim() : "SaaS";
    const rawType = typeMatch ? typeMatch[1].trim() : "Hero Section";

    let category = "Saas";
    const lower = (rawCat + " " + rawType + " " + name).toLowerCase();
    if (lower.includes("portfolio")) category = "Portfolio";
    else if (lower.includes("agency") || lower.includes("studio")) category = "Agency";
    else if (lower.includes("creative") || lower.includes("3d") || lower.includes("glass")) category = "Creative";
    else if (lower.includes("nft") || lower.includes("web3") || lower.includes("crypto")) category = "Web3";
    else if (lower.includes("travel") || lower.includes("jet")) category = "Travel";
    else if (lower.includes("ai") || lower.includes("neural") || lower.includes("bot")) category = "Ai";
    else if (lower.includes("tech") || lower.includes("space") || lower.includes("code") || lower.includes("security")) category = "Technology";
    else if (lower.includes("ecommerce") || lower.includes("app") || lower.includes("platform") || lower.includes("booking")) category = "Apps";
    else if (lower.includes("loader") || lower.includes("calc") || lower.includes("component")) category = "Sections";
    else if (rawType.toLowerCase().includes("landing") || lower.includes("landing")) category = "Landing Page";
    else if (rawType.toLowerCase().includes("hero")) category = "Hero";

    // Format badge nicely
    let badge = "Hero Section";
    if (rawType.toLowerCase().includes("landing")) badge = "Landing Page";
    else if (rawType.toLowerCase().includes("component") || rawType.toLowerCase().includes("animation")) badge = "Component";
    else if (rawCat.toLowerCase().includes("agency")) badge = "Agency";
    else if (rawCat.toLowerCase().includes("fintech")) badge = "Fintech";
    else if (rawCat.toLowerCase().includes("portfolio")) badge = "Portfolio";
    else if (rawCat.toLowerCase().includes("web3")) badge = "Web3";
    else if (rawCat.toLowerCase().includes("saas")) badge = "SaaS";

    // First line or summary for description
    const lines = promptText.split("\n").map(l => l.trim()).filter(Boolean);
    const desc = lines[0] ? lines[0].slice(0, 140) : `Production-ready ${title} design spec.`;

    const imagePath = `/templates/${name}.png`;

    // Video/Motion preview matching
    const vMatch = promptText.match(/https:\/\/[^\s"'\\)]+\.(mp4|webm)/);
    const gMatch = promptText.match(/https:\/\/[^\s"'\\)]+\.gif/);
    const localVid = path.join("E:\\New folder\\motionsites-prompt-collection\\assets\\videos", `${name}_0.mp4`);
    
    let previewVideo = undefined;
    const staticVidPath = path.join(process.cwd(), "public", "templates", "videos", `${name}.mp4`);
    if (vMatch) {
      previewVideo = vMatch[0];
    } else if (fs.existsSync(staticVidPath) || fs.existsSync(localVid)) {
      previewVideo = `/templates/videos/${name}.mp4`;
    }

    let previewGif = gMatch ? gMatch[0] : undefined;

    templates.push({
      id: `motion-${name.toLowerCase().replace(/[_\s]+/g, "-")}`,
      name,
      title,
      category,
      badge,
      description: desc,
      previewImage: imagePath,
      ...(previewVideo ? { previewVideo } : {}),
      ...(previewGif ? { previewGif } : {}),
      prompt: promptText,
      stack: ["React", "Tailwind CSS", "Framer Motion", "Lucide React"],
      tags: [category, badge, "Motion"],
      isRecent: ["Asme", "Apex_SaaS", "Datacore_SaaS_Hero", "Framelix_3D_Studios", "ClearInvoice_SaaS_Hero", "Bloom_AI"].includes(name)
    });
  }
}

// 2. Process anti-slop-website-prompts
if (fs.existsSync(antiSlopDir)) {
  const files = fs.readdirSync(antiSlopDir).filter(f => f.endsWith(".md"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(antiSlopDir, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const catMatch = raw.match(/\*\*Category:\*\*\s*([^\s·]+)/);

    // Extract inside code fence if any
    const fenceMatch = raw.match(/````?[\w]*\s*([\s\S]*?)````?/);
    const promptText = fenceMatch ? fenceMatch[1].trim() : raw.trim();

    const title = titleMatch ? titleMatch[1].trim() : name.replace(/-/g, " ");
    const rawCat = catMatch ? catMatch[1].trim() : "Hero";

    let category = "Hero";
    let badge = "Hero Section";
    const lower = (name + " " + rawCat).toLowerCase();
    if (lower.includes("coffee") || lower.includes("cross-border") || lower.includes("travel") || lower.includes("companion")) {
      category = "Apps";
      badge = "Mobile App";
    } else if (lower.includes("portfolio")) {
      category = "Portfolio";
      badge = "Portfolio";
    } else if (lower.includes("subscription")) {
      category = "Agency";
      badge = "Agency";
    } else if (lower.includes("prompt-hero") || lower.includes("celestial")) {
      category = "Landing Page";
      badge = "Landing Page";
    } else if (lower.includes("wellbeing") || lower.includes("tech")) {
      category = "Saas";
      badge = "SaaS";
    }

    const lines = promptText.split("\n").map(l => l.trim()).filter(Boolean);
    const desc = lines[0] ? lines[0].slice(0, 140) : `Art-directed ${title} specification.`;

    // High quality uncompressed visual or screenshot
    const imagePath = `/templates/antislop-${name}.png`;

    templates.push({
      id: `antislop-${name}`,
      name: `antislop-${name}`,
      title,
      category,
      badge,
      description: desc,
      previewImage: imagePath,
      prompt: promptText,
      stack: ["React 18", "Tailwind CSS", "Framer Motion", "TypeScript"],
      tags: [category, badge, "Anti-Slop"],
      isRecent: ["cargo-group", "vision-reveal", "coffee-rewards", "prompt-hero"].includes(name)
    });
  }
}

// 3. Process UI Prompt Library SaaS & Components
if (fs.existsSync(uiPromptLibSaas)) {
  const files = fs.readdirSync(uiPromptLibSaas).filter(f => f.endsWith(".md") && f !== "README.md");
  for (const file of files) {
    const raw = fs.readFileSync(path.join(uiPromptLibSaas, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const title = name.replace(/^hero-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    templates.push({
      id: `uilib-${name}`,
      name: `uilib-${name}`,
      title: `${title} SaaS`,
      category: "Saas",
      badge: "SaaS Hero",
      description: "Production-grade SaaS hero section with Tailwind CSS and Framer Motion.",
      previewImage: `/templates/uilib-${name}.png`,
      prompt: raw.trim(),
      stack: ["React", "Vite", "Tailwind CSS", "shadcn/ui"],
      tags: ["Saas", "Hero Section", "SaaS Hero"],
      isRecent: true
    });
  }
}

if (fs.existsSync(uiPromptLibComp)) {
  const files = fs.readdirSync(uiPromptLibComp).filter(f => f.endsWith(".md") && f !== "README.md");
  for (const file of files) {
    const raw = fs.readFileSync(path.join(uiPromptLibComp, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const title = name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    templates.push({
      id: `uilib-${name}`,
      name: `uilib-${name}`,
      title,
      category: "Sections",
      badge: "Component",
      description: "Interactive glassmorphic component with calibrated animations.",
      previewImage: `/templates/uilib-${name}.png`,
      prompt: raw.trim(),
      stack: ["Tailwind CSS", "Framer Motion"],
      tags: ["Sections", "Component"],
      isRecent: false
    });
  }
}

// 4. Process UX/UI Brand Presets (Linear, Stripe, Vercel, Raycast, etc.)
if (fs.existsSync(uxuiPresets)) {
  const files = fs.readdirSync(uxuiPresets).filter(f => f.endsWith(".md"));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(uxuiPresets, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    const title = `${name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())} Theme`;
    templates.push({
      id: `preset-${name}`,
      name: `preset-${name}`,
      title,
      category: "Creative",
      badge: "Brand Preset",
      description: `Complete ${name} design token system, typography, colors, and motion rules.`,
      previewImage: `/templates/preset-${name}.png`,
      prompt: raw.trim(),
      stack: ["Tailwind CSS", "Design Tokens", "Next.js"],
      tags: ["Creative", "Brand Preset"],
      isRecent: ["linear", "vercel", "stripe"].includes(name)
    });
  }
}

// Write the output file
const code = `// Auto-generated starter template catalog
export interface StarterTemplate {
  id: string;
  name: string;
  title: string;
  category: "All" | "Recent" | "Apps" | "Sections" | "Hero" | "Landing Page" | "Saas" | "Agency" | "Creative" | "Portfolio" | "Ai" | "Technology" | "Travel" | "Web3";
  badge: string;
  description: string;
  previewImage: string;
  previewVideo?: string;
  previewGif?: string;
  prompt: string;
  stack?: string[];
  tags?: string[];
  isRecent?: boolean;
}

export const STARTER_CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)} as const;

export type StarterCategory = typeof STARTER_CATEGORIES[number];

export const STARTER_TEMPLATES: StarterTemplate[] = ${JSON.stringify(templates, null, 2)};
`;

fs.writeFileSync(outputFile, code, "utf-8");
console.log(`Saved ${templates.length} starter templates to ${outputFile}!`);

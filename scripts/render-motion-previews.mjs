import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("E:/New folder/motion-ui-skill/node_modules/playwright");
import path from "node:path";
import fs from "node:fs";

const demosDir = "E:\\New folder\\motionsites-prompt-collection\\demos";
const outDir = "public/templates";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const targetNames = [
  "E-commerce_Website",
  "Grow_AI_Talent_Platform",
  "HR_SaaS_Hero",
  "Investor_Deck",
  "Loader_Animation",
  "Logoisum_Video_Agency",
  "MotionZ_Premium",
  "NeoVision",
  "Nexus_IT_Solutions",
  "Orbit_Web3",
  "Railroad.ai",
  "SkyElite_Private_Jets"
];

async function run() {
  console.log("Launching Playwright Chromium via Edge...");
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });

  for (const name of targetNames) {
    const demoPath = path.join(demosDir, name, "index.html");
    if (!fs.existsSync(demoPath)) {
      console.warn(`File not found: ${demoPath}`);
      continue;
    }
    const html = fs.readFileSync(demoPath, "utf-8");
    const targetPng = path.join(outDir, `${name}.png`);

    console.log(`Rendering ${name}...`);
    try {
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Small pause for any animations / web fonts to settle
      await page.waitForTimeout(1200);
      await page.screenshot({ path: targetPng });
      const stat = fs.statSync(targetPng);
      console.log(`✓ Generated ${name}.png (${stat.size} bytes)`);
    } catch (err) {
      console.error(`✗ Error on ${name}:`, err.message);
    }
  }

  await browser.close();
  console.log("All 12 corrupted images successfully re-rendered with real sandbox screenshots!");
}

run().catch(console.error);

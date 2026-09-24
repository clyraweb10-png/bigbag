import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("E:/New folder/motion-ui-skill/node_modules/playwright");
import path from "node:path";
import fs from "node:fs";

async function run() {
  console.log("Launching Playwright Chromium...");
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 }
  });

  const demoPath = "E:\\New folder\\motionsites-prompt-collection\\demos\\E-commerce_Website\\index.html";
  const html = fs.readFileSync(demoPath, "utf-8");
  
  console.log("Setting content...");
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000); // Allow Babel/Tailwind/Lucide to render

  const out = path.resolve("public/templates/test-playwright-ecom.png");
  await page.screenshot({ path: out });
  console.log("Screenshot taken! Size:", fs.statSync(out).size);

  await browser.close();
}

run().catch(console.error);

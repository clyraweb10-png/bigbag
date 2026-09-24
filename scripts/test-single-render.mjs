import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const p = path.resolve("E:\\New folder\\motionsites-prompt-collection\\demos\\E-commerce_Website\\index.html");
const url = pathToFileURL(p).href;
const target = path.resolve("public/templates/test-ecommerce.png");

console.log("Testing url:", url);
try {
  execFileSync(edgePath, [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--screenshot=${target}`,
    "--window-size=1280,720",
    url
  ], { timeout: 10000 });
  const s = fs.statSync(target);
  console.log("Success! Result size:", s.size);
} catch (e) {
  console.error("Error:", e.message);
}

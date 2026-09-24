import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const demosDir = "E:\\New folder\\motionsites-prompt-collection\\demos";
const outDir = "e:\\ai-app-builder-open\\public\\templates";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const entries = fs.readdirSync(demosDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log(`Starting fast screenshot capture for ${entries.length} demos...`);

const tempProfileDir = path.join(os.tmpdir(), `edge-screenshots-${Date.now()}`);
fs.mkdirSync(tempProfileDir, { recursive: true });

let done = 0;
for (const name of entries) {
  const target = path.join(outDir, `${name}.png`);
  if (fs.existsSync(target) && fs.statSync(target).size > 1000) {
    done++;
    continue;
  }
  const fileUrl = `file:///${path.join(demosDir, name, "index.html").replace(/\\/g, "/")}`;
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      `--user-data-dir=${tempProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--screenshot=${target}`,
      "--window-size=1280,720",
      fileUrl
    ], { timeout: 8000, stdio: "ignore" });
    done++;
    process.stdout.write(`\rProgress: ${done}/${entries.length} (${name})`);
  } catch (err) {
    console.error(`\nFailed for ${name}:`, err.message);
  }
}

try {
  fs.rmSync(tempProfileDir, { recursive: true, force: true });
} catch {}

console.log(`\nAll done! Captured ${done} screenshots.`);

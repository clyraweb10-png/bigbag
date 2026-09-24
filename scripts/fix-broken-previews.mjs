import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const demosDir = "E:\\New folder\\motionsites-prompt-collection\\demos";
const outDir = "e:\\ai-app-builder-open\\public\\templates";
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

// Start local HTTP server to avoid file:/// space and CORS bugs
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(demosDir, urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

await new Promise((resolve) => server.listen(3999, resolve));
console.log("Local server running at http://localhost:3999");

const tempProfileDir = path.join(os.tmpdir(), `edge-fix-${Date.now()}`);
fs.mkdirSync(tempProfileDir, { recursive: true });

for (const name of targetNames) {
  const outPath = path.join(outDir, `${name}.png`);
  const targetUrl = `http://localhost:3999/${name}/index.html`;
  console.log(`Rendering ${name}...`);
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      `--user-data-dir=${tempProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--virtual-time-budget=2000",
      `--screenshot=${outPath}`,
      "--window-size=1280,720",
      targetUrl
    ], { timeout: 15000, stdio: "ignore" });
    const stat = fs.statSync(outPath);
    console.log(`Success: ${name}.png (size: ${stat.size} bytes)`);
  } catch (err) {
    console.error(`Failed ${name}:`, err.message);
  }
}

try {
  fs.rmSync(tempProfileDir, { recursive: true, force: true });
} catch {}

server.close();
console.log("Done fixing broken previews!");

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outDir = "e:\\ai-app-builder-open\\public\\templates";
const tempDir = "e:\\ai-app-builder-open\\scripts\\temp_previews";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const htmlSnippets = {
  Portal: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:720px; background:#050508; color:#fff; font-family:-apple-system,BlinkMacSystemFont,sans-serif; overflow:hidden; position:relative; }
  .bg { position:absolute; inset:0; background: radial-gradient(circle at 50% 60%, rgba(255,100,20,0.3) 0%, transparent 60%), linear-gradient(180deg, #090910 0%, #000 100%); }
  .mountains { position:absolute; bottom:0; left:0; right:0; height:360px; background:linear-gradient(180deg, #1c1524 0%, #0b0712 100%); clip-path:polygon(0% 100%, 20% 40%, 35% 70%, 50% 15%, 65% 75%, 80% 35%, 100% 100%); opacity:0.8; }
  .mountains-front { position:absolute; bottom:0; left:0; right:0; height:240px; background:#06040a; clip-path:polygon(0% 100%, 15% 55%, 30% 80%, 48% 30%, 52% 30%, 70% 85%, 85% 50%, 100% 100%); }
  .sun { position:absolute; left:50%; top:45%; transform:translate(-50%,-50%); width:220px; height:220px; border-radius:50%; background:linear-gradient(135deg, #ff7e5f, #feb47b); box-shadow:0 0 100px rgba(254,180,123,0.8); }
  .nav { position:relative; z-index:10; display:flex; justify-content:space-between; align-items:center; padding:32px 64px; }
  .logo { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .content { position:relative; z-index:10; text-align:left; padding:120px 64px 0; max-width:800px; }
  h1 { font-size:68px; font-weight:800; line-height:1.05; letter-spacing:-2px; margin:0 0 16px 0; }
  p { font-size:20px; color:#aaa; margin:0 0 32px 0; }
  .btn { display:inline-flex; align-items:center; gap:8px; padding:16px 36px; border-radius:40px; background:#fff; color:#000; font-weight:700; font-size:16px; }
</style>
</head>
<body>
  <div class="bg"></div>
  <div class="sun"></div>
  <div class="mountains"></div>
  <div class="mountains-front"></div>
  <div class="nav"><div class="logo">PORTAL</div></div>
  <div class="content">
    <h1>Step Through.<br>Work Smarter.</h1>
    <p>A message through forgotten realms, where your best work activates.</p>
    <div class="btn">Explore Portal &rarr;</div>
  </div>
</body>
</html>`,

  Email_Landing_Page: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:720px; background:#0b0c10; color:#fff; font-family:-apple-system,sans-serif; overflow:hidden; }
  .glow { position:absolute; top:-100px; right:10%; width:500px; height:500px; background:radial-gradient(circle, rgba(59,130,246,0.25) 0%, transparent 70%); }
  .window { margin:80px auto; width:1000px; height:560px; background:#12141a; border:1px solid rgba(255,255,255,0.12); border-radius:18px; box-shadow:0 30px 90px rgba(0,0,0,0.8); display:flex; flex-direction:column; overflow:hidden; }
  .w-bar { height:44px; background:#161922; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; padding:0 20px; gap:8px; }
  .dot { width:12px; height:12px; border-radius:50%; background:#333; }
  .w-body { flex:1; display:flex; }
  .sidebar { width:240px; border-right:1px solid rgba(255,255,255,0.08); padding:24px; background:#0f1117; }
  .main { flex:1; padding:40px; background:radial-gradient(circle at 80% 20%, rgba(99,102,241,0.15), transparent 50%); }
  h2 { font-size:36px; margin:0 0 12px 0; }
  p { color:#888; font-size:16px; margin:0 0 24px 0; }
  .badge { display:inline-block; padding:6px 14px; background:rgba(99,102,241,0.2); border:1px solid #6366f1; border-radius:20px; color:#a5b4fc; font-size:12px; font-weight:600; margin-bottom:20px; }
  .card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:20px; width:460px; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="window">
    <div class="w-bar"><div class="dot" style="background:#ff5f56"></div><div class="dot" style="background:#ffbd2e"></div><div class="dot" style="background:#27c93f"></div></div>
    <div class="w-body">
      <div class="sidebar"><div style="color:#aaa; font-weight:600; margin-bottom:16px;">Inbox</div><div style="background:#1e2230; padding:10px 14px; border-radius:8px; color:#fff; font-size:13px; font-weight:500;">Draft Campaigns</div></div>
      <div class="main">
        <div class="badge">Next-Gen Delivery</div>
        <h2>Lightning Fast Email Infrastructure</h2>
        <p>Send transactional & marketing emails with 99.99% inbox placement.</p>
        <div class="card">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px;">Live API Dispatcher</div>
          <div style="color:#71717a; font-size:12px;">curl -X POST https://api.email.dev/send ...</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`,

  Neon_Logic: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:720px; background:#07040a; color:#fff; font-family:-apple-system,sans-serif; overflow:hidden; }
  .grid-bg { position:absolute; inset:0; background:linear-gradient(rgba(244,63,94,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(244,63,94,0.1) 1px, transparent 1px); background-size:50px 50px; }
  .center-box { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); text-align:center; z-index:10; }
  .glow-ring { width:320px; height:320px; border-radius:50%; border:3px solid #f43f5e; box-shadow:0 0 60px #f43f5e, inset 0 0 60px #f43f5e; margin:0 auto 30px; display:flex; align-items:center; justify-content:center; }
  .inner-art { font-size:72px; }
  h1 { font-size:64px; font-weight:900; letter-spacing:-1px; text-transform:uppercase; margin:0 0 10px 0; background:linear-gradient(180deg, #fff, #fda4af); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  h3 { font-size:24px; color:#f43f5e; letter-spacing:4px; text-transform:uppercase; margin:0 0 20px 0; font-weight:700; }
  p { font-size:18px; color:#9ca3af; max-width:600px; margin:0 auto; line-height:1.5; }
</style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="center-box">
    <div class="glow-ring"><div class="inner-art">⚡</div></div>
    <h1>Brain And Body</h1>
    <h3>One Network</h3>
    <p>Seamlessly synchronizing human cognition with machine latency at edge scale.</p>
  </div>
</body>
</html>`,

  Creative_Studio: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:720px; background:#ffffff; color:#000; font-family:'Inter',sans-serif; overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .container { width:1140px; display:flex; align-items:center; justify-content:space-between; }
  .left { position:relative; width:480px; height:480px; display:flex; align-items:center; justify-content:center; }
  .knot { width:360px; height:360px; border-radius:40% 60% 70% 30% / 40% 50% 60% 50%; background:linear-gradient(135deg, #c084fc, #38bdf8, #f472b6); filter:blur(4px); box-shadow:0 20px 80px rgba(192,132,252,0.4); }
  .right { max-width:580px; }
  .stats { display:flex; gap:36px; margin-bottom:32px; }
  .stat-val { font-size:36px; font-weight:900; letter-spacing:-1px; }
  .stat-lbl { font-size:12px; color:#666; text-transform:uppercase; font-weight:600; letter-spacing:1px; }
  h1 { font-size:62px; font-weight:900; line-height:1; letter-spacing:-2px; text-transform:uppercase; margin:0 0 24px 0; }
  .btn { display:inline-flex; align-items:center; gap:8px; padding:14px 32px; background:#000; color:#fff; border-radius:30px; font-weight:700; font-size:14px; text-transform:uppercase; letter-spacing:1px; }
</style>
</head>
<body>
  <div class="container">
    <div class="left"><div class="knot"></div></div>
    <div class="right">
      <div class="stats">
        <div><div class="stat-val">+300</div><div class="stat-lbl">Brands</div></div>
        <div><div class="stat-val">200</div><div class="stat-lbl">Digital Products</div></div>
        <div><div class="stat-val">$100M</div><div class="stat-lbl">Funded</div></div>
      </div>
      <h1>Fearless Vision Delivered</h1>
      <div class="btn">Work With Us &rarr;</div>
    </div>
  </div>
</body>
</html>`,

  Data_Signal: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:720px; background:#0e0603; color:#fff; font-family:-apple-system,sans-serif; overflow:hidden; display:flex; align-items:center; }
  .wrap { width:1140px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; }
  .left { max-width:540px; }
  .chip { display:inline-block; padding:6px 14px; border-radius:20px; background:rgba(249,115,22,0.15); border:1px solid #f97316; color:#fb923c; font-size:13px; font-weight:600; margin-bottom:24px; }
  h1 { font-size:54px; font-weight:800; line-height:1.1; margin:0 0 20px 0; }
  p { font-size:18px; color:#a1a1aa; line-height:1.6; margin:0 0 32px 0; }
  .btn { display:inline-flex; padding:16px 36px; border-radius:12px; background:#f97316; color:#fff; font-weight:700; font-size:15px; }
  .right { width:460px; height:460px; background:radial-gradient(circle, rgba(249,115,22,0.4) 0%, transparent 70%); border-radius:50%; display:flex; align-items:center; justify-content:center; }
  .grid-cube { width:300px; height:300px; background:linear-gradient(135deg, #ea580c, #c2410c); border-radius:24px; box-shadow:0 25px 80px rgba(234,88,12,0.5); transform:rotate(12deg); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="left">
      <div class="chip">Zero-Noise Analytics</div>
      <h1>Stop Digging Through Dashboards.</h1>
      <p>Transform raw clickstreams into automated executive summaries and actionable growth alerts.</p>
      <div class="btn">Get Channel Access</div>
    </div>
    <div class="right"><div class="grid-cube"></div></div>
  </div>
</body>
</html>`
};

for (const [key, html] of Object.entries(htmlSnippets)) {
  const htmlFile = path.join(tempDir, `${key}.html`);
  const pngFile = path.join(outDir, `${key}.png`);
  fs.writeFileSync(htmlFile, html, "utf-8");
  try {
    execFileSync(edgePath, [
      "--headless",
      "--disable-gpu",
      `--screenshot=${pngFile}`,
      "--window-size=1280,720",
      `file:///${htmlFile.replace(/\\/g, "/")}`
    ], { timeout: 10000 });
    console.log(`Generated preview: ${key}.png`);
  } catch (e) {
    console.error(`Error on ${key}:`, e.message);
  }
}

try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {}
console.log("Reference previews generated successfully!");

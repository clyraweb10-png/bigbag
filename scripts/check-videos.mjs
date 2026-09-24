import fs from "node:fs";
import path from "node:path";

const motionsitesPromptsDir = "E:\\New folder\\motionsites-prompt-collection\\prompts";
const motionsitesVideosDir = "E:\\New folder\\motionsites-prompt-collection\\assets\\videos";

const files = fs.readdirSync(motionsitesPromptsDir).filter(f => f.endsWith(".md"));
let hasCdnVideo = 0;
let hasLocalVideo = 0;
let hasGif = 0;

for (const file of files) {
  const raw = fs.readFileSync(path.join(motionsitesPromptsDir, file), "utf-8");
  const name = file.replace(/\.md$/, "");
  
  const vMatch = raw.match(/https:\/\/[^\s"'\\)]+\.(mp4|webm)/);
  const gMatch = raw.match(/https:\/\/[^\s"'\\)]+\.gif/);
  const localVid = path.join(motionsitesVideosDir, `${name}_0.mp4`);
  
  if (vMatch) hasCdnVideo++;
  if (gMatch) hasGif++;
  if (fs.existsSync(localVid)) hasLocalVideo++;
}

console.log(`Total MotionSites prompt files: ${files.length}`);
console.log(`Has CDN video in prompt: ${hasCdnVideo}`);
console.log(`Has local MP4 in assets/videos: ${hasLocalVideo}`);
console.log(`Has GIF in prompt: ${hasGif}`);

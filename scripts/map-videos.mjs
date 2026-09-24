import fs from "node:fs";
import path from "node:path";

const motionsitesPromptsDir = "E:\\New folder\\motionsites-prompt-collection\\prompts";
const motionsitesVideosDir = "E:\\New folder\\motionsites-prompt-collection\\assets\\videos";

const files = fs.readdirSync(motionsitesPromptsDir).filter(f => f.endsWith(".md"));
const mapping = [];

for (const file of files) {
  const name = file.replace(/\.md$/, "");
  const raw = fs.readFileSync(path.join(motionsitesPromptsDir, file), "utf-8");
  
  const vMatch = raw.match(/https:\/\/[^\s"'\\)]+\.(mp4|webm)/);
  const gMatch = raw.match(/https:\/\/[^\s"'\\)]+\.gif/);
  const localVid = path.join(motionsitesVideosDir, `${name}_0.mp4`);
  
  let videoSource = null;
  if (vMatch) {
    videoSource = vMatch[0];
  } else if (fs.existsSync(localVid)) {
    videoSource = `/api/template-video/${name}`;
  }
  
  let gifSource = gMatch ? gMatch[0] : null;

  mapping.push({
    name,
    video: videoSource,
    gif: gifSource,
    hasLocal: fs.existsSync(localVid),
    hasCdn: !!vMatch,
  });
}

const withAnyVideo = mapping.filter(m => m.video);
console.log(`Templates with video mapped: ${withAnyVideo.length} / ${mapping.length}`);
console.log('Breakdown:');
console.log('- With CDN video:', mapping.filter(m => m.hasCdn).length);
console.log('- With Local fallback:', mapping.filter(m => !m.hasCdn && m.hasLocal).length);

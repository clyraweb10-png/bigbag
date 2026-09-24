const fs = require('fs');

const content = fs.readFileSync('src/lib/starter-templates.ts', 'utf8');
const idMatches = content.match(/"id":\s*"([^"]+)"/g) || [];
console.log('Total templates found:', idMatches.length);

const templatesWithVideos = [];
const templates = [];

// Rough extraction of template objects
const blocks = content.split('{\n    "id":');
console.log('Blocks:', blocks.length - 1);

for (let i = 1; i < blocks.length; i++) {
  const block = blocks[i];
  const idMatch = block.match(/^\s*"([^"]+)"/);
  const nameMatch = block.match(/"name":\s*"([^"]+)"/);
  const titleMatch = block.match(/"title":\s*"([^"]+)"/);
  const previewMatch = block.match(/"previewImage":\s*"([^"]+)"/);
  
  // Find mp4/webm/gif in the prompt
  const videoUrls = block.match(/https:\/\/[^\s"'\\)]+\.(mp4|webm)/g) || [];
  const gifUrls = block.match(/https:\/\/[^\s"'\\)]+\.gif/g) || [];

  if (idMatch) {
    templates.push({
      id: idMatch[1],
      name: nameMatch ? nameMatch[1] : '',
      title: titleMatch ? titleMatch[1] : '',
      previewImage: previewMatch ? previewMatch[1] : '',
      videos: [...new Set(videoUrls)],
      gifs: [...new Set(gifUrls)],
    });
  }
}

const withMedia = templates.filter(t => t.videos.length > 0 || t.gifs.length > 0);
console.log(`Templates with video/gif in prompt: ${withMedia.length} / ${templates.length}`);
console.log('Sample templates with media:');
withMedia.slice(0, 10).forEach(t => {
  console.log(`- ${t.id} ("${t.title}"): ${t.videos[0] || t.gifs[0]}`);
});

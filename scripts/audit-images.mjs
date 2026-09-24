import fs from "node:fs";
import path from "node:path";

const starterSrc = fs.readFileSync("src/lib/starter-templates.ts", "utf8");
const lines = starterSrc.split("\n");
const templates = [];
let current = {};

for (const line of lines) {
  if (line.includes('"id":')) {
    current = { id: line.split('"')[3] };
  }
  if (line.includes('"previewImage":')) {
    current.previewImage = line.split('"')[3];
    templates.push(current);
  }
}

console.log("Total templates in starter-templates.ts:", templates.length);
const problematic = [];

for (const t of templates) {
  const p = path.join("public", t.previewImage.replace(/^\//, ""));
  if (!fs.existsSync(p)) {
    problematic.push({ id: t.id, image: t.previewImage, err: "File does not exist" });
  } else {
    const s = fs.statSync(p);
    if (s.size === 12860) {
      problematic.push({ id: t.id, image: t.previewImage, size: s.size, err: "CORRUPT 12860 ERR_FILE_NOT_FOUND SCREENSHOT" });
    } else if (s.size < 15000) {
      problematic.push({ id: t.id, image: t.previewImage, size: s.size, err: "POTENTIALLY CORRUPT OR BLANK (<15000 bytes)" });
    }
  }
}

console.log("Problematic images count:", problematic.length);
console.log(JSON.stringify(problematic, null, 2));

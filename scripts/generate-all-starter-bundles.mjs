import fs from "node:fs";
import path from "node:path";

const demosDir = "E:\\New folder\\motionsites-prompt-collection\\demos";
const outputFile = "src/lib/starter-bundles.json";

function extractAppCode(html, demoName) {
  const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  let customCss = styleMatches.map(m => m[1]).join("\n\n");

  let scriptContent = "";
  const babelMatch = html.match(/<script\s+type="text\/babel">([\s\S]*?)<\/script>/i);
  if (babelMatch) {
    scriptContent = babelMatch[1];
  } else {
    const scriptMatches = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const sm of scriptMatches) {
      if (sm[1].includes("App") || sm[1].includes("function") || sm[1].includes("return")) {
        scriptContent = sm[1];
        break;
      }
    }
  }

  if (!scriptContent) {
    return null;
  }

  let code = scriptContent;

  const hooks = ["useState", "useEffect", "useRef", "useCallback", "useMemo", "useContext", "useId"];
  const usedHooks = hooks.filter(h => new RegExp(`\\b${h}\\b`).test(code));

  const motionProps = ["motion", "AnimatePresence", "useScroll", "useTransform", "useInView", "useSpring"];
  const usedMotion = motionProps.filter(m => new RegExp(`\\b${m}\\b`).test(code));

  code = code.replace(/const\s*\{[^}]*\}\s*=\s*React\s*;?/g, "");
  code = code.replace(/const\s*\{[^}]*\}\s*=\s*window\.Motion\s*;?/g, "");
  code = code.replace(/const\s*\{[^}]*\}\s*=\s*Motion\s*;?/g, "");
  code = code.replace(/const\s*\{[^}]*\}\s*=\s*lucide\s*;?/g, "");

  code = code.replace(/const\s+root\s*=\s*ReactDOM\.createRoot[\s\S]*?;\s*root\.render\s*\([^;]*\);?/g, "");
  code = code.replace(/ReactDOM\.createRoot\s*\([^)]*\)\s*\.render\s*\([^;]*\);?/g, "");
  code = code.replace(/ReactDOM\.render\s*\([^;]*\);?/g, "");

  const imports = [];
  if (usedHooks.length > 0) {
    imports.push(`import React, { ${usedHooks.join(", ")} } from "react";`);
  } else {
    imports.push(`import React from "react";`);
  }
  if (usedMotion.length > 0) {
    imports.push(`import { ${usedMotion.join(", ")} } from "framer-motion";`);
  }

  let finalCode = imports.join("\n") + "\n\n" + code.trim();
  if (!finalCode.includes("export default")) {
    if (finalCode.includes("const App =") || finalCode.includes("function App") || finalCode.includes("const App=")) {
      finalCode += "\n\nexport default App;\n";
    }
  }

  return { code: finalCode, css: customCss };
}

const bundles = {};
const dirs = fs.readdirSync(demosDir).filter(f => fs.statSync(path.join(demosDir, f)).isDirectory());

console.log(`Processing ${dirs.length} demo directories...`);

let successCount = 0;
for (const dirName of dirs) {
  const htmlPath = path.join(demosDir, dirName, "index.html");
  if (!fs.existsSync(htmlPath)) continue;

  const html = fs.readFileSync(htmlPath, "utf-8");
  const extracted = extractAppCode(html, dirName);

  const id = `motion-${dirName.toLowerCase().replace(/[_\s]+/g, "-")}`;
  const appCode = extracted ? extracted.code : `import React from "react";\n\nexport default function App() {\n  return (\n    <div className="min-h-screen bg-black text-white p-8 flex items-center justify-center">\n      <h1 className="text-4xl font-bold">${dirName.replace(/_/g, " ")}</h1>\n    </div>\n  );\n}`;
  const css = `@import "tailwindcss";\n\n${extracted?.css || ""}`;

  bundles[id] = { appCode, css, html };
  bundles[dirName.toLowerCase()] = { appCode, css, html };
  bundles[dirName.toLowerCase().replace(/[_\s]+/g, "-")] = { appCode, css, html };
  successCount++;
}

console.log(`Successfully generated compact bundles for ${successCount} demos.`);

fs.writeFileSync(outputFile, JSON.stringify(bundles), "utf-8");
console.log(`Saved ${outputFile} (${Math.round(fs.statSync(outputFile).size / 1024)} KB)`);

const fs = require('fs');
const path = require('path');

const starterSrc = fs.readFileSync('src/lib/starter-templates.ts', 'utf8');
const lines = starterSrc.split('\n');
const currentIds = new Set();
for (const line of lines) {
  if (line.includes('"id":')) {
    const parts = line.split('"');
    if (parts[3]) currentIds.add(parts[3]);
  }
}
console.log('Current templates in starter-templates.ts:', currentIds.size);

// 1. motionsites-prompt-collection
const motionFiles = fs.readdirSync('E:/New folder/motionsites-prompt-collection/prompts').filter(f => f.endsWith('.md'));
console.log('motionsites files:', motionFiles.length);

// 2. anti-slop
const antiSlopFiles = fs.readdirSync('E:/New folder/anti-slop-website-prompts/prompts').filter(f => f.endsWith('.md'));
console.log('anti-slop files:', antiSlopFiles.length);

// 3. ui-prompt-library
const uiLibSaas = fs.readdirSync('E:/New folder/ui-prompt-library/saas').filter(f => f.endsWith('.md') && !f.includes('README'));
const uiLibComp = fs.readdirSync('E:/New folder/ui-prompt-library/components').filter(f => f.endsWith('.md') && !f.includes('README'));
console.log('ui-prompt-library files:', uiLibSaas.length + uiLibComp.length);

// 4. uxui-AI-Prompt presets & examples
const uxuiPresets = fs.readdirSync('E:/New folder/uxui-AI-Prompt/design-presets').filter(f => f.endsWith('.md'));
const uxuiExamples = fs.readdirSync('E:/New folder/uxui-AI-Prompt/examples').filter(f => f.endsWith('.md'));
console.log('uxui-AI-Prompt files (presets+examples):', uxuiPresets.length + uxuiExamples.length);

// 5. motion-ui-skill blocks
const motionBlocks = fs.readdirSync('E:/New folder/motion-ui-skill/references/blocks').filter(f => f.endsWith('.md'));
console.log('motion-ui-skill blocks:', motionBlocks.length);

console.log('\n--- Checking missing from motionsites ---');
const missingMotion = motionFiles.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`motion-${base}`) && !currentIds.has(base);
});
console.log('Missing from motionsites:', missingMotion.length, missingMotion);

console.log('\n--- Checking missing from anti-slop ---');
const missingAntiSlop = antiSlopFiles.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`antislop-${base}`) && !currentIds.has(base);
});
console.log('Missing from anti-slop:', missingAntiSlop.length, missingAntiSlop);

console.log('\n--- Checking missing from ui-prompt-library ---');
const allUiLib = [...uiLibSaas, ...uiLibComp];
const missingUiLib = allUiLib.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`uilib-${base}`) && !currentIds.has(base);
});
console.log('Missing from ui-prompt-library:', missingUiLib.length, missingUiLib);

console.log('\n--- Checking missing from uxui presets ---');
const missingUxui = uxuiPresets.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`preset-${base}`) && !currentIds.has(base);
});
console.log('Missing from uxui presets:', missingUxui.length, missingUxui);

console.log('\n--- Checking uxui examples ---');
const missingUxuiEx = uxuiExamples.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`example-${base}`) && !currentIds.has(`uxui-${base}`) && !currentIds.has(base);
});
console.log('Missing from uxui examples:', missingUxuiEx.length, missingUxuiEx);

console.log('\n--- Checking motion-ui-skill blocks ---');
const missingBlocks = motionBlocks.filter(f => {
  const base = f.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !currentIds.has(`block-${base}`) && !currentIds.has(base);
});
console.log('Missing from motion blocks:', missingBlocks.length);

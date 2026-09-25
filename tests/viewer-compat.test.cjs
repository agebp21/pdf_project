// Exported books run in whatever WebView the reader's device has. Android
// System WebView 66 (old phones, stock emulator images) lacks ES2020 syntax
// (?. ??) and globalThis, which silently broke the APK reader. Parse every
// file packed into a book as ES2018 and reject newer runtime APIs.
const fs=require('node:fs'),assert=require('node:assert/strict');
const acorn=require('../.build/qa-runtime/node_modules/acorn');
const walk=require('../.build/qa-runtime/node_modules/acorn-walk');
const files=['assets/export/viewer.js','assets/export/layout.js','assets/animation-playback.js'];
// Chrome 66 has none of these (added in Chrome 69-86).
const bannedGlobals=new Set(['globalThis','structuredClone','queueMicrotask']);
const bannedMethods=new Set(['replaceChildren','replaceAll','fromEntries','flat','flatMap','at','matchAll','allSettled','any']);
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  let ast;
  try{ast=acorn.parse(source,{ecmaVersion:2018,sourceType:'script'});}
  catch(error){assert.fail(`${file}: syntax newer than ES2018 at ${error.loc.line}:${error.loc.column} (${error.message})`);}
  walk.full(ast,node=>{
    if(node.type==='Identifier'&&bannedGlobals.has(node.name))assert.fail(`${file}:${acorn.getLineInfo(source,node.start).line} uses ${node.name}`);
    if(node.type==='MemberExpression'&&!node.computed&&bannedMethods.has(node.property.name))assert.fail(`${file}:${acorn.getLineInfo(source,node.start).line} uses .${node.property.name}()`);
  });
}
// CSS: dvh needs a vh fallback first; the inset shorthand (Chrome 87) is
// replaced by top/right/bottom/left (box-shadow's inset keyword is fine).
for(const file of ['assets/export/viewer.css','assets/export/book-effects.css','assets/animation-playback.css']){
  const css=fs.readFileSync(file,'utf8');
  assert.ok(!/(^|[;{\s])inset\s*:/.test(css),file+' uses the inset shorthand');
  for(const match of css.matchAll(/height:100dvh/g))assert.ok(css.slice(Math.max(0,match.index-20),match.index).includes('100vh'),file+' 100dvh without 100vh fallback');
}
console.log('PASS book reader files are ES2018 / Android WebView 66 compatible (JS + CSS fallbacks): '+files.join(', '));

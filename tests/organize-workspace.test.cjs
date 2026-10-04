const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('../.build/qa-runtime/node_modules/jsdom');
const html=fs.readFileSync('converter.html','utf8');
async function main(){
  const dom=new JSDOM(html,{url:'http://localhost:8080/converter.html?tool=organize-pdf',runScripts:'outside-only'});
  const w=dom.window;
  w.console.log=()=>{}; w.scrollTo=()=>{};
  const script=[...w.document.scripts].find(s=>s.textContent.includes('const TOOLS')).textContent;
  // Driver hooks must live in the SAME eval scope (top-level let is not shared across eval calls).
  w.eval(script+`
    window.qaLoad=()=>{files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}]; updateFileUI();};
    window.qaClear=()=>{clearFiles();};`);
  const vis=id=>!w.document.getElementById(id).classList.contains('is-hidden');
  // No file yet: prompt visible, workspace tools hidden.
  assert.equal(vis('orgEmpty'),true,'empty prompt shows without file');
  assert.equal(vis('orgSide'),false,'sidebar hidden without file');
  assert.equal(vis('organizeGrid'),false,'grid hidden without file');
  assert.equal(vis('orgFab'),false,'fab hidden without file');
  // A file arrives: workspace opens, prompt goes away, no duplicate file panel.
  w.qaLoad();
  assert.equal(vis('orgEmpty'),false,'prompt hides with file');
  assert.equal(vis('orgSide'),true,'sidebar shows with file');
  assert.equal(vis('organizeGrid'),true,'grid shows with file');
  assert.equal(vis('orgFab'),true,'fab shows with file');
  assert.ok(w.document.getElementById('fileList').classList.contains('hidden'),'no duplicate file panel');
  // Removing the file restores the prompt and clears the grid.
  w.qaClear();
  assert.equal(vis('orgEmpty'),true,'prompt returns after remove');
  assert.equal(w.document.getElementById('organizeGrid').innerHTML,'','grid cleared after remove');
  w.close();
  console.log('PASS organize workspace: empty state, sidebar, no duplicate panel');
}
main().catch(e=>{console.error(e);process.exit(1)});

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
    window.qaClear=()=>{clearFiles();};
    window.qaTool=id=>{setTool(id);};
    window.qaViewer0=()=>{openOrgViewer(0);};    window.qaBlank=()=>{files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}];organizeOrder=[0,1];organizeSelected=new Set(organizeOrder);orgInsertBlankAt(1);return organizeOrder.slice();};
    window.qaFill=()=>{files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}];organizeOrder=[0,'blank-1'];organizeSelected=new Set(organizeOrder);orgBlankImg={'blank-1':'data:image/jpeg;base64,/9j/'};renderOrganizeGrid();return document.getElementById('organizeGrid').innerHTML.includes('data:image/jpeg');};`);
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
  // Viewer needs real page renders: without a document it stays closed.
  w.qaViewer0();
  assert.equal(w.document.getElementById('orgViewer'),null,'no viewer without document');
  // "+" inserts a real blank page (not a duplicate) right after the card.
  assert.equal(JSON.stringify(w.qaBlank()),JSON.stringify([0,'blank-1',1]),'blank inserted at position 1');
  assert.ok(w.document.getElementById('organizeGrid').innerHTML.includes('Blank page'),'blank card renders');
  // A filled blank shows its image on the card.
  assert.equal(w.qaFill(),true,'filled blank renders image');
  const chips=[...w.document.querySelectorAll('#orgFiles .org-chip')];
  assert.equal(chips.length,1,'one file chip');
  assert.ok(chips[0].textContent.includes('A')&&chips[0].textContent.includes('a.pdf'),'badge + name');
  assert.ok(w.document.querySelector('.org-addfile'),'add-file button present');
  // The main drop card stays out of the way for organize, back for other tools.
  w.qaLoad();
  assert.ok(w.document.getElementById('drop').classList.contains('is-hidden'),'drop hidden for organize');
  w.qaTool('merge-pdf');
  assert.ok(!w.document.getElementById('drop').classList.contains('is-hidden'),'drop returns for merge');
  w.close();
  console.log('PASS organize workspace: empty state, sidebar, no duplicate panel');
}
main().catch(e=>{console.error(e);process.exit(1)});

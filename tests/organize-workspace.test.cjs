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
    window.qaViewer0=()=>{openOrgViewer(0);};
    window.qaStatic=()=>{organizeOrder=[0,1,2];organizeSelected=new Set(organizeOrder);orgStaticShow(1);return document.querySelectorAll('#orgBook .opf-page').length;};
    // Lazy thumb renders must target our face divs, never box.children[]
    // (after loadFromHTML those belong to the engine's wrapper).
    window.qaFaceSwap=async ()=>{
      organizeOrder=[0,1];organizeSelected=new Set(organizeOrder);renderOrganizeGrid();
      orgBook={getCurrentPageIndex:()=>0};
      orgPrevCache.set('1|0','data:image/jpeg;base64,/9j/');
      const box=document.getElementById('orgBook');
      const wrap=document.createElement('div'); wrap.className='stf__wrapper';
      [...box.children].forEach(c=>wrap.append(c)); box.append(wrap);
      await orgRenderVisible();
      orgBook=null;
      return box.querySelector('.stf__wrapper')!==null
        && box.querySelectorAll('.stf__wrapper img').length===1;
    };
    window.qaPreview=()=>{organizeOrder=[0,1];organizeSelected=new Set(organizeOrder);renderOrganizeGrid();return document.getElementById('orgReader').className;};    window.qaBlank=()=>{files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}];organizeOrder=[0,1];organizeSelected=new Set(organizeOrder);orgInsertBlankAt(1);return organizeOrder.slice();};    window.qaFill=()=>{files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}];organizeOrder=[0,'blank-1'];organizeSelected=new Set(organizeOrder);orgBlankImg={'blank-1':'data:image/jpeg;base64,/9j/'};renderOrganizeGrid();return document.getElementById('organizeGrid').innerHTML.includes('data:image/jpeg');};
    // Trello-style gap: drag card 0, hover right half of card 2 -> gap after
    // it, drop commits [1,2,0,3]; hovering the dragged card itself clears it.
    window.qaGap=()=>{
      files=[{name:'a.pdf',size:1234,type:'application/pdf',lastModified:1}];
      organizeOrder=[0,1,2,3];organizeSelected=new Set(organizeOrder);renderOrganizeGrid();
      const cards=[...document.querySelectorAll('#organizeGrid .org-card')];
      const fakeDT=()=>({effectAllowed:'',dropEffect:''});
      orgDrag({currentTarget:cards[0],dataTransfer:fakeDT()});
      const dimmed=cards[0].classList.contains('drag-src');
      const cell2=cards[2].closest('.org-cell');
      cell2.getBoundingClientRect=()=>({left:0,width:200,top:0,height:0,bottom:0,right:200});
      orgOver({preventDefault(){},target:cards[2],clientX:150,dataTransfer:fakeDT()});
      const grid=document.getElementById('organizeGrid');
      const gap=document.getElementById('orgGap');
      const gapIdx=gap?[...grid.children].indexOf(gap):-1;
      orgDrop({preventDefault(){},stopPropagation(){},currentTarget:cards[2],dataTransfer:fakeDT()});
      const afterDrop={order:organizeOrder.slice(),gapLeft:!!document.getElementById('orgGap')};
      // Hovering the dragged card itself must not leave a gap behind.
      const c2=[...document.querySelectorAll('#organizeGrid .org-card')][2];
      orgDrag({currentTarget:c2,dataTransfer:fakeDT()});
      const self=c2.closest('.org-cell');
      self.getBoundingClientRect=()=>({left:0,width:200,top:0,height:0,bottom:0,right:200});
      orgOver({preventDefault(){},target:c2,clientX:150,dataTransfer:fakeDT()});
      const selfGap=!!document.getElementById('orgGap');
      orgFinishDrag();
      return {dimmed,gap:!!gap,gapIdx,afterDrop,selfGap,
        sideL:orgGapSide(0,200,40),sideR:orgGapSide(0,200,160),
        clean:!document.getElementById('orgGap')&&!document.querySelector('.org-card.drag-src')};
    };`);
  const vis=id=>!w.document.getElementById(id).classList.contains('is-hidden');
  // No file yet: prompt visible, workspace tools hidden, full-width row.
  assert.equal(vis('orgEmpty'),true,'empty prompt shows without file');
  assert.ok(w.document.getElementById('options').classList.contains('org-full'),'workspace uses full width');
  assert.equal(vis('orgSide'),false,'sidebar hidden without file');
  assert.equal(vis('organizeGrid'),false,'grid hidden without file');
  assert.equal(vis('orgFab'),false,'fab hidden without file');
  // Empty state offers direct Upload + Google Drive shortcuts.
  const emptyHTML=w.document.getElementById('orgEmpty').innerHTML;
  assert.ok(emptyHTML.includes('orgUploadDirect'),'upload shortcut present');
  assert.ok(emptyHTML.includes('orgDriveDirect'),'drive shortcut present');
  // A file arrives: workspace opens, prompt goes away, no duplicate file panel.
  w.qaLoad();
  assert.equal(vis('orgEmpty'),false,'prompt hides with file');
  assert.equal(vis('orgSide'),true,'sidebar shows with file');
  assert.equal(vis('organizeGrid'),true,'grid shows with file');
  assert.equal(vis('orgFab'),true,'fab shows with file');
  assert.equal(vis('orgReader'),true,'reader opens by default');
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
  // Blank clicks carry a valid (quote-escaped) id so the picker actually opens.
  assert.ok(w.document.getElementById('organizeGrid').innerHTML.includes('orgBlankAsk(&quot;blank-1&quot;)'),'blank click is valid');
  // A filled blank shows its image on the card.
  assert.equal(w.qaFill(),true,'filled blank renders image');
  const filledThumb=w.document.querySelector('[data-thumb="blank-1"]');
  assert.ok(!filledThumb.getAttribute('onclick').includes('orgBlankAsk'),'filled blank does not ask file');
  assert.ok(filledThumb.getAttribute('ondblclick').includes('openOrgViewer'),'filled blank zooms on double-click');
  const chips=[...w.document.querySelectorAll('#orgFiles .org-chip')];
  assert.equal(chips.length,1,'one file chip');
  assert.ok(chips[0].textContent.includes('A')&&chips[0].textContent.includes('a.pdf'),'badge + name');
  assert.ok(w.document.querySelector('.org-addfile'),'add-file button present');
  // The main drop card stays out of the way for organize, back for other tools.
  w.qaLoad();
  assert.ok(w.document.getElementById('drop').classList.contains('is-hidden'),'drop hidden for organize');
  w.qaTool('merge-pdf');
  assert.ok(!w.document.getElementById('drop').classList.contains('is-hidden'),'drop returns for merge');
  // Reader is part of the workspace: visible with files, no toggle needed.
  w.qaTool('organize-pdf');
  w.qaLoad();
  assert.ok(!w.document.getElementById('orgReader').classList.contains('is-hidden'),'reader shows with files');
  w.qaPreview();
  assert.ok(w.document.getElementById('orgBook'),'reader book element present');
  // Static fallback (no engine): plain spread + label follow the position.
  assert.equal(w.qaStatic(),2,'static spread renders two pages');
  assert.equal(w.document.getElementById('orgPageLabel').textContent,'2 / 3','static label follows');
  // Lazy renders swap into our faces even after the engine took the box.
  assert.equal(await w.qaFaceSwap(),true,'engine wrapper survives lazy renders');
  // Trello-style insertion gap while dragging.
  const g=w.qaGap();
  assert.equal(g.dimmed,true,'drag source dims while dragging');
  assert.equal(g.sideL,'before','left half means before');
  assert.equal(g.sideR,'after','right half means after');
  assert.equal(g.gap,true,'gap element appears on hover');
  assert.equal(g.gapIdx,3,'gap sits after card 2 (3 cells before it)');
  assert.equal(JSON.stringify(g.afterDrop.order),JSON.stringify([1,2,0,3]),'drop at gap moves card 0 after card 2');
  assert.equal(g.afterDrop.gapLeft,false,'gap removed after drop');
  assert.equal(g.selfGap,false,'no gap when hovering the dragged card itself');
  assert.equal(g.clean,true,'dragend leaves no gap or highlight');
  w.close();
  console.log('PASS organize workspace: empty state, sidebar, no duplicate panel');
}
main().catch(e=>{console.error(e);process.exit(1)});

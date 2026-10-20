/* AI Summarizer workspace (owner, 2026-10-20): the member's own writing next to the document.
 *   Catatan — notes / a summary written by hand (highlights and the AI summary can be put in);
 *   Jurnal  — a journal article draft, section by section (the AI can draft a section from
 *             the highlights and the notes);
 *   Slide   — at first one slide per page of the PDF, split into its text boxes and its
 *             pictures (each edited, moved, replaced on its own) on a background of one's
 *             choice; slides of one's own added by hand or made by the AI from the
 *             highlights and the notes; shown full screen, downloaded as .pptx or PDF.
 * Writing, presenting and downloading are free on every plan; the AI buttons follow the plan
 * (a crown and the price list when it lacks the AI). Everything is kept with the notebook's
 * session in this browser. Ask the document reads it too (context()). */
(function () {
  'use strict';
  const SECTIONS = [
    ['judul', 'Title', 'Judul'], ['abstrak', 'Abstract', 'Abstrak'], ['kata_kunci', 'Keywords', 'Kata kunci'],
    ['pendahuluan', 'Introduction', 'Pendahuluan'], ['metode', 'Method', 'Metode'], ['hasil', 'Results', 'Hasil'],
    ['pembahasan', 'Discussion', 'Pembahasan'], ['kesimpulan', 'Conclusion', 'Kesimpulan'], ['pustaka', 'References', 'Daftar pustaka']];
  const AI_SECTIONS = SECTIONS.map(s => s[0]).filter(k => k !== 'pustaka');
  const PPTX = 'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.min.js';
  const DOCX = 'https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.iife.js';
  const blank = () => ({notes: '', journal: {}, slides: []});
  let ctx = null, work = blank(), aiLocked = false, writing = false;
  const $ = s => document.querySelector(s);
  const L = (en, id) => (window.I18N ? I18N.pick(en, id) : id);

  // ---- small helpers
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function button(label, onclick, ico, cls) {
    const b = el('button', cls || '', label); b.type = 'button'; b.onclick = onclick;
    if (ico) b.dataset.ico = ico;
    return b;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const status = (id, text, bad) => ctx.status(id, text, bad);
  const changed = () => ctx.remember();
  // Only plain structure survives (what the toolbar makes): no attributes, no other tags.
  const KEEP = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'BLOCKQUOTE']);
  function clean(html) {
    const t = document.createElement('template'); t.innerHTML = String(html || '');
    const walk = node => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE)$/.test(c.nodeName)) { c.remove(); continue; }
        walk(c);
        if (!KEEP.has(c.nodeName)) { c.replaceWith(...c.childNodes); continue; }
        for (const a of [...c.attributes]) c.removeAttribute(a.name);
      }
    };
    walk(t.content);
    const d = document.createElement('div'); d.append(t.content); return d.innerHTML;
  }
  // The text of a node with its line breaks (innerText is flat for a hidden panel).
  function textOf(n) {
    let s = '';
    const walk = x => { for (const c of x.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeName === 'BR') s += '\n';
      else if (c.nodeType === 1) { if (/^(DIV|P|LI|H[1-6]|BLOCKQUOTE)$/.test(c.nodeName) && s && !s.endsWith('\n')) s += '\n'; walk(c); }
    } };
    walk(n);
    return s.replace(/ /g, ' ');
  }
  // Html (as kept) -> blocks: {kind: 'h' | 'li' | 'q' | 'p', text}
  function blocksOf(html) {
    const box = document.createElement('div'); box.innerHTML = clean(html);
    const out = [], para = s => s.split('\n').map(x => x.trim()).filter(Boolean).forEach(text => out.push({kind: 'p', text}));
    for (const n of box.childNodes) {
      if (n.nodeType === 3) { para(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const t = () => textOf(n).replace(/\s+/g, ' ').trim();
      if (/^H[1-6]$/.test(n.nodeName)) { if (t()) out.push({kind: 'h', text: t()}); }
      else if (/^(UL|OL)$/.test(n.nodeName)) n.querySelectorAll('li').forEach(li => { const s = textOf(li).replace(/\s+/g, ' ').trim(); if (s) out.push({kind: 'li', text: s}); });
      else if (n.nodeName === 'BLOCKQUOTE') { if (t()) out.push({kind: 'q', text: t()}); }
      else para(textOf(n));
    }
    return out;
  }
  const plain = blocks => blocks.map(b => b.kind === 'li' ? '- ' + b.text : b.kind === 'q' ? `"${b.text}"` : b.text).join('\n');
  // Plain text (an AI reply: paragraphs, "- " points) -> html for an editable box.
  function htmlOf(text) {
    const out = [];
    let list = [];
    const flush = () => { if (list.length) { out.push('<ul>' + list.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>'); list = []; } };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const m = line.match(/^[-•*]\s+(.*)$/);
      if (m) { list.push(m[1]); continue; }
      flush();
      out.push(/^#{1,3}\s/.test(line) ? `<h3>${esc(line.replace(/^#+\s*/, ''))}</h3>` : `<p>${esc(line)}</p>`);
    }
    flush();
    return out.join('');
  }
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = el('script'); s.src = src; s.onload = ok;
      s.onerror = () => fail(Error(L('Could not load the file maker. Check your internet connection.', 'Gagal memuat pembuat file. Periksa koneksi internet Anda.')));
      document.head.append(s);
    });
  }
  function saveBlob(name, blob) {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 140);
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const docTitle = () => ctx.title();
  // An editable box: plain-text paste (tidy), every change kept.
  function editable(box, onchange) {
    box.contentEditable = 'true'; box.spellcheck = false;
    box.addEventListener('input', onchange);
    box.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
  }
  // Formatting buttons act on the box being typed in (the selection stays where it is).
  function formatBar(bar) {
    bar.querySelectorAll('[data-cmd]').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => {
        const sel = getSelection(), host = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        const box = host && host.closest('[contenteditable=true]');
        if (!box || !bar.closest('.vpanel').contains(box)) return;
        const cmd = b.dataset.cmd;
        if (cmd === 'h3') document.execCommand('formatBlock', false, host.closest('h3') ? 'div' : 'h3');
        else if (cmd === 'quote') document.execCommand('formatBlock', false, host.closest('blockquote') ? 'div' : 'blockquote');
        else document.execCommand(cmd);
        box.dispatchEvent(new Event('input'));
      });
    });
  }
  function insertInto(box, html) {
    const sel = getSelection();
    if (sel.rangeCount && box.contains(sel.anchorNode)) document.execCommand('insertHTML', false, html);
    else { box.insertAdjacentHTML('beforeend', html); box.focus(); }
    box.dispatchEvent(new Event('input'));
  }
  // The AI buttons: a crown and the price list when the plan lacks the AI.
  function aiButton(label, onclick, ico) {
    const b = button(label, e => { if (aiLocked) { e.preventDefault(); location.href = '/harga'; return; } onclick(e); }, ico || 'spark', 'work-ai');
    if (aiLocked) crown(b);
    return b;
  }
  function crown(b) { b.classList.add('plan-lock'); b.title = L('Medium feature — see the plans', 'Fitur Medium — lihat paket'); }
  // The highlighted parts (the AI reads only these), with "highlight first" when there are none.
  function source(where) {
    if (!ctx.marks().length) { ctx.needMarks(where); return null; }
    return ctx.picked();
  }

  // ---- Notes
  function quotesHtml() {
    const P = L('p.', 'hlm.');
    return ctx.marks().slice().sort((a, b) => a.page - b.page || (a.top || 0) - (b.top || 0))
      .map(h => `<blockquote>${esc(h.whole ? L('Whole page', 'Seluruh halaman') : String(h.text).replace(/\s+/g, ' ').trim())} (${P} ${h.page + 1})</blockquote>`).join('') + '<p><br></p>';
  }
  function summaryHtml(text) {
    return (window.FlipbookSummary ? FlipbookSummary.blocks(text) : []).map(b =>
      b.kind === 'list' ? '<ul>' + b.items.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>'
        : b.kind === 'title' || b.kind === 'head' ? `<h3>${esc(b.text)}</h3>` : `<p>${esc(b.text)}</p>`).join('');
  }
  function wireNotes() {
    const box = $('#notes-out');
    box.dataset.ph = L('Write your own notes or summary…', 'Tulis catatan atau ringkasan Anda sendiri…');
    editable(box, () => { work.notes = box.innerHTML; changed(); });
    formatBar($('#notes-bar'));
    $('#notes-quotes').onclick = () => { if (!ctx.marks().length) { ctx.needMarks('#notes-status'); return; } insertInto(box, quotesHtml()); status('#notes-status', ''); };
    $('#notes-summary').onclick = () => {
      const s = ctx.summary();
      if (!s || !s.text) { status('#notes-status', L('Make the AI summary first (Studio › Make a summary).', 'Buat ringkasan AI dulu (Studio › Buat ringkasan).'), true); return; }
      insertInto(box, summaryHtml(s.text)); status('#notes-status', '');
    };
    $('#notes-copy').onclick = () => copy(plain(blocksOf(work.notes)), '#notes-status');
    $('#notes-docx').onclick = () => docx(docTitle() + L(' - notes', ' - catatan'), [{kind: 'title', text: docTitle()}, ...blocksOf(work.notes)], '#notes-status');
  }
  async function copy(text, where) {
    if (!text.trim()) { status(where, L('Nothing written yet.', 'Belum ada tulisan.'), true); return; }
    try { await navigator.clipboard.writeText(text); status(where, L('Copied.', 'Disalin.')); }
    catch (e) { status(where, L('The browser did not allow copying.', 'Browser tidak mengizinkan menyalin.'), true); }
  }
  async function docx(name, blocks, where) {
    if (!blocks.some(b => b.kind !== 'title')) { status(where, L('Nothing written yet.', 'Belum ada tulisan.'), true); return; }
    status(where, L('Making the Word file…', 'Membuat file Word…'));
    try {
      await loadScript(DOCX, () => window.docx);
      const {Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType} = window.docx;
      const kids = blocks.map(b =>
        b.kind === 'title' ? new Paragraph({text: b.text, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER})
          : b.kind === 'h' ? new Paragraph({text: b.text, heading: HeadingLevel.HEADING_1})
          : b.kind === 'li' ? new Paragraph({text: b.text, bullet: {level: 0}})
          : b.kind === 'q' ? new Paragraph({children: [new TextRun({text: b.text, italics: true})], indent: {left: 720}})
          : b.kind === 'em' ? new Paragraph({children: [new TextRun({text: b.text, italics: true})]})
          : new Paragraph({text: b.text, spacing: {after: 120}}));
      saveBlob(name + '.docx', await Packer.toBlob(new Document({creator: 'MyFlipbook', title: name, sections: [{children: kids}]})));
      status(where, '');
    } catch (e) { status(where, e.message, true); }
  }

  // ---- Journal draft
  function renderJournal() {
    const box = $('#journal-out'); box.replaceChildren();
    for (const [key, en, id] of SECTIONS) {
      const sec = el('section', 'jsec' + (key === 'judul' ? ' jtitle' : '')); sec.dataset.sec = key;
      const head = el('div', 'jhead');
      head.append(el('h3', '', L(en, id)));
      if (AI_SECTIONS.includes(key)) head.append(aiButton(L('Write with AI', 'Tulis dengan AI'), () => fillSection(key)));
      else head.append(button(L('Add this document', 'Tambahkan dokumen ini'), addReference, 'plus', 'jadd'));
      const ed = el('div', 'wdoc');
      ed.dataset.ph = key === 'judul' ? L('Article title', 'Judul artikel') : key === 'kata_kunci' ? L('keyword; keyword; keyword', 'kata kunci; kata kunci; kata kunci')
        : key === 'pustaka' ? L('One source per line', 'Satu sumber per baris') : L('Write here, or let the AI draft it from your highlights', 'Tulis di sini, atau biarkan AI membuat drafnya dari stabilo Anda');
      ed.innerHTML = clean(work.journal[key] || '');
      editable(ed, () => { work.journal[key] = ed.innerHTML; changed(); });
      sec.append(head, ed); box.append(sec);
    }
  }
  const sectionBox = key => $(`#journal-out [data-sec="${key}"] .wdoc`);
  const sectionText = key => plain(blocksOf(work.journal[key] || '')).trim();
  async function writeSection(key, text) {
    const r = await ctx.post('/api/write', {kind: 'journal', section: key, title: docTitle(), text, lang: ctx.lang(), work: context()});
    const html = key === 'judul' || key === 'kata_kunci' ? esc(r.text) : htmlOf(r.text);
    work.journal[key] = html; const ed = sectionBox(key); if (ed) ed.innerHTML = html;
    changed();
  }
  async function fillSection(key) {
    if (writing) return;
    const text = source('#journal-status'); if (!text) return;
    if (sectionText(key) && !await MFDialog.confirm({title: L('Write this part again?', 'Tulis ulang bagian ini?'),
      message: L('What is written in it now will be replaced.', 'Tulisan di bagian ini sekarang akan diganti.'), ok: L('Write again', 'Tulis ulang'), cancel: L('Cancel', 'Batal'), icon: '📝'})) return;
    const name = SECTIONS.find(s => s[0] === key);
    await busy(`#journal-out [data-sec="${key}"]`, '#journal-status', L(`Writing ${name[1]}…`, `Menulis ${name[2]}…`), () => writeSection(key, text));
  }
  async function fillEmpty() {
    if (writing) return;
    const text = source('#journal-status'); if (!text) return;
    const todo = AI_SECTIONS.filter(k => !sectionText(k));
    if (!todo.length) { status('#journal-status', L('Every part already has text. Use “Write with AI” on a part to write it again.', 'Semua bagian sudah terisi. Pakai “Tulis dengan AI” di bagiannya untuk menulis ulang.')); return; }
    for (const [i, key] of todo.entries()) {
      const name = SECTIONS.find(s => s[0] === key);
      const ok = await busy(`#journal-out [data-sec="${key}"]`, '#journal-status', L(`Writing ${name[1]} (${i + 1}/${todo.length})…`, `Menulis ${name[2]} (${i + 1}/${todo.length})…`), () => writeSection(key, text));
      if (!ok) return;
    }
    status('#journal-status', L('Draft ready — check every part and add your own sources.', 'Draf siap — periksa setiap bagian dan lengkapi sumber Anda sendiri.'));
  }
  // An AI job: the part shimmers, the buttons wait, the seconds count.
  async function busy(partSel, where, label, job) {
    writing = true;
    const part = partSel && $(partSel); if (part) part.classList.add('writing');
    document.querySelectorAll('.work-ai').forEach(b => { b.disabled = true; });
    const start = Date.now(), tick = () => status(where, `⏱ ${Math.round((Date.now() - start) / 1000)} ${L('s', 'dtk')} · ${label}`);
    tick(); const timer = setInterval(tick, 1000);
    try { await job(); status(where, ''); return true; }
    catch (e) { status(where, e.message, true); return false; }
    finally {
      clearInterval(timer); writing = false;
      if (part) part.classList.remove('writing');
      document.querySelectorAll('.work-ai').forEach(b => { b.disabled = false; });
    }
  }
  function addReference() {
    const ed = sectionBox('pustaka'); if (!ed) return;
    const line = `${L('[Author]', '[Penulis]')}. (${L('[Year]', '[Tahun]')}). ${docTitle()}. ${L('[Publisher / journal]', '[Penerbit / jurnal]')}.`;
    ed.insertAdjacentHTML('beforeend', `<div>${esc(line)}</div>`); ed.dispatchEvent(new Event('input')); ed.focus();
  }
  function journalBlocks() {
    const out = [];
    const t = sectionText('judul'); out.push({kind: 'title', text: t || docTitle()});
    for (const [key, en, id] of SECTIONS) {
      if (key === 'judul') continue;
      const blocks = blocksOf(work.journal[key] || ''); if (!blocks.length) continue;
      if (key === 'kata_kunci') { out.push({kind: 'em', text: `${L(en, id)}: ${plain(blocks).replace(/\n/g, ' ')}`}); continue; }
      out.push({kind: 'h', text: L(en, id)}, ...blocks);
    }
    return out;
  }
  function wireJournal() {
    formatBar($('#journal-bar'));
    const all = aiButton(L('Fill the empty parts with AI', 'Isi bagian kosong dengan AI'), fillEmpty);
    $('#journal-bar').prepend(all);
    $('#journal-copy').onclick = () => copy(journalBlocks().map(b => b.kind === 'li' ? '- ' + b.text : b.text).join('\n\n'), '#journal-status');
    $('#journal-docx').onclick = () => docx((sectionText('judul') || docTitle()).slice(0, 100) + L(' - journal draft', ' - draf jurnal'), journalBlocks(), '#journal-status');
    $('#journal-clear').onclick = async () => {
      if (!Object.values(work.journal).some(v => blocksOf(v).length)) return;
      if (!await MFDialog.confirm({title: L('Empty the draft?', 'Kosongkan draf?'), message: L('Every part of this journal draft will be emptied.', 'Semua bagian draf jurnal ini akan dikosongkan.'),
        ok: L('Empty', 'Kosongkan'), cancel: L('Cancel', 'Batal'), danger: true})) return;
      work.journal = {}; renderJournal(); changed();
    };
  }

  // ---- Slides
  // A slide is a background (a colour, a picture) with boxes on it, every one its own:
  //   {bg: {color, image}, items: [...], notes, page?: from 0 (made from that page of the PDF), ready}
  //   item: {id, type: 'text' | 'image', x, y, w, h (parts of the slide), text, size (part of the
  //          slide's height), color, bold, italic, align, font, src, art (the page's own design)}
  // A slide made from a page is split when it first shows: its text into text boxes, its
  // pictures into pictures, what is left of the page (panels, lines) one picture under them.
  const AR = 16 / 9;
  let pdfDoc = null, pdfBlob = null, queue = Promise.resolve(), seen = null, sel = null, nid = 1;
  const id = () => 'i' + Date.now().toString(36) + (nid++);
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
  const lum = hex => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255; };
  const inkFor = bg => lum(bg.color || '#FFFFFF') < 0.5 && !bg.image ? '#FFFFFF' : '#1C1917';
  const shown = s => s.page != null || s.items.length;
  async function pdf() {
    const blob = ctx.blob();
    if (!blob) throw Error(L('Open the PDF first.', 'Buka PDF-nya dulu.'));
    if (blob !== pdfBlob) { if (pdfDoc) pdfDoc.destroy().catch(() => {}); pdfDoc = null; pdfBlob = blob; }
    if (!pdfDoc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      pdfDoc = await pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
    }
    return pdfDoc;
  }
  // Lines of one paragraph (same column, size and colour, close under each other) -> one box.
  // (loose: lines read by OCR, whose measured size varies from line to line)
  function paragraphs(lines, loose) {
    const out = [], tol = loose ? 0.25 : 0.15, gap = loose ? 1.5 : 0.8;
    for (const ln of lines.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
      const b = out.find(o => Math.abs(o.x - ln.x) < ln.size * 1.2 && Math.abs(o.size - ln.size) < ln.size * tol && o.color === ln.color && o.bold === ln.bold
        && ln.y - (o.y + o.h) < ln.size * gap && ln.y > o.y + o.h - ln.size * 0.6);
      if (!b) { out.push({x: ln.x, y: ln.y, w: ln.w, h: ln.h, size: ln.size, color: ln.color, bold: ln.bold, italic: ln.italic, font: ln.font, text: ln.text, last: ln, sizes: [ln.size]}); continue; }
      const lastText = b.last.text, list = /^([•\-–*▪●]|\d+[.)]|[a-z][.)])\s/.test(ln.text);
      if (/[a-z]-$/.test(lastText) && /^[a-z]/.test(ln.text)) b.text = b.text.slice(0, -1) + ln.text;
      else b.text += (list || /:$/.test(lastText) || b.last.w < Math.max(b.w, ln.w) * 0.7 ? '\n' : ' ') + ln.text;
      const right = Math.max(b.x + b.w, ln.x + ln.w);
      b.x = Math.min(b.x, ln.x); b.w = right - b.x; b.h = ln.y + ln.h - b.y; b.italic = b.italic && ln.italic; b.last = ln; b.sizes.push(ln.size);
    }
    if (loose) for (const b of out) b.size = b.sizes.slice().sort((x, y) => x - y)[b.sizes.length >> 1];        // the usual size of its lines
    return out;
  }
  // Is a picture (a data URL) just white? (a plain page needs no picture of its own)
  function isWhite(src) {
    return new Promise(ok => {
      const img = new Image();
      img.onload = () => {
        const c = el('canvas'); c.width = 48; c.height = 48; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
        const d = g.getImageData(0, 0, 48, 48).data; let white = true;
        for (let i = 0; i < d.length && white; i += 4) if (d[i] < 244 || d[i + 1] < 244 || d[i + 2] < 244) white = false;
        ok(white);
      };
      img.onerror = () => ok(false); img.src = src;
    });
  }
  // A slide made from a page: its boxes, once (one page at a time).
  function split(slide) {
    if (slide.ready) return Promise.resolve();
    if (slide.splitting) return slide.splitting;
    const job = queue.then(async () => {
      const page = await (await pdf()).getPage(slide.page + 1);
      let lay = await PdfLayout.layoutPage(page, {images: true, maxPx: 1600});
      // A scanned page (no text of its own): read it, and take it apart the same way.
      if (!(lay.runs || []).length && window.OcrEngine) lay = await scanLayout(page).catch(() => null) || lay;
      page.cleanup();
      const art = 'data:image/jpeg;base64,' + lay.background.b64, design = !await isWhite(art);
      // What is fitted on the slide: the whole page when it has a design of its own, otherwise
      // just its content (a plain page's white margins go, so the text reads bigger).
      const boxes = [...(lay.runs || []), ...(lay.images || [])];
      let x0 = 0, y0 = 0, x1 = lay.width, y1 = lay.height;
      if (!design && boxes.length) {
        const pad = lay.width * 0.03;
        x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad); y0 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
        x1 = Math.min(lay.width, Math.max(...boxes.map(b => b.x + b.w)) + pad); y1 = Math.min(lay.height, Math.max(...boxes.map(b => b.y + b.h)) + pad);
      }
      const m = design ? 0 : 0.05, k = Math.min((1 - 2 * m) * AR / (x1 - x0), (1 - 2 * m) / (y1 - y0));       // slide heights per point
      const pw = (x1 - x0) * k / AR, ph = (y1 - y0) * k, px = (1 - pw) / 2, py = (1 - ph) / 2;
      const X = v => px + (v - x0) * k / AR, Y = v => py + (v - y0) * k, SW = v => v * k / AR, SH = v => v * k;
      const items = [];
      if (design) items.push({id: id(), type: 'image', art: true, x: px, y: py, w: pw, h: ph, src: art});
      for (const im of lay.images || []) items.push({id: id(), type: 'image', x: X(im.x), y: Y(im.y), w: SW(im.w), h: SH(im.h), src: `data:image/${im.type};base64,${im.b64}`});
      for (const b of paragraphs(lay.runs || [], lay.scanned)) items.push({id: id(), type: 'text', x: X(b.x), y: Y(b.y), w: Math.min(1 - X(b.x), SW(b.w) * 1.06 + SH(b.size) * 0.4), h: SH(b.h),
        text: b.text, size: SH(b.size), color: '#' + (b.color || '1C1917'), bold: !!b.bold, italic: !!b.italic, font: b.font || null, align: 'left'});
      slide.items = items; slide.bg = slide.bg || {color: '#FFFFFF'}; slide.ready = true;
    });
    queue = job.catch(() => {});
    slide.splitting = job.finally(() => { delete slide.splitting; });
    return slide.splitting;
  }
  // ---- A scanned page taken apart: OCR finds the lines (where, how big, what colour); they
  // come off the picture (painted over with the paper's colour); what is left that is dense
  // and sizeable (a photo, a drawing) is cut out as a picture of its own; what remains after
  // that (rules, frames) is the page's background, or nothing when it is plain paper.
  // Returns what PdfLayout.layoutPage returns (points, from the top left), or null.
  let ocrPool = null;
  async function scanLayout(page) {
    const base = page.getViewport({scale: 1}), k = Math.min(3, 2000 / Math.max(base.width, base.height)), vp = page.getViewport({scale: k});
    const c = el('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d', {willReadFrequently: true}); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({canvasContext: g, viewport: vp}).promise;
    const W = c.width, H = c.height;
    // a working copy the text comes off as it is found
    const e = el('canvas'); e.width = W; e.height = H;
    const eg = e.getContext('2d', {willReadFrequently: true}); eg.drawImage(c, 0, 0);
    try {
      ocrPool = ocrPool || OcrEngine.pool({langs: 'ind+eng', size: 1});
      const pool = await ocrPool;
      const r = await pool.recognize(c);
      if (r.rotate) return null;                                     // a page lying sideways stays one picture
      const px = g.getImageData(0, 0, W, H).data, paper = paperOf(px, W, H), fill = `rgb(${paper.join(',')})`;
      const sure = data => {
        const out = [];
        for (const line of data.lines || []) {
          const words = (line.words || []).filter(w => w.confidence >= 45 && /[\p{L}\p{N}]/u.test(w.text || '') && (w.text.trim().length > 1 || /^[aAI&%$]$/.test(w.text.trim()) || w.confidence >= 85));
          if (!words.length || (words.map(w => w.text).join('').match(/[\p{L}\p{N}]/gu) || []).length < 2) continue;
          if (words.reduce((t, w) => t + w.confidence, 0) / words.length < 60) continue;          // a doubtful read is not text
          const b = words.reduce((o, w) => ({x0: Math.min(o.x0, w.bbox.x0), y0: Math.min(o.y0, w.bbox.y0), x1: Math.max(o.x1, w.bbox.x1), y1: Math.max(o.y1, w.bbox.y1)}),
            {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity});
          out.push({text: words.map(w => w.text.trim()).join(' '), box: b, words});
        }
        return out;
      };
      const erase = (ctx2, lines) => { ctx2.fillStyle = fill; for (const ln of lines) for (const w of ln.words) { const pad = Math.max(2, (w.bbox.y1 - w.bbox.y0) * 0.15); ctx2.fillRect(w.bbox.x0 - pad, w.bbox.y0 - pad, w.bbox.x1 - w.bbox.x0 + 2 * pad, w.bbox.y1 - w.bbox.y0 + 2 * pad); } };
      let found = sure(r.data);
      erase(eg, found);
      // Writing the first read missed (a big title, a line apart) shows in what is left: read that once more.
      if (regions(eg.getImageData(0, 0, W, H).data, W, H, paper, 'any')) {
        const more = sure((await pool.recognize(e, {rotate: false})).data)
          .filter(ln => !found.some(o => o.box.x0 < ln.box.x1 && ln.box.x0 < o.box.x1 && o.box.y0 < ln.box.y1 && ln.box.y0 < o.box.y1));
        erase(eg, more); found = found.concat(more);
      }
      // What is still inked once the text is off, gathered into areas: the pictures. A line
      // whose middle lies in one belongs to it (the writing in a screenshot, a label in a chart).
      const pics = joined(regions(eg.getImageData(0, 0, W, H).data, W, H, paper, 'pic'), W * 0.04, H * 0.03);
      const inPic = b => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; return pics.some(q => cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1); };
      const lines = found.filter(ln => !inPic(ln.box));
      eg.fillStyle = fill; for (const q of pics) eg.fillRect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0);
      if (!lines.length) return null;
      const images = pics.map(q => {
        const cut = el('canvas'); cut.width = q.x1 - q.x0; cut.height = q.y1 - q.y0;
        cut.getContext('2d').drawImage(c, q.x0, q.y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
        const out = {x: q.x0 / k, y: q.y0 / k, w: cut.width / k, h: cut.height / k, type: 'jpeg', b64: cut.toDataURL('image/jpeg', 0.88).split(',')[1]};
        cut.width = 0; return out;
      });
      // what is left: the background, or plain white when it is just paper
      let b64;
      if (regions(eg.getImageData(0, 0, W, H).data, W, H, paper, 'any')) b64 = e.toDataURL('image/jpeg', 0.85).split(',')[1];
      else { const t = el('canvas'); t.width = t.height = 8; const tg = t.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, 8, 8); b64 = t.toDataURL('image/jpeg').split(',')[1]; }
      const runs = lines.map(ln => {
        const b = ln.box, h = b.y1 - b.y0;
        const size = emOf(px, W, b, paper) || h * 0.95;
        return {text: ln.text, color: inkOf(px, W, b, paper), size: size / k, x: b.x0 / k, y: b.y0 / k, w: (b.x1 - b.x0) / k, h: Math.max(h, size * 1.2) / k, bold: false, italic: false, font: null};
      });
      return {width: base.width, height: base.height, background: {b64}, images, runs, scanned: true};
    } finally { c.width = c.height = 0; e.width = e.height = 0; }
  }
  // Areas near each other (closer than dx, dy) become one, until none are.
  function joined(boxes, dx, dy) {
    const out = boxes.map(b => ({...b}));
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length && !again; i++) for (let j = i + 1; j < out.length && !again; j++) {
        const a = out[i], b = out[j];
        if (a.x0 - dx < b.x1 && b.x0 - dx < a.x1 && a.y0 - dy < b.y1 && b.y0 - dy < a.y1) {
          out[i] = {x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)}; out.splice(j, 1); again = true;
        }
      }
    }
    return out;
  }
  // The paper: the commonest light colour along the edges.
  function paperOf(px, W, H) {
    const counts = new Map();
    const take = (x, y) => { const i = (y * W + x) * 4; if (px[i] + px[i + 1] + px[i + 2] < 450) return; const key = [px[i] >> 3, px[i + 1] >> 3, px[i + 2] >> 3].join(','); counts.set(key, (counts.get(key) || 0) + 1); };
    const step = Math.max(1, Math.floor(Math.min(W, H) / 200));
    for (let x = 0; x < W; x += step) for (const y of [2, Math.floor(H * 0.02), H - 3, Math.floor(H * 0.98)]) take(x, y);
    for (let y = 0; y < H; y += step) for (const x of [2, Math.floor(W * 0.02), W - 3, Math.floor(W * 0.98)]) take(x, y);
    let best = null, n = 0; counts.forEach((v, key) => { if (v > n) { n = v; best = key; } });
    return best ? best.split(',').map(v => v * 8 + 4) : [255, 255, 255];
  }
  // A line's type size from its x-height (the band where most rows carry ink, about half the
  // size): steady whether or not a line has tall letters or ones hanging below.
  function emOf(px, W, b, paper) {
    const rows = [];
    for (let y = Math.max(0, Math.floor(b.y0)); y < b.y1; y++) {
      let n = 0;
      for (let x = Math.max(0, Math.floor(b.x0)); x < b.x1; x += 2) { const i = (y * W + x) * 4; if (Math.abs(px[i] - paper[0]) + Math.abs(px[i + 1] - paper[1]) + Math.abs(px[i + 2] - paper[2]) > 150) n++; }
      rows.push(n);
    }
    const top = Math.max(...rows); if (!top) return 0;
    const core = rows.filter(n => n >= top * 0.35).length;
    return core >= 3 ? core / 0.5 : 0;
  }
  // A line's ink colour: the darkest part of its box (dark ink as one near-black).
  function inkOf(px, W, b, paper) {
    const vals = [];
    for (let y = Math.max(0, Math.floor(b.y0)); y < b.y1; y += 2) for (let x = Math.max(0, Math.floor(b.x0)); x < b.x1; x += 2) {
      const i = (y * W + x) * 4; const d = Math.abs(px[i] - paper[0]) + Math.abs(px[i + 1] - paper[1]) + Math.abs(px[i + 2] - paper[2]);
      if (d > 150) vals.push([px[i], px[i + 1], px[i + 2], px[i] + px[i + 1] + px[i + 2]]);
    }
    if (!vals.length) return '1C1917';
    vals.sort((a, z) => a[3] - z[3]);
    const part = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.3)));
    const mean = [0, 1, 2].map(k => part.reduce((t, v) => t + v[k], 0) / part.length);
    if ((mean[0] * 0.299 + mean[1] * 0.587 + mean[2] * 0.114) / 255 < 0.3 && Math.max(...mean) - Math.min(...mean) < 40) return '1C1917';
    return mean.map(v => Math.min(255, Math.round(v / 32) * 32).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // Areas of a page picture by what covers them, [{x0, y0, x1, y1}] of the sizeable ones:
  //   'pic'   — any ink left once the text is off, close bits joined (a photo, a screenshot,
  //             a drawing); sparse frames and rules (a table's lines) are not pictures;
  //   'ink'   — densely inked;
  //   'any'   — (true / false) a fair amount of ink anywhere at all.
  function regions(px, W, H, paper, mode) {
    const cell = Math.max(6, Math.round(Math.min(W, H) / 180)), gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const on = new Uint8Array(gw * gh);
    let inked = 0;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let n = 0, hit = 0;
      for (let y = gy * cell; y < Math.min(H, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(W, (gx + 1) * cell); x += 2) {
        const i = (y * W + x) * 4; n++;
        if (Math.abs(px[i] - paper[0]) + Math.abs(px[i + 1] - paper[1]) + Math.abs(px[i + 2] - paper[2]) > 70) hit++;
      }
      const f = n ? hit / n : 0;
      if (f > 0.08) inked++;
      on[gy * gw + gx] = mode === 'pic' ? (f >= 0.12 ? 1 : 0) : f >= 0.3 ? 1 : 0;
    }
    if (mode === 'any') return inked > gw * gh * 0.004;
    if (mode === 'pic') {                                          // ink close together is one area
      const grown = new Uint8Array(on.length), r = 3;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (on[y * gw + x])
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) grown[ny * gw + nx] = 1; }
      on.set(grown);
    }
    const seen = new Uint8Array(gw * gh), out = [];
    for (let s0 = 0; s0 < on.length; s0++) {
      if (seen[s0] || !on[s0]) continue;
      const stack = [s0]; seen[s0] = 1; let x0 = gw, y0 = gh, x1 = 0, y1 = 0, cells = 0;
      while (stack.length) {
        const s1 = stack.pop(), x = s1 % gw, y = (s1 - x) / gw; cells++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {             // small gaps still join
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const t = ny * gw + nx; if (!seen[t] && on[t]) { seen[t] = 1; stack.push(t); }
        }
      }
      const bw = (x1 - x0 + 1) * cell, bh = (y1 - y0 + 1) * cell;
      if (bw >= W * 0.08 && bh >= H * 0.05 && cells >= (x1 - x0 + 1) * (y1 - y0 + 1) * (mode === 'pic' ? 0.5 : 0.35))
        out.push({x0: x0 * cell, y0: y0 * cell, x1: Math.min(W, (x1 + 1) * cell), y1: Math.min(H, (y1 + 1) * cell)});
    }
    return out;
  }
  const textBox = (text, x, y, w, h, size, bold, color) => ({id: id(), type: 'text', x, y, w, h, text, size, color, bold: !!bold, italic: false, align: 'left', font: null});
  // A slide of one's own: a title and points (cover: a big title and a line under it).
  function ownSlide(title, points, cover, bg) {
    bg = bg || {color: '#FFFFFF'}; const ink = inkFor(bg);
    const items = cover
      ? [textBox(title, 0.08, 0.33, 0.84, 0.16, 0.085, true, ink), ...(points.length ? [textBox(points.join('\n'), 0.08, 0.54, 0.84, 0.08, 0.04, false, ink === '#FFFFFF' ? '#E7E5E4' : '#57534E')] : [])]
      : [textBox(title, 0.07, 0.08, 0.86, 0.12, 0.068, true, ink), textBox(points.map(p => '• ' + p).join('\n'), 0.07, 0.26, 0.86, 0.62, 0.042, false, ink)];
    return {bg: {...bg}, items, notes: '', ready: true};
  }

  // ---- drawing a slide (editable on its card, plain in the presentation)
  function place(node, it) {
    Object.assign(node.style, {left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%'});
    if (it.type === 'image') node.style.height = it.h * 100 + '%'; else node.style.minHeight = it.h * 100 + '%';
  }
  function styleText(node, it) {
    Object.assign(node.style, {fontSize: `calc(${it.size} * 56.25cqw)`, color: it.color, fontWeight: it.bold ? '700' : '400', fontStyle: it.italic ? 'italic' : 'normal',
      textAlign: it.align || 'left', fontFamily: it.font ? `"${it.font}", 'Plus Jakarta Sans', sans-serif` : "'Plus Jakarta Sans', sans-serif"});
  }
  function paintBg(f, bg) {
    f.style.backgroundColor = (bg && bg.color) || '#FFFFFF';
    f.style.backgroundImage = bg && bg.image ? `url("${bg.image}")` : '';
  }
  function face(slide, edit, card) {
    const f = el('div', 'slide-face' + (edit ? ' edit' : ''));
    paintBg(f, slide.bg);
    if (slide.page != null && !slide.ready) {
      f.append(el('span', 'pg-wait', L('Preparing the page…', 'Menyiapkan halaman…')));
      if (edit) {
        seen = seen || new IntersectionObserver(entries => entries.forEach(en => {
          if (!en.isIntersecting) return;
          seen.unobserve(en.target);
          const s = en.target.slideRef;
          split(s).then(() => { changed(); redraw(s); }).catch(() => { en.target.replaceChildren(el('span', 'pg-wait', L('This page could not be read.', 'Halaman ini tidak bisa dibaca.'))); });
        }), {rootMargin: '600px 0px'});
        f.slideRef = slide; seen.observe(f);
      }
      return f;
    }
    for (const it of slide.items) f.append(itemNode(slide, it, edit, f, card));
    if (edit) f.addEventListener('pointerdown', e => { if (e.target === f) choose(null); });
    if (slide.page != null && edit) f.append(el('span', 'pg-tag', L(`Page ${slide.page + 1}`, `Halaman ${slide.page + 1}`)));
    return f;
  }
  function itemNode(slide, it, edit, f, card) {
    const n = el('div', 'it ' + (it.type === 'image' ? 'img' : 'txt')); n.dataset.id = it.id;
    place(n, it);
    if (it.type === 'image') { const img = el('img'); img.alt = ''; img.src = it.src; img.draggable = false; n.append(img); }
    else { const t = el('div', 'it-text'); t.textContent = it.text; styleText(t, it); n.append(t); }
    if (!edit) return n;
    if (sel && sel.it === it) n.classList.add('on');
    if (it.type === 'text') {
      const t = n.firstChild; t.dataset.ph = L('Type here', 'Ketik di sini');
      editable(t, () => { it.text = textOf(t).replace(/\n$/, ''); it.h = Math.max(it.h, t.offsetHeight / f.clientHeight * 0.999); changed(); });
      t.addEventListener('focus', () => choose({slide, it, card}));
    }
    const mover = el('span', 'h-move'); mover.title = L('Drag to move', 'Seret untuk memindahkan');
    const sizer = el('span', 'h-size'); sizer.title = L('Drag to resize', 'Seret untuk mengubah ukuran');
    n.append(mover, sizer);
    mover.addEventListener('pointerdown', e => drag(e, it, n, f, 'move'));
    sizer.addEventListener('pointerdown', e => drag(e, it, n, f, 'size'));
    n.addEventListener('pointerdown', e => {
      if (e.target === mover || e.target === sizer) return;
      choose({slide, it, card});
      if (it.type === 'image') drag(e, it, n, f, 'move');             // a picture moves from anywhere on it
    });
    return n;
  }
  function drag(e, it, n, f, mode) {
    e.preventDefault(); e.stopPropagation();
    const r = f.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, s = {x: it.x, y: it.y, w: it.w, h: it.h};
    const move = ev => {
      const dx = (ev.clientX - x0) / r.width, dy = (ev.clientY - y0) / r.height;
      if (mode === 'move') { it.x = Math.min(0.98, Math.max(0.02 - s.w, s.x + dx)); it.y = Math.min(0.98, Math.max(0.02 - s.h, s.y + dy)); }
      else if (it.type === 'image') { it.w = Math.max(0.03, s.w + dx); it.h = s.h * it.w / s.w; }    // a picture keeps its shape
      else { it.w = Math.max(0.04, s.w + dx); it.h = Math.max(0.03, s.h + dy); }
      place(n, it);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); changed(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  // The box being worked on (its tools show on its card).
  function choose(next) {
    if (sel && next && sel.it === next.it) return;
    document.querySelectorAll('#slides-list .it.on').forEach(n => n.classList.remove('on'));
    document.querySelectorAll('#slides-list .it-bar').forEach(b => b.replaceChildren());
    sel = next;
    if (!sel) return;
    const card = sel.card; if (!card) return;
    const node = card.querySelector(`.it[data-id="${sel.it.id}"]`); if (node) node.classList.add('on');
    itemBar(card.querySelector('.it-bar'), sel.slide, sel.it, card);
  }
  function itemBar(bar, slide, it, card) {
    const node = () => card.querySelector(`.it[data-id="${it.id}"]`), text = () => node() && node().querySelector('.it-text');
    const restyle = () => { const t = text(); if (t) styleText(t, it); changed(); };
    const tool = (label, title, fn, ico) => { const b = button(label, fn, ico, 'tool'); b.title = title; b.addEventListener('mousedown', e => e.preventDefault()); return b; };
    const remove = tool('', L('Delete this box', 'Hapus kotak ini'), () => { slide.items = slide.items.filter(x => x !== it); sel = null; redraw(slide); changed(); }, 'trash');
    if (it.type === 'text') {
      const color = el('input'); color.type = 'color'; color.value = hexOk(it.color) ? it.color : '#1C1917'; color.title = L('Text colour', 'Warna teks');
      color.oninput = () => { it.color = color.value; restyle(); };
      const aligns = ['left', 'center', 'right'], marks = {left: '⟸', center: '≡', right: '⟹'};
      const align = tool(marks[it.align || 'left'], L('Alignment', 'Perataan'), () => { it.align = aligns[(aligns.indexOf(it.align || 'left') + 1) % 3]; align.textContent = marks[it.align]; restyle(); });
      bar.append(tool('A−', L('Smaller', 'Perkecil'), () => { it.size = Math.max(0.012, it.size / 1.12); restyle(); }),
        tool('A+', L('Bigger', 'Perbesar'), () => { it.size = Math.min(0.3, it.size * 1.12); restyle(); }),
        tool('B', L('Bold', 'Tebal'), () => { it.bold = !it.bold; restyle(); }), tool('I', L('Italic', 'Miring'), () => { it.italic = !it.italic; restyle(); }),
        align, color, remove);
    } else {
      const swap = tool(L('Replace', 'Ganti'), L('Replace this picture', 'Ganti gambar ini'), async () => {
        const src = await pickImage(); if (!src) return;
        it.src = src.url; it.h = it.w * AR / src.aspect; delete it.art;          // same width, the new picture's shape
        redraw(slide); changed();
      }, 'swap');
      const front = tool('', L('To the front', 'Ke depan'), () => { slide.items = [...slide.items.filter(x => x !== it), it]; redraw(slide); changed(); }, 'up');
      const back = tool('', L('To the back', 'Ke belakang'), () => { slide.items = [it, ...slide.items.filter(x => x !== it)]; redraw(slide); changed(); }, 'down');
      bar.append(swap, front, back, remove);
    }
  }
  // A picture from the computer, made a reasonable size (JPEG, or PNG when it is see-through).
  function pickImage() {
    return new Promise(ok => {
      const input = el('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0]; if (!file) { ok(null); return; }
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
          const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = el('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          const png = /png|gif|webp|svg/i.test(file.type);
          ok({url: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), aspect: c.width / c.height}); c.width = 0;
        };
        img.onerror = () => { URL.revokeObjectURL(url); status('#slides-status', L('This picture could not be read.', 'Gambar ini tidak bisa dibaca.'), true); ok(null); };
        img.src = url;
      };
      input.click();
    });
  }
  const SWATCHES = ['#FFFFFF', '#F6EFE3', '#1C1917', '#1A3C34', '#1E3A8A', '#FF5C28'];
  function setBg(slide, bg, all) {
    for (const s of all ? work.slides : [slide]) {
      const was = inkFor(s.bg || {});
      s.bg = {...bg};
      const now = inkFor(s.bg);
      // text that would vanish on the new background turns light / dark
      if (now !== was) for (const it of s.items) if (it.type === 'text' && (now === '#FFFFFF' ? lum(it.color) < 0.35 : lum(it.color) > 0.85)) it.color = now;
    }
    if (all) renderSlides(); else redraw(slide);
    changed();
  }
  function bgBar(slide) {
    const row = el('div', 'bg-row');
    row.append(el('span', 'bg-label', L('Background', 'Latar')));
    for (const c of SWATCHES) {
      const b = button('', () => setBg(slide, {color: c}), null, 'sw' + ((slide.bg || {}).color === c && !(slide.bg || {}).image ? ' on' : ''));
      b.style.background = c; b.title = c; row.append(b);
    }
    const pick = el('input'); pick.type = 'color'; pick.value = hexOk((slide.bg || {}).color) ? slide.bg.color : '#FFFFFF'; pick.title = L('Other colour', 'Warna lain');
    pick.onchange = () => setBg(slide, {color: pick.value});
    const image = button('', async () => { const src = await pickImage(); if (src) setBg(slide, {color: (slide.bg || {}).color || '#FFFFFF', image: src.url}); }, 'image', 'tool');
    image.title = L('Background picture', 'Gambar latar');
    const all = button(L('All slides', 'Semua slide'), () => setBg(slide, slide.bg || {color: '#FFFFFF'}, true), null, 'tool wide');
    all.title = L('Use this background on every slide', 'Pakai latar ini di semua slide');
    row.append(pick, image, all);
    return row;
  }
  // ---- the cards
  function card(slide, i) {
    const li = el('li', 'slide-card'); li.slideRef = slide;
    const side = el('div', 'slide-side');
    const top = el('div', 'slide-tools');
    top.append(el('span', 'sn', String(i + 1)),
      button('', () => move(i, -1), 'up', 'icon'), button('', () => move(i, 1), 'down', 'icon'),
      button('', () => present(i), 'play', 'icon'), button('', () => insertAfter(i), 'plus', 'icon'), button('', () => removeSlide(i), 'trash', 'icon'));
    const [up, down, play, add, del] = top.querySelectorAll('button');
    up.title = L('Move up', 'Naikkan'); down.title = L('Move down', 'Turunkan'); play.title = L('Present from here', 'Presentasi dari sini');
    add.title = L('New slide after this one', 'Slide baru setelah ini'); del.title = L('Delete slide', 'Hapus slide');
    up.disabled = i === 0; down.disabled = i === work.slides.length - 1;
    const adds = el('div', 'slide-adds');
    adds.append(button(L('Text', 'Teks'), () => addText(slide), 'plus', 'tool wide'), button(L('Picture', 'Gambar'), () => addImage(slide), 'image', 'tool wide'));
    const notes = el('textarea', 'sf-notes'); notes.rows = 3; notes.value = slide.notes || '';
    notes.placeholder = L('Speaker notes', 'Catatan pembicara');
    notes.addEventListener('input', () => { slide.notes = notes.value; changed(); });
    side.append(top, adds, bgBar(slide), el('div', 'it-bar'), notes);
    li.append(face(slide, true, li), side);
    return li;
  }
  function redraw(slide) {
    const li = [...document.querySelectorAll('#slides-list .slide-card')].find(c => c.slideRef === slide); if (!li) return;
    const i = work.slides.indexOf(slide), fresh = card(slide, i);
    li.replaceWith(fresh);
    if (sel && sel.slide === slide && slide.items.includes(sel.it)) { const keep = sel.it; sel = null; choose({slide, it: keep, card: fresh}); } else if (sel && sel.slide === slide) sel = null;
  }
  function renderSlides() {
    sel = null;
    const list = $('#slides-list'); list.replaceChildren(...work.slides.map(card));
    $('#slides-empty').hidden = !!work.slides.length;
  }
  function addText(slide) {
    const it = textBox('', 0.1, 0.42, 0.6, 0.08, 0.045, false, inkFor(slide.bg || {}));
    slide.items.push(it); redraw(slide); changed();
    const li = [...document.querySelectorAll('#slides-list .slide-card')].find(c => c.slideRef === slide);
    const t = li && li.querySelector(`.it[data-id="${it.id}"] .it-text`); if (t) t.focus();
  }
  async function addImage(slide) {
    const src = await pickImage(); if (!src) return;
    const w = Math.min(0.5, 0.6 * src.aspect / AR), h = w * AR / src.aspect;
    slide.items.push({id: id(), type: 'image', x: (1 - w) / 2, y: (1 - h) / 2, w, h, src: src.url});
    redraw(slide); changed();
  }
  function move(i, by) { const j = i + by; if (j < 0 || j >= work.slides.length) return; [work.slides[i], work.slides[j]] = [work.slides[j], work.slides[i]]; renderSlides(); changed(); }
  async function removeSlide(i) {
    const s = work.slides[i];
    if (s.page == null && s.items.some(it => it.type === 'image' || String(it.text || '').trim()) && !await MFDialog.confirm({title: L('Delete this slide?', 'Hapus slide ini?'),
      message: (s.items.find(it => it.type === 'text' && it.text) || {}).text || '', ok: L('Delete', 'Hapus'), cancel: L('Cancel', 'Batal'), danger: true})) return;
    work.slides.splice(i, 1); renderSlides(); changed();
  }
  function addSlide() { insertAfter(work.slides.length - 1); }
  // A slide of one's own (a title and points to fill in) after slide i (-1: the first).
  function insertAfter(i) {
    const near = work.slides[i] || work.slides[i + 1];
    const s = ownSlide('', [], false, near && near.bg && near.page == null ? near.bg : null);
    s.items[1].text = '';
    work.slides.splice(i + 1, 0, s);
    renderSlides(); changed();
    const li = document.querySelectorAll('#slides-list .slide-card')[i + 1];
    if (li) { li.scrollIntoView({behavior: 'smooth', block: 'center'}); const t = li.querySelector('.it-text'); if (t) t.focus({preventScroll: true}); }
  }
  // Every page of the PDF as a slide, in order.
  function pageSlides() {
    work.slides = Array.from({length: ctx.pages()}, (_, page) => ({page, bg: {color: '#FFFFFF'}, items: [], notes: '', ready: false}));
    renderSlides(); changed();
  }
  async function fromPages() {
    if (work.slides.length && !await MFDialog.confirm({title: L('Slides from the pages again?', 'Buat ulang slide dari halaman?'),
      message: L('The current slides (with your edits and your own slides) will be replaced by one slide per page.', 'Slide sekarang (termasuk editan dan slide buatan Anda) akan diganti dengan satu slide per halaman.'),
      ok: L('Replace', 'Ganti'), cancel: L('Cancel', 'Batal'), icon: '🖼'})) return;
    pageSlides();
  }
  async function aiSlides() {
    if (writing) return;
    const text = source('#slides-status'); if (!text) return;
    if (work.slides.length && !await MFDialog.confirm({title: L('Make the slides with AI?', 'Buat slide dengan AI?'), message: L('The current slides (with your edits) will be replaced.', 'Slide sekarang (termasuk editan Anda) akan diganti.'),
      ok: L('Make', 'Buat'), cancel: L('Cancel', 'Batal'), icon: '🖼'})) return;
    await busy(null, '#slides-status', L('Making the slides… usually 20-60 seconds.', 'Membuat slide… biasanya 20-60 detik.'), async () => {
      const r = await ctx.post('/api/write', {kind: 'slides', count: Number($('#slides-count').value) || 8, title: docTitle(), text, lang: ctx.lang(), work: context()});
      const when = new Date().toLocaleDateString(L('en-US', 'id-ID'), {day: 'numeric', month: 'long', year: 'numeric'});
      const bg = work.slides.find(s => s.page == null) ? work.slides.find(s => s.page == null).bg : null;
      work.slides = [ownSlide(sectionText('judul') || docTitle(), [when], true, bg),
        ...r.slides.map(s => ({...ownSlide(s.title, s.points || [], false, bg), notes: s.notes || ''}))];
      renderSlides(); changed();
    });
  }
  // Pages not split yet are split first (for the presentation and the files).
  async function prepareAll(slides, where) {
    const todo = slides.filter(s => s.page != null && !s.ready);
    for (const [k, s] of todo.entries()) { status(where, L(`Preparing page ${k + 1} / ${todo.length}…`, `Menyiapkan halaman ${k + 1} / ${todo.length}…`)); await split(s); }
    if (todo.length) changed();
  }
  // Full screen, one slide at a time: → / Space / click next, ← back, Esc out.
  async function present(from = 0) {
    const slides = work.slides.filter(shown);
    if (!slides.length) { status('#slides-status', L('Add a slide first.', 'Tambahkan slide dulu.'), true); return; }
    let i = Math.min(work.slides.slice(0, from).filter(shown).length, slides.length - 1);
    const show = el('div', 'show'); show.tabIndex = -1;
    const stage = el('div', 'show-stage'), bar = el('div', 'show-bar'), count = el('span', 'show-count');
    const draw = async () => {
      const s = slides[i], at = i;
      count.textContent = `${i + 1} / ${slides.length}`;
      if (s.page != null && !s.ready) { stage.replaceChildren(face(s, false)); try { await split(s); changed(); } catch (e) { return; } }
      if (at === i) stage.replaceChildren(face(s, false));
    };
    const go = n => { i = Math.max(0, Math.min(slides.length - 1, n)); draw(); };
    const close = () => { removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', out); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); show.remove(); };
    const key = e => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) go(i + 1);
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) go(i - 1);
      else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
      else if (e.key === 'Escape') close(); else return;
      e.preventDefault(); e.stopPropagation();
    };
    const out = () => { if (!document.fullscreenElement) close(); };
    const prev = button('‹', () => go(i - 1)), next = button('›', () => go(i + 1)), x = button(L('Close', 'Tutup'), close);
    prev.setAttribute('aria-label', L('Previous', 'Sebelumnya')); next.setAttribute('aria-label', L('Next', 'Berikutnya'));
    bar.append(prev, count, next, x);
    stage.onclick = () => go(i + 1);
    show.append(stage, bar); document.body.append(show); draw(); show.focus();
    addEventListener('keydown', key, true);
    if (show.requestFullscreen) show.requestFullscreen().then(() => document.addEventListener('fullscreenchange', out)).catch(() => {});
  }
  const fileName = () => {
    const first = work.slides.find(s => s.page == null && s.items.some(it => it.type === 'text' && it.text));
    return ((first && first.items.find(it => it.type === 'text' && it.text).text.split('\n')[0]) || docTitle()).slice(0, 100) + L(' - slides', ' - slide');
  };
  const hex6 = c => (hexOk(c) ? c : '#1C1917').slice(1).toUpperCase();
  async function savePptx() {
    const slides = work.slides.filter(shown);
    if (!slides.length) { status('#slides-status', L('Add a slide first.', 'Tambahkan slide dulu.'), true); return; }
    try {
      await prepareAll(slides, '#slides-status');
      status('#slides-status', L('Making the PowerPoint file…', 'Membuat file PowerPoint…'));
      await loadScript('assets/vendor/jszip.min.js', () => window.JSZip);           // PptxGenJS zips with it
      await loadScript(PPTX, () => typeof window.PptxGenJS === 'function');
      const pptx = new window.PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = fileName();
      const W = 13.333, H = 7.5;
      for (const sl of slides) {
        const s = pptx.addSlide();
        s.background = sl.bg && sl.bg.image ? {data: sl.bg.image} : {color: hex6((sl.bg || {}).color || '#FFFFFF')};
        for (const it of sl.items) {
          if (it.type === 'image') s.addImage({data: it.src, x: it.x * W, y: it.y * H, w: it.w * W, h: it.h * H});
          else if (String(it.text || '').trim()) s.addText(it.text, {x: it.x * W, y: it.y * H, w: it.w * W, h: Math.max(it.h, it.size * 1.3) * H, margin: 0, valign: 'top',
            fontSize: Math.max(6, Math.round(it.size * H * 72 * 10) / 10), color: hex6(it.color), bold: !!it.bold, italic: !!it.italic, align: it.align || 'left', fontFace: it.font || 'Arial'});
        }
        if (sl.notes) s.addNotes(sl.notes);
      }
      await pptx.writeFile({fileName: fileName().replace(/[\\/:*?"<>|]+/g, '-') + '.pptx'});
      status('#slides-status', '');
    } catch (e) { status('#slides-status', e.message, true); }
  }
  async function savePdf() {
    const slides = work.slides.filter(shown);
    if (!slides.length) { status('#slides-status', L('Add a slide first.', 'Tambahkan slide dulu.'), true); return; }
    try {
      await prepareAll(slides, '#slides-status');
      status('#slides-status', L('Making the PDF…', 'Membuat PDF…'));
      await loadScript('assets/vendor/pdf-lib.min.js', () => window.PDFLib);
      const {PDFDocument, StandardFonts, rgb} = PDFLib;
      const out = await PDFDocument.create(); out.setTitle(fileName());
      const fonts = {};
      const fontOf = async it => {
        const fam = /times|georgia|cambria|garamond/i.test(it.font || '') ? 'Times' : /courier/i.test(it.font || '') ? 'Courier' : 'Helvetica';
        const name = {Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
          Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique']}[fam][(it.bold ? 1 : 0) + (it.italic ? 2 : 0)];
        return fonts[name] || (fonts[name] = await out.embedFont(StandardFonts[name]));
      };
      const pics = new Map();
      const picOf = async src => {
        if (pics.has(src)) return pics.get(src);
        const bytes = Uint8Array.from(atob(src.split(',')[1]), ch => ch.charCodeAt(0));
        const img = /^data:image\/png/i.test(src) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        pics.set(src, img); return img;
      };
      const color = c => { const n = parseInt(hex6(c), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
      const safe = (f, s) => [...String(s)].map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
      const wrap = (f, s, size, w) => {
        const lines = [];
        for (const para of safe(f, s).split('\n')) {
          let line = '';
          for (const word of para.split(/ +/)) {
            const t = line ? line + ' ' + word : word;
            if (line && f.widthOfTextAtSize(t, size) > w) { lines.push(line); line = word; } else line = t;
          }
          lines.push(line);
        }
        return lines;
      };
      const PW = 960, PH = 540;
      for (const sl of slides) {
        const page = out.addPage([PW, PH]);
        page.drawRectangle({x: 0, y: 0, width: PW, height: PH, color: color((sl.bg || {}).color || '#FFFFFF')});
        if (sl.bg && sl.bg.image) {
          const img = await picOf(sl.bg.image), k = Math.max(PW / img.width, PH / img.height);
          page.drawImage(img, {x: (PW - img.width * k) / 2, y: (PH - img.height * k) / 2, width: img.width * k, height: img.height * k});
        }
        for (const it of sl.items) {
          if (it.type === 'image') { page.drawImage(await picOf(it.src), {x: it.x * PW, y: PH - (it.y + it.h) * PH, width: it.w * PW, height: it.h * PH}); continue; }
          if (!String(it.text || '').trim()) continue;
          const f = await fontOf(it), size = it.size * PH, w = it.w * PW;
          let y = PH - it.y * PH - size * 0.9;
          for (const t of wrap(f, it.text, size, w)) {
            const tw = f.widthOfTextAtSize(t, size), x = it.x * PW + (it.align === 'center' ? (w - tw) / 2 : it.align === 'right' ? w - tw : 0);
            if (t) page.drawText(t, {x, y, size, font: f, color: color(it.color)});
            y -= size * 1.2;
          }
        }
      }
      saveBlob(fileName() + '.pdf', new Blob([await out.save()], {type: 'application/pdf'}));
      status('#slides-status', '');
    } catch (e) { status('#slides-status', e.message, true); }
  }
  function wireSlides() {
    $('#slides-bar').prepend(aiButton(L('Make with AI', 'Buat dengan AI'), aiSlides));
    $('#slides-add').onclick = addSlide;
    $('#slides-pages').onclick = fromPages;
    $('#slides-play').onclick = () => present(0);
    $('#slides-pptx').onclick = savePptx;
    $('#slides-pdf').onclick = savePdf;
    // a picture chosen (not a text being typed in) goes with Delete
    addEventListener('keydown', e => {
      if (!sel || sel.it.type !== 'image' || !['Delete', 'Backspace'].includes(e.key) || e.target.closest('input,textarea,[contenteditable=true]')) return;
      e.preventDefault(); const s = sel.slide; s.items = s.items.filter(x => x !== sel.it); sel = null; redraw(s); changed();
    });
  }
  // A saved slide (any version) in the current form.
  function slideFrom(s) {
    if (!s || typeof s !== 'object') return null;
    const bg = {color: hexOk((s.bg || {}).color) ? s.bg.color : '#FFFFFF', ...(typeof (s.bg || {}).image === 'string' && /^data:image\//.test(s.bg.image) ? {image: s.bg.image} : {})};
    const notes = String(s.notes || '').slice(0, 3000);
    const page = Number.isInteger(s.page) && s.page >= 0 ? s.page : null;
    if (Array.isArray(s.items)) {
      const items = s.items.filter(it => it && (it.type === 'text' || (it.type === 'image' && /^data:image\//.test(String(it.src))))).slice(0, 300).map(it => ({
        id: String(it.id || id()), type: it.type, x: +it.x || 0, y: +it.y || 0, w: +it.w || 0.2, h: +it.h || 0.1, ...(it.art ? {art: true} : {}),
        ...(it.type === 'image' ? {src: it.src} : {text: String(it.text || '').slice(0, 5000), size: +it.size || 0.04, color: hexOk(it.color) ? it.color : '#1C1917',
          bold: !!it.bold, italic: !!it.italic, align: ['left', 'center', 'right'].includes(it.align) ? it.align : 'left', font: typeof it.font === 'string' ? it.font.slice(0, 60) : null})}));
      return {...(page != null ? {page} : {}), bg, items, notes, ready: page == null || !!s.ready};
    }
    if (s.kind === 'page' && page != null) return {page, bg, items: [], notes, ready: false};
    const out = ownSlide(String(s.title || '').slice(0, 300), (Array.isArray(s.points) ? s.points : []).map(String).slice(0, 20), !!s.cover, bg);
    out.notes = notes; return out;
  }
  // The text of the slides, for Ask the document.
  const slidesText = () => work.slides.filter(s => s.page == null).map((s, i) => `${i + 1}. ` + s.items.filter(it => it.type === 'text').map(it => it.text).join('\n')).join('\n');

  // ---- What Ask the document reads of the member's own work
  function context() {
    const parts = [];
    const notes = plain(blocksOf(work.notes)); if (notes) parts.push('CATATAN / RINGKASAN MANUAL PEMBACA:\n' + notes);
    const s = ctx && ctx.summary(); if (s && s.text) parts.push('RINGKASAN AI YANG SUDAH DIBUAT:\n' + s.text);
    const j = SECTIONS.map(([key, , id]) => { const t = plain(blocksOf(work.journal[key] || '')); return t ? `${id}:\n${t}` : ''; }).filter(Boolean).join('\n\n');
    if (j) parts.push('DRAF JURNAL PEMBACA:\n' + j);
    const own = slidesText(); if (own.trim()) parts.push('SLIDE PEMBACA:\n' + own);
    return parts.join('\n\n').slice(0, 20000);
  }
  const has = () => ({notes: blocksOf(work.notes).length > 0, journal: Object.values(work.journal).some(v => blocksOf(v).length), slides: work.slides.length > 0});
  function showAll() {
    $('#notes-out').innerHTML = clean(work.notes); renderJournal(); renderSlides();
    ['#notes-status', '#journal-status', '#slides-status'].forEach(id => status(id, ''));
  }

  window.NotebookWork = {
    init(c) {
      ctx = c;
      wireNotes(); wireJournal(); wireSlides(); showAll();
      const open = view => () => { window.viewer.show(view); document.querySelector('.viewer').scrollIntoView({behavior: 'smooth', block: 'start'}); };
      $('#notes-open').onclick = () => { open('notes')(); $('#notes-out').focus({preventScroll: true}); };
      if ($('#journal-open')) $('#journal-open').onclick = open('journal');
      // the first time: one slide per page of the PDF
      if ($('#slides-open')) $('#slides-open').onclick = () => { if (!work.slides.length && ctx.pages()) pageSlides(); open('slides')(); };
    },
    state: () => JSON.parse(JSON.stringify(work, (k, v) => k === 'splitting' ? undefined : v)),
    load(saved) {
      work = blank();
      if (saved && typeof saved === 'object') {
        work.notes = clean(saved.notes);
        for (const [key] of SECTIONS) if (typeof (saved.journal || {})[key] === 'string') work.journal[key] = clean(saved.journal[key]);
        work.slides = (Array.isArray(saved.slides) ? saved.slides : []).slice(0, 5000).map(slideFrom).filter(Boolean);
      }
      showAll();
      const h = has();
      // the journal draft and the slides wait for version 2 (owner, 2026-10-20): their buttons are out, so are their tabs
      for (const view of ['notes', 'journal', 'slides']) if (h[view] && (view === 'notes' || $(`#${view}-open`))) window.viewer.tab(view); else window.viewer.hide(view);
    },
    reset() { this.load(null); },
    context,
    lock(locked) {
      aiLocked = !!locked;
      document.querySelectorAll('.work-ai').forEach(b => { if (aiLocked) crown(b); });
    },
  };
})();

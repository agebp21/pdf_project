/* "Add source" dialog shared by every page that takes files (the same look
 * as the flipbook's): paste a link (PDF, web page, Google Drive), Upload file,
 * Google Drive (only the kinds of files the tool takes), or drop files.
 *
 *   AddSource.open({
 *     title: 'Merge PDF', subtitle: 'your PDFs',      // "Merge PDF from / your PDFs"
 *     accept: '.pdf',                                  // extensions (comma list), as an <input accept>
 *     multiple: true,
 *     link: true,                                      // the link box (needs the server's /api/fetch-source)
 *     onFiles: async files => { ... }                  // File[]; throw to show an error in the dialog
 *   });
 *
 * Google Drive picking uses assets/drive-picker.js (loaded when needed) and
 * the server's Drive settings (/api/capabilities → drive).
 */
(function (root) {
  'use strict';
  const L = (en, id) => (root.I18N && root.I18N.pick ? root.I18N.pick(en, id) : en);
  const CSS = `
.as-dialog{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(28,25,23,.45);backdrop-filter:blur(3px)}
.as-dialog[hidden]{display:none}
.as-card{position:relative;width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px 20px 16px;border-radius:22px;background:#fff;border:1.5px solid #1c1917;box-shadow:5px 5px 0 #1c1917;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1c1917;text-align:left}
.as-card h2{margin:0 0 14px;text-align:center;font:600 19px/1.3 'Plus Jakarta Sans',system-ui,sans-serif;color:#1c1917}
.as-card h2 span{background:linear-gradient(90deg,#ff5c28,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent}
.as-close{position:absolute;top:10px;right:12px;width:30px;height:30px;border:0;border-radius:999px;background:transparent;font-size:22px;line-height:1;color:#57534e;cursor:pointer}
.as-close:hover{background:#f5f0e6}
.as-link{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 14px;border-radius:16px;background:#f1efec;margin:0}
.as-link input{flex:1;min-width:0;border:0!important;background:transparent!important;border-radius:0!important;box-shadow:none!important;padding:7px 0!important;font-size:13.5px;outline:none;color:#1c1917}
.as-link button{width:32px;height:32px;flex:none;border:0;border-radius:999px;background:#fff;font-size:15px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15);color:#1c1917}
.as-link button:hover{background:#ff5c28;color:#fff}
.as-sources{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px}
.as-sources button{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid #ddd6ca;border-radius:999px;background:#fff;font:600 13px 'Plus Jakarta Sans',system-ui,sans-serif;color:#1c1917;cursor:pointer}
.as-sources button:hover{border-color:#1c1917;background:#fffaf2}
.as-drive{display:inline-block;width:14px;height:12px;background:conic-gradient(from 30deg,#0f9d58 0 120deg,#fbbc04 0 240deg,#4285f4 0);clip-path:polygon(50% 0,100% 85%,0 85%)}
.as-help{margin:12px 0 0;padding:10px 12px 10px 30px;border-radius:12px;background:#eef6ff;border:1px solid #cfe2fb;font-size:12.5px;line-height:1.55;color:#1c3a5e}
.as-help[hidden]{display:none}
.as-drop{margin-top:12px;padding:12px;border:2px dashed #d6cfbf;border-radius:14px;text-align:center;font-size:12px;color:#78716c}
.as-drop.is-over{border-color:#ff5c28;background:#fff4ec;color:#1c1917}
.as-status{min-height:1.2em;margin:8px 2px 0;font-size:12px;color:#1a3c34}
.as-status.is-error{color:#b3121a}
.as-dialog.is-busy .as-card{cursor:progress}
.as-dialog.is-busy .as-link button,.as-dialog.is-busy .as-sources button{opacity:.5;pointer-events:none}
@media (max-width:520px){.as-card{padding:20px 14px 14px}.as-card h2{font-size:17px}}`;
  // What Google Drive shows for each accepted extension (Google files come as PDF).
  const GOOGLE_AS_PDF = ['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.drawing'];
  const MIMES = {
    '.pdf': ['application/pdf'].concat(GOOGLE_AS_PDF),
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], '.doc': ['application/msword'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], '.ppt': ['application/vnd.ms-powerpoint'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], '.xls': ['application/vnd.ms-excel'], '.csv': ['text/csv'],
    '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.gif': ['image/gif'],
    '.bmp': ['image/bmp'], '.avif': ['image/avif'], '.svg': ['image/svg+xml'], '.tif': ['image/tiff'], '.tiff': ['image/tiff'],
    '.heic': ['image/heic'], '.heif': ['image/heif'], '.html': ['text/html'], '.htm': ['text/html'], '.md': ['text/markdown'], '.txt': ['text/plain'],
  };
  const KIND = {'.pdf': 'PDF', '.docx': 'Word', '.doc': 'Word', '.pptx': 'PowerPoint', '.ppt': 'PowerPoint', '.xlsx': 'Excel', '.xls': 'Excel',
    '.csv': 'CSV', '.jpg': 'JPG', '.jpeg': 'JPG', '.png': 'PNG', '.webp': 'WEBP', '.gif': 'GIF', '.html': 'HTML', '.htm': 'HTML'};
  const extensions = accept => String(accept || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s.startsWith('.'));
  const extOf = name => '.' + String(name || '').split('.').pop().toLowerCase();

  let dialog = null, options = null, caps = null, busy = false;
  const $ = sel => dialog.querySelector(sel);

  function capabilities() {
    if (!caps) caps = root.fetch('/api/capabilities', {cache: 'no-store'}).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    return caps;
  }
  function loadDrivePicker() {
    if (root.DrivePicker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'assets/drive-picker.js'; s.onload = resolve; s.onerror = () => reject(new Error('Google Drive could not be loaded.'));
      document.head.appendChild(s);
    });
  }
  function status(text, bad) {
    $('.as-status').textContent = text || '';
    $('.as-status').classList.toggle('is-error', !!bad);
  }
  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    dialog = document.createElement('div');
    dialog.className = 'as-dialog'; dialog.hidden = true;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'as-title');
    dialog.innerHTML = `<div class="as-card">
      <button type="button" class="as-close" aria-label="Close">×</button>
      <h2 id="as-title"></h2>
      <form class="as-link"><input type="url" inputmode="url" autocomplete="off" aria-label="Link"><button type="submit" aria-label="Add from link">→</button></form>
      <div class="as-sources">
        <button type="button" data-source="upload"><span aria-hidden="true">⤒</span> <span class="as-upload-label"></span></button>
        <button type="button" data-source="drive"><span class="as-drive" aria-hidden="true"></span> Google Drive</button>
      </div>
      <ol class="as-help" hidden></ol>
      <div class="as-drop"></div>
      <p class="as-status" role="status"></p>
      <input type="file" hidden>
    </div>`;
    document.body.appendChild(dialog);
    $('.as-close').onclick = close;
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && dialog && !dialog.hidden) close(); });
    $('[data-source="upload"]').onclick = () => $('input[type=file]').click();
    $('input[type=file]').onchange = e => { const files = [...e.target.files]; e.target.value = ''; deliver(files); };
    $('[data-source="drive"]').onclick = fromDrive;
    $('.as-link').onsubmit = e => { e.preventDefault(); fromLink(); };
    const drop = $('.as-drop');
    ['dragenter', 'dragover'].forEach(t => dialog.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => dialog.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === dialog) drop.classList.remove('is-over'); }));
    dialog.addEventListener('drop', e => deliver([...e.dataTransfer.files]));
  }
  function setBusy(on) { busy = on; dialog.classList.toggle('is-busy', on); }
  // Only the kinds of files the tool takes; then hand them over.
  async function deliver(files) {
    if (busy || !files.length) return;
    const allowed = extensions(options.accept);
    let list = allowed.length ? files.filter(f => allowed.includes(extOf(f.name))) : files;
    if (!list.length) {
      status(L(`${files[0].name}: this kind of file can't be used here (${options.accept}).`, `${files[0].name}: jenis file ini tidak bisa dipakai di sini (${options.accept}).`), true);
      return;
    }
    if (!options.multiple) list = list.slice(0, 1);
    setBusy(true); status('');
    try {
      await options.onFiles(list);
      setBusy(false);
      close();
    } catch (cause) { status(cause && cause.message ? cause.message : String(cause), true); }
    finally { setBusy(false); }
  }
  async function fromLink() {
    const url = $('.as-link input').value.trim();
    if (!url || busy) return;
    setBusy(true);
    try {
      const c = await capabilities();
      status(/google\.com/.test(url) ? L('Downloading from Google Drive…', 'Mengunduh dari Google Drive…') : L('Fetching the link…', 'Mengambil link…'));
      const r = await root.fetch('/api/fetch-source', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Build-Token': c.token || ''}, body: JSON.stringify({url})});
      if (!r.ok) { let m = L('The link could not be opened.', 'Link tidak bisa dibuka.'); try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
      const blob = await r.blob(), name = decodeURIComponent(r.headers.get('X-Filename') || 'document.pdf');
      setBusy(false);
      $('.as-link input').value = '';
      await deliver([new File([blob], name, {type: blob.type})]);
    } catch (cause) { status(cause.message, true); }
    finally { setBusy(false); }
  }
  async function fromDrive() {
    if (busy) return;
    const c = await capabilities();
    if (!c.drive) {
      // Drive picking not set up on this server: open Drive, share the file, paste its link.
      root.open('https://drive.google.com/drive/my-drive', '_blank', 'noopener');
      $('.as-link input').placeholder = L('Paste the Google Drive share link here', 'Tempel link share Google Drive di sini');
      $('.as-help').hidden = false;
      $('.as-link input').focus();
      return;
    }
    try {
      await loadDrivePicker();
      const mimeTypes = [].concat(...extensions(options.accept).map(ext => MIMES[ext] || []));
      const file = await root.DrivePicker.pick(c.drive, text => {
        if (/^Choose a file in Google Drive/.test(text)) { dialog.hidden = true; return; }     // the picker would be covered
        status(text);
      }, {mimeTypes: [...new Set(mimeTypes)]});
      dialog.hidden = false;
      if (file) await deliver([file]);
    } catch (cause) { dialog.hidden = false; status(cause.message, true); }
  }
  function open(opts) {
    if (!dialog) build();
    options = Object.assign({accept: '', multiple: false, link: true, title: L('Add files', 'Tambah file'), subtitle: ''}, opts || {});
    const kinds = [...new Set(extensions(options.accept).map(ext => KIND[ext]).filter(Boolean))];
    $('#as-title').innerHTML = '';
    $('#as-title').append(document.createTextNode(options.title + (options.subtitle ? ' ' + L('from', 'dari') : '')));
    if (options.subtitle) { $('#as-title').append(document.createElement('br')); const span = document.createElement('span'); span.textContent = options.subtitle; $('#as-title').append(span); }
    $('.as-link').hidden = !options.link;
    $('.as-link input').value = '';
    $('.as-link input').placeholder = L('Paste a link: PDF, web page or Google Drive', 'Tempel link: PDF, halaman web, atau Google Drive');
    $('.as-upload-label').textContent = options.multiple ? L('Upload files', 'Upload file') : L('Upload file', 'Upload file');
    $('.as-help').hidden = true;
    $('.as-help').innerHTML = L('<li>Google Drive opened in a new tab — find your file.</li><li>Click <b>Share</b> → General access: <b>Anyone with the link</b>.</li><li>Click <b>Copy link</b>, come back and paste it in the box above → press <b>→</b>.</li>',
      '<li>Google Drive terbuka di tab baru — cari file-mu.</li><li>Klik <b>Share</b> → Akses umum: <b>Siapa saja yang memiliki link</b>.</li><li>Klik <b>Salin link</b>, kembali ke sini dan tempel di kotak atas → tekan <b>→</b>.</li>');
    $('.as-drop').textContent = L('Drop files here', 'Seret file ke sini') + (kinds.length ? ' · ' + kinds.join(', ') : '');
    const input = $('input[type=file]');
    input.accept = options.accept || ''; input.multiple = !!options.multiple;
    status('');
    dialog.hidden = false;
    capabilities().then(c => { if (c.drive) loadDrivePicker().then(() => root.DrivePicker.preload && root.DrivePicker.preload()).catch(() => {}); });
    if (options.link) setTimeout(() => $('.as-link input').focus(), 0);
  }
  function close() { if (dialog && !busy) dialog.hidden = true; }

  root.AddSource = {open, close, extensions, MIMES};
})(typeof window !== 'undefined' ? window : globalThis);

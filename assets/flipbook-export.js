'use strict';
(() => {
  const positions = new Set(['top-left','top-right','bottom-left','bottom-right']);
  // Reader-facing instructions packed into every offline HTML book.
  const HOW_TO_OPEN = [
    'HOW TO OPEN THIS BOOK',
    '',
    '1. Extract the WHOLE ZIP into one folder (right-click > Extract All).',
    '2. Open index.html in any web browser.',
    '',
    'No internet connection or server is needed.',
    'Keep index.html together with the other files and the "pages" folder.',
    ''].join('\n');
  // Page links: fractions of the page box, a target page or a web/mail URL.
  function validLinks(links, pageCount) {
    const out = {};
    if (links === undefined) return out;
    if (!links || typeof links !== 'object' || Array.isArray(links)) throw Error('Data tautan tidak valid.');
    const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
    for (const [key, list] of Object.entries(links)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pageCount || !Array.isArray(list)) throw Error('Halaman tautan tidak valid.');
      out[key] = list.slice(0, 200).map(link => {
        if (!link || ![link.x, link.y, link.w, link.h].every(unit)) throw Error('Posisi tautan tidak valid.');
        const clean = {x:link.x, y:link.y, w:link.w, h:link.h};
        if (Number.isInteger(link.page) && link.page >= 0 && link.page < pageCount) clean.page = link.page;
        else if (typeof link.url === 'string' && /^(https?:\/\/|mailto:)/i.test(link.url) && link.url.length <= 500) clean.url = link.url;
        else throw Error('Tujuan tautan tidak valid.');
        return clean;
      });
    }
    return out;
  }
  // Word positions for highlights: per page, lines [y, h, x0, w0, x1, w1, ...]
  // as integers 0..10000 (see pdf-words.js).
  function validWords(words, pageCount) {
    const out = {};
    if (words === undefined) return out;
    if (!words || typeof words !== 'object' || Array.isArray(words)) throw Error('Data teks halaman tidak valid.');
    const unit = v => Number.isInteger(v) && v >= 0 && v <= 10000;
    for (const [key, lines] of Object.entries(words)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pageCount || !Array.isArray(lines)) throw Error('Halaman teks tidak valid.');
      out[key] = lines.slice(0, 400).map(line => {
        if (!Array.isArray(line) || line.length < 4 || line.length % 2 || line.length > 602 || !line.every(unit)) throw Error('Posisi teks tidak valid.');
        return line.slice();
      });
    }
    return out;
  }
  // Text of those lines (words joined by single spaces), same pages and
  // line count as words; highlighted text becomes a reader note.
  function validText(text, words) {
    const out = {};
    if (text === undefined) return out;
    if (!text || typeof text !== 'object' || Array.isArray(text)) throw Error('Data teks halaman tidak valid.');
    for (const [key, lines] of Object.entries(text)) {
      if (!words[key] || !Array.isArray(lines) || lines.length > words[key].length || !lines.every(line => typeof line === 'string')) throw Error('Isi teks halaman tidak valid.');
      out[key] = lines.map(line => line.slice(0, 4000));
    }
    return out;
  }
  // Podcast script: {lines: [{s: 'A'|'B', t}], hosts: [a, b], lang}.
  function validPodcast(podcast) {
    if (podcast === undefined || podcast === null) return null;
    if (typeof podcast !== 'object' || !Array.isArray(podcast.lines) || podcast.lines.length > 400) throw Error('Data podcast tidak valid.');
    const lines = podcast.lines.map(line => {
      if (!line || (line.s !== 'A' && line.s !== 'B') || typeof line.t !== 'string' || !line.t.trim()) throw Error('Baris podcast tidak valid.');
      return {s: line.s, t: line.t.trim().slice(0, 2000)};
    });
    if (!lines.length) return null;
    const hosts = Array.isArray(podcast.hosts) && podcast.hosts.length === 2 && podcast.hosts.every(h => typeof h === 'string' && h.trim())
      ? podcast.hosts.map(h => h.trim().slice(0, 30)) : ['Rina', 'Bima'];
    const lang = ['id-ID', 'ms-MY', 'en-US'].includes(podcast.lang) ? podcast.lang : 'id-ID';
    return {lines, hosts, lang};
  }
  // Translations: {lang: {page: text}} for id-ID / en-US / ms-MY.
  function validTranslations(translations, pageCount) {
    if (translations === undefined || translations === null) return null;
    if (typeof translations !== 'object' || Array.isArray(translations)) throw Error('Data terjemahan tidak valid.');
    const out = {};
    for (const [lang, pages] of Object.entries(translations)) {
      if (!['id-ID', 'en-US', 'ms-MY'].includes(lang) || !pages || typeof pages !== 'object' || Array.isArray(pages)) throw Error('Bahasa terjemahan tidak valid.');
      const clean = {};
      for (const [key, text] of Object.entries(pages)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pageCount || typeof text !== 'string') throw Error('Halaman terjemahan tidak valid.');
        if (text.trim()) clean[key] = text.slice(0, 20000);
      }
      if (Object.keys(clean).length) out[lang] = clean;
    }
    return Object.keys(out).length ? out : null;
  }
  function validate(data) {
    if (!data || data.version !== 1 || typeof data.title !== 'string' || !Number.isInteger(data.pageCount) || data.pageCount < 1 || !Number.isFinite(data.ratio) || data.ratio <= 0) throw Error('Format proyek tidak valid atau belum didukung.');
    if (!data.overlays || typeof data.overlays !== 'object' || Array.isArray(data.overlays)) throw Error('Data animasi tidak valid.');
    const overlays = {};
    for (const [key, config] of Object.entries(data.overlays)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= data.pageCount || !config || typeof config.label !== 'string' || !Number.isFinite(config.value) || config.value < 0 || config.value > 999999 || !positions.has(config.position)) throw Error('Data animasi atau nomor halaman tidak valid.');
      overlays[key] = {label:config.label.slice(0,40),value:config.value,position:config.position};
    }
    const words=validWords(data.words,data.pageCount);
    const podcast=validPodcast(data.podcast), translations=validTranslations(data.translations,data.pageCount);
    return {version:1,title:data.title.slice(0,200),pageCount:data.pageCount,ratio:data.ratio,overlays,links:validLinks(data.links,data.pageCount),words,text:validText(data.text,words),...(podcast?{podcast}:{}),...(translations?{translations}:{})};
  }
  const scriptData = data => 'window.FLIPBOOK_DATA = ' + JSON.stringify(validate(data)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029') + ';\n';
  async function asset(path) {
    const response = await fetch(path); if (!response.ok) throw Error('Aset ekspor tidak tersedia: '+path); return response.text();
  }
  // onProgress(message, fraction 0..1) — fraction is optional.
  async function packageBook(model, imageUrls, onProgress = () => {}) {
    const data = validate(model);
    if(imageUrls.length!==data.pageCount)throw Error('Jumlah gambar dan halaman tidak cocok.');
    const zip = new JSZip();
    for(const name of ['index.html','viewer.css','book-effects.css','layout.js','viewer.js'])zip.file(name,await asset('assets/export/'+name));
    zip.file('page-flip.browser.js',await asset('assets/vendor/page-flip.browser.js'));
    zip.file('ENGINE-SOURCE.md',await asset('assets/vendor/SOURCE.md'));
    zip.file('PAGEFLIP-LICENSE.txt',await asset('assets/vendor/PAGEFLIP-LICENSE.txt'));
    zip.file('book.json',JSON.stringify(data,null,2));zip.file('book-data.js',scriptData(data));
    zip.file('HOW-TO-OPEN.txt',HOW_TO_OPEN);
    for(let i=0;i<imageUrls.length;i++) {
      onProgress(`Mengemas halaman ${i+1} / ${imageUrls.length}…`, 0.6*i/imageUrls.length);
      const response=await fetch(imageUrls[i]);if(!response.ok)throw Error('Gambar halaman gagal dibaca.');
      zip.file(`pages/${i+1}.jpg`,await response.arrayBuffer());
    }
    return zip.generateAsync({type:'blob',compression:'STORE'},meta=>onProgress('Membuat ZIP…',0.6+0.4*meta.percent/100));
  }
  // The book as ONE html file (reader inlined, pages + data encrypted), for
  // HTML exports: nothing to unzip, one file to open.
  async function packageSingleHtml(model, imageUrls, onProgress = () => {}) {
    if (!globalThis.BookSeal) throw Error('Modul enkripsi buku tidak tersedia. Muat ulang halaman.');
    const data = validate(model);
    if (imageUrls.length !== data.pageCount) throw Error('Jumlah gambar dan halaman tidak cocok.');
    const names = ['index.html','viewer.css','book-effects.css','book-seal.js','layout.js','viewer.js'];
    const [template, viewerCss, effectsCss, seal, layout, viewer] = await Promise.all(names.map(name => asset('assets/export/' + name)));
    const engine = await asset('assets/vendor/page-flip.browser.js');
    const pages = [];
    for (let i = 0; i < imageUrls.length; i++) {
      onProgress(`Mengemas halaman ${i+1} / ${imageUrls.length}…`, 0.45 * i / imageUrls.length);
      const response = await fetch(imageUrls[i]); if (!response.ok) throw Error('Gambar halaman gagal dibaca.');
      pages.push(new Uint8Array(await response.arrayBuffer()));
    }
    const payload = await BookSeal.sealAsync(data, pages, fraction => onProgress('Mengenkripsi halaman…', 0.45 + 0.5 * fraction));
    onProgress('Menyusun file buku…', 0.97);
    const html = BookSeal.singleHtml(template, [viewerCss, effectsCss], [seal, 'BookSeal.open();', engine, layout, viewer], payload, data.title);
    return new Blob([html], {type: 'text/html;charset=utf-8'});
  }
  // A file name from the book title, as readable as the OS allows.
  const titleFile = title => String(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.-]+|[.-]+$/g, '').slice(0, 80) || 'flipbook';
  async function saveProject(model, sourcePdf, onProgress = () => {}) {
    const zip=new JSZip();zip.file('project.json',JSON.stringify(validate(model),null,2));zip.file('source.pdf',await sourcePdf.arrayBuffer());
    return zip.generateAsync({type:'blob',compression:'STORE'},meta=>onProgress('Menyusun proyek…',meta.percent/100));
  }
  async function readProject(file) {
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    if(!zip.file('project.json')||!zip.file('source.pdf'))throw Error('Pilih file proyek .smflipbook, bukan ZIP hasil HTML.');
    const data=validate(JSON.parse(await zip.file('project.json').async('string')));
    return {data,pdf:new Blob([await zip.file('source.pdf').async('arraybuffer')],{type:'application/pdf'})};
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function chooseSave(name) {
    if (typeof globalThis.showSaveFilePicker !== 'function') return null;
    const extension = '.' + name.split('.').pop();
    // Chrome rejects accept-extensions with characters like '-' (".sm-flipbook"
    // throws TypeError), so only send a type filter it will accept; the
    // suggested name still carries the full extension.
    const options = {id:'flipbook-export',suggestedName:name};
    if (/^\.[A-Za-z0-9+]{1,16}$/.test(extension)) options.types=[{description:'File flipbook',accept:{'application/octet-stream':[extension]}}];
    try {
      try { return await globalThis.showSaveFilePicker(options); }
      catch(cause) { if(cause.name!=='TypeError'||!options.types)throw cause; delete options.types; return await globalThis.showSaveFilePicker(options); }
    }
    catch(cause) {
      // Embedded/restricted browsers may expose the API but forbid using it.
      // Keep explicit user cancellation distinct from unavailable capability.
      if(cause.name==='SecurityError'||cause.name==='NotSupportedError')return null;
      throw cause;
    }
  }
  async function saveBlob(blob,name,handle) {
    if (!handle) { download(blob,name); return false; }
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch(cause) { await writable.abort().catch(()=>{}); throw cause; }
    return true;
  }
  // Writes a server file to a handle chosen earlier (in the click), with
  // progress; without a handle the browser downloads it instead.
  async function saveRemote(url,name,handle,onProgress = () => {}) {
    if (!handle) {
      const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();onProgress(1);return false;
    }
    const response=await fetch(url);if(!response.ok)throw Error('File hasil build tidak tersedia.');
    const total=Number(response.headers.get('Content-Length'))||0;
    const writable=await handle.createWritable();
    try {
      if(response.body) {
        const reader=response.body.getReader();let received=0;
        for(;;) {
          const {done,value}=await reader.read();if(done)break;
          await writable.write(value);received+=value.length;if(total)onProgress(received/total);
        }
      } else await writable.write(await response.blob());
      await writable.close();
    } catch(cause) { await writable.abort().catch(()=>{});throw cause; }
    onProgress(1);
    return true;
  }
  // POST with upload progress (fetch cannot report it).
  function upload(url,body,headers,onProgress = () => {}) {
    return new Promise((resolve,reject)=>{
      const request=new XMLHttpRequest();request.open('POST',url);
      for(const key of Object.keys(headers))request.setRequestHeader(key,headers[key]);
      request.upload.onprogress=event=>{if(event.lengthComputable)onProgress(event.loaded/event.total);};
      request.onload=()=>{let data={};try{data=JSON.parse(request.responseText||'{}');}catch(e){}resolve({ok:request.status>=200&&request.status<300,status:request.status,data});};
      request.onerror=()=>reject(Error('Upload ke layanan build gagal.'));
      request.send(body);
    });
  }
  const filename = title => (title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'flipbook');
  globalThis.FlipbookExport={validate,scriptData,packageBook,packageSingleHtml,titleFile,saveProject,readProject,download,filename,chooseSave,saveBlob,saveRemote,upload,HOW_TO_OPEN};
})();

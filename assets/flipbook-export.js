'use strict';
(() => {
  const positions = new Set(['top-left','top-right','bottom-left','bottom-right']);
  function validate(data) {
    if (!data || data.version !== 1 || typeof data.title !== 'string' || !Number.isInteger(data.pageCount) || data.pageCount < 1 || !Number.isFinite(data.ratio) || data.ratio <= 0) throw Error('Format proyek tidak valid atau belum didukung.');
    if (!data.overlays || typeof data.overlays !== 'object' || Array.isArray(data.overlays)) throw Error('Data animasi tidak valid.');
    const overlays = {};
    for (const [key, config] of Object.entries(data.overlays)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= data.pageCount || !config || typeof config.label !== 'string' || !Number.isFinite(config.value) || config.value < 0 || config.value > 999999 || !positions.has(config.position)) throw Error('Data animasi atau nomor halaman tidak valid.');
      overlays[key] = {label:config.label.slice(0,40),value:config.value,position:config.position};
    }
    return {version:1,title:data.title.slice(0,200),pageCount:data.pageCount,ratio:data.ratio,overlays};
  }
  const scriptData = data => 'window.FLIPBOOK_DATA = ' + JSON.stringify(validate(data)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029') + ';\n';
  async function asset(path) {
    const response = await fetch(path); if (!response.ok) throw Error('Aset ekspor tidak tersedia: '+path); return response.text();
  }
  async function packageBook(model, imageUrls, onProgress = () => {}) {
    const data = validate(model);
    if(imageUrls.length!==data.pageCount)throw Error('Jumlah gambar dan halaman tidak cocok.');
    const zip = new JSZip();
    for(const name of ['index.html','viewer.css','book-effects.css','layout.js','viewer.js'])zip.file(name,await asset('assets/export/'+name));
    zip.file('page-flip.browser.js',await asset('assets/vendor/page-flip.browser.js'));
    zip.file('ENGINE-SOURCE.md',await asset('assets/vendor/SOURCE.md'));
    zip.file('PAGEFLIP-LICENSE.txt',await asset('assets/vendor/PAGEFLIP-LICENSE.txt'));
    zip.file('book.json',JSON.stringify(data,null,2));zip.file('book-data.js',scriptData(data));
    zip.file('BUKA-BUKU.txt','Ekstrak SELURUH ZIP, lalu buka index.html di browser. Tidak perlu internet atau server. Jangan memindahkan index.html tanpa file lainnya. Animasi dan sampul sudah disertakan.\n');
    for(let i=0;i<imageUrls.length;i++) {
      onProgress(`Mengemas halaman ${i+1} / ${imageUrls.length}…`);
      const response=await fetch(imageUrls[i]);if(!response.ok)throw Error('Gambar halaman gagal dibaca.');
      zip.file(`pages/${i+1}.jpg`,await response.arrayBuffer());
    }
    return zip.generateAsync({type:'blob',compression:'STORE'},meta=>onProgress(`Membuat ZIP ${Math.round(meta.percent)}%…`));
  }
  async function saveProject(model, sourcePdf) {
    const zip=new JSZip();zip.file('project.json',JSON.stringify(validate(model),null,2));zip.file('source.pdf',await sourcePdf.arrayBuffer());
    return zip.generateAsync({type:'blob',compression:'STORE'});
  }
  async function readProject(file) {
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    if(!zip.file('project.json')||!zip.file('source.pdf'))throw Error('Pilih file proyek .flipbook, bukan ZIP hasil HTML.');
    const data=validate(JSON.parse(await zip.file('project.json').async('string')));
    return {data,pdf:new Blob([await zip.file('source.pdf').async('arraybuffer')],{type:'application/pdf'})};
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function chooseSave(name) {
    if (typeof globalThis.showSaveFilePicker !== 'function') return null;
    const extension = '.' + name.split('.').pop();
    return globalThis.showSaveFilePicker({id:'flipbook-export',suggestedName:name,types:[{description:'File flipbook',accept:{'application/octet-stream':[extension]}}]});
  }
  async function saveBlob(blob,name,handle) {
    if (!handle) { download(blob,name); return false; }
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch(cause) { await writable.abort().catch(()=>{}); throw cause; }
    return true;
  }
  async function saveRemote(url,name) {
    // Ask during the click gesture, before awaiting network or file processing.
    const handle = await chooseSave(name);
    if (!handle) {
      const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();return false;
    }
    const response=await fetch(url);if(!response.ok)throw Error('File hasil build tidak tersedia.');
    const writable=await handle.createWritable();
    try {
      if(response.body) await response.body.pipeTo(writable);
      else { await writable.write(await response.blob());await writable.close(); }
    } catch(cause) { await writable.abort().catch(()=>{});throw cause; }
    return true;
  }
  const filename = title => (title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'flipbook');
  globalThis.FlipbookExport={validate,scriptData,packageBook,saveProject,readProject,download,filename,chooseSave,saveBlob,saveRemote};
})();

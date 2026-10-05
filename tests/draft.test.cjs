// Draft autosave round-trip: save/load/clear, and silent nulls without IndexedDB.
const assert = require('node:assert/strict');
require('../assets/flipbook-export.js');
const api = global.FlipbookExport;
(async () => {
  assert.equal(await api.draftLoad(), null, 'no IndexedDB, no draft');
  assert.equal(await api.draftSave({ a: 1 }), null, 'no IndexedDB, silent');
  assert.equal(await api.draftClear(), null);
  // Tiny in-memory IndexedDB.
  const stored = {};
  const fakeDb = () => ({
    createObjectStore() {}, close() {},
    transaction() {
      const tx = { get error() { return null; }, objectStore() { return {
        put(value, key) { stored[key] = value; return {}; },
        get(key) { return { result: key in stored ? stored[key] : null }; },
        delete(key) { delete stored[key]; return {}; } }; } };
      Object.defineProperty(tx, 'oncomplete', { set(f) { setTimeout(f, 0); } });
      Object.defineProperty(tx, 'onerror', { set() {} });
      Object.defineProperty(tx, 'onabort', { set() {} });
      return tx;
    }
  });
  global.indexedDB = { open() {
    const req = { get result() { return fakeDb(); }, get error() { return null; } };
    Object.defineProperty(req, 'onupgradeneeded', { set(f) { f(); } });
    Object.defineProperty(req, 'onsuccess', { set(f) { setTimeout(f, 0); } });
    Object.defineProperty(req, 'onerror', { set() {} });
    return req;
  } };
  const doc = { blob: 'PDF-bytes', name: 'Laporan.pdf', title: 'Laporan', savedAt: 123 };
  assert.equal(await api.draftSave(doc), true, 'draft saved');
  assert.deepEqual(await api.draftLoad(), doc, 'draft round-trips');
  assert.equal(await api.draftClear(), true, 'draft cleared');
  assert.equal(await api.draftLoad(), null, 'nothing left after clear');
  console.log('PASS draft autosave: round-trip, clear, silent without IndexedDB');
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
window.FlipbookTransfer = {
  async database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('pdf-tools-flipbook', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Penyimpanan browser tidak tersedia'));
    });
  },
  async transaction(mode, operation) {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('pending', mode);
        const request = operation(tx.objectStore('pending'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(new Error('Penyimpanan dokumen gagal atau penuh'));
      });
    } finally { db.close(); }
  },
  // randomUUID exists only on HTTPS / localhost; a LAN address (http://192.168…) gets the same
  // form from getRandomValues, which every page has.
  newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;          // version 4, RFC 4122 variant
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },
  async save(blob, name) {
    const id = this.newId();
    await this.transaction('readwrite', store => store.put({blob, name}, id));
    return id;
  },
  get(id) { return this.transaction('readonly', store => store.get(id)); },
  remove(id) { return this.transaction('readwrite', store => store.delete(id)); }
};

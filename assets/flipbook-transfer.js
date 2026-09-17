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
  async save(blob, name) {
    const id = crypto.randomUUID();
    await this.transaction('readwrite', store => store.put({blob, name}, id));
    return id;
  },
  get(id) { return this.transaction('readonly', store => store.get(id)); },
  remove(id) { return this.transaction('readwrite', store => store.delete(id)); }
};

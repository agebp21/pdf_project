/* Local HTML samples: no account, upload or external document required. */
(() => {
  'use strict';
  const hero = document.querySelector('.hh');
  if (!hero) return;
  const en = () => window.I18N && I18N.get() === 'en';
  const samples = {
    interior: {title:['Ruang untuk hidup.','Room for living.'], topics:[['Ruang keluarga','Living room'],['Material alami','Natural materials'],['Kursi santai','Lounge chair'],['Meja serbaguna','Versatile table'],['Palet hangat','Warm palette'],['Pencahayaan','Lighting'],['Ukuran ruang','Room dimensions'],['Rancang ruang Anda','Plan your room']], intro:['Katalog konsep interior: kayu, tekstur, dan bentuk sederhana untuk ruang yang nyaman.','An interior concept catalog: wood, texture, and simple forms for comfortable spaces.']},
    fashion: {title:['Bentuk. Gaya. Cerita.','Form. Style. Story.'],topics:[['Koleksi harian','Everyday collection'],['Lapisan ringan','Light layers'],['Warna netral','Neutral colors'],['Detail jahitan','Stitch details'],['Padu padan','Mix and match'],['Bahan pilihan','Selected fabrics'],['Panduan ukuran','Size guide'],['Rawat koleksi Anda','Care for your collection']],intro:['Katalog konsep busana dengan potongan sederhana, warna tenang, dan pilihan gaya sehari-hari.','A fashion concept catalog with simple silhouettes, calm colors, and everyday styling ideas.']},
    travel: {title:['Jelajah Nusantara.','Explore Nusantara.'],topics:[['Awal perjalanan','Beginning the journey'],['Pesisir dan laut','Coast and sea'],['Jejak pegunungan','Mountain trails'],['Ruang budaya','Cultural spaces'],['Rasa setempat','Local flavors'],['Catatan perjalanan','Travel notes'],['Perjalanan bijak','Thoughtful travel'],['Cerita untuk dibawa pulang','Stories to take home']],intro:['Buku perjalanan contoh untuk menjelajahi bentang alam, budaya, dan cerita Nusantara.','A sample travel book exploring the landscapes, culture, and stories of the archipelago.']},
    magazine: {title:['Ruang. Cahaya. Cerita.','Space. Light. Story.'],topics:[['Rumah yang hidup','A living home'],['Ruang keluarga','Living spaces'],['Dapur dan detail','Kitchens and details'],['Bentuk arsitektur','Architectural forms'],['Material pilihan','Selected materials'],['Cahaya alami','Natural light'],['Ide renovasi','Renovation ideas'],['Cerita desain','Design stories']],intro:['Sampel majalah desain rumah dengan cerita ruang, arsitektur, dan inspirasi interior.','A home design magazine sample with stories on spaces, architecture, and interior inspiration.']},
    learning: {title:['Belajar dari ide.','Learning through ideas.'],topics:[['Tujuan belajar','Learning goals'],['Amati sekitar','Observe your surroundings'],['Susun pertanyaan','Ask questions'],['Eksperimen kecil','Small experiments'],['Catat temuan','Record findings'],['Diskusi bersama','Discuss together'],['Coba mandiri','Practice independently'],['Refleksi belajar','Learning reflection']],intro:['Modul contoh untuk mengembangkan ide: amati, coba, catat, lalu bagikan hasil belajar.','A sample module for developing ideas: observe, experiment, record, and share what you learn.']}
  };
  let selected = null;
  const closedCover = document.querySelector('#hh-book .hh-cover');
  const originalCover = closedCover ? closedCover.innerHTML : '';
  const demoCover = document.querySelector('#hh-demo-book .hh-page-cover .hh-cover');
  const originalDemoCover = demoCover ? demoCover.innerHTML : '';
  function render() {
    if (!selected) return;
    const sample = samples[selected], lang = en() ? 1 : 0;
    hero.dataset.sample = selected;
    if (demoCover) {
      if (selected === 'magazine') {
        demoCover.replaceChildren();
        const cover = document.createElement('img'); cover.src = 'assets/samples/grand-designs/page-01.webp'; cover.alt = 'Grand Designs Australia magazine cover';
        cover.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain'; demoCover.append(cover);
      } else if (demoCover.querySelector('img[alt="Grand Designs Australia magazine cover"]')) demoCover.innerHTML = originalDemoCover;
    }
    if (selected === 'interior') {
      if (closedCover) {
        closedCover.replaceChildren();
        const image = document.createElement('img'); image.src = 'assets/samples/sekar-bumi/page-01.webp'; image.alt = 'Sekar Bumi Product Catalog'; image.className = 'hh-catalog-cover'; closedCover.append(image);
      }
      document.querySelectorAll('.hh-sample').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sample === selected)));
      const note = document.getElementById('hh-sample-notice'); note.removeAttribute('data-en'); note.textContent = en() ? 'Sekar Bumi catalog · 19 pages' : 'Katalog Sekar Bumi · 19 halaman';
      return;
    }
    if (closedCover && closedCover.querySelector('.hh-catalog-cover,.hh-magazine-cover')) closedCover.innerHTML = originalCover;
    if (selected === 'magazine' && closedCover) {
      closedCover.replaceChildren();
      const image = document.createElement('img'); image.src = 'assets/samples/grand-designs/cover.webp'; image.alt = 'Grand Designs Australia magazine cover'; image.className = 'hh-magazine-cover'; closedCover.append(image);
    }
    hero.querySelectorAll('.hh-cover-title strong').forEach(node => { node.removeAttribute('data-en'); node.textContent = sample.title[lang]; });
    const pages = hero.querySelectorAll('#hh-demo-book .hh-in:not(.hh-back)');
    pages.forEach((page,index) => {
      const title = page.querySelector('strong'), body = page.querySelector('span');
      if (title) { title.removeAttribute('data-en'); title.textContent = sample.topics[index][lang]; }
      if (body) {
        body.removeAttribute('data-en'); body.classList.remove('hh-list');
        body.textContent = sample.intro[lang] + ' ' + (en() ? 'Explore this chapter page by page.' : 'Jelajahi bagian ini halaman demi halaman.');
      }
    });
    document.querySelectorAll('[data-sample].hh-sample').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sample === selected)));
    const notice = document.getElementById('hh-sample-notice'); notice.removeAttribute('data-en');
    notice.textContent = (en() ? 'Preview selected: ' : 'Contoh dipilih: ') + sample.title[lang];
  }
  document.querySelectorAll('.hh-sample[data-sample]').forEach(button => button.addEventListener('click', () => {
    selected = button.dataset.sample; render();
    document.dispatchEvent(new Event('hh-sample-selected'));
    // Existing reading tools refresh their text and language caches through this event.
    document.dispatchEvent(new Event('langchange'));
  }));
  document.addEventListener('langchange', render);
})();

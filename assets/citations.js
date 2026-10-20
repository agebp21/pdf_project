/* Citations for journal articles: APA 7 text, BibTeX, RIS (Mendeley / Zotero / EndNote) and CSV
 * (columns like Publish or Perish's), from the search results' fields:
 *   {title, authors: [display names], moreAuthors, year, journal, publisher, volume, issue, pages, doi, link, cited, kind}
 *
 *   Cite.apa(a) → text ·  Cite.bibtex(list) · Cite.ris(list) · Cite.csv(list) → file text
 *   Cite.save(name, text, type)   the text as a downloaded file
 */
(function (root) {
  'use strict';
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const doiOf = a => clean(a.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  // "Anne-Wil K. Harzing" → {family: 'Harzing', given: 'Anne-Wil K.'}; a single name stays whole.
  const PARTICLES = /^(van|von|de|der|den|del|della|di|da|dos|du|la|le|bin|binti|al|el)$/i;
  function split(name) {
    const parts = clean(name).split(' ').filter(Boolean);
    if (parts.length < 2) return { family: parts[0] || '', given: '' };
    let i = parts.length - 1;
    while (i > 1 && PARTICLES.test(parts[i - 1])) i--;
    return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
  }
  // Initials: "Anne-Wil K." → "A.-W. K."
  const initials = given => given.split(' ').filter(Boolean).map(g => g.split('-').map(p => p[0].toUpperCase() + '.').join('-')).join(' ');
  const pages = a => clean(a.pages).replace(/\s*[-–]+\s*/, '–');

  function apaAuthors(a) {
    const names = (a.authors || []).map(clean).filter(Boolean).map(n => { const s = split(n); return s.given ? `${s.family}, ${initials(s.given)}` : s.family; });
    if (!names.length) return '';
    if (a.moreAuthors) return names.join(', ') + ', et al.';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
  }
  function apa(a) {
    const who = apaAuthors(a), title = clean(a.title).replace(/\.$/, ''), doi = doiOf(a);
    const where = [clean(a.journal), clean(a.volume) + (clean(a.issue) ? `(${clean(a.issue)})` : ''), pages(a)].filter(Boolean).join(', ');
    const parts = [who ? `${who} (${a.year || 'n.d.'}).` : `${title}. (${a.year || 'n.d.'}).`];
    if (who) parts.push(`${title}.`);
    if (where) parts.push(`${where}.`);
    parts.push(doi ? `https://doi.org/${doi}` : clean(a.link));
    return parts.filter(Boolean).join(' ');
  }

  // BibTeX: keys like harzing2007sharing, made unique in the list.
  const tex = s => clean(s).replace(/[{}\\]/g, '').replace(/([&%$#_])/g, '\\$1');
  function bibtex(list) {
    const used = new Map();
    return list.map(a => {
      const first = split((a.authors || [])[0] || '').family || 'anon';
      const word = (clean(a.title).toLowerCase().match(/[a-z]{4,}/) || ['paper'])[0];
      let key = (first.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase() || 'anon') + (a.year || '') + word;
      const n = used.get(key) || 0; used.set(key, n + 1);
      if (n) key += String.fromCharCode(97 + n);        // second → …b
      const authors = (a.authors || []).map(n => { const s = split(n); return s.given ? `${tex(s.family)}, ${tex(s.given)}` : tex(s.family); });
      if (a.moreAuthors) authors.push('others');
      const fields = [['author', authors.join(' and ')], ['title', `{${tex(a.title)}}`], ['journal', tex(a.journal)], ['year', a.year || ''],
        ['volume', tex(a.volume)], ['number', tex(a.issue)], ['pages', pages(a).replace('–', '--')], ['publisher', tex(a.publisher)],
        ['doi', doiOf(a)], ['url', doiOf(a) ? '' : clean(a.link)]].filter(([, v]) => v !== '' && v != null);
      return `@article{${key},\n` + fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n') + '\n}';
    }).join('\n\n') + '\n';
  }

  function ris(list) {
    return list.map(a => {
      const [sp, ep] = pages(a).split('–');
      const lines = [['TY', 'JOUR'], ...(a.authors || []).map(n => { const s = split(n); return ['AU', s.given ? `${s.family}, ${s.given}` : s.family]; }),
        ['TI', clean(a.title)], ['T2', clean(a.journal)], ['PY', a.year || ''], ['VL', clean(a.volume)], ['IS', clean(a.issue)],
        ['SP', sp || ''], ['EP', ep || ''], ['PB', clean(a.publisher)], ['DO', doiOf(a)], ['UR', doiOf(a) ? `https://doi.org/${doiOf(a)}` : clean(a.link)]];
      return lines.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}  - ${v}`).join('\r\n') + '\r\nER  - ';
    }).join('\r\n\r\n') + '\r\n';
  }

  // CSV (Excel opens it): Publish or Perish's main columns.
  const cell = v => { const s = String(v == null ? '' : v); return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(list) {
    const head = ['Cites', 'Authors', 'Title', 'Year', 'Source', 'Publisher', 'Volume', 'Issue', 'Pages', 'DOI', 'ArticleURL', 'Type'];
    const rows = list.map(a => [a.cited || 0, (a.authors || []).join(', ') + (a.moreAuthors ? ` +${a.moreAuthors}` : ''), clean(a.title), a.year || '',
      clean(a.journal), clean(a.publisher), clean(a.volume), clean(a.issue), pages(a), doiOf(a), clean(a.link), a.kind || 'article']);
    return '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  function save(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  root.Cite = { apa, bibtex, ris, csv, save, split };
})(typeof self !== 'undefined' ? self : globalThis);

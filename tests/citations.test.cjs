// Citations: APA 7 text, BibTeX (unique keys, escaped), RIS and CSV from search results.
const assert = require('node:assert/strict');
global.self = global;
require('../assets/citations.js');
const C = global.Cite;

const a = { title: 'Sharing Detailed Research Data Is Associated with Increased Citation Rate', authors: ['Heather A. Piwowar', 'Roger S. Day', 'Douglas B. Fridsma'],
  moreAuthors: 0, year: 2007, journal: 'PLoS ONE', publisher: 'PLOS', volume: '2', issue: '3', pages: '308-308', doi: 'https://doi.org/10.1371/journal.pone.0000308', cited: 881 };
const b = { title: 'Gamelan & laras: 50% kajian_awal', authors: ['Sri Hastanto'], moreAuthors: 0, year: 2019, journal: 'Jurnal Seni', volume: '5', issue: '', pages: '10–25',
  doi: '', link: 'https://jurnal.example/article/1', cited: 3 };
const solo = { title: 'Pidato', authors: ['Sukarno'], year: 1945, journal: '', doi: '' , link: 'https://x.example'};
const many = { title: 'Big Team Science', authors: ['A One', 'B Two'], moreAuthors: 40, year: 2020, journal: 'Nature', doi: '10.1038/x1' };

// names
assert.deepEqual(C.split('Anne-Wil K. Harzing'), { family: 'Harzing', given: 'Anne-Wil K.' });
assert.deepEqual(C.split('Ludwig van Beethoven'), { family: 'van Beethoven', given: 'Ludwig' });
assert.deepEqual(C.split('Sukarno'), { family: 'Sukarno', given: '' });

// APA 7
assert.equal(C.apa(a), 'Piwowar, H. A., Day, R. S., & Fridsma, D. B. (2007). Sharing Detailed Research Data Is Associated with Increased Citation Rate. PLoS ONE, 2(3), 308. https://doi.org/10.1371/journal.pone.0000308'.replace(', 308.', ', 308–308.'));
assert.equal(C.apa(b), 'Hastanto, S. (2019). Gamelan & laras: 50% kajian_awal. Jurnal Seni, 5, 10–25. https://jurnal.example/article/1');
assert.equal(C.apa(solo), 'Sukarno (1945). Pidato. https://x.example');
assert.match(C.apa(many), /^One, A\., Two, B\., et al\. \(2020\)/);
assert.match(C.apa({ title: 'No Author', authors: [], year: null }), /^No Author\. \(n\.d\.\)\./);

// BibTeX
const bib = C.bibtex([a, b, { ...a, title: 'Sharing more data' }]);
assert.match(bib, /@article\{piwowar2007sharing,\n  author = \{Piwowar, Heather A\. and Day, Roger S\. and Fridsma, Douglas B\.\}/);
assert.match(bib, /@article\{piwowar2007sharingb,/, 'same key twice → b');
assert.match(bib, /title = \{\{Gamelan \\& laras: 50\\% kajian\\_awal\}\}/);
assert.match(bib, /pages = \{10--25\}/); assert.match(bib, /doi = \{10\.1371\/journal\.pone\.0000308\}/);
assert.match(bib, /url = \{https:\/\/jurnal\.example\/article\/1\}/);
assert.match(C.bibtex([many]), /author = \{One, A and Two, B and others\}/);

// RIS
const r = C.ris([a, b]);
assert.match(r, /^TY  - JOUR\r\nAU  - Piwowar, Heather A\.\r\nAU  - Day, Roger S\./);
assert.match(r, /SP  - 10\r\nEP  - 25/); assert.match(r, /DO  - 10\.1371\/journal\.pone\.0000308/);
assert.equal((r.match(/ER  - /g) || []).length, 2);

// CSV
const c = C.csv([a, b]).replace(/^﻿/, '').split('\r\n');
assert.equal(c[0], 'Cites,Authors,Title,Year,Source,Publisher,Volume,Issue,Pages,DOI,ArticleURL,Type');
assert.match(c[1], /^881,"Heather A\. Piwowar, Roger S\. Day, Douglas B\. Fridsma",Sharing Detailed/);
assert.match(c[2], /^3,Sri Hastanto,Gamelan & laras: 50% kajian_awal,2019,Jurnal Seni,,5,,10–25,,https:\/\/jurnal\.example\/article\/1,article$/);
console.log('PASS citations: APA 7, BibTeX (unique keys, escaping, et al.), RIS, CSV');

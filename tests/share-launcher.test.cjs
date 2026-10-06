// Drive launcher: tiny redirect file (upload to Drive, download +
// double-click lands straight in the share player).
const assert = require('node:assert/strict');
global.JSZip = require('../assets/vendor/jszip.min.js');
require('../assets/flipbook-export.js');
const api = global.FlipbookExport;
const url = 'https://myflipbookpro.com/s/abc123';
const page = api.shareLauncher('Laporan <Q3> & Co', url);
assert.ok(page.includes('<meta http-equiv="refresh" content="0;url=' + url + '">'), 'meta refresh carries the link');
assert.ok(page.includes('<a href="' + url + '">'), 'fallback link carries the link');
assert.ok(page.includes('location.replace('), 'script redirect present');
assert.ok(page.includes('Laporan &lt;Q3&gt; &amp; Co'), 'title HTML-escaped');
assert.ok(!page.includes('<Q3>'), 'no raw markup from the title');
assert.ok(page.trimEnd().endsWith('</html>'), 'complete document');
assert.throws(() => api.shareLauncher('x', 'javascript:alert(1)'), /tidak valid/, 'script URL refused');
assert.throws(() => api.shareLauncher('x', '/s/relative'), /tidak valid/, 'relative URL refused');
assert.throws(() => api.shareLauncher('x', 'ftp://host/f'), /tidak valid/, 'non-http refused');
assert.throws(() => api.shareLauncher('x', ''), /tidak valid/, 'empty refused');
// Windows shortcut: double-click always opens the browser, never Notepad.
const shortcut = api.shareShortcut(url);
assert.ok(shortcut.startsWith('[InternetShortcut]'), 'shortcut header');
assert.ok(shortcut.includes('URL=' + url), 'shortcut carries the link');
assert.throws(() => api.shareShortcut('javascript:alert(1)'), /tidak valid/, 'script URL refused');
assert.throws(() => api.shareShortcut(''), /tidak valid/, 'empty refused');
console.log('PASS drive launcher + windows shortcut: redirect + fallback + escaping + URL gate');

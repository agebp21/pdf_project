const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
(async () => {
  const html = await fs.readFile('index.html', 'utf8');
  assert.equal((html.match(/<div class="hh-page(?: |")/g) || []).length, 10, 'Ten pages including both covers');
  assert.equal((html.match(/class="hh-cover-brand"><img src="assets\/img\/logo.png" alt="MyFlipbook Pro"/g) || []).length, 2, 'Official wordmark replaces upper brand text on both covers');
  assert.equal((html.match(/class="hh-cover-mark"><img src="assets\/img\/logo-icon.png" alt=""/g) || []).length, 2, 'Lower badge keeps original book icon');
  const { chromium } = await import(process.env.MF_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MF_PLAYWRIGHT_MODULE).href : 'playwright');
  const browser = await chromium.launch({ headless: true });
  const base = process.env.MF_PREVIEW_URL || 'http://127.0.0.1:8098/';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'QA is local only');
  try {
    for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844], ['desktop-motion', 1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: name === 'desktop-motion' ? 'no-preference' : 'reduce' });
      const errors = [], failedAssets = [];
      await page.route('**/assets/vendor/page-flip.browser.js*', async route => {
        const response = await route.fetch();
        const code = await response.text();
        await route.fulfill({ response, body: code + '\n;{const Original=St.PageFlip;St.PageFlip=class extends Original{constructor(el,settings){super(el,settings);window.__qaFlipDuration=settings.flippingTime;}};}' });
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400 && /home-hero|page-flip|export\/layout|img\/logo\.png/.test(response.url())) failedAssets.push(response.url()); });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => I18N.set('id'));
      const badge = page.locator('#hh-book .hh-cover-brand img');
      await badge.waitFor();
      assert(await badge.evaluate(img => img.complete && img.naturalWidth > 0), 'Logo loads');
      assert(await badge.evaluate(img => {
        const r = img.getBoundingClientRect(), b = img.parentElement.getBoundingClientRect();
        return r.width > r.height * 3 && r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
      }), 'Full logo fits badge without distortion');
      await fs.mkdir('.build/qa-home-hero', { recursive: true });
      await page.locator('#hh-book').screenshot({ path: `.build/qa-home-hero/${name}-sample.png` });
      await page.locator('#hh-book').click();
      await page.waitForFunction(() => document.querySelector('.hh').classList.contains('is-shown') && /\/ 10$/.test(document.getElementById('hh-demo-status').textContent));
      assert.equal(await page.evaluate(() => window.__qaFlipDuration), name === 'desktop-motion' ? 320 : 1, 'Preview speed and reduced motion');
      await page.waitForTimeout(300);
      if (await page.locator('#hh-demo-prev').isEnabled()) {
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => document.getElementById('hh-demo-status').textContent === 'Sampul · 1 / 10');
      }
      const visited = [];
      for (let turn = 0; turn < 12; turn++) {
        const before = await page.locator('#hh-demo-status').textContent();
        visited.push(before);
        if (await page.locator('#hh-demo-next').isDisabled()) break;
        await page.locator('#hh-tool-open').click();
        await page.waitForFunction(previous => document.getElementById('hh-demo-status').textContent !== previous, before);
      }
      assert.equal(await page.locator('#hh-demo-status').textContent(), 'Sampul belakang · 10 / 10');
      await page.locator('#hh-demo').screenshot({ path: `.build/qa-home-hero/${name}-back.png` });
      await page.evaluate(() => I18N.set('en'));
      assert.equal(await page.locator('#hh-demo-status').textContent(), 'Back cover · 10 / 10');
      assert.equal(await page.locator('#hh-demo-book .hh-page').count(), 10);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => !document.getElementById('hh-demo-status').textContent.startsWith('Back cover'));
      await page.locator('#hh-demo-close').click();
      await page.waitForFunction(() => document.getElementById('hh-demo').hidden);
      await page.locator('#hh-book').click();
      await page.waitForFunction(() => document.querySelector('.hh').classList.contains('is-shown'));
      assert.equal(await page.locator('#hh-demo-book .hh-page').count(), 10, 'Reopening does not duplicate pages');
      assert.deepEqual(failedAssets, []);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport: name, pages: 10, visited, branding: true, bilingual: true, backTurn: true, reopen: true }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

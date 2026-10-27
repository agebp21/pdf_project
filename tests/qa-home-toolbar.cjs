const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
  const { chromium } = await import(process.env.MF_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MF_PLAYWRIGHT_MODULE).href : 'playwright');
  const browser = await chromium.launch({headless: true});
  try {
    for (const [name, width, height] of [['desktop',1280,900], ['mobile',390,844]]) {
      const page = await browser.newPage({viewport: {width,height}, reducedMotion: 'reduce'});
      const errors = [], ai = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', req => { if (/\/api\/(?:ai|translate)/.test(req.url())) ai.push(req.url()); });
      // Exercise audio queue/UI deterministically, without claiming physical speaker playback.
      await page.route('**/assets/export/layout.js*', async route => {
        const response = await route.fetch();
        await route.fulfill({response, body: await response.text() + '\n;window.__qaSpoken=[];FlipbookSpeech.engine=function(){return{stop:function(){},has:function(){return true;},speak:function(t,lang,done){window.__qaSpoken.push({text:t,lang:lang});}};};'});
      });
      const base = process.env.MF_PREVIEW_URL || 'http://127.0.0.1:8098/';
      assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'QA is local only');
      await page.goto(base, {waitUntil:'domcontentloaded'});
      await page.evaluate(() => I18N.set('id'));
      assert.equal(await page.locator('#hh-demo-toolbar').isVisible(), false);
      await page.locator('#hh-book').click();
      await page.waitForFunction(() => document.querySelector('.hh').classList.contains('is-shown'));
      await page.waitForTimeout(300);
      await page.locator('#hh-tool-home').click();
      await page.waitForFunction(() => document.getElementById('hh-demo-status').textContent.startsWith('Sampul ·'));
      assert.equal(await page.locator('#hh-demo-toolbar button').count(),12);
      assert.equal(await page.locator('#hh-tool-pen').evaluate(el=>el.nextElementSibling.id),'hh-demo-full','Fullscreen immediately follows the highlighter');
      assert.equal(await page.locator('#hh-demo-prev').isVisible(),false);
      assert.equal(await page.locator('#hh-demo-next').isVisible(),false);
      assert(await page.locator('#hh-demo-toolbar button').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().height <= 24)), 'Compact demo buttons are at most 24px tall');
      assert(await page.locator('#hh-demo-toolbar').evaluate(el => {
        const r=el.getBoundingClientRect(),stage=document.querySelector('.hh-demo-stage').getBoundingClientRect();
        return r.width<=stage.width+1 && r.width>stage.width*.85 && r.height<55 && r.top>=stage.bottom-1;
      }), 'Small toolbar directly below book');
      assert(await page.locator('#hh-demo-toolbar').evaluate(el => {
        const buttons=el.querySelectorAll('button'), first=buttons[0].getBoundingClientRect(), last=buttons[buttons.length-1].getBoundingClientRect(), box=el.getBoundingClientRect();
        return el.scrollWidth>el.clientWidth ? first.left>=box.left : Math.abs((first.left+last.right)/2-(box.left+box.right)/2)<2;
      }), 'Toolbar buttons centered when they fit; overflowing mobile buttons remain reachable');
      await page.locator('#hh-tool-mark').click();
      await page.waitForFunction(() => document.getElementById('hh-tool-marks').textContent.includes('1'));
      await page.locator('#hh-tool-marks').click();
      assert(await page.locator('.book-marks').isVisible());
      await page.locator('#hh-tool-marks').click();
      await page.locator('#hh-demo-book .hh-page').nth(0).locator('.book-note-add').click();
      await page.locator('.book-note-editor textarea').fill('Catatan demo aman');
      await page.locator('.book-note-done').click();
      await page.locator('#hh-tool-notes').click();
      assert((await page.locator('.book-note-list').textContent()).includes('Catatan demo aman'));
      await page.locator('#hh-tool-notes').click();
      await page.locator('#hh-tool-zoom').click();
      await page.waitForFunction(() => document.querySelector('.hh-demo-zoom').style.transform.includes('scale(2'));
      await page.locator('#hh-tool-zoom').click();
      await page.waitForTimeout(300);
      await page.locator('#hh-tool-pen').click();
      await page.waitForFunction(() => document.body.classList.contains('is-highlighting'));
      const cover = page.locator('#hh-demo-book .hh-page').nth(0);
      await cover.scrollIntoViewIfNeeded();
      const rect = await cover.boundingBox();
      await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.68);
      await page.mouse.down();
      await page.mouse.move(rect.x+rect.width*.55,rect.y+rect.height*.74,{steps:5});
      await page.mouse.up();
      assert(await cover.locator('.book-hl').count()>0,'Highlight draws on HTML demo');
      await page.locator('#hh-tool-pen').click();
      await page.locator('#hh-tool-audio').click();
      await page.waitForFunction(() => window.__qaSpoken.length>0);
      assert.equal(await page.evaluate(() => window.__qaSpoken[0].lang),'id');
      await page.locator('#hh-tool-audio').click();
      await page.locator('#hh-tool-translate').click();
      assert.equal(await page.evaluate(() => I18N.get()),'en');
      assert((await cover.textContent()).includes('From PDF'));
      await page.locator('#hh-demo-full').click();
      await page.waitForFunction(() => document.fullscreenElement?.id==='hh-demo');
      await page.locator('#hh-tool-marks').click();
      assert(await page.locator('#hh-demo > .book-marks').isVisible(),'Bookmarks visible inside fullscreen');
      await page.locator('#hh-tool-marks').click();
      await page.locator('#hh-demo-full').click();
      await page.waitForFunction(() => !document.fullscreenElement);
      const muted = await page.locator('#hh-demo-sound').getAttribute('aria-pressed');
      await page.locator('#hh-demo-sound').click();
      assert.notEqual(await page.locator('#hh-demo-sound').getAttribute('aria-pressed'),muted);
      await page.locator('#hh-tool-end').click();
      await page.waitForFunction(() => document.getElementById('hh-demo-status').textContent==='Back cover · 10 / 10');
      await page.locator('#hh-tool-home').click();
      await page.locator('#hh-tool-open').click();
      await page.waitForFunction(() => !document.getElementById('hh-demo-status').textContent.startsWith('Cover'));
      await page.locator('#hh-demo').screenshot({path:`.build/qa-home-hero/${name}-toolbar.png`});
      await page.locator('#hh-demo-close').click();
      await page.waitForFunction(() => document.getElementById('hh-demo').hidden);
      assert.equal(await page.evaluate(() => document.body.classList.contains('is-reading') || document.body.classList.contains('is-highlighting')),false);
      assert.deepEqual(errors,[]); assert.deepEqual(ai,[]);
      console.log(`PASS ${name}: toolbar bounds/scroll, home/end/open, bookmarks, notes, zoom, highlight, mocked audio queue, ID/EN translation without AI, fullscreen panels, sound, cleanup`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// Run with Playwright and its WebKit browser installed: node tests/file-import.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { webkit, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://reader.test';
const storageKey = 'japanese-reader-text-favorites';
const single = { v: 1, title: '試読', text: '青い花。', ruby: [[0,1,'あお'],[2,3,'はな']] };
const localEdit = '青い花を読む。';
const newer = { title: single.title, text: '赤い花と船。', ruby: [[0,1,'あか'],[2,3,'はな'],[4,5,'ふね']] };
const date = '2025-12-10T12:00:00.000Z';
const snapshot = item => ({v:1,kind:'jr-library',items:[item],words:[],deleted:[],deletedWords:[]});

(async () => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext(devices['iPhone 13']);
    const page = await context.newPage();
    const contentRequests = [];
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') {
        const name = url.pathname.slice(1) || 'index.html';
        if (!/^[\w-]+\.(html|js|css)$/.test(name)) return route.abort();
        return route.fulfill({path:path.join(root,name)});
      }
      if (url.pathname === '/api/status' && request.method() === 'GET' && !url.search &&
          !request.postData()) return route.fulfill({json:{online:true}});
      contentRequests.push([url.pathname,request.method()]);
      return route.abort();
    });
    await page.goto(origin);
    async function drawer() {
      if (!(await page.locator('#importReviewedButton').isVisible())) await page.locator('#favoritesButton').click();
    }
    async function file(data) {
      await drawer();
      const waiting = page.waitForEvent('filechooser');
      await page.getByRole('button',{name:'从文件导入收藏夹或讲稿'}).click();
      await (await waiting).setFiles({
        name:'sample.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data)),
      });
    }
    const favorites = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    async function expectReading(record) {
      await page.waitForFunction(text => document.querySelector('#sourceText').value === text, record.text);
      await page.waitForFunction(count => document.querySelectorAll('#reader rt').length === count, record.ruby.length);
      const displayed = await page.locator('#reader ruby').evaluateAll(nodes =>
        nodes.map(r => [r.querySelector('rb').textContent,r.querySelector('rt').textContent]));
      assert.deepEqual(displayed, record.ruby.map(([start,end,kana])=>[record.text.slice(start,end),kana]));
    }

    // Reproduce a single-text import saved on the phone after the source Mac's edits.
    await file(single);
    await expectReading(single);
    const legacy = (await favorites())[0];
    const revision = { ...newer, id:legacy.key, savedAt:date, updatedAt:date };
    const update = snapshot(revision);
    await file(update);
    await expectReading(newer);
    assert.deepEqual((await favorites()).map(f=>[f.id,f.driveMirrored]),[[legacy.key,true]]);
    await file(update);
    await expectReading(newer);
    assert.equal((await favorites()).length,1);
    await page.reload();
    await drawer();
    await page.getByRole('button',{name:'载入'}).click();
    await expectReading(newer);

    // Simulate a locally edited, pre-mirror favorite still carrying the original stable ID.
    const changed = {...legacy, id:legacy.key, text:localEdit, parentUpdatedAt:date};
    changed.key = await page.evaluate(text => getTextFavoriteKey(text),localEdit);
    await page.evaluate(([key,entry])=>localStorage.setItem(key,JSON.stringify([entry])),[storageKey,changed]);
    await page.reload();
    await file(update);
    await expectReading(newer);
    assert.match(await page.locator('#cloudLibraryStatus').textContent(), /本机改过的稿件已另外保留/);
    const after = await favorites();
    assert.equal(after.length,2);
    assert.equal(after.find(f=>f.id===legacy.key).text,newer.text);
    assert.deepEqual(after.find(f=>f.text===localEdit).reviewedRuby,single.ruby);

    const malformed = snapshot({...revision,ruby:[[0,999,'あか']]});
    await file(malformed);
    await page.locator('#cloudLibraryStatus').filter({hasText:/注音的位置或读音有误/}).waitFor();
    assert.deepEqual(await favorites(),after);
    assert.deepEqual(errors,[]);
    assert.deepEqual(contentRequests,[]);
    console.log('Passed iPhone WebKit file chooser: single item, stable-ID migration, ruby, duplicate import, reload, retained local edits and invalid library.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

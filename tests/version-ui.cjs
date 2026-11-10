'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const current = require('../package.json').version;
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); }
catch { playwright = require('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright'); }
(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const localContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const localPage = await localContext.newPage();
    await localPage.goto(pathToFileURL(path.join(root, 'index.html')).href);
    assert.match(await localPage.locator('.local-label').innerText(), /本地预览/);
    assert.equal(await localPage.locator('#app-version').innerText(), `v${current}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version, current);
    await localContext.close();
    console.log('PASS local-preview label and unchanged release metadata');
    for (const width of [320, 375, 390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      let remote = current;
      await page.route('https://badminton.test/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
        if (name === 'version.json') {
          if (remote === 'offline') return route.abort();
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: remote }) });
        }
        if (!['index.html', 'styles.css', 'engine.js', 'app.js'].includes(name)) return route.fulfill({ status: 404, body: '' });
        await route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, name), 'utf8') });
      });
      await page.goto('https://badminton.test/');
      await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('最新'));
      assert.equal(await page.locator('#app-version').innerText(), `v${current}`);
      assert.ok(await page.locator('#app-version').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      remote = 'offline';
      await page.locator('#check-update').click();
      await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('无法检查'));
      assert.equal(await page.locator('#apply-update').isVisible(), false);
      assert.ok(!(await page.locator('#update-status').innerText()).includes('最新'));
      remote = '0.0.0';
      await page.locator('#check-update').click();
      await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('尚未同步'));
      assert.equal(await page.locator('#apply-update').isVisible(), false);
      const parts = current.split('.').map(Number); parts[2]++;
      remote = parts.join('.');
      await page.locator('#check-update').click();
      await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('发现新版本'));
      if (!await page.locator('#relay-source').evaluate(el => el.open)) await page.locator('#relay-source > summary').click();
      await page.locator('#raw').fill('用于验证版本刷新保留的草稿');
      await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
      await page.locator('#apply-update').click();
      assert.equal(new URL(page.url()).search, '');
      assert.match(await page.locator('#notice-text').innerText(), /先导出备份/);
      await page.locator('#notice-dismiss').click();
      await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
      await page.locator('#apply-update').click();
      await page.waitForURL(`**/?v=${remote}`);
      if (!await page.locator('#relay-source').evaluate(el => el.open)) await page.locator('#relay-source > summary').click();
      assert.equal(await page.locator('#raw').inputValue(), '用于验证版本刷新保留的草稿');
      await context.close();
      console.log(`PASS ${width}px: version, offline/older/new update, save protection, draft-preserving refresh`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

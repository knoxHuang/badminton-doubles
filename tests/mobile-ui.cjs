/* Run separately: node tests/mobile-ui.cjs. Uses a disposable browser context. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE_PATH) return require(process.env.PLAYWRIGHT_MODULE_PATH);
  try { return require('playwright'); }
  catch { return require('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright'); }
}

async function main() {
  const { chromium } = loadPlaywright();
  const baseURL = process.env.UI_TEST_BASE_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const results = [];
  async function settle(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function tapOnce(page, selector, forceCenter = false) {
    const target = page.locator(selector).first();
    let box = await target.boundingBox();
    assert.ok(box, `Target is not visible: ${selector}`);
    const height = page.viewportSize().height;
    if (forceCenter || box.y < 0 || box.y + box.height > height - 90) {
      await target.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await settle(page);
      box = await target.boundingBox();
    }
    assert.ok(box && box.y >= 0 && box.y + box.height <= height, `Target is outside viewport: ${selector}`);
    // A single physical tap: retrying locator.click() could hide a swallowed first tap.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page);
  }
  async function fixture(width) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(baseURL);
    await page.waitForFunction(() => !!globalThis.Doubles && !!document.getElementById('mobile-primary'));
    await page.evaluate(() => {
      const E = globalThis.Doubles, state = E.emptyState();
      state.raw = E.SAMPLE;
      state.parsedRaw = state.raw;
      state.people = E.parseRelay(state.raw).people;
      state.schedule = E.generate(state.people, state.settings);
      // This key belongs only to this fresh, non-persistent test context.
      localStorage.setItem('doubles-club-v1', JSON.stringify(state));
    });
    await page.reload();
    return { context, page };
  }
  async function check(width, name, run) {
    let context;
    try {
      const f = await fixture(width); context = f.context;
      await run(f.page);
      results.push({ width, name, passed: true });
      console.log(`PASS ${width}px ${name}`);
    } catch (error) {
      results.push({ width, name, passed: false, message: error.message });
      console.error(`FAIL ${width}px ${name}: ${error.message}`);
    } finally { if (context) await context.close(); }
  }
  async function triggerError(page) {
    await page.locator('#courts').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.locator('#courts').fill('0');
    await page.locator('#courts').blur();
    await settle(page);
    assert.ok(await page.locator('#notice').isVisible(), 'Invalid court count should show a notice');
  }
  try {
    for (const width of [320, 390, 430, 1280]) {
      await check(width, 'phone layout stays single-column at every viewport', async page => {
        const layout = await page.evaluate(() => ({
          width: document.body.getBoundingClientRect().width,
          workspace: getComputedStyle(document.querySelector('.workspace')).display,
          tabs: getComputedStyle(document.querySelector('.view-tabs')).display,
          setup: getComputedStyle(document.querySelector('.setup')).display,
          results: getComputedStyle(document.querySelector('.results')).display,
          action: document.querySelector('.mobile-action').getBoundingClientRect().toJSON(),
          body: document.body.getBoundingClientRect().toJSON(),
        }));
        assert.ok(layout.width <= 480, JSON.stringify(layout));
        assert.equal(layout.workspace, 'block');
        assert.equal(layout.tabs, 'grid');
        assert.notEqual(layout.setup, 'none');
        assert.equal(layout.results, 'none');
        assert.ok(Math.abs(layout.action.x - layout.body.x) < 1);
        assert.ok(Math.abs(layout.action.width - layout.body.width) < 1);
        await tapOnce(page, '#tab-results');
        assert.equal(await page.locator('.setup').isVisible(), false);
        assert.equal(await page.locator('.results').isVisible(), true);
      });
      await check(width, 'rename preserves first participation tap', async page => {
        await page.locator('#roster input[type=text]').first().fill('改名后的球友');
        await tapOnce(page, '#roster input[type=checkbox]', true);
        assert.equal(await page.locator('#roster input[type=checkbox]').first().isChecked(), false,
          'First participation tap after renaming was swallowed');
      });
      await check(width, 'rename preserves keyboard focus navigation', async page => {
        await page.locator('#roster input[type=text]').first().fill('键盘改名');
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, type: document.activeElement.type }));
        assert.equal(focus.tag, 'INPUT', `Focus lost to ${focus.tag}`);
        assert.equal(focus.type, 'checkbox', 'Tab should reach the participation checkbox');
      });
      await check(width, 'error notice does not intercept tabs', async page => {
        await triggerError(page);
        const hit = await page.locator('#tab-results').evaluate(el => {
          const r = el.getBoundingClientRect(), target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { id: target?.id, ownsHit: target === el || el.contains(target) };
        });
        assert.ok(hit.ownsHit, `Tab center is intercepted by ${hit.id}`);
      });
      await check(width, 'error notice can be dismissed', async page => {
        await triggerError(page);
        assert.equal(await page.locator('#notice-dismiss').count(), 1, 'Notice has no dismiss control');
        await tapOnce(page, '#notice-dismiss');
        assert.equal(await page.locator('#notice').isVisible(), false);
      });
      await check(width, 'tabs restore independent scroll positions', async page => {
        await page.evaluate(() => scrollTo(0, 1100)); await settle(page);
        const setupY = await page.evaluate(() => scrollY);
        await tapOnce(page, '#tab-results');
        const firstTop = await page.locator('.results').evaluate(el => el.getBoundingClientRect().top);
        assert.ok(firstTop >= 0 && firstTop < 160, `First results view starts at y=${firstTop}`);
        await page.evaluate(() => scrollTo(0, 1000)); await settle(page);
        const resultsY = await page.evaluate(() => scrollY);
        await tapOnce(page, '#tab-setup');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - setupY) <= 3, 'Setup scroll position was not restored');
        await tapOnce(page, '#tab-results');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - resultsY) <= 3, 'Results scroll position was not restored');
      });
      await check(width, 'small buttons have at least 44px touch targets', async page => {
        const small = await page.evaluate(() => [...document.querySelectorAll('#sample,#add,#roster .remove,#undo,#export,#import,#clear')].map(el => {
          const r = el.getBoundingClientRect(); return { name: el.id || el.getAttribute('aria-label'), width: r.width, height: r.height };
        }).filter(r => r.width < 43.9 || r.height < 43.9));
        assert.deepEqual(small, [], `Small targets: ${JSON.stringify(small)}`);
      });
      await check(width, 'pinch zoom does not hide the primary action', async page => {
        const cdp = await page.context().newCDPSession(page);
        try {
          await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
          await settle(page);
          const state = await page.evaluate(() => ({ scale: visualViewport.scale, keyboard: document.body.classList.contains('keyboard-open'), display: getComputedStyle(document.querySelector('.mobile-action')).display }));
          assert.equal(state.scale, 2);
          assert.equal(state.keyboard, false, 'Pinch zoom was mistaken for a keyboard');
          assert.notEqual(state.display, 'none', 'Primary action disappeared during zoom');
        } finally { await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }
      });
      await check(width, 'relay controls keep a 12px vertical gap', async page => {
        const gap = await page.evaluate(() => document.querySelector('#parse').getBoundingClientRect().top - document.querySelector('#raw').getBoundingClientRect().bottom);
        assert.ok(gap >= 11.9, `Relay action gap is only ${gap}px`);
      });
      await check(width, 'time and round mode occupy a readable full row', async page => {
        await page.locator('#time').fill('周二 19:00–21:00');
        await page.locator('#time').blur();
        const sizing = await page.evaluate(() => {
          const grid = document.querySelector('.fields').getBoundingClientRect().width;
          return ['time', 'roundMode'].map(id => ({ id, width: document.getElementById(id).getBoundingClientRect().width, grid }));
        });
        assert.ok(sizing.every(s => Math.abs(s.width - s.grid) < 2), JSON.stringify(sizing));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      });
      await check(width, 'single-match rounds retain all four corners', async page => {
        await page.locator('#courts').fill('1'); await page.locator('#courts').blur();
        await tapOnce(page, '#mobile-primary');
        const corners = await page.locator('.match').first().evaluate(el => {
          const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius];
        });
        assert.deepEqual(corners, ['8px', '8px', '8px', '8px']);
      });
    }
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.passed);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }));
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

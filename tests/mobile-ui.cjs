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
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(baseURL);
    await page.waitForFunction(() => !!globalThis.Doubles && !!document.getElementById('mobile-primary'));
    await page.evaluate(() => {
      const E = globalThis.Doubles, state = E.emptyState();
      state.settings.courts = 2;
      state.raw = E.SAMPLE;
      state.parsedRaw = state.raw;
      state.people = E.parseRelay(state.raw).people;
      state.schedule = E.generate(state.people, state.settings);
      // This key belongs only to this fresh, non-persistent test context.
      localStorage.setItem('doubles-club-v1', JSON.stringify(state));
    });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('tab-results').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#view-round').inputValue(), 'all', 'Restored schedule must display all rounds');
    assert.equal(await page.locator('#schedule .round.current').getAttribute('data-round'), '0');
    assert.equal(await page.locator('#schedule .round:visible').count(), 12);
    await tapOnce(page, '#tab-setup');
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
  async function openDetails(page, selector) {
    const details = page.locator(selector);
    const parents = await details.evaluate(el => { const ids = []; for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && p.id) ids.unshift(p.id); return ids; });
    for (const id of parents) {
      const parent = page.locator(`#${id}`);
      if (!await parent.evaluate(el => el.open)) await parent.locator(':scope > summary').click();
    }
    if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
  }
  async function assertScope(page, expected) {
    await openDetails(page, '#share-preview');
    assert.equal(await page.locator('#scope').inputValue(), expected);
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
        await openDetails(page, '#roster-editor');
        await page.locator('#roster input[type=text]').first().fill('改名后的球友');
        await tapOnce(page, '#roster input[type=checkbox]', true);
        assert.equal(await page.locator('#roster input[type=checkbox]').first().isChecked(), false,
          'First participation tap after renaming was swallowed');
      });
      await check(width, 'rename preserves keyboard focus navigation', async page => {
        await openDetails(page, '#roster-editor');
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
        const firstTop = await page.locator('.round.current').evaluate(el => el.getBoundingClientRect().top);
        assert.ok(firstTop >= 0 && firstTop < page.viewportSize().height / 2,
          `Current round must remain visible near the top: y=${firstTop}`);
        await page.locator('#view-round').selectOption('all');
        await page.evaluate(() => scrollTo(0, 1000)); await settle(page);
        const resultsY = await page.evaluate(() => scrollY);
        await tapOnce(page, '#tab-setup');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - setupY) <= 3, 'Setup scroll position was not restored');
        await tapOnce(page, '#tab-results');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - resultsY) <= 3, 'Results scroll position was not restored');
      });
      await check(width, 'small buttons have at least 44px touch targets', async page => {
        await openDetails(page, '#roster-editor');
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
        await openDetails(page, '#relay-source');
        const gap = await page.evaluate(() => document.querySelector('#parse').getBoundingClientRect().top - document.querySelector('#raw').getBoundingClientRect().bottom);
        assert.ok(gap >= 11.9, `Relay action gap is only ${gap}px`);
      });
      await check(width, 'time and round mode occupy a readable full row', async page => {
        await openDetails(page, '#advanced-settings');
        await page.locator('#time').fill('周二 19:00–21:00');
        await page.locator('#time').blur();
        const sizing = await page.evaluate(() => {
          return ['time', 'roundMode'].map(id => { const el = document.getElementById(id); return { id, width: el.getBoundingClientRect().width, grid: el.closest('.fields').getBoundingClientRect().width }; });
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
      await check(width, 'advanced settings are collapsed but every field remains usable', async page => {
        assert.equal(await page.locator('#advanced-settings').evaluate(el => el.open), false);
        assert.equal(await page.locator('#time').isVisible(), false);
        assert.equal(await page.locator('#courts').isVisible(), true);
        assert.equal(await page.locator('#durationMinutes').isVisible(), true);
        await openDetails(page, '#advanced-settings');
        for (const id of ['title', 'date', 'time', 'location', 'roundMode', 'matchMinutes', 'rounds', 'notes']) {
          assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} must be available after expanding`);
        }
        await page.locator('#title').fill('手机测试活动'); await page.locator('#title').blur();
        await page.locator('#date').fill('2026-11-10'); await page.locator('#date').blur();
        await page.locator('#location').fill('测试球馆'); await page.locator('#location').blur();
        await page.locator('#notes').fill('到时间停止'); await page.locator('#notes').blur();
        await tapOnce(page, '#tab-results');
        assert.equal(await page.locator('#share-preview').evaluate(el => el.open), false);
        assert.equal(await page.locator('#output').isVisible(), false);
        await openDetails(page, '#share-preview');
        const text = await page.locator('#output').inputValue();
        for (const value of ['手机测试活动', '2026-11-10', '测试球馆', '到时间停止']) assert.ok(text.includes(value), value);
      });
      await check(width, 'round navigation focuses a round without hiding matches or changing copy scope', async page => {
        await tapOnce(page, '#tab-results');
        assert.equal(await page.locator('#view-round').inputValue(), 'all');
        await assertScope(page, 'all');
        await page.locator('#scope').selectOption('3');
        await tapOnce(page, '#round-next');
        assert.equal(await page.locator('#schedule .round:visible').count(), 12); await assertScope(page, '3');
        await tapOnce(page, '#round-prev');
        assert.equal(await page.locator('#schedule .round:visible').count(), 12); await assertScope(page, '3');
        await page.locator('#view-round').selectOption('5');
        await settle(page);
        assert.equal(await page.locator('#view-round').inputValue(), 'all');
        assert.equal(await page.locator('#schedule .round:visible').count(), 12); await assertScope(page, '3');
        await tapOnce(page, '#round-current');
        const top = await page.locator('#schedule .round.current').evaluate(el => el.getBoundingClientRect().top);
        assert.ok(top >= 0 && top < page.viewportSize().height / 2, `Current round is not in view: ${top}`);
        assert.equal(await page.locator('#schedule .round.current').getAttribute('data-round'), '0');
      });
      await check(width, 'match cards expose a heading and two distinct teams', async page => {
        await tapOnce(page, '#tab-results');
        const cards = page.locator('#schedule .round.current .match');
        assert.equal(await cards.count(), 2);
        for (const card of await cards.all()) {
          assert.equal(await card.locator('.match-heading').count(), 1);
          assert.equal(await card.locator('.match-teams').count(), 1);
          assert.equal(await card.locator('.team-a').count(), 1);
          assert.equal(await card.locator('.team-b').count(), 1);
          assert.ok((await card.locator('.team-a').innerText()).trim());
          assert.ok((await card.locator('.team-b').innerText()).trim());
        }
      });
      await check(width, 'player search filters presentation without changing participation or matches', async page => {
        await openDetails(page, '#roster-editor');
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('doubles-club-v1')));
        await page.locator('#player-search').fill('Knox');
        assert.equal(await page.locator('#roster .person:visible').count(), 1);
        assert.equal(await page.locator('#people-count').innerText(), '8');
        await page.locator('#player-search').fill('no-matching-player');
        assert.equal(await page.locator('#roster .person:visible').count(), 0);
        await page.locator('#player-search').fill('');
        assert.equal(await page.locator('#roster .person:visible').count(), 8);
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('doubles-club-v1')));
        assert.deepEqual(after.people, before.people); assert.deepEqual(after.schedule, before.schedule);
      });
      await check(width, 'fixed primary completes the current round while the secondary shares', async page => {
        await tapOnce(page, '#tab-results');
        assert.equal(await page.locator('#mobile-complete').isVisible(), true);
        assert.match(await page.locator('#mobile-complete').innerText(), /分享|复制链接/);
        assert.match(await page.locator('#mobile-primary').innerText(), /完成.*1|1.*完成/);
        await tapOnce(page, '#round-next');
        assert.equal(await page.locator('#schedule .round:visible').count(), 12);
        await page.evaluate(() => scrollBy(0, 120)); await settle(page);
        await tapOnce(page, '#mobile-primary');
        const visible = await page.locator('.round.current').evaluate(el => {
          const r = el.getBoundingClientRect(), nav = document.querySelector('.view-tabs').getBoundingClientRect(), bar = document.querySelector('.mobile-action').getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, center: (r.top + r.bottom) / 2, target: (nav.height + bar.top) / 2, nav: nav.height, bar: bar.top };
        });
        assert.ok(visible.top > visible.nav + 24 && visible.bottom < visible.bar, JSON.stringify(visible));
        assert.ok(Math.abs(visible.center - visible.target) < 85, 'Current round should be comfortably centered');
        assert.match(await page.locator('.round.current .round-status').innerText(), /当前比赛.*进行中/);
        const distinction = await page.evaluate(() => {
          const current = document.querySelector('.round.current'), next = current.nextElementSibling;
          return { current: getComputedStyle(current).backgroundColor, next: getComputedStyle(next).backgroundColor, border: parseFloat(getComputedStyle(current).borderTopWidth) };
        });
        assert.notEqual(distinction.current, distinction.next);
        assert.ok(distinction.border >= 2);
        assert.equal(await page.locator('#view-round').inputValue(), 'all'); await assertScope(page, 'all');
        assert.equal(await page.locator('#schedule .round.current').getAttribute('data-round'), '1');
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('doubles-club-v1')));
        assert.equal(state.completed, 1);
        assert.equal(await page.locator('#schedule .round:visible').count(), state.schedule.length);
      });
      await check(width, 'partner coverage is complete and readable', async page => {
        await tapOnce(page, '#tab-results');
        await tapOnce(page, '.stats summary', true);
        assert.match(await page.locator('#quality').innerText(), /28\/28/);
        const rows = await page.locator('#stats-list .stat-row').allTextContents();
        assert.equal(rows.length, 8);
        assert.ok(rows.every(text => /搭档 7\/7/.test(text)));
        assert.ok(await page.locator('#stats-list').evaluate(el => el.scrollWidth <= el.getBoundingClientRect().width + 1));
      });
    }
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.passed);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }));
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

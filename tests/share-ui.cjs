'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let pw;
try { pw = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); }
catch { pw = require('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright'); }
const root = path.join(__dirname, '..');
async function pageIn(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('https://badminton.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!['index.html', 'app.js', 'engine.js', 'styles.css', 'version.json'].includes(name)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html', body: fs.readFileSync(path.join(root, name), 'utf8') });
  });
  const page = await context.newPage();
  return { context, page };
}
(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const owner = await pageIn(browser);
    await owner.page.goto('https://badminton.test/');
    await owner.page.locator('#sample').click(); await owner.page.locator('#parse').click(); await owner.page.locator('#mobile-primary').click();
    await owner.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.sharedLink = text; } } }));
    await owner.page.locator('#share-schedule').click();
    await owner.page.waitForFunction(() => !!window.sharedLink);
    const link = await owner.page.evaluate(() => window.sharedLink);
    assert.ok(link.includes('#share='));
    const expected = await owner.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('doubles-club-v1')); return Doubles.groupText(s.people, s.settings, s.schedule); });
    const receiver = await pageIn(browser), privateDraft = JSON.stringify({ privateDraft: '仅接收者本机拥有' });
    await receiver.context.addInitScript(value => localStorage.setItem('doubles-club-v1', value), privateDraft);
    await receiver.page.goto(link);
    await receiver.page.locator('#view-round').selectOption('all');
    assert.equal(await receiver.page.locator('#output').inputValue(), expected);
    for (const selector of ['#tab-setup', '#mobile-complete', '#append-rounds', '#import', '#clear']) assert.equal(await receiver.page.locator(selector).isVisible(), false, selector);
    assert.equal(await receiver.page.locator('.round-head button').count(), 0);
    await receiver.page.locator('#round-next').click();
    assert.equal(await receiver.page.locator('#view-round').inputValue(), 'all');
    assert.equal(await receiver.page.evaluate(() => localStorage.getItem('doubles-club-v1')), privateDraft);
    await owner.page.locator('#mobile-primary').click();
    await receiver.page.reload();
    assert.match(await receiver.page.locator('#schedule-meta').innerText(), /0 \/ 14/);
    assert.equal(await receiver.page.evaluate(() => localStorage.getItem('doubles-club-v1')), privateDraft);
    await receiver.page.goto('https://badminton.test/#share=broken');
    assert.match(await receiver.page.locator('#shared-description').innerText(), /分享链接无效/);
    assert.equal(await receiver.page.evaluate(() => localStorage.getItem('doubles-club-v1')), privateDraft);
    assert.equal(await receiver.page.locator('#mobile-primary').isDisabled(), true);
    await receiver.page.locator('#leave-shared').click();
    await receiver.page.waitForFunction(() => !document.body.classList.contains('shared-view'));
    assert.equal(await receiver.page.evaluate(() => localStorage.getItem('doubles-club-v1')), privateDraft);
    await owner.context.close(); await receiver.context.close();
    console.log('PASS: separate-device snapshot equality, readonly controls, navigation, local draft preservation, immutable snapshot and invalid links');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

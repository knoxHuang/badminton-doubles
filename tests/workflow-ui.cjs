// Run with `node tests/workflow-ui.cjs`; uses an existing Playwright installation.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function loadPlaywright() {
  const configured = process.env.PLAYWRIGHT_MODULE_PATH;
  if (configured) return require(configured);
  try {
    return require('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright');
  } catch {
    return require('playwright');
  }
}

const appUrl = process.env.WORKFLOW_UI_URL || pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const executablePath = process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const readState = page => page.evaluate(() => JSON.parse(localStorage.getItem('doubles-club-v1')));

async function sample(page) {
  await page.locator('#sample').click();
  await page.locator('#parse').click();
}

async function change(page, selector, value) {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).blur();
}

async function testConflict(page) {
  await sample(page);
  await page.locator('#mobile-primary').click();
  await page.locator('#tab-setup').click();
  await change(page, '#durationMinutes', 180);
  assert.equal(await page.locator('#generate').isDisabled(), true,
    '180 minutes must not generate a schedule for the unchanged 19:00–21:00 range');
  assert.equal(await page.locator('#copy').isDisabled(), true, 'conflicting duration must block copying');
  assert.equal(await page.locator('#append-rounds').isDisabled(), true, 'conflicting duration must block appending');
  assert.equal(await page.locator('.round-head button').isDisabled(), true, 'conflicting duration must block completion');
  assert.match(await page.locator('#time-status').innerText(), /超过|冲突|大于|不一致/);
  assert.equal(await page.locator('#time-status').isVisible(), true);

  await change(page, '#time', '19:00–22:00');
  assert.equal(await page.locator('#durationMinutes').inputValue(), '180', 'editing the time range must synchronize duration');
  assert.equal(await page.locator('#generate').isDisabled(), false, 'a consistent time range must unblock generating');
}

async function testShorterPlayingTime(page) {
  await sample(page);
  await change(page, '#durationMinutes', 90);
  assert.equal(await page.locator('#generate').isDisabled(), false, 'a shorter playing duration is allowed');
  await page.locator('#mobile-primary').click();
  const text = await page.locator('#output').inputValue();
  assert.match(text, /19:00–21:00/, 'the activity window must stay visible');
  assert.match(text, /90\s*分钟/, 'the group notice must explicitly identify the shorter playing duration');
  assert.equal((await readState(page)).schedule.length, 10, '90 minutes / 15 + four reserve rounds');
}

async function testMissingTimeSource(page) {
  await sample(page);
  await page.locator('#raw').fill('#接龙\n1. A\n2. B\n3. C\n4. D');
  await page.locator('#parse').click();
  assert.equal(await page.locator('#time').inputValue(), '周二 19:00–21:00');
  assert.match(await page.locator('#time-status').innerText(), /本次未识别到时间/);
  assert.match(await page.locator('#time-status').innerText(), /沿用/);
  assert.doesNotMatch(await page.locator('#parse-details').innerText(), /识别出的时间/);
  const backup = await page.evaluate(() => localStorage.getItem('doubles-club-v1'));

  await page.reload();
  assert.match(await page.locator('#time-status').innerText(), /本次未识别到时间/, 'refresh must preserve time-source warning');
  await change(page, '#durationMinutes', 90);
  assert.doesNotMatch(await page.locator('#time-status').innerText(), /本次未识别到时间/, 'manual duration edit confirms the retained setting');

  await page.locator('#file').setInputFiles({ name: 'time-source-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.waitForFunction(() => /本次未识别到时间/.test(document.getElementById('time-status').textContent));
  assert.match(await page.locator('#time-status').innerText(), /本次未识别到时间/, 'import must restore time-source warning');
  await change(page, '#time', '19:00–21:00');
  assert.doesNotMatch(await page.locator('#time-status').innerText(), /本次未识别到时间/, 'manual time edit confirms the retained setting');
}

async function testSingleRoundProgress(page) {
  await sample(page);
  await page.locator('#roundMode').selectOption('manual');
  await change(page, '#rounds', 2);
  await page.locator('#mobile-primary').click();
  const original = (await readState(page)).schedule;
  await page.locator('#view-round').selectOption('0');
  await page.locator('.round-head button').click();
  assert.equal(await page.locator('#view-round').inputValue(), '1', 'completion must advance to the next single round');
  assert.equal(await page.locator('#scope').inputValue(), '1', 'copy scope must advance with the visible round');
  assert.equal(await page.locator('#schedule .round:visible').getAttribute('data-round'), '1');
  await page.locator('.round-head button').click();
  const completedNotice = await page.locator('#notice').innerText();
  assert.match(completedNotice, /全部|所有/);
  assert.match(completedNotice, /完成/);
  assert.equal((await readState(page)).completed, 2);
  assert.equal(await page.locator('#append-rounds').isDisabled(), false);
  await page.locator('#append-rounds').click();
  const extended = (await readState(page)).schedule;
  assert.equal(extended.length, 6);
  assert.deepEqual(extended.slice(0, 2), original, 'append must preserve the finished matches');
}

async function testSingleRoundAutoAppend(page) {
  await sample(page);
  await page.locator('#mobile-primary').click();
  const original = (await readState(page)).schedule;
  await page.locator('#view-round').selectOption('0');
  for (let completed = 1; completed <= 10; completed++) {
    await page.locator('.round-head button').click();
    assert.equal(await page.locator('#view-round').inputValue(), String(completed));
    assert.equal(await page.locator('#scope').inputValue(), String(completed));
  }
  const state = await readState(page);
  assert.equal(state.completed, 10);
  assert.equal(state.schedule.length, 16);
  assert.deepEqual(state.schedule.slice(0, 12), original, 'automatic append must preserve the planned matches');
}
async function testPartnerRotationAndUpgrade(page) {
  await sample(page);
  await page.locator('#mobile-primary').click();
  await page.locator('.stats summary').click();
  assert.match(await page.locator('#quality').innerText(), /28\/28/);
  const firstCycle = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('doubles-club-v1'));
    return Doubles.partnerCoverage(state.people, state.schedule.slice(0, 7));
  });
  assert.equal(firstCycle.completePlayers, 8);
  assert.ok(firstCycle.byPlayer.every(p => p.covered === 7));
  for (let i = 0; i < 3; i++) await page.locator('.round-head button').click();
  const locked = (await readState(page)).schedule.slice(0, 3);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('doubles-club-v1'));
    delete state.pairingVersion;
    localStorage.setItem('doubles-club-v1', JSON.stringify(state));
  });
  await page.reload();
  assert.equal(await page.locator('#copy').isDisabled(), true);
  assert.match(await page.locator('#notice-text').innerText(), /轮转规则已更新/);
  await page.locator('#mobile-primary').click();
  assert.deepEqual((await readState(page)).schedule.slice(0, 3), locked);
  assert.equal((await readState(page)).stale, false);
}
async function testSingleCourtFullCoverage(page) {
  await sample(page);
  await change(page, '#courts', 1);
  assert.equal(await page.locator('#rounds').inputValue(), '14');
  await page.locator('#mobile-primary').click();
  assert.equal((await readState(page)).schedule.length, 14);
  await page.locator('.stats summary').click();
  assert.match(await page.locator('#quality').innerText(), /28\/28/);
}

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const cases = [testConflict, testShorterPlayingTime, testMissingTimeSource, testSingleRoundProgress, testSingleRoundAutoAppend, testPartnerRotationAndUpgrade, testSingleCourtFullCoverage];
    for (const run of cases) {
      // Each case owns a new nonpersistent context; user browser data is never accessed.
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(appUrl);
        await run(page);
        assert.deepEqual(errors, [], 'no page script errors');
        console.log(`PASS ${run.name}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Run with a local Playwright install, or point PLAYWRIGHT_MODULE to a shared install.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const bundle = await build({ entryPoints: ['tests/browser/fixture.mjs'], bundle: true, write: false,
  alias: { obsidian: path.resolve('tests/browser/obsidian.mjs') }, format: 'iife' });
const css = await readFile('styles.css', 'utf8');
const hostCSS = await readFile('tests/browser/host.css', 'utf8');
const artifacts = path.join(tmpdir(), 'temperans-responsive');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1366, 768], [1024, 600], [800, 500], [390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addStyleTag({ content: hostCSS + '\n' + css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.renderFixture('dashboard'));
    const last = page.locator('.temperans-detail-row').last();
    await last.scrollIntoViewIfNeeded();
    const row = await last.boundingBox();
    assert(row && row.y >= 0 && row.y + row.height <= height + 1, `Last habit unreachable at ${width}x${height}`);
    const dashboard = await page.locator('.temperans-dashboard').evaluate(el => ({ x: el.scrollWidth - el.clientWidth, y: el.scrollTop }));
    assert(dashboard.x <= 1 && dashboard.y > 0, `Dashboard overflow at ${width}x${height}`);
    if (width === 1024) await page.screenshot({ path: path.join(artifacts, 'dashboard-1024x600.png') });

    await page.evaluate(() => window.renderFixture('log'));
    if (height >= 600) {
      const scrolling = await page.locator('.temperans-habit-log-body').evaluate(el => el.scrollHeight - el.clientHeight);
      assert(scrolling <= 1, `Basic logger needs scrolling at ${width}x${height}: ${scrolling}px`);
    }
    const finish = page.getByRole('button', { name: 'Finish', exact: true });
    await finish.scrollIntoViewIfNeeded();
    const footer = await finish.boundingBox();
    assert(footer && footer.y >= 0 && footer.y + footer.height <= height, `Finish unreachable at ${width}x${height}`);
    if (width <= 650 || height <= 650) assert.equal(await page.locator('.temperans-stepper-dots').isVisible(), false);
    await page.getByRole('button', { name: 'Switch habit', exact: true }).click();
    await page.getByRole('option', { name: 'Daily habit 24 (24 of 24)', exact: true }).click();
    assert.match(await page.locator('.temperans-dropdown-label').textContent(), /Daily habit 24/);
    await page.getByRole('button', { name: 'Switch habit', exact: true }).click();
    await page.getByRole('option', { name: 'Daily habit 2 (2 of 24)', exact: true }).click();
    await page.getByRole('button', { name: 'Add session', exact: true }).scrollIntoViewIfNeeded();
    const overflow = await page.locator('.modal-content').evaluate(el => el.scrollWidth - el.clientWidth);
    assert(overflow <= 1, `Logging form horizontal overflow at ${width}x${height}: ${overflow}`);
    if (width === 390) await page.screenshot({ path: path.join(artifacts, 'logging-390x844.png') });

    await page.evaluate(() => window.renderFixture('create'));
    assert.equal(await page.getByText('Use H:MM time format', { exact: true }).count(), 0);
    const unit = page.getByRole('button', { name: 'Choose a habit unit', exact: true });
    await unit.click();
    await page.getByRole('option', { name: 'Minutes', exact: true }).click();
    assert.match(await unit.textContent(), /Minutes/);
    await unit.click();
    assert.equal(await page.getByRole('option', { name: 'Minutes', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('option', { name: 'Minutes', exact: true }).press('Escape');
    const cadence = page.getByRole('button', { name: 'Choose a goal cadence', exact: true });
    for (const label of ['Weekly', 'Monthly', 'Quarterly', 'Annual', 'Daily']) {
      await cadence.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      assert.match(await cadence.textContent(), new RegExp(label));
    }
    await cadence.press('ArrowDown');
    await page.locator('[role=option]:focus').press('End');
    await page.locator('[role=option]:focus').press('Enter');
    assert.match(await cadence.textContent(), /Annual/);
    await unit.click();
    await page.getByRole('option', { name: 'Custom unit...', exact: true }).click();
    await page.getByPlaceholder('e.g. km, steps, words').fill('pomodoros');
    await page.getByPlaceholder('e.g. Daily Reading, No Sugar, Body Weight').fill('Focus');
    await page.getByRole('button', { name: 'Create habit', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => [window.savedHabit.unit, window.savedHabit.cadence]), ['pomodoros', 'annual']);
    assert(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Creation form overflows');
    await page.evaluate(() => window.renderFixture('settings'));
    await page.getByRole('button', { name: 'Choose a goal cadence', exact: true }).click();
    await page.getByRole('option', { name: 'Monthly', exact: true }).click();
    assert.match(await page.getByRole('button', { name: 'Choose a goal cadence', exact: true }).textContent(), /Monthly/);
    await page.getByRole('button', { name: 'Create habit', exact: true }).scrollIntoViewIfNeeded();
    assert(await page.locator('.temperans-settings').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Narrow settings pane overflows');
    await page.evaluate(() => window.renderFixture('note-paths'));
    const nestedToggle = page.locator('.setting-item').filter({ has: page.getByText('Organize logs by year and month', { exact: true }) }).locator('input');
    assert.equal(await page.getByText('Use Daily Notes date format', { exact: true }).count(), 0);
    await nestedToggle.check();
    await page.waitForFunction(() => window.savedNotePath.mode === 'nested');
    await nestedToggle.uncheck();
    const formatInput = page.getByPlaceholder('YYYY-MM-DD');
    await formatInput.fill('DD-MM-YYYY');
    await page.getByRole('button', { name: 'Save format', exact: true }).click();
    await page.waitForFunction(() => window.savedNotePath.format === 'DD-MM-YYYY');
    await page.evaluate(mobile => window.renderFixture('health', { mobile }), width < 650);
    const importButton = page.getByRole('button', { name: 'Import staged data', exact: true });
    const importBox = await importButton.boundingBox();
    assert(importBox && importBox.y >= 0 && importBox.y + importBox.height <= height, 'Health import needs scrolling');
    const stagingInput = page.getByPlaceholder('Habit Logs/.temperance-staging.json');
    assert.equal(await stagingInput.isVisible(), false, 'Staging editor should start collapsed');
    await page.locator('.temperans-staging-path-details > summary').first().click();
    await stagingInput.fill('../bad.json');
    await importButton.click();
    assert.equal(await page.evaluate(() => window.healthImported), false);
    await stagingInput.fill('Habit Logs/Exports/health-data.json');
    await page.getByRole('button', { name: 'Save path', exact: true }).click();
    assert.equal(await page.evaluate(() => window.healthStagingPath), 'Habit Logs/Exports/health-data.json');
    assert(await page.locator('.temperans-health-connect-card').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Staging path overflows');
    if (width === 390 || width === 1024) await page.screenshot({ path: path.join(artifacts, `health-path-${width}x${height}.png`) });
    await importButton.click();
    assert.equal(await page.evaluate(() => window.healthImported), true);
    await page.evaluate(mobile => window.renderFixture('peer', { mobile }), width < 650);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.locator('.temperans-peer-sync-preview').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.temperans-peer-sync-row').count(), 20);
    assert.equal(await page.getByRole('checkbox', { name: 'Select Settings.md', exact: true }).isChecked(), false);
    await page.getByRole('button', { name: 'Receive Settings.md', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Receive Settings.md', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Send Settings.md', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Receive Settings.md', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByRole('button', { name: 'Send Settings.md', exact: true }).getAttribute('aria-pressed'), 'true');
    const allFiles = page.getByRole('checkbox', { name: 'Select or clear all differing files' });
    await allFiles.check();
    await allFiles.uncheck();
    assert.equal(await page.getByRole('button', { name: 'Select files to transfer', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Receive Settings.md', exact: true }).click();
    await page.getByRole('button', { name: '↑ Send selected', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Send Settings.md', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.locator('.temperans-peer-sync-row').last().scrollIntoViewIfNeeded();
    assert(await page.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Peer preview overflows horizontally');
    const lastPeerRow = await page.locator('.temperans-peer-sync-row').last().boundingBox();
    assert(lastPeerRow && lastPeerRow.y >= 0 && lastPeerRow.y + lastPeerRow.height <= height, 'Last peer file is unreachable');
    if (width === 1024 || width === 390) {
      await page.locator('.temperans-peer-sync-preview').scrollIntoViewIfNeeded();
      await page.locator('.temperans-peer-sync-scroll-list').evaluate(el => el.scrollTop = 0);
      const transferBar = await page.locator('.temperans-peer-sync-actions').boundingBox();
      assert(transferBar && transferBar.y >= 0 && transferBar.y + transferBar.height <= height, 'Transfer action is below the preview');
      await page.screenshot({ path: path.join(artifacts, `peer-${width}x${height}.png`) });
    }
    await page.getByRole('button', { name: 'Transfer 1 file', exact: true }).click();
    await page.getByText('Transfer results', { exact: true }).waitFor();
    const transferred = await page.evaluate(() => window.peerTransfers);
    assert.equal(transferred['Settings.md'], 'upload');
    assert.equal(Object.values(transferred).filter(value => value !== 'skip').length, 1);
    console.log(`PASS ${width}x${height}: dashboard scrolling, logging, unit/cadence labels, selection state, keyboard and saving`);
  }
  await page.evaluate(() => window.renderFixture('peer', { empty: true, mobile: true }));
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.getByText('All caught up', { exact: true }).waitFor();
  assert.equal(await page.locator('.temperans-peer-sync-actions').count(), 0);
  await page.evaluate(() => window.renderFixture('peer', { mobile: true }));
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.evaluate(() => window.failPeerTransfer = true);
  await page.locator('.temperans-peer-sync-actions button').click();
  await page.waitForFunction(() => window.lastNotice === 'Connection interrupted');
  assert.equal(await page.locator('.temperans-peer-sync-actions button').isEnabled(), true);
  await page.evaluate(() => window.failPeerTransfer = false);
  console.log('PASS staged import, peer comparison selection/directions, transfers, empty state and failure recovery');
  // Exercise actual header buttons in responsive and explicitly configured calendar modes.
  for (const [width, mode] of [[390, 'auto'], [1366, 'month'], [390, 'year'], [1366, 'auto']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(mode => window.renderFixture('dashboard', { mode }), mode);
    const monthly = mode === 'month' || mode === 'auto' && width <= 720;
    const period = page.locator('.temperans-year');
    const initial = await period.textContent();
    await page.getByRole('button', { name: monthly ? 'Previous month' : 'Previous year', exact: true }).click();
    await page.waitForFunction(initial => document.querySelector('.temperans-year')?.textContent !== initial, initial);
    const expected = new Date();
    if (monthly) expected.setUTCMonth(expected.getUTCMonth() - 1, 1);
    else expected.setUTCFullYear(expected.getUTCFullYear() - 1);
    assert.equal(await period.textContent(), monthly
      ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(expected)
      : String(expected.getUTCFullYear()));
    await page.getByRole('button', { name: monthly ? 'Next month' : 'Next year', exact: true }).click();
    await page.waitForFunction(initial => document.querySelector('.temperans-year')?.textContent === initial, initial);
    assert.equal(await page.getByRole('button', { name: monthly ? 'Next month' : 'Next year', exact: true }).isDisabled(), true);
  }
  await page.setViewportSize({ width: 1024, height: 600 });
  const logging = { amount: { label: 'Practice time', placeholder: 'Duration here' },
    remark: { label: 'Reflection', placeholder: 'What improved?' },
    quickEntry: { values: [10, '0:30'], mode: 'add', showClear: false } };
  await page.evaluate(logging => window.renderFixture('log', { habit: { logging } }), logging);
  assert.equal(await page.getByText('Reflection', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).count(), 0);
  await page.getByPlaceholder('Duration here').fill('1:30');
  await page.waitForFunction(value => window.recordedMetric?.amount === value, 90);
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 90);
  await page.getByPlaceholder('What improved?').fill('Steady focus');
  await page.waitForFunction(value => window.recordedMetric?.note === value, 'Steady focus');
  assert.equal(await page.evaluate(() => window.recordedMetric.note), 'Steady focus');
  await page.getByRole('button', { name: '+10', exact: true }).click();
  await page.waitForFunction(value => window.recordedMetric?.amount === value, 100);
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 100);
  await page.getByRole('button', { name: '+0:30', exact: true }).click();
  await page.waitForFunction(value => window.recordedMetric?.amount === value, 130);
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 130);
  await page.evaluate(() => window.renderFixture('log', { habit: { unit: 'hours', logging: { quickEntry: false } } }));
  assert.equal(await page.locator('.temperans-quick-actions-row').count(), 0);
  await page.getByPlaceholder('Amount (hours)').fill('90m');
  await page.waitForFunction(value => window.recordedMetric?.amount === value, 1.5);
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 1.5);
  await page.getByPlaceholder('Amount (hours)').fill('1:60');
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 1.5, 'Invalid time must not overwrite saved progress');
  await page.evaluate(() => window.renderFixture('log', { habit: { logging: { quickEntry: { values: [25], mode: 'set', showClear: false } } } }));
  await page.getByRole('button', { name: '25', exact: true }).click();
  await page.waitForFunction(value => window.recordedMetric?.amount === value, 25);
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 25);
  await page.evaluate(() => window.renderFixture('log', { habit: { type: 'session', unit: 'hours', logging: {
    amount: { placeholder: 'Session duration' }, title: { placeholder: 'Activity name' }, remark: { placeholder: 'Session reflection' }, quickEntry: false
  } } }));
  await page.getByPlaceholder('Activity name').fill('Practice');
  await page.getByPlaceholder('Session duration').fill('1:30');
  await page.getByPlaceholder('Session reflection').fill('Good session');
  await page.getByRole('button', { name: 'Add session', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.recordedSession), { id: 'habit-0', title: 'Practice', minutes: 90, note: 'Good session' });
  console.log('PASS month/year header buttons, custom labels/placeholders, quick-entry add/set/hide, flexible time saves');
  await page.evaluate(() => window.renderFixture('log', { habit: { unit: 'count', logging: { quickEntry: false } } }));
  await page.getByPlaceholder('Amount (count)').pressSequentially('123', { delay: 30 });
  await page.waitForFunction(() => window.recordedMetric?.amount === 123);
  assert.equal(await page.evaluate(() => window.metricWriteCount), 1, 'Rapid edits should coalesce into one save');
  await page.evaluate(() => { window.failSaves = true; });
  await page.getByPlaceholder('Amount (count)').fill('456');
  await page.waitForFunction(() => document.querySelector('.temperans-save-status')?.textContent?.includes('Not saved'));
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  assert.equal(await page.locator('.temperans-log-modal').count(), 1, 'Failed save must retain the draft modal');
  await page.evaluate(() => { window.failSaves = false; });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.temperans-log-modal'));
  assert.equal(await page.evaluate(() => window.recordedMetric.amount), 456);
  console.log('PASS debounced autosave, visible failure, retained draft, and Finish retry');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { window.pendingDashboard = window.renderFixture('dashboard', { holdHistory: true }); });
  await page.waitForFunction(() => typeof window.releaseHistory === 'function');
  assert(await page.getByRole('button', { name: 'Log today', exact: true }).isVisible(), 'Header must be usable while history is blocked');
  assert(await page.locator('.temperans-day-detail-panel').count() > 0, 'Daily details must render before the annual range');
  assert.equal(await page.locator('.temperans-stat-value').count(), 0, 'Pending statistics must not display false zero totals');
  await page.getByRole('button', { name: 'Log today', exact: true }).click();
  assert(await page.locator('.temperans-log-modal').isVisible(), 'Logger must open during dashboard loading');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.temperans-log-modal'));
  await page.evaluate(() => { window.holdHistory = false; window.releaseHistory(); });
  await page.evaluate(() => window.pendingDashboard);
  await page.waitForFunction(() => document.querySelector('.temperans-stat-value'));
  await page.screenshot({ path: path.join(artifacts, 'staged-dashboard-1024x768.png') });
  await page.evaluate(() => window.renderFixture('embed'));
  assert.equal(await page.evaluate(() => window.fixtureRangeRequests.length), 0, 'Offscreen embed must not read history');
  await page.evaluate(() => window.embedElement.scrollIntoView());
  await page.waitForFunction(() => window.fixtureRangeRequests.length > 0);
  await page.waitForFunction(() => document.querySelector('.temperans-day-detail-panel'));
  console.log('PASS usable header, daily details and logger during blocked history; deferred offscreen embeds');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.renderFixture('log', { habit: { type: 'session', unit: 'minutes', logging: {
    amount: { placeholder: 'Keyboard duration' }, remark: { placeholder: 'Keyboard note' }, quickEntry: false
  } } }));
  await page.getByPlaceholder('Keyboard duration').fill('30');
  const keyboardNote = page.getByPlaceholder('Keyboard note');
  await keyboardNote.fill('The keyboard must not cover this note.');
  // Simulate an overlay keyboard: layout viewport stays tall while the visible area shrinks.
  for (const [height, top] of [[440, 0], [300, 80]]) {
    await page.evaluate(({ height, top }) => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: height });
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: top });
      window.visualViewport.dispatchEvent(new Event('resize'));
      window.visualViewport.dispatchEvent(new Event('scroll'));
    }, { height, top });
    await page.waitForFunction(({ height, top }) => {
      const modal = document.querySelector('.temperans-log-modal');
      const box = document.querySelector('[placeholder="Keyboard note"]').getBoundingClientRect();
      const bounds = modal.getBoundingClientRect();
      return modal.classList.contains('is-keyboard-open') && box.top >= top && box.bottom <= top + height
        && bounds.top >= top && bounds.bottom <= top + height;
    }, { height, top });
  }
  await page.screenshot({ path: path.join(artifacts, 'logging-keyboard-390.png') });
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => !document.querySelector('.temperans-log-modal').classList.contains('is-keyboard-open'));
  // Also cover webviews that shrink the whole layout viewport.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.waitForFunction(() => {
    const box = document.querySelector('[placeholder="Keyboard note"]').getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.temperans-log-modal'));
  assert.equal(await page.evaluate(() => window.recordedSession.note), 'The keyboard must not cover this note.');
  await page.setViewportSize({ width: 390, height: 844 });
  console.log('PASS overlay/resizing keyboard viewport, note visibility, restoration, and session save');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }

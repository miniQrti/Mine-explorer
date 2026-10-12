/**
 * Cross-engine smoke: run a dev server, install Playwright WebKit, then
 * `node tests/webkit-smoke.mjs`. WEBKIT_EXECUTABLE_PATH and ordinary WebKit/LD
 * environment variables optionally support user-local browser dependencies.
 * Mobile uses Playwright's WebKit device emulation, not a physical iPhone.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { webkit, devices } from '@playwright/test';

const url = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await webkit.launch(process.env.WEBKIT_EXECUTABLE_PATH
  ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH, env: process.env } : {});
const ready = page => page.waitForFunction(() => window.__MINE_QA__?.state?.status === 'playing' && !window.__MINE_QA__.getSnapshot().busy);
const snapshot = page => page.evaluate(() => window.__MINE_QA__.getSnapshot());
const tile = (page, i) => page.locator(`.cell[data-index="${i}"]`);
async function load(page, depth = 1, mode = 'expedition', seed = 'webkit-smoke') {
  await page.evaluate(async ({ depth, mode, seed }) => {
    const { generateFloor } = await import('./src/engine.js');
    window.__MINE_QA__.loadFloor(generateFloor(depth, { seed }), { mode });
  }, { depth, mode, seed });
  await ready(page);
}
async function target(page, mine = false) {
  return page.evaluate(async mine => {
    const { isFrontier, deduce, getPlayerView } = await import('./src/engine.js');
    const state = window.__MINE_QA__.state;
    return mine ? state.floor.cells.findIndex((cell, i) => cell.mine && isFrontier(state, i))
      : [...deduce(getPlayerView(state)).safe].find(i => isFrontier(state, i));
  }, mine);
}
await mkdir('artifacts', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile-webkit' : 'desktop-webkit';
    const context = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [], workers = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('worker', worker => workers.push(worker.url()));
    await page.goto(`${url}/?qa=1`);
    await ready(page);
    assert.ok(workers.some(worker => worker.endsWith('/src/generator-worker.js')), 'Actual module worker generated initial cave');
    if (await page.locator('#note-dismiss').isVisible()) await page.locator('#note-dismiss').click();
    await load(page);
    const first = await target(page);
    assert.ok(Number.isInteger(first));
    const before = await snapshot(page);
    if (mobile) await tile(page, first).tap(); else await tile(page, first).click();
    assert.ok((await snapshot(page)).revealed.includes(first), 'Native click/tap reveals safe frontier');
    assert.ok((await snapshot(page)).revealed.length > before.revealed.length);
    const second = await target(page);
    if (!mobile) await tile(page, second).click({ button: 'right' });
    else { await tile(page, second).focus(); await page.keyboard.press('f'); }
    const saved = await snapshot(page);
    assert.ok(saved.flags.includes(second));
    await page.reload(); await ready(page);
    const restored = await snapshot(page);
    assert.equal(restored.seed, saved.seed); assert.deepEqual(restored.revealed, saved.revealed); assert.deepEqual(restored.flags, saved.flags);
    await page.locator('#help-open').click(); assert.ok(await page.locator('#help-dialog').isVisible());
    await page.getByRole('button', { name: 'Close help' }).click();
    await page.locator('#settings-open').click(); await page.locator('#motion-toggle').check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.reload(); await ready(page);
    assert.ok(await page.evaluate(() => document.body.classList.contains('reduced-motion')));
    await load(page);
    for (let step = 0; step < 200 && (await snapshot(page)).status === 'playing'; step++) {
      const next = await target(page); assert.ok(Number.isInteger(next), 'Deduction path remains available');
      await tile(page, next).focus(); await page.keyboard.press('Enter');
    }
    assert.equal((await snapshot(page)).status, 'exit');
    await page.locator('#descend-button').click(); await ready(page);
    assert.equal((await snapshot(page)).depth, 2);
    for (const mode of ['expedition', 'retry']) {
      await load(page, 201, mode, 'browser-death-201');
      const old = await snapshot(page), mine = await target(page, true);
      assert.ok(mine >= 0); await tile(page, mine).focus(); await page.keyboard.press('Enter');
      assert.equal((await snapshot(page)).status, 'lost');
      await page.locator('#retry-button').click(); await ready(page);
      const fresh = await snapshot(page);
      assert.equal(fresh.depth, mode === 'expedition' ? 1 : 201); assert.notEqual(fresh.seed, old.seed);
    }
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal document overflow');
      for (const selector of ['#mode-open', '#help-open', '#zoom-in', '#recenter']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} stays inside viewport`);
      }
    }
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await load(page);
    await page.screenshot({ path: `artifacts/${label}.png` });
    assert.deepEqual(errors, [], 'No uncaught JavaScript errors');
    console.log(`PASS ${label}: worker, click/tap, flags, save/restore, dialogs, preferences, deduction/descent, both retries, portrait/landscape, no page errors`);
    await context.close();
  }
} finally { await browser.close(); }

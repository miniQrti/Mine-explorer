import { test, expect } from '@playwright/test';
import { center, longPress, touchDrag, touchPinch, touchCancel, touchSession } from './qa-helpers.js';

const tile = (page, index) => page.locator(`.cell[data-index="${index}"]`);
const snapshot = page => page.evaluate(() => window.__MINE_QA__.getSnapshot());
const pageErrors = new WeakMap();

async function ready(page) {
  await page.waitForFunction(() => window.__MINE_QA__?.state?.status === 'playing');
  await expect(page.locator('#loading')).toBeHidden();
}

async function load(page, { depth = 1, mode = 'expedition', seed = 'browser-qa' } = {}) {
  await page.evaluate(async ({ depth, mode, seed }) => {
    const { generateFloor } = await import('/src/engine.js');
    window.__MINE_QA__.loadFloor(generateFloor(depth, { seed }), { mode });
  }, { depth, mode, seed });
  await ready(page);
}

async function target(page, kind = 'safe') {
  return page.evaluate(async kind => {
    const { isFrontier, deduce, getPlayerView } = await import('/src/engine.js');
    const state = window.__MINE_QA__.state;
    if (kind === 'deduced') return [...deduce(getPlayerView(state)).safe].find(i => isFrontier(state, i));
    return state.floor.cells.findIndex((cell, index) => isFrontier(state, index)
      && (kind === 'mine' ? cell.mine : !cell.mine));
  }, kind);
}

async function solveWithKeyboard(page) {
  for (let step = 0; step < 200; step++) {
    if ((await snapshot(page)).status === 'exit') return;
    const index = await target(page, 'deduced');
    expect(index, 'Player-visible deductions must continue to the stairs').toBeDefined();
    await tile(page, index).focus();
    await page.keyboard.press('Enter');
  }
  throw new Error('Stairs did not become reachable within 200 proven safe moves');
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?qa=1');
  await ready(page);
  await load(page);
  if (await page.locator('#note-dismiss').isVisible()) await page.locator('#note-dismiss').click();
});

test.afterEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes('failed generator worker')) {
    expect(pageErrors.get(page), 'No unhandled JavaScript errors during normal gameplay').toEqual([]);
  }
});

test('starts with readable clues and reveals only the explored frontier', async ({ page, isMobile }) => {
  await expect(page).toHaveTitle('Mine Explorer');
  await expect(page.locator('#depth')).toHaveText('001');
  const before = await snapshot(page);
  const index = await target(page);
  if (isMobile) await tile(page, index).tap(); else await tile(page, index).click();
  const after = await snapshot(page);
  expect(after.revealed).toContain(index);
  expect(after.revealed.length).toBeGreaterThan(before.revealed.length);
  expect(after.status).not.toBe('lost');
  const leak = await page.evaluate(async () => {
    const { getVisibleIndices } = await import('/src/engine.js');
    const state = window.__MINE_QA__.state;
    const visible = getVisibleIndices(state);
    return [...document.querySelectorAll('.cell')].filter(node => !visible.has(Number(node.dataset.index))).length;
  });
  expect(leak, 'Unseen terrain must not appear as board cells in the DOM').toBe(0);
});

test('covered cells do not disclose mines, stairs, or hidden clues', async ({ page }) => {
  const cells = await page.evaluate(() => {
    const state = window.__MINE_QA__.state;
    return [...document.querySelectorAll('.cell')]
      .filter(node => !state.revealed.has(Number(node.dataset.index)) && !state.floor.cells[Number(node.dataset.index)].rock)
      .map(node => ({ label: node.getAttribute('aria-label'), text: node.textContent,
        className: node.className, attributes: [...node.attributes].map(a => [a.name, a.value]) }));
  });
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.label ?? '').not.toMatch(/mine|stairs|adjacent|nearby|clue/i);
    expect(cell.className).not.toMatch(/mine|stairs|clue|number-/i);
    expect(cell.text).not.toMatch(/[1-8]/);
    expect(cell.attributes.map(([name]) => name)).not.toEqual(expect.arrayContaining(['data-mine', 'data-stairs', 'data-clue']));
  }
});

test('flagging is reversible and never reveals the tile', async ({ page, isMobile }) => {
  const index = await target(page);
  const before = await snapshot(page);
  if (isMobile) await longPress(page, tile(page, index)); else await tile(page, index).click({ button: 'right' });
  expect((await snapshot(page)).flags).toContain(index);
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  if (isMobile) await tile(page, index).tap(); else await tile(page, index).click();
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  if (isMobile) await longPress(page, tile(page, index)); else await tile(page, index).click({ button: 'right' });
  expect((await snapshot(page)).flags).not.toContain(index);
});

test('panning does not reveal or flag a tile', async ({ page, isMobile }) => {
  const index = await target(page);
  const before = await snapshot(page);
  if (isMobile) await touchDrag(page, tile(page, index));
  else {
    const start = await center(tile(page, index));
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 75, start.y + 30, { steps: 8 }); await page.mouse.up();
  }
  const after = await snapshot(page);
  expect(after.revealed).toEqual(before.revealed);
  expect(after.flags).toEqual(before.flags);
});

test('pinch and canceled touches never reveal or flag tiles', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch gesture safety is exercised on the mobile project');
  const index = await target(page);
  const before = await snapshot(page);
  await touchCancel(page, tile(page, index));
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  await touchPinch(page, tile(page, index));
  const after = await snapshot(page);
  expect(after.revealed).toEqual(before.revealed);
  expect(after.flags).toEqual(before.flags);
  expect(after.zoom).not.toBe(before.zoom);
});

for (const mode of ['expedition', 'retry']) {
  test(`${mode} death retries at the correct depth with a fresh cave`, async ({ page }) => {
    await load(page, { depth: 201, mode, seed: 'browser-death-201' });
    const before = await snapshot(page);
    const index = await target(page, 'mine');
    expect(index).toBeGreaterThanOrEqual(0);
    await tile(page, index).focus(); await page.keyboard.press('Enter');
    expect((await snapshot(page)).status).toBe('lost');
    await expect(page.locator('#retry-button')).toBeVisible();
    await page.locator('#retry-button').click();
    await ready(page);
    const after = await snapshot(page);
    expect(after.depth).toBe(mode === 'expedition' ? 1 : 201);
    expect(after.seed).not.toBe(before.seed);
    expect(after.mode).toBe(mode);
  });
}

test('player-visible deductions reach stairs and descent creates a fresh floor', async ({ page }) => {
  const before = await snapshot(page);
  await solveWithKeyboard(page);
  await expect(page.locator('#descend-button')).toBeVisible();
  const won = await snapshot(page);
  const hasUnclearedGround = await page.evaluate(() => {
    const state = window.__MINE_QA__.state;
    return state.floor.cells.some((cell, i) => !cell.rock && !cell.mine && !state.revealed.has(i));
  });
  expect(won.status).toBe('exit');
  expect(hasUnclearedGround, 'Reaching stairs must not require clearing the cave').toBe(true);
  await page.locator('#descend-button').click();
  await ready(page);
  const after = await snapshot(page);
  expect(after.depth).toBe(2);
  expect(after.seed).not.toBe(before.seed);
});

test('mode selection preserves progress until explicit confirmation', async ({ page }) => {
  await load(page, { depth: 7 });
  const before = await snapshot(page);
  await page.locator('#mode-open').click();
  await page.locator('[data-mode="retry"]').click();
  expect((await snapshot(page)).seed).toBe(before.seed);
  await page.getByRole('button', { name: 'Close mode selection' }).click();
  expect((await snapshot(page)).depth).toBe(7);
  await page.locator('#mode-open').click();
  await page.locator('[data-mode="retry"]').click();
  await page.locator('#mode-confirm-button').click();
  await ready(page);
  expect((await snapshot(page)).mode).toBe('retry');
  expect((await snapshot(page)).depth).toBe(1);
  expect((await snapshot(page)).seed).not.toBe(before.seed);
});

test('help, settings, keyboard flags, and zoom controls are usable', async ({ page }) => {
  await page.locator('#help-open').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.locator('#help-dialog')).toContainText('eight neighboring tiles');
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  await page.locator('#settings-open').click();
  await page.locator('#motion-toggle').check();
  await expect(page.locator('#motion-toggle')).toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();
  const index = await target(page);
  await tile(page, index).focus(); await page.keyboard.press('f');
  expect((await snapshot(page)).flags).toContain(index);
  await page.keyboard.press('f');
  expect((await snapshot(page)).flags).not.toContain(index);
  const zoom = (await snapshot(page)).zoom;
  await page.locator('#zoom-in').click();
  expect((await snapshot(page)).zoom).toBeGreaterThan(zoom);
  await page.locator('#zoom-out').click();
  expect((await snapshot(page)).zoom).toBeCloseTo(zoom);
});

test('portrait and landscape keep the board and controls within the viewport', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#viewport')).toBeVisible();
    for (const selector of ['#help-open', '#mode-open', '#zoom-in', '#recenter']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

test('regular page has no QA harness or JavaScript errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.cell').first()).toBeVisible();
  expect(await page.evaluate(() => typeof window.__MINE_QA__)).toBe('undefined');
  expect(errors).toEqual([]);
});

test('reload preserves the exact cave, mode, exploration, and flags', async ({ page }) => {
  await load(page, { depth: 17, mode: 'retry', seed: 'reload-preservation' });
  const mine = await target(page, 'mine');
  await tile(page, mine).focus(); await page.keyboard.press('f');
  const safe = await target(page, 'deduced');
  await tile(page, safe).focus(); await page.keyboard.press('Enter');
  const before = await snapshot(page);
  expect(before.status).toBe('playing');
  await page.reload(); await ready(page);
  const after = await snapshot(page);
  for (const property of ['seed', 'depth', 'mode', 'status', 'revealed', 'flags']) {
    expect(after[property], `Saved ${property} should survive reload`).toEqual(before[property]);
  }
});

test('a failed generator worker offers a working retry', async ({ page }) => {
  await page.route('**/generator-worker.js', route => route.abort('failed'));
  await page.reload();
  await expect(page.locator('#generation-retry')).toBeVisible();
  await expect(page.locator('#loading')).toContainText('could not verify this cave');
  await page.unroute('**/generator-worker.js');
  await page.locator('#generation-retry').click();
  await page.waitForFunction(() => window.__MINE_QA__?.state?.status === 'playing', { }, { timeout: 10000 });
  await expect(page.locator('#loading')).toBeHidden();
});

test('GitHub Pages repository subpath loads assets and a playable worker-generated board', async ({ page }) => {
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/Mine-explorer/') && response.status() >= 400) failures.push(response.url());
  });
  await page.goto('/Mine-explorer/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.cell').first()).toBeVisible();
  await page.locator('#settings-open').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect(await page.evaluate(() => typeof window.__MINE_QA__)).toBe('undefined');
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test('a tile touching explored ground only diagonally can be revealed', async ({ page, isMobile }) => {
  const index = await page.evaluate(async () => {
    const { neighbors, isFrontier } = await import('/src/engine.js');
    const state = window.__MINE_QA__.state;
    return state.floor.cells.findIndex((cell, index) => !cell.mine && isFrontier(state, index)
      && neighbors(state.floor, index).filter(i => state.revealed.has(i))
        .every(i => state.floor.cells[i].x !== cell.x && state.floor.cells[i].y !== cell.y));
  });
  expect(index).toBeGreaterThanOrEqual(0);
  if (isMobile) await tile(page, index).tap(); else await tile(page, index).click();
  expect((await snapshot(page)).revealed).toContain(index);
});

test('arrow navigation stays on visible cells and Escape restores help trigger focus', async ({ page }) => {
  const index = await target(page);
  const before = await snapshot(page);
  await tile(page, index).focus();
  await page.keyboard.press('ArrowLeft');
  const focused = await page.evaluate(() => Number(document.activeElement.dataset.index));
  expect(focused).not.toBe(index);
  await expect(tile(page, focused)).toBeFocused();
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  await page.locator('#help-open').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).toBeHidden();
  await expect(page.locator('#help-open')).toBeFocused();
});

test('zoom bounds preserve usable controls and never change game state', async ({ page }) => {
  const before = await snapshot(page);
  for (let n = 0; n < 15 && await page.locator('#zoom-in').isEnabled(); n++) await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-in')).toBeDisabled();
  expect((await snapshot(page)).zoom).toBeCloseTo(1.8);
  for (let n = 0; n < 20 && await page.locator('#zoom-out').isEnabled(); n++) await page.locator('#zoom-out').click();
  await expect(page.locator('#zoom-out')).toBeDisabled();
  expect((await snapshot(page)).zoom).toBeCloseTo(0.7);
  await page.locator('#recenter').click();
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  expect((await snapshot(page)).flags).toEqual(before.flags);
});

test('a second touch starting over board controls cancels the pending tile reveal', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Multi-touch safety requires touch input');
  const before = await snapshot(page);
  const start = await center(tile(page, await target(page)));
  const control = await center(page.locator('#zoom-in'));
  const input = await touchSession(page);
  try {
    await input.send('touchStart', [start]);
    await input.send('touchStart', [start, { ...control, id: 2 }]);
    await input.send('touchEnd');
  } finally { await input.close(); }
  expect((await snapshot(page)).revealed).toEqual(before.revealed);
  expect((await snapshot(page)).flags).toEqual(before.flags);
});

import { test, expect } from '@playwright/test';

const ROW0 = ['SOLE', 'SHIFT', 'CHECK', 'HEEL'];
const tile = (page, w) => page.locator(`.tile[data-word="${w}"]`);
const center = async (page, w) => {
  const b = await tile(page, w).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const selectedWords = page =>
  page.locator('.tile[data-selected="true"]').evaluateAll(els => els.map(e => e.dataset.word).sort());

async function finger(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down: p => send('touchStart', [{ x: p.x, y: p.y }]),
    move: p => send('touchMove', [{ x: p.x, y: p.y }]),
    up: () => send('touchEnd', []),
    async path(from, to, steps = 6) {
      for (let s = 1; s <= steps; s++) {
        await this.move({ x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps });
      }
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/puzzle.json', r => r.fulfill({ status: 404 })); // fixed sample board
  await page.goto('/');
  await page.waitForTimeout(250);
});

test('tap cycles color', async ({ page }) => {
  await tile(page, 'SOLE').tap();
  await expect(tile(page, 'SOLE')).toHaveAttribute('data-color', '1');
});

test('long-press sweep selects the swept row', async ({ page }) => {
  const f = await finger(page);
  let prev = await center(page, ROW0[0]);
  await f.down(prev);
  await page.waitForTimeout(400);
  for (const w of ROW0.slice(1)) {
    const c = await center(page, w);
    await f.path(prev, c);
    prev = c;
  }
  await f.up();
  expect(await selectedWords(page)).toEqual([...ROW0].sort());
});

test('quick drag moves one tile and selects nothing', async ({ page }) => {
  const f = await finger(page);
  const from = await center(page, 'SOLE');
  const to = await center(page, 'RAISE');
  const raiseBox = await tile(page, 'RAISE').boundingBox();
  await f.down(from);
  await f.path(from, to);
  await f.up();
  await page.waitForTimeout(250);
  expect(await selectedWords(page)).toEqual([]);
  const soleBox = await tile(page, 'SOLE').boundingBox();
  expect(Math.round(soleBox.x)).toBe(Math.round(raiseBox.x));
  expect(Math.round(soleBox.y)).toBe(Math.round(raiseBox.y));
});

test('touch drag on stage padding does not marquee', async ({ page }) => {
  const f = await finger(page);
  const b = await page.locator('#board').boundingBox();
  const from = { x: b.x - 10, y: b.y - 10 };
  await f.down(from);
  await f.path(from, await center(page, 'RAISE'));
  await expect(page.locator('#marquee')).toBeHidden();
  await f.up();
  expect(await selectedWords(page)).toEqual([]);
});

test('long-press does not open a context menu or select text', async ({ page }) => {
  const f = await finger(page);
  await f.down(await center(page, 'SOLE'));
  await page.waitForTimeout(900);
  await f.up();
  const selection = await page.evaluate(() => String(getSelection()));
  expect(selection).toBe('');
  expect(await selectedWords(page)).toEqual(['SOLE']);
});

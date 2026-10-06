import { test, expect } from '@playwright/test';

const ROW0 = ['SOLE', 'SHIFT', 'CHECK', 'HEEL'];
const tile = (page, w) => page.locator(`.tile[data-word="${w}"]`);
const center = async (page, w) => {
  const b = await tile(page, w).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const selectedWords = page =>
  page.locator('.tile[data-selected="true"]').evaluateAll(els => els.map(e => e.dataset.word).sort());
// Board-local positions from each tile's inline translate(). Bounding boxes would
// be skewed by the selected-state scale(1.04), so they are not used for layout checks.
const boxes = page =>
  page.locator('.tile').evaluateAll(els => Object.fromEntries(els.map(e => {
    const [x, y] = e.style.transform.match(/-?[\d.]+/g).map(Number);
    return [e.dataset.word, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }];
  })));
async function sweep(page, words) {
  const first = await center(page, words[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.waitForTimeout(400);
  for (const w of words.slice(1)) {
    const c = await center(page, w);
    await page.mouse.move(c.x, c.y, { steps: 6 });
  }
  await page.mouse.up();
}
async function quickDrag(page, fromWord, to) {
  const a = await center(page, fromWord);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/puzzle.json', r => r.fulfill({ status: 404 })); // fixed sample board
  await page.goto('/');
  await page.waitForTimeout(250); // let transform transitions settle
});

test('tap cycles one tile color', async ({ page }) => {
  await tile(page, 'SOLE').click();
  await expect(tile(page, 'SOLE')).toHaveAttribute('data-color', '1');
  await expect(tile(page, 'SHIFT')).toHaveAttribute('data-color', '0');
});

test('long-press sweep selects exactly the swept row', async ({ page }) => {
  await sweep(page, ROW0);
  expect(await selectedWords(page)).toEqual([...ROW0].sort());
  await expect(page.locator('#count')).toHaveText('4 selected');
});

test('tap on a selected tile colors the whole selection', async ({ page }) => {
  await sweep(page, ROW0);
  await tile(page, 'SHIFT').click();
  for (const w of ROW0) await expect(tile(page, w)).toHaveAttribute('data-color', '1');
  await expect(tile(page, 'PIKE')).toHaveAttribute('data-color', '0');
});

test('quick drag moves one tile, selects nothing, swaps on snap', async ({ page }) => {
  const before = await boxes(page);
  await quickDrag(page, 'SOLE', await center(page, 'RAISE'));
  await page.waitForTimeout(250);
  expect(await selectedWords(page)).toEqual([]);
  const after = await boxes(page);
  expect(after.SOLE).toEqual(before.RAISE);
  expect(after.RAISE).toEqual(before.SOLE);
});

test('marquee from stage padding selects intersecting tiles', async ({ page }) => {
  const b = await page.locator('#board').boundingBox();
  const end = await center(page, 'RAISE');
  await page.mouse.move(b.x - 10, b.y - 10);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('#marquee')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#marquee')).toBeHidden();
  expect(await selectedWords(page)).toEqual(['PIKE', 'RAISE', 'SHIFT', 'SOLE']);
});

test('click on stage padding clears selection; Esc clears selection', async ({ page }) => {
  await sweep(page, ROW0);
  const b = await page.locator('#board').boundingBox();
  await page.mouse.click(b.x - 10, b.y - 10);
  expect(await selectedWords(page)).toEqual([]);
  await sweep(page, ROW0);
  await page.keyboard.press('Escape');
  expect(await selectedWords(page)).toEqual([]);
});

test('group drag with snap: dragged tile lands under pointer, displaced fill vacated', async ({ page }) => {
  const before = await boxes(page);
  await sweep(page, ROW0);
  await quickDrag(page, 'SHIFT', await center(page, 'CARP'));
  await page.waitForTimeout(250);
  const after = await boxes(page);
  expect(after.SOLE).toEqual(before.FOLD);
  expect(after.SHIFT).toEqual(before.CARP);
  expect(after.CHECK).toEqual(before.LACE);
  expect(after.HEEL).toEqual(before.ESCAPE);
  expect(after.FOLD).toEqual(before.SOLE);
  expect(after.ESCAPE).toEqual(before.HEEL);
  expect(after.TAB).toEqual(before.TAB);
});

test('group drag without snap keeps relative layout', async ({ page }) => {
  await page.locator('#snap').uncheck();
  const before = await boxes(page);
  await sweep(page, ROW0);
  const a = await center(page, 'SOLE');
  await quickDrag(page, 'SOLE', { x: a.x, y: a.y + 100 });
  await page.waitForTimeout(250);
  const after = await boxes(page);
  for (const w of ROW0) {
    expect(after[w].x).toBe(before[w].x);
    expect(Math.abs(after[w].y - (before[w].y + 100))).toBeLessThanOrEqual(1);
  }
  expect(after.PIKE).toEqual(before.PIKE);
});

test('Current mode: no sweep, no marquee, no group drag', async ({ page }) => {
  await sweep(page, ROW0);
  await page.locator('input[name=mode][value=current]').check();
  expect(await selectedWords(page)).toEqual([]); // switching mode clears
  await sweep(page, ROW0);
  expect(await selectedWords(page)).toEqual([]);
  const b = await page.locator('#board').boundingBox();
  const end = await center(page, 'RAISE');
  await page.mouse.move(b.x - 10, b.y - 10);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  expect(await selectedWords(page)).toEqual([]);
});

test('reset restores the original board', async ({ page }) => {
  const before = await boxes(page);
  await tile(page, 'SOLE').click();
  await quickDrag(page, 'SOLE', await center(page, 'RAISE'));
  await page.locator('#reset').click();
  await page.waitForTimeout(250);
  expect(await boxes(page)).toEqual(before);
  await expect(tile(page, 'SOLE')).toHaveAttribute('data-color', '0');
});

test('no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // the resize handler re-lays the board asynchronously after the viewport change
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

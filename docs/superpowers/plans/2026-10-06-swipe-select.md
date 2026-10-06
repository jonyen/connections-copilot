# Swipe-select Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static prototype page showing swipe-select + group drag for a Connections Copilot–style board, with a Current/Proposed toggle, and publish it as a private Claude Artifact.

**Architecture:** Two pure ES modules (`board.js` model + grid math, `gestures.js` pointer state machine) unit-tested with `node --test`, wired to the DOM by `app.js`. `index.html` holds markup and CSS. No build step: the Artifact publishes `index.html` plus the `src/` files.

**Tech Stack:** Vanilla JS (ES modules, Pointer Events), Node 26 `node:test`, Playwright (`@playwright/test`, Chromium), `python3 -m http.server` for e2e serving.

**Spec:** `docs/superpowers/specs/2026-10-06-swipe-select-design.md`

## Global Constraints

- No runtime dependencies; no interact.js; no bundler.
- Long-press: 300 ms hold, cancelled by movement > 8 px.
- Tap-to-color and single-tile drag must behave as today in both modes.
- Touch never starts a marquee.
- `touch-action: none` on the stage only; page outside the stage still scrolls.
- Page labelled "unofficial prototype, not affiliated with Connections Copilot or The New York Times"; no Connections Copilot logo, no NYT marks.
- Sample words are invented (below), not a real NYT puzzle.
- Light and dark themes; works at 360 px wide with 16 px side gutter, no horizontal scroll.
- `navigator.vibrate` optional; absence is silent.

## Review Focus

1. Finger jitter under 8 px during a long-press still counts as a hold → sweep starts. Pinned in Task 2 (`jitter under slop still long-presses`).
2. A second finger landing mid-sweep or mid-drag is ignored. Pinned in Task 2 (`second pointer is ignored`).
3. A long-press timer that fires after a quick drag has started must not start a sweep. Pinned in Task 2 (`stale longpress after drag is ignored`).
4. Group of 4 dropped on the last cell clamps so all 4 fit (cells 12–15). Pinned in Task 1 (`snapGroup clamps at board end`).
5. Rotation/resize in free mode keeps tiles proportionally placed. Pinned in Task 1 (`rescale free mode scales positions`).

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM flag, test scripts, Playwright dev dep |
| `src/board.js` | Tile model, grid math, selection, color, move, snap, rescale, hit rect |
| `src/gestures.js` | Pointer state machine → intents; no DOM |
| `src/app.js` | DOM wiring: build tiles, pointer listeners, apply intents, render, toggles |
| `index.html` | Markup, CSS tokens, pitch copy, legend |
| `playwright.config.js` | Desktop + touch projects, static server |
| `tests/unit/board.test.js` | `board.js` tests |
| `tests/unit/gestures.test.js` | `gestures.js` tests |
| `tests/e2e/desktop.spec.js` | Mouse flows |
| `tests/e2e/touch.spec.js` | Touch flows via CDP touch events |

Sample words (reading order, cell 0–15). Groups: fish SOLE PIKE CARP PERCH · shoe parts HEEL TONGUE LACE EYELET · keys SHIFT ENTER ESCAPE TAB · poker CHECK RAISE FOLD CALL.

```
SOLE  SHIFT  CHECK   HEEL
PIKE  RAISE  TONGUE  ENTER
FOLD  CARP   LACE    ESCAPE
TAB   CALL   PERCH   EYELET
```

---

### Task 1: Board model

**Files:**
- Create: `package.json`, `.gitignore`, `src/board.js`
- Test: `tests/unit/board.test.js`

**Interfaces:**
- Produces (all exported from `src/board.js`):
  - `COLS = 4`, `ROWS = 4`, `COLOR_COUNT = 5`
  - `createBoard(words: string[16]) → Board` where `Board = { snap: boolean, tiles: Tile[] }`, `Tile = { id: number, word: string, cell: number|null, x: number, y: number, color: 0..4, selected: boolean }`; `tiles[i].id === i`
  - Metrics `M = { tileW: number, tileH: number, gap: number }`
  - `cellXY(cell, M) → {x, y}`, `cellAt(x, y, M) → cell`, `boardSize(M) → {w, h}`
  - `placeAll(board, M)` — sets x,y from cell for tiles with non-null cell
  - `selectedIds(board) → number[]`, `setSelected(board, ids, additive)`, `clearSelection(board)`
  - `cycleColor(board, tapId)` — if tapped tile selected, all selected get tapped color + 1; else only tapped
  - `moveTiles(board, origins: Map<id,{x,y}>, dx, dy, M)` — clamped group move
  - `snapSingle(board, id, M)` — snap to cell under tile, swap occupant into old cell
  - `snapGroup(board, ids, anchorId, M)`
  - `enableSnap(board, M)`, `disableSnap(board)`
  - `rescale(board, from: M, to: M)`
  - `tilesInRect(board, rect: {x,y,w,h}, M) → number[]`

- [ ] **Step 1: Scaffold**

`package.json`:
```json
{
  "name": "connections-swipe-select",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/unit/",
    "e2e": "playwright test"
  }
}
```

`.gitignore`:
```
node_modules/
test-results/
playwright-report/
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/board.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoard, cellXY, cellAt, boardSize, placeAll, selectedIds, setSelected,
  clearSelection, cycleColor, moveTiles, snapSingle, snapGroup, enableSnap,
  disableSnap, rescale, tilesInRect,
} from '../../src/board.js';

const WORDS = ['SOLE','SHIFT','CHECK','HEEL','PIKE','RAISE','TONGUE','ENTER',
  'FOLD','CARP','LACE','ESCAPE','TAB','CALL','PERCH','EYELET'];
const M = { tileW: 100, tileH: 60, gap: 10 };
const fresh = () => { const b = createBoard(WORDS); placeAll(b, M); return b; };
const cellOf = (b, w) => b.tiles.find(t => t.word === w).cell;

test('createBoard requires 16 words', () => {
  assert.throws(() => createBoard(['A']));
});

test('grid math', () => {
  assert.deepEqual(cellXY(5, M), { x: 110, y: 70 });
  assert.equal(cellAt(115, 65, M), 5);
  assert.equal(cellAt(-50, 999, M), 12);
  assert.deepEqual(boardSize(M), { w: 430, h: 270 });
});

test('placeAll positions tiles by cell', () => {
  const b = fresh();
  assert.deepEqual([b.tiles[7].x, b.tiles[7].y], [330, 70]);
});

test('selection helpers', () => {
  const b = fresh();
  setSelected(b, [1, 2], false);
  setSelected(b, [3], true);
  assert.deepEqual(selectedIds(b), [1, 2, 3]);
  setSelected(b, [0], false);
  assert.deepEqual(selectedIds(b), [0]);
  clearSelection(b);
  assert.deepEqual(selectedIds(b), []);
});

test('cycleColor on unselected tile changes only that tile', () => {
  const b = fresh();
  setSelected(b, [1, 2], false);
  cycleColor(b, 0);
  assert.deepEqual(b.tiles.slice(0, 3).map(t => t.color), [1, 0, 0]);
});

test('cycleColor on selected tile colors whole selection from tapped color', () => {
  const b = fresh();
  b.tiles[2].color = 3;
  setSelected(b, [1, 2, 5], false);
  cycleColor(b, 2);
  assert.deepEqual([1, 2, 5].map(i => b.tiles[i].color), [4, 4, 4]);
  cycleColor(b, 2);
  assert.deepEqual([1, 2, 5].map(i => b.tiles[i].color), [0, 0, 0]);
});

test('moveTiles moves group by delta and clamps to board', () => {
  const b = fresh();
  const origins = new Map([[0, { x: 0, y: 0 }], [1, { x: 110, y: 0 }]]);
  moveTiles(b, origins, 50, 20, M);
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y, b.tiles[1].x], [50, 20, 160]);
  moveTiles(b, origins, -500, 9999, M);
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y, b.tiles[1].x], [0, 210, 110]);
  moveTiles(b, origins, 9999, 0, M);
  assert.equal(b.tiles[1].x, 330); // right edge: 430 - 100
});

test('snapSingle swaps with occupant', () => {
  const b = fresh();
  Object.assign(b.tiles[0], cellXY(5, M)); // drag SOLE over RAISE
  b.tiles[0].x += 12;
  snapSingle(b, 0, M);
  assert.equal(cellOf(b, 'SOLE'), 5);
  assert.equal(cellOf(b, 'RAISE'), 0);
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y], [110, 70]);
  assert.deepEqual([b.tiles[5].x, b.tiles[5].y], [0, 0]);
});

test('snapGroup lands dragged tile under pointer, displaced fill vacated', () => {
  const b = fresh();
  setSelected(b, [0, 1, 2, 3], false);
  Object.assign(b.tiles[1], cellXY(9, M)); // dragged SHIFT (index 1 in group) to cell 9
  snapGroup(b, [0, 1, 2, 3], 1, M);
  assert.deepEqual(['SOLE','SHIFT','CHECK','HEEL'].map(w => cellOf(b, w)), [8, 9, 10, 11]);
  assert.deepEqual(['FOLD','CARP','LACE','ESCAPE'].map(w => cellOf(b, w)), [0, 1, 2, 3]);
  const cells = b.tiles.map(t => t.cell).sort((a, z) => a - z);
  assert.deepEqual(cells, [...Array(16).keys()]);
});

test('snapGroup orders group by original cell, not by id', () => {
  const b = fresh();
  Object.assign(b.tiles[12], cellXY(0, M)); // drag TAB (cell 12) to cell 0
  snapGroup(b, [5, 12], 12, M); // RAISE cell 5, TAB cell 12; TAB is 2nd in reading order
  assert.equal(cellOf(b, 'RAISE'), 0); // anchor index 1 at cell 0 → start clamps to 0
  assert.equal(cellOf(b, 'TAB'), 1);
});

test('snapGroup clamps at board end', () => {
  const b = fresh();
  Object.assign(b.tiles[0], cellXY(15, M));
  snapGroup(b, [0, 1, 2, 3], 0, M);
  assert.deepEqual(['SOLE','SHIFT','CHECK','HEEL'].map(w => cellOf(b, w)), [12, 13, 14, 15]);
  assert.deepEqual(['TAB','CALL','PERCH','EYELET'].map(w => cellOf(b, w)), [0, 1, 2, 3]);
});

test('disableSnap clears cells; enableSnap reassigns by reading order', () => {
  const b = fresh();
  disableSnap(b);
  assert.equal(b.snap, false);
  assert.ok(b.tiles.every(t => t.cell === null));
  b.tiles[0].x = 335; b.tiles[0].y = 3;  // SOLE nudged to far right of row 0
  b.tiles[3].x = 330;                     // HEEL stays
  enableSnap(b, M);
  assert.equal(b.snap, true);
  assert.equal(cellOf(b, 'HEEL'), 2);
  assert.equal(cellOf(b, 'SOLE'), 3);
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y], [330, 0]);
});

test('rescale snap mode re-places by cell', () => {
  const b = fresh();
  const to = { tileW: 50, tileH: 40, gap: 5 };
  rescale(b, M, to);
  assert.deepEqual([b.tiles[5].x, b.tiles[5].y], [55, 45]);
});

test('rescale free mode scales positions', () => {
  const b = fresh();
  disableSnap(b);
  b.tiles[0].x = 220; b.tiles[0].y = 140;
  rescale(b, M, { tileW: 45, tileH: 25, gap: 10 });
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y], [110, 70]);
});

test('tilesInRect returns intersecting tiles', () => {
  const b = fresh();
  assert.deepEqual(tilesInRect(b, { x: -10, y: -10, w: 170, h: 110 }, M), [0, 1, 4, 5]);
  assert.deepEqual(tilesInRect(b, { x: 101, y: 0, w: 8, h: 300 }, M), []); // gap column
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module .../src/board.js`

- [ ] **Step 4: Implement**

`src/board.js`:
```js
export const COLS = 4;
export const ROWS = 4;
export const COLOR_COUNT = 5; // 0 = uncolored, 1–4 = group colors

export function createBoard(words) {
  if (words.length !== COLS * ROWS) throw new Error(`need ${COLS * ROWS} words`);
  return {
    snap: true,
    tiles: words.map((word, i) => ({ id: i, word, cell: i, x: 0, y: 0, color: 0, selected: false })),
  };
}

export function cellXY(cell, m) {
  return { x: (cell % COLS) * (m.tileW + m.gap), y: Math.floor(cell / COLS) * (m.tileH + m.gap) };
}

export function cellAt(x, y, m) {
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  const col = clamp(Math.round(x / (m.tileW + m.gap)), COLS - 1);
  const row = clamp(Math.round(y / (m.tileH + m.gap)), ROWS - 1);
  return row * COLS + col;
}

export function boardSize(m) {
  return { w: COLS * m.tileW + (COLS - 1) * m.gap, h: ROWS * m.tileH + (ROWS - 1) * m.gap };
}

export function placeAll(board, m) {
  for (const t of board.tiles) if (t.cell !== null) Object.assign(t, cellXY(t.cell, m));
}

export function selectedIds(board) {
  return board.tiles.filter(t => t.selected).map(t => t.id);
}

export function setSelected(board, ids, additive) {
  const set = new Set(ids);
  for (const t of board.tiles) t.selected = set.has(t.id) || (additive && t.selected);
}

export function clearSelection(board) {
  for (const t of board.tiles) t.selected = false;
}

export function cycleColor(board, tapId) {
  const tapped = board.tiles[tapId];
  const next = (tapped.color + 1) % COLOR_COUNT;
  const targets = tapped.selected ? board.tiles.filter(t => t.selected) : [tapped];
  for (const t of targets) t.color = next;
}

export function moveTiles(board, origins, dx, dy, m) {
  const { w, h } = boardSize(m);
  const pts = [...origins.values()];
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const cdx = Math.max(-minX, Math.min(w - m.tileW - maxX, dx));
  const cdy = Math.max(-minY, Math.min(h - m.tileH - maxY, dy));
  for (const [id, p] of origins) {
    board.tiles[id].x = p.x + cdx;
    board.tiles[id].y = p.y + cdy;
  }
}

export function snapSingle(board, id, m) {
  const t = board.tiles[id];
  const target = cellAt(t.x, t.y, m);
  const occupant = board.tiles.find(o => o.id !== id && o.cell === target);
  if (occupant) occupant.cell = t.cell;
  t.cell = target;
  placeAll(board, m);
}

export function snapGroup(board, ids, anchorId, m) {
  const n = ids.length;
  const group = ids.map(id => board.tiles[id]).sort((a, b) => a.cell - b.cell);
  const anchor = board.tiles[anchorId];
  const anchorIndex = group.indexOf(anchor);
  const start = Math.max(0, Math.min(COLS * ROWS - n, cellAt(anchor.x, anchor.y, m) - anchorIndex));
  const targets = Array.from({ length: n }, (_, i) => start + i);
  const targetSet = new Set(targets);
  const idSet = new Set(ids);
  const vacated = group.map(t => t.cell).filter(c => !targetSet.has(c)).sort((a, b) => a - b);
  const displaced = board.tiles
    .filter(t => !idSet.has(t.id) && targetSet.has(t.cell))
    .sort((a, b) => a.cell - b.cell);
  displaced.forEach((t, i) => { t.cell = vacated[i]; });
  group.forEach((t, i) => { t.cell = targets[i]; });
  placeAll(board, m);
}

export function enableSnap(board, m) {
  const pitch = m.tileH + m.gap;
  const order = [...board.tiles].sort(
    (a, b) => (Math.round(a.y / pitch) - Math.round(b.y / pitch)) || (a.x - b.x));
  order.forEach((t, i) => { t.cell = i; });
  board.snap = true;
  placeAll(board, m);
}

export function disableSnap(board) {
  board.snap = false;
  for (const t of board.tiles) t.cell = null;
}

export function rescale(board, from, to) {
  if (board.snap) return placeAll(board, to);
  const sx = (to.tileW + to.gap) / (from.tileW + from.gap);
  const sy = (to.tileH + to.gap) / (from.tileH + from.gap);
  for (const t of board.tiles) { t.x *= sx; t.y *= sy; }
}

export function tilesInRect(board, r, m) {
  return board.tiles
    .filter(t => t.x < r.x + r.w && t.x + m.tileW > r.x && t.y < r.y + r.h && t.y + m.tileH > r.y)
    .map(t => t.id);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: all `board.test.js` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/board.js tests/unit/board.test.js
git commit -m "feat: board model with grid snap, group snap, selection"
```

---

### Task 2: Gesture state machine

**Files:**
- Create: `src/gestures.js`
- Test: `tests/unit/gestures.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `HOLD_MS = 300`, `SLOP_PX = 8`, `createGestures({ proposed: () => boolean, isSelected: (id) => boolean }) → { handle(event) → Intent[], state: string }`.
  - Events: `{type:'down', pointerId, pointerType, x, y, tileId|null, shiftKey}`, `{type:'move', pointerId, x, y, tileId|null}`, `{type:'up', pointerId, x, y}`, `{type:'cancel', pointerId}`, `{type:'longpress'}`. `x,y` are board-local px.
  - Intents: `armLongPress{ms}`, `tap{tileId}`, `dragStart{tileId, group}`, `dragMove{dx,dy}`, `dragEnd{dx,dy}`, `dragCancel`, `sweepStart{tileId}`, `sweepAdd{tileId}`, `sweepEnd`, `marquee{rect, additive}`, `marqueeEnd{rect, additive}`, `marqueeCancel`, `clear`.
  - `state` ∈ `idle | pressing | pressingEmpty | dragging | sweeping | marquee`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/gestures.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestures, HOLD_MS } from '../../src/gestures.js';

function machine({ proposed = true, selected = [] } = {}) {
  const sel = new Set(selected);
  const g = createGestures({ proposed: () => proposed, isSelected: id => sel.has(id) });
  return g;
}
const down = (o = {}) => ({ type: 'down', pointerId: 1, pointerType: 'mouse', x: 0, y: 0, tileId: 0, shiftKey: false, ...o });
const move = (o = {}) => ({ type: 'move', pointerId: 1, x: 0, y: 0, tileId: null, ...o });
const up = (o = {}) => ({ type: 'up', pointerId: 1, x: 0, y: 0, ...o });
const types = intents => intents.map(i => i.type);

test('tap on tile', () => {
  const g = machine();
  assert.deepEqual(g.handle(down()), [{ type: 'armLongPress', ms: HOLD_MS }]);
  assert.deepEqual(g.handle(up()), [{ type: 'tap', tileId: 0 }]);
  assert.equal(g.state, 'idle');
});

test('current mode does not arm long-press', () => {
  const g = machine({ proposed: false });
  assert.deepEqual(g.handle(down()), []);
});

test('quick move past slop drags single tile', () => {
  const g = machine();
  g.handle(down());
  assert.deepEqual(g.handle(move({ x: 5 })), []);
  assert.deepEqual(g.handle(move({ x: 20, y: 3 })), [
    { type: 'dragStart', tileId: 0, group: false },
    { type: 'dragMove', dx: 20, dy: 3 },
  ]);
  assert.deepEqual(g.handle(move({ x: 30, y: 4 })), [{ type: 'dragMove', dx: 30, dy: 4 }]);
  assert.deepEqual(g.handle(up({ x: 31, y: 4 })), [{ type: 'dragEnd', dx: 31, dy: 4 }]);
});

test('dragging a selected tile drags the group (proposed only)', () => {
  const g = machine({ selected: [0] });
  g.handle(down());
  assert.equal(g.handle(move({ x: 20 }))[0].group, true);
  const c = machine({ proposed: false, selected: [0] });
  c.handle(down());
  assert.equal(c.handle(move({ x: 20 }))[0].group, false);
});

test('long-press then sweep adds each tile once', () => {
  const g = machine();
  g.handle(down({ pointerType: 'touch' }));
  assert.deepEqual(g.handle({ type: 'longpress' }), [{ type: 'sweepStart', tileId: 0 }]);
  assert.equal(g.state, 'sweeping');
  assert.deepEqual(g.handle(move({ x: 50, tileId: 0 })), []);
  assert.deepEqual(g.handle(move({ x: 120, tileId: 1 })), [{ type: 'sweepAdd', tileId: 1 }]);
  assert.deepEqual(g.handle(move({ x: 125, tileId: 1 })), []);
  assert.deepEqual(g.handle(move({ x: 130, tileId: null })), []);
  assert.deepEqual(g.handle(move({ x: 240, tileId: 2 })), [{ type: 'sweepAdd', tileId: 2 }]);
  assert.deepEqual(g.handle(up()), [{ type: 'sweepEnd' }]);
  assert.equal(g.state, 'idle');
});

test('jitter under slop still long-presses', () => {
  const g = machine();
  g.handle(down({ pointerType: 'touch' }));
  g.handle(move({ x: 5, y: 5 })); // hypot ≈ 7.07 < 8
  assert.deepEqual(types(g.handle({ type: 'longpress' })), ['sweepStart']);
});

test('stale longpress after drag is ignored', () => {
  const g = machine();
  g.handle(down());
  g.handle(move({ x: 40 }));
  assert.deepEqual(g.handle({ type: 'longpress' }), []);
  assert.equal(g.state, 'dragging');
});

test('stale longpress after tap is ignored', () => {
  const g = machine();
  g.handle(down());
  g.handle(up());
  assert.deepEqual(g.handle({ type: 'longpress' }), []);
});

test('second pointer is ignored', () => {
  const g = machine();
  g.handle(down({ pointerType: 'touch' }));
  g.handle({ type: 'longpress' });
  assert.deepEqual(g.handle(down({ pointerId: 2, tileId: 5 })), []);
  assert.deepEqual(g.handle(move({ pointerId: 2, tileId: 5 })), []);
  assert.deepEqual(g.handle(up({ pointerId: 2 })), []);
  assert.equal(g.state, 'sweeping');
});

test('mouse marquee on empty space', () => {
  const g = machine();
  assert.deepEqual(g.handle(down({ tileId: null, x: 10, y: 10, shiftKey: true })), []);
  assert.deepEqual(g.handle(move({ x: 13, y: 12 })), []);
  assert.deepEqual(g.handle(move({ x: 60, y: 5 })), [
    { type: 'marquee', rect: { x: 10, y: 5, w: 50, h: 5 }, additive: true },
  ]);
  assert.deepEqual(g.handle(up({ x: 70, y: 40 })), [
    { type: 'marqueeEnd', rect: { x: 10, y: 10, w: 60, h: 30 }, additive: true },
  ]);
});

test('click on empty space clears', () => {
  const g = machine();
  g.handle(down({ tileId: null }));
  assert.deepEqual(g.handle(up({ x: 2 })), [{ type: 'clear' }]);
});

test('touch on empty space never marquees, tap clears', () => {
  const g = machine();
  g.handle(down({ tileId: null, pointerType: 'touch' }));
  assert.deepEqual(g.handle(move({ x: 100, y: 100 })), []);
  assert.deepEqual(g.handle(up({ x: 100, y: 100 })), [{ type: 'clear' }]);
});

test('current mode: mouse on empty space does not marquee', () => {
  const g = machine({ proposed: false });
  g.handle(down({ tileId: null }));
  assert.deepEqual(g.handle(move({ x: 100 })), []);
  assert.deepEqual(g.handle(up({ x: 100 })), [{ type: 'clear' }]);
});

test('cancel', () => {
  const d = machine();
  d.handle(down()); d.handle(move({ x: 40 }));
  assert.deepEqual(d.handle({ type: 'cancel', pointerId: 1 }), [{ type: 'dragCancel' }]);
  assert.equal(d.state, 'idle');

  const s = machine();
  s.handle(down()); s.handle({ type: 'longpress' });
  assert.deepEqual(s.handle({ type: 'cancel', pointerId: 1 }), [{ type: 'sweepEnd' }]);

  const mq = machine();
  mq.handle(down({ tileId: null })); mq.handle(move({ x: 50 }));
  assert.deepEqual(mq.handle({ type: 'cancel', pointerId: 1 }), [{ type: 'marqueeCancel' }]);

  const p = machine();
  p.handle(down());
  assert.deepEqual(p.handle({ type: 'cancel', pointerId: 1 }), []);
  assert.equal(p.state, 'idle');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: `gestures.test.js` FAIL — cannot find `src/gestures.js`; board tests still pass.

- [ ] **Step 3: Implement**

`src/gestures.js`:
```js
export const HOLD_MS = 300;
export const SLOP_PX = 8;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rectOf = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});

export function createGestures({ proposed, isSelected }) {
  let s = { kind: 'idle' };

  function onDown(e) {
    if (s.kind !== 'idle') return [];
    const start = { x: e.x, y: e.y };
    if (e.tileId !== null) {
      s = { kind: 'pressing', pointerId: e.pointerId, tileId: e.tileId, start };
      return proposed() ? [{ type: 'armLongPress', ms: HOLD_MS }] : [];
    }
    if (proposed() && e.pointerType !== 'touch') {
      s = { kind: 'marquee', pointerId: e.pointerId, start, additive: e.shiftKey, moved: false };
      return [];
    }
    s = { kind: 'pressingEmpty', pointerId: e.pointerId };
    return [];
  }

  function onMove(e) {
    const p = { x: e.x, y: e.y };
    switch (s.kind) {
      case 'pressing': {
        if (dist(p, s.start) <= SLOP_PX) return [];
        const group = proposed() && isSelected(s.tileId);
        s = { kind: 'dragging', pointerId: s.pointerId, tileId: s.tileId, start: s.start };
        return [
          { type: 'dragStart', tileId: s.tileId, group },
          { type: 'dragMove', dx: p.x - s.start.x, dy: p.y - s.start.y },
        ];
      }
      case 'dragging':
        return [{ type: 'dragMove', dx: p.x - s.start.x, dy: p.y - s.start.y }];
      case 'sweeping':
        if (e.tileId === null || s.swept.has(e.tileId)) return [];
        s.swept.add(e.tileId);
        return [{ type: 'sweepAdd', tileId: e.tileId }];
      case 'marquee':
        if (!s.moved && dist(p, s.start) <= SLOP_PX) return [];
        s.moved = true;
        return [{ type: 'marquee', rect: rectOf(s.start, p), additive: s.additive }];
      default:
        return [];
    }
  }

  function onUp(e) {
    const p = { x: e.x, y: e.y };
    const prev = s;
    s = { kind: 'idle' };
    switch (prev.kind) {
      case 'pressing': return [{ type: 'tap', tileId: prev.tileId }];
      case 'dragging': return [{ type: 'dragEnd', dx: p.x - prev.start.x, dy: p.y - prev.start.y }];
      case 'sweeping': return [{ type: 'sweepEnd' }];
      case 'marquee':
        return prev.moved
          ? [{ type: 'marqueeEnd', rect: rectOf(prev.start, p), additive: prev.additive }]
          : [{ type: 'clear' }];
      case 'pressingEmpty': return [{ type: 'clear' }];
      default: return [];
    }
  }

  function onCancel() {
    const prev = s;
    s = { kind: 'idle' };
    if (prev.kind === 'dragging') return [{ type: 'dragCancel' }];
    if (prev.kind === 'sweeping') return [{ type: 'sweepEnd' }];
    if (prev.kind === 'marquee' && prev.moved) return [{ type: 'marqueeCancel' }];
    return [];
  }

  function handle(e) {
    if (e.type === 'down') return onDown(e);
    if (e.type === 'longpress') {
      if (s.kind !== 'pressing') return [];
      s = { kind: 'sweeping', pointerId: s.pointerId, swept: new Set([s.tileId]) };
      return [{ type: 'sweepStart', tileId: [...s.swept][0] }];
    }
    if (s.kind === 'idle' || e.pointerId !== s.pointerId) return [];
    if (e.type === 'move') return onMove(e);
    if (e.type === 'up') return onUp(e);
    if (e.type === 'cancel') return onCancel();
    return [];
  }

  return { handle, get state() { return s.kind; } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all board and gestures tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gestures.js tests/unit/gestures.test.js
git commit -m "feat: pointer gesture state machine for tap, drag, sweep, marquee"
```

---

### Task 3: Page, DOM wiring, desktop e2e

**Files:**
- Create: `index.html`, `src/app.js`, `playwright.config.js`
- Test: `tests/e2e/desktop.spec.js`

**Interfaces:**
- Consumes: everything exported by `src/board.js` (Task 1) and `createGestures` (Task 2).
- Produces DOM contract used by e2e tests:
  - `#stage` (pointer listeners, padded 20 px) contains `#board`; `#board` contains `#marquee` and 16 `.tile` elements with `data-word`, `data-id`, `data-color` (`"0"`–`"4"`), `data-selected` (`"true"`/`"false"`).
  - `#count` text `"N selected"`, class `show` when N > 0.
  - `input[name=mode][value=current]`, `input[name=mode][value=proposed]` (proposed checked by default), `#snap` checkbox (checked by default), `#reset` button.

- [ ] **Step 1: Load design guidance**

Invoke the `artifact-design` skill. Apply its page contract to `index.html`: `<title>` "Swipe-select Proposal", color tokens on `:root` with dark overrides under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and under `:root[data-theme="dark"]`, explicit `body` background, 16 px side gutter, no external resources except optional Google Fonts. Where the skill's guidance conflicts with copy or IDs below, keep the IDs and copy; adapt styling.

- [ ] **Step 2: Install Playwright and write the failing desktop tests**

Run: `npm i -D @playwright/test && npx playwright install chromium`

`playwright.config.js`:
```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: { command: 'python3 -m http.server 4173', port: 4173, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:4173/' },
  projects: [
    { name: 'desktop', testMatch: /desktop\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'touch', testMatch: /touch\.spec\.js/, use: { ...devices['Pixel 7'] } },
  ],
});
```

`tests/e2e/desktop.spec.js`:
```js
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx playwright test --project=desktop`
Expected: FAIL — page 404 / `.tile` not found.

- [ ] **Step 4: Write `src/app.js`**

```js
import {
  createBoard, boardSize, placeAll, selectedIds, setSelected, clearSelection, cycleColor,
  moveTiles, snapSingle, snapGroup, enableSnap, disableSnap, rescale, tilesInRect,
} from './board.js';
import { createGestures } from './gestures.js';

const WORDS = ['SOLE', 'SHIFT', 'CHECK', 'HEEL', 'PIKE', 'RAISE', 'TONGUE', 'ENTER',
  'FOLD', 'CARP', 'LACE', 'ESCAPE', 'TAB', 'CALL', 'PERCH', 'EYELET'];
const MAX_W = 560;
const GAP = 8;

const stageEl = document.getElementById('stage');
const boardEl = document.getElementById('board');
const marqueeEl = document.getElementById('marquee');
const countEl = document.getElementById('count');
const snapEl = document.getElementById('snap');

let mode = 'proposed';
let board, m, tileEls = [];
let drag = null; // { anchorId, group, origins: Map<id,{x,y}> }
let timer = null;

const gestures = createGestures({
  proposed: () => mode === 'proposed',
  isSelected: id => board.tiles[id].selected,
});

function metrics() {
  const w = Math.min(stageEl.clientWidth - 40, MAX_W); // 40 = stage padding both sides
  const tileW = (w - GAP * 3) / 4;
  return { tileW, tileH: Math.max(56, Math.round(tileW * 0.75)), gap: GAP };
}

function build() {
  board = createBoard(WORDS);
  m = metrics();
  for (const el of tileEls) el.remove();
  tileEls = board.tiles.map(t => {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = t.id;
    el.dataset.word = t.word;
    el.textContent = t.word;
    boardEl.append(el);
    return el;
  });
  placeAll(board, m);
  if (!snapEl.checked) disableSnap(board);
  render();
}

function render() {
  const { w, h } = boardSize(m);
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  for (const t of board.tiles) {
    const el = tileEls[t.id];
    el.style.width = `${m.tileW}px`;
    el.style.height = `${m.tileH}px`;
    el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    el.dataset.color = t.color;
    el.dataset.selected = t.selected;
    el.classList.toggle('dragging', !!drag && drag.origins.has(t.id));
  }
  const n = selectedIds(board).length;
  countEl.textContent = `${n} selected`;
  countEl.classList.toggle('show', n > 0);
}

function showMarquee(r) {
  Object.assign(marqueeEl.style, {
    left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`,
  });
  marqueeEl.hidden = false;
}

function apply(intents) {
  for (const i of intents) {
    switch (i.type) {
      case 'armLongPress':
        clearTimeout(timer);
        timer = setTimeout(() => apply(gestures.handle({ type: 'longpress' })), i.ms);
        break;
      case 'tap': cycleColor(board, i.tileId); break;
      case 'dragStart': {
        const ids = i.group ? selectedIds(board) : [i.tileId];
        drag = {
          anchorId: i.tileId,
          group: i.group,
          origins: new Map(ids.map(id => [id, { x: board.tiles[id].x, y: board.tiles[id].y }])),
        };
        break;
      }
      case 'dragMove': moveTiles(board, drag.origins, i.dx, i.dy, m); break;
      case 'dragEnd':
        moveTiles(board, drag.origins, i.dx, i.dy, m);
        if (board.snap) {
          if (drag.group) snapGroup(board, [...drag.origins.keys()], drag.anchorId, m);
          else snapSingle(board, drag.anchorId, m);
        }
        drag = null;
        break;
      case 'dragCancel':
        for (const [id, p] of drag.origins) Object.assign(board.tiles[id], p);
        drag = null;
        break;
      case 'sweepStart':
        setSelected(board, [i.tileId], true);
        stageEl.classList.add('sweeping');
        try { navigator.vibrate?.(10); } catch { /* unsupported */ }
        break;
      case 'sweepAdd': setSelected(board, [i.tileId], true); break;
      case 'sweepEnd': stageEl.classList.remove('sweeping'); break;
      case 'marquee': showMarquee(i.rect); break;
      case 'marqueeEnd':
        setSelected(board, tilesInRect(board, i.rect, m), i.additive);
        marqueeEl.hidden = true;
        break;
      case 'marqueeCancel': marqueeEl.hidden = true; break;
      case 'clear': clearSelection(board); break;
    }
  }
  if (gestures.state !== 'pressing') clearTimeout(timer);
  render();
}

function local(e) {
  const r = boardEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function tileUnder(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tile');
  return el && boardEl.contains(el) ? Number(el.dataset.id) : null;
}

stageEl.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const tileEl = e.target.closest('.tile');
  const out = gestures.handle({
    type: 'down', pointerId: e.pointerId, pointerType: e.pointerType, ...local(e),
    tileId: tileEl ? Number(tileEl.dataset.id) : null, shiftKey: e.shiftKey,
  });
  if (gestures.state !== 'idle') {
    try { stageEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  }
  apply(out);
});
stageEl.addEventListener('pointermove', e =>
  apply(gestures.handle({ type: 'move', pointerId: e.pointerId, ...local(e), tileId: tileUnder(e) })));
stageEl.addEventListener('pointerup', e =>
  apply(gestures.handle({ type: 'up', pointerId: e.pointerId, ...local(e) })));
stageEl.addEventListener('pointercancel', e =>
  apply(gestures.handle({ type: 'cancel', pointerId: e.pointerId })));
stageEl.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { clearSelection(board); render(); }
});
for (const input of document.querySelectorAll('input[name=mode]')) {
  input.addEventListener('change', () => { mode = input.value; clearSelection(board); render(); });
}
snapEl.addEventListener('change', () => {
  if (snapEl.checked) enableSnap(board, m); else disableSnap(board);
  render();
});
document.getElementById('reset').addEventListener('click', build);
window.addEventListener('resize', () => {
  const next = metrics();
  rescale(board, m, next);
  m = next;
  render();
});

build();
```

- [ ] **Step 5: Write `index.html`**

Required structure (styling per Step 1; the CSS rules listed are required behavior, not optional styling):
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Swipe-select Proposal</title>
  <style>
    /* tokens: --bg, --fg, --muted, --tile, --tile-fg, --c1..--c4, --outline, --marquee
       light + dark per artifact-design contract.
       --c1 #f9df6d, --c2 #a0c35a, --c3 #b0c4ef, --c4 #ba81c5 (same in both themes, dark text on them) */

    #stage { position: relative; padding: 20px; touch-action: none; user-select: none;
             -webkit-user-select: none; -webkit-touch-callout: none; }
    #board { position: relative; margin: 0 auto; }
    .tile { position: absolute; left: 0; top: 0; display: grid; place-items: center;
            border-radius: 8px; font-weight: 700; text-transform: uppercase;
            background: var(--tile); color: var(--tile-fg); cursor: grab;
            transition: transform 150ms ease, box-shadow 150ms ease, outline-color 150ms; }
    .tile[data-color="1"] { background: var(--c1); color: #111; }
    .tile[data-color="2"] { background: var(--c2); color: #111; }
    .tile[data-color="3"] { background: var(--c3); color: #111; }
    .tile[data-color="4"] { background: var(--c4); color: #111; }
    .tile[data-selected="true"] { outline: 3px solid var(--outline); outline-offset: 2px;
            box-shadow: 0 6px 14px rgb(0 0 0 / .25); scale: 1.04; z-index: 1; }
    .tile.dragging { transition: none; z-index: 2; cursor: grabbing; }
    #marquee { position: absolute; border: 1.5px dashed var(--outline);
               background: var(--marquee); pointer-events: none; z-index: 3; }
    #count { visibility: hidden; }
    #count.show { visibility: visible; }
  </style>
</head>
<body>
  <main>
    <h1>Proposal: swipe-select for Connections Copilot</h1>
    <p class="disclaimer">Unofficial prototype, not affiliated with Connections Copilot or The New York Times.</p>
    <p>Today, grouping a puzzle means dragging tiles one at a time — four drags per group, sixteen per puzzle.</p>
    <p>Proposed: long-press a tile and sweep across others to select them, then drag or color them together.</p>
    <p>Existing gestures are unchanged: tap still changes color, and a quick drag still moves one tile.</p>

    <div class="controls">
      <fieldset>
        <legend>Behavior</legend>
        <label><input type="radio" name="mode" value="current"> Current</label>
        <label><input type="radio" name="mode" value="proposed" checked> Proposed</label>
      </fieldset>
      <label><input type="checkbox" id="snap" checked> Snap to grid</label>
      <button id="reset" type="button">Reset</button>
    </div>

    <div id="count" aria-live="polite">0 selected</div>
    <div id="stage">
      <div id="board"><div id="marquee" hidden></div></div>
    </div>

    <ul class="legend">
      <li><b>Long-press + sweep</b> — select several tiles (touch or mouse)</li>
      <li><b>Drag on empty space</b> — rectangle select (mouse); Shift adds</li>
      <li><b>Drag a selected tile</b> — moves the whole selection</li>
      <li><b>Tap a selected tile</b> — colors the whole selection</li>
      <li><b>Tap empty space / Esc</b> — clear selection</li>
    </ul>
  </main>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

`#marquee[hidden]` must stay hidden: add `#marquee[hidden] { display: none; }` if the stylesheet sets `display` on `#marquee`.

- [ ] **Step 6: Run to verify pass**

Run: `npm test && npx playwright test --project=desktop`
Expected: all unit tests and all 11 desktop tests PASS. If a test fails, fix the code, not the test, unless the test contradicts the spec.

- [ ] **Step 7: Visual check**

Run `python3 -m http.server 4173` in the background, then take one Playwright screenshot at 1280×800 and one at 360×740, both light and dark (`page.emulateMedia({ colorScheme: 'dark' })`). Save them to the session scratchpad, not the repo. Check: tiles readable, selection outline visible in both themes, no overflow, disclaimer visible.

- [ ] **Step 8: Commit**

```bash
git add index.html src/app.js playwright.config.js package.json package-lock.json tests/e2e/desktop.spec.js
git commit -m "feat: prototype page with swipe-select, marquee, group drag; desktop e2e"
```

---

### Task 4: Touch e2e

**Files:**
- Test: `tests/e2e/touch.spec.js`
- Modify (only if a test exposes a bug): `src/app.js`, `index.html`

**Interfaces:**
- Consumes: DOM contract from Task 3.

- [ ] **Step 1: Write the tests**

`tests/e2e/touch.spec.js`:
```js
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
```

- [ ] **Step 2: Run**

Run: `npx playwright test --project=touch`
Expected: all 5 PASS. If one fails, use superpowers:systematic-debugging before changing code. Likely culprits: a missing `touch-action: none` on `#stage` (touchMove becomes scroll → `pointercancel`), or text selection on long-press (missing `user-select: none`).

- [ ] **Step 3: Full suite**

Run: `npm test && npx playwright test`
Expected: all unit + 11 desktop + 5 touch tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/touch.spec.js
git add -u
git commit -m "test: touch e2e for sweep, quick drag, no-marquee, long-press hygiene"
```

---

### Task 5: Publish

**Files:** none created in the repo.

- [ ] **Step 1: Publish the Artifact**

Call the Artifact tool:
- `file_path`: `/Users/jyen/Projects/connections-swipe-select/index.html`
- `files`: `{ "src/app.js": "src/app.js", "src/board.js": "src/board.js", "src/gestures.js": "src/gestures.js" }`
- `icon`: `grid`
- `description`: `Interactive prototype proposing swipe-select and group drag for a Connections planner.`

- [ ] **Step 2: Smoke-check the published page**

Read it back with Artifact `action: "read"` and confirm the HTML references `src/app.js` and the three files are listed (`action: "list", scope: "files"`).

- [ ] **Step 3: Hand off**

Give the user the link and ask them to do the one manual check the spec requires: open it on their iPhone in Safari, long-press SOLE and sweep across the top row, then drag the selection. Report the result; do not send anything to the site's developer.

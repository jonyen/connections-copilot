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

test('disableSnap clears cells; enableSnap sends a collision to the nearest free cell', () => {
  const b = fresh();
  disableSnap(b);
  assert.equal(b.snap, false);
  assert.ok(b.tiles.every(t => t.cell === null));
  b.tiles[0].x = 335; b.tiles[0].y = 3;  // SOLE dropped onto HEEL; HEEL comes first in reading order
  enableSnap(b, M);
  assert.equal(b.snap, true);
  assert.equal(cellOf(b, 'HEEL'), 3);
  assert.equal(cellOf(b, 'SOLE'), 0);    // the only free cell on a 4x4 board
  assert.deepEqual([b.tiles[0].x, b.tiles[0].y], [0, 0]);
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

// Canvas: the grid extends below the 16 tiles, leaving empty cells to park groups in.
const C = { tileW: 100, tileH: 100, gap: 10, rows: 7 };
const canvas = () => { const b = createBoard(WORDS); placeAll(b, C); return b; };

test('canvas grid math uses m.rows', () => {
  assert.deepEqual(boardSize(C), { w: 430, h: 760 });
  assert.equal(cellAt(0, 9999, C), 24);
});

test('snapSingle into an empty canvas cell moves without swapping', () => {
  const b = canvas();
  Object.assign(b.tiles[0], cellXY(21, C));
  snapSingle(b, 0, C);
  assert.equal(cellOf(b, 'SOLE'), 21);
  assert.equal(b.tiles.filter(t => t.cell === 0).length, 0); // vacated cell stays empty
});

test('snapGroup into empty canvas rows leaves vacated cells empty', () => {
  const b = canvas();
  Object.assign(b.tiles[1], cellXY(21, C));
  snapGroup(b, [0, 1, 2, 3], 1, C);
  assert.deepEqual(['SOLE', 'SHIFT', 'CHECK', 'HEEL'].map(w => cellOf(b, w)), [20, 21, 22, 23]);
  assert.equal(cellOf(b, 'PIKE'), 4);
  assert.equal(new Set(b.tiles.map(t => t.cell)).size, 16);
});

test('snapGroup clamps at canvas end', () => {
  const b = canvas();
  Object.assign(b.tiles[0], cellXY(27, C));
  snapGroup(b, [0, 1, 2, 3], 0, C);
  assert.deepEqual(['SOLE', 'SHIFT', 'CHECK', 'HEEL'].map(w => cellOf(b, w)), [24, 25, 26, 27]);
});

test('enableSnap on canvas keeps tiles near where they were', () => {
  const b = canvas();
  disableSnap(b);
  Object.assign(b.tiles[0], { x: 115, y: 560 }); // SOLE parked near cell 21
  b.tiles[1].x += 20;                            // SHIFT nudged, still nearest cell 1
  enableSnap(b, C);
  assert.equal(cellOf(b, 'SOLE'), 21);
  assert.equal(cellOf(b, 'SHIFT'), 1);
  assert.equal(new Set(b.tiles.map(t => t.cell)).size, 16);
});

test('enableSnap resolves two tiles over one cell to the nearest free cell', () => {
  const b = canvas();
  disableSnap(b);
  Object.assign(b.tiles[0], cellXY(5, C)); // SOLE dropped exactly on RAISE
  enableSnap(b, C);
  assert.equal(cellOf(b, 'SOLE'), 5);  // ties keep id order, so SOLE claims the cell first
  assert.equal(cellOf(b, 'RAISE'), 0); // nearest free cell is the one SOLE left
});

test('rescale in snap mode re-homes tiles whose cell no longer exists', () => {
  const b = canvas();
  Object.assign(b.tiles[0], cellXY(27, C));
  snapSingle(b, 0, C);
  const small = { tileW: 100, tileH: 100, gap: 10, rows: 5 };
  rescale(b, C, small);
  assert.ok(b.tiles.every(t => t.cell < 20));
  assert.equal(new Set(b.tiles.map(t => t.cell)).size, 16);
});

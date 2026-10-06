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

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

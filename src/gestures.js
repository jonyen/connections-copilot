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
    if (proposed()) {
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

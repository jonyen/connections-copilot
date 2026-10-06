export const COLS = 4;
export const ROWS = 4; // starting grid; a canvas passes more rows in metrics as m.rows
export const COLOR_COUNT = 5; // 0 = uncolored, 1–4 = group colors

export function createBoard(words) {
  if (words.length !== COLS * ROWS) throw new Error(`need ${COLS * ROWS} words`);
  return {
    snap: true,
    tiles: words.map((word, i) => ({ id: i, word, cell: i, x: 0, y: 0, color: 0, selected: false })),
  };
}

const rowsOf = m => m.rows ?? ROWS;
export const totalCells = m => COLS * rowsOf(m);

export function cellXY(cell, m) {
  return { x: (cell % COLS) * (m.tileW + m.gap), y: Math.floor(cell / COLS) * (m.tileH + m.gap) };
}

export function cellAt(x, y, m) {
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  const col = clamp(Math.round(x / (m.tileW + m.gap)), COLS - 1);
  const row = clamp(Math.round(y / (m.tileH + m.gap)), rowsOf(m) - 1);
  return row * COLS + col;
}

export function boardSize(m) {
  return { w: COLS * m.tileW + (COLS - 1) * m.gap, h: rowsOf(m) * m.tileH + (rowsOf(m) - 1) * m.gap };
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
  const start = Math.max(0, Math.min(totalCells(m) - n, cellAt(anchor.x, anchor.y, m) - anchorIndex));
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

// Every tile first claims the cell under it (reading order breaks ties); tiles
// that lost a tie then take the nearest cell still free.
export function enableSnap(board, m) {
  const pitch = m.tileH + m.gap;
  const order = [...board.tiles].sort(
    (a, b) => (Math.round(a.y / pitch) - Math.round(b.y / pitch)) || (a.x - b.x));
  const taken = new Set();
  const losers = [];
  for (const t of order) {
    const c = cellAt(t.x, t.y, m);
    if (taken.has(c)) losers.push(t);
    else { taken.add(c); t.cell = c; }
  }
  for (const t of losers) {
    let best = -1, bestD = Infinity;
    for (let c = 0; c < totalCells(m); c++) {
      if (taken.has(c)) continue;
      const p = cellXY(c, m);
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    taken.add(best);
    t.cell = best;
  }
  board.snap = true;
  placeAll(board, m);
}

export function disableSnap(board) {
  board.snap = false;
  for (const t of board.tiles) t.cell = null;
}

export function rescale(board, from, to) {
  const outOfRange = board.tiles.some(t => t.cell !== null && t.cell >= totalCells(to));
  if (board.snap && !outOfRange) return placeAll(board, to);
  const sx = (to.tileW + to.gap) / (from.tileW + from.gap);
  const sy = (to.tileH + to.gap) / (from.tileH + from.gap);
  for (const t of board.tiles) { t.x *= sx; t.y *= sy; }
  if (board.snap) enableSnap(board, to); // canvas shrank below some tiles' cells
}

export function tilesInRect(board, r, m) {
  return board.tiles
    .filter(t => t.x < r.x + r.w && t.x + m.tileW > r.x && t.y < r.y + r.h && t.y + m.tileH > r.y)
    .map(t => t.id);
}

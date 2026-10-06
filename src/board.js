export const COLS = 4;
export const ROWS = 4;
// COLS x ROWS is the starting grid. A canvas passes its real grid in metrics:
// m.cols, m.rows, m.offsetX (grid inset from the canvas edge), m.canvasW, m.canvasH.
export const COLOR_COUNT = 5; // 0 = uncolored, 1–4 = group colors

export function createBoard(words) {
  if (words.length !== COLS * ROWS) throw new Error(`need ${COLS * ROWS} words`);
  return {
    snap: true,
    tiles: words.map((word, i) => ({ id: i, word, cell: i, x: 0, y: 0, color: 0, selected: false })),
  };
}

const rowsOf = m => m.rows ?? ROWS;
const colsOf = m => m.cols ?? COLS;
const offsetOf = m => m.offsetX ?? 0;
export const totalCells = m => colsOf(m) * rowsOf(m);

export function cellXY(cell, m) {
  const cols = colsOf(m);
  return { x: offsetOf(m) + (cell % cols) * (m.tileW + m.gap), y: Math.floor(cell / cols) * (m.tileH + m.gap) };
}

export function cellAt(x, y, m) {
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  const col = clamp(Math.round((x - offsetOf(m)) / (m.tileW + m.gap)), colsOf(m) - 1);
  const row = clamp(Math.round(y / (m.tileH + m.gap)), rowsOf(m) - 1);
  return row * colsOf(m) + col;
}

export function boardSize(m) {
  return {
    w: m.canvasW ?? colsOf(m) * m.tileW + (colsOf(m) - 1) * m.gap,
    h: m.canvasH ?? rowsOf(m) * m.tileH + (rowsOf(m) - 1) * m.gap,
  };
}

// Lay the 16 tiles out as a 4x4 centered in the canvas grid.
export function placeStart(board, m) {
  const cols = colsOf(m);
  const startCol = Math.floor((cols - COLS) / 2);
  for (const t of board.tiles) t.cell = Math.floor(t.id / COLS) * cols + startCol + (t.id % COLS);
  placeAll(board, m);
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

// The group keeps its shape: every tile moves by the row/column offset the dragged
// tile moved, clamped so the whole shape stays on the grid. Tiles already sitting in
// the target cells move into the cells the group left, in reading order.
export function snapGroup(board, ids, anchorId, m) {
  const cols = colsOf(m), rows = rowsOf(m);
  const rc = cell => ({ r: Math.floor(cell / cols), c: cell % cols });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const group = ids.map(id => board.tiles[id]);
  const anchor = board.tiles[anchorId];
  const from = rc(anchor.cell), to = rc(cellAt(anchor.x, anchor.y, m));
  const pos = group.map(t => rc(t.cell));
  const dr = clamp(to.r - from.r, -Math.min(...pos.map(p => p.r)), rows - 1 - Math.max(...pos.map(p => p.r)));
  const dc = clamp(to.c - from.c, -Math.min(...pos.map(p => p.c)), cols - 1 - Math.max(...pos.map(p => p.c)));
  const targets = pos.map(p => (p.r + dr) * cols + p.c + dc);
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
  const sameGrid = colsOf(from) === colsOf(to) &&
    !board.tiles.some(t => t.cell !== null && t.cell >= totalCells(to));
  if (board.snap && sameGrid) return placeAll(board, to);
  const sx = (to.tileW + to.gap) / (from.tileW + from.gap);
  const sy = (to.tileH + to.gap) / (from.tileH + from.gap);
  const { w, h } = boardSize(to);
  for (const t of board.tiles) {
    t.x = Math.max(0, Math.min(w - to.tileW, offsetOf(to) + (t.x - offsetOf(from)) * sx));
    t.y = Math.max(0, Math.min(h - to.tileH, t.y * sy));
  }
  if (board.snap) enableSnap(board, to); // grid changed shape; re-home by position
}

export function tilesInRect(board, r, m) {
  return board.tiles
    .filter(t => t.x < r.x + r.w && t.x + m.tileW > r.x && t.y < r.y + r.h && t.y + m.tileH > r.y)
    .map(t => t.id);
}

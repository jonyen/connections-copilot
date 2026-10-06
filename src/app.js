import {
  createBoard, boardSize, placeAll, placeStart, selectedIds, setSelected, clearSelection, cycleColor,
  moveTiles, snapSingle, snapGroup, enableSnap, disableSnap, rescale, tilesInRect,
} from './board.js';
import { createGestures } from './gestures.js';
import { loadPuzzle, puzzleLabel } from './puzzle.js';

const SAMPLE_WORDS = ['SOLE', 'SHIFT', 'CHECK', 'HEEL', 'PIKE', 'RAISE', 'TONGUE', 'ENTER',
  'FOLD', 'CARP', 'LACE', 'ESCAPE', 'TAB', 'CALL', 'PERCH', 'EYELET'];
let words = SAMPLE_WORDS;
let puzzle = null;   // today's puzzle once loaded
let touched = false; // user has changed the board since the last build
const GAP = 8;
const MAX_TILE = 110; // px; keeps desktop tiles near phone size so the canvas has room
const MIN_ROWS = 6;   // at least two empty rows below the starting 4x4 for parking groups

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
  const cs = getComputedStyle(stageEl);
  const availW = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const byWidth = (availW - GAP * 3) / 4;
  const byHeight = (availH - GAP * (MIN_ROWS - 1)) / MIN_ROWS;
  const tile = Math.max(48, Math.floor(Math.min(byWidth, byHeight, MAX_TILE)));
  const rows = Math.max(4, Math.floor((availH + GAP) / (tile + GAP)));
  const cols = Math.max(4, Math.floor((availW + GAP) / (tile + GAP)));
  const gridW = cols * tile + (cols - 1) * GAP;
  // The canvas is the whole stage; the snap grid fills it, centered horizontally.
  return { tileW: tile, tileH: tile, gap: GAP, rows, cols,
    offsetX: Math.floor((availW - gridW) / 2), canvasW: availW, canvasH: availH };
}

// One font size for every tile, like NYT Connections: the size the longest word
// (by measured width in the tile font) needs to fit on one line.
const measureCtx = document.createElement('canvas').getContext('2d');
function boardFontSize(words) {
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-display');
  measureCtx.font = `700 100px ${family}`;
  const widest = Math.max(...words.map(w => measureCtx.measureText(w.toUpperCase()).width));
  return Math.max(9, Math.min(m.tileW * 0.18, (m.tileW - 14) * 100 / widest));
}

function build() {
  board = createBoard(words);
  touched = false;
  setLabel('');
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
  placeStart(board, m);
  if (!snapEl.checked) disableSnap(board);
  render();
}

function render() {
  const { w, h } = boardSize(m);
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  boardEl.style.fontSize = `${boardFontSize(board.tiles.map(t => t.word))}px`;
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
    if (i.type !== 'armLongPress') touched = true;
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

const aboutEl = document.getElementById('about');
document.getElementById('about-btn').addEventListener('click', () => aboutEl.showModal());
function markSeen() {
  try { localStorage.setItem('seenAbout', '1'); } catch { /* storage blocked */ }
}
document.getElementById('about-close').addEventListener('click', () => { markSeen(); aboutEl.close(); });
aboutEl.addEventListener('close', markSeen); // Esc closes without the button
let seen = false;
try { seen = localStorage.getItem('seenAbout') === '1'; } catch { /* storage blocked */ }
if (!seen) aboutEl.showModal();
window.addEventListener('resize', () => {
  const next = metrics();
  rescale(board, m, next);
  m = next;
  render();
});

build();
document.fonts?.ready.then(render); // re-fit words once the web font has loaded
function setLabel(suffix) {
  document.getElementById('puzzle-label').textContent =
    puzzle ? puzzleLabel(puzzle) + suffix : 'Sample board';
}

loadPuzzle().then(p => {
  if (!p) return;
  puzzle = p;
  words = p.words;
  // Never rebuild under the user: once they've touched the board, Reset loads the puzzle.
  if (touched || gestures.state !== 'idle') setLabel(' · Reset to load');
  else build();
});

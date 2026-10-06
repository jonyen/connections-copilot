# Swipe-select for Connections Copilot — design

Date: 2026-10-06
Status: draft for review

## Purpose

Pitch an enhancement to the developer of connections-copilot.com (a third-party
NYT Connections planner; we do not own it and its source is not public). The
deliverable is an interactive prototype page the developer can try in about
10 seconds and feel the improvement, sent to them as a link.

Success: the developer opens the link on a phone or desktop, selects several
tiles in one gesture, moves or colors them together, and compares that with
the current one-tile-at-a-time behavior without leaving the page.

## What the current site does (observed 2026-10-06)

- 16 word tiles, each dragged individually (interact.js `draggable`).
- Free placement, or optional snap-to-grid (setting).
- Tap a tile to cycle its color.
- Mobile-first: installable PWA, touch defaults suppressed.

## Proposal

### Gestures

| Gesture | Input | Result |
|---|---|---|
| Tap tile | any | Cycle color (unchanged). If the tile is selected, cycle color of the whole selection. |
| Press + move immediately | any | Drag one tile (unchanged), unless the tile is selected — then drag the whole selection. |
| Long-press tile (~300 ms, < 8 px movement) | touch, pen, mouse | Enter sweep: tile lifts, `navigator.vibrate(10)` where supported, tile joins selection. Sliding over other tiles adds them. Release ends the sweep; selection stays. |
| Press on empty board + drag | mouse, pen | Rectangle (marquee); tiles intersecting it are selected on release. Shift adds to the existing selection. |
| Tap empty board | any | Clear selection. |
| `Esc` | keyboard | Clear selection. |

The board sits inside a stage with 20 px of padding on every side. With
snap-to-grid on, the grid is full, so the padding is where a mouse marquee
starts.

Touch does not get a marquee: on a phone the board has little empty space, so
a touch drag on empty board space does nothing, as today.

### Group drag

Dragging any selected tile moves every selected tile by the same delta,
preserving relative layout. With snap-to-grid on, on release the selection is
laid out in reading order into consecutive grid cells, positioned so the dragged
tile lands in the cell under it (clamped so the run fits in the 16 cells).
Tiles displaced from those cells move into the vacated cells, in reading order.

### Selected-state visuals

Selected tiles get a 3 px outline and slight lift (shadow + `scale(1.04)`), on
top of their existing color. A small counter chip ("3 selected") appears above
the board while a selection exists.

## Prototype page

Single static `index.html`, no build step, published as a private Claude
Artifact (shareable link).

Layout, top to bottom:
1. Heading "Proposal: swipe-select for Connections Copilot" and a line stating
   it is an unofficial prototype, not affiliated with the site or NYT.
2. Three-line pitch: the problem (four drags per group, sixteen per puzzle),
   the change, and that existing gestures are unchanged.
3. Mode toggle: **Current** / **Proposed**. Current disables long-press sweep,
   marquee and group drag, leaving only single drag and tap-to-color.
4. Snap-to-grid toggle (default on, matching the site's common use).
5. Board: 4×4 tiles of the day's NYT Connections words in NYT's starting
   positions (see "Today's puzzle"), falling back to invented sample words, plus
   a Reset button. A label above the board names the puzzle ("Connections #1316
   · Oct 6") or says "Sample board".
6. Short gesture legend under the board.

Branding: own neutral styling; does not use Connections Copilot's logo, name in
a logo treatment, or NYT marks. Light and dark themes.

## Architecture

Vanilla JS with Pointer Events, no interact.js, so one code path covers mouse,
touch and pen. Units inside the single file:

- `board` — tile model: `{id, word, x, y, color, selected}`; grid math
  (cell ⇄ coordinates, reading-order layout).
- `gestures` — pointer state machine: `idle → pressing → (dragging | sweeping |
  marquee) → idle`. Emits intents (`tap`, `drag`, `sweepAdd`, `marquee`,
  `clear`); knows nothing about rendering.
- `render` — applies model to DOM via `transform`; draws marquee rectangle and
  counter chip.
- `mode` — Current/Proposed flag gating which intents `gestures` may emit.

Touch: `touch-action: none` on the board only, so the page outside it still
scrolls. Long-press timer cancelled by movement > 8 px or `pointercancel`.
`contextmenu` and text selection suppressed on tiles.

## Error handling / edge cases

- `pointercancel` (incoming call, system gesture): end the gesture, keep the
  selection, return dragged tiles to last committed position.
- Multi-touch: only the first pointer is tracked; others are ignored.
- Dragging a selection off the board clamps to board bounds.
- Window resize or rotation: recompute grid, re-snap if snap is on.
- No `navigator.vibrate` (iOS Safari): silently skip.

## Testing

Playwright script (Chromium, desktop and `hasTouch` iPhone-sized context)
asserting:
- tap cycles one tile's color; tap on a selected tile cycles all selected;
- long-press + sweep across 4 tiles selects exactly those 4;
- quick press-and-move drags one tile and selects nothing;
- marquee over 4 tiles selects them (mouse only);
- group drag moves all selected tiles with snap-to-grid on and off;
- Current mode: long-press and marquee select nothing.

Plus one manual check on a real iPhone (Safari) before sending the link, since
iOS long-press and vibration behavior can't be fully emulated.

## Today's puzzle

NYT serves `https://www.nytimes.com/svc/connections/v2/YYYY-MM-DD.json` without
CORS headers, and Artifact pages cannot fetch arbitrary origins, so the page
cannot fetch it live.

- `scripts/fetch-puzzle.mjs` computes today's date in `America/New_York`, fetches
  that JSON, and writes `puzzle.json` = `{id, date, words}` with `words` being the
  16 card contents ordered by their `position` (0–15). Category titles and
  groupings are dropped: the demo must not reveal answers. On HTTP error or
  invalid data it exits non-zero and leaves any existing `puzzle.json` untouched.
- The page fetches `puzzle.json` from its own origin. Missing or invalid file →
  invented sample board; the page never fails to render.
- Freshness: run the script and republish before sending the link. A scheduled
  daily republish is deferred.
- `puzzle.json` is generated, not committed.

## Out of scope

- Patching or forking the real site.
- Sending the email to the developer (the user sends it).
- Persistence, sports edition, live in-page puzzle fetching, scheduled republish.

## Deployment (added 2026-10-06)

Hosted at `https://connections.jonyen.com` (user chose a neutral hostname over
`nytconnections`), replacing the Artifact publish. Cloudflare Worker `connections`:
static assets from `dist/` (only `index.html` and `src/`, built by
`npm run build`), plus a live `/puzzle.json` route that fetches today's NYT
puzzle (Eastern date), strips it to `{id, date, words}`, and caches it at the
edge keyed by date. NYT failure returns 503 and the page shows the sample board.
`scripts/fetch-puzzle.mjs` remains for offline/local use. Deploy: `npm run deploy`.

## Canvas layout (revised 2026-10-06)

Supersedes the boxed 4×4 board and the always-visible pitch, at the user's
request to match Connections Copilot's canvas:
- Full-screen app: slim top bar (puzzle label, Current/Proposed, Snap, Reset, ⓘ);
  everything below is the canvas. The pitch and gesture legend live in a dialog,
  shown once on first visit (remembered in localStorage) and reopened with ⓘ.
- Square tiles, four across, at most 110 px; the starting 4×4 sits at the top and
  the grid continues down the canvas (at least 6 rows), leaving empty cells to park
  groups in. Free drag is bounded by the canvas.
- Snap starts off. With snap on, a single tile drops into the nearest cell
  (swapping with an occupant), a group into consecutive cells; turning snap on
  sends tiles to the cell under them, collisions to the nearest free cell.
- Rectangle select now works with touch too, starting on empty canvas.
- Words are sized to fit one line using the tile font's measured width.
- (2026-10-06) The canvas spans the full window width, not a 4-column strip: the
  snap grid has as many columns as fit, centered, and the starting 4×4 is centered
  in it. Free drag is bounded by the whole stage.
- (2026-10-06) Group snap keeps the selection's shape: every tile shifts by the
  dragged tile's row/column offset, clamped so the shape stays on the grid
  (supersedes "consecutive cells in reading order").

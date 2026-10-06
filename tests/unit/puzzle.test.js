import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { easternDate, parsePuzzle, validPuzzleFile, loadPuzzle, puzzleLabel } from '../../src/puzzle.js';

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/nyt-sample.json', import.meta.url)));

test('easternDate uses America/New_York', () => {
  assert.equal(easternDate(new Date('2026-10-06T03:30:00Z')), '2026-10-05'); // 23:30 EDT
  assert.equal(easternDate(new Date('2026-10-06T04:30:00Z')), '2026-10-06'); // 00:30 EDT
  assert.equal(easternDate(new Date('2026-01-15T04:30:00Z')), '2026-01-14'); // 23:30 EST
});

test('parsePuzzle orders words by position and drops answers', () => {
  const p = parsePuzzle(fixture());
  assert.deepEqual(p, {
    id: 999, date: '2026-01-02',
    words: ['PIKE', 'HEEL', 'SHIFT', 'SOLE', 'CHECK', 'ENTER', 'TONGUE', 'RAISE',
      'FOLD', 'CARP', 'ESCAPE', 'CALL', 'LACE', 'TAB', 'PERCH', 'EYELET'],
  });
  assert.equal(JSON.stringify(p).includes('FISH'), false);
});

test('parsePuzzle rejects bad data', () => {
  const dup = fixture(); dup.categories[0].cards[0].position = 0;
  assert.throws(() => parsePuzzle(dup), /position/);
  const short = fixture(); short.categories.pop();
  assert.throws(() => parsePuzzle(short), /16/);
  const blank = fixture(); blank.categories[0].cards[0].content = ' ';
  assert.throws(() => parsePuzzle(blank), /content/);
  assert.throws(() => parsePuzzle({ status: 'ERROR' }), /status/);
});

test('validPuzzleFile', () => {
  assert.equal(validPuzzleFile(parsePuzzle(fixture())), true);
  assert.equal(validPuzzleFile({ id: 1, date: '2026-01-02', words: ['A'] }), false);
  assert.equal(validPuzzleFile(null), false);
});

test('loadPuzzle returns parsed file, or null on any failure', async () => {
  const good = parsePuzzle(fixture());
  const ok = async () => ({ ok: true, json: async () => good });
  assert.deepEqual(await loadPuzzle(ok), good);
  assert.equal(await loadPuzzle(async () => ({ ok: false, json: async () => good })), null);
  assert.equal(await loadPuzzle(async () => { throw new TypeError('offline'); }), null);
  assert.equal(await loadPuzzle(async () => ({ ok: true, json: async () => ({ words: [] }) })), null);
  assert.equal(await loadPuzzle(async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })), null);
});

test('puzzleLabel', () => {
  assert.equal(puzzleLabel({ id: 1316, date: '2026-10-06' }), 'Connections #1316 · Oct 6');
});

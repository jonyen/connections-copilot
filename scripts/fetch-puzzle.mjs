#!/usr/bin/env node
// Writes puzzle.json (id, date, 16 words in NYT starting order) for today's
// NYT Connections, Eastern time. Answers are not written. Usage:
//   node scripts/fetch-puzzle.mjs [YYYY-MM-DD]
import { writeFileSync, renameSync } from 'node:fs';
import { easternDate, parsePuzzle } from '../src/puzzle.js';

const date = process.argv[2] ?? easternDate();
const url = `https://www.nytimes.com/svc/connections/v2/${date}.json`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`fetch ${url}: HTTP ${res.status}`);
  process.exit(1);
}
let puzzle;
try {
  puzzle = parsePuzzle(await res.json());
} catch (err) {
  console.error(`invalid puzzle from ${url}: ${err.message}`);
  process.exit(1);
}
const out = new URL('../puzzle.json', import.meta.url);
const tmp = new URL('../puzzle.json.tmp', import.meta.url);
writeFileSync(tmp, JSON.stringify(puzzle, null, 2) + '\n');
renameSync(tmp, out);
console.log(`wrote puzzle.json: #${puzzle.id} ${puzzle.date}`);

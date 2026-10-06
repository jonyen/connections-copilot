import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puzzleResponse } from '../../worker/index.js';

const nyt = () => JSON.parse(readFileSync(new URL('../fixtures/nyt-sample.json', import.meta.url)));
const NOW = new Date('2026-10-06T16:00:00Z'); // noon EDT

function fakeCache() {
  const store = new Map();
  return {
    store,
    match: async req => store.get(req.url)?.clone(),
    put: async (req, res) => { store.set(req.url, res); },
  };
}
function fakeFetch(respond) {
  const calls = [];
  const fn = async url => { calls.push(url); return respond(url); };
  fn.calls = calls;
  return fn;
}

test('fetches today (Eastern) from NYT, returns words only, caches by date', async () => {
  const cache = fakeCache();
  const fetchFn = fakeFetch(() => Response.json(nyt()));
  const res = await puzzleResponse({ fetchFn, cache, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(fetchFn.calls, ['https://www.nytimes.com/svc/connections/v2/2026-10-06.json']);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['id', 'date', 'words']);
  assert.equal(body.words.length, 16);
  assert.equal(JSON.stringify(body).includes('FISH'), false);
  assert.match(res.headers.get('cache-control'), /max-age=300/);

  const again = await puzzleResponse({ fetchFn, cache, now: NOW });
  assert.equal(again.status, 200);
  assert.equal(fetchFn.calls.length, 1, 'second call served from cache');
  assert.deepEqual(await again.json(), body);
});

test('new Eastern day misses the cache', async () => {
  const cache = fakeCache();
  const fetchFn = fakeFetch(() => Response.json(nyt()));
  await puzzleResponse({ fetchFn, cache, now: NOW });
  await puzzleResponse({ fetchFn, cache, now: new Date('2026-10-07T05:00:00Z') }); // 01:00 EDT Oct 7
  assert.equal(fetchFn.calls[1], 'https://www.nytimes.com/svc/connections/v2/2026-10-07.json');
});

test('NYT error → 503, not cached', async () => {
  const cache = fakeCache();
  const fetchFn = fakeFetch(() => new Response('nope', { status: 403 }));
  const res = await puzzleResponse({ fetchFn, cache, now: NOW });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(cache.store.size, 0);
});

test('invalid NYT data or network failure → 503', async () => {
  const bad = await puzzleResponse({ fetchFn: fakeFetch(() => Response.json({ status: 'OK', categories: [] })), cache: fakeCache(), now: NOW });
  assert.equal(bad.status, 503);
  const down = await puzzleResponse({ fetchFn: async () => { throw new TypeError('network'); }, cache: fakeCache(), now: NOW });
  assert.equal(down.status, 503);
});

// Serves the static prototype (dist/) and a live /puzzle.json built from
// today's NYT Connections. Only words and their starting order are returned;
// category titles and groupings never leave this Worker.
import { easternDate, parsePuzzle } from '../src/puzzle.js';

const CACHE_ORIGIN = 'https://connections.jonyen.com/_puzzle/';

function json(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl },
  });
}

export async function puzzleResponse({ fetchFn = fetch, cache, now = new Date() } = {}) {
  const date = easternDate(now);
  const key = new Request(`${CACHE_ORIGIN}${date}.json`);
  const hit = cache && await cache.match(key);
  if (hit) return hit;

  let puzzle;
  try {
    const res = await fetchFn(`https://www.nytimes.com/svc/connections/v2/${date}.json`);
    if (!res.ok) throw new Error(`NYT HTTP ${res.status}`);
    puzzle = parsePuzzle(await res.json());
  } catch (err) {
    console.error(`puzzle ${date}: ${err.message}`);
    return json({ error: 'Today\'s puzzle is unavailable.' }, 503, 'no-store');
  }
  // The cache key carries the date, so a long edge TTL never serves yesterday's board.
  const out = json(puzzle, 200, 'public, max-age=300, s-maxage=86400');
  if (cache) await cache.put(key, out.clone());
  return out;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/puzzle.json') {
      return puzzleResponse({ cache: caches.default });
    }
    return env.ASSETS.fetch(request);
  },
};

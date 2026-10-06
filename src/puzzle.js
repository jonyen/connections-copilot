const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function parsePuzzle(nyt) {
  if (nyt?.status !== 'OK') throw new Error(`bad status: ${nyt?.status}`);
  const cards = (nyt.categories ?? []).flatMap(c => c.cards ?? []);
  if (cards.length !== 16) throw new Error(`expected 16 cards, got ${cards.length}`);
  const words = new Array(16);
  for (const c of cards) {
    if (typeof c.content !== 'string' || !c.content.trim()) throw new Error('empty card content');
    if (!Number.isInteger(c.position) || c.position < 0 || c.position > 15 || words[c.position]) {
      throw new Error(`bad or duplicate position: ${c.position}`);
    }
    words[c.position] = c.content.trim().toUpperCase();
  }
  if (!Number.isInteger(nyt.id) || !DATE_RE.test(nyt.print_date)) throw new Error('bad id or date');
  return { id: nyt.id, date: nyt.print_date, words };
}

export function validPuzzleFile(p) {
  return !!p && Number.isInteger(p.id) && DATE_RE.test(p.date) && Array.isArray(p.words) &&
    p.words.length === 16 && p.words.every(w => typeof w === 'string' && w.trim() !== '');
}

export async function loadPuzzle(fetchFn = fetch, url = 'puzzle.json') {
  try {
    const res = await fetchFn(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const p = await res.json();
    return validPuzzleFile(p) ? p : null;
  } catch {
    return null;
  }
}

export function puzzleLabel(p) {
  const d = new Date(`${p.date}T12:00:00Z`);
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Connections #${p.id} · ${md}`;
}

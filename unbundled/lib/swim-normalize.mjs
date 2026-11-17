// The stored shape of synthesis without meta-analysis (lib/swim-state.mjs describes it), put right on load. Apart from swim-state so the
// store reads it without the appraisal readers the rest of swim-state needs (the start-up graph, app/test/startup-graph.test.mjs).
import { DIRECTIONS, SWIM_ITEMS } from './swim-core.mjs';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const WEIGHTS = ['n', 'rob', 'equal'];

/** The stored shape, with anything malformed dropped. */
export function normalizeSwim(v) {
  const src = plain(v) ? v : {};
  const seen = new Set();
  const outcomes = (Array.isArray(src.outcomes) ? src.outcomes : [])
    .filter(o => plain(o) && typeof o.id === 'string' && o.id && !seen.has(o.id) && seen.add(o.id))
    .map(o => ({ id: o.id, name: String(o.name ?? ''), ...(typeof o.outcomeId === 'string' && o.outcomeId ? { outcomeId: o.outcomeId } : {}) }));   // outcomeId: lib/outcome-links.mjs
  const cells = {};
  for (const [pid, row] of Object.entries(plain(src.cells) ? src.cells : {})) {
    if (!plain(row)) continue;
    const kept = Object.fromEntries(Object.entries(row).filter(([oid, d]) => seen.has(oid) && DIRECTIONS.includes(d)));
    if (Object.keys(kept).length) cells[pid] = kept;
  }
  const n = Object.fromEntries(Object.entries(plain(src.n) ? src.n : {}).filter(([, x]) => String(x ?? '').trim() !== '').map(([k, x]) => [k, String(x).trim()]));
  const ids = new Set(SWIM_ITEMS.map(i => i.id));
  const items = Object.fromEntries(Object.entries(plain(src.items) ? src.items : {}).filter(([k, x]) => ids.has(k) && typeof x === 'string' && x.trim()));
  return { outcomes, cells, n, items, weight: WEIGHTS.includes(src.weight) ? src.weight : '' };
}

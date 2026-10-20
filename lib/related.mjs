// Related-article expansion from PubMed (ELink, neighbor_score): the articles
// PubMed's own similarity ranking puts next to each seed. It is an exploration,
// not a protocol search: the log entry is marked exploratory, so PRISMA's
// records identified leave it out, and a record found this way says so.
//
// Only PMIDs go to PubMed. For each seed the `top` best neighbours are kept; a
// candidate is ranked by how many seeds list it, then by its best score.
import { pubmedRelated, pubmedXml } from './sources.mjs';
import { parseRecords } from './bib.mjs';
import { addSearchRecords, libraryRecord } from './search-library.mjs';
import { against } from './citation-chase.mjs';

export const SOURCE = 'Related articles';
export const TOP = 20;

/** Ranks candidates over the seeds' neighbour lists. `lists` is a Map of seed PMID -> [{ id, score }]. */
export function rankNeighbours(lists, seedPmids = []) {
  const skip = new Set(seedPmids.map(String));
  const by = new Map();
  for (const [seed, list] of lists) for (const { id, score } of list) {
    if (skip.has(id)) continue;
    if (!by.has(id)) by.set(id, { pmid: id, seeds: new Set(), best: 0 });
    const c = by.get(id); c.seeds.add(seed); c.best = Math.max(c.best, score);
  }
  return [...by.values()].map(c => ({ pmid: c.pmid, links: c.seeds.size, seeds: [...c.seeds], best: c.best }))
    .sort((a, b) => b.links - a.links || b.best - a.best || Number(a.pmid) - Number(b.pmid));
}

/**
 * The related articles of seed PMIDs. `limit` bounds how many candidates are
 * read in full (100 per request). Answers `{ seeds, retrieved, candidates }`
 * with each candidate `{ id, pmid, record, links, seeds, best }`.
 */
export async function related(pmids, { settings, signal, top = TOP, limit = 300, onProgress = () => {} } = {}) {
  const list = [...new Set(pmids.map(String).filter(Boolean))];
  const lists = await pubmedRelated(list, { settings, signal, top, onProgress: (d, n) => onProgress(`Related articles ${d} of ${n} seeds`) });
  const ranked = rankNeighbours(lists, list);
  const take = ranked.slice(0, limit);
  const records = new Map();
  if (take.length) for (const r of parseRecords(await pubmedXml(take.map(c => c.pmid), { settings, signal, onProgress: (d, n) => onProgress(`Reading ${d} of ${n} candidates`) }), 'pubmed.xml').records) records.set(String(r.pmid), r);
  const candidates = take.filter(c => records.has(c.pmid)).map(c => ({ id: `pmid-${c.pmid}`, pmid: c.pmid, record: { ...libraryRecord(records.get(c.pmid)), source: SOURCE }, links: c.links, seeds: c.seeds, best: c.best }));
  return { seeds: list.length, retrieved: ranked.length, read: candidates.length, candidates };
}

export { against };

/** Adds accepted candidates and logs the expansion as an exploratory run. */
export function acceptRelated(state, found, pickedIds, { destination = '', at = new Date().toISOString() } = {}) {
  const held = new Map((found.candidates || []).map(c => [c.id, c]));
  const picked = pickedIds.map(id => held.get(id)).filter(Boolean);
  const before = (state.papers || []).length;
  addSearchRecords(state, picked.map(c => ({ ...c.record, searchRun: at, isNew: true, foundBy: 'related', foundAt: at })), destination);
  const fresh = (found.candidates || []).filter(c => !c.inLibrary).length;
  state.searches = [...(state.searches || []), { at, source: SOURCE, kind: 'other', related: true, exploratory: true, dataSource: 'PubMed', seeds: found.seeds,
    query: `Related articles of ${found.seeds} ${found.seeds === 1 ? 'study' : 'studies'} (PubMed neighbours)`, total: found.retrieved, retrieved: found.read, new: fresh, added: (state.papers || []).length - before, status: 'complete' }];
  return (state.papers || []).length - before;
}

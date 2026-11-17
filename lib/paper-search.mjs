// The text filter of the library and the extraction tables: which papers a typed query finds. Apart from paging.mjs so the shell does not carry it.
import { foldSearch } from './search-ranking.mjs';
import { matchTerms, loosenTerms } from './record-index.mjs';

let smart = null;   // lib/search-smart.mjs: stems and a typing slip, tried when the exact pass finds nothing
import('./search-smart.mjs').then(m => { smart = m; }, () => {});

// The live project's records are found through its word index (lib/record-index.mjs: 26,262 records in 4 to 9 ms a query and 5.4 to 6.7 MB,
// where their folded text took 49 to 69 ms and 18.7 to 20.9 MB, 14 Nov 2026). Any other list (a tool's, a test's, a caller's own text) reads each record's
// folded text, kept on the record and checked against the fields it is made of (records are edited in place).
const hayCache = new WeakMap();
const ownHay = p => {
  const parts = [p.label, p.title, p.journal, p.year, p.doi, p.pmid, ...(Array.isArray(p.authors) ? p.authors : [p.authors])].join(' ');
  const hit = hayCache.get(p);
  if (hit && hit.parts === parts) return hit.hay;
  const hay = foldSearch(parts); hayCache.set(p, { parts, hay }); return hay;
};

/** Filters by a query across the fields a person would search on; accents, ı and İ do not matter. `extraHay(paper)` adds the caller's text. */
export function filterPapers(papers, query, extraHay = null) {
  const q = foldSearch(String(query || '')).trim();
  if (!q) return papers;
  const terms = q.split(/\s+/);
  const found = extraHay ? null : matchTerms(papers, terms);
  if (found) return found.length || !smart || terms.every(t => t.length < 4) ? found
    : loosenTerms(papers, terms, smart);
  const hays = new Map(papers.map(p => [p, extraHay ? `${ownHay(p)} ${foldSearch(String(extraHay(p) ?? ''))}` : ownHay(p)]));
  const exact = papers.filter(p => terms.every(t => hays.get(p).includes(t)));
  // the loose pass (stems, a typing slip) reads every word of every record: tried once a term is long enough to mean something
  return exact.length || !smart || terms.every(t => t.length < 4) ? exact : smart.loosen(papers, hays, terms);
}

/** How long a search waits after the last key (the Library's FILTER_DELAY, views/library.mjs). */
export const SEARCH_DELAY = 120;
/** `fn` run once typing pauses for `delay` ms, with the last call's arguments. */
export function whenTypingPauses(fn, delay = SEARCH_DELAY) {
  let timer = 0;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

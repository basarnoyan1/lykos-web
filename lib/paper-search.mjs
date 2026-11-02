// The text filter of the library and the extraction tables: which papers a typed query finds. Apart from paging.mjs so the shell does not carry it.
import { lib_search_ranking$foldSearch as foldSearch } from "../boot.mjs";

let smart = null;   // lib/search-smart.mjs: stems and a typing slip, tried when the exact pass finds nothing
import('./search-smart.mjs').then(m => { smart = m; }, () => {});

// Each record's folded text, kept on the record and checked against the fields it is made of (records are edited in place): a query over 26,000
// records folded every one of them on each keystroke (about a quarter of a second).
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
  const terms = q.split(/\s+/), hays = new Map(papers.map(p => [p, extraHay ? `${ownHay(p)} ${foldSearch(String(extraHay(p) ?? ''))}` : ownHay(p)]));
  const exact = papers.filter(p => terms.every(t => hays.get(p).includes(t)));
  // the loose pass (stems, a typing slip) reads every word of every record: tried once a term is long enough to mean something
  return exact.length || !smart || terms.every(t => t.length < 4) ? exact : smart.loosen(papers, hays, terms);
}

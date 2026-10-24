// The text filter of the library and the extraction tables: which papers a typed query finds. Apart from paging.mjs so the shell does not carry it.
import { foldSearch } from './search-ranking.mjs';

let smart = null;   // lib/search-smart.mjs: stems and a typing slip, tried when the exact pass finds nothing
import('./search-smart.mjs').then(m => { smart = m; }, () => {});

/** Filters by a query across the fields a person would search on; accents, ı and İ do not matter. `extraHay(paper)` adds the caller's text. */
export function filterPapers(papers, query, extraHay = null) {
  const q = foldSearch(String(query || '')).trim();
  if (!q) return papers;
  const terms = q.split(/\s+/), hays = new Map(papers.map(p => [p, foldSearch([p.label, p.title, p.journal, p.year, p.doi, p.pmid, ...(Array.isArray(p.authors) ? p.authors : [p.authors]), extraHay ? extraHay(p) : ''].join(' '))]));
  const exact = papers.filter(p => terms.every(t => hays.get(p).includes(t)));
  return exact.length || !smart ? exact : smart.loosen(papers, hays, terms);
}

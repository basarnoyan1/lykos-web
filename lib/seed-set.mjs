// A seed set: records known to be relevant, used to test a search and to mine
// terms from (plan B4 "test retrieval of selected known papers").
//
// The check answers, for a search, which seeds it retrieves and which it
// misses. For PubMed and Europe PMC the search is run again with the seeds'
// identifiers ANDed on, so the answer is the database's own, MeSH explosion
// and all, not an approximation; only the query and PMIDs are sent. Any other
// source has no way to ask that question, so the seed is looked up among the
// records that source's search brought into the library. A miss lists the
// terms the seed carries that the query lacks.
//
// A retrieved seed does not show the search is complete, and a search that
// finds every seed can still miss papers unlike them (plan B4).
import { pubmedXml, pubmedIds, SOURCES } from './sources.mjs';
import { parseRecords } from './bib.mjs';
import { databasesOf } from './search-library.mjs';
import { sourceName } from './prisma-counts.mjs';
import { mineTerms, queryTerms, covered } from './term-mining.mjs';

const doiOf = v => String(v || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');

/** PMIDs and DOIs in pasted text, one per line or separated by spaces, commas or semicolons. */
export function parseIds(text) {
  const pmids = [], dois = [], other = [];
  for (const raw of String(text || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)) {
    const doi = raw.match(/10\.\d{4,9}\/\S+/i);
    if (doi) { dois.push(doiOf(doi[0]).replace(/[.)\]]+$/, '')); continue; }
    const pm = raw.replace(/^pmid:?/i, '');
    if (/^\d{1,9}$/.test(pm)) pmids.push(pm); else other.push(raw);
  }
  return { pmids: [...new Set(pmids)], dois: [...new Set(dois)], other };
}

const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/**
 * Seeds from library records and pasted identifiers. Each seed is
 * `{ id, paperId, pmid, doi, title, abstract, keywords, mesh, meshMajor, label }`;
 * a record the library holds is matched by PMID or DOI first, so a pasted
 * identifier for a library record is that record.
 */
export function makeSeeds(papers, { ids = [], pasted = '' } = {}) {
  const chosen = papers.filter(p => ids.includes(p.id));
  const seeds = chosen.map(p => ({ id: p.id, paperId: p.id, pmid: String(p.pmid || '').replace(/\D/g, ''), doi: doiOf(p.doi), title: p.title || '', abstract: p.abstract || '', keywords: p.keywords || [], mesh: p.mesh || [], label: p.label || p.title || p.id }));
  const { pmids, dois, other } = parseIds(pasted);
  const byPmid = new Map(papers.filter(p => p.pmid).map(p => [String(p.pmid), p])), byDoi = new Map(papers.filter(p => p.doi).map(p => [doiOf(p.doi), p]));
  const have = new Set(seeds.map(x => x.id));
  const add = p => { if (have.has(p.id)) return; have.add(p.id); seeds.push({ id: p.id, paperId: p.id, pmid: String(p.pmid || '').replace(/\D/g, ''), doi: doiOf(p.doi), title: p.title || '', abstract: p.abstract || '', keywords: p.keywords || [], mesh: p.mesh || [], label: p.label || p.title || p.id }); };
  for (const m of pmids) { const p = byPmid.get(m); if (p) add(p); else if (!have.has(`pmid:${m}`)) { have.add(`pmid:${m}`); seeds.push({ id: `pmid:${m}`, paperId: null, pmid: m, doi: '', title: '', abstract: '', keywords: [], mesh: [], label: `PMID ${m}` }); } }
  for (const d of dois) { const p = byDoi.get(d); if (p) add(p); else if (!have.has(`doi:${d}`)) { have.add(`doi:${d}`); seeds.push({ id: `doi:${d}`, paperId: null, pmid: '', doi: d, title: '', abstract: '', keywords: [], mesh: [], label: d }); } }
  return { seeds, unrecognised: other };
}

/** PMIDs for DOIs, found in PubMed by article identifier, 20 to a query; the answer is read back from the records. */
async function pmidsForDois(dois, { settings, signal }) {
  const out = new Map();
  for (const chunk of chunks(dois, 20)) {
    const { ids } = await pubmedIds(chunk.map(d => `"${d.replace(/"/g, '')}"[AID]`).join(' OR '), { settings, signal, max: 100 });
    if (!ids.length) continue;
    for (const r of parseRecords(await pubmedXml(ids, { settings, signal }), 'pubmed.xml').records) if (r.doi) out.set(doiOf(r.doi), r);
  }
  return out;
}

/**
 * Fills the seeds from PubMed: title, abstract, keywords and MeSH descriptors
 * by PMID (and by DOI where there is no PMID). A seed already holding MeSH is
 * left as it is. Only PMIDs and DOIs are sent. Seeds PubMed does not have keep
 * what they had and are marked `notInPubmed`.
 */
export async function enrichSeeds(seeds, { settings, signal, onProgress } = {}) {
  const need = seeds.filter(s => !s.mesh?.length && !s.fetched);
  const noPmid = need.filter(s => !s.pmid && s.doi);
  const found = noPmid.length ? await pmidsForDois(noPmid.map(s => s.doi), { settings, signal }) : new Map();
  const byPmid = new Map();
  const pmids = [...need.filter(s => s.pmid).map(s => s.pmid)];
  if (pmids.length) for (const r of parseRecords(await pubmedXml(pmids, { settings, signal, onProgress }), 'pubmed.xml').records) byPmid.set(String(r.pmid), r);
  return seeds.map(s => {
    if (s.mesh?.length || s.fetched) return s;
    const r = (s.pmid && byPmid.get(s.pmid)) || (s.doi && found.get(s.doi));
    if (!r) return { ...s, fetched: true, notInPubmed: !s.pmid || !byPmid.has(s.pmid) };
    return { ...s, fetched: true, pmid: s.pmid || String(r.pmid || ''), title: s.title || r.title, abstract: s.abstract || r.abstract || '',
      keywords: s.keywords?.length ? s.keywords : r.keywords || [], mesh: r.mesh || [], notInPubmed: false, ...(s.doi ? {} : { doi: doiOf(r.doi) }) };
  });
}

// ---- the check ------------------------------------------------------------------
const MAX_TERM_URL = 6000;   // a query longer than this is not sent as a GET

/** Whether one source can be asked "does this query retrieve these records?" by the database itself. */
export const canAsk = name => ['PubMed', 'Europe PMC'].includes(sourceName(name));

/**
 * Which seeds a query retrieves at a source. `state` supplies, for other
 * sources, the library records that source's search brought in. Answers
 * `{ method, retrieved: Set(seed id), checked: Set(seed id), note }`; a seed
 * that could not be checked (no PMID at PubMed, say) is not in `checked`.
 */
export async function checkSearch(search, seeds, state, { settings, signal, onProgress } = {}) {
  const name = sourceName(search.source || 'PubMed');
  const retrieved = new Set(), checked = new Set();
  if (canAsk(name) && String(search.query || '').length < MAX_TERM_URL) {
    const pm = seeds.filter(s => s.pmid);
    let step = 0;
    for (const chunk of chunks(pm, 25)) {
      const idPart = name === 'PubMed' ? chunk.map(s => `${s.pmid}[uid]`).join(' OR ') : chunk.map(s => `EXT_ID:${s.pmid}`).join(' OR ');
      let ids;
      if (name === 'PubMed') ids = (await pubmedIds(`(${search.query}) AND (${idPart})`, { settings, signal, max: 100 })).ids;
      else {
        const src = SOURCES.find(x => x.id === 'epmc');
        const r = await src.run(`(${search.query}) AND SRC:MED AND (${idPart})`, { offset: 0, limit: 100, settings, signal });
        ids = r.records.map(x => x.pmid).filter(Boolean);
      }
      const got = new Set(ids.map(String));
      for (const s of chunk) { checked.add(s.id); if (got.has(s.pmid)) retrieved.add(s.id); }
      onProgress?.(`${name}: ${Math.min(pm.length, ++step * 25)} of ${pm.length} seeds`);
    }
    return { method: 'server', retrieved, checked, note: seeds.length > pm.length ? `${seeds.length - pm.length} seeds have no PMID and were not checked` : '' };
  }
  // other sources: was the seed among the records this search brought in?
  const papers = new Map((state.papers || []).map(p => [p.id, p]));
  for (const s of seeds) {
    const p = s.paperId && papers.get(s.paperId);
    if (!p) continue;
    checked.add(s.id);
    if (databasesOf(p).map(sourceName).includes(name)) retrieved.add(s.id);
  }
  const partial = search.status === 'partial' ? ' (a partial download)' : '';
  return { method: 'library', retrieved, checked, note: `${name} cannot be asked which records a query matches; seeds are looked up among the records that search brought in${partial}` };
}

/** The terms a seed carries that a query lacks, most useful first: MeSH descriptors, keywords, then title and abstract phrases. */
export function missingTerms(seed, query, { limit = 12 } = {}) {
  const r = mineTerms([seed], { query, minDocs: 1 });
  return r.candidates.filter(c => c.kind !== 'word' || (seed.title || '').toLowerCase().includes(c.term)).slice(0, limit);
}

/**
 * The whole check for every search worth checking: `searches` is the search
 * log (or a single query typed in the box, as `{ source, query, at }`).
 * Answers one result per search with, for each seed, retrieved or missed and
 * the terms a missed seed has that the query lacks.
 */
export async function seedCheck(searches, seeds, state, opts = {}) {
  const out = [];
  const usable = searches.filter(r => r.query && r.status !== 'failed' && !r.citationSearch && !r.related);
  for (const search of usable) {
    const res = await checkSearch(search, seeds, state, opts);
    const rows = seeds.map(s => {
      const state_ = !res.checked.has(s.id) ? 'unchecked' : res.retrieved.has(s.id) ? 'retrieved' : 'missed';
      return { seed: s, state: state_, missing: state_ === 'missed' ? missingTerms(s, search.query) : [] };
    });
    out.push({ search: { source: sourceName(search.source || 'PubMed'), query: search.query, at: search.at }, method: res.method, note: res.note,
      retrieved: rows.filter(x => x.state === 'retrieved').length, missed: rows.filter(x => x.state === 'missed').length, unchecked: rows.filter(x => x.state === 'unchecked').length, rows });
  }
  return out;
}
export { queryTerms, covered };

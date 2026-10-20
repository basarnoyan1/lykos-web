// Citation chasing through OpenAlex (plan B7, L2): the works the included
// studies cite (backward) and the works that cite them (forward).
//
// Seeds are found in OpenAlex by DOI and PMID, up to 100 per request. Backward:
// each seed's `referenced_works`, then those works fetched by id, 100 per
// request. Forward: `cites:` with up to 100 seeds joined by `|`, paged with a
// cursor. A candidate is counted by how many distinct seeds it is linked to,
// and the most linked come first: a work cited by several included studies is
// a likelier miss of the search than one cited by a single study.
//
// Costs when measured on 2026-09-29: a list filtered by id or `cites:` costs
// 1 credit per request of up to 100 works; one work by id costs none.
//
// OpenAlex's reference lists can be shorter than the true lists, so a backward
// chase can miss works a paper cites. Only identifiers go to OpenAlex.
import { openalexJson, fromOpenAlexWork } from './sources.mjs';
import { libraryIndex, titleKey, addSearchRecords, libraryRecord } from './search-library.mjs';
import { isIncluded } from './screen.mjs';

export const SOURCE = 'Citation searching';
export const BATCH = 100;
export const DIRECTIONS = [['backward', 'Backward'], ['forward', 'Forward'], ['both', 'Both']];
const SELECT = 'id,doi,title,publication_year,ids,authorships,primary_location,language,abstract_inverted_index,referenced_works';

const oaId = v => (String(v || '').match(/W\d+/) || [''])[0];
const cleanDoi = v => String(v || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
const cleanPmid = v => String(v || '').trim().replace(/^pmid:\s*/i, '').replace(/\D/g, '');
/** A stopped job ends a chase between requests. */
const stop = stopped => { if (stopped?.()) throw new DOMException('Stopped', 'AbortError'); };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** The seed records: the included studies, or the records picked. */
export function seedsOf(s, { ids = null } = {}) {
  const papers = s.papers || [];
  return ids ? papers.filter(p => ids.includes(p.id)) : papers.filter(p => isIncluded(s, p.id));
}

/**
 * Finds seeds in OpenAlex by DOI, then by PMID for the rest. Answers
 * `{ found: [{ paper, id, refs }], missing: [paper] }`.
 */
export async function resolveSeeds(papers, { settings, signal, onProgress = () => {} } = {}) {
  const found = new Map();   // paper id -> { paper, id, refs }
  const byDoi = new Map(), byPmid = new Map();
  for (const p of papers) {
    const d = cleanDoi(p.doi), m = cleanPmid(p.pmid);
    if (d) byDoi.set(d, p);
    if (m) byPmid.set(m, p);
  }
  const take = (r, paper) => { if (paper && !found.has(paper.id)) found.set(paper.id, { paper, id: oaId(r.id), refs: (r.referenced_works || []).map(oaId).filter(Boolean) }); };
  let step = 0;
  for (const chunk of chunks([...byDoi.keys()], BATCH)) {
    const d = await openalexJson('/works', { filter: `doi:${chunk.join('|')}`, per_page: String(BATCH), select: 'id,doi,ids,referenced_works' }, { settings, signal });
    for (const r of d.results || []) take(r, byDoi.get(cleanDoi(r.doi)));
    onProgress(`Finding included studies ${++step}`);
  }
  const rest = papers.filter(p => !found.has(p.id) && cleanPmid(p.pmid));
  for (const chunk of chunks(rest.map(p => cleanPmid(p.pmid)), BATCH)) {
    const d = await openalexJson('/works', { filter: `pmid:${chunk.join('|')}`, per_page: String(BATCH), select: 'id,doi,ids,referenced_works' }, { settings, signal });
    for (const r of d.results || []) take(r, byPmid.get(cleanPmid(r.ids?.pmid)));
  }
  return { found: [...found.values()], missing: papers.filter(p => !found.has(p.id)) };
}

/** Works by OpenAlex id, 100 to a request. */
async function worksById(ids, { settings, signal, onProgress, stopped }) {
  const out = [];
  let n = 0;
  for (const chunk of chunks(ids, BATCH)) {
    stop(stopped);
    const d = await openalexJson('/works', { filter: `openalex:${chunk.join('|')}`, per_page: String(BATCH), select: SELECT }, { settings, signal });
    out.push(...(d.results || []));
    onProgress?.(`Reading cited works ${Math.min(ids.length, ++n * BATCH)} of ${ids.length}`);
  }
  return out;
}

/**
 * Chases from `papers`. `direction` is 'backward', 'forward' or 'both'.
 * `maxForward` bounds how many citing works are read (a heavily cited seed can
 * have thousands); a chase that hit it says so. Answers
 * `{ seeds, found, missing, retrieved, capped, candidates }` where each
 * candidate is `{ id, record, back, forward, links, seeds: [paper id] }`.
 */
export async function chase(papers, { direction = 'both', settings, signal, onProgress = () => {}, maxForward = 5000, stopped = () => false } = {}) {
  const { found, missing } = await resolveSeeds(papers, { settings, signal, onProgress });
  const seedIds = new Set(found.map(f => f.id));
  const byOa = new Map(found.map(f => [f.id, f.paper.id]));
  const cands = new Map();   // oa id -> { work, back:Set(paper id), fwd:Set(paper id) }
  const at = (id, work) => { if (!cands.has(id)) cands.set(id, { work: null, back: new Set(), fwd: new Set() }); const c = cands.get(id); if (work) c.work = work; return c; };
  let capped = false;

  if (direction !== 'forward') {
    const cited = new Map();   // oa id -> Set(paper id)
    for (const f of found) for (const ref of f.refs) if (!seedIds.has(ref)) { if (!cited.has(ref)) cited.set(ref, new Set()); cited.get(ref).add(f.paper.id); }
    for (const w of await worksById([...cited.keys()], { settings, signal, onProgress, stopped })) {
      const id = oaId(w.id);
      if (!cited.has(id)) continue;
      const c = at(id, w); for (const p of cited.get(id)) c.back.add(p);
    }
  }

  if (direction !== 'backward') {
    let read = 0;
    outer: for (const chunk of chunks(found.map(f => f.id), BATCH)) {
      let cursor = '*';
      while (cursor) {
        stop(stopped);
        const d = await openalexJson('/works', { filter: `cites:${chunk.join('|')}`, per_page: String(BATCH), cursor, select: SELECT }, { settings, signal });
        for (const w of d.results || []) {
          const id = oaId(w.id);
          if (seedIds.has(id)) continue;
          const c = at(id, w);
          for (const ref of (w.referenced_works || []).map(oaId)) if (byOa.has(ref)) c.fwd.add(byOa.get(ref));
        }
        read += (d.results || []).length;
        onProgress(`Reading citing works ${read.toLocaleString()} of ${Number(d.meta?.count || 0).toLocaleString()}`);
        cursor = d.meta?.next_cursor || null;
        if (cursor && read >= maxForward) { capped = true; break outer; }
        if (!(d.results || []).length) break;
      }
    }
  }

  const candidates = [...cands].filter(([, c]) => c.work).map(([id, c]) => {
    const seeds = [...new Set([...c.back, ...c.fwd])];
    return { id, record: { ...fromOpenAlexWork(c.work, SOURCE), openalexId: id }, back: c.back.size, forward: c.fwd.size, links: c.back.size + c.fwd.size, seeds };
  }).sort((a, b) => b.links - a.links || (Number(b.record.year) || 0) - (Number(a.record.year) || 0) || a.record.title.localeCompare(b.record.title));
  return { direction, seeds: papers.length, found: found.map(f => f.paper.id), missing: missing.map(p => p.id), retrieved: candidates.length, capped, candidates };
}

/**
 * Marks which candidates the library already holds: the same DOI, PMID or key,
 * or the same title (a title match needs 25 characters of title so a short
 * generic one does not match another paper). Answers the candidates with
 * `inLibrary` (the paper's id or null); a chase's new candidates are those
 * with none.
 */
export function against(candidates, papers) {
  const index = libraryIndex(papers);
  const titles = new Map();
  for (const p of papers) { const k = titleKey(p.title); if (k.length >= 25 && !titles.has(k)) titles.set(k, p); }
  return candidates.map(c => {
    const have = index.find(c.record) || (titleKey(c.record.title).length >= 25 ? titles.get(titleKey(c.record.title)) : null);
    return { ...c, inLibrary: have ? have.id : null };
  });
}

/** The search-log entry for a chase: seeds, direction, date, how many retrieved and how many new. */
export function chaseEntry({ direction, seedCount, retrieved, fresh, at = new Date().toISOString(), capped = false, missing = 0 }) {
  const dir = { backward: 'backward', forward: 'forward', both: 'backward and forward' }[direction] || direction;
  return { at, source: SOURCE, kind: 'other', citationSearch: true, direction, seeds: seedCount, dataSource: 'OpenAlex',
    query: `Citation search, ${dir}, from ${seedCount} ${seedCount === 1 ? 'study' : 'studies'} (OpenAlex)`,
    total: retrieved, retrieved, new: fresh, status: capped ? 'partial' : 'complete', ...(missing ? { seedsNotFound: missing } : {}) };
}

/**
 * Adds the accepted candidates through the same path as a search's records and
 * logs the chase (one entry, mutated in place inside an update). Records are
 * marked new and remember the seeds that led to them.
 */
export function accept(state, chased, pickedIds, { destination = '', at = new Date().toISOString() } = {}) {
  const held = new Map((chased.candidates || []).map(c => [c.id, c]));
  const picked = pickedIds.map(id => held.get(id)).filter(Boolean);
  const before = (state.papers || []).length;
  addSearchRecords(state, picked.map(c => ({ ...libraryRecord(c.record), searchRun: at, isNew: true, foundBy: 'citation', foundAt: at, citationSeeds: c.seeds })), destination);
  const added = (state.papers || []).length - before;
  const fresh = (chased.candidates || []).filter(c => !c.inLibrary).length;
  state.searches = [...(state.searches || []), { ...chaseEntry({ direction: chased.direction, seedCount: chased.seeds, retrieved: chased.retrieved, fresh, at, capped: chased.capped, missing: chased.missing.length }), added }];
  return added;
}

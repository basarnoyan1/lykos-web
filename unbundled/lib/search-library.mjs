import { familyName, importKey } from './bib-names.mjs';
import { notify } from './notifications.mjs';
// Exact identities only: similar titles remain available for duplicate review.
const doi = value => String(value || '').trim().toLowerCase()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
const pmid = value => String(value || '').trim().replace(/^pmid:\s*/i, '');
function identities(p) {
  const keys = [p.key, p.id].filter(Boolean).map(String);
  const d = doi(p.doi || keys.find(k => k.startsWith('doi-'))?.slice(4));
  const m = pmid(p.pmid || keys.find(k => k.startsWith('pmid-'))?.slice(5));
  // and as a file without DOI or PMID keys it (title, year, first author)
  const own = p.title && p.year && importKey({ title: p.title, year: p.year, authors: p.authors });
  return [...new Set([...keys, own].filter(Boolean))].map(k => `key:${k}`).concat(d ? [`doi:${d}`] : [], m ? [`pmid:${m}`] : []);
}
export function libraryIndex(papers) {
  const index = new Map();
  const add = paper => { for (const key of identities(paper)) if (!index.has(key)) index.set(key, paper); };
  papers.forEach(add);
  return { add, find: record => identities(record).map(key => index.get(key)).find(Boolean) };
}
/**
 * The sources that found a record: its own list (`databases`) or, before a
 * record carried one, the source it came from. A record a later search or
 * import found again is not added twice, but the source that found it is
 * remembered here, so the Search Summary Table can say who found what.
 */
export const databasesOf = p => Array.isArray(p.databases) && p.databases.length ? p.databases : [p.database || p.source].filter(Boolean);
export function noteSource(paper, name) {
  const n = String(name || '').trim();
  if (!n) return;
  const have = databasesOf(paper);
  if (!have.includes(n)) paper.databases = [...have, n];
}
export function canAddResult(record, index, collection = null) {
  const paper = index.find(record);
  return !paper || !!collection && !(collection.members || []).includes(paper.id);
}
// ---- main's records and a protocol scenario's own (spec Settled 1) ----------------------------------------------------------------
// An id is in at most one of `papers` and `scenarioPapers`. Every write that adds a record to main's `papers` goes through
// addMainRecords (app/test/scenario-papers.test.mjs finds any that does not), and a project read with an id in both is repaired
// (separateRecords, store.mjs normalizeProject).

// a scenario's record made main's, whole and with its id (its PDF, values and the scenario's decisions follow by id): out of
// scenarioPapers, what `incoming` has that it lacks filled in, logged. The scenario's records merged into it stay the scenario's
// merges, across now (their keep is main's): no main search found them, so they are no duplicate main removed (Task 3 re-review 2, D);
// lib/scenarios.mjs assignRun makes main's those a run it makes main's found
function promote(state, p, incoming) {
  state.scenarioPapers = state.scenarioPapers.filter(x => x !== p);
  if (incoming && incoming !== p) for (const [k, v] of Object.entries(incoming)) if (p[k] == null || p[k] === '') p[k] = v;
  for (const m of state.scenarioMerged || []) if (m?.keepId === p.id && !m.across) m.across = true;
  (state.screeningLog ||= []).push({ action: 'promote', id: p.id, note: 'now one of main\'s records; it was a protocol scenario\'s only', at: new Date().toISOString() });
  return p;
}

/**
 * Adds records to main's `papers` (at the end, or from index `at`) and answers them as placed: a record whose id a protocol scenario's
 * record holds is that record, promoted, never a second one. Inside an update only.
 */
export function addMainRecords(state, records, { at = null } = {}) {
  const papers = state.papers ||= [], out = [];
  const pool = Array.isArray(state.scenarioPapers) && state.scenarioPapers.length ? new Map(state.scenarioPapers.map(p => [p?.id, p])) : null;
  for (const r of records) {
    const sc = pool && r?.id != null ? pool.get(r.id) : null;
    if (sc) pool.delete(r.id);
    const rec = sc ? promote(state, sc, r) : r;
    if (at == null) papers.push(rec); else papers.splice(Math.min(at + out.length, papers.length), 0, rec);
    out.push(rec);
  }
  return out;
}

/**
 * A project read (or merged with another window's save) with an id in both sections: main's record stays, the scenario's copy is kept as
 * merged into it (across, `repaired`), and a dated notification says which records and whether the two copies differed. Answers how many.
 */
export function separateRecords(state) {
  if (!Array.isArray(state?.scenarioPapers) || !state.scenarioPapers.length) return 0;
  const main = new Map((state.papers || []).map(p => [p?.id, p])), both = state.scenarioPapers.filter(p => main.has(p?.id));
  if (!both.length) return 0;
  state.scenarioPapers = state.scenarioPapers.filter(p => !main.has(p?.id));
  const at = new Date().toISOString(), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  state.scenarioMerged = [...(state.scenarioMerged || []), ...both.map(dup => ({ keepId: dup.id, dup, at, across: true, repaired: true }))];
  const ids = both.map(p => p.id), differ = both.filter(p => !same(p, main.get(p.id))).map(p => p.id), few = xs => `${xs.slice(0, 8).join(', ')}${xs.length > 8 ? ', …' : ''}`;
  notify(state, { id: `records-apart-${at}`, title: `${ids.length} record${ids.length === 1 ? ' was' : 's were'} both main's and a scenario's`, view: 'library',
    detail: `Main's record kept, the scenario's copy kept as merged into it: ${few(ids)}.${differ.length ? ` The two copies differed for ${few(differ)}: compare them under Duplicates.` : ' The copies were the same.'}` });
  return both.length;
}

/**
 * The scenario records a main search finds by identity (DOI, PMID, key): `take(record)` promotes the one a search result is (addMainRecords)
 * and answers it, or null. Inside an update only.
 */
export function scenarioRecords(state) {
  const pool = state.scenarioPapers;
  if (!Array.isArray(pool) || !pool.length) return { take: () => null };
  const index = libraryIndex(pool);
  return { take(record) {
    const p = index.find(record);
    return p && state.scenarioPapers.includes(p) ? addMainRecords(state, [p])[0] : null;
  } };
}

/** Mutate inside the store transaction, checking both current and batch records. */
export function addSearchRecords(state, records, destination = '') {
  const index = libraryIndex(state.papers), scenario = scenarioRecords(state);
  const collection = (state.collections || []).find(c => c.id === destination);
  // the collection's members as a set, written back once: a copy of the list and a scan of it per record was quadratic (Add all, 10,000)
  const members = collection ? new Set(collection.members || []) : null;
  let added = 0;
  for (const record of records) {
    let paper = index.find(record);
    if (!paper && (paper = scenario.take(record))) { index.add(paper); if (record.source) noteSource(paper, record.source); if (members) members.add(paper.id); added++; continue; }
    if (paper && record.source) noteSource(paper, record.source);
    if (paper && (!members || members.has(paper.id))) continue;
    if (!paper) { [paper] = addMainRecords(state, [record]); index.add(paper); }
    if (members) members.add(paper.id);
    added++;
  }
  if (collection && members.size !== (collection.members || []).length) collection.members = [...members];
  return added;
}

/**
 * A search result as a library record: a stable id and the short citation
 * used everywhere a study is named ("Smith 2020"). The family name is read the
 * way the author was written: "Smith J", "Smith, John" and OpenAlex's "John
 * Smith" all give Smith (the first word gave "John 2020").
 */
export function libraryRecord(r) {
  const first = r.authors?.[0] ? familyName(r.authors[0]) : '';
  const y = r.year ? String(r.year) : '';
  return { ...r, id: r.key, year: y, label: [first || 'Study', y].filter(Boolean).join(' '), pdf: null };
}

// importInto (an exported search into the library, logged as its database's run) is lib/search-import.mjs: it reads the database registry,
// which the shell's first view does not load (31 Oct 2026).

// Fields a reference list can fill in on a record the library already holds; identity, decisions and PDF are never copied.
const FILL = ['title', 'authors', 'journal', 'journalAbbr', 'year', 'doi', 'pmid', 'url', 'abstract', 'volume', 'issue', 'pages', 'language'];
export const titleKey = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 120);
/**
 * A reference list (the works a paper cites, saved from Mendeley, Zotero or
 * EndNote) into the library. It is not a search: no search-log entry is
 * written, so the PRISMA counts of records identified do not move. A work the
 * library holds (same DOI, PMID or key, else the same title) gains the fields
 * it lacks; a work it does not is added, marked `source: 'References'`.
 * Without `at` nothing is changed and the counts are returned.
 */
export function importReferences(s, records, fileName = '', { at = null } = {}) {
  const index = libraryIndex(s.papers || []);
  const byTitle = new Map((s.papers || []).filter(p => p.title).map(p => [titleKey(p.title), p]));
  let added = 0, matched = 0, filled = 0;
  for (const raw of records) {
    // Zotero and Mendeley write the PMID as "AN  - PMID:123" in an RIS export
    const r = raw.pmid || !/^PMID:\s*\d+/i.test(raw.accession || '') ? raw : { ...raw, pmid: /(\d+)/.exec(raw.accession)[1] };
    const have = index.find(r) || (titleKey(r.title) && byTitle.get(titleKey(r.title)));
    if (have) {
      matched++;
      for (const k of FILL) {
        const empty = have[k] == null || have[k] === '' || (Array.isArray(have[k]) && !have[k].length);
        if (empty && r[k] != null && r[k] !== '' && !(Array.isArray(r[k]) && !r[k].length)) { if (at) have[k] = r[k]; filled++; }
      }
      if (at && have.year && !have.label) have.label = r.label;
      continue;
    }
    added++;
    if (!at) continue;
    const paper = { ...r, id: r.key, pdf: null, source: 'References', ...(fileName ? { importFile: fileName } : {}) };
    delete paper.raw; delete paper.database;
    const [placed] = addMainRecords(s, [paper]); index.add(placed); byTitle.set(titleKey(placed.title), placed);
  }
  return { added, matched, filled };
}

/**
 * Every record of a run, page by page (plan B6): `page(offset, limit)` returns
 * `{ total, records }`. Stops at `cap`, at an empty page, or when `stopped()`
 * says so; `complete` says whether the review now holds everything the source
 * reported, which is what the search log may claim.
 */
export async function fetchAll(page, { total, cap = 10000, limit = 100, start = 0, stopped = () => false, onPage = () => {} } = {}) {
  const want = Math.min(Number(total) || 0, cap);
  const records = []; const seen = new Set();
  let offset = start, reported = Number(total) || 0, interrupted = false, paused = null;
  while (offset < want) {
    if (stopped()) { interrupted = true; break; }
    let r;
    // A day's allowance spent is a pause with a time to resume, not a failure: what was fetched is kept.
    try { r = await page(offset, Math.min(limit, want - offset)); }
    catch (err) { if (err?.name === 'AllowanceError') { paused = { resumeAt: err.resumeAt, source: err.source, message: err.message }; break; } throw err; }
    if (Number.isFinite(Number(r.total))) reported = Number(r.total);
    if (!r.records?.length) break;
    // a source that shifts under paging can hand the same record twice
    for (const x of r.records) if (!seen.has(x.key)) { seen.add(x.key); records.push(x); }
    offset += r.records.length;
    onPage(records.length, Math.min(reported, cap));
  }
  return { records, total: reported, complete: !interrupted && !paused && (start ? offset >= reported : records.length >= reported), capped: reported > cap, offset, paused };
}


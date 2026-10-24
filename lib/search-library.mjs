import { familyName, hash64 as hash } from './bib.mjs';
// Exact identities only: similar titles remain available for duplicate review.
const doi = value => String(value || '').trim().toLowerCase()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
const pmid = value => String(value || '').trim().replace(/^pmid:\s*/i, '');
function identities(p) {
  const keys = [p.key, p.id].filter(Boolean).map(String);
  const d = doi(p.doi || keys.find(k => k.startsWith('doi-'))?.slice(4));
  const m = pmid(p.pmid || keys.find(k => k.startsWith('pmid-'))?.slice(5));
  return [...keys.map(k => `key:${k}`), ...(d ? [`doi:${d}`] : []), ...(m ? [`pmid:${m}`] : [])];
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
export const databasesOf = p => Array.isArray(p.databases) && p.databases.length ? p.databases : [p.source].filter(Boolean);
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
/** Mutate inside the store transaction, checking both current and batch records. */
export function addSearchRecords(state, records, destination = '') {
  const index = libraryIndex(state.papers);
  const collection = (state.collections || []).find(c => c.id === destination);
  let added = 0;
  for (const record of records) {
    const existing = index.find(record);
    if (existing && record.source) noteSource(existing, record.source);
    if (!canAddResult(record, index, collection)) continue;
    let paper = index.find(record);
    if (!paper) { paper = record; state.papers.push(paper); index.add(paper); }
    if (collection) collection.members = [...(collection.members || []), paper.id];
    added++;
  }
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

// A record without DOI or PMID is keyed by title, year and first author (bib.mjs importKey). Editorials, replies, errata and
// abstracts share those three fields while being different reports, so a key match alone is not proof of a repeat. The
// fields below tell two reports apart; a field only counts when both records carry it.
const squash = v => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const firstPage = v => /\d+/.exec(String(v ?? ''))?.[0] || '';
function sameReport(a, b) {
  const pairs = [['journal', squash], ['volume', squash], ['pages', firstPage]]
    .map(([k, f]) => [k, f(a[k]), f(b[k])]).filter(([, x, y]) => x && y);
  const equal = k => pairs.find(p => p[0] === k)?.[1] === pairs.find(p => p[0] === k)?.[2];
  // the same volume and start page is the same article whatever the journal's spelling
  if (pairs.some(p => p[0] === 'volume') && pairs.some(p => p[0] === 'pages') && equal('volume') && equal('pages')) return true;
  return pairs.every(([, x, y]) => x === y);
}
const discriminator = r => [squash(r.journal), squash(r.volume), firstPage(r.pages)].join('|');

/**
 * Adds parsed records to a project. A record the library already holds (same
 * key, DOI or PMID, lib/search-library.mjs) is not added twice, except that a match on title, year and first author alone
 * (no DOI or PMID) with a different journal, volume or start page is a different report that may be a duplicate: it is added
 * under its own key, counted in `possible`, and left to the Duplicates review, never dropped or counted as removed; it is counted
 * as a duplicate in the file's search-log entry, so PRISMA's "duplicates
 * removed" includes it and the flow's arithmetic still adds up. An exported
 * search counts toward PRISMA's records identified under the database it came
 * from (RIS DB/DP), or the file's name when it does not say. Without `at`
 * nothing is changed: the counts are returned for a preview.
 */
export function importInto(s, records, fileName, { at = null, raw = null, file = '' } = {}) {
  const index = libraryIndex(s.papers || []);
  const bySource = new Map();
  let added = 0, duplicates = 0, possible = 0;
  for (const r of records) {
    const db = r.database || fileName.replace(/\.[^.]+$/, '');
    const tally = bySource.get(db) || { n: 0, dup: 0 }; bySource.set(db, tally);
    tally.n++;
    let have = index.find(r), record = r;
    if (have && String(r.key).startsWith('rec-') && !r.doi && !r.pmid && !sameReport(have, r)) {
      // Same title, year and first author, different journal, volume or page: keep it, under a key of its own.
      const key = `${r.key}-${hash(discriminator(r))}`, again = index.find({ key });
      if (again && sameReport(again, r)) have = again;   // this file imported before
      else { have = null; record = { ...r, key }; possible++; }
    }
    if (have) { tally.dup++; duplicates++; if (at) noteSource(have, db); continue; }
    const paper = { ...record, id: record.key, pdf: null, importFile: fileName };
    index.add(paper); added++;
    if (at) s.papers.push(paper);
  }
  if (at) s.searches = [...(s.searches || []), ...[...bySource].map(([source, t]) => ({ source, kind: 'database',
    query: `Imported from ${fileName}`, at, retrieved: t.n, total: t.n, ...(t.dup ? { duplicates: t.dup } : {}), status: 'complete', imported: true,
    // the file as it was (plan B3): where its copy is kept, and its SHA-256
    ...(file ? { file } : {}), ...(raw ? { raw } : {}) }))];
  return { added, duplicates, possible };
}


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
    s.papers.push(paper); index.add(paper); byTitle.set(titleKey(paper.title), paper);
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

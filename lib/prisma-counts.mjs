// Shared by Reporting, Overview, the manuscript's live results and every export.
import { SOURCES } from './sources.mjs';
import { ownRun } from './reviews.mjs';
import { database } from './databases.mjs';
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";

// A source is logged by id (workflows) or by name (the search page, imports);
// the diagram names it the way the database calls itself, and an older or
// exported name of a known database ("Cochrane Library") as that database (lib/databases.mjs).
// Both tables are fixed, so a name is looked up once: a flow over 26,000 records asks for the same few names a hundred thousand times.
const sourceNames = new Map();
export const sourceName = v => {
  if (sourceNames.has(v)) return sourceNames.get(v);
  const name = SOURCES.find(x => x.id === v || x.name === v)?.name || database(v)?.name || String(v || 'Database');
  if (typeof v === 'string' && sourceNames.size < 5000) sourceNames.set(v, name);
  return name;
};

// The shell's project version (store.mjs getVersion), set once by app.mjs: with it the flow is worked out once per version of a state, not once per
// caller (Reporting asked for it about seven times per section click, each a pass over every record). Tools with no store set none and compute each time.
let versionNow = null;
export const followVersion = fn => { versionNow = fn; };
const deriveCache = new WeakMap(), armsCache = new WeakMap();
function byVersion(cache, s, fn) {
  if (!versionNow || !s || typeof s !== 'object') return fn(s);
  const v = versionNow(), hit = cache.get(s);
  if (hit && hit.v === v) return hit.out;
  const out = fn(s); cache.set(s, { v, out }); return out;
}

// PRISMA 2020's identification via other methods (citation searching, websites, organisations, other sources "Name, n"),
// kept apart from databases and registers. The log entry's kind says which; for an "Other sources (…)" import logged as a
// database before imports said otherwise, the name decides.
export const OTHER_METHODS = { citation: 'citations_results', website: 'website_results', organisation: 'organisation_results', other: 'other_sources_results' };
const OTHER_NAMES = [[/^citation search/i, 'citation'], [/^websites?\b/i, 'website'], [/^organi[sz]ations?\b/i, 'organisation'], [/^other sources?\b/i, 'other']];
const KINDS = new Set(['database', 'register', ...Object.keys(OTHER_METHODS)]);
/** How a search-log entry (or a bare { source }) identified records: 'database', 'register', or an other method (citation, website, organisation, other). */
export function sourceKind(r) {
  if (r.citationSearch) return 'citation';
  const name = String(r.source || '');
  const byName = OTHER_NAMES.find(([re]) => re.test(name) || re.test(sourceName(name)));
  if (byName) return byName[1];
  if (KINDS.has(r.kind)) return r.kind;
  return SOURCES.find(x => x.id === r.source || x.name === r.source)?.kind || database(r.source)?.kind || 'database';
}
export const isOtherMethod = kind => kind in OTHER_METHODS;

/** The names a record was found under: every database noted on it, else the one it was imported or added from. */
export function recordSources(p) {
  if (Array.isArray(p.databases) && p.databases.length) return p.databases;
  const one = p.database || p.source || (p.foundBy === 'citation' ? 'Citation searching' : '');
  return one ? [one] : [];
}

/** The name a search-log entry counts under: the database it names (`database`, an id), else its source as lib/databases.mjs folds it. */
export const runName = r => (r?.database && database(r.database)?.name) || sourceName(r?.source);
const fileBase = f => String(f || '').split(/[\\/]/).pop();

/**
 * The runs the flow counts, each source name's kind (the log's entries first), the sources of a record and its method: found by any
 * database or register, the databases arm; else the other method of its first source.
 *
 * A record's sources (31 Oct 2026) are the names noted on it, the run that brought it (its import file, or the search run it came from)
 * and those of any duplicate merged into it, each folded to its database: a re-run of a database ("WebOfScience_v3_2026-10-31")
 * is that database, not a new one. A run marked `previousVersion` (a search of the review's previous version, PRISMA 2020's updated
 * review) is not counted as identified, and a record it brought is 'previous': in neither column. Shared with lib/prisma-records.mjs.
 */
export const flowArms = s => byVersion(armsCache, s, flowArmsOnce);
function flowArmsOnce(s) {
  // An exploratory run (plan B7) is not in the flow; a search another review claims is in that review's (lib/reviews.mjs).
  const own = (s.searches || []).filter(r => ownRun(r) && r.status !== 'failed' && !r.exploratory);
  const runs = own.filter(r => !r.previousVersion), previousRuns = own.filter(r => r.previousVersion);
  const byName = new Map();
  for (const r of runs) { const k = sourceKind(r), n = runName(r); if (isOtherMethod(k) || !byName.has(n)) byName.set(n, k); }
  const kinds = new Map();
  const kindOf = name => { if (!kinds.has(name)) kinds.set(name, byName.get(sourceName(name)) || sourceKind({ source: name })); return kinds.get(name); };
  // the run behind an import file or a search run; a file two runs name for different databases names neither
  const byFile = new Map(), byAt = new Map(), prevFiles = new Set(), prevAts = new Set();
  for (const r of own) {
    const n = runName(r), f = fileBase(r.file);
    if (f) byFile.set(f, byFile.has(f) && byFile.get(f) !== n ? null : n);
    if (r.at) byAt.set(r.at, byAt.has(r.at) && byAt.get(r.at) !== n ? null : n);
    if (r.previousVersion) { if (f) prevFiles.add(f); if (r.at) prevAts.add(r.at); }
  }
  const ownSources = p => {
    const names = recordSources(p).map(sourceName);
    const f = p.importFile && byFile.get(fileBase(p.importFile)), a = p.searchRun && byAt.get(p.searchRun);
    return [...names, ...(f ? [f] : []), ...(a ? [a] : [])];
  };
  const fromDups = new Map();
  for (const m of s.merged || []) if (m.dup && m.keepId) fromDups.set(m.keepId, [...(fromDups.get(m.keepId) || []), ...ownSources(m.dup)]);
  /** Every database, register or method that found a record, by the name the flow counts it under. */
  const sourcesOf = p => [...new Set([...ownSources(p), ...(fromDups.get(p.id) || [])])];
  const isPrevious = p => previousRuns.length > 0 && Boolean((p.importFile && prevFiles.has(fileBase(p.importFile))) || (p.searchRun && prevAts.has(p.searchRun)));
  // derive, identification and duplicatesBasis each ask for every record's method over the same arms: worked out once a record
  const methods = new WeakMap();
  const methodOf = p => { let m = methods.get(p); if (!m) methods.set(p, m = methodOnce(p)); return m; };
  const methodOnce = p => {
    if (isPrevious(p)) return { method: 'previous', name: '' };
    const names = sourcesOf(p);
    const kinds = names.map(kindOf);
    const i = kinds.findIndex(isOtherMethod);
    if (!names.length || i < 0 || kinds.some(k => !isOtherMethod(k))) return { method: 'database', name: '' };
    return { method: kinds[i], name: names[i] };
  };
  return { runs, previousRuns, kindOf, methodOf, sourcesOf, ownSources: p => [...new Set(ownSources(p))], isPrevious };
}

/** How each database's records identified are counted, in one sentence for the flow's notes, PRISMA-S and the help. */
export const IDENTIFICATION_RULE = 'Each database or register counts its records once: a database searched once counts the records its search returned; one searched more than once (a re-run or an updated strategy) counts each record once, however many of its runs found it.';

/**
 * Records identified from databases and registers, one count per database (31 Oct 2026). A database searched once counts the records
 * that run returned (its retrieved number, with what its file had removed before import). A database searched more than once (a
 * re-run, an updated or corrected strategy) counts each record once however many of its runs found it: the records the library holds,
 * or merged away, that name it, plus what its files had removed before import. Its runs' own numbers stay in the search log.
 * Runs logged without their records count as the largest of them ('largest', not exact); a database a previous version searched too
 * sums this version's runs ('summed').
 * Returns { rows: [{ name, kind, count, runs, retrieved, before, visible, rule: 'run' | 'distinct' | 'largest' | 'summed' }], unique, unknown, absent, short }.
 */
export function identification(s, arms = flowArms(s)) {
  const { runs, previousRuns, kindOf, methodOf, sourcesOf } = arms;
  const rows = new Map();
  for (const r of runs.filter(r => !isOtherMethod(sourceKind(r)))) {
    const name = runName(r);
    const row = rows.get(name) || { name, kind: sourceKind(r), runs: [], retrieved: 0, before: 0, missing: false, visible: 0, count: 0, rule: 'run' };
    row.runs.push(r); row.retrieved += Number(r.retrieved) || 0; row.before += Number(r.deduplicatedBefore) || 0;
    if (known(r.retrieved) == null) row.missing = true;
    rows.set(name, row);
  }
  // the records the databases arm holds, each once, under every database that found it
  const unknown = new Set(), held = (s.papers || []).filter(p => methodOf(p).method === 'database');
  for (const p of held) {
    const names = sourcesOf(p).filter(n => !isOtherMethod(kindOf(n)));
    if (!names.length) unknown.add(NO_SOURCE);
    for (const n of names) { const row = rows.get(n); if (row) row.visible++; else unknown.add(n); }
  }
  // a record a previous version's run brought and this search found again was identified by it (and removed as already screened)
  if (previousRuns.length) for (const p of (s.papers || []).filter(p => methodOf(p).method === 'previous'))
    for (const n of sourcesOf(p)) { const row = rows.get(n); if (row && !previousRuns.some(r => runName(r) === n)) row.visible++; }
  const absent = [];
  let short = false;
  for (const row of rows.values()) {
    if (row.missing) unknown.add(row.name);
    if (!row.visible) absent.push(row.name);
    if (row.runs.length === 1) { row.count = row.retrieved + row.before; continue; }
    // several runs: each record once; when a previous version's runs searched it too, this version's runs are summed
    const prev = previousRuns.some(r => runName(r) === row.name);
    // runs logged without their records (none in the library): which records they share is unknown, so the largest run stands
    // for them, the least the database can have found; the count is not exact (absent)
    if (!row.visible && !prev) { row.rule = 'largest'; row.count = Math.max(...row.runs.map(r => (Number(r.retrieved) || 0) + (Number(r.deduplicatedBefore) || 0))); continue; }
    row.rule = prev ? 'summed' : 'distinct';
    row.count = prev ? row.retrieved + row.before : row.visible + row.before;
    // each run's records are in the library or were noted on a record already held, so the database holds at least each run's own
    if (!prev && row.runs.some(r => (Number(r.retrieved) || 0) - (Number(r.duplicates) || 0) > row.visible)) short = true;
  }
  return { rows: [...rows.values()], unique: held.length, unknown: [...unknown], absent, short };
}

/** The counts every page shows: derived from the project, then the ones entered by hand. */
export const prismaData = s => ({ ...derive(s), ...(s.prisma || {}) });

export const derive = s => ({ ...byVersion(deriveCache, s, deriveOnce) });   // a copy: a caller that adds to it leaves the kept one as it was
function deriveOnce(s) {
  const out = {};
  const papers = s.papers || [], merged = s.merged || [];

  // PRISMA counts records identified per source, before de-duplication, and keeps databases and registers apart. Each database
  // counts its records once across its runs (identification above); entries written before sources were distinguished were all databases.
  const arms = flowArms(s), { runs, methodOf } = arms;
  // Records the library holds (and merged away) by arm: the other methods are counted by the records they added, since a
  // citation chase only adds what the library lacks and its `retrieved` is every work it looked at.
  const held = [...papers, ...merged.filter(m => m.dup).map(m => m.dup)];
  const methodById = new Map(held.map(p => [p.id, methodOf(p)]));
  const other = new Map([...methodById].filter(([, m]) => isOtherMethod(m.method)));
  const inDb = p => methodById.get(p.id)?.method === 'database';

  if (runs.some(r => !isOtherMethod(sourceKind(r)))) {
    const id = identification(s, arms);
    for (const [kind, total, each] of [['database', 'database_results', 'database_specific_results'], ['register', 'register_results', 'register_specific_results']]) {
      const rows = id.rows.filter(r => r.kind === kind), n = rows.reduce((a, r) => a + r.count, 0);
      if (n) { out[total] = n; out[each] = rows.map(r => `${r.name}, ${r.count}`).join('; '); }
    }
  } else if (papers.length) {
    // No database searches recorded, so the library was imported rather than searched: what was identified is the
    // library and the duplicates merged out of it, less what other methods found.
    const n = papers.filter(inDb).length + merged.length;
    if (n) out.database_results = n;
  }
  // Identification via other methods: a count per method once the log or the library holds one, the rest by source name.
  const tally = { citation: 0, website: 0, organisation: 0 }, named = new Map();
  for (const m of other.values()) {
    if (m.method === 'other') named.set(m.name, (named.get(m.name) || 0) + 1);
    else tally[m.method]++;
  }
  for (const r of runs) { const k = sourceKind(r); if (k === 'other' && !named.has(sourceName(r.source))) named.set(sourceName(r.source), 0); }
  for (const k of ['citation', 'website', 'organisation'])
    if (tally[k] || runs.some(r => sourceKind(r) === k)) out[OTHER_METHODS[k]] = tally[k];
  if (named.size) out.other_sources_results = [...named].map(([name, n]) => `${name.replace(/;/g, ',')}, ${n}`).join('; ');

  const dup = duplicatesBasis(s, arms);
  if (dup.count != null) out.duplicates = dup.count;

  // Title/abstract decisions fill the screening row; full-text decisions, once
  // any exist, fill the retrieval and eligibility rows beneath it. Records found
  // by other methods go down their own column (sought, not retrieved, assessed,
  // excluded), as the PRISMA 2020 template draws it; both columns end in the
  // studies included.
  const sc = s.screening || {}, ft = s.fulltext || {};
  const included = [];
  const column = (recs, keys) => {
    const decided = recs.filter(p => sc[p.id] && !sc[p.id].needsCriteriaReview);
    if (!decided.length) return;
    // A record still undecided (uncertain) is neither excluded nor sought, so
    // it is not yet counted as screened: screened = excluded + sought, as the
    // diagram reads. pending() says how many wait.
    const excluded = decided.filter(p => sc[p.id].decision === 'exclude').length;
    const sought = recs.filter(p => sc[p.id]?.decision === 'include' && !sc[p.id].needsCriteriaReview);
    if (keys.excluded) { out[keys.excluded] = excluded; out[keys.screened] = excluded + sought.length; }
    out[keys.sought] = sought.length;
    // a report recorded as not retrieved (op not_retrieved, 31 Oct 2026) counts as sought and not retrieved, whatever its full-text state,
    // as does an exclusion whose reason reads "not retrieved" (the older way)
    const gone = p => p.pdfRetrieval?.status === 'not-retrieved';
    const assessed = sought.filter(p => !gone(p) && ft[p.id] && !ft[p.id].needsCriteriaReview && ['include', 'exclude'].includes(ft[p.id].decision));
    const unretrieved = sought.filter(gone);
    if (!assessed.length && !unretrieved.length) return;
    const notFound = assessed.filter(p => ft[p.id].decision === 'exclude' && /not retriev/i.test(ft[p.id].reason || ''));
    out[keys.notret] = notFound.length + unretrieved.length;
    out[keys.assessed] = assessed.length - notFound.length;
    const reasons = {};
    for (const p of assessed) {
      const d = ft[p.id];
      if (d.decision === 'exclude' && !notFound.includes(p)) reasons[d.reason || 'Other'] = (reasons[d.reason || 'Other'] || 0) + 1;
    }
    out[keys.excl] = Object.entries(reasons).map(([r, n]) => `${r.replace(/;/g, ',')}, ${n}`).join('; ');
    included.push(...assessed.filter(p => ft[p.id].decision === 'include'));
  };
  column(papers.filter(inDb), { excluded: 'records_excluded', screened: 'records_screened', sought: 'dbr_sought_reports', notret: 'dbr_notretrieved_reports', assessed: 'dbr_assessed', excl: 'dbr_excluded' });
  column(papers.filter(p => other.has(p.id)), { sought: 'other_sought_reports', notret: 'other_notretrieved_reports', assessed: 'other_assessed', excl: 'other_excluded' });
  // a report linked to its trial (op report_of) is a report of a new study, not a new study (31 Oct 2026)
  if ('dbr_assessed' in out || 'other_assessed' in out) {
    const inc = new Set(included.map(p => p.id));
    // a study is the trial its reports belong to: a report linked to a main report counts once with it, even while that main report waits
    // for its full text (31 Oct 2026: two linked reports of one undecided trial counted as two studies)
    const studies = new Set(included.map(p => p.reportOf || p.id)).size;
    out.new_studies = studies;
    if (studies < included.length) out.new_reports = included.length;   // drawn only when reports and studies differ
  }
  return out;
}

const known = v => v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null;
export const NO_SOURCE = 'Source not recorded';

/**
 * PRISMA's duplicates removed and how it was reached: the records identified from databases and registers (identification(), each
 * database's records once across its runs, with what a file had removed before import) less the unique records the library holds
 * from them. Merges done here, records an import skipped as already held, and duplicates removed before import (an EndNote or Rayyan
 * deduplication whose merged records never reached the library) all fall out of that difference, so identified less duplicates is
 * always the records the databases arm holds. It is exact only when every record names a database or register with a logged run that
 * has a retrieved number, and every logged database has records in the library; otherwise `unknown` names the sources without one
 * (or `absent` the databases with none) and the count falls back to what the project itself saw removed (merges, skips and recorded
 * pre-import removals), never a guess.
 * { count, exact, identified, unique, merged, skipped, before, outside, unknown, absent, previous, short? }: `outside` is what the
 * difference holds beyond the three recorded kinds, for databases searched once (removed before import without a record of it, or
 * deleted); `previous` the records of a previous version found again; `short` says the log's identified count is below what the
 * library holds plus what was seen removed; `distinct` names the databases searched more than once, whose import skips include records
 * their own earlier runs had found (not duplicates removed, since such a record was identified once).
 */
export function duplicatesBasis(s, arms = flowArms(s)) {
  const { runs, methodOf } = arms;
  const dbRuns = runs.filter(r => !isOtherMethod(sourceKind(r)));
  const sum = (list, k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const merged = (s.merged || []).length, skipped = sum(runs, 'duplicates'), before = sum(runs, 'deduplicatedBefore');
  const seen = merged + skipped + before;
  const base = { count: seen || null, exact: false, identified: null, unique: null, merged, skipped, before, outside: 0, unknown: [], absent: [], previous: 0 };
  // no database search logged: the library stands for what was identified (derive), so only what was seen removed counts
  if (!dbRuns.length) return base;
  const id = identification(s, arms);
  const identified = id.rows.reduce((a, r) => a + r.count, 0), unique = id.unique;
  const previous = (s.papers || []).filter(p => methodOf(p).method === 'previous').length;
  // what was seen removed from the databases arm alone (a merged citation-search record is not one of its duplicates)
  const seenDb = (s.merged || []).filter(m => !m.dup || methodOf(m.dup).method === 'database').length + sum(dbRuns, 'duplicates') + sum(dbRuns, 'deduplicatedBefore');
  // a database searched more than once counts a record its later run skipped as held once, so its skips are not all removals
  const once = id.rows.every(r => r.runs.length === 1);
  const short = id.short || (once && !previous && identified - unique < seenDb);
  if (id.unknown.length || id.absent.length || short || identified < unique) return { ...base, identified, unique, unknown: id.unknown, absent: id.absent, previous, short: !id.unknown.length && !id.absent.length };
  const count = identified - unique;
  return { ...base, count, exact: true, identified, unique, previous, outside: once && !previous ? count - seenDb : 0, ...(once ? {} : { distinct: id.rows.filter(r => r.runs.length > 1).map(r => r.name) }) };
}

/**
 * Whether a flow's counts add up, as PRISMA 2020 draws them: `[{ name, ok, note? }]` over the counts shown (derived, then any entered by
 * hand). A report sought and neither retrieved-and-decided nor recorded as not retrieved waits for its full-text decision: it is in no box
 * below "sought", so each column's assessed is sought less not retrieved less those waiting (the record says how many). Records found by
 * other methods may be screened before retrieval (a citation chase's candidates), so that column only needs sought within its records.
 * Included is reports when the flow counts reports of included studies, else studies. 2 Nov 2026: the draw refused the Sham response
 * flow for its 102 reports awaiting classification, its screened citation records and its 138 reports of 114 trials.
 */
export function flowChecks(s, P = prismaData(s)) {
  const num = v => (v == null || v === '' ? null : Number(v)), has = k => num(P[k]) != null;
  const pairs = t => String(t || '').split(';').map(x => x.trim()).filter(Boolean).map(x => Number(x.slice(x.lastIndexOf(',') + 1)));
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const sc = s.screening || {}, ft = s.fulltext || {}, { methodOf } = flowArms(s);
  const waits = p => sc[p.id]?.decision === 'include' && !sc[p.id].needsCriteriaReview && p.pdfRetrieval?.status !== 'not-retrieved'
    && !(ft[p.id] && !ft[p.id].needsCriteriaReview && ['include', 'exclude'].includes(ft[p.id].decision));
  const waiting = { db: 0, other: 0 };
  for (const p of s.papers || []) if (waits(p)) waiting[isOtherMethod(methodOf(p).method) ? 'other' : 'db']++;
  const other = ['citations_results', 'website_results', 'organisation_results'].filter(has).reduce((a, k) => a + num(P[k]), 0) + sum(pairs(P.other_sources_results));
  const dbIn = num(P.dbr_assessed) - sum(pairs(P.dbr_excluded)), otIn = has('other_assessed') ? num(P.other_assessed) - sum(pairs(P.other_excluded)) : 0;
  const included = has('new_reports') ? num(P.new_reports) : num(P.new_studies);
  const wait = n => (n ? `${n} report${n === 1 ? '' : 's'} await a full-text decision` : '');
  return [
    { name: 'Databases = the sum of the databases', ok: !P.database_specific_results || num(P.database_results) === sum(pairs(P.database_specific_results)) },
    { name: 'Records − duplicates − removed = screened', ok: num(P.database_results) + (num(P.register_results) || 0) - num(P.duplicates) - (num(P.excluded_automatic) || 0) - (num(P.excluded_other) || 0) === num(P.records_screened) },
    { name: 'Screened − excluded = sought', ok: num(P.records_screened) - num(P.records_excluded) === num(P.dbr_sought_reports) },
    { name: 'Sought − not retrieved − awaiting a decision = assessed', ok: num(P.dbr_sought_reports) - num(P.dbr_notretrieved_reports) - waiting.db === num(P.dbr_assessed), note: wait(waiting.db) },
    ...(has('other_sought_reports') ? [
      { name: 'Sought (other methods) within their records', ok: num(P.other_sought_reports) <= other, note: other > num(P.other_sought_reports) ? `${other - num(P.other_sought_reports)} records found by other methods were screened out or wait` : '' },
      { name: 'Sought − not retrieved − awaiting a decision = assessed (other methods)', ok: num(P.other_sought_reports) - num(P.other_notretrieved_reports) - waiting.other === num(P.other_assessed), note: wait(waiting.other) }] : []),
    { name: `Assessed − excluded = included ${has('new_reports') ? 'reports' : 'studies'}`, ok: dbIn + otIn === included },
    ...(has('new_reports') ? [{ name: 'Studies no more than their reports', ok: num(P.new_studies) <= num(P.new_reports) }] : []),
  ];
}

/**
 * Decisions not yet counted in the flow: what each stage still has to decide (lib/review-counts.mjs, Screening's own count): records at
 * title and abstract, reports at full text (1 Nov 2026: this said 265 undecided at full text by a reduction of its own; a record with no
 * title/abstract decision at all was not counted).
 */
export function pending(s) {
  const c = reviewCounts(s);
  return { screening: c.ta.toDecide, fulltext: c.ft.toDecide };
}

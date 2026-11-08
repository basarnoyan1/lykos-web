// An exported search (RIS, nbib, a workbook) into the library, logged as a run of the database it came from (lib/search-runs.mjs).
// Moved out of lib/search-library.mjs on 31 Oct 2026 with the database registry it now reads (lib/databases.mjs), so neither loads with
// the shell's first view (app/test/startup-graph.test.mjs).
import { lib_bib_names$hash64 as hash } from "../boot.mjs";
import { lib_search_library$scenarioRecords as scenarioRecords, lib_search_library$libraryIndex as libraryIndex, lib_search_library$noteSource as noteSource, lib_search_library$addMainRecords as addMainRecords } from "../boot.mjs";
import { database, nameStem, versionIn } from './databases.mjs';
import { workIndex } from './record-match.mjs';
import { dropRaw } from './ref-import-extra.mjs';
import { scenarioOf, runId, pinRunIds } from './scenario-runs.mjs';
import { runQuery, isPlaceholderQuery } from './search-runs.mjs';

/**
 * The runs an import of these records from `fileName` would log: [{ source, database (an id, or null), version }], one per database, as
 * importInto names them. The import dialog asks for the query of a file of one database's records.
 */
export function importRuns(records, fileName) {
  const out = new Map(), version = versionIn(fileName);
  for (const r of records || []) {
    const named = r?.database || String(fileName).replace(/\.[^.]+$/, ''), db = database(named), source = db?.name || named;
    if (!out.has(source)) out.set(source, { source, database: db?.id || null, version });
  }
  return [...out.values()];
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
 * as a duplicate in the file's search-log entry. A record no identifier joins is matched as the same work by lib/record-match.mjs
 * (DOI spellings, title case, punctuation, accents and translation brackets, first author, year ±1 with volume and page, Scopus's
 * PMID); a record merged away earlier finds the record it was merged into, so a re-run does not bring it back. All of these count
 * as duplicates, so PRISMA's "duplicates
 * removed" includes it and the flow's arithmetic still adds up. An exported
 * search counts toward PRISMA's records identified under the database it came
 * from (RIS DB/DP), or the file's name when it does not say (`kind`: another
 * method, lib/prisma-counts.mjs). `deduplicatedFrom` is how many records the file held before it was deduplicated outside
 * Lykos (EndNote, Rayyan): the difference is kept on the file's first search-log entry as `deduplicatedBefore`, which PRISMA
 * counts as identified and as duplicates removed; a number below the file's records throws. Without `at`
 * nothing is changed: the counts are returned for a preview.
 */
export function importInto(s, records, fileName, { at = null, raw = null, file = '', kind = 'database', deduplicatedFrom = null, warnings = null, scenario: target = null, query = '', queryFile = '' } = {}) {
  // the strategy as it ran (2 Nov 2026): kept on the run when given, never a placeholder; a file of several databases' records takes none
  // what was typed or read from a file loses its surrounding blank lines and trailing white space only: a first line's indentation is kept
  const strategy = runQuery({ query: String(query ?? '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '') });
  if (isPlaceholderQuery(query)) throw new Error(`"${String(query).trim().slice(0, 60)}" names the file, not a query: give the strategy as it ran, or none`);
  const sources = strategy ? importRuns(records, fileName) : [];
  if (sources.length > 1) throw new Error(`${fileName} holds the records of ${sources.length} databases (${sources.map(x => x.source).join(', ')}): a query is one database's; import it without one`);
  // for a protocol scenario (Task 5 Minor 14, 2 Nov 2026): its run goes to s.scenarioSearches with its id pinned and named in the scenario's
  // searches.add, its new records to s.scenarioPapers, never main's (addMainRecords is not called); a record main holds is a duplicate of the run
  // and is not noted on main's record (a note would be a source of main's flow); one another scenario's run found is noted on that record
  const sc = target == null || target === '' || target === 'main' ? null : scenarioOf(s, String(target));
  const before = deduplicatedFrom == null || deduplicatedFrom === '' ? 0 : Number(deduplicatedFrom) - records.length;
  if (!Number.isInteger(before) || before < 0) throw new Error(`${fileName} holds ${records.length} records, so it cannot have been deduplicated from ${deduplicatedFrom}`);
  const fileKept = Boolean(file) || raw?.kept === 'folder' || raw?.kept === 'store';   // the import file is in the folder or the app's store
  const index = libraryIndex(s.papers || []), works = workIndex(s.papers || []);
  const scenario = at ? scenarioRecords(s) : { take: () => null }, scenarioIndex = libraryIndex(s.scenarioPapers || []);
  // a duplicate merged away earlier stands for the record it was merged into (followed to the record the library still holds)
  const held = new Map((s.papers || []).map(p => [p.id, p])), into = new Map((s.merged || []).filter(m => m.dup?.id).map(m => [m.dup.id, m.keepId]));
  const holder = id => { for (let i = 0; i < 20 && id && !held.has(id); i++) id = into.get(id); return held.get(id) || null; };
  const mergedAway = libraryIndex([]);
  for (const m of s.merged || []) { const keep = m.dup && holder(m.keepId); if (keep) { mergedAway.add({ ...m.dup, id: keep.id, key: m.dup.key }); works.alias(m.dup, keep); } }
  const bySource = new Map(), taken = new Set([...(s.papers || []), ...(s.scenarioPapers || [])].map(p => p?.id));
  let added = 0, duplicates = 0, possible = 0, matched = 0;
  for (const r of records) {
    // the database the record or the file names, as lib/databases.mjs names it: a re-run's file ("WebOfScience_v3_2026-10-31.ris") is
    // its database, not a source of its own (31 Oct 2026)
    const named = r.database || fileName.replace(/\.[^.]+$/, '');
    const db = database(named)?.name || named;
    const tally = bySource.get(db) || { n: 0, dup: 0 }; bySource.set(db, tally);
    tally.n++;
    let have = index.find(r), record = r;
    if (!have) { const via = mergedAway.find(r); if (via) have = held.get(via.id) || null; }
    if (have && String(r.key).startsWith('rec-') && !r.doi && !r.pmid && !sameReport(have, r)) {
      // Same title, year and first author, different journal, volume or page: keep it, under a key of its own.
      const key = `${r.key}-${hash(discriminator(r))}`, again = index.find({ key });
      if (again && sameReport(again, r)) have = again;   // this file imported before
      else { have = null; record = { ...r, key }; possible++; }
    }
    if (!have) { const same = works.find(record); if (same) { have = same.paper; matched++; if (record !== r) possible--; } }
    // a scenario's run holds main's record by its runs (Settled 1): the run lists it (`matched`, lib/scenario-runs.mjs recordRuns), and main's
    // record is not noted, so main's flow does not move until the run is made main's (lib/scenarios.mjs assignRun notes it then, as here)
    if (have) { tally.dup++; duplicates++; if (at && !sc) noteSource(have, db); else if (at) (tally.matched ||= new Set()).add(have.id); continue; }
    // a record only a protocol scenario's search had found is main's now, the same record (lib/search-library.mjs scenarioRecords)
    const found = scenarioIndex.find(record);
    if (found && sc) { tally.dup++; duplicates++; if (at) { noteSource(found, nameStem(fileName) !== fileName.replace(/\.[^.]+$/, '') ? fileName.replace(/\.[^.]+$/, '') : db); (tally.matched ||= new Set()).add(found.id); } continue; }
    if (found) { added++; index.add(found); works.add(found); if (at) { scenario.take(found); noteSource(found, db); } continue; }
    // a new record names its database too (31 Oct 2026: a Web of Science file's records, whose RIS has no DB line, named none)
    const paper = { ...record, id: record.key, pdf: null, importFile: fileName, ...(record.database ? {} : { database: db }) };
    if (fileKept) dropRaw(paper);   // the file keeps the lines; the record keeps what was read from them
    index.add(paper); works.add(paper); added++;
    if (at && sc) {
      // one id space for main's and the scenarios' records (spec Settled 1): an id either holds already is given a suffix of the scenario's
      if (taken.has(paper.id)) paper.id = `${paper.id}-${sc.id}`;
      // its run by time as well as by file: a file read from outside the folder gives the run no `file` to name it by (final review I1)
      paper.searchRun = at;
      taken.add(paper.id); scenarioIndex.add(paper); (s.scenarioPapers ||= []).push(paper);
    }
    else if (at) addMainRecords(s, [paper]);
  }
  // the run is its database's, named by the file (its label) and its version when the file name gives one
  const label = nameStem(fileName) !== fileName.replace(/\.[^.]+$/, '') ? fileName.replace(/\.[^.]+$/, '') : '', version = versionIn(fileName);
  const list = Array.isArray(warnings) ? warnings.map(w => String(w).trim()).filter(Boolean) : null;
  // a register's export (ClinicalTrials.gov, WHO ICTRP) is logged as a register, so PRISMA counts it under registers, not databases (1 Nov 2026)
  const kindFor = source => kind === 'database' && database(source)?.kind === 'register' ? 'register' : kind;
  const runs = [...bySource].map(([source, t], i) => ({ source, kind: kindFor(source), ...(database(source) ? { database: database(source).id } : {}),
    ...(label ? { name: label } : {}), ...(version ? { version } : {}), ...(list ? { warnings: list } : {}),
    ...(strategy ? { query: strategy } : {}), ...(strategy && queryFile ? { queryFile: String(queryFile) } : {}), at, retrieved: t.n, total: t.n, ...(t.dup ? { duplicates: t.dup } : {}), ...(before && !i ? { deduplicatedBefore: before } : {}), status: 'complete', imported: true,
    // the file as it was (plan B3): where its copy is kept, and its SHA-256
    ...(file ? { file } : {}), ...(raw ? { raw } : {}), ...(sc ? { scenario: sc.id, ...(t.matched ? { matched: [...t.matched] } : {}) } : {}) }));
  if (at && sc) {
    s.scenarioSearches = [...(s.scenarioSearches || []), ...runs];
    const ids = runs.map(r => { pinRunIds(s, r); return runId(r, s); }), entry = s.protocol.scenarios.find(x => x && String(x.id) === sc.id);
    entry.searches = { ...(entry.searches || {}), add: [...new Set([...(entry.searches?.add || []), ...ids])] };
  } else if (at) s.searches = [...(s.searches || []), ...runs];
  return { added, duplicates, possible, ...(matched ? { matched } : {}), ...(before ? { deduplicatedBefore: before } : {}) };
}



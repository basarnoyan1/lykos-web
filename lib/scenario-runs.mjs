// Protocol scenarios (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Settled 1): which search runs a scenario
// keeps and which records it therefore holds. A scenario is a diff against one review's protocol, stored in protocol.scenarios;
// its searches name runs of the search log by a run id, given lazily (`run-` and the FNV-1a of the run's time and source) and stored
// on the run the first time a scenario names it. Runs and records imported for a scenario only are kept apart from main's
// (s.scenarioSearches, s.scenarioPapers and their merges s.scenarioMerged; Settled 1, amended 1 November 2026, Task 3 fix round 1), so
// every reader of `searches`, `papers` and `merged` reads the main protocol; one id space covers both. Pure: no store; the only cache is
// recordRuns', keyed on the arrays it reads.
import { fnv1a32 } from './project-format.mjs';
import { recordSources } from './prisma-counts.mjs';
import { database } from './databases.mjs';
import { MAIN, runsOf } from './reviews.mjs';
import { lib_review_studies$liveVersion as liveVersion } from "../boot.mjs";

/** The main protocol's scenario id: the registered protocol itself, never an entry of protocol.scenarios. */
export const MAIN_PROTOCOL = 'main';
const list = v => Array.isArray(v) ? v : [];

/** Every run, main's (s.searches) then those imported for a scenario only (s.scenarioSearches): one log, one id space. */
export const allRuns = s => [...list(s?.searches), ...list(s?.scenarioSearches)];
/** Every record, main's (s.papers) then those only a scenario's runs found (s.scenarioPapers). */
export const allPapers = s => [...list(s?.papers), ...list(s?.scenarioPapers)];

const derived = run => `run-${fnv1a32(`${run?.at}\n${run?.source}`).toString(16).padStart(8, '0')}`;
/**
 * Every run's id, in log order: the one stored on it, else derived (`run-` + fnv1a32(`${at}\n${source}`) as 8 lowercase hex digits),
 * with `-2`, `-3`, … when an earlier run or a stored id already has it. Two runs can share a time and source: log_search (change-file.mjs)
 * logs a day's run at 12:00 and allows a second query that day, and a folder scan takes the file's time. The order of the log decides,
 * so the ids read before any is stored are the ids ensureRunIds stores, after a reload too.
 */
function logIds(searches) {
  const taken = new Set(searches.map(r => r?.id).filter(Boolean));
  return searches.map(r => {
    if (r?.id) return r.id;
    const base = derived(r); let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id); return id;
  });
}

/** A run's id: the one stored on it, else derived; with the project `s`, its id in s's log (a colliding derived id suffixed, logIds). */
export function runId(run, s) {
  if (run?.id) return run.id;
  const all = s ? allRuns(s) : [], i = all.indexOf(run);
  return i < 0 ? derived(run) : logIds(all)[i];
}

/** Stores the id on the runs `ids` names (every run when absent), in place; a run that has one keeps it. Answers `st`. */
export function ensureRunIds(st, ids) {
  const want = ids ? new Set(ids) : null, runs = allRuns(st), all = logIds(runs);
  runs.forEach((r, i) => { if (!r.id && (!want || want.has(all[i]))) r.id = all[i]; });
  return st;
}

/**
 * Stores the id of `run` and of every run whose derived id shares its base (the runs a `-2` suffix tells apart), so moving it between
 * the main log and a scenario's leaves every id as it was.
 */
export function pinRunIds(st, run) {
  const base = derived(run), runs = allRuns(st), ids = logIds(runs);
  runs.forEach((r, i) => { if (!r.id && (r === run || derived(r) === base)) r.id = ids[i]; });
  return runId(run, st);
}

/** Every scenario of the project, normalized: absent lists are empty, absent maps empty, the review the main one unless named. */
export function scenariosOf(s) {
  return list(s?.protocol?.scenarios).filter(x => x && x.id && x.id !== MAIN_PROTOCOL).map(x => ({
    id: String(x.id), name: String(x.name || ''), reason: String(x.reason || ''), created: String(x.created || ''), review: x.review || MAIN,
    searches: { add: [...list(x.searches?.add)], remove: [...list(x.searches?.remove)] },
    criteria: { add: [...list(x.criteria?.add)], remove: [...list(x.criteria?.remove)],
      change: x.criteria?.change && typeof x.criteria.change === 'object' && !Array.isArray(x.criteria.change) ? { ...x.criteria.change } : {} },
  }));
}

/** One scenario, normalized; null for the main protocol (also when no id is given: the default is main). An unknown id throws. */
export function scenarioOf(s, id) {
  if (id == null || id === '' || id === MAIN_PROTOCOL) return null;
  const all = scenariosOf(s), sc = all.find(x => x.id === id);
  if (!sc) throw new Error(`no scenario ${id} (scenarios: ${all.map(x => x.id).join(', ') || 'none'})`);
  return sc;
}

const fileBase = f => String(f || '').split(/[\\/]/).pop();
const runDb = r => (database(r.database) || database(r.source) || database(r.name))?.id || '';

/**
 * Each record's runs, Map<recordId, Set<runId>> (a record no run found has no entry). The run its import file's name or its searchRun
 * (a run's `at`) names is its own, and that run's database is settled by it. Each name noted on it (recordSources) that is a run's own
 * `name` gives that run; any other that folds to a database the record has no own run of gives every run of that database not imported
 * for a scenario only (a record entered by hand, a database noted when duplicates merged at import). So removing one run of a
 * database drops the records it brought, and a database run again for a scenario does not take in the old run's records. A duplicate
 * merged into a record (s.merged) brings its own runs the same way. Every run of the log counts here (keptRuns decides which a
 * scenario keeps). Kept while the records, the log and the merges are the same arrays of the same lengths and the run ids (and which
 * scenario each run is imported for) are the same, and, for the store's live project (which is changed in place), the same project version: an edit of a record's importFile,
 * searchRun or databases is a new version, and inside an update nothing is kept. A tool's project changed in place is not seen.
 */
const runsCache = new WeakMap();
export function recordRuns(s) {
  const src = [s?.papers, s?.scenarioPapers, s?.searches, s?.scenarioSearches, s?.merged, s?.scenarioMerged];
  const papers = allPapers(s), searches = allRuns(s), merged = [...list(s?.merged), ...list(s?.scenarioMerged)], ids = logIds(searches);
  const mainRuns = list(s?.searches).length, scen = (r, i) => i >= mainRuns || Boolean(r?.scenario);
  const v = liveVersion(s), sig = `${v ?? ''}|${src.map(x => list(x).length).join('|')}|${ids.map((id, i) => (scen(searches[i], i) ? `${id}@` : id)).join(',')}`;
  const key = s?.papers || runsCache, hit = v === undefined || !s ? null : runsCache.get(key);
  if (hit && hit.src.every((x, i) => x === src[i]) && hit.sig === sig) return hit.out;
  const byFile = new Map(), byAt = new Map(), byName = new Map(), byDb = new Map(), dbOfRun = new Map();
  const add = (m, k, id) => { if (!k) return; let set = m.get(k); if (!set) m.set(k, set = []); if (!set.includes(id)) set.push(id); };
  searches.forEach((r, i) => {
    const id = ids[i], db = runDb(r);
    dbOfRun.set(id, db);
    add(byFile, fileBase(r.file), id); add(byAt, r.at, id); add(byName, r.name, id); if (!scen(r, i)) add(byDb, db, id);
  });
  const dbOf = new Map();   // a few names, asked for at every record
  const into = (set, p) => {
    const own = [...(p.importFile && byFile.get(fileBase(p.importFile)) || []), ...(p.searchRun && byAt.get(p.searchRun) || [])];
    const ownDbs = new Set(own.map(id => dbOfRun.get(id)).filter(Boolean));
    for (const id of own) set.add(id);
    for (const n of recordSources(p)) {
      if (byName.has(n)) { for (const id of byName.get(n)) set.add(id); continue; }
      if (!dbOf.has(n)) dbOf.set(n, database(n)?.id || '');
      const db = dbOf.get(n);
      if (db && !ownDbs.has(db)) for (const id of byDb.get(db) || []) set.add(id);
    }
  };
  const out = new Map();
  const of = id => out.get(id) || new Set();
  for (const p of papers) { if (!p?.id) continue; const set = of(p.id); into(set, p); if (set.size) out.set(p.id, set); }
  for (const m of merged) { if (!m?.dup || !m.keepId) continue; const set = of(m.keepId); into(set, m.dup); if (set.size) out.set(m.keepId, set); }
  // a scenario's run holds the records it found that another protocol already had (`matched`, lib/search-import.mjs importInto)
  searches.forEach((r, i) => { for (const id of list(r?.matched)) { const set = of(id); set.add(ids[i]); out.set(id, set); } });
  if (v !== undefined && s && typeof key === 'object') runsCache.set(key, { src, sig, out });
  return out;
}

/** The runs a protocol starts from: its review's, not failed, not exploratory, and none imported for a scenario only. */
function baseRuns(s, review) {
  const ids = logIds(allRuns(s));
  return new Set(runsOf(s, review).filter(({ r }) => r.status !== 'failed' && !r.exploratory && !r.scenario).map(({ i }) => ids[i]));
}

/** The runs a scenario keeps: its review's (baseRuns) less those `remove` names (a run id, or `db:<id>` for every run of that database), plus `add`. */
export function keptRuns(s, id) {
  const sc = scenarioOf(s, id);
  const kept = baseRuns(s, sc ? sc.review : MAIN);
  if (!sc) return kept;
  const gone = new Set(sc.searches.remove), dbs = new Set(sc.searches.remove.filter(x => String(x).startsWith('db:')).map(x => String(x).slice(3)).filter(Boolean));
  const ids = logIds(allRuns(s));
  list(s.searches).forEach((r, i) => { const rid = ids[i]; if (kept.has(rid) && (gone.has(rid) || dbs.has(runDb(r)))) kept.delete(rid); });
  for (const rid of sc.searches.add) kept.add(rid);
  return kept;
}


/**
 * The records a protocol holds. Main: its records (s.papers). A scenario: main's records less those its review's runs found when none of
 * the runs it keeps did (a record no run of the review found, entered by hand, stays), plus every record a run in its `add` found, main's
 * or one of those only a scenario's runs found (s.scenarioPapers; main's copy of an id wins).
 */
export function memberIds(s, id) {
  const sc = scenarioOf(s, id), papers = list(s?.papers);
  if (!sc) return new Set(papers.filter(p => p?.id).map(p => p.id));
  const runs = recordRuns(s), base = baseRuns(s, sc.review), kept = keptRuns(s, id), added = new Set(sc.searches.add);
  const out = new Set(), some = (mine, pred) => { if (mine) for (const r of mine) if (pred(r)) return true; return false; };
  for (const p of papers) {
    if (!p?.id) continue;
    const mine = runs.get(p.id);
    if (some(mine, r => added.has(r)) || !(some(mine, r => base.has(r)) && !some(mine, r => kept.has(r)))) out.add(p.id);
  }
  for (const p of list(s?.scenarioPapers)) if (p?.id && some(runs.get(p.id), r => added.has(r))) out.add(p.id);
  return out;
}

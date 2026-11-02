// Search runs and the databases they belong to (31 Oct 2026). A search log entry is one run: a database searched on a date with a
// strategy, a count and, when the database's page showed any, its warnings (records not exported, results limited, terms ignored,
// a query truncated). A re-run or an updated search of the same database is another run of that database, never a database of its
// own: each run names its database (`database`, an id of lib/databases.mjs, else its source folded there), and keeps its own
// version, date, strategy, file, counts and warnings as the database's run history. PRISMA counts each database's records once
// across its runs (lib/prisma-counts.mjs identification); the search log, PRISMA-S and the help say so.
//
// `warnings`: a list of the warnings the database showed, as the page worded them; an empty list says they were checked and none
// was shown; absent, nobody recorded whether there were any. `previousVersion`: a run of the review's previous version (PRISMA 2020's
// updated review), kept in the history and out of this version's records identified.
import { database, versionIn } from './databases.mjs';
import { runName, sourceKind, identification, flowArms, isOtherMethod } from './prisma-counts.mjs';

/** Warnings as given: a list, or a text with one warning per line (or separated by " | "); "none" says none was shown. */
export function readWarnings(v) {
  if (v == null) return null;
  const list = (Array.isArray(v) ? v : String(v).split(/\r?\n|\s\|\s/)).map(x => String(x ?? '').trim()).filter(Boolean);
  return list.length === 1 && /^(none|no warnings?|none shown)\.?$/i.test(list[0]) ? [] : list;
}
/** A run's warnings, or null when nobody recorded whether the database showed any. */
export const warningsOf = r => (Array.isArray(r?.warnings) ? r.warnings.map(String).filter(Boolean) : null);
/** 'unrecorded' | 'none' | 'some'. */
export const warningState = r => { const w = warningsOf(r); return w == null ? 'unrecorded' : w.length ? 'some' : 'none'; };

/** The version a run carries or its name, label or file gives ("v3"), else ''. */
export const runVersion = r => String(r?.version || versionIn(r?.name, r?.label, r?.file, r?.source) || '');
/** The database a run belongs to, as lib/databases.mjs names it (null for a method or a source it does not know). */
export const runDatabase = r => (r?.database && database(r.database)) || database(r?.source) || database(r?.name) || database(String(r?.file || '').split(/[\\/]/).pop()) || null;
/** How a run is named in a list: its database, with its version when it has one ("Web of Science v3"). */
export const runLabel = r => [runName(r), runVersion(r)].filter(Boolean).join(' ');

/**
 * Finds one run of the log: its index, its time (`at`), its label or name, or its file's name. Throws when none or several match.
 * Answers { run, index }.
 */
export function findRun(s, ref) {
  const all = s.searches || [], r = String(ref ?? '').trim();
  if (/^\d+$/.test(r) && all[Number(r)]) return { run: all[Number(r)], index: Number(r) };
  const base = f => String(f || '').split(/[\\/]/).pop().toLowerCase();
  const low = r.toLowerCase();
  for (const test of [x => x.at === r, x => String(x.name || '').toLowerCase() === low || runLabel(x).toLowerCase() === low, x => x.file && (String(x.file).toLowerCase() === low || base(x.file) === low)]) {
    const hits = all.map((x, i) => [x, i]).filter(([x]) => test(x));
    if (hits.length === 1) return { run: hits[0][0], index: hits[0][1] };
    if (hits.length > 1) throw new Error(`${r} names ${hits.length} runs (${hits.map(([x, i]) => `${i}: ${runLabel(x)} ${String(x.at || '').slice(0, 10)}`).join('; ')}); give its index or time`);
  }
  throw new Error(`no search run ${r} (runs: ${all.map((x, i) => `${i} ${runLabel(x)} ${String(x.at || x.date || '').slice(0, 10)}`).join('; ')})`);
}

/**
 * The search log as each database's run history, databases and registers first in the order first run, then the other methods: [{ name,
 * kind, count, rule, runs: [{ index, run, label, version, date, retrieved, total, warnings, state, previous }] }]. `count` is what PRISMA
 * counts for it (null for a method or a run outside the flow).
 */
export function runHistory(s) {
  const id = identification(s, flowArms(s)), counted = new Map(id.rows.map(r => [r.name, r]));
  const out = new Map();
  (s.searches || []).forEach((r, index) => {
    const name = r.citationSearch ? r.source || 'Citation searching' : runName(r), kind = r.citationSearch ? 'citation' : sourceKind(r);
    const g = out.get(name) || { name, kind, count: counted.get(name)?.count ?? null, rule: counted.get(name)?.rule || '', runs: [] };
    g.runs.push({ index, run: r, label: runLabel(r), version: runVersion(r), date: String(r.date || r.at || '').slice(0, 10), retrieved: r.retrieved ?? null, total: r.total ?? null,
      warnings: warningsOf(r), state: warningState(r), previous: !!r.previousVersion, inFlow: r.status !== 'failed' && !r.exploratory });
    out.set(name, g);
  });
  return [...out.values()].sort((a, b) => Number(isOtherMethod(a.kind)) - Number(isOtherMethod(b.kind)));
}

/** Runs whose warnings nobody recorded, for a check before submission: [{ index, label, date }]. */
export const unrecordedWarnings = s => (s.searches || []).map((r, index) => ({ r, index }))
  .filter(({ r }) => r.status !== 'failed' && warningState(r) === 'unrecorded').map(({ r, index }) => ({ index, label: runLabel(r), date: String(r.date || r.at || '').slice(0, 10) }));

const syntaxQuery = q => !!q && !/^Imported from /.test(q);
/**
 * What a strategy is checked against (lib/query-check.mjs): the same database's run before it (`last`: { count, date }) and, for each
 * other database of the same kind, its run closest in date with a strategy (`others`: [{ name, date, query }]). `name` is the database's
 * name as a run is counted (runName); `at` the run's time, or now for a strategy being typed; `index` the run itself, left out.
 */
export function checkContext(s, { name = '', at = '', index = -1 } = {}) {
  const runs = (s.searches || []).map((r, i) => ({ r, i })).filter(({ r, i }) => i !== index && !r.citationSearch && r.status !== 'failed');
  const when = x => String(x.r.date || x.r.at || '');
  const t = String(at || new Date().toISOString());
  const db = database(name), own = db?.name || name, kind = db?.kind || 'database';
  const before = runs.filter(x => runName(x.r) === own && when(x) <= t && (x.r.total ?? x.r.retrieved) != null).sort((a, b) => when(b).localeCompare(when(a)))[0];
  const byDb = new Map();
  for (const x of runs) {
    const n = runName(x.r);
    if (n === own || sourceKind(x.r) !== kind || !syntaxQuery(x.r.query)) continue;
    const gap = Math.abs(Date.parse(when(x).slice(0, 10)) - Date.parse(t.slice(0, 10))) || 0, was = byDb.get(n);
    if (!was || gap < was.gap || (gap === was.gap && when(x) > when(was.x))) byDb.set(n, { x, gap });
  }
  return { last: before ? { count: before.r.total ?? before.r.retrieved, date: when(before).slice(0, 10) } : null,
    others: [...byDb].map(([n, { x }]) => ({ name: n, date: when(x).slice(0, 10), query: x.r.query })) };
}

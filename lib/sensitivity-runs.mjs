// Sensitivity re-runs of the stored pooled results (28 Oct 2026: the authors asked for "without Özer 2021" and "without the overlapping studies";
// each was a hand edit of the inputs and a second run). A run leaves out named studies, or the studies of an overlap group but one (the group's
// `keep`, else the study with most patients, as the synthesis counts them: lib/synth-plan.mjs), and pools every outcome again with the model and
// transformation its stored result was run with. The stored result is never replaced: a run is reported beside it and, when saved, kept in
// `s.synthesis.sensitivity[key]`, whose numbers the manuscript cites as `sensitivity.<key>.<outcome id>.*` (lib/results.mjs).
// Pooled proportions are refitted in JavaScript (lib/meta-pool.mjs, metafor's numbers); a result only R fits (a comparison between arms, a model
// JavaScript does not have) is listed with the reason, not guessed. Pure.
import { lib_outcomes$outcomes as outcomes, lib_outcomes$analysisOf as analysisOf } from "../boot.mjs";
import { pooledInputs, pooledInputStatus } from './analysis-inputs.mjs';
import { handlesProportion, poolProportion } from './meta-pool.mjs';
import { isContrast } from './contrast-counts.mjs';
import { withQI2 } from './i2-q.mjs';
import { scenarioView } from './scenarios.mjs';
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";
// the included records, as lib/review-ledger.mjs counts them (that module brings the dependency graph, which the shell's first view need not load)
const includedIds = s => Object.entries(s.fulltext || {}).filter(([, d]) => d?.decision === 'include').map(([id]) => id);

const fold = t => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
const labelOf = (s, id) => (s.papers || []).find(p => p.id === id)?.label || id;

/** The record a name gives ("Özer 2021", "Ozer 2021", an id or a DOI), included studies first; throws when none or several match. */
export function studyRef(s, name) {
  const n = fold(name), inc = new Set(includedIds(s)), papers = s.papers || [];
  const exact = papers.filter(p => p.id === name || p.key === name || (p.doi && fold(p.doi) === n));
  if (exact.length) return exact[0].id;
  const byLabel = papers.filter(p => fold(p.label) === n), included = byLabel.filter(p => inc.has(p.id));
  const hits = included.length ? included : byLabel;
  if (hits.length === 1) return hits[0].id;
  if (!hits.length) throw new Error(`no study "${name}"`);
  throw new Error(`"${name}" names ${hits.length} studies (${hits.map(p => p.id).join(', ')}): give the id or the DOI`);
}

const pick = a => (a ? { estimate: a.estimate ?? a.est ?? null, lo: a.lo ?? null, hi: a.hi ?? null, k: a.k ?? null, studies: a.studies ?? null, i2: a.i2 ?? null, tau2: a.tau2 ?? null } : null);
const pooled = s => outcomes(s).filter(o => !o.hidden && analysisOf(s, o.id));
const kindOf = (s, oid, a) => { const d = (s.outcomes || []).find(x => x.id === oid)?.derived; return isContrast(d) ? 'contrast' : d && a.derived ? 'proportion' : 'other'; };
const rowsOf = (s, oid, a) => pooledInputs(s, a.moderator || '', 'PR', oid).ready;

/**
 * The studies a run leaves out: `{ removed: Map(id → why), kept: [{ group, keep }] }`. `overlap` is true (every group), a group's id, or null;
 * a group's kept study is its `keep`, else the one with most patients in any pooled outcome.
 */
export function leftOut(s, { without = [], overlap = null } = {}) {
  const removed = new Map();
  for (const n of without) removed.set(studyRef(s, n), 'named');
  const kept = [];
  if (overlap) {
    const groups = (s.synthesis?.overlap || []).filter(g => overlap === true || g.id === overlap);
    if (!groups.length) throw new Error(overlap === true ? 'no overlap group (change op set_overlap makes one)' : `no overlap group "${overlap}"`);
    const size = new Map();
    for (const o of pooled(s)) { const a = analysisOf(s, o.id); if (kindOf(s, o.id, a) !== 'proportion') continue;
      const per = new Map(); for (const u of rowsOf(s, o.id, a)) per.set(u.paperId, (per.get(u.paperId) || 0) + (u.n || 0));
      for (const [id, n] of per) size.set(id, Math.max(size.get(id) || 0, n)); }
    for (const g of groups) {
      const keep = g.keep ?? [...g.studies].sort((x, y) => (size.get(y) || 0) - (size.get(x) || 0))[0];
      kept.push({ group: g.id, keep });
      for (const id of g.studies) if (id !== keep) removed.set(id, `overlap ${g.id}`);
    }
  }
  return { removed, kept };
}

/** A key a manuscript can cite: "without-ozer-2021", "without-overlap". */
export const runKey = ({ without = [], overlap = null } = {}) => ['without', ...(overlap ? [overlap === true ? 'overlap' : `overlap-${overlap}`] : []), ...without]
  .map(x => fold(x).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean).join('-');

/**
 * One re-run: `{ key, label, without: [ids], overlap, kept: [{ group, keep }], left: [labels], outcomes: [{ id, name, measure, method, main, run,
 * left: [labels], reason? }] }`. `outcome` limits it to one outcome id. `main` is the stored result, `run` the one without the studies (null with a
 * reason when it was not refitted).
 */
export function sensitivityRun(s, { without = [], overlap = null, outcome = null } = {}) {
  const { removed, kept } = leftOut(s, { without, overlap });
  const list = pooled(s).filter(o => !outcome || o.id === outcome);
  if (outcome && !list.length) throw new Error(`no pooled result for outcome "${outcome}"`);
  const out = [];
  for (const o of list) {
    const a = analysisOf(s, o.id), base = { id: o.id, name: o.name, measure: a.measure || o.measure, method: a.method || 'REML', main: pick(a) };
    if (pooledInputStatus(s, a, o.id) === 'stale') base.stale = true;
    const kind = kindOf(s, o.id, a);
    if (kind !== 'proportion') { out.push({ ...base, run: null, left: [], reason: kind === 'contrast' ? 'a comparison between arms is fitted in R: run it in Analysis' : 'fitted in R: run it in Analysis' }); continue; }
    const all = rowsOf(s, o.id, a), rows = all.filter(u => !removed.has(u.paperId)).map(u => ({ label: u.label, study: u.paperId, events: u.events, n: u.n, level: u.subgroup }));
    const left = [...new Set(all.filter(u => removed.has(u.paperId)).map(u => u.label))];
    const transform = a.measure === 'PFT' ? 'PFT' : 'PLO', method = a.method || 'REML';
    if (!left.length) { out.push({ ...base, run: base.main, left, reason: 'none of the studies left out is in this outcome' }); continue; }
    if (!handlesProportion({ method, transform }, rows)) { out.push({ ...base, run: null, left, reason: rows.length < 2 ? 'fewer than two arms remain' : `the ${method} model is fitted in R: run it in Analysis` }); continue; }
    const res = poolProportion(rows, { method, transform });
    if (!res) { out.push({ ...base, run: null, left, reason: 'the fit did not converge in JavaScript: run it in Analysis' }); continue; }
    out.push({ ...base, run: pick(withQI2({ ...res, ...(a.moderator ? { moderator: a.moderator } : {}) })), left });
  }
  const names = [...removed.keys()].map(id => labelOf(s, id));
  const label = [without.length ? `Without ${without.map(n => labelOf(s, studyRef(s, n))).join(', ')}` : '',
    overlap ? `${without.length ? 'and' : 'Without'} the overlapping studies (${kept.map(k => `${labelOf(s, k.keep)} kept`).join('; ')})` : ''].filter(Boolean).join(' ');
  return { key: runKey({ without, overlap }), label, without: without.map(n => studyRef(s, n)), overlap: overlap || null, kept, left: names, outcomes: out };
}

/**
 * A protocol scenario's pooled estimates (spec 2026-11-01-protocol-scenarios, Settled 7): `{ outcomes: [{ id, name, measure, method, main,
 * run, k, n, reason? }] }`, each stored pooled outcome refitted on the rows of the scenario's view (lib/scenarios.mjs scenarioView) as
 * sensitivityRun refits it (proportions in JavaScript; any other carries its reason, run null). `n` is the scenario's studies, `k` those
 * of them with rows: a gained study without values is pooled once it is extracted, into the one pool.
 */
export function scenarioPool(s, id) {
  const view = scenarioView(s, id), n = reviewCounts(view).studies, out = [];
  for (const o of pooled(s)) {
    const a = analysisOf(s, o.id), base = { id: o.id, name: o.name, measure: a.measure || o.measure, method: a.method || 'REML', main: pick(a), n };
    const kind = kindOf(s, o.id, a);
    if (kind !== 'proportion') { out.push({ ...base, run: null, k: null, reason: kind === 'contrast' ? 'a comparison between arms is fitted in R: run it in Analysis' : 'fitted in R: run it in Analysis' }); continue; }
    const rows = rowsOf(view, o.id, a).map(u => ({ label: u.label, study: u.paperId, events: u.events, n: u.n, level: u.subgroup }));
    const k = new Set(rows.map(r => r.study)).size, transform = a.measure === 'PFT' ? 'PFT' : 'PLO', method = a.method || 'REML';
    if (!handlesProportion({ method, transform }, rows)) { out.push({ ...base, run: null, k, reason: rows.length < 2 ? 'fewer than two arms with data' : `the ${method} model is fitted in R: run it in Analysis` }); continue; }
    const res = poolProportion(rows, { method, transform });
    out.push(res ? { ...base, run: pick(withQI2({ ...res, ...(a.moderator ? { moderator: a.moderator } : {}) })), k } : { ...base, run: null, k, reason: 'the fit did not converge in JavaScript: run it in Analysis' });
  }
  return { outcomes: out };
}

/** What a saved run stores: its definition and, per outcome, the run's numbers and the main result's as they were. */
export function savedForm(run, at = new Date().toISOString()) {
  return { key: run.key, label: run.label, without: run.without, ...(run.overlap ? { overlap: run.overlap } : {}), kept: run.kept, left: run.left, at,
    outcomes: Object.fromEntries(run.outcomes.map(o => [o.id, { name: o.name, measure: o.measure, method: o.method, main: o.main, run: o.run, left: o.left, ...(o.reason ? { reason: o.reason } : {}) }])) };
}
/** The saved runs, in the order they were saved. */
export const savedRuns = s => Object.values(s.synthesis?.sensitivity || {}).filter(r => r && r.key).sort((a, b) => String(a.at).localeCompare(String(b.at)));
/** Stores a run (replacing one of the same key); the stored pooled results are untouched. */
export function saveRun(st, run, at) {
  st.synthesis = { ...(st.synthesis || {}), sensitivity: { ...(st.synthesis?.sensitivity || {}), [run.key]: savedForm(run, at) } };
  return st;
}
/** The run again from its saved definition, with the project as it is now. */
export const rerun = (s, saved) => sensitivityRun(s, { without: saved.without || [], overlap: saved.overlap || null });

const PROPORTION = /^(PR|PLO|PFT|PLN|PAS|PRAW)$/i;
const n2 = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(d));
/** "8.5% (95% CI 6.0 to 11.9), k 20, I² 55.7%": a proportion in percent, any other measure as it is. */
export function estimateText(x, measure) {
  if (!x || x.estimate == null) return '–';
  const p = PROPORTION.test(String(measure || '')), f = v => (p ? `${n2(100 * v, 1)}` : n2(v));
  return `${f(x.estimate)}${p ? '%' : ''} (95% CI ${f(x.lo)} to ${f(x.hi)}), k ${x.k ?? '–'}${x.studies != null && x.studies !== x.k ? ` (${x.studies} studies)` : ''}, I² ${n2(x.i2, 1)}%`;
}
/** One outcome's line: the main result, then the run's (or why there is none). */
export const outcomeLine = o => `${o.name}: ${estimateText(o.main, o.measure)} → ${o.run ? estimateText(o.run, o.measure) : `not re-run (${o.reason})`}${o.run && o.reason ? ` (${o.reason})` : ''}`;

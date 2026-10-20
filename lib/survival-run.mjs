// One survival analysis, start to finish: the rows the settings choose, the
// Kaplan–Meier summary, the reverse-KM follow-up, the tests, the restricted
// mean survival, the Cox model, the figure, and the legacy result the rest of
// the app reads (plan §4.8, amended 2026-09-29).
//
// Every number comes from an R script built in lib/survival.mjs and run by
// `exec(script)` (the app's engine, or native R in a test); nothing is computed
// here beyond what a script returns, except the E-value, a closed form on the
// hazard ratio.
import { survivalRowsFrom, DEFAULT_COLUMNS } from './ipd.mjs';
import { kmScript, kmShape, reverseKmScript, reverseKmShape, logrankScript, logrankShape, rmstScript, rmstShape, coxScript, coxShape,
  runJson, eValue, medianFollowUp, maxTauAtRisk, groupLevels } from './survival.mjs';
import { kmFigure } from './survival-fig.mjs';
import { figureTokens } from './figure-style.mjs';

export const DEFAULT_SPEC = { group: undefined, bins: [], reference: '', landmarks: [12, 24, 36], taus: [], landmarkStart: 0, cluster: true, covariates: [], strata: '',
  restrict: null, dropCensoredBy: 0 };

const nums = text => String(text ?? '').split(/[\s,;]+/).map(Number).filter(x => Number.isFinite(x) && x >= 0);
/** Numbers typed as "12, 24 36" into a list, kept in order and without repeats. */
export const parseList = text => [...new Set(Array.isArray(text) ? text.map(Number).filter(Number.isFinite) : nums(text))];

/**
 * The rows a spec chooses: the group column (or one group), cut points for a
 * number column, the patients a restriction leaves in, patients censored by a
 * given month left out, and a landmark. Returns what `survivalRowsFrom` does.
 */
export function rowsFor(people, cols, spec = {}, opts = {}) {
  const s = { ...DEFAULT_SPEC, ...spec };
  const restrict = s.restrict?.col && (s.restrict.values || []).length ? s.restrict : null;
  const timeCol = cols.find(c => c.role === 'time'), eventCol = cols.find(c => c.role === 'event');
  const subset = p => {
    if (restrict && !restrict.values.map(String).includes(String(p[restrict.col] ?? '').trim())) return false;
    return true;
  };
  const r = survivalRowsFrom(people, cols, { group: s.group, bins: s.bins?.length ? s.bins : undefined, subset: restrict ? subset : undefined,
    cluster: s.cluster === false ? null : undefined, strata: s.strata || undefined, landmark: s.landmarkStart || 0, covariates: (s.covariates || []).map(c => c.id), ...opts });
  // a censoring at or before a month is a follow-up too short to say anything about the event: the sensitivity analysis leaves them out
  if (s.dropCensoredBy > 0) {
    const keep = r.rows.filter(x => !(x.event === 0 && x.time <= s.dropCensoredBy));
    const gone = r.rows.filter(x => x.event === 0 && x.time <= s.dropCensoredBy);
    return { ...r, rows: keep, excluded: [...r.excluded, ...gone.map(x => ({ p: people.find(p => p.id === x.id), why: `censored by ${s.dropCensoredBy} months` }))] };
  }
  void timeCol; void eventCol;
  return r;
}

/** The scientific settings as requested, before the run chooses a reference or RMST horizon. */
export function survivalSpec(spec = {}) {
  const s = { ...DEFAULT_SPEC, ...spec };
  return { group: s.group ?? (s.group === null ? null : '@role'), bins: s.bins || [], reference: s.reference || '',
    landmarks: s.landmarks || [], taus: s.taus || [], landmarkStart: s.landmarkStart || 0, cluster: s.cluster !== false,
    strata: s.strata || '', covariates: s.covariates || [], restrict: s.restrict || null, dropCensoredBy: s.dropCensoredBy || 0 };
}

/** A deterministic scientific-input snapshot. Row order and unrelated patient notes do not change it. */
export function survivalInputSnapshot(people, cols, spec = {}) {
  const { rows, excluded, levels } = rowsFor(people, cols, spec);
  const byId = new Map(people.map(p => [p.id, p]));
  const identity = p => [p?.id, p?.study_id ?? null, p?.reconstructed || null];
  const ordered = xs => xs.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({ version: 1, spec: survivalSpec(spec), levels,
    rows: ordered(rows.map(r => [...identity(byId.get(r.id)), r.time, r.event, r.group, r.cluster, r.strata ?? null,
      Object.entries(r.x || {}).sort(([a], [b]) => a.localeCompare(b))])),
    excluded: ordered(excluded.map(x => [...identity(x.p), x.why])) });
}

/** Old results are readable, but cannot establish freshness or an analysed population without a snapshot. */
export function survivalInputStatus(state, result = state.survival, spec = result?.ext?.inputSpec ?? result?.ext?.spec) {
  if (!result) return 'none';
  if (!result.ext?.inputSnapshot || !result.ext?.inputSpec) return 'untracked';
  try {
    return result.ext.inputSnapshot === survivalInputSnapshot(state.participants || [], state.ipdColumns || DEFAULT_COLUMNS, spec) ? 'current' : 'stale';
  } catch { return 'stale'; } // a removed or reassigned column is a changed input, not an unreadable project
}

/** The figure names the requested comparison; failed stratified tests never fall back silently. */
export function survivalFigureOptions(tests, spec = {}) {
  if (!spec.strata) return { p: tests?.logrank?.p ?? undefined };
  const p = tests?.stratified?.p;
  return p == null ? {} : { pText: 'Stratified log-rank p ' + (p < .001 ? '< 0.001' : '= ' + p.toFixed(3)) };
}

/** The saved chat curve for a medium: the stored publication drawing, or (when its settings were kept) the same curve drawn at the screen size. */
export function chatSurvivalPlot(analysis, medium = 'export') {
  const ext = analysis?.ext;
  if (medium === 'export' || !ext?.figure || !ext.km) return analysis?.plot || '';
  return kmFigure(ext.km, { title: ext.figure.title, xLabel: 'Months', ci: ext.figure.ci, style: figureTokens(null, { medium }) });
}

/** The KM result and tests as the flat shape older readers (results, the assistant's facts, progress) know. */
export function legacyResult({ km, tests, cox }, rows, plot, at) {
  const groups = km.by.map(g => g.group);
  const lm = km.landmarks;
  const sTime = [], sSurv = [], sLower = [], sUpper = [], strata = [];
  for (const g of km.by) for (const s of g.survival) { strata.push(`grp=${g.group}`); sTime.push(s.time); sSurv.push(s.surv); sLower.push(s.lo ?? null); sUpper.push(s.hi ?? null); }
  const legacyKm = { groups, n: km.by.map(g => g.n), events: km.by.map(g => g.events), median: km.by.map(g => g.median.est ?? null), atTimes: lm, strata, sTime, sSurv, sLower, sUpper,
    logrankP: tests?.logrank?.p ?? null, stratifiedLogrankP: tests?.stratified?.p ?? null, gehanP: tests?.gehanBreslow?.p ?? null };
  const pair = tests && tests.pairwise.length ? { a: tests.pairwise.map(x => x.a), b: tests.pairwise.map(x => x.b), p: tests.pairwise.map(x => x.p), padj: tests.pairwise.map(x => x.padj) } : null;
  const legacyCox = cox ? { reference: cox.reference, terms: cox.terms.map(t => t.term), hr: cox.terms.map(t => t.hr), lower: cox.terms.map(t => t.lo), upper: cox.terms.map(t => t.hi),
    p: cox.terms.map(t => t.p), events: cox.events, n: cox.n, phP: cox.phGlobalP, epv: cox.epv } : null;
  return { km: legacyKm, plot, pair, cox: legacyCox, at, n: rows.length, events: rows.filter(r => r.event).length };
}

/**
 * Runs everything the spec asks for on `rows`. `exec(script, onProgress)`
 * executes an R script and returns its parsed JSON (default: the app's engine).
 * A stage that cannot be estimated (a Cox model with a group without events,
 * a restricted mean past the follow-up) is reported in `stages`, and the rest
 * still runs.
 */
export async function runSurvival(rows, spec = {}, { exec = runJson, onProgress = () => {}, levels, groupName = null, title = '', people, columns, papers, excluded = [] } = {}) {
  const s = { ...DEFAULT_SPEC, ...spec };
  const inputSpec = structuredClone(s);
  const inputSnapshot = people && columns ? survivalInputSnapshot(people, columns, inputSpec) : null;
  const lev = groupLevels(rows, levels);
  const multi = lev.length > 1;
  const stages = {};
  const attempt = async (name, fn) => { try { return await fn(); } catch (err) { stages[name] = String(err?.message || err).slice(0, 200); return null; } };
  onProgress('Kaplan–Meier');
  const km = kmShape(await exec(kmScript(rows, { landmarks: s.landmarks, levels: lev }), onProgress));
  const reverse = await attempt('reverse', async () => reverseKmShape(await exec(reverseKmScript(rows, { levels: lev }), onProgress)));
  const tests = multi ? await attempt('tests', async () => logrankShape(await exec(logrankScript(rows, { levels: lev }), onProgress))) : null;
  const ref = s.reference && lev.includes(s.reference) ? s.reference : [...lev].sort((a, b) => rows.filter(r => r.group === b).length - rows.filter(r => r.group === a).length)[0];
  // the longest horizon every group still has two patients at risk at (the rule a review reported its 36 months by), when none is asked for
  const taus = s.taus?.length ? s.taus : [Math.max(1, maxTauAtRisk(km, 2) ?? 36)];
  const rm = multi || taus.length ? await attempt('rmst', async () => rmstShape(await exec(rmstScript(rows, { tau: taus, reference: ref, levels: lev }), onProgress))) : null;
  const clustered = s.cluster !== false && new Set(rows.map(r => r.cluster)).size < rows.length;
  const cox = multi || (s.covariates || []).length ? await attempt('cox', async () => {
    const c = coxShape(await exec(coxScript(rows, { reference: ref, levels: lev, cluster: clustered, covariates: s.covariates || [] }), onProgress), { covariates: s.covariates || [] });
    c.terms = c.terms.map(t => ({ ...t, eValue: eValue({ hr: t.hr, lo: t.lo, hi: t.hi }) }));
    return c;
  }) : null;
  const plot = kmFigure(km, { title, xLabel: 'Months', ci: false, ...survivalFigureOptions(tests, s), style: figureTokens(null, { medium: 'export' }) });
  const at = new Date().toISOString();
  const reports = papers ? new Map(papers.map(p => [p.id, p])) : null;
  const person = p => ({ id: p.id, study_id: p.study_id ?? null, reconstructed: p.reconstructed || null,
    ...(reports ? { institutional: !reports.has(p.study_id) || !!reports.get(p.study_id)?.institutional } : {}) });
  const source = new Map((people || rows).map(p => [p.id, p]));
  const population = { participants: rows.map(r => person(source.get(r.id) || r)),
    excluded: excluded.map(x => ({ ...person(x.p), why: x.why })) };
  const ext = { spec: { ...s, reference: ref, taus }, inputSpec, inputSnapshot, inputRows: structuredClone(rows), population, groupName, groups: lev, reference: ref, km, reverse, tests, rmst: rm, cox, followUp: medianFollowUp(rows), stages, at, clustered,
    counts: { n: rows.length, events: rows.filter(r => r.event).length, clusters: new Set(rows.map(r => r.cluster)).size } };
  return { ...legacyResult({ km, tests, cox }, rows, plot, at), ext };
}

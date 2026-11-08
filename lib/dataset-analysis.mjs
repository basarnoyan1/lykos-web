// Statistics on the researcher's own data (plan amendment "Statistics on the
// researcher's own data", 2026-09-29): the analyses the Datasets view's Analyse
// page runs on a dataset (lib/datasets.mjs) or on the patient table
// (lib/ipd.mjs), Table 1, and the analyses kept with the project.
//
// Everything here is pure except keep/remove, which go through the store. A
// run takes a dataset-shaped source ({ id, name, columns, rows }), the kind of
// analysis, its inputs (column ids) and options, and returns a plain,
// JSON-safe result: tables of formatted cells, the method line, warnings, the
// n used and dropped, a results sentence and a plot description. The numbers
// come from the statistics modules (stats-tests, stats-tables,
// stats-regression, stats-agreement, clinical-epi); this module only chooses,
// splits and formats. A kept result stores a hash of the columns it used, so a
// later edit to those columns marks it stale (`isStale`).
import { store$update as update, store$get as get } from "../boot.mjs";
import { keepDatasetEntry } from './result-versions.mjs';
import { lib_dataset_analysis_core$columnHash as columnHash, lib_dataset_analysis_core$usedColumns as usedColumns, lib_dataset_analysis_core$isStale as isStale, lib_dataset_analysis_core$analysisOf as analysisOf, lib_dataset_analysis_core$schemaHash as schemaHash, lib_dataset_analysis_core$identityHash as identityHash } from "../boot.mjs";
export { lib_dataset_analysis_core$PATIENT_SOURCE as PATIENT_SOURCE, lib_dataset_analysis_core$patientDataset as patientDataset, lib_dataset_analysis_core$analysisSources as analysisSources, lib_dataset_analysis_core$sourceById as sourceById, lib_dataset_analysis_core$columnHash as columnHash, lib_dataset_analysis_core$usedColumns as usedColumns, lib_dataset_analysis_core$isStale as isStale, lib_dataset_analysis_core$savedAnalyses as savedAnalyses, lib_dataset_analysis_core$savedFor as savedFor, lib_dataset_analysis_core$currentDatasetAnalyses as currentDatasetAnalyses, lib_dataset_analysis_core$ANALYSES as ANALYSES, lib_dataset_analysis_core$analysisOf as analysisOf } from "../boot.mjs";   // the sources, the catalogue and the kept results live there so that they can be read without the statistics
import { lib_datasets$cellValue as cellValue } from "../boot.mjs";
import { pValue, isIdentifier, descriptiveKind, descriptiveConverter } from './describe.mjs';
import {
  tTestTwo, tTestPaired, anovaOneWay, leveneTest, bartlettTest, tukeyHSD, gamesHowell, mannWhitney,
  wilcoxonSignedRank, kruskalTest, signTest, shapiroWilk, andersonDarling, qqPoints, describeWithCI,
} from './stats-tests.mjs';
import { chiSquareTest, fisherExact, mcnemarTest, correlation, oddsRatio, riskRatio, riskDifference } from './stats-tables.mjs';
import { linearRegression, logisticRegression, poissonRegression, univariableScreen, regressionTable } from './stats-regression.mjs';
import { iccAll, blandAltman, cohenKappa, fleissKappa, gwetAC1, krippendorffAlpha, cronbachAlpha, percentAgreement } from './stats-agreement.mjs';
import { diagnostic2x2, roc, rocCompare, optimalCutoff, calibration, decisionCurve } from './clinical-epi.mjs';
import { consensusRound, CONSENSUS_SCALES, onScale } from './consensus.mjs';
import { ratioOfOddsRatios, ROR_METHODS } from './ror.mjs';
import { cusum } from './cusum.mjs';
import { runChart, controlChart } from './spc.mjs';
import { bootstrapCe, ceSummary } from './cea.mjs';
import { dispositionOf, outcomeRates, webRates, likertItem } from './survey.mjs';
import { recommendations } from './guideline.mjs';
import { levelOf, imprecision, heterogeneity, incoherence, confidence } from './cinema.mjs';
import { fmtNumber } from './output-charts.mjs';
import { kmEstimate, logRank } from './km-js.mjs';
import { niceTicks } from './survival-fig.mjs';
import { analysisSvg, xySvg } from './analysis-svg.mjs';
import { developPrediction } from './prediction-development.mjs';
// Captured in the same exact source pack for the separate propensity view.
import { replayPropensity, propensitySnapshot } from './propensity.mjs';
export { replayPropensity, propensitySnapshot };

// ---- sources ------------------------------------------------------------------


// ---- columns ------------------------------------------------------------------

const text = v => { const t = String(v ?? '').trim(); return t ? t : null; };
const levelSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const isNumericCol = c => c.type === 'number' || c.type === 'integer';

/** The distinct non-empty values of a column, numbers in numeric order. */
export function levelsOf(d, id) {
  return [...new Set(d.rows.map(r => text(r[id])).filter(v => v != null))].sort(levelSort);
}

/**
 * Whether a column can fill a role: 'numeric' (number or whole number),
 * 'category' (a category column, or any non-date column with 2 to 12 distinct
 * values), 'binary' (exactly two distinct values), 'any' (numeric or category).
 */
export function fitsRole(d, c, role) {
  if (role === 'numeric') return isNumericCol(c);
  if (c.type === 'date') return false;
  const k = levelsOf(d, c.id).length;
  if (role === 'binary') return k === 2;
  const category = c.type === 'category' ? k >= 1 : k >= 2 && k <= 12;
  if (role === 'category') return category;
  if (role === 'any') return isNumericCol(c) || category;
  return true;
}
export const columnsFor = (d, role) => d.columns.filter(c => fitsRole(d, c, role));
export const baselineVariables = d => columnsFor(d, 'any').filter(c => !isIdentifier(c, d.rows)).map(c => c.id);

const colOf = (d, id) => { const c = d.columns.find(x => x.id === id); if (!c) throw new Error('Choose the variables'); return c; };
const nums = (d, id) => { const c = colOf(d, id); return d.rows.map(r => cellValue(r[id], isNumericCol(c) ? c.type : 'number')); };
const labs = (d, id) => d.rows.map(r => text(r[id]));

// ---- the stale hash -------------------------------------------------------------

export const PRIMARY_ANALYSIS_VERSION = 'primary-analysis-2026-10-01-v1';
/** Only analysis inputs (plus the row key for provenance), in their original order. */
export function frozenDataset(d, kind, inputs) {
  const ids = new Set([...usedColumns(inputs, kind), ...(d.rowKey ? [d.rowKey] : [])]);
  const columns = d.columns.filter(c => ids.has(c.id));
  return structuredClone({ id: d.id, name: d.name, ...(d.rowKey ? { rowKey: d.rowKey } : {}), ...(d.rowIds ? { rowIds: d.rowIds } : {}), columns,
    rows: d.rows.map(r => Object.fromEntries(columns.map(c => [c.id, r[c.id] ?? '']))) });
}
export function dataDictionary(d) {
  return { datasetId: d.id, name: d.name, rowKey: d.rowKey || null, identitySource: d.rowIds ? 'Participant id, retained as rowIds in the frozen input' : d.rowKey ? 'Dataset key column' : 'One-based row position', columns: structuredClone(d.columns || []), rules: structuredClone(d.rules || []) };
}

/** Complete-case row provenance; Table 1 uses a separate population per variable. */
export function analysisPopulation(d, kind, inputs, result) {
  if (result?.population) return structuredClone(result.population);
  const ids = usedColumns(inputs, kind), spec = analysisOf(kind);
  const excluded = [], included = [];
  d.rows.forEach((r, index) => {
    const rowId = String(d.rowIds?.[index] ?? (d.rowKey ? r[d.rowKey] ?? '' : index + 1)), reasons = [];
    if (kind === 'table1' && inputs.group && text(r[inputs.group]) == null) reasons.push(`Missing ${colOf(d, inputs.group).label || inputs.group}`);
    if (kind !== 'table1') for (const id of ids) {
      const c = colOf(d, id), value = isNumericCol(c) ? cellValue(r[id], c.type) : text(r[id]);
      if (value == null) reasons.push(`Missing or invalid ${c.label || id}`);
      else if (kind === 'poisson' && id === inputs.exposure && !(value > 0)) reasons.push(`Nonpositive ${c.label || id}`);
    }
    (reasons.length ? excluded : included).push({ index, rowId, ...(reasons.length ? { reasons } : {}) });
  });
  return { policy: kind === 'table1' ? 'Variable-specific available observations; missing counts are reported in Table 1.' : 'Complete cases for the declared analysis columns.',
    sourceRows: d.rows.length, included, excluded, used: result?.n?.used ?? included.length, dropped: result?.n?.dropped ?? excluded.length,
    inputs: spec?.inputs.filter(i => !i.levelOf).map(i => i.key) || [] };
}

/** A frozen, versioned recipe. Missing original snapshots are explicit. */
export function analysisReplay(entry, s = get()) {
  return { format: 'lykos-primary-analysis', version: 1, id: entry.id, at: entry.at, implementation: entry.implementation || null,
    analysis: { kind: entry.kind, inputs: structuredClone(entry.inputs || {}), options: structuredClone(entry.options || {}) },
    data: entry.frozenData ? structuredClone(entry.frozenData) : null, rowsVersion: entry.rowsVersion, schemaVersion: entry.schemaVersion || null, provenanceVersion: entry.provenanceVersion || null,
    population: entry.population ? structuredClone(entry.population) : null, result: structuredClone(entry.result),
    currentSourceStatus: isStale(entry, s) ? 'changed-or-unavailable' : 'current' };
}
export function replayAnalysis(recipe) {
  if (recipe?.format !== 'lykos-primary-analysis' || recipe.version !== 1) throw new Error('Unsupported primary analysis recipe');
  if (!recipe.data?.columns || !recipe.data?.rows) throw new Error('The original input rows were not kept; rerun and keep the analysis');
  if (recipe.implementation?.version && recipe.implementation.version !== PRIMARY_ANALYSIS_VERSION) throw new Error('The recipe requires a different analysis implementation');
  const { kind, inputs, options } = recipe.analysis || {}, ids = usedColumns(inputs, kind);
  if (columnHash(recipe.data, ids) !== recipe.rowsVersion || recipe.schemaVersion && schemaHash(recipe.data, ids) !== recipe.schemaVersion) throw new Error('The frozen analysis inputs do not match their recorded hashes');
  if (recipe.provenanceVersion && identityHash(recipe.data) !== recipe.provenanceVersion) throw new Error('The frozen row identities do not match their recorded hash');
  return runAnalysis(recipe.data, kind, inputs, options);
}

/** The entry kept for a result: what was asked, what came out, and the hash of the data it read. */
export function analysisEntry(d, kind, inputs, options, result, at = new Date().toISOString(), engine = null) {
  const ids = usedColumns(inputs, kind), data = frozenDataset(d, kind, inputs);
  return { id: `da${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, datasetId: d.id, kind,
    inputs: structuredClone(inputs), options: structuredClone(options), result: structuredClone(result), method: result.method, at,
    rowsVersion: columnHash(d, ids), schemaVersion: schemaHash(d, ids), provenanceVersion: identityHash(d), frozenData: data, population: analysisPopulation(data, kind, inputs, result),
    implementation: { version: PRIMARY_ANALYSIS_VERSION, engineFingerprint: engine?.fingerprint || null } };
}
/** Keeps a result: the same analysis of the same table kept again is a new version of the one kept (lib/result-versions.mjs). Returns the id it is kept under. */
export function keepAnalysis(entry) { let id = entry.id; update(s => { id = keepDatasetEntry(s, entry); return s; }); return id; }
export function removeAnalysis(id) { update(s => { s.datasetAnalyses = (s.datasetAnalyses || []).filter(a => a.id !== id); return s; }); }

// ---- formatting -------------------------------------------------------------------------

/** A number for a table: two decimals by default, none past 1,000, a dash when there is none. */
export function fx(x, d = 2) {
  if (x == null || !Number.isFinite(Number(x))) return x === Infinity ? '∞' : '—';
  const v = Number(x);
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d);
}
const ci = (pair, d = 2) => Array.isArray(pair) && pair.length === 2 && pair.every(v => v != null && !Number.isNaN(Number(v))) ? `${fx(pair[0], d)} to ${fx(pair[1], d)}` : '—';
const pc = (x, n) => n ? `${x} (${(100 * x / n).toFixed(1)}%)` : '—';
const pv = p => p == null ? '—' : pValue(p);
const pSay = p => p == null || !Number.isFinite(p) ? '' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
const pct = p => `${(100 * p).toFixed(1)}%`;
const EST = ['', 'Estimate', '95% CI', 'p'];
const est = (label, e, c, p = null, d = 2) => [label, fx(e, d), ci(c, d), p == null ? '' : pv(p)];
const warn = w => (w || []).map(x => typeof x === 'string' ? x : x?.message).filter(Boolean);
/** At most `max` values, evenly spaced, so a plot kept with the project stays small. */
const thin = (xs, max = 2000) => xs.length <= max ? xs : Array.from({ length: max }, (_, i) => xs[Math.floor(i * xs.length / max)]);


/** A number option, or null when it is blank or not a number. */
const optNum = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** The tables, sentence and figure of a cost-effectiveness summary (lib/cea.mjs), from patient data or from simulations. */
function ceResult(s, reps, { figure, kind, n, arms, who, method }) {
  const k = s.k, Q = s.quadrants, share = c => `${c} (${pct(c / k)})`, lam = s.wtp, money = x => fx(x), eff = x => fx(x, 3);
  const verdict = { se: 'Dominant: more effective, less costly', nw: 'Dominated: less effective, more costly' }[s.position]
    || (s.icer == null ? 'Not defined: no difference in effect' : s.position === 'sw' ? `${money(s.icer)}, saved per unit of effect lost` : money(s.icer));
  const main = [...arms, ['Incremental cost', money(s.dc.mean), ci([s.dc.lo, s.dc.hi])], ['Incremental effect', eff(s.de.mean), ci([s.de.lo, s.de.hi], 3)],
    ['Incremental cost-effectiveness ratio', verdict, ''],
    ...(lam != null ? [[`Net monetary benefit at ${money(lam)}`, money(s.nmb.mean), ci([s.nmb.lo, s.nmb.hi])], [`Probability cost-effective at ${money(lam)}`, pct(s.pce), '']] : [])];
  const steps = s.ceac.length - 1, at = [0, 0.2, 0.4, 0.6, 0.8, 1].map(f => s.ceac[Math.round(f * steps)]);
  const more = (x, d) => `${fx(Math.abs(x), d)} ${x < 0 ? 'less' : 'more'}`;
  const ratio = { se: ', so it dominated the comparator', nw: ', so it was dominated' }[s.position]
    || (s.icer == null ? '' : s.position === 'sw' ? `, saving ${money(s.icer)} per unit of effect lost` : `, an incremental cost-effectiveness ratio of ${money(s.icer)} per unit of effect`);
  return {
    method, n,
    tables: [{ header: ['', 'Mean', '95% interval'], rows: main },
      { title: 'Cost-effectiveness plane', header: ['Quadrant', `Replicates (of ${k})`], rows: [['More effective, more costly', share(Q.ne)], ['More effective, less costly', share(Q.se)],
        ['Less effective, less costly', share(Q.sw)], ['Less effective, more costly', share(Q.nw)], ...(Q.axis ? [['On an axis', share(Q.axis)]] : [])] },
      { title: 'Acceptability', header: ['Willingness to pay per unit of effect', 'Probability cost-effective'], rows: at.map(c => [money(c.lambda), pct(c.p)]) }],
    sentence: `For ${who}, the incremental cost was ${more(s.dc.mean)} (95% interval ${ci([s.dc.lo, s.dc.hi])}) and the incremental effect ${more(s.de.mean, 3)} (${ci([s.de.lo, s.de.hi], 3)})${ratio}${lam != null ? `; at a willingness to pay of ${money(lam)} per unit of effect it was cost-effective in ${pct(s.pce)} of ${k} ${kind}` : ''}.`,
    plot: figure === 'ceac'
      ? { kind: 'ceac', title: 'Cost-effectiveness acceptability curve', curve: s.ceac.map(c => [c.lambda, c.p]), wtp: lam, xLabel: 'Willingness to pay per unit of effect', yLabel: 'Probability cost-effective' }
      : { kind: 'ce-plane', title: 'Cost-effectiveness plane', points: thin(reps.filter(r => Number.isFinite(r.dc) && Number.isFinite(r.de)).map(r => [r.de, r.dc])), mean: [s.de.mean, s.dc.mean], wtp: lam,
        xLabel: 'Incremental effect', yLabel: 'Incremental cost' },
    cea: s,
  };
}

// ---- running ------------------------------------------------------------------------------

/** Run one analysis. Throws an Error with a reader's message when the inputs cannot give a result. */
export function runAnalysis(d, kind, inputs = {}, options = {}) {
  const spec = analysisOf(kind);
  if (!spec) throw new Error(`Unknown analysis ${kind}`);
  for (const i of spec.inputs) {
    const v = inputs[i.key];
    if (i.optional) continue;
    if (i.multi ? !(Array.isArray(v) && v.length) : !v) throw new Error(`Choose ${i.label.toLowerCase()}`);
    if (i.levelOf) {
      if (!levelsOf(d, inputs[i.levelOf]).includes(v)) throw new Error(`Choose an observed ${i.label.toLowerCase()} level`);
    } else for (const id of i.multi ? v : [v]) {
      if (!fitsRole(d, colOf(d, id), i.role)) throw new Error(`${i.label} requires ${i.role === 'binary' ? 'a column with exactly two observed levels' : `a ${i.role} column`}`);
    }
  }
  const r = RUN[kind](d, inputs, options);
  return { kind, title: spec.label, warnings: [], ...r, columns: usedColumns(inputs, kind) };
}

/**
 * Kaplan–Meier on a dataset-shaped source: `inputs` { time, event, eventLevel (the level that is the event; without it, the level that reads
 * as one: yes, 1, true, dead, event…), group? }. The result as every analysis here: tables (per group: patients, events, median, survival at
 * 12), the method line, n used and dropped, a sentence, and a `plot` of kind 'km' that analysisSvg draws with lib/survival-fig.mjs.
 */
export function kmRun(d, { time, event, eventLevel = '', group = null } = {}) {
  const tLab = colOf(d, time).label, eLab = colOf(d, event).label, gCol = group ? colOf(d, group) : null;
  const levels = levelsOf(d, event), isEvent = eventLevel || levels.find(l => /^(1|true|yes|y|event|dead|died|death|progressed|progression|failure|failed|revised|revision)$/i.test(l)) || levels[0];
  const ts = nums(d, time), es = labs(d, event), gs = gCol ? labs(d, group) : null;
  const rows = [], dropped = [];
  d.rows.forEach((r, k) => { const t = ts[k], e = es[k]; if (t == null || t < 0 || e == null || (gs && gs[k] == null)) { dropped.push(k); return; } rows.push({ id: String(d.rowIds?.[k] ?? (d.rowKey ? r[d.rowKey] ?? '' : k + 1)), time: t, event: e === isEvent ? 1 : 0, group: gs ? gs[k] : 'All' }); });
  if (rows.length < 2) throw new Error('Fewer than two rows have a time and an event status');
  const names = gs ? [...new Set(rows.map(r => r.group))].sort(levelSort) : ['All'];
  const maxT = Math.max(...rows.map(r => r.time)), ticks = niceTicks(maxT, 6).ticks;
  const km = kmEstimate(rows, { levels: names, times: ticks }), lr = gs ? logRank(rows) : { p: null, chisq: null, df: 0 };
  const unit = /\(([^)]+)\)\s*$/.exec(tLab)?.[1] || '', at12 = g => { const s = g.steps.filter(x => x.time <= 12).at(-1); return s ? `${(100 * s.surv).toFixed(0)}%` : '100%'; };
  const events = rows.filter(r => r.event).length;
  return {
    method: `Kaplan–Meier product-limit estimate with Greenwood variance and log-log 95% confidence intervals (survfit conf.type = "log-log")${gs ? '; log-rank test (survdiff, rho = 0)' : ''}; in the app, lib/km-js.mjs`,
    n: { used: rows.length, dropped: dropped.length },
    tables: [{ title: 'Per group', header: ['Group', 'Patients', 'Events', `Median${unit ? ` (${unit})` : ''}`, 'Survival at 12', ...(gs ? [] : [])], rows: km.by.map(g => [g.group, String(g.n), String(g.events), g.median.est == null ? 'Not reached' : fx(g.median.est, 1), at12(g)]) },
      ...(gs && lr.p != null ? [{ title: 'Log-rank test', header: ['Test', 'χ²', 'df', 'p'], rows: [['Log-rank', fx(lr.chisq, 2), String(lr.df), pv(lr.p)]] }] : [])],
    sentence: gs ? `${eLab} by ${gCol.label}: ${km.by.map(g => `${g.group} median ${g.median.est == null ? 'not reached' : fx(g.median.est, 1)}`).join(', ')}${unit ? ` ${unit}` : ''}; log-rank p ${pv(lr.p)}; ${events} events in ${rows.length} patients.`
      : `${eLab}: median ${km.overall.median.est == null ? 'not reached' : fx(km.overall.median.est, 1)}${unit ? ` ${unit}` : ''}; ${events} events in ${rows.length} patients.`,
    plot: { kind: 'km', title: `Kaplan–Meier: ${eLab}${gs ? ` by ${gCol.label}` : ''}`, km: { by: km.by, overall: km.overall, groups: names, landmarks: ticks, atRiskTimes: ticks, confType: 'log-log', conf: 0.95 }, p: lr.p, xLabel: tLab, atRiskTimes: ticks, xMax: ticks.at(-1), ci: !gs },
    km, logrank: lr, rows, events,
  };
}

/** The table, sentence and figure of a CUSUM learning curve (lib/cusum.mjs), of a measure or of failures. */
function learningCurve(d, r, { label, orderLabel, given, direction = 'falls', failure = false }) {
  if (!r) throw new Error('Choose a case order and an outcome with at least two cases');
  const v = x => (x == null ? '—' : failure ? pct(x) : fx(x, 1)), last = r.after.n ? r.turn + 1 : null;
  const against = failure ? `the ${given ? 'acceptable' : 'observed'} failure rate, ${pct(r.target)}` : `${given ? 'the target' : 'the mean'}, ${fx(r.target, 1)}`;
  return {
    method: `CUSUM over consecutive cases ordered by ${orderLabel}: each case's ${failure ? 'failure (1 or 0)' : 'value'} less ${against}, summed; the turning case is the curve's first ${direction === 'rises' ? 'lowest' : 'highest'} point, and the phases either side of it are described, not tested`,
    n: { used: r.n, dropped: r.dropped },
    tables: [{ header: ['', 'Cases', failure ? 'Failure rate' : 'Mean'], rows: [['All cases', String(r.n), v(r.mean)], [`Cases 1 to ${r.turn}`, String(r.before.n), v(r.before.mean)],
      [last ? `Cases ${last} to ${r.n}` : 'After the turn', String(r.after.n), v(r.after.mean)]] }],
    sentence: `The CUSUM of ${label} turned at case ${r.turn} of ${r.n}: ${failure ? 'a failure rate' : 'a mean'} of ${v(r.before.mean)} up to it and ${v(r.after.mean)} after, against ${against}.`,
    warnings: last ? [] : ['The curve has not turned: the learning phase may not be over'],
    plot: { kind: 'scatter', title: `CUSUM of ${label}`, points: thin(r.series.map(c => [c.case, c.cusum])), line: { slope: 0, intercept: 0 }, xLabel: 'Case', yLabel: 'CUSUM' },
  };
}

const RUN = {
  km: (d, i) => kmRun(d, i),
  table1: (d, i, o) => tableOne(d, { group: i.group || null, variables: i.variables, summary: o.summary || 'auto' }),

  describe(d, { x }) {
    const xs = nums(d, x), lab = colOf(d, x).label;
    const r = describeWithCI(xs);
    if (!r.n) throw new Error(`${lab} has no numbers`);
    const sw = shapiroWilk(xs), ad = andersonDarling(xs), qq = qqPoints(xs);
    return {
      method: `Mean with t interval; median with the order-statistic (binomial) interval; skewness and excess kurtosis type 2; ${sw ? 'Shapiro–Wilk (Royston)' : ''}${ad ? ', Anderson–Darling' : ''}`,
      n: { used: r.n, dropped: r.missing },
      tables: [{ header: EST, rows: [
        est('Mean', r.mean.estimate, r.mean.ci),
        ['Standard deviation', fx(r.sd), '', ''],
        est('Median', r.median.estimate, r.median.ci),
        ['Interquartile range', `${fx(r.q1)} to ${fx(r.q3)}`, '', ''],
        ['Range', `${fx(r.min)} to ${fx(r.max)}`, '', ''],
        ['Skewness (SE)', `${fx(r.skewness.estimate)} (${fx(r.skewness.se)})`, '', ''],
        ['Excess kurtosis (SE)', `${fx(r.kurtosis.estimate)} (${fx(r.kurtosis.se)})`, '', ''],
        ...(sw ? [['Shapiro–Wilk W', fx(sw.statistic, 3), '', pv(sw.p)]] : []),
        ...(ad ? [['Anderson–Darling A', fx(ad.statistic, 3), '', pv(ad.p)]] : []),
      ] }],
      sentence: `${lab}: mean ${fx(r.mean.estimate)} (SD ${fx(r.sd)}; 95% CI ${ci(r.mean.ci)}), median ${fx(r.median.estimate)} (IQR ${fx(r.q1)} to ${fx(r.q3)}), n = ${r.n}.`,
      plot: qq && qq.n >= 3 ? { kind: 'qq', title: `Normal Q–Q plot, ${lab}`, points: thin(qq.points.map(p => [p.theoretical, p.sample])), line: qq.line, xLabel: 'Theoretical quantile', yLabel: lab } : null,
    };
  },

  'two-groups'(d, { y, group }, { test = 'welch' }) {
    const { groups, dropped } = split(d, y, group);
    if (groups.length !== 2) throw new Error(`${colOf(d, group).label} has ${groups.length} groups here; choose Compare several groups`);
    const [a, b] = groups, lab = colOf(d, y).label;
    const summary = groupSummary(groups);
    const lev = leveneTest(groups);
    if (test === 'mann-whitney') {
      const r = mannWhitney(a.values, b.values);
      if (!r) throw new Error('Each group needs values');
      return {
        method: `${r.method}; Hodges–Lehmann shift with its interval`, n: { used: a.values.length + b.values.length, dropped }, warnings: [],
        tables: [summary, { header: EST, rows: [est(`Shift, ${a.name} − ${b.name}`, r.estimate, r.ci, r.p), ['W', fx(r.statistic, 1), '', '']] }],
        sentence: `${lab} differed between ${a.name} and ${b.name} by a Hodges–Lehmann shift of ${fx(r.estimate)} (95% CI ${ci(r.ci)}; Mann–Whitney W = ${fx(r.statistic, 1)}, ${pSay(r.p)}).`,
        plot: stripPlot(lab, groups),
      };
    }
    const r = tTestTwo(a.values, b.values, { equalVar: test === 'student' });
    if (!r) throw new Error('Each group needs at least two values');
    return {
      method: `${r.method}; Cohen's d (pooled SD) and Hedges' g with noncentral t intervals${lev ? `; ${lev.method}` : ''}`, n: { used: r.n[0] + r.n[1], dropped },
      tables: [summary, { header: EST, rows: [
        est(`Difference, ${a.name} − ${b.name}`, r.estimate, r.ci, r.p),
        [`t (${fx(r.df, Number.isInteger(r.df) ? 0 : 1)} df)`, fx(r.statistic), '', ''],
        est("Cohen's d", r.cohensD.estimate, r.cohensD.ci),
        est("Hedges' g", r.hedgesG.estimate, r.hedgesG.ci),
        ...(lev ? [['Levene F', fx(lev.statistic), '', pv(lev.p)]] : []),
      ] }],
      sentence: `Mean ${lab} was ${fx(r.means[0])} in ${a.name} and ${fx(r.means[1])} in ${b.name}, a difference of ${fx(r.estimate)} (95% CI ${ci(r.ci)}; ${r.method}, t = ${fx(r.statistic)}, ${pSay(r.p)}; Hedges' g ${fx(r.hedgesG.estimate)}).`,
      plot: stripPlot(lab, groups),
    };
  },

  'several-groups'(d, { y, group }, { test = 'anova' }) {
    const { groups, dropped } = split(d, y, group);
    if (groups.length < 2) throw new Error('At least two groups need values');
    const lab = colOf(d, y).label, used = groups.reduce((n, g) => n + g.values.length, 0);
    const summary = groupSummary(groups);
    if (test === 'kruskal') {
      const r = kruskalTest(groups);
      if (!r) throw new Error('The groups have too few values');
      const ph = r.posthoc;
      return {
        method: `${r.method}; ${ph?.method || ''}`, n: { used, dropped },
        tables: [summary, { header: EST, rows: [[`Kruskal–Wallis χ² (${r.df} df)`, fx(r.statistic), '', pv(r.p)]] },
          ...(ph ? [{ title: 'Pairwise comparisons', header: ['Comparison', 'z', '', 'Adjusted p'], rows: ph.comparisons.map(c => [c.label, fx(c.z), '', pv(c.p)]) }] : [])],
        sentence: `${lab} differed across ${groups.length} groups by the Kruskal–Wallis test (χ² = ${fx(r.statistic)}, ${r.df} df, ${pSay(r.p)}).`,
        plot: stripPlot(lab, groups),
      };
    }
    const welch = test === 'welch';
    const r = anovaOneWay(groups, { welch });
    if (!r) throw new Error('The groups have too few values');
    const ph = welch ? gamesHowell(groups) : tukeyHSD(groups), lev = leveneTest(groups), bart = bartlettTest(groups);
    return {
      method: `${r.method}; ${ph?.method || ''}${lev ? `; ${lev.method}` : ''}${bart ? `; ${bart.method}` : ''}`, n: { used, dropped },
      tables: [summary, { header: EST, rows: [
        [`F (${fx(r.df[0], 0)}, ${fx(r.df[1], welch ? 1 : 0)} df)`, fx(r.statistic), '', pv(r.p)],
        ['η²', fx(r.eta2, 3), '', ''], ['ω²', fx(r.omega2, 3), '', ''],
        ...(lev ? [['Levene F', fx(lev.statistic), '', pv(lev.p)]] : []),
        ...(bart ? [["Bartlett's K²", fx(bart.statistic), '', pv(bart.p)]] : []),
      ] }, ...(ph ? [{ title: 'Pairwise comparisons', header: ['Comparison', 'Difference', '95% CI', 'Adjusted p'], rows: ph.comparisons.map(c => [c.label, fx(c.diff), ci(c.ci), pv(c.p)]) }] : [])],
      sentence: `Mean ${lab} differed across ${groups.length} groups (${welch ? 'Welch' : 'one-way'} ANOVA F = ${fx(r.statistic)}, ${pSay(r.p)}; η² ${fx(r.eta2, 3)}).`,
      plot: stripPlot(lab, groups),
    };
  },

  paired(d, { x, y }, { test = 't' }) {
    const a = nums(d, x), b = nums(d, y), la = colOf(d, x).label, lb = colOf(d, y).label;
    const complete = a.map((v, i) => v != null && b[i] != null).filter(Boolean).length;
    const dropped = d.rows.length - complete;
    const diffs = a.map((v, i) => v != null && b[i] != null ? v - b[i] : null).filter(v => v != null);
    const plot = stripPlot('Value', [{ name: la, values: a.filter(v => v != null) }, { name: lb, values: b.filter(v => v != null) }, { name: `${la} − ${lb}`, values: diffs }]);
    if (test === 'wilcoxon' || test === 'sign') {
      const r = test === 'sign' ? signTest(a, b) : wilcoxonSignedRank(a, b);
      if (!r) throw new Error('No pair differs');
      const what = test === 'sign' ? 'Median difference' : 'Pseudomedian difference';
      return {
        method: r.method, n: { used: complete, dropped },
        tables: [{ header: EST, rows: [est(`${what}, ${la} − ${lb}`, r.estimate, r.ci, r.p), [test === 'sign' ? 'Positive differences' : 'V', fx(r.statistic, test === 'sign' ? 0 : 1), '', ''], ['Pairs, non-zero', `${r.nNonZero ?? '—'} of ${r.n}`, '', '']] }],
        sentence: `The ${what.toLowerCase()} between ${la} and ${lb} was ${fx(r.estimate)} (95% CI ${ci(r.ci)}; ${r.method}, ${pSay(r.p)}; ${complete} pairs).`,
        plot,
      };
    }
    const r = tTestPaired(a, b);
    if (!r) throw new Error('At least two complete pairs are needed');
    return {
      method: `${r.method}; Cohen's d_z with its noncentral t interval`, n: { used: r.n, dropped },
      tables: [{ header: EST, rows: [est(`Mean difference, ${la} − ${lb}`, r.estimate, r.ci, r.p), [`t (${r.df} df)`, fx(r.statistic), '', ''], est("Cohen's d_z", r.cohensD.estimate, r.cohensD.ci), ['SD of differences', fx(r.sd), '', '']] }],
      sentence: `The mean difference between ${la} and ${lb} was ${fx(r.estimate)} (95% CI ${ci(r.ci)}; paired t = ${fx(r.statistic)}, ${r.df} df, ${pSay(r.p)}; ${r.n} pairs).`,
      plot,
    };
  },

  association(d, { row, col }, { test = 'auto' }) {
    const rv = labs(d, row), cv = labs(d, col), lr = colOf(d, row).label, lc = colOf(d, col).label;
    const keep = rv.map((v, i) => v != null && cv[i] != null);
    const R = levelsOf({ rows: d.rows.filter((_, i) => keep[i]) }, row), C = levelsOf({ rows: d.rows.filter((_, i) => keep[i]) }, col);
    if (R.length < 2 || C.length < 2) throw new Error('Each variable needs at least two values among complete rows');
    const t = R.map(a => C.map(b => rv.filter((v, i) => keep[i] && v === a && cv[i] === b).length));
    const n = t.flat().reduce((x, y) => x + y, 0), dropped = d.rows.length - n;
    const cross = { title: `${lr} by ${lc}`, header: [lr, ...C, 'Total'], rows: R.map((a, i) => { const tot = t[i].reduce((x, y) => x + y, 0); return [a, ...t[i].map(v => pc(v, tot)), String(tot)]; }) };
    if (test === 'mcnemar') {
      if (R.length !== 2 || C.length !== 2 || R.join() !== C.join()) throw new Error('McNemar needs two columns with the same two values');
      const m = mcnemarTest(t[0][1], t[1][0]);
      if (!m) throw new Error('No discordant pairs');
      return {
        method: `${m.method}; ${m.exact.method}; ${m.oddsRatio.method}`, n: { used: n, dropped },
        tables: [cross, { header: EST, rows: [[`χ² (1 df)`, fx(m.statistic), '', pv(m.p)], ['Exact p', '', '', pv(m.exact.p)], est('Conditional odds ratio', m.oddsRatio.estimate, m.oddsRatio.ci)] }],
        sentence: `Of ${m.n} discordant pairs, ${t[0][1]} were ${R[0]}/${R[1]} and ${t[1][0]} ${R[1]}/${R[0]} (McNemar χ² = ${fx(m.statistic)}, ${pSay(m.p)}).`,
        plot: null,
      };
    }
    const chi = chiSquareTest(t);
    if (!chi) throw new Error('The table has too few counts');
    const useFisher = test === 'fisher' || (test === 'auto' && chi.expected.flat().some(e => e < 5));
    const fi = useFisher ? fisherExact(t) : null;
    const rows = [];
    if (fi) rows.push(['Fisher exact', fi.estimate != null ? `OR ${fx(fi.estimate)}` : '', fi.ci ? ci(fi.ci) : '', fi.p == null ? '—' : pv(fi.p)]);
    rows.push([`χ² (${chi.df} df)`, fx(chi.statistic), '', pv(chi.p)], est("Cramér's V", chi.cramersV.estimate, chi.cramersV.ci));
    const warnings = [...warn(chi.warnings), ...(fi?.message ? [fi.message] : [])].filter(w => !(fi && /Fisher/.test(w)));
    if (R.length === 2 && C.length === 2) {
      const or = oddsRatio(t), rr = riskRatio(t), rd = riskDifference(t);
      rows.push(est(`Odds ratio, ${C[0]}`, or.estimate, or.ci), est(`Risk ratio, ${C[0]}`, rr.estimate, rr.ci));
      if (rd) rows.push(est(`Risk difference, ${C[0]}`, rd.estimate, rd.ci, null, 3));
      warnings.push(...warn(or.warnings));
    }
    const p = fi && fi.p != null ? fi.p : chi.p;
    return {
      method: [fi ? fi.method : null, chi.method, chi.cramersV.ciMethod && `Cramér's V, ${chi.cramersV.ciMethod}`, R.length === 2 && C.length === 2 ? 'odds and risk ratios with Wald log intervals; risk difference with the Newcombe hybrid score interval' : null].filter(Boolean).join('; '),
      n: { used: n, dropped }, warnings: [...new Set(warnings)],
      tables: [cross, { header: EST, rows }],
      sentence: `${lr} and ${lc} were ${p < 0.05 ? '' : 'not '}associated (${fi && fi.p != null ? "Fisher's exact test" : `χ² = ${fx(chi.statistic)}, ${chi.df} df`}, ${pSay(p)}; Cramér's V ${fx(chi.cramersV.estimate)}; n = ${n}).`,
      plot: null,
    };
  },

  correlation(d, { x, y }, { method = 'pearson' }) {
    const a = nums(d, x), b = nums(d, y), la = colOf(d, x).label, lb = colOf(d, y).label;
    const r = correlation(a, b, { method });
    if (!r) throw new Error('At least three complete pairs are needed');
    const pts = a.map((v, i) => [v, b[i]]).filter(([u, w]) => u != null && w != null);
    const sym = { pearson: 'r', spearman: 'ρ', kendall: 'τ' }[method];
    return {
      method: `${r.method}; ${r.ciMethod} interval${r.pMethod ? `; p by ${r.pMethod}` : ''}`, n: { used: r.n, dropped: d.rows.length - r.n }, warnings: warn(r.warnings),
      tables: [{ header: EST, rows: [est(`${sym}`, r.estimate, r.ci, r.p, 3), [`${r.statisticName}${r.df ? ` (${r.df} df)` : ''}`, fx(r.statistic), '', '']] }],
      sentence: `${la} and ${lb} were correlated with ${method[0].toUpperCase()}${method.slice(1)} ${sym} = ${fx(r.estimate, 3)} (95% CI ${ci(r.ci, 3)}; ${pSay(r.p)}; n = ${r.n}).`,
      plot: { kind: 'scatter', title: `${lb} against ${la}`, points: thin(pts), line: method === 'pearson' ? fitLine(pts) : null, xLabel: la, yLabel: lb },
    };
  },

  linear: (d, i, o) => regression(d, 'linear', i, o),
  logistic: (d, i, o) => regression(d, 'logistic', i, o),
  poisson: (d, i, o) => regression(d, 'poisson', i, o),

  icc(d, { raters }) {
    if (raters.length < 2) throw new Error('Choose at least two rater columns');
    const cols = raters.map(id => nums(d, id));
    const m = d.rows.map((_, i) => cols.map(c => c[i]));
    const complete = m.filter(r => r.every(v => v != null)).length;
    const r = iccAll(m);
    return {
      method: r.method, n: { used: complete, dropped: d.rows.length - complete },
      tables: [{ header: ['Form', 'ICC', '95% CI', 'p'], rows: r.rows.map(x => [`${x.form} ${x.model === 'oneway' ? 'one-way' : 'two-way'}${x.model === 'oneway' ? '' : `, ${x.type}`}, ${x.unit}`, fx(x.value, 3), ci([x.lower, x.upper], 3), pv(x.pValue)]) }],
      sentence: `Agreement among ${r.raters} raters on ${r.subjects} subjects: ICC(A,1) two-way random, absolute agreement ${fx(r.rows.find(x => x.form === 'ICC(A,1)')?.value, 3)} (95% CI ${ci([r.rows.find(x => x.form === 'ICC(A,1)')?.lower, r.rows.find(x => x.form === 'ICC(A,1)')?.upper], 3)}).`,
      plot: null,
    };
  },

  'bland-altman'(d, { x, y }, { scale = 'difference' }) {
    const a = nums(d, x), b = nums(d, y), la = colOf(d, x).label, lb = colOf(d, y).label;
    const keep = a.map((v, i) => v != null && b[i] != null);
    const xa = a.filter((_, i) => keep[i]), yb = b.filter((_, i) => keep[i]);
    const ratio = scale === 'ratio';
    const r = blandAltman(xa, yb, { ratio });
    const word = ratio ? 'ratio' : 'difference';
    return {
      method: `${r.method}; limits bias ± ${fx(r.z, 3)} SD; exact limit intervals (Carkeet 2015); proportional bias by regression of the ${word} on the mean`, n: { used: r.n, dropped: d.rows.length - r.n },
      tables: [{ header: EST, rows: [est(`Bias, ${la} ${ratio ? '/' : '−'} ${lb}`, r.bias, r.biasCI, r.biasTest.pValue), est('Lower limit of agreement', r.lower, r.lowerCI), est('Upper limit of agreement', r.upper, r.upperCI),
        [`SD of ${ratio ? 'log ratios' : 'differences'}`, fx(r.sd, 3), '', ''], ['Proportional bias slope', fx(r.proportionalBias.slope, 3), '', pv(r.proportionalBias.pValue)]] }],
      sentence: `The mean ${word} between ${la} and ${lb} was ${fx(r.bias)} (95% CI ${ci(r.biasCI)}), with 95% limits of agreement from ${fx(r.lower)} to ${fx(r.upper)} (n = ${r.n}).`,
      plot: { kind: 'bland-altman', title: 'Bland–Altman plot', points: thin(r.points.map(p => [p.mean, p.diff])), bias: r.bias, loa: [r.lower, r.upper], yLabel: ratio ? `${la} / ${lb}` : `${la} − ${lb}` },
    };
  },

  kappa(d, { raters }, { weights = 'none' }) {
    if (raters.length < 2) throw new Error('Choose at least two rater columns');
    // ratings that are all numbers are compared as numbers, so an ordinal scale keeps its order (10 after 9)
    const raw = raters.map(id => labs(d, id)), numeric = raw.flat().every(v => v == null || Number.isFinite(Number(v)));
    const cols = numeric ? raw.map(c => c.map(v => v == null ? null : Number(v))) : raw;
    const levels = [...new Set(cols.flat().filter(v => v != null))].sort(numeric ? (a, b) => a - b : levelSort);
    const m = d.rows.map((_, i) => cols.map(c => c[i]));
    const complete = m.filter(r => r.every(v => v != null));
    const w = weights === 'none' ? null : weights;
    const ka = krippendorffAlpha(m, w ? 'ordinal' : 'nominal');
    const pa = percentAgreement(complete);
    const rows = [];
    let sentence, method;
    if (raters.length === 2) {
      const k = cohenKappa(cols[0], cols[1], { weights: w, levels }), g = gwetAC1(cols[0], cols[1], { levels });
      rows.push(est(`Cohen's kappa${w ? `, ${w} weights` : ''}`, k.kappa, [k.lower, k.upper], k.pValue, 3), est("Gwet's AC1", g.ac1, [g.lower, g.upper], g.pValue, 3));
      sentence = `Agreement between ${colOf(d, raters[0]).label} and ${colOf(d, raters[1]).label} on ${k.subjects} subjects: ${w ? `${w}-weighted ` : ''}Cohen's kappa ${fx(k.kappa, 3)} (95% CI ${ci([k.lower, k.upper], 3)}), observed agreement ${pct(pa.proportion)}.`;
      method = `${k.method}; ${g.method}; Krippendorff's alpha (${ka.level}); percent agreement`;
    } else {
      const f = fleissKappa(complete, { levels });
      rows.push(est("Fleiss' kappa", f.kappa, [f.lower, f.upper], f.pValue, 3));
      sentence = `Agreement among ${f.raters} raters on ${f.subjects} subjects: Fleiss' kappa ${fx(f.kappa, 3)} (95% CI ${ci([f.lower, f.upper], 3)}).`;
      method = `${f.method} (interval from the SE under κ = 0); Krippendorff's alpha (${ka.level}); percent agreement`;
    }
    rows.push([`Krippendorff's alpha, ${ka.level}`, fx(ka.alpha, 3), '', ''], ['Percent agreement', pct(pa.proportion), '', '']);
    return { method, n: { used: complete.length, dropped: d.rows.length - complete.length }, tables: [{ header: EST, rows }], sentence, plot: null };
  },

  cronbach(d, { items }) {
    if (items.length < 2) throw new Error('Choose at least two items');
    const cols = items.map(id => nums(d, id)), m = d.rows.map((_, i) => cols.map(c => c[i]));
    const r = cronbachAlpha(m);
    return {
      method: r.method, n: { used: r.subjects, dropped: d.rows.length - r.subjects },
      tables: [{ header: EST, rows: [est("Cronbach's alpha", r.alpha, [r.lower, r.upper], null, 3)] },
        { title: 'Items', header: ['Item', 'Mean (SD)', 'Corrected item–total r', 'Alpha if deleted'], rows: r.itemStats.map(s => [colOf(d, items[s.item]).label, `${fx(s.mean)} (${fx(s.sd)})`, fx(s.correctedItemTotal, 3), fx(s.alphaIfDeleted, 3)]) }],
      sentence: `The ${r.items} items had a Cronbach's alpha of ${fx(r.alpha, 3)} (95% CI ${ci([r.lower, r.upper], 3)}; ${r.subjects} respondents).`,
      plot: null,
    };
  },

  consensus(d, { statements }, { scale = '1-9', threshold = 70 }) {
    const share = threshold === '' || threshold == null ? 70 : Number(threshold), sc = CONSENSUS_SCALES[scale];
    const cols = statements.map(id => nums(d, id));
    const r = consensusRound(statements.map((id, k) => ({ id, label: colOf(d, id).label, values: cols[k] })), { scale, threshold: share / 100 });
    const used = d.rows.filter((_, i) => cols.some(c => onScale(c[i], sc))).length, off = r.statements.reduce((a, s) => a + s.offScale, 0);
    const say = { agree: 'Agreement', disagree: 'Disagreement', none: 'None' }, of = (k, x) => (x == null ? '—' : `${k} (${pct(x)})`);
    const reached = r.statements.filter(s => s.verdict !== 'none'), agreed = reached.filter(s => s.verdict === 'agree').length;
    const range = `${sc.min} to ${sc.max}`;
    return {
      method: `Consensus when at least ${share}% of the panelists who rated a statement chose ${r.bands.agree} (agreement) or ${r.bands.disagree} (disagreement) on the ${range} scale; median and interquartile range by R's type 7 quantiles; ratings that are not whole numbers on the scale are left out`,
      n: { used, dropped: d.rows.length - used },
      tables: [{ title: 'Statements', header: ['Statement', 'Panelists', 'Median [IQR]', `Agree, ${r.bands.agree}`, `Disagree, ${r.bands.disagree}`, 'Consensus'],
        rows: r.statements.map(s => [s.label, String(s.n), s.n ? `${fx(s.median, 1)} [${fx(s.q1, 1)}–${fx(s.q3, 1)}]` : '—', of(s.agreeN, s.agree), of(s.disagreeN, s.disagree), say[s.verdict]]) }],
      sentence: `${reached.length} of ${r.statements.length} statements reached consensus at ${share}% on the ${range} scale (${agreed} in agreement, ${reached.length - agreed} in disagreement), rated by ${used} panelists.`,
      warnings: off ? [`${off} ratings off the ${range} scale were left out`] : [],
      plot: null, consensus: r,
    };
  },

  'run-chart'(d, { order, y }) {
    const os = nums(d, order), ys = nums(d, y), r = runChart(d.rows.map((_, i) => ({ order: os[i], y: ys[i] })));
    if (!r) throw new Error('Choose a time or sequence and a measure with at least two points');
    const u = r.runs, found = [u.shift && `a shift of ${u.longest} points`, u.fewCrossings && `${u.crossings} ${u.crossings === 1 ? 'crossing' : 'crossings'}`].filter(Boolean);
    return {
      method: "Run chart around the median; runs read by Anhøj's rules: a shift is a run of more than round(log2(n)) + 3 useful points on one side, too few crossings are fewer than the binomial's 5th percentile (n − 1, 1/2); points on the median are not useful",
      n: { used: r.n, dropped: r.dropped },
      tables: [{ header: ['', 'Value', 'Signal when'], rows: [['Median', fx(r.centre), ''], ['Useful observations', String(u.useful), ''], ['Longest run', String(u.longest), `more than ${u.longestMax}`], ['Crossings', String(u.crossings), `fewer than ${u.crossingsMin}`]] }],
      sentence: `Over ${r.n} points around a median of ${fx(r.centre)}, the runs show ${found.length ? `non-random variation: ${found.join(' and ')}` : `only random variation (longest run ${u.longest}, ${u.crossings} crossings)`}.`,
      plot: { kind: 'spc', title: `Run chart of ${colOf(d, y).label}`, points: thin(r.points.map(p => [p.order, p.y])), centre: r.centre, centreLabel: 'Median', xLabel: colOf(d, order).label, yLabel: colOf(d, y).label },
    };
  },

  'control-chart'(d, { order, y, n }) {
    const os = nums(d, order), ys = nums(d, y), ns = n ? nums(d, n) : null;
    const r = controlChart(d.rows.map((_, i) => ({ order: os[i], y: ys[i], ...(ns ? { n: ns[i] } : {}) })));
    if (!r) throw new Error('Choose a time or sequence and a measure with at least two points');
    const p = r.chart === 'p', v = x => (p ? pct(x) : fx(x)), lab = colOf(d, y).label, first = r.points[0];
    return {
      method: p ? "p chart: the centre line the overall proportion, limits p̄ ± 3 √(p̄(1 − p̄)/n) for each point, cut at 0 and 1; runs read by Anhøj's rules"
        : "Individuals (XmR) chart: the centre line the mean, limits the mean ± 2.66 times the mean moving range; runs read by Anhøj's rules",
      n: { used: r.n, dropped: r.dropped },
      tables: [{ header: ['', 'Value'], rows: [['Centre line', v(r.centre)], ...(p ? [['Limits', 'Per point, from its denominator']] : [['Mean moving range', fx(r.mr)], ['Lower limit', fx(first.lcl)], ['Upper limit', fx(first.ucl)]]),
        ['Points beyond the limits', `${r.beyond} of ${r.n}`], ['Runs', r.runs.signal ? 'Non-random' : 'Random']] },
        ...(r.beyond ? [{ title: 'Beyond the limits', header: [colOf(d, order).label, 'Value', 'Limits'], rows: r.points.filter(x => x.beyond).map(x => [fx(x.order, 0), v(x.value), `${v(x.lcl)} to ${v(x.ucl)}`]) }] : [])],
      sentence: `${r.beyond ? `${r.beyond} of ${r.n} points fall beyond the control limits (special-cause variation)` : `All ${r.n} points fall within the control limits`}${r.runs.signal ? ', and the runs show non-random variation' : ''}.`,
      plot: { kind: 'spc', title: `${p ? 'p chart' : 'Individuals chart'} of ${lab}`, points: thin(r.points.map(x => [x.order, x.value, x.lcl, x.ucl, x.beyond])), centre: r.centre, centreLabel: p ? 'Overall' : 'Mean', limits: true,
        xLabel: colOf(d, order).label, yLabel: p ? `${lab}, proportion` : lab },
    };
  },

  cusum(d, { order, y }, { target = '', direction = 'falls' }) {
    const os = nums(d, order), ys = nums(d, y), t = target === '' || target == null ? NaN : Number(target);
    const r = cusum(d.rows.map((_, i) => ({ order: os[i], y: ys[i] })), { target: Number.isFinite(t) ? t : null, direction });
    return learningCurve(d, r, { label: colOf(d, y).label, orderLabel: colOf(d, order).label, given: Number.isFinite(t), direction });
  },

  'cusum-failure'(d, { order, y, failure }, { target = '' }) {
    if (!failure) throw new Error('Choose the level that is a failure');
    const os = nums(d, order), ls = labs(d, y), t = target === '' || target == null ? NaN : Number(target) / 100;
    const r = cusum(d.rows.map((_, i) => ({ order: os[i], y: ls[i] == null ? null : ls[i] === failure ? 1 : 0 })), { target: Number.isFinite(t) ? t : null });
    return learningCurve(d, r, { label: `${colOf(d, y).label} ${failure}`, orderLabel: colOf(d, order).label, given: Number.isFinite(t), failure: true });
  },

  ror(d, { meta, effect, se, trait, present }, { method = 'REML' }) {
    if (!present) throw new Error('Choose the level that has the characteristic');
    const ms = labs(d, meta), ys = nums(d, effect), ss = nums(d, se), ts = labs(d, trait), name = colOf(d, trait).label;
    const r = ratioOfOddsRatios(d.rows.map((_, i) => ({ meta: ms[i], yi: ys[i], sei: ss[i], present: ts[i] == null ? null : ts[i] === present })), { method });
    if (!r.pooled) throw new Error(r.used.length ? 'The meta-analysis of the ratios did not converge' : 'No meta-analysis has three or more trials with both levels of the characteristic');
    const p = r.pooled, e = Math.exp, how = ROR_METHODS[method], out = r.metas.filter(m => m.reason), used = r.used.reduce((a, m) => a + m.k, 0);
    const ratio = m => `${fx(e(m.lror))} (${ci([e(m.lo), e(m.hi)])})`;
    return {
      method: `Two-step meta-epidemiological analysis (Sterne et al. 2002): in each meta-analysis a random-effects meta-regression of the trials' log odds ratios on ${name} (${how}), then a random-effects meta-analysis of the log ratios of odds ratios (${how}); a meta-analysis needs three trials and both levels`,
      n: { used, dropped: d.rows.length - used },
      tables: [{ header: EST, rows: [est(`Ratio of odds ratios, ${name} ${present} to other`, e(p.lror), [e(p.lo), e(p.hi)], p.p), ['Between meta-analyses τ²', fx(p.tau2, 3), '', ''], ['I²', pct(p.i2 / 100), '', '']] },
        { title: 'Meta-analyses', header: ['Meta-analysis', `Trials, ${present} and other`, 'Ratio of odds ratios (95% CI)', 'τ²'], rows: r.used.map(m => [m.meta, `${m.with} and ${m.without}`, ratio(m), fx(m.tau2, 3)]) },
        ...(out.length ? [{ title: 'Left out', header: ['Meta-analysis', 'Trials', 'Reason'], rows: out.map(m => [m.meta, String(m.k), m.reason]) }] : [])],
      sentence: `Across ${p.k} meta-analyses and ${used} trials, the ratio of odds ratios of trials where ${name} was ${present} to the other trials was ${fx(e(p.lror))} (95% CI ${ci([e(p.lo), e(p.hi)])}, p ${pv(p.p)}); between meta-analyses τ² ${fx(p.tau2, 3)}, I² ${pct(p.i2 / 100)}.`,
      warnings: out.length ? [`${out.length} ${out.length === 1 ? 'meta-analysis' : 'meta-analyses'} left out (see the table)`] : [],
      plot: { kind: 'forest', title: `Ratio of odds ratios per meta-analysis, ${name}`, rows: r.used.map(m => ({ label: m.meta, value: e(m.lror), lo: e(m.lo), hi: e(m.hi) })),
        foot: { label: `Overall (${p.k} meta-analyses)`, value: e(p.lror), lo: e(p.lo), hi: e(p.hi), pooled: true }, log: true, xLabel: 'Ratio of odds ratios', labelHead: 'Meta-analysis' },
      ror: r,
    };
  },

  cea(d, { arm, treated, cost, effect }, { wtp = '', lambdaMax = '', replicates = 2000, seed = 1, figure = 'plane' }) {
    if (!treated) throw new Error('Choose the level that is the intervention');
    const B = Math.round(Number(replicates)), sd = Math.round(Number(seed));
    if (!(B >= 100 && B <= 20000)) throw new Error('Choose between 100 and 20000 bootstrap replicates');
    const as = labs(d, arm), cs = nums(d, cost), es = nums(d, effect), other = levelsOf(d, arm).find(l => l !== treated) || 'comparator';
    const b = bootstrapCe(d.rows.map((_, i) => ({ treated: as[i] == null ? null : as[i] === treated, cost: cs[i], effect: es[i] })), { replicates: B, seed: Number.isFinite(sd) ? sd : 1 });
    if (!b) throw new Error('Each arm needs at least two patients with a cost and an effect');
    const s = ceSummary(b.reps, { wtp: optNum(wtp), lambdaMax: optNum(lambdaMax), base: b.base }), cl = colOf(d, cost).label, el = colOf(d, effect).label, A = b.arms;
    return ceResult(s, b.reps, { figure, kind: 'bootstrap replicates', n: { used: A.treated.n + A.control.n, dropped: b.dropped },
      arms: [[`${cl}, ${treated} (n = ${A.treated.n})`, fx(A.treated.cost), ''], [`${cl}, ${other} (n = ${A.control.n})`, fx(A.control.cost), ''],
        [`${el}, ${treated}`, fx(A.treated.effect, 3), ''], [`${el}, ${other}`, fx(A.control.effect, 3), '']],
      who: `${treated} against ${other}`,
      method: `Incremental cost-effectiveness ratio from the arms' mean costs and effects (${treated} minus ${other}); ${B} bootstrap replicates resampling the patients with replacement within each arm (seed ${Number.isFinite(sd) ? sd : 1}) give the 95% percentile intervals, the cost-effectiveness plane and the acceptability curve; net monetary benefit λ × incremental effect − incremental cost` });
  },

  'cea-sim'(d, { cost, effect, costRef, effectRef }, { wtp = '', lambdaMax = '', figure = 'plane' }) {
    if (!costRef !== !effectRef) throw new Error("Choose both the comparator's cost and its effect, or neither");
    const c = nums(d, cost), e = nums(d, effect), c0 = costRef ? nums(d, costRef) : null, e0 = effectRef ? nums(d, effectRef) : null;
    const less = (a, b) => (a == null || (b !== undefined && b == null) ? NaN : a - (b ?? 0));
    const reps = d.rows.map((_, i) => ({ dc: less(c[i], c0 ? c0[i] : undefined), de: less(e[i], e0 ? e0[i] : undefined) }));
    const s = ceSummary(reps, { wtp: optNum(wtp), lambdaMax: optNum(lambdaMax) });
    if (!s) throw new Error('Choose columns with at least two complete simulations');
    return ceResult(s, reps, { figure, kind: 'simulations', n: { used: s.k, dropped: s.dropped }, arms: [], who: 'the intervention against the comparator',
      method: `Incremental cost-effectiveness ratio as the mean incremental cost over the mean incremental effect of ${s.k} simulations (one row each${c0 ? ', the comparator subtracted row by row' : ''}); 95% percentile intervals; acceptability as the share of simulations with a positive net monetary benefit, λ × incremental effect − incremental cost` });
  },

  'response-rate'(d, { status, count }, { e = '', siteVisitors = '', surveyVisitors = '', agreed = '' }) {
    const ls = labs(d, status), ns = count ? nums(d, count) : null, counts = {}, unknown = new Set();
    let dropped = 0;
    d.rows.forEach((_, i) => {
      if (ls[i] == null || (ns && !(Number.isFinite(ns[i]) && ns[i] >= 0))) { dropped++; return; }
      const code = dispositionOf(ls[i]);
      if (!code) unknown.add(ls[i]); else counts[code] = (counts[code] || 0) + (ns ? ns[i] : 1);
    });
    if (unknown.size) throw new Error(`Not an AAPOR disposition: ${[...unknown].slice(0, 3).join(', ')}. Use Complete, Partial, Refusal, Non-contact, Other, Unknown household, Unknown eligibility, Unknown other or Not eligible`);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) throw new Error('No case has a disposition');
    if (optNum(e) != null && !(optNum(e) >= 0 && optNum(e) <= 1)) throw new Error('Give e as a share from 0 to 1');
    const r = outcomeRates(counts, { e: optNum(e) }), web = webRates({ siteVisitors: optNum(siteVisitors), surveyVisitors: optNum(surveyVisitors), agreed: optNum(agreed), finished: counts.I || 0 });
    const NAME = { I: 'Complete', P: 'Partial', R: 'Refusal and break-off', NC: 'Non-contact', O: 'Other', UH: 'Unknown household', UR: 'Unknown eligibility', UO: 'Unknown other', NE: 'Not eligible' };
    const rate = k => (r[k] == null ? '—' : pct(r[k])), U = (counts.UH || 0) + (counts.UR || 0) + (counts.UO || 0);
    const webRows = [['View rate', web.view], ['Participation rate', web.participation], ['Completion rate', web.completion]].filter(([, v]) => v != null);
    return {
      method: `AAPOR Standard Definitions (10th edition, 2023), outcome rates from the final dispositions; e ${r.eGiven ? `${fx(r.e, 3)} as given` : `${fx(r.e, 3)}, the eligible share of the cases of known eligibility`}; cases not eligible are left out of every rate${webRows.length ? '; view, participation and completion rates as CHERRIES defines them' : ''}`,
      n: { used: total, dropped },
      tables: [{ title: 'Final dispositions', header: ['Disposition', 'Code', 'Cases'], rows: [...Object.keys(NAME).filter(k => counts[k]).map(k => [NAME[k], k, String(counts[k])]), ['Total', '', String(total)]] },
        { title: 'Outcome rates', header: ['Rate', 'Value'], rows: [...[1, 2, 3, 4, 5, 6].map(i => [`Response rate ${i} (RR${i})`, rate(`RR${i}`)]), ...[1, 2, 3, 4].map(i => [`Cooperation rate ${i} (COOP${i})`, rate(`COOP${i}`)]),
          ...[1, 2, 3].map(i => [`Refusal rate ${i} (REF${i})`, rate(`REF${i}`)]), ...[1, 2, 3].map(i => [`Contact rate ${i} (CON${i})`, rate(`CON${i}`)])] },
        ...(webRows.length ? [{ title: 'Web survey', header: ['Rate', 'Value'], rows: webRows.map(([k, v]) => [k, pct(v)]) }] : [])],
      sentence: `Of ${total} sampled cases${counts.NE ? ` (${counts.NE} not eligible)` : ''}, ${counts.I || 0} completed the survey${counts.P ? ` and ${counts.P} completed part of it` : ''}: a response rate of ${rate('RR1')} (AAPOR RR1)${counts.P ? `, ${rate('RR2')} counting partial responses (RR2)` : ''}${U ? `, ${rate('RR3')} with e = ${fx(r.e, 3)} (RR3)` : ''}.`,
      plot: null, rates: r,
    };
  },

  likert(d, { items }, { scale = '1-5' }) {
    const k = Number(String(scale).split('-')[1]);
    if (![4, 5, 6, 7].includes(k)) throw new Error(`Unknown scale ${scale}`);
    const rs = items.map(id => ({ label: colOf(d, id).label, ...likertItem(nums(d, id), k) })), shown = rs.filter(r => r.n);
    if (!shown.length) throw new Error(`No answer is on the 1 to ${k} scale`);
    const points = Array.from({ length: k }, (_, i) => String(i + 1)), off = rs.reduce((a, r) => a + r.offScale, 0);
    const answered = d.rows.filter(row => items.some(id => { const v = Number(row[id]); return row[id] !== '' && row[id] != null && Number.isInteger(v) && v >= 1 && v <= k; })).length;
    const top = shown.reduce((a, r) => (r.above > a.above ? r : a));
    return {
      method: `Likert items on a 1 to ${k} scale: the share of answers at each point, the median and quartiles (R's type 7), and the shares above and below the midpoint${k % 2 ? ` (${(k + 1) / 2} is neither)` : ''}; answers off the scale left out`,
      n: { used: answered, dropped: d.rows.length - answered },
      warnings: off ? [`${off} ${off === 1 ? 'answer is' : 'answers are'} off the 1 to ${k} scale and left out`] : [],
      tables: [{ header: ['Item', 'n', ...points, 'Median (IQR)', 'Above the midpoint', 'Below the midpoint'],
        rows: rs.map(r => [r.label, String(r.n), ...r.shares.map(x => (x == null ? '—' : pct(x))), r.n ? `${fx(r.median, 1)} (${fx(r.q1, 1)} to ${fx(r.q3, 1)})` : '—', r.n ? pct(r.above) : '—', r.n ? pct(r.below) : '—']) }],
      sentence: `${rs.length} ${rs.length === 1 ? 'item' : 'items'} on a 1 to ${k} scale were answered by ${answered} respondents; ${top.label} had the largest share above the midpoint (${pct(top.above)}).`,
      plot: { kind: 'stacked', title: `Answers on the 1 to ${k} scale`, xLabel: 'Share of answers (%)', rows: shown.flatMap(r => r.shares.map((x, i) => ({ label: r.label, series: points[i], value: 100 * x }))) },
    };
  },

  recommendations(d, { rec, outcome, importance, certainty, strength, direction }) {
    const col = id => (id ? labs(d, id) : d.rows.map(() => null)), R = col(rec), O = col(outcome), I = col(importance), C = col(certainty), S = col(strength), D = col(direction);
    const rs = recommendations(d.rows.map((_, i) => ({ rec: R[i], outcome: O[i], importance: I[i], certainty: C[i], strength: S[i], direction: D[i] })));
    if (!rs.length) throw new Error('No row names a recommendation');
    const cap = x => (x ? x[0].toUpperCase() + x.slice(1) : '—'), n = lvl => rs.filter(r => r.certainty === lvl).length;
    const noCritical = rs.filter(r => !r.critical), strongLow = rs.filter(r => r.strength === 'strong' && (r.certainty === 'low' || r.certainty === 'very low'));
    const unread = rs.reduce((a, r) => a + r.unread, 0), mixed = rs.filter(r => r.mixed);
    const used = d.rows.filter((_, i) => R[i] != null).length;
    return {
      method: "GRADE: a recommendation's overall certainty of evidence is the lowest certainty among the outcomes the panel rated critical (critical, or 7 to 9); important outcomes do not lower it; strength (strong, or conditional) and direction as the panel set them",
      n: { used, dropped: d.rows.length - used },
      warnings: [...(noCritical.length ? [`No critical outcome: ${noCritical.map(r => r.rec).slice(0, 3).join('; ')}`] : []),
        ...(strongLow.length ? [`${strongLow.length} strong ${strongLow.length === 1 ? 'recommendation rests' : 'recommendations rest'} on low or very low certainty; GRADE expects one of its paradigmatic situations`] : []),
        ...(unread ? [`${unread} certainty ${unread === 1 ? 'cell is' : 'cells are'} not high, moderate, low or very low`] : []),
        ...(mixed.length ? [`Strength or direction differs between the rows of ${mixed.length} ${mixed.length === 1 ? 'recommendation' : 'recommendations'}`] : [])],
      tables: [{ title: 'Recommendations', header: ['Recommendation', 'Direction', 'Strength', 'Certainty of evidence', 'Critical outcomes', 'Lowest'],
        rows: rs.map(r => [r.rec, cap(r.direction), cap(r.strength), cap(r.certainty), String(r.critical), r.lowest || '—']) }],
      sentence: `${rs.length} ${rs.length === 1 ? 'recommendation' : 'recommendations'}, ${rs.filter(r => r.strength === 'strong').length} strong and ${rs.filter(r => r.strength === 'conditional').length} conditional; certainty of evidence high for ${n('high')}, moderate for ${n('moderate')}, low for ${n('low')} and very low for ${n('very low')}.`,
      plot: null, recommendations: rs,
    };
  },

  cinema(d, { comparison, lo, hi, piLo, piHi, side, bias, reporting, indirectness, coherence }, { measure = 'difference', lower = '', upper = '', dbt = '', loops = 'yes' }) {
    const nul = measure === 'ratio' ? 1 : 0, b1 = optNum(lower), b2 = optNum(upper);
    if (!(b1 != null && b2 != null && b1 < nul && nul < b2)) throw new Error(`Give the range of equivalence: a lower and an upper bound on either side of ${nul}`);
    const C = labs(d, comparison), L = nums(d, lo), H = nums(d, hi), PL = piLo ? nums(d, piLo) : null, PH = piHi ? nums(d, piHi) : null, SP = side ? nums(d, side) : null;
    const lv = id => (id ? labs(d, id).map(levelOf) : d.rows.map(() => null)), WB = lv(bias), RB = lv(reporting), IN = lv(indirectness), CO = lv(coherence);
    const NAMES = { no: 'No concerns', some: 'Some concerns', major: 'Major concerns' }, name = l => (l ? NAMES[l] : 'Judge');
    const rows = [], open = [];
    d.rows.forEach((_, i) => {
      if (C[i] == null || !(Number.isFinite(L[i]) && Number.isFinite(H[i]))) return;
      const pi = PL && PH && Number.isFinite(PL[i]) && Number.isFinite(PH[i]) ? [PL[i], PH[i]] : null;
      const lv6 = [WB[i], RB[i], IN[i], imprecision([L[i], H[i]], [b1, b2], nul), heterogeneity([L[i], H[i]], pi, [b1, b2]),
        CO[i] || incoherence({ side: SP && Number.isFinite(SP[i]) ? SP[i] : null, dbt: optNum(dbt), noLoop: loops === 'no' })];
      const conf = confidence(lv6);
      if (!conf) open.push(C[i]);
      rows.push([C[i], ...lv6.map(name), conf ? conf[0].toUpperCase() + conf.slice(1) : 'Open']);
    });
    if (!rows.length) throw new Error('No comparison has a confidence interval');
    const count = c => rows.filter(r => r[7].toLowerCase() === c).length;
    return {
      method: `CINeMA (Nikolakopoulou 2020): imprecision from the 95% CI against the range of equivalence ${fx(b1, 3)} to ${fx(b2, 3)}; heterogeneity from the prediction interval's conclusion against the CI's; incoherence from the SIDE test (no concerns above p 0.10) or the design-by-treatment test${loops === 'no' ? ' (none: no closed loop, so major concerns)' : optNum(dbt) == null ? ' (not given: the reviewer judges)' : ''}; within-study bias, reporting bias and indirectness as the reviewer judged them; confidence from high, one level down per domain with some concerns and two per domain with major concerns`,
      n: { used: rows.length, dropped: d.rows.length - rows.length },
      warnings: open.length ? [`${open.length} ${open.length === 1 ? 'comparison needs' : 'comparisons need'} a reviewer's judgment in at least one domain ("Judge")`] : [],
      tables: [{ header: ['Comparison', 'Within-study bias', 'Reporting bias', 'Indirectness', 'Imprecision', 'Heterogeneity', 'Incoherence', 'Confidence'], rows }],
      sentence: `Of ${rows.length} comparisons, confidence was high for ${count('high')}, moderate for ${count('moderate')}, low for ${count('low')} and very low for ${count('very low')}${open.length ? `; ${open.length} still need a judgment` : ''}.`,
      plot: null,
    };
  },

  diagnostic(d, { test, positive, reference, diseased }, { prevalence = null }) {
    const tv = labs(d, test), rv = labs(d, reference);
    if (!positive || !diseased) throw new Error('Choose the positive result and the target condition');
    const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
    let used = 0;
    tv.forEach((t, i) => { const r = rv[i]; if (t == null || r == null) return; used++; const tp = t === positive, dz = r === diseased; c[tp ? (dz ? 'tp' : 'fp') : (dz ? 'fn' : 'tn')]++; });
    const prev = prevalence != null && prevalence !== '' && Number.isFinite(Number(prevalence)) ? Number(prevalence) : null;
    const r = diagnostic2x2(c, { prevalence: prev != null && prev > 0 && prev < 1 ? prev : null });
    const p = x => [x.est, [x.lo, x.hi]];
    const rows = [
      ['Sensitivity', ...fmtP(r.sensitivity)], ['Specificity', ...fmtP(r.specificity)], ['Positive predictive value', ...fmtP(r.ppv)], ['Negative predictive value', ...fmtP(r.npv)], ['Accuracy', ...fmtP(r.accuracy)],
      est('Positive likelihood ratio', ...p(r.lrPos)), est('Negative likelihood ratio', ...p(r.lrNeg)), est('Diagnostic odds ratio', ...p(r.dor)), est("Youden's J", ...p(r.youden), null, 3),
      ...(r.atPrevalence ? [[`PPV at prevalence ${pct(r.atPrevalence.prevalence)}`, ...fmtP(r.atPrevalence.ppv)], [`NPV at prevalence ${pct(r.atPrevalence.prevalence)}`, ...fmtP(r.atPrevalence.npv)]] : []),
    ].map(x => x.slice(0, 3));
    return {
      method: r.method, n: { used, dropped: d.rows.length - used },
      tables: [{ title: 'Counts', header: ['', `${diseased}`, `Not ${diseased}`], rows: [[`Test ${positive}`, String(c.tp), String(c.fp)], ['Test other', String(c.fn), String(c.tn)]] }, { header: EST.slice(0, 3), rows }],
      sentence: `Against the reference standard, the test had a sensitivity of ${pct(r.sensitivity.est)} (95% CI ${pct(r.sensitivity.lo)} to ${pct(r.sensitivity.hi)}) and a specificity of ${pct(r.specificity.est)} (95% CI ${pct(r.specificity.lo)} to ${pct(r.specificity.hi)}) in ${used} participants.`,
      plot: null,
    };
  },

  roc(d, { score, reference, diseased }, { direction = '>' }) {
    const s = nums(d, score), rv = labs(d, reference);
    if (!diseased) throw new Error('Choose the target condition');
    const keep = s.map((v, i) => v != null && rv[i] != null);
    const scores = s.filter((_, i) => keep[i]), labels = rv.filter((_, i) => keep[i]).map(v => v === diseased ? 1 : 0);
    const r = roc(scores, labels, { direction });
    const cut = optimalCutoff(r, { method: 'youden' });
    const lab = colOf(d, score).label;
    return {
      method: `${r.method}; cutoff by ${cut.method}`, n: { used: scores.length, dropped: d.rows.length - scores.length },
      tables: [{ header: EST, rows: [est('Area under the curve', r.auc.est, [r.auc.lo, r.auc.hi], null, 3), ['With the condition', String(r.nPos), '', ''], ['Without', String(r.nNeg), '', ''],
        ...(cut.cutoff ? [[`Cutoff, ${direction === '<' ? '≤' : '≥'}`, fmtNumber(cut.threshold), '', ''], ['Sensitivity at cutoff', pct(cut.se), '', ''], ['Specificity at cutoff', pct(cut.sp), '', '']] : [])] }],
      sentence: `${lab} discriminated ${diseased} with an area under the ROC curve of ${fx(r.auc.est, 3)} (95% CI ${ci([r.auc.lo, r.auc.hi], 3)}; ${r.nPos} with and ${r.nNeg} without)${cut.cutoff ? `; at ${direction === '<' ? '≤' : '≥'} ${fmtNumber(cut.threshold)} sensitivity was ${pct(cut.se)} and specificity ${pct(cut.sp)}` : ''}.`,
      plot: { kind: 'roc', title: `ROC curve, ${lab}`, points: thin(r.points.map(p => ({ fpr: p.fpr, se: p.se, sp: p.sp, threshold: Number.isFinite(p.threshold) ? p.threshold : null }))), auc: r.auc.est, cutoff: cut.cutoff ? { threshold: cut.threshold, se: cut.se, sp: cut.sp } : null },
    };
  },

  'roc-compare'(d, { scoreA, scoreB, reference, diseased }, { directionA = '>', directionB = '>' }) {
    if (scoreA === scoreB) throw new Error('Choose two different scores measured in the same participants');
    const a = nums(d, scoreA), b = nums(d, scoreB), labels = labs(d, reference);
    if (!levelsOf(d, reference).includes(diseased)) throw new Error('Choose an observed target condition');
    const keep = a.map((v, j) => v != null && b[j] != null && labels[j] != null);
    const A = a.filter((_, j) => keep[j]), B = b.filter((_, j) => keep[j]), Y = labels.filter((_, j) => keep[j]).map(v => v === diseased ? 1 : 0);
    const r = rocCompare(A, B, Y, { direction: [directionA, directionB] });
    const ca = roc(A, Y, { direction: directionA }), cb = roc(B, Y, { direction: directionB });
    const curves = [ca, cb].map((c, j) => ({ label: colOf(d, [scoreA, scoreB][j]).label,
      result: { points: thin(c.points.map(p => ({ fpr: p.fpr, se: p.se, sp: p.sp, threshold: Number.isFinite(p.threshold) ? p.threshold : null }))), auc: { est: c.auc.est } } }));
    return { method: r.method, n: { used: Y.length, dropped: d.rows.length - Y.length },
      warnings: Number.isFinite(r.p) ? [] : ['The paired difference has zero or undefined variance; its DeLong p value cannot be estimated.'],
      tables: [{ header: EST, rows: [est(`AUC, ${colOf(d, scoreA).label}`, ca.auc.est, [ca.auc.lo, ca.auc.hi], null, 3),
        est(`AUC, ${colOf(d, scoreB).label}`, cb.auc.est, [cb.auc.lo, cb.auc.hi], null, 3), est('AUC difference, A − B', r.difference.est, [r.difference.lo, r.difference.hi], r.p, 3)] }],
      sentence: `The paired AUC difference was ${fx(r.difference.est, 3)} (95% CI ${ci([r.difference.lo, r.difference.hi], 3)}${Number.isFinite(r.p) ? `; ${pSay(r.p)}` : '; p not estimable'}) in ${Y.length} participants.`,
      plot: { kind: 'roc-compare', title: 'Paired ROC curves', curves },
    };
  },

  calibration(d, inputs, { evaluation = 'unspecified' }) {
    const { predicted, observed, dropped } = predictionRows(d, inputs);
    const r = calibration(predicted, observed), warnings = evaluationWarnings(evaluation);
    if (![r.intercept.est, r.slope.est, r.intercept.se, r.slope.se].every(Number.isFinite)) warnings.push('Calibration regression is not estimable; grouped observed risks and Brier score remain available.');
    const row = (label, value) => est(label, value.est, [value.lo, value.hi], null, 3);
    return { method: `${r.method}; prediction source: ${evaluationLabel(evaluation)} (declared by the researcher)`, n: { used: r.n, dropped }, warnings,
      tables: [{ header: EST.slice(0, 3), rows: [row('Calibration intercept', r.intercept), row('Calibration slope', r.slope), row('Observed:expected events', r.oe),
        ['Brier score', fx(r.brier, 4), ''], ['Scaled Brier score', fx(r.brierScaled, 4), ''], ['Observed events', String(r.events), ''], ['Expected events', fx(r.expected), '']].map(x => x.slice(0, 3)) },
      { title: 'Grouped calibration', header: ['Group', 'n', 'Mean predicted risk', 'Observed risk', '95% CI'], rows: r.groups.map(g => [String(g.group), String(g.n), pct(g.predicted), pct(g.observed), `${pct(g.lo)} to ${pct(g.hi)}`]) }],
      sentence: `Supplied predictions had a Brier score of ${fx(r.brier, 4)}, calibration intercept ${fx(r.intercept.est, 3)} and slope ${fx(r.slope.est, 3)} in ${r.n} participants (${evaluationLabel(evaluation)}).`,
      plot: { kind: 'calibration', title: 'Calibration plot', calibration: r },
    };
  },

  'decision-curve'(d, inputs, { evaluation = 'unspecified' }) {
    const { predicted, observed, dropped } = predictionRows(d, inputs);
    const r = decisionCurve(predicted, observed);
    return { method: `${r.method}; prediction source: ${evaluationLabel(evaluation)} (declared by the researcher)`, n: { used: r.n, dropped }, warnings: evaluationWarnings(evaluation),
      tables: [{ header: ['Threshold', 'Model net benefit', 'Treat all', 'Treat none', 'True positives', 'False positives'], rows: r.rows.map(x => [pct(x.threshold), fx(x.model, 4), fx(x.all, 4), fx(x.none, 4), String(x.tp), String(x.fp)]) }],
      sentence: `Decision-curve net benefit was evaluated from threshold probabilities 1% to 99% in ${r.n} participants (${evaluationLabel(evaluation)}); observed event prevalence was ${pct(r.prevalence)}.`,
      plot: { kind: 'decision-curve', title: 'Decision curve', decisionCurve: r },
    };
  },
  'prediction-binary': (d, inputs, options) => predictionResult(d, 'binary', inputs, options),
  'prediction-continuous': (d, inputs, options) => predictionResult(d, 'continuous', inputs, options),
};

function predictionResult(d, family, inputs, options) {
  const prediction = developPrediction(d, family, inputs, options), p = prediction.performance, label = id => colOf(d, id).label;
  const measure = family === 'binary' ? 'Logit coefficient' : 'Coefficient';
  const tables = [{ title: 'Frozen development model', header: ['Term', measure], rows: prediction.model.coefficients.map(c => [c.term == null ? 'Intercept' : `${label(c.term)}${c.level == null ? '' : `: ${c.level}`}`, fx(c.estimate, 5)]) }];
  const metricRows = family === 'binary' ? [
    ['Events', x => String(x.events)], ['AUC', x => fx(x.auc.auc.est, 3)], ['Brier score', x => fx(x.calibration.brier, 4)],
    ['Log loss', x => fx(x.logLoss, 4)], ['Calibration intercept', x => fx(x.calibration.intercept.est, 3)], ['Calibration slope', x => fx(x.calibration.slope.est, 3)],
  ] : [['RMSE', x => fx(x.rmse, 4)], ['MAE', x => fx(x.mae, 4)], ['R²', x => fx(x.r2, 4)], ['Mean observed', x => fx(x.meanObserved, 4)], ['Mean predicted', x => fx(x.meanPredicted, 4)]];
  tables.push({ title: 'Development and validation performance', header: ['Measure', 'Development (apparent)', `${prediction.model.split.evaluation === 'external' ? 'External' : 'Held-out'} validation`],
    rows: [['n', String(p.development.n), String(p.validation.n)], ...metricRows.map(([name, value]) => [name, value(p.development), value(p.validation)])] });
  if (family === 'binary' && ![p.validation.calibration.intercept.est, p.validation.calibration.slope.est].every(Number.isFinite)) prediction.warnings.push('Validation calibration regression is not estimable; Brier score and grouped observed risks remain available.');
  const plot = family === 'binary' ? { kind: 'calibration', title: 'Validation calibration', calibration: p.validation.calibration, note: 'Grouped validation observations; predictions from frozen development coefficients.' }
    : { kind: 'scatter', title: 'Validation predictions', points: thin(prediction.predictions.map(r => [r.observed, r.predicted])), xLabel: `Observed ${label(inputs.y)}`, yLabel: `Predicted ${label(inputs.y)}`, line: { intercept: 0, slope: 1 } };
  const metric = family === 'binary' ? `AUC ${fx(p.validation.auc.auc.est, 3)} and Brier score ${fx(p.validation.calibration.brier, 4)}` : `RMSE ${fx(p.validation.rmse, 4)} and MAE ${fx(p.validation.mae, 4)}`;
  return { method: `${family === 'binary' ? 'Logistic regression by IRLS' : 'Ordinary least squares'}; predictors specified before fitting; complete cases; ${prediction.model.split.method === 'random' ? `seeded disjoint split (seed ${prediction.model.split.seed})` : 'explicit disjoint partition'}; development-only categorical encoding; saved coefficients applied without refitting to validation`,
    tables, plot, prediction, population: prediction.population, warnings: prediction.warnings,
    n: { used: prediction.population.used, dropped: prediction.population.dropped },
    sentence: `A prespecified ${family === 'binary' ? 'binary logistic' : 'continuous linear'} prediction model was developed in ${p.development.n} observations and evaluated without refitting in ${p.validation.n} ${prediction.model.split.evaluation === 'external' ? 'external-cohort' : 'held-out'} observations: ${metric}.` };
}

const evaluationLabel = x => ({ apparent: 'development sample', 'held-out': 'held-out sample', external: 'external cohort', unspecified: 'prediction source not specified' }[x] || 'prediction source not specified');
const evaluationWarnings = x => ['This analysis evaluates supplied predictions; it does not train, split or validate the provenance of a model.',
  ...(!x || x === 'unspecified' ? ['Specify whether predictions come from development data, a held-out sample or an external cohort.'] : x === 'apparent' ? ['Performance in the development sample can be optimistic; it is not held-out validation.'] : [])];
function predictionRows(d, { predicted: id, reference, diseased }) {
  const values = nums(d, id), labels = labs(d, reference);
  if (!levelsOf(d, reference).includes(diseased)) throw new Error('Choose an observed event level');
  if (levelsOf(d, reference).length !== 2) throw new Error('The observed outcome must have two levels');
  const keep = values.map((p, j) => p != null && labels[j] != null);
  const predicted = values.filter((_, j) => keep[j]), observed = labels.filter((_, j) => keep[j]).map(v => v === diseased ? 1 : 0);
  if (predicted.some(p => p < 0 || p > 1)) throw new Error('Predicted risks must be probabilities from 0 to 1');
  if (predicted.length < 2 || !observed.includes(0) || !observed.includes(1)) throw new Error('Complete cases must include an event and a non-event');
  return { predicted, observed, dropped: d.rows.length - predicted.length };
}

const fmtP = x => [pct(x.est), `${pct(x.lo)} to ${pct(x.hi)}`];

/** Values of `y` split by the levels of `group`; rows missing either are dropped and counted. */
export function split(d, y, group) {
  const v = nums(d, y), g = labs(d, group);
  const names = [...new Set(g.filter((x, i) => x != null && v[i] != null))].sort(levelSort);
  const groups = names.map(name => ({ name, values: v.filter((x, i) => x != null && g[i] === name) }));
  const used = groups.reduce((n, x) => n + x.values.length, 0);
  return { groups, dropped: d.rows.length - used };
}
function groupSummary(groups) {
  return { header: ['Group', 'n', 'Mean (SD)', 'Median [IQR]'], rows: groups.map(g => { const r = describeWithCI(g.values); return [g.name, String(r.n), `${fx(r.mean?.estimate)} (${fx(r.sd)})`, `${fx(r.median?.estimate)} [${fx(r.q1)}, ${fx(r.q3)}]`]; }) };
}
const stripPlot = (label, groups) => ({ kind: 'strip', title: label, groups: groups.map(g => ({ name: g.name, values: thin(g.values, 1000) })), xLabel: label });
function fitLine(pts) {
  const n = pts.length; if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx; return { slope, intercept: my - slope * mx };
}

// ---- regression ---------------------------------------------------------------------------

/** Rows for the regression module: numbers for numeric columns, trimmed text (or null) otherwise. */
function modelRows(d, ids) {
  const cols = ids.map(id => colOf(d, id));
  return d.rows.map(r => Object.fromEntries(cols.map(c => [c.id, isNumericCol(c) ? cellValue(r[c.id], c.type) : text(r[c.id])])));
}
const FAMILY = { linear: linearRegression, logistic: logisticRegression, poisson: poissonRegression };
function regression(d, family, { y, event, exposure, predictors, refs = {} }, { unadjusted = 'no' }) {
  const preds = predictors.filter(p => p !== y && p !== exposure);
  if (!preds.length) throw new Error('Choose at least one predictor');
  if (family === 'logistic' && !event) throw new Error('Choose the event');
  const specs = preds.map(id => { const c = colOf(d, id); return isNumericCol(c) ? { column: id, type: 'numeric' } : { column: id, type: 'categorical', reference: refs[id] || undefined }; });
  const rows = modelRows(d, [y, ...preds, ...(exposure ? [exposure] : [])]);
  const opts = family === 'logistic' ? { event } : family === 'poisson' && exposure ? { exposure } : {};
  const model = FAMILY[family](rows, y, specs, opts);
  const label = id => colOf(d, id).label;
  const measure = { linear: 'β', logistic: 'Odds ratio', poisson: 'Rate ratio' }[family];
  const ratio = family !== 'linear';
  const pick = c => ratio ? { e: c.ratio, c: c.ratioProfileCI && c.ratioProfileCI.every(Number.isFinite) ? c.ratioProfileCI : c.ratioCI } : { e: c.estimate, c: c.ci };
  const termLabel = c => c.term == null ? 'Intercept' : c.level != null ? `${label(c.term)}: ${c.level}` : label(c.term);
  const rowsOut = [];
  for (const s of model.predictors) {
    const lv = s.type === 'categorical' ? model.levels[s.column] : null;
    if (lv) rowsOut.push([`${label(s.column)}: ${lv.reference}`, 'reference', '', '']);
    for (const c of model.coefficients.filter(x => x.term === s.column)) {
      if (c.aliased) { rowsOut.push([termLabel(c), 'not estimable', '', '']); continue; }
      const q = pick(c); rowsOut.push([termLabel(c), fx(q.e, 3), ci(q.c, 3), pv(c.p)]);
    }
  }
  const icpt = model.coefficients.find(c => c.term == null);
  if (!ratio && icpt && !icpt.aliased) rowsOut.unshift(['Intercept', fx(icpt.estimate, 3), ci(icpt.ci, 3), pv(icpt.p)]);
  const tables = [{ header: ['Term', measure, '95% CI', 'p'], rows: rowsOut }];
  if (unadjusted === 'yes') {
    const uni = univariableScreen(rows, y, specs, family, opts);
    const t = regressionTable(uni, model);
    tables.push({ title: 'Unadjusted and adjusted', header: ['Term', `Unadjusted ${measure}`, '95% CI', 'p', `Adjusted ${measure}`, '95% CI', 'p'],
      rows: t.map(r => [r.level != null ? `${label(r.term)}: ${r.level}` : label(r.term), r.reference ? 'reference' : fx(r.uniEst, 3), r.reference ? '' : ci(r.uniCI, 3), r.reference ? '' : pv(r.uniP), r.reference ? 'reference' : fx(r.multiEst, 3), r.reference ? '' : ci(r.multiCI, 3), r.reference ? '' : pv(r.multiP)]) });
  }
  const fit = [];
  if (family === 'linear') {
    fit.push(['R²', fx(model.r2, 3), '', ''], ['Adjusted R²', fx(model.adjR2, 3), '', ''], ['Residual SD', fx(model.sigma, 3), '', '']);
    if (model.fTest) fit.push([`F (${model.fTest.df1}, ${model.fTest.df2} df)`, fx(model.fTest.F), '', pv(model.fTest.p)]);
  } else {
    fit.push(['Deviance', `${fx(model.deviance)} on ${model.dfResidual} df`, '', ''], ['AIC', fx(model.aic), '', '']);
    if (model.lrTest) fit.push([`Likelihood ratio χ² (${model.lrTest.df} df)`, fx(model.lrTest.chisq), '', pv(model.lrTest.p)]);
    if (family === 'logistic') { fit.push(['Events', String(model.events), '', ''], ['C statistic', fx(model.cStatistic, 3), '', '']); if (model.hosmerLemeshow) fit.push([`Hosmer–Lemeshow χ² (${model.hosmerLemeshow.df} df)`, fx(model.hosmerLemeshow.chisq), '', pv(model.hosmerLemeshow.p)]); }
    if (family === 'poisson') fit.push(['Pearson dispersion', fx(model.dispersion), '', '']);
  }
  const maxVif = Math.max(...(model.vif || []).map(v => v.gvif).filter(Number.isFinite), 0);
  if (maxVif > 0 && (model.vif || []).length > 1) fit.push(['Largest variance inflation (GVIF)', fx(maxVif), '', '']);
  tables.push({ title: 'Model', header: EST, rows: fit });
  const warnings = warn(model.warnings);
  const epv = family === 'logistic' ? Math.min(model.events, model.nUsed - model.events) / Math.max(1, model.rank - 1) : null;
  if (epv != null && epv < 10) warnings.push(`${fx(epv, 1)} events per parameter; estimates may be unstable`);
  const forest = model.coefficients.filter(c => c.term != null && !c.aliased).map(c => { const q = pick(c); return { label: termLabel(c), value: q.e, lo: q.c?.[0], hi: q.c?.[1] }; });
  const first = model.coefficients.find(c => c.term != null && !c.aliased);
  const q1 = first && pick(first);
  return {
    method: `${{ linear: 'Ordinary least squares (as lm)', logistic: 'Logistic regression by IRLS (as glm, binomial)', poisson: `Poisson regression by IRLS (as glm, poisson)${exposure ? ', log exposure offset' : ''}` }[family]}; ${ratio ? 'profile-likelihood intervals where they converge, Wald otherwise' : 't intervals'}; complete cases; categorical predictors against a reference level`,
    n: { used: model.nUsed, dropped: model.nDropped }, warnings, tables,
    sentence: first ? `In a ${family === 'poisson' ? 'Poisson' : family} model of ${label(y)}${family === 'logistic' ? ` (${event})` : ''} on ${preds.map(label).join(', ')} (n = ${model.nUsed}), ${termLabel(first)} had ${ratio ? `${family === 'logistic' ? 'an' : 'a'} ${measure.toLowerCase()}` : 'a coefficient'} of ${fx(q1.e, 3)} (95% CI ${ci(q1.c, 3)}; ${pSay(first.p)}).` : '',
    plot: forest.length ? { kind: 'forest', title: `${measure}${ratio ? '' : ' coefficients'}`, rows: forest, log: ratio, xLabel: measure } : null,
  };
}

// ---- Table 1 ----------------------------------------------------------------------------

/** Standardised difference of two means: (m1 − m2) / √((s1² + s2²) / 2). */
export function smdContinuous(a, b) {
  const m = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
  const v = xs => { const mm = m(xs); return xs.reduce((s, x) => s + (x - mm) ** 2, 0) / (xs.length - 1); };
  if (a.length < 2 || b.length < 2) return null;
  const den = Math.sqrt((v(a) + v(b)) / 2);
  return den > 0 ? (m(a) - m(b)) / den : null;
}

/**
 * Standardised difference for a categorical variable (Yang & Dalton 2012):
 * √((T − C)ᵀ S⁻¹ (T − C)) over the levels after the first, S the mean of the
 * two groups' multinomial covariance matrices. Two levels reduce to
 * |p1 − p2| / √((p1q1 + p2q2) / 2).
 */
export function smdCategorical(countsA, countsB) {
  const na = countsA.reduce((s, v) => s + v, 0), nb = countsB.reduce((s, v) => s + v, 0);
  if (!na || !nb) return null;
  let T = countsA.map(v => v / na).slice(1), C = countsB.map(v => v / nb).slice(1);
  const keep = T.map((t, i) => t > 0 || C[i] > 0);
  T = T.filter((_, i) => keep[i]); C = C.filter((_, i) => keep[i]);
  const k = T.length;
  if (!k) return 0;
  const S = T.map((_, i) => T.map((__, j) => ((i === j ? T[i] * (1 - T[i]) : -T[i] * T[j]) + (i === j ? C[i] * (1 - C[i]) : -C[i] * C[j])) / 2));
  const diff = T.map((t, i) => t - C[i]);
  const x = solve(S, diff);
  if (!x) return null;
  const q = diff.reduce((s, v, i) => s + v * x[i], 0);
  return q >= 0 ? Math.sqrt(q) : null;
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Table 1: one block per variable, overall and by group. A numeric variable
 * is mean (SD) with Welch's t or ANOVA when every group passes Shapiro–Wilk
 * at 0.05 (or when `summary` is 'mean'), otherwise median [IQR] with
 * Mann–Whitney or Kruskal–Wallis. A categorical variable is n (%) per level
 * with Pearson's chi-square, or Fisher's exact test when an expected count is
 * below 5. Two groups add the standardised difference. Rows missing the group
 * are left out and counted.
 */
export function tableOne(d, { group = null, variables = [], summary = 'auto' } = {}) {
  const vars = variables.filter(v => v !== group).map(id => colOf(d, id));
  if (!vars.length) throw new Error('Choose variables');
  const gv = group ? labs(d, group) : d.rows.map(() => 'All');
  const inRows = d.rows.map((_, i) => gv[i] != null);
  const rows = d.rows.filter((_, i) => inRows[i]), g = gv.filter((_, i) => inRows[i]);
  const names = group ? [...new Set(g)].sort(levelSort) : [];
  const idx = names.map(n => g.map((x, i) => x === n ? i : -1).filter(i => i >= 0));
  const two = names.length === 2, tests = names.length >= 2;
  const header = ['Characteristic', `Overall (n = ${rows.length})`, ...names.map((n, k) => `${n} (n = ${idx[k].length})`), ...(tests ? ['p', 'Test'] : []), ...(two ? ['SMD'] : []), 'Missing'];
  const out = [], sub = [], used = new Set(), warnings = [];
  for (const c of vars) {
    const numeric = descriptiveKind(c, rows) === 'numeric', read = descriptiveConverter(c, rows), vals = rows.map(r => read(r[c.id]));
    const missing = vals.filter(v => v == null).length;
    if (numeric) {
      const x = vals.map(v => cellValue(v, c.type));
      const per = idx.map(ix => ix.map(i => x[i]).filter(v => v != null));
      const all = x.filter(v => v != null);
      const normal = summary === 'mean' || (summary === 'auto' && (group ? per : [all]).every(v => { if (v.length < 3 || v.length > 5000) return true; const sw = shapiroWilk(v); return !sw || sw.p >= 0.05; }));
      const fmt = xs => { if (!xs.length) return '—'; const r = describeWithCI(xs); return normal ? `${fx(r.mean.estimate, 1)} (${fx(r.sd, 1)})` : `${fx(r.median.estimate, 1)} [${fx(r.q1, 1)}, ${fx(r.q3, 1)}]`; };
      let p = null, test = '';
      if (tests) {
        const gs = names.map((n, k) => ({ name: n, values: per[k] })).filter(x => x.values.length);
        if (normal) { if (two) { const t = tTestTwo(per[0], per[1]); p = t?.p ?? null; test = 'Welch t-test'; } else { const a = anovaOneWay(gs); p = a?.p ?? null; test = 'ANOVA'; } }
        else if (two) { const m = mannWhitney(per[0], per[1]); p = m?.p ?? null; test = 'Mann–Whitney'; }
        else { const k = kruskalTest(gs); p = k?.p ?? null; test = 'Kruskal–Wallis'; }
        if (p != null) used.add(test);
      }
      const smd = two ? smdContinuous(per[0], per[1]) : null;
      out.push([`${c.label}, ${normal ? 'mean (SD)' : 'median [IQR]'}`, fmt(all), ...per.map(fmt), ...(tests ? [pv(p), p == null ? '' : test] : []), ...(two ? [smd == null ? '—' : fx(Math.abs(smd), 2)] : []), String(missing)]);
    } else {
      const x = vals.map(text), lv = [...new Set(x.filter(v => v != null))].sort(levelSort);
      if (!lv.length) continue;
      const counts = idx.map(ix => lv.map(l => ix.filter(i => x[i] === l).length));
      const allCounts = lv.map(l => x.filter(v => v === l).length), nAll = allCounts.reduce((s, v) => s + v, 0);
      let p = null, test = '';
      if (tests && lv.length >= 2) {
        const table = lv.map((_, j) => counts.map(cs => cs[j]));
        const chi = chiSquareTest(table);
        if (chi) {
          if (chi.expected.flat().some(e => e < 5)) { const f = fisherExact(table); if (f?.p != null) { p = f.p; test = 'Fisher exact'; } else { p = chi.p; test = 'Chi-square'; warnings.push(`${c.label}: Fisher's exact test not computed (${f?.message || 'too large'}); chi-square shown`); } }
          else { p = chi.p; test = 'Chi-square'; }
          used.add(test);
        }
      }
      const smd = two ? smdCategorical(counts[0], counts[1]) : null;
      out.push([`${c.label}, n (%)`, '', ...names.map(() => ''), ...(tests ? [pv(p), p == null ? '' : test] : []), ...(two ? [smd == null ? '—' : fx(smd, 2)] : []), String(missing)]);
      lv.forEach((l, j) => { sub.push(out.length); out.push([l, pc(allCounts[j], nAll), ...counts.map(cs => pc(cs[j], cs.reduce((s, v) => s + v, 0))), ...(tests ? ['', ''] : []), ...(two ? [''] : []), '']); });
    }
  }
  const dropped = d.rows.length - rows.length;
  const METHODS = { 'Welch t-test': "Welch's t-test", ANOVA: 'one-way ANOVA', 'Mann–Whitney': 'Mann–Whitney U', 'Kruskal–Wallis': 'Kruskal–Wallis', 'Chi-square': "Pearson's chi-square (Yates' correction on 2×2)", 'Fisher exact': "Fisher's exact test" };
  return {
    method: [summary === 'auto' ? 'Numeric variables as mean (SD) when Shapiro–Wilk p ≥ 0.05 in every group, else median [IQR]' : summary === 'mean' ? 'Numeric variables as mean (SD)' : 'Numeric variables as median [IQR]',
      'Categorical percentages use nonmissing observations per variable; missing or invalid values are excluded from each summary',
      used.size ? `tests: ${[...used].map(t => METHODS[t]).join(', ')}; Fisher's exact test when an expected count is below 5` : '', two ? 'SMD: absolute standardised difference (Yang & Dalton 2012 for categories)' : ''].filter(Boolean).join('; '),
    n: { used: rows.length, dropped }, warnings: [...(dropped ? [`${dropped} rows without a group are left out`] : []), ...warnings],
    tables: [{ title: 'Table 1', header, rows: out, sub }],
    sentence: `Table 1 describes ${rows.length} participants${group ? ` by ${colOf(d, group).label} (${names.map((n, k) => `${n}, ${idx[k].length}`).join('; ')})` : ''}.`,
    plot: null,
  };
}

// ---- export -------------------------------------------------------------------------------

const csvCell = v => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** Every table of a result as CSV, a blank line between tables, the method last. */
export function resultCsv(result) {
  const parts = (result.tables || []).map(t => [...(t.title ? [[t.title]] : []), t.header, ...t.rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
  parts.push([['Method', result.method], ['n used', result.n?.used], ['n dropped', result.n?.dropped]].map(r => r.map(csvCell).join(',')).join('\r\n'));
  return parts.join('\r\n\r\n') + '\r\n';
}
/** Word blocks (lib/docx-write.mjs writeTablesDocx) for a result's tables; widths share the landscape page. */
export function resultDocxBlocks(result, title) {
  const blocks = [{ type: 'para', text: title || result.title, bold: true, size: 9, after: 4 }];
  for (const t of result.tables || []) {
    if (t.title && t.title !== title) blocks.push({ type: 'para', text: t.title, bold: true, size: 8, before: 6, after: 2 });
    const k = t.header.length, first = Math.min(5200, Math.floor(15704 * 0.3));
    const widths = [first, ...Array(k - 1).fill(Math.floor((15704 - first) / Math.max(1, k - 1)))];
    const subs = new Set(t.sub || []);
    blocks.push({ type: 'table', widths, header: t.header, headerFill: 'E7E6E6', rows: t.rows.map((r, i) => ({ cells: r.map((c, j) => ({ text: j === 0 && subs.has(i) ? `    ${c}` : String(c ?? '') })) })) });
  }
  blocks.push({ type: 'para', text: result.method, size: 7, before: 4 });
  return blocks;
}

// ---- figures ---------------------------------------------------------------------------------

export { xySvg, analysisSvg } from './analysis-svg.mjs';

/** The house drawings app/lint-figures.mjs checks: a scatter with a fitted line, a Q-Q plot, a strip plot, a ROC and an empty plot, all through analysisSvg. */
export const __fixture = style => {
  const pts = Array.from({ length: 24 }, (_, i) => [20 + i * 2.1, 60 + i * 1.4 + ((i * 37) % 11) - 5]);
  const qq = Array.from({ length: 20 }, (_, i) => [-1.9 + i * 0.2, -2 + i * 0.21 + ((i * 7) % 5) * 0.03]);
  const roc = { kind: 'roc', title: 'ROC curve for the biomarker', auc: 0.81, cutoff: { se: 0.78, sp: 0.7, threshold: 12.5 }, points: [[0, 0, null], [0.1, 0.4, 20], [0.25, 0.7, 15], [0.3, 0.78, 12.5], [0.6, 0.92, 8], [1, 1, -Infinity]].map(([fpr, se, threshold]) => ({ fpr, se, sp: 1 - fpr, threshold })) };
  return [
    { name: 'scatter', svg: analysisSvg({ kind: 'scatter', title: 'Age and systolic pressure', xLabel: 'Age, years', yLabel: 'Systolic pressure, mm Hg', points: pts, line: { slope: 0.667, intercept: 46.7 } }, { style, source: ['24 patients; least-squares line'] }) },
    { name: 'qq', svg: analysisSvg({ kind: 'qq', title: 'Normal Q–Q plot of the residuals', xLabel: 'Theoretical quantiles', yLabel: 'Sample quantiles', points: qq, line: { slope: 1, intercept: 0 } }, { style }) },
    { name: 'strip', svg: analysisSvg({ kind: 'strip', title: 'Length of stay by arm', xLabel: 'Days', groups: [{ name: 'Standard care', values: [3, 4, 4, 6, 9] }, { name: 'Early mobilisation programme', values: [2, 3, 3, 4, 5] }] }, { style }) },
    { name: 'roc', svg: analysisSvg(roc, { style }) },
    { name: 'scatterEmpty', svg: xySvg({ points: [[NaN, 1]], title: 'Scatter plot' }, { style }) },
    { name: 'controlChart', svg: analysisSvg({ kind: 'spc', title: 'p chart of wound infections', centre: 0.08, centreLabel: 'Overall', limits: true, xLabel: 'Month', yLabel: 'Wound infections, proportion',
      points: [0.07, 0.09, 0.06, 0.1, 0.08, 0.21, 0.07, 0.05, 0.09, 0.08, 0.06, 0.07].map((v, i) => { const h = 3 * Math.sqrt(0.08 * 0.92 / (90 + (i * 7) % 30)); return [i + 1, v, Math.max(0, 0.08 - h), 0.08 + h, v > 0.08 + h]; }) }, { style }) },
    { name: 'runChart', svg: analysisSvg({ kind: 'spc', title: 'Run chart of length of stay', centre: 6, centreLabel: 'Median', xLabel: 'Week', yLabel: 'Length of stay, days', points: [7, 6, 8, 5, 6, 7, 5, 4, 5, 4, 3, 4].map((v, i) => [i + 1, v]) }, { style }) },
    { name: 'cePlane', svg: analysisSvg({ kind: 'ce-plane', title: 'Cost-effectiveness plane', points: Array.from({ length: 200 }, (_, i) => [0.04 + 0.03 * Math.sin(i * 1.7), 900 + 700 * Math.cos(i * 2.3)]), mean: [0.04, 900], wtp: 20000,
      xLabel: 'Incremental effect', yLabel: 'Incremental cost' }, { style }) },
    { name: 'ceac', svg: analysisSvg({ kind: 'ceac', title: 'Cost-effectiveness acceptability curve', curve: Array.from({ length: 101 }, (_, i) => [i * 600, 1 / (1 + Math.exp(-(i * 600 - 22000) / 6000))]), wtp: 20000,
      xLabel: 'Willingness to pay per unit of effect', yLabel: 'Probability cost-effective' }, { style }) },
  ];
};

// The change syntheses of a project (lib/change-synthesis.mjs) as the rest of Lykos reads them: one evaluation per state (memoised on the
// store's version, as lib/synth-project.mjs does), the query sources `syntheses` (one row per pooled result, with its printed text, and the
// benchmark by class as wide rows) and `effects` (the rows a forest or funnel draws: each effect with its CI, SE and weight, the pooled rows
// and prediction intervals marked), and the records Syntheses lists (family "Change"). Nothing is stored: a changed cell changes them.
import { changeSynthesis } from './change-synthesis.mjs';
import { clopperPearson } from './dta.mjs';
import { store$get as liveState, store$getVersion as getVersion, store$inUpdate as inUpdate } from "../boot.mjs";

let memo = null;
const weak = new WeakMap();
/** The project's change synthesis, or null when it has no plan (s.synthesis.change). */
export function changeModel(s) {
  const plan = s?.synthesis?.change;
  if (!plan) return null;
  const live = s === liveState() && !inUpdate(), key = live ? getVersion() : null;
  if (live && memo?.s === s && memo.key === key) return memo.m;
  if (!live && weak.has(s)) return weak.get(s);
  const m = changeSynthesis(s, plan);
  if (live) memo = { s, key, m }; else weak.set(s, m);
  return m;
}

// ---- the printed numbers, as the review's report writes them ---------------------------------------------------------------------
export const f2 = x => (x == null || !Number.isFinite(x) ? 'NA' : (Math.abs(x) < 0.005 && x < 0 ? '-0.00' : x.toFixed(2)));
export const f1 = x => (x == null || !Number.isFinite(x) ? 'NA' : x.toFixed(1));
export const ciText = p => (p?.est == null ? (p?.note?.startsWith('fewer') ? 'not pooled (<3 trials)' : p?.note || 'not pooled') : `${f2(p.est)} (${f2(p.ci_lo)} to ${f2(p.ci_hi)})`);
export const piText = p => (p?.pi_lo == null ? '' : `${f2(p.pi_lo)} to ${f2(p.pi_hi)}`);
const kText = p => `${p.k_trials}/${p.k_outcomes}/${p.participants}`;
const pctText = p => (p?.est == null ? '' : `${f1(p.est)} (${f1(p.ci_lo)} to ${f1(p.ci_hi)})`);

const COLUMNS = [['synthesis', 'Synthesis', 'text'], ['title', 'Analysis', 'text'], ['level', 'Level', 'text'], ['structure', 'Structure', 'text'], ['order', 'Order', 'number'],
  ['trials', 'Trials', 'number'], ['outcomes', 'Outcomes', 'number'], ['participants', 'Participants', 'number'], ['counts', 'Trials/outcomes/participants', 'text'],
  ['estimate', 'Estimate', 'number'], ['lo', 'Lower 95% CI', 'number'], ['hi', 'Upper 95% CI', 'number'], ['pi_lo', 'Lower PI', 'number'], ['pi_hi', 'Upper PI', 'number'],
  ['df', 'df', 'number'], ['p', 'p', 'number'], ['ci_text', 'Estimate (95% CI)', 'text'], ['pi_text', 'PI', 'text'], ['class_text', 'Protocol structure (class level)', 'text'],
  ['note', 'Note', 'text'], ['trials_extracted', 'Trials extracted', 'number'], ['smcr_counts', 'SMCR trials/participants', 'text'], ['resp_counts', 'Responder trials/participants', 'text'],
  ['resp_text', 'Responders % (95% CI)', 'text'], ['ratio_trials', 'Ratio trials', 'number'], ['ratio_text', 'Sham/active ratio (Fieller 95% CI)', 'text'],
  ['resp_trials', 'Responder trials', 'number'], ['resp_participants', 'Responder participants', 'number'], ['resp', 'Responders', 'number'], ['resp_lo', 'Responders lower 95% CI', 'number'],
  ['resp_hi', 'Responders upper 95% CI', 'number'], ['ratio', 'Sham/active ratio', 'number'], ['ratio_lo', 'Ratio lower 95% CI (Fieller)', 'number'], ['ratio_hi', 'Ratio upper 95% CI (Fieller)', 'number']];
const poolRow = (synthesis, title, level, p, order, extra = {}) => ({ synthesis, title, level, structure: p?.structure || '', order, trials: p?.k_trials ?? null, outcomes: p?.k_outcomes ?? null,
  participants: p?.participants ?? null, counts: p ? kText(p) : '', estimate: p?.est ?? null, lo: p?.ci_lo ?? null, hi: p?.ci_hi ?? null, pi_lo: p?.pi_lo ?? null, pi_hi: p?.pi_hi ?? null,
  df: p?.df ?? null, p: p?.p ?? null, ci_text: ciText(p), pi_text: piText(p), note: p?.note || '', ...extra });

/** The `syntheses` source: { columns, rows }. */
export function synthesisTable(s) {
  const m = changeModel(s), rows = [];
  if (!m) return { columns: COLUMNS, rows };
  const T = { primary: 'Sham SMCR', active: 'Active-arm SMCR', smd: 'Between-arm SMD', withdrawal: 'Randomized-withdrawal sham phases', responders: 'Sham responders', ...(m.plan.titles || {}) };
  let o = 0;
  rows.push(poolRow('SMCR', T.primary, 'All', m.primary.trial, o++, { class_text: ciText(m.primary.class) }));
  for (const l of m.byLevel) rows.push(poolRow('SMCR', T.primary, l.level, l.pool, o++));
  rows.push(poolRow('SMCR-class', `${T.primary}, outcomes in trials in classes`, 'All', m.primary.class, o++));
  const a = m.primary.aggregated;
  if (a) rows.push(poolRow('AGG', `${T.primary}, one aggregated effect per trial (rho 0.5), Knapp-Hartung`, 'All', { ...a, structure: 'trial (two-level)', k_outcomes: m.sets.prim.length, participants: m.primary.trial.participants }, o++, { note: `I2 = ${f1(a.i2)}%` }));
  for (const x of m.sensitivity) rows.push(poolRow(x.code, x.title, 'All', x.trial, o++, { class_text: x.class.est == null ? 'class level not fitted' : ciText(x.class) }));
  rows.push(poolRow('RW', T.withdrawal, 'All', m.withdrawal, o++));
  for (const g of m.subgroups) for (const l of g.levels) rows.push(poolRow(`G:${g.by}`, g.title, l.level, l.pool, o++));
  rows.push(poolRow('ACT', T.active, 'All', m.active.trial, o++, { class_text: ciText(m.active.class) }));
  const r = m.active.ratio;
  rows.push({ ...poolRow('RATIO', 'Sham/active ratio (joint model)', 'All', null, o++), trials: r.k_trials, outcomes: r.k_pairs ?? null, estimate: r.ratio, lo: r.fieller_lo, hi: r.fieller_hi, df: r.df ?? null,
    ci_text: r.ratio == null ? 'not estimated (<3 trials)' : `${f2(r.ratio)} (${f2(r.fieller_lo)} to ${f2(r.fieller_hi)})`, note: r.ratio == null ? '' : `pooled sham ${f2(r.pooled_sham)}, pooled active ${f2(r.pooled_active)}; active minus sham ${f2(r.active_minus_sham)} (${f2(r.active_minus_sham_lo)} to ${f2(r.active_minus_sham_hi)})` });
  rows.push(poolRow('SMD', T.smd, 'All', m.smd.trial, o++, { class_text: ciText(m.smd.class) }));
  m.egger.forEach((e, i) => rows.push({ ...poolRow(`EGGER${i + 1}`, e.test, 'All', null, o++), trials: e.k_trials, outcomes: e.k_outcomes, estimate: e.est, lo: e.lo, hi: e.hi, df: e.df, p: e.p,
    ci_text: `${f2(e.est)} (${f2(e.lo)} to ${f2(e.hi)})`, note: `model-based p ${e.p_model < 0.001 ? '< 0.001' : `= ${e.p_model.toFixed(3)}`}` }));
  const resp = m.responders, rr = (code, title, level, p) => ({ ...poolRow(code, title, level, null, o++), trials: p.k_trials, outcomes: p.k_arms, participants: p.participants, counts: `${p.k_trials}/${p.k_arms}/${p.participants}`,
    estimate: p.est, lo: p.ci_lo ?? null, hi: p.ci_hi ?? null, pi_lo: p.pi_lo ?? null, pi_hi: p.pi_hi ?? null, ci_text: p.est == null ? `not pooled; ${p.events} of ${p.participants}` : pctText(p), pi_text: p.est == null ? '' : `${f1(p.pi_lo)} to ${f1(p.pi_hi)}` });
  rows.push(rr('RESP', T.responders, 'All', resp.pool));
  for (const l of resp.byLevel) rows.push(rr('RESP', T.responders, l.level, l.pool));
  for (const x of resp.sensitivity) rows.push(rr(`RESP:${x.code}`, x.title, 'All', x.pool));
  for (const b of m.benchmark) rows.push({ ...poolRow('BENCH', 'Benchmark by indication class', b.level, b.smcr, o++), trials_extracted: b.trials_extracted, smcr_counts: `${b.smcr.k_trials}/${b.smcr.participants}`,
    resp_counts: `${b.resp_trials}/${b.resp_participants}`, resp_text: b.resp ? pctText(b.resp) : b.resp_trials ? `not pooled; ${b.resp_events} of ${b.resp_participants}` : 'none',
    resp_trials: b.resp_trials, resp_participants: b.resp_participants, resp: b.resp?.est != null ? b.resp.est / 100 : null, resp_lo: b.resp?.est != null ? b.resp.ci_lo / 100 : null,
    resp_hi: b.resp?.est != null ? b.resp.ci_hi / 100 : null, ratio: b.ratio, ratio_lo: b.ratio_lo, ratio_hi: b.ratio_hi,
    ratio_trials: b.ratio_trials, ratio_text: b.ratio == null ? 'not estimated (<3 trials)' : b.ratio_lo == null ? `${f2(b.ratio)} (CI unbounded)` : `${f2(b.ratio)} (${f2(b.ratio_lo)} to ${f2(b.ratio_hi)})` });
  return { columns: COLUMNS, rows };
}

// ---- the rows a figure draws -------------------------------------------------------------------------------------------------------
const EFFECT_COLUMNS = [['synthesis', 'Synthesis', 'text'], ['group', 'Group', 'text'], ['order', 'Order', 'number'], ['label', 'Study', 'text'], ['trial', 'Trial', 'text'],
  ['outcome', 'Outcome', 'text'], ['estimate', 'Estimate', 'number'], ['lo', 'Lower 95% CI', 'number'], ['hi', 'Upper 95% CI', 'number'], ['se', 'SE', 'number'],
  ['weight', 'Weight', 'number'], ['n', 'n', 'number'], ['pooled', 'Pooled', 'text'], ['interval', 'Interval', 'text'], ['paper_id', 'Record ID', 'text']];
const Z = 1.959963984540054;
const effect = (synthesis, group, r, w, label) => ({ synthesis, group, label: label || `${r.trial}, ${r.outcome_slot || ''}`.replace(/, $/, ''), trial: r.trial, outcome: r.outcome || '', paper_id: r.paper_id || null,
  estimate: r.yi, lo: r.yi - Z * Math.sqrt(r.vi), hi: r.yi + Z * Math.sqrt(r.vi), se: Math.sqrt(r.vi), weight: w ?? null, n: r.n ?? null, pooled: '', interval: '' });
const pooledRows = (synthesis, group, p, label) => (p?.est == null ? [] : [
  { synthesis, group, label: `${label} (${p.k_trials} trials, ${p.k_outcomes} outcomes)`, estimate: p.est, lo: p.ci_lo, hi: p.ci_hi, pooled: 'yes', interval: '' },
  ...(p.pi_lo == null ? [] : [{ synthesis, group, label: 'Prediction interval', estimate: p.est, lo: p.pi_lo, hi: p.pi_hi, pooled: '', interval: 'yes' }])]);

/** A forest's rows: the effects by group, each group's pool and PI, then the overall pool and PI ("All trials"). */
function forestRows(code, rows, by, levels, all, { label = 'Pooled', weights = null } = {}) {
  const out = [], w = new Map((weights || []).map((x, i) => [rows[i], x]));
  // a trial with two sham arms on one outcome (two sham-active pairs) names the arm
  const n = new Map(); for (const r of rows) { const k = `${r.trial}|${r.outcome_slot}`; n.set(k, (n.get(k) || 0) + 1); }
  const name = r => `${r.trial}, ${r.outcome_slot}${n.get(`${r.trial}|${r.outcome_slot}`) > 1 ? `, ${r.arm}` : ''}`;
  for (const l of levels) {
    const mine = rows.filter(r => r[by] === l.level);
    // the group's heading names it: the subtotal's label stays short enough for two lines in a screen forest (a longer one becomes a numbered key)
    out.push(...mine.map(r => effect(code, l.level, r, w.get(r), name(r))), ...pooledRows(code, l.level, l.pool, 'Subtotal'));
  }
  out.push(...pooledRows(code, 'All trials', all, label));
  return out;
}
/** The `effects` source: { columns, rows } in drawing order. */
export function effectTable(s) {
  const m = changeModel(s);
  if (!m) return { columns: EFFECT_COLUMNS, rows: [] };
  const by = m.by, rows = [];
  rows.push(...forestRows('SMCR', m.sets.prim, by, m.byLevel, m.primary.trial, { label: 'Overall', weights: m.primary.trial.weights }));
  const lev = (x, p) => [...new Set(x.map(r => r[by]))].sort().map(level => ({ level, pool: p(x.filter(r => r[by] === level)) }));
  const actRows = m.active.rows.filter(r => r.yi != null);
  rows.push(...forestRows('ACT', actRows, by, lev(actRows, x => m.poolOf(x)), m.active.trial, { label: 'Overall' }));
  rows.push(...forestRows('RW', m.sets.rw, '_all', [{ level: undefined, pool: null }], m.withdrawal, { label: 'Overall', weights: m.withdrawal.weights }).map(r => ({ ...r, group: r.group ?? 'Trials' })));
  rows.push(...forestRows('SMD', m.smd.rows, by, lev(m.smd.rows, x => m.poolOf(x)), m.smd.trial, { label: 'Overall', weights: m.smd.trial.weights }));
  // responders: each sham arm's proportion with its exact CI (percent), each class's GLMM where it has three trials, the overall GLMM
  const rp = m.responders;
  for (const l of rp.byLevel) {
    for (const a of rp.rows.filter(r => r[by] === l.level)) { const [lo, hi] = clopperPearson(a.responders_k, a.responders_n);
      rows.push({ synthesis: 'RESP', group: l.level, label: a.trial, trial: a.trial, outcome: a.outcome, paper_id: a.paper_id, estimate: 100 * a.responders_k / a.responders_n, lo: 100 * lo, hi: 100 * hi, n: a.responders_n, pooled: '', interval: '' }); }
    if (l.pool.est != null) rows.push({ synthesis: 'RESP', group: l.level, label: `Subtotal (${l.pool.k_trials} trials)`, estimate: l.pool.est, lo: l.pool.ci_lo, hi: l.pool.ci_hi, pooled: 'yes', interval: '' },
      { synthesis: 'RESP', group: l.level, label: 'Prediction interval', estimate: l.pool.est, lo: l.pool.pi_lo, hi: l.pool.pi_hi, pooled: '', interval: 'yes' });
  }
  if (rp.pool.est != null) rows.push({ synthesis: 'RESP', group: 'All trials', label: `Overall (${rp.pool.k_trials} trials)`, estimate: rp.pool.est, lo: rp.pool.ci_lo, hi: rp.pool.ci_hi, pooled: 'yes', interval: '' },
    { synthesis: 'RESP', group: 'All trials', label: 'Prediction interval', estimate: rp.pool.est, lo: rp.pool.pi_lo, hi: rp.pool.pi_hi, pooled: '', interval: 'yes' });
  // the sensitivity forest: each set's pooled estimate (outcomes in trials), the primary first
  m.sensitivity.forEach(x => { if (x.trial.est != null) rows.push({ synthesis: 'SENS', group: '', label: `${x.title} (${x.trial.k_trials}/${x.trial.k_outcomes})`, estimate: x.trial.est, lo: x.trial.ci_lo, hi: x.trial.ci_hi, pooled: x.code === 'P' ? 'yes' : '', interval: '' }); });
  // the subgroup forest: every level of every subgroup with three trials or more
  for (const g of m.subgroups) for (const l of g.levels) if (l.pool.est != null) rows.push({ synthesis: 'SUBGROUPS', group: g.title, label: `${l.level} (${l.pool.k_trials}/${l.pool.k_outcomes})`, estimate: l.pool.est, lo: l.pool.ci_lo, hi: l.pool.ci_hi, pooled: '', interval: '' });
  // the funnel: the primary set's effects with their SE, the pooled line as its pooled row
  rows.push(...m.sets.prim.map(r => effect('FUNNEL', '', r)), ...pooledRows('FUNNEL', '', m.primary.trial, 'Pooled').slice(0, 1));
  return { columns: EFFECT_COLUMNS, rows: rows.map((r, i) => ({ ...r, order: i })) };
}

// ---- the figures, as Syntheses lists and draws them ---------------------------------------------------------------------------------
const FOREST = (where, extra = {}) => ({ query: { from: 'effects', where: `Synthesis = ${where}`, select: ['Group', 'Study', 'Estimate', 'Lower 95% CI', 'Upper 95% CI', 'Weight', 'Pooled', 'Interval'], limit: 500 },
  groupRowsBy: 'Group', chart: { type: 'forest', x: 'Study', y: 'Estimate', lo: 'Lower 95% CI', hi: 'Upper 95% CI', weight: 'Weight', pooled: 'Pooled', interval: 'Interval', groupOrder: 'rows', ref: 0, xLabel: 'SMCR (improvement positive)', ...extra } });
/** The change figures: { code, title, kind, spec } (a spec over the effects source, as an output of the project would be). */
export const CHANGE_FIGURES = [
  { code: 'SMCR', title: 'Sham SMCR by indication class', kind: 'forest', spec: FOREST('SMCR') },
  { code: 'ACT', title: 'Active-arm SMCR by indication class', kind: 'forest', spec: FOREST('ACT') },
  { code: 'RESP', title: 'Sham responders by indication class', kind: 'forest', spec: FOREST('RESP', { ref: undefined, xLabel: 'Sham responders (%)' }) },
  { code: 'SMD', title: 'Between-arm SMD at the end of the blinded phase', kind: 'forest', spec: FOREST('SMD', { xLabel: 'SMD (positive favours active)' }) },
  { code: 'RW', title: 'Randomized-withdrawal sham phases', kind: 'forest', spec: FOREST('RW') },
  { code: 'SENS', title: 'Sensitivity analyses of the sham SMCR', kind: 'forest', spec: { query: { from: 'effects', where: 'Synthesis = SENS', select: ['Study', 'Estimate', 'Lower 95% CI', 'Upper 95% CI', 'Pooled'], limit: 100 },
    chart: { type: 'forest', x: 'Study', y: 'Estimate', lo: 'Lower 95% CI', hi: 'Upper 95% CI', pooled: 'Pooled', ref: 0, xLabel: 'SMCR (improvement positive)' } } },
  { code: 'SUBGROUPS', title: 'Sham SMCR by subgroup', kind: 'forest', spec: FOREST('SUBGROUPS') },
  { code: 'FUNNEL', title: 'Funnel plot of the sham SMCR', kind: 'funnel', spec: { query: { from: 'effects', where: 'Synthesis = FUNNEL', select: ['Study', 'Estimate', 'SE', 'Pooled'], limit: 500 },
    chart: { type: 'funnel', x: 'Estimate', y: 'SE', pooled: 'Pooled', xLabel: 'SMCR (improvement positive)' } } },
];
/** The change figures a project can draw, each with how many rows it has: [{ code, title, kind, k }]. */
export function changeFigureList(s) {
  if (!changeModel(s)) return [];
  const rows = effectTable(s).rows;
  return CHANGE_FIGURES.map(f => ({ code: f.code, title: f.title, kind: f.kind, k: rows.filter(r => r.synthesis === f.code && !r.pooled && !r.interval).length })).filter(f => f.k > 0);
}
/**
 * One change figure as SVG ({ svg, title, rows } or { error }), drawn by the output chart renderer in the given figure style (export unless
 * given). `group` draws one group of a forest (a class, or one subgroup of SUBGROUPS) with its subtotal; `width` is the screen width.
 * `rows` are the query rows in the order the marks' data-row count them: [{ label, paperId }] (paperId null on a pooled row).
 */
export async function changeFigure(s, code, { style = null, group = '', width } = {}) {
  const f = CHANGE_FIGURES.find(x => x.code === code);
  if (!f || !changeModel(s)) return { error: `No change synthesis "${code}"` };
  // loaded here: output-render reads the query layer, which reads this module
  const [spec, render, style0] = await Promise.all([import('./output-spec.mjs'), import('./output-render.mjs'), import('./figure-style.mjs')]);
  const query = { ...f.spec.query, select: [...f.spec.query.select, 'Record ID'], ...(group ? { where: `${f.spec.query.where}; Group = ${group}` } : {}) };
  const v = spec.validateSpec({ id: `synth-${code.toLowerCase()}`, kind: 'chart', title: group ? `${f.title}: ${group}` : f.title, ...f.spec, query, chart: Object.fromEntries(Object.entries(f.spec.chart).filter(([, x]) => x !== undefined)) });
  if (!v.ok) return { error: v.errors.join(' ') };
  const out = render.renderOutput(s, v.spec);
  if (!out.result.rows.length) return { error: group ? `${f.title} has no rows in ${group}` : `${f.title} has no rows to draw` };
  const li = out.result.columns.findIndex(c => c.label === 'Study'), ri = out.result.columns.findIndex(c => c.label === 'Record ID');
  return { svg: render.chartSvg(out, { style: style || style0.figureTokens(null, { medium: 'export' }), ...(width ? { width } : {}) }), title: v.spec.title,
    rows: out.result.rows.map(r => ({ label: String(r[li] ?? ''), paperId: r[ri] || null })) };
}

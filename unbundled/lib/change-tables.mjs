// The change syntheses' printed numbers and the rows their figures draw, from a model of lib/change-synthesis.mjs. Pure: lib/change-records.mjs
// serves them to the query layer and the Syntheses page, and the worker (lib/change-worker.mjs) makes them off the page's thread.
// The `effects` source is built in sections, one per figure or analysis, so a figure's rows (and the list's counts) are made without the
// analyses no figure on the list draws (leave one out and the serious adverse events cost more than the rest of the list together).
import { clopperPearson } from './beta-exact.mjs';
import { aggregateByTrial, regressionLine } from './change-moderators.mjs';
import { readsOf, withReads } from './run-reads.mjs';

// ---- the printed numbers, as the review's report writes them ---------------------------------------------------------------------
export const f2 = x => (x == null || !Number.isFinite(x) ? 'NA' : (Math.abs(x) < 0.005 && x < 0 ? '-0.00' : x.toFixed(2)));
export const f1 = x => (x == null || !Number.isFinite(x) ? 'NA' : x.toFixed(1));
// a printed cell starts with a capital letter, as every label of a table does (2 Nov 2026)
const cap1 = t => String(t).charAt(0).toUpperCase() + String(t).slice(1);
export const ciText = p => (p?.est == null ? (p?.note?.startsWith('fewer') ? 'Not pooled (<3 trials)' : cap1(p?.note || 'not pooled')) : `${f2(p.est)} (${f2(p.ci_lo)} to ${f2(p.ci_hi)})`);
export const piText = p => (p?.pi_lo == null ? '' : `${f2(p.pi_lo)} to ${f2(p.pi_hi)}`);
export const pText = p => (p == null || !Number.isFinite(p) ? 'NA' : p < 0.001 ? '<0.001' : p.toFixed(3));

// ---- the rows a figure draws -------------------------------------------------------------------------------------------------------
export const EFFECT_COLUMNS = [['synthesis', 'Synthesis', 'text'], ['group', 'Group', 'text'], ['order', 'Order', 'number'], ['label', 'Study', 'text'], ['trial', 'Trial', 'text'],
  ['outcome', 'Outcome', 'text'], ['estimate', 'Estimate', 'number'], ['lo', 'Lower 95% CI', 'number'], ['hi', 'Upper 95% CI', 'number'], ['se', 'SE', 'number'],
  ['weight', 'Weight', 'number'], ['n', 'n', 'number'], ['events', 'Events', 'number'], ['basis', 'Basis', 'text'], ['pooled', 'Pooled', 'text'], ['interval', 'Interval', 'text'], ['paper_id', 'Record ID', 'text'],
  ['x', 'Moderator', 'number']];
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
const actRowsOf = m => m.active.rows.filter(r => r.yi != null);
const levelsOf = (m, x) => [...new Set(x.map(r => r[m.by]))].sort().map(level => ({ level, pool: m.poolOf(x.filter(r => r[m.by] === level)) }));
/** One row per trial (its outcomes aggregated, rho 0.5, as the two-level model reads them), by class, with each class's pool and PI and the overall. */
function perTrial(m, code, x, levels, all, fit) {
  const by = m.by, w = new Map(); if (fit?.weights) x.forEach((r, i) => w.set(r.trial, (w.get(r.trial) || 0) + (fit.weights[i] || 0)));
  const ag = new Map(aggregateByTrial(x).map(a => [a.trial, a])), out = [];
  for (const l of levels) {
    const ts = [...new Set(x.filter(r => r[by] === l.level).map(r => r.trial))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));
    for (const t of ts) { const a = ag.get(t), r0 = x.find(r => r.trial === t);
      out.push({ ...effect(code, l.level, { ...r0, yi: a.yi, vi: a.vi, n: null }, w.has(t) ? w.get(t) : null, t), outcome: `${a.k} outcome${a.k === 1 ? '' : 's'}` }); }
    out.push(...pooledRows(code, l.level, l.pool, 'Subtotal').map(r => (r.pooled ? { ...r, label: `Subtotal (${l.pool.k_trials} trials)` } : r)));
  }
  out.push(...pooledRows(code, 'All trials', all, 'Overall'));
  return out;
}
/** The sections of the `effects` source in drawing order: [code, rows of model]; every row of a section has that code as its synthesis. */
const SECTIONS = [
  ['SMCR', m => forestRows('SMCR', m.sets.prim, m.by, m.byLevel, m.primary.trial, { label: 'Overall', weights: m.primary.trial.weights })],
  ['ACT', m => { const x = actRowsOf(m); return forestRows('ACT', x, m.by, levelsOf(m, x), m.active.trial, { label: 'Overall' }); }],
  ['RW', m => forestRows('RW', m.sets.rw, '_all', [{ level: undefined, pool: null }], m.withdrawal, { label: 'Overall', weights: m.withdrawal.weights }).map(r => ({ ...r, group: r.group ?? 'Trials' }))],
  ['SMD', m => forestRows('SMD', m.smd.rows, m.by, levelsOf(m, m.smd.rows), m.smd.trial, { label: 'Overall', weights: m.smd.trial.weights })],
  // responders: each sham arm's proportion with its exact CI (percent), each class's GLMM where it has three trials, the overall GLMM
  ['RESP', m => {
    const rp = m.responders, rows = [];
    for (const l of rp.byLevel) {
      for (const a of rp.rows.filter(r => r[m.by] === l.level)) { const [lo, hi] = clopperPearson(a.responders_k, a.responders_n);
        rows.push({ synthesis: 'RESP', group: l.level, label: a.trial, trial: a.trial, outcome: a.outcome, paper_id: a.paper_id, estimate: 100 * a.responders_k / a.responders_n, lo: 100 * lo, hi: 100 * hi, n: a.responders_n, pooled: '', interval: '' }); }
      if (l.pool.est != null) rows.push({ synthesis: 'RESP', group: l.level, label: `Subtotal (${l.pool.k_trials} trials)`, estimate: l.pool.est, lo: l.pool.ci_lo, hi: l.pool.ci_hi, pooled: 'yes', interval: '' },
        { synthesis: 'RESP', group: l.level, label: 'Prediction interval', estimate: l.pool.est, lo: l.pool.pi_lo, hi: l.pool.pi_hi, pooled: '', interval: 'yes' });
    }
    if (rp.pool.est != null) rows.push({ synthesis: 'RESP', group: 'All trials', label: `Overall (${rp.pool.k_trials} trials)`, estimate: rp.pool.est, lo: rp.pool.ci_lo, hi: rp.pool.ci_hi, pooled: 'yes', interval: '' },
      { synthesis: 'RESP', group: 'All trials', label: 'Prediction interval', estimate: rp.pool.est, lo: rp.pool.pi_lo, hi: rp.pool.pi_hi, pooled: '', interval: 'yes' });
    return rows;
  }],
  // the sensitivity forest: each set's pooled estimate (outcomes in trials), the primary first
  ['SENS', m => m.sensitivity.filter(x => x.trial.est != null).map(x => ({ synthesis: 'SENS', group: '', label: `${x.title} (${x.trial.k_trials}/${x.trial.k_outcomes})`, estimate: x.trial.est, lo: x.trial.ci_lo, hi: x.trial.ci_hi, pooled: x.code === 'P' ? 'yes' : '', interval: '' }))],
  // the subgroup forest: every level of every subgroup with three trials or more
  ['SUBGROUPS', m => m.subgroups.flatMap(g => g.levels.filter(l => l.pool.est != null).map(l => ({ synthesis: 'SUBGROUPS', group: g.title, label: `${l.label ?? l.level} (${l.pool.k_trials}/${l.pool.k_outcomes})`, estimate: l.pool.est, lo: l.pool.ci_lo, hi: l.pool.ci_hi, pooled: '', interval: '' })))],
  ['SMCR-TRIAL', m => perTrial(m, 'SMCR-TRIAL', m.sets.prim, m.byLevel, m.primary.trial, m.primary.trial)],
  ['ACT-TRIAL', m => { const x = actRowsOf(m); return perTrial(m, 'ACT-TRIAL', x, levelsOf(m, x), m.active.trial, m.active.trial); }],
  // leave one trial out: the pool without each trial, then the pool of all
  ['LOO', m => !m.leaveOneOut ? [] : [...m.leaveOneOut.filter(x => x.trialPool.est != null).map(x => ({ synthesis: 'LOO', group: '', label: `Without ${x.trial}`, trial: x.trial, estimate: x.trialPool.est, lo: x.trialPool.ci_lo, hi: x.trialPool.ci_hi, pooled: '', interval: '' })),
    { ...pooledRows('LOO', '', m.primary.trial, 'All trials')[0] }]],
  // serious adverse events: each coded sham arm (events over participants, the coding's basis), then the GLMM rate
  ['SAE', m => { const sae = m.sae; if (!sae) return [];
    return [...sae.rows.map(c => ({ synthesis: 'SAE', group: '', label: c.trial, trial: c.trial, estimate: c.events / c.n, n: c.n, events: c.events, basis: c.basis ? cap1(c.basis) : c.basis, pooled: '', interval: '' })),
      ...(sae.rate != null ? [{ synthesis: 'SAE', group: '', label: `Pooled rate (${sae.k_trials} trials)`, estimate: sae.rate, lo: sae.ci_lo, hi: sae.ci_hi, n: sae.participants, events: sae.events, pooled: 'yes', interval: '' }] : [])]; }],
  // bubble plots of the numeric moderators (synthesis "MR-<code>"): each outcome at its moderator value, weighted by its inverse variance (percent
  // of the model's total), then the fitted line with its CR2 95% CI across the moderator's range (Interval "fit")
  ['MR', m => (m.moderators?.univariable || []).flatMap(u => {
    const g = u.term && u.reg ? regressionLine(u.reg, u.term) : null; if (!g) return [];
    const code = `MR-${u.code}`, W = g.points.reduce((a, p) => a + 1 / p.vi, 0);
    return [...g.points.map(p => ({ synthesis: code, group: u.title, label: `${p.trial}, ${p.row.outcome_slot || ''}`.replace(/, $/, ''), trial: p.trial, outcome: p.row.outcome || '', paper_id: p.row.paper_id || null,
      x: p.x, estimate: p.yi, lo: p.yi - Z * Math.sqrt(p.vi), hi: p.yi + Z * Math.sqrt(p.vi), se: Math.sqrt(p.vi), weight: 100 / p.vi / W, n: p.row.n ?? null, pooled: '', interval: '' })),
      ...g.line.map(l => ({ synthesis: code, group: u.title, label: 'Fitted', x: l.x, estimate: l.est, lo: l.lo, hi: l.hi, pooled: '', interval: 'fit' }))];
  })],
  // the funnel: the primary set's effects with their SE, the pooled line as its pooled row
  ['FUNNEL', m => [...m.sets.prim.map(r => effect('FUNNEL', '', r)), ...pooledRows('FUNNEL', '', m.primary.trial, 'Pooled').slice(0, 1)]],
];
const sections = new WeakMap();
/** The rows of one section of the `effects` source (its code: SMCR, RESP, LOO, ...), made once per model; [] for an unknown code. */
export function effectSection(m, code) {
  let got = sections.get(m); if (!got) sections.set(m, (got = new Map()));
  if (!got.has(code)) { const sec = SECTIONS.find(([c]) => c === code); got.set(code, sec ? sec[1](m) : []); }
  return got.get(code);
}
/** The `effects` source of a model: { columns, rows } in drawing order, each row with its order. */
export function effectRowsOf(m) {
  return { columns: EFFECT_COLUMNS, rows: SECTIONS.flatMap(([code]) => effectSection(m, code)).map((r, i) => ({ ...r, order: i })) };
}

// ---- the syntheses source: one row per pooled result ------------------------------------------------------------------------------
const kText = p => `${p.k_trials}/${p.k_outcomes}/${p.participants}`;
const pctText = p => (p?.est == null ? '' : `${f1(p.est)} (${f1(p.ci_lo)} to ${f1(p.ci_hi)})`);

export const SYNTHESIS_COLUMNS = [['synthesis', 'Synthesis', 'text'], ['title', 'Analysis', 'text'], ['level', 'Level', 'text'], ['structure', 'Structure', 'text'], ['order', 'Order', 'number'],
  ['trials', 'Trials', 'number'], ['outcomes', 'Outcomes', 'number'], ['participants', 'Participants', 'number'], ['counts', 'Trials/outcomes/participants', 'text'],
  ['estimate', 'Estimate', 'number'], ['lo', 'Lower 95% CI', 'number'], ['hi', 'Upper 95% CI', 'number'], ['pi_lo', 'Lower PI', 'number'], ['pi_hi', 'Upper PI', 'number'],
  ['df', 'df', 'number'], ['p', 'p', 'number'], ['ci_text', 'Estimate (95% CI)', 'text'], ['pi_text', 'PI', 'text'], ['class_text', 'Protocol structure (class level)', 'text'],
  ['note', 'Note', 'text'], ['trials_extracted', 'Trials extracted', 'number'], ['smcr_counts', 'SMCR trials/participants', 'text'], ['resp_counts', 'Responder trials/participants', 'text'],
  ['resp_text', 'Responders % (95% CI)', 'text'], ['ratio_trials', 'Ratio trials', 'number'], ['ratio_text', 'Sham/active ratio (Fieller 95% CI)', 'text'],
  ['resp_trials', 'Responder trials', 'number'], ['resp_participants', 'Responder participants', 'number'], ['resp', 'Responders', 'number'], ['resp_lo', 'Responders lower 95% CI', 'number'],
  ['resp_hi', 'Responders upper 95% CI', 'number'], ['ratio', 'Sham/active ratio', 'number'], ['ratio_lo', 'Ratio lower 95% CI (Fieller)', 'number'], ['ratio_hi', 'Ratio upper 95% CI (Fieller)', 'number'],
  ['f_model', 'F (df), model-based', 'text'], ['p_model', 'p, model-based', 'text'], ['f_cr2', 'F (df), CR2', 'text'], ['p_cr2', 'p, CR2', 'text'], ['p_perm', 'p, permutation', 'text'],
  ['permutations', 'Permutations', 'number']];
const fF = (F, a, b) => (F == null ? 'NA' : `${f2(F)} (${a}, ${Number.isInteger(b) ? b : f1(b)})`);
const mrRow = (code, title, level, t, perm, k, order) => ({ ...poolRow(code, title, level, null, order), ci_text: '', trials: k.k_trials, outcomes: k.k_outcomes, counts: `${k.k_trials}/${k.k_outcomes}`,
  f_model: fF(t.F_model, t.df1_model, t.df2_model), p_model: pText(t.p_model), f_cr2: t.F_cr2 == null ? 'not estimable' : fF(t.F_cr2, t.df1_cr2, t.df2_cr2), p_cr2: pText(t.p_cr2),
  p_perm: perm && !perm.stale ? pText(perm.p) : perm?.stale ? 'not run on the current data' : 'not run', permutations: perm && !perm.stale ? perm.permutations : null,
  note: t.constraints_used != null && t.constraints_used < t.constraints ? `CR2 test on ${t.constraints_used} of ${t.constraints} coefficients (a level with one trial has no CR2 variance)` : '' });
const poolRow = (synthesis, title, level, p, order, extra = {}) => ({ synthesis, title, level, structure: p?.structure || '', order, trials: p?.k_trials ?? null, outcomes: p?.k_outcomes ?? null,
  participants: p?.participants ?? null, counts: p ? kText(p) : '', estimate: p?.est ?? null, lo: p?.ci_lo ?? null, hi: p?.ci_hi ?? null, pi_lo: p?.pi_lo ?? null, pi_hi: p?.pi_hi ?? null,
  df: p?.df ?? null, p: p?.p ?? null, ci_text: ciText(p), pi_text: piText(p), note: p?.note || '', ...extra });

/**
 * The rows of the pools with a scale converted into its target's same-scale pool (G3b; made only with a convert decision): a sensitivity
 * analysis each. [{ row, from }]: `from` is the pool with what its numbers rest on, the arms it pools and each converted arm's own cells,
 * the covariate it was converted with among them (`pid:col@arm`). `order()` numbers the rows.
 */
export function convertedRowsOf(m, title, order) {
  return (m.converted || []).filter(x => x.pool).map(x => ({
    row: poolRow(`CONV:${x.from}>${x.to}`, `${title}, ${x.to} with ${x.from} converted (${x.label || x.crosswalk})`, 'All', x.pool, order(),
      { note: `${x.converted} ${x.converted === 1 ? 'arm' : 'arms'} converted from ${x.from}, ${x.own} on ${x.to}${Object.keys(x.out || {}).length ? `; not converted: ${Object.entries(x.out).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}` }),
    from: withReads(x.pool, [...x.rows, ...x.rows.filter(r => r.converted_from).map(r => ({ trial: r.trial, arm: r.arm, armLevel: true }))]) }));
}

/** The `syntheses` source of a model: { columns, rows }, one row per pooled result with its printed text, the benchmark by class as wide rows. */
export function synthesisRowsOf(m, { reads = false } = {}) {
  // `reads`: each row also names the rows it was computed from (lib/run-reads.mjs), for the run's record (lib/analysis-run.mjs)
  const rows = [], froms = [], put = (row, from) => { rows.push(row); froms.push(from); };
  if (!m) return { columns: SYNTHESIS_COLUMNS, rows };
  const T = { primary: 'Sham SMCR', active: 'Active-arm SMCR', smd: 'Between-arm SMD', withdrawal: 'Randomized-withdrawal sham phases', responders: 'Sham responders', ...(m.plan.titles || {}) };
  let o = 0;
  put(poolRow('SMCR', T.primary, 'All', m.primary.trial, o++, { class_text: ciText(m.primary.class) }), m.primary.trial);
  for (const l of m.byLevel) put(poolRow('SMCR', T.primary, l.level, l.pool, o++), l.pool);
  put(poolRow('SMCR-class', `${T.primary}, outcomes in trials in classes`, 'All', m.primary.class, o++), m.primary.class);
  const a = m.primary.aggregated;
  if (a) put(poolRow('AGG', `${T.primary}, one aggregated effect per trial (rho 0.5), Knapp-Hartung`, 'All', { ...a, structure: 'trial (two-level)', k_outcomes: m.sets.prim.length, participants: m.primary.trial.participants }, o++, { note: `I2 = ${f1(a.i2)}%` }), a);
  for (const x of m.sensitivity) put(poolRow(x.code, x.title, 'All', x.trial, o++, { class_text: x.class.est == null ? 'class level not fitted' : ciText(x.class) }), x.trial);
  put(poolRow('RW', T.withdrawal, 'All', m.withdrawal, o++), m.withdrawal);
  for (const g of m.subgroups) for (const l of g.levels) put(poolRow(`G:${g.key || g.by}`, g.title, l.label ?? l.level, l.pool, o++), l.pool);
  for (const c of convertedRowsOf(m, T.primary, () => o++)) put(c.row, c.from);
  put(poolRow('ACT', T.active, 'All', m.active.trial, o++, { class_text: ciText(m.active.class) }), m.active.trial);
  const r = m.active.ratio;
  put({ ...poolRow('RATIO', 'Sham/active ratio (joint model)', 'All', null, o++), trials: r.k_trials, outcomes: r.k_pairs ?? null, estimate: r.ratio, lo: r.fieller_lo, hi: r.fieller_hi, df: r.df ?? null,
    ci_text: r.ratio == null ? 'Not estimated (<3 trials)' : `${f2(r.ratio)} (${f2(r.fieller_lo)} to ${f2(r.fieller_hi)})`, note: r.ratio == null ? '' : `pooled sham ${f2(r.pooled_sham)}, pooled active ${f2(r.pooled_active)}; active minus sham ${f2(r.active_minus_sham)} (${f2(r.active_minus_sham_lo)} to ${f2(r.active_minus_sham_hi)})` }, r);
  put(poolRow('SMD', T.smd, 'All', m.smd.trial, o++, { class_text: ciText(m.smd.class) }), m.smd.trial);
  m.egger.forEach((e, i) => put({ ...poolRow(`EGGER${i + 1}`, e.test, 'All', null, o++), trials: e.k_trials, outcomes: e.k_outcomes, estimate: e.est, lo: e.lo, hi: e.hi, df: e.df, p: e.p,
    ci_text: `${f2(e.est)} (${f2(e.lo)} to ${f2(e.hi)})`, note: `model-based p ${e.p_model < 0.001 ? '< 0.001' : `= ${e.p_model.toFixed(3)}`}` }, e));
  const resp = m.responders, rr = (code, title, level, p) => ({ ...poolRow(code, title, level, null, o++), trials: p.k_trials, outcomes: p.k_arms, participants: p.participants, counts: `${p.k_trials}/${p.k_arms}/${p.participants}`,
    estimate: p.est, lo: p.ci_lo ?? null, hi: p.ci_hi ?? null, pi_lo: p.pi_lo ?? null, pi_hi: p.pi_hi ?? null, ci_text: p.est == null ? `Not pooled; ${p.events} of ${p.participants}` : pctText(p), pi_text: p.est == null ? '' : `${f1(p.pi_lo)} to ${f1(p.pi_hi)}` });
  put(rr('RESP', T.responders, 'All', resp.pool), resp.pool);
  for (const l of resp.byLevel) put(rr('RESP', T.responders, l.level, l.pool), l.pool);
  for (const x of resp.sensitivity) put(rr(`RESP:${x.code}`, x.title, 'All', x.pool), x.pool);
  // moderators: each univariable model, then the multivariable model's omnibus and term tests
  const md = m.moderators;
  if (md) {
    // a numeric moderator's slope (one coefficient) with its CR2 CI, per unit of the moderator
    const g4 = (x, d) => (x == null || !Number.isFinite(x) ? 'NA' : x.toFixed(d)), dOf = c => (Math.max(...[c.est, c.lo, c.hi].map(v => Math.abs(v ?? 0))) >= 0.1 ? 2 : 4);
    for (const u of md.univariable) if (u.reg) { const c = u.reg.names.length === 2 && u.reg.names[1] === u.code ? u.reg.coefficients[1] : null;
      put({ ...mrRow('MR', u.title, 'All', u.test, u.permutation, u.reg, o++), ...(c ? { estimate: c.est, lo: c.lo, hi: c.hi, ci_text: `${g4(c.est, dOf(c))} (${g4(c.lo, dOf(c))} to ${g4(c.hi, dOf(c))})` } : {}) }, u); }
    for (const x of md.multivariable) if (x.reg) for (const t of x.tests) put(mrRow('MR-MULTI', x.title, t.title, t, t.permutation, x.reg, o++), t);
    const b = md.bootstrap;
    if (b && !b.stale) put({ ...poolRow('BOOT', 'Sham/active ratio, trial bootstrap (percentile 95% CI)', 'All', null, o++), trials: r.k_trials, estimate: b.ratio_median, lo: b.ratio_lo, hi: b.ratio_hi,
      ci_text: `${f2(b.ratio_median)} (${f2(b.ratio_lo)} to ${f2(b.ratio_hi)})`, permutations: b.resamples, note: `${b.resamples} resamples; active SMCR at or below 0 in ${f1(100 * b.share_active_le_0)}%` }, b);
  }
  for (const t of m.trialLevel) put({ ...poolRow(t.code, t.analysis, 'All', null, o++), trials: t.k_trials, estimate: t.estimate, lo: t.ci_lo, hi: t.ci_hi, p: t.p,
    ci_text: t.estimate == null ? 'Not estimated' : `${f2(t.estimate)} (${f2(t.ci_lo)} to ${f2(t.ci_hi)})`, p_model: pText(t.p), note: t.events != null ? `${t.scale}; ${t.events} trials failed` : t.scale }, t);
  const sae = m.sae;
  if (sae) put({ ...poolRow('SAE', 'Serious adverse events per sham-arm participant (Poisson-normal GLMM)', 'All', null, o++), trials: sae.k_trials, participants: sae.participants, counts: `${sae.k_trials}/${sae.participants}`,
    estimate: sae.rate, lo: sae.ci_lo, hi: sae.ci_hi, pi_lo: sae.pi_lo, pi_hi: sae.pi_hi, ci_text: sae.rate == null ? 'Not pooled' : `${f2(sae.rate)} (${f2(sae.ci_lo)} to ${f2(sae.ci_hi)})`, pi_text: sae.pi_lo == null ? '' : `${f2(sae.pi_lo)} to ${f2(sae.pi_hi)}`,
    note: `${sae.events} events; ${sae.arms_with_zero} arms with none; crude ${f2(sae.crude_rate)}; ${sae.trials_not_usable} trials not usable${sae.changed.length ? `; ${sae.changed.length} coded cells changed since coding` : ''}${sae.missing.length ? `; ${sae.missing.length} coded arms no longer in the record` : ''}` }, sae);
  for (const g of m.percent.groups) put({ ...poolRow('PCT', 'Sham-arm percent improvement (median, IQR)', g.group, null, o++), trials: g.k_trials, outcomes: g.k_arms, counts: `${g.k_trials}/${g.k_arms}`,
    estimate: g.median, lo: g.q1, hi: g.q3, ci_text: `${f1(g.median)} (${f1(g.q1)} to ${f1(g.q3)})`, note: `range ${f1(g.min)} to ${f1(g.max)}` }, g);
  for (const b of m.benchmark) put({ ...poolRow('BENCH', 'Benchmark by indication class', b.level, b.smcr, o++), trials_extracted: b.trials_extracted, smcr_counts: `${b.smcr.k_trials}/${b.smcr.participants}`,
    resp_counts: `${b.resp_trials}/${b.resp_participants}`, resp_text: b.resp ? pctText(b.resp) : b.resp_trials ? `Not pooled; ${b.resp_events} of ${b.resp_participants}` : 'None',
    resp_trials: b.resp_trials, resp_participants: b.resp_participants, resp: b.resp?.est != null ? b.resp.est / 100 : null, resp_lo: b.resp?.est != null ? b.resp.ci_lo / 100 : null,
    resp_hi: b.resp?.est != null ? b.resp.ci_hi / 100 : null, ratio: b.ratio, ratio_lo: b.ratio_lo, ratio_hi: b.ratio_hi,
    ratio_trials: b.ratio_trials, ratio_text: b.ratio == null ? 'Not estimated (<3 trials)' : b.ratio_lo == null ? `${f2(b.ratio)} (CI unbounded)` : `${f2(b.ratio)} (${f2(b.ratio_lo)} to ${f2(b.ratio_hi)})` }, b);
  // a note printed in a table starts with a capital letter, as every cell does (2 Nov 2026)
  const out = rows.map(r => (typeof r.note === 'string' && /^[a-z]/.test(r.note) ? { ...r, note: r.note.charAt(0).toUpperCase() + r.note.slice(1) } : r));
  if (reads) out.forEach((r, i) => { r.reads = readsOf(froms[i]); });
  return { columns: SYNTHESIS_COLUMNS, rows: out };
}


/** The protocol's association rule over a change synthesis's moderators (CR2 and permutation p < 0.05, CR2 denominator df >= 4); null without moderators. */
export function associationOf(model) {
  const md = model?.moderators;
  if (!md) return null;
  const met = md.univariable.filter(u => u.test && u.test.p_cr2 < 0.05 && u.test.df2_cr2 >= 4 && u.permutation && !u.permutation.stale && u.permutation.p < 0.05).map(u => u.title);
  return { met, rule: 'the association rule (CR2 and permutation p < 0.05, CR2 df at least 4)' };
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
/** The change figures a model can draw, each with how many rows it has: [{ code, title, kind, k }]. */
export const figureListOf = m => CHANGE_FIGURES.map(f => ({ code: f.code, title: f.title, kind: f.kind, k: effectSection(m, f.code).filter(r => !r.pooled && !r.interval).length })).filter(f => f.k > 0);

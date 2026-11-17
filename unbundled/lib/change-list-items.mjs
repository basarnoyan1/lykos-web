// The change syntheses as the Syntheses page lists them (views/syntheses-change.mjs), from a model of lib/change-synthesis.mjs: each synthesis
// with its printed numbers, the groups a forest can be narrowed to and each group's own pool. Pure, so the worker (lib/change-worker.mjs)
// makes the list off the page's thread; lib/change-list.mjs makes it from a project. It reads only what the list shows: no leave one out,
// no serious adverse events, no moderators.
import { effectSection, figureListOf, ciText, piText, f1, f2 } from './change-tables.mjs';

const pText = p => (p == null ? '' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
const nOf = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const counts = p => `${nOf(p.k_trials, 'trial')}, ${nOf(p.k_outcomes, 'outcome')}, ${nOf(p.participants, 'participant')}`;
const plotOf = p => (p?.est == null ? null : { est: p.est, lo: p.ci_lo, hi: p.ci_hi, pi_lo: p.pi_lo ?? null, pi_hi: p.pi_hi ?? null });
/** The groups a forest of the effects source can be narrowed to (its Group values but the overall one), in drawing order. */
function groupsOf(m, code) {
  return [...new Set(effectSection(m, code).filter(r => r.group && r.group !== 'All trials' && r.group !== 'Trials').map(r => r.group))];
}
/**
 * The change syntheses as the Syntheses page lists them: [{ group, items }], each item { code, title, kind, k, scale ('smcr' | 'pct' | null),
 * plot ({ est, lo, hi, pi_lo, pi_hi } on its scale, or null), estimate, pi, counts, details: [[label, text]], groups: [level], groupLabel,
 * levels: { level: [[label, text]] } (the numbers of the group a forest is narrowed to) }.
 * Every number is the model's (lib/change-synthesis.mjs), printed as the report prints it.
 */
export function changeListOf(m) {
  const figs = new Map(figureListOf(m).map(f => [f.code, f])), T = { primary: 'Sham SMCR', active: 'Active-arm SMCR', smd: 'Between-arm SMD', withdrawal: 'Randomized-withdrawal sham phases', responders: 'Sham responders', ...(m.plan.titles || {}) };
  const byTitle = m.subgroups.find(g => g.by === m.by)?.title || 'Group';
  const pool = (code, title, p, details, extra = {}) => figs.has(code) ? [{ code, title, kind: figs.get(code).kind, k: figs.get(code).k, scale: 'smcr', plot: plotOf(p), estimate: ciText(p), pi: piText(p),
    counts: counts(p), details: [...(p?.est == null ? [] : [['CR2 df', f1(p.df)], ['P value', pText(p.p)]]), ...details], groups: groupsOf(m, code), groupLabel: byTitle, ...extra }] : [];
  const P = m.primary.trial, r = m.active.ratio, rp = m.responders;
  // the numbers of one group a forest is narrowed to: its own pool, as the subtotal row draws it
  const lvl = p => [['Estimate (95% CI)', ciText(p)], ...(p?.pi_lo == null ? [] : [['Prediction interval', piText(p)]]), ['Data', counts(p)], ...(p?.est == null ? [] : [['CR2 df', f1(p.df)], ['P value', pText(p.p)]])];
  const levelsOf = (rows, poolFn) => Object.fromEntries([...new Set(rows.map(x => x[m.by]))].map(l => [l, lvl(poolFn(rows.filter(x => x[m.by] === l)))]));
  const smcr = [
    ...pool('SMCR', T.primary, P, [['Variance, trial', P.sigma2_trial?.toFixed(3) ?? 'NA'], ['Variance, outcome', P.sigma2_outcome?.toFixed(3) ?? 'NA'], ['Outcomes in trials in classes', ciText(m.primary.class)],
      ['Model-based 95% CI', `${f2(P.ci_lo_model)} to ${f2(P.ci_hi_model)}`]], { levels: Object.fromEntries(m.byLevel.map(l => [l.level, lvl(l.pool)])) }),
    ...pool('ACT', T.active, m.active.trial, r.ratio == null ? [] : [['Sham/active ratio', `${f2(r.ratio)} (Fieller ${f2(r.fieller_lo)} to ${f2(r.fieller_hi)}), ${r.k_trials} trials`],
      ['Active minus sham', `${f2(r.active_minus_sham)} (${f2(r.active_minus_sham_lo)} to ${f2(r.active_minus_sham_hi)})`]], { levels: levelsOf(m.active.rows.filter(x => x.yi != null), m.poolOf) }),
    ...pool('SMD', T.smd, m.smd.trial, [], { levels: levelsOf(m.smd.rows, m.poolOf) }),
    ...pool('RW', T.withdrawal, m.withdrawal, [], { groups: [] })];
  const resp = figs.has('RESP') ? [{ code: 'RESP', title: T.responders, kind: 'forest', k: figs.get('RESP').k, scale: 'pct', plot: rp.pool.est == null ? null : { est: rp.pool.est, lo: rp.pool.ci_lo, hi: rp.pool.ci_hi, pi_lo: rp.pool.pi_lo, pi_hi: rp.pool.pi_hi },
    estimate: rp.pool.est == null ? `not pooled; ${rp.pool.events} of ${rp.pool.participants}` : `${f1(rp.pool.est)}% (${f1(rp.pool.ci_lo)} to ${f1(rp.pool.ci_hi)})`, pi: rp.pool.est == null ? '' : `${f1(rp.pool.pi_lo)} to ${f1(rp.pool.pi_hi)}%`,
    counts: `${rp.pool.k_trials} trials, ${rp.pool.participants} participants`, groups: groupsOf(m, 'RESP'), groupLabel: byTitle,
    levels: Object.fromEntries(rp.byLevel.map(l => [l.level, l.pool.est == null ? [['Responders', `${l.pool.events} of ${l.pool.participants} responders in ${nOf(l.pool.k_trials, 'trial')}, not pooled (fewer than three trials)`]]
      : [['Responders (95% CI)', `${f1(l.pool.est)}% (${f1(l.pool.ci_lo)} to ${f1(l.pool.ci_hi)})`], ['Prediction interval', `${f1(l.pool.pi_lo)} to ${f1(l.pool.pi_hi)}%`], ['Data', `${nOf(l.pool.k_trials, 'trial')}, ${nOf(l.pool.participants, 'participant')}`]]])),
    details: [['Model', 'GLMM, logit'], ...(rp.withdrawalArms.length ? [['Randomized withdrawal, not pooled', rp.withdrawalArms.map(x => `${x.trial} ${x.responders_k}/${x.responders_n}`).join(', ')]] : [])] }] : [];
  const sens = m.sensitivity.filter(x => x.trial.est != null), est = sens.map(x => x.trial.est);
  const analyses = [
    ...(figs.has('SENS') ? [{ code: 'SENS', title: 'Sensitivity analyses', kind: 'forest', k: sens.length, scale: null, plot: null, estimate: `${f2(Math.min(...est))} to ${f2(Math.max(...est))}`, pi: '',
      counts: `${sens.length} analyses`, groups: [], details: [['CI excludes 0', `${sens.filter(x => x.trial.ci_lo > 0 || x.trial.ci_hi < 0).length} of ${sens.length}`]] }] : []),
    ...(figs.has('SUBGROUPS') ? [{ code: 'SUBGROUPS', title: 'Subgroups', kind: 'forest', k: figs.get('SUBGROUPS').k, scale: null, plot: null, estimate: '', pi: '',
      counts: `${figs.get('SUBGROUPS').k} levels pooled`, groups: m.subgroups.map(g => g.title), groupLabel: 'Subgroup',
      details: m.subgroups.map(g => [g.title, `${g.levels.filter(l => l.pool.est != null).length} of ${g.levels.length} levels pooled`]) }] : []),
    ...(figs.has('FUNNEL') ? [{ code: 'FUNNEL', title: 'Small-study effects', kind: 'funnel', k: figs.get('FUNNEL').k, scale: null, plot: null,
      estimate: m.egger[0] ? `Egger slope ${f2(m.egger[0].est)}, ${pText(m.egger[0].p)}` : '', pi: '', counts: `${P.k_trials} trials, ${P.k_outcomes} outcomes`, groups: [],
      details: m.egger.map(e => [e.test, `Slope ${f2(e.est)} (${f2(e.lo)} to ${f2(e.hi)}), CR2 ${pText(e.p)}, model-based ${pText(e.p_model)}`]) }] : [])];
  // the outcome scales (G3a, G3b): each scale's own pool, and a scale converted into its target's pool, a sensitivity analysis beside the
  // primary pool; listed with their numbers, without a figure of their own
  const scaleItem = (code, title, p, estimate, details) => ({ code, title, kind: 'pool', figure: false, k: p?.k_trials ?? 0, scale: 'smcr', plot: plotOf(p),
    estimate: p ? ciText(p) : estimate, pi: p ? piText(p) : '', counts: p ? counts(p) : '', groups: [], details });
  const scales = [
    ...(m.sameInstrument || []).map(x => scaleItem(`SCALE:${x.instrument}`, `${x.instrument} only`, x.pool, 'not pooled', [])),
    ...(m.converted || []).map(x => scaleItem(`CONV:${x.from}>${x.to}`, `${x.to} with ${x.from} converted`, x.pool,
      !x.crosswalk ? 'no crosswalk for the pair' : x.converted ? `not pooled (${nOf(x.trials, 'trial')})` : x.state.replace(/^./, c => c.toLowerCase()),
      [['Crosswalk', `${x.label || x.crosswalk || 'none'}: ${x.state}`], ['Converted', `${nOf(x.converted, 'arm')} of ${x.from}; ${x.to}'s own ${nOf(x.own, 'arm')}`],
        ...Object.entries(x.out || {}).map(([why, n]) => ['Not converted', `${nOf(n, 'arm')}: ${why}`])]))];
  return [{ group: 'Standardized mean change', items: smcr }, { group: 'Responders', items: resp }, { group: 'Analyses of the sham SMCR', items: analyses },
    { group: 'Outcome scales', items: scales }].filter(g => g.items.length);
}

// The statistics Make (views/summary-make.mjs) runs on the Data summary's numbers, in JavaScript, each the app's own: a pooled proportion
// (lib/meta-pool.mjs, metafor's REML), a two-arm contrast (lib/meta-contrast.mjs for RR and OR; lib/meta-general.mjs for RD, MD and SMD),
// a rate per 100 person-years (metafor's IRLN: log(events / person-time), 1/events, 0.5 added where a study has no event), a meta-regression
// on any number (lib/meta-general.mjs model with the number as the moderator), Bucher's indirect comparison (the difference of two log
// contrasts, its SE the root of their summed squares), a composite of counted measures under the review's overlap rule, the sensitivity
// checks (leave-one-out, Egger from MIN_K, lib/small-study.mjs) and the grading that says whether a synthesis makes sense. The grades are
// Make's own convention (owner, 2026-10-22: "it should tell me dynamically whether they make sense, with colours and a grading like bars").
// app/test/make-stats.test.mjs holds the numbers against metafor (bench: scratch oracle.R, metafor 4.8 on R 4.1). Pure.
import { poolProportion, escalcPLO } from './meta-pool.mjs';
import { poolContrast } from './meta-contrast.mjs';
import { poolGeneral, model } from './meta-general.mjs';
import { escalcRow } from './meta-escalc.mjs';
import { egger, MIN_K } from './small-study.mjs';
import { pnorm } from './nma.mjs';
import { plural } from './dates.mjs';

const Z975 = 1.959963984540054;
export const pct = v => (Number.isFinite(v) ? `${(100 * v).toFixed(1)}%` : '');
export const fmtP = p => (p == null || !Number.isFinite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const f1 = v => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '');

/**
 * Whether a synthesis makes sense here, criterion by criterion, each 0 to 3 (3 good): how many studies give it, how many of the group do,
 * how sparse its events are, how much the studies disagree (I² of the fit), how precise the estimate is, for a comparison whether each side
 * has studies of its own, and any further `checks` (leave-one-out, Egger, a regression's explanation). A red check (1 or less) caps the
 * verdict at "Possible, with care". Answers { rows: [{ label, value, score }], verdict, tone }.
 */
export function grade({ rows, kept, fit, sides = null, checks = [], ratio = false, events = true }) {
  const k = rows.length, zero = rows.filter(r => r.events === 0).length, out = [];
  const step = (v, cuts) => cuts.findIndex(c => v >= c) === -1 ? 0 : 3 - cuts.findIndex(c => v >= c);
  out.push({ label: 'Studies with data', value: plural(k, 'study', 'studies'), score: k >= 5 ? 3 : k >= 3 ? 2 : k === 2 ? 1 : 0 });
  out.push({ label: 'Reported in the group', value: `${k} of ${kept}`, score: step(kept ? k / kept : 0, [0.8, 0.5, 0.3]) });
  if (events) out.push({ label: 'Events', value: zero ? `${zero} with none` : 'Every study has some', score: k ? step(1 - zero / k, [0.8, 0.5, 0.2]) : 0 });
  if (fit) {
    out.push({ label: 'Agreement (I²)', value: `${Math.round(fit.i2 ?? 0)}%`, score: (fit.i2 ?? 0) < 25 ? 3 : (fit.i2 ?? 0) < 50 ? 2 : (fit.i2 ?? 0) < 75 ? 1 : 0 });
    // precision: a proportion's interval in absolute terms; a ratio's as the span of its log interval; a difference's against its estimate
    const w = ratio ? Math.log((fit.hi ?? 1) / (fit.lo ?? 1)) : (fit.hi ?? 0) - (fit.lo ?? 0);
    const cuts = ratio ? [0.5, 1, 1.75] : fit.kind === 'difference' ? [Math.abs(fit.estimate) * 0.5 || 0.1, Math.abs(fit.estimate) * 1 || 0.2, Math.abs(fit.estimate) * 2 || 0.35] : [0.1, 0.2, 0.35];
    out.push({ label: 'Precision', value: fit.text || `${pct(fit.lo)} to ${pct(fit.hi)}`, score: w < cuts[0] ? 3 : w < cuts[1] ? 2 : w < cuts[2] ? 1 : 0 });
  }
  if (sides) { const m = Math.min(...sides.map(s => s.k)); out.push({ label: 'Both sides', value: sides.map(s => `${s.label} ${s.k}`).join(', '), score: m >= 3 ? 3 : m === 2 ? 2 : m === 1 ? 1 : 0 }); }
  out.push(...checks);
  const blocked = out.some(r => ['Studies with data', 'Both sides'].includes(r.label) && r.score === 0);
  // a red check (a score of 1 or less) never stands under a green verdict: it caps the pool at "with care"
  const mean = out.reduce((a, r) => a + r.score, 0) / out.length, red = out.some(r => r.score <= 1);
  const good = mean >= 2.3 && !red, care = !good && mean >= 1.5;
  const verdict = blocked ? 'Not enough to pool' : good ? 'Makes sense' : care ? 'Possible, with care' : 'Weak';
  return { rows: out, verdict, tone: blocked ? 'bad' : good ? 'good' : care ? 'unclear' : 'bad' };
}

/** The common text of a pooled result: estimate (interval), I². */
export const estimateText = (fit, { ratio = false, percent = false, unit = '' } = {}) => {
  const f = v => (percent ? pct(v) : `${f1(v)}${unit ? ` ${unit}` : ''}`);
  return `${f(fit.estimate)} (${f(fit.lo)} to ${f(fit.hi)}), I² ${Math.round(fit.i2 ?? 0)}%`;
};

// ---- sensitivity checks ---------------------------------------------------------------------------------------------------------------

/**
 * The checks the app runs on a pool once there are studies enough: leave-one-out (five or more: `refit(rows)` fitted again without each
 * study, scored by how many of the refits leave the full interval) and Egger's test on the model scale (lib/small-study.mjs, from MIN_K
 * studies, scored by its p). `yi`, `vi` are the rows' effects on the model scale. Answers { checks: [{ label, value, score }], loo: { est,
 * lo, hi } | null (on the shown scale, `show(v)`), egger: { z, p } | null }.
 */
export function pooledChecks(rows, fit, { refit, yi, vi, show = v => v, text = v => pct(v) } = {}) {
  const checks = []; let loo = null, eg = null;
  if (fit && rows.length >= 5 && refit) {
    const refits = rows.map((_, i) => refit(rows.filter((__, j) => j !== i))).filter(Boolean);
    if (refits.length === rows.length) {
      const out = refits.filter(f => f.estimate < fit.lo || f.estimate > fit.hi).length, est = refits.map(f => f.estimate);
      checks.push({ label: 'Leave one out', value: `${text(Math.min(...est))} to ${text(Math.max(...est))}`, score: out === 0 ? 3 : out === 1 ? 2 : out <= 3 ? 1 : 0 });
      loo = { est: refits.map(f => show(f.estimate)), lo: refits.map(f => show(f.lo)), hi: refits.map(f => show(f.hi)) };
    }
  }
  if (fit && yi && rows.length >= MIN_K && yi.every(Number.isFinite)) {
    const e = egger(yi, vi);
    if (Number.isFinite(e.p)) { eg = { z: e.statistic, p: e.p }; checks.push({ label: 'Small-study effect (Egger)', value: `t ${f1(e.statistic)}, p ${fmtP(e.p)}`, score: e.p >= 0.1 ? 3 : e.p >= 0.05 ? 2 : 1 }); }
  }
  return { checks, loo, egger: eg };
}

/** The funnel plot's numbers: each study's effect and standard error on the model scale, the pooled line, and the 95% pseudo-interval at each SE. */
export function funnelData(yi, vi, mu) {
  const se = vi.map(Math.sqrt), seMax = Math.max(...se) * 1.05;
  return { points: yi.map((y, i) => ({ y, se: se[i] })), mu, seMax, left: [mu - Z975 * seMax, seMax], right: [mu + Z975 * seMax, seMax] };
}

// ---- proportions, rates, composites ---------------------------------------------------------------------------------------------------

/** A pooled proportion (lib/meta-pool.mjs) with its logits, for the checks; null under two studies. */
export function proportionFit(rows, opts = {}) {
  if (rows.length < 2) return null;
  const fit = poolProportion(rows, opts);
  if (!fit) return null;
  const es = rows.map(r => escalcPLO(r.events, r.n));
  return { ...fit, mu: fit.logit, mu_lb: fit.logit - Z975 * fit.logit_se, mu_ub: fit.logit + Z975 * fit.logit_se, yi: es.map(e => e.yi), vi: es.map(e => e.vi), kind: 'proportion' };
}

/**
 * Events per 100 person-years, pooled as metafor pools "IRLN": each study's log rate (0.5 added to a study with no event, add = 1/2,
 * to = "only0"), its variance 1 / events, fitted by REML (lib/meta-general.mjs model). `rows` [{ events, n, years }] (years of follow-up per
 * patient, n × follow-up = person-time). Answers { estimate, lo, hi (per 100 person-years), i2, tau2, k, yi, vi, study_est/lo/hi, weights }
 * or null under two studies.
 */
export function poolRate(rows, { method = 'REML' } = {}) {
  const ok = rows.filter(r => r.years > 0 && r.n > 0 && r.events >= 0);
  if (ok.length < 2) return null;
  const es = ok.map(r => { const x = r.events === 0 ? 0.5 : r.events, t = r.n * r.years; return { yi: Math.log(x / t), vi: 1 / x }; });
  const yi = es.map(e => e.yi), vi = es.map(e => e.vi), m = model(yi, vi, { method });
  if (!m) return null;
  const tf = v => 100 * Math.exp(v), sw = m.weights;
  return { estimate: tf(m.beta[0]), lo: tf(m.ci_lb[0]), hi: tf(m.ci_ub[0]), mu: m.beta[0], mu_lb: m.ci_lb[0], mu_ub: m.ci_ub[0], i2: m.I2, tau2: m.tau2, q: m.QE, qp: m.QEp, k: yi.length, yi, vi,
    study_est: yi.map(tf), study_lo: yi.map((y, i) => tf(y - Z975 * Math.sqrt(vi[i]))), study_hi: yi.map((y, i) => tf(y + Z975 * Math.sqrt(vi[i]))), weights: sw, rows: ok, kind: 'rate', engine: 'js' };
}

/**
 * A composite of counted measures per study under the review's overlap rule (the ASD review's AGENTS.md: "overlap not stated → summed
 * (capped at n); sensitivity with the largest single event type"): `parts` [[{ events, n } | null] per study, one entry per measure];
 * `rule` 'sum' (added up, never above n) or 'max' (the largest part, each patient once). A study with no part counted is left out; `n` is the
 * largest total its parts give. Answers [{ events, n, parts: [events | null], partial }].
 */
export function compositeRows(parts, rule = 'sum') {
  return parts.map(list => {
    const got = list.filter(Boolean);
    if (!got.length) return null;
    const n = Math.max(...got.map(p => p.n)), ev = got.map(p => p.events);
    const events = rule === 'max' ? Math.max(...ev) : Math.min(ev.reduce((a, b) => a + b, 0), n);
    return { events, n, parts: list.map(p => (p ? p.events : null)), partial: got.length < list.length };
  });
}

// ---- contrasts ------------------------------------------------------------------------------------------------------------------------------

export const CONTRAST_MEASURES = [['RR', 'Risk ratio'], ['OR', 'Odds ratio'], ['RD', 'Risk difference'], ['MD', 'Mean difference'], ['SMD', 'Standardized mean difference']];
export const isRatioMeasure = m => m === 'RR' || m === 'OR';
/**
 * Two arms pooled: `values` rows in metafor's order ([events, n, events, n] for RR, OR and RD; [mean, sd, n, mean, sd, n] for MD and SMD).
 * RR and OR by lib/meta-contrast.mjs (checked against metafor to 1e-9), the rest by lib/meta-general.mjs. Answers R's shape with yi, vi
 * (null under two studies or when a fit fails); `kind` 'ratio' or 'difference'.
 */
export function contrastFit(values, measure = 'RR', { method = 'REML' } = {}) {
  if (values.length < 2) return null;
  const fit = isRatioMeasure(measure) ? poolContrast(values, { measure, method }) : poolGeneral({ measure, method, values });
  return fit ? { ...fit, kind: isRatioMeasure(measure) ? 'ratio' : 'difference', measure } : null;
}
/** A study's contrast row from two arms' counts: [events a, n a, events b, n b]; null unless both arms are counted. */
export const contrastRow = (a, b) => (a && b ? [a.events, a.n, b.events, b.n] : null);

/**
 * Bucher's indirect comparison of A against B through their common comparator C: the two direct contrasts' log estimates subtracted, the
 * SE the root of their summed squares. `d1` is A vs C and `d2` B vs C, each { estimate, lo, hi } on the ratio scale (or a difference with
 * `ratio: false`). With a `direct` A vs B, the inconsistency: the difference of the direct and indirect logs with its z and p.
 */
export function bucher(d1, d2, { ratio = true, direct = null } = {}) {
  const L = v => (ratio ? Math.log(v) : v), U = v => (ratio ? Math.exp(v) : v);
  const seOf = d => (L(d.hi) - L(d.lo)) / (2 * Z975);
  const diff = L(d1.estimate) - L(d2.estimate), se = Math.sqrt(seOf(d1) ** 2 + seOf(d2) ** 2), z = diff / se, p = 2 * pnorm(-Math.abs(z));
  const out = { estimate: U(diff), lo: U(diff - Z975 * se), hi: U(diff + Z975 * se), se, z, p, kind: ratio ? 'ratio' : 'difference' };
  if (direct) { const dd = L(direct.estimate) - diff, dse = Math.sqrt(seOf(direct) ** 2 + se * se), dz = dd / dse; out.inconsistency = { diff: U(dd), lo: U(dd - Z975 * dse), hi: U(dd + Z975 * dse), z: dz, p: 2 * pnorm(-Math.abs(dz)) }; }
  return out;
}

// ---- meta-regression --------------------------------------------------------------------------------------------------------------------------

/**
 * A meta-regression of the rows' effects (`yi`, `vi` on the model scale) on a number `x` per study: metafor's rma(yi, vi, mods = ~ x, method
 * = "REML") through lib/meta-general.mjs model. Answers { slope, lo, hi, p, intercept, r2, qm, qmp, k, line(x) } or null (under three
 * studies, or a fit that fails). `r2` as metafor's for a random-effects model: the share of τ² the moderator explains, 0 when the model
 * without it has none.
 */
export function regress(yi, vi, x, { method = 'REML' } = {}) {
  const k = yi.length;
  if (k < 3 || x.length !== k || x.some(v => !Number.isFinite(v))) return null;
  const m0 = model(yi, vi, { method }), m = model(yi, vi, { method, X: x.map(v => [1, v]) });
  if (!m0 || !m) return null;
  const r2 = !(m0.tau2 > 0) ? 0 : Math.max(0, 100 * (m0.tau2 - m.tau2) / m0.tau2);
  const [b0, b1] = m.beta, cov = m.vb;
  return { slope: b1, lo: m.ci_lb[1], hi: m.ci_ub[1], se: m.se[1], p: m.pval[1], intercept: b0, r2, qm: m.QM, qmp: m.QMp, k, tau2: m.tau2,
    line: v => b0 + b1 * v, band: v => { const s = Math.sqrt(Math.max(0, cov[0][0] + 2 * v * cov[0][1] + v * v * cov[1][1])); return [b0 + b1 * v - Z975 * s, b0 + b1 * v + Z975 * s]; }, weights: m.weights };
}

// Diagnostics of a saved pooled result, computed in JavaScript from the effects it kept (`yi`, `vi`, `mu`,
// its interval, `tau2`, its own counts): the confidence-interval outlier rule, and the pieces the drawn
// figures need. Studentized residuals, Cook's distance, DFBETAS and leave-one-out come from metafor's
// influence() and leave1out() in the run itself (lib/sensitivity.mjs).
//
// The outlier rule (Harrer et al. 2021, Doing Meta-Analysis with R, 5.1): a study is an outlier when
// its 95% confidence interval lies wholly outside the 95% confidence interval of the pooled effect. It is a
// screen for a study worth looking at, not a reason to remove one.

import { escalcPLO } from './meta-pool.mjs';

const Z = 1.959963984540054;

/** The studies' own 95% intervals and whether each lies wholly outside the pooled interval [lo, hi] (analysis scale). */
export function outlierRule({ yi, vi, lo, hi }) {
  return yi.map((y, i) => { const se = Math.sqrt(vi[i]), a = y - Z * se, b = y + Z * se; return { lo: a, hi: b, outlier: b < lo || a > hi }; });
}

const vec = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
/** The saved arrays as plain numbers; null for a result run before they were kept, which needs a new Run. */
export function diagnosticInputs(a) {
  const yi = vec(a?.yi).map(Number), vi = vec(a?.vi).map(Number);
  if (!yi.length || yi.length !== vi.length || yi.some(x => !Number.isFinite(x)) || vi.some(x => !(x > 0))) return null;
  // The plots draw the pooled line on the analysis scale: a result without it (yi and vi saved, mu not) has nothing to draw against.
  const mu = Number(a.mu), lo = Number(a.mu_lb), hi = Number(a.mu_ub);
  if (![mu, lo, hi].every(Number.isFinite)) return null;
  return { yi, vi, mu, lo, hi, tau2: Number(a.tau2) || 0, labels: vec(a.labels).map(String) };
}

/**
 * What a funnel plot of the result is drawn from on screen (lib/charts.mjs funnelChart): the kept effects (`yi`, `vi`, `mu`), or for a
 * pooled proportion on the logit scale its arms' counts (`xi`, `ni`, escalc PLO with 0.5 added to an arm of 0 or all events) and the pooled
 * logit; `back` puts an analysis-scale value on the reported scale. Null when the result kept neither (a Freeman–Tukey pool: its R figure).
 */
export function funnelInputs(a, back = x => x) {
  const d = diagnosticInputs(a);
  if (d) return { yi: d.yi, vi: d.vi, mu: d.mu, labels: d.labels, back, percent: false };
  const xi = vec(a?.xi).map(Number), ni = vec(a?.ni).map(Number), mu = Number(a?.logit);
  if (!a?.derived || a.measure === 'PFT' || !xi.length || xi.length !== ni.length || !Number.isFinite(mu) || xi.some((x, i) => !(ni[i] > 0) || !(x >= 0) || x > ni[i])) return null;
  const es = xi.map((x, i) => escalcPLO(x, ni[i]));
  if (es.some(e => !e || !Number.isFinite(e.yi) || !(e.vi > 0))) return null;
  return { yi: es.map(e => e.yi), vi: es.map(e => e.vi), mu, labels: vec(a.labels).map(String), back: x => 100 / (1 + Math.exp(-x)), percent: true };
}

/** Binary counts per study, [events treated, n treated, events control, n control], from a result's saved rows. */
export function countRows(a) {
  const v = vec(a?.values).map(r => vec(r).map(Number));
  return v.length && v.every(r => r.length === 4 && r.every(Number.isFinite)) ? v : null;
}

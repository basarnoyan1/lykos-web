// Tests for small-study effects (funnel plot asymmetry), in plain JavaScript from the published
// formulas. They are sensitivity analyses: a significant result is a reason to look at the
// studies, not evidence of publication bias, and nothing here changes the pooled estimate
// (plan §I5: no automatic correction). Not run below 10 studies (Sterne et al. 2011).
//
//   Egger        weighted regression of the effect on its standard error (Egger et al. 1997); the
//                slope is the asymmetry. Weights 1/variance; t test on k − 2 df.
//   Begg         rank correlation (Kendall's S) between the standardised effects and their
//                variances (Begg and Mazumdar 1994); normal approximation, ties corrected.
//   Harbord      binary data: regression of Z/√V on √V, Z the efficient score of the log odds
//                ratio and V its variance, from the uncorrected counts (Harbord et al. 2006);
//                the intercept is the asymmetry. Ordinary least squares, t test on k − 2 df.
//   Peters       binary data: regression of the log odds ratio on the inverse of the total
//                sample size, weights 1/(1/events + 1/non-events) (Peters et al. 2006); t test on
//                the slope, k − 2 df.
//   Rücker       binary data: the arcsine difference of the risks, √(p₁) − √(p₂) on the arcsine
//                scale, with variance 1/(4n₁) + 1/(4n₂), tested like Egger (Rücker et al. 2008).
// Checked against meta::metabias in native R (bench/bias).
import { pt, pnorm } from './dist.mjs';

export const MIN_K = 10;

/** Weighted least squares of y on x with the residual variance estimated: intercept and slope with t tests on n − 2 df. */
export function wls(x, y, w = null) {
  const n = x.length, W = w || x.map(() => 1);
  const sw = W.reduce((s, v) => s + v, 0);
  const mx = W.reduce((s, v, i) => s + v * x[i], 0) / sw, my = W.reduce((s, v, i) => s + v * y[i], 0) / sw;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += W[i] * (x[i] - mx) ** 2; sxy += W[i] * (x[i] - mx) * (y[i] - my); }
  const b1 = sxy / sxx, b0 = my - b1 * mx, df = n - 2;
  let rss = 0; for (let i = 0; i < n; i++) rss += W[i] * (y[i] - b0 - b1 * x[i]) ** 2;
  const s2 = rss / df, se1 = Math.sqrt(s2 / sxx), se0 = Math.sqrt(s2 * (1 / sw + mx * mx / sxx));
  const p = t => 2 * (1 - pt(Math.abs(t), df));
  return { b0, b1, se0, se1, t0: b0 / se0, t1: b1 / se1, p0: p(b0 / se0), p1: p(b1 / se1), df, cov01: -s2 * mx / sxx };
}

const result = (name, fit, which, extra = {}) => {
  const b = which === 0 ? fit.b0 : fit.b1, se = which === 0 ? fit.se0 : fit.se1, t = b / se;
  return { name, statistic: t, df: fit.df, p: 2 * (1 - pt(Math.abs(t), fit.df)), bias: b, se, ...extra };
};

/** Egger's regression test on effects `yi` with variances `vi`. */
export function egger(yi, vi) {
  const se = vi.map(Math.sqrt);
  return result('Egger', wls(se, yi, vi.map(v => 1 / v)), 1);
}

/** Harbord's score test; `rows` are [events treated, n treated, events control, n control]. */
export function harbord(rows) {
  const x = [], y = [];
  for (const [a, n1, c, n2] of rows) {
    const N = n1 + n2, m1 = a + c, m2 = N - m1, Z = a - n1 * m1 / N, V = n1 * n2 * m1 * m2 / (N * N * (N - 1));
    x.push(Math.sqrt(V)); y.push(Z / Math.sqrt(V));
  }
  return result('Harbord', wls(x, y), 0);
}

/** Peters' test; `yi` are the log odds ratios (with the model's continuity correction), `rows` the counts. */
export function peters(yi, rows) {
  const x = [], w = [];
  for (const [a, n1, c, n2] of rows) { const N = n1 + n2, ev = a + c; x.push(1 / N); w.push(1 / (1 / ev + 1 / (N - ev))); }
  return result('Peters', wls(x, yi, w), 1);
}

/** Rücker's arcsine test. */
export function rucker(rows) {
  const yi = rows.map(([a, n1, c, n2]) => Math.asin(Math.sqrt(a / n1)) - Math.asin(Math.sqrt(c / n2)));
  const vi = rows.map(([, n1, , n2]) => 1 / (4 * n1) + 1 / (4 * n2));
  return { ...egger(yi, vi), name: 'Rücker (arcsine)' };
}

/** Begg's rank correlation test: Kendall's S with the tie-corrected variance, normal approximation. */
export function begg(yi, vi) {
  const k = yi.length, w = vi.map(v => 1 / v), sw = w.reduce((s, v) => s + v, 0), mu = w.reduce((s, v, i) => s + v * yi[i], 0) / sw;
  const ts = yi.map((y, i) => (y - mu) / Math.sqrt(vi[i] - 1 / sw));
  let S = 0;
  for (let i = 0; i < k - 1; i++) for (let j = i + 1; j < k; j++) S += Math.sign(ts[i] - ts[j]) * Math.sign(vi[i] - vi[j]);
  const ties = a => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return [...m.values()].filter(t => t > 1); };
  const t = ties(ts), u = ties(vi), f = (a, g) => a.reduce((s, x) => s + g(x), 0);
  const v0 = k * (k - 1) * (2 * k + 5), vt = f(t, x => x * (x - 1) * (2 * x + 5)), vu = f(u, x => x * (x - 1) * (2 * x + 5));
  const variance = (v0 - vt - vu) / 18 + f(t, x => x * (x - 1) * (x - 2)) * f(u, x => x * (x - 1) * (x - 2)) / (9 * k * (k - 1) * (k - 2)) + f(t, x => x * (x - 1)) * f(u, x => x * (x - 1)) / (2 * k * (k - 1));
  const z = S / Math.sqrt(variance);
  return { name: 'Begg', statistic: z, df: null, p: 2 * (1 - pnorm(Math.abs(z))), bias: null, se: null, S, sdS: Math.sqrt(variance), tau: S / (k * (k - 1) / 2) };
}

/**
 * The tests that apply to a set of studies. `yi`, `vi` are the effect sizes and variances of the pooled
 * model; `rows` the binary counts (treated events, treated n, control events, control n) when the
 * measure is a binary one; `measure` the effect measure id. Returns `{ k, gated, tests }`; below
 * MIN_K studies nothing is computed.
 */
export function smallStudyTests({ yi, vi, rows = null, measure }) {
  const k = yi.length;
  if (k < MIN_K) return { k, gated: true, tests: [] };
  const tests = [egger(yi, vi), begg(yi, vi)];
  if (rows && measure === 'OR') tests.push(harbord(rows), peters(yi, rows));
  if (rows) tests.push(rucker(rows));
  return { k, gated: false, tests };
}

// A comparison of two arms pooled in JavaScript, as metafor pools it (escalc, then rma.uni with method "REML" or "EE" and Wald intervals):
// the forest plots of Tables and figures drawn at once, no R to start (owner, 2026-10-18: "the fastest and accurate solution possible").
// It follows metafor 4/5 step by step: escalc's 0.5 added to all four cells of a study with a zero cell (add = 1/2, to = "only0"); REML by
// metafor's Fisher scoring from the Hedges starting value, step-halved at zero, stopped when τ² moves less than 1e-5 (control threshold); I² from
// the typical within-study variance; Q with the inverse-variance weights. app/test/meta-contrast.test.mjs checks every quantity against
// metafor's on the Spine review's comparisons (bench/comparative/app-results.json) to 1e-9 relative. Anything else (other measures or
// estimators, Hartung–Knapp, subgroups, Egger, leave-one-out) is R's (lib/contrast-r.mjs). Pure.
import { pchisqUpper } from './describe.mjs';

const Z975 = 1.959963984540054;   // qnorm(0.975)
export const handles = ({ measure = 'RR', method = 'REML', test = 'z', subgroups = false } = {}) =>
  ['RR', 'OR'].includes(measure) && method === 'REML' && (test === 'z' || !test) && !subgroups;   // REML: what app/test/meta-contrast.test.mjs checks

/** escalc for a 2×2 table [events, total, events, total] (treated first): `{ yi, vi }` on the log scale. */
export function escalc(measure, [a0, n1, c0, n2]) {
  let a = a0, b = n1 - a0, c = c0, d = n2 - c0;
  if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
  if (measure === 'OR') return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
  return { yi: Math.log(a / (a + b)) - Math.log(c / (c + d)), vi: 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d) };
}

/** metafor's REML τ² for an intercept-only model: Fisher scoring from the Hedges value, halved at zero, stopped at a change under 1e-5. */
function remlTau2(yi, vi) {
  const k = yi.length, mean = yi.reduce((s, y) => s + y, 0) / k;
  const varY = yi.reduce((s, y) => s + (y - mean) ** 2, 0) / (k - 1), meanV = vi.reduce((s, v) => s + v, 0) / k;
  let tau2 = Math.max(0, varY - meanV), change = 1, iter = 0;
  while (change > 1e-5) {
    if (++iter > 100) throw new Error('REML did not converge');
    const w = vi.map(v => 1 / (v + tau2)), sw = w.reduce((s, x) => s + x, 0);
    // P = W − w wᵀ / Σw; adj = (yᵀ P P y − tr P) / Σ P²
    const Py = yi.map((y, i) => w[i] * y - w[i] * w.reduce((s, wj, j) => s + wj * yi[j], 0) / sw);
    const PPy = Py.map((_, i) => w[i] * Py[i] - w[i] * w.reduce((s, wj, j) => s + wj * Py[j], 0) / sw);
    const yPPy = yi.reduce((s, y, i) => s + y * PPy[i], 0);
    const trP = w.reduce((s, wi) => s + wi - wi * wi / sw, 0);
    let sumP2 = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const p = (i === j ? w[i] : 0) - w[i] * w[j] / sw; sumP2 += p * p; }
    let adj = (yPPy - trP) / sumP2;
    while (tau2 + adj < 0) adj /= 2;
    const old = tau2; tau2 += adj; change = Math.abs(old - tau2);
  }
  return Math.max(0, tau2);
}

/**
 * The pooled comparison of `rows` ([events, total, events, total] each, none with no events in both arms for a ratio), in the shape R's
 * result has (lib/contrast-r.mjs): estimate, lo, hi, pi_lo, pi_hi, i2, tau2, q, qp, k, zval, pval, mu, yi, vi, study_est/lo/hi, weights (%).
 */
export function poolContrast(rows, { measure = 'RR', method = 'REML' } = {}) {
  const es = rows.map(v => escalc(measure, v)), yi = es.map(e => e.yi), vi = es.map(e => e.vi), k = yi.length;
  const tau2 = method === 'EE' || k < 2 ? 0 : remlTau2(yi, vi);
  const w = vi.map(v => 1 / (v + tau2)), sw = w.reduce((s, x) => s + x, 0);
  const mu = w.reduce((s, wi, i) => s + wi * yi[i], 0) / sw, se = Math.sqrt(1 / sw), zval = mu / se;
  const w0 = vi.map(v => 1 / v), sw0 = w0.reduce((s, x) => s + x, 0), mu0 = w0.reduce((s, wi, i) => s + wi * yi[i], 0) / sw0;
  const q = w0.reduce((s, wi, i) => s + wi * (yi[i] - mu0) ** 2, 0);
  const vt = (k - 1) * sw0 / (sw0 ** 2 - w0.reduce((s, x) => s + x * x, 0));
  const i2 = method === 'EE' ? Math.max(0, 100 * (q - (k - 1)) / q) : 100 * tau2 / (vt + tau2);
  const piSe = Math.sqrt(se * se + tau2);
  return { estimate: Math.exp(mu), lo: Math.exp(mu - Z975 * se), hi: Math.exp(mu + Z975 * se),
    pi_lo: method === 'EE' ? null : Math.exp(mu - Z975 * piSe), pi_hi: method === 'EE' ? null : Math.exp(mu + Z975 * piSe),
    i2, tau2, q, qp: k > 1 ? pchisqUpper(q, k - 1) : 1, k, zval, pval: pchisqUpper(zval * zval, 1), mu, mu_lb: mu - Z975 * se, mu_ub: mu + Z975 * se, yi, vi,
    study_est: yi.map(Math.exp), study_lo: yi.map((y, i) => Math.exp(y - Z975 * Math.sqrt(vi[i]))), study_hi: yi.map((y, i) => Math.exp(y + Z975 * Math.sqrt(vi[i]))),
    weights: w.map(x => 100 * x / sw), engine: 'js' };
}

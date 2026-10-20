// The general pooled analysis in JavaScript (owner, 2026-10-18: "also do subgroups and the other measures"): what the Analysis view's R
// (views/analysis.mjs) and a comparison's R (lib/contrast-r.mjs) fit, for every measure escalc gives in JavaScript (lib/meta-escalc.mjs),
// REML, DerSimonian–Laird or common effect (lib/meta-pool.mjs fitRma, checked against metafor to 5.9e-12), with a z or Hartung–Knapp
// interval, and subgroups (each level's own fit and the test of subgroup differences, QM of mods = ~ g) or a numeric moderator (its slope,
// QM and R²). The result has the fields of R's list, so the view keeps it at once and R's result takes its place behind it.
// app/test/meta-general.test.mjs checks it against native metafor (bench/measures/general-oracle.json). Pure.
import { escalcRow, backOf } from './meta-escalc.mjs';
import { fitRma } from './meta-pool.mjs';
import { measureOf } from './effect-measures.mjs';

const Z975 = 1.959963984540054;

// ---- t and F, on a log-gamma good to 1e-15 ----------------------------------------------------------------------------------------
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = LG[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
  const tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
  for (let m = 1; m <= 3000; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a, b). */
function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
/** Two-sided p of t on df degrees of freedom. */
export const pt2 = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);
/** The 0.975 quantile of t on df (bisection on pt2 to the last bit). */
export function qt975(df) {
  let lo = 0, hi = 2; while (pt2(hi, df) > 0.05) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (pt2(m, df) > 0.05) lo = m; else hi = m; if (hi - lo < 1e-15 * hi) break; }
  return (lo + hi) / 2;
}
/** Upper tail of F(d1, d2). */
export const pfUpper = (f, d1, d2) => (f <= 0 ? 1 : ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));

// ---- small linear algebra -----------------------------------------------------------------------------------------------------
function inverse(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...M.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-300) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
}
const quad = (b, M) => b.reduce((s, bi, i) => s + bi * M[i].reduce((t, mij, j) => t + mij * b[j], 0), 0);

/**
 * A model as R reports it after rma(yi, vi, mods, method, test): metafor's own fit (fitRma), with Hartung–Knapp's scaled covariance, t on
 * k − p df and an F test for the moderators when `test` is "knha". A model of one study is metafor's: τ² 0, its own estimate. Null where
 * fitRma is (no convergence, a singular design).
 */
export function model(yi, vi, { method, test = 'z', X = null }) {
  const k = yi.length;
  if (k === 1) {   // metafor fits one study with τ² = 0 (no heterogeneity to estimate)
    const se = Math.sqrt(vi[0]), z = yi[0] / se;
    return { beta: [yi[0]], se: [se], ci_lb: [yi[0] - Z975 * se], ci_ub: [yi[0] + Z975 * se], zval: [z], pval: [NaN], tau2: 0, QE: 0, QEp: 1, I2: 0, H2: 1, k, p: 1,
      QM: z * z, QMp: NaN, QMdf: 1, weights: [100], df: null };
  }
  const r = fitRma(yi, vi, { method, X });
  if (!r) return null;
  if (test !== 'knha') return { ...r, df: null };
  const D = X || yi.map(() => [1]), w = vi.map(v => 1 / (v + r.tau2)), p = r.p, df = k - p;
  const s2 = yi.reduce((s, y, i) => s + w[i] * (y - D[i].reduce((t, x, j) => t + x * r.beta[j], 0)) ** 2, 0) / df;
  const vb = r.vb.map(row => row.map(x => x * s2)), se = vb.map((row, i) => Math.sqrt(row[i])), crit = qt975(df);
  const zval = r.beta.map((b, i) => b / se[i]);
  const btt = p > 1 ? r.beta.map((_, i) => i).slice(1) : [0], sub = inverse(btt.map(i => btt.map(j => vb[i][j])));
  const QM = sub ? quad(btt.map(i => r.beta[i]), sub) / btt.length : NaN;
  return { ...r, vb, se, zval, pval: zval.map(t => pt2(t, df)), ci_lb: r.beta.map((b, i) => b - crit * se[i]), ci_ub: r.beta.map((b, i) => b + crit * se[i]),
    QM, QMp: pfUpper(QM, btt.length, df), QMdf: btt.length, df, crit };
}

/** Whether the JavaScript gives metafor's result for these settings: REML, DL or EE; z or Hartung–Knapp; any measure but PFT. */
export const handlesGeneral = ({ measure, method, test = 'z', pi = 'follow' }) =>
  ['REML', 'DL', 'EE'].includes(method) && ['z', 'knha'].includes(test) && ['follow', 't'].includes(pi) && measure !== 'PFT' && !!measureOf(measure);

/**
 * The pooled result of `values` (rows in the measure's input order) as R's list gives it: estimate, lo, hi, pi_lo, pi_hi, pi_df, i2, tau2,
 * q, qp, k, zval, pval, mu, mu_lb, mu_ub, yi, vi, study_est/lo/hi, weights, and with `mod` its fields: a group moderator
 * ({ kind: 'group', values, levels?, unassigned? }: `levels` the order, rows with no level out of the test) gives mod_kind, mod_levels,
 * mod_k, mod_est, mod_lo, mod_hi, mod_i2, mod_tau2, qm, qmp, qm_df (and mod_unassigned when `unassigned`); a numeric one gives slope,
 * slope_lo, slope_hi, slope_p, qm, qmp, r2. Null when a fit does not converge (R's result is then the only one).
 */
export function poolGeneral({ measure, method, test = 'z', pi = 'follow', values, mod = null }) {
  const es = values.map(v => escalcRow(measure, v));
  if (es.some(e => !e || !Number.isFinite(e.yi) || !(e.vi > 0))) return null;
  const yi = es.map(e => e.yi), vi = es.map(e => e.vi), tf = backOf(measure);
  const r = model(yi, vi, { method, test });
  if (!r) return null;
  const k = yi.length, ee = method === 'EE', mu = r.beta[0], se = r.se[0];
  // the prediction interval: R's predict() (z, or t on k − 1 df under Hartung–Knapp), or "t" (t on k − 1 df whatever the test)
  const piCrit = pi === 't' ? (k >= 3 ? qt975(k - 1) : null) : test === 'knha' ? r.crit : Z975, piSe = Math.sqrt(se * se + r.tau2);
  const out = { estimate: tf(mu), lo: tf(r.ci_lb[0]), hi: tf(r.ci_ub[0]),
    pi_lo: ee || piCrit == null ? null : tf(mu - piCrit * piSe), pi_hi: ee || piCrit == null ? null : tf(mu + piCrit * piSe), pi_df: pi === 't' && k >= 3 ? k - 1 : null,
    i2: r.I2, tau2: r.tau2, q: r.QE, qp: r.QEp, k, zval: r.zval[0], pval: r.pval[0], mu, mu_lb: r.ci_lb[0], mu_ub: r.ci_ub[0], yi, vi,
    study_est: yi.map(tf), study_lo: yi.map((y, i) => tf(y - Z975 * Math.sqrt(vi[i]))), study_hi: yi.map((y, i) => tf(y + Z975 * Math.sqrt(vi[i]))),
    weights: r.weights, engine: 'js' };
  if (!mod) return out;
  if (mod.kind === 'group') {
    const lv = mod.levels || [...new Set(mod.values.map(String))].sort();
    if (lv.length < 2) return out;
    const has = mod.values.map(v => v != null && lv.includes(String(v)));
    const idx = yi.map((_, i) => i).filter(i => has[i]);
    const X = idx.map(i => [1, ...lv.slice(1).map(l => (String(mod.values[i]) === l ? 1 : 0))]);
    const rg = model(idx.map(i => yi[i]), idx.map(i => vi[i]), { method, test, X });
    if (!rg) return null;
    const subs = lv.map(l => { const s = yi.map((_, i) => i).filter(i => has[i] && String(mod.values[i]) === l); return [s.length, model(s.map(i => yi[i]), s.map(i => vi[i]), { method, test })]; });
    if (subs.some(([, m]) => !m)) return null;
    return { ...out, mod_kind: 'group', mod_levels: lv, mod_k: subs.map(([n]) => n), mod_est: subs.map(([, m]) => tf(m.beta[0])),
      mod_lo: subs.map(([, m]) => tf(m.ci_lb[0])), mod_hi: subs.map(([, m]) => tf(m.ci_ub[0])), mod_i2: subs.map(([, m]) => m.I2), mod_tau2: subs.map(([, m]) => m.tau2),
      qm: rg.QM, qmp: rg.QMp, qm_df: rg.QMdf, ...(mod.unassigned ? { mod_unassigned: has.filter(h => !h).length } : {}) };
  }
  const x = mod.values.map(Number);
  if (x.some(v => !Number.isFinite(v))) return null;
  const rg = model(yi, vi, { method, test, X: x.map(v => [1, v]) });
  if (!rg) return null;
  const ratio = measureOf(measure).ratio, t = ratio ? Math.exp : v => v;
  // metafor's R²: a common-effect model's is the adjusted R² of the weighted regression (lm(yi ~ X, weights = 1/vi)), 1 − QE/QE₀ · (k − 1)/(k − p);
  // a random-effects model's the share of τ² the moderator explains, 0 when the model without it has no τ²
  const r2 = ee ? (yi.every(y => y === yi[0]) ? 0 : Math.max(0, 100 * (1 - (rg.QE / r.QE) * (k - 1) / (k - rg.p))))
    : !(r.tau2 > 0) ? 0 : Math.max(0, 100 * (r.tau2 - rg.tau2) / r.tau2);
  return { ...out, mod_kind: 'numeric', slope: t(rg.beta[1]), slope_lo: t(rg.ci_lb[1]), slope_hi: t(rg.ci_ub[1]), slope_p: rg.pval[1], qm: rg.QM, qmp: rg.QMp, r2 };
}

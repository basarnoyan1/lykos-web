// The statistics of the synthesis explorer (lib/synth.mjs), in plain JavaScript so every combination of a review can be judged at once, without
// a call to R per combination: a risk ratio per study, REML random effects, the Freeman–Tukey double arcsine proportion and its back-transformation,
// the sign test and the test for subgroup differences. A port of the review's own engine (`Evidence table/tools/forest/stats.py`), which
// agrees with metafor to 1e-8 for REML; app/test/synth.test.mjs reproduces the review's recorded results from it. Pure.
import { pchisq, pnorm } from './dist.mjs';

/** Two-sided P of a standard normal z. */
export const pz = z => 2 * (1 - pnorm(Math.abs(z)));
export const chi2Sf = (x, df) => (df <= 0 ? NaN : x <= 0 ? 1 : 1 - pchisq(x, df));

/** Random-effects pooling by REML: { mu, se, tau2, Q, df, I2, k } from effects `y` and variances `v`. */
export function reml(y, v) {
  const k = y.length;
  if (k === 1) return { mu: y[0], se: Math.sqrt(v[0]), tau2: 0, Q: 0, df: 0, I2: 0, k: 1 };
  const w0 = v.map(x => 1 / x), s0 = sum(w0), mu0 = sum(w0.map((w, i) => w * y[i])) / s0;
  const Q = sum(w0.map((w, i) => w * (y[i] - mu0) ** 2));
  let t2 = Math.max(0, (Q - (k - 1)) / (s0 - sum(w0.map(w => w * w)) / s0));
  for (let it = 0; it < 2000; it++) {
    const w = v.map(x => 1 / (x + t2)), sw = sum(w), mu = sum(w.map((wi, i) => wi * y[i])) / sw;
    const next = Math.max(0, sum(w.map((wi, i) => wi * wi * ((y[i] - mu) ** 2 - v[i]))) / sum(w.map(wi => wi * wi)) + 1 / sw);
    if (Math.abs(next - t2) < 1e-12) { t2 = next; break; }
    t2 = next;
  }
  const w = v.map(x => 1 / (x + t2)), sw = sum(w), mu = sum(w.map((wi, i) => wi * y[i])) / sw;
  return { mu, se: Math.sqrt(1 / sw), tau2: t2, Q, df: k - 1, I2: Q > 0 ? Math.max(0, (Q - (k - 1)) / Q) * 100 : 0, k };
}
const sum = a => a.reduce((s, x) => s + x, 0);

/** log risk ratio and its variance for one study, 0.5 added to every cell when one is zero; null when neither arm has an event (not estimable). */
export function rrStudy(e1, n1, e2, n2) {
  if (e1 === 0 && e2 === 0) return null;
  let a = e1, b = n1 - e1, c = e2, d = n2 - e2;
  if (!a || !b || !c || !d) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
  return [Math.log((a / (a + b)) / (c / (c + d))), 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d)];
}

/** The pooled risk ratio of studies' counts { e1, n1, e2, n2 }: { rr, lo, hi, I2, k, p } or null below two estimable studies. */
export function poolRr(rows) {
  const est = rows.map(r => rrStudy(r.e1, r.n1, r.e2, r.n2)).filter(Boolean);
  if (est.length < 2) return null;
  const r = reml(est.map(e => e[0]), est.map(e => e[1]));
  return { rr: Math.exp(r.mu), lo: Math.exp(r.mu - 1.96 * r.se), hi: Math.exp(r.mu + 1.96 * r.se), I2: r.I2, k: r.k, p: pz(r.mu / r.se),
    mu: r.mu, se: r.se, tau2: r.tau2, Q: r.Q, df: r.df, pQ: chi2Sf(r.Q, r.df) };
}

/** Freeman–Tukey double arcsine of a proportion and its variance. */
export const ft = (e, n) => [Math.asin(Math.sqrt(e / (n + 1))) + Math.asin(Math.sqrt((e + 1) / (n + 1))), 1 / (n + 0.5)];
/** The proportion a Freeman–Tukey value stands for, with the harmonic mean sample size `n` (Miller 1978). */
export function ftBack(t, n) {
  if (n == null) return Math.min(1, Math.max(0, Math.sin(t / 2) ** 2));
  const tmin = Math.asin(Math.sqrt(1 / (n + 1))), tmax = Math.asin(Math.sqrt(n / (n + 1))) + Math.PI / 2;
  if (t <= tmin) return 0;
  if (t >= tmax) return 1;
  const st = Math.sin(t), x = 0.5 * (1 - Math.sign(Math.cos(t) || 1) * Math.sqrt(Math.max(0, 1 - (st + (st - 1 / st) / n) ** 2)));
  return Math.min(1, Math.max(0, x));
}

/** A pooled proportion by REML on the Freeman–Tukey scale, in percent: { p, lo, hi, I2, k, mu, se } or null below two arms. */
export function poolProportion(arms) {
  if (arms.length < 2) return null;
  const t = arms.map(a => ft(a.e, a.n)), r = reml(t.map(x => x[0]), t.map(x => x[1]));
  const hm = arms.length / sum(arms.map(a => 1 / a.n));
  const w = t.map(x => 1 / (x[1] + r.tau2)), sw = sum(w);
  return { p: 100 * ftBack(r.mu, hm), lo: 100 * ftBack(r.mu - 1.96 * r.se, hm), hi: 100 * ftBack(r.mu + 1.96 * r.se, hm), I2: r.I2, k: r.k, mu: r.mu, se: r.se,
    tau2: r.tau2, Q: r.Q, df: r.df, weights: w.map(x => (100 * x) / sw) };
}

/** The test for subgroup differences: Q on the subgroups' transformed estimates; null below two pooled subgroups. */
export function subgroupQ(pools) {
  const p = pools.filter(Boolean);
  if (p.length < 2) return null;
  const w = p.map(x => 1 / x.se ** 2), m = sum(w.map((wi, i) => wi * p[i].mu)) / sum(w), Q = sum(w.map((wi, i) => wi * (p[i].mu - m) ** 2));
  return { Q, df: p.length - 1, p: chi2Sf(Q, p.length - 1) };
}

const lchoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
/** The two-sided exact sign test: `favour` of `k` studies with a direction. */
export function signP(favour, k) {
  if (!k) return null;
  const lo = Math.min(favour, k - favour);
  let s = 0;
  for (let i = 0; i <= lo; i++) s += Math.exp(lchoose(k, i));
  return Math.min(1, (2 * s) / 2 ** k);
}

/**
 * A number to `d` places, a tie going to the even digit (0.125 is 0.12, 0.375 is 0.38) as the review's own scripts print it: toFixed sends every exact tie
 * up. Only a value that is exactly a tie in binary (the sign test's probabilities are such) is touched.
 */
export function fixed(x, d) {
  const m = x * 10 ** d;
  if (Number.isInteger(m * 2) && !Number.isInteger(m) && Number.isInteger(x * 4096)) return ((Math.floor(m) % 2 === 0 ? Math.floor(m) : Math.ceil(m)) / 10 ** d).toFixed(d);
  return x.toFixed(d);
}
/** "P < 0.001", "P = 0.003", "P = 0.25": three places under 0.01, two above. */
export const fmtP = p => (p < 0.001 ? 'P < 0.001' : p < 0.01 ? `P = ${fixed(p, 3)}` : `P = ${fixed(p, 2)}`);

// Mantel–Haenszel and Peto in JavaScript, as metafor 5's rma.mh and rma.peto compute them (owner, 2026-10-18: "also do MH, Peto and GLMM
// in javascript"): the pooled estimate from the counts without correction; its variance by Robins–Breslow–Greenland (OR), Greenland–Robins
// (RR), metafor's RD formula or the rate formula (IRR); Q and I² from escalc's study estimates with 0.5 in every cell of a study with a zero
// cell, a study with no events in either arm left out (drop00); the Cochran–Mantel–Haenszel test with its continuity correction and Tarone's
// test for an odds ratio; Peto's (O − E)/V. The weights are metafor's (weights(r)). app/test/meta-rare.test.mjs checks every number against
// native metafor (bench/measures/rare-oracle.json). Pure.
import { escalcRow } from './meta-escalc.mjs';
import { pchisqUpper } from './describe.mjs';

const Z975 = 1.959963984540054;
const sum = a => a.reduce((s, x) => s + x, 0);
export const handlesRare = ({ measure, method }) => (method === 'MH' && ['RR', 'OR', 'RD', 'IRR'].includes(measure)) || (method === 'PETO' && measure === 'OR');

/** Q, its p and I² from escalc's estimates (0.5 added where a cell is zero; a study with no events in both arms left out) around beta. */
function heterogeneity(measure, values, beta, rate) {
  const keep = values.filter(v => !(rate ? v[0] === 0 && v[2] === 0 : (v[0] === 0 && v[2] === 0) || (v[0] === v[1] && v[2] === v[3])));
  const es = keep.map(v => escalcRow(measure, v)), k = es.length;
  if (k < 2) return { q: 0, qp: 1, i2: 0, kyi: k };
  const q = Math.max(0, sum(es.map(e => (e.yi - beta) ** 2 / e.vi)));
  return { q, qp: pchisqUpper(q, k - 1), i2: Math.max(0, 100 * (q - (k - 1)) / q), kyi: k };
}

/**
 * The pooled result as the Analysis view's R list gives it for rma.mh / rma.peto: estimate, lo, hi, q, qp, i2, k, zval, pval, mu, mu_lb,
 * mu_ub, yi, vi, study_est/lo/hi (escalc's, as the view's `d`), weights, cmh, cmhp, tarone, taronep. Null where metafor's is NA (no events
 * in one arm across studies).
 */
export function poolRare({ measure, method, values }) {
  const rate = measure === 'IRR', V = values.map(v => v.map(Number));
  let beta, se, w, extra = {};
  if (method === 'PETO') {
    const a = V.map(v => v[0]), n1 = V.map(v => v[1]), c = V.map(v => v[2]), n2 = V.map(v => v[3]), N = n1.map((x, i) => x + n2[i]);
    const xt = a.map((x, i) => x + c[i]), yt = N.map((n, i) => n - xt[i]);
    const E = xt.map((x, i) => x * n1[i] / N[i]), Vi = xt.map((x, i) => x * yt[i] * (n1[i] / N[i]) * (n2[i] / N[i]) / (N[i] - 1));
    const sV = sum(Vi); if (!(sV > 0)) return null;
    const OE = a.map((x, i) => x - E[i]);
    beta = sum(OE) / sV; se = Math.sqrt(1 / sV); w = Vi.map(v => 100 * v / sV);
    const pos = Vi.map((v, i) => i).filter(i => Vi[i] > 0);
    const q = Math.max(0, sum(pos.map(i => OE[i] ** 2 / Vi[i])) - sum(pos.map(i => OE[i])) ** 2 / sum(pos.map(i => Vi[i])));
    const kyi = heterogeneity('OR', V, beta, false).kyi;
    extra = { q, qp: pos.length > 1 ? pchisqUpper(q, pos.length - 1) : 1, i2: pos.length > 1 ? Math.max(0, 100 * (q - (kyi - 1)) / q) : 0 };
  } else if (rate) {
    const [x1, t1, x2, t2] = [0, 1, 2, 3].map(j => V.map(v => v[j])), T = t1.map((t, i) => t + t2[i]);
    const Ri = x1.map((x, i) => x * t2[i] / T[i]), Si = x2.map((x, i) => x * t1[i] / T[i]), R = sum(Ri), S = sum(Si);
    if (!(sum(x1) > 0 && sum(x2) > 0)) return null;
    beta = Math.log(R / S); se = Math.sqrt(sum(t1.map((t, i) => (t / T[i]) * (t2[i] / T[i]) * (x1[i] + x2[i]))) / (R * S)); w = Si.map(x => 100 * x / S);
  } else {
    const a = V.map(v => v[0]), n1 = V.map(v => v[1]), c = V.map(v => v[2]), n2 = V.map(v => v[3]);
    const b = a.map((x, i) => n1[i] - x), d = c.map((x, i) => n2[i] - x), N = n1.map((x, i) => x + n2[i]);
    if (measure === 'OR') {
      const P = N.map((n, i) => (a[i] + d[i]) / n), Q = N.map((n, i) => (b[i] + c[i]) / n);
      const Ri = N.map((n, i) => (a[i] / n) * d[i]), Si = N.map((n, i) => (b[i] / n) * c[i]), R = sum(Ri), S = sum(Si);
      if (!(R > 0 && S > 0)) return null;
      const or = R / S; beta = Math.log(or);
      se = Math.sqrt(0.5 * (sum(P.map((p, i) => p * Ri[i])) / R ** 2 + sum(P.map((p, i) => p * Si[i] + Q[i] * Ri[i])) / (R * S) + sum(Q.map((q, i) => q * Si[i])) / S ** 2));
      w = Si.map(x => 100 * x / S);
      // Cochran–Mantel–Haenszel (with the continuity correction) and Tarone's adjustment of Breslow–Day
      const xt = a.map((x, i) => x + c[i]), yt = b.map((x, i) => x + d[i]);
      const cmh = (Math.abs(sum(a.map((x, i) => x - (n1[i] / N[i]) * xt[i]))) - 0.5) ** 2 / sum(N.map((n, i) => (n1[i] / n) * (n2[i] / n) * (xt[i] * (yt[i] / n))));
      const N11 = or === 1 ? n1.map((x, i) => (x / N[i]) * xt[i]) : n1.map((x, i) => {
        const A = or * (x + xt[i]) + (n2[i] - xt[i]), B = Math.sqrt(A * A - 4 * x * xt[i] * or * (or - 1)); return (A - B) / (2 * (or - 1)); });
      const pos = N11.map((_, i) => i).filter(i => N11[i] > 0 && xt[i] > 0 && yt[i] > 0);
      const vinv = i => 1 / (1 / N11[i] + 1 / (n1[i] - N11[i]) + 1 / (xt[i] - N11[i]) + 1 / (N11[i] - n1[i] - xt[i] + N[i]));
      const bd = Math.max(0, sum(pos.map(i => (a[i] - N11[i]) ** 2 / vinv(i))));
      const ta = Math.max(0, bd - sum(pos.map(i => a[i] - N11[i])) ** 2 / sum(pos.map(vinv)));
      extra = { cmh, cmhp: pchisqUpper(cmh, 1), tarone: ta, taronep: pos.length > 1 ? pchisqUpper(ta, pos.length - 1) : null };
    } else if (measure === 'RR') {
      const R = sum(a.map((x, i) => x * n2[i] / N[i])), Si = c.map((x, i) => x * n1[i] / N[i]), S = sum(Si);
      if (!(sum(a) > 0 && sum(c) > 0)) return null;
      beta = Math.log(R / S); se = Math.sqrt(sum(N.map((n, i) => (n1[i] / n) * (n2[i] / n) * (a[i] + c[i]) - (a[i] / n) * c[i])) / (R * S)); w = Si.map(x => 100 * x / S);
    } else {
      const den = sum(N.map((n, i) => n1[i] * n2[i] / n));
      beta = sum(N.map((n, i) => a[i] * n2[i] / n - c[i] * n1[i] / n)) / den;
      se = Math.sqrt((beta * sum(N.map((n, i) => c[i] * (n1[i] / n) ** 2 - a[i] * (n2[i] / n) ** 2 + (n1[i] / n) * (n2[i] / n) * (n2[i] - n1[i]) / 2))
        + sum(N.map((n, i) => a[i] * (n2[i] - c[i]) / n + c[i] * (n1[i] - a[i]) / n)) / 2) / den ** 2);
      w = N.map((n, i) => 100 * (n1[i] * n2[i] / n) / den);
    }
  }
  const tf = measure === 'RD' ? x => x : Math.exp, es = V.map(v => escalcRow(method === 'PETO' ? 'OR' : measure, v));
  const het = method === 'PETO' ? extra : heterogeneity(measure, V, beta, rate), zval = beta / se;
  return { estimate: tf(beta), lo: tf(beta - Z975 * se), hi: tf(beta + Z975 * se), se, q: het.q, qp: het.qp, i2: het.i2, k: V.length, zval, pval: pchisqUpper(zval * zval, 1),
    mu: beta, mu_lb: beta - Z975 * se, mu_ub: beta + Z975 * se, yi: es.map(e => e.yi), vi: es.map(e => e.vi),
    study_est: es.map(e => tf(e.yi)), study_lo: es.map(e => tf(e.yi - Z975 * Math.sqrt(e.vi))), study_hi: es.map(e => tf(e.yi + Z975 * Math.sqrt(e.vi))),
    weights: w, cmh: extra.cmh ?? null, cmhp: extra.cmhp ?? null, tarone: extra.tarone ?? null, taronep: extra.taronep ?? null, engine: 'js' };
}

/**
 * Mantel–Haenszel or Peto by subgroup (views/analysis.mjs's R): the overall pool, each level pooled the same way, and the test for subgroup
 * differences as RevMan computes it, Q across the levels' estimates with their inverse variances (a common-effect pool of them) on G − 1 df.
 * `groups` are the rows' levels (R's factor: sorted, unless `levels` gives them). Null where a level's pool is not estimable.
 */
export function poolRareGroups({ measure, method, values, groups, levels = null }) {
  const all = poolRare({ measure, method, values });
  if (!all) return null;
  // `levels` (a comparison's, lib/contrast-r.mjs levelsOf): those levels in that order, and a row in none of them in the overall pool only
  const g = levels ? groups.map(x => (x == null ? null : String(x))) : groups.map(String), lv = levels ? levels.map(String) : [...new Set(g)].sort();
  const subs = lv.map(l => poolRare({ measure, method, values: values.filter((_, i) => g[i] === l) }));
  if (subs.some(x => !x)) return null;
  const w = subs.map(x => 1 / (x.se * x.se)), sw = sum(w), bar = sum(subs.map((x, i) => w[i] * x.mu)) / sw;
  const qm = sum(subs.map((x, i) => w[i] * (x.mu - bar) ** 2));
  return { ...all, mod_kind: 'group', mod_levels: lv, mod_k: subs.map(x => x.k), mod_est: subs.map(x => x.estimate), mod_lo: subs.map(x => x.lo),
    mod_hi: subs.map(x => x.hi), mod_i2: subs.map(x => x.i2), qm, qmp: lv.length > 1 ? pchisqUpper(qm, lv.length - 1) : 1, qm_df: lv.length - 1,
    ...(levels ? { mod_tau2: lv.map(() => 0), mod_unassigned: g.filter(x => !lv.includes(x)).length } : {}) };
}


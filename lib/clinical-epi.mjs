// Clinical diagnostic and epidemiology calculators: pure functions over counts,
// scores and predictions, each returning a plain object with estimates, their
// confidence intervals (conf, default 0.95) and a `method` string naming the
// formula used, so a caller can record it beside the result (plan G6).
//
//   diagnostic2x2      Se, Sp, PPV, NPV, accuracy (Wilson by default, or exact
//                      Clopper–Pearson; both returned), LR+ and LR− (log
//                      method, Simel et al. 1991), DOR (Woolf), Youden's J and
//                      NND, predictive values at a chosen prevalence by Bayes.
//   postTestProbability, faganPoints   Bayes on the odds scale and the geometry
//                      of the Fagan nomogram (three parallel logit/log axes).
//   roc, rocCompare, optimalCutoff     empirical ROC, AUC as Mann–Whitney,
//                      DeLong variance by structural components (midrank form
//                      of Sun & Xu 2014), paired DeLong test, cutoff rules.
//   epi2x2             RR, OR, RD (Wald and Newcombe hybrid score), NNT with
//                      Altman's (1998) NNTB/NNTH convention, AFe, PAF with a
//                      delta-method interval on ln(1−PAF) after Greenland and
//                      Robins, Fisher's exact and mid-P tests.
//   incidence, rateComparison          Garwood exact rate interval, rate ratio
//                      by the conditional binomial, exact Poisson test.
//   directStandardise, smr, indirectStandardise   Fay–Feuer gamma interval,
//                      exact Poisson interval for O/E.
//   calibration, decisionCurve         logistic recalibration by IRLS, O:E,
//                      Brier, grouped points; net benefit (Vickers & Elkin 2006).
//
// Proportion intervals and the beta quantile come from lib/dta.mjs (the DTA
// review computes the same per-study intervals); distribution functions from
// lib/dist.mjs. Tables follow the usual layout: a/tp in the top-left cell,
// the exposed (or test-positive) row first, cases (or diseased) column first.
import { pnorm, qnorm, qchisq } from './dist.mjs';
import { wilson, clopperPearson, lgamma } from './dta.mjs';

const zOf = conf => qnorm(1 - (1 - conf) / 2);
const logit = p => Math.log(p / (1 - p));
const expit = x => 1 / (1 + Math.exp(-x));
const isCount = x => Number.isInteger(x) && x >= 0;
function need(ok, msg) { if (!ok) throw new Error(msg); }

/** A proportion x/n with both intervals; lo/hi carry the chosen one. */
export function proportion(x, n, { conf = 0.95, ci = 'wilson' } = {}) {
  if (!(n > 0)) return { est: NaN, lo: NaN, hi: NaN, x, n, wilson: [NaN, NaN], exact: [NaN, NaN] };
  const w = wilson(x, n, zOf(conf)), e = clopperPearson(x, n, conf);
  const [lo, hi] = ci === 'exact' ? e : w;
  return { est: x / n, lo, hi, x, n, wilson: w, exact: e };
}
/** A ratio with a Wald interval on the log scale. */
const logCi = (est, se, z) => ({ est, lo: Math.exp(Math.log(est) - z * se), hi: Math.exp(Math.log(est) + z * se), seLog: se });

// ---- diagnostic accuracy ----------------------------------------------------

/**
 * Accuracy of a test against a reference standard. Likelihood ratios and the
 * DOR add 0.5 to every cell when any cell is zero (`corrected: true`).
 * Predictive values at `prevalence` apply Bayes to the likelihood ratios, so
 * their intervals are the LR intervals carried through (prevalence fixed).
 */
export function diagnostic2x2({ tp, fp, fn, tn }, { prevalence = null, conf = 0.95, ci = 'wilson' } = {}) {
  need([tp, fp, fn, tn].every(isCount), 'diagnostic2x2: counts must be whole numbers ≥ 0');
  need(tp + fn > 0 && fp + tn > 0, 'diagnostic2x2: both reference groups need patients');
  const z = zOf(conf), N = tp + fp + fn + tn, o = { conf, ci };
  const se = proportion(tp, tp + fn, o), sp = proportion(tn, tn + fp, o);
  const out = {
    n: N, samplePrevalence: proportion(tp + fn, N, o),
    sensitivity: se, specificity: sp,
    ppv: proportion(tp, tp + fp, o), npv: proportion(tn, tn + fn, o),
    accuracy: proportion(tp + tn, N, o),
  };
  const corrected = [tp, fp, fn, tn].some(v => v === 0);
  const [A, B, C, D] = corrected ? [tp, fp, fn, tn].map(v => v + 0.5) : [tp, fp, fn, tn];
  const s1 = A / (A + C), p1 = D / (B + D);
  out.lrPos = logCi(s1 / (1 - p1), Math.sqrt(1 / A - 1 / (A + C) + 1 / B - 1 / (B + D)), z);
  out.lrNeg = logCi((1 - s1) / p1, Math.sqrt(1 / C - 1 / (A + C) + 1 / D - 1 / (B + D)), z);
  out.dor = logCi(A * D / (B * C), Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D), z);
  // Youden's J with a Wald interval from the two independent binomials.
  const J = se.est + sp.est - 1, seJ = Math.sqrt(se.est * (1 - se.est) / se.n + sp.est * (1 - sp.est) / sp.n);
  out.youden = { est: J, lo: J - z * seJ, hi: J + z * seJ, se: seJ };
  // Number needed to diagnose (Linn & Grunau 2006): 1/J, bounded only when J's interval excludes 0.
  out.nnd = { est: J > 0 ? 1 / J : Infinity, lo: out.youden.hi > 0 ? 1 / Math.min(1, out.youden.hi) : Infinity, hi: out.youden.lo > 0 ? 1 / out.youden.lo : Infinity };
  out.corrected = corrected;
  if (prevalence != null) {
    need(prevalence > 0 && prevalence < 1, 'diagnostic2x2: prevalence must lie in (0, 1)');
    const post = lr => postTestProbability(prevalence, lr).posttest;
    out.atPrevalence = {
      prevalence,
      ppv: { est: post(out.lrPos.est), lo: post(out.lrPos.lo), hi: post(out.lrPos.hi) },
      npv: { est: 1 - post(out.lrNeg.est), lo: 1 - post(out.lrNeg.hi), hi: 1 - post(out.lrNeg.lo) },
    };
  }
  out.method = `${ci === 'exact' ? 'Clopper–Pearson exact' : 'Wilson score'} intervals for proportions (both returned); ` +
    `LR± by the log method (Simel 1991) and DOR by Woolf's log method${corrected ? ', 0.5 added to every cell (a cell was zero)' : ''}; ` +
    'Youden J Wald; NND = 1/J; predictive values at a stated prevalence by Bayes on the LR intervals';
  return out;
}

/** Post-test probability from a pre-test probability and a likelihood ratio (number or {est, lo, hi}). */
export function postTestProbability(pretest, lr) {
  need(pretest >= 0 && pretest <= 1, 'postTestProbability: pre-test probability must lie in [0, 1]');
  const odds = pretest / (1 - pretest), p = l => { const o = odds * l; return Number.isFinite(o) ? o / (1 + o) : 1; };
  const r = typeof lr === 'object' && lr ? lr : { est: lr };
  const out = { pretest, pretestOdds: odds, lr: r.est, posttestOdds: odds * r.est, posttest: p(r.est), method: 'Bayes on the odds scale: post-odds = pre-odds × LR' };
  if (r.lo != null && r.hi != null) Object.assign(out, { lo: p(r.lo), hi: p(r.hi) });
  return out;
}

/** Probability ticks of the Fagan nomogram's outer axes, and likelihood ratio ticks of the middle one. */
export const FAGAN_PROB_TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999];
export const FAGAN_LR_TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * Fagan nomogram geometry. Three parallel axes at x = 0, 0.5, 1, each point
 * placed at height u (up positive, logit units): pre-test at u = −logit(p)
 * (low probabilities at the top), LR at u = ln(LR)/2, post-test at
 * u = logit(p). A straight line from pre-test through LR meets the right axis
 * at the post-test probability, since logit(post) = logit(pre) + ln LR.
 */
export function faganPoints(pretest, lrPos, lrNeg) {
  need(pretest > 0 && pretest < 1, 'faganPoints: pre-test probability must lie in (0, 1)');
  const U = 6.9068; // logit(0.999)
  const clamp = u => Math.max(-U, Math.min(U, u));
  const line = lr => {
    if (lr == null || !(lr > 0)) return null;
    const post = postTestProbability(pretest, lr).posttest, u0 = -logit(pretest);
    return { lr, posttest: post, x0: 0, u0, xm: 0.5, um: Math.log(lr) / 2, x1: 1, u1: logit(pretest) + Math.log(lr), u1Clamped: clamp(logit(pretest) + Math.log(lr)) };
  };
  return {
    range: [-U, U],
    axes: {
      pretest: { x: 0, ticks: FAGAN_PROB_TICKS.map(p => ({ value: p, u: -logit(p) })) },
      lr: { x: 0.5, ticks: FAGAN_LR_TICKS.map(l => ({ value: l, u: Math.log(l) / 2 })) },
      posttest: { x: 1, ticks: FAGAN_PROB_TICKS.map(p => ({ value: p, u: logit(p) })) },
    },
    pretest, positive: line(lrPos), negative: line(lrNeg),
    method: 'Fagan nomogram: logit(post) = logit(pre) + ln LR on three equally spaced axes',
  };
}

// ---- ROC --------------------------------------------------------------------

/** Midranks of xs (1-based), ties sharing their average rank. */
function midranks(xs) {
  const idx = xs.map((v, i) => i).sort((i, j) => xs[i] - xs[j]), r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k]] = m; i = j + 1;
  }
  return r;
}
/** DeLong structural components: V10 per diseased, V01 per non-diseased. */
function components(pos, neg) {
  const m = pos.length, n = neg.length, tz = midranks([...pos, ...neg]), tx = midranks(pos), ty = midranks(neg);
  const v10 = pos.map((_, i) => (tz[i] - tx[i]) / n), v01 = neg.map((_, j) => 1 - (tz[m + j] - ty[j]) / m);
  return { v10, v01, auc: v10.reduce((s, v) => s + v, 0) / m };
}
const cov = (a, b) => { const k = a.length, ma = a.reduce((s, v) => s + v, 0) / k, mb = b.reduce((s, v) => s + v, 0) / k; let s = 0; for (let i = 0; i < k; i++) s += (a[i] - ma) * (b[i] - mb); return k > 1 ? s / (k - 1) : 0; };
function split(scores, labels, direction) {
  need(scores.length === labels.length, 'roc: scores and labels differ in length');
  const sign = direction === '<' ? -1 : 1, pos = [], neg = [];
  scores.forEach((s, i) => { if (s == null || !Number.isFinite(+s)) return; const l = labels[i]; if (l === 1 || l === true) pos.push(sign * s); else if (l === 0 || l === false) neg.push(sign * s); });
  need(pos.length > 0 && neg.length > 0, 'roc: need at least one diseased and one non-diseased');
  return { pos, neg };
}
/** Area under the empirical ROC between two false-positive rates, linear between points. */
function areaBetween(points, a, b) {
  const pts = [...points].sort((p, q) => p.fpr - q.fpr || p.se - q.se);
  const at = x => { // the highest Se reached at FPR x, interpolated
    let lo = pts[0]; for (const p of pts) { if (p.fpr < x) lo = p; else { if (p.fpr === x) return Math.max(...pts.filter(q => q.fpr === x).map(q => q.se)); return lo.se + (p.se - lo.se) * (x - lo.fpr) / (p.fpr - lo.fpr); } }
    return lo.se;
  };
  const xs = [a, ...pts.map(p => p.fpr).filter(x => x > a && x < b), b];
  let area = 0; for (let i = 1; i < xs.length; i++) {
    // a vertical step at xs[i-1]: use the upper value just right of it
    const left = pts.filter(p => p.fpr === xs[i - 1]).length ? Math.max(...pts.filter(p => p.fpr === xs[i - 1]).map(p => p.se)) : at(xs[i - 1]);
    const right = pts.filter(p => p.fpr === xs[i]).length ? Math.min(...pts.filter(p => p.fpr === xs[i]).map(p => p.se)) : at(xs[i]);
    area += (xs[i] - xs[i - 1]) * (left + right) / 2;
  }
  return area;
}

/**
 * Empirical ROC. labels: 1 diseased, 0 not. direction '>' (default) calls a
 * score ≥ threshold positive; '<' a score ≤ threshold. Points run from the
 * threshold +∞ (nobody positive) down through every distinct score.
 * `partial: [fpr0, fpr1]` adds the partial AUC over that false-positive range
 * with McClish's standardisation.
 */
export function roc(scores, labels, { conf = 0.95, direction = '>', partial = null } = {}) {
  const { pos, neg } = split(scores, labels, direction), m = pos.length, n = neg.length, sign = direction === '<' ? -1 : 1;
  const distinct = [...new Set([...pos, ...neg])].sort((a, b) => b - a);
  const sp = [...pos].sort((a, b) => b - a), sn = [...neg].sort((a, b) => b - a);
  const points = [{ threshold: sign * Infinity, tp: 0, fp: 0, se: 0, sp: 1, fpr: 0 }];
  let i = 0, j = 0;
  for (const t of distinct) {
    while (i < m && sp[i] >= t) i++;
    while (j < n && sn[j] >= t) j++;
    points.push({ threshold: sign * t, tp: i, fp: j, se: i / m, sp: 1 - j / n, fpr: j / n });
  }
  const { v10, v01, auc } = components(pos, neg), s10 = cov(v10, v10), s01 = cov(v01, v01);
  const se = Math.sqrt(s10 / m + s01 / n), z = zOf(conf);
  const out = {
    points, nPos: m, nNeg: n, direction, conf,
    auc: { est: auc, se, lo: Math.max(0, auc - z * se), hi: Math.min(1, auc + z * se) },
    components: { v10, v01, s10, s01 },
    method: 'empirical ROC; AUC = Mann–Whitney U/(n1·n0), ties count ½; DeLong (1988) variance by structural components; Wald interval clipped to [0, 1]',
  };
  if (partial) {
    const [a, b] = partial; need(a >= 0 && b <= 1 && b > a, 'roc: partial range must satisfy 0 ≤ fpr0 < fpr1 ≤ 1');
    const pAuc = areaBetween(points, a, b), mn = (b * b - a * a) / 2, mx = b - a;
    out.partialAuc = { range: [a, b], est: pAuc, standardised: (1 + (pAuc - mn) / (mx - mn)) / 2, method: 'trapezoidal area over the FPR range; McClish (1989) standardisation' };
  }
  return out;
}

/** Paired DeLong test of two AUCs measured on the same patients. */
export function rocCompare(scoresA, scoresB, labels, { conf = 0.95, direction = '>' } = {}) {
  need(scoresA.length === labels.length && scoresB.length === labels.length, 'rocCompare: inputs differ in length');
  const keep = labels.map((_, i) => Number.isFinite(+scoresA[i]) && Number.isFinite(+scoresB[i]) && scoresA[i] != null && scoresB[i] != null);
  const f = arr => arr.filter((_, i) => keep[i]), L = f(labels);
  const dirs = Array.isArray(direction) ? direction : [direction, direction];
  const A = split(f(scoresA), L, dirs[0]), B = split(f(scoresB), L, dirs[1]);
  const ca = components(A.pos, A.neg), cb = components(B.pos, B.neg), m = A.pos.length, n = A.neg.length;
  const v = (cov(ca.v10, ca.v10) + cov(cb.v10, cb.v10) - 2 * cov(ca.v10, cb.v10)) / m + (cov(ca.v01, ca.v01) + cov(cb.v01, cb.v01) - 2 * cov(ca.v01, cb.v01)) / n;
  const d = ca.auc - cb.auc, se = Math.sqrt(Math.max(0, v)), z = zOf(conf), stat = se > 0 ? d / se : NaN;
  const sA = Math.sqrt(cov(ca.v10, ca.v10) / m + cov(ca.v01, ca.v01) / n), sB = Math.sqrt(cov(cb.v10, cb.v10) / m + cov(cb.v01, cb.v01) / n);
  return {
    aucA: ca.auc, aucB: cb.auc, seA: sA, seB: sB, correlation: sA && sB ? (sA * sA + sB * sB - v) / (2 * sA * sB) : NaN,
    difference: { est: d, se, lo: d - z * se, hi: d + z * se }, z: stat, p: Number.isFinite(stat) ? 2 * (1 - pnorm(Math.abs(stat))) : NaN,
    nPos: m, nNeg: n, method: 'paired DeLong (1988) test: z = (AUC_A − AUC_B)/SE from the structural-component covariance',
  };
}

/**
 * Choose a cutoff on a roc() result. 'youden' maximises Se + Sp − 1;
 * 'closest' minimises the distance to (0, 1); 'cost' maximises
 * Se − m·(1 − Sp) with m = costRatio·(1 − prevalence)/prevalence, costRatio
 * being the cost of a false positive over a false negative (prevalence
 * defaults to the sample's). fixedSe / fixedSp: the best other margin among
 * cutoffs reaching the fixed one. The +∞ threshold is never chosen.
 */
export function optimalCutoff(rocResult, { method, costRatio = 1, prevalence, fixedSe, fixedSp } = {}) {
  method = method || (fixedSe != null ? 'fixedSe' : fixedSp != null ? 'fixedSp' : 'youden');
  const pts = rocResult.points.filter(p => Number.isFinite(p.threshold));
  const prev = prevalence ?? rocResult.nPos / (rocResult.nPos + rocResult.nNeg);
  let score, pool = pts, rule;
  if (method === 'youden') { score = p => p.se + p.sp - 1; rule = 'maximum Youden J'; }
  else if (method === 'closest') { score = p => -((1 - p.se) ** 2 + (1 - p.sp) ** 2); rule = 'closest to (0, 1)'; }
  else if (method === 'cost') { const m = costRatio * (1 - prev) / prev; score = p => p.se - m * (1 - p.sp); rule = `maximum Se − ${m.toPrecision(4)}·(1 − Sp) (cost ratio ${costRatio}, prevalence ${prev.toPrecision(4)})`; }
  else if (method === 'fixedSe') { pool = pts.filter(p => p.se >= fixedSe); score = p => p.sp + p.se * 1e-9; rule = `highest Sp with Se ≥ ${fixedSe}`; }
  else if (method === 'fixedSp') { pool = pts.filter(p => p.sp >= fixedSp); score = p => p.se + p.sp * 1e-9; rule = `highest Se with Sp ≥ ${fixedSp}`; }
  else throw new Error(`optimalCutoff: unknown method '${method}'`);
  if (!pool.length) return { method: rule, cutoff: null };
  const best = pool.reduce((b, p) => (score(p) > score(b) ? p : b));
  return { threshold: best.threshold, se: best.se, sp: best.sp, youden: best.se + best.sp - 1, criterion: score(best), cutoff: best, method: rule };
}

// ---- exposure × outcome 2×2 --------------------------------------------------

const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
/** Fisher's exact test (two-sided, R's rule) and the mid-P, on the top-left cell. */
function fisher(a, b, c, d) {
  const r1 = a + b, c1 = a + c, N = a + b + c + d, lo = Math.max(0, c1 - (N - r1)), hi = Math.min(r1, c1);
  const lp = []; for (let x = lo; x <= hi; x++) lp.push(lchoose(r1, x) + lchoose(N - r1, c1 - x) - lchoose(N, c1));
  const mx = Math.max(...lp), pr = lp.map(v => Math.exp(v - mx)), tot = pr.reduce((s, v) => s + v, 0), P = pr.map(v => v / tot);
  const k = a - lo, pObs = P[k];
  const two = Math.min(1, P.reduce((s, v) => s + (v <= pObs * (1 + 1e-7) ? v : 0), 0));
  const below = P.slice(0, k).reduce((s, v) => s + v, 0), above = P.slice(k + 1).reduce((s, v) => s + v, 0);
  return { fisherP: two, midP: Math.min(1, 2 * Math.min(below + pObs / 2, above + pObs / 2)) };
}
/** Newcombe's hybrid score interval (method 10) for p1 − p0. */
function newcombe(x1, n1, x0, n0, z) {
  const [l1, u1] = wilson(x1, n1, z), [l0, u0] = wilson(x0, n0, z), p1 = x1 / n1, p0 = x0 / n0, d = p1 - p0;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2)];
}

/**
 * Number needed to treat from a risk difference and its interval, by Altman
 * (BMJ 1998). With an adverse outcome (default) a negative RD is benefit
 * (NNTB), a positive one harm (NNTH); `outcome: 'beneficial'` reverses that.
 * When the RD interval spans zero the interval runs NNTB x to ∞ to NNTH y.
 */
export function nntFromRd(rd, lo, hi, { outcome = 'adverse' } = {}) {
  const benefit = v => (outcome === 'adverse' ? v < 0 : v > 0);
  const lab = v => (v === 0 ? null : benefit(v) ? 'NNTB' : 'NNTH');
  const inv = v => (v === 0 ? Infinity : 1 / Math.abs(v));
  const spans = lo < 0 && hi > 0;
  const lower = { label: lab(lo), value: inv(lo) }, upper = { label: lab(hi), value: inv(hi) };
  const f = v => (Number.isFinite(v) ? v.toFixed(1) : '∞');
  let text;
  if (spans) {
    const [bl, hl] = lab(lo) === 'NNTB' ? [lower, upper] : [upper, lower];
    text = `${lab(rd) ?? 'NNT'} ${f(inv(rd))} (NNTB ${f(bl.value)} to ∞ to NNTH ${f(hl.value)})`;
  } else {
    const [a, b] = [inv(lo), inv(hi)].sort((x, y) => x - y);
    text = `${lab(rd) ?? 'NNT'} ${f(inv(rd))} (${f(a)} to ${f(b)})`;
  }
  return { est: inv(rd), label: lab(rd), spansZero: spans, lower, upper, text, method: 'Altman (1998): NNT = 1/|RD|, limits 1/|RD limits|, labelled NNTB/NNTH' };
}

/**
 * Exposure (rows) by outcome (columns): a exposed cases, b exposed non-cases,
 * c unexposed cases, d unexposed non-cases. A case-control design estimates
 * the OR only (and AFe, PAF from it); cohort and cross-sectional designs give
 * risks (prevalences) too. Ratios add 0.5 to every cell when one is zero.
 */
export function epi2x2({ a, b, c, d }, { design = 'cohort', conf = 0.95, rdCi = 'newcombe', outcome = 'adverse' } = {}) {
  need([a, b, c, d].every(isCount), 'epi2x2: counts must be whole numbers ≥ 0');
  need(['cohort', 'case-control', 'cross-sectional'].includes(design), `epi2x2: unknown design '${design}'`);
  const z = zOf(conf), N = a + b + c + d, n1 = a + b, n0 = c + d;
  const corrected = [a, b, c, d].some(v => v === 0);
  const [A, B, C, D] = corrected ? [a, b, c, d].map(v => v + 0.5) : [a, b, c, d];
  const out = { design, n: N, conf, corrected };
  out.or = logCi(A * D / (B * C), Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D), z);
  const methods = ["OR by Woolf's log method"];
  const tests = fisher(a, b, c, d);
  out.fisherP = tests.fisherP; out.midP = tests.midP;
  const afFrom = r => ({ est: (r.est - 1) / r.est, lo: (r.lo - 1) / r.lo, hi: (r.hi - 1) / r.hi });
  if (design === 'case-control') {
    need(a + c > 0 && b + d > 0, 'epi2x2: need cases and controls');
    out.afExposed = afFrom(out.or);
    // PAF = (a/(a+c))·(OR − 1)/OR; 1 − PAF = c(b+d)/((a+c)d); cases and controls fixed.
    const paf = 1 - c * (b + d) / ((a + c) * d), v = a / (c * (a + c)) + b / (d * (b + d));
    out.paf = { est: paf, lo: 1 - (1 - paf) * Math.exp(z * Math.sqrt(v)), hi: 1 - (1 - paf) * Math.exp(-z * Math.sqrt(v)) };
    methods.push('AFe = (OR − 1)/OR', 'PAF from the exposed share of cases (Miettinen), interval on ln(1 − PAF) by the delta method (Greenland 1987)');
  } else {
    need(n1 > 0 && n0 > 0, 'epi2x2: both exposure groups need people');
    const r1 = a / n1, r0 = c / n0;
    out.risk1 = proportion(a, n1, { conf }); out.risk0 = proportion(c, n0, { conf });
    out.rr = logCi((A / (A + B)) / (C / (C + D)), Math.sqrt(1 / A - 1 / (A + B) + 1 / C - 1 / (C + D)), z);
    const rd = r1 - r0, seRd = Math.sqrt(r1 * (1 - r1) / n1 + r0 * (1 - r0) / n0), nc = newcombe(a, n1, c, n0, z);
    out.rd = { est: rd, se: seRd, wald: [rd - z * seRd, rd + z * seRd], newcombe: nc };
    [out.rd.lo, out.rd.hi] = rdCi === 'wald' ? out.rd.wald : nc;
    out.nnt = nntFromRd(rd, out.rd.lo, out.rd.hi, { outcome });
    out.afExposed = afFrom(out.rr);
    // PAF = (R − R0)/R with R the overall risk; 1 − PAF = R0/R.
    const R = (a + c) / N, paf = 1 - r0 / R;
    let v;
    if (design === 'cohort') v = a / (a + c) ** 2 * (b / n1 + a * d / (c * n0));           // two binomials, row totals fixed
    else {                                                                                  // one multinomial
      const g = [-1 / (a + c) + 1 / N, 1 / N, 1 / c - 1 / (c + d) - 1 / (a + c) + 1 / N, -1 / (c + d) + 1 / N], cells = [a, b, c, d];
      v = g.reduce((s, gi, i) => s + gi * gi * cells[i], 0) - g.reduce((s, gi, i) => s + gi * cells[i], 0) ** 2 / N;
    }
    out.paf = { est: paf, lo: 1 - (1 - paf) * Math.exp(z * Math.sqrt(v)), hi: 1 - (1 - paf) * Math.exp(-z * Math.sqrt(v)) };
    const word = design === 'cohort' ? 'risk' : 'prevalence';
    methods.push(`${word} ratio by the log method (Katz)`, `${word} difference with ${rdCi === 'wald' ? 'Wald' : 'Newcombe hybrid score'} interval (both returned)`,
      'NNT by Altman (1998)', 'AFe = (RR − 1)/RR', 'PAF = (R − R0)/R, interval on ln(1 − PAF) by the delta method (Greenland & Robins 1988)');
  }
  methods.push("Fisher's exact test (two-sided, probabilities ≤ observed) and mid-P (twice the smaller one-sided mid-P)");
  if (corrected) methods.push('0.5 added to every cell for OR and RR (a cell was zero)');
  out.method = methods.join('; ');
  return out;
}

// ---- rates -------------------------------------------------------------------

/** Exact Poisson interval for a count x (Garwood 1936). */
export function poissonCi(x, conf = 0.95) {
  const al = (1 - conf) / 2;
  return [x === 0 ? 0 : qchisq(al, 2 * x) / 2, qchisq(1 - al, 2 * x + 2) / 2];
}
/** Two-sided exact binomial test as R's binom.test: sum of probabilities ≤ the observed one. */
function binomTest(x, n, p0) {
  const lp = k => lchoose(n, k) + (k ? k * Math.log(p0) : 0) + (n - k ? (n - k) * Math.log(1 - p0) : 0);
  const d = lp(x); let s = 0;
  for (let k = 0; k <= n; k++) { const v = lp(k); if (v <= d + Math.log1p(1e-7)) s += Math.exp(v); }
  return Math.min(1, s);
}
/** Two-sided exact Poisson test of a count against its expectation, as R's poisson.test. */
function poissonTest(x, mu) {
  const lp = k => -mu + k * Math.log(mu) - lgamma(k + 1), d = lp(x), tol = Math.log1p(1e-7);
  let s = 0;
  for (let k = 0; ; k++) { const v = lp(k); if (v <= d + tol) s += Math.exp(v); if (k > mu && k > x && v < d - 40) break; }
  return Math.min(1, s);
}

/** Incidence rate events/time with the exact (Garwood) interval; `per` scales it (e.g. 1000 person-years). */
export function incidence(events, time, { conf = 0.95, per = 1 } = {}) {
  need(isCount(events) && time > 0, 'incidence: events ≥ 0 and time > 0');
  const [l, u] = poissonCi(events, conf);
  return { events, time, per, est: events / time * per, lo: l / time * per, hi: u / time * per, method: 'exact Poisson interval (Garwood 1936) from χ² quantiles' };
}

/**
 * Two incidence rates. The rate ratio's exact interval conditions on the total
 * count: events1 | total ~ Binomial(total, π), π = t1·IRR/(t1·IRR + t2),
 * Clopper–Pearson on π. The exact test is binomial on the same π (R's
 * poisson.test); the rate difference has a Wald interval.
 */
export function rateComparison({ events1, time1, events2, time2 }, { conf = 0.95, per = 1 } = {}) {
  need(isCount(events1) && isCount(events2) && time1 > 0 && time2 > 0, 'rateComparison: events ≥ 0 and times > 0');
  const z = zOf(conf), n = events1 + events2, r1 = events1 / time1, r2 = events2 / time2;
  const out = { rate1: incidence(events1, time1, { conf, per }), rate2: incidence(events2, time2, { conf, per }) };
  if (n > 0) {
    const [pl, pu] = clopperPearson(events1, n, conf), f = p => (p >= 1 ? Infinity : p / (1 - p) * time2 / time1);
    out.rateRatio = { est: events2 ? r1 / r2 : Infinity, lo: f(pl), hi: f(pu) };
    out.p = binomTest(events1, n, time1 / (time1 + time2));
  } else { out.rateRatio = { est: NaN, lo: 0, hi: Infinity }; out.p = 1; }
  const rd = r1 - r2, se = Math.sqrt(events1 / time1 ** 2 + events2 / time2 ** 2);
  out.rateDifference = { est: rd * per, se: se * per, lo: (rd - z * se) * per, hi: (rd + z * se) * per };
  out.method = 'rate ratio with exact interval by the conditional binomial (Clopper–Pearson); exact two-sided test as poisson.test; rate difference Wald; rates by Garwood';
  return out;
}

// ---- standardisation ------------------------------------------------------------

const eventsOf = s => (Array.isArray(s) ? s[0] : s.events);
const timeOf = s => (Array.isArray(s) ? s[1] : s.time ?? s.population ?? s.n);

/**
 * Directly standardised rate. stratumRates: [{ events, time }] per stratum
 * (time may be person-time or population); standardPopulation: the standard
 * weights in the same order. Fay–Feuer (1997) gamma interval.
 */
export function directStandardise(stratumRates, standardPopulation, { conf = 0.95, per = 1 } = {}) {
  need(stratumRates.length === standardPopulation.length && stratumRates.length > 0, 'directStandardise: one standard weight per stratum');
  const W = standardPopulation.reduce((s, v) => s + v, 0), w = standardPopulation.map(v => v / W);
  const x = stratumRates.map(eventsOf), t = stratumRates.map(timeOf);
  need(x.every(isCount) && t.every(v => v > 0), 'directStandardise: events ≥ 0 and time > 0 in every stratum');
  const crude = x.reduce((s, v) => s + v, 0) / t.reduce((s, v) => s + v, 0);
  const y = w.reduce((s, wi, i) => s + wi * x[i] / t[i], 0), V = w.reduce((s, wi, i) => s + (wi / t[i]) ** 2 * x[i], 0);
  const wm = Math.max(...w.map((wi, i) => wi / t[i])), al = (1 - conf) / 2;
  const lo = y > 0 ? V / (2 * y) * qchisq(al, 2 * y * y / V) : 0;
  const hi = (V + wm * wm) / (2 * (y + wm)) * qchisq(1 - al, 2 * (y + wm) ** 2 / (V + wm * wm));
  return { est: y * per, lo: lo * per, hi: hi * per, crude: crude * per, variance: V * per * per, per, method: 'direct standardisation; Fay–Feuer (1997) gamma interval' };
}

/** Standardised mortality (incidence) ratio O/E with the exact Poisson interval and test. */
export function smr(observed, expected, { conf = 0.95 } = {}) {
  need(isCount(observed) && expected > 0, 'smr: observed ≥ 0 and expected > 0');
  const [l, u] = poissonCi(observed, conf);
  return { observed, expected, est: observed / expected, lo: l / expected, hi: u / expected, p: poissonTest(observed, expected), method: 'SMR = O/E; exact Poisson interval on O (Garwood); exact two-sided test as poisson.test' };
}

/** Indirect standardisation: expected = Σ stratum population × standard rate, then smr(). */
export function indirectStandardise(observed, stratumPopulation, standardRates, { conf = 0.95 } = {}) {
  need(stratumPopulation.length === standardRates.length, 'indirectStandardise: one standard rate per stratum');
  const expected = stratumPopulation.reduce((s, n, i) => s + n * standardRates[i], 0);
  return smr(observed, expected, { conf });
}

// ---- calibration and decision curves -------------------------------------------------

/** Logistic regression y ~ [intercept] + [slope·x] + offset by IRLS; returns coefficients and their covariance. */
function logisticFit(y, x, { offset, slope = true }) {
  const n = y.length, k = slope ? 2 : 1; let beta = slope ? [0, 1] : [0];
  let info = null;
  for (let it = 0; it < 50; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const eta = beta[0] + (slope ? beta[1] * x[i] : 0) + (offset ? offset[i] : 0), p = expit(eta), wt = p * (1 - p), row = slope ? [1, x[i]] : [1];
      for (let r = 0; r < k; r++) { g[r] += row[r] * (y[i] - p); for (let s = 0; s < k; s++) H[r][s] += wt * row[r] * row[s]; }
    }
    info = H;
    let step;
    if (k === 1) step = [g[0] / H[0][0]];
    else { const det = H[0][0] * H[1][1] - H[0][1] * H[1][0]; step = [(H[1][1] * g[0] - H[0][1] * g[1]) / det, (H[0][0] * g[1] - H[1][0] * g[0]) / det]; }
    beta = beta.map((b, r) => b + step[r]);
    if (step.every(s => Math.abs(s) < 1e-10)) break;
  }
  const covm = k === 1 ? [[1 / info[0][0]]] : (() => { const det = info[0][0] * info[1][1] - info[0][1] * info[1][0]; return [[info[1][1] / det, -info[0][1] / det], [-info[1][0] / det, info[0][0] / det]]; })();
  return { beta, cov: covm };
}

/**
 * Calibration of predicted risks against 0/1 outcomes. Intercept: calibration
 * in the large, logit(y) ~ offset(logit p) (0 is ideal). Slope: logit(y) ~ a +
 * b·logit p (1 is ideal). O:E with interval exp(ln(O/E) ± z/√O). Brier score,
 * scaled Brier 1 − Brier/(ȳ(1 − ȳ)), and `groups` equal-sized groups by
 * predicted risk with the observed proportion's Wilson interval.
 */
export function calibration(predicted, observed, { conf = 0.95, groups = 10 } = {}) {
  need(predicted.length === observed.length && predicted.length > 1, 'calibration: predicted and observed differ in length');
  need(observed.every(v => v === 0 || v === 1), 'calibration: observed must be 0 or 1');
  need(predicted.every(p => p >= 0 && p <= 1), 'calibration: predicted risks must lie in [0, 1]');
  const z = zOf(conf), n = predicted.length, eps = 1e-12;
  const lp = predicted.map(p => logit(Math.min(1 - eps, Math.max(eps, p))));
  const O = observed.reduce((s, v) => s + v, 0), E = predicted.reduce((s, v) => s + v, 0), ybar = O / n;
  const citl = logisticFit(observed, lp, { offset: lp, slope: false }), sl = logisticFit(observed, lp, { slope: true });
  const brier = predicted.reduce((s, p, i) => s + (p - observed[i]) ** 2, 0) / n;
  const ci = (b, v) => ({ est: b, se: Math.sqrt(v), lo: b - z * Math.sqrt(v), hi: b + z * Math.sqrt(v) });
  const order = predicted.map((_, i) => i).sort((i, j) => predicted[i] - predicted[j]), G = Math.min(groups, n), pts = [];
  for (let g = 0; g < G; g++) {
    const ids = order.slice(Math.round(g * n / G), Math.round((g + 1) * n / G)); if (!ids.length) continue;
    const x = ids.reduce((s, i) => s + observed[i], 0), [lo, hi] = wilson(x, ids.length, z);
    pts.push({ group: g + 1, n: ids.length, predicted: ids.reduce((s, i) => s + predicted[i], 0) / ids.length, observed: x / ids.length, lo, hi });
  }
  return {
    n, events: O, expected: E,
    intercept: ci(citl.beta[0], citl.cov[0][0]), slope: ci(sl.beta[1], sl.cov[1][1]), slopeIntercept: sl.beta[0],
    oe: { est: O / E, lo: O ? O / E * Math.exp(-z / Math.sqrt(O)) : 0, hi: O ? O / E * Math.exp(z / Math.sqrt(O)) : NaN },
    brier, brierScaled: ybar > 0 && ybar < 1 ? 1 - brier / (ybar * (1 - ybar)) : NaN,
    groups: pts,
    method: 'calibration intercept (offset logit p) and slope (on logit p) by IRLS logistic regression, Wald intervals; O:E with exp(±z/√O); Brier score; groups of equal size by predicted risk, Wilson intervals',
  };
}

/**
 * Net benefit at each threshold probability pt (Vickers & Elkin 2006):
 * TP/n − FP/n · pt/(1 − pt), a prediction ≥ pt counting as positive; treat all
 * is prevalence − (1 − prevalence)·pt/(1 − pt); treat none is 0.
 */
export function decisionCurve(predicted, observed, thresholds) {
  need(predicted.length === observed.length && predicted.length > 0, 'decisionCurve: predicted and observed differ in length');
  const ts = thresholds || Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
  const n = predicted.length, prev = observed.reduce((s, v) => s + v, 0) / n;
  const rows = ts.filter(t => t > 0 && t < 1).map(t => {
    let tp = 0, fp = 0;
    for (let i = 0; i < n; i++) if (predicted[i] >= t) { if (observed[i]) tp++; else fp++; }
    const w = t / (1 - t);
    return { threshold: t, model: tp / n - fp / n * w, all: prev - (1 - prev) * w, none: 0, tp, fp };
  });
  return { n, prevalence: prev, rows, method: 'net benefit (Vickers & Elkin 2006); a prediction ≥ threshold is positive' };
}

// Agreement and reliability statistics in plain JavaScript: intraclass
// correlation, Bland–Altman limits of agreement, Cohen's (weighted) kappa,
// Fleiss' kappa, Gwet's AC1, Krippendorff's alpha, percent agreement and
// Cronbach's alpha.
//
// Every function is pure and returns a plain object with its estimates, a
// confidence interval at `conf` (default 0.95) and an R-style `method` string.
// Formulas follow the R functions named in each block (irr::icc, irr::kappa2,
// irr::kappam.fleiss, irr::kripp.alpha, irr::agree); where irr has no
// counterpart the source paper is named. Nothing here has been benchmarked
// against native R; the unit tests check hand-computed cases and published
// worked examples only.
//
// Data layout, throughout: a matrix is an array of rows, one row per subject
// (unit), one column per rater (or item, for Cronbach's alpha). Missing values
// are null, undefined or NaN.
//
// Unweighted Cohen's kappa gives the same po, pe and κ as the risk-of-bias
// reviewers' kappa in lib/rob-review.mjs (checked there against irr::kappa2);
// the version here adds weights, levels and standard errors, so it keeps the
// full contingency table rather than the pair list.
import { pnorm, qnorm, pt, qt, pbeta } from './dist.mjs';

// ---- helpers ------------------------------------------------------------------------

const isMissing = v => v == null || (typeof v === 'number' && Number.isNaN(v));
const sum = a => a.reduce((t, v) => t + v, 0);
const mean = a => sum(a) / a.length;
/** Sample variance (divisor n − 1), as R's var. */
const variance = a => { const m = mean(a); return sum(a.map(v => (v - m) ** 2)) / (a.length - 1); };
const cor = (x, y) => {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const zOf = conf => qnorm(1 - (1 - conf) / 2);
const check = (ok, msg) => { if (!ok) throw new Error(msg); };

function bisect(f, lo, hi) {
  let flo = f(lo);
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

/** F distribution function P(F ≤ f) with d1, d2 degrees of freedom (d2 may be fractional). */
export function pf(f, d1, d2, lowerTail = true) {
  if (!(f > 0)) return lowerTail ? 0 : 1;
  if (f === Infinity) return lowerTail ? 1 : 0;
  // compute the smaller tail directly for precision
  const x = d1 * f / (d1 * f + d2);
  return lowerTail ? pbeta(x, d1 / 2, d2 / 2) : pbeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

/** F quantile: the f with P(F ≤ f) = p. */
export function qf(p, d1, d2) {
  if (p <= 0) return 0; if (p >= 1) return Infinity;
  let hi = 2; while (pf(hi, d1, d2) < p) hi *= 2;
  return bisect(t => pf(t, d1, d2) - p, 0, hi);
}

/** Complete rows only (listwise deletion, as irr's na.omit). */
function completeRows(matrix) {
  check(Array.isArray(matrix) && matrix.length, 'a matrix of rows is required');
  return matrix.filter(r => r.every(v => !isMissing(v))).map(r => r.map(Number));
}

// ---- intraclass correlation (irr::icc) ----------------------------------------------

const ICC_FORMS = [
  ['oneway', 'agreement', 'single'], ['oneway', 'agreement', 'average'],
  ['twoway', 'consistency', 'single'], ['twoway', 'consistency', 'average'],
  ['twoway', 'agreement', 'single'], ['twoway', 'agreement', 'average'],
];

/** Mean squares of the subjects × raters layout, as irr::icc computes them. */
function iccMeanSquares(ratings) {
  const ns = ratings.length, nr = ratings[0].length, all = ratings.flat();
  const SStotal = variance(all) * (ns * nr - 1);
  const MSr = variance(ratings.map(mean)) * nr;
  const MSw = sum(ratings.map(variance)) / ns;
  const colMeans = Array.from({ length: nr }, (_, j) => mean(ratings.map(r => r[j])));
  const MSc = variance(colMeans) * ns;
  const MSe = (SStotal - MSr * (ns - 1) - MSc * (nr - 1)) / ((ns - 1) * (nr - 1));
  return { ns, nr, MSr, MSw, MSc, MSe };
}

/**
 * Intraclass correlation, one of the six Shrout–Fleiss / McGraw–Wong forms,
 * with the F test of H0: ICC = r0 and the confidence interval exactly as
 * irr::icc (which follows McGraw & Wong 1996). `matrix` has subjects in rows
 * and raters in columns; incomplete rows are dropped. The one-way model has
 * no separate consistency form (type is ignored there, as in irr).
 */
export function icc(matrix, { model = 'oneway', type = 'consistency', unit = 'single', r0 = 0, conf = 0.95 } = {}) {
  check(['oneway', 'twoway'].includes(model), `model must be 'oneway' or 'twoway'`);
  check(['agreement', 'consistency'].includes(type), `type must be 'agreement' or 'consistency'`);
  check(['single', 'average'].includes(unit), `unit must be 'single' or 'average'`);
  const ratings = completeRows(matrix);
  check(ratings.length >= 2 && ratings[0].length >= 2, 'icc needs at least two complete subjects and two raters');
  const { ns, nr, MSr, MSw, MSc, MSe } = iccMeanSquares(ratings);
  const alpha = 1 - conf;
  let value, F, df1 = ns - 1, df2, lower, upper;
  const agreementDf = c => {
    const a = (nr * c) / (ns * (1 - c)), b = 1 + (nr * c * (ns - 1)) / (ns * (1 - c));
    return (a * MSc + b * MSe) ** 2 / ((a * MSc) ** 2 / (nr - 1) + (b * MSe) ** 2 / ((ns - 1) * (nr - 1)));
  };
  const agreementBounds = v => {
    const FL = qf(1 - alpha / 2, ns - 1, v), FU = qf(1 - alpha / 2, v, ns - 1);
    return [
      (ns * (MSr - FL * MSe)) / (FL * (nr * MSc + (nr * ns - nr - ns) * MSe) + ns * MSr),
      (ns * (FU * MSr - MSe)) / (nr * MSc + (nr * ns - nr - ns) * MSe + ns * FU * MSr),
    ];
  };
  if (model === 'oneway') {
    df2 = ns * (nr - 1);
    const FL = (MSr / MSw) / qf(1 - alpha / 2, df1, df2), FU = (MSr / MSw) * qf(1 - alpha / 2, df2, df1);
    if (unit === 'single') {
      value = (MSr - MSw) / (MSr + (nr - 1) * MSw);
      F = MSr / MSw * ((1 - r0) / (1 + (nr - 1) * r0));
      lower = (FL - 1) / (FL + (nr - 1)); upper = (FU - 1) / (FU + (nr - 1));
    } else {
      value = (MSr - MSw) / MSr;
      F = MSr / MSw * (1 - r0);
      lower = 1 - 1 / FL; upper = 1 - 1 / FU;
    }
  } else if (type === 'consistency') {
    df2 = (ns - 1) * (nr - 1);
    const FL = (MSr / MSe) / qf(1 - alpha / 2, df1, df2), FU = (MSr / MSe) * qf(1 - alpha / 2, df2, df1);
    if (unit === 'single') {
      value = (MSr - MSe) / (MSr + (nr - 1) * MSe);
      F = MSr / MSe * ((1 - r0) / (1 + (nr - 1) * r0));
      lower = (FL - 1) / (FL + (nr - 1)); upper = (FU - 1) / (FU + (nr - 1));
    } else {
      value = (MSr - MSe) / MSr;
      F = MSr / MSe * (1 - r0);
      lower = 1 - 1 / FL; upper = 1 - 1 / FU;
    }
  } else if (unit === 'single') {
    value = (MSr - MSe) / (MSr + (nr - 1) * MSe + (nr / ns) * (MSc - MSe));
    const a = (nr * r0) / (ns * (1 - r0)), b = 1 + (nr * r0 * (ns - 1)) / (ns * (1 - r0));
    F = MSr / (a * MSc + b * MSe);
    df2 = agreementDf(value);
    [lower, upper] = agreementBounds(df2);
  } else {
    value = (MSr - MSe) / (MSr + (MSc - MSe) / ns);
    const a = r0 / (ns * (1 - r0)), b = 1 + (r0 * (ns - 1)) / (ns * (1 - r0));
    F = MSr / (a * MSc + b * MSe);
    // irr derives the df and the interval from the single-rater coefficient, then steps both bounds up
    const single = (MSr - MSe) / (MSr + (nr - 1) * MSe + (nr / ns) * (MSc - MSe));
    df2 = agreementDf(single);
    const [lb, ub] = agreementBounds(df2);
    lower = lb * nr / (1 + lb * (nr - 1)); upper = ub * nr / (1 + ub * (nr - 1));
  }
  const pValue = pf(F, df1, df2, false);
  const label = model === 'oneway' ? '' : type === 'agreement' ? 'A,' : 'C,';
  const shape = model === 'oneway' ? `ICC(1,${unit === 'single' ? 1 : 'k'})` : `ICC(${label}${unit === 'single' ? 1 : 'k'})`;
  return {
    method: `${unit === 'single' ? 'Single Score' : 'Average Score'} Intraclass Correlation`,
    model, type: model === 'oneway' ? 'agreement' : type, unit, form: shape,
    subjects: ns, raters: nr, value, r0, F, df1, df2, pValue, conf, lower, upper,
    meanSquares: { rows: MSr, within: MSw, columns: MSc, error: MSe },
  };
}

/** Every ICC form for one matrix, as a table (one row per form). */
export function iccAll(matrix, { r0 = 0, conf = 0.95 } = {}) {
  const rows = ICC_FORMS.map(([model, type, unit]) => icc(matrix, { model, type, unit, r0, conf }));
  return {
    method: 'Intraclass correlations, all forms (McGraw & Wong 1996)',
    subjects: rows[0].subjects, raters: rows[0].raters, conf,
    rows: rows.map(r => ({ form: r.form, model: r.model, type: r.type, unit: r.unit, value: r.value, F: r.F, df1: r.df1, df2: r.df2, pValue: r.pValue, lower: r.lower, upper: r.upper })),
  };
}

// ---- noncentral t, for the exact limits-of-agreement interval ----------------------

/**
 * P(T ≤ t) for a noncentral t with `df` degrees of freedom and noncentrality
 * `ncp`, by integrating Φ(t·√(V/df) − ncp) over V ~ χ²(df) on a log grid
 * (composite Simpson). Accurate to about 1e-10 for the df used here.
 */
function ptnc(t, df, ncp) {
  // V = e^y; density of y is f_χ²(e^y)·e^y
  const logConst = -(df / 2) * Math.LN2 - lgammaHalf(df);
  const g = y => { const v = Math.exp(y); return Math.exp(logConst + (df / 2) * y - v / 2) * pnorm(t * Math.sqrt(v / df) - ncp); };
  const lo = Math.log(df) - 40 / Math.sqrt(df) - 20, hi = Math.log(df + 40 * Math.sqrt(2 * df) + 60);
  const m = 4000, h = (hi - lo) / m;
  let s = g(lo) + g(hi);
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * g(lo + i * h);
  return s * h / 3;
}
/** log Γ(df/2), exact recursion for half-integers and integers. */
function lgammaHalf(df) {
  // Γ(n/2): Γ(1) = 1, Γ(1/2) = √π, Γ(x + 1) = x Γ(x)
  let x = df / 2, acc = 0;
  if (Number.isInteger(df)) {
    while (x > 1) { x -= 1; acc += Math.log(x); }
    return acc + (x === 0.5 ? 0.5 * Math.log(Math.PI) : 0);
  }
  // fractional df: Stirling series (not reached by the callers here)
  x = df / 2;
  let shift = 0; while (x < 8) { shift += Math.log(x); x += 1; }
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x) - 1 / (360 * x ** 3) + 1 / (1260 * x ** 5) - shift;
}
function qtnc(p, df, ncp) {
  let lo = ncp - 10, hi = ncp + 10;
  while (ptnc(lo, df, ncp) > p) lo -= Math.max(10, Math.abs(lo));
  while (ptnc(hi, df, ncp) < p) hi += Math.max(10, Math.abs(hi));
  return bisect(t => ptnc(t, df, ncp) - p, lo, hi);
}

// ---- Bland–Altman -------------------------------------------------------------------

function slr(x, y) {
  const n = x.length, mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const rss = sum(y.map((v, i) => (v - intercept - slope * x[i]) ** 2));
  const df = n - 2, se = df > 0 ? Math.sqrt(rss / df / sxx) : NaN, t = slope / se;
  return { intercept, slope, se, t, df, pValue: df > 0 ? 2 * pt(-Math.abs(t), df) : NaN };
}

/**
 * Bland–Altman analysis of two methods measured once on the same subjects.
 * Differences are x − y. The limits of agreement are bias ± z·s with z =
 * qnorm(1 − (1 − `coverage`)/2) (1.959964 for 95%; pass `z: 1.96` for the
 * rounded multiplier). The bias interval is the exact t interval. Two
 * intervals are returned for each limit: 'approximate', Bland & Altman's
 * (1986, 1999) SE = √(3s²/n) with a t quantile, and 'exact', the
 * tolerance-factor interval from noncentral t quantiles (Carkeet 2015);
 * `loaMethod` picks which one fills lowerCI/upperCI and defaults to 'exact'.
 * With `ratio: true` the analysis runs on log(x) − log(y) and every estimate
 * is back-transformed to a ratio x / y. Proportional bias is the regression
 * of the difference on the mean of the pair.
 */
export function blandAltman(x, y, { ratio = false, conf = 0.95, coverage = 0.95, z = null, loaMethod = 'exact' } = {}) {
  check(Array.isArray(x) && Array.isArray(y) && x.length === y.length, 'x and y must be arrays of equal length');
  check(['exact', 'approximate'].includes(loaMethod), `loaMethod must be 'exact' or 'approximate'`);
  const pairs = x.map((v, i) => [v, y[i]]).filter(([a, b]) => !isMissing(a) && !isMissing(b)).map(([a, b]) => [Number(a), Number(b)]);
  const n = pairs.length;
  check(n >= 3, 'Bland–Altman needs at least three complete pairs');
  if (ratio) check(pairs.every(([a, b]) => a > 0 && b > 0), 'ratio analysis needs positive values');
  const t = ratio ? Math.log : v => v;
  const d = pairs.map(([a, b]) => t(a) - t(b));
  const m = pairs.map(([a, b]) => (t(a) + t(b)) / 2);
  const bias = mean(d), sd = Math.sqrt(variance(d)), df = n - 1;
  const zz = z ?? zOf(coverage);
  const tq = qt(1 - (1 - conf) / 2, df);
  const seBias = sd / Math.sqrt(n);
  const lower = bias - zz * sd, upper = bias + zz * sd;
  // approximate: SE of a limit ≈ √(3 s² / n)
  const seLoa = Math.sqrt(3 * sd * sd / n);
  const approximate = { se: seLoa, lower: [lower - tq * seLoa, lower + tq * seLoa], upper: [upper - tq * seLoa, upper + tq * seLoa] };
  // exact: the limit bias + zz·s is a normal quantile; its CI uses noncentral t with ncp zz·√n
  const ncp = zz * Math.sqrt(n), a = 1 - conf;
  const kLo = qtnc(a / 2, df, ncp) / Math.sqrt(n), kHi = qtnc(1 - a / 2, df, ncp) / Math.sqrt(n);
  const exact = { lower: [bias - kHi * sd, bias - kLo * sd], upper: [bias + kLo * sd, bias + kHi * sd] };
  const chosen = loaMethod === 'exact' ? exact : approximate;
  const back = ratio ? Math.exp : v => v;
  const backPair = p => p.map(back);
  const reg = slr(m, d);
  return {
    method: `Bland-Altman limits of agreement${ratio ? ' (ratio, log scale)' : ''}`,
    n, ratio, conf, coverage, z: zz, loaMethod,
    bias: back(bias), biasCI: backPair([bias - tq * seBias, bias + tq * seBias]), seBias,
    sd, lower: back(lower), upper: back(upper),
    lowerCI: backPair(chosen.lower), upperCI: backPair(chosen.upper),
    loaCI: {
      approximate: { se: seLoa, lower: backPair(approximate.lower), upper: backPair(approximate.upper) },
      exact: { lower: backPair(exact.lower), upper: backPair(exact.upper), factors: [kLo, kHi] },
    },
    biasTest: { t: bias / seBias, df, pValue: 2 * pt(-Math.abs(bias / seBias), df) },
    proportionalBias: reg,
    scale: ratio ? 'log' : 'identity',
    points: pairs.map((p, i) => ({ x: p[0], y: p[1], mean: ratio ? (p[0] + p[1]) / 2 : m[i], diff: ratio ? p[0] / p[1] : d[i] })),
  };
}

/**
 * Bland–Altman limits with several paired observations per subject, where
 * the true value may change between a subject's observations (Bland &
 * Altman 2007, §3). A one-way ANOVA of the differences on subject gives the
 * within-subject mean square MSw and between-subject MSb; the between-subject
 * variance of differences is (MSb − MSw) / λ with λ = (N² − Σmᵢ²) / ((n − 1)N),
 * set to 0 when negative, and the total variance is that plus MSw. Bias is the
 * mean of all N differences. No interval is given for the limits (see Zou
 * 2013 for a MOVER interval, not built).
 */
export function blandAltmanRepeated(subjects, x, y, { coverage = 0.95, z = null } = {}) {
  check(subjects.length === x.length && x.length === y.length, 'subjects, x and y must have equal length');
  const groups = new Map();
  const points = [];
  for (let i = 0; i < x.length; i++) {
    if (isMissing(x[i]) || isMissing(y[i]) || subjects[i] == null) continue;
    const d = Number(x[i]) - Number(y[i]);
    if (!groups.has(subjects[i])) groups.set(subjects[i], []);
    groups.get(subjects[i]).push(d);
    points.push({ subject: subjects[i], x: Number(x[i]), y: Number(y[i]), mean: (Number(x[i]) + Number(y[i])) / 2, diff: d });
  }
  const g = [...groups.values()], n = g.length, N = sum(g.map(a => a.length));
  check(n >= 2 && N > n, 'repeated Bland–Altman needs at least two subjects and some subject with two or more pairs');
  const all = g.flat(), bias = mean(all);
  const ssb = sum(g.map(a => a.length * (mean(a) - bias) ** 2));
  const ssw = sum(g.map(a => { const ma = mean(a); return sum(a.map(v => (v - ma) ** 2)); }));
  const MSb = ssb / (n - 1), MSw = ssw / (N - n);
  const lambda = (N * N - sum(g.map(a => a.length ** 2))) / ((n - 1) * N);
  const betweenVar = Math.max(0, (MSb - MSw) / lambda);
  const totalVar = betweenVar + MSw, sd = Math.sqrt(totalVar);
  const zz = z ?? zOf(coverage);
  return {
    method: 'Bland-Altman limits of agreement, multiple observations per subject (Bland & Altman 2007)',
    subjects: n, n: N, coverage, z: zz, bias, sd,
    lower: bias - zz * sd, upper: bias + zz * sd,
    variance: { between: betweenVar, within: MSw, total: totalVar, MSb, MSw, lambda },
    points,
  };
}

// ---- Cohen's kappa (irr::kappa2) ----------------------------------------------------

function levelsOf(values, levels) {
  if (levels) return levels.slice();
  const u = [...new Set(values)];
  return u.every(v => typeof v === 'number') ? u.sort((a, b) => a - b) : u.map(String).sort();
}

function weightMatrix(k, weights) {
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => {
    if (!weights) return i === j ? 1 : 0;
    if (k === 1) return 1;
    const r = Math.abs(i - j) / (k - 1);
    return weights === 'linear' ? 1 - r : 1 - r * r;
  }));
}

/**
 * Cohen's kappa for two raters, unweighted or with 'linear' (irr "equal") or
 * 'quadratic' (irr "squared") agreement weights on the order of `levels`
 * (default: the sorted distinct values). Pairs with a missing rating are
 * dropped. `se` is the Fleiss–Cohen–Everitt (1969) large-sample SE of κ̂, used
 * for the Wald interval; `se0` is the SE under H0: κ = 0, used for z and its
 * two-sided p, as irr::kappa2 reports.
 */
export function cohenKappa(r1, r2, { weights = null, levels = null, conf = 0.95 } = {}) {
  check(r1.length === r2.length, 'r1 and r2 must have equal length');
  check([null, 'linear', 'quadratic'].includes(weights), `weights must be null, 'linear' or 'quadratic'`);
  const pairs = r1.map((v, i) => [v, r2[i]]).filter(([a, b]) => !isMissing(a) && !isMissing(b));
  const n = pairs.length;
  check(n > 0, 'no complete pairs');
  const lev = levelsOf(pairs.flat(), levels), k = lev.length;
  const idx = new Map(lev.map((l, i) => [l, i]));
  const at = v => { const i = idx.has(v) ? idx.get(v) : idx.get(String(v)); check(i != null, `rating ${v} is not among the levels`); return i; };
  const table = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) table[at(a)][at(b)]++;
  const w = weightMatrix(k, weights);
  const p = table.map(r => r.map(c => c / n));
  const pr = p.map(sum), pc = lev.map((_, j) => sum(p.map(r => r[j])));
  let po = 0, pe = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { po += w[i][j] * p[i][j]; pe += w[i][j] * pr[i] * pc[j]; }
  const kappa = pe === 1 ? null : (po - pe) / (1 - pe);
  // w̄ᵢ. = Σⱼ p.ⱼ wᵢⱼ ; w̄.ⱼ = Σᵢ pᵢ. wᵢⱼ
  const wi = lev.map((_, i) => sum(lev.map((__, j) => pc[j] * w[i][j])));
  const wj = lev.map((_, j) => sum(lev.map((__, i) => pr[i] * w[i][j])));
  let se = null, se0 = null;
  if (kappa != null) {
    let a = 0, b = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      a += p[i][j] * (w[i][j] - (wi[i] + wj[j]) * (1 - kappa)) ** 2;
      b += pr[i] * pc[j] * (w[i][j] - (wi[i] + wj[j])) ** 2;
    }
    const d = n * (1 - pe) ** 2;
    se = Math.sqrt(Math.max(0, (a - (kappa - pe * (1 - kappa)) ** 2) / d));
    se0 = Math.sqrt(Math.max(0, (b - pe * pe) / d));
  }
  const zc = zOf(conf);
  const zv = kappa != null && se0 > 0 ? kappa / se0 : null;
  return {
    method: `Cohen's Kappa for 2 Raters (Weights: ${weights === 'linear' ? 'equal' : weights === 'quadratic' ? 'squared' : 'unweighted'})`,
    subjects: n, raters: 2, levels: lev, weights, table,
    po, pe, kappa, se, se0, conf,
    lower: kappa != null && se != null ? kappa - zc * se : null,
    upper: kappa != null && se != null ? kappa + zc * se : null,
    z: zv, pValue: zv == null ? null : 2 * pnorm(-Math.abs(zv)),
  };
}

// ---- Fleiss' kappa (irr::kappam.fleiss) ---------------------------------------------

/**
 * Fleiss' kappa for m raters. `data` is either subject × category counts
 * (`{ counts: [[…], …] }` or a matrix with `counts: true`) with the same row
 * total for every subject, or raw ratings (subjects × raters, complete rows
 * only). SEs are Fleiss, Nee & Landis (1979) under H0: κ = 0, as irr reports;
 * the interval uses that SE and is only a guide away from 0.
 */
export function fleissKappa(data, { counts = false, levels = null, conf = 0.95 } = {}) {
  let cats, n;
  if (counts) {
    n = data.map(r => r.map(Number));
    cats = levels || n[0].map((_, j) => j);
  } else {
    const rows = data.filter(r => r.every(v => !isMissing(v)));
    cats = levelsOf(rows.flat(), levels);
    const idx = new Map(cats.map((c, i) => [c, i]));
    n = rows.map(r => { const c = new Array(cats.length).fill(0); for (const v of r) { const i = idx.has(v) ? idx.get(v) : idx.get(String(v)); check(i != null, `rating ${v} is not among the levels`); c[i]++; } return c; });
  }
  const N = n.length, m = sum(n[0]), k = cats.length;
  check(N >= 1 && m >= 2, 'Fleiss kappa needs at least two ratings per subject');
  check(n.every(r => sum(r) === m), 'every subject must have the same number of ratings');
  const pj = cats.map((_, j) => sum(n.map(r => r[j])) / (N * m));
  const Pi = n.map(r => (sum(r.map(c => c * c)) - m) / (m * (m - 1)));
  const Pbar = mean(Pi), Pe = sum(pj.map(v => v * v));
  const kappa = (Pbar - Pe) / (1 - Pe);
  const pq = pj.map(p => p * (1 - p)), spq = sum(pq);
  const se = Math.sqrt(2) / (spq * Math.sqrt(N * m * (m - 1))) * Math.sqrt(spq ** 2 - sum(pj.map((p, j) => pq[j] * (1 - 2 * p))));
  const seJ = Math.sqrt(2 / (N * m * (m - 1)));
  const zc = zOf(conf), zv = kappa / se;
  const byCategory = cats.map((c, j) => {
    const kj = 1 - sum(n.map(r => r[j] * (m - r[j]))) / (N * m * (m - 1) * pq[j]);
    const zj = kj / seJ;
    return { category: c, p: pj[j], kappa: kj, se: seJ, z: zj, pValue: 2 * pnorm(-Math.abs(zj)) };
  });
  return {
    method: `Fleiss' Kappa for m Raters`,
    subjects: N, raters: m, categories: cats, po: Pbar, pe: Pe, kappa, se, conf,
    lower: kappa - zc * se, upper: kappa + zc * se, z: zv, pValue: 2 * pnorm(-Math.abs(zv)),
    byCategory,
  };
}

// ---- Gwet's AC1 ---------------------------------------------------------------------

/**
 * Gwet's AC1 for two raters (Gwet 2008): chance agreement is
 * Σ πₖ(1 − πₖ) / (q − 1), πₖ the mean of the two raters' marginal shares.
 * The SE is Gwet's (2008, eq. 28) with no finite-population correction.
 */
export function gwetAC1(r1, r2, { levels = null, conf = 0.95 } = {}) {
  const ck = cohenKappa(r1, r2, { levels });
  const { table, subjects: n, levels: lev } = ck, q = lev.length;
  check(q >= 2, 'AC1 needs at least two categories');
  const p = table.map(r => r.map(c => c / n));
  const pr = p.map(sum), pc = lev.map((_, j) => sum(p.map(r => r[j])));
  const pi = lev.map((_, k) => (pr[k] + pc[k]) / 2);
  const pa = sum(lev.map((_, k) => p[k][k]));
  const pe = sum(pi.map(v => v * (1 - v))) / (q - 1);
  const ac1 = (pa - pe) / (1 - pe);
  let s1 = 0, s2 = 0;
  for (let k = 0; k < q; k++) {
    s1 += p[k][k] * (1 - pi[k]);
    for (let l = 0; l < q; l++) s2 += p[k][l] * (1 - (pi[k] + pi[l]) / 2) ** 2;
  }
  s1 /= q - 1; s2 /= (q - 1) ** 2;
  const v = (pa * (1 - pa) - 4 * (1 - ac1) * (s1 - pa * pe) + 4 * (1 - ac1) ** 2 * (s2 - pe * pe)) / (n * (1 - pe) ** 2);
  const se = Math.sqrt(Math.max(0, v)), zc = zOf(conf), zv = se > 0 ? ac1 / se : null;
  return {
    method: "Gwet's AC1 for 2 Raters", subjects: n, raters: 2, levels: lev,
    po: pa, pe, ac1, se, conf, lower: ac1 - zc * se, upper: ac1 + zc * se,
    z: zv, pValue: zv == null ? null : 2 * pnorm(-Math.abs(zv)),
  };
}

// ---- Krippendorff's alpha (irr::kripp.alpha) ----------------------------------------

/**
 * Krippendorff's alpha from a coincidence matrix. `data` has units in rows
 * and coders in columns (the transpose of irr::kripp.alpha's layout, to
 * match the rest of this module); missing values are allowed and units with
 * fewer than two values are not pairable and are left out. Levels: 'nominal',
 * 'ordinal' (rank distance on the pooled value frequencies), 'interval',
 * 'ratio'. No interval (Krippendorff's bootstrap is not built).
 */
export function krippendorffAlpha(data, level = 'nominal') {
  check(['nominal', 'ordinal', 'interval', 'ratio'].includes(level), `level must be nominal, ordinal, interval or ratio`);
  const units = data.map(r => r.filter(v => !isMissing(v))).filter(r => r.length >= 2);
  check(units.length, 'no pairable units');
  const vals = levelsOf(units.flat(), null), k = vals.length;
  const idx = new Map(vals.map((v, i) => [v, i]));
  const o = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const u of units) {
    const mu = u.length;
    for (let i = 0; i < mu; i++) for (let j = 0; j < mu; j++) if (i !== j) o[idx.get(u[i])][idx.get(u[j])] += 1 / (mu - 1);
  }
  const nc = o.map(sum), n = sum(nc);
  const num = v => Number(v);
  const delta2 = (c, kk) => {
    if (c === kk) return 0;
    if (level === 'nominal') return 1;
    if (level === 'interval') return (num(vals[c]) - num(vals[kk])) ** 2;
    if (level === 'ratio') { const a = num(vals[c]), b = num(vals[kk]); return ((a - b) / (a + b)) ** 2; }
    const [lo, hi] = c < kk ? [c, kk] : [kk, c];
    let s = 0; for (let g = lo; g <= hi; g++) s += nc[g];
    return (s - (nc[c] + nc[kk]) / 2) ** 2;
  };
  let Do = 0, De = 0;
  for (let c = 0; c < k; c++) for (let kk = 0; kk < k; kk++) { const d = delta2(c, kk); Do += o[c][kk] * d; De += nc[c] * nc[kk] * d; }
  const alpha = De === 0 ? null : 1 - (n - 1) * Do / De;
  return {
    method: `Krippendorff's alpha`, level, units: units.length, pairableValues: n,
    values: vals, coincidence: o, observedDisagreement: Do / n, expectedDisagreement: De / (n * (n - 1)), alpha,
  };
}

// ---- percent agreement (irr::agree) -------------------------------------------------

/**
 * Share of subjects on which every rater gave the same value (numeric values
 * within `tolerance` of each other count as the same, as irr::agree).
 * Incomplete rows are dropped.
 */
export function percentAgreement(matrix, { tolerance = 0 } = {}) {
  const rows = matrix.filter(r => r.every(v => !isMissing(v)));
  check(rows.length, 'no complete subjects');
  const same = rows.filter(r => tolerance > 0
    ? Math.max(...r.map(Number)) - Math.min(...r.map(Number)) <= tolerance
    : r.every(v => v === r[0])).length;
  return {
    method: `Percentage agreement (Tolerance=${tolerance})`,
    subjects: rows.length, raters: rows[0].length, agreed: same, proportion: same / rows.length, percent: 100 * same / rows.length,
  };
}

// ---- Cronbach's alpha ---------------------------------------------------------------

function alphaOf(items) {
  const k = items[0].length;
  const itemVar = sum(Array.from({ length: k }, (_, j) => variance(items.map(r => r[j]))));
  const totalVar = variance(items.map(sum));
  return k / (k - 1) * (1 - itemVar / totalVar);
}

/**
 * Cronbach's alpha for a subjects × items matrix (complete rows only), with
 * Feldt's (1965) F-based interval: [1 − (1 − α̂)F(1 − γ/2), 1 − (1 − α̂)F(γ/2)]
 * on n − 1 and (n − 1)(k − 1) df. Alpha if each item is deleted and the
 * corrected item–total correlation (item against the sum of the others).
 * McDonald's omega is not built: it needs a factor analysis.
 */
export function cronbachAlpha(matrix, { conf = 0.95 } = {}) {
  const items = completeRows(matrix);
  const n = items.length, k = items[0]?.length || 0;
  check(n >= 2 && k >= 2, 'Cronbach alpha needs at least two subjects and two items');
  const alpha = alphaOf(items);
  const df1 = n - 1, df2 = (n - 1) * (k - 1), g = 1 - conf;
  const lower = 1 - (1 - alpha) * qf(1 - g / 2, df1, df2);
  const upper = 1 - (1 - alpha) * qf(g / 2, df1, df2);
  const itemStats = Array.from({ length: k }, (_, j) => {
    const col = items.map(r => r[j]), rest = items.map(r => sum(r) - r[j]);
    const others = items.map(r => r.filter((_, c) => c !== j));
    return {
      item: j, mean: mean(col), sd: Math.sqrt(variance(col)),
      correctedItemTotal: cor(col, rest),
      alphaIfDeleted: k > 2 ? alphaOf(others) : null,
    };
  });
  return {
    method: "Cronbach's alpha (Feldt interval)", subjects: n, items: k,
    alpha, conf, lower, upper, df1, df2, itemStats,
  };
}

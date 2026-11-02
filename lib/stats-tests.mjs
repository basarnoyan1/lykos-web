// Classical hypothesis tests, effect sizes and interval estimates for one
// numeric variable, in plain JavaScript.
//
// Each function follows the R function it is named after (stats::t.test,
// oneway.test, aov + TukeyHSD, bartlett.test, car::leveneTest, wilcox.test,
// kruskal.test, friedman.test, binom.test, shapiro.test, nortest::ad.test,
// p.adjust) and reports the `method` line R prints. The results are checked in
// test/stats-tests.test.mjs against R's documented outputs on the sleep,
// PlantGrowth, mtcars and RoundingTimes data, and against identities that
// recompute them independently (Student t² = one-way F, Tukey and
// Games-Howell with two groups = Student and Welch t).
//
// Inputs are arrays of numbers; null, '' and non-finite entries are ignored and
// the n actually used is reported. Functions return null when there is not
// enough data for the test to be defined.

import { pt, qt, pnorm, qnorm, pchisq, pbeta } from './dist.mjs';
import { quantile, kruskalWallis } from './describe.mjs';

// ---- small helpers ---------------------------------------------------------

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];
function lgam(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgam(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const isVal = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const clean = xs => (xs || []).filter(isVal).map(Number);
/** Complete pairs only, as R's paired tests. */
function pairs(x, y) {
  const a = [], b = [];
  const n = Math.min(x?.length || 0, y?.length || 0);
  for (let i = 0; i < n; i++) if (isVal(x[i]) && isVal(y[i])) { a.push(Number(x[i])); b.push(Number(y[i])); }
  return [a, b];
}
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => sum(xs) / xs.length;
function variance(xs) {
  const m = mean(xs);
  return xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1);
}
const sortNum = xs => [...xs].sort((a, b) => a - b);
const med = xs => quantile(sortNum(xs), 0.5);
const alphaOf = conf => 1 - (conf ?? 0.95);

/** Upper normal tail 1 - Φ(z), accurate far into the tail. */
function normUpper(z) {
  if (z < 0) return 1 - normUpper(-z);
  const x = z * z / 2;
  if (x < 1.5) return 1 - pnorm(z);
  // Q(1/2, x) by Lentz's continued fraction
  const TINY = 1e-300, s = 0.5;
  let b = x + 1 - s, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 0.5 * h * Math.exp(-x + s * Math.log(x) - 0.5 * Math.log(Math.PI));
}
const twoSidedZ = z => Math.min(1, 2 * normUpper(Math.abs(z)));
const twoSidedT = (t, df) => Math.min(1, 2 * pt(-Math.abs(t), df));

/** Mid-ranks and the sizes of tied runs. */
function rank(xs) {
  const n = xs.length;
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(n), ties = [];
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = mid;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks: r, ties };
}
const tieSum = ties => ties.reduce((a, t) => a + t ** 3 - t, 0);

function bisect(f, lo, hi, iters = 200) {
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const m = (lo + hi) / 2, fm = f(m);
    if (fm === 0) return m;
    if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
    if (hi - lo <= 1e-14 * Math.max(1, Math.abs(m))) break;
  }
  return (lo + hi) / 2;
}

/** Binomial(n, 1/2) cumulative P(X ≤ k). */
function pbinomHalf(k, n) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  const base = lgam(n + 1) - n * Math.LN2;
  for (let i = 0; i <= k; i++) s += Math.exp(base - lgam(i + 1) - lgam(n - i + 1));
  return Math.min(1, s);
}

function cleanGroups(groups) {
  return (groups || [])
    .map((g, i) => ({ name: g.name ?? `Group ${i + 1}`, values: clean(g.values) }))
    .filter(g => g.values.length);
}

// ---- distributions not in dist.mjs -------------------------------------------

/** F distribution P(F ≤ f); `lower = false` for the upper tail. */
export function pf(f, d1, d2, lower = true) {
  if (!(f > 0)) return lower ? 0 : 1;
  if (f === Infinity) return lower ? 1 : 0;
  // upper tail through the complementary beta keeps small p-values accurate
  const up = pbeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
  return lower ? 1 - up : up;
}
export function qf(p, d1, d2) {
  if (p <= 0) return 0;
  let hi = 10;
  while (pf(hi, d1, d2) < p) hi *= 2;
  return bisect(f => pf(f, d1, d2) - p, 0, hi);
}

/** Noncentral t P(T ≤ t; df, ncp), by R's pnt (Lenth 1989, AS 243). */
export function pnt(t, df, ncp) {
  if (ncp === 0) return pt(t, df);
  if (!Number.isFinite(t)) return t < 0 ? 0 : 1;
  let negdel, tt, del;
  if (t >= 0) { negdel = false; tt = t; del = ncp; }
  else { if (ncp > 40) return 0; negdel = true; tt = -t; del = -ncp; }
  if (df > 4e5 || del * del > 2 * Math.LN2 * 1021) {
    const s = 1 / (4 * df);
    const z = (tt * (1 - s) - del) / Math.sqrt(1 + tt * tt * 2 * s);
    return negdel ? 1 - pnorm(z) : pnorm(z);
  }
  const x0 = t * t, x = x0 / (x0 + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda);
    let q = Math.sqrt(2 / Math.PI) * p * del;
    let s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda);
    let a = 0.5;
    const b = 0.5 * df;
    const rxb = Math.pow(1 - x, b);
    const albeta = 0.5 * Math.log(Math.PI) + lgam(b) - lgam(0.5 + b);
    let xodd = pbeta(x, a, b);
    let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
    let tn = b * x;
    let xeven = tn < Number.EPSILON ? tn : 1 - rxb;
    let geven = tn * rxb;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 1000; it++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= x * (a + b - 1) / a;
      geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * it);
      q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      if (s < -1e-10) break;
      if (s <= 0 && it > 1) break;
      if (Math.abs(2 * s * (xodd - godd)) < 1e-12) break;
    }
  }
  tnc += pnorm(-del);
  tnc = Math.min(tnc, 1);
  return negdel ? 1 - tnc : tnc;
}

// Gauss–Legendre nodes on [-1, 1], computed once.
const GL = (() => {
  const n = 20, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();
function integrate(f, a, b, panels) {
  const h = (b - a) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const c = a + (p + 0.5) * h;
    for (let i = 0; i < GL.x.length; i++) s += GL.w[i] * f(c + GL.x[i] * h / 2);
  }
  return s * h / 2;
}

// Φ from a table and its Taylor series (Hermite polynomials), for the
// studentized range, where it is evaluated a few hundred thousand times.
const PHI_STEP = 0.01, PHI_MAX = 9;
let PHI_TABLE = null;
function Phi(x) {
  if (x <= -PHI_MAX) return normUpper(-x);
  if (x >= PHI_MAX) return 1;
  if (!PHI_TABLE) {
    PHI_TABLE = [];
    for (let i = 0; i <= 2 * PHI_MAX / PHI_STEP; i++) PHI_TABLE.push(normUpper(PHI_MAX - i * PHI_STEP));
  }
  const i = Math.round((x + PHI_MAX) / PHI_STEP), a = -PHI_MAX + i * PHI_STEP, h = x - a;
  const phi = Math.exp(-a * a / 2) / Math.sqrt(2 * Math.PI);
  // Φ(a+h) = Φ(a) + φ(a) Σ (-1)^n He_n(a) h^(n+1)/(n+1)!
  let hePrev = 1, he = a, s = h, term = h;
  for (let n = 1; n <= 9; n++) {
    term *= h / (n + 1);
    s += (n % 2 ? -1 : 1) * he * term;
    const next = a * he - n * hePrev;
    hePrev = he; he = next;
  }
  return PHI_TABLE[i] + phi * s;
}

/** P(range of k standard normals < w). */
function rangeCdf(w, k) {
  if (w <= 0) return 0;
  const c = k / Math.sqrt(2 * Math.PI);
  return Math.min(1, c * integrate(z => {
    const d = Phi(z) - Phi(z - w);
    return d > 0 ? Math.exp(-z * z / 2) * d ** (k - 1) : 0;
  }, -8.5, 8.5, 12));
}

/**
 * Studentized range P(Q ≤ q; k groups, df), by direct numerical integration of
 * the range distribution over the distribution of s (Gauss–Legendre).
 */
export function ptukey(q, k, df) {
  if (!(q > 0)) return 0;
  if (!Number.isFinite(df)) return rangeCdf(q, k);
  // integrate over t = log s; s = sqrt(chi²_df / df)
  const c = Math.LN2 + (df / 2) * Math.log(df / 2) - lgam(df / 2);
  const logg = t => c + df * t - df * Math.exp(2 * t) / 2;
  const top = logg(0);
  const lo = bisect(t => logg(t) - top + 45, -200, 0);
  const hi = bisect(t => top - 45 - logg(t), 0, 10);
  return Math.min(1, integrate(t => Math.exp(logg(t)) * rangeCdf(q * Math.exp(t), k), lo, hi, 12));
}
export function qtukey(p, k, df) {
  let hi = 8;
  while (ptukey(hi, k, df) < p) hi *= 2;
  // Illinois (regula falsi) on the bracket
  let a = 0, fa = -p, b = hi, fb = ptukey(hi, k, df) - p, side = 0, c = b;
  for (let i = 0; i < 80; i++) {
    c = (a * fb - b * fa) / (fb - fa);
    const fc = ptukey(c, k, df) - p;
    if (Math.abs(fc) < 1e-12 || Math.abs(b - a) < 1e-10 * c) break;
    if ((fc > 0) === (fb > 0)) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
    else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
  }
  return c;
}

// ---- effect sizes ----------------------------------------------------------

/** Exact small-sample correction J(df) that turns Cohen's d into Hedges' g. */
const hedgesJ = df => Math.exp(lgam(df / 2) - 0.5 * Math.log(df / 2) - lgam((df - 1) / 2));

/** Noncentrality parameters bracketing an observed t at the given confidence. */
function ncpInterval(t, df, conf) {
  const a = alphaOf(conf);
  const w = 10 + 2 * Math.abs(t);
  const lo = bisect(ncp => pnt(t, df, ncp) - (1 - a / 2), t - w, t + w);
  const hi = bisect(ncp => pnt(t, df, ncp) - a / 2, t - w, t + w);
  return [lo, hi];
}
/** Cohen's d and Hedges' g from a t statistic; `scale` turns ncp into d. */
function effectSizes(d, t, df, scale, conf) {
  const [l, u] = ncpInterval(t, df, conf);
  const J = hedgesJ(df);
  const ci = [l * scale, u * scale];
  return {
    cohensD: { estimate: d, ci, method: 'noncentral t' },
    hedgesG: { estimate: d * J, ci: ci.map(v => v * J), method: 'noncentral t; exact gamma-function correction' },
  };
}

// ---- t tests ---------------------------------------------------------------

/** One-sample t test of H0: mean = mu (R t.test(x, mu = mu)). */
export function tTestOne(x, { mu = 0, conf = 0.95 } = {}) {
  const xs = clean(x), n = xs.length;
  if (n < 2) return null;
  const m = mean(xs), sd = Math.sqrt(variance(xs)), se = sd / Math.sqrt(n), df = n - 1;
  const t = (m - mu) / se, h = qt(1 - alphaOf(conf) / 2, df) * se;
  return {
    method: 'One Sample t-test', n, missing: (x?.length || 0) - n, mu,
    estimate: m, ci: [m - h, m + h], conf, difference: m - mu, se, sd,
    statistic: t, df, p: twoSidedT(t, df),
    ...effectSizes((m - mu) / sd, t, df, 1 / Math.sqrt(n), conf),
  };
}

/**
 * Two-sample t test of mean(x) - mean(y) (R t.test(x, y)). Welch by default;
 * Student with `equalVar`. Cohen's d uses the pooled SD in both cases, and its
 * interval inverts the noncentral t of the pooled-variance statistic.
 */
export function tTestTwo(x, y, { equalVar = false, conf = 0.95 } = {}) {
  const xs = clean(x), ys = clean(y), nx = xs.length, ny = ys.length;
  if (nx < 2 || ny < 2) return null;
  const mx = mean(xs), my = mean(ys), vx = variance(xs), vy = variance(ys);
  const dfPool = nx + ny - 2;
  const vp = ((nx - 1) * vx + (ny - 1) * vy) / dfPool;
  const sePool = Math.sqrt(vp * (1 / nx + 1 / ny));
  let se, df;
  if (equalVar) { se = sePool; df = dfPool; }
  else {
    const a = vx / nx, b = vy / ny;
    se = Math.sqrt(a + b);
    df = (a + b) ** 2 / (a * a / (nx - 1) + b * b / (ny - 1));
  }
  const diff = mx - my, t = diff / se, h = qt(1 - alphaOf(conf) / 2, df) * se;
  return {
    method: equalVar ? 'Two Sample t-test' : 'Welch Two Sample t-test',
    n: [nx, ny], missing: [(x?.length || 0) - nx, (y?.length || 0) - ny],
    means: [mx, my], estimate: diff, ci: [diff - h, diff + h], conf, se,
    statistic: t, df, p: twoSidedT(t, df),
    ...effectSizes(diff / Math.sqrt(vp), diff / sePool, dfPool, Math.sqrt(1 / nx + 1 / ny), conf),
  };
}

/** Paired t test on x - y over complete pairs (R t.test(x, y, paired = TRUE)). Cohen's d is d_z. */
export function tTestPaired(x, y, { conf = 0.95 } = {}) {
  const [a, b] = pairs(x, y);
  const d = a.map((v, i) => v - b[i]), n = d.length;
  if (n < 2) return null;
  const m = mean(d), sd = Math.sqrt(variance(d)), se = sd / Math.sqrt(n), df = n - 1;
  const t = m / se, h = qt(1 - alphaOf(conf) / 2, df) * se;
  return {
    method: 'Paired t-test', n, missing: Math.max(x?.length || 0, y?.length || 0) - n,
    estimate: m, ci: [m - h, m + h], conf, se, sd,
    statistic: t, df, p: twoSidedT(t, df),
    ...effectSizes(m / sd, t, df, 1 / Math.sqrt(n), conf),
  };
}

// ---- one-way ANOVA and variances ---------------------------------------------

function oneWayCore(gs) {
  const k = gs.length, all = gs.flatMap(g => g.values), N = all.length;
  const grand = mean(all);
  const ssb = sum(gs.map(g => g.values.length * (mean(g.values) - grand) ** 2));
  const ssw = sum(gs.map(g => { const m = mean(g.values); return g.values.reduce((a, v) => a + (v - m) ** 2, 0); }));
  const dfb = k - 1, dfw = N - k, msb = ssb / dfb, msw = ssw / dfw, F = msb / msw;
  return { k, N, ssb, ssw, dfb, dfw, msb, msw, F, p: pf(F, dfb, dfw, false) };
}

/**
 * One-way ANOVA (R summary(aov(y ~ g))), or Welch's heteroscedastic F with
 * `welch` (R oneway.test). eta² and omega² come from the classical table.
 */
export function anovaOneWay(groups, { welch = false } = {}) {
  const gs = cleanGroups(groups);
  if (gs.length < 2) return null;
  const c = oneWayCore(gs);
  if (!(c.dfw > 0)) return null;
  const sst = c.ssb + c.ssw;
  const out = {
    method: 'One-way analysis of means',
    groups: gs.map(g => ({ name: g.name, n: g.values.length, mean: mean(g.values), sd: Math.sqrt(variance(g.values)) })),
    n: c.N,
    table: {
      between: { ss: c.ssb, df: c.dfb, ms: c.msb },
      within: { ss: c.ssw, df: c.dfw, ms: c.msw },
      total: { ss: sst, df: c.N - 1 },
    },
    statistic: c.F, df: [c.dfb, c.dfw], p: c.p,
    eta2: c.ssb / sst,
    omega2: (c.ssb - c.dfb * c.msw) / (sst + c.msw),
  };
  if (!welch) return out;
  if (gs.some(g => g.values.length < 2)) return null;
  const k = gs.length;
  const w = gs.map(g => g.values.length / variance(g.values)), sw = sum(w);
  const ms = gs.map(g => mean(g.values));
  const mw = sum(ms.map((m, i) => w[i] * m)) / sw;
  const tmp = sum(gs.map((g, i) => (1 - w[i] / sw) ** 2 / (g.values.length - 1))) / (k * k - 1);
  const F = sum(ms.map((m, i) => w[i] * (m - mw) ** 2)) / ((k - 1) * (1 + 2 * (k - 2) * tmp));
  const df2 = 1 / (3 * tmp);
  return { ...out, method: 'One-way analysis of means (not assuming equal variances)', statistic: F, df: [k - 1, df2], p: pf(F, k - 1, df2, false) };
}

/** Levene's test: ANOVA on |x - centre| (car::leveneTest; median centre is Brown–Forsythe). */
export function leveneTest(groups, { center = 'median' } = {}) {
  const gs = cleanGroups(groups);
  if (gs.length < 2) return null;
  const dev = gs.map(g => {
    const c = center === 'mean' ? mean(g.values) : med(g.values);
    return { name: g.name, values: g.values.map(v => Math.abs(v - c)) };
  });
  const c = oneWayCore(dev);
  if (!(c.dfw > 0)) return null;
  return {
    method: `Levene's Test for Homogeneity of Variance (center = ${center === 'mean' ? 'mean' : 'median'})`,
    n: c.N, statistic: c.F, df: [c.dfb, c.dfw], p: c.p,
  };
}

/** Bartlett's test of equal variances (R bartlett.test). */
export function bartlettTest(groups) {
  const gs = cleanGroups(groups).filter(g => g.values.length >= 2);
  if (gs.length < 2) return null;
  const k = gs.length, ni = gs.map(g => g.values.length - 1), vi = gs.map(g => variance(g.values));
  const nt = sum(ni), vt = sum(ni.map((n, i) => n * vi[i])) / nt;
  const K = (nt * Math.log(vt) - sum(ni.map((n, i) => n * Math.log(vi[i])))) /
    (1 + (sum(ni.map(n => 1 / n)) - 1 / nt) / (3 * (k - 1)));
  return { method: 'Bartlett test of homogeneity of variances', n: nt + k, statistic: K, df: k - 1, p: 1 - pchisq(K, k - 1) };
}

// ---- multiple comparisons --------------------------------------------------

/** R p.adjust for 'bonferroni', 'holm', 'hochberg', 'BH' (alias 'fdr') and 'BY'. Non-finite entries stay null. */
export function pAdjust(ps, method = 'holm') {
  const idx = [], vals = [];
  (ps || []).forEach((p, i) => { if (isVal(p)) { idx.push(i); vals.push(Number(p)); } });
  const n = vals.length, out = (ps || []).map(() => null);
  if (!n) return out;
  let adj;
  if (method === 'bonferroni') adj = vals.map(p => Math.min(1, n * p));
  else if (method === 'holm') {
    const o = vals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    adj = new Array(n); let run = 0;
    o.forEach(([p, i], r) => { run = Math.max(run, (n - r) * p); adj[i] = Math.min(1, run); });
  } else if (['hochberg', 'BH', 'fdr', 'BY'].includes(method)) {
    const q = method === 'BY' ? sum(Array.from({ length: n }, (_, i) => 1 / (i + 1))) : 1;
    const o = vals.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
    adj = new Array(n); let run = Infinity;
    o.forEach(([p, i], r) => {
      const rankAsc = n - r;                         // i in R's `i <- lp:1`
      const f = method === 'hochberg' ? (n - rankAsc + 1) : q * n / rankAsc;
      run = Math.min(run, f * p); adj[i] = Math.min(1, run);
    });
  } else throw new Error(`pAdjust: unknown method ${method}`);
  idx.forEach((j, k) => { out[j] = adj[k]; });
  return out;
}

function pairwise(gs, fn) {
  const out = [];
  for (let i = 0; i < gs.length; i++)
    for (let j = i + 1; j < gs.length; j++) out.push({ a: gs[i].name, b: gs[j].name, label: `${gs[j].name}-${gs[i].name}`, ...fn(gs[i], gs[j]) });
  return out;
}

/** Tukey HSD on the one-way ANOVA (R TukeyHSD(aov(y ~ g))); diff is later group minus earlier, as R. */
export function tukeyHSD(groups, { conf = 0.95 } = {}) {
  const gs = cleanGroups(groups);
  if (gs.length < 2) return null;
  const c = oneWayCore(gs);
  if (!(c.dfw > 0)) return null;
  const qc = qtukey(conf, c.k, c.dfw);
  return {
    method: 'Tukey multiple comparisons of means', conf, df: c.dfw, mse: c.msw,
    comparisons: pairwise(gs, (a, b) => {
      const diff = mean(b.values) - mean(a.values);
      const se = Math.sqrt(c.msw / 2 * (1 / a.values.length + 1 / b.values.length));
      return { diff, ci: [diff - qc * se, diff + qc * se], statistic: Math.abs(diff) / se, p: 1 - ptukey(Math.abs(diff) / se, c.k, c.dfw) };
    }),
  };
}

/** Games–Howell pairwise comparisons: Welch SE and df per pair, studentized range reference. */
export function gamesHowell(groups, { conf = 0.95 } = {}) {
  const gs = cleanGroups(groups).filter(g => g.values.length >= 2);
  if (gs.length < 2) return null;
  const k = gs.length;
  return {
    method: 'Games-Howell test', conf,
    comparisons: pairwise(gs, (a, b) => {
      const va = variance(a.values) / a.values.length, vb = variance(b.values) / b.values.length;
      const diff = mean(b.values) - mean(a.values);
      const se = Math.sqrt((va + vb) / 2);
      const df = (va + vb) ** 2 / (va * va / (a.values.length - 1) + vb * vb / (b.values.length - 1));
      const qc = qtukey(conf, k, df), q = Math.abs(diff) / se;
      return { diff, ci: [diff - qc * se, diff + qc * se], statistic: q, df, p: 1 - ptukey(q, k, df) };
    }),
  };
}

// ---- rank tests ------------------------------------------------------------

/** P(U ≤ u) for the Mann–Whitney U with sample sizes m, n (no ties). */
function wilcoxCdfTable(m, n) {
  // number of m-subsets of ranks 1..m+n by rank sum, then shift to U
  const N = m + n, maxS = m * (2 * N - m + 1) / 2;
  let dp = Array.from({ length: m + 1 }, () => new Float64Array(maxS + 1));
  dp[0][0] = 1;
  for (let r = 1; r <= N; r++)
    for (let j = Math.min(r, m); j >= 1; j--) {
      const cur = dp[j], prev = dp[j - 1];
      for (let s = maxS; s >= r; s--) cur[s] += prev[s - r];
    }
  const off = m * (m + 1) / 2, total = Math.exp(lgam(N + 1) - lgam(m + 1) - lgam(n + 1));
  const cdf = new Float64Array(m * n + 1);
  let run = 0;
  for (let u = 0; u <= m * n; u++) { run += dp[m][u + off]; cdf[u] = run / total; }
  return cdf;
}
/** P(V ≤ v) for the signed-rank statistic with n non-zero differences (no ties). */
function signrankCdfTable(n) {
  const M = n * (n + 1) / 2, c = new Float64Array(M + 1);
  c[0] = 1;
  for (let r = 1; r <= n; r++) for (let s = M; s >= r; s--) c[s] += c[s - r];
  const out = new Float64Array(M + 1), total = Math.pow(2, n);
  let run = 0;
  for (let v = 0; v <= M; v++) { run += c[v]; out[v] = run / total; }
  return out;
}
const cdfAt = (cdf, v) => v < 0 ? 0 : v >= cdf.length - 1 ? 1 : cdf[Math.floor(v)];
/** Smallest q with P(X ≤ q) ≥ p (R's qwilcox/qsignrank). */
const cdfQuantile = (cdf, p) => { let q = 0; while (q < cdf.length - 1 && cdf[q] < p * (1 - 64 * Number.EPSILON)) q++; return q; };
const exactTwoSided = (cdf, stat, centre) =>
  Math.min(1, 2 * (stat > centre ? 1 - cdfAt(cdf, stat - 1) : cdfAt(cdf, stat)));

/**
 * Wilcoxon rank-sum (Mann–Whitney) test of x against y, as R wilcox.test(x, y,
 * conf.int = TRUE): exact when both samples have fewer than 50 values and there
 * are no ties, otherwise the normal approximation with tie and continuity
 * correction. The Hodges–Lehmann shift is the median of pairwise differences
 * (exact case) or the zero of the corrected z statistic (normal case, as R).
 */
export function mannWhitney(x, y, { conf = 0.95, exact } = {}) {
  const xs = clean(x), ys = clean(y), nx = xs.length, ny = ys.length;
  if (!nx || !ny) return null;
  const { ranks, ties } = rank([...xs, ...ys]);
  const W = sum(ranks.slice(0, nx)) - nx * (nx + 1) / 2;
  const useExact = exact ?? (nx < 50 && ny < 50 && !ties.length);
  const a = alphaOf(conf);
  const base = { n: [nx, ny], missing: [(x?.length || 0) - nx, (y?.length || 0) - ny], statistic: W, conf };
  if (useExact && !ties.length) {
    const cdf = wilcoxCdfTable(nx, ny);
    const diffs = sortNum(xs.flatMap(u => ys.map(v => u - v)));
    let qu = cdfQuantile(cdf, a / 2); if (qu === 0) qu = 1;
    const ql = nx * ny - qu;
    return {
      ...base, method: 'Wilcoxon rank sum exact test',
      p: exactTwoSided(cdf, W, nx * ny / 2),
      estimate: med(diffs), ci: [diffs[qu - 1], diffs[ql]], achievedConf: 1 - 2 * cdfAt(cdf, qu - 1),
    };
  }
  const N = nx + ny;
  const sigmaOf = t => Math.sqrt((nx * ny / 12) * ((N + 1) - tieSum(t) / (N * (N - 1))));
  const sigma = sigmaOf(ties);
  const z0 = W - nx * ny / 2;
  const z = (z0 - Math.sign(z0) * 0.5) / sigma;
  const out = { ...base, method: 'Wilcoxon rank sum test with continuity correction', p: twoSidedZ(z), z };
  // Hodges–Lehmann by inverting the corrected statistic (R's wdiff)
  const wdiff = (d, zq) => {
    const r = rank([...xs.map(v => v - d), ...ys]);
    const dz = sum(r.ranks.slice(0, nx)) - nx * (nx + 1) / 2 - nx * ny / 2;
    const s = sigmaOf(r.ties);
    return s > 0 ? (dz - Math.sign(dz) * 0.5) / s - zq : NaN;
  };
  const lo0 = Math.min(...xs) - Math.max(...ys), hi0 = Math.max(...xs) - Math.min(...ys);
  const root = zq => {
    const fl = wdiff(lo0, zq), fu = wdiff(hi0, zq);
    if (!(fl > 0)) return lo0;
    if (!(fu < 0)) return hi0;
    return bisect(d => wdiff(d, zq), lo0, hi0, 100);
  };
  if (sigma > 0 && N > 2) {
    const zc = qnorm(1 - a / 2);
    out.estimate = root(0);
    out.ci = [root(zc), root(-zc)];
  }
  return out;
}

/**
 * Wilcoxon signed-rank test of x - y (paired, complete pairs) or of x - mu, as
 * R wilcox.test(..., paired = TRUE, conf.int = TRUE). Zero differences are
 * dropped. Exact below 50 differences without ties or zeros; otherwise the
 * normal approximation with tie and continuity correction.
 */
export function wilcoxonSignedRank(x, y, { mu = 0, conf = 0.95, exact } = {}) {
  let d;
  if (y) { const [a, b] = pairs(x, y); d = a.map((v, i) => v - b[i] - mu); }
  else d = clean(x).map(v => v - mu);
  const nAll = d.length;
  const zeros = d.filter(v => v === 0).length;
  d = d.filter(v => v !== 0);
  const n = d.length;
  if (!n) return null;
  const { ranks, ties } = rank(d.map(Math.abs));
  const V = sum(ranks.filter((r, i) => d[i] > 0));
  const a = alphaOf(conf);
  const base = { n: nAll, nNonZero: n, zeros, statistic: V, conf };
  const useExact = exact ?? (n < 50 && !ties.length && !zeros);
  if (useExact && !ties.length && !zeros) {
    const cdf = signrankCdfTable(n), M = n * (n + 1) / 2;
    const walsh = [];
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) walsh.push((d[i] + d[j]) / 2);
    walsh.sort((p, q) => p - q);
    let qu = cdfQuantile(cdf, a / 2); if (qu === 0) qu = 1;
    const ql = M - qu;
    return {
      ...base, method: 'Wilcoxon signed rank exact test',
      p: exactTwoSided(cdf, V, M / 2),
      estimate: med(walsh) + mu, ci: [walsh[qu - 1] + mu, walsh[ql] + mu], achievedConf: 1 - 2 * cdfAt(cdf, qu - 1),
    };
  }
  const sigmaOf = (m, t) => Math.sqrt(m * (m + 1) * (2 * m + 1) / 24 - tieSum(t) / 48);
  const z0 = V - n * (n + 1) / 4;
  const z = (z0 - Math.sign(z0) * 0.5) / sigmaOf(n, ties);
  const out = { ...base, method: 'Wilcoxon signed rank test with continuity correction', p: twoSidedZ(z), z };
  const wdiff = (s, zq) => {
    const xd = d.map(v => v - s).filter(v => v !== 0), m = xd.length;
    const r = rank(xd.map(Math.abs));
    const zd = sum(r.ranks.filter((q, i) => xd[i] > 0)) - m * (m + 1) / 4;
    const sg = sigmaOf(m, r.ties);
    return sg > 0 ? (zd - Math.sign(zd) * 0.5) / sg - zq : NaN;
  };
  const lo0 = Math.min(...d), hi0 = Math.max(...d);
  const root = zq => {
    const fl = wdiff(lo0, zq), fu = wdiff(hi0, zq);
    if (!(fl > 0)) return lo0;
    if (!(fu < 0)) return hi0;
    return bisect(s => wdiff(s, zq), lo0, hi0, 100);
  };
  if (n > 1) {
    const zc = qnorm(1 - a / 2);
    out.estimate = root(0) + mu;
    out.ci = [root(zc) + mu, root(-zc) + mu];
  }
  return out;
}

/**
 * Dunn's pairwise z tests on pooled mid-ranks with the tie correction, adjusted
 * by `adjust` (Holm by default). z is the earlier group's mean rank minus the later's.
 */
export function dunnTest(groups, { adjust = 'holm' } = {}) {
  const gs = cleanGroups(groups);
  if (gs.length < 2) return null;
  const all = gs.flatMap(g => g.values), N = all.length;
  const { ranks, ties } = rank(all);
  let at = 0;
  const rg = gs.map(g => { const r = ranks.slice(at, at + g.values.length); at += g.values.length; return { name: g.name, n: r.length, meanRank: mean(r) }; });
  const s2 = N * (N + 1) / 12 - tieSum(ties) / (12 * (N - 1));
  const comps = pairwise(rg.map(g => ({ ...g, values: [] })), () => ({}));
  let c = 0;
  for (let i = 0; i < rg.length; i++) for (let j = i + 1; j < rg.length; j++) {
    const z = (rg[i].meanRank - rg[j].meanRank) / Math.sqrt(s2 * (1 / rg[i].n + 1 / rg[j].n));
    Object.assign(comps[c++], { label: `${rg[i].name} - ${rg[j].name}`, z, pUnadjusted: twoSidedZ(z) });
  }
  const adj = pAdjust(comps.map(x => x.pUnadjusted), adjust);
  comps.forEach((x, i) => { x.p = adj[i]; });
  return { method: `Dunn's test (${adjust} adjustment)`, n: N, meanRanks: rg, comparisons: comps };
}

/** Kruskal–Wallis rank sum test (R kruskal.test), with Dunn post-hoc comparisons (Holm). */
export function kruskalTest(groups, { adjust = 'holm' } = {}) {
  const gs = cleanGroups(groups);
  const kw = kruskalWallis(gs);
  if (!kw) return null;
  return {
    method: 'Kruskal-Wallis rank sum test', n: sum(gs.map(g => g.values.length)),
    statistic: kw.statistic, df: kw.df, p: kw.p, posthoc: dunnTest(gs, { adjust }),
  };
}

/** Friedman rank sum test (R friedman.test) on rows = subjects, columns = conditions; incomplete rows dropped. */
export function friedmanTest(matrix) {
  const rows = (matrix || []).filter(r => r?.length && r.every(isVal)).map(r => r.map(Number));
  if (!rows.length) return null;
  const k = rows[0].length;
  const full = rows.filter(r => r.length === k);
  const n = full.length;
  if (n < 1 || k < 2) return null;
  const R = new Array(k).fill(0);
  let t = 0;
  for (const r of full) { const rr = rank(r); rr.ranks.forEach((v, j) => { R[j] += v; }); t += tieSum(rr.ties); }
  const Q = 12 * sum(R.map(v => (v - n * (k + 1) / 2) ** 2)) / (n * k * (k + 1) - t / (k - 1));
  return { method: 'Friedman rank sum test', n, dropped: (matrix?.length || 0) - n, rankSums: R, statistic: Q, df: k - 1, p: 1 - pchisq(Q, k - 1) };
}

/**
 * Sign test: exact two-sided binomial test (p = 1/2) on the number of positive
 * differences x - y (or x - mu), zeros dropped (R binom.test). The estimate is
 * the median difference with its distribution-free order-statistic interval.
 */
export function signTest(x, y, { mu = 0, conf = 0.95 } = {}) {
  let d;
  if (y) { const [a, b] = pairs(x, y); d = a.map((v, i) => v - b[i] - mu); }
  else d = clean(x).map(v => v - mu);
  const nz = d.filter(v => v !== 0), n = nz.length;
  if (!n) return null;
  const pos = nz.filter(v => v > 0).length;
  const p = Math.min(1, 2 * Math.min(pbinomHalf(pos, n), 1 - pbinomHalf(pos - 1, n)));
  const mci = medianCI(sortNum(d.map(v => v + mu)), conf);
  return {
    method: 'Exact binomial test', n: d.length, nNonZero: n, statistic: pos, p,
    proportion: pos / n, estimate: med(d) + mu, ci: mci.ci, achievedConf: mci.achievedConf, conf,
  };
}

// ---- normality -------------------------------------------------------------

const poly = (c, x) => { let r = 0; for (let i = c.length - 1; i >= 0; i--) r = r * x + c[i]; return r; };

/** Shapiro–Wilk W and p (Royston 1995, AS R94, as R's swilk), 3 ≤ n ≤ 5000. */
export function shapiroWilk(x) {
  const xs = sortNum(clean(x)), n = xs.length;
  if (n < 3 || n > 5000) return null;
  const range = xs[n - 1] - xs[0];
  if (range < 1e-10) return null;
  const nn2 = Math.floor(n / 2), a = new Array(nn2 + 1).fill(0);
  const an = n;
  if (n === 3) a[1] = Math.SQRT1_2;
  else {
    const an25 = an + 0.25;
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) { a[i] = qnorm((i - 0.375) / an25); summ2 += a[i] * a[i]; }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(an);
    const a1 = poly([0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056], rsn) - a[1] / ssumm2;
    let i1, fac;
    if (n > 5) {
      i1 = 3;
      const a2 = -a[2] / ssumm2 + poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], rsn);
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] /= -fac;
  }
  // W as the squared correlation between the scaled data and the coefficients
  const coef = i => { const j = n - 1 - i; return i === j ? 0 : Math.sign(i - j) * a[1 + Math.min(i, j)]; };
  let sa = 0, sx = 0;
  for (let i = 0; i < n; i++) { sa += coef(i); sx += xs[i] / range; }
  sa /= n; sx /= n;
  let ssa = 0, ssx = 0, sax = 0;
  for (let i = 0; i < n; i++) {
    const asa = coef(i) - sa, xsx = xs[i] / range - sx;
    ssa += asa * asa; ssx += xsx * xsx; sax += asa * xsx;
  }
  const ssassx = Math.sqrt(ssa * ssx);
  const w1 = (ssassx - sax) * (ssassx + sax) / (ssa * ssx);
  const W = 1 - w1;
  let p;
  if (n === 3) {
    p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(W)) - 1.04719755119660));
  } else {
    let y = Math.log(w1), m, s;
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], an);
      if (y >= gamma) return { method: 'Shapiro-Wilk normality test', n, statistic: W, p: 1e-99 };
      y = -Math.log(gamma - y);
      m = poly([0.544, -0.39978, 0.025054, -6.714e-4], an);
      s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], an));
    } else {
      const xx = Math.log(an);
      m = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx);
      s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx));
    }
    p = normUpper((y - m) / s);
  }
  return { method: 'Shapiro-Wilk normality test', n, statistic: W, p };
}

/** Anderson–Darling normality test (nortest::ad.test), n ≥ 8. `statistic` is A; p from the adjusted A*. */
export function andersonDarling(x) {
  const xs = sortNum(clean(x)), n = xs.length;
  if (n < 8) return null;
  const m = mean(xs), sd = Math.sqrt(variance(xs));
  if (!(sd > 0)) return null;
  const z = xs.map(v => (v - m) / sd);
  let h = 0;
  for (let i = 0; i < n; i++) h += (2 * i + 1) * (Math.log(normUpper(-z[i])) + Math.log(normUpper(z[n - 1 - i])));
  const A = -n - h / n;
  const AA = (1 + 0.75 / n + 2.25 / (n * n)) * A;
  const p = AA < 0.2 ? 1 - Math.exp(-13.436 + 101.14 * AA - 223.73 * AA * AA)
    : AA < 0.34 ? 1 - Math.exp(-8.318 + 42.796 * AA - 59.938 * AA * AA)
      : AA < 0.6 ? Math.exp(0.9177 - 4.279 * AA - 1.38 * AA * AA)
        : AA < 10 ? Math.exp(1.2937 - 5.709 * AA + 0.0186 * AA * AA) : 3.7e-24;
  return { method: 'Anderson-Darling normality test', n, statistic: A, p };
}

/**
 * Normal Q–Q points (R qqnorm, plotting positions ppoints) and the qqline
 * through the first and third quartiles.
 */
export function qqPoints(x) {
  const xs = sortNum(clean(x)), n = xs.length;
  if (!n) return null;
  const a = n <= 10 ? 3 / 8 : 1 / 2;
  const points = xs.map((v, i) => ({ theoretical: qnorm((i + 1 - a) / (n + 1 - 2 * a)), sample: v }));
  const q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75), z1 = qnorm(0.25), z3 = qnorm(0.75);
  const slope = (q3 - q1) / (z3 - z1);
  return { n, points, line: { slope, intercept: q1 - slope * z1 } };
}

// ---- description -----------------------------------------------------------

/**
 * Distribution-free interval for the median from order statistics
 * [x(k), x(n-k+1)], the widest k with P(Bin(n, 1/2) ≤ k-1) ≤ α/2.
 */
function medianCI(sorted, conf) {
  const n = sorted.length, a = alphaOf(conf);
  let k = 0;
  while (k + 1 <= n / 2 && pbinomHalf(k, n) <= a / 2) k++;
  if (k < 1) return { ci: [NaN, NaN], achievedConf: NaN };
  return { ci: [sorted[k - 1], sorted[n - k]], achievedConf: 1 - 2 * pbinomHalf(k - 1, n), ranks: [k, n - k + 1] };
}

/**
 * Descriptive summary with intervals. Skewness and kurtosis are the
 * bias-adjusted type 2 estimators (G1, G2; SPSS, SAS, e1071 type = 2), with
 * SPSS's standard errors; kurtosis is excess kurtosis.
 */
export function describeWithCI(x, { conf = 0.95 } = {}) {
  const xs = sortNum(clean(x)), n = xs.length, missing = (x?.length || 0) - n;
  if (!n) return { n, missing };
  const m = mean(xs), sd = n > 1 ? Math.sqrt(variance(xs)) : NaN, se = sd / Math.sqrt(n);
  const h = n > 1 ? qt(1 - alphaOf(conf) / 2, n - 1) * se : NaN;
  const m2 = xs.reduce((s, v) => s + (v - m) ** 2, 0) / n;
  const m3 = xs.reduce((s, v) => s + (v - m) ** 3, 0) / n;
  const m4 = xs.reduce((s, v) => s + (v - m) ** 4, 0) / n;
  const g1 = m3 / m2 ** 1.5, g2 = m4 / (m2 * m2) - 3;
  const skew = n > 2 ? g1 * Math.sqrt(n * (n - 1)) / (n - 2) : NaN;
  const kurt = n > 3 ? ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3)) : NaN;
  const ses = n > 2 ? Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3))) : NaN;
  const sek = n > 3 ? 2 * ses * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5))) : NaN;
  const q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75);
  const mci = medianCI(xs, conf);
  return {
    n, missing, conf,
    mean: { estimate: m, ci: [m - h, m + h], method: 't interval' },
    sd, se,
    median: { estimate: quantile(xs, 0.5), ci: mci.ci, achievedConf: mci.achievedConf, method: 'order statistics (binomial)' },
    q1, q3, iqr: q3 - q1, min: xs[0], max: xs[n - 1],
    skewness: { estimate: skew, se: ses, type: 2 },
    kurtosis: { estimate: kurt, se: sek, type: 2, excess: true },
  };
}

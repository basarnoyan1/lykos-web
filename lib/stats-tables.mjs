// Contingency tables, correlation and effect sizes in plain JavaScript.
//
// Every function is pure: it takes counts or numbers and returns a plain object
// with the statistic, its degrees of freedom, a p-value, estimates with
// confidence intervals (option `conf`, default 0.95) and an R-style `method`
// string naming what was computed. Where R has the same test, the algorithm is
// R's own (chisq.test, fisher.test, mcnemar.test, mantelhaen.test, cor.test)
// and the method string matches; where an interval is a convention rather than
// R's (Spearman, Kendall, Cramér's V, the effect sizes), the method or `ciMethod`
// names the convention used. Root finding is by bisection to machine precision,
// so a conditional MLE may differ from R's `uniroot` (tolerance ~1e-4) in the
// fifth significant figure.
//
// A 2×2 table is [[a, b], [c, d]]: rows are the groups (exposed first), columns
// the outcome (event first). Degenerate input (no counts, fewer than two rows or
// columns with data) returns null, as `describe.chiSquare` does.
//
// Checked by app/test/stats-tables.test.mjs against published R output and
// hand derivations; not benchmarked against native R (no `bench/` entry).
import { pnorm, qnorm, pchisq, pt, qt, pbeta } from './dist.mjs';
import { pchisqUpper } from './describe.mjs';

// ---- numerical helpers ----------------------------------------------------

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const LOG_FACT = [0];
function logFact(n) {
  if (n < 0) return -Infinity;
  if (n < 5000) {
    while (LOG_FACT.length <= n) LOG_FACT.push(LOG_FACT[LOG_FACT.length - 1] + Math.log(LOG_FACT.length));
    return LOG_FACT[n];
  }
  return logGamma(n + 1);
}
const logChoose = (n, k) => (k < 0 || k > n ? -Infinity : logFact(n) - logFact(k) - logFact(n - k));

/** Root of f on [lo, hi] (f(lo), f(hi) of opposite sign) by bisection. */
function bisectRoot(f, lo, hi) {
  let flo = f(lo);
  for (let i = 0; i < 400; i++) {
    const m = (lo + hi) / 2, fm = f(m);
    if (fm === 0) return m;
    if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
    if (hi - lo <= 1e-15 * Math.max(Math.abs(lo), Math.abs(hi), 1e-300)) break;
  }
  return (lo + hi) / 2;
}

function checkConf(conf) {
  if (!(conf > 0 && conf < 1)) throw new RangeError(`conf must be between 0 and 1, got ${conf}`);
  return conf;
}
const zCrit = conf => qnorm(1 - (1 - checkConf(conf)) / 2);
/** Two-sided upper-tail normal p, accurate in the far tail. */
const pNorm2 = z => Math.min(1, 2 * pnorm(-Math.abs(z)));
/** Two-sided t p-value. */
const pT2 = (t, df) => Math.min(1, 2 * pt(-Math.abs(t), df));
const pChi = (x, df) => pchisqUpper(x, df);
const sumOf = xs => xs.reduce((a, b) => a + b, 0);

/** Poisson-mixture CDF of the noncentral chi-square. */
function pnchisq(x, df, ncp) {
  if (!(ncp > 0)) return pchisq(x, df);
  const h = ncp / 2, jmax = Math.ceil(h + 12 * Math.sqrt(h) + 40);
  let s = 0;
  for (let j = 0; j <= jmax; j++) {
    const w = Math.exp(-h + j * Math.log(h) - logFact(j));
    if (w > 1e-300) s += w * pchisq(x, df + 2 * j);
  }
  return Math.min(1, s);
}
/** Poisson-mixture CDF of the noncentral F. */
function pnf(f, df1, df2, ncp) {
  const y = df1 * f / (df1 * f + df2);
  const h = Math.max(0, ncp) / 2, jmax = Math.ceil(h + 12 * Math.sqrt(h) + 40);
  let s = 0;
  for (let j = 0; j <= jmax; j++) {
    const w = h === 0 ? (j === 0 ? 1 : 0) : Math.exp(-h + j * Math.log(h) - logFact(j));
    if (w > 1e-300) s += w * pbeta(y, df1 / 2 + j, df2 / 2);
  }
  return Math.min(1, s);
}
/**
 * Two-sided interval for a noncentrality parameter by inverting `cdf(ncp)`,
 * which decreases in ncp: the lower bound puts `obs` at the 1 − α/2 quantile,
 * the upper at α/2. A bound that would be negative is 0.
 */
function ncpInterval(cdf, conf) {
  const a = (1 - checkConf(conf)) / 2;
  const solve = target => {
    if (cdf(0) <= target) return 0;
    let hi = 10;
    while (cdf(hi) > target && hi < 1e7) hi *= 2;
    return bisectRoot(l => cdf(l) - target, 0, hi);
  };
  return [solve(1 - a), solve(a)];
}

function checkTable(table) {
  if (!Array.isArray(table) || !table.length || !table.every(Array.isArray))
    throw new TypeError('table must be an array of rows');
  const C = table[0].length;
  if (!table.every(r => r.length === C)) throw new TypeError('table rows must have equal length');
  for (const r of table) for (const v of r)
    if (!(Number.isFinite(v) && v >= 0)) throw new TypeError(`table counts must be non-negative numbers, got ${v}`);
  return table.map(r => r.slice());
}
/** Drop rows and columns that hold no counts; say so. */
function trimTable(table) {
  const x = checkTable(table);
  const warnings = [];
  const rowKeep = x.map(r => sumOf(r) > 0);
  const colKeep = x[0].map((_, j) => x.some(r => r[j] > 0));
  if (rowKeep.includes(false) || colKeep.includes(false))
    warnings.push('Rows or columns with no counts were left out.');
  const t = x.filter((_, i) => rowKeep[i]).map(r => r.filter((_, j) => colKeep[j]));
  return { t, rowKeep, colKeep, warnings };
}
const margins = t => {
  const rows = t.map(sumOf);
  const cols = t[0].map((_, j) => sumOf(t.map(r => r[j])));
  return { rows, cols, N: sumOf(rows) };
};
function check2x2(table) {
  const x = checkTable(table);
  if (x.length !== 2 || x[0].length !== 2) throw new TypeError('a 2×2 table is required');
  return x;
}

// ---- chi-square -----------------------------------------------------------

/**
 * Pearson's chi-square test of independence for an R×C table, as R's
 * `chisq.test` (Yates' correction on a 2×2 when `correct`), with the
 * likelihood-ratio G², expected counts, Pearson and standardized residuals, and
 * Cramér's V with an interval from the noncentral chi-square.
 */
export function chiSquareTest(table, { correct = true, conf = 0.95, biasCorrected = false } = {}) {
  checkConf(conf);
  const { t, warnings } = trimTable(table);
  if (t.length < 2 || !t[0] || t[0].length < 2) return null;
  const { rows, cols, N } = margins(t);
  const R = t.length, C = t[0].length, df = (R - 1) * (C - 1);
  const expected = rows.map(r => cols.map(c => r * c / N));
  const is2x2 = R === 2 && C === 2;
  let pearson = 0, yates = 0, g2 = 0, small = 0, below1 = 0;
  const residuals = [], stdResiduals = [];
  for (let i = 0; i < R; i++) {
    residuals.push([]); stdResiduals.push([]);
    for (let j = 0; j < C; j++) {
      const o = t[i][j], e = expected[i][j], d = o - e;
      if (e < 5) small++;
      if (e < 1) below1++;
      pearson += d * d / e;
      const y = Math.abs(d) - Math.min(0.5, Math.abs(d));
      yates += y * y / e;
      if (o > 0) g2 += 2 * o * Math.log(o / e);
      residuals[i].push(d / Math.sqrt(e));
      stdResiduals[i].push(d / Math.sqrt(e * (1 - rows[i] / N) * (1 - cols[j] / N)));
    }
  }
  const useYates = correct && is2x2;
  const statistic = useYates ? yates : pearson;
  const smallExpected = small / (R * C);
  if (smallExpected > 0.2)
    warnings.push(`${small} of ${R * C} expected counts (${Math.round(100 * smallExpected)}%) are below 5; the chi-square approximation may be inaccurate — consider Fisher's exact test.`);
  if (below1) warnings.push(`${below1} expected count${below1 > 1 ? 's are' : ' is'} below 1.`);
  const V = cramersVFrom(pearson, N, R, C, conf, biasCorrected);
  return {
    method: useYates ? "Pearson's Chi-squared test with Yates' continuity correction" : "Pearson's Chi-squared test",
    statistic, df, p: pChi(statistic, df),
    pearson, pPearson: pChi(pearson, df),
    likelihoodRatio: { statistic: g2, df, p: pChi(g2, df), method: 'Likelihood ratio (G-test)' },
    n: N, observed: t, expected, residuals, stdResiduals,
    smallExpected, cramersV: V, warnings,
  };
}

function cramersVFrom(x2, N, R, C, conf, biasCorrected) {
  const k = Math.min(R, C) - 1, df = (R - 1) * (C - 1);
  const estimate = Math.sqrt(x2 / (N * k));
  const [lo, hi] = ncpInterval(l => pnchisq(x2, df, l), conf);
  const out = {
    estimate, ci: [Math.min(1, Math.sqrt(lo / (N * k))), Math.min(1, Math.sqrt(hi / (N * k)))], conf,
    ciMethod: 'noncentral chi-square inversion, V = sqrt(λ / (N (k − 1)))',
  };
  if (biasCorrected) {
    // Bergsma (2013); the interval above is for the uncorrected V.
    const phi2 = Math.max(0, x2 / N - df / (N - 1));
    const r = R - (R - 1) ** 2 / (N - 1), c = C - (C - 1) ** 2 / (N - 1);
    out.biasCorrected = Math.sqrt(phi2 / Math.min(r - 1, c - 1));
  }
  return out;
}

/** Cramér's V for an R×C table, with its interval (uncorrected Pearson X²). */
export function cramersV(table, { conf = 0.95, biasCorrected = false } = {}) {
  const r = chiSquareTest(table, { correct: false, conf, biasCorrected });
  return r && { ...r.cramersV, n: r.n, method: "Cramér's V" };
}

/**
 * Signed phi coefficient of a 2×2 table, (ad − bc) / sqrt(r1 r2 c1 c2). The
 * interval is for |phi| (noncentral chi-square), as for Cramér's V.
 */
export function phi(table, { conf = 0.95 } = {}) {
  const [[a, b], [c, d]] = check2x2(table);
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  if (!den) return null;
  const r = chiSquareTest(table, { correct: false, conf });
  return { method: 'phi coefficient', estimate: (a * d - b * c) / den, ciAbs: r.cramersV.ci, conf, n: r.n };
}

// ---- Fisher's exact test --------------------------------------------------

/**
 * Fisher's exact test. A 2×2 table follows R's `fisher.test` exactly: the
 * two-sided p sums the hypergeometric probabilities no larger than the observed
 * one × (1 + 1e-7); the estimate is the conditional MLE of the odds ratio with
 * its exact interval. Larger tables are enumerated with the network algorithm's
 * pruning (Mehta & Patel) when the total is at most 200; otherwise, or when the
 * enumeration would exceed its work limit, p is null with a message (Monte
 * Carlo p-values are not computed here).
 */
export function fisherExact(table, { conf = 0.95, alternative = 'two.sided', maxWork = 2e6 } = {}) {
  checkConf(conf);
  const x = checkTable(table);
  if (x.length === 2 && x[0].length === 2) return fisher2x2(x, conf, alternative);
  const { t, warnings } = trimTable(x);
  if (t.length < 2 || !t[0] || t[0].length < 2) return null;
  if (t.length === 2 && t[0].length === 2) return { ...fisher2x2(t, conf, alternative), warnings };
  const method = "Fisher's Exact Test for Count Data";
  const { N } = margins(t);
  if (!t.flat().every(Number.isInteger)) throw new TypeError("Fisher's exact test needs whole counts");
  if (N > 200) return { method, p: null, n: N, warnings, message: `The table total is ${N}; exact enumeration is limited to 200 and a Monte Carlo p-value is not computed here.` };
  const p = fisherRxC(t, maxWork);
  if (p == null) return { method, p: null, n: N, warnings, message: 'The exact enumeration exceeded its work limit; a Monte Carlo p-value is not computed here.' };
  return { method, p, n: N, alternative: 'two.sided', warnings };
}

function fisher2x2(x, conf, alternative) {
  if (!x.flat().every(Number.isInteger)) throw new TypeError("Fisher's exact test needs whole counts");
  const m = x[0][0] + x[1][0], n = x[0][1] + x[1][1], k = x[0][0] + x[0][1], obs = x[0][0];
  const lo = Math.max(0, k - n), hi = Math.min(k, m);
  const support = [];
  for (let s = lo; s <= hi; s++) support.push(s);
  const logdc = support.map(s => logChoose(m, s) + logChoose(n, k - s) - logChoose(m + n, k));
  const dnhyper = ncp => {
    const d = logdc.map((l, i) => l + Math.log(ncp) * support[i]);
    const mx = Math.max(...d), e = d.map(v => Math.exp(v - mx)), s = sumOf(e);
    return e.map(v => v / s);
  };
  const mnhyper = ncp => {
    if (ncp === 0) return lo;
    if (ncp === Infinity) return hi;
    return sumOf(dnhyper(ncp).map((d, i) => d * support[i]));
  };
  const pnhyper = (q, ncp, upper = false) => {
    if (ncp === 1) {
      const d = logdc.map(Math.exp);
      return Math.min(1, sumOf(d.filter((_, i) => (upper ? support[i] >= q : support[i] <= q))));
    }
    if (ncp === 0) return upper ? +(q <= lo) : +(q >= lo);
    if (ncp === Infinity) return upper ? +(q <= hi) : +(q >= hi);
    return Math.min(1, sumOf(dnhyper(ncp).filter((_, i) => (upper ? support[i] >= q : support[i] <= q))));
  };
  let p;
  if (alternative === 'less') p = pnhyper(obs, 1);
  else if (alternative === 'greater') p = pnhyper(obs, 1, true);
  else if (alternative === 'two.sided') {
    const d = logdc.map(Math.exp), dObs = d[obs - lo] * (1 + 1e-7);
    p = Math.min(1, sumOf(d.filter(v => v <= dObs)));
  } else throw new RangeError(`alternative must be two.sided, less or greater, got ${alternative}`);

  const EPS = 2.220446e-16;
  const ncpU = alpha => {
    if (obs === hi) return Infinity;
    const p1 = pnhyper(obs, 1);
    if (p1 < alpha) return bisectRoot(t => pnhyper(obs, t) - alpha, 0, 1);
    if (p1 > alpha) return 1 / bisectRoot(t => pnhyper(obs, 1 / t) - alpha, EPS, 1);
    return 1;
  };
  const ncpL = alpha => {
    if (obs === lo) return 0;
    const p1 = pnhyper(obs, 1, true);
    if (p1 > alpha) return bisectRoot(t => pnhyper(obs, t, true) - alpha, 0, 1);
    if (p1 < alpha) return 1 / bisectRoot(t => pnhyper(obs, 1 / t, true) - alpha, EPS, 1);
    return 1;
  };
  const ci = alternative === 'less' ? [0, ncpU(1 - conf)]
    : alternative === 'greater' ? [ncpL(1 - conf), Infinity]
      : [ncpL((1 - conf) / 2), ncpU((1 - conf) / 2)];
  let estimate;
  if (obs === lo) estimate = 0;
  else if (obs === hi) estimate = Infinity;
  else {
    const mu = mnhyper(1);
    estimate = mu > obs ? bisectRoot(t => mnhyper(t) - obs, 0, 1)
      : mu < obs ? 1 / bisectRoot(t => mnhyper(1 / t) - obs, EPS, 1) : 1;
  }
  return {
    method: "Fisher's Exact Test for Count Data", p, alternative, n: m + n,
    oddsRatio: { estimate, ci, conf, method: 'conditional maximum likelihood estimate' },
  };
}

/**
 * Exact two-sided p for an R×C table (network algorithm, Mehta & Patel 1983).
 * Columns are filled one at a time; a node is (column, remaining row totals),
 * and paths reaching a node with the same past weight are merged. A node whose
 * every completion is at most as probable as the observed table is added in
 * one step from its closed-form total; one whose every completion is more
 * probable is dropped. The bounds relax one set of margins: each remaining
 * column (or row) is filled alone, as evenly as its caps allow for the most
 * probable completion and as unevenly for the least probable.
 */
function fisherRxC(t, maxWork) {
  // The work depends on orientation; fewer rows than columns is usually
  // cheaper, but not always, so the other way round gets the rest of the budget.
  const tt = t[0].map((_, j) => t.map(r => r[j]));
  const [first, second] = t.length <= t[0].length ? [t, tt] : [tt, t];
  return fisherOriented(first, maxWork / 2) ?? fisherOriented(second, maxWork / 2);
}

function fisherOriented(t, maxWork) {
  const { rows, cols, N } = margins(t);
  const C = cols.length;
  cols.sort((a, b) => b - a);
  const lfSum = xs => xs.reduce((s, v) => s + logFact(v), 0);
  const constant = lfSum(rows) + lfSum(cols) - logFact(N);
  const threshold = constant - lfSum(t.flat()) + Math.log(1 + 1e-7);
  // Σ log x! over one line of cells summing to `total`, each x_i ≤ caps[i]:
  // least by water-filling, greatest by filling the largest caps first.
  const lineMin = (caps, total) => {
    const cs = caps.slice().sort((a, b) => a - b);
    let left = total, s = 0;
    for (let i = 0; i < cs.length; i++) {
      const k = cs.length - i;
      if (cs[i] * k <= left) { s += logFact(cs[i]); left -= cs[i]; continue; }
      const q = Math.floor(left / k), rem = left - q * k;
      return s + (k - rem) * logFact(q) + rem * logFact(q + 1);
    }
    return s;
  };
  const lineMax = (caps, total) => {
    const cs = caps.slice().sort((a, b) => b - a);
    let left = total, s = 0;
    for (const c of cs) { const v = Math.min(c, left); s += logFact(v); left -= v; if (!left) break; }
    return s;
  };
  const allocations = (caps, total) => {
    const out = [], cur = new Array(caps.length).fill(0);
    const suffix = caps.map((_, i) => sumOf(caps.slice(i)));
    (function rec(i, left) {
      if (i === caps.length - 1) { if (left <= caps[i]) { cur[i] = left; out.push(cur.slice()); } return; }
      const from = Math.max(0, left - suffix[i + 1]), to = Math.min(caps[i], left);
      for (let v = from; v <= to; v++) { cur[i] = v; rec(i + 1, left - v); }
    })(0, total);
    return out;
  };
  let work = 0, p = 0;
  const sortedKey = r => r.join(',');
  const edgeCache = new Map();
  const edgesOf = (j, r) => {
    const k = j + ':' + sortedKey(r);
    let e = edgeCache.get(k);
    if (!e) {
      e = allocations(r, cols[j]).map(a => {
        const nr = r.map((v, i) => v - a[i]).sort((x, y) => x - y);
        return { w: -lfSum(a), r: nr, key: sortedKey(nr) };
      });
      work += e.length;
      edgeCache.set(k, e);
    }
    return e;
  };
  // The distinct weights of a node's completions with their counts, sorted,
  // with prefix sums of count × exp(v − top); null when there are too many.
  const FUTURE_CAP = 20000;
  const futures = new Map();
  function future(j, r) {
    const k = j + ':' + sortedKey(r);
    if (futures.has(k)) return futures.get(k);
    let out = null;
    if (j === C - 1) out = [{ v: -lfSum(r), c: 1 }];
    else {
      const acc = new Map();
      for (const e of edgesOf(j, r)) {
        const f = future(j + 1, e.r);
        if (!f || acc.size > FUTURE_CAP) { out = null; acc.clear(); acc.set('x', null); break; }
        for (const { v, c } of f.list) {
          const v2 = v + e.w, k2 = Math.round(v2 * 1e9), prev = acc.get(k2);
          if (prev) prev.c += c; else acc.set(k2, { v: v2, c });
        }
      }
      out = acc.has('x') || acc.size > FUTURE_CAP ? null : [...acc.values()];
    }
    if (out) {
      out.sort((a, b) => a.v - b.v);
      const top = out[out.length - 1].v, prefix = [0];
      for (const { v, c } of out) prefix.push(prefix[prefix.length - 1] + c * Math.exp(v - top));
      out = { list: out, top, prefix };
    }
    work += 1;
    futures.set(k, out);
    return out;
  }
  let stage = new Map([[0, { r: rows.slice().sort((a, b) => a - b), pasts: new Map([[0, { w: 0, c: 1 }]]) }]]);
  for (let j = 0; j < C && stage.size; j++) {
    const rest = cols.slice(j), next = new Map();
    for (const { r, pasts } of stage.values()) {
      // bounds on −Σ log x! over the completions, from the column-wise and
      // row-wise relaxations (each drops one set of margins)
      const mx = -Math.max(sumOf(rest.map(c => lineMin(r, c))), sumOf(r.map(v => lineMin(rest, v))));
      const mn = -Math.min(sumOf(rest.map(c => lineMax(r, c))), sumOf(r.map(v => lineMax(rest, v))));
      const total = logFact(sumOf(rest)) - lfSum(r) - lfSum(rest);
      const open = [];
      for (const past of pasts.values()) {
        const { w, c } = past;
        if (constant + w + mx <= threshold) p += c * Math.exp(constant + w + total);
        else if (constant + w + mn <= threshold) open.push(past);
      }
      if (!open.length) continue;
      const f = C - j <= 2 ? future(j, r) : null;
      if (f) {
        const { list, top, prefix } = f;
        for (const { w, c } of open) {
          // completions with constant + w + v ≤ threshold
          const lim = threshold - constant - w;
          let lo = 0, hi = list.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].v <= lim) lo = m + 1; else hi = m; }
          p += c * Math.exp(constant + w + top) * prefix[lo];
        }
        if (work > maxWork) return null;
        continue;
      }
      for (const { w, c } of open) {
        for (const e of edgesOf(j, r)) {
          let node = next.get(e.key);
          if (!node) next.set(e.key, node = { r: e.r, pasts: new Map() });
          const w2 = w + e.w, k2 = Math.round(w2 * 1e9);
          const prev = node.pasts.get(k2);
          if (prev) prev.c += c; else node.pasts.set(k2, { w: w2, c });
          work++;
        }
        if (work > maxWork) return null;
      }
    }
    stage = next;
  }
  return Math.min(1, p);
}

// ---- McNemar --------------------------------------------------------------

/**
 * McNemar's test from the discordant counts b and c of a paired 2×2 table,
 * as R's `mcnemar.test`, with the exact binomial (conditional) variant and the
 * conditional odds ratio b/c with its exact (Clopper–Pearson based) interval.
 */
export function mcnemarTest(b, c, { correct = true, conf = 0.95 } = {}) {
  checkConf(conf);
  if (!(Number.isFinite(b) && Number.isFinite(c) && b >= 0 && c >= 0)) throw new TypeError('b and c must be non-negative counts');
  const n = b + c;
  if (!n) return null;
  const useCorrection = correct && b !== c;
  const y = useCorrection ? Math.abs(b - c) - 1 : b - c;
  const statistic = y * y / n;
  const lo = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= lo; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  const exactP = Math.min(1, 2 * tail);
  const [pl, pu] = clopperPearson(b, n, conf);
  return {
    method: useCorrection ? "McNemar's Chi-squared test with continuity correction" : "McNemar's Chi-squared test",
    statistic, df: 1, p: pChi(statistic, 1), n,
    exact: { method: 'Exact McNemar test (binomial, p = 0.5)', p: exactP },
    oddsRatio: { estimate: c ? b / c : Infinity, ci: [pl / (1 - pl), pu >= 1 ? Infinity : pu / (1 - pu)], conf, method: 'conditional odds ratio b/c, Clopper–Pearson' },
  };
}

function qbetaRoot(p, a, b) { return bisectRoot(x => pbeta(x, a, b) - p, 0, 1); }
/** Clopper–Pearson interval for x successes in n. */
function clopperPearson(x, n, conf) {
  const a = (1 - conf) / 2;
  return [x === 0 ? 0 : qbetaRoot(a, x, n - x + 1), x === n ? 1 : qbetaRoot(1 - a, x + 1, n - x)];
}

// ---- Mantel–Haenszel ------------------------------------------------------

/**
 * Stratified 2×2 tables [[a, b], [c, d]], one per stratum. The MH chi-square
 * and common odds ratio with its Robins–Breslow–Greenland interval follow R's
 * `mantelhaen.test`; the MH risk ratio uses the Greenland–Robins variance; the
 * Breslow–Day test of homogeneous odds ratios carries Tarone's correction.
 * Strata with fewer than two observations are left out, as in R.
 */
export function mantelHaenszel(tables, { correct = true, conf = 0.95 } = {}) {
  checkConf(conf);
  if (!Array.isArray(tables) || !tables.length) throw new TypeError('an array of 2×2 tables is required');
  const all = tables.map(check2x2);
  const strata = all.filter(([[a, b], [c, d]]) => a + b + c + d >= 2);
  const warnings = [];
  const dropped = all.length - strata.length;
  if (dropped) warnings.push(`${dropped} strat${dropped > 1 ? 'a' : 'um'} with fewer than two observations ${dropped > 1 ? 'were' : 'was'} left out.`);
  if (!strata.length) return null;
  const z = zCrit(conf);
  let delta = 0, varSum = 0;
  let sR = 0, sS = 0, sPR = 0, sPSQR = 0, sQS = 0;
  let rrNum = 0, rrDen = 0, rrVar = 0;
  for (const [[a, b], [c, d]] of strata) {
    const n = a + b + c + d, n1 = a + b, n0 = c + d, m1 = a + c, m0 = b + d;
    delta += a - n1 * m1 / n;
    varSum += n1 * n0 * m1 * m0 / (n * n * (n - 1));
    const R = a * d / n, S = b * c / n, P = (a + d) / n, Q = (b + c) / n;
    sR += R; sS += S; sPR += P * R; sPSQR += P * S + Q * R; sQS += Q * S;
    rrNum += a * n0 / n; rrDen += c * n1 / n;
    rrVar += (n1 * n0 * m1 - a * c * n) / (n * n);
  }
  const yates = correct && Math.abs(delta) >= 0.5 ? 0.5 : 0;
  const statistic = (Math.abs(delta) - yates) ** 2 / varSum;
  const or = sR / sS;
  const seLogOr = Math.sqrt(sPR / (2 * sR * sR) + sPSQR / (2 * sR * sS) + sQS / (2 * sS * sS));
  const rr = rrNum / rrDen, seLogRr = Math.sqrt(rrVar / (rrNum * rrDen));
  const bd = breslowDay(strata, or);
  return {
    method: yates ? 'Mantel-Haenszel chi-squared test with continuity correction' : 'Mantel-Haenszel chi-squared test without continuity correction',
    statistic, df: 1, p: pChi(statistic, 1), strata: strata.length,
    oddsRatio: { estimate: or, ci: [or * Math.exp(-z * seLogOr), or * Math.exp(z * seLogOr)], seLog: seLogOr, conf, method: 'Mantel-Haenszel, Robins–Breslow–Greenland variance' },
    riskRatio: { estimate: rr, ci: [rr * Math.exp(-z * seLogRr), rr * Math.exp(z * seLogRr)], seLog: seLogRr, conf, method: 'Mantel-Haenszel, Greenland–Robins variance' },
    breslowDay: bd, warnings,
  };
}

function breslowDay(strata, psi) {
  let bd = 0, sumDiff = 0, sumVar = 0, used = 0;
  for (const [[a, b], [c, d]] of strata) {
    const n1 = a + b, n0 = c + d, m1 = a + c;
    const lo = Math.max(0, m1 - n0), hi = Math.min(n1, m1);
    if (lo === hi) continue;          // no information on the odds ratio
    // expected a under the common odds ratio: the root in (lo, hi) of
    // A (n0 − m1 + A) = psi (n1 − A)(m1 − A)
    const qa = 1 - psi, qb = n0 - m1 + psi * (n1 + m1), qc = -psi * n1 * m1;
    let A;
    if (Math.abs(qa) < 1e-12) A = -qc / qb;
    else {
      const disc = Math.sqrt(qb * qb - 4 * qa * qc);
      const r1 = (-qb + disc) / (2 * qa), r2 = (-qb - disc) / (2 * qa);
      A = r1 >= lo - 1e-9 && r1 <= hi + 1e-9 ? r1 : r2;
    }
    const v = 1 / (1 / A + 1 / (n1 - A) + 1 / (m1 - A) + 1 / (n0 - m1 + A));
    bd += (a - A) ** 2 / v;
    sumDiff += a - A; sumVar += v; used++;
  }
  const df = used - 1;
  if (df < 1) return null;
  const tarone = bd - sumDiff * sumDiff / sumVar;
  return { method: "Breslow-Day test with Tarone's correction", statistic: tarone, df, p: pChi(tarone, df), uncorrected: bd, pUncorrected: pChi(bd, df) };
}

// ---- 2×2 effect measures --------------------------------------------------

/** Adds 0.5 to every cell of a 2×2 only when a cell is zero (Haldane). */
function haldane(table) {
  const x = check2x2(table);
  const zero = x.flat().some(v => v === 0);
  return { x: zero ? x.map(r => r.map(v => v + 0.5)) : x, corrected: zero };
}
const corrNote = 'Haldane correction: 0.5 added to every cell because a cell was zero.';

/** Odds ratio (ad)/(bc) with a Wald interval on the log scale. */
export function oddsRatio(table, { conf = 0.95 } = {}) {
  const z = zCrit(conf);
  const { x: [[a, b], [c, d]], corrected } = haldane(table);
  const est = a * d / (b * c), se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  return {
    method: 'odds ratio, Wald interval on the log scale', estimate: est, logEstimate: Math.log(est), seLog: se,
    ci: [est * Math.exp(-z * se), est * Math.exp(z * se)], conf, corrected, warnings: corrected ? [corrNote] : [],
  };
}

/** Risk ratio (a/(a+b)) / (c/(c+d)) with a Wald interval on the log scale. */
export function riskRatio(table, { conf = 0.95 } = {}) {
  const z = zCrit(conf);
  const { x: [[a, b], [c, d]], corrected } = haldane(table);
  const n1 = a + b, n0 = c + d;
  const est = (a / n1) / (c / n0), se = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n0);
  return {
    method: 'risk ratio, Wald interval on the log scale', estimate: est, logEstimate: Math.log(est), seLog: se,
    ci: [est * Math.exp(-z * se), est * Math.exp(z * se)], conf, corrected, warnings: corrected ? [corrNote] : [],
  };
}

function wilson(x, n, z) {
  const p = x / n, den = 1 + z * z / n;
  const mid = (p + z * z / (2 * n)) / den, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
/**
 * Risk difference a/(a+b) − c/(c+d) with Newcombe's hybrid score interval
 * (method 10, from two Wilson intervals). No zero-cell correction is needed.
 */
export function riskDifference(table, { conf = 0.95 } = {}) {
  const z = zCrit(conf);
  const [[a, b], [c, d]] = check2x2(table);
  const n1 = a + b, n0 = c + d;
  if (!n1 || !n0) return null;
  const p1 = a / n1, p2 = c / n0, rd = p1 - p2;
  const [l1, u1] = wilson(a, n1, z), [l2, u2] = wilson(c, n0, z);
  const se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n0);
  return {
    method: 'risk difference, Newcombe hybrid score interval', estimate: rd, conf,
    ci: [rd - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), rd + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)],
    se, waldCi: [rd - z * se, rd + z * se], p1, p2,
  };
}

// ---- correlation ----------------------------------------------------------

/** Average ranks, ties sharing their mean rank. */
function rank(xs) {
  const idx = xs.map((v, i) => i).sort((i, j) => xs[i] - xs[j]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearsonR(x, y) {
  const n = x.length, mx = sumOf(x) / n, my = sumOf(y) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
const hasTies = xs => new Set(xs).size < xs.length;
const tieGroups = xs => {
  const m = new Map();
  for (const v of xs) m.set(v, (m.get(v) || 0) + 1);
  return [...m.values()].filter(k => k > 1);
};
function completePairs(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) throw new TypeError('x and y must be arrays of equal length');
  const xs = [], ys = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a === null || b === null || a === '' || b === '') continue;
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) { xs.push(na); ys.push(nb); }
  }
  return [xs, ys];
}
const fisherCi = (r, se, z) => [Math.tanh(Math.atanh(r) - z * se), Math.tanh(Math.atanh(r) + z * se)];

/** Probabilities of 0..n(n−1)/2 inversions in a random permutation of n. */
function kendallDist(n) {
  let d = [1];
  for (let i = 2; i <= n; i++) {
    const next = new Array(d.length + i - 1).fill(0);
    for (let k = 0; k < d.length; k++) for (let j = 0; j < i; j++) next[k + j] += d[k] / i;
    d = next;
  }
  return d;
}
/** Exact null distribution of Σ d² for Spearman's rho, by enumeration (n ≤ 9). */
function spearmanExactP(s, n) {
  const used = new Array(n).fill(false);
  let le = 0, ge = 0, total = 0;
  (function rec(i, acc) {
    if (i === n) { total++; if (acc <= s + 1e-9) le++; if (acc >= s - 1e-9) ge++; return; }
    for (let v = 0; v < n; v++) if (!used[v]) { used[v] = true; rec(i + 1, acc + (i - v) ** 2); used[v] = false; }
  })(0, 0);
  return Math.min(1, 2 * Math.min(le, ge) / total);
}

/**
 * Correlation of x and y over complete pairs, as R's `cor.test`.
 * - pearson: t test on n − 2 df; Fisher z interval.
 * - spearman: rho on average ranks; exact permutation p for n ≤ 9 without ties,
 *   otherwise R's t approximation; Fisher z interval with the Bonett–Wright SE
 *   sqrt((1 + rho²/2)/(n − 3)).
 * - kendall: tau-b; exact p for n < 50 without ties (as R), otherwise the
 *   tie-corrected normal approximation; Fisher z interval with the
 *   Fieller–Hartley–Pearson SE sqrt(0.437/(n − 4)).
 */
export function correlation(x, y, { method = 'pearson', conf = 0.95 } = {}) {
  const z = zCrit(conf);
  const [xs, ys] = completePairs(x, y);
  const n = xs.length;
  if (method === 'pearson') {
    if (n < 3) return null;
    const r = pearsonR(xs, ys);
    if (!Number.isFinite(r)) return null;
    const df = n - 2, t = r * Math.sqrt(df / (1 - r * r));
    return {
      method: "Pearson's product-moment correlation", estimate: r, statistic: t, statisticName: 't', df, n,
      p: Math.abs(r) === 1 ? 0 : pT2(t, df),
      ci: n > 3 ? fisherCi(r, 1 / Math.sqrt(n - 3), z) : null, conf, ciMethod: 'Fisher z',
    };
  }
  if (method === 'spearman') {
    if (n < 3) return null;
    const rho = pearsonR(rank(xs), rank(ys));
    if (!Number.isFinite(rho)) return null;
    const ties = hasTies(xs) || hasTies(ys);
    const S = (n ** 3 - n) * (1 - rho) / 6;
    let p, pMethod;
    if (!ties && n <= 9) { p = spearmanExactP(Math.round(S), n); pMethod = 'exact permutation'; }
    else {
      const df = n - 2, t = rho / Math.sqrt((1 - rho * rho) / df);
      p = Math.abs(rho) === 1 ? 0 : pT2(t, df); pMethod = 't approximation';
    }
    return {
      method: "Spearman's rank correlation rho", estimate: rho, statistic: S, statisticName: 'S', n, p, pMethod,
      ci: n > 3 ? fisherCi(rho, Math.sqrt((1 + rho * rho / 2) / (n - 3)), z) : null, conf,
      ciMethod: 'Fisher z with the Bonett–Wright standard error', warnings: ties ? ['Ties present: p uses the t approximation.'] : [],
    };
  }
  if (method === 'kendall') {
    if (n < 2) return null;
    let S = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) S += Math.sign(xs[i] - xs[j]) * Math.sign(ys[i] - ys[j]);
    const T0 = n * (n - 1) / 2, xt = tieGroups(xs), yt = tieGroups(ys);
    const T1 = sumOf(xt.map(k => k * (k - 1) / 2)), T2 = sumOf(yt.map(k => k * (k - 1) / 2));
    const tau = S / Math.sqrt((T0 - T1) * (T0 - T2));
    if (!Number.isFinite(tau)) return null;
    const ties = xt.length > 0 || yt.length > 0;
    let p, statistic, statisticName, pMethod;
    if (!ties && n < 50) {
      const dist = kendallDist(n), q = Math.round((tau + 1) * n * (n - 1) / 4);
      const le = sumOf(dist.slice(0, q + 1)), ge = sumOf(dist.slice(q));
      p = Math.min(1, 2 * (q > n * (n - 1) / 4 ? ge : le));
      statistic = q; statisticName = 'T'; pMethod = 'exact';
    } else {
      const f = (ks, g) => sumOf(ks.map(g));
      const v0 = n * (n - 1) * (2 * n + 5);
      const vt = f(xt, k => k * (k - 1) * (2 * k + 5)), vu = f(yt, k => k * (k - 1) * (2 * k + 5));
      const v1 = f(xt, k => k * (k - 1)) * f(yt, k => k * (k - 1));
      const v2 = f(xt, k => k * (k - 1) * (k - 2)) * f(yt, k => k * (k - 1) * (k - 2));
      const varS = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + (n > 2 ? v2 / (9 * n * (n - 1) * (n - 2)) : 0);
      statistic = S / Math.sqrt(varS); statisticName = 'z'; p = pNorm2(statistic); pMethod = 'normal approximation';
    }
    return {
      method: "Kendall's rank correlation tau", estimate: tau, statistic, statisticName, n, p, pMethod,
      ci: n > 4 && Math.abs(tau) < 1 ? fisherCi(tau, Math.sqrt(0.437 / (n - 4)), z) : null, conf,
      ciMethod: 'Fisher z with the Fieller–Hartley–Pearson standard error',
    };
  }
  throw new RangeError(`method must be pearson, spearman or kendall, got ${method}`);
}

/**
 * Pairwise-complete correlation matrix of named columns: estimate, n, p and
 * interval for every pair (the diagonal is 1 with the column's own n).
 */
export function correlationMatrix(columns, method = 'pearson', { conf = 0.95 } = {}) {
  const k = columns.length, names = columns.map(c => c.name);
  const blank = () => Array.from({ length: k }, () => new Array(k).fill(null));
  const r = blank(), n = blank(), p = blank(), ci = blank();
  for (let i = 0; i < k; i++) {
    r[i][i] = 1; n[i][i] = completePairs(columns[i].values, columns[i].values)[0].length;
    for (let j = i + 1; j < k; j++) {
      const res = correlation(columns[i].values, columns[j].values, { method, conf });
      const m = completePairs(columns[i].values, columns[j].values)[0].length;
      r[i][j] = r[j][i] = res ? res.estimate : null;
      p[i][j] = p[j][i] = res ? res.p : null;
      ci[i][j] = ci[j][i] = res ? res.ci : null;
      n[i][j] = n[j][i] = m;
    }
  }
  return { method, names, r, n, p, ci, conf };
}

/** Least-squares residuals of y on the columns of X (with an intercept). */
function residualize(y, X) {
  const n = y.length, k = X.length + 1;
  const col = j => (j === 0 ? null : X[j - 1]);
  const at = (j, i) => (j === 0 ? 1 : col(j)[i]);
  const A = Array.from({ length: k }, (_, a) => Array.from({ length: k + 1 }, (_, b) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += at(a, i) * (b === k ? y[i] : at(b, i));
    return s;
  }));
  for (let c = 0; c < k; c++) {                // Gauss–Jordan with partial pivoting
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12 * Math.max(1, Math.abs(A[0][0]))) throw new RangeError('control variables are collinear');
    for (let r = 0; r < k; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let b = c; b <= k; b++) A[r][b] -= f * A[c][b];
    }
  }
  const beta = A.map((row, c) => row[k] / row[c]);
  return y.map((v, i) => v - beta.reduce((s, b, j) => s + b * at(j, i), 0));
}

/**
 * Partial Pearson correlation of x and y given `controls` (an array of
 * variables), over rows complete on all of them: t test on n − 2 − k df, Fisher
 * z interval with SE 1/sqrt(n − 3 − k). With `method: 'spearman'` every
 * variable is ranked first.
 */
export function partialCorrelation(x, y, controls = [], { conf = 0.95, method = 'pearson' } = {}) {
  const z = zCrit(conf);
  const all = [x, y, ...controls];
  const len = x.length;
  if (!all.every(v => Array.isArray(v) && v.length === len)) throw new TypeError('x, y and every control must be arrays of equal length');
  const keep = [];
  for (let i = 0; i < len; i++) if (all.every(v => v[i] !== null && v[i] !== '' && Number.isFinite(Number(v[i])))) keep.push(i);
  let cols = all.map(v => keep.map(i => Number(v[i])));
  if (method === 'spearman') cols = cols.map(rank);
  else if (method !== 'pearson') throw new RangeError('method must be pearson or spearman');
  const k = controls.length, n = keep.length, df = n - 2 - k;
  if (df < 1) return null;
  const [cx, cy, ...cz] = cols;
  const r = k ? pearsonR(residualize(cx, cz), residualize(cy, cz)) : pearsonR(cx, cy);
  if (!Number.isFinite(r)) return null;
  const t = r * Math.sqrt(df / (1 - r * r));
  return {
    method: `partial ${method === 'spearman' ? 'Spearman' : 'Pearson'} correlation`, estimate: r, statistic: t, df, n, controls: k,
    p: Math.abs(r) === 1 ? 0 : pT2(t, df),
    ci: n - 3 - k > 0 ? fisherCi(r, 1 / Math.sqrt(n - 3 - k), z) : null, conf, ciMethod: 'Fisher z',
  };
}

// ---- standardized mean differences ----------------------------------------

function checkSummary({ m1, s1, n1, m2, s2, n2 }) {
  for (const [k, v] of Object.entries({ m1, s1, n1, m2, s2, n2 }))
    if (!Number.isFinite(v)) throw new TypeError(`${k} must be a number`);
  if (!(s1 > 0 && s2 > 0 && n1 > 1 && n2 > 1)) throw new RangeError('SDs must be positive and each group needs n > 1');
}
const smdVar = (d, n1, n2) => (n1 + n2) / (n1 * n2) + d * d / (2 * (n1 + n2));
/** Exact small-sample correction J(df) = Γ(df/2) / (sqrt(df/2) Γ((df − 1)/2)). */
const hedgesJ = df => Math.exp(logGamma(df / 2) - 0.5 * Math.log(df / 2) - logGamma((df - 1) / 2));

/**
 * Cohen's d from group summaries, using the pooled SD; normal-approximation
 * interval with variance (n1 + n2)/(n1 n2) + d²/(2(n1 + n2)).
 */
export function cohenD(s, { conf = 0.95 } = {}) {
  checkSummary(s);
  const z = zCrit(conf);
  const { m1, s1, n1, m2, s2, n2 } = s, df = n1 + n2 - 2;
  const sp = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / df);
  const d = (m1 - m2) / sp, v = smdVar(d, n1, n2);
  return { method: "Cohen's d (pooled SD)", estimate: d, variance: v, se: Math.sqrt(v), ci: [d - z * Math.sqrt(v), d + z * Math.sqrt(v)], conf, sdPooled: sp, df };
}

/** Hedges' g: Cohen's d times the exact correction J(n1 + n2 − 2). */
export function hedgesG(s, { conf = 0.95 } = {}) {
  const d = cohenD(s, { conf });
  const z = zCrit(conf), J = hedgesJ(d.df), g = J * d.estimate, v = J * J * d.variance;
  return { method: "Hedges' g (exact J correction)", estimate: g, variance: v, se: Math.sqrt(v), ci: [g - z * Math.sqrt(v), g + z * Math.sqrt(v)], conf, j: J, df: d.df };
}

/**
 * Glass's delta, (m1 − m2)/s2, standardizing by the second (control) group;
 * variance (n1 + n2)/(n1 n2) + Δ²/(2(n2 − 1)).
 */
export function glassDelta(s, { conf = 0.95 } = {}) {
  checkSummary(s);
  const z = zCrit(conf);
  const { m1, n1, m2, s2, n2 } = s;
  const est = (m1 - m2) / s2, v = (n1 + n2) / (n1 * n2) + est * est / (2 * (n2 - 1));
  return { method: "Glass's delta (control SD)", estimate: est, variance: v, se: Math.sqrt(v), ci: [est - z * Math.sqrt(v), est + z * Math.sqrt(v)], conf };
}

// ---- variance explained from F --------------------------------------------

function fInterval(F, df1, df2, conf) {
  if (!(F >= 0 && df1 > 0 && df2 > 0)) throw new RangeError('F must be ≥ 0 and both df positive');
  const [lo, hi] = ncpInterval(l => pnf(F, df1, df2, l), conf);
  return [lo / df1, hi / df1];          // bounds as F-equivalents λ/df1
}
const eta2Of = (F, df1, df2) => F * df1 / (F * df1 + df2);
const omega2Of = (F, df1, df2) => Math.max(0, (F - 1) * df1 / (F * df1 + df2 + 1));
const eps2Of = (F, df1, df2) => Math.max(0, (F - 1) * df1 / (F * df1 + df2));
const ciNote = 'noncentral F inversion; bounds are the same formula at F = λ/df1';

/** Partial eta squared from F(df1, df2), F df1 / (F df1 + df2). */
export function etaSquared({ F, df1, df2 }, { conf = 0.95 } = {}) {
  const [lo, hi] = fInterval(F, df1, df2, conf);
  return { method: 'partial eta squared', estimate: eta2Of(F, df1, df2), ci: [eta2Of(lo, df1, df2), eta2Of(hi, df1, df2)], conf, ciMethod: ciNote };
}
/** Partial omega squared from F, (F − 1) df1 / (F df1 + df2 + 1), floored at 0. */
export function omegaSquared({ F, df1, df2 }, { conf = 0.95 } = {}) {
  const [lo, hi] = fInterval(F, df1, df2, conf);
  return { method: 'partial omega squared', estimate: omega2Of(F, df1, df2), ci: [omega2Of(lo, df1, df2), omega2Of(hi, df1, df2)], conf, ciMethod: ciNote };
}
/** Partial epsilon squared from F, (F − 1) df1 / (F df1 + df2), floored at 0. */
export function epsilonSquared({ F, df1, df2 }, { conf = 0.95 } = {}) {
  const [lo, hi] = fInterval(F, df1, df2, conf);
  return { method: 'partial epsilon squared', estimate: eps2Of(F, df1, df2), ci: [eps2Of(lo, df1, df2), eps2Of(hi, df1, df2)], conf, ciMethod: ciNote };
}

// ---- conversions (Borenstein et al. 2009, ch. 7) --------------------------

const LOGIT_K = Math.sqrt(3) / Math.PI;
/** log odds ratio → d: d = ln(OR) √3/π, V_d = V_lnOR · 3/π². */
export const logOrToD = (logOr, v) => ({ d: logOr * LOGIT_K, variance: v == null ? undefined : v * LOGIT_K * LOGIT_K });
/** d → log odds ratio: ln(OR) = d π/√3, V = V_d π²/3. */
export const dToLogOr = (d, v) => ({ logOr: d / LOGIT_K, variance: v == null ? undefined : v / (LOGIT_K * LOGIT_K) });
/** r → d: d = 2r/√(1 − r²), V_d = 4 V_r/(1 − r²)³. */
export const rToD = (r, v) => ({ d: 2 * r / Math.sqrt(1 - r * r), variance: v == null ? undefined : 4 * v / (1 - r * r) ** 3 });
/**
 * d → r: r = d/√(d² + a), a = (n1 + n2)²/(n1 n2) (4 when group sizes are not
 * given), V_r = a² V_d/(d² + a)³.
 */
export function dToR(d, v, n1, n2) {
  const a = n1 > 0 && n2 > 0 ? (n1 + n2) ** 2 / (n1 * n2) : 4;
  return { r: d / Math.sqrt(d * d + a), variance: v == null ? undefined : a * a * v / (d * d + a) ** 3 };
}

/**
 * Convert one effect to d, r, odds ratio and log odds ratio. `from` is 'd',
 * 'r', 'or' or 'logor'; `variance` (of that measure; for 'or' of ln OR) gives
 * each result an interval.
 */
export function convertEffect({ from, value, variance, n1, n2 }, { conf = 0.95 } = {}) {
  const z = zCrit(conf);
  let d, vd;
  if (from === 'd') { d = value; vd = variance; }
  else if (from === 'r') ({ d, variance: vd } = rToD(value, variance));
  else if (from === 'or') ({ d, variance: vd } = logOrToD(Math.log(value), variance));
  else if (from === 'logor') ({ d, variance: vd } = logOrToD(value, variance));
  else throw new RangeError(`from must be d, r, or or logor, got ${from}`);
  const r = from === 'r' ? { r: value, variance } : dToR(d, vd, n1, n2);
  const lo = dToLogOr(d, vd);
  const band = (est, v) => (v == null ? null : [est - z * Math.sqrt(v), est + z * Math.sqrt(v)]);
  const rCi = r.variance == null ? null : [Math.max(-1, r.r - z * Math.sqrt(r.variance)), Math.min(1, r.r + z * Math.sqrt(r.variance))];
  const lorCi = band(lo.logOr, lo.variance);
  return {
    method: 'Borenstein et al. (2009) conversions', conf,
    d: { estimate: d, variance: vd, ci: band(d, vd) },
    r: { estimate: r.r, variance: r.variance, ci: rCi },
    logOr: { estimate: lo.logOr, variance: lo.variance, ci: lorCi },
    or: { estimate: Math.exp(lo.logOr), ci: lorCi && lorCi.map(Math.exp) },
  };
}

/**
 * Standardized mean difference d from a reported test statistic.
 * - t with n1, n2: d = t √(1/n1 + 1/n2); with only df: d = 2t/√df (equal groups).
 * - F with df1 = 1: as t = √F (sign unknown).
 * - chi2 with df 1 and n: phi = √(χ²/n), then r → d (sign unknown).
 * - p (two-sided) with n1, n2: t = qt(1 − p/2, n1 + n2 − 2) (sign unknown).
 * The interval uses the Borenstein variance of d.
 */
export function effectFromTestStat(input, { conf = 0.95 } = {}) {
  const z = zCrit(conf);
  const { t, F, chi2, p, df, df1, n1, n2, n } = input;
  const warnings = [];
  let d, v, from;
  const groups = n1 > 0 && n2 > 0;
  const fromT = (tv, source) => {
    from = source;
    if (groups) { d = tv * Math.sqrt(1 / n1 + 1 / n2); v = smdVar(d, n1, n2); return; }
    if (!(df > 0)) throw new RangeError('give n1 and n2, or df');
    d = 2 * tv / Math.sqrt(df);
    const h = (df + 2) / 2; v = smdVar(d, h, h);
    warnings.push('Group sizes not given: equal groups of (df + 2)/2 assumed.');
  };
  if (Number.isFinite(t)) fromT(t, 't');
  else if (Number.isFinite(F)) {
    const d1 = df1 ?? 1;
    if (d1 !== 1) throw new RangeError('d is defined only for F with one numerator df');
    fromT(Math.sqrt(F), 'F');
    warnings.push('The sign of d is not recoverable from F; d is reported as positive.');
  } else if (Number.isFinite(chi2)) {
    if ((df ?? 1) !== 1) throw new RangeError('d is defined only for a chi-square with 1 df');
    const N = n ?? (groups ? n1 + n2 : NaN);
    if (!(N > 1)) throw new RangeError('give n (or n1 and n2) with chi2');
    const r = Math.sqrt(chi2 / N), vr = (1 - r * r) ** 2 / (N - 1);
    ({ d, variance: v } = rToD(r, vr)); from = 'chi2';
    warnings.push('The sign of d is not recoverable from chi-square; d is reported as positive.');
  } else if (Number.isFinite(p)) {
    if (!(p > 0 && p <= 1)) throw new RangeError('p must be in (0, 1]');
    if (!groups) throw new RangeError('give n1 and n2 with p');
    fromT(qt(1 - p / 2, n1 + n2 - 2), 'p');
    warnings.push('The sign of d is not recoverable from a two-sided p; d is reported as positive.');
  } else throw new TypeError('give one of t, F, chi2 or p');
  return { method: `standardized mean difference from ${from}`, estimate: d, variance: v, se: Math.sqrt(v), ci: [d - z * Math.sqrt(v), d + z * Math.sqrt(v)], conf, warnings };
}

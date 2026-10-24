// Regression for a patient table: linear, logistic and Poisson models, the
// univariable screen and the side-by-side publication table.
//
// Computed here in plain JavaScript rather than in R so that a model is fitted
// without starting the WebR engine. The linear algebra is small and dense:
// Householder QR with R's limited column pivoting (dqrdc2, tolerance 1e-7), so
// a column that is a linear combination of earlier ones is reported as aliased
// (R's NA coefficient) rather than crashing. Generalised linear models are
// fitted by iteratively reweighted least squares as glm.fit does: the same
// starting values, convergence rule (relative deviance change < 1e-8, at most
// 25 iterations) and logit clamping.
//
// Data are complete-case: a row missing the outcome, any predictor or the
// offset is dropped and counted (nUsed, nDropped). Categorical predictors are
// treatment (dummy) coded against a reference level, the first level unless
// one is named. Levels are ordered by the spec's `levels` when given, otherwise
// sorted with numeric awareness ("2" before "10"), which differs from R's plain
// string sort only for numeric-looking labels.
//
// Checked by unit tests against published R output for mtcars (lm, glm) and
// hand-computable cases; not benchmarked against a native R installation, so
// this module is not among the plan's measured components (status line).
//
// Nothing here decides significance. Each estimate is reported with its
// interval and test, and warnings (aliased terms, separation, overdispersion)
// travel with the result for the view to show.

import { qt, qnorm, pnorm, pchisq, pbeta } from './dist.mjs';

const DBL_EPS = 2.220446049250313e-16;
const QR_TOL = 1e-7;

// ---- data -------------------------------------------------------------------

const isMissing = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ||
  (typeof v === 'number' && !Number.isFinite(v));

function toNumber(v) {
  if (isMissing(v)) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const x = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}
const toLevel = v => isMissing(v) ? null : String(v).trim();
const levelSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });

function normalizeSpecs(predictors) {
  return (predictors || []).map(p => typeof p === 'string' ? { column: p, type: 'numeric' } : {
    column: p.column, type: p.type === 'categorical' ? 'categorical' : 'numeric',
    reference: p.reference == null ? undefined : String(p.reference),
    levels: Array.isArray(p.levels) ? p.levels.map(String) : undefined,
  });
}

/**
 * Build the model matrix. Always includes an intercept.
 * @param {object[]} rows
 * @param {string} outcome column name
 * @param {{column:string,type:'numeric'|'categorical',reference?:string,levels?:string[]}[]} predictors
 * @param {{outcomeValue?:(v:any)=>number|null, offset?:string, exposure?:string}} [opts]
 *   outcomeValue codes the raw outcome (default: numeric); offset names a column already
 *   on the linear-predictor scale; exposure names a positive column whose log is the offset.
 * @returns {{X:number[][], y:number[], names:string[], columns:{name:string,term:string|null,level:string|null}[],
 *   levels:Object<string,{levels:string[],reference:string}>, nUsed:number, nDropped:number,
 *   rowIndex:number[], offset:number[]|null}}
 */
export function designMatrix(rows, outcome, predictors, opts = {}) {
  const specs = normalizeSpecs(predictors);
  const code = opts.outcomeValue || toNumber;
  const offCol = opts.offset || opts.exposure || null;
  const kept = [];
  (rows || []).forEach((r, i) => {
    const y = code(r?.[outcome]);
    if (y === null || y === undefined || !Number.isFinite(y)) return;
    const vals = [];
    for (const s of specs) {
      const v = s.type === 'categorical' ? toLevel(r[s.column]) : toNumber(r[s.column]);
      if (v === null) return;
      vals.push(v);
    }
    let off = 0;
    if (offCol) {
      const o = toNumber(r[offCol]);
      if (o === null) return;
      if (opts.exposure) { if (!(o > 0)) return; off = Math.log(o); } else off = o;
    }
    kept.push({ i, y, vals, off });
  });

  const levels = {};
  specs.forEach((s, k) => {
    if (s.type !== 'categorical') return;
    const present = new Set(kept.map(r => r.vals[k]));
    const order = s.levels ? s.levels.filter(l => present.has(l)).concat([...present].filter(l => !s.levels.includes(l)).sort(levelSort))
      : [...present].sort(levelSort);
    const reference = s.reference ?? order[0];
    if (order.length && !order.includes(reference))
      throw new Error(`Reference level '${reference}' of ${s.column} is not among the complete cases`);
    levels[s.column] = { levels: order, reference };
  });

  const columns = [{ name: '(Intercept)', term: null, level: null }];
  specs.forEach(s => {
    if (s.type === 'numeric') columns.push({ name: s.column, term: s.column, level: null });
    else for (const l of levels[s.column].levels) if (l !== levels[s.column].reference)
      columns.push({ name: `${s.column}: ${l}`, term: s.column, level: l });
  });

  const X = kept.map(r => {
    const x = [1];
    specs.forEach((s, k) => {
      if (s.type === 'numeric') x.push(r.vals[k]);
      else for (const l of levels[s.column].levels) if (l !== levels[s.column].reference) x.push(r.vals[k] === l ? 1 : 0);
    });
    return x;
  });
  return {
    X, y: kept.map(r => r.y), names: columns.map(c => c.name), columns, levels,
    nUsed: kept.length, nDropped: (rows || []).length - kept.length, rowIndex: kept.map(r => r.i),
    offset: offCol ? kept.map(r => r.off) : null, specs,
  };
}

// ---- linear algebra -----------------------------------------------------------

/**
 * Householder QR of sqrt(w)·X with dqrdc2-style limited pivoting: a column whose
 * remaining norm falls below QR_TOL of its original norm is aliased and skipped.
 */
function qrFit(X, z, w) {
  const n = X.length, p = n ? X[0].length : 0;
  const cols = Array.from({ length: p }, (_, j) => Float64Array.from(X, (r, i) => r[j] * (w ? Math.sqrt(w[i]) : 1)));
  const qty = Float64Array.from(z, (v, i) => v * (w ? Math.sqrt(w[i]) : 1));
  const orig = cols.map(c => Math.hypot(...c));
  const keep = [], aliased = [];
  let k = 0;
  for (let j = 0; j < p; j++) {
    const c = cols[j];
    let s = 0; for (let i = k; i < n; i++) s += c[i] * c[i];
    const norm = Math.sqrt(s);
    if (k >= n || !(orig[j] > 0) || norm <= QR_TOL * orig[j]) { aliased.push(j); continue; }
    const alpha = c[k] > 0 ? -norm : norm;
    const v = new Float64Array(n); for (let i = k; i < n; i++) v[i] = c[i]; v[k] -= alpha;
    let vv = 0; for (let i = k; i < n; i++) vv += v[i] * v[i];
    const reflect = a => { let d = 0; for (let i = k; i < n; i++) d += v[i] * a[i]; d = 2 * d / vv; for (let i = k; i < n; i++) a[i] -= d * v[i]; };
    for (let jj = j + 1; jj < p; jj++) reflect(cols[jj]);
    reflect(qty);
    c[k] = alpha; for (let i = k + 1; i < n; i++) c[i] = 0;
    keep.push(j); k++;
  }
  const R = Array.from({ length: k }, (_, r) => Array.from({ length: k }, (_, cc) => r <= cc ? cols[keep[cc]][r] : 0));
  const b = new Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) { let s = qty[r]; for (let cc = r + 1; cc < k; cc++) s -= R[r][cc] * b[cc]; b[r] = s / R[r][r]; }
  const Rinv = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let cc = 0; cc < k; cc++) {
    Rinv[cc][cc] = 1 / R[cc][cc];
    for (let r = cc - 1; r >= 0; r--) { let s = 0; for (let m = r + 1; m <= cc; m++) s += R[r][m] * Rinv[m][cc]; Rinv[r][cc] = -s / R[r][r]; }
  }
  const XtXinv = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, bb) => {
    let s = 0; for (let m = Math.max(a, bb); m < k; m++) s += Rinv[a][m] * Rinv[bb][m]; return s;
  }));
  return { coef: b, keep, aliased, rank: k, XtXinv };
}

/** Cholesky determinant of a symmetric positive-definite matrix. */
function detSPD(A) {
  const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  let det = 1;
  for (let j = 0; j < n; j++) {
    let s = A[j][j]; for (let m = 0; m < j; m++) s -= L[j][m] * L[j][m];
    if (!(s > 0)) return 0;
    L[j][j] = Math.sqrt(s); det *= s;
    for (let i = j + 1; i < n; i++) { let t = A[i][j]; for (let m = 0; m < j; m++) t -= L[i][m] * L[j][m]; L[i][j] = t / L[j][j]; }
  }
  return det;
}
const sub = (A, idx) => idx.map(i => idx.map(j => A[i][j]));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const quad = (x, M) => { let s = 0; for (let a = 0; a < x.length; a++) for (let b = 0; b < x.length; b++) s += x[a] * M[a][b] * x[b]; return s; };

/**
 * (Generalised) variance inflation per term from the coefficient covariance,
 * as car::vif: GVIF = det(R11)·det(R22)/det(R) on the correlation of the
 * non-intercept coefficients. `adjusted` is GVIF^(1/(2·df)).
 */
function vifTable(V, kept) {
  const idx = kept.map((c, i) => ({ ...c, i })).filter(c => c.term !== null);
  const terms = [...new Set(idx.map(c => c.term))];
  if (terms.length < 2) return terms.map(term => ({ term, df: idx.filter(c => c.term === term).length, gvif: 1, adjusted: 1 }));
  const all = idx.map(c => c.i);
  const C = all.map(a => all.map(b => V[a][b] / Math.sqrt(V[a][a] * V[b][b])));
  const detR = detSPD(C);
  return terms.map(term => {
    const inT = idx.map((c, k) => c.term === term ? k : -1).filter(k => k >= 0);
    const outT = idx.map((c, k) => c.term !== term ? k : -1).filter(k => k >= 0);
    const gvif = detR > 0 ? detSPD(sub(C, inT)) * detSPD(sub(C, outT)) / detR : Infinity;
    return { term, df: inT.length, gvif, adjusted: gvif ** (1 / (2 * inT.length)) };
  });
}

// ---- shared result shaping ------------------------------------------------------

function coefficientRows(d, fit, se, statFn, crit) {
  const pos = new Map(fit.keep.map((j, k) => [j, k]));
  return d.columns.map((c, j) => {
    const base = { name: c.name, term: c.term, level: c.level };
    if (!pos.has(j)) return { ...base, aliased: true, estimate: null, se: null, statistic: null, p: null, ci: null };
    const k = pos.get(j), est = fit.coef[k], s = se[k], stat = est / s;
    return { ...base, aliased: false, estimate: est, se: s, statistic: stat, p: statFn(stat), ci: [est - crit * s, est + crit * s] };
  });
}
function aliasWarning(d, fit) {
  if (!fit.aliased.length) return [];
  const names = fit.aliased.map(j => d.names[j]);
  return [{ code: 'aliased', terms: names, message: `Not estimable (linear combination of other columns): ${names.join(', ')}` }];
}
function modelMeta(d) {
  return { nUsed: d.nUsed, nDropped: d.nDropped, rowIndex: d.rowIndex, names: d.names, levels: d.levels, predictors: d.specs };
}

// ---- linear model -----------------------------------------------------------------

/**
 * Ordinary least squares, as lm().
 * @param {object[]} rows @param {string} outcome @param {object[]} predictors
 * @param {{robust?:boolean, level?:number}} [opts] robust: HC3 standard errors (sandwich::vcovHC type "HC3").
 */
export function linearRegression(rows, outcome, predictors, { robust = false, level = 0.95 } = {}) {
  const d = designMatrix(rows, outcome, predictors);
  const n = d.nUsed;
  if (!n) throw new Error('No complete cases');
  const fit = qrFit(d.X, d.y);
  const p = fit.rank, df = n - p;
  if (df <= 0) throw new Error(`Too few complete cases (${n}) for ${p} coefficients`);
  const Xk = d.X.map(r => fit.keep.map(j => r[j]));
  const fitted = Xk.map(x => dot(x, fit.coef));
  const residuals = d.y.map((y, i) => y - fitted[i]);
  const rss = dot(residuals, residuals);
  const ybar = d.y.reduce((a, b) => a + b, 0) / n;
  const tss = d.y.reduce((a, y) => a + (y - ybar) ** 2, 0);
  const s2 = rss / df, sigma = Math.sqrt(s2);
  const leverage = Xk.map(x => quad(x, fit.XtXinv));

  let V;
  if (robust) {
    const k = p, meat = Array.from({ length: k }, () => new Array(k).fill(0));
    Xk.forEach((x, i) => {
      const om = residuals[i] ** 2 / (1 - leverage[i]) ** 2;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += x[a] * x[b] * om;
    });
    const B = fit.XtXinv;
    const BM = B.map(r => r.map((_, b) => r.reduce((s, v, m) => s + v * meat[m][b], 0)));
    V = BM.map(r => B.map(col => dot(r, col)));
  } else V = fit.XtXinv.map(r => r.map(v => v * s2));
  const se = V.map((r, k) => Math.sqrt(r[k]));
  const crit = qt(1 - (1 - level) / 2, df);
  const tp = t => Number.isFinite(t) ? pbeta(df / (df + t * t), df / 2, 0.5) : (Number.isNaN(t) ? NaN : 0);
  const coefficients = coefficientRows(d, fit, se, tp, crit);

  const r2 = tss > 0 ? 1 - rss / tss : NaN;
  const adjR2 = 1 - (1 - r2) * (n - 1) / df;
  const df1 = p - 1;
  let fTest = null;
  if (df1 > 0) {
    // With robust SEs R's summary still reports the classical F; kept that way here.
    const F = ((tss - rss) / df1) / s2;
    fTest = { F, df1, df2: df, p: pbeta(df / (df + df1 * F), df / 2, df1 / 2) };
  }
  const standardized = residuals.map((e, i) => e / (sigma * Math.sqrt(1 - leverage[i])));
  const studentized = residuals.map((e, i) => {
    const si2 = (rss - e * e / (1 - leverage[i])) / (df - 1);
    return e / Math.sqrt(si2 * (1 - leverage[i]));
  });
  const cooks = residuals.map((e, i) => e * e * leverage[i] / (p * s2 * (1 - leverage[i]) ** 2));
  const keptCols = fit.keep.map(j => d.columns[j]);
  const Vunscaled = fit.XtXinv;
  return {
    family: 'gaussian', measure: 'beta', ...modelMeta(d), coefficients, aliased: fit.aliased.map(j => d.names[j]),
    rank: p, df, level, robust, seType: robust ? 'HC3' : 'classical',
    r2, adjR2, sigma, fTest, vif: vifTable(Vunscaled, keptCols),
    residuals, fitted, leverage, cooks, standardized, studentized,
    warnings: aliasWarning(d, fit),
  };
}

// ---- generalised linear models ------------------------------------------------------

const FAMILIES = {
  binomial: {
    init: y => y.map(v => (v + 0.5) / 2),
    link: mu => Math.log(mu / (1 - mu)),
    inv: eta => { const e = Math.min(Math.max(eta, -30), 30); return 1 / (1 + Math.exp(-e)); },
    // canonical link: working weight = variance = mu.eta; R floors mu.eta at DBL_EPS
    weight: (mu, eta) => { const e = Math.exp(-Math.abs(eta)); return Math.max(e / (1 + e) ** 2, DBL_EPS); },
    dev: (y, mu) => {
      let s = 0;
      for (let i = 0; i < y.length; i++) s += y[i] ? -2 * Math.log(mu[i]) : -2 * Math.log(1 - mu[i]);
      return s;
    },
    loglik: (y, mu) => -FAMILIES.binomial.dev(y, mu) / 2,
  },
  poisson: {
    init: y => y.map(v => v + 0.1),
    link: mu => Math.log(mu),
    inv: eta => Math.max(Math.exp(eta), DBL_EPS),
    weight: mu => mu,
    dev: (y, mu) => {
      let s = 0;
      for (let i = 0; i < y.length; i++) s += 2 * ((y[i] > 0 ? y[i] * Math.log(y[i] / mu[i]) : 0) - (y[i] - mu[i]));
      return s;
    },
    loglik: (y, mu) => y.reduce((s, v, i) => s + v * Math.log(mu[i]) - mu[i] - lgammaFn(v + 1), 0),
  },
};

/** log Γ(x), Lanczos (g = 7, n = 9). */
function lgammaFn(x) {
  if (Number.isInteger(x) && x > 0 && x < 171) { let s = 0; for (let k = 2; k < x; k++) s += Math.log(k); return s; }
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgammaFn(1 - x);
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** IRLS as glm.fit. X may have zero columns (a fully fixed model). */
function irls(X, y, offset, fam, { maxit = 25, epsilon = 1e-8 } = {}) {
  const n = y.length, p = X.length ? X[0].length : 0;
  const off = offset || new Array(n).fill(0);
  if (!p) {
    const mu = off.map(fam.inv);
    return { coef: [], keep: [], aliased: [], rank: 0, XtXinv: [], mu, eta: off.slice(), deviance: fam.dev(y, mu), converged: true, iterations: 0 };
  }
  let eta = fam.init(y).map(fam.link);
  let mu = eta.map(fam.inv);
  let devold = fam.dev(y, mu), fit = null, converged = false, iter = 0, prevCoef = null;
  for (iter = 1; iter <= maxit; iter++) {
    const w = mu.map((m, i) => fam.weight(m, eta[i]));
    const z = eta.map((e, i) => e - off[i] + (y[i] - mu[i]) / w[i]);
    fit = qrFit(X, z, w);
    const fullCoef = new Array(p).fill(0); fit.keep.forEach((j, k) => { fullCoef[j] = fit.coef[k]; });
    let newEta = X.map((r, i) => dot(r, fullCoef) + off[i]);
    let newMu = newEta.map(fam.inv), dev = fam.dev(y, newMu);
    // step halving when the deviance is not finite, as glm.fit
    for (let h = 0; !Number.isFinite(dev) && prevCoef && h < 30; h++) {
      for (let j = 0; j < p; j++) fullCoef[j] = (fullCoef[j] + prevCoef[j]) / 2;
      newEta = X.map((r, i) => dot(r, fullCoef) + off[i]); newMu = newEta.map(fam.inv); dev = fam.dev(y, newMu);
      fit.coef = fit.keep.map(j => fullCoef[j]);
    }
    prevCoef = fullCoef; eta = newEta; mu = newMu;
    if (Math.abs(dev - devold) / (Math.abs(dev) + 0.1) < epsilon) { converged = true; devold = dev; break; }
    devold = dev;
  }
  // covariance at the final estimates (glm's summary uses the last IRLS weights,
  // which differ from these only below the convergence tolerance)
  const w = mu.map((m, i) => fam.weight(m, eta[i]));
  const fin = qrFit(X, eta.map((e, i) => e - off[i]), w);
  return { coef: fit.coef, keep: fit.keep, aliased: fit.aliased, rank: fit.rank, XtXinv: fin.XtXinv, mu, eta, deviance: devold, converged, iterations: Math.min(iter, maxit) };
}

/** Profile-likelihood interval for coefficient column j (as MASS/R confint on a glm). */
function profileInterval(Xk, y, off, fam, fit, k, se, level) {
  const zc = qnorm(1 - (1 - level) / 2);
  const bhat = fit.coef[k], D0 = fit.deviance, n = y.length;
  const Xo = Xk.map(r => r.filter((_, m) => m !== k));
  const devAt = t => irls(Xo, y, off.map((o, i) => o + Xk[i][k] * t), fam).deviance;
  const h = t => Math.sqrt(Math.max(0, devAt(t) - D0)) - zc;
  const bound = dir => {
    let a = bhat, step = Number.isFinite(se) && se > 0 ? se * zc : 1, b = bhat + dir * step, hb = h(b);
    for (let i = 0; hb < 0; i++) {
      if (i >= 40 || !Number.isFinite(hb)) return dir * Infinity;
      a = b; step *= 2; b = bhat + dir * step; hb = h(b);
    }
    let ha = a === bhat ? -zc : h(a);
    // Illinois false position between a (h<0) and b (h>=0)
    let side = 0, t = b;
    for (let i = 0; i < 100; i++) {
      t = (a * hb - b * ha) / (hb - ha);
      if (!Number.isFinite(t) || (t - a) * (t - b) > 0) t = (a + b) / 2;
      const ht = h(t);
      if (Math.abs(ht) < 1e-10 || Math.abs(b - a) < 1e-10 * (1 + Math.abs(t))) break;
      if (ht < 0) { a = t; ha = ht; if (side === -1) hb /= 2; side = -1; }
      else { b = t; hb = ht; if (side === 1) ha /= 2; side = 1; }
    }
    return t;
  };
  if (!n) return [NaN, NaN];
  return [bound(-1), bound(1)];
}

function hosmerLemeshow(y, mu, g = 10) {
  const n = y.length, sorted = mu.slice().sort((a, b) => a - b);
  const q = pr => { const h = (n - 1) * pr, lo = Math.floor(h), hi = Math.ceil(h); return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]); };
  const breaks = [...new Set(Array.from({ length: g + 1 }, (_, k) => q(k / g)))];
  const G = breaks.length - 1;
  if (G < 3) return null;
  const groups = Array.from({ length: G }, (_, k) => ({ lower: breaks[k], upper: breaks[k + 1], n: 0, observed: 0, expected: 0 }));
  mu.forEach((m, i) => {
    let k = 0; while (k < G - 1 && m > breaks[k + 1]) k++;
    const grp = groups[k]; grp.n++; grp.observed += y[i]; grp.expected += m;
  });
  let chisq = 0;
  for (const grp of groups) {
    const e0 = grp.n - grp.expected, o0 = grp.n - grp.observed;
    if (grp.expected > 0) chisq += (grp.observed - grp.expected) ** 2 / grp.expected;
    if (e0 > 0) chisq += (o0 - e0) ** 2 / e0;
  }
  const df = G - 2;
  return { chisq, df, p: 1 - pchisq(chisq, df), groups };
}

/** Area under the ROC curve (c-statistic); ties count one half. */
function cStatistic(y, mu) {
  const idx = mu.map((m, i) => i).sort((a, b) => mu[a] - mu[b]);
  const ranks = new Array(mu.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && mu[idx[j + 1]] === mu[idx[i]]) j++;
    for (let k = i; k <= j; k++) ranks[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const n1 = y.reduce((a, b) => a + b, 0), n0 = y.length - n1;
  if (!n1 || !n0) return NaN;
  const s = y.reduce((a, v, i) => a + (v ? ranks[i] : 0), 0);
  return (s - n1 * (n1 + 1) / 2) / (n1 * n0);
}

function fitGlm(d, famName, { level = 0.95, profile = true } = {}) {
  const fam = FAMILIES[famName], n = d.nUsed;
  if (!n) throw new Error('No complete cases');
  const off = d.offset || new Array(n).fill(0);
  // structural aliasing is decided once, on the unweighted design
  const struct = qrFit(d.X, d.y);
  if (n <= struct.rank) throw new Error(`Too few complete cases (${n}) for ${struct.rank} coefficients`);
  let Xk = d.X.map(r => struct.keep.map(j => r[j]));
  let fit = irls(Xk, d.y, off, fam);
  if (fit.aliased.length) {
    // a column aliased only under the IRLS weights: drop it and refit
    Xk = Xk.map(r => fit.keep.map(k => r[k]));
    const keep = fit.keep.map(k => struct.keep[k]);
    struct.aliased = [...struct.aliased, ...fit.aliased.map(k => struct.keep[k])].sort((a, b) => a - b);
    struct.keep = keep; struct.rank = keep.length;
    fit = irls(Xk, d.y, off, fam);
  }
  const keepMap = { keep: struct.keep, aliased: struct.aliased, coef: fit.coef };
  const se = fit.XtXinv.map((r, k) => Math.sqrt(r[k]));
  const crit = qnorm(1 - (1 - level) / 2);
  const zp = z => Number.isFinite(z) ? 2 * pnorm(-Math.abs(z)) : (Number.isNaN(z) ? NaN : 0);
  const coefficients = coefficientRows(d, keepMap, se, zp, crit);
  let pk = 0;
  for (const c of coefficients) {
    if (c.aliased) { Object.assign(c, { ratio: null, ratioCI: null, profileCI: null, ratioProfileCI: null }); continue; }
    const k = pk++;
    c.ratio = Math.exp(c.estimate);
    c.ratioCI = c.ci.map(Math.exp);
    if (profile) {
      c.profileCI = profileInterval(Xk, d.y, off, fam, fit, k, se[k], level);
      c.ratioProfileCI = c.profileCI.map(Math.exp);
    }
  }
  // null model: intercept (and offset) only
  let nullDev;
  if (famName === 'binomial' && !d.offset) {
    const ybar = d.y.reduce((a, b) => a + b, 0) / n;
    nullDev = fam.dev(d.y, d.y.map(() => ybar));
  } else nullDev = irls(d.X.map(() => [1]), d.y, off, fam).deviance;
  const rank = struct.rank, dfResidual = n - rank, dfNull = n - 1;
  const lr = nullDev - fit.deviance, lrDf = rank - 1;
  const aic = -2 * fam.loglik(d.y, fit.mu) + 2 * rank;
  const warnings = aliasWarning(d, struct);
  if (!fit.converged) warnings.push({ code: 'not-converged', message: `The fit did not converge in ${fit.iterations} iterations` });
  const keptCols = struct.keep.map(j => d.columns[j]);
  return {
    fam, off, Xk, fit, warnings,
    result: {
      ...modelMeta(d), coefficients, aliased: struct.aliased.map(j => d.names[j]), rank, level,
      deviance: fit.deviance, dfResidual, nullDeviance: nullDev, dfNull,
      lrTest: lrDf > 0 ? { chisq: lr, df: lrDf, p: 1 - pchisq(lr, lrDf) } : null,
      aic, converged: fit.converged, iterations: fit.iterations,
      vif: vifTable(fit.XtXinv, keptCols), fitted: fit.mu, linearPredictor: fit.eta, warnings,
    },
  };
}

function eventCoder(event) {
  if (event !== undefined && event !== null) {
    const ev = String(event).trim();
    return v => isMissing(v) ? null : (String(v).trim() === ev ? 1 : 0);
  }
  return v => {
    if (isMissing(v)) return null;
    if (v === true || v === false) return v ? 1 : 0;
    const x = Number(String(v).trim());
    if (x === 0 || x === 1) return x;
    throw new Error(`Outcome value '${v}' is not 0/1; choose the event level`);
  };
}

/**
 * Logistic regression by IRLS, as glm(family = binomial).
 * @param {object[]} rows @param {string} outcome @param {object[]} predictors
 * @param {{event?:any, level?:number, profile?:boolean}} [opts] event: the outcome value counted as 1
 *   (otherwise the outcome must be 0/1 or boolean); profile: compute profile-likelihood CIs (default true).
 */
export function logisticRegression(rows, outcome, predictors, opts = {}) {
  const d = designMatrix(rows, outcome, predictors, { outcomeValue: eventCoder(opts.event) });
  const events = d.y.reduce((a, b) => a + b, 0);
  if (d.nUsed && (events === 0 || events === d.nUsed)) throw new Error('The outcome does not vary among the complete cases');
  const { fit, warnings, result } = fitGlm(d, 'binomial', opts);
  // separation: fitted probabilities at 0 or 1, or coefficients that kept growing
  const tiny = 1e-8;
  const extreme = fit.mu.filter(m => m < tiny || m > 1 - tiny).length;
  if (extreme || !fit.converged) warnings.push({
    code: 'separation', fittedAtBounds: extreme,
    message: `Possible complete or quasi-complete separation: ${extreme} fitted probabilit${extreme === 1 ? 'y is' : 'ies are'} numerically 0 or 1; estimates and Wald intervals are unreliable`,
  });
  return {
    family: 'binomial', measure: 'OR', event: opts.event ?? 1, events, ...result,
    hosmerLemeshow: hosmerLemeshow(d.y, fit.mu), cStatistic: cStatistic(d.y, fit.mu), warnings,
  };
}

/**
 * Poisson regression by IRLS, as glm(family = poisson).
 * @param {object[]} rows @param {string} outcome @param {object[]} predictors
 * @param {{offset?:string, exposure?:string, level?:number, profile?:boolean}} [opts]
 *   offset: column already on the log scale (R's offset = log(time)); exposure: column logged here.
 */
export function poissonRegression(rows, outcome, predictors, opts = {}) {
  const d = designMatrix(rows, outcome, predictors, { offset: opts.offset, exposure: opts.exposure });
  if (d.y.some(v => v < 0)) throw new Error('A Poisson outcome cannot be negative');
  const { fit, warnings, result } = fitGlm(d, 'poisson', opts);
  const pearson = d.y.reduce((s, v, i) => s + (v - fit.mu[i]) ** 2 / fit.mu[i], 0);
  const dispersion = result.dfResidual > 0 ? pearson / result.dfResidual : NaN;
  if (dispersion > 1.5) warnings.push({ code: 'overdispersion', dispersion, message: `Pearson dispersion ${dispersion.toFixed(2)} exceeds 1.5; standard errors are too small (consider quasi-Poisson or negative binomial)` });
  return { family: 'poisson', measure: 'RR', ...result, pearsonChisq: pearson, dispersion, warnings };
}

// ---- screen and publication table -------------------------------------------------------

const FIT = { linear: linearRegression, gaussian: linearRegression, logistic: logisticRegression, binomial: logisticRegression, poisson: poissonRegression };

/**
 * Fit one unadjusted model per predictor. Each model uses its own complete cases.
 * @param {'linear'|'logistic'|'poisson'} family
 * @returns {{predictor:string, model:object|null, error?:string}[]}
 */
export function univariableScreen(rows, outcome, predictors, family, opts = {}) {
  const f = FIT[family];
  if (!f) throw new Error(`Unknown family '${family}'`);
  return normalizeSpecs(predictors).map(spec => {
    try { return { predictor: spec.column, model: f(rows, outcome, [spec], opts) }; }
    catch (e) { return { predictor: spec.column, model: null, error: e.message }; }
  });
}

function pick(model, c, ci) {
  if (!c || c.aliased) return { est: null, ci: null, p: null };
  if (model.family === 'gaussian') return { est: c.estimate, ci: c.ci, p: c.p };
  const prof = ci !== 'wald' && c.ratioProfileCI && c.ratioProfileCI.every(v => !Number.isNaN(v));
  return { est: c.ratio, ci: prof ? c.ratioProfileCI : c.ratioCI, p: c.p };
}

/**
 * Rows for a univariable/multivariable publication table. Estimates are OR (logistic),
 * RR (Poisson) or β (linear). A categorical predictor contributes a reference row.
 * @param {{predictor:string, model:object|null}[]} univariable from univariableScreen
 * @param {object|null} multivariable a model result
 * @param {{ci?:'profile'|'wald'}} [opts] interval for ratio models (profile by default, Wald when absent)
 */
export function regressionTable(univariable, multivariable, { ci = 'profile' } = {}) {
  const key = (t, l) => `${t}\u0000${l ?? ''}`;
  const uni = new Map(), specs = new Map(), lv = {};
  for (const u of univariable || []) {
    if (!u.model) continue;
    for (const c of u.model.coefficients) if (c.term !== null) uni.set(key(c.term, c.level), { model: u.model, c });
    for (const s of u.model.predictors) if (!specs.has(s.column)) specs.set(s.column, s);
    Object.assign(lv, u.model.levels);
  }
  const multi = new Map();
  if (multivariable) {
    for (const c of multivariable.coefficients) if (c.term !== null) multi.set(key(c.term, c.level), c);
    Object.assign(lv, multivariable.levels);
  }
  const order = [...(multivariable?.predictors || []), ...(univariable || []).flatMap(u => u.model?.predictors || [])];
  const seen = new Set(), rows = [];
  for (const s of order) {
    if (seen.has(s.column)) continue; seen.add(s.column);
    const levels = s.type === 'categorical' ? lv[s.column] : null;
    const entries = levels ? [{ level: levels.reference, reference: true }, ...levels.levels.filter(l => l !== levels.reference).map(level => ({ level }))]
      : [{ level: null }];
    for (const e of entries) {
      const u = uni.get(key(s.column, e.level)), m = multi.get(key(s.column, e.level));
      const a = u ? pick(u.model, u.c, ci) : { est: null, ci: null, p: null };
      const b = m ? pick(multivariable, m, ci) : { est: null, ci: null, p: null };
      rows.push({
        term: s.column, level: e.level, ...(e.reference ? { reference: true } : {}),
        uniEst: a.est, uniCI: a.ci, uniP: a.p, multiEst: b.est, multiCI: b.ci, multiP: b.p,
        ...((u?.c.aliased || m?.aliased) ? { aliased: true } : {}),
      });
    }
  }
  return rows;
}

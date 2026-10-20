// A pooled single-group proportion computed in JavaScript, as the app's R computes it (lib/pooled-r.mjs proportionScript, run in
// WebR's metafor): the same result list, field for field, without starting R (owner, 2026-10-18: "fast and accurate"). The view
// may show it at once and let R's run replace it; the figures (forest and funnel) stay R's.
//
// It follows metafor 5 step by step:
// - escalc "PLO" with add = 1/2, to = "only0" (0.5 added to the events and non-events of an arm with no events or all events);
//   "PFT" without a correction, back-transformed with transf.ipft.hm at the harmonic mean of all arms' sizes.
// - rma.uni: REML by Fisher scoring from the Hedges start, step-halved at zero, stopped when τ² moves less than 1e-5, at most 100
//   steps, with metafor's check against τ² = 0 (ll0check); DL's moment estimator and EE; both with a design matrix X for the
//   subgroup model (P = W − W X (XᵀWX)⁻¹ XᵀW). Wald intervals and tests with qnorm(0.975); Q, I², H², QM as rma.uni has them.
// - rma.mv(random = ~ 1 | study/arm, method = "REML"), used when the rows hold two arms of one study: the restricted likelihood of
//   the two variances maximised by Newton's method with analytic derivatives (Fisher scoring where the Hessian is not definite),
//   kept at or above zero, to the optimum itself. metafor reaches the same optimum with nlminb on log variances and stops near
//   it, so the two agree to nlminb's tolerance rather than to the last digit (app/test/meta-pool.test.mjs measures it). A study
//   factor with one level is fixed at zero, as metafor fixes it. I² as the script computes it.
// - regtest (Egger, predictor sei), leave1out and confint's Q-profile interval of τ² (R's uniroot, ported: Brent's zeroin with
//   tol = eps^0.25), for the univariate pool only, as the script asks.
// It returns null when a fit does not converge: then R's own fallbacks (Nelder–Mead, then the univariate model) decide, so R's
// result is the one to show. Pure; app/test/meta-pool.test.mjs checks every field against native metafor (bench/proportions).
import { pchisqUpper } from './describe.mjs';
import { usedLevels } from './pooled-r.mjs';

const Z975 = 1.959963984540054;            // qnorm(0.975)
const TOL_ROOT = 2 ** -13;                  // .Machine$double.eps^0.25, uniroot's and confint's default tolerance
const EPS = 2 ** -52;

/** Whether poolProportion gives R's result for these options: logit or Freeman–Tukey; REML, DL or EE. Figures are always R's. */
export const handlesProportion = ({ method = 'REML', transform = 'PLO' } = {}, rows = []) =>
  ['REML', 'DL', 'EE'].includes(method) && ['PLO', 'PFT'].includes(transform) && rows.length >= 2
  && rows.every(r => Number.isInteger(r.events) && Number.isInteger(r.n) && r.n > 0 && r.events >= 0 && r.events <= r.n);

// ---- escalc and the back-transformations ---------------------------------------------------------------------------------------

function escalcRow(transform, x, n) {
  if (transform === 'PFT') return { yi: 0.5 * (Math.asin(Math.sqrt(x / (n + 1))) + Math.asin(Math.sqrt((x + 1) / (n + 1)))), vi: 1 / (4 * n + 2) };
  let a = x, b = n - x;
  if (a === 0 || b === 0) { a += 0.5; b += 0.5; }
  const p = a / (a + b);
  return { yi: Math.log(p / (1 - p)), vi: 1 / a + 1 / b };
}
/** escalc("PLO", xi = events, ni = n, add = 1/2, to = "only0") for one arm: `{ yi, vi }`, 0.5 added to events and non-events when either is 0. */
export const escalcPLO = (events, n) => escalcRow('PLO', events, n);
/** escalc("PFT", xi = events, ni = n) for one arm: the Freeman–Tukey double arcsine, no correction. */
export const escalcPFT = (events, n) => escalcRow('PFT', events, n);
const plogis = x => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const pft = (p, n) => { const x = p * n; return 0.5 * (Math.asin(Math.sqrt(x / (n + 1))) + Math.asin(Math.sqrt((x + 1) / (n + 1)))); };
/** metafor's transf.ipft.hm at the harmonic mean `nhm`: NaN becomes null, then values beyond the ends become 0 or 1. */
function ipftHm(x, nhm) {
  if (x == null || Number.isNaN(x)) return null;
  const s = Math.sin(2 * x);
  let z = 0.5 * (1 - Math.sign(Math.cos(2 * x)) * Math.sqrt(1 - (s + (s - 1 / s) / nhm) ** 2));
  if (Number.isNaN(z)) z = null;
  if (x > pft(1, nhm)) z = 1;
  if (x < pft(0, nhm)) z = 0;
  return z;
}

// ---- small dense linear algebra ------------------------------------------------------------------------------------------------

/** The inverse of a symmetric positive definite matrix (Cholesky), or null when it is not. */
function invSPD(A) {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let m = 0; m < j; m++) d -= L[j][m] * L[j][m];
    if (!(d > 0)) return null;
    L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) { let s = A[i][j]; for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m]; L[i][j] = s / L[j][j]; }
  }
  const Li = L.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    Li[i][i] = 1 / L[i][i];
    for (let j = 0; j < i; j++) { let s = 0; for (let m = j; m < i; m++) s -= L[i][m] * Li[m][j]; Li[i][j] = s / L[i][i]; }
  }
  const out = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let m = i; m < n; m++) s += Li[m][i] * Li[m][j]; out[i][j] = out[j][i] = s; }
  return out;
}
const logDetSPD = A => {   // log|A| by Cholesky
  const n = A.length, L = A.map(() => new Array(n).fill(0)); let ld = 0;
  for (let j = 0; j < n; j++) {
    let d = A[j][j]; for (let m = 0; m < j; m++) d -= L[j][m] * L[j][m];
    L[j][j] = Math.sqrt(d); ld += Math.log(d);
    for (let i = j + 1; i < n; i++) { let s = A[i][j]; for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m]; L[i][j] = s / L[j][j]; }
  }
  return ld;
};
/** XᵀAX and XᵀAy for a k×k weight matrix A given as a function of (i, j) over its non-zero pattern `pairs`. */
function gls(X, y, Ainv) {
  const k = X.length, p = X[0].length, AX = X.map(() => new Array(p).fill(0)), Ay = new Array(k).fill(0);
  for (let i = 0; i < k; i++) for (const [j, a] of Ainv[i]) { Ay[i] += a * y[j]; for (let c = 0; c < p; c++) AX[i][c] += a * X[j][c]; }
  const XtAX = Array.from({ length: p }, (_, r) => Array.from({ length: p }, (_, c) => X.reduce((s, x, i) => s + x[r] * AX[i][c], 0)));
  const XtAy = Array.from({ length: p }, (_, r) => X.reduce((s, x, i) => s + x[r] * Ay[i], 0));
  return { AX, Ay, XtAX, XtAy };
}
/** P = A − A X (XᵀAX)⁻¹ XᵀA as a dense k×k matrix, with (XᵀAX)⁻¹; A sparse by rows (`[[j, a], ...]`). */
function projection(X, Ainv) {
  const k = X.length, p = X[0].length, { AX, XtAX } = gls(X, new Array(k).fill(0), Ainv), S = invSPD(XtAX);
  if (!S) return null;
  const P = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) for (const [j, a] of Ainv[i]) P[i][j] += a;
  const AXS = AX.map(r => Array.from({ length: p }, (_, c) => r.reduce((s, v, m) => s + v * S[m][c], 0)));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { let s = 0; for (let c = 0; c < p; c++) s += AXS[i][c] * AX[j][c]; P[i][j] -= s; }
  return { P, S };
}
const diagW = w => w.map((x, i) => [[i, x]]);
const mulVec = (P, y) => P.map(r => r.reduce((s, v, j) => s + v * y[j], 0));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const trace = P => P.reduce((s, r, i) => s + r[i], 0);
const sumSq = P => P.reduce((s, r) => s + r.reduce((t, v) => t + v * v, 0), 0);

// ---- rma.uni ------------------------------------------------------------------------------------------------------------------

/** τ² of rma.uni, or null when REML does not converge (metafor stops with an error). */
function uniTau2(y, v, X, method) {
  const k = y.length, p = X[0].length;
  if (method === 'EE' || k === 1) return 0;
  if (method === 'DL') {
    const { P } = projection(X, diagW(v.map(x => 1 / x)));
    return Math.max(0, (dot(y, mulVec(P, y)) - (k - p)) / trace(P));
  }
  // REML: the Hedges (HE) start, Fisher scoring
  const P0 = projection(X, diagW(new Array(k).fill(1))).P;
  let tau2 = Math.max(0, (dot(y, mulVec(P0, y)) - P0.reduce((s, r, i) => s + r[i] * v[i], 0)) / (k - p));
  let change = 1e-5 + 1, iter = 0;
  while (change > 1e-5) {
    iter++;
    const old = tau2, { P } = projection(X, diagW(v.map(x => 1 / (x + tau2)))), Py = mulVec(P, y);
    let adj = (dot(Py, Py) - trace(P)) / sumSq(P);
    if (Number.isNaN(adj)) adj = 0;
    while (tau2 + adj < 0) adj /= 2;
    tau2 += adj; change = Math.abs(old - tau2);
    if (iter > 100) return null;
  }
  // metafor's ll0check: τ² = 0 when the likelihood there is higher by more than tol
  const llR = t => {
    const w = v.map(x => 1 / (x + t)), { XtAX, XtAy } = gls(X, y, diagW(w)), S = invSPD(XtAX);
    const b = S.map(r => dot(r, XtAy)), rss = y.reduce((s, yi, i) => s + w[i] * (yi - dot(X[i], b)) ** 2, 0);
    return -0.5 * (k - p) * Math.log(2 * Math.PI) - 0.5 * v.reduce((s, x) => s + Math.log(x + t), 0) - 0.5 * logDetSPD(XtAX) - 0.5 * rss;
  };
  if (llR(0) - llR(tau2) > TOL_ROOT && tau2 > 1e-5) tau2 = 0;
  return Math.max(0, tau2);
}

/** Q, its p, I², H² and the typical within-study variance, as rma.uni computes them. */
function heterogeneity(y, v, X, method, tau2) {
  const k = y.length, p = X[0].length;
  if (k <= p) return { QE: 0, QEp: 1, I2: 0, H2: 1, vt: 0 };
  const { P } = projection(X, diagW(v.map(x => 1 / x)));
  const QE = Math.max(0, dot(y, mulVec(P, y))), vt = (k - p) / trace(P);
  return { QE, QEp: pchisqUpper(QE, k - p), vt, trP: trace(P),
    I2: method === 'EE' ? Math.max(0, 100 * (QE - (k - p)) / QE) : 100 * tau2 / (vt + tau2),
    H2: method === 'EE' ? QE / (k - p) : tau2 / vt + 1 };
}

function finish(y, v, X, Minv, fields) {
  const { XtAX, XtAy } = gls(X, y, Minv), vb = invSPD(XtAX);
  if (!vb) return null;
  const beta = vb.map(r => dot(r, XtAy)), se = vb.map((r, i) => Math.sqrt(r[i])), p = beta.length;
  let QM = 0;
  if (p > 1) { const sub = invSPD(vb.slice(1).map(r => r.slice(1))), b = beta.slice(1); QM = sub ? dot(b, mulVec(sub, b)) : NaN; }
  return { ...fields, beta, se, vb, k: y.length, p, ci_lb: beta[0] - Z975 * se[0], ci_ub: beta[0] + Z975 * se[0],
    QM, QMdf: p - 1, QMp: p > 1 ? pchisqUpper(QM, p - 1) : null };
}

function rmaUni(y, v, X, method) {
  const tau2 = uniTau2(y, v, X, method);
  if (tau2 == null) return null;
  const w = v.map(x => 1 / (x + tau2)), h = heterogeneity(y, v, X, method, tau2);
  return finish(y, v, X, diagW(w), { ml: false, method, tau2, ...h, wi: w, y, v, X });
}

/**
 * rma.uni(yi, vi, mods = X, method) as metafor 5 computes it, with Wald (z) tests and 95% intervals. `X` is the whole design matrix,
 * one row per study with its intercept column first, as model.matrix(~ g) gives it (default: intercept only). QM is metafor's
 * omnibus test of the coefficients after the intercept (of the intercept itself when X has one column). `weights` are percent of
 * 1/(vi + τ²). Null when REML does not converge in 100 Fisher scoring steps or XᵀWX is singular (metafor stops with an error then).
 */
export function fitRma(yi, vi, { method = 'REML', X = null } = {}) {
  if (!['REML', 'DL', 'EE'].includes(method)) throw new Error(`fitRma: method ${method} is R's`);
  const k = yi.length, D = X || yi.map(() => [1]);
  if (!k || vi.length !== k || D.length !== k || !(vi.every(v => v > 0))) return null;
  const m = rmaUni(yi, vi, D, method);
  if (!m) return null;
  const { beta, vb, se, p } = m, btt = p > 1 ? beta.map((_, i) => i).slice(1) : [0];
  const sub = invSPD(btt.map(i => btt.map(j => vb[i][j]))), bb = btt.map(i => beta[i]);
  const QM = sub ? dot(bb, mulVec(sub, bb)) : NaN, zval = beta.map((b, i) => b / se[i]), sw = m.wi.reduce((s, x) => s + x, 0);
  return { beta, vb, se, zval, pval: zval.map(z => pchisqUpper(z * z, 1)),
    ci_lb: beta.map((b, i) => b - Z975 * se[i]), ci_ub: beta.map((b, i) => b + Z975 * se[i]), tau2: m.tau2,
    QE: m.QE, QEp: m.QEp, QM, QMp: pchisqUpper(QM, btt.length), QMdf: btt.length, I2: m.I2, H2: m.H2, k, p, method,
    weights: m.wi.map(w => 100 * w / sw) };
}

// ---- rma.mv(random = ~ 1 | study/arm, method = "REML") --------------------------------------------------------------------------

/** M⁻¹ of M = diag(v) + s1·ZZᵀ + s2·I, block by study (Sherman–Morrison), as sparse rows, with log|M|. */
function mvInverse(v, groups, s1, s2) {
  const k = v.length, rowsOut = Array.from({ length: k }, () => []); let logDet = 0;
  for (const g of groups) {
    const d = g.map(i => v[i] + s2), sInv = d.reduce((s, x) => s + 1 / x, 0), c = s1 / (1 + s1 * sInv);
    logDet += d.reduce((s, x) => s + Math.log(x), 0) + Math.log(1 + s1 * sInv);
    g.forEach((i, a) => g.forEach((j, b) => rowsOut[i].push([j, (a === b ? 1 / d[a] : 0) - c / (d[a] * d[b])])));
  }
  return { Minv: rowsOut, logDet };
}

function rmaMv(y, v, X, study) {
  const k = y.length, p = X[0].length, ids = [...new Set(study)];
  const groups = ids.map(s => study.map((x, i) => (x === s ? i : -1)).filter(i => i >= 0));
  const fix1 = ids.length === 1;                       // a single-level factor: metafor fixes its variance at 0
  const ll = s => {
    const { Minv, logDet } = mvInverse(v, groups, s[0], s[1]), pr = projection(X, Minv);
    if (!pr) return { val: -Infinity };
    const Py = mulVec(pr.P, y), { XtAX } = gls(X, y, Minv);
    return { val: -0.5 * (logDet + logDetSPD(XtAX) + dot(y, Py)), P: pr.P, Py, Minv };
  };
  // derivatives of the restricted log-likelihood in (σ²_study, σ²_arm): D1 = ZZᵀ, D2 = I
  const derivs = ({ P, Py }) => {
    const groupSum = vec => groups.map(g => g.reduce((s, i) => s + vec[i], 0));
    const D1 = vec => { const gs = groupSum(vec), out = new Array(k); groups.forEach((g, a) => g.forEach(i => { out[i] = gs[a]; })); return out; };
    const PD1 = P.map(r => D1(r));                      // (P D1)ᵢⱼ: row i of P summed over j's study; P D2 = P
    const A = [PD1, P], u = [D1(Py), Py];
    const g = [0, 1].map(j => -0.5 * trace(A[j]) + 0.5 * dot(Py, u[j]));
    const trAB = (Am, Bm) => { let s = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) s += Am[i][j] * Bm[j][i]; return s; };
    const F = [[0.5 * trAB(A[0], A[0]), 0.5 * trAB(A[0], A[1])], [0, 0.5 * trAB(A[1], A[1])]]; F[1][0] = F[0][1];
    // observed information: −∂²ℓ/∂σⱼ∂σₗ = −½ tr(P Dⱼ P Dₗ) + yᵀP Dⱼ P Dₗ P y
    const Pu = u.map(x => mulVec(P, x));
    const Iobs = [[-F[0][0] + dot(u[0], Pu[0]), -F[0][1] + dot(u[0], Pu[1])], [-F[1][0] + dot(u[1], Pu[0]), -F[1][1] + dot(u[1], Pu[1])]];
    return { g, F, Iobs };
  };
  const solve = (M, b, free) => {
    if (free.length === 1) { const j = free[0], d = M[j][j]; return d > 0 ? { [j]: b[j] / d } : null; }
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    if (!(M[0][0] > 0 && det > 0)) return null;
    return { 0: (M[1][1] * b[0] - M[0][1] * b[1]) / det, 1: (M[0][0] * b[1] - M[1][0] * b[0]) / det };
  };
  // start: the univariate REML τ², shared out
  const t0 = uniTau2(y, v, X, 'REML') ?? 0.1, start = Math.max(t0, 1e-2) / 2;
  let s = fix1 ? [0, 2 * start] : [start, start], cur = ll(s), done = false;
  for (let it = 0; it < 300 && !done; it++) {
    const d = derivs(cur);
    const free = [0, 1].filter(j => !(j === 0 && fix1) && !(s[j] <= 0 && d.g[j] <= 0));
    if (!free.length) { done = true; break; }
    const step = solve(d.Iobs, d.g, free) || solve(d.F, d.g, free);
    if (!step) return null;
    let t = 1, next = null;
    for (let h = 0; h < 60; h++, t /= 2) {
      const cand = [0, 1].map(j => (free.includes(j) ? Math.max(0, s[j] + t * step[j]) : s[j]));
      const c = ll(cand);
      if (c.val >= cur.val) { next = { cand, c }; break; }
    }
    if (!next) { done = true; break; }                  // no further ascent: at the optimum to rounding
    const moved = Math.max(...[0, 1].map(j => Math.abs(next.cand[j] - s[j])));
    s = next.cand; cur = next.c;
    if (moved <= 1e-13 * Math.max(s[0] + s[1], 1e-8)) done = true;
  }
  if (!done) return null;
  const h = heterogeneity(y, v, X, 'REML', 0);
  const i2 = 100 * (s[0] + s[1]) / (s[0] + s[1] + (k - p) / h.trP);
  const wDiag = cur.Minv.map((r, i) => r.find(([j]) => j === i)[1]);
  return finish(y, v, X, cur.Minv, { ml: true, method: 'REML', sigma2: s, tau2: s[0] + s[1], QE: h.QE, QEp: h.QEp, I2: i2, wi: wDiag, y, v, X });
}

// ---- regtest, leave1out, confint (Q-profile) ------------------------------------------------------------------------------------

/** R's zeroin (src/library/stats/src/zeroin.c, R_zeroin2) as uniroot calls it: the root, or null when it fails. */
function zeroin(f, ax, bx, fa, fb, tol = TOL_ROOT, maxit = 1000) {
  let a = ax, b = bx, c = a, fc = fa, it = maxit + 1;
  if (fa === 0) return a;
  if (fb === 0) return b;
  while (it--) {
    const prevStep = b - a;
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tolAct = 2 * EPS * Math.abs(b) + tol / 2;
    let newStep = (c - b) / 2;
    if (Math.abs(newStep) <= tolAct || fb === 0) return b;
    if (Math.abs(prevStep) >= tolAct && Math.abs(fa) > Math.abs(fb)) {
      let p, q;
      const cb = c - b;
      if (a === c) { const t1 = fb / fa; p = cb * t1; q = 1 - t1; } else {
        const qq = fa / fc, t1 = fb / fc, t2 = fb / fa;
        p = t2 * (cb * qq * (qq - t1) - (b - a) * (t1 - 1)); q = (qq - 1) * (t1 - 1) * (t2 - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (p < 0.75 * cb * q - Math.abs(tolAct * q) / 2 && p < Math.abs(prevStep * q / 2)) newStep = p / q;
    }
    if (Math.abs(newStep) < tolAct) newStep = newStep > 0 ? tolAct : -tolAct;
    a = b; fa = fb; b += newStep; fb = f(b);
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) { c = a; fc = fa; }
  }
  return null;
}
/** The chi-square quantile with lower-tail probability `p` (lower) or upper-tail `p` (upper), by bisection to the last bit. */
function qchisq(p, df, upper) {
  const tail = x => (upper ? pchisqUpper(x, df) : 1 - pchisqUpper(x, df));
  let lo = 0, hi = Math.max(10, 4 * df);
  while ((upper ? tail(hi) > p : tail(hi) < p)) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (m === lo || m === hi) break;
    if ((upper ? tail(m) > p : tail(m) < p)) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
/** confint(r)$random for a univariate REML or DL fit (type "qp", level 95%): τ², I² and H² with their bounds, or null. */
function qProfile(fit) {
  const { y, v, X, k, p, tau2, vt } = fit;
  const QEf = t => { const { P } = projection(X, diagW(v.map(x => 1 / (x + t)))); return dot(y, mulVec(P, y)); };
  const tmin = Math.min(0, tau2), tmax = Math.max(100, tau2 * 10, tmin * 10);
  const critU = qchisq(0.025, k - p, true), critL = qchisq(0.025, k - p, false);
  const qMax = QEf(tmax), qMin = QEf(tmin);
  const root = obj => { const fl = qMin - obj, fu = qMax - obj; return fl * fu > 0 ? null : zeroin(t => QEf(t) - obj, tmin, tmax, fl, fu); };
  let lb = null, ub = null;
  if (qMin < critL) { lb = tmin; ub = tmin; } else ub = qMax > critL ? tmax : root(critL);
  if (qMax > critU) { lb = tmax; ub = tmax; } else lb = qMin < critU ? tmin : root(critU);
  const i2 = t => (t == null ? null : 100 * t / (vt + t)), h2 = t => (t == null ? null : t / vt + 1);
  return { tau2_lo: lb, tau2_hi: ub, i2_lo: i2(lb), i2_hi: i2(ub), h2: fit.H2, h2_lo: h2(lb), h2_hi: h2(ub) };
}

// ---- the script's result ----------------------------------------------------------------------------------------------------------

/**
 * The pooled proportion of `rows` (`{ label, study, events, n, level }`) with the fields of proportionScript's R list (figures
 * excepted), or null when a fit does not converge (R's fallbacks decide then). `engine: 'js'` marks it.
 */
export function poolProportion(rows, { method = 'REML', subgroups = false, order = [], transform = 'PLO' } = {}) {
  if (!handlesProportion({ method, transform }, rows)) return null;
  const es = rows.map(r => escalcRow(transform, r.events, r.n)), yAll = es.map(e => e.yi), vAll = es.map(e => e.vi);
  const study = rows.map(r => String(r.study ?? '')), ml = method === 'REML';
  const nhm = 1 / (rows.reduce((s, r) => s + 1 / r.n, 0) / rows.length);
  const tf = x => (x == null || Number.isNaN(x) ? null : transform === 'PFT' ? ipftHm(x, nhm) : plogis(x));
  const tp = x => { const t = tf(x); return t == null ? null : 100 * t; };
  const dup = idx => new Set(idx.map(i => study[i])).size < idx.length;
  const fit = (idx, groups = null) => {
    const y = idx.map(i => yAll[i]), v = idx.map(i => vAll[i]);
    const X = idx.map(i => (groups ? [1, ...groups.slice(1).map(l => (rows[i].level === l ? 1 : 0))] : [1]));
    return ml && dup(idx) ? rmaMv(y, v, X, idx.map(i => study[i])) : rmaUni(y, v, X, method);
  };
  const dep = (idx, m) => (m.ml ? 'multilevel' : dup(idx) ? 'independent' : 'one arm per study');
  const i2of = m => m.I2;
  const all = rows.map((_, i) => i), r = fit(all);
  if (!r) return null;
  const piSe = Math.sqrt(r.se[0] ** 2 + r.tau2), b = r.beta[0], k = r.k;
  const out = {
    estimate: tf(b), lo: tf(r.ci_lb), hi: tf(r.ci_ub),
    ...(method === 'EE' ? {} : { pi_lo: tf(b - Z975 * piSe), pi_hi: tf(b + Z975 * piSe) }),
    logit: b, logit_se: r.se[0], i2: i2of(r), tau2: r.tau2, ...(r.ml ? { sigma2: r.sigma2 } : {}),
    q: r.QE, qp: r.QEp, k, studies: new Set(study).size, dependence: dep(all, r), ...(r.ml ? { optimizer: 'Newton (JavaScript)' } : {}),
    weights: r.wi.map(w => 100 * w / r.wi.reduce((s, x) => s + x, 0)),
    study_est: yAll.map(tp), study_lo: yAll.map((y, i) => tp(y - Z975 * Math.sqrt(vAll[i]))), study_hi: yAll.map((y, i) => tp(y + Z975 * Math.sqrt(vAll[i]))),
    xi: rows.map(x => x.events), ni: rows.map(x => x.n)
  };
  if (!r.ml && k >= 3) {
    // regtest(r): rma.uni with sei as a moderator, the same estimator; NULL when it fails
    const eg = rmaUni(r.y, r.v, r.y.map((_, i) => [1, Math.sqrt(r.v[i])]), method);
    if (eg) { const z = eg.beta[1] / eg.se[1]; out.egger_z = z; out.egger_p = pchisqUpper(z * z, 1); }
  }
  if (!r.ml && (method === 'REML' || method === 'DL')) Object.assign(out, qProfile(r));
  if (!r.ml && k >= 3) {
    const loo = all.map(i => fit(all.filter(j => j !== i)));
    out.loo_est = loo.map(m => (m ? tf(m.beta[0]) : null)); out.loo_lo = loo.map(m => (m ? tf(m.ci_lb) : null));
    out.loo_hi = loo.map(m => (m ? tf(m.ci_ub) : null)); out.loo_i2 = loo.map(m => (m ? m.I2 : null));
  }
  const levels = subgroups ? usedLevels(rows, order) : [];
  if (levels.length >= 2) {
    const has = all.filter(i => levels.includes(rows[i].level));
    const rg = fit(has, levels), subIdx = levels.map(l => all.filter(i => rows[i].level === l)), sub = subIdx.map(idx => fit(idx));
    if (!rg || sub.some(m => !m)) return null;
    Object.assign(out, {
      mod_kind: 'group', mod_levels: levels, mod_k: sub.map(m => m.k), mod_studies: subIdx.map(idx => new Set(idx.map(i => study[i])).size),
      mod_est: sub.map(m => tf(m.beta[0])), mod_lo: sub.map(m => tf(m.ci_lb)), mod_hi: sub.map(m => tf(m.ci_ub)),
      mod_i2: sub.map(i2of), mod_tau2: sub.map(m => m.tau2), mod_dependence: subIdx.map((idx, j) => dep(idx, sub[j])),
      mod_unassigned: rows.length - has.length, qm: rg.QM, qmp: rg.QMp, qm_df: rg.QMdf, qm_dependence: dep(has, rg) });
  }
  out.engine = 'js';
  return out;
}

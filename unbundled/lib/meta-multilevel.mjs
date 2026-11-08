// Nested random-effects meta-analysis in JavaScript: metafor's rma.mv(yi, vi, mods, random = ~ 1 | a / b / c, method = "REML", test = "t",
// dfs = "contain") for independent sampling errors (V diagonal), as a review with several outcomes per trial fits it (outcomes in trials, or
// outcomes in trials in classes). M = diag(vi) + Σ σ²ₗ Zₗ Zₗᵀ, where Zₗ marks the rows of each group of level l (a group is its own label and
// those of every level above it). The restricted likelihood is maximised by Fisher scoring with step-halving, each σ² kept at or above zero,
// to the optimum (metafor stops nlminb near it, so the two agree to its tolerance). Coefficients by generalised least squares; the model's
// covariance (XᵀM⁻¹X)⁻¹; t tests on the containment df. M is returned for the cluster-robust variance (lib/meta-cr2.mjs).
// app/test/meta-multilevel.test.mjs checks it against vendored metafor 5.0-1 in WebR (bench/multilevel/oracle.mjs). Pure.
import { pt2, qt975 } from './meta-general.mjs';
import { pchisqUpper } from './describe.mjs';

// ---- dense linear algebra, small (k up to a few hundred) ------------------------------------------------------------------------
export const zeros = (n, m = n) => Array.from({ length: n }, () => new Array(m).fill(0));
export const ident = n => zeros(n).map((r, i) => { r[i] = 1; return r; });
export const transpose = A => A[0].map((_, j) => A.map(r => r[j]));
export function mul(A, B) {
  const n = A.length, m = B[0].length, q = B.length, out = zeros(n, m);
  for (let i = 0; i < n; i++) { const Ai = A[i], Oi = out[i]; for (let t = 0; t < q; t++) { const a = Ai[t]; if (!a) continue; const Bt = B[t]; for (let j = 0; j < m; j++) Oi[j] += a * Bt[j]; } }
  return out;
}
export const mulVec = (A, x) => A.map(r => r.reduce((s, a, j) => s + a * x[j], 0));
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
/** Upper Cholesky factor U (UᵀU = A), or null when A is not positive definite. */
export function cholU(A) {
  const n = A.length, U = zeros(n);
  for (let j = 0; j < n; j++) {
    let s = A[j][j]; for (let k = 0; k < j; k++) s -= U[k][j] * U[k][j];
    if (!(s > 0)) return null;
    U[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i++) { let t = A[j][i]; for (let k = 0; k < j; k++) t -= U[k][j] * U[k][i]; U[j][i] = t / U[j][j]; }
  }
  return U;
}
/** The inverse of a symmetric positive definite matrix and its log determinant, or null. */
export function invSPD(A) {
  const U = cholU(A); if (!U) return null;
  const n = A.length, Ui = zeros(n);
  for (let i = n - 1; i >= 0; i--) { Ui[i][i] = 1 / U[i][i]; for (let j = i + 1; j < n; j++) { let s = 0; for (let k = i + 1; k <= j; k++) s += U[i][k] * Ui[k][j]; Ui[i][j] = -s / U[i][i]; } }
  const inv = zeros(n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { let s = 0; for (let k = j; k < n; k++) s += Ui[i][k] * Ui[j][k]; inv[i][j] = inv[j][i] = s; }
  let logDet = 0; for (let i = 0; i < n; i++) logDet += 2 * Math.log(U[i][i]);
  return { inv, logDet };
}
/** Eigen decomposition of a symmetric matrix by cyclic Jacobi rotations: { values, vectors } (vectors as columns). */
export function eigenSym(S) {
  const n = S.length, A = S.map(r => r.slice()), V = ident(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

// ---- the model -----------------------------------------------------------------------------------------------------------------
/** Group index per row for each level: a group is the row's label at that level joined with every label above it. */
export function nestedGroups(levels) {
  return levels.map((_, l) => {
    const keys = levels[0].map((__, i) => levels.slice(0, l + 1).map(lv => String(lv[i])).join('\u0001'));
    const ids = [...new Set(keys)];
    return { ids, of: keys.map(k => ids.indexOf(k)) };
  });
}
const marginal = (vi, groups, s2) => {
  const k = vi.length, M = zeros(k);
  for (let i = 0; i < k; i++) M[i][i] = vi[i];
  groups.forEach((g, l) => { if (!s2[l]) return; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (g.of[i] === g.of[j]) M[i][j] += s2[l]; });
  return M;
};
/** M⁻¹ and log|M|, block by block of the outermost level (M is block diagonal there). */
function blockInverse(M, blocks) {
  const k = M.length, W = zeros(k); let logDet = 0;
  for (const b of blocks) {
    const inv = invSPD(b.map(i => b.map(j => M[i][j]))); if (!inv) return null;
    logDet += inv.logDet; b.forEach((i, a) => b.forEach((j, c) => { W[i][j] = inv.inv[a][c]; }));
  }
  return { inv: W, logDet };
}
function restricted(y, vi, X, groups, s2, blocks) {
  const M = marginal(vi, groups, s2), Mi = blockInverse(M, blocks); if (!Mi) return null;
  const W = Mi.inv, WX = mul(W, X), XtWX = mul(transpose(X), WX), F = invSPD(XtWX); if (!F) return null;
  // P = W − WX (XᵀWX)⁻¹ XᵀW
  const B = mul(WX, F.inv), P = W.map((r, i) => r.map((w, j) => w - dot(B[i], WX[j])));
  const Py = mulVec(P, y);
  return { M, W, P, Py, XtWX, vb: F.inv, ll: -0.5 * (Mi.logDet + F.logDet + dot(y, Py)) };
}

/**
 * fitMultilevel({ yi, vi, levels: [labels of the outer level, …, of the inner level], X? }): { beta, vb, se, df, tval, pval, ci_lb, ci_ub,
 * sigma2, logLik (REML, metafor's constant), QE, QEp, M, X, yi, vi, k, p, levels: [groups per level], iterations } or null when the fit
 * fails. A level whose groups are each one row of the level above holds the same variance as it; σ² of a level with one group is fixed at 0,
 * as metafor fixes it.
 */
export function fitMultilevel({ yi, vi, levels, X = null, maxIter = 1000 }) {
  const k = yi.length, D = X || yi.map(() => [1]), p = D[0].length;
  if (!k || vi.length !== k || !vi.every(v => v > 0) || k <= p) return null;
  // a level whose groups are those of the level above (one outcome per trial) is not separately identified: it is fitted as one level and the
  // variance shared equally, where metafor's optimiser ends on that flat ridge from its equal start
  const all = nestedGroups(levels), keep = all.map((g, l) => l === 0 || g.ids.length !== all[l - 1].ids.length);
  const share = []; all.forEach((g, l) => { if (keep[l]) share.push(1); else share[share.length - 1]++; });
  if (share.some(n => n > 1)) {
    const f = fitMultilevel({ yi, vi, levels: levels.filter((_, l) => keep[l]), X, maxIter });
    if (!f) return null;
    return { ...f, sigma2: f.sigma2.flatMap((x, i) => new Array(share[i]).fill(x / share[i])), levels: all.map(g => g.ids.length), shared: share };
  }
  const L = levels.length, groups = all, fixed = groups.map(g => g.ids.length === 1);
  const Dl = groups.map(g => ({ of: g.of, members: g.ids.map((_, a) => g.of.map((x, i) => (x === a ? i : -1)).filter(i => i >= 0)) }));
  // P Dₗ: column j of P Dₗ is the sum of P's columns over j's group at level l
  const PD = (P, l) => { const { of, members } = Dl[l]; return P.map(r => { const gs = members.map(m => m.reduce((s, i) => s + r[i], 0)); return of.map(a => gs[a]); }); };
  const Dvec = (v, l) => { const { of, members } = Dl[l]; const gs = members.map(m => m.reduce((s, i) => s + v[i], 0)); return of.map(a => gs[a]); };
  const blocks = groups[0].ids.map((_, a) => groups[0].of.map((x, i) => (x === a ? i : -1)).filter(i => i >= 0));
  let s2 = groups.map((g, l) => (fixed[l] ? 0 : 0.1)), cur = restricted(yi, vi, D, groups, s2, blocks), it = 0;
  if (!cur) return null;
  for (; it < maxIter; it++) {
    const A = groups.map((_, l) => PD(cur.P, l)), u = groups.map((_, l) => Dvec(cur.Py, l));
    const g = A.map((Al, l) => -0.5 * Al.reduce((s, r, i) => s + r[i], 0) + 0.5 * dot(cur.Py, u[l]));
    const F = A.map(Al => A.map(Am => { let s = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) s += Al[i][j] * Am[j][i]; return 0.5 * s; }));
    const free = groups.map((_, l) => l).filter(l => !fixed[l] && !(s2[l] <= 0 && g[l] <= 0));
    if (!free.length) break;
    const Fi = invSPD(free.map(a => free.map(b => F[a][b])));
    if (!Fi) return null;
    const step = mulVec(Fi.inv, free.map(l => g[l]));
    let t = 1, next = null;
    for (let h = 0; h < 60; h++, t /= 2) {
      const cand = s2.slice(); free.forEach((l, a) => { cand[l] = Math.max(0, s2[l] + t * step[a]); });
      const c = restricted(yi, vi, D, groups, cand, blocks);
      if (c && c.ll >= cur.ll - 1e-14) { next = { cand, c }; break; }
    }
    if (!next) break;
    const moved = Math.max(...next.cand.map((x, l) => Math.abs(x - s2[l])));
    s2 = next.cand; cur = next.c;
    if (moved <= 1e-12 * Math.max(1e-6, ...s2)) break;
  }
  const { vb, M, W } = cur, beta = mulVec(vb, mulVec(transpose(D), mulVec(W, yi))), se = vb.map((r, i) => Math.sqrt(r[i]));
  // containment df (metafor dfs = "contain"): a coefficient constant within the groups of a level is tested on that level's groups less p
  const df = D[0].map((_, j) => {
    for (let l = 0; l < L; l++) {
      const val = new Map(); let constant = true;
      for (let i = 0; i < k; i++) { const gi = groups[l].of[i]; if (!val.has(gi)) val.set(gi, D[i][j]); else if (val.get(gi) !== D[i][j]) { constant = false; break; } }
      if (constant) return groups[l].ids.length - p;
    }
    return k - p;
  });
  const tval = beta.map((b, j) => b / se[j]);
  // QE: the residual heterogeneity test from the sampling variances alone
  const w0 = vi.map(v => 1 / v), Xw = D.map((r, i) => r.map(x => x * w0[i])), F0 = invSPD(mul(transpose(D), Xw));
  const b0 = F0 ? mulVec(F0.inv, mulVec(transpose(Xw), yi)) : null;
  const QE = b0 ? yi.reduce((s, y, i) => s + w0[i] * (y - dot(D[i], b0)) ** 2, 0) : NaN;
  const XtX = invSPD(mul(transpose(D), D));
  const logLik = cur.ll - 0.5 * (k - p) * Math.log(2 * Math.PI) + (XtX ? 0.5 * XtX.logDet : 0);   // metafor's REML constant: + ½ log|XᵀX|
  return { beta, vb, se, df, tval, pval: tval.map((t, j) => pt2(t, df[j])), ci_lb: beta.map((b, j) => b - qt975(df[j]) * se[j]),
    ci_ub: beta.map((b, j) => b + qt975(df[j]) * se[j]), sigma2: s2, logLik, QE, QEp: pchisqUpper(QE, k - p), QEdf: k - p, M, X: D, yi, vi, k, p,
    levels: groups.map(g => g.ids.length), iterations: it };
}

/** The model's prediction of the mean effect (intercept-only fit): estimate, CI and PI on the t of the containment df, as predict() gives them. */
export function predictMean(fit) {
  const t = qt975(fit.df[0]), tot = fit.sigma2.reduce((s, x) => s + x, 0), se = fit.se[0];
  return { pred: fit.beta[0], se, ci_lb: fit.beta[0] - t * se, ci_ub: fit.beta[0] + t * se, pi_lb: fit.beta[0] - t * Math.sqrt(se * se + tot), pi_ub: fit.beta[0] + t * Math.sqrt(se * se + tot) };
}
/** Likelihood-ratio test of two REML fits with the same fixed effects (anova(full, reduced, refit = FALSE)). */
export function lrt(full, reduced) {
  const LRT = Math.max(0, 2 * (full.logLik - reduced.logLik)), df = full.sigma2.length - reduced.sigma2.length;
  return { LRT, df, p: pchisqUpper(LRT, df) };
}

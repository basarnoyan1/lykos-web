// The CR2 cluster-robust variance of a meta-analysis or meta-regression, with Satterthwaite degrees of freedom for one coefficient (or contrast)
// and the HTZ test for several (Pustejovsky & Tipton 2018, J Bus Econ Stat 36:672; Tipton & Pustejovsky 2015, J Educ Behav Stat 40:604).
// What clubSandwich's coef_test and Wald_test give for an rma.mv fit, written out because clubSandwich is not in the vendored R library:
// a line-for-line port of the sham-response review's lib-cr2.R (validated there against hand-computed results and a Monte Carlo of the
// working model; app/test/meta-cr2.test.mjs repeats those checks with fixed numbers). The working model is the fitted marginal covariance
// Φ = M (lib/meta-multilevel.mjs), weights W = Φ⁻¹. Pure.
import { zeros, ident, mul, mulVec, transpose, dot, cholU, invSPD, eigenSym } from './meta-multilevel.mjs';
import { pt2, qt975, pfUpper } from './meta-general.mjs';

const sub = (A, rows, cols) => rows.map(i => cols.map(j => A[i][j]));

/** The parts every CR2 quantity is built from: { b, V (CR2), Vmodel, E (one p × N matrix per cluster), Phi, A, X, y, J, ids, cl }. */
export function cr2Parts(fit, cluster) {
  const X = fit.X, y = fit.yi, N = y.length, Phi = fit.M || fit.vi.map((v, i) => fit.vi.map((_, j) => (i === j ? v + (fit.tau2 || 0) : 0)));
  const W = invSPD(Phi).inv, Xt = transpose(X), Mb = invSPD(mul(Xt, mul(W, X))).inv;
  const b = mulVec(Mb, mulVec(Xt, mulVec(W, y)));
  const H = mul(mul(X, Mb), mul(Xt, W)), IH = ident(N).map((r, i) => r.map((x, j) => x - H[i][j]));
  const cl = cluster.map(String), ids = [...new Set(cl)], rowsOf = ids.map(j => cl.map((c, i) => (c === j ? i : -1)).filter(i => i >= 0));
  const IHPhi = mul(IH, Phi);
  const A = rowsOf.map(i => {
    const D = cholU(sub(Phi, i, i));                                   // upper: DᵀD = Φⱼ
    const S = i.map(a => i.map(c => dot(IHPhi[a], IH[c])));            // (I − H)ⱼ Φ (I − H)ⱼᵀ
    const B = mul(mul(D, S), transpose(D)), Bs = B.map((r, a) => r.map((x, c) => (x + B[c][a]) / 2));
    const { values, vectors } = eigenSym(Bs), n = i.length;
    const Bmh = zeros(n).map((r, a) => r.map((_, c) => vectors[a].reduce((s, v, m) => s + v * vectors[c][m] / Math.sqrt(Math.max(values[m], 1e-12)), 0)));
    return mul(mul(transpose(D), Bmh), D);
  });
  const E = rowsOf.map((i, j) => mul(mul(mul(sub(Xt, X[0].map((_, q) => q), i), sub(W, i, i)), A[j]), i.map(a => IH[a])).map(r => r)).map(Ej => mul(Mb, Ej));
  const p = b.length, V = zeros(p);
  for (const Ej of E) { const u = mulVec(Ej, y); for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) V[a][c] += u[a] * u[c]; }
  return { b, V, Vmodel: Mb, E, Phi, A, X, y, J: ids.length, ids, cl, rowsOf };
}

/** One coefficient or contrast c: { est, se, df (Satterthwaite), t, p, lo, hi }. */
export function cr2Coef(P, c) {
  const G = P.E.map(Ej => mulVec(transpose(Ej), c));                      // gⱼ = Eⱼᵀ c, each of length N
  const PhiG = G.map(g => mulVec(P.Phi, g));
  const Om = G.map(g => PhiG.map(h => dot(g, h)));
  const tr = Om.reduce((s, r, i) => s + r[i], 0), ss = Om.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0);
  const df = tr * tr / ss, est = dot(c, P.b), se = Math.sqrt(dot(c, mulVec(P.V, c))), t = est / se, q = qt975(df);
  return { est, se, df, t, p: pt2(t, df), lo: est - q * se, hi: est + q * se };
}

/** Whether each coefficient's column is non-zero in two or more clusters: one identified by a single cluster has no CR2 variance. */
export const cr2Identifiable = P => P.X[0].map((_, j) => new Set(P.cl.filter((c, i) => Math.abs(P.X[i][j]) > 0)).size >= 2);

/** Every coefficient: [{ index, est, se, df, t, p, lo, hi, identifiable }], the CR2 numbers null where the coefficient is not identifiable. */
export function cr2Table(fit, cluster, P = cr2Parts(fit, cluster)) {
  const idf = cr2Identifiable(P);
  return P.b.map((_, k) => {
    const c = P.b.map((__, j) => (j === k ? 1 : 0)), r = cr2Coef(P, c);
    return idf[k] ? { index: k, ...r, identifiable: true } : { index: k, est: r.est, se: null, df: null, t: null, p: null, lo: null, hi: null, identifiable: false };
  });
}

/** Wald test of C b = 0 with the HTZ approximation: { Q, q, qRequested, eta, F, df1, df2, p }. Rows of C on unidentifiable coefficients are left out. */
export function cr2Wald(fit, cluster, C, P = cr2Parts(fit, cluster)) {
  const idf = cr2Identifiable(P), qAll = C.length;
  const Cm = C.filter(r => r.every((x, j) => x === 0 || idf[j])), q = Cm.length;
  if (!q) return { Q: null, q: 0, qRequested: qAll, eta: null, F: null, df1: null, df2: null, p: null };
  const Cb = mulVec(Cm, P.b), CVC = mul(mul(Cm, P.V), transpose(Cm)), Q = dot(Cb, mulVec(invSPD(CVC).inv, Cb));
  const Om = mul(mul(Cm, P.Vmodel), transpose(Cm)), ev = eigenSym(Om.map((r, a) => r.map((x, c) => (x + Om[c][a]) / 2)));
  const Lm = Om.map((r, a) => r.map((_, c) => ev.vectors[a].reduce((s, v, m) => s + v * ev.vectors[c][m] / Math.sqrt(ev.values[m]), 0)));
  const Ct = mul(Lm, Cm);
  const G = Ct.map(cs => P.E.map(Ej => mulVec(transpose(Ej), cs)));          // G[s][j]: N-vector
  const PG = G.map(gs => gs.map(g => mulVec(P.Phi, g)));                     // Φ gⱼ
  const S = (s, t) => G[s].map((_, a) => G[t].map(g => dot(PG[s][a], g)));   // (Gₛᵀ Φ Gₜ), J × J
  let tot = 0;
  for (let s = 0; s < q; s++) for (let t = 0; t < q; t++) {
    const Sss = S(s, s), Stt = S(t, t), Sst = S(s, t), Sts = S(t, s);
    for (let a = 0; a < Sss.length; a++) for (let c = 0; c < Sss.length; c++) tot += Sss[a][c] * Stt[a][c] + Sst[a][c] * Sts[a][c];
  }
  const eta = q * (q + 1) / tot, F = (eta - q + 1) / (eta * q) * Q;
  return { Q, q, qRequested: qAll, eta, F, df1: q, df2: eta - q + 1, p: pfUpper(F, q, eta - q + 1) };
}

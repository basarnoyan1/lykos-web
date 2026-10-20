// Power of a meta-analysis (Hedges and Pigott 2001, 2004, Psychological Methods 6:203–217; 9:426–445): the power of the
// test of the pooled effect and of the test of homogeneity (Q), for given studies, an assumed true effect and an assumed
// between-study variance τ². Prospective planning, or a look at what a set of studies could detect; a power computed from
// the observed effect after the fact says nothing more than its p-value does, and is not offered.
//
//   Pooled effect   With weights 1/(vᵢ + τ²) the estimate is normal with variance v• = 1/Σ1/(vᵢ + τ²). The two-sided test at
//                   level α has power 1 − Φ(c − λ) + Φ(−c − λ), λ = θ/√v•, c = Φ⁻¹(1 − α/2).
//   Homogeneity     Q = Σ(yᵢ − ȳ_w)²/vᵢ with yᵢ ~ N(θ, vᵢ + τ²). Q is a weighted sum of independent χ²₁ variables whose
//                   weights are the eigenvalues of Σ^½(W − W11ᵀW/ΣW)Σ^½ (Σ = diag(vᵢ + τ²), W = diag(1/vᵢ)); with equal
//                   vᵢ it is (1 + τ²/v)χ²_{k−1} exactly. Its distribution is evaluated exactly by Imhof's (1961) numerical
//                   inversion; Hedges and Pigott's approximations are not used. Power = P(Q > χ²_{k−1, 1−α}).
// Checked by simulation in native R (bench/extras).
import { qnorm, pnorm, qchisq } from './dist.mjs';

/** Power of the test of the pooled effect. `vi` are the studies' sampling variances (an array), `theta` the assumed true effect on the analysis scale. */
export function meanPower({ theta, vi, tau2 = 0, alpha = 0.05 }) {
  const vd = 1 / vi.reduce((s, v) => s + 1 / (v + tau2), 0), lam = theta / Math.sqrt(vd), c = qnorm(1 - alpha / 2);
  return { power: 1 - pnorm(c - lam) + pnorm(-c - lam), se: Math.sqrt(vd), lambda: lam };
}

/** Eigenvalues of a symmetric matrix by cyclic Jacobi rotations. */
export function eigenSym(A0) {
  const n = A0.length, A = A0.map(r => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
    }
  }
  return A.map((r, i) => r[i]);
}

/** P(Σ λⱼ χ²₁ > x) for positive λⱼ by Imhof's inversion of the characteristic function (Simpson's rule). */
export function imhofUpper(lambdas, x) {
  const L = lambdas.filter(l => l > 1e-14);
  if (!L.length) return x < 0 ? 1 : 0;
  const integrand = u => {
    if (u === 0) return 0.5 * (L.reduce((s, l) => s + l, 0) - x);
    let th = -0.5 * x * u, lr = 0;
    for (const l of L) { th += 0.5 * Math.atan(l * u); lr += 0.25 * Math.log(1 + (l * u) ** 2); }
    return Math.sin(th) / (u * Math.exp(lr));
  };
  // the integrand decays like u^{-k/2 - 1}; integrate to a bound where it is negligible
  const k = L.length, U = Math.max(200, 40 / Math.min(...L)) * (k < 3 ? 20 : 1), N = 200000;
  const h = U / N; let s = integrand(0) + integrand(U);
  for (let i = 1; i < N; i++) s += integrand(i * h) * (i % 2 ? 4 : 2);
  return 0.5 + (s * h / 3) / Math.PI;
}

/** Power of the Q test of homogeneity, exact under the random-effects alternative with variance τ². */
export function qPower({ vi, tau2 = 0, alpha = 0.05 }) {
  const k = vi.length, crit = qchisq(1 - alpha, k - 1);
  if (!(tau2 > 0)) return { power: alpha, critical: crit };
  const w = vi.map(v => 1 / v), sw = w.reduce((s, x) => s + x, 0), sig = vi.map(v => Math.sqrt(v + tau2));
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => sig[i] * sig[j] * ((i === j ? w[i] : 0) - w[i] * w[j] / sw)));
  const lam = eigenSym(A);
  return { power: imhofUpper(lam, crit), critical: crit, eigenvalues: lam.filter(l => l > 1e-14) };
}

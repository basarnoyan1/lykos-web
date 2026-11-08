// Sensitivity analysis for publication bias (Mathur and VanderWeele 2020, JRSS C 69:1091–1119),
// reimplemented from the paper's equations 2.1–3.3. A sensitivity analysis, not a correction:
// it asks how strongly publication would have to favour "affirmative" studies (a positive estimate
// with a two-sided p below 0.05, in the favoured direction) for the pooled estimate to shrink to a
// chosen value, and what the estimate is if only the non-affirmative studies are believed.
//
// Model: an affirmative study is η times as likely to be published as a non-affirmative one. Each
// study is weighted by the inverse of its publication probability, so a non-affirmative study
// counts η times. Two specifications:
//   common effect        weights 1/σ²; μ̂_η = (η ȳ_N + ȳ_A)/(η ν_N + ν_A), var = (η² ν_N + ν_A)/(η ν_N + ν_A)²
//                        (ȳ_S = Σ θ/σ², ν_S = Σ 1/σ² over affirmative A and non-affirmative N); t on k − 1 df.
//   random effects       weights η^[non-affirmative]/(σ² + τ̂²), τ̂² from an ordinary REML fit; the robust variance of
//   (robust)             equation 3.3, k/(k − 1) · Σ{w(θ − μ̂)}²/(Σw)², t on k − 1 df. The paper recommends Tipton's
//                        small-sample correction in addition (PublicationBias, robumeta); it is not implemented, so
//                        these intervals are the uncorrected ones and are narrower than the package's at small k.
// The worst case (η → ∞) is the ordinary meta-analysis of the non-affirmative studies alone.
// Checked against PublicationBias 2.4.0 with small = FALSE in native R (bench/bias).
import { qt, pt, pnorm, qnorm } from './dist.mjs';

const sum = a => a.reduce((s, x) => s + x, 0);

/** Which studies are affirmative: an estimate in the favoured direction whose two-sided p is below `alpha`. `yf` are the estimates with the favoured direction positive. */
export const affirmative = (yf, vi, alpha = 0.05) => yf.map((y, i) => y / Math.sqrt(vi[i]) > qnorm(1 - alpha / 2));

// pooled estimate and variance under a fixed η, for the two specifications
function fixedAt(yf, vi, aff, eta) {
  const w = yf.map((_, i) => (aff[i] ? 1 : eta) / vi[i]), sw = sum(w), mu = sum(w.map((x, i) => x * yf[i])) / sw;
  let nuN = 0, nuA = 0;
  vi.forEach((v, i) => { if (aff[i]) nuA += 1 / v; else nuN += 1 / v; });
  return { est: mu, var: (eta * eta * nuN + nuA) / (eta * nuN + nuA) ** 2 };
}
function robustAt(yf, vi, aff, eta, tau2) {
  const k = yf.length, w = yf.map((_, i) => (aff[i] ? 1 : eta) / (vi[i] + tau2)), sw = sum(w), mu = sum(w.map((x, i) => x * yf[i])) / sw;
  return { est: mu, var: k / (k - 1) * sum(w.map((x, i) => (x * (yf[i] - mu)) ** 2)) / (sw * sw) };
}

// an estimate with its variance as a row: standard error, 95% interval and two-sided p, t on `df` or normal when df is null
const row = (est, v, df) => {
  const se = Math.sqrt(v), c = df == null ? qnorm(0.975) : qt(0.975, df), z = Math.abs(est / se);
  return { est, se, lo: est - c * se, hi: est + c * se, p: 2 * (1 - (df == null ? pnorm(z) : pt(z, df))) };
};

/**
 * The sensitivity analysis. `yi`, `vi` are the effects and variances on the analysis scale (log for a
 * ratio); `favourPositive` says whether publication favours positive estimates (true) or negative;
 * `tau2` is the REML heterogeneity of the ordinary fit; `etas` the selection ratios to report;
 * `q` the value to shrink the estimate to (0 on the analysis scale).
 * Estimates are returned on the favoured-positive scale (`fav`) and the original one (`orig`).
 */
export function publicationBiasSensitivity({ yi, vi, favourPositive, tau2, etas = [1, 2, 4, 10], q = 0, alpha = 0.05, etaMax = 10000 }) {
  const k = yi.length, sgn = favourPositive ? 1 : -1, yf = yi.map(y => sgn * y), aff = affirmative(yf, vi, alpha);
  const kA = aff.filter(Boolean).length, kN = k - kA;
  const spec = { common: (eta) => fixedAt(yf, vi, aff, eta), robust: (eta) => robustAt(yf, vi, aff, eta, tau2) };
  const crit = qt(0.975, k - 1);
  const back = r => (favourPositive ? r : { ...r, est: -r.est, lo: -r.hi, hi: -r.lo });
  const out = { k, kA, kN, favourPositive, alpha, q, affirmative: aff };
  for (const [name, at] of Object.entries(spec)) {
    const rows = etas.map(eta => { const a = at(eta); return { eta, ...back(row(a.est, a.var, k - 1)) }; });
    // worst case: the non-affirmative studies alone
    let worst = null;
    if (kN >= 2) {
      const idx = yf.map((_, i) => i).filter(i => !aff[i]), y = idx.map(i => yf[i]), v = idx.map(i => vi[i]);
      if (name === 'common') { const w = v.map(x => 1 / x), sw = sum(w); worst = row(sum(w.map((x, i) => x * y[i])) / sw, 1 / sw, null); }
      else { const w = v.map(x => 1 / (x + tau2)), sw = sum(w), mu = sum(w.map((x, i) => x * y[i])) / sw, n = y.length;
        worst = row(mu, n / (n - 1) * sum(w.map((x, i) => (x * (y[i] - mu)) ** 2)) / (sw * sw), n - 1); }
      worst = back(worst);
    }
    // η that shrinks the point estimate, and the lower confidence limit, to q (in the favoured direction)
    const f = { est: eta => at(eta).est, lb: eta => { const a = at(eta); return a.est - crit * Math.sqrt(a.var); } };
    const search = fn => {
      if (fn(1) <= q) return { eta: 1, note: 'already at or below' };
      let prev = 1;
      for (let i = 1; i <= 4000; i++) {
        const eta = Math.exp(Math.log(etaMax) * i / 4000);
        if (fn(eta) <= q) { let lo = prev, hi = eta; for (let j = 0; j < 200; j++) { const m = (lo + hi) / 2; if (fn(m) <= q) hi = m; else lo = m; } return { eta: (lo + hi) / 2 }; }
        prev = eta;
      }
      return { eta: null };
    };
    out[name] = { rows, worst, sEst: search(f.est), sCI: search(f.lb) };
  }
  return out;
}

/**
 * Limit meta-analysis (Rücker, Schwarzer, Carpenter, Binder and Schumacher 2011, Biostatistics 12:122–142).
 * The extended random-effects model θᵢ = β + √(SEᵢ² + τ²)(εᵢ + α) lets the effect depend on the standard
 * error; α is the bias parameter and β + τα is the effect of a study with infinite precision (SE = 0), the
 * "limit" estimate. α and β are the intercept and slope of the ordinary least-squares line of
 * θᵢ/√(SEᵢ² + τ²) on 1/√(SEᵢ² + τ²), with the residual variance fixed at 1 (as in the model). A sensitivity
 * analysis; it does not replace the pooled estimate. Checked against metasens::limitmeta, method "beta0".
 */
export function limitMeta({ yi, vi, tau2 }) {
  const k = yi.length, tau = Math.sqrt(tau2), x = vi.map(v => 1 / Math.sqrt(v + tau2)), y = yi.map((t, i) => t * x[i]);
  const mx = sum(x) / k, my = sum(y) / k, sxx = sum(x.map(v => (v - mx) ** 2)), sxy = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
  const beta = sxy / sxx, alpha = my - beta * mx;
  // covariance of (α̂, β̂) is (XᵀX)⁻¹ with the residual variance 1
  const varB = 1 / sxx, varA = 1 / k + mx * mx / sxx, cov = -mx / sxx;
  const est = beta + tau * alpha, se = Math.sqrt(varB + tau2 * varA + 2 * tau * cov), z = est / se, c = qnorm(0.975);
  return { est, se, lo: est - c * se, hi: est + c * se, p: 2 * (1 - pnorm(Math.abs(z))), alpha, beta, k, tau2 };
}

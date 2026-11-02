// The binomial–normal model of a single-group proportion (rma.glmm(measure = "PLO"), lme4's glmer(cbind(x, n − x) ~ 1 + (1 | study),
// family = binomial, nAGQ = 7) by maximum likelihood) in JavaScript (owner, 2026-10-18: "also do MH, Peto and GLMM in javascript").
// The likelihood is lme4's: each study's integral over its random intercept by adaptive Gauss–Hermite quadrature on 7 points about its
// mode. It is maximised to a gradient under 1e-9 (lme4 stops at its optimiser's tolerance), and the standard error comes from the Hessian of
// the deviance in (τ, μ), 2·H⁻¹, as lme4's vcov takes it (lme4 differentiates numerically). The heterogeneity test is metafor's Wald test
// from the saturated logistic model: for independent proportions, Q on their uncorrected logits, a study with no or all events out. I² is
// metafor's, from escalc's variances with 0.5 added to such a study. Agreement with the app's R (WebR's metafor and lme4) is measured in
// app/test/meta-glmm.test.mjs; R's result takes the JavaScript one's place behind it in the app. Pure.
import { escalcRow } from './meta-escalc.mjs';
import { pchisqUpper } from './describe.mjs';

const Z975 = 1.959963984540054;
// the 7-point Gauss–Hermite rule for the standard normal (lme4's GHrule(7)): nodes z, weights w with Σ w f(z) ≈ ∫ f φ
const GH = [[0, 16 / 35], [1.1544053947399682, 0.24012317860501275], [-1.1544053947399682, 0.24012317860501275],
  [2.366759410734541, 0.030757123967586496], [-2.366759410734541, 0.030757123967586496],
  [3.750439717725742, 0.0005482688559722184], [-3.750439717725742, 0.0005482688559722184]];
const logPhi = z => -0.5 * z * z - 0.5 * Math.log(2 * Math.PI);
const log1pexp = x => (x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x)));
const lchoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; };

/** A study's log-likelihood at linear predictor η and τ: log ∫ Bin(x | n, expit(η + τ u)) φ(u) du, by AGQ on 7 points about the integrand's mode. */
function studyLL(x, n, mu, tau, lc) {
  const g = u => { const eta = mu + tau * u; return lc + x * eta - n * log1pexp(eta) + logPhi(u); };
  if (tau === 0) return g(0) - logPhi(0);
  let u = 0;
  for (let it = 0; it < 100; it++) {
    const p = 1 / (1 + Math.exp(-(mu + tau * u))), d1 = tau * (x - n * p) - u, d2 = -tau * tau * n * p * (1 - p) - 1, step = d1 / d2;
    u -= step; if (Math.abs(step) < 1e-13) break;
  }
  const p = 1 / (1 + Math.exp(-(mu + tau * u))), s = 1 / Math.sqrt(tau * tau * n * p * (1 - p) + 1);
  const terms = GH.map(([z, w]) => Math.log(w) + g(u + s * z) - logPhi(z)), m = Math.max(...terms);
  return Math.log(s) + m + Math.log(terms.reduce((acc, t) => acc + Math.exp(t - m), 0));
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
function inverse(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...M.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-300) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
}
/** The gradient and Hessian of f at x by central differences with step h. */
function derivs(f, x, h) {
  const n = x.length, f0 = f(x), at = (i, di, j, dj) => { const y = x.slice(); y[i] += di; if (j != null) y[j] += dj; return f(y); };
  const g = x.map((_, i) => (at(i, h) - at(i, -h)) / (2 * h));
  const H = x.map((_, i) => x.map((_, j) => (i === j ? (at(i, h) - 2 * f0 + at(i, -h)) / (h * h)
    : (at(i, h, j, h) - at(i, h, j, -h) - at(i, -h, j, h) + at(i, -h, j, -h)) / (4 * h * h))));
  return { f0, g, H };
}

/**
 * The binomial–normal model with design X (one row per study, its intercept column first): the coefficients and τ by maximum likelihood
 * (Newton in the coefficients for each τ, golden section in τ ≥ 0), and the coefficients' covariance as lme4 takes it, 2·H⁻¹ of the
 * deviance's Hessian in (τ, β) (in β alone when τ is 0). Null when it does not converge or the design is singular.
 */
export function fitGlmm(xs, ns, X) {
  const k = xs.length, p = X[0].length, lcs = xs.map((x, i) => lchoose(ns[i], x));
  const ll = (beta, tau) => xs.reduce((acc, x, i) => acc + studyLL(x, ns[i], dot(X[i], beta), tau, lcs[i]), 0);
  const sx = xs.reduce((a, b) => a + b, 0), sn = ns.reduce((a, b) => a + b, 0);
  let warm = [Math.log((sx + 0.5) / (sn - sx + 0.5)), ...Array(p - 1).fill(0)];
  const betaAt = tau => {
    let b = warm.slice();
    for (let it = 0; it < 200; it++) {
      const { g, H } = derivs(v => ll(v, tau), b, 1e-5), Hi = inverse(H);
      if (!Hi) return null;
      const step = Hi.map(r => dot(r, g)); b = b.map((v, i) => v - step[i]);
      if (Math.max(...step.map(Math.abs)) < 1e-12) break;
    }
    return b;
  };
  const prof = tau => { const b = betaAt(tau); if (!b) return -Infinity; warm = b; return ll(b, tau); };
  const R = 0.6180339887498949;
  let lo = 0, hi = 5, a = hi - R * (hi - lo), c = lo + R * (hi - lo), fa = prof(a), fc = prof(c);
  for (let it = 0; it < 120 && hi - lo > 1e-12; it++) {
    if (fa < fc) { lo = a; a = c; fa = fc; c = lo + R * (hi - lo); fc = prof(c); }
    else { hi = c; c = a; fc = fa; a = hi - R * (hi - lo); fa = prof(a); }
  }
  let tau = (lo + hi) / 2;
  if (prof(0) >= prof(tau)) tau = 0;
  const beta = betaAt(tau);
  if (!beta || beta.some(v => !Number.isFinite(v))) return null;
  const dev = v => -2 * ll(v.slice(1), Math.abs(v[0]));
  let vb;
  if (tau > 0) { const Hi = inverse(derivs(dev, [tau, ...beta], 1e-4).H); if (!Hi) return null; vb = Hi.slice(1).map(r => r.slice(1).map(x => 2 * x)); }
  else { const Hi = inverse(derivs(v => -2 * ll(v, 0), beta, 1e-4).H); if (!Hi) return null; vb = Hi.map(r => r.map(x => 2 * x)); }
  return { beta, vb, se: vb.map((r, i) => Math.sqrt(r[i])), tau, k, p };
}

/**
 * The GLMM result as the app's R list gives it (lib/glmm.mjs): estimate, lo, hi, pi_lo, pi_hi, mu, mu_lb, mu_ub, logit, logit_se, yi, vi,
 * i2, tau2, q, qp, k, xi, ni, with study_est/lo/hi from the study estimates. `values` are [events, n] per study. Null when the fit fails.
 */
export function poolGlmm(values, { mod = null } = {}) {
  const xs = values.map(v => Number(v[0])), ns = values.map(v => Number(v[1])), k = xs.length;
  if (k < 2 || xs.some((x, i) => !(x >= 0 && x <= ns[i]))) return null;
  const fit = fitGlmm(xs, ns, xs.map(() => [1]));
  if (!fit) return null;
  const mu = fit.beta[0], tau = fit.tau, varMu = fit.vb[0][0];
  const se = Math.sqrt(varMu), tau2 = tau * tau, tf = y => 1 / (1 + Math.exp(-y));
  // metafor's Wald test from the saturated model: Q on the uncorrected logits of the studies with some but not all events
  const inf = xs.map((x, i) => i).filter(i => xs[i] > 0 && xs[i] < ns[i]);
  const yw = inf.map(i => [Math.log(xs[i] / (ns[i] - xs[i])), xs[i] * (ns[i] - xs[i]) / ns[i]]), sw = yw.reduce((s, [, w]) => s + w, 0);
  const ybar = yw.reduce((s, [y, w]) => s + w * y, 0) / sw, q = Math.max(0, yw.reduce((s, [y, w]) => s + w * (y - ybar) ** 2, 0));
  const es = values.map(v => escalcRow('PR', v)), wi = es.map(e => 1 / e.vi), swi = wi.reduce((s, w) => s + w, 0);
  const vt = (k - 1) / (swi - wi.reduce((s, w) => s + w * w, 0) / swi), piSe = Math.sqrt(se * se + tau2);
  return { estimate: tf(mu), lo: tf(mu - Z975 * se), hi: tf(mu + Z975 * se), pi_lo: tf(mu - Z975 * piSe), pi_hi: tf(mu + Z975 * piSe),
    mu, mu_lb: mu - Z975 * se, mu_ub: mu + Z975 * se, logit: mu, logit_se: se, yi: es.map(e => e.yi), vi: es.map(e => e.vi),
    i2: 100 * tau2 / (vt + tau2), tau2, q, qp: k > 1 ? pchisqUpper(q, k - 1) : 1, k, xi: xs, ni: ns,
    study_est: es.map(e => tf(e.yi)), study_lo: es.map(e => tf(e.yi - Z975 * Math.sqrt(e.vi))), study_hi: es.map(e => tf(e.yi + Z975 * Math.sqrt(e.vi))), engine: 'js',
    ...(mod ? glmmModerator(xs, ns, values, mod, tf) : {}) };
}

/**
 * The moderator of a GLMM (lib/glmm.mjs's R): a grouping as rma.glmm(mods = ~ g), the Wald test of its terms (QM, its df) and each level's own
 * GLMM (a level of one study has none: NaN); a number as rma.glmm(mods = ~ x), its slope on the logit scale with its z test.
 */
function glmmModerator(xs, ns, values, mod, tf) {
  const wald = (fit, idx) => { const sub = inverse(idx.map(i => idx.map(j => fit.vb[i][j]))), b = idx.map(i => fit.beta[i]);
    return sub ? b.reduce((s, bi, i) => s + bi * dot(sub[i], b), 0) : NaN; };
  if (mod.kind === 'group') {
    const g = mod.values.map(String), lv = [...new Set(g)].sort();
    const fit = fitGlmm(xs, ns, g.map(v => [1, ...lv.slice(1).map(l => (v === l ? 1 : 0))]));
    if (!fit) return {};
    const idx = lv.slice(1).map((_, i) => i + 1), qm = wald(fit, idx);
    const subs = lv.map(l => { const rows = values.filter((_, i) => g[i] === l); return [rows.length, rows.length >= 2 ? poolGlmm(rows) : null]; });
    return { mod_kind: 'group', mod_levels: lv, mod_k: subs.map(([n]) => n), mod_est: subs.map(([, r]) => (r ? r.estimate : NaN)), mod_lo: subs.map(([, r]) => (r ? r.lo : NaN)),
      mod_hi: subs.map(([, r]) => (r ? r.hi : NaN)), mod_i2: subs.map(([, r]) => (r ? r.i2 : NaN)), mod_tau2: subs.map(([, r]) => (r ? r.tau2 : NaN)),
      qm, qmp: pchisqUpper(qm, idx.length), qm_df: idx.length };
  }
  const x = mod.values.map(Number);
  if (x.some(v => !Number.isFinite(v))) return {};
  // Fitted on x centred and scaled (a year near 2000 leaves the Hessian ill-conditioned): the slope and its test map back exactly.
  const m = x.reduce((a, v) => a + v, 0) / x.length, sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / x.length);
  if (!(sd > 0)) return {};
  const fit = fitGlmm(xs, ns, x.map(v => [1, (v - m) / sd]));
  if (!fit) return {};
  const b = fit.beta[1] / sd, se = fit.se[1] / sd, z = b / se;
  return { mod_kind: 'numeric', slope: b, slope_lo: b - Z975 * se, slope_hi: b + Z975 * se, slope_p: pchisqUpper(z * z, 1), qm: z * z, qmp: pchisqUpper(z * z, 1) };
}

// ---- Two arms: the odds ratio ------------------------------------------------------------------------------------------------------
// rma.glmm(measure = "OR") with its default model, "UM.FS" (an unconditional model with fixed study effects): lme4's
// glmer(cbind(x, n − x) ~ 0 + X.fit + study + (0 + group | study), family = binomial, nAGQ = 7), where each study has its own intercept
// α_i, the treated arm adds X_i β, and the random effect u_i ~ N(0, τ²) enters the arms as +u_i/2 and −u_i/2 (metafor's coding = 1/2).
// The study intercepts are profiled out (each by Newton on its own study, which alone they touch); β by Newton for each τ, τ by golden
// section, as for the proportion. The covariance of β is lme4's, the β block of 2·H⁻¹ of the deviance in (τ, α, β), which is the inverse of
// the Hessian with the α profiled out.

/** One study's log-likelihood under the two-arm model at its intercept α, its treatment term η = X_i β and τ, by AGQ on 7 points. */
function study2LL(a, n1, c, n2, alpha, eta, tau, lc) {
  const g = u => { const e1 = alpha + eta + tau * u / 2, e2 = alpha - tau * u / 2; return lc + a * e1 - n1 * log1pexp(e1) + c * e2 - n2 * log1pexp(e2) + logPhi(u); };
  if (tau === 0) return g(0) - logPhi(0);
  const at = u => { const p1 = 1 / (1 + Math.exp(-(alpha + eta + tau * u / 2))), p2 = 1 / (1 + Math.exp(-(alpha - tau * u / 2))); return [p1, p2]; };
  let u = 0;
  for (let it = 0; it < 100; it++) {
    const [p1, p2] = at(u), d1 = tau / 2 * (a - n1 * p1) - tau / 2 * (c - n2 * p2) - u, d2 = -tau * tau / 4 * (n1 * p1 * (1 - p1) + n2 * p2 * (1 - p2)) - 1, step = d1 / d2;
    u -= step; if (Math.abs(step) < 1e-13) break;
  }
  const [p1, p2] = at(u), s = 1 / Math.sqrt(tau * tau / 4 * (n1 * p1 * (1 - p1) + n2 * p2 * (1 - p2)) + 1);
  const terms = GH.map(([z, w]) => Math.log(w) + g(u + s * z) - logPhi(z)), m = Math.max(...terms);
  return Math.log(s) + m + Math.log(terms.reduce((acc, t) => acc + Math.exp(t - m), 0));
}

/**
 * The two-arm GLMM of rows [events treated, n treated, events control, n control] with the treatment design X (one row per study, its
 * intercept column first): `{ beta, vb, se, tau }`, or null when it does not converge or the design is singular.
 */
export function fitGlmmOR(rows, X) {
  const k = rows.length, p = X[0].length;
  const [as, n1s, cs, n2s] = [0, 1, 2, 3].map(j => rows.map(r => Number(r[j])));
  const lcs = rows.map((_, i) => lchoose(n1s[i], as[i]) + lchoose(n2s[i], cs[i]));
  const alphas = rows.map((_, i) => Math.log((cs[i] + 0.5) / (n2s[i] - cs[i] + 0.5)));
  // the study's log-likelihood with its α at its maximum (warm-started from the last one found)
  const prof1 = (i, eta, tau) => {
    const f = al => study2LL(as[i], n1s[i], cs[i], n2s[i], al, eta, tau, lcs[i]), h = 1e-5;
    let al = alphas[i];
    for (let it = 0; it < 100; it++) {
      const f0 = f(al), fp = f(al + h), fm = f(al - h), d1 = (fp - fm) / (2 * h), d2 = (fp - 2 * f0 + fm) / (h * h);
      const step = d2 < 0 ? d1 / d2 : -Math.sign(d1) * 0.5;
      al -= Math.max(-2, Math.min(2, step)); if (Math.abs(step) < 1e-11) break;
    }
    alphas[i] = al;
    return f(al);
  };
  const ll = (beta, tau) => rows.reduce((acc, _, i) => acc + prof1(i, dot(X[i], beta), tau), 0);
  let warm = Array(p).fill(0);
  const betaAt = tau => {
    let b = warm.slice();
    for (let it = 0; it < 200; it++) {
      const { g, H } = derivs(v => ll(v, tau), b, 1e-4), Hi = inverse(H);
      if (!Hi) return null;
      const step = Hi.map(r => dot(r, g)); b = b.map((v, i) => v - Math.max(-2, Math.min(2, step[i])));
      if (Math.max(...step.map(Math.abs)) < 1e-10) break;
    }
    return b;
  };
  const prof = tau => { const b = betaAt(tau); if (!b || b.some(v => !Number.isFinite(v))) return -Infinity; warm = b; return ll(b, tau); };
  const R = 0.6180339887498949;
  let lo = 0, hi = 5, a = hi - R * (hi - lo), c = lo + R * (hi - lo), fa = prof(a), fc = prof(c);
  for (let it = 0; it < 120 && hi - lo > 1e-10; it++) {
    if (fa < fc) { lo = a; a = c; fa = fc; c = lo + R * (hi - lo); fc = prof(c); }
    else { hi = c; c = a; fc = fa; a = hi - R * (hi - lo); fa = prof(a); }
  }
  let tau = (lo + hi) / 2;
  if (prof(0) >= prof(tau)) tau = 0;
  const beta = betaAt(tau);
  if (!beta || beta.some(v => !Number.isFinite(v))) return null;
  let vb;
  if (tau > 0) { const Hi = inverse(derivs(v => -2 * ll(v.slice(1), Math.abs(v[0])), [tau, ...beta], 1e-4).H); if (!Hi) return null; vb = Hi.slice(1).map(r => r.slice(1).map(x => 2 * x)); }
  else { const Hi = inverse(derivs(v => -2 * ll(v, 0), beta, 1e-4).H); if (!Hi) return null; vb = Hi.map(r => r.map(x => 2 * x)); }
  return { beta, vb, se: vb.map((r, i) => Math.sqrt(r[i])), tau, k, p };
}

/**
 * The pooled odds ratio of rma.glmm(measure = "OR") as a comparison stores it (lib/contrast-r.mjs's GLMM): the estimate and its intervals,
 * τ², I² (escalc's variances, 0.5 added to a study with a zero cell), Q as metafor's Wald test from the saturated model (Q on the uncorrected
 * log odds ratios, a study with a zero cell out; k − 1 df), the study estimates. With `mod` ({ kind: 'group', values, levels }) the subgroups:
 * rma.glmm(mods = ~ g) on the studies with a level (QM, its df) and each level's own GLMM (none for a level of one study). Null when no fit.
 */
export function poolGlmmOR(values, { mod = null } = {}) {
  const rows = values.map(v => v.map(Number)), k = rows.length;
  if (k < 2 || rows.some(([a, n1, c, n2]) => !(a >= 0 && a <= n1 && c >= 0 && c <= n2))) return null;
  const fit = fitGlmmOR(rows, rows.map(() => [1]));
  if (!fit) return null;
  const mu = fit.beta[0], se = fit.se[0], tau2 = fit.tau ** 2, z = mu / se, piSe = Math.sqrt(se * se + tau2);
  const full = rows.filter(([a, n1, c, n2]) => a > 0 && a < n1 && c > 0 && c < n2);
  const yw = full.map(([a, n1, c, n2]) => [Math.log(a * (n2 - c) / ((n1 - a) * c)), 1 / (1 / a + 1 / (n1 - a) + 1 / c + 1 / (n2 - c))]);
  const sw = yw.reduce((s, [, w]) => s + w, 0), ybar = yw.reduce((s, [y, w]) => s + w * y, 0) / sw;
  const q = yw.length > 1 ? Math.max(0, yw.reduce((s, [y, w]) => s + w * (y - ybar) ** 2, 0)) : 0;
  const es = rows.map(v => escalcRow('OR', v)), wi = es.map(e => 1 / e.vi), swi = wi.reduce((s, w) => s + w, 0);
  const vt = (k - 1) / (swi - wi.reduce((s, w) => s + w * w, 0) / swi);
  return { estimate: Math.exp(mu), lo: Math.exp(mu - Z975 * se), hi: Math.exp(mu + Z975 * se), pi_lo: Math.exp(mu - Z975 * piSe), pi_hi: Math.exp(mu + Z975 * piSe),
    i2: 100 * tau2 / (vt + tau2), tau2, q, qp: pchisqUpper(q, k - 1), k, zval: z, pval: pchisqUpper(z * z, 1),
    mu, mu_lb: mu - Z975 * se, mu_ub: mu + Z975 * se, yi: es.map(e => e.yi), vi: es.map(e => e.vi),
    study_est: es.map(e => Math.exp(e.yi)), study_lo: es.map(e => Math.exp(e.yi - Z975 * Math.sqrt(e.vi))), study_hi: es.map(e => Math.exp(e.yi + Z975 * Math.sqrt(e.vi))),
    engine: 'js', ...(mod ? glmmORGroups(rows, mod) : {}) };
}

function glmmORGroups(rows, mod) {
  const lv = mod.levels.map(String), g = mod.values.map(v => (v == null ? null : String(v))), has = g.map((v, i) => (lv.includes(v) ? i : -1)).filter(i => i >= 0);
  if (lv.length < 2) return {};
  const fit = fitGlmmOR(has.map(i => rows[i]), has.map(i => [1, ...lv.slice(1).map(l => (g[i] === l ? 1 : 0))]));
  if (!fit) return {};
  const idx = lv.slice(1).map((_, i) => i + 1), sub = inverse(idx.map(i => idx.map(j => fit.vb[i][j]))), b = idx.map(i => fit.beta[i]);
  const qm = sub ? b.reduce((s, bi, i) => s + bi * dot(sub[i], b), 0) : NaN;
  const subs = lv.map(l => { const r = rows.filter((_, i) => g[i] === l); return [r.length, r.length >= 2 ? poolGlmmOR(r) : null]; });
  const at = key => subs.map(([, r]) => (r ? r[key] : NaN));
  return { mod_kind: 'group', mod_levels: lv, mod_k: subs.map(([n]) => n), mod_est: at('estimate'), mod_lo: at('lo'), mod_hi: at('hi'), mod_i2: at('i2'), mod_tau2: at('tau2'),
    qm, qmp: pchisqUpper(qm, idx.length), qm_df: idx.length, mod_unassigned: g.length - has.length };
}

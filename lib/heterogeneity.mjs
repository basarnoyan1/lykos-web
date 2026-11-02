// Heterogeneity, interval settings and the "Methods used" record of a pooled
// result (plan §4.6 amendment of 2026-09-29; Cochrane Handbook v6.5, RevMan
// 2025). Pure: the R snippet runs in WebR inside the analysis view's Run, and
// bench/heterogeneity checks every number it returns against native R.
//
// What is computed
//   - τ², τ, I² and H² with a 95% confidence interval by the Q-profile method
//     (Viechtbauer 2007), metafor's confint(). The interval does not depend on
//     the τ² estimator; the estimates do. It is computed for the random-effects
//     estimators (REML, DL) and not for a common-effect, Mantel–Haenszel or Peto
//     model, which have no τ².
//   - The confidence interval of the pooled effect: normal (z), Hartung–Knapp
//     (t on k − 1 df, variance scaled by the residual heterogeneity), or
//     Hartung–Knapp with metafor's `adhoc` guard (Röver, Knapp and Friede 2015),
//     which keeps the scaled variance from falling below the ordinary one.
//   - The prediction interval: metafor's own (normal with a z interval, t on
//     k − 1 df with a Hartung–Knapp one), or always t on k − 1 df, which is what
//     Cochrane's statistics group recommends from 2025 (k − 2 before).

/** How the pooled effect's interval is formed. */
export const INFERENCE = [
  ['z', 'Normal (z)'],
  ['knha', 'Hartung–Knapp'],
  ['adhoc', 'Hartung–Knapp, guarded'],
];
/** How the prediction interval is formed. */
export const PREDICTION = [
  ['follow', 'Follows the interval'],
  ['t', 't, k − 1 df'],
];

const COMMON = ['EE', 'MH', 'PETO'];
// the mixed model has a τ² but no Hartung–Knapp form and no Q-profile interval
const NO_HK = [...COMMON, 'GLMM'];
/** True for the tests that scale the variance (Hartung–Knapp and its guarded form). */
export const isHK = test => test === 'knha' || test === 'adhoc';
/** The test a run uses: Hartung–Knapp only under a random-effects model. */
export const testFor = (method, test) => (NO_HK.includes(method) ? 'z' : isHK(test) ? test : 'z');
/** The prediction-interval setting a run uses ('t' only under a random-effects model). */
export const piFor = (method, pi) => (NO_HK.includes(method) ? 'follow' : pi === 't' ? 't' : 'follow');

/**
 * R run after `r` (the pooled fit) and `pr <- predict(r)`: the confidence
 * intervals of τ², I² and H², and, when asked, the t-based prediction interval
 * `het_pt` (lower, upper, df; null otherwise: the result then uses predict's).
 * Returns `het`, a list appended to the result. `random` is false for a model
 * with no τ².
 */
export function heterogeneityR({ random = true, pi = 'follow' } = {}) {
  return `
      het_ci <- ${random ? 'tryCatch(confint(r)$random, error=function(e) NULL)' : 'NULL'}
      het_pt <- ${random && pi === 't' ? `if (r$k >= 3) {
        crit <- qt(0.975, r$k - 1)
        c(r$beta[1] - crit * sqrt(r$tau2 + r$se^2), r$beta[1] + crit * sqrt(r$tau2 + r$se^2), r$k - 1)
      } else NULL` : 'NULL'}
      het <- list(
        tau2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[1, 2]), tau2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[1, 3]),
        tau_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[2, 2]), tau_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[2, 3]),
        i2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[3, 2]), i2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[3, 3]),
        h2 = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 1]), h2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 2]), h2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 3]),
        pi_df = if (is.null(het_pt)) NULL else het_pt[3])`;
}

/** The settings a result was produced with, recorded in it (`a.settings`). */
export function settingsOf({ method, test, pi, measure, level = 95 }) {
  return { estimator: method, ci: testFor(method, test), pi: piFor(method, pi), level, tau2ci: ['REML', 'DL'].includes(method) ? 'Q-profile' : null, measure };
}

const ESTIMATOR_NAMES = { REML: 'Restricted maximum likelihood (REML)', DL: 'DerSimonian–Laird', EE: 'Common effect (inverse variance)', GLMM: 'Generalised linear mixed model (rma.glmm, logit link, normal study effects)', MH: 'Common effect, Mantel–Haenszel', PETO: "Common effect, Peto's odds ratio" };
const CI_NAMES = { z: 'Normal (z) interval', knha: 'Hartung–Knapp, t on k − 1 df', adhoc: 'Hartung–Knapp with the ad hoc guard (variance not below the ordinary one), t on k − 1 df' };

/**
 * The visible "Methods used" statement of a result: label and text rows. A
 * result run before settings were recorded is described from what it did keep
 * (its estimator and interval test); what it did not record is said so, never
 * filled in from today's defaults.
 */
export function methodsUsed(a = {}) {
  const recorded = !!a.settings;
  const method = a.settings?.estimator ?? a.method, test = a.settings?.ci ?? (a.test === 'knha' ? 'knha' : 'z');
  const common = COMMON.includes(method);
  const rows = [['Estimator', method === 'GLMM' && a.measure === 'OR' ? 'Generalised linear mixed model (rma.glmm, fixed study effects, normal random treatment effect, logit link)' : ESTIMATOR_NAMES[method] || String(method || '—')]];
  if (a.measure === 'PFT') rows.unshift(['Transformation', 'Freeman–Tukey double arcsine; the pooled value is back-transformed with the harmonic mean of the sample sizes']);
  else if (a.measure === 'PR') rows.unshift(['Transformation', 'Logit; 0.5 added to an arm with no or all events']);
  if (!common) rows.push(['Interval of the pooled effect', CI_NAMES[test] || CI_NAMES.z]);
  if (a.derived) return rows;
  if (method === 'GLMM') return rows;
  if (!common) rows.push(['Interval of τ², I² and H²', a.tau2_lo != null ? 'Q-profile (Viechtbauer 2007), 95%' : recorded ? 'Not computed' : 'Not recorded for this run']);
  if (a.pi_lo != null) rows.push(['Prediction interval', a.settings?.pi === 't' ? 't on k − 1 df' : recorded ? (isHK(test) ? 't on k − 1 df (metafor, with the Hartung–Knapp test)' : 'Normal (metafor, with the z test)') : (isHK(test) ? 't on k − 1 df' : 'Normal')]);
  return rows;
}

/** Where a result's settings differ from RevMan 2025's (REML, Hartung–Knapp, t-based prediction interval): [setting, RevMan, this result]. */
export function revmanDifferences(a = {}) {
  const method = a.settings?.estimator ?? a.method, test = a.settings?.ci ?? (a.test === 'knha' ? 'knha' : 'z');
  if (COMMON.includes(method)) return [];
  const out = [];
  if (method !== 'REML') out.push(['Estimator', 'REML', ESTIMATOR_NAMES[method] || method]);
  if (test !== 'knha') out.push(['Interval of the pooled effect', 'Hartung–Knapp, t on k − 1 df', CI_NAMES[test] || CI_NAMES.z]);
  if (!(a.settings?.pi === 't' || isHK(test)) && a.pi_lo != null) out.push(['Prediction interval', 't on k − 1 df', 'Normal']);
  return out;
}

// ---- Freeman–Tukey double arcsine ------------------------------------------------
// Offered for single-group proportions, with its problems stated: the
// transformed value depends on the sample size as well as the proportion, and
// no single back-transformation of a pooled value exists (Schwarzer, Chemaitelly,
// Abu-Raddad and Rücker 2019; Röver and Friede 2022). Logit is the default.
export const FT_WARNING = 'Freeman–Tukey back-transformation depends on the sample size chosen and can mislead. Logit is the default; a GLMM is offered under Proportion.';

// ---- how a result shows its heterogeneity ----------------------------------------
const fx = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
const span = (e, lo, hi, d) => (lo == null || hi == null ? fx(e, d) : `${fx(e, d)} [${fx(lo, d)}, ${fx(hi, d)}]`);

/** τ², I² and H² with their Q-profile intervals, as [label, text] rows; without an interval the estimate alone. */
export function heterogeneityRows(a = {}) {
  const rows = [];
  if (!COMMON.includes(a.settings?.estimator ?? a.method)) rows.push(['τ²', span(a.tau2, a.tau2_lo, a.tau2_hi, 4)]);
  rows.push(['I²', a.i2_lo != null ? `${fx(a.i2, 1)}% [${fx(a.i2_lo, 1)}, ${fx(a.i2_hi, 1)}]` : `${fx(a.i2, 1)}%`]);
  if (a.h2 != null) rows.push(['H²', span(a.h2, a.h2_lo, a.h2_hi, 2)]);
  return rows;
}

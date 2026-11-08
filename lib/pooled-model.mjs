// The R that fits a pooled effect from its rows, shared by the analysis view's
// Run and by every analysis that refits the same model afterwards (small-study
// tests, diagnostics, robust variance, missing-data sensitivity). One place, so
// a later analysis is computed from exactly the model the result reports.
import { lib_effect_measures$measureOf as measureOf, lib_effect_measures$escalcName as escalcName, lib_effect_measures$inputsOf as inputsOf } from "../boot.mjs";
import { isHK } from './heterogeneity.mjs';

/** escalc's argument list for the measure's rows (`values` in inputFields order, one array per row). */
export function escArgs(measure, values) {
  const byStudy = values, col = i => `c(${byStudy.map(v => v[i]).join(',')})`;
  if (measureOf(measure).family === 'reported') return `yi=${measureOf(measure).ratio ? `log(${col(0)})` : col(0)}, sei=${col(1)}`;
  // A reported ratio and CI pool as log ratio with SE = (log upper − log lower) / (2 · z₀.₉₇₅).
  return measureOf(measure).family === 'generic'
    ? `yi=log(${col(0)}), sei=(log(${col(2)}) - log(${col(1)})) / (2 * qnorm(0.975))`
    : inputsOf(measure).map(([, arg], i) => `${arg}=${col(i)}`).join(', ')
      // SMCC from the change SD: sd2i = 0 makes escalc's sqrt(sd1i² + sd2i² − 2 ri sd1i sd2i) the change SD, whatever ri is
      + (measureOf(measure).id === 'SMCC' ? `, sd2i=rep(0, ${byStudy.length}), ri=rep(0, ${byStudy.length})` : '');
}

/** The pooled model's call: rma, or rma.mh / rma.peto for the rare-event models. */
export function modelCall({ measure, method, test, values }) {
  const knha = isHK(test) ? `, test="${test}"` : '';
  const args = escArgs(measure, values);
  return method === 'MH' ? `rma.mh(${args}, measure="${escalcName(measure)}")`
    : method === 'PETO' ? `rma.peto(${args})`
    : `rma(yi, vi, data=d, method="${method}"${knha})`;
}

/**
 * R that defines `d` (escalc) and `r` (the pooled model). For the Freeman–Tukey
 * measure it first defines `ipft_hm`, the back-transformation with the harmonic
 * mean of the rows' sample sizes, which is the name backTransform() gives.
 */
export function fitR({ measure, method, test, values }) {
  const ni = measureOf(measure).id === 'PFT' ? `\n      ipft_hm <- function(x, ...) transf.ipft.hm(x, targs=list(ni=c(${values.map(v => v[1]).join(',')})))` : '';
  return `${ni}
      d <- escalc(measure="${escalcName(measure)}", ${escArgs(measure, values)})
      r <- ${modelCall({ measure, method, test, values })}`;
}

/**
 * Egger's regression test as metafor's regtest() gives it for the fitted model `r`: the z test of the standard error as a moderator, fitted
 * with the model's own method, so after a random-effects fit it is the mixed-effects version (metafor's default, model = "rma"). The tests of
 * Statistical extras (lib/small-study.mjs) are the classic ones, weighted least squares of the effect on its standard error with a t test
 * (regtest(model = "lm"), meta's metabias "Egger"); the two answer differently and are named so where they are shown.
 */
export const eggerR = () => 'eg <- if (r$k >= 3) tryCatch(regtest(r), error=function(e) NULL) else NULL';

/**
 * R that fits the moderator of a pooled result over the rows of `d`: for a grouping `g` (a factor of `values`, one per row) the model with the
 * grouping as a moderator, `rg`, and the pooled model of each level, `sub` over `lv`; for a number `x` the meta-regression `rg`. The number is
 * centred first: the slope, its interval, the tests and R² are the same, and a moderator such as a year near 2000 no longer costs the normal
 * equations 1e-8 of their precision.
 */
export function moderatorFitR({ kind, values, method, test }) {
  const knha = isHK(test) ? `, test="${test}"` : '';
  return kind === 'group'
    ? `g <- factor(c(${values.map(v => JSON.stringify(String(v))).join(',')}))
      rg <- rma(yi, vi, mods=~g, data=d, method="${method}"${knha})
      lv <- levels(g)
      sub <- lapply(lv, function(l) rma(yi, vi, data=d, subset=(g==l), method="${method}"${knha}))`
    : `x <- c(${values.map(Number).join(',')})
      x <- x - mean(x)
      rg <- rma(yi, vi, mods=~x, data=d, method="${method}"${knha})`;
}

/**
 * The fields of the result that come from the moderator's fit (after `, `): the subgroups and the test for their differences, or the slope per
 * unit (a ratio measure's as a ratio) and the meta-regression's test. The test is QM, a chi-square on `qm_df` df, or after a Hartung–Knapp test an
 * F on `qm_df` and `qm_df2` df (metafor's QM is then the F value, QMdf its two df): `qm_df2` is present exactly then.
 */
export function moderatorOutR({ kind, ratio = false }) {
  const df2 = 'qm_df2 = if (length(rg$QMdf) > 1) rg$QMdf[2] else NULL';
  return kind === 'group'
    ? `, mod_kind = "group", mod_levels = lv, mod_k = sapply(sub, function(m) m$k), mod_est = sapply(sub, function(m) tf(m$beta[1])),
        mod_lo = sapply(sub, function(m) tf(m$ci.lb)), mod_hi = sapply(sub, function(m) tf(m$ci.ub)), mod_i2 = sapply(sub, function(m) m$I2),
        qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1], ${df2}`
    : `, mod_kind = "numeric", slope = ${ratio ? 'exp(rg$beta[2])' : 'rg$beta[2]'}, slope_lo = ${ratio ? 'exp(rg$ci.lb[2])' : 'rg$ci.lb[2]'},
        slope_hi = ${ratio ? 'exp(rg$ci.ub[2])' : 'rg$ci.ub[2]'}, slope_p = rg$pval[2], qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1], ${df2}, r2 = rg$R2`;
}

/**
 * The result list the Run's R ends with, after the model `r` on `d` and `tf` (the back-transformation), `pr <- predict(r)`, `het` and `het_pt`
 * (lib/heterogeneity.mjs), `eg` and `loo` and `sens` (lib/sensitivity.mjs) and the two figures `svg` and `funnel_svg` exist. `rare` is a
 * Mantel–Haenszel or Peto model, which has no spread to predict; `modOut` is the moderator's fields (moderatorOutR).
 */
export function resultR({ rare = false, method, modOut = '' }) {
  return `c(list(
  estimate = tf(r$beta[1]), lo = tf(r$ci.lb), hi = tf(r$ci.ub),
  # a common-effect model assumes one true effect: no spread to predict
  pi_lo = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[1]) else tf(pr$pi.lb), pi_hi = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[2]) else tf(pr$pi.ub),
  i2 = r$I2, tau2 = r$tau2, q = r$QE, qp = r$QEp, k = r$k, svg = svg, funnel = funnel_svg,
  # the study effects and the pooled effect on the analysis scale, for the diagnostics drawn from them (lib/diagnostics.mjs)
  mu = r$beta[1], mu_lb = r$ci.lb, mu_ub = r$ci.ub, yi = as.numeric(d$yi), vi = as.numeric(d$vi),
  # each study on the measure's scale, for the paged forest plot on screen (lib/forest-page.mjs)
  study_est = as.numeric(tf(d$yi)), study_lo = as.numeric(tf(d$yi - qnorm(0.975) * sqrt(d$vi))), study_hi = as.numeric(tf(d$yi + qnorm(0.975) * sqrt(d$vi))),
  weights = as.numeric(weights(r)),
  # Mantel–Haenszel with an odds ratio: the Cochran–Mantel–Haenszel test and Tarone's test for heterogeneity
  cmh = ${method === 'MH' ? 'num_or_null(r$CO)' : 'NULL'}, cmhp = ${method === 'MH' ? 'num_or_null(r$COp)' : 'NULL'},
  tarone = ${method === 'MH' ? 'num_or_null(r$TA)' : 'NULL'}, taronep = ${method === 'MH' ? 'num_or_null(r$TAp)' : 'NULL'},
  egger_z = if (is.null(eg)) NULL else eg$zval, egger_p = if (is.null(eg)) NULL else eg$pval,
  loo_est = if (is.null(loo)) NULL else as.numeric(tf(loo$estimate)), loo_lo = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.lb)),
  loo_hi = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.ub)), loo_i2 = if (is.null(loo)) NULL else as.numeric(loo$I2)${modOut}), het, sens)`;
}

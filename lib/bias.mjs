// Small-study effects and publication bias, presented as sensitivity analyses (plan §I5: never an
// automatic correction). One on-demand run of a saved pooled result, gated at 10 studies (Sterne et al.
// 2011); nothing here changes the pooled estimate. The R runs in WebR after the pooled model is refitted
// from the result's own inputs (lib/pooled-model.mjs), and returns one JSON string; the arithmetic
// analyses (lib/small-study.mjs, lib/publication-bias.mjs) then run in JavaScript on the same effects.
//
//   Regression tests   Egger, Begg, and for binary outcomes Harbord, Peters, Rücker (lib/small-study.mjs)
//   PET and PEESE      weighted regression of the effect on its standard error (PET) or variance (PEESE),
//                      metafor regtest(model = "lm"); the intercept is the effect of a study with no
//                      sampling error (Stanley and Doucouliagos 2014). Both are shown; none is chosen.
//   Selection models   metafor selmodel(), one-sided selection on the p-value in the direction of the pooled
//                      estimate: a step function at p = 0.025 (three-parameter model; Vevea and Hedges 1995),
//                      half-normal and negative exponential (Preston, Ashby and Smyth 2004). With the
//                      likelihood-ratio test against no selection, convergence warnings, and the selection
//                      function. Fitted by REML.
//   Mathur–VanderWeele lib/publication-bias.mjs; limit meta-analysis, same file.
import { backTransform, measureOf } from './effect-measures.mjs';
import { fitR } from './pooled-model.mjs';
import { MIN_K, smallStudyTests } from './small-study.mjs';
import { publicationBiasSensitivity, limitMeta } from './publication-bias.mjs';

export { MIN_K };
export const SELECTION_TYPES = [
  ['stepfun', 'Step function at p = 0.025'],
  ['halfnorm', 'Half-normal'],
  ['negexp', 'Negative exponential'],
];
export const ETAS = [1, 2, 4, 10];
/** Binary effect measures with counts the score-based tests can use. */
export const hasCounts = measure => measureOf(measure).family === 'binary';

/**
 * R that refits the result's model and returns `list(json = "...")`. `values` are the pooled rows in
 * inputFields order (the same rows Run used); the selection function is evaluated on a grid of p.
 */
export function biasScript({ measure, method, test, values }) {
  const back = backTransform(measure);
  return `
      ${fitR({ measure, method, test, values })}
      tf <- function(x) ${back ? `${back}(x)` : 'x'}
      # regression tests and selection models are fitted by REML, whatever estimator the pooled result used
      rr <- rma(yi, vi, data=d, method="REML")
      alt <- if (rr$beta[1] > 0) "greater" else "less"
      reg <- function(pred) tryCatch({
        g <- regtest(rr, model="lm", predictor=pred); cf <- coef(summary(g$fit))
        list(ok=TRUE, est=tf(cf[1, 1]), beta=cf[1, 1], se=cf[1, 2], lo=tf(g$ci.lb), hi=tf(g$ci.ub), p=cf[1, 4], slope=cf[2, 1], slope_se=cf[2, 2], slope_p=cf[2, 4], df=g$dfs)
      }, error=function(e) list(ok=FALSE, error=conditionMessage(e)))
      pgrid <- seq(0.0025, 1, by=0.0025)
      sel <- function(type, steps=NULL) {
        w <- character(0)
        fit <- tryCatch(withCallingHandlers({
          args <- list(rr, type=type, alternative=alt); if (!is.null(steps)) args$steps <- steps
          do.call(selmodel, args)
        }, warning=function(x) { w <<- c(w, conditionMessage(x)); invokeRestart("muffleWarning") }),
        error=function(e) { w <<- c(w, paste("Error:", conditionMessage(e))); NULL })
        if (is.null(fit)) return(list(type=type, ok=FALSE, warnings=as.list(w)))
        dl <- as.numeric(fit$delta)
        curve <- if (type == "halfnorm") exp(-dl[1] * pgrid^2) else if (type == "negexp") exp(-dl[1] * pgrid)
          else { st <- fit$steps; j <- findInterval(pgrid, st, left.open=TRUE) + 1; c(1, dl[-1])[pmin(j, length(dl))] }
        list(type=type, ok=TRUE, est=tf(fit$beta[1]), beta=fit$beta[1], se=fit$se, lo=tf(fit$ci.lb), hi=tf(fit$ci.ub), tau2=fit$tau2,
          delta=dl, delta_lo=as.numeric(fit$ci.lb.delta), delta_hi=as.numeric(fit$ci.ub.delta), lrt=fit$LRT, lrt_df=fit$LRTdf, lrt_p=fit$LRTp,
          k_by_interval=if (type == "stepfun") as.numeric(fit$ptable$k) else NULL, warnings=as.list(w), p=pgrid, w=as.numeric(curve))
      }
      res <- list(k=rr$k, yi=as.numeric(d$yi), vi=as.numeric(d$vi), tau2=rr$tau2, beta=rr$beta[1], estimate=tf(rr$beta[1]), alternative=alt,
        pet=reg("sei"), peese=reg("vi"),
        selection=list(sel("stepfun", c(0.025, 1)), sel("halfnorm"), sel("negexp")))
      list(json = as.character(jsonlite::toJSON(res, auto_unbox=TRUE, digits=NA, null="null", na="null")))`;
}

/**
 * Everything the panel shows, from the R's parsed JSON and the counts: the regression tests, PET and
 * PEESE, the selection models, the Mathur–VanderWeele sensitivity and the limit meta-analysis. `rows`
 * are the binary counts (treated events, treated n, control events, control n) per study, or null.
 */
export function assembleBias(parsed, { measure, rows = null }) {
  const yi = [].concat(parsed.yi), vi = [].concat(parsed.vi), k = yi.length;
  const tests = smallStudyTests({ yi, vi, rows: hasCounts(measure) ? rows : null, measure });
  const fav = parsed.alternative === 'greater';
  return {
    k, tau2: parsed.tau2, estimate: parsed.estimate, alternative: parsed.alternative,
    tests: tests.tests,
    pet: parsed.pet, peese: parsed.peese,
    selection: [].concat(parsed.selection).map(s => ({ ...s, warnings: [].concat(s.warnings || []), delta: s.delta == null ? [] : [].concat(s.delta),
      p: s.p == null ? [] : [].concat(s.p), w: s.w == null ? [] : [].concat(s.w) })),
    mvw: publicationBiasSensitivity({ yi, vi, favourPositive: fav, tau2: parsed.tau2, etas: ETAS }),
    limit: limitMeta({ yi, vi, tau2: parsed.tau2 }),
    back: backTransform(measure),
  };
}

/** Whether a saved result can run these analyses, and the reason it cannot. */
export function biasGate(a) {
  const k = Number(a?.k);
  if (!a || !Number.isFinite(k)) return { ok: false, why: 'No result' };
  if (a.derived) return { ok: false, why: 'Not available for arms read from a table' };
  if (!backOf(a.measure)) return { ok: false, why: 'Not available for the Freeman–Tukey transformation' };
  if (k < MIN_K) return { ok: false, why: `Needs ${MIN_K} or more studies; this result has ${k}` };
  return { ok: true, why: '' };
}

/** JavaScript versions of the back-transformations the R uses, for figures and tables drawn from analysis-scale numbers; null where there is none. */
export const BACK = { exp: Math.exp, 'transf.ilogit': x => 1 / (1 + Math.exp(-x)), 'transf.ztor': Math.tanh };
export const backOf = measure => { const n = backTransform(measure); return n ? BACK[n] ?? null : x => x; };

// Dependent effects: several rows of one pooled result that are not independent (arms of one trial sharing
// a control, overlapping cohorts, several reports of one study). The default analysis treats every row as
// independent; this is a documented alternative and a sensitivity check, not a replacement. The rows are
// grouped by a cluster column (any extraction field; a study with no value is its own cluster, and rows of
// one study always share a cluster) and four analyses are run from metafor alone (no clubSandwich, see
// plan §4.6 amendment of 2026-09-29):
//   Independent, cluster-robust   the ordinary random-effects fit with a cluster-robust (sandwich) variance,
//                                 robust(); intervals use t on (clusters − 1) df and metafor's small-sample factor.
//   Aggregated                    the rows of each cluster combined into one effect (aggregate(), compound
//                                 symmetry with the assumed correlation, inverse-variance), then an ordinary fit.
//   Multilevel                    rma.mv(random = ~ 1 | cluster/row) with the sampling covariance from vcalc()
//                                 (the assumed correlation between rows of one cluster), REML.
//   Multilevel, cluster-robust    that fit with robust().
// The correlation is an assumption, not an estimate; the run repeats the two analyses that use it at
// ρ = 0.2, 0.5 and 0.8 so its influence is visible.
import { backTransform } from './effect-measures.mjs';
import { fitR } from './pooled-model.mjs';

export const RHOS = [0.2, 0.5, 0.8];
export const DEFAULT_RHO = 0.5;
const rStr = s => JSON.stringify(String(s ?? ''));

/** Cluster labels per row: the cluster field's value, else the study's id, so that rows of one study always share a cluster. */
export function clusterLabels({ papers, contrasts = [], values = null }) {
  return papers.map((p, i) => { const v = values?.[i]; return v != null && String(v).trim() !== '' ? `v:${String(v).trim()}` : `p:${p}`; });
}

/** The shape of the clustering: rows, clusters, and how many clusters hold more than one row. */
export function clusterShape(labels) {
  const n = new Map(); for (const l of labels) n.set(l, (n.get(l) || 0) + 1);
  return { rows: labels.length, clusters: n.size, multi: [...n.values()].filter(c => c > 1).length, largest: Math.max(0, ...n.values()) };
}

/** R that refits the result's rows and runs the four analyses; returns `list(json = "...")`. */
export function dependenceScript({ measure, method, test, values, clusters, rho = DEFAULT_RHO }) {
  const back = backTransform(measure);
  return `
      ${fitR({ measure, method: method === 'DL' || method === 'EE' || method === 'REML' ? method : 'REML', test: 'z', values })}
      tf <- function(x) ${back ? `${back}(x)` : 'x'}
      d$cl <- c(${clusters.map(rStr).join(',')}); d$obs <- seq_len(nrow(d))
      cl <- d$cl
      out <- function(m, extra=list()) c(list(est=tf(m$beta[1]), beta=as.numeric(m$beta[1]), se=as.numeric(m$se), lo=tf(m$ci.lb), hi=tf(m$ci.ub), k=m$k), extra)
      safe <- function(expr) tryCatch(expr, error=function(e) list(error=conditionMessage(e)))
      # ordinary fit, with the estimator of the result (random-effects), and its cluster-robust variance
      r0 <- rma(yi, vi, data=d, method="REML")
      mv_fit <- function(rho) { V <- vcalc(vi, cluster=cl, obs=obs, rho=rho, data=d); rma.mv(yi, V, random=~ 1 | cl/obs, data=d, method="REML") }
      ag_fit <- function(rho) { ag <- aggregate(d, cluster=cl, struct="CS", rho=rho); rma(yi, vi, data=ag, method="REML") }
      res <- list(
        rows = nrow(d), clusters = length(unique(cl)),
        independent = safe(out(r0, list(tau2=r0$tau2, i2=r0$I2))),
        independent_robust = safe({ rb <- robust(r0, cluster=cl); out(rb, list(dfs=rb$dfs, tau2=r0$tau2)) }),
        aggregated = safe({ m <- ag_fit(${rho}); out(m, list(tau2=m$tau2)) }),
        multilevel = safe({ m <- mv_fit(${rho}); out(m, list(sigma2=as.numeric(m$sigma2))) }),
        multilevel_robust = safe({ m <- mv_fit(${rho}); rb <- robust(m, cluster=cl); out(rb, list(dfs=rb$dfs, sigma2=as.numeric(m$sigma2))) }),
        by_rho = lapply(c(${RHOS.join(',')}), function(rh) list(rho=rh,
          aggregated = safe({ m <- ag_fit(rh); out(m) }), multilevel = safe({ m <- mv_fit(rh); out(m) }))))
      list(json = as.character(jsonlite::toJSON(res, auto_unbox=TRUE, digits=NA, null="null", na="null")))`;
}

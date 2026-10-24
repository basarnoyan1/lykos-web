// The R for a pooled single-group proportion whose rows are study arms
// (plan §I, pooled proportions amendment 2026-09-28). Pure: the analysis view
// runs it in WebR, and bench/proportions checks the same model in native R.
//
// Model choices, stated here once and recorded in every result:
//
// - Logit proportions (escalc "PLO"). metafor's default continuity
//   correction applies: 0.5 is added to the events and non-events of an arm
//   with no events or with all events, and to no other arm (add = 1/2,
//   to = "only0"). No arm is dropped for having zero events. A generalised
//   linear mixed model (rma.glmm) would avoid the correction, but it needs
//   lme4, which the vendored R set does not contain.
// - Arms of one study are not independent. With REML or ML, whenever the
//   rows being fitted hold two arms of one study, the model is multilevel,
//   rma.mv(random = ~ 1 | study/arm): a between-study and a within-study
//   variance. When no study contributes two arms, study and arm cannot be
//   told apart, and the ordinary random-effects model rma is fitted. The
//   same rule applies to the overall pool and to each subgroup. A common-
//   effect model (EE) treats arms as independent: under one true proportion
//   the arms are separate samples. DerSimonian–Laird has no multilevel form;
//   with it arms are treated as independent and the result says so.
// - The optimiser is nlminb (metafor's default); when it fails, optim's
//   Nelder–Mead is tried; when that fails too, the ordinary model is fitted
//   and the result says the multilevel fit failed.
// - I² of a multilevel model is the share of total variance that is
//   between arms (sum of both variances), with the typical within-arm
//   variance as metafor's documentation computes it; τ² is the sum.
// - Subgroups: a level needs at least two arms; arms with no level stay in
//   the overall pool and are left out of the subgroup test. The test is
//   metafor's omnibus Wald test of the subgroup terms (QM) in one model with
//   a shared heterogeneity; each subgroup's own pooled estimate comes from
//   its own fit, on the natural scale.

const rStr = s => JSON.stringify(String(s ?? ''));

/** The subgroup levels actually used: in the order given, then any others alphabetically; each with ≥ 2 rows. */
export function usedLevels(rows, order = []) {
  const n = new Map();
  for (const r of rows) if (r.level != null && r.level !== '') n.set(r.level, (n.get(r.level) || 0) + 1);
  const known = [...new Set(order.map(String))].filter(l => n.has(l));
  const rest = [...n.keys()].filter(l => !known.includes(l)).sort((a, b) => a.localeCompare(b));
  return [...known, ...rest].filter(l => n.get(l) >= 2);
}

/**
 * R for the pooled proportion of these rows (`{ label, study, events, n,
 * level }`), ending in a list the view stores as the result. `subgroups`
 * turns on the subgroup analysis; `order` is the levels' preferred order.
 */
export function proportionScript({ rows, method = 'REML', subgroups = false, order = [], label = 'Proportion', dir = '/tmp', transform = 'PLO' }) {
  const pft = transform === 'PFT';
  const levels = subgroups ? usedLevels(rows, order) : [];
  const lv = rows.map(r => (levels.includes(r.level) ? r.level : null));
  const unassigned = lv.filter(l => l == null).length;
  const multilevelMethod = method === 'REML' || method === 'ML';
  const g = levels.length >= 2;
  const code = `
      ${pft ? `# Freeman–Tukey double arcsine: no continuity correction; the pooled value is back-transformed with the harmonic mean of the sample sizes
      d <- escalc(measure="PFT", xi=c(${rows.map(r => r.events).join(',')}), ni=c(${rows.map(r => r.n).join(',')}))` : `# 0.5 is added to arms with no events or all events (escalc's default: add = 1/2, to = "only0")
      d <- escalc(measure="PLO", xi=c(${rows.map(r => r.events).join(',')}), ni=c(${rows.map(r => r.n).join(',')}), add=1/2, to="only0")`}
      d$study <- c(${rows.map(r => rStr(r.study)).join(',')})
      d$arm <- seq_len(nrow(d))
      labs <- c(${rows.map(r => rStr(r.label)).join(',')})
      ml_ok <- ${multilevelMethod ? 'TRUE' : 'FALSE'}
      # where Fisher scoring does not converge with full steps, half steps and 1000 iterations (metafor's advice; lib/meta-pool.mjs does the same)
      half_steps <- FALSE
      uni1 <- function(dd, mods, ctl) if (is.null(mods)) rma(yi, vi, data=dd, method="${method}", control=ctl) else rma(yi, vi, mods=mods, data=dd, method="${method}", control=ctl)
      uni <- function(dd, mods) tryCatch(uni1(dd, mods, list()), error=function(e) { if ("${method}" != "REML") stop(e); half_steps <<- TRUE; uni1(dd, mods, list(stepadj=0.5, maxiter=1000)) })
      fit <- function(idx, mods=NULL) {
        dd <- d[idx, ]
        if (ml_ok && any(duplicated(dd$study))) {
          for (ctl in list(list(), list(optimizer="optim", optmethod="Nelder-Mead"))) {
            m <- tryCatch(if (is.null(mods)) rma.mv(yi, vi, random=~ 1 | study/arm, data=dd, method="${method}", control=ctl)
              else rma.mv(yi, vi, mods=mods, random=~ 1 | study/arm, data=dd, method="${method}", control=ctl), error=function(e) NULL)
            if (!is.null(m)) { attr(m, "optimizer") <- if (length(ctl)) "optim (Nelder-Mead)" else "nlminb"; return(m) }
          }
          m <- uni(dd, mods); attr(m, "fallback") <- TRUE; return(m)
        }
        uni(dd, mods)
      }
      is_ml <- function(m) inherits(m, "rma.mv")
      tau2of <- function(m) if (is_ml(m)) sum(m$sigma2) else m$tau2
      i2of <- function(m) {
        if (!is_ml(m)) return(m$I2)
        W <- diag(1/m$vi, nrow=m$k); X <- model.matrix(m)
        P <- W - W %*% X %*% solve(t(X) %*% W %*% X) %*% t(X) %*% W
        100 * sum(m$sigma2) / (sum(m$sigma2) + (m$k - m$p) / sum(diag(P)))
      }
      dep <- function(idx, m) if (is_ml(m)) "multilevel" else if (isTRUE(attr(m, "fallback"))) "independent: multilevel fit failed" else if (any(duplicated(d$study[idx]))) "independent" else "one arm per study"
      ${pft ? `NI <- c(${rows.map(r => r.n).join(',')})
      tf <- function(x) transf.ipft.hm(x, targs=list(ni=NI))
      tp <- function(x) 100 * transf.ipft.hm(x, targs=list(ni=NI))
      ticks <- NULL` : `tf <- function(x) transf.ilogit(x)
      # figures read in percent, on logit-spaced ticks
      tp <- function(x) 100 * transf.ilogit(x)
      ticks <- transf.logit(c(0.01, 0.05, 0.2, 0.5, 0.8, 0.95))`}
      all_idx <- seq_len(nrow(d))
      r <- fit(all_idx)
      pr <- predict(r)
      ${g ? `
      d$g <- factor(c(${lv.map(l => (l == null ? 'NA' : rStr(l))).join(',')}), levels=c(${levels.map(rStr).join(',')}))
      has <- which(!is.na(d$g))
      rg <- fit(has, mods=~ g)
      lv <- levels(d$g)
      sub_idx <- lapply(lv, function(l) which(d$g == l))
      sub <- lapply(sub_idx, fit)
      # the forest plot: each level under its heading with its own polygon; arms with no level last
      gp <- factor(ifelse(is.na(d$g), "No subgroup", as.character(d$g)), levels=c(lv${unassigned ? ', "No subgroup"' : ''}))
      plv <- levels(gp); ns <- as.integer(table(gp)[plv]); m <- length(plv)
      pos <- 1; polyrows <- integer(m); heads <- integer(m); rowsets <- vector("list", m)
      for (i in rev(seq_len(m))) { polyrows[i] <- pos; rowsets[[i]] <- rev(seq(pos + 1, pos + ns[i])); heads[i] <- pos + ns[i] + 1; pos <- pos + ns[i] + 3 }
      rowsvec <- unlist(rowsets)
      svglite("${dir}/forest.svg", width=8.5, height=1.2 + 0.3 * (pos + 2.5))
      forest(r, slab=labs, header=c("Study arm", "% [95% CI]"), order=gp, rows=rowsvec, ylim=c(-1.5, pos + 1), atransf=tp, at=ticks, digits=c(1L, 0L), xlab=${rStr(`${label} (%)`)})
      for (i in seq_len(m)) if (plv[i] %in% lv) addpoly(sub[[which(lv == plv[i])]], row=polyrows[i], mlab=paste0(plv[i], " (k = ", ns[i], ")"), atransf=tp, digits=1L, cex=0.9)
      text(par("usr")[1], heads, plv, pos=4, font=4, cex=0.9)
      dev.off()` : `
      svglite("${dir}/forest.svg", width=8.5, height=1.6 + nrow(d) * 0.3)
      forest(r, slab=labs, header=c("Study arm", "% [95% CI]"), atransf=tp, at=ticks, digits=c(1L, 0L), xlab=${rStr(`${label} (%)`)})
      dev.off()`}
      svg <- paste(readLines("${dir}/forest.svg"), collapse="\\n")
      funnel_svg <- tryCatch({ svglite("${dir}/funnel.svg", width=6, height=4.6); funnel(r, atransf=tp, at=ticks, digits=0L, xlab=${rStr(`${label} (%)`)}); dev.off()
        paste(readLines("${dir}/funnel.svg"), collapse="\\n") }, error=function(e) { if (dev.cur() > 1) dev.off(); NULL })
      eg <- if (!is_ml(r) && r$k >= 3) tryCatch(regtest(r), error=function(e) NULL) else NULL
      loo <- if (!is_ml(r) && r$k >= 3) tryCatch(leave1out(r), error=function(e) NULL) else NULL
      het_ci <- if (!is_ml(r) && r$method %in% c("REML", "DL")) tryCatch(confint(r)$random, error=function(e) NULL) else NULL
      list(
        estimate = tf(r$beta[1]), lo = tf(r$ci.lb), hi = tf(r$ci.ub),
        pi_lo = if (r$method == "EE") NULL else tf(pr$pi.lb), pi_hi = if (r$method == "EE") NULL else tf(pr$pi.ub),
        logit = as.numeric(r$beta[1]), logit_se = r$se,
        i2 = i2of(r), tau2 = tau2of(r), sigma2 = if (is_ml(r)) r$sigma2 else NULL,
        q = r$QE, qp = r$QEp, k = r$k, studies = length(unique(d$study)),
        dependence = dep(all_idx, r), optimizer = if (is_ml(r)) attr(r, "optimizer") else NULL,
        convergence = if (half_steps) "REML by Fisher scoring with half steps (stepadj = 0.5, maxiter = 1000): it did not converge with full steps" else NULL,
        svg = svg, funnel = funnel_svg, weights = as.numeric(weights(r)),
        # each arm in percent, for the paged forest plot on screen (lib/forest-page.mjs)
        study_est = as.numeric(tp(d$yi)), study_lo = as.numeric(tp(d$yi - qnorm(0.975) * sqrt(d$vi))), study_hi = as.numeric(tp(d$yi + qnorm(0.975) * sqrt(d$vi))),
        xi = as.numeric(c(${rows.map(r => r.events).join(',')})), ni = as.numeric(c(${rows.map(r => r.n).join(',')})),
        egger_z = if (is.null(eg)) NULL else eg$zval, egger_p = if (is.null(eg)) NULL else eg$pval,
        tau2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[1, 2]), tau2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[1, 3]),
        i2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[3, 2]), i2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[3, 3]),
        h2 = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 1]), h2_lo = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 2]), h2_hi = if (is.null(het_ci)) NULL else as.numeric(het_ci[4, 3]),
        loo_est = if (is.null(loo)) NULL else as.numeric(tf(loo$estimate)), loo_lo = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.lb)),
        loo_hi = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.ub)), loo_i2 = if (is.null(loo)) NULL else as.numeric(loo$I2)${g ? `,
        mod_kind = "group", mod_levels = lv, mod_k = sapply(sub, function(m) m$k),
        mod_studies = sapply(sub_idx, function(i) length(unique(d$study[i]))),
        mod_est = sapply(sub, function(m) tf(m$beta[1])), mod_lo = sapply(sub, function(m) tf(m$ci.lb)), mod_hi = sapply(sub, function(m) tf(m$ci.ub)),
        mod_i2 = sapply(sub, i2of), mod_tau2 = sapply(sub, tau2of),
        mod_dependence = mapply(dep, sub_idx, sub), mod_unassigned = ${unassigned},
        qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1], qm_dependence = dep(has, rg)` : ''})`;
  return { code, levels: g ? levels : [], unassigned: g ? unassigned : 0 };
}


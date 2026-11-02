// The generalised linear mixed model for single-group proportions: metafor's rma.glmm() with the logit link and a normal
// random study effect (a binomial–normal model). It models the events themselves, so no continuity correction enters the
// estimate and a study with no events is not a problem (Röver and Friede's alternative to the Freeman–Tukey transform, and
// the model Schwarzer et al. recommend for meta-analysis of single proportions). It needs lme4, a vendored closure of nine
// packages fetched only when this model is chosen (vendor.lock.json, target "lme4"; plan §4.6 amendment of 2026-09-29).
// For measure "PLO" metafor ignores rma.glmm's `model` argument: there is one fitted model, and it is the one used.
// The study estimates drawn in the forest plot are the logits with 0.5 added to a zero cell (escalc's default), as for the
// other models; the pooled estimate does not use them. Checked against a binomial–normal likelihood written in base R and
// maximised numerically (bench/proportions-glmm).
const rStr = s => JSON.stringify(String(s ?? ''));

/**
 * R that fits the GLMM to `values` (rows [events, n]) and returns the fields a pooled proportion result stores. With `mod` ({ kind: 'group' |
 * 'numeric', values }) it also fits the moderator: a grouping as rma.glmm(mods = ~ g) (the Wald test of its terms, QM) with each level's own
 * GLMM (a level of one study has none), a number as rma.glmm(mods = ~ x) (its slope on the logit scale).
 */
export function glmmScript({ values, labels, label = 'Proportion', dir = '/tmp', mod = null }) {
  const modR = !mod ? '' : mod.kind === 'group'
    ? `g <- factor(c(${mod.values.map(v => rStr(String(v))).join(',')})); lv <- levels(g)
      rg <- suppressWarnings(rma.glmm(xi=xi, ni=ni, measure="PLO", mods=~g))
      sub <- lapply(lv, function(l) if (sum(g == l) < 2) NULL else tryCatch(suppressWarnings(rma.glmm(xi=xi[g==l], ni=ni[g==l], measure="PLO")), error=function(e) NULL))
      sv <- function(f) sapply(sub, function(m) if (is.null(m)) NA_real_ else f(m))`
    : `x <- c(${mod.values.map(Number).join(',')})
      rg <- suppressWarnings(rma.glmm(xi=xi, ni=ni, measure="PLO", mods=~x))`;
  const modOut = !mod ? '' : mod.kind === 'group'
    ? `, mod_kind = "group", mod_levels = lv, mod_k = as.integer(table(g)[lv]), mod_est = sv(function(m) tf(m$beta[1])), mod_lo = sv(function(m) tf(m$ci.lb)),
        mod_hi = sv(function(m) tf(m$ci.ub)), mod_i2 = sv(function(m) m$I2), mod_tau2 = sv(function(m) m$tau2), qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1]`
    : `, mod_kind = "numeric", slope = rg$beta[2], slope_lo = rg$ci.lb[2], slope_hi = rg$ci.ub[2], slope_p = rg$pval[2], qm = rg$QM, qmp = rg$QMp`;
  return `
      xi <- c(${values.map(v => v[0]).join(',')}); ni <- c(${values.map(v => v[1]).join(',')})
      r <- suppressWarnings(rma.glmm(xi=xi, ni=ni, measure="PLO"))
      ${modR}
      tf <- function(x) transf.ilogit(x)
      tp <- function(x) 100 * transf.ilogit(x)
      ticks <- transf.logit(c(0.01, 0.05, 0.2, 0.5, 0.8, 0.95))
      pr <- predict(r)
      labs <- c(${labels.map(rStr).join(',')})
      svglite("${dir}/forest.svg", width=8.5, height=1.6 + length(xi) * 0.3)
      forest(r, slab=labs, header=c("Study", "% [95% CI]"), atransf=tp, at=ticks, digits=c(1L, 0L), xlab=${rStr(`${label} (%)`)})
      dev.off()
      svg <- paste(readLines("${dir}/forest.svg"), collapse="\\n")
      funnel_svg <- tryCatch({ svglite("${dir}/funnel.svg", width=6, height=4.6); funnel(r, atransf=tp, at=ticks, digits=0L, xlab=${rStr(`${label} (%)`)}); dev.off()
        paste(readLines("${dir}/funnel.svg"), collapse="\\n") }, error=function(e) { if (dev.cur() > 1) dev.off(); NULL })
      list(estimate = tf(r$beta[1]), lo = tf(r$ci.lb), hi = tf(r$ci.ub), pi_lo = tf(pr$pi.lb), pi_hi = tf(pr$pi.ub),
        mu = as.numeric(r$beta[1]), mu_lb = r$ci.lb, mu_ub = r$ci.ub, yi = as.numeric(r$yi), vi = as.numeric(r$vi),
        logit = as.numeric(r$beta[1]), logit_se = r$se, i2 = r$I2, tau2 = r$tau2, q = r$QE.Wld, qp = r$QEp.Wld, k = r$k,
        svg = svg, funnel = funnel_svg, xi = xi, ni = ni${modOut})`;
}

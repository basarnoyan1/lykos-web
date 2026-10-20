// The R for a comparison of two arms read from an evidence table (lib/contrast-counts.mjs; plan §I, comparative analysis
// amendment 2026-10-17). Pure: the analysis view runs it in WebR, bench/comparative runs the same code in native R.
//
// The model is the pairwise engine's (lib/pooled-model.mjs fitR): escalc's risk ratio, odds ratio or risk difference with 0.5
// added to every cell of a study with a zero cell (add = 1/2, to = "only0"), then rma (REML, DerSimonian–Laird or common
// effect, with a z or Hartung–Knapp interval) or rma.mh / rma.peto. A study with no events in either arm is left out before
// this runs (lib/analysis-inputs.mjs zeroEvents), as RevMan does. Subgroups, as in the pairwise view: each level's own fit,
// and the test for subgroup differences as the omnibus test of the subgroup terms (QM) in one model with a shared τ²;
// a study with no level stays in the overall pool and out of the test. Mantel–Haenszel and Peto have no regression: each level is
// pooled the same way on its own studies, and the test for subgroup differences is RevMan's, Q across the levels' estimates with their
// inverse variances (rma(method = "EE") on them), G − 1 df. The GLMM is rma.glmm(measure = "OR") (model "UM.FS", lme4): its Q is the
// Wald test from the saturated model, with no τ² interval, Egger or leave-one-out; subgroups as rma.glmm(mods = ~ g) on the studies with a
// level, and each level's own GLMM (none for a level of one study).
import { fitR, escArgs } from './pooled-model.mjs';
import { escalcName } from './effect-measures.mjs';
import { backTransform } from './effect-measures.mjs';
import { heterogeneityR, isHK } from './heterogeneity.mjs';

const rStr = s => JSON.stringify(String(s ?? ''));
/** The subgroup levels present: in the order given, then any others alphabetically. A level of one study is kept, as RevMan keeps it. */
export function levelsOf(rows, order = []) {
  const present = new Set(rows.map(r => r.level).filter(l => l != null && l !== '').map(String));
  const known = [...new Set(order.map(String))].filter(l => present.has(l));
  return [...known, ...[...present].filter(l => !known.includes(l)).sort((a, b) => a.localeCompare(b))];
}

/**
 * R for these rows (`{ label, study, values: [events treated, n treated, events control, n control], level }`), ending in the
 * list the view stores. `subgroups` turns the subgroup analysis on; `order` is the levels' preferred order.
 */
export function contrastScript({ rows, measure = 'RR', method = 'REML', test = 'z', pi = 'follow', subgroups = false, order = [], dir = '/tmp' }) {
  const rare = method === 'MH' || method === 'PETO', glmm = method === 'GLMM';
  const levels = subgroups ? levelsOf(rows, order) : [];
  const g = levels.length >= 2;
  const lv = rows.map(r => (levels.includes(r.level) ? r.level : null));
  const knha = isHK(test) ? `, test="${test}"` : '';
  const back = backTransform(measure);
  const at = back ? `atransf=${back}, ` : '';
  const code = `
      ${glmm ? `d <- escalc(measure="OR", ${escArgs('OR', rows.map(r => r.values))})
      r <- suppressWarnings(rma.glmm(measure="OR", ${escArgs('OR', rows.map(r => r.values))}))` : fitR({ measure, method, test, values: rows.map(r => r.values) })}
      labs <- c(${rows.map(r => rStr(r.label)).join(',')})
      tf <- function(x) ${back ? `${back}(x)` : 'x'}
      pr <- predict(r)
      ${glmm ? 'het_pt <- NULL; het <- list()' : heterogeneityR({ random: !rare && method !== 'EE', pi })}
      ${g ? `
      d$g <- factor(c(${lv.map(l => (l == null ? 'NA' : rStr(l))).join(',')}), levels=c(${levels.map(rStr).join(',')}))
      lv <- levels(d$g)${glmm ? `
      rg <- suppressWarnings(rma.glmm(measure="OR", ${escArgs('OR', rows.filter((_, i) => lv[i] != null).map(r => r.values))}, mods=~ factor(c(${lv.filter(l => l != null).map(rStr).join(',')}), levels=c(${levels.map(rStr).join(',')}))))
      sub <- list(${levels.map(l => { const own = rows.filter((_, i) => lv[i] === l); return own.length < 2 ? 'NULL' : `tryCatch(suppressWarnings(rma.glmm(measure="OR", ${escArgs('OR', own.map(r => r.values))})), error=function(e) NULL)`; }).join(', ')})` : rare ? `
      sub <- lapply(lv, function(l) ${method === 'MH' ? `rma.mh(${escArgs(measure, rows.map(r => r.values))}, measure="${escalcName(measure)}"` : `rma.peto(${escArgs(measure, rows.map(r => r.values))}`}, subset=(!is.na(d$g) & d$g == l)))
      rg <- rma(yi=sapply(sub, function(m) m$beta[1]), sei=sapply(sub, function(m) m$se), method="EE")` : `
      has <- which(!is.na(d$g))
      rg <- rma(yi, vi, mods=~ g, data=d[has, ], method="${method}"${knha})
      sub <- lapply(lv, function(l) rma(yi, vi, data=d, subset=(!is.na(g) & g == l), method="${method}"${knha}))`}
      gp <- factor(ifelse(is.na(d$g), "No subgroup", as.character(d$g)), levels=c(lv${lv.some(l => l == null) ? ', "No subgroup"' : ''}))
      plv <- levels(gp); ns <- as.integer(table(gp)[plv]); m <- length(plv)
      pos <- 1; polyrows <- integer(m); heads <- integer(m); rowsets <- vector("list", m)
      for (i in rev(seq_len(m))) { polyrows[i] <- pos; rowsets[[i]] <- rev(seq(pos + 1, pos + ns[i])); heads[i] <- pos + ns[i] + 1; pos <- pos + ns[i] + 3 }
      svglite("${dir}/forest.svg", width=8.5, height=1.2 + 0.3 * (pos + 2.5))
      forest(r, slab=labs, header="Study", order=gp, rows=unlist(rowsets), ylim=c(-1.5, pos + 1), ${at}xlab="${measure}")
      for (i in seq_len(m)) if (plv[i] %in% lv && !is.null(sub[[which(lv == plv[i])]])) addpoly(sub[[which(lv == plv[i])]], row=polyrows[i], mlab=paste0(plv[i], " (k = ", ns[i], ")"), ${at}cex=0.9)
      text(par("usr")[1], heads, plv, pos=4, font=4, cex=0.9)
      dev.off()` : `
      svglite("${dir}/forest.svg", width=8.5, height=${(1.6 + rows.length * 0.42).toFixed(2)})
      forest(r, slab=labs, header="Study", ${at}xlab="${measure}")
      dev.off()`}
      svg <- paste(readLines("${dir}/forest.svg"), collapse="\\n")
      funnel_svg <- tryCatch({ svglite("${dir}/funnel.svg", width=6, height=4.6); funnel(r, ${at}xlab="${measure}"); dev.off()
        paste(readLines("${dir}/funnel.svg"), collapse="\\n") }, error=function(e) { if (dev.cur() > 1) dev.off(); NULL })
      eg <- if (${glmm ? 'FALSE' : 'TRUE'} && r$k >= 3) tryCatch(regtest(r), error=function(e) NULL) else NULL
      loo <- if (${glmm ? 'FALSE' : 'TRUE'} && r$k >= 3) tryCatch(leave1out(r), error=function(e) NULL) else NULL
      sv <- function(f) sapply(sub, function(m) if (is.null(m)) NA_real_ else f(m))
      num_or_null <- function(x) if (is.null(x) || length(x) == 0 || is.na(x[1])) NULL else x[1]
      c(list(
        estimate = tf(r$beta[1]), lo = tf(r$ci.lb), hi = tf(r$ci.ub),
        pi_lo = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[1]) else tf(pr$pi.lb),
        pi_hi = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[2]) else tf(pr$pi.ub),
        i2 = r$I2, tau2 = ${rare ? '0' : 'r$tau2'}, ${glmm ? 'q = r$QE.Wld, qp = r$QEp.Wld' : 'q = r$QE, qp = r$QEp'}, k = r$k, zval = num_or_null(r$zval), pval = num_or_null(r$pval),
        svg = svg, funnel = funnel_svg,
        mu = r$beta[1], mu_lb = r$ci.lb, mu_ub = r$ci.ub, yi = as.numeric(d$yi), vi = as.numeric(d$vi),
        study_est = as.numeric(tf(d$yi)), study_lo = as.numeric(tf(d$yi - qnorm(0.975) * sqrt(d$vi))), study_hi = as.numeric(tf(d$yi + qnorm(0.975) * sqrt(d$vi))),
        weights = ${glmm ? 'NULL' : 'as.numeric(weights(r))'},
        cmh = ${method === 'MH' ? 'num_or_null(r$CO)' : 'NULL'}, cmhp = ${method === 'MH' ? 'num_or_null(r$COp)' : 'NULL'},
        egger_z = if (is.null(eg)) NULL else eg$zval, egger_p = if (is.null(eg)) NULL else eg$pval,
        loo_est = if (is.null(loo)) NULL else as.numeric(tf(loo$estimate)), loo_lo = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.lb)),
        loo_hi = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.ub)), loo_i2 = if (is.null(loo)) NULL else as.numeric(loo$I2)${g ? `,
        mod_kind = "group", mod_levels = lv, mod_k = as.integer(table(d$g)[lv]),
        mod_est = sv(function(m) tf(m$beta[1])), mod_lo = sv(function(m) tf(m$ci.lb)), mod_hi = sv(function(m) tf(m$ci.ub)),
        mod_i2 = sv(function(m) m$I2), mod_tau2 = ${rare ? 'rep(0, length(lv))' : 'sv(function(m) m$tau2)'},
        ${rare ? 'qm = rg$QE, qmp = rg$QEp, qm_df = length(lv) - 1' : 'qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1]'}, mod_unassigned = ${lv.filter(l => l == null).length}` : ''}), het)`;
  return { code, levels: g ? levels : [] };
}

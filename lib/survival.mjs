// Time-to-event analysis for pooled patient-level data.
//
// The methods here are the ones a comparative IPD review actually reports:
// Kaplan–Meier with complementary log–log intervals, log-rank and
// Gehan–Breslow–Wilcoxon across groups, pairwise comparisons with a Holm–Šídák
// adjustment, Cox regression with Efron ties, and the proportional-hazards
// check that says whether the Cox result is admissible at all.
//
// Everything is computed by R's survival package. Nothing is reimplemented
// here, because a hand-rolled survival curve is exactly the kind of number a
// reader cannot check.
import { runR, runSvg } from './r.mjs';
import { quantile, pchisqUpper } from './describe.mjs';

const rVec = xs => `c(${xs.join(',')})`;
const rStr = xs => `c(${xs.map(x => JSON.stringify(String(x))).join(',')})`;

const frame = rows => `
  d <- data.frame(
    time  = ${rVec(rows.map(r => r.time))},
    event = ${rVec(rows.map(r => r.event))},
    grp   = factor(${rStr(rows.map(r => r.group))}))`;

/** A Kaplan–Meier figure, drawn by R so the curve matches the numbers. */
export async function survivalPlot(rows, { title = '', xlab = 'Months', onProgress } = {}) {
  const multi = new Set(rows.map(r => r.group)).size > 1;
  return runSvg(['survival', 'svglite'], `
    ${frame(rows)}
    fit <- survfit(Surv(time, event) ~ ${multi ? 'grp' : '1'}, data = d, conf.type = "log-log")
    svglite(OUTFILE, width = 8, height = 5.2)
    par(mar = c(4.2, 4.4, 2, 1), cex = 0.9)
    plot(fit, col = seq_along(levels(d$grp)), lwd = 2, mark.time = TRUE,
         xlab = ${JSON.stringify(xlab)}, ylab = "Freedom from event",
         main = ${JSON.stringify(title)}, ylim = c(0, 1), conf.int = FALSE)
    ${multi ? `legend("bottomleft", legend = levels(d$grp), col = seq_along(levels(d$grp)),
             lwd = 2, bty = "n", cex = 0.85)` : ''}
    dev.off()`, onProgress);
}

// ============================================================================
// Extended analysis (plan 4.8, amended 2026-09-29).
//
// Each analysis is a pure builder that returns R source, so the same text runs
// in the app's engine (runR), in the bench under Node WebR, and under a native
// Rscript. The script ends by returning one JSON string (`list(json = ...)`)
// written by a small serialiser in the prelude: NA becomes null, a vector is
// always an array, and a nested list is an object, which the flat conversion
// of runR cannot carry. Nothing here computes a survival estimate in
// JavaScript; the shape functions only rename, and apply the presentation
// rule of 4.8 to intervals.
// ============================================================================

/** An R string literal, ASCII only, so the script means the same in any locale. */
export const rs = s => `"${[...String(s)].map(ch => {
  const c = ch.codePointAt(0);
  if (ch === '\\') return '\\\\';
  if (ch === '"') return '\\"';
  if (c === 10) return '\\n';
  if (c === 13) return '\\r';
  if (c === 9) return '\\t';
  if (c < 32 || c > 126) return c > 0xFFFF ? `\\U{${c.toString(16)}}` : `\\u{${c.toString(16)}}`;
  return ch;
}).join('')}"`;

const rn = x => {
  if (!Number.isFinite(Number(x))) throw new Error(`not a number: ${x}`);
  return String(Number(x));
};
const rnums = xs => (xs.length ? `c(${xs.map(rn).join(',')})` : 'numeric(0)');
const rstrs = xs => (xs.length ? `c(${xs.map(rs).join(',')})` : 'character(0)');

const PRELUDE = String.raw`
.warns <- character(0)
.w <- function(expr) withCallingHandlers(expr, warning = function(w) {
  .warns <<- c(.warns, conditionMessage(w)); invokeRestart("muffleWarning") })
.s <- function(s) {
  s <- gsub("\\", "\\\\", s, fixed = TRUE); s <- gsub("\"", "\\\"", s, fixed = TRUE)
  s <- gsub("\n", "\\n", s, fixed = TRUE); s <- gsub("\r", "\\r", s, fixed = TRUE)
  s <- gsub("\t", "\\t", s, fixed = TRUE); paste0("\"", s, "\"") }
.n <- function(x) { x <- as.numeric(x)
  ifelse(is.na(x), "null", ifelse(is.infinite(x), ifelse(x > 0, "1e999", "-1e999"), sprintf("%.17g", x))) }
.j <- function(x) {
  if (is.null(x)) return("null")
  if (is.list(x)) {
    it <- vapply(x, .j, "")
    if (!is.null(names(x))) return(paste0("{", paste0(vapply(names(x), .s, ""), ":", it, collapse = ","), "}"))
    return(paste0("[", paste(it, collapse = ","), "]")) }
  v <- if (is.character(x) || is.factor(x)) ifelse(is.na(x), "null", vapply(as.character(x), .s, ""))
       else if (is.logical(x)) ifelse(is.na(x), "null", ifelse(x, "true", "false"))
       else .n(x)
  paste0("[", paste(v, collapse = ","), "]") }
.ok <- function(expr, or = NULL) tryCatch(expr, error = function(e) or)
`;

/** Groups in the order a table is read in: the levels asked for that occur, then any others, sorted by code point. */
export function groupLevels(rows, levels) {
  const present = [...new Set(rows.map(r => r.group))];
  const own = (levels || []).filter(l => present.includes(l));
  return [...own, ...present.filter(l => !own.includes(l)).sort()];
}

// The data frame every script starts from. Group labels are matched by
// position in `lev`, never sorted by R, so its locale cannot reorder them.
function dataFrame(rows, lev, { covs = [] } = {}) {
  const cols = [
    `time = ${rnums(rows.map(r => r.time))}`,
    `event = ${rnums(rows.map(r => r.event))}`,
    `grp = factor(${rstrs(rows.map(r => r.group))}, levels = ${rstrs(lev)})`,
    `cl = ${rstrs(rows.map(r => r.cluster ?? r.id ?? ''))}`,
    `st = ${rstrs(rows.map(r => r.strata ?? '1'))}`,
  ];
  covs.forEach((c, i) => {
    const vals = rows.map(r => r.x?.[c.id]);
    cols.push(c.type === 'number'
      ? `x${i + 1} = ${rnums(vals)}`
      : `x${i + 1} = factor(${rstrs(vals)}, levels = ${rstrs(c.levels)})`);
  });
  return `d <- data.frame(${cols.join(',\n  ')}, stringsAsFactors = FALSE)\nlev <- ${rstrs(lev)}`;
}

const wrapScript = body => `${PRELUDE}\n${body}\nlist(json = .j(res))`;
const ct = t => rs(t || 'log-log');

/**
 * Kaplan–Meier per group and overall: counts, person-time, median with its
 * interval, survival at the landmarks, the number at risk at chosen times and
 * the whole step function. `extend = TRUE` reports a landmark past the last
 * follow-up at the last estimate; the shape says when that happened.
 */
export function kmScript(rows, { landmarks = [12, 24, 36], atRiskTimes = [], confType = 'log-log', conf = 0.95, levels } = {}) {
  const lev = groupLevels(rows, levels);
  return wrapScript(`${dataFrame(rows, lev)}
lm <- ${rnums(landmarks)}
ar <- ${rnums(atRiskTimes)}
.km <- function(dd) {
  f <- .w(survfit(Surv(time, event) ~ 1, data = dd, conf.type = ${ct(confType)}, conf.int = ${rn(conf)}))
  tb <- summary(f)$table
  at <- function(tm) if (length(tm)) summary(f, times = tm, extend = TRUE) else NULL
  s <- at(lm); a <- at(ar)
  list(n = nrow(dd), events = sum(dd$event), ptime = sum(dd$time), maxTime = max(dd$time),
       median = tb[["median"]], medianLo = tb[[paste0(${rn(conf)}, "LCL")]], medianHi = tb[[paste0(${rn(conf)}, "UCL")]],
       lm = list(time = s$time, surv = s$surv, lo = s$lower, hi = s$upper, nRisk = s$n.risk),
       ar = list(time = a$time, nRisk = a$n.risk),
       steps = list(time = f$time, surv = f$surv, lo = f$lower, hi = f$upper,
                    nRisk = f$n.risk, nEvent = f$n.event, nCensor = f$n.censor))
}
res <- list(kind = "km", groups = lev, confType = ${ct(confType)}, conf = ${rn(conf)}, landmarks = lm, atRiskTimes = ar,
            all = .km(d), by = lapply(lev, function(g) .km(d[d$grp == g, , drop = FALSE])),
            warnings = unique(.warns))`);
}

/** The interval rule of plan 4.8: a collapsed or undefined interval is not shown, the estimate is. */
const band = (lo, hi) => (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : [null, null]);
const fin = x => (Number.isFinite(x) ? x : null);
const col = x => (Array.isArray(x) ? x : x == null ? [] : [x]);
const one = x => (Array.isArray(x) ? x[0] : x) ?? null;
const at100 = (events, pt) => (pt > 0 ? (100 * events) / pt : null);

/** Reads what kmScript returned into per-group objects, applying the interval rule. */
export function kmShape(raw) {
  const grp = (g, name) => {
    const lm = g.lm, st = g.steps, ar = g.ar;
    const lmTime = col(lm.time), lmSurv = col(lm.surv), lmLo = col(lm.lo), lmHi = col(lm.hi), lmN = col(lm.nRisk);
    const stTime = col(st.time), stSurv = col(st.surv), stLo = col(st.lo), stHi = col(st.hi);
    const stN = col(st.nRisk), stE = col(st.nEvent), stC = col(st.nCensor);
    return {
      group: name, n: one(g.n), events: one(g.events), personTime: one(g.ptime), maxTime: one(g.maxTime),
      per100: at100(one(g.events), one(g.ptime)),
      median: { est: fin(one(g.median)), lo: fin(one(g.medianLo)), hi: fin(one(g.medianHi)) },
      survival: lmTime.map((t, i) => {
        const [lo, hi] = band(lmLo[i], lmHi[i]);
        return { time: t, surv: lmSurv[i], lo, hi, collapsed: lo == null, nRisk: lmN[i], beyond: t > one(g.maxTime) };
      }),
      atRisk: col(ar.time).map((t, i) => ({ time: t, n: col(ar.nRisk)[i] })),
      steps: stTime.map((t, i) => {
        const [lo, hi] = band(stLo[i], stHi[i]);
        return { time: t, surv: stSurv[i], lo, hi, nRisk: stN[i], nEvent: stE[i], nCensor: stC[i] };
      }),
    };
  };
  return {
    groups: col(raw.groups), confType: one(raw.confType), conf: one(raw.conf),
    landmarks: col(raw.landmarks), atRiskTimes: col(raw.atRiskTimes),
    overall: grp(raw.all, 'All'), by: raw.by.map((g, i) => grp(g, col(raw.groups)[i])),
    warnings: col(raw.warnings), rScript: raw.rScript,
  };
}

/**
 * Median potential follow-up by the reverse Kaplan–Meier method (Schemper and
 * Smith): the event indicator is flipped, so a censoring is the "event".
 */
export function reverseKmScript(rows, { confType = 'log-log', conf = 0.95, levels } = {}) {
  const lev = groupLevels(rows, levels);
  return wrapScript(`${dataFrame(rows, lev)}
.rk <- function(dd) {
  f <- .w(survfit(Surv(time, 1 - event) ~ 1, data = dd, conf.type = ${ct(confType)}, conf.int = ${rn(conf)}))
  tb <- summary(f)$table
  list(n = nrow(dd), censored = sum(1 - dd$event), median = tb[["median"]],
       lo = tb[[paste0(${rn(conf)}, "LCL")]], hi = tb[[paste0(${rn(conf)}, "UCL")]])
}
res <- list(kind = "reverseKm", groups = lev, all = .rk(d),
            by = lapply(lev, function(g) .rk(d[d$grp == g, , drop = FALSE])), warnings = unique(.warns))`);
}

export function reverseKmShape(raw) {
  const g = (x, group) => ({ group, n: one(x.n), censored: one(x.censored), median: fin(one(x.median)), lo: fin(one(x.lo)), hi: fin(one(x.hi)) });
  return { groups: col(raw.groups), overall: g(raw.all, 'All'), by: raw.by.map((x, i) => g(x, col(raw.groups)[i])), warnings: col(raw.warnings), rScript: raw.rScript };
}

/**
 * Log-rank (survdiff), Gehan–Breslow–Wilcoxon (risk-set weights, computed here
 * by the same hypergeometric sums survdiff uses, because survdiff's rho = 1 is
 * the Peto–Peto weighting, a different test), Peto–Peto (survdiff rho = 1),
 * the stratified log-rank when rows carry `strata`, and the pairwise log-rank
 * table with Holm–Šídák adjustment.
 */
export function logrankScript(rows, { levels } = {}) {
  const lev = groupLevels(rows, levels);
  const strat = rows.some(r => r.strata != null);
  return wrapScript(`${dataFrame(rows, lev)}
d$grp <- droplevels(d$grp)
.wlr <- function(dd, wt) {
  dd$st <- "1"                      # unstratified; the stratified test is survdiff's
  lv <- levels(droplevels(dd$grp)); k <- length(lv)
  if (k < 2) return(NULL)
  U <- numeric(k); V <- matrix(0, k, k)
  for (s in unique(dd$st)) {
    x <- dd[dd$st == s, , drop = FALSE]; gx <- match(as.character(x$grp), lv)
    for (t in sort(unique(x$time[x$event == 1]))) {
      nk <- tabulate(gx[x$time >= t], k); dk <- tabulate(gx[x$time == t & x$event == 1], k)
      n <- sum(nk); dd_ <- sum(dk); w <- if (wt == "gb") n else 1
      U <- U + w * (dk - dd_ * nk / n)
      if (n > 1) V <- V + w^2 * dd_ * (n - dd_) / (n - 1) * (diag(nk / n, k) - outer(nk, nk) / n^2)
    }
  }
  ch <- .ok(as.numeric(t(U[-k]) %*% solve(V[-k, -k, drop = FALSE], U[-k])), NA_real_)
  list(chisq = ch, df = k - 1, p = pchisq(ch, k - 1, lower.tail = FALSE))
}
.sd <- function(dd, rho, stratified = FALSE) {
  f <- if (stratified) Surv(time, event) ~ grp + strata(st) else Surv(time, event) ~ grp
  x <- .w(survdiff(f, data = dd, rho = rho))
  df <- sum(x$n > 0) - 1
  list(chisq = x$chisq, df = df, p = pchisq(x$chisq, df, lower.tail = FALSE),
       n = as.numeric(x$n), obs = rowSums(as.matrix(x$obs)), exp = rowSums(as.matrix(x$exp)))
}
multi <- nlevels(d$grp) > 1
pairs <- if (multi) combn(levels(d$grp), 2) else matrix(character(0), 2, 0)
raw <- apply(pairs, 2, function(p) {
  sub <- droplevels(d[d$grp %in% p, , drop = FALSE])
  .ok(.sd(sub, 0, ${strat ? 'TRUE' : 'FALSE'})$p, NA_real_) })
ok <- which(!is.na(raw)); m <- length(ok)
adj <- rep(NA_real_, length(raw)); ord <- ok[order(raw[ok])]; running <- 0
for (i in seq_along(ord)) {
  v <- 1 - (1 - raw[ord[i]])^(m - i + 1); running <- max(running, v); adj[ord[i]] <- min(1, running) }
res <- list(kind = "logrank", groups = levels(d$grp), tests = list(
    logrank = if (multi) .ok(.sd(d, 0)) else NULL,
    gehanBreslow = if (multi) .ok(.wlr(d, "gb")) else NULL,
    petoPeto = if (multi) .ok(.sd(d, 1)) else NULL,
    stratified = ${strat ? 'if (multi) .ok(.sd(d, 0, TRUE)) else NULL' : 'NULL'}),
  pairwise = list(a = pairs[1, ], b = pairs[2, ], p = raw, padj = adj, stratified = ${strat ? 'TRUE' : 'FALSE'}),
  warnings = unique(.warns))`);
}

export function logrankShape(raw) {
  const t = x => (x ? { chisq: fin(one(x.chisq)), df: one(x.df), p: fin(one(x.p)),
    ...(x.n ? { n: col(x.n), observed: col(x.obs), expected: col(x.exp) } : {}) } : null);
  const a = col(raw.pairwise.a), b = col(raw.pairwise.b), p = col(raw.pairwise.p), pa = col(raw.pairwise.padj);
  return {
    groups: col(raw.groups),
    logrank: t(raw.tests.logrank), gehanBreslow: t(raw.tests.gehanBreslow),
    petoPeto: t(raw.tests.petoPeto), stratified: t(raw.tests.stratified),
    pairwise: a.map((x, i) => ({ a: x, b: b[i], p: p[i], padj: pa[i] })), pairwiseStratified: !!one(raw.pairwise.stratified),
    warnings: col(raw.warnings), rScript: raw.rScript,
  };
}

/** Holm–Šídák on a list of p-values; null stays null and is not counted. */
export function holmSidak(ps) {
  const ok = ps.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p)).sort((x, y) => x[0] - y[0]);
  const out = ps.map(() => null), m = ok.length;
  let running = 0;
  ok.forEach(([p, i], j) => {
    running = Math.max(running, 1 - (1 - p) ** (m - j));
    out[i] = Math.min(1, running);
  });
  return out;
}

/**
 * Restricted mean survival time through tau from the Kaplan–Meier curve, with
 * survfit's Greenwood-type standard error, per group and overall, and each
 * group's difference and ratio against `reference` (independent groups,
 * normal interval; the ratio's interval is on the log scale).
 */
export function rmstScript(rows, { tau = 36, reference, levels, conf = 0.95 } = {}) {
  const lev = groupLevels(rows, levels);
  const taus = (Array.isArray(tau) ? tau : [tau]);
  const ref = reference ?? lev[0];
  if (!lev.includes(ref)) throw new Error(`reference "${ref}" is not a group`);
  return wrapScript(`${dataFrame(rows, lev)}
taus <- ${rnums(taus)}
ref <- ${rs(ref)}
zq <- qnorm(1 - (1 - ${rn(conf)}) / 2)
.rm <- function(dd, tau) {
  # before anyone's first observation the curve is 1 throughout: survfit refuses, the answer is tau
  if (tau < min(dd$time)) return(list(rmst = tau, se = 0, maxTime = max(dd$time), beyond = FALSE))
  f <- .w(survfit(Surv(time, event) ~ 1, data = dd))
  tb <- summary(f, rmean = tau)$table; nm <- names(tb)
  list(rmst = tb[[which(nm %in% c("rmean", "*rmean"))[1]]], se = tb[[which(nm %in% c("se(rmean)", "*se(rmean)"))[1]]],
       maxTime = max(dd$time), beyond = tau > max(dd$time))
}
res <- list(kind = "rmst", groups = lev, reference = ref, taus = taus, conf = ${rn(conf)}, byTau = lapply(taus, function(tau) {
  by <- lapply(lev, function(g) .rm(d[d$grp == g, , drop = FALSE], tau))
  r <- vapply(by, function(x) x$rmst, 0); s <- vapply(by, function(x) x$se, 0)
  i0 <- match(ref, lev)
  df <- r - r[i0]; sd <- sqrt(s^2 + s[i0]^2)
  rat <- r / r[i0]; lse <- sqrt((s / r)^2 + (s[i0] / r[i0])^2)
  list(tau = tau, all = .rm(d, tau), by = by,
       diff = list(est = df, se = sd, lo = df - zq * sd, hi = df + zq * sd, p = 2 * pnorm(-abs(df / sd))),
       ratio = list(est = rat, lo = rat * exp(-zq * lse), hi = rat * exp(zq * lse)))
}), warnings = unique(.warns))`);
}

export function rmstShape(raw) {
  const groups = col(raw.groups);
  const cell = x => ({ rmst: fin(one(x.rmst)), se: fin(one(x.se)), maxTime: one(x.maxTime), beyond: !!one(x.beyond) });
  return {
    groups, reference: one(raw.reference), conf: one(raw.conf),
    byTau: raw.byTau.map(t => ({
      tau: one(t.tau), overall: cell(t.all),
      groups: t.by.map((x, i) => ({
        group: groups[i], ...cell(x),
        diff: { est: col(t.diff.est)[i], se: fin(col(t.diff.se)[i]), lo: fin(col(t.diff.lo)[i]), hi: fin(col(t.diff.hi)[i]), p: fin(col(t.diff.p)[i]) },
        ratio: { est: fin(col(t.ratio.est)[i]), lo: fin(col(t.ratio.lo)[i]), hi: fin(col(t.ratio.hi)[i]) },
      })),
    })),
    warnings: col(raw.warnings), rScript: raw.rScript,
  };
}

/** A difference of two restricted means (a minus b), normal interval, independent groups. */
export function rmstDifference(a, b, conf = 0.95) {
  const z = normQuantile(1 - (1 - conf) / 2);
  const est = a.rmst - b.rmst, se = Math.hypot(a.se, b.se);
  return { est, se, lo: est - z * se, hi: est + z * se };
}

/**
 * The longest tau every group still has `k` patients at risk at, read from the
 * step functions of a kmShape result: past it a restricted mean rests on a
 * handful of people. Null when some group never has k at risk.
 */
export function maxTauAtRisk(km, k = 10) {
  const per = km.by.map(g => {
    let best = null;
    for (const s of g.steps) if (s.nRisk >= k) best = s.time;
    return best;
  });
  return per.some(x => x == null) ? null : Math.min(...per);
}

/**
 * Cox regression with Efron ties. The group term comes first (`reference` is
 * its baseline), then `covariates` ({id, name, type: 'number' | 'category',
 * levels}), then strata from rows' `strata`. With cluster = true the variance
 * is the robust one clustered on rows' `cluster` (the source publication) and
 * the interval and Wald p are taken from it. The proportional-hazards test is
 * cox.zph on the model without the cluster adjustment.
 */
export function coxScript(rows, { reference, covariates = [], cluster = false, levels, ties = 'efron', conf = 0.95 } = {}) {
  const lev = groupLevels(rows, levels);
  const ref = reference ?? lev[0];
  if (!lev.includes(ref)) throw new Error(`reference "${ref}" is not a group`);
  const covs = covariates.map(c => (c.type === 'number' ? c : { ...c, levels: c.levels || [...new Set(rows.map(r => r.x?.[c.id]))].sort() }));
  const strat = rows.some(r => r.strata != null);
  const multi = lev.length > 1;
  const terms = [...(multi ? ['grp'] : []), ...covs.map((_, i) => `x${i + 1}`), ...(strat ? ['strata(st)'] : [])];
  if (!terms.filter(t => !t.startsWith('strata')).length) throw new Error('a Cox model needs a group or a covariate');
  const rhs = terms.join(' + ');
  return wrapScript(`${dataFrame(rows, lev, { covs })}
d$grp <- relevel(d$grp, ref = ${rs(ref)})
${covs.map((c, i) => (c.type === 'number' ? '' : `d$x${i + 1} <- relevel(d$x${i + 1}, ref = ${rs(c.reference ?? c.levels[0])})`)).join('\n')}
fit0 <- .w(coxph(Surv(time, event) ~ ${rhs}, data = d, ties = ${rs(ties)}))
${cluster ? `fit1 <- .w(coxph(Surv(time, event) ~ ${rhs} + cluster(cl), data = d, ties = ${rs(ties)}))` : 'fit1 <- fit0'}
sm <- summary(fit1, conf.int = ${rn(conf)}); s0 <- summary(fit0)
cf <- sm$coefficients; ci <- sm$conf.int
tst <- function(x) if (is.null(x)) NULL else list(chisq = unname(x["test"]), df = unname(x["df"]), p = unname(x["pvalue"]))
zp <- .ok(.w(cox.zph(fit0)))
zt <- if (is.null(zp)) NULL else zp$table
res <- list(kind = "cox", reference = ${rs(ref)}, ties = ${rs(ties)}, cluster = ${cluster ? 'TRUE' : 'FALSE'},
  term = rownames(cf), coef = unname(cf[, "coef"]), hr = unname(cf[, "exp(coef)"]),
  se = unname(cf[, "se(coef)"]), robustSe = if ("robust se" %in% colnames(cf)) unname(cf[, "robust se"]) else NULL,
  z = unname(cf[, "z"]), p = unname(cf[, "Pr(>|z|)"]), lo = unname(ci[, 3]), hi = unname(ci[, 4]),
  lr = tst(s0$logtest), wald = tst(sm$waldtest), score = tst(s0$sctest), robust = tst(sm$robtest),
  events = sm$nevent, n = sm$n, ncoef = length(coef(fit1)), epv = sm$nevent / max(1, length(coef(fit1))),
  concordance = unname(sm$concordance[1]),
  zph = if (is.null(zt)) NULL else list(term = rownames(zt), chisq = unname(zt[, "chisq"]), df = unname(zt[, "df"]), p = unname(zt[, "p"])),
  warnings = unique(.warns))`);
}

export function coxShape(raw, { covariates = [] } = {}) {
  const term = col(raw.term);
  const name = t => {
    if (t.startsWith('grp')) return t.slice(3);
    const m = /^x(\d+)(.*)$/.exec(t);
    if (!m) return t;
    const c = covariates[Number(m[1]) - 1];
    return c ? (m[2] ? `${c.name || c.id}: ${m[2]}` : c.name || c.id) : t;
  };
  const test = x => (x ? { chisq: fin(one(x.chisq)), df: one(x.df), p: fin(one(x.p)) } : null);
  const zph = raw.zph ? col(raw.zph.term).map((t, i) => ({ term: t, chisq: fin(col(raw.zph.chisq)[i]), df: col(raw.zph.df)[i], p: fin(col(raw.zph.p)[i]) })) : [];
  return {
    reference: one(raw.reference), ties: one(raw.ties), cluster: !!one(raw.cluster),
    terms: term.map((t, i) => ({
      term: name(t), coef: col(raw.coef)[i], hr: col(raw.hr)[i], se: fin(col(raw.se)[i]),
      robustSe: raw.robustSe ? fin(col(raw.robustSe)[i]) : null,
      z: fin(col(raw.z)[i]), p: fin(col(raw.p)[i]), lo: fin(col(raw.lo)[i]), hi: fin(col(raw.hi)[i]),
    })),
    lr: test(raw.lr), wald: test(raw.wald), score: test(raw.score), robust: test(raw.robust),
    events: one(raw.events), n: one(raw.n), ncoef: one(raw.ncoef), epv: fin(one(raw.epv)),
    concordance: fin(one(raw.concordance)),
    zph, phGlobalP: zph.find(z => z.term === 'GLOBAL')?.p ?? null,
    warnings: col(raw.warnings), rScript: raw.rScript,
  };
}

// ---- running them in the app -------------------------------------------------

/** Runs a builder's script in the engine and parses its JSON, keeping the exact script run. */
export async function runJson(script, onProgress) {
  const res = await runR(['survival'], script, onProgress);
  return { ...JSON.parse(res.json), rScript: res.rScript };
}

/** Kaplan–Meier summary per group; see kmScript and kmShape. */
export async function kmSummary(rows, opts = {}) {
  return kmShape(await runJson(kmScript(rows, opts), opts.onProgress));
}
export async function reverseKm(rows, opts = {}) {
  return reverseKmShape(await runJson(reverseKmScript(rows, opts), opts.onProgress));
}
export async function rmst(rows, opts = {}) {
  return rmstShape(await runJson(rmstScript(rows, opts), opts.onProgress));
}

// ---- pure JavaScript ---------------------------------------------------------

/** Standard normal quantile (Acklam's rational approximation refined by one Halley step; abs. error below 1e-15). */
export function normQuantile(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  let x;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  // one Halley step against erfc
  const e = 0.5 * erfc(-x / Math.SQRT2) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

// erfc by a continued fraction / series pair, good to about 1e-16 relative
function erfc(x) {
  const z = Math.abs(x);
  let r;
  if (z < 2.5) {
    let s = z, t = z; // erf series
    for (let n = 1; n < 200; n++) { t *= -z * z / n; const add = t / (2 * n + 1); s += add; if (Math.abs(add) < 1e-18 * Math.abs(s)) break; }
    r = 1 - 2 / Math.sqrt(Math.PI) * s;
  } else {
    let f = 0;
    for (let n = 60; n >= 1; n--) f = n / 2 / (z + f);
    r = Math.exp(-z * z) / Math.sqrt(Math.PI) / (z + f);
  }
  return x >= 0 ? r : 2 - r;
}

/**
 * The E-value of VanderWeele and Ding for a hazard ratio: the smallest strength
 * of association an unmeasured confounder would need with both treatment and
 * outcome, on the risk-ratio scale, to explain the estimate away.
 *
 * E = RR + sqrt(RR (RR - 1)) for RR >= 1; a protective estimate is inverted
 * first. With `rare` (the default) the hazard ratio stands in for the risk
 * ratio, which holds when the outcome is uncommon (VanderWeele 2017 puts the
 * limit near 15% over follow-up). With rare = false the hazard ratio is first
 * converted by RR ~ (1 - 0.5^sqrt(HR)) / (1 - 0.5^sqrt(1/HR)), the same paper's
 * approximation for a common outcome. `ci` is the E-value of the confidence
 * limit nearest 1, and is 1 when the interval includes 1.
 */
export function eValue({ hr, lo, hi, rare = true } = {}) {
  if (!(hr > 0)) return { point: null, ci: null };
  const toRR = x => (rare ? x : (1 - 0.5 ** Math.sqrt(x)) / (1 - 0.5 ** Math.sqrt(1 / x)));
  const e = x => { const r = x < 1 ? 1 / x : x; return r + Math.sqrt(r * (r - 1)); };
  const point = hr === 1 ? 1 : e(toRR(hr));
  const near = hr < 1 ? hi : lo;
  let ci = null;
  if (Number.isFinite(near) && near > 0) ci = (hr < 1 ? near >= 1 : near <= 1) ? 1 : e(toRR(near));
  return { point, ci };
}

/** Events per 100 person-time units, with the exact (Garwood) Poisson interval. */
export function eventsPer100({ events, personTime, conf = 0.95 } = {}) {
  if (!(personTime > 0)) return { rate: null, lo: null, hi: null };
  const a = (1 - conf) / 2;
  // quantile of a chi-square by bisection on its upper tail (describe.mjs)
  const qchisq = (p, df) => {
    let lo = 0, hi = Math.max(10, df * 4 + 40);
    while (pchisqUpper(hi, df) > 1 - p) hi *= 2;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pchisqUpper(mid, df) > 1 - p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  return {
    rate: (100 * events) / personTime,
    lo: events > 0 ? (100 * qchisq(a, 2 * events)) / 2 / personTime : 0,
    hi: (100 * qchisq(1 - a, 2 * (events + 1))) / 2 / personTime,
  };
}

/** Descriptive follow-up of everyone (not the reverse-KM estimate): median, quartiles, range, type 7. */
export function medianFollowUp(rows) {
  const t = rows.map(r => r.time).filter(Number.isFinite).sort((a, b) => a - b);
  if (!t.length) return { n: 0, median: null, q1: null, q3: null, min: null, max: null };
  return { n: t.length, median: quantile(t, 0.5), q1: quantile(t, 0.25), q3: quantile(t, 0.75), min: t[0], max: t[t.length - 1] };
}

/** Patients, events, person-time and rate per group and overall, from rows alone. */
export function personTime(rows, levels) {
  const lev = groupLevels(rows, levels);
  const one_ = rs_ => {
    const events = rs_.reduce((s, r) => s + r.event, 0), pt = rs_.reduce((s, r) => s + r.time, 0);
    return { n: rs_.length, events, personTime: pt, per100: at100(events, pt) };
  };
  return { overall: one_(rows), by: lev.map(g => ({ group: g, ...one_(rows.filter(r => r.group === g)) })) };
}

/** Number at risk at each time: patients whose follow-up is at least t. */
export function numberAtRisk(rows, times, levels) {
  const lev = groupLevels(rows, levels);
  return lev.map(g => ({ group: g, n: times.map(t => rows.filter(r => r.group === g && r.time >= t).length) }));
}

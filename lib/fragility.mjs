// Fragility of a binary result: how few event-status changes would alter its statistical significance
// (Walsh et al. 2014, J Clin Epidemiol 67:622, for one trial; Atal et al. 2019, J Clin Epidemiol 100:86, for a
// meta-analysis). An exploratory sensitivity analysis of a saved pooled result: it never changes the estimate.
// The algorithms are those of the R package `fragility` (Lin and Chu 2022, PLoS ONE 17:e0268754; GPL, read from its
// source, frag.study.iter() and frag.ma()); nothing is copied, and bench/fragility runs both on the same data.
//
//   One trial (Walsh 2014)   Fisher's exact test, two-sided, at α. Event status is changed for participants of
//     either arm in either direction; the fragility index is the smallest number of such changes that moves
//     p across α (frag.study with methods = "Fisher", modify0 = modify1 = "both"). Every set of changes of
//     that size that does it is kept. The fragility quotient is the index over the trial's participants.
//   A meta-analysis (Atal 2019)   The confidence interval of the pooled effect is compared with the null.
//     One event status at a time, in one arm of one study, is changed in the direction that moves the interval
//     toward (significant) or across (not significant) the null; the change that moves the bound nearest the
//     null furthest is taken (greedy, not exhaustive), and this repeats until the significance changes. The
//     count of changes is the fragility index, over all participants the quotient. From a result that is not
//     significant both directions are followed, the direction of the estimate first, and the smaller count is
//     the (reverse) fragility index. Greedy: the count is an upper bound of the fewest changes (Atal 2019).
//     The model is the result's own estimator and interval test; Mantel–Haenszel and Peto results are refitted
//     as common-effect inverse-variance models, as the other analyses of a saved result do.

const lf = [0];
const logFact = n => { for (let i = lf.length; i <= n; i++) lf.push(lf[i - 1] + Math.log(i)); return lf[n]; };
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

/** Fisher's exact test, two-sided, for events and non-events (a, b) in one arm and (c, d) in the other, as R's fisher.test (relErr 1 + 1e-7). */
export function fisherP(a, b, c, d) {
  const m = a + c, n = b + d, k = a + b, lo = Math.max(0, k - n), hi = Math.min(k, m), den = logChoose(m + n, k);
  const at = x => logChoose(m, x) + logChoose(n, k - x) - den, obs = at(a), ps = [];
  let sum = 0;
  for (let x = lo; x <= hi; x++) ps.push(Math.exp(at(x)));
  const pObs = Math.exp(obs);
  for (const p of ps) if (p <= pObs * (1 + 1e-7)) sum += p;
  return Math.min(1, sum);
}

/**
 * Fragility of one trial by Fisher's exact test (Walsh 2014). `arm0` is the control, `arm1` the treated: [events, n].
 * Returns { p, significant, fi, fq, cases } with `fi` null when no change within `maxF` alters the result; `cases` lists the
 * changes of the smallest size that do, as [change in arm 0, change in arm 1] (positive: a non-event becomes an event).
 */
export function fragilityStudy(e0, n0, e1, n1, { alpha = 0.05, maxF = 100 } = {}) {
  const p0 = fisherP(e0, n0 - e0, e1, n1 - e1), sig = p0 < alpha, n = n0 + n1;
  const ok = (a, b) => e0 + a >= 0 && e0 + a <= n0 && e1 + b >= 0 && e1 + b <= n1;
  for (let f = 1; f <= Math.min(maxF, n); f++) {
    const cases = [];
    for (let a = -f; a <= f; a++) for (const b of new Set([f - Math.abs(a), -(f - Math.abs(a))])) {
      if (!ok(a, b)) continue;
      if ((fisherP(e0 + a, n0 - e0 - a, e1 + b, n1 - e1 - b) < alpha) !== sig) cases.push([a, b]);
    }
    if (cases.length) return { p: p0, significant: sig, fi: f, fq: f / n, cases };
  }
  return { p: p0, significant: sig, fi: null, fq: null, cases: [], maxF };
}

/**
 * R that runs the greedy algorithm of Atal et al. 2019 on the counts and returns list(json = "..."). `values` are
 * the rows [events treated, n treated, events control, n control]; `measure` OR, RR or RD (null value 1, 1, 0 on the
 * analysis scale 0, 0, 0); `method` REML, DL or EE; `test` z, knha or adhoc; `maxSteps` limits the number of changes.
 */
export function fragilityScript({ measure, method, test, values, alpha = 0.05, maxSteps = 100 }) {
  const col = i => `c(${values.map(v => v[i]).join(',')})`;
  return `
      M <- "${measure}"; alpha <- ${alpha}; maxSteps <- ${maxSteps}
      n1 <- ${col(1)}; n0 <- ${col(3)}; e1 <- ${col(0)}; e0 <- ${col(2)}
      fit <- function(e0, e1) tryCatch({
        r <- rma.uni(ai=e1, bi=n1 - e1, ci=e0, di=n0 - e0, measure=M, level=100 * (1 - alpha), method="${method}"${test !== 'z' && method !== 'EE' ? `, test="${test}"` : ''})
        c(beta=as.numeric(r$beta), lb=r$ci.lb, ub=r$ci.ub)
      }, error=function(e) c(beta=NA, lb=NA, ub=NA))
      orig <- fit(e0, e1)
      # one direction: up raises the effect (a control event removed or a treated event added), down lowers it
      walk <- function(up, useUb, crossStrict, lim=maxSteps) {
        a0 <- e0; a1 <- e1; steps <- list()
        repeat {
          if (length(steps) >= lim) return(list(fi=NA, reason="limit", steps=steps))
          cand <- c(if (up) which(a0 > 0) else which(a0 < n0), if (up) which(a1 < n1) else which(a1 > 0))
          arm <- c(rep(0, sum(if (up) a0 > 0 else a0 < n0)), rep(1, sum(if (up) a1 < n1 else a1 > 0)))
          if (length(cand) == 0) return(list(fi=NA, reason="exhausted", steps=steps))
          best <- NULL
          for (i in seq_along(cand)) {
            b0 <- a0; b1 <- a1
            if (arm[i] == 0) b0[cand[i]] <- b0[cand[i]] + (if (up) -1 else 1) else b1[cand[i]] <- b1[cand[i]] + (if (up) 1 else -1)
            f <- fit(b0, b1); bound <- if (useUb) f[["ub"]] else f[["lb"]]
            if (is.na(bound)) next
            done <- if (useUb) (if (crossStrict) bound < 0 else bound >= 0) else (if (crossStrict) bound > 0 else bound <= 0)
            better <- is.null(best) || (if (up) bound > best$bound else bound < best$bound)
            if (better) best <- list(i=i, bound=bound, f=f)
            if (done) { best <- list(i=i, bound=bound, f=f); break }
          }
          if (is.null(best)) return(list(fi=NA, reason="failed", steps=steps))
          i <- best$i
          if (arm[i] == 0) a0[cand[i]] <- a0[cand[i]] + (if (up) -1 else 1) else a1[cand[i]] <- a1[cand[i]] + (if (up) 1 else -1)
          steps[[length(steps) + 1]] <- list(study=cand[i], arm=arm[i], change=if ((arm[i] == 0) == up) -1 else 1, est=best$f[["beta"]], lo=best$f[["lb"]], hi=best$f[["ub"]])
          finished <- if (useUb) (if (crossStrict) best$f[["ub"]] < 0 else best$f[["ub"]] >= 0) else (if (crossStrict) best$f[["lb"]] > 0 else best$f[["lb"]] <= 0)
          if (finished) return(list(fi=length(steps), steps=steps))
        }
      }
      signif <- orig[["ub"]] < 0 || orig[["lb"]] > 0
      out <- if (signif) {
        less <- orig[["ub"]] < 0
        list(direction="significance altered to non-significance", res=walk(up=less, useUb=less, crossStrict=FALSE))
      } else {
        rightFirst <- orig[["beta"]] >= 0
        right <- function(lim=maxSteps) walk(up=TRUE, useUb=FALSE, crossStrict=TRUE, lim=lim)
        left <- function(lim=maxSteps) walk(up=FALSE, useUb=TRUE, crossStrict=TRUE, lim=lim)
        # the second direction only matters if it needs no more changes than the first
        if (rightFirst) { r1 <- right(); l1 <- left(if (is.na(r1$fi)) maxSteps else r1$fi) } else { l1 <- left(); r1 <- right(if (is.na(l1$fi)) maxSteps else l1$fi) }
        useLeft <- if (is.na(l1$fi)) FALSE else if (is.na(r1$fi)) TRUE else l1$fi < r1$fi
        list(direction="non-significance altered to significance", res=if (useLeft) l1 else r1, side=if (useLeft) "below" else "above", other=if (useLeft) r1$fi else l1$fi)
      }
      res <- list(measure=M, alpha=alpha, orig=as.list(orig), significant=signif, fi=out$res$fi, reason=if (is.null(out$res$reason)) NULL else out$res$reason,
        direction=out$direction, side=if (is.null(out$side)) NULL else out$side, steps=out$res$steps, n=sum(n0 + n1))
      list(json = as.character(jsonlite::toJSON(res, auto_unbox=TRUE, digits=NA, null="null", na="null")))`;
}

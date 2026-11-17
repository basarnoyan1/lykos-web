// Sensitivity of a binary pooled result to missing outcome data: informative missingness odds ratios
// (Higgins, White and Wood 2008, Clinical Trials 5:225–239), reimplemented from the paper's description
// and appendix. A sensitivity analysis: the pooled result of the completers is the primary one.
//
// For an arm with r events among n observed participants and m participants whose outcome is missing,
// the IMOR λ is the odds of the event among the missing over the odds among the observed. The risk among
// the missing is p_m = λp/(1 − p + λp), with p = r/n, and the overall risk p* = (1 − a)p + a·p_m,
// a = m/(n + m). Its variance comes from the delta method on p and a with p and a binomial (the
// appendix; the two arms are independent):
//   var(p*) = ((1 − a) + a·λ/(1 − p + λp)²)² · p(1 − p)/n + (p_m − p)² · a(1 − a)/(n + m).
// The effect per study is then the risk ratio, odds ratio or risk difference of p*_E and p*_C, with
// variances by the delta method (log RR: var(p*_E)/p*_E² + var(p*_C)/p*_C²; log OR: var(p*)/(p*(1 − p*))²
// summed; RD: var(p*_E) + var(p*_C)). The studies are then pooled by the same model as the result.
// The named scenarios of the paper's Table 2 are special cases: impute all as events (λ = ∞, replaced by 1e8
// as metasens does) or as non-events (λ = 0), missing participants at the risk of the other arm's observed
// participants (pC, pE), at their own observed risk (λ = 1, the available-case result), and the best and
// worst case for the experimental arm. Checked against metasens::metamiss in native R (bench/missing).
// The Gamble–Hollis uncertainty method (2005) is below, beside them.
export const INF = 1e8;

/** Overall risk and its variance for one arm. `r`, `n` observed events and participants; `m` missing. */
export function armRisk(r, n, m, lam) {
  const p = r / n, a = m / (n + m), pm = lam * p / (1 - p + lam * p);
  const dpdp = (1 - a) + a * lam / (1 - p + lam * p) ** 2;
  const v = dpdp ** 2 * p * (1 - p) / n + (pm - p) ** 2 * a * (1 - a) / (n + m);
  return { p: (1 - a) * p + a * pm, v };
}

/** The IMOR pair of a named scenario for one study. `undesirable` is true when an event is bad (death, relapse). */
export function scenarioImors(name, { rE, nE, rC, nC }, { eventBad = true } = {}) {
  const oddsE = (rE / nE) / (1 - rE / nE), oddsC = (rC / nC) / (1 - rC / nC);
  switch (name) {
    case '0': return [0, 0];
    case '1': return [INF, INF];
    case 'p': return [1, 1];
    case 'pc': return [oddsC / oddsE, 1];
    case 'pe': return [1, oddsE / oddsC];
    // best case for the experimental arm: its missing take the good outcome, the control's the bad one
    case 'b': return eventBad ? [0, INF] : [INF, 0];
    case 'w': return eventBad ? [INF, 0] : [0, INF];
    default: throw new Error(`Unknown scenario ${name}`);
  }
}

/**
 * Effect and variance of one study. `row` is { rE, nE, mE, rC, nC, mC } (events and observed participants
 * per arm, then missing); `measure` RR, OR or RD; `zero` says whether 0.5 is added to the observed counts
 * of a study with a zero cell before imputing (as the pooled result did).
 */
export function studyEffect(measure, row, imorE, imorC, { correct = false } = {}) {
  let { rE, nE, rC, nC } = row;
  if (correct && [rE, nE - rE, rC, nC - rC].some(x => x === 0)) { rE += 0.5; nE += 1; rC += 0.5; nC += 1; }
  const e = armRisk(rE, nE, row.mE, imorE), c = armRisk(rC, nC, row.mC, imorC);
  if (measure === 'RR') return { yi: Math.log(e.p / c.p), vi: e.v / e.p ** 2 + c.v / c.p ** 2 };
  if (measure === 'OR') return { yi: Math.log(e.p / (1 - e.p)) - Math.log(c.p / (1 - c.p)), vi: e.v / (e.p * (1 - e.p)) ** 2 + c.v / (c.p * (1 - c.p)) ** 2 };
  if (measure === 'RD') return { yi: e.p - c.p, vi: e.v + c.v };
  throw new Error(`Measure ${measure} has no missing-data sensitivity`);
}

export const MEASURES_WITH_MISSING = ['RR', 'OR', 'RD'];

// Gamble and Hollis (2005, J Clin Epidemiol 58:579), the uncertainty method: a study keeps the effect of its completers,
// and its uncertainty interval is widened to take in the extremes of the missing data. The interval runs from the lower
// limit of the confidence interval in the worst case for the treated group (its missing participants without the event,
// the control's missing with it) to the upper limit in the best case (the reverse); the standard error is that interval's
// width over 2 × 1.959964. The studies are then pooled with these standard errors and the completers' effects, by the
// model of the result, so the interval of the pooled effect grows with the missing data and its estimate does not move.
// Written from the way metasens 1.5-3 metamiss(method.miss = "GH") does it (GPL; read from its source, nothing copied),
// which builds the two tables with metabin's Wald intervals; bench/missing/gh.mjs compares every quantity with it.
// The estimate is the completers' one, whichever way the event is judged: the interval is symmetric in that.
const Z975 = 1.959963984540054;
/** Wald confidence limits of the effect (log scale for RR and OR) in a 2×2 table: treated events a of n1, control c of n2. */
function wald(measure, a, n1, c, n2) {
  const b = n1 - a, d = n2 - c;
  if (measure === 'RR') { const y = Math.log(a / n1 / (c / n2)), se = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n2); return [y - Z975 * se, y + Z975 * se]; }
  if (measure === 'OR') { const y = Math.log(a * d / (b * c)), se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d); return [y - Z975 * se, y + Z975 * se]; }
  if (measure === 'RD') { const y = a / n1 - c / n2, se = Math.sqrt(a * b / n1 ** 3 + c * d / n2 ** 3); return [y - Z975 * se, y + Z975 * se]; }
  throw new Error(`Measure ${measure} has no missing-data sensitivity`);
}

/** The study's effect (its completers'), the limits of its uncertainty interval, and the variance the pooling uses. `correct` as studyEffect. */
export function gambleHollis(measure, row, { correct = false } = {}) {
  let { rE, nE, rC, nC } = row;
  const { mE, mC } = row;
  if (correct && [rE, nE - rE, rC, nC - rC].some(x => x === 0)) { rE += 0.5; nE += 1; rC += 0.5; nC += 1; }
  const yi = studyEffect(measure, { ...row, rE, nE, rC, nC }, 1, 1).yi;
  const lo = wald(measure, rE, nE + mE, rC + mC, nC + mC)[0], hi = wald(measure, rE + mE, nE + mE, rC, nC + mC)[1];
  const se = (hi - lo) / (2 * Z975);
  return { yi, vi: se * se, lo, hi };
}

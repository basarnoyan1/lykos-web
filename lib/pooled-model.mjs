// The R that fits a pooled effect from its rows, shared by the analysis view's
// Run and by every analysis that refits the same model afterwards (small-study
// tests, diagnostics, robust variance, missing-data sensitivity). One place, so
// a later analysis is computed from exactly the model the result reports.
import { measureOf, escalcName, INPUTS } from './effect-measures.mjs';
import { isHK } from './heterogeneity.mjs';

/** escalc's argument list for the measure's rows (`values` in inputFields order, one array per row). */
export function escArgs(measure, values) {
  const byStudy = values, col = i => `c(${byStudy.map(v => v[i]).join(',')})`;
  if (measureOf(measure).family === 'reported') return `yi=${measureOf(measure).ratio ? `log(${col(0)})` : col(0)}, sei=${col(1)}`;
  // A reported ratio and CI pool as log ratio with SE = (log upper − log lower) / (2 · z₀.₉₇₅).
  return measureOf(measure).family === 'generic'
    ? `yi=log(${col(0)}), sei=(log(${col(2)}) - log(${col(1)})) / (2 * qnorm(0.975))`
    : INPUTS[measureOf(measure).family].map(([, arg], i) => `${arg}=${col(i)}`).join(', ');
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

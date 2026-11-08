// Within-arm standardized mean change (escalc "SMCR", "SMCC"; lib/effect-measures.mjs), follow-up minus baseline, one row per arm
// (escalc m1i = follow-up, m2i = baseline). Both carry metafor's small-sample correction J(n − 1) (.cmicalc) and need n ≥ 3.
// SMCR (Becker 1988) divides by the baseline SD; SMCC divides by the SD of the change scores, given to escalc as sd1i with sd2i = 0
// (lib/pooled-model.mjs), so escalc's sqrt(sd1i² + sd2i² − 2 ri sd1i sd2i) is the change SD itself and r drops out.
// Here: what a result records about the baseline–follow-up correlation it assumed, and the pooled estimate again with other values.
//
// SMCR's sampling variance, 2(1 − r)/n + g²/(2n) (Becker 1988; metafor's vtype "LS"), needs the correlation r between an
// arm's baseline and follow-up scores, which trials rarely report. Where a study does not, lib/analysis-inputs.mjs assumes
// PREPOST_R (0.5) and marks the row; a study's reported r is never replaced. The sensitivity analysis refits the model with
// each value of PREPOST_R_SENSITIVITY in the assumed rows only. SMCC does not use r and has no such assumption. Pure.
import { lib_effect_measures$measureOf as measureOf, lib_effect_measures$inputFields as inputFields } from "../boot.mjs";
import { escalcRow } from './meta-escalc.mjs';
import { fitRma } from './meta-pool.mjs';

/** The correlation assumed where a study does not report it, and the values the sensitivity analysis tries. A convention, not an estimate. */
export const PREPOST_R = 0.5;
export const PREPOST_R_SENSITIVITY = [0.2, 0.5, 0.8];
/** Whether the measure reads a baseline–follow-up correlation (SMCR). */
export const usesPrePostR = id => inputFields(id).includes('r_prepost');

const fmtR = r => String(Number(r));

/** The sentence a result records for its assumed correlations; '' when every pooled row reported r, or the measure does not use it. */
export function assumedRText(measure, labels, assumed = [], r = PREPOST_R) {
  if (!usesPrePostR(measure) || !assumed.length) return '';
  const k = assumed.length, names = assumed.map(i => labels[i] || `Study ${i + 1}`).join(', ');
  return `Baseline–follow-up correlation not reported and assumed to be ${fmtR(r)} in ${k} ${k === 1 ? 'study' : 'studies'} (${names})`;
}

/**
 * The pooled estimate with each assumed correlation in `rs`: `units` as pooledInputs gives them (values in input order, `assumedR`
 * on the rows whose r was assumed). Rows that reported r keep it. Returns [{ r, estimate, lo, hi, tau2, i2, k }] in `rs` order, a
 * fit that does not converge giving nulls; [] for a measure that does not use r or when no row assumed it.
 */
export function prePostSensitivity({ measure, units, method = 'REML', rs = PREPOST_R_SENSITIVITY }) {
  if (!usesPrePostR(measure) || !units.some(u => u.assumedR)) return [];
  const ri = inputFields(measure).indexOf('r_prepost');
  return rs.map(r => {
    const es = units.map(u => escalcRow(measure, u.assumedR ? u.values.map((x, i) => (i === ri ? r : x)) : u.values));
    const f = es.every(Boolean) ? fitRma(es.map(e => e.yi), es.map(e => e.vi), { method }) : null;
    return f ? { r, estimate: f.beta[0], lo: f.ci_lb[0], hi: f.ci_ub[0], tau2: f.tau2, i2: f.I2, k: f.k }
      : { r, estimate: null, lo: null, hi: null, tau2: null, i2: null, k: units.length };
  });
}

/** Whether the measure is a within-arm change score (one row per arm, no comparator). */
export const isChangeMeasure = id => measureOf(id).family === 'change';

// Generic inverse-variance inputs retain the model that produced the estimate.
// Cochrane Handbook 6.3.1: ratios use log estimates and log-scale uncertainty;
// a symmetric Wald interval supplies SE by dividing its width by 2 critical values.
import { measureOf, REPORTED_FIELDS } from './effect-measures.mjs';
import { fieldFor, PRIMARY } from './outcomes.mjs';
import { qnorm, qt } from './dist.mjs';

const numeric = v => {
  if (v?.availability === 'not_found') return null;
  const raw = v?.normalized_value ?? v?.reported_value;
  return raw == null || String(raw).trim() === '' ? null : Number(raw);
};
const text = v => v?.availability === 'not_found' ? '' : String(v?.normalized_value ?? v?.reported_value ?? '').trim();
export function reportedEffect(s, paperId, measure, slot = PRIMARY) {
  const read = base => s.values?.[`${paperId}:${fieldFor(base, slot)}`];
  const raw = Object.fromEntries(REPORTED_FIELDS.map(f => [f, /^(effect_estimate|effect_se|effect_lo|effect_hi|effect_confidence|effect_df)$/.test(f) ? numeric(read(f)) : text(read(f))]));
  const ratio = measureOf(measure).ratio, est = raw.effect_estimate;
  const mode = raw.effect_uncertainty.toUpperCase() || (raw.effect_se != null ? 'SE' : 'CI');
  const errors = [];
  let se = mode === 'SE' ? raw.effect_se : null;
  if (!['SE', 'CI'].includes(mode)) errors.push('Choose SE or CI');
  if (est != null && (!Number.isFinite(est) || ratio && est <= 0)) errors.push('Invalid estimate');
  if (mode === 'CI') {
    const lo = raw.effect_lo, hi = raw.effect_hi, level = raw.effect_confidence ?? 95, df = raw.effect_df;
    if (!(level > 0 && level < 100) || df != null && !(df > 0 && Number.isFinite(df))) errors.push('Invalid confidence level or degrees of freedom');
    if (lo != null && hi != null && est != null) {
      const tx = x => ratio ? Math.log(x) : x;
      if (![lo, hi].every(Number.isFinite) || !(hi > lo && lo <= est && est <= hi) || ratio && lo <= 0) errors.push('Invalid confidence interval');
      else if (!errors.length) {
        const centre = (tx(hi) + tx(lo)) / 2, half = (tx(hi) - tx(lo)) / 2;
        // Rounded Wald limits may differ slightly. A strongly asymmetric interval
        // cannot establish this SE; use the model's reported SE instead.
        if (Math.abs(tx(est) - centre) > 0.1 * half) errors.push('CI is asymmetric on the analysis scale; enter the reported SE');
        else se = half / (df == null ? qnorm(0.5 + level / 200) : qt(0.5 + level / 200, df));
      }
    }
  }
  if (se != null && !(Number.isFinite(se) && se > 0)) errors.push('SE must be positive');
  const identity = { population: raw.effect_population, contrast: raw.effect_contrast,
    adjustmentType: raw.effect_adjustment_type.toLowerCase(), adjustment: raw.effect_adjustment, source: raw.effect_source };
  const identityComplete = identity.population && identity.contrast && ['adjusted', 'unadjusted'].includes(identity.adjustmentType)
    && (identity.adjustmentType === 'unadjusted' || identity.adjustment);
  const values = [est, se];
  return { values, identity, raw, uncertainty: mode, errors, incomplete: !identityComplete || values.some(v => v == null), invalid: errors.length > 0 };
}

export function reportedMix(s, units, slot = PRIMARY) {
  const kinds = [...new Set(units.map(u => u.identity?.adjustmentType).filter(Boolean))];
  const reason = String(s.reportedEffectMix?.[slot] || '').trim();
  return { mixed: kinds.length > 1, reason, blocked: kinds.length > 1 && !reason };
}

// Confidence in the results of a network meta-analysis, CINeMA (Nikolakopoulou et al., PLoS Med 2020;17:e1003082; plan W7): six
// domains judged no, some or major concerns per comparison. The rules the paper states are applied here: imprecision compares the 95%
// confidence interval with the range of equivalence; heterogeneity compares the prediction interval's conclusion with the confidence
// interval's; incoherence reads the local (SIDE) test, and the design-by-treatment test where a comparison has no direct and indirect
// evidence to split. Within-study bias, reporting bias and indirectness rest on the contribution matrix and on judgment (the paper gives
// no cut-off), so they come from the reviewer, as does incoherence when the SIDE test signals. The confidence starts at high and drops
// one level per domain with some concerns and two per domain with major concerns (the paper's default mapping; domains are related, so a
// reviewer may override it). Pure; app/test/cinema.test.mjs.

export const LEVELS = Object.freeze(['no', 'some', 'major']);
export const CONFIDENCE = Object.freeze(['very low', 'low', 'moderate', 'high']);

/** A reviewer's level from a cell: 'no' (no concerns), 'some', 'major', or null. */
export function levelOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^no\b|^none\b|^no concerns/.test(s) ? 'no' : /^some/.test(s) ? 'some' : /^major/.test(s) ? 'major' : null;
}

/** The zones an interval [lo, hi] reaches against the range of equivalence [b1, b2]: below it, inside it, above it. */
const zones = ([lo, hi], [b1, b2]) => [lo < b1, hi >= b1 && lo <= b2, hi > b2];

/**
 * Imprecision of a 95% CI [lo, hi] against the range of equivalence [b1, b2] around no effect `nul` (b1 < nul < b2): major when the CI
 * reaches clinically important effects on both sides, no concerns when it lies on one side of no effect or within the range, some
 * concerns otherwise (it crosses no effect into the range on the other side).
 */
export function imprecision([lo, hi], [b1, b2], nul) {
  if (lo < b1 && hi > b2) return 'major';
  if (hi < nul || lo > nul || (lo >= b1 && hi <= b2)) return 'no';
  return 'some';
}

/**
 * Heterogeneity from the 95% CI and the prediction interval against the range of equivalence: no concerns when both reach the same
 * zones (the same conclusion), major when the prediction interval crosses both boundaries and the CI does not, some concerns otherwise.
 * Without a prediction interval (fewer than three studies, say) null: the reviewer judges.
 */
export function heterogeneity(ci, pi, range) {
  if (!pi || !pi.every(Number.isFinite)) return null;
  const c = zones(ci, range), p = zones(pi, range);
  if (c.every((z, i) => z === p[i])) return 'no';
  return p[0] && p[2] && !(c[0] && c[2]) ? 'major' : 'some';
}

/**
 * Incoherence: with a SIDE p-value above 0.10, no concerns; at or below it, null (the reviewer compares the direct and indirect
 * intervals). Without a SIDE p-value, the design-by-treatment p-value: major below 0.05, some from 0.05 to 0.10, no concerns above;
 * major when it cannot be computed because the network has no closed loop (`noLoop`); null (the reviewer's) when it is not given.
 */
export function incoherence({ side = null, dbt = null, noLoop = false } = {}) {
  if (Number.isFinite(side)) return side > 0.1 ? 'no' : null;
  if (noLoop) return 'major';
  if (!Number.isFinite(dbt)) return null;
  return dbt < 0.05 ? 'major' : dbt <= 0.1 ? 'some' : 'no';
}

/** The confidence from six domain levels: high, less one per 'some' and two per 'major', never below very low; null if any is missing. */
export function confidence(levels) {
  if (levels.some(l => !LEVELS.includes(l))) return null;
  const drop = levels.reduce((n, l) => n + (l === 'some' ? 1 : l === 'major' ? 2 : 0), 0);
  return CONFIDENCE[Math.max(0, 3 - drop)];
}

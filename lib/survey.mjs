// A survey's response accounting and its Likert items (research type survey-study, CROSS and CHERRIES; plan W7). Outcome rates follow the
// AAPOR Standard Definitions (10th edition, 2023, section 7): I complete, P partial, R refusal and break-off, NC non-contact, O other,
// UH, UR and UO the cases of unknown eligibility, NE not eligible (left out of every rate), e the estimated share of the unknown cases
// that are eligible. A web survey's view, participation and completion rates are CHERRIES' (Eysenbach 2004, items 21-23). A Likert item
// is summarised by the share at each scale point, its median and quartiles (R's type 7) and the shares above and below the midpoint.
// Pure; app/test/survey.test.mjs checks it against R 4.1.2 (bench/measures/survey-oracle.R).
import { quantile } from './describe.mjs';

/** The AAPOR codes and the names a disposition column may use for them (case and spacing ignored). */
export const DISPOSITIONS = Object.freeze({
  I: ['complete', 'completed', 'complete interview', 'i', '1.1'],
  P: ['partial', 'partial interview', 'p', '1.2'],
  R: ['refusal', 'refused', 'break-off', 'breakoff', 'refusal and break-off', 'r', '2.10', '2.1'],
  NC: ['non-contact', 'noncontact', 'no contact', 'nc', '2.20', '2.2'],
  O: ['other', 'o', '2.30', '2.3', '2.90', '2.9'],
  UH: ['unknown household', 'uh', '3.10', '3.1'],
  UR: ['unknown eligibility', 'ur', '3.20', '3.2'],
  UO: ['unknown other', 'unknown', 'uo', '3.90', '3.9'],
  NE: ['not eligible', 'ineligible', 'ne', '4', '4.0'],
});
const NAMES = new Map(Object.entries(DISPOSITIONS).flatMap(([code, names]) => names.map(n => [n, code])));

/** The AAPOR code of a disposition label, or null when it is not one of DISPOSITIONS' names. */
export const dispositionOf = label => NAMES.get(String(label ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) ?? null;

/**
 * The outcome rates of AAPOR's section 7 from disposition `counts` ({ I, P, R, NC, O, UH, UR, UO, NE }, missing ones 0). `e` is the
 * share of the unknown cases that are eligible; without one, the share eligible among the cases of known eligibility (eligible over
 * eligible plus not eligible), whose basis the method line states. Returns { e, eGiven, RR1…RR6, COOP1…COOP4, REF1…REF3, CON1…CON3 },
 * a rate null when its denominator is 0.
 */
export function outcomeRates(counts, { e = null } = {}) {
  const c = k => Number(counts[k]) || 0, I = c('I'), P = c('P'), R = c('R'), NC = c('NC'), O = c('O'), U = c('UH') + c('UR') + c('UO');
  const eligible = I + P + R + NC + O, known = eligible + c('NE');
  const eGiven = Number.isFinite(e) && e >= 0 && e <= 1, ee = eGiven ? e : known ? eligible / known : 1;
  const r = (num, den) => (den > 0 ? num / den : null);
  const all = (I + P) + (R + NC + O) + U, est = (I + P) + (R + NC + O) + ee * U, knownOnly = (I + P) + (R + NC + O), contacted = (I + P) + R + O;
  return { e: ee, eGiven,
    RR1: r(I, all), RR2: r(I + P, all), RR3: r(I, est), RR4: r(I + P, est), RR5: r(I, knownOnly), RR6: r(I + P, knownOnly),
    COOP1: r(I, (I + P) + R + O), COOP2: r(I + P, (I + P) + R + O), COOP3: r(I, (I + P) + R), COOP4: r(I + P, (I + P) + R),
    REF1: r(R, all), REF2: r(R, est), REF3: r(R, knownOnly),
    CON1: r(contacted, all), CON2: r(contacted, est), CON3: r(contacted, knownOnly) };
}

/** CHERRIES' rates from the counts a web survey's log gives: { view, participation, completion }, each null without its counts. */
export function webRates({ siteVisitors = null, surveyVisitors = null, agreed = null, finished = null } = {}) {
  const r = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);
  return { view: r(surveyVisitors, siteVisitors), participation: r(agreed, surveyVisitors), completion: r(finished, agreed) };
}

/**
 * One Likert item on a 1…k scale: `values` (numbers; blanks and values off the scale are left out and counted). Returns { n, offScale,
 * counts (k, index 0 is scale point 1), shares, median, q1, q3, above, below } with above and below the shares past the midpoint
 * ((k + 1) / 2; on an odd scale the middle point is neither), or n 0 when nothing is on the scale.
 */
export function likertItem(values, k) {
  const given = (values || []).filter(v => v != null && v !== '' && Number.isFinite(Number(v))).map(Number);
  const xs = given.filter(v => Number.isInteger(v) && v >= 1 && v <= k).sort((a, b) => a - b), n = xs.length, mid = (k + 1) / 2;
  const counts = Array.from({ length: k }, (_, i) => xs.filter(v => v === i + 1).length);
  if (!n) return { n: 0, offScale: given.length, counts, shares: counts.map(() => null), median: null, q1: null, q3: null, above: null, below: null };
  return { n, offScale: given.length - n, counts, shares: counts.map(x => x / n), median: quantile(xs, 0.5), q1: quantile(xs, 0.25), q3: quantile(xs, 0.75),
    above: xs.filter(v => v > mid).length / n, below: xs.filter(v => v < mid).length / n };
}

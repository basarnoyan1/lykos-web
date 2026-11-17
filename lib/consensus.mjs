// Consensus per statement in one round of a Delphi or other consensus exercise
// (research type consensus-study, plan W7). A round is a dataset: each row a
// panelist, each chosen column a statement, each cell a rating on the round's
// scale. For every statement: the panelists who rated it, the median and
// interquartile range (R's type 7 quantiles), the shares rating in the
// agreement and in the disagreement band, and whether either share reaches the
// threshold. The definition is the protocol's (ACCORD item M12 asks for it and
// its reason); the defaults are the bands either side of the scale's midpoint
// and 70%, and the method line states whichever is used.
//
// Pure: no store, no view.
import { quantile } from './describe.mjs';

/** The scales a panel rates on, with the bands either side of the midpoint. */
export const CONSENSUS_SCALES = Object.freeze({
  '1-9': Object.freeze({ min: 1, max: 9, agree: [7, 9], disagree: [1, 3] }),
  '1-7': Object.freeze({ min: 1, max: 7, agree: [5, 7], disagree: [1, 3] }),
  '1-5': Object.freeze({ min: 1, max: 5, agree: [4, 5], disagree: [1, 2] }),
});

const band = ([lo, hi]) => `${lo}–${hi}`;
/** Whether a value is a rating on the scale: a whole number within it. */
export const onScale = (v, sc) => v != null && v !== '' && Number.isInteger(Number(v)) && Number(v) >= sc.min && Number(v) <= sc.max;

/**
 * One round. `statements` is [{ id, label, values }], values numbers or null. Options: `scale` ('1-9', '1-7'
 * or '1-5') and `threshold`, a share above one half (0.7 by default), so agreement and disagreement cannot
 * both reach it. Returns { scale, bands, threshold, statements } with, per statement, { id, label, n,
 * offScale, median, q1, q3, agree, disagree, agreeN, disagreeN, verdict }: n the on-scale ratings, offScale
 * the numbers left out, agree and disagree shares of n, verdict 'agree', 'disagree' or 'none'.
 */
export function consensusRound(statements, { scale = '1-9', threshold = 0.7 } = {}) {
  const sc = CONSENSUS_SCALES[scale];
  if (!sc) throw new Error(`Unknown rating scale ${scale}`);
  const t = Number(threshold);
  if (!(t > 0.5 && t <= 1)) throw new Error('The consensus threshold must be above 50% and at most 100%');
  const rows = statements.map(({ id, label, values }) => {
    const numbers = (values || []).filter(v => v != null && v !== '' && Number.isFinite(Number(v)));
    const xs = numbers.filter(v => onScale(v, sc)).map(Number).sort((a, b) => a - b);
    const n = xs.length, count = ([lo, hi]) => xs.filter(v => v >= lo && v <= hi).length;
    const agreeN = count(sc.agree), disagreeN = count(sc.disagree);
    // counts against the threshold times n, so 7 of 10 meets 70% whatever the rounding of 0.7
    const reaches = k => n > 0 && k >= t * n - 1e-9;
    return {
      id, label, n, offScale: numbers.length - n,
      median: n ? quantile(xs, 0.5) : null, q1: n ? quantile(xs, 0.25) : null, q3: n ? quantile(xs, 0.75) : null,
      agree: n ? agreeN / n : null, disagree: n ? disagreeN / n : null, agreeN, disagreeN,
      verdict: reaches(agreeN) ? 'agree' : reaches(disagreeN) ? 'disagree' : 'none',
    };
  });
  return { scale, bands: { agree: band(sc.agree), disagree: band(sc.disagree) }, threshold: t, statements: rows };
}

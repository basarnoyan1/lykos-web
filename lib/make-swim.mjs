// Synthesis without meta-analysis on one measure of the Data summary (Make's SWiM, views/summary-make.mjs; Campbell 2020): each study's
// direction of effect as SWiM's standardized metric, read from a counted measure (its share against the median share over the studies) or
// a change (its sign). The vote counts and the sign test are lib/swim-core.mjs's. Pure.
import { readMeasures } from './extraction-measures.mjs';
import { pct } from './make-stats.mjs';

const fmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
/** One study's part for a measure: the first of its parts with that key, or of the `type` asked. */
export function partOf(text, key, type = null) {
  const parts = readMeasures(text) || [];
  return parts.find(x => x.key === key && (!type || x.value.type === type)) || null;
}
/** Wilson's 95% interval of a share. */
export const wilson = (n, N) => { if (!N) return [NaN, NaN]; const z = 1.96, p = n / N, d = 1 + z * z / N, c = (p + z * z / (2 * N)) / d, h = z * Math.sqrt(p * (1 - p) / N + z * z / (4 * N * N)) / d; return [c - h, c + h]; };
export const median = xs => { const t = [...xs].sort((a, b) => a - b), m = t.length >> 1; return t.length ? (t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2) : NaN; };

/**
 * Each study's direction of effect on one measure: a count's share against the median share over the studies (its Wilson interval must
 * leave the median out, else no clear), a change's sign; `higherBetter` says which way is benefit. `studies` [{ paperId, label, text }], `m`
 * { key, type }. Answers { rows: [{ paperId, label, direction, value, n, higher }], rule (what ▲ means, in a few words), median }.
 */
export function directionsOf(studies, m, { higherBetter = false } = {}) {
  const read = studies.map(s => ({ ...s, part: partOf(s.text, m.key, m.type) })).filter(s => s.part);
  const med = m.type === 'tally' ? median(read.map(s => s.part.value.n / s.part.value.N)) : null;
  const rows = read.map(s => {
    const v = s.part.value; let higher, value, n = null;
    if (m.type === 'tally') { const [lo, hi] = wilson(v.n, v.N); higher = lo > med ? 1 : hi < med ? -1 : 0; value = `${v.n}/${v.N} (${pct(v.n / v.N)})`; n = v.N; }
    else { const d = v.to - v.from; higher = d > 0 ? 1 : d < 0 ? -1 : 0; value = `${fmt(v.from)} → ${fmt(v.to)}${v.unit ? ` ${v.unit}` : ''}`; }
    const direction = higher === 0 ? 'no clear' : (higher > 0) === !!higherBetter ? 'benefit' : 'harm';
    return { paperId: s.paperId, label: s.label, direction, value, n, higher };
  });
  const rule = m.type === 'tally' ? `▲ benefit is a share ${higherBetter ? 'above' : 'below'} the median ${pct(med)}, its interval leaving it out` : `▲ benefit is ${higherBetter ? 'an increase' : 'a decrease'}`;
  return { rows, rule, median: med };
}

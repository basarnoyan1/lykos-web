// A scale's whole name and facts, and the words of what a review decided to do with it (W10; owner, 7 Nov 2026: "here maybe you would say
// what is UPDRS"). Kept apart from lib/instruments.mjs, which the shell loads at start: the views that name scales load this with themselves.
import { instrumentOf } from './instruments.mjs';
import { crosswalkOf } from './instrument-crosswalks.mjs';

const str = v => String(v ?? '').trim();
const RATERS = { clinician: 'clinician-rated', patient: 'patient-reported', observer: 'observer-rated' };
const figure = x => String(x).replace('-', '−');
/** A scale's facts as words, each '' when the registry does not state it: { name, range ("0–108"), direction ("higher is worse"), rater }. */
export function scaleFacts(x) {
  const lo = x?.min ?? null, hi = x?.max ?? null;
  return { name: str(x?.name), range: lo != null && hi != null ? `${figure(lo)}–${figure(hi)}` : lo != null ? `${figure(lo)} or more` : hi != null ? `up to ${figure(hi)}` : '',
    direction: x?.higher === 'worse' ? 'higher is worse' : x?.higher === 'better' ? 'higher is better' : '', rater: RATERS[x?.rater] || '' };
}
/** The whole name, for a first mention and a tooltip: "UPDRS-III: Unified Parkinson's Disease Rating Scale, part III (motor examination); 0–108; higher is worse; clinician-rated". */
export function scaleTitle(x) {
  if (!x) return '';
  const f = scaleFacts(x), rest = [f.range, f.direction, f.rater].filter(Boolean);
  return `${x.label || x.code}${f.name && f.name !== x.label ? `: ${f.name}` : ''}${rest.length ? `; ${rest.join('; ')}` : ''}`;
}
/** The whole name of a code in a project, or the code itself when the registry does not know it. */
export const scaleTitleOf = (s, code) => scaleTitle(instrumentOf(s, code)) || str(code);
/** What a review may do with a scale (s.synthesis.scales, read by lib/change-synthesis.mjs): its own pool by default. */
export const SCALE_USES = Object.freeze([
  { id: 'own', label: 'Pool on its own', word: 'pooled on its own' },
  { id: 'convert', label: 'Convert to another scale', word: 'converted' },
  { id: 'sensitivity', label: 'Sensitivity analyses only', word: 'used in sensitivity analyses only' },
  { id: 'exclude', label: 'Exclude', word: 'excluded from the analyses' }]);
const USE_IDS = new Set(SCALE_USES.map(u => u.id));
/** The decision stored for a scale: { use, to?, crosswalk?, at? } (crosswalk: lib/instrument-crosswalks.mjs); { use: 'own' } when none is. */
export function scaleDecision(s, code) {
  const d = s?.synthesis?.scales?.[code];
  if (!d || !USE_IDS.has(d.use) || d.use === 'own') return { use: 'own' };
  const convert = d.use === 'convert';
  return { use: d.use, ...(convert && d.to ? { to: str(d.to) } : {}), ...(convert && d.crosswalk ? { crosswalk: str(d.crosswalk) } : {}), ...(d.at ? { at: d.at } : {}) };
}
/** The decision in words: "pooled on its own", "converted to MDS-UPDRS-III by Goetz 2012", "used in sensitivity analyses only", "excluded from the analyses". */
export function decisionWords(s, d) {
  if (d?.use === 'convert') {
    const x = crosswalkOf(s, d.crosswalk);
    return `converted to ${d.to ? instrumentOf(s, d.to)?.label || d.to : 'another scale'}${x ? ` by ${x.label}` : ''}`;
  }
  return (SCALE_USES.find(u => u.id === d?.use) || SCALE_USES[0]).word;
}

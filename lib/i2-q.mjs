// I² as RevMan and the Cochrane Handbook give it, from Cochran's Q: max(0, (Q − df) / Q) with df = k − 1 (decided 21 October 2026). A saved result keeps
// the model's own I² (metafor's, from τ²) as `i2Model`; every page, token and export reads `i2`. A result with a moderator keeps the model's.
import { setAnalysis, analysisOf } from './outcomes.mjs';
import { noteResult } from './result-versions.mjs';

export function qI2(a) {
  const q = Number(a?.q), k = Number(a?.k);
  if (!a || a.moderator || !Number.isFinite(q) || !(k > 1)) return null;
  return q > 0 ? Math.max(0, (q - (k - 1)) / q) * 100 : 0;
}
export const withQI2 = a => { const i = qI2(a); return i == null || a.i2Model != null ? a : { ...a, i2Model: a.i2, i2: i }; };
/** setAnalysis with the Q-based I²: what the analysis pages save through. A result run again with its inputs or its result changed is a new version (lib/result-versions.mjs). */
export function saveAnalysis(st, slot, a) {
  const next = a && withQI2(a);
  if (next) noteResult(st, `analysis:${slot}`, analysisOf(st, slot), next);
  return setAnalysis(st, slot, next);
}

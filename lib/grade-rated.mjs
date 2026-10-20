// Which pooled outcome a GRADE row reports, and which analysed outcomes no row reports yet. Kept apart from lib/grade-link.mjs (which
// fills a row from its result and reads the analysis inputs to count participants) so the Overview can say what is rated without
// loading the analysis input checks for a project that stored no analysis. lib/grade-link.mjs re-exports both.
import { outcomes, analysisOf } from './outcomes.mjs';
import { atRest } from './paper-use.mjs';

/** The pooling outcome a GRADE row reports, or null. */
export function linkedOutcome(s, row) {
  if (!row || row.analysisOutcome === 'none') return null;
  const list = outcomes(s), name = String(row.name || '').trim().toLowerCase();
  // by name, or by the full text an outcome was once named by (now its definition)
  return list.find(o => o.id === row.analysisOutcome) || (name && list.find(o => o.name.trim().toLowerCase() === name || String(o.definition || '').trim().toLowerCase() === name)) || null;
}

/**
 * The outcomes that have a pooled result and no GRADE row reporting them yet: where rating starts. An analysis the paper does not use and
 * whose data changed since it ran is not offered (lib/paper-use.mjs); `skip` names the outcomes to leave out instead.
 */
export function toRate(s, { skip } = {}) {
  const rated = new Set((s.grade || []).map(g => linkedOutcome(s, g)?.id).filter(Boolean));
  const left = outcomes(s).filter(o => !rated.has(o.id) && analysisOf(s, o.id));
  if (!left.length) return left;
  const out = skip || atRest(s);
  return left.filter(o => !out.has(o.id));
}

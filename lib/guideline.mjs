// A guideline's recommendations and the certainty of the evidence behind each (research type guideline, RIGHT; plan W7), by the GRADE
// handbook (sections 5.4 and 6.1): the overall certainty for a recommendation is rated across the outcomes the panel judged critical, and
// the lowest of them sets it; important outcomes that are not critical do not lower it. An outcome the panel finds unnecessary for the
// decision is marked important rather than critical (the handbook's exception), so the rule here stays mechanical. A recommendation is
// for or against, strong or conditional (weak, discretionary and qualified read as conditional); strength is judged apart from
// certainty. Pure; app/test/guideline.test.mjs.

export const CERTAINTY = Object.freeze(['very low', 'low', 'moderate', 'high']);

/** A certainty level from a cell ('High', 'moderate', 'Very low', ⊕ symbols), or null. */
export function certaintyOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  // a level word anywhere in the cell ('⨁⨁◯◯ LOW', 'Certainty: moderate'), else the count of filled marks (⊕, or GRADEpro's ⨁)
  if (/\bvery low\b/.test(s)) return 'very low';
  const word = ['low', 'moderate', 'high'].find(w => new RegExp(`\\b${w}\\b`).test(s));
  if (word) return word;
  const plus = (s.match(/[⊕⨁]/gu) || []).length;
  return plus >= 1 && plus <= 4 ? CERTAINTY[plus - 1] : null;
}
/** Whether an importance cell says critical: the word, or a GRADE rating of 7 to 9. */
export function criticalOf(v) {
  const s = String(v ?? '').trim().toLowerCase(), n = Number(s);
  return s !== '' && Number.isFinite(n) ? n >= 7 && n <= 9 : /^critical/.test(s);
}
// anywhere in the cell, so one column may say both ('Conditional against', 'Strong recommendation for')
export const strengthOf = v => { const s = String(v ?? '').trim().toLowerCase(); return /\bstrong\b/.test(s) ? 'strong' : /\b(conditional|weak|discretionary|qualified)\b/.test(s) ? 'conditional' : null; };
export const directionOf = v => { const s = String(v ?? '').trim().toLowerCase(); return /\bagainst\b/.test(s) ? 'against' : /\b(for|in favou?r)\b/.test(s) ? 'for' : null; };

/**
 * `rows`: [{ rec, outcome, importance, certainty, strength?, direction? }], one per outcome of a recommendation. Returns the
 * recommendations in first-seen order: [{ rec, outcomes, critical, certainty (the lowest critical one, or null without a critical
 * outcome or while a critical outcome's certainty cannot be read), lowest (that outcome's name), strength, direction, mixed (strength or direction differs between the rows), unread (cells
 * whose certainty could not be read) }].
 */
export function recommendations(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = String(r.rec ?? '').trim();
    if (!key) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return [...by].map(([rec, rs]) => {
    const crit = rs.filter(r => criticalOf(r.importance)).map(r => ({ outcome: r.outcome, c: certaintyOf(r.certainty) }));
    // a critical outcome whose certainty cannot be read leaves the overall certainty open: it might be the lowest
    const read = crit.filter(x => x.c), low = read.length && read.length === crit.length ? read.reduce((a, x) => (CERTAINTY.indexOf(x.c) < CERTAINTY.indexOf(a.c) ? x : a)) : null;
    const strengths = [...new Set(rs.map(r => strengthOf(r.strength)).filter(Boolean))], directions = [...new Set(rs.map(r => directionOf(r.direction)).filter(Boolean))];
    return { rec, outcomes: rs.length, critical: crit.length, certainty: low ? low.c : null, lowest: low ? low.outcome ?? '' : '',
      strength: strengths[0] ?? null, direction: directions[0] ?? null, mixed: strengths.length > 1 || directions.length > 1,
      unread: rs.filter(r => certaintyOf(r.certainty) == null).length };
  });
}

// Screening highlights (plan E2): the review's inclusion and exclusion terms
// as one pattern. A term ending in * matches any ending; spaces match any
// run of whitespace; terms match whole words, in any script.
export const termsOf = text => String(text || '').split(/[,;\n]/).map(t => t.trim()).filter(Boolean).slice(0, 100);
const termSource = t => t.replace(/[.*+?^${}()|[\]\\]/g, m => m === '*' ? '*' : `\\${m}`).replace(/\*/g, '[\\p{L}\\p{N}]*').replace(/\s+/g, '\\s+');
/** One term as a pattern that matches it as a whole word, the way the highlights do. */
export const termPattern = t => new RegExp(`(?<![\\p{L}\\p{N}])${termSource(t)}(?![\\p{L}\\p{N}])`, 'iu');
export function highlightPattern(include = [], exclude = []) {
  const alt = list => list.map(termSource).filter(Boolean).join('|');
  const inc = alt(include), exc = alt(exclude);
  if (!inc && !exc) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:(${inc || '(?!)'})|(${exc || '(?!)'}))(?![\\p{L}\\p{N}])`, 'giu');
}

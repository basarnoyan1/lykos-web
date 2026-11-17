// Project vocabularies: code lists with labels and a hierarchy (data-model plan S1, step 2; plan G1 codebook).
//
// A vocabulary is { id, label, terms: [{ code, label, parent?, aliases? }] }. A term with no parent is a top level (a class); a term's
// parent is another term of the same list, so an indication sits under its class. A category or several-categories field names its
// vocabulary (field.vocabulary) and its values are the terms' codes. Kept in the project as s.vocabularies (absent until one is made).
//
// The state writers are pure reducers on a project state (call them inside store.update). Nothing here reads or writes a value: a list
// that removes a code a value still holds is refused, and a field's values move to new codes only through proposals a person accepts.
import { INSTRUMENTS_VOCAB, instrumentVocabulary } from './instruments.mjs';
import { CODE, normalizeVocabulary, problemsOf, termOf, matchTerm, pathOf, topOf, childrenOf, isLeaf, grouped } from './vocabulary-terms.mjs';
export { CODE, normalizeVocabulary, problemsOf, termOf, matchTerm, pathOf, topOf, childrenOf, isLeaf, grouped };

const str = v => String(v ?? '').trim();


export const vocabularies = s => (Array.isArray(s?.vocabularies) ? s.vocabularies : []);
// the outcome instruments (lib/instruments.mjs) are a list every project has without storing it: resolved here, not copied into s.vocabularies
export const vocabularyById = (s, id) => (id === INSTRUMENTS_VOCAB ? instrumentVocabulary(s) : vocabularies(s).find(v => v.id === id) || null);
/** The lists a field can take its levels from: the project's own and the built-in instruments. */
export const fieldVocabularies = s => [...vocabularies(s), instrumentVocabulary(s)];
/** The vocabulary a field takes its levels from, or null. */
export const vocabFor = (s, field) => (field?.vocabulary ? vocabularyById(s, field.vocabulary) : null);

/** Every code a field of this vocabulary holds in a value, with the value keys: Map code -> [key]. `fieldIds` are the fields that name it. */
export function codesInUse(s, fieldIds) {
  const ids = new Set(fieldIds), used = new Map();
  for (const [k, v] of Object.entries(s?.values || {})) {
    if (!ids.has(v?.field_id)) continue;
    for (const c of [v.normalized_value].flat()) if (typeof c === 'string' && c) { if (!used.has(c)) used.set(c, []); used.get(c).push(k); }
  }
  return used;
}

/**
 * Adds or replaces a vocabulary. Returns '' or why it was refused: a list with problems, or one that drops a code a value still holds
 * (`fieldIds` are the fields naming this list; the caller passes them because the fields live in several places).
 */
export function putVocabulary(s, input, { fieldIds = [] } = {}) {
  const v = normalizeVocabulary(input), problems = problemsOf(v);
  if (v.id === INSTRUMENTS_VOCAB) return 'The instruments list is built in: add an instrument to the project instead.';
  if (problems.length) return problems[0];
  const cur = vocabularyById(s, v.id);
  if (cur) {
    const kept = new Set(v.terms.map(t => t.code));
    const lost = [...codesInUse(s, fieldIds).keys()].filter(c => !kept.has(c));
    if (lost.length) return `${lost.length === 1 ? 'A value still holds' : 'Values still hold'} ${lost.slice(0, 3).join(', ')}: recode ${lost.length === 1 ? 'it' : 'them'} first.`;
  }
  const list = vocabularies(s);
  s.vocabularies = cur ? list.map(x => (x.id === v.id ? v : x)) : [...list, v];
  return '';
}
/** Removes a vocabulary no field names. Returns '' or why it was refused. */
export function removeVocabulary(s, id, { fieldIds = [] } = {}) {
  if (fieldIds.length) return 'A field takes its levels from this list.';
  if (id === INSTRUMENTS_VOCAB) return 'The instruments list is built in.';
  s.vocabularies = vocabularies(s).filter(v => v.id !== id);
  if (!s.vocabularies.length) delete s.vocabularies;
  return '';
}

// Project vocabularies: code lists with labels and a hierarchy (data-model plan S1, step 2; plan G1 codebook).
//
// A vocabulary is { id, label, terms: [{ code, label, parent?, aliases? }] }. A term with no parent is a top level (a class); a term's
// parent is another term of the same list, so an indication sits under its class. A category or several-categories field names its
// vocabulary (field.vocabulary) and its values are the terms' codes. Kept in the project as s.vocabularies (absent until one is made).
//
// The state writers are pure reducers on a project state (call them inside store.update). Nothing here reads or writes a value: a list
// that removes a code a value still holds is refused, and a field's values move to new codes only through proposals a person accepts.
import { INSTRUMENTS_VOCAB, instrumentVocabulary } from './instruments.mjs';

const str = v => String(v ?? '').trim();
const fold = t => str(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
export const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/** A vocabulary as stored: trimmed strings, empty aliases dropped, unknown keys dropped. Does not validate (see problemsOf). */
export function normalizeVocabulary(v = {}) {
  const terms = (Array.isArray(v.terms) ? v.terms : []).map(t => {
    const out = { code: str(t?.code), label: str(t?.label).slice(0, 120) };
    if (str(t?.parent)) out.parent = str(t.parent);
    const aliases = (Array.isArray(t?.aliases) ? t.aliases : []).map(str).filter(Boolean);
    if (aliases.length) out.aliases = [...new Set(aliases)].slice(0, 40);
    return out;
  });
  return { id: str(v.id), label: str(v.label).slice(0, 120) || str(v.id), terms };
}

/** What is wrong with a vocabulary, as sentences; [] when it can be saved. */
export function problemsOf(v) {
  const out = [], codes = new Map(), names = new Map();
  if (!CODE.test(v.id || '')) out.push('The list needs an identifier of letters, digits, “_”, “.” or “-”.');
  if (!v.terms.length) out.push('The list has no terms.');
  for (const t of v.terms) {
    if (!CODE.test(t.code)) out.push(`“${t.label || t.code}” needs a code of letters, digits, “_”, “.” or “-”.`);
    else if (codes.has(t.code)) out.push(`The code ${t.code} is used twice.`);
    codes.set(t.code, t);
    if (!t.label) out.push(`${t.code} has no label.`);
    for (const n of [t.label, ...(t.aliases || [])].filter(Boolean)) {
      const k = fold(n), other = names.get(k);
      if (other && other !== t.code) out.push(`“${n}” names both ${other} and ${t.code}.`);
      names.set(k, t.code);
    }
  }
  for (const t of v.terms) if (t.parent && !codes.has(t.parent)) out.push(`${t.code} sits under ${t.parent}, which is not in the list.`);
  for (const t of v.terms) {
    const seen = new Set([t.code]);
    for (let p = codes.get(t.parent); p; p = codes.get(p.parent)) { if (seen.has(p.code)) { out.push(`${t.code} sits under itself.`); break; } seen.add(p.code); }
  }
  return [...new Set(out)];
}

const byCode = v => new Map((v?.terms || []).map(t => [t.code, t]));
export const termOf = (v, code) => byCode(v).get(code) || null;
/** The term a text names: its label, an alias or its code. */
export function matchTerm(v, text) {
  const f = fold(text); if (!f) return null;
  return (v?.terms || []).find(t => fold(t.label) === f) || (v?.terms || []).find(t => t.code === str(text))
    || (v?.terms || []).find(t => (t.aliases || []).some(a => fold(a) === f)) || null;
}
/** The codes from the top level down to `code`: ['movement', 'pd']. [] for an unknown code. */
export function pathOf(v, code) {
  const map = byCode(v), out = [];
  for (let t = map.get(code); t && !out.includes(t.code); t = map.get(t.parent)) out.unshift(t.code);
  return out;
}
export const topOf = (v, code) => pathOf(v, code)[0] || null;
export const childrenOf = (v, code = null) => (v?.terms || []).filter(t => (t.parent || null) === code);
export const isLeaf = (v, code) => !(v?.terms || []).some(t => t.parent === code);

/**
 * Counts grouped by the hierarchy: `counts` maps a code to the number of studies holding it. Returns the top levels in list order, each
 * { code, label, n, own, children } where `n` is the studies under the term (its own plus its descendants', a study counted once per
 * term when `studies` maps a code to a Set of study ids) and `own` those coded at the term itself.
 */
export function grouped(v, studies) {
  const ids = code => studies.get(code) || new Set();
  const node = t => {
    const children = childrenOf(v, t.code).map(node);
    const all = new Set(ids(t.code)); for (const c of children) for (const id of c.ids) all.add(id);
    return { code: t.code, label: t.label, own: ids(t.code).size, n: all.size, ids: all, children };
  };
  return childrenOf(v, null).map(node);
}

// ---- in the project --------------------------------------------------------------------------------------------------------------

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

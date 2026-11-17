// A vocabulary's terms, read without the project (lib/vocabularies.mjs keeps the lists in the project and the built-in instruments list).
// Apart so that a reader of codes (lib/extraction-summary-kinds.mjs, the Overview's facts) does not load the instruments (footprint, review M1).
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

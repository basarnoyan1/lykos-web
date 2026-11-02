// The names and keys of a reference (moved out of lib/bib.mjs on 28 October 2026, which re-exports them): the shell, the library index and the
// citation styles need these few functions, not the RIS, BibTeX, XML and CSV readers beside them.
/**
 * Authors as a list, whatever shape the record arrived in. Importers and
 * hand-edited projects supply a single string as often as an array, and a
 * record that is merely awkward must not take a whole view down with it.
 */
export function authorList(authors) {
  if (Array.isArray(authors)) return authors.filter(Boolean);
  if (typeof authors === 'string') {
    const one = authors.trim();
    // "Smith, John A." is one author: a single comma with no initials before it
    // is the family-name comma, not a separator between "Smith J, Jones K".
    if ((one.match(/,/g) || []).length === 1 && !/;|\s+and\s+/.test(one) && !/\s[A-Z]{1,3}\.?\s*,/.test(one)) return [one];
    return one.split(/;|\s+and\s+|,\s*(?=[A-Z][a-z]+\s)/)
      .map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Author list in the form a reader expects in a table: one name, two joined,
 * three or more as first author et al. The full list stays on the record.
 */
export function authorLine(authors = []) {
  const a = authorList(authors).map(n => initials(n));
  if (!a.length) return '';
  if (a.length <= 2) return a.join(', ');
  return `${a.slice(0, 2).join(', ')}, et al.`;
}

/** "ODA" as a registry sends it is "Oda" as a journal prints it. */
const caseFamily = f => /^[A-Z][A-Z' -]{2,}$/.test(f) ? f.toLowerCase().replace(/(^|[ '-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : f;

/** "Brat DJ" from "Brat, D J" / "Brat DJ" / "Daniel J Brat" (ICMJE form). */
export function initials(name, { comma = false, dots = false } = {}) {
  const s = String(name).trim();
  let family, given;
  if (s.includes(',')) [family, given] = s.split(',').map(x => x.trim());
  else {
    const parts = s.split(/\s+/);
    // "Brat DJ" (family first, initials after) vs "Daniel J Brat" (given first)
    const last = parts[parts.length - 1];
    if (parts.length > 1 && /^[A-Z]{1,3}$/.test(last)) { family = parts.slice(0, -1).join(' '); given = last; }
    else { family = last; given = parts.slice(0, -1).join(' '); }
  }
  // A hyphenated given name gives one initial per part ("Li-Yu" -> LY, "K.-J." -> KJ), as AMA and Vancouver print it
  const ini = (given || '').split(dots ? /[\s.]+/ : /[\s.\-\u2010]+/).filter(Boolean).map(g => g[0].toUpperCase());
  const init = dots ? ini.map(i => `${i}.`).join(' ') : ini.join('');
  family = caseFamily(family || '');
  return comma ? `${family}${init ? `, ${init}` : ''}` : `${family}${init ? ` ${init}` : ''}`;
}

/** The family name alone: "van der Berg" from "van der Berg, J" or "J van der Berg". */
export const familyName = name => initials(name, { comma: true }).split(',')[0].trim();


// A record's key decides whether two imports are the same record: its DOI,
// else its PMID (the forms search results use, lib/sources.mjs recordKey),
// else a hash of title, year and first author. It used to be the record's
// position in the file plus a title prefix, so the first record of two
// different files could share a key when their titles began alike, and the
// second was silently dropped as "already in the library".
export const cleanDoi = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
export function hash64(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
export function importKey({ doi, pmid, title, year, authors }) {
  const d = cleanDoi(doi);
  if (d) return `doi-${d.toLowerCase()}`;
  const m = String(pmid || '').trim();
  if (/^\d+$/.test(m)) return `pmid-${m}`;
  const norm = v => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `rec-${hash64([norm(title), String(year || ''), norm(authorList(authors)[0] || '')].join('|'))}`;
}


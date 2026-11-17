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

// What follows a name and is no part of it ("Malone, Donald A Jr", "Oliva AA Jr", "Mahoney, James J 3rd"); the lower-case words that stand
// before a family name and belong to it ("Jolieke C van der Pols", "Beethoven, Ludwig van"); a word that is initials: one to three capitals
// ("DJ", "JAC"), one capital with or without its full stop ("D", "D."), capitals with full stops or hyphens ("D.J.", "K.-J.", "J-H").
const SUFFIX = /^(?:Jr|Sr|II|III|IV|2nd|3rd|4th)\.?$/, PARTICLE = /^(?:van|von|vom|der|den|de|del|della|di|da|dos|das|du|la|le|ten|ter|te|zu|af|op|el|al|bin|ibn|'t)$/;
const BARE = /^\p{Lu}{1,3}$/u, ONE = /^\p{Lu}\.?$/u, MARKED = /^(?:\p{Lu}[.\-\u2010]+)+\p{Lu}?$/u;
// A name with no comma that is a group's, not a person's ("INTREPID Clinical Study Group", "GBD 2019 Stroke Collaborators", "Butler Hospital").
const GROUP = /\d|\b(?:group|grp|study|trial|team|consortium|collaborat\w*|investigators|committee|society|association|organi[sz]ation|network|alliance|trialists|universi\w*|hospital\w*|institut\w*|cent(?:re|er|ro)|foundation|council|agency|ministry|department|trust|inc|ltd|llc|gmbh|pharma\w*|clinic\w*)\b/i;

/**
 * "Brat DJ" from "Brat, D J" / "Brat DJ" / "Brat, DJ" / "Brat D.J." / "Brat D J" / "Daniel J Brat" / "DJ Brat" (ICMJE form). Initials a
 * record writes bare keep every letter ("Sterne JAC", "Finkelstein, DI": until 11 Nov 2026 all but the first were dropped, and the sham
 * review's appendix printed "Silverberg G" for "Silverberg GD"); only beside a family name in capitals is a word of capitals a name
 * ("OZER, ALI" is "Ozer A"). A hyphenated given name gives one initial a part ("Li-Yu" LY, "K.-J." KJ, "J-H" JH), as AMA and Vancouver
 * print it. The particles before a family name stay with it ("van der Pols JC" from "Jolieke C van der Pols" and from "Pols, Jolieke C van
 * der"), and a suffix follows the initials ("Malone DA Jr", "Mahoney JJ 3rd"; after a comma and with its full stop where the initials have
 * theirs: "Malone, D. A., Jr."). One word alone and a group's name are left as they are written ("WHO", "GBD 2019 Stroke Collaborators").
 */
export function initials(name, { comma = false, dots = false } = {}) {
  const s = String(name).trim();
  if (!/[\s,]/.test(s)) return s;
  let family, given, suffix = '', block = false;
  // the suffix at the end of some words, when `least` words of a name stand before it
  const cut = (words, least) => { if (words.length > least && SUFFIX.test(words.at(-1))) suffix = words.pop().replace(/\.$/, ''); return words; };
  if (s.includes(',')) {
    const seg = s.split(',').map(x => x.trim());
    if (seg[2] && SUFFIX.test(seg[2])) suffix = seg[2].replace(/\.$/, '');
    const f = cut(seg[0].split(/\s+/), 1), g = cut((seg[1] || '').split(/\s+/).filter(Boolean), 1);
    let k = g.length;
    while (k > 1 && PARTICLE.test(g[k - 1])) k--;
    family = [...g.slice(k), ...f].join(' '); given = g.slice(0, k).join(' ');
  } else {
    const w = cut(s.split(/\s+/), 2);
    if (GROUP.test(w.join(' '))) return s;
    let k = w.length;
    // "Brat DJ", "Brat D.J." (family first, one word of initials after) and "Brat D J", "Brat D. J." (each initial a word) vs "Daniel J Brat" (given first)
    if (ONE.test(w[k - 1])) while (k > 1 && ONE.test(w[k - 1])) k--;
    else if (k > 1 && (BARE.test(w[k - 1]) || MARKED.test(w[k - 1]))) k--;
    if (k < w.length) { family = w.slice(0, k).join(' '); given = w.slice(k).join(' '); block = true; }
    else { k = w.length - 1; while (k > 0 && PARTICLE.test(w[k - 1])) k--; family = w.slice(k).join(' '); given = w.slice(0, k).join(' '); }
  }
  const caps = /^\p{Lu}[\p{Lu}' -]{2,}$/u.test(family);
  const ini = given.split(dots ? /[\s.]+/ : /[\s.\-\u2010]+/).filter(Boolean).flatMap(g => (BARE.test(g) && (block || !caps) ? [...g] : [(/\p{L}/u.exec(g) || g)[0].toUpperCase()]));
  const init = dots ? ini.map(i => `${i}.`).join(' ') : ini.join('');
  family = caseFamily(family || '');
  if (suffix && dots && /r$/.test(suffix)) suffix += '.';
  return comma ? [family, init, suffix].filter(Boolean).join(', ') : [family, init, suffix].filter(Boolean).join(' ');
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


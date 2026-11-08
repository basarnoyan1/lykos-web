// Reference formatting in the styles journals ask for.
//
// A record holds fields; a style is a way of ordering and punctuating them.
// These are the common medical styles, written from their published rules
// rather than from a CSL engine, because a CSL engine is a dependency and the
// handful of styles a systematic review needs are a few lines each. A field a
// record lacks is simply omitted, never guessed.
import { lib_bib_names$authorList as authorList, lib_bib_names$initials as initials } from "../boot.mjs";

const authorsVancouver = (names, max = 6) => {
  const a = names.map(n => initials(n));
  return a.length > max ? `${a.slice(0, max).join(', ')}, et al` : a.join(', ');
};

const authorsApa = names => {
  const a = names.map(n => initials(n, { comma: true, dots: true }));
  if (a.length <= 1) return a[0] || '';
  if (a.length <= 20) return `${a.slice(0, -1).join(', ')}, & ${a[a.length - 1]}`;
  return `${a.slice(0, 19).join(', ')}, … ${a[a.length - 1]}`;
};

const authorsHarvard = names => {
  const a = names.map(n => initials(n, { comma: true, dots: true }));
  if (a.length <= 1) return a[0] || '';
  if (a.length > 3) return `${a[0]} et al.`;
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
};

const volPages = p => {
  const v = p.volume ? `${p.volume}${p.issue ? `(${p.issue})` : ''}` : '';
  return v && p.pages ? `${v}:${p.pages}` : v || p.pages || '';
};
const doi = p => (p.doi ? `doi:${p.doi}` : '');
const tidy = s => s.replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/([?!])\./g, '$1').replace(/\s+([,.;:])/g, '$1').trim();

export const STYLES = [
  { id: 'vancouver', label: 'Vancouver (ICMJE)', numbered: true },
  { id: 'ama',       label: 'AMA 11th',           numbered: true },
  { id: 'nlm',       label: 'NLM',                numbered: true },
  { id: 'apa',       label: 'APA 7th',            numbered: false },
  { id: 'harvard',   label: 'Harvard',            numbered: false },
];

// Names that keep their capital when AMA sets an article title in sentence case (a proper noun, a device, a classification).
const AMA_PROPER = new Set(['dynesys', 'waveflex', 'silva-lenke', 'berjano-lamartina', 'türkiye', 'turkey', 'japanese', 'european', 'american', 'chinese', 'korean', 'german', 'italian']);
/**
 * An article title as AMA prints it: sentence case. Only a title set in title case is changed (most of its longer words capitalized); one
 * already in sentence case, with its proper nouns, is left as it is. Kept: the first word, acronyms (two capitals or more), the names in
 * `keep` and AMA_PROPER. The word after a colon is lowercase (AMA's examples), "vs." loses its full stop.
 */
export function amaTitle(title, keep = []) {
  const t = String(title ?? '').replace(/\bvs\./gi, 'vs');
  const words = t.split(/\s+/).filter(Boolean), long = words.filter(w => /^[A-ZÀ-Ý]?[A-Za-zÀ-ÿ'’-]{4,}/.test(w));
  const caps = long.filter(w => /^[A-ZÀ-Ý]/.test(w)).length;
  if (long.length < 3 || caps / long.length < 0.6) return t;
  const kept = new Set([...AMA_PROPER, ...keep.map(k => String(k).toLowerCase())]);
  const low = w => w.replace(/^([^A-Za-zÀ-ÿ]*)([A-ZÀ-Ý])([a-zà-ÿ'’]*)([^A-Za-zÀ-ÿ]*)$/, (m, a, b, c, d) => a + b.toLowerCase() + c + d);
  return words.map((w, i) => {
    const bare = w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$/g, '');
    if (/^[A-Z]{2,}/.test(bare) || /[a-z][A-Z]/.test(bare) || kept.has(bare.toLowerCase())) return w; // acronym or a name
    const parts = w.split(/([-–—])/);
    return parts.map((x, k) => (k === 0 && i === 0 ? x : low(x))).join('');
  }).join(' ');
}

/** The rules each numbered style's formatter applies, as read("journal") states them (tools/mcp/inspect.mjs). */
export const STYLE_RULES = {
  ama: ['Up to six authors listed; more than six: the first three, then "et al"', 'Article titles in sentence case (first word, proper nouns and acronyms capitalized; the word after a colon lowercase)',
    'Journal abbreviated (NLM) and in italics, followed by a full stop', 'Year;volume(issue):pages; a supplement as "(suppl N)"; "vs" without a full stop',
    'DOI as "doi:10.xxx" with no full stop after it', 'Cited in the text as superscript numbers in the order of first citation'],
  vancouver: ['Up to six authors, then "et al."', 'Journal abbreviated (NLM), no italics', 'Year;volume(issue):pages.', 'Cited as numbers in the order of first citation'],
};

/** One reference in the named style. */
export function formatReference(p, style = 'vancouver') {
  const names = authorList(p.authors);
  const y = p.year ? String(p.year) : '';
  switch (style) {
    case 'ama': {
      // Author AB, Author CD. Title. Journal. Year;vol(issue):pages. doi:
      // AMA 11th: up to six authors are listed; with more than six, the first three and "et al"
      const vp = volPages(p).replace(/\(Suppl\b/g, '(suppl');
      const s = [names.length > 6 ? `${names.slice(0, 3).map(n => initials(n)).join(', ')}, et al` : authorsVancouver(names), amaTitle(p.title), p.journal ? `${p.journal}.` : '',
        `${y}${vp ? `;${vp}` : ''}`, doi(p)]
        .filter(Boolean).join('. ');
      // no full stop after a DOI (AMA: it would run into the link)
      return tidy(s.replace(/\.\s*\.\s*/g, '. ') + (doi(p) ? '' : '.'));
    }
    case 'nlm':
    case 'vancouver': {
      // Author AB, Author CD. Title. Journal. Year;vol(issue):pages. doi:
      const s = [authorsVancouver(names), p.title, p.journal,
        `${y}${volPages(p) ? `;${volPages(p)}` : ''}`, doi(p)]
        .filter(Boolean).join('. ');
      return tidy(s + '.');
    }
    case 'apa': {
      // Author, A. B., & Author, C. D. (Year). Title. Journal, vol(issue), pages. https://doi.org/
      const vp = p.volume ? `*${p.volume}*${p.issue ? `(${p.issue})` : ''}` : '';
      const s = [authorsApa(names), y ? `(${y}).` : '', p.title ? `${p.title}.` : '',
        [p.journal, vp, p.pages].filter(Boolean).join(', ') + (p.journal || vp || p.pages ? '.' : ''),
        p.doi ? `https://doi.org/${p.doi}` : '']
        .filter(Boolean).join(' ');
      return tidy(s);
    }
    case 'harvard': {
      // Author, A.B. and Author, C.D. (Year) 'Title', Journal, vol(issue), pp. pages. doi:
      const vp = p.volume ? `${p.volume}${p.issue ? `(${p.issue})` : ''}` : '';
      const s = [authorsHarvard(names), y ? `(${y})` : '', p.title ? `'${p.title}',` : '',
        [p.journal, vp, p.pages ? `pp. ${p.pages}` : ''].filter(Boolean).join(', ') + '.',
        doi(p)]
        .filter(Boolean).join(' ');
      return tidy(s);
    }
    default:
      return formatReference(p, 'vancouver');
  }
}

/** An in-text marker for author–year styles: "(Brat et al., 1998)". */
export function inText(p, style = 'apa') {
  const names = authorList(p.authors);
  const fam = n => initials(n, { comma: true }).split(',')[0];
  const who = names.length === 0 ? (p.label || 'Anon.')
    : names.length === 1 ? fam(names[0])
    : names.length === 2 ? `${fam(names[0])} ${style === 'harvard' ? 'and' : '&'} ${fam(names[1])}`
    : `${fam(names[0])} et al.`;
  return `${who}${p.year ? `, ${p.year}` : ''}`;
}


// Journals and the reference style they instruct: lib/journal-presets.mjs.
export { JOURNAL_PRESETS } from './journal-presets.mjs';
export const styleOf = id => STYLES.find(s => s.id === id) || STYLES[0];

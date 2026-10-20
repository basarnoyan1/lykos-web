// Reference formatting in the styles journals ask for.
//
// A record holds fields; a style is a way of ordering and punctuating them.
// These are the common medical styles, written from their published rules
// rather than from a CSL engine, because a CSL engine is a dependency and the
// handful of styles a systematic review needs are a few lines each. A field a
// record lacks is simply omitted, never guessed.
import { authorList, initials } from './bib.mjs';

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
const tidy = s => s.replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/\s+([,.;:])/g, '$1').trim();

export const STYLES = [
  { id: 'vancouver', label: 'Vancouver (ICMJE)', numbered: true },
  { id: 'ama',       label: 'AMA 11th',           numbered: true },
  { id: 'nlm',       label: 'NLM',                numbered: true },
  { id: 'apa',       label: 'APA 7th',            numbered: false },
  { id: 'harvard',   label: 'Harvard',            numbered: false },
];

/** One reference in the named style. */
export function formatReference(p, style = 'vancouver') {
  const names = authorList(p.authors);
  const y = p.year ? String(p.year) : '';
  switch (style) {
    case 'ama': {
      // Author AB, Author CD. Title. Journal. Year;vol(issue):pages. doi:
      const s = [authorsVancouver(names), p.title, p.journal ? `${p.journal}.` : '',
        `${y}${volPages(p) ? `;${volPages(p)}` : ''}`, doi(p)]
        .filter(Boolean).join('. ');
      return tidy(s.replace(/\.\s*\.\s*/g, '. ') + '.');
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

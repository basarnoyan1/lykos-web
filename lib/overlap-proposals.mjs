// Studies that may share patients, proposed for a person to decide (28 Oct 2026: the Spine review's overlap among one group's studies was
// found by reading the papers' centres and years by hand). Pure. Three signals are read: shared authors (two or more, or the last author);
// a shared institution, from the records' affiliations (filled from Crossref and PubMed: tools/lykos-enrich.mjs, Library › Fill details) or
// from a centre column of the extraction table; and overlapping recruitment years, where a column holds them. A pair of included studies is
// proposed when they share authors, or when they share an institution and their years overlap. Studies already in one overlap group
// (s.synthesis.overlap) are not proposed again. The answer is a list of { a, b, labels, shared, last, centre, institution, period, signals,
// strength }: `signals` names what matched ("shared authors", "same institution", "overlapping years"); strength is "strong" for shared
// authors with a shared institution or overlapping years, else "possible".
import { includedIds } from './review-ledger.mjs';

const fold = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
/** "Ali Fahir Özer" and "Özer AF" both read "ozer a". */
export function authorKey(name) {
  const t = fold(name).replace(/[^a-z\s,.-]/g, ' ').trim();
  if (!t) return '';
  if (t.includes(',')) { const [last, first = ''] = t.split(',').map(x => x.trim()); return `${last.split(/\s+/).pop()} ${first[0] || ''}`.trim(); }
  const parts = t.split(/\s+/).filter(Boolean);
  // "Ozer AF": a last word of capitals only (initials) in the original
  const orig = String(name).trim().split(/\s+/);
  if (orig.length > 1 && /^[A-ZÇĞİÖŞÜ]{1,3}$/.test(orig.at(-1))) return `${parts.slice(0, -1).join(' ').split(' ').pop()} ${parts.at(-1)[0]}`;
  return `${parts.at(-1)} ${parts[0][0]}`;
}

// An institution named in an affiliation: its segment that names one ("Koc University School of Medicine", not "Department of
// Neurosurgery"), cut after the first institution word when a name precedes it ("koc university"), else up to the next one ("university of
// milan"). A key of one word ("hospital"), or of generic words only ("spine center"), says nothing and is dropped.
const INST = /^(universit\w*|hospital\w*|hastane\w*|institut\w*|istituto|cent(er|re)|college|clinic\w*|klinik\w*|school|faculty|foundation)$/;
// a key of only generic words ("spine center", "general hospital") names no one place
const GENERIC = /^(spine|spinal|medical|general|state|national|city|regional|central|teaching|research|orthopa?edic\w*|neuro\w*|surgical|health|childrens?|memorial|of|and|for|de|di|la|del|universit\w*|hospital\w*|cent(er|re)|clinic\w*|institut\w*|college|school|faculty|medicine)$/;
const UNIT = /^(dep(artmen)?t|division|unit|section|service|lab(orator\w*)?|chair|program\w*|graduate)\b/;
export function institutionKeys(affiliations = []) {
  const out = new Set();
  for (const a of Array.isArray(affiliations) ? affiliations : [affiliations]) for (const seg of String(a || '').split(/[,;]/)) {
    const words = fold(seg).replace(/[^a-z0-9\s-]/g, ' ').trim().split(/\s+/).filter(w => w && w !== 'the');
    if (!words.length || UNIT.test(words[0])) continue;
    const i = words.findIndex(w => INST.test(w));
    if (i < 0) continue;
    const j = words.findIndex((w, x) => x > i && INST.test(w));
    const key = (i > 0 ? words.slice(0, i + 1) : words.slice(0, j > 0 ? j : undefined)).join(' ');
    if (key.split(' ').length >= 2 && !key.split(' ').every(w => GENERIC.test(w))) out.add(key);
  }
  return out;
}

const years = t => { const m = String(t || '').match(/\b(19|20)\d{2}\b/g); return m ? [Math.min(...m.map(Number)), Math.max(...m.map(Number))] : null; };
const columnOf = (s, re) => { for (const t of s.templates || []) for (const c of t.columns || []) if (re.test(`${c.label || ''} ${c.id}`)) return c.id; return null; };
const cell = (s, id, col) => { if (!col) return ''; const v = s.values?.[`${id}:${col}`] || Object.entries(s.values || {}).find(([k]) => k.startsWith(`${id}:${col}@`))?.[1]; return v && v.availability !== 'not_found' ? String(v.reported_value ?? '') : ''; };

export function overlapProposals(s) {
  const inc = new Set(includedIds(s)), papers = (s.papers || []).filter(p => inc.has(p.id));
  const grouped = new Map(); for (const g of s.synthesis?.overlap || []) for (const id of g.studies || []) grouped.set(id, g.id);
  const centreCol = columnOf(s, /\b(centre|center|institution|setting|hospital)\b/i), periodCol = columnOf(s, /\b(recruit\w*|enrol\w*|study period|period)\b/i);
  const keyed = papers.map(p => ({ p, authors: (p.authors || []).map(authorKey).filter(Boolean), inst: institutionKeys(p.affiliations) }));
  const out = [];
  for (let i = 0; i < keyed.length; i++) for (let j = i + 1; j < keyed.length; j++) {
    const A = keyed[i], B = keyed[j];
    if (grouped.has(A.p.id) && grouped.get(A.p.id) === grouped.get(B.p.id)) continue;
    const shared = A.authors.filter(x => B.authors.includes(x));
    const last = !!A.authors.length && A.authors.at(-1) === B.authors.at(-1);
    const authors = shared.length >= 2 || last;
    const institution = [...A.inst].filter(k => B.inst.has(k));
    const ca = fold(cell(s, A.p.id, centreCol)), cb = fold(cell(s, B.p.id, centreCol));
    const centre = !!ca && !!cb && (ca.includes(cb) || cb.includes(ca) || ca.split(/[;,]/).some(x => x.trim() && cb.includes(x.trim())));
    const ya = years(cell(s, A.p.id, periodCol)), yb = years(cell(s, B.p.id, periodCol));
    const period = !!ya && !!yb && ya[0] <= yb[1] && yb[0] <= ya[1];
    const place = centre || institution.length > 0;
    if (!authors && !(place && period)) continue;
    const signals = [...(authors ? ['shared authors'] : []), ...(place ? ['same institution'] : []), ...(period ? ['overlapping years'] : [])];
    out.push({ a: A.p.id, b: B.p.id, labels: [A.p.label || A.p.id, B.p.label || B.p.id], shared, last, centre, institution, period, signals, strength: authors && (place || period) ? 'strong' : 'possible' });
  }
  return out.sort((x, y) => (x.strength === y.strength ? y.signals.length - x.signals.length || y.shared.length - x.shared.length : x.strength === 'strong' ? -1 : 1));
}

/** The proposals joined into clusters (studies linked by any proposed pair): [{ studies: [labels], ids, pairs, strong }], largest first. */
export function overlapClusters(s, pairs = overlapProposals(s)) {
  const parent = new Map(), find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const p of pairs) for (const id of [p.a, p.b]) if (!parent.has(id)) parent.set(id, id);
  for (const p of pairs) parent.set(find(p.a), find(p.b));
  const label = new Map(pairs.flatMap(p => [[p.a, p.labels[0]], [p.b, p.labels[1]]])), by = new Map();
  for (const id of parent.keys()) { const r = find(id); if (!by.has(r)) by.set(r, []); by.get(r).push(id); }
  return [...by.values()].map(ids => { const ps = pairs.filter(p => ids.includes(p.a)); return { ids, studies: ids.map(i => label.get(i)), pairs: ps.length, strong: ps.some(p => p.strength === 'strong'), signals: [...new Set(ps.flatMap(p => p.signals))] }; })
    .sort((a, b) => b.ids.length - a.ids.length);
}

// Library filters: narrowing the records list by what is recorded about each
// record — year, authors, journal, source, screening, PDF, language and so on.
//
// Pure: everything is derived from the papers and the project state handed in,
// so the same functions run in the view and in the tests. Facts are computed
// once per record per render (`recordFacts`), then every section, count and
// filter reads from them; a thousand records cost a few milliseconds.
import { authorList, familyName, initials } from './bib.mjs';
import { foldSearch } from './search-ranking.mjs';
import { pdfRank } from './library-records.mjs';
import { storedLanguage, languageCodes } from './languages.mjs';
import { candidateIds } from './dedup-core.mjs';

/** No filter set. */
export const emptyFilters = () => ({ yearFrom: '', yearTo: '', author: '', journal: '', pick: {} });

const fold = v => foldSearch(v).trim();   // accents, ı and İ do not matter
const yearNumber = v => { const m = /\b(1[5-9]\d\d|20\d\d|21\d\d)\b/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };
const DECISIONS = [['include', 'Include'], ['exclude', 'Exclude'], ['uncertain', 'Uncertain'], ['none', 'Not screened']];
let languageNames = null;
const languageName = code => {
  try { languageNames ||= new Intl.DisplayNames(['en'], { type: 'language' }); const n = languageNames.of(code); return n && n !== code ? n : code.toUpperCase(); }
  catch { return code.toUpperCase(); }
};
// Databases as they call themselves, whatever case or short id a record carries ("pubmed", "epmc").
const SOURCE_NAMES = { pubmed: 'PubMed', medline: 'MEDLINE', epmc: 'Europe PMC', 'europe pmc': 'Europe PMC', crossref: 'Crossref', openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials.gov', 'clinicaltrials.gov': 'ClinicalTrials.gov', scopus: 'Scopus', wos: 'Web of Science', 'web of science': 'Web of Science', embase: 'Embase', cinahl: 'CINAHL', 'cochrane library': 'Cochrane Library', zotero: 'Zotero' };
const sourceKey = p => {
  const raw = String(p.database || p.source || '').trim();
  if (!raw) return ['imported', 'Imported'];
  if (/^file$/i.test(raw)) return ['file', 'PDF file'];
  const k = fold(raw);
  return [k, SOURCE_NAMES[k] || (/^\p{Ll}/u.test(raw) ? raw[0].toUpperCase() + raw.slice(1) : raw)];
};

/**
 * What each filter reads from a record, computed once. `s` is the project
 * state (screening, fulltext, values, notes, collections, dedupDismissed).
 */
// What a record's facts read from the record alone, cached on the record
// object and checked against those fields (records are edited in place), so
// an edit elsewhere in the project does not normalise every name again.
const ownCache = new WeakMap();
function ownFacts(p) {
  const r = p.pdfRetrieval;
  const rawLen = typeof p.raw === 'string' ? p.raw.length : Array.isArray(p.raw) ? p.raw.length : p.raw ? 1 : 0;
  const key = `${p.authors}\u0001${p.year}\u0001${p.journal}\u0001${p.journalAbbr}\u0001${p.database}\u0001${p.source}\u0001${p.language}\u0001${rawLen}\u0001${String(p.abstract || '').trim() ? 1 : 0}\u0001${p.pdf ? 1 : 0}\u0001${r?.status}\u0001${r?.provider}\u0001${r?.url}\u0001${p.mergedFrom?.length || 0}`;
  const hit = ownCache.get(p);
  if (hit && hit.key === key) return hit;
  const authors = authorList(p.authors);
  const rank = p.pdf ? 3 : pdfRank(p);
  const [source, sourceLabel] = sourceKey(p);
  const languages = languageCodes(storedLanguage(p));
  // A person is their family name and initials, so "Başak, A.T." and "Basak, Ahmet T" are one entry.
  const fams = [...new Map(authors.map(a => [fold(initials(a)), String(a).trim()])).entries()].filter(([k]) => k);
  const journalName = String(p.journal || p.journalAbbr || '').trim();
  const f = { key, fams, journalName, sourceLabel, source,
    year: yearNumber(p.year), families: authors.map(a => fold(familyName(a))), authors: authors.map(fold),
    journal: fold([p.journal, p.journalAbbr].filter(Boolean).join(' ')),
    pdf: rank === 3 ? 'attached' : rank === 2 ? 'available' : rank === 0 ? 'unresolved' : 'unchecked',
    abstract: String(p.abstract || '').trim() ? 'yes' : 'no', languages: languages.length ? languages : ['none'],
    merged: !!p.mergedFrom?.length };
  ownCache.set(p, f);
  return f;
}

/**
 * What each filter reads from a record, computed once. `s` is the project
 * state (screening, fulltext, values, notes, collections, dedupDismissed).
 */
/** `labelsBy`: under blind dual screening, only that reviewer's labels count (plan E3). */
export function recordFacts(papers, s = {}, { labelsBy = '' } = {}) {
  const withValues = new Set(), withNotes = new Set(), inCollection = new Map();
  for (const key in s.values || {}) {
    const v = s.values[key];
    if (!v) continue;
    if (v.paper_id) withValues.add(String(v.paper_id));
    else { const i = key.lastIndexOf(':'); if (i > 0) withValues.add(key.slice(0, i)); }
  }
  for (const n of s.notes || []) if (n?.paper) withNotes.add(String(n.paper));
  // screening labels (lib/screen-labels.mjs): every reviewer's, or one reviewer's when blind
  const labelled = s.screeningLabels?.of || {}, knownLabels = new Set((s.screeningLabels?.list || []).map(l => l.id));
  for (const c of s.collections || []) for (const id of c.members || []) {
    const list = inCollection.get(id) || []; list.push(c.id); inCollection.set(id, list);
  }
  const candidates = candidateIds(papers, s.dedupDismissed || []);
  const screened = Object.keys(s.screening || {}).length > 0 || Object.keys(s.fulltext || {}).length > 0;
  const facts = new Map();
  for (const p of papers) {
    const o = ownFacts(p);
    const ta = s.screening?.[p.id]?.decision, ft = s.fulltext?.[p.id]?.decision;
    const final = ft || ta;
    const collections = inCollection.get(p.id) || [];
    const dup = [candidates.has(p.id) ? 'candidate' : 'clear'];
    if (o.merged) dup.push('merged');
    facts.set(p.id, {
      authorLabels: o.fams, journalLabel: o.journalName,
      year: o.year, families: o.families, authors: o.authors, journal: o.journal,
      sets: {
        author: o.fams.map(([k]) => k),
        journal: [o.journalName ? fold(o.journalName) : 'none'],
        source: [o.source],
        ta: [DECISIONS.some(([k]) => k === ta) ? ta : 'none'],
        ft: [DECISIONS.some(([k]) => k === ft) ? ft : 'none'],
        included: [screened ? (final === 'include' ? 'yes' : 'no') : 'none'],
        pdf: [o.pdf],
        abstract: [o.abstract],
        language: o.languages,
        collection: collections.length ? collections : ['none'],
        duplicates: dup,
        extraction: [withValues.has(String(p.id)) ? 'yes' : 'no'],
        notes: [withNotes.has(String(p.id)) ? 'yes' : 'no'],
        label: (() => { const mine = labelled[p.id] || {}; const on = Object.keys(mine).filter(id => knownLabels.has(id) && (!labelsBy || mine[id] === labelsBy)); return on.length ? on : ['none']; })(),
      },
      sourceLabel: o.sourceLabel,
    });
  }
  return facts;
}

/** The choice sections, in the order they are shown. Labels read as filters. */
export const SET_SECTIONS = [
  // Picked from the names the records carry, searched as typed (many values).
  { id: 'author', label: 'Author', search: true },
  { id: 'journal', label: 'Journal', search: true },
  { id: 'language', label: 'Language' },
  { id: 'source', label: 'Source' },
  { id: 'pdf', label: 'PDF', options: [['attached', 'Attached'], ['available', 'Available to fetch'], ['unresolved', 'Unresolved'], ['unchecked', 'Not checked']] },
  { id: 'abstract', label: 'Abstract', options: [['yes', 'Has abstract'], ['no', 'No abstract']] },
  { id: 'ta', label: 'Title/abstract', short: 'Title/abstract', options: DECISIONS },
  { id: 'ft', label: 'Full text', options: DECISIONS },
  { id: 'included', label: 'Included', options: [['yes', 'Included in review'], ['no', 'Not included'], ['none', 'Screening not started']] },
  { id: 'extraction', label: 'Extraction', options: [['yes', 'Has extracted values'], ['no', 'No extracted values']] },
  { id: 'collection', label: 'Collection' },
  { id: 'duplicates', label: 'Duplicates', options: [['candidate', 'Possible duplicate'], ['clear', 'No duplicate candidate'], ['merged', 'Has merged records']] },
  { id: 'notes', label: 'Notes', options: [['yes', 'Has notes'], ['no', 'No notes']] },
  { id: 'label', label: 'Labels' },
];

const authorTerms = text => String(text || '').split(/[,;]/).map(fold).filter(Boolean);

// The filter state read once per call, not once per record and section:
// splitting the author text for each of 20,000 records times 13 sections cost
// most of the Filters popover's time.
function compile(state) {
  const hasYear = state.yearFrom !== '' || state.yearTo !== '';
  return { hasYear, from: state.yearFrom === '' ? -Infinity : Number(state.yearFrom), to: state.yearTo === '' ? Infinity : Number(state.yearTo),
    terms: authorTerms(state.author), journal: fold(state.journal).split(/\s+/).filter(Boolean),
    picks: Object.entries(state.pick || {}).filter(([, chosen]) => chosen?.length) };
}

/** The sections whose filter a record fails, stopping at two (a record failing two counts nowhere). */
function failing(f, c) {
  const out = [];
  if (c.hasYear && (f.year == null || f.year < c.from || f.year > c.to)) out.push('year');
  if (c.terms.length && !c.terms.some(t => f.families.some(n => n.startsWith(t)) || f.authors.some(a => a.split(/[\s,.-]+/).some(w => w && w.startsWith(t))))) out.push('author');
  if (out.length > 1) return out;
  if (c.journal.length && !c.journal.every(w => f.journal.includes(w))) out.push('journal');
  for (const [id, chosen] of c.picks) {
    if (out.length > 1) break;
    const have = f.sets[id] || [];
    if (!chosen.some(x => have.includes(x)) && !out.includes(id)) out.push(id);   // author text and author picks are one section
  }
  return out;
}

/** Whether a record passes every active filter, optionally ignoring one section. */
function passes(f, c, skip) {
  if (skip !== 'year' && c.hasYear && (f.year == null || f.year < c.from || f.year > c.to)) return false;
  if (skip !== 'author' && c.terms.length && !c.terms.some(t => f.families.some(n => n.startsWith(t)) || f.authors.some(a => a.split(/[\s,.-]+/).some(w => w && w.startsWith(t))))) return false;
  if (skip !== 'journal' && c.journal.length && !c.journal.every(w => f.journal.includes(w))) return false;
  for (const [id, chosen] of c.picks) {
    if (id === skip) continue;
    const have = f.sets[id] || [];
    if (!chosen.some(x => have.includes(x))) return false;
  }
  return true;
}

/** How many filters are set: each range, text and choice section counts once. */
export function activeCount(state) {
  let n = 0;
  if (state.yearFrom !== '' || state.yearTo !== '') n++;
  if (authorTerms(state.author).length) n++;
  if (fold(state.journal)) n++;
  for (const chosen of Object.values(state.pick || {})) if (chosen?.length) n++;
  return n;
}

/** The records passing every filter; the same array when none is set. */
export function applyFilters(papers, state, facts) {
  if (!activeCount(state)) return papers;
  const c = compile(state);
  return papers.filter(p => { const f = facts.get(p.id); return f ? passes(f, c) : false; });
}

/**
 * The sections worth showing and their choices with counts. A section appears
 * only when the project's records differ on it (two or more choices in use),
 * or when it is already filtering. Counts are over `scope` with every other
 * filter applied, so a count says what choosing that option would show.
 */
// What the records hold, per section, and the names to show for it: read
// from the facts alone, so it is worked out once per set of facts, not again
// for every filter change or popover redraw.
const presentCache = new WeakMap();
function presentIn(all, facts) {
  const hit = presentCache.get(facts);
  if (hit && hit.all === all) return hit;
  const present = new Map(SET_SECTIONS.map(sec => [sec.id, new Set()])), labels = new Map();
  let anyYear = false;
  for (const p of all) {
    const f = facts.get(p.id); if (!f) continue;
    anyYear ||= f.year != null;
    for (const id in f.sets) { const set = present.get(id) || new Set(); for (const v of f.sets[id]) set.add(v); present.set(id, set); }
    labels.set(`source:${f.sets.source[0]}`, f.sourceLabel);
    // The fullest spelling seen names the person: "Akgun, Mehmet Yigit" over "Akgun, M.Y.".
    for (const [k, n] of f.authorLabels || []) { const had = labels.get(`author:${k}`); if (!had || n.length > had.length) labels.set(`author:${k}`, n); }
    if (f.journalLabel && !labels.has(`journal:${f.sets.journal[0]}`)) labels.set(`journal:${f.sets.journal[0]}`, f.journalLabel);
  }
  const out = { all, present, labels, anyYear };
  presentCache.set(facts, out);
  return out;
}

export function filterSections(all, scope, state, facts, s = {}) {
  const collNames = new Map((s.collections || []).map(c => [c.id, c.name]));
  const { present, labels, anyYear } = presentIn(all, facts);
  const out = [];
  const compiled = compile(state);
  // Each record's failing filters, worked out once: a record counts toward an
  // option when it passes every other section's filter.
  const near = [];
  for (const p of scope) { const f = facts.get(p.id); if (!f) continue; const fails = failing(f, compiled); if (fails.length < 2) near.push([f, fails[0] || null]); }
  const years = scope.map(p => facts.get(p.id)?.year).filter(y => y != null);
  // The panel keeps one shape for any library with records: every section is
  // shown, with the values the records hold and their counts ("Not recorded",
  // "Not screened" when a field is empty everywhere). Hiding sections whose
  // values did not vary made the panel change between projects.
  void anyYear;
  if (all.length || state.yearFrom !== '' || state.yearTo !== '')
    out.push({ id: 'year', label: 'Year', kind: 'range', min: years.length ? Math.min(...years) : null, max: years.length ? Math.max(...years) : null });
  // Typed author/journal text from earlier sessions still filters; new choices are picks.
  if (state.author) out.push({ id: 'author-text', label: 'Author text', kind: 'text', key: 'author' });
  if (state.journal) out.push({ id: 'journal-text', label: 'Journal text', kind: 'text', key: 'journal' });
  for (const sec of SET_SECTIONS) {
    const chosen = state.pick?.[sec.id] || [];
    const values = new Set([...(present.get(sec.id) || []), ...chosen]);
    let options;
    if (sec.options) options = sec.options.filter(([k]) => values.has(k));
    else if (sec.search) options = [...values].map(k => [k, k === 'none' ? 'Not recorded' : labels.get(`${sec.id}:${k}`) || k]);
    else if (sec.id === 'source') options = [...values].map(k => [k, labels.get(`source:${k}`) || k]).sort((a, b) => (a[0] === 'imported') - (b[0] === 'imported') || a[1].localeCompare(b[1]));
    else if (sec.id === 'language') options = [...values].map(k => [k, k === 'none' ? 'Not recorded' : languageName(k)]).sort((a, b) => (a[0] === 'none') - (b[0] === 'none') || a[1].localeCompare(b[1]));
    else if (sec.id === 'collection') options = [...(s.collections || []).filter(c => values.has(c.id)).map(c => [c.id, c.name]).sort((a, b) => a[1].localeCompare(b[1])), ...(values.has('none') ? [['none', 'In no collection']] : [])];
    else if (sec.id === 'label') options = [...(s.screeningLabels?.list || []).filter(l => values.has(l.id)).map(l => [l.id, l.name]).sort((a, b) => a[1].localeCompare(b[1])), ...(values.has('none') ? [['none', 'No label']] : [])];
    if (!all.length && !chosen.length) continue;
    const counts = new Map(options.map(([k]) => [k, 0]));
    for (const [f, fail] of near) {
      if (fail && fail !== sec.id) continue;
      for (const v of f.sets[sec.id] || []) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    }
    const opts = options.map(([id, label]) => ({ id, label: sec.id === 'collection' && id !== 'none' ? (collNames.get(id) || label) : label, count: counts.get(id) || 0 }));
    // Searchable lists read most used first.
    if (sec.search) opts.sort((a, b) => (a.id === 'none') - (b.id === 'none') || b.count - a.count || a.label.localeCompare(b.label));
    out.push({ id: sec.id, label: sec.label, kind: sec.search ? 'search' : 'set', options: opts });
  }
  return out;
}

/** The active filters as short phrases, each with the key that removes it. */
export function activeParts(state, sections = []) {
  const parts = [];
  const { yearFrom: a, yearTo: b } = state;
  if (a !== '' || b !== '') parts.push({ key: 'year', text: a !== '' && b !== '' ? (a === b ? `Year ${a}` : `Year ${a}–${b}`) : a !== '' ? `Year from ${a}` : `Year to ${b}` });
  const authors = authorTerms(state.author);
  if (authors.length) parts.push({ key: 'author-text', text: `Author ${String(state.author).split(/[,;]/).map(x => x.trim()).filter(Boolean).join(', ')}` });
  if (fold(state.journal)) parts.push({ key: 'journal-text', text: `Journal ${String(state.journal).trim()}` });
  for (const sec of SET_SECTIONS) {
    const chosen = state.pick?.[sec.id] || [];
    if (!chosen.length) continue;
    const opts = sections.find(x => x.id === sec.id)?.options || (sec.options || []).map(([id, label]) => ({ id, label }));
    const names = chosen.map(k => opts.find(o => o.id === k)?.label || k);
    parts.push({ key: sec.id, text: `${sec.label}: ${names.map((n, i) => i === 0 && !['source', 'language', 'collection', 'author', 'journal', 'label'].includes(sec.id) ? lowerFirst(n) : n).join(', ')}` });
  }
  return parts;
}
// "PDF: not checked", but proper names ("Source: PubMed") keep their case.
const lowerFirst = t => /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;

/** A copy of the state with one part (as named by activeParts) removed. */
export function withoutPart(state, key) {
  const next = { ...state, pick: { ...(state.pick || {}) } };
  if (key === 'year') { next.yearFrom = ''; next.yearTo = ''; }
  else if (key === 'author-text' || key === 'journal-text') next[key.slice(0, -5)] = '';
  else delete next.pick[key];
  return next;
}

/** A copy with one choice toggled. */
export function toggle(state, section, option, on) {
  const next = { ...state, pick: { ...(state.pick || {}) } };
  const set = new Set(next.pick[section] || []);
  if (on) set.add(option); else set.delete(option);
  if (set.size) next.pick[section] = [...set]; else delete next.pick[section];
  return next;
}

/** "Last n years": the earliest year of the range, counting this one. */
export const lastYears = (n, now = new Date()) => String(now.getFullYear() - n + 1);

/** A year as typed: four digits, or nothing. */
export const cleanYear = v => { const t = String(v ?? '').trim(); return /^\d{4}$/.test(t) ? t : ''; };

/** One line for the assistant: what the list is narrowed to. */
export const describeFilters = (state, sections) => activeParts(state, sections).map(p => p.text).join('; ');

/**
 * A section's state in a few words, for its collapsed row in the Filters
 * panel: "Any", the one choice, "2 selected: Spine, Eur Spine J", a year
 * range, or the typed text. `active` says whether it narrows the list.
 */
export function sectionSummary(sec, state) {
  if (sec.kind === 'range') {
    const a = state.yearFrom, b = state.yearTo;
    if (a === '' && b === '') return { text: 'Any', active: false };
    return { text: a !== '' && b !== '' ? (a === b ? a : `${a}–${b}`) : a !== '' ? `From ${a}` : `To ${b}`, active: true };
  }
  if (sec.kind === 'text') { const t = String(state[sec.key] || '').trim(); return { text: t || 'Any', active: !!t }; }
  const chosen = state.pick?.[sec.id] || [];
  if (!chosen.length) return { text: 'Any', active: false };
  const names = chosen.map(k => sec.options?.find(o => o.id === k)?.label || k);
  if (names.length === 1) return { text: names[0], active: true };
  return { text: `${names.length} selected: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ', …' : ''}`, active: true };
}

// Record quality checks: what is wrong or missing in a library record, and
// the mechanical part of it fixed with an undo (plan §3 C6, input quality).
//
// A record is the input to every later step — screening reads its abstract,
// the flow diagram counts its source, the manuscript cites its DOI — so a
// stray "https://doi.org/" prefix or an all-caps title is not cosmetic. This
// module reports each defect as an issue and, where the correction is
// mechanical and unambiguous, carries the corrected value with it. Nothing is
// changed until applyFixes is called with the issues a reader accepted; every
// change is logged with the value it replaced so undoQualityFixes can put it
// back. Fixes on one field of one record are computed in sequence, so a batch
// composes; a fix applied out of order is skipped and reappears on the next
// check rather than clobbering a newer value, and fixesFor gives a caller the
// chain one chosen issue needs.
//
// Journal spellings are treated separately: whether "Eur Spine J" is
// "European Spine Journal" is a judgement, so journalClusters proposes and
// applyJournalName applies only what was confirmed.
import { authorList } from './bib.mjs';
import { titleKey } from './search-library.mjs';
import { TAG, DOI, paperId, plainText } from './library-broken.mjs';
import { nonEnglishLanguage } from './languages.mjs';

const PREPRINT = /\b(?:medrxiv|biorxiv|research square|ssrn|arxiv|preprints\.org)\b/i;
export { plainText, brokenRecords } from './library-broken.mjs';
const MARKUP = new RegExp(`${TAG}|&(?:#\\d+|#x[0-9a-f]+|[a-z]+);`, 'i');
const ET_AL = /\bet\.?\s*al\b/i;
const ET_AL_MARK = /[,;\s]*\bet\.?\s*al\b\.?/i;
// An all-caps title cannot tell an acronym from a short word; a token of 2-5
// letters is kept as an acronym unless it is one of the words a title uses,
// in English or among the articles and prepositions of the other languages a
// library commonly holds (those that are not also a usual acronym: DES, LOS,
// IL and DAS stay as they are).
const WORDS = new Set('a an and as at be by do for from in into is it its no non not of on or over per than the to up via vs with within without after among before between during under versus one two three four five six seven eight nine ten new old use role case study trial risk pain cell cells adult child women men human model rate rates time high low early late acute long term phase stage year years aged older data dose drug drugs blood bone brain heart lung liver skin eye knee hip spine neck back head hand foot tumor cancer gene mouse mice rat rats care need type group level based using does can may when what how who which their this that these those we our de la le du et en un une chez sur pour avec dans der die den dem und von zu mit bei nach für über el las del con por para lo della delle dei degli nel nella da dos sobre'.split(' '));

// Bytes of UTF-8 text that were read as Windows-1252: the lead byte shows as
// Â..ô and the trail byte as a Latin-1 symbol or a cp1252 punctuation mark.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const TRAIL = `[\u0080-¿${CP1252.replace(/[\u0080-\u009F]/g, '')}]`;
const MOJIBAKE = new RegExp(`[Â-ô]${TRAIL}`);
const BYTE = new Map([...CP1252].map((c, i) => [c, 0x80 + i]));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** A DOI without the resolver prefix, "doi:" label or trailing punctuation a citation dragged along. */
export const cleanDoi = d => String(d ?? '').trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;:)\]]+$/, '').trim();

/** A PMID as digits alone; a spreadsheet's "12345.0" is 12345, not 123450. */
export const cleanPmid = p => String(p ?? '').trim().replace(/\.0+$/, '').replace(/\D/g, '');

/** UTF-8 text that was read as Windows-1252, read again; the input itself when the bytes are not clean UTF-8. */
export function fixMojibake(s) {
  const bytes = [];
  for (const c of String(s ?? '')) {
    const n = c.codePointAt(0);
    if (n < 0x100) bytes.push(n); else if (BYTE.has(c)) bytes.push(BYTE.get(c)); else return s;
  }
  try {
    const out = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return MOJIBAKE.test(out) ? s : out;
  } catch { return s; }
}

/** Sentence case for an all-caps title: acronyms (2-5 unaccented letters, not a common word) and tokens with digits keep their case. */
export function sentenceCase(title) {
  const out = String(title).split(/(\s+)/).map(tok => {
    const core = tok.replace(/[^\p{L}\p{N}]/gu, '');
    if (!core || /\p{N}/u.test(core) || (/^[A-Z]{2,5}$/.test(core) && !WORDS.has(core.toLowerCase()))) return tok;
    return tok.toLowerCase();
  }).join('');
  return out.replace(/\p{L}/u, c => c.toUpperCase());
}

/** "123-9" as "123-129" when the short end can only mean that; anything else unchanged. */
export function expandPages(pages) {
  const m = /^(\d+)(\s*[-–—]\s*)(\d+)$/.exec(String(pages ?? '').trim());
  if (!m || m[3].length >= m[1].length) return String(pages ?? '');
  const end = m[1].slice(0, m[1].length - m[3].length) + m[3];
  return Number(end) > Number(m[1]) ? `${m[1]}${m[2]}${end}` : String(pages ?? '');
}

/** Whitespace as a record should store it: single spaces, no edge or line-internal runs; an abstract keeps its paragraph breaks. */
const tidy = (s, { paragraphs = false } = {}) => paragraphs
  ? String(s).replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  : clean(s);

/**
 * Every issue found in the records, in record order. An issue is
 * { paperId, kind, severity, message, field, fix }, and fix, present when
 * the correction is mechanical, is { field, from, value } — `from` is the
 * value the fix was computed from, so applyFixes can tell a stale one.
 */
export function checkRecords(papers, { today = new Date() } = {}) {
  const issues = [];
  const maxYear = today.getFullYear() + 1;
  (papers || []).forEach((p, i) => {
    const id = paperId(p, i);
    // the working values: a later fix on the same field starts from the earlier one
    const cur = { title: String(p.title ?? ''), abstract: String(p.abstract ?? ''), journal: String(p.journal ?? ''), authors: authorList(p.authors), doi: String(p.doi ?? ''), pmid: String(p.pmid ?? ''), year: p.year, pages: String(p.pages ?? '') };
    const add = (kind, severity, message, field, value) => {
      const fix = value !== undefined && !same(value, cur[field]) ? { field, from: cur[field], value } : undefined;
      if (fix) cur[field] = value;
      issues.push({ paperId: id, kind, severity, message, field, ...(fix ? { fix } : {}) });
    };
    const textChecks = (field, { paragraphs = false } = {}) => {
      if (!cur[field]) return;
      const label = field[0].toUpperCase() + field.slice(1);
      if (MARKUP.test(cur[field])) add('title-markup', 'warn', `${label} contains HTML markup`, field, plainText(cur[field]));
      if (MOJIBAKE.test(cur[field])) add('mojibake', 'warn', `${label} has mis-decoded characters`, field, fixMojibake(cur[field]));
      if (tidy(cur[field], { paragraphs }) !== cur[field]) add('whitespace', 'note', `${label} has stray whitespace`, field, tidy(cur[field], { paragraphs }));
    };

    for (const n of p.integrity?.notices || []) add('retracted', 'error', `Integrity notice: ${String(n.type || 'notice').replace(/_/g, ' ')}`, 'doi');

    // emptiness is script-neutral: a Cyrillic or CJK title is a title
    const titleText = plainText(cur.title);
    if (!/[\p{L}\p{N}]/u.test(titleText) || titleKey(titleText) === 'untitled') add('missing-title', 'error', 'No title', 'title');
    else {
      textChecks('title');
      const letters = cur.title.replace(/[^\p{L}]/gu, '');
      if (letters.length >= 12 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) add('title-caps', 'warn', 'Title is all upper case', 'title', sentenceCase(cur.title));
      if (/(?<![.?!])\.$|\s$/.test(cur.title)) add('title-trailing', 'note', 'Title ends with a period or space', 'title', cur.title.trimEnd().replace(/(?<![.?!])\.$/, ''));
    }
    textChecks('abstract', { paragraphs: true });
    if (!cur.abstract) add('missing-abstract', 'note', 'No abstract', 'abstract');
    textChecks('journal');

    if (!cur.authors.length) add('missing-authors', 'warn', 'No authors', 'authors');
    else {
      const etal = cur.authors.filter(a => ET_AL.test(String(a)));
      // "Smith J, et al." keeps its name; an entry that is only the marker goes
      if (etal.length) add('author-et-al', 'warn', `Author list carries "${clean(etal[0])}"`, 'authors', cur.authors.map(a => ET_AL.test(String(a)) ? clean(String(a).replace(ET_AL_MARK, '')) : a).filter(Boolean));
      const seen = new Set(), dupes = [], kept = [];
      for (const a of cur.authors) {
        const k = clean(a).toLowerCase().replace(/[.\s,]+/g, ' ').trim();
        if (seen.has(k)) dupes.push(a); else { seen.add(k); kept.push(a); }
      }
      if (dupes.length) add('author-duplicate', 'warn', `"${clean(dupes[0])}" is listed twice`, 'authors', kept);
      const odd = cur.authors.find(a => !/\p{L}/u.test(String(a)) || !/[\s,]/.test(clean(a)));
      if (odd !== undefined) add('author-format', 'note', `"${clean(odd)}" is not a personal name with an initial`, 'authors');
      if (cur.authors.some(a => MOJIBAKE.test(String(a)))) add('mojibake', 'warn', 'An author name has mis-decoded characters', 'authors', cur.authors.map(a => MOJIBAKE.test(String(a)) ? fixMojibake(String(a)) : a));
    }

    const yearText = String(cur.year ?? '').trim();
    if (!yearText) add('missing-year', 'warn', 'No year', 'year');
    else {
      const y = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
      const found = Number(yearText.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1]);
      if (Number.isNaN(y)) add('year-implausible', 'warn', `"${yearText}" is not a year`, 'year', found >= 1800 && found <= maxYear ? String(found) : undefined);
      else if (y < 1800 || y > maxYear) add('year-implausible', 'warn', `Year ${y} is implausible`, 'year');
    }

    if (!cur.journal && !p.journalAbbr) add('missing-journal', 'warn', 'No journal', 'journal');
    const venue = `${cur.journal} ${p.source ?? ''}`;
    if (PREPRINT.test(venue)) add('preprint', 'note', `Preprint (${venue.match(PREPRINT)[0]})`, 'journal');

    if (!cur.doi) add('missing-doi', 'note', 'No DOI', 'doi');
    else if (!DOI.test(cur.doi)) add('doi-malformed', 'error', `DOI "${cur.doi}" is not a DOI`, 'doi', DOI.test(cleanDoi(cur.doi)) ? cleanDoi(cur.doi) : undefined);
    // a PMC id is a different identifier, so its digits are not the PMID
    if (cur.pmid && !/^\d+$/.test(cur.pmid)) add('pmid-malformed', 'error', `PMID "${cur.pmid}" is not a PMID`, 'pmid', /^pmc/i.test(cur.pmid) ? undefined : cleanPmid(cur.pmid) || undefined);

    if (expandPages(cur.pages) !== cur.pages) add('pages-short', 'note', `Pages "${cur.pages}" end short`, 'pages', expandPages(cur.pages));
    if (p.language && nonEnglishLanguage(p.language)) add('language', 'note', `Written in ${nonEnglishLanguage(p.language)}`, 'language');
  });
  return issues;
}

/** Counts over a list of issues: total, by severity, by kind, and how many carry a fix. */
export function qualitySummary(issues) {
  const out = { total: issues.length, bySeverity: { error: 0, warn: 0, note: 0 }, byKind: {}, fixable: 0 };
  for (const i of issues) {
    out.bySeverity[i.severity] = (out.bySeverity[i.severity] || 0) + 1;
    out.byKind[i.kind] = (out.byKind[i.kind] || 0) + 1;
    if (i.fix) out.fixable++;
  }
  return out;
}

/** Records by id, built once per call so a batch of fixes is linear in the library, not quadratic. */
const recordIndex = papers => new Map(papers.map((p, i) => [paperId(p, i), p]));

/**
 * The fixes to apply for one issue a reader chose: fixes on one field chain
 * (each starts from the previous one's value), so the requested issue is
 * returned with the fixable issues before it on the same record and field.
 * Applying the requested issue alone would be skipped as stale.
 */
export function fixesFor(issues, paperId, kind, field = null) {
  const chain = issues.filter(i => i.paperId === paperId && i.fix);
  // one kind can be raised on several fields of a record (whitespace in the title and the abstract), so the field decides
  const wanted = chain.find(i => i.kind === kind && (!field || i.field === field));
  if (!wanted) return [];
  const onField = chain.filter(i => i.field === wanted.field);
  return onField.slice(0, onField.indexOf(wanted) + 1);
}

/** Apply each issue's fix to its record, logging what was replaced under `at`; a fix whose field has moved on is skipped. */
export function applyFixes(state, issues, at = Date.now()) {
  const byId = recordIndex(state.papers || []);
  const added = [];
  for (const issue of issues) {
    const { fix } = issue;
    const p = fix && byId.get(issue.paperId);
    if (!p) continue;
    const current = fix.field === 'authors' ? authorList(p.authors) : p[fix.field];
    if (!same(current, fix.from) && !same(String(current ?? ''), fix.from)) continue;
    p[fix.field] = fix.value;
    added.push({ at, paperId: issue.paperId, field: fix.field, from: fix.from, to: fix.value, kind: issue.kind });
  }
  if (added.length) state.qualityLog = [...(state.qualityLog || []), ...added];
  return { applied: added.length };
}

/** Put back every value the fixes logged under `at` replaced, latest first, where the record still holds the fixed value. */
export function undoQualityFixes(state, at) {
  const log = state.qualityLog || [];
  const mine = log.filter(e => e.at === at);
  if (!mine.length) return state;
  const byId = recordIndex(state.papers || []);
  for (const e of [...mine].reverse()) {
    const p = byId.get(e.paperId);
    if (p && same(p[e.field], e.to)) p[e.field] = e.from;
  }
  state.qualityLog = log.filter(e => e.at !== at);
  return state;
}

// ---- journal spellings -----------------------------------------------------------
const STOP = new Set(['of', 'the', 'and', 'for', 'in']);
const fold = name => String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(t => t && t !== 'the');

/**
 * Whether one journal name's tokens (folded, stop words dropped) abbreviate
 * the other's: the same token count, and each token equal to or a prefix of
 * its counterpart. A prefix one letter short is a plural, not an
 * abbreviation: "Cell" and "Cells" are two journals. A number is never
 * abbreviated, so "1" is not "100".
 */
function abbreviates(x, y) {
  if (!x.length || x.length !== y.length) return false;
  return x.every((t, i) => t === y[i] || (!/\p{N}/u.test(t) && (t.startsWith(y[i]) || y[i].startsWith(t)) && Math.abs(t.length - y[i].length) >= 2));
}

/**
 * Groups of journal spellings that are probably one journal, each with its
 * longest spelling as canonical; only groups of two or more spellings. Each
 * spelling is tokenised once; identical foldings are joined through a map and
 * abbreviations are sought only among spellings with the same token count and
 * first letter, which is all the rule can match, so a library of thousands of
 * spellings does not cost a pairwise regex pass.
 */
export function journalClusters(papers) {
  const by = new Map();
  (papers || []).forEach((p, i) => {
    const name = clean(p.journal);
    if (!name) return;
    const v = by.get(name) || { name, count: 0, ids: new Set() };
    v.count++;
    v.ids.add(paperId(p, i));
    by.set(name, v);
  });
  const variants = [...by.values()];
  const toks = variants.map(v => { const folded = fold(v.name); return { key: folded.join(' '), abbr: folded.filter(t => !STOP.has(t)) }; });
  const root = variants.map((_, i) => i);
  const find = i => root[i] === i ? i : (root[i] = find(root[i]));
  const union = (i, j) => { root[find(j)] = find(i); };
  const firstByKey = new Map(), buckets = new Map();
  toks.forEach((t, i) => {
    if (firstByKey.has(t.key)) union(firstByKey.get(t.key), i); else firstByKey.set(t.key, i);
    if (!t.abbr.length) return;
    const b = `${t.abbr.length} ${t.abbr[0][0]}`;
    (buckets.get(b) || buckets.set(b, []).get(b)).push(i);
  });
  for (const ids of buckets.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    if (abbreviates(toks[ids[a]].abbr, toks[ids[b]].abbr)) union(ids[a], ids[b]);
  }
  const groups = new Map();
  variants.forEach((v, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(v));
  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  return [...groups.values()].filter(g => g.length > 1).map(g => ({
    canonical: [...g].sort((a, b) => b.name.length - a.name.length || byCount(a, b))[0].name,
    variants: g.sort(byCount).map(v => ({ name: v.name, count: v.count, paperIds: [...v.ids] })),
  })).sort((a, b) => b.variants.reduce((s, v) => s + v.count, 0) - a.variants.reduce((s, v) => s + v.count, 0) || a.canonical.localeCompare(b.canonical));
}

/** Puts back the journal spellings an applyJournalName call under `at` replaced, where the record still carries the canonical one. */
export function undoJournalName(state, at) {
  const entry = (state.journalMerges || []).find(m => m.at === at);
  if (!entry) return state;
  (state.papers || []).forEach((p, i) => {
    const c = entry.changes.find(x => x.paperId === paperId(p, i));
    if (c && p.journal === entry.canonical) p.journal = c.from;
  });
  state.journalMerges = state.journalMerges.filter(m => m !== entry);
  return state;
}

/** Rewrite the listed journal spellings (names, or journalClusters variants) to the canonical one, logging each change in state.journalMerges. */
export function applyJournalName(state, { variants = [], canonical }) {
  const wanted = new Set(variants.map(v => clean(v?.name ?? v)).filter(v => v && v !== canonical));
  if (!canonical || !wanted.size) return state;
  const changes = [];
  (state.papers || []).forEach((p, i) => {
    if (!wanted.has(clean(p.journal))) return;
    changes.push({ paperId: paperId(p, i), from: p.journal });
    p.journal = canonical;
  });
  if (!changes.length) return state;
  const last = (state.journalMerges || []).at(-1)?.at || 0;
  state.journalMerges = [...(state.journalMerges || []), { at: Math.max(Date.now(), last + 1), canonical, variants: [...wanted], changes }];
  return state;
}

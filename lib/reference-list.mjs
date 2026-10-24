// The citation check of a typed reference list (plan §4.11c).
//
// A manuscript written in Word cites "[12]", "³⁻⁵", "(Smith et al., 2020)" and
// ends with a list typed or pasted as paragraphs. Nothing in that text links a
// citation to a record, so this module reads both: it splits the list into
// entries and parses each (authors, year, title, journal, volume, pages, DOI,
// PMID), finds the citation markers in the text, and reconciles them with each
// other, with the library and with what the registries said when they were
// last asked (lib/ref-lookup.mjs verifyIdentifiers, an explicit action).
//
// Pure: no state, no network, no clock. Every rule reports something a reader
// can verify by hand; a match is accepted only when it is unambiguous, and a
// near miss is offered as a candidate, never taken. Tested with frozen
// fixtures in test/reference-list.test.mjs.
import { classifyStructure, isHeading } from './manuscript-structure.mjs';
import { titleKey } from './search-library.mjs';
import { familyName, authorList } from './bib.mjs';
import { hashText } from './manuscript.mjs';

/**
 * The thresholds, in one place. Title similarity is a Levenshtein ratio of
 * the normalised titles (1 = identical). A library match needs SAME, the same
 * first author and a year within YEAR_SLACK; a registry answer below DIFFERENT
 * is another work. CANDIDATE is the floor for a match offered as a proposal.
 */
export const MATCH = Object.freeze({ SAME: 0.9, CANDIDATE: 0.75, DIFFERENT: 0.6, YEAR_SLACK: 1, MIN_TITLE_KEY: 25 });

// ---- text helpers ---------------------------------------------------------------------------------
const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** A title as compared: no case, accents, markup, punctuation, or a registry's "RETRACTED:" prefix. */
export const normTitle = t => fold(t).replace(/<[^>]+>/g, ' ')
  .replace(/^\s*(?:retracted|withdrawn|retraction)(?:\s+article)?\s*[:.\-–]\s*/, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
/** A family name as compared: "van der Berg" and "Van Der Berg" and "vanderberg" are one. */
export const famKey = s => fold(s).replace(/[^a-z]/g, '');

/** Levenshtein ratio of two strings: 1 − distance / longer length. */
export function similarity(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
export const titleSimilarity = (a, b) => similarity(normTitle(a), normTitle(b));
const words = t => new Set(normTitle(t).split(' ').filter(w => w.length > 2));
const dice = (x, y) => { if (!x.size || !y.size) return 0; let n = 0; for (const w of x) if (y.has(w)) n++; return (2 * n) / (x.size + y.size); };

// ---- identifiers ----------------------------------------------------------------------------------
const DOI_AT = /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:?\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i;
/** A DOI as written, without the punctuation that ends its sentence; a closing bracket stays when it closes one inside. */
export function cleanDoi(d) {
  let s = String(d || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:]+$/, '');
    if (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
    if (s.endsWith(']') && (s.match(/\[/g) || []).length < (s.match(/\]/g) || []).length) s = s.slice(0, -1);
    if (s === before) break;
  }
  return s.toLowerCase();
}
const PMID_AT = /\bPMID\s*:?\s*(\d{1,9})\b/i;

// ---- entries --------------------------------------------------------------------------------------
// "12. ", "[12] ", "12) ", or "12 Smith" at the start of an entry.
const LEAD = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)](?=\s)|(\d{1,3})\s+(?=\p{Lu}))\s*/u;
const YEAR = '(?:1[89]\\d\\d|20\\d\\d)';
const VANCOUVER_AUTHORS = /^((?:[\p{Lu}][\p{L}'’\- ]*?\s[\p{Lu}]{1,4}(?:,\s*|\s*$|(?=\.)))+(?:,?\s*et al\.?)?)\.?\s+(?=\S)/u;

/** The authors of an entry as names, and the first one's family name. */
function namesOf(text, style) {
  const t = String(text || '').replace(/,?\s*et al\.?/i, '').trim().replace(/[.,]+$/, '');
  if (!t) return [];
  if (style === 'vancouver') return t.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  // "Higgins, J. P. T., & Thompson, S. G." and "Higgins, J.P.T. and Thompson, S.G."
  const joined = t.replace(/\s*(?:,\s*)?(?:&|\band\b)\s*/g, ', ');
  const parts = joined.split(/(?<=\.)\s*,\s*(?=\p{Lu})/u).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 || /,/.test(t) ? parts : [t];
}
const familyOf = name => {
  const s = String(name || '').trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[0].trim();
  const m = /^(.+?)\s+\p{Lu}{1,4}\.?$/u.exec(s);
  return m ? m[1].trim() : familyName(s);
};

/** The first sentence of `t` and what follows: a sentence ends at ". ", "? " or "! " that is not an initial. */
function sentence(t) {
  const re = /([.?!])\s+(?=\S)/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(0, m.index);
    // "J. P. T." and "vs." are not the end of a sentence
    if (m[1] === '.' && (/(?:^|[\s.])\p{Lu}$/u.test(before) || /\b(?:vs|al|e\.g|i\.e|eds?|vol|no|pp|St)$/i.test(before))) continue;
    return [t.slice(0, m[1] === '.' ? m.index : m.index + 1).trim(), t.slice(m.index + m[0].length).trim()];
  }
  return [t.replace(/[.\s]+$/, '').trim(), ''];
}

/** Volume, issue and pages from the part of an entry after its year or journal. */
function volumePages(t) {
  const m = /(?:^|[;,:\s])(\d{1,4})\s*(?:\(([^)]{1,12})\))?\s*[:,]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)/.exec(t)
    || /(?:^|[;,\s])(\d{1,4})\s*\(([^)]{1,12})\)/.exec(t);
  return m ? { volume: m[1], issue: m[2] || '', pages: (m[3] || '').replace(/\s+/g, '').replace(/[—]/g, '–') } : { volume: '', issue: '', pages: '' };
}

/**
 * One typed entry as fields: `{ n, authors, first, year, suffix, title, journal, volume, issue, pages, doi, pmid, form }`.
 * `n` is the number the entry carries ("12." or "[12]"), or null. `form` is how it reads: 'vancouver' (authors with bare
 * initials, then title, journal, year;volume), 'author-year' (APA or Harvard: authors, then the year in brackets) or ''.
 * A field the entry does not hold is empty, never guessed.
 */
export function parseEntry(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const lead = LEAD.exec(text);
  const n = lead ? Number(lead[1] || lead[2] || lead[3]) : null;
  const body = lead ? text.slice(lead[0].length) : text;
  const doiM = DOI_AT.exec(body);
  const doi = doiM ? cleanDoi(doiM[1]) : '';
  const pmid = PMID_AT.exec(body)?.[1] || '';
  // the bibliographic part: no identifiers, links, access dates or Epub notes
  const rest = body
    .replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:?\s*)?10\.\d{4,9}\/\S+/gi, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\b(?:PMID|PMCID)\s*:?\s*[A-Z]*\d+\.?/gi, ' ')
    .replace(/\[(?:Epub|cited|Internet|published online)[^\]]*\]\.?/gi, ' ')
    .replace(/\b(?:Epub (?:ahead of print|\d{4}[^.]*)|Available (?:from|at):?|Accessed [^.]*|Retrieved from)\.?/gi, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\s.,;]+$/, '');
  const out = { n, authors: [], first: '', year: '', suffix: '', title: '', journal: '', volume: '', issue: '', pages: '', doi, pmid, form: '', text };
  if (!rest) return out;

  // APA and Harvard: "Authors (2020a). Title. Journal, 12(3), 45–67." / "Authors (2020) 'Title', Journal, 12(3), pp. 45-67."
  const ay = new RegExp(`^(.{2,600}?)\\s*\\((${YEAR})([a-z])?(?:,[^)]*)?\\)[.,]?\\s*(.*)$`).exec(rest);
  if (ay && !/\d{4}/.test(ay[1])) {
    out.form = 'author-year';
    out.authors = namesOf(ay[1], 'apa');
    out.year = ay[2]; out.suffix = ay[3] || '';
    let after = ay[4];
    const quoted = /^['‘“"](.+?)['’”"][,.]?\s*(.*)$/.exec(after);
    let tail;
    if (quoted) { out.title = quoted[1].replace(/[.,]$/, ''); tail = quoted[2]; }
    else [out.title, tail] = sentence(after);
    const jm = /^(?:In:?\s*)?([^,(]+?)\s*(?:,|\(|\.\s|$)(.*)$/.exec(tail || '');
    if (jm) { out.journal = jm[1].replace(/^\*|\*$/g, '').trim(); Object.assign(out, volumePages(jm[2].replace(/\bpp?\.\s*/g, ''))); }
  } else {
    // Vancouver, AMA, NLM: "Authors. Title. Journal. 2020;12(3):45-67."
    const va = VANCOUVER_AUTHORS.exec(rest);
    let after;
    if (va) { out.form = 'vancouver'; out.authors = namesOf(va[1], 'vancouver'); after = rest.slice(va[0].length); }
    else { const [who, more] = sentence(rest); out.authors = who ? [who] : []; after = more; }
    const [title, tail] = sentence(after);
    out.title = title;
    const ym = new RegExp(`(?:^|[\\s.;,])(${YEAR})([a-z])?(?=\\s*(?:[A-Z][a-z]{2}(?:\\s+\\d{1,2})?\\s*)?(?:[;:.,]|$))`).exec(tail || '');
    if (ym) {
      out.year = ym[1]; out.suffix = ym[2] || '';
      out.journal = tail.slice(0, ym.index).replace(/[.\s,;]+$/, '').trim();
      Object.assign(out, volumePages(tail.slice(ym.index + ym[0].length)));
    } else {
      const [journal, more] = sentence(tail || '');
      out.journal = journal;
      const y = new RegExp(`\\b(${YEAR})\\b`).exec(more || '') || new RegExp(`\\b(${YEAR})\\b`).exec(rest);
      if (y) out.year = y[1];
    }
  }
  out.authors = out.authors.filter(a => !/^et al\.?$/i.test(a));
  out.first = familyOf(out.authors[0]);
  return out;
}

const SKIP_ROLES = new Set(['references', 'title', 'authors', 'affiliations', 'keywords']);
const textOf = b => b.text ?? (b.runs || []).map(r => r.t || '').join('');

/**
 * Lines of a pasted list that Word kept in one paragraph: "1. A … 2. B … 3. C" splits where the numbers run on
 * from the first, at least three of them; a paragraph with line breaks splits at the breaks.
 */
function splitLines(text) {
  const lines = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const t = lines[0] || '';
  const marks = [];
  const re = /(?:^|\s)(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(?=\p{Lu})/gu;
  let m, want = null;
  while ((m = re.exec(t))) {
    const k = Number(m[1] || m[2]);
    if (want == null ? true : k === want) { marks.push(m.index + (m[0].match(/^\s/) ? 1 : 0)); want = k + 1; }
  }
  if (marks.length < 3 || marks[0] !== 0) return lines;
  return marks.map((at, i) => t.slice(at, marks[i + 1] ?? t.length).trim());
}

/**
 * The typed reference list of a document: `{ entries, typed, numbered, blockIds }`. Entries come from the blocks the
 * structure reads as references (headings left out), one per paragraph or line, and from a reference manager's
 * bibliography with its lines kept. A list Lykos generates from its own citations ([@key]) is not typed and is not read.
 * Each entry is parseEntry's fields plus `{ index, key, blockId, line, whole, implicit }`: `whole` says the entry is its
 * block's whole text (so a proposal may replace or remove it), `implicit` that its number is its place in a list Word numbers.
 */
export function referenceList(blocks, { roles = null } = {}) {
  roles ||= blocks.map(b => b.role || null);
  if (!roles.some(r => r === 'references')) roles = classifyStructure(blocks);
  const entries = [];
  blocks.forEach((b, i) => {
    if (roles[i] !== 'references' || b.type === 'table' || b.type === 'figure' || b.type === 'toc') return;
    if (b.type === 'bib') { (b.lines || []).forEach((line, k) => entries.push({ ...parseEntry(line), blockId: b.id, line: k, whole: false, bib: true })); return; }
    const t = textOf(b);
    if (!t.trim() || isHeading(b) || /\[@[^\]]+\]/.test(t)) return;
    const lines = splitLines(t);
    lines.forEach((line, k) => entries.push({ ...parseEntry(line), blockId: b.id, line: k, whole: lines.length === 1, list: !!(b.list || b.props?.list) }));
  });
  // A list Word numbers itself shows no number in the text: the place in the list is the number.
  const shown = entries.filter(e => e.n != null).length;
  const listed = entries.filter(e => e.list).length;
  const implicit = !shown && listed * 2 >= entries.length && entries.length > 0;
  entries.forEach((e, i) => {
    e.index = i;
    if (implicit) { e.n = i + 1; e.implicit = true; }
    e.key = entryKey(e);
    delete e.list;
  });
  const numbered = entries.length > 0 && entries.filter(e => e.n != null).length * 2 >= entries.length;
  return { entries, typed: entries.length > 0, numbered, blockIds: [...new Set(entries.map(e => e.blockId))] };
}

/** An entry's key for links and the registry cache: its DOI, else its PMID, else a hash of its title (or text). */
export function entryKey(e) {
  if (e.doi) return `doi:${e.doi}`;
  if (e.pmid) return `pmid:${e.pmid}`;
  return `h:${hashText(normTitle(e.title) || normTitle(e.text))}`;
}

// ---- citation markers -----------------------------------------------------------------------------
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const fromSup = s => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => String(SUP.indexOf(c))).replace(/[⁻]/g, '-').replace(/[˒‚]/g, ',');
// A superscript after a number or a short word is an exponent ("m²", "10³", "I²", "tau²", "χ²"), not a citation:
// a citation follows a word of four letters or more, a bracket or punctuation.
const UNIT_BEFORE = /(?:\d|(?:^|[^\p{L}])\p{L}{1,3}|[×/^])\s?$/u;

/** "3–5, 8" as [3, 4, 5, 8]; null when a part is not a number or a range runs backwards or is longer than 50. */
export function expandNumbers(s) {
  const out = [];
  for (const part of String(s).split(/\s*[,;]\s*/)) {
    if (!part) continue;
    const r = /^(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?$/.exec(part.trim());
    if (!r) return null;
    const a = Number(r[1]), b = r[2] ? Number(r[2]) : a;
    if (b < a || b - a > 50 || a === 0) return null;
    for (let k = a; k <= b; k++) out.push(k);
  }
  return out.length ? out : null;
}

/** Superscript runs of a block, with their place in its text (the text is its runs joined, citations as [@key]). */
function superscripts(b) {
  const out = [];
  if (!Array.isArray(b.runs) || !b.runs.length) return out;
  let at = 0, open = null, joint = '';
  for (const r of b.runs) {
    const t = r.cite ? r.cite.map(k => `[@${k}]`).join('') : r.del ? '' : (r.t || '');
    if (r.sup && !r.cite && t) {
      // "2" "-" "4" with the dash left on the line is still one citation, 2–4
      if (open && open.end + joint.length === at) { open.raw += joint + t; open.end = at + t.length; }
      else { open = { start: at, end: at + t.length, raw: t }; out.push(open); }
      joint = '';
    } else if (t) {
      if (open && !joint && open.end === at && /^[,\-–—]$/.test(t)) joint = t;
      else { open = null; joint = ''; }
    }
    at += t.length;
  }
  return out;
}

/**
 * Every citation marker in the document's text, in order: `{ kind, blockId, start, end, raw, numbers }` for a numbered
 * marker ('bracket' "[3–5]", 'sup' a superscript run or "³⁻⁵", 'paren' "(3, 4)") and `{ kind: 'author', blockId, start,
 * end, raw, cites: [{ family, family2, etAl, year, suffix }] }` for author–year. Parenthesised numbers count only in a
 * numbered document that has no bracket or superscript markers, and only when every number fits the list.
 */
export function citationMarkers(blocks, { roles = null, numbered = true, size = 0 } = {}) {
  roles ||= blocks.map(b => b.role || null);
  if (!roles.some(Boolean)) roles = classifyStructure(blocks);
  const out = [], parens = [];
  blocks.forEach((b, i) => {
    if (SKIP_ROLES.has(roles[i]) || ['table', 'figure', 'toc', 'bib'].includes(b.type) || isHeading(b) && !/\S{40}/.test(textOf(b))) return;
    const t = textOf(b);
    if (!t) return;
    const ms = [];
    for (const m of t.matchAll(/\[(\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*[,;]\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*\s*)\]/g)) {
      const numbers = expandNumbers(m[1]);
      if (numbers) ms.push({ kind: 'bracket', blockId: b.id, start: m.index, end: m.index + m[0].length, raw: m[0], numbers });
    }
    for (const s of superscripts(b)) {
      const raw = s.raw.trim();
      if (!/^\d/.test(raw) || !/^[\d\s,;–—-]+$/.test(raw) || UNIT_BEFORE.test(t.slice(0, s.start))) continue;
      const numbers = expandNumbers(raw);
      if (numbers) ms.push({ kind: 'sup', blockId: b.id, start: s.start, end: s.end, raw, numbers });
    }
    for (const m of t.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+(?:[,˒‚⁻–-][⁰¹²³⁴⁵⁶⁷⁸⁹]+)*/g)) {
      if (UNIT_BEFORE.test(t.slice(0, m.index))) continue;
      const numbers = expandNumbers(fromSup(m[0]));
      if (numbers) ms.push({ kind: 'sup', blockId: b.id, start: m.index, end: m.index + m[0].length, raw: m[0], numbers });
    }
    if (numbered) for (const m of t.matchAll(/\((\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*)\)/g)) {
      const numbers = expandNumbers(m[1]);
      if (numbers) parens.push({ kind: 'paren', blockId: b.id, start: m.index, end: m.index + m[0].length, raw: m[0], numbers, order: i });
    }
    if (!numbered) ms.push(...authorYear(t, b.id));
    ms.sort((x, y) => x.start - y.start).forEach(m => out.push({ ...m, order: i }));
  });
  if (numbered && !out.some(m => m.kind !== 'author') && parens.length >= 3 && (!size || parens.every(p => Math.max(...p.numbers) <= size)))
    out.push(...parens);
  return out.sort((a, b) => a.order - b.order || a.start - b.start).map(({ order, ...m }) => m);
}

const NAME = "\\p{Lu}[\\p{L}'’\\-]+(?:\\s(?:van|von|de|der|den|da|di|du|del|la|le)\\s\\p{Lu}?[\\p{L}'’\\-]+)?";
/** "Smith et al.", "Smith and Lee", "Smith & Lee", "Smith" before a year. */
function whoOf(s) {
  const m = new RegExp(`^(?:(?:e\\.g\\.|i\\.e\\.|see(?: also)?|cf\\.|for example|reviewed in)[,:]?\\s+)?(${NAME})(?:\\s+(et al\\.?)|\\s+(?:and|&)\\s+(${NAME}))?,?$`, 'u').exec(s.trim());
  return m ? { family: m[1], family2: m[3] || '', etAl: !!m[2] } : null;
}
function authorYear(t, blockId) {
  const out = [];
  // parenthetical: (Smith et al., 2020; Lee and Kim 2019a, 2021)
  for (const m of t.matchAll(new RegExp(`\\(([^()]*?${YEAR}[a-z]?[^()]*)\\)`, 'g'))) {
    const cites = [];
    for (const part of m[1].split(/\s*;\s*/)) {
      const y = new RegExp(`^(.*?)[,\\s]\\s*((?:${YEAR}[a-z]?)(?:\\s*,\\s*${YEAR}[a-z]?)*)(?:\\s*,\\s*(?:p|pp)\\.?\\s*[\\d–-]+)?$`).exec(part.trim());
      if (!y) continue;
      const who = whoOf(y[1]);
      if (!who) continue;
      for (const yr of y[2].split(/\s*,\s*/)) cites.push({ ...who, year: yr.slice(0, 4), suffix: yr.slice(4) });
    }
    if (cites.length) out.push({ kind: 'author', blockId, start: m.index, end: m.index + m[0].length, raw: m[0], cites });
  }
  // narrative: Smith et al. (2020), Smith and Lee (2019a)
  for (const m of t.matchAll(new RegExp(`(${NAME})(?:\\s+(et al\\.?)|\\s+(?:and|&)\\s+(${NAME}))?\\s+\\((${YEAR}[a-z]?(?:\\s*[;,]\\s*${YEAR}[a-z]?)*)\\)`, 'gu'))) {
    if (out.some(o => m.index >= o.start && m.index < o.end)) continue;
    const years = m[4].split(/\s*[;,]\s*/);
    out.push({ kind: 'author', blockId, start: m.index, end: m.index + m[0].length, raw: m[0],
      cites: years.map(y => ({ family: m[1], family2: m[3] || '', etAl: !!m[2], year: y.slice(0, 4), suffix: y.slice(4) })) });
  }
  return out;
}

// ---- the library ----------------------------------------------------------------------------------
const yearOf = v => { const m = /(1[89]\d\d|20\d\d)/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };
const near = (a, b) => a == null || b == null || Math.abs(a - b) <= MATCH.YEAR_SLACK;

/** The library prepared once for many entries: identifier maps and each record's compared fields. */
export function prepareLibrary(library = []) {
  const byDoi = new Map(), byPmid = new Map(), byKey = new Map(), byId = new Map();
  const items = [];
  for (const p of library) {
    if (!p) continue;
    const doi = cleanDoi(p.doi), pmid = String(p.pmid || '').replace(/\D/g, '');
    if (doi && !byDoi.has(doi)) byDoi.set(doi, p);
    if (pmid && !byPmid.has(pmid)) byPmid.set(pmid, p);
    const tk = titleKey(p.title);
    if (tk.length >= MATCH.MIN_TITLE_KEY && !byKey.has(tk)) byKey.set(tk, p);
    byId.set(p.id || p.key, p);
    items.push({ p, title: normTitle(p.title), words: words(p.title), first: famKey(familyName(authorList(p.authors)[0] || '')), year: yearOf(p.year) });
  }
  return { byDoi, byPmid, byKey, byId, items };
}

/**
 * The library record an entry is, `{ paper, how }` (how: 'link', 'doi', 'pmid', 'title' for the same title key,
 * 'fuzzy'), or `{ candidate, score }` for a near miss a person should confirm, or null. A fuzzy match needs a title
 * similarity of at least MATCH.SAME, the same first author where both name one, and a year within MATCH.YEAR_SLACK; a
 * second record as good makes it ambiguous, so neither is taken.
 */
export function matchEntry(e, lib, links = {}) {
  const linked = links[e.key] && lib.byId.get(links[e.key]);
  if (linked) return { paper: linked, how: 'link' };
  if (e.doi && lib.byDoi.has(e.doi)) return { paper: lib.byDoi.get(e.doi), how: 'doi' };
  if (e.pmid && lib.byPmid.has(e.pmid)) return { paper: lib.byPmid.get(e.pmid), how: 'pmid' };
  const tk = titleKey(e.title);
  const year = yearOf(e.year), first = famKey(e.first);
  if (tk.length >= MATCH.MIN_TITLE_KEY && lib.byKey.has(tk)) {
    const p = lib.byKey.get(tk);
    if (near(year, yearOf(p.year))) return { paper: p, how: 'title' };
  }
  const t = normTitle(e.title), w = words(e.title);
  if (t.length >= 12) {
    const scored = [];
    for (const it of lib.items) {
      if (!it.title || dice(w, it.words) < 0.5) continue;
      const score = similarity(t, it.title);
      if (score >= MATCH.CANDIDATE) scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const ok = x => x.score >= MATCH.SAME && near(year, x.it.year) && (!first || !x.it.first || first === x.it.first);
    const good = scored.filter(ok);
    if (good.length === 1 || good.length > 1 && good[0].score - good[1].score > 0.05) return { paper: good[0].it.p, how: 'fuzzy', score: good[0].score };
    if (scored.length && !good.length) return { candidate: scored[0].it.p, score: scored[0].score };
    if (good.length > 1) return { candidate: good[0].it.p, score: good[0].score, ambiguous: true };
  } else if (first && year) {
    // no title to compare: the same first author and year is a candidate when it is the only one
    const same = lib.items.filter(it => it.first === first && it.year === year);
    if (same.length === 1) return { candidate: same[0].p, score: 0 };
  }
  return null;
}

// ---- the registry ---------------------------------------------------------------------------------
/**
 * What a registry's answer says about an entry: `[{ kind, severity, field, entry, registry }]`. The title decides
 * whether the identifier points at this work at all: below MATCH.DIFFERENT it is another work ('ref-wrong-id'); at
 * MATCH.SAME or above with another first author it is the chimeric reference ('ref-chimeric'); a year more than
 * MATCH.YEAR_SLACK away, a different volume or first page, or a title between the two thresholds are reported apart.
 */
export function compareWork(e, work) {
  if (!work) return [];
  const out = [];
  const sim = e.title && work.title ? titleSimilarity(e.title, work.title) : null;
  if (sim != null && sim < MATCH.DIFFERENT) return [{ kind: 'ref-wrong-id', severity: 'error', field: 'title', entry: e.title, registry: work.title, score: sim }];
  const ef = famKey(e.first), wf = famKey((work.families || [])[0] || '');
  if (ef && wf && ef !== wf && !(work.families || []).slice(0, 1).some(f => famKey(f).includes(ef) || ef.includes(famKey(f))))
    out.push({ kind: sim != null && sim >= MATCH.SAME ? 'ref-chimeric' : 'ref-author', severity: sim != null && sim >= MATCH.SAME ? 'error' : 'warn', field: 'first author', entry: e.first, registry: work.families[0] });
  if (sim != null && sim < MATCH.SAME) out.push({ kind: 'ref-title', severity: 'note', field: 'title', entry: e.title, registry: work.title, score: sim });
  const ey = yearOf(e.year), wy = yearOf(work.year);
  if (ey && wy && Math.abs(ey - wy) > MATCH.YEAR_SLACK) out.push({ kind: 'ref-year', severity: 'warn', field: 'year', entry: String(ey), registry: String(wy) });
  if (e.volume && work.volume && String(e.volume) !== String(work.volume)) out.push({ kind: 'ref-details', severity: 'note', field: 'volume', entry: e.volume, registry: work.volume });
  const page = p => String(p || '').split(/[-–]/)[0].replace(/^[A-Za-z]+/, '');
  if (e.pages && work.pages && page(e.pages) && page(work.pages) && page(e.pages) !== page(work.pages)) out.push({ kind: 'ref-details', severity: 'note', field: 'pages', entry: e.pages, registry: work.pages });
  return out;
}

/** The registry key an entry is looked up by: its DOI, else its PMID, else its title (a bibliographic query). */
export const registryKey = e => (e.doi ? `doi:${e.doi}` : e.pmid ? `pmid:${e.pmid}` : e.title && normTitle(e.title).length >= 12 ? `q:${hashText(normTitle(e.title))}` : '');

// ---- reconciliation -------------------------------------------------------------------------------
const QUESTIONED = /retract|concern|withdraw|remov/i;
const CORRECTED = /correct|errat|corrig/i;
const clipTitle = t => { const s = String(t || '').trim(); return s.length > 60 ? `${s.slice(0, 59).replace(/\s+\S*$/, '')}…` : s; };
/** How an entry is named in a message: "Reference 12", else "Smith 2020", else the start of its title. */
export const entryName = e => (e.n != null ? `Reference ${e.n}` : e.first ? `${e.first} ${e.year}${e.suffix}`.trim() : `“${clipTitle(e.title || e.text)}”`);

/**
 * The citation check: `{ list, markers, matches, issues, candidates }`. `issues` are checkManuscript issues
 * (severity, kind, message, blockId, at, ref): numbering and order, cited but not listed, listed but never cited,
 * duplicates, entries the library does not hold, a DOI that differs from the library record's, retraction and
 * correction notices (the library's, or the registry's), and the registry's disagreements. `citationCheck` is the
 * manuscript's saved part: `links` (entry key → record id) and `registry` (registry key → answer, see
 * lib/ref-lookup.mjs verifyIdentifiers). Nothing is reported for a document without a typed list.
 */
export function checkCitations(blocks, { library = [], citationCheck = {}, roles = null } = {}) {
  roles ||= blocks.map(b => b.role || null);
  if (!roles.some(r => r === 'references')) roles = classifyStructure(blocks);
  const list = referenceList(blocks, { roles });
  const empty = { list, markers: [], matches: [], issues: [], candidates: [] };
  if (!list.typed) return empty;
  const { entries, numbered } = list;
  const markers = citationMarkers(blocks, { roles, numbered, size: entries.length });
  const issues = [];
  const add = (severity, kind, message, where = {}) => issues.push({ severity, kind, message, ...where });
  const atEntry = e => ({ blockId: e.blockId, at: 0, ref: e.key });
  const atMarker = m => ({ blockId: m.blockId, at: m.start, text: m.raw });
  const cited = new Set();

  if (numbered) {
    // the list's own numbering: each number once, none missing
    const byN = new Map();
    for (const e of entries) if (e.n != null) { if (byN.has(e.n)) add('warn', 'ref-numbering', `Two entries are numbered ${e.n}`, atEntry(e)); else byN.set(e.n, e); }
    const max = Math.max(0, ...byN.keys());
    const gaps = [];
    for (let k = 1; k <= max; k++) if (!byN.has(k)) gaps.push(k);
    // the gap is reported where it is: on the entry that follows the first missing number
    const after = gaps.length ? [...byN.keys()].filter(k => k > gaps[0]).sort((a, b) => a - b)[0] : null;
    if (gaps.length && !entries[0].implicit) add('warn', 'ref-numbering', gaps.length === 1 ? `The list has no entry ${gaps[0]}` : `The list has no entries ${compact(gaps)}`, atEntry(byN.get(after) || entries[0]));
    // each cited number has an entry; numbers are first cited in order
    const missing = new Map();
    let seen = 0;
    const order = [];
    for (const m of markers) {
      for (const k of m.numbers) {
        if (!byN.has(k) && !missing.has(k)) missing.set(k, m);
        cited.add(k);
      }
      const fresh = [...new Set(m.numbers)].filter(k => k > seen).sort((a, b) => a - b);
      for (const k of fresh) { if (k > seen + 1) order.push({ k, expected: seen + 1, m }); seen = Math.max(seen, k); }
    }
    for (const [k, m] of missing) add('error', 'ref-missing', `${k} is cited but the list has no entry ${k}`, atMarker(m));
    // a list numbered alphabetically breaks the order everywhere: say so once
    if (order.length > Math.max(3, entries.length * 0.3)) add('note', 'ref-order', 'Numbers do not follow the order of first citation', atMarker(order[0].m));
    else for (const o of order) add('warn', 'ref-order', `${o.k} is cited before ${o.expected}`, atMarker(o.m));
    for (const e of entries) if (e.n != null && !cited.has(e.n) && byN.get(e.n) === e) add('warn', 'ref-uncited', `${entryName(e)} is never cited`, atEntry(e));
  } else {
    const keyOf = (fam, year, suffix) => `${famKey(fam)}|${year}${suffix || ''}`;
    const byKey = new Map();
    for (const e of entries) {
      if (!e.first || !e.year) continue;
      const k = keyOf(e.first, e.year, e.suffix);
      if (byKey.has(k)) add('warn', 'ref-ambiguous', `Two entries are ${e.first} ${e.year}${e.suffix}: add a and b`, atEntry(e));
      else byKey.set(k, e);
    }
    const hit = new Set(), missing = new Map();
    for (const m of markers) for (const c of m.cites) {
      const e = byKey.get(keyOf(c.family, c.year, c.suffix)) || (!c.suffix && entries.find(x => famKey(x.first) === famKey(c.family) && x.year === c.year));
      if (e) { hit.add(e); continue; }
      const name = `${c.family}${c.etAl ? ' et al.' : c.family2 ? ` and ${c.family2}` : ''} ${c.year}${c.suffix}`;
      if (!missing.has(name)) missing.set(name, m);
    }
    for (const [name, m] of missing) add('error', 'ref-missing', `${name} is cited but not in the list`, atMarker(m));
    for (const e of entries) if (!hit.has(e) && (markers.length || entries.length)) add('warn', 'ref-uncited', `${entryName(e)} is never cited`, atEntry(e));
  }

  // two entries for one work: one DOI or PMID, or one long title
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i], b = entries[j];
    const tk = titleKey(a.title);
    if ((a.doi && a.doi === b.doi) || (a.pmid && a.pmid === b.pmid) || (tk.length >= MATCH.MIN_TITLE_KEY && tk === titleKey(b.title)))
      add('warn', 'ref-duplicate', `${entryName(b)} repeats ${entryName(a).replace(/^Reference/, 'reference')}`, { ...atEntry(b), dup: a.key });
  }

  // the library, and what the registry said
  const lib = prepareLibrary(library);
  const links = citationCheck.links || {}, registry = citationCheck.registry || {};
  const matches = [], candidates = [];
  const byPaper = new Map();
  for (const e of entries) {
    const m = matchEntry(e, lib, links);
    const said = new Set();   // one issue per kind of notice, whichever source said it
    matches.push(m && m.paper ? { entry: e, paper: m.paper, how: m.how } : { entry: e, paper: null, how: '' });
    if (!m?.paper) {
      if (m?.candidate) candidates.push({ entry: e, paper: m.candidate, score: m.score });
      add('note', 'ref-unmatched', `${entryName(e)} is not in the library`, atEntry(e));
    } else {
      const p = m.paper, id = p.id || p.key;
      if (byPaper.has(id) && !entries.some(x => x !== e && x.key === e.key) && !issues.some(i => i.kind === 'ref-duplicate' && i.ref === e.key))
        add('warn', 'ref-duplicate', `${entryName(e)} and ${entryName(byPaper.get(id)).replace(/^Reference/, 'reference')} are one library record`, { ...atEntry(e), dup: byPaper.get(id).key });
      else byPaper.set(id, e);
      const pd = cleanDoi(p.doi);
      if (e.doi && pd && pd !== e.doi && m.how !== 'doi') add('warn', 'ref-doi', `${entryName(e)} has DOI ${e.doi}; the library record has ${pd}`, atEntry(e));
      for (const notice of p.integrity?.notices || []) noticeIssue(add, e, notice, atEntry(e), said);
    }
    const rk = registryKey(e), r = rk && registry[rk];
    if (!r) continue;
    const where = rk.startsWith('doi:') ? 'Crossref' : rk.startsWith('pmid:') ? 'PubMed' : 'Crossref';
    if (r.status === 'missing' && !rk.startsWith('q:')) add('error', 'ref-unresolved', `${entryName(e)}: ${rk.startsWith('doi:') ? `DOI ${e.doi}` : `PMID ${e.pmid}`} is not found in ${where}`, atEntry(e));
    if (r.status !== 'found' || !r.work) continue;
    for (const d of compareWork(e, r.work)) {
      const msg = d.kind === 'ref-wrong-id' ? `${entryName(e)}: the ${rk.startsWith('pmid:') ? 'PMID' : 'DOI'} is another work (${clipTitle(r.work.title)})`
        : d.kind === 'ref-chimeric' ? `${entryName(e)}: title matches ${where}, first author does not (${d.registry})`
        : d.kind === 'ref-author' ? `${entryName(e)}: first author ${d.entry}; ${where} has ${d.registry}`
        : d.kind === 'ref-title' ? `${entryName(e)}: title differs from ${where}'s`
        : `${entryName(e)}: ${d.field} ${d.entry}; ${where} has ${d.registry}`;
      add(d.severity, d.kind, msg, { ...atEntry(e), registry: rk });
    }
    for (const notice of r.work.notices || []) noticeIssue(add, e, notice, atEntry(e), said);
  }
  return { list, markers, matches, issues, candidates };
}

function noticeIssue(add, e, n, where, said) {
  const type = String(n.type || '').replace(/[_-]/g, ' ').toLowerCase();
  if (said.has(type)) return;
  said.add(type);
  if (QUESTIONED.test(type)) add('error', 'ref-retracted', `${entryName(e)} has ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} notice`, where);
  else if (CORRECTED.test(type)) add('note', 'ref-corrected', `${entryName(e)} has a ${type} notice`, where);
}

/** [3, 4, 5, 8] as "3–5 and 8". */
function compact(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}

/** A compact summary for the assistant and the rail's status: counts, not text. */
export function citationSummary(r) {
  const by = k => r.issues.filter(i => i.kind === k).length;
  return {
    entries: r.list.entries.length, style: r.list.typed ? (r.list.numbered ? 'numbered' : 'author-year') : 'none', markers: r.markers.length,
    in_library: r.matches.filter(m => m.paper).length, not_in_library: by('ref-unmatched'), cited_not_listed: by('ref-missing'), never_cited: by('ref-uncited'),
    order: by('ref-order'), numbering: by('ref-numbering'), duplicates: by('ref-duplicate'), doi_differs: by('ref-doi'),
    retracted: by('ref-retracted'), corrected: by('ref-corrected'), unresolved: by('ref-unresolved'), wrong_identifier: by('ref-wrong-id'),
    chimeric: by('ref-chimeric'), year: by('ref-year'), candidates: r.candidates.length,
  };
}

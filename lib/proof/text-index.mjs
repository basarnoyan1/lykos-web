// The index of one paper's full text that every proof reads: pages, lines, sections (zones), sentences, table regions, every number with
// its exact form (sign, decimals, decimal comma, number words) and every mention of a known measure. Zones say whose words a passage is:
// the study's own (abstract, methods, results, tables, conclusion), its discussion and introduction (where other studies are cited), or
// not the study at all (references, editorial or reviewer comments, an article bound into the same PDF, journal back matter). Text
// extracted from two-column pages can have sections out of order, so a reference entry is recognised line by line wherever it stands.
import { MEASURES, ZONES, DOI, NEGATION, HEDGE, ATTRIBUTION, OWN, DEFINITION, STAT, TIME, DENOMINATOR_UNITS } from './lexicon.mjs';
import { hash } from './hash.mjs';

export const INDEX_VERSION = 'idx-2026-11-01.1';

export const OWN_ZONES = new Set(['abstract', 'methods', 'results', 'conclusion', 'table']);
export const NOT_STUDY = new Set(['references', 'commentary', 'other-article', 'backmatter', 'header']);
// whose words a recorded quote may be: a reviewer's quote from the paper's own back matter (funding, registration, disclosures) or its running
// head (journal, year, pages) is the paper's own statement; only references, editorial or reviewer comments and another article are someone
// else's (31 Oct 2026: 1,100 settled quotes of the sham review were errors because their passage was a funding statement or a running head)
export const NOT_OWN_WORDS = new Set(['references', 'commentary', 'other-article']);

const WORDS = { zero: 0, no: null, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, double: 2, triple: 3, none: 0 };
const UNITS_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const REF_LINE = /\b(?:19|20)\d\d\)\s*\d+\s*[-–]\s*\d+\s*,|^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+[A-Z][A-Za-z'’ -]+,?\s+[A-Z]{1,3}\b|\b(?:19|20)\d\d\s*;\s*\d+\s*(?:\(\s*\d+\s*\))?\s*:\s*[A-Za-z]?\d+|\bet al\.?,?\s.*\b(?:19|20)\d\d\b.*\b\d+\s*[-–]\s*\d+\b|\b(?:J|Spine|Eur|Neurosurg|Clin|Orthop|Surg)\b\.?.*\b(?:19|20)\d\d\s*;/;
const TABLE_CAPTION = /^\s*(Table|TABLE)\s+([0-9IVX]+[a-z]?)\b/;
const FIG_CAPTION = /^\s*(Fig(?:ure)?\.?|FIGURE)\s+([0-9]+[a-z]?)\b/i;
const BACKMATTER_LINE = /\b(?:supported|sponsored|funded|donated) by\b|\bfinancial (?:disclosure|support)\b|\bgrants? (?:from|no\.?|number)\b|\bconflicts? of interests?\b|\bmanuscript (?:submitted|received)\b|\b(?:received|accepted|revised)\s+(?:for publication\s+)?(?:on\s+)?(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|\bstudy was initiated by\b|\bcorresponding author\b|\bclinicaltrials\.gov\b/i;
const SUPPLEMENT = /^\s*(?:e(?:Table|Figure|Appendix)\s*\d|Supplementa(?:l|ry) (?:Table|Figure|Material|Appendix|Data|Methods)\b|Online (?:Supplement|Appendix|Resource)\b|Appendix\s+[A-Z0-9]\b|Tables from\b)/i;
const ABBREV = /(?:\bet al|\bFig|\bFigs|\bvs|\bi\.e|\be\.g|\bNo|\bDr|\bapprox|\bca|\bresp|\bEq|\bTab|\bRef|\bmo|\byr|\bvol|\bpp|\bSt|\bMr|\bMrs|\bProf|\bcf|\bJ|\bal)$/;

const normDoi = d => String(d || '').toLowerCase().replace(/^doi-/, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/[.)\];,]+$/, '');

/** The heading a line is, if it is only a heading: the zone name, or ''. */
export function headingZone(line) {
  const s = String(line || '').trim().replace(/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+/, '').replace(/[:.]\s*$/, '').trim();
  // a heading starts with a capital: "response" alone on a line is a word of prose broken by the column (Moro 2010: the results became comments)
  if (!s || s.length > 60 || !/^\p{Lu}/u.test(s)) return '';
  for (const [z, re] of ZONES) if (re.test(s)) return z;
  return '';
}

/** Builds the index of a full text. `doi` the paper's own DOI (a page headed by another DOI is another article). */
export function buildIndex(raw, { doi = '' } = {}) {
  // ⫾ and the like are a plus-minus sign set in another font
  const t = String(raw || '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[⫾∓]/g, '±').replace(/⫺/g, '−').replace(/∘/g, '°').replace(/\u00AD/g, '');
  const own = normDoi(doi);
  // pages and lines
  const pageStarts = [0];
  for (let i = 0; i < t.length; i++) if (t[i] === '\f') pageStarts.push(i + 1);
  const lines = [];
  for (let s = 0, i = 0; i <= t.length; i++) if (i === t.length || t[i] === '\n' || t[i] === '\f') { lines.push({ s, e: i }); s = i + 1; }
  const pageOf = off => { let lo = 0, hi = pageStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pageStarts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
  // pages headed or footed by another article's DOI
  const otherPage = new Set();
  if (own) for (let p = 0; p < pageStarts.length; p++) {
    const ps = pageStarts[p], pe = p + 1 < pageStarts.length ? pageStarts[p + 1] : t.length, body = t.slice(ps, pe);
    const head = body.split('\n').slice(0, 6).join('\n') + '\n' + body.split('\n').slice(-4).join('\n');
    // a reference list's DOIs at the foot of a page do not make it another article's (Cury 2019: a letter's last page); its head does
    const bl = body.split('\n'), refsOnPage = bl.filter(x => REF_LINE.test(x)).length;
    // and a DOI that ends a reference entry (the line after one) is that reference's
    const headLines = refsOnPage ? bl.slice(0, 6).filter((x, i) => !REF_LINE.test(x) && !(i > 0 && REF_LINE.test(bl[i - 1]))) : [head];
    const dois = [...headLines.join('\n').matchAll(DOI)].map(m => normDoi(m[0]));
    if (dois.length && !dois.includes(own) && !body.toLowerCase().includes(own)) otherPage.add(p + 1);
  }
  // zones by headings, reference entries line by line, table regions from their captions
  let zone = 'front', refLines = 0, seenAbstract = false, tableId = '', tableLeft = 0;
  // the paper's own citation on its first page ("Lancet Neurol 2011; 10: 509–19") reads like a reference entry; a first page with only a few
  // such lines has no reference list
  const firstPageRefs = lines.filter(L => L.s < (pageStarts[1] ?? t.length) && REF_LINE.test(t.slice(L.s, L.e))).length;
  const firstHeadingRefs = { counted: false };
  for (const L of lines) {
    const text = t.slice(L.s, L.e), hz = headingZone(text);
    L.page = pageOf(L.s);
    if (hz) {
      // an abstract after a block of references starts another article (one bound into the same PDF)
      if ((hz === 'abstract' || hz === 'introduction') && refLines >= 8 && zone === 'references') zone = 'other-article';
      else if (zone !== 'other-article' || hz === 'commentary') zone = hz;
      if (hz === 'abstract') seenAbstract = true;
      if (hz === 'references') refLines = 0;
      L.heading = hz; tableId = ''; tableLeft = 0;
    }
    if (!firstHeadingRefs.counted && (hz === 'abstract' || hz === 'introduction')) firstHeadingRefs.counted = true;
    const cap = text.match(TABLE_CAPTION);
    // tables, figures or a supplement after the references or the back matter are the study's own again (a journal's tables printed at the
    // end, an online supplement saved with the PDF: Lopes 2014, Denys 2010, Luciano 2025), not more references
    if ((zone === 'references' || zone === 'backmatter') && !hz && (cap || SUPPLEMENT.test(text) || FIG_CAPTION.test(text))) { zone = 'results'; refLines = 0; }
    if (cap) { tableId = `Table ${cap[2]}`; tableLeft = 80; }
    else if (FIG_CAPTION.test(text)) { tableId = ''; tableLeft = 0; L.figure = true; }
    const isRef = REF_LINE.test(text);
    if (isRef) { refLines++; L.ref = true; }
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    // a table ends at running prose: a line of seven or more words, mostly letters, with few numbers (narrow columns too)
    const letters = (text.match(/\p{L}/gu) || []).length, digits = (text.match(/\d+(?:[.,]\d+)?/g) || []).length;
    if (tableId && !cap && words >= 7 && letters / Math.max(1, text.replace(/\s/g, '').length) > 0.7 && digits <= 2 && /[a-z]{3,}/.test(text)) { tableId = ''; tableLeft = 0; }
    if (tableId) { L.table = tableId; if (--tableLeft <= 0) tableId = ''; }
    // a citation line in the front matter ("Neurology 2021;96:e684-e697. doi:…") is the paper's own, not a reference
    L.zone = otherPage.has(L.page) ? 'other-article' : L.ref && zone !== 'other-article' && zone !== 'commentary' && !(L.page === 1 && firstPageRefs < 5) ? 'references' : zone;
    // a funding, disclosure or submission statement printed among the references (a journal's last column) is the paper's back matter
    if (L.zone === 'references' && !L.ref && BACKMATTER_LINE.test(text)) L.zone = 'backmatter';
    void seenAbstract;
  }
  // running heads and feet: a short line that recurs on several pages (digits aside) is the journal's, not the study's
  const sig = L => ix_sig(t.slice(L.s, L.e));
  const pagesOf = new Map();
  for (const L of lines) { const k = sig(L); if (k.length >= 6 && k.length <= 140) { if (!pagesOf.has(k)) pagesOf.set(k, new Set()); pagesOf.get(k).add(L.page); } }
  const npages = pageStarts.length;
  // a short line (three words or fewer: "Cell transplantation", "Preoperative", "P-value") recurs on many pages as a table's row or column
  // label too; it is a running head only at the top or the foot of its page. A line without three letters ("23.6 (2.8)") never is one.
  const edge = new Set();
  const byPage = new Map();
  for (const L of lines) if (t.slice(L.s, L.e).trim()) { if (!byPage.has(L.page)) byPage.set(L.page, []); byPage.get(L.page).push(L); }
  for (const own of byPage.values()) for (const L of [...own.slice(0, 4), ...own.slice(-4)]) edge.add(L);
  for (const L of lines) {
    const k = sig(L), p = pagesOf.get(k), x = t.slice(L.s, L.e);
    if (!p || p.size < Math.max(3, Math.ceil(npages * 0.3)) || L.heading) continue;
    if ((x.match(/\p{L}/gu) || []).length < 3) continue;
    if (x.trim().split(/\s+/).length <= 3 && !edge.has(L)) continue;
    L.zone = 'header'; L.header = true; L.table = '';
  }
  // a run of reference entries before the paper's own first heading is the end of the previous article
  const firstOwn = lines.findIndex(L => L.heading === 'abstract' || L.heading === 'introduction' || L.heading === 'methods');
  // unless that run prints the paper's own DOI outside a running head or foot: then it is this paper, a letter without headings whose
  // reference list ends before the next article in the issue (Scelzo 2017, a JNNP PostScript letter followed by another one)
  const ownBeforeHeading = own && firstOwn > 0 && lines.slice(0, firstOwn).some(L => !L.header && t.slice(L.s, L.e).toLowerCase().replace(/\s+/g, '').includes(own));
  if (firstOwn > 0 && !ownBeforeHeading && lines.slice(0, firstOwn).filter(L => L.ref).length >= 8) for (let i = 0; i < firstOwn; i++) lines[i].zone = 'other-article';
  // sentences: within a line run, split at . ! ? before a capital or a digit (not after an abbreviation or inside a decimal); a table line is its own unit
  const sents = [];
  const pushSent = (s, e, extra = {}) => { while (s < e && /\s/.test(t[s])) s++; while (e > s && /\s/.test(t[e - 1])) e--; if (e > s) sents.push({ s, e, ...extra }); };
  let runStart = -1, runZone = '';
  const flush = end => { if (runStart < 0) return; let s = runStart; for (let i = runStart; i < end; i++) { const c = t[i];
    // a superscript citation after the full stop ("…postoperatively.1 In contrast") ends a sentence about another study
    if (c === '.' && /[a-z)]/i.test(t[i - 1] || '')) { const m = t.slice(i + 1, i + 12).match(/^(\d{1,3}(?:[,–-]\d{1,3})*)\s+(?=[A-Z])/); if (m) { pushSent(s, i + 1 + m[1].length, { zone: runZone, cite: true }); s = i + 1 + m[1].length; i = s; continue; } }
    if ((c === '.' || c === '!' || c === '?') && /\s/.test(t[i + 1] || ' ')) { const after = t.slice(i + 1, i + 4).trimStart()[0] || ''; const before = t.slice(Math.max(s, i - 12), i); if ((/[A-Z0-9([“"]/.test(after) || !after) && !ABBREV.test(before)) { pushSent(s, i + 1, { zone: runZone }); s = i + 1; } } } pushSent(s, end, { zone: runZone }); runStart = -1; };
  for (const L of lines) {
    const text = t.slice(L.s, L.e);
    if (L.table || L.heading || L.ref || L.header || !text.trim()) { flush(L.s); if (text.trim()) pushSent(L.s, L.e, { zone: L.header ? 'header' : L.table ? 'table' : L.zone, table: L.table || '', line: true }); continue; }
    if (runStart >= 0 && runZone !== L.zone) flush(L.s);
    if (runStart < 0) { runStart = L.s; runZone = L.zone; }
  }
  flush(t.length);
  for (const S of sents) S.page = pageOf(S.s);
  const sentOf = off => { let lo = 0, hi = sents.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (sents[m].s <= off) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 && off <= sents[r].e ? r : -1; };
  const lineOf = off => { let lo = 0, hi = lines.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lines[m].s <= off) lo = m; else hi = m - 1; } return lo; };
  // numbers in their exact form
  const nums = [];
  // "67.71/25.71/11.14" (values at three times) and "4/48" are each several numbers
  // a decimal number with a table's footnote letter after it ("⫺19.6 ± 6.8b", Nakamura 2001) is the number
  for (const m of t.matchAll(/(?<![\p{L}\d.,])([-−]?)(\d+(?:[.,·]\d+)*)(?![\p{L}\d])|(?<![\p{L}\d.,])([-−]?)(\d+[.,·]\d+)(?=[a-f](?![\p{L}\d]))/gu)) {
    const sign = m[1] ?? m[3] ?? '', body = m[2] ?? m[4], s = m.index + sign.length, e = s + body.length;
    const prev = t[m.index - 1] || '', next = t.slice(e, e + 2);
    // a dash between two numbers is a range, not a sign
    const neg = !!sign && !/\d\s*$/.test(t.slice(Math.max(0, m.index - 3), m.index));
    const vals = [];
    if (/^\d{1,3}(?:,\d{3})+$/.test(body)) vals.push({ v: Number(body.replace(/,/g, '')), dec: 0 });
    if (/^\d+[.,·]\d+$/.test(body)) { const [a, b] = body.split(/[.,·]/); vals.push({ v: Number(`${a}.${b}`), dec: b.length }); }
    if (/^\d+$/.test(body)) vals.push({ v: Number(body), dec: 0 });
    if (!vals.length) continue;   // dotted strings (dates, versions, section numbers) are not quantities
    if (neg) for (const x of vals) x.v = -x.v;
    const li = lineOf(s), L = lines[li];
    // a number that names something (Figure 6, Table 2, patient 12, grade II, reference [14]) is not a quantity
    const label = /(?:\bFig(?:ure)?s?\.?|\bTables?|\bTab\.|\bRef(?:erence)?s?\.?|\bpatients? (?:no\.?\s*)?|\bcases? (?:no\.?\s*)?|\bNo\.|\bgrade|\btype|\bclass|\bstage|\bstep|\bversion|\bphase|\bvolume|\bVol\.)\s*$/i.test(t.slice(Math.max(0, m.index - 14), m.index)) || (/\[\s*$/.test(t.slice(Math.max(0, m.index - 2), m.index)) && /^\s*[\],–-]/.test(t.slice(e, e + 2)));
    // a suspended time label ("at the 1- and 2-year FU", "3- or 6-month"): the first number names a time point, it is not a value
    const suspended = /^-\s*(?:and|or|to)\s+\d+(?:\.\d+)?[- ]?(?:years?|months?|weeks?|days?)\b/i.test(t.slice(e, e + 24));
    nums.push({ s: neg ? m.index : s, e, raw: (neg ? '-' : '') + body, vals, pct: /^\s?%/.test(next), pm: /±\s*$/.test(t.slice(Math.max(0, s - 3), s)), label: label || suspended, page: L.page, line: li, zone: L.table ? 'table' : L.zone, table: L.table || '', sent: sentOf(s), word: false, prev });
  }
  // number words ("Forty-five patients", "two cases", "none")
  const wre = new RegExp(`\\b(${Object.keys(WORDS).filter(w => w !== 'no').join('|')})(?:[- ](${UNITS_WORDS.join('|')}))?\\b`, 'gi');
  for (const m of t.matchAll(wre)) {
    const a = WORDS[m[1].toLowerCase()], b = m[2] ? WORDS[m[2].toLowerCase()] : 0;
    if (a == null) continue;
    const v = a >= 20 && a % 10 === 0 && a < 100 ? a + b : a;
    const li = lineOf(m.index), L = lines[li];
    nums.push({ s: m.index, e: m.index + m[0].length, raw: m[0], vals: [{ v, dec: 0 }], pct: false, pm: false, page: L.page, line: li, zone: L.table ? 'table' : L.zone, table: L.table || '', sent: sentOf(m.index), word: true });
  }
  nums.sort((x, y) => x.s - y.s);
  // mentions of every known measure (a phrase broken over two lines is one mention: line breaks read as spaces, offsets unchanged)
  const tFlat = t.replace(/\n/g, ' ');
  const mentions = {};
  for (const M of MEASURES) {
    const re = new RegExp(M.re.source, M.re.flags.includes('g') ? M.re.flags : `${M.re.flags}g`);
    const hits = [];
    for (const m of tFlat.matchAll(re)) { const li = lineOf(m.index); hits.push({ s: m.index, e: m.index + m[0].length, sent: sentOf(m.index), line: li, zone: lines[li].table ? 'table' : lines[li].zone, table: lines[li].table || '', page: lines[li].page }); }
    if (hits.length) mentions[M.id] = hits;
  }
  const abbr = {};
  // an abbreviation the paper defines for a known measure ("pedicle screws loosening (PSL)"): its uses are mentions of that measure
  for (const m of t.matchAll(/([A-Za-z][A-Za-z -]{3,60}?)\s*\(\s*([A-Z]{2,6})\s*\)/g)) {
    const long = m[1], ab = m[2];
    const M = MEASURES.find(x => x.re.test(long.slice(-40)) && !x.re.test(ab));
    if (!M || /^(?:ODI|VAS|NRS|JOA|SVA|PI|LL|PT|SS|TK|EBL|LOS|BMI|ASD|PJK|DJK)$/.test(ab)) continue;
    (abbr[M.id] ||= []).includes(ab) || abbr[M.id].push(ab);
    const hits = mentions[M.id] ||= [];
    for (const u of t.matchAll(new RegExp(`\\b${ab}\\b`, 'g'))) { if (hits.some(h => h.s === u.index)) continue; const li = lineOf(u.index); hits.push({ s: u.index, e: u.index + ab.length, sent: sentOf(u.index), line: li, zone: lines[li].table ? 'table' : lines[li].zone, table: lines[li].table || '', page: lines[li].page }); }
    hits.sort((x, y) => x.s - y.s);
  }
  return { version: INDEX_VERSION, hash: hash(t), t, doi: own, pageStarts, lines, sents, nums, mentions, abbr, otherPages: [...otherPage].sort((a, b) => a - b) };
}

// one patient, not the cohort: an illustrative case ("A 52-year-old female patient presented with … VAS 7"), a numbered patient or case
const INDIVIDUAL = /\b(?:a|an|one|the|this)\s+\d{1,3}[- ]year[- ]old\b|\b\d{1,3}[- ]year[- ]old (?:man|woman|male|female|patient)\b|\b(?:case|patient)\s+(?:no\.?\s*)?\d+\b|\bcase report\b|\billustrative case\b|\bcase \d+:/i;
function ix_sig(text) { return String(text || '').trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' '); }

/** What a sentence says about itself: negated, hedged, attributed to another study, the study's own, a definition, its statistics and times. */
export function sentenceFlags(ix, si) {
  const S = ix.sents[si];
  if (!S) return null;
  if (S.flags) return S.flags;
  const x = ix.t.slice(S.s, S.e);
  const stats = Object.keys(STAT).filter(k => STAT[k].test(x)), times = Object.keys(TIME).filter(k => TIME[k].test(x));
  const tm = x.match(TIME.timed);
  // "This study analyzed 80 segments…" right after a citation is still about the cited study
  const carried = /^(?:this|that|their|these|those|the latter|the former) (?:study|series|report|trial|group|authors?)\b|^(?:they|their|these authors|the authors) (?!of this)/i.test(x.trim()) && si > 0 && ix.sents[si - 1]?.zone === S.zone && sentenceFlags(ix, si - 1)?.attributed;
  S.flags = { individual: INDIVIDUAL.test(x), negated: NEGATION.test(x), hedged: HEDGE.test(x), attributed: (ATTRIBUTION.test(x) || carried || !!S.cite) && !OWN.test(x), own: OWN.test(x), definition: DEFINITION.test(x),
    stats, times, timed: tm ? tm[0] : '', denominator: (x.match(DENOMINATOR_UNITS) || [''])[0].toLowerCase() };
  return S.flags;
}

/** The text of a sentence (or line), shortened around an offset for display. */
export function snippet(ix, si, around = null, width = 220) {
  const S = ix.sents[si];
  if (!S) return '';
  let a = S.s, b = S.e;
  if (b - a > width) { const c = around == null ? a : around; a = Math.max(S.s, c - (width >> 1)); b = Math.min(S.e, a + width); }
  return `${a > S.s ? '…' : ''}${ix.t.slice(a, b).replace(/\s+/g, ' ').trim()}${b < S.e ? '…' : ''}`;
}

/** The zone of an offset. */
export function zoneAt(ix, off) {
  let lo = 0, hi = ix.lines.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= off) lo = m; else hi = m - 1; }
  const L = ix.lines[lo];
  return L.table ? 'table' : L.zone;
}

/**
 * One index over every source a trial's values may cite (31 Oct 2026): its main report, the reports linked to it (a companion's own text,
 * or one appended to the main text after a "[Companion report …]" line), its registry records and the records' abstracts. Each source is
 * indexed on its own (its own DOI, headings and zones, so a companion is not "another article in the PDF"), then the indexes are joined:
 * every line, sentence, number and mention keeps its own page and carries `src`, the source's place in `ix.sources`. A proof's premise names
 * its source with `sourceAt`. `sources` [{ name, kind: 'main'|'report'|'registry'|'abstract', id, text, doi }]; the first is the main report.
 */
export function buildSourcesIndex(sources) {
  const parts = (sources || []).filter(x => x && String(x.text || '').trim());
  if (!parts.length) return buildIndex('');
  const ixs = parts.map(p => buildIndex(p.text, { doi: p.doi || '' }));
  if (ixs.length === 1) return Object.assign(ixs[0], { sources: [{ name: parts[0].name || '', kind: parts[0].kind || 'main', id: parts[0].id || '', start: 0, end: ixs[0].t.length }] });
  let t = '';
  const lines = [], sents = [], nums = [], mentions = {}, abbr = {}, pageStarts = [], srcs = [];
  ixs.forEach((ix, k) => {
    if (k) t += '\f';   // each source starts on a page of its own
    const off = t.length, L0 = lines.length, S0 = sents.length, sh = x => (x >= 0 ? x : -1);
    srcs.push({ name: parts[k].name || '', kind: parts[k].kind || (k ? 'report' : 'main'), id: parts[k].id || '', start: off, end: off + ix.t.length });
    t += ix.t;
    pageStarts.push(...ix.pageStarts.map(p => p + off));
    for (const L of ix.lines) lines.push({ ...L, s: L.s + off, e: L.e + off, src: k });
    for (const S of ix.sents) { const { flags, ...rest } = S; void flags; sents.push({ ...rest, s: S.s + off, e: S.e + off, src: k }); }
    for (const n of ix.nums) nums.push({ ...n, s: n.s + off, e: n.e + off, line: n.line + L0, sent: n.sent >= 0 ? sh(n.sent + S0) : -1, src: k });
    for (const [id, hits] of Object.entries(ix.mentions)) (mentions[id] ||= []).push(...hits.map(h => ({ ...h, s: h.s + off, e: h.e + off, line: h.line + L0, sent: h.sent >= 0 ? h.sent + S0 : -1, src: k })));
    for (const [id, abs] of Object.entries(ix.abbr || {})) for (const a of abs) (abbr[id] ||= []).includes(a) || abbr[id].push(a);
  });
  return { version: INDEX_VERSION, hash: hash(t), t, doi: ixs[0].doi, pageStarts, lines, sents, nums, mentions, abbr, otherPages: ixs[0].otherPages, sources: srcs };
}

/** The source an offset of a joined index stands in ({ name, kind, id, start, end }), or null for a single text. */
export function sourceAt(ix, off) {
  const S = ix.sources;
  if (!S?.length) return null;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].start <= off) lo = m; else hi = m - 1; }
  return S[lo];
}
/** The name a premise gives its source: '' for the main report, else the source's name ("Mueller 2008 (linked report)"). */
export function sourceName(ix, off) {
  const s = sourceAt(ix, off);
  return !s || s.kind === 'main' ? '' : s.name;
}

/** The page of an offset, the page of its own source (a line's page). */
export function pageAt(ix, off) {
  let lo = 0, hi = ix.lines.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= off) lo = m; else hi = m - 1; }
  return ix.lines[lo]?.page || 1;
}

/** The zones a span of text covers ("the quote begins in a running head and goes on in the methods": both). */
export function zonesIn(ix, s, e) {
  const out = new Set();
  let lo = 0, hi = ix.lines.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= s) lo = m; else hi = m - 1; }
  for (let i = lo; i < ix.lines.length && ix.lines[i].s < e; i++) { const L = ix.lines[i]; if (ix.t.slice(L.s, L.e).trim()) out.add(L.table ? 'table' : L.zone); }
  return out;
}

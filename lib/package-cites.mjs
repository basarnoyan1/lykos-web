// The works the package's tables and figures cite, and where they take their numbers (plan §2, "Submission files, structured").
// Pure and light: the manuscript's numbering reads it on every draw (views/manuscript.mjs), so it imports only the manuscript's citation
// reader, the package's labels and the library's name reader.
//
// An item cites a work by a citation token in its title, legend or notes (`[@key]`, as the manuscript does), or in its cells or drawing as
// "Akgun et al., 2024" matched to one record of the library by first author and year. What the cells and drawings cite is read where the
// sources are loaded (views/submission-files.mjs) and kept on the item as `cites`; a number is never stored. A numbered style numbers a
// table's or figure's works where the text first calls the item out ("Table 2"), as ICMJE asks, or after the text, by the package's
// conventions; supplementary items continue the list or keep one of their own.
import { citations, citationContext } from './manuscript.mjs';
import { labels } from './package-state.mjs';
import { authorList, familyName } from './bib.mjs';
import { otherPaper } from './manuscript-fit.mjs';

export const CONVENTIONS = Object.freeze({
  tables: [['none', 'Not with the text'], ['callout', 'At the first callout'], ['end', 'After the text']],
  supplement: [['continue', 'Continue the main list'], ['separate', 'A list of their own']],
  marks: [['letters', 'a, b, c'], ['symbols', '*, †, ‡'], ['numbers', '1, 2, 3']],
});
const allowed = (k, v) => CONVENTIONS[k].some(([x]) => x === v);
/**
 * The package's conventions with their defaults: table and figure references kept out of the text's numbering (as before the package's
 * works were read, so opening Submission › Files never renumbers the text; another convention is the person's choice, shown first),
 * supplementary ones continuing, lettered marks.
 */
export function conventionsOf(pkg) {
  const c = pkg?.conventions || {};
  return { tables: allowed('tables', c.tables) ? c.tables : 'none', supplement: allowed('supplement', c.supplement) ? c.supplement : 'continue', marks: allowed('marks', c.marks) ? c.marks : 'letters' };
}

/** A part with a prefix (S) is the supplement. */
export const isSupplement = part => !!part?.prefix;
const NUMBERED = new Set(['table', 'figure']);
/** The items of the main parts and of the supplement, in the package's order. */
export function packageOrder(pkg) {
  const main = [], supplement = [];
  for (const part of pkg?.parts || []) for (const id of part.items) if (pkg.items[id]) (isSupplement(part) ? supplement : main).push(id);
  return { main, supplement };
}

// ---- names and years ------------------------------------------------------------------------------------------------------------------
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z]/g, '');
const keyOf = p => p.key || p.id;
const workOf = p => (p.doi ? `doi:${String(p.doi).toLowerCase()}` : `t:${fold(p.title).slice(0, 60)}`);

/**
 * The library by first author's family name and year. `prefer`: keys that win a tie (the works the manuscript already cites); `studies`:
 * the review's own studies (papers with extracted values, lib/package-cites.mjs reviewStudies), which win a tie first.
 */
export function libraryIndex(papers = [], { prefer = null, studies = null } = {}) {
  const by = new Map();
  for (const p of papers) {
    const first = authorList(p.authors)[0], y = String(p.year || '').slice(0, 4);
    if (!first || !/^\d{4}$/.test(y)) continue;
    const fam = fold(familyName(first)), last = fold(String(familyName(first)).split(/\s+/).at(-1));
    for (const k of new Set([`${fam}|${y}`, `~${last}|${y}`])) { if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  }
  return { by, prefer: prefer || new Set(), studies: studies || new Set() };
}
/** The papers that hold an extracted value (`s.values` is keyed "paperId:column"): the review's studies, for breaking a name-and-year tie. */
export function reviewStudies(s) {
  const out = new Set();
  for (const [k, v] of Object.entries(s?.values || {})) { const i = k.indexOf(':'); if (i > 0 && v != null && v !== '') out.add(k.slice(0, i)); }
  return out;
}
/**
 * The records a name and year (and a year's letter, "Kaner 2010b") may be: `{ key }` for one, `{ key: null, candidates }` for several that no
 * rule decides (never guessed), `{ key: null, candidates: [] }` for none. Several records of one work (by DOI or title) are one; a letter
 * picks the record whose label carries it; then the review's studies, then the works the text cites decide.
 */
export function lookupStudy(index, family, year, letter = '') {
  const want = fold(family), full = index.by.get(`${want}|${year}`) || [];
  // a family name printed without its particle ("Silvestre 2014" for Di Silvestre) is its last word
  const all = full.length ? full : index.by.get(`~${want}|${year}`) || [];
  if (!all.length) return { key: null, candidates: [] };
  const works = new Map();
  for (const p of all) if (!works.has(workOf(p))) works.set(workOf(p), p);
  const one = [...works.values()];
  if (one.length === 1) return { key: keyOf(one[0]) };
  const pick = list => (list.length === 1 ? { key: keyOf(list[0]) } : null);
  const has = (set, p) => set.has(keyOf(p)) || set.has(p.id);
  const byLetter = letter ? one.filter(p => String(p.label || '').trim().toLowerCase().endsWith(`${year}${letter.toLowerCase()}`)) : [];
  const pool = byLetter.length ? byLetter : one;
  return pick(pool) || pick(pool.filter(p => has(index.studies, p))) || pick(pool.filter(p => has(index.prefer, p))) || { key: null, candidates: pool.map(keyOf) };
}
const resolve = (index, family, year, letter = '') => lookupStudy(index, family, year, letter).key;

// a family name, with its particles before it ("Di Silvestre", "van der Berg", "De Luca") or after a first name ("Ludwig van Beethoven")
const PARTICLE = "(?:(?:[Vv][ao]n|[Dd]e[rn]?|[Dd][aiu]|[Dd]el(?:la)?|[Dd][oa]s|[Ll][aeo]|[Aa]l|[Ee]l|[Tt]e[nr])\\s+)*";
const NAME = `${PARTICLE}\\p{Lu}[\\p{L}'’\\-]+(?:\\s(?:van|von|de|der|den|da|di|du|del|la|le)\\s\\p{Lu}?[\\p{L}'’\\-]+)?`;
const AUTHOR_YEAR = new RegExp(`(${NAME})(?:\\s+et\\s+al\\.?|\\s+(?:and|&)\\s+${NAME})?,?\\s+\\(?((?:19|20)\\d{2})([a-z]?)(?![\\d\\p{L}])`, 'gu');
/** The works a piece of text cites, in order: citation tokens, then "Name et al., 2024" found in the library. */
export function citesInText(text, index) {
  const out = [], t = String(text ?? '');
  for (const c of citations(t)) out.push({ at: c.start, key: c.key });
  if (index) for (const m of t.replace(/\[@[^\]]*\]/g, x => ' '.repeat(x.length)).matchAll(AUTHOR_YEAR)) {
    const key = resolve(index, m[1], m[2], m[3]);
    if (key) out.push({ at: m.index, key });
  }
  return [...new Set(out.sort((a, b) => a.at - b.at).map(x => x.key))];
}
/** Names and years in a text that no one record of the library answers ("Smith et al., 2015" with no record, or two). */
export function unresolvedNames(text, index) {
  const out = [];
  for (const m of String(text ?? '').replace(/\[@[^\]]*\]/g, x => ' '.repeat(x.length)).matchAll(AUTHOR_YEAR)) if (/et\s+al|\s(?:and|&)\s|,/.test(m[0]) && !resolve(index, m[1], m[2], m[3])) out.push(m[0].trim());   // "In 2019" is not a study
  return out;
}

// ---- the studies an item includes -------------------------------------------------------------------------------------------------------
const LABEL_AT = new RegExp(`^\\s*${AUTHOR_YEAR.source}`, 'u');
/**
 * The studies an item includes, read from its own rows and marks in reading order: `[{ label, key, candidates }]`. `entries` are its texts,
 * `{ t, label }`: a label names a study where it stands (a table's study column, a chart's row label, a printed line's start), so a bare
 * "Lee 2019" there is a study, matched or not; elsewhere a name and year counts when the library answers it, or when it reads as a citation
 * ("Smith et al., 2015"). A label no record answers has no key and no candidates; one that several records answer has their keys as
 * candidates and no key: an ambiguity is reported, never guessed. A study named again is listed once. Citation tokens (`[@key]`) are works
 * the item cites too: `{ label: key, key, token: true }`.
 */
export function itemStudies(entries = [], index) {
  const out = [], seen = new Set();
  const add = (m, cite) => {
    const label = m[0].replace(/^\s+/, '').replace(/[\s,(]+$/, '').trim(), hit = lookupStudy(index, m[1], m[2], m[3]);
    if (!hit.key && !cite) return;
    const id = hit.key || `?${fold(m[1])}|${m[2]}${m[3] || ''}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ label, key: hit.key || null, candidates: hit.candidates || [] });
  };
  for (const { t, label } of entries) {
    const text = String(t ?? '');
    for (const c of citations(text)) if (!seen.has(c.key)) { seen.add(c.key); out.push({ label: c.key, key: c.key, candidates: [], token: true }); }
    const bare = text.replace(/\[@[^\]]*\]/g, x => ' '.repeat(x.length)), lead = label ? LABEL_AT.exec(bare) : null;
    if (lead) add(lead, true);
    for (const m of bare.matchAll(AUTHOR_YEAR)) if (!lead || m.index > 0 && m.index >= lead[0].length) add(m, /et\s+al|\s(?:and|&)\s|,/.test(m[0]));
  }
  return out;
}
const STUDY_HEAD = /^(stud(y|ies)|author|first author|reference|source|trial)\b/i;
/** A table's texts in reading order (`grid` as citesInGrid's): the first column and any column headed Study or Author name studies. */
export function gridTexts(grid) {
  const rows = grid?.rows || [], head = (rows[0]?.cells || []).map(c => String(c?.text ?? c ?? '').trim());
  const studyCols = new Set([0, ...head.map((h, i) => (STUDY_HEAD.test(h) ? i : -1)).filter(i => i >= 0)]);
  return rows.flatMap((r, ri) => (r.cells || []).flatMap((c, ci) => (c?.merged ? [] : [{ t: String(c?.text ?? c ?? ''), label: ri > 0 && studyCols.has(ci) }])));
}
/** A drawing's texts: each text run, a chart's row label being a run of its own. */
export const svgTexts = svg => svgText(svg).split('\n').map(t => ({ t, label: true }));
/** A printed drawing's lines (lib/printed-data.mjs: each line's cells left to right): a line's first cell names its study. */
export const lineTexts = lines => (lines || []).flatMap(l => (Array.isArray(l) ? [{ t: l[0], label: true }, { t: l.slice(1).join(' '), label: false }] : [{ t: l, label: true }]));
/** The keys of an item's studies, in order, for `cites`. */
export const studyKeys = studies => [...new Set((studies || []).filter(x => x.key).map(x => x.key))];
/** Labels a person must settle: unmatched ("Smith 2015: not in the library") and ambiguous ("Lee 2019: 2 records"). */
export const unsettled = studies => (studies || []).filter(x => !x.key).map(x => (x.candidates.length ? `${x.label}: ${x.candidates.length} records` : `${x.label}: not in the library`));

/** The works a table cites, its header first and then row by row (`grid`: `{ rows: [{ cells: [{ text }] }] }`). */
export const citesInGrid = (grid, index) => [...new Set((grid?.rows || []).flatMap(r => (r.cells || []).flatMap(c => (c?.merged ? [] : citesInText(c?.text ?? c, index)))))];
/** The text of an SVG drawing, element by element (a forest plot's study labels). */
export const svgText = svg => [...String(svg || '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')).join('\n');

/** Every work an item cites: its title, then what its cells or drawing cite (`cites`, read with its source), then its legend and notes. */
export function itemCites(it) {
  if (!it) return [];
  const tok = t => citations(String(t || '')).map(c => c.key);
  return [...new Set([...tok(it.title), ...(Array.isArray(it.cites) ? it.cites : []), ...tok(it.legend), ...(it.notes || []).flatMap(tok)])];
}
/** Whether the works an item cites can be counted: it has text (a table, a drawing of the app) or a count read with its source. */
export const countable = it => !!it && (Array.isArray(it.cites) || it.kind === 'table' || !!it.source?.app || !!it.source?.apps?.length);

// ---- callouts in the text ---------------------------------------------------------------------------------------------------------------
const WORD = String.raw`(?:(Supplementary|Supplemental)\s+)?(Tables?|Figures?|Figs?\.)`;
const NUM = String.raw`S?\d{1,3}`;
const MENTION = new RegExp(String.raw`\b${WORD}\s+(${NUM}(?:\s*(?:[-–—]|,|,?\s+and|,?\s+&)\s*${NUM})*)(?![\p{L}\d])`, 'gu');
/** A caption paragraph ("Figure 2. In cases of …") is the item's legend in the text, not a callout. */
const LEGEND = /^\s*(?:Supplementary\s+|Supplemental\s+)?(?:Table|Figure|Fig\.)\s+S?\d{1,3}\s*[.:|]/;

/** Each mention of a table or figure in a text: `{ start, end, raw, supp, kind, word, numbers: [{ n, s }], range, dash }`. */
export function mentions(text) {
  const out = [], t = String(text ?? '');
  for (const m of t.matchAll(MENTION)) {
    const list = m[3], kind = /^T/.test(m[2]) ? 'table' : 'figure';
    const nums = [...list.matchAll(/(S?)(\d{1,3})/g)].map(x => ({ n: Number(x[2]), s: !!x[1] || !!m[1] }));
    const range = /^\s*S?\d{1,3}\s*[-–—]\s*S?\d{1,3}\s*$/.exec(list), dash = range ? /[-–—]/.exec(list)[0] : '–';
    let numbers = nums;
    if (range && nums.length === 2 && nums[1].n > nums[0].n && nums[1].n - nums[0].n < 50) numbers = Array.from({ length: nums[1].n - nums[0].n + 1 }, (_, i) => ({ n: nums[0].n + i, s: nums[0].s }));
    out.push({ start: m.index, end: m.index + m[0].length, raw: m[0], supp: !!m[1], kind, word: m[2], numbers, range: !!range, dash });
  }
  return out;
}
/** The visible text of a block: its runs (no deleted text, no citation runs) or its text without citation tokens. */
export function visibleText(b) {
  if (b?.runs?.length) return b.runs.filter(r => !r.del && !r.cite).map(r => String(r.t ?? '').replace(/\[@[^\]]*\]/g, '')).join('');
  return String(b?.text ?? '').replace(/\[@[^\]]*\]/g, '');
}
const labelOfMention = (kind, n, s, prefix) => `${kind === 'table' ? 'Table' : 'Figure'} ${s ? prefix : ''}${n}`;
/** The supplement's prefix ("S"), for reading "Supplementary Table 1" as the package's "Table S1". */
export const supplementPrefix = pkg => (pkg?.parts || []).find(isSupplement)?.prefix || 'S';

/** Callouts of the package's items in the text, in order: `{ blockId, at, id }` (the item's first callout only). */
export function callouts(pkg, blocks = []) {
  const byLabel = new Map([...labels(pkg)].map(([id, l]) => [l, id])), prefix = supplementPrefix(pkg), seen = new Set(), out = [];
  for (const b of blocks) {
    if (!b || ['table', 'figure', 'toc', 'bib'].includes(b.type) || /^h[1-6]$/.test(b.type) || b.styleId === 'Caption') continue;
    const t = visibleText(b);
    if (LEGEND.test(t)) continue;
    for (const m of mentions(t)) for (const x of m.numbers) {
      const id = byLabel.get(labelOfMention(m.kind, x.n, x.s, prefix));
      if (id && !seen.has(id)) { seen.add(id); out.push({ blockId: b.id, at: m.end, id }); }
    }
  }
  return out;
}

// ---- numbering ---------------------------------------------------------------------------------------------------------------------------
/**
 * What the manuscript's numbering adds for the package (`citationContext`'s `inserts` and `tail`): a main item's works at its first callout,
 * the main items not called out after the text in the package's order, then the supplement's when it continues the list. Empty when the
 * project has no package, its conventions keep tables out of the text's numbering, or the manuscript is not the review's.
 */
export function numberingOptions(s, blocks = s?.manuscript?.blocks || []) {
  const pkg = s?.package;
  if (!pkg?.parts?.length || !isThePaper(s)) return {};
  const cv = conventionsOf(pkg);
  if (cv.tables === 'none') return {};
  const { main, supplement } = packageOrder(pkg), inserts = new Map(), placed = new Set();
  const keys = id => itemCites(pkg.items[id]);
  if (cv.tables === 'callout') {
    const mainSet = new Set(main);
    for (const c of callouts(pkg, blocks)) {
      if (!mainSet.has(c.id)) continue;
      placed.add(c.id);
      const k = keys(c.id);
      if (!k.length) continue;
      if (!inserts.has(c.blockId)) inserts.set(c.blockId, []);
      inserts.get(c.blockId).push({ at: c.at, keys: k });
    }
  }
  const tail = [...main.filter(id => !placed.has(id)).map(keys), ...(cv.supplement === 'continue' ? supplement.map(keys) : [])].filter(k => k.length);
  return { ...(inserts.size ? { inserts } : {}), ...(tail.length ? { tail } : {}) };
}
/** Whether the manuscript in the app is the paper the package belongs to (a Perspective in a review project is not): `manuscriptFit`. */
export const isThePaper = s => !otherPaper(s);
/** The manuscript's numbering options with the package's (for `numbering(blocks, …)`). */
export const withPackage = (s, blocks, d = {}) => ({ ...d, ...numberingOptions(s, blocks) });

/**
 * The reference numbers of the paper: `main` (key -> n, the text with its tables and figures) and `supplement` (key -> n, the supplement's
 * own list, when it keeps one; else null). `text`: the works the text alone cites.
 */
export function referenceOrder(s) {
  const ms = s?.manuscript || {}, blocks = ms.blocks || [], pkg = s?.package, cv = conventionsOf(pkg);
  const main = citationContext(blocks, { notes: ms.notes || {}, section: ms.section || null, ...numberingOptions(s, blocks) }).numbers;
  let supplement = null;
  if (pkg?.parts?.length && cv.supplement === 'separate') {
    supplement = new Map();
    for (const id of packageOrder(pkg).supplement) for (const k of itemCites(pkg.items[id])) if (!supplement.has(k)) supplement.set(k, supplement.size + 1);
  }
  return { main, supplement, conventions: cv };
}
/** The works the text alone cites, in order. */
export const textCites = s => [...citationContext(s?.manuscript?.blocks || [], { notes: s?.manuscript?.notes || {}, section: s?.manuscript?.section || null }).numbers.keys()];
/** Which numbers change between two orders: `[{ key, from, to }]` (from or to null for a work that enters or leaves the list). */
export function numberChanges(before, after) {
  const out = [];
  for (const [key, from] of before) { const to = after.get(key) ?? null; if (to !== from) out.push({ key, from, to }); }
  for (const [key, to] of after) if (!before.has(key)) out.push({ key, from: null, to });
  return out.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity) || (a.to ?? 0) - (b.to ?? 0));
}
export { NUMBERED };

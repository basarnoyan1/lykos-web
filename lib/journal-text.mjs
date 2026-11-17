// How a journal prints some things the manuscript's own text writes another way, for the journal preview (views/journal-preview.mjs): the
// citation numbers after the punctuation mark, as a run or a range; the decimal point at mid-line; the sections a journal sets in a
// panel. Each is declared by the journal style (lib/addons.mjs journalStyles: citeAfterPunctuation, decimalMark, panels), never named
// for a journal here, and works on the preview's copy of the text: the manuscript's stored text is not changed. No DOM; strings in, strings out.
// A reference is not running text: none of these rules touches one (journalText, referenceUnits), its journal's name and its volume are marked
// where they surely stand without a character of it changed (referenceSpans), and a record of the library sets it again only when the record
// says what the manuscript's entry says (sameReference).

const CITE = /<sup\b[^>]*\bmsd-cite\b[^>]*>([^<]*)<\/sup>/g;
const CITE_RUN = /(<sup\b[^>]*\bmsd-cite\b[^>]*>)([^<]*)<\/sup>(?:<sup\b[^>]*\bmsd-cite\b[^>]*>[^<]*<\/sup>)+/g;
const MARKS = '[.,;:!?)\\]]+';

/**
 * A citation's numbers as a journal prints them: two linked by a comma without a space, three or more in a row as a range linked by an
 * en rule ("1,2", "3–5", "1,4–6,9"). The order is kept. Text that is not a list of numbers (a letter, a symbol) comes back as it is.
 */
export function citationNumbers(text) {
  const s = String(text ?? '').trim();
  if (!/^\d+(?:\s*[-‐-―,]\s*\d+)*$/.test(s)) return String(text ?? '');
  const list = [];
  for (const part of s.split(/\s*,\s*/)) {
    const m = /^(\d+)\s*[-‐-―]\s*(\d+)$/.exec(part);
    if (!m) { list.push(...part.split(/\s*[-‐-―]\s*/).map(Number)); continue; }
    const a = Number(m[1]), b = Number(m[2]);
    if (b < a || b - a > 500) return String(text);   // not a range of references
    for (let n = a; n <= b; n++) list.push(n);
  }
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    if (j - i >= 2) out.push(`${list[i]}–${list[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(list[k]));
    i = j + 1;
  }
  return out.join(',');
}

/**
 * The citations of a paragraph (`sup.msd-cite` in HTML) set for a journal that prints them after the punctuation mark that follows them
 * ("…as reported by Saito and colleagues.15"): superscripts standing together become one citation, its numbers written by citationNumbers,
 * and the mark that follows moves before it.
 */
export function placeCitations(html) {
  return String(html)
    .replace(CITE_RUN, (all, open) => {
      const nums = [...all.matchAll(CITE)].map(m => m[1].trim()).join(','), refs = [...all.matchAll(/data-refs="([^"]*)"/g)].map(m => m[1]).join(' ');
      return `${refs ? open.replace(/data-refs="[^"]*"/, `data-refs="${refs}"`) : open}${nums}</sup>`;
    })
    .replace(CITE, (all, t) => all.replace(`>${t}<`, `>${citationNumbers(t)}<`))
    .replace(new RegExp(`(<sup\\b[^>]*\\bmsd-cite\\b[^>]*>[^<]*</sup>)(${MARKS})`, 'g'), '$2$1');
}

// What a decimal point is not: a number that follows the name of a program or a part of the document ("R 4.1", "metafor 5.2-1", "Table 2.1"),
// one with more than one point (4.1.2, a date), one inside a word (B12.3, v4.1), and a word that is a DOI, a link or an address.
const NAMES = new Set(['version', 'ver', 'v', 'r', 'rstudio', 'stata', 'spss', 'sas', 'python', 'java', 'matlab', 'metafor', 'meta', 'robumeta', 'dmetar', 'netmeta',
  'tidyverse', 'ggplot2', 'webr', 'excel', 'graphpad', 'prism', 'revman', 'covidence', 'rayyan', 'endnote', 'zotero', 'jasp', 'mplus', 'node', 'lykos', 'release',
  'build', 'edition', 'rob', 'quadas', 'amstar', 'table', 'tables', 'figure', 'figures', 'fig', 'section', 'appendix', 'chapter', 'step', 'panel', 'box', 'supplement']);
const NOT_A_NUMBER = /:\/\/|[/@\\]|^www\.|^doi:?|^pmid|^pmc\d/i;

/**
 * The decimal points of a piece of HTML, between digits, shown as `mark` (the mid-line point, U+00B7), the tags and their attributes
 * left as they are. A reference list is not changed (a page range or a DOI
 * must stay as written). Display only: the caller shows the result and keeps the source.
 */
export function decimalMarks(html, mark = String.fromCodePoint(0xb7)) {
  const s = String(html);
  if (/class="msd-refs?\b/.test(s)) return s;
  let before = '';
  return s.split(/(<[^>]*>)/).map(part => {
    if (part.startsWith('<')) return part;
    const text = part.replace(/&[a-z#0-9]+;/gi, m => (m === '&nbsp;' ? ' '.repeat(m.length) : 'x'.repeat(m.length)));   // same length: offsets hold
    const out = part.replace(/(?<![\w.])(\d+)\.(\d+)(?!\d|\.\d)/g, (m, a, b, at) => {
      const tokenStart = text.lastIndexOf(' ', at) + 1, tokenEnd = (i => (i < 0 ? text.length : i))(text.indexOf(' ', at));
      if (NOT_A_NUMBER.test(text.slice(tokenStart, tokenEnd))) return m;
      const lead = (before + text.slice(0, at)).replace(/[\s(\[]+$/, '');
      if (lead.endsWith('\u00a7')) return m;   // a section number
      const prior = lead.match(/([A-Za-z][\w-]*)\.?$/);
      if (prior && NAMES.has(prior[1].toLowerCase())) return m;
      return `${a}${mark}${b}`;
    });
    before = (before + text).slice(-40);
    return out;
  }).join('');
}

/**
 * The text of a unit as the journal prints it, for the style's declared options: `citeAfterPunctuation` (citations), `decimalMark`.
 * A heading is left as written, and so is a reference list. `unit` is a unit of the reading model ({ kind, html }); the result is HTML.
 */
export function journalText(unit, style = {}) {
  let html = String(unit?.html ?? '');
  if (unit?.kind === 'refs') return html;   // a reference list is not running text
  if (style.citeAfterPunctuation) html = placeCitations(html);
  if (style.decimalMark && unit?.kind !== 'heading') html = decimalMarks(html, String(style.decimalMark));
  return html;
}

// ---- references ---------------------------------------------------------------------------------------------------------------------
const REFS_HEADING = /^(?:e?references|reference list|bibliography)$/i;
/**
 * The units of a reference list the manuscript types as paragraphs (a list a reference manager writes is one unit of kind 'refs'): what
 * stands between a heading that reads "References" and the next heading. The preview sets these as written: a rule for running text
 * (the decimal point at mid-line) would change a title's "0.5 mg", a volume or an "arXiv:2305.12345". Answers a Set of the units.
 */
export function referenceUnits(units) {
  const out = new Set(); let inside = false;
  for (const u of units || []) {
    if (u?.kind === 'heading') inside = REFS_HEADING.test(String(u.text ?? '').trim());
    else if (u?.kind === 'refs' || (inside && u?.kind === 'p')) out.add(u);
  }
  return out;
}

const REF_YEAR = '(?:19|20)\\d{2}', REF_VOLUME = '\\d{1,4}[A-Za-z]?';
// "… title. Name 2020; 395: 828–38", "… title? Name 2006; 21 (suppl 14): S290–304", "… title. Name 2020; published online Feb 19. https://…"
const REF_TAIL = new RegExp(`[.?!]["”’]?\\s+([^.?!;:]{1,120}?)\\s+${REF_YEAR};\\s*(?:(${REF_VOLUME})(?:\\s*\\((?:suppl|pt|part)\\b[^)]*\\))?\\s*(:)|published online\\b)`, 'dgi');
// a year with a volume or "published online" after it, wherever it stands: an entry with two of them names two places
const REF_PLACES = new RegExp(`${REF_YEAR};\\s*(?:${REF_VOLUME}\\s*(?:\\([^)]*\\))?\\s*:|published online\\b)`, 'gi');
/**
 * Where a reference of a journal article names its journal and its volume, as offsets into `text` (the entry without its number):
 * { journal: [start, end], volume: [[start, end], …] }, for a style that marks them (`referenceMarks`: The Lancet's journal in italic and
 * volume in bold). The volume is its number and the colon after it, one stretch in "395:" and two around a supplement or a part, as the
 * journal prints "21 (suppl 14):" (Lancet Neurol 2020; 19: 500, 2017; 16: 619, 2011; 10: 518 and 2010; 9: 1172, the publisher PDFs read
 * on 11 Nov 2026); an entry published online ahead of its volume has none. Only an entry that reads "Name Year; Volume: pages" once is answered: a book, a report,
 * an entry in another form (a full stop after the name, a month after the year) and one that names two journals (a correction, a
 * discussion) are null, and are printed as the manuscript has them. The caller wraps the stretches; no character is added or dropped.
 */
export function referenceSpans(text) {
  const s = String(text ?? ''), all = [...s.matchAll(REF_TAIL)];
  if (all.length !== 1 || s.match(REF_PLACES).length !== 1) return null;
  const at = all[0].indices;
  if (!/\p{L}/u.test(all[0][1])) return null;
  if (!at[2]) return { journal: at[1], volume: [] };
  return { journal: at[1], volume: at[2][1] === at[3][0] ? [[at[2][0], at[3][1]]] : [at[2], at[3]] };
}

// A journal article's entry, whole: what stands before the journal's name (the authors and the title, to the title's last mark), the name, the
// year, the volume, what stands in brackets after it (an issue number, a supplement, a part), the first page and the last, and a DOI.
const REF_ENTRY = new RegExp(`^(.*[.?!]["”’]?)\\s+([^.?!;:]{1,120}?)\\.?\\s+(${REF_YEAR})\\s*;\\s*(${REF_VOLUME})\\s*(?:\\(([^)]*)\\))?\\s*:\\s*([A-Za-z]*\\d+[A-Za-z]*)`
  + `(?:\\s*[-\\u2010-\\u2015]\\s*([A-Za-z]*\\d+[A-Za-z]*))?\\.?(?:\\s+(?:doi:\\s*|https?:\\/\\/(?:dx\\.)?doi\\.org\\/)(10\\.\\d{4,9}\\/\\S+?))?\\.?$`, 'i');
function referenceFacts(text) {
  const m = REF_ENTRY.exec(String(text ?? '').replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const [, head, journal, year, volume, bracket = '', first, last = '', doi = ''] = m;
  // a last page written short ("1164–66", "690-9") is read in full: the same pages are the same in either form
  const short = /^\d+$/.test(first) && /^\d+$/.test(last) && last.length < first.length;
  return { head, journal, year, volume, part: /^(?:suppl|pt|part)\b/i.test(bracket.trim()) ? bracket.trim().toLowerCase().replace(/\s+/g, ' ') : '',
    first, last: short ? first.slice(0, first.length - last.length) + last : last, doi: doi.toLowerCase() };
}
/**
 * Whether a reference set again from a record of the library (`reset`, lib/cite.mjs formatReference) says what the manuscript's own entry
 * says (`entry`, without its number), so that the preview may print it in the journal's form. Both must read as a journal article with a
 * year, a volume and pages, and agree letter for letter on the authors and the title, the journal's name, the year, the volume, a
 * supplement or part, and the pages; a DOI where both give one. What may differ is the form alone: the marks and spaces between the name,
 * the year, the volume and the pages, an issue number, a DOI, how a page range is linked and shortened, the last full stop, and the
 * authors the journal's form leaves out for "et al" (the re-set's are then the manuscript's first ones, and its title the manuscript's).
 * A record that names the journal in full where the manuscript abbreviates it, writes the title in other capitals, or gives an author
 * other initials does not pass: the preview cannot tell which is right, and the entry stands as the manuscript has it.
 */
export function sameReference(entry, reset) {
  const a = referenceFacts(entry), b = referenceFacts(reset);
  if (!a || !b || ['journal', 'year', 'volume', 'part', 'first', 'last'].some(k => a[k] !== b[k]) || (a.doi && b.doi && a.doi !== b.doi)) return false;
  if (a.head === b.head) return true;
  const cut = /^(.*?), et al\.? (.*)$/.exec(b.head);
  if (!cut || !a.head.startsWith(`${cut[1]}, `) || !a.head.endsWith(`. ${cut[2]}`)) return false;
  // what the re-set leaves out is names alone, up to the full stop that ends the authors
  return /^[^.?!]+$/.test(a.head.slice(cut[1].length + 2, a.head.length - cut[2].length - 2));
}

const nameKey = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * The runs of nodes a journal sets in a panel: from a heading whose text is one of `names` to the next heading of the same or a higher
 * level, or to a figure, table or reference list (those have pages of their own). `items` is [{ level, text }] in document order, `level`
 * 1–6 for a heading, 0 for text and -1 for a node that ends a panel. With a `label` (a style's `panelLabel`: 'Panel') a heading that reads
 * "Panel: …" or "Panel 2: …" opens one too, as the journal titles the panels it numbers; its span says `labelled`. Returns
 * [{ start, end }] (end exclusive).
 */
export function panelSpans(items, names = [], { label = '' } = {}) {
  const want = new Set((names || []).map(nameKey).filter(Boolean)), spans = [];
  const titled = label && nameKey(label) ? new RegExp(`^\\s*${String(label).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+\\d+)?\\s*:\\s*\\S`, 'i') : null;
  if (!want.size && !titled) return spans;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!(it.level > 0)) continue;
    const named = want.has(nameKey(it.text)), labelled = !named && !!titled && titled.test(String(it.text || ''));
    if (!named && !labelled) continue;
    let end = i + 1;
    while (end < items.length && items[end].level >= 0 && !(items[end].level > 0 && items[end].level <= it.level)) end++;
    spans.push(labelled ? { start: i, end, labelled: true } : { start: i, end }); i = end - 1;
  }
  return spans;
}

/**
 * Where the text cites a panel whose heading is `title` ("Panel: …", "Panel 2: …"; `label` the style's `panelLabel`), as a journal cites
 * one: a numbered panel by its number ("panel 2", "panels 2"), the only one in brackets among what else is cited there ("(panel)",
 * "(12 trials; panel; appendix p 3)", "(see panel)"); the word in running text ("an expert panel") is not a citation. A RegExp to test
 * a block's text with, or null when the title is not so labelled.
 */
export function panelMention(title, label) {
  const word = String(label || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = word ? new RegExp(`^\\s*${word}(?:\\s+(\\d+))?\\s*:`, 'i').exec(String(title || '')) : null;
  if (!m) return null;
  return m[1] ? new RegExp(`\\b${word}s?\\s+${m[1]}\\b`, 'i') : new RegExp(`(?:\\(|[;,]\\s)(?:see\\s+)?${word}(?=\\s*[);,])`, 'i');
}

/** A correspondence unit with its label ("Correspondence:") replaced by the style's own ("Correspondence to:"), in its text and its HTML. */
export function relabelCorrespondence(unit, label) {
  if (!unit || !label) return unit;
  return { ...unit, text: String(unit.text).replace(/^Correspondence(?: to)?:/i, label), html: String(unit.html ?? '').replace(/Correspondence(?: to)?:/i, label) };
}

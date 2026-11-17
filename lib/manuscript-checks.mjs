// Checks over the manuscript (plan J8).
//
// Every check reports something a reader could verify by hand; none of them
// judges whether a claim is true. A check either points at a mechanical
// inconsistency (a citation with no record, a stale linked result) or at
// wording the author should look at again. Nothing is auto-corrected.
//
// The reference list is checked as the manuscript's output: a cited record
// that carries a retraction notice, is a preprint, lacks an identifier, or
// duplicates another cited record is reported against the citation, since
// that is where the reader of the finished paper will meet it.
import { lib_manuscript$citations as citations, lib_manuscript$resultTokens as resultTokens, lib_manuscript$sections as sections } from "../boot.mjs";
import { isDocToken, documentCounts } from './manuscript-doc.mjs';
import { structureCounts } from './manuscript-structure.mjs';
import { lib_bib_names$authorList as authorList, lib_bib_names$familyName as familyName, lib_bib_names$initials as initials } from "../boot.mjs";
import { lib_search_library$titleKey as titleKey } from "../boot.mjs";
import { checkCitations } from './reference-list.mjs';
import { statFindings } from './stat-consistency.mjs';

// Wording that states more certainty than a systematic review can carry. The
// list is deliberately short and specific: a long list of hedging words trains
// the author to ignore the check.
const OVERCONFIDENT = [
  'proves', 'proven', 'proof that', 'confirms that', 'confirmed that',
  'definitively', 'conclusively', 'unequivocally', 'undoubtedly',
  'clearly demonstrates', 'establishes that', 'guarantees',
];

// An abbreviation is defined by "Full Name (ABC)" somewhere before its use.
const ABBREV = /\b([A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/g;
const DEFINITION = /\(([A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\)/g;

// Tokens that look like abbreviations but are units, statistics, sources or
// conventions a reader already knows.
const KNOWN = new Set([
  'CI', 'HR', 'RR', 'OR', 'RD', 'SD', 'IQR', 'SE', 'PRISMA', 'GRADE', 'PICO',
  'RoB', 'JBI', 'DOI', 'PMID', 'NCT', 'IPD', 'KM', 'REML', 'ITT', 'NA',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  'PubMed', 'MeSH', 'OpenAlex', 'ClinicalTrials', 'Crossref', 'MEDLINE',
]);

/**
 * A proper noun with internal capitals is not an abbreviation: "PubMed" has two
 * capitals and seven letters, "GTR" has three of three. Requiring capitals to
 * be at least half the letters separates the two without a word list.
 */
function looksAbbreviated(token) {
  const letters = token.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return caps * 2 >= letters.length;
}

// Crossref update types that question a work rather than correct it.
const QUESTIONED = /retract|concern|withdraw|remov/i;
// Preprint servers, as they appear in a record's journal or source field.
const PREPRINT = /\b(medRxiv|bioRxiv|Research Square|SSRN|arXiv)\b/i;
const REFERENCE_AGE = 10;
// A title this short matches too many unrelated works to count as a duplicate.
const MIN_TITLE_KEY = 25;

const issue = (severity, kind, message, where = {}) =>
  ({ severity, kind, message, ...where });

/** "family f" for an author name: the granularity at which two lists share a person. */
function authorKey(name) {
  const ini = initials(name, { comma: true }).split(',')[1] || '';
  return `${familyName(name).toLowerCase()} ${ini.trim().slice(0, 1).toLowerCase()}`;
}

/**
 * @param blocks   the document
 * @param library  records available to cite, by key
 * @param values   result keys currently available, the snapshot the document
 *                 was written against, the manuscript's own author names and
 *                 the date reference ages are measured from; `citationCheck` is the
 *                 manuscript's saved links and registry answers for its typed
 *                 reference list, and `citationResult` that check already run
 *                 (lib/reference-list.mjs checkCitations), so a view does it once;
 *                 `flow` the review's flow numbers (lib/flow-numbers.mjs reviewFlowNumbers),
 *                 each checked against the numbers the text states (flowNumberRows)
 */
export function checkManuscript(blocks, { library = [], results = [], snapshot = {}, authors = [], today = new Date(), citationCheck = {}, citationResult = null, flow = null } = {}) {
  const out = [];
  const byKey = new Map(library.map(p => [p.key, p]));
  const resultByKey = new Map(results.map(r => [r.key, r]));
  const checkedOrigins = new Set();

  // ---- citations --------------------------------------------------------
  const cited = new Set();
  const firstCited = new Map();   // key -> block of its first citation
  for (const b of blocks) {
    for (const c of citations(b.text)) {
      cited.add(c.key);
      if (!firstCited.has(c.key)) firstCited.set(c.key, b.id);
      if (!byKey.has(c.key))
        out.push(issue('error', 'citation', `No record for ${c.key}`,
          { blockId: b.id, text: c.key }));
    }
  }

  // A record that was screened in but never cited is a gap in the write-up,
  // not an error in the document, so it is reported as a note.
  const included = library.filter(p => p.included);
  for (const p of included)
    if (!cited.has(p.key))
      out.push(issue('note', 'uncited', `${p.label || p.key} is included but not cited`,
        { text: p.key }));

  // ---- reference list ---------------------------------------------------
  const refs = [...cited].map(k => byKey.get(k)).filter(Boolean);
  const at = p => ({ blockId: firstCited.get(p.key), text: p.key });
  const name = p => p.label || p.key;

  for (const p of refs) {
    for (const n of p.integrity?.notices || [])
      if (QUESTIONED.test(n.type || '')) {
        const type = String(n.type).replace(/_/g, ' ');
        out.push(issue('error', 'retracted', `${name(p)} has ${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type} notice`, at(p)));
      }
    if (PREPRINT.test(p.journal || '') || PREPRINT.test(p.source || ''))
      out.push(issue('note', 'preprint', `${name(p)} is a preprint`, at(p)));
  }

  const unidentified = refs.filter(p => !p.doi && !p.pmid).length;
  if (unidentified)
    out.push(issue('note', 'reference-doi', `${unidentified} cited ${unidentified === 1 ? 'reference has' : 'references have'} no DOI or PMID`));

  // Age is judged by year only; a list that leans on old work is worth a
  // second look, but a short list says nothing either way.
  if (refs.length >= 5) {
    const cutoff = today.getFullYear() - REFERENCE_AGE;
    const old = refs.filter(p => Number(p.year) > 0 && Number(p.year) < cutoff).length;
    if (old * 2 > refs.length)
      out.push(issue('note', 'reference-age', `${old} of ${refs.length} cited references are older than ${REFERENCE_AGE} years`));
  }

  const own = new Set(authors.filter(Boolean).map(authorKey));
  if (own.size) {
    const shared = refs.filter(p => authorList(p.authors).some(a => own.has(authorKey(a)))).length;
    if (shared)
      out.push(issue('note', 'self-citation', `${shared} cited ${shared === 1 ? 'reference shares' : 'references share'} an author with this paper`));
  }

  // Two keys for one work: the same DOI, or the same title once punctuation
  // and case are gone. The pair is reported once, against the first key.
  for (let i = 0; i < refs.length; i++) {
    const a = refs[i], doiA = String(a.doi || '').toLowerCase(), titleA = titleKey(a.title);
    for (let j = i + 1; j < refs.length; j++) {
      const b = refs[j];
      const sameDoi = doiA && doiA === String(b.doi || '').toLowerCase();
      const sameTitle = titleA.length >= MIN_TITLE_KEY && titleA === titleKey(b.title);
      if (sameDoi || sameTitle)
        out.push(issue('warn', 'duplicate-record', `${name(a)} and ${name(b)} look like the same work`, at(a)));
    }
  }

  // ---- a typed reference list and its citations (plan §4.11c) ----------
  // A document cited from Word ("[12]", "(Smith et al., 2020)") with its list
  // typed: the list, the markers, the library and the registries' answers.
  out.push(...(citationResult || checkCitations(blocks, { library, citationCheck })).issues);

  // ---- linked results ---------------------------------------------------
  for (const b of blocks) {
    for (const t of resultTokens(b.text)) {
      // Notes, captions, cross-references and page fields are the document's own.
      if (isDocToken(t.key)) continue;
      const r = resultByKey.get(t.key);
      if (!r) {
        out.push(issue('error', 'result', `No result named ${t.key}`,
          { blockId: b.id, text: t.key }));
        continue;
      }
      if (r.inputStatus === 'stale' && !checkedOrigins.has(t.key)) {
        out.push(issue('warn', 'source-stale', `${r.label} needs a new analysis run`,
          { blockId: b.id, text: t.key }));
        checkedOrigins.add(t.key);
      } else if (r.inputStatus === 'untracked' && !checkedOrigins.has(t.key)) {
        out.push(issue('note', 'source-untracked', `${r.label} has no saved input record`,
          { blockId: b.id, text: t.key }));
        checkedOrigins.add(t.key);
      }
      // The document was written against a value; the analysis has since
      // produced a different one (plan J7).
      const was = snapshot[t.key];
      if (was != null && was !== r.text)
        out.push(issue('warn', 'stale',
          `${r.label} was ${was}, now ${r.text}`, { blockId: b.id, text: t.key }));
    }
  }

  // ---- numbers typed instead of linked ----------------------------------
  // A result's exact text appearing as literal prose is almost always a number
  // that was copied rather than linked, which is what goes stale silently.
  for (const b of blocks) {
    const bare = b.text.replace(/\{\{[^}]*\}\}/g, ' ');
    for (const r of results) {
      if (!r.text || r.text.length < 3) continue;
      if (!/\d/.test(r.text)) continue;
      if (bare.includes(r.text))
        out.push(issue('warn', 'unlinked',
          `"${r.text}" is typed in; ${r.label} could be linked`,
          { blockId: b.id, text: r.key }));
    }
  }

  // ---- statistics: P against its test, an interval against its estimate, a percentage against its count (lib/stat-consistency.mjs)
  for (const b of blocks)
    if (b.type === 'p' || b.type === 'quote')
      for (const f of statFindings(b.text))
        out.push(issue('warn', 'statistics', f.message, { blockId: b.id, text: f.text, at: f.at }));

  // ---- abbreviations ----------------------------------------------------
  const defined = new Set(KNOWN);
  for (const b of blocks)
    for (const m of b.text.matchAll(DEFINITION)) defined.add(m[1]);
  // A word set in capitals is still a word: "STUDY" in a heading is not an
  // abbreviation when "study" appears in the text. Headings are skipped
  // outright, since they are the usual place for capitals.
  const lower = new Set();
  for (const b of blocks) for (const w of b.text.toLowerCase().match(/[a-z]{2,}/g) || []) lower.add(w);
  const flagged = new Set();
  for (const b of blocks) {
    if (b.type !== 'p' && b.type !== 'quote') continue;
    const bare = b.text.replace(/\([^)]*\)/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ');
    for (const m of bare.matchAll(ABBREV)) {
      const a = m[1];
      if (defined.has(a) || flagged.has(a) || !looksAbbreviated(a) || lower.has(a.toLowerCase())) continue;
      flagged.add(a);
      out.push(issue('note', 'abbreviation', `${a} is not defined`,
        { blockId: b.id, text: a }));
    }
  }

  // ---- wording ----------------------------------------------------------
  const hits = new Map();
  for (const b of blocks) {
    const lc = b.text.toLowerCase();
    for (const word of OVERCONFIDENT)
      if (lc.includes(word)) {
        const h = hits.get(word) || { n: 0, blockId: b.id };
        h.n++; hits.set(word, h);
      }
  }
  for (const [word, h] of hits)
    out.push(issue('warn', 'wording', `"${word}" overstates what a review shows${h.n > 1 ? ` (${h.n} places)` : ''}`,
      { blockId: h.blockId, text: word }));

  // ---- structure --------------------------------------------------------
  const headings = blocks.filter(b => b.type === 'h2').map(b => b.text.trim().toLowerCase());
  // A case report presents its case in place of methods and results (CARE).
  const caseReport = headings.some(h => h.includes('case presentation'));
  for (const need of caseReport ? ['case presentation', 'discussion'] : ['methods', 'results'])
    if (!headings.some(h => h.includes(need)))
      out.push(issue('note', 'structure', `No ${need} section`));

  const empty = sections(blocks).filter(s =>
    s.heading && s.blocks.every(b => !b.text.trim()));
  for (const s of empty)
    out.push(issue('note', 'structure', `${s.heading.text || 'Untitled'} is empty`,
      { blockId: s.heading.id }));

  // ---- the word count the title page states -----------------------------
  const wc = wordCountCheck(blocks);
  if (wc && !wc.ok) out.push(issue('warn', 'title-page', wc.message, { blockId: wc.blockId }));

  // ---- the flow numbers the text states, against the project and the figure (`flow`: lib/flow-numbers.mjs reviewFlowNumbers)
  if (flow?.length) for (const r of flowNumberRows(blocks.map(b => b.text || ''), flow))
    if (!r.ok) out.push(issue('warn', 'flow', r.message, r.at != null ? { blockId: blocks[r.at].id } : {}));

  return out;
}

// ---- flow numbers ------------------------------------------------------------------------------------------------------
// What a number in the text counts in the flow, by the words after it and, for some phrasings, before it: [before or null, after], both to
// fit. The first box that fits wins, so "sought" comes before the bare "full-text reports" of assessed. lib/cross-checks.mjs reads the
// built Word file's checked numbers by the same words.
const FLOW_WORDS = [
  ['identified', [[null, /^\s*(?:(?:unique|deduplicated)\s+)?(?:records?|citations?)\s+(?:were\s+)?identified\b/i],
    [/\b(?:searches|search)\s+(?:identified|returned|yielded)\s+(?:a\s+total\s+of\s+)?$/i, /^\s*(?:(?:unique|potentially\s+relevant)\s+)?(?:records?|citations?|references?|articles?)\b/i]]],
  ['duplicates', [[null, /^\s*duplicate(?:s|\s+(?:records?|reports?|citations?))\b/i]]],
  ['screened', [[null, /^\s*(?:(?:unique|deduplicated|remaining|database|and|registry|register|registers)\s+){0,4}(?:records?|titles?(?:\s+and\s+abstracts?)?|citations?|articles?)\s+(?:were\s+)?screened\b/i],
    [null, /^\s*screened\s+records?\b/i],
    [/\bscreened\s+(?:the\s+)?(?:titles?\s+and\s+abstracts?\s+of\s+)?$/i, /^\s*(?:(?:unique|deduplicated|remaining)\s+)?(?:records?|titles?|citations?|articles?|abstracts?)\b/i]]],
  ['sought', [[null, /^\s*(?:full[- ]text\s+)?(?:reports?|articles?|papers?|records?)\s+(?:were\s+)?sought\b/i]]],
  ['assessed', [[null, /^\s*(?:full[- ]text\s+)?(?:reports?|articles?|papers?|records?)\s+(?:were\s+)?(?:assessed|reviewed|read)\b/i],
    [null, /^\s*full[- ]text\s+(?:reports?|articles?|papers?)\b(?!\s+(?:were\s+)?sought)/i],
    [null, /^\s*were\s+assessed\s+(?:in\s+full(?:[- ]text)?|for\s+eligibility|at\s+full[- ]text)\b/i]]],
  ['studies', [[null, /^\s*(?:randomi[sz]ed\s+(?:controlled\s+)?)?(?:trials|studies|RCTs)\s+(?:were\s+)?included\b/i], [null, /^\s*included\s+(?:trials|studies|RCTs)\b/i],
    [/\b(?:we\s+)?included\s+(?:a\s+total\s+of\s+)?$/i, /^\s*(?:randomi[sz]ed\s+(?:controlled\s+)?)?(?:trials|studies|RCTs)\b/i]]],
  ['reports', [[null, /^\s*reports?\s+(?:of\s+\d[\d,]*\s+(?:trials|studies)\s+)?(?:were\s+)?included\b/i], [null, /^\s*included\s+reports\b/i]]],
];
// what follows a box's words and makes it a subset or a method, not the box: "were included in the meta-analysis", "were screened by two reviewers"
// the same as lib/flow-numbers.mjs NOT_BOX (kept apart so these checks load no more modules; app/test/flow-numbers.test.mjs keeps them
// equal): 17 Nov 2026, this copy lacked the 15 Nov subset clauses, so Sham's "the 48 included studies that could not enter the primary
// analysis" read as a second count of the studies included
export const NOT_BOX = /^\s*(?:by\b|in\s+duplicate|independently|twice|again|in\s+(?:the|a|an|each)\s+(?!(?:systematic\s+)?review\b)|in\s+(?:primary|meta|pooled|sensitivity|subgroup)|for\s+(?:the\s+)?(?:primary|meta|pooled|analysis)|(?:that|which|who|whose)\s+(?:\w+\s+){0,2}not\b|(?:not|never)\s+(?:in|pooled|entered|entering|included\s+in|analysed|analyzed)\b|outside\b|excluded\s+from\b)/i;
// a number after "when" or "if" is a condition, not a count: "When 2 included reports shared patients, the one with ..."
const NOT_COUNT = /\b(?:when|whenever|if|unless)\s+$/i;
const COUNT = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?!\d|[.,]\d)/g;

/** The flow numbers one text states: [{ box, n }] in the order they appear. */
function flowMentions(text) {
  const t = String(text || ''), out = [];
  for (const m of t.matchAll(COUNT)) {
    const end = m.index + m[0].length, after = t.slice(end, end + 80), before = t.slice(Math.max(0, m.index - 40), m.index);
    if (NOT_COUNT.test(before)) continue;
    const box = FLOW_WORDS.find(([, ways]) => ways.some(([b, a]) => {
      if (b && !b.test(before)) return false;
      const x = a.exec(after);
      return x && !NOT_BOX.test(after.slice(x.index + x[0].length));
    }));
    if (box) out.push({ box: box[0], n: Number(m[1].replace(/,/g, '')) });
  }
  return out;
}

const countText = n => n.toLocaleString('en-US');
const sideText = (x, where) => (x ? `${countText(x.total)} in ${where}${x.parts ? ` (${x.parts.map(countText).join(' + ')})` : ''}` : `no count in ${where}`);
/**
 * One check row per flow number (Fable review F8, 8 Nov 2026): `texts` the manuscript's paragraphs, `numbers` lib/flow-numbers.mjs
 * reviewFlowNumbers. [{ id, label, text, project, figure, ok, at, message }]: `text` the numbers the text gives it, `at` the index of the
 * paragraph to look at (a number that does not fit, else the first). A number fits the project and the figure as a total or as one column;
 * the row agrees when every number the text gives fits both and the project and the figure have the same total.
 */
export function flowNumberRows(texts, numbers = []) {
  const found = new Map();
  (texts || []).forEach((t, at) => { for (const m of flowMentions(t)) found.set(m.box, [...(found.get(m.box) || []), { n: m.n, at }]); });
  return (numbers || []).map(x => {
    const mentions = found.get(x.id) || [], text = [...new Set(mentions.map(m => m.n))];
    const values = side => (side ? [side.total, ...(side.parts || [])] : null), pv = values(x.project), fv = values(x.figure);
    const fits = n => (!pv || pv.includes(n)) && (!fv || fv.includes(n));
    const ok = text.every(fits) && !(x.project && x.figure && x.project.total !== x.figure.total);
    return { id: x.id, label: x.label, text, project: x.project, figure: x.figure, ok, at: (mentions.find(m => !fits(m.n)) || mentions[0])?.at ?? null,
      message: `${x.label}: ${text.length ? `${text.map(countText).join(' and ')} in the text` : 'not in the text'}, ${sideText(x.project, 'the project')}, ${sideText(x.figure, 'the figure')}` };
  });
}

/** The count a title page states: "main text 4498" (or "Word count: … main text 4,498"). null when none. */
export const statedWords = text => { const m = /main text[:\s]+([\d,]{2,})\b/i.exec(text); return m ? Number(m[1].replace(/,/g, '')) : null; };
/** The word-count row's words, for the in-app manuscript and a registered Word file's two numbers (tools/lykos-completeness.mjs). */
export const wordCountMessage = (counted, stated) => `Main text ${counted} words; the title page states ${stated}`;
/**
 * The main text's words against the count the title page states (Fable review F26, 8 Nov 2026: Sham's title page said 4,467 where the
 * text measured 4,481): { stated, counted, ok, message, blockId } for the first block that states a count, or null. `counted` is
 * counts(blocks).total, the journal's count.
 */
export function wordCountCheck(blocks) {
  const b = blocks.find(x => statedWords(x.text || '') != null);
  if (!b) return null;
  const stated = statedWords(b.text), counted = counts(blocks).total;
  return { stated, counted, ok: stated === counted, message: wordCountMessage(counted, stated), blockId: b.id };
}

/** Word count per section, for the limits a journal sets. */
export function counts(blocks) {
  // A journal's count: the main text, section by section, without the title,
  // abstract, back matter, references, legends or tables (plan §4.11a).
  const c = documentCounts(blocks), s = structureCounts(blocks);
  return { total: s.main.words, chars: c.chars, charsNoSpaces: c.charsNoSpaces, references: c.references,
    sections: s.main.sections.map(x => ({ name: x.name, words: x.words })) };
}


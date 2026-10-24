// What a project's documents say about figures, as facts: the legends that are
// written, the figures that are cited (by kind), the legends still holding a
// placeholder, the sentences that ask for a figure, and the guide lines that
// declare an output behind (plan §4.15c.6, rules M1, M2, R1 and the `declared`
// kind of T2).
//
// Pure: text in, plain objects out. No clock, no locale, no model, no read of
// any file. Vocabulary and numbers come from lib/figure-lexicon.mjs; the
// grammar of "Figure 2", "Figs. 7-9" and "Tables S1-S12" is the one of
// lib/submission-checks.mjs (`literalMentions`), so a bare S12 in
// "Tables S1-S12" is a Table S mention, never a reference to S12.png.

import { literalMentions } from './submission-checks.mjs';
import { PARAMS, FIGURE_NOUNS, ASK_STRONG, ASK_WEAK, DRAW_VERBS, DRAW_PASSIVE, NEW_FIGURE_WORDS, REQUEST_SKIP, FORMER_WORDS, RESPONSE_MARKERS, COMMENT_MARKERS, PLACEHOLDER_WORDS, DECLARED_STALE, EXTENSION_CLASSES, SCOPE_CLAUSE, ABBREVIATIONS, DECLARATION_STOP_WORDS, FUNCTION_WORDS } from './figure-lexicon.mjs';

const whole = list => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
const wholeAll = list => new RegExp(`\\b(?:${list.join('|')})\\b`, 'gi');

const NOUN_RE = wholeAll(FIGURE_NOUNS);
const ASK_STRONG_RE = wholeAll(ASK_STRONG);
const ASK_WEAK_RE = wholeAll(ASK_WEAK);
const DRAW_VERB_RE = wholeAll(DRAW_VERBS);
const DRAW_PASSIVE_RE = whole(DRAW_PASSIVE);
const NEW_FIGURE_RE = whole(NEW_FIGURE_WORDS);
const SKIP_RE = new RegExp(`(?:${REQUEST_SKIP.join('|')})`, 'i');
const FORMER_RE = wholeAll(FORMER_WORDS);
const PLACEHOLDER_RE = whole(PLACEHOLDER_WORDS);
const ABBREV = new Set(ABBREVIATIONS);
const STOP = new Set([...DECLARATION_STOP_WORDS, ...FUNCTION_WORDS]);

const paragraphs = text => String(text ?? '').split('\n');
const squash = s => s.replace(/\s+/g, ' ').trim();
// Citation tokens and result tokens are not words of the text; blanked in place so offsets stay.
const blank = t => t.replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, m => ' '.repeat(m.length));

const KIND_PREFIX = { figure: 'Figure ', 'supp-figure': 'Figure S', table: 'Table ', 'supp-table': 'Table S' };

/** Lower case, letters and digits only: the form two copies of one sentence share. */
export function normaliseSentence(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ').trim();
}

/** A short deterministic hash of a normalised sentence (cyrb53, 14 hex digits). Not cryptographic; it only dedupes. */
export function sentenceKey(s) {
  const str = normaliseSentence(s);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ---- sentences ----------------------------------------------------------------------

/**
 * Sentences of a text. A line break always ends one (a paragraph is not
 * joined to the next), a full stop ends one when a capital or a digit follows
 * and the word before it is not an abbreviation ("Fig. 7", "e.g.", "et al."),
 * and, as reviewers' files are often joined carelessly, when a capitalised
 * word follows with no space ("future.Yours"). A decimal ("0.59") never ends one.
 */
export function splitSentences(text) {
  const out = [];
  for (const para of paragraphs(text)) {
    const s = para.replace(/\r$/, '');
    for (const [from, to] of spansOf(s)) { const piece = squash(s.slice(from, to)); if (piece) out.push(piece); }
  }
  return out;
}

// [from, to) of each sentence in one paragraph.
function spansOf(s) {
  const spans = [];
  const end = /[.!?]+["')\]\u201d\u2019]*/g;
  let start = 0, m;
  while ((m = end.exec(s))) {
    const stop = m.index + m[0].length, next = s[stop];
    let boundary = false;
    if (next === undefined) boundary = true;
    else {
      const strong = /[!?]/.test(m[0]);
      const word = (s.slice(0, m.index).match(/([A-Za-z][A-Za-z.]*)$/) || [])[1] || '';
      const initial = /(^|[^A-Za-z])[A-Z]$/.test(s.slice(0, m.index));
      const abbreviation = !strong && (ABBREV.has(word.toLowerCase()) || initial);
      if (/\s/.test(next)) {
        const rest = s.slice(stop).trimStart();
        boundary = !abbreviation && (strong || /^[A-Z0-9"'\u201c\u2018([]/.test(rest));
      } else {
        boundary = !abbreviation && /^[A-Z][a-z]/.test(s.slice(stop, stop + 2)) && /[a-z]{2}$/.test(word) && /[a-z\d)\]]$/.test(s.slice(0, m.index));
      }
    }
    if (boundary) { spans.push([start, stop]); start = stop; }
  }
  if (start < s.length) spans.push([start, s.length]);
  return spans;
}

// ---- legends ------------------------------------------------------------------------

const FIGURE_LEGEND = /^\s*Fig(?:ure)?s?\.?\s*(S?)(\d+)[A-Za-z]?\s*(?:[.:]|\s[\u2013\u2014-]\s|(?=\[))/i;
// A figure or table caption, as lib/submission-checks.mjs reads it: the paragraph is not a citation.
const ANY_LEGEND = /^\s*(?:fig(?:ure)?s?\.?|table)\s*S?\d+[a-z]?\s*(?:[.:|]|\s[\u2013\u2014-]\s|(?=\[))/i;

/**
 * The figure legends of a text: paragraphs that begin "Figure 3." or
 * "Figure S2:". Each is `{ kind, n, label, text, para }` (`para` is the index
 * of the paragraph in the text).
 */
export function legendParagraphs(text) {
  const out = [];
  paragraphs(text).forEach((p, para) => {
    const m = blank(p).match(FIGURE_LEGEND);
    if (!m) return;
    const kind = m[1] ? 'supp-figure' : 'figure', n = Number(m[2]);
    out.push({ kind, n, label: `${KIND_PREFIX[kind]}${n}`, text: p.trim(), para });
  });
  return out;
}

/**
 * Legends that still hold a placeholder: a bracket in a figure legend that
 * contains a lexicon word ("[to be added]", "[add legend]"). A bracket
 * elsewhere in the text, and a bracket without such a word ("[12]",
 * "[95% CI]"), is not one. Each is `{ kind, n, label, bracket, text, para }`.
 */
export function placeholderLegends(text) {
  const out = [];
  for (const lg of legendParagraphs(text)) {
    for (const b of blank(lg.text).matchAll(/\[([^\]]*)\]/g)) {
      if (PLACEHOLDER_RE.test(b[1])) { out.push({ ...lg, bracket: b[0] }); break; }
    }
  }
  return out;
}

// ---- mentions -----------------------------------------------------------------------

// The start of a written-out label; the grammar of what follows it is literalMentions'.
const CANDIDATE = /\b(?:Fig(?:ure)?s?\.?|Tables?)\s*S?\d/gi;
// "Supplementary Figure 11" is a supplement figure whatever the number; the word sits just before the label.
const SUPP_BEFORE = /\b(?:supplement(?:ary|al)|suppl?\.?)[\s-]*$/i;
// The written label in the one capitalisation and spacing the shared grammar reads ("figure 2", "Fig.6").
const canonicalHead = slice => slice.replace(/^([A-Za-z]+\.?)\s*(?=S?\d)/, (_, h) => `${h[0].toUpperCase()}${h.slice(1).toLowerCase()} `);
const LIST_TAIL = /^(?:\s*(?:,|and|&|–|-|to)\s*S?\d+[A-Za-z]?)*/;

/**
 * Figures and tables cited in a text, each with its kind: `{ kind, n, label, at, end, para }`
 * where `kind` is figure, supp-figure, table or supp-table (ranges are
 * expanded: "Tables S1-S12" is twelve supp-table mentions and no figure).
 * A caption paragraph is not a citation, and neither is a label within
 * PARAMS.FORMER_WINDOW characters of "former", "removed", "dropped" or "old"
 * (pass `{ legends: true }` to keep the captions). `at` and `end` are offsets in
 * the text; every mention of one written label shares them.
 */
export function mentionsOf(text, options = {}) {
  const out = [];
  let offset = 0;
  paragraphs(text).forEach((raw, para) => {
    const here = offset; offset += raw.length + 1;
    const p = blank(raw);
    if (!options.legends && ANY_LEGEND.test(p)) return;
    const sentences = spansOf(p);
    const former = [...p.matchAll(FORMER_RE)].map(m => ({ from: m.index, to: m.index + m[0].length }));
    const starts = [...p.matchAll(CANDIDATE)].map(m => ({ at: m.index, head: m[0].length }));
    starts.forEach((c, i) => {
      const slice = p.slice(c.at, i + 1 < starts.length ? starts[i + 1].at : p.length);
      const supp = SUPP_BEFORE.test(p.slice(Math.max(0, c.at - 20), c.at));
      const found = literalMentions(canonicalHead(slice)).map(f => (supp && (f.kind === 'figure' || f.kind === 'table') ? { ...f, kind: `supp-${f.kind}` } : f));
      if (!found.length) return;
      const end = c.at + c.head + slice.slice(c.head).match(LIST_TAIL)[0].length;
      const w = PARAMS.FORMER_WINDOW;
      // The window stops at the end of the sentence the label is in.
      const [lo, hi] = sentences.find(([from, to]) => c.at >= from && c.at < to) || [0, p.length];
      if (former.some(f => f.from >= lo && f.to <= hi && ((f.from >= c.at - w && f.to <= c.at) || (f.from >= end && f.to <= end + w)))) return;
      for (const f of found) out.push({ kind: f.kind, n: f.n, label: `${KIND_PREFIX[f.kind]}${f.n}`, at: here + c.at, end: here + end, para });
    });
  });
  return out;
}

// ---- requests -----------------------------------------------------------------------

const RESPONSE_START = new RegExp(`^\\s*(?:${RESPONSE_MARKERS.join('|')})\\s*[:\\u2013\\u2014]\\s*`, 'i');
const RESPONSE_INLINE = new RegExp(`(^|[.!?)\\]]\\s*|\\s)(?:${RESPONSE_MARKERS.join('|')})\\s*:\\s*`, 'i');
// A new point: "Reviewer 2", "Comment 3:", "R1.2:", "4. The authors ..." (a bare word is not enough).
const COMMENT_START = new RegExp(
  `^\\s*(?:(?:${COMMENT_MARKERS.join('|')})\\s*(?:#|no\\.?)?\\s*(?:\\d+(?:\\.\\d+)*[a-z]?|[ivx]+)?\\s*(?:[:.)\\u2013\\u2014-]|$)|\\d+(?:\\.\\d+)*[.)]\\s)`, 'i');

// The label a point carries ("Comment 1:", "Reviewer 2", "R1.2:", "4."), removed from its text.
const COMMENT_LABEL = new RegExp(
  `^\\s*(?:(?:${COMMENT_MARKERS.join('|')})\\s*(?:#|no\\.?)?\\s*(?:\\d+(?:\\.\\d+)*[a-z]?|[ivx]+)?\\s*(?:[:.)\\u2013\\u2014-]\\s*|$)|\\d+(?:\\.\\d+)*[.)]\\s+)`, 'i');

// Points as { comment, response } paragraph lists, in order. A paragraph that begins
// "Response:" (or holds it after the comment's last sentence) opens the answer; the
// next paragraph that begins a point closes it.
const unlabel = p => p.replace(COMMENT_LABEL, '').trim();

function points(text) {
  const out = [];
  let cur = { comment: [], response: [] }, state = 'comment';
  const close = () => { if (cur.comment.length || cur.response.length) out.push(cur); cur = { comment: [], response: [] }; state = 'comment'; };
  for (const raw of paragraphs(text)) {
    const p = raw.replace(/\r$/, '').trim();
    if (!p) continue;
    const head = p.match(RESPONSE_START);
    if (head) { state = 'response'; const rest = p.slice(head[0].length).trim(); if (rest) cur.response.push(rest); continue; }
    if (state === 'comment') {
      const inline = p.match(RESPONSE_INLINE);
      if (inline) {
        const before = p.slice(0, inline.index + inline[1].length).trim();
        if (unlabel(before)) cur.comment.push(unlabel(before));
        state = 'response';
        const rest = p.slice(inline.index + inline[0].length).trim();
        if (rest) cur.response.push(rest);
      } else cur.comment.push(unlabel(p));
    } else if (COMMENT_START.test(p)) { close(); cur.comment.push(unlabel(p)); } else cur.response.push(p);
  }
  close();
  return out;
}

/**
 * Does one sentence ask for a new figure? `{ nouns, asks }` or null.
 * A noun followed by a number is a reference, and a sentence that cites an existing figure revises it ("The forest plot
 * in Figure 4 should show ...") unless it says new, additional or another. A weak ask (please, need, must, should,
 * consider) counts only with a drawing verb: before the noun ("please add a flow chart") or passive after it
 * ("a flow chart should be added"). "Please explain the funnel plot asymmetry" is no request.
 */
export function requestIn(sentence) {
  if (SKIP_RE.test(sentence)) return null;
  const nouns = [];
  let first = Infinity;
  for (const m of sentence.matchAll(NOUN_RE)) {
    if (/^\s*S?\d/.test(sentence.slice(m.index + m[0].length))) continue;
    nouns.push(m[0].toLowerCase());
    first = Math.min(first, m.index);
  }
  if (!nouns.length) return null;
  const cites = mentionsOf(sentence, { legends: true }).some(m => m.kind === 'figure' || m.kind === 'supp-figure');
  if (cites && !NEW_FIGURE_RE.test(sentence)) return null;
  const strong = [...sentence.matchAll(ASK_STRONG_RE)].map(m => m[0].toLowerCase());
  const weak = [...sentence.matchAll(ASK_WEAK_RE)].map(m => m[0].toLowerCase());
  const drawn = [...sentence.matchAll(DRAW_VERB_RE)].some(m => m.index < first) || DRAW_PASSIVE_RE.test(sentence);
  const asks = [...strong, ...(drawn ? weak : [])];
  if (!asks.length) return null;
  return { nouns: [...new Set(nouns)], asks: [...new Set(asks)] };
}

/**
 * Sentences of the comment half of a point that ask for a figure, from the
 * reviewers' comment text and from the response document (which usually quotes
 * the comments). The split is by paragraph at the "Response:" marker: only what
 * comes before it is read, so "we have added a forest plot" in an answer is no
 * request. A request found in both texts is one sentence (same normalised
 * hash). Each result is `{ key, text, nouns, asks, from, response }`: `from`
 * lists the texts that held it ('comment', 'response') and `response` is the
 * answer that followed it, the empty string when there is none.
 */
export function requestSentences(commentText, responseText = '') {
  const found = new Map();
  for (const [from, text] of [['comment', commentText], ['response', responseText]]) {
    for (const pt of points(text)) {
      const answer = pt.response.join('\n');
      for (const sentence of splitSentences(pt.comment.filter(Boolean).join('\n'))) {
        const req = requestIn(sentence);
        if (!req) continue;
        const key = sentenceKey(sentence), had = found.get(key);
        if (had) { if (!had.from.includes(from)) had.from.push(from); if (!had.response && answer) had.response = answer; }
        else found.set(key, { key, text: sentence, ...req, from: [from], response: answer });
      }
    }
  }
  return [...found.values()];
}

// ---- guide declarations -------------------------------------------------------------

const DECLARED = DECLARED_STALE.map(d => ({ id: d.id, re: new RegExp(`\\b${d.source}`, 'i') }));
const CLASSES = EXTENSION_CLASSES.map(c => ({ ...c, re: new RegExp(c.noun, 'i') }));
const SCOPE_RE = new RegExp(SCOPE_CLAUSE, 'i');
const classWords = new Set(['pdf', 'pdfs', 'png', 'jpg', 'jpeg', 'svg', 'docx', 'xlsx', 'csv', 'images', 'image']);

function declarationOf(unit, line) {
  for (const d of DECLARED) {
    const m = unit.match(d.re);
    if (!m) continue;
    const subject = unit.slice(0, m.index);
    const classes = CLASSES.filter(c => c.re.test(subject));
    const scope = (unit.match(SCOPE_RE) || [null])[0];
    let rest = unit.replace(m[0], ' ');
    if (scope) rest = rest.replace(scope, ' ');
    const tokens = [...new Set((rest.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])
      .filter(t => !STOP.has(t) && !classWords.has(t) && !/^v\d+$/.test(t)))];
    return {
      line, text: unit, rule: d.id, matched: m[0], fenced: false,
      classes: classes.map(c => c.id),
      ext: classes.length ? [...new Set(classes.flatMap(c => c.ext))] : null,
      pages: classes.some(c => c.pages),
      scope, tokens,
    };
  }
  return null;
}

/**
 * Lines of a guide (an AGENTS.md) that declare an output behind. The unit is a
 * whole list item (continuation lines joined) or a sentence of a paragraph,
 * never a bare token; headings and blank lines are not read, and a fenced block
 * is read line by line (`fenced: true`), since a guide's folder tree holds notes.
 * Each result is `{ line, text, rule, matched, fenced, classes, ext, pages, scope, tokens }`:
 * `line` is the 1-based line where the unit begins, `ext` the extensions of the
 * file class named before the phrase ("PDF reports" gives .pdf, with `pages`
 * true for the page images of the same stem family; null when no class is
 * named), `scope` a limiting clause such as "after Round 13", and `tokens` the
 * identifying words left once stop words, class words and version tokens are
 * removed. Which files a declaration binds to is decided by the caller, from
 * `ext` and `tokens`.
 */
export function declarationItems(guideText) {
  const lines = String(guideText ?? '').split('\n');
  const out = [];
  let fence = false, unit = null;
  const flush = () => {
    if (!unit) return;
    const { line, parts, list } = unit; unit = null;
    const joined = squash(parts.join(' '));
    if (!joined) return;
    if (list) { const d = declarationOf(joined, line); if (d) out.push(d); return; }
    // A paragraph: each sentence on its own, at the line it starts.
    let cursor = 0;
    const starts = [];
    parts.forEach((p, i) => { starts.push({ at: cursor, line: line + i }); cursor += squash(p).length + 1; });
    let from = 0;
    for (const sentence of splitSentences(joined)) {
      const at = joined.indexOf(sentence, from); from = at + sentence.length;
      const row = [...starts].reverse().find(s => s.at <= at) || starts[0];
      const d = declarationOf(sentence, row.line);
      if (d) out.push(d);
    }
  };
  lines.forEach((raw, i) => {
    const no = i + 1, t = raw.replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(t)) { flush(); fence = !fence; return; }
    // A fenced block is read line by line: a guide's folder tree carries notes such as "still labelled v12".
    if (fence) { const d = declarationOf(squash(t.replace(/[\u2500-\u257f|]/g, ' ')), no); if (d) out.push({ ...d, fenced: true }); return; }
    if (!t.trim() || /^#{1,6}\s/.test(t)) { flush(); return; }
    if (/^\s*\|/.test(t)) { flush(); const d = declarationOf(squash(t.replace(/\|/g, ' ')), no); if (d) out.push(d); return; }
    const item = t.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) { flush(); unit = { line: no, parts: [item[1]], list: true }; return; }
    if (unit) unit.parts.push(t.trim()); else unit = { line: no, parts: [t.trim()], list: false };
  });
  flush();
  return out;
}

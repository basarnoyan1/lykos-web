// The manuscript document: blocks, citations, and linked results.
//
// Plan J1 specifies Tiptap/ProseMirror. Measured, a Tiptap editor is 42 npm
// packages and 8.0 MiB unpacked, for what J1 itself scopes as "selection-based
// suggestions, not a full word-processor clone". What this module actually
// needs is a block list with stable ids, two inline node types, and a content
// hash per block — so it is built here, the same trade §4.6 makes for the
// PRISMA diagram. See §4.11.
//
// The document is plain text per block. Citations and results are inline tokens
// in that text, so the document is its own export format and nothing is lost in
// a round trip:
//
//   [@paperId]            a citation, resolved against the library
//   [@paperId p. 4]       with a locator
//   {{result.key}}        a value from a saved analysis
//
// A block's hash covers its text. A suggestion or a review note records the
// hash it was made against; when the text changes the hash changes and anything
// anchored to it is stale rather than silently applied to different words
// (plan J5).

import { parseMarkdown, toMarkdown as mdOut } from './markdown.mjs';

export const BLOCK_TYPES = [
  { id: 'h1', label: 'Title' },
  { id: 'h2', label: 'Heading' },
  { id: 'h3', label: 'Subheading' },
  { id: 'p', label: 'Paragraph' },
  { id: 'quote', label: 'Quote' },
];

// IMRaD, which is the shape of the paper this tool exists to write.
export const STARTER = [
  { type: 'h1', text: '' },
  { type: 'h2', text: 'Abstract' },
  { type: 'p', text: '' },
  { type: 'h2', text: 'Introduction' },
  { type: 'p', text: '' },
  { type: 'h2', text: 'Methods' },
  { type: 'p', text: '' },
  { type: 'h2', text: 'Results' },
  { type: 'p', text: '' },
  { type: 'h2', text: 'Discussion' },
  { type: 'p', text: '' },
];

let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}${
  Math.random().toString(36).slice(2, 5)}`;

export const blankBlock = (type = 'p', text = '') => ({ id: newId(), type, text });

// A case report follows CARE (lib/checklist.mjs): the title names it, the
// abstract has its three parts, and the case is presented in CARE order.
export const CASE_REPORT_STARTER = [
  { type: 'h1', text: 'Diagnosis or intervention: a case report' },
  { type: 'h2', text: 'Abstract' },
  { type: 'h3', text: 'Introduction' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Case presentation' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Conclusions' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Keywords' }, { type: 'p', text: 'case report' },
  { type: 'h2', text: 'Introduction' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Case presentation' },
  { type: 'h3', text: 'Patient information' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Clinical findings' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Timeline' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Diagnostic assessment' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Therapeutic intervention' }, { type: 'p', text: '' },
  { type: 'h3', text: 'Follow-up and outcomes' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Discussion' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Conclusions' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Patient perspective' }, { type: 'p', text: '' },
  { type: 'h2', text: 'Informed consent' }, { type: 'p', text: '' },
];

/** A new document in the shape of the project's paper: IMRaD, or a CARE case report. */
// `title` fills the empty title line: a new manuscript starts under the project's working title, not a blank heading
export const starterDocument = (type = '', title = '') => (type === 'case-report' ? CASE_REPORT_STARTER : STARTER).map((b, i) => blankBlock(b.type, i === 0 && b.type === 'h1' && !b.text ? String(title || '').trim() : b.text));

// Word imports often use a body style for section labels. Recognize only
// standalone, conventional labels so prose such as "Results: We found..."
// cannot become a heading by accident. The Word style and runs stay intact.
const SECTION_LABEL = /^(?:(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)])\s+)?(?:abstract|summary|keywords?|introduction|background|aims?|objectives?|patients? and methods|materials? and methods|methods?|study design|results?|findings|discussion|conclusions?|limitations?|references|bibliography|acknowledg(?:e)?ments?|funding|ethics(?: approval)?|conflicts? of interest|author contributions?|figure legends?|supplementary (?:materials?|information|methods?))$/i;
export function recognizedSection(text) {
  const label = String(text || '').trim().replace(/\s+/g, ' ');
  return label.length <= 80 && SECTION_LABEL.test(label) ? label : null;
}

export function recognizeSections(blocks) {
  let changed = false;
  for (const b of blocks || []) {
    if (b.type !== 'p' || !recognizedSection(b.text)) continue;
    b.type = 'h2';
    b.semanticHeading = true;
    changed = true;
  }
  return changed;
}

/**
 * A stable 32-bit hash of a block's text.
 *
 * Not a cryptographic digest: its job is to notice that text changed between
 * when a suggestion was made and when it would be applied. FNV-1a over UTF-16
 * code units is enough for that and needs no async crypto call on every
 * keystroke.
 */
export function hashText(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ---- inline tokens --------------------------------------------------------

// A record key can be `doi-10.1002/ccr3.73436`, so the key runs to the first
// space or bracket rather than to a fixed character class — a DOI suffix may
// contain almost anything.
const CITE = /\[@([^\s\]]+)((?:\s+[^\]]*)?)\]/g;
const RESULT = /\{\{([A-Za-z0-9._:-]+)\}\}/g;

/** Every citation in a block, with its locator and character range. */
export function citations(text) {
  const out = [];
  CITE.lastIndex = 0;
  for (const m of String(text ?? '').matchAll(CITE))
    out.push({ key: m[1], locator: (m[2] || '').trim(), start: m.index, end: m.index + m[0].length });
  return out;
}

/** Every linked result in a block. */
export function resultTokens(text) {
  const out = [];
  RESULT.lastIndex = 0;
  for (const m of String(text ?? '').matchAll(RESULT))
    out.push({ key: m[1], start: m.index, end: m.index + m[0].length });
  return out;
}

export const citeToken = (id, locator = '') =>
  `[@${id}${locator ? ` ${locator}` : ''}]`;
export const resultToken = key => `{{${key}}}`;

/**
 * Split a block's text into runs for rendering.
 * Returns plain text runs and resolved token runs; nothing here produces HTML,
 * so escaping stays the caller's job and cannot be forgotten by accident.
 */
export function runs(text) {
  const marks = [
    ...citations(text).map(c => ({ ...c, kind: 'cite' })),
    ...resultTokens(text).map(r => ({ ...r, kind: 'result' })),
  ].sort((a, b) => a.start - b.start);

  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) out.push({ kind: 'text', text: text.slice(at, m.start) });
    out.push(m);
    at = m.end;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

// ---- document-level -------------------------------------------------------

export const wordCount = text =>
  String(text ?? '').replace(CITE, ' ').replace(RESULT, ' ')
    .split(/\s+/).filter(Boolean).length;

/** Sections, in order: a heading and the blocks under it. */
export function sections(blocks) {
  const out = [];
  let cur = { heading: null, blocks: [] };
  for (const b of blocks) {
    if (b.type === 'h2') {
      if (cur.heading || cur.blocks.length) out.push(cur);
      cur = { heading: b, blocks: [] };
    } else cur.blocks.push(b);
  }
  if (cur.heading || cur.blocks.length) out.push(cur);
  return out;
}

// ---- Markdown -------------------------------------------------------------
// Reading and writing live in lib/markdown.mjs (headings, emphasis, lists,
// tables, quotes, code); these keep the older names for their callers.

const PREFIX = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', p: '' };

/** The document as Markdown, tokens intact, so a round trip loses nothing. */
export function toMarkdown(blocks, opts = {}) {
  return mdOut(blocks, opts);
}

/** Markdown as blocks only; `parseMarkdown` also gives the list definitions the blocks use. */
export function fromMarkdown(text) {
  return parseMarkdown(text).blocks;
}

/**
 * Citation numbers by first appearance, which is what a numbered (Vancouver)
 * style means: the first work cited is 1, wherever it is cited again. Runs
 * are authoritative when present; table cells follow their displayed row
 * order. A used note is visited at its first body anchor, not by storage order.
 * Header/footer-only works follow the body in section-definition order, so
 * pagination and repeated running headers cannot change body numbering.
 * Editing the document renumbers the next render — nothing is stored.
 */
export function citationContext(blocks, { notes = {}, section = null, inserts = null, tail = null } = {}) {
  const map = new Map(), usedNotes = new Set();
  const add = key => { if (!map.has(key)) map.set(key, map.size + 1); };
  // inserts, tail: a table's or figure's works at its callout, or after the text (lib/package-cites.mjs)
  const shown = t => String(t ?? '').length - citations(t).reduce((n, c) => n + c.end - c.start, 0);
  const visitText = (text, noteAnchors, ins, base = 0) => {
    const cites = citations(text), marks = cites.map(c => ({ at: c.start, key: c.key }));
    if (noteAnchors) for (const m of String(text ?? '').matchAll(/\{\{fn:([A-Za-z0-9._-]+)\}\}/g)) marks.push({ at: m.index, note: m[1] });
    while (ins?.length && ins[0].at - base <= shown(text)) { const x = ins.shift(); let r = x.at - base; for (const c of cites) if (c.start < r) r += c.end - c.start; marks.push({ at: r - 0.5, keys: x.keys }); }
    marks.sort((a, b) => a.at - b.at);
    for (const mark of marks) {
      if (mark.keys) mark.keys.forEach(add);
      else if (mark.key != null) add(mark.key);
      else if (notes[mark.note] && !usedNotes.has(mark.note)) {
        usedNotes.add(mark.note);
        // Word does not support nested notes; only body-anchored notes are exported.
        visitContent(notes[mark.note], false);
      }
    }
  };
  const visitContent = (content, noteAnchors, ins) => {
    let base = 0;
    if (content.runs?.length) for (const run of content.runs) {
      if (run.del) continue;
      if (run.cite) run.cite.forEach(add);
      else { visitText(run.t, noteAnchors, ins, base); base += shown(run.t); }
    }
    else visitText(content.text, noteAnchors, ins);
    while (ins?.length) ins.shift().keys.forEach(add);
  };
  const visitBlock = (block, noteAnchors) => {
    if (['figure', 'toc', 'bib'].includes(block.type)) return;
    if (block.type === 'table' && block.grid) for (const row of block.grid.rows || []) for (const cell of row.cells || []) {
      if (!row.del && !cell.cellDel && !cell.merged) visitContent(cell, noteAnchors);
    }
    else if (block.type === 'table' && Array.isArray(block.rows)) for (const row of block.rows) for (const cell of row) visitText(String(cell ?? ''), noteAnchors);
    else visitContent(block, noteAnchors, inserts?.get(block.id)?.slice().sort((a, b) => a.at - b.at));
  };
  for (const block of blocks || []) visitBlock(block, true);
  for (const keys of tail || []) keys.forEach(add);
  for (const sec of [...(blocks || []).filter(b => b.props?.section).map(b => b.props.section), section || {}]) {
    for (const kind of ['header', 'footer']) for (const suffix of ['', 'First', 'Even']) {
      const part = sec?.[kind + suffix];
      if (!part) continue;
      if (part.blocks?.length) part.blocks.forEach(b => visitBlock(b, false));
      else visitText(part.text, false);
    }
  }
  return { numbers: map, usedNotes: [...usedNotes].map(id => ({ id, note: notes[id] })) };
}

/** Citation numbers only; older block-only callers retain the same signature. */
export const numbering = (blocks, options = {}) => citationContext(blocks, options).numbers;

/** "1,2,3,5" as "1–3,5". */
export function compactNumbers(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j - i >= 2 ? `${a[i]}\u2013${a[j]}` : a.slice(i, j + 1).join(','));
    i = j;
  }
  return out.join(',');
}

/**
 * The document with every token replaced by its current text, for an export
 * that is read rather than edited.
 *
 * Adjacent citations are one group: "[@a][@b]" renders as "[1,2]", not
 * "[1][2]". `cite` is called once per group with all its citations. An unresolved token is left visible instead
 * of being dropped: a reader must be able to see that something is missing
 * (plan J2 — an unresolved reference is a search lead, not bibliography).
 */
export function render(blocks, { cite, result }) {
  return blocks.map(b => `${PREFIX[b.type] ?? ''}${renderText(b.text, { cite, result })}`).join('\n\n').trim() + '\n';
}

/** One block's text with its tokens replaced, as `render` does for a document. */
export function renderText(text, { cite, result }) {
  const rs = runs(text);
  let out = '';
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (r.kind === 'text') { out += r.text; continue; }
    if (r.kind === 'result') { out += result(r) ?? `{{${r.key}?}}`; continue; }
    const group = [r];
    while (i + 1 < rs.length) {
      const nx = rs[i + 1], gap = rs[i + 2];
      if (nx.kind === 'cite') { group.push(nx); i++; continue; }
      if (nx.kind === 'text' && !nx.text.trim() && gap?.kind === 'cite') { group.push(gap); i += 2; continue; }
      break;
    }
    out += cite(group) ?? group.map(c => `[@${c.key}?]`).join('');
  }
  return out;
}

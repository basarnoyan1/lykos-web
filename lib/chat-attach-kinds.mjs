// What each kind of attachment says (plan §6.0a, "Ask about this"): one pure function per kind, from the app's own data to a small, bounded text.
// An item is a title, an id, the value and where it came from; never the whole paper, the whole table or a key. Every item carries the class of data
// it holds (docs/superpowers/plans/2026-10-13-ai-access-and-help.md §3.2), recorded here where the item is built and not guessed from its text, so
// the egress scope of a later stage can govern it:
//
//   metadata   titles, abstracts, identifiers, criteria      fulltext  text read from the owner's PDFs and files
//   values     extraction values, appraisal answers, outputs   rows      patient rows and the owner's datasets
//   drafts     manuscript and note text
//
// Nothing here reads the DOM, the settings or the store: the caller passes the state, and the same input always gives the same text.
import { columnsOf } from './templates.mjs';
import { splitCellId } from './arms.mjs';
import { labelWithUnit } from './fields.mjs';
import { currentSpec, outputById, builtinOutputs, sourceLine } from './output-spec.mjs';

/** The classes of data an attachment may carry. */
export const DATA_CLASSES = Object.freeze(['metadata', 'fulltext', 'values', 'rows', 'drafts']);
/** The longest a selection may be: the cap the chat always had for a selected passage. */
export const SELECTION_MAX = 6000;
/** The longest any other item may be (a cell, a row, a reference, an output). */
export const ITEM_MAX = 2400;

const clip = (v, n) => { const t = String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); return t.length > n ? `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…` : t; };
const oneLine = (v, n) => clip(String(v ?? '').replace(/\s+/g, ' '), n);
// A pasted key is not the question: key shapes are removed from any text a person selected, as lib/provider-error.mjs removes them from an error.
const KEY_SHAPE = /\b(?:sk|key|pk)-[\w-]{8,}/gi;
const scrub = text => String(text ?? '').replace(KEY_SHAPE, '…');
const paperOf = (state, id) => (state?.papers || []).find(p => p.id === id) || null;
const nameOf = p => p?.label || p?.title || p?.id || '';
const authorName = a => (typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' '));
const bounded = (text, max) => clip(text, max);

/** The kinds: the word the row shows, the class of data and the longest text. */
export const KINDS = Object.freeze({
  cell:                 { word: 'Cell', dataClass: 'values', max: ITEM_MAX },
  row:                  { word: 'Study row', dataClass: 'values', max: ITEM_MAX },
  reference:            { word: 'Reference', dataClass: 'metadata', max: ITEM_MAX },
  'table-row':          { word: 'Table row', dataClass: 'values', max: ITEM_MAX },
  output:               { word: 'Output', dataClass: 'values', max: ITEM_MAX },
  selection:            { word: 'Selection', dataClass: 'metadata', max: SELECTION_MAX },
  'pdf-selection':      { word: 'PDF selection', dataClass: 'fulltext', max: SELECTION_MAX },
  'manuscript-selection': { word: 'Manuscript selection', dataClass: 'drafts', max: SELECTION_MAX },
  'note-selection':     { word: 'Note selection', dataClass: 'drafts', max: SELECTION_MAX },
  // from the composer's Attach menu (lib/chat-attach-pick.mjs): a file of the project's folders as its text, and the page in view as the shell describes it
  file:                 { word: 'File', dataClass: 'fulltext', max: SELECTION_MAX },
  page:                 { word: 'Page', dataClass: 'metadata', max: ITEM_MAX },
});
export const KIND_NAMES = Object.freeze(Object.keys(KINDS));

const templateOf = columnId => (String(columnId).includes('.') ? String(columnId).split('.')[0] : 'default');
const sourceBits = (evidence = []) => evidence.filter(e => e && (e.kind === 'text' || e.quote)).slice(0, 2)
  .map(e => `${e.doc_id ? `${e.doc_id}, ` : ''}${e.page ? `p. ${e.page}` : 'page not recorded'}${e.quote ? ` "${oneLine(e.quote, 240)}"` : ''}`);

function valueLines(state, paperId, columnId) {
  const key = `${paperId}:${columnId}`, v = state?.values?.[key], pr = state?.proposals?.[key];
  const lines = [];
  if (v) {
    const how = v.availability === 'not_found' ? 'not reported' : 'accepted';
    lines.push(`Value (${how}${v.extractor ? `, by ${oneLine(v.extractor, 40)}` : ''}${v.verification ? `, ${oneLine(v.verification, 20)}` : ''}): ${oneLine(v.availability === 'not_found' ? 'NR' : v.reported_value, 300)}`);
    if (v.normalized_value != null && v.normalized_value !== '' && String(v.normalized_value) !== String(v.reported_value)) lines.push(`Normalised: ${oneLine(v.normalized_value, 120)}`);
    for (const s of sourceBits(v.evidence)) lines.push(`Source: ${s}`);
  }
  if (pr) {
    lines.push(`Proposal waiting for a person: ${oneLine(pr.availability === 'not_found' ? 'NR' : pr.value, 300)}`);
    for (const s of sourceBits(pr.evidence)) lines.push(`Proposal source: ${s}`);
  }
  if (!v && !pr) lines.push('Value: empty');
  return lines;
}

function cellContext(state, { paperId, columnId } = {}) {
  const p = paperOf(state, paperId); if (!p || !columnId) return null;
  const { columnId: base } = splitCellId(columnId);
  const col = columnsOf(templateOf(columnId), state).find(c => c.id === base);
  const field = col ? labelWithUnit(col) : base.split('.').pop().replace(/[_-]+/g, ' ');
  const text = [`Study: ${nameOf(p)} (id ${p.id})`, p.title && p.title !== nameOf(p) && `Title: ${oneLine(p.title, 200)}`,
    `Field: ${oneLine(field, 120)}`, col?.definition && `Definition: ${oneLine(col.definition, 240)}`, ...valueLines(state, paperId, columnId)].filter(Boolean).join('\n');
  return { label: `${nameOf(p)}, ${oneLine(field, 60)}`, source: `${nameOf(p)}, ${oneLine(field, 60)}`, text };
}

function rowContext(state, { paperId, templateId = 'default' } = {}) {
  const p = paperOf(state, paperId); if (!p) return null;
  const cols = columnsOf(templateId, state).filter(c => !c.hidden);
  const lines = [];
  for (const c of cols) {
    if (lines.length >= 40) break;
    const key = `${paperId}:${c.id}`, v = state?.values?.[key], pr = state?.proposals?.[key];
    if (!v && !pr) continue;
    lines.push(`${oneLine(labelWithUnit(c), 60)}: ${v ? oneLine(v.availability === 'not_found' ? 'NR' : v.reported_value, 120) : `(proposal) ${oneLine(pr.value, 120)}`}`);
  }
  const total = cols.length, empty = total - lines.length;
  const text = [`Study: ${nameOf(p)} (id ${p.id})`, p.title && p.title !== nameOf(p) && `Title: ${oneLine(p.title, 200)}`,
    `Values held (${lines.length} of ${total} fields${empty > 0 ? `, ${empty} empty` : ''}):`, ...lines].filter(Boolean).join('\n');
  return { label: nameOf(p), source: nameOf(p), text };
}

function referenceContext(state, { paperId } = {}) {
  const p = paperOf(state, paperId); if (!p) return null;
  const authors = (p.authors || []).slice(0, 6).map(authorName).filter(Boolean);
  const dec = state?.screening?.[p.id]?.decision, ft = state?.fulltext?.[p.id]?.decision;
  const text = [`Reference: ${nameOf(p)} (id ${p.id})`, p.title && `Title: ${oneLine(p.title, 300)}`,
    authors.length && `Authors: ${authors.join(', ')}${(p.authors || []).length > 6 ? ' et al.' : ''}`,
    [p.journal, p.year].filter(Boolean).length && `Published: ${[p.journal, p.year].filter(Boolean).join(', ')}`,
    p.doi && `DOI: ${p.doi}`, p.pmid && `PMID: ${p.pmid}`,
    dec && `Title and abstract decision: ${dec}`, ft && `Full-text decision: ${ft}`,
    p.abstract && `Abstract: ${oneLine(p.abstract, 1200)}`].filter(Boolean).join('\n');
  return { label: nameOf(p), source: nameOf(p), text };
}

function tableRowContext(state, { columns = [], cells = [], paperId = null, title = '' } = {}) {
  const pairs = cells.slice(0, 16).map((c, i) => [oneLine(columns[i] ?? `Column ${i + 1}`, 60), oneLine(c, 200)]).filter(([, v]) => v !== '');
  if (!pairs.length) return null;
  const p = paperId ? paperOf(state, paperId) : null;
  const text = [title && `From the table: ${oneLine(title, 120)}`, p && `Study: ${nameOf(p)} (id ${p.id})`, ...pairs.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n');
  return { label: oneLine(p ? nameOf(p) : pairs[0][1], 60), source: oneLine(title || 'a table in the chat', 80), text };
}

function outputContext(state, { outputId } = {}, deps = {}) {
  const entry = outputById(state, outputId) || builtinOutputs(state).find(o => o.id === outputId);
  const spec = currentSpec(entry); if (!spec) return null;
  const q = spec.query || {};
  const lines = [`${spec.kind === 'chart' ? 'Figure' : 'Table'}: ${oneLine(spec.title, 160)} (id ${entry.id})`,
    spec.kind === 'chart' && spec.chart && `Chart: ${spec.chart.type}${spec.chart.x ? `, x ${oneLine(spec.chart.x, 40)}` : ''}${spec.chart.y ? `, y ${oneLine(spec.chart.y, 40)}` : ''}`,
    `Reads: ${oneLine(sourceLine(spec, state), 160)}`, spec.notes && `Notes: ${oneLine(spec.notes, 300)}`];
  let rendered = null;
  try { rendered = deps.render ? deps.render(state, spec) : null; } catch { rendered = null; }
  if (rendered?.columns?.length) {
    lines.push(`Columns: ${rendered.columns.map(c => oneLine(c.label, 40)).slice(0, 12).join(' | ')}`);
    const rows = (rendered.groups || []).flatMap(g => g.cells || []);
    lines.push(`Rows: ${rows.length}`);
    for (const r of rows.slice(0, 6)) lines.push(`- ${r.slice(0, 8).map(c => oneLine(c, 40)).join(' | ')}`);
  }
  // A table drawn from patient rows is data of another class: it says so, and the egress scope can hold it back.
  return { label: oneLine(spec.title, 60), source: oneLine(spec.title, 80), text: lines.filter(Boolean).join('\n'), dataClass: q.from === 'patients' ? 'rows' : 'values' };
}

function selectionContext(kind) {
  return (state, { text, source = '', paperId = null, page = null } = {}) => {
    const body = scrub(String(text ?? '')).replace(/\r/g, '').trim(); if (!body) return null;
    const p = paperId ? paperOf(state, paperId) : null;
    const where = [p ? nameOf(p) : source, page ? `p. ${page}` : ''].filter(Boolean).join(', ');
    return { label: oneLine(body, 48), source: where, text: `${where ? `From ${where}:\n` : ''}"""\n${bounded(body, KINDS[kind].max - 200)}\n"""` };
  };
}

/** A file of the project's folders: its path and the start of its text (the caller reads it; nothing here touches a file). */
function fileContext(state, { path = '', text = '' } = {}) {
  const body = String(text ?? '').replace(/\r/g, '').trim(), name = String(path).split('/').pop();
  if (!path || !body) return null;
  return { label: oneLine(name, 60), source: oneLine(path, 160), text: `File: ${oneLine(path, 240)}\n"""\n${bounded(body, KINDS.file.max - 400)}\n"""` };
}
/** The page in view, as the shell describes it to the assistant at the moment it was attached. */
function pageContext(state, { title = '', text = '' } = {}) {
  const body = String(text ?? '').trim(); if (!title || !body) return null;
  return { label: oneLine(title, 60), source: oneLine(title, 80), text: `Page: ${oneLine(title, 80)}\n${body}` };
}

const BUILD = {
  cell: cellContext, row: rowContext, reference: referenceContext, 'table-row': tableRowContext, output: outputContext,
  selection: selectionContext('selection'), 'pdf-selection': selectionContext('pdf-selection'),
  'manuscript-selection': selectionContext('manuscript-selection'), 'note-selection': selectionContext('note-selection'),
  file: fileContext, page: pageContext,
};

/**
 * The attachment for one item: `{ kind, word, label, source, text, dataClass, size }`, or null when the item is not in the project (a cell of a
 * removed study) or says nothing. `ref` names the item by ids and the raw text of a selection; `deps.render` (outputs only) draws an output's rows.
 * The text is bounded by the kind, the same input gives the same text, and no setting, key or file is read.
 */
export function buildContext(kind, ref, state, deps = {}) {
  const def = KINDS[kind], build = BUILD[kind]; if (!def || !build) return null;
  const r = build(state, ref || {}, deps); if (!r?.text) return null;
  const text = bounded(scrub(r.text), def.max);
  return { kind, word: def.word, label: r.label || def.word, source: r.source || '', text, dataClass: r.dataClass || def.dataClass, size: text.length };
}

// The evidence table as a review team publishes it (plan §4.15a, evidence
// exports amendment 2026-09-28): the publication workbook (sheet "Table":
// filterable header, thin borders on every cell, plain body text, a two-arm
// study as two rows with its shared cells merged down, the table notes
// below), the with-sources workbook (the table again, the same table with
// each cell's paper title and verbatim sources under it, a revision log with
// a round per export, the column definitions and the ID map), and the Word
// tables, one landscape table per "Table N" collection with the columns that
// table shows.
//
// Pure: the builders take a project state and return sheets and blocks; the
// writers (lib/xlsx-write.mjs, lib/docx-write.mjs) make the files. Nothing
// here changes the project — the caller stores a new revision round.
import { studyGrid, cellKey } from './arms.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { writeTablesDocx } from './docx-write.mjs';

const colName = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
/** A column the table groups file adds (main table, shares), not a column of the publication sheet. */
export const isGroupColumn = c => !!c.groupKey || /\.main_table$/.test(c.id);
export const isIdColumn = c => /^id$/i.test(String(c.label || '').trim());
const isStudyColumn = c => /^study$/i.test(String(c.label || '').trim());
export const valueText = v => v == null ? '' : v.availability === 'not_found' && (v.reported_value == null || v.reported_value === '') ? 'NR' : String(v.reported_value ?? v.normalized_value ?? '');
const byNumber = (a, b) => (a.no ?? Infinity) - (b.no ?? Infinity) || String(a.label).localeCompare(String(b.label));

// ---- the model ---------------------------------------------------------------
/**
 * The table's studies in ID order, each with its rows as written: one row
 * per arm, shared cells spanning them. A study is in the table when it has
 * a value in any of the template's columns.
 */
export function evidenceModel(s, templateId) {
  const t = (s.templates || []).find(x => x.id === templateId);
  if (!t) throw new Error('No such table');
  const columns = t.columns;
  const idCol = columns.find(isIdColumn);
  const prefix = `:${t.id}.`;
  const have = new Set(Object.keys(s.values || {}).filter(k => k.includes(prefix)).map(k => k.slice(0, k.indexOf(':'))));
  const studies = (s.papers || []).filter(p => have.has(p.id)).map(p => {
    const idText = idCol ? valueText(s.values[cellKey(p.id, idCol.id)]) : '';
    return { paperId: p.id, paper: p, label: p.label || p.title || p.id, no: /^\d+$/.test(idText) ? Number(idText) : Number(p.folderNo) || null };
  }).sort(byNumber);
  const members = new Map();
  for (const c of s.collections || []) for (const id of c.members || []) members.set(id, [...(members.get(id) || []), c.id]);
  for (const st of studies) st.collections = members.get(st.paperId) || [];
  return { template: t, columns, sheetColumns: t.publicationColumns ? t.publicationColumns.map(id => columns.find(c => c.id === id)).filter(Boolean) : columns.filter(c => !isGroupColumn(c)),
    studies, notes: t.conventions || [], values: s.values || {}, collections: s.collections || [] };
}

// ---- the publication sheet -------------------------------------------------
const DEFAULT_WIDTH = c => isIdColumn(c) ? 6 : Math.min(38, Math.max(16, Math.round(String(c.label).length * 0.9)));
// Rows high enough for their wrapped text, in points (15 per line of Calibri 11), as Excel does not measure on open.
const linesIn = (text, width) => String(text ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / Math.max(4, width * 1.15))), 0);

/**
 * A sheet laid out as the publication table. `cellText(study, cell, column)`
 * gives what a cell shows (the value, or the value with its sources).
 */
export function publicationSheet(model, { name = 'Table', cellText = null } = {}) {
  const cols = model.sheetColumns;
  const widths = cols.map(c => model.template.sheetWidths?.[c.id] || DEFAULT_WIDTH(c));
  const rows = [cols.map(c => c.label)], merges = [], heights = [64];
  const text = cellText || ((st, x) => valueText(x.value));
  for (const st of model.studies) {
    const g = studyGrid(model.template, model.values, st.paperId, cols, { empty: 'study' });
    const first = rows.length;
    for (let r = 0; r < g.rows; r++) rows.push(cols.map(() => ''));
    g.cells.forEach((row, r) => row.forEach((x, c) => {
      if (!x) return;
      const t = text(st, x, cols[c]);
      rows[first + r][c] = isIdColumn(cols[c]) && /^\d+$/.test(t) ? Number(t) : t;
      if (x.span > 1) merges.push(`${colName(c)}${first + r + 1}:${colName(c)}${first + r + x.span}`);
    }));
    // A spanning cell's lines are shared by its rows; each row takes the rest.
    for (let r = 0; r < g.rows; r++) {
      let lines = 1;
      g.cells[r].forEach((x, c) => { if (x) lines = Math.max(lines, Math.ceil(linesIn(rows[first + r][c], widths[c]) / x.span)); });
      heights.push(Math.min(409, lines * 15 + 4));
    }
  }
  const last = rows.length;
  const notes = model.notes || [];
  const noteWidth = widths.slice(0, 8).reduce((a, w) => a + w, 0);
  const noteCols = Math.min(8, cols.length);
  if (notes.length) {
    rows.push([]); heights.push(15);
    rows.push(['Table notes']); heights.push(17); merges.push(`A${rows.length}:${colName(noteCols - 1)}${rows.length}`);
    for (const n of notes) { rows.push([n]); heights.push(Math.min(409, linesIn(n, noteWidth) * 15 + 2)); merges.push(`A${rows.length}:${colName(noteCols - 1)}${rows.length}`); }
  }
  const idCols = new Set(cols.map((c, i) => isIdColumn(c) ? i : -1));
  return {
    name, rows, merges, widths, heights, landscape: true,
    freeze: { x: cols.findIndex(isStudyColumn) + 1 || 1, y: 1 },
    filter: `A1:${colName(cols.length - 1)}${last}`,
    styleOf: (r, c) => r === 0 ? 'head' : r < last ? (idCols.has(c) ? 'number' : 'body') : r === last + 1 && c === 0 ? 'noteHead' : r > last + 1 && c === 0 ? 'note' : null,
  };
}

// ---- with sources --------------------------------------------------------------
/** A cell's "— Title:" (the study column) and "— Source:" lines: the paper and the verbatim quotes behind it. */
export function sourceLines(model, st, x, column) {
  const out = [];
  if (isStudyColumn(column)) {
    // The title line as the with-sources file had it, never rewritten; else the record's title and DOI.
    const kept = (x.value?.evidence || []).find(e => e.title && e.quote)?.quote;
    const t = String(st.paper.title || '').trim();
    if (kept) out.push(`— Title: ${kept}`);
    else if (t) out.push(`— Title: ${/[.?!]$/.test(t) ? t : `${t}.`}${st.paper.doi ? ` (https://doi.org/${st.paper.doi})` : ''}`);
  }
  const own = model.template.source?.file || '';
  for (const e of x.value?.evidence || []) {
    if (!e.quote || e.title || (e.kind === 'file' && e.path === own)) continue;
    out.push(`— Source: ${e.kind === 'text' && e.page ? `p.${e.page} '${e.quote}'` : e.quote}`);
  }
  return out;
}

const cellSnapshot = model => {
  const cells = {}, ids = {}, labels = {};
  for (const st of model.studies) {
    ids[st.paperId] = st.no; labels[st.paperId] = st.label;
    const g = studyGrid(model.template, model.values, st.paperId, model.columns, { empty: 'study' });
    for (const row of g.cells) for (const x of row) if (x) { const t = valueText(x.value); if (t) cells[x.key] = t; }
  }
  return { cells, ids, labels };
};

/**
 * What changed between two exports, cell by cell: a value added, changed or
 * removed, and a study whose ID changed. `prev` and `cur` are snapshots
 * ({ cells, ids, labels }); an absent `prev` is the first export.
 */
export function revisionDiff(prev, cur) {
  if (!prev) return null;
  const changes = [];
  for (const k of new Set([...Object.keys(prev.cells || {}), ...Object.keys(cur.cells)])) {
    const a = prev.cells?.[k] ?? '', b = cur.cells[k] ?? '';
    if (a !== b) changes.push({ key: k, from: a, to: b });
  }
  const moved = [];
  for (const [pid, no] of Object.entries(cur.ids)) if (prev.ids?.[pid] != null && prev.ids[pid] !== no) moved.push({ paperId: pid, from: prev.ids[pid], to: no });
  const added = Object.keys(cur.ids).filter(p => !(p in (prev.ids || {})));
  const removed = Object.keys(prev.ids || {}).filter(p => !(p in cur.ids));
  return { changes: changes.sort((x, y) => x.key.localeCompare(y.key)), moved, added, removed };
}

/**
 * The revision round an export adds: its number, date, version and changes
 * against the last export's snapshot, and the snapshot to keep. Returns
 * `round: null` when nothing changed since the last round.
 */
export function nextRound(model, { at = new Date().toISOString(), version = '' } = {}) {
  const log = model.template.exportLog || { rounds: [] };
  const snapshot = cellSnapshot(model);
  const diff = revisionDiff(log.snapshot, snapshot);
  if (diff && !diff.changes.length && !diff.moved.length && !diff.added.length && !diff.removed.length) return { round: null, snapshot, rounds: log.rounds || [] };
  const round = { round: (log.rounds?.at(-1)?.round || 0) + 1, at, version: String(version || ''), first: !diff,
    cells: Object.keys(snapshot.cells).length, studies: Object.keys(snapshot.ids).length, ...(diff || { changes: [], moved: [], added: [], removed: [] }) };
  return { round, snapshot, rounds: [...(log.rounds || []), round] };
}

function revisionSheet(model, rounds, snapshot) {
  const col = new Map(model.columns.map(c => [c.id, c.label]));
  const rows = [['Round', 'Date', 'Version', 'ID', 'Study', 'Column', 'Arm', 'Previous', 'Current']];
  const armName = (pid, arm) => (model.template.arms?.[pid] || []).find(a => a.id === arm)?.label || arm || '';
  for (const r of rounds) {
    const d = String(r.at).slice(0, 10);
    const head = [r.round, d, r.version];
    if (r.first) { rows.push([...head, '', '', `First export: ${r.studies} studies, ${r.cells} cells`, '', '', '']); continue; }
    const lines = [];
    for (const m of r.moved || []) lines.push([m.to, snapshot.labels[m.paperId] || m.paperId, 'ID', '', String(m.from), String(m.to)]);
    for (const p of r.added || []) lines.push([snapshot.ids[p] ?? '', snapshot.labels[p] || p, 'Study added', '', '', '']);
    for (const p of r.removed || []) lines.push(['', p, 'Study removed', '', '', '']);
    for (const c of r.changes || []) {
      const i = c.key.indexOf(':'), pid = c.key.slice(0, i), m = /^(.*?)(?:@(arm\d+))?$/.exec(c.key.slice(i + 1));
      lines.push([snapshot.ids[pid] ?? '', snapshot.labels[pid] || pid, col.get(m[1]) || m[1], armName(pid, m[2]), c.from, c.to]);
    }
    if (!lines.length) lines.push(['', '', 'No cell changed', '', '', '']);
    for (const l of lines) rows.push([...head, ...l]);
  }
  return { name: 'Revision log', rows, widths: [8, 12, 9, 6, 28, 28, 16, 50, 50], styleOf: r => r === 0 ? 1 : 'plain' };
}

function definitionsSheet(model) {
  const arm = new Set(model.template.armColumns || []);
  return { name: 'Column definitions', widths: [36, 10, 90], styleOf: r => r === 0 ? 1 : 'plain',
    rows: [['Column', 'Level', 'What goes in the cell'], ...model.columns.map(c => [c.label, arm.has(c.id) ? 'Arm' : 'Study', c.guidance || ''])] };
}

function idMapSheet(model, prevIds = {}) {
  return { name: 'ID map', widths: [6, 11, 34, 36, 34, 22], styleOf: r => r === 0 ? 1 : 'plain',
    rows: [['ID', 'Previous ID', 'Study', 'PDF file', 'DOI', 'Record'], ...model.studies.map(st => [st.no ?? '', prevIds[st.paperId] != null && prevIds[st.paperId] !== st.no ? prevIds[st.paperId] : '',
      valueText(model.values[cellKey(st.paperId, model.columns.find(isStudyColumn)?.id || '')]) || st.label, st.paper.pdfRel ? st.paper.pdfRel.split('/').pop() : st.paper.pdfName || '', st.paper.doi || '', st.label])] };
}

/** The publication workbook: the "Table" sheet only. */
export const publicationWorkbook = model => writeXlsx([publicationSheet(model)]);

/**
 * The with-sources workbook for an export round (see nextRound): the formal
 * table, the table with sources, the revision log up to this round, the
 * column definitions and the ID map.
 */
export function sourcesWorkbook(model, { rounds = [], snapshot = null, prevIds = null } = {}) {
  const snap = snapshot || cellSnapshot(model);
  return writeXlsx([
    publicationSheet(model, { name: 'Table (formal)' }),
    publicationSheet(model, { name: 'Table (with sources)', cellText: (st, x, c) => [valueText(x.value), ...sourceLines(model, st, x, c)].filter((l, i) => i === 0 || l).join('\n') }),
    revisionSheet(model, rounds, snap),
    definitionsSheet(model),
    idMapSheet(model, prevIds || model.template.exportLog?.snapshot?.ids || {}),
  ]);
}

// ---- the Word tables -----------------------------------------------------------
const PAGE = { w: 16838, h: 11906, margin: 567 };

/**
 * The Word tables a template writes: its stored list, or one per "Table N"
 * collection holding its studies, every sheet column but the ID shown.
 */
export function wordTables(model) {
  if (model.template.wordTables?.length) return model.template.wordTables;
  const ids = new Set(model.studies.map(st => st.paperId));
  const shown = model.sheetColumns.filter(c => !isIdColumn(c)).map(c => c.id);
  return model.collections.filter(c => /^table\s*\d+$/i.test(c.name || '') && (c.members || []).some(m => ids.has(m)))
    .sort((a, b) => Number(/\d+/.exec(a.name)[0]) - Number(/\d+/.exec(b.name)[0]))
    .map(c => ({ collection: c.id, caption: '', columns: shown }));
}

// A table's studies in the order it lists them: its sort keys, then the ID order.
function tableStudies(model, cfg) {
  const coll = model.collections.find(c => c.id === cfg.collection);
  const inTable = new Set(coll?.members || []);
  const list = model.studies.filter(st => inTable.has(st.paperId)).map((st, i) => ({ st, i }));
  const keyOf = (st, k) => valueText(model.values[cellKey(st.paperId, k.column)]);
  list.sort((a, b) => {
    for (const k of cfg.order || []) {
      const x = keyOf(a.st, k), y = keyOf(b.st, k);
      if (k.first != null) { const d = (x !== k.first) - (y !== k.first); if (d) return d; continue; }
      const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
      if (d) return d;
    }
    return a.i - b.i;
  });
  return { coll, studies: list.map(x => x.st) };
}

/** The document's blocks: per table a caption, the table and a page break; the notes after the last. */
export function wordBlocks(model, { size = 6.5 } = {}) {
  const t = model.template;
  const tw = PAGE.w - 2 * PAGE.margin;
  const blocks = [];
  const cfgs = wordTables(model);
  cfgs.forEach((cfg, n) => {
    const cols = cfg.columns.map(id => model.columns.find(c => c.id === id)).filter(Boolean);
    const { coll, studies } = tableStudies(model, cfg);
    const weights = cols.map(c => Number(t.tableWeights?.[c.id]) || 8);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => Math.floor(w / total * tw));
    widths[widths.length - 1] += tw - widths.reduce((a, b) => a + b, 0);
    const rows = [];
    for (const st of studies) {
      const g = studyGrid(t, model.values, st.paperId, cols, { empty: 'study' });
      g.cells.forEach((row, r) => rows.push({ keepNext: r < g.rows - 1, cells: row.map(x => x && { text: valueText(x.value), span: x.span }) }));
    }
    const name = coll?.name || `Table ${n + 1}`;
    if (n) blocks.push({ type: 'pageBreak' });
    blocks.push({ type: 'para', text: `${name}. ${cfg.caption ? `${cfg.caption} ` : ''}(n = ${studies.length})`.replace('. (n', ' (n'), size: 10, bold: true, after: 6 });
    blocks.push({ type: 'table', widths, header: cols.map(c => cfg.headers?.[c.id] || c.label), headerFill: 'D9E2F3', rows });
  });
  const notes = [...(t.tableNotes || []), ...(model.notes || [])];
  if (notes.length) {
    blocks.push({ type: 'para', text: 'Table notes', size: 8, bold: true, before: 12, after: 4 });
    for (const x of notes) blocks.push({ type: 'para', text: x, size: 7, after: 3 });
  }
  return blocks;
}

export const wordDocument = model => writeTablesDocx({ blocks: wordBlocks(model), font: 'Arial', size: 6.5, page: PAGE, landscape: true, footerSize: 7 });

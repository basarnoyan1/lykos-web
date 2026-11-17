// Datasets: tables of the researcher's own, kept in the project beside the
// review's evidence tables — a registry export, a survey, a laboratory sheet.
// A dataset is columns and rows, nothing more: it is not keyed to the library's
// records, so any table can be brought in as it is, queried (lib/project-query.mjs,
// `from: dataset`), charted (Tables and figures) and read by an assistant.
//
//   { id, name, columns: [{ id, label, type }], rows: [{ [columnId]: value }],
//     source: { file, sheet, importedAt }, at }
//
// Types are read from the values on import (text, number, integer, date) and
// can be changed; a value that does not fit its column's type stays as typed
// and is reported by validate().
import { get, update } from '../store.mjs';
import { editCell, lockRows, unlockRows, verifyRow, rowIdOf, isLocked } from './data-rules.mjs';

export const COLUMN_TYPES = [['text', 'Text'], ['number', 'Number'], ['integer', 'Whole number'], ['date', 'Date'], ['category', 'Category']];
export const MAX_ROWS = 100_000;

export const datasets = (s = get()) => s.datasets || [];
export const datasetById = (id, s = get()) => datasets(s).find(d => d.id === id) || null;
/** A dataset by id or by name (case does not matter). */
export const findDataset = (ref, s = get()) => datasetById(ref, s) || datasets(s).find(d => d.name.toLowerCase() === String(ref || '').trim().toLowerCase()) || null;

export const newDatasetId = () => `ds${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const columnKey = label => String(label || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ').replace(/[\s_]+/g, '_').replace(/^_|_$/g, '') || 'column';

const NUMBER = /^[-+]?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)?(?:[.,]\d+)?(?:[eE][-+]?\d+)?%?$/;
const INTEGER = /^[-+]?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)$/;
const DATE = /^(?:\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$/;

/** The type the values of a column agree on; empty cells do not count, and an all-empty column is text. */
export function inferType(values) {
  const vs = values.map(v => String(v ?? '').trim()).filter(Boolean);
  if (!vs.length) return 'text';
  if (vs.every(v => INTEGER.test(v))) return 'integer';
  if (vs.every(v => NUMBER.test(v) && /\d/.test(v))) return 'number';
  if (vs.every(v => DATE.test(v))) return 'date';
  const distinct = new Set(vs.map(v => v.toLowerCase())).size;
  if (vs.length >= 8 && distinct <= Math.max(2, Math.min(12, Math.floor(vs.length / 4)))) return 'category';
  return 'text';
}

/** A cell as its column's type reads it: a number for number and integer columns, else the text. `null` for an empty cell. */
export function cellValue(v, type) {
  if (v == null || v === '') return null;
  if (type === 'number' || type === 'integer') {
    const t = String(v).trim().replace(/%$/, '').replace(/(\d)[ ,](?=\d{3}(?:\D|$))/g, '$1').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return String(v);
}

/** Rows of cells (the first row the header) as a dataset; blank columns and blank rows are left out. */
export function fromRows(rows, { name, file = '', sheet = '', id = newDatasetId(), types = {} } = {}) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS + 1) throw new Error(`A dataset holds at most ${MAX_ROWS.toLocaleString()} rows`);
  let cells = 0;
  for (const row of rows) { if ((row?.length || 0) > 512 || (cells += row?.length || 0) > 2_000_000) throw new Error('The table exceeds the supported column or cell limit'); }
  const grid = (rows || []).map(r => (r || []).map(c => c == null ? '' : String(c)));
  const headerAt = grid.findIndex(r => r.filter(c => c.trim()).length >= 1);
  if (headerAt < 0) throw new Error('The sheet is empty');
  const header = grid[headerAt];
  const taken = new Set(), columns = [];
  header.forEach((label, col) => {
    const text = String(label).trim();
    const filled = grid.slice(headerAt + 1).some(r => String(r[col] ?? '').trim());
    if (!text && !filled) return;
    const base = columnKey(text || `column_${col + 1}`); let key = base, n = 1;
    while (taken.has(key)) key = `${base}_${++n}`;
    taken.add(key);
    columns.push({ id: key, label: text || `Column ${col + 1}`, type: 'text', col });
  });
  if (!columns.length) throw new Error('The sheet has no columns');
  const body = grid.slice(headerAt + 1).filter(r => r.some(c => c.trim()));
  if (body.length > MAX_ROWS) throw new Error(`The sheet has ${body.length.toLocaleString()} rows; a dataset holds at most ${MAX_ROWS.toLocaleString()}`);
  const out = body.map(r => Object.fromEntries(columns.map(c => [c.id, String(r[c.col] ?? '').trim()])));
  for (const c of columns) c.type = types[c.id] || types[c.label] || inferType(out.map(r => r[c.id]));
  return { id, name: String(name || sheet || file || 'Dataset').replace(/\.(xlsx|csv|tsv|txt)$/i, '').slice(0, 80), columns: columns.map(({ col, ...c }) => c), rows: out,
    source: { file, sheet, importedAt: new Date().toISOString() }, at: new Date().toISOString() };
}

/** The dataset as rows of cells, the header first: what a CSV export or a query reads. */
export const toRows = d => [d.columns.map(c => c.label), ...d.rows.map(r => d.columns.map(c => r[c.id] ?? ''))];

/** Cells that do not read as their column's type, by column: what to look at after an import or a type change. */
export function validate(d) {
  const out = [];
  for (const c of d.columns) {
    if (c.type !== 'number' && c.type !== 'integer' && c.type !== 'date') continue;
    const bad = d.rows.reduce((n, r) => n + (r[c.id] !== '' && r[c.id] != null && (c.type === 'date' ? !DATE.test(String(r[c.id]).trim()) : cellValue(r[c.id], c.type) == null || (c.type === 'integer' && !Number.isInteger(cellValue(r[c.id], c.type)))) ? 1 : 0), 0);
    if (bad) out.push({ column: c.id, label: c.label, type: c.type, count: bad });
  }
  return out;
}

// ---- edits, all through the store ------------------------------------------
export function addDataset(d) { update(s => { s.datasets = [...(s.datasets || []), d]; return s; }); return d.id; }
/** All sheets validate before the single live mutation. */
export function addDatasets(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('The import has no datasets');
  const ids = new Set((get().datasets || []).map(d => d.id));
  for (const d of list) {
    if (!d?.id || ids.has(d.id) || !Array.isArray(d.columns) || !d.columns.length || d.columns.length > 512 || !Array.isArray(d.rows) || d.rows.length > MAX_ROWS || d.rows.length * d.columns.length > 2_000_000) throw new Error('The import contains an invalid, oversized or duplicate dataset');
    ids.add(d.id);
  }
  update(s => { s.datasets = [...(s.datasets || []), ...list]; return s; }); return list[0].id;
}
export function removeDataset(id) { update(s => { s.datasets = (s.datasets || []).filter(d => d.id !== id); return s; }); }
export function renameDataset(id, name) { update(s => { const d = (s.datasets || []).find(x => x.id === id); if (d) d.name = String(name || d.name).trim().slice(0, 80) || d.name; return s; }); }
export function setColumnType(id, columnId, type) {
  if (!COLUMN_TYPES.some(([t]) => t === type)) return;
  update(s => { const c = (s.datasets || []).find(x => x.id === id)?.columns.find(x => x.id === columnId); if (c) c.type = type; return s; });
}
/**
 * Sets one cell through the change log (lib/data-rules.mjs editCell): who,
 * when, from, to and why are recorded; a locked row is refused, and so is a
 * change without a reason when dataSettings.requireReason is on.
 * Returns { ok, error? }.
 */
export function setCell(id, rowIndex, columnId, value, meta = {}) {
  let r = { ok: false, error: 'No such cell' };
  update(s => {
    const d = (s.datasets || []).find(x => x.id === id);
    if (!d?.rows[rowIndex] || !d.columns.some(c => c.id === columnId)) return s;
    if (String(d.rows[rowIndex][columnId] ?? '') === String(value ?? '').trim()) { r = { ok: true, unchanged: true }; return s; }
    r = editCell(s, id, rowIndex, columnId, String(value ?? '').trim(), meta);
    if (r.ok) d.at = new Date().toISOString();
    return s;
  });
  return r;
}
export function addRow(id) { update(s => { const d = (s.datasets || []).find(x => x.id === id); if (d) { d.rows.push(Object.fromEntries(d.columns.map(c => [c.id, '']))); d.at = new Date().toISOString(); } return s; }); }
/**
 * Removes rows by index; a locked row is kept. Each removal is logged, and
 * locks and verification of a dataset without a key column follow their rows
 * to their new positions. Returns the number of locked rows kept.
 */
export function removeRows(id, indexes, { by = '' } = {}) {
  let kept = 0;
  update(s => {
    const d = (s.datasets || []).find(x => x.id === id); if (!d) return s;
    const gone = new Set([...indexes].filter(i => { const locked = isLocked(s, id, rowIdOf(d, i)); if (locked) kept++; return !locked; }));
    if (!gone.size) return s;
    const at = new Date().toISOString(), log = (s.dataChangeLog ||= []);
    for (const i of [...gone].sort((a, b) => a - b)) log.push({ id: `chg${log.length + 1}`, action: 'remove', datasetId: id, row: rowIdOf(d, i), by, at });
    if (!d.rowKey) {
      const moved = new Map(); let n = 0;
      d.rows.forEach((_, i) => { if (!gone.has(i)) moved.set(String(i), String(n++)); });
      for (const key of ['dataLocks', 'dataVerification']) {
        const m = s[key]?.[id]; if (!m) continue;
        s[key][id] = Object.fromEntries(Object.entries(m).filter(([k]) => moved.has(k)).map(([k, v]) => [moved.get(k), v]));
      }
    }
    d.rows = d.rows.filter((_, i) => !gone.has(i)); d.at = at;
    return s;
  });
  return kept;
}

// ---- data management: constraints, edit checks, locks and verification (lib/data-rules.mjs)
const withDataset = (id, fn) => update(s => { const d = (s.datasets || []).find(x => x.id === id); if (d) fn(d, s); return s; });
/** A column's constraints (column.rules); an empty object removes them. */
export function setColumnRules(id, columnId, rules) {
  withDataset(id, d => { const c = d.columns.find(x => x.id === columnId); if (!c) return; if (rules && Object.keys(rules).length) c.rules = rules; else delete c.rules; });
}
/** The dataset's edit checks (dataset.rules). */
export function setDatasetRules(id, rules) { withDataset(id, d => { d.rules = rules || []; }); }
/** A project-wide data-management setting (state.dataSettings). */
export function setDataSetting(key, value) { update(s => { s.dataSettings = { ...(s.dataSettings || {}), [key]: value }; return s; }); }
export function lockDatasetRows(id, rowIds, by = '') { let done = []; update(s => { done = lockRows(s, id, rowIds, { by }); return s; }); return done; }
export function unlockDatasetRows(id, rowIds, { by = '', reason = '' } = {}) { let r; update(s => { r = unlockRows(s, id, rowIds, { by, reason }); return s; }); return r; }
export function verifyDatasetRows(id, rowIds, by = '') { update(s => { for (const r of rowIds) verifyRow(s, id, r, by); return s; }); }
/** Rows added to a dataset in one step (an import of records), logged as one entry; the columns may grow. */
export function appendRows(id, rows, { columns = null, by = '', source = '' } = {}) {
  withDataset(id, (d, s) => {
    if (columns) d.columns = columns;
    d.rows = [...d.rows.map(r => Object.fromEntries(d.columns.map(c => [c.id, r[c.id] ?? '']))), ...rows.map(r => Object.fromEntries(d.columns.map(c => [c.id, r[c.id] == null ? '' : String(r[c.id])])))];
    d.at = new Date().toISOString();
    const log = (s.dataChangeLog ||= []);
    log.push({ id: `chg${log.length + 1}`, action: 'import', datasetId: id, row: null, rows: rows.length, source, by, at: d.at });
  });
}

const text = v => typeof v === 'string' ? v : v == null ? '' : String(v);
const texts = v => Array.isArray(v) ? v.map(text).map(x => x.trim()).filter(Boolean) : [];
const bound = v => typeof v === 'number' ? (Number.isFinite(v) ? v : undefined) : typeof v === 'string' && v.trim() ? v.trim() : undefined;
/** Column constraints as saved: only the known keys, each of its kind (lib/data-rules.mjs). */
export function normalizeColumnRules(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  if (r.required) out.required = true;
  for (const k of ['min', 'max']) { const b = bound(r[k]); if (b !== undefined) out[k] = b; }
  const allowed = texts(r.allowed); if (allowed.length) out.allowed = allowed;
  const missing = texts(r.missingCodes); if (missing.length) out.missingCodes = missing;
  for (const k of ['pattern', 'unit']) if (text(r[k]).trim()) out[k] = text(r[k]).trim();
  return Object.keys(out).length ? out : null;
}
function normalizeColumn(c) {
  const out = { id: String(c.id), label: String(c.label || c.id), type: COLUMN_TYPES.some(([t]) => t === c.type) ? c.type : 'text' };
  const rules = normalizeColumnRules(c.rules); if (rules) out.rules = rules;
  if (Array.isArray(c.choices)) { const ch = c.choices.filter(x => x && typeof x === 'object').map(x => ({ code: text(x.code), label: text(x.label) })); if (ch.length) out.choices = ch; }
  if (c.redcap && typeof c.redcap === 'object' && !Array.isArray(c.redcap)) out.redcap = { ...c.redcap };
  if (c.identifier) out.identifier = true;
  if (text(c.branching).trim()) out.branching = text(c.branching);
  if (text(c.note).trim()) out.note = text(c.note);
  return out;
}
/** Edit checks as saved: { id, text, message?, severity?, off? }; a bare text is one. */
export function normalizeDatasetRules(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((r, i) => {
    const o = typeof r === 'string' ? { text: r } : r && typeof r === 'object' ? r : null;
    if (!o || !text(o.text).trim()) return [];
    return [{ id: text(o.id) || `rule${i + 1}`, text: text(o.text), ...(text(o.message).trim() ? { message: text(o.message) } : {}),
      ...(o.severity === 'warning' || o.severity === 'info' ? { severity: o.severity } : {}), ...(o.off ? { off: true } : {}) }];
  });
}

/**
 * A saved project's datasets, put right: every column keyed, every row an
 * object of strings. Data-management fields survive: column constraints,
 * choices, REDCap field records, identifier and branching; a dataset's edit
 * checks, row key, REDCap extras and log template.
 */
export function normalizeDatasets(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap(d => {
    if (!d || typeof d !== 'object' || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return [];
    const columns = d.columns.filter(c => c && c.id).map(normalizeColumn);
    const rows = d.rows.filter(r => r && typeof r === 'object').map(r => Object.fromEntries(columns.map(c => [c.id, r[c.id] == null ? '' : String(r[c.id])])));
    const { rules, rowKey, redcap, template, ...rest } = d;
    const kept = normalizeDatasetRules(rules);
    return [{ ...rest, id: String(d.id || newDatasetId()), name: String(d.name || 'Dataset'), columns, rows,
      ...(kept.length ? { rules: kept } : {}),
      ...(rowKey && columns.some(c => c.id === rowKey) ? { rowKey: String(rowKey) } : {}),
      ...(redcap && typeof redcap === 'object' && !Array.isArray(redcap) ? { redcap: { ...redcap } } : {}),
      ...(typeof template === 'string' && template ? { template } : {}) }];
  });
}

const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
/**
 * The project's data-management state put right (store normalizeProject):
 * the change log, locks and verification by dataset and row, settings, and
 * the sealed allocations with their audit log.
 */
export function normalizeDataManagement(next) {
  next.dataChangeLog = Array.isArray(next.dataChangeLog) ? next.dataChangeLog.filter(e => plainObject(e) && e.datasetId && e.action) : [];
  for (const k of ['dataLocks', 'dataVerification']) {
    next[k] = plainObject(next[k]) ? Object.fromEntries(Object.entries(next[k]).filter(([, v]) => plainObject(v))) : {};
  }
  next.dataSettings = plainObject(next.dataSettings) ? { ...next.dataSettings, requireReason: !!next.dataSettings.requireReason } : { requireReason: false };
  next.allocations = Array.isArray(next.allocations) ? next.allocations.filter(a => plainObject(a) && a.id && Array.isArray(a.entries) && plainObject(a.vault)) : [];
  next.allocationLog = Array.isArray(next.allocationLog) ? next.allocationLog.filter(e => plainObject(e) && e.allocationId && e.hash) : [];
  return next;
}

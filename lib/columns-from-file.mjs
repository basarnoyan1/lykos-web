// Columns from a file: a table of the researcher's own results (one row per study, or per arm of a study) becomes columns of an
// extraction table, so each can be filtered, grouped and counted like any other.
//
// The file names its rows by an ID (the table's ID column) or a Study (the study's label or the table's Study text), and optionally an
// Arm ("Arm 1"). Every other column is added to the table: a column whose cells hold several things separated by "; " is multi-valued
// (read apart by the query layer, lib/derive-fields.mjs), a column of numbers is a number column, any other a category column. Rows that
// match no study are listed, never guessed at; a column whose name is already in the table is left out and named. Two rows for one
// study and arm are one cell holding both values, so a file may give a cohort's devices one row each.
//
// Pure apart from the store the apply step writes through. It names no field, device or vocabulary.
import { parseDelimited } from './spreadsheet.mjs';
import { cellKey, armsOf } from './arms.mjs';
import { get } from '../store.mjs';
import { templateById, columnsOf } from './templates.mjs';
import { addTableColumn, fold } from './derive-fields.mjs';
import { setAnchoredValue, isLocked } from './fields.mjs';

export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 60;
export const MAX_LEVELS = 200;
const KEYS = { id: ['id', 'table id', 'study id'], study: ['study', 'study label', 'label', 'paper', 'record'], arm: ['arm'] };
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const parts = v => clean(v).split(';').map(clean).filter(Boolean);

/** A file's text as { headers, rows: [{ header: text }] }: a CSV or TSV with a header row, or JSON (an array of objects, or { rows: [...] }). */
export function parseColumnsFile(text, name = '') {
  const body = String(text ?? '').replace(/^﻿/, '');
  if (/\.json$/i.test(name) || /^\s*[\[{]/.test(body)) {
    let doc; try { doc = JSON.parse(body); } catch { throw new Error('The file is not valid JSON.'); }
    const list = Array.isArray(doc) ? doc : Array.isArray(doc?.rows) ? doc.rows : null;
    if (!list || !list.every(r => r && typeof r === 'object' && !Array.isArray(r))) throw new Error('Expected a list of rows, each an object of column values.');
    // one nested object of a row is read as more columns ({ label, v: { "Dynamic screw": "all", ... } }): a coding matrix written by a script
    const flat = r => Object.fromEntries(Object.entries(r).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : [[k, v]])));
    const rows = list.map(flat);
    const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
    return limited({ headers, rows: rows.map(r => Object.fromEntries(headers.map(h => [h, Array.isArray(r[h]) ? r[h].map(clean).join('; ') : clean(r[h])]))) });
  }
  const first = body.split(/\r?\n/, 1)[0] || '';
  const delimiter = [['\t', (first.match(/\t/g) || []).length], [';', (first.match(/;/g) || []).length], [',', (first.match(/,/g) || []).length]].sort((a, b) => b[1] - a[1])[0][0];
  const grid = parseDelimited(body, delimiter).rows.filter(r => r.some(c => clean(c)));
  if (grid.length < 2) throw new Error('The file needs a header row and at least one row.');
  const headers = grid[0].map(clean);
  return limited({ headers, rows: grid.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, clean(r[i])]))) });
}
function limited(t) {
  if (t.rows.length > MAX_ROWS) throw new Error(`The file has ${t.rows.length} rows; the limit is ${MAX_ROWS}.`);
  return t;
}

const textOf = v => (v ? clean(v.reported_value ?? v.normalized_value) : '');
const authorYear = text => { const m = /^\s*([^\s,]+).*?\b((?:19|20)\d{2}[a-z]?)\b/i.exec(text || ''); return m ? fold(`${m[1]} ${m[2]}`) : ''; };

/** The study each row names, by the table's ID column, else the study's label, else the table's Study text ("Akgun et al., 2024, Türkiye"). */
function studyFinder(s, templateId) {
  const cols = columnsOf(templateId, s);
  const byLabelCol = name => cols.find(c => fold(c.label) === name);
  const idCol = byLabelCol('id'), studyCol = byLabelCol('study');
  const byId = new Map(), byLabel = new Map(), byText = new Map(), byAuthorYear = new Map();
  for (const p of s.papers || []) {
    byLabel.set(fold(p.label), p.id);
    if (idCol) byId.set(fold(textOf(s.values?.[cellKey(p.id, idCol.id)])), p.id);
    if (studyCol) { const t = textOf(s.values?.[cellKey(p.id, studyCol.id)]); if (t) { byText.set(fold(t), p.id); byAuthorYear.set(authorYear(t), p.id); } }
  }
  return (id, study) => (id && byId.get(fold(id))) || (study && (byLabel.get(fold(study)) || byText.get(fold(study)) || byAuthorYear.get(authorYear(study)))) || null;
}

/** An arm as the file names it ("Arm 2", "arm2", "2") of a study: its id in the table, or null for the study as a whole. */
function armFinder(tpl) {
  return (paperId, text) => {
    const arms = armsOf(tpl, paperId), t = clean(text);
    if (!arms?.length || !t) return null;
    // "Arm 2", "arm2", "2": the arm by its place; any other text ("NA (n=68) Dynesys dynamic stabilization") by the arm's own words
    if (/^(arm\s*)?\d+$/i.test(t)) { const n = Number(/(\d+)/.exec(t)[1]); return arms[n - 1]?.id || null; }
    const words = a => Object.values(a).filter(v => typeof v === 'string' && v.length > 2 && v !== a.id).map(fold);
    const ft = fold(t), hit = arms.find(a => words(a).some(w => w === ft || ft.startsWith(w) || w.startsWith(ft)));
    return hit ? hit.id : null;
  };
}

/** What adding the file's columns to a table would do, changing nothing. */
export function planColumns(s, templateId, parsed) {
  const tpl = templateId === 'default' ? null : templateById(templateId, s);
  const header = names => parsed.headers.find(h => names.includes(fold(h))) || null;
  const idH = header(KEYS.id), studyH = header(KEYS.study), armH = header(KEYS.arm);
  if (!idH && !studyH) throw new Error('The file needs an ID or a Study column to say which study each row is.');
  const find = studyFinder(s, templateId), arm = armFinder(tpl), existing = new Set(columnsOf(templateId, s).map(c => fold(c.label)));
  const keyHeaders = new Set([idH, studyH, armH].filter(Boolean));
  const heads = parsed.headers.filter(h => h && !keyHeaders.has(h));
  if (heads.length > MAX_COLUMNS) throw new Error(`The file has ${heads.length} columns; the limit is ${MAX_COLUMNS}.`);
  const skipped = heads.filter(h => existing.has(fold(h))), added = heads.filter(h => !existing.has(fold(h)));
  const cells = new Map(added.map(h => [h, new Map()])), unmatched = []; let matchedRows = 0;
  const labelOf = id => (s.papers || []).find(p => p.id === id)?.label || id;
  for (const row of parsed.rows) {
    const paperId = find(idH && row[idH], studyH && row[studyH]);
    if (!paperId) { unmatched.push(clean(row[studyH] || row[idH])); continue; }
    matchedRows++;
    const armId = arm(paperId, armH && row[armH]);
    for (const h of added) for (const v of parts(row[h])) {
      const k = `${paperId}@${armId || ''}`, m = cells.get(h), list = m.get(k) || { paperId, arm: armId, values: [] };
      if (!list.values.includes(v)) list.values.push(v);
      m.set(k, list);
    }
  }
  const columns = added.map(h => {
    const list = [...cells.get(h).values()];
    const all = list.flatMap(c => c.values);
    const multiple = list.some(c => c.values.length > 1) || parsed.rows.some(r => clean(r[h]).includes(';'));
    const levels = [...new Set(all)];
    const numeric = !multiple && all.length > 0 && all.every(v => Number.isFinite(Number(v.replace(',', '.'))) && /\d/.test(v));
    const type = multiple ? 'text' : numeric ? 'number' : levels.length > MAX_LEVELS ? 'text' : 'category';
    return { label: h, type, multiple, levels: levels.slice(0, MAX_LEVELS), levelCount: levels.length, filled: list.length,
      cells: list.map(c => ({ paperId: c.paperId, arm: c.arm, label: labelOf(c.paperId), value: c.values.join('; ') })) };
  }).filter(c => c.filled > 0);
  return { templateId, columns, skipped, unmatched, rows: parsed.rows.length, matchedRows,
    empty: added.filter(h => !columns.some(c => c.label === h)) };
}

/** A sentence for the confirmation: what is added, and what was left out. */
export function describePlan(plan) {
  const lines = plan.columns.map(c => `${c.label}: ${c.multiple ? 'several per cell, ' : ''}${c.levelCount} ${c.type === 'number' ? 'numbers' : c.levelCount === 1 ? 'level' : 'levels'}, ${c.filled} cells`);
  if (plan.skipped.length) lines.push(`Already in the table, left out: ${plan.skipped.join(', ')}`);
  if (plan.unmatched.length) lines.push(`${plan.unmatched.length} of ${plan.rows} rows match no study: ${[...new Set(plan.unmatched)].slice(0, 6).join('; ')}${new Set(plan.unmatched).size > 6 ? '…' : ''}`);
  return lines.join('\n');
}

/** Adds the planned columns and writes their cells. A locked cell is left alone. Returns a sentence, or { refused }. */
export function applyColumns(plan, { file = 'file' } = {}) {
  const s = get();
  if (plan.templateId !== 'default' && !templateById(plan.templateId, s)) return { refused: 'The table is gone.' };
  const taken = new Set(columnsOf(plan.templateId, s).map(c => fold(c.label)));
  let added = 0, written = 0, locked = 0;
  for (const c of plan.columns) {
    if (taken.has(fold(c.label))) continue;
    const id = addTableColumn({ templateId: plan.templateId, label: c.label, options: c.type === 'category' || c.multiple ? c.levels : [], multiple: c.multiple, type: c.type,
      why: `From ${file}`, armCells: c.cells.some(x => x.arm) });
    if (!id) continue;
    added++;
    for (const x of c.cells) {
      const cellId = x.arm ? `${id}@${x.arm}` : id;
      if (isLocked(get(), `${x.paperId}:${cellId}`)) { locked++; continue; }
      const num = c.type === 'number' ? Number(x.value.replace(',', '.')) : null;
      if (setAnchoredValue(x.paperId, cellId, { reported_value: x.value, normalized_value: Number.isFinite(num) ? num : x.value, origin: 'reported', extractor: `import:${file}`,
        evidence: [], rationale: `From ${file}` })) written++;
    }
  }
  if (!added) return { refused: 'No column was added.' };
  return `${added} ${added === 1 ? 'column' : 'columns'} added with ${written} ${written === 1 ? 'value' : 'values'}${locked ? ` (${locked} locked, left empty)` : ''}`;
}

/** The menu command: reads the file, asks once with what would be added and left out, then adds. Returns the message the page shows. */
export async function addColumnsFromFile(file, templateId) {
  const { confirmAsk } = await import('./dialog.mjs');
  const plan = planColumns(get(), templateId, parseColumnsFile(await file.text(), file.name)), n = plan.columns.length;
  if (!n) return plan.skipped.length ? 'Every column of the file is already in the table' : 'No column of the file matched a study';
  if (!await confirmAsk(`Add ${n} ${n === 1 ? 'column' : 'columns'} from ${file.name}?`, { detail: describePlan(plan), confirm: 'Add' })) return '';
  const out = applyColumns(plan, { file: file.name });
  return out.refused || out;
}

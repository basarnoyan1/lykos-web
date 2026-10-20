import { SHEET_ASK, fence } from './prompts.mjs';
// Selection and review rules shared by the workbook and delimited-file viewer.
// Model replies are proposals against an exact snapshot, never direct writes.
export const MAX_SELECTION = 500;
export const colName = index => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};
export function position(ref) {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(String(ref).trim().toUpperCase());
  if (!m) throw new Error(`Invalid cell: ${ref}`);
  const row = Number(m[2]) - 1, col = [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  if (row >= 1048576 || col >= 16384) throw new Error(`Cell outside worksheet: ${ref}`);
  return { row, col };
}
export function cellRange(from, to, limit = MAX_SELECTION) {
  const a = position(from), b = position(to), cells = [];
  const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row), c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > limit) throw new Error(`Select up to ${limit} cells at a time.`);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(`${colName(c)}${r + 1}`);
  return cells;
}
export function parseSelection(text, limit = MAX_SELECTION) {
  const cells = new Set();
  for (const part of String(text).toUpperCase().split(',').map(x => x.trim()).filter(Boolean)) {
    const ends = part.split(':').map(x => x.trim());
    if (ends.length > 2) throw new Error('Use a range such as A1:C5, or separate cells with commas.');
    for (const cell of cellRange(ends[0], ends[1] || ends[0], limit)) cells.add(cell);
    if (cells.size > limit) throw new Error(`Select up to ${limit} cells at a time.`);
  }
  if (!cells.size) throw new Error('Select at least one cell.');
  return cells;
}
export function selectionLabel(cells) {
  const refs = [...cells].sort((a, b) => { const x = position(a), y = position(b); return x.row - y.row || x.col - y.col; });
  if (!refs.length) return '';
  if (refs.length === 1) return refs[0];
  const points = refs.map(position), rows = points.map(p => p.row), cols = points.map(p => p.col);
  const lo = `${colName(Math.min(...cols))}${Math.min(...rows) + 1}`, hi = `${colName(Math.max(...cols))}${Math.max(...rows) + 1}`;
  if ((Math.max(...cols) - Math.min(...cols) + 1) * (Math.max(...rows) - Math.min(...rows) + 1) === refs.length) return `${lo}:${hi}`;
  return refs.join(', ');
}

// A cell counts as a number when the whole text is one: "12", "-3.5", "1e3", "1,234.5". A percent, a date or "12 mg" is text.
const NUMERIC = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?$|^[+-]?\.\d+(?:e[+-]?\d+)?$/i;
export const numericValue = text => { const t = String(text ?? '').trim(); return NUMERIC.test(t) ? Number(t.replaceAll(',', '')) : null; };
/** What the status line says of a selection: how many cells, and of the numeric ones the sum, mean, minimum and maximum. */
export function selectionStats(values) {
  let cells = 0, numeric = 0, text = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const raw of values) {
    cells++;
    if (!String(raw ?? '').trim()) continue;
    const n = numericValue(raw);
    if (n === null || !Number.isFinite(n)) { text++; continue; }
    numeric++; sum += n; if (n < min) min = n; if (n > max) max = n;
  }
  return { cells, numeric, text, empty: cells - numeric - text, sum: numeric ? sum : null, mean: numeric ? sum / numeric : null, min: numeric ? min : null, max: numeric ? max : null };
}
const figure = n => Number(n.toPrecision(10)).toLocaleString('en', { maximumFractionDigits: 4 });
/** The status text: "12 cells" for text and blanks, and "12 cells · Sum 40 · Mean 3.3 · Min 1 · Max 9" when any cell is a number. One cell says nothing. */
export function statsText(stats) {
  if (!stats || stats.cells < 2) return '';
  const head = `${stats.cells.toLocaleString('en')} cells`;
  if (!stats.numeric) return head;
  return `${head} · Sum ${figure(stats.sum)} · Mean ${figure(stats.mean)} · Min ${figure(stats.min)} · Max ${figure(stats.max)}`;
}

export function parseDelimited(text, delimiter = ',') {
  const bom = text.startsWith('\uFEFF'); if (bom) text = text.slice(1);
  const newline = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
  const trailing = /[\r\n]$/.test(text), rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"' && !value) quoted = true;
    else if (c === delimiter) { row.push(value); value = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error('A quoted field is unfinished. Check the source file before editing.');
  if (value || row.length) { row.push(value); rows.push(row); }
  return { rows, delimiter, newline, trailing, bom };
}
export function writeDelimited(rows, format) {
  const { delimiter = ',', newline = '\n', trailing = false, bom = false } = format;
  const quote = value => { const s = String(value ?? ''); return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return (bom ? '\uFEFF' : '') + rows.map(row => row.map(quote).join(delimiter)).join(newline) + (trailing ? newline : '');
}

export function workbookModel(workbook) {
  const changes = new Map(), history = [], future = [];
  const sheet = name => { const s = workbook.sheets.find(x => x.name === name); if (!s) throw new Error('Worksheet not found.'); return s; };
  const key = (name, cell) => JSON.stringify([name, cell]);
  const original = (name, cell) => { const p = position(cell); return String(sheet(name).rows[p.row]?.[p.col] ?? ''); };
  const value = (name, cell) => changes.get(key(name, cell))?.value ?? original(name, cell);
  const formula = (name, cell) => Object.hasOwn(sheet(name).formulas || {}, cell);
  const put = (name, cell, next) => {
    if (formula(name, cell)) throw new Error(`${cell} contains a formula. Formula cells are read-only in this viewer.`);
    const v = String(next); if (v === original(name, cell)) changes.delete(key(name, cell));
    else changes.set(key(name, cell), { sheet: name, cell, value: v });
  };
  return {
    value, formula, dirty: () => changes.size > 0, edits: () => [...changes.values()].map(e => ({ ...e })),
    canUndo: () => history.length > 0, canRedo: () => future.length > 0,
    apply(edits) {
      const batch = edits.map(e => ({ ...e, before: value(e.sheet, e.cell), value: String(e.value) })).filter(e => e.before !== e.value);
      // Validate the entire batch before changing any cell.
      for (const e of batch) if (formula(e.sheet, e.cell)) throw new Error(`${e.cell} contains a formula.`);
      for (const e of batch) put(e.sheet, e.cell, e.value);
      if (batch.length) { history.push(batch); future.length = 0; }
    },
    undo() { const batch = history.pop(); if (batch) { for (const e of [...batch].reverse()) put(e.sheet, e.cell, e.before); future.push(batch); } },
    redo() { const batch = future.pop(); if (batch) { for (const e of batch) put(e.sheet, e.cell, e.value); history.push(batch); } },
    saved(edits) {
      for (const e of edits) {
        const p = position(e.cell), s = sheet(e.sheet); (s.rows[p.row] ||= [])[p.col] = e.value;
        if (changes.get(key(e.sheet, e.cell))?.value === e.value) changes.delete(key(e.sheet, e.cell));
      }
    },
    snapshot(name, cells) {
      if (!cells.size || cells.size > MAX_SELECTION) throw new Error(`Select between 1 and ${MAX_SELECTION} cells.`);
      const result = { sheet: name, selection: selectionLabel(cells), cells: [...cells].map(cell => ({ cell, value: value(name, cell),
        ...(formula(name, cell) ? { formula: sheet(name).formulas[cell] || '(shared formula)' } : {}) })) };
      if (JSON.stringify(result).length > 50000) throw new Error('This selection contains too much text. Select fewer cells.');
      return result;
    },
  };
}

export function spreadsheetMessages(snapshot, question, suggest = false) {
  return [
    { role: 'system', content: SHEET_ASK.text(suggest) },
    { role: 'user', content: `Request: ${question}\n\nSelected worksheet data:\n${fence('cells', JSON.stringify(snapshot))}` },
  ];
}
export function parseSuggestions(raw, snapshot) {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const result = JSON.parse(text);
  if (!result || typeof result.answer !== 'string' || !Array.isArray(result.edits)) throw new Error('The model did not return a reviewable set of suggestions. Try again.');
  const selected = new Map(snapshot.cells.map(c => [c.cell, c])), seen = new Set();
  const edits = result.edits.map(e => {
    const source = selected.get(e?.cell);
    if (!source || seen.has(e.cell) || Object.hasOwn(source, 'formula') || e.before !== source.value ||
      typeof e.after !== 'string' || e.after.length > 10000 || typeof e.reason !== 'string')
      throw new Error('The reply included an invalid or out-of-selection edit. No changes were applied.');
    seen.add(e.cell);
    return { sheet: snapshot.sheet, cell: e.cell, before: e.before, after: e.after, reason: e.reason, checked: true };
  }).filter(e => e.before !== e.after);
  return { answer: result.answer, edits };
}
export function reviewedEdits(proposals, model) {
  const chosen = proposals.filter(e => e.checked);
  for (const e of chosen) if (model.value(e.sheet, e.cell) !== e.before || model.formula(e.sheet, e.cell))
    throw new Error(`${e.sheet}!${e.cell} changed since this suggestion. Ask for fresh suggestions.`);
  return chosen.map(e => ({ sheet: e.sheet, cell: e.cell, value: e.after }));
}

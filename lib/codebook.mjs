// The extraction codebook (plan G1, G8): one row per field of the built-in
// table, with what a field holds and how it is filled — its type, unit,
// whether it is required, the values or range it admits, its pattern, its
// definition and the instructions an extractor follows. Exported as CSV and
// as a Word table beside the data, so the data can be read without the app.
import { DEFINITIONS } from './extraction-check.mjs';
import { splitField, outcomeById, timepointLabel } from './outcomes.mjs';
import { splitCellId } from './arms.mjs';

export const CODEBOOK_COLUMNS = ['Field', 'ID', 'Type', 'Unit', 'Required', 'Allowed values', 'Range', 'Pattern', 'Outcome', 'Timepoint', 'Arm', 'Definition', 'Instructions'];
const TYPE = { text: 'Text', number: 'Number', integer: 'Whole number', category: 'Category' };

/** The codebook of a set of fields (the built-in table's `fields(s)`), as rows under CODEBOOK_COLUMNS. */
export function codebookRows(s, fieldList) {
  return fieldList.map(f => {
    const { columnId, arm } = splitCellId(f.id);
    const { base, outcomeId } = splitField(columnId);
    const input = f.analysis && f.family !== 'dta';
    const oc = input ? outcomeById(s, outcomeId) : null;
    const range = [Number.isFinite(f.min) ? `≥ ${f.min}` : '', Number.isFinite(f.max) ? `≤ ${f.max}` : ''].filter(Boolean).join(', ');
    return [f.label, f.id, TYPE[f.type] || f.type || '', f.unit || '', f.required ? 'Yes' : '',
      (f.type === 'category' ? f.options || [] : f.allowed || []).join('; '), range, f.pattern || '',
      oc ? oc.name : '', input ? timepointLabel(s, outcomeId) : '', arm ? arm.replace('arm', 'Arm ') : '',
      f.definition || DEFINITIONS[base] || '', f.instructions || f.guidance || ''];
  });
}

const cell = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const codebookCsv = rows => [CODEBOOK_COLUMNS, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n';

/** The codebook as document blocks (a heading and a table), for the Word writer; columns left empty in every row are dropped. */
export function codebookBlocks(rows, title = 'Extraction codebook') {
  const keep = CODEBOOK_COLUMNS.map((_, i) => i).filter(i => i < 3 || rows.some(r => String(r[i] ?? '').trim()));
  return [{ id: 'cb1', type: 'h2', text: title },
    { id: 'cb2', type: 'table', header: true, rows: [keep.map(i => CODEBOOK_COLUMNS[i]), ...rows.map(r => keep.map(i => String(r[i] ?? '')))] }];
}

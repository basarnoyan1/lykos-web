// A row of an answer's table that is about one study of the project: which study, from the cell that names it. The cell is the opener of the
// study (the same place a paper row of the chat opens), so a table of included studies is not a dead end. A label shared by two records, or a
// cell that names none, resolves to nothing and the row stays plain.
import { normName } from './project-query.mjs';

const NAMING = /^(study|study label|paper|paper title|citation|reference|record|record id|id)$/;
const norm = s => normName(String(s ?? '').replace(/<[^>]*>/g, ''));

/** The column that carries the opener, and for each row the record it names: { col, ids: [id | null] }, or null when the table names no study. */
export function studyColumn(state, columns, rows) {
  const cols = (columns || []).map((c, j) => [norm(c), j]).filter(([n]) => NAMING.test(n));
  if (!cols.length) return null;   // before the library is read: most tables name no study
  const papers = state?.papers || [];
  if (!papers.length) return null;
  const byId = new Map(papers.map(p => [String(p.id), p])), byLabel = new Map();
  for (const p of papers) for (const k of new Set([p.label, p.title].map(norm).filter(Boolean))) byLabel.set(k, byLabel.has(k) ? null : p);
  const resolve = row => {
    for (const [, j] of cols) {
      const cell = String(row[j] ?? '').trim(); if (!cell) continue;
      const p = byId.get(cell) || byLabel.get(norm(cell));
      if (p) return p;
    }
    return null;
  };
  const ids = rows.map(r => resolve(r)?.id ?? null);
  if (!ids.some(id => id != null)) return null;
  // the opener sits in the leading naming column, the one a reader takes for the row's name
  const col = cols.find(([n]) => n !== 'id' && n !== 'record id')?.[1] ?? cols[0][1];
  return { col, ids };
}

// Study-level data out as a table for the packages reviews are analysed in (plan §4.15f): R's metafor, Stata's meta suite and Comprehensive
// Meta-Analysis. One table per dichotomous or continuous outcome, a row per study, the inputs only; each package computes its own effects.
// The column names are the arguments those packages take (metafor escalc: ai n1i ci n2i, m1i sd1i n1i m2i sd2i n2i; Stata meta esize: n11 n12
// n21 n22, n1 m1 sd1 n2 m2 sd2); CMA names its columns when the table is pasted, so the headings are descriptive.
import { csvSafe } from './csv-safe.mjs';
import { measureOf } from './effect-measures.mjs';
import { shownOutcomes } from './outcomes.mjs';
import { isIncluded } from './screen.mjs';
import { studyRows } from './analysis-inputs.mjs';

export const LAYOUTS = [['r', 'R (metafor)'], ['stata', 'Stata (meta)'], ['cma', 'Comprehensive Meta-Analysis']];
const HEAD = {
  r: { binary: ['ai', 'n1i', 'ci', 'n2i'], continuous: ['m1i', 'sd1i', 'n1i', 'm2i', 'sd2i', 'n2i'] },
  stata: { binary: ['n11', 'n12', 'n21', 'n22'], continuous: ['n1', 'm1', 'sd1', 'n2', 'm2', 'sd2'] },
  cma: { binary: ['Events (treatment)', 'Total (treatment)', 'Events (control)', 'Total (control)'], continuous: ['Mean (treatment)', 'SD (treatment)', 'N (treatment)', 'Mean (control)', 'SD (control)', 'N (control)'] },
};
const cell = v => { const t = csvSafe(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** Values in the package's column order: Stata wants non-events and puts N first for continuous data. */
function arrange(layout, family, v) {
  if (layout === 'stata') return family === 'binary' ? [v[0], v[1] - v[0], v[2], v[3] - v[2]] : [v[2], v[0], v[1], v[5], v[3], v[4]];
  return v;
}

/** [{ outcome, id, measure, csv, rows, left }] for the shown outcomes a table can be made of; `left` counts included studies without complete data. */
export function dataTables(s, layout = 'r') {
  const out = [];
  for (const o of shownOutcomes(s)) {
    const family = measureOf(o.measure).family;
    if (family !== 'binary' && family !== 'continuous') continue;
    const rows = []; let left = 0;
    for (const p of (s.papers || []).filter(x => isIncluded(s, x.id))) for (const r of studyRows(s, p, o.measure, o.id)) {
      if (!r.values || r.values.some(x => x == null || !Number.isFinite(x))) { left++; continue; }
      rows.push([layout === 'cma' ? 'Study name' : 'study', r.label || p.label, p.year || '', ...arrange(layout, family, r.values)].slice(1));
    }
    if (!rows.length) continue;
    const head = [layout === 'cma' ? 'Study name' : 'study', ...(layout === 'cma' ? [] : ['year']), ...HEAD[layout][family]];
    const body = rows.map(r => layout === 'cma' ? [r[0], ...r.slice(2)] : r);
    out.push({ outcome: o.name, id: o.id, measure: o.measure, rows: rows.length, left, csv: [head, ...body].map(r => r.map(cell).join(',')).join('\n') + '\n' });
  }
  return out;
}

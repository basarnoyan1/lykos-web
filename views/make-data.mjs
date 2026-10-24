// Make's sources of patient rows (views/make-swimmer.mjs, views/make-survival.mjs): the project's datasets (lib/datasets.mjs) and the
// patient table (lib/ipd.mjs: participants with their column roles, reconstructed curves among them). Each source gives its columns as
// { id, label, kind: 'number' | 'boolean' | 'category' | 'text', unit, role } and its rows with typed readers.
import { unitOf } from '../lib/make-sources.mjs';
import { patientDataset } from '../lib/dataset-analysis-core.mjs';

const TRUE = /^(1|true|yes|y|event|dead|died|death|progressed|progression|failure|failed|revised|revision)$/i, FALSE = /^(0|false|no|n|censored|alive|none)$/i;
const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const bool = v => { if (v === true || v === 1) return true; if (v === false || v === 0) return false; const t = String(v ?? '').trim(); if (!t) return null; return TRUE.test(t) ? true : FALSE.test(t) ? false : null; };

/** The sources on offer: the studies, each dataset, the patient table when it has rows. */
export function sourcesOf(ctx) {
  const out = [{ id: 'studies', label: 'Studies' }];
  for (const d of ctx.datasets || []) if ((d.rows || []).length) out.push({ id: `ds:${d.id}`, label: d.name, dataset: d });
  if ((ctx.participants || []).length && ctx.st) { const d = patientDataset(ctx.st); if (d.rows.length) out.push({ id: 'patients', label: 'Patients', dataset: d, patients: true }); }
  return out;
}
export const sourceById = (sources, id) => sources.find(s => s.id === id) || sources[0];

/** A source's columns with the kind each reads as. */
export function columnsOf(source) {
  if (source.dataset) {
    const d = source.dataset;
    return d.columns.map(c => { const vals = d.rows.map(r => r[c.id]).filter(v => v != null && v !== '');
      const kind = c.type === 'number' || c.type === 'integer' ? 'number' : c.type === 'category' ? 'category' : vals.length && vals.every(v => bool(v) != null) ? 'boolean' : vals.length && vals.every(v => num(v) != null) ? 'number' : new Set(vals.map(String)).size <= 12 && vals.length >= 2 ? 'category' : 'text';
      return { id: c.id, label: c.label, kind, unit: unitOf(c.label), role: c.role || '' }; });
  }
  return [];
}
/** A source's rows: each with `num(col)`, `bool(col)`, `text(col)`, its `label` and `id`. */
export function rowsOf(source) {
  const d = source.dataset, raw = d ? d.rows : [];
  const labelCol = d ? (d.columns.find(c => /^(id|patient|label|name|subject)$/i.test(c.label)) || d.columns[0])?.id : 'label';
  source.labelCol = d ? d.columns.find(c => c.id === labelCol)?.label : 'label';
  return raw.map((r, i) => ({ id: String(d?.rowIds?.[i] ?? r.id ?? i + 1), label: String(r[labelCol] ?? r.label ?? r.id ?? i + 1), num: c => num(r[c]), bool: c => bool(r[c]), text: c => String(r[c] ?? '').trim() }));
}

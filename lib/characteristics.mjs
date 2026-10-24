// The study characteristics table — the first table of a review's results —
// from the extraction grid: one row per included study, the descriptive
// fields as columns, counts as "treated / control". Built only from what was
// extracted; an empty cell is empty. Exported as CSV, Markdown or a Word
// table, or added to the manuscript as its first table.
import { fields } from './fields.mjs';
import { isIncluded } from './screen.mjs';
import { projectMode, projectName } from './workflow.mjs';

const DESCRIPTIVE = ['design', 'population', 'intervention', 'comparator', 'outcome', 'followup'];

export function characteristics(s) {
  const papers = (s.papers || []);
  const screened = projectMode(s) !== 'workspace' && papers.some(p => s.screening?.[p.id]);
  const studies = screened ? papers.filter(p => isIncluded(s, p.id)) : papers;
  const all = fields(s);
  const val = (p, id) => { const v = s.values?.[`${p.id}:${id}`]; return v ? String(v.reported_value ?? v.normalized_value ?? '') : ''; };
  const custom = all.filter(f => f.custom && studies.some(p => val(p, f.id)));
  const cols = ['Study', 'Year', ...DESCRIPTIVE.map(id => all.find(f => f.id === id)?.label || id), 'N (treated / control)', ...custom.map(f => f.label)];
  const rows = studies.map(p => [p.label || '', String(p.year || ''), ...DESCRIPTIVE.map(id => val(p, id)),
    [val(p, 'n_t'), val(p, 'n_c')].some(Boolean) ? `${val(p, 'n_t') || '—'} / ${val(p, 'n_c') || '—'}` : '',
    ...custom.map(f => val(p, f.id))]);
  // a column nobody filled is not a column
  const keep = cols.map((_, i) => i < 2 || rows.some(r => r[i]));
  return { title: projectName(s), columns: cols.filter((_, i) => keep[i]), rows: rows.map(r => r.filter((_, i) => keep[i])), studies: studies.length };
}

const cell = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const toCsv = t => [t.columns, ...t.rows].map(r => r.map(cell).join(',')).join('\n') + '\n';
export const toMarkdown = t => [`| ${t.columns.join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`,
  ...t.rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
export const toBlocks = t => [
  { id: 'c1', type: 'h2', text: 'Table 1. Characteristics of included studies' },
  { id: 'c2', type: 'table', header: true, rows: [t.columns, ...t.rows] },
];

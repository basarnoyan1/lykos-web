// A publication table's workbook as a template: the data sheet's header names
// the columns; the definitions sheet, when there is one, is the codebook —
// what goes in the cell, examples, why — and its Conventions block travels
// with the template. Plan G1 calls this the codebook and schema; here it is
// read from the file the review team already keeps.
import { familyName } from './bib.mjs';

export const slug = label => String(label || '').toLowerCase().normalize('NFKD')
  .replace(/[^\w\s]/g, ' ').replace(/[\s_]+/g, '_').replace(/^_|_$/g, '') || 'column';

const norm = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();   // accents and Turkish i folded: Özer is ozer, not zer
const tokens = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !['and', 'the', 'for', 'per'].includes(w)));
function overlap(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

const isDefinitions = rows => rows[0] && norm(rows[0][0]) === 'column' && /what goes in/i.test(rows[0][1] || '');

export function templateFromWorkbook(wb, { id, name, file }) {
  const warnings = [];
  const defsSheet = wb.sheets.find(s => isDefinitions(s.rows));
  const dataSheet = wb.sheets.find(s => s !== defsSheet && s.rows.some(r => r.some(Boolean)));
  if (!dataSheet) throw new Error('no table in the workbook');
  const header = dataSheet.rows.find(r => r.filter(Boolean).length >= 2) || [];
  const headerAt = dataSheet.rows.indexOf(header);
  const columns = [];
  const taken = new Set();
  header.forEach((label, i) => {
    if (!String(label).trim()) return;
    let base = slug(label), sid = base, n = 1;
    while (taken.has(sid)) sid = `${base}_${++n}`;
    taken.add(sid);
    columns.push({ id: `${id}.${sid}`, label: String(label).trim(), type: 'text', guidance: '', examples: '', why: '', col: i });
  });
  const conventions = [];
  if (defsSheet) {
    const rows = defsSheet.rows;
    let inConventions = false;
    for (const r of rows.slice(1)) {
      const first = String(r[0] || '').trim();
      if (norm(first) === 'conventions') { inConventions = true; continue; }
      if (inConventions) { if (first) conventions.push(first); continue; }
      if (!first) continue;
      let best = null, score = 0;
      for (const c of columns) { const o = overlap(first, c.label); if (o > score) { score = o; best = c; } }
      if (best && score >= 0.34) { best.guidance = String(r[1] || '').trim(); best.examples = String(r[2] || '').trim(); best.why = String(r[3] || '').trim(); }
      else warnings.push(`definition "${first}" matched no column`);
    }
  } else warnings.push('no column definitions sheet; guidance is empty');
  const rows = [];
  dataSheet.rows.slice(headerAt + 1).forEach((r, k) => {
    const cells = {};
    let any = false;
    for (const c of columns) { const v = String(r[c.col] ?? '').trim(); cells[c.id] = v; if (v && c.col !== 0) any = true; }
    if (any) rows.push({ index: headerAt + 1 + k, cells });
  });
  const template = { id, name, orientation: 'studies-rows',
    source: { file, sheet: dataSheet.name, importedAt: new Date().toISOString() },
    conventions, columns: columns.map(({ col, ...c }) => c) };
  // where the table sits in the file, for provenance: the sheet and the column each template column was read from
  const layout = { sheet: dataSheet.name, cols: Object.fromEntries(columns.map(c => [c.id, c.col])) };
  return { template, rows, warnings, layout };
}

const DOI = /\b(10\.\d{4,9}\/[^\s"'<>()\]]+)/i;
const cleanDoi = d => d.replace(/[.,;:)\]]+$/, '').toLowerCase();
// "Smith 2024", "Smith et al., 2024", "Di Silvestre et al., 2010, Italy", "Özer 2022": a surname of one or more words (particles such as Di, van, de
// included), an optional "et al." or "and X", then the year
const LABEL = /^(\p{Lu}[\p{L}'’-]*(?:\s+(?:\p{Lu}[\p{L}'’-]*|di|da|de|del|della|van|von|der|den|le|la|du|dos|el|al))*)(?:\s+et\s+al\.?|\s+and\s+[\p{L}'’-]+)?,?\s+(\d{4}[a-z]?)\b/u;   // a letter after the year (Kaner 2010a, 2010b) tells two reports apart

/** "Surname year" of a cell that names a study ("Di Silvestre et al., 2010, Italy" → "di silvestre 2010"), or '' when it names none. */
export function studyKey(text) { const m = String(text ?? '').trim().match(LABEL); return m ? norm(`${m[1]} ${m[2]}`) : ''; }
/** A record's own "Surname year" as studyKey reads a cell: its label as written. */
export const paperKey = p => norm(p?.label || '');

/** Rows to papers: a DOI anywhere in the row wins; else "Surname ... 2024" against the paper's own surname and year. */
export function matchRows(rows, template, papers) {
  const byDoi = new Map(papers.filter(p => p.doi).map(p => [cleanDoi(String(p.doi).replace(/^https?:\/\/doi\.org\//i, '')), p.id]));
  const labelOf = p => norm(`${p.authors?.[0] ? familyName(p.authors[0]) : (p.label || '').split(' ')[0]} ${p.year || (p.label || '').match(/\d{4}/)?.[0] || ''}`);
  const byLabel = new Map();
  for (const p of papers) for (const l of [labelOf(p), norm(p.label || '')]) if (l && !byLabel.has(l)) byLabel.set(l, p.id);   // the first author's surname, and the paper's own label ("Di Silvestre 2014")
  return rows.map(row => {
    const text = Object.values(row.cells).join(' ');
    const d = text.match(DOI);
    if (d && byDoi.has(cleanDoi(d[1]))) return { row, paperId: byDoi.get(cleanDoi(d[1])), how: 'doi' };
    for (const v of Object.values(row.cells)) {
      const m = String(v).match(LABEL);
      if (m && byLabel.has(norm(`${m[1]} ${m[2]}`))) return { row, paperId: byLabel.get(norm(`${m[1]} ${m[2]}`)), how: 'label' };
    }
    return { row, paperId: null, how: null };
  });
}

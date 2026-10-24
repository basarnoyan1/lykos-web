// Tables from a selection (plan, package amendment of 2026-10-16): the project's evidence table drawn as a grid for chosen studies and fields,
// and any table narrowed to the rows and columns a person keeps. A row is kept by its key (the study, or the study's arm), a column by its
// header, so a selection survives the source being re-sorted or gaining rows. Pure.
import { evidenceModel, valueText } from './evidence-export.mjs';
import { studyGrid } from './arms.mjs';
import { addItem, addPart } from './package.mjs';

// The studies a table may show: as lib/screen.mjs `studies` decides (the final decision is include; every record before screening starts).
const decided = (s, id) => s.fulltext?.[id] || s.screening?.[id] || null;
function included(s) {
  const papers = s.papers || [];
  const started = papers.some(p => decided(s, p.id));
  return new Set(papers.filter(p => !started || decided(s, p.id)?.decision === 'include').map(p => p.id));
}

/**
 * The evidence table as a grid: included studies (of a collection, or the ones named), the fields named (in the template's order) or the publication
 * columns. A table laid out for a paper says more (all optional): `order: 'listed'` keeps the fields and the studies in the order they are named,
 * `labels` renames a column ({ fieldId: 'Deformity share' }), `widths` gives each column a relative width (the table then fills the page's text
 * width, `fit`), `headerShade` fills the header row ('#D9E2F3') and sets it in bold, `compact` sets cells with narrow margins (1.5 pt above
 * and below, 2.5 pt at the sides) and keeps each row on one page, `valueLabels` shows a field's codes as words ({ fieldId: { '1': 'Non-fusion' } })
 * and `pt` and `line` set the table's type size and line spacing (1 = single).
 */
export function evidenceGrid(s, { evidence, collection = null, studies = null, fields = null, order = null, labels = null, widths = null, headerShade = null, compact = false, valueLabels = null, pt = null, line = null }) {
  const model = evidenceModel(s, evidence), inc = included(s);
  const members = collection ? new Set((s.collections || []).find(c => c.id === collection)?.members || []) : null;
  const pick = studies ? new Set(studies) : null;
  const listed = order === 'listed';
  const cols = fields ? (listed ? fields.map(f => model.columns.find(c => c.id === f)).filter(Boolean) : model.columns.filter(c => fields.includes(c.id))) : model.sheetColumns;
  const rows = [{ header: true, key: '', cells: cols.map(c => { const t = String(labels?.[c.id] ?? c.label ?? ''); return { text: t, ...(headerShade ? { shade: headerShade, runs: [{ t, b: true }] } : {}) }; }) }];
  const chosen = model.studies.filter(st => inc.has(st.paperId) && (!members || members.has(st.paperId)) && (!pick || pick.has(st.paperId)));
  if (listed && studies) chosen.sort((a, b) => studies.indexOf(a.paperId) - studies.indexOf(b.paperId));
  for (const st of chosen) {
    const g = studyGrid(model.template, model.values, st.paperId, cols, { empty: 'study' });
    for (let r = 0; r < g.rows; r++) {
      // `compact`: a study's arm rows stay on one page together (each but the last keeps with the next)
      rows.push({ header: false, key: g.rows > 1 ? `${st.paperId}@${g.arms[r].id}` : st.paperId, ...(compact && r < g.rows - 1 ? { keepNext: true } : {}),
        cells: g.cells[r].map((x, c) => (x ? { text: (t => valueLabels?.[cols[c].id]?.[t] ?? t)(valueText(x.value)) } : { merged: 'up' })) });
    }
  }
  const even = Math.round(468 / Math.max(1, cols.length));
  const w = Array.isArray(widths) && widths.length === cols.length && widths.every(x => Number(x) > 0) ? widths.map(Number) : null;
  return { cols: w ? w.map(x => x * 100) : cols.map(() => even), ...(w ? { fit: true } : {}), ...(compact ? { cellMargin: [1.5, 2.5], keepRows: true } : {}), ...(Number(pt) > 0 ? { sz: Number(pt) } : {}), ...(Number(line) > 0 ? { line: Number(line) } : {}), borders: 'all', rows, colIds: cols.map(c => c.id) };
}

export const rowKeyOf = row => row.key || String(row.cells?.[0]?.text ?? '');
export const colKeyOf = (grid, c) => String(grid.rows[0]?.cells[c]?.text ?? '');
const allKeys = grid => ({ rows: grid.rows.slice(1).map(rowKeyOf), cols: (grid.rows[0]?.cells || []).map((_, c) => colKeyOf(grid, c)) });

/** The grid with only the rows and columns `keep` names (the header row always); without `keep`, the grid itself. */
export function applyKeep(grid, keep) {
  if (!keep || !grid.rows?.length) return grid;
  const cols = grid.rows[0].cells.map((_, c) => c).filter(c => !keep.cols || keep.cols.includes(colKeyOf(grid, c)));
  const rows = grid.rows.filter((r, i) => i === 0 || !keep.rows || keep.rows.includes(rowKeyOf(r)));
  return { ...grid, cols: cols.map(c => grid.cols?.[c]), ...(grid.colIds ? { colIds: cols.map(c => grid.colIds[c]) } : {}),
    rows: rows.map(r => ({ ...r, cells: cols.map(c => r.cells[c]) })) };
}

/** A row or column dropped, or brought back in its place; the first toggle from "everything" lists every key but the one toggled. */
export function toggleKeep(keep, grid, { row = null, col = null }) {
  const all = allKeys(grid), next = { rows: keep?.rows ? [...keep.rows] : null, cols: keep?.cols ? [...keep.cols] : null };
  const flip = (list, every, k) => { const l = list || [...every]; return l.includes(k) ? l.filter(x => x !== k) : every.filter(x => x === k || l.includes(x)); };
  if (row != null) next.rows = flip(next.rows, all.rows, row);
  if (col != null) next.cols = flip(next.cols, all.cols, col);
  return { ...(next.rows ? { rows: next.rows } : {}), ...(next.cols ? { cols: next.cols } : {}) };
}

const target = (pkg, where) => where.partId || addPart(pkg, { name: where.newPart.name, prefix: where.newPart.prefix || '', file: where.newPart.file }).id;

/**
 * A new table from an item's selection, in a part or a new one. An evidence table is narrowed in its source (the studies and fields kept), so
 * it follows the values; any other table is copied with its `keep`. The original item is unchanged.
 */
export function fromSelection(pkg, itemId, where, s) {
  const it = pkg.items[itemId];
  if (!it) throw new Error(`no item ${itemId}`);
  const partId = target(pkg, where), base = { kind: 'table', title: it.title, legend: it.legend, notes: it.notes };
  if (it.source?.evidence) {
    const g = evidenceGrid(s, it.source), keep = it.keep || {};
    const fields = g.colIds.filter((_, c) => !keep.cols || keep.cols.includes(colKeyOf(g, c)));
    const studies = keep.rows ? [...new Set(keep.rows.map(k => k.split('@')[0]))] : it.source.studies;
    const source = { evidence: it.source.evidence, ...(it.source.collection && !keep.rows ? { collection: it.source.collection } : {}), ...(studies ? { studies: [...studies] } : {}), fields };
    const item = addItem(pkg, partId, { ...base, source });
    // one arm of a study kept: the study is in the source, the arm rows stay a selection
    if (keep.rows?.some(k => k.includes('@'))) item.keep = { rows: [...keep.rows] };
    return item;
  }
  const item = addItem(pkg, partId, { ...base, source: structuredClone(it.source) });
  if (it.keep) item.keep = structuredClone(it.keep);
  return item;
}

/** A table of the evidence table's studies and fields in view (Extraction, More, Make a table from this view…). */
export function tableFromView(pkg, { templateId, studies, fields, title = '' }, where) {
  return addItem(pkg, target(pkg, where), { kind: 'table', source: { evidence: templateId, studies: [...studies], fields: [...fields] }, title });
}

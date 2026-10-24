// The rows of a studies-as-rows extraction table when studies have arms
// (lib/arms.mjs): one row per arm, the study-level cells spanning the arm
// rows, as the publication table merges them. The extraction view hands in
// how it draws a cell and the study heading; this module
// only lays them out, so a click on an arm's cell carries that arm's cell id
// ("column@arm2") and edits that arm.
import { studyGrid, splitCellId } from '../lib/arms.mjs';
import { esc } from '../lib/html.mjs';

const spanned = (html, span) => span > 1 ? html.replace(/^<(td|th)\b/, `<$1 rowspan="${span}"`) : html;

/**
 * The tbody rows. `cell(paper, column, cellId)` returns a cell's HTML (a
 * `<td>`), `head(paper)` the study's row heading (a `<th>`), which spans the
 * study's arm rows. `detail(paper)`, when given, returns rows that follow the study's own (the fields the grid had no room for); `lead(paper)`,
 * when given, a cell before the heading (the row's number and its selection), spanning the arm rows as the heading does.
 */
export function armRowsHtml({ template, values, papers, cols, cell, head, detail = null, lead = null }) {
  const byId = new Map(cols.map(c => [c.id, c]));
  return papers.map(p => {
    const g = studyGrid(template, values, p.id, cols);
    return g.cells.map((row, r) => {
      const cells = row.filter(Boolean).map(x => spanned(cell(p, byId.get(x.columnId), x.arm ? `${x.columnId}@${x.arm}` : x.columnId), x.span)).join('');
      const cls = g.rows > 1 ? ` class="arm-row${r === 0 ? ' arm-first' : ''}${r === g.rows - 1 ? ' arm-last' : ''}"` : '';
      return r === 0
        ? `<tr data-row="${esc(p.id)}"${cls}>${lead ? spanned(lead(p), g.rows) : ''}${spanned(head(p), g.rows)}${cells}</tr>`
        : `<tr${cls}>${cells}</tr>`;
    }).join('') + (detail ? detail(p) : '');
  }).join('');
}

/** The cell id drawn for a column in a study's arm row (the study's own cell when it spans). */
export function drawnCellId(template, values, paperId, cols, columnId, armIndex = 0) {
  const g = studyGrid(template, values, paperId, cols);
  const ci = cols.findIndex(c => c.id === columnId);
  for (let r = Math.min(armIndex, g.rows - 1); r >= 0; r--) {
    const x = g.cells[r][ci];
    if (x) return x.arm ? `${x.columnId}@${x.arm}` : x.columnId;
  }
  return columnId;
}

/** The arm row a cell id sits in (0 for a study-level cell). */
export const armIndexOf = id => { const a = splitCellId(id).arm; return a ? Number(a.slice(3)) - 1 : 0; };

/** A column with its arm's label added, for the evidence panel's heading. */
export function armColumn(template, paperId, column, cellId) {
  const { arm } = splitCellId(cellId);
  if (!arm) return column;
  const a = (template?.arms?.[paperId] || []).find(x => x.id === arm);
  return { ...column, label: `${column.label} (${a?.label || arm})` };
}

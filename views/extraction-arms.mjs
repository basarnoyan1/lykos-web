// The rows of a studies-as-rows extraction table when studies have arms
// (lib/arms.mjs): one row per arm, the study-level cells spanning the arm
// rows, as the publication table merges them. The extraction view hands in
// how it draws a cell and the study heading; this module
// only lays them out, so a click on an arm's cell carries that arm's cell id
// ("column@arm2") and edits that arm.
import { lib_arms$studyGrid as studyGrid, lib_arms$splitCellId as splitCellId } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { entriesOf, entryName, splitEntry } from '../lib/outcome-store.mjs';

const spanned = (html, span) => span > 1 ? html.replace(/^<(td|th)\b/, `<$1 rowspan="${span}"`) : html;
const isOutcome = c => c.group === 'outcome';
const idOf = x => (x.arm ? `${x.columnId}@${x.arm}` : x.columnId);

/** The column a drawn cell belongs to: an arm's cell ("column@arm2") and an outcome entry's statistic ("column~o1@arm2") are their column's. */
export const columnIdOf = id => splitEntry(splitCellId(id).columnId).column;
/** An outcome entry's statistic as a cell id: "column~o1", or "column~o1@arm2" in a study with arms. */
export const entryCellId = (columnId, entry, arm = null) => `${columnId}~${entry}${arm ? `@${arm}` : ''}`;

/**
 * A study's outcome entries as the grid draws them (lib/outcome-store.mjs): one line per entry and arm, named "instrument, time; arm".
 * `s` is the project: its instruments name a coded entry by their label.
 */
export const entryLines = (s, template, paperId) => linesOf(template, paperId)
  .map(({ entry, arm, armLabel }) => ({ entry, arm, name: [entryName(s, template, paperId, entry, arm), armLabel].filter(Boolean).join('; ') }));
// the lines alone, unnamed: what moving and measuring need, for every study on every draw
function linesOf(template, paperId) {
  const arms = (template?.arms?.[paperId] || []).length ? template.arms[paperId] : [{ id: null, label: '' }];
  return entriesOf(template, paperId).filter(e => !e.none).flatMap(e => arms.map(a => ({ entry: e.id, arm: a.id, armLabel: a.label })));
}

/**
 * The tbody rows. `cell(paper, column, cellId)` returns a cell's HTML (a
 * `<td>`), `head(paper)` the study's row heading (a `<th>`), which spans the
 * study's arm rows. `detail(paper)`, when given, returns rows that follow the study's own (the fields the grid had no room for); `lead(paper)`,
 * when given, a cell before the heading (the row's number and its selection), spanning the arm rows as the heading does. `state` is the
 * project, for the entries' names (the values alone when not given).
 */
export function armRowsHtml({ template, values, state = { values }, papers, cols, cell, head, detail = null, lead = null }) {
  // an outcome entry's statistics (lib/outcome-store.mjs) are rows of their own after the study's arm rows: one per entry and arm, named in
  // the study column (under the study's heading, which spans its arm rows; a row's detail names its rows there too), its outcome columns
  // holding that entry's cells ("column~o1@arm2") and its other columns blank; in the study's arm rows the outcome columns are blank
  const byId = new Map(cols.map(c => [c.id, c]));
  const outcome = cols.filter(isOutcome), plain = outcome.length ? cols.filter(c => !isOutcome(c)) : cols, at = new Map(plain.map((c, i) => [c.id, i]));
  return papers.map(p => {
    const g = studyGrid(template, values, p.id, plain);
    const extra = outcome.length ? entryLines(state, template, p.id) : [], span = g.rows + extra.length;
    const rows = g.cells.map((row, r) => {
      const drawn = x => (x ? spanned(cell(p, byId.get(x.columnId), idOf(x)), x.span) : '');
      const cells = outcome.length ? cols.map(c => (isOutcome(c) ? '<td class="entry-blank"></td>' : drawn(row[at.get(c.id)]))).join('') : row.filter(Boolean).map(drawn).join('');
      const cls = span > 1 ? ` class="arm-row${r === 0 ? ' arm-first' : ''}${r === span - 1 ? ' arm-last' : ''}"` : '';
      return r === 0
        ? `<tr data-row="${esc(p.id)}"${cls}>${lead ? spanned(lead(p), span) : ''}${spanned(head(p), g.rows)}${cells}</tr>`
        : `<tr${cls}>${cells}</tr>`;
    });
    extra.forEach((l, i) => {
      const cells = cols.map(c => (isOutcome(c) ? cell(p, c, entryCellId(c.id, l.entry, l.arm)) : '<td class="entry-blank"></td>')).join('');
      const cls = ['arm-row', 'entry-line', g.rows + i === span - 1 ? 'arm-last' : ''].filter(Boolean).join(' ');
      rows.push(`<tr class="${cls}" data-entry="${esc(l.entry)}"><th scope="row" class="entry-name">${esc(l.name)}</th>${cells}</tr>`);
    });
    return rows.join('') + (detail ? detail(p) : '');
  }).join('');
}

/**
 * The cell each row a study draws holds in each of `cols`: its arm rows (a cell that spans them is drawn in each), then its outcome
 * entries' lines. null where a row draws no cell: an outcome column in an arm row, any other column in an entry line.
 */
export function studyRows(s, template, paperId, cols) {
  const outcome = cols.some(isOutcome), plain = outcome ? cols.filter(c => !isOutcome(c)) : cols, at = new Map(plain.map((c, i) => [c.id, i]));
  const g = studyGrid(template, s?.values || {}, paperId, plain);
  const drawn = (r, i) => { for (let k = r; k >= 0; k--) { const x = g.cells[k][i]; if (x) return idOf(x); } return null; };
  const rows = g.cells.map((_, r) => cols.map(c => (outcome && isOutcome(c) ? null : drawn(r, at.get(c.id)))));
  if (outcome) for (const l of linesOf(template, paperId)) rows.push(cols.map(c => (isOutcome(c) ? entryCellId(c.id, l.entry, l.arm) : null)));
  return rows;
}

/** Every cell a study draws, once each, in the table's order (rows, then columns): the cells a run over a study's row reaches. */
export const studyCellIds = (s, template, paperId, cols) => [...new Set(studyRows(s, template, paperId, cols).flat().filter(Boolean))];

/**
 * Where an arrow key takes the selection `sel` ({ paperId, columnId }) in a studies-as-rows grid: along its row to the next column that
 * row draws a cell in (`dc` 1 or -1), or along its column to the next cell drawn in it (`dr`): the study's further arm rows and entry
 * lines first, then the next study's. null where there is none. `rowsOf(paperId)` is studyRows for that study.
 */
export function nextCell(papers, cols, sel, dr, dc, rowsOf) {
  const memo = new Map(), rowsAt = i => { if (!memo.has(i)) memo.set(i, rowsOf(papers[i].id)); return memo.get(i); };
  const pi = papers.findIndex(p => p.id === sel.paperId), ci = cols.findIndex(c => c.id === columnIdOf(sel.columnId));
  if (pi < 0 || ci < 0) return null;
  const rows = rowsAt(pi), r = Math.max(0, rows.findIndex(row => row[ci] === sel.columnId));
  if (dc) {
    for (let c = ci + dc; c >= 0 && c < cols.length; c += dc) if (rows[r]?.[c]) return { paperId: sel.paperId, columnId: rows[r][c] };
    return null;
  }
  for (let p = pi, rr = r + dr; ;) {
    const R = rowsAt(p);
    for (; rr >= 0 && rr < R.length; rr += dr) { const id = R[rr][ci]; if (id && (p !== pi || id !== sel.columnId)) return { paperId: papers[p].id, columnId: id }; }
    p += dr;
    if (p < 0 || p >= papers.length) return null;
    rr = dr > 0 ? 0 : rowsAt(p).length - 1;
  }
}

/**
 * The cells a study's row detail lists for the columns the grid had no room for: { column, id, label }. A field's own cell, one per arm
 * ("Age, Sham"); an outcome statistic once per entry and arm ("Change SD, HAM-D17, 12 weeks; Sham"), each its entry's cell.
 */
export function detailCells(s, template, paperId, folded, labelOf) {
  const outcome = folded.filter(isOutcome), plain = folded.filter(c => !isOutcome(c)), out = [];
  const g = studyGrid(template, s?.values || {}, paperId, plain);
  plain.forEach((c, ci) => g.cells.forEach((row, r) => {
    const x = row[ci]; if (!x) return;
    out.push({ column: c, id: idOf(x), label: x.arm ? `${labelOf(c)}, ${g.arms[r]?.label || x.arm}` : labelOf(c) });
  }));
  if (outcome.length) for (const l of entryLines(s, template, paperId)) for (const c of outcome) out.push({ column: c, id: entryCellId(c.id, l.entry, l.arm), label: `${labelOf(c)}, ${l.name}` });
  return out;
}

/** A column with its arm's label (and its outcome entry's name) added, for the evidence panel's heading. */
export function armColumn(template, paperId, column, cellId, s = null) {
  const { columnId, arm } = splitCellId(cellId), { entry } = splitEntry(columnId);
  if (entry) return { ...column, label: `${column.label} (${entryLines(s || { values: {} }, template, paperId).find(l => l.entry === entry && l.arm === arm)?.name || entry})` };
  if (!arm) return column;
  const a = (template?.arms?.[paperId] || []).find(x => x.id === arm);
  return { ...column, label: `${column.label} (${a?.label || arm})` };
}

// The Extraction grid that fits its pane (data summary plan, stage 6). The grid never scrolls sideways: `lib/table-fit.mjs` decides, from text
// measured on the grid's own fonts and from the pane's width alone, how wide each column is and which columns do not fit. A column that does not
// fit is folded: it is drawn as a field of its study's row detail (a chevron in the study cell opens it), and the column picker (More > Columns)
// lets a person choose which fields are columns. A long value wraps; past four lines it is held and "Show all" opens it in place, so no value
// ends in an ellipsis without a way to read it. This module draws the table and keeps its layout; the view (./extraction.mjs) owns the cells,
// the selection and the editor and is called back for them.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { fitColumns, columnSpec, wrapText, measureWords, CLAMP_LINES } from '../lib/table-fit.mjs';
import { windowRows } from '../lib/table-window.mjs';
import { categoryOf, CATEGORIES } from '../lib/outcome-store.mjs';
import { armRowsHtml, detailCells, studyRows, columnIdOf } from './extraction-arms.mjs';

/** A text longer than this is drawn in a clamp box (four lines, then "Show all"); a shorter one can never be cut. */
export const CLAMP_FROM = 40;
const OPENER_ROOM = 24;    // the row opener (20 px) and the gap after it, kept in the study cell's minimum
const DETAIL_INDENT = 24;  // a row detail's label is indented under the opener (research-views.css, tr.ext-detail > th)
const DETAIL_GROUP_MIN = 300;   // a detail's group is at least this wide (ui-components.css .ext-det), so the groups' columns follow the pane
const LABEL_CH = 18;       // a row detail's label column is at least this many characters wide, so a field's label wraps between its words
const LABEL_WORD_CAP = 240;   // ... and as wide as its longest word, up to this

// ---- what is open: lives across redraws of the page, per table ---------------------------------------------------------------
const state = { table: null, rows: new Set(), cells: new Set(), auto: null };
const keep = table => { if (state.table !== table) Object.assign(state, { table, rows: new Set(), cells: new Set(), auto: null }); return state; };
/** Whether the cell with this `paper|cell` key was opened with Show all. */
export const cellIsOpen = key => state.cells.has(key);
/** A cell's text: plain when short, in a clamp box with its Show all control when long (the control shows only when the text is cut). */
export function clampHtml(text, key) {
  const s = String(text ?? '');
  if (s.length <= CLAMP_FROM) return esc(s);
  const open = cellIsOpen(key);
  return `<div class="ext-clamp">${esc(s)}</div><button type="button" class="ext-more" data-more aria-expanded="${open}" aria-label="${open ? 'Show less' : 'Show all'}"></button>`;
}

// ---- measurement: canvas measureText on the grid's own computed fonts, cached -------------------------------------------------
const widths = new Map();   // font -> (text -> px): one map per font, so a lookup joins no strings (a first visit looks up every word of every cell)
let measured = null;   // { key, specs }: the last grid's column specs (createGrid measure)
let canvas = null, canvasFont = '', count = 0;
function width(font, text) {
  let byText = widths.get(font);
  if (!byText) widths.set(font, byText = new Map());
  let w = byText.get(text);
  if (w === undefined) {
    canvas ||= document.createElement('canvas').getContext('2d');
    if (canvas) { if (canvasFont !== font) canvas.font = canvasFont = font; w = canvas.measureText(text).width * 1.02 + 0.5; } else w = text.length * 7;   // a little over: the DOM's own advance may differ by a fraction
    if (++count > 60000) { widths.clear(); count = 0; widths.set(font, byText = new Map()); }
    byText.set(text, w);
  }
  return w;
}
/** The grid's fonts, padding and row height, read from a probe table that has the grid's own classes. */
function metricsOf(host) {
  const probe = document.createElement('table');
  probe.className = 'ext-grid ext-probe';
  probe.setAttribute('aria-hidden', 'true');
  probe.innerHTML = '<thead><tr><th scope="col">x</th></tr></thead><tbody><tr><th scope="row">x</th><td class="cell">x</td></tr></tbody>';
  host.appendChild(probe);
  // (the computed `font` shorthand is empty when a longhand such as tabular figures is set: the canvas font is put together from its parts)
  const cs = e => getComputedStyle(e), th = probe.querySelector('thead th'), rh = probe.querySelector('tbody th'), td = probe.querySelector('td');
  const fontOf = e => { const c = cs(e); return `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`; };
  const m = { head: fontOf(th), rowHead: fontOf(rh), cell: fontOf(td),
    pad: (parseFloat(cs(td).paddingLeft) || 12) + (parseFloat(cs(td).paddingRight) || 12),
    line: parseFloat(cs(td).lineHeight) || 19.5, row: probe.querySelector('tbody tr').getBoundingClientRect().height || 28 };
  probe.remove();
  return m;
}

const keyOf = (o, M) => o.measureKey && document.fonts?.status !== 'loading' ? `${o.measureKey}\n${o.rowsMode}\n${M.head}\n${M.cell}\n${M.rowHead}\n${M.pad}` : '';
/** A grid's column specs (createGrid's options `o`, metrics `M`), yielding after each column: primeGrid spreads them over tasks. */
function* specsOf(o, M) {
  const { rowsMode, papers, cols } = o, foot = rowsMode && !!o.foot;
  const head = s => width(M.head, s), cell = s => width(M.cell, s), rowHead = s => width(M.rowHead, s);
  if (rowsMode) {
    const specs = { study: columnSpec({ id: 'study', title: 'Study', texts: papers.map(p => p.label || p.title || 'Untitled'), measureHead: head, measureCell: rowHead, pad: M.pad, cellExtra: OPENER_ROOM, wordCap: 100, pct: 0.75, cap: 200 }), columns: [] };
    for (const [i, c] of cols.entries()) { yield; specs.columns.push(columnSpec({ id: c.id, title: o.label(c), texts: papers.map(p => o.textOf(p, c)), measureHead: head, measureCell: cell, pad: M.pad, priority: i, numeric: !!o.numeric?.(c) })); }
    // the line under a column says "113 of 114" and never breaks inside it: the column is at least as wide as the count at its longest
    if (foot) { const n = width(M.cell, `${papers.length} of ${papers.length}`) + M.pad; for (const x of specs.columns) { x.min = Math.max(x.min, n); x.natural = Math.max(x.natural, x.min); } }
    // the row detail's label column (the study column while fields are folded): LABEL_CH characters, or the longest word of a label
    const words = cols.flatMap(c => measureWords(o.label(c), cell).w);
    specs.label = Math.ceil(M.pad + DETAIL_INDENT + Math.max(cell('0'.repeat(LABEL_CH)), Math.min(LABEL_WORD_CAP, Math.max(0, ...words))));
    return specs;
  }
  const specs = { study: columnSpec({ id: 'study', title: 'Field', texts: cols.map(c => o.label(c)), measureHead: head, measureCell: rowHead, pad: M.pad, cellExtra: OPENER_ROOM, wordCap: 100, pct: 0.75, cap: 200 }), columns: [] };
  for (const [i, p] of papers.entries()) { yield; specs.columns.push(columnSpec({ id: p.id, title: p.label || p.title || 'Untitled', texts: cols.map(c => o.textOf(p, c)), measureHead: head, measureCell: cell, pad: M.pad, priority: i })); }
  return specs;
}
export const SLICE_MS = 30;
/**
 * Measures a grid's columns before its draw, in tasks of about `slice` ms with `turn()` between them, and keeps the specs for a createGrid
 * given the same options (a first visit to a table, Sham 17 Nov 2026: the measuring alone was about 105 ms of one 350 ms task). Returns
 * false when `alive()` turned false between two tasks (nothing is kept then). Nothing to do with no measureKey or while a font loads.
 */
export async function primeGrid(o, { turn, alive = () => true, slice = SLICE_MS }) {
  const M = metricsOf(o.region), key = keyOf(o, M);
  if (!key || measured?.key === key) return true;
  const it = specsOf(o, M);
  let r, from = performance.now();
  while (!(r = it.next()).done) if (performance.now() - from > slice) { await turn(); if (!alive()) return false; from = performance.now(); }
  measured = { key, specs: r.value };
  return true;
}
/** Whether a createGrid given `o` would measure nothing (its specs are kept, or it is not kept at all: no key, a font loading). */
export const gridMeasured = o => { const key = keyOf(o, metricsOf(o.region)); return !key || measured?.key === key; };

/**
 * The grid of a table. `o`: region (the .ui-table-region), templateId, rowsMode (studies as rows; false: fields as rows, studies as columns),
 * papers, cols, t, V, st (the project: what names an outcome entry), hidden (field ids a person put away), cell(p, c, id) (a <td>), textOf(p, c) (what the cell shows; a study's arms each on
 * their own lines), label(c), head(c) (a <th scope=col> of a field), studyHead(p), fieldHead(c, label), rowNote(p) (more about a study for its
 * row head's tooltip), afterRows({ hadFocus }) (the caller restores what it had in the rows: the editor, the focus), windowFrom (the studies
 * above which rows are windowed). With studies as rows: lead (a `{ width, head(), cell(p), blank() }` column before the study's: the row's
 * number and its selection, 2026-10-23) and foot (`{ head(), cell(c) }`: the line under each column, research tools review row 3).
 */
export function createGrid(o) {
  const { region, rowsMode, papers, cols, t, V } = o;
  const S = keep(o.templateId);
  const hidden = o.hidden || new Set();
  const windowed = rowsMode && papers.length > o.windowFrom;
  // the first column (the row's number and tick) is drawn while the pane has room for it (lib/table-fit.mjs LEAD_PANE):
  // in a narrower pane the study and one value come first, as they did before the column was added
  const leadSpec = rowsMode ? o.lead || null : null, foot = rowsMode ? o.foot || null : null;
  let lead = null, leadW = 0;
  let M = null, specs = null, F = null, sig = '', shownC = [], foldedC = [], shownP = [], foldedP = [], win = null, table = null, tbody = null;

  // ---- measuring and fitting ---------------------------------------------------------------------------------------------
  function measure() {
    M = metricsOf(region);
    // the specs read every cell's text (about 55 ms a draw on Sham): kept while the caller's key (the project's version, the table, its rows and
    // columns) and the fonts are the same, so a visit to an unchanged table measures nothing; never kept while a font is still loading
    const key = keyOf(o, M);
    if (key && measured?.key === key) { specs = measured.specs; return; }
    const it = specsOf(o, M);
    let r; while (!(r = it.next()).done);
    specs = r.value;
    measured = key ? { key, specs } : null;
  }
  function fit() {
    const base = { available: region.clientWidth || 1000, lead: leadSpec ? leadSpec.width : 0, columns: specs.columns, hidden: rowsMode ? [...hidden] : [] };
    F = fitColumns({ ...base, study: specs.study });
    // folded fields are rows under their study with their labels in the study column: then it is at least the label column's width
    if (rowsMode && F.folded.length && specs.label > specs.study.min) F = fitColumns({ ...base, study: { min: specs.label, natural: Math.max(specs.study.natural, specs.label) } });
    lead = F.lead ? leadSpec : null; leadW = F.lead;   // lib/table-fit.mjs decides whether the pane has room for the row's number
    const shown = new Set(F.shown);
    if (rowsMode) { shownC = cols.filter(c => shown.has(c.id)); foldedC = cols.filter(c => !shown.has(c.id)); shownP = papers; foldedP = []; }
    else { shownP = papers.filter(p => shown.has(p.id)); foldedP = papers.filter(p => !shown.has(p.id)); shownC = cols; foldedC = []; }
    return `${leadW}\u0002${F.shown.join('\u0001')}`;
  }
  const folded = () => rowsMode ? foldedC.length > 0 : foldedP.length > 0;

  // ---- html ---------------------------------------------------------------------------------------------------------------------
  const isOpen = key => S.rows.has(key) || S.auto === key;
  const opener = (key, name) => {
    const open = isOpen(key);
    return `<button type="button" class="ext-expand" data-expand="${esc(key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} the other ${rowsMode ? 'fields' : 'studies'} of ${esc(name)}">${icon(open ? 'chevron-down' : 'chevron-right')}</button>`;
  };
  const span = shown => (shown ?? 0) || 1;   // a detail's cell covers every column; with none shown it is the one beside the row header (F.rest)
  const bare = () => !(rowsMode ? shownC : shownP).length;   // no column at all: the row header spans both of the table's two columns
  const withSpan = (html, n) => html.replace(/^<td\b/, `<td colspan="${n}"`);

  function rowHead(p) {
    // the tooltip: the study's own name as the table writes it (its study column, which is not drawn as a column) and the paper's title
    const tip = [o.rowNote?.(p) || '', p.title && p.title !== p.label ? p.title : ''].filter(Boolean).join('\n');
    const label = esc(p.label || p.title || 'Untitled'), title = tip ? ` title="${esc(tip)}"` : '';
    return `<th scope="row"${title}${bare() ? ' colspan="2"' : ''}>${foldedC.length ? `<span class="ext-opener">${opener(p.id, p.label || p.title || 'study')}<span class="ext-opener-label">${label}</span></span>` : label}</th>`;
  }
  /**
   * The fields of a study that are not columns, grouped by meaning (lib/outcome-store.mjs categoryOf; a field of no known group is under Study and design) in one row
   * under it: a heading per group, the groups side by side as the width allows, each field a label and its cell (editable like a column's). An empty cell is left out.
   */
  function detailRows(p) {
    if (!foldedC.length || !isOpen(p.id)) return '';
    const groups = new Map(CATEGORIES.map(c => [c.id, []]));
    for (const { column, id, label } of detailCells(o.st || { values: V }, t, p.id, foldedC, o.label)) {
      const td = o.cell(p, column, id);
      if (/class="cell na"/.test(td)) continue;
      groups.get(categoryOf(column)).push(`<tr><td class="ext-det-label">${o.fieldHead(column, label)}</td>${td}</tr>`);
    }
    const body = CATEGORIES.filter(c => groups.get(c.id).length).map(c => `<section class="ext-det-group" data-group="${c.id}"><div class="ext-det-title">${esc(c.label)}</div><table class="ext-det-pairs"><tbody>${groups.get(c.id).join('')}</tbody></table></section>`).join('');
    return body ? `<tr class="ext-detail ext-detail-set">${lead ? lead.blank() : ''}<td colspan="${1 + span(shownC.length)}"><div class="ext-det">${body}</div></td></tr>` : '';
  }
  const rowsHtml = (start, end) => armRowsHtml({ template: t, values: V, state: o.st || { values: V }, papers: papers.slice(start, end), cols: shownC, head: rowHead, cell: o.cell, detail: foldedC.length ? detailRows : null, lead: lead ? lead.cell : null });
  /** Fields as rows: each field's row, then the studies that are not columns as rows under it. */
  function fieldRows() {
    return cols.map(c => {
      const key = c.id, name = o.label(c), head = `<th scope="row"${bare() ? ' colspan="2"' : ''}><span class="ext-opener">${foldedP.length ? opener(key, name) : ''}<span class="ext-opener-label">${o.fieldHead(c, name)}</span></span></th>`;
      const detail = foldedP.length && isOpen(key) ? foldedP.map(p => `<tr class="ext-detail"><th scope="row" class="ext-detail-label">${esc(p.label || p.title || 'Untitled')}</th>${withSpan(o.cell(p, c, c.id), span(shownP.length))}</tr>`).join('') : '';
      return `<tr>${head}${shownP.map(p => o.cell(p, c, c.id)).join('')}</tr>${detail}`;
    }).join('');
  }
  const colgroup = () => `<colgroup>${lead ? `<col width="${leadW}">` : ''}<col width="${F.study}">${bare() ? `<col width="${F.rest}">` : (rowsMode ? shownC : shownP).map(c => `<col width="${F.widths[c.id]}">`).join('')}</colgroup>`;
  const headHtml = () => rowsMode
    ? `<thead><tr>${lead ? lead.head() : ''}<th scope="col"${bare() ? ' colspan="2"' : ''}>Study</th>${shownC.map(o.head).join('')}</tr></thead>`
    : `<thead><tr><th scope="col"${bare() ? ' colspan="2"' : ''}>Field</th>${shownP.map(p => o.studyHead(p)).join('')}</tr></thead>`;
  const bodyHtml = () => rowsMode ? (windowed ? '' : rowsHtml(0, papers.length)) : fieldRows();
  // the line under each column: how many studies hold a value and what they hold (a number's median, a category's most held level)
  const footHtml = () => foot && !bare() ? `<tfoot><tr>${lead ? lead.blank() : ''}${foot.head()}${shownC.map(foot.cell).join('')}</tr></tfoot>` : '';

  // ---- row heights of a windowed table: an estimate by measured text, corrected by the real rows after each draw ----------------
  function estimates() {
    const lineH = M.line, rowH = Math.max(28, M.row), idx = new Map(shownC.map(c => [c.id, specs.columns.findIndex(s => s.id === c.id)]));
    return papers.map((p, i) => {
      let lines = 1;
      for (const c of shownC) { const m = specs.columns[idx.get(c.id)]?.measured[i]; if (m) lines = Math.max(lines, Math.min(CLAMP_LINES, wrapText(m, F.widths[c.id] - M.pad))); }
      // its arm rows and outcome entry lines (studyRows), and the rows of its detail when open
      let h = studyRows(o.st || { values: V }, t, p.id, shownC).length * rowH + (lines - 1) * lineH;
      if (foldedC.length && isOpen(p.id)) {   // the groups side by side, as many as the pane holds at DETAIL_GROUP_MIN each: rows of groups, each as tall as its longest
        const per = new Map(), across = Math.max(1, Math.floor((F.study + shownC.reduce((n, c) => n + F.widths[c.id], 0)) / DETAIL_GROUP_MIN));
        for (const { column } of detailCells(o.st || { values: V }, t, p.id, foldedC, o.label)) per.set(categoryOf(column), (per.get(categoryOf(column)) || 0) + 1);
        const sizes = [...per.values()]; for (let k = 0; k < sizes.length; k += across) h += (Math.max(...sizes.slice(k, k + across)) + 1) * rowH;
      }
      return h;
    });
  }

  // ---- drawing -------------------------------------------------------------------------------------------------------------------
  /** What the browser, not the estimate, says: which clamped cells are cut (their Show all shows), which headers are cut (they get a title). */
  // every size is read first and every mark written after: a read after a write lays the table out again, once per cell (2026-10-19)
  function settle() {
    const headH = region.querySelector('thead')?.offsetHeight || 28;
    const longs = [...region.querySelectorAll('.ext-clamp')].map(box => [box.closest('td'), box]).filter(([td]) => td && !td.hasAttribute('data-open'))
      .map(([td, box]) => [td, box.scrollHeight > box.clientHeight + 1]);
    const heads = [...region.querySelectorAll('thead th[data-full]')].map(th => [th, th.querySelector('.ui-head-label, .ext-head-label')]).filter(([, lab]) => lab)
      .map(([th, lab]) => [th, lab.scrollHeight > lab.clientHeight + 1]);   // the title breaks anywhere rather than overflow: only its height can be cut
    region.style.setProperty('--ext-head-h', `${headH}px`);
    for (const [td, long] of longs) td.toggleAttribute('data-long', long);
    for (const [th, clipped] of heads) {
      if (clipped) { th.dataset.clipped = ''; th.title = th.dataset.title ? `${th.dataset.full}: ${th.dataset.title}` : th.dataset.full; }
      else if (th.hasAttribute('data-clipped')) { th.removeAttribute('data-clipped'); th.title = th.dataset.title || ''; if (!th.title) th.removeAttribute('title'); }
    }
  }
  function draw() {
    const active = document.activeElement, hadFocus = region.contains(active) && !!active.matches?.('td.cell');
    win?.destroy(); win = null;
    region.innerHTML = `<table class="ext-grid${rowsMode ? '' : ' ext-grid-fields'}">${colgroup()}${headHtml()}<tbody>${bodyHtml()}</tbody>${footHtml()}</table>`;
    table = region.querySelector('table'); tbody = table.tBodies[0];
    if (windowed) win = windowRows(region, tbody, { heights: estimates, draw: rowsHtml, cols: Math.max(shownC.length, 1) + 1 + (lead ? 1 : 0), after: info => { o.afterRows(info); settle(); } });   // each window's rows are marked as they come
    else o.afterRows({ hadFocus });
    settle();
  }
  /** The rows again (a row opened or closed, a layout change that moved no column): the focus stays where it was. */
  function redrawRows() {
    // WebKit drops the region's scroll when its rows are replaced (Chromium keeps it): the place is kept by hand (owner, 2026-10-22)
    const active = document.activeElement, was = region.contains(active) ? (active.dataset?.expand ?? null) : undefined, top = region.scrollTop, left = region.scrollLeft;
    if (win) win.relayout();
    else { const had = region.contains(active); tbody.innerHTML = bodyHtml(); o.afterRows({ hadFocus: had && was === null }); }
    if (typeof was === 'string') region.querySelector(`[data-expand="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
    settle();
    if (!win) { region.scrollTop = top; region.scrollLeft = left; }
  }

  /** Measures again (fonts arrived, the data changed) and fits; or only fits (the pane's width changed). Returns whether the table was redrawn. */
  function refit(remeasure = false) {
    if (remeasure || !M) measure();
    const before = sig; sig = fit();
    if (remeasure || sig !== before || !table?.isConnected) { draw(); return true; }
    const at = lead ? 1 : 0;
    [...table.querySelectorAll('col')].forEach((col, i) => col.setAttribute('width', String(i < at ? leadW : i === at ? F.study : bare() ? F.rest : F.widths[(rowsMode ? shownC : shownP)[i - 1 - at]?.id])));
    if (win) win.relayout(); else settle();
    return false;
  }

  // ---- what the view asks of the grid ---------------------------------------------------------------------------------------------
  /** Whether a cell is in a folded column (a folded study, in the table of fields as rows). */
  const isFolded = sel => !!sel && (rowsMode ? foldedC.some(c => c.id === columnIdOf(sel.columnId)) : foldedP.some(p => p.id === sel.paperId));
  const rowKey = sel => rowsMode ? sel.paperId : columnIdOf(sel.columnId);
  /**
   * Opens the row detail that holds the selected cell when it is folded (and closes the one a key opened before). `keyboard` is a move by key:
   * a row that was opened only for a cell closes when the selection leaves it; a press leaves rows as they are, so nothing moves under the pointer.
   * Returns whether the rows were drawn again.
   */
  function reveal(sel, { keyboard = false } = {}) {
    const was = S.auto;
    if (sel && isFolded(sel)) S.auto = rowKey(sel);
    else if (keyboard && S.auto && (!sel || rowKey(sel) !== S.auto)) S.auto = null;
    if (S.auto === was) return false;
    redrawRows();
    if (win && sel && rowsMode) win.reveal(papers.findIndex(p => p.id === sel.paperId));
    return true;
  }
  /** Clicks on a row opener and a Show all: before the view's own cell handler, which they must not reach. */
  function wire(body) {
    body.addEventListener('click', e => {
      const x = e.target.closest?.('button[data-expand]');
      if (x) { e.stopImmediatePropagation(); const k = x.dataset.expand; if (S.rows.has(k) || S.auto === k) { S.rows.delete(k); if (S.auto === k) S.auto = null; } else S.rows.add(k); redrawRows(); return; }
      const m = e.target.closest?.('button[data-more]');
      if (m) {
        e.stopImmediatePropagation();
        const td = m.closest('td'), key = td.dataset.cell, open = !S.cells.has(key);
        if (open) S.cells.add(key); else S.cells.delete(key);
        td.toggleAttribute('data-open', open); m.setAttribute('aria-expanded', String(open)); m.setAttribute('aria-label', open ? 'Show less' : 'Show all');
        if (!open) td.toggleAttribute('data-long', true);
        if (win) win.relayout(); else settle();
      }
    });
  }

  return { refit, reveal, wire, isFolded, redrawRows,
    get shown() { return rowsMode ? shownC.map(c => c.id) : shownP.map(p => p.id); },
    get folded() { return rowsMode ? foldedC.map(c => c.id) : foldedP.map(p => p.id); },
    get win() { return win; },
    get any() { return folded(); },
    release() { win?.destroy(); win = null; } };
}

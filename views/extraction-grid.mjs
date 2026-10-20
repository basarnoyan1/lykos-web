// The Extraction grid that fits its pane (data summary plan, stage 6). The grid never scrolls sideways: `lib/table-fit.mjs` decides, from text
// measured on the grid's own fonts and from the pane's width alone, how wide each column is and which columns do not fit. A column that does not
// fit is folded: it is drawn as a field of its study's row detail (a chevron in the study cell opens it), and the column picker (More > Columns)
// lets a person choose which fields are columns. A long value wraps; past four lines it is held and "Show all" opens it in place, so no value
// ends in an ellipsis without a way to read it. This module draws the table and keeps its layout; the view (./extraction.mjs) owns the cells,
// the selection and the editor and is called back for them.
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { fitColumns, columnSpec, wrapText, measureWords, CLAMP_LINES } from '../lib/table-fit.mjs';
import { windowRows } from '../lib/table-window.mjs';
import { studyGrid, splitCellId } from '../lib/arms.mjs';
import { armRowsHtml } from './extraction-arms.mjs';

/** A text longer than this is drawn in a clamp box (four lines, then "Show all"); a shorter one can never be cut. */
export const CLAMP_FROM = 40;
const OPENER_ROOM = 24;    // the row opener (20 px) and the gap after it, kept in the study cell's minimum
const DETAIL_INDENT = 24;  // a row detail's label is indented under the opener (research-views.css, tr.ext-detail > th)
const LABEL_CH = 20;       // a row detail's label column is at least this many characters wide, so a field's label wraps between its words
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
const widths = new Map();
let canvas = null;
function width(font, text) {
  const k = `${font}\n${text}`;
  let w = widths.get(k);
  if (w === undefined) {
    canvas ||= document.createElement('canvas').getContext('2d');
    if (canvas) { canvas.font = font; w = canvas.measureText(text).width * 1.02 + 0.5; } else w = text.length * 7;   // a little over: the DOM's own advance may differ by a fraction
    if (widths.size > 60000) widths.clear();
    widths.set(k, w);
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

/**
 * The grid of a table. `o`: region (the .ui-table-region), templateId, rowsMode (studies as rows; false: fields as rows, studies as columns),
 * papers, cols, t, V, hidden (field ids a person put away), cell(p, c, id) (a <td>), textOf(p, c) (what the cell shows; a study's arms each on
 * their own lines), label(c), head(c) (a <th scope=col> of a field), studyHead(p), fieldHead(c, label), rowNote(p) (more about a study for its
 * row head's tooltip), afterRows({ hadFocus }) (the caller restores what it had in the rows: the editor, the focus), windowFrom (the studies
 * above which rows are windowed).
 */
export function createGrid(o) {
  const { region, rowsMode, papers, cols, t, V } = o;
  const S = keep(o.templateId);
  const hidden = o.hidden || new Set();
  const windowed = rowsMode && papers.length > o.windowFrom;
  let M = null, specs = null, F = null, sig = '', shownC = [], foldedC = [], shownP = [], foldedP = [], win = null, table = null, tbody = null;

  // ---- measuring and fitting ---------------------------------------------------------------------------------------------
  function measure() {
    M = metricsOf(region);
    const head = s => width(M.head, s), cell = s => width(M.cell, s), rowHead = s => width(M.rowHead, s);
    if (rowsMode) {
      specs = { study: columnSpec({ id: 'study', title: 'Study', texts: papers.map(p => p.label || p.title || 'Untitled'), measureHead: head, measureCell: rowHead, pad: M.pad, cellExtra: OPENER_ROOM, wordCap: 100, pct: 0.75, cap: 200 }),
        columns: cols.map((c, i) => columnSpec({ id: c.id, title: o.label(c), texts: papers.map(p => o.textOf(p, c)), measureHead: head, measureCell: cell, pad: M.pad, priority: i, numeric: !!o.numeric?.(c) })) };
      // the row detail's label column (the study column while fields are folded): LABEL_CH characters, or the longest word of a label
      const words = cols.flatMap(c => measureWords(o.label(c), cell).w);
      specs.label = Math.ceil(M.pad + DETAIL_INDENT + Math.max(cell('0'.repeat(LABEL_CH)), Math.min(LABEL_WORD_CAP, Math.max(0, ...words))));
    } else {
      specs = { study: columnSpec({ id: 'study', title: 'Field', texts: cols.map(c => o.label(c)), measureHead: head, measureCell: rowHead, pad: M.pad, cellExtra: OPENER_ROOM, wordCap: 100, pct: 0.75, cap: 200 }),
        columns: papers.map((p, i) => columnSpec({ id: p.id, title: p.label || p.title || 'Untitled', texts: cols.map(c => o.textOf(p, c)), measureHead: head, measureCell: cell, pad: M.pad, priority: i })) };
    }
  }
  function fit() {
    const base = { available: region.clientWidth || 1000, columns: specs.columns, hidden: rowsMode ? [...hidden] : [] };
    F = fitColumns({ ...base, study: specs.study });
    // folded fields are rows under their study with their labels in the study column: then it is at least the label column's width
    if (rowsMode && F.folded.length && specs.label > specs.study.min) F = fitColumns({ ...base, study: { min: specs.label, natural: Math.max(specs.study.natural, specs.label) } });
    const shown = new Set(F.shown);
    if (rowsMode) { shownC = cols.filter(c => shown.has(c.id)); foldedC = cols.filter(c => !shown.has(c.id)); shownP = papers; foldedP = []; }
    else { shownP = papers.filter(p => shown.has(p.id)); foldedP = papers.filter(p => !shown.has(p.id)); shownC = cols; foldedC = []; }
    return F.shown.join('\u0001');
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
  /** The fields of a study that are not columns, as rows under it, each with its own cell (arms: one per arm). */
  function detailRows(p) {
    if (!foldedC.length || !isOpen(p.id)) return '';
    const g = studyGrid(t, V, p.id, foldedC), out = [];
    foldedC.forEach((c, ci) => g.cells.forEach((row, r) => {
      const x = row[ci]; if (!x) return;
      const id = x.arm ? `${x.columnId}@${x.arm}` : x.columnId, td = o.cell(p, c, id);
      if (/class="cell na"/.test(td)) return;
      out.push(`<tr class="ext-detail"><th scope="row" class="ext-detail-label">${o.fieldHead(c, x.arm ? `${o.label(c)} · ${g.arms[r]?.label || x.arm}` : o.label(c))}</th>${withSpan(td, span(shownC.length))}</tr>`);
    }));
    return out.join('');
  }
  const rowsHtml = (start, end) => armRowsHtml({ template: t, values: V, papers: papers.slice(start, end), cols: shownC, head: rowHead, cell: o.cell, detail: foldedC.length ? detailRows : null });
  /** Fields as rows: each field's row, then the studies that are not columns as rows under it. */
  function fieldRows() {
    return cols.map(c => {
      const key = c.id, name = o.label(c), head = `<th scope="row"${bare() ? ' colspan="2"' : ''}><span class="ext-opener">${foldedP.length ? opener(key, name) : ''}<span class="ext-opener-label">${o.fieldHead(c, name)}</span></span></th>`;
      const detail = foldedP.length && isOpen(key) ? foldedP.map(p => `<tr class="ext-detail"><th scope="row" class="ext-detail-label">${esc(p.label || p.title || 'Untitled')}</th>${withSpan(o.cell(p, c, c.id), span(shownP.length))}</tr>`).join('') : '';
      return `<tr>${head}${shownP.map(p => o.cell(p, c, c.id)).join('')}</tr>${detail}`;
    }).join('');
  }
  const colgroup = () => `<colgroup><col width="${F.study}">${bare() ? `<col width="${F.rest}">` : (rowsMode ? shownC : shownP).map(c => `<col width="${F.widths[c.id]}">`).join('')}</colgroup>`;
  const headHtml = () => rowsMode
    ? `<thead><tr><th scope="col"${bare() ? ' colspan="2"' : ''}>Study</th>${shownC.map(o.head).join('')}</tr></thead>`
    : `<thead><tr><th scope="col"${bare() ? ' colspan="2"' : ''}>Field</th>${shownP.map(p => o.studyHead(p)).join('')}</tr></thead>`;
  const bodyHtml = () => rowsMode ? (windowed ? '' : rowsHtml(0, papers.length)) : fieldRows();

  // ---- row heights of a windowed table: an estimate by measured text, corrected by the real rows after each draw ----------------
  function estimates() {
    const lineH = M.line, rowH = Math.max(28, M.row), idx = new Map(shownC.map(c => [c.id, specs.columns.findIndex(s => s.id === c.id)]));
    return papers.map((p, i) => {
      let lines = 1;
      for (const c of shownC) { const m = specs.columns[idx.get(c.id)]?.measured[i]; if (m) lines = Math.max(lines, Math.min(CLAMP_LINES, wrapText(m, F.widths[c.id] - M.pad))); }
      const g = studyGrid(t, V, p.id, shownC);
      let h = g.rows * rowH + (lines - 1) * lineH;
      if (foldedC.length && isOpen(p.id)) h += studyGrid(t, V, p.id, foldedC).cells.reduce((n, row) => n + row.filter(Boolean).length, 0) * rowH;
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
    region.innerHTML = `<table class="ext-grid${rowsMode ? '' : ' ext-grid-fields'}">${colgroup()}${headHtml()}<tbody>${bodyHtml()}</tbody></table>`;
    table = region.querySelector('table'); tbody = table.tBodies[0];
    if (windowed) win = windowRows(region, tbody, { heights: estimates, draw: rowsHtml, cols: Math.max(shownC.length, 1) + 1, after: info => { o.afterRows(info); settle(); } });   // each window's rows are marked as they come
    else o.afterRows({ hadFocus });
    settle();
  }
  /** The rows again (a row opened or closed, a layout change that moved no column): the focus stays where it was. */
  function redrawRows() {
    const active = document.activeElement, was = region.contains(active) ? (active.dataset?.expand ?? null) : undefined;
    if (win) win.relayout();
    else { const had = region.contains(active); tbody.innerHTML = bodyHtml(); o.afterRows({ hadFocus: had && was === null }); }
    if (typeof was === 'string') region.querySelector(`[data-expand="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
    settle();
  }

  /** Measures again (fonts arrived, the data changed) and fits; or only fits (the pane's width changed). Returns whether the table was redrawn. */
  function refit(remeasure = false) {
    if (remeasure || !M) measure();
    const before = sig; sig = fit();
    if (remeasure || sig !== before || !table?.isConnected) { draw(); return true; }
    [...table.querySelectorAll('col')].forEach((col, i) => col.setAttribute('width', String(i === 0 ? F.study : bare() ? F.rest : F.widths[(rowsMode ? shownC : shownP)[i - 1]?.id])));
    if (win) win.relayout(); else settle();
    return false;
  }

  // ---- what the view asks of the grid ---------------------------------------------------------------------------------------------
  /** Whether a cell is in a folded column (a folded study, in the table of fields as rows). */
  const isFolded = sel => !!sel && (rowsMode ? foldedC.some(c => c.id === splitCellId(sel.columnId).columnId) : foldedP.some(p => p.id === sel.paperId));
  const rowKey = sel => rowsMode ? sel.paperId : splitCellId(sel.columnId).columnId;
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

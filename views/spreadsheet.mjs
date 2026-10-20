import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { SHEET_ASK } from '../lib/prompts.mjs';
import { complete, configured } from '../lib/ai.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { showMenu } from '../lib/menu.mjs';
import { saveFile } from '../lib/save.mjs';
import { wireRuns } from '../lib/topbar.mjs';
import { uiBar, uiGroup, uiSwap, menuAnchor, uiStatusLine } from '../lib/ui-actions.mjs';
import { findBarSpec, replaceBarSpec, findOption } from '../lib/ui-recipes.mjs';
import { GRID_LIMIT, mergeRegions, mergedCell, sheetDimensions, visibleRows, filterValues, filteredRowCount, visualRange, copyCells, pasteCells, cellStyle,
  selectionMatrix, sheetMatrix, matrixCsv, matrixHtml, fillEdits, findCells, replaceEdits, headerRows } from '../lib/spreadsheet-view.mjs';
import { colName, position, parseSelection, selectionLabel, workbookModel, selectionStats, statsText,
  spreadsheetMessages, parseSuggestions, reviewedEdits } from '../lib/spreadsheet.mjs';
import { sheetStore, MAX_FREEZE } from '../lib/sheet-view-state.mjs';

const PAGE_ROWS = 100, PAGE_COLS = 26;
const ZOOMS = [['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']];
const fileBase = name => String(name || '').split('/').pop().replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Sheet';

/**
 * Mount a bounded grid; the workbook and pending edits remain in memory across sheets/pages.
 *
 * The sheet's commands are one strip (`#ss-bar`: find, filter, history, download, Ask AI and one More); the formula bar is the cell reference and the
 * value; find and filter are one row each under it, opened on request. Freezing, hiding, widths and zoom are how the sheet is looked at, kept per file in the
 * browser (lib/sheet-view-state.mjs) and never written into the workbook, so the file keeps its structure and every reference as it was.
 *
 * `say(text)` reports in the title bar and `restore()` puts its usual line back; without them a line under the grid says it. `tools.overflow` adds
 * entries (with `run`) to the strip's More and `tools.wire(strip)` lets the host listen to it.
 */
export function mountSpreadsheet(body, workbook, { onDirtyChange = () => {}, name = '', viewKey = name, store = sheetStore(), say = null, restore = null, tools = {} } = {}) {
  if (!workbook.sheets.length) throw new Error('This workbook has no worksheets.');
  const model = workbookModel(workbook);
  let sheetIndex = 0, rowPage = 0, colPage = 0, selected = new Set(['A1']), anchor = 'A1', active = 'A1';
  let dragging = false, dragBase = new Set(), editing = null, proposals = [], controller = null, disposed = false;
  let requestVersion = 0, sort = null, filter = null, zoom = 1, rowOrder = [], shownCols = [], pageCols = [], saveTimer = 0, statsTimer = 0, messaged = false;
  let pane = 0, valueRef = null;                      // the row under the formula bar: 0 none, 1 find, 2 filter
  const find = { query: '', matches: [], index: -1, matchCase: false };
  const viewStates = new Map(), sheetSizes = new Map(), views = new Map();
  let resizing = null;
  const sheet = () => workbook.sheets[sheetIndex];
  const dimensions = () => sheetDimensions(sheet());
  const sizesOf = i => { if (!sheetSizes.has(i)) sheetSizes.set(i, { columns: new Map(), rows: new Map() }); return sheetSizes.get(i); };
  const sizes = () => sizesOf(sheetIndex);
  const columnWidth = c => sizes().columns.get(c) ?? sheet().columnWidths?.[c] ?? 160;
  // How a sheet is looked at: frozen rows and columns, hidden columns, zoom, wrapping. Read from the view store the first time a sheet is shown.
  function viewFor(i) {
    if (!views.has(i)) {
      const saved = store.get(viewKey, workbook.sheets[i].name) || {};
      views.set(i, { freezeRows: saved.freezeRows || 0, freezeCols: saved.freezeCols || 0, hidden: new Set(saved.hidden || []), zoom: saved.zoom || 1, wrap: Boolean(saved.wrap) });
      for (const [c, w] of Object.entries(saved.widths || {})) sizesOf(i).columns.set(Number(c), w);
    }
    return views.get(i);
  }
  const view = () => viewFor(sheetIndex);
  function persist(i = sheetIndex) {
    clearTimeout(saveTimer);
    const v = viewFor(i);
    store.put(viewKey, workbook.sheets[i].name, { freezeRows: v.freezeRows, freezeCols: v.freezeCols, hidden: [...v.hidden], zoom: v.zoom, wrap: v.wrap, widths: Object.fromEntries(sizesOf(i).columns) });
  }
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 300); };
  body.classList.add('fv-spreadsheet');
  const extra = (tools.overflow || []).map(x => (x === '-' ? x : (({ run, ...spec }) => spec)(x)));
  const isSave = x => x !== '-' && /-save$/.test(x.id), saves = extra.filter(isSave), others = extra.filter(x => !isSave(x));
  const strip = uiBar({ kind: 'tools', density: 'dense', label: 'Spreadsheet tools', id: 'ss-bar', cls: 'ss-top',
    budget: { n: 5, reason: 'a sheet: find, filter, history, download and the assistant' },
    actions: [uiGroup({ id: 'ss-view', label: 'Find and filter', items: [{ id: 'ss-find-open', label: 'Find and replace', icon: 'search', kbd: '⌘F', pressed: false }, { id: 'ss-filter', label: 'Filter', icon: 'filter', pressed: false }] }),
      uiGroup({ id: 'ss-history', label: 'History', items: [{ id: 'ss-undo', label: 'Undo', icon: 'undo', kbd: '⌘/Ctrl Z', disabled: true }, { id: 'ss-redo', label: 'Redo', icon: 'redo', kbd: '⌘/Ctrl Shift Z', disabled: true }] }),
      { id: 'ss-download', label: 'Download', icon: 'download', role: 'quiet', menu: true },
      { id: 'ss-ai-toggle', label: 'Ask AI', icon: 'assistant', role: 'primary', attrs: { 'aria-expanded': 'false' } }],
    overflow: [...saves, ...(saves.length ? ['-'] : []),
      { id: 'ss-sort-asc', label: 'Sort A to Z' }, { id: 'ss-sort-desc', label: 'Sort Z to A' }, { id: 'ss-sort-reset', label: 'Original row order', disabled: true }, '-',
      { id: 'ss-wrap', label: 'Wrap text', kind: 'toggle', checked: false }, { id: 'ss-freeze-row', label: 'Freeze first row', kind: 'toggle', checked: false },
      { id: 'ss-freeze-col', label: 'Freeze first column', kind: 'toggle', checked: false }, { id: 'ss-unhide', label: 'Show hidden columns', disabled: true },
      { id: 'ss-zoom', label: 'Zoom', kind: 'select', options: ZOOMS, value: '1' }, '-',
      { id: 'ss-goto', label: 'Go to cell' }, { id: 'ss-shortcuts', label: 'Keyboard shortcuts' },
      ...(others.length ? ['-', ...others] : [])] });
  const formulaBar = uiBar({ kind: 'tools', label: 'Formula bar', id: 'ss-formula', cls: 'ss-top',
    filters: [{ type: 'field', id: 'ss-range', label: 'Cell range', value: 'A1', placeholder: 'A1:C5', width: { ch: 6 } },
      { type: 'field', id: 'ss-value', label: 'Cell value', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'false' } }] });
  const findBar = uiBar(findBarSpec({ id: 'ss-find', label: 'Find', field: 'ss-find-text', count: 'ss-find-count', cls: 'ss-top', grow: true, ch: 14, steps: { prevKbd: '⇧↵', nextKbd: '↵' }, options: [findOption.matchCase('ss-find-case')] }))
    + uiBar(replaceBarSpec({ id: 'ss', field: 'ss-replace-text', ids: { one: 'ss-replace', all: 'ss-replace-all' }, cls: 'ss-top' }));
  const filterBarHtml = uiBar({ kind: 'tools', label: 'Filter rows', id: 'ss-filter-bar', cls: 'ss-top',
    filters: [{ type: 'select', id: 'ss-filter-column', label: 'Filter column', options: [['all', 'All columns']] },
      { type: 'search', id: 'ss-filter-text', label: 'Filter rows', placeholder: 'Filter rows…' }],
    actions: [{ id: 'ss-values-toggle', label: 'All values', menu: true, dynamic: true, labelCh: 12, attrs: { 'aria-expanded': 'false' } },
      { id: 'ss-clear-view', label: 'Clear', role: 'quiet' }] });
  const valuesActions = uiBar({ kind: 'tools', label: 'Values to show', id: 'ss-values-bar',
    actions: [{ id: 'ss-values-all', label: 'Select all', role: 'quiet' }, { id: 'ss-values-none', label: 'Clear selection', role: 'quiet' }] });
  const valuesFoot = uiBar({ kind: 'foot', label: 'Values', id: 'ss-values-foot', message: { id: 'ss-values-count', text: '' }, actions: [{ id: 'ss-values-done', label: 'Done', role: 'quiet' }] });
  // One status line: where the page stands in the sheet, then the numbers of the selection; the paging buttons are pinned at its end.
  const paging = uiStatusLine({ id: 'ss-strip', label: 'Selection and worksheet position',
    parts: [{ id: 'ss-rows', text: 'Rows 1–1 of 1', drop: 4 }, { id: 'ss-cols', text: 'Columns A–A', drop: 5 }, { id: 'ss-status', text: '', drop: 9, hidden: true }],
    actions: [{ id: 'ss-prev', label: 'Previous rows', icon: 'chevron-up', iconOnly: true }, { id: 'ss-next', label: 'Next rows', icon: 'chevron-down', iconOnly: true },
      { id: 'ss-left', label: 'Previous columns', icon: 'chevron-left', iconOnly: true }, { id: 'ss-right', label: 'Next columns', icon: 'chevron-right', iconOnly: true }] });
  const aiHead = uiBar({ kind: 'head', label: 'Spreadsheet AI', id: 'ss-ai-bar', lead: { title: 'Ask about selection', level: 'h2' }, actions: [{ id: 'ss-ai-close', label: 'Close', icon: 'close', role: 'quiet' }] });
  const aiFoot = uiBar({ kind: 'foot', label: 'Ask about selection', id: 'ss-ai-foot',
    actions: [{ id: 'ss-ask', label: 'Ask' }, uiSwap({ id: 'ss-run-slot', members: [{ id: 'ss-suggest', label: 'Suggest edits', role: 'primary' }, { id: 'ss-stop', label: 'Stop', role: 'primary', hidden: true }] })] });
  body.innerHTML = `<div class="ss-workspace ss-ai-closed">
    <div class="ss-main">
      ${strip}
      <div class="ss-above">${formulaBar}
        <div class="ss-pane" id="ss-find-pane" hidden>${findBar}</div>
        <div class="ss-pane ss-filters" id="ss-filter-pane" hidden>${filterBarHtml}<div class="ss-values-panel" hidden role="dialog" aria-label="Filter by cell values"><input id="ss-values-search" type="search" placeholder="Find a value…" aria-label="Find a filter value">${valuesActions}<div class="ss-values-list"></div>${valuesFoot}</div></div>
      </div>
      <div class="fv-grid ss-grid" tabindex="-1"></div>
      <div class="ss-bottom"><div class="ss-sheets" role="tablist" aria-label="Worksheets"></div>${paging}</div>
      <div class="ss-notice" role="status" aria-live="polite"></div>
    </div>
    <section class="ss-assistant" aria-label="Spreadsheet AI">
      ${aiHead}
      <div class="ss-ai-context" id="ss-ai-context"></div>
      <label for="ss-question">Message</label>
      <textarea id="ss-question" rows="4" placeholder="Ask a question or describe an edit…"></textarea>
      ${aiFoot}
      <div class="meta ss-model" id="ss-model"></div>
      <div class="meta ss-response-context" id="ss-response-context"></div>
      <div class="ss-answer" id="ss-answer" role="status" aria-live="polite"></div>
      <div id="ss-proposals"></div>
    </section></div>`;
  const q = sel => body.querySelector(sel);
  const grid = q('.ss-grid'), range = q('#ss-range'), valueField = q('#ss-value'), notice = q('.ss-notice'), stripEl = q('#ss-bar');
  wireRuns(stripEl, (tools.overflow || []).filter(x => x !== '-'));
  tools.wire?.(stripEl);
  // What a command reports: the title bar's message when the host has one, else the line under the grid.
  const message = text => {
    if (say) { if (text) { messaged = true; say(text); } else if (messaged) { messaged = false; restore?.(); } return; }
    notice.textContent = text;
  };
  const cellElement = ref => grid.querySelector(`[data-cell="${ref}"]`);
  // Find and filter are rows under the formula bar, one at a time, opened on request.
  const panes = [null, q('#ss-find-pane'), q('#ss-filter-pane')];
  const showPane = i => { pane = i; panes[1].hidden = i !== 1; panes[2].hidden = i !== 2; };
  const toggled = (id, on) => q(`#${id}`)?.setAttribute('aria-pressed', String(Boolean(on)));
  const isFormula = ref => model.formula(sheet().name, ref);

  // ---- the formula bar's value --------------------------------------------------------------------------------------------------------
  function paintValue() {
    if (document.activeElement === valueField) return;
    const ref = active, f = isFormula(ref), text = model.value(sheet().name, ref), multi = /[\r\n]/.test(text);
    valueRef = ref;
    valueField.readOnly = f || multi;
    valueField.value = f ? `=${(sheet().formulas || {})[ref] || '(shared formula)'}` : text.replace(/\r?\n/g, ' ');
    valueField.title = f ? `Formula cell, read-only. Cached value: ${text}` : multi ? 'Text with line breaks: edit it in the cell' : '';
  }
  const valuePending = () => valueRef && !valueField.readOnly && valueField.value !== model.value(sheet().name, valueRef);
  function commitValue() {
    if (!valuePending()) return;
    const ref = valueRef;
    model.apply([{ sheet: sheet().name, cell: ref, value: valueField.value }]);
    paintCell(ref); changed();
  }
  function paintCell(ref) {
    const td = cellElement(ref); if (!td) return;
    const content = document.createElement('div'); content.className = 'ss-cell-content'; content.textContent = model.value(sheet().name, ref);
    td.replaceChildren(content); td.title = content.textContent; paintSizes();
  }

  // ---- selection ----------------------------------------------------------------------------------------------------------------------
  function selectionPaint() {
    const label = selectionLabel(selected);
    if (document.activeElement !== range) range.value = label;
    q('#ss-ai-context').textContent = `${sheet().name} · ${label.length > 90 ? `${selected.size} selected cells` : label}`;
    paintValue();
    const columns = new Set([...selected].map(ref => position(ref).col));
    for (const td of grid.querySelectorAll('[data-cell]')) {
      const on = selected.has(td.dataset.cell);
      td.classList.toggle('ss-selected', on); td.classList.toggle('ss-active', td.dataset.cell === active);
      td.setAttribute('aria-selected', String(on)); td.tabIndex = td.dataset.cell === active ? 0 : -1;
    }
    for (const th of grid.querySelectorAll('thead th[data-col]')) th.classList.toggle('ss-col-on', columns.has(+th.dataset.col));
    paintStatus();
  }
  // One status line: the numbers of a selection of more than one cell, then how many rows a filter leaves.
  function paintStatus() {
    clearTimeout(statsTimer);
    const run = () => {
      if (disposed) return;
      const count = filteredRowCount(sheet(), model, rowOrder), filtering = Boolean(filter?.text || filter?.values);
      const stats = selected.size > 1 ? statsText(selectionStats([...selected].map(ref => model.value(sheet().name, ref)))) : '';
      const text = [stats, filtering ? `${count.shown} of ${count.total} rows shown` : ''].filter(Boolean).join(' · ');
      q('#ss-status').textContent = text; q('#ss-status').hidden = !text;
    };
    if (selected.size > 2000) statsTimer = setTimeout(run, 120); else run();
  }
  function changed() { onDirtyChange(); q('#ss-undo').disabled = !model.canUndo(); q('#ss-redo').disabled = !model.canRedo?.(); }

  // ---- drawing ------------------------------------------------------------------------------------------------------------------------
  function draw() {
    const sh = sheet(), dims = dimensions(), v = view();
    shownCols = Array.from({ length: dims.cols }, (_, c) => c).filter(c => !v.hidden.has(c));
    rowOrder = visibleRows(sh, model, { sort, filter });
    const at = position(active);
    if (!rowOrder.includes(at.row) || v.hidden.has(at.col)) {
      active = anchor = `${colName(shownCols.find(c => c >= at.col) ?? shownCols[0])}${(rowOrder.includes(at.row) ? at.row : (rowOrder[1] ?? rowOrder[0])) + 1}`;
      selected = new Set([active]);
    }
    if ([...selected].some(ref => v.hidden.has(position(ref).col))) selected = new Set([...selected].filter(ref => !v.hidden.has(position(ref).col)).concat(active));
    const frozenCols = shownCols.filter(c => c < v.freezeCols), restCols = shownCols.filter(c => c >= v.freezeCols);
    const headCount = v.freezeRows ? Math.min(headerRows(sh), rowOrder.length) : 0;
    rowPage = Math.max(0, Math.min(rowPage, Math.ceil((rowOrder.length - headCount) / PAGE_ROWS) - 1));
    colPage = Math.max(0, Math.min(colPage, Math.ceil(restCols.length / PAGE_COLS) - 1));
    const start = headCount + rowPage * PAGE_ROWS, slice = rowOrder.slice(start, start + PAGE_ROWS), r1 = start + slice.length;
    const pageRows = [...rowOrder.slice(0, headCount), ...slice], c0 = colPage * PAGE_COLS;
    pageCols = [...frozenCols, ...restCols.slice(c0, c0 + PAGE_COLS)];
    const merges = mergeRegions(sh), frozenRow = new Set(rowOrder.slice(0, headCount)), lastFrozen = frozenCols.at(-1);
    const widths = pageCols.map(columnWidth);
    const sortedColumn = sort?.column;
    grid.classList.toggle('ss-wrap-text', v.wrap);
    grid.innerHTML = `<table role="grid" aria-label="${esc(sh.name)}" aria-multiselectable="true" aria-rowcount="${dims.rows + 1}" aria-colcount="${dims.cols + 1}" style="--ss-table:${widths.reduce((a, b) => a + b, 48)}px;--ss-zoom:${zoom}"><colgroup><col class="ss-corner-col">${pageCols.map((c, i) => `<col data-size-column="${c}" style="--ss-col:${widths[i]}px">`).join('')}</colgroup><thead><tr><th aria-label="Row"></th>${pageCols.map(c => `<th scope="col" data-col="${c}" class="${c < v.freezeCols ? 'ss-frozen-c' : ''}${c === lastFrozen ? ' ss-frozen-end' : ''}" aria-sort="${sortedColumn === c ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="ss-col-button${sortedColumn === c ? ' ss-sorted' : ''}" data-column="${c}" aria-haspopup="menu" aria-expanded="false" aria-label="Column ${colName(c)} options"><span class="ss-col-name">${colName(c)}</span>${icon(sortedColumn === c ? (sort.direction === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevron-down')}</button><span class="ss-resize ss-resize-x" data-resize-column="${c}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize column ${colName(c)}" aria-valuemin="40" aria-valuemax="1200" aria-valuenow="${columnWidth(c)}"></span></th>`).join('')}</tr></thead>
      <tbody>${pageRows.map((r, rowIndex) => `<tr data-size-row="${r}" aria-rowindex="${r + 2}"><th scope="row"${frozenRow.has(r) ? ` class="ss-frozen-r${rowIndex === headCount - 1 ? ' ss-frozen-end' : ''}"` : ''}>${r + 1}<span class="ss-resize ss-resize-y" data-resize-row="${r}" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize row ${r + 1}" aria-valuemin="24" aria-valuemax="1200" aria-valuenow="${sizes().rows.get(r) ?? 30}"></span></th>${pageCols.map(c => {
        const merge = merges.find(m => r >= m.start.row && r <= m.end.row && c >= m.start.col && c <= m.end.col);
        const mergeRows = merge ? pageRows.filter(n => n >= merge.start.row && n <= merge.end.row) : [], mergeCols = merge ? pageCols.filter(n => n >= merge.start.col && n <= merge.end.col) : [];
        if (merge && (r !== mergeRows[0] || c !== mergeCols[0])) return '';
        const ref = merge?.anchor || `${colName(c)}${r + 1}`, value = model.value(sh.name, ref), formula = model.formula(sh.name, ref), source = position(ref);
        const appearance = sh.cellStyles?.[ref] || sh.rowStyles?.[source.row] || sh.columnStyles?.[source.col] || sh.defaultStyle || {};
        const fr = frozenRow.has(r) && (!merge || mergeRows.every(n => frozenRow.has(n))), fc = c < v.freezeCols && (!merge || mergeCols.every(n => n < v.freezeCols));
        const flags = [formula ? 'formula' : '', appearance.wrap ? 'ss-wrap' : '', fr ? 'ss-frozen-r' : '', fc ? 'ss-frozen-c' : '', fr && rowIndex + (merge ? mergeRows.length : 1) >= headCount ? 'ss-frozen-end-r' : '', fc && (merge ? mergeCols.at(-1) : c) === lastFrozen ? 'ss-frozen-end-c' : ''].filter(Boolean).join(' ');
        return `<td role="gridcell" aria-colindex="${c + 2}" aria-label="${ref}${formula ? ', formula' : ''}${merge ? ', merged ' + merge.ref : ''}" aria-readonly="${formula}" data-cell="${ref}" data-col="${merge ? mergeCols[0] : c}" tabindex="-1"${merge ? ` colspan="${mergeCols.length}" rowspan="${mergeRows.length}"` : ''} class="${flags}" style="${esc(cellStyle(appearance))}" title="${esc(value)}"><div class="ss-cell-content">${esc(value)}</div></td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
    const sheetsEl = q('.ss-sheets');
    sheetsEl.hidden = workbook.sheets.length < 2;
    sheetsEl.innerHTML = workbook.sheets.map((s, i) => `<button role="tab" data-sheet="${i}" aria-selected="${i === sheetIndex}" class="${i === sheetIndex ? 'on' : ''}">${esc(s.name)}</button>`).join('');
    q('#ss-rows').textContent = `Rows ${(rowPage === 0 ? 1 : start + 1).toLocaleString('en')}–${r1.toLocaleString('en')} of ${rowOrder.length.toLocaleString('en')}`;
    q('#ss-cols').textContent = `Columns ${colName(pageCols[0])}–${colName(pageCols.at(-1))}`;
    q('#ss-prev').disabled = rowPage === 0; q('#ss-next').disabled = r1 >= rowOrder.length;
    q('#ss-left').disabled = colPage === 0; q('#ss-right').disabled = c0 + PAGE_COLS >= restCols.length;
    const filterColumn = q('#ss-filter-column');
    filterColumn.innerHTML = '<option value="all">All columns</option>' + Array.from({ length: dims.cols }, (_, c) => `<option value="${c}">${colName(c)} · ${esc(String(sh.rows[0]?.[c] || '').slice(0, 35))}</option>`).join('');
    filterColumn.value = filter?.column ?? 'all';
    q('#ss-values-count').textContent = (() => { const n = filteredRowCount(sh, model, rowOrder); return `${n.shown} of ${n.total} rows shown`; })();
    q('#ss-filter').classList.toggle('on', Boolean(filter?.text || filter?.values));
    q('#ss-values-toggle').disabled = filterColumn.value === 'all';
    q('#ss-values-toggle .ui-act-label').textContent = filter?.values ? `${filter.values.length} ${filter.values.length === 1 ? 'value' : 'values'}` : 'All values';
    q('#ss-sort-reset').disabled = !sort;
    q('#ss-unhide').disabled = !v.hidden.size;
    toggled('ss-wrap', v.wrap); toggled('ss-freeze-row', v.freezeRows); toggled('ss-freeze-col', v.freezeCols);
    q('#ss-zoom').value = String(zoom);
    paintSizes(); selectionPaint(); changed(); findRefresh();
  }
  function choose(ref, { extend = false, additive = false, base = selected } = {}) {
    ref = mergedCell(sheet(), ref)?.anchor || ref;
    const next = extend ? new Set([...base, ...visualRange(anchor, ref, rowOrder, GRID_LIMIT, shownCols)]) : additive ? new Set(selected) : new Set();
    if (!extend) { if (additive && next.has(ref) && next.size > 1) next.delete(ref); else next.add(ref); anchor = ref; }
    if (next.size > GRID_LIMIT) throw new Error(`Select up to ${GRID_LIMIT} cells at a time.`);
    selected = next; active = ref; selectionPaint();
  }
  // The page that holds a cell is shown; the cell is returned (frozen rows and columns are on every page).
  function showCell(ref) {
    const p = position(ref), v = view(), headCount = v.freezeRows ? Math.min(headerRows(sheet()), rowOrder.length) : 0, at = rowOrder.indexOf(p.row);
    const restCols = shownCols.filter(c => c >= v.freezeCols);
    const rp = at >= headCount ? Math.floor((at - headCount) / PAGE_ROWS) : rowPage, cp = p.col >= v.freezeCols && restCols.includes(p.col) ? Math.floor(restCols.indexOf(p.col) / PAGE_COLS) : colPage;
    if (rp !== rowPage || cp !== colPage) { rowPage = Math.max(0, rp); colPage = cp; draw(); }
    const td = cellElement(ref);
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return td;
  }
  function focusCell(ref) { showCell(ref)?.focus({ preventScroll: true }); }
  function finishEdit(cancel = false) {
    commitValue();
    if (!editing) return;
    const td = editing, ref = td.dataset.cell; editing = null;
    const value = td.innerText.replace(/\n$/, ''); td.removeAttribute('contenteditable');
    if (!cancel && value !== model.value(sheet().name, ref)) model.apply([{ sheet: sheet().name, cell: ref, value }]);
    paintCell(ref); selectionPaint(); changed();
  }
  function startEdit(td, initial = null) {
    if (isFormula(td.dataset.cell)) { message('Formula cells are read-only'); return; }
    finishEdit(); choose(td.dataset.cell); editing = td; td.contentEditable = 'plaintext-only'; td.focus();
    if (initial != null) td.textContent = initial;
    const sel = getSelection(), r = document.createRange(); r.selectNodeContents(td); if (initial != null) r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  }

  // ---- sizes, frozen panes ------------------------------------------------------------------------------------------------------------
  function paintSizes() {
    const table = grid.querySelector('table'); if (!table) return;
    let total = 48;
    for (const col of table.querySelectorAll('[data-size-column]')) { const width = columnWidth(+col.dataset.sizeColumn); col.style.setProperty('--ss-col', `${width}px`); total += width; }
    table.style.setProperty('--ss-table', `${total}px`);
    const rows = [...table.querySelectorAll('tbody tr')];
    for (const tr of rows) {
      const height = sizes().rows.get(+tr.dataset.sizeRow);
      if (height != null) tr.style.setProperty('--ss-row-height', `${height}px`); else tr.style.removeProperty('--ss-row-height');
      for (const td of tr.querySelectorAll('td')) {
        const content = td.querySelector('.ss-cell-content'); if (!content) continue;
        const index = rows.indexOf(tr), spanned = rows.slice(index, index + td.rowSpan);
        const fixed = spanned.some(row => sizes().rows.has(+row.dataset.sizeRow));
        content.style.maxHeight = fixed ? `${Math.max(1, spanned.reduce((sum, row) => sum + (sizes().rows.get(+row.dataset.sizeRow) ?? 30), 0) - 9)}px` : '';
      }
    }
    for (const handle of table.querySelectorAll('[data-resize-column]')) handle.setAttribute('aria-valuenow', columnWidth(+handle.dataset.resizeColumn));
    for (const handle of table.querySelectorAll('[data-resize-row]')) handle.setAttribute('aria-valuenow', Math.round(handle.closest('tr').getBoundingClientRect().height / zoom));
    paintFrozen(table);
  }
  // Frozen cells stick where the column letters and the row numbers end, then one after another: their offsets are the widths and heights before them.
  function paintFrozen(table) {
    const lefts = new Map(); let left = 48;
    for (const c of pageCols) { if (c >= view().freezeCols) break; lefts.set(c, left); left += columnWidth(c); }
    for (const el of table.querySelectorAll('.ss-frozen-c')) el.style.setProperty('--ss-left', `${lefts.get(+el.dataset.col) ?? 48}px`);
    const head = table.tHead?.rows[0]?.getBoundingClientRect().height / zoom || 30;
    let top = head;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const row = tr.querySelector('th.ss-frozen-r'); if (!row) break;
      for (const el of tr.querySelectorAll('.ss-frozen-r')) el.style.setProperty('--ss-top', `${top}px`);
      top += tr.getBoundingClientRect().height / zoom;
    }
  }
  const resizeInfo = handle => handle.hasAttribute('data-resize-column') ? { axis: 'columns', index: +handle.dataset.resizeColumn } : { axis: 'rows', index: +handle.dataset.resizeRow };
  const currentSize = (axis, index) => axis === 'columns' ? columnWidth(index) : grid.querySelector(`[data-size-row="${index}"]`).getBoundingClientRect().height / zoom;
  function setSize(axis, index, value) { sizes()[axis].set(index, Math.round(Math.max(axis === 'columns' ? 40 : 24, Math.min(1200, value)))); paintSizes(); if (axis === 'columns') persistSoon(); }
  // A column as wide as its widest text (to 800px): the shape of the letters is measured, so nothing is clipped.
  function fitColumn(index) {
    finishEdit();
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d'), sample = grid.querySelector('td');
    const style = getComputedStyle(sample || grid);
    const merges = mergeRegions(sheet()); let width = 56;
    for (let r = 0; r < Math.max(sheet().rows.length, ...model.edits().filter(e => e.sheet === sheet().name).map(e => position(e.cell).row + 1)); r++) {
      if (merges.some(m => index >= m.start.col && index <= m.end.col && r >= m.start.row && r <= m.end.row && m.end.col > m.start.col)) continue;
      const ref = `${colName(index)}${r + 1}`; context.font = `${sheet().cellStyles?.[ref]?.bold ? '600' : style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      for (const line of model.value(sheet().name, ref).split(/\r?\n/)) width = Math.max(width, context.measureText(line).width + 22);
    }
    setSize('columns', index, Math.min(800, Math.ceil(width))); persist();
  }
  function fitSize(handle) {
    finishEdit(); const { axis, index } = resizeInfo(handle);
    if (axis === 'rows') { sizes().rows.delete(index); paintSizes(); return; }
    fitColumn(index);
  }
  function endResize(cancel = false) {
    if (!resizing) return;
    const state = resizing; resizing = null;
    if (cancel) { if (state.previous == null) sizes()[state.axis].delete(state.index); else sizes()[state.axis].set(state.index, state.previous); paintSizes(); }
    else if (state.axis === 'columns') persist();
    if (state.handle.hasPointerCapture(state.pointer)) state.handle.releasePointerCapture(state.pointer);
    document.body.classList.remove('ss-resizing-column', 'ss-resizing-row');
  }
  grid.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.ss-resize'); if (!handle || e.button !== 0) return;
    e.preventDefault(); finishEdit(); dragging = false;
    const { axis, index } = resizeInfo(handle);
    resizing = { axis, index, handle, pointer: e.pointerId, start: axis === 'columns' ? e.clientX : e.clientY, size: currentSize(axis, index), previous: sizes()[axis].get(index) };
    handle.setPointerCapture(e.pointerId); handle.focus({ preventScroll: true });
    document.body.classList.add(axis === 'columns' ? 'ss-resizing-column' : 'ss-resizing-row');
  });
  grid.addEventListener('pointermove', e => {
    if (!resizing || resizing.pointer !== e.pointerId) return;
    const { axis, index, start, size } = resizing; setSize(axis, index, size + ((axis === 'columns' ? e.clientX : e.clientY) - start) / zoom);
  });
  grid.addEventListener('pointerup', () => endResize());
  grid.addEventListener('pointercancel', () => endResize(true));
  grid.addEventListener('lostpointercapture', () => endResize());
  grid.addEventListener('dblclick', e => { const handle = e.target.closest('.ss-resize'); if (handle) { e.preventDefault(); fitSize(handle); } });
  grid.addEventListener('keydown', e => {
    const handle = e.target.closest('.ss-resize'); if (!handle) return;
    const { axis, index } = resizeInfo(handle);
    if (e.key === 'Escape' && resizing) { e.preventDefault(); endResize(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); fitSize(handle); return; }
    const keys = axis === 'columns' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (keys.includes(e.key)) { e.preventDefault(); e.stopPropagation(); setSize(axis, index, currentSize(axis, index) + (e.key === keys[0] ? -1 : 1) * (e.shiftKey ? 24 : 8)); }
  });

  // ---- pointer and keyboard on cells --------------------------------------------------------------------------------------------------
  grid.addEventListener('pointerdown', e => {
    const td = e.target.closest('[data-cell]'); if (!td || e.button !== 0 || td === editing) return;
    e.preventDefault(); finishEdit(); message('');
    try {
      const add = e.metaKey || e.ctrlKey;
      dragBase = add ? new Set(selected) : new Set();
      choose(td.dataset.cell, { extend: e.shiftKey, additive: add, base: dragBase });
      dragging = true; td.focus({ preventScroll: true });
    } catch (err) { message(err.message); }
  });
  grid.addEventListener('pointerover', e => {
    const td = e.target.closest('[data-cell]'); if (!dragging || !e.buttons || !td) return;
    try { choose(td.dataset.cell, { extend: true, base: dragBase }); } catch (err) { message(err.message); }
  });
  const endDrag = () => { dragging = false; };
  window.addEventListener('pointerup', endDrag);
  grid.addEventListener('dblclick', e => { const td = e.target.closest('[data-cell]'); if (td) startEdit(td); });
  grid.addEventListener('focusout', e => { if (e.target === editing) finishEdit(); });
  grid.addEventListener('input', () => onDirtyChange());
  function move(key, shift = false, jump = false) {
    const p = position(active), merge = mergedCell(sheet(), active);
    let ri = rowOrder.indexOf(p.row), ci = shownCols.indexOf(p.col);
    if (ci < 0) ci = 0;
    const horizontal = key === 'Tab' || key === 'ArrowLeft' || key === 'ArrowRight';
    const delta = key === 'ArrowLeft' || key === 'ArrowUp' || ((key === 'Tab' || key === 'Enter') && shift) ? -1 : 1;
    const widthOf = m => shownCols.filter(c => c >= m.start.col && c <= m.end.col).length || 1;
    if (horizontal) ci = jump ? (delta < 0 ? 0 : shownCols.length - 1) : ci + delta * (merge && delta > 0 ? widthOf(merge) : 1);
    else ri = jump ? (delta < 0 ? 0 : rowOrder.length - 1) : ri + delta * (merge && delta > 0 ? merge.end.row - merge.start.row + 1 : 1);
    if (key === 'Tab' && ci >= shownCols.length) { ci = 0; ri++; } else if (key === 'Tab' && ci < 0) { ci = shownCols.length - 1; ri--; }
    const ref = `${colName(shownCols[Math.max(0, Math.min(shownCols.length - 1, ci))])}${rowOrder[Math.max(0, Math.min(rowOrder.length - 1, ri))] + 1}`;
    const target = mergedCell(sheet(), ref)?.anchor || ref;
    choose(target, { extend: shift && key.startsWith('Arrow'), base: new Set() }); focusCell(target);
  }
  function history(redo = false) { finishEdit(); redo ? model.redo?.() : model.undo(); draw(); focusCell(active); message(''); }
  function clearCells() {
    const refs = new Set([...selected].map(ref => mergedCell(sheet(), ref)?.anchor || ref));
    const edits = [...refs].filter(ref => !isFormula(ref)).map(cell => ({ sheet: sheet().name, cell, value: '' }));
    model.apply(edits); draw(); focusCell(active); if (edits.length < refs.size) message('Formula cells were kept.');
  }
  const selectedFormula = () => [...selected].some(isFormula);
  async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
  async function copySelection(cut = false) {
    finishEdit();
    try {
      if (cut && selectedFormula()) throw new Error('Formula cells cannot be cut.');
      const text = copyCells(sheet(), model, selected, rowOrder);
      if (!await copyText(text)) throw new Error('The clipboard is not available here. Use ⌘C.');
      if (cut) clearCells();
    } catch (err) { message(err.message); }
  }
  async function copyAsTable() {
    finishEdit();
    try {
      const matrix = selectionMatrix(sheet(), model, selected, rowOrder), text = copyCells(sheet(), model, selected, rowOrder);
      if (globalThis.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([matrixHtml(matrix)], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } else if (!await copyText(text)) throw new Error('The clipboard is not available here.');
      message(`Copied ${matrix.length} × ${matrix[0].length} as a table.`);
    } catch (err) { message(err.message || 'The clipboard is not available here.'); }
  }
  function pasteText(text) {
    try { const edits = pasteCells(sheet(), model, selected, active, text, rowOrder, shownCols); model.apply(edits); selected = new Set(edits.map(e => e.cell)); draw(); focusCell(active); message(''); } catch (err) { message(err.message); }
  }
  async function pasteClipboard() {
    finishEdit();
    try { pasteText(await navigator.clipboard.readText()); } catch { message('Press ⌘V to paste here.'); }
  }
  function fillSelection(direction) {
    finishEdit();
    try {
      const edits = fillEdits(sheet(), model, selected, rowOrder, direction, shownCols);
      if (!edits.length) { message('Nothing to fill.'); return; }
      model.apply(edits); draw(); focusCell(active);
    } catch (err) { message(err.message); }
  }
  grid.addEventListener('keydown', e => {
    const td = e.target.closest('[data-cell]'); if (!td) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishEdit(true); }
      else if ((e.key === 'Enter' && !e.altKey) || e.key === 'Tab') { e.preventDefault(); finishEdit(); move(e.key, e.shiftKey); }
      // The browser handles text selection, clipboard and undo within a cell.
      else if (mod && ['a', 'c', 'x', 'v', 'z', 'y'].includes(key)) e.stopPropagation();
      return;
    }
    try {
      if (mod && key === 'z') { e.preventDefault(); e.stopPropagation(); history(e.shiftKey); }
      else if (mod && key === 'y') { e.preventDefault(); e.stopPropagation(); history(true); }
      else if (mod && key === 'a') { e.preventDefault(); e.stopPropagation(); selected = new Set(visualRange(`${colName(shownCols[0])}${rowOrder[0] + 1}`, `${colName(shownCols.at(-1))}${rowOrder.at(-1) + 1}`, rowOrder, GRID_LIMIT, shownCols)); selectionPaint(); }
      else if (mod && key === 'd' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); fillSelection('down'); }
      else if (e.key === 'Escape') { if (pane) { e.stopPropagation(); closePane(); } else if (selected.size > 1) { e.stopPropagation(); choose(active); } }
      else if (e.key.startsWith('Arrow') || e.key === 'Tab') { e.preventDefault(); move(e.key, e.shiftKey, mod); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const ref = `${colName(e.key === 'Home' ? shownCols[0] : shownCols.at(-1))}${mod ? (e.key === 'Home' ? rowOrder[0] : rowOrder.at(-1)) + 1 : position(active).row + 1}`; choose(ref); focusCell(ref); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearCells(); }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(td); }
      else if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(td, e.key); }
    } catch (err) { message(err.message); }
  });
  for (const event of ['copy', 'cut']) grid.addEventListener(event, e => {
    if (editing) return;
    e.preventDefault();
    try { const text = copyCells(sheet(), model, selected, rowOrder); if (event === 'cut' && selectedFormula()) throw new Error('Formula cells cannot be cut.'); e.clipboardData.setData('text/plain', text); if (event === 'cut') clearCells(); } catch (err) { message(err.message); }
  });
  grid.addEventListener('paste', e => {
    if (editing) return;
    e.preventDefault(); pasteText(e.clipboardData.getData('text/plain'));
  });

  // ---- the cell reference: go to a cell or a range ------------------------------------------------------------------------------------
  function selectInput() {
    try {
      let text = range.value;
      const bang = text.lastIndexOf('!');
      if (bang > 0) {                               // Notes!B2: another worksheet
        const wanted = text.slice(0, bang).trim().replace(/^'(.*)'$/, '$1').toLocaleLowerCase(), at = workbook.sheets.findIndex(s => s.name.toLocaleLowerCase() === wanted);
        if (at < 0) throw new Error(`There is no worksheet called ${text.slice(0, bang).trim()}.`);
        if (at !== sheetIndex) enterSheet(at);
        text = text.slice(bang + 1);
      }
      const d = dimensions(), next = parseSelection(text, GRID_LIMIT);
      for (const ref of next) { const p = position(ref); if (p.row >= d.rows || p.col >= d.cols) throw new Error('That range is outside the displayed worksheet.'); }
      const shown = new Set([...next].filter(ref => !view().hidden.has(position(ref).col)));
      if (!shown.size) throw new Error('Those columns are hidden. Show hidden columns first.');
      selected = shown; active = anchor = mergedCell(sheet(), [...shown][0])?.anchor || [...shown][0]; message(''); draw(); focusCell(active); selectionPaint();
    } catch (err) { message(err.message); }
  }
  range.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); selectInput(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); range.value = selectionLabel(selected); focusCell(active); }
  };
  range.onfocus = () => range.select();
  range.onblur = () => { range.value = selectionLabel(selected); };
  const goTo = () => { range.focus(); range.select(); };
  valueField.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitValue(); move('Enter', e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); valueField.value = model.value(sheet().name, valueRef); focusCell(active); }
  };
  valueField.oninput = () => onDirtyChange();
  valueField.onfocus = () => { if (valueField.readOnly) return; valueRef = active; };
  valueField.onblur = () => { commitValue(); paintValue(); };

  // ---- sheets, paging -----------------------------------------------------------------------------------------------------------------
  function enterSheet(index) {
    persist(); viewStates.set(sheetIndex, { sort, filter }); sheetIndex = index; ({ sort = null, filter = null } = viewStates.get(sheetIndex) || {});
    zoom = view().zoom; q('#ss-filter-text').value = filter?.text || ''; rowPage = colPage = 0; active = anchor = 'A1'; selected = new Set(['A1']);
    find.matches = []; find.index = -1;
  }
  q('.ss-sheets').onclick = e => { const b = e.target.closest('[data-sheet]'); if (!b) return; finishEdit(); closeValues(); enterSheet(+b.dataset.sheet); draw(); };
  for (const [id, row, delta] of [['ss-prev', true, -1], ['ss-next', true, 1], ['ss-left', false, -1], ['ss-right', false, 1]]) q(`#${id}`).onclick = () => { finishEdit(); if (row) rowPage += delta; else colPage += delta; draw(); };
  q('#ss-undo').onclick = () => history();
  q('#ss-redo').onclick = () => history(true);

  // ---- sort, filter and the column menu -----------------------------------------------------------------------------------------------
  function sortBy(column, direction) { finishEdit(); sort = { column, direction }; rowPage = 0; draw(); }
  function unsort() { finishEdit(); sort = null; draw(); }
  function showFilters(column = position(active).col) {
    finishEdit(); showPane(2); toggled('ss-filter', true); toggled('ss-find-open', false);
    if (String(filter?.column) !== String(column)) filter = { column: String(column), text: q('#ss-filter-text').value };
    draw(); q('#ss-values-toggle').focus();
  }
  function closePane() { closeValues(); showPane(0); toggled('ss-filter', false); toggled('ss-find-open', false); focusCell(active); }
  function hideColumn(column) {
    const v = view();
    if (shownCols.length <= 1) { message('Keep at least one column visible.'); return; }
    finishEdit(); v.hidden.add(column); persist();
    if (filter && String(filter.column) === String(column)) filter = { ...filter, column: 'all', values: null };
    draw(); focusCell(active);
  }
  function unhideColumns() { view().hidden.clear(); persist(); draw(); }
  function freezeColumns(count) { view().freezeCols = Math.max(0, Math.min(MAX_FREEZE, count)); persist(); colPage = 0; draw(); }
  function freezeUpTo(column) {
    if (column + 1 > MAX_FREEZE) { message(`Freeze up to ${MAX_FREEZE} columns.`); return; }
    freezeColumns(view().freezeCols === column + 1 ? 0 : column + 1);
  }
  function freezeRow() { view().freezeRows = view().freezeRows ? 0 : 1; persist(); rowPage = 0; draw(); }
  function wrapText() { view().wrap = !view().wrap; persist(); draw(); }
  function setZoom(next) {
    zoom = Math.max(.5, Math.min(2, next)); view().zoom = zoom; persist();
    grid.querySelector('table')?.style.setProperty('--ss-zoom', zoom); q('#ss-zoom').value = String(zoom); paintSizes();
  }
  // The column's menu and the cells' menu share these entries: sorting and filtering by the column, then what the column and the sheet's view can do.
  function columnItems(column, { head = true } = {}) {
    const v = view();
    return [{ label: 'Sort A to Z', icon: 'sort', run: () => sortBy(column, 'asc') }, { label: 'Sort Z to A', icon: 'sort', run: () => sortBy(column, 'desc') },
      { label: 'Filter by values', icon: 'filter', run: () => { showFilters(column); if (q('.ss-values-panel').hidden) valuesButton.click(); } },
      ...(head ? ['-',
        ...(sort ? [{ label: 'Original row order', run: unsort }] : []),
        { label: 'Autosize', run: () => fitColumn(column) },
        { label: v.freezeCols === column + 1 ? 'Unfreeze columns' : 'Freeze up to here', run: () => freezeUpTo(column) },
        { label: 'Hide column', run: () => hideColumn(column) },
        ...(v.hidden.size ? [{ label: 'Show hidden columns', run: unhideColumns }] : [])] : [])];
  }
  const headMenu = (at, column) => showMenu(at, columnItems(column));
  grid.addEventListener('click', e => { const b = e.target.closest('[data-column]'); if (b) { finishEdit(); headMenu(b, +b.dataset.column); } });
  grid.addEventListener('contextmenu', e => {
    const th = e.target.closest('thead th[data-col]'), td = e.target.closest('[data-cell]');
    if (!th && !td) return;
    e.preventDefault(); finishEdit();
    if (th) { headMenu({ x: e.clientX, y: e.clientY }, +th.dataset.col); return; }
    try { if (!selected.has(td.dataset.cell)) choose(td.dataset.cell); } catch (err) { message(err.message); return; }
    const column = position(td.dataset.cell).col, formulaHere = selectedFormula();
    showMenu({ x: e.clientX, y: e.clientY }, [
      { label: 'Cut', icon: 'cut', disabled: formulaHere, run: () => copySelection(true) }, { label: 'Copy', icon: 'copy', run: () => copySelection() }, { label: 'Paste', icon: 'paste', run: pasteClipboard }, '-',
      { label: 'Copy as table', run: copyAsTable }, { label: 'Clear', run: clearCells }, { label: 'Fill down', run: () => fillSelection('down') }, { label: 'Fill right', run: () => fillSelection('right') }, '-',
      ...columnItems(column, { head: false }), '-',
      { label: 'Find and replace', run: () => openFind(true) }, { label: 'Download selection as CSV', run: () => downloadCsv(true) }]);
  });
  q('#ss-sort-asc').onclick = () => sortBy(position(active).col, 'asc');
  q('#ss-sort-desc').onclick = () => sortBy(position(active).col, 'desc');
  q('#ss-sort-reset').onclick = unsort;
  q('#ss-wrap').onclick = wrapText;
  q('#ss-freeze-row').onclick = freezeRow;
  q('#ss-freeze-col').onclick = () => freezeColumns(view().freezeCols ? 0 : 1);
  q('#ss-unhide').onclick = unhideColumns;
  q('#ss-zoom').onchange = e => setZoom(Number(e.currentTarget.value));
  q('#ss-goto').onclick = goTo;
  q('#ss-filter').onclick = () => { if (pane === 2) closePane(); else showFilters(filter?.column ?? position(active).col); };
  q('#ss-filter-bar').onkeydown = e => { if (e.key === 'Escape' && valuesPanel.hidden) { e.preventDefault(); e.stopPropagation(); closePane(); } };
  const valuesPanel = q('.ss-values-panel'), valuesButton = q('#ss-values-toggle');
  let valueOptions = [], selectedValues = new Set();
  const closeValues = () => { valuesPanel.hidden = true; valuesButton.setAttribute('aria-expanded', 'false'); };
  function drawValues() {
    const query = q('#ss-values-search').value.toLocaleLowerCase();
    const matches = valueOptions.filter(o => (o.value || '(Blanks)').toLocaleLowerCase().includes(query));
    q('.ss-values-list').innerHTML = matches.length ? matches.map(o => `<label class="ss-value-option"><input type="checkbox" data-value-index="${valueOptions.indexOf(o)}"${selectedValues.has(o.value) ? ' checked' : ''}><span title="${esc(o.value || '(Blanks)')}">${esc(o.value || '(Blanks)')}</span><span class="meta">${o.count}</span></label>`).join('') : '<div class="meta">No matching values</div>';
  }
  valuesButton.onclick = () => {
    if (!valuesPanel.hidden) { closeValues(); return; }
    finishEdit(); valueOptions = filterValues(sheet(), model, q('#ss-filter-column').value);
    selectedValues = new Set(filter?.values ?? valueOptions.map(o => o.value));
    q('#ss-values-search').value = ''; valuesPanel.hidden = false; valuesButton.setAttribute('aria-expanded', 'true'); drawValues(); q('#ss-values-search').focus();
  };
  q('#ss-values-search').oninput = drawValues;
  function applyValues() {
    filter = { ...filter, column: q('#ss-filter-column').value, values: selectedValues.size === valueOptions.length ? null : [...selectedValues] };
    rowPage = 0; draw();
  }
  q('.ss-values-list').onchange = e => { const o = valueOptions[+e.target.dataset.valueIndex]; if (o) { if (e.target.checked) selectedValues.add(o.value); else selectedValues.delete(o.value); applyValues(); } };
  q('#ss-values-all').onclick = () => { selectedValues = new Set(valueOptions.map(o => o.value)); drawValues(); applyValues(); };
  q('#ss-values-none').onclick = () => { selectedValues.clear(); drawValues(); applyValues(); };
  q('#ss-values-done').onclick = () => { closeValues(); valuesButton.focus(); };
  valuesPanel.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); closeValues(); valuesButton.focus(); } };
  const dismissValues = e => { if (!e.target.closest('.ss-values-panel,#ss-values-toggle')) closeValues(); };
  document.addEventListener('pointerdown', dismissValues);
  const applyFilter = () => { finishEdit(); const column = q('#ss-filter-column').value; filter = { column, text: q('#ss-filter-text').value, values: String(filter?.column) === column ? filter?.values : null }; closeValues(); rowPage = 0; draw(); };
  q('#ss-filter-text').oninput = applyFilter; q('#ss-filter-column').onchange = applyFilter;
  q('#ss-clear-view').onclick = () => { filter = { column: q('#ss-filter-column').value }; q('#ss-filter-text').value = ''; closeValues(); rowPage = 0; draw(); };

  // ---- find and replace ---------------------------------------------------------------------------------------------------------------
  const findText = q('#ss-find-text'), replaceText = q('#ss-replace-text');
  const matchSet = () => new Set(find.matches);
  function paintFound() {
    const on = matchSet(), current = find.matches[find.index];
    for (const td of grid.querySelectorAll('[data-cell]')) td.classList.toggle('ss-found', on.has(td.dataset.cell) && td.dataset.cell !== current);
    const count = q('#ss-find-count');
    count.textContent = !find.query ? '' : !find.matches.length ? 'No matches' : find.index >= 0 ? `${find.index + 1} of ${find.matches.length}` : `${find.matches.length.toLocaleString('en')} ${find.matches.length === 1 ? 'match' : 'matches'}`;
  }
  // The matches again, after anything that changed the cells or what is shown; the one that was current stays current while it still matches.
  function findRefresh() {
    if (pane !== 1 || !find.query) { if (find.matches.length) { find.matches = []; find.index = -1; } paintFound(); return; }
    const keep = find.matches[find.index];
    find.matches = findCells(sheet(), model, find.query, { matchCase: find.matchCase, rows: rowOrder, cols: shownCols });
    find.index = keep ? find.matches.indexOf(keep) : -1;
    paintFound();
  }
  function findStep(delta) {
    if (!find.query) { findText.focus(); return; }
    finishEdit(); findRefresh();
    if (!find.matches.length) return;
    const n = find.matches.length, from = find.index >= 0 ? find.index : delta > 0 ? -1 : 0;
    find.index = ((from + delta) % n + n) % n;
    const ref = find.matches[find.index];
    try { choose(ref); showCell(ref); } catch (err) { message(err.message); }
    paintFound();
  }
  function openFind(replace = false) {
    finishEdit(); closeValues(); showPane(1); toggled('ss-find-open', true); toggled('ss-filter', false);
    const target = replace && find.query ? replaceText : findText;
    target.focus(); target.select(); findRefresh();
  }
  function replaceOne() {
    finishEdit(); findRefresh();
    if (!find.matches.length) { message(find.query ? 'No matches.' : 'Enter the text to find.'); return; }
    const ref = find.matches[find.index >= 0 ? find.index : 0];
    const { edits, skipped } = replaceEdits(sheet(), model, [ref], find.query, replaceText.value, { matchCase: find.matchCase, all: false });
    if (!edits.length) { message(skipped ? 'Formula cells are read-only, so they are not replaced.' : 'Nothing to replace.'); findStep(1); return; }
    model.apply(edits); draw();
    const next = find.matches.indexOf(ref);
    find.index = next >= 0 ? next : find.index - 1;                    // still a match (the new text holds the old): go on to the next
    findStep(1); message('');
  }
  function replaceAll() {
    finishEdit(); findRefresh();
    if (!find.matches.length) { message(find.query ? 'No matches.' : 'Enter the text to find.'); return; }
    const { edits, skipped } = replaceEdits(sheet(), model, find.matches, find.query, replaceText.value, { matchCase: find.matchCase, all: true });
    if (edits.length) { model.apply(edits); draw(); }
    message(`${edits.length} ${edits.length === 1 ? 'cell' : 'cells'} replaced${skipped ? `; ${skipped} formula ${skipped === 1 ? 'cell' : 'cells'} kept` : ''}. Undo is available.`);
  }
  q('#ss-find-open').onclick = () => { if (pane === 1) closePane(); else openFind(); };
  q('#ss-find-prev').onclick = () => findStep(-1);
  q('#ss-find-next').onclick = () => findStep(1);
  q('#ss-replace').onclick = replaceOne;
  q('#ss-replace-all').onclick = replaceAll;
  q('#ss-find-case').onclick = e => { find.matchCase = !find.matchCase; e.currentTarget.setAttribute('aria-pressed', String(find.matchCase)); find.index = -1; findRefresh(); };
  q('#ss-find-close').onclick = closePane;
  findText.oninput = () => { find.query = findText.value; find.index = -1; findRefresh(); };
  findText.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePane(); } };
  q('#ss-find-pane').onkeydown = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); closePane(); } };
  replaceText.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePane(); } };
  // ⌘F, ⌘H and ⌘G work wherever the keyboard is in the sheet, so the shell does not take them.
  body.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || editing) return;
    const key = e.key.toLowerCase();
    if (key === 'f' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); openFind(false); }
    else if (key === 'h') { e.preventDefault(); e.stopPropagation(); openFind(true); }
    else if (key === 'g' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); goTo(); }
  });

  // ---- download -----------------------------------------------------------------------------------------------------------------------
  async function downloadCsv(selectionOnly) {
    finishEdit();
    try {
      const matrix = selectionOnly ? selectionMatrix(sheet(), model, selected, rowOrder) : sheetMatrix(sheet(), model, rowOrder, shownCols);
      const base = fileBase(name), file = selectionOnly ? `${base} - ${sheet().name} selection.csv` : workbook.sheets.length > 1 ? `${base} - ${sheet().name}.csv` : `${base}.csv`;
      // a byte order mark, so a spreadsheet program reads the accents as UTF-8
      const done = await saveFile(`﻿${matrixCsv(matrix)}`, file.replace(/[\\/:*?"<>|]/g, ' '), 'text/csv;charset=utf-8');
      if (done) message(`${selectionOnly ? 'Selection' : 'Sheet'} downloaded.`);
    } catch (err) { message(err.message); }
  }
  q('#ss-download').onclick = e => showMenu(menuAnchor(e.currentTarget), [{ label: 'Download sheet as CSV', run: () => downloadCsv(false) }, { label: 'Download selection as CSV', run: () => downloadCsv(true) }]);
  q('#ss-shortcuts').onclick = e => showMenu(menuAnchor(e.currentTarget), [
    { label: 'Edit cell', meta: 'Enter / F2', disabled: true }, { label: 'Move between cells', meta: 'Tab / arrows', disabled: true }, { label: 'Extend selection', meta: 'Shift + arrows', disabled: true },
    { label: 'Copy / cut / paste', meta: '⌘/Ctrl C / X / V', disabled: true }, { label: 'Select all', meta: '⌘/Ctrl A', disabled: true }, { label: 'Fill down', meta: '⌘/Ctrl D', disabled: true },
    { label: 'Find / find and replace', meta: '⌘/Ctrl F / H', disabled: true }, { label: 'Go to cell', meta: '⌘/Ctrl G', disabled: true },
    { label: 'Undo / redo', meta: '⌘/Ctrl Z / Shift Z', disabled: true }, { label: 'Clear selected cells', meta: 'Delete', disabled: true }, { label: 'Save', meta: '⌘/Ctrl S', disabled: true }]);

  // ---- Ask AI -------------------------------------------------------------------------------------------------------------------------
  const setPanel = open => { q('.ss-workspace').classList.toggle('ss-ai-closed', !open); q('#ss-ai-toggle').setAttribute('aria-expanded', String(open)); q(open ? '#ss-question' : '#ss-ai-toggle').focus(); };
  q('#ss-ai-toggle').onclick = () => setPanel(q('.ss-workspace').classList.contains('ss-ai-closed'));
  q('#ss-ai-close').onclick = () => setPanel(false);
  const answer = q('#ss-answer'), review = q('#ss-proposals'), ask = q('#ss-ask'), suggest = q('#ss-suggest'), stop = q('#ss-stop');
  function controls(busy = false) {
    const cfg = modelFor('chat'), ready = configured(cfg);
    ask.disabled = suggest.disabled = busy || !ready; suggest.hidden = busy; stop.hidden = !busy;
    q('#ss-model').textContent = ready ? cfg.label || cfg.model : 'No model connected';
    q('#ss-model').title = ready ? cfg.model || '' : '';
  }
  function reviewPaint() {
    review.innerHTML = proposals.length ? `${uiBar({ kind: 'head', label: 'Review edits', id: 'ss-review-bar', lead: { title: 'Review edits', level: 'h3' }, message: { id: 'ss-review-count', text: `${proposals.length} ${proposals.length === 1 ? 'suggestion' : 'suggestions'}` } })}${proposals.map((p, i) => `<div class="ss-proposal">
      <label><input type="checkbox" data-proposal="${i}"${p.checked ? ' checked' : ''}><strong>${esc(p.sheet)}!${p.cell}</strong></label>
      <div class="ss-before"><span class="meta">Current</span><div>${esc(p.before || '(empty)')}</div></div>
      <label><span class="meta">Suggested</span><textarea rows="2" data-after="${i}" aria-label="Suggested value for ${p.cell}">${esc(p.after)}</textarea></label>
      <p>${esc(p.reason)}</p></div>`).join('')}${uiBar({ kind: 'foot', label: 'Review edits', id: 'ss-review-foot', actions: [{ id: 'ss-dismiss', label: 'Dismiss' }, { id: 'ss-apply', label: 'Apply checked edits', role: 'primary' }] })}` : '';
    review.querySelectorAll('[data-proposal]').forEach(c => c.onchange = () => { proposals[+c.dataset.proposal].checked = c.checked; });
    review.querySelectorAll('[data-after]').forEach(t => t.oninput = () => { proposals[+t.dataset.after].after = t.value; });
    review.querySelector('#ss-dismiss')?.addEventListener('click', () => { proposals = []; reviewPaint(); });
    review.querySelector('#ss-apply')?.addEventListener('click', () => {
      try {
        const edits = reviewedEdits(proposals, model);
        if (!edits.length) { message('Check at least one suggestion to apply.'); return; }
        model.apply(edits); proposals = proposals.filter(p => !p.checked); draw(); reviewPaint();
        message(`${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} applied. Review the cells, then save. Undo is available.`);
      } catch (err) { message(err.message); }
    });
  }
  async function askSelection(suggestEdits) {
    finishEdit(); const question = q('#ss-question').value.trim();
    if (!question) { answer.textContent = 'Enter a question or describe the edits you want.'; q('#ss-question').focus(); return; }
    let snapshot;
    try { snapshot = model.snapshot(sheet().name, selected); } catch (err) { answer.textContent = err.message; return; }
    const version = ++requestVersion, cfg = modelFor('chat');
    q('#ss-response-context').textContent = `Response for ${snapshot.sheet} · ${snapshot.selection.length > 80 ? `${snapshot.cells.length} cells` : snapshot.selection}`;
    controller = new AbortController(); const signal = controller.signal;
    const timeout = setTimeout(() => controller?.abort(), 90000);
    proposals = []; reviewPaint(); controls(true); answer.textContent = `Working on ${snapshot.sheet} · ${snapshot.selection}…`;
    try {
      const raw = await complete(cfg, spreadsheetMessages(snapshot, question, suggestEdits), { signal, context: false, json: suggestEdits, prompt: SHEET_ASK });
      if (disposed || version !== requestVersion) return;
      if (signal.aborted) throw new DOMException('Request stopped', 'AbortError');
      if (suggestEdits) { const parsed = parseSuggestions(raw, snapshot); proposals = parsed.edits; answer.textContent = parsed.answer + (proposals.length ? '' : '\nNo cell edits suggested.'); reviewPaint(); }
      else answer.textContent = raw;
    } catch (err) { if (!disposed && version === requestVersion) answer.textContent = signal.aborted ? 'Request stopped. No cells changed.' : err.message; }
    finally { clearTimeout(timeout); if (!disposed && version === requestVersion) { controller = null; controls(); } }
  }
  ask.onclick = () => askSelection(false); suggest.onclick = () => askSelection(true);
  stop.onclick = () => controller?.abort();
  zoom = view().zoom;
  draw(); controls();
  return { model, bar: stripEl,
    dirty: () => model.dirty() || Boolean(editing && editing.innerText.replace(/\n$/, '') !== model.value(sheet().name, editing.dataset.cell)) || Boolean(valuePending()),
    selection: () => { finishEdit(); return { kind: 'cells', ...model.snapshot(sheet().name, selected) }; },
    revealSelection: a => {
      const index = workbook.sheets.findIndex(s => s.name === a.sheet);
      if (index < 0 || !a.cells?.length) return false;
      const refs = new Set(a.cells.map(c => c.cell || c.ref));
      for (const ref of refs) position(ref);
      const now = model.snapshot(a.sheet, refs);
      const differs = now.cells.some((c, i) => c.value !== a.cells[i].value || c.formula !== a.cells[i].formula);
      if (index !== sheetIndex) enterSheet(index);
      view().hidden.clear(); selected = refs; active = [...refs][0]; anchor = active;
      draw(); focusCell(active);
      return differs ? 'Cells highlighted. Their values have changed since this note was saved.' : true;
    },
    flush: () => finishEdit(), refresh: () => { draw(); controls(); },
    dispose: () => { disposed = true; requestVersion++; controller?.abort(); endResize(); persist(); clearTimeout(statsTimer); window.removeEventListener('pointerup', endDrag); document.removeEventListener('pointerdown', dismissValues); },
    focus: () => ({ kind: 'spreadsheet', label: `${name} · ${sheet().name}`, detail: selectionLabel(selected) }) };
}

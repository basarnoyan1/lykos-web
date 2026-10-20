// The input grid of a pooled effect (Analysis › an outcome): studies as rows, the measure's inputs as columns, a row per treated arm
// where a study has several (lib/input-grid.mjs). A cell is typed in place as in Extraction's grid: it holds the same extraction value,
// written through the same path (lib/cell-write.mjs: locks, double extraction, NR, proposals), and the write is added to the extraction
// log. The arrow keys and Tab move between cells, Enter or typing starts an edit, Enter or Tab saves it and moves on, Escape leaves the
// value as it was. A locked value is read only and says why. After a write the page is drawn again, so a result that ran on other
// inputs shows as changed since it ran (lib/analysis-inputs.mjs pooledInputStatus).
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { pagedTable } from '../lib/ui-components.mjs';
import { pageOf, pager, wirePager, EDITOR_PAGE_SIZE } from '../lib/paging.mjs';
import { inputGrid, checkInput } from '../lib/input-grid.mjs';
import { writeCellValue } from '../lib/cell-write.mjs';
import { doubleOn } from '../lib/double-extraction.mjs';
import { doubleMode } from './extraction-double.mjs';

// The selected cell and the cell typed in, by row id and column index: they outlive a repaint, so the page drawn after a write puts the
// selection back, and a repaint while typing (a run going on) puts the editor back with its draft.
let sel = null;       // { row, c }
let editing = null;   // { row, c, draft }
let restoreFocus = false;
let pointerDown = false;
let watching = false;
// a page of rows at a time, as an edited list pages (EDITOR_PAGE_SIZE, 20); the keys move on to the next page and back
const GRID_PAGE = EDITOR_PAGE_SIZE;
let page = 1;

/** The extractor whose entries the grid shows and takes, while double extraction is on (Extraction's choice). */
const doubleOf = () => (doubleOn(get()) ? doubleMode() : null);

/** The message the grid's head carries: whose entries it shows, in double extraction. */
export function gridMessage() {
  const d = doubleOf();
  return d === 'compare' ? 'Comparing entries · read only' : d ? `Extractor ${d}'s entries` : '';
}

/** The grid's table, in a region that keeps the study column in view. */
export function gridHtml(measure, slot, label) {
  const g = inputGrid(get(), measure, slot, { double: doubleOf() });
  if (sel && !g.rows.some(r => r.id === sel.row)) sel = null;
  if (sel) page = Math.floor(g.rows.findIndex(r => r.id === sel.row) / GRID_PAGE) + 1;
  const view = pageOf(g.rows, page, GRID_PAGE); page = view.page;
  const first = sel || (view.items.length ? { row: view.items[0].id, c: 0 } : null);
  const cell = (r, x, c) => {
    const on = first && first.row === r.id && first.c === c;
    const cls = ['cell', 'num', on ? 'sel' : '', x.proposed ? 'proposed' : '', /^nr$/i.test(x.text) ? 'nr' : '', x.readOnly ? 'locked' : '', x.shared ? 'shared' : ''].filter(Boolean).join(' ');
    const name = `${g.columns[c].label}, ${r.label}`;
    const tip = x.why || (x.proposed ? 'Proposed · not accepted' : x.shared ? 'Shared control: the same value on every arm’s row' : '');
    return `<td class="${cls}" data-row="${esc(r.id)}" data-c="${c}" tabindex="${on ? 0 : -1}" aria-label="${esc(name)}"${x.readOnly ? ' aria-readonly="true"' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${esc(x.text)}</td>`;
  };
  // the row's head is the study as the other analysis tables name it, its title the tooltip
  const rows = view.items.map(r => `<tr data-state="${r.state}"><th scope="row"${r.paper.title ? ` title="${esc(r.paper.title)}"` : ''}><span class="study-label">${esc(r.label)}</span></th>${r.cells.map((x, c) => cell(r, x, c)).join('')}</tr>`).join('');
  return pagedTable({ label, sticky: true, html: `<table class="an-grid" role="grid" aria-label="${esc(label)}"><thead><tr><th scope="col">Study</th>${g.columns.map(c => `<th scope="col" class="num">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,
    pager: pager({ id: 'an-grid-pager', page: view.page, pages: view.pages, total: g.rows.length, label: 'rows', size: GRID_PAGE }) });
}

/** Wires the grid drawn by gridHtml; `ctx.rerender` draws the page again after a write. */
export function wireGrid(el, ctx, measure, slot) {
  const table = el.querySelector('table.an-grid'); if (!table) return;
  watchPointer();
  const g = () => inputGrid(get(), measure, slot, { double: doubleOf() });
  const tdAt = at => at && table.querySelector(`td[data-row="${CSS.escape(at.row)}"][data-c="${at.c}"]`);
  const atOf = td => ({ row: td.dataset.row, c: Number(td.dataset.c) });
  const cellOf = at => g().rows.find(r => r.id === at.row)?.cells[at.c];
  const select = (at, focus = true) => {
    const td = tdAt(at);
    if (!td) { if (ids.includes(at.row)) { sel = at; again(focus); } return; }   // a row on another page: that page is drawn

    table.querySelectorAll('td.cell.sel').forEach(x => { x.classList.remove('sel'); x.tabIndex = -1; });
    td.classList.add('sel'); td.tabIndex = 0; sel = at;
    if (focus) { td.focus({ preventScroll: true }); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  };
  // the next cell: across a row and on to the next one (Tab), or a row up or down in the same column, over every page's rows
  const ids = g().rows.map(r => r.id);
  const move = (at, dr, dc) => {
    const rows = ids;
    const width = table.querySelectorAll('thead th.num').length;
    let r = rows.indexOf(at.row), c = at.c + dc;
    if (dc && c >= width) { c = 0; r++; } else if (dc && c < 0) { c = width - 1; r--; }
    r += dr;
    if (r < 0 || r >= rows.length) return null;
    return { row: rows[r], c: Math.max(0, Math.min(width - 1, c)) };
  };
  const say = t => ctx.say?.(t);
  const start = (at, initial = null) => {
    const x = cellOf(at); if (!x) return false;
    if (x.readOnly) { say(x.why); return false; }
    editing = { ...at, draft: initial ?? x.text };
    return mount();
  };
  function mount({ reveal = true } = {}) {
    const td = tdAt(editing); if (!td) { editing = null; return false; }
    select(editing, false);
    const x = cellOf(editing), name = td.getAttribute('aria-label');
    td.classList.add('editing'); td.removeAttribute('title');
    td.innerHTML = `<span class="ext-cell-held" aria-hidden="true">${esc(td.textContent)}</span><input class="ext-cell-input" value="${esc(editing.draft)}" aria-label="${esc(name)}" spellcheck="false" autocomplete="off" inputmode="decimal">`;
    const input = td.querySelector('input');
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    if (reveal) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const save = () => {
      const at = editing; if (!at) return true;
      const why = checkInput(input.value, x.type) || writeCellValue(x.paperId, x.fieldId, input.value, { id: x.fieldId, type: x.type }, { double: doubleOf(), via: 'Analysis' });
      if (why) { say(why); input.setAttribute('aria-invalid', 'true'); return false; }
      editing = null; return true;
    };
    input.oninput = () => { if (editing) editing.draft = input.value; input.removeAttribute('aria-invalid'); };
    input.onkeydown = e => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; td.classList.remove('editing'); td.textContent = x.text; select(sel); return; }
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault(); e.stopPropagation();
      const from = { row: td.dataset.row, c: Number(td.dataset.c) };
      if (!save()) return;
      sel = move(from, e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : 0, e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0) || from;
      again();
    };
    // A press elsewhere saves what was typed and shows it in the cell at once; the page is drawn again once the press is over, so the
    // press lands where it was aimed. A repaint that removed the editor or the window losing focus keeps the draft.
    input.onblur = () => {
      if (!editing || !input.isConnected || !document.hasFocus()) return;
      if (!save()) return;
      td.classList.remove('editing'); td.textContent = cellOf({ row: td.dataset.row, c: Number(td.dataset.c) })?.text ?? '';
      later();
    };
    return true;
  }
  function again(focus = true) { restoreFocus = focus; ctx.rerender(); ctx.refreshCounts?.(); }
  function later() {
    const go = () => { if (editing || !table.isConnected) return; again(table.contains(document.activeElement)); };
    if (pointerDown) document.addEventListener('pointerup', () => setTimeout(go, 0), { once: true, capture: true }); else setTimeout(go, 0);
  }

  table.addEventListener('mousedown', e => { const td = e.target.closest('td.cell'); if (td && !td.classList.contains('editing')) select(atOf(td)); });
  table.addEventListener('dblclick', e => { const td = e.target.closest('td.cell'); if (td && !td.classList.contains('editing')) start(atOf(td)); });
  table.addEventListener('keydown', e => {
    const td = e.target.closest?.('td.cell'); if (!td || td.classList.contains('editing') || e.isComposing) return;
    const at = atOf(td), step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (step || e.key === 'Tab') {
      const next = step ? move(at, step[0], step[1]) : move(at, 0, e.shiftKey ? -1 : 1);
      if (!next) return;   // Tab past the last cell leaves the grid
      e.preventDefault(); select(next); return;
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); start(at); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); start(at, e.key); }
  });
  // what the page drawn last puts back: the editor with its draft, else the focus on the selected cell
  wirePager(el, 'an-grid-pager', n => { page = n; sel = null; editing = null; restoreFocus = false; ctx.rerender(); });
  if (editing && tdAt(editing)) mount({ reveal: false });
  else { editing = null; if (restoreFocus && sel) select(sel); }
  restoreFocus = false;
}

function watchPointer() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
}

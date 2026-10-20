// Reading a table from a PDF page (plan §4.5a): the cells found in a region,
// shown as a grid to correct, then given to extraction cells or an evidence
// table. Nothing is filled without this review, and every value filled keeps
// the page, the document version and the rectangle of its cell.
//
// It is a tab of the Files view, "Table: <study> p.N" (DIALOGS plan #55): the grid beside the selected cell, with its own tools bar under the tab. The
// grid, the selection and the values chosen live in `st`, held by the tab's tool, so a tab the page released draws itself again as it was.
import { esc } from '../lib/html.mjs';
import { get } from '../store.mjs';
import { fields, setAnchoredValue, cellNumber } from '../lib/fields.mjs';
import { templates } from '../lib/templates.mjs';
import { normalise } from '../lib/anchor.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { tableText } from '../lib/table-detect.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, watchWidth } from '../lib/ui-actions.mjs';
import { formField, tableRegion } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { toolStacks } from './file-doc.mjs';

const union = (a, b) => (!a ? b : !b ? a : { x1: Math.min(a.x1, b.x1), x2: Math.max(a.x2, b.x2), y1: Math.min(a.y1, b.y1), y2: Math.max(a.y2, b.y2) });

/** What a cell's text becomes as a value of a field: a number where the field wants one, else the text. */
export function valueOfCell(text, field) {
  const t = String(text ?? '').trim();
  if (field?.type === 'integer') { const r = normalise(field.id, t, [field]); return r.ok ? { reported: t, normalized: r.normalized_value } : null; }
  if (field?.type === 'number') {
    const m = /[-−]?\d[\d.,]*/.exec(t); const n = m ? cellNumber(m[0].replace('−', '-'), 'number') : NaN;
    return Number.isFinite(n) ? { reported: t, normalized: n } : null;
  }
  return t ? { reported: t, normalized: t } : null;
}

/**
 * Open the table reader as a Files tab.
 * read: { rows: [[{ text, rect, span }]], columns } from lib/table-detect.mjs readTable.
 * where: { paperId, page, hash } of the document. ctx: the shell's, to go to Files. Resolves once the tab is open; the values filled are reported there.
 */
export async function openTableReader({ read, where, ctx = null }) {
  const paper = (get().papers || []).find(p => p.id === where.paperId);
  const st = { grid: read.rows.map(r => r.map(c => ({ ...c }))), sel: null, assigned: new Map(), study: where.paperId, field: '', status: '' };   // assigned: cell -> { group, field }
  const name = String(paper?.label || paper?.title || 'table');
  const tool = { label: `Table: ${name.length > 28 ? `${name.slice(0, 27)}…` : name} p.${where.page}`, icon: 'table', mount: (ops, host) => mountReader(ops, host, st, where) };
  const files = await import('./files.mjs');
  files.openTool(tool);
  ctx?.go?.('files');
}

function mountReader(ops, { body: b, placeTools }, st, where) {
  const { uid: u, inst, say } = ops;
  const grid = st.grid, s = get();
  const groups = [{ name: templates(s)[0].name, cols: fields(s) }, ...templates(s).filter(t => t.id !== 'default').map(t => ({ name: t.name, cols: t.columns || [] }))];
  const options = groups.map((g, gi) => `<optgroup label="${esc(g.name)}">${g.cols.map(f => `<option value="${gi}:${esc(f.id)}">${esc(f.label || f.name || f.id)}</option>`).join('')}</optgroup>`).join('');
  const papers = s.papers || [], paperName = id => { const p = papers.find(x => x.id === id); return p ? (p.label || p.title || p.id) : 'None'; };
  b.classList.add('fv-tool-body');
  b.innerHTML = `<div class="tr-work"><div data-tr="grid"></div>
    <div class="tr-side"><section class="an-section"><h3>Cell</h3>
        <div class="tr-cell" data-tr="cell" aria-live="polite"></div>
        <div class="an-settings">${formField('Field', `<select data-tr="field">${options}</select>`, { span: 2 })}</div>
        ${uiBar({ kind: 'tools', density: 'dense', id: `${u}-cell-tools`, label: 'Cell tools',
          actions: [{ id: `${u}-set`, label: 'Set', icon: 'check', role: 'secondary', disabled: true }, { id: `${u}-join`, label: 'Join with row above', icon: 'arrow-up', role: 'secondary', disabled: true }],
          overflow: [{ id: `${u}-drop-row`, label: 'Remove row', danger: true }, { id: `${u}-drop-col`, label: 'Remove column', danger: true }] })}</section>
      <section class="an-section"><h3>Values</h3><div data-tr="list"></div></section></div></div>`;
  const $ = q => b.querySelector(q);
  const el = id => b.querySelector(`[id="${u}-${id}"]`);
  const field = $('[data-tr=field]');
  if (st.field) field.value = st.field;
  field.onchange = () => { st.field = field.value; };
  st.field = field.value;

  const bar = placeTools(ops, {
    label: 'Table tools', message: { id: `${u}-status`, text: st.status },
    actions: [
      { id: `${u}-csv`, label: 'Download', icon: 'download', role: 'secondary', fold: 3, menu: true },
      { picker: true, id: `${u}-study`, label: 'Study', icon: 'library', role: 'quiet', fold: 5, value: paperName(st.study), options: papers.map(p => [p.id, p.label || p.title || p.id]), valueCh: 16 },
      { id: `${u}-fill`, label: 'Fill', icon: 'plus', role: 'primary', disabled: true },
    ],
  });
  const tool = id => bar.querySelector(`[id="${u}-${id}"]`);
  const status = t => { st.status = t || ''; const m = tool('status'); if (m) { m.textContent = st.status; m.title = st.status; } };
  const fieldOf = a => groups[a.group].cols.find(f => f.id === a.field);
  const where_ = cell => { for (let i = 0; i < grid.length; i++) { const j = grid[i].indexOf(cell); if (j >= 0) return [i, j]; } return null; };

  function drawGrid() {
    $('[data-tr=grid]').innerHTML = tableRegion({ label: 'Table cells', html: `<table class="tr-table"><tbody>${grid.map((r, i) => `<tr>${r.map((c, j) =>
      `<td class="tr-c${st.sel === c ? ' sel' : ''}${st.assigned.has(c) ? ' set' : ''}" data-r="${i}" data-c="${j}"><input class="ui-cell-field" value="${esc(c.text)}" aria-label="Row ${i + 1}, column ${j + 1}"></td>`).join('')}</tr>`).join('')}</tbody></table>` });
    const at = input => grid[+input.closest('td').dataset.r][+input.closest('td').dataset.c];
    $('[data-tr=grid]').querySelectorAll('.tr-c input').forEach(i => {
      i.onchange = () => { at(i).text = i.value; if (st.sel === at(i)) side(); };
      i.onfocus = () => { st.sel = at(i); mark(); side(); };
    });
  }
  // the selection moves by class only, so the inputs are not redrawn under the pointer
  function mark() { b.querySelectorAll('.tr-c').forEach(td => td.classList.toggle('sel', grid[+td.dataset.r]?.[+td.dataset.c] === st.sel)); }
  function side() {
    $('[data-tr=cell]').textContent = st.sel ? st.sel.text : 'Select a cell';
    const at = st.sel && where_(st.sel);
    el('set').disabled = !st.sel || !st.sel.text.trim();
    el('join').disabled = !at || at[0] === 0;
    $('[data-tr=list]').innerHTML = uiList({ id: `${u}-values`, label: 'Values to fill', empty: 'No values chosen',
      rows: [...st.assigned].map(([c, a], i) => uiRow({ attrs: { 'data-value': i }, main: { html: `<span class="tr-v" title="${esc(c.text)}">${esc(c.text.slice(0, 40))}</span>`, detail: [esc(fieldOf(a)?.label || a.field)] },
        end: uiRowEnd({ more: { label: `More for ${c.text.slice(0, 40)}`, attrs: { 'data-more': i } } }) })) });
    tool('fill').disabled = !st.assigned.size;
    b.querySelectorAll('.tr-c').forEach(td => td.classList.toggle('set', st.assigned.has(grid[+td.dataset.r]?.[+td.dataset.c])));
    b.querySelectorAll('[data-more]').forEach(m => { m.onclick = () => showMenu(m, [{ label: 'Remove value', danger: true, run: () => { st.assigned.delete([...st.assigned.keys()][+m.dataset.more]); side(); } }]); });
  }
  el('set').onclick = () => {
    if (!st.sel) return;
    const [g, ...rest] = field.value.split(':');
    st.assigned.set(st.sel, { group: +g, field: rest.join(':') });
    status(''); side();
  };
  el('drop-row').onclick = () => {
    const at = st.sel && where_(st.sel); if (!at) return;
    const [r] = grid.splice(at[0], 1); r.forEach(c => st.assigned.delete(c)); st.sel = null; drawGrid(); side();
  };
  el('drop-col').onclick = () => {
    const at = st.sel && where_(st.sel); if (!at) return;
    grid.forEach(r => { const [c] = r.splice(at[1], 1); if (c) st.assigned.delete(c); }); st.sel = null; drawGrid(); side();
  };
  el('join').onclick = () => {
    const at = st.sel && where_(st.sel); if (!at || at[0] === 0) return;
    const i = at[0], a = grid[i - 1], r = grid[i];
    r.forEach((c, j) => { if (!a[j]) return; a[j].text = [a[j].text, c.text].filter(Boolean).join(' '); a[j].rect = union(a[j].rect, c.rect); st.assigned.delete(c); });
    grid.splice(i, 1); st.sel = null; drawGrid(); side();
  };
  tool('csv').onclick = () => showMenu(tool('csv'), [{ label: 'CSV', run: () => downloadCsv(tableText(grid), 'table.csv') }]);
  tool('study').addEventListener('ui-pick', e => {
    st.study = e.detail?.value || st.study;
    const v = tool('study').querySelector('.ui-picker-value'); if (v) v.textContent = paperName(st.study);
  });
  tool('fill').onclick = () => {
    let n = 0, skipped = 0;
    for (const [cell, a] of st.assigned) {
      const f = fieldOf(a), v = valueOfCell(cell.text, f);
      if (!f || !v) { skipped++; continue; }
      const ok = setAnchoredValue(st.study, f.id, {
        reported_value: v.reported, normalized_value: v.normalized, origin: 'reported', extractor: 'human:table',
        evidence: [{ kind: 'text', document_version: where.hash, page: where.page, quote: cell.text, rects: cell.rect ? [cell.rect] : [] }] });
      if (ok) n++; else skipped++;
    }
    if (!n) { if (skipped) status(`${skipped} not filled`); return; }
    ops.ctx?.refreshCounts?.();
    say(`${n} value${n === 1 ? '' : 's'} filled${skipped ? `; ${skipped} not filled` : ''}`);
    ops.onClose();
  };
  inst.releasers.push(watchWidth(b, () => b.toggleAttribute('data-stacked', toolStacks(b.clientWidth))));
  drawGrid(); side();
}

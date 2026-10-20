// The flow diagram's boxes as targets (plan K1). Clicking a box on screen opens
// the records behind its number in the inspector's Details: the box's counts,
// one at a time, and the records that make the chosen one as a paged list. A
// count entered by hand says it has no records. The exported figure is drawn
// without any of this (lib/prisma-flow.mjs `interactive`).
import { get } from '../store.mjs';
import { boxDetail } from '../lib/prisma-records.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { uiLink } from '../lib/ui-components.mjs';

let pageSize = 6;
let box = null;      // the box clicked
let part = null;     // the count of that box in view
let group = '';      // one source or reason of that count ('' is all)
let page = 1;

/** Picks a box from elsewhere (the Overview's Identified row), as a press on it would. */
export function pickBox(id) { box = id; part = null; group = ''; page = 1; }

/** The box in view, for the assistant's focus. */
export const pickedBox = () => box;

/** Marks the picked box on a drawn diagram. */
function mark(host) {
  host.querySelectorAll('[data-box]').forEach(g => g.toggleAttribute('data-on', g.dataset.box === box));
}
export const markBox = mark;

/** Makes a host's diagram respond: a press or Enter on a box opens its records. */
export function wireBoxes(host, ctx) {
  mark(host);
  const pick = g => {
    if (!g) return;
    box = g.dataset.box; part = null; group = ''; page = 1;
    ctx.openDetails?.();
    document.querySelectorAll('[data-prisma-preview]').forEach(mark);
  };
  host.onclick = e => pick(e.target.closest?.('[data-box]'));
  host.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { const g = e.target.closest?.('[data-box]'); if (g) { e.preventDefault(); pick(g); } } };
}

/** The Details section for the picked box, or null. */
export function recordsSection(ctx) {
  if (!box) return null;
  const d = boxDetail(get(), box);
  if (!d) return null;
  if (!d.parts.some(p => p.field === part)) part = d.parts.find(p => p.count != null)?.field || d.parts[0].field;
  const p = d.parts.find(x => x.field === part);
  if (!p.groups.some(g => g.name === group)) group = '';
  const list = group ? p.groups.find(g => g.name === group).records : p.records;
  const size = pageSize;
  const view = pageOf(list, page, size);
  page = view.page;
  const count = p.count == null ? 'No count' : String(p.count);
  const head = uiList({ label: `${p.label} count`, cols: ['count'], rows: [uiRow({ main: { html: esc(p.label) }, cells: [{ col: 'count', kind: 'text', ch: 8, html: esc(count) }] })] });
  const state = p.manual
    ? `<div class="meta">${esc(p.note)}${p.projectCount != null ? ` The project's own count is ${p.projectCount}.` : ''}</div>`
    : p.note ? `<div class="meta">${esc(p.note)}</div>` : '';
  const records = p.manual || p.count == null ? '' : view.items.length
    ? `${uiList({ id: 'box-records', label: 'Records in this box', rows: view.items.map(r => {
        const name = `${r.label}${r.year && !String(r.label).includes(String(r.year)) ? ` (${r.year})` : ''}`;
        return uiRow({ main: { html: r.removed ? esc(name) : uiLink({ label: name, attrs: { 'data-rec': r.id } }), detail: [esc(r.title || ''), esc(r.note || '')], wrap: true } });
      }) })}${pager({ id: 'box-pager', page: view.page, pages: view.pages, total: list.length, label: 'records', size })}`
    : emptyState({ title: 'No records', size: 'inline' });
  const partPick = d.parts.length > 1 ? `<label class="field"><span>Count</span><select data-box-part aria-label="Count in this box">${d.parts.map(x =>
    `<option value="${esc(x.field)}"${x.field === part ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>` : '';
  const groupPick = !p.manual && p.groups.length > 1 ? `<label class="field"><span>Show</span><select data-box-group aria-label="Records of one kind">
    <option value="">All ${p.records.length}</option>${p.groups.map(g => `<option value="${esc(g.name)}"${g.name === group ? ' selected' : ''}>${esc(g.name)} · ${g.records.length}</option>`).join('')}</select></label>` : '';
  return { title: d.label, meta: p.manual ? 'Entered by hand' : p.count == null ? '' : `${list.length} of ${count}`,
    html: `${partPick}${head}${state}${groupPick}${!p.manual && list.length ? `<label class="field box-page-size"><span>Per page</span><select data-box-size aria-label="Records per page">${[4, 6, 12].map(n => `<option value="${n}"${pageSize === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}${records}`,
    wire: el => {
      el.querySelector('[data-box-size]')?.addEventListener('change', e => { pageSize = +e.target.value || 6; page = 1; ctx.openDetails?.(); });
      el.querySelector('[data-box-part]')?.addEventListener('change', e => { part = e.target.value; group = ''; page = 1; ctx.openDetails?.(); });
      el.querySelector('[data-box-group]')?.addEventListener('change', e => { group = e.target.value; page = 1; ctx.openDetails?.(); });
      wirePager(el, 'box-pager', n => { page = n; ctx.openDetails?.(); });
      el.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
        const paper = (get().papers || []).find(x => x.id === b.dataset.rec);
        ctx.showStudy?.(b.dataset.rec, Boolean(paper?.pdf));
      });
    } };
}

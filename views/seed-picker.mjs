// Which records a tool starts from: every included study, or records chosen
// from the library (and, where the tool takes them, PMIDs and DOIs pasted in).
// The choice is kept while the project stays open, so switching between the
// tools does not lose it.
//
// The picker is the first row of a tool's form (uiSettingsRow: the label in the form's one label column, the choice beside it); choosing
// records opens the chooser (filter, Select page, Clear, a page of records) under that row.
import { get } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { pagedItems, wireDataPager, resetPagedList } from '../lib/list-pager.mjs';
import { uiBar, uiList, uiRow, uiSettingsRow } from '../lib/ui-actions.mjs';
import { isIncluded, screeningStarted } from '../lib/screen.mjs';

// The store hands back the same object until another project replaces it.
const KEEP = { ref: null, mode: 'included', ids: new Set(), filter: '', pasted: '' };
const pick = () => { const s = get(); if (KEEP.ref !== s) Object.assign(KEEP, { ref: s, mode: 'included', ids: new Set(), filter: '', pasted: '' }); return KEEP; };
const PAGE = 8;

/** The seeds the picker currently stands for: `{ mode, ids, included, pasted }`. */
export function seedChoice() {
  const k = pick(), s = get();
  const included = (s.papers || []).filter(p => isIncluded(s, p.id));
  return { mode: k.mode, ids: k.mode === 'included' ? included.map(p => p.id) : [...k.ids].filter(id => (s.papers || []).some(p => p.id === id)), included, pasted: k.pasted };
}
/** The PMIDs and DOIs typed for the tool that takes them (Seed records), kept with the choice. */
export const pastedText = () => pick().pasted;
export function setPasted(text) { pick().pasted = String(text ?? ''); }
/** Why the tool cannot start from the choice, or '' when it can (the title bar's message beside a disabled primary). */
export function seedReason({ pasted = false } = {}) {
  const c = seedChoice();
  if (c.ids.length || (pasted && c.pasted.trim())) return '';
  return c.mode === 'chosen' ? 'Choose records first' : 'No included studies yet';
}

/** Draws the Source row and its chooser into `host` and calls `onChange` when the choice changes. */
export function seedPicker(host, opts = {}) {
  const pickChanged = typeof opts.onChange === 'function' ? opts.onChange : () => {};
  const k = pick(), s = get(), papers = s.papers || [];
  const incN = papers.filter(p => isIncluded(s, p.id)).length;
  const sourceRow = () => uiSettingsRow({ id: 'seed-source', label: 'Source', controls: { id: 'seed-switch',
    view: { id: 'seed-mode', label: 'Source', attr: 'data-seed-mode', kind: 'segmented', value: k.mode, items: [['included', 'Included studies', incN], ['chosen', 'Chosen records', k.ids.size]] },
    ...(!screeningStarted(s) && k.mode === 'included' ? { message: { id: 'seed-included-note', text: 'No inclusion decisions yet' } } : {}) } });
  const chosenBar = () => uiBar({ kind: 'tools', label: 'Chosen records', id: 'seed-tools',
    filters: [{ type: 'search', id: 'seed-filter', label: 'Filter records', placeholder: 'Filter records', value: k.filter }],
    actions: [{ id: 'seed-page', label: 'Select page', role: 'quiet', icon: 'check' }, { id: 'seed-none', label: 'Clear', role: 'quiet', icon: 'close' }] });
  host.innerHTML = `<div class="seed-picker"><div id="seed-switch-host">${sourceRow()}</div>
    <div class="seed-chosen"${k.mode === 'chosen' ? '' : ' hidden'}>${chosenBar()}<div class="seed-list"></div></div></div>`;
  const list = host.querySelector('.seed-list');
  const rows = () => { const f = k.filter.trim().toLowerCase(); return papers.filter(p => !f || `${p.label || ''} ${p.title || ''} ${p.doi || ''} ${p.pmid || ''}`.toLowerCase().includes(f)).slice(0, 300); };
  let shown = [];
  const drawList = () => {
    const all = rows(), pg = pagedItems(all, 'seed-list', PAGE); shown = pg.items;
    list.innerHTML = all.length ? uiList({ id: 'seed-rows', label: 'Records', rows: shown.map(p => uiRow({ cls: 'seed-row',
      check: { attrs: { 'data-seed': p.id }, checked: k.ids.has(p.id), label: `Select ${p.title || p.label || p.id}` },
      main: { html: `<span class="seed-title">${esc(p.title || p.label || p.id)}</span>`, detail: [esc([p.label, p.year].filter(Boolean).join(', '))], wrap: true } })) })
      : emptyState({ title: 'No records', size: 'inline' });
    const wrap = list.firstElementChild;
    if (all.length) wireDataPager(wrap, 'seed-list', { total: pg.total, size: PAGE, onChange: drawList });
    list.querySelectorAll('[data-seed]').forEach(cb => cb.onchange = () => { cb.checked ? k.ids.add(cb.dataset.seed) : k.ids.delete(cb.dataset.seed); count(); pickChanged(); });
  };
  const count = () => { const c = host.querySelector('[data-seed-mode="chosen"] .ui-count'); if (c) c.textContent = String(k.ids.size); };
  const setMode = mode => {
    k.mode = mode;
    host.querySelector('#seed-switch-host').innerHTML = sourceRow();
    wireSwitch();
    host.querySelector('.seed-chosen').hidden = k.mode !== 'chosen';
    if (k.mode === 'chosen') { resetPagedList('seed-list'); drawList(); }
    pickChanged();
  };
  const wireSwitch = () => host.querySelectorAll('[data-seed-mode]').forEach(b => b.onclick = () => { if (b.dataset.seedMode !== k.mode) setMode(b.dataset.seedMode); host.querySelector(`[data-seed-mode="${k.mode}"]`)?.focus(); });
  wireSwitch();
  host.querySelector('#seed-filter').oninput = e => { k.filter = e.target.value; resetPagedList('seed-list'); drawList(); };
  host.querySelector('#seed-page').onclick = () => {
    shown.forEach(p => k.ids.add(p.id));
    list.querySelectorAll('[data-seed]').forEach(cb => { cb.checked = true; }); count(); pickChanged();
  };
  host.querySelector('#seed-none').onclick = () => { k.ids = new Set(); list.querySelectorAll('[data-seed]').forEach(cb => { cb.checked = false; }); count(); pickChanged(); };
  if (k.mode === 'chosen') drawList();
}

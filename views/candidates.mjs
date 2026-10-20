// A ranked list of works found by citation chasing or related-article search:
// each with what points at it, checkboxes, and one button that adds the picked
// ones to the library. Long lists are paged. Records the library already holds
// are counted, not listed.
import { esc, emptyState } from '../lib/html.mjs';
import { authorLine } from '../lib/bib.mjs';
import { pagedItems, wireDataPager, resetPagedList } from '../lib/list-pager.mjs';
import { uiBar, uiList, uiRow } from '../lib/ui-actions.mjs';
import { num } from '../lib/dates.mjs';
import * as coll from '../lib/collections.mjs';

const PAGE = 20;

/**
 * Draws `found.candidates` (each with `inLibrary`, `record`, `links`) into
 * `host`. `describe(c)` is the text of the links column. `onAdd(ids,
 * destination)` adds and answers how many were added.
 */
export function candidateList(host, found, { describe, onAdd, noun = 'works', key = 'cand' }) {
  const fresh = found.candidates.filter(c => !c.inLibrary);
  const held = found.candidates.length - fresh.length;
  const collections = (nodes, path = '') => nodes.flatMap(c => { const label = path ? `${path} / ${c.name}` : c.name; return [[c.id, label], ...collections(c.children, label)]; });
  const destinations = [['', 'Library'], ...collections(coll.tree())];
  const picked = new Set();
  const bar = () => uiBar({ kind: 'tools', label: `New ${noun}`, id: `${key}-tools`,
    message: { id: `${key}-count`, text: `${num(fresh.length)} new · ${num(held)} already in the library` },
    filters: [{ type: 'select', id: `${key}-dest`, label: 'Add to', options: destinations, attrs: { 'data-cand-dest': true } }],
    actions: [{ id: `${key}-page`, label: 'Select page', role: 'quiet', icon: 'check', attrs: { 'data-cand-page': true } },
      { id: `${key}-add`, label: 'Add', icon: 'plus', role: 'primary', disabled: true, attrs: { 'data-cand-add': true } }],
    overflow: [{ id: `${key}-all`, label: 'Select all', attrs: { 'data-cand-all': true } }, { id: `${key}-none`, label: 'Clear selection', attrs: { 'data-cand-none': true } }] });
  host.innerHTML = fresh.length ? `${bar()}<div class="cand-host"></div>` : `${emptyState({ title: 'Nothing new', size: 'inline' })}`;
  if (!fresh.length) return { picked: () => [] };
  const body = host.querySelector('.cand-host');
  const row = c => { const r = c.record;
    return uiRow({ cls: 'cand-row', attrs: { 'data-cand-row': c.id },
      check: { attrs: { 'data-cand': c.id }, checked: picked.has(c.id), label: `Select ${r.title}` },
      main: { html: `<span class="cand-title">${esc(r.title)}</span>`, detail: [esc([authorLine(r.authors), r.year].filter(Boolean).join(' · ')), esc([r.journal, r.doi ? r.doi : r.pmid ? `PMID ${r.pmid}` : ''].filter(Boolean).join(' · ')), esc(describe(c))], wrap: true } }); };
  const add = () => host.querySelector('[data-cand-add]');
  const sync = () => {
    const b = add(), label = b.querySelector('.ui-act-label');
    b.disabled = !picked.size; label.textContent = picked.size ? `Add ${num(picked.size)}` : 'Add';
  };
  let shown = [];
  const draw = () => {
    const pg = pagedItems(fresh, key, PAGE); shown = pg.items;
    body.innerHTML = uiList({ id: `${key}-list`, label: `New ${noun}`, rows: shown.map(row) });
    wireDataPager(body.firstElementChild, key, { total: pg.total, size: PAGE, onChange: draw });
    body.querySelectorAll('[data-cand]').forEach(cb => cb.onchange = () => { cb.checked ? picked.add(cb.dataset.cand) : picked.delete(cb.dataset.cand); sync(); });
  };
  resetPagedList(key);
  draw();
  host.querySelector('[data-cand-page]').onclick = () => { shown.forEach(c => picked.add(c.id)); body.querySelectorAll('[data-cand]').forEach(cb => { cb.checked = true; }); sync(); };
  host.querySelector('[data-cand-all]').onclick = () => { fresh.forEach(c => picked.add(c.id)); body.querySelectorAll('[data-cand]').forEach(cb => { cb.checked = true; }); sync(); };
  host.querySelector('[data-cand-none]').onclick = () => { picked.clear(); body.querySelectorAll('[data-cand]').forEach(cb => { cb.checked = false; }); sync(); };
  add().onclick = () => { const n = onAdd([...picked], host.querySelector('[data-cand-dest]').value); picked.clear(); return n; };
  return { picked: () => [...picked] };
}

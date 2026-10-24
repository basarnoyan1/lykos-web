// A long list shown a page at a time, with "1–8 of 17 ‹ ›" under it. The rows
// are all rendered; the pager only hides the ones off the page, so the list's
// own wiring is untouched. The page is remembered per list key across repaints,
// and the list keeps the height of a full page so the pager does not move.
import { pagerBar } from './paging.mjs';
import { projectGeneration } from '../store.mjs';

const pages = new Map();
let generation = -1;
/** A key becomes part of control ids: letters, digits and hyphens only. */
const idOf = key => `pgr-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list'}`;
const steps = (prevOff, nextOff) => [{ key: 'prev', disabled: prevOff, attrs: { 'data-dir': -1 } }, { key: 'next', disabled: nextOff, attrs: { 'data-dir': 1 } }];
function syncProject() {
  const next = projectGeneration();
  if (generation !== next) { pages.clear(); generation = next; }
}

/** Select data before rendering it; the DOM contains only the current page. */
export function pagedItems(items, key, size = 25) {
  syncProject();
  const total = items.length, count = Math.max(1, Math.ceil(total / size));
  const page = Math.min(count - 1, Math.max(0, pages.get(key) || 0));
  pages.set(key, page);
  const start = page * size, end = Math.min(total, start + size);
  return { items: items.slice(start, end), total, page, pages: count, start, end };
}
export const resetPagedList = key => pages.delete(key);
export function revealPagedItem(key, index, size = 25) { syncProject(); if (index >= 0) pages.set(key, Math.floor(index / size)); }
export function wireDataPager(body, key, { total, size = 25, onChange }) {
  syncProject();
  body.parentElement?.querySelector(`:scope > .ov-pager[data-pager="${CSS.escape(key)}"]`)?.remove();
  if (total <= size) return;
  const page = Math.min(Math.ceil(total / size) - 1, pages.get(key) || 0);
  const bar = document.createElement('div');
  bar.className = 'ov-pager'; bar.dataset.pager = key;
  bar.innerHTML = pagerBar({ id: idOf(key), label: 'Pages', text: `${page * size + 1}–${Math.min(total, (page + 1) * size)} of ${total}`, steps: steps(!page, (page + 1) * size >= total) });
  body.after(bar);
  bar.querySelectorAll('[data-dir]').forEach(button => button.onclick = () => {
    const direction = button.dataset.dir;
    pages.set(key, page + Number(direction)); onChange();
    const next = document.querySelector(`.ov-pager[data-pager="${CSS.escape(key)}"] [data-dir="${direction}"]:not(:disabled)`)
      || document.querySelector(`.ov-pager[data-pager="${CSS.escape(key)}"] button:not(:disabled)`);
    next?.focus({ preventScroll: true });
  });
}

/** Pages the rows matching `sel` inside `body`, `size` at a time, when there are more than `size`. */
export function pageList(body, key, sel = ':scope > *', size = 8) {
  syncProject();
  const items = [...body.querySelectorAll(sel)];
  body.parentElement?.querySelector(`:scope > .ov-pager[data-pager="${CSS.escape(key)}"]`)?.remove();
  if (items.length <= size) { items.forEach(it => { it.hidden = false; }); return; }
  const count = Math.ceil(items.length / size);
  const bar = document.createElement('div');
  bar.className = 'ov-pager'; bar.dataset.pager = key;
  bar.innerHTML = pagerBar({ id: idOf(key), label: 'Pages', text: ' ', steps: steps(true, false) });
  body.after(bar);
  const show = () => {
    const p = Math.min(count - 1, Math.max(0, pages.get(key) || 0)); pages.set(key, p);
    items.forEach((it, i) => { it.hidden = Math.floor(i / size) !== p; });
    bar.querySelector('.ui-bar-message').textContent = `${p * size + 1}–${Math.min(items.length, (p + 1) * size)} of ${items.length}`;
    bar.querySelector('[data-dir="-1"]').disabled = p === 0;
    bar.querySelector('[data-dir="1"]').disabled = p === count - 1;
  };
  show();
  body.style.removeProperty('min-height');
  // a full first page's height, read on the next frame: read here it laid the view out mid-draw
  if ((pages.get(key) || 0) === 0) requestAnimationFrame(() => { if (body.isConnected && (pages.get(key) || 0) === 0) body.style.setProperty('min-height', `${body.offsetHeight}px`); });
  bar.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { pages.set(key, (pages.get(key) || 0) + Number(b.dataset.dir)); show(); });
}

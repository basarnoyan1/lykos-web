// A list's page, kept across redraws, for the lists drawn again from the project on every change (the owner, 2026-10-23: "enable paging
// for all lists"): fifty rows a page through the one pager (lib/paging.mjs); a redraw keeps the page, a list that shrank shows its last page.
// Kept apart from lib/paging.mjs, which the shell loads at start: the views that page a list load this with themselves.
import { pageOf, pager, wirePager, PAGE_SIZE } from './paging.mjs';
export { PAGE_SIZE, EDITOR_PAGE_SIZE } from './paging.mjs';

const keptPages = new Map();
/** The rows of the page `id` is on, and its pager (empty while one page holds them). Wire it with wirePagedList. */
export function pagedList(id, items, { label = 'rows', size = PAGE_SIZE } = {}) {
  const shown = pageOf(items, keptPages.get(id) || 1, size);
  keptPages.set(id, shown.page);
  return { items: shown.items, page: shown.page, pages: shown.pages, offset: (shown.page - 1) * size,
    pager: pager({ id: `${id}-pager`, page: shown.page, pages: shown.pages, total: items.length, label, size }) };
}
/** Wires a pagedList's pager: a step sets the page and redraws. */
export function wirePagedList(root, id, redraw) { wirePager(root, `${id}-pager`, n => { keptPages.set(id, n); redraw(); }); }
/** Sets the page `id` is on (a search that starts again at the first page, a row revealed on its page). */
export const setListPage = (id, n) => keptPages.set(id, Math.max(1, n));
/** Wires every pagedList pager drawn in `root` (a view with several, one a group): a step sets that list's page and redraws. */
export function wirePagedLists(root, redraw) {
  for (const el of root?.querySelectorAll?.('.pager[id$="-pager"]') || []) {
    const id = el.id.slice(0, -'-pager'.length);
    if (keptPages.has(id)) wirePagedList(root, id, redraw);
  }
}

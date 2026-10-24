// Paging and filtering for lists that can get long (the plan targets 10,000 records: rendering them all took over a second).
import { icon } from './icons.mjs';
import { esc } from './html.mjs';
import { uiBar, uiGroup } from './ui-actions.mjs';

/** Rows of a read-only list per page. */
export const PAGE_SIZE = 50;
export { LIST_ROWS_MAX } from './ui-actions.mjs';
/** Rows per page where a row can open an editor in place (ui-components.mjs editorRows): an open editor is tall, so the page is short. */
export const EDITOR_PAGE_SIZE = 20;

export function pageOf(items, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages };
}

// Previous and next are registry icons, centred by the button's own flex box; a typed ‹ › is placed by the font, 1.2px under the middle (VALIGN-INVENTORY).
const PAGE_STEPS = { first: [null, 'First page'], prev: ['chevron-left', 'Previous page'], next: ['chevron-right', 'Next page'], last: [null, 'Last page'] };

/**
 * The one pager: the range on the left, the steps on the right, one dense row that never wraps (action system design,
 * section 12). Every pager in the app is this bar; only what the steps carry differs. At most three controls are ever
 * visible, so the jumps to the first and last page sit in More.
 *   id        names the bar's controls (`${id}-prev`), so a pager's markup is the same on every render
 *   text      the range, "1–50 of 120 records"
 *   steps     [{ key: 'prev'|'next', disabled, attrs }] in the order shown; attrs carry the caller's hook (data-page,
 *             data-dir), so the name and the order are decided here and only the hook is the caller's
 *   jumps     [{ key: 'first'|'last', disabled, attrs }] the same shape, listed in More in the order given
 * A foot bar, not a strip: a strip is left-aligned, and a pager belongs at the trailing edge.
 */
export function pagerBar({ id, label = 'Pages', text = '', steps, jumps = [] }) {
  const base = `${id}-bar`, items = [];
  for (const step of steps) {
    const [ico, name] = PAGE_STEPS[step.key] || [null, step.key];
    items.push({ id: `${base}-${step.key}`, label: step.name || name, icon: ico || 'chevron-right', disabled: !!step.disabled, attrs: step.attrs });
  }
  const overflow = jumps.map(jump => {
    const name = jump.name || (PAGE_STEPS[jump.key] || [, jump.key])[1];
    return { id: `${base}-${jump.key}`, label: name, disabled: !!jump.disabled, attrs: { ...jump.attrs, 'aria-label': name } };
  });
  return uiBar({ kind: 'foot', label, density: 'dense', stack: false, cls: 'ui-pager',
    start: text ? [{ message: text }] : undefined,
    actions: [uiGroup({ id: `${base}-steps`, label, display: 'icon', keep: true, role: 'quiet', items })],
    overflow: overflow.length ? overflow : undefined });
}

/** The control. Rendered only when there is more than one page.
 *  `size` must match the size the caller paged with, or the range it prints
 *  describes a page nobody is looking at. The wrapper keeps the id and the legacy
 *  class the callers address; the bar inside is the builder's. */
export function pager({ id, page, pages, total, label = 'records', size = PAGE_SIZE }) {
  if (pages <= 1) return '';
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const step = (key, target, off) => ({ key, disabled: off, attrs: { 'data-page': target } });
  return `<div class="pager" id="${esc(id)}">${pagerBar({ id, label: `Pages of ${label}`, text: `${from}–${to} of ${total} ${label}`,
    steps: [step('prev', page - 1, page === 1), step('next', page + 1, page === pages)],
    jumps: [step('first', 1, page === 1), step('last', pages, page === pages)] })}</div>`;
}

/** Wires a pager's buttons to a setter. */
export function wirePager(root, id, onPage) {
  root.querySelector('#' + id)?.querySelectorAll('[data-page]')
    .forEach(b => b.onclick = () => {
      const label = b.getAttribute('aria-label');
      onPage(Number(b.dataset.page));
      if (!b.isConnected) {
        const controls = [...(root.querySelector('#' + id)?.querySelectorAll('button:not(:disabled)') || [])];
        (controls.find(next => next.getAttribute('aria-label') === label) || controls[0])?.focus({preventScroll:true});
      }
    });
}


// A pane that changes form below a measured width (a table that keeps its title column on a phone): `data-narrow` set while the
// element is narrower than `px`: measured by watchWidth and decided by lib/table-fit.mjs, as the Extraction grid's columns are, never a width
// query (app/lint-actions.mjs L3, T9). The stylesheet keys on it.
import { watchWidth } from './ui-actions.mjs';
import { titleOnly } from './table-fit.mjs';

/** Keeps `data-narrow` on `el` while it is narrower than `px`; once per element. */
export function watchNarrow(el, px) {
  if (!el || el.dataset.narrowWatched) return;
  el.dataset.narrowWatched = '1';
  watchWidth(el, () => el.toggleAttribute('data-narrow', titleOnly(el.clientWidth, px)), { now: true });   // the pane's width decides (lib/table-fit.mjs)
}

// A pane that changes form below a measured width (a table that keeps its title column on a phone): `data-narrow` set while the
// element is narrower than `px`: measured by watchWidth and decided by lib/table-fit.mjs, as the Extraction grid's columns are, never a width
// query (app/lint-actions.mjs L3, T9). The stylesheet keys on it.
import { lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { titleOnly } from './table-fit.mjs';

/** Keeps `data-narrow` on `el` while it is narrower than `px`; once per element. */
export function watchNarrow(el, px) {
  if (!el || el.dataset.narrowWatched) return;
  el.dataset.narrowWatched = '1';
  // the pane's width decides (lib/table-fit.mjs); a pane not laid out yet (no width) is not narrow: measured at 0 before the page was
  // drawn, the registered manuscript's outline stood over its text at 2000 px (2 Nov 2026)
  watchWidth(el, () => { if (el.clientWidth) el.toggleAttribute('data-narrow', titleOnly(el.clientWidth, px)); }, { now: true });
}

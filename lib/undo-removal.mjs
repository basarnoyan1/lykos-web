// A removal that can be taken back is done at once and offered back, never asked about first (Component review 2026-10-21, item 19, after
// Todoist's and MagicPath's "Removed, Undo"): the view takes an undo point before it removes, removes, and offers Undo in a toast at the
// window's corner. Undo puts back the parts of the project the removal changed (its top-level keys), as they were at the undo point, so an
// edit to another part made since stays. A step that cannot be taken back (a file deleted from disk, a project deleted from app storage,
// a reset) keeps its confirmation. One toast at a time: a second removal replaces the first one's offer.
import { get, update, projectGeneration } from '../store.mjs';
import { showShellNotice, hideShellNotice } from './shell-notice.mjs';

const ID = 'undo-removal';
const SHOWN_MS = 10000;
let timer = 0;

const copy = v => (v === undefined ? undefined : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** The project as it is before a removal: what Undo goes back to. */
export function undoPoint(s = get()) {
  return { generation: projectGeneration(), keys: Object.fromEntries(Object.keys(s).map(k => [k, JSON.stringify(s[k])])), state: copy(s) };
}

/** The top-level keys a removal changed since its undo point (a key added or taken away counts). */
export function changedKeys(point, s = get()) {
  const keys = new Set([...Object.keys(point.keys), ...Object.keys(s)]);
  return [...keys].filter(k => point.keys[k] !== JSON.stringify(s[k]));
}

/** Puts back what the removal changed; false when another project was opened since. */
export function restore(point, keys = changedKeys(point)) {
  if (point.generation !== projectGeneration() || !keys.length) return false;
  update(s => { for (const k of keys) { if (k in point.state) s[k] = copy(point.state[k]); else delete s[k]; } return s; });
  return true;
}

/**
 * Offers the removal back: a toast with `text` ("Removed Revision") and Undo. `after` runs once the removal is undone (a view redraws).
 * Nothing is offered when the removal changed nothing.
 */
export function offerUndo(point, text, after = () => {}, doc = globalThis.document) {
  const keys = changedKeys(point);
  if (!keys.length) return false;
  clearTimeout(timer);
  const shown = showShellNotice({ id: ID, label: 'Removed', text, again: true,
    actions: [{ id: `${ID}-run`, label: 'Undo', run: () => { clearTimeout(timer); if (restore(point, keys)) after(); } }] }, doc);
  if (shown) timer = setTimeout(() => hideShellNotice(ID), SHOWN_MS);
  return shown;
}

/** Removes with `run` (it may be async) and offers Undo, in one call: the common shape of a view's Remove. */
export async function removeWithUndo(text, run, after = () => {}) {
  const point = undoPoint();
  await run();
  return offerUndo(point, text, after);
}

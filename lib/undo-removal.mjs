// A removal that can be taken back is done at once and offered back, never asked about first (Component review 2026-10-21, item 19, after
// Todoist's and MagicPath's "Removed, Undo"): the view takes an undo point before it removes, removes, and offers Undo in a toast at the
// window's corner. The removal is one step of the project's Undo (store.mjs beginStep; lib/undo-history.mjs keeps what each write
// replaced), so taking it back costs what it changed, never a copy of the project (7 Nov 2026, plan W13: copying the 131 MB Sham project
// took seconds for each removal). The toast takes back that step while it is the last one; once another step comes after it, the toast
// goes and Edit › Undo still reaches it. A step that cannot be taken back (a file deleted from disk, a project deleted from app storage,
// a reset) keeps its confirmation. One toast at a time: a second removal replaces the first one's offer.
import { store$beginStep as beginStep, store$endStep as endStep, store$lastStep as lastStep, store$undo as undo, store$onUndoState as onUndoState, store$projectGeneration as projectGeneration } from "../boot.mjs";
import { lib_shell_notice$showShellNotice as showShellNotice, lib_shell_notice$hideShellNotice as hideShellNotice } from "../boot.mjs";

const ID = 'undo-removal';
const SHOWN_MS = 10000;
let timer = 0, unwatch = null;

/** Before a removal: what it changes from here to offerUndo() is one step of Undo. */
export function undoPoint() {
  beginStep();
  return { generation: projectGeneration() };
}

const close = () => { clearTimeout(timer); unwatch?.(); unwatch = null; hideShellNotice(ID); };

/**
 * Offers the removal back: a toast with `text` ("Removed Revision") and Undo. `after` runs once the removal is undone (a view redraws).
 * Nothing is offered when the removal changed nothing, or when another project was opened since its undo point.
 */
export function offerUndo(point, text, after = () => {}, doc = globalThis.document) {
  const step = endStep(text);
  if (!step || point?.generation !== projectGeneration()) return false;
  close();
  const shown = showShellNotice({ id: ID, label: 'Removed', text, again: true,
    actions: [{ id: `${ID}-run`, label: 'Undo', run: () => { const mine = lastStep() === step; close(); if (mine && undo()) after(); } }] }, doc);
  if (shown) {
    timer = setTimeout(close, SHOWN_MS);
    unwatch = onUndoState(() => { if (lastStep() !== step) close(); });   // another step, or this one taken back with Edit › Undo
  }
  return shown;
}

/** Removes with `run` (it may be async) and offers Undo, in one call: the common shape of a view's Remove. */
export async function removeWithUndo(text, run, after = () => {}) {
  const point = undoPoint();
  try { await run(); } catch (err) { endStep(); throw err; }
  return offerUndo(point, text, after);
}

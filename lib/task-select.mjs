// Selecting several tasks on the Tasks page (design: tasks-design.md §4).
//
// A selection is `{ active, ids: Set, anchor }`. Every function here answers a
// new selection and leaves the one it was given alone, so a view can keep the
// old one for a comparison. Nothing is stored or drawn here: the view owns the
// current selection, keyed by project, and passes in the order the user sees.
//
//   order    the task ids the filters show, in reading order, every page and
//            every column (orderFromRows for the list, orderFromColumns for the
//            board). Range and select-all read it, so a task on page 2 counts.
//   parent and child are independent: choosing a parent never chooses its
//            subtasks, so "N selected" is exactly what an action touches.
//
// Pure: no DOM, no clock, no store.

export const newSelection = () => ({ active: false, ids: new Set(), anchor: '' });

const copy = (sel, patch = {}) => ({ active: !!sel?.active, ids: new Set(sel?.ids || []), anchor: sel?.anchor || '', ...patch });
const valid = id => typeof id === 'string' && id !== '';

/** Starts selecting; with an id (Cmd/Ctrl-click on a row) that task is chosen and becomes the anchor. */
export function enterSelect(sel, id) {
  const next = copy(sel, { active: true });
  if (valid(id)) { next.ids.add(id); next.anchor = id; }
  return next;
}

/** Stops selecting and forgets everything. */
export const leaveSelect = () => newSelection();

/** Chooses or unchooses one task; the anchor moves to it either way. Inert when not selecting. */
export function toggleId(sel, id) {
  const next = copy(sel);
  if (!next.active || !valid(id)) return next;
  if (next.ids.has(id)) next.ids.delete(id); else next.ids.add(id);
  next.anchor = id;
  return next;
}

/**
 * Chooses every task from the anchor to `id` in `order`, inclusive, keeping what was chosen already.
 * The anchor stays, so the next Shift-click pivots on the same task. With no anchor in `order`
 * (never set, or the task is gone) it chooses just `id` and anchors there. An id outside `order` changes nothing.
 */
export function rangeTo(sel, order, id) {
  const next = copy(sel), list = Array.isArray(order) ? order : [...(order || [])];
  const to = list.indexOf(id);
  if (!next.active || to < 0) return next;
  const from = list.indexOf(next.anchor);
  if (from < 0) { next.ids.add(id); next.anchor = id; return next; }
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.ids.add(list[i]);
  return next;
}

/** Chooses exactly the tasks in `order` (what the filters show, all pages). Works with nothing chosen yet; inert when not selecting. */
export function selectAllIn(sel, order) {
  const next = copy(sel);
  if (!next.active) return next;
  next.ids = new Set(order || []);
  if (!next.ids.has(next.anchor)) next.anchor = '';
  return next;
}

/** Unchooses everything but keeps selecting ("Clear selection"). */
export const clearIds = sel => copy(sel, { ids: new Set(), anchor: '' });

/**
 * Drops chosen ids that are not in `visible` (a task deleted or filtered out by something
 * other than the user's hand: an assistant proposal, another window). The anchor goes with
 * its task; selecting stays on.
 */
export function reconcile(sel, visible) {
  const keep = visible instanceof Set ? visible : new Set(visible || []), next = copy(sel);
  next.ids = new Set([...next.ids].filter(id => keep.has(id)));
  if (!keep.has(next.anchor)) next.anchor = '';
  return next;
}

const unique = ids => [...new Set(ids)];
/** Task ids of treeRows output, in reading order. */
export const orderFromRows = rows => unique((rows || []).map(r => r?.task?.id).filter(valid));
/** Task ids of boardColumns output, column by column, top to bottom. */
export const orderFromColumns = cols => unique((cols || []).flatMap(c => (c?.tasks || []).map(t => t?.id)).filter(valid));

/** The ids an action touches: chosen and in `order`, in reading order. Nothing while not selecting. */
export function bulkTargets(sel, order) {
  if (!sel?.active) return [];
  const chosen = sel.ids || new Set();
  return unique(order || []).filter(id => chosen.has(id));
}

/** How many are chosen; with `order`, how many an action would touch (the two agree after reconcile). */
export const selectedCount = (sel, order) => (order ? bulkTargets(sel, order).length : (sel?.ids?.size || 0));

/** Whether every task in `order` is chosen (false for an empty order: there is nothing to have chosen). */
export function isAllSelected(sel, order) {
  const list = unique(order || []);
  return !!sel?.active && list.length > 0 && list.every(id => sel.ids.has(id));
}

/** The line that says how many are chosen. */
export const selectedLine = (n, total) => `${n} selected of ${total}`;

/**
 * The width, in the status line's steps (`steps`, in ch), to keep for selectedLine while choosing, so the button beside it stays put as the
 * number changes. Letters are narrower than the digit a ch is measured by, so the room the widest line needs is under its length: measured
 * at 12px, "16 selected of 16" is 93px against 17ch = 122px, and "1000 selected of 1000" 121px against 21ch = 151px. A fifth less than the length
 * leaves at least 7px to spare in every case measured (tasks-select.browser.test.mjs checks that nothing clips at 9, 99, 100 and 1000 tasks).
 */
export const selectedCh = (total, steps) => steps.find(c => c >= Math.ceil(0.8 * selectedLine(total, total).length)) ?? steps.at(-1);


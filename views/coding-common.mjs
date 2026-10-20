// Shared state and small helpers of the coding workspace (views/coding.mjs and
// its panels coding-book.mjs, coding-reports.mjs, coding-dialogs.mjs).
import { get, update } from '../store.mjs';
import { readQual } from '../lib/qual.mjs';
import { settingsOf } from '../lib/app-settings.mjs';
import { esc } from '../lib/html.mjs';
import { dialogFoot } from '../lib/ui-actions.mjs';
export { plural } from '../lib/dates.mjs';

/** What the workspace shows; kept across repaints. */
export const ui = {
  tab: 'document', sub: null, docId: null, coding: null, coderView: '', memoCase: null, focusSpeakers: false,
  matrix: 'frequency', chosenCodes: new Set(), expanded: new Set(), chosenCases: new Set(),
  retrieve: { codeId: '', children: true, docId: '', caseId: '', attrId: '', value: '', coder: '', exemplar: false },
  crosstab: { attrId: '', unknown: false }, framework: { columns: 'codes', cell: null },
  joint: { dataset: '', key: '', group: '', value: '', columns: 'codes' },
  agreement: { a: '', b: '', unit: 'characters' },
};


let footSerial = 0;
/**
 * The foot of a dialog here: Cancel (when it has one) and the confirming action as a foot bar, so nothing in it can wrap. `[data-no]` and
 * `[type=submit]` are what the dialogs wire. `start` is the bar's left-hand part: one act ({ label, icon, attrs }) or a message ({ message, id }).
 */
export function foot(label, ok, { cancel = 'Cancel', start = null } = {}) {
  const id = `qc-foot-${++footSerial}`;
  const left = !start ? {} : start.message != null ? { message: { text: start.message, id: start.id } } : { start: [{ ...start, id: start.id || `${id}-start` }] };
  return dialogFoot({ label, id, cls: 'ui-dialog-foot ask-foot', ...left,
    actions: [...(cancel ? [{ id: `${id}-no`, label: cancel, keep: true, attrs: { 'data-no': true } }] : []), { id: `${id}-ok`, label: ok, role: 'primary', type: 'submit' }] });
}
/** Runs a change on the project and repaints. */
export function commit(ctx, fn, msg) { let out; update(s => { out = fn(s); return s; }); ctx.rerender(msg); ctx.refreshCounts?.(); return out; }
/** Who is coding: the name set in the workspace, else the initials or name in Settings. */
export const currentCoder = (s = get()) => readQual(s).coder || String(settingsOf(s).reviewerInitials || settingsOf(s).reviewerName || '').trim();
export const options = (list, value, empty = null) =>
  `${empty != null ? `<option value="">${esc(empty)}</option>` : ''}${list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}`;
export const cut = (t, n = 160) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
export const fileBase = t => String(t || 'coding').replace(/[^\w.-]+/g, '_').slice(0, 60);

/** Opens the file chooser. */
export function pickFiles({ accept = '', multiple = false } = {}, fn) {
  const i = document.createElement('input');
  i.type = 'file'; i.hidden = true;
  if (accept) i.accept = accept;
  if (multiple) i.multiple = true;
  document.body.append(i);
  i.onchange = async () => { try { if (i.files.length) await fn([...i.files]); } finally { i.remove(); } };
  i.oncancel = () => i.remove();
  i.click();
}

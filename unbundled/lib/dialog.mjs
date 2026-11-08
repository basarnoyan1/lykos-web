// Modal prompts. window.prompt/confirm are unavailable in the Tauri webview and embedded browser panes, so every place that asked for one value routes
// through here. Returns null when dismissed.
//
// The one dialog recipe (DIALOGS §3, docs/UI_Guidelines.md "Dialogs"). A dialog is a short blocking decision: confirm an act, create or rename with
// one to three fields, choose between answers, accept a computed plan, pick one item. Anything read without answering, with its own sections or more
// than three fields, or that the person works beside, is a page, a pane section, a setting or a popover. Every dialog has:
//   - a width tier (DIALOG_TIERS): S 340 (a confirm, one field), text 380 (a note), M 520 (two or three fields, a plan, a checklist), L 600 (a
//     picker). Nothing else; the body scrolls, head and foot stay.
//   - the title alone in its head (.ask-head, 20/600, no buttons) and an optional detail line naming the object;
//   - a body of formField() stacked in one column, at most one data-ui-help line, no headings, no type=number or type=date;
//   - one foot bar: Cancel, then one primary (danger when it destroys); one other act, or a destructive one, in the start slot. Close is never a primary;
//   - focus on the first field, else the primary, else Cancel when the primary is destructive; Escape and a press outside cancel; Enter submits;
//     focus returns to the opener.
// Each dialog carries data-dialog="<id>", its entry in app/tools/ui-regression/dialogs.json (the sweep fails an unregistered one or one off the recipe).
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { dialogFoot, uiList, uiRow } from './ui-actions.mjs';
import { inDesktop } from './native.mjs';
import { confirmSheet } from './app-menu.mjs';

/** The widths a dialog may take, by tier (DIALOGS §3). ui-components.css draws each as .ask-body[data-tier]. */
export const DIALOG_TIERS = Object.freeze({ S: 340, text: 380, M: 520, L: 600 });
/** A confirm label that answers nothing: drawn as the one, quiet, act of a notice, never as an accent primary. */
const ACKNOWLEDGE = /^(?:Close|OK|Ok|Got it|Done)$/;

let footSerial = 0;
/**
 * The foot of a dialog: Cancel (when it has one) and the confirming action, as a foot bar that never wraps (the labels leave, then the two stack).
 * `[data-no]` and `[type=submit]` are the hooks the dialogs wire. `danger` makes the confirm a destructive primary; a confirm that only acknowledges
 * (Close, OK, Got it) is the foot's one quiet act, with no Cancel.
 */
function foot(label, { confirm, cancel = 'Cancel', danger = false, start = null, disabled = false } = {}) {
  const id = `ask-foot-${++footSerial}`;
  const ack = !danger && ACKNOWLEDGE.test(String(confirm));
  return dialogFoot({ label: String(label || 'Dialog'), id, cls: 'ui-dialog-foot ask-foot',
    ...(start ? { start: { id: `${id}-${start.id}`, label: start.label, role: start.danger ? 'destructive' : 'secondary', keep: true, attrs: { 'data-start': start.id } } } : {}),
    actions: [
      ...(cancel && !ack ? [{ id: `${id}-no`, label: cancel, keep: true, attrs: { 'data-no': true } }] : []),
      ...(confirm != null ? [{ id: `${id}-ok`, label: confirm, role: ack ? 'secondary' : 'primary', type: 'submit', danger, ...(ack ? { keep: true } : {}), ...(disabled ? { disabled: true } : {}) }] : []),
    ] });
}

/** Focus: the first field, else the primary, else Cancel when the primary is destructive. */
function focusFirst(d, danger) {
  const field = [...d.querySelectorAll('.ask-body input, .ask-body select, .ask-body textarea')]
    .find(e => e.type !== 'hidden' && !e.disabled && !e.closest('.ask-foot,[hidden]'));
  const target = field || (danger ? d.querySelector('[data-no]') : null) || d.querySelector('[type=submit]') || d.querySelector('[data-no]');
  target?.focus();
  if (field && field.type !== 'checkbox' && field.type !== 'radio') field.select?.();
}

/** Opens a <dialog> holding `body`; `id` is its registry entry (data-dialog). A view uses a builder below, never this (lint T20). Escape and the scrim give null. */
function open(body, onMount, { id = '' } = {}) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    if (id) d.setAttribute('data-dialog', id);
    d.innerHTML = body;
    document.body.append(d);
    const heading = d.querySelector('.ask-title') || d.querySelector('.ui-bar-title') || d.querySelector('.ask-head');
    if (heading) { heading.id ||= `ask-title-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; d.setAttribute('aria-labelledby', heading.id); }
    else d.setAttribute('aria-label', 'Dialog');
    const previousFocus = document.activeElement;
    let done = false;
    const close = v => { if (done) return; done = true; resolve(v); d.close(); d.remove(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
    d.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    d.addEventListener('mousedown', e => { if (e.target === d) close(null); });
    onMount(d, close);
    d.showModal();
  });
}

/** The frame of the recipe: tier, title, detail, body, foot. */
const frame = ({ tier, title, detail = '', body = '', foot: f, cls = '' }) =>
  `<form method="dialog" class="ask-body${cls ? ` ${cls}` : ''}" data-tier="${tier}">
     <div class="ask-head">${esc(title)}</div>
     ${detail ? `<div class="ask-detail">${esc(detail)}</div>` : ''}
     ${body}
     ${f}
   </form>`;

/** The named values of a form: a checkbox is its checked state, a radio group the value of its checked radio. */
export function formValues(form) {
  const out = {};
  for (const e of form.elements || []) {
    if (!e.name || e.disabled) continue;
    if (e.type === 'checkbox') out[e.name] = !!e.checked;
    else if (e.type === 'radio') { if (e.checked) out[e.name] = e.value; }
    else out[e.name] = e.value;
  }
  return out;
}

/**
 * A dialog on the recipe, for a create or edit with two or three fields (DIALOGS §3). `id` is its entry in dialogs.json; `body` is
 * a stack of formField() (and at most one data-ui-help line); `start` is one other act ({ id, label, danger }) in the foot's start
 * slot. Resolves to `submit(form, dialog)` (by default the form's named values; return undefined to keep the dialog open while a
 * field is corrected), to `{ act }` when the start act is pressed and `onAct` does not return true, or to null when cancelled.
 */
export function formDialog({ id, title, detail = '', tier = 'M', body = '', confirm = 'Save', danger = false, cancel = 'Cancel', start = null, onMount = null, onAct = null, submit = null }) {
  if (!DIALOG_TIERS[tier]) throw Error(`formDialog '${id}': tier is one of ${Object.keys(DIALOG_TIERS).join(', ')}`);
  if (ACKNOWLEDGE.test(String(confirm)) && !danger) throw Error(`formDialog '${id}': '${confirm}' confirms nothing. A result is a notice on the page, not a dialog`);
  return open(frame({ tier, title, detail, body, foot: foot(title, { confirm, cancel, danger, start }) }), (d, close) => {
    const form = d.querySelector('form');
    d.querySelector('[data-no]').onclick = () => close(null);
    const s = d.querySelector('[data-start]');
    if (s) s.onclick = async e => { e.preventDefault(); if (onAct && await onAct(start.id, d, close) === true) return; close({ act: start.id }); };
    form.onsubmit = async e => {
      e.preventDefault();
      const v = submit ? await submit(form, d) : formValues(form);
      if (v !== undefined) close(v);
    };
    onMount?.(d, close);
    queueMicrotask(() => focusFirst(d, danger));
  }, { id });
}

/**
 * The rows of a picker's list, from the shared list and row builders: `items` are `{ value, title, detail? }`, the chosen one is pressed.
 * A row's title is its one button (`data-pick="<value>"`); the caller binds the buttons and moves `aria-pressed`.
 */
export const pickerRows = (items, { id, label, selected = null, empty = '' } = {}) => items.length
  ? uiList({ id, label, attrs: { 'data-picker': '' }, rows: items.map(it => uiRow({
    main: { html: `<button type="button" class="tk-text" data-pick="${esc(it.value)}" aria-pressed="${String(it.value) === String(selected)}">${esc(it.title)}</button>`, detail: it.detail ? [esc(it.detail)] : [] } })) })
  : empty;

/**
 * Choose one item from a searchable list (DIALOGS §3, tier L). The recipe draws the frame: the title alone in the head, a search field, the
 * caller's `body` (its own rows above the list: a status line, a field), the scrolling list `.ask-picker-list` the caller fills, and a foot
 * of Cancel with, when the choice is confirmed and not made by pressing a row, one primary (`confirm`, drawn disabled while `confirmDisabled`).
 * `start` is one other act ({ id, label }) in the foot's start slot: the caller binds `[data-start]` in `onMount(dialog, close)`, since it
 * may open a field and not close. Resolves to what `close(value)` is given, or null when cancelled. Enter in the search field never submits.
 */
export function pickerDialog({ id, title, detail = '', search = 'Search', placeholder = '', body = '', confirm = null, confirmDisabled = false, cancel = 'Cancel', start = null, onMount = null }) {
  return open(frame({ tier: 'L', title, detail, cls: 'ask-picker', foot: foot(title, { confirm, cancel, start, disabled: confirmDisabled }),
    body: `<label class="search-field">${icon('search', { size: 16 })}<input type="search" name="q" aria-label="${esc(search)}" placeholder="${esc(placeholder || search)}" autocomplete="off" spellcheck="false"></label>${body}<div class="ask-scroll ask-picker-list"></div>` }), (d, close) => {
    d.querySelector('form').onsubmit = e => e.preventDefault();
    d.querySelector('[data-no]').onclick = () => close(null);
    onMount?.(d, close);
    queueMicrotask(() => d.querySelector('input[type=search]')?.focus());
  }, { id });
}

/**
 * Accept or discard a computed plan: an import map, a rename list, a write plan (DIALOGS §3, tier M). `body` is one table
 * (.ask-table or tableRegion()); it scrolls inside the body while the head and foot stay. Resolves true, false, or `{ act }`.
 */
export async function planDialog({ id, title, detail = '', body = '', confirm, danger = false, cancel = 'Cancel', start = null, onMount = null, onAct = null }) {
  const v = await formDialog({ id, title, detail, tier: 'M', body: `<div class="ask-scroll">${body}</div>`, confirm, danger, cancel, start, onMount, onAct, submit: () => true });
  return v === true ? true : v && v.act ? v : false;
}

// Single-line input. `value` prefills for a rename.
export function ask(title, { value = '', placeholder = '', confirm = 'Save' } = {}) {
  return open(frame({ tier: 'S', title,
    body: `<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" spellcheck="false">`,
    foot: foot(title, { confirm }) }),
    (d, close) => {
      const input = d.querySelector('input');
      d.querySelector('[data-no]').onclick = () => close(null);
      d.querySelector('form').onsubmit = e => { e.preventDefault(); close(input.value); };
      queueMicrotask(() => { input.focus(); input.select(); });
    }, { id: 'ask' });
}

// Yes/no; `danger` marks the confirm as destructive (in the desktop app a native alert sheet, else this dialog). A confirm of Close, OK or Got it is a
// notice: one quiet act and no Cancel (lint T20 read-only-dialog counts those: a result belongs on the page, as a status or a uiNotice).
export async function confirmAsk(title, { detail = '', confirm = 'Confirm', danger = false } = {}) {
  if (danger && inDesktop()) { try { return await confirmSheet(title, detail, confirm); } catch { /* the page's own dialog */ } }
  return open(frame({ tier: 'S', title, detail, foot: foot(title, { confirm, danger }) }),
    (d, close) => {
      const no = d.querySelector('[data-no]');
      if (no) no.onclick = () => close(false);
      d.querySelector('form').onsubmit = e => { e.preventDefault(); close(true); };
      queueMicrotask(() => ((danger && no) || d.querySelector('[type=submit]')).focus());
    }, { id: 'confirm' });
}

/**
 * A question with more than two answers (unsaved edits: Save, Don't save, Cancel). `choices` are { id, label, role }: 'primary' (Enter takes it; at most
 * one), 'destructive' (the foot's start slot, never the default) or 'secondary'. Cancel, Esc and a press outside resolve to null; any other button to its
 * id. Focus lands on the primary, else Cancel. It is the page's own dialog, not the native two-button sheet.
 */
let choiceSerial = 0;
export function choiceAsk(title, { detail = '', choices = [], cancel = 'Cancel' } = {}) {
  const id = `choice-${++choiceSerial}`;
  const list = choices.filter(c => c && c.id && c.label);
  const primary = list.find(c => c.role === 'primary') || null;
  const start = list.filter(c => c.role === 'destructive'), rest = list.filter(c => c.role !== 'destructive' && c !== primary);
  const act = (c, role) => ({ id: `${id}-${c.id}`, label: c.label, role, keep: true, attrs: { 'data-choice': c.id }, ...(c === primary ? { type: 'submit' } : {}) });
  const bar = dialogFoot({ label: String(title || 'Dialog'), id: `${id}-foot`, cls: 'ui-dialog-foot ask-foot',
    ...(start.length ? { start: start.map(c => act(c, 'destructive')) } : {}),
    actions: [{ id: `${id}-no`, label: cancel, keep: true, attrs: { 'data-no': true } }, ...rest.map(c => act(c, 'secondary')), ...(primary ? [act(primary, 'primary')] : [])] });
  return open(frame({ tier: 'S', title, detail, foot: bar }),
    (d, close) => {
      d.querySelector('[data-no]').onclick = () => close(null);
      for (const b of d.querySelectorAll('[data-choice]')) b.onclick = e => { e.preventDefault(); close(b.dataset.choice); };
      d.querySelector('form').onsubmit = e => { e.preventDefault(); close(primary ? primary.id : null); };
      queueMicrotask(() => (d.querySelector('[type=submit]') || d.querySelector('[data-no]')).focus());
    }, { id: 'choice' });
}

/** A multi-line question: pasted text, a note. Resolves to the text, or null. */
export function askText(title, { value = '', placeholder = '', confirm = 'Save' } = {}) {
  return open(frame({ tier: 'text', title, cls: 'ask-text-form',
    body: `<textarea class="ask-text" rows="4" aria-label="${esc(title)}" placeholder="${esc(placeholder)}" spellcheck="false">${esc(value)}</textarea>`,
    foot: foot(title, { confirm }) }),
    (d, close) => {
      const ta = d.querySelector('textarea'); ta.focus();
      const no = d.querySelector('[data-no]');
      if (no) no.onclick = () => close(null);
      d.querySelector('form').onsubmit = e => { e.preventDefault(); close(ta.value); };
    }, { id: 'ask-text' });
}


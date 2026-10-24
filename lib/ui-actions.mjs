// Builders for every row of controls, list row, review item and notice (action-system design, sections 2, 3, 6, 8, 9, 11, 12, 14).
//
// Placement is a property of the shared component. A view declares what a control IS (a role, a label, an icon);
// the builder owns the slot order, the markup and the hooks, and ui-actions.css owns where things go. Nothing here
// positions a control, and nothing a view writes can: attrs and cls pass legacy hooks through, style is refused.
//
//   uiBar({kind:'head'|'tools'|'foot'|'strip', ...})   any row of controls
//   uiGroup, uiSwap                                    one unit of several controls; alternatives in one measured slot
//   uiRegion                                           bars that replace each other in one grid cell
//   uiList, uiRow, uiRowEnd                            list rows with one decided shape
//   uiReview, uiReviewList, uiDecisionRow, uiBatchReview   reviewed changes
//   uiNotice, uiSummary, reviewSummary                 one call to action
//   uiStatusLine, uiStatusBar, uiSettingsRow, uiComposer
//   uiDocTabs, fitDocTabs                              a strip of open documents (not a bar): full, compact or a picker
//   dialogFoot, inspectorActions, barEl
//
// Builders return strings (uiGroup and uiSwap return a descriptor that renders as a string when interpolated).
// Every interpolated value is escaped; type="button" is the default. A bad spec throws BarSpecError under Node
// (every npm test file) and when globalThis.__LYKOS_DEV__ exists (the dev server and the sweep injects it); in the
// shipped app nothing throws: the builder applies the fix its message names and logs one warning.
//
// ---------------------------------------------------------------------------------------------
// THE DOM CONTRACT WITH THE ENGINE (bar-fit.mjs reads this; it writes only the attributes listed under "engine")
//
//   bar      .ui-bar[data-ui-bar=head|tools|foot|strip]  role group|toolbar  aria-label
//            optional: data-ui-density=dense (small text, not a height), data-ui-form (a form bar: the field height), data-ui-float=corner|popover, data-ui-reveal=hover, data-ui-equal,
//            data-ui-align=center, data-ui-nostack (no stacked rung), data-ui-budget=n (a declared budget: the sweep's crowded-units audit allows n units), data-ui-bar-skip=reason (the engine leaves it alone)
//   slots    direct children [data-ui-slot=lead|message|status|view|filters|start|actions]
//   items    direct children of the actions slot (and of the lead slot for a back button, of start for a foot act):
//              [data-ui-kind=act|group|picker|field|check|swap] [data-ui-role=primary|secondary|quiet|destructive]
//              [data-ui-fold=0..9] [data-ui-keep] [data-ui-presence=reserve] [data-ui-end] id
//            an act's label is .ui-act-label, its icon is an svg.ico; with both, the label can leave (label step)
//            a group's members are buttons with [data-ui-member]; a swap holds its alternatives and one .ui-swap-sizer
//   views    .ui-view (data-ui-kind=view) > .ui-view-set (the segmented or tab buttons) + .ui-view-pick (the dropdown form)
//   filters  direct children of the filters slot, [data-ui-kind=search|select|date|field|check]
//   more     [data-ui-more] last visible control of the actions slot; overflow entries [data-ui-overflow] follow it, hidden
//   engine   writes data-ui-bar-mode, data-ui-label-off, data-ui-folded, data-ui-as, data-ui-cols, data-ui-empty, data-ui-active
//            on lists also --ui-cmin-N (the narrowest a visual column may take) and --ui-check-pad (where narrow cells start), as custom properties
//   width    a box that must hear its own width carries [data-ui-width] (watchWidth below) and receives a `ui-width` event
//
// Foot bars: a start act is the model's lead slot item and a start message is its message region (barSpecOf).
// ---------------------------------------------------------------------------------------------
import { esc, plainText } from './html.mjs';
import { icon, ICON_PATHS } from './icons.mjs';
import { dateField } from './date-picker.mjs';
import { recordPicker } from './record-picker.mjs';
import { BAR_KINDS, FOLD_DEFAULT, orderItems, validateBarSpec, tabsMode } from './bar-modes.mjs';

// ---- constants ------------------------------------------------------------------------------------------------

/** Author-time budget: declared units (acts, joined groups, pickers, swaps, views) outside overflow. A bar may exceed it with budget:{n, reason}. */
export const BUDGET = Object.freeze({ head: 4, tools: 4, foot: 4, strip: 3 });
/** Decision D3 (spec 15): true marks every select filter foldable into More instead of stacking it. */
export const FOLD_FILTERS = false;
/** Decision D1 (spec 15): the emphasis of a summary action. 'secondary' is neutral; 'primary' is the accent. */
export const SUMMARY_ACTION_ROLE = 'secondary';
/** Character widths a fixed text slot may reserve (data-ui-ch). ui-actions.css has one rule per value. */
export const CH_STEPS = Object.freeze([3, 4, 6, 8, 12, 14, 16, 18, 20, 24]);
/** Every data-ui name a builder may emit. Nothing outside the builders, the engine, the adapter and the contract CSS writes one (test: ui-actions-contract). */
export const UI_ATTRS = Object.freeze(['data-ui-bar', 'data-ui-box', 'data-ui-bar-mode', 'data-ui-bar-skip', 'data-ui-role', 'data-ui-fold', 'data-ui-keep', 'data-ui-slot',
  'data-ui-end', 'data-ui-tail', 'data-ui-folded', 'data-ui-label-off', 'data-ui-more', 'data-ui-overflow', 'data-ui-presence', 'data-ui-as', 'data-ui-cols', 'data-ui-ncols',
  'data-ui-depth', 'data-ui-mode', 'data-ui-measure', 'data-ui-reveal', 'data-ui-alt', 'data-ui-alt-b', 'data-ui-digits', 'data-ui-density', 'data-ui-form', 'data-ui-float', 'data-ui-kind', 'data-ui-equal', 'data-ui-align',
  'data-ui-nostack', 'data-ui-member', 'data-ui-display', 'data-ui-ch', 'data-ui-reserve', 'data-ui-w', 'data-ui-empty', 'data-ui-active', 'data-ui-options', 'data-ui-message', 'data-ui-status', 'data-ui-status-after',
  'data-ui-col', 'data-ui-cell', 'data-ui-inactive', 'data-ui-part', 'data-ui-drop', 'data-ui-fixed', 'data-ui-danger', 'data-ui-pending',
  'data-ui-region', 'data-ui-pane', 'data-ui-statusline', 'data-ui-trail', 'data-ui-item', 'data-ui-bar-force', 'data-ui-wrap', 'data-ui-line', 'data-ui-width', 'data-ui-text', 'data-ui-grow', 'data-ui-reserved', 'data-ui-plain', 'data-ui-tabs', 'data-ui-preview', 'data-ui-dirty', 'data-ui-focused', 'data-ui-pinned', 'data-ui-budget', 'data-ui-switch-end', 'data-ui-reserve-more', 'data-ui-switch-short', 'data-ui-plain-more']);

const BAR_KEYS = ['kind', 'label', 'id', 'cls', 'attrs', 'equal', 'align', 'density', 'form', 'reveal', 'float', 'budget', 'stack', 'start', 'lead', 'message', 'status',
  'view', 'filters', 'actions', 'overflow', 'hiddenFields', 'switchAt', 'moreReserve', 'plainMore', 'moreBeforeTail'];
const ACT_KEYS = ['id', 'label', 'icon', 'role', 'fold', 'keep', 'pressed', 'disabled', 'hidden', 'presence', 'menu', 'labelCh', 'labels', 'dynamic', 'kbd', 'iconOnly', 'danger', 'plain', 'trail', 'attrs', 'cls', 'type'];
const ROLE_KEYS = ['primary', 'secondary', 'quiet', 'destructive'];
const FILTER_TYPES = ['search', 'select', 'date', 'field', 'check', 'record'];
const ID = /^[A-Za-z][\w:.-]*$/;
const ATTR_NAME = /^[a-z][a-z0-9:_.-]*$/i;
const CLS = /^[A-Za-z_][\w-]*(?:\s+[A-Za-z_][\w-]*)*$/;

// ---- runtime: strict under Node and the dev server, degrading in the shipped app ---------------------------------

export class BarSpecError extends Error {
  constructor(message, problems = []) { super(message); this.name = 'BarSpecError'; this.problems = problems; }
}
/** Node (every npm test file, including the ones that install a fixture document) or the dev flag. A test may not rely on `typeof document`. */
export const isStrict = () => (typeof process !== 'undefined' && !!process.versions?.node) || !!globalThis.__LYKOS_DEV__;

function checker(who, hint) {
  const problems = [], strict = isStrict();
  return {
    problems,
    report(msg) {
      problems.push(msg);
      if (!strict && typeof console !== 'undefined') console.warn(`${who}: ${msg}`);
    },
    done() {
      if (strict && problems.length) throw new BarSpecError(`${who}: ${problems.join('; ')}.${hint ? ` Recipe: lib/ui-recipes.mjs ${hint}` : ''}`, problems);
    },
  };
}

// The seam for the ids-never-reach-text funnel (spec 9.2): lib/visible-text.mjs installs humanizeRefs here. Until then text passes unchanged.
let humanizer = s => s;
export function setHumanizer(fn) { humanizer = typeof fn === 'function' ? fn : s => s; }
const human = s => humanizer(String(s ?? ''));

// ---- small helpers ----------------------------------------------------------------------------------------------

const slug = s => String(s || 'bar').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bar';
const chStep = n => CH_STEPS.find(c => c >= n) ?? CH_STEPS.at(-1);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Legacy hooks: data-*, aria-* and plain names pass through; style, on* and data-ui-* are refused. */
function attrsOf(attrs, cx, who) {
  let out = '';
  for (const [k, v] of Object.entries(attrs || {})) {
    if (!ATTR_NAME.test(k)) { cx.report(`${who}: attribute name '${k}' is not valid`); continue; }
    if (/^on/i.test(k) || k === 'style' || k === 'class' || k === 'id' || /^data-ui-/.test(k)) {
      cx.report(`${who}: attrs may not set '${k}'. ${k === 'style' ? 'Placement is a role: declare it, do not style it' : k === 'class' ? 'Use cls' : k === 'id' ? 'Use id' : /^data-ui-/.test(k) ? 'data-ui-* belongs to the engine' : 'Handlers are wired by the view'}`);
      continue;
    }
    if (v === false || v == null) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return out;
}
function clsOf(cls, cx, who) {
  if (!cls) return '';
  if (!CLS.test(String(cls))) { cx.report(`${who}: cls '${cls}' is not a list of class names`); return ''; }
  if (/(^|\s)spacer(\s|$)/.test(cls)) { cx.report(`${who}: a spacer is not a layout tool. Declare roles; the builder places the end cluster`); return String(cls).split(/\s+/).filter(c => c !== 'spacer').join(' '); }
  return String(cls);
}
const knownKeys = (o, allowed, who, cx) => { for (const k of Object.keys(o || {})) if (!allowed.includes(k)) cx.report(`${who}: unknown key '${k}' (allowed: ${allowed.join(', ')})`); };
const svg = (name, cx, who, size) => {
  if (!own(ICON_PATHS, name)) { cx.report(`${who}: unknown icon '${name}'. Register it in lib/icons.mjs or pick an existing one`); return ''; }
  return icon(name, size ? { size } : undefined);
};
const idOk = (id, cx, who) => { if (typeof id !== 'string' || !ID.test(id)) { cx.report(`${who}: needs an id (letters, digits, - _ : .)`); return false; } return true; };
const tip = (label, kbd) => kbd ? `${label} (${kbd})` : label;

// ---- acts, groups, pickers, fields, swaps -----------------------------------------------------------------------------

function resolveFold(it) { return it.fold ?? (it.slot === 'lead' ? FOLD_DEFAULT.lead : it.kind === 'act' ? FOLD_DEFAULT[it.role] : FOLD_DEFAULT[it.kind]); }
function resolveKeep(it, bar) { return !!(it.keep ?? (it.slot === 'lead' || bar.equal || it.role === 'primary' || it.kind === 'field' || it.kind === 'swap')); }

/** Normalises one ActSpec. `ctx` = { bar, where: 'actions'|'start'|'lead'|'member'|'swap', cx }. Returns null when it cannot be rendered. */
function normAct(a, ctx) {
  const { cx, bar } = ctx, who = `act '${a?.id ?? '?'}'`;
  if (!a || typeof a !== 'object' || Array.isArray(a)) { cx.report('an action is not an object'); return null; }
  knownKeys(a, ACT_KEYS, who, cx);
  const id = a.id; idOk(id, cx, who);
  if (typeof a.label !== 'string' || !a.label.trim()) { cx.report(`${who}: needs a label (it becomes the accessible name and the tooltip)`); }
  let role = a.role ?? (ctx.where === 'member' ? ctx.role : 'secondary');
  if (!ROLE_KEYS.includes(role)) { cx.report(`${who}: role '${role}' is not one of ${ROLE_KEYS.join(', ')}`); role = 'secondary'; }
  const stripAct = bar.kind === 'strip' && ctx.where === 'actions';
  const act = { t: 'act', id, label: String(a.label ?? id ?? ''), icon: a.icon || '', role, fold: a.fold, keep: a.keep, pressed: a.pressed, disabled: !!a.disabled,
    hidden: !!a.hidden, presence: a.presence || 'always', menu: !!a.menu, labelCh: a.labelCh, labels: Array.isArray(a.labels) ? [...new Set(a.labels.map(String))] : null, kbd: a.kbd, danger: !!a.danger, plain: !!a.plain, attrs: a.attrs, cls: a.cls, type: a.type || 'button', slot: ctx.where === 'lead' || ctx.where === 'start' ? 'lead' : undefined, trail: !!a.trail && ctx.where === 'actions' };
  if (a.icon && !own(ICON_PATHS, a.icon)) { cx.report(`${who}: unknown icon '${a.icon}'. Register it in lib/icons.mjs or pick an existing one`); act.icon = ''; }
  if (act.presence !== 'always' && act.presence !== 'reserve') { cx.report(`${who}: presence must be 'always' or 'reserve'`); act.presence = 'always'; }
  if (a.dynamic && a.labelCh == null && !a.labels) cx.report(`${who}: a label that changes needs labels (every label it shows: its slot is as wide as the widest), labelCh (a width in characters, for a number), or a constant label and aria-pressed`);
  if (act.labels && (!act.labels.includes(act.label) || act.labels.length < 2 || act.labels.length > 3)) cx.report(`${who}: labels lists the 2 or 3 labels the act shows, its label among them`);
  if (act.labels && a.labelCh != null) cx.report(`${who}: labels sizes the label; labelCh is for a label that is a number`);
  if (a.labelCh != null && !CH_STEPS.includes(a.labelCh)) { cx.report(`${who}: labelCh ${a.labelCh} is not one of ${CH_STEPS.join(', ')}`); act.labelCh = chStep(a.labelCh); }
  if (a.danger && role !== 'primary') { cx.report(`${who}: danger is for the one primary of a confirm dialog`); act.danger = false; }
  if (a.trail && (role === 'primary' || ctx.where !== 'actions')) { cx.report(`${who}: trail (the bar's own end group, after every role: the title bar's panel toggles) is for a quiet or secondary act of the actions`); act.trail = false; }
  if (a.plain && role !== 'quiet') { cx.report(`${who}: plain (no fill until pointed at or pressed) is for a quiet act, such as a toggle on a list`); act.plain = false; }
  if (!['button', 'submit'].includes(act.type)) { cx.report(`${who}: type is 'button' or 'submit'`); act.type = 'button'; }
  if (act.presence === 'reserve') {
    if (role === 'primary') { cx.report(`${who}: a primary cannot be reserved. Put Run and Stop in one uiSwap`); }
    if (!act.icon) cx.report(`${who}: a reserved item is icon-only: give it an icon`);
  }
  const conditional = act.hidden && ctx.where !== 'swap' && act.presence !== 'reserve';
  if (conditional) cx.report(`${who}: an item that appears or disappears must be a uiSwap member, presence:'reserve' or an overflow entry. Pressing it must not move another control`);
  if (stripAct) {
    if (!act.icon && !act.menu) cx.report(`${who}: strip acts are icon-only, groups, pickers, menu acts, selects or fields. Give it an icon, or use a tools bar`);
    act.iconOnly = !!act.icon && !act.menu;
  }
  if (a.iconOnly && act.icon && !act.menu && ctx.where !== 'member') act.iconOnly = true;   // an icon-only act of a tools bar whose tooltip names it (the find bar's Match case and Close)
  if (ctx.where === 'member') act.iconOnly = ctx.display === 'icon';
  if (act.presence === 'reserve') act.iconOnly = true;
  if (ctx.where === 'member' && ctx.display === 'icon' && !act.icon) cx.report(`${who}: a member of an icon group needs an icon (or use display:'text')`);
  return act;
}

function actInner(a, cx, who) {
  const ico = a.icon ? svg(a.icon, cx, who) : '';
  const chev = a.menu ? icon('chevron-down', { size: 12 }) : '';
  if (a.iconOnly) return ico + chev;
  const ch = a.labelCh != null && !a.labels ? ` data-ui-ch="${a.labelCh}"` : '';
  // labels: the slot is exactly as wide as the widest label the act shows, in its own font (the others are drawn hidden, ui-actions.css), so a swap moves nothing and leaves no slack
  const alts = (a.labels || []).filter(l => l !== a.label).slice(0, 2).map((l, i) => ` data-ui-alt${i ? '-b' : ''}="${esc(l)}"`).join('');
  return `${ico}<span class="ui-act-label"${ch}${alts}>${esc(a.label)}</span>${chev}`;
}

/** The button element of an act. `top` carries the item attributes (kind, fold, keep, end); members carry only their role. */
function actHtml(a, o, cx) {
  const { bar } = o, who = `act '${a.id}'`;
  const reserved = o.top && a.presence === 'reserve';
  const classes = ['ui-act', a.role === 'primary' ? 'primary' : '', a.menu && a.icon ? 'ui-act-menu' : '', a.danger ? 'danger' : '', a.cls ? clsOf(a.cls, cx, who) : ''].filter(Boolean).join(' ');   // ui-act-menu: an icon and a chevron (its icon-only form is wider than a square)
  const at = [`type="${a.type}"`, `id="${esc(a.id)}"`, `class="${esc(classes)}"`, `data-ui-role="${a.role}"`];
  const item = [`data-ui-kind="act"`, `data-ui-role="${a.role}"`, `data-ui-fold="${resolveFold({ ...a, kind: 'act' })}"`];
  if (resolveKeep({ ...a, kind: 'act' }, bar)) item.push('data-ui-keep');
  if (o.end) item.push('data-ui-end');
  if (a.trail) item.push('data-ui-tail');
  if (o.member || reserved) at.push('data-ui-member');
  if (o.top && !reserved) at.push(...item.filter(x => !x.startsWith('data-ui-role')));
  if (a.iconOnly) at.push('data-ui-display="icon"');
  if (a.danger) at.push('data-ui-danger');
  if (a.plain) at.push('data-ui-plain');
  if (!(a.attrs && own(a.attrs, 'aria-label'))) at.push(`aria-label="${esc(a.label)}"`);
  at.push(`title="${esc(tip(a.label, a.kbd))}"`);
  if (a.menu) at.push('aria-haspopup="menu"', 'aria-expanded="false"');
  if (typeof a.pressed === 'boolean') at.push(`aria-pressed="${a.pressed}"`);
  if (a.disabled) at.push('disabled');
  if (a.hidden) at.push('hidden');
  const button = `<button ${at.join(' ')}${attrsOf(a.attrs, cx, who)}>${actInner(a, cx, who)}</button>`;
  // A reserved item keeps its slot when its button is hidden: a global [hidden] rule would otherwise take the slot with it.
  return reserved ? `<span class="ui-reserve" data-ui-item="${esc(a.id)}" data-ui-presence="reserve" ${item.join(' ')}>${button}</span>` : button;
}

/** uiGroup / uiSwap are descriptors: usable inside `actions` and, interpolated, as a string. */
function descriptor(type, spec, render) {
  const d = { __ui: type, spec, toString() { return render(d.spec); } };
  return Object.freeze(d);
}
const isDesc = (x, type) => !!x && typeof x === 'object' && x.__ui === type;

export function uiGroup(spec) {
  const d = descriptor('group', spec, s => {
    const cx = checker(`uiGroup() '${s?.id}'`, 'strip'), bar = { kind: 'tools' };
    const g = normGroup(s, { bar, cx });
    const html = g ? groupHtml(g, { bar, top: true }, cx) : '';
    cx.done(); return html;
  });
  return d;
}
export function uiSwap(spec) {
  return descriptor('swap', spec, s => {
    const cx = checker(`uiSwap() '${s?.id}'`, 'flowHeader'), bar = { kind: 'head' };
    const w = normSwap(s, { bar, cx });
    const html = w ? swapHtml(w, { bar, top: true }, cx) : '';
    cx.done(); return html;
  });
}

function normGroup(g, ctx) {
  const { cx } = ctx, who = `group '${g?.id ?? '?'}'`;
  knownKeys(g, ['id', 'label', 'display', 'items', 'role', 'fold', 'keep', 'attrs', 'cls'], who, cx);
  idOk(g.id, cx, who);
  if (!g.label) cx.report(`${who}: needs a label (the group's accessible name)`);
  const display = g.display ?? 'icon';
  if (!['icon', 'text'].includes(display)) cx.report(`${who}: display is 'icon' or 'text'`);
  const items = Array.isArray(g.items) ? g.items : [];
  if (items.length < 2 || items.length > 6) cx.report(`${who}: a group joins 2 to 6 members (got ${items.length}). A single control is an act`);
  const role = g.role ?? 'quiet';
  if (!['secondary', 'quiet'].includes(role)) cx.report(`${who}: a group is secondary or quiet`);
  const members = items.map(m => {
    if (m && own(m, 'readout')) {
      knownKeys(m, ['readout', 'id', 'label', 'ch'], `readout '${m.id ?? '?'}'`, cx);
      const text = String(m.readout ?? '');
      if (m.ch != null && !CH_STEPS.includes(m.ch)) cx.report(`readout '${m.id ?? '?'}': ch ${m.ch} is not one of ${CH_STEPS.join(', ')}`);
      if (m.ch != null && text.length > m.ch) cx.report(`readout '${m.id ?? '?'}': '${text}' is ${text.length} characters, over its ${m.ch}ch slot. Raise ch or shorten the text`);
      return { t: 'readout', id: m.id, text, label: m.label, ch: m.ch != null && CH_STEPS.includes(m.ch) ? m.ch : undefined };
    }
    if (m && own(m, 'field')) return { t: 'field', ...m.field };
    return normAct(m, { ...ctx, where: 'member', role, display });
  }).filter(Boolean);
  return { t: 'group', id: g.id, label: g.label, display, role: role === 'quiet' ? 'quiet' : 'secondary', fold: g.fold, keep: g.keep, attrs: g.attrs, cls: g.cls, members };
}

const FIELD_TYPES = ['text', 'number', 'password', 'email', 'url'];
function fieldHtml(f, cx, extra = '') {
  const who = `field '${f?.id ?? '?'}'`;
  idOk(f.id, cx, who);
  if (!f.label) cx.report(`${who}: needs a label (its accessible name)`);
  const w = f.width && typeof f.width === 'object' ? (f.width.ch <= 8 ? 'sm' : f.width.ch <= 14 ? 'md' : 'lg') : (f.width || 'md');
  if (!['sm', 'md', 'lg', 'flex'].includes(w)) cx.report(`${who}: width is sm, md, lg, flex or {ch}`);
  const type = f.type || 'text';
  if (!FIELD_TYPES.includes(type)) cx.report(`${who}: type is ${FIELD_TYPES.join(', ')}`);
  const secret = type === 'password' ? ' autocomplete="off" spellcheck="false"' : '';
  return `<input type="${type}" id="${esc(f.id)}" class="ui-bar-field" data-ui-w="${w}" aria-label="${esc(f.label)}"${secret}"${f.value != null ? ` value="${esc(f.value)}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.maxlength ? ` maxlength="${Number(f.maxlength)}"` : ''}${attrsOf(f.attrs, cx, who)}${extra}>`;
}

function groupHtml(g, o, cx) {
  const { bar } = o;
  const at = [`id="${esc(g.id)}"`, `class="ui-group${g.cls ? ' ' + esc(clsOf(g.cls, cx, `group '${g.id}'`)) : ''}"`, 'role="group"', `aria-label="${esc(g.label)}"`, `data-ui-display="${g.display}"`, `data-ui-role="${g.role}"`];
  if (o.top) {
    at.push('data-ui-kind="group"', `data-ui-fold="${resolveFold({ ...g, kind: 'group' })}"`);
    if (resolveKeep({ ...g, kind: 'group' }, bar)) at.push('data-ui-keep');
  }
  const inner = g.members.map(m => m.t === 'readout' ? `<span class="ui-readout"${m.id ? ` id="${esc(m.id)}"` : ''} role="status"${m.label ? ` aria-label="${esc(m.label)}"` : ''}${m.ch != null ? ` data-ui-ch="${m.ch}"` : ''}>${esc(m.text)}</span>`
    : m.t === 'field' ? fieldHtml(m, cx) : actHtml(m, { bar, member: true }, cx)).join('');
  return `<span ${at.join(' ')}${attrsOf(g.attrs, cx, `group '${g.id}'`)}>${inner}</span>`;
}

function normSwap(s, ctx) {
  const { cx } = ctx, who = `swap '${s?.id ?? '?'}'`;
  knownKeys(s, ['id', 'members', 'attrs', 'cls'], who, cx);
  idOk(s.id, cx, who);
  const raw = Array.isArray(s.members) ? s.members : [];
  if (raw.length < 2) cx.report(`${who}: a swap holds 2 or more alternatives (Run | Stop). A lone control that appears is presence:'reserve'`);
  const members = raw.map(m => normAct(m, { ...ctx, where: 'swap' })).filter(Boolean);
  const roles = new Set(members.map(m => m.role));
  if (roles.size > 1) cx.report(`${who}: the members of a swap share one role (got ${[...roles].join(', ')})`);
  const role = members[0]?.role ?? 'secondary';
  if (role === 'quiet' || role === 'destructive') cx.report(`${who}: a swap is secondary or primary`);
  if (members.length && members.every(m => m.hidden)) cx.report(`${who}: one member must be shown`);
  return { t: 'swap', id: s.id, role: role === 'primary' ? 'primary' : 'secondary', members, attrs: s.attrs, cls: s.cls };
}

function swapHtml(w, o, cx) {
  const { bar } = o;
  const at = [`id="${esc(w.id)}"`, `class="ui-swap${w.cls ? ' ' + esc(clsOf(w.cls, cx, `swap '${w.id}'`)) : ''}"`, `data-ui-role="${w.role}"`];
  if (o.top) {
    at.push('data-ui-kind="swap"', `data-ui-fold="${resolveFold({ ...w, kind: 'swap' })}"`);
    if (resolveKeep({ ...w, kind: 'swap' }, bar)) at.push('data-ui-keep');
    if (o.end) at.push('data-ui-end');
  }
  // The inactive member keeps its hidden attribute for the view's handlers. A global [hidden] rule removes it from layout, so the slot is held
  // by one invisible copy of every member's content: the swap is as wide as its widest alternative and pressing Run moves nothing.
  const sizer = w.members.map(m => `<span class="ui-swap-ghost">${actInner({ ...m, iconOnly: false }, cx, `act '${m.id}'`)}</span>`).join('');
  return `<span ${at.join(' ')}${attrsOf(w.attrs, cx, `swap '${w.id}'`)}>${w.members.map(m => actHtml(m, { bar, member: true }, cx)).join('')}<span class="ui-swap-sizer" aria-hidden="true">${sizer}</span></span>`;
}

function normPicker(p, ctx) {
  const { cx } = ctx, who = `picker '${p?.id ?? '?'}'`;
  knownKeys(p, ['picker', 'id', 'label', 'value', 'options', 'menu', 'role', 'fold', 'keep', 'attrs', 'cls', 'icon', 'valueCh', 'steady', 'plain', 'grow'], who, cx);
  if (p.steady && !Array.isArray(p.options)) cx.report(`${who}: steady sizes the picker to its widest option: declare options`);
  if (p.valueCh != null && !CH_STEPS.includes(p.valueCh)) { cx.report(`${who}: valueCh ${p.valueCh} is not one of ${CH_STEPS.join(', ')}`); p = { ...p, valueCh: chStep(p.valueCh) }; }
  idOk(p.id, cx, who);
  if (p.icon && !own(ICON_PATHS, p.icon)) { cx.report(`${who}: unknown icon '${p.icon}'. Register it in lib/icons.mjs or pick an existing one`); p = { ...p, icon: '' }; }
  if (!p.label) cx.report(`${who}: needs a label (what the value is the value of)`);
  const role = p.role ?? 'secondary';
  if (!['secondary', 'quiet'].includes(role)) cx.report(`${who}: a picker is secondary or quiet`);
  // plain: a quiet picker with no fill until pointed at or open (its text and chevron); grow: it takes the width the row has to spare (the chat's name);
  // grow 'cap': it grows up to 280px, room for the longest name it shows, and the row's other controls stay beside it (a row that is a whole page)
  if (p.plain && role !== 'quiet') cx.report(`${who}: plain (no fill until pointed at or open) is for a quiet picker`);
  if (p.grow && p.plain) cx.report(`${who}: a picker that grows is a filled control, not plain`);
  if (p.grow != null && p.grow !== true && p.grow !== false && p.grow !== 'cap') cx.report(`${who}: grow is true or 'cap' (got ${JSON.stringify(p.grow)})`);
  return { t: 'picker', id: p.id, label: p.label, value: String(p.value ?? ''), icon: p.icon || '', options: Array.isArray(p.options) ? p.options : null, role: role === 'quiet' ? 'quiet' : 'secondary', fold: p.fold, keep: p.keep, attrs: p.attrs, cls: p.cls, valueCh: p.valueCh, steady: !!p.steady && Array.isArray(p.options), plain: !!p.plain && role === 'quiet', grow: p.plain || !p.grow ? false : p.grow === 'cap' ? 'cap' : true };
}
function pickerHtml(p, o, cx) {
  const at = [`type="button"`, `id="${esc(p.id)}"`, `class="ui-picker${p.cls ? ' ' + esc(clsOf(p.cls, cx, `picker '${p.id}'`)) : ''}"`, `data-ui-role="${p.role}"`, 'data-ui-kind="picker"', `data-ui-fold="${resolveFold({ ...p, kind: 'picker' })}"`];
  if (resolveKeep({ ...p, kind: 'picker' }, o.bar)) at.push('data-ui-keep');
  if (p.plain) at.push('data-ui-plain');
  if (p.grow) at.push(p.grow === 'cap' ? 'data-ui-grow="cap"' : 'data-ui-grow');
  at.push('aria-haspopup="menu"', 'aria-expanded="false"', `aria-label="${esc(`${p.label}: ${p.value}`)}"`, `title="${esc(p.label)}"`);
  if (p.options) at.push(`data-ui-options="${esc(JSON.stringify(p.options))}"`);
  return `<button ${at.join(' ')}${attrsOf(p.attrs, cx, `picker '${p.id}'`)}>${p.icon ? `<span class="ui-picker-mark" aria-hidden="true">${svg(p.icon, cx, `picker '${p.id}'`)}</span>` : ''}${steadyValue(p)}${icon('chevron-down', { size: 12 })}</button>`;
}
/** The value; a steady picker lays every option's label, unseen, in the value's cell, so it is as wide as its widest choice and choosing moves nothing. */
function steadyValue(p) {
  const value = `<span class="ui-picker-value"${p.valueCh != null ? ` data-ui-ch="${p.valueCh}"` : ''}>${esc(p.value)}</span>`;
  if (!p.steady) return value;
  const label = o => String(Array.isArray(o) ? o[1] ?? o[0] : o);
  return `<span class="ui-picker-steady">${value}${p.options.map(o => `<span class="ui-picker-value" data-pick-sizer aria-hidden="true"${p.valueCh != null ? ` data-ui-ch="${p.valueCh}"` : ''}>${esc(label(o))}</span>`).join('')}</span>`;
}

// ---- views and filters ------------------------------------------------------------------------------------------------

function normView(v, cx, idx) {
  const who = `view '${v?.id ?? '?'}'`;
  knownKeys(v, ['id', 'label', 'attr', 'value', 'kind', 'panelId', 'items', 'itemAttrs', 'cls'], who, cx);
  idOk(v.id, cx, who);
  if (!v.label) cx.report(`${who}: needs a label (the switch's accessible name)`);
  const kind = v.kind ?? 'segmented';
  if (!['segmented', 'tabs'].includes(kind)) cx.report(`${who}: kind is 'segmented' or 'tabs'`);
  if (kind === 'tabs' && !v.panelId) cx.report(`${who}: tabs need panelId (aria-controls)`);
  const items = Array.isArray(v.items) ? v.items : [];
  if (items.length < 2) cx.report(`${who}: a view switch has 2 or more items. One state is not a switch`);
  if (items.length && !items.some(it => it[0] === v.value)) cx.report(`${who}: value '${v.value}' is not one of its items`);
  if (kind === 'segmented' && !v.attr) cx.report(`${who}: needs attr, the data attribute that carries each item's key (for example data-mode)`);
  return { id: v.id, label: v.label, attr: v.attr, value: v.value, kind, panelId: v.panelId, items, itemAttrs: v.itemAttrs, cls: v.cls, n: items.length };
}
function viewHtml(v, cx) {
  const who = `view '${v.id}'`, current = v.items.find(it => it[0] === v.value) || v.items[0] || ['', ''];
  const buttons = v.items.map(([key, label, count]) => {
    const on = key === v.value;
    const extra = v.itemAttrs ? attrsOf(v.itemAttrs(key), cx, who) : '';
    const cnt = count != null ? `<span class="ui-count" data-ui-digits="${Math.min(8, String(count).length + 1)}">${esc(count)}</span>` : '';   // its digits and one more (tabular): a count that grows a digit moves nothing, and a short one leaves 1ch, not a hole
    const inner = `<span>${esc(label)}</span>${cnt}`;
    return v.kind === 'tabs'
      ? `<button type="button" role="tab" id="${esc(v.id)}-${esc(key)}" data-tab="${esc(key)}" aria-controls="${esc(v.panelId)}" aria-selected="${on}" tabindex="${on ? 0 : -1}" class="${on ? 'on' : ''}"${extra}>${inner}</button>`
      : `<button type="button" id="${esc(v.id)}-${esc(key)}" ${v.attr}="${esc(key)}" aria-pressed="${on}" class="${on ? 'on' : ''}"${extra}>${inner}</button>`;
  }).join('');
  const set = v.kind === 'tabs'
    ? `<span id="${esc(v.id)}" class="ui-view-set segmented nt-tabs" role="tablist" aria-label="${esc(v.label)}">${buttons}</span>`
    : `<span id="${esc(v.id)}" class="ui-view-set segmented" role="group" aria-label="${esc(v.label)}">${buttons}</span>`;
  // the dropdown form holds every value in one cell and shows the current one: it is as wide as its widest value, so choosing another moves nothing
  const values = v.items.map(([key, label]) => `<span data-pick-value${key === current[0] ? ' data-pick-current' : ''}>${esc(label)}</span>`).join('');
  const pick = `<button type="button" id="${esc(v.id)}-pick" class="ui-view-pick" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`${v.label}: ${current[1]}`)}" title="${esc(v.label)}"><span class="ui-picker-value" data-pick-values>${values}</span>${icon('chevron-down', { size: 12 })}</button>`;
  return `<span class="ui-view${v.cls ? ' ' + esc(clsOf(v.cls, cx, who)) : ''}" data-ui-kind="view" data-ui-as="segmented">${set}${pick}</span>`;
}

function options(opts, value) {
  return (opts || []).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
}

function normFilter(f, cx) {
  if (f && own(f, 'html')) {
    if (!f.reason) cx.report('{html} needs a reason (the one exit from the vocabulary is counted and ratcheted to zero)');
    if (!f.id) cx.report('{html} needs an id: the engine measures it as a select-like filter');
    return { t: 'html', html: String(f.html ?? ''), id: f.id, reason: f.reason, type: 'select' };
  }
  const who = `filter '${f?.id ?? '?'}'`;
  knownKeys(f, ['type', 'id', 'label', 'value', 'options', 'placeholder', 'width', 'foldable', 'records', 'maxlength', 'attrs', 'inputType'], who, cx);
  if (!FILTER_TYPES.includes(f?.type)) { cx.report(`${who}: type '${f?.type}' is not one of ${FILTER_TYPES.join(', ')}`); return null; }
  idOk(f.id, cx, who);
  if (!f.label) cx.report(`${who}: needs a label`);
  const foldable = !!(f.foldable ?? (FOLD_FILTERS && f.type === 'select'));
  if (foldable && f.type === 'search') { cx.report(`${who}: a search field never folds. Remove foldable`); }
  return { t: 'filter', type: f.type, id: f.id, label: f.label, value: f.value, options: f.options, placeholder: f.placeholder, width: f.width, foldable: foldable && f.type !== 'search',
    records: f.records, maxlength: f.maxlength, attrs: f.attrs, inputType: f.inputType };
}
function filterHtml(f, cx, top) {
  if (f.t === 'html') return f.html;
  const who = `filter '${f.id}'`, kind = f.type === 'record' ? 'select' : f.type, at = a => attrsOf(a, cx, who);
  const item = top.fold ? ` data-ui-fold="${top.fold}" data-ui-role="${top.role}"${top.keep ? ' data-ui-keep' : ''}` : '';
  const k = `data-ui-kind="${top.foldable ? 'check' : kind}"${top.foldable ? ` data-ui-item="${esc(f.id)}"` : ''}${item}`;
  switch (f.type) {
    // a search is 128 to 320px; `width: 'flex'` lets it take the row (a page whose tools row is its one field: the Files folder page)
    case 'search': return `<input type="search" id="${esc(f.id)}" class="ui-search" ${k}${f.width === 'flex' ? ' data-ui-w="flex"' : ''} aria-label="${esc(f.label)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.value != null ? ` value="${esc(f.value)}"` : ''}${f.maxlength ? ` maxlength="${Number(f.maxlength)}"` : ''} autocomplete="off"${at(f.attrs)}>`;
    case 'select': return `<select id="${esc(f.id)}" class="ui-select" ${k} aria-label="${esc(f.label)}"${at(f.attrs)}>${options(f.options, f.value)}</select>`;
    case 'field': return fieldHtml({ ...f, type: f.inputType || 'text' }, cx, ` ${k}`);
    case 'date': return `<span class="ui-filter" ${k}>${dateField(f.id, f.value ?? '', f.label, f.placeholder || undefined)}</span>`;
    case 'record': return `<span class="ui-filter" ${k}>${recordPicker({ id: f.id, label: f.label, value: f.value ?? '', records: f.records || [] })}</span>`;
    case 'check': return `<label class="ui-check" ${k}><input type="checkbox" id="${esc(f.id)}"${f.value ? ' checked' : ''}${at(f.attrs)}><span>${esc(f.label)}</span></label>`;
    default: return '';
  }
}

// ---- overflow ----------------------------------------------------------------------------------------------------------

function overflowHtml(list, cx, ids) {
  const entries = [];
  for (const e of list || []) {
    if (e === '-') { entries.push('-'); continue; }
    const who = `overflow '${e?.id ?? '?'}'`;
    if (!e || typeof e !== 'object') { cx.report('an overflow entry is not an object'); continue; }
    knownKeys(e, ['id', 'label', 'icon', 'danger', 'checked', 'disabled', 'kind', 'options', 'attrs', 'cls', 'value'], who, cx);
    idOk(e.id, cx, who); if (e.id) ids(e.id);
    if (!e.label) cx.report(`${who}: needs a label`);
    const kind = e.kind || (typeof e.checked === 'boolean' ? 'toggle' : 'button');
    if (!['button', 'toggle', 'select', 'readonly'].includes(kind)) { cx.report(`${who}: kind is button, toggle, select or readonly`); continue; }
    if (kind === 'select' && !e.options) cx.report(`${who}: a select entry needs options`);
    entries.push({ ...e, kind });
  }
  // Groups split by separators keep their order; destructive entries go last after one separator; separators never lead, trail or repeat.
  const groups = []; let cur = [];
  for (const e of entries) { if (e === '-') { if (cur.length) groups.push(cur); cur = []; } else if (!e.danger) cur.push(e); }
  if (cur.length) groups.push(cur);
  const seq = [];
  groups.forEach((g, i) => { if (i) seq.push('-'); seq.push(...g); });
  const danger = entries.filter(e => e !== '-' && e.danger);
  if (danger.length) { if (seq.length) seq.push('-'); seq.push(...danger); }
  const html = seq.map(e => {
    if (e === '-') return '<span hidden data-ui-overflow data-ui-kind="separator"></span>';
    const who = `overflow '${e.id}'`, klass = e.cls ? clsOf(e.cls, cx, who) : '';
    const base = `id="${esc(e.id)}"${klass ? ` class="${esc(klass)}"` : ''} hidden data-ui-overflow data-ui-kind="${e.kind}"${e.danger ? ' data-danger data-ui-danger' : ''}`;
    if (e.kind === 'readonly') return `<span ${base}${attrsOf(e.attrs, cx, who)}>${esc(e.label)}</span>`;
    if (e.kind === 'select') return `<select ${base} aria-label="${esc(e.label)}"${e.disabled ? ' disabled' : ''}${attrsOf(e.attrs, cx, who)}>${options(e.options, e.value)}</select>`;
    const pressed = e.kind === 'toggle' ? ` aria-pressed="${!!e.checked}"` : '';
    return `<button type="button" ${base}${pressed}${e.disabled ? ' disabled' : ''}${attrsOf(e.attrs, cx, who)}>${esc(e.label)}</button>`;
  }).join('');
  return { html, count: seq.filter(e => e !== '-').length };
}

// ---- the bar ---------------------------------------------------------------------------------------------------------

/**
 * Normalises a bar declaration into one rich structure that both the markup and the model are read from.
 * Throws nothing itself: problems go to cx.
 */
function normBar(spec, cx) {
  const who = `bar '${spec?.label ?? '?'}'`;
  if (!spec || typeof spec !== 'object') { cx.report('the bar spec is not an object'); spec = {}; }
  knownKeys(spec, BAR_KEYS, who, cx);
  const kind = spec.kind;
  if (!BAR_KINDS.includes(kind)) cx.report(`kind '${kind}' is not one of ${BAR_KINDS.join(', ')}`);
  if (!spec.label || typeof spec.label !== 'string') cx.report('needs a label (the bar\'s accessible name)');
  const bar = { kind: BAR_KINDS.includes(kind) ? kind : 'tools', label: spec.label || 'Actions', id: spec.id, equal: !!spec.equal, stack: spec.stack, density: spec.density, form: !!spec.form,
    reveal: spec.reveal, float: spec.float, align: spec.align, cls: spec.cls, attrs: spec.attrs, budget: spec.budget, switchAt: spec.switchAt, moreReserve: !!spec.moreReserve, plainMore: !!spec.plainMore, moreBeforeTail: !!spec.moreBeforeTail };
  if (spec.id) idOk(spec.id, cx, who);
  if (spec.density != null && spec.density !== 'dense') cx.report(`density is 'dense'`);
  if (spec.align != null && spec.align !== 'center') cx.report(`align is 'center'`);
  if (spec.reveal != null && spec.reveal !== 'hover') cx.report(`reveal is 'hover'`);
  if (spec.float != null && !['corner', 'popover'].includes(spec.float)) cx.report(`float is 'corner' or 'popover'`);
  if (spec.stack != null && typeof spec.stack !== 'boolean') cx.report('stack is a boolean');
  if (spec.stack === true && spec.kind === 'strip') cx.report('a strip has no stacked rung: its last rung folds everything foldable');
  // switchAt 'end' (the title bar, TOPBAR): the view switch stands right before the bar's end group, so nothing to its left (a title, a count, the acts of one
  // value) moves it; moreReserve keeps More's place when nothing is in it, so a page whose More empties does not move the switch either
  if (spec.switchAt != null && (spec.switchAt !== 'end' || spec.kind !== 'head' || spec.stack !== false)) cx.report("switchAt is 'end', for a head that never stacks (stack: false)");
  if (spec.moreReserve != null && typeof spec.moreReserve !== 'boolean') cx.report('moreReserve is a boolean');
  // plainMore: More is a plain icon (no tile at rest, a fill when pointed at or open), as the title bar's is, for a row whose acts are plain icons (the inspector's chat row)
  if (spec.plainMore != null && typeof spec.plainMore !== 'boolean') cx.report('plainMore is a boolean');
  const idsSeen = new Set(), ids = id => { if (idsSeen.has(id)) cx.report(`duplicate id '${id}'`); idsSeen.add(id); };
  const base = bar.id || slug(bar.label);
  const ctx = { bar, cx };
  const items = [];                                             // rich items, author order (filters that fold first)
  const out = { bar, items, views: [], filters: [], overflow: null, lead: null, start: null, message: null, status: null, hidden: [] };

  // lead
  const L = spec.lead;
  if (L != null) {
    if (bar.kind !== 'head') cx.report(`lead is for a head bar. A ${bar.kind} bar has no title: use start (foot) or a message`);
    if (own(L, 'html')) { if (!L.reason) cx.report('{html} needs a reason'); out.lead = { html: String(L.html ?? '') }; }
    else {
      knownKeys(L, ['title', 'level', 'menu', 'back', 'input', 'id', 'text', 'nav', 'crumbs'], 'lead', cx);
      if (L.title == null && L.input == null && L.back == null && L.text == null && L.nav == null && L.crumbs == null) cx.report('lead needs a title, an input, a back button, navigation or a path');
      if (L.title != null && L.input != null) cx.report('lead is a title or an input, not both');
      const lead = { title: L.title, level: L.level || 'h2', menu: !!L.menu, input: L.input, id: L.id, text: L.text };
      // navigation: a few icon acts (Back, Forward, Up one folder) that stay where they are, disabled when there is nowhere to go
      if (L.nav != null) {
        if (!Array.isArray(L.nav) || !L.nav.length || L.nav.length > 4) cx.report('lead nav is 1 to 4 icon acts');
        for (const a of Array.isArray(L.nav) ? L.nav : []) {
          if (!a?.icon) cx.report(`lead nav act '${a?.id ?? '?'}': an icon act needs an icon`);
          const act = normAct({ role: 'quiet', ...a }, { ...ctx, where: 'lead' });
          if (act) { act.slot = 'lead'; act.iconOnly = true; items.push(act); ids(act.id); }
        }
      }
      // a path: each folder a button that goes there, the last one the title; the middle collapses into a menu when the room is short (fitCrumbs)
      if (L.crumbs != null) {
        const list = Array.isArray(L.crumbs) ? L.crumbs : [];
        if (!list.length) cx.report('lead crumbs holds at least the title');
        const seen = new Set();
        lead.crumbs = list.map((c, i) => {
          if (!c || typeof c.id !== 'string' || !c.id || typeof c.label !== 'string' || !c.label) { cx.report(`lead crumb ${i + 1} needs an id and a label`); return null; }
          if (seen.has(c.id)) cx.report(`two crumbs share the id '${c.id}'`); seen.add(c.id);
          knownKeys(c, ['id', 'label', 'tip'], `lead crumb ${i + 1}`, cx);
          return { id: c.id, label: c.label, tip: typeof c.tip === 'string' && c.tip ? c.tip : c.label };
        }).filter(Boolean);
        lead.level = L.level || 'h1';
      }
      if (!['h1', 'h2', 'h3', 'p'].includes(lead.level)) cx.report(`lead level is h1, h2, h3 or p`);
      if (lead.menu && !lead.id) cx.report('a lead title that is a picker needs lead.id');
      if (lead.id) { idOk(lead.id, cx, 'lead'); ids(lead.id); }
      if (L.input) { knownKeys(L.input, ['id', 'label', 'value', 'placeholder', 'maxlength'], 'lead input', cx); idOk(L.input.id, cx, 'lead input'); ids(L.input.id); if (!L.input.label) cx.report('lead input needs a label'); }
      if (L.back) {
        knownKeys(L.back, ['id', 'to', 'label'], 'lead back', cx);
        if (!L.back.label) cx.report('lead back needs a label');
        const back = normAct({ id: L.back.id || `${base}-back`, label: L.back.label || 'Back', icon: 'chevron-left', role: 'quiet', iconOnly: true, plain: true, attrs: { 'data-act': 'back', ...(L.back.to ? { 'data-to': L.back.to } : {}) } }, { ...ctx, where: 'lead' });
        if (back) { back.slot = 'lead'; items.push(back); ids(back.id); }
      }
      out.lead = lead;
    }
  }
  // start (foot)
  if (spec.start != null) {
    if (bar.kind !== 'foot') cx.report(`start is for a foot bar: its left cluster holds a status message, one act, or a destructive act`);
    const list = Array.isArray(spec.start) ? spec.start : [spec.start];
    const acts = [];
    out.start = { parts: [] };
    for (const s of list) {
      if (s && own(s, 'message')) { out.start.parts.push({ t: 'message', id: s.id, text: String(s.message ?? '') }); }
      else { const a = normAct(s, { ...ctx, where: 'start' }); if (a) { acts.push(a); out.start.parts.push(a); ids(a.id); } }
    }
    if (acts.length > 1) cx.report(`start holds one act (got ${acts.map(a => a.id).join(', ')}). Move the others to actions`);
    for (const a of acts) { a.fromStart = true; if (a.role !== 'destructive' && !['secondary', 'quiet'].includes(a.role)) cx.report(`act '${a.id}': a start act is secondary, quiet or destructive`); items.push(a); }
    if (out.start.parts.some(p => p.t === 'message') && spec.message) cx.report('give the message once: in start (foot) or as message');
  }
  // message and status
  if (spec.message != null) {
    knownKeys(spec.message, ['id', 'text'], 'message', cx);
    out.message = { id: spec.message.id, text: String(spec.message.text ?? '') };
    if (spec.message.id) ids(spec.message.id);
  }
  if (spec.status != null) {
    knownKeys(spec.status, ['id', 'text', 'ch', 'after'], 'status', cx);
    if (spec.status.after != null && spec.status.after !== 'filters') cx.report(`status.after is 'filters' (the count stands at the end of the field) or absent`);
    const ch = spec.status.ch ?? 12, text = String(spec.status.text ?? '');
    if (!CH_STEPS.includes(ch)) cx.report(`status.ch ${ch} is not one of ${CH_STEPS.join(', ')}`);
    if (text.length > ch) cx.report(`status text '${text}' is ${text.length} characters, over its ${ch}ch slot. Raise status.ch (up to 24) or shorten the text`);
    out.status = { id: spec.status.id, text, ch: CH_STEPS.includes(ch) ? ch : chStep(ch), after: spec.status.after === 'filters' };
    if (spec.status.id) ids(spec.status.id);
  }
  if ((spec.message != null || out.start?.parts.some(p => p.t === 'message')) && spec.status != null && bar.kind === 'foot') cx.report('a foot bar has a message or a status, not both');
  // views
  const rawViews = spec.view == null ? [] : Array.isArray(spec.view) ? spec.view : [spec.view];
  if (rawViews.length > 2) cx.report('a bar has at most 2 view switches');
  out.views = rawViews.slice(0, 2).map((v, i) => { const nv = normView(v, cx, i); if (nv.id) ids(nv.id); return nv; });
  // filters
  for (const f of spec.filters || []) {
    const nf = normFilter(f, cx); if (!nf) continue;
    if (nf.id) ids(nf.id);
    if (nf.t === 'filter' && nf.foldable) items.push({ t: 'check', id: nf.id, role: 'secondary', fold: FOLD_DEFAULT.check, filter: nf });
    else out.filters.push(nf);
  }
  // actions
  let primaries = [];
  for (const raw of spec.actions || []) {
    let it = null;
    if (isDesc(raw, 'group')) it = normGroup(raw.spec, ctx);
    else if (isDesc(raw, 'swap')) it = normSwap(raw.spec, ctx);
    else if (raw && typeof raw === 'object' && raw.picker) it = normPicker(raw, ctx);
    else if (raw && typeof raw === 'object' && raw.field) {
      const fld = { ...raw, t: 'field' }; knownKeys(raw, ['field', 'id', 'label', 'type', 'width', 'value', 'placeholder', 'maxlength', 'role', 'attrs'], `field '${raw.id}'`, cx);
      it = { t: 'field', id: raw.id, role: raw.role === 'quiet' ? 'quiet' : 'secondary', spec: fld };
    } else if (typeof raw === 'string') {
      cx.report(`actions holds ActSpec, picker, uiGroup, uiSwap or field objects, not a markup string. Declare the control; the builder writes it`);
    } else it = normAct(raw, { ...ctx, where: 'actions' });
    if (!it) continue;
    if (it.t === 'act' && it.role === 'destructive') {
      if (bar.kind === 'foot') { cx.report(`act '${it.id}': a destructive act in a foot bar goes in start (visible, neutral), apart from the confirm cluster. Move it to start`); it.role = 'secondary'; }
      else { cx.report(`act '${it.id}': a destructive act is never inline. Move it to overflow ({ id: '${it.id}', label: '${it.label}', danger: true }); it lands in More after a separator`); out.hidden.push({ id: it.id, label: it.label, danger: true, attrs: it.attrs }); continue; }
    }
    if (it.t === 'swap' ? it.role === 'primary' : (it.t === 'act' && it.role === 'primary')) primaries.push(it);
    ids(it.id); items.push(it);
    if (it.t === 'group') for (const m of it.members) if (m.id) ids(m.id);
    if (it.t === 'swap') for (const m of it.members) ids(m.id);
  }
  if (primaries.length > 1) {
    cx.report(`two primaries (${primaries.map(p => p.label || p.id).join(', ')}). Make one secondary or move it to overflow`);
    for (const p of primaries.slice(1)) p.role = 'secondary';
  }
  // overflow (destructive actions already routed here)
  const ov = overflowHtml([...(spec.overflow || []), ...out.hidden.map(h => h)], cx, ids);
  out.overflow = ov;
  if (spec.hiddenFields) out.hiddenFields = spec.hiddenFields;
  // the contract checks that need the whole bar
  const icons = new Map();
  const seeIcon = a => { if (!a?.icon) return; if (icons.has(a.icon)) cx.report(`'${a.label}' and '${icons.get(a.icon)}' share the icon '${a.icon}'. Two acts in one bar need two icons`); else icons.set(a.icon, a.label); };
  for (const it of items) {
    if (it.t === 'act') seeIcon(it);
    if (it.t === 'group') for (const m of it.members) if (m.t === 'act') seeIcon(m);
    if (it.t === 'swap') for (const m of it.members) seeIcon(m);
  }
  const units = items.filter(it => it.slot !== 'lead' && ['act', 'group', 'picker', 'swap'].includes(it.t)).length + out.views.length;
  const budget = spec.budget;
  if (budget != null) {
    knownKeys(budget, ['n', 'reason'], 'budget', cx);
    if (!Number.isInteger(budget.n) || !budget.reason) cx.report('budget needs { n, reason }: a number and why the bar needs it');
  }
  const limit = budget && Number.isInteger(budget.n) && budget.reason ? budget.n : BUDGET[bar.kind];
  if (units > limit) cx.report(`${units} units declared (acts, groups, pickers, swaps, views), over the ${bar.kind} budget of ${limit}. Move the least used to overflow, or declare budget: { n: ${units}, reason: '...' }`);
  out.units = units;
  return out;
}

/** The BarSpec that modelOf() reads (bar-modes.mjs). The one place the builders and the width logic meet. */
export function barSpecOf(plan) {
  const items = plan.items.map(it => {
    const out = { id: it.id, kind: it.t === 'act' ? 'act' : it.t, role: it.role === 'destructive' ? 'secondary' : it.role };
    if (it.t === 'field') out.role = it.role === 'quiet' ? 'quiet' : 'secondary';
    if (it.fold != null) out.fold = it.fold;
    if (it.keep != null) out.keep = !!it.keep;
    if (it.presence === 'reserve') out.presence = 'reserve';
    if (it.slot === 'lead') out.slot = 'lead';
    if (it.trail) out.slot = 'end';
    return out;
  });
  const spec = { kind: plan.bar.kind, items, hasOverflow: plan.overflow.count > 0 };
  if (plan.bar.stack != null) spec.stack = plan.bar.stack;
  if (plan.bar.switchAt === 'end' && plan.views.length) spec.switchEnd = true;
  if (plan.bar.moreReserve) spec.hasOverflow = true;
  if (plan.bar.equal) spec.equal = true;
  if (plan.lead || plan.start?.parts.some(p => p.t !== 'message')) spec.lead = true;
  if (plan.message || plan.start?.parts.some(p => p.t === 'message')) spec.message = true;
  if (plan.status) { spec.status = true; if (plan.status.after) spec.statusLast = true; }
  if (plan.views.length) spec.views = plan.views.map(v => ({ id: v.id, n: v.n }));
  if (plan.filters.length) spec.filters = plan.filters.map(f => ({ id: f.id, kind: f.type === 'record' ? 'select' : f.type }));
  return spec;
}

/** Everything a test or the library page needs: the rich plan plus the BarSpec. Throws like uiBar. */
export function barPlan(spec) {
  const cx = checker(`uiBar() '${spec?.label ?? '?'}'`, spec?.kind);
  const plan = normBar(spec, cx);
  cx.done();
  const barSpec = barSpecOf(plan);
  const problems = validateBarSpec(barSpec);
  if (problems.length) throw new BarSpecError(`uiBar() '${spec?.label}': ${problems.join('; ')}`, problems);
  return { ...plan, barSpec };
}

/** The author-order items sorted into the order the builder renders and the model lists them. */
function renderOrder(plan) {
  const spec = barSpecOf(plan), byId = new Map(plan.items.map(i => [i.id, i]));
  return orderItems(spec.items).map(i => byId.get(i.id));
}

function itemHtml(it, o, cx) {
  const top = { bar: o.bar, top: true, end: o.end };
  if (it.t === 'act') return actHtml(it, top, cx);
  if (it.t === 'group') return groupHtml(it, top, cx);
  if (it.t === 'swap') return swapHtml(it, top, cx);
  if (it.t === 'picker') return pickerHtml(it, top, cx);
  if (it.t === 'field') {
    const s = it.spec, fold = resolveFold({ ...it, kind: 'field' });
    return fieldHtml({ ...s, id: s.id }, cx, ` data-ui-kind="field" data-ui-role="${it.role}" data-ui-fold="${fold}" data-ui-keep`);
  }
  if (it.t === 'check') return filterHtml(it.filter, cx, { foldable: true, fold: it.fold ?? FOLD_DEFAULT.check, role: it.role, keep: false });
  return '';
}

const moreHtml = ({ end, empty }) => `<button type="button" class="ui-act" data-ui-more${end ? ' data-ui-end' : ''}${empty ? ' data-ui-empty' : ''} aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More">${icon('more')}<span class="ui-act-label">More</span></button>`;

// A path: each folder before the title a quiet button (its words end in an ellipsis when it is itself too long), one chevron between them, the
// last part the page title, whole, a picker when the lead is a menu (the path popover). "…" after the first folder holds the folded middle (fitCrumbs).
function crumbsHtml(L) {
  const list = L.crumbs, last = list.at(-1), tag = L.level || 'h1';
  const sep = (cls = '', hidden = false) => `<span class="ui-crumb-sep${cls}" aria-hidden="true"${hidden ? ' hidden' : ''}>${icon('chevron-right', { size: 12 })}</span>`;
  const parents = list.slice(0, -1).map(c => `<button type="button" class="ui-crumb" data-crumb="${esc(c.id)}" title="${esc(c.tip || c.label)}"><span class="ui-crumb-text">${esc(human(c.label))}</span></button>${sep()}`);
  const more = list.length > 2 ? `<button type="button" class="ui-crumb ui-crumb-more" aria-haspopup="menu" aria-expanded="false" aria-label="Folders in between" title="Folders in between" hidden>\u2026</button>${sep(' ui-crumb-more-sep', true)}` : '';
  const withMore = parents.length ? [parents[0], more, ...parents.slice(1)] : [];
  const text = esc(human(last.label));
  const inner = L.menu ? `<button type="button" id="${esc(L.id)}" class="ui-title-pick" aria-haspopup="menu" aria-expanded="false"><span>${text}</span>${icon('chevron-down', { size: 12 })}</button>` : text;
  return `<nav class="ui-crumbs" aria-label="Path" data-ui-width>${withMore.join('')}<${tag} class="ui-bar-title ui-crumb-last${L.menu ? ' ui-crumb-pick' : ''}"${L.menu ? '' : ` title="${esc(last.tip || last.label)}"`} data-crumb="${esc(last.id)}">${inner}</${tag}></nav>`;
}

function leadHtml(plan, cx) {
  const L = plan.lead, backs = plan.items.filter(i => i.slot === 'lead' && !i.fromStart);
  const backHtml = backs.map(back => actHtml(back, { bar: plan.bar, top: true }, cx)).join('');
  if (!L) return '';
  if (L.crumbs) return `<div data-ui-slot="lead">${backHtml}${crumbsHtml(L)}</div>`;
  if (L.html != null) return `<div data-ui-slot="lead">${backHtml}${L.html}</div>`;
  if (L.input) {
    const i = L.input;
    return `<div data-ui-slot="lead">${backHtml}<input type="text" id="${esc(i.id)}" class="ui-bar-title-input" aria-label="${esc(i.label)}" value="${esc(i.value ?? '')}"${i.placeholder ? ` placeholder="${esc(i.placeholder)}"` : ''}${i.maxlength ? ` maxlength="${Number(i.maxlength)}"` : ''}></div>`;
  }
  if (L.title != null || L.text != null) {
    const text = human(L.title ?? L.text), tag = L.level;
    const inner = L.menu
      ? `<button type="button" id="${esc(L.id)}" class="ui-title-pick" aria-haspopup="menu" aria-expanded="false"><span>${esc(text)}</span>${icon('chevron-down', { size: 12 })}</button>`
      : esc(text);
    return `<div data-ui-slot="lead">${backHtml}<${tag} class="ui-bar-title"${L.id && !L.menu ? ` id="${esc(L.id)}"` : ''}${L.title != null && !L.menu ? ` title="${esc(text)}"` : ''}>${inner}</${tag}></div>`;
  }
  return backHtml ? `<div data-ui-slot="lead">${backHtml}</div>` : '';
}

/** Controls a reader can focus: the unit of the toolbar rule (a strip, or 4 or more controls, is a toolbar with roving focus). */
function controlCount(plan, main, hasMore) {
  let n = hasMore ? 1 : 0;
  for (const it of main) n += it.t === 'group' ? it.members.filter(m => m.t !== 'readout').length : it.t === 'swap' ? 1 : 1;
  n += plan.filters.length + plan.views.reduce((a, v) => a + v.n, 0) + (plan.items.some(i => i.slot === 'lead') ? 1 : 0) + (plan.lead?.input || plan.lead?.menu ? 1 : 0);
  return n;
}

function barMarkup(plan, cx) {
  const { bar } = plan, tag = bar.form ? 'form' : 'div';
  const ordered = renderOrder(plan), main = ordered.filter(i => i.slot !== 'lead');
  const primary = main.find(i => (i.t === 'act' || i.t === 'swap') && i.role === 'primary');
  const hasMore = main.length > 0 || plan.overflow.count > 0;
  const slots = [];
  if (plan.start) {
    const parts = plan.start.parts.map(p => p.t === 'message'
      ? `<span class="ui-bar-message"${p.id ? ` id="${esc(p.id)}"` : ''} role="status">${esc(human(p.text))}</span>` : actHtml(p, { bar, top: true }, cx)).join('');
    slots.push(`<div data-ui-slot="start">${parts}</div>`);
  } else { const l = leadHtml(plan, cx); if (l) slots.push(l); }
  // the count beside the title, then the switch and the filters; the message (what an action reported) comes last before the actions, so a
  // message that appears takes the slack and moves nothing (it shrinks first, down to --message-min)
  const statusHtml = plan.status ? `<span data-ui-slot="status"${plan.status.id ? ` id="${esc(plan.status.id)}"` : ''} role="status" data-ui-ch="${plan.status.ch}"${plan.status.after ? ' data-ui-status-after' : ''}>${esc(human(plan.status.text))}</span>` : '';
  if (statusHtml && !plan.status.after) slots.push(statusHtml);
  const viewsAtEnd = bar.switchAt === 'end' && plan.views.length > 0;
  if (plan.views.length && !viewsAtEnd) slots.push(`<div data-ui-slot="view">${plan.views.map(v => viewHtml(v, cx)).join('')}</div>`);
  if (plan.filters.length) slots.push(`<div data-ui-slot="filters">${plan.filters.map(f => filterHtml(f, cx, { foldable: false })).join('')}</div>`);
  if (statusHtml && plan.status.after) slots.push(statusHtml);   // a find bar: the count is the field's quiet readout, at its end
  if (plan.message) slots.push(`<span data-ui-slot="message"${plan.message.id ? ` id="${esc(plan.message.id)}"` : ''} role="status" title="${esc(plan.message.text)}">${esc(human(plan.message.text))}</span>`);
  if (hasMore || viewsAtEnd) {
    const endIdx = primary ? main.indexOf(primary) : -1;
    // a switch at the end stands between the page's acts and the end group (the panel toggles), so its right edge is the bar's and never moves
    const at = viewsAtEnd ? (i => (i < 0 ? main.length : i))(main.findIndex(it => it.trail)) : -1;
    const viewHtmlAt = viewsAtEnd ? plan.views.map(v => viewHtml(v, cx)).join('') : '';
    // moreBeforeTail: More stands before the end group (the title bar's panel toggles), so the toggles are the bar's last controls
    const moreAt = bar.moreBeforeTail ? (i => (i < 0 ? main.length : i))(main.findIndex(it => it.trail)) : -1;
    const moreAll = moreHtml({ end: !primary, empty: !plan.overflow.count }) + plan.overflow.html;
    const actions = main.map((it, i) => (i === at ? viewHtmlAt : '') + (i === moreAt ? moreAll : '') + itemHtml(it, { bar, end: i === endIdx }, cx)).join('') + (at === main.length ? viewHtmlAt : '') + (moreAt === main.length ? moreAll : '');
    slots.push(`<div data-ui-slot="actions">${actions}${bar.moreBeforeTail ? '' : moreAll}</div>`);
  }
  const hidden = (plan.hiddenFields || []).map(h => `<input type="hidden" id="${esc(h.id)}"${h.name ? ` name="${esc(h.name)}"` : ''} value="${esc(h.value ?? '')}">`).join('');
  const role = bar.kind === 'strip' || controlCount(plan, main, hasMore) >= 4 ? 'toolbar' : 'group';
  const at = [`class="ui-bar${bar.cls ? ' ' + esc(clsOf(bar.cls, cx, 'cls')) : ''}"`, bar.id ? `id="${esc(bar.id)}"` : '', `data-ui-bar="${bar.kind}"`, `role="${role}"`, `aria-label="${esc(bar.label)}"`];
  if (bar.density) at.push(`data-ui-density="${bar.density}"`);
  if (bar.form) at.push('data-ui-form');
  if (bar.float) at.push(`data-ui-float="${bar.float}"`);
  if (bar.reveal) at.push(`data-ui-reveal="${bar.reveal}"`);
  if (bar.equal) at.push('data-ui-equal');
  if (bar.align) at.push(`data-ui-align="${bar.align}"`);
  if (bar.stack === false) at.push('data-ui-nostack');
  if (bar.switchAt === 'end' && plan.views.length) at.push('data-ui-switch-end');
  if (bar.moreReserve) at.push('data-ui-reserve-more');
  if (bar.plainMore) at.push('data-ui-plain-more');
  if (bar.moreBeforeTail) at.push('data-ui-more-tail');
  if (bar.budget && Number.isInteger(bar.budget.n) && bar.budget.reason) at.push(`data-ui-budget="${bar.budget.n}"`);   // a declared budget: the sweep's crowded-units audit holds the bar to it, not to three
  const html = `<${tag} ${at.filter(Boolean).join(' ')}${bar.form ? ' novalidate' : ''}${attrsOf(bar.attrs, cx, 'bar')}>${hidden}${slots.join('')}</${tag}>`;
  return bar.float === 'corner' ? `<div class="ui-float">${html}</div>` : html;
}

export function uiBar(spec) {
  const cx = checker(`uiBar() '${spec?.label ?? '?'}'`, spec?.kind);
  const plan = normBar(spec, cx);
  const barSpec = barSpecOf(plan);
  for (const p of validateBarSpec(barSpec)) cx.report(p);
  let html = '';
  try { html = barMarkup(plan, cx); }
  catch (e) { if (!cx.problems.length) throw e; }              // a bar that is already wrong may fail to render; report what was wrong
  cx.done();
  return html;
}

/** For views whose actions() must return a node. Browser only. */
/** The attributes a bar's declaration writes (not the engine's state): a bar element kept across draws (the title bar) takes them from the new markup. */
const DECLARED_BAR_ATTRS = ['data-ui-switch-end', 'data-ui-reserve-more', 'data-ui-plain-more', 'data-ui-budget', 'data-ui-nostack', 'data-ui-density', 'data-ui-form', 'data-ui-float', 'data-ui-reveal', 'data-ui-equal', 'data-ui-align', 'role', 'aria-label'];
export function syncBarAttrs(bar, next) { for (const a of DECLARED_BAR_ATTRS) { if (next.hasAttribute(a)) bar.setAttribute(a, next.getAttribute(a)); else bar.removeAttribute(a); } }
export const barEl = spec => {
  const t = document.createElement('template');
  t.innerHTML = typeof spec === 'string' ? spec : uiBar(spec);
  return t.content.firstElementChild;
};

/** Where a menu act's menu hangs: the act, or its bar's More when the engine has folded the act into it (a handler then gets the hidden act). */
export const menuAnchor = a => (a?.getClientRects?.().length ? a : a?.closest?.('[data-ui-bar]')?.querySelector('[data-ui-more]') || a);

/**
 * The engine's width hook (S4): `fn` runs, outside the resize delivery, each time the box's inline size changes and once when it first has
 * one (a box inside a closed <details> or a hidden pane has none until it shows). A box whose content depends on its width, a text area
 * that wraps differently at another width, uses this instead of a ResizeObserver of its own (lint T9): the page has one observer, the
 * engine's, and it releases the box when it leaves the document. `rows: true` also fires when the block size changes (a vertical list cut at a whole
 * row, bar-fit.mjs cutRows); `now: true` runs `fn` inside the resize delivery, before the frame paints (the shell's pane layout, which the bars it holds follow). Returns the release function. Without the engine nothing fires.
 */
export function watchWidth(el, fn, { rows = false, now = false } = {}) {
  if (!el?.setAttribute || typeof fn !== 'function') return () => {};
  const on = () => fn();
  el.addEventListener('ui-width', on);
  el.setAttribute('data-ui-width', [rows && 'rows', now && 'now'].filter(Boolean).join(' '));
  return () => { el.removeEventListener('ui-width', on); el.removeAttribute('data-ui-width'); };
}

// ---- document tabs ------------------------------------------------------------------------------------------------------------

/**
 * A strip of open documents: one tab each (type icon, name, a close slot that is always there), the active one drawn by fill and weight, a preview
 * tab quiet, an edited tab with a dot in its close slot. It is not a bar: a bar's items are a few declared actions, a strip holds any number of
 * documents. The shape is one of three, written by fitDocTabs as data-ui-mode (tabsMode in bar-modes.mjs): full, compact, picker.
 *
 *   uiDocTabs({ id, label, tabs: [{ id, label, icon, path?, dirty?, preview? }], active, focused? })
 *
 * `id` of a tab is whatever names the document (its path); it comes back on the tab as data-tab. The view wires clicks (lib/doc-tabs.mjs).
 */
export function uiDocTabs({ id, label, tabs = [], active = '', focused = true } = {}) {
  const cx = checker(`uiDocTabs() '${id ?? '?'}'`, 'docTabs');
  idOk(id, cx, 'tabs');
  if (!label) cx.report('needs a label (the strip\u2019s accessible name)');
  const list = Array.isArray(tabs) ? tabs : [];
  const seen = new Set();
  const items = list.map((t, i) => {
    const who = `tab '${t?.id ?? i}'`;
    if (!t || typeof t !== 'object') { cx.report(`${who}: a tab is an object`); return null; }
    knownKeys(t, ['id', 'label', 'icon', 'path', 'dirty', 'preview', 'pinned'], who, cx);
    if (typeof t.id !== 'string' || !t.id) { cx.report(`${who}: needs an id (what names the document)`); return null; }
    if (seen.has(t.id)) cx.report(`${who}: two tabs share an id`);
    seen.add(t.id);
    if (typeof t.label !== 'string' || !t.label.trim()) cx.report(`${who}: needs a label (the document name)`);
    if (!t.icon || !own(ICON_PATHS, t.icon)) cx.report(`${who}: needs a registered icon for its type`);
    return { i, id: t.id, label: String(t.label ?? t.id), icon: own(ICON_PATHS, t.icon) ? t.icon : 'file', path: String(t.path || t.label || t.id), dirty: !!t.dirty && !t.pinned, preview: !!t.preview && !t.pinned, pinned: !!t.pinned };
  }).filter(Boolean);
  if (items.length && !items.some(t => t.id === active)) cx.report(`active '${active}' is not one of the tabs`);
  const current = items.find(t => t.id === active) || items[0];
  const pos = current ? items.indexOf(current) + 1 : 0;
  const tabHtml = t => {
    const on = t === current;
    return `<span class="ui-tab" role="presentation" data-tab="${esc(t.id)}"${on ? ' data-ui-active' : ''}${t.preview ? ' data-ui-preview' : ''}${t.dirty ? ' data-ui-dirty' : ''}${t.pinned ? ' data-ui-pinned' : ' draggable="true"'}>`
      + `<button type="button" role="tab" class="ui-tab-main" id="${esc(id)}-tab-${t.i}" aria-selected="${on}" tabindex="${on ? 0 : -1}" title="${esc(t.path)}">${icon(t.icon)}<span class="ui-tab-name">${esc(human(t.label))}</span></button>`
      + (t.pinned ? '<span class="ui-tab-close ui-tab-fixed" aria-hidden="true"></span></span>'
        : `<button type="button" class="ui-tab-close" tabindex="-1" aria-label="Close ${esc(t.label)}" title="${t.dirty ? 'Close, unsaved edits' : 'Close'} (\u2318W)">${icon('close', { size: 12 })}<span class="ui-tab-dot" aria-hidden="true"></span></button></span>`);
  };
  const ghost = t => `<span class="ui-tab-ghost">${icon(t.icon)}<span class="ui-tab-name">${esc(human(t.label))}</span><span class="ui-tab-slot"></span></span>`;
  const html = `<div class="ui-tabs" id="${esc(id)}" data-ui-tabs data-ui-width data-ui-mode="full"${focused ? ' data-ui-focused' : ''}>`
    + `<div class="ui-tabs-set" role="tablist" aria-label="${esc(label)}">${items.map(tabHtml).join('')}</div>`
    + `<div class="ui-tabs-pick"${current?.dirty ? ' data-ui-dirty' : ''}><button type="button" class="ui-tabs-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Open documents" title="Open documents">${current ? icon(current.icon) : ''}<span class="ui-tab-name">${esc(human(current?.label || ''))}</span>${icon('chevron-down', { size: 12 })}</button>`
    + `<span class="ui-tabs-count" role="status">${pos} of ${items.length}</span>`
    + `<button type="button" class="ui-tabs-prev" aria-label="Previous document" title="Previous document (\u2318\u21e7[)">${icon('chevron-left')}</button>`
    + `<button type="button" class="ui-tabs-next" aria-label="Next document" title="Next document (\u2318\u21e7])">${icon('chevron-right')}</button>`
    + `${current?.pinned ? '<span class="ui-tab-close ui-tab-fixed ui-tabs-pick-close" aria-hidden="true"></span>' : `<button type="button" class="ui-tab-close ui-tabs-pick-close" aria-label="Close ${esc(current?.label || 'document')}" title="Close (\u2318W)">${icon('close', { size: 12 })}<span class="ui-tab-dot" aria-hidden="true"></span></button>`}</div>`
    + `<div class="ui-tabs-end"><button type="button" class="ui-tabs-more" id="${esc(id)}-more" aria-haspopup="menu" aria-expanded="false" aria-label="More" title="More">${icon('more')}</button></div>`
    + `<div class="ui-tabs-sizer" aria-hidden="true">${items.map(ghost).join('')}</div></div>`;
  cx.done();
  return html;
}

/**
 * Fits a path to its room, a function of the width alone. Every part is first laid out whole (data-ui-measure); then the middle folds into "…" from
 * the second folder on, while the path is too wide or its title is cut; with the middle gone the first folder ends in an ellipsis down to its floor,
 * then folds too; only a title wider than the whole room ends in an ellipsis. A glyph is never cut: every text box that shrinks has an ellipsis.
 */
export function fitCrumbs(el) {
  if (!el?.isConnected || !el.matches?.('.ui-crumbs')) return 0;
  const parts = [...el.querySelectorAll(':scope > .ui-crumb:not(.ui-crumb-more)')], seps = [...el.querySelectorAll(':scope > .ui-crumb-sep:not(.ui-crumb-more-sep)')];
  const more = el.querySelector(':scope > .ui-crumb-more'), moreSep = el.querySelector(':scope > .ui-crumb-more-sep');
  const last = el.querySelector(':scope > .ui-crumb-last'), lastText = last?.querySelector('.ui-title-pick > span') || last;
  parts.forEach((p, i) => { p.hidden = false; if (seps[i]) seps[i].hidden = false; });
  if (more) { more.hidden = true; moreSep.hidden = true; }
  el.setAttribute('data-ui-measure', '');
  const room = el.clientWidth;
  const over = () => el.scrollWidth > room + 1;
  const hide = i => { parts[i].hidden = true; seps[i].hidden = true; if (more) { more.hidden = false; moreSep.hidden = false; } };
  let folded = 0;
  if (room) {
    // a two-part path (the title bar's "List / item" in a single pane): the parent is shown only while the whole path fits; Back is beside it anyway
    if (!more) { if (parts.length === 1 && over()) { hide(0); folded = 1; } }
    else {
      while (over() && folded < parts.length - 1) hide(++folded);
      el.removeAttribute('data-ui-measure');
      // the first folder may now shorten (its floor, then it folds as well): the title stays whole while anything else can give
      if (el.scrollWidth > room + 1 || (lastText && lastText.scrollWidth > lastText.clientWidth + 1)) { hide(0); folded++; }
    }
  }
  el.removeAttribute('data-ui-measure');
  if (more) more.dataset.folded = String(folded);
  return folded;
}

/** Marks a strip as the one whose group has the keyboard (its active tab keeps its full ink). */
export const focusDocTabs = (el, on) => el?.toggleAttribute?.('data-ui-focused', !!on);

/** Reads the strip's natural tab widths and its room, and writes its shape (data-ui-mode, full | compact | picker). The page calls it from watchWidth. */
export function fitDocTabs(el) {
  if (!el?.isConnected || !el.matches?.('[data-ui-tabs]')) return '';
  const width = el.clientWidth;
  if (!width) return el.getAttribute('data-ui-mode') || '';
  const natural = [...el.querySelectorAll('.ui-tab-ghost')].map(g => g.getBoundingClientRect().width);
  const end = el.querySelector('.ui-tabs-end')?.getBoundingClientRect().width || 0;
  const mode = tabsMode({ n: natural.length, natural, width: width - end });
  if (el.getAttribute('data-ui-mode') !== mode) el.setAttribute('data-ui-mode', mode);
  el.style.setProperty('--ui-tab-cols', String(natural.length + 1));
  return mode;
}

// Every strip fits itself when the engine reports its width (the strip declares data-ui-width), wherever it is drawn: a view, the library page, a test.
if (typeof document !== 'undefined') document.addEventListener('ui-width', e => { if (e.target?.matches?.('[data-ui-tabs]')) fitDocTabs(e.target); else if (e.target?.matches?.('.ui-crumbs')) fitCrumbs(e.target); }, true);

/** The thin wrappers shared UI calls (spec 12: dialog-foot, inspector-actions). */
export const dialogFoot = spec => uiBar({ kind: 'foot', cls: 'ui-dialog-foot', ...spec });
export const inspectorActions = spec => uiBar({ kind: 'foot', cls: 'ui-inspector-actions', ...spec, actions: (spec.actions || []).map(a => a?.label && !a.role && !a.spec ? { role: 'quiet', ...a } : a) });

// ---- regions -----------------------------------------------------------------------------------------------------------

/** Bars that replace each other in one grid cell: a selection bar replaces the list controls without pushing the table. */
export function uiRegion({ id, bars, active = 0, label } = {}) {
  const cx = checker(`uiRegion() '${id}'`, null);
  idOk(id, cx, 'region');
  if (!Array.isArray(bars) || bars.length < 2) cx.report('a region holds 2 or more bars. One bar needs no region');
  const list = Array.isArray(bars) ? bars : [];
  if (!(Number.isInteger(active) && active >= 0 && active < list.length)) { cx.report(`active is an index into bars (0..${list.length - 1})`); active = 0; }
  const html = `<div class="ui-region" id="${esc(id)}" data-ui-region${label ? ` role="group" aria-label="${esc(label)}"` : ''}>${list.map((b, i) => `<div class="ui-region-pane" data-ui-pane="${i}"${i === active ? '' : ' data-ui-inactive inert'}>${b}</div>`).join('')}</div>`;
  cx.done(); return html;
}
/** Shows pane `index` of a region built by uiRegion. A global [hidden] rule would drop the pane out of the cell, so panes are inactive, not hidden. */
export function regionShow(region, index) {
  region.querySelectorAll(':scope>[data-ui-pane]').forEach(p => {
    const on = Number(p.getAttribute('data-ui-pane')) === index;
    if (on) { p.removeAttribute('data-ui-inactive'); p.removeAttribute('inert'); } else { p.setAttribute('data-ui-inactive', ''); p.setAttribute('inert', ''); }
  });
}

// ---- lists and rows (CASE 1) --------------------------------------------------------------------------------------------

const COLS_MAX = 3;
const TEXT_CELLS_MAX = 2;
/** reserve: true draws the end slot empty, so a row with nothing to offer ends where its neighbours with a More end. */
export function uiRowEnd({ primary, inline, more, reserve } = {}) {
  const cx = checker('uiRowEnd()', null);
  if (reserve) {
    if (primary || inline || more) cx.report('a reserved end slot is empty: it takes no primary, inline or more');
    cx.done(); return '<div class="ui-row-end" data-ui-slot="end" data-ui-reserved aria-hidden="true"></div>';
  }
  if (primary && inline) cx.report('a row end holds one labelled primary or one inline icon action, not both. Move one to More');
  if (!more || !more.label) cx.report('more needs { label, attrs }');
  const bar = { kind: 'tools' }, parts = [];
  for (const [a, role] of [[primary, 'primary'], [inline, 'quiet']]) {
    if (!a) continue;
    const n = normAct({ role: role === 'primary' ? 'primary' : 'quiet', ...a }, { bar, cx, where: 'actions' });
    if (!n) continue;
    if (role === 'quiet') { if (!n.icon) cx.report(`act '${n.id}': an inline row action is an icon button. Give it an icon`); n.iconOnly = true; }
    else if (n.role === 'primary') n.role = 'secondary';           // a row's labelled action is neutral: the row is not a region's primary
    parts.push(actHtml(n, { bar, member: true }, cx));
  }
  const m = more || {};
  const moreBtn = `<button type="button" class="ui-act ui-row-more" data-ui-role="quiet" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(m.label || 'More')}" title="${esc(m.label || 'More')}"${attrsOf(m.attrs, cx, 'row more')}>${icon('more')}</button>`;
  const html = `<div class="ui-row-end" data-ui-slot="end">${parts.join('')}${moreBtn}</div>`;
  cx.done(); return html;
}

export function uiRow(spec = {}) {
  const cx = checker('uiRow()', null), who = 'row';
  knownKeys(spec, ['cls', 'attrs', 'depth', 'check', 'main', 'cells', 'end', 'id', 'table'], who, cx);
  if (!spec.main || spec.main.html == null) cx.report('main needs { html, detail?, wrap? }: the title and one meta line; wrap lets the line run over several lines');
  const depth = Math.max(0, Math.floor(spec.depth || 0)), d = Math.min(depth, 3);
  const cells = spec.cells || [];
  if (cells.length > COLS_MAX) cx.report(`a row has at most ${COLS_MAX} control columns (got ${cells.length}). Text values (due date, owner, source) go in detail or in a text cell`);
  const textMax = spec.table ? COLS_MAX : TEXT_CELLS_MAX;   // table: a one-line row of a name and its values, as a file table is (every cell a text cell)
  if (cells.filter(c => c?.kind === 'text').length > textMax) cx.report(`a row has at most ${textMax} text cells. A third value goes in detail`);
  const cellHtml = cells.map(c => {
    knownKeys(c, ['col', 'kind', 'html', 'ch'], 'cell', cx);
    if (!c.col) cx.report('a cell needs col');
    if (!['control', 'visual', 'text'].includes(c.kind)) cx.report(`cell '${c.col}': kind is 'control', 'visual' or 'text'`);
    if (c.kind === 'control' && !/<(select|input|button)\b/i.test(c.html || '')) cx.report(`cell '${c.col}': a control column holds a select, input or button. Text values (due date, owner, source) go in detail or in a text cell, never in a control column`);
    if (c.kind === 'text' && /<(select|input|button|textarea)\b/i.test(c.html || '')) cx.report(`cell '${c.col}': a text cell holds text only. A control goes in a control column`);
    if (c.ch != null && c.kind !== 'text') cx.report(`cell '${c.col}': ch is the width of a text cell`);
    if (c.ch != null && !CH_STEPS.includes(c.ch)) cx.report(`cell '${c.col}': ch is one of ${CH_STEPS.join(', ')} (got ${c.ch})`);
    return `<div class="ui-row-cell" data-ui-col="${esc(c.col)}" data-ui-cell="${esc(c.kind)}"${c.ch != null ? ` data-ui-ch="${c.ch}"` : ''}>${c.html ?? ''}</div>`;
  }).join('');
  const check = spec.check ? `<label class="ui-row-check"><input type="checkbox"${spec.check.checked ? ' checked' : ''} aria-label="${esc(spec.check.label || 'Select')}"${attrsOf(spec.check.attrs, cx, 'check')}></label>` : '';
  const parts = (spec.main?.detail || []).filter(x => x != null && x !== '');
  const detail = parts.join('<span class="ui-row-sep" aria-hidden="true"></span>');
  // a detail line wraps to a second line and ends there (ui-actions.css); its title holds it whole. One that runs on (main.wrap) needs none.
  const tip = spec.main?.wrap ? '' : ` title="${esc(parts.map(plainText).join('; '))}"`;
  const cls = ['ui-row', spec.cls ? clsOf(spec.cls, cx, who) : ''].filter(Boolean).join(' ');
  const html = `<div class="${esc(cls)}" role="listitem" data-ui-depth="${d}" aria-level="${depth + 1}"${spec.id ? ` id="${esc(spec.id)}"` : ''}${attrsOf(spec.attrs, cx, who)}>`
    + `<div data-ui-slot="lead">${check}<div class="ui-row-main">${spec.main?.html ?? ''}${detail ? `<span class="ui-row-detail meta"${spec.main?.wrap ? ' data-ui-wrap' : tip}>${detail}</span>` : ''}</div></div>`
    + `<div data-ui-slot="cells">${cellHtml}</div>${spec.end ?? ''}</div>`;
  cx.done(); return html;
}

// text: 'short' for a list whose text is a word or two (stage names): its floor is TEXT_SHORT_PX and not the paragraph floor, so such a list stays one table in a narrow pane.
// grow: the control column (1 to 3) that takes the width the list has to spare, so the text and the columns stay together and the extra width is a longer meter, not a gap.
// reveal: a row's end shows only while the row is pointed at or focused (History, Dependencies). It then holds no track: the last column ends on the
// rule's edge, as in a list without ends, and the end shows at the end of the first column, over no value (ui-actions.css, "uiList reveal").
// over this, a list is paged (lib/paged-list.mjs) or `windowed`
export const LIST_ROWS_MAX = 100;
export function uiList({ id, label, cols = [], cls, attrs, hook, head = '', rows = [], empty = '', text, grow, plain = false, reveal = false, windowed = false } = {}) {   // hook: a legacy class the view's handlers bind
  const cx = checker(`uiList() '${label}'`, null);
  if (!label) cx.report('needs a label');
  if (!Array.isArray(cols) || cols.length > COLS_MAX) cx.report(`cols lists 0 to ${COLS_MAX} control columns`);
  if (text != null && text !== 'short') cx.report(`text is 'short' (a list of one or two words per row) or left out (got ${JSON.stringify(text)})`);
  if (grow != null && !(Number.isInteger(grow) && grow >= 1 && grow <= (Array.isArray(cols) ? cols.length : 0))) cx.report(`grow names one of the list's control columns, 1 to ${Array.isArray(cols) ? cols.length : 0} (got ${JSON.stringify(grow)})`);
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((r, i) => {
    if (typeof r !== 'string' || !/class="[^"]*\bui-row\b/.test(r)) return;
    for (const c of cols) if (!new RegExp(`data-ui-col="${c}"`).test(r)) cx.report(`row ${i + 1} has no '${c}' cell. A control column exists for every row of a list or not at all`);
  });
  if (!list.length && !empty) cx.report('an empty list needs empty (the empty-state markup)');
  const drawn = list.filter(r => typeof r === 'string' && /class="[^"]*\bui-row\b/.test(r)).length;
  if (drawn > LIST_ROWS_MAX && !windowed) cx.report(`${drawn} rows, over ${LIST_ROWS_MAX}: page them`);
  const n = Array.isArray(cols) ? cols.length : 0;
  const html = `<div class="ui-list${[cls, hook].filter(Boolean).map(c => ' ' + esc(clsOf(c, cx, 'list'))).join('')}"${id ? ` id="${esc(id)}"` : ''} data-ui-ncols="${Math.min(n, COLS_MAX)}"${text === 'short' ? ' data-ui-text="short"' : ''}${grow != null ? ` data-ui-grow="${grow}"` : ''}${plain ? ' data-ui-plain' : ''}${reveal ? ' data-ui-reveal="end"' : ''} role="list" aria-label="${esc(label)}"${attrsOf(attrs, cx, 'list')}>${head}${list.length ? list.join('') : empty}</div>`;
  cx.done(); return html;
}

// ---- review items (CASE 3) ---------------------------------------------------------------------------------------------

const ACCEPT_MAX = 12;
export function uiReview(spec = {}) {
  const cx = checker(`uiReview() '${spec.id ?? '?'}'`, 'reviewItems');
  knownKeys(spec, ['id', 'kind', 'where', 'summary', 'state', 'open', 'acceptLabel', 'pending', 'body', 'done', 'dismissLabel', 'cls', 'attrs'], 'review', cx);
  if (!spec.id) cx.report('needs an id (it is data-i and aria-controls)');
  if (!spec.kind) cx.report(`needs a kind: the first line, for example 'Edit paragraph'`);
  const acceptLabel = spec.acceptLabel ?? 'Apply';
  if (acceptLabel.length > ACCEPT_MAX) cx.report(`acceptLabel '${acceptLabel}' is ${acceptLabel.length} characters; the fixed end track holds ${ACCEPT_MAX}. Shorten it`);
  const state = spec.state || 'open', id = String(spec.id ?? ''), open = !!spec.open;
  const kind = human(spec.kind), where = human(spec.where || ''), summary = human(spec.summary || '');
  const name = [kind, where].filter(Boolean).join(', ');
  const second = [where, summary].filter(Boolean).join(': ');
  const body = spec.body || '';
  const head = `<button type="button" class="ui-review-head" data-more aria-expanded="${open}" aria-controls="r-${esc(id)}">${icon('chevron-right', { size: 12 }).replace('class="ico"', 'class="ico ui-review-chev"')}<span class="ui-review-text"><span class="ui-review-kind">${esc(kind)}</span>${second ? `<span class="ui-review-where">${esc(second)}</span>` : ''}</span></button>`;
  const canAct = state === 'open';
  const buttons = canAct
    ? `${acceptLabel ? `<button type="button" class="ui-review-accept" data-accept${spec.pending ? ' aria-busy="true" data-ui-pending disabled' : ''} aria-label="${esc(`${acceptLabel}: ${name}`)}">${icon('check', { size: 12 })}<span>${esc(acceptLabel)}</span></button>` : ''}<button type="button" class="ui-review-dismiss" data-discard aria-label="${esc(`${spec.dismissLabel || 'Dismiss'}: ${name}`)}" title="${esc(spec.dismissLabel || 'Dismiss')}">${icon('close', { size: 12 })}</button>` : '';
  const done = spec.done ? `<div class="ui-review-done aid-done" role="status">${icon('check', { size: 12 })}<span>${esc(human(spec.done))}</span></div>` : '';
  const html = `<div class="ui-review aid-item${spec.cls ? ' ' + esc(clsOf(spec.cls, cx, 'review')) : ''}" data-state="${esc(state)}" data-i="${esc(id)}"${attrsOf(spec.attrs, cx, 'review')}>${head}${buttons ? `<span data-ui-slot="end">${buttons}</span>` : ''}`
    + `<div class="ui-review-body aid-more" id="r-${esc(id)}"${open ? '' : ' hidden'} role="group" aria-label="Preview of change">${body}</div>${done}</div>`;
  cx.done(); return html;
}
export const uiReviewList = ({ label, items = [], id } = {}) =>
  `<div class="ui-review-list"${id ? ` id="${esc(id)}"` : ''} role="group" aria-label="${esc(label || 'Suggested changes')}">${items.join('')}</div>`;

export function uiDecisionRow(spec = {}) {
  const cx = checker(`uiDecisionRow() '${spec.id ?? '?'}'`, 'decision');
  knownKeys(spec, ['id', 'kind', 'where', 'summary', 'choices', 'state'], 'decision', cx);
  if (!spec.id) cx.report('needs an id');
  const choices = Array.isArray(spec.choices) ? spec.choices : [];
  if (choices.length < 2 || choices.length > 3) cx.report(`a decision row has 2 or 3 choices (got ${choices.length})`);
  const text = [human(spec.where || ''), human(spec.summary || '')].filter(Boolean).join(': ');
  let bar = '';
  try {
    bar = uiBar({ kind: 'foot', label: `Decision: ${spec.kind || spec.id}`, id: `${spec.id}-choices`, equal: true, density: 'dense',
      actions: choices.map(c => ({ ...c, role: c.role && c.role !== 'primary' ? c.role : 'secondary', pressed: spec.state != null ? spec.state === c.id : c.pressed })) });
  } catch (e) { cx.report(e.message); }
  const html = `<div class="ui-review ui-decision" data-state="${esc(spec.state || 'open')}" data-i="${esc(spec.id)}"><div class="ui-review-text"><span class="ui-review-kind">${esc(human(spec.kind || ''))}</span>${text ? `<span class="ui-review-where">${esc(text)}</span>` : ''}</div>${bar}</div>`;
  cx.done(); return html;
}

export function uiBatchReview(spec = {}) {
  const cx = checker('uiBatchReview()', 'batch');
  knownKeys(spec, ['items', 'apply', 'dismiss', 'label', 'id'], 'batch', cx);
  const items = Array.isArray(spec.items) ? spec.items : [];
  if (!items.length) cx.report('needs items');
  if (!spec.apply || !spec.dismiss) cx.report('needs apply and dismiss (ActSpec each)');
  const rows = items.map(it => {
    const label = [human(it.kind || ''), human(it.where || '')].filter(Boolean).join(', ');
    const second = [human(it.where || ''), human(it.summary || '')].filter(Boolean).join(': ');
    return `<label class="ui-review ui-batch-item" data-i="${esc(it.id)}"><input type="checkbox"${it.check ? ' checked' : ''} aria-label="${esc(label)}"${it.id ? ` data-batch="${esc(it.id)}"` : ''}><span class="ui-review-text"><span class="ui-review-kind">${esc(human(it.kind || ''))}</span>${second ? `<span class="ui-review-where">${esc(second)}</span>` : ''}</span></label>`;
  }).join('');
  let foot = '';
  try { foot = uiBar({ kind: 'foot', label: spec.label || 'Review changes', actions: [{ role: 'secondary', ...spec.dismiss }, { role: 'primary', ...spec.apply }] }); } catch (e) { cx.report(e.message); }
  const html = `<div class="ui-batch"${spec.id ? ` id="${esc(spec.id)}"` : ''}><div class="ui-review-list" role="group" aria-label="${esc(spec.label || 'Changes to apply')}">${rows}</div>${foot}</div>`;
  cx.done(); return html;
}

// ---- one call to action (CASE 5) ----------------------------------------------------------------------------------------

/** The bar declaration behind a notice (uiNotice renders it; recipes and the library read it). */
export function noticeSpec(spec = {}) {
  const cx = checker(`uiNotice() '${String(spec.text ?? '').slice(0, 24)}'`, 'notice');
  knownKeys(spec, ['text', 'actions', 'dismissible', 'float', 'id', 'label'], 'notice', cx);
  if (!spec.text) cx.report('needs text');
  const acts = Array.isArray(spec.actions) ? spec.actions : [];
  if (acts.length > 2) cx.report(`a notice has at most 2 actions (got ${acts.length}). More than two is a decision, not a notice`);
  const base = spec.id || 'notice';
  const actions = acts.map(a => ({ role: 'secondary', ...a }));
  if (spec.dismissible) actions.push({ id: `${base}-dismiss`, label: 'Dismiss', icon: 'close', role: 'quiet', iconOnly: true, plain: true });   // a plain close icon, its name the tooltip
  cx.done();
  const out = { kind: 'head', label: spec.label || 'Notice', cls: 'ui-notice', lead: { text: human(spec.text), level: 'p' }, actions };
  if (spec.id) out.id = spec.id;
  if (spec.float) out.float = 'corner';
  return out;
}
export const uiNotice = spec => uiBar(noticeSpec(spec));
export const summarySpec = ({ text, action, id, label } = {}) =>
  noticeSpec({ id, label: label || 'Summary', text, actions: action ? [{ ...action, role: SUMMARY_ACTION_ROLE, icon: action.icon || 'proposals' }] : [] });
export const uiSummary = spec => uiBar(summarySpec(spec));
/** The one strip for a count of suggested edits, assistant and manuscript alike (spec 9.1). lib/manuscript-suggestions.mjs may wrap it. */
export const reviewSummarySpec = ({ count = 0, id = 'review-summary' } = {}) => {
  const n = Number(count) || 0;
  return { id, label: 'Suggested edits', text: `${n} suggested edit${n === 1 ? '' : 's'}`, action: { id: 'review-suggestions', label: 'Review', attrs: { 'data-review-suggestions': '', 'data-review': '' } } };
};
export const reviewSummary = opts => uiSummary(reviewSummarySpec(opts));

// ---- status line, status bar, settings row, composer ---------------------------------------------------------------------

/** `actions` are the line's real controls, pinned at its end beside any `trail` markup: quiet acts (an icon-only act sets iconOnly), never dropped. */
export function uiStatusLine({ id, parts = [], trail = '', actions = [], label } = {}) {
  const cx = checker(`uiStatusLine() '${id}'`, 'statusLine');
  idOk(id, cx, 'status line');
  const seen = new Set();
  const html = parts.map(p => {
    knownKeys(p, ['id', 'text', 'drop', 'ch', 'reserve', 'button', 'hidden', 'attrs'], `part '${p?.id}'`, cx);
    idOk(p.id, cx, 'part'); if (seen.has(p.id)) cx.report(`duplicate part id '${p.id}'`); seen.add(p.id);
    if (!(Number.isInteger(p.drop) && p.drop >= 0 && p.drop <= 9)) cx.report(`part '${p.id}': drop is 0..9 (9 leaves first)`);
    if (p.ch != null && !CH_STEPS.includes(p.ch)) cx.report(`part '${p.id}': ch ${p.ch} is not one of ${CH_STEPS.join(', ')}`);
    if (p.reserve != null && (typeof p.reserve !== 'string' || !p.reserve || p.ch != null)) cx.report(`part '${p.id}': reserve is the widest text the part will hold, in place of ch (a count that changes holds its slot, as wide as its widest text, with no hole before the separator)`);
    const at = `id="${esc(p.id)}" class="ui-statusline-part" data-ui-part data-ui-drop="${p.drop}"${p.ch != null ? ` data-ui-ch="${p.ch}"` : ''}${p.reserve ? ` data-ui-reserve="${esc(p.reserve)}"` : ''}${p.hidden ? ' hidden' : ''}${attrsOf(p.attrs, cx, `part '${p.id}'`)}`;
    return p.button ? `<button type="button" ${at}>${esc(human(p.text))}</button>` : `<span ${at}>${esc(human(p.text))}</span>`;
  }).join('');
  const tools = { kind: 'tools' };
  const acts = (actions || []).map(a => {
    const { iconOnly, ...spec } = a || {};
    const n = normAct({ role: 'quiet', ...spec }, { bar: tools, cx, where: 'member', role: 'quiet', display: iconOnly ? 'icon' : 'text' });
    return n ? actHtml(n, { bar: tools, member: true }, cx) : '';
  }).join('');
  const tail = `${acts}${trail}`;
  const out = `<div class="ui-statusline" id="${esc(id)}" data-ui-statusline role="group" aria-label="${esc(label || 'Status')}"><span class="ui-statusline-parts">${html}</span>${tail ? `<span class="ui-statusline-trail" data-ui-trail>${tail}</span>` : ''}</div>`;
  cx.done(); return out;
}

/** Shell footer: fixed leading slots that never fold, and items that fold into More by priority (9 leaves first). */
export function uiStatusBar({ id = 'statusbar', leading = [], items = [], label = 'Status' } = {}) {
  const cx = checker(`uiStatusBar() '${id}'`, 'statusBar');
  idOk(id, cx, 'status bar');
  const seen = new Set(), once = x => { if (seen.has(x)) cx.report(`duplicate id '${x}'`); seen.add(x); };
  const lead = leading.map(l => {
    knownKeys(l, ['id', 'text', 'ch', 'label'], `leading '${l?.id}'`, cx); idOk(l.id, cx, 'leading slot'); once(l.id);
    if (l.ch != null && !CH_STEPS.includes(l.ch)) cx.report(`leading '${l.id}': ch ${l.ch} is not one of ${CH_STEPS.join(', ')}`);
    return `<span class="ui-statusbar-slot" id="${esc(l.id)}" data-ui-fixed role="status"${l.label ? ` aria-label="${esc(l.label)}"` : ''}${l.ch != null ? ` data-ui-ch="${l.ch}"` : ''}>${esc(human(l.text ?? ''))}</span>`;
  }).join('');
  const acts = items.map(it => {
    knownKeys(it, ['id', 'label', 'priority', 'text', 'attrs'], `item '${it?.id}'`, cx); idOk(it.id, cx, 'item'); once(it.id);
    if (!it.label) cx.report(`item '${it.id}': needs a label`);
    const fold = it.priority ?? FOLD_DEFAULT.quiet;
    if (!(Number.isInteger(fold) && fold >= 0 && fold <= 9)) cx.report(`item '${it.id}': priority is 0..9 (9 leaves first)`);
    return `<button type="button" id="${esc(it.id)}" class="ui-act" data-ui-role="quiet" data-ui-kind="act" data-ui-fold="${fold}" title="${esc(it.label)}"${attrsOf(it.attrs, cx, `item '${it.id}'`)}><span class="ui-act-label">${esc(human(it.text ?? it.label))}</span></button>`;
  }).join('');
  const html = `<div class="ui-bar ui-statusbar" id="${esc(id)}" data-ui-bar="strip" data-ui-density="dense" data-ui-nostack role="group" aria-label="${esc(label)}">${lead ? `<div data-ui-slot="lead">${lead}</div>` : ''}${items.length ? `<div data-ui-slot="actions">${acts}${moreHtml({ end: true, empty: true })}</div>` : ''}</div>`;
  cx.done(); return html;
}

/**
 * A settings row: the name (and its one line of description) left, the controls right as a foot bar. Every row of a page sits on the
 * same two columns, so every control starts at one left edge. `readout: true` is a row that only states something (the description
 * carries it, `descId` makes it live) and has no controls; `attrs` passes the page's own hooks (data-find for its search) through.
 */
export function uiSettingsRow({ id, label, description = '', descId = '', line = false, attrs, readout = false, controls } = {}) {   // line: the description is one value (a path) that truncates with its full text as the tooltip, not prose that wraps
  const cx = checker(`uiSettingsRow() '${label}'`, 'settingsRow');
  if (!label) cx.report('needs a label');
  if (readout) { if (controls) cx.report('a readout row has no controls: give it controls or readout, not both'); }
  else if (!controls || typeof controls !== 'object') cx.report('needs controls: a bar spec of kind foot');
  if (descId) idOk(descId, cx, 'description');
  let bar = '';
  if (!readout) { try { bar = uiBar({ label, kind: 'foot', ...(controls || {}) }); } catch (e) { cx.report(e.message); } }
  const desc = description || descId ? `<span class="meta"${line ? ` data-ui-line title="${esc(description)}"` : ''}${descId ? ` id="${esc(descId)}" role="status"` : ''}>${esc(description)}</span>` : '';
  const html = `<div class="ui-settings-row"${id ? ` id="${esc(id)}"` : ''}${attrsOf(attrs, cx, 'settings row')}><div class="ui-settings-text"><span class="ui-settings-label">${esc(label)}</span>${desc}</div>${bar}</div>`;
  cx.done(); return html;
}

// tools: { start, actions }, the row in the box under the text (a foot bar: one act at its start, the rest beside Send); with it the composer is one box
// `head` ({ id, label }): a region inside the box above the text for what goes with the message (attached items; Plane, Gumloop), empty until filled.
export function uiComposer({ id, input, send, stop, tools = null, form = true, head = null } = {}) {
  const cx = checker(`uiComposer() '${id}'`, 'composer');
  idOk(id, cx, 'composer');
  knownKeys(input, ['id', 'label', 'placeholder', 'value', 'rows', 'maxlength'], 'composer input', cx);
  if (!input?.id || !input?.label) cx.report('input needs { id, label }');
  if (!send || !stop) cx.report('send and stop are both needed: they share one slot');
  let swap = '';
  try {
    const w = normSwap({ id: `${id}-slot`, members: [{ icon: 'run', role: 'primary', type: 'submit', ...send }, { icon: 'stop', role: 'primary', hidden: true, ...stop }] }, { bar: { kind: 'head' }, cx });
    swap = w ? swapHtml(w, { bar: { kind: 'head' }, top: false }, cx) : '';
  } catch (e) { cx.report(e.message); }
  const i = input || {};
  const tag = form ? 'form' : 'div';
  let row = '';
  if (tools) { try { row = uiBar({ kind: 'foot', density: 'dense', stack: false, plainMore: true, label: `${i.label || 'Message'} options`, id: `${id}-tools`, start: tools.start, actions: tools.actions || [] }); } catch (e) { cx.report(e.message); } }
  if (head && (!head.id || !head.label || !tools)) cx.report('head needs { id, label } and a boxed composer (tools)');
  const headHtml = head?.id && tools ? `<div class="ui-composer-head" id="${esc(head.id)}" role="group" aria-label="${esc(head.label)}"></div>` : '';
  const html = `<${tag} class="ui-composer"${tools ? ' data-ui-box' : ''} id="${esc(id)}">${headHtml}<textarea id="${esc(i.id)}" aria-label="${esc(i.label)}" rows="${Number(i.rows) || 1}"${i.placeholder ? ` placeholder="${esc(i.placeholder)}"` : ''}${i.maxlength ? ` maxlength="${Number(i.maxlength)}"` : ''}>${esc(i.value ?? '')}</textarea>${tools ? `<div class="ui-composer-under">${row}${swap}</div>` : swap}</${tag}>`;
  cx.done(); return html;
}

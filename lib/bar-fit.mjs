// The width engine: the only DOM code of the action system (action-system design, sections 3, 5.2, 5.3, 5.6, 6, 8, 10.3).
//
// bar-modes.mjs is pure: a bar's shape is a function of (measured natural widths, available width). This module is
// the other half. It finds every bar, list, status line and settings row in the document, measures each one once per
// content change, asks bar-modes.mjs which of the four modes (full, compact, folded, stacked) fits, and writes that answer
// as attributes. The CSS (ui-actions.css) does the rest; nothing here positions a control.
//
// ---------------------------------------------------------------------------------------------------------------
// WHY IT CANNOT LOOP (section 5.2; proved by app/test/bar-fit.test.mjs in a real browser, and shown to fail on seven
// injected faults: always writing, a wrong width, a feedback write, hysteresis, re-measuring per resize, no menu close,
// no focus handoff)
//
//   1. A bar's inline size does not depend on its children: `contain: inline-size` with a width the parent decides.
//      The shared ResizeObserver reads the inline size only (it also fires when only the block size changed, as it does
//      when a bar goes stacked; that callback finds the same width and does nothing), so writing a mode never produces
//      a size change that could be observed.
//   2. The engine writes only attributes it does not observe: data-ui-bar-mode, -label-off, -folded, -as, -cols, -empty,
//      -active, -message, -measure, -bar-problem, -mode (lists, settings rows), tabindex on roving controls, and
//      aria-describedby on More. The MutationObserver filter lists hidden, aria-pressed, aria-label, disabled and the
//      two adoption attributes, never one of those.
//   3. Measurement runs once per content change, never per resize. A resize tick is arithmetic on a cached ladder
//      (chooseFrom) followed by writes. A content change is detected by a signature of ids, roles, labels, font size and
//      font generation; the text of fixed slots (status, count, readout, ch, message) is not in it, so a count ticking
//      from 99 to 100 re-measures nothing. A font that finishes loading is a content change (the widths differ), so each
//      bar is measured a second time after its first font loads; that is the only repeat measure in a quiet page.
//   4. An attribute is written only when its value differs (put/del below), so a resize that keeps the same rung writes
//      nothing, and a resize that changes rung writes exactly the difference.
//   5. Content-change measurement is one requestAnimationFrame flush (or, for a bar that was not rendered when adopted,
//      the resize callback that shows it): it sets data-ui-measure on every dirty bar, reads every width, and removes the
//      attribute, all inside one task, so nothing paints between and the browser lays out once per phase for the whole
//      batch however many bars there are.
//   There is no hysteresis and no pin: with presence declared (reserve, swap, region) and variable text in fixed slots a
//   press or a tick changes neither the model nor the signature, so there is nothing to damp.
//
// THE DOM CONTRACT is the header of ui-actions.mjs. This module reads items from the direct children of the actions,
// lead and start slots by data-ui-kind, identifies them by data-ui-item, else id (a foldable check's id is its input's;
// an element with neither gets a private id that is never written to the DOM), skips any bar that carries
// data-ui-bar-skip or data-ui-float=popover, and measures with data-ui-measure and no mode. An item the view hid with
// display:none takes no room, so it is left out of the model, and the signature includes `hidden`, so showing it measures again.
// A bar with no [data-ui-more] cannot fold: its items are treated as keep.
//
// What each host gets
//   [data-ui-bar]       full | compact | folded | stacked, label-off, folded, view form, cols, message, More empty or active
//   .ui-list            data-ui-mode wide | narrow by rowMode, and data-ui-cols on each row's cells slot when narrow
//   .ui-statusline      parts leave by drop (dropParts); natural widths come from an off-screen copy, because the live line clips
//   .ui-settings-row    data-ui-mode narrow when the controls' share cannot hold its bar unfolded (and the text floor)
//   .ui-region          tracked only
//   [data-ui-width]     a box that asked for the width hook (ui-actions.mjs watchWidth): a bubbling-free `ui-width` event on it, in an animation
//                       frame, when its inline size changes and once when it first has one (a box in a closed <details> has none until it opens);
//                       data-ui-width="rows" (watchWidth with { rows: true }) also fires when its block size changes, and "now" ({ now: true }) runs the
//                       handler inside the resize delivery instead of the next frame
//
// Exports
//   startBars(document, opts)   start the engine (bar-boot.mjs does this once per page). Returns the controller.
//                               opts: { legacy: { adopt(root) }, ResizeObserver, MutationObserver, raf, onIdle }
//                               legacy.adopt(root) is called for every subtree the engine scans, before it looks for hosts: the
//                               adapter (step 0.9) tags existing containers there. A flat adopted bar (no slots) carries
//                               data-ui-kind, data-ui-role and data-ui-fold on its direct children.
//   wireBar(bar, {more, lines}) extra More entries built at click time; lines: status lines (elements or selectors) whose
//                               dropped parts lead the menu as read-only entries
//   focusControl(el, opts)      the only way a handler re-focuses a control that may be folded or overflow
//   wireReview(root)            keyboard for .ui-review heads (ArrowUp/Down between heads, Escape collapses); startBars wires the
//                               document, so a view needs no call
//   moreEntries(bar, lines)     the menu items built from the DOM (exported for tests)
//   signatureOf(bar)            the content signature (exported for tests)
//
// Events the engine dispatches (bubbling):
//   ui-bar-message-hidden  { text }   on the bar: its message region just became hidden for want of width; the shell raises the text once as a toast
//   ui-pick                { id, value, label }   on a picker's button: one of its declared options was chosen, from its own menu (the engine
//                                                 opens it on click, Enter, Space or ArrowDown unless the view opened one) or, folded, from More
//
// Focus (spec 3): when a rung change folds the focused item, focus moves to More and the item is remembered; when it unfolds
// while focus is still on More and no menu is open, focus returns to it. An open More menu is closed on any rung change.
// Toolbars ([role=toolbar]) are one tab stop with roving focus over their buttons and checkboxes; text inputs, selects and
// tablists keep their own tab stops and keys. The More menu and its submenus open inside the open <dialog> it was opened from:
// showMenu in menu.mjs mounts them there, the engine does not move them. The `.ui-view-pick` click is wired by responsive-switches.mjs, not here.
// A folded act that opens its own menu is clicked, and its menu opens at the folded button's place (the bar's trailing edge);
// building it as a submenu needs the act's items, which only the view has.
//
// Dev checks (section 10.3) run only when globalThis.__LYKOS_DEV__ is set (devserver.mjs injects it into the HTML it serves)
// and fill window.__bars.problems, mark data-ui-bar-problem, and console.error the kinds in FAIL_ON. undeclared-bar and
// double-more describe legacy markup the adapter will adopt, so they are collected and are not yet errors; a problem found
// on an adopted bar is a report, not an error. leaked-id belongs to the id package. The dev flag also installs a focus() guard
// (focus-lost). The shipped app starts the same engine without any of this.
//
// Cost, measured in headless Chromium (app/test/bar-fit.test.mjs prints it on every run): see the last test. A lazy
// IntersectionObserver fallback is not implemented: an unmeasured bar shows the fail-safe layout (one control per row), so
// measuring a bar only when it scrolls into view would change its height above the reading position, and WebKit has no
// scroll anchoring. Revisit only with a measurement that shows the bulk mount, not the per-bar cost, is the problem.
//
// Not measured (and so not claimed here): the Tauri WKWebView; contain:inline-size there; WebKit at all.
// ---------------------------------------------------------------------------------------------------------------
import { BarModelError, chooseFrom, dropParts, forcedFrom, ladder, modelOf, rowMode, stackPlan } from './bar-modes.mjs';
import { closeMenu, showMenu } from './menu.mjs';

// ---- vocabulary ---------------------------------------------------------------------------------------------------

export const HOSTS = '[data-ui-bar],.ui-list,.ui-region,.ui-statusline,.ui-settings-row,[data-ui-width]';
const ITEM_KINDS = ['act', 'group', 'picker', 'field', 'check', 'swap'];
const CONTROLS = 'button,input,select,textarea,[role=tab],[role=button]';
const RING = 'button,input[type=checkbox],input[type=radio],[role=button]';
export const LIST_MAIN_MIN = 160;                  // px of text a list row keeps beside its cells (the spec's text floor); ui-actions.css --ui-main-min is the same number
export const LIST_MAIN_SHORT = 80;                 // the floor of a list whose rows are a word or two (uiList text: 'short'); ui-actions.css has the same number
const ROWS_READ = 50;                              // rows whose cells are read to find a column's natural width
const FAIL_ON = new Set(['two-primaries', 'unknown-role', 'zero-width-bar', 'unmounted-bar', 'unnamed-control', 'nested-bar', 'shape-violation',
  'fits-false', 'focus-lost', 'model-error', 'compact-overflow', 'conditional-control', 'contract-overridden']);
const A = {
  mode: 'data-ui-bar-mode', off: 'data-ui-label-off', folded: 'data-ui-folded', as: 'data-ui-as', cols: 'data-ui-cols', empty: 'data-ui-empty',
  active: 'data-ui-active', message: 'data-ui-message', status: 'data-ui-status', short: 'data-ui-switch-short', measure: 'data-ui-measure', problem: 'data-ui-bar-problem', skip: 'data-ui-bar-skip',
  listMode: 'data-ui-mode', force: 'data-ui-bar-force',
};
const NEED_MEASURE = 1, NEED_SIGNATURE = 2;
const SPACING = [4, 8, 12, 16, 24, 32];                  // --s1 to --s6 (tokens.css)
const LIST_VARS = ['--ui-cmin-1', '--ui-cmin-2', '--ui-cmin-3', '--ui-check-pad'];

const STATE = new WeakMap();                       // element -> state
const EXTRAS = new WeakMap();                      // bar -> { more, lines }
const WIRED = new WeakSet();                       // elements that already carry the engine's listeners
const AUTO = new WeakMap();
let autoSeq = 0, fontGen = 0, current = null, focusDepth = 0;

const dev = () => !!globalThis.__LYKOS_DEV__;
const num = v => parseFloat(v) || 0;
const kids = el => (el ? [...el.children] : []);
const slotOf = (bar, name) => bar.querySelector(`:scope>[data-ui-slot="${name}"]`);
const autoId = el => { let id = AUTO.get(el); if (!id) { id = `auto-${++autoSeq}`; AUTO.set(el, id); } return id; };
const idOf = el => el.dataset?.uiItem || el.id || el.querySelector?.('[id]')?.id || autoId(el);
const rendered = el => el.getClientRects().length > 0;
/** Which items a bar draws, as 1 and 0 in DOM order: a view's own CSS (a width query that shows or hides a picker) changes it without any mutation. Only the items the model counts. */
const presenceOf = bar => { const a = bar.querySelector(':scope>[data-ui-slot=actions]'); return [...(a || bar).children].filter(e => ITEM_KINDS.includes(e.dataset.uiKind) && !e.hasAttribute('data-ui-overflow')).map(e => getComputedStyle(e).display === 'none' ? 0 : 1).join(''); };
const wd = el => el.getBoundingClientRect().width;
/**
 * What a path needs before the bar folds anything: its title whole up to 240px (a picker title: its words, padding and chevron) and "…" with
 * its chevron before it. The path gives up its middle and its first folder's words first (fitCrumbs); only a title wider than that ends in an
 * ellipsis.
 */
const crumbFloor = e => {
  const last = e.querySelector(':scope > .ui-crumb-last'), text = last?.querySelector('.ui-title-pick > span') || last;
  if (!last) return Math.min(Math.ceil(wd(e)), 96);
  const chrome = text === last ? 0 : wd(last) - wd(text);   // a picker's padding and chevron
  return Math.max(96, Math.min(240, Math.ceil(text.scrollWidth + chrome)) + 48);   // read from the title's own words, never from the room the path has now (a squeezed path would ask for less)
};
const labelOf = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
const tagOf = el => `${el.localName}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;

/** put/del write an attribute only when its value differs, and count the write (the proof reads these counters). */
function put(st, el, name, value) {
  if (el.getAttribute(name) === value) return false;
  el.setAttribute(name, value); st.stats.writes++; return true;
}
function del(st, el, name) {
  if (!el.hasAttribute(name)) return false;
  el.removeAttribute(name); st.stats.writes++; return true;
}

// ---- reading a bar ---------------------------------------------------------------------------------------------------

/**
 * The structure of a bar, read without layout: the BarSpec bar-modes.mjs validates, the elements it names, and what the
 * measure phases need. Items missing from the document are dropped later, when widths show they are not rendered.
 */
function describe(bar) {
  const lead = slotOf(bar, 'lead'), start = slotOf(bar, 'start'), actions = slotOf(bar, 'actions'), filters = slotOf(bar, 'filters'), status = slotOf(bar, 'status');
  const els = new Map(), more = bar.querySelector('[data-ui-more]');
  const realOverflow = !!bar.querySelector('[data-ui-overflow]:not([data-ui-kind=separator])');
  // a bar that keeps More's place (moreReserve: the title bar) counts it whether or not anything is in it, so More appearing never moves the switch before it
  const spec = { kind: bar.dataset.uiBar, items: [], hasOverflow: realOverflow || bar.hasAttribute('data-ui-reserve-more') };
  if (bar.hasAttribute('data-ui-nostack')) spec.stack = false;
  if (bar.hasAttribute('data-ui-equal')) spec.equal = true;
  const item = (el, slot) => {
    const role = el.dataset.uiRole === 'destructive' ? 'secondary' : el.dataset.uiRole;
    const fold = el.hasAttribute('data-ui-fold') ? Number(el.dataset.uiFold) : undefined;
    const it = { id: idOf(el), kind: el.dataset.uiKind, role, keep: el.hasAttribute('data-ui-keep') || !more };
    if (Number.isInteger(fold)) it.fold = fold;
    if (el.dataset.uiPresence === 'reserve') it.presence = 'reserve';
    if (slot) it.slot = slot;
    else if (el.hasAttribute('data-ui-tail')) it.slot = 'end';   // the bar's own end group (the title bar's panel toggles)
    els.set(it.id, el);
    return it;
  };
  const leadActs = [...kids(lead), ...kids(start)].filter(e => e.dataset.uiKind === 'act');
  const leadText = kids(lead).filter(e => !e.dataset.uiKind && !e.hasAttribute('data-ui-fixed'));
  const info = { bar, spec, els, more, lead, status, leadText, filters: [], views: [], fixed: [], pickers: [], actsCompact: [], realOverflow };
  if (leadText.length || leadActs.length) spec.lead = true;
  if (slotOf(bar, 'message') || start?.querySelector('.ui-bar-message')) spec.message = true;
  if (status) { spec.status = true; if (status.hasAttribute('data-ui-status-after')) spec.statusLast = true; }
  for (const e of leadActs) spec.items.push(item(e, 'lead'));
  const views = [...bar.querySelectorAll(':scope>[data-ui-slot=view]>.ui-view, :scope>[data-ui-slot=actions]>.ui-view')];   // a switch at the end stands among the actions (switchAt)
  for (const v of views) {
    const set = v.querySelector(':scope>.ui-view-set'), pick = v.querySelector(':scope>.ui-view-pick');
    if (!set || !pick) continue;
    const id = set.id || autoId(v);
    info.views.push({ id, el: v, set, pick });
  }
  if (info.views.length) spec.views = info.views.map(v => ({ id: v.id, n: v.set.querySelectorAll(':scope>button').length }));
  if (info.views.length && bar.hasAttribute('data-ui-switch-end')) spec.switchEnd = true;
  const fl = kids(filters);
  if (fl.length) {
    spec.filters = fl.map(e => ({ id: idOf(e), kind: FILTER_KIND(e) }));
    fl.forEach((e, i) => { info.filters.push({ id: spec.filters[i].id, kind: spec.filters[i].kind, el: e }); els.set(spec.filters[i].id, e); });
  }
  const flat = !actions;
  const itemEls = (flat ? kids(bar) : kids(actions)).filter(e => ITEM_KINDS.includes(e.dataset.uiKind) && !e.hasAttribute('data-ui-overflow'));
  for (const e of itemEls) spec.items.push(item(e));
  for (const e of bar.querySelectorAll('[data-ui-fixed]')) info.fixed.push(e);
  info.itemEls = itemEls;
  return info;
}
const FILTER_KIND = e => (['search', 'select', 'date', 'field', 'check'].includes(e.dataset.uiKind) ? e.dataset.uiKind : 'select');

/** Widths in measure mode (data-ui-measure set, no mode attribute). Everything here is a read. Returns the BarMeasured shape and the ids not rendered. */
function readWidths(info) {
  const { bar, spec, els, more } = info, cs = getComputedStyle(bar);
  const uiH = num(cs.getPropertyValue('--ui-h')) || 34, s4 = num(cs.getPropertyValue('--s4')) || 16;
  const gap = num(cs.columnGap);
  const measured = { gap, more: more ? Math.max(wd(more), 0) || uiH : uiH, items: {}, filters: {}, views: {} };
  const absent = new Set();
  if (spec.lead) {
    let floor = 0;
    for (const e of info.leadText) {
      if (!rendered(e)) continue;
      floor += e.matches('input,.ui-bar-title-input') ? 160 : e.matches('.ui-crumbs') ? crumbFloor(e) : Math.min(Math.ceil(wd(e)), 180);
    }
    measured.lead = floor;
  }
  if (spec.status) measured.status = wd(info.status);
  for (const v of info.views) {
    const btns = [...v.set.querySelectorAll(':scope>button')];
    measured.views[v.id] = { seg: wd(v.set), dd: wd(v.pick), btn: Math.max(0, ...btns.map(wd)), ...(info.spec.switchEnd ? { mn: uiH } : {}) };   // the end switch's last form: its chevron alone, one control wide
  }
  for (const f of info.filters) {
    if (!rendered(f.el)) { absent.add(f.id); continue; }
    const flexible = f.kind === 'search' || f.el.dataset.uiW === 'flex';
    measured.filters[f.id] = flexible ? num(getComputedStyle(f.el).minWidth) : wd(f.el);
  }
  for (const it of spec.items) {
    const el = els.get(it.id);
    if (!rendered(el)) { absent.add(it.id); continue; }
    const full = wd(el);
    let compact = null;
    // A labelled act that loses its label is exactly as wide as the bar's control (not measured); a picker is measured with its value clipped.
    // A head that never stacks (the title bar) may, at its very last rung, show its primary as its icon too: measured the same way.
    const lastPrimary = it.role === 'primary' && spec.lead && spec.stack === false;
    // an icon-only menu act is its icon and chevron: s4 wider than the square (ui-actions.css .ui-act-menu reads the same tokens)
    if (it.kind === 'act' && (it.role !== 'primary' || lastPrimary) && it.presence !== 'reserve' && el.querySelector(':scope>.ui-act-label') && el.querySelector(':scope>svg.ico')) compact = el.classList.contains('ui-act-menu') ? uiH + s4 : uiH;
    else if (it.kind === 'picker') info.pickers.push({ id: it.id, el });
    measured.items[it.id] = { full, compact: compact != null && compact >= full ? null : compact };
  }
  // An equal-column bar draws every action as wide as the widest (the CSS flex share is switched off while measuring, so the widths above are natural):
  // its need is n * the widest + gaps, and there is no label step because the labels never go.
  if (spec.equal) {
    const acts = spec.items.filter(it => it.slot !== 'lead' && measured.items[it.id]);
    const widest = Math.max(0, ...acts.map(it => measured.items[it.id].full));
    for (const it of acts) measured.items[it.id] = { full: widest, compact: null };
  }
  const fixed = info.fixed.filter(rendered).map(wd);
  if (fixed.length) measured.fixed = fixed;
  return { measured, absent, uiH };
}

/** Drops what is not rendered from the spec (an item the view hid with display:none takes no room, so the model must not count it). */
function prune(info, absent) {
  if (!absent.size) return;
  info.spec.items = info.spec.items.filter(it => !absent.has(it.id));
  if (info.spec.filters) { info.spec.filters = info.spec.filters.filter(f => !absent.has(f.id)); if (!info.spec.filters.length) delete info.spec.filters; }
  for (const id of absent) info.els.delete(id);
}

// ---- signature ---------------------------------------------------------------------------------------------------------

const FIXED_TEXT = '[data-ui-ch],.ui-count,.ui-readout,[data-ui-slot=status],[data-ui-slot=message],.ui-bar-message,[data-ui-fixed],[data-ui-part]';
const SIG_ATTRS = ['id', 'data-ui-kind', 'data-ui-role', 'data-ui-fold', 'data-ui-keep', 'data-ui-presence', 'data-ui-display', 'data-ui-item', 'data-ui-w', 'hidden', 'aria-label', 'type'];

/**
 * What a measurement depends on: ids, roles, labels, the text that has no fixed slot, computed font size and the font generation.
 * Not in it: the text of fixed slots, input values, and every attribute the engine writes.
 */
export function signatureOf(el) {
  const out = [fontGen, getComputedStyle(el).fontSize, el.dataset.uiBar || '', el.hasAttribute('data-ui-nostack') ? 'n' : '', el.hasAttribute('data-ui-equal') ? 'e' : '', el.dataset.uiDensity || ''];
  const walk = (node, fixed) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { if (!fixed) { const t = child.data.trim(); if (t) out.push(t); } continue; }
      if (child.nodeType !== 1 || child.localName === 'svg') continue;
      if (child.hasAttribute(A.skip) || (child.hidden && child.hasAttribute('data-ui-fixed'))) continue;
      let sig = child.localName;
      for (const a of SIG_ATTRS) { const v = child.getAttribute(a); if (v != null) sig += `|${a}=${v}`; }
      out.push(sig);
      walk(child, fixed || child.matches(FIXED_TEXT));
    }
  };
  walk(el, false);
  return out.join('␟');
}

function lineSignature(el) {
  const out = [fontGen, getComputedStyle(el).fontSize];
  for (const p of el.querySelectorAll('[data-ui-part]')) out.push(`${p.id}|${p.hidden ? 'h' : ''}|${p.dataset.uiDrop}|${p.hasAttribute('data-ui-ch') ? '' : p.textContent}`);
  const trail = el.querySelector('[data-ui-trail]');
  // each end control that is drawn, with the length of its words: a button that appears (a count of proposals) or changes its words is a new width
  if (trail) out.push(`trail|${[...trail.children].map(c => c.hidden ? '-' : c.textContent.length).join(',')}`);
  return out.join('␟');
}

// ---- states ----------------------------------------------------------------------------------------------------------------

function newState(el, kind) {
  return { el, kind, W: 0, need: NEED_MEASURE, sig: null, m: null, rungs: null, applied: null, struct: null, els: new Map(), spec: null, more: null,
    menu: null, restore: null, wOff: new Set(), wFolded: new Set(), wCols: new Set(), viewEls: [], stats: { measures: 0, applies: 0, writes: 0, measureWrites: 0, resizes: 0, roCallbacks: 0 },
    ring: null, activeEl: null, cache: null, last: null, hiddenMessage: false, waiting: false };
}

// ---- the engine -------------------------------------------------------------------------------------------------------------

export function startBars(doc = globalThis.document, opts = {}) {
  const win = doc?.defaultView;
  const RO = opts.ResizeObserver || win?.ResizeObserver, MO = opts.MutationObserver || win?.MutationObserver;
  if (!doc || !RO || !MO) return null;
  if (current && current.doc === doc) return current;
  const raf = opts.raf || (fn => win.requestAnimationFrame(fn));
  const states = new Set(), pending = new Set(), problems = [], seen = new Set(), checkQueue = new Set();
  let scheduled = false, checksScheduled = false, legacy = opts.legacy || null, flushes = 0, stopped = false;
  const addedRoots = [];
  const timing = { measureMs: 0, measured: 0, resizeMs: 0, resizeCalls: 0, phases: {} };
  const now = () => (globalThis.performance?.now ? globalThis.performance.now() : 0);

  // ---- problems (section 10.3) ---------------------------------------------------------------------------------------
  const barLabel = el => `${tagOf(el)}${el.getAttribute?.('aria-label') ? ` "${el.getAttribute('aria-label')}"` : ''}`;
  function report(el, kind, message, level) {
    const lvl = level || (FAIL_ON.has(kind) && !(el?.hasAttribute?.('data-ui-adopted') && ['contract-overridden', 'shape-violation', 'unnamed-control', 'conditional-control'].includes(kind)) ? 'error' : 'report');
    const key = `${kind}|${el ? barLabel(el) : ''}|${message}`;
    if (seen.has(key) || problems.length >= 500) return;
    seen.add(key);
    problems.push({ kind, level: lvl, bar: el ? barLabel(el) : '', message });
    if (el?.setAttribute) { const cur = new Set((el.getAttribute(A.problem) || '').split(' ').filter(Boolean)); cur.add(kind); el.setAttribute(A.problem, [...cur].join(' ')); }
    if (lvl === 'error') console.error(`[bars] ${kind}: ${el ? barLabel(el) : ''}: ${message}`);
    else if (kind === 'undeclared-bar') console.warn(`[bars] ${kind}: ${el ? barLabel(el) : ''}: ${message}. Declare it with uiBar() (recipes: lib/ui-recipes.mjs)`);
  }

  // ---- adoption -------------------------------------------------------------------------------------------------------------
  function skipped(el) { return el.hasAttribute(A.skip) || el.dataset.uiFloat === 'popover'; }
  function adopt(el) {
    if (stopped || !el.isConnected || STATE.has(el)) return STATE.get(el) || null;
    const kind = el.matches('[data-ui-bar]') ? 'bar' : el.matches('.ui-list') ? 'list' : el.matches('.ui-statusline') ? 'line' : el.matches('.ui-settings-row') ? 'row' : el.matches('.ui-region') ? 'region' : 'width';
    if (kind === 'bar' && skipped(el)) return null;
    const st = newState(el, kind);
    STATE.set(el, st); states.add(st);
    if (kind === 'region') return st;
    ro.observe(el, { box: 'content-box' });
    watchDetails(st);
    if (kind === 'width') return st;                    // nothing to measure: the box only hears its own width
    wire(st);
    if (kind === 'row') return st;                      // a settings row is decided from its bar's model and its width: nothing to measure
    need(st, NEED_MEASURE);
    if (dev() && kind === 'bar') checkQueue.add(st);
    return st;
  }
  function release(st) {
    ro.unobserve(st.el); states.delete(st); pending.delete(st); checkQueue.delete(st); STATE.delete(st.el);
    for (const d of st.details || []) { const set = DETAILS.get(d); set?.delete(st); if (set && !set.size) { DETAILS.delete(d); ro.unobserve(d); } }
    st.details = null;
    if (st.menu?.isConnected) closeMenu();
  }
  function need(st, flag) { st.need |= flag; pending.add(st); schedule(); }
  function schedule() { if (!scheduled && !stopped) { scheduled = true; raf(flush); } }

  function scan(root) {
    if (root.nodeType !== 1 || !root.isConnected) return;
    if (dev() && addedRoots.length < 200) { addedRoots.push(root); scheduleChecks(); }   // a region with a loose run of controls and no bar is checked too
    legacy?.adopt?.(root);
    if (root.matches(HOSTS)) adopt(root);
    for (const e of root.querySelectorAll(HOSTS)) adopt(e);
  }
  function unscan(root) {
    if (root.nodeType !== 1) return;
    const list = root.matches(HOSTS) ? [root, ...root.querySelectorAll(HOSTS)] : [...root.querySelectorAll(HOSTS)];
    for (const e of list) { const st = STATE.get(e); if (st && !e.isConnected) release(st); }
  }
  function hostOf(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    const host = el?.closest?.('[data-ui-bar],.ui-list,.ui-statusline');
    return host ? STATE.get(host) : null;
  }
  function touch(node) { const st = hostOf(node); if (st) need(st, st.kind === 'bar' || st.kind === 'line' ? NEED_SIGNATURE : NEED_MEASURE); }

  const mo = new MO(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.removedNodes) unscan(n);
        for (const n of r.addedNodes) scan(n);
        touch(r.target);
      } else if (r.type === 'attributes') {
        const t = r.target;
        if (r.attributeName === 'data-ui-width') {
          const st = STATE.get(t);
          if (t.hasAttribute('data-ui-width')) { if (!st) adopt(t); } else if (st?.kind === 'width') release(st);
        } else if (r.attributeName === 'data-ui-bar' || r.attributeName === A.skip) {
          const st = STATE.get(t);
          if (st && skipped(t)) release(st); else if (!st && t.hasAttribute('data-ui-bar')) adopt(t);
        } else touch(t);
      } else touch(r.target);
    }
  });

  // ---- measure and apply ------------------------------------------------------------------------------------------------
  const readW = el => {
    const cs = getComputedStyle(el);
    return Math.round(wd(el) - num(cs.paddingLeft) - num(cs.paddingRight) - num(cs.borderLeftWidth) - num(cs.borderRightWidth));
  };

  /** Measure a batch: every write of one phase before every read of it, so the browser lays out once per phase, not once per bar. */
  function runMeasure(batch) {
    const t0 = now(), bars = [], lists = [], lines = [];
    followFonts();                                  // measured while a font is loading: measure again once it is in
    for (const st of batch) {
      if (!st.el.isConnected) { release(st); continue; }
      st.need = 0; pending.delete(st);
      if (!rendered(st.el)) { st.waiting = true; continue; }       // a closed dialog or a hidden pane: its resize observer fires when it shows
      st.waiting = false;
      (st.kind === 'bar' ? bars : st.kind === 'list' ? lists : lines).push(st);
    }
    const lap = name => { const t = now(); timing.phases[name] = (timing.phases[name] || 0) + (t - tl); tl = t; };
    let tl = now();
    // phase 0: reads of the settled layout
    for (const st of [...bars, ...lists, ...lines]) if (!(st.W > 0)) st.W = readW(st.el);
    lap('width');
    for (const st of bars) { st.info = describe(st.el); st.sigNow = signatureOf(st.el); }      // the signature reads computed style: take it while style is clean
    lap('describe');
    // ---- bars: phase A writes
    for (const st of bars) {
      const { bar, info } = { bar: st.el, info: st.info };
      bar.removeAttribute(A.mode);
      bar.setAttribute(A.measure, ''); st.stats.measureWrites++;
      info.moreWasEmpty = !!info.more && info.more.hasAttribute(A.empty);
      if (info.moreWasEmpty) info.more.removeAttribute(A.empty);
      for (const e of info.itemEls) if (e.matches('.ui-picker') && e.hasAttribute(A.off)) e.removeAttribute(A.off);
    }
    for (const st of lists) {
      st.rows = st.el.querySelector(':scope>.ui-row') != null; if (!st.rows) continue;
      st.el.setAttribute(A.listMode, 'wide');
      st.grow = st.el.getAttribute('data-ui-grow');                         // the column that takes the spare width is read at its natural width, then given the width back
      if (st.grow != null) st.el.removeAttribute('data-ui-grow');
      for (const c of st.el.querySelectorAll(':scope>.ui-row>[data-ui-slot=cells][data-ui-cols]')) c.removeAttribute(A.cols);
      for (const v of LIST_VARS) st.el.style.removeProperty(v);            // natural widths: no cell is held to a shrunk track
    }
    lap('measure-writes');
    // ---- phase A reads
    for (const st of bars) { const r = readWidths(st.info); st.read = r; }
    for (const st of lists) st.read = st.rows ? readList(st) : { empty: true };
    // a list with visual cells (a meter and its count) is read again with those cells at their minimum width: the narrowest the list can be drawn wide
    const shrinkable = lists.filter(st => st.rows && st.read.cells?.length && st.el.querySelector(':scope>.ui-row>[data-ui-slot=cells]>[data-ui-cell=visual]'));
    for (const st of shrinkable) st.el.setAttribute(A.measure, '');
    for (const st of shrinkable) st.read.min = readList(st).cells;
    for (const st of shrinkable) st.el.removeAttribute(A.measure);
    for (const st of lists) if (st.grow != null) { st.el.setAttribute('data-ui-grow', st.grow); st.grow = null; }
    lap('measure-reads');
    // ---- phase B (pickers clipped to their compact value)
    const withPickers = bars.filter(st => st.read.measured.items && st.info.pickers.length);
    for (const st of withPickers) for (const p of st.info.pickers) p.el.setAttribute(A.off, '');
    for (const st of withPickers) for (const p of st.info.pickers) {
      const m = st.read.measured.items[p.id];
      const compact = wd(p.el);
      m.compact = compact < m.full ? compact : null;
    }
    for (const st of withPickers) for (const p of st.info.pickers) p.el.removeAttribute(A.off);
    // ---- phase C writes: leave measure mode
    for (const st of bars) { st.el.removeAttribute(A.measure); st.stats.measureWrites++; st.stats.measures++; }
    lap('measure-cleanup');
    // ---- models and apply (writes)
    for (const st of bars) { try { buildModel(st); } catch (e) { report(st.el, 'model-error', `the engine threw while mounting: ${e?.message || e}`); } }
    lap('model-and-apply');
    for (const st of lists) { st.stats.measures++; applyList(st, true); }
    for (const st of lines) { measureLine(st); applyLine(st); }
    for (const st of bars) { st.info = null; st.read = null; if (dev()) checkQueue.add(st); }
    if (dev() && checkQueue.size) scheduleChecks();
    timing.measureMs += now() - t0; timing.measured += bars.length + lists.length + lines.length;
  }

  function buildModel(st) {
    const { info, read } = st;
    prune(info, read.absent);
    st.spec = info.spec; st.els = info.els; st.more = info.more; st.uiH = read.uiH; st.realOverflow = info.realOverflow;
    st.viewEls = info.views.map(v => v.el);
    st.slots = { filters: slotOf(st.el, 'filters'), actions: slotOf(st.el, 'actions') };
    let t = now();
    st.sig = st.sigNow; st.sigNow = null;
    st.applied = null;                                 // the measure phase removed the attributes: write them all again (st.struct stays, so a rung change still closes an open menu)
    try {
      st.m = modelOf(info.spec, read.measured);
      st.rungs = ladder(st.m);
    } catch (e) {
      st.m = null; st.rungs = null;
      report(st.el, 'model-error', e instanceof BarModelError ? e.problems.join('; ') : String(e.message || e));
      return;
    }
    timing.phases.model = (timing.phases.model || 0) + (now() - t); t = now();
    applyBar(st, true);
    st.presence = presenceOf(st.el);
    timing.phases.apply = (timing.phases.apply || 0) + (now() - t);
    const row = st.el.closest('.ui-settings-row'), rs = row && STATE.get(row);
    if (rs) applyRow(rs);
  }

  // ---- settings rows (spec 12): text left and controls right, the controls beneath the text when the right half cannot hold them ----
  function applyRow(st) {
    const bar = st.el.querySelector('[data-ui-bar]'), bst = bar && STATE.get(bar);
    if (!bst?.rungs || !(st.W > 0)) return;
    if (st.gap == null) st.gap = num(getComputedStyle(st.el).columnGap);
    const open = bst.rungs.filter(r => r.mode !== 'stacked' && !r.folded.length), need = (open.length ? open.at(-1) : bst.rungs.at(-1)).need;
    // the text takes two fifths of the row and never less than its floor (ui-actions.css: minmax(160px, 2fr) minmax(0, 3fr)); the controls get the rest
    const room = st.W - st.gap, half = room - Math.max(LIST_MAIN_MIN, room * 0.4);
    st.want = half >= need ? 'wide' : 'narrow';
    // The rows of one page share one shape: when any of them must put its controls beneath its text, all of them do, so the controls of a
    // page never start at two edges. A row alone in its parent decides for itself.
    const rows = [...(st.el.parentElement?.children || [])].filter(e => e.matches?.('.ui-settings-row')), mode = rows.some(e => STATE.get(e)?.want === 'narrow') ? 'narrow' : 'wide';
    for (const e of rows) { const rs = STATE.get(e); if (rs) { rs.last = { ...rs.last, mode }; put(rs, e, A.listMode, mode); } }
    st.last = { mode, need, half };
    st.stats.applies++;
  }

  /** The cheap path: arithmetic on the cached ladder, then attribute writes that differ. Runs on every resize tick of a mounted bar. */
  function applyBar(st, force) {
    const { el: bar, m, rungs } = st;
    if (!m || !(st.W > 0)) return false;
    const r = (dev() && bar.hasAttribute(A.force) && forcedFrom(rungs, m, bar.getAttribute(A.force), st.W)) || chooseFrom(rungs, m, st.W);   // data-ui-bar-force: the component page previews a mode (dev flag only)
    st.last = r;
    const plan = r.mode === 'stacked' ? stackPlan(m, st.W, r) : null;
    const colsOf = slot => plan?.find(b => b.slot === slot)?.cols;
    const structKey = [r.mode, r.labelsOff.join(), r.folded.join(), r.views.join(), r.status ?? '', r.switchShort ? 's' : ''].join('|');   // the title bar's last rungs differ only by the status
    const key = `${structKey}|${colsOf('filters') ?? ''}|${colsOf('actions') ?? ''}|${r.message ?? ''}`;
    if (!force && st.applied === key) return false;
    const doc = bar.ownerDocument, structural = st.struct !== structKey;
    // an open More menu is closed on any rung change; focus returns to More, which is never empty while a menu is open
    if (structural && st.struct != null && st.menu?.isConnected) { closeMenu({ restoreFocus: true }); st.menu = null; }
    else if (st.menu && !st.menu.isConnected) st.menu = null;
    const active = doc.activeElement;
    let focusedId = null;
    if (active && active !== bar && bar.contains(active)) { const it = active.closest('[data-ui-kind]'); if (it && bar.contains(it)) focusedId = idOf(it); }
    st.stats.applies++;
    put(st, bar, A.mode, r.mode);
    st.viewEls.forEach((v, i) => put(st, v, A.as, r.views[i] ?? 'segmented'));
    const setOf = (ids, written, attr) => {
      const want = new Set(ids.map(id => st.els.get(id)).filter(Boolean));
      for (const e of written) if (!want.has(e)) { del(st, e, attr); written.delete(e); }
      for (const e of want) { put(st, e, attr, ''); written.add(e); }
    };
    setOf(r.labelsOff, st.wOff, A.off);
    setOf(r.folded, st.wFolded, A.folded);
    for (const e of st.wCols) if (!plan) { del(st, e, A.cols); st.wCols.delete(e); }
    if (plan) for (const [slot, el] of Object.entries(st.slots)) { const c = colsOf(slot); if (el && c != null) { put(st, el, A.cols, String(c)); st.wCols.add(el); } }
    if (st.more) { if (r.folded.length || st.realOverflow) del(st, st.more, A.empty); else put(st, st.more, A.empty, ''); }
    if (r.message === 'hidden') {
      if (put(st, bar, A.message, 'hidden') && !st.hiddenMessage) {
        st.hiddenMessage = true;
        const text = (slotOf(bar, 'message') || bar.querySelector('.ui-bar-message'))?.textContent.trim();
        if (text) bar.dispatchEvent(new win.CustomEvent('ui-bar-message-hidden', { bubbles: true, detail: { text } }));
      }
    } else { del(st, bar, A.message); st.hiddenMessage = false; }
    if (r.status === 'hidden') put(st, bar, A.status, 'hidden'); else del(st, bar, A.status);   // the title bar's last rungs (bar-modes ladder)
    if (r.switchShort) put(st, bar, A.short, ''); else del(st, bar, A.short);
    st.applied = key; st.struct = structKey;
    // focus: an item that just folded hands focus to More; an item that unfolded takes it back while focus has not moved on
    const folded = new Set(r.folded);
    if (focusedId != null && folded.has(focusedId) && st.more) { focusWithin(st.more); st.restore = focusedId; }
    else if (st.restore != null && !folded.has(st.restore)) {
      if (doc.activeElement === st.more && !st.menu?.isConnected) { const back = st.els.get(st.restore); if (back) focusWithin(focusTarget(back)); }
      st.restore = null;
    }
    const t = now();
    syncRoving(st);
    syncMore(st);
    timing.phases.sync = (timing.phases.sync || 0) + (now() - t);
    if (dev()) { checkQueue.add(st); scheduleChecks(); }
    return true;
  }

  /** More carries data-ui-active while a folded or overflow entry is pressed or opens a panel, and a hidden description names them. */
  function syncMore(st) {
    const more = st.more; if (!more) return;
    const bar = st.el, names = [];
    const press = e => e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-expanded') === 'true';
    for (const e of bar.querySelectorAll('[data-ui-folded],[data-ui-overflow]')) {
      const hot = e.matches('[data-ui-folded]') ? [e, ...e.querySelectorAll('[aria-pressed],[aria-expanded]')].filter(press) : press(e) ? [e] : [];
      for (const h of hot) names.push(labelOf(h));
    }
    if (names.length) {
      put(st, more, A.active, '');
      const id = `${more.id || bar.id || `bar-${autoId(bar)}`}-active`;
      let d = more.ownerDocument.getElementById(id);
      if (!d) { d = more.ownerDocument.createElement('span'); d.id = id; d.hidden = true; d.setAttribute('data-ui-fixed', ''); more.after(d); }
      const text = `Active: ${names.join(', ')}`;
      if (d.textContent !== text) d.textContent = text;
      put(st, more, 'aria-describedby', id);
    } else { del(st, more, A.active); del(st, more, 'aria-describedby'); }
  }

  // ---- roving focus: every [role=toolbar] bar is one tab stop ------------------------------------------------------------
  // A member with no box (the view switch's dropdown button while the segments show, or the reverse) is not in the ring: an arrow key
  // that landed on it would focus nothing and the ring would stop there.
  const ringOf = bar => [...bar.querySelectorAll(RING)].filter(e => !e.disabled && e.getClientRects().length > 0 && !e.closest('[data-ui-folded],[data-ui-overflow],[hidden],.ui-swap-sizer,[role=tablist]')
    && !(e.matches('[data-ui-more]') && e.hasAttribute(A.empty)) && e.type !== 'hidden');
  function syncRoving(st) {
    if (st.kind !== 'bar' || st.el.getAttribute('role') !== 'toolbar') return;
    const ring = ringOf(st.el);
    st.ring = ring;
    if (!ring.length) return;
    if (!st.activeEl || !ring.includes(st.activeEl)) st.activeEl = ring.find(e => e.getAttribute('tabindex') === '0') || ring[0];
    for (const e of ring) put(st, e, 'tabindex', e === st.activeEl ? '0' : '-1');
  }

  // ---- lists (section 6) -----------------------------------------------------------------------------------------------------
  function readList(st) {
    const list = st.el, rows = [...list.querySelectorAll(':scope>.ui-row')].slice(0, ROWS_READ);
    const cols = Number(list.dataset.uiNcols) || 0, cs = getComputedStyle(list);
    if (!rows.length) return { empty: true };
    const rcs = getComputedStyle(rows[0]);
    const check = Math.max(0, ...rows.map(r => { const c = r.querySelector('.ui-row-check'); return c ? wd(c) : 0; }));
    const cells = Array.from({ length: cols }, (_, i) => Math.max(0, ...rows.map(r => { const c = r.querySelectorAll(':scope>[data-ui-slot=cells]>*')[i]; return c ? wd(c) : 0; })));
    const end = Math.max(0, ...rows.map(r => { const e = r.querySelector(':scope>[data-ui-slot=end]'); return e ? wd(e) : 0; }));
    return { gap: num(cs.columnGap), pad: num(rcs.paddingLeft) + num(rcs.paddingRight), check, cells, end };
  }
  function applyList(st, fresh) {
    const list = st.el;
    if (fresh) st.cache = st.read && !st.read.empty ? st.read : null;
    st.read = null;
    const c = st.cache;
    if (!c || !(st.W > 0)) return;
    const res = rowMode({ width: st.W - c.pad, gap: c.gap, check: c.check + (c.check ? c.gap : 0), main: list.dataset.uiText === 'short' ? LIST_MAIN_SHORT : LIST_MAIN_MIN, cells: c.cells, end: c.end, min: c.min });
    st.last = res;
    st.stats.applies++;
    put(st, list, A.listMode, res.mode);
    // custom properties the grid reads (ui-actions.css): the narrowest each shrinkable column may take, and where narrow cells start (under the text, after the check column)
    const vars = {};
    if (c.min) c.cells.forEach((w, i) => { if (c.min[i] < w - 0.5) vars[`--ui-cmin-${i + 1}`] = `${Math.ceil(c.min[i])}px`; });
    if (c.check) vars['--ui-check-pad'] = `${SPACING.find(t => t >= c.check + c.gap) ?? Math.ceil(c.check + c.gap)}px`;     // the next step of the spacing scale (4 8 12 16 24 32): a padding is never a measured 26
    for (const v of LIST_VARS) { if (vars[v] != null) { if (list.style.getPropertyValue(v) !== vars[v]) { list.style.setProperty(v, vars[v]); st.stats.writes++; } } else if (list.style.getPropertyValue(v)) { list.style.removeProperty(v); st.stats.writes++; } }
    for (const cell of list.querySelectorAll(':scope>.ui-row>[data-ui-slot=cells]')) {
      if (res.mode === 'narrow' && c.cells.length) put(st, cell, A.cols, String(res.cols)); else del(st, cell, A.cols);
    }
  }

  // ---- status lines (section 5.6) ------------------------------------------------------------------------------------------
  /** Natural part widths come from an off-screen copy: the live line is clipped to its width, and its fixed-slot parts shrink with it. */
  function measureLine(st) {
    const line = st.el, copy = line.cloneNode(true), d = line.ownerDocument;
    copy.removeAttribute('id'); for (const e of copy.querySelectorAll('[id]')) e.removeAttribute('id');
    for (const e of copy.querySelectorAll(`[${A.folded}]`)) e.removeAttribute(A.folded);
    copy.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inline-size:max-content;max-inline-size:none;overflow:visible';
    const host = line.parentElement || d.body;
    host.append(copy);
    const partsEl = copy.querySelector('.ui-statusline-parts') || copy;
    partsEl.style.cssText = 'overflow:visible;inline-size:max-content';
    for (const e of copy.querySelectorAll('[data-ui-part]')) e.style.flex = 'none';
    // a reserved part (a count that changes) is measured holding its widest text and not the frozen width it was given before
    for (const e of copy.querySelectorAll('[data-ui-reserve]')) { e.style.inlineSize = ''; e.textContent = e.getAttribute('data-ui-reserve'); }
    const real = [...line.querySelectorAll('[data-ui-part]')], dup = [...copy.querySelectorAll('[data-ui-part]')];
    const parts = [];
    dup.forEach((p, i) => { if (real[i].hidden) return; parts.push({ id: real[i].id, w: Math.ceil(wd(p)), drop: Number(real[i].dataset.uiDrop) || 0, reserve: real[i].hasAttribute('data-ui-reserve') }); });
    const trail = copy.querySelector('[data-ui-trail]');
    st.cache = { parts, trail: trail ? Math.ceil(wd(trail)) : 0, gap: num(getComputedStyle(partsEl).columnGap) || 8 };
    copy.remove();
    st.sig = lineSignature(line); st.stats.measures++;
  }
  function applyLine(st) {
    const c = st.cache; if (!c || !(st.W > 0)) return;
    const res = dropParts({ parts: c.parts, trail: c.trail, gap: c.gap, W: st.W });
    st.last = res; st.stats.applies++;
    const hide = new Set(res.hidden);
    for (const p of st.el.querySelectorAll('[data-ui-part]')) { if (hide.has(p.id)) put(st, p, A.folded, ''); else del(st, p, A.folded); }
    // a reserved part holds the width of its widest text whatever its text becomes, so a count that changes moves nothing after it
    for (const m of c.parts) if (m.reserve) { const p = st.el.querySelector(`[data-ui-part][id="${m.id}"]`); if (p && p.style.inlineSize !== `${m.w}px`) p.style.inlineSize = `${m.w}px`; }
  }

  // ---- the flush: one animation frame reads everything it needs, then writes ------------------------------------------------
  function flush() {
    scheduled = false; flushes++;
    if (stopped) return;
    const batch = [...pending];
    const measure = [];
    for (const st of batch) {
      if (!st.el.isConnected) { release(st); continue; }
      if (st.kind === 'bar' && skipped(st.el)) { release(st); continue; }
      const stale = [...st.els.values()].some(e => !e.isConnected);
      if (st.need & NEED_MEASURE) { measure.push(st); continue; }
      if (st.kind === 'list') { measure.push(st); continue; }
      const sig = st.kind === 'line' ? lineSignature(st.el) : signatureOf(st.el);
      if (st.sig == null || sig !== st.sig) { measure.push(st); continue; }
      // same signature: nothing to measure. Rebuild the element map when the view re-rendered equal markup, and re-apply what the new nodes lack.
      st.need = 0; pending.delete(st);
      if (st.kind === 'bar' && stale) { const info = describe(st.el); st.els = info.els; st.more = info.more; st.viewEls = info.views.map(v => v.el); st.slots = { filters: slotOf(st.el, 'filters'), actions: slotOf(st.el, 'actions') }; st.wOff.clear(); st.wFolded.clear(); st.wCols.clear(); applyBar(st, true); }
      if (st.kind === 'bar') { syncMore(st); syncRoving(st); }
    }
    if (measure.length) runMeasure(measure);
    if (!pending.size) opts.onIdle?.();
  }

  // An item that a width query of the view shows or hides (the Library's collection picker below 760px) changes what the model must count, and no
  // mutation says so. After a resize tick each bar's drawn items are compared with what its model was measured with, outside the resize delivery
  // (reading style there would not be free), and a difference measures the bar again: the shape at a width then does not depend on the widths
  // the bar passed through (design P7).
  const presenceQueue = new Set();
  let presenceTick = false;
  function checkPresence() {
    presenceTick = false;
    for (const st of presenceQueue) if (st.m && st.el.isConnected && st.presence !== presenceOf(st.el)) need(st, NEED_MEASURE);
    presenceQueue.clear();
  }

  // A box that asked for the width hook hears its width in a frame of its own, never inside the delivery: its handler writes a height.
  const widthQueue = new Set();
  let widthTick = false;
  function widthFlush() {
    widthTick = false;
    for (const st of [...widthQueue]) { widthQueue.delete(st); if (!stopped && st.el.isConnected && STATE.get(st.el) === st) st.el.dispatchEvent(new win.CustomEvent('ui-width')); }
  }

  // WebKit keeps a list's grid rows at their old height when its width changes (wrapped text spills): size them again next frame
  const rq = new Set();
  const retrack = el => { if (!rq.size) raf(() => { for (const e of rq) { const b = e.style.gridAutoRows; e.style.gridAutoRows = 'min-content'; void e.offsetHeight; e.style.gridAutoRows = b; } rq.clear(); }); rq.add(el); };

  /** One width arrived for a host (from the shared observer, or read after its <details> changed): the same arithmetic on the cached ladder. */
  function onWidth(st, w, rebuild, h) {
    st.stats.roCallbacks++;
    // a box that asked for its rows (watchWidth with { rows: true }) hears a change of height too
    const flags = st.kind === 'width' ? (st.el.getAttribute('data-ui-width') || '').split(/\s+/) : [];
    const rowsChanged = flags.includes('rows') && h != null && h !== st.H;
    if (st.kind === 'width' && h != null) st.H = h;
    if (w === st.W && !rowsChanged) return;
    st.W = w; st.stats.resizes++;
    if (!(w > 0)) return;
    if (st.kind === 'width') {
      // 'now': the handler runs inside this delivery, before the frame paints (a shell that lays out panes by the width: the layout and the bars it holds settle in one frame)
      if (flags.includes('now')) st.el.dispatchEvent(new win.CustomEvent('ui-width'));
      else { widthQueue.add(st); if (!widthTick) { widthTick = true; raf(widthFlush); } }
      return;
    }
    if (st.kind === 'bar') { if (st.m) { applyBar(st, false); presenceQueue.add(st); if (!presenceTick) { presenceTick = true; raf(checkPresence); } } else if (st.waiting || !st.sig) rebuild.push(st); }
    else if (st.kind === 'list') { retrack(st.el); if (st.cache) applyList(st, false); else rebuild.push(st); }
    else if (st.kind === 'row') applyRow(st);
    else if (st.cache) applyLine(st); else rebuild.push(st);
  }

  // A closed <details> lays out nothing inside, so its hosts hear no resize: the details is watched and, while closed, a change of its width
  // (or opening it) reads its hosts' widths again.
  const DETAILS = new Map();                                  // a <details> -> the hosts inside it
  const detailsW = new WeakMap();
  function watchDetails(st) {
    for (let d = st.el.closest('details'); d; d = d.parentElement?.closest('details')) {
      let set = DETAILS.get(d);
      if (!set) { set = new Set(); DETAILS.set(d, set); ro.observe(d, { box: 'content-box' }); }
      set.add(st); (st.details ||= new Set()).add(d);
    }
  }
  function syncDetails(d) {
    const rebuild = [];
    for (const st of DETAILS.get(d) || []) if (st.el.isConnected && st.kind !== 'region') onWidth(st, Math.round(readW(st.el)), rebuild);
    if (rebuild.length) runMeasure(rebuild);
  }
  const onToggle = e => { const d = e.target; if (d?.open && DETAILS.has(d)) syncDetails(d); };
  doc.addEventListener('toggle', onToggle, true);

  const ro = new RO(entries => {
    const t0 = now(), rebuild = [];
    for (const e of entries) {
      const box = Array.isArray(e.contentBoxSize) ? e.contentBoxSize[0] : e.contentBoxSize;      // an array in current engines, a single object in older ones
      const w = Math.round(box?.inlineSize ?? e.contentRect.width);
      const st = STATE.get(e.target);
      if (!st) {
        const d = e.target;
        if (DETAILS.has(d) && !d.open && detailsW.get(d) !== w) { detailsW.set(d, w); syncDetails(d); }
        continue;
      }
      onWidth(st, w, rebuild, Math.round(box?.blockSize ?? e.contentRect.height));
    }
    // a bar that was not rendered when it was adopted (a dialog, a hidden pane) is measured now, before this frame paints
    if (rebuild.length) runMeasure(rebuild);
    timing.resizeMs += now() - t0; timing.resizeCalls++;
  });

  // ---- listeners ---------------------------------------------------------------------------------------------------------
  function wire(st) {
    const el = st.el;
    if (WIRED.has(el)) return;
    WIRED.add(el);
    if (st.kind !== 'bar') return;
    el.addEventListener('click', e => {
      const more = e.target.closest?.('[data-ui-more]');
      if (!more || !el.contains(more) || more.hasAttribute(A.empty)) return;
      e.preventDefault(); openMore(st, more);
    });
    // A picker that declares its options opens them itself (Enter and Space are its click). A view that opens a menu of its own from the
    // picker's click keeps it: its handler runs between these two listeners, and the menu it opened or closed changed aria-expanded.
    const pickerAt = e => { const p = e.target.closest?.('.ui-picker[data-ui-options]'); return p && el.contains(p) && !p.closest(`[${A.folded}],[data-ui-overflow]`) ? p : null; };
    let expandedBefore = null;
    el.addEventListener('click', e => { const p = pickerAt(e); expandedBefore = p ? p.getAttribute('aria-expanded') : null; }, true);
    el.addEventListener('click', e => {
      const p = pickerAt(e), before = expandedBefore; expandedBefore = null;
      if (!p || e.defaultPrevented || p.getAttribute('aria-expanded') !== before) return;
      openPicker(p);
    });
    el.addEventListener('keydown', e => {
      const more = e.target.closest?.('[data-ui-more]');
      if (more && el.contains(more) && e.key === 'ArrowDown' && !e.altKey) { e.preventDefault(); openMore(st, more); return; }
      const pick = pickerAt(e);
      if (pick && e.key === 'ArrowDown' && !e.altKey && pick.getAttribute('aria-expanded') !== 'true') { e.preventDefault(); pick.click(); return; }
      if (el.getAttribute('role') !== 'toolbar' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (!st.ring?.includes(t)) return;                               // inputs, selects and tablists keep their own keys
      const rtl = getComputedStyle(el).direction === 'rtl';
      const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : 0;
      if (!next) return;
      e.preventDefault();
      const ring = ringOf(st.el), i = ring.indexOf(t);
      const to = next === 'first' ? ring[0] : next === 'last' ? ring.at(-1) : ring[(i + next + ring.length) % ring.length];
      focusWithin(to);
    });
    el.addEventListener('focusin', e => {
      if (el.getAttribute('role') !== 'toolbar' || !st.ring?.includes(e.target) || st.activeEl === e.target) return;
      st.activeEl = e.target; syncRoving(st);
    });
  }

  function openPicker(p) {
    const rows = pickerChoices(p);
    if (rows?.length) showMenu(p, rows, { focusChecked: true });
  }

  function openMore(st, more) {
    const extras = EXTRAS.get(st.el);
    const lines = (extras?.lines || []).map(l => (typeof l === 'string' ? st.el.ownerDocument.querySelector(l) : l)).filter(Boolean);
    const items = moreEntries(st.el, lines);
    const add = typeof extras?.more === 'function' ? extras.more() : [];
    if (add?.length) items.push('-', ...add);
    if (!items.length) return;
    const stacked = st.el.getAttribute(A.mode) === 'stacked';
    st.menu = showMenu(more, items, { align: stacked ? 'start' : 'end', matchWidth: stacked });
  }

  // ---- dev checks (section 10.3) -------------------------------------------------------------------------------------------
  function scheduleChecks() { if (!checksScheduled && !stopped) { checksScheduled = true; raf(() => { checksScheduled = false; runChecks(); }); } }
  function runChecks() {
    if (!dev()) { checkQueue.clear(); addedRoots.length = 0; return; }
    // A bar that has never been measured is not unmounted yet: its first measure is still queued. This callback can run before that flush in the
    // same frame (it was scheduled earlier than the flush), and a bar in a dialog that opened in the task it was added in reaches its first width only
    // when the resize observer delivers, after every animation-frame callback. Such a bar stays queued and is checked once it has been measured.
    for (const st of [...checkQueue]) {
      if (!st.el.isConnected || st.kind !== 'bar') { checkQueue.delete(st); continue; }
      if (st.sig == null) continue;
      checkQueue.delete(st);
      checkBar(st);
    }
    for (const root of addedRoots.splice(0)) if (root.isConnected) checkUndeclared(root);
  }
  function checkBar(st) {
    const bar = st.el;
    if (!rendered(bar)) return;
    if (!bar.hasAttribute(A.mode) && !problems.some(p => p.kind === 'model-error' && p.bar === barLabel(bar))) report(bar, 'unmounted-bar', 'no data-ui-bar-mode a frame after adoption: the fail-safe layout (one control per row) is showing');
    if (st.W === 0 && Math.round(wd(bar)) === 0) report(bar, 'zero-width-bar', 'the bar is zero wide. It must sit in a block, a grid cell, or a flex item with flex:1 1 0 and min-width:0 (an inline-flex parent shrink-wraps it to nothing)');
    if (bar.parentElement?.closest('[data-ui-bar]')) report(bar, 'nested-bar', 'a bar inside a bar. One region has one bar; use uiRegion for alternatives');
    const items = st.spec ? st.spec.items : [];
    const primaries = [...bar.querySelectorAll('[data-ui-role=primary]')].filter(e => !e.closest('[data-ui-overflow]') && !e.parentElement.closest('.ui-swap'));
    const prim = items.filter(i => i.role === 'primary').length || primaries.length;
    if (prim > 1) report(bar, 'two-primaries', `${prim} primaries. Make one secondary or move it to overflow`);
    for (const e of kids(slotOf(bar, 'actions'))) if (e.dataset.uiRole && !['primary', 'secondary', 'quiet'].includes(e.dataset.uiRole)) report(bar, 'unknown-role', `${tagOf(e)} has role '${e.dataset.uiRole}'. A bar item is primary, secondary or quiet; a destructive act is an overflow entry`);
    for (const e of bar.querySelectorAll(CONTROLS)) {
      if (e.closest('[data-ui-overflow],[hidden],.ui-swap-sizer') || e.type === 'hidden') continue;
      const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title') || e.textContent.trim() || e.labels?.length || (e.type === 'checkbox' && e.closest('label')?.textContent.trim());
      if (!named) report(bar, 'unnamed-control', `${tagOf(e)} has no accessible name`);
    }
    for (const e of kidsOfItems(bar)) if (e.hasAttribute('hidden') && !e.matches('.ui-swap>*,[data-ui-overflow],[data-ui-fixed]')) report(bar, 'conditional-control', `${tagOf(e)} is hidden by its view. An item that appears or disappears is a swap member, presence:'reserve' or an overflow entry; pressing it must not move another control`);
    const mode = bar.getAttribute(A.mode);
    if (mode && mode !== 'stacked') {
      const cs = getComputedStyle(bar);
      if (cs.display.includes('flex') && cs.flexWrap !== 'nowrap') report(bar, 'contract-overridden', `flex-wrap is ${cs.flexWrap}: a legacy rule is fighting the contract`);
      const shown = kidsOfItems(bar).filter(e => !e.hasAttribute(A.folded) && !e.hasAttribute('data-ui-overflow') && !e.hidden && rendered(e));
      // a head pushes its whole trailing cluster to the end from its first visible action; a foot from its first action
      const headPush = bar.dataset.uiBar === 'head' ? shown.find(x => x.matches('[data-ui-slot=actions]>*')) : null;
      for (const e of shown) {
        const ecs = getComputedStyle(e);
        if (ecs.order !== '0') report(bar, 'contract-overridden', `${tagOf(e)} has order ${ecs.order}`);
        if (!e.hasAttribute('data-ui-end') && e !== headPush && !(bar.dataset.uiBar === 'foot' && e.matches('[data-ui-slot=actions]>:first-child')) && (num(ecs.marginLeft) !== 0 || num(ecs.marginRight) !== 0)) report(bar, 'contract-overridden', `${tagOf(e)} has margin ${ecs.marginLeft} ${ecs.marginRight}`);
      }
      const ys = shown.map(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
      if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > (st.uiH || 34) / 2) report(bar, 'shape-violation', `controls in one row differ in vertical centre by ${Math.round(Math.max(...ys) - Math.min(...ys))}px`);
      // a slot with no width at all is a bar caught between two layouts (a pane opening, a resize frame), not an icon wider than its slot
      for (const e of bar.querySelectorAll(`[${A.off}]`)) if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && !e.matches('.ui-picker')) report(bar, 'compact-overflow', `${tagOf(e)} keeps content wider than its icon-only slot (${e.scrollWidth} > ${e.clientWidth})`);
    }
    if (st.last && st.last.fits === false) report(bar, 'fits-false', `no rung fits ${st.W}px (the narrowest needs ${st.rungs.at(-1).need}px)`);
    const mores = [...bar.querySelectorAll('button[aria-haspopup=menu]')].filter(b => !b.hasAttribute('data-ui-more') && /^more(\s+actions)?$/i.test(labelOf(b)));
    if (mores.length) report(bar, 'double-more', 'a hand-built More beside the engine More', 'report');
  }
  const kidsOfItems = bar => [...kids(slotOf(bar, 'actions')), ...kids(slotOf(bar, 'lead')), ...kids(slotOf(bar, 'start')), ...kids(slotOf(bar, 'filters'))];
  function checkUndeclared(root) {
    const controls = e => kids(e).filter(c => c.matches('button,select,input:not([type=hidden]),[role=tab]') && rendered(c)).length;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (e.closest('.ui-bar,[data-ui-bar],.menu,table,dialog>:first-child,.ui-list,.ui-statusline,svg,.ui-region,.ui-review,.ui-tabs,[data-ui-slot=end]')) continue;
      const n = controls(e);
      if (n < 2) continue;
      // three controls are a bar whatever their parent is; two buttons are a bar when the parent lays them out (a Cancel and Save pair placed by hand)
      const cs = getComputedStyle(e), laid = /flex|grid/.test(cs.display) && kids(e).filter(c => c.matches('button,[role=button]') && rendered(c)).length >= 2;
      if (n >= 3 || cs.flexWrap === 'wrap' || laid) report(e, 'undeclared-bar', `${n} direct controls outside any bar`, 'report');
    }
  }

  // ---- fonts -------------------------------------------------------------------------------------------------------------
  // A font that finishes loading changes every text width, so every bar is measured again. `loadingdone` is not dependable: WebKit starts a load
  // ('loading' fires) and never dispatches it for a page whose third face stays unused, leaving a bar measured with the fallback font for good. So a
  // load in progress (an event, or a measure taken while the set says loading) is also followed through `fonts.ready`; one of the two settles it.
  let fontsPending = false;
  const onFonts = () => { fontGen++; for (const st of states) { if (st.kind === 'bar' || st.kind === 'list' || st.kind === 'line') need(st, NEED_SIGNATURE); if (st.kind === 'list') retrack(st.el); } };
  const fontsSettled = () => { if (!fontsPending || stopped) return; fontsPending = false; onFonts(); };
  const followFonts = () => { if (fontsPending || !doc.fonts || doc.fonts.status !== 'loading') return; fontsPending = true; doc.fonts.ready.then(fontsSettled); };
  const onFontsDone = () => { fontsPending = true; fontsSettled(); };
  doc.fonts?.addEventListener?.('loading', followFonts);
  doc.fonts?.addEventListener?.('loadingdone', onFontsDone);
  followFonts();

  // ---- the benign loop notice ---------------------------------------------------------------------------------------------
  // Going stacked changes a bar's height, and the shared observer sees that too: the browser then reports "ResizeObserver loop
  // completed with undelivered notifications" (WebKit does, as an error event). The notification is delivered in the next frame
  // and finds the same inline size, so nothing is lost and nothing loops; the notice is the only symptom, and it is filtered here
  // so that it is not read as a page error. Any other error passes through untouched.
  const onError = e => { if (/^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/.test(e.message || '')) { e.stopImmediatePropagation(); e.preventDefault(); } };
  win.addEventListener('error', onError, true);

  // ---- start -----------------------------------------------------------------------------------------------------------
  mo.observe(doc, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['hidden', 'aria-pressed', 'aria-label', 'disabled', 'data-ui-bar', 'data-ui-width', A.skip] });
  scan(doc.documentElement);
  wireReview(doc);

  const api = {
    doc, states, problems, report, timing,
    adopt, legacy: m => { legacy = m; scan(doc.documentElement); },
    /** Runs the pending flush now (tests, and callers that must read the mounted result). */
    flush() { if (scheduled || pending.size) { scheduled = false; flush(); } return api; },
    /** Resolves when a frame has passed with nothing left to measure, or after max ms. */
    settle(max = 3000) {
      const end = Date.now() + max;
      return new Promise(resolve => { const tick = () => raf(() => raf(() => ((pending.size || scheduled) && Date.now() < end ? tick() : resolve()))); tick(); });
    },
    stop() { stopped = true; mo.disconnect(); ro.disconnect(); doc.removeEventListener('toggle', onToggle, true); win.removeEventListener('error', onError, true); doc.fonts?.removeEventListener?.('loading', followFonts); doc.fonts?.removeEventListener?.('loadingdone', onFontsDone); if (current === api) current = null; },
    stats() {
      const out = { bars: 0, lists: 0, lines: 0, rows: 0, measures: 0, applies: 0, writes: 0, measureWrites: 0, resizes: 0, roCallbacks: 0, flushes };
      const bucket = { bar: 'bars', list: 'lists', line: 'lines', row: 'rows' };
      for (const st of states) {
        if (bucket[st.kind]) out[bucket[st.kind]]++;
        for (const k of ['measures', 'applies', 'writes', 'measureWrites', 'resizes', 'roCallbacks']) out[k] += st.stats[k];
      }
      return out;
    },
    /** What the engine decided, per mounted bar: the model, its width, and the rung it applied. The sweep recomputes choose() from this. */
    models() {
      return [...states].filter(s => s.kind === 'bar' && s.m).map(s => ({ el: s.el, id: s.el.id || null, label: s.el.getAttribute('aria-label'), kind: s.el.dataset.uiBar, W: s.W, m: s.m,
        applied: { mode: s.el.getAttribute(A.mode), labelsOff: [...s.wOff].map(idOf), folded: [...s.wFolded].map(idOf), message: s.el.getAttribute(A.message) }, stats: { ...s.stats } }));
    },
    stateOf: el => STATE.get(el) || null,
    /** Runs the dev checks on one bar now (dev flag only). The sweep and the tests call it after they have changed something. */
    check(el) { const st = STATE.get(el); if (st && dev() && st.kind === 'bar') checkBar(st); return problems; },
  };
  current = api;
  if (dev()) { win.__bars = api; installFocusGuard(win); }
  return api;
}

// ---- measured fits that are not a bar ---------------------------------------------------------------------------------------------

/**
 * The rows fit: a vertical list (the sidebar's page list) that cannot show every row ends on a whole row. First it compacts (`tight` class on the list),
 * then, if rows still overflow, it is cut at the bottom edge of the last row that fits (max-height), so a row is never half shown. `rows` selects the
 * rows; the caller scrolls the list and redraws its cue. Call it again whenever the list's room or content changes (watchWidth(el, fn, { rows: true })).
 */
export function cutRows(list, rows, { tight = 'tight' } = {}) {
  list.classList.remove(tight); list.style.removeProperty('max-height');
  if (list.hidden) return;
  const over = () => list.scrollHeight > list.clientHeight + 1;
  if (over()) list.classList.add(tight);
  if (over()) {
    const room = list.clientHeight, top = list.getBoundingClientRect().top - list.scrollTop;
    let end = 0;
    for (const r of list.querySelectorAll(rows)) { const b = r.getBoundingClientRect().bottom - top; if (b <= room) end = Math.max(end, b); }
    if (end > 0) list.style.setProperty('max-height', `${Math.ceil(end + 2)}px`);
  }
}

/** Whether a box (or anything inside it) shows text cut with an ellipsis: a tooltip then carries the whole wording. */
export function clippedBox(el) {
  return [el, ...el.querySelectorAll('*')].some(x => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).textOverflow === 'ellipsis');
}

/** A window-level breakpoint (the shell's rail): the MediaQueryList, so the shell reads `.matches` and listens for `change`. Window sizes are the engine's to read. */
export function windowQuery(query, win = globalThis) { return win.matchMedia(query); }

// ---- focus ----------------------------------------------------------------------------------------------------------------------

/** Resolves once the engine has measured and applied what a redraw just added (a bar's form, a view switch's dropdown); at once when no engine runs. */
export function barsSettled() { return current ? current.settle() : Promise.resolve(); }

/** The element inside an item that takes focus: the item itself when it is a control, else its first enabled control (a group, a reserve wrapper, a swap). */
function focusTarget(el) {
  if (el.matches(CONTROLS) && !el.disabled) return el;
  return [...el.querySelectorAll('button,input,select,textarea,[role=tab]')].find(e => !e.disabled && !e.closest('[hidden],.ui-swap-sizer') && e.type !== 'hidden') || el;
}
function focusWithin(el, options = { preventScroll: true }) { focusDepth++; try { el.focus(options); } finally { focusDepth--; } }

/**
 * The only way a handler re-focuses a control that may be folded or overflow (spec 3). If the control is rendered it
 * is focused. If it sits in a folded item or an overflow entry, its bar's More is focused instead, and the control's
 * item is remembered so that focus returns to it if it unfolds while focus is still on More. Returns the element focused.
 */
export function focusControl(el, options = { preventScroll: true }) {
  if (!el) return null;
  const bar = el.closest?.('[data-ui-bar]');
  const hidden = el.closest?.('[data-ui-folded],[data-ui-overflow]');
  const invisible = !hidden && el.checkVisibility && el.checkVisibility({ visibilityProperty: true }) === false;
  if (bar && (hidden || invisible)) {
    const more = bar.querySelector('[data-ui-more]');
    if (more) {
      const st = STATE.get(bar), item = hidden?.closest('[data-ui-kind]') || (hidden && hidden.hasAttribute('data-ui-folded') ? hidden : null) || el.closest('[data-ui-kind]');
      if (more.hasAttribute(A.empty)) more.removeAttribute(A.empty);
      if (st && item) st.restore = idOf(item);
      focusWithin(more, options);
      return more;
    }
  }
  focusWithin(el, options);
  return el;
}

// ---- the More menu, built from the DOM at click time ---------------------------------------------------------------------------

const pressed = e => (e.hasAttribute('aria-pressed') ? { checked: e.getAttribute('aria-pressed') === 'true', checkType: 'checkbox' } : {});
const click = e => () => e.click();

function parseOptions(el) {
  try { const raw = JSON.parse(el.getAttribute('data-ui-options') || 'null'); return Array.isArray(raw) ? raw.map(o => (Array.isArray(o) ? { value: o[0], label: String(o[1] ?? o[0]) } : { value: o, label: String(o) })) : null; } catch { return null; }
}

/**
 * A picker's declared options as menu rows: the row whose label is the shown value is checked (none when the value is not a choice, a zoom
 * of the reader's own reading "Custom"), and every row, the checked one too, dispatches ui-pick: choosing the current fit again re-fits.
 */
export function pickerChoices(el) {
  const options = parseOptions(el);
  if (!options) return null;
  const value = el.querySelector('.ui-picker-value')?.textContent.trim() || '';
  return options.map(o => ({ label: o.label, checked: o.label === value, checkType: 'radio',
    run: () => el.dispatchEvent(new el.ownerDocument.defaultView.CustomEvent('ui-pick', { bubbles: true, detail: { id: el.id, value: o.value, label: o.label } })) }));
}

/** Menu entries for one folded item (a group contributes its members). Returns { entries, group }. */
function entriesOf(el) {
  const kind = el.dataset.uiKind;
  if (kind === 'group') {
    const entries = [...el.querySelectorAll('button[data-ui-member]')].filter(b => !b.hidden).map(b => ({ label: labelOf(b), disabled: b.disabled, run: click(b), ...pressed(b) }));
    return { entries, group: true };
  }
  if (kind === 'picker') {
    const options = pickerChoices(el), value = el.querySelector('.ui-picker-value')?.textContent.trim() || '';
    const label = el.getAttribute('title') || labelOf(el);
    if (options) return { entries: [{ label, meta: value, disabled: el.disabled, submenu: options }] };
    return { entries: [{ label, meta: value, disabled: el.disabled, run: click(el) }] };
  }
  if (kind === 'check') {
    const input = el.matches('input') ? el : el.querySelector('input[type=checkbox]');
    return { entries: input ? [{ label: labelOf(el.matches('label') ? el.querySelector('span') || el : el), checked: input.checked, checkType: 'checkbox', disabled: input.disabled, run: click(input) }] : [] };
  }
  const button = el.matches('button') ? el : el.querySelector('button:not([hidden])');
  if (!button || button.hidden) return { entries: [] };
  return { entries: [{ label: labelOf(button), disabled: button.disabled, run: click(button), ...pressed(button) }] };
}

/**
 * The menu behind More, from the DOM as it is now: dropped status-line parts (read-only), the folded items in full-mode
 * order (a group contributes its members, with a separator on each side), then the overflow entries (the builder put
 * destructive ones last, after a separator). Every entry clicks the real button, so handlers bound by id still fire.
 */
export function moreEntries(bar, lines = []) {
  const out = [];
  const dropped = lines.flatMap(l => [...l.querySelectorAll('[data-ui-part][data-ui-folded]')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean));
  for (const t of dropped) out.push({ label: t, disabled: true });
  if (out.length) out.push('-');
  const folded = [...bar.querySelectorAll('[data-ui-folded]')];
  let prevGroup = null;
  for (const el of folded) {
    const { entries, group } = entriesOf(el);
    if (!entries.length) continue;
    if (out.length && out.at(-1) !== '-' && (group || prevGroup)) out.push('-');
    out.push(...entries); prevGroup = !!group;
  }
  const overflow = [...bar.querySelectorAll('[data-ui-overflow]')];
  if (overflow.length && out.length && out.at(-1) !== '-') out.push('-');
  for (const el of overflow) {
    const kind = el.dataset.uiKind;
    if (kind === 'separator') { out.push('-'); continue; }
    if (kind === 'readonly') { out.push({ label: el.textContent.trim(), disabled: true }); continue; }
    if (kind === 'select') {
      const opts = [...el.options];
      out.push({ label: labelOf(el), meta: opts.find(o => o.selected)?.textContent.trim(), disabled: el.disabled,
        submenu: opts.map(o => ({ label: o.textContent.trim(), checked: o.selected, checkType: 'radio', run: () => { el.value = o.value; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); } })) });
      continue;
    }
    out.push({ label: labelOf(el), disabled: el.disabled, danger: el.hasAttribute('data-ui-danger') || el.hasAttribute('data-danger'), run: click(el), ...(kind === 'toggle' ? pressed(el) : {}) });
  }
  return out;
}

/** Extra More entries, built at click time (the workflow transfer commands). `lines` are status lines whose dropped parts lead the menu. */
export function wireBar(bar, { more, lines } = {}) {
  if (!bar) return bar;
  EXTRAS.set(bar, { more, lines });
  current?.adopt(bar);
  return bar;
}

// ---- review items (spec 8, keyboard) --------------------------------------------------------------------------------------------

const REVIEW_WIRED = new WeakSet();
/**
 * Keyboard for .ui-review lists: the head is the disclosure (Enter and Space click it natively), ArrowUp and ArrowDown move
 * between the heads of a list, Escape collapses the expanded item and returns focus to its head. startBars wires the whole
 * document, so a view needs no call; wireReview(root) on a smaller root is then a no-op.
 */
export function wireReview(root) {
  if (!root || REVIEW_WIRED.has(root)) return root;
  const doc = root.ownerDocument || root;
  if (root !== doc && REVIEW_WIRED.has(doc)) return root;
  REVIEW_WIRED.add(root);
  root.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (!t?.closest) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const head = t.closest('.ui-review-head');
      if (!head || head !== t) return;
      const scope = head.closest('.ui-review-list') || head.closest('[data-ui-review-root]') || doc;
      const heads = [...scope.querySelectorAll('.ui-review-head')].filter(h => !h.disabled && !h.closest('[hidden]'));
      const i = heads.indexOf(head), to = heads[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (to) { e.preventDefault(); focusWithin(to); }
    } else if (e.key === 'Escape') {
      const item = t.closest('.ui-review'), head = item?.querySelector(':scope>.ui-review-head');
      if (!item || !head || head.getAttribute('aria-expanded') !== 'true') return;
      e.preventDefault(); e.stopPropagation();
      head.click();                                   // the view owns the expansion state; the click is how it collapses
      focusWithin(head);
    }
  });
  return root;
}

// ---- dev: a focus() on a folded or overflow control is a bug (section 10.3, focus-lost) -----------------------------------------------

/** Installed by startBars only when the dev flag is set, so the shipped app never wraps a built-in. */
function installFocusGuard(win) {
  const proto = win.HTMLElement?.prototype;
  if (!proto || proto.__uiFocusGuard) return;
  const original = proto.focus;
  Object.defineProperty(proto, '__uiFocusGuard', { value: true });
  proto.focus = function focus(...args) {
    if (focusDepth === 0 && current && this.closest?.('[data-ui-folded],[data-ui-overflow]')) {
      const bar = this.closest('[data-ui-bar]');
      if (bar) current.report(bar, 'focus-lost', `${this.localName}${this.id ? `#${this.id}` : ''} is folded or overflow and was focused directly. Use focusControl(el)`);
    }
    return original.apply(this, args);
  };
}

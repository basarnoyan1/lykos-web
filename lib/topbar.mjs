// The title bar: one head bar, owned by the shell, and the head of every page (TOPBAR plan R1-R10).
//
// A view does not draw a page head, a page title or a page-level view switch, and it does not place anything in the title bar.
// It declares its page, as data:
//
//   export function page(rerender) {
//     return { title: 'Notifications',                                  // always drawn: the page's one h1 (14/600)
//              titleMenu: anchor => ..., titleNoun: 'collection',             // optional: the title is a picker, its tooltip 'Switch collection'
//              status: { text: '3 unread', ch: 12 },                    // the page's count or state, a reserved slot beside the title
//              view: { id: 'nf-filter', label: 'Show', value: 'unread', items: [['unread', 'Unread'], ['all', 'All']], run: key => ... },
//              back: { label: 'Back to Tables and figures', run: () => ... },   // a sub-page: a plain chevron before the title
//              actions: [{ id: 'nf-read-all', label: 'Mark all read', icon: 'check', role: 'quiet', run: () => ... }],   // three at most
//              overflow: [{ id: 'nf-mute', label: 'Mute background completions', kind: 'toggle', checked: false, run: () => ... }] };
//   }
//
// `actions` are ActSpecs of ui-actions.mjs (menu acts carry a chevron), `overflow` entries are the bar's More and `run` is the handler:
// the shell strips it before the builder sees the spec and binds it to the built button by id, so a button that is folded into More
// still fires it. `titleMenu(anchor)` makes the title a picker. A view switch has two to five peers that choose what the page shows;
// more than five is a list pane or a title picker. The view's contextual checks are overflow entries too (the shell adds them), so the
// bar keeps one shape at every width: it folds into More and never adds a row. The two panel toggles are reserved icon slots.
//
// Every view declares `page`; one that does not is a BarSpecError in dev (the title is never taken from `meta.title` any more).
//
// The bar element is built once and its children replaced on every draw, so the engine keeps measuring the same bar.
import { uiBar, barEl, fitCrumbs, BarSpecError, isStrict, syncBarAttrs, menuAnchor } from './ui-actions.mjs';
import { showMenu } from './menu.mjs';

/** A page declares three acts at most beside More and the inspector (R4; lint T18 holds the literal declarations). */
export const PAGE_ACTS_MAX = 3;
/** A view switch in the title bar chooses among two to five peers (R5). */
export const PAGE_VIEW_MAX = 5;

// The inspector toggle and More are plain icons: no border and no fill at rest, a fill when pointed at or pressed (ui-actions.css). The bar's right
// cluster is fixed (Component review 2026-10-21, item 2): the page's acts (secondary, quiet, then the one primary), More, the inspector toggle.
const INSPECTOR = { id: 'insp-btn', label: 'Inspector', icon: 'inspector', role: 'quiet', plain: true, presence: 'reserve', keep: true, trail: true, kbd: '⌥⌘I', pressed: false };
// Find (`find: { pressed, run }`) is a toggle in More, never a glyph; ⌘F still opens the page's search row.
const FIND = { id: 'page-find', label: 'Find', kind: 'toggle' };
const findAct = f => (f ? [{ ...FIND, ...(f.label ? { label: f.label } : {}), checked: !!f.pressed, ...(f.disabled ? { disabled: true } : {}) }] : []);   // a page may name what it finds in (Files: Find in folder)
const MODEL_ACTIONS = { id: 'aid-btn', label: 'Assistant actions', attrs: { 'aria-haspopup': 'menu' } };
const aidEntry = st => (st.aidOn ? [MODEL_ACTIONS, '-'] : []);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripRun = list => (list || []).map(x => (x && typeof x === 'object' ? (({ run, ...spec }) => spec)(x) : x));
/** Every icon act of the lead (Back, the Files history) is the same plain chevron-like icon: no tile at rest, a fill when pointed at or pressed. */
const plainNav = list => (list || []).map(a => ({ role: 'quiet', plain: true, ...a }));

/** Binds each declared `run` to the button the builder made for it (by id), wherever the bar is mounted. A menu act opens on ArrowDown too. */
export function wireRuns(root, list) {
  for (const a of list) {
    if (!a || typeof a.run !== 'function') continue;
    const el = root.querySelector(`[id="${a.id}"]`);
    if (!el) continue;
    if (el.tagName === 'SELECT') { el.onchange = e => a.run(el, e); continue; }   // a choice in More (kind 'select'): its submenu sets the value
    el.onclick = e => a.run(el, e);
    if (a.menu) el.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); el.click(); } };
  }
}

/** The view switch of a page: the builder's segmented view, its items carrying `attr` (data-page-view unless the view names its own). */
const viewSpec = v => v ? { id: v.id, label: v.label, kind: 'segmented', attr: v.attr || 'data-page-view', value: v.value, items: v.items } : undefined;
/** Wires a page's view switch: a press on a peer (or on its entry in the dropdown form, which clicks the same button) runs `run(key)`. */
function wireView(root, v) {
  if (!v || typeof v.run !== 'function') return;
  const attr = v.attr || 'data-page-view';
  root.querySelectorAll(`[id="${v.id}"] > [${attr}]`).forEach(b => { b.onclick = () => { if (b.getAttribute(attr) !== v.value) v.run(b.getAttribute(attr)); }; });
}

/**
 * The problems of a page declaration, as sentences (empty when it is sound). The shell throws them as one BarSpecError where the builders are
 * strict (Node, the dev server), and warns once in the packaged app.
 */
export function pageProblems(p) {
  const out = [], who = `page '${p?.title ?? '?'}'`;
  if (!p || typeof p !== 'object') return ['page() returns an object'];
  if (typeof p.title !== 'string' || !p.title.trim()) out.push(`${who}: needs a title (the page's name, or the open item's)`);
  const acts = p.actions || [];
  if (acts.length > PAGE_ACTS_MAX) out.push(`${who}: ${acts.length} acts in the title bar, over ${PAGE_ACTS_MAX}. Move the least used to overflow (lint T18 title-bar-crowded)`);
  if (p.view) {
    const n = Array.isArray(p.view.items) ? p.view.items.length : 0;
    if (n < 2 || n > PAGE_VIEW_MAX) out.push(`${who}: a view switch in the title bar has 2 to ${PAGE_VIEW_MAX} peers (it has ${n}); more is a list pane or a title picker`);
    if (typeof p.view.run !== 'function') out.push(`${who}: view '${p.view.id}' needs run(key)`);
  }
  if (p.back && (!p.back.label || typeof p.back.run !== 'function')) out.push(`${who}: back needs a label (its tooltip and name) and run()`);
  if (p.titleMenu != null && typeof p.titleMenu !== 'function') out.push(`${who}: titleMenu is a function of the anchor`);
  if (p.titleNoun != null && (typeof p.titleNoun !== 'string' || !p.titleNoun || /\s{2}|^[A-Z]/.test(p.titleNoun))) out.push(`${who}: titleNoun is what the title menu switches, in lower case (collection, table, section)`);
  return out;
}

/** A view's page, read the way the shell reads it: its page(rerender), checked by pageProblems. A view with no page() is a problem, not a bar without a name. */
export function pageOf(v, rerender, env = {}) {
  const declared = typeof v?.page === 'function';
  const p = (declared ? v.page(rerender, env) : null) || {};   // env.single: one pane shows, and the view's list (list.inBar) is the title bar's switch
  const problems = declared ? pageProblems(p) : [`view '${v?.meta?.title ?? '?'}' declares no page(rerender) (lib/topbar.mjs): its title bar has nothing to draw`];
  if (problems.length) { if (isStrict()) throw new BarSpecError(problems.join('; '), problems); console.warn(problems.join('; ')); }
  return { ...p, actions: (p.actions || []).slice(0, PAGE_ACTS_MAX), overflow: [...(p.actions || []).slice(PAGE_ACTS_MAX), ...(p.overflow || [])] };
}

/**
 * The title bar's BarSpec, a pure function of its state (the tests read it without a page). The lead is Back (a plain chevron: the page's
 * own Back, else the single-pane list's), then the title as the page's h1, or a path (Files; the single-pane detail's "List / item").
 */
export function titleBarSpec(st) {
  const back = st.pageBack ? { id: 'back', label: st.pageBack.label, icon: 'chevron-left' }
    : st.listBack ? { id: 'back', label: 'Back to the list', icon: 'chevron-left' } : null;
  const nav = plainNav([...(back ? [back] : []), ...(st.nav || [])]);   // runs kept here for wiring; the spec gets them stripped
  // a title that is a picker (Notes' sections) stays the picker: it is the page's navigation, and the item is named in the page
  const crumbs = st.crumbs?.length ? st.crumbs : st.listBack && st.item && st.item !== st.title && !st.titleMenu ? [{ id: 'list', label: st.title }, { id: 'item', label: st.item }] : null;
  const lead = crumbs || st.title || nav.length
    ? { ...(nav.length ? { nav: stripRun(nav) } : {}), ...(crumbs ? { crumbs: stripRun(crumbs), level: 'h1', ...(st.crumbs?.length && st.titleMenu ? { id: 'topbar-title', menu: true } : {}) } : st.title ? { title: st.title, level: 'h1', id: 'topbar-title', menu: !!st.titleMenu } : {}) } : undefined;
  const checks = (st.checks || []).map(c => ({ id: c.id || `topbar-check-${slug(c.label)}`, label: c.label, run: c.run }));
  const pageMore = [...(st.overflow || []), ...(checks.length && st.overflow?.length ? ['-'] : []), ...checks];
  const overflow = [...aidEntry(st), ...findAct(st.find), ...(st.find && pageMore.length ? ['-'] : []), ...pageMore];
  const view = viewSpec(st.view);
  const acts = st.acts || [];
  return {
    kind: 'head', label: 'Title bar', id: 'topbar', cls: 'topbar', stack: false, switchAt: 'end', moreReserve: true, moreBeforeTail: true,
    attrs: { 'data-tauri-drag-region': 'deep' },
    lead,
    message: { id: 'subtitle', text: st.message || '' },
    ...(st.status?.text != null && (String(st.status.text) !== '' || st.status.reserve) ? { status: { id: 'topbar-status', text: String(st.status.text), ch: st.status.ch ?? 12 } } : {}),
    ...(view ? { view } : {}),
    actions: [...stripRun(acts), { ...INSPECTOR, pressed: !!st.inspOn }],
    overflow: stripRun(overflow),
    budget: { n: Math.max(4, acts.length + (view ? 1 : 0) + 1), reason: 'the title bar carries a page’s own actions and view switch beside the inspector toggle' },
    ran: [...nav, ...acts, ...overflow, ...(st.find ? [{ id: FIND.id, run: st.find.run }] : [])].filter(x => x && typeof x === 'object'),
  };
}

/** A view's page declaration drawn as a head bar of its own, for a page that hosts it outside the shell (the component fixture, tests). */
export function actionsBar(offered, label = 'Actions') {
  const view = viewSpec(offered.view);
  // a sub-page's Back is drawn as the bar's, so a page that hosts the declaration can go back the way the title bar does
  const back = offered.back ? { back: { id: 'back', label: offered.back.label } } : {};
  // a title that is a picker keeps the shell's id, so a page tested on the fixture opens it the way the title bar does
  const menu = typeof offered.titleMenu === 'function' ? { id: 'topbar-title', menu: true } : {};
  const bar = barEl(uiBar({ kind: 'head', label, stack: false, ...(offered.title ? { lead: { ...back, title: offered.title, level: 'p', ...menu } } : {}),   // a title bar never stacks, here either
    ...(offered.status?.text || offered.status?.reserve ? { status: { id: 'topbar-status', text: String(offered.status.text), ch: offered.status.ch ?? 12 } } : {}), ...(view ? { view } : {}),
    actions: stripRun(offered.actions), overflow: stripRun([...findAct(offered.find), ...(offered.find && offered.overflow?.length ? ['-'] : []), ...(offered.overflow || [])]),
    budget: { n: Math.max(4, (offered.actions || []).length + (view ? 1 : 0)), reason: 'a view’s declared actions' } }));
  wireRuns(bar, [...(offered.actions || []), ...(offered.overflow || []), ...(offered.back ? [{ id: 'back', run: offered.back.run }] : []), ...(offered.find ? [{ id: FIND.id, run: offered.find.run }] : [])]);
  wireView(bar, offered.view);
  const pick = menu.id && bar.querySelector('#topbar-title'); if (pick) pick.onclick = () => offered.titleMenu(pick);
  return bar;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.slot        the element the bar replaces (a placeholder in index.html that holds the bar's height until it exists)
 * @param {() => void} o.onBack       the back button of a single-pane list
 * @param {() => void} o.onInspector  the inspector toggle
 * @param {() => void} o.onAid        the model-actions button
 * @param {() => void} [o.onAidDown]  pointer down on the model-actions button (the selection is taken before focus moves)
 * @param {(id: string) => void} [o.onCrumb]  a folder of the path was pressed (the Files page: the title is a path, each folder goes there)
 */
export function createTopbar({ slot, onBack, onInspector, onAid, onAidDown = () => {}, onCrumb = () => {} }) {
  const st = { title: '', listBack: false, item: '', pageBack: null, tip: '', message: '', status: null, view: null, find: null, acts: [], overflow: [], checks: [], inspOn: false, aidOn: false, aidName: '', aidTip: '', titleMenu: null, titleNoun: '', moreIcon: false, nav: [], crumbs: null };
  let bar = null, ran = [];

  const by = id => bar?.querySelector(`[id="${id}"]`) || null;

  function wire() {
    wireRuns(bar, ran);
    wireView(bar, st.view);
    const back = by('back'); if (back) back.onclick = () => (st.pageBack ? st.pageBack.run() : onBack());
    const insp = by('insp-btn'); if (insp) insp.onclick = () => onInspector();
    const aid = by('aid-btn');
    if (aid) {
      aid.onclick = () => onAid(menuAnchor(aid));
    }
    bar.classList.toggle('topbar-more-icon', !!st.moreIcon);
    const tip = bar.querySelector('#topbar-title'); if (tip && st.tip) tip.title = st.tip;
    // a title that is a menu is a picker: its tooltip says what it switches (`titleNoun` of the page: collection, table, section)
    if (tip && typeof st.titleMenu === 'function') { tip.onclick = () => st.titleMenu(tip); tip.title = `Switch ${st.titleNoun || 'view'}`; }
    const message = by('subtitle'); if (message) message.title = st.message;
    // a path: each folder goes there (the single-pane detail's list goes back to the list); "…" lists the ones folded away
    const crumbs = bar.querySelector('.ui-crumbs');
    if (crumbs) {
      crumbs.addEventListener('click', e => {
        const more = e.target.closest('.ui-crumb-more');
        // a part declared with run (a page's path: Files) goes there itself; otherwise the shell is told which (onCrumb)
        const go = id => { const c = st.crumbs?.find(x => x.id === id); if (typeof c?.run === 'function') c.run(); else onCrumb(id); };
        if (more) { const hidden = [...crumbs.querySelectorAll(':scope > .ui-crumb[hidden]:not(.ui-crumb-more)')].map(b => ({ label: b.textContent, icon: 'folder', run: () => go(b.dataset.crumb) })); showMenu(more, hidden); return; }
        const b = e.target.closest('[data-crumb]'); if (!b || b.classList.contains('ui-crumb-last')) return;
        if (!st.crumbs?.length && b.dataset.crumb === 'list') onBack(); else go(b.dataset.crumb);
      });
      // Left and Right move between the parts (the folders, "…" and a title picker); Enter or Space presses the one focused
      crumbs.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const list = [...crumbs.querySelectorAll('button')].filter(x => !x.hidden && x.getClientRects().length), i = list.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault(); list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))].focus();
      });
      requestAnimationFrame(() => fitCrumbs(crumbs));
    }
  }

  function draw() {
    const { ran: r, ...spec } = titleBarSpec(st);
    ran = r;
    const next = barEl(uiBar(spec));
    const focused = bar && bar.contains(document.activeElement) ? document.activeElement.id : '';
    if (!bar) { bar = next; slot.replaceWith(bar); bar.addEventListener('pointerdown', () => onAidDown()); }
    else {
      // Whatever the shell parked in the bar (the sidebar toggle, in the compact window) stays; the rest is replaced.
      const kept = [...bar.children].filter(c => c.id === 'side-toggle');
      bar.replaceChildren(...next.childNodes);
      // the declared attributes follow the declaration (a page with a switch, its budget); what the engine writes (the mode, the rungs) is the engine's
      syncBarAttrs(bar, next);
      for (const k of kept.reverse()) bar.prepend(k);
    }
    wire();
    if (focused) by(focused)?.focus({ preventScroll: true });
  }

  const api = {
    /**
     * Sets any of: title, tip, titleMenu (a function of the anchor: the title opens a menu), status ({ text, ch }), view (a page's switch, with
     * run), pageBack ({ label, run }: a sub-page's Back), crumbs (the title is a path: [{ id, label }], the last one is the title), nav (icon acts
     * before it: Back, Forward, Up), moreIcon, acts, overflow, checks, and draws the bar.
     */
    set(patch) { Object.assign(st, patch); draw(); },
    /** The single-pane list's Back, and the open item's name (the title becomes "List / item" there); draws only when either changes. */
    setBack(on, item = '') { const it = on ? String(item || '') : ''; if (!!on === st.listBack && it === st.item) return; st.listBack = !!on; st.item = it; draw(); },
    /** The inspector toggle's pressed state: an attribute write, no redraw. */
    setPressed(on) { st.inspOn = !!on; by('insp-btn')?.setAttribute('aria-pressed', String(!!on)); },
    /** The assistant's entry of More; the bar is drawn again only when it comes or goes. */
    setAid(on, name = st.aidName, tip = st.aidTip) {
      const same = st.aidOn === !!on;
      st.aidOn = !!on; st.aidName = name; st.aidTip = tip;
      if (!same) draw();
    },
    redraw: draw,
    /** The message beside the title: what an action reported. Reading gives the text; writing keeps it across redraws. */
    message: {
      get textContent() { return st.message; },
      set textContent(v) { st.message = String(v ?? ''); const el = by('subtitle'); if (el) { el.textContent = st.message; el.title = st.message; } },
      get title() { return by('subtitle')?.title || ''; },
      set title(v) { const el = by('subtitle'); if (el) el.title = String(v ?? ''); },
    },
    get bar() { return bar; },
    get insp() { return by('insp-btn'); },
    get aid() { return by('aid-btn'); },
  };
  draw();
  return api;
}

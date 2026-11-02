// A menu of commands at a point or under a control: the explorer's context
// menu and the project switcher. One open at a time; Escape, a click outside,
// a scroll or a blur closes it, and so do moving to another view (app.mjs
// paint) and its opener leaving the page. Arrow keys move, Enter runs.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { focusControl } from './bar-fit.mjs';       // a cycle (bar-fit builds More menus with showMenu): both only call each other after load

let openMenu = null, openAnchor = null;
let returnFocus = null;
// How the person is working the menu: 'pointer' or 'keyboard'. A row has one selection signal: a checked row its check mark, the row
// under the pointer or the row the keyboard has reached a fill. The first row takes focus when a menu opens (so the arrows start
// there), but a menu opened with the mouse shows no fill on it: `data-input` on the menu says which of the two the fill follows.
let lastInput = 'pointer';
const GAP = 4;
// The shell's own bars, by their place (a view may reuse an id such as 'status' for a line of its own).
const rectOf = sel => { const el = typeof document.querySelector === 'function' ? document.querySelector(sel) : null; const r = el?.getBoundingClientRect?.(); return r && r.height > 0 ? r : null; };
/**
 * The band a menu may cover: between the title bar and the status bar, unless it was opened from one of them. A menu never covers
 * the status bar or the control it opened from: it opens GAP under the opener, or GAP above it when there is no room under, or on
 * the roomier side and scrolls.
 */
const windowView = () => ({ height: innerHeight, title: rectOf('main > .topbar'), status: rectOf('main > footer.statusbar') });
const limitsOf = (top, bottom, view) => ({
  min: view.title && top >= view.title.bottom ? view.title.bottom + GAP : GAP,
  max: view.status && bottom <= view.status.top ? view.status.top - GAP : view.height - GAP });
export function placeMenu({ top, bottom }, h, view = windowView()) {
  const { min, max } = limitsOf(top, bottom, view);
  const below = max - bottom, above = top - min;
  if (h <= below) return { top: bottom, maxHeight: null };
  if (h <= above) return { top: top - h, maxHeight: null };
  return below >= above ? { top: bottom, maxHeight: Math.max(0, below) } : { top: min, maxHeight: Math.max(0, above) };
}
const submenus = [];
const openListeners = new Set();
const submenuDepth = items => 1 + Math.max(0, ...items.filter(it => it?.submenu).map(it => submenuDepth(it.submenu)));
// A menu that appears under a resting pointer shows no hover fill until the pointer moves (data-moved): only movement inside it counts.
function inputIs(kind) {
  lastInput = kind;
  for (const m of [openMenu, ...submenus.map(s => s.menu)]) {
    if (!m) continue;
    if (m.dataset.input !== kind) m.dataset.input = kind;
    if (kind === 'pointer' && !('moved' in m.dataset)) m.dataset.moved = '';
  }
}
export function onMenuOpen(fn) { openListeners.add(fn); return () => openListeners.delete(fn); }
function closeSub(from = 0) { for (const { menu, owner } of submenus.splice(from)) { const parent = owner.closest('.menu'); if (parent) parent.hidden = false; menu.remove(); owner.setAttribute('aria-expanded', 'false'); } }
export function closeMenu({ restoreFocus = false } = {}) {
  if (openPop) closePopover({ restoreFocus });
  const focus = openAnchor || returnFocus;
  unwatch();
  closeSub();
  if (openAnchor) openAnchor.setAttribute('aria-expanded', 'false');
  openMenu?.remove(); openMenu = null; openAnchor = null; returnFocus = null;
  if (restoreFocus && focus?.isConnected !== false && !focus?.disabled) focusControl(focus);   // the opener may have folded while the menu was open: focus then goes to More
}
// A menu is the opener's: when the opener leaves the document (its page or pane was redrawn without it, a view was unmounted) the menu goes with it, so it
// never floats over whatever took the opener's place. A redraw that puts the same control back (the same id, drawn) keeps the menu on the new element.
let watcher = null;
function unwatch() { watcher?.disconnect(); watcher = null; }
function watchAnchor() {
  unwatch();
  if (!openAnchor || typeof MutationObserver !== 'function' || typeof document.body?.contains !== 'function') return;
  watcher = new MutationObserver(() => {
    if (!openMenu || !openAnchor || openAnchor.isConnected) return;
    const again = openAnchor.id ? document.getElementById(openAnchor.id) : null;
    if (again && again.getClientRects().length) { openAnchor = again; again.setAttribute('aria-expanded', 'true'); return; }
    closeMenu();
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}
/**
 * Where a menu is mounted. A modal dialog sits in the top layer, so a menu appended to the body opens behind it: the menu
 * (and every submenu) lives inside the open dialog it was opened from. A point menu opened while a dialog is open belongs to
 * the topmost one. Without a dialog the body hosts it, as before.
 */
function hostFor(at) {
  const own = at && typeof at.closest === 'function' ? at.closest('dialog[open]') : null;
  if (own) return own;
  const open = typeof document.querySelectorAll === 'function' ? [...document.querySelectorAll('dialog[open]')] : [];
  return open.at(-1) || document.body;
}
const itemRole = it =>!it.submenu && (it.imageSrc || typeof it.checked === 'boolean')
  ? it.checkType === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio' : 'menuitem';
const checkedAttr = it => itemRole(it) === 'menuitem' ? '' : ` aria-checked="${Boolean(it.checked)}"`;

/**
 * Which rows reserve the icon column. The column belongs to a section (between separators and headings): a section of
 * plain rows does not sit indented under another's icons, and on/off rows with none on leave no empty column. A section
 * whose rows all carry an icon has the column. A section where only some do would leave blank slots with the labels
 * indented under nothing, so it has no column: the lint (T17 menu-icons) makes the author give every row an icon or none.
 * A checkable section (a tick or a source image) keeps its column, because an unticked row leaves its slot empty by design.
 */
export function leadColumns(list) {
  const lead = [];
  let start = 0;
  const flush = end => {
    const rows = list.slice(start, end).filter(it => it && it !== '-' && !it.heading);
    const marked = it => it.icon || it.imageSrc || it.checked === true;
    const checkable = rows.some(it => it.imageSrc || typeof it.checked === 'boolean');
    const on = checkable ? rows.some(marked) : rows.length > 0 && rows.every(it => it.icon);
    for (let j = start; j < end; j++) lead[j] = on;
  };
  list.forEach((it, i) => { if (it === '-' || it?.heading) { flush(i); start = i + 1; } });
  flush(list.length);
  return lead;
}

/**
 * A submenu beside its row, as in a native menu: it opens when the row is
 * pointed at, clicked or entered with the right arrow, sits to the right (or
 * left, when there is no room) and closes with the left arrow or Escape.
 */
function openSubmenu(row, items, focusFirst) {
  const parent = row.closest('.menu');
  const level = parent === openMenu ? 0 : submenus.findIndex(s => s.menu === parent) + 1;
  if (submenus[level]?.owner === row) { if (focusFirst) submenus[level].menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); return; }
  closeSub(level);
  const m = document.createElement('div');
  m.className = 'menu menu-sub'; m.setAttribute('role', 'menu'); m.dataset.input = lastInput;
  // A checked row (line spacing, alignment) shows its mark here as in the menu itself.
  const leadOf = leadColumns(items);
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="menu-sep" role="separator"></div>'
    : it.heading ? `<div class="menu-heading" role="presentation">${esc(it.heading)}</div>`
    : `<button role="${itemRole(it)}"${checkedAttr(it)} data-i="${i}"${it.submenu ? ' aria-haspopup="menu" aria-expanded="false" class="has-sub"' : ''}${it.disabled ? ' disabled' : ''}>${leadOf[i] ? `<span class="menu-ico">${it.imageSrc ? `<img src="${esc(it.imageSrc)}" alt="" width="20" height="20">` : it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}</span>` : ''}<span class="menu-label">${esc(it.label)}</span>${it.meta ? `<span class="menu-meta">${esc(it.meta)}</span>` : ''}${it.submenu ? `<span class="menu-chev">${icon('chevron-right', { size: 14 })}</span>` : ''}</button>`).join('');
  // The submenu opens where its parent menu is: inside the same dialog, or the body.
  (parent?.parentNode || document.body).append(m);
  const r = row.getBoundingClientRect(), edge = parent.getBoundingClientRect(), w = m.offsetWidth;
  const need = w + (submenuDepth(items) - 1) * 182;
  const availableLeft = edge.left - 6, availableRight = innerWidth - edge.right - 6;
  // Choose room for the whole branch at its first row. Flipping a later
  // submenu back across its ancestors would cover the original menu.
  const preferLeft = parent === openMenu ? availableLeft > availableRight : parent?.dataset?.side === 'left';
  const leftFits = edge.left - w - 2 >= 4, rightFits = edge.right + 2 + w <= innerWidth - 4;
  const left = preferLeft ? leftFits || !rightFits : !rightFits;
  let x = left ? Math.max(4, edge.left - w - 2) : edge.right + 2;
  m.dataset.side = left ? 'left' : 'right';
  // On narrow windows, use a back row rather than stacking overlapping menus.
  const drill = innerWidth < 600 || parent?.dataset?.drill === 'true'
    || (parent === openMenu && Math.max(availableLeft, availableRight) < need)
    || (preferLeft ? !leftFits : !rightFits);
  if (drill) {
    if (!focusFirst) { m.remove(); return; }
    m.dataset.drill = 'true';
    x = Math.max(4, Math.min(parent.getBoundingClientRect().left, innerWidth - w - 4));
    m.insertAdjacentHTML('afterbegin', `<button type="button" class="menu-back" role="menuitem">${icon('chevron-left', { size: 14 })}<span class="menu-label">${esc(row.querySelector('.menu-label')?.textContent || 'Back')}</span></button>`);
    m.firstElementChild.onclick = e => { e.stopPropagation(); closeSub(level); row.focus({ preventScroll: true }); };
    parent.hidden = true;
  }
  const { min, max } = limitsOf(r.top, r.bottom, windowView());
  if (m.offsetHeight > max - min) m.style.maxHeight = `${Math.max(0, max - min)}px`;
  m.style.left = `${x}px`; m.style.top = `${Math.max(min, Math.min(r.top - 4, max - m.offsetHeight))}px`;
  submenus.push({ menu: m, owner: row }); row.setAttribute('aria-expanded', 'true');
  const buttons = [...m.querySelectorAll('button:not(:disabled)')];
  m.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b || b.disabled) return; const it = items[+b.dataset.i]; if (it.submenu) { openSubmenu(b, it.submenu, true); return; } closeMenu({ restoreFocus: true }); it.run?.(); };
  m.onpointermove = e => { inputIs('pointer'); const b = e.target.closest('button[data-i]'); if (!b || b.disabled) return; if (document.activeElement !== b) b.focus({ preventScroll: true }); const it = items[+b.dataset.i]; if (it.submenu) { if (innerWidth >= 600) openSubmenu(b, it.submenu, false); } else closeSub(level + 1); };
  m.onkeydown = e => {
    inputIs('keyboard');
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus({ preventScroll: true }); }
    else if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && document.activeElement?.matches('button.has-sub')) { e.preventDefault(); openSubmenu(document.activeElement, items[+document.activeElement.dataset.i].submenu, true); }
    else if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSub(level); row.focus({ preventScroll: true }); }
    else if (e.key === 'Tab') { e.stopPropagation(); closeMenu({ restoreFocus: true }); }
  };
  if (focusFirst) buttons[0]?.focus({ preventScroll: true });
}

/**
 * A small popover of reading under a control (a column header's field guide): not a menu, so it has no rows to move over. One open at a
 * time, and opening a menu closes it. Focus moves into it (it never scrolls the page: it is fixed under the opener, flipped above when
 * there is no room); Escape closes it and returns the focus to the opener, as does Tab; a press outside, a scroll, a resize (the
 * listeners at the foot of this file, which close menus), the window losing focus and its opener leaving the page close it without moving the focus. Opening it touches nothing else: not the
 * selection of a grid, not the scroll of its table.
 */
let openPop = null;
export function closePopover({ restoreFocus = false } = {}) {
  const p = openPop; if (!p) return;
  openPop = null;
  p.watch?.disconnect(); p.events.abort(); p.el.remove();
  p.anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && p.anchor.isConnected && !p.anchor.disabled) p.anchor.focus({ preventScroll: true });
}
export function showPopover(anchor, { label = '', html = '', className = '' } = {}) {
  if (openPop?.anchor === anchor) { closePopover({ restoreFocus: true }); return null; }
  closeMenu(); closePopover();
  const el = document.createElement('div');
  el.className = `ui-pop ${className}`.trim(); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label); el.tabIndex = -1;
  el.innerHTML = html;
  hostFor(anchor).append(el);
  const events = new AbortController(), on = { signal: events.signal };
  openPop = { el, anchor, events };
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, place = placeMenu({ top: r.top - GAP, bottom: r.bottom + GAP }, el.offsetHeight);
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  el.style.top = `${place.top}px`;
  if (place.maxHeight != null) el.style.maxHeight = `${place.maxHeight}px`;
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); closePopover({ restoreFocus: true }); }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();   // a key typed here is not the page's (a letter must not start an edit behind it)
  });
  document.addEventListener('pointerdown', e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); }, { ...on, capture: true });
  // Focusing the opener can queue a scroll event before the popover exists. Ignore that completed scroll; a new movement still dismisses it.
  const scrollAtOpen = new Map();
  for (let node = anchor; node; node = node.parentElement) scrollAtOpen.set(node, [node.scrollLeft, node.scrollTop]);
  scrollAtOpen.set(document, [document.scrollingElement?.scrollLeft || 0, document.scrollingElement?.scrollTop || 0]);
  document.addEventListener('scroll', e => {
    if (el.contains(e.target)) return;
    const before = scrollAtOpen.get(e.target), node = e.target === document ? document.scrollingElement : e.target;
    if (before && before[0] === (node?.scrollLeft || 0) && before[1] === (node?.scrollTop || 0)) return;
    closePopover();
  }, { ...on, capture: true });
  if (typeof MutationObserver === 'function') {
    openPop.watch = new MutationObserver(() => { if (!anchor.isConnected) closePopover(); });
    openPop.watch.observe(document.body, { childList: true, subtree: true });
  }
  el.focus({ preventScroll: true });
  return el;
}

/**
 * items: { label, run, icon?, imageSrc?, checked?, danger?, meta?, disabled?, aside? } or '-'.
 * aside is a second command on the same row ({ icon, label, run }), shown when
 * the row is pointed at or focused: removing a project from the list.
 * at: { x, y } in viewport pixels, or an element to open beneath.
 */
export function showMenu(at, items, { className = '', minWidth = 160, align = 'start', matchWidth = true, focusChecked = false } = {}) {
  if (at instanceof Element && openMenu && openAnchor === at) { closeMenu(); at.focus({ preventScroll: true }); return null; }
  closeMenu();
  returnFocus = document.activeElement;
  for (const fn of openListeners) fn(at);
  const list = items.filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));
  const m = document.createElement('div');
  m.className = `menu ${className}`.trim(); m.setAttribute('role', 'menu');
  // The icon column is kept per section (see leadColumns).
  const leadOf = leadColumns(list);
  const hasAside = list.some(it => it && it.aside);
  m.innerHTML = list.map((it, i) => it === '-' ? '<div class="menu-sep" role="separator"></div>' :
    it.heading ? `<div class="menu-heading" role="presentation">${esc(it.heading)}</div>` :
    `${hasAside ? '<div class="menu-row">' : ''}<button role="${itemRole(it)}"${checkedAttr(it)} data-i="${i}"${it.submenu ? ' aria-haspopup="menu" aria-expanded="false"' : ''}${it.disabled ? ' disabled' : ''} class="${it.danger ? 'danger' : ''}${it.checked ? ' on' : ''}${it.submenu ? ' has-sub' : ''}">
      ${leadOf[i] ? `<span class="menu-ico">${it.imageSrc ? `<img src="${esc(it.imageSrc)}" alt="" width="20" height="20">` : it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}</span>` : ''}
      <span class="menu-label">${esc(it.label)}</span>${it.imageSrc && it.checked ? `<span class="menu-selected">${icon('check', { size: 14 })}</span>` : ''}${it.meta ? `<span class="menu-meta">${esc(it.meta)}</span>` : ''}${it.submenu ? `<span class="menu-chev">${icon('chevron-right', { size: 14 })}</span>` : ''}</button>${
      hasAside ? `${it.aside ? `<button role="menuitem" class="menu-aside" data-aside="${i}" title="${esc(it.aside.label)}" aria-label="${esc(it.aside.label)}">${icon(it.aside.icon || 'close', { size: 12 })}</button>` : '<span class="menu-aside"></span>'}</div>` : ''}`).join('');
  hostFor(at).append(m);
  // A font list shows each name in its own typeface; a font this machine lacks falls back to the interface font.
  list.forEach((it, i) => { const l = it?.font && m.querySelector(`[data-i="${i}"] .menu-label`); if (l) l.style.fontFamily = `"${it.font.replace(/["\\]/g, '')}", var(--font)`; });
  openMenu = m; m.menuItems = list; openAnchor = at instanceof Element ? at : null;
  if (openAnchor) openAnchor.setAttribute('aria-expanded', 'true');
  watchAnchor();
  m.dataset.input = lastInput;
  let x, band;
  // Under a control, the menu is at least as wide as it, as a dropdown's list is.
  if (at instanceof Element) { const r = at.getBoundingClientRect(); x = r.left; band = { top: r.top - GAP, bottom: r.bottom + GAP }; m.style.setProperty('--menu-min', `${Math.min(innerWidth - 16, Math.max(minWidth, matchWidth ? r.width : 0))}px`); }
  else { x = at.x; band = { top: at.y, bottom: at.y }; }
  const w = m.offsetWidth, h = m.offsetHeight;
  // At the window's right edge the menu ends where its opener ends (a dropdown wider than its field), not wherever the window stops.
  const spill = Math.max(0, x + w + GAP - innerWidth);   // how far a start-aligned menu would run past the window
  if (at instanceof Element && (align === 'end' || spill)) x = at.getBoundingClientRect().right - w;
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - w - 4))}px`;
  const place = placeMenu(band, h);
  m.style.top = `${place.top}px`;
  if (place.maxHeight != null) m.style.maxHeight = `${place.maxHeight}px`;
  const buttons = [...m.querySelectorAll('button:not(:disabled)')];
  m.onclick = e => {
    const a = e.target.closest('button[data-aside]');
    if (a) { const it = list[+a.dataset.aside]; closeMenu({ restoreFocus: true }); it.aside.run?.(); return; }
    const b = e.target.closest('button[data-i]'); if (!b || b.disabled) return;
    const it = list[+b.dataset.i];
    if (it.submenu) { openSubmenu(b, it.submenu, true); return; }
    closeMenu({ restoreFocus: true }); it.run?.();
  };
  // One highlighted row: pointing at a row focuses it, as in a native menu, and
  // opens its submenu (or closes another row's).
  m.onpointermove = e => {
    inputIs('pointer');
    const b = e.target.closest('button[data-i]'); if (!b) return;
    if (document.activeElement !== b) b.focus({ preventScroll: true });
    const it = list[+b.dataset.i];
    if (it?.submenu && !b.disabled) { if (innerWidth >= 600) openSubmenu(b, it.submenu, false); } else closeSub();
  };
  m.onkeydown = e => {
    inputIs('keyboard');
    const shown = buttons.filter(b => !b.hidden), i = shown.indexOf(document.activeElement);   // rows a search hid are skipped (lib/menu-search.mjs)
    if (e.key === 'ArrowDown') { e.preventDefault(); shown[(i + 1) % shown.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); shown[(i - 1 + shown.length) % shown.length]?.focus({ preventScroll: true }); }
    else if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && document.activeElement?.matches('button.has-sub')) { e.preventDefault(); openSubmenu(document.activeElement, list[+document.activeElement.dataset.i].submenu, true); }
    else if (e.key === 'ArrowRight' && document.activeElement?.nextElementSibling?.matches('button.menu-aside')) { e.preventDefault(); document.activeElement.nextElementSibling.focus(); }
    else if (e.key === 'ArrowLeft' && document.activeElement?.matches('button.menu-aside')) { e.preventDefault(); document.activeElement.previousElementSibling.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu({ restoreFocus: true }); }
    else if (e.key === 'Tab') { closeMenu({ restoreFocus: true }); }
  };
  // A list of choices (a select) starts at its checked row, as a native list does: focused (the fill when opened with the keyboard)
  // and scrolled into the menu's view when the list scrolls.
  const start = (focusChecked && buttons.find(b => b.getAttribute('aria-checked') === 'true')) || buttons[0];
  start?.focus({ preventScroll: true });
  if (start && start !== buttons[0] && m.scrollHeight > m.clientHeight) {
    const top = start.offsetTop, bottom = top + start.offsetHeight;
    if (top < m.scrollTop || bottom > m.scrollTop + m.clientHeight) m.scrollTop = Math.max(0, top - (m.clientHeight - start.offsetHeight) / 2);
  }
  return m;
}

if (typeof document !== 'undefined') {
  // Which input opened (and works) a menu: a key press before it opens, or a press of the pointer.
  document.addEventListener('keydown', e => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) lastInput = 'keyboard'; }, true);
  document.addEventListener('pointerdown', e => {
    lastInput = 'pointer';
    if (!openMenu || openMenu.contains(e.target) || submenus.some(s => s.menu.contains(e.target))) return;
    // The opener's click handles its own toggle, for mouse and keyboard alike.
    if (openAnchor?.contains(e.target)) return;
    closeMenu();
  }, true);
  addEventListener('blur', closeMenu);
  addEventListener('resize', closeMenu);
  document.addEventListener('scroll', e => { if (openMenu && !openMenu.contains(e.target) && !submenus.some(s => s.menu.contains(e.target))) closeMenu(); }, true);
}

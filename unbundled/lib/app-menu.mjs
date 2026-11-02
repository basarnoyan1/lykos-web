// The desktop's menu bar and window behaviour, from the page's side
// (src-tauri/src/app_menu.rs holds the menu). A menu item arrives as a `menu`
// event carrying its id; the shell routes it to the action it already runs.
// The page reports what the menu should show (menuState in app.mjs), once per
// change. In a browser tab none of this applies and every call is a no-op.
import { inDesktop } from './native.mjs';

const tauri = () => (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : null);

/** Repair only the shell's initial automatic focus, before the person interacts. */
export function createStartupFocusGuard(doc, { setDelay = setTimeout, clearDelay = clearTimeout } = {}) {
  let active = true, timer = null;
  const cancel = () => {
    active = false;
    if (timer != null) clearDelay(timer);
    timer = null;
    doc.removeEventListener('pointerdown', interact, true);
    doc.removeEventListener('keydown', interact, true);
    doc.removeEventListener('click', interact, true);
  };
  const interact = event => { if (event.isTrusted) cancel(); };
  doc.addEventListener('pointerdown', interact, true);
  doc.addEventListener('keydown', interact, true);
  doc.addEventListener('click', interact, true);
  const settle = () => {
    if (!active || timer != null) return;
    timer = setDelay(() => {
      if (!active) return;
      cancel();
      const control = doc.activeElement;
      if (doc.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], .menu')) return;
      // These are the first controls in the full, rail and welcome shells.
      // Editors and controls deliberately focused while restoring a view stay put.
      if (!control?.matches?.('#proj, #side-toggle, #start-close, #start-new')) return;
      const target = doc.querySelector('body > .start') || doc.body;
      const before = target.getAttribute('tabindex');
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      // Focusing then blurring the body resets Tab's starting point without
      // leaving a focus ring on the workspace container.
      if (target === doc.body) target.blur();
      if (before == null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', before);
    }, 60);
  };
  return { settle, cancel };
}

// Install before asynchronous settings/project loading or the first native show.
const startupFocus = inDesktop() ? createStartupFocusGuard(document) : null;
let firstWindow = true;

/** Calls `fn(id)` for each menu item chosen. */
export function onMenu(fn) {
  const t = tauri();
  if (!t?.transformCallback) return;
  const handler = t.transformCallback(ev => { startupFocus?.cancel(); fn(String(ev?.payload ?? '')); });
  t.invoke('plugin:event|listen', { event: 'menu', target: { kind: 'Any' }, handler })
    .catch(err => console.warn('[menu]', err));
}

let sent = '';
/** Tells the shell what the menu reflects; an unchanged state is not sent again. */
export function reportMenu(state) {
  if (!inDesktop()) return;
  const text = JSON.stringify(state);
  if (text === sent) return;
  sent = text;
  tauri().invoke('menu_state', { state }).catch(err => { sent = ''; console.warn('[menu]', err); });
}

let shape = '';
/** The window's shape: 'welcome' (compact, no project open) or 'normal'. */
export function windowMode(mode) {
  if (!inDesktop() || mode === shape) return;
  shape = mode;
  const initial = firstWindow; firstWindow = false;
  tauri().invoke('window_mode', { mode }).then(() => { if (initial) startupFocus?.settle(); }).catch(err => { startupFocus?.cancel(); shape = ''; console.warn('[window]', err); });
}

let doc = '';
/** The window's title, edited dot and light or dark appearance (src-tauri/src/mac.rs). */
export function windowDocument({ title, edited, dark }) {
  if (!inDesktop()) return;
  const text = JSON.stringify([title, edited, dark]);
  if (text === doc) return;
  doc = text;
  tauri().invoke('window_document', { title, edited, dark }).catch(() => { doc = ''; });
}
let chrome = '';
/** The window's own ground and where the sidebar's material ends (src-tauri/src/mac.rs). */
export function windowChrome({ sidebar, background }) {
  if (!inDesktop()) return;
  const text = `${sidebar}|${background}`;
  if (text === chrome) return;
  chrome = text;
  tauri().invoke('window_chrome', { sidebar, background }).catch(() => { chrome = ''; });
}
let chromeQueued = false;
/**
 * Reports the sidebar's width and the page's ground once a frame: the welcome
 * panel's left side, or the shell's sidebar, or nothing while a full-window
 * form has its own ground. Called wherever either can change.
 */
export function syncChrome() {
  if (!inDesktop() || chromeQueued) return;
  chromeQueued = true;
  requestAnimationFrame(() => {
    chromeQueued = false;
    const start = document.querySelector('.start');
    const side = start ? (start.classList.contains('start-welcome') ? document.querySelector('.start-side') : null) : document.querySelector('body > aside');
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim();
    windowChrome({ sidebar: side ? Math.round(side.getBoundingClientRect().width) : 0, background: /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff' });
  });
}
let badge = -1;
/** The Dock icon's badge: the unread notification count, none at zero. */
export function dockBadge(count) {
  if (!inDesktop() || count === badge) return;
  badge = count;
  tauri().invoke('dock_badge', { count }).catch(() => { badge = -1; });
}
/** A system notification for finished work, posted only while Lykos is in the background. */
export const notifyDone = (title, body = '') => inDesktop() ? tauri().invoke('notify', { title, body }).catch(() => false) : Promise.resolve(false);
/** A destructive confirmation as a sheet on the window; rejects when the window cannot show one. */
export const confirmSheet = (title, detail, confirm) => tauri().invoke('confirm_sheet', { title, detail, confirm });

/** The page's answer to a quit: null while it saves or asks, then true to quit or false to stay. */
export const quitReply = proceed => tauri()?.invoke('quit_reply', { proceed }).catch(() => {});

// Text a person types into keeps the system's Cut, Copy and Paste menu, and a
// selection keeps Copy and Look Up; everywhere else the web view's own menu
// (Reload, Back) is not the application's, so it does not open. The app's own
// menus (lib/menu.mjs) have already taken the event where they apply.
const TEXT_INPUT = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input[type="password"], input[type="tel"]';
export function wantsSystemMenu(target, selection) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el) return false;
  if (el.closest(TEXT_INPUT) || el.isContentEditable) return true;
  if (!selection || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(el)) return true;
  return false;
}
export function nativeContextMenu() {
  if (!inDesktop()) return;
  addEventListener('contextmenu', e => {
    if (e.defaultPrevented || wantsSystemMenu(e.target, getSelection())) return;
    e.preventDefault();
  });
}

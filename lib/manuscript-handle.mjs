// Writing help at the selection (Plane's handle beside a selected paragraph: Paraphrase, Simplify, Elaborate; owner via the Mobbin review,
// 2026-10-23). Text selected in the manuscript shows one small row of four over the selection: Revise (the paragraph), Tighten (the
// selection), Cite and Ask. Revise and Tighten run the manuscript's own model actions (aid/manuscript.mjs) and their result is reviewed in
// place with Keep and Undo (lib/review-walk.mjs); Cite and Ask attach the selection and go to the chat. The menus keep their entries: this
// is a shorter way to the same actions, not a second set. Loaded with the first selection made in the manuscript.
//
//   follow(deps)   shows, moves or hides the handle for the selection now; deps = { inPage(node), act(id, text) }
import { uiBar } from './ui-actions.mjs';

export const HANDLE_ACTS = Object.freeze([
  Object.freeze({ id: 'revise', label: 'Revise', icon: 'draft', min: 1 }),
  Object.freeze({ id: 'tighten', label: 'Tighten', icon: 'tighten', min: 8 }),
  Object.freeze({ id: 'cite', label: 'Cite', icon: 'quote', min: 8 }),
  Object.freeze({ id: 'ask', label: 'Ask', icon: 'assistant', min: 1 }),
]);
const GAP = 6;

/** The handle's row: four quiet acts, each with its icon and name (a selection is short work: no More). */
export const handleHtml = (length = 0) => uiBar({ kind: 'tools', density: 'dense', label: 'Writing help', id: 'ms-handle-bar', stack: false,
  actions: HANDLE_ACTS.map(a => ({ id: `ms-handle-${a.id}`, label: a.label, icon: a.icon, role: 'quiet', keep: true, disabled: length < a.min })),
  budget: { n: 4, reason: 'the writing handle offers the four things done to a selection (Plane: one row at the selection)' } });

/** Where the handle goes for a selection's box: above it, at its start, inside the window (below it when there is no room above). Above, it is
 *  placed by its bottom edge, so its own height (known once the width engine has fitted it) does not move it. */
export function handlePlace(rect, width, view = { width: 1280, height: 800 }, room = 40) {
  const left = Math.round(Math.max(4, Math.min(rect.left, view.width - width - 4)));
  return rect.top >= room + GAP ? { bottom: Math.round(view.height - rect.top + GAP), left } : { top: Math.round(rect.bottom + GAP), left };
}

let el = null, shownFor = '', wiredDoc = null, lastDeps = null, pressing = false;
export const hideHandle = () => { if (el) { el.hidden = true; shownFor = ''; } };

function ensure(doc, deps) {
  if (el?.isConnected) return el;
  el = doc.createElement('div');
  el.className = 'ms-handle'; el.id = 'ms-handle'; el.hidden = true;
  doc.body.append(el);
  // pressing a control must not take the selection away before the act reads it
  el.addEventListener('pointerdown', e => { pressing = true; e.preventDefault(); });
  el.addEventListener('click', e => {
    pressing = false;
    const b = e.target.closest?.('button[id^="ms-handle-"]'); if (!b || b.disabled) return;
    const text = String(doc.getSelection?.() || '').trim();
    hideHandle();
    lastDeps?.act(b.id.slice('ms-handle-'.length), text);
  });
  return el;
}

/** Shows the handle over the selection now, moves it, or hides it. */
export function follow(deps, doc = globalThis.document) {
  lastDeps = deps;
  if (wiredDoc !== doc) {
    wiredDoc = doc;
    // drawn when the selection is made (the pointer let go, a key that extends it), not while it is being dragged out
    doc.addEventListener('pointerup', () => requestAnimationFrame(() => lastDeps && follow(lastDeps, doc)), true);
    doc.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift') follow(lastDeps, doc); }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') hideHandle(); }, true);
    doc.addEventListener('scroll', () => { if (el && !el.hidden) place(doc); }, true);
  }
  if (pressing) return;
  const sel = doc.getSelection?.(), text = String(sel || '').trim();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !text || !deps.inPage(sel.anchorNode) || !deps.inPage(sel.focusNode)) { hideHandle(); return; }
  const h = ensure(doc, deps);
  if (shownFor !== text) { h.innerHTML = handleHtml(text.length); shownFor = text; }
  h.hidden = false;
  place(doc);
}
function place(doc) {
  const sel = doc.getSelection?.(); if (!el || !sel?.rangeCount) return;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height) { hideHandle(); return; }
  const at = handlePlace(r, el.offsetWidth, { width: innerWidth, height: innerHeight });
  el.style.setProperty('--handle-top', at.top != null ? `${at.top}px` : 'auto'); el.style.setProperty('--handle-bottom', at.bottom != null ? `${at.bottom}px` : 'auto');
  el.style.setProperty('--handle-left', `${at.left}px`);
}

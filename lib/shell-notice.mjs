// The shell's own notices: something the whole window should say (a save that failed, a project replaced by the one on disk, an
// unexpected error). One shared builder, uiNotice, floated at the corner above the status line; a notice with the same id replaces
// the earlier one, and a dismissed one stays dismissed until its text changes. Nothing here positions a control.
import { uiNotice } from './ui-actions.mjs';

const clip = (text, n = 140) => { const t = String(text ?? '').split('\n')[0].trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The notice as markup: at most two actions, each { id, label, run }. */
export function shellNoticeHtml({ id, text, label = '', actions = [] }) {
  return uiNotice({ id, label: label || 'Notice', text: clip(text, 220), float: true, dismissible: true,
    actions: actions.slice(0, 2).map(({ run, ...a }) => a) });
}

/** The words for a project that was replaced while the window held unsaved edits (store.mjs onProjectReplaced). */
export function replacedNoticeText(copies = 0, conflicts = null) {
  if (conflicts?.length) return `Someone saved the project at the same time. Both sets of changes are in; where you both changed the same value (${conflicts.length}), theirs was kept and your version is a recovery copy.`;
  return `The project changed on disk and replaced the open one. Your unsaved changes were kept as a recovery copy${copies > 1 ? ` (${copies} copies in all)` : ''}.`;
}

/** The words for a save that did not happen. */
export const saveFailedText = reason => `Not saved: ${clip(reason || 'the project could not be written', 100)}`;

const shown = new Map();   // id → { text, el }
const dismissed = new Map();   // id → the text that was dismissed

function host(doc) {
  let h = doc.getElementById('shell-notices');
  if (!h) { h = doc.createElement('div'); h.id = 'shell-notices'; h.className = 'ui-shell-notices'; h.setAttribute('role', 'status'); doc.body.append(h); }
  return h;
}

/** Shows (or replaces) a notice. `again` shows it although the same text was dismissed. Answers whether it was drawn. */
export function showShellNotice(spec, doc = globalThis.document) {
  if (!doc?.body) return false;
  const text = clip(spec.text, 220);
  if (!spec.again && dismissed.get(spec.id) === text) return false;
  if (shown.get(spec.id)?.text === text && shown.get(spec.id).el.isConnected) return true;
  hideShellNotice(spec.id);
  dismissed.delete(spec.id);
  const wrap = doc.createElement('div');
  wrap.innerHTML = shellNoticeHtml({ ...spec, text });
  const el = wrap.firstElementChild;   // the .ui-float
  host(doc).append(el);
  shown.set(spec.id, { text, el });
  el.querySelector(`[id="${spec.id}-dismiss"]`)?.addEventListener('click', () => { dismissed.set(spec.id, text); hideShellNotice(spec.id); });
  for (const a of spec.actions || []) {
    el.querySelector(`[id="${a.id}"]`)?.addEventListener('click', () => { hideShellNotice(spec.id); a.run?.(); });
  }
  return true;
}

export function hideShellNotice(id) {
  const n = shown.get(id);
  if (!n) return;
  n.el.remove();
  shown.delete(id);
}

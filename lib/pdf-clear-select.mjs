// Clicking clear space puts a PDF selection away: the highlight, the strip and the window's selection go, and nothing else happens. One rule for the
// Files viewer (views/pdf-file.mjs) and the study reader (views/reader.mjs), which each give it their column and what "put away" means to them.
//
// Clear space is anything in the page column that is not text: the page's margin, a figure, the gap between pages, the empty area beside them. It is not
// the strip, a menu or a dialog (they are outside the column, or say so with .ui-bar), not a word of the text layer (a click on the selected
// text is the reader's own business), and not the end of a drag, a double or triple click, or a click made with a modifier (they extend or
// make a selection).

/** Pixels the pointer may travel between press and release for the gesture to still be a click. */
export const CLICK_SLOP = 4;
const KEEP = '.ui-bar,[role=menu],[role=dialog],dialog,.menu,.ui-pop,.ui-popover,.ann,button,a,input,textarea,select,[contenteditable="true"],[data-region-box]';

/** Whether a click whose target is `el` lands on clear space: not inside the strip or any control, and not on a word of a text layer. */
export function isClearSpace(el) {
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(KEEP)) return false;
  const layer = el.closest('.textlayer');
  return !(layer && el !== layer && !el.classList.contains('endOfContent'));
}

/** Whether a press-and-release is a plain click: the main button, one click, no modifier, and the pointer where it went down. */
export function isPlainClick(down, up) {
  if (!down || !up) return false;
  if ((up.button ?? 0) !== 0 || up.detail > 1 || up.shiftKey || up.ctrlKey || up.metaKey || up.altKey) return false;
  return Math.hypot(up.clientX - down.x, up.clientY - down.y) <= CLICK_SLOP;
}

/**
 * Listens in `root` (the page column). A plain click on clear space calls `clear()` when `active()` says a selection is pending, and
 * also drops the window's selection. `skip()` lets a mode that owns the pointer (the reader's region tool) keep its clicks. Returns the function that stops listening.
 */
export function attachClearSelection(root, { active, clear, skip = () => false }) {
  let down = null;
  const onDown = e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY, el: e.target } : null; };
  const onClick = e => {
    const d = down; down = null;
    if (!d || !active() || skip() || !isPlainClick(d, e) || !isClearSpace(e.target) || !isClearSpace(d.el)) return;
    clear();
    getSelection()?.removeAllRanges();
  };
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('click', onClick);
  return () => { root.removeEventListener('pointerdown', onDown, true); root.removeEventListener('click', onClick); };
}

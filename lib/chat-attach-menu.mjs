// "Ask about this" at start: the menu entry, the gestures' wiring, what the shell lends. The rest (chat-attach-ui.mjs) loads on the first gesture.
const TARGETS = '.ext-grid td[data-cell], .ext-grid tr[data-row], .chat-table-wrap tbody tr, [data-output], .ui-row[data-row]';
const ui = () => import('./chat-attach-ui.mjs');
export const shell = {};   // lent by the shell: state, say, open, held, reader, view, store
export const askItem = target => ({ label: 'Ask about this', icon: 'assistant', run: () => ui().then(m => (typeof target === 'string' ? m.askAboutSelection(target) : m.askAbout(target))) });
export const askFocused = from => ui().then(m => m.askFocused(from));

export function wireAsk(lend) {
  Object.assign(shell, lend);
  // an item's context menu (the Menu key too); the system's own stays on text, a selection and fields
  document.addEventListener('contextmenu', e => {
    const el = e.target?.nodeType === 1 ? e.target : e.target?.parentElement, sel = getSelection?.();
    if (e.defaultPrevented || !el?.closest?.(TARGETS) || el.closest('input,textarea,select,[contenteditable="true"],dialog,.menu')) return;
    if (sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0).intersectsNode(el)) return;
    e.preventDefault();
    ui().then(m => m.contextMenu(el, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null));
  });
  // a control that declares `data-ask-about` (a bar's More entry over a selection)
  document.addEventListener('click', e => {
    const control = e.target?.closest?.('[data-ask-about]');
    if (control && !control.disabled) ui().then(m => m.askAboutSelection(control.dataset.askAbout));
  });
}

// The behaviour of a tab strip drawn by uiDocTabs (lib/ui-actions.mjs): selecting, closing, stepping, the picker, reordering and dropping. The
// strip owns no state: the view keeps the tab model (lib/file-tabs.mjs) and redraws the strip from it.
import { fitDocTabs } from './ui-actions.mjs';
import { showMenu } from './menu.mjs';

export const TAB_MIME = 'application/x-lykos-tab';

/**
 * @param {HTMLElement} el   the strip element (the .ui-tabs of uiDocTabs)
 * @param {object} o
 * @param {{ id: string, label: string, icon?: string, dirty?: boolean, pinned?: boolean }[]} o.tabs   for the picker's list (a pinned tab has no close)
 * @param {string} o.active
 * @param {(id: string, e: Event) => void} o.select     a tab was chosen
 * @param {(id: string) => void} o.close
 * @param {(id: string) => void} [o.pin]                a double click: keep the tab open
 * @param {(delta: number) => void} o.step              previous (-1) or next (1) in the strip
 * @param {(anchor: HTMLElement) => void} o.more        the strip's More
 * @param {(id: string, e: MouseEvent) => void} [o.context]
 * @param {(payload: { id: string, tab: boolean }, before: string | null) => void} [o.drop]   something was dropped on the strip, before a tab or at its end
 * @returns {() => void} release
 */
export function wireDocTabs(el, o) {
  const tabOf = target => target.closest?.('.ui-tab');
  const idOf = tab => tab?.dataset.tab || '';
  const release = [];
  // the strip fits itself when the engine reports its width (ui-actions.mjs); the first fit is now, in case it was not laid out yet
  requestAnimationFrame(() => fitDocTabs(el));

  el.addEventListener('click', e => {
    const close = e.target.closest('.ui-tab-close');
    if (close?.classList.contains('ui-tab-fixed')) return;
    if (close) { e.preventDefault(); const t = tabOf(close); o.close(t ? idOf(t) : o.active); return; }
    const main = e.target.closest('.ui-tab-main');
    if (main) { o.select(idOf(tabOf(main)), e); return; }
    if (e.target.closest('.ui-tabs-prev')) { o.step(-1); return; }
    if (e.target.closest('.ui-tabs-next')) { o.step(1); return; }
    const more = e.target.closest('.ui-tabs-more');
    if (more) { o.more(more); return; }
    const menu = e.target.closest('.ui-tabs-menu');
    // the picker's list: each document a row that shows it, and its close at the row's end, always drawn (a pinned tab has none)
    if (menu) showMenu(menu, o.tabs.map(t => ({ label: t.label, icon: t.icon, checked: t.id === o.active, meta: t.dirty ? 'Unsaved' : '', run: () => o.select(t.id, e),
      ...(t.pinned ? {} : { aside: { icon: 'close', label: `Close ${t.label}`, run: () => o.close(t.id) } }) })), { className: 'ui-tabs-list' });
  });
  el.addEventListener('dblclick', e => { const t = tabOf(e.target); if (t && !e.target.closest('.ui-tab-close')) o.pin?.(idOf(t)); });
  el.addEventListener('auxclick', e => { if (e.button === 1) { const t = tabOf(e.target); if (t) { e.preventDefault(); o.close(idOf(t)); } } });
  el.addEventListener('contextmenu', e => { const t = tabOf(e.target); if (t && o.context) { e.preventDefault(); o.context(idOf(t), e); } });
  el.addEventListener('keydown', e => {
    const main = e.target.closest('.ui-tab-main'); if (!main) return;
    const mains = [...el.querySelectorAll('.ui-tab-main')], i = mains.indexOf(main);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? mains.length - 1 : null;
    if (to !== null && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); const next = mains[(to + mains.length) % mains.length]; mains.forEach(m => { m.tabIndex = m === next ? 0 : -1; }); next.focus(); }
    else if (e.key === 'Delete' || (e.key === 'Backspace' && !e.metaKey)) { e.preventDefault(); o.close(idOf(tabOf(main))); }
  });

  // reorder inside the strip; a tab or a file dropped on it
  let dragging = null;
  const clear = () => el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  el.addEventListener('dragstart', e => {
    const t = tabOf(e.target); if (!t) return;
    dragging = idOf(t);
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(TAB_MIME, dragging); e.dataTransfer.setData('text/plain', dragging);
  });
  el.addEventListener('dragend', () => { dragging = null; clear(); });
  const payload = e => {
    if (dragging) return { id: dragging, tab: true };
    if (e.dataTransfer?.types.includes(TAB_MIME)) return { id: e.dataTransfer.getData(TAB_MIME), tab: true };
    return null;
  };
  el.addEventListener('dragover', e => {
    if (!o.drop) return;
    const types = e.dataTransfer?.types || [];
    if (!(dragging || types.includes(TAB_MIME) || types.includes('text/plain'))) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    clear(); const t = tabOf(e.target); if (t && idOf(t) !== dragging) t.classList.add('drop'); else if (!t) el.querySelector('.ui-tabs-set')?.lastElementChild?.classList.add('drop');
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) clear(); });
  el.addEventListener('drop', e => {
    if (!o.drop) return;
    const t = tabOf(e.target), p = payload(e) || { id: e.dataTransfer?.getData('text/plain') || '', tab: false };
    clear(); if (!p.id) return;
    e.preventDefault();
    o.drop(p, t && idOf(t) !== p.id ? idOf(t) : null);
  });
  return () => release.splice(0).forEach(f => f());
}

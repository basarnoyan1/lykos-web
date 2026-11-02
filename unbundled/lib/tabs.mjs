import { esc } from './html.mjs';
import { barsSettled } from './bar-fit.mjs';

// One tablist, two producers. tabList() writes the tablist a page puts in its own markup; a bar's `view` of kind 'tabs'
// (uiBar, lib/ui-actions.mjs) writes the same roles, ids, data-tab keys, aria-controls and roving tabindex inside its view
// switch. wireTabs works on either: it finds the list by id, so the arrow keys and the selection callback are the same, and
// the dropdown form a narrow bar gives a view (.ui-view-pick, opened by responsive-switches.mjs) selects through the same tabs.

export function tabList({ id, label, tabs, selected, panelId }) {
  return `<div id="${esc(id)}" role="tablist" aria-label="${esc(label)}" class="segmented nt-tabs">${tabs.map(([key, text]) => `<button type="button" role="tab" id="${esc(id)}-${esc(key)}" data-tab="${esc(key)}" aria-controls="${esc(panelId)}" aria-selected="${key === selected}" tabindex="${key === selected ? 0 : -1}" class="${key === selected ? 'on' : ''}">${esc(text)}</button>`).join('')}</div>`;
}

export function wireTabs(root, { id, onSelect }) {
  const list = root.querySelector(`#${id}`); if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  // A tab the bar has turned into a dropdown is not rendered and cannot hold focus: its dropdown does.
  const rendered = el => el && !(typeof el.getClientRects === 'function' && el.getClientRects().length === 0);
  // Focus follows the choice. The page is redrawn by onSelect, and a bar that was just drawn is measured in the next frame: a view switch may turn into its
  // dropdown form then, and the tab that was focused is no longer rendered. So focus goes to what is rendered now, and once the engine has settled it is
  // handed on again if it was lost with the tab (or left on something that no longer renders), unless the person has moved on to another control.
  const select = tab => {
    const key = tab.dataset.tab; onSelect(key);
    const target = () => {
      const now = root.querySelector(`#${id}-${key}`);
      return rendered(now) ? now : (now?.closest('.ui-view') || list.closest?.('.ui-view'))?.querySelector('.ui-view-pick');
    };
    target()?.focus({ preventScroll: true });
    const doc = root.ownerDocument || globalThis.document;
    if (!doc) return;
    barsSettled().then(() => {
      const at = doc.activeElement;
      if (at && at !== doc.body && at.isConnected && rendered(at)) return;
      target()?.focus({ preventScroll: true });
    });
  };
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab);
    tab.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); select(tabs[next]);
    };
  });
}

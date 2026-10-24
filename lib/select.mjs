// Every <select> opens the app's own menu (lib/menu.mjs), not the system's
// popup, so all dropdowns look and behave alike: same rows, same check mark,
// same keys. The <select> stays in the page, so its value, its change event
// and every view's code are untouched; only the press that would open the
// system popup is taken. Arrow keys on a closed select still step its value.
import { showMenu } from './menu.mjs';

function open(sel) {
  const items = [];
  for (const node of sel.children) {
    if (node.tagName === 'OPTGROUP') {
      if (items.length) items.push('-');
      for (const o of node.children) items.push(item(sel, o));
    } else if (node.tagName === 'OPTION' && !node.hidden) items.push(item(sel, node));
  }
  showMenu(sel, items, { focusChecked: true });
}

function item(sel, o) {
  return { label: o.textContent.trim() || '—', checked: o.selected, disabled: o.disabled, font: sel.hasAttribute('data-font-list') ? o.value : '',
    run: () => {
      if (sel.value === o.value) return;
      sel.value = o.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    } };
}

const plain = sel => sel && !sel.disabled && !sel.multiple && !(sel.size > 1);

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', e => {
    const sel = e.target.closest?.('select');
    if (e.button !== 0 || !plain(sel)) return;
    e.preventDefault(); sel.focus({ preventScroll: true }); open(sel);
  }, true);
  document.addEventListener('keydown', e => {
    const sel = e.target;
    if (sel?.tagName !== 'SELECT' || !plain(sel)) return;
    if (e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
      e.preventDefault(); e.stopPropagation(); open(sel);
    }
  }, true);
}

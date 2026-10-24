import { showMenu } from './menu.mjs';
import { icon } from './icons.mjs';

// Preserve each view's existing choices and handlers. Only their presentation
// changes when the labels need more room than the group can provide.
//
// A view switch inside a bar (.ui-bar) belongs to the width engine (bar-fit.mjs), which chooses between the segmented and the
// dropdown form by measurement: this file never fits it. It only opens the dropdown form's menu and keeps its label current.
const inBar = el => !!el.closest?.('.ui-bar');
const groups = new Map();
const canvas = document.createElement('canvas');
const measure = canvas.getContext('2d');
let pending = false;
function fit(group, pick) {
  const buttons = [...group.children].filter(b => b.tagName === 'BUTTON' && b !== pick && !b.hidden);
  if (buttons.length < 2) return;
  const selected = buttons.find(b => b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true') || buttons[0];
  const label = selected.textContent.trim().replace(/\s+/g, ' ');
  if (pick.firstElementChild.textContent !== label) pick.firstElementChild.textContent = label;
  pick.setAttribute('aria-label', `${group.getAttribute('aria-label') || 'View'}: ${label}`);
  group.classList.remove('switch-dropdown');
  const style = getComputedStyle(group);
  const space = group.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  let needed = (parseFloat(style.columnGap) || 0) * (buttons.length - 1);
  for (const b of buttons) {
    const s = getComputedStyle(b);
    measure.font = s.font;
    const text = measure.measureText(b.textContent.trim().replace(/\s+/g, ' ')).width;
    const icons = [...b.querySelectorAll('.ico')].reduce((n, e) => n + e.getBoundingClientRect().width + (parseFloat(s.columnGap) || 0), 0);
    needed += Math.max(b.scrollWidth, text + icons + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight));
  }
  group.classList.toggle('switch-dropdown', needed > space + 1);
  pick.onclick = () => showMenu(pick, buttons.map(b => ({
    label: b.textContent.trim().replace(/\s+/g, ' '),
    checked: b === selected, disabled: b.disabled, run: () => b.click(),
  })));
}
function sync() {
  pending = false;
  for (const [group, { observer }] of groups) {
    if (!group.isConnected) { observer.disconnect(); groups.delete(group); }
  }
  for (const group of document.querySelectorAll('.segmented')) {
    if (inBar(group) || groups.has(group) || group.querySelectorAll(':scope > button').length < 2) continue;
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'switch-pick'; pick.setAttribute('aria-haspopup', 'menu');
    pick.innerHTML = `<span></span>${icon('chevron-down')}`;
    group.append(pick);
    let width = -1;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0].contentRect.width);
      if (next !== width) { width = next; schedule(); }
    });
    observer.observe(group.parentElement);
    groups.set(group, { pick, observer });
  }
  for (const [group, { pick }] of groups) fit(group, pick);
}
function schedule() {
  if (!pending) { pending = true; requestAnimationFrame(sync); }
}
// ---- the dropdown form of a bar's view switch ----------------------------------------------------------------------------
// The engine shows .ui-view-pick instead of .ui-view-set when the switch does not fit. Its menu lists the same buttons and
// clicks the real one, so the view's handlers (and wireTabs) run exactly as for a click on the segmented form.
const isOn = b => b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true';
const textOf = b => (b.querySelector(':scope > span:not(.ui-count)')?.textContent ?? b.textContent).replace(/\s+/g, ' ').trim();
const buttonsOf = set => [...set.querySelectorAll(':scope > button')];
function syncViewPick(view) {
  const set = view.querySelector(':scope > .ui-view-set'), pick = view.querySelector(':scope > .ui-view-pick');
  if (!set || !pick) return;
  const on = buttonsOf(set).find(isOn); if (!on) return;
  const label = textOf(on), value = pick.querySelector('.ui-picker-value');
  // a pick that holds every value (ui-actions viewHtml) marks the current one, so its width never changes; an older pick takes the text
  if (value?.hasAttribute('data-pick-values')) { for (const s of value.querySelectorAll(':scope > [data-pick-value]')) s.toggleAttribute('data-pick-current', s.textContent.trim() === label); }
  else if (value && value.textContent !== label) value.textContent = label;
  const name = `${set.getAttribute('aria-label') || 'View'}: ${label}`;
  if (pick.getAttribute('aria-label') !== name) pick.setAttribute('aria-label', name);
}
document.addEventListener('click', e => {
  const pick = e.target.closest?.('.ui-bar .ui-view-pick'); if (!pick) return;
  const view = pick.closest('.ui-view'), set = view?.querySelector(':scope > .ui-view-set'); if (!set) return;
  syncViewPick(view);
  showMenu(pick, buttonsOf(set).map(b => ({ label: textOf(b), meta: b.querySelector('.ui-count')?.textContent.trim() || undefined, checked: isOn(b), checkType: 'radio', disabled: b.disabled, run: () => b.click() })), { matchWidth: true });
});

new MutationObserver(records => {
  for (const r of records) if (r.type === 'attributes' && inBar(r.target) && r.target.matches('.ui-view-set > button')) syncViewPick(r.target.closest('.ui-view'));
  if (records.some(r => !inBar(r.target) && (r.type === 'childList'
    ? (!r.target.closest('.switch-pick') && (r.target.closest('.segmented') || [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches('.segmented') || n.querySelector('.segmented')))))
    : r.target.matches('.segmented > button:not(.switch-pick)')))) schedule();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected', 'class', 'disabled'] });
schedule();

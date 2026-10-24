// The chat's budget: two fields in a popover anchored to the chat's model picker (DIALOGS §4.2). The defaults for a chat without
// its own budget are two rows of Settings > AI > Models (`chatBudget`); this popover sets the budget of the open chat only.
import { esc } from './html.mjs';
import { num } from './dates.mjs';
import { formField } from './ui-components.mjs';
import { dialogFoot } from './ui-actions.mjs';
import { closeMenu, onMenuOpen, placeMenu } from './menu.mjs';
import { BUDGET_LIMITS } from './chat-sessions.mjs';

/** A typed count: digits with any grouping ("80,000", "80 000"); NaN when it is not a whole number. */
export const budgetNumber = text => { const t = String(text ?? '').replace(/[\s,.'  ]/g, ''); return /^\d+$/.test(t) ? Number(t) : NaN; };

/** What is wrong with a budget, or '' when both values are within their bounds. */
export function budgetProblem({ calls, tokens }) {
  const [c0, c1] = BUDGET_LIMITS.calls, [t0, t1] = BUDGET_LIMITS.tokens;
  if (!Number.isInteger(calls) || calls < c0 || calls > c1) return `Calls per turn: ${c0} to ${c1}`;
  if (!Number.isInteger(tokens) || tokens < t0 || tokens > t1) return `Token ceiling: ${num(t0)} to ${num(t1)}`;
  return '';
}

/** A count field: text with a numeric keyboard, never a spinner. */
export const countInput = (name, value) => `<input type="text" name="${esc(name)}" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(num(value))}">`;

export function chatBudgetHtml({ calls, tokens }) {
  return `<form class="chat-budget-form"><p class="chat-budget-title" id="chat-budget-title">Budget for this chat</p>
    ${formField('Calls per turn', countInput('calls', calls))}
    ${formField('Token ceiling', countInput('tokens', tokens))}
    <p class="meta" role="status" data-budget-problem></p>
    ${dialogFoot({ label: 'Chat budget', id: 'chat-budget-foot', actions: [
      { id: 'chat-budget-cancel', label: 'Cancel', keep: true, attrs: { 'data-no': true } },
      { id: 'chat-budget-save', label: 'Save', role: 'primary', type: 'submit' }] })}</form>`;
}

let active = null;
export function closeChatBudget({ focus = false } = {}) { active?.close(focus); }
onMenuOpen(() => closeChatBudget());

/**
 * Opens the popover under `anchor` (the model picker, or More when the picker has folded into it). `save(budget)` stores it and
 * returns a message for the status line, or throws when the chat changed. A second press on the same anchor closes it.
 */
export function openChatBudget(anchor, { budget, save, say = () => {} }) {
  if (active?.anchor === anchor) { closeChatBudget({ focus: true }); return; }
  closeChatBudget(); closeMenu();
  const pop = document.createElement('div');
  pop.className = 'chat-budget-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-labelledby', 'chat-budget-title');
  pop.innerHTML = chatBudgetHtml(budget);
  document.body.append(pop);
  const events = new AbortController(), on = { signal: events.signal };
  const close = (focus = false) => {
    if (active?.pop !== pop) return;
    active = null; events.abort(); pop.remove(); anchor.setAttribute('aria-expanded', 'false');
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  active = { anchor, pop, close };
  anchor.setAttribute('aria-expanded', 'true');
  // Under the picker (above it when there is no room), its start edge at the picker's and inside the window; CSS holds the edge, so
  // a resize needs no listener.
  const r = anchor.getBoundingClientRect(), at = placeMenu(r, pop.offsetHeight);
  pop.style.left = `max(8px, min(${r.left}px, calc(100vw - 8px - min(280px, 100vw - 16px))))`;
  pop.style.top = `${at.top + (at.top >= r.bottom ? 4 : -4)}px`;
  if (at.maxHeight != null) pop.style.maxHeight = `${at.maxHeight}px`;
  const form = pop.querySelector('form'), problem = pop.querySelector('[data-budget-problem]');
  form.onsubmit = e => {
    e.preventDefault();
    const next = { calls: budgetNumber(form.elements.calls.value), tokens: budgetNumber(form.elements.tokens.value) };
    const wrong = budgetProblem(next);
    form.elements.calls.toggleAttribute('aria-invalid', wrong.startsWith('Calls'));
    form.elements.tokens.toggleAttribute('aria-invalid', wrong.startsWith('Token'));
    if (wrong) { problem.textContent = wrong; form.elements[wrong.startsWith('Calls') ? 'calls' : 'tokens'].focus(); return; }
    try { say(save(next)); close(true); } catch (err) { problem.textContent = err.message; }
  };
  pop.querySelector('[data-no]').onclick = () => close(true);
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
  document.addEventListener('pointerdown', e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); }, { ...on, capture: true });
  addEventListener('blur', () => close(), on);
  form.elements.calls.focus({ preventScroll: true }); form.elements.calls.select();
}

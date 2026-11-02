// Local calendar dates remain YYYY-MM-DD; no UTC conversion or time-zone shift.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { uiBar } from './ui-actions.mjs';
import { day, monthYear, longDay } from './dates.mjs';

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(0); date.setFullYear(y, m - 1, d); date.setHours(12, 0, 0, 0);
  return y >= 1 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
export const dateValue = date => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const label = (value, empty = 'Choose date') => parseDate(value) ? day(value) : empty;
const nameOf = (name, value, empty = 'Choose date') => parseDate(value) ? `${name}: ${label(value)}` : empty === 'Choose date' ? `${name}: ${empty}` : name;
let closeActive = () => {};

/** `empty` is what an unset field says ("Start date", "End date"), so two dates in one row tell which is which. */
export function dateField(id, value = '', name = 'Date', empty = 'Choose date') {
  return `<div class="date-field"><input type="hidden" id="${esc(id)}" value="${esc(value)}"><button type="button" class="date-trigger" data-date-for="${esc(id)}"${empty === 'Choose date' ? '' : ` data-empty="${esc(empty)}"`} aria-label="${esc(nameOf(name, value, empty))}" aria-haspopup="dialog" aria-expanded="false"><span>${esc(label(value, empty))}</span>${icon('calendar')}</button></div>`;
}

export function wireDateField(root, id, name = 'Date') {
  const input = root.querySelector(`#${id}`), trigger = root.querySelector(`[data-date-for="${id}"]`);
  trigger.onclick = () => {
    if (trigger.getAttribute('aria-expanded') === 'true') { closeActive(); return; }
    closeActive();
    let selected = parseDate(input.value), cursor = selected || new Date();
    cursor.setHours(12, 0, 0, 0);
    let month = new Date(cursor); month.setDate(1);
    const popup = document.createElement('div');
    popup.className = 'date-calendar'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', name);
    popup.id = `${id}-calendar`; trigger.setAttribute('aria-controls', popup.id);
    trigger.setAttribute('aria-expanded', 'true'); (trigger.closest('dialog[open]') || document.body).append(popup);   // a modal dialog is in the top layer: the calendar opens inside it
    const events = new AbortController(), opts = { signal: events.signal };
    const close = (restore = true) => {
      events.abort(); observer.disconnect(); popup.remove(); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
      if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
      closeActive = () => {};
    };
    closeActive = close;
    const observer = new MutationObserver(() => { if (!trigger.isConnected) close(false); });
    observer.observe(root, { childList: true, subtree: true });
    const place = () => {
      const r = trigger.getBoundingClientRect(), w = popup.offsetWidth, h = popup.offsetHeight;
      popup.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
      popup.style.top = `${Math.max(8, r.bottom + h + 6 > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6)}px`;
    };
    const choose = value => {
      input.value = value;
      const empty = trigger.dataset.empty || 'Choose date';
      trigger.querySelector('span').textContent = label(value, empty);
      trigger.setAttribute('aria-label', nameOf(name, value, empty));
      close(); input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const draw = (focusDay = true) => {
      const first = new Date(month); first.setDate(1 - (first.getDay() + 6) % 7);
      const today = dateValue(new Date()), chosen = selected && dateValue(selected);
      const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(d.getDate() + i); return d; });
      popup.innerHTML = `${uiBar({ kind: 'head', density: 'dense', label: 'Month', id: `${id}-cal-head`, attrs: { 'aria-live': 'polite' }, lead: { title: monthYear(month), level: 'p' },
          actions: [{ id: `${id}-prev`, label: 'Previous month', icon: 'chevron-left', role: 'quiet', attrs: { 'data-prev': '' } }, { id: `${id}-next`, label: 'Next month', icon: 'chevron-right', role: 'quiet', attrs: { 'data-next': '' } }] })}
        <div class="date-weekdays" aria-hidden="true">${['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => `<span>${d}</span>`).join('')}</div>
        <div class="date-days" role="group" aria-label="Choose a day">${days.map(d => {
          const value = dateValue(d);
          return `<button type="button" data-day="${value}" tabindex="${value === dateValue(cursor) ? '0' : '-1'}" class="${d.getMonth() !== month.getMonth() ? 'outside' : ''}" aria-label="${esc(longDay(d))}" aria-pressed="${value === chosen}"${value === today ? ' aria-current="date"' : ''}>${d.getDate()}</button>`;
        }).join('')}</div>${uiBar({ kind: 'foot', density: 'dense', label: 'Date shortcuts', id: `${id}-cal-foot`, actions: [{ id: `${id}-clear`, label: 'Clear', role: 'quiet', disabled: !input.value, attrs: { 'data-clear': '' } }, { id: `${id}-today`, label: 'Today', attrs: { 'data-today': '' } }] })}`;
      place(); if (focusDay) popup.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    };
    const shiftMonth = delta => {
      const day = cursor.getDate(); month.setMonth(month.getMonth() + delta);
      cursor = new Date(month); cursor.setMonth(cursor.getMonth() + 1, 0); cursor.setDate(Math.min(day, cursor.getDate()));
    };
    popup.onclick = e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.day) choose(b.dataset.day);
      else if (b.hasAttribute('data-today')) choose(dateValue(new Date()));
      else if (b.hasAttribute('data-clear')) choose('');
      else { const prev = b.hasAttribute('data-prev'); shiftMonth(prev ? -1 : 1); draw(false); popup.querySelector(prev ? '[data-prev]' : '[data-next]').focus(); }
    };
    popup.onkeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (!e.target.matches('[data-day]')) return;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (delta !== undefined) cursor.setDate(cursor.getDate() + delta);
      else if (e.key === 'Home') cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);
      else if (e.key === 'End') cursor.setDate(cursor.getDate() + 6 - (cursor.getDay() + 6) % 7);
      else if (e.key === 'PageUp' || e.key === 'PageDown') shiftMonth((e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1));
      else return;
      e.preventDefault(); month = new Date(cursor); month.setDate(1); draw();
    };
    document.addEventListener('pointerdown', e => { if (!popup.contains(e.target) && !trigger.contains(e.target)) close(false); }, opts);
    document.addEventListener('focusin', e => { if (!popup.contains(e.target) && !trigger.contains(e.target)) close(false); }, opts);
    document.addEventListener('scroll', e => { if (!popup.contains(e.target)) close(false); }, { ...opts, capture: true });
    window.addEventListener('resize', () => close(false), opts);
    draw();
  };
}

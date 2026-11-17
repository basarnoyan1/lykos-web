// Let the browser finish a native blur/Tab before replacing a form. Retain
// the newly focused control and the researcher's open records across the paint.
const pending = new WeakMap();
export function rerenderForm(el, ctx, options = {}) {
  if (pending.has(el)) { Object.assign(pending.get(el), options); return; }
  pending.set(el, options);
  setTimeout(() => {
    const requested = pending.get(el);
    pending.delete(el);
    if (!el.isConnected) return;
    const active = document.activeElement;
    const key = el.contains(active) ? active?.getAttribute('data-form-key') : null;
    const id = el.contains(active) ? active?.id : null;
    const selection = active && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    const records = new Map([...el.querySelectorAll('details[data-edit-record]')]
      .map(d => [d.dataset.editRecord, d.open]));
    ctx.rerender();
    for (const d of el.querySelectorAll('details[data-edit-record]')) {
      if (records.has(d.dataset.editRecord)) d.open = records.get(d.dataset.editRecord);
    }
    let replacement = key ? [...el.querySelectorAll('[data-form-key]')].find(x => x.getAttribute('data-form-key') === key)
      : id ? [...el.querySelectorAll('[id]')].find(x => x.id === id) : null;
    if (!replacement && el.contains(active) === false && (key || id) && requested.fallback) replacement = el.querySelector?.(requested.fallback);
    if (replacement && !replacement.disabled) {
      replacement.focus({ preventScroll: true });
      if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
    }
    requested.after?.();
  }, 0);
}

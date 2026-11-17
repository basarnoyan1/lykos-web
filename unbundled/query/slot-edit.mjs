// A term edited in place in the blocks (query.html, Text mode; 8 Nov 2026, the owner: "why the double click does not allow editing
// here?"). A double click on a term's slot, or Enter or F2 on a focused slot or row, turns the slot into an input of its own size and
// shape holding the term's words without their quotes. Enter, Tab or leaving it writes the words back into the query's text at the term's
// span (data-at, data-end): only the words change, so the field tag, the proximity, the heading's brackets the term had stay, and a
// phrase is quoted where the database needs it. An emptied term is removed with its operator, as a block dropped on the text is. Escape
// gives the slot back as it was. The text changes the way typing would, so the field's own undo takes an edit back.
import { nodeAt } from '../lib/query-edit.mjs';
import { reveal } from './edit.mjs';

const SLOT = '.qb-slot[data-at]';
// Ovid reads adjacent words as one phrase and has no quotes; the others quote a phrase, or a term with a character their syntax reads,
// and keep the quotes of a single word that was quoted on purpose (a phrase's quotes were the phrase's, not a choice)
const NEEDS = /[\s()/,:[\]]/;
const quoted = (t, was, d) => (d === 'ovid' || d === 'embase' ? t : NEEDS.test(t) || (was && !NEEDS.test(was)) ? `"${t.replace(/"/g, '')}"` : t);

/**
 * Wires editing in place on `blocks`. `model()` and `text()` are the page's; `replace(at, end, s)` puts `s` in the text at that span as
 * typing would; `remove(path)` removes a term as the drag code does; `drawn()` draws the blocks from the text now.
 */
export function mountSlotEdit(blocks, { model, text, replace, remove, drawn }) {
  let editing = null;
  const slots = () => [...blocks.querySelectorAll(SLOT)];

  function open(slot) {
    if (!slot || editing) return;
    const m = model(), term = slot.dataset.path ? nodeAt(m, slot.dataset.path) : null;
    if (!term || term.kind !== 'term') return;
    const at = +slot.dataset.at, end = +slot.dataset.end, raw = text().slice(at, end), before = slot.innerHTML;
    slot.classList.add('qb-grow'); slot.dataset.v = term.text;
    slot.innerHTML = '<input type="text" size="1" spellcheck="false" autocomplete="off">';
    const input = slot.firstElementChild;
    input.value = term.text; input.setAttribute('aria-label', `Term ${term.text}`);
    input.addEventListener('input', () => { slot.dataset.v = input.value || ' '; });
    const index = slots().indexOf(slot);
    let done = false;
    editing = slot;
    input.focus({ preventScroll: true }); input.select(); reveal(slot);

    // how: 'keep' writes the words back; 'cancel' gives the slot back; step: the slot to edit next (Tab: 1, Shift+Tab: -1)
    const finish = (how, step = 0) => {
      if (done) return;
      done = true; editing = null;
      const words = input.value.trim().replace(/^"(.*)"$/, '$1');
      if (how === 'cancel' || words === term.text) {
        slot.classList.remove('qb-grow'); delete slot.dataset.v; slot.innerHTML = before;
        if (how === 'cancel') slot.focus({ preventScroll: true });
      } else if (!words) { remove(slot.dataset.path); if (step > 0) step = 0; }
      else {
        // only the words change: the tag, proximity or brackets round them in the span stay as they were
        const old = term.quoted ? `"${term.text}"` : term.text;
        let i = raw.indexOf(old), len = old.length;
        if (i < 0) { i = raw.indexOf(term.text); len = term.text.length; }
        const put = quoted(words, term.quoted ? term.text : '', m.dialect);
        replace(at, end, i < 0 ? put : raw.slice(0, i) + put + raw.slice(i + len));
      }
      if (!step && how !== 'tab') return;
      drawn();
      const next = slots()[index + step];
      if (next) open(next);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish('keep'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
      else if (e.key === 'Tab') { e.preventDefault(); finish('tab', e.shiftKey ? -1 : 1); }
    });
    input.addEventListener('blur', () => finish('keep'));
  }

  blocks.addEventListener('dblclick', e => { const s = e.target.closest(SLOT); if (s && !e.target.closest('input')) { e.preventDefault(); open(s); } });
  blocks.addEventListener('keydown', e => {
    if (e.target.closest('input') || (e.key !== 'Enter' && e.key !== 'F2')) return;
    const s = e.target.matches(SLOT) ? e.target : e.target.querySelector?.(`:scope > ${SLOT}`);
    if (s) { e.preventDefault(); open(s); }
  });
  return { open, get editing() { return !!editing; } };
}

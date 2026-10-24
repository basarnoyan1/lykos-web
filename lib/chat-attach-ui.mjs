// "Ask about this", the part that loads on the first gesture (lib/chat-attach-menu.mjs is what the shell loads at start): finding the item under a
// gesture by the hooks the views already draw, reading a selection, building the item (lib/chat-attach-kinds.mjs) and attaching it
// (lib/chat-attach.mjs). Nothing is sent by any of it: an item waits above the composer for the next message the person sends.
import { shell, askItem } from './chat-attach-menu.mjs';
import { showMenu } from './menu.mjs';

const text = el => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const asElement = n => (n?.nodeType === 1 ? n : n?.parentElement || null);

/** The resolvers, most specific first: the element the person pointed at to { kind, ref, key } (ref names the item by ids and raw text). */
const RESOLVERS = [
  // an Extraction cell: the grid draws `td[data-cell="<paper>|<column>"]`
  el => {
    const td = el.closest('.ext-grid td[data-cell]'); if (!td) return null;
    const [paperId, columnId] = String(td.dataset.cell).split('|'); if (!paperId || !columnId) return null;
    return { kind: 'cell', ref: { paperId, columnId }, key: td.dataset.cell };
  },
  // an Extraction row: the study's heading cell; its table is the one its cells name
  el => {
    const tr = el.closest('.ext-grid tr[data-row]'); if (!tr) return null;
    const col = (tr.querySelector('td[data-cell]')?.dataset.cell || '').split('|')[1] || '', templateId = col.includes('.') ? col.split('.')[0] : 'default';
    return { kind: 'row', ref: { paperId: tr.dataset.row, templateId }, key: `${tr.dataset.row}|${templateId}` };
  },
  // a row of an answer's table in the chat
  el => {
    const tr = el.closest('.chat-table-wrap tbody tr'); if (!tr) return null;
    const columns = [...tr.closest('table').querySelectorAll('thead th')].map(text), cells = [...tr.cells].map(text), title = text(tr.closest('.chat-block')?.querySelector('h3'));
    return { kind: 'table-row', ref: { columns, cells, paperId: tr.querySelector('[data-paper-id]')?.dataset.paperId || null, title }, key: `${title}|${cells.join('|').slice(0, 120)}` };
  },
  // a saved or built-in output of Tables and figures
  el => { const row = el.closest('[data-output]'); return row ? { kind: 'output', ref: { outputId: row.dataset.output }, key: row.dataset.output } : null; },
  // a library record: the list's rows are `.ui-row[data-row]`
  el => { const row = el.closest('.ui-row[data-row]'); return row ? { kind: 'reference', ref: { paperId: row.dataset.row }, key: row.dataset.row } : null; },
];
export function targetAt(node) {
  const el = asElement(node); if (!el?.closest) return null;
  for (const resolve of RESOLVERS) { const t = resolve(el); if (t) return t; }
  return null;
}

/**
 * Builds the item and attaches it, then shows the chat. The builders load on first use (the output renderer is among them). A refusal (the list is
 * full, the item is gone) is said in words. Returns true when the item is attached.
 */
export async function askAbout(target) {
  if (!target) { shell.say('There is nothing here to ask about.'); return false; }
  let built = null;
  try {
    const kinds = await import('./chat-attach-kinds.mjs');
    built = kinds.buildContext(target.kind, target.ref, shell.state(), target.kind === 'output' ? { render: (await import('./output-render.mjs')).renderOutput } : {});
  } catch (err) { console.warn('[ask]', err); }
  if (!built) { shell.say('That item has nothing to attach.'); return false; }
  const result = (await shell.store.ensure()).attachItem(built, target.key);   // the list the shell reads (it loads here, before the first item)
  if (!result.ok) { shell.say(result.reason); return false; }
  shell.open();
  return true;
}

/**
 * The text selected now and where it is: a note's text box, else the page's selection, else what the shell held when a control was pressed that
 * would drop it. `hint` says which document is meant (`pdf-selection`, `manuscript-selection`, `note-selection`); `selection` leaves it to where the words are.
 */
export function readSelection(hint = 'selection') {
  const box = document.querySelector('#nt-text, #jr-text'), reader = shell.reader?.();
  if (hint === 'note-selection' && box && box.selectionEnd > box.selectionStart) return { kind: hint, text: box.value.slice(box.selectionStart, box.selectionEnd).trim() };
  const live = String(getSelection?.() || '').trim(), anchor = asElement(getSelection?.()?.anchorNode);
  if (hint === 'pdf-selection' && (reader?.selected_text || live)) return { kind: hint, text: String(reader?.selected_text || live).trim(), paperId: reader?.paper_id || null, page: reader?.page || null };
  const kind = hint !== 'selection' ? hint : anchor?.closest('.textLayer,.fv-doc') ? 'pdf-selection' : anchor?.closest('.mb-edit,.pg') ? 'manuscript-selection' : 'selection';
  const words = live || String(shell.held?.() || '').trim();
  return words ? { kind, text: words, ...(kind === 'pdf-selection' ? { paperId: reader?.paper_id || null, page: reader?.page || null } : {}) } : null;
}

/** A selection of a kind, read now and attached. */
export async function askAboutSelection(kind = 'selection') {
  const sel = readSelection(kind);
  if (!sel?.text) { shell.say('Select some text first.'); return false; }
  return askAbout({ kind: sel.kind, ref: { text: sel.text, paperId: sel.paperId || null, page: sel.page || null }, key: `${sel.text.length}:${sel.text.slice(0, 80)}` });
}

/** What "this" means: the selected words, else the item the focus names, else the page's own selection (a cell, a record, the open output). */
export function focusedTarget(from = document.activeElement) {
  if (readSelection('selection')) return { selection: true };
  const byDom = targetAt(from); if (byDom) return byDom;
  const { view, views } = shell.view(), cell = view === 'extraction' ? views.extraction?.selection?.() : null;
  if (cell) return { kind: 'cell', ref: { paperId: cell.paperId, columnId: cell.columnId }, key: `${cell.paperId}|${cell.columnId}` };
  const paperId = view === 'library' || view === 'screening' ? views[view]?.selection?.() : null;
  if (paperId) return { kind: 'reference', ref: { paperId }, key: paperId };
  const outputId = view === 'outputs' ? views.outputs?.current?.() : null;
  return outputId ? { kind: 'output', ref: { outputId }, key: outputId } : null;
}
/** From the assistant menu or the palette: attaches what is selected or focused; with nothing to attach it only opens the chat. */
export async function askFocused(from) {
  const target = focusedTarget(from);
  if (!target) { shell.open(); return false; }
  return target.selection ? askAboutSelection('selection') : askAbout(target);
}

/** The one-entry menu on an item, at the pointer or (from the keyboard) under the item. */
export function contextMenu(el, point) {
  const target = targetAt(el); if (!target) return;
  showMenu(point || el.closest('td,tr,.ui-row') || el, [askItem(target)]);
}

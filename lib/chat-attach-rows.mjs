// The rows above the composer for what is attached (lib/chat-attach.mjs): the shared list and row, kind and label with the size under it, Leave out as
// the row's inline act and a More that shows the text that will be sent (or leaves every item out). Loaded when the first item is attached.
import { esc } from './html.mjs';
import { uiList, uiRow, uiRowEnd } from './ui-actions.mjs';
import { plural } from './dates.mjs';
import { showMenu, showPopover } from './menu.mjs';
import { attachments, leaveOut, clearAttachments } from './chat-attach.mjs';

/** The classes of data the items hold, each once (what a later scope check will ask about). */
export const attachedClasses = (items = attachments()) => [...new Set(items.map(a => a.dataClass))];
/** One line on what is attached: "2 items · 1,420 characters". */
export const attachedSummary = (items = attachments()) => `${plural(items.length, 'item')} · ${plural(items.reduce((n, a) => n + a.size, 0), 'character')}`;

/** Empty when nothing is attached, so the composer sits where it did. */
export function attachRowsHtml(items = attachments()) {
  if (!items.length) return '';
  return uiList({ id: 'assist-attach-list', label: 'Attached to the next message', cls: 'assist-attach-list',
    rows: items.map(a => uiRow({ id: `attach-${a.no}`, attrs: { 'data-attach': a.id, 'data-class': a.dataClass },
      main: { html: `<span class="ui-row-title" title="${esc(`${a.word}: ${a.label}`)}">${esc(a.word)}: ${esc(a.label)}</span>`, detail: [plural(a.size, 'character')] },
      end: uiRowEnd({ inline: { id: `attach-out-${a.no}`, label: `Leave out ${a.word.toLowerCase()}: ${a.label}`, icon: 'close', attrs: { 'data-attach-out': a.id } },
        more: { label: `More for ${a.word.toLowerCase()}: ${a.label}`, attrs: { 'data-attach-more': a.id } } }) })) });
}

/** Draws the rows into the shell's host (wired once: Leave out, and a row's More; the composer takes the focus back after one is left out). */
export function draw(items) {
  const host = globalThis.document?.getElementById('assist-attach'); if (!host) return;
  if (!host.dataset.wired) wire(host, () => document.getElementById('assist-in')?.focus());
  host.innerHTML = attachRowsHtml(items);
}
function wire(host, done) {
  host.dataset.wired = '1';
  host.addEventListener('click', e => {
    const out = e.target.closest?.('[data-attach-out]');
    if (out) { leaveOut(out.dataset.attachOut); done(); return; }
    const more = e.target.closest?.('[data-attach-more]'); if (!more) return;
    const item = attachments().find(a => a.id === more.dataset.attachMore); if (!item) return;
    showMenu(more, [
      { label: 'Show what is sent', icon: 'preview', run: () => showPopover(more, { label: `${item.word}: ${item.label}`, html: `<div class="assist-attach-text" tabindex="0">${esc(item.text)}</div>` }) },
      ...(attachments().length > 1 ? [{ label: 'Leave out all', icon: 'close', run: () => { clearAttachments(); done(); } }] : []),
    ], { align: 'end' });
  });
}

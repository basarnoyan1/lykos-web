// What is attached, inside the composer's box above the text (lib/chat-attach.mjs; Plane's token for what the chat reads, Gumloop's attached
// file; owner via the Mobbin review, 2026-10-23): one small token per item, its kind and label, which shows the text that will be sent, and
// a remove mark. Nothing sits above the box. Loaded when the first item is attached.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { plural } from './dates.mjs';
import { showPopover } from './menu.mjs';
import { attachments, leaveOut } from './chat-attach.mjs';

/** The classes of data the items hold, each once (what a later scope check will ask about). */
export const attachedClasses = (items = attachments()) => [...new Set(items.map(a => a.dataClass))];
/** One line on what is attached: "2 items, 1,420 characters". */
export const attachedSummary = (items = attachments()) => `${plural(items.length, 'item')}, ${plural(items.reduce((n, a) => n + a.size, 0), 'character')}`;

const KIND_ICON = { file: 'paperclip', reference: 'library', output: 'table', page: 'file', cell: 'extraction', row: 'extraction', 'table-row': 'table' };
/** Empty when nothing is attached, so the box holds only the text. */
export function attachRowsHtml(items = attachments()) {
  if (!items.length) return '';
  return items.map(a => `<span class="assist-token" data-attach="${esc(a.id)}" data-class="${esc(a.dataClass)}">`
    + `<button type="button" class="assist-token-label" data-attach-show="${esc(a.id)}" title="${esc(`${a.word}: ${a.label}, ${plural(a.size, 'character')}`)}">${icon(KIND_ICON[a.kind] || 'quote', { size: 12 })}<span>${esc(a.label)}</span></button>`
    + `<button type="button" class="assist-token-x" data-attach-out="${esc(a.id)}" aria-label="${esc(`Leave out ${a.word.toLowerCase()}: ${a.label}`)}" title="Leave out">${icon('close', { size: 12 })}</button></span>`).join('');
}

/** Draws the tokens into the composer's head (wired once: a token shows its text, its mark leaves it out and gives the focus back to the box). */
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
    const show = e.target.closest?.('[data-attach-show]'); if (!show) return;
    const item = attachments().find(a => a.id === show.dataset.attachShow); if (!item) return;
    showPopover(show, { label: `${item.word}: ${item.label}`, html: `<div class="assist-attach-text" tabindex="0">${esc(item.text)}</div>` });
  });
}

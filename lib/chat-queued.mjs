// The row of the one message waiting while a chat works (plan §6.0d): a notice bar in the composer's box. Send now ends the model's work at its
// next step and sends it; Edit gives it back to the box; Discard drops it. Drawn only when it changes, so typing and the clock never repaint it.
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_ui_components$enhancePageUi as enhancePageUi } from "../boot.mjs";

/** Draws the waiting message (`q` from assistant.queued(), or null to empty the row); wired once. */
export function draw(q, assistant, box) {
  const host = document.getElementById('assist-queued'); if (!host) return;
  if (!host.dataset.wired) {
    host.dataset.wired = '1';
    host.addEventListener('click', e => {
      const act = e.target.closest?.('button')?.id;
      if (act === 'assist-queued-now') assistant.sendNow();
      else if (act === 'assist-queued-edit') { const w = assistant.takeQueued(); if (w) { box.value = box.value.trim() ? `${w.text}\n\n${box.value}` : w.text; box.dispatchEvent(new Event('input')); box.focus(); } }
      else if (act === 'assist-queued-drop') assistant.dropQueued();
    });
  }
  const sig = q ? `${q.now ? 1 : 0}${q.text}` : '';
  if (host.dataset.sig === sig) return; host.dataset.sig = sig;
  host.innerHTML = q ? uiBar({ kind: 'head', label: 'Message waiting to send', id: 'assist-queued-bar', cls: 'ui-notice', lead: { text: q.text, level: 'p' }, actions: [
    { id: 'assist-queued-now', label: q.now ? 'Sending next' : 'Send now', icon: 'run', role: 'secondary', disabled: q.now, labelCh: 12 },
    { id: 'assist-queued-edit', label: 'Edit', icon: 'rename', role: 'secondary' },
    { id: 'assist-queued-drop', label: 'Discard', icon: 'close', role: 'quiet', iconOnly: true, plain: true }] }) : '';
  if (q) enhancePageUi(host);
}

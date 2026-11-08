import { saveState, saveError, onSaveState, persist, projectGeneration } from '../store.mjs';

export function saveMessage(state, error = '', { short = false } = {}) {
  return state === 'failed' ? `Could not save${error ? `: ${error}` : ''}` : state === 'saving' ? 'Saving…' : short ? 'Saved' : 'Saved to project';
}
/** Subscribe for one mounted surface; caller disposes on render/unmount. */
export function bindSaveFeedback(host, { prefix = () => '', state = saveState, error = saveError, subscribe = onSaveState, retry = persist, short = false, quiet = false, button: given = null } = {}) {   // quiet: the status bar owns Saving and Saved; this surface speaks only when a save fails
  const generation = projectGeneration();
  const message = document.createElement('span');
  // A page with a fixed slot for the message passes its own Retry button (a reserved act of its bar); otherwise Retry save sits after the message.
  const button = given || document.createElement('button');
  if (!given) { button.type = 'button'; button.className = 'quiet'; button.textContent = 'Retry save'; host.replaceChildren(message, button); }
  else host.replaceChildren(message);
  host.setAttribute('role', 'status');
  const paint = () => {
    if (generation !== projectGeneration()) return;
    const current = state();
    message.textContent = [prefix(), quiet && current !== 'failed' ? '' : saveMessage(current, error(), { short })].filter(Boolean).join(', '); host.title = message.textContent;
    host.dataset.saveState = current; button.hidden = current !== 'failed';
  };
  button.onclick = async () => {
    if (generation !== projectGeneration()) return;
    button.disabled = true;
    try { await retry(); } catch { /* The store supplies the actionable error. */ }
    finally { button.disabled = false; paint(); }
  };
  const dispose = subscribe(paint); paint();
  return { refresh: paint, dispose };
}

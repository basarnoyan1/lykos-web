// Progress with a known total, a component of the library in lib/ui-components.mjs kept in a module of its own: the shell's static graph is at its
// budget (app/test/startup-graph.test.mjs), and only the pages that run long work (the Library's PDF download) need the bar.
import { esc } from './html.mjs';

/**
 * Progress for work with a known total (a PDF download of many papers): a bar, the item it is on and "12 of 40". Ink on the rule colour,
 * as the transfers card's ring and the agent card's bar; a native <progress> so no inline style is needed (the app's CSP drops them).
 * `left` is a sentence the caller derived from the pace so far ("about 3 min left"), or ''.
 */
export function uiMeter({ done = 0, total = 0, label, now = '', left = '', id = '' } = {}) {
  const max = Math.max(1, Number(total) || 0), value = Math.min(max, Math.max(0, Number(done) || 0));
  const count = `${value.toLocaleString('en')} of ${max.toLocaleString('en')}${left ? `, ${left}` : ''}`;
  return `<div class="ui-meter"${id ? ` id="${esc(id)}"` : ''}><progress class="ui-meter-bar" max="${max}" value="${value}" aria-label="${esc(label || 'Progress')}"></progress>`
    + `<p class="ui-meter-line"><span class="ui-meter-now">${esc(now)}</span><span class="ui-meter-count">${esc(count)}</span></p></div>`;
}

// Settings > Models: which classes of data a connection may receive (plan §3.2, lib/egress.mjs). A cloud connection starts with none and a connection
// on this Mac with all but patient rows; the choice is saved on the connection, beside its endpoint and key, in the app-wide settings on this Mac. Built from the page's
// settings rows, so it lines up with every other row.
import { routeOf } from '../lib/ai.mjs';
import { CLASSES, LABELS, DETAILS, sendsOf, hostOfCfg } from '../lib/egress.mjs';
import { setSends } from '../lib/egress-scope.mjs';

/** The rows for the open connection `cur`; `srow` is the page's row builder and `off` its read-only attributes. */
export function scopeBody(srow, cur, off = {}) {
  const allowed = sendsOf(cur), host = hostOfCfg(cur);
  const where = routeOf(cur) === 'local' ? 'This Mac. Everything but patient rows is allowed until you change it' : `${host || 'This host'}. Nothing is sent until you allow a class`;
  return `<h3 class="setl-subhead">Data this connection may receive</h3>
    ${srow('Sent to', { readout: true, desc: where, find: 'data sent allowed receive privacy egress host' })}
    ${CLASSES.map(c => srow(LABELS[c], { desc: DETAILS[c], find: `data sent allowed receive privacy egress ${c}`,
      filters: [{ type: 'check', id: `ai-sends-${c}`, label: 'Allow', value: allowed.includes(c), attrs: { 'data-send-class': c, ...off } }] })).join('')}`;
}

/** Saves a change of the checks at once, on the open connection. `cur` reads it, `ctx.say` tells the person. */
export function wireScope(el, cur, ctx) {
  for (const box of el.querySelectorAll('[data-send-class]')) box.addEventListener('change', () => {
    const picked = [...el.querySelectorAll('[data-send-class]')].filter(b => b.checked).map(b => b.dataset.sendClass), c = cur();
    if (c && setSends(c.id, picked)) ctx.say?.('Saved');
  });
}

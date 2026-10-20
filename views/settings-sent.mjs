// Settings > Sent: what actually left this Mac for a model (plan §3.3, lib/sent-log.mjs), newest first, from the record the single send check keeps.
// Each entry is the time, the connection and its host (never its key), the model, the kind of request, the data classes, the size, the first 200
// characters of the last message and a hash of the whole request. It can be exported as CSV and cleared.
import { esc, emptyState } from '../lib/html.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { LABELS } from '../lib/egress.mjs';
import { sentEntries, sentCsv, clearSent, RETENTION } from '../lib/sent-log.mjs';
import { when, num, plural } from '../lib/dates.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { saveFile } from '../lib/save.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';

let page = 1;
const PAGE = 25;
const kindWords = k => String(k || 'request').replace(/[._-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const entryRow = e => uiRow({ attrs: { 'data-find': `sent ${e.kind} ${e.model} ${e.connection} ${e.host} ${(e.classes || []).join(' ')}`.toLowerCase(), 'data-sent': e.id },
  main: { html: esc(`${kindWords(e.kind)} · ${e.model || 'model'}`), wrap: true, detail: [esc(when(e.at)), esc(`${e.connection || 'Connection'} · ${e.route === 'local' ? 'this Mac' : e.host || 'cloud'}`),
    esc((e.classes || []).length ? e.classes.map(c => LABELS[c] || c).join(', ') : 'No project data'), esc(`${num(e.chars)} characters`), esc(`Hash ${String(e.hash).slice(0, 8)}`),
    e.excerpt ? esc(`“${e.excerpt}”`) : ''] } });

/** The section's rows; `srow` is the page's row builder. */
export function sentBody(srow, state) {
  const all = sentEntries(), shown = pageOf(all, page, PAGE);
  page = shown.page;
  return `${srow('Requests', { readout: true, desc: all.length ? `${plural(all.length, 'request')}, kept for ${RETENTION.days} days or ${num(RETENTION.entries)} requests. Excerpts and hashes only; keys are never logged` : 'None yet' })}
    ${srow('Log', { find: 'sent log export csv clear', actions: [{ id: 'sent-export', label: 'Export', icon: 'export', menu: true, disabled: !all.length }],
      overflow: [{ id: 'sent-clear', label: 'Clear log', danger: true, disabled: !all.length }] })}
    ${all.length ? uiList({ id: 'sent-list', label: 'Sent requests', rows: shown.items.map(entryRow) })
      + pager({ id: 'sent-pager', page: shown.page, pages: shown.pages, total: all.length, label: 'requests', size: PAGE })
      : emptyState({ title: 'Nothing has been sent from this Mac yet', size: 'inline' })}`;
}

export function wireSent(el, ctx) {
  const exportCsv = async () => {
    try { await saveFile(sentCsv(sentEntries()), `lykos-sent-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8'); ctx.say?.('Exported'); }
    catch (err) { ctx.say?.(`Could not export: ${String(err?.message || err).slice(0, 120)}`); }
  };
  el.querySelector('#sent-export')?.addEventListener('click', e => showMenu(e.currentTarget, [{ label: 'CSV', run: exportCsv }]));
  el.querySelector('#sent-clear')?.addEventListener('click', async () => {
    if (!await confirmAsk('Clear the Sent log?', { detail: 'The record of what was sent from this Mac is removed. Project data is not changed.', confirm: 'Clear', danger: true })) return;
    clearSent(); page = 1; ctx.rerender();
  });
  wirePager(el, 'sent-pager', n => { page = n; ctx.rerender(); });
}

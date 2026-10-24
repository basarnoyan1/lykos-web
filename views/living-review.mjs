// Literature: living-review mode (lib/living.mjs): update cadence, the last
// search, what is new since, ready to screen, and the retirement note.
//
// The title bar carries the state ('Active · update 12 Mar') and Switch off (More); the page is one short form on one label column
// (Status, Update, Retirement), one line of what the schedule says, and, below it, the records new since the last search.
import { get, update } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiSettingsRow } from '../lib/ui-actions.mjs';
import { metadataLine } from '../lib/ui-components.mjs';
import { day } from '../lib/dates.mjs';
import { CADENCES, STATUSES, livingOf, setLiving, lastSearch, schedule, newRecords, updates, markSeen, LSR_CITATION } from '../lib/living.mjs';
import { schedules, INTERVALS } from '../lib/schedule.mjs';
import { pagedItems, wireDataPager } from '../lib/list-pager.mjs';
import { authorLine, journalShort } from '../lib/bib.mjs';
import { showSubset, focusPaper } from './library.mjs';
import { focusRecords } from './screening.mjs';

const date = t => day(t) || 'None';
const save = patch => update(st => { setLiving(st, patch); return st; });

/** The title bar's part while Living review is open: its state as the status and Switch off in More (nothing while it is off). */
export function livingPage(rerender) {
  const s = get(), l = livingOf(s);
  if (!l.on) return {};
  const sc = schedule(s), state = STATUSES.find(([k]) => k === l.status)?.[1] || '';
  return { status: [state, sc.due != null && l.status === 'active' ? `update ${day(sc.due)}` : ''].filter(Boolean).join(', '),   // 'Active · update 4 Nov': the 24ch slot
    overflow: [{ id: 'live-off', label: 'Switch off living review', run: () => { save({ on: false }); rerender(); } }] };
}

const newRow = p => uiRow({ cls: 'live-new-row', attrs: { 'data-new-row': p.id },
  main: { html: `<button type="button" class="tk-text" data-new="${esc(p.id)}" title="${esc(p.title || '')}">${esc(p.title || p.label || '')}</button>`,
    detail: [esc(p.label || ''), esc([authorLine(p.authors), journalShort(p) || p.source].filter(Boolean).join(', '))], wrap: true } });

export function renderLiving(el, ctx) {
  const s = get(), l = livingOf(s);
  if (!l.on) {
    el.innerHTML = `<section class="lit-tool living">${emptyState({ icon: 'literature', title: 'Living review is off', detail: 'Repeats its searches on a schedule and adds the living-review reporting items.',
      actions: [{ id: 'live-on', label: 'Switch on', icon: 'check', primary: true }] })}</section>`;
    el.querySelector('#live-on').onclick = () => { save({ on: true }); ctx.rerender(); };
    return;
  }
  const sc = schedule(s), fresh = newRecords(s), ups = updates(s), sched = schedules();
  const pageKey = `living-new:${s.project?.id || s.project?.name || ''}`;
  const due = sc.due == null ? 'Set by the first search' : `${date(sc.due)}${sc.overdue ? `, ${Math.abs(sc.daysLeft)} ${Math.abs(sc.daysLeft) === 1 ? 'day' : 'days'} overdue` : sc.daysLeft != null && l.status === 'active' ? `, in ${sc.daysLeft} ${sc.daysLeft === 1 ? 'day' : 'days'}` : ''}`;
  el.innerHTML = `<section class="lit-tool living">
    <div class="lit-form-rows" id="live-form">
      ${uiSettingsRow({ id: 'live-status-row', label: 'Status', controls: { id: 'live-status-bar', filters: [{ type: 'select', id: 'live-status', label: 'Status', options: STATUSES, value: l.status }] } })}
      ${uiSettingsRow({ id: 'live-cadence-row', label: 'Update', controls: { id: 'live-cadence-bar', filters: [{ type: 'select', id: 'live-cadence', label: 'Update cadence', options: CADENCES, value: l.cadence }] } })}
      ${uiSettingsRow({ id: 'live-retire-row', label: 'Retirement', controls: { id: 'live-retire-bar', filters: [{ type: 'field', id: 'live-retire', label: 'Retirement trigger', placeholder: 'When the review will stop being updated', value: l.retirement, width: 'flex' }] } })}
    </div>
    <div class="lit-summary live-facts">${metadataLine([`Last search ${date(lastSearch(s))}`, `Next update ${due}`,
      sched.length ? `Scheduled: ${sched.map(x => `${x.sourceName}, ${INTERVALS.find(i => i.id === x.interval)?.label.toLowerCase() || x.interval}${x.pausedUntil && x.pausedUntil > Date.now() ? ', paused' : ''}`).join('; ')}` : 'No scheduled searches',
      `${ups.length} ${ups.length === 1 ? 'update' : 'updates'} run`])}</div>
    <p class="meta live-topics">Reporting topics: ${esc(LSR_CITATION)}</p>
    <div class="lit-results" id="live-new">
      ${uiBar({ kind: 'head', label: 'New since the last search', id: 'live-new-head', lead: { title: 'New since the last search', level: 'h2' }, status: { id: 'live-new-count', text: `${fresh.all.length} new, ${fresh.ready.length} to screen`, ch: 20 },
        actions: [{ id: 'live-lib', label: 'Show in Library', icon: 'library', role: 'quiet', disabled: !fresh.all.length }, { id: 'live-screen', label: 'Screen these', icon: 'run', disabled: !fresh.ready.length }],
        overflow: [{ id: 'live-seen', label: 'Mark all seen', disabled: !fresh.all.length }] })}
      ${fresh.all.length ? `<div class="lit-summary">${metadataLine(Object.entries(fresh.sources).map(([k, n]) => `${k} ${n}`))}</div><div class="live-new-list"></div>` : emptyState({ title: 'Nothing new', size: 'inline' })}
    </div></section>`;
  el.querySelector('#live-status').onchange = e => { save({ status: e.target.value }); ctx.rerender(); };
  el.querySelector('#live-cadence').onchange = e => { save({ cadence: e.target.value }); ctx.rerender(); };
  el.querySelector('#live-retire').onchange = e => save({ retirement: e.target.value });
  const list = el.querySelector('.live-new-list');
  if (list) {
    const drawList = () => {
      const page = pagedItems(fresh.all, pageKey, 10);
      list.innerHTML = uiList({ id: 'live-new-rows', label: 'New since the last search', rows: page.items.map(newRow) });
      wireDataPager(list.firstElementChild, pageKey, { total: page.total, size: 10, onChange: drawList });
      list.querySelectorAll('[data-new]').forEach(b => b.onclick = () => { focusPaper(b.dataset.new); ctx.go('library'); });
    };
    drawList();
  }
  el.querySelector('#live-lib').onclick = () => { showSubset(fresh.all.map(p => p.id), `${fresh.all.length} new records`); ctx.go('library'); };
  el.querySelector('#live-screen').onclick = () => { focusRecords(fresh.ready.map(p => p.id)); ctx.go('screening'); };
  el.querySelector('#live-seen').onclick = () => { update(st => { markSeen(st); return st; }); ctx.refreshCounts(); ctx.rerender(); };
}

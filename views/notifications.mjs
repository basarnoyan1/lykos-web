// Notifications: what finished, failed or waits for the reader while they worked elsewhere. The page's head is the title bar (page()):
// the unread count, Unread or All, Mark all read, and More holding Mute background completions; the page is a calm list. A row is a
// sentence ("PubMed update failed") led by the icon of the page it concerns in a ring (red for a failure, green for a completion,
// amber for a warning), one quiet line naming that page, the time in a fixed end column and More (Mark read, Remove). Pressing a row opens
// what it concerns and marks it read; an unread row has a dot and a heavier title. Rows are grouped by day: Today, Yesterday, Previous 7
// days, Earlier.
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { visibleNotifications, notificationTitle, notificationPlace, groupRepeats } from '../lib/notifications.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { ago } from '../lib/dates.mjs';
import { icon } from '../lib/icons.mjs';
import { viewIcon } from './overview.mjs';
import { pagedList, wirePagedList } from '../lib/paged-list.mjs';
export const meta = { title: 'Notifications', icon: 'bell' };
export const count = (...a) => REGISTRY.notifications.count(...a);
let filter='unread';
const TONES = { error: 'failed', failed: 'failed', success: 'done', warning: 'warning' };
/** The day group of a notice: whole calendar days before `now`. */
const dayGroup = (n, now) => {
  const d = new Date(n.at), a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((a - b) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'earlier';
};
const GROUPS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['earlier', 'Earlier']];
const change = (fn, rerender) => { update(st => { fn(st); return st; }); rerender(); };

/** The title bar (lib/topbar.mjs): the unread count as its status, Unread or All as its switch, a quiet Mark all read, Mute in More. */
export function pageSpec({ filter: shown, success, unread }, { show = () => {}, readAll = () => {}, mute = () => {} } = {}) {
  return { title: 'Notifications',
    view: { id: 'nf-filter', label: 'Show', attr: 'data-filter', value: shown, items: [['unread', 'Unread'], ['all', 'All']], run: show },
    actions: [{ id: 'notification-read-all', label: 'Mark all read', icon: 'check', role: 'quiet', disabled: !unread, run: readAll }],
    overflow: [{ id: 'notification-success', label: 'Mute background completions', kind: 'toggle', checked: !success, run: mute }] };   // pressed only when it differs from the default, so More is not marked active at rest
}

export function page(rerender) {
  const s = get();
  return pageSpec({ filter, success: s.settings?.notifications?.success !== false, unread: count() }, {
    show: key => { filter = key; rerender(); },
    readAll: () => change(st => (st.notifications || []).forEach(n => n.read = true), rerender),
    mute: () => change(st => { st.settings = { ...st.settings, notifications: { ...st.settings?.notifications, success: st.settings?.notifications?.success === false } }; }, rerender),
  });
}

/** The page under the title bar: a list per day group that has rows. `now` is for tests. */
export function notificationsHtml({ items, filter: shown, now = new Date() }) {
  const row = n => {
    const title = notificationTitle(n), place = notificationPlace(n);
    return uiRow({ attrs: { 'data-notification': n.id, 'data-nf-read': n.read ? 'true' : 'false' },
      main: { html: `<span class="nf-line"><span class="nf-mark" data-tone="${TONES[n.tone] || ''}" aria-hidden="true">${icon(n.threadId || /^assistant/i.test(notificationTitle(n)) ? 'assistant' : n.view && n.view !== 'overview' ? viewIcon(n.view) : 'home', { size: 16 })}</span><button type="button" class="tk-text" data-open="${esc(n.id)}" title="${esc(title)}">${esc(title)}</button></span>`, detail: [esc(place), n.detail ? esc(n.detail) : '', n.count > 1 ? `${n.count} times` : ''] },
      cells: [{ col: 'when', kind: 'text', ch: 12, html: `<span title="${esc(ago(n.at))}">${esc(ago(n.at))}</span>` }],
      end: uiRowEnd({ more: { label: `More for ${title}`, attrs: { 'data-nf-more': n.id } } }) });
  };
  const list = (rows, extra = {}) => uiList({ label: 'Notifications', cls: 'nf-list', attrs: { 'data-nf-list': '' }, cols: ['when'],
    empty: emptyState({ title: shown === 'unread' ? 'No unread notifications' : 'No notifications', size: 'inline' }), rows: rows.map(row), ...extra });
  let body;
  // fifty notifications a page, under their day heads (lib/paging.mjs pagedList); the page is kept across redraws
  const paged = pagedList('nf-list', items, { label: 'notifications' });
  if (items.length) {
    body = GROUPS.map(([id, name]) => {
      const rows = paged.items.filter(n => dayGroup(n, new Date(now)) === id);
      return rows.length ? list(rows, { label: `${name} notifications`, attrs: { 'data-nf-list': '', 'data-nf-group': id },
        head: uiBar({ kind: 'head', label: `${name}, ${rows.length}`, id: `nf-g-${id}`, lead: { title: name, level: 'h2' }, status: { id: `nf-g-${id}-n`, text: String(rows.length), ch: 4 } }) }) : '';
    }).join('');
  } else body = list(items);
  return `<section class="nf-page">${body}${paged.pager}</section>`;
}

export function render(el,ctx) {
  const s=get(), items=groupRepeats(visibleNotifications(s).filter(n=>filter==='all'||!n.read));   // a notice repeated on one day is one row
  el.innerHTML=notificationsHtml({ items, filter });
  wirePagedList(el,'nf-list',()=>render(el,ctx));
  // a change repaints the page with its title bar, whose count and Mark all read follow it
  const rerender=()=>{ctx.refreshCounts?.();ctx.rerender?.();};
  const find=(st,id)=>(st.notifications||[]).find(n=>n.id===id);
  const idsOf=id=>items.find(n=>n.id===id)?.ids||[id];
  const open=id=>{const n=items.find(n=>n.id===id);if(!n)return;update(st=>{for(const k of idsOf(id)){const x=find(st,k);if(x)x.read=true;}return st;});ctx.refreshCounts?.();if(n.threadId)ctx.openAssistantSession(n.threadId);else ctx.go(n.view);};
  // The whole row opens what it concerns, except its end (More).
  el.querySelectorAll('[data-notification]').forEach(r=>r.onclick=e=>{if(e.target.closest('.ui-row-end'))return;open(r.dataset.notification);});
  el.querySelectorAll('[data-nf-more]').forEach(b=>b.addEventListener('click',()=>{
    const id=b.dataset.nfMore,n=items.find(n=>n.id===id);if(!n)return;
    const ids=new Set(idsOf(id));
    showMenu(b,[{label:n.read?'Mark unread':'Mark read',run:()=>change(st=>{for(const x of st.notifications||[])if(ids.has(x.id))x.read=!n.read;},rerender)},'-',
      {label:n.count>1?`Remove all ${n.count}`:'Remove',danger:true,run:()=>change(st=>{st.notifications=(st.notifications||[]).filter(x=>!ids.has(x.id));},rerender)}],{align:'end'});
  }));
}

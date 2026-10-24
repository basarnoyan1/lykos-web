// Tasks › Timeline: the project's dated work as names beside a time grid (plan §2, "Tasks › Timeline"). The references (Linear, Plane,
// Jira and Asana timelines) share the shape this follows: a column of names with a kind and status mark, a compact time header (months
// over days, Mondays or months, weekends shaded, today a line with a pill), ranges as rounded bars with their label inside or after,
// milestones as diamonds, one bar of controls (scale, Today, Earlier and Later, New milestone, Download), and adding in place.
//
// Milestones are rows of the same grid: there is no second list. A press on a row opens it: a task in its row of the List, a milestone
// of the researcher's in an editing row under it, a date the project records on the page that keeps it. A bar or a diamond the
// researcher owns is dragged to new dates (its body moves it, its ends change the start or the end); the arrow keys move it a day.
// The grid is positioned in percent of its width (lib/timeline-grid.mjs), so nothing here is measured to lay out.
import { get, update } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiGroup } from '../lib/ui-actions.mjs';
import { wireDateField } from '../lib/date-picker.mjs';
import { normaliseTasks, patchTask } from '../lib/tasks.mjs';
import { download, downloadPng, downloadCsv, wireDownload } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { timelineItems, timelineSvg, timelineCsv, suggestedMilestones, normaliseMilestones, daysBetween } from '../lib/timeline.mjs';
import { gridRange, gridHeader, gridAt, GRID_ZOOMS } from '../lib/timeline-grid.mjs';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZOOM_ITEMS = [['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Quarters']];
const STATUS_WORD = { todo: 'To do', doing: 'Doing', waiting: 'Waiting', done: 'Done' };
const MIN_ROWS = 3;          // a grid of one or two items keeps three rows' height: short, never a tall blank

let zoom = 'months', offset = 0, adding = false, opened = null, scrollKey = '', scrollLeft = null;

/** Leaving the page forgets the editing rows; the scale stays for the session. */
export function resetTimeline() { adding = false; opened = null; offset = 0; scrollKey = ''; scrollLeft = null; }
/** Opens the new-milestone row, or a milestone's editing row (a link from elsewhere). */
export function startMilestone() { adding = true; opened = null; }
export function openMilestone(id) { opened = id; adding = false; }

const shortDay = iso => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const fullDay = iso => `${shortDay(iso)} ${iso.slice(0, 4)}`;
/** "5 Oct to 19 Oct 2026", or both years when they differ. */
export const spanText = (a, b) => (!b ? fullDay(a) : a.slice(0, 4) === b.slice(0, 4) ? `${shortDay(a)} to ${fullDay(b)}` : `${fullDay(a)} to ${fullDay(b)}`);

/** Each item of the timeline as a row: its kind (task, own milestone, a date the project records), shape and state. */
export function timelineRows(s, today) {
  const tasks = new Map(normaliseTasks(s?.todos).map(x => [x.id, x]));
  return timelineItems(s).map(x => {
    const kind = x.kind === 'task' ? 'task' : x.known ? 'known' : 'own';
    const status = kind === 'task' ? tasks.get(x.taskId)?.status || (x.done ? 'done' : 'todo') : x.done ? 'done' : 'todo';
    const state = !x.date ? 'undated' : kind === 'known' ? 'record' : x.done ? 'done' : (x.end || x.date) < today ? 'late' : status === 'doing' ? 'doing' : 'open';
    return { ...x, kind, shape: x.end ? 'bar' : 'diamond', status, state };
  });
}

/** The words a row's tooltip carries: the name, the dates and what state it is in (or where the date is kept). */
export function tipOf(r) {
  const dates = r.date ? spanText(r.date, r.end) : 'no date';
  const state = r.kind === 'known' ? `recorded in ${r.source}` : r.state === 'late' ? 'late' : r.kind === 'task' ? (STATUS_WORD[r.status] || '').toLowerCase() : r.done ? 'reached' : '';
  return [r.label, dates, state].filter(Boolean).join(', ');
}


/** The mark in a row's lane: a bar from the start to the end day (its label inside when it fits, else beside it), or a diamond on its day. */
function markHtml(r, range) {
  if (!r.date) return '';
  const id = esc(r.id), own = r.kind !== 'known', tip = esc(tipOf(r));
  const hooks = `data-tl-open="${id}" data-shape="${r.shape}" data-state="${r.state}"${own ? ' data-tl-drag' : ''} aria-label="${esc(r.label)}" title="${tip}"`;
  let a, b, inner = '', fits = false;
  if (r.shape === 'bar') {
    a = gridAt(range, r.date); b = gridAt(range, r.end, true);
    fits = (daysBetween(r.date, r.end) + 1) * GRID_ZOOMS[range.zoom].dw >= r.label.length * 7 + 24;   // the least width the bar can have at this scale
    if (fits) inner = `<span class="tl-mark-label">${esc(r.label)}</span>`;
    if (own) inner += '<span class="tl-grip" data-grip="start" aria-hidden="true"></span><span class="tl-grip" data-grip="end" aria-hidden="true"></span>';
  } else { a = Math.round(((gridAt(range, r.date) + gridAt(range, r.date, true)) / 2) * 1000) / 1000; b = a; }
  const label = fits ? '' : `<span class="tl-beside"${b > 78 ? ' data-before' : ''} style="--a:${a};--b:${b}" aria-hidden="true">${esc(r.label)}</span>`;
  return `<button type="button" class="tl-mark" ${hooks} style="--a:${a};--b:${b}">${inner}</button>${label}`;
}

/** The kind and state of a row as a small drawing: a diamond for a milestone, a bar for a range, filled in its state's tone. */
const kindMark = r => `<svg class="tl-kind" data-state="${r.state}" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">${r.shape === 'diamond'
  ? '<path d="M7 2.5 11.5 7 7 11.5 2.5 7z"/>' : '<rect x="1.5" y="4" width="11" height="6" rx="1.5"/>'}</svg>`;

/** The name cell: the kind and state mark, the name; a press opens the row. */
function nameHtml(r) {
  return `<div class="tl-name"${opened === r.id ? ' data-open' : ''}><button type="button" class="tl-open" data-tl-open="${esc(r.id)}" title="${esc(tipOf(r))}"${r.kind === 'own' ? ` aria-expanded="${opened === r.id}"` : ''}>${kindMark(r)}<span class="tl-label">${esc(r.label)}</span></button></div>`;
}

/** The editing row under a milestone of the researcher's: its name and dates, Reached, Close; Remove in More. Changes apply as they are made. */
function editHtml(m) {
  return `<div class="tl-edit" data-tl-edit="${esc(m.id)}"><div class="tl-edit-in">${uiBar({ kind: 'tools', form: true, id: 'tl-edit', label: `Milestone ${m.label}`, budget: { n: 5, reason: 'a milestone is its name, its two dates, Reached and Close' },
    filters: [{ type: 'field', id: 'tl-edit-name', label: 'Name', value: m.label, width: 'flex', attrs: { autocomplete: 'off' } },
      { type: 'date', id: 'tl-edit-date', label: 'Date', value: m.date || '', placeholder: 'Date' },
      { type: 'date', id: 'tl-edit-end', label: 'End date', value: m.end || '', placeholder: 'End date' }],
    actions: [{ id: 'tl-edit-done', label: 'Reached', icon: 'check', pressed: !!m.done }, { id: 'tl-edit-close', label: 'Close', icon: 'close', role: 'quiet' }],
    overflow: [{ id: 'tl-edit-remove', label: 'Remove', danger: true }] })}</div></div>`;
}

/** The new-milestone row at the foot of the grid: name, date, end date, Add and Cancel. */
function addHtml() {
  return `<div class="tl-edit" data-tl-adding><div class="tl-edit-in">${uiBar({ kind: 'tools', form: true, id: 'tl-add', label: 'New milestone', budget: { n: 5, reason: 'a new milestone is its name, its two dates, Add and Cancel' },
    filters: [{ type: 'field', id: 'tl-new', label: 'Milestone', placeholder: 'Milestone name', width: 'flex', attrs: { autocomplete: 'off' } },
      { type: 'date', id: 'tl-new-date', label: 'Date', placeholder: 'Date' },
      { type: 'date', id: 'tl-new-end', label: 'End date', placeholder: 'End date' }],
    actions: [{ id: 'tl-add-go', label: 'Add', icon: 'plus', role: 'primary', type: 'submit' }, { id: 'tl-add-cancel', label: 'Cancel', icon: 'close', role: 'quiet' }] })}</div></div>`;
}

function barHtml(missing) {
  return uiBar({ kind: 'tools', label: 'Timeline', id: 'tl-bar', budget: { n: 5, reason: 'a timeline is its scale, Today, Earlier and Later, New milestone and Download, as in the references' },
    actions: [{ picker: true, id: 'tl-zoom', label: 'Scale', value: Object.fromEntries(ZOOM_ITEMS)[zoom], options: ZOOM_ITEMS, role: 'quiet', steady: true },
      { id: 'tl-today', label: 'Today', role: 'quiet' },
      uiGroup({ id: 'tl-nav', label: 'Earlier or later', items: [{ id: 'tl-prev', label: 'Earlier', icon: 'chevron-left' }, { id: 'tl-next', label: 'Later', icon: 'chevron-right' }] }),
      { id: 'tl-new-ms', label: 'New milestone', icon: 'plus', role: 'quiet' },
      { id: 'tl-dl', label: 'Download', icon: 'download', role: 'quiet', menu: true }],
    overflow: missing.length ? [{ id: 'tl-suggest', label: 'Add usual milestones' }] : [] });
}

/** The page: the bar over the grid, or, with nothing dated and no milestone, an empty state that starts one. */
export function timelineHtml(s, today) {
  const rows = timelineRows(s, today), own = normaliseMilestones(s?.milestones);
  const missing = suggestedMilestones(s).filter(l => !own.some(m => m.label.toLowerCase() === l.toLowerCase()));
  if (!rows.length && !adding) {
    return `<div class="tl" data-tl-empty>${emptyState({ icon: 'calendar', title: 'Nothing dated yet', size: 'inline',
      actions: [{ id: 'tl-new-empty', label: 'New milestone', icon: 'plus', primary: true }, ...(missing.length ? [{ id: 'tl-suggest-empty', label: 'Add usual milestones' }] : [])] })}</div>`;
  }
  const dated = rows.filter(r => r.date), range = gridRange(dated.flatMap(r => [r.date, r.end]).filter(Boolean), today, zoom, offset);
  const head = gridHeader(range, today);
  const weekend = head.weekend ? `;--tl-week:${head.weekend.week}%;${head.weekend.stops.map(([a, b], i) => `--tl-we${i}a:${a}%;--tl-we${i}b:${b}%`).join(';')}` : '';
    const top = head.top.map(x => `<span class="tl-at tl-period"${x.now ? ' data-now' : ''} style="--a:${x.a};--b:${x.b}"><span>${esc(x.label)}</span></span>`).join('');
  const sub = head.sub.map(x => `<span class="tl-at ${x.b != null ? 'tl-day' : 'tl-tick'}"${x.now ? ' data-now' : ''}${x.weekend ? ' data-weekend' : ''} style="--a:${x.a};--b:${x.b ?? x.a}">${esc(x.label)}</span>`).join('');
  const pill = head.today != null && range.zoom !== 'weeks' ? `<span class="tl-at tl-pill" style="--a:${head.today}">${range.zoom === 'months' ? Number(today.slice(8)) : 'Today'}</span>` : '';
  const rules = head.rules.map(a => `<span class="tl-rule" style="--a:${a}"></span>`).join('');
  const body = rows.map(r => `<div class="tl-line" data-tl-row="${esc(r.id)}">${nameHtml(r)}<div class="tl-lane">${markHtml(r, range)}</div></div>${opened === r.id && r.kind === 'own' ? editHtml(own.find(m => m.id === r.id) || r) : ''}`).join('');
  const fill = Array.from({ length: Math.max(0, MIN_ROWS - rows.length) }, () => '<div class="tl-line" data-tl-fill><div class="tl-name"></div><div class="tl-lane"></div></div>').join('');
  return `<div class="tl" data-tl-scale="${range.zoom}">
    ${barHtml(missing)}
    <div class="tl-scroll" id="tl-scroll" tabindex="-1"><div class="tl-table" data-tl-n="${range.days}" data-tl-t="${head.today ?? ''}" data-tl-first="${dated.length ? gridAt(range, dated[0].date) : ''}" role="group" aria-label="Timeline, ${esc(spanText(range.from, gridEndDay(range)))}" style="--tl-n:${range.days};--tl-dw:${GRID_ZOOMS[range.zoom].dw}px;--tl-t:${head.today ?? -100}${weekend}">
      <div class="tl-line" data-tl-time><div class="tl-name"></div><div class="tl-time" aria-hidden="true"><div class="tl-band tl-top">${top}</div><div class="tl-band tl-sub">${sub}${pill}</div></div></div>
      <div class="tl-bg" aria-hidden="true">${rules}</div>
      ${body}${fill}${adding ? addHtml() : ''}
    </div></div>
  </div>`;
}
const gridEndDay = range => new Date(Date.parse(`${range.to}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

// ---- wiring --------------------------------------------------------------------------------------------------------------------

const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const addDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * `openPage(view)` opens a page, `repaint()` draws the page again, `openTask(id)` opens a task in its row of the List.
 */
export function wireTimeline(el, { openPage = () => {}, repaint = () => {}, openTask = () => {}, today }) {
  const root = el.querySelector('.tl'); if (!root) return;
  const redraw = () => { const sc = el.querySelector('#tl-scroll'); if (sc) scrollLeft = sc.scrollLeft; repaint(); };
  const ms = fn => { update(s => { s.milestones = normaliseMilestones(s.milestones); fn(s.milestones, s); return s; }); redraw(); };
  const suggest = () => ms((list, s) => {
    for (const label of suggestedMilestones(s)) if (!list.some(m => m.label.toLowerCase() === label.toLowerCase())) list.push({ id: newId(), label, date: '' });
  });
  const startAdd = () => { adding = true; opened = null; redraw(); el.querySelector('#tl-new')?.focus(); };
  el.querySelector('#tl-new-empty')?.addEventListener('click', startAdd);
  el.querySelector('#tl-suggest-empty')?.addEventListener('click', suggest);
  el.querySelector('#tl-suggest')?.addEventListener('click', suggest);
  el.querySelector('#tl-new-ms')?.addEventListener('click', () => { if (adding) el.querySelector('#tl-new')?.focus(); else startAdd(); });
  const sc = el.querySelector('#tl-scroll');
  if (!sc) return;

  // the scale, Today, Earlier and Later
  root.addEventListener('ui-pick', e => { const v = e.detail?.value; if (e.detail?.id !== 'tl-zoom' || !GRID_ZOOMS[v] || v === zoom) return; zoom = v; offset = 0; scrollKey = ''; repaint(); });
  el.querySelector('#tl-prev')?.addEventListener('click', () => { offset -= 1; scrollLeft = 0; scrollKey = `${zoom}:${offset}`; repaint(); });
  el.querySelector('#tl-next')?.addEventListener('click', () => { offset += 1; scrollLeft = 0; scrollKey = `${zoom}:${offset}`; repaint(); });
  el.querySelector('#tl-today')?.addEventListener('click', () => { offset = 0; scrollKey = ''; repaint(); });
  // where the grid is scrolled: kept across a repaint of the same scale and offset; otherwise from the first dated item (with a little air), as
  // long as today stays in view, else today a quarter in
  const key = `${zoom}:${offset}`, table = sc.querySelector('.tl-table');
  if (scrollKey === key && scrollLeft != null) sc.scrollLeft = scrollLeft;
  else {
    const t = Number(table.dataset.tlT) || 0, first = table.dataset.tlFirst === '' ? t : Number(table.dataset.tlFirst), lane = sc.querySelector('.tl-lane');
    const namesW = lane?.offsetLeft || 0, laneW = lane?.getBoundingClientRect?.().width || 0, seen = sc.clientWidth - namesW, x = p => (laneW * p) / 100;
    sc.scrollLeft = Math.max(0, x(t) - seen * 0.85, Math.min(x(first) - 48, x(t) - seen * 0.25));
    scrollKey = key;
  }
  sc.addEventListener('scroll', () => { scrollLeft = sc.scrollLeft; }, { passive: true });

  // Download: the figure and the table, as the old chart had
  const exportSvg = () => timelineSvg(timelineItems(get()), { width: null, today, style: figureTokens(null, { medium: 'export' }) });
  wireDownload(el.querySelector('#tl-dl'), [
    { label: 'SVG', icon: 'download', run: () => download(exportSvg(), 'project-timeline.svg', 'image/svg+xml') },
    { label: 'PNG', icon: 'image', run: () => downloadPng(exportSvg(), 'project-timeline.png') },
    { label: 'CSV', icon: 'table', run: () => downloadCsv(timelineCsv(timelineItems(get()), today), 'project-timeline.csv') },
  ]);

  // opening a row
  const rowOf = id => timelineRows(get(), today).find(r => r.id === id);
  const open = id => {
    const r = rowOf(id); if (!r) return;
    if (r.kind === 'task') openTask(r.taskId);
    else if (r.kind === 'known') { if (r.view) openPage(r.view); }
    else { opened = opened === id ? null : id; adding = false; redraw(); if (opened) el.querySelector('#tl-edit-name')?.focus(); }
  };
  let dragged = false;
  sc.querySelectorAll('[data-tl-open]').forEach(b => b.addEventListener('click', e => { if (dragged) { dragged = false; e.preventDefault(); return; } open(b.dataset.tlOpen); }));

  // the editing row of a milestone
  const edit = el.querySelector('[data-tl-edit]');
  if (edit) {
    const id = edit.dataset.tlEdit, find = list => list.find(m => m.id === id);
    const name = edit.querySelector('#tl-edit-name');
    edit.querySelector('form')?.addEventListener('submit', e => { e.preventDefault(); name.blur(); });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) ms(list => { const m = find(list); if (m) m.label = v; }); });
    for (const [fid, k, label] of [['tl-edit-date', 'date', 'Date'], ['tl-edit-end', 'end', 'End date']]) {
      wireDateField(edit, fid, label);
      edit.querySelector(`#${fid}`).addEventListener('change', e => ms(list => { const m = find(list); if (!m) return; if (e.target.value) m[k] = e.target.value; else delete m[k]; }));
    }
    edit.querySelector('#tl-edit-done').addEventListener('click', () => ms(list => { const m = find(list); if (m) { if (m.done) delete m.done; else m.done = true; } }));
    edit.querySelector('#tl-edit-close').addEventListener('click', () => { opened = null; redraw(); el.querySelector(`.tl-name [data-tl-open="${CSS.escape(id)}"]`)?.focus(); });
    edit.querySelector('#tl-edit-remove')?.addEventListener('click', () => { opened = null; ms((list, s) => { s.milestones = list.filter(m => m.id !== id); }); });
  }
  // the new-milestone row
  const form = el.querySelector('#tl-add');
  if (form) {
    wireDateField(form, 'tl-new-date', 'Date'); wireDateField(form, 'tl-new-end', 'End date');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const label = el.querySelector('#tl-new').value.trim(); if (!label) { el.querySelector('#tl-new').focus(); return; }
      const date = el.querySelector('#tl-new-date').value, end = el.querySelector('#tl-new-end').value;
      adding = false;
      ms(list => list.push({ id: newId(), label, date, ...(end ? { end } : {}) }));
    });
    el.querySelector('#tl-add-cancel').addEventListener('click', () => { adding = false; redraw(); });
  }

  // moving dates: a drag of a bar's body or a diamond moves it, of an end changes that date; the arrow keys move it a day
  const commit = (id, shift, which) => {
    const r = rowOf(id); if (!r || !shift) return;
    const move = d => (d ? addDay(d, shift) : d);
    let a = which === 'end' ? r.date : move(r.date), b = which === 'start' ? r.end : move(r.end);
    if (r.end && b < a) { if (which === 'start') a = b; else b = a; }
    if (r.kind === 'task') {
      update(s => { s.todos = Array.isArray(s.todos) ? s.todos : []; patchTask(s.todos, r.taskId, { start: a, due: b }); return s; });
      redraw();
    } else ms(list => { const m = list.find(x => x.id === id); if (!m) return; m.date = a; if (m.end) m.end = b; });
  };
  sc.querySelectorAll('.tl-mark[data-tl-drag]').forEach(mark => {
    mark.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); commit(mark.dataset.tlOpen, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1), e.altKey ? 'end' : 'move');
      requestAnimationFrame(() => el.querySelector(`.tl-mark[data-tl-open="${CSS.escape(mark.dataset.tlOpen)}"]`)?.focus());
    });
    mark.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragged = false;
      const which = e.target.closest('[data-grip]')?.dataset.grip || 'move', lane = mark.closest('.tl-lane');
      const n = Number(table.dataset.tlN), dayPx = lane.getBoundingClientRect().width / n, per = 100 / n;
      const a0 = Number(mark.style.getPropertyValue('--a')), b0 = Number(mark.style.getPropertyValue('--b'));
      const x0 = e.clientX, beside = lane.querySelector('.tl-beside');
      let shift = 0;
      mark.setPointerCapture(e.pointerId);
      const onMove = ev => {
        shift = Math.round((ev.clientX - x0) / dayPx);
        if (Math.abs(ev.clientX - x0) > 3) { dragged = true; mark.dataset.dragging = ''; }
        const a = which === 'end' ? a0 : a0 + shift * per, b = which === 'start' ? b0 : b0 + shift * per;
        mark.style.setProperty('--a', String(Math.min(a, which === 'start' ? b0 - per : a)));
        mark.style.setProperty('--b', String(Math.max(b, which === 'end' ? a0 + per : b)));
        if (beside) { beside.style.setProperty('--a', mark.style.getPropertyValue('--a')); beside.style.setProperty('--b', mark.style.getPropertyValue('--b')); }
        mark.title = tipOf({ ...rowOf(mark.dataset.tlOpen), ...shifted(rowOf(mark.dataset.tlOpen), shift, which) });
      };
      const onUp = () => {
        mark.removeEventListener('pointermove', onMove); mark.removeEventListener('pointerup', onUp); mark.removeEventListener('pointercancel', onUp);
        delete mark.dataset.dragging;
        if (dragged && shift) commit(mark.dataset.tlOpen, shift, which);
        else if (dragged) { mark.style.setProperty('--a', String(a0)); mark.style.setProperty('--b', String(b0)); }
      };
      mark.addEventListener('pointermove', onMove); mark.addEventListener('pointerup', onUp); mark.addEventListener('pointercancel', onUp);
    });
  });
}
const shifted = (r, n, which) => {
  if (!r?.date) return {};
  const a = which === 'end' ? r.date : addDay(r.date, n), b = r.end ? (which === 'start' ? r.end : addDay(r.end, n)) : r.end;
  return { date: a, end: b };
};

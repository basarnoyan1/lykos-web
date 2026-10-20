// Case: one patient, recorded in CARE order (lib/case-report.mjs, plan §1.1).
//
// A case report's data view. Each section is a CARE item: patient
// information, clinical findings, a timeline (a table and the figure drawn
// from it), diagnostic assessment, therapeutic intervention, follow-up and
// outcomes, the patient's perspective and informed consent. Typing saves in
// place and redraws only what the text changes: the section counts, the
// identifier check, the consent line and the timeline figure.
//
// The same module draws the case's part of Overview and of Reporting (the
// CARE checklist), so the three cannot describe the case differently.
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { esc, autoGrow, sanitizeSvg } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { dateField, wireDateField } from '../lib/date-picker.mjs';
import { download, downloadPng, downloadCsv, wireDownload } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { CASE_SECTIONS, SEXES, CONSENT, caseOf, caseIdentifiers, careSections, timelineSvg, timelineCsvRows, sortTimeline, caseSummary, consentRecorded, consentLine, CATEGORIES } from '../lib/case-report.mjs';
import { checklistOf, checklistStates, STATES, supported } from '../lib/checklist.mjs';
import { exportBundle } from '../lib/bundle.mjs';
import { researchType } from '../lib/workflow.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { svgToPng } from '../lib/project-folder.mjs';

export const meta = { layout: 'sheet', title: 'Case', icon: 'case-record' };
export const count = (...a) => REGISTRY.case.count(...a);
export function assistContext() { return caseSummary(get()); }

let focused = null;      // { label, el } of the field being edited, for the assistant
let jump = null;         // a section to bring into view on the next render
let fitTimeline = null;  // the figure's width observer, released on the next render
let timelineFrame = 0;
let growing = [];        // the text boxes that re-measure when the page width changes, released on the next render
export function unmount() {
  fitTimeline?.disconnect(); fitTimeline = null;
  cancelAnimationFrame(timelineFrame); timelineFrame = 0;
  for (const g of growing) g.release();
  growing = [];
  focused = null;
}
let newRow = null;       // the episode just added, to focus
export function focus() {
  return focused?.el?.isConnected ? { kind: 'case field', label: focused.label, text: focused.el.value || '' } : null;
}
/** Opens the case at one of its sections (from Overview). */
export function showSection(id) { jump = id; }

/** The title bar: the page's name, and its sections as the title menu (each brings its section into view). */
export function page() {
  const sections = [...CASE_SECTIONS.map(x => [x.id, x.name]), ['deid', 'De-identification']];
  const go = id => document.getElementById(`case-${id}`)?.scrollIntoView({ block: 'start' });
  return { title: 'Case', titleMenu: anchor => showMenu(anchor, sections.map(([id, name]) => ({ label: name, run: () => go(id) })), { align: 'start', minWidth: 200 }), titleNoun: 'section', actions: [] };
}

const rid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const save = fn => update(st => { st.caseReport = fn(caseOf(st)); return st; });
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${(cur || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
const secMeta = x => `CARE ${x.item} · ${x.line}`;

function field(f, c) {
  if (f.kind === 'input') return `<label class="field"><span>${esc(f.label)}</span><input data-f="${f.id}" value="${esc(c[f.id] || '')}" autocomplete="off" spellcheck="false"></label>`;
  if (f.kind === 'select') return `<label class="field"><span>${esc(f.label)}</span><select data-f="${f.id}">${opts(SEXES, c[f.id])}</select></label>`;
  return `<label class="field case-text"><span>${esc(f.label)}</span><textarea data-f="${f.id}" rows="1" spellcheck="true">${esc(c[f.id] || '')}</textarea></label>`;
}

/** The timeline: one row per episode. The event is the row's text, the date and category are its two control columns. */
function timelineRows(c) {
  if (!c.timeline.length) return `<p class="meta case-none">No episodes</p>`;
  return uiList({ id: 'case-tl', label: 'Timeline', cols: ['when', 'category'], hook: 'case-tl', attrs: { 'data-case-tl': true }, rows: c.timeline.map((r, i) => uiRow({
    attrs: { 'data-row': r.id },
    main: { html: `<textarea data-t="event" rows="1" aria-label="Event, episode ${i + 1}" placeholder="Event" spellcheck="true">${esc(r.event || '')}</textarea>` },
    cells: [
      { col: 'when', kind: 'control', html: `<input data-t="when" size="10" value="${esc(r.when || '')}" aria-label="Date or day, episode ${i + 1}" placeholder="Day 0" autocomplete="off" spellcheck="false">` },
      { col: 'category', kind: 'control', html: `<select data-t="category" aria-label="Category, episode ${i + 1}">${opts([['', 'No category'], ...CATEGORIES], r.category)}</select>` }],
    end: uiRowEnd({ more: { label: `More for episode ${i + 1}`, attrs: { 'data-episode-more': r.id } } }) })) });
}

function hitsHtml(s) {
  const hits = caseIdentifiers(s);
  if (!hits.length) return `<p class="case-hit-kind">${icon('check')}<span>None found</span></p>`;
  return uiList({ label: 'Possible identifiers', rows: hits.map(h => uiRow({ main: { html: `<span class="case-hit-kind">${icon('warn')}<span>${esc(h.kind)}</span></span>`, detail: [`${esc(h.where)} · “${esc(h.match)}”`], wrap: true } })) });
}
const consentState = c => consentRecorded(c)
  ? `${icon('check')}<span>${esc(consentLine(c))}</span>`
  : `${icon('warn')}<span>${c.consent.status === 'none' ? 'Not obtained · required for publication' : 'Not recorded · required for publication'}</span>`;

export function render(el, ctx) {
  const s = get(), c = caseOf(s), secs = careSections(s);
  const sec = id => secs.find(x => x.id === id);
  unmount();

  const body = x => {
    if (x.id === 'timeline') return `<div class="panel-body tight" data-timeline>${timelineRows(c)}</div>
      ${c.timeline.length ? `<figure class="chart-fig case-fig"><div class="chart-svg" data-case-figure></div></figure>` : ''}`;   // the figure comes with the first episode: an empty one only repeats "No episodes"
    if (x.id === 'consent') return `<div class="panel-body">
      <label class="field"><span>Status</span><select id="case-consent-status">${opts(CONSENT, c.consent.status)}</select></label>
      <label class="field"><span>Date</span>${dateField('case-consent-date', c.consent.date || '', 'Consent date')}</label>
      <label class="field"><span>Note</span><input id="case-consent-note" value="${esc(c.consent.note || '')}" placeholder="Where the signed form is kept" autocomplete="off"></label>
      <div class="case-consent-state" data-consent-state role="status">${consentState(c)}</div></div>`;
    return `<div class="panel-body">${x.fields.map(f => field(f, c)).join('')}</div>`;
  };
  el.innerHTML = `<div class="case-page">
    ${CASE_SECTIONS.map(x => `<section class="panel" id="case-${x.id}" aria-labelledby="case-h-${x.id}">
      ${x.id === 'timeline' ? uiBar({ kind: 'head', label: x.name, lead: { title: x.name, id: `case-h-${x.id}` }, message: { id: 'case-tl-meta', text: secMeta(sec(x.id)) }, actions: [
          // Sort and Download come with the first episode: an empty timeline offers only Add (COHERENCE-REVIEW A19)
          ...(c.timeline.length ? [{ id: 'case-sort', label: 'Sort by time', icon: 'sort', disabled: c.timeline.length < 2 },
            { id: 'case-tl-dl', label: 'Download', icon: 'download', menu: true }] : []),
          { id: 'case-add-row', label: 'Add episode', icon: 'plus', role: 'primary' }] })
        : `<div class="panel-head"><h2 id="case-h-${x.id}">${esc(x.name)}</h2><span class="meta" data-sec-meta="${x.id}">${esc(secMeta(sec(x.id)))}</span></div>`}
      ${body(x)}</section>`).join('')}
    <section class="panel" id="case-deid" aria-labelledby="case-h-deid">
      <div class="panel-head"><h2 id="case-h-deid">De-identification</h2><span class="meta" data-hits-n>${caseIdentifiers(s).length || ''}</span></div>
      <div class="panel-body tight">
        <p class="meta case-help" data-ui-help>Keep the case unidentifiable: no names, full dates of birth, contact details or record numbers.</p>
        <div data-hits>${hitsHtml(s)}</div></div></section>
  </div>`;

  const metaOf = id => el.querySelector(`[data-sec-meta="${id}"]`) || (id === 'timeline' ? el.querySelector('#case-tl-meta') : null);
  // ---- live refresh: what a keystroke can change, and nothing else ----------
  const flagged = () => new Set(caseIdentifiers(get()).map(h => h.field));
  const refresh = ({ figure = false } = {}) => {
    const st = get(), cc = caseOf(st), fl = flagged();
    for (const x of careSections(st)) { const m = metaOf(x.id); if (m) { m.textContent = secMeta(x); if (x.id === 'timeline') m.title = m.textContent; } }
    el.querySelector('[data-hits]').innerHTML = hitsHtml(st);
    el.querySelector('[data-hits-n]').textContent = caseIdentifiers(st).length || '';
    el.querySelectorAll('[data-f]').forEach(i => i.toggleAttribute('aria-invalid', fl.has(i.dataset.f)));
    el.querySelectorAll('[data-row] [data-t="event"]').forEach(i => i.toggleAttribute('aria-invalid', fl.has(`timeline:${i.closest('[data-row]').dataset.row}`)));
    el.querySelector('#case-consent-note')?.toggleAttribute('aria-invalid', fl.has('consent'));
    const cs = el.querySelector('[data-consent-state]'); if (cs) cs.innerHTML = consentState(cc);
    if (figure) drawFigure(true);
    ctx.refreshCounts();
  };

  // ---- the case's text fields -------------------------------------------------
  growing = [...el.querySelectorAll('textarea')].map(t => autoGrow(t, { max: 100000 }));
  el.querySelectorAll('[data-f]').forEach(i => {
    const label = i.closest('label')?.querySelector('span')?.textContent || i.dataset.f;
    i.addEventListener('focus', () => { focused = { label, el: i }; });
    i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => { save(cc => ({ ...cc, [i.dataset.f]: i.value })); refresh(); });
  });

  // ---- timeline ----------------------------------------------------------------
  const host = el.querySelector('[data-case-figure]');
  const drawFigure = force => {
    if (!host) return;
    const w = Math.round(host.clientWidth); if (!w || (!force && w === host._w)) return; host._w = w;
    host.innerHTML = sanitizeSvg(timelineSvg(caseOf(get()).timeline, { width: w }));
  };
  // Resize callbacks may change the SVG height. Draw outside observer delivery
  // so WebKit can settle the new layout without a resize-observer feedback loop.
  fitTimeline = new ResizeObserver(() => {
    cancelAnimationFrame(timelineFrame);
    timelineFrame = requestAnimationFrame(() => {
      if (!host?.isConnected) return;
      for (const g of growing) g.grow();     // a box wraps differently at another width
      drawFigure();
    });
  });
  if (host) fitTimeline.observe(host);
  drawFigure();
  const setRow = (id, patch) => save(cc => ({ ...cc, timeline: cc.timeline.map(r => r.id === id ? { ...r, ...patch } : r) }));
  el.querySelectorAll('[data-row]').forEach(tr => {
    const id = tr.dataset.row;
    tr.querySelectorAll('[data-t]').forEach(i => {
      i.addEventListener('focus', () => { focused = { label: `Timeline ${i.dataset.t}`, el: i }; });
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => { setRow(id, { [i.dataset.t]: i.value }); refresh({ figure: true }); });
    });
  });
  el.querySelectorAll('[data-episode-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove episode', icon: 'trash', run: () => {
    save(cc => ({ ...cc, timeline: cc.timeline.filter(r => r.id !== b.dataset.episodeMore) })); ctx.rerender(); ctx.refreshCounts();
  } }], { align: 'end', minWidth: 160 }));
  el.querySelector('#case-add-row').onclick = () => {
    newRow = rid();
    save(cc => ({ ...cc, timeline: [...cc.timeline, { id: newRow, when: '', category: '', event: '' }] }));
    ctx.rerender(); ctx.refreshCounts();
  };
  const sortBtn = el.querySelector('#case-sort');
  if (sortBtn) sortBtn.onclick = () => {
    const { rows, sorted } = sortTimeline(caseOf(get()).timeline);
    const note = metaOf('timeline');
    if (!sorted) { if (note) note.textContent = note.title = 'Use one kind of time: dates, or days, weeks, months'; return; }
    save(cc => ({ ...cc, timeline: rows })); ctx.rerender();
  };
  const svgAt = () => timelineSvg(caseOf(get()).timeline, { style: figureTokens(null, { medium: 'export' }) });
  if (el.querySelector('#case-tl-dl')) wireDownload(el.querySelector('#case-tl-dl'), [
    { label: 'SVG', icon: 'download', run: () => download(svgAt(), 'case-timeline.svg', 'image/svg+xml') },
    { label: 'PNG', icon: 'image', run: () => downloadPng(svgAt(), 'case-timeline.png') },
    { label: 'CSV', icon: 'table', run: () => downloadCsv(timelineCsvRows(get()), 'case-timeline.csv') }]);

  // ---- consent -------------------------------------------------------------------
  const setConsent = patch => { save(cc => ({ ...cc, consent: { ...cc.consent, ...patch } })); refresh(); };
  el.querySelector('#case-consent-status').onchange = e => setConsent({ status: e.target.value });
  wireDateField(el, 'case-consent-date', 'Consent date');
  el.querySelector('#case-consent-date').onchange = e => setConsent({ date: e.target.value });
  el.querySelector('#case-consent-note').oninput = e => setConsent({ note: e.target.value });

  refresh();
  if (newRow) { el.querySelector(`[data-row="${newRow}"] [data-t="when"]`)?.focus(); newRow = null; }
  // After the shell has put a newly opened view at its top.
  if (jump) { const target = el.querySelector(`#case-${jump}`); jump = null; requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' })); }
}

// ---- Overview: the case's completeness in CARE order ------------------------------
/** The case as Overview shows it in place of a review's flow: the same stage table, one row per CARE section, from the first visit (COHERENCE-REVIEW A18). */
export function overviewSection(s) {
  const secs = careSections(s), done = secs.filter(x => x.filled).length;
  const list = checklistOf(s), states = checklistStates(s);
  const reported = list.items.filter(([n]) => states[n]?.state === 'done' || states[n]?.state === 'na').length;
  const row = (id, name, share, line, go = 'case') => uiRow({ cls: 'ov-case', attrs: { 'data-case-go': go, 'data-case-sec': id },
    main: { html: `<button type="button" class="ov-go"><span class="ov-go-name">${esc(name)}</span></button>`, detail: [esc(line)] },
    cells: [{ col: 'track', kind: 'visual', html: `<span class="ov-track"><span class="ov-meter" aria-hidden="true"><i data-share="${share.toFixed(3)}"></i></span></span>` }],
    end: uiRowEnd({ reserve: true }) });
  return `<section class="ov-flow cr-ov" aria-label="Case completeness">
    ${uiBar({ kind: 'head', label: 'Case completeness', id: 'cr-ov-head', cls: 'panel-head', lead: { title: 'Case', level: 'h2' }, status: { id: 'cr-ov-count', text: `${done} of ${secs.length} sections`, ch: 16 } })}
    ${uiList({ id: 'cr-ov-list', label: 'Case completeness', cls: 'ov-table', cols: ['track'], grow: 1,
      rows: [...secs.map(x => row(x.id, x.name, x.total ? x.filled / x.total : 0, x.line)), row('checklist', 'CARE checklist', list.items.length ? reported / list.items.length : 0, `${reported} of ${list.items.length} items`, 'reporting')] })}</section>`;
}
export function wireOverview(el, ctx) {
  el.querySelectorAll('.cr-ov [data-share]').forEach(i => i.style.setProperty('--share', i.dataset.share));
  el.querySelectorAll('[data-case-go]').forEach(b => b.onclick = () => {
    if (b.dataset.caseGo === 'case') showSection(b.dataset.caseSec);
    ctx.go(b.dataset.caseGo);
  });
}

// ---- Reporting: the CARE checklist ------------------------------------------------
let clFocus = null;
export function reportingFocus() {
  if (!clFocus) return null;
  const s = get(), row = checklistOf(s).items.find(([n]) => n === clFocus);
  if (!row) return null;
  const c = checklistStates(s)[row[0]] || {};
  return { kind: 'checklist item', label: `${row[0]} ${row[1]}`, text: row[2],
    detail: [STATES.find(x => x[0] === (c.state || ''))?.[1], c.where].filter(Boolean).join(' · ') };
}
/** Reporting for a case report: the CARE checklist and the export bundle. */
export function renderReporting(el, ctx) {
  const s = get(), list = checklistOf(s), states = checklistStates(s), sup = supported(s);
  const reported = list.items.filter(([n]) => states[n]?.state === 'done').length;
  el.innerHTML = `<div class="case-report-rp">
    <div class="panel">
      ${uiBar({ kind: 'head', label: 'CARE checklist', id: 'cl-head', cls: 'panel-head', lead: { title: 'CARE checklist', level: 'h2' }, status: { id: 'cl-count', text: `${reported} reported · ${list.items.length} items`, ch: 24 },
        actions: [{ id: 'bundle', label: 'Export bundle', icon: 'export', role: 'primary' }], overflow: [{ id: 'cl-csv', label: 'Export checklist' }] })}
      <div class="note" id="bundle-note" role="status"></div>
      <div class="panel-body tight"><table class="cl case-cl">
        <thead><tr><th>#</th><th class="grow">Item</th><th>State</th><th>Where reported</th></tr></thead>
        <tbody>${list.items.map(([n, name, text]) => { const c = states[n] || {};
          return `<tr data-item="${esc(n)}"><td class="meta">${esc(n)}</td><td class="grow"><div>${esc(name)}</div><div class="case-cl-text">${esc(text)}</div>${sup[n] ? `<div class="case-cl-sup">${esc(sup[n])}</div>` : ''}</td>
            <td><select class="ui-cell-field" data-cl-state="${esc(n)}" aria-label="State, item ${esc(n)}">${STATES.map(([v, l]) => `<option value="${v}"${(c.state || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><input class="ui-cell-field" data-cl-where="${esc(n)}" value="${esc(c.where || '')}" placeholder="Section, page" aria-label="Where reported, item ${esc(n)}"></td></tr>`; }).join('')}</tbody></table></div>
    </div></div>`;
  const saveCl = (n, patch) => update(st => { const k = checklistOf(st).key; st[k] = { ...(st[k] || {}), [n]: { ...((st[k] || {})[n] || {}), ...patch } }; return st; });
  el.querySelectorAll('[data-item]').forEach(tr => tr.addEventListener('focusin', () => { clFocus = tr.dataset.item; }));
  el.querySelectorAll('[data-cl-state]').forEach(sel => sel.onchange = () => {
    saveCl(sel.dataset.clState, { state: sel.value });
    const st = get(), n = checklistOf(st).items.filter(([k]) => checklistStates(st)[k]?.state === 'done').length;
    el.querySelector('#cl-count').textContent = `${n} reported · ${checklistOf(st).items.length} items`;
    ctx.refreshCounts();
  });
  el.querySelectorAll('[data-cl-where]').forEach(i => i.oninput = () => saveCl(i.dataset.clWhere, { where: i.value }));
  el.querySelector('#cl-csv').onclick = () => {
    const st = get(), l = checklistOf(st), cs = checklistStates(st), sp = supported(st);
    downloadCsv([['Item', 'Name', 'Description', 'State', 'Where reported', 'Supported by'],
      ...l.items.map(([n, name, text]) => [n, name, text, STATES.find(x => x[0] === (cs[n]?.state || ''))?.[1] || '', cs[n]?.where || '', sp[n] || ''])], `${l.id}-checklist.csv`);
  };
  wireBundle(el);
}

/** The Export bundle button: builds, saves, and says what is still missing. */
/**
 * Export bundle (plan K3, lib/bundle.mjs exportBundle): into the project
 * folder by its version rule, or a download for a project in the app's storage.
 */
export function wireBundle(el) {
  const b = el.querySelector('#bundle'), note = el.querySelector('#bundle-note');
  if (!b) return;
  b.onclick = () => runBundle(b, note);
}
/** The same, for a button that is not in this view (the title bar's): `b` is disabled while it works, `note` says what was written. */
export async function runBundle(b, note) {
  if (b) b.disabled = true;
  if (note) note.textContent = 'Building bundle';
  try {
    const r = await exportBundle({ folder: activeFolder(), typeId: researchType(get()).id, svgToPng });
    const open = r.missing.length ? ` · ${r.missing.length} ${r.missing.length === 1 ? 'item' : 'items'} listed in unresolved.md` : '';
    if (note) note.textContent = r.failed?.length ? `Not written: ${r.failed.map(f => f.error).join('; ')}`
      : r.unchanged ? `Unchanged since ${r.unchanged}` : r.written ? `Wrote ${r.written.join(', ')}${open}` : `Saved${open}`;
  } catch (err) { if (note) note.textContent = String(err.message || err).slice(0, 120); }
  if (b) b.disabled = false;
}

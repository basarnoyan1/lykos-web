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
import { CASE_SECTIONS, SEXES, CONSENT, caseOf, caseIdentifiers, careSections, timelineSvg, timelineCsvRows, sortTimeline, caseSummary, caseSummaryMarkdown, consentRecorded, consentLine, CATEGORIES } from '../lib/case-report.mjs';
import { recordOf, caseEvents, HISTORY_CATEGORIES, HISTORY_STATUS, MODALITIES, FLAGS, TREATMENT_KINDS } from '../lib/case-record.mjs';
import { caseToFhir, fhirToCase } from '../lib/case-fhir.mjs';
import { labMatrix, labSeries, labTrendSvg, labCsvRows, changeText, fmtVal } from '../lib/case-labs.mjs';
import { LABS, PANELS, labById, evaluate, findLab, intervalText, shortRange, SOURCE as LAB_SOURCE } from '../lib/lab-reference.mjs';
// the file store and the saver load when a picture is attached or shown and when a file is exported, not with the page
const files = () => import('../lib/files.mjs');
const saveFile = async (...a) => (await import('../lib/save.mjs')).saveFile(...a);
const deleteFile = async id => (await files()).deleteFile(id);
const getFile = async id => (await files()).getFile(id);
const putFile = async (id, f) => (await files()).putFile(id, f);
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
let thumbs = [];         // object URLs of the attached images shown, revoked on the next render
export function unmount() {
  fitTimeline?.disconnect(); fitTimeline = null;
  cancelAnimationFrame(timelineFrame); timelineFrame = 0;
  for (const g of growing) g.release();
  growing = [];
  for (const u of thumbs) URL.revokeObjectURL(u);
  thumbs = [];
  focused = null;
}
let newRow = null;       // the episode just added, to focus
let newRec = null;       // the list row just added, { l, id }, to focus
const openLabs = new Set();   // the tests whose chart is shown: a chart opens when its test is clicked, never by itself
const cmp = { from: '', to: '' };   // the two times the lab grid compares (the first and last when empty)
export function focus() {
  return focused?.el?.isConnected ? { kind: 'case field', label: focused.label, text: focused.el.value || '' } : null;
}
/** Opens the case at one of its sections (from Overview). */
export function showSection(id) { jump = id; }

/** The title bar: the page's name, and its sections as the title menu (each brings its section into view). */
export function page() {
  const sections = [...CASE_SECTIONS.flatMap(x => [[x.id, x.name], ...(x.lists || []).flatMap(l => [[l, LIST_UI[l].name], ...(l === 'investigations' ? [['labtrends', 'Lab trends']] : [])])]), ['deid', 'De-identification']];
  const go = id => document.getElementById(`case-${id}`)?.scrollIntoView({ block: 'start' });
  return { title: 'Case', titleMenu: anchor => showMenu(anchor, sections.map(([id, name]) => ({ label: name, run: () => go(id) })), { align: 'start', minWidth: 200 }), titleNoun: 'section', actions: [
    { id: 'case-import', label: 'Import FHIR', icon: 'import', run: () => importFhir() },
    { id: 'case-export', label: 'Export', icon: 'export', menu: true, run: a => showMenu(a, [
      { label: 'Case summary (Markdown)', icon: 'download', run: () => saveFile(caseSummaryMarkdown(get()), 'case-summary.md', 'text/markdown') },
      { label: 'FHIR bundle (JSON)', icon: 'download', run: () => saveFile(JSON.stringify(caseToFhir(caseOf(get())), null, 2) + '\n', 'case-fhir-bundle.json', 'application/fhir+json') }], { align: 'end', minWidth: 200 }) }] };
}

const rid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const save = fn => update(st => { st.caseReport = fn(caseOf(st)); return st; });
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${(cur || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
const secMeta = x => `CARE ${x.item}: ${x.line}`;

/** The structured lists (lib/case-record.mjs): the row's main text, then up to three control columns, each [key, kind, label, options or placeholder, width in characters]. */
const LIST_UI = {
  medicalHistory: { name: 'Medical history', add: 'Add history', main: ['text', 'Condition, operation, drug, allergy or exposure', 'History'],
    cells: [['when', 'input', 'Onset', 'Onset', 13], ['category', 'select', 'Category', HISTORY_CATEGORIES], ['status', 'select', 'Status', HISTORY_STATUS]] },
  imaging: { name: 'Imaging', add: 'Add study', main: ['findings', 'Findings and impression', 'Findings'],
    cells: [['when', 'input', 'Date or day', 'Day 0', 13], ['modality', 'select', 'Modality', MODALITIES], ['region', 'input', 'Region', 'Region', 14]] },
  investigations: { name: 'Investigations', add: 'Add result', input: 'case-lab-names', main: ['test', 'Test', 'Test'],
    cells: [['when', 'input', 'Date or day', 'Day 0', 13], ['value', 'input', 'Result', '9.1 g/dL', 14], ['ref', 'text', 'Reference']] },
  treatments: { name: 'Treatment', add: 'Add treatment', main: ['name', 'Drug, procedure or other', 'Treatment'],
    cells: [['when', 'input', 'Date or day', 'Day 2', 13], ['kind', 'select', 'Kind', TREATMENT_KINDS], ['detail', 'input', 'Dose, route, duration', 'Dose, route', 16]] },
  measures: { name: 'Outcome measures', add: 'Add measure', main: ['scale', 'Scale or measure', 'Scale'],
    cells: [['when', 'input', 'Date or day', 'Month 3', 13], ['score', 'input', 'Score', 'Score', 9]] },
};

let sexNow = '';   // the case's sex while the investigations draw, for the sex-specific intervals
/** The reference column: the interval on one line, and the full interval, its note and the source as its tooltip (lib/lab-reference.mjs). */
const refShort = r => shortRange(findLab(r.test), sexNow);
const refTitle = r => { const lab = findLab(r.test); return lab ? `${intervalText(lab, sexNow)}${lab.note ? `. ${lab.note}` : ''}. ${LAB_SOURCE}` : ''; };
/** The flag's glyph and word: a conventional direction and color (high up and red, low down and blue, abnormal a warning, normal a tick). */
const FLAG_UI = { N: ['check', 'Normal'], L: ['arrow-down', 'Low'], H: ['arrow-up', 'High'], A: ['warn', 'Abnormal'], '': ['minus', 'No flag'] };
const flagButton = (id, flag) => `<button type="button" class="case-flag" data-flag="${esc(flag)}" data-flag-btn="${esc(id)}" aria-label="Flag: ${FLAG_UI[flag][1]}. Change" title="${FLAG_UI[flag][1]}. Change">${icon(FLAG_UI[flag][0], { size: 14 })}</button>`;
function listRows(l, rows) {
  const u = LIST_UI[l];
  if (!rows.length) return `<p class="meta case-none">No rows</p>`;
  const head = uiRow({ table: true, cls: 'case-colhead', attrs: { 'data-head': '1', role: 'presentation' }, main: { html: `<span>${esc(u.main[2] || 'Entry')}</span>` },
    cells: u.cells.map(([key, , lab]) => ({ col: key, kind: 'text', html: `<span>${esc(lab)}</span>` })), end: uiRowEnd({ reserve: true }) });
  return uiList({ id: `case-l-${l}`, label: u.name, cols: u.cells.map(x => x[0]), hook: 'case-tl', attrs: { 'data-case-tl': true, 'data-case-list': l }, head, rows: rows.map((r, i) => uiRow({
    attrs: { 'data-rec': r.id, ...(l === 'investigations' ? { 'data-flag': r.flag || '' } : {}) },
    main: { html: u.input
      ? `<span class="case-lead">${flagButton(r.id, r.flag || '')}<input data-r="${u.main[0]}" list="${u.input}" value="${esc(r[u.main[0]] || '')}" aria-label="${esc(u.main[1])}, row ${i + 1}" placeholder="${esc(u.main[1])}" autocomplete="off" spellcheck="false"></span>`
      : `<textarea data-r="${u.main[0]}" rows="1" aria-label="${esc(u.main[1])}, row ${i + 1}" placeholder="${esc(u.main[1])}" spellcheck="true">${esc(r[u.main[0]] || '')}</textarea>`,
    },
    cells: u.cells.map(([key, kind, lab, extra, ch]) => kind === 'text' ? { col: key, kind: 'text', ch: 24, html: `<span data-ref="${esc(r.id)}" title="${esc(refTitle(r))}">${esc(refShort(r))}</span>` } : ({ col: key, kind: 'control', html: kind === 'select'
      ? `<select class="ui-cell-field" data-r="${key}" aria-label="${esc(lab)}, row ${i + 1}">${opts(extra, r[key])}</select>`
      : `<input class="ui-cell-field" data-r="${key}" value="${esc(r[key] || '')}" aria-label="${esc(lab)}, row ${i + 1}" placeholder="${esc(extra)}" autocomplete="off" spellcheck="false">` })),
    end: uiRowEnd({ more: { label: `More for ${u.name.toLowerCase()} row ${i + 1}`, attrs: { 'data-rec-more': r.id } } }) })) });
}
/** The images attached to imaging studies: a thumbnail and a caption each. */
function imageRows(c) {
  const rows = recordOf(c).imaging.flatMap((r, i) => r.files.map(f => ({ r, i, f })));
  if (!rows.length) return '';
  return uiList({ id: 'case-l-images', label: 'Attached images', cols: [], hook: 'case-tl', attrs: { 'data-case-tl': true, 'data-case-images': true }, rows: rows.map(({ r, i, f }) => uiRow({
    attrs: { 'data-img': f.id },
    main: { html: `<span class="case-thumbs"><img class="case-thumb" data-thumb="${esc(f.id)}" alt=""><input data-cap="${esc(f.id)}" value="${esc(f.caption)}" placeholder="Caption, study ${i + 1}" aria-label="Caption for ${esc(f.name || 'image')}" autocomplete="off"></span>` },
    end: uiRowEnd({ more: { label: `More for ${f.name || 'image'}`, attrs: { 'data-img-more': f.id, 'data-img-study': r.id } } }) })) });
}

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
  return uiList({ label: 'Possible identifiers', rows: hits.map(h => uiRow({ main: { html: `<span class="case-hit-kind">${icon('warn')}<span>${esc(h.kind)}</span></span>`, detail: [`${esc(h.where)}: “${esc(h.match)}”`], wrap: true } })) });
}
const consentState = c => consentRecorded(c)
  ? `${icon('check')}<span>${esc(consentLine(c))}</span>`
  : `${icon('warn')}<span>${c.consent.status === 'none' ? 'Not obtained, required for publication' : 'Not recorded, required for publication'}</span>`;

export function render(el, ctx) {
  rerender = () => ctx.rerender();
  const s = get(), c = caseOf(s), secs = careSections(s);
  const sec = id => secs.find(x => x.id === id);
  unmount();

  const body = x => {
    if (x.id === 'timeline') return `<div class="panel-body tight" data-timeline>${timelineRows(c)}</div>
      <figure class="chart-fig case-fig" data-case-fig hidden><div class="chart-svg" data-case-figure></div></figure>`;   // the figure comes with the first dated event: an empty one only repeats "No episodes"
    if (x.id === 'consent') return `<div class="panel-body">
      <label class="field"><span>Status</span><select id="case-consent-status">${opts(CONSENT, c.consent.status)}</select></label>
      <label class="field"><span>Date</span>${dateField('case-consent-date', c.consent.date || '', 'Consent date')}</label>
      <label class="field"><span>Note</span><input id="case-consent-note" value="${esc(c.consent.note || '')}" placeholder="Where the signed form is kept" autocomplete="off"></label>
      <div class="case-consent-state" data-consent-state role="status">${consentState(c)}</div></div>`;
    return `<div class="panel-body">${x.fields.map(f => field(f, c)).join('')}</div>`;
  };
  sexNow = c.sex || '';
  const labPanel = `<section class="panel" id="case-labtrends" aria-labelledby="case-h-labtrends" hidden>
      <div data-lab-head></div>
      <div class="panel-body tight" data-lab-body></div></section>`;
  const listPanel = (l, cc) => `<section class="panel" id="case-${l}" aria-labelledby="case-h-${l}">
      ${uiBar({ kind: 'head', label: LIST_UI[l].name, lead: { title: LIST_UI[l].name, id: `case-h-${l}` }, actions: [...(l === 'investigations' ? [{ id: 'case-panel', label: 'Add panel', icon: 'table', menu: true }] : []), { id: `case-add-${l}`, label: LIST_UI[l].add, icon: 'plus', role: 'primary', attrs: { 'data-add-list': l } }] })}
      <div class="panel-body tight" data-list-body="${l}">${listRows(l, recordOf(cc)[l])}${l === 'imaging' ? `<div data-image-rows>${imageRows(cc)}</div>` : ''}</div></section>${l === 'investigations' ? labPanel : ''}`;
  el.innerHTML = `<div class="case-page">
    <div class="note" id="case-note" role="status"></div>
    <datalist id="case-lab-names">${LABS.map(x => `<option value="${esc(x.name)}"${x.tr && x.tr !== x.name ? ` label="${esc(x.tr)}"` : ''}></option>`).join('')}</datalist>
    ${CASE_SECTIONS.map(x => `<section class="panel" id="case-${x.id}" aria-labelledby="case-h-${x.id}">
      ${x.id === 'timeline' ? uiBar({ kind: 'head', label: x.name, lead: { title: x.name, id: `case-h-${x.id}` }, message: { id: 'case-tl-meta', text: secMeta(sec(x.id)) }, actions: [
          // Sort and Download come with the first episode: an empty timeline offers only Add (COHERENCE-REVIEW A19)
          ...(c.timeline.length ? [{ id: 'case-sort', label: 'Sort by time', icon: 'sort', disabled: c.timeline.length < 2 }] : []),
          { id: 'case-tl-dl', label: 'Download', icon: 'download', menu: true, disabled: !caseEvents(c).length },
          { id: 'case-add-row', label: 'Add episode', icon: 'plus', role: 'primary' }] })
        : `<div class="panel-head"><h2 id="case-h-${x.id}">${esc(x.name)}</h2><span class="meta" data-sec-meta="${x.id}">${esc(secMeta(sec(x.id)))}</span></div>`}
      ${body(x)}</section>
    ${(x.lists || []).map(l => listPanel(l, c)).join('')}`).join('')}
    <section class="panel" id="case-deid" aria-labelledby="case-h-deid">
      <div class="panel-head"><h2 id="case-h-deid">De-identification</h2><span class="meta" data-hits-n>${caseIdentifiers(s).length || ''}</span></div>
      <div class="panel-body tight">
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
    const dl = el.querySelector('#case-tl-dl'); if (dl) dl.disabled = !caseEvents(cc).length;
    if (figure) { drawFigure(true); drawLabs(); }
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
    const events = caseEvents(caseOf(get())), fig = el.querySelector('[data-case-fig]');
    if (fig) fig.hidden = !events.length;
    if (!events.length) { host._w = 0; return; }
    const w = Math.round(host.clientWidth); if (!w || (!force && w === host._w)) return; host._w = w;
    host.innerHTML = sanitizeSvg(timelineSvg(events, { width: w }));
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
  const svgAt = () => timelineSvg(caseEvents(caseOf(get())), { style: figureTokens(null, { medium: 'export' }) });
  if (el.querySelector('#case-tl-dl')) wireDownload(el.querySelector('#case-tl-dl'), [
    { label: 'SVG', icon: 'download', run: () => download(svgAt(), 'case-timeline.svg', 'image/svg+xml') },
    { label: 'PNG', icon: 'image', run: () => downloadPng(svgAt(), 'case-timeline.png') },
    { label: 'CSV', icon: 'table', run: () => downloadCsv(timelineCsvRows(get()), 'case-timeline.csv') }]);

  // ---- lab trends: the same test over time, as a grid to compare days and a chart per test --------------------
  const labBody = el.querySelector('[data-lab-body]'), labHead = el.querySelector('[data-lab-head]'), labSection = el.querySelector('#case-labtrends');
  const flagCell = cell => `<td class="case-lab-cell" data-flag="${esc(cell?.flag || '')}"${cell ? ` title="${esc(cell.text)}"` : ''}>${cell ? `<span class="case-lab-val">${cell.flag ? icon(FLAG_UI[cell.flag][0], { size: 12 }) : ''}${esc(fmtVal(cell.value))}</span>` : '<span class="meta">–</span>'}</td>`;
  const drawLabCharts = () => {
    if (!labBody?.isConnected) return;
    const sr = labSeries(caseOf(get()));
    labBody.querySelectorAll('[data-lab-chart]').forEach(host => {
      const s = sr.series.find(x => x.key === host.dataset.labChart);
      if (s) host.innerHTML = sanitizeSvg(labTrendSvg(s, { width: 420, scaled: sr.scaled }));   // drawn at one size, scaled to its column by the viewBox
    });
  };
  function drawLabs() {
    if (!labBody) return;
    const cc = caseOf(get()), m = labMatrix(cc, cmp), sr = labSeries(cc);
    labSection.hidden = !m.rows.length;
    if (!m.rows.length) { labBody.innerHTML = ''; return; }
    const opts2 = sel => m.days.map(d => `<option value="${esc(d)}"${d === sel ? ' selected' : ''}>${esc(d)}</option>`).join('');
    // one line: the title, the two days the change compares, and Download
    labHead.innerHTML = uiBar({ kind: 'head', label: 'Lab trends', id: 'case-lab-head', lead: { title: 'Lab trends', id: 'case-h-labtrends' }, filters: m.days.length > 1 ? [
      { type: 'select', id: 'case-lab-from', label: 'Compare from', options: m.days.map(d => [d, `From ${d}`]), value: m.from },
      { type: 'select', id: 'case-lab-to', label: 'Compare to', options: m.days.map(d => [d, `To ${d}`]), value: m.to }] : [], actions: [{ id: 'case-lab-dl', label: 'Download', icon: 'download', menu: true }] });
    wireLabDownload();
    const grid = `<div class="case-lab-scroll"><table class="cl case-cl case-labgrid"><thead><tr><th>Test</th><th>Reference</th>${m.days.map(d => `<th${d === m.from ? ' data-cmp="from"' : d === m.to ? ' data-cmp="to"' : ''}>${esc(d)}</th>`).join('')}${m.days.length > 1 ? `<th title="${esc(m.from)} to ${esc(m.to)}">Change</th>` : ''}</tr></thead>
      <tbody>${m.rows.map((r, i) => `${i === 0 || m.rows[i - 1].group !== r.group ? `<tr class="case-lab-group"><th colspan="${m.days.length + 2 + (m.days.length > 1 ? 1 : 0)}" scope="colgroup">${esc(r.group)}</th></tr>` : ''}<tr><td>${r.n > 1 ? `<button type="button" class="case-lab-name" data-lab-toggle="${esc(r.key)}" aria-expanded="${openLabs.has(r.key)}" title="${openLabs.has(r.key) ? 'Hide' : 'Show'} the chart">${icon(openLabs.has(r.key) ? 'chevron-down' : 'chevron-right', { size: 12 })}<span>${esc(r.name)}</span>${r.unit ? `<span class="case-lab-unit">${esc(r.unit)}</span>` : ''}</button>` : `<span class="case-lab-name case-lab-name-plain"><span>${esc(r.name)}</span>${r.unit ? `<span class="case-lab-unit">${esc(r.unit)}</span>` : ''}</span>`}</td><td class="meta" title="${esc(r.title)}">${esc(r.reference)}</td>${m.days.map(d => flagCell(r.cells[d])).join('')}${m.days.length > 1 ? `<td class="case-lab-change">${r.change ? `${icon(r.change.delta > 0 ? 'arrow-up' : r.change.delta < 0 ? 'arrow-down' : 'minus', { size: 12 })}${esc(changeText(r.change))}` : ''}</td>` : ''}</tr>${r.n > 1 && openLabs.has(r.key) ? `<tr class="case-lab-chartrow"><td colspan="${m.days.length + 2 + (m.days.length > 1 ? 1 : 0)}"><figure class="chart-fig case-lab-fig"><div class="chart-svg" data-lab-chart="${esc(r.key)}"></div></figure></td></tr>` : ''}`).join('')}</tbody></table></div>`;
    labBody.innerHTML = grid;
    labBody.querySelectorAll('[data-lab-toggle]').forEach(b => b.onclick = () => { const k = b.dataset.labToggle; if (openLabs.has(k)) openLabs.delete(k); else openLabs.add(k); drawLabs(); });
    labHead.querySelector('#case-lab-from')?.addEventListener('change', e => { cmp.from = e.target.value; drawLabs(); });
    labHead.querySelector('#case-lab-to')?.addEventListener('change', e => { cmp.to = e.target.value; drawLabs(); });
    drawLabCharts();
  }
  const labSheet = async (kind) => {
    const { labSheetSvg } = await import('../lib/case-labs.mjs');
    const svg = labSheetSvg(caseOf(get()), { style: figureTokens(null, { medium: 'export' }) });
    if (kind === 'svg') download(svg, 'case-lab-trends.svg', 'image/svg+xml'); else downloadPng(svg, 'case-lab-trends.png');
  };
  function wireLabDownload() {
    const labDl = el.querySelector('#case-lab-dl');
    if (labDl) wireDownload(labDl, [
      { label: 'SVG', icon: 'download', run: () => labSheet('svg') },
      { label: 'PNG', icon: 'image', run: () => labSheet('png') },
      { label: 'CSV', icon: 'table', run: () => downloadCsv(labCsvRows(caseOf(get()), cmp), 'case-lab-results.csv') }]);
  }
  drawLabs();

  // ---- the structured lists ------------------------------------------------------
  const setRec = (l, id, patch) => save(cc => ({ ...cc, [l]: recordOf(cc)[l].map(r => (r.id === id ? { ...r, ...patch } : r)) }));
  el.querySelectorAll('[data-case-list]').forEach(list => {
    const l = list.dataset.caseList;
    list.querySelectorAll('[data-rec]').forEach(row => row.querySelectorAll('[data-r]').forEach(i => {
      i.addEventListener('focus', () => { focused = { label: `${LIST_UI[l].name}, ${i.getAttribute('aria-label')}`, el: i }; });
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
        const patch = { [i.dataset.r]: i.value };
        if (l === 'investigations' && ['test', 'value'].includes(i.dataset.r)) {
          // the flag follows the table while it is empty or still the one the table gave; a flag a person chose stays
          const get = k => row.querySelector(`[data-r="${k}"]`), test = get('test').value, value = get('value').value, ev = evaluate(test, value, sexNow);
          const ref = row.querySelector('[data-ref]'); if (ref) { ref.textContent = refShort({ test }); ref.title = refTitle({ test }); }
          const now = row.dataset.flag || '';
          if (!now || now === row.dataset.auto) { row.dataset.auto = ev?.flag || ''; patch.flag = ev?.flag || ''; showFlag(row, patch.flag); }
        }
        setRec(l, row.dataset.rec, patch); refresh({ figure: true });
      });
    }));
  });
  const showFlag = (row, flag) => {
    row.dataset.flag = flag;
    const b = row.querySelector('[data-flag-btn]');
    if (b) { b.dataset.flag = flag; b.innerHTML = icon(FLAG_UI[flag][0], { size: 14 }); b.title = `${FLAG_UI[flag][1]}. Change`; b.setAttribute('aria-label', `Flag: ${FLAG_UI[flag][1]}. Change`); }
  };
  el.querySelectorAll('[data-flag-btn]').forEach(b => b.onclick = () => {
    const row = b.closest('[data-rec]'), id = row.dataset.rec;
    showMenu(b, Object.entries(FLAG_UI).map(([flag, [ico, word]]) => ({ label: word, icon: ico, checked: (row.dataset.flag || '') === flag, run: () => {
      row.dataset.auto = '';   // a flag a person sets stays: the table no longer follows the value
      showFlag(row, flag); setRec('investigations', id, { flag }); refresh({ figure: true });
    } })), { align: 'start', minWidth: 160 });
  });
  const panelBtn = el.querySelector('#case-panel');
  if (panelBtn) panelBtn.onclick = () => showMenu(panelBtn, PANELS.map(([name, ids]) => ({ label: name, run: () => {
    const base = Date.now().toString(36);
    save(cc => ({ ...cc, investigations: [...recordOf(cc).investigations, ...ids.map((id, k) => ({ id: `p${base}${k}`, test: labById(id).short }))] }));
    ctx.rerender(); ctx.refreshCounts();
  } })), { align: 'end', minWidth: 200 });
  el.querySelectorAll('[data-add-list]').forEach(b => b.onclick = () => {
    const l = b.dataset.addList; newRec = { l, id: rid() };
    save(cc => ({ ...cc, [l]: [...recordOf(cc)[l], { id: newRec.id }] }));
    ctx.rerender(); ctx.refreshCounts();
  });
  el.querySelectorAll('[data-rec-more]').forEach(b => b.onclick = () => {
    const l = b.closest('[data-case-list]').dataset.caseList, id = b.dataset.recMore;
    showMenu(b, [...(l === 'imaging' ? [{ label: 'Attach images', icon: 'image', run: () => attachImages(id, ctx) }] : []),
      { label: 'Remove row', icon: 'trash', run: () => {
        for (const f of recordOf(get().caseReport)[l].find(r => r.id === id)?.files || []) deleteFile(f.id).catch(() => {});
        save(cc => ({ ...cc, [l]: recordOf(cc)[l].filter(r => r.id !== id) })); ctx.rerender(); ctx.refreshCounts();
      } }], { align: 'end', minWidth: 160 });
  });
  el.querySelectorAll('[data-img-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove image', icon: 'trash', run: () => {
    deleteFile(b.dataset.imgMore).catch(() => {});
    save(cc => ({ ...cc, imaging: recordOf(cc).imaging.map(r => (r.id === b.dataset.imgStudy ? { ...r, files: r.files.filter(f => f.id !== b.dataset.imgMore) } : r)) }));
    ctx.rerender(); ctx.refreshCounts();
  } }], { align: 'end', minWidth: 160 }));
  el.querySelectorAll('[data-cap]').forEach(i => i.addEventListener('input', () => {
    save(cc => ({ ...cc, imaging: recordOf(cc).imaging.map(r => ({ ...r, files: r.files.map(f => (f.id === i.dataset.cap ? { ...f, caption: i.value } : f)) })) })); refresh();
  }));
  // the thumbnails come from storage; a file that cannot be read leaves its frame empty
  el.querySelectorAll('img[data-thumb]').forEach(async img => {
    try { const blob = await getFile(img.dataset.thumb); if (!blob || !img.isConnected) return; const u = URL.createObjectURL(blob); thumbs.push(u); img.src = u; } catch { /* unreadable */ }
  });

  // ---- consent -------------------------------------------------------------------
  const setConsent = patch => { save(cc => ({ ...cc, consent: { ...cc.consent, ...patch } })); refresh(); };
  el.querySelector('#case-consent-status').onchange = e => setConsent({ status: e.target.value });
  wireDateField(el, 'case-consent-date', 'Consent date');
  el.querySelector('#case-consent-date').onchange = e => setConsent({ date: e.target.value });
  el.querySelector('#case-consent-note').oninput = e => setConsent({ note: e.target.value });

  refresh();
  if (newRow) { el.querySelector(`[data-row="${newRow}"] [data-t="when"]`)?.focus(); newRow = null; }
  if (newRec) { el.querySelector(`[data-rec="${newRec.id}"] [data-r]`)?.focus(); newRec = null; }
  // After the shell has put a newly opened view at its top.
  if (jump) { const target = el.querySelector(`#case-${jump}`); jump = null; requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' })); }
}

// ---- images and FHIR ------------------------------------------------------------------
const note = text => { const n = document.getElementById('case-note'); if (n) n.textContent = text; };
const picker = (accept, multiple, done) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple, hidden: true });
  input.onchange = () => { const files = [...input.files]; input.remove(); if (files.length) done(files); };
  document.body.append(input); input.click();
};
/** Stores the chosen pictures (PNG, JPEG, WebP, GIF) with the study; they are never read for names or burned-in text. */
function attachImages(studyId, ctx) {
  picker('image/png,image/jpeg,image/webp,image/gif,image/avif', true, async files => {
    const added = [];
    for (const [k, file] of files.entries()) {
      const id = `case-img-${studyId}-${Date.now().toString(36)}${k}`;
      try { await putFile(id, file); added.push({ id, name: file.name, caption: '' }); } catch (err) { note(`${file.name} not stored: ${String(err.message || err).slice(0, 100)}`); }
    }
    if (!added.length) return;
    save(cc => ({ ...cc, imaging: recordOf(cc).imaging.map(r => (r.id === studyId ? { ...r, files: [...r.files, ...added] } : r)) }));
    ctx.rerender(); ctx.refreshCounts();
  });
}
/** Appends the rows of a FHIR Bundle to the case; the age, sex and consent are taken only where the case has none. */
function importFhir() {
  picker('.json,application/json,application/fhir+json', false, async ([file]) => {
    try {
      const { patch, counts, skipped } = fhirToCase(JSON.parse(await file.text()));
      const sex = patch.sex || get().caseReport?.sex || '';
      for (const r of patch.investigations) if (!r.flag) r.flag = evaluate(r.test, r.value, sex)?.flag || '';   // the table's flag where the file gave none
      save(cc => ({ ...cc, ...(!cc.sex && patch.sex ? { sex: patch.sex } : {}), ...(!cc.age && patch.age ? { age: patch.age } : {}),
        ...(!cc.consent?.status && patch.consent ? { consent: patch.consent } : {}),
        ...Object.fromEntries(['medicalHistory', 'imaging', 'investigations', 'treatments', 'measures'].map(l => [l, [...recordOf(cc)[l], ...patch[l]]])),
        timeline: [...cc.timeline, ...patch.timeline] }));
      const parts = Object.entries(counts).filter(([, n]) => n).map(([l, n]) => `${n} ${l === 'medicalHistory' ? 'history' : l}`);
      note(`Added ${parts.join(', ') || 'nothing'} from ${file.name}${skipped.length ? `; not read: ${skipped.join(', ')}` : ''}`);
      rerender?.();
    } catch (err) { note(`${file.name}: ${String(err.message || err).slice(0, 120)}`); }
  });
}
let rerender = null;

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
    detail: [STATES.find(x => x[0] === (c.state || ''))?.[1], c.where].filter(Boolean).join(', ') };
}
/** Reporting for a case report: the CARE checklist and the export bundle. */
export function renderReporting(el, ctx) {
  const s = get(), list = checklistOf(s), states = checklistStates(s), sup = supported(s);
  const reported = list.items.filter(([n]) => states[n]?.state === 'done').length;
  el.innerHTML = `<div class="case-report-rp">
    <div class="panel">
      ${uiBar({ kind: 'head', label: 'CARE checklist', id: 'cl-head', cls: 'panel-head', lead: { title: 'CARE checklist', level: 'h2' }, status: { id: 'cl-count', text: `${reported} reported, ${list.items.length} items`, ch: 24 },
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
    el.querySelector('#cl-count').textContent = `${n} reported, ${checklistOf(st).items.length} items`;
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
    const open = r.missing.length ? `, ${r.missing.length} ${r.missing.length === 1 ? 'item' : 'items'} listed in unresolved.md` : '';
    if (note) note.textContent = r.failed?.length ? `Not written: ${r.failed.map(f => f.error).join('; ')}`
      : r.unchanged ? `Unchanged since ${r.unchanged}` : r.written ? `Wrote ${r.written.join(', ')}${open}` : `Saved${open}`;
  } catch (err) { if (note) note.textContent = String(err.message || err).slice(0, 120); }
  if (b) b.disabled = false;
}

import { REGISTRY } from './registry.mjs';
import { copyText } from '../lib/clipboard.mjs';
import { derive, prismaData, pending } from '../lib/prisma-counts.mjs';
// Reporting: PRISMA 2020 flow diagram, drawn natively (plan 4.6).
// Counts that the app can reconcile from its own state are filled in and
// marked; the rest are entered by hand. A count the app cannot derive is never
// invented (plan K1).
import { checklistOf, checklistStates, STATES as CL_STATES, supported as clSupported, CHECKLISTS } from '../lib/checklist.mjs';
import { EXTRA_CHECKLISTS } from '../lib/checklists-extra.mjs';
import { choicesFor, applied } from '../lib/checklist-choice.mjs';
import { extraChecklists, normalizeChecklistChoice, toggleChoice } from '../lib/protocol-governance.mjs';
import { saveFile } from '../lib/save.mjs';
import { plural } from '../lib/dates.mjs';
import { compile as compileStrategy, toMarkdownAll as strategyMarkdown, toBlocksAll as strategyBlocks, recordedQuery, yieldsTable } from '../lib/prisma-s.mjs';
import { formField, tableRegion, disclosure } from '../lib/ui-components.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiStatusLine, inspectorActions, watchWidth } from '../lib/ui-actions.mjs';
import { PAGE_VIEW_MAX } from '../lib/topbar.mjs';
import { showMenu } from '../lib/menu.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { draftSection } from '../lib/helpers.mjs';
import { projectContext } from '../lib/assist.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { configured } from '../lib/ai.mjs';
import { proposalBox, esc } from '../lib/html.mjs';
import { get, update } from '../store.mjs';
import { PRISMA_FIELDS, PRISMA_GROUPS } from '../schema.mjs';
import { parseReasons, formatReasons } from '../lib/prisma-reasons.mjs';
import { prismaFlow } from '../lib/prisma-flow.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { enlargeFigure, figurePanel, showFigure, download, downloadCsv, downloadPng, wireDownload } from '../lib/figure.mjs';
import { handEnteredIds, prismaCountRows } from '../lib/submission.mjs';
import { isPrimaryType } from '../lib/research-types.mjs';
import { researchType } from '../lib/workflow.mjs';
import { aiUseRows, aiUseMethodsText, aiUseMarkdown, aiUseNotes, setAiUseNote, NOTE_FIELDS, NOTE_MAX } from '../lib/ai-use.mjs';
import { icon } from '../lib/icons.mjs';
import { dateField, wireDateField } from '../lib/date-picker.mjs';
import { evidenceMap, evidenceMapRows, evidenceMapSvg, mappableFields, mapFields, mapOptions } from '../lib/evidence-map.mjs';
import { studyCell } from '../lib/bib.mjs';
import { wireStudies } from '../lib/study.mjs';
import { summaryPanel, wireSummary } from './search-summary-panel.mjs';
import { recordsSection, wireBoxes, markBox } from './prisma-records-panel.mjs';
import { renderReporting as renderCareReporting, reportingFocus as careFocus, runBundle } from './case.mjs';
import { results } from '../lib/results.mjs';
import { participantFlow, participantFlowRows, participantFlowSvg, setFlowCount } from '../lib/participant-flow.mjs';
import { MAIN, TEMPLATES, templateName, reviewsOf, reviewOf, scoped, setReviewKey, addReview, editReview, removeReview, assignSearch, runReview } from '../lib/reviews.mjs';
import { reviewFlowSvg, reviewCountRows } from '../lib/review-flow.mjs';
import { ipdCounts, ipdStatus, wireFlow as wireIpdFlow } from './patients-flow.mjs';
import { boxesRead } from './prisma-records-panel.mjs';

export const meta = { title: 'Reporting', icon: 'flow' };
export function searchStrategiesHtml(databases, prefix = '') {
  return databases.map((d,k)=>`<section class="ss-db" aria-label="${esc(d.source)} search strategy">
    ${uiBar({ kind: 'head', label: `${d.source} search strategy`, id: `ss-db-head-${prefix}${k}`, lead: { title: d.source, level: 'h3' }, message: { text: [d.date, d.records != null ? `${d.records} records` : ''].filter(Boolean).join(', ') },
      actions: [{ id: `ss-copy-${prefix}${k}`, label: 'Copy', icon: 'copy', role: 'quiet', attrs: { 'data-ss-copy': `${prefix}${k}`, 'aria-label': `Copy ${d.source} search strategy` } }] })}
    <pre class="ss-query"><code>${esc(recordedQuery(d))}</code></pre></section>`).join('');
}
export const count = (...a) => REGISTRY.reporting.count(...a);
export function assistContext() {
  const s = get(); const cl = checklistStates(s), list = checklistOf(s);
  const blank = list.items.filter(([n]) => !cl[n] || cl[n].state !== 'done').map(([n, name]) => `${n} ${name}`);
  return [list.id === 'care' ? 'Reporting: CARE checklist for a case report' : `Reporting: PRISMA counts ${Object.entries(s.prisma || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `${list.name} checklist: ${list.items.length - blank.length} of ${list.items.length} reported; not yet: ${blank.slice(0, 15).join(', ')}${blank.length > 15 ? ', …' : ''}`].join('\n');
}

const ARMS = [
  { id: 'other',    label: 'Other methods' },
  { id: 'previous', label: 'Previous version' },
];
/** Searches in the log that the flow leaves out because they are marked exploratory. */
const excludedRuns = s => (s.searches || []).filter(r => r.exploratory && r.status !== 'failed').length;
const armsOf = s => ({ other: false, previous: false, ...(s.prismaArms || {}) });

// The checklist item or flow count last clicked or focused, for model actions
// (lib/aid.mjs). It outlives renders, so an action chosen after the click
// still acts on it.
let focused = null;   // { item } or { field }
export function focus() {
  if (checklistOf(get()).id === 'care') return careFocus();
  if (!focused) return null;
  const s = get();
  if (focused.item) {
    const row = checklistOf(s).items.find(([n]) => n === focused.item);
    if (!row) return null;
    const c = checklistStates(s)[row[0]] || {};
    return { kind: 'checklist item', label: `${row[0]} ${row[1]}`, text: row[2],
      detail: [CL_STATES.find(x => x[0] === (c.state || ''))?.[1], c.where].filter(Boolean).join(', ') };
  }
  const f = PRISMA_FIELDS.find(x => x.id === focused.field);
  if (!f) return null;
  const v = prismaData(scoped(s, reviewId))[f.id];
  return { kind: 'flow count', label: f.label, detail: v === undefined || v === '' ? 'empty' : String(v) };
}

// The figure on screen has its boxes as targets (views/prisma-records-panel.mjs);
// the one downloaded or enlarged is drawn without.
// Both in the house style (FIGURE-STYLE §2): the screen copy themed by its classes, the file drawn for print.
// The review on show (lib/reviews.mjs): its own searches, counts and template. A project with one review shows it alone.
let reviewId = MAIN;
const review = () => reviewOf(get(), reviewId);
/** The project as the review on show sees it. */
const cur = () => scoped(get(), review().id);
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'review';
const flowFile = () => reviewsOf(get()).length > 1 ? `${review().template}-flow-${slug(review().name)}` : review().template === 'prisma-ipd' ? 'prisma-ipd-flow' : 'prisma-flow';
export function previewSvg(interactive = false, medium = 'screen') {
  return reviewFlowSvg(get(), review().id, { interactive: interactive && review().template !== 'prisma-ipd', style: figureTokens(null, { medium }) });
}

function expandPreview() {
  enlargeFigure({ title: 'Flow diagram', svg: previewSvg(), filename: flowFile(), exportSvg: () => previewSvg(false, 'export'),
    data: () => [['Count', 'Value', 'Source'], ...reviewCountRows(get(), review().id)] });
}

export function inspect(ctx) {
  const records = checklistOf(get()).id === 'care' || review().template === 'prisma-ipd' ? null : recordsSection(ctx);
  return [{ title: 'Flow preview', html: `<div class="prisma-preview chart-svg" data-prisma-preview>${previewSvg(true)}</div>${inspectorActions({ label: 'Flow preview actions', id: 'rp-insp-acts', actions: [
      { id: 'rp-insp-enlarge', label: 'Enlarge', icon: 'fit', attrs: { 'data-enlarge': true } }, { id: 'rp-insp-download', label: 'Download', icon: 'download', menu: true, attrs: { 'data-download': true } }] })}`,
    wire: el => {
      wireBoxes(el.querySelector('[data-prisma-preview]'), ctx);
      el.querySelector('[data-enlarge]').onclick = expandPreview;
      wireDownload(el.querySelector('[data-download]'), [{ label: 'SVG', icon: 'image', run: () => download(previewSvg(false, 'export'), `${flowFile()}.svg`, 'image/svg+xml') }]);
    } }, ...(records ? [records] : [])];
}

// One named count: an exclusion reason, or a database or register by name.
const ROW_HINT = { Reason: 'e.g. Wrong population', Database: 'e.g. Embase', Register: 'e.g. ClinicalTrials.gov' };
// A plain count has no row action. Its end is reserved (uiRowEnd reserve), so its number box stands where a named count's does.
// A count's source is a column of every row of the flow (the project, or for a count entered by hand the field that explains it), so every count box
// stands on one edge in every list; a named count holds that column's room.
const heldCells = [{ col: 'source', kind: 'visual', html: '<span class="rp-why-slot" aria-hidden="true"></span>' }];
const heldEnd = () => uiRowEnd({ reserve: true });
const COUNT_SOURCES = {
  Database: ['PubMed', 'MEDLINE', 'Embase', 'Scopus', 'Web of Science', 'Cochrane Library', 'CENTRAL', 'CINAHL', 'PsycINFO', 'Europe PMC', 'OpenAlex', 'IEEE Xplore'],
  Register: ['ClinicalTrials.gov', 'WHO ICTRP', 'ISRCTN', 'EU Clinical Trials Register', 'Clinical Trials Information System (CTIS)', 'ANZCTR'],
};
/**
 * One named count as a list row: the name is the row's text (a select of known sources with a custom name beneath it, or a
 * free reason), the count its one control cell, and Remove sits in the row's More (a destructive action is never inline).
 */
export function reasonRow(row = {}, label = 'Reason') {
  const sources = COUNT_SOURCES[label], reason = row.reason || '', noun = label.toLowerCase();
  const count = { col: 'count', kind: 'control', html: `<span class="rp-box"><input data-reason-count class="rp-count" value="${esc(row.count ?? '')}" inputmode="numeric" aria-label="Count"></span>` };
  const end = uiRowEnd({ more: { label: `More for ${noun}`, attrs: { 'data-reason-more': true } } });
  const cells = [count, ...heldCells];
  if (sources) {
    const custom = !!reason && !sources.includes(reason);
    return uiRow({ attrs: { 'data-reason-row': true, 'data-custom-source': custom ? reason : '' },
      main: { html: `<select data-reason-source aria-label="${esc(label)}">
        <option value=""${!reason ? ' selected' : ''}>Choose ${noun}</option>
        ${sources.map(name => `<option value="${esc(name)}"${reason === name ? ' selected' : ''}>${esc(name)}</option>`).join('')}
        <option value="__custom__"${custom ? ' selected' : ''}>Other ${noun}…</option></select><div class="rp-custom" data-reason-custom${custom ? '' : ' hidden'}>${formField(`${label} name`, `<input data-reason value="${esc(reason)}" placeholder="Custom ${noun} name">`)}</div>` },
      cells, end });
  }
  return uiRow({ attrs: { 'data-reason-row': true },
    main: { html: `<input data-reason value="${esc(row.reason || '')}" placeholder="${esc(ROW_HINT[label] || '')}" aria-label="${esc(label)}">` },
    cells, end });
}

export function wireReasonRow(row, save, onFocus) {
  row.querySelectorAll('input').forEach(input => { input.oninput = save; input.onfocus = onFocus; });
  const select = row.querySelector('[data-reason-source]');
  if (!select) return;
  select.onfocus = onFocus;
  select.onchange = () => {
    const custom = row.querySelector('[data-reason-custom]'), input = row.querySelector('[data-reason]');
    if (!custom.hidden) row.dataset.customSource = input.value;
    custom.hidden = select.value !== '__custom__';
    input.value = custom.hidden ? select.value : row.dataset.customSource || '';
    save();
    if (!custom.hidden) input.focus();
  };
}

let section = 'flow';        // the reporting section on show, chosen in the rail
let releaseFlowWidth = null; // the width hook of the flow page, let go on the next draw
const FLOW_PAIR = 880;       // the page width from which the counts and the diagram stand side by side
let figureShown = true;      // the flow page's own diagram, folded by its head's toggle (its head stays, so it is never hidden without a trace)

// One section at a time: the flow counts, the search, the map, the checklist
// each fill the page on their own instead of stacking into one long scroll.
// They are the rail's items (the shell's list pane), each with where it stands.
const sectionsOf = s => { const extra = extraChecklists(s).map(x => [x.id, x.title]);
  return isPrimaryType(researchType(s).id) ? [['checklist', 'Checklist'], ['participant-flow', 'Participant flow'], ...extra, ['ai', 'AI use']]
  : [['flow', 'Flow'], ['search', 'Search strategy'], ['summary', 'Search summary'],
  ...(checklistOf(s).id === 'prisma-scr' ? [['map', 'Evidence map']] : []), ['checklist', 'Checklist'], ...extra, ['ai', 'AI use']]; };
const isCare = s => checklistOf(s).id === 'care';
const reported = s => { const cl = checklistOf(s), st = checklistStates(s); return `${cl.items.filter(([n]) => st[n]?.state === 'done').length} of ${cl.items.length} reported`; };
export const list = {
  title: 'Sections',
  inBar: true,   // in one pane the sections are the title bar's switch, not a list behind a Back (app.mjs arrange, page())
  items(s) {
    if (isCare(s)) return [{ id: 'care', title: 'CARE checklist', sub: reported(s), meta: '', mark: '' }];
    const derived = Object.keys(derive(s)).length, hand = handEnteredIds(s).length, reviews = reviewsOf(s).length;
    const logged = (s.searches || []).filter(r => r.query && !r.citationSearch && !r.related && r.status !== 'failed').length;
    const subs = {
    flow: reviews > 1 ? `${reviews} reviews` : [derived ? `${derived} from project` : '', hand ? `${hand} by hand` : ''].filter(Boolean).join(', ') || 'No counts yet',
      search: logged ? `${logged} ${logged === 1 ? 'search' : 'searches'} (PRISMA-S)` : 'No searches logged',
      summary: 'Yields by source', map: 'Two characteristics charted', checklist: reported(s), ai: 'Models used, and where',
    };
    for (const x of extraChecklists(s)) { const st = s[x.checklist.key] || {}; subs[x.id] = `${x.checklist.name}: ${x.checklist.items.filter(([n]) => st[n]?.state === 'done').length} of ${x.checklist.items.length}`; }
    return sectionsOf(s).map(([id, title]) => ({ id, title, sub: subs[id] || '', meta: '', mark: '' }));
  },
};
export function select(id) { if (sectionsOf(get()).some(([k]) => k === id)) section = id; }
/** Arrival from Needs attention (lib/arrive.mjs): blank PRISMA counts open the flow, where they are entered; a primary study's reporting opens its checklist. Nothing is narrowed. */
export function arrive(a) {
  if (a?.kind === 'prisma-blank') select('flow');
  else if (a?.kind === 'reporting') select(isPrimaryType(researchType(get()).id) ? 'checklist' : 'flow');
  return false;
}
export function selected() { return isCare(get()) ? 'care' : section; }
/** The title bar's two actions act on the page on show: render sets what they run (lib/topbar.mjs binds `run` by id, so a redraw of the bar keeps them). A case report's own reporting page carries its own. */
let abstractRun = null, bundleRun = null;
/**
 * The title bar (lib/topbar.mjs). Beside the Sections pane the title is the section on show; in one pane (`single`, the shell's list.inBar) the
 * sections are the bar's one navigator instead of a Back: a view switch while there are five or fewer, else the title is a picker of them.
 */
export function pageSpec({ sections, value, care = false, canWrite = true, single = false }, { onShow = () => {}, abstract = () => {}, bundle = () => {} } = {}) {
  const name = sections.find(([k]) => k === value)?.[1] || 'Reporting';
  if (care) return { title: 'Reporting', actions: [] };
  const acts = [{ id: 'rp-abstract', label: 'Draft abstract', icon: 'file-plus', disabled: !canWrite, run: abstract }, { id: 'bundle', label: 'Export bundle', icon: 'export', run: bundle }];
  if (!single || sections.length < 2) return { title: name, actions: acts };
  if (sections.length <= PAGE_VIEW_MAX) return { title: 'Reporting', view: { id: 'rp-section', label: 'Reporting section', attr: 'data-rp-section', value, items: sections, run: onShow }, actions: acts };
  return { title: name, titleMenu: anchor => showMenu(anchor, sections.map(([k, label]) => ({ label, checked: k === value, run: () => onShow(k) })), { align: 'start', minWidth: 200 }), actions: acts };
}
export function page(rerender, { single = false } = {}) {
  const s = get(), sections = isCare(s) ? [] : sectionsOf(s);
  if (sections.length && !sections.some(([k]) => k === section)) section = sections[0][0];
  return pageSpec({ sections, value: section, care: isCare(s), canWrite: configured(modelFor('write')), single },
    { onShow: key => { select(key); rerender(); }, abstract: () => abstractRun?.(), bundle: () => bundleRun?.() });
}

export function render(el, ctx) {
  // A case report reports against CARE and has no flow to count (views/case.mjs).
  if (checklistOf(get()).id === 'care') { renderCareReporting(el, ctx); return; }
  const full = get();
  // The checklist's supporting artefacts and states, once per render, not once per item.
  const clSup = clSupported(full), clStates = checklistStates(full);
  if (isPrimaryType(researchType(full).id)) { renderPrimaryReporting(el, ctx, full, clSup, clStates); return; }
  // The flow is one review's (lib/reviews.mjs): `s` is the project as that review sees it; the checklist, summary, map and AI use read the whole project.
  if (!reviewsOf(full).some(r => r.id === reviewId)) reviewId = MAIN;
  const rv = review(), ipd = rv.template === 'prisma-ipd', s = scoped(full, rv.id);
  boxesRead(cur);
  const derived = derive(s), waiting = pending(s);
  const data = { ...derived, ...(s.prisma || {}) };
  const arms = armsOf(s);
  // A count entered by hand needs an explanation (plan K1): kept with the
  // project, required, and shown in the bundle beside the count.
  const notes = s.prismaNotes || {};
  const hand0 = new Set(handEnteredIds(s));
  // The explanation is a full-width line under its count; it is shown while the count is entered by hand.
  const whyInput = (f, note) => `<input data-why="${f.id}" value="${esc(note)}" placeholder="Why this count" aria-required="true" aria-invalid="${!note.trim()}" aria-label="${esc(`Explanation for ${f.label.toLowerCase()}`)}">`;
  // Where a plain count comes from is one slot of one width: "Project" for a count the project gives, and for a count entered by hand the field that
  // explains it, in the same place, so nothing moves when one replaces the other.
  const whySlot = f => `<span class="rp-why-slot"><span class="rp-src" data-src="${f.id}"${hand0.has(f.id) ? ' hidden' : ''}>${esc(sourceOf(f.id, s))}</span><span class="rp-why-box" data-why-for="${f.id}"${hand0.has(f.id) ? '' : ' hidden'}>${whyInput(f, notes[f.id] || '')}</span></span>`;
  const whyRow = f => {
    const hand = hand0.has(f.id), note = notes[f.id] || '';
    return `<div class="rp-why" data-why-for="${f.id}"${hand ? '' : ' hidden'}>${formField('Explanation', `<input data-why="${f.id}" value="${esc(note)}" placeholder="Why this count" aria-required="true" aria-invalid="${!note.trim()}" aria-label="${esc(`Explanation for ${f.label.toLowerCase()}`)}">`)}</div>`;
  };
  // The project's own count beside one entered by hand, so the difference is in view.
  // The project's own count stands under the label while a count is entered by hand, so the difference is in view; the source column says where the number comes from.
  const provenance = (id, st) => handEnteredIds(st).includes(id) && typeof derived[id] === 'number' ? `Project count ${derived[id]}` : '';
  const sourceOf = id => typeof derived[id] === 'number' ? 'Project' : '';
  const unexplained = st => handEnteredIds(st).filter(k => !String(st.prismaNotes?.[k] || '').trim()).length;
  const handText = st => `${handEnteredIds(st).length} entered by hand`, unexplainedText = st => `${unexplained(st)} without explanation`;
  // A phase tied to an arm the review did not use is not shown at all.
  const groups = PRISMA_GROUPS.filter(g => !g.arm || arms[g.arm]);
  const countRow = f => uiRow({ attrs: { 'data-count-row': f.id },
    // The project's count is a line under the label that is drawn only while it has text, so a count with none has its label on the field's centre.
    main: { html: `<label class="rp-label" for="p-${f.id}">${esc(f.label)}</label><span class="rp-prov" data-prov="${f.id}">${esc(provenance(f.id, s))}</span>` },
    cells: [{ col: 'count', kind: 'control', html: `<span class="rp-box"><input id="p-${f.id}" class="rp-count" value="${esc(data[f.id] ?? '')}" inputmode="numeric" autocomplete="off" aria-label="${esc(f.label)}"></span>` },
      { col: 'source', kind: 'control', html: whySlot(f) }], end: heldEnd() });
  // A named count (a database, a register, an exclusion reason): its rows, then one Add.
  const namedList = f => {
    const noun = (f.reasonLabel || 'Reason').toLowerCase(), parsed = parseReasons(data[f.id] || '');
    return `<div class="rp-named" data-reasons="${f.id}"><input type="hidden" id="p-${f.id}" value="${esc(data[f.id] ?? '')}">${uiList({ id: `rp-named-${f.id}`, label: f.label, cols: ['count', 'source'], cls: 'rp-list',
      head: `<p class="rp-group-title">${esc(f.label)}</p>`,
      rows: [...(parsed.length ? parsed : [{}]).map(r => reasonRow(r, f.reasonLabel)),
        uiBar({ kind: 'tools', cls: 'rp-add', label: `Add ${noun}`, id: `rp-add-${f.id}`, actions: [{ id: `rp-add-${f.id}-btn`, label: `Add ${noun}`, icon: 'plus', attrs: { 'data-add-reason': true } }] }), whyRow(f)] })}</div>`;
  };
  // Consecutive plain counts are one list; a named count breaks it so the order of the diagram's boxes is kept.
  const phaseBody = (g, gi) => {
    const out = []; let run = [];
    const flush = () => { if (run.length) out.push(uiList({ id: `rp-counts-${gi}-${out.length}`, label: `${g.phase} counts`, cols: ['count', 'source'], cls: 'rp-list', rows: run })); run = []; };
    for (const f of g.fields) { if (f.text) { flush(); out.push(namedList(f)); } else run.push(countRow(f)); }
    flush();
    return out.join('');
  };
  const uncounted = excludedRuns(s);
  // The search, as each review reports it: its yields table with dates and total, then each strategy as run.
  const strat = compileStrategy(scoped(full, MAIN)), reports = strategyReports(full);

  // Counts on the left, the diagram they produce on the right, live. A flow
  // diagram edited from a form it is scrolled away from is edited blind.
  if (!sectionsOf(full).some(([k]) => k === section)) section = sectionsOf(full)[0][0];
  const hide = k => k === section ? '' : ' hidden';
  el.innerHTML = `<div class="prisma" id="rp-panel">
    <div class="rp-notes"><div class="meta" id="rp-note"></div><div id="rp-proposal"></div><div class="note" id="bundle-note"></div></div>
    <div class="rp-flow" data-rp="flow"${hide('flow')}>
    <div class="panel prisma-counts rp-panel">
      ${uiBar({ kind: 'head', cls: 'rp-head', label: `${templateName(rv.template)} flow`, id: 'rp-flow-head', lead: { title: `${templateName(rv.template)} flow`, level: 'h2' },
        ...(ipd ? { message: { id: 'rp-ipd-status', text: ipdStatus(s) } } : { status: { id: 'rp-from-project', text: `${Object.keys(derived).length} from project`, ch: 16 } }),
        actions: [{ id: 'rp-review-add', label: 'Add review', icon: 'layers', role: 'secondary', attrs: { 'data-review-add': true } }],
        ...(rv.main ? {} : { overflow: [{ id: 'rp-review-remove', label: 'Remove review', icon: 'trash', danger: true }] }) })}
      ${reviewForm(full, rv)}
      ${ipd ? `<div class="panel-body tight">${ipdCounts(s)}</div>` : `${uiStatusLine({ id: 'rp-flow-status', label: 'Flow counts', parts: [
        // The parts are as wide as their words, so the line reads as one: their counts are tabular figures, and a count that gains a digit moves only what follows it.
        { id: 'rp-hand', text: handText(s), drop: 2 }, { id: 'rp-unexplained', text: unexplainedText(s), drop: 3 },
        ...(uncounted ? [{ id: 'rp-uncounted', text: `${plural(uncounted, 'search', 'searches')} not counted`, button: true, drop: 5, attrs: { 'data-rp-search': true, title: 'Open the search log' } }] : []),
        ...(waiting.screening ? [{ id: 'rp-wait-screening', text: `${waiting.screening} undecided at title and abstract, not counted`, drop: 6 }] : []),
        ...(waiting.fulltext ? [{ id: 'rp-wait-fulltext', text: `${waiting.fulltext} undecided at full text, not counted`, drop: 7 }] : [])] })}
      <div class="panel-body tight">
        <div class="rp-arms">${uiBar({ kind: 'tools', label: 'Flow phases', id: 'rp-arms', filters: ARMS.map(a => ({ type: 'check', id: `rp-arm-${a.id}`, label: a.label, value: !!arms[a.id], attrs: { 'data-arm': a.id } })) })}</div>
        ${groups.map((g, gi) => disclosure({ id: `rp-phase-${gi}`, className: 'rp-phase', title: g.phase, count: `${g.fields.filter(f => data[f.id] !== undefined && data[f.id] !== '').length} of ${g.fields.length}`, open: true, body: phaseBody(g, gi) })).join('')}
      </div>`}</div>
    <div class="prisma-fig rp-panel">${uiBar({ kind: 'head', cls: 'rp-head', label: 'Flow preview', id: 'rp-fig-head', lead: { title: 'Flow preview', level: 'h2' }, actions: [
        { id: 'rp-fig-show', label: 'Show diagram', icon: 'preview', role: 'quiet', pressed: figureShown, attrs: { 'data-fig-toggle': true } },
        { id: 'rp-enlarge', label: 'Enlarge', icon: 'fit', role: 'quiet', attrs: { 'data-enlarge': true } }] })}
      <div class="prisma-preview chart-svg" data-prisma-preview${figureShown ? '' : ' hidden'}>${previewSvg(true)}</div></div>
    </div>
      <div class="panel prisma-search rp-panel" data-rp="search"${hide('search')}>
      ${uiBar({ kind: 'head', cls: 'rp-head', label: 'Search strategy', id: 'ss-head', lead: { title: 'Search strategy', level: 'h2' }, status: { text: 'PRISMA-S', ch: 8 },
        actions: [{ id: 'ss-md', label: 'Copy', icon: 'copy' }, { id: 'ss-docx', label: 'Word appendix', icon: 'download', disabled: !reports.some(r => r.databases.length) }] })}
      <div class="panel-body rp-form">
        ${formField('Last searched', dateField('ss-last', strat.meta.lastSearched || '', 'Last searched'))}
        ${formField('Limits and filters', `<input id="ss-limits" value="${esc(strat.meta.limits || '')}" placeholder="None">`)}
        ${formField('Other sources', `<input id="ss-other" value="${esc(strat.meta.otherSources || '')}" placeholder="Reference lists, registries, experts">`)}
        ${formField('Deduplication', `<input id="ss-dedup" value="${esc(strat.meta.dedup || '')}" placeholder="How duplicates were removed">`)}
        ${uiBar({ kind: 'tools', label: 'Peer review', id: 'rp-press', filters: [{ type: 'check', id: 'ss-press', label: 'Peer reviewed with PRESS', value: !!strat.meta.press }] })}
      </div>
      <div class="panel-body tight">${reports.some(r => r.databases.length) ? reports.map((r, ri) => reviewSearchesHtml(r, ri)).join('')
        : `<div class="ov-clear"><span>No searches run</span></div>`}</div>
    </div>
    ${summaryPanel(full, hide('summary'))}
    ${checklistOf(full).id === 'prisma-scr' ? `<div class="rp-section" data-rp="map"${hide('map')}>${evidenceMapPanel(full)}</div>` : ''}
    ${checklistPanel(full, checklistOf(full), clStates, clSup, 'checklist', hide('checklist'), choiceRow(full))}
    ${extraChecklists(full).map(x => checklistPanel(full, x.checklist, full[x.checklist.key] || {}, {}, x.id, hide(x.id), '')).join('')}
    ${aiUsePanel(full, hide('ai'))}
  </div>`;

  wireEvidenceMap(el, ctx);
  wireSummary(el);
  wireAiUse(el);
  // The Export bundle button is in the top bar (actions()); the note it writes is in the view.
  bundleRun = () => runBundle(document.getElementById('bundle'), el.querySelector('#bundle-note'));
  el.querySelector('[data-rp-search]')?.addEventListener('click', () => ctx.go('search'));

  const track = e => {
    // A click anywhere on a checklist row names its item, not only on its controls.
    const t = e.target.closest?.('[data-cl-state],[data-cl-where],input[id^="p-"]')
      || e.target.closest?.('table.cl tbody tr')?.querySelector('[data-cl-state]');
    if (!t) return;
    focused = t.dataset.clState || t.dataset.clWhere ? { item: t.dataset.clState || t.dataset.clWhere } : { field: t.id.slice(2) };
  };
  if (!ipd) wireBoxes(el.querySelector('.prisma-fig [data-prisma-preview]'), ctx);
  wireReviewForm(el, ctx, rv);
  wireIpdFlow(el, ctx.rerender, { read: cur, write: (st, key, value) => setReviewKey(st, rv.id, key, value) });
  el.querySelector('.prisma-fig [data-enlarge]').onclick = expandPreview;
  // One column or two is measured from the page's own width (the engine's width hook), not queried by a breakpoint: the diagram stands beside the counts, and a
  // section's fields pair up, once both fit.
  releaseFlowWidth?.();
  const page = el.querySelector('.prisma');
  const pair = () => { page.dataset.cols = String(Math.min(2, 1 + Math.floor(page.getBoundingClientRect().width / FLOW_PAIR))); };
  releaseFlowWidth = watchWidth(page, pair); pair();
  el.querySelector('.prisma-fig [data-fig-toggle]').onclick = e => {
    figureShown = !figureShown;
    e.currentTarget.setAttribute('aria-pressed', String(figureShown));
    el.querySelector('.prisma-fig [data-prisma-preview]').hidden = !figureShown;
  };
  const root = el.querySelector('.prisma');
  root.addEventListener('focusin', track);
  root.addEventListener('click', track);

  const draw = () => {
    if (ipd) return;   // a PRISMA-IPD review's figure is drawn from its counts as saved (wireIpdFlow redraws the page on a change)
    const svg = prismaFlow(current(), { previous: arms.previous, other: arms.other, interactive: true, style: figureTokens(null, { medium: 'screen' }) });
    document.querySelectorAll('[data-prisma-preview]').forEach(host => { host.innerHTML = svg; markBox(host); });
    el.querySelectorAll('.rp-phase').forEach((phase, index) => {
      const fields = groups[index].fields;
      phase.querySelector('.ui-disclosure-count').textContent = `${fields.filter(f => el.querySelector(`#p-${f.id}`)?.value.trim()).length} of ${fields.length}`;
    });
  };
  const current = () => {
    const out = {};
    for (const f of PRISMA_FIELDS) {
      const input = el.querySelector(`#p-${f.id}`);
      if (!input) continue;                       // phase hidden for this review
      const v = input.value.trim();
      if (v !== '') out[f.id] = v;
    }
    return out;
  };
  el.querySelectorAll('[data-arm]').forEach(c => c.onchange = () => {
    update(st => setReviewKey(st, rv.id, 'prismaArms', { ...armsOf(scoped(st, rv.id)), [c.dataset.arm]: c.checked }));
    ctx.rerender();
  });
  // Only the count edited is kept as entered, and one set back to the project's
  // own count (or cleared) follows the project again. Saving every box would
  // freeze every derived count and drop a hidden arm's counts.
  const saveField = id => update(st => {
    const v = el.querySelector(`#p-${CSS.escape(id)}`)?.value.trim() ?? '';
    const next = { ...(scoped(st, rv.id).prisma || {}) };
    if (v === '' || String(derived[id] ?? '') === v) delete next[id]; else next[id] = v;
    return setReviewKey(st, rv.id, 'prisma', next);
  });
  // Whether each count is now entered by hand, and so needs its explanation, follows the box as it is typed in.
  const syncWhy = id => {
    const hand = handEnteredIds(cur()).includes(id);
    const row = el.querySelector(`[data-why-for="${CSS.escape(id)}"]`);
    if (row) row.hidden = !hand;
    const prov = el.querySelector(`[data-prov="${CSS.escape(id)}"]`);
    if (prov) prov.textContent = provenance(id, cur());
    const src = el.querySelector(`[data-src="${CSS.escape(id)}"]`);
    if (src) src.hidden = hand;
    const handLine = el.querySelector('#rp-hand'); if (handLine) handLine.textContent = handText(cur());
    const missing = el.querySelector('#rp-unexplained'); if (missing) missing.textContent = unexplainedText(cur());
  };
  el.querySelectorAll('input[id^="p-"]').forEach(i => i.oninput = () => {
    saveField(i.id.slice(2)); syncWhy(i.id.slice(2)); draw(); ctx.refreshCounts();
  });
  el.querySelectorAll('[data-why]').forEach(i => {
    i.onfocus = () => { focused = { field: i.dataset.why }; };
    i.oninput = () => {
      const v = i.value;
      update(st => { const next = { ...(scoped(st, rv.id).prismaNotes || {}) }; if (v.trim()) next[i.dataset.why] = v; else delete next[i.dataset.why]; return setReviewKey(st, rv.id, 'prismaNotes', next); });
      i.setAttribute('aria-invalid', String(!v.trim()));
      syncWhy(i.dataset.why);
    };
  });
  el.querySelectorAll('[data-reasons]').forEach(group => {
    const field = PRISMA_FIELDS.find(f => f.id === group.dataset.reasons), noun = (field?.reasonLabel || 'Reason').toLowerCase();
    const rows = () => [...group.querySelectorAll('[data-reason-row]')];
    const save = () => {
      group.querySelector('input[type=hidden]').value = formatReasons(rows().map(row => ({
        reason: row.querySelector('[data-reason]').value, count: row.querySelector('[data-reason-count]').value,
      })));
      saveField(group.dataset.reasons); syncWhy(group.dataset.reasons); draw(); ctx.refreshCounts();
    };
    const wire = () => {
      rows().forEach(row => wireReasonRow(row, save, () => { focused = { field: group.dataset.reasons }; }));
      group.querySelectorAll('[data-reason-more]').forEach(button => button.onclick = () => showMenu(button, [{ label: `Remove ${noun}`, icon: 'trash', run: () => {
        button.closest('[data-reason-row]').remove(); save(); group.querySelector('[data-add-reason]').focus();
      } }], { align: 'end', minWidth: 160 }));
    };
    group.querySelector('[data-add-reason]').onclick = () => {
      group.querySelector('.ui-bar').insertAdjacentHTML('beforebegin', reasonRow({}, field?.reasonLabel));
      wire(); rows().at(-1).querySelector('[data-reason-source], [data-reason]').focus();
    };
    wire();
  });
  draw();

  wireAbstract(el);

  // PRISMA-S: what the log cannot know is stated here and kept with the project.
  const saveStrategy = (k, v) => update(st => { st.searchStrategy = { ...(st.searchStrategy || {}), [k]: v }; return st; });
  wireDateField(el, 'ss-last', 'Last searched');
  el.querySelector('#ss-last')?.addEventListener('change', e => saveStrategy('lastSearched', e.target.value));
  el.querySelector('#ss-limits').oninput = e => saveStrategy('limits', e.target.value);
  el.querySelector('#ss-other').oninput = e => saveStrategy('otherSources', e.target.value);
  el.querySelector('#ss-dedup').oninput = e => saveStrategy('dedup', e.target.value);
  el.querySelector('#ss-press').onchange = e => saveStrategy('press', e.target.checked);
  const copy = async (text, note) => { el.querySelector('#rp-note').textContent = await copyText(text) ? note : 'Could not copy'; };
  el.querySelector('#ss-md').onclick = () => copy(strategyMarkdown(strategyReports(get())), 'Search strategies copied');
  el.querySelectorAll('[data-ss-copy]').forEach(b => b.onclick = () => { const [ri, k] = b.dataset.ssCopy.split('-').map(Number); const d = strategyReports(get())[ri].databases[k]; copy(recordedQuery(d), `${d.source} strategy copied`); });
  el.querySelector('#ss-docx').onclick = async () => {
    const blob = await writeDocx({ blocks: strategyBlocks(strategyReports(get())), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, 'search-strategies.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  };

  wireChecklists(el, ctx);
}

// ---- reviews ---------------------------------------------------------------------
// A paper may report several reviews (lib/reviews.mjs): each its own searches, counts and template, its own figure and search table.
let searchesOpen = false;   // the review's search list stays open across the redraw a tick causes
const RECORD_CHOICES = [['library', 'Library decisions'], ['hand', 'Entered by hand']];
const dayOf = r => String(r.date || r.at || '').slice(0, 10);
/** The review on show: which one, its name, its template, where its records come from and the searches it reports. */
function reviewForm(s, rv) {
  const list = reviewsOf(s), many = list.length > 1;
  const options = (items, value) => items.map(([k, label]) => `<option value="${esc(k)}"${k === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const logged = (s.searches || []).map((r, i) => ({ r, i })).filter(({ r }) => r.status !== 'failed' && !r.citationSearch && !r.related);
  const rows = rv.main ? [] : logged.map(({ r, i }) => {
    const owner = runReview(s, r), mine = owner === rv.id;
    const other = !mine && owner !== MAIN ? reviewOf(s, owner).name : !mine && r.exploratory ? 'Exploratory' : '';
    return uiRow({ main: { html: `<span class="rp-label">${esc(r.source || 'Search')}</span>`, detail: [dayOf(r), `${r.retrieved ?? r.total ?? 'NA'} records`, other].filter(Boolean).map(esc) },
      check: { checked: mine, label: `${r.source || 'Search'}, ${dayOf(r)}`, attrs: { 'data-review-search': i } } });
  });
  const mine = rows.length ? logged.filter(({ r }) => runReview(s, r) === rv.id).length : 0;
  // one stacked field per setting, as the search strategy's (formField); the searches a list of plain checkboxes
  const fields = [
    many ? formField('Review', `<select id="rp-review">${options(list.map(r => [r.id, r.name]), rv.id)}</select>`) : '',
    many ? formField('Name', `<input id="rp-review-name" value="${esc(rv.name)}" autocomplete="off">`) : '',
    formField('Flow diagram', `<select id="rp-template">${options(TEMPLATES, rv.template)}</select>`),
    rv.main ? '' : formField('Records', `<select id="rp-records">${options(RECORD_CHOICES, rv.records)}</select>`),
    rv.main ? '' : disclosure({ id: 'rp-review-searches', className: 'rp-review-searches', title: 'Searches', count: `${mine} of ${rows.length}`, open: searchesOpen,
      body: rows.length ? uiList({ id: 'rp-review-search-list', label: 'Searches of this review', cols: [], cls: 'rp-list', rows }) : '<p class="meta">No searches logged</p>' }),
  ];
  return `<div class="panel-body rp-form rp-review">${fields.join('')}</div>`;
}
function wireReviewForm(el, ctx, rv) {
  const again = () => { ctx.rerender(); ctx.refreshList?.(); };
  el.querySelector('#rp-review')?.addEventListener('change', e => { reviewId = e.target.value; again(); });
  el.querySelector('#rp-review-name')?.addEventListener('change', e => { const name = e.target.value.trim(); if (name) { update(st => editReview(st, rv.id, { name })); again(); } });
  el.querySelector('#rp-template')?.addEventListener('change', e => { update(st => editReview(st, rv.id, { template: e.target.value })); again(); });
  el.querySelector('#rp-records')?.addEventListener('change', e => { update(st => editReview(st, rv.id, { records: e.target.value })); again(); });
  el.querySelector('#rp-review-searches')?.addEventListener('toggle', e => { searchesOpen = e.target.open; });
  el.querySelectorAll('[data-review-search]').forEach(c => c.onchange = () => { update(st => assignSearch(st, Number(c.dataset.reviewSearch), c.checked ? rv.id : MAIN)); again(); });
  el.querySelector('[data-review-add]')?.addEventListener('click', () => { let id = MAIN; update(st => { id = addReview(st); return st; }); reviewId = id; searchesOpen = true; again(); });
  el.querySelector('#rp-review-remove')?.addEventListener('click', () => { update(st => removeReview(st, rv.id)); reviewId = MAIN; again(); });
}
/** Each review's PRISMA-S report, named by its review when the project has more than one; reviews without searches are left out. */
function strategyReports(s) {
  const list = reviewsOf(s), many = list.length > 1;
  const reps = list.map(r => ({ ...compileStrategy(scoped(s, r.id)), review: many ? r.name : '' }));
  const used = reps.filter(r => r.databases.length || r.citation.length);
  return used.length ? used : reps.slice(0, 1);
}
/** One review's search table: Database, Date searched, Records with its total, then each strategy as run. */
function reviewSearchesHtml(rep, ri) {
  if (!rep.databases.length) return '';
  const y = yieldsTable(rep), name = rep.review || 'Search yields';
  return `<section class="ss-review" aria-label="${esc(name)}">
    ${rep.review ? uiBar({ kind: 'head', label: rep.review, id: `ss-review-head-${ri}`, lead: { title: rep.review, level: 'h3' }, message: { text: `${plural(rep.databases.length, 'database')}, ${y.total} records` } }) : ''}
    ${tableRegion({ label: `${name}: databases, dates and records`, html: `<table class="cl sum-table ss-yields">
      <thead><tr>${y.head.map((h, i) => `<th${i === 2 ? ' class="num"' : i === 0 ? ' class="grow"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${y.rows.map(r => `<tr><td class="grow">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${esc(r[2])}</td></tr>`).join('')}
        <tr class="strong"><td class="grow strong">Total</td><td></td><td class="num">${y.total}</td></tr></tbody></table>` })}
    ${searchStrategiesHtml(rep.databases, `${ri}-`)}</section>`;
}

function wireAbstract(el, primary = false) {
  abstractRun = async () => {
    const b = document.getElementById('rp-abstract'), n = el.querySelector('#rp-note'), host = el.querySelector('#rp-proposal'); if (b) b.disabled = true; n.textContent = 'Drafting';
    const s2 = get(); const a = s2.analysis; const f = x => Number(x).toFixed(2);
    const facts = [projectContext(s2), primary ? `Reporting standard: ${checklistOf(s2).name}` : `PRISMA counts: ${JSON.stringify(s2.prisma || {})}`,
      `Protocol: ${JSON.stringify({ title: s2.protocol?.title, ...(s2.protocol?.pico || {}) })}`,
      primary ? `Saved current results: ${JSON.stringify(results(s2).filter(r => r.inputStatus === 'current'))}` : a ? `Pooled ${a.measure} (${a.method}, k = ${a.k}): ${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]; I² ${Number(a.i2).toFixed(1)}%` : 'No pooled analysis'].join('\n');
    try {
      const text = await draftSection(primary ? `structured abstract (Background, Methods, Results, Conclusions; ${checklistOf(s2).name})` : 'structured abstract (Background, Methods, Results, Conclusions; PRISMA 2020 for Abstracts)', facts, modelFor('write'));
      n.textContent = '';
      host.innerHTML = proposalBox({ id: 'rp-prop', title: 'Abstract', meta: modelFor('write').model, accept: 'Copy', body: esc(text) });
      host.querySelector('[data-discard]').onclick = () => { host.innerHTML = ''; };
      host.querySelector('[data-accept]').onclick = async () => { try { await navigator.clipboard.writeText(text); n.textContent = 'Copied'; } catch { n.textContent = 'Select and copy'; } };
    } catch (err) { n.textContent = err.message.slice(0, 80); }
    if (b) b.disabled = false;
  };

}

/** The participant flow's rows: each stage with its count, its source and, for a count entered by hand, its explanation. */
function participantTable(flow) {
  return `<table><thead><tr><th>Stage</th><th>Count</th><th>Source</th><th>Explanation</th></tr></thead><tbody>${flow.rows.map(r => `<tr><td>${esc(r.label)}</td><td><input inputmode="numeric" data-pf-count="${r.id}" value="${r.value ?? ''}" aria-label="${esc(r.label)}"></td><td>${esc(r.source)}${r.derived != null ? `, project count ${r.derived}` : ''}</td><td><input data-pf-reason="${r.id}" value="${esc(r.reason)}" aria-label="${esc(r.label)} explanation"></td></tr>`).join('')}</tbody></table>`;
}

function renderPrimaryReporting(el, ctx, s, sup, states) {
  if (!sectionsOf(s).some(([id]) => id === section)) section = 'checklist';
  const hide = id => id === section ? '' : ' hidden', flow = participantFlow(s);
  el.innerHTML = `<div class="prisma"><p id="rp-note" class="meta" role="status"></p>${checklistPanel(s, checklistOf(s), states, sup, 'checklist', hide('checklist'), choiceRow(s))}${extraChecklists(s).map(x => checklistPanel(s, x.checklist, s[x.checklist.key] || {}, {}, x.id, hide(x.id), '')).join('')}${aiUsePanel(s, hide('ai'))}<div data-rp="participant-flow"${hide('participant-flow')}><div class="panel rp-panel">${uiBar({ kind: 'head', cls: 'rp-head', label: 'Participant flow', id: 'pf-head', lead: { title: 'Participant flow', level: 'h2' }, actions: [{ id: 'pf-download', label: 'Download', icon: 'download', menu: true }] })}<div class="panel-body"><p class="meta" data-ui-help>Derived counts name their source. Explain entered counts; blank values remain unrecorded. Screening flags describe recorded populations.</p>${flow.issues.map(x => `<p class="meta">${esc(x)}</p>`).join('')}</div><div class="panel-body tight">${tableRegion({ label: 'Participant flow counts', sticky: true, html: participantTable(flow) })}</div></div><div class="rp-panel">${figurePanel({id: 'participant-flow', title: 'Flow diagram'})}</div></div></div>`;
  wireChecklists(el, ctx); wireAiUse(el); bundleRun = () => runBundle(document.getElementById('bundle'), el.querySelector('#bundle-note'));
  const proposal = document.createElement('div'); proposal.id = 'rp-proposal'; el.append(proposal); wireAbstract(el, true);
  const focus = e => { const input = e.target.closest?.('[data-cl-state],[data-cl-where]'); if (input) focused = { item: input.dataset.clState || input.dataset.clWhere }; }; el.addEventListener('focusin', focus); el.addEventListener('click', focus);
  const save = id => { const value = el.querySelector(`[data-pf-count="${id}"]`).value, reason = el.querySelector(`[data-pf-reason="${id}"]`).value; try { update(st => { setFlowCount(st, id, value, reason); return st; }); ctx.rerender(); } catch (e) { el.querySelector('#rp-note').textContent = e.message; } };
  el.querySelectorAll('[data-pf-count]').forEach(x => x.onchange = () => save(x.dataset.pfCount));
  el.querySelectorAll('[data-pf-reason]').forEach(x => x.onchange = () => save(x.dataset.pfReason));
  wireDownload(el.querySelector('#pf-download'), [
    { label: 'Counts (CSV)', run: () => downloadCsv(participantFlowRows(get()), 'participant-flow.csv') },
    { label: 'Diagram (SVG)', run: () => download(participantFlowSvg(get(), { style: figureTokens(null, { medium: 'export' }) }), 'participant-flow.svg', 'image/svg+xml') }]);
  if (section === 'participant-flow') showFigure(el, 'participant-flow', participantFlowSvg(s, { style: figureTokens(null, { medium: 'screen' }) }), 'participant-flow', { exportSvg: () => participantFlowSvg(get(), { style: figureTokens(null, { medium: 'export' }) }) });
}

// ---- checklists ------------------------------------------------------------------
// The main checklist (a base with any extensions and add-ons composed in) and
// the abstract and protocol checklists chosen beside it, each its own rail
// section with its own state key (lib/protocol-governance.mjs extraChecklists).

let choicesOpen = false;   // the extensions and add-ons stay open across the redraw a choice causes
const listOfSection = (st, id) => id === 'checklist' ? checklistOf(st) : extraChecklists(st).find(x => x.id === id)?.checklist;
const nameOf = id => (CHECKLISTS[id] || EXTRA_CHECKLISTS[id])?.name || id;

/** The checklist's rows: the item with its number, its state, and where it is reported. */
function checklistTable(list, states, sup) {
  return `<table class="cl">
        <thead><tr><th>Item</th><th>State</th><th>Where reported</th></tr></thead>
        <tbody>${list.items.map(([n, name, text, meta]) => { const c = states[n] || {}; const sp = sup[n];
          return `<tr><td class="cl-item" title="${esc(text)}"><div class="cl-line"><span class="meta cl-num">${esc(meta?.number ?? n)}</span><div class="cl-text">${esc(name)}${meta?.sourceName ? `<div class="study-title cl-source">${esc(meta.sourceName)}</div>` : ''}${sp ? `<div class="study-title">${esc(sp)}</div>` : ''}</div></div></td>
            <td><select class="ui-cell-field" data-cl-state="${esc(n)}" aria-label="${esc(`${name}: state`)}">${CL_STATES.map(([v, l]) => `<option value="${v}"${(c.state || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><input class="ui-cell-field" data-cl-where="${esc(n)}" value="${esc(c.where || '')}" placeholder="Section, page" aria-label="${esc(`${name}: where reported`)}"></td></tr>`; }).join('')}</tbody></table>`;
}

function checklistPanel(s, list, states, sup, id, hidden, chooser) {
  const done = list.items.filter(([n]) => states[n]?.state === 'done').length;
  return `<div class="panel prisma-search rp-panel" data-rp="${id}" data-cl-section="${id}"${hidden}>
      ${uiBar({ kind: 'head', cls: 'rp-head', label: `${list.name} checklist`, id: `cl-head-${id}`, lead: { title: `${list.name} checklist`, level: 'h2' }, status: { text: `${done} reported, ${list.items.length} items`, ch: 24 },
        actions: [{ id: `cl-csv-${id}`, label: 'Download', icon: 'download', menu: true, attrs: { 'data-cl-csv': id } }] })}
      ${chooser}
      <div class="panel-body tight">${tableRegion({ label: `${list.name} checklist`, sticky: true, html: checklistTable(list, states, sup) })}</div>
    </div>`;
}

/** The checklist chooser: the checklist, its extensions and add-ons, and the abstract and protocol checklists reported beside it. */
function choiceRow(s) {
  const ch = choicesFor(researchType(s).id), cur = applied(s), saved = normalizeChecklistChoice(s.checklistChoice);
  const bases = [ch.default, ...ch.alternatives].filter(id => CHECKLISTS[id] || EXTRA_CHECKLISTS[id]);
  const exts = ch.extensions.filter(id => EXTRA_CHECKLISTS[id]), adds = ch.addons.filter(id => EXTRA_CHECKLISTS[id]);
  const also = ['abstract', 'protocol'].filter(k => EXTRA_CHECKLISTS[ch[k]]);
  if (bases.length < 2 && !exts.length && !adds.length && !also.length) return '';
  // an extension that names another base does not apply once an alternative replaces the default
  const fitsNow = id => EXTRA_CHECKLISTS[id].extends === cur.checklist || (cur.checklist === ch.default && EXTRA_CHECKLISTS[id].extends === 'prisma-2020');
  // One row per choice, a plain checkbox at its start and what kind of choice it is under its name.
  const choice = (kind, id, on, what, disabled = false) => uiRow({ main: { html: `<span class="rp-label">${esc(nameOf(id))}</span>`, detail: [esc(what)] },
    check: { checked: on, label: nameOf(id), attrs: { 'data-cl-choice': kind, 'data-cl-id': id, disabled } } });
  const rows = [...exts.map(id => choice('extensions', id, cur.extensions.includes(id), 'Extension', !fitsNow(id))), ...adds.map(id => choice('addons', id, cur.addons.includes(id), 'Add-on')),
    ...also.map(k => choice(k, ch[k], saved[k], 'Reported alongside'))];
  const chosen = [...cur.extensions, ...cur.addons, ...also.filter(k => saved[k])].length;
  const baseOptions = bases.map(id => `<option value="${esc(id)}"${id === cur.checklist ? ' selected' : ''}>${esc(nameOf(id))}${id === ch.default ? ' (default)' : ''}</option>`).join('');
  return `<div class="panel-body rp-form cl-choose">
    ${bases.length > 1 ? formField('Checklist', `<select id="cl-base">${baseOptions}</select>`) : ''}
    ${rows.length ? disclosure({ id: 'cl-options', className: 'cl-options', title: 'Extensions and add-ons', count: `${chosen} of ${rows.length} chosen`, open: choicesOpen, body: uiList({ id: 'cl-choices', label: 'Checklist options', cols: [], cls: 'rp-list', rows }) }) : ''}
  </div>`;
}

function wireChecklists(el, ctx) {
  const saveCl = (list, n, patch) => update(st => { const k = list(st).key; st[k] = { ...(st[k] || {}), [n]: { ...((st[k] || {})[n] || {}), ...patch } }; return st; });
  el.querySelectorAll('[data-cl-section]').forEach(panel => {
    const id = panel.dataset.clSection, list = st => listOfSection(st, id);
    panel.querySelectorAll('[data-cl-state]').forEach(sel => sel.onchange = () => { saveCl(list, sel.dataset.clState, { state: sel.value }); ctx.rerender(); });
    panel.querySelectorAll('[data-cl-where]').forEach(inp => inp.oninput = () => saveCl(list, inp.dataset.clWhere, { where: inp.value }));
    wireDownload(panel.querySelector('[data-cl-csv]'), [{ label: 'CSV', icon: 'table', run: () => {
      const rows = [['Item', 'Name', 'Description', 'Source', 'State', 'Where reported', 'Supported by']];
      const l = list(get()), states = get()[l.key] || {}, sup = id === 'checklist' ? clSupported(get()) : {};
      for (const [n, name, text, meta] of l.items) { const c = states[n] || {}; rows.push([meta?.number ?? n, name, text, meta?.sourceName || l.name, CL_STATES.find(x => x[0] === (c.state || ''))?.[1] || '', c.where || '', sup[n] || '']); }
      downloadCsv(rows, `${l.id}-checklist.csv`);
    } }]);
  });
  const saveChoice = fn => { update(st => { st.checklistChoice = fn(normalizeChecklistChoice(st.checklistChoice)); return st; }); ctx.rerender(); ctx.refreshList?.(); };
  el.querySelector('#cl-options')?.addEventListener('toggle', e => { choicesOpen = e.target.open; });
  el.querySelector('#cl-base')?.addEventListener('change', e => saveChoice(c => ({ ...c, checklist: e.target.value })));
  el.querySelectorAll('[data-cl-choice]').forEach(b => b.onchange = () => saveChoice(c => toggleChoice(c, b.dataset.clChoice, b.dataset.clId, b.checked)));
}

// ---- evidence map (scoping reviews) -------------------------------------------
// The pair of charted fields is kept with the project, so the map in the
// export bundle is the one shown here.
const mapChoice = mapFields;
let mapPick = null;   // the cell whose sources are listed: [row, col]
/** The map's grid of counts, and the sources of the cell picked. */
function evidenceBody(s, map, most, picked, listed) {
  if (!map) return '<p class="meta">Chart at least two text or category fields</p>';
  if (!map.total) return '<p class="meta">No included sources</p>';
  return `<div class="em-wrap"><table class="em-table">
        <thead><tr><th></th>${map.cols.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${map.rows.map((r, i) => `<tr><th scope="row">${esc(r)}</th>${map.cells[i].map((c, j) => `<td>${c.count
          ? `<button data-em="${i},${j}" data-share="${(c.count / most).toFixed(3)}" aria-pressed="${mapPick?.[0] === i && mapPick?.[1] === j}" aria-label="${esc(`${r}, ${map.cols[j]}: ${c.count}`)}">${c.count}</button>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${picked ? `<div class="em-sources"><div class="meta">${esc(`${map.rows[mapPick[0]]}, ${map.cols[mapPick[1]]}`)}</div>${listed.map(p => `<div>${studyCell(p, { open: true })}</div>`).join('')}</div>` : ''}`;
}
function evidenceMapPanel(s) {
  const opts = mappableFields(s), { row, col } = mapChoice(s);
  const map = row && col ? evidenceMap(s, row, col, mapOptions(s)) : null;
  const sel = (id, label, cur) => formField(label, `<select id="${id}" aria-label="${label}">${opts.map(f =>
    `<option value="${esc(f.id)}"${f.id === cur ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>`);
  const picked = map && mapPick && map.cells[mapPick[0]]?.[mapPick[1]];
  // The largest cell sets each cell's shade; found once, not once per cell.
  let most = 1; if (map) for (const r of map.cells) for (const c of r) if (c.count > most) most = c.count;
  const listed = picked ? (s.papers || []).filter(p => picked.paperIds.includes(p.id)) : [];
  return `<div class="panel em rp-panel">
    ${uiBar({ kind: 'head', cls: 'rp-head', label: 'Evidence map', id: 'em-head', lead: { title: 'Evidence map', level: 'h2' }, ...(map ? { status: { text: plural(map.total, 'source'), ch: 14 } } : {}),
      actions: [{ id: 'em-download', label: 'Download', icon: 'download', menu: true, disabled: !map }] })}
    <div class="panel-body rp-form">${sel('em-row', 'Rows', row)}${sel('em-col', 'Columns', col)}</div>
    <div class="panel-body">
      ${evidenceBody(s, map, most, picked, listed)}
    </div></div>`;
}
function wireEvidenceMap(el, ctx) {
  const host = el.querySelector('.panel.em'); if (!host) return;
  const s = get(), { row, col } = mapChoice(s), map = row && col ? evidenceMap(s, row, col, mapOptions(s)) : null;
  // Fill follows the count: the share is set through the style object, not an attribute.
  host.querySelectorAll('[data-share]').forEach(b => b.style.setProperty('--share', b.dataset.share));
  const save = patch => { update(st => { st.evidenceMap = { ...mapChoice(st), ...patch }; return st; }); mapPick = null; ctx.rerender(); };
  host.querySelector('#em-row')?.addEventListener('change', e => save({ row: e.target.value }));
  host.querySelector('#em-col')?.addEventListener('change', e => save({ col: e.target.value }));
  host.querySelectorAll('[data-em]').forEach(b => b.onclick = () => {
    const [i, j] = b.dataset.em.split(',').map(Number);
    mapPick = mapPick && mapPick[0] === i && mapPick[1] === j ? null : [i, j]; ctx.rerender();
  });
  wireStudies(host, ctx);
  if (!map) return;
  wireDownload(host.querySelector('#em-download'), [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(evidenceMapRows(map), 'evidence-map.csv') },
    { label: 'SVG', icon: 'download', run: () => download(evidenceMapSvg(map), 'evidence-map.svg', 'image/svg+xml') },
    { label: 'PNG', icon: 'image', run: () => downloadPng(evidenceMapSvg(map), 'evidence-map.png') }]);
}

/** Counts the app can honestly reconcile from what it holds. */

// ---- AI use (feature: ai-use) ---------------------------------------------------
// The record generated from the model-call log (lib/ai-use.mjs), the person's own
// notes, and the methods sentence. PRISMA-trAIce is a proposal, not an endorsed standard.
function aiUsePanel(s, hidden) {
  const tables = aiUseRows(s), notes = aiUseNotes(s);
  return `<div class="panel prisma-search rp-panel" data-rp="ai"${hidden}>
    ${uiBar({ kind: 'head', cls: 'rp-head', label: 'AI use', id: 'ai-head', lead: { title: 'AI use', level: 'h2' }, status: { text: 'PRISMA-trAIce', ch: 14 },
      actions: [{ id: 'ai-copy', label: 'Copy', icon: 'copy', menu: true }] })}
    <div class="panel-body">
      <p class="meta" data-ui-help>PRISMA-trAIce is a proposal, not an endorsed standard. Generated from the model calls this project logged; write the limitations, funding and conflicts yourself.</p>
      <p class="ai-methods">${esc(aiUseMethodsText(s))}</p>
    </div>
    ${tables.map(t => `<div class="panel-body tight"><h3>${esc(t.title)}</h3>${tableRegion({ label: t.title, html: `<table class="cl">
      <thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}${t.note ? `<p class="meta">${esc(t.note)}</p>` : ''}</div>`).join('')}
    <div class="panel-body rp-form">${NOTE_FIELDS.map(([k, label]) => formField(label, `<textarea data-ai-note="${k}" rows="3" maxlength="${NOTE_MAX}" spellcheck="true" aria-label="${esc(label)}">${esc(notes[k])}</textarea>`)).join('')}</div>
  </div>`;
}
function wireAiUse(el) {
  el.querySelectorAll('[data-ai-note]').forEach(t => t.onchange = () => setAiUseNote(t.dataset.aiNote, t.value));
  const copy = async (text, note) => { el.querySelector('#rp-note').textContent = await copyText(text) ? note : 'Could not copy'; };
  const button = el.querySelector('#ai-copy');
  button.onclick = () => showMenu(button, [{ label: 'Methods text', run: () => copy(aiUseMethodsText(get()), 'Methods text copied') }, { label: 'Record', run: () => copy(aiUseMarkdown(get()), 'AI-use record copied') }], { align: 'end', minWidth: 160 });
}
// ---- end AI use ------------------------------------------------------------------

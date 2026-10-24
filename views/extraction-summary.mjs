// The data summary: a sub-page of Extraction (design note 2026-10-13 §6, the pattern of the Word tables in ./evidence-exports.mjs). It counts what
// the table's studies hold, field by field, and every count opens the list of studies behind it, each with its value as written, its source
// anchors (the paper opens at that page) and Open cell, which returns to the grid with that cell chosen. The counts are lib/extraction-summary.mjs,
// the words are lib/extraction-summary-view.mjs; this file draws them with the shared builders and keeps the page's own state: which fields are
// open and which list is shown. Nothing here writes a value. Its head is the shell's title bar (Extraction's page() asks summarySpec).
import { getVersion, update } from '../store.mjs';
import { summarise, toNormalise } from '../lib/extraction-summary.mjs';
import { staleFields, definitionHash } from '../lib/extraction-normalise.mjs';
import { applyMapping } from '../lib/extraction-summary-mapping.mjs';
import { renameCategory, mergeCategories, removeGrouping, acceptDefinition } from '../lib/extraction-summary-store.mjs';
import { startNormalise, normaliseRunning, stopNormalise, runningText, proposalsByField, acceptProposal, discardProposal, lastRun, clearLastRun } from './extraction-normalise.mjs';
import { startReview } from './extraction-review.mjs';
import { ensureAid, aidNeeded, aidReady, onChange } from '../lib/aid-core.mjs';
import { KIND_WORDS, levelText, measureLine, percent, fmt, stateRows, closedCount, digest, numericRows, levelRows, emptyLevels, statusText, csvRows } from '../lib/extraction-summary-view.mjs';
import { evidenceLabel } from '../lib/evidence.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { fitSplit, fitSteps } from '../lib/split-fit.mjs';
import { uiList, uiRow, uiRowEnd, uiReview, uiNotice, uiSummary, uiBar, watchWidth } from '../lib/ui-actions.mjs';
import { uiLink, countHeading } from '../lib/ui-components.mjs';
import { columnChart, histogramBins, donutChart, subgroupChart, yearOf } from '../lib/charts.mjs';
import { alike, relatedWork } from '../lib/extraction-filter.mjs';
import { columnChoices } from '../lib/extraction-columns.mjs';
import { measuresOf } from '../lib/make-sources.mjs';
// Make (views/summary-make.mjs) and what it keeps load when the panel first opens: its charts, pools and figures stay out of the shell's static graph
let makeMod = null, makeLoading = null;
const loadMake = () => makeLoading || (makeLoading = import('./summary-make.mjs').then(m => { makeMod = m; return m; }));
import { NOT_GIVEN, NAMED_STATE } from '../lib/extraction-measures.mjs';
import { library, libraryStamp, rangeText } from '../lib/measure-library.mjs';
import { visualFor, visualMissing } from '../lib/measure-visuals.mjs';
import '../lib/measure-visuals-generic.mjs';
import { measuresBlock, wireMeasures } from './summary-measures.mjs';
import { pager, pageOf, wirePager, PAGE_SIZE } from '../lib/paging.mjs';
import { showMenu } from '../lib/menu.mjs';
import { icon } from '../lib/icons.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { plural, num } from '../lib/dates.mjs';
import { readableLabel } from '../lib/label-text.mjs';
import { countLine } from '../lib/extraction-parts.mjs';

const LEVELS_PAGE = 12;
let addonsAsked = false;   // the addons are loaded once, when a measure's library entry names a visual one of them gives   // a field's list pages at this many rows (the shared pager)

// The page's state, in the module so a repaint of Extraction (a run, a store change) keeps what is open.
let ui = null;   // { templateId, open: Set of field ids, all: Set of field ids showing every level, drill: null | { fieldId, fieldLabel, label, items }, page, last,
                 //   ctx, model (as last drawn: the title bar's Normalise acts on them), stale: Set of field ids, staleKey, eligible, specEligible, off }
export const summaryOpen = () => !!ui;
/** Opens the page; `field` opens that field's row, `drill` ({ fieldId, fieldLabel, label, items }) shows the studies behind one count (Details opens either). */
export function openSummary(templateId, { field = null, drill = null } = {}) { ui = { templateId, open: new Set(field ? [field] : []), all: new Set(), drill, page: 1, last: '', ctx: null, model: null, stale: new Set(), staleKey: '', eligible: 0, specEligible: null, off: null, el: null, queued: false, sig: '' }; }
export function closeSummary() { ui?.off?.(); ui = null; }
/** Back: from a list to the summary, from the summary to the table. Returns false when it left the page. */
export function summaryBack() { if (ui?.drill) { ui.drill = null; ui.page = 1; return true; } ui = null; return false; }

const fieldTitle = f => readableLabel(f.unit ? `${f.label} (${f.unit})` : f.label);
// each kind of field has its mark and its hue (owner, 2026-10-22: "use hues, colors, icons, not just text")
const KIND_ICON = { categorical: 'list-bullet', multi: 'layers', numeric: 'gauge', measures: 'scale', free: 'align-left', label: 'book' };
const idOf = cell => cell.slice(0, cell.indexOf(':'));
const fieldIdOf = cell => cell.slice(cell.indexOf(':') + 1);

// The counts are recomputed when the project changes, not on every repaint of the page.
let memo = { key: '', out: null };
function summaryOf(model) {
  const found = foundOf(model), key = `${getVersion()}|${libraryStamp()}|${model.templateId}|${(ui?.conds || []).map(c => `${c.fieldId}=${c.key}`).join('&')}`;
  if (memo.key !== key) {
    memo = { key, out: summarise({
      fields: model.cols.map(c => ({ id: c.id, label: c.label, type: c.type, options: c.options, allowed: c.allowed, unit: c.unit })),
      studies: model.all.filter(p => !found.ids || found.ids.has(p.id)).map(p => ({ id: p.id, label: p.label })), values: model.st.values || {}, proposals: model.st.proposals || {}, mappings: model.st.extractionSummary?.fields || {}, library: library(),
      ...(found.ids ? { kinds: Object.fromEntries(summaryAll(model).fields.map(f => [f.id, { kind: f.kind, reason: f.reason, markers: f.markers }])) } : {}) }) };
  }
  return memo.out;
}

// ---- the filter: studies chosen by their values, field by field (owner, 2026-10-22: "not like a search thing but selecting from the
// fields"). A field's values are what the page counts for it: a category's levels, a measure reported or not, a number's ranges, or a
// value at all. Values of one field are either-or; fields are all-of. What the project already says about the studies kept follows
// (lib/extraction-filter.mjs relatedWork).
let allMemo = { key: '', out: null };
/** The counts over every study, whatever the filter keeps: where a filter's choices come from (and the grid's column menus and footers). */
export function summaryAll(model) {
  const key = `${getVersion()}|${libraryStamp()}|${model.templateId}`;
  if (allMemo.key !== key) allMemo = { key, out: summarise({ fields: model.cols.map(c => ({ id: c.id, label: c.label, type: c.type, options: c.options, allowed: c.allowed, unit: c.unit })),
    studies: model.all.map(p => ({ id: p.id, label: p.label })), values: model.st.values || {}, proposals: model.st.proposals || {}, mappings: model.st.extractionSummary?.fields || {}, library: library() }) };
  return allMemo.out;
}
/** A field's choices: [{ key, label, ids }], most held first (lib/extraction-columns.mjs, which the grid's column menus share). */
const choicesOf = f => columnChoices(f);
/** The studies the filter keeps (null: no filter) and, for the project's work, what each choice was. */
function foundOf(model) {
  const conds = ui?.conds || [];
  if (!conds.length) return { ids: null, terms: [] };
  const byField = new Map(); for (const c of conds) (byField.get(c.fieldId) || byField.set(c.fieldId, []).get(c.fieldId)).push(c);
  let ids = null;
  for (const list of byField.values()) { const any = new Set(list.flatMap(c => c.ids)); ids = ids ? new Set([...ids].filter(x => any.has(x))) : any; }
  return { ids, terms: conds.map(c => ({ term: alike(c.label.replace(NAMED_STATE, '')), n: c.ids.length, via: [c.fieldLabel] })) };
}
/** The filter's bar (Add filter, the count kept), its choices as rows that can be taken away, and the project's work on the studies kept. */
function filterHtml(model, reg) {
  const found = foundOf(model), n = found.ids?.size ?? model.all.length, conds = ui.conds || [];
  const bar = uiBar({ kind: 'head', label: 'Studies', id: 'es-filter-bar', lead: { title: 'Studies', level: 'h3' }, status: { id: 'es-filter-count', text: found.ids ? `${num(n)} of ${num(model.all.length)}` : num(model.all.length), ch: 12 },
    actions: [{ id: 'es-add-filter', label: conds.length ? 'Add filter' : 'Filter', icon: 'filter', menu: true }, { id: 'es-make', label: 'Make', icon: 'sparkle', pressed: !!ui.make?.open },
      ...(conds.length ? [{ id: 'es-show-found', label: 'Show studies', icon: 'list', disabled: !n, attrs: { 'data-es-drill': 'found' } }, { id: 'es-clear-filter', label: 'Clear', role: 'quiet' }] : [])] });
  const make = ui.make?.open ? makePanel(model, found, reg) : '';
  if (!found.ids) { reg.drills.set('found', { fieldId: '', fieldLabel: 'Filtered', label: 'All', items: [] }); return `<div class="es-filter"><div class="es-inset">${bar}</div>${make}</div>`; }
  const drill = (label, items) => { const id = `f-${reg.drills.size}`; reg.drills.set(id, { fieldId: '', fieldLabel: 'Filtered', label, items }); return id; };
  const studies = [...found.ids].map(id => ({ paperId: id, cell: `${id}:${model.cols[0]?.id || ''}`, text: '' }));
  reg.drills.set('found', { fieldId: '', fieldLabel: 'Filtered', label: conds.map(c => c.label).join(', '), items: studies });
  // one row per field, as the filter builders on Mobbin have it: the field, its values (either one), the studies it keeps
  const byField = [...conds.reduce((m, c) => m.set(c.fieldId, [...(m.get(c.fieldId) || []), c]), new Map()).values()];
  const condRows = byField.map(list => { const f = list[0], kept = new Set(list.flatMap(c => c.ids));
    return uiRow({ main: { html: `<span class="es-cond">${icon('filter', { size: 12 })}<span class="es-cond-field">${esc(f.fieldLabel)}</span>${list.map(c => `<span class="es-val">${esc(c.label)}</span>`).join('<span class="es-or">or</span>')}</span>` }, cells: [{ col: 'held', kind: 'text', ch: 12, html: esc(plural(kept.size, 'study', 'studies')) },
      { col: 'x', kind: 'control', html: `<button type="button" class="icon" data-es-unfilter="${esc(f.fieldId)}" aria-label="${esc(`Remove the filter on ${f.fieldLabel}`)}" title="Remove">${icon('close', { size: 12 })}</button>` }] }); });
  const distinct = Object.fromEntries(summaryAll(model).fields.filter(f => !isRest(f) && f.kind !== 'free').map(f => [f.label, choicesOf(f).length]));
  const work = relatedWork(model.st, found.ids, found.terms, model.cols, { distinct });
  const KIND = { subgroup: 'Subgroup', contrast: 'Comparison', table: 'Evidence table', analysis: 'Analysis', suggest: 'Suggested subgroup' };
  // a table of what the project holds for these studies: subgroups that name them and comparisons first, six rows, the rest counted
  const ORDER = { subgroup: 0, contrast: 1, table: 2, suggest: 3, analysis: 4 }, sorted = [...work].sort((a, z) => ORDER[a.kind] - ORDER[z.kind]), shown = sorted.slice(0, 6);
  const WORK_ICON = { subgroup: 'analysis', contrast: 'split', table: 'table', analysis: 'analysis', suggest: 'sparkle' };
  // each row's title opens what it names: the analysis at its outcome, the table's studies, a suggestion set up in Make
  const tableStudies = x => studies.filter(st => (model.st.collections || []).find(c => c.id === x.id)?.members?.includes(st.paperId));
  const opener = x => (x.kind === 'table' ? { 'data-es-drill': drill(x.title, tableStudies(x)) } : x.kind === 'suggest' ? { 'data-es-suggest': x.field, 'data-es-measure': x.measure } : { 'data-es-outcome': x.id });
  const rows = shown.map(x => uiRow({ attrs: { 'data-es-open': '', ...opener(x) }, main: { html: `<span class="es-work" data-kind="${x.kind}">${icon(WORK_ICON[x.kind], { size: 14 })}<span>${esc(x.title)}</span></span>`, detail: [esc(KIND[x.kind])] },
    cells: [{ col: 'held', kind: 'text', ch: 12, html: esc(x.held || '') }, { col: 'est', kind: 'text', ch: 20, html: esc(x.estimate || x.state || '') },
      { col: 'go', kind: 'control', html: x.kind === 'table'
        ? uiLink({ label: 'Studies', attrs: opener(x) })
        : x.kind === 'suggest' ? uiLink({ label: 'Set up', attrs: { 'data-es-suggest': x.field, 'data-es-measure': x.measure } })
        : uiLink({ label: 'Open', attrs: { 'data-es-outcome': x.id } }) }] }));
  const figures = work.filter(x => x.kind === 'subgroup' && x.levels.some(l => l.on)).slice(0, 2)
    .map(x => `<figure class="es-hist chart-svg" aria-label="${esc(x.title)}"><figcaption class="meta">${esc(x.title.replace(/: [^:]*$/, ''))}</figcaption>${subgroupChart(x.levels, { width: 480, title: x.title })}</figure>`).join('');
  return `<div class="es-filter"><div class="es-inset">${bar}${uiList({ id: 'es-conds', label: 'Filters', cols: ['held', 'x'], rows: condRows })}</div>${make}
    ${rows.length ? `${countHeading({ title: 'In the project', count: sorted.length > shown.length ? `${shown.length} of ${sorted.length}` : '' })}${uiList({ id: 'es-work', label: 'Work on these studies', cols: ['held', 'est', 'go'], rows })}${figures}` : ''}</div>`;
}
/** A study's value in a field as text, its arms' values joined. */
const valueText = (model, paperId, fieldId) => { const vs = model.st.values || {}, own = vs[`${paperId}:${fieldId}`], arms = Object.keys(vs).filter(k => k.startsWith(`${paperId}:${fieldId}@`));
  return [own, ...arms.map(k => vs[k])].filter(Boolean).map(v => String(v.normalized_value ?? v.reported_value ?? '')).filter(Boolean).join('; '); };
/** Make (views/summary-make.mjs) over the studies kept: its panel, and what Add to Tables and figures would keep (ui.make.spec). */
function makePanel(model, found, reg) {
  const kept = found.ids || new Set(model.all.map(p => p.id));
  const drill = (label, ids) => { const id = `mk-${reg.drills.size}`; reg.drills.set(id, { fieldId: '', fieldLabel: 'Make', label, items: ids.map(pid => ({ paperId: pid, cell: `${pid}:${model.cols[0]?.id || ''}`, text: '' })) }); return id; };
  if (!makeMod) { loadMake().then(() => { if (ui?.make?.open && ui.el?.isConnected) ui.ctx?.rerender(); }, () => {}); return '<section class="mk" aria-label="Make"><p class="meta mk-empty">Loading</p></section>'; }
  const { makeHtml, robOf, assessmentRows } = makeMod, st = model.st, rob = assessmentRows(st);
  const r = makeHtml({ make: ui.make, fields: summaryOf(model).fields, kept, total: model.all.length, choicesOf, drill, st,
    studyLabel: id => model.byId.get(id)?.label || 'Study', yearOf: id => yearOf(model.byId.get(id)), valueText: (p, f) => valueText(model, p, f),
    templateOf: fid => (st.templates || []).find(t => String(fid).startsWith(`${t.id}.`))?.id || (st.templates || [])[0]?.id || '',
    robOf: id => robOf(st, id, rob), datasets: st.datasets || [], participants: st.participants || [], ipdColumns: st.ipdColumns || [] });
  ui.make.keep = r.keep; ui.make.fits = r.fits || {}; ui.make.menus = r.menus || {};
  return r.html;
}

/** The menu of Add filter: the fields (grouped as the page groups them), each opening its choices with their counts. */
function filterMenu(anchor, model) {
  const all = summaryAll(model), conds = ui.conds || [], on = (f, k) => conds.some(c => c.fieldId === f.id && c.key === k);
  const item = f => { const choices = choicesOf(f).filter(x => x.ids.length); return choices.length ? { label: fieldTitle(f), submenu: choices.slice(0, 30).map(x => ({ label: x.label, meta: String(x.ids.length), checked: on(f, x.key),
    run: () => { ui.conds = on(f, x.key) ? conds.filter(c => !(c.fieldId === f.id && c.key === x.key)) : [...conds, { fieldId: f.id, fieldLabel: fieldTitle(f), key: x.key, label: x.label, ids: x.ids }]; ui.ctx.rerender(); } })) } : null; };
  const items = groupsOf(all.fields.filter(f => f.kind !== 'label')).flatMap(g => g.word ? [{ heading: g.word }, ...g.items.map(({ f }) => item(f))] : [item(g.items[0].f)]).filter(Boolean);
  showMenu(anchor, items, { align: 'start' });
}

/** The title bar of the page: Back, the name, the counts, Normalise (Stop while it runs) and More (Review data, Export). `run` holds the handlers: back, export. */
export function summarySpec({ studies = 0, fields = 0, listed = null } = {}, run = {}) {
  const running = normaliseRunning();
  const status = running ? runningText() : ui?.drill ? plural(listed ?? ui.drill.items.length, 'study', 'studies') : statusText({ studyCount: studies, fields: { length: fields } });
  if (ui) ui.specEligible = ui.eligible;
  const nothing = !ui?.eligible;
  // Normalise and Stop share the slot and its width, as Fill and Stop do: a run that starts or ends moves nothing
  const act = running ? { id: 'es-stop', label: 'Stop', icon: 'stop', role: 'secondary', labels: ['Stop', 'Normalise'], dynamic: true, run: () => stopNormalise() }
    : { id: 'es-normalise', label: 'Normalise', icon: 'classify', role: 'secondary', labels: ['Normalise', 'Stop'], dynamic: true, disabled: nothing, attrs: { 'aria-haspopup': 'dialog', ...(nothing ? { title: 'Every value is already counted or grouped' } : {}) },
      run: () => { if (ui?.ctx) startNormalise(ui.ctx, ui.model, () => ui?.ctx.rerender()); } };
  return { title: 'Data summary', back: { label: ui?.drill ? 'Back to summary' : 'Back to Extraction', run: run.back || (() => {}) },
    status: { text: status, ch: 24 }, actions: ui?.drill ? [] : [act],
    // Review data is a secondary: its local step is free and runs at once, its model step asks first (./extraction-review.mjs); it shares the page's one Stop
    overflow: [{ id: 'es-review', label: 'Review data', disabled: running || !studies, run: () => { if (ui?.ctx) startReview(ui.ctx, ui.model, () => ui?.ctx.rerender()); } },
      { id: 'es-export', label: 'Export…', run: run.export || (() => {}) }] };
}
/** Export's menu: the counts as the page shows them. */
export function summaryExport(anchor, model) {
  showMenu(anchor, [{ label: 'Counts (CSV)', icon: 'table', run: () => downloadCsv(csvRows(summaryOf(model)), `${String(model.name || 'extraction').toLowerCase().replace(/\W+/g, '-')}-summary.csv`) }]);
}

// ---- what a study's cell shows --------------------------------------------------------------------------------------------------------

const shown = v => (!v ? '' : v.availability === 'not_found' ? 'Not reported' : String(v.reported_value ?? v.normalized_value ?? '').trim());
/** The paper and where in it, as Details opens it (views/evidence.mjs): a file by its locator, a text or figure by page and region. */
function openEvidence(ctx, paperId, e) {
  if (e.kind === 'file') ctx.openDocument(paperId, { file: e.path, locator: e.locator, quote: e.quote });
  else ctx.openDocument(e.doc_id || paperId, { page: e.page, rects: e.rects || [], quote: e.quote || '', kind: e.kind, region: e.region || null });
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------------

// A study of a level's list (owner, 2026-10-22: "fix and improve"): its name opens the cell, as the whole row does; under it the value as
// written, unless it only repeats the level the list is of; its source in a column, unless every study's is the same file, said once above.
function drillRow(model, it, { level, oneSource, facts = () => [] }) {
  const p = model.byId.get(it.paperId), v = (model.st.values || {})[it.cell], label = p?.label || p?.title || 'Untitled';
  const own = it.text ?? shown(v), same = String(own || '').trim().toLowerCase() === String(level || '').trim().toLowerCase();
  // under the name: the value as written, unless it repeats the level; else the study's facts (its levels in the fields of few levels)
  const text = own && !same ? [own] : facts(it.paperId), anchors = anchorsOf(v);
  const src = anchors.length ? uiLink({ label: anchors[0].name, title: 'Open the paper here', attrs: { 'data-es-anchor': `${it.cell}#${anchors[0].k}` } })
    : `<button type="button" class="ui-link link" disabled>No source</button>`;
  return uiRow({ attrs: { 'data-es-row': it.cell },
    main: { html: uiLink({ label, title: p?.title && p.title !== p.label ? `${p.title}: open the cell` : 'Open the cell', attrs: { 'data-es-cell': it.cell } }), detail: text.map(esc), wrap: true },
    ...(oneSource ? {} : { cells: [{ col: 'src', kind: 'control', html: src }] }),
    end: uiRowEnd({ more: { label: `More for ${label}`, attrs: { 'data-es-more': it.cell } } }) });
}
// A number field's spread (owner, 2026-10-22: "we can show it better"): its values as a histogram over the statistics, each bar opening
// its studies as a count does; one value or one bar draws nothing.
function histogramHtml(f, title, drill) {
  const vals = f.numeric.values || [], bins = vals.length >= 3 ? histogramBins(vals.map(x => x.value)) : [];
  if (bins.length < 2) return '';
  const unit = f.unit ? ` ${f.unit}` : '', last = bins.length - 1;
  const ids = bins.map((b, j) => drill(`${fmt(b.lo)} to ${fmt(b.hi)}${unit}`, vals.filter(x => x.value >= b.lo && (x.value < b.hi || (j === last && x.value <= b.hi)))
    .sort((a, z) => a.value - z.value).map(x => ({ paperId: x.paperId, cell: x.cell, text: fmt(x.value) }))));
  let svg = columnChart(bins.map((b, j) => ({ label: `b${j}`, count: b.count, title: `${fmt(b.lo)} to ${fmt(b.hi)}${unit}` })),
    { width: 480, height: 160, xLabel: f.unit || title, yLabel: 'Studies', edges: [...bins.map(b => b.lo), bins[last].hi] });
  bins.forEach((b, j) => { svg = svg.replace(`data-chart-mark="b${j}"`, `data-chart-mark="b${j}" data-es-drill="${ids[j]}"`); });
  return `<figure class="es-hist chart-svg" aria-label="${esc(`Spread of ${title}`)}">${svg}</figure>`;
}

/**
 * A field of named measures, measure by measure (owner, 2026-10-22: the texts "made no sense"): each measure's row says its summary
 * (events summed, a change by medians) and opens the studies that give it; those that say it was not reported are a row of their own;
 * then a chart per measure that two or more studies give: the events per study as rates, a change as a line per study from before to after.
 */
function measuresHtml(f, title, out, drill, link, { reserve, studyLabel }) {
  const ms = f.measures.measures, U = s => s.unit;
  // a study that gives a measure twice (by subgroup, by level) is one study: its list has a row per cell, the parts joined
  const byCell = list => [...list.reduce((m, x) => m.set(x.cell, m.has(x.cell) ? { ...m.get(x.cell), text: `${m.get(x.cell).text}; ${x.text}` } : { paperId: x.paperId, cell: x.cell, text: x.text }), new Map()).values()];
  const rows = ms.flatMap(m => {
    const items = byCell(m.studies), silent = byCell(m.unreported).filter(x => !items.some(y => y.cell === x.cell));
    return [uiRow({ main: { html: esc(m.entry?.unit ? `${m.name} (${m.entry.unit})` : m.name), detail: [esc(measureLine(m))], wrap: true }, cells: [{ col: 'count', kind: 'control', html: link(items.length, m.name, items) }], end: reserve() }),
      // values outside the library's plausible range: the cells to check
      ...(m.outside?.length ? [uiRow({ depth: 1, main: { html: `<span class="es-check">${icon('warn', { size: 12 })}<span>${esc(`Outside ${rangeText(m.entry)}`)}</span></span>` }, cells: [{ col: 'count', kind: 'control', html: link(m.outside.length, `${m.name}: outside ${rangeText(m.entry)}`, m.outside) }], end: reserve() })] : []),
      ...(silent.length ? [uiRow({ depth: 1, main: { html: esc(NOT_GIVEN) }, cells: [{ col: 'count', kind: 'control', html: link(silent.length, `${m.name}: ${NOT_GIVEN.toLowerCase()}`, silent) }], end: reserve() })] : [])];
  });
  if (f.measures.unread.length) rows.push(uiRow({ main: { html: esc('Not read as measures') }, cells: [{ col: 'count', kind: 'control', html: link(f.measures.unread.length, 'Not read as measures', f.measures.unread.map(c => ({ paperId: c.paperId, cell: c.cell, text: c.text }))) }], end: reserve() }));
  out.push(countHeading({ title: plural(ms.length, 'measure'), count: '' }), uiList({ id: `es-m-${f.id}`, label: `Measures of ${title}`, cols: ['count'], rows }));
  // each chart is the measure's visual (lib/measure-visuals.mjs): the library entry's own when it names one, else the generic one for its type
  for (const m of ms.filter(m => m.studies.length >= (m.type === 'number' ? 3 : 2) && visualFor(m.entry, m.type)).slice(0, 4)) {
    const of = m.studies.filter(s => s.value.type === m.type), at = s => ({ 'data-es-drill': drill(`${m.name}: ${studyLabel(s.paperId)}`, [{ paperId: s.paperId, cell: s.cell, text: s.text }]) });
    const svg = visualFor(m.entry, m.type).draw(m, of.map(s => ({ label: studyLabel(s.paperId), value: s.value, attrs: at(s) })),
      { width: 480, unit: U(m.summary), scale: m.entry?.scale || null, better: m.entry?.better || null, range: m.entry?.range || null });
    out.push(`<figure class="es-hist chart-svg" aria-label="${esc(m.name)}"><figcaption class="meta">${esc(m.name)}</figcaption>${svg}</figure>`);
  }
}

/** The places a value was read, as { name, k }: the evidence items that have a label (a page, a figure, a file and its place). */
const anchorsOf = v => (v?.evidence || []).map((e, k) => ({ e, k, name: evidenceLabel(e) })).filter(a => a.name);

function drillHtml(model) {
  const d = ui.drill, pg = pageOf(d.items, ui.page, PAGE_SIZE), title = `${d.fieldLabel}: ${d.label}`;
  const first = d.items.map(it => anchorsOf((model.st.values || {})[it.cell])[0]?.name || '');
  // one source for all: the same place, or places in the same file ("table.xlsx Sheet!I7", "table.xlsx Sheet!I8"), said once above
  const fileOf = n => n.replace(/\s+\S*![A-Z]+\d+$/, '');
  const oneSource = d.items.length > 1 && first[0] && first.every(n => fileOf(n) === fileOf(first[0])) ? fileOf(first[0]) : '';
  // a study's facts: its levels in the fields of a few levels (two to six) other than the one listed, the first three
  const few = summaryAll(model).fields.filter(f => f.kind === 'categorical' && f.id !== d.fieldId && fieldTitle(f) !== d.fieldLabel && f.levels.filter(l => l.n).length >= 2 && f.levels.filter(l => l.n).length <= 6).slice(0, 3);
  const facts = id => few.map(f => f.levels.find(l => l.studies.some(x => x.paperId === id))?.label).filter(Boolean).map(levelText);   // each a part of the row's detail line, divided by its rule
  return `${countHeading({ title, count: num(d.items.length), countLabel: 'Studies' })}
    ${oneSource ? `<p class="meta es-drill-src">Read from ${esc(oneSource)}</p>` : ''}
    ${uiList({ id: 'es-drill', label: `Studies: ${title}`, cols: oneSource ? [] : ['src'], rows: pg.items.map(it => drillRow(model, it, { level: d.label, oneSource, facts })), empty: emptyState({ title: 'No studies', size: 'inline' }) })}
    ${pager({ id: 'es-pager', page: pg.page, pages: pg.pages, total: d.items.length, label: 'studies', size: PAGE_SIZE })}`;
}

/** The grouping proposed for a field, as it would count: the field summarised with the proposal's categories added (nothing is written). */
function previewOf(f, x, model) {
  const data = x.item.payload?.data; if (!data) return null;
  const scratch = { extractionSummary: structuredClone(model.st.extractionSummary || null) };
  applyMapping(scratch, f.id, data.add, { replace: !!data.replace });
  const field = model.cols.find(c => c.id === f.id); if (!field) return null;
  return summarise({ fields: [field], studies: model.all.map(p => ({ id: p.id, label: p.label })), values: model.st.values || {}, mappings: { [f.id]: scratch.extractionSummary.fields[f.id] } }).fields[0];
}
const PREVIEW_LEVELS = 12;
/** One grouping waiting for a person (lib/aid.mjs ledger): its categories with their counts, and Accept and Discard. */
function proposalHtml(f, i, x, model) {
  const fs = previewOf(f, x, model), levels = (fs?.levels || []).filter(l => l.key.startsWith('c:') && l.n > 0);
  const rows = levels.slice(0, PREVIEW_LEVELS).map(l => uiRow({ main: { html: esc(l.label) }, cells: [{ col: 'count', kind: 'visual', html: esc(num(l.n)) }] }));
  if (levels.length > PREVIEW_LEVELS) rows.push(uiRow({ main: { html: esc(`+${levels.length - PREVIEW_LEVELS} more`) } }));
  const body = rows.length ? uiList({ id: `es-${i}-prev`, label: `Categories proposed for ${f.label}`, cols: ['count'], rows }) : '';
  return uiReview({ id: x.item.id, kind: 'Grouping proposed', summary: x.item.detail || '', acceptLabel: 'Accept', dismissLabel: 'Discard', body, open: ui.open.has(`prev:${f.id}`) });
}

/** The body of one field: how it was read, its grouping, the statistics or the levels, and its states. Each count is a link to the studies behind it. */
function fieldBody(f, i, reg, env) {
  const title = fieldTitle(f), has = f.states.present.n, mapping = env.mapping, cats = Object.keys(mapping?.categories || {}).length, grouped = cats > 0;
  let k = 0, kc = 0;   // the group ids of this field's body: the same body gives the same ids, so Back finds the count that was pressed
  const link = (n, label, items) => {
    const id = `d${i}-${k++}`; reg.drills.set(id, { fieldId: f.id, fieldLabel: title, label, items });
    return uiLink({ label: num(n), title: `Show the ${plural(n, 'study', 'studies')}`, attrs: { 'data-es-drill': id, 'aria-label': `${plural(n, 'study', 'studies')}: ${label}, ${title}` } });
  };
  // a category of the project's grouping can be renamed and merged: its row ends in More; the other rows of the list keep the end slot
  const reserve = () => uiRowEnd({ reserve: true });   // every row of a field's lists ends in the same slot, so the figures of its lists share one right edge
  const endOf = (key, label) => {
    if (!grouped || !key?.startsWith('c:')) return reserve();
    const id = `c${i}-${kc++}`; reg.cats.set(id, { fieldId: f.id, id: key.slice(2), label });
    return uiRowEnd({ more: { label: `More for ${label}`, attrs: { 'data-es-cmore': id } } });
  };
  const counted = (label, n, pct, items, extra = {}) => uiRow({ depth: extra.depth, main: { html: esc(label) },
    cells: [{ col: 'pct', kind: 'visual', html: pct ? `<span class="es-share">${bar(parseFloat(pct) / 100)}<span class="es-pct">${esc(pct)}</span></span>` : '' }, { col: 'count', kind: 'control', html: link(n, label, items) }], end: extra.end ?? reserve() });
  const cellsOf = list => list.map(s => ({ paperId: s.paperId, cell: s.cell }));
  const out = [], side = [];
  if (env.stale) out.push(uiNotice({ id: `es-stale-${i}`, label: 'Grouping out of date', text: 'The field definition changed after this grouping was approved.', actions: [{ id: `es-keep-${i}`, label: 'Keep grouping', attrs: { 'data-es-keep': f.id } }] }));
  if (env.proposal) out.push(proposalHtml(f, i, env.proposal, env.model));
  const groupedLine = grouped ? `Grouping: ${plural(cats, 'category', 'categories')}, ${plural(Object.keys(mapping.cells || {}).length, 'text')}` : '';
  side.push(countHeading({ title: 'How it was read', count: '' }));
  side.push(uiList({ id: `es-${i}-read`, label: `How ${title} was read`, rows: [uiRow({ main: { html: esc(f.reason ? f.reason.replace(/^./, c => c.toUpperCase()) : KIND_WORDS[f.kind]), ...(groupedLine ? { detail: [esc(groupedLine)] } : {}), wrap: true },
    ...(grouped ? { end: uiRowEnd({ more: { label: `More for the grouping of ${title}`, attrs: { 'data-es-fmore': f.id } } }) } : {}) })] }));

  if (f.kind === 'numeric' && f.numeric?.n) {
    out.push(countHeading({ title: 'Numbers', count: '' }));
    out.push(histogramHtml(f, title, (label, items) => { const id = `d${i}-${k++}`; reg.drills.set(id, { fieldId: f.id, fieldLabel: title, label, items }); return id; }));
    out.push(uiList({ id: `es-${i}-stats`, label: `Numbers of ${title}`, cols: ['value'], rows: numericRows(f).map(([k, v]) => uiRow({ main: { html: esc(k) }, cells: [{ col: 'value', kind: 'visual', html: esc(v) }], end: reserve() })) }));
  }
  const states = stateRows(f).map(s => counted(s.label, s.n, percent(s.n, f.studyCount), cellsOf(s.studies)));
  if (f.kind === 'numeric') {
    const d = f.numeric;
    // text a number field holds that is not a number comes first: it is the cell to look at
    if (d.unparsed.length) states.unshift(counted('Not numeric', d.unparsed.length, '', d.unparsed.map(u => ({ paperId: u.paperId, cell: u.cell, text: u.text }))));
    if (d.n) states.push(counted('Numbers, lowest first', d.n, '', [...d.values].sort((a, b) => a.value - b.value).map(x => ({ paperId: x.paperId, cell: x.cell, text: fmt(x.value) }))));
  }
  // named measures (a count of a total, a change from one value to another): a row per measure, its studies a press away, and its chart
  if (f.kind === 'measures') { measuresHtml(f, title, out, (label, items) => { const id = `d${i}-${k++}`; reg.drills.set(id, { fieldId: f.id, fieldLabel: title, label, items }); return id; }, link, { reserve, studyLabel: id => env.model?.byId.get(id)?.label || 'Study' });
    side.push(countHeading({ title: `All ${plural(f.studyCount, 'study', 'studies')}`, count: '' }), uiList({ id: `es-${i}-states`, label: `Studies by state, ${title}`, cols: ['pct', 'count'], rows: states }));
    return splitHtml(out, side); }
  // a field that names its studies (lib/extraction-summary.mjs identifierOf) is only counted as filled: its states when some study lacks it, no levels
  if (f.kind === 'label' && has === f.studyCount) return splitHtml(out, side);
  // the states go beside the levels when there are levels, else they are the field's main list
  const leveled = f.kind !== 'numeric' && f.kind !== 'label';
  // every study holds a value: the field's own row already says so ("28 of 28"), so the states are not listed again
  if (!(leveled && has === f.studyCount && states.length === 1)) (leveled ? side : out).push(countHeading({ title: `All ${plural(f.studyCount, 'study', 'studies')}`, count: '' }),
    uiList({ id: `es-${i}-states`, label: `Studies by state, ${title}`, cols: ['pct', 'count'], rows: states }));

  // a free text read part by part (lib/extraction-parts.mjs): what its cells open with, counts of a total, numbers by the word they count,
  // parts that recur; each count opens its studies, above the texts as written
  if (f.kind === 'free' && f.parts) {
    const P = f.parts, pct = n => percent(n, has);
    const section = (heading, id, rows) => { if (rows.length) out.push(countHeading({ title: heading, count: '' }), uiList({ id: `es-${i}-${id}`, label: `${heading}, ${title}`, cols: ['pct', 'count'], rows })); };
    section('Opens with', 'leads', P.leads.filter(l => l.k >= 2 || P.leads.length <= 8).slice(0, 12).map(l => counted(l.label, l.k, pct(l.k), cellsOf(l.studies))));
    section('Counts', 'tallies', P.tallies.map(t => counted(`${t.name}: ${num(t.n)}/${num(t.N)} (${percent(t.n, t.N) || '0%'})`, t.k, pct(t.k), cellsOf(t.studies))));
    section('Numbers', 'counts', P.counts.map(c => counted(`${c.word.charAt(0).toUpperCase()}${c.word.slice(1)}: ${countLine(c, fmt)}`, c.k, pct(c.k), cellsOf(c.studies))));
    section('Parts that recur', 'recur', P.recurring.slice(0, 12).map(r => counted(r.label, r.k, pct(r.k), cellsOf(r.studies))));
  }
  if (f.kind !== 'numeric' && f.kind !== 'label') {
    // an ungrouped free text lists its texts, each a row that opens its studies, rather than one count of how many differ
    const texts = f.kind === 'free' && !levelRows(f).length ? f.residual.items.map(r => ({ label: r.text.length > 90 ? `${r.text.slice(0, 89)}…` : r.text, n: r.cells.length, cells: r.cells })).sort((a, b) => b.n - a.n) : null;
    const all = texts ? texts.map(t => counted(t.label, t.n, '', t.cells.map(c => ({ paperId: idOf(c), cell: c })), { end: reserve() }))
      : levelRows(f).flatMap(l => [counted(l.label, l.n, l.pct, cellsOf(l.studies), { end: endOf(l.key, l.label) }), ...(l.sub || []).map(s => counted(s.label, s.n, s.pct, cellsOf(s.studies), { depth: 1, end: endOf(null, s.label) }))]);
    const leftover = (label) => counted(label, f.residual.cells, '', f.residual.items.flatMap(r => r.cells.map(c => ({ paperId: idOf(c), cell: c }))), { end: endOf(null, label) });
    if (!texts && f.residual.items.length) all.push(leftover('Not grouped'));
    const none = emptyLevels(f);
    if (none.length) all.push(uiRow({ main: { html: esc(`No study holds ${none.length === 1 ? none[0] : `${none.length} levels: ${none.join(', ')}`}`) }, cells: [{ col: 'pct', kind: 'visual', html: '' }, { col: 'count', kind: 'control', html: '' }], end: reserve() }));
    if (all.length) {
      const pg = pageOf(all, ui.lvPage?.get(f.id) || 1, LEVELS_PAGE);
      out.push(countHeading({ title: texts ? `${plural(texts.length, 'distinct text')} in ${plural(has, 'study', 'studies')}` : has ? `The ${plural(has, 'study', 'studies')} with a value` : 'Levels', count: '' }));
      // a few levels that share the studies out between them read best as parts of a whole
      const lv = levelRows(f);
      // only when each study holds one level: the parts then add up to the whole the shares are of
      if (f.kind === 'categorical' && lv.length >= 2 && lv.length <= 5 && !texts && lv.reduce((n, l) => n + l.n, 0) <= has) out.push(`<figure class="es-hist es-donut chart-svg" aria-label="${esc(`Shares of ${title}`)}">${donutChart(lv.map(l => ({ label: l.label, n: l.n,
        attrs: { 'data-es-drill': (() => { const id = `d${i}-${k++}`; reg.drills.set(id, { fieldId: f.id, fieldLabel: title, label: l.label, items: cellsOf(l.studies) }); return id; })() } })), { width: 360, title: `Shares of ${title}` })}</figure>`);
      out.push(uiList({ id: `es-${i}-levels`, label: `Levels of ${title}`, cols: ['pct', 'count'], rows: pg.items }));
      if (pg.pages > 1) out.push(pager({ id: `es-lv-${i}`, page: pg.page, pages: pg.pages, total: all.length, label: texts ? 'texts' : 'levels', size: LEVELS_PAGE }));
    }
  }
  return splitHtml(out, side);
}
/** An open field: what it holds on the left, how it was read (and, beside its levels, its studies by state) on the right; stacked when narrow. */
const splitHtml = (main, side) => `<div class="es-open-grid"><div class="es-open-main">${main.join('')}</div><div class="es-open-side">${side.join('')}</div></div>`;
/** A share (0..1) as a short bar in the track's grey, the figure house style without hue. */
const bar = share => `<svg class="es-meter" width="100%" height="6" aria-hidden="true" focusable="false"><rect class="es-meter-off" x="0" y="0" width="100%" height="6" rx="3"/>${share > 0 ? `<rect class="es-meter-on" x="0" y="0" width="${(Math.min(1, share) * 100).toFixed(1)}%" height="6" rx="3"/>` : ''}</svg>`;

/**
 * A field of the summary (2026-10-21, after HubSpot's per-field response bars and Databricks' data profile on Mobbin): one row of a table whose
 * columns every field shares (its name, its kind, how many studies hold a value, with a meter, and what it holds in a line); pressing it unfolds
 * its lists in place.
 */
function fieldHtml(f, i, open, body, name = fieldTitle(f), said = '') {
  const share = f.studyCount ? f.states.present.n / f.studyCount : 0;
  return `<details class="ui-disclosure es-field" data-es-field="${esc(f.id)}" data-es-i="${i}"${open ? ' open' : ''}><summary>
    <span class="ui-disclosure-title"${name !== fieldTitle(f) ? ` title="${esc(fieldTitle(f))}"` : ''}>${esc(name)}</span><span class="es-kind" data-kind="${f.kind}" title="${esc(KIND_WORDS[f.kind])}">${icon(KIND_ICON[f.kind] || 'align-left', { size: 12 })}<span>${esc(KIND_WORDS[f.kind])}</span></span>
    <span class="es-fill">${bar(share)}<span class="ui-disclosure-count">${esc(closedCount(f))}</span></span><span class="es-digest">${said ? esc(said) : f.kind === 'label' ? '' : esc(digest(f))}</span></summary><div class="ui-disclosure-body">${body}</div></details>`;
}

/** What a field needs to be drawn: the project's grouping of it, whether that is out of date, the proposal waiting for it. */
const envOf = (f, model, proposals) => ({ mapping: model.st.extractionSummary?.fields?.[f.id] || null, stale: ui.stale.has(f.id), proposal: proposals.get(f.id) || null, model });

function listHtml(model, summary, reg) {
  if (!summary.fields.length) return emptyState({ title: 'No fields', size: 'inline' });
  const proposals = proposalsByField(), shownStale = summary.fields.filter(f => ui.stale.has(f.id)), waiting = summary.fields.filter(f => proposals.has(f.id));
  const run = lastRun();
  const notices = [
    run ? uiNotice({ id: 'es-run', label: 'Last run', text: [run.title, run.note].filter(Boolean).join('. '), dismissible: true }) : '',
    waiting.length ? uiSummary({ id: 'es-proposed', label: 'Groupings proposed', text: `${plural(waiting.length, 'grouping')} proposed`, action: { id: 'es-show-proposed', label: 'Review' } }) : '',
    shownStale.length ? uiNotice({ id: 'es-stale', label: 'Groupings out of date', text: `${plural(shownStale.length, 'grouping')} made under an earlier field definition`, actions: [{ id: 'es-show-stale', label: 'Show' }] }) : ''].filter(Boolean).join('');
  const shown = summary.fields.filter(f => !isRest(f)), rest = summary.fields.map((f, i) => ({ f, i })).filter(({ f }) => isRest(f));
  const listed = groupsOf(summary.fields).map(g => ({ ...g, items: g.items.filter(({ f }) => !isRest(f)) })).filter(g => g.items.length), same = sameStudies(shown);
  return `${filterHtml(model, reg)}${notices}${measuresBlock(summary, reg, { title: fieldTitle })}<div class="es-cols" aria-hidden="true"><span>Field</span><span>Kind</span><span>Studies</span><span>What it holds</span></div>`
    + listed.map(g => {
      const rows = g.items.map(({ f, i, name }) => fieldHtml(f, i, ui.open.has(f.id), ui.open.has(f.id) ? fieldBody(f, i, reg, envOf(f, model, proposals)) : '', name, same.get(f.id))).join('');
      return g.word ? `<div class="es-group" role="group" aria-label="${esc(g.word)}"><p class="es-group-title">${esc(g.word)}</p>${rows}</div>` : rows;
    }).join('')
    // fields that name the study, say where a value was found or hold nothing: counted, not analyzed, kept together at the end
    + (rest.length ? `<div class="es-group es-rest" role="group" aria-label="Not analyzed"><p class="es-group-title">Not analyzed</p>${rest.map(({ f, i }) => fieldHtml(f, i, ui.open.has(f.id), ui.open.has(f.id) ? fieldBody(f, i, reg, envOf(f, model, proposals)) : '', fieldTitle(f), restReason(f))).join('')}</div>` : '');
}

/** Why a field is not analyzed, in a few words (lib/extraction-summary.mjs identifierOf, or no values). */
const restReason = f => (!f.states.present.n ? 'No values' : f.reason ? f.reason.charAt(0).toUpperCase() + f.reason.slice(1) : '');
const isRest = f => f.kind === 'label' || !f.states.present.n;
/**
 * A field of one level whose studies are exactly those of another field's level ("Component hybrid: Yes" and "Intent: Hybrid") says nothing
 * of its own: its row names the level it repeats (owner, 2026-10-23: "many things could be connected").
 */
function sameStudies(fields) {
  const out = new Map(), setOf = l => l.studies.map(x => x.paperId).sort().join('|');
  for (const f of fields) {
    const own = f.levels.filter(l => l.n > 0);
    if (f.kind !== 'categorical' || own.length !== 1) continue;
    const key = setOf(own[0]);
    for (const g of fields) {
      if (g === f || g.kind !== 'categorical' && g.kind !== 'multi') continue;
      const hit = g.levels.find(l => l.n === own[0].n && setOf(l) === key && g.levels.filter(x => x.n > 0).length > 1);
      if (hit) { out.set(f.id, `Same ${plural(hit.n, 'study', 'studies')} as ${fieldTitle(g)}: ${hit.label}`); break; }
    }
  }
  return out;
}

/**
 * Fields that share a first word (Device class and Device type, Study design and Study population) are one group under that word, each named
 * by the rest of its label (owner, 2026-10-22: "group some things ... show more structured"). A group stands where
 * its first field did; a field named the word alone (Study) leads its group under its own name; a word of two letters is no group.
 */
export function groupsOf(fields) {
  const wordOf = f => String(f.label || '').match(/^\p{L}[\p{L}\d-]*/u)?.[0] || '';
  const n = new Map();
  for (const f of fields) { const w = wordOf(f).toLowerCase(); if (w.length > 2) n.set(w, (n.get(w) || 0) + 1); }
  const out = [], at = new Map();
  fields.forEach((f, i) => {
    const word = wordOf(f), key = word.toLowerCase();
    if ((n.get(key) || 0) < 2) { out.push({ items: [{ f, i, name: fieldTitle(f) }] }); return; }
    if (!at.has(key)) { const g = { word, items: [] }; at.set(key, g); out.push(g); }
    const rest = fieldTitle(f).slice(word.length).replace(/^[\s:;,/–-]+/, '');
    at.get(key).items.push({ f, i, name: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : fieldTitle(f) });
  });
  return out;
}

/** The sub-page under Extraction's title bar. `model`: { templateId, name, st, cols, all, focus(paperId, columnId) }. `ctx.rerender` repaints the page and its title bar. */
export function renderSummary(el, ctx, model) {
  if (!ui) { ctx.rerender(); return; }
  model = { ...model, byId: new Map(model.all.map(p => [p.id, p])) };
  ui.ctx = ctx; ui.model = model; 
  if (!model.all.length) { el.innerHTML = `<div class="es-page">${emptyState({ icon: 'extraction', title: 'No studies yet', size: 'inline' })}</div>`; return; }
  const summary = summaryOf(model), reg = { drills: new Map(), cats: new Map() }, mappings = model.st.extractionSummary?.fields || {};
  // a library entry that names an addon's visual: the addons load once, and the page is drawn again with it
  if (!addonsAsked && summary.fields.some(f => f.measures?.measures.some(m => visualMissing(m.entry)))) {
    addonsAsked = true; import('../lib/addons.mjs').then(a => a.loadAddons()).then(() => { if (ui && el.isConnected) ctx.rerender(); }, () => {});
  }
  // what Normalise would still ask: a field with something no rule counts, or a grouping made under an earlier definition
  const asks = summary.fields.filter(f => { const a = toNormalise(f); return a.items.length || a.markers.length; }).map(f => f.id);
  ui.eligible = new Set([...asks, ...ui.stale]).size;
  if (ui.specEligible !== null && ui.specEligible !== ui.eligible) { ctx.rerender(); return; }   // the title bar was drawn for another count: draw both again
  // the definitions are hashed asynchronously: a grouping made under another one is marked when the answer arrives
  const key = `${getVersion()}|${model.templateId}`;
  if (ui.staleKey !== key) {
    ui.staleKey = key;
    staleFields(model.cols, mappings).then(set => {
      if (!ui || ui.staleKey !== key) return;
      const same = set.size === ui.stale.size && [...set].every(x => ui.stale.has(x));
      ui.stale = set; if (!same) ctx.rerender();
    });
  }
  // a saved proposal needs the assistant's handlers to be listed; the page repaints when they are here and whenever the ledger changes
  if (!aidReady() && aidNeeded()) ensureAid().then(() => { if (ui && el.isConnected) ctx.rerender(); }, () => {});
  // The page repaints when the proposals waiting for it change (a run filed one, one was accepted or discarded, here or in Proposals). The ledger's listeners
  // also hear every store write, so the page compares what it would draw from, and registers once (a listener added while the Set is walked is called in the walk).
  ui.el = el; ui.sig = proposalSig();
  ui.off ||= onChange(() => {
    if (!ui || ui.queued || ui.drill || !ui.el?.isConnected || proposalSig() === ui.sig) return;
    ui.queued = true; queueMicrotask(() => { if (ui) { ui.queued = false; ui.ctx?.rerender(); } });
  });
  const draw = () => {
    reg.drills.clear(); reg.cats.clear();
    el.innerHTML = `<div class="es-page" id="es-page" role="region" aria-label="Data summary">${ui.drill ? drillHtml(model) : listHtml(model, summary, reg)}</div>`;
    const page = el.firstElementChild;
    wireMeasures(page, { rerender: () => ctx.rerender(), say: msg => ctx.say?.(msg), go: k => ctx.go?.(k) });
    page.querySelectorAll('.es-open-grid').forEach(g => fitSplit(g, 760));
    // the field table's columns as the pane allows: every column, a kind by its icon, or without what each holds (measured, never a breakpoint)
    fitSteps(page, 'cols', [[560, 'full'], [400, 'icon']], 'short');
    // Make's settings column stands beside the preview while the panel holds both; the forest plot is drawn again at the preview's width when that is narrower
    page.querySelectorAll('.mk-body').forEach(g => fitSplit(g, 640));
    // Make's figures drawn again at the width their box has (summary-make's fits), as the pane changes; its plot and votes side by side while 900 px wide
    page.querySelectorAll('.mk-split').forEach(g => fitSplit(g, 900));
    page.querySelectorAll('[data-mk-fit]').forEach(box => { const draw = ui.make?.fits?.[box.dataset.mkFit]; if (!draw) return;
      const fit = () => { const cs = getComputedStyle(box), w = Math.round(box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); if (w > 0 && box.dataset.w !== String(w)) { box.dataset.w = String(w); box.innerHTML = draw(w); } };
      fit(); watchWidth(box, fit); });
    wirePager(el, 'es-pager', n => { ui.page = n; draw(); });
    // a field opens: its body is drawn when it first opens (52 fields are 52 rows until then)
    // a field's body, drawn when it first opens and again when its list turns a page; its pager is wired with it
    const drawBody = (d, f) => {
      const i = +d.dataset.esI, body = d.querySelector('.ui-disclosure-body'); if (!body) return;
      body.innerHTML = fieldBody(f, i, reg, envOf(f, model, proposalsByField())); body.querySelectorAll('.es-open-grid').forEach(g => fitSplit(g, 760));
      wirePager(body, `es-lv-${i}`, n => { (ui.lvPage ??= new Map()).set(f.id, n); drawBody(d, f); });
    };
    el.querySelectorAll('details[data-es-field][open]').forEach(d => { const i = +d.dataset.esI; wirePager(d, `es-lv-${i}`, n => { (ui.lvPage ??= new Map()).set(summary.fields[i].id, n); drawBody(d, summary.fields[i]); }); });
    page.addEventListener('toggle', e => {
      const d = e.target.closest?.('details[data-es-field]'); if (!d || ui.drill) return;
      const f = summary.fields[+d.dataset.esI];
      if (d.open) { ui.open.add(f.id); const body = d.querySelector('.ui-disclosure-body'); if (body && !body.firstElementChild) drawBody(d, f); }
      else ui.open.delete(f.id);
    }, true);
    // Make's choices: a select or a Visualize as tile changes what is drawn, at once
    page.addEventListener('change', e => {
      const sel = e.target.closest?.('select[id^="mk-"], input[id^="mk-"]'); if (!sel || !ui.make) return;
      const key = sel.id.slice(3); ui.make[key] = sel.type === 'checkbox' ? sel.checked : sel.value;
      if (key === 'split') { ui.make.a = ''; ui.make.b = ''; }
      ctx.rerender();
    });
    page.addEventListener('click', e => {
      // one field open at a time (owner, 2026-10-22): opening a field folds the others; "Show proposed" may still open several at once
      const sum = e.target.closest?.('details[data-es-field] > summary');
      if (sum && !sum.parentElement.open) page.querySelectorAll('details[data-es-field][open]').forEach(d => { if (d !== sum.parentElement) d.open = false; });
      // a row of a field's lists opens its studies, as its count does: the whole row is the press
      const row = !sum && e.target.closest?.('.es-open-grid .ui-row');
      if (row && !e.target.closest('button, a, input, select')) { const go = row.querySelector('[data-es-drill]'); if (go) { go.click(); return; } }
      // a study of a list opens its cell from anywhere in its row
      const study = e.target.closest?.('#es-drill .ui-row');
      if (study && !e.target.closest('button, a, input, select')) { study.querySelector('[data-es-cell]')?.click(); return; }
      const hit = sel => e.target.closest?.(sel);
      let b;
      if ((b = hit('[data-es-drill]'))) {
        const d = reg.drills.get(b.dataset.esDrill); if (!d) return;
        ui.drill = d; ui.page = 1; ui.last = b.dataset.esDrill; ctx.rerender();
      } else if ((b = hit('[data-es-all]'))) {
        ui.all.add(b.dataset.esAll); draw();
      } else if ((b = hit('[data-es-anchor]'))) {
        const [cell, k] = b.dataset.esAnchor.split('#'), v = (model.st.values || {})[cell], ev = v?.evidence?.[+k];
        if (ev) openEvidence(ctx, idOf(cell), ev);
      } else if ((b = hit('#es-make'))) {
        ui.make = ui.make?.open ? { ...ui.make, open: false } : { what: 'chart', ...(ui.make || {}), open: true }; ctx.rerender();
      } else if ((b = hit('#mk-close'))) {
        ui.make.open = false; ctx.rerender();
      } else if ((b = hit('[data-mk-what]'))) {
        ui.make.what = b.dataset.mkWhat; ui.make.field = ''; ui.make.by = ''; ui.make.group = ''; ctx.rerender();
      } else if ((b = hit('[data-mk-type]'))) {
        ui.make.type = b.dataset.mkType; ctx.rerender();
      } else if ((b = hit('[data-mk-menu]'))) {
        // a Make menu (the forest's options): each entry sets what it names on the mode's state, and the result is drawn again
        const items = list => list.map(it => ({ label: it.label, ...(typeof it.checked === 'boolean' ? { checked: it.checked } : {}), ...(it.disabled ? { disabled: true } : {}),
          ...(it.submenu ? { submenu: items(it.submenu) } : { run: () => { Object.assign(ui.make, it.set); ctx.rerender(); } }) }));
        showMenu(b, items(ui.make.menus?.[b.dataset.mkMenu] || []), { align: 'end', minWidth: 180 });
      } else if ((b = hit('#mk-keep'))) {
        // what the mode's primary files (lib/make-save.mjs): an output, an outcome with its analysis, a domain of Certainty's SWiM, a survival record
        const what = ui.make.keep; if (!what || !makeMod) return;
        let r = null; update(st => { r = makeMod.keep(st, what); return st; });
        ctx.say?.(r?.message || 'Kept');
      } else if ((b = hit('#es-add-filter'))) {
        filterMenu(b, model);
      } else if ((b = hit('#es-clear-filter'))) {
        ui.conds = []; ctx.rerender();
      } else if ((b = hit('[data-es-unfilter]'))) {
        ui.conds = (ui.conds || []).filter(c => c.fieldId !== b.dataset.esUnfilter); ctx.rerender();
      } else if ((b = hit('[data-es-go]'))) {
        ctx.go?.(b.dataset.esGo);
      } else if ((b = hit('[data-es-outcome]'))) {
        const id = b.dataset.esOutcome; import('./analysis.mjs').then(an => { an.selectOutcome?.(id); ctx.go?.('analysis'); });
      } else if ((b = hit('[data-es-suggest]'))) {
        // the suggested subgroup set up in Make: its measure (by name) split by its field, over the studies the filter keeps
        const fields = summaryOf(model).fields, split = fields.find(f => fieldTitle(f) === b.dataset.esSuggest || f.label === b.dataset.esSuggest);
        const want = String(b.dataset.esMeasure || '').toLowerCase(), m = measuresOf(fields).find(x => String(x.name).toLowerCase() === want);
        ui.make = { ...(ui.make || {}), open: true, what: 'meta', ...(m ? { measure: m.id } : {}), ...(split ? { split: split.id, a: '', b: '' } : {}) }; ctx.rerender();
      } else if ((b = hit('[data-es-cell]'))) {
        const cell = b.dataset.esCell;
        if (!model.focus(idOf(cell), fieldIdOf(cell))) { ctx.say?.('That cell is not in this table'); return; }
        closeSummary(); ctx.rerender(); ctx.openDetails?.();
      } else if ((b = hit('[data-es-more]'))) {
        const cell = b.dataset.esMore, v = (model.st.values || {})[cell], paperId = idOf(cell), p = model.byId.get(paperId);
        showMenu(b, [...anchorsOf(v).slice(1).map(a => ({ label: `Open paper at ${a.name}`, run: () => openEvidence(ctx, paperId, a.e) })),
          { label: 'Open paper', run: () => ctx.openDocument(paperId, null), disabled: !p?.pdf }]);
      } else if ((b = hit('[data-es-cmore]'))) {
        categoryMenu(b, reg.cats.get(b.dataset.esCmore), model, ctx);
      } else if ((b = hit('[data-es-fmore]'))) {
        groupingMenu(b, summary.fields.find(f => f.id === b.dataset.esFmore), model, ctx);
      } else if ((b = hit('[data-es-keep]'))) {
        const id = b.dataset.esKeep, field = model.cols.find(c => c.id === id);
        if (field) definitionHash(field).then(h => { acceptDefinition(id, h); ctx.rerender(); });
      } else if ((b = hit('.ui-review [data-more]'))) {
        // the proposal's preview opens and closes in place
        const open = b.getAttribute('aria-expanded') !== 'true', body = document.getElementById(b.getAttribute('aria-controls'));
        b.setAttribute('aria-expanded', String(open)); if (body) body.hidden = !open;
        const fid = hit('details[data-es-field]')?.dataset.esField; if (fid) (open ? ui.open.add(`prev:${fid}`) : ui.open.delete(`prev:${fid}`));
      } else if ((b = hit('.ui-review [data-accept], .ui-review [data-discard]'))) {
        const id = hit('.ui-review')?.dataset.i, x = [...proposalsByField().values()].find(y => y.item.id === id); if (!x) return;
        if (b.hasAttribute('data-accept')) { b.setAttribute('aria-busy', 'true'); b.disabled = true; acceptProposal(x).then(() => ctx.rerender(), () => ctx.rerender()); }
        else { discardProposal(x); ctx.rerender(); }
      } else if (hit('#es-show-proposed') || hit('#es-show-stale')) {
        const ids = hit('#es-show-proposed') ? [...proposalsByField().keys()] : [...ui.stale];
        for (const id of ids) ui.open.add(id);
        draw();
      } else if (hit('#es-run-dismiss')) { clearLastRun(); draw(); }
    });
  };
  draw();
  if (ui.last && !ui.drill) { el.querySelector(`[data-es-drill="${CSS.escape(ui.last)}"]`)?.focus({ preventScroll: true }); ui.last = ''; }
}

/** What the page draws of the ledger: the open proposals, by field. */
const proposalSig = () => JSON.stringify([...proposalsByField()].map(([f, x]) => [f, x.item.id]));

/** A category of a grouping: Rename and Merge into another category of the field. They change how texts are counted, never a value. */
function categoryMenu(anchor, c, model, ctx) {
  if (!c) return;
  const others = Object.entries(model.st.extractionSummary?.fields?.[c.fieldId]?.categories || {}).filter(([id]) => id !== c.id).map(([id, v]) => ({ id, label: v.label }));
  showMenu(anchor, [
    { label: 'Rename…', icon: 'rename', run: async () => { const v = await ask('Rename category', { value: c.label, confirm: 'Rename' }); if (v && v.trim()) { renameCategory(c.fieldId, c.id, v.trim()); ctx.rerender(); } } },
    { label: 'Merge into', icon: 'merge', disabled: !others.length, submenu: others.map(o => ({ label: o.label, run: () => { mergeCategories(c.fieldId, [o.id, c.id], o.label); ctx.rerender(); } })) }]);
}
/** A field's grouping as a whole: Remove it (the categories go, the values stay). */
function groupingMenu(anchor, f, model, ctx) {
  if (!f) return;
  showMenu(anchor, [{ label: 'Remove grouping', icon: 'trash', danger: true, run: async () => {
    if (await confirmAsk('Remove grouping', { detail: `${f.label}: its categories go; no value changes`, confirm: 'Remove grouping', danger: true })) { removeGrouping(f.id); ctx.rerender(); }
  } }]);
}

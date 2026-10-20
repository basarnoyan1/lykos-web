// The data summary: a sub-page of Extraction (design note 2026-10-13 §6, the pattern of the Word tables in ./evidence-exports.mjs). It counts what
// the table's studies hold, field by field, and every count opens the list of studies behind it, each with its value as written, its source
// anchors (the paper opens at that page) and Open cell, which returns to the grid with that cell chosen. The counts are lib/extraction-summary.mjs,
// the words are lib/extraction-summary-view.mjs; this file draws them with the shared builders and keeps the page's own state: which fields are
// open and which list is shown. Nothing here writes a value. Its head is the shell's title bar (Extraction's page() asks summarySpec).
import { getVersion } from '../store.mjs';
import { summarise, toNormalise } from '../lib/extraction-summary.mjs';
import { staleFields, definitionHash } from '../lib/extraction-normalise.mjs';
import { applyMapping } from '../lib/extraction-summary-mapping.mjs';
import { renameCategory, mergeCategories, removeGrouping, acceptDefinition } from '../lib/extraction-summary-store.mjs';
import { startNormalise, normaliseRunning, stopNormalise, runningText, proposalsByField, acceptProposal, discardProposal, lastRun, clearLastRun } from './extraction-normalise.mjs';
import { startReview } from './extraction-review.mjs';
import { ensureAid, aidNeeded, aidReady, onChange } from '../lib/aid-core.mjs';
import { KIND_WORDS, percent, fmt, stateRows, closedCount, digest, numericRows, levelRows, statusText, csvRows } from '../lib/extraction-summary-view.mjs';
import { evidenceLabel } from '../lib/evidence.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiList, uiRow, uiRowEnd, uiReview, uiNotice, uiSummary } from '../lib/ui-actions.mjs';
import { disclosure, uiLink, countHeading } from '../lib/ui-components.mjs';
import { pager, pageOf, wirePager, PAGE_SIZE } from '../lib/paging.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { plural, num } from '../lib/dates.mjs';

const LEVELS_SHOWN = 50;   // a field with more levels shows this many, then Show all

// The page's state, in the module so a repaint of Extraction (a run, a store change) keeps what is open.
let ui = null;   // { templateId, open: Set of field ids, all: Set of field ids showing every level, drill: null | { fieldId, fieldLabel, label, items }, page, last,
                 //   ctx, model (as last drawn: the title bar's Normalise acts on them), stale: Set of field ids, staleKey, eligible, specEligible, off }
export const summaryOpen = () => !!ui;
/** Opens the page; `field` opens that field's row, `drill` ({ fieldId, fieldLabel, label, items }) shows the studies behind one count (Details opens either). */
export function openSummary(templateId, { field = null, drill = null } = {}) { ui = { templateId, open: new Set(field ? [field] : []), all: new Set(), drill, page: 1, last: '', ctx: null, model: null, stale: new Set(), staleKey: '', eligible: 0, specEligible: null, off: null, el: null, queued: false, sig: '' }; }
export function closeSummary() { ui?.off?.(); ui = null; }
/** Back: from a list to the summary, from the summary to the table. Returns false when it left the page. */
export function summaryBack() { if (ui?.drill) { ui.drill = null; ui.page = 1; return true; } ui = null; return false; }

const fieldTitle = f => (f.unit ? `${f.label} (${f.unit})` : f.label);
const idOf = cell => cell.slice(0, cell.indexOf(':'));
const fieldIdOf = cell => cell.slice(cell.indexOf(':') + 1);

// The counts are recomputed when the project changes, not on every repaint of the page.
let memo = { key: '', out: null };
function summaryOf(model) {
  const key = `${getVersion()}|${model.templateId}`;
  if (memo.key !== key) {
    memo = { key, out: summarise({
      fields: model.cols.map(c => ({ id: c.id, label: c.label, type: c.type, options: c.options, allowed: c.allowed, unit: c.unit })),
      studies: model.all.map(p => ({ id: p.id, label: p.label })), values: model.st.values || {}, proposals: model.st.proposals || {}, mappings: model.st.extractionSummary?.fields || {} }) };
  }
  return memo.out;
}

/** The title bar of the page: Back, the name, the counts, Normalise (Stop while it runs) and More (Review data, Export). `run` holds the handlers: back, export. */
export function summarySpec({ studies = 0, fields = 0, listed = null } = {}, run = {}) {
  const running = normaliseRunning();
  const status = running ? runningText() : ui?.drill ? plural(listed ?? ui.drill.items.length, 'study', 'studies') : statusText({ studyCount: studies, fields: { length: fields } });
  if (ui) ui.specEligible = ui.eligible;
  const nothing = !ui?.eligible;
  // Normalise and Stop share the slot and its width, as Fill and Stop do: a run that starts or ends moves nothing
  const act = running ? { id: 'es-stop', label: 'Stop', icon: 'stop', role: 'secondary', labelCh: 8, dynamic: true, run: () => stopNormalise() }
    : { id: 'es-normalise', label: 'Normalise', icon: 'classify', role: 'secondary', labelCh: 8, dynamic: true, disabled: nothing, attrs: { 'aria-haspopup': 'dialog', ...(nothing ? { title: 'Every value is already counted or grouped' } : {}) },
      run: () => { if (ui?.ctx) startNormalise(ui.ctx, ui.model, () => ui?.ctx.rerender()); } };
  return { title: 'Data summary', back: { label: ui?.drill ? 'Back to summary' : 'Back to Extraction', run: run.back || (() => {}) },
    status: { text: status, ch: 24 }, actions: ui?.drill ? [] : [act],
    // Review data is a secondary: its local step is free and runs at once, its model step asks first (./extraction-review.mjs); it shares the page's one Stop
    overflow: [{ id: 'es-review', label: 'Review data', disabled: running || !studies, run: () => { if (ui?.ctx) startReview(ui.ctx, ui.model, () => ui?.ctx.rerender()); } },
      { id: 'es-export', label: 'Export…', run: run.export || (() => {}) }] };
}
/** Export's menu: the counts as the page shows them. */
export function summaryExport(anchor, model) {
  showMenu(anchor, [{ label: 'Counts · CSV', icon: 'table', run: () => downloadCsv(csvRows(summaryOf(model)), `${String(model.name || 'extraction').toLowerCase().replace(/\W+/g, '-')}-summary.csv`) }]);
}

// ---- what a study's cell shows --------------------------------------------------------------------------------------------------------

const shown = v => (!v ? '' : v.availability === 'not_found' ? 'Not reported' : String(v.reported_value ?? v.normalized_value ?? '').trim());
/** The paper and where in it, as Details opens it (views/evidence.mjs): a file by its locator, a text or figure by page and region. */
function openEvidence(ctx, paperId, e) {
  if (e.kind === 'file') ctx.openDocument(paperId, { file: e.path, locator: e.locator, quote: e.quote });
  else ctx.openDocument(e.doc_id || paperId, { page: e.page, rects: e.rects || [], quote: e.quote || '', kind: e.kind, region: e.region || null });
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------------

function drillRow(model, it, n) {
  const p = model.byId.get(it.paperId), v = (model.st.values || {})[it.cell], label = p?.label || p?.title || 'Untitled';
  const text = it.text ?? shown(v), anchors = anchorsOf(v);
  // the source is a column of its own (the first place the value was read; the rest are in More): a study with none says so in the same slot
  const src = anchors.length ? uiLink({ label: anchors[0].name, title: 'Open the paper here', attrs: { 'data-es-anchor': `${it.cell}#${anchors[0].k}` } })
    : `<button type="button" class="ui-link link" disabled>No source</button>`;
  return uiRow({ attrs: { 'data-es-row': it.cell },
    main: { html: `<span${p?.title && p.title !== p.label ? ` title="${esc(p.title)}"` : ''}>${esc(label)}</span>`, detail: [text ? esc(text) : ''], wrap: true },
    cells: [{ col: 'src', kind: 'control', html: src }],
    end: uiRowEnd({ primary: { id: `es-open-${n}`, label: 'Open cell', attrs: { 'data-es-cell': it.cell } }, more: { label: `More for ${label}`, attrs: { 'data-es-more': it.cell } } }) });
}
/** The places a value was read, as { name, k }: the evidence items that have a label (a page, a figure, a file and its place). */
const anchorsOf = v => (v?.evidence || []).map((e, k) => ({ e, k, name: evidenceLabel(e) })).filter(a => a.name);

function drillHtml(model) {
  const d = ui.drill, pg = pageOf(d.items, ui.page, PAGE_SIZE), title = `${d.fieldLabel}: ${d.label}`;
  return `${countHeading({ title, count: num(d.items.length), countLabel: 'Studies' })}
    ${uiList({ id: 'es-drill', label: `Studies: ${title}`, cols: ['src'], rows: pg.items.map((it, i) => drillRow(model, it, (pg.page - 1) * PAGE_SIZE + i)), empty: emptyState({ title: 'No studies', size: 'inline' }) })}
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
    cells: [{ col: 'pct', kind: 'visual', html: pct }, { col: 'count', kind: 'control', html: link(n, label, items) }], end: extra.end ?? reserve() });
  const cellsOf = list => list.map(s => ({ paperId: s.paperId, cell: s.cell }));
  const out = [];
  if (env.stale) out.push(uiNotice({ id: `es-stale-${i}`, label: 'Grouping out of date', text: 'The field definition changed after this grouping was approved.', actions: [{ id: `es-keep-${i}`, label: 'Keep grouping', attrs: { 'data-es-keep': f.id } }] }));
  if (env.proposal) out.push(proposalHtml(f, i, env.proposal, env.model));
  const groupedLine = grouped ? `Grouping: ${plural(cats, 'category', 'categories')}, ${plural(Object.keys(mapping.cells || {}).length, 'text')}` : '';
  out.push(uiList({ id: `es-${i}-read`, label: `How ${title} was read`, rows: [uiRow({ main: { html: esc(KIND_WORDS[f.kind]), detail: [esc(digest(f)), esc(f.reason), ...(groupedLine ? [esc(groupedLine)] : [])], wrap: true },
    ...(grouped ? { end: uiRowEnd({ more: { label: `More for the grouping of ${title}`, attrs: { 'data-es-fmore': f.id } } }) } : {}) })] }));

  if (f.kind === 'numeric' && f.numeric?.n) {
    out.push(uiList({ id: `es-${i}-stats`, label: `Numbers of ${title}`, cols: ['value'], rows: numericRows(f).map(([k, v]) => uiRow({ main: { html: esc(k) }, cells: [{ col: 'value', kind: 'visual', html: esc(v) }], end: reserve() })) }));
  }
  const states = stateRows(f).map(s => counted(s.label, s.n, percent(s.n, f.studyCount), cellsOf(s.studies)));
  if (f.kind === 'numeric') {
    const d = f.numeric;
    // text a number field holds that is not a number comes first: it is the cell to look at
    if (d.unparsed.length) states.unshift(counted('Not numeric', d.unparsed.length, '', d.unparsed.map(u => ({ paperId: u.paperId, cell: u.cell, text: u.text }))));
    if (d.n) states.push(counted('Numbers, lowest first', d.n, '', [...d.values].sort((a, b) => a.value - b.value).map(x => ({ paperId: x.paperId, cell: x.cell, text: fmt(x.value) }))));
  }
  // a field that names its studies (lib/extraction-summary.mjs identifierOf) is only counted as filled: its states when some study lacks it, no levels
  if (f.kind === 'label' && has === f.studyCount) return out.join('');
  out.push(countHeading({ title: `Percentages of all ${plural(f.studyCount, 'study', 'studies')}`, count: '' }));
  out.push(uiList({ id: `es-${i}-states`, label: `Studies by state, ${title}`, cols: ['pct', 'count'], rows: states }));

  if (f.kind !== 'numeric' && f.kind !== 'label') {
    const levels = levelRows(f), every = ui.all.has(f.id), shownLevels = every ? levels : levels.slice(0, LEVELS_SHOWN);
    const rows = shownLevels.flatMap(l => [counted(l.label, l.n, l.pct, cellsOf(l.studies), { end: endOf(l.key, l.label) }), ...(l.sub || []).map(s => counted(s.label, s.n, s.pct, cellsOf(s.studies), { depth: 1, end: endOf(null, s.label) }))]);
    const leftover = (label) => counted(label, f.residual.cells, '', f.residual.items.flatMap(r => r.cells.map(c => ({ paperId: idOf(c), cell: c }))), { end: endOf(null, label) });
    if (f.residual.items.length && f.kind !== 'free') rows.push(leftover('Not grouped'));
    if (f.kind === 'free' && f.residual.items.length) rows.push(leftover(levels.length ? 'Not grouped' : plural(f.residual.items.length, 'distinct text')));
    if (rows.length) {
      out.push(countHeading({ title: has ? `Percentages of the ${plural(has, 'study', 'studies')} with a value` : 'Levels', count: '' }));
      out.push(uiList({ id: `es-${i}-levels`, label: `Levels of ${title}`, cols: ['pct', 'count'], rows }));
      if (!every && levels.length > LEVELS_SHOWN) out.push(uiLink({ label: `Show all ${num(levels.length)} levels`, attrs: { 'data-es-all': f.id } }));
    }
  }
  return out.join('');
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
  return notices + summary.fields.map((f, i) => disclosure({ id: `es-f-${i}`, title: fieldTitle(f), count: closedCount(f), open: ui.open.has(f.id),
    body: ui.open.has(f.id) ? fieldBody(f, i, reg, envOf(f, model, proposals)) : '', attrs: { 'data-es-field': f.id, 'data-es-i': String(i) } })).join('');
}

/** The sub-page under Extraction's title bar. `model`: { templateId, name, st, cols, all, focus(paperId, columnId) }. `ctx.rerender` repaints the page and its title bar. */
export function renderSummary(el, ctx, model) {
  if (!ui) { ctx.rerender(); return; }
  model = { ...model, byId: new Map(model.all.map(p => [p.id, p])) };
  ui.ctx = ctx; ui.model = model; 
  if (!model.all.length) { el.innerHTML = `<div class="es-page">${emptyState({ icon: 'extraction', title: 'No studies yet', size: 'inline' })}</div>`; return; }
  const summary = summaryOf(model), reg = { drills: new Map(), cats: new Map() }, mappings = model.st.extractionSummary?.fields || {};
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
    wirePager(el, 'es-pager', n => { ui.page = n; draw(); });
    // a field opens: its body is drawn when it first opens (52 fields are 52 rows until then)
    page.addEventListener('toggle', e => {
      const d = e.target.closest?.('details[data-es-field]'); if (!d || ui.drill) return;
      const f = summary.fields[+d.dataset.esI];
      if (d.open) { ui.open.add(f.id); const body = d.querySelector('.ui-disclosure-body'); if (body && !body.firstElementChild) body.innerHTML = fieldBody(f, +d.dataset.esI, reg, envOf(f, model, proposalsByField())); }
      else ui.open.delete(f.id);
    }, true);
    page.addEventListener('click', e => {
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

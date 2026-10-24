// Fill: the one way Extraction asks a model for values (Extraction redesign §1.5). The title bar's primary opens a popover under itself:
// what to fill, for which studies, with which model and within which limits, and what that comes to before anything runs. A run then
// shows in three places that already exist: the title bar's message and the status bar's job (one progress idiom), the grid (proposals
// arrive as dotted cells) and the inspector's Run section (its steps). When it ends, one notice under the tools row says what came of it.
//
// Every table fill goes through the batch (views/batch-control.mjs, lib/extract-batch.mjs): one study or all of them, it plans what is
// empty, checks what the model proposes against the table's rules and records a report. Re-checking imported proposals reads each
// study again (lib/agent.mjs runVerify); From abstracts reads the abstracts and proposes what they state.
import { get, projects } from '../store.mjs';
import { runVerify, stopRun } from '../lib/agent.mjs';
import { configured, cachedModels, listModelsDetailed, modelInfo, shortModel } from '../lib/ai.mjs';
import { modelFor, settings } from '../lib/model-settings.mjs';
import { run as runJob, running as runningJobs, cancel as cancelJob } from '../lib/jobs.mjs';
import { dryRun, PATIENT_EXTRACT } from '../lib/extract-batch.mjs';
import { EXTRACT } from '../lib/prompts.mjs';
import { startBatch, stopBatch, runningIds, resumableBatch, resumeBatch, batchSetup } from './batch-control.mjs';
import { pendingStudies, propose } from '../lib/proposals.mjs';
import { extractFromAbstract } from '../lib/helpers.mjs';
import { visibleViews } from '../lib/workflow.mjs';
import { formField } from '../lib/ui-components.mjs';
import { dialogFoot, uiNotice } from '../lib/ui-actions.mjs';
import { closeMenu, onMenuOpen, placeMenu } from '../lib/menu.mjs';
import { countInput, budgetNumber } from '../lib/chat-budget.mjs';
import { esc } from '../lib/html.mjs';
import { plural, num } from '../lib/dates.mjs';
import { runLog, wireRunLog, appendStep, usageLine } from './runs.mjs';

const VERB = { fill: 'Filling', verify: 'Re-checking', abstracts: 'Reading abstracts' };
const POP_W = 380;   // the dialog recipe's text tier: three fields and a foot

/**
 * The run of this page, kept outside it: a run repaints the page as it goes. `report` is what the last one came to (the notice) until the
 * person dismisses it; `steps` are its log (the inspector).
 */
export const fillRun = { running: false, kind: '', templateId: null, done: 0, total: 0, current: '', model: '', steps: [], usage: '', report: null, stop: null };

/** The title bar's message while a run goes: "Filling · 12 of 41 · Lund 2023". */
export const fillMessage = () => fillRun.running ? [VERB[fillRun.kind] || 'Filling', fillRun.total ? `${num(fillRun.done)} of ${num(fillRun.total)}` : '', fillRun.current].filter(Boolean).join(', ') : '';

// ---- the popover's choices --------------------------------------------------------------------------------------------

/** The models to choose from, as [id, label]: the provider's list when it is known, the configured model first when it is not listed. */
export function fillModels(cfg, selected) {
  let rows = [];
  try { rows = cachedModels(cfg) || []; } catch {}
  if (selected && !rows.some(r => r.id === selected)) rows = [{ id: selected, promptPrice: null }, ...rows];
  return rows.map(r => [r.id, r.promptPrice != null ? `${shortModel(r.id)} ($${r.promptPrice} per M tokens)` : shortModel(r.id)]);
}

/** The run a choice asks for, before anything runs: { papers, line, run } where `line` is the popover's start message. */
export function fillPlan({ what, scope, model, budget, templateId, sel, shownIds, state = get(), cfg = modelFor('fill') }) {
  if (what === 'pending') {
    const ids = [...pendingStudies(templateId).imported].filter(id => state.papers.find(p => p.id === id)?.pdf);
    return { papers: ids.length, ids, line: ids.length ? `${plural(ids.length, 'study', 'studies')} to re-check` : 'No imported proposals to re-check' };
  }
  const mode = what === 'patients' ? 'patients' : 'cells';
  const opts = { mode, templateId, ...(what === 'study' ? { scope: 'selected', paperIds: [sel?.paperId] } : scope === 'shown' ? { scope: 'selected', paperIds: shownIds } : { scope }) };
  const d = dryRun(opts, { state, budget, cheapModel: model });
  if (!d.papers) return { papers: 0, opts, line: d.skipped.noPdf ? `${plural(d.skipped.noPdf, 'study', 'studies')} without a PDF` : 'Nothing left to fill' };
  // the most it can cost: every study spending its whole token budget at the dearer of the model's two listed prices
  const info = configured(cfg) ? modelInfo(cfg, model) : {};
  const price = Math.max(info.promptPrice ?? -1, info.completionPrice ?? -1);
  const most = price >= 0 ? d.papers * (budget.tokens || 0) * price / 1e6 : null;
  return { papers: d.papers, opts, line: [plural(d.papers, 'study', 'studies'), mode === 'cells' ? plural(d.cells, 'cell') : '', most != null ? `at most $${most < 10 ? most.toFixed(2) : Math.round(most)}` : ''].filter(Boolean).join(', ') };
}

/** The popover's markup: three stacked choices, the two limits side by side, a foot whose start is what the choice comes to. */
export function fillHtml({ whats, what, scopes, scope, models, model, calls, tokens, line, canStart, studyFixed }) {
  const select = (id, label, options, value, disabled = false) => formField(label, `<select id="${id}" name="${id}"${disabled ? ' disabled' : ''}>${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}${v === model && id === 'fp-model' ? ` title="${esc(v)}"` : ''}>${esc(l)}</option>`).join('')}</select>`);
  return `<form class="ext-fill-form" aria-label="Fill">
    ${select('fp-what', 'Fill', whats, what)}
    ${select('fp-scope', 'Studies', scopes, scope, studyFixed)}
    ${select('fp-model', 'Model', models, model)}
    <div class="ext-fill-limits">${formField('Tool calls per study', countInput('calls', calls))}${formField('Tokens per study', countInput('tokens', tokens))}</div>
    ${dialogFoot({ label: 'Start the run', id: 'fp-foot', start: [{ message: line, id: 'fp-line' }],
      actions: [{ id: 'fp-start', label: 'Start', icon: 'run', role: 'primary', type: 'submit', disabled: !canStart }] })}</form>`;
}

let active = null;
const choice = { what: 'empty', scope: 'included', model: '' };
/** What the popover offers first the next time it opens (Overview's Fill of one study: 'study'). */
export const presetFill = what => { choice.what = what; };
export function closeFill({ focus = false } = {}) { active?.close(focus); }
onMenuOpen(() => closeFill());

/**
 * Opens the popover under `anchor` (the title bar's Fill). `page` is the table as the page shows it: { templateId, sel, shownIds, all }.
 * A second press closes it; Escape and a press outside close it.
 */
export function openFill(anchor, ctx, page) {
  if (active?.anchor === anchor) { closeFill({ focus: true }); return; }
  closeFill(); closeMenu();
  const cfg = modelFor('fill');
  // no model yet: connect one here, then Fill opens as it would have
  if (!configured(cfg)) { (ctx.connectModel || ctx.openModelSettings)?.().then(ok => { if (ok && configured(modelFor('fill')) && anchor.isConnected) openFill(anchor, ctx, page); }, err => ctx.say?.(err.message)); return; }
  const st = get(), s = settings();
  const studyOf = id => st.papers.find(p => p.id === id);
  const patients = visibleViews(st).includes('patients');
  const imported = pendingStudies(page.templateId).imported.size;
  const whats = [['empty', 'Empty cells'], ...(page.sel ? [['study', `One study: ${studyOf(page.sel.paperId)?.label || 'Selected'}`]] : []),
    ...(imported ? [['pending', 'Re-check imported proposals']] : []), ...(patients ? [['patients', 'Patient rows']] : [])];
  if (!whats.some(([v]) => v === choice.what)) choice.what = 'empty';
  const included = page.all.length, withPdf = st.papers.filter(p => p.pdf).length;
  const scopes = [['included', `Included (${num(included)})`], ['all', `All with a PDF (${num(withPdf)})`], ...(page.shownIds.length < included ? [['shown', `Shown (${num(page.shownIds.length)})`]] : [])];
  if (!scopes.some(([v]) => v === choice.scope)) choice.scope = 'included';
  if (!choice.model) choice.model = cfg.model;
  const limits = { calls: s.agent?.calls || 40, tokens: s.agent?.tokens || 150000 };
  const pop = document.createElement('div');
  pop.className = 'ext-fill-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Fill');
  const plan = () => fillPlan({ ...choice, budget: limits, templateId: page.templateId, sel: page.sel, shownIds: page.shownIds, cfg });
  const draw = () => {
    const p = plan();
    pop.innerHTML = fillHtml({ whats, what: choice.what, scopes, scope: choice.scope, models: fillModels(cfg, choice.model), model: choice.model, calls: limits.calls, tokens: limits.tokens,
      line: p.line, canStart: p.papers > 0, studyFixed: choice.what === 'study' || choice.what === 'pending' });
    wire();
  };
  // A change of choice redraws the start message in place; the fields keep their place, so nothing under the pointer moves.
  const refresh = () => { const p = plan(), line = pop.querySelector('#fp-line'); if (line) line.textContent = p.line; const go = pop.querySelector('#fp-start'); if (go) go.disabled = !(p.papers > 0); };
  const wire = () => {
    const form = pop.querySelector('form');
    form.elements['fp-what'].onchange = e => { choice.what = e.target.value; const sc = form.elements['fp-scope']; sc.disabled = choice.what === 'study' || choice.what === 'pending'; refresh(); };
    form.elements['fp-scope'].onchange = e => { choice.scope = e.target.value; refresh(); };
    form.elements['fp-model'].onchange = e => { choice.model = e.target.value; e.target.title = e.target.value; refresh(); };
    for (const k of ['calls', 'tokens']) form.elements[k].oninput = e => { const n = budgetNumber(e.target.value); if (Number.isFinite(n) && n > 0) { limits[k] = n; refresh(); } };
    form.onsubmit = async e => {
      e.preventDefault();
      const p = plan(); if (!(p.papers > 0)) return;
      close(true);
      // the shared run preview: where the studies' text goes, with which model(s), under which limits, before anything is sent
      const preview = await import('../lib/run-preview.mjs'), strong = batchSetup()?.strong?.cfg;
      if (!await preview.confirmRun({ title: 'Start the fill?', confirm: 'Start', cfgs: [{ ...cfg, model: choice.model }, ...(strong ? [strong] : [])], items: { n: p.papers, noun: 'study', nouns: 'studies' },
        classes: preview.promptSends(choice.what === 'patients' ? PATIENT_EXTRACT : EXTRACT), budget: { ...limits, per: 'study' } })) return;
      startFill(ctx, { what: choice.what, model: choice.model, budget: { ...limits }, templateId: page.templateId, plan: p });
    };
  };
  const events = new AbortController(), on = { signal: events.signal };
  const close = (focus = false) => {
    if (active?.pop !== pop) return;
    active = null; events.abort(); pop.remove(); anchor.setAttribute('aria-expanded', 'false');
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  active = { anchor, pop, close };
  draw();
  document.body.append(pop);
  anchor.setAttribute('aria-expanded', 'true');
  // Under Fill, its end edge at Fill's and inside the window (above it when there is no room below); CSS keeps it in the window.
  const r = anchor.getBoundingClientRect(), at = placeMenu(r, pop.offsetHeight);
  pop.style.left = `max(8px, min(${r.right - POP_W}px, calc(100vw - 8px - min(${POP_W}px, 100vw - 16px))))`;
  pop.style.top = `${at.top + (at.top >= r.bottom ? 4 : -4)}px`;
  if (at.maxHeight != null) pop.style.maxHeight = `${at.maxHeight}px`;
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
  document.addEventListener('pointerdown', e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); }, { ...on, capture: true });
  addEventListener('blur', () => close(), on);
  pop.querySelector('#fp-what')?.focus({ preventScroll: true });
  // the provider's list, when it is stale, comes in while the popover is open: only the model options are redrawn
  listModelsDetailed(cfg).then(() => {
    const m = active?.pop === pop && pop.querySelector('#fp-model'); if (!m) return;
    m.innerHTML = fillModels(cfg, choice.model).map(([v, l]) => `<option value="${esc(v)}"${v === choice.model ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }).catch(() => {});
}

// ---- the run ------------------------------------------------------------------------------------------------------------

const paperLabel = id => get().papers.find(p => p.id === id)?.label || '';
function begin(ctx, kind, { templateId, total, model }) {
  Object.assign(fillRun, { running: true, kind, templateId, done: 0, total, current: '', model, steps: [], usage: '', report: null, stop: null });
  ctx.rerender();
}
/** A step of a model run: the log on show takes it, the message names the study being read. */
function stepOf(ctx) {
  return (st, runId) => {
    fillRun.steps.push(st); if (fillRun.steps.length > 400) fillRun.steps.splice(0, fillRun.steps.length - 400);
    const r = (get().runs || []).find(x => x.id === runId);
    if (r) { fillRun.current = paperLabel(r.paper_id); fillRun.usage = usageLine(r.usage); }
    appendStep(st); ctx.say?.(fillMessage());
  };
}
function end(ctx, report) {
  Object.assign(fillRun, { running: false, current: '', stop: null, report });
  ctx.rerender(); ctx.refreshCounts?.();
}

/** A batch's report as the notice reads it: `papers` the studies read to the end, `total` the studies planned (a stopped batch counts the
 *  studies it stopped part way as ended, which would say "Stopped at 4 of 4" for a run stopped before its model answered). */
const fillReport = report => report && { ...report, kind: 'fill', total: report.papers,
  papers: report.stopped ? (report.runs || []).filter(x => x.tier === 'cheap' && x.status === 'done').length : report.papers };

/** Starts what the popover chose. The grid shows each study's proposals as soon as its run ends. */
export async function startFill(ctx, { what, model, budget, templateId, plan }) {
  if (fillRun.running) return;
  if (what === 'pending') return verifyAll(ctx, { ids: plan.ids, model, budget, templateId });
  begin(ctx, 'fill', { templateId, total: plan.papers, model });
  fillRun.stop = stopBatch;
  const report = await startBatch(null, { ...plan.opts, model, budget, onStep: stepOf(ctx),
    onCount: (done, total) => { fillRun.done = done; fillRun.total = total; ctx.rerender(); } });
  end(ctx, report ? fillReport(report) : { kind: 'fill', failed: true, papers: fillRun.done, total: fillRun.total });
}

/** Imported proposals read again against each study's PDF, a study at a time (at most four at once). */
async function verifyAll(ctx, { ids, model, budget, templateId }) {
  const cfg = modelFor('fill'), parallel = Math.max(1, Math.min(4, settings().agent?.parallel || 1));
  begin(ctx, 'verify', { templateId, total: ids.length, model });
  fillRun.stop = () => { for (const j of runningJobs()) if (j.kind === 'agent') cancelJob(j.id); for (const id of runningIds) stopRun(id); };
  let failed = false;
  try {
    await runJob('agent', `Re-check ${plural(ids.length, 'study', 'studies')}`, async h => {
      const queue = [...ids]; let n = 0;
      await Promise.all(Array.from({ length: parallel }, async () => {
        while (queue.length && !h.stopped()) {
          const paperId = queue.shift(); fillRun.current = paperLabel(paperId);
          const r = await runVerify({ paperId, templateId, cfg, model, budget, onStep: stepOf(ctx), onRunStart: id => runningIds.add(id) });
          runningIds.delete(r.id); fillRun.done = ++n; h.count(n, ids.length); ctx.rerender();
        }
      }));
      return { runs: n };
    });
  } catch { failed = true; }
  end(ctx, { kind: 'verify', papers: fillRun.done, total: ids.length, stopped: fillRun.done < ids.length, failed });
}

/**
 * From abstracts: what each abstract states, as proposals with the phrase they came from. They wait in the grid like any other
 * proposal; a value already held or proposed is left alone.
 */
export async function fillAbstracts(ctx, { papers, columns, templateId = 'default' }) {
  if (fillRun.running) return;
  const cfg = modelFor('extract'), st = get();
  const has = (p, c) => st.values?.[`${p.id}:${c.id}`] || st.proposals?.[`${p.id}:${c.id}`];
  const targets = papers.filter(p => p.abstract && columns.some(c => !has(p, c)));
  if (!targets.length) { ctx.say?.('No abstracts with empty cells'); return; }
  const controller = new AbortController(), project = projects().current;
  begin(ctx, 'abstracts', { templateId, total: targets.length, model: cfg.model });
  fillRun.stop = () => controller.abort();
  let proposed = 0, failed = 0;
  for (const p of targets) {
    // another project opened: nothing read here is written there
    if (projects().current !== project) controller.abort();
    if (controller.signal.aborted) break;
    fillRun.current = p.label || ''; ctx.say?.(fillMessage());
    try {
      const found = await extractFromAbstract(p, columns, cfg, { signal: controller.signal });
      if (projects().current !== project) break;
      for (const x of found) {
        const c = columns.find(f => f.id === x.field);
        if (!c || has(p, c)) continue;
        propose(p.id, { column_id: c.id, value: x.value, normalized_value: x.value, availability: 'present', evidence: [{ kind: 'abstract', quote: x.quote }],
          rationale: `From the abstract: “${x.quote}”`, origin: 'model', mode: 'fill', model: cfg.model, run_id: null });
        proposed++;
      }
    } catch (err) {
      if (controller.signal.aborted) break;
      failed++;
      if (/\b(?:401|403|404|429)\b|No model|quota|authentication|rate limit/i.test(String(err?.message || err))) break;
    }
    fillRun.done++; ctx.rerender();
  }
  end(ctx, { kind: 'abstracts', papers: fillRun.done, total: targets.length, proposed, failedCount: failed, stopped: controller.signal.aborted });
}

/** Stop: the run under way ends after the step it is in. */
export function stopFill() { fillRun.stop?.(); }

// ---- what a run came to -------------------------------------------------------------------------------------------------

/** The notice's sentence for the last run, or '' when there is none to show. */
export function summaryText(r = fillRun.report) {
  if (!r) return '';
  if (r.failed) return r.papers ? `Stopped with an error after ${plural(r.papers, 'study', 'studies')}` : 'The run did not start';
  if (r.kind === 'verify') return `${plural(r.papers, 'study', 'studies')} re-checked${r.stopped ? ` of ${num(r.total)}` : ''}`;
  if (r.kind === 'abstracts') return `${plural(r.papers, 'abstract')} read, ${plural(r.proposed, 'value')} proposed${r.failedCount ? `, ${num(r.failedCount)} failed` : ''}`;
  if (r.stopped) return `Stopped at ${num(r.papers)} of ${num(r.total || r.papers)}, ${plural(r.cells, 'value')} proposed`;
  return `${plural(r.papers, 'study', 'studies')} read; ${plural(r.cells, 'value')} proposed, ${num(r.clean)} clean${r.errors?.length ? `; ${num(r.errors.length)} failed` : ''}`;
}

/** The notice under the tools row: what the last run came to, and what to do with it. */
export function summaryHtml({ clean = 0, pending = 0 } = {}) {
  const text = summaryText(); if (!text) return '';
  const r = fillRun.report, resume = r.kind === 'fill' && r.stopped && resumableBatch();
  // two acts at most: take the run up again, or accept what is clean; then review what waits. Dismiss is the notice's own.
  return uiNotice({ id: 'ext-run-summary', label: 'Run summary', text, dismissible: true, actions: [
    ...(resume ? [{ id: 'ext-run-resume', label: 'Resume', icon: 'run' }] : clean ? [{ id: 'ext-run-accept', label: 'Accept clean', icon: 'check' }] : []),
    ...(pending ? [{ id: 'ext-run-review', label: 'Review', icon: 'checklist' }] : [])] });
}

/** Binds the notice's acts; `review` selects the first pending cell, `accept` is the counted Accept clean cells. */
export function wireSummary(el, ctx, { review, accept }) {
  el.querySelector('#ext-run-summary-dismiss')?.addEventListener('click', () => { fillRun.report = null; ctx.rerender(); });
  el.querySelector('#ext-run-review')?.addEventListener('click', () => review());
  el.querySelector('#ext-run-accept')?.addEventListener('click', () => accept());
  el.querySelector('#ext-run-resume')?.addEventListener('click', () => {
    Object.assign(fillRun, { report: null }); begin(ctx, 'fill', { templateId: fillRun.templateId, total: resumableBatch()?.left || 0, model: fillRun.model });
    fillRun.stop = stopBatch;
    resumeBatch(null)?.then(report => end(ctx, fillReport(report)));
  });
}

/** The inspector's Run section, when no cell is selected: the run's steps and usage, then the table's earlier runs. */
export function runSection(ctx, templateId) {
  const own = fillRun.templateId === templateId;
  const steps = own ? fillRun.steps : [];
  const body = runLog({ steps, usage: own ? fillRun.usage : '', templateId });
  if (!body.trim()) return null;
  const meta = fillRun.running && own ? [fillMessage(), shortModel(fillRun.model)].filter(Boolean).join(', ') : own && fillRun.report ? summaryText() : '';
  return { title: 'Run', meta, html: body, wire: host => wireRunLog(host, ctx, templateId) };
}

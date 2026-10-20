import { REGISTRY } from './registry.mjs';
import { get, projectGeneration } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { disclosure, tableRegion, sentenceLabel } from '../lib/ui-components.mjs';
import { saveFile } from '../lib/save.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { analysisRunGuard } from '../lib/analysis-run-guard.mjs';
import { readinessAct, readinessSection, readinessStatus } from './analysis-readiness.mjs';
import { ADVANCED_METHODS, advancedMethod, advancedSources, advancedColumns, advancedLevels,
  advancedSnapshot, advancedInputStatus, prepareAdvanced, runAdvanced, keepAdvanced, removeAdvanced, advancedCsv } from '../lib/advanced-primary.mjs';

export const meta = { title: 'Advanced analysis', icon: 'advanced' };
export const count = (...a) => REGISTRY.advancedAnalysis.count(...a);
let project = null, ui = null;
function settings(s) {
  const key = projectGeneration();
  if (!ui || project !== key) { project = key; ui = { source: '', kind: 'repeated', inputs: {}, options: {}, entry: null }; }
  return ui;
}
const value = x => typeof x === 'number' ? (Number.isFinite(x) ? (Math.abs(x) < .001 && x !== 0 ? x.toExponential(3) : Number(x.toPrecision(6)).toString()) : '—') : x == null ? '—' : String(x);
const filename = x => String(x || 'analysis').replace(/[^\w.-]+/g, '_').slice(0, 70);
const select = (key, label, cols, selected, optional = false) => `<label class="field"><span>${esc(label)}</span><select data-in="${key}" aria-label="${esc(label)}"><option value="">${optional ? 'None' : 'Choose'}</option>${selected && !cols.some(c => c.id === selected) ? `<option value="${esc(selected)}" selected disabled>Unavailable: ${esc(selected)}</option>` : ''}${cols.map(c => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.label || c.name || c.id)}</option>`).join('')}</select></label>`;
const choices = (key, label, vals, selected) => `<label class="field"><span>${esc(label)}</span><select data-option="${key}" aria-label="${esc(label)}"><option value="">Choose</option>${vals.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;

/**
 * The analysis as configured: its source, the categorical predictors whose reference level it fills in, and the population the method
 * would use, or why it cannot run. The title bar (page) and the form (render) read the same.
 */
function configured(s) {
  const st = settings(s), sources = advancedSources(s);
  if (!sources.some(d => d.id === st.source)) st.source = sources[0]?.id || '';
  const d = sources.find(x => x.id === st.source);
  if (!d) return { st, sources, d };
  const i = st.inputs, o = st.options;
  const references = (i.predictors || []).map(id => d.columns.find(c => c.id === id)).filter(c => c && !['number', 'integer'].includes(c.type));
  if (references.length) o.refs ||= {};
  for (const c of references) if (!o.refs[c.id]) o.refs[c.id] = advancedLevels(d, c.id)[0];
  let population, rejectedPopulation, error = '';
  try { population = prepareAdvanced(d, st.kind, i, o).population; } catch (err) { error = err.message; rejectedPopulation = err.population; }
  return { st, sources, d, references, population, rejectedPopulation, error };
}
// Run and keep is the title bar's: the page drawn last binds what it runs (and the shell's context Check readiness repaints with).
const acts = {};
// The analysis as configured, as the readiness check and a frozen proposal read it (views/analysis-readiness.mjs).
const readinessArgs = () => { const { st } = configured(get()); return { datasetId: st.source, method: st.kind, inputs: structuredClone(st.inputs), options: structuredClone(st.options) }; };
const readinessKey = st => `advanced:${st.source}`;

/**
 * The page's head is the title bar: Check readiness and Run and keep, and beside the title the readiness verdict once checked, else the
 * observations it would use, or that it cannot run yet.
 */
export function page(rerender) {
  const { st, d, population, error } = configured(get());
  if (!d) return { title: 'Advanced analysis', actions: [] };
  return { title: 'Advanced analysis',
    status: (!st.pending && readinessStatus(readinessKey(st), readinessArgs)) || { text: st.pending ? 'Running' : error || st.error ? 'Not ready' : `${population.used} used · ${population.dropped} excluded`, ch: 24 },
    actions: [readinessAct(readinessKey(st), readinessArgs, { after: () => { rerender?.(); acts.ctx?.showDetails?.(); }, say: rerender }), { id: 'advanced-run', label: 'Run and keep', icon: 'run', role: 'primary', disabled: !!(error || st.pending), run: btn => acts.run?.(btn) }] };
}

/** Details: the readiness of the analysis as configured. */
export function inspect(ctx) {
  const { st, d } = configured(get());
  return d ? [readinessSection(readinessKey(st), readinessArgs, ctx)] : [];
}

export function render(el, ctx) {
  acts.ctx = ctx;
  const s = get(), { st, sources, d, references, rejectedPopulation, error } = configured(s), m = advancedMethod(st.kind);
  if (!d) { el.innerHTML = emptyState({ icon: 'advanced', title: 'No dataset or patient data', actions: [{ id: 'advanced-to-data', label: 'Open datasets', icon: 'dataset', primary: true }] }); el.querySelector('#advanced-to-data').onclick = () => ctx.go('datasets'); return; }
  const i = st.inputs, o = st.options, nums = advancedColumns(d, 'number'), cats = advancedColumns(d, 'category');
  const paired = Boolean(m.timeCategorical);
  const eventLevels = i.outcome ? advancedLevels(d, i.outcome) : [];
  const blocked = new Set(['outcome', 'cluster', 'start', ...(st.kind === 'repeated' ? ['time'] : []), 'strata'].map(k => i[k]).filter(Boolean));
  const predictors = cats.filter(c => !blocked.has(c.id));
  let form = select('outcome', st.kind === 'competing' || st.kind === 'recurrent' ? 'Event status' : 'Outcome', m.outcome === 'number' ? nums : cats, i.outcome);
  if (m.cluster) form += select('cluster', st.kind === 'repeated' ? 'Participant or cluster ID' : 'Participant ID', cats, i.cluster);
  if (m.start) form += select('start', 'Interval start', nums, i.start);
  if (m.time) form += select('time', paired ? 'Visit or time level' : st.kind === 'recurrent' ? 'Interval stop' : st.kind === 'repeated' ? 'Observation time' : 'Follow-up time', paired ? cats : nums, i.time);
  if (m.group) form += select('group', paired ? 'Between-subject group' : 'Group curves by', cats, i.group, true);
  if (m.strata) form += select('strata', 'Baseline-hazard strata', cats, i.strata, true);
  // the predictors are a group of choices: one field that spans the form, between the columns above and the options below
  const predictorGroup = m.predictors ? `<div class="field ui-field advanced-predictors" role="group" aria-labelledby="advanced-predictors-label"><span id="advanced-predictors-label">${st.kind === 'repeated' ? 'Additional predictors' : 'Predictors'}</span><div class="an-checks">${predictors.map(c => `<label class="cr-check"><input type="checkbox" data-predictor="${esc(c.id)}"${(i.predictors || []).includes(c.id) ? ' checked' : ''}><span>${esc(c.label || c.id)}</span></label>`).join('')}</div></div>` : '';
  let options = '';
  options += references.map(c => { const levels = advancedLevels(d, c.id), selected = o.refs[c.id]; return `<label class="field"><span>Reference, ${esc(c.label || c.id)}</span><select data-ref="${esc(c.id)}" aria-label="Reference level of ${esc(c.label || c.id)}">${selected && !levels.includes(selected) ? `<option selected disabled value="${esc(selected)}">Unavailable: ${esc(selected)}</option>` : ''}${levels.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`; }).join('');
  if (st.kind === 'repeated') options += `<label class="field"><span>Residual correlation</span><select data-option="correlation" aria-label="Residual correlation"><option value="independent"${o.correlation !== 'ar1' ? ' selected' : ''}>Independent</option><option value="ar1"${o.correlation === 'ar1' ? ' selected' : ''}>AR(1)</option></select></label>`;
  if (st.kind === 'ordinal') options += `<label class="field"><span>Outcome order, lowest to highest</span><textarea id="advanced-order" rows="3" aria-label="Outcome order, one level per line" placeholder="One observed level per line">${esc((o.order || []).join('\n'))}</textarea><span class="meta" data-ui-help>Observed levels: ${esc(eventLevels.join(' · ') || 'choose an outcome')}</span></label>`;
  if (st.kind === 'competing') options += choices('censorLevel', 'Censored level', eventLevels, o.censorLevel) + `<label class="field"><span>Report incidence at</span><input id="advanced-landmarks" aria-label="Incidence reporting times" value="${esc((o.landmarks || []).join(', '))}" placeholder="6, 12, 24"></label>`;
  if (st.kind === 'recurrent') options += choices('eventLevel', 'Event level', eventLevels, o.eventLevel);
  if (paired) {
    options += `<label class="field"><span>Time order</span><textarea id="advanced-time-order" rows="3" aria-label="Time order, one level per line" placeholder="One observed level per line">${esc((o.timeOrder || []).join('\n'))}</textarea><span class="meta" data-ui-help>Observed levels: ${esc(i.time ? advancedLevels(d, i.time).join(' · ') : 'choose a time column')}</span></label>`;
    if (i.group) options += `<label class="field"><span>Group order</span><textarea id="advanced-group-order" rows="3" aria-label="Group order, one level per line" placeholder="One observed level per line">${esc((o.groupOrder || []).join('\n'))}</textarea><span class="meta" data-ui-help>Observed groups: ${esc(advancedLevels(d, i.group).join(' · '))}</span></label>`;
    options += `<label class="field"><span>Post-hoc tests</span><select data-option="posthoc" aria-label="Paired post-hoc comparisons"><option value="bonferroni"${o.posthoc !== 'none' ? ' selected' : ''}>Paired tests · Bonferroni</option><option value="none"${o.posthoc === 'none' ? ' selected' : ''}>None</option></select></label>`;
    if (st.kind === 'rm-anova' && (o.timeOrder || []).length > 2) options += `<label class="field cr-check"><input type="checkbox" data-option="sphericityAssumed"${o.sphericityAssumed === true ? ' checked' : ''}><span>Use uncorrected tests (sphericity assumed)</span></label>`;
  }
  const actualOptions = () => st.options;
  const rejected = rejectedPopulation ? disclosure({ id: 'advanced-rejected', title: 'Rejected paired design', meta: `${rejectedPopulation.sourceRows} source rows`, body: tableRegion({ label: 'Paired design issues', html: `<table><thead><tr><th scope="col">Source row</th><th scope="col">Reason</th></tr></thead><tbody>${rejectedPopulation.excluded.slice(0,100).map(x => `<tr><td>${esc(x.rowId)}</td><td>${esc(x.reasons.join('; '))}</td></tr>`).join('')}</tbody></table>${rejectedPopulation.excluded.length > 100 ? '<p data-ui-help>The first 100 source rows are shown. No analysis is run or saved.</p>' : ''}` }) }) : '';
  const help = paired ? st.kind === 'rm-anova' ? 'Use a complete balanced participant × visit grid. Categorical visits and group interactions use uncorrected ANOVA; sphericity requires your assessment.' : 'Use complete paired visits. Friedman and paired signed-rank tests run within each group; no between-group comparison is computed.' : st.kind === 'recurrent' ? 'Use one row per disjoint risk interval. The event occurs at the stop time.' : st.kind === 'competing' ? 'Use one row per participant. Keep distinct first-event causes and the censored state.' : st.kind === 'repeated' ? 'Use one row per observation. Time is a numeric fixed effect; participants share a random intercept.' : 'Order every observed outcome level. Ratios describe the odds of a higher outcome.';
  const kept = (s.advancedAnalyses || []).filter(a => a.datasetId === d.id);
  const message = st.error || error || (st.pending ? 'Running analysis' : '');
  const keptName = a => a.result?.title || a.kind;
  el.innerHTML = `<div class="panel advanced-config" aria-busy="${st.pending ? 'true' : 'false'}">
    <div class="panel-body"><p class="meta" data-ui-help>${help}</p>
      <div class="an-settings"><label class="field"><span>Source</span><select id="advanced-source" aria-label="Analysis source">${sources.map(x => `<option value="${esc(x.id)}"${x.id === d.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>Method</span><select id="advanced-kind" aria-label="Advanced analysis method">${ADVANCED_METHODS.map(x => `<option value="${x.id}"${x.id === st.kind ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>${form}${predictorGroup}${options}</div>
      <p id="advanced-status" class="meta" role="status" aria-live="polite">${esc(message)}</p>${rejected}</div></div>
    <div id="advanced-result"></div>${kept.length ? `<div class="panel"><div class="panel-head"><h2>Kept analyses</h2></div><div class="panel-body tight">${tableRegion({ label: 'Kept analyses', html: `<table><thead><tr><th class="grow">Analysis</th><th>Data</th><th aria-label="Actions"></th></tr></thead><tbody>${kept.slice().reverse().map((a, n) => `<tr><td class="grow">${esc(keptName(a))}</td><td>${esc(sentenceLabel(advancedInputStatus(a, s)))}</td><td>${uiRowEnd({ inline: { id: `advanced-open-${n}`, label: `Open ${keptName(a)}`, icon: 'open', attrs: { 'data-open': a.id } }, more: { label: `More for ${keptName(a)}`, attrs: { 'data-more-kept': a.id } } })}</td></tr>`).join('')}</tbody></table>` })}</div></div>` : ''}`;
  const redraw = () => ctx.rerender();
  const redrawForm = () => rerenderForm(el, ctx, { fallback: '#advanced-source' });
  const change = () => { st.entry = null; st.error = ''; redrawForm(); };
  for (const control of el.querySelectorAll('[data-in],[data-predictor],[data-option],[data-ref]')) control.setAttribute('data-form-key', Object.entries(control.dataset).map(([key, val]) => key + ':' + val).join('|'));
  el.querySelector('#advanced-source').onchange = e => { Object.assign(st, { source: e.target.value, inputs: {}, options: {}, entry: null, error: '' }); redrawForm(); };
  el.querySelector('#advanced-kind').onchange = e => { Object.assign(st, { kind: e.target.value, inputs: {}, options: {}, entry: null, error: '' }); redrawForm(); };
  el.querySelectorAll('[data-in]').forEach(x => x.onchange = () => { i[x.dataset.in] = x.value; i.predictors = (i.predictors || []).filter(id => !['outcome', 'cluster', 'start', 'strata', ...(st.kind === 'repeated' ? ['time'] : [])].some(k => i[k] === id)); if (x.dataset.in === 'outcome') { delete o.order; delete o.censorLevel; delete o.eventLevel; } if (x.dataset.in === 'time') { delete o.timeOrder; delete o.sphericityAssumed; } if (x.dataset.in === 'group') delete o.groupOrder; change(); });
  el.querySelectorAll('[data-predictor]').forEach(x => x.onchange = () => { const chosen = new Set(i.predictors || []); x.checked ? chosen.add(x.dataset.predictor) : chosen.delete(x.dataset.predictor); i.predictors = [...chosen]; change(); });
  el.querySelectorAll('[data-option]').forEach(x => x.onchange = () => { o[x.dataset.option] = x.type === 'checkbox' ? x.checked : x.value; change(); });
  el.querySelectorAll('[data-ref]').forEach(x => x.onchange = () => { (o.refs ||= {})[x.dataset.ref] = x.value; change(); });
  el.querySelector('#advanced-order')?.addEventListener('change', e => { o.order = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); change(); });
  for (const key of ['timeOrder', 'groupOrder']) el.querySelector(key === 'timeOrder' ? '#advanced-time-order' : '#advanced-group-order')?.addEventListener('change', e => { o[key] = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); change(); });
  el.querySelector('#advanced-landmarks')?.addEventListener('change', e => { o.landmarks = e.target.value.split(/[\s,;]+/).filter(Boolean).map(Number); change(); });
  el.querySelectorAll('[data-open]').forEach(x => x.onclick = () => { const a = kept.find(a => a.id === x.dataset.open); if (advancedMethod(a.kind) && a.inputs) Object.assign(st, { kind: a.kind, inputs: structuredClone(a.inputs), options: structuredClone(a.options || {}) }); st.entry = a; st.error = ''; redraw(); });
  el.querySelectorAll('[data-more-kept]').forEach(x => x.onclick = () => showMenu(x, [{ label: 'Remove analysis', icon: 'trash', danger: true, run: () => { removeAdvanced(x.dataset.moreKept); if (st.entry?.id === x.dataset.moreKept) st.entry = null; ctx.refreshCounts?.(); redraw(); } }], { align: 'end' }));
  acts.run = async btn => {
    if (st.pending) return;
    st.pending = true; st.error = '';
    if (btn) btn.disabled = true;
    el.querySelector('.advanced-config').setAttribute('aria-busy', 'true');
    el.querySelectorAll('.advanced-config .an-settings :is(select,input,textarea)').forEach(x => { x.disabled = true; });
    const say = text => { const n = el.querySelector('#advanced-status'); if (n) n.textContent = text; };
    const kind = st.kind, source = structuredClone(d), inputs = structuredClone(i), options = structuredClone(actualOptions());
    const guard = analysisRunGuard(get, state => { const current = advancedSources(state).find(x => x.id === source.id); if (!current) throw new Error('Source removed'); return advancedSnapshot(current, kind, inputs, options); }, projectGeneration);
    try {
      const a = await runAdvanced(source, kind, inputs, options, { onProgress: say });
      if (!guard.belongs()) return;
      const reason = guard.reason(); if (reason) throw new Error(reason);
      keepAdvanced(a); ctx.refreshCounts?.(); st.pending = false;
      if (st.source === a.datasetId && st.kind === kind && advancedSnapshot(d, kind, st.inputs, actualOptions()) === a.inputSnapshot) st.entry = a;
      redraw();
    } catch (err) { st.error = err.message || String(err); st.pending = false; if (guard.belongs()) redraw(); }
    finally { st.pending = false; }
  };
  if (st.pending) el.querySelectorAll('.advanced-config .an-settings :is(select,input,textarea)').forEach(x => { x.disabled = true; });
  if (st.entry) showResult(el.querySelector('#advanced-result'), st.entry, s);
}

function showResult(el, a, state) {
  if (!Array.isArray(a.result?.tables) || !Array.isArray(a.population?.excluded) || typeof a.population?.used !== 'number') {
    el.innerHTML = `<div class="panel">${uiBar({ kind: 'head', label: 'Earlier analysis', id: 'advanced-legacy-head', lead: { title: 'Earlier analysis' }, actions: [{ id: 'advanced-legacy', label: 'Download saved record', icon: 'download' }] })}<div class="panel-body"><p data-ui-help>This earlier analysis has no supported configuration or verified population. Keep its saved record and run a supported method.</p></div></div>`;
    el.querySelector('#advanced-legacy').onclick = () => saveFile(JSON.stringify(a, null, 2), 'earlier-analysis.json', 'application/json');
    return;
  }
  const r = a.result, status = advancedInputStatus(a, state), pop = a.population;
  el.innerHTML = `<div class="panel">${uiBar({ kind: 'head', label: 'Result', id: 'advanced-result-head', lead: { title: r.title }, message: { id: 'advanced-population', text: `${pop.used} observations · ${pop.dropped} excluded` },
      actions: [{ id: 'advanced-csv', label: 'Download results', icon: 'download' }],
      overflow: [{ id: 'advanced-r', label: 'Download R script' }, { id: 'advanced-input', label: 'Download frozen input' }] })}
    <div class="panel-body"><p class="meta" data-ui-help>${esc(r.method)}</p>${status === 'stale' ? '<p data-advanced-status="stale">Source data changed. Run again before using this result.</p>' : status === 'untracked' ? '<p data-advanced-status="untracked">This earlier result has no verified input snapshot.</p>' : ''}${(r.warnings || []).map(w => `<p>${esc(w)}</p>`).join('')}</div>${r.tables.map(t => `<div class="panel-body tight">${t.title ? `<h3>${esc(t.title)}</h3>` : ''}<table><thead><tr>${t.header.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(row => `<tr>${row.map(x => `<td>${esc(value(x))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}${pop.excluded.length ? disclosure({ id: 'advanced-excluded-' + a.id, title: 'Excluded observations', meta: String(pop.excluded.length), className: 'panel-body', body: tableRegion({ label: 'Excluded observations', html: `<table><thead><tr><th scope="col">Source row</th><th scope="col">Reason</th></tr></thead><tbody>${pop.excluded.map(x => `<tr><td>${esc(x.rowId)}</td><td>${esc(x.reasons.join('; '))}</td></tr>`).join('')}</tbody></table>` }) }) : ''}</div>`;
  el.querySelector('#advanced-csv').onclick = () => downloadCsv(advancedCsv(a), filename(r.title) + '.csv');
  el.querySelector('#advanced-r').onclick = () => saveFile(a.rScript?.code || a.rScript, filename(r.title) + '.R', 'text/plain');
  el.querySelector('#advanced-input').onclick = () => saveFile(JSON.stringify({ source: a.frozenData, inputs: a.inputs, options: a.options, population: a.population }, null, 2), filename(r.title) + '-input.json', 'application/json');
}

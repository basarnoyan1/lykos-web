// Analysis: metafor through the vendored WebR engine. Inputs come only from
// accepted extraction values, never retyped (plan I1, J7).
import { saveAnalysis } from '../lib/i2-q.mjs';
import { REGISTRY } from './registry.mjs';
import { linkedResultParagraph } from '../lib/helpers.mjs';
import { proposalBox, esc, emptyState, autoGrow } from '../lib/html.mjs';
import { blankBlock, resultTokens } from '../lib/manuscript.mjs';
import { results as allResults } from '../lib/results.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { readSidecar } from '../lib/figure-sidecar.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { fields, fieldById, moderatorCandidates, valueFor, setManualValue, isLocked } from '../lib/fields.mjs';
import { runR } from '../lib/r.mjs';
import { survivalRows, roleColumn, columns as ipdColumns, participants } from '../lib/ipd.mjs';
import { describe, medianIQR, rangeOf, countPct, pValue, num } from '../lib/describe.mjs';
import { renderSurvival, survivalPage } from './analysis-survival.mjs';
import { figurePanel, showFigure, downloadCsv, compactSvg } from '../lib/figure.mjs';
import { mountForest, mountFunnel, hasFunnel, forestData } from '../lib/forest-page.mjs';
import { funnelInputs } from '../lib/diagnostics.mjs';
import { uiBar, uiNotice, uiList, uiRow, uiRowEnd, inspectorActions, menuAnchor } from '../lib/ui-actions.mjs';
import { plural, day as dayLabel } from '../lib/dates.mjs';
import { sentenceLabel } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { icon } from '../lib/icons.mjs';
import { studyCell } from '../lib/bib.mjs';
import { wireStudies, openStudy } from '../lib/study.mjs';
import { pooledInputs, pooledInputStatus, zeroEvents, zeroEventsText, poolEligible } from '../lib/analysis-inputs.mjs';
// the studies × inputs grid, typed in place as Extraction's cells are (./analysis-grid.mjs, lib/input-grid.mjs)
import { gridHtml, wireGrid, gridMessage } from './analysis-grid.mjs';
import { gridApplies } from '../lib/input-grid.mjs';
import { notUsed } from '../lib/paper-use.mjs';
import { MEASURES, measureOf, inputFields, isRatio, backTransform, effectName, escalcName } from '../lib/effect-measures.mjs';
import { reportedEffect } from '../lib/reported-effects.mjs';
import { patientDataEnabled, researchType } from '../lib/workflow.mjs';
import { isPrimaryType } from '../lib/research-types.mjs';
import { PRIMARY, outcomes, shownOutcomes, outcomeById, fieldFor, analysisOf, setOutcomeMeasure, resultPrefix, setOutcomeHidden, setOutcomeDefinition,
  timepointsOf, slotId, splitField, timepointLabel, addTimepoint, renameTimepoint, removeTimepoint, FIRST_TP, duplicateOutcomes, removeOutcome } from '../lib/outcomes.mjs';
import { ensureLinked, addOutcomeNamed, renameEverywhere, removeEverywhere, usesOf, setOutcomeFacts, priorityOf, benefitOf, PRIORITIES, BENEFIT } from '../lib/outcome-links.mjs';
import { certainty } from '../lib/grade.mjs';
// evidence features: studies with several treated arms (lib/multi-arm.mjs)
import { multiArmOf, armsApply, canSplit, handlingOf, multiArmText, setArms, setHandling } from '../lib/multi-arm.mjs';
import { studies as includedStudies } from '../lib/screen.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { sensitivityR, sensitivityPanels, wireSensitivity } from '../lib/sensitivity.mjs';
import { chartableColumns, patientColumnChart } from '../lib/charts.mjs';
import * as proportions from './analysis-proportions.mjs';
// two arms compared from a table's text (lib/contrast-counts.mjs): its own page, the pairwise engine's model
import * as comparative from './analysis-comparative.mjs';
import { isContrast } from '../lib/contrast-counts.mjs';
import { handlesGeneral, poolGeneral } from '../lib/meta-general.mjs';
import { handlesRare, poolRare, poolRareGroups } from '../lib/meta-rare.mjs';
import { poolGlmm } from '../lib/meta-glmm.mjs';
import { fitR, escArgs } from '../lib/pooled-model.mjs';
import { glmmScript } from '../lib/glmm.mjs';
import { extrasHtml, mountExtras, extraSection, trackSections } from './analysis-extras.mjs';
import { renderTools, toolsLine, toolsPage } from './analysis-tools.mjs';
import { renderPropensity, propensityPage } from './propensity-analysis.mjs';
import { hasSaved, savedLine, savedPage, renderSaved, savedInspect } from './analysis-saved.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { analysisRunGuard } from '../lib/analysis-run-guard.mjs';
import { INFERENCE, PREDICTION, isHK, testFor, piFor, heterogeneityR, settingsOf, revmanDifferences, heterogeneityRows, FT_WARNING, methodsUsed } from '../lib/heterogeneity.mjs';
import { extrasMethods } from '../lib/extras-methods.mjs';
// synthesis without meta-analysis is listed here too, beside the outcomes it stands in for: the same page and state as Certainty's
import { SWIM, extraItems, extraFocus, swimPageSpec, renderSwim, swimInspect } from './certainty-extra.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const usesDocument = true;
/** What the assistant is told about this view: the last pooled result, with its numbers. */

// the forest's style tokens from the project's figure-style sidecar (`.lykos/figure-style.json`), read once per project
let forestStyleCache = null;
async function forestStyleOf() {
  const key = get().project?.id || '';
  const side = await readSidecar('style');
  const tokens = figureTokens(side.doc, { medium: 'screen', chart: 'forest' });
  forestStyleCache = { key, tokens };
  return tokens;
}

export function assistContext() {
  const s = get(), list = outcomes(s).map(o => [o, analysisOf(s, o.id)]).filter(([, a]) => a);
  const ps=(s.propensityAnalyses || []).at(-1);
  const propensity=ps?`Propensity design: ${ps.method}; ${ps.nRetained} retained; treated/control ESS ${ps.groups.treated.ess.toFixed(1)}/${ps.groups.control.ess.toFixed(1)}; no outcome inference`:'';
  if (!list.length) return propensity || 'Analysis: no pooled result yet';
  const f = x => Number(x).toFixed(2);
  return list.map(([o, a]) => `${outcomes(s).length > 1 ? `${o.name}: ` : ''}Pooled ${a.measure} (${a.method}${a.test === 'knha' ? ', Hartung–Knapp' : ''}, k = ${a.k}): ${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]; I² ${Number(a.i2).toFixed(1)}%; τ² ${Number(a.tau2).toFixed(4)}; Q ${f(a.q)} p ${Number(a.qp).toFixed(3)}` +
    (a.pi_lo != null ? `; 95% prediction interval ${f(a.pi_lo)} to ${f(a.pi_hi)}` : '') +
    (a.egger_z != null ? `; Egger z ${f(a.egger_z)} p ${Number(a.egger_p).toFixed(3)}` : '') + `; studies: ${(a.labels || []).join(', ')}`).join('\n')+(propensity?`\n${propensity}`:'');
}
export const meta = { title: 'Analysis', icon: 'analysis' };
export const count = (...a) => REGISTRY.analysis.count(...a);



// Random-effects estimators of τ², and the common-effect (inverse-variance,
// τ² fixed at 0) model, as metafor names them.
const ESTIMATORS = [['REML', 'Random effects (REML)'], ['DL', 'Random effects (DerSimonian–Laird)'], ['EE', 'Common effect']];
// Rare-event models for binary outcomes, from metafor: Mantel–Haenszel
// (rma.mh; risk ratio, odds ratio, risk difference, and the incidence rate
// ratio) and Peto's one-step odds ratio (rma.peto). Both are common-effect
// models that pool the counts without a continuity correction.
const RARE = [['MH', 'Common effect (Mantel–Haenszel)'], ['PETO', 'Common effect (Peto odds ratio)']];
const rareOffered = measure => [...(['RR', 'OR', 'RD', 'IRR'].includes(measure) ? [RARE[0]] : []), ...(measure === 'OR' ? [RARE[1]] : [])];
// the binomial–normal mixed model, for single-group proportions (needs lme4, fetched when it is chosen)
const GLMM = ['GLMM', 'Generalised linear mixed model'];
const estimatorsFor = measure => [...ESTIMATORS, ...rareOffered(measure), ...(measure === 'PR' ? [GLMM] : [])];
/** A method the measure can use: a rare-event model the measure does not take falls back to REML. */
const methodFor = (measure, method) => (estimatorsFor(measure).some(([id]) => id === method) ? method : 'REML');
const isRare = method => method === 'MH' || method === 'PETO';
const isGlmm = method => method === 'GLMM';
// How the pooled estimate's interval and the prediction interval are formed
// (lib/heterogeneity.mjs): normal, Hartung–Knapp, or Hartung–Knapp with metafor's guard.
let descCol = null;      // the patient-data column whose distribution is drawn
let mode = 'survival';   // what an IPD review needs first
// Patient-level analyses exist only with patient data; a case series has no
// studies to pool. The list and the open analysis follow the project.
const offered = s => [...(patientDataEnabled(s) ? ['survival', 'describe'] : []),
  ...((s.datasets || []).length || (s.participants || []).length || (s.propensityAnalyses || []).length ? ['propensity'] : []),
  ...(researchType(s).id === 'case-series' ? [] : isPrimaryType(researchType(s).id) ? ['tools'] : [...shownOutcomes(s).map(o => pairwiseId(o.id)), SWIM, 'tools']),
  ...(hasSaved(s) ? ['saved'] : [])];
// One pooled effect per outcome: 'pairwise' is the primary, 'pairwise:<id>' the others.
const pairwiseId = id => (id === PRIMARY ? 'pairwise' : `pairwise:${id}`);
const outcomeOf = () => (mode.startsWith('pairwise:') ? mode.slice(9) : PRIMARY);
// The timepoint shown per outcome (plan G3); the slot is the outcome at that timepoint.
const tpBy = {};
const tpOf = (s = get()) => { const list = timepointsOf(s, outcomeOf()), t = tpBy[outcomeOf()]; return list.some(x => x.id === t) ? t : list[0].id; };
const slotOf = (s = get()) => slotId(outcomeOf(), tpOf(s));
const isPairwise = () => mode === 'pairwise' || mode.startsWith('pairwise:');
const current = s => { const o = offered(s); if (o.length && !o.includes(mode)) mode = o[0]; return mode; };
export function focusResult(key) {
  const m = /^pooled\.(?:(o[a-z0-9]+)\.)?(?:(t\d+)\.)?/.exec(key);
  mode = /^(?:survival|cox)\./.test(key) ? 'survival' : m?.[1] ? `pairwise:${m[1]}` : 'pairwise';
  if (m?.[2]) tpBy[m[1] || PRIMARY] = m[2];
}

/**
 * What the view shows, for model actions (lib/aid.mjs): which analysis, and
 * its latest result when one has been run. `mode` tells an action which saved
 * result the person is looking at.
 */
export function focus() {
  const s = get();
  if (isPairwise()) { const o = outcomeById(s, outcomeOf()), a = analysisOf(s, slotOf(s)), at = timepointLabel(s, slotOf(s));
    return { kind: 'analysis', mode, label: `Pooled effect: ${o.name}${at ? `, ${at}` : ''}`, detail: a ? `${a.measure} ${Number(a.estimate).toFixed(2)} [${Number(a.lo).toFixed(2)}, ${Number(a.hi).toFixed(2)}], k = ${a.k}` : 'not run' }; }
  if (mode === 'describe') return { kind: 'analysis', mode, label: 'Descriptives', detail: `${participants().length} patients` };
  if (mode === 'propensity') return {kind:'analysis',mode,label:'Propensity adjustment',detail:`${(s.propensityAnalyses || []).length} kept designs`};
  if (mode === 'tools') return { kind: 'analysis', mode, label: 'Calculators', detail: toolsLine().toLowerCase() };
  if (mode === SWIM) return extraFocus(SWIM);
  if (mode === 'saved') return { kind: 'analysis', mode, label: 'Saved analyses', detail: savedLine(s) };
  const r = s.survival;
  const cox = r?.cox ? arr(r.cox.terms).map((t, i) => `${t} HR ${Number(arr(r.cox.hr)[i]).toFixed(3)}`).join(', ') : '';
  return { kind: 'analysis', mode, label: 'Time to event', detail: r?.km
    ? [`${r.n} patients, ${r.events} events`, arr(r.km.groups).length > 1 ? `log-rank p ${pval(Number(r.km.logrankP))}` : '', cox].filter(Boolean).join('; ')
    : 'not run' };
}

// ---- list · detail · inspector ----------------------------------------------
// The items are the analyses. The detail is the selected one: its inputs and its
// results; its name, Run and input download are the title bar's (page()).
// Model settings and the secondary statistics of a pooled result go to the
// inspector; the pooled estimate stays in the detail.
const MODES = [['survival', 'Time to event'], ['describe', 'Descriptives'], ['pairwise', 'Pooled effect'], ['propensity','Propensity adjustment']];
const day = at => (at ? dayLabel(at) : '');   // "28 Sep", as the app writes dates
const needed = () => inputFields(opt('measure')).map(f => fieldFor(f, slotOf()));
// A field's name as the person reads it: the field's own label, else the standard name of the input, never the id.
const INPUT_LABELS = { events_t: 'Events, treated', n_t: 'N, treated', events_c: 'Events, control', n_c: 'N, control', mean_t: 'Mean, treated', sd_t: 'SD, treated', mean_c: 'Mean, control', sd_c: 'SD, control',
  time_t: 'Person-time, treated', time_c: 'Person-time, control', hr: 'Hazard ratio', hr_lo: 'Hazard ratio, lower', hr_hi: 'Hazard ratio, upper', events: 'Events', n: 'N', mean: 'Mean', sd: 'SD', r: 'Correlation',
  effect_estimate: 'Estimate', effect_se: 'Standard error' };
const inputLabel = f => fieldById(f)?.label || INPUT_LABELS[splitField(f).base] || sentenceLabel(splitField(f).base);
// The studies a Run pools: included, complete and valid (the same list Run
// uses, so a moderator offered here is one Run accepts). Every record with a
// value, excluded ones too, was offered before, and a moderator valid only
// on that wider set was silently dropped at Run.
function readyPapers(s) {
  if (outcomeById(s, outcomeOf()).derived) return [];
  const m = opt('measure'), units = pooledInputs(s, '', m, slotOf(s)).units;
  return [...new Set(zeroEvents(m, units.map(u => u.values)).used.map(i => units[i].paper))];
}

// Model settings for a pooled effect: set in the inspector, read by Run. They
// start from the last result, so what is shown is what produced it.
// Kept per outcome. The measure is the outcome's own, so extraction shows its inputs.
const optsBy = {};
const opts = () => (optsBy[outcomeOf()] ||= { measure: null, method: null, moderator: null, test: null, pi: null });
// The settings a saved result used are read from what it recorded (a.settings), else from its own fields;
// a result saved before settings were recorded shows the defaults below only where it recorded nothing.
const savedOpt = (a, k) => (k === 'pi' ? a?.settings?.pi : k === 'test' ? (a?.settings?.ci ?? a?.test) : a?.[k]);
const rawOpt = k => opts()[k] ?? (k === 'measure' ? outcomeById(get(), outcomeOf()).measure : null)
  ?? savedOpt(analysisOf(get(), slotOf()), k) ?? { measure: 'RR', method: 'REML', moderator: '', test: 'z', pi: 'follow' }[k];
// a rare-event model only with a measure it takes; with Mantel–Haenszel or Peto a moderator is a grouping (each subgroup pooled the same way, the
// test for subgroup differences across their estimates), with the GLMM a grouping or a regression
const opt = k => k === 'method' ? methodFor(rawOpt('measure'), rawOpt('method')) : rawOpt(k);

// One line per analysis under a Run and a Not run head (Component review 2026-10-21, item 7, after Plane's grouped list): the name, a
// quiet trailing word when nothing in the paper reads it, and the estimate at the end. The counts behind it (arms, studies complete)
// are the detail page's. Two analyses of one name are told apart by what they count, so no two rows read the same.
const ROW_LINE = 40;
const short = (a, pct) => (pct ? `${(Number(a.estimate) * 100).toFixed(1)}%` : `${a.measure} ${Number(a.estimate).toFixed(2)}`);
/** A repeated name gets what its outcome counts ("Two-stage vs single-stage: ASD, PJK"), else its place in the list. */
function distinctNames(rows) {
  const seen = new Map();
  for (const r of rows) seen.set(r.title, (seen.get(r.title) || 0) + 1);
  const used = new Map();
  return rows.map(r => {
    if (seen.get(r.title) < 2) return r;
    const items = r.counts || [];
    const what = items.length ? `${items.slice(0, 2).join(', ')}${items.length > 2 ? `, ${items.length - 2} more` : ''}` : 'no events chosen';
    let title = `${r.title}: ${what}`;
    const n = (used.get(title) || 0) + 1; used.set(title, n);
    if (n > 1) title = `${title} (${n})`;
    return { ...r, title };
  });
}
export const list = {
  title: 'Analyses',
  rowHeight: ROW_LINE,
  acts: refresh => [{ id: 'plist-add-outcome', label: 'Add outcome', icon: 'plus', iconOnly: true, role: 'quiet', plain: true, attrs: { 'aria-haspopup': 'menu' },
    run: btn => addOutcomeAsk({ rerender: refresh }, { currentTarget: menuAnchor(btn) }) }],
  get empty() { return 'No analyses'; },
  // the analyses themselves: group heads, Calculators and Saved analyses are not counted
  count: rows => rows.filter(r => !r.group && r.id !== 'tools' && r.id !== 'saved' && r.id !== SWIM).length,
  items(s) {
    const run = [], notRun = [], show = offered(s);
    const { rows } = survivalRows(); const sv = s.survival;
    // an event an outcome of its own counts is called by that outcome's name ("asd" is ASD); any other as written, capitalised
    const eventName = w => outcomes(s).find(x => x.derived?.items?.length === 1 && x.derived.items[0] === w)?.name || String(w || '').replace(/^./, c => c.toUpperCase());
    if (show.includes('survival')) (sv?.km ? run : notRun).push({ id: 'survival', title: 'Time to event',
      meta: !sv?.km ? '' : arr(sv.km.groups).length > 1 ? `p ${pval(Number(sv.km.logrankP))}` : plural(sv.events, 'event') });
    const n = participants().length;
    if (show.includes('describe')) (n ? run : notRun).push({ id: 'describe', title: 'Descriptives', meta: n ? plural(n, 'patient') : '' });
    if (show.includes('propensity')) ((s.propensityAnalyses || []).length ? run : notRun).push({ id: 'propensity', title: 'Propensity adjustment', meta: (s.propensityAnalyses || []).length ? plural(s.propensityAnalyses.length, 'run') : '' });
    const several = shownOutcomes(s).length > 1, pooled = [];
    for (const o of shownOutcomes(s)) {
      if (!show.includes(pairwiseId(o.id))) continue;
      const a = analysisOf(s, o.id), empty = !setUp(s, o);
      const base = { id: pairwiseId(o.id), title: several ? o.name : 'Pooled effect', counts: (o.derived?.items || []).map(eventName),
        // the detail line the row had, as its tooltip: the counts are one hover away, not a second line
        sub: '', meta: '', mark: a && notUsed(s, o.id) ? 'Not used' : '' };
      if (empty) { pooled.push([2, { ...base, meta: 'Not set up' }]); continue; }
      const pct = !!o.derived && !isContrast(o.derived);
      pooled.push([a ? 0 : 1, { ...base, meta: a ? short(a, pct) : '' }]);
    }
    // stable: outcomes keep their order within each group
    for (const [rank, item] of pooled) (rank === 0 ? run : notRun).push(item);
    const named = distinctNames([...run, ...notRun]);
    const runN = named.slice(0, run.length), notN = named.slice(run.length);
    const tools = [...(show.includes(SWIM) ? [extraItems(s).find(x => x.id === SWIM)] : []),
      ...(show.includes('tools') ? [{ id: 'tools', title: 'Calculators', meta: '', mark: '' }] : []),
      ...(show.includes('saved') ? [{ id: 'saved', title: 'Saved analyses', meta: '', mark: '' }] : [])].filter(Boolean).map(x => ({ ...x, sub: '' }));
    return [...(runN.length ? [{ id: 'g:run', group: true, title: 'Run' }, ...runN] : []),
      ...(notN.length ? [{ id: 'g:not-run', group: true, title: 'Not run' }, ...notN] : []),
      ...(tools.length ? [{ id: 'g:tools', group: true, title: 'Tools' }, ...tools] : [])];
  },
};
export function select(id) { if (offered(get()).includes(id)) mode = id; }
/** Opens on an outcome's pooled analysis: the Overview's Open changed. */
export const selectOutcome = id => select(pairwiseId(id));
export function selected() { return current(get()); }

/** The inspector's Details for the selected analysis. */
export function inspect(ctx) {
  current(get());
  if (mode === 'survival') {
    const { rows, excluded } = survivalRows(); const sv = get().survival;
    const col = r => roleColumn(r)?.name || '—';
    return [{ title: 'Data', html: `<dl class="props">
        <dt>Time</dt><dd>${esc(col('time'))}</dd><dt>Event</dt><dd>${esc(col('event'))}</dd><dt>Group</dt><dd>${esc(col('group'))}</dd>
        <dt>Patients</dt><dd>${rows.length}</dd><dt>Events</dt><dd>${rows.filter(r => r.event).length}</dd>
        <dt>Excluded</dt><dd>${excluded.length}</dd>
        ${sv?.at ? `<dt>Run</dt><dd>${esc(day(sv.at))}</dd>` : ''}</dl>
        ${inspectorActions({ id: 'an-patient-acts', label: 'Data actions', actions: [{ id: 'an-go-patients', label: 'Patient data', icon: 'patients', attrs: { 'data-go-patients': '' } }] })}`,
      wire: el => el.querySelector('[data-go-patients]').onclick = () => ctx.go('patients') }];
  }
  if (mode === 'tools' || mode === 'propensity') return [];
  if (mode === 'saved') return savedInspect();
  if (mode === SWIM) return swimInspect();
  if (mode === 'describe') {
    const rows = participants(), g = roleColumn('group');
    return [{ title: 'Data', html: `<dl class="props">
        <dt>Patients</dt><dd>${rows.length}</dd><dt>Variables</dt><dd>${ipdColumns().length}</dd>
        <dt>Group</dt><dd>${esc(g?.name || '—')}</dd></dl>
        ${inspectorActions({ id: 'an-patient-acts', label: 'Data actions', actions: [{ id: 'an-go-patients', label: 'Patient data', icon: 'patients', attrs: { 'data-go-patients': '' } }] })}`,
      wire: el => el.querySelector('[data-go-patients]').onclick = () => ctx.go('patients') }];
  }
  const s = get(), oid = outcomeOf(), slot = slotOf(s), a = analysisOf(s, slot), ready = readyPapers(s);
  const derived = outcomeById(s, oid).derived, o = outcomeById(s, oid);
  const f = (x, d = 2) => Number(x).toFixed(d);
  const vec = v => Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v];
  const cands = moderatorCandidates(s, ready, needed());
  const sel = (id, label, options, cur) => `<label class="field"><span>${label}</span><select data-opt="${id}" aria-label="${label}">
      ${options.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const fact = (k, label, list, cur) => `<label class="field"><span>${label}</span><select data-outcome-fact="${k}" aria-label="${label}">
      ${list.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const secs = [{ title: 'Outcome', html: `<div class="an-settings">
      <label class="field"><span>Name</span><input data-outcome-name value="${esc(o.name)}" maxlength="80"></label>
      <label class="field"><span>Definition</span><textarea data-outcome-definition rows="3" aria-label="Definition">${esc(o.definition || '')}</textarea></label>
      ${fact('priority', 'Priority', PRIORITIES, priorityOf(s, oid))}
      ${fact('benefit', 'Direction of benefit', BENEFIT, benefitOf(s, oid))}
      ${oid !== PRIMARY && (s.templates || []).length ? `<label class="field"><span>Inputs</span><select data-outcome-source aria-label="Inputs">
        <option value="fields"${derived ? '' : ' selected'}>Extraction fields</option><option value="text"${derived && !isContrast(derived) ? ' selected' : ''}>Counts in a table's text</option><option value="contrast"${isContrast(derived) ? ' selected' : ''}>Two arms in a table's text</option></select></label>` : ''}</div>
      ${usedInHtml(s, oid)}
      ${inspectorActions({ id: 'an-outcome-acts', label: 'Outcome actions', ...(oid === PRIMARY ? { actions: [{ id: 'an-outcome-hide', label: 'Hide outcome', icon: 'close' }] } : { overflow: [{ id: 'an-outcome-remove', label: 'Remove outcome', danger: true }] }) })}
      ${derived ? '' : timepointsHtml(s, oid)}`,
    wire: el => {
      el.querySelectorAll('[data-outcome-fact]').forEach(x => x.onchange = () => { update(st => setOutcomeFacts(st, oid, { [x.dataset.outcomeFact]: x.value })); ctx?.rerender(); });
      const src = el.querySelector('[data-outcome-source]');
      if (src) src.onchange = e => { update(st => (e.target.value === 'text' ? proportions.startDerived(st, oid) : e.target.value === 'contrast' ? comparative.startComparison(st, oid) : proportions.stopDerived(st, oid))); ctx?.rerender(); };
      // one outcome, one name: its GRADE row, SWiM domain and plan rows are renamed with it (lib/outcome-links.mjs)
      el.querySelector('[data-outcome-name]').onchange = e => { update(st => renameEverywhere(st, oid, e.target.value)); ctx?.rerender(); ctx?.refreshCounts?.(); };
      autoGrow(el.querySelector('[data-outcome-definition]'), { max: 200 });
      el.querySelector('[data-outcome-definition]').onchange = e => { update(st => setOutcomeDefinition(st, oid, e.target.value)); ctx?.rerender(); };
      const hide = el.querySelector('#an-outcome-hide');
      if (hide) hide.onclick = () => hideOutcome(ctx, oid);
      const rm = el.querySelector('#an-outcome-remove');
      if (rm) rm.onclick = async () => {
        const point = undoPoint(), name = outcomeById(get(), oid).name;
        update(st => removeEverywhere(st, oid)); mode = 'pairwise'; ctx?.rerender();
        offerUndo(point, `Removed ${name}`, () => ctx?.rerender());
      };
      if (!derived) wireTimepoints(el, ctx, oid);
    } }];
  // counts read from a table's text: a proportion per arm, with its own model and inputs
  // a comparison set up from a figure's caption and not run yet opens on what was filled in and what is left (views/analysis-comparative.mjs)
  if (isContrast(derived)) { const c = comparative.inspect(ctx, oid); return [...c.filter(x => x.setup), ...secs, ...c.filter(x => !x.setup)]; }
  if (derived) return [...secs, ...proportions.inspect(ctx, oid)];
  secs.push({ title: 'Model', html: `<div class="an-settings">
      ${sel('measure', 'Effect measure', MEASURES.map(m => [m.id, m.label]), opt('measure'))}
      ${sel('method', 'Model', estimatorsFor(opt('measure')), opt('method'))}
      ${opt('method') === 'EE' || isRare(opt('method')) || isGlmm(opt('method')) ? '' : sel('test', 'Confidence interval', INFERENCE, opt('test'))}
      ${opt('method') === 'EE' || isRare(opt('method')) || isGlmm(opt('method')) ? '' : sel('pi', 'Prediction interval', PREDICTION, opt('pi'))}
      ${sel('moderator', 'Moderator', [['', 'No moderator'], ...cands.filter(m => !isRare(opt('method')) || m.kind === 'group').map(m => [m.field.id,
        `${m.field.label}${m.kind === 'group' ? ` (${m.levels.length} groups)` : ' (regression)'}`])], opt('moderator'))}</div>
      ${measureOf(opt('measure')).warning === 'freeman-tukey' ? `<div class="note spaced" data-ui-help>${FT_WARNING}</div>` : ''}`,
    wire: el => ['measure', 'method', 'moderator', 'test', 'pi'].forEach(k => {
      const x = el.querySelector(`[data-opt="${k}"]`); if (!x) return;
      x.onchange = e => {
        opts()[k] = e.target.value;
        // the interval choice exists only for a random-effects model, the moderator not for a rare-event model
        if (k === 'method') ctx?.rerender();
        // A new measure needs other inputs: extraction and this view follow it.
        if (k === 'measure') { update(st => setOutcomeMeasure(st, oid, e.target.value)); ctx?.rerender(); }
      }; }) });
  // studies with several treated arms: the comparison or a split control, per study (lib/multi-arm.mjs)
  if (armsApply(opt('measure'))) secs.push(multiArmSection(s, ctx));
  if (!a) return secs;
  secs.push({ title: 'Heterogeneity', meta: `k = ${a.k}`, html: `<dl class="props">
      ${heterogeneityRows(a).map(([l, t]) => `<dt>${l}</dt><dd>${esc(t)}</dd>`).join('')}
      <dt>Q</dt><dd>${f(a.q)} (p = ${f(a.qp, 3)})</dd>
      ${a.cmh != null ? `<dt>Cochran–Mantel–Haenszel</dt><dd>${f(a.cmh)} (p = ${f(a.cmhp, 3)})</dd>` : ''}
      ${a.tarone != null ? `<dt>Tarone's test</dt><dd>${f(a.tarone)} (p = ${f(a.taronep, 3)})</dd>` : ''}
      ${a.egger_z != null ? `<dt>Egger's test</dt><dd>z = ${f(a.egger_z)}, p = ${f(a.egger_p, 3)}${a.k < 10 ? '; k < 10' : ''}</dd>` : ''}</dl>` });
  const est = vec(a.loo_est), lo = vec(a.loo_lo), hi = vec(a.loo_hi), i2 = vec(a.loo_i2), labels = a.labels || [];
  if (est.length) secs.push({ title: 'Leave one out', meta: String(est.length), html: `<dl class="props">${est.map((e, i) =>
      `<dt>${esc(labels[i] || `Study ${i + 1}`)}</dt><dd>${f(e)} [${f(lo[i])}, ${f(hi[i])}], I² ${f(i2[i], 1)}%</dd>`).join('')}</dl>` });
  return secs;
}

/**
 * The title bar is the page's head (lib/topbar.mjs): the open analysis is its title, what it counts or waits for is beside it, and Run
 * is its primary; the analyses themselves are the list pane's. Each kind of analysis declares its own part.
 */
export function page(rerender) {
  const s = get(); current(s);
  const title = modeTitle();
  if (mode === 'survival') return survivalPage(title, rerender);
  if (mode === 'describe') return describePage(title);
  if (mode === 'tools') return toolsPage(rerender);
  if (mode === 'propensity') return propensityPage();
  if (mode === 'saved') return savedPage();
  if (mode === SWIM) return swimPageSpec();
  const o = outcomeById(s, outcomeOf());
  if (!setUp(s, o) && !enterable(s, o)) return { title, status: { text: 'Not set up', ch: 12 }, actions: [] };
  if (isContrast(o.derived)) return comparative.contrastPage(outcomeOf(), title);
  if (o.derived) return proportions.proportionPage(outcomeOf(), title);
  return pairwisePage(s, title, slotOf(s));
}

// Exact copies of an analysis that hold nothing (a repeated Apply made seven "Two-stage vs single-stage", 2026-10-22): one notice over the page
// names them and removes them in one press; the first of each set, and anything with a result or a value, stays.
export function render(el, ctx) {
  const out = renderPage(el, ctx), dups = duplicateOutcomes(get());
  if (dups.length && el.isConnected !== false) {
    const names = [...new Set(dups.map(id => outcomeById(get(), id)?.name).filter(Boolean))];
    el.insertAdjacentHTML('afterbegin', uiNotice({ id: 'an-dups', label: 'Repeated analyses', text: `${dups.length} ${dups.length === 1 ? 'analysis repeats' : 'analyses repeat'} ${names.map(n => `"${n}"`).join(', ')} exactly and hold no result`,
      actions: [{ id: 'an-dups-remove', label: 'Remove copies', icon: 'trash' }] }));
    el.querySelector('#an-dups-remove')?.addEventListener('click', () => { update(st => { for (const id of duplicateOutcomes(st)) removeOutcome(st, id); return st; }); ctx.refreshCounts?.(); ctx.rerender(); });
  }
  return out;
}
function renderPage(el, ctx) {
  ensureLinked(get, update);   // GRADE rows, SWiM domains and plan rows named before outcomes had one id take its id
  current(get());
  if (mode === 'survival') return renderSurvival(el, ctx);
  if (mode === 'describe') return renderDescriptives(el, ctx);
  if (mode === 'tools') return renderTools(el, ctx);
  if (mode === 'propensity') return renderPropensity(el,ctx);
  if (mode === 'saved') return renderSaved(el, ctx);
  if (mode === SWIM) return renderSwim(el, ctx);
  const o = outcomeById(get(), outcomeOf());
  if (!setUp(get(), o) && !enterable(get(), o)) return renderNotSetUp(el, ctx, o);
  if (isContrast(o.derived)) return comparative.render(el, ctx, outcomeOf());
  if (o.derived) return proportions.render(el, ctx, outcomeOf());
  return renderPairwise(el, ctx, slotOf());
}

/**
 * Whether an outcome has anything to pool: a saved result, or a value for one
 * of its inputs in any study, or (read from a table's text) a count in any
 * arm. The primary outcome exists in every review; one nobody set up says so
 * rather than listing every study as incomplete.
 */
function setUp(s, o) {
  // Reported models can be entered here through the same accepted extraction cells.
  if (measureOf(o.measure).family === 'reported') return true;
  if (analysisOf(s, o.id)) return true;
  if (isContrast(o.derived)) return comparative.setUpContrast(s, o);
  if (o.derived) return ((o.derived.column || o.derived.kind === 'composite') && pooledInputs(s, '', 'PR', o.id).units?.some(u => u.status !== 'missing')) || false;
  const ids = new Set(timepointsOf(s, o.id).flatMap(t => inputFields(o.measure).map(f => fieldFor(f, slotId(o.id, t.id)))));
  return Object.keys(s.values || {}).some(k => ids.has(k.slice(k.indexOf(':') + 1)));
}

/** An outcome whose inputs can be typed here: one pooled from extraction fields, with studies to type them for (the grid opens empty). */
const enterable = (s, o) => !o.derived && gridApplies(o.measure) && poolEligible(s).length > 0;

function hideOutcome(ctx, oid) {
  update(st => setOutcomeHidden(st, oid, true));
  mode = offered(get())[0] || 'pairwise'; ctx.rerender(); ctx.refreshCounts?.();
}

// What each kind of measure is pooled from, as the empty state says it.
const NEEDS = { binary: 'events and totals in both arms', continuous: 'means, SDs and totals in both arms', generic: 'a hazard ratio with its 95% CI',
  rate: 'events and person-time in both arms', proportion: 'events and a total', 'single-mean': 'a mean, SD and total', correlation: 'a correlation and its sample size' };

/** An outcome with no inputs: what it needs, and the ways on. */
function renderNotSetUp(el, ctx, o) {
  const s = get();
  const text = isContrast(o.derived) ? 'Choose the arm column, the two sides and the items its counts are read from.' : o.derived ? 'Choose the table, column and item its counts are read from.' : `Needs ${NEEDS[measureOf(o.measure).family] || 'its inputs'} for each study, entered in Extraction.`;
  el.innerHTML = `<div class="panel">
    <div class="panel-body">${emptyState({ icon: 'analysis', title: `No inputs for ${o.name}`,
      actions: [
        ...(o.derived ? [] : [{ id: 'an-extract', label: 'Extraction', icon: 'extraction', primary: true }]),
        ...(o.id !== PRIMARY && !o.derived && (s.templates || []).length ? [{ id: 'an-text', label: 'Counts in a table', icon: 'table' }] : []),
        o.id === PRIMARY ? { id: 'an-hide', label: 'Hide outcome', icon: 'close' } : { id: 'an-remove', label: 'Remove outcome', icon: 'trash' }] })}</div></div>`;
  // the guidance names the inputs; it is a design choice, marked and short
  const detail = document.createElement('div');
  detail.className = 'empty-detail'; detail.dataset.uiHelp = ''; detail.textContent = text;
  el.querySelector('.empty-title')?.after(detail);
  el.querySelector('#an-extract')?.addEventListener('click', () => ctx.go('extraction'));
  el.querySelector('#an-text')?.addEventListener('click', () => { update(st => proportions.startDerived(st, o.id)); ctx.rerender(); });
  el.querySelector('#an-hide')?.addEventListener('click', () => hideOutcome(ctx, o.id));
  el.querySelector('#an-remove')?.addEventListener('click', async () => {
    const point = undoPoint();
    update(st => removeEverywhere(st, o.id)); mode = offered(get())[0] || 'pairwise'; ctx.rerender();
    offerUndo(point, `Removed ${o.name}`, () => ctx.rerender());
  });
}

/** Add outcome: a new one, or, from a menu, an outcome that was hidden. */
async function addOutcomeAsk(ctx, e) {
  const hidden = outcomes(get()).filter(o => o.hidden);
  if (hidden.length && e?.currentTarget) {
    const at = e.currentTarget;
    return showMenu(at, [{ label: 'New outcome', icon: 'plus', run: () => newOutcome(ctx) }, '-',
      ...hidden.map(o => ({ label: `Show ${o.name}`, run: () => { update(st => setOutcomeHidden(st, o.id, false)); mode = pairwiseId(o.id); ctx.rerender(); } }))]);
  }
  return newOutcome(ctx);
}

async function newOutcome(ctx) {
  const name = await ask('Add outcome', { placeholder: 'e.g. Overall survival', confirm: 'Add' });
  if (!name?.trim()) return;
  // the outcome of that name if the review has one (shown again if hidden), else a new one, set up in Certainty and SWiM too
  let id; update(st => { id = addOutcomeNamed(st, name, opt('measure')); return st; });
  mode = pairwiseId(id); ctx.rerender(); ctx.refreshCounts?.();
}

// The record pane owns analysis navigation; the document names only the open analysis.
function modeTitle() {
  if (isPairwise() && shownOutcomes(get()).length > 1) return outcomeById(get(), outcomeOf()).name || 'Pooled effect';
  return MODES.find(([id]) => id === mode.split(':')[0])?.[1] || 'Analysis';
}

const REMOVAL_NOTE = 'Its extracted inputs and pooled result are removed, with its GRADE row and SWiM domain if they are empty.';

// Where else the outcome is (lib/outcome-links.mjs): its GRADE row, its SWiM domain and the plan's method, as facts.
function usedInHtml(s, oid) {
  const u = usesOf(s, oid), cells = Object.values(s.swim?.cells || {});
  const rated = g => certainty(g).final;   // 'Not rated' until a person rates the row (lib/grade.mjs)
  const judged = u.swim.reduce((n, d) => n + cells.filter(r => r?.[d.id]).length, 0);
  const methods = u.sap.map(r => String(r.method || '').trim()).filter(Boolean);
  return `<dl class="props">
    <dt>Certainty</dt><dd>${u.grade.length ? esc(u.grade.map(rated).join(', ')) : 'No GRADE row'}</dd>
    <dt>SWiM</dt><dd>${u.swim.length ? esc(plural(judged, 'study', 'studies')) : 'No outcome domain'}</dd>
    <dt>Analysis plan</dt><dd>${u.sap.length ? esc(methods.join('; ') || 'No method stated') : 'Not planned'}</dd></dl>`;
}
const pval = v => (v == null || Number.isNaN(v) ? '—' : v < 0.001 ? '<0.001' : v.toFixed(3));
const arr = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ---- timepoints (plan G3) ---------------------------------------------------------
// An outcome measured at several times: each timepoint has its own inputs in
// Extraction and its own result here; the head's selector chooses which.
function timepointsHtml(s, oid) {
  const list = timepointsOf(s, oid), several = list.length > 1;
  const rows = list.map(t => uiRow({ main: { html: `<input data-tp-name="${esc(t.id)}" value="${esc(t.label || '')}" aria-label="Timepoint name" maxlength="40">` },
    end: uiRowEnd(t.id === FIRST_TP ? { reserve: true } : { more: { label: `More for ${t.label || 'timepoint'}`, attrs: { 'data-tp-more': t.id } } }) }));
  return `${several ? uiList({ id: 'an-tp-list', label: 'Timepoints', rows }) : ''}${inspectorActions({ id: 'an-tp-acts', label: 'Timepoint actions', actions: [{ id: 'an-tp-add', label: 'Add timepoint', icon: 'plus' }] })}`;
}
function wireTimepoints(el, ctx, oid) {
  el.querySelectorAll('[data-tp-name]').forEach(x => x.onchange = () => { update(st => renameTimepoint(st, oid, x.dataset.tpName, x.value)); ctx?.rerender(); });
  el.querySelectorAll('[data-tp-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove timepoint', icon: 'trash', danger: true, run: async () => {
    const t = timepointsOf(get(), oid).find(x => x.id === b.dataset.tpMore);
    const point = undoPoint();
    update(st => removeTimepoint(st, oid, b.dataset.tpMore)); ctx?.rerender(); ctx?.refreshCounts?.();
    offerUndo(point, `Removed ${t?.label || 'the timepoint'}`, () => ctx?.rerender());
  } }], { align: 'end' }));
  el.querySelector('#an-tp-add').onclick = async () => {
    const several = timepointsOf(get(), oid).length > 1;
    const first = several ? '' : await ask('Name of the timepoint so far', { placeholder: 'e.g. 6 months', confirm: 'Next' });
    if (!several && first == null) return;
    const label = await ask('Add timepoint', { placeholder: 'e.g. 12 months', confirm: 'Add' });
    if (!label?.trim()) return;
    let id; update(st => { id = addTimepoint(st, oid, label, first); return st; });
    tpBy[oid] = id; ctx?.rerender(); ctx?.refreshCounts?.();
  };
}

// ---- studies with several treated arms (Cochrane Handbook 23.3.4) --------------------
function multiArmSection(s, ctx) {
  const measure = opt('measure'), list = includedStudies(s).filter(p => multiArmOf(s, p.id));
  const others = includedStudies(s).filter(p => !multiArmOf(s, p.id));
  const how = m => [...m.arms.map(a => [a.id, `${a.label || a.id} vs ${m.control || 'control'}`]), ...(canSplit(measure) ? [['split', 'Each arm, control split']] : [])];
  const row = (p, i) => { const m = multiArmOf(s, p.id), h = handlingOf(m, measure);
    return `<div class="an-arm" data-arm-study="${esc(p.id)}">${uiBar({ kind: 'head', label: p.label, id: `an-arm-head-${i}`, lead: { title: p.label, level: 'h3' }, overflow: [{ id: `an-arm-rm-${i}`, label: 'Two arms only', attrs: { 'data-arm-rm': true } }] })}
      <div class="an-settings">
        <label class="field"><span>Treated arms</span><input data-arm-labels value="${esc(m.arms.map(a => a.label).join('; '))}" aria-label="Treated arms"></label>
        <label class="field"><span>Control</span><input data-arm-control value="${esc(m.control || '')}" aria-label="Control"></label>
        <label class="field"><span>Comparison</span><select data-arm-how aria-label="Comparison">${how(m).map(([v, l]) => `<option value="${esc(v)}"${v === h ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Reason</span><input data-arm-reason value="${esc(m.reason || '')}" aria-label="Reason"></label></div></div>`; };
  return { title: 'Multi-arm studies', meta: list.length ? String(list.length) : '', html: `${list.map(row).join('')}
      ${others.length ? `<div class="an-settings"><label class="field"><span>Add a study</span><select data-arm-add aria-label="Add a study with several treated arms">
        <option value="">—</option>${others.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select></label></div>` : ''}`,
    wire: el => {
      const labels = v => v.split(/;|\n/).map(x => x.trim()).filter(Boolean);
      el.querySelectorAll('[data-arm-study]').forEach(node => {
        const id = node.dataset.armStudy, m = () => multiArmOf(get(), id);
        node.querySelector('[data-arm-labels]').onchange = e => { const l = labels(e.target.value); if (l.length < 2) { e.target.value = m().arms.map(a => a.label).join('; '); return; } update(st => setArms(st, id, l, m().control)); ctx?.rerender(); };
        node.querySelector('[data-arm-control]').onchange = e => { update(st => setArms(st, id, m().arms.map(a => a.label), e.target.value)); ctx?.rerender(); };
        node.querySelector('[data-arm-how]').onchange = e => { update(st => setHandling(st, id, e.target.value, null)); ctx?.rerender(); };
        node.querySelector('[data-arm-reason]').onchange = e => { update(st => setHandling(st, id, null, e.target.value)); };
        node.querySelector('[data-arm-rm]').onclick = async () => {
          if (!await confirmAsk(`${get().papers.find(p => p.id === id)?.label}: two arms only?`, { detail: 'The first treated arm keeps its values; the other arms’ inputs stay in Extraction but are not pooled.', confirm: 'Two arms only' })) return;
          update(st => setArms(st, id, [])); ctx?.rerender(); ctx?.refreshCounts?.();
        };
      });
      el.querySelector('[data-arm-add]')?.addEventListener('change', async e => {
        const id = e.target.value; if (!id) return;
        const names = await ask('Treated arms', { placeholder: 'e.g. Low dose; High dose', confirm: 'Next' });
        if (!names || labels(names).length < 2) { e.target.value = ''; return; }
        const control = await ask('Control arm', { placeholder: 'e.g. Placebo', confirm: 'Add' });
        if (control == null) { e.target.value = ''; return; }
        update(st => setArms(st, id, labels(names), control)); ctx?.rerender(); ctx?.refreshCounts?.();
      });
    } };
}

// A row's inputs as the table shows them: a split control's share to two decimals.
const cellNum = v => (Number.isInteger(v) ? String(v) : Number.isFinite(v) ? String(Number(v.toFixed(2))) : String(v));
// The model's name where a result is shown.
const methodLabel = m => ({ MH: 'Mantel–Haenszel', PETO: 'Peto', GLMM: 'GLMM' })[m] || m;
// Arm sizes among a measure's inputs, for the participants a result covers.
const ARM_N = { binary: [1, 3], continuous: [2, 5] };

function reportedPanel(s, measure, slot) {
  if (measureOf(measure).family !== 'reported') return '';
  const numeric = [['effect_estimate', 'Estimate'], ['effect_se', isRatio(measure) ? 'SE of log estimate' : 'SE'],
    ['effect_lo', 'CI lower'], ['effect_hi', 'CI upper'], ['effect_confidence', 'CI level (%)'], ['effect_df', 'CI degrees of freedom (optional)']];
  const metadata = [['effect_population', 'Population'], ['effect_contrast', 'Contrast / coefficient unit'],
    ['effect_adjustment', 'Model / adjustment variables'], ['effect_source', 'Source / table / model']];
  const record = p => {
    const r = reportedEffect(s, p.id, measure, slot), raw = r.raw;
    const control = (base, label, options = null) => {
      const value = raw[base] ?? '', disabled = isLocked(s, `${p.id}:${fieldFor(base, slot)}`) ? ' disabled' : '';
      const attrs = `data-reported-paper="${esc(p.id)}" data-reported-field="${base}" data-form-key="${esc(`reported:${p.id}:${fieldFor(base, slot)}`)}" aria-label="${esc(`${p.label || p.id}: ${label}`)}"${disabled}${disabled ? ' title="Locked accepted value"' : ''}`;
      return `<label class="field"><span>${esc(label)}</span>${options
        ? `<select ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(value || (base === 'effect_uncertainty' ? r.uncertainty : '')).toLowerCase() === v.toLowerCase() ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input ${attrs} type="${numeric.some(([f]) => f === base) ? 'number' : 'text'}"${numeric.some(([f]) => f === base) ? ' step="any"' : ''} value="${esc(value)}"${base === 'effect_confidence' ? ' placeholder="95" min="0" max="100"' : base === 'effect_se' || base === 'effect_df' ? ' min="0"' : ''}>`}</label>`;
    };
    return `<details class="phase spaced" data-edit-record="${esc(`reported:${p.id}:${slot}`)}"${r.incomplete || r.invalid ? ' open' : ''}><summary>${esc(p.label || p.id)}, ${r.invalid ? 'invalid' : r.incomplete ? 'incomplete' : 'complete'}</summary>
      <div class="an-settings spaced">${control('effect_uncertainty', 'Uncertainty', [['SE', 'Reported SE'], ['CI', 'Symmetric Wald / t CI']])}
        ${numeric.filter(([f]) => f === 'effect_estimate' || (r.uncertainty === 'SE' ? f === 'effect_se' : f !== 'effect_se')).map(([f,l]) => control(f,l)).join('')}</div>
      <div class="an-settings">${control('effect_adjustment_type', 'Estimate type', [['', 'Choose'], ['adjusted', 'Adjusted'], ['unadjusted', 'Unadjusted']])}
        ${metadata.map(([f,l]) => control(f,l)).join('')}</div>
      ${r.errors.length ? `<div class="note">${esc(r.errors.join('; '))}</div>` : ''}</details>`;
  };
  return `<div class="panel"><div class="panel-head"><h2>Reported models</h2></div><div class="panel-body">
    <p data-ui-help>Enter one compatible model per study. Keep alternative populations or adjustments as separate outcomes. Ratios require log-scale SEs.</p>
    ${includedStudies(s).map(record).join('')}
    <div class="an-settings spaced"><label class="field"><span>Plan for mixing adjustment types</span>
      <input id="reported-mix-reason" value="${esc(s.reportedEffectMix?.[slot] || '')}"></label></div>
    </div></div>`;
}

function wireReported(el, ctx, slot) {
  el.querySelectorAll('[data-reported-field]').forEach(x => x.onchange = () => {
    setManualValue(x.dataset.reportedPaper, fieldFor(x.dataset.reportedField, slot), x.value); rerenderForm(el, ctx); ctx.refreshCounts?.();
  });
  el.querySelector('#reported-mix-reason')?.addEventListener('change', e => {
    update(s => { s.reportedEffectMix ||= {}; s.reportedEffectMix[slot] = e.target.value.trim(); return s; }); rerenderForm(el, ctx);
  });
}

/** The result's one-line description: measure, model, interval, studies, timepoint. */
const resultMeta = a => `${effectName(a.measure)}, ${methodLabel(a.method)}${isHK(a.settings?.ci ?? a.test) ? `, Hartung–Knapp${(a.settings?.ci ?? a.test) === 'adhoc' ? ' (guarded)' : ''}` : ''}, k = ${a.k}${a.timepoint ? `, ${a.timepoint}` : ''}`;

/** What a pooled effect's Run would pool: the studies ready, whether Run must wait, and the count the title bar shows beside the title. */
function pairwiseState(s, slot) {
  const inputs = pooledInputs(s, '', opt('measure'), slot), { ready, incomplete, invalid, units } = inputs;
  const blocked = units.length < 2, mixBlocked = !!inputs.mix?.blocked;
  const count = `${ready.length} of ${ready.length + incomplete.length + invalid.length} complete`;
  const withRows = units.length > ready.length && `${count}, ${units.length} comparisons`.length <= 24 ? `${count}, ${units.length} comparisons` : count;
  return { inputs, blocked, mixBlocked, status: blocked || mixBlocked ? count : withRows };
}
/** A pooled effect's part of the title bar: how many studies are complete, Run, and the input download in More. */
function pairwisePage(s, title, slot) {
  const st = pairwiseState(s, slot);
  return { title,
    actions: [{ id: 'run', label: 'Run', icon: 'run', role: 'primary', disabled: st.blocked || st.mixBlocked, run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'csv', label: 'Download inputs', run: () => acts.csv?.() }] };
}
// Run and the input download are the title bar's: the page drawn last binds what they act on.
const acts = {};

function renderPairwise(el, ctx, slot = PRIMARY) {
  const oid = outcomeById(get(), slot).id, analysis = analysisOf(get(), slot);
  const { inputs, blocked, mixBlocked } = pairwiseState(get(), slot);
  const { ready, incomplete, invalid, units } = inputs;
  const missing = incomplete.length;
  const inputStatus = pooledInputStatus(get(), analysis, slot);
  const notEstimable = zeroEvents(opt('measure'), units.map(u => u.values)).excluded;
  const tps = timepointsOf(get(), oid), tp = tpOf();
  // what Run waits for, with the labels joined by " · " (they carry commas of their own)
  const need = needed().map(inputLabel);

  // the inputs are a grid typed in place (./analysis-grid.mjs); a reported model keeps its per-study forms above and the table below
  const grid = gridApplies(opt('measure'));
  el.innerHTML = `${reportedPanel(get(), opt('measure'), slot)}<div class="panel">
    ${grid ? uiBar({ kind: 'head', label: 'Inputs', id: 'an-inputs-head', lead: { title: 'Inputs' }, message: { id: 'an-inputs-msg', text: gridMessage() } }) : ''}
    ${tps.length > 1 ? uiBar({ kind: 'tools', label: 'Timepoint', id: 'an-tp-tools', filters: [{ type: 'select', id: 'an-tp', label: 'Timepoint', value: tp, options: tps.map(t => [t.id, t.label || t.id]) }] }) : ''}
    <div class="panel-body">
      ${blocked ? uiNotice({ id: 'an-blocked', label: 'Study inputs', text: `Needs ${need.join('; ')} in at least two studies.`, actions: [{ id: 'an-fix-inputs', label: 'Review extraction', icon: 'extraction' }] }) : ''}
      ${grid ? gridHtml(opt('measure'), slot, `Inputs: ${outcomeById(get(), slot).name}${timepointLabel(get(), slot) ? `, ${timepointLabel(get(), slot)}` : ''}`)
        : blocked ? '' : `<table><thead><tr><th class="grow">Study</th>${needed().map(f => `<th>${esc(inputLabel(f))}</th>`).join('')}</tr></thead>
           <tbody>${units.map(u => `<tr><td class="grow">${u.contrast ? `<span class="an-contrast">${esc(u.label)}</span>` : studyCell(u.paper, { open: true, titleLine: false })}</td>${u.values.map(v =>
             `<td>${esc(cellNum(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
      ${missing ? `<div class="note spaced">${missing} incomplete</div>` : ''}
      ${invalid.length ? `<div class="note spaced">${invalid.length} invalid ${invalid.length === 1 ? 'row' : 'rows'}</div>` : ''}
      ${mixBlocked ? '<div class="note spaced">Combining adjusted and unadjusted estimates requires a recorded plan.</div>' : ''}
      ${notEstimable.length ? `<div class="note spaced">${notEstimable.length} not estimable; zero events, both arms</div>` : ''}
    </div></div>
    <div class="panel" id="out" ${analysis ? '' : 'hidden'}>
      ${uiBar({ kind: 'head', label: 'Result', id: 'an-result-head', lead: { title: 'Result' }, message: analysis ? { id: 'rmeta', text: resultMeta(analysis) } : { id: 'rmeta', text: '' },
        actions: [{ id: 'interpret', label: 'Results text', icon: 'sparkle', disabled: inputStatus !== 'current' }] })}
      <div class="panel-body">${inputStatus === 'stale' ? '<div class="note">Inputs changed, run again</div>' : inputStatus === 'untracked' ? '<div class="note">Input record unavailable, run again</div>' : ''}<div id="summary"></div><div id="interp"></div><div id="methodsHost"></div></div>
    </div>
    <div id="forestHost" ${analysis ? '' : 'hidden'}>${figurePanel({ title: 'Forest plot', id: 'forest', zoom: !(analysis && forestData(analysis)) })}</div>
    <div class="panel" id="modHost" hidden>
      <div class="panel-head"><h2>Subgroups</h2><span class="meta"></span></div>
      <div class="panel-body tight"></div>
    </div>
    <div id="sensHost"></div>
    <div id="funnelHost" hidden>${extraSection({ id: 'funnel', title: 'Funnel plot', body: figurePanel({ title: 'Funnel plot', id: 'funnel', zoom: !(analysis && funnelInputs(analysis)) }) })}</div>
    <div id="extrasHost">${analysis ? extrasHtml() : ''}</div>`;

  if (analysis) show(analysis);
  trackSections(el);

  wireStudies(el, ctx);
  if (grid) wireGrid(el, ctx, opt('measure'), slot);
  wireReported(el, ctx, slot);
  el.querySelector('#an-tp')?.addEventListener('change', e => { tpBy[oid] = e.target.value; ctx.rerender(); });
  el.querySelector('#interpret')?.addEventListener('click', async () => {
    const a = analysisOf(get(), slot); if (!a) return;
    if (pooledInputStatus(get(), a, slot) !== 'current') return;
    const b = el.querySelector('#interpret'), host = el.querySelector('#interp'); b.disabled = true;
    try {
      const linked = linkedResultParagraph(a, resultPrefix(slot));
      const byKey = new Map(allResults(get()).map(r => [r.key, r.text]));
      const text = linked.replace(/\{\{([A-Za-z0-9._:-]+)\}\}/g, (_, key) => byKey.get(key) ?? `{{${key}}}`);
      host.innerHTML = proposalBox({ id: 'interp-prop', title: 'Results paragraph', meta: 'calculated', accept: 'Insert into manuscript', body: esc(text) });
      host.querySelector('[data-discard]').onclick = () => { host.innerHTML = ''; };
      host.querySelector('[data-accept]').onclick = () => {
        if (pooledInputStatus(get(), a, slot) !== 'current') { host.textContent = 'Inputs changed, run again'; return; }
        update(st => {
          st.manuscript = st.manuscript || { blocks: [], snapshot: {} };
          st.manuscript.snapshot = st.manuscript.snapshot || {};
          const byKey = new Map(allResults(st).map(r => [r.key, r]));
          for (const token of resultTokens(linked)) st.manuscript.snapshot[token.key] = byKey.get(token.key)?.text;
          const blocks = st.manuscript.blocks;
          const at = blocks.findIndex(x => /^h/.test(x.type) && /results/i.test(x.text));
          let end = at < 0 ? blocks.length : at + 1;
          while (end < blocks.length && !/^h/.test(blocks[end].type)) end++;
          blocks.splice(end, 0, blankBlock('p', linked));
          return st;
        });
        host.innerHTML = ''; ctx.refreshCounts();
      };
    } catch (err) { host.textContent = err.message.slice(0, 120); }
    b.disabled = false;
  });
  acts.csv = () => {
    const cols = needed();
    const reported = measureOf(opt('measure')).family === 'reported';
    const out = [['Study', 'Comparison', ...cols.map(inputLabel), ...(reported ? ['Population', 'Estimate type', 'Adjustment variables', 'Source', 'Uncertainty input', 'Reported CI lower', 'Reported CI upper', 'Reported CI level (%)', 'Reported CI df'] : [])]];
    for (const u of units) out.push([u.paper.label, u.contrast ? u.label : '', ...u.values,
      ...(reported ? [u.identity.population, u.identity.adjustmentType, u.identity.adjustment, u.identity.source, u.uncertainty, u.raw.effect_lo, u.raw.effect_hi, u.raw.effect_confidence ?? 95, u.raw.effect_df] : [])]);
    downloadCsv(out, 'analysis-input.csv');
  };
  el.querySelector('#an-fix-inputs')?.addEventListener('click', () => ctx.go('extraction'));
  acts.run = async btn => {
    if (pooledInputs(get(), '', opt('measure'), slot).snapshot !== inputs.snapshot) { ctx.rerender(); return; }
    const measure = opt('measure'), method = opt('method'), rare = isRare(method);
    if (inputs.mix?.blocked) { ctx.rerender(); return; }
    // Hartung–Knapp(–Sidik–Jonkman): t-based intervals with a variance scaled
    // by the residual heterogeneity (plan I5, inference method). A random-effects
    // setting only; under a common effect there is no τ² to inflate for.
    const test = testFor(method, opt('test')), pi = piFor(method, opt('pi'));
    const knha = isHK(test) ? `, test="${test}"` : '';
    // Rows with no events in either arm are not estimable for a ratio; the
    // rest are pooled, and the zero-event handling is recorded (plan I4).
    const all = units.map(u => u.values);
    const zero = zeroEvents(measure, all);
    const used = zero.used.map(i => units[i]);
    const usedPapers = [...new Set(used.map(u => u.paper))];
    const resultHost = el.querySelector('#out'), summaryHost = el.querySelector('#summary');
    const say = t => { if (summaryHost) summaryHost.textContent = t; if (resultHost) resultHost.hidden = false; };
    if (used.length < 2) { say(`${used.length} estimable ${used.length === 1 ? 'row' : 'rows'}, two are needed`); return; }
    // The rare-event models pool the counts themselves: the 0.5 correction
    // touches only the study estimates they show and their Q.
    const zeroText = method === 'GLMM' ? 'No continuity correction in the model; the study estimates drawn add 0.5 to a zero cell' : rare ? rareZeroText(method, measure, units.map(u => u.label), zero) : zeroEventsText(measure, units.map(u => u.label), zero);
    const modFound = opt('moderator') ? moderatorCandidates(get(), usedPapers, needed()).find(m => m.field.id === opt('moderator')) : null;
    const mod = modFound && isRare(method) && modFound.kind !== 'group' ? null : modFound;
    const modId = mod ? mod.field.id : '';
    const modVals = mod ? used.map(u => valueFor(get(), u.paper.id, mod.field)) : [];
    const inputSnapshot = pooledInputs(get(), modId, measure, slot).snapshot;
    const guard = analysisRunGuard(get, s => pooledInputs(s, modId, measure, slot).snapshot, projectGeneration);
    const atLabel = timepointLabel(get(), slot), armsLabel = multiArmText(get(), usedPapers, measure);
    const outcomeName = `${outcomeById(get(), slot).name}${atLabel ? ` at ${atLabel}` : ''}`;
    // Mantel–Haenszel or Peto by subgroup: each level pooled the same way (rma.mh / rma.peto on its subset), and the test for subgroup
    // differences as RevMan computes it: Q across the levels' estimates with their inverse variances (rma(method = "EE") on them), G − 1 df
    const rareArgs = isRare(method) ? escArgs(measure, zero.used.map(i => all[i])) : '';
    const rareModR = !(mod && isRare(method)) ? '' : `g <- factor(c(${modVals.map(v => JSON.stringify(String(v))).join(',')}))
      lv <- levels(g)
      sub <- lapply(lv, function(l) ${method === 'MH' ? `rma.mh(${rareArgs}, measure="${escalcName(measure)}", subset=(g==l))` : `rma.peto(${rareArgs}, subset=(g==l))`})
      rg <- rma(yi=sapply(sub, function(m) m$beta[1]), sei=sapply(sub, function(m) m$se), method="EE")`;
    const modR = !mod ? '' : isRare(method) ? rareModR : mod.kind === 'group'
      ? `g <- factor(c(${modVals.map(v => JSON.stringify(String(v))).join(',')}))
      rg <- rma(yi, vi, mods=~g, data=d, method="${method}"${knha})
      lv <- levels(g)
      sub <- lapply(lv, function(l) rma(yi, vi, data=d, subset=(g==l), method="${method}"${knha}))`
      : `x <- c(${modVals.map(Number).join(',')})
      rg <- rma(yi, vi, mods=~x, data=d, method="${method}"${knha})`;
    const modOut = !mod ? '' : isRare(method)
      ? `, mod_kind = "group", mod_levels = lv, mod_k = sapply(sub, function(m) m$k), mod_est = sapply(sub, function(m) tf(m$beta[1])),
        mod_lo = sapply(sub, function(m) tf(m$ci.lb)), mod_hi = sapply(sub, function(m) tf(m$ci.ub)), mod_i2 = sapply(sub, function(m) m$I2),
        qm = rg$QE, qmp = rg$QEp, qm_df = length(lv) - 1`
      : mod.kind === 'group'
      ? `, mod_kind = "group", mod_levels = lv, mod_k = sapply(sub, function(m) m$k), mod_est = sapply(sub, function(m) tf(m$beta[1])),
        mod_lo = sapply(sub, function(m) tf(m$ci.lb)), mod_hi = sapply(sub, function(m) tf(m$ci.ub)), mod_i2 = sapply(sub, function(m) m$I2),
        qm = rg$QM, qmp = rg$QMp, qm_df = rg$QMdf[1]`
      : `, mod_kind = "numeric", slope = ${isRatio(measure) ? 'exp(rg$beta[2])' : 'rg$beta[2]'}, slope_lo = ${isRatio(measure) ? 'exp(rg$ci.lb[2])' : 'rg$ci.lb[2]'},
        slope_hi = ${isRatio(measure) ? 'exp(rg$ci.ub[2])' : 'rg$ci.ub[2]'}, slope_p = rg$pval[2], qm = rg$QM, qmp = rg$QMp, r2 = rg$R2`;
    // escalc's own argument names for this measure's inputs, from the accepted values.
    // A split control's share is exact (not rounded): 17 events over two comparisons is 8.5 each.
    const byStudy = zero.used.map(i => all[i]);
    const labs = used.map(u => JSON.stringify(u.label)).join(',');
    const family = measureOf(measure).family;
    const participants = ARM_N[family] ? used.reduce((t, u) => t + ARM_N[family].reduce((n, i) => n + u.values[i], 0), 0) : null;
    const at = atLabel, arms = armsLabel;
    const buildA = res => ({ ...res, values: byStudy, measure, method, test, settings: settingsOf({ method, test, pi, measure }), labels: used.map(u => u.label), papers: used.map(u => u.paper.id),
      ...(family === 'reported' ? { reportedIdentities: used.map(u => ({ paperId: u.paper.id, ...u.identity, uncertainty: u.uncertainty, reported: u.raw })), reportedMixReason: inputs.mix.reason } : {}),
      ...(mod?.kind === 'group' ? { modValues: modVals.map(v => (v == null ? null : String(v))) } : {}), contrasts: used.map(u => u.contrast || ''), moderator: modId || '', moderatorLabel: mod?.field.label || '', inputSnapshot,
      zeroEvents: zeroText, excluded: zero.excluded.map(i => units[i].label), excludedValues: zero.excluded.map(i => all[i]),   // their counts, for a layout that prints them (lib/revman-forest.mjs)
      ...(participants != null ? { participants } : {}), ...(arms ? { multiArm: arms } : {}),
      ...(slot === PRIMARY ? {} : { outcomeId: slot, outcomeName, ...(at ? { timepoint: at } : {}) }), at: new Date().toISOString() });
    // At once where the JavaScript pool gives metafor's numbers (lib/meta-general.mjs: every measure but Freeman–Tukey, REML, DL or EE, z or
    // Hartung–Knapp, subgroups or a numeric moderator; checked against native metafor to 1e-9): kept now, R behind it. R's result then takes
    // its place with what only R gives (the τ² interval, Egger, leave-one-out, sensitivity, R's figures) and records how far the two differed.
    // Mantel–Haenszel and Peto (lib/meta-rare.mjs, metafor's own formulas, checked to 1e-9) and the GLMM of a proportion (lib/meta-glmm.mjs,
    // lme4's likelihood maximised; R's to 5e-5) likewise
    const js = isRare(method) ? (!handlesRare({ measure, method }) ? null : mod ? poolRareGroups({ measure, method, values: byStudy, groups: modVals.map(String) }) : poolRare({ measure, method, values: byStudy }))
      : method === 'GLMM' ? poolGlmm(byStudy, { mod: mod ? { kind: mod.kind, values: modVals } : null })
      : handlesGeneral({ measure, method, test, pi })
        ? poolGeneral({ measure, method, test, pi, values: byStudy, mod: !mod ? null : mod.kind === 'group' ? { kind: 'group', values: modVals.map(v => String(v)) } : { kind: 'numeric', values: modVals } })
        : null;
    if (js) {
      update(s => saveAnalysis(s, slot, { ...buildA(js), engine: 'js', checking: true }));
      ctx.rerender();
    }
    btn.disabled = true;
    let res;
    try {
      res = await runR(method === 'GLMM' ? ['metafor', 'svglite', 'lme4'] : ['metafor', 'svglite'], method === 'GLMM' ? glmmScript({ values: byStudy, labels: used.map(u => u.label), mod: mod ? { kind: mod.kind, values: modVals } : null, label: 'Proportion' }) : `
      ${fitR({ measure, method, test, values: byStudy })}
      ${mod && mod.kind === 'group' && !isRare(method) ? `
      g <- factor(c(${modVals.map(v => JSON.stringify(String(v))).join(',')}))
      lv <- levels(g); ns <- as.integer(table(g)[lv]); m <- length(lv)
      # rows count upward; the first level sits at the top: for each level a
      # header row, its studies, a polygon row, and a gap
      pos <- 1; polyrows <- integer(m); heads <- integer(m); rowsets <- vector("list", m)
      for (i in rev(seq_len(m))) { polyrows[i] <- pos; rowsets[[i]] <- seq(pos + 1, pos + ns[i]); heads[i] <- pos + ns[i] + 1; pos <- pos + ns[i] + 3 }
      rowsvec <- unlist(rowsets)
      svglite("/tmp/forest.svg", width=8.5, height=${1.8 + used.length * 0.42} + 0.6 * ${mod.levels.length})
      forest(r, slab=c(${labs}), header="Study", order=g, rows=rowsvec, ylim=c(-1.5, pos + 1),
             ${backTransform(measure) ? `atransf=${backTransform(measure)},` : ''} xlab="${measure}")
      subs <- lapply(lv, function(l) rma(yi, vi, data=d, subset=(g==l), method="${method}"${knha}))
      for (i in seq_len(m)) addpoly(subs[[i]], row=polyrows[i], mlab=paste0(lv[i], " (k = ", ns[i], ")"), ${backTransform(measure) ? `atransf=${backTransform(measure)},` : ''} cex=0.9)
      text(par("usr")[1], heads, lv, pos=4, font=4, cex=0.9)
      dev.off()` : `
      svglite("/tmp/forest.svg", width=8.5, height=${1.6 + used.length * 0.42})
      forest(r, slab=c(${labs}), header="Study",${rare ? ` mlab="${methodLabel(method)} model",` : ''}
             ${backTransform(measure) ? `atransf=${backTransform(measure)},` : ''} xlab="${measure}")
      dev.off()`}
      paste(readLines("/tmp/forest.svg"), collapse="\\n") -> svg
      # What a reader asks next: how wide the true effects spread (prediction
      # interval), whether small studies differ (funnel, Egger), and whether one
      # study carries the result (leave one out). Each needs enough studies;
      # what cannot be computed is returned as NULL, not as a number.
      tf <- function(x) ${backTransform(measure) ? `${backTransform(measure)}(x)` : 'x'}
      pr <- predict(r)
      ${heterogeneityR({ random: !rare && method !== 'EE', pi })}
      eg <- if (r$k >= 3) tryCatch(regtest(r), error=function(e) NULL) else NULL
      loo <- if (r$k >= 3) tryCatch(leave1out(r), error=function(e) NULL) else NULL
      num_or_null <- function(x) if (is.null(x) || length(x) == 0 || is.na(x[1])) NULL else x[1]
      ${modR}
      svglite("/tmp/funnel.svg", width=6, height=4.6)
      funnel(r, ${backTransform(measure) ? `atransf=${backTransform(measure)},` : ''} xlab="${measure}")
      dev.off()
      paste(readLines("/tmp/funnel.svg"), collapse="\\n") -> funnel_svg
      ${sensitivityR({ measure, labels: used.map(u => u.label), years: used.map(u => u.paper.year) })}
      c(list(
        estimate = tf(r$beta[1]), lo = tf(r$ci.lb), hi = tf(r$ci.ub),
        # a common-effect model assumes one true effect: no spread to predict
        pi_lo = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[1]) else tf(pr$pi.lb), pi_hi = if (${rare ? 'TRUE' : 'FALSE'} || r$method == "EE") NULL else if (!is.null(het_pt)) tf(het_pt[2]) else tf(pr$pi.ub),
        i2 = r$I2, tau2 = r$tau2, q = r$QE, qp = r$QEp, k = r$k, svg = svg, funnel = funnel_svg,
        # the study effects and the pooled effect on the analysis scale, for the diagnostics drawn from them (lib/diagnostics.mjs)
        mu = r$beta[1], mu_lb = r$ci.lb, mu_ub = r$ci.ub, yi = as.numeric(d$yi), vi = as.numeric(d$vi),
        # each study on the measure's scale, for the paged forest plot on screen (lib/forest-page.mjs)
        study_est = as.numeric(tf(d$yi)), study_lo = as.numeric(tf(d$yi - qnorm(0.975) * sqrt(d$vi))), study_hi = as.numeric(tf(d$yi + qnorm(0.975) * sqrt(d$vi))),
        weights = as.numeric(weights(r)),
        # Mantel–Haenszel with an odds ratio: the Cochran–Mantel–Haenszel test and Tarone's test for heterogeneity
        cmh = ${method === 'MH' ? 'num_or_null(r$CO)' : 'NULL'}, cmhp = ${method === 'MH' ? 'num_or_null(r$COp)' : 'NULL'},
        tarone = ${method === 'MH' ? 'num_or_null(r$TA)' : 'NULL'}, taronep = ${method === 'MH' ? 'num_or_null(r$TAp)' : 'NULL'},
        egger_z = if (is.null(eg)) NULL else eg$zval, egger_p = if (is.null(eg)) NULL else eg$pval,
        loo_est = if (is.null(loo)) NULL else as.numeric(tf(loo$estimate)), loo_lo = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.lb)),
        loo_hi = if (is.null(loo)) NULL else as.numeric(tf(loo$ci.ub)), loo_i2 = if (is.null(loo)) NULL else as.numeric(loo$I2)${modOut}), het, sens)
    `, js ? () => {} : say);
    } catch (err) {
      // An R error (a model that does not converge, a package that fails to
      // load) is shown where the result would be, and Run stays usable.
      if (js) { update(s => { const was = analysisOf(s, slot); if (was?.checking) saveAnalysis(s, slot, { ...was, checking: false }); return s; }); return; }
      say(String(err?.message || err).slice(0, 160));
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    const discarded = guard.reason();
    if (discarded) { if (guard.belongs()) { say(discarded); ctx.refreshCounts?.(); } return; }
    // One funnel: the contour-enhanced one when it could be drawn, in place of the plain one.
    if (res.contour_svg) { res.funnel = res.contour_svg; delete res.contour_svg; }
    for (const k of ['svg', 'funnel', 'tf_svg', 'cumul_svg', 'baujat_svg']) if (res[k]) res[k] = compactSvg(res[k]);
    const rel = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / Math.max(Math.abs(y), 1e-12) : 0);
    const a = { ...buildA(res), ...(js ? { engine: 'r', jsCheck: Math.max(...['estimate', 'lo', 'hi', 'tau2', 'i2', 'q', 'qp'].map(k => rel(js[k], res[k]))) } : {}) };
    update(s => saveAnalysis(s, slot, a));
    if (btn.isConnected !== false || (js && el.isConnected)) ctx.rerender(); else ctx.refreshCounts?.();
  };

  function show(a) {
    const f = (x, d = 2) => Number(x).toFixed(d);
    el.querySelector('#out').hidden = false;
    el.querySelector('#rmeta').textContent = resultMeta(a);
    el.querySelector('#summary').innerHTML =
      `<table><tbody>
        <tr><th>Pooled ${esc(effectName(a.measure))}</th><td>${f(a.estimate)} [${f(a.lo)}, ${f(a.hi)}]</td></tr>
        ${a.pi_lo != null ? `<tr><th>95% prediction interval</th><td>${f(a.pi_lo)} to ${f(a.pi_hi)}</td></tr>` : ''}
        ${isRare(a.method) ? `<tr><th>Model</th><td>${a.method === 'MH' ? 'Mantel–Haenszel, common effect' : "Peto's one-step odds ratio, common effect"}</td></tr>` : ''}
        ${heterogeneityRows(a).map(([l, t]) => `<tr><th>${l}</th><td>${esc(t)}</td></tr>`).join('')}
        ${a.zeroEvents ? `<tr><th>Zero events</th><td>${esc(a.zeroEvents)}</td></tr>` : ''}
        ${a.multiArm ? `<tr><th>Multi-arm studies</th><td>${esc(a.multiArm)}</td></tr>` : ''}
      </tbody></table>`;
    // the methods are part of the result: one panel, the methods under the numbers
    const diffs = revmanDifferences(a);
    el.querySelector('#methodsHost').innerHTML = extraSection({ id: 'methods', title: 'Methods used', meta: a.settings ? 'Recorded with the result' : 'Run before settings were recorded', open: true,
      body: `<table><tbody>${[...methodsUsed(a), ...extrasMethods(a)].map(([l, t]) => `<tr><th>${esc(l)}</th><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      ${diffs.length ? `<table><thead><tr><th class="grow">Differs from RevMan 2025</th><th>RevMan</th><th>This result</th></tr></thead>
        <tbody>${diffs.map(([l, r, t]) => `<tr><td class="grow">${esc(l)}</td><td>${esc(r)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${a.reportedIdentities?.length ? `<table><thead><tr><th>Study</th><th>Population</th><th>Contrast</th><th>Adjustment</th><th>Source</th></tr></thead><tbody>
        ${a.reportedIdentities.map((r,i) => `<tr><td>${esc(a.labels?.[i] || r.paperId)}</td><td>${esc(r.population)}</td><td>${esc(r.contrast)}</td><td>${esc([r.adjustmentType,r.adjustment].filter(Boolean).join(', '))}</td><td>${esc(r.source)}</td></tr>`).join('')}</tbody></table>
        ${a.reportedMixReason ? `<div class="note spaced">${esc(a.reportedMixReason)}</div>` : ''}` : ''}
      ${a.measure === 'PFT' ? `<div class="note" data-ui-help>${FT_WARNING}</div>` : ''}` });
    el.querySelector('#forestHost').hidden = false;
    // Rows are found by the study each came from; a label two rows share opens neither.
    const paperOf = i => a.papers?.[i] || (() => { const m = units.filter(u => u.label === a.labels?.[i]); return m.length === 1 ? m[0].paper.id : null; })();
    // Paged from the result's own numbers; the R figure is the download and the fallback for a result drawn before them.
    // The project's figure style decides the drawing: the house forest, or RevMan Web's layout when the style sidecar assigns
    // `asd-revman` to forests (lib/revman-forest.mjs). The sidecar is read once per project and the figure redrawn when it says so.
    const forestOpts = { rSvg: a.svg || null, labels: a.labels, study: paperOf, open: pid => openStudy(ctx, pid), whole: a.svg ? async () => a.svg : null };
    const pico = get().protocol?.pico || {};
    const revman = { experimental: pico.intervention || 'Experimental', control: pico.comparator || 'Control', favours: [`Favors ${pico.intervention || 'experimental'}`, `Favors ${pico.comparator || 'control'}`] };
    const mountStyled = style => mountForest(el, 'forest', a, { ...forestOpts, ...(style ? { style, revman } : {}) });
    const cached = forestStyleCache?.key === (get().project?.id || '') ? forestStyleCache.tokens : null;
    mountStyled(cached?.id === 'asd-revman' ? cached : null);
    if (!cached) forestStyleOf().then(t => { if (t?.id === 'asd-revman' && el.isConnected && el.querySelector('#forest')) mountStyled(t); }).catch(() => {});
    const fh = el.querySelector('#funnelHost'); if (fh) { fh.hidden = !hasFunnel(a); if (!fh.hidden) mountFunnel(el, 'funnel', a, { study: paperOf, open: pid => openStudy(ctx, pid) }); }
    const sh = el.querySelector('#sensHost'); if (sh) { const panels = sensitivityPanels(a); sh.innerHTML = panels ? extraSection({ id: 'sens', title: 'Sensitivity analyses', body: panels }) : ''; wireSensitivity(sh, a); }
    mountExtras(el.querySelector('#extrasHost'), ctx, a, slot);
    const mh = el.querySelector('#modHost');
    if (mh) {
      const vec = v => Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v];
      mh.hidden = !a.mod_kind;
      if (a.mod_kind === 'group') {
        const lv = vec(a.mod_levels), k = vec(a.mod_k), est = vec(a.mod_est), lo = vec(a.mod_lo), hi = vec(a.mod_hi), i2 = vec(a.mod_i2);
        mh.querySelector('h2').textContent = `Subgroups by ${a.moderatorLabel}`;
        mh.querySelector('.meta').textContent = `test for differences Q = ${f(a.qm)}, df = ${a.qm_df}, p = ${f(a.qmp, 3)}`;
        mh.querySelector('.panel-body').innerHTML = `<table><thead><tr><th class="grow">Subgroup</th><th>k</th><th>Pooled ${esc(a.measure)}</th><th>I²</th></tr></thead>
          <tbody>${lv.map((l, i) => `<tr><td class="grow">${esc(l)}</td><td>${k[i]}</td><td>${f(est[i])} [${f(lo[i])}, ${f(hi[i])}]</td><td>${f(i2[i], 1)}%</td></tr>`).join('')}</tbody></table>`;
      } else if (a.mod_kind === 'numeric') {
        mh.querySelector('h2').textContent = `Meta-regression on ${a.moderatorLabel}`;
        mh.querySelector('.meta').textContent = `Q = ${f(a.qm)}, p = ${f(a.qmp, 3)}`;
        mh.querySelector('.panel-body').innerHTML = `<table><tbody>
          <tr><th>${esc(a.measure)} per unit</th><td>${f(a.slope)} [${f(a.slope_lo)}, ${f(a.slope_hi)}]</td></tr>
          <tr><th>p</th><td>${f(a.slope_p, 3)}</td></tr>
          ${a.r2 != null ? `<tr><th>R² (heterogeneity explained)</th><td>${f(a.r2, 1)}%</td></tr>` : ''}</tbody></table>`;
      }
    }
  }
}

/**
 * The zero-event record of a rare-event model (plan I4). Mantel–Haenszel and
 * Peto pool the counts with no continuity correction; metafor still adds 0.5
 * to each cell of a study with a zero cell for the study estimates it draws
 * (add = 1/2, to = "only0"), and for Mantel–Haenszel also for Q; Peto's Q is
 * computed from the observed and expected counts and is unaffected (checked
 * in native metafor 5.2.1). Rows with no events in either arm are left out
 * and named, as for the other models.
 */
function rareZeroText(method, measure, labels, { corrected = [], excluded = [] } = {}) {
  const name = i => labels[i] || `Row ${i + 1}`, list = ix => ix.map(name).join(', ');
  const parts = [`${method === 'MH' ? 'Mantel–Haenszel' : 'Peto'} pooled the counts without a continuity correction`];
  // Peto's Q comes from the observed and expected counts, so the correction reaches only the study estimates drawn
  if (corrected.length) parts.push(`0.5 added to each cell of ${corrected.length} ${corrected.length === 1 ? 'study' : 'studies'} with a zero cell only for the study estimates shown${method === 'MH' ? ' and for Q' : ''} (${list(corrected)})`);
  if (excluded.length) parts.push(`${excluded.length} ${excluded.length === 1 ? 'study' : 'studies'} with no events in either arm not estimable for ${measure} and left out (${list(excluded)})`);
  return parts.join('; ');
}

/**
 * The characteristics table a clinical paper opens with: each variable
 * summarised over all patients and within each comparison group.
 *
 * Numeric variables use median (IQR) and a labelled full range; categorical
 * percentages use the variable's observed denominator. Tests remain named.
 */
function descriptives() {
  const rows = participants(), cols = ipdColumns(), groupCol = roleColumn('group')?.id;
  const table = rows.length ? describe(rows, cols, groupCol) : null;
  return { rows, cols, groupCol, table, gs: table ? table.groups : [] };
}
/** The descriptives' part of the title bar: the patients and groups beside the title, the table's download in More. */
function describePage(title) {
  const { rows, table, gs } = descriptives(), nGroups = Math.max(0, gs.length - 1);
  return { title,
    actions: [], overflow: [{ id: 'd-csv', label: 'Download table', disabled: !table, run: descriptivesCsv }] };
}
function descriptivesCsv() {
  const { table, gs, groupCol } = descriptives();
  if (!table) return;
  const out = [['Variable', 'Level', ...gs, ...(groupCol ? ['p', 'Test'] : [])]];
  for (const r of table.rows) {
    if (r.kind === 'numeric') {
      out.push([r.column.name, 'median (IQR)',
        ...gs.map(g => medianIQR(r.slices.find(s => s.name === g))),
        ...(groupCol ? [r.test ? pValue(r.test.p) : '', r.test?.test || ''] : [])]);
      out.push([r.column.name, 'range',
        ...gs.map(g => rangeOf(r.slices.find(s => s.name === g))),
        ...(groupCol ? ['', ''] : [])]);
    } else {
      r.levels.forEach((lv, i) => out.push([r.column.name, lv,
        ...gs.map(g => countPct(r.slices.find(s => s.name === g), lv)),
        ...(groupCol ? [i === 0 && r.test ? pValue(r.test.p) : '',
                        i === 0 ? r.test?.test || '' : ''] : [])]));
    }
    out.push([r.column.name, 'observed n', ...gs.map(g => r.slices.find(s => s.name === g)?.n ?? 0), ...(groupCol ? ['', ''] : [])]);
    out.push([r.column.name, 'missing / invalid n', ...gs.map(g => r.slices.find(s => s.name === g)?.missing ?? 0), ...(groupCol ? ['', ''] : [])]);
  }
  downloadCsv(out, 'characteristics.csv');
}

function renderDescriptives(el, ctx) {
  const { rows, cols, groupCol, table, gs } = descriptives();
  const chartCols = rows.length ? chartableColumns(rows, cols).filter(c => c.id !== groupCol) : [];
  const col = chartCols.find(c => c.id === descCol) || chartCols[0];

  const variablePick = col ? `<select id="d-col" aria-label="Variable">${chartCols.map(c => `<option value="${esc(c.id)}"${c.id === col.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : '';
  el.innerHTML = `<div class="panel">
    <div class="panel-body tight">
      ${!table || !table.rows.length
        ? emptyState({ icon: 'table', title: 'No patient data', actions: [{ id: 'to-patients', label: 'Patient data', icon: 'patients' }] })
        : `<table class="desc"><thead><tr>
            <th class="grow" scope="col">Variable</th>
            ${gs.map(g => `<th class="num" scope="col">${esc(g)}<div class="meta">n = ${table.counts?.[g] ?? rows.length}</div></th>`).join('')}
            ${groupCol ? '<th class="num" scope="col">p</th>' : ''}</tr></thead>
          ${table.rows.map(r => descRow(r, gs, !!groupCol)).join('')}</table>
          ${(table.notes || []).map(note=>`<div class="note spaced">${esc(note)}</div>`).join('')}`}
    </div></div>
    ${col ? figurePanel({ title: 'Distribution', id: 'dist', extra: variablePick }) : ''}`;
  if (col) {
    showFigure(el, 'dist', patientColumnChart(rows, col), `distribution-${col.id}`);
    el.querySelector('#d-col').onchange = e => { descCol = e.target.value; renderDescriptives(el, ctx); };
  }

  el.querySelector('#to-patients')?.addEventListener('click', () => ctx.go('patients'));
}

function descRow(r, gs, hasGroups) {
  const pCell = span => hasGroups
    ? `<td class="num" rowspan="${span}">${r.test ? `${pValue(r.test.p)}<div class="meta" title="${
        esc(r.test.test)}${r.test.smallExpected > 0.2 ? ', expected counts below 5' : ''}"> ${
        esc(r.test.test)}</div>` : '—'}</td>`
    : '';
  if (r.kind === 'numeric') {
    const cell = g => {
      const s = r.slices.find(x => x.name === g);
      return `<td class="num">${medianIQR(s)}<div class="meta">Range: ${rangeOf(s)}</div>${s?.missing?`<div class="meta">n = ${s.n}; missing / invalid = ${s.missing}</div>`:''}</td>`;
    };
    return `<tbody class="desc-block"><tr class="desc-variable"><th class="grow" scope="row">${esc(r.column.name)}<div class="meta">Median (IQR)</div></th>
      ${gs.map(cell).join('')}${pCell(1)}</tr></tbody>`;
  }
  return `<tbody class="desc-block"><tr class="desc-variable"><th class="grow" scope="rowgroup">${esc(r.column.name)}<div class="meta">n (%)</div></th>
    ${gs.map(g=>{const s=r.slices.find(x=>x.name===g);return `<td class="num"><span class="meta">Observed n = ${s?.n ?? 0}${s?.missing?`; missing / invalid = ${s.missing}`:''}</span></td>`;}).join('')}${pCell(r.levels.length+1)}</tr>
    ${r.levels.map(lv => `<tr class="desc-level"><th class="grow" scope="row"><span class="lv">${esc(lv)}</span></th>
      ${gs.map(g => `<td class="num">${countPct(r.slices.find(x => x.name === g), lv)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

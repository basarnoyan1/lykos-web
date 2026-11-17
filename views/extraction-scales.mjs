// Scales: a sub-page of Extraction (W10; owner, 7 Nov 2026: "we need a place to also decide on the scales or at least to see the scales that
// we used in the app"). One row per scale the studies' outcomes are coded to (lib/scales.mjs scalesInUse): its whole name, the studies and
// arms that use it, and what the review does with it. Its editor shows what the scale measures, its range, direction and rater, the studies
// and arms by indication, the decision (pool on its own, convert, sensitivity analyses only, exclude; read by the change synthesis) and the
// project's own entry for it (s.instruments, lib/instruments.mjs putInstrument). Under the list: each indication's usual scales that no study
// used, and the instrument map (indication × procedure), which was a dialog of an outcome column. Loaded on first use by ./extraction.mjs.
// 13 Nov 2026 (owner: "it is hard to find like which scales do we use for what, how do we calculate that SMCR, which scales are used in which
// papers"; docs/Sham_Needs_Review_2026-11.md): the list filters by indication and by what a scale measures and says each scale's role in the
// analyses; an open scale lists its studies and arms with their values and its live forest; a study's scales, the one in the primary pool and
// how one arm's SMCR was made (lib/scale-guide.mjs, read from the change synthesis' own rows) show in Details; the uncoded studies are a way in.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";
import { lib_ui_components$editorRows as editorRows, lib_ui_components$wireEditorRows as wireEditorRows, lib_ui_components$countHeading as countHeading, lib_ui_components$formField as formField, lib_ui_components$formFit as formFit, lib_ui_components$tableRegion as tableRegion } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiSummary as uiSummary } from "../boot.mjs";
import { lib_dialog$formDialog as formDialog, lib_dialog$formValues as formValues, lib_dialog$askText as askText } from "../boot.mjs";
import { instrumentOf, registry, putInstrument, normalizeInstrument } from '../lib/instruments.mjs';
import { scaleFacts, scaleTitle, scaleTitleOf, decisionWords, scaleDecision, SCALE_USES } from '../lib/scale-names.mjs';
import { scalesInUse, decideScale } from '../lib/scales.mjs';
import { crosswalksFor, crosswalkState } from '../lib/instrument-crosswalks.mjs';
import { outcomeTable, instrumentMap, mapFields } from '../lib/outcome-rows.mjs';
import { mapHtml } from './instrument-map.mjs';
import { changeInputs } from '../lib/change-records.mjs';
import { guideSets, scaleGuide, scaleStudies, studyScales, smcrWorking, armKey, armStanding } from '../lib/scale-guide.mjs';
import { forestSvg } from '../lib/output-charts.mjs';
import { scaleRangeSvg } from '../lib/scale-range-chart.mjs';
import { fitSplit, fitFigure } from '../lib/split-fit.mjs';

// { templateId, open: code | null, page, from: 'extraction' | 'summary', filter: { indication, domain }, arm: an arm's key | null,
//   details: 'arm' | 'uncoded' | null (what Details shows), focus(paperId, column): Extraction opens the study or its cell }
let ui = null;
let figs = {};   // the open scale's figures, each draw(width) (studiesHtml), drawn by renderScales at their boxes' widths
export const scalesOpen = () => !!ui;
/** Opens the page, with `scale` open in the list when given; `from` names the page Back returns to; `focus` opens a study's cell in Extraction. */
export function openScales(templateId, { scale = null, from = 'extraction', focus = null } = {}) {
  const keep = ui && ui.templateId === templateId ? ui : null;
  ui = { templateId, open: scale ?? keep?.open ?? null, page: null, from, filter: keep?.filter || { indication: '', domain: '' }, arm: keep?.arm || null, details: keep?.details || null, focus };
}
export function closeScales() { ui = null; }
/** Back: leaves the page; answers the page it was opened from. */
export function scalesBack() { const from = ui?.from || 'extraction'; ui = null; return from; }

/** The title bar: Back, the name, the count of scales, Add scale and the map's fields in More. `run`: { back, rerender }. */
export function scalesSpec(run = {}) {
  const s = get(), t = outcomeTable(s, ui?.templateId), n = t ? scalesInUse(s, { table: t.id }).scales.length : 0;
  return { title: 'Scales', back: { label: ui?.from === 'summary' ? 'Back to summary' : 'Back to Extraction', run: run.back || (() => {}) },
    status: { text: plural(n, 'scale'), ch: 24 },
    actions: [{ id: 'sc-add', label: 'Add scale', icon: 'plus', role: 'secondary', run: () => addScale(run.rerender) }],
    overflow: [{ id: 'sc-fields', label: 'Indication and procedure fields…', disabled: !t, run: () => chooseFields(run.rerender) }] };
}

const USE_WORD = Object.fromEntries(SCALE_USES.map(u => [u.id, u.label]));
const RATER_WORDS = [['', 'Not stated'], ['clinician', 'Clinician'], ['patient', 'Patient'], ['observer', 'Observer']];
const HIGHER_WORDS = [['', 'Not stated'], ['worse', 'Worse'], ['better', 'Better']];
const options = (pairs, value) => pairs.map(([v, w]) => `<option value="${esc(v)}"${String(value ?? '') === v ? ' selected' : ''}>${esc(w)}</option>`).join('');

/** The crosswalk a conversion uses (lib/instrument-crosswalks.mjs): the one the decision names, else the pair's first; null when the pair has none. */
const crosswalkOfDecision = (s, code, d) => { const xs = d.use === 'convert' && d.to ? crosswalksFor(s, code, d.to) : []; return xs.find(c => c.id === d.crosswalk) || xs[0] || null; };
const METHOD_WORDS = { linear: 'linear formula', table: 'table lookup', 'percent-change': 'percent-change equivalence' };
const methodWords = c => (c.method === 'stratified' ? `by ${c.covariate?.label || 'level'}` : METHOD_WORDS[c.method] || c.method);
/** What a conversion's crosswalk still needs, or where its coefficients come from. */
function crosswalkLine(c, d) {
  if (!c) return `No crosswalk to ${d.to}`;
  const st = crosswalkState(c), src = c.source || {};
  return st.ready ? `${st.words}. ${src.table || 'The paper'}${src.checked ? `, checked ${src.checked}` : ''}` : st.words;
}
/** The decision in the list: its words, and the crosswalk a conversion uses or what it still needs. */
function useCell(x) {
  const s = get(), d = x.decision;
  if (d.use !== 'convert') return esc(x.role || USE_WORD[d.use]);
  const c = crosswalkOfDecision(s, x.code, d), note = !c ? 'No crosswalk' : crosswalkState(c).ready ? c.label : `${c.label}: needs coefficients`;
  return `${esc(`Convert to ${instrumentOf(s, d.to)?.label || d.to}`)}<span class="ui-row-detail">${esc(note)}</span>`;
}

/** One scale's editor: what it is, who uses it, what the review does with it, and the project's own entry. */
function editorHtml(x, s, g) {
  const f = scaleFacts(x), source = !x.known ? 'Not in the registry' : x.extended ? 'Built in, extended in this project' : x.builtIn ? 'Built in' : 'This project';
  const cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  const facts = [['Measures', cap(x.domain)], ['Range', f.range], ['Direction', f.direction ? f.direction.charAt(0).toUpperCase() + f.direction.slice(1) : ''],
    ['Rater', f.rater ? f.rater.charAt(0).toUpperCase() + f.rater.slice(1) : ''], ['Source', source]]
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="meta">Not stated</span>'}</dd>`).join('');
  const ind = x.byIndication.length ? `<table class="sc-ind"><thead><tr><th scope="col">Indication</th><th scope="col" class="num">Studies</th><th scope="col" class="num">Arms</th></tr></thead><tbody>${
    x.byIndication.map(i => `<tr><th scope="row">${esc(i.label)}</th><td class="num">${num(i.studies)}</td><td class="num">${num(i.arms)}</td></tr>`).join('')}</tbody></table>` : '<p class="meta">No studies</p>';
  // the scales a crosswalk reaches first, so choosing Convert picks one that can be converted to
  const reach = new Set(crosswalksFor(s, x.code).map(c => c.to));
  const d = x.decision, targets = registry(s).filter(y => y.code !== x.code && (reach.has(y.code) || !x.domain || y.domain === x.domain || x.indications.some(i => y.indications.includes(i))))
    .sort((a, b) => reach.has(b.code) - reach.has(a.code) || a.label.localeCompare(b.label));
  const radios = SCALE_USES.map(u => `<label class="cr-check"><input type="radio" name="sc-use" value="${u.id}"${d.use === u.id ? ' checked' : ''}> ${esc(u.label)}</label>`).join('');
  const target = `<select name="sc-to" data-sc-to${d.use === 'convert' ? '' : ' disabled'}>${targets.map(y => `<option value="${esc(y.code)}" title="${esc(scaleTitle(y))}"${d.to === y.code ? ' selected' : ''}>${esc(y.label)}</option>`).join('')}</select>`;
  const own = (Array.isArray(s.instruments) ? s.instruments : []).find(y => String(y?.code) === x.code) || {};
  const val = (k, fb) => esc(String(own[k] ?? fb ?? ''));
  const entry = `<div class="an-settings sc-entry"${formFit([1, 1, 2, 1, 1, 1, 1, 2])}>
    ${formField('Short name', `<input name="label" value="${val('label', x.label)}" maxlength="80">`)}
    ${formField('Measures', `<input name="domain" value="${val('domain', x.domain)}" maxlength="60">`)}
    ${formField('Full name', `<input name="name" value="${val('name', x.name)}" maxlength="200">`, { span: 2 })}
    ${formField('Lowest score', `<input name="min" inputmode="decimal" value="${val('min', x.min)}">`)}
    ${formField('Highest score', `<input name="max" inputmode="decimal" value="${val('max', x.max)}">`)}
    ${formField('A higher score is', `<select name="higher">${options(HIGHER_WORDS, own.higher ?? x.higher)}</select>`)}
    ${formField('Rater', `<select name="rater">${options(RATER_WORDS, own.rater ?? x.rater)}</select>`)}
    ${formField('Other names, comma separated', `<input name="aliases" value="${esc((own.aliases || []).join(', '))}">`, { span: 2 })}</div>`;
  return `<div class="sc-editor" data-sc-editor="${esc(x.code)}">
    <div class="sc-pair" data-sc-pair><section class="sc-part"><h4>${esc(x.name && x.name !== x.label ? `${x.label}: ${x.name}` : x.label)}</h4><dl class="props sc-facts">${facts}</dl></section>
    <section class="sc-part"><h4>Studies and arms by indication</h4>${ind}</section></div>
    ${studiesHtml(x, g)}
    <section class="sc-part"><h4>In the analyses</h4><fieldset class="sc-use" data-sc-use data-sc-first="${esc((targets.find(y => reach.has(y.code)) || targets[0])?.code || '')}"><legend class="visually-hidden">What the review does with ${esc(x.label)}</legend>${radios}</fieldset>
      ${d.use === 'convert' ? `${formField('Convert to', target)}${formField('Crosswalk', crosswalkSelect(s, x.code, d))}${crosswalkNote(s, x.code, d)}` : ''}</section>
    <section class="sc-part"><h4>This project's entry</h4><form data-sc-entry>${entry}${uiBar({ kind: 'foot', label: `Entry for ${x.label}`, id: `sc-save-bar`, actions: [{ id: 'sc-save', label: 'Save scale', role: 'primary', type: 'submit' }] })}</form></section></div>`;
}

/** The crosswalks from this scale to the chosen one; disabled until Convert is chosen. */
function crosswalkSelect(s, code, d) {
  const xs = d.use === 'convert' && d.to ? crosswalksFor(s, code, d.to) : [], c = crosswalkOfDecision(s, code, d);
  const opts = xs.map(y => `<option value="${esc(y.id)}" title="${esc(y.source?.citation || '')}"${c?.id === y.id ? ' selected' : ''}>${esc(`${y.label}, ${methodWords(y)}`)}</option>`).join('');
  return `<select name="sc-cw" data-sc-cw${xs.length ? '' : ' disabled'}>${opts || '<option value="">None</option>'}</select>`;
}
/** The chosen crosswalk's state under the fields; its citation and what the paper says in the tooltip. Until its coefficients are entered its studies stay in the primary pool and have no same-scale pool. */
function crosswalkNote(s, code, d) {
  const c = crosswalkOfDecision(s, code, d), tip = c ? [c.source?.citation, c.source?.note].filter(Boolean).join(' ') : '';
  return `<p class="meta"${tip ? ` title="${esc(tip)}"` : ''}>${esc(crosswalkLine(c, d))}</p>`;
}

// ---- which studies use a scale, and how each arm's SMCR was made ---------------------------------------------------------------------
const fmt = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '' : String(Math.round(Number(x) * 10 ** d) / 10 ** d).replace('-', '\u2212'));
/** The change synthesis' sets for the open project, or null without a plan (s.synthesis.change). */
const setsOf = s => (s?.synthesis?.change ? guideSets(changeInputs(s)) : null);
/** A row that answers a press in Details: the chart-panel event (lib/chart-interact.mjs) carries it to the page, Enter as a click. */
const pressAttrs = (paperId, label, own) => ({ 'data-chart-ids': paperId, 'data-chart-panel': '', 'data-chart-label': label, tabindex: '0', ...own });
/** A press on a row or mark under `el` holding `attr`: the chart-panel event when lib/chart-interact.mjs answers it (the first hover or focus
 * loads it, and its press stops the click), else the click or Enter itself. `fn` gets the attribute's value. */
function onPress(el, attr, fn) {
  const hit = e => e.target?.closest?.(`[${attr}]`)?.getAttribute(attr);
  el.addEventListener('chart-panel', e => { const v = hit(e); if (v) fn(v); });
  el.addEventListener('click', e => { const v = hit(e); if (v) fn(v); });
  el.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const v = hit(e); if (v) { e.preventDefault(); e.stopPropagation(); fn(v); } });   // stopped here: chart-interact's own Enter would press it again
}
const armName = a => `${a.trial}, ${a.arm_label || a.arm || 'arm'}${a.outcome_slot ? ` (${a.outcome_slot})` : ''}`;
/** An open scale's studies: its sham arms' SMCR as a live forest (hover says the value, a press shows the arm in Details) and every arm as a row. */
function studiesHtml(x, g) {
  if (!g) return '<section class="sc-part"><h4>Studies and values</h4><p class="meta">No change synthesis</p></section>';
  const studies = scaleStudies(g, x.code);
  if (!studies.length) return '<section class="sc-part"><h4>Studies and values</h4><p class="meta">No arms</p></section>';
  // the forest: the sham arms the primary pool takes (else every sham arm with an SMCR), each labelled by its study and outcome, the arm in the hover
  const withY = studies.flatMap(st => st.arms).filter(a => a.arm_role === 'sham' && a.yi != null && Number.isFinite(a.yi) && a.vi > 0);
  const sham = withY.some(a => a.standing.primary) ? withY.filter(a => a.standing.primary) : withY;
  const several = new Set(sham.map(a => `${a.paper_id}|${a.outcome_slot}`).filter((k, i, all) => all.indexOf(k) !== i));
  const short = a => `${a.trial} ${a.outcome_slot}${several.has(`${a.paper_id}|${a.outcome_slot}`) ? ` ${a.arm}` : ''}`;
  const forestRows = sham.map((a, i) => {
    const se = Math.sqrt(a.vi);
    return { label: short(a), value: a.yi, lo: a.yi - 1.96 * se, hi: a.yi + 1.96 * se, row: i,
      attrs: { 'data-chart-ids': a.paper_id, 'data-chart-panel': '', 'data-chart-label': `${armName(a)}: SMCR ${fmt(a.yi)}, ${a.standing.words.toLowerCase()}`, 'data-sc-arm': armKey(a) } };
  });
  const xLabel = sham[0]?.standing.primary ? 'Sham SMCR in the primary pool (improvement positive)' : 'Sham SMCR (improvement positive)';
  // every arm on one line, its values in columns (a row with the values as a second line took 58 px: UPDRS-III's 46 arms were three screens)
  const cell = v => `<td class="num">${v != null && Number.isFinite(+v) ? esc(fmt(v)) : ''}</td>`;
  const attrsHtml = o => Object.entries(o).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
  const rows = studies.flatMap(st => st.arms).map(a => `<tr${attrsHtml(pressAttrs(a.paper_id, armName(a), { 'data-sc-arm': armKey(a), ...(armKey(a) === ui.arm ? { 'aria-current': 'true' } : {}) }))}>`
    + `<th scope="row">${esc(armName(a))}</th>${cell(a.baseline_mean)}${cell(a.baseline_sd)}${cell(a.end_mean)}${cell(a.change_used)}<td class="num">${a.n != null ? esc(String(a.n)) : ''}</td>`
    + `${cell(a.yi)}<td>${esc(a.standing.words)}</td></tr>`).join('');
  const arms = tableRegion({ label: `Arms measured with ${x.label}`, html: `<table class="cl sc-arms"><thead><tr><th scope="col">Arm</th><th scope="col" class="num">Baseline</th><th scope="col" class="num">SD</th>`
    + `<th scope="col" class="num">End</th><th scope="col" class="num">Change</th><th scope="col" class="num">n</th><th scope="col" class="num">SMCR</th><th scope="col">Primary pool</th></tr></thead><tbody>${rows}</tbody></table>` });
  // where the arms sit on the scale: every sham arm with a baseline mean, from baseline to end, on the scale's whole range
  const onScale = studies.flatMap(st => st.arms).filter(a => a.arm_role === 'sham' && Number.isFinite(a.baseline_mean));
  const range = width => scaleRangeSvg({ label: x.label, min: x.min, max: x.max, higher: x.higher }, onScale.map(a => ({ label: `${a.trial} ${a.outcome_slot}`,
    baseline: a.baseline_mean, sd: a.baseline_sd, end: Number.isFinite(a.end_mean) ? a.end_mean : null,
    attrs: { 'data-chart-ids': a.paper_id, 'data-chart-panel': '', 'data-chart-label': armName(a), 'data-sc-arm': armKey(a) } })), { width });
  // the two figures side by side where the pane holds both, each drawn at its box's width (renderScales wires figs)
  figs = { range: onScale.length ? w => range(w) : null, forest: sham.length ? w => forestSvg(forestRows, { width: w, xLabel }) : null };
  const host = (k, empty) => figs[k] ? `<div class="sc-forest chart-svg" data-sc-fig="${k}"></div>` : `<p class="meta">${empty}</p>`;
  return `<div class="sc-pair" data-sc-pair data-sc-figs><section class="sc-part"><h4>On the scale</h4>${host('range', 'No baseline means')}</section>
    <section class="sc-part"><h4>Sham SMCR</h4>${host('forest', 'No sham arm with an SMCR')}</section></div>
    <section class="sc-part"><h4>Studies and values</h4>${arms}</section>`;
}

/** Details: the uncoded studies, or the chosen arm's study (its scales, which enters the primary pool) and how the arm's SMCR was made; else the rule. */
export function inspect(ctx) {
  if (!ui) return [];
  const s = get(), g = setsOf(s), secs = [];
  if (ui.details === 'uncoded') {
    const t = outcomeTable(s, ui.templateId), u = t ? scalesInUse(s, { table: t.id }) : { uncodedIds: [] };
    const name = id => { const p = (s.papers || []).find(x => x.id === id); return p?.label || p?.title || id; };
    secs.push({ title: 'Outcomes not coded to a scale', meta: plural(u.uncodedIds.length, 'study', 'studies'),
      html: u.uncodedIds.length ? uiList({ id: 'sc-uncoded-list', label: 'Studies with uncoded outcomes', rows: u.uncodedIds.map(id => ({ id, n: name(id) })).sort((a, b) => a.n.localeCompare(b.n))
        .map(x => uiRow({ attrs: pressAttrs(x.id, x.n, { 'data-sc-study': x.id }), main: { html: esc(x.n), detail: ['Open in Extraction'] } })) }) : emptyState({ title: 'Every outcome is coded', size: 'inline' }),
      wire: el => onPress(el, 'data-sc-study', id => ui?.focus?.(id, '')) });
    return secs;
  }
  const found = ui.arm && g ? g.all.find(x => armKey(x) === ui.arm) : null, a = found ? { ...found, standing: armStanding(found, g) } : null;
  if (a) {
    const outcomes = studyScales(g, a.paper_id);
    const rows = outcomes.flatMap(o => {
      const label = o.instrument ? (instrumentOf(s, o.instrument)?.label || o.instrument) : 'Not coded to a scale';
      return o.arms.filter(x => x.arm_role === 'sham').map(x => uiRow({ attrs: pressAttrs(x.paper_id, `${label}, ${x.arm_label || x.arm}`, { 'data-sc-arm': armKey(x) }),
        main: { html: x.standing.primary ? `<strong>${esc(label)}</strong>` : esc(label), detail: [esc(o.outcome || ''), esc(x.yi != null && Number.isFinite(x.yi) ? `SMCR ${fmt(x.yi)}` : 'No SMCR'), esc(x.standing.words)], wrap: true } }));
    });
    secs.push({ title: a.trial, meta: plural(outcomes.length, 'outcome'), html: rows.length ? uiList({ id: 'sc-study-scales', label: `Scales of ${a.trial}`, rows }) : '<p class="meta">No sham arm</p>',
      wire: el => onPress(el, 'data-sc-arm', k => chooseArm(k, ctx)) });
    secs.push(workingSection(a, g, ctx));
    return secs;
  }
  secs.push(ruleSection(g, changeInputs(s)?.plan || {}));
  return secs;
}
/** The rule, with no arm chosen: the formula and the choices the analysis makes, and the plan's sets that choose otherwise. */
function ruleSection(g, plan) {
  const w = smcrWorking({}, g, plan), alts = w.alternatives.map(x => `<dt>${esc(x.code)}</dt><dd>${esc(x.title)}</dd>`).join('');
  return { title: 'How the SMCR is calculated', html: `<dl class="props sc-formula">${w.formula.map((f, i) => `<dt>${i ? '' : 'Formula'}</dt><dd>${esc(f)}</dd>`).join('')}</dl>
    <ul class="sc-rules">${w.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${alts ? `<h4>Sets that choose otherwise</h4><dl class="props sc-alts">${alts}</dl>` : ''}
    <p class="meta">No arm chosen</p>` };
}
/** One arm's SMCR: its inputs with the cell each came from, the result the run pools and the rules that chose the inputs. */
function workingSection(a, g, ctx) {
  const w = smcrWorking(a, g, changeInputs(get())?.plan || {});
  const value = x => (x.id === 'dir' ? (x.value === -1 ? '\u22121' : x.value === 1 ? '+1' : 'Not known') : x.value == null ? 'None' : fmt(x.value, 4));
  const inputs = uiList({ id: 'sc-inputs', label: 'Inputs of the SMCR', rows: w.inputs.map(x => uiRow({
    ...(x.cell ? { attrs: pressAttrs(a.paper_id, `${x.label} of ${armName(a)}`, { 'data-sc-cell': `${a.paper_id}\u0000${x.cell.column}` }) } : {}),
    main: { html: `${esc(x.label)} <strong>${esc(value(x))}</strong>`, detail: [esc(x.how), ...(x.cell ? [esc(`Cell: ${cellText(x.cell.key)}`)] : [])], wrap: true } })) });
  const res = w.result ? `SMCR ${fmt(w.result.yi)}${w.result.J != null ? `; J ${fmt(w.result.J, 4)}` : ''}; variance ${fmt(w.result.vi, 4)}` : 'No SMCR: an input is missing';
  const alts = w.alternatives.map(x => `<tr><th scope="row">${esc(x.code)}</th><td>${esc(x.title)}</td><td class="num">${esc('value' in x ? (x.value == null ? 'none' : fmt(x.value)) : x.kept ? 'kept' : 'left out')}</td></tr>`).join('');
  return { title: 'How this SMCR was made', meta: armName(a),
    html: `<dl class="props sc-formula">${w.formula.map((f, i) => `<dt>${i ? '' : 'Formula'}</dt><dd>${esc(f)}</dd>`).join('')}</dl>
      ${inputs}
      <p class="sc-result">${esc(res)}. ${esc(a.standing?.words || '')}</p>
      <ul class="sc-rules">${w.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      ${alts ? `<h4>In the sets that choose otherwise</h4><table class="sc-ind sc-alts"><tbody>${alts}</tbody></table>` : ''}`,
    wire: el => onPress(el, 'data-sc-cell', v => { const [p, c] = v.split('\u0000'); ui?.focus?.(p, c); }) };
}
/** What a source cell says, as written. */
const cellText = key => { const v = get().values?.[key]; return String(v?.reported_value ?? '').trim() || 'Open cell'; };
/** What Details shows: an arm (its key, armKey of lib/scale-guide.mjs), the uncoded studies, or the rule (neither). */
export function showInDetails({ arm = null, uncoded = false } = {}) { if (!ui) return; ui.arm = uncoded ? null : arm; ui.details = uncoded ? 'uncoded' : arm ? 'arm' : null; }
/** Choosing an arm (a row, a forest mark, a study's outcome) shows it in Details. */
function chooseArm(key, ctx) { if (!ui) return; ui.arm = key; ui.details = 'arm'; ctx.rerender(); ctx.showDetails?.(); ctx.refreshDetails?.(); }

/** The page under the title bar. `ctx.rerender(msg)` repaints the page and its title bar. */
export function renderScales(el, ctx) {
  const s = get(), t = outcomeTable(s, ui?.templateId);
  if (!t) { el.innerHTML = emptyState({ icon: 'extraction', title: 'No outcome table', detail: 'Outcomes coded to scales appear here once a table holds them.', size: 'inline' }); return; }
  const u = scalesInUse(s, { table: t.id }), g = setsOf(s), view = scaleGuide(u, g, s, ui.filter);
  const rows = editorRows({ id: 'sc-rows', label: 'Scales', items: view.scales, key: x => x.code, title: x => x.label, selected: ui.open, page: ui.page ?? undefined, noun: 'scales',
    empty: emptyState({ title: view.total ? 'No scale matches' : 'No outcome is coded to a scale', detail: view.total ? 'Choose another indication or measure.' : 'Give the outcome entries their instrument, then accept the proposals.', size: 'inline' }),
    columns: [
      { head: 'Scale', grow: true, cell: x => `<span title="${esc(scaleTitle(x))}">${esc(x.label)}</span>${x.name && x.name !== x.label ? `<span class="ui-row-detail">${esc(x.name)}</span>` : ''}` },
      { head: 'Measures', cell: x => { const f = scaleFacts(x), sub = [f.range, f.direction].filter(Boolean).join(', ');
        return `${x.domain ? esc(x.domain.charAt(0).toUpperCase() + x.domain.slice(1)) : '<span class="meta">Not stated</span>'}${sub ? `<span class="ui-row-detail">${esc(sub)}</span>` : ''}`; } },
      { head: 'Indications', cell: x => esc(x.byIndication.map(i => i.label).join(', ')) },
      { head: 'Studies', num: true, cell: x => num(x.studies) },
      { head: 'In the analyses', cell: useCell }],
    editor: x => editorHtml(x, s, g) });
  const filters = view.total > 1 ? uiBar({ kind: 'tools', label: 'Filter scales', id: 'sc-filter',
    filters: [{ type: 'select', id: 'sc-f-ind', label: 'Indication', options: [['', 'Any indication'], ...view.indications.map(i => [i.code, i.label])], value: ui.filter.indication },
      { type: 'select', id: 'sc-f-dom', label: 'Measures', options: [['', 'Anything measured'], ...view.domains.map(d => [d, d.charAt(0).toUpperCase() + d.slice(1)])], value: ui.filter.domain }] }) : '';
  const uncoded = u.uncoded ? uiSummary({ id: 'sc-uncoded', label: 'Uncoded outcomes', text: `${plural(u.uncoded, 'study has', 'studies have')} outcomes not coded to a scale`,
    action: { id: 'sc-uncoded-show', label: 'Show studies', icon: 'chevron-right' } }) : '';
  // each indication's usual scales that no study used: drawn only when there are some
  const unused = u.unused.length ? `<section class="syn-sec"><h3>Usual scales no study used</h3><dl class="props sc-unused">${u.unused.map(g => `<dt>${esc(g.indication.label)}</dt><dd>${
    g.scales.map(y => `<span title="${esc(scaleTitleOf(s, y.code))}">${esc(y.label)}</span>`).join(', ')}</dd>`).join('')}</dl></section>` : '';
  const F = mapFields(s, t), label = id => (t.columns || []).find(c => c.id === id)?.label || 'Not chosen';
  const count = view.scales.length === view.total ? num(view.total) : `${num(view.scales.length)} of ${num(view.total)}`;
  el.innerHTML = `<div class="sc-page">
    <section class="syn-sec">${countHeading({ title: 'Scales in use', count, countLabel: 'scales' })}${uncoded}${filters}${rows}</section>
    ${unused}
    <section class="syn-sec"><h3>Studies by indication and procedure</h3><p class="meta">${esc(`${label(F.indication)} by ${label(F.procedure)}`)}</p>${mapHtml(instrumentMap(s, { table: t.id, fields: F }))}</section></div>`;
  wireEditorRows(el, 'sc-rows', { onSelect: k => { ui.open = k; ui.page = null; ctx.rerender(); }, onPage: n => { ui.page = n; ui.open = null; ctx.rerender(); } });
  el.querySelector('#sc-f-ind')?.addEventListener('change', e => { ui.filter = { ...ui.filter, indication: e.target.value }; ui.page = null; ctx.rerender(); });
  el.querySelector('#sc-f-dom')?.addEventListener('change', e => { ui.filter = { ...ui.filter, domain: e.target.value }; ui.page = null; ctx.rerender(); });
  el.querySelector('#sc-uncoded-show')?.addEventListener('click', () => { ui.details = 'uncoded'; ui.arm = null; ctx.showDetails?.(); ctx.refreshDetails?.(); });
  // a forest mark or an arm's row: the arm in Details
  const pg = el.querySelector('.sc-page'); if (pg) onPress(pg, 'data-sc-arm', k => chooseArm(k, ctx));
  const ed = el.querySelector('[data-sc-editor]'); if (!ed) return;
  const code = ed.dataset.scEditor;
  ed.querySelectorAll('[data-sc-pair]').forEach(p => fitSplit(p, p.hasAttribute('data-sc-figs') ? 960 : 720));
  for (const box of ed.querySelectorAll('[data-sc-fig]')) { const draw = figs[box.getAttribute('data-sc-fig')]; if (draw) fitFigure(box, draw); }
  ed.querySelector('[data-sc-use]')?.addEventListener('change', () => decide(ctx, ed, code));
  ed.querySelector('[data-sc-to]')?.addEventListener('change', () => decide(ctx, ed, code));
  ed.querySelector('[data-sc-cw]')?.addEventListener('change', () => decide(ctx, ed, code));
  ed.querySelector('[data-sc-entry]')?.addEventListener('submit', e => { e.preventDefault(); saveEntry(ctx, e.currentTarget, code); });
}

/** Records the decision the editor shows (lib/scales.mjs decideScale) and says whether Protocol › Changes holds it. */
function decide(ctx, ed, code) {
  const use = ed.querySelector('[name=sc-use]:checked')?.value || 'own', sel = ed.querySelector('[data-sc-to]'), cw = ed.querySelector('[data-sc-cw]');
  if (sel) sel.disabled = use !== 'convert';
  let r = null;
  // a crosswalk listed for the earlier target is not this pair's: decideScale then takes the pair's first
  update(st => { r = decideScale(st, code, { use, ...(use === 'convert' ? { to: sel?.value || ed.querySelector('[data-sc-use]')?.dataset.scFirst || '', crosswalk: cw?.value || '' } : {}) }); return st; });
  const label = instrumentOf(get(), code)?.label || code, words = decisionWords(get(), scaleDecision(get(), code));
  ctx.rerender(r?.error || (r?.filed ? `${label}: ${words}. Filed in Protocol › Changes` : `${label}: ${words}`));
}

/** Saves the project's entry for a scale: the fields typed over the registry's; a field left as the registry has it is not stored. */
function saveEntry(ctx, form, code) {
  const v = formValues(form), base = instrumentOf({}, code), x = normalizeInstrument({ code, ...v, aliases: String(v.aliases || '').split(',') });
  const entry = { code };
  for (const k of ['label', 'name', 'domain', 'min', 'max', 'higher', 'rater']) if (x[k] !== null && x[k] !== '' && x[k] !== (base?.[k] ?? null)) entry[k] = x[k];
  if (x.aliases.length) entry.aliases = x.aliases;
  let error = '';
  update(st => { error = putInstrument(st, entry); return st; });
  ctx.rerender(error || `${entry.label || base?.label || code} saved`);
}

/** Add scale: its code, then its row opens to fill in the rest. */
async function addScale(rerender) {
  const code = String(await askText('Add a scale', { placeholder: 'Code, for example GDS-15', confirm: 'Add' }) || '').trim();
  if (!code) return;
  let error = '';
  if (!instrumentOf(get(), code)) update(st => { error = putInstrument(st, { code }); return st; });
  if (!error && ui) { ui.open = code; ui.page = null; }
  rerender?.(error || '');
}

/** The fields the studies are grouped by in the map and in each scale's indications (s.instrumentMap, outside s.synthesis). */
async function chooseFields(rerender) {
  const s = get(), t = outcomeTable(s, ui?.templateId); if (!t) return;
  const F = mapFields(s, t), cols = (t.columns || []).filter(c => c.group !== 'outcome' && !/[._]o\d+_/.test(c.id));
  const opts = value => cols.map(c => `<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${esc(c.label || c.id)}</option>`).join('');
  const out = await formDialog({ id: 'scale-fields', title: 'Indication and procedure fields', confirm: 'Save',
    body: `<div class="an-settings"${formFit([1, 1])}>${formField('Indication', `<select name="indication">${opts(F.indication)}</select>`)}${formField('Procedure', `<select name="procedure">${opts(F.procedure)}</select>`)}</div>` });
  if (!out || (out.indication === F.indication && out.procedure === F.procedure)) return;
  update(st => { st.instrumentMap = { indication: out.indication, procedure: out.procedure }; return st; });
  rerender?.();
}

// Scales: a sub-page of Extraction (W10; owner, 7 Nov 2026: "we need a place to also decide on the scales or at least to see the scales that
// we used in the app"). One row per scale the studies' outcomes are coded to (lib/scales.mjs scalesInUse): its whole name, the studies and
// arms that use it, and what the review does with it. Its editor shows what the scale measures, its range, direction and rater, the studies
// and arms by indication, the decision (pool on its own, convert, sensitivity analyses only, exclude; read by the change synthesis) and the
// project's own entry for it (s.instruments, lib/instruments.mjs putInstrument). Under the list: each indication's usual scales that no study
// used, and the instrument map (indication × procedure), which was a dialog of an outcome column. Loaded on first use by ./extraction.mjs.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";
import { lib_ui_components$editorRows as editorRows, lib_ui_components$wireEditorRows as wireEditorRows, lib_ui_components$countHeading as countHeading, lib_ui_components$formField as formField, lib_ui_components$formFit as formFit } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_dialog$formDialog as formDialog, lib_dialog$formValues as formValues, lib_dialog$askText as askText } from "../boot.mjs";
import { instrumentOf, registry, putInstrument, normalizeInstrument } from '../lib/instruments.mjs';
import { scaleFacts, scaleTitle, scaleTitleOf, decisionWords, scaleDecision, SCALE_USES } from '../lib/scale-names.mjs';
import { scalesInUse, decideScale } from '../lib/scales.mjs';
import { crosswalksFor, crosswalkState } from '../lib/instrument-crosswalks.mjs';
import { outcomeTable, instrumentMap, mapFields } from '../lib/outcome-rows.mjs';
import { mapHtml } from './instrument-map.mjs';

let ui = null;   // { templateId, open: code | null, page, from: 'extraction' | 'summary' }
export const scalesOpen = () => !!ui;
/** Opens the page, with `scale` open in the list when given; `from` names the page Back returns to. */
export function openScales(templateId, { scale = null, from = 'extraction' } = {}) { ui = { templateId, open: scale, page: null, from }; }
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
  if (d.use !== 'convert') return esc(USE_WORD[d.use]);
  const c = crosswalkOfDecision(s, x.code, d), note = !c ? 'No crosswalk' : crosswalkState(c).ready ? c.label : `${c.label}: needs coefficients`;
  return `${esc(`Convert to ${instrumentOf(s, d.to)?.label || d.to}`)}<span class="ui-row-detail">${esc(note)}</span>`;
}

/** One scale's editor: what it is, who uses it, what the review does with it, and the project's own entry. */
function editorHtml(x, s) {
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
    <section class="sc-part"><h4>${esc(x.name && x.name !== x.label ? `${x.label}: ${x.name}` : x.label)}</h4><dl class="props sc-facts">${facts}</dl></section>
    <section class="sc-part"><h4>Studies and arms by indication</h4>${ind}</section>
    <section class="sc-part"><h4>In the analyses</h4><fieldset class="sc-use" data-sc-use><legend class="visually-hidden">What the review does with ${esc(x.label)}</legend>${radios}</fieldset>
      ${formField('Convert to', target)}
      ${formField('Crosswalk', crosswalkSelect(s, x.code, d))}
      ${d.use === 'convert' ? crosswalkNote(s, x.code, d) : ''}</section>
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

/** The page under the title bar. `ctx.rerender(msg)` repaints the page and its title bar. */
export function renderScales(el, ctx) {
  const s = get(), t = outcomeTable(s, ui?.templateId);
  if (!t) { el.innerHTML = emptyState({ icon: 'extraction', title: 'No outcome table', detail: 'Outcomes coded to scales appear here once a table holds them.', size: 'inline' }); return; }
  const u = scalesInUse(s, { table: t.id });
  const rows = editorRows({ id: 'sc-rows', label: 'Scales', items: u.scales, key: x => x.code, title: x => x.label, selected: ui.open, page: ui.page ?? undefined, noun: 'scales',
    empty: emptyState({ title: 'No outcome is coded to a scale', detail: 'Give the outcome entries their instrument, then accept the proposals.', size: 'inline' }),
    columns: [
      { head: 'Scale', grow: true, cell: x => `<span title="${esc(scaleTitle(x))}">${esc(x.label)}</span>${x.name && x.name !== x.label ? `<span class="ui-row-detail">${esc(x.name)}</span>` : ''}` },
      { head: 'Studies', num: true, cell: x => num(x.studies) },
      { head: 'Arms', num: true, cell: x => num(x.arms) },
      { head: 'In the analyses', cell: useCell }],
    editor: x => editorHtml(x, s) });
  // each indication's usual scales that no study used: drawn only when there are some
  const unused = u.unused.length ? `<section class="syn-sec"><h3>Usual scales no study used</h3><dl class="props sc-unused">${u.unused.map(g => `<dt>${esc(g.indication.label)}</dt><dd>${
    g.scales.map(y => `<span title="${esc(scaleTitleOf(s, y.code))}">${esc(y.label)}</span>`).join(', ')}</dd>`).join('')}</dl></section>` : '';
  const F = mapFields(s, t), label = id => (t.columns || []).find(c => c.id === id)?.label || 'Not chosen';
  el.innerHTML = `<div class="sc-page">
    <section class="syn-sec">${countHeading({ title: 'Scales in use', count: num(u.scales.length), countLabel: 'scales' })}${u.uncoded ? `<p class="meta">${esc(`${plural(u.uncoded, 'study has', 'studies have')} outcomes not coded to a scale.`)}</p>` : ''}${rows}</section>
    ${unused}
    <section class="syn-sec"><h3>Studies by indication and procedure</h3><p class="meta">${esc(`${label(F.indication)} by ${label(F.procedure)}`)}</p>${mapHtml(instrumentMap(s, { table: t.id, fields: F }))}</section></div>`;
  wireEditorRows(el, 'sc-rows', { onSelect: k => { ui.open = k; ui.page = null; ctx.rerender(); }, onPage: n => { ui.page = n; ui.open = null; ctx.rerender(); } });
  const ed = el.querySelector('[data-sc-editor]'); if (!ed) return;
  const code = ed.dataset.scEditor;
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
  update(st => { r = decideScale(st, code, { use, ...(use === 'convert' ? { to: sel?.value || '', crosswalk: cw?.value || '' } : {}) }); return st; });
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

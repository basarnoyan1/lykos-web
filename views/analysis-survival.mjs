// Time to event, from the patient data (plan §4.8, amended 2026-09-29).
//
// Group by any patient column, run, and read: Kaplan–Meier with number at
// risk, the median and its interval, median follow-up by reverse
// Kaplan–Meier, the log-rank tests and the pairwise table, restricted mean
// survival, Cox regression, a swimmer plot. Every number comes from R's
// survival package (lib/survival.mjs); this view sets the question and reads
// the answer. A result keeps the settings it was run with, so a table in the
// manuscript can be traced to them.
import { get, update, projectGeneration } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ask } from '../lib/dialog.mjs';
import { plural } from '../lib/dates.mjs';
import { figurePanel, showFigure, showChart, downloadCsv } from '../lib/figure.mjs';
import { kmChart, laneChart } from '../lib/analysis-charts.mjs';
import { columns as ipdColumns, participants, roleColumn } from '../lib/ipd.mjs';
import { DEFAULT_SPEC, PH_METHODS, PH_TRANSFORMS, rowsFor, runSurvival, parseList, survivalInputStatus, survivalInputSnapshot, survivalFigureOptions } from '../lib/survival-run.mjs';
import { kmFigure, swimmerFigure, niceTicks, riskAt } from '../lib/survival-fig.mjs';
import { setSurvival } from '../lib/result-versions.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { eventsPer100, medianFollowUp, groupLevels, logrankScript, logrankShape, runJson } from '../lib/survival.mjs';
import { exclusionPreview, wireExclusionPreview } from '../lib/scientific-exclusions.mjs';

const pct = v => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const pval = v => (v == null || Number.isNaN(v) ? '—' : v < 0.001 ? '<0.001' : v.toFixed(3));
const ci = (lo, hi, d = 1) => (lo == null || hi == null ? '' : ` (${num(lo, d)} to ${num(hi, d)})`);
const HR_DIGITS = 3;
const pEq = v => (v == null || Number.isNaN(v) ? 'p —' : v < 0.001 ? 'p < 0.001' : `p = ${v.toFixed(3)}`);

// the settings in view; they start from the last run's, or the defaults
let ui = null, uiProject = null;
const pendingRuns = new Map();
const specOf = () => {
  const s = get(), project = s.project?.id ?? s.project;
  if (!ui || uiProject !== project) {
    uiProject = project;
    ui = structuredClone({ ...DEFAULT_SPEC, ...(s.survival?.ext?.inputSpec || s.survival?.ext?.spec || {}) });
  }
  return ui;
};
const showBands = { ci: false };
let exclusionPage = 1, exclusionOwner = null;

/** Columns a person could group by: what the patient table can say in words or as a number, not the time and event themselves or the patient's name. */
function groupable(cols, people) {
  return cols.filter(c => !['time', 'event'].includes(c.role) && c.id !== 'label' && people.some(p => p[c.id] != null && p[c.id] !== '')).filter(c => {
    if (c.type === 'number') return true;
    return new Set(people.map(p => String(p[c.id] ?? '').trim()).filter(Boolean)).size <= 12;
  });
}
/** A cell's values as the leave-out and keep lists match them: trimmed, sorted. */
const valuesOf = (people, c) => [...new Set(people.map(p => String(p[c.id] ?? '').trim()).filter(Boolean))].sort();
/** Columns a sensitivity analysis can leave patients out by: words or yes/no, up to 30 distinct values (an abstract flag, a combined treatment). */
const leavable = (cols, people) => cols.filter(c => !['time', 'event'].includes(c.role) && c.id !== 'label' && !['number', 'date'].includes(c.type)
  && valuesOf(people, c).length && valuesOf(people, c).length <= 30);
/** Columns the clock can start from: a date (measured from another date column), or a number of months after the recorded time zero. */
const fromColumns = cols => cols.filter(c => c.role !== 'time' && (c.type === 'date' || (c.type === 'number' && /\bmonths?\b|\(mo\)/i.test(c.name || ''))));
const covariable = (cols, people, group) => groupable(cols, people).filter(c => c.id !== group?.id && c.id !== 'year' && c.type !== 'date');

/** The patients the settings in view analyse, or why the settings no longer apply to the patient data. */
function inputOf() {
  const cols = ipdColumns(), people = participants(), spec = specOf();
  try { return { cols, people, spec, inputError: '', ...rowsFor(people, cols, spec) }; }
  catch (err) { return { cols, people, spec, inputError: String(err?.message || err), rows: [], excluded: [], levels: [], groupName: null }; }
}
const projectKeyOf = s => s.project?.id ?? s.project;
const inputCsv = rows => { const keys = ['id', 'study_id', 'group', 'time', 'event']; downloadCsv([keys, ...rows.map(r => keys.map(k => r[k] ?? ''))], 'time-to-event-input.csv'); };
// Run is the title bar's: the page drawn last binds what it runs.
const acts = {};

/**
 * The time-to-event part of the title bar (views/analysis.mjs page()): Run, the patients and events analysed beside the title, and in
 * More the input download and, when the settings no longer fit the patient data, their reset.
 */
export function survivalPage(title, rerender) {
  const { rows, inputError } = inputOf(), pending = pendingRuns.get(projectKeyOf(get()));
  const said = `${plural(rows.length, 'patient')}, ${plural(rows.filter(r => r.event).length, 'event')}`;
  return { title,
    actions: [{ id: 'run', label: 'Run', icon: 'run', role: 'primary', disabled: rows.length < 2 || !!pending, run: btn => acts.run?.(btn) }],
    overflow: [{ id: 'tte-csv', label: 'Download input', disabled: !rows.length, run: () => inputCsv(inputOf().rows) },
      ...(inputError ? [{ id: 'sv-reset', label: 'Reset settings', run: () => { ui = structuredClone(DEFAULT_SPEC); rerender(); } }] : [])] };
}

export function renderSurvival(el, ctx) {
  const s = get(), { cols, people, spec, inputError, rows, excluded, levels, groupName } = inputOf();
  const groupCol = spec.group === undefined ? roleColumn('group') : spec.group === null ? null : cols.find(c => c.id === spec.group);
  if (exclusionOwner !== projectGeneration()) { exclusionOwner = projectGeneration(); exclusionPage = 1; }
  const opts = groupable(cols, people);
  const missing = ['time', 'event'].filter(r => !roleColumn(r));
  const saved = s.survival?.ext?.km?.overall && s.survival.ext.km.by ? s.survival : null;
  const projectKey = projectKeyOf(s), pending = pendingRuns.get(projectKey);
  const status = survivalInputStatus(s, s.survival, spec);
  const refChoice = spec.reference && levels.includes(spec.reference) ? spec.reference : '';
  const restrictCol = spec.restrict?.col ? cols.find(c => c.id === spec.restrict.col) : null;
  const restrictValues = restrictCol ? [...new Set(people.map(p => String(p[restrictCol.id] ?? '').trim()).filter(Boolean))].sort() : [];
  const covs = covariable(cols, people, groupCol);
  const leaveOpts = leavable(cols, people), leave = (spec.leaveOut || [])[0] || null, leaveCol = leave?.col ? cols.find(c => c.id === leave.col) : null;
  const leaveValues = leaveCol ? valuesOf(people, leaveCol) : [];
  const froms = fromColumns(cols), fromCol = spec.from?.col ? cols.find(c => c.id === spec.from.col) : null;
  const starts = fromCol?.type === 'date' ? cols.filter(c => c.type === 'date' && c.id !== fromCol.id) : [];
  const timeCol = (spec.time && cols.find(c => c.id === spec.time)) || roleColumn('time'), eventCol = (spec.event && cols.find(c => c.id === spec.event)) || roleColumn('event');
  const timeName = timeCol?.name || 'Follow-up';
  const times = cols.filter(c => c.type === 'number' && (c.role === 'time' || /\bmonths?\b|\(mo\)|follow/i.test(c.name || '')));
  const events = cols.filter(c => c.role === 'event' || c.type === 'boolean' || (c.type === 'category' && valuesOf(people, c).every(v => /^(yes|no|0|1|true|false)$/i.test(v)) && valuesOf(people, c).length));
  const view = spec.view || {};

  const groupValue = spec.group === undefined ? '@role' : spec.group === null ? '@none' : spec.group;
  const timeField = times.length > 1 ? `<label class="field"><span>Time</span><select id="sv-time">${times.map(c => `<option value="${esc(c.id)}"${c.id === timeCol?.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
  const eventField = events.length > 1 ? `<label class="field"><span>Event</span><select id="sv-event">${events.map(c => `<option value="${esc(c.id)}"${c.id === eventCol?.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
  const fromField = froms.length || fromCol ? `<label class="field"><span>Time zero</span><select id="sv-from"><option value="">As recorded</option>
          ${fromCol && !froms.includes(fromCol) ? `<option selected disabled value="${esc(fromCol.id)}">Unavailable: ${esc(fromCol.name)}</option>` : ''}
          ${froms.map(c => `<option value="${esc(c.id)}"${c.id === fromCol?.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
  const startField = fromCol?.type === 'date' ? `<label class="field"><span>Recorded time starts at</span><select id="sv-from-start"><option value="">Choose a date column</option>${starts.map(c => `<option value="${esc(c.id)}"${c.id === spec.from.start ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
  const leaveField = leaveOpts.length ? `<label class="field"><span>Leave out where</span><select id="sv-leave"><option value="">No one left out</option>${leaveOpts.map(c => `<option value="${esc(c.id)}"${c.id === leaveCol?.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
  const settings = `
      <div class="an-settings">
        ${timeField}
        ${eventField}
        <label class="field"><span>Group by</span><select id="sv-group">
          <option value="@none"${groupValue === '@none' ? ' selected' : ''}>None, all patients</option>
          ${!['@none', '@role'].includes(groupValue) && !cols.some(c => c.id === groupValue) ? `<option selected disabled value="${esc(groupValue)}">Unavailable: ${esc(groupValue)}</option>` : ''}
          ${roleColumn('group') ? `<option value="@role"${groupValue === '@role' ? ' selected' : ''}>${esc(roleColumn('group').name)}</option>` : ''}
          ${opts.filter(c => c.role !== 'group').map(c => `<option value="${esc(c.id)}"${groupValue === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${groupCol?.type === 'number' ? `<label class="field"><span>Cut points</span><input id="sv-bins" class="num" value="${esc((spec.bins || []).join(', '))}" placeholder="2010, 2020" aria-label="Cut points"></label>` : ''}
        <label class="field"><span>Reference group</span><select id="sv-ref"><option value="">Largest group</option>${levels.map(l => `<option${l === refChoice ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Stratify tests and Cox by</span><select id="sv-strata"><option value="">None</option><option value="study_id"${spec.strata === 'study_id' ? ' selected' : ''}>Source report</option>${spec.strata && spec.strata !== 'study_id' && !cols.some(c => c.id === spec.strata) ? `<option selected disabled value="${esc(spec.strata)}">Unavailable: ${esc(spec.strata)}</option>` : ''}${cols.filter(c => !['time', 'event'].includes(c.role) && c.id !== 'label' && c.type !== 'date' && c.id !== groupCol?.id).map(c => `<option value="${esc(c.id)}"${spec.strata === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${fromField}
        ${startField}
        <label class="field"><span>Survival at (months)</span><input id="sv-landmarks" class="num" value="${esc((spec.landmarks || []).join(', '))}" aria-label="Survival at months"></label>
        <label class="field"><span>Restricted mean to (months)</span><input id="sv-tau" class="num" value="${esc((spec.taus || []).join(', '))}" placeholder="Longest with 2 at risk" aria-label="Restricted mean survival horizon"></label>
        <label class="field"><span>Landmark from (months)</span><input id="sv-landmark" inputmode="decimal" autocomplete="off" class="num" value="${spec.landmarkStart || ''}" placeholder="None" aria-label="Landmark start"></label>
        <label class="field"><span>Leave out censored by (months)</span><input id="sv-early" inputmode="decimal" autocomplete="off" class="num" value="${spec.dropCensoredBy || ''}" placeholder="None" aria-label="Leave out patients censored by this month"></label>
        <label class="field"><span>Restrict to</span><select id="sv-restrict"><option value="">Everyone</option>${opts.filter(c => c.type !== 'number').map(c => `<option value="${esc(c.id)}"${c.id === spec.restrict?.col ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${restrictCol ? `<div class="field an-checks" role="group" aria-label="Values to keep"><span>Keep</span>${restrictValues.map(v => `<label class="cr-check"><input type="checkbox" data-rv="${esc(v)}"${(spec.restrict.values || []).map(String).includes(v) ? ' checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>` : ''}
        ${leaveField}
        ${leaveCol ? `<div class="field an-checks" role="group" aria-label="Values to leave out"><span>Leave out</span>${leaveValues.map(v => `<label class="cr-check"><input type="checkbox" data-lv="${esc(v)}"${(leave.values || []).map(String).includes(v) ? ' checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>` : ''}
        <label class="field"><span>Median follow-up</span><select id="sv-fu"><option value="reverse">Reverse Kaplan–Meier</option><option value="observed"${view.followUp === 'observed' ? ' selected' : ''}>Observed</option></select></label>
        <label class="field"><span>Proportional hazards test</span><select id="sv-ph">${PH_METHODS.map(([v, l]) => `<option value="${v}"${(spec.phMethod || 'exact') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Proportional hazards time scale</span><select id="sv-ph-tr">${PH_TRANSFORMS.map(([v, l]) => `<option value="${v}"${(spec.phTransform || 'km') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        ${covs.length && levels.length > 0 ? `<div class="field an-checks" role="group" aria-label="Adjust for"><span>Adjust the hazard ratio for</span>${covs.map(c => `<label class="cr-check"><input type="checkbox" data-cov="${esc(c.id)}"${(spec.covariates || []).some(x => x.id === c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>` : ''}
        <div class="field an-checks" role="group" aria-label="Variance"><span>Variance</span><label class="cr-check"><input type="checkbox" id="sv-cluster"${spec.cluster !== false ? ' checked' : ''}><span>Robust by report</span></label></div>
      </div>
      <table><thead><tr><th class="grow">${esc(groupName || 'Group')}</th><th>Patients</th><th>Events</th></tr></thead>
        <tbody>${levels.map(g => `<tr><td class="grow">${esc(g)}</td><td>${rows.filter(r => r.group === g).length}</td><td>${rows.filter(r => r.group === g && r.event).length}</td></tr>`).join('')}</tbody></table>`;
  const sens = rows.length || (s.survivalSensitivity || []).length ? sensitivityHtml(s, people, cols) : '';
  el.innerHTML = `<div class="panel sv-config" aria-busy="${pending ? 'true' : 'false'}">
    <div class="panel-body">
      ${rows.length < 2 && !people.length ? emptyState({ icon: 'table', title: missing.length ? `No column set as ${missing.join(' or ')}` : 'No patient data', actions: [{ id: 'to-patients', label: 'Patient data', icon: 'patients' }] }) : settings}
      ${reconstructedNote(people, rows, s)}
      ${inputError ? `<div class="note spaced" data-ui-help>${esc(inputError)}. Choose the analysis columns again.</div>` : ''}
      ${excluded.length ? `<details class="ui-disclosure spaced" data-edit-record="survival-exclusions"><summary>${excluded.length} patients left out: ${esc(summariseWhy(excluded))}</summary>${exclusionPreview(excluded, { papers: s.papers || [], page: exclusionPage, id: 'survival-exclusions' })}</details>` : ''}
      ${status === 'stale' ? '<div class="note spaced" data-survival-status="stale">Patient data or settings changed since this result. Run again before using it.</div>' : status === 'untracked' ? '<div class="note spaced" data-survival-status="untracked">This earlier result has no input snapshot. Run again to verify its patient data.</div>' : ''}
      <div class="note spaced" id="s-status" role="status" aria-live="polite">${esc(pending?.status || '')}</div>
    </div></div>
    <div id="s-out">${sens}</div>${rows.length ? swimmerPanelHtml(rows, cols, spec) : ''}`;

  el.querySelector('#to-patients')?.addEventListener('click', () => ctx.go('patients'));
  wireExclusionPreview(el, { id: 'survival-exclusions', onPage: n => { exclusionPage = n; }, ctx });
  if (saved) showResult(el, saved, ctx, sens);
  wireSensitivity(el, ctx);
  if (rows.length) drawSwimmer(el, rows, levels, people, monthsLabel(spec), (spec.view?.swimMarks || []).map(id => cols.find(c => c.id === id)).filter(Boolean));
  el.querySelectorAll('[data-swim-mark]').forEach(i => i.onchange = () => setView({ swimMarks: [...el.querySelectorAll('[data-swim-mark]:checked')].map(x => x.dataset.swimMark) }, ctx));
  wireSettings(el, ctx, { cols, people, groupCol, levels });
  if (pending) el.querySelectorAll('.sv-config .an-settings :is(select,input)').forEach(x => { x.disabled = true; });

  acts.run = async btn => {
    if (pendingRuns.has(projectKey)) return;
    const job = { status: 'Preparing analysis' }; pendingRuns.set(projectKey, job);
    if (btn) btn.disabled = true;
    el.querySelector('.sv-config').setAttribute('aria-busy', 'true');
    el.querySelectorAll('.sv-config .an-settings :is(select,input)').forEach(x => { x.disabled = true; });
    const say = t => { job.status = t; if ((get().project?.id ?? get().project) !== projectKey) return; const n = el.querySelector('#s-status'); if (n) n.textContent = t; };
    try {
      const sourceProject = get().project, sourcePeople = structuredClone(participants()), sourceCols = structuredClone(ipdColumns()), request = structuredClone(spec);
      const now = rowsFor(sourcePeople, sourceCols, request);
      const r = await runSurvival(now.rows, request, { onProgress: say, levels: now.levels, groupName: now.groupName || null,
        people: sourcePeople, columns: sourceCols, papers: structuredClone(get().papers || []), excluded: now.excluded });
      if (get().project !== sourceProject) return; // never attach a finished run to another project
      pendingRuns.delete(projectKey);
      update(st => setSurvival(st, r));
      say(''); ctx.refreshCounts(); ctx.rerender();
    } catch (err) {
      pendingRuns.delete(projectKey);
      if ((get().project?.id ?? get().project) === projectKey) {
        say(String(err.message || err).slice(0, 160)); if (btn) btn.disabled = false;
        el.querySelector('.sv-config')?.setAttribute('aria-busy', 'false');
        el.querySelectorAll('.sv-config .an-settings :is(select,input)').forEach(x => { x.disabled = false; });
      }
    } finally { if (pendingRuns.get(projectKey) === job) pendingRuns.delete(projectKey); }
  };
}

/** Patients rebuilt from published curves are not observations: say how many, and by what. */
function reconstructedNote(people, rows, s) {
  const ids = new Set(rows.map(r => r.id)), mine = people.filter(p => p.reconstructed && ids.has(p.id));
  if (!mine.length) return '';
  const made = new Set(mine.map(p => p.reconstructed)), methods = [...new Set((s.reconstructions || []).filter(r => made.has(r.id)).map(r => r.method))];
  return `<div class="note spaced">${mine.length} of ${rows.length} patients are reconstructed from published curves${methods.length ? ` (${esc(methods.join(', '))})` : ''}</div>`;
}

const summariseWhy = ex => Object.entries(ex.reduce((a, x) => { a[x.why] = (a[x.why] || 0) + 1; return a; }, {})).map(([w, n]) => `${n} ${w}`).join(', ');

function wireSettings(el, ctx, { cols, people, groupCol, levels }) {
  const spec = specOf();
  const again = () => ctx.rerender();
  el.querySelector('#sv-group')?.addEventListener('change', e => {
    const v = e.target.value;
    spec.group = v === '@role' ? undefined : v === '@none' ? null : v;
    spec.bins = []; spec.reference = ''; spec.covariates = [];
    if (spec.strata === (spec.group ?? cols.find(c => c.role === 'group')?.id)) spec.strata = '';
    // a year-like number column starts with the cut points a reader would try
    const c = cols.find(x => x.id === v);
    if (c?.type === 'number') spec.bins = [];
    again();
  });
  const list = (id, key, min = 0) => el.querySelector(id)?.addEventListener('change', e => { spec[key] = parseList(e.target.value).filter(x => x >= min); again(); });
  list('#sv-landmarks', 'landmarks'); list('#sv-tau', 'taus', 0); list('#sv-bins', 'bins');
  el.querySelector('#sv-ref')?.addEventListener('change', e => { spec.reference = e.target.value; again(); });
  el.querySelector('#sv-strata')?.addEventListener('change', e => { spec.strata = e.target.value; again(); });
  el.querySelector('#sv-landmark')?.addEventListener('change', e => { spec.landmarkStart = Math.max(0, Number(e.target.value) || 0); again(); });
  el.querySelector('#sv-early')?.addEventListener('change', e => { spec.dropCensoredBy = Math.max(0, Number(e.target.value) || 0); again(); });
  el.querySelector('#sv-cluster')?.addEventListener('change', e => { spec.cluster = e.target.checked; again(); });
  el.querySelector('#sv-time')?.addEventListener('change', e => { spec.time = cols.find(c => c.id === e.target.value)?.role === 'time' ? undefined : e.target.value; again(); });
  el.querySelector('#sv-event')?.addEventListener('change', e => { spec.event = cols.find(c => c.id === e.target.value)?.role === 'event' ? undefined : e.target.value; again(); });
  el.querySelector('#sv-from')?.addEventListener('change', e => {
    const c = cols.find(x => x.id === e.target.value);
    spec.from = c ? { col: c.id, start: c.type === 'date' ? (cols.find(x => x.type === 'date' && x.id !== c.id)?.id || '') : '' } : null; again(); });
  el.querySelector('#sv-from-start')?.addEventListener('change', e => { spec.from = { ...spec.from, start: e.target.value }; again(); });
  el.querySelector('#sv-leave')?.addEventListener('change', e => { spec.leaveOut = e.target.value ? [{ col: e.target.value, values: [] }] : []; again(); });
  el.querySelectorAll('[data-lv]').forEach(i => i.onchange = () => { spec.leaveOut = [{ ...spec.leaveOut[0], values: [...el.querySelectorAll('[data-lv]:checked')].map(x => x.dataset.lv) }]; again(); });
  el.querySelector('#sv-ph')?.addEventListener('change', e => { spec.phMethod = e.target.value; again(); });
  el.querySelector('#sv-ph-tr')?.addEventListener('change', e => { spec.phTransform = e.target.value; again(); });
  el.querySelector('#sv-fu')?.addEventListener('change', e => setView({ followUp: e.target.value }, ctx));
  el.querySelector('#sv-restrict')?.addEventListener('change', e => { spec.restrict = e.target.value ? { col: e.target.value, values: [] } : null; again(); });
  el.querySelectorAll('[data-rv]').forEach(i => i.onchange = () => { spec.restrict = { ...spec.restrict, values: [...el.querySelectorAll('[data-rv]:checked')].map(x => x.dataset.rv) }; again(); });
  el.querySelectorAll('[data-cov]').forEach(i => i.onchange = () => {
    spec.covariates = [...el.querySelectorAll('[data-cov]:checked')].map(o => {
      const c = cols.find(x => x.id === o.dataset.cov);
      return c.type === 'number' ? { id: c.id, name: c.name, type: 'number' }
        : { id: c.id, name: c.name, type: 'category', levels: [...new Set(people.map(p => String(p[c.id] ?? '').trim()).filter(Boolean))].sort() };
    });
    again();
  });
  void groupCol; void levels;
}

/**
 * How the result is shown (the follow-up column, the figure's axis, ticks, at-risk times and marks): kept in the settings and on the saved
 * result, so the figure Tables and figures and the submission draw is the one on screen. It changes no number, so the result stays current.
 */
function setView(patch, ctx) {
  const spec = specOf();
  spec.view = { ...(spec.view || {}), ...patch };
  for (const k of Object.keys(spec.view)) if (spec.view[k] == null || spec.view[k] === '' || (Array.isArray(spec.view[k]) && !spec.view[k].length)) delete spec.view[k];
  const view = structuredClone(spec.view);
  update(st => { const e = st.survival?.ext; if (e) { e.spec = { ...(e.spec || {}), view }; if (e.inputSpec) e.inputSpec = { ...e.inputSpec, view }; } return st; });
  ctx.rerender();
}

// ---- the result ----------------------------------------------------------------------------
function showResult(el, r, ctx, sens = '') {
  const out = el.querySelector('#s-out'); if (!out) return;
  const e = r.ext, km = e.km, view = specOf().view || {};
  const rev = new Map((e.reverse?.by || []).map(g => [g.group, g]));
  const lm = km.landmarks, observed = view.followUp === 'observed';
  const band = x => `<span class="meta"> ${pct(x.lo)}–${pct(x.hi)}</span>`;
  const surv = (g, t) => { const x = g.survival.find(v => v.time === t); return !x ? '—' : x.collapsed ? pct(x.surv) : pct(x.surv) + band(x); };
  const atRisk = g => lm.map(t => g.survival.find(v => v.time === t)?.nRisk ?? '—').join(' / ');
  const grp = e.groups.length > 1;
  const fu = g => (observed ? observedFollowUp(e, g) : g === km.overall ? e.reverse?.overall : rev.get(g.group));
  const fuCell = x => (x?.median == null ? '—' : `${num(x.median)}${observed ? '' : ci(x.lo, x.hi)}`);
  out.innerHTML = `
    <div class="panel">${uiBar({ kind: 'head', label: 'Freedom from event', id: 'sv-result-head', lead: { title: 'Freedom from event' }, message: { id: 'sv-result-meta', text: `${e.counts.n} patients, ${e.counts.events} events${e.spec.landmarkStart ? `, landmark ${e.spec.landmarkStart} months` : ''}` },
        actions: [{ id: 'sv-results-csv', label: 'Download results', icon: 'download' }] })}
      <div class="panel-body tight">${tableRegion({ label: 'Freedom from event by group', sticky: true, html: `<table class="sv-table"><thead><tr><th>${esc(e.groupName || 'Group')}</th><th>n</th><th>Events</th><th>Person-months</th><th>Per 100 person-months</th>
        <th>Median (95% CI)</th><th>Median follow-up, ${observed ? 'observed' : 'reverse KM'}</th>${lm.map(t => `<th>${t} mo</th>`).join('')}${lm.length ? `<th>At risk at ${lm.join(' / ')} mo</th>` : ''}</tr></thead>
        <tbody>${[...(grp ? km.by : []), km.overall].map(g => { const rate = eventsPer100({ events: g.events, personTime: g.personTime });
          return `<tr><td>${esc(g.group === 'All' && grp ? 'All patients' : g.group)}</td><td>${g.n}</td><td>${g.events}</td><td>${num(g.personTime, 0)}</td>
            <td>${num(rate?.rate ?? g.per100, 2)}<span class="meta">${rate?.lo != null ? ` ${num(rate.lo, 2)}–${num(rate.hi, 2)}` : ''}</span></td>
            <td>${g.median.est == null ? 'not reached' : `${num(g.median.est)}${ci(g.median.lo, g.median.hi)}`}</td>
            <td>${fuCell(fu(g))}</td>${lm.map(t => `<td>${surv(g, t)}</td>`).join('')}${lm.length ? `<td>${atRisk(g)}</td>` : ''}</tr>`; }).join('')}</tbody></table>` })}</div>
      ${e.followUp ? `<div class="panel-body"><p class="meta" data-ui-help>Observed follow-up: median ${num(e.followUp.median)} months, IQR ${num(e.followUp.q1)} to ${num(e.followUp.q3)}</p></div>` : ''}
      ${km.warnings?.length ? `<div class="panel-body">${km.warnings.map(w => `<div class="note spaced">${esc(w)}</div>`).join('')}</div>` : ''}</div>
    ${e.tests ? testsPanel(e.tests, e.rmst) : ''}
    ${e.rmst ? rmstPanel(e.rmst) : e.stages.rmst ? `<div class="note spaced">Restricted mean survival: ${esc(e.stages.rmst)}</div>` : ''}
    ${e.cox ? coxPanel(e.cox, e) : e.stages.cox ? `<div class="note spaced">Cox regression not estimated: ${esc(e.stages.cox)}</div>` : ''}
    ${sens}
    ${figurePanel({ title: 'Kaplan–Meier', id: 'km', zoom: false, extra: `<label class="cr-check"><input type="checkbox" id="km-bands"${showBands.ci ? ' checked' : ''}><span>Confidence bands</span></label>` })
      .replace('<div class="panel-body figure-wrap">', `${figureSettings(view, e)}<div class="panel-body figure-wrap">`)}`;
  const km1 = style => kmFigure(km, { xLabel: monthsLabel(e.spec), ci: showBands.ci, ...survivalFigureOptions(e.tests, { ...e.spec, view }), style });
  // on screen the curves Make draws (lib/analysis-charts.mjs kmChart: the number at risk under the axis's ticks, at the panel's width); the
  // screen chart has no pairwise brackets, so with marks asked for (Marks, adjusted or unadjusted) the house drawing is shown, as it prints
  const kmScreen = w => {
    const o = survivalFigureOptions(e.tests, { ...e.spec, view }), by = e.groups.length > 1 ? km.by : [km.overall];
    const end = o.xMax ?? Math.max(...by.map(g => g.steps?.at(-1)?.time || 0)), times = (o.atRiskTimes || o.ticks || niceTicks(end, 6).ticks).filter(t => t <= end);
    const groups = by.map(g => ({ ...g, group: g.group === 'All' && by.length === 1 ? 'All patients' : g.group, atRisk: times.map(t => ({ time: t, n: riskAt(g, t) })) }));
    return kmChart({ by: groups }, { width: w, times, xLabel: monthsLabel(e.spec), p: o.p ?? null, band: showBands.ci, xMax: o.xMax ?? null, title: 'Kaplan–Meier' });
  };
  const draw = () => (survivalFigureOptions(e.tests, { ...e.spec, view }).pairs?.length
    ? showFigure(el, 'km', km1(figureTokens(null, { medium: 'screen' })), 'kaplan-meier', { exportSvg: () => km1(figureTokens(null, { medium: 'export' })) })
    : showChart(el, 'km', kmScreen, 'kaplan-meier', { exportSvg: () => km1(figureTokens(null, { medium: 'export' })) }));
  draw();
  el.querySelector('#km-bands').onchange = ev => { showBands.ci = ev.target.checked; draw(); };
  el.querySelector('#sv-results-csv').onclick = () => downloadCsv(resultsCsv(r, view), 'time-to-event-results.csv');
  const listOf = (id, key) => el.querySelector(id)?.addEventListener('change', ev => setView({ [key]: parseList(ev.target.value) }, ctx));
  listOf('#km-ticks', 'ticks'); listOf('#km-risk', 'riskTimes');
  el.querySelector('#km-xmax')?.addEventListener('change', ev => setView({ xMax: Number(ev.target.value) > 0 ? Number(ev.target.value) : null }, ctx));
  el.querySelector('#km-marks')?.addEventListener('change', ev => setView({ marks: ev.target.value || null }, ctx));
}

/** The time axis's name: months, from the column the clock starts at when it is not the recorded time zero. */
function monthsLabel(spec) {
  const c = spec?.from?.col ? ipdColumns().find(x => x.id === spec.from.col) : null;
  return c ? `Months from ${c.type === 'date' ? c.name : c.name.replace(/^months?\s+(to|until)\s+/i, '')}` : 'Months';
}

/** The plain median of the analysed follow-up times of a group (or of everyone): what a paper calls median follow-up when it gives no method. */
function observedFollowUp(e, g) {
  const rows = (e.inputRows || []).filter(x => g.group === 'All' || x.group === g.group);
  return rows.length ? medianFollowUp(rows) : null;
}

/** The figure's axis end, ticks, number-at-risk times and pairwise marks: drawing only, never a rerun. */
function figureSettings(view, e) {
  return `<div class="panel-body"><div class="an-settings" id="km-settings">
    <label class="field"><span>Axis to (months)</span><input id="km-xmax" inputmode="decimal" autocomplete="off" class="num" value="${view.xMax ?? ''}" placeholder="Last follow-up" aria-label="Axis to months"></label>
    <label class="field"><span>Ticks at (months)</span><input id="km-ticks" class="num" value="${esc((view.ticks || []).join(', '))}" placeholder="Round numbers" aria-label="Ticks at months"></label>
    <label class="field"><span>Number at risk at (months)</span><input id="km-risk" class="num" value="${esc((view.riskTimes || []).join(', '))}" placeholder="The ticks" aria-label="Number at risk at months"></label>
    ${e.tests?.pairwise?.length ? `<label class="field"><span>Pairwise marks</span><select id="km-marks"><option value="">None</option>
      <option value="adjusted"${view.marks === 'adjusted' ? ' selected' : ''}>Holm–Šídák adjusted p</option><option value="unadjusted"${view.marks === 'unadjusted' ? ' selected' : ''}>Unadjusted p</option></select></label>` : ''}
  </div></div>`;
}

function testsPanel(t, rm) {
  const row = (name, x) => x ? `<tr><th>${name}</th><td>χ² ${num(x.chisq, 2)} on ${x.df} df, ${pEq(x.p)}</td></tr>` : '';
  const tau = rm?.byTau?.[0], pairOf = x => tau?.pairs?.find(d => d.a === x.a && d.b === x.b);
  const sg = v => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 1)}`;
  const diff = d => (d?.est == null ? '—' : `${sg(d.est)}<span class="meta"> ${sg(d.lo)} to ${sg(d.hi)}</span>`);
  return `<div class="panel"><div class="panel-head"><h2>Tests across groups</h2></div><div class="panel-body"><table><tbody>
      ${row(t.stratified ? 'Log-rank (unstratified)' : 'Log-rank', t.logrank)}${row('Gehan–Breslow–Wilcoxon', t.gehanBreslow)}${row('Peto–Peto', t.petoPeto)}${row('Stratified log-rank', t.stratified)}</tbody></table></div>
    ${t.pairwise.length ? `<div class="panel-body tight">${tableRegion({ label: 'Pairwise comparisons', sticky: true, html: `<table><thead><tr><th>Comparison</th><th>${t.pairwiseStratified ? 'Stratified log-rank χ²' : 'Log-rank χ²'}</th><th>p</th><th>Holm–Šídák adjusted p</th>${tau ? `<th>RMST difference, ${tau.tau} mo (95% CI)</th>` : ''}</tr></thead>
      <tbody>${t.pairwise.map(x => `<tr><td>${esc(x.a)} vs ${esc(x.b)}</td><td>${num(x.chisq, 2)}</td><td>${pval(x.p)}</td><td>${pval(x.padj)}</td>${tau ? `<td>${diff(pairOf(x))}</td>` : ''}</tr>`).join('')}</tbody></table>` })}</div>` : ''}</div>`;
}

function rmstPanel(m) {
  return `<div class="panel"><div class="panel-head"><h2>Restricted mean survival time</h2><span class="meta">Difference from ${esc(m.reference)}, ${Math.round(m.conf * 100)}% CI, unadjusted</span></div>
    ${m.byTau.map(t => `<div class="panel-body tight"><table><thead><tr><th class="grow">Through ${t.tau} months</th><th>RMST (SE)</th><th>Difference</th><th>p</th></tr></thead>
      <tbody>${t.groups.map(g => `<tr><td class="grow">${esc(g.group)}${g.beyond ? ' <span class="meta">past follow-up</span>' : ''}</td><td>${num(g.rmst, 2)} (${num(g.se, 2)})</td>
        <td>${g.group === m.reference ? '—' : `${num(g.diff.est, 2)}${ci(g.diff.lo, g.diff.hi, 2)}`}</td><td>${g.group === m.reference ? '' : pval(g.diff.p)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>`;
}

const PH_NAME = { exact: 'score test', approx: 'approximate test' };
const TR_NAME = Object.fromEntries(PH_TRANSFORMS.map(([v, l]) => [v, l === 'Kaplan–Meier' ? l : l.toLowerCase()]));
/** A Cox model with what decides whether it means anything: events per variable, the proportional-hazards test, and whether the interval is clustered. */
function coxPanel(c, e) {
  const warnings = [];
  if (c.epv != null && c.epv < 10) warnings.push(`${num(c.epv)} events per variable: treat as exploratory`);
  if (c.phGlobalP != null && c.phGlobalP < 0.05) warnings.push(`Proportional hazards rejected (${pEq(c.phGlobalP)}): the hazard ratio does not describe these data`);
  for (const w of c.warnings || []) warnings.push(w);
  const test = (name, x) => x ? `<tr><th>${name}</th><td>χ² ${num(x.chisq, 2)} on ${x.df} df, ${pEq(x.p)}</td></tr>` : '';
  const perTerm = (c.zph || []).filter(z => z.term !== 'GLOBAL' && z.p != null);
  const ph = c.phGlobalP == null ? '—' : `${pEq(c.phGlobalP)} global`;
  const infinite = c.terms.some(t => t.notEstimable), wald = (name, x) => (infinite && x ? `<tr><th>${name}</th><td>Not interpretable: a coefficient is infinite</td></tr>` : test(name, x));
  return `<div class="panel"><div class="panel-head"><h2>Cox regression</h2>
      <span class="meta">Reference: ${esc(c.reference)}; Efron ties${e.spec.strata ? `; baseline hazards stratified by ${esc(e.spec.strata === 'study_id' ? 'source report' : e.spec.strata)}` : ''}${c.cluster ? `; variance robust to clustering by report (${e.counts.clusters} reports)` : ''}</span></div>
    <div class="panel-body tight"><table><thead><tr><th class="grow">Term</th><th>Hazard ratio</th><th>95% CI</th><th>p</th><th>E-value</th></tr></thead>
      <tbody>${c.terms.map(t => t.notEstimable ? `<tr data-not-estimable><td class="grow">${esc(t.term)}</td><td colspan="4">Not estimable (${esc(t.notEstimable)})</td></tr>`
        : `<tr><td class="grow">${esc(t.term)}</td><td>${num(t.hr, HR_DIGITS)}</td><td>${num(t.lo, HR_DIGITS)} to ${num(t.hi, HR_DIGITS)}</td><td>${pval(t.p)}</td>
        <td>${t.eValue ? `${num(t.eValue.point, 2)}<span class="meta"> limit ${num(t.eValue.ci, 2)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel-body"><table><tbody>${test('Likelihood ratio', c.lr)}${wald('Wald', c.wald)}${test('Score', c.score)}${c.robust ? wald('Robust', c.robust) : ''}
      <tr><th>Proportional hazards, ${PH_NAME[c.phMethod || 'exact']} on ${TR_NAME[c.phTransform || 'km']} time</th><td>${ph}</td></tr>
      ${perTerm.map(z => `<tr><th>${esc(z.name || z.term)}</th><td>${pEq(z.p)}</td></tr>`).join('')}
      <tr><th>Events, events per variable</th><td>${c.events}, ${num(c.epv)}</td></tr></tbody></table>
      ${warnings.map(w => `<div class="note spaced">${esc(w)}</div>`).join('')}</div></div>`;
}

// ---- sensitivity analyses ------------------------------------------------------------------
// A sensitivity analysis is the settings in view under a name (leave out abstracts, a landmark, patients censored early), kept with
// the overall test it gives, as a paper's table of sensitivity analyses lists them. Its patients and test are read again on Run again;
// a row whose patient data changed since says so.
let sensBusy = false;
function sensitivityHtml(s, people, cols) {
  const list = s.survivalSensitivity || [];
  const line = a => {
    let stale = false; try { stale = a.snapshot !== survivalInputSnapshot(people, cols, a.spec); } catch { stale = true; }
    const t = a.test;
    return uiRow({ attrs: { 'data-sens': a.id }, main: { html: esc(a.name), detail: [`${plural(a.n, 'patient')}, ${plural(a.events, 'event')}`,
      t ? `${t.stratified ? 'stratified log-rank' : 'log-rank'} χ² ${num(t.chisq, 2)} on ${t.df} df, ${pEq(t.p)}` : 'one group, no test', stale ? 'patient data changed: run again' : ''] },
      end: uiRowEnd({ more: { label: `More for ${a.name}`, attrs: { 'data-sens-more': a.id } } }) });
  };
  return `<div class="panel">${uiBar({ kind: 'head', label: 'Sensitivity analyses', id: 'sv-sens-head', lead: { title: 'Sensitivity analyses' },
      actions: [{ id: 'sv-sens-add', label: 'Save these settings', icon: 'save', disabled: sensBusy }] })}
    <div class="panel-body tight">${uiList({ id: 'sv-sens', label: 'Sensitivity analyses', rows: list.map(line), empty: '<p class="meta">None saved.</p>' })}</div></div>`;
}

/** The settings' patients and their overall test (log-rank, or stratified when the settings stratify): one R run. */
async function sensitivityRun(spec) {
  const people = structuredClone(participants()), cols = structuredClone(ipdColumns());
  const { rows, levels } = rowsFor(people, cols, spec), lev = groupLevels(rows, levels);
  const base = { n: rows.length, events: rows.filter(r => r.event).length, snapshot: survivalInputSnapshot(people, cols, spec), at: new Date().toISOString() };
  if (lev.length < 2) return { ...base, test: null };
  const t = logrankShape(await runJson(logrankScript(rows, { levels: lev }))), x = spec.strata ? t.stratified : t.logrank;
  return { ...base, test: x ? { chisq: x.chisq, df: x.df, p: x.p, stratified: !!spec.strata } : null };
}

/** A name a reader would give the settings: what they leave out and how the clock runs. */
function sensitivityName(spec, cols) {
  const name = id => cols.find(c => c.id === id)?.name || id, parts = [];
  for (const r of spec.leaveOut || []) if (r.values?.length) parts.push(`Leaving out ${name(r.col)} ${r.values.join(', ')}`);
  if (spec.restrict?.values?.length) parts.push(`${name(spec.restrict.col)} ${spec.restrict.values.join(', ')} only`);
  if (spec.dropCensoredBy) parts.push(`Leaving out patients censored by ${spec.dropCensoredBy} months`);
  if (spec.landmarkStart) parts.push(`Landmark at ${spec.landmarkStart} months`);
  if (spec.from?.col) parts.push(`From ${name(spec.from.col)}`);
  return parts.join('; ') || 'All patients';
}

function wireSensitivity(el, ctx) {
  const say = t => { const n = el.querySelector('#s-status'); if (n) n.textContent = t; };
  const run = async (fn, busyText) => { if (sensBusy) return; sensBusy = true; say(busyText); ctx.rerender();
    try { await fn(); say(''); } catch (err) { say(String(err?.message || err).slice(0, 160)); } finally { sensBusy = false; ctx.rerender(); } };
  el.querySelector('#sv-sens-add')?.addEventListener('click', async () => {
    const spec = structuredClone(specOf()), name = await ask('Name the sensitivity analysis', { value: sensitivityName(spec, ipdColumns()), confirm: 'Save' });
    if (!name?.trim()) return;
    await run(async () => { const r = await sensitivityRun(spec), id = `sens-${Date.now().toString(36)}`;
      update(st => { st.survivalSensitivity = [...(st.survivalSensitivity || []), { id, name: name.trim(), spec, ...r }]; return st; }); }, 'Running the sensitivity analysis');
  });
  el.querySelectorAll('[data-sens-more]').forEach(b => b.onclick = () => {
    const a = (get().survivalSensitivity || []).find(x => x.id === b.dataset.sensMore); if (!a) return;
    showMenu(b, [
      { label: 'Use these settings', icon: 'restore', run: () => { ui = structuredClone({ ...DEFAULT_SPEC, ...a.spec }); ctx.rerender(); } },
      { label: 'Run again', icon: 'refresh', disabled: sensBusy, run: () => run(async () => { const r = await sensitivityRun(a.spec);
        update(st => { st.survivalSensitivity = (st.survivalSensitivity || []).map(x => (x.id === a.id ? { ...x, ...r } : x)); return st; }); }, 'Running the sensitivity analysis') },
      { label: 'Remove', icon: 'trash', danger: true, run: () => { update(st => { st.survivalSensitivity = (st.survivalSensitivity || []).filter(x => x.id !== a.id); return st; }); ctx.rerender(); } },
    ], { align: 'end' });
  });
}

/** The result as rows: the summary, the tests, the restricted means and the hazard ratios, each under its own heading. */
export function resultsCsv(r, view = r.ext?.spec?.view || {}) {
  const e = r.ext, km = e.km, out = [], observed = view.followUp === 'observed';
  out.push([e.groupName || 'Group', 'n', 'Events', 'Person-months', 'Per 100 person-months', 'Median', 'Median lower', 'Median upper', observed ? 'Median follow-up (observed)' : 'Median follow-up (reverse KM)',
    ...km.landmarks.flatMap(t => [`Survival at ${t} months`, 'Lower', 'Upper', `At risk at ${t} months`])]);
  for (const g of [...(e.groups.length > 1 ? km.by : []), km.overall]) {
    const rv = observed ? observedFollowUp(e, g) : g === km.overall ? e.reverse?.overall : e.reverse?.by.find(x => x.group === g.group);
    out.push([g.group, g.n, g.events, g.personTime, g.per100 ?? '', g.median.est ?? '', g.median.lo ?? '', g.median.hi ?? '', rv?.median ?? '',
      ...km.landmarks.flatMap(t => { const x = g.survival.find(v => v.time === t); return x ? [x.surv, x.lo ?? '', x.hi ?? '', x.nRisk ?? ''] : ['', '', '', '']; })]);
  }
  if (e.tests) {
    out.push([], ['Test', 'Chi-square', 'df', 'p']);
    for (const [k, n] of [['logrank', 'Log-rank'], ['gehanBreslow', 'Gehan-Breslow-Wilcoxon'], ['petoPeto', 'Peto-Peto'], ['stratified', 'Stratified log-rank']]) if (e.tests[k]) out.push([n, e.tests[k].chisq, e.tests[k].df, e.tests[k].p]);
    const tau = e.rmst?.byTau?.[0];
    out.push([], [e.tests.pairwiseStratified ? 'Comparison (stratified log-rank)' : 'Comparison', 'Chi-square', 'p', 'Holm-Sidak adjusted p', ...(tau ? [`RMST difference through ${tau.tau} months`, 'Lower', 'Upper', 'p'] : [])]);
    for (const x of e.tests.pairwise) { const d = tau?.pairs?.find(y => y.a === x.a && y.b === x.b);
      out.push([`${x.a} vs ${x.b}`, x.chisq ?? '', x.p, x.padj, ...(tau ? [d?.est ?? '', d?.lo ?? '', d?.hi ?? '', d?.p ?? ''] : [])]); }
  }
  if (e.rmst) for (const t of e.rmst.byTau) {
    out.push([], [`RMST through ${t.tau} months`, 'RMST', 'SE', `Difference from ${e.rmst.reference}`, 'Lower', 'Upper', 'p']);
    for (const g of t.groups) out.push([g.group, g.rmst, g.se, g.group === e.rmst.reference ? '' : g.diff.est, g.diff.lo ?? '', g.diff.hi ?? '', g.diff.p ?? '']);
  }
  if (e.cox) {
    out.push([], [`Cox regression, reference ${e.cox.reference}`, 'Hazard ratio', 'Lower', 'Upper', 'p', 'E-value', 'E-value limit']);
    for (const t of e.cox.terms) out.push(t.notEstimable ? [t.term, `not estimable (${t.notEstimable})`, '', '', '', '', ''] : [t.term, t.hr, t.lo, t.hi, t.p, t.eValue?.point ?? '', t.eValue?.ci ?? '']);
    out.push([], [`Proportional hazards, ${PH_NAME[e.cox.phMethod || 'exact']} on ${TR_NAME[e.cox.phTransform || 'km']} time`, 'Chi-square', 'df', 'p']);
    for (const z of e.cox.zph || []) out.push([z.name || z.term, z.chisq ?? '', z.df ?? '', z.p ?? '']);
  }
  return out;
}

// ---- the swimmer plot -----------------------------------------------------------------------
const SWIMMER_MAX = 250;
/** Number columns that hold when something happened (months to progression, to death): each can be marked on the swimmer's bars. */
const markable = (cols, spec) => cols.filter(c => c.type === 'number' && c.role !== 'time' && c.id !== spec.time && /^months? to\b|\bmonths? (to|until)\b/i.test(c.name || ''));
function swimmerPanelHtml(rows, cols = [], spec = {}) {
  if (rows.length > SWIMMER_MAX) return '';
  const marks = markable(cols, spec), on = new Set(spec.view?.swimMarks || []);
  return figurePanel({ title: 'Swimmer plot', id: 'swim', zoom: false }).replace('<div class="panel-body figure-wrap">', `${marks.length ? `<div class="panel-body"><div class="an-settings">
    <div class="field an-checks" role="group" aria-label="Marks on the bars"><span>Mark on the bars</span>${marks.map(c => `<label class="cr-check"><input type="checkbox" data-swim-mark="${esc(c.id)}"${on.has(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
  </div></div>` : ''}<div class="panel-body figure-wrap">`);
}
function drawSwimmer(el, rows, levels, people, xLabel = 'Months', marks = []) {
  if (rows.length > SWIMMER_MAX || !el.querySelector('#swim')) return;
  const label = new Map(people.map(p => [p.id, p.label || p.id]));
  const byId = new Map(people.map(p => [p.id, p]));
  // a mark is drawn at its column's value, which counts from the same zero as the time drawn (months to progression after SRS on a swimmer from SRS)
  const pts = rows.map(r => ({ label: label.get(r.id), group: r.group, time: r.time, event: !!r.event,
    markers: marks.map(c => ({ t: Number(String(byId.get(r.id)?.[c.id] ?? '').trim() || NaN), kind: c.name.replace(/^months? to\s+/i, '').replace(/^./, x => x.toUpperCase()) })).filter(m => Number.isFinite(m.t) && m.t <= r.time) })), swim1 = style => swimmerFigure(pts, { groups: levels, xLabel, style });
  // on screen a lane per patient as Make draws it (lib/analysis-charts.mjs laneChart), longest follow-up first within each group, as the print
  // sorts them; Download is the print
  const lanes = [...pts].sort((x, y) => y.time - x.time).map(p => ({ ...p, attrs: {} }));
  showChart(el, 'swim', w => laneChart(lanes, { width: w, groups: levels, unit: /month/i.test(xLabel) ? 'months' : '', xLabel, title: 'Swimmer plot' }), 'swimmer-plot', { exportSvg: () => swim1(figureTokens(null, { medium: 'export' })) });
  const m = el.querySelector('#swim-meta'); if (m) m.textContent = `${rows.length} patients, ${rows.filter(r => r.event).length} events`;
}

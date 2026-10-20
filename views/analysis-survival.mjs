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
import { uiBar } from '../lib/ui-actions.mjs';
import { plural } from '../lib/dates.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { columns as ipdColumns, participants, roleColumn } from '../lib/ipd.mjs';
import { DEFAULT_SPEC, rowsFor, runSurvival, parseList, survivalInputStatus, survivalFigureOptions } from '../lib/survival-run.mjs';
import { kmFigure, swimmerFigure } from '../lib/survival-fig.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { eventsPer100 } from '../lib/survival.mjs';
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
  const said = `${plural(rows.length, 'patient')} · ${plural(rows.filter(r => r.event).length, 'event')}`;
  return { title, status: { text: said.length <= 24 ? said : plural(rows.length, 'patient'), ch: 24 },
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

  const groupValue = spec.group === undefined ? '@role' : spec.group === null ? '@none' : spec.group;
  const settings = `
      <div class="an-settings">
        <label class="field"><span>Group by</span><select id="sv-group">
          <option value="@none"${groupValue === '@none' ? ' selected' : ''}>None, all patients</option>
          ${!['@none', '@role'].includes(groupValue) && !cols.some(c => c.id === groupValue) ? `<option selected disabled value="${esc(groupValue)}">Unavailable: ${esc(groupValue)}</option>` : ''}
          ${roleColumn('group') ? `<option value="@role"${groupValue === '@role' ? ' selected' : ''}>${esc(roleColumn('group').name)}</option>` : ''}
          ${opts.filter(c => c.role !== 'group').map(c => `<option value="${esc(c.id)}"${groupValue === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${groupCol?.type === 'number' ? `<label class="field"><span>Cut points</span><input id="sv-bins" class="num" value="${esc((spec.bins || []).join(', '))}" placeholder="2010, 2020" aria-label="Cut points"></label>` : ''}
        <label class="field"><span>Reference group</span><select id="sv-ref"><option value="">Largest group</option>${levels.map(l => `<option${l === refChoice ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Stratify tests and Cox by</span><select id="sv-strata"><option value="">None</option><option value="study_id"${spec.strata === 'study_id' ? ' selected' : ''}>Source report</option>${spec.strata && spec.strata !== 'study_id' && !cols.some(c => c.id === spec.strata) ? `<option selected disabled value="${esc(spec.strata)}">Unavailable: ${esc(spec.strata)}</option>` : ''}${cols.filter(c => !['time', 'event'].includes(c.role) && c.id !== 'label' && c.type !== 'date' && c.id !== groupCol?.id).map(c => `<option value="${esc(c.id)}"${spec.strata === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Survival at (months)</span><input id="sv-landmarks" class="num" value="${esc((spec.landmarks || []).join(', '))}" aria-label="Survival at months"></label>
        <label class="field"><span>Restricted mean to (months)</span><input id="sv-tau" class="num" value="${esc((spec.taus || []).join(', '))}" placeholder="Longest with 2 at risk" aria-label="Restricted mean survival horizon"></label>
        <label class="field"><span>Landmark from (months)</span><input id="sv-landmark" inputmode="decimal" autocomplete="off" class="num" value="${spec.landmarkStart || ''}" placeholder="None" aria-label="Landmark start"></label>
        <label class="field"><span>Leave out censored by (months)</span><input id="sv-early" inputmode="decimal" autocomplete="off" class="num" value="${spec.dropCensoredBy || ''}" placeholder="None" aria-label="Leave out patients censored by this month"></label>
        <label class="field"><span>Restrict to</span><select id="sv-restrict"><option value="">Everyone</option>${opts.filter(c => c.type !== 'number').map(c => `<option value="${esc(c.id)}"${c.id === spec.restrict?.col ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        ${restrictCol ? `<div class="field an-checks" role="group" aria-label="Values to keep"><span>Keep</span>${restrictValues.map(v => `<label class="cr-check"><input type="checkbox" data-rv="${esc(v)}"${(spec.restrict.values || []).map(String).includes(v) ? ' checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>` : ''}
        ${covs.length && levels.length > 0 ? `<div class="field an-checks" role="group" aria-label="Adjust for"><span>Adjust the hazard ratio for</span>${covs.map(c => `<label class="cr-check"><input type="checkbox" data-cov="${esc(c.id)}"${(spec.covariates || []).some(x => x.id === c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>` : ''}
        <div class="field an-checks" role="group" aria-label="Variance"><span>Variance</span><label class="cr-check"><input type="checkbox" id="sv-cluster"${spec.cluster !== false ? ' checked' : ''}><span>Robust by report</span></label></div>
      </div>
      <table><thead><tr><th class="grow">${esc(groupName || 'Group')}</th><th>Patients</th><th>Events</th></tr></thead>
        <tbody>${levels.map(g => `<tr><td class="grow">${esc(g)}</td><td>${rows.filter(r => r.group === g).length}</td><td>${rows.filter(r => r.group === g && r.event).length}</td></tr>`).join('')}</tbody></table>`;
  el.innerHTML = `<div class="panel sv-config" aria-busy="${pending ? 'true' : 'false'}">
    <div class="panel-body">
      ${rows.length < 2 && !people.length ? emptyState({ icon: 'table', title: missing.length ? `No column set as ${missing.join(' or ')}` : 'No patient data', actions: [{ id: 'to-patients', label: 'Patient data', icon: 'patients' }] }) : settings}
      ${reconstructedNote(people, rows, s)}
      ${spec.strata ? '<div class="note spaced" data-ui-help>Strata apply to log-rank comparisons and Cox baseline hazards. Kaplan–Meier and restricted means remain unadjusted.</div>' : ''}
      ${inputError ? `<div class="note spaced" data-ui-help>${esc(inputError)}. Choose the analysis columns again.</div>` : ''}
      ${excluded.length ? `<details class="ui-disclosure spaced" data-edit-record="survival-exclusions"><summary>${excluded.length} patients left out · ${esc(summariseWhy(excluded))}</summary>${exclusionPreview(excluded, { papers: s.papers || [], page: exclusionPage, id: 'survival-exclusions' })}</details>` : ''}
      ${status === 'stale' ? '<div class="note spaced" data-survival-status="stale">Patient data or settings changed since this result. Run again before using it.</div>' : status === 'untracked' ? '<div class="note spaced" data-survival-status="untracked">This earlier result has no input snapshot. Run again to verify its patient data.</div>' : ''}
      <div class="note spaced" id="s-status" role="status" aria-live="polite">${esc(pending?.status || '')}</div>
    </div></div>
    <div id="s-out"></div>${rows.length ? swimmerPanelHtml(rows) : ''}`;

  el.querySelector('#to-patients')?.addEventListener('click', () => ctx.go('patients'));
  wireExclusionPreview(el, { id: 'survival-exclusions', onPage: n => { exclusionPage = n; }, ctx });
  if (saved) showResult(el, saved);
  if (rows.length) drawSwimmer(el, rows, levels, people);
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
      update(st => { st.survival = r; return st; });
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

// ---- the result ----------------------------------------------------------------------------
function showResult(el, r) {
  const out = el.querySelector('#s-out'); if (!out) return;
  const e = r.ext, km = e.km, byName = new Map(km.by.map(g => [g.group, g]));
  const rev = new Map((e.reverse?.by || []).map(g => [g.group, g]));
  const lm = km.landmarks;
  const band = x => `<span class="meta"> ${pct(x.lo)}–${pct(x.hi)}</span>`;
  const surv = (g, t) => { const x = g.survival.find(v => v.time === t); return !x ? '—' : x.collapsed ? pct(x.surv) : pct(x.surv) + band(x); };
  const grp = e.groups.length > 1;
  out.innerHTML = `
    <div class="panel">${uiBar({ kind: 'head', label: 'Freedom from event', id: 'sv-result-head', lead: { title: 'Freedom from event' }, message: { id: 'sv-result-meta', text: `${e.counts.n} patients · ${e.counts.events} events${e.spec.landmarkStart ? ` · landmark ${e.spec.landmarkStart} months` : ''}` },
        actions: [{ id: 'sv-results-csv', label: 'Download results', icon: 'download' }] })}
      <div class="panel-body tight"><table class="sv-table"><thead><tr><th class="grow">${esc(e.groupName || 'Group')}</th><th>n</th><th>Events</th><th>Person-months</th><th>Per 100 person-months</th>
        <th>Median (95% CI)</th><th>Median follow-up</th>${lm.map(t => `<th>${t} mo</th>`).join('')}</tr></thead>
        <tbody>${[...(grp ? km.by : []), km.overall].map(g => { const rv = g === km.overall ? e.reverse?.overall : rev.get(g.group), rate = eventsPer100({ events: g.events, personTime: g.personTime });
          return `<tr><td class="grow">${esc(g.group === 'All' && grp ? 'All patients' : g.group)}</td><td>${g.n}</td><td>${g.events}</td><td>${num(g.personTime, 0)}</td>
            <td>${num(rate?.rate ?? g.per100, 2)}<span class="meta">${rate?.lo != null ? ` ${num(rate.lo, 2)}–${num(rate.hi, 2)}` : ''}</span></td>
            <td>${g.median.est == null ? 'not reached' : `${num(g.median.est)}${ci(g.median.lo, g.median.hi)}`}</td>
            <td>${rv?.median == null ? '—' : `${num(rv.median)}${ci(rv.lo, rv.hi)}`}</td>${lm.map(t => `<td>${surv(g, t)}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
      ${e.followUp ? `<div class="panel-body"><p class="meta" data-ui-help>Observed follow-up: median ${num(e.followUp.median)} months, IQR ${num(e.followUp.q1)} to ${num(e.followUp.q3)}</p></div>` : ''}
      ${km.warnings?.length ? `<div class="panel-body">${km.warnings.map(w => `<div class="note spaced">${esc(w)}</div>`).join('')}</div>` : ''}</div>
    ${e.tests ? testsPanel(e.tests) : ''}
    ${e.rmst ? rmstPanel(e.rmst) : e.stages.rmst ? `<div class="note spaced">Restricted mean survival: ${esc(e.stages.rmst)}</div>` : ''}
    ${e.cox ? coxPanel(e.cox, e) : e.stages.cox ? `<div class="note spaced">Cox regression not estimated: ${esc(e.stages.cox)}</div>` : ''}
    ${figurePanel({ title: 'Kaplan–Meier', id: 'km', extra: `<label class="cr-check"><input type="checkbox" id="km-bands"${showBands.ci ? ' checked' : ''}><span>Confidence bands</span></label>` })}`;
  const km1 = style => kmFigure(km, { xLabel: 'Months', ci: showBands.ci, ...survivalFigureOptions(e.tests, e.spec), style });
  const draw = () => showFigure(el, 'km', km1(figureTokens(null, { medium: 'screen' })), 'kaplan-meier', { exportSvg: () => km1(figureTokens(null, { medium: 'export' })) });
  draw();
  el.querySelector('#km-bands').onchange = ev => { showBands.ci = ev.target.checked; draw(); };
  el.querySelector('#sv-results-csv').onclick = () => downloadCsv(resultsCsv(r), 'time-to-event-results.csv');
}

function testsPanel(t) {
  const row = (name, x) => x ? `<tr><th>${name}</th><td>χ² ${num(x.chisq, 2)} on ${x.df} df, ${pEq(x.p)}</td></tr>` : '';
  return `<div class="panel"><div class="panel-head"><h2>Tests across groups</h2></div><div class="panel-body"><table><tbody>
      ${row(t.stratified ? 'Log-rank (unstratified)' : 'Log-rank', t.logrank)}${row('Gehan–Breslow–Wilcoxon', t.gehanBreslow)}${row('Peto–Peto', t.petoPeto)}${row('Stratified log-rank', t.stratified)}</tbody></table></div>
    ${t.pairwise.length ? `<div class="panel-body tight"><table><thead><tr><th class="grow">Comparison</th><th>${t.pairwiseStratified ? 'Stratified log-rank p' : 'Log-rank p'}</th><th>Holm–Šídák adjusted p</th></tr></thead>
      <tbody>${t.pairwise.map(x => `<tr><td class="grow">${esc(x.a)} vs ${esc(x.b)}</td><td>${pval(x.p)}</td><td>${pval(x.padj)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}

function rmstPanel(m) {
  return `<div class="panel"><div class="panel-head"><h2>Restricted mean survival time</h2><span class="meta">Difference from ${esc(m.reference)} · ${Math.round(m.conf * 100)}% CI · unadjusted</span></div>
    ${m.byTau.map(t => `<div class="panel-body tight"><table><thead><tr><th class="grow">Through ${t.tau} months</th><th>RMST (SE)</th><th>Difference</th><th>p</th></tr></thead>
      <tbody>${t.groups.map(g => `<tr><td class="grow">${esc(g.group)}${g.beyond ? ' <span class="meta">past follow-up</span>' : ''}</td><td>${num(g.rmst, 2)} (${num(g.se, 2)})</td>
        <td>${g.group === m.reference ? '—' : `${num(g.diff.est, 2)}${ci(g.diff.lo, g.diff.hi, 2)}`}</td><td>${g.group === m.reference ? '' : pval(g.diff.p)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>`;
}

/** A Cox model with what decides whether it means anything: events per variable, the proportional-hazards test, and whether the interval is clustered. */
function coxPanel(c, e) {
  const warnings = [];
  if (c.epv != null && c.epv < 10) warnings.push(`${num(c.epv)} events per variable: treat as exploratory`);
  if (c.phGlobalP != null && c.phGlobalP < 0.05) warnings.push(`Proportional hazards rejected (${pEq(c.phGlobalP)}): the hazard ratio does not describe these data`);
  for (const w of c.warnings || []) warnings.push(w);
  const test = (name, x) => x ? `<tr><th>${name}</th><td>χ² ${num(x.chisq, 2)} on ${x.df} df, ${pEq(x.p)}</td></tr>` : '';
  return `<div class="panel"><div class="panel-head"><h2>Cox regression</h2>
      <span class="meta">Reference: ${esc(c.reference)} · Efron ties${e.spec.strata ? ` · baseline hazards stratified by ${esc(e.spec.strata === 'study_id' ? 'source report' : e.spec.strata)}` : ''}${c.cluster ? ` · variance robust to clustering by report (${e.counts.clusters} reports)` : ''}</span></div>
    <div class="panel-body tight"><table><thead><tr><th class="grow">Term</th><th>Hazard ratio</th><th>95% CI</th><th>p</th><th>E-value</th></tr></thead>
      <tbody>${c.terms.map(t => `<tr><td class="grow">${esc(t.term)}</td><td>${num(t.hr, HR_DIGITS)}</td><td>${num(t.lo, HR_DIGITS)} to ${num(t.hi, HR_DIGITS)}</td><td>${pval(t.p)}</td>
        <td>${t.eValue ? `${num(t.eValue.point, 2)}<span class="meta"> limit ${num(t.eValue.ci, 2)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel-body"><table><tbody>${test('Likelihood ratio', c.lr)}${test('Wald', c.wald)}${test('Score', c.score)}${c.robust ? test('Robust', c.robust) : ''}
      <tr><th>Proportional hazards</th><td>${c.phGlobalP == null ? '—' : pEq(c.phGlobalP)}</td></tr>
      <tr><th>Events, events per variable</th><td>${c.events}, ${num(c.epv)}</td></tr></tbody></table>
      ${warnings.map(w => `<div class="note spaced">${esc(w)}</div>`).join('')}</div></div>`;
}

/** The result as rows: the summary, the tests, the restricted means and the hazard ratios, each under its own heading. */
export function resultsCsv(r) {
  const e = r.ext, km = e.km, out = [];
  out.push([e.groupName || 'Group', 'n', 'Events', 'Person-months', 'Per 100 person-months', 'Median', 'Median lower', 'Median upper', 'Median follow-up (reverse KM)', ...km.landmarks.flatMap(t => [`Survival at ${t} months`, 'Lower', 'Upper'])]);
  for (const g of [...(e.groups.length > 1 ? km.by : []), km.overall]) {
    const rv = g === km.overall ? e.reverse?.overall : e.reverse?.by.find(x => x.group === g.group);
    out.push([g.group, g.n, g.events, g.personTime, g.per100 ?? '', g.median.est ?? '', g.median.lo ?? '', g.median.hi ?? '', rv?.median ?? '', ...km.landmarks.flatMap(t => { const x = g.survival.find(v => v.time === t); return x ? [x.surv, x.lo ?? '', x.hi ?? ''] : ['', '', '']; })]);
  }
  if (e.tests) {
    out.push([], ['Test', 'Chi-square', 'df', 'p']);
    for (const [k, n] of [['logrank', 'Log-rank'], ['gehanBreslow', 'Gehan-Breslow-Wilcoxon'], ['petoPeto', 'Peto-Peto'], ['stratified', 'Stratified log-rank']]) if (e.tests[k]) out.push([n, e.tests[k].chisq, e.tests[k].df, e.tests[k].p]);
    out.push([], [e.tests.pairwiseStratified ? 'Comparison (stratified log-rank)' : 'Comparison', 'p', 'Holm-Sidak adjusted p']);
    for (const x of e.tests.pairwise) out.push([`${x.a} vs ${x.b}`, x.p, x.padj]);
  }
  if (e.rmst) for (const t of e.rmst.byTau) {
    out.push([], [`RMST through ${t.tau} months`, 'RMST', 'SE', `Difference from ${e.rmst.reference}`, 'Lower', 'Upper', 'p']);
    for (const g of t.groups) out.push([g.group, g.rmst, g.se, g.group === e.rmst.reference ? '' : g.diff.est, g.diff.lo ?? '', g.diff.hi ?? '', g.diff.p ?? '']);
  }
  if (e.cox) {
    out.push([], [`Cox regression, reference ${e.cox.reference}`, 'Hazard ratio', 'Lower', 'Upper', 'p', 'E-value', 'E-value limit']);
    for (const t of e.cox.terms) out.push([t.term, t.hr, t.lo, t.hi, t.p, t.eValue?.point ?? '', t.eValue?.ci ?? '']);
  }
  return out;
}

// ---- the swimmer plot -----------------------------------------------------------------------
const SWIMMER_MAX = 250;
function swimmerPanelHtml(rows) { return rows.length > SWIMMER_MAX ? '' : figurePanel({ title: 'Swimmer plot', id: 'swim' }); }
function drawSwimmer(el, rows, levels, people) {
  if (rows.length > SWIMMER_MAX || !el.querySelector('#swim')) return;
  const label = new Map(people.map(p => [p.id, p.label || p.id]));
  const pts = rows.map(r => ({ label: label.get(r.id), group: r.group, time: r.time, event: !!r.event })), swim1 = style => swimmerFigure(pts, { groups: levels, xLabel: 'Months', style });
  showFigure(el, 'swim', swim1(figureTokens(null, { medium: 'screen' })), 'swimmer-plot', { exportSvg: () => swim1(figureTokens(null, { medium: 'export' })) });
  const m = el.querySelector('#swim-meta'); if (m) m.textContent = `${rows.length} patients · ${rows.filter(r => r.event).length} events`;
}

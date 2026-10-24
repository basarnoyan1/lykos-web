// Data management in the Datasets view (amendment of 2026-09-29): a column's rules, the edit checks, the issue list and the change log as
// sections of Details, the De-identify page, and the summary a trial log shows above its grid. They replace the dialogs of the same names
// (DIALOGS plan #44-#47). The logic is in lib/data-rules.mjs, lib/trial-logs.mjs, lib/deidentify.mjs and lib/data-management.mjs; these
// only draw and ask. What a person has typed (a column's rules, the checks' text, the page of a list, the De-identify settings) is kept
// here in the module, not in a section's closure: Details is drawn again on every paint.
import { get, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiNotice, inspectorActions } from '../lib/ui-actions.mjs';
import { tableRegion, disclosure, formField, formFit, formCells, uiLink } from '../lib/ui-components.mjs';
import { when as whenText, plural } from '../lib/dates.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { saveFile } from '../lib/save.mjs';
import { settingsOf } from '../lib/app-settings.mjs';
import { changesFor } from '../lib/data-rules.mjs';
import { scanDataset, suggestRecipe } from '../lib/deidentify.mjs';
import { PATIENT_SOURCE, patientDataset } from '../lib/dataset-analysis-core.mjs';
import { setColumnRules, setDatasetRules, datasets, datasetById, addDataset } from '../lib/datasets.mjs';
import { rulesFromForm, formFromRules, parseCheckLines, checksFromText, checksToText, issueIndex, hasChecks, logSummary, SAE_STATUS, DEID_ACTIONS, actionsFromRecipe, recipeFromActions, deidentifiedCopy, freePrefix, keyFileText, describeEntry, rowIndexOf } from '../lib/data-management.mjs';

/** Who is changing the data: the name in Settings. */
export const who = () => String(settingsOf(get()).reviewerName || '').trim();

// What the person has open in Details, per project: a column chosen for its rules (and the rules typed so far), the checks' text, the
// lists' pages and which of them are open. `reveal` is the section to bring into view and focus on the next draw.
const ui = { generation: -1, column: null, rules: null, checks: null, issuesOpen: false, logOpen: false, issuesPage: 1, logPage: 1, logRow: null, reveal: null };
const fresh = () => {
  if (ui.generation === projectGeneration()) return;
  Object.assign(ui, { generation: projectGeneration(), column: null, rules: null, checks: null, issuesOpen: false, logOpen: false, issuesPage: 1, logPage: 1, logRow: null, reveal: null });
  deid = null;
};
const LIST_PAGE = 10;
let deid = null;   // the De-identify page when open: { source, identity, actions, found, settings, made, error, fresh }

/** Chooses a column for its rules: Details shows them as fields. */
export function showColumnRules(datasetId, columnId) { fresh(); ui.column = { dataset: datasetId, id: columnId }; ui.rules = null; ui.reveal = 'rules'; }
/** Brings the edit checks, the issues or the change log (all of it, or the history of one row) into view in Details. */
export function showChecks() { fresh(); ui.reveal = 'checks'; }
export function showIssues() { fresh(); ui.issuesOpen = true; ui.reveal = 'issues'; }
export function showChangeLog(rowId = null) { fresh(); ui.logOpen = true; ui.logRow = rowId; ui.logPage = 1; ui.reveal = 'log'; }

/** Takes the focus to the section just asked for, once. */
function reveal(host, name, target) {
  if (ui.reveal !== name) return;
  ui.reveal = null;
  const el = typeof target === 'string' ? host.querySelector(target) : target;
  el?.focus({ preventScroll: true }); (el?.closest('.insp-sec') || host).scrollIntoView?.({ block: 'nearest' });
}
const errorLine = (id, text) => `<p class="meta dm-error" id="${id}" role="alert">${esc(text || '')}</p>`;

// ---- a column's rules -----------------------------------------------------------------

/** Details: the chosen column's six rules as fields; Save checks them (the numbers and the pattern) and keeps them, Close lets them go. */
export function columnSection(d, ctx) {
  fresh();
  const c = ui.column?.dataset === d.id ? d.columns.find(x => x.id === ui.column.id) : null;
  if (!c) return null;
  if (ui.rules?.dataset !== d.id || ui.rules.column !== c.id) ui.rules = { dataset: d.id, column: c.id, f: formFromRules(c.rules || {}), error: '' };
  const draft = ui.rules, f = draft.f, bounds = c.type === 'number' || c.type === 'integer' || c.type === 'date';
  const input = (k, label, extra = '') => formField(label, `<input data-f="${k}" value="${esc(f[k])}" autocomplete="off"${extra}>`);
  const fields = `<label class="cr-check"><input type="checkbox" data-f="required"${f.required ? ' checked' : ''}><span>Required</span></label>
    ${bounds ? `${input('min', 'Minimum', c.type === 'date' ? ' placeholder="YYYY-MM-DD"' : '')}${input('max', 'Maximum', c.type === 'date' ? ' placeholder="YYYY-MM-DD"' : '')}` : ''}
    ${input('allowed', 'Allowed values', ' placeholder="Comma separated"')}${input('pattern', 'Pattern')}${input('missingCodes', 'Missing codes', ' placeholder="-99, NA"')}${bounds ? input('unit', 'Unit') : ''}`;
  const html = `<div class="an-settings"${formFit(formCells(fields))}>${fields}</div>${errorLine('dm-rules-err', draft.error)}
    ${inspectorActions({ label: 'Column rules', id: 'dm-rules-acts', actions: [{ id: 'dm-rules-close', label: 'Close' }, { id: 'dm-rules-save', label: 'Save rules', role: 'primary' }] })}`;
  return { title: 'Column', meta: c.label, html, wire: host => {
    const err = host.querySelector('#dm-rules-err');
    host.querySelectorAll('[data-f]').forEach(x => {
      const set = () => { f[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value; };
      x.addEventListener('input', set); x.addEventListener('change', set);
      if (x.type !== 'checkbox') x.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); set(); host.querySelector('#dm-rules-save').click(); } });
    });
    host.querySelector('#dm-rules-close').onclick = () => { ui.column = null; ui.rules = null; ctx.rerender(); };
    host.querySelector('#dm-rules-save').onclick = () => {
      const r = rulesFromForm(f, c.type);
      if (r.error) { draft.error = r.error; err.textContent = r.error; return; }
      setColumnRules(d.id, c.id, r.rules); ui.rules = null; ctx.rerender();
    };
    reveal(host, 'rules', 'input:not([type=checkbox])');
  } };
}

// ---- edit checks -------------------------------------------------------------------------

const marked = (text, pos) => pos == null ? esc(text)
  : `${esc(text.slice(0, pos))}<span class="dm-at">${esc(text.slice(pos, pos + 1) || ' ')}</span>${esc(text.slice(pos + 1))}`;
function parseReport(text, columns) {
  const lines = parseCheckLines(text), bad = lines.filter(x => x.error);
  return { bad, count: lines.length, html: `${bad.map(x => `<div class="dm-parse"><span class="meta">Line ${x.line}, at ${x.pos + 1}</span><span class="dm-src">${marked(x.text, x.pos)}</span><span>${esc(x.error)}</span></div>`).join('')}
    <div class="meta dm-wrap">${lines.length} ${lines.length === 1 ? 'check' : 'checks'}${bad.length ? `, ${bad.length} to correct` : ''}; columns: ${columns.slice(0, 12).map(c => esc(c.id)).join(', ')}${columns.length > 12 ? ', …' : ''}</div>` };
}

/** Details: the dataset's edit checks as text, one per line, with what the parser found; Save is for text with nothing to correct. */
export function checksSection(d, ctx) {
  fresh();
  const base = checksToText(d.rules);
  // a draft is the text typed since the checks were last saved; checks changed elsewhere replace a draft nobody has touched
  if (ui.checks?.dataset !== d.id || (ui.checks.text === ui.checks.base && ui.checks.base !== base)) ui.checks = { dataset: d.id, base, text: base };
  const draft = ui.checks, first = parseReport(draft.text, d.columns);
  const html = `<p class="meta dm-help" data-ui-help>One check per line, for example discharge_date >= admission_date, or if sex == 'M' then pregnant is empty.</p>
    <textarea id="dm-checks-text" rows="6" aria-label="Edit checks" spellcheck="false">${esc(draft.text)}</textarea>
    <div id="dm-checks-parse" aria-live="polite">${first.html}</div>
    ${inspectorActions({ label: 'Edit checks', id: 'dm-checks-acts', actions: [{ id: 'dm-checks-save', label: 'Save checks', role: 'primary', disabled: !!first.bad.length }] })}`;
  return { title: 'Checks', meta: first.count ? plural(first.count, 'check') : '', html, wire: host => {
    const ta = host.querySelector('#dm-checks-text'), out = host.querySelector('#dm-checks-parse'), save = host.querySelector('#dm-checks-save');
    ta.oninput = () => { draft.text = ta.value; const r = parseReport(ta.value, d.columns); out.innerHTML = r.html; save.disabled = !!r.bad.length; };
    save.onclick = () => {
      if (parseReport(ta.value, d.columns).bad.length) return;
      setDatasetRules(d.id, checksFromText(ta.value, d.rules)); ui.checks = null; ctx.rerender();
    };
    reveal(host, 'checks', ta);
  } };
}

// ---- issues and the change log: read lists, paged in place -------------------------------------------------

/**
 * A disclosure holding a list of rows with its pager (`rows` are finished uiRow markup; `none` says why there are none). A page step
 * redraws only the list, so the keyboard stays on the pager. The page and the open state are kept in the module (`ui`).
 */
function listSection({ id, title, noun, rows, none, keys: [pageKey, openKey], wireRows, after }) {
  let page = ui[pageKey];
  const inner = () => {
    const v = pageOf(rows, page, LIST_PAGE); page = ui[pageKey] = v.page;
    return `${uiList({ id: `${id}-list`, label: title, rows: v.items })}${pager({ id: `${id}-pager`, page: v.page, pages: v.pages, total: rows.length, label: noun, size: LIST_PAGE })}`;
  };
  const html = disclosure({ id, title, count: rows.length, open: ui[openKey], body: `${after || ''}<div data-dm-list="${id}">${rows.length ? inner() : `<p class="meta">${esc(none)}</p>`}</div>` });
  const wire = host => {
    host.querySelector(`#${id}`)?.addEventListener('toggle', e => { ui[openKey] = e.target.open; });
    const box = host.querySelector(`[data-dm-list="${id}"]`); if (!rows.length) return;
    const bind = () => { wirePager(box, `${id}-pager`, n => { page = ui[pageKey] = n; box.innerHTML = inner(); bind(); }); wireRows?.(box); };
    bind();
  };
  return { html, wire };
}

/** Details: every issue the rules and checks found, paged; choosing one opens its cell on the grid (`jump(row, column)`). */
export function issuesSection(d, ctx, { jump = () => {} } = {}) {
  fresh();
  if (!hasChecks(d)) return null;
  const index = issueIndex(d), colLabel = id => d.columns.find(c => c.id === id)?.label || id || '';
  const rows = [...index.ruleErrors.map(x => uiRow({ main: { html: '<span>Check to correct</span>', detail: [esc(x.message), `<span class="dm-src">${marked(x.value, x.pos)}</span>`], wrap: true } })),
    ...index.list.map(x => uiRow({ main: { html: uiLink({ label: `Row ${x.row + 1}, ${colLabel(x.column) || 'Row'}`, title: x.column ? 'Open this cell' : 'Open this row', attrs: { 'data-dm-jump': `${x.row}:${x.column || ''}` } }),
      detail: [`${esc(x.message)}${x.severity === 'info' ? ' (information)' : ''}`, x.value === '' || x.value == null || String(x.message).includes(String(x.value)) ? '' : esc(x.value)], wrap: true } }))];
  const sec = listSection({ id: 'dm-issues', title: 'Issues', noun: 'issues', rows, none: 'No issues', keys: ['issuesPage', 'issuesOpen'],
    wireRows: box => box.querySelectorAll('[data-dm-jump]').forEach(b => b.onclick = () => { const [r, ...c] = b.dataset.dmJump.split(':'); jump(Number(r), c.join(':')); }) });
  return { html: sec.html, wire: host => { sec.wire(host); reveal(host, 'issues', '#dm-issues summary'); } };
}

/** Details: the dataset's change log, newest first, or one row's history; paged. */
export function changeLogSection(d, ctx) {
  fresh();
  if (ui.logRow != null && rowIndexOf(d, ui.logRow) < 0) ui.logRow = null;
  const rowId = ui.logRow, entries = changesFor(get(), d.id, rowId).slice().reverse();
  const rows = entries.map(e => { const i = rowIndexOf(d, e.row);
    return uiRow({ main: { html: esc(describeEntry(e, d.columns)), detail: [esc(whenText(e.at)), esc(e.by || ''), e.row == null ? '' : `Row ${i >= 0 ? i + 1 : esc(String(e.row))}`, esc(e.reason || '')], wrap: true } }); });
  const sec = listSection({ id: 'dm-log', title: rowId == null ? 'Change log' : `History of row ${rowIndexOf(d, rowId) + 1}`, noun: 'changes', rows, none: 'No changes recorded', keys: ['logPage', 'logOpen'],
    after: rowId == null ? '' : `<p class="meta">${uiLink({ label: 'Show every change', attrs: { 'data-dm-log-all': true } })}</p>` });
  return { html: sec.html, wire: host => {
    sec.wire(host);
    host.querySelector('[data-dm-log-all]')?.addEventListener('click', () => { ui.logRow = null; ui.logPage = 1; ctx.rerender(); });
    reveal(host, 'log', '#dm-log summary');
  } };
}

/** The sections of Details for an open dataset, in order: the chosen column's rules, the edit checks, the issues, the change log. */
export function manageSections(d, ctx, opts = {}) {
  return [columnSection(d, ctx), checksSection(d, ctx), issuesSection(d, ctx, opts), changeLogSection(d, ctx)].filter(Boolean);
}

// ---- a trial log's summary --------------------------------------------------------------------------------

function flowHtml(f) {
  const arms = Object.keys(f.allocated);
  const box = (label, n, extra = '') => `<div class="dm-box"><span>${esc(label)}</span><b>${n ?? '—'}</b>${extra}</div>`;
  const reasons = Object.entries(f.excluded.reasons).filter(([, n]) => n).map(([k, n]) => `<span class="meta">${esc(k)} ${n}</span>`).join('');
  return `<div class="dm-flow" aria-label="CONSORT flow">
    <div class="dm-flow-pair">${box('Assessed for eligibility', f.assessed)}${box('Excluded', f.excluded.total, reasons)}</div>
    <div class="dm-flow-pair">${box('Randomised', f.randomised)}</div>
    ${arms.length ? `<div class="dm-flow-arms" style="--arms:${arms.length}">${arms.map(a => `<div class="dm-flow-col">
      ${box(`Allocated to ${a}`, f.allocated[a])}${box('Lost to follow-up', f.lost[a])}${box('Withdrawn', f.withdrawn[a])}${box('Analysed', f.analysed ? f.analysed[a] : null)}</div>`).join('')}</div>` : ''}
  </div>`;
}

/** What a log shows above its grid; '' for a dataset that is not a log. */
export function logSummaryHtml(d) {
  const s = logSummary(d);
  if (!s) return '';
  const table = t => `<div class="dm-sum-table"><div class="meta">${esc(t.title)}</div>${tableRegion({ label: t.title, html: `<table><thead><tr>${t.head.map((h, i) => `<th${typeof t.rows[0]?.[i] === 'number' ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(v => `<td${typeof v === 'number' ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}</div>`;
  const sae = s.sae?.length ? `<div class="dm-sum-table"><div class="meta">SAE reporting clock, 24 hours</div>${tableRegion({ label: 'SAE reporting clock', html: `<table><thead><tr><th class="num">Row</th><th>Participant</th><th>Event</th><th>Due by</th><th>Reported</th><th>Status</th></tr></thead><tbody>${s.sae.slice(0, 10).map(x =>
    `<tr><td class="num">${x.row + 1}</td><td>${esc(x.participant)}</td><td>${esc(x.term)}</td><td>${esc(x.dueBy || '—')}</td><td>${esc(x.reportedAt || '—')}</td><td${x.status === 'overdue' ? ' class="dm-strong"' : ''}>${esc(SAE_STATUS[x.status])}</td></tr>`).join('')}</tbody></table>` })}${s.sae.length > 10 ? `<div class="meta">${s.sae.length - 10} more serious events</div>` : ''}</div>` : '';
  return `<section class="dm-summary" aria-label="Log summary">
    <div class="dm-facts">${s.facts.map(([k, v]) => `<div><span class="meta">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${s.tables.length || sae ? `<div class="dm-sum-tables">${s.tables.map(table).join('')}${sae}</div>` : ''}
    ${s.flow ? flowHtml(s.flow) : ''}
    ${s.note ? `<div class="meta">${esc(s.note)}</div>` : ''}
  </section>`;
}


// ---- de-identification -----------------------------------------------------------------------------------

const sourceOf = id => id === PATIENT_SOURCE ? patientDataset() : datasetById(id);
const levelPick = level => `<select data-s="level" aria-label="Generalise dates to"><option value="year"${level === 'year' ? ' selected' : ''}>Year</option><option value="month"${level === 'month' ? ' selected' : ''}>Month</option></select>`;
const actionPick = (c, actions) => `<select class="dm-act" data-act="${esc(c.id)}" aria-label="Action for ${esc(c.label)}">${DEID_ACTIONS.map(([k, l]) => `<option value="${k}"${actions[c.id] === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
/** One column of the de-identification scan: its name, the action chosen for it, and what the scan found in it. */
const scanRow = (c, actions, found) => `<tr><td>${esc(c.label)}</td><td>${actionPick(c, actions)}</td>
  <td>${(found.get(c.id) || []).map(x => esc(`${x.label}${x.basis === 'values' || x.basis === 'name+values' ? ` (${Math.round((x.share ?? 1) * 100)}% of values)` : ' (name)'}`)).join('; ') || '<span class="meta">—</span>'}</td></tr>`;

/**
 * Opens the De-identify page for a dataset (an id, or the patient table, PATIENT_SOURCE): the scan reviewed, the recipe changeable, then a
 * new derived dataset made from it. The key is offered only as a download; it is never kept in the project.
 */
export function startDeidentify(source) {
  fresh();
  const d = sourceOf(source); if (!d) return false;
  const scan = scanDataset(d), actions = actionsFromRecipe(suggestRecipe(d, scan), d.columns), pseudoCol = Object.keys(actions).find(k => actions[k] === 'pseudonymise');
  deid = { source, identity: projectGeneration(), actions, found: new Map(scan.map(s => [s.column, s.categories])), made: null, error: '', fresh: true,
    settings: { seed: String(Math.floor(Math.random() * 900000) + 100000), days: 180, level: 'year', ageCap: 89, zipDigits: 3, prefix: pseudoCol ? freePrefix(d, pseudoCol) : 'P' } };
  return true;
}
/** Is the page open? A page whose dataset has gone, or from another project, closes. */
export function deidentifyOpen() {
  if (deid && (deid.identity !== projectGeneration() || !sourceOf(deid.source))) deid = null;
  return !!deid;
}
export const closeDeidentify = () => { deid = null; };
/** The title bar of the page: Back to Datasets and its name. */
export const deidentifyPageSpec = (run = {}) => ({ title: 'De-identify', back: { label: 'Back to Datasets', run: run.back || (() => {}) }, actions: [], overflow: [] });

/** Draws the page into `el`. `onOpen(id)` shows the new dataset on Datasets; `done()` leaves the page; `ctx.rerender` redraws it. */
export function renderDeidentify(el, ctx, { onOpen = () => {} } = {}) {
  if (!deidentifyOpen()) return false;
  const d = sourceOf(deid.source), { actions, settings, found } = deid;
  const field = formField;
  const num = (k, label, extra = '') => field(label, `<input data-s="${k}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(settings[k])}"${extra}>`);
  const text = (k, label) => field(label, `<input data-s="${k}" value="${esc(settings[k])}" autocomplete="off">`);
  const review = () => {
    const fields = `${text('seed', 'Seed')}${num('days', 'Shift dates up to, days')}${field('Generalise dates to', levelPick(settings.level))}${num('ageCap', 'Cap ages above')}${num('zipDigits', 'ZIP digits kept', ' maxlength="1"')}${text('prefix', 'Pseudonym prefix')}`;
    return `<p class="meta dm-help" data-ui-help>The scan flags likely identifiers from names and values. It is a prompt to look; free text and rare combinations are not assessed.</p>
      <p class="meta">${esc(d.name)}, ${plural(d.rows.length, 'row')}, ${plural(d.columns.length, 'column')}</p>
      ${tableRegion({ label: 'Columns and their actions', html: `<table><thead><tr><th>Column</th><th>Action</th><th>Found</th></tr></thead><tbody>${d.columns.map(c => scanRow(c, actions, found)).join('')}</tbody></table>` })}
      <div class="an-settings"${formFit(formCells(fields))}>${fields}</div>
      ${errorLine('dm-deid-err', deid.error)}
      ${uiBar({ kind: 'foot', label: 'De-identify', id: 'dm-deid-foot', actions: [{ id: 'dm-deid-cancel', label: 'Cancel', keep: true }, { id: 'dm-deid-make', label: 'Create de-identified copy', role: 'primary', type: 'submit' }] })}`;
  };
  const report = () => {
    const r = deid.made, rp = r.report, colLabel = id => d.columns.find(c => c.id === id)?.label || id;
    const line = (k, v) => v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : '';
    const keyed = Object.keys(r.key.pseudonyms).length || Object.keys(r.key.shifts).length;
    return `${tableRegion({ label: 'What was changed', html: `<table class="ask-table"><tbody>
        ${line('New dataset', r.dataset.name)}
        ${line('Dropped', rp.dropped.map(colLabel).join(', '))}
        ${line('Pseudonymised', rp.pseudonymised && `${colLabel(rp.pseudonymised.column)}, ${rp.pseudonymised.values} values`)}
        ${line('Dates shifted', rp.shifted && `${rp.shifted.columns.map(colLabel).join(', ')}: ${rp.shifted.cells} cells, ±${rp.shifted.range[1]} days by ${rp.shifted.by === 'row' ? 'row' : colLabel(rp.shifted.by)}`)}
        ${line('Dates generalised', rp.generalised && `${rp.generalised.columns.map(colLabel).join(', ')} to ${rp.generalised.level}`)}
        ${line('Ages capped', rp.capped && `${rp.capped.columns.map(colLabel).join(', ')}: ${rp.capped.cells} above ${rp.capped.cap}`)}
        ${line('ZIP truncated', rp.truncated && `${rp.truncated.columns.map(colLabel).join(', ')} to ${rp.truncated.digits} digits`)}
        ${line('Still flagged', rp.remaining.length ? rp.remaining.map(s => `${s.label}: ${s.categories.map(c => c.label).join(', ')}`).join('; ') : 'Nothing the scan recognises')}
        ${rp.notes.map(n => line('Note', n)).join('')}
      </tbody></table>` })}
      ${keyed ? uiNotice({ id: 'dm-key-note', label: 'Re-identification key', text: 'The key re-identifies the copy. It is not saved in the project: download it and store it apart from the data.' }) : ''}
      ${uiBar({ kind: 'foot', label: 'De-identified copy', id: 'dm-deid-foot', ...(keyed ? { start: [{ id: 'dm-deid-key', label: 'Download key', icon: 'download' }] } : {}), actions: [{ id: 'dm-deid-open', label: 'Open copy', role: 'primary', type: 'submit' }] })}`;
  };
  el.innerHTML = `<form class="dm-deid" aria-label="De-identify ${esc(d.name)}" novalidate>${deid.made ? report() : review()}</form>`;
  const form = el.querySelector('form');
  form.querySelectorAll('[data-act]').forEach(s => s.onchange = () => { actions[s.dataset.act] = s.value; });
  form.querySelectorAll('[data-s]').forEach(x => { x.oninput = x.onchange = () => { settings[x.dataset.s] = x.value; }; });
  form.querySelector('#dm-deid-cancel')?.addEventListener('click', () => { deid = null; ctx.rerender(); });
  form.querySelector('#dm-deid-key')?.addEventListener('click', () => { const r = deid.made; saveFile(new Blob([keyFileText(r.key, { dataset: r.dataset.name })], { type: 'application/json' }), `${d.name.replace(/[^\w.-]+/g, '_')}-deid-key.json`, 'application/json'); });
  form.onsubmit = e => {
    e.preventDefault();
    if (deid.made) { const id = deid.made.dataset.id; deid = null; onOpen(id); return; }
    const { recipe, error } = recipeFromActions(actions, settings);
    const fail = text => { deid.error = text; const line = form.querySelector('#dm-deid-err'); if (line) line.textContent = text; };
    if (error) { fail(error); return; }
    if (!String(settings.seed).trim()) { fail('A seed is needed'); return; }
    deid.made = deidentifiedCopy(d, recipe, String(settings.seed).trim(), datasets().map(x => x.id));
    deid.error = '';
    addDataset(deid.made.dataset);
    ctx.rerender();
  };
  if (deid.fresh) { deid.fresh = false; form.querySelector('select')?.focus({ preventScroll: true }); }
  else if (deid.made) form.querySelector('#dm-deid-open')?.focus({ preventScroll: true });
  return true;
}

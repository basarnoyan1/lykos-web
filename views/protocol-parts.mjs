import { PROSPERO_URL, PROSPERO_CHECKS, prosperoPreparation, prosperoPreparationNote } from '../lib/prospero-preparation.mjs';
import { copyText } from '../lib/clipboard.mjs';
import { showNote } from './notes.mjs';
// The protocol's registration, ethics and governance, and SPIRIT schedule
// parts, drawn as Settings sections beside the question and criteria
// (views/protocol.mjs hands these parts here). Plan §A5 and the amendment
// "Protocol, registration and governance, 2026-09-29".
//
// Registration is a human act on the registry's site: this lays out the
// registry's fields, fills what the project knows, and lists what is left.
// Governance drafts documents from the project with [bracketed] gaps; nothing
// here is legal advice. Every value is stored through lib/protocol-governance.mjs.
import { get, update } from '../store.mjs';
import { esc, autoGrow, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { saveFile } from '../lib/save.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { dateField, wireDateField } from '../lib/date-picker.mjs';
import { figurePanel, showFigure, download } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ensureLinked, nameAt, linkPlace, linkChoices } from '../lib/outcome-links.mjs';
import { addTodo } from '../lib/actions.mjs';
import { researchType } from '../lib/workflow.mjs';
import { isPrimaryType } from '../lib/research-types.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiSettingsRow, uiNotice } from '../lib/ui-actions.mjs';
import { disclosure, tableRegion, uiLink } from '../lib/ui-components.mjs';
import { formFor, formById, toComplete, toMarkdown, toBlocks as registrationBlocks, registrationDates, registryOf, REGISTERED_REPORT_STAGES } from '../lib/registration.mjs';
import { normalizeEthics, validateEthics, deadlines, protocolSynopsis, consentDocument, readability, DMP_TEMPLATES, dataManagementPlan, statisticalAnalysisPlan, executedAnalyses, sapDeviations } from '../lib/governance.mjs';
import { SECTIONS as SPIRIT_SECTIONS, validateSchedule, toCsv, toBlocks as scheduleBlocks, scheduleSvg } from '../lib/spirit-schedule.mjs';
import {
  normalizeRegistration, registrationForm, registrationValues, setRegistrationValue, setRegistrationDate, fieldGroups, sourceLabel,
  deadlineTodos, sapOnGenerate, addSapRow, updateSapRow, removeSapRow, plannedFor, scheduleOf, applyScheduleOp, appendToManuscript,
} from '../lib/protocol-governance.mjs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const saveDocx = async (blocks, name) => saveFile(await writeDocx({ blocks, section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] }), name, DOCX);
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';

async function copyWithNote(text, note) {
  const ok = await copyText(text);
  if (note) note.textContent = ok ? 'Copied' : 'Could not copy';
}

export const PARTS = new Set(['registration', 'ethics', 'spirit']);

/** Draws one part into `el`; each part redraws only itself after an edit. */
export function renderPart(el, ctx, part) {
  if (part === 'registration') return renderRegistration(el, ctx);
  if (part === 'ethics') return renderEthics(el, ctx);
  if (part === 'spirit') return renderSpirit(el, ctx);
}

/**
 * A section's head bar. Settings already names the section, so a part is drawn without a title (a status or message, then its
 * actions); a page that stands alone passes `title`. A head with nothing to say is not drawn.
 */
export function sectionHead({ id, title = '', label = '', message, status, actions = [], overflow }) {
  if (!title && !message && !status && !actions.length && !overflow) return '';
  return uiBar({ kind: 'head', label: label || title || 'Section', id, ...(title ? { lead: { title, level: 'h2' } } : {}),
    ...(message ? { message } : {}), ...(status ? { status } : {}), actions, ...(overflow ? { overflow } : {}) });
}

/** A button that opens a menu, and the same menu as a submenu when the bar folded it into More (the engine sends ui-pick). */
const menuOn = (button, entries, onPick = () => {}) => {
  if (!button) return;
  button.onclick = () => showMenu(button, entries(), { align: 'end' });
  button.addEventListener('ui-pick', e => onPick(e.detail.value));
};

const page = (part, head, body) => `<div class="protocol-page protocol-part gov-part" data-part="${part}"><div class="panel">
  ${head}<div class="panel-body">${body}</div></div></div>`;
/** A heading inside a part; with actions it is a head bar (the actions are the section's own). */
const sub = (title, actions = [], { id, status } = {}) => `<div class="gov-sub">${actions.length || status
  ? uiBar({ kind: 'head', label: title, id: id || `gov-${slug(title)}`, lead: { title, level: 'h3' }, ...(status ? { status } : {}), actions })
  : `<h3>${esc(title)}</h3>`}</div>`;

// ---- registration -----------------------------------------------------------------------------------------------------

function renderRegistration(el, ctx) {
  const s = get();
  const forms = formFor(s.project?.researchType);
  const formId = registrationForm(s);
  const form = formById(formId);
  const reg = normalizeRegistration(s.registration);
  const values = form ? registrationValues(s, formId) : {};
  const choice = forms.find(f => f.id === formId);
  const todo = form ? toComplete(formId, values) : [];
  const regId = s.paper?.registration || '';
  const prep = formId === 'prospero' ? prosperoPreparation(s) : null;
  // enrolment and completion dates belong to studies that enrol participants, not to reviews
  const primary = isPrimaryType(researchType(s).id);
  const datesOf = (d, id) => registrationDates({ ...(primary ? d : { registeredAt: d.registeredAt }), id });
  const dates = datesOf(reg.dates, regId);
  const noteText = primary || !reg.dates.registeredAt ? dates.note : '';

  const labelOf = f => `${f.n ? `${f.n}. ` : ''}${f.label}${f.prismaP ? ` (PRISMA-P ${f.prismaP})` : ''}`;
  // What a value came from, and what can be done with it: use the project's value again, or copy it.
  const sourceHtml = (f, v) => v ? [v.from === 'edited' ? 'Edited' : `From ${esc(sourceLabel(v.from))}`,
    v.from === 'edited' && v.derived ? uiLink({ label: 'Use project value', attrs: { 'data-reg-reset': f.id, 'aria-label': `Use the project value for ${labelOf(f)}` } }) : '',
    v.value ? uiLink({ label: 'Copy', attrs: { 'data-reg-copy': f.id, 'aria-label': `Copy ${labelOf(f)}` } }) : ''].filter(Boolean).join(', ') : '';
  const fieldRow = f => {
    const v = values[f.id] || null;
    const label = labelOf(f);
    const control = f.byRegistry
      ? `<div class="gov-value">${esc(v?.value || 'Assigned by the registry')}</div>`
      : `<textarea id="reg-f-${esc(f.id)}" class="autogrow" data-reg-field="${esc(f.id)}" rows="2" placeholder="${esc(f.hint || '')}" aria-label="${esc(label)}">${esc(v?.value || '')}</textarea>`;
    return `<div class="gov-field" data-field="${esc(f.id)}">
      <label class="gov-label" for="reg-f-${esc(f.id)}">${esc(label)}${f.required ? '' : '<span class="meta">Optional</span>'}${f.atRegistration === false ? '<span class="meta">Later</span>' : ''}</label>
      <div class="gov-control">${control}<div class="gov-src meta" data-reg-src="${esc(f.id)}">${sourceHtml(f, v)}</div></div></div>`;
  };
  const todoList = list => list.length
    ? `<ul class="gov-todo">${list.map(x => `<li>${uiLink({ label: x.label, attrs: { 'data-reg-goto': x.id } })}</li>`).join('')}</ul>`
    : `<div class="ov-clear">${icon('check', { size: 16 })}<span>Every required field has a value</span></div>`;
  const prepHtml = () => !prep ? '' : disclosure({ id: 'reg-prep', title: 'Preparation checklist', count: `${prep.completed} of ${PROSPERO_CHECKS.length}`, className: 'prospero-prep', body: `
      <p data-ui-help>Nothing is submitted from here. <a href="${PROSPERO_URL}" target="_blank" rel="noopener noreferrer">Open PROSPERO</a> to register; its fields have changed since these were written.</p>
      <div class="prospero-checks">${PROSPERO_CHECKS.map(([id, label]) => `<label><input type="checkbox" data-prospero-check="${id}"${prep.checked[id] === true ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>
      ${uiBar({ kind: 'foot', label: 'Preparation', id: 'reg-prep-foot', actions: [{ id: 'reg-prep-note', label: 'Create preparation note', icon: 'note' }] })}` });
  const stageOption = x => `<option value="${esc(x.id)}"${(s.paper?.registeredReport || '') === x.id ? ' selected' : ''}>${esc(x.label)}</option>`;
  const reportField = `<label class="field"><span>Registered Report</span><select id="reg-rr">${REGISTERED_REPORT_STAGES.map(stageOption).join('')}</select></label>`;
  // the sentence and the deadline are rows with one More each; the sentence is copied from its More
  const sentenceRows = [
    noteText ? uiRow({ main: { html: esc(noteText) } }) : '',
    dates.resultsDue ? uiRow({ main: { html: `Results due ${esc(dates.resultsDue.date)}`, detail: [esc(dates.resultsDue.label)] }, end: uiRowEnd({ more: { label: 'More for the results deadline', attrs: { 'data-reg-due-more': '' } } }) }) : '',
    uiRow({ id: 'reg-sentence-row', main: { html: `<span id="reg-sentence">${esc(dates.sentence)}</span>`, wrap: true }, end: uiRowEnd({ more: { label: 'More for the registration sentence', attrs: { 'data-reg-sentence-more': '' } } }) })].filter(Boolean);

  el.innerHTML = page('registration', sectionHead({ id: 'reg-head', label: 'Registration', message: { id: 'reg-note', text: '' }, actions: [
      ...(forms.length > 1 ? [{ picker: true, id: 'reg-form', label: 'Registration form', icon: 'book', value: choice?.label || '', options: forms.map(f => [f.id, f.label]) }] : []),
      ...(form ? [{ id: 'reg-export', label: 'Export', icon: 'export', menu: true }] : [])] }),
    `${choice?.hint ? `<p class="gov-help" data-ui-help>${esc(choice.hint.text)}</p>` : ''}
    ${prepHtml()}
    <label class="field"><span>Registry ID</span><input id="reg-id" value="${esc(regId)}" placeholder="NCT…, ISRCTN…, CRD…" autocomplete="off"></label>
    <div class="gov-src gov-indent meta" id="reg-registry">${esc(registryOf(regId))}</div>
    ${form?.registeredReport ? reportField : ''}
    ${sub('Dates')}
    <label class="field"><span>Registered</span>${dateField('reg-d-registeredAt', reg.dates.registeredAt, 'Date of registration')}</label>
    ${primary ? `<label class="field"><span>First enrolment</span>${dateField('reg-d-firstEnrolmentAt', reg.dates.firstEnrolmentAt, 'Date of first enrolment')}</label>
    <label class="field"><span>Primary completion</span>${dateField('reg-d-primaryCompletionAt', reg.dates.primaryCompletionAt, 'Primary completion date')}</label>` : ''}
    ${uiList({ id: 'reg-lines', label: 'Registration dates', cls: 'gov-lines', rows: sentenceRows, empty: '' })}
    ${form ? `${disclosure({ id: 'reg-missing', title: 'Fields to complete', count: String(todo.length), className: 'registration-missing', body: `<div id="reg-todo">${todoList(todo)}</div>` })}
      ${fieldGroups(formId).map(g => `${sub(g.group)}${g.fields.map(fieldRow).join('')}`).join('')}
      <p class="meta gov-published" data-ui-help>Fields as published by ${esc(form.source.name)}; not checked against the live form.</p>` : emptyState({ title: `No registration form for ${researchType(s).label.toLowerCase()}`, size: 'inline' })}`);

  const note = el.querySelector('#reg-note');
  const grows = [...el.querySelectorAll('textarea.autogrow')].map(t => autoGrow(t));
  el.querySelectorAll('[data-prospero-check]').forEach(input => input.onchange = () => {
    update(st => { st.registration = normalizeRegistration(st.registration); st.registration.prosperoChecks = { ...st.registration.prosperoChecks, [input.dataset.prosperoCheck]: input.checked }; return st; });
    el.querySelector('#reg-prep .ui-disclosure-count').textContent = `${prosperoPreparation(get()).completed} of ${PROSPERO_CHECKS.length}`;
  });
  el.querySelector('#reg-prep-note')?.addEventListener('click', () => {
    const now = new Date().toISOString(), id = `prospero-${Date.now().toString(36)}`;
    update(st => { st.projectNotes = [...(st.projectNotes || []), { id, title: 'PROSPERO preparation', text: prosperoPreparationNote(st), at: now, updated: now }]; return st; });
    showNote(id); ctx.go('notes');
  });
  const redraw = () => { grows.forEach(g => g.release()); renderRegistration(el, ctx); };
  const saveReg = fn => update(st => { st.registration = fn(st.registration); return st; });
  const pickForm = id => { saveReg(r => ({ ...normalizeRegistration(r), form: id })); redraw(); el.querySelector('#reg-form')?.focus(); };
  menuOn(el.querySelector('#reg-form'), () => forms.map(f => ({ label: f.label, checked: f.id === formId, run: () => pickForm(f.id) })), pickForm);
  el.querySelector('#reg-id').oninput = e => update(st => { st.paper = { ...(st.paper || {}), registration: e.target.value }; return st; });
  // the registry's name and the methods sentence follow the ID as it is typed
  el.querySelector('#reg-id').addEventListener('input', () => {
    const id = get().paper?.registration || '';
    el.querySelector('#reg-registry').textContent = registryOf(id);
    el.querySelector('#reg-sentence').textContent = datesOf(normalizeRegistration(get().registration).dates, id).sentence;
  });
  el.querySelector('#reg-rr')?.addEventListener('change', e => { update(st => { st.paper = { ...(st.paper || {}), registeredReport: e.target.value }; return st; }); redraw(); });
  for (const k of primary ? ['registeredAt', 'firstEnrolmentAt', 'primaryCompletionAt'] : ['registeredAt']) {
    wireDateField(el, `reg-d-${k}`, k);
    el.querySelector(`#reg-d-${k}`).onchange = e => { saveReg(r => setRegistrationDate(r, k, e.target.value)); redraw(); };
  }
  const dueButton = el.querySelector('[data-reg-due-more]');
  if (dueButton) dueButton.onclick = () => showMenu(dueButton, [{ label: 'Add results deadline to to-do', icon: 'plus', run: () => {
    const d = datesOf(normalizeRegistration(get().registration).dates, get().paper?.registration || '');
    const where = registryOf(get().paper?.registration || '') || form?.registry || 'the registry';
    addTodo(`Post summary results to ${where}`, d.resultsDue.date); note.textContent = 'Added to to-do'; ctx.refreshCounts?.();
  } }], { align: 'end' });
  const sentenceButton = el.querySelector('[data-reg-sentence-more]');
  sentenceButton.onclick = () => showMenu(sentenceButton, [{ label: 'Copy sentence', icon: 'copy', run: () => copyWithNote(el.querySelector('#reg-sentence').textContent, note) }], { align: 'end' });
  if (!form) return;
  const exportButton = el.querySelector('#reg-export');
  const doExport = kind => kind === 'md' ? saveFile(toMarkdown(formId, registrationValues(get(), formId)), `${formId}-registration-draft.md`, 'text/markdown')
    : saveDocx(registrationBlocks(formId, registrationValues(get(), formId)), `${formId}-registration-draft.docx`);
  menuOn(exportButton, () => [{ label: 'Markdown', icon: 'download', run: () => doExport('md') }, { label: 'Word', icon: 'download', run: () => doExport('docx') }], doExport);
  const refreshTodo = () => {
    const list = toComplete(formId, registrationValues(get(), formId));
    el.querySelector('#reg-todo').innerHTML = todoList(list);
    el.querySelector('#reg-missing .ui-disclosure-count').textContent = String(list.length);
    wireGoto();
  };
  const wireGoto = () => el.querySelectorAll('[data-reg-goto]').forEach(b => b.onclick = () => el.querySelector(`#reg-f-${CSS.escape(b.dataset.regGoto)}`)?.focus());
  wireGoto();
  const wireSource = id => {
    const holder = el.querySelector(`[data-reg-src="${CSS.escape(id)}"]`);
    holder.querySelector('[data-reg-reset]')?.addEventListener('click', () => { saveReg(r => setRegistrationValue(r, formId, id, '')); redraw(); });
    holder.querySelector('[data-reg-copy]')?.addEventListener('click', () => copyWithNote(registrationValues(get(), formId)[id]?.value || '', note));
  };
  const fieldOf = id => fieldGroups(formId).flatMap(g => g.fields).find(f => f.id === id);
  el.querySelectorAll('[data-reg-field]').forEach(t => {
    const id = t.dataset.regField;
    wireSource(id);
    t.oninput = () => {
      saveReg(r => setRegistrationValue(r, formId, id, t.value));
      el.querySelector(`[data-reg-src="${CSS.escape(id)}"]`).innerHTML = sourceHtml(fieldOf(id), registrationValues(get(), formId)[id]);
      wireSource(id);
    };
    t.onchange = refreshTodo;
  });
}

// ---- ethics and governance --------------------------------------------------------------------------------------------------

let consentKind = 'adult', consentStyle = 'who', consentLang = 'en', dmpTemplate = 'generic';
const CONSENT_KINDS = [['adult', 'Adult participant'], ['parent', 'Parent or guardian'], ['assent', 'Child assent']];
const CONSENT_STYLES = [['who', 'WHO sections'], ['plain', 'Plain questions']];
const LANGS = [['en', 'English (Flesch)'], ['tr', 'Turkish (Ateşman)']];
const STATUS = { 'as planned': 'As planned', changed: 'Changed', 'not done': 'Not done', 'not planned': 'Not planned' };
const labelIn = (list, value) => list.find(([v]) => v === value)?.[1] ?? '';
const consentText = s => consentDocument({ state: s, kind: consentKind, style: consentStyle }).filter(b => b.type === 'p').map(b => b.text).join('\n');

const issueHtml = (list, key) => list.filter(x => x.key === key).map(x => `<div class="gov-issue" data-level="${x.level}">${x.level === 'error' ? icon('warn', { size: 14 }) : ''}<span>${esc(x.text)}</span></div>`).join('');
const dueHtml = due => due.length
  ? uiList({ id: 'eth-due-list', label: 'Deadlines', cols: ['due'], cls: 'gov-rows', rows: due.map((d, i) => uiRow({ attrs: { 'data-due': i },
    main: { html: `${d.overdue ? '<span class="gov-strong">Overdue</span>: ' : ''}${esc(d.text)}`, detail: [d.hint ? esc(d.hint) : ''], wrap: true },
    cells: [{ col: 'due', kind: 'text', ch: 14, html: esc(d.due || 'No date') }] })) })
  : emptyState({ title: 'Nothing due within 90 days', size: 'inline' });

// A row still blank is not yet a planned analysis.
const deviations = s => sapDeviations(plannedFor(s).filter(a => String(a.outcome || '').trim() || String(a.method || '').trim()), executedAnalyses(s));
const strong = d => d.status === 'as planned' ? '' : ' class="gov-strong"';

function renderEthics(el, ctx) {
  ensureLinked(get, update);   // the plan's rows name the review's outcomes by id (lib/outcome-links.mjs)
  const s = get();
  const e = normalizeEthics(s.ethics || {});
  const issues = s.ethics ? validateEthics(e) : [];
  const issueFor = key => `<div class="gov-issues" data-issues="${esc(key)}">${issueHtml(issues, key)}</div>`;
  const due = s.ethics ? deadlines(e, new Date()) : [];
  const read = readability(consentText(s), { lang: consentLang });
  const planned = plannedFor(s);
  const input = (k, label, ph = '') => `<label class="field"><span>${esc(label)}</span><input id="eth-${k}" data-eth="${k}" value="${esc(e[k])}" placeholder="${esc(ph)}" autocomplete="off"></label>${issueFor(k)}`;
  const date = (k, label) => `<label class="field"><span>${esc(label)}</span>${dateField(`eth-${k}`, e[k], label)}</label>${issueFor(k)}`;
  const amendmentRow = (a, i) => `<tr data-am="${i}"><td>${dateField(`eth-am-at-${i}`, a.at, `Amendment ${i + 1} submitted`)}</td>
        <td><input class="ui-cell-field" data-am-text="${i}" value="${esc(a.text)}" placeholder="What changed" aria-label="${esc(`Amendment ${i + 1}`)}">${issueFor(`amendments.${i}`)}</td>
        <td>${dateField(`eth-am-ok-${i}`, a.approvedAt, `Amendment ${i + 1} approved`)}</td>
        <td>${uiRowEnd({ more: { label: `More for amendment ${i + 1}`, attrs: { 'data-am-more': i } } })}</td></tr>`;
  const readText = read.readingEase == null ? 'No text' : `${read.formula} reading ease ${read.readingEase}, ${read.wordsPerSentence} words per sentence, ${read.words} words`;
  const doc = (id, label, controls, description = '') => uiSettingsRow({ id: `${id}-row`, label, description, controls: { label, id: `${id}-bar`, actions: [...controls, { id, label: 'Word', icon: 'download' }],
    ...(controls.length > 2 ? { budget: { n: controls.length + 1, reason: 'the choices that shape one document, and its export' } } : {}) } });
  const picker = (id, label, list, value, ico) => ({ picker: true, id, label, icon: ico, value: labelIn(list, value), options: list });
  const dmpList = Object.entries(DMP_TEMPLATES).map(([k, t]) => [k, t.label]);

  // The part's note (what a change did) is the Approval heading's status: a head bar of its own was an empty band above the first field.
  el.innerHTML = page('ethics', '', `
    ${sub('Approval', [], { id: 'eth-approval-head', status: { id: 'eth-note', text: '', ch: 24 } })}
    ${input('committee', 'Committee', 'Approving ethics committee')}
    ${input('reference', 'Reference', 'Approval number')}
    ${date('approvedAt', 'Approved')}
    ${date('expiresAt', 'Expires')}
    ${date('annualReportDue', 'Annual report due')}
    <label class="field"><span>Conditions</span><textarea id="eth-conditions" class="autogrow" data-eth="conditions" rows="2" placeholder="Conditions of approval">${esc(e.conditions)}</textarea></label>
    ${sub('Amendments', [{ id: 'eth-am-add', label: 'Add amendment', icon: 'plus' }])}
    ${e.amendments.length ? tableRegion({ label: 'Amendments', html: `<table class="gov-table gov-amendments"><thead><tr><th>Submitted</th><th>Change</th><th>Approved</th><th></th></tr></thead><tbody>
      ${e.amendments.map(amendmentRow).join('')}</tbody></table>` }) : `${emptyState({ title: 'No amendments', size: 'inline' })}`}
    ${sub('Deadlines', [{ id: 'eth-todo', label: 'Add to to-do', icon: 'plus', disabled: !due.length }])}
    <div id="eth-due">${dueHtml(due)}</div>
    ${sub('Documents')}
    <div class="gov-docs">
      ${doc('doc-synopsis', 'Protocol synopsis', [])}
      ${doc('doc-consent', 'Participant information and consent', [picker('doc-consent-kind', 'Who signs', CONSENT_KINDS, consentKind, 'user'), picker('doc-consent-style', 'Section style', CONSENT_STYLES, consentStyle, 'align-left'), picker('doc-lang', 'Readability language', LANGS, consentLang, 'globe')], readText)}
      ${doc('doc-dmp', 'Data management plan', [picker('doc-dmp-tpl', 'Template', dmpList, dmpTemplate, 'file')])}
      ${doc('doc-sap', 'Statistical analysis plan', [])}
    </div>
    ${sub('Planned and done', [{ id: 'sap-add', label: 'Add analysis', icon: 'plus' }])}
    <div id="sap-table">${sapTable(planned, deviations(s))}</div>`);

  const note = el.querySelector('#eth-note');
  const grows = [...el.querySelectorAll('textarea.autogrow')].map(t => autoGrow(t));
  const redraw = () => { grows.forEach(g => g.release()); renderEthics(el, ctx); };
  const saveEth = fn => update(st => { st.ethics = fn(normalizeEthics(st.ethics || {})); return st; });
  // Typing never redraws the part (a redraw on change would swallow the click that caused the blur); what depends on the text is redrawn in place.
  const refreshInline = () => {
    const r = normalizeEthics(get().ethics || {}), list = validateEthics(r);
    el.querySelectorAll('[data-issues]').forEach(h => { h.innerHTML = issueHtml(list, h.dataset.issues); });
    const d = deadlines(r, new Date());
    el.querySelector('#eth-due').innerHTML = dueHtml(d);
    el.querySelector('#eth-todo').disabled = !d.length;
  };
  el.querySelectorAll('[data-eth]').forEach(i => { i.oninput = () => { saveEth(r => ({ ...r, [i.dataset.eth]: i.value })); refreshInline(); }; i.onchange = () => ctx.refreshCounts?.(); });
  for (const k of ['approvedAt', 'expiresAt', 'annualReportDue']) {
    wireDateField(el, `eth-${k}`, k);
    el.querySelector(`#eth-${k}`).onchange = ev => { saveEth(r => ({ ...r, [k]: ev.target.value })); redraw(); ctx.refreshCounts?.(); };
  }
  const saveAm = (i, patch) => saveEth(r => ({ ...r, amendments: r.amendments.map((a, j) => j === i ? { ...a, ...patch } : a) }));
  el.querySelector('#eth-am-add').onclick = () => { saveEth(r => ({ ...r, amendments: [...r.amendments, { at: '', text: '', approvedAt: '' }] })); redraw(); el.querySelector(`[data-am-text="${normalizeEthics(get().ethics).amendments.length - 1}"]`)?.focus(); };
  el.querySelectorAll('[data-am]').forEach(row => {
    const i = Number(row.dataset.am);
    wireDateField(el, `eth-am-at-${i}`, 'Submitted'); wireDateField(el, `eth-am-ok-${i}`, 'Approved');
    el.querySelector(`#eth-am-at-${i}`).onchange = ev => { saveAm(i, { at: ev.target.value }); redraw(); };
    el.querySelector(`#eth-am-ok-${i}`).onchange = ev => { saveAm(i, { approvedAt: ev.target.value }); redraw(); };
    const t = row.querySelector('[data-am-text]'); t.oninput = () => { saveAm(i, { text: t.value }); refreshInline(); };
    const more = row.querySelector('[data-am-more]');
    more.onclick = () => showMenu(more, [{ label: 'Remove amendment', icon: 'trash', run: () => { saveEth(r => ({ ...r, amendments: r.amendments.filter((_, j) => j !== i) })); redraw(); } }], { align: 'end' });
  });
  el.querySelector('#eth-todo').addEventListener('click', () => { for (const t of deadlineTodos(deadlines(normalizeEthics(get().ethics || {}), new Date()))) addTodo(t.text, t.due); note.textContent = 'Added to to-do'; ctx.refreshCounts?.(); });

  const title = () => get().paper?.title || get().protocol?.title || 'study';
  el.querySelector('#doc-synopsis')?.addEventListener('click', () => saveDocx(protocolSynopsis(get()), `protocol-synopsis-${slug(title())}.docx`));
  menuOn(el.querySelector('#doc-consent-kind'), () => CONSENT_KINDS.map(([v, l]) => ({ label: l, checked: v === consentKind, run: () => { consentKind = v; redraw(); } })), v => { consentKind = v; redraw(); });
  menuOn(el.querySelector('#doc-consent-style'), () => CONSENT_STYLES.map(([v, l]) => ({ label: l, checked: v === consentStyle, run: () => { consentStyle = v; redraw(); } })), v => { consentStyle = v; redraw(); });
  menuOn(el.querySelector('#doc-lang'), () => LANGS.map(([v, l]) => ({ label: l, checked: v === consentLang, run: () => { consentLang = v; redraw(); } })), v => { consentLang = v; redraw(); });
  el.querySelector('#doc-consent')?.addEventListener('click', () => saveDocx(consentDocument({ state: get(), kind: consentKind, style: consentStyle }), `consent-${consentKind}-${consentStyle}.docx`));
  menuOn(el.querySelector('#doc-dmp-tpl'), () => dmpList.map(([v, l]) => ({ label: l, checked: v === dmpTemplate, run: () => { dmpTemplate = v; redraw(); } })), v => { dmpTemplate = v; redraw(); });
  el.querySelector('#doc-dmp')?.addEventListener('click', () => saveDocx(dataManagementPlan({ state: get(), template: dmpTemplate }), `data-management-plan-${dmpTemplate}.docx`));
  // Generating the plan keeps its analyses with the project, so what was run is compared with what was planned.
  el.querySelector('#doc-sap')?.addEventListener('click', async () => {
    update(st => { st.sap = sapOnGenerate(st); return st; });
    await saveDocx(statisticalAnalysisPlan(get()), `statistical-analysis-plan-${slug(title())}.docx`);
    redraw();
  });
  const saveSap = fn => update(st => { st.sap = fn(sapOnGenerate(st)); return st; });
  el.querySelector('#sap-add').onclick = () => { saveSap(sap => addSapRow(sap)); redraw(); el.querySelector(`[data-sap="${plannedFor(get()).length - 1}"][data-k="outcome"]`)?.focus(); };
  const wireSap = () => {
    el.querySelectorAll('[data-sap]').forEach(i => i.oninput = () => {
      saveSap(sap => updateSapRow(sap, Number(i.dataset.sap), { [i.dataset.k]: i.value }));
      refreshDone();
    });
    // A row's outcome is one of the review's (lib/outcome-links.mjs): naming it links the row to the outcome of that name or makes the
    // outcome, set up in Analysis, Certainty and SWiM; renaming a linked row renames the outcome everywhere. The field keeps its place.
    el.querySelectorAll('[data-sap][data-k="outcome"]').forEach(i => i.onchange = () => {
      update(st => { st.sap = sapOnGenerate(st); nameAt(st, 'sap', i.dataset.sap, i.value); return st; });
      const now = plannedFor(get())[Number(i.dataset.sap)]?.outcome ?? i.value;
      if (now !== i.value) i.value = now;
      refreshDone(); ctx.refreshCounts?.();
    });
    const linkMenu = k => { const row = plannedFor(get())[k];
      return linkChoices(get(), 'sap', row).map(c => ({ label: c.name, checked: c.checked, run: () => { update(st => { st.sap = sapOnGenerate(st); return linkPlace(st, 'sap', String(k), c.id); }); redraw(); } })); };
    el.querySelectorAll('[data-sap-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Outcome', icon: 'link', submenu: linkMenu(Number(b.dataset.sapMore)) }, '-',
      { label: 'Remove analysis', icon: 'trash', run: () => { saveSap(sap => removeSapRow(sap, Number(b.dataset.sapMore))); redraw(); } }], { align: 'end' }));
  };
  // The Done and Status cells follow what is typed; the rows nobody planned are drawn again, the inputs are left alone.
  const refreshDone = () => {
    const list = plannedFor(get()), devs = deviations(get());
    const shown = list.map((a, i) => [a, i]).filter(([a]) => String(a.outcome || '').trim() || String(a.method || '').trim());
    shown.forEach(([, i], k) => {
      const d = devs[k]; if (!d) return;
      const done = el.querySelector(`[data-sap-done="${i}"]`), status = el.querySelector(`[data-sap-status="${i}"]`);
      if (done) done.textContent = d.executed;
      if (status) { status.textContent = STATUS[d.status] || d.status; status.classList.toggle('gov-strong', d.status !== 'as planned'); }
    });
    el.querySelector('#sap-extra').innerHTML = sapExtra(devs.slice(shown.length));
  };
  wireSap();
}

function sapExtra(rows) {
  return rows.map(d => `<tr><td>${esc(d.outcome)}</td><td>${esc(d.planned)}</td><td>${esc(d.executed)}</td><td${strong(d)}>${esc(STATUS[d.status] || d.status)}</td><td></td></tr>`).join('');
}

/** One table: what was planned (the two columns a person edits), what was done and whether it matches. */
function sapTable(planned, devs) {
  const shown = planned.map((a, i) => [a, i]).filter(([a]) => String(a.outcome || '').trim() || String(a.method || '').trim());
  const rows = planned.map((a, i) => {
    const k = shown.findIndex(([, j]) => j === i), d = k >= 0 ? devs[k] : null;
    return `<tr><td><input class="ui-cell-field" data-sap="${i}" data-k="outcome" value="${esc(a.outcome)}" placeholder="Outcome" aria-label="${esc(`Outcome ${i + 1}`)}"></td>
      <td><input class="ui-cell-field" data-sap="${i}" data-k="method" value="${esc(a.method)}" placeholder="Method, effect measure, adjustment" aria-label="${esc(`Method ${i + 1}`)}"></td>
      <td data-sap-done="${i}">${esc(d?.executed || '')}</td><td data-sap-status="${i}"${d ? strong(d) : ''}>${d ? esc(STATUS[d.status] || d.status) : ''}</td>
      <td>${uiRowEnd({ more: { label: `More for analysis ${i + 1}`, attrs: { 'data-sap-more': i } } })}</td></tr>`;
  }).join('');
  const body = rows || '';
  return tableRegion({ label: 'Planned and done analyses', html: `<table class="gov-table gov-sap"><thead><tr><th>Outcome</th><th>Planned method</th><th>Done</th><th>Status</th><th></th></tr></thead>
    <tbody id="sap-planned">${body || '<tr><td colspan="5" class="empty">No analyses planned</td></tr>'}</tbody><tbody id="sap-extra">${sapExtra(devs.slice(shown.length))}</tbody></table>` });
}

// ---- SPIRIT schedule ----------------------------------------------------------------------------------------------------------

const scheduleIssues = list => {
  const placeholders = new Set(list.filter(x => x.level === 'warning' && x.text.startsWith('Replace the placeholder ')));
  let shownPlaceholders = false, n = 0;
  return list.flatMap(x => {
    if (placeholders.has(x)) {
      if (shownPlaceholders) return [];
      shownPlaceholders = true;
      x = { level: 'warning', text: placeholders.size === 1 ? 'Rename the placeholder activity.' : `Rename ${placeholders.size} placeholder activities.` };
    }
    return [uiNotice({ id: `sp-issue-${++n}`, label: x.level === 'error' ? 'Schedule error' : 'Schedule warning', text: x.text })];
  }).join('');
};

export function spiritGrid(sch) {
  const tp = sch.timepoints || [];
  const head = t => [t.label, t.window].filter(Boolean).join(' ');
  return `<div class="sp-wrap ui-table-region" role="region" aria-label="Schedule editor" tabindex="0"><table class="sp-grid" aria-label="Schedule of enrolment, interventions and assessments"><colgroup><col class="sp-activity-col">${tp.map(() => '<col class="sp-timepoint-col">').join('')}</colgroup><thead><tr><th class="sp-corner" scope="col">Activity</th>${tp.map((t, i) => `<th class="sp-tp" scope="col" data-tp="${esc(t.id)}"><div class="sp-tp-fields">
        <div class="sp-row-in"><input data-tp-label="${esc(t.id)}" value="${esc(t.label)}" placeholder="Label" aria-label="${esc(`Timepoint ${i + 1} label`)}">
          ${uiRowEnd({ more: { label: `More for ${head(t) || 'timepoint'}`, attrs: { 'data-tp-menu': t.id } } })}</div>
        <input data-tp-window="${esc(t.id)}" value="${esc(t.window)}" placeholder="Window" aria-label="${esc(`Timepoint ${i + 1} window`)}"></div></th>`).join('')}</tr></thead>
      ${SPIRIT_SECTIONS.map(sec => {
        const rows = sch.rows.filter(r => r.section === sec.id);
        return `<tbody data-section="${sec.id}"><tr class="sp-sec"><th scope="rowgroup" colspan="${tp.length + 1}"><span>${esc(sec.label)}</span>
            <button class="quiet" data-row-add="${sec.id}">${icon('plus')}<span>Add row</span></button></th></tr>
          ${rows.map((r, k) => `<tr data-row="${esc(r.id)}"><th class="sp-row" scope="row"><div class="sp-row-in"><input data-row-label="${esc(r.id)}" value="${esc(r.label)}" placeholder="Row" aria-label="${esc(`${sec.label} row ${k + 1}`)}">
              ${uiRowEnd({ more: { label: `More for ${r.label || 'activity'}`, attrs: { 'data-row-menu': r.id } } })}</div></th>
            ${tp.map(t => `<td data-timepoint="${esc(t.id)}"><label class="sp-cell"><input type="checkbox" data-mark="${esc(r.id)}" data-at="${esc(t.id)}"${r.marks?.[t.id] === 'x' ? ' checked' : ''} aria-label="${esc(`${r.label || 'Row'} at ${head(t) || 'timepoint'}`)}"></label></td>`).join('')}</tr>`).join('')}</tbody>`;
      }).join('')}</table></div>`;
}

function renderSpirit(el, ctx) {
  const s = get();
  const sch = scheduleOf(s);
  const issues = validateSchedule(sch);
  el.innerHTML = page('spirit', sectionHead({ id: 'sp-head', label: 'SPIRIT schedule', message: { id: 'sp-note', text: '' }, actions: [
      { id: 'sp-add-tp', label: 'Add timepoint', icon: 'plus' },
      { id: 'sp-export', label: 'Export', icon: 'export', menu: true }],
    overflow: [{ id: 'sp-insert', label: 'Insert in manuscript' }] }), `
    <div class="gov-rows" id="sp-issues">${scheduleIssues(issues)}</div>
    ${spiritGrid(sch)}
    <div class="gov-fig">${figurePanel({ title: 'Preview', id: 'sp-fig' })}</div>`);

  const note = el.querySelector('#sp-note');
  const edit = (op, { redraw = true } = {}) => {
    const before = scheduleOf(get());
    const oldTp = before.timepoints.findIndex(t => t.id === op.timepoint), oldRow = before.rows.findIndex(r => r.id === op.row);
    update(st => { st.spiritSchedule = applyScheduleOp(scheduleOf(st), op); return st; });
    if (redraw) {
      renderSpirit(el, ctx);
      const after = scheduleOf(get());
      const id = op.op === 'remove-timepoint' ? after.timepoints[Math.min(oldTp, after.timepoints.length - 1)]?.id
        : op.op === 'remove-row' ? after.rows[Math.min(oldRow, after.rows.length - 1)]?.id : op.timepoint || op.row;
      const key = op.timepoint ? 'data-tp-label' : op.row ? 'data-row-label' : null;
      const target = key && id ? el.querySelector(`[${key}="${CSS.escape(id)}"]`) : null;
      target?.focus(); target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    else { drawFigure(); refreshGridLabels(); el.querySelector('#sp-issues').innerHTML = scheduleIssues(validateSchedule(scheduleOf(get()))); }
  };
  const drawFigure = () => showFigure(el, 'sp-fig', scheduleSvg(scheduleOf(get())), 'spirit-schedule');
  const refreshGridLabels = () => {
    const now = scheduleOf(get()), timepoints = new Map(now.timepoints.map(t => [t.id, [t.label, t.window].filter(Boolean).join(' ') || 'timepoint']));
    const rows = new Map(now.rows.map(r => [r.id, r.label || 'Row']));
    el.querySelectorAll('[data-mark]').forEach(b => b.setAttribute('aria-label', `${rows.get(b.dataset.mark)} at ${timepoints.get(b.dataset.at)}`));
    el.querySelectorAll('[data-tp-menu]').forEach(b => b.setAttribute('aria-label', `More for ${timepoints.get(b.dataset.tpMenu)}`));
    el.querySelectorAll('[data-row-menu]').forEach(b => b.setAttribute('aria-label', `More for ${rows.get(b.dataset.rowMenu)}`));
  };
  drawFigure();
  el.querySelector('.sp-grid').style.setProperty('--sp-column-count', String(sch.timepoints.length));
  el.querySelector('#sp-add-tp').onclick = () => {
    edit({ op: 'add-timepoint' });
    const field = el.querySelector(`[data-tp-label="${CSS.escape(scheduleOf(get()).timepoints.at(-1)?.id || '')}"]`);
    field?.focus(); field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  el.querySelectorAll('[data-mark]').forEach(b => b.onchange = () => {
    edit({ op: 'toggle', row: b.dataset.mark, timepoint: b.dataset.at }, { redraw: false });
    const on = scheduleOf(get()).rows.find(r => r.id === b.dataset.mark)?.marks?.[b.dataset.at] === 'x';
    b.checked = on;
  });
  el.querySelectorAll('[data-tp-label]').forEach(i => i.oninput = () => edit({ op: 'timepoint', timepoint: i.dataset.tpLabel, label: i.value }, { redraw: false }));
  el.querySelectorAll('[data-tp-window]').forEach(i => i.oninput = () => edit({ op: 'timepoint', timepoint: i.dataset.tpWindow, window: i.value }, { redraw: false }));
  el.querySelectorAll('[data-tp-menu]').forEach(b => b.onclick = () => {
    const now = scheduleOf(get()), i = now.timepoints.findIndex(t => t.id === b.dataset.tpMenu);
    showMenu(b, [
      { label: 'Move left', icon: 'chevron-left', disabled: i <= 0, run: () => edit({ op: 'move-timepoint', timepoint: b.dataset.tpMenu, delta: -1 }) },
      { label: 'Move right', icon: 'chevron-right', disabled: i < 0 || i === now.timepoints.length - 1, run: () => edit({ op: 'move-timepoint', timepoint: b.dataset.tpMenu, delta: 1 }) },
      '-', { label: 'Remove timepoint', icon: 'trash', run: () => edit({ op: 'remove-timepoint', timepoint: b.dataset.tpMenu }) },
    ], { matchWidth: false });
  });
  el.querySelectorAll('[data-row-add]').forEach(b => b.onclick = () => {
    edit({ op: 'add-row', section: b.dataset.rowAdd });
    const rows = scheduleOf(get()).rows.filter(r => r.section === b.dataset.rowAdd);
    el.querySelector(`[data-row-label="${CSS.escape(rows.at(-1)?.id || '')}"]`)?.focus();
  });
  el.querySelectorAll('[data-row-label]').forEach(i => i.oninput = () => edit({ op: 'rename-row', row: i.dataset.rowLabel, label: i.value }, { redraw: false }));
  el.querySelectorAll('[data-row-menu]').forEach(b => b.onclick = () => {
    const now = scheduleOf(get()), row = now.rows.find(r => r.id === b.dataset.rowMenu), rows = now.rows.filter(r => r.section === row?.section), i = rows.findIndex(r => r.id === row?.id);
    showMenu(b, [
      { label: 'Move up', icon: 'arrow-up', disabled: i <= 0, run: () => edit({ op: 'move-row', row: b.dataset.rowMenu, delta: -1 }) },
      { label: 'Move down', icon: 'arrow-down', disabled: i < 0 || i === rows.length - 1, run: () => edit({ op: 'move-row', row: b.dataset.rowMenu, delta: 1 }) },
      '-', { label: 'Remove activity', icon: 'trash', run: () => edit({ op: 'remove-row', row: b.dataset.rowMenu }) },
    ], { matchWidth: false });
  });
  const exports = [
    { label: 'CSV', icon: 'export', run: () => download(toCsv(scheduleOf(get())), 'spirit-schedule.csv', 'text/csv') },
    { label: 'Word table', icon: 'export', run: () => saveDocx(scheduleBlocks(scheduleOf(get())), 'spirit-schedule.docx') },
    { label: 'SVG figure', icon: 'export', run: () => download(scheduleSvg(scheduleOf(get()), { style: figureTokens(null, { medium: 'export' }) }), 'spirit-schedule.svg', 'image/svg+xml') },
  ].map(item => ({ ...item, run: async () => { try { await item.run(); note.textContent = ''; } catch (error) { note.textContent = `Export failed: ${error.message}`; } } }));
  menuOn(el.querySelector('#sp-export'), () => exports, v => exports.find(x => x.label === v)?.run());
  el.querySelector('#sp-insert').onclick = async () => {
    if (!await confirmAsk('Insert the schedule at the end of the manuscript?', { confirm: 'Insert' })) return;
    update(st => { st.manuscript = appendToManuscript(st.manuscript, scheduleBlocks(scheduleOf(st))); return st; });
    note.textContent = 'Inserted at the end of the manuscript'; ctx.refreshCounts?.();
  };
}

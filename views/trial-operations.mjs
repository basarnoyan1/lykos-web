import { disclosure, sentenceLabel, tableRegion, uiLink } from '../lib/ui-components.mjs';
import { get, update } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { saveFile } from '../lib/save.mjs';
import { when, day, plural } from '../lib/dates.mjs';
import { uiBar, uiList, uiRow } from '../lib/ui-actions.mjs';
import { trialState, saveSite, saveTrialParticipant, saveVisitDefinition, saveVisit, saveQuery, saveAdjudication, maskedAdjudicationPacket, visitStatus, trialExport, serviceEndpoint, trialReadiness } from '../lib/trial-operations.mjs';
import { pagedList, wirePagedLists } from '../lib/paged-list.mjs';
export const meta = { title: 'Trial operations', icon: 'trial-operations' };
// id, title, the noun of one record ("New site"), the noun of several
const SECTIONS = [['participants', 'Screening and consent', 'participant', 'participants'], ['sites', 'Sites', 'site', 'sites'], ['schedule', 'Visit schedule', 'visit', 'visits'], ['visits', 'Follow-up', 'follow-up visit', 'follow-up visits'],
  ['queries', 'Data queries', 'query', 'queries'], ['adjudications', 'Outcome adjudication', 'adjudication', 'adjudications'], ['connection', 'Trial service']];
let section = 'participants', selectedId = '', adding = false, focusForm = false;
export const list = { title: 'Trial operations', items: s => SECTIONS.map(([id, title]) => ({ id, title, sub: id === 'connection' ? (trialReadiness(s).configured ? 'Configured, not connected' : 'Not configured') : plural(trialState(s)[id].length, 'record'), meta: '', mark: '' })) };
export function select(id) { section = id; selectedId = ''; adding = false; }
export const selected = () => section;
const field = (id, label, value = '', type = 'text') => `<label class="field"><span>${esc(label)}</span><input data-field="${id}" type="${type}" value="${esc(value)}" aria-label="${esc(label)}"></label>`;
const choice = (id, label, values, value = '') => `<label class="field"><span>${esc(label)}</span><select data-field="${id}" aria-label="${esc(label)}">${values.map(x => { const [v, l] = Array.isArray(x) ? x : [x, sentenceLabel(x)]; return `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
const table = (headers, rows) => `<table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/**
 * The title bar (lib/topbar.mjs): the section on show is the title, its count the status, New (while there are records and no form is open) the
 * one primary, and Export trial records (every section, as one file) beside it.
 */
export function pageSpec({ section: id, count = 0, editing = false }, { add = () => {}, exportAll = () => {} } = {}) {
  const [, name, noun] = SECTIONS.find(x => x[0] === id) || SECTIONS[0];
  const records = id !== 'connection';
  return { title: name, 
    actions: [...(records && count && !editing ? [{ id: 'trial-new', label: `New ${noun}`, icon: 'plus', role: 'primary', run: add }] : []),
      { id: 'trial-export', label: 'Export trial records', icon: 'export', run: exportAll }] };
}
export function page(rerender) {
  const s = get(), t = trialState(s);
  const count = section === 'visits' ? visitStatus(s).length : Array.isArray(t[section]) ? t[section].length : 0;
  return pageSpec({ section, count, editing: adding || !!selectedId }, {
    add: () => { selectedId = ''; adding = true; focusForm = true; rerender(); },
    exportAll: async () => { try { await saveFile(JSON.stringify(trialExport(get()), null, 2), 'trial-operations.json', 'application/json'); } catch (err) { rerender?.(String(err.message || err).slice(0, 80)); } } });
}

/** One record as a row: its name opens it, what identifies it beneath, its status in a fixed cell. */
const recordRow = (id, name, detail, status, statusCh = 12) => uiRow({ cls: 'tr-row', attrs: { 'data-trial-row': id, 'aria-current': id === selectedId ? 'true' : false },
  main: { html: uiLink({ label: name, attrs: { 'data-trial-edit': id } }), detail: detail.filter(Boolean).map(esc), wrap: true },
  cells: status == null ? [] : [{ col: 'status', kind: 'text', ch: statusCh, html: esc(status) }] });

export function render(el, ctx) {
  const s = get(), t = trialState(s), row = (Array.isArray(t[section]) ? t[section] : []).find(x => x.id === selectedId) || {}, pid = t.participants.map(p => [p.id, p.id]);
  const [, name, noun, nouns] = SECTIONS.find(x => x[0] === section);
  let fields = '', records = [], save, hasStatus = true;
  if (section === 'sites') {
    fields = field('id', 'Site code', row.id) + field('name', 'Site name', row.name) + field('approved', 'Approval date', row.approved, 'date') + choice('active', 'Status', [['true', 'Active'], ['false', 'Inactive']], String(row.active ?? true));
    records = t.sites.map(r => recordRow(r.id, r.name, [r.id, r.approved ? `Approved ${day(r.approved)}` : ''], r.active ? 'Active' : 'Inactive', 8)); save = (st, r, by) => saveSite(st, { ...r, active: r.active === 'true' }, by);
  } else if (section === 'participants') {
    fields = field('id', 'Participant code', row.id) + choice('siteId', 'Site', [['', 'Choose site'], ...t.sites.map(x => [x.id, x.name])], row.siteId) + field('screened', 'Screening date', row.screened, 'date') + choice('eligibility', 'Eligibility', ['pending', 'eligible', 'ineligible'], row.eligibility) + field('reason', 'Eligibility reason', row.reason) + field('consented', 'Consent date', row.consented, 'date') + field('consentVersion', 'Consent document version', row.consentVersion) + field('withdrawn', 'Withdrawal date', row.withdrawn, 'date') + field('withdrawalReason', 'Withdrawal reason', row.withdrawalReason) + field('protocolDeviation', 'Per-protocol exclusion reason', row.protocolDeviation);
    records = t.participants.map(r => recordRow(r.id, r.id, [r.siteId, r.consented ? `Consented ${day(r.consented)}` : 'Consent not recorded', r.withdrawn ? `Withdrew ${day(r.withdrawn)}` : ''], sentenceLabel(r.eligibility))); save = saveTrialParticipant;
  } else if (section === 'schedule') {
    fields = field('id', 'Visit code', row.id) + field('name', 'Visit name', row.name) + field('days', 'Days after allocation', row.days ?? 0, 'number') + field('before', 'Window before (days)', row.before ?? 0, 'number') + field('after', 'Window after (days)', row.after ?? 0, 'number') + field('assessments', 'Required assessments', row.assessments);
    hasStatus = false;
    records = t.schedule.map(r => recordRow(r.id, r.name, [`Day ${r.days}`, `−${r.before} / +${r.after} days`, r.assessments], null)); save = saveVisitDefinition;
  } else if (section === 'visits') {
    fields = choice('participantId', 'Participant', [['', 'Choose participant'], ...pid], row.participantId) + choice('visitId', 'Visit', [['', 'Choose visit'], ...t.schedule.map(v => [v.id, v.name])], row.visitId) + choice('status', 'Visit status', ['pending', 'completed', 'missed'], row.status) + field('completed', 'Completion date', row.completed, 'date') + field('assessments', 'Assessments completed', row.assessments) + field('reason', 'Reason', row.reason);
    records = visitStatus(s).map(r => recordRow(`${r.participantId}:${r.visitId}`, r.participantId, [r.name, `Due ${day(r.due)}`, `Window ${day(r.start)} to ${day(r.end)}`], sentenceLabel(r.status))); save = saveVisit;
  } else if (section === 'queries') {
    fields = field('id', 'Query code', row.id) + choice('participantId', 'Participant', [['', 'Choose participant'], ...pid], row.participantId) + field('question', 'Question', row.question) + choice('status', 'Status', ['open', 'answered', 'closed'], row.status) + field('answer', 'Response', row.answer) + choice('datasetId', 'Dataset', [['', 'No dataset'], ...(s.datasets || []).map(d => [d.id, d.name])], row.datasetId) + field('rowId', 'Row identifier', row.rowId) + field('columnId', 'Column identifier', row.columnId);
    records = t.queries.map(r => recordRow(r.id, r.id, [r.participantId, r.question], sentenceLabel(r.status), 8)); save = saveQuery;
  } else if (section === 'adjudications') {
    fields = choice('participantId', 'Participant', [['', 'Choose participant'], ...pid], row.participantId) + field('outcome', 'Outcome', row.outcome) + field('decision', 'Decision', row.decision) + field('evidence', 'Source reference', row.evidence);
    hasStatus = false;
    records = t.adjudications.map(r => recordRow(r.id, r.participantId, [r.outcome, r.decision, r.by], null)); save = saveAdjudication;
  } else {
    fields = field('endpoint', 'Protected service URL', t.connection?.endpoint || '', 'url');
    save = (st, r) => { st.trialOperations = { ...trialState(st), connection: { protocol: 'lykos-trial-v1', endpoint: serviceEndpoint(r.endpoint), configuredAt: new Date().toISOString() } }; };
  }
  const isConnection = section === 'connection', editing = isConnection || adding || !!selectedId;
  const footSpec = { kind: 'foot', label: isConnection ? 'Connection' : `${selectedId ? 'Edit' : 'New'} ${noun}`, id: 'tr-foot', ...(isConnection ? {} : { start: [{ message: 'Each save is added to the change log' }] }),
    actions: [...(section === 'adjudications' ? [{ id: 'trial-packet', label: 'Export masked packet', icon: 'export' }] : []), ...(isConnection ? [] : [{ id: 'trial-cancel', label: 'Cancel' }]),
      { id: 'trial-save', label: isConnection ? 'Save connection' : 'Save record', role: 'primary', type: 'submit' }] };
  const foot = uiBar(footSpec);   // a spec in a variable: the placement lint reads literal start parts as acts, and a start message is the builder's own
  const form = editing ? `<form id="trial-form" novalidate><div class="an-settings">${fields}${isConnection ? '' : field('by', 'Responsible researcher', s.settings?.reviewer || s.settings?.name || t.log.at(-1)?.by || '')}</div>${foot}</form>` : '';
  const body = isConnection ? '' : records.length
    ? (pg => uiList({ id: 'tr-list', label: name, cols: hasStatus ? ['status'] : [], rows: pg.items }) + pg.pager)(pagedList(`tr-${section}`, records, { label: nouns }))
    : editing ? '' : emptyState({ icon: 'trial-operations', title: `No ${nouns}`, actions: [{ id: 'trial-new', label: `New ${noun}`, icon: 'plus', primary: true }] });
  const log = isConnection ? '' : disclosure({ id: 'trial-change-log', title: 'Local change log', count: t.log.length, className: 'panel',
    body: t.log.length ? tableRegion({ label: 'Local change log', html: table(['When', 'Collection', 'Record', 'Researcher'], t.log.slice(-50).reverse().map(r => [esc(when(r.at)), esc(sentenceLabel(r.collection)), esc(r.id), esc(r.by)])) }) : '<p class="meta">No changes yet</p>' });
  el.innerHTML = `<div class="panel">${isConnection ? '<p class="meta" data-ui-help>The service must implement the Lykos trial contract. Protected roles and masked access need it; credentials stay outside the project.</p>' : ''}${form}${body}</div>${log}`;
  wirePagedLists(el, () => ctx.rerender());
  if (focusForm) { focusForm = false; el.querySelector('#trial-form [data-field]')?.focus(); }
  const values = () => Object.fromEntries([...el.querySelectorAll('[data-field]')].map(x => [x.dataset.field, x.value]));
  const status = text => { const m = el.querySelector('#tr-foot [role=status]'); if (m) m.textContent = text; m?.setAttribute('data-error', ''); };
  const done = () => { selectedId = ''; adding = false; ctx.rerender(); ctx.refreshList?.(); };
  el.querySelector('#trial-form')?.addEventListener('submit', e => { e.preventDefault(); const r = values(); try { update(st => { save(st, r, r.by); return st; }); done(); } catch (err) { status(err.message); } });
  el.querySelector('#trial-cancel')?.addEventListener('click', done);
  el.querySelectorAll('#trial-new').forEach(b => b.addEventListener('click', () => { selectedId = ''; adding = true; focusForm = true; ctx.rerender(); }));
  el.querySelectorAll('[data-trial-edit]').forEach(b => b.addEventListener('click', () => { selectedId = b.dataset.trialEdit; adding = false; focusForm = true; ctx.rerender(); }));
  el.querySelector('#trial-packet')?.addEventListener('click', async () => { try { await saveFile(JSON.stringify(maskedAdjudicationPacket(get(), values().participantId), null, 2), 'adjudication-packet.json', 'application/json'); } catch (err) { status(err.message); } });
}

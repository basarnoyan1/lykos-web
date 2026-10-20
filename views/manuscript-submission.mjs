// The Manuscript's submission tools: the journal profile and readiness in the
// inspector, the declarations editor, the title page, cover letter and
// blinded copy exports, and the response to reviewers (plan §2, "Writing and
// submission, 2026-09-29").
//
// views/manuscript.mjs owns the document and its undo; everything here that
// changes the document goes through `api.commit`, so it is one undoable step.
// The words written into the document come from lib/declarations.mjs,
// lib/journal-profiles.mjs and lib/reviewer-response.mjs; nothing here writes
// prose of its own.
import { plural } from '../lib/dates.mjs';
import { get, update, projects } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, uiStatusLine, uiList, uiRow } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { confirmAsk, planDialog } from '../lib/dialog.mjs';
import { saveFile } from '../lib/save.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { researchType, targetJournal } from '../lib/workflow.mjs';
import { journalContext } from '../lib/journal-context.mjs';
import { GENERIC_PROFILES, REQUIREMENTS, REFERENCE_STYLES, customProfile, profileFromText, JOURNAL_PROFILES } from '../lib/journal-profiles.mjs';
import { countsAgainstProfile, readinessReport, blindedCopy, keywordList } from '../lib/submission-checks.mjs';
import { CREDIT_ROLES, CREDIT_DEGREES, ICMJE_CRITERIA, DATA_CHOICES, CONSENT_TYPES, normalizeDeclarations, validate, statementBlocks, titlePage } from '../lib/declarations.mjs';
import { coverLetter } from '../lib/cover-letter.mjs';
import { responseLetter } from '../lib/reviewer-response.mjs';
import { normalizeJournalProfile, activeProfile, declaredStatements, normalizeReviewRounds, roundFromLetter, insertStatements, existingStatements, insertAbstract, canInsertAbstract, titlePageAuthors, titlePageCounts, blindingInputs } from '../lib/manuscript-submission.mjs';
import { summaryLine } from '../lib/submissions.mjs';
import { dateValue, dateField, wireDateField } from '../lib/date-picker.mjs';
import { uiLink, formField, formFit, formCells, disclosure } from '../lib/ui-components.mjs';
import { retractionReadiness, reportedRecords, freshDays } from '../lib/integrity.mjs';
import { settings } from '../lib/model-settings.mjs';
import { openCheck } from './library-checks.mjs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const n = x => Number(x).toLocaleString('en');
const typeId = () => researchType(get()).id;
const paper = () => get().paper || {};
const authorNames = () => (paper().authors || []).map(a => String(a?.name || '').trim()).filter(Boolean);
const fileBase = () => String(get().manuscript?.name || paper().title || 'manuscript').replace(/\.docx$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'manuscript';
const plainDocx = blocks => writeDocx({ blocks, section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });

// ---- the inspector's Journal and Submission readiness ------------------------------------

const opened = new Map();   // readiness groups the author opened or closed, by title

/** The Journal and Submission readiness sections of the inspector (the shell draws their titles): { journal, status, readiness } as markup. */
export function submissionParts({ blocks, assets = [], issues = [] }) {
  const s = get();
  const jp = normalizeJournalProfile(s.journalProfile);
  const profile = activeProfile(jp);
  const notes = s.manuscript?.notes || {}, section = s.manuscript?.section || null;
  const rows = profile ? countsAgainstProfile(blocks, profile, { assets, notes, section }) : [];
  const limitOf = r => r.limit == null ? '' : typeof r.limit === 'object'
    ? r.limit.min != null && r.limit.max != null ? `${r.limit.min}–${r.limit.max}` : r.limit.max != null ? `≤ ${r.limit.max}` : `≥ ${r.limit.min}`
    : n(r.limit);
  const pick = jp?.id || '';
  // The target journal and where the profile came from: set by the target, chosen by the author, or the author's own.
  const jctx = journalContext(s);
  const journalLine = [jctx.journal || 'No target journal', !jctx.profileId ? 'No profile'
    : `Profile ${jctx.profileFrom === 'target' ? `set by ${jctx.journal}` : jctx.profileFrom === 'custom' ? 'written by you' : 'chosen by you'}`].join(' · ');
  const customBad = jp?.id === 'custom' && !profile;
  const report = readinessReport({ blocks, assets, notes, section, profile, researchType: typeId(), checks: issues, variety: jp?.variety || null,
    declarations: declaredStatements(s.declarations, s.paper, typeId()),
    retraction: retractionReadiness(reportedRecords(s), { now: Date.now(), days: freshDays(settings()) }) });
  const items = report.sections.flatMap(x => x.items);
  const missing = items.filter(i => i.state === 'missing').length;
  const warnings = items.filter(i => i.state === 'warn').length;
  const complete = items.filter(i => i.state === 'ok').length;
  // One line says where the submission stands: the checks complete, then what is missing and what needs a look.
  const statusLine = uiStatusLine({ id: 'ms-ready-line', label: 'Submission readiness', parts: [
    { id: 'ms-ready-done', text: `${complete} of ${items.length} complete`, drop: 0 },
    ...(missing ? [{ id: 'ms-ready-missing', text: `${missing} missing`, drop: 2 }] : []),
    ...(warnings ? [{ id: 'ms-ready-review', text: `${warnings} to review`, drop: 1 }] : [])] });
  const STATE = { ok: ['check', 'Done'], warn: ['warn', 'Check'], missing: ['warn', 'Missing'] };
  const group = sec => {
    const absent = sec.items.filter(i => i.state === 'missing').length;
    const review = sec.items.filter(i => i.state === 'warn').length;
    const bad = absent + review;
    const label = absent ? `${absent} missing` : review ? `${review} to review` : 'Complete';
    const open = opened.has(sec.title) ? opened.get(sec.title) : sec.items.some(i => i.state === 'missing');
    // A sentence that would repeat on more than two items of a group is said once, above the items that carry it.
    const seen = new Map();
    for (const i of sec.items) if (i.detail) seen.set(i.detail, (seen.get(i.detail) || 0) + 1);
    const repeated = [...seen].filter(([, k]) => k > 2).map(([d]) => d);
    const row = (i, shown = true) => `<div class="ms-ready-item is-${i.state}">
        <span class="ms-ready-state" role="img" aria-label="${STATE[i.state][1]}">${icon(STATE[i.state][0], { size: 14 })}</span>
        <span class="ms-ready-text"><span class="ms-ready-label">${esc(i.label)}</span>${i.detail && shown ? `<span class="ms-ready-detail">${esc(i.detail)}</span>` : ''}${i.action ? `<span class="ms-ready-act">${uiLink({ id: i.action.id, label: i.action.label })}</span>` : ''}</span></div>`;
    return `<details class="ms-ready-group" data-ready-group="${esc(sec.title)}"${open ? ' open' : ''}>
      <summary><span class="ms-ready-name">${esc(sec.title)}</span><span class="ms-ready-status${bad ? ' needs-review' : ''}">${bad ? '' : icon('check', { size: 12 })}${esc(label)}</span></summary><div class="ms-ready-items">
      ${/* what needs a look first: the missing, the items that share one reason (under it), then those to review, then what is done */ ''}
      ${sec.items.filter(i => !repeated.includes(i.detail) && i.state === 'missing').map(i => row(i)).join('')}
      ${repeated.map(d => `<p class="meta ms-ready-note">${esc(d)}</p>${sec.items.filter(i => i.detail === d).map(i => row(i, false)).join('')}`).join('')}
      ${sec.items.filter(i => !repeated.includes(i.detail) && i.state !== 'missing' && i.state !== 'ok').map(i => row(i)).join('')}
      ${sec.items.filter(i => !repeated.includes(i.detail) && i.state === 'ok').map(i => row(i)).join('')}</div>
    </details>`;
  };
  const profileField = formField('Profile', `<select id="jp-pick">
        <option value=""${pick ? '' : ' selected'}>None</option>
        ${[...GENERIC_PROFILES, ...JOURNAL_PROFILES].map(p => `<option value="${esc(p.id)}"${pick === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="custom"${pick === 'custom' ? ' selected' : ''}>${esc(jp?.custom?.name ? `Custom: ${jp.custom.name}` : 'Custom')}</option>
      </select>`);
  const spellingField = formField('Spelling', `<select id="jp-variety">
        <option value=""${jp?.variety ? '' : ' selected'}>Not set</option>
        <option value="us"${jp?.variety === 'us' ? ' selected' : ''}>American (US)</option>
        <option value="uk"${jp?.variety === 'uk' ? ' selected' : ''}>British (UK)</option>
      </select>`);
  const journal = `
      <p class="meta" id="ms-journal-line">${esc(journalLine)}</p>
      ${profileField}
      ${spellingField}
      ${rows.length ? uiList({ label: 'Counts against the profile', cols: ['value'], rows: rows.map(r => uiRow({ cls: r.over || r.under ? 'ms-sub-over' : '',
        main: { html: esc(r.what) }, cells: [{ col: 'value', kind: 'text', ch: 24, html: `${n(r.value)}${r.limit != null ? ` / ${esc(limitOf(r))}` : ''}${r.over ? ' over' : r.under ? ' under' : ''}` }] })) }) : ''}
      ${pick === 'custom' || profile ? uiBar({ kind: 'foot', label: 'Journal profile', id: 'ms-journal-bar',
        ...(customBad ? { start: [{ message: 'Profile incomplete' }] } : !canInsertAbstract(blocks) && profile ? { start: [{ message: 'The manuscript has an abstract' }] } : {}),
        actions: [...(pick === 'custom' ? [{ id: 'jp-edit', label: 'Edit profile', icon: 'settings' }] : []),
          ...(profile ? [{ id: 'jp-abstract', label: 'Insert abstract headings', icon: 'file-plus', disabled: !canInsertAbstract(blocks) }] : [])] }) : ''}
      ${uiBar({ kind: 'foot', label: 'Submission', id: 'ms-sub-track', message: { id: 'ms-sub-track-line', text: `Submission · ${summaryLine(s.submissions, dateValue(new Date())) || 'Not submitted'}` },
        actions: [{ id: 'ms-sub-open', label: 'Open', icon: 'open', role: 'quiet' }] })}
    `;
  const readiness = `
      ${report.sections.filter(x => x.title !== 'Limits' && x.items.length).map(group).join('')}
      ${uiBar({ kind: 'foot', label: 'Declarations', id: 'ms-ready-foot', actions: [{ id: 'jp-declarations', label: 'Manage declarations', icon: 'manuscript' }] })}`;
  return { journal, status: statusLine, readiness };
}

const setProfile = patch => update(s => {
  const cur = normalizeJournalProfile(s.journalProfile) || { id: null, variety: null, custom: null };
  s.journalProfile = normalizeJournalProfile({ ...cur, ...patch });
  return s;
});

export function wireSubmission(el, api) {
  const pickEl = el.querySelector('#jp-pick');
  if (pickEl) pickEl.onchange = () => {
    const v = pickEl.value;
    // a custom profile is written on its own page first; choosing Custom with none saved leaves the choice as it was until it is saved
    if (v === 'custom' && !normalizeJournalProfile(get().journalProfile)?.custom) { pickEl.value = normalizeJournalProfile(get().journalProfile)?.id || ''; editCustomProfile(api); return; }
    setProfile({ id: v || null, from: 'manual' });   // a choice of the author's own: a new target journal no longer replaces it
    api.rerender();
  };
  el.querySelector('#jp-edit')?.addEventListener('click', () => editCustomProfile(api));
  const variety = el.querySelector('#jp-variety'); if (variety) variety.onchange = e => { setProfile({ variety: e.target.value || null }); api.rerender(); };
  el.querySelector('#jp-abstract')?.addEventListener('click', () => insertAbstractHeadings(api));
  el.querySelector('#jp-declarations')?.addEventListener('click', () => openDeclarations(api));
  el.querySelector('#ms-sub-open')?.addEventListener('click', () => api.go?.('submissions'));   // the journals the manuscript went to (views/submissions.mjs)
  el.querySelectorAll('[data-ready-group]').forEach(d => d.ontoggle = () => opened.set(d.dataset.readyGroup, d.open));
  // Retraction check · Check now: the Library's Retractions and corrections page, which checks the records that are due as it opens
  el.querySelector('#ms-ready-retractions')?.addEventListener('click', () => { openCheck('retractions', { run: true }); api.go?.('library'); });
}

// ---- document edits ---------------------------------------------------------------

/** The chosen profile's abstract headings, where the manuscript has no abstract. */
export function insertAbstractHeadings(api) {
  const profile = activeProfile(get().journalProfile) || GENERIC_PROFILES[0];
  let focusId = null;
  const ok = api.commit(m => {
    const r = insertAbstract(m.blocks, profile);
    if (!r) return null;
    focusId = r.focusId; m.blocks = r.blocks;
    return m;
  }, () => focusId && { start: { id: focusId, at: 0 }, end: { id: focusId, at: 0 } });
  if (!ok) api.status?.('The manuscript already has an abstract');
  return ok;
}

/** The declarations as statements before the reference list, replacing an earlier insertion after a yes. */
export async function insertDeclarationStatements(api) {
  const s = get();
  const made = statementBlocks(normalizeDeclarations(s.declarations, s.paper), s.paper?.authors || [], { researchType: typeId() });
  const again = existingStatements(api.blocks(), made);
  if (again.length && !await confirmAsk('Replace the existing statements?', { detail: again.join(', '), confirm: 'Replace' })) return false;
  const ok = api.commit(m => { m.blocks = insertStatements(m.blocks, made).blocks; return m; },
    () => ({ start: { id: made[0].id, at: 0 }, end: { id: made[0].id, at: 0 } }));
  return ok;
}

// ---- sub-pages of Manuscript > Submission (DIALOGS #56, #57, #59) -------------------------------------------------------------
// The custom journal profile, the declarations and the response to reviewers are pages of their own with Back in the title bar
// (views/manuscript.mjs page() and render() hand over to submissionPageSpec() and renderSubmissionPage() while one is open). Their
// state lives here, in the module, so a repaint of the Manuscript never loses a draft. Leaving the Manuscript from its navigation
// entry closes the sub-page (leaveSubmissionPage, from the view's openList); a profile draft is dropped with it.

let sub = null;       // { kind: 'profile' | 'declarations' | 'responses', project } while a sub-page is open
let profile = null;   // the custom profile being written: { cur, v, error, status, found, picked, text }
const project = () => projects().current;
const enter = kind => { sub = { kind, project: project() }; };
/** Which sub-page is open (null when none, or when it belongs to another project). */
export const submissionPageOpen = () => (sub && sub.project === project() ? sub.kind : null);
/** Closes the sub-page; the Manuscript draws its document again on the next paint. */
export function leaveSubmissionPage() { sub = null; profile = null; }

const sectionOf = (title, body, id) => `<section class="dc-section"${id ? ` id="${esc(id)}"` : ''} aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}</section>`;
// a textarea has a row of its own (a field beside it would be a different height)
const wideOf = html => `<div class="an-settings" data-fit="2">${html}</div>`;
const fieldsOf = html => `<div class="an-settings"${formFit(formCells(html))}>${html}</div>`;
const inputOf = (attr, key, value, extra = '') => `<input ${attr}="${esc(key)}" value="${esc(value ?? '')}" autocomplete="off"${extra}>`;
const areaOf = (attr, key, value, rows = 3) => `<textarea ${attr}="${esc(key)}" rows="${rows}">${esc(value ?? '')}</textarea>`;
const checkOf = (attrs, label, on, id = '') => `<label class="cr-check"><input type="checkbox"${id ? ` id="${esc(id)}"` : ''} ${attrs}${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
const noteOf = (id, text) => text ? `<p class="note" id="${esc(id)}" role="alert">${esc(text)}</p>` : '';
const optionOf = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;

// ---- a custom journal profile ------------------------------------------------------------

const LIMIT_FIELDS = [
  ['wordLimit', 'Main text words'], ['abstractLimit', 'Abstract words'], ['referenceLimit', 'References'],
  ['figureTableLimit', 'Figures and tables'], ['titleLimitChars', 'Title characters'], ['runningTitleChars', 'Running title characters'],
];
const FIELD_LABEL = { ...Object.fromEntries(LIMIT_FIELDS), keywords: 'Keywords', abstractStructured: 'Structured abstract',
  abstractHeadings: 'Abstract headings', referenceStyle: 'Reference style', ...Object.fromEntries(REQUIREMENTS.map(r => [`requires:${r.id}`, r.label])) };
const shown = (field, v) => field === 'keywords' ? [v.min != null ? `min ${v.min}` : '', v.max != null ? `max ${v.max}` : ''].filter(Boolean).join(', ')
  : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (field.startsWith('requires:') ? 'Required' : v ? 'Yes' : 'No') : String(v);
const styleName = r => (r === 'ama' || r === 'apa' || r === 'nlm' ? r.toUpperCase() : r[0].toUpperCase() + r.slice(1));

/** Starts writing the custom profile (the one saved, or a blank one) on its own page. */
export function editCustomProfile(api) {
  const cur = normalizeJournalProfile(get().journalProfile)?.custom || {};
  profile = { cur, error: '', status: '', found: null, picked: new Set(), text: '',
    v: { name: cur.name || '', publisher: cur.publisher || '', ...Object.fromEntries(LIMIT_FIELDS.map(([k]) => [k, cur[k] == null ? '' : String(cur[k])])),
      kwMin: cur.keywords?.min == null ? '' : String(cur.keywords.min), kwMax: cur.keywords?.max == null ? '' : String(cur.keywords.max),
      referenceStyle: cur.referenceStyle || 'vancouver', abstractStructured: !!cur.abstractStructured, abstractHeadings: (cur.abstractHeadings || []).join(', '),
      req: new Set(cur.requires || []), url: cur.source?.url || '', checked: cur.source?.checked || '' } };
  enter('profile');
  api.rerender();
}

/** Saves the profile on the page; resolves to whether it was valid. A problem is said on the page, which keeps what was typed. */
function saveProfile(rerender) {
  if (!profile) return false;
  if (project() !== sub?.project) { profile.error = 'The project changed; reopen this profile'; rerender(); return false; }
  const { v, cur } = profile;
  const whole = (value, label, min) => {
    const t = String(value).trim().replace(/[\s,]/g, '');
    if (t === '') return null;
    if (!/^\d+$/.test(t) || Number(t) < min) throw Object.assign(new Error(`${label}: enter a whole number${min ? ` of ${min} or more` : ''}`), { problems: [`${label}: enter a whole number${min ? ` of ${min} or more` : ''}`] });
    return Number(t);
  };
  try {
    const fields = {
      name: v.name.trim(), publisher: v.publisher.trim(),
      ...Object.fromEntries(LIMIT_FIELDS.map(([k, label]) => [k, whole(v[k], label, 1)])),
      abstractStructured: v.abstractStructured, abstractHeadings: v.abstractHeadings, referenceStyle: v.referenceStyle,
      ...(v.kwMin.trim() !== '' || v.kwMax.trim() !== '' ? { keywords: { min: whole(v.kwMin, 'Keywords, min', 0), max: whole(v.kwMax, 'Keywords, max', 1) } } : {}),
      requires: [...v.req], notes: cur.notes || '', source: { url: v.url.trim() || null, checked: v.checked || null },
    };
    setProfile({ id: 'custom', from: 'manual', custom: customProfile(fields) });
    leaveSubmissionPage();
    rerender();
    return true;
  } catch (err) {
    // without a name there is no id either; saying so twice says nothing more
    const problems = (err.problems || [err.message]).filter(x => !(x === 'A profile needs an id' && !v.name.trim()));
    profile.error = problems.join('; ');
    rerender();
    return false;
  }
}

function profilePage() {
  const { v, error, found, picked, status } = profile;
  const num = (key, label) => formField(label, inputOf('data-jp', key, v[key], ' inputmode="numeric"'));
  const journal = fieldsOf([formField('Journal', inputOf('data-jp', 'name', v.name, ' spellcheck="false"'), { span: 2 }),
    formField('Publisher', inputOf('data-jp', 'publisher', v.publisher, ' spellcheck="false"'), { span: 2 }),
    formField('Instructions page', inputOf('data-jp', 'url', v.url, ' type="url" placeholder="https://" spellcheck="false"'), { span: 2 }),
    formField('Read on', dateField('jp-checked', v.checked, 'Read on'))].join(''));
  const limits = fieldsOf([...LIMIT_FIELDS.map(([k, l]) => num(k, l)), num('kwMin', 'Keywords, min'), num('kwMax', 'Keywords, max')].join(''));
  const style = fieldsOf([formField('Reference style', `<select data-jp="referenceStyle">${REFERENCE_STYLES.map(r => optionOf(r, styleName(r), v.referenceStyle)).join('')}</select>`),
    formField('Abstract headings', inputOf('data-jp', 'abstractHeadings', v.abstractHeadings, ' placeholder="Background, Methods, Results, Conclusions" spellcheck="false"'), { span: 2 }),
    checkOf('data-jp-check="abstractStructured"', 'Structured abstract', v.abstractStructured)].join(''));
  const required = `<div class="an-settings"><div class="an-checks" role="group" aria-label="Statements required">${REQUIREMENTS.map(r => checkOf(`data-jp-req="${esc(r.id)}"`, r.label, v.req.has(r.id))).join('')}</div></div>`;
  const list = found?.evidence.length ? uiList({ id: 'jp-found', label: 'Values read', rows: found.evidence.map((e, i) => uiRow({
      check: { checked: picked.has(i), label: `${FIELD_LABEL[e.field] || e.field}: ${shown(e.field, e.value)}`, attrs: { 'data-found': i } },
      main: { html: `<span class="ms-found-field">${esc(FIELD_LABEL[e.field] || e.field)}</span> <span class="ms-found-value">${esc(shown(e.field, e.value))}</span>`,
        detail: [`“${e.sentence}”`, found.conflicts.includes(e.field) ? 'several values' : ''], wrap: true } })) })
    : found ? '<p class="meta" role="status">Nothing read</p>' : '';
  const paste = disclosure({ id: 'jp-paste', title: 'Paste author instructions', open: !profile.cur.name, body: `<div class="ms-paste">
      <textarea id="jp-text" rows="6" aria-label="Author instructions" spellcheck="false">${esc(profile.text)}</textarea>
      ${uiBar({ kind: 'foot', label: 'Read instructions', id: 'jp-read-bar', actions: [{ id: 'jp-read', label: 'Read instructions', icon: 'search' }] })}
      ${list}
      ${found?.evidence.length ? uiBar({ kind: 'foot', label: 'Apply values', id: 'jp-apply-bar', ...(status ? { message: { id: 'jp-status', text: status } } : {}),
        actions: [{ id: 'jp-apply', label: 'Apply checked values', icon: 'check', disabled: !picked.size }] }) : ''}</div>` });
  return `${noteOf('jp-error', error)}${sectionOf('Journal', journal)}${sectionOf('Limits', limits)}${sectionOf('Abstract and references', style)}${sectionOf('Statements required', required)}${paste}`;
}

function wireProfile(el, ctx) {
  const redraw = focusId => { ctx.rerender(); if (focusId) document.getElementById(focusId)?.focus(); };
  const { v } = profile;
  el.querySelectorAll('[data-jp]').forEach(x => { x.oninput = x.onchange = () => { v[x.dataset.jp] = x.value; }; });
  el.querySelectorAll('[data-jp-check]').forEach(x => x.onchange = () => { v[x.dataset.jpCheck] = x.checked; });
  el.querySelectorAll('[data-jp-req]').forEach(x => x.onchange = () => { if (x.checked) v.req.add(x.dataset.jpReq); else v.req.delete(x.dataset.jpReq); });
  wireDateField(el, 'jp-checked', 'Read on');
  el.querySelector('#jp-checked')?.addEventListener('change', e => { v.checked = e.target.value; });
  const text = el.querySelector('#jp-text');
  text.oninput = () => { profile.text = text.value; };
  el.querySelector('#jp-read').onclick = () => {
    profile.found = profileFromText(text.value); profile.text = text.value; profile.status = '';
    // the first value of each field is checked, the later ones of a conflicting field are left to the author
    profile.picked = new Set(profile.found.evidence.map((e, i) => i).filter(i => profile.found.evidence.findIndex(x => x.field === profile.found.evidence[i].field) === i));
    redraw(profile.found.evidence.length ? 'jp-apply' : 'jp-read');
  };
  el.querySelectorAll('[data-found]').forEach(x => x.onchange = () => {
    if (x.checked) profile.picked.add(+x.dataset.found); else profile.picked.delete(+x.dataset.found);
    const apply = el.querySelector('#jp-apply'); if (apply) apply.disabled = !profile.picked.size;
  });
  el.querySelector('#jp-apply')?.addEventListener('click', () => {
    const picked = [...profile.picked].sort((a, b) => a - b).map(i => profile.found.evidence[i]), done = new Set();
    for (const e of picked) {
      if (e.field.startsWith('requires:')) { v.req.add(e.field.slice(9)); continue; }
      if (done.has(e.field)) continue;
      done.add(e.field);
      if (e.field === 'keywords') { v.kwMin = e.value.min == null ? '' : String(e.value.min); v.kwMax = e.value.max == null ? '' : String(e.value.max); }
      else if (e.field === 'abstractStructured') v.abstractStructured = !!e.value;
      else if (e.field === 'abstractHeadings') { v.abstractHeadings = e.value.join(', '); v.abstractStructured = true; }
      else if (e.field === 'url') v.url = String(e.value);
      else if (e.field in v) v[e.field] = typeof e.value === 'number' ? String(e.value) : e.value;
    }
    profile.status = `${plural(picked.length, 'value')} applied; check them, then save`;
    redraw('jp-apply');
  });
}

// ---- declarations -------------------------------------------------------------------------

const ICMJE_SHORT = { c1: 'Design, data or analysis', c2: 'Drafting or critical review', c3: 'Final approval', c4: 'Accountable for the work' };
const DATA_LABEL = { repository: 'In a repository', 'on request': 'On request', 'in paper': 'In the article', 'not available': 'Not available', 'not applicable': 'Not applicable' };
const CONSENT_LABEL = { written: 'Written consent', waived: 'Waived', 'not applicable': 'Not applicable' };
const COI_LABEL = [['', 'Not stated'], ['none', 'None'], ['financial', 'Financial'], ['nonfinancial', 'Non-financial']];
const readDecl = () => normalizeDeclarations(get().declarations, get().paper);
/** Writes one change to the declarations, if the project is still the one the page was opened in. */
const saveDecl = fn => {
  if (!sub || project() !== sub.project) return;
  update(s => { const d = normalizeDeclarations(s.declarations, s.paper); fn(d); s.declarations = d; return s; });
};

/** Opens the declarations page: contributions, interests, funding, ethics, consent, data, AI use and acknowledgements. */
export function openDeclarations(api) { enter('declarations'); api.rerender(); }

function authorBlock(name, i, d) {
  const given = d.contributions[name] || [];
  const coi = d.conflicts.find(c => c?.author === name) || {};
  const ic = d.icmje[name] || {};
  const roles = uiList({ id: `dc-roles-${i}`, label: `Contributions of ${name}`, cols: ['degree'], rows: CREDIT_ROLES.map(r => {
    const g = given.find(x => x?.role === r.id);
    return uiRow({ attrs: { 'data-role-row': r.id }, check: { checked: !!g, label: r.name, attrs: { 'data-role': r.id } }, main: { html: esc(r.name) },
      cells: [{ col: 'degree', kind: 'control', html: `<select data-degree="${esc(r.id)}" aria-label="${esc(`${r.name}, degree`)}"${g ? '' : ' disabled'}>${optionOf('', 'Degree', g?.degree || '')}${CREDIT_DEGREES.map(x => optionOf(x, x[0].toUpperCase() + x.slice(1), g?.degree || '')).join('')}</select>` }] });
  }) });
  const criteria = `<div class="an-settings"><div class="an-checks" role="group" aria-label="${esc(`ICMJE criteria for ${name}`)}">${ICMJE_CRITERIA.map(c => `<label class="cr-check" title="${esc(c.label)}"><input type="checkbox" data-icmje="${esc(c.id)}"${ic[c.id] ? ' checked' : ''}><span>${esc(ICMJE_SHORT[c.id])}</span></label>`).join('')}</div></div>`;
  const interests = fieldsOf([formField('Competing interests', `<select data-coi-kind aria-label="${esc(`Competing interests of ${name}`)}">${COI_LABEL.map(([v, l]) => optionOf(v, l, coi.kind || '')).join('')}</select>`),
    formField('Interests', `<input data-coi-text value="${esc(coi.text || '')}" aria-label="${esc(`Interests of ${name}`)}" autocomplete="off"${coi.kind && coi.kind !== 'none' ? '' : ' disabled'}>`)].join(''));
  return disclosure({ id: `dc-author-${i}`, title: name, count: given.length ? plural(given.length, 'role') : '', open: i === 0, attrs: { 'data-author': i },
    body: `<h3 class="dc-sub">Contributions (CRediT)</h3>${roles}<h3 class="dc-sub">ICMJE criteria</h3>${criteria}<h3 class="dc-sub">Competing interests</h3>${interests}<ul class="dc-issues" data-issues-author="${esc(name)}"></ul>` });
}

function fundBlock(f, i) {
  const head = uiBar({ kind: 'head', label: `Funder ${i + 1}`, id: `dc-fund-head-${i}`, lead: { title: `Funder ${i + 1}`, level: 'h3' }, overflow: [{ id: `dc-fund-del-${i}`, label: 'Remove funder', danger: true }] });
  const fields = fieldsOf([['funder', 'Funder'], ['grant', 'Grant number'], ['recipient', 'Recipient'], ['role', 'Role of the funder']].map(([k, l]) => formField(l, `<input data-f="${k}" value="${esc(f[k] || '')}" autocomplete="off">`)).join(''));
  return `<div class="ms-funder" data-fund="${i}">${head}${fields}</div>`;
}

function declarationsPage() {
  const names = authorNames(), d = readDecl(), e = d.ethics, c = d.consent, da = d.dataAvailability;
  const authors = names.length ? names.map((n, i) => authorBlock(n, i, d)).join('') : `<p class="meta">No authors</p>${uiLink({ id: 'dc-authors-go', label: 'Add authors on the Protocol page', icon: 'open' })}`;
  const funding = `${checkOf('', 'No specific funding', d.noFunding, 'dc-nofund')}${d.noFunding ? '' : `${d.funding.map(fundBlock).join('')}
    ${uiBar({ kind: 'tools', label: 'Funding', id: 'dc-fund-tools', actions: [{ id: 'dc-fund-add', label: 'Add funder', icon: 'plus' }] })}`}`;
  const ethics = fieldsOf([formField('Committee', inputOf('data-ethics', 'committee', e.committee), { span: 2 }), formField('Reference', inputOf('data-ethics', 'reference', e.reference, ' spellcheck="false"')),
    formField('Date', dateField('dc-ethics-date', e.date, 'Ethics approval date')),
    checkOf('data-ethics="waiver"', 'Approval waived', e.waiver)].join('')) + wideOf(formField('Statement', areaOf('data-ethics', 'text', e.text, 2), { span: 2 }));
  const consent = fieldsOf(formField('Consent', `<select data-consent="type">${optionOf('', 'Not stated', c.type)}${CONSENT_TYPES.map(t => optionOf(t, CONSENT_LABEL[t], c.type)).join('')}</select>`))
    + wideOf(formField('Statement', areaOf('data-consent', 'text', c.text, 2), { span: 2 }));
  const repo = da.choice === 'repository' ? '' : ' disabled';
  const data = fieldsOf([formField('Data', `<select data-data="choice">${optionOf('', 'Not stated', da.choice)}${DATA_CHOICES.map(t => optionOf(t, DATA_LABEL[t], da.choice)).join('')}</select>`),
    formField('Repository', inputOf('data-data', 'repository', da.repository, repo)), formField('DOI or accession', inputOf('data-data', 'doi', da.doi, ` spellcheck="false"${repo}`)),
    formField('Conditions', inputOf('data-data', 'conditions', da.conditions))].join('')) + wideOf(formField('Own statement', areaOf('data-data', 'text', da.text, 2), { span: 2 }));
  const other = wideOf([formField('Use of AI', areaOf('data-plain', 'aiUse', d.aiUse, 2), { span: 2 }), formField('Acknowledgements', areaOf('data-plain', 'acknowledgements', d.acknowledgements, 2), { span: 2 })].join(''));
  return `<p class="meta" id="dc-status" role="status"></p><ul class="dc-issues" data-issues="authors"></ul>
    ${sectionOf('Authors', authors)}${sectionOf('Funding', `${funding}<ul class="dc-issues" data-issues="funding"></ul>`)}
    ${sectionOf('Ethics', `${ethics}<ul class="dc-issues" data-issues="ethics"></ul>`)}${sectionOf('Consent', `${consent}<ul class="dc-issues" data-issues="consent"></ul>`)}
    ${sectionOf('Data availability', `${data}<ul class="dc-issues" data-issues="dataAvailability"></ul>`)}${sectionOf('Other', other)}`;
}

function wireDeclarations(el, ctx) {
  const names = authorNames();
  const redraw = focusId => { ctx.rerender(); if (focusId) document.getElementById(focusId)?.focus(); };
  const refresh = () => {
    const issues = validate(readDecl(), paper().authors || [], { researchType: typeId() });
    const li = x => `<li class="dc-issue is-${x.level}">${icon('warn', { size: 12 })}<span>${esc(x.text)}</span></li>`;
    el.querySelectorAll('[data-issues]').forEach(u => { u.innerHTML = issues.filter(x => x.key === u.dataset.issues).map(li).join(''); });
    el.querySelectorAll('[data-issues-author]').forEach(u => { u.innerHTML = issues.filter(x => x.author === u.dataset.issuesAuthor && x.key !== 'authors').map(li).join(''); });
    const errors = issues.filter(x => x.level === 'error').length;
    el.querySelector('#dc-status').textContent = errors ? `${plural(errors, 'statement')} incomplete; placeholders will be inserted` : '';
  };
  refresh();
  let t = 0;
  el.addEventListener('change', refresh);
  el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 250); });
  el.querySelectorAll('[data-author]').forEach(box => {
    const name = names[+box.dataset.author];
    const roles = () => saveDecl(d => {
      d.contributions[name] = [...box.querySelectorAll('[data-role]:checked')].map(x => {
        const degree = box.querySelector(`[data-degree="${x.dataset.role}"]`).value;
        return degree ? { role: x.dataset.role, degree } : { role: x.dataset.role };
      });
      if (!d.contributions[name].length) delete d.contributions[name];
    });
    box.querySelectorAll('[data-role]').forEach(x => x.onchange = () => { box.querySelector(`[data-degree="${x.dataset.role}"]`).disabled = !x.checked; roles(); });
    box.querySelectorAll('[data-degree]').forEach(x => x.onchange = roles);
    box.querySelectorAll('[data-icmje]').forEach(x => x.onchange = () => saveDecl(d => { d.icmje[name] = { ...(d.icmje[name] || {}), [x.dataset.icmje]: x.checked }; }));
    const kind = box.querySelector('[data-coi-kind]'), text = box.querySelector('[data-coi-text]');
    const coi = () => saveDecl(d => {
      d.conflicts = d.conflicts.filter(x => x?.author !== name);
      if (kind.value) d.conflicts.push({ author: name, kind: kind.value, text: kind.value === 'none' ? '' : text.value });
    });
    kind.onchange = () => { text.disabled = !kind.value || kind.value === 'none'; coi(); };
    text.oninput = coi;
  });
  const nofund = el.querySelector('#dc-nofund');
  nofund.onchange = () => { saveDecl(d => { d.noFunding = nofund.checked; }); redraw('dc-nofund'); };
  el.querySelectorAll('[data-fund]').forEach(row => {
    const i = +row.dataset.fund;
    row.querySelectorAll('[data-f]').forEach(inp => inp.oninput = () => saveDecl(d => { d.funding[i] = { ...(d.funding[i] || {}), [inp.dataset.f]: inp.value }; }));
  });
  el.querySelectorAll('[id^="dc-fund-del-"]').forEach(b => b.addEventListener('click', () => { saveDecl(d => { d.funding.splice(+b.id.slice('dc-fund-del-'.length), 1); }); redraw('dc-fund-add'); }));
  el.querySelector('#dc-fund-add')?.addEventListener('click', () => {
    saveDecl(d => { d.funding.push({ funder: '', grant: '', recipient: '', role: '' }); });
    ctx.rerender(); [...document.querySelectorAll('[data-fund]')].at(-1)?.querySelector('[data-f]')?.focus();
  });
  const field = (attr, key) => el.querySelectorAll(`[${attr}]`).forEach(x => {
    const k = x.getAttribute(attr), set = () => saveDecl(d => { d[key][k] = x.type === 'checkbox' ? x.checked : x.value; });
    x.oninput = set; x.onchange = set;
  });
  field('data-ethics', 'ethics'); field('data-consent', 'consent'); field('data-data', 'dataAvailability');
  el.querySelector('#dc-authors-go')?.addEventListener('click', () => ctx.go('protocol'));
  wireDateField(el, 'dc-ethics-date', 'Ethics approval date');
  el.querySelector('#dc-ethics-date')?.addEventListener('change', e => saveDecl(d => { d.ethics.date = e.target.value; }));
  el.querySelector('[data-data="choice"]').addEventListener('change', ev => el.querySelectorAll('[data-data="repository"], [data-data="doi"]').forEach(x => { x.disabled = ev.target.value !== 'repository'; }));
  el.querySelectorAll('[data-plain]').forEach(x => x.oninput = () => saveDecl(d => { d[x.dataset.plain] = x.value; }));
}


// ---- exports ------------------------------------------------------------------------------

/** The title page as .docx: title, authors and affiliations, correspondence, counts and keywords. */
export async function exportTitlePage(status) {
  const s = get(), blocks = s.manuscript?.blocks || [], assets = s.manuscript?.assets || [];
  const profile = activeProfile(s.journalProfile);
  const { blocks: out, warnings } = titlePage({ paper: s.paper || {}, authors: titlePageAuthors(s.paper), keywords: keywordList(blocks),
    counts: titlePageCounts(blocks, assets, s.manuscript || {}), ...(profile?.runningTitleChars ? { runningTitleLimit: profile.runningTitleChars } : {}) });
  await saveFile(await plainDocx(out), `${fileBase()}-title-page.docx`, DOCX);
  status?.(warnings.length ? `Title page · ${warnings.map(w => w.text).join('; ')}` : 'Title page saved');
}

/** The cover letter as .docx, from the project's title, journal, authors and declarations. */
export async function exportCoverLetter(status) {
  const s = get();
  const out = coverLetter({ paper: s.paper || {}, authors: titlePageAuthors(s.paper), journal: targetJournal(s) || undefined,
    researchType: typeId(), declarations: normalizeDeclarations(s.declarations, s.paper) });
  await saveFile(await plainDocx(out), `${fileBase()}-cover-letter.docx`, DOCX);
  status?.('Cover letter saved; replace the bracketed placeholders');
}

/** A blinded copy of the manuscript, after the author has seen what it could not blind. */
export async function exportBlinded(status, writeManuscript, library = []) {
  const s = get();
  const { blocks, flags } = blindedCopy(s.manuscript?.blocks || [], { ...blindingInputs(s.paper), library });
  const go = await planDialog({ id: 'blinded-manuscript', title: 'Blinded manuscript', detail: flags.length ? `${plural(flags.length, 'passage')} to check` : 'Nothing to check', confirm: 'Export',
    body: flags.length ? `<table class="ask-table"><tbody>${flags.map(f => `<tr><td>${esc(f.text)}</td><td class="meta">${esc(f.reason)}</td></tr>`).join('')}</tbody></table>` : '' });
  if (!go) return;
  await writeManuscript({ blocks, suffix: '-blinded', comments: {} });
  status?.(`Blinded manuscript saved${flags.length ? ` · ${flags.length} passages to check` : ''}`);
}

// ---- response to reviewers ----------------------------------------------------------------

let roundPick;       // undefined: the latest round (chosen when the page draws); null: a new round; else a round's id
let resp = { journal: null, manuscriptId: '', letter: '', onRound: null, note: '', focusFirst: false };
const roundsNow = () => normalizeReviewRounds(get().reviewRounds);
const saveRounds = fn => {
  if (!sub || project() !== sub.project) return;
  update(s => { const r = normalizeReviewRounds(s.reviewRounds); fn(r); s.reviewRounds = r; return s; });
};
const isoDay = at => (at || '').slice(0, 10);
const roundNow = () => roundsNow().find(r => r.id === roundPick) || null;
const roundOptions = () => [...roundsNow().map((r, i) => [r.id, `Round ${i + 1}${r.at ? ` · ${isoDay(r.at)}` : ''}`]), ['', 'New round']];
/** The round the page shows: the one chosen, else the latest; a new round is a choice of its own (null). */
function settleRound() {
  if (roundPick === null) return;
  if (roundPick === undefined || !roundsNow().some(r => r.id === roundPick)) roundPick = roundsNow().at(-1)?.id ?? null;
}

/**
 * Decision letters read into comments, each with its response, change and location; exported as a letter. The submission tracker
 * (views/submissions.mjs) opens it on a new round with the letter it holds (`journal`, `manuscriptId`, `letter`), and `onRound(id)` hears
 * the round the letter was read into, so the tracker links it; opened with nothing it shows the latest round. `go` is the shell's
 * navigation (ctx.go): the page is a sub-page of the Manuscript.
 */
export function openResponses({ journal = null, manuscriptId = '', letter = '', onRound = null } = {}, go = null) {
  if (letter) roundPick = null;   // a letter to read starts a new round
  resp = { journal, manuscriptId, letter, onRound, note: '', focusFirst: false };
  enter('responses');
  go?.('manuscript');
}

function readComments(rerender) {
  const round = roundFromLetter(resp.letter, { journal: (resp.journal ?? targetJournal(get()) ?? '').trim(), manuscriptId: resp.manuscriptId.trim() });
  if (!round.points.length) { resp.note = 'No comments found'; rerender(); return; }
  saveRounds(rs => rs.push(round));
  roundPick = round.id;
  resp.onRound?.(round.id);
  resp.onRound = null;
  resp.note = `${plural(round.points.length, 'comment')} read`;
  resp.focusFirst = true;
  rerender();
}
async function deleteRound(rerender) {
  if (!roundPick || !await confirmAsk('Delete this round?', { confirm: 'Delete', danger: true })) return;
  const id = roundPick;
  saveRounds(rs => rs.splice(rs.findIndex(x => x.id === id), 1));
  roundPick = undefined; resp.note = '';
  rerender();
}
async function exportResponse(rerender) {
  const r = roundNow(); if (!r) return;
  const out = responseLetter(r.points, { title: paper().title || '', journal: r.journal, manuscriptId: r.manuscriptId });
  await saveFile(await plainDocx(out), `${fileBase()}-response-to-reviewers.docx`, DOCX);
  resp.note = 'Response letter saved';
  rerender();
}
const answeredText = r => `${r.points.filter(p => p.response.trim()).length} of ${r.points.length} answered`;

function responsesPage() {
  const r = roundNow(), label = roundOptions().find(o => o[0] === (roundPick || ''))?.[1] || 'New round';
  const tools = uiBar({ kind: 'tools', label: 'Round', id: 'rr-tools', actions: [{ picker: true, id: 'rr-round', label: 'Round', value: label, valueCh: 20, options: roundOptions() }] });
  if (!r) {
    const s = get();
    return `${tools}${resp.note ? `<p class="meta" id="rr-note" role="status">${esc(resp.note)}</p>` : ''}
      ${fieldsOf([formField('Journal', `<input id="rr-journal" value="${esc(resp.journal ?? (targetJournal(s) || ''))}" autocomplete="off">`), formField('Manuscript ID', `<input id="rr-msid" value="${esc(resp.manuscriptId)}" spellcheck="false" autocomplete="off">`),
        ].join(''))}${wideOf(formField('Decision letter', `<textarea id="rr-letter" rows="12" spellcheck="false">${esc(resp.letter)}</textarea>`, { span: 2 }))}`;
  }
  const by = [...new Set(r.points.map(p => p.reviewer))];
  const status = uiStatusLine({ id: 'rr-status-line', label: 'Responses', parts: [{ id: 'rr-status', text: resp.note || answeredText(r), reserve: '999 of 999 answered', drop: 0 }] });
  const header = fieldsOf([formField('Journal', inputOf('data-round', 'journal', r.journal)), formField('Manuscript ID', inputOf('data-round', 'manuscriptId', r.manuscriptId, ' spellcheck="false"'))].join(''));
  return `${tools}${status}${header}${by.map(who => sectionOf(who, r.points.filter(p => p.reviewer === who).map(pointHtml).join(''))).join('')}`;
}
const pointHtml = p => {
  const head = `<h3>Comment ${p.n}${p.section ? `<span class="meta">${esc(p.section)}</span>` : ''}</h3>`;
  const fields = wideOf(formField('Response', `<textarea data-k="response" rows="3">${esc(p.response)}</textarea>`, { span: 2 })) + fieldsOf([
    formField('Change', inputOf('data-k', 'change', p.change), { span: 2 }), formField('Location', inputOf('data-k', 'location', p.location, ' placeholder="Page, line or section"')),
    formField('Status', `<select data-k="status">${optionOf('done', 'Made', p.status)}${optionOf('proposed', 'Proposed', p.status)}</select>`)].join(''));
  return `<div class="rv-point" data-p="${esc(p.id)}">${head}<blockquote class="rv-comment">${esc(p.text)}</blockquote>${fields}</div>`;
};

function wireResponses(el, ctx) {
  const redraw = focusId => { ctx.rerender(); if (focusId) document.getElementById(focusId)?.focus(); };
  const chooseRound = id => { roundPick = id || null; resp.note = ''; redraw('rr-round'); };
  const sel = el.querySelector('#rr-round');
  sel.onclick = () => showMenu(sel, roundOptions().map(([id, text]) => ({ label: text, checked: id === (roundPick || ''), run: () => chooseRound(id) })), { minWidth: 220 });
  sel.addEventListener('ui-pick', e => chooseRound(e.detail.value));
  const letter = el.querySelector('#rr-letter');
  if (letter) {
    letter.oninput = () => { resp.letter = letter.value; };
    el.querySelector('#rr-journal').oninput = e => { resp.journal = e.target.value; };
    el.querySelector('#rr-msid').oninput = e => { resp.manuscriptId = e.target.value; };
    queueMicrotask(() => { if (!el.contains(document.activeElement) || document.activeElement === document.body) letter.focus(); });
    return;
  }
  const r = roundNow();
  el.querySelectorAll('[data-round]').forEach(x => x.oninput = () => saveRounds(rs => { const q = rs.find(y => y.id === r.id); if (q) q[x.dataset.round] = x.value; }));
  const answered = () => { const now = roundNow(); const part = el.querySelector('#rr-status'); if (now && part) part.textContent = answeredText(now); };
  el.querySelectorAll('[data-p]').forEach(box => box.querySelectorAll('[data-k]').forEach(x => {
    const set = () => { saveRounds(rs => { const pt = rs.find(y => y.id === r.id)?.points.find(y => y.id === box.dataset.p); if (pt) pt[x.dataset.k] = x.value; }); resp.note = ''; answered(); };
    x.oninput = set; x.onchange = set;
  }));
  if (resp.focusFirst) { resp.focusFirst = false; el.querySelector('[data-p] textarea')?.focus(); }
}

// ---- the sub-page in the title bar and under it ----------------------------------------------------------------------------------

/** What the document may do once the sub-page is left: the commit that changes it leaves the page first, so the document is what the repaint draws. */
const pageApi = api => ({ ...api, commit: (mutate, sel) => { const kept = sub; sub = null; const ok = api.commit(mutate, sel); if (!ok) sub = kept; return ok; } });

/**
 * The title bar while a sub-page is open (null when none): Back to the Manuscript, the page's name and its one command. `rerender` repaints
 * the Manuscript; `api` is what the submission tools may do to the document (views/manuscript.mjs submissionApi).
 */
export function submissionPageSpec(rerender, api = null) {
  const kind = submissionPageOpen();
  if (!kind) return null;
  const back = { label: 'Back to Manuscript', run: () => { leaveSubmissionPage(); rerender(); } };
  if (kind === 'profile') return { title: 'Journal profile', back, actions: [{ id: 'jp-save', label: 'Save profile', role: 'primary', run: () => saveProfile(rerender) }], overflow: [] };
  if (kind === 'declarations') return { title: 'Declarations', back, actions: [{ id: 'dc-insert', label: 'Insert statements', role: 'primary', run: () => api && insertDeclarationStatements(pageApi(api)) }], overflow: [] };
  settleRound();
  const open = !!roundNow();
  return { title: 'Responses', back,
    actions: [open ? { id: 'rr-export', label: 'Export', icon: 'export', role: 'primary', run: () => exportResponse(rerender) }
      : { id: 'rr-read', label: 'Read comments', icon: 'file-plus', role: 'primary', run: () => readComments(rerender) }],
    overflow: open ? [{ id: 'rr-delete', label: 'Delete round', danger: true, run: () => deleteRound(rerender) }] : [] };
}

/** The sub-page in view, under its title bar. */
export function renderSubmissionPage(el, ctx) {
  const kind = submissionPageOpen();
  if (kind === 'profile' && !profile) editCustomProfile({ rerender: () => {} });
  settleRound();
  const body = kind === 'profile' ? profilePage() : kind === 'declarations' ? declarationsPage() : responsesPage();
  el.innerHTML = `<div class="panel ms-subpage" id="ms-subpage" data-ms-sub="${kind}"><div class="panel-body">${body}</div></div>`;
  const root = el.querySelector('#ms-subpage');
  if (kind === 'profile') wireProfile(root, ctx);
  else if (kind === 'declarations') wireDeclarations(root, ctx);
  else wireResponses(root, ctx);
}

// Submission: each journal the manuscript went to, what it decided and when, and the next step (scratchpad plan SUBMISSIONS.md;
// the model is lib/submissions.mjs). One page after Reporting: the title bar says where the paper stands, then one row per journal,
// newest first, with the open one's record and its history beneath it (editorRows: one editor at a time).
//
// The page's head is the title bar (page()): Submission, where the paper stands (the current journal's status word), Add submission; More:
// Plan next journal, Response to reviewers….
// A row's own commands are its record's foot: Remove submission, Choose next journal, Read comments, Record outcome. Nothing here is
// written without a person's dialog: no web lookups, no status changed by time, no copying of files (a file is a reference into the
// project folder). A decision word is text, never a colour. The chase and the revision become real tasks (syncTasks), so the Tasks page,
// the Overview and All projects show them with no change of their own.
import { REGISTRY } from './registry.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { formDialog, confirmAsk } from '../lib/dialog.mjs';
import { dateField, wireDateField, dateValue } from '../lib/date-picker.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { editorRows, wireEditorRows, formField } from '../lib/ui-components.mjs';
import { manuscriptChoices } from '../lib/submission-files.mjs';
import { journalButton, wireJournalButton, chooseJournal } from '../lib/journal-picker.mjs';
import { targetJournal, setJournals, otherJournals } from '../lib/workflow.mjs';
import { journalSnapshot, targetChangeNotice } from '../lib/journal-context.mjs';
import { day, plural } from '../lib/dates.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { stageOfFolder, ARCHIVE } from '../lib/folder-map.mjs';
import { openResponses } from './manuscript-submission.mjs';
import {
  KINDS, ENDED, normaliseSubmissions, ordered, current, statusOf, wordOf, summaryLine, elapsedDays, openRevision, syncTasks,
  addAttempt, addEvent, patchAttempt, patchEvent, removeEvent, removeAttempt, proposalFor, applyProposal,
} from '../lib/submissions.mjs';
import { normaliseNotes } from '../lib/note-templates.mjs';

export const meta = { title: 'Submission', icon: 'send' };
export const count = (...a) => REGISTRY.submissions.count(...a);

const today = () => dateValue(new Date());
const WORD = Object.fromEntries(KINDS);
let open = null;         // the attempt whose record is open
let listPage;            // the list's page while nothing is open
let pending = '';        // a part asked for by another page ('read': the decision letter not yet read)
let shown = null;        // { el, ctx } of the last render, for the title bar's actions

/** Another page asks for a part of this one: 'read' opens the letter not yet read into comments. */
export function showPart(part) { pending = String(part || ''); }

/** What the assistant is told about this page: where the paper stands and the journals so far. */
export function assistContext() {
  const s = get(), list = ordered(s.submissions);
  return [`Submission: ${summaryLine(list, today()) || 'not submitted'}`,
    ...list.slice(0, 6).map(a => `${a.journal.label || 'Untitled journal'}: ${statusOf(a).word || 'no events'}${statusOf(a).at ? ` (${statusOf(a).at})` : ''}`)].join('\n');
}

// ---- writing ----------------------------------------------------------------------------------------------------------------------
/** Every change of the list goes through here: the tasks it keeps follow in the same write (lib/submissions.mjs syncTasks). */
function commit(fn) {
  const gen = projectGeneration();
  update(s => {
    if (gen !== projectGeneration()) return s;
    const next = fn(normaliseSubmissions(s.submissions), s);
    const synced = syncTasks(next, s.todos);
    s.submissions = synced.submissions; s.todos = synced.todos;
    return s;
  });
}
const attemptOf = id => normaliseSubmissions(get().submissions).find(a => a.id === id) || null;

// ---- the project folder's files a submission can point at ---------------------------------------------------------------------
let files = { gen: -1, folder: false, loading: null, manuscripts: [], letters: [] };
const KEEP = /\.(docx|pdf|txt)$/i;
/** Reads the folder's top level, its Manuscript folder and their Archive folders once per project; a later call waits for the same read. */
function loadFiles() {
  const gen = projectGeneration(), f = activeFolder();
  if (files.gen === gen && (files.loading || !f || files.folder)) return files.loading || Promise.resolve(files);
  files = { gen, folder: !!f, loading: null, manuscripts: [], letters: [] };
  if (!f) return Promise.resolve(files);
  const read = async () => {
    const entries = [], archived = [];
    const take = (list, into) => { for (const e of list) if (!e.dir && KEEP.test(e.name) && !e.name.startsWith('.') && !e.name.startsWith('~$')) into.push(e); };
    const top = await f.list('').catch(() => []);
    take(top, entries);
    for (const d of top.filter(e => e.dir)) {
      if (stageOfFolder(d.name) === 'archive') take(await f.list(d.rel).catch(() => []), archived);
      else if (stageOfFolder(d.name) === 'manuscript') {
        const inner = await f.list(d.rel).catch(() => []);
        take(inner, entries);
        for (const a of inner.filter(e => e.dir && (stageOfFolder(e.name) === 'archive' || e.name === ARCHIVE))) take(await f.list(a.rel).catch(() => []), archived);
      }
    }
    if (gen !== projectGeneration()) return files;
    files = { gen, folder: true, loading: null, manuscripts: manuscriptChoices(entries, archived), letters: manuscriptChoices(entries, archived, { exts: ['docx', 'pdf', 'txt'] }) };
    return files;
  };
  files.loading = read();
  return files.loading;
}

/** A select of the folder's files: None first; a chosen file no longer there keeps its name, marked. */
function fileSelect(id, choices, chosen, attrs = '') {
  const known = chosen && choices.some(c => c.rel === chosen.rel);
  const opts = [['', files.folder ? 'None' : 'No project folder'], ...(chosen && !known ? [[chosen.rel, files.folder ? `${chosen.name} · not in the folder` : chosen.name]] : []),
    ...choices.map(c => [c.rel, c.archived ? `${c.name} · Archive` : c.name])];
  return `<select id="${esc(id)}"${attrs}${files.folder ? '' : ' disabled'}>${opts.map(([v, t]) => `<option value="${esc(v)}"${(chosen?.rel || '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
}
const refOf = (rel, choices, before) => {
  if (!rel) return null;
  const c = choices.find(x => x.rel === rel);
  return c ? { rel: c.rel, name: c.name } : before?.rel === rel ? before : { rel, name: rel.slice(rel.lastIndexOf('/') + 1) };
};

// ---- the page ---------------------------------------------------------------------------------------------------------------------
const label = a => a.journal.label || 'Untitled journal';
/** The row's one detail line: the manuscript id, the file sent, the chase day. */
const lineOf = (a, now) => [a.manuscriptId, a.file?.name, a.chaseOn && !ENDED.has(statusOf(a).kind) ? `chase ${day(a.chaseOn, now)}` : ''].filter(Boolean).join(' · ');
const sentEvent = a => a.events.find(e => e.kind === 'submitted') || null;
const letterToRead = a => [...a.events].reverse().find(e => (e.kind === 'revise' || e.kind === 'rejected' || e.kind === 'accepted') && e.letter?.trim() && !e.roundId) || null;

function historyRow(a, e, now) {
  const detail = [e.note, e.due && e.kind === 'revise' ? `Response due ${day(e.due, now)}` : '', e.doi, e.letter?.trim() ? 'Letter' : '', e.file?.name].filter(Boolean).map(esc);
  return uiRow({ attrs: { 'data-sb-event': e.id },
    main: { html: `<span class="sb-kind">${esc(wordOf(e))}</span>`, detail },
    cells: [{ col: 'when', kind: 'text', ch: 12, html: esc(day(e.at, now) || 'No date') }],
    end: uiRowEnd({ more: { label: `More for ${wordOf(e)}${e.at ? `, ${day(e.at, now)}` : ''}`, attrs: { 'data-sb-ev-more': e.id } } }) });
}

function editor(a, now) {
  const sent = sentEvent(a), st = statusOf(a), n = elapsedDays(a, now);
  const field = (lbl, f, value, extra = '') => formField(lbl, `<input id="sb-f-${f}" data-f="${f}" value="${esc(value)}" spellcheck="false" autocomplete="off"${extra}>`);
  return `<div class="sb-record" data-sb-record="${esc(a.id)}">
    <div class="an-settings sb-fields">
      ${formField('Journal', journalButton('sb-journal', label(a), 'Journal'))}
      ${field('Manuscript ID', 'manuscriptId', a.manuscriptId)}
      ${formField('Submitted on', dateField('sb-sent', sent?.at || '', 'Submitted on', 'Not sent'))}
      ${field('System', 'system', a.system, ' placeholder="Editorial Manager, ScholarOne…"')}
      ${formField('Manuscript sent', fileSelect('sb-file', files.manuscripts, a.file, ' data-file="file"'))}
      ${formField('Cover letter', fileSelect('sb-cover', files.manuscripts, a.coverLetter, ' data-file="coverLetter"'))}
      ${formField('Chase on', dateField('sb-chase', a.chaseOn, 'Chase on', 'No date'))}
      ${field('Notes', 'notes', a.notes)}
    </div>
    <section class="sb-history" aria-label="History">
      ${uiBar({ kind: 'head', label: 'History', id: 'sb-history-head', lead: { title: 'History', level: 'h3' }, message: { id: 'sb-elapsed', text: n == null ? '' : `${st.word} for ${plural(n, 'day')}` } })}
      ${uiList({ id: 'sb-history', label: `History of the submission to ${label(a)}`, cols: ['when'], rows: a.events.map(e => historyRow(a, e, now)), empty: '<p class="meta">No events</p>' })}
    </section>
    ${uiBar({ kind: 'foot', label: `Submission to ${label(a)}`, id: 'sb-foot', budget: { n: 4, reason: 'the destructive start and three stage actions' },
      start: [{ id: 'sb-remove', label: 'Remove submission', role: 'destructive' }],
      actions: [{ id: 'sb-next', label: 'Choose next journal', role: 'quiet', disabled: !ENDED.has(st.kind) },
        { id: 'sb-read', label: 'Read comments', role: 'secondary', disabled: !letterToRead(a) },
        { id: 'sb-outcome', label: 'Record outcome', icon: 'plus', role: 'primary', menu: true }] })}
  </div>`;
}

/** The title bar of the page: where the paper stands is the current journal's status word; the journal, its day and the rest are its row's. */
export function pageSpec({ status = '' } = {}, { add = () => {}, plan = () => {}, responses = () => {}, email = () => {} } = {}) {
  return { title: 'Submission', ...(status ? { status: { text: status, ch: 24 } } : {}),
    actions: [{ id: 'sb-add', label: 'Add submission', icon: 'plus', run: add }],
    overflow: [{ id: 'sb-email', label: 'Read journal email…', run: email }, { id: 'sb-plan', label: 'Plan next journal', run: plan }, { id: 'sb-responses', label: 'Response to reviewers…', run: responses }] };
}
/** Where the paper stands, short enough for the bar (24 characters): the status word, the revision's due day or the days waited. */
function standing(list, now) {
  const a = current(list), st = a ? statusOf(a) : null;
  if (!st?.kind) return '';
  const due = st.kind === 'revise' ? openRevision(a)?.due : '', n = ENDED.has(st.kind) || st.kind === 'revise' || st.kind === 'accepted' || st.kind === 'planned' || st.kind === 'published' ? null : elapsedDays(a, now);
  return due ? `Revision due ${day(due, now)}` : n == null ? st.word : `${st.word} · ${n} d`;
}
export function page() {
  return pageSpec({ status: standing(get().submissions, today()) }, { add: () => addSubmission(), plan: () => planNext(), responses: () => openResponses({}, k => shown?.ctx.go(k)), email: () => readEmail() });
}

export function render(el, ctx) {
  shown = { el, ctx };
  const s = get(), now = today();
  // a chase task ticked on the Tasks page clears its day here (lib/submissions.mjs syncTasks); written only when something changed
  const synced = syncTasks(s.submissions, s.todos);
  if (JSON.stringify(synced.submissions) !== JSON.stringify(normaliseSubmissions(s.submissions)) || synced.todos.length !== (s.todos || []).length) commit(list => list);
  const list = ordered(get().submissions);
  if (open && !list.some(a => a.id === open)) open = null;
  if (pending === 'read') { const a = list.find(x => letterToRead(x)); if (a) open = a.id; }
  const target = targetJournal(s);
  const rows = editorRows({ id: 'sb-list', label: 'Submissions', items: list, key: a => a.id, title: label, noun: 'submissions', selected: open, page: open ? undefined : listPage,
    columns: [
      { head: 'Journal', cell: a => `<span class="sb-journal">${esc(label(a))}</span><span class="meta sb-line" id="sb-line-${esc(a.id)}">${esc(lineOf(a, now))}</span>` },
      // the status over its date, as the journal over its line: two columns, so a phone shows both without scrolling the table sideways
      { head: 'Status', cell: a => `<span class="sb-status">${esc(statusOf(a).word)}</span><span class="sb-when">${esc(day(statusOf(a).at, now))}</span>` }],
    editor: a => editor(a, now) });
  el.innerHTML = list.length ? `<section class="sb-page" aria-label="Submission">
      ${rows}
    </section>` : `<section class="sb-page sb-empty" aria-label="Submission">
      ${target ? emptyState({ icon: 'send', title: 'Not submitted yet', detail: `Target journal: ${target}`, actions: [{ id: 'sb-mark', label: 'Mark submitted', primary: true }] })
        : emptyState({ icon: 'send', title: 'No submission yet', help: true, detail: 'Each journal, its decision and the next step.' })}
    </section>`;
  el.querySelector('#sb-mark')?.addEventListener('click', () => addSubmission());
  wireEditorRows(el, 'sb-list', { onSelect: k => { open = k; render(el, ctx); }, onPage: n => { listPage = n; open = null; render(el, ctx); } });
  const a = open ? attemptOf(open) : null;
  if (a) wireRecord(el, ctx, a);
  if (files.gen !== projectGeneration() || files.loading) loadFiles().then(() => { if (shown?.el === el && el.isConnected && a) render(el, ctx); });
  if (pending === 'read') { pending = ''; if (a && letterToRead(a)) readComments(a); }
}

/** Repaints the page and its title bar (whose status follows the list) as it was asked last, keeping focus on the control with the same id. */
function redraw() {
  if (!shown?.el?.isConnected) return;
  const id = document.activeElement?.id;
  shown.ctx.rerender();
  if (id) document.querySelector(`#view [id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
/** After a field's edit only the row's line changes (a field never changes the status word): the form is not drawn again, so focus stays. */
function readouts(el, id) {
  const a = attemptOf(id);
  if (!a) return;
  const line = el.querySelector(`[id="sb-line-${CSS.escape(id)}"]`);
  if (line) line.textContent = lineOf(a, today());
}

function wireRecord(el, ctx, a) {
  const id = a.id;
  wireJournalButton(el.querySelector('#sb-journal'), () => attemptOf(id)?.journal.label || '', choice => { commit(l => patchAttempt(l, id, { journal: { id: choice.id || '', label: choice.label } })); redraw(); });
  el.querySelectorAll('.sb-record [data-f]').forEach(input => input.addEventListener('change', () => {
    commit(l => patchAttempt(l, id, { [input.dataset.f]: input.value.trim() }));
    readouts(el, id);
  }));
  el.querySelectorAll('.sb-record [data-file]').forEach(sel => sel.addEventListener('change', () => {
    const key = sel.dataset.file;
    commit(l => patchAttempt(l, id, { [key]: refOf(sel.value, files.manuscripts, attemptOf(id)?.[key]) }));
    readouts(el, id);
  }));
  wireDateField(el, 'sb-sent', 'Submitted on');
  el.querySelector('#sb-sent')?.addEventListener('change', e => {
    const at = e.target.value, sent = sentEvent(attemptOf(id));
    commit(l => sent ? patchEvent(l, id, sent.id, { at }) : at ? addEvent(l, id, { kind: 'submitted', at }) : l);
    redraw();
  });
  wireDateField(el, 'sb-chase', 'Chase on');
  el.querySelector('#sb-chase')?.addEventListener('change', e => {
    const at = e.target.value;
    // a new day after the earlier chase task was ticked done is a new chase: the done task stays done, a new one is made
    commit((l, s) => { const before = attemptOf(id); const done = (s.todos || []).some(t => t.id === before?.chaseTaskId && t.done);
      return patchAttempt(l, id, { chaseOn: at, ...(done && at ? { chaseTaskId: '' } : {}) }); });
    readouts(el, id);
  });
  el.querySelector('#sb-remove').onclick = () => removeSubmission(id);
  el.querySelector('#sb-next').onclick = () => planNext();
  el.querySelector('#sb-read').onclick = () => { const x = attemptOf(id); if (x) readComments(x); };
  const outcome = el.querySelector('#sb-outcome');
  outcome.onclick = () => showMenu(outcome, outcomeMenu(attemptOf(id)), { align: 'end' });
  el.querySelectorAll('[data-sb-ev-more]').forEach(b => b.onclick = () => {
    const x = attemptOf(id), e = x?.events.find(y => y.id === b.dataset.sbEvMore);
    if (!e) return;
    showMenu(b, [
      { label: 'Edit…', run: () => recordOutcome(x, e.kind, e) },
      '-',
      { label: 'Remove', danger: true, run: () => { commit(l => removeEvent(l, id, e.id)); redraw(); } },
    ], { align: 'end' });
  });
}

// ---- commands ---------------------------------------------------------------------------------------------------------------------
const OUTCOMES = [['revise', 'Revision requested…'], ['revised', 'Revision sent…'], '-', ['accepted', 'Accepted…'], ['rejected', 'Rejected…'],
  ['desk', 'Rejected without review…'], ['withdrawn', 'Withdrawn…'], '-', ['published', 'Published…']];
function outcomeMenu(a) {
  if (!a) return [];
  const planned = statusOf(a).kind === 'planned';
  return [...(planned ? [{ label: 'Submitted…', run: () => recordOutcome(a, 'submitted') }, '-'] : []),
    ...OUTCOMES.map(o => o === '-' ? o : { label: o[1], run: () => recordOutcome(a, o[0]) })];
}

/** Makes the chosen journal the target, keeping the other journals after it. */
const makeTarget = (s, choice) => setJournals(s, [choice.label, ...[targetJournal(s), ...otherJournals(s)].filter(j => j && j !== choice.label)], choice);

async function addSubmission() {
  await loadFiles();
  const s = get(), target = targetJournal(s);
  let journal = target ? { id: '', label: target } : null;
  const go = await formDialog({ id: 'submission-add', title: 'Add submission', tier: 'M', confirm: 'Add',
    body: `<div class="an-settings">
        ${formField('Journal', journalButton('sb-a-journal', journal?.label || '', 'Journal'))}
        ${formField('Submitted on', dateField('sb-a-at', today(), 'Submitted on'))}
        ${formField('Manuscript sent', fileSelect('sb-a-file', files.manuscripts, files.manuscripts[0] || null), { span: 2 })}
      </div>`,
    onMount: d => {
      wireDateField(d, 'sb-a-at', 'Submitted on');
      wireJournalButton(d.querySelector('#sb-a-journal'), () => journal?.label || '', choice => { journal = { id: choice.id || '', label: choice.label }; });
    },
    submit: (form, d) => {
      if (!journal) { d.querySelector('#sb-a-journal')?.focus(); return undefined; }
      return { at: d.querySelector('#sb-a-at')?.value || '', file: d.querySelector('#sb-a-file')?.value || '' };
    } });
  if (!go || !journal) return;
  const before = journalSnapshot(get());
  let made = null;
  commit((l, st) => {
    const next = addAttempt(l, { journal, at: go.at, file: refOf(go.file, files.manuscripts, null) });
    made = next.at(-1).id;
    if (!targetJournal(st)) makeTarget(st, journal);   // the first journal named is the target; later ones are for the person to promote
    return next;
  });
  open = made; redraw();
  sayTarget(before);
}
/**
 * Read journal email…: the email a journal sent (pasted) becomes an event on its submission, found by its manuscript number or journal,
 * or a new submission; the manuscript number and editorial system are filled where the submission has none (lib/journal-email.mjs).
 * The same check as the assistant's proposals (proposalFor) decides what may be written.
 */
async function readEmail() {
  let got = null;
  const ok = await formDialog({ id: 'submission-email', title: 'Read journal email', tier: 'M', confirm: 'Record',
    body: `${formField('Email', '<textarea id="sb-email-text" rows="12" aria-label="Email"></textarea>')}<p class="note" id="sb-email-error" role="alert" hidden></p>`,
    submit: async (form, d) => {
      const fail = t => { const e = d.querySelector('#sb-email-error'); e.textContent = t; e.hidden = !t; return undefined; };
      const text = d.querySelector('#sb-email-text').value;
      if (!text.trim()) return fail('Paste the email');
      const { emailProposal } = await import('../lib/journal-email.mjs');
      const p = emailProposal(text, normaliseSubmissions(get().submissions), { today: today() });
      if (p.error) return fail(p.error);
      const v = proposalFor(p.payload, get().submissions, today());
      if (v.error) return fail(v.error);
      got = { v, read: p.read }; return true;
    } });
  if (!ok || !got) return;
  const { v, read } = got;
  commit(l => {
    let next = applyProposal(l, v.data);
    const a = v.data.attemptId ? next.find(x => x.id === v.data.attemptId) : next.at(-1), patch = {};
    if (a && !a.manuscriptId && read.manuscriptId) patch.manuscriptId = read.manuscriptId;
    if (a && !a.system && read.system) patch.system = read.system;
    return a && Object.keys(patch).length ? patchAttempt(next, a.id, patch) : next;
  });
  redraw(); shown?.ctx.say?.(v.label);
}
/** One line in the title bar when a submission made its journal the target (lib/journal-context.mjs). */
function sayTarget(before) { const msg = targetChangeNotice(before, get()); if (msg) shown?.ctx.say?.(msg); }

async function planNext() {
  const choice = await chooseJournal();
  if (!choice?.label) return;
  const before = journalSnapshot(get());
  let made = null;
  commit((l, st) => { const next = addAttempt(l, { journal: { id: choice.id || '', label: choice.label }, at: today(), kind: 'planned' }); made = next.at(-1).id; makeTarget(st, choice); return next; });
  open = made; redraw();
  sayTarget(before);
}

async function removeSubmission(id) {
  const a = attemptOf(id);
  if (!a || !await confirmAsk(`Remove the submission to ${label(a)}?`, { detail: `${plural(a.events.length, 'event')} recorded. Review rounds stay in Response to reviewers.`, confirm: 'Remove', danger: true })) return;
  commit(l => removeAttempt(l, id));
  open = null; redraw();
}

function readComments(a) {
  const e = letterToRead(a);
  if (!e) return;
  const id = a.id;
  openResponses({ journal: label(a), manuscriptId: a.manuscriptId, letter: e.letter, onRound: roundId => { commit(l => patchEvent(l, id, e.id, { roundId })); } }, k => shown?.ctx.go(k));
}

/** The dialog for one outcome ('desk' is a rejection without review); `event` edits an event that is there. */
async function recordOutcome(a, kind, event = null) {
  if (!a) return;
  await loadFiles();
  const desk = kind === 'desk' || (kind === 'rejected' && event?.desk);
  const k = kind === 'desk' ? 'rejected' : kind;
  const title = desk ? 'Rejected without review' : WORD[k] || 'Outcome';
  const letter = ['revise', 'rejected', 'accepted'].includes(k), sends = k === 'submitted' || k === 'revised';
  const e = event || {};
  const fieldsHtml = `<div class="an-settings">
        ${formField('Date', dateField('sb-o-at', e.at ?? today(), 'Date'))}
        ${k === 'revise' ? formField('Response due', dateField('sb-o-due', e.due || '', 'Response due', 'No date')) : ''}
        ${k === 'published' ? `${formField('DOI', `<input id="sb-o-doi" value="${esc(e.doi || '')}" spellcheck="false" autocomplete="off">`)}${formField('Citation', `<input id="sb-o-note" value="${esc(e.note || '')}" autocomplete="off">`)}` : formField('Note', `<input id="sb-o-note" value="${esc(e.note || '')}" placeholder="${k === 'revise' ? 'Minor revision' : k === 'rejected' ? 'Out of scope' : ''}" autocomplete="off">`)}
        ${sends ? formField(k === 'submitted' ? 'Manuscript sent' : 'Revised manuscript', fileSelect('sb-o-file', files.manuscripts, e.file || (k === 'submitted' ? a.file : null) || files.manuscripts[0] || null)) : ''}
        ${letter ? formField('Letter file', fileSelect('sb-o-file', files.letters, e.file || null)) : ''}
      </div>
      ${letter ? formField('Decision letter', `<textarea id="sb-o-letter" rows="6" spellcheck="false">${esc(e.letter || '')}</textarea>`) : ''}
      ${k === 'rejected' && !event ? '<label class="ui-check"><input type="checkbox" id="sb-o-addnote"><span>Add a note</span></label>' : ''}`;
  const go = await formDialog({ id: 'submission-outcome', title, tier: 'M', confirm: 'Save', body: fieldsHtml,
    onMount: d => { wireDateField(d, 'sb-o-at', 'Date'); if (k === 'revise') wireDateField(d, 'sb-o-due', 'Response due'); },
    submit: (form, d) => {
      const val = sel => d.querySelector(sel)?.value ?? '';
      return { at: val('#sb-o-at'), due: val('#sb-o-due'), doi: val('#sb-o-doi').trim(), note: val('#sb-o-note').trim(), letter: val('#sb-o-letter'), file: val('#sb-o-file'), addNote: !!d.querySelector('#sb-o-addnote')?.checked };
    } });
  if (!go) return;
  const choices = letter ? files.letters : files.manuscripts;
  const data = { kind: k, at: go.at, ...(desk ? { desk: true } : {}), ...(k === 'revise' ? { due: go.due } : {}), ...(go.doi ? { doi: go.doi } : {}),
    note: go.note, ...(letter ? { letter: go.letter } : {}), ...((letter || sends) ? { file: refOf(go.file, choices, e.file) } : {}) };
  const id = a.id;
  commit((l, s) => {
    const next = event ? patchEvent(l, id, event.id, data) : addEvent(l, id, data);
    if (k === 'submitted' && data.file) return patchAttempt(next, id, { file: data.file });
    // the person asked for a note in Notes (owner, 2026-10-11): one dated note for the co-authors, never written unasked
    if (go.addNote) {
      const at = new Date().toISOString(), name = `Rejected by ${label(a)}`;
      const text = [`# ${name}`, '', day(go.at) || go.at, go.note ? `\n${go.note}` : '', go.letter.trim() ? `\n> ${go.letter.trim().split('\n').join('\n> ')}` : ''].join('\n');
      s.projectNotes = [...normaliseNotes(s.projectNotes), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: name, customTitle: true, text, template: '', at, updated: at }];
    }
    return next;
  });
  redraw();
}

/** Opens an attempt's record (the layout sweep and the fixture reach the record with it). */
export function showAttempt(id) { open = id || null; }
/** Arrival from Needs attention (lib/arrive.mjs): a revision due or a chase opens the journal attempt it is about. */
export function arrive(a) { if ((a?.kind === 'revision-due' || a?.kind === 'chase') && a.ids?.[0]) showAttempt(a.ids[0]); return false; }
/** The dialogs, for the layout sweep's openers (tools/ui-regression/surfaces.json): Add submission, and one outcome of an attempt. */
export const addDialog = () => addSubmission();
export const outcomeDialog = (id, kind) => recordOutcome(attemptOf(id), kind);

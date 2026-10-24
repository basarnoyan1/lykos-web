import { REGISTRY } from './registry.mjs';
import { stageSummary, disclosure } from '../lib/ui-components.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, watchWidth } from '../lib/ui-actions.mjs';
import { attentionGroups, nextStep, proposalTotals, homeRows, RECENT_LIMIT, DATED_KIND } from '../lib/overview-model.mjs';
// Overview: where the paper stands, and what still needs a person (plan §2 — the first item in the
// navigation, and "progress" shown as unresolved work rather than percentages).
//
// Four blocks, none of them closed: Where the paper stands and Needs attention, then Tasks and Recent. Nothing here is stored.
// The facts and the unresolved list are computed from the project each time, so this page cannot disagree
// with the pages it points to. The task list is the one thing that is the user's own: a quick add, and the
// next few tasks and dates; the Tasks page holds the rest, the model-driven planning and the timeline.
import { get, update, getVersion } from '../store.mjs';
import { dateValue } from '../lib/date-picker.mjs';
import { stages, unresolved, funnel, ago, includedStudies, recentActivity } from '../lib/progress.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { configured } from '../lib/ai.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { nextResearchActions } from '../lib/research-workflow.mjs';
import { checksKey } from '../lib/progress-gate.mjs';
import { dueHtml, titleHtml } from '../lib/task-cells.mjs';
import { summarizeProject } from '../lib/project-summary.mjs';
import { submissionSummary, normaliseSubmissions } from '../lib/submissions.mjs';
import { normaliseTasks, sortTasks, makeTask, patchTask, removeTasks } from '../lib/tasks.mjs';
import { readModel } from './tasks-model.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { lazyModule } from '../lib/lazy.mjs';
import { showShellNotice } from '../lib/shell-notice.mjs';
// The journal catalogue and lookup load with the first-run setup (`prepare`), not with the Overview.
const journalPicker = lazyModule(() => import('../lib/journal-picker.mjs'), 'the journal lookup');
// The pages this one points at load when a row is pressed, not with the Overview (the shell loads pages on first use).
const PAGES = { library: () => import('./library.mjs'), tasks: () => import('./tasks.mjs'), notes: () => import('./notes.mjs'), folder: () => import('./folder.mjs'),
  extraction: () => import('./extraction.mjs'), outputs: () => import('./outputs.mjs'), analysis: () => import('./analysis.mjs') };
const onPage = async (k, name, ...args) => (await PAGES[k]())[name](...args);
import { showMenu } from '../lib/menu.mjs';
import { RESEARCH_TYPES, projectMode, researchType, visibleViews, setJournals } from '../lib/workflow.mjs';
import { questionLabelOf, isPrimaryType, DEFAULT_TYPES } from '../lib/research-types.mjs';
// A case report's one patient is drawn by views/case.mjs (257 KB with its bundle writer): it loads with the Overview of a case report only,
// before the first draw (the shell awaits `prepare` where it loads this page); a draw that comes first shows nothing there and repaints on arrival.
let caseMod = null;
const loadCase = () => caseMod ? null : import('./case.mjs').then(m => { caseMod = m; });
// A review's stages (lib/overview-panel.mjs, its facts and charts) load with this page (`prepare`), not at start-up; a draw that comes first repaints on arrival.
const factsLib = lazyModule(() => import('../lib/overview-panel.mjs'), 'where the paper stands');
export const prepare = s => !projectMode(s) ? journalPicker.ensure().catch(() => {}) : researchType(s).id === 'case-report' ? loadCase()
  : factsLib.ensure().catch(() => {});   // a failed load is said where it is used

export const meta = { title: 'Overview', icon: 'home' };
export const count = (...a) => REGISTRY.overview.count(...a);

// What the button beside an unresolved item says: the view it opens.
const VIEW_NAMES = { protocol: 'Protocol', search: 'Literature', library: 'Library', screening: 'Screening',
  extraction: 'Extraction', patients: 'Patient data', appraisal: 'Appraisal', analysis: 'Analysis',
  certainty: 'Certainty', manuscript: 'Manuscript', reporting: 'Reporting', settings: 'Settings', notes: 'Notes', case: 'Case', outputs: 'Tables and figures', submissions: 'Submission' };
// The fact or unresolved item last pointed at or clicked, for model
// actions: what the person was looking at when they chose one.
let pointed = null;

const rows = (pairs, cls = '') => `<dl class="ov-bd-rows${cls}">${pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><dt title="${esc(k)}">${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>`;

/** A primary study's stages, each with where it stands, opening its view. */
const STAGE_ICON = { protocol: 'protocol', patients: 'patients', datasets: 'dataset', analysis: 'analysis', manuscript: 'manuscript', reporting: 'flow', submissions: 'send' };
function studyOverview(st) {
  return `<section class="ov-flow ov-start ov-study" aria-label="Study">
    <h2>Study</h2>
    ${stageSummary(st.map(x => ({ ...x, icon: STAGE_ICON[x.key] || 'file' })))}
  </section>`;
}
export function focus() { return pointed; }
/** What the assistant is told about this view: what is unresolved and what is due. */
export function assistContext() {
  const s = get();
  const open = unresolved(s).map(u => u.text).slice(0, 8);
  const due = (s.todos || []).filter(t => !t.done).map(t => `${t.text}${t.due ? ` (due ${t.due})` : ''}`).slice(0, 8);
  return [`Overview. Unresolved: ${open.join('; ') || 'none'}`, `To do: ${due.join('; ') || 'none'}`].join('\n');
}

const ATTENTION_LIMIT = 5;   // groups shown before "Show all"
let attentionAll = false;    // "Show all" survives a rerender

/** A section's title, an optional count and the one action that belongs to it: one head bar, so none of them wraps away. */
const sectionHead = (id, title, extra = {}) => uiBar({ kind: 'head', label: title, id, cls: 'panel-head', lead: { title, level: 'h2' }, ...extra });

/** The icon of the page a Needs attention row opens (the rail's own), so a row is marked by its stage; a row from the folder (an integration check) carries the folder's. */
const VIEW_ICON = { protocol: 'protocol', search: 'search', library: 'library', screening: 'screening', extraction: 'extraction', patients: 'patients', datasets: 'dataset', appraisal: 'appraisal',
  analysis: 'analysis', advancedAnalysis: 'analysis', certainty: 'certainty', manuscript: 'manuscript', figures: 'image', outputs: 'outputs', reporting: 'checklist', submissions: 'send', changes: 'changes', notes: 'note' };
export const viewIcon = id => VIEW_ICON[String(id).split(':')[0]] || (String(id).startsWith('file:') ? 'folder' : 'file');
/** One part of the work that still needs a person: its stage's icon ringed in its state, its name, what is outstanding there, one action. */
const needRow = g => uiRow({ cls: 'ov-need', attrs: { 'data-need': g.id, 'data-folder': g.folder || false, title: g.tip || false },
  main: { html: `<button type="button" class="ov-go ov-need-go" aria-label="${esc(`${g.title}: ${g.summary}`)}"><span class="ov-st-go ov-need-dot" data-mark="${g.block ? 'failed' : 'warning'}" aria-hidden="true">${icon(g.folder ? 'folder' : viewIcon(g.id), { size: 16 })}</span><span class="ov-need-text"><span class="ov-need-name"><span class="ov-go-name">${esc(g.title)}</span></span><span class="ov-need-sum">${esc(g.summary)}</span>${icon('chevron-right', { size: 14 })}</span></button>` } });   // the ring beside two lines, name over summary: one edge for both; the row's title holds every part in full

/** Sent, under revision, accepted or published: the paper is with a journal, and the page leads with that (plan §2, Home page, 2026-10-17). */
const SENT_KINDS = new Set(['submitted', 'status', 'revise', 'revised', 'accepted', 'published']);
const isSubmitted = s => SENT_KINDS.has(submissionSummary(normaliseSubmissions(s.submissions), dateValue(new Date()))?.status?.replace('-desk', '') || '');
/** One thing done lately, on one line, with when. */
const eventRow = r => uiRow({ cls: 'ov-event', attrs: { 'data-event': r.view },
  // a timeline: each event a small node on one thin rule, holding the icon of the page it happened on
  main: { html: `<button type="button" class="ov-go" title="${esc(r.text)}"><span class="ov-event-dot" aria-hidden="true">${icon(viewIcon(r.view), { size: 10 })}</span><span class="ov-go-name">${esc(r.text)}</span></button>` },
  cells: [{ col: 'when', kind: 'text', ch: 12, html: esc(ago(r.at)) }] });

const START_CASE = [
  ['patients', 'patients', 'Enter patient data', 'Observations and outcomes, one row per patient'],
  ['search', 'search', 'Search literature', 'Supporting studies from PubMed, Europe PMC and more'],
];
const START_REVIEW = [
  ['search', 'search', 'Search databases', 'PubMed, Europe PMC and more'],
  ['import-file', 'import', 'Import a reference file', 'RIS, BibTeX, NBIB or EndNote export'],
  ['import-folder', 'folder', 'Add a folder of PDFs', 'Each paper is identified and added as a record'],
];
/** One way to begin an empty project: what it is and what it takes. */
// Drawn as a Needs attention row is (the ring, then the name over its line on one edge), with a neutral ring: a way in, not something outstanding.
const startRow = ([id, ic, name, line]) => uiRow({ cls: 'ov-start-step ov-need', attrs: { 'data-start': id },
  main: { html: `<button type="button" class="ov-go ov-need-go"><span class="ov-st-go ov-need-dot" aria-hidden="true">${icon(ic, { size: 16 })}</span><span class="ov-need-text"><span class="ov-need-name"><span class="ov-go-name">${esc(name)}</span>${icon('chevron-right', { size: 12 })}</span><span class="ov-need-sum">${esc(line)}</span></span></button>` } });

/** Does what a row of the page points at: focus the cell, the run or the paper it names, then open the view. */
async function activate(action, ctx) {
  if (!action) return;
  if (action.type === 'cell') await onPage('extraction', 'focusCell', action.paperId, action.columnId);
  else if (action.type === 'run') await onPage('extraction', 'focusRun', action.paperId, action.templateId);
  else if (action.type === 'paper') await onPage('library', 'focusPaper', action.paperId);
  // The page opens with a notice that says what is wrong there and what to do (lib/arrive.mjs); a row that already opened the first
  // item (a cell, a run, a paper) offers no "Open the first".
  const { fix, ...rest } = action.arrive || {};
  const arrive = action.arrive ? (action.type === 'go' ? action.arrive : rest) : null;
  // 'notes:reading-notes' opens that part of Notes: the shell knows the page, the page knows its parts.
  if (String(action.go).startsWith('notes:')) { await onPage('notes', 'showTab', action.go.slice(6)); ctx.go('notes', { arrive }); return; }
  ctx.go(action.go, { arrive });
}

/** What needs a person, and the next step: computed once per change of the project, read by the title bar (page) and the page (render). */
let attentionMemo = { version: -1, value: null, checks: false };
function attentionOf(s) {
  if (attentionMemo.version === getVersion() && attentionMemo.checks === checksKey() && attentionMemo.value) return attentionMemo.value;
  const type = researchType(s), isCase = type.id === 'case-series';
  const next = nextResearchActions(s);
  const visible = new Set(visibleViews(s));
  const open = unresolved(s).filter(u => {
    if (!visible.has(u.view)) return false;
    if (isCase && u.text === 'No eligibility criteria') return false;
    if (u.severity === 'block') return true;
    if (u.text === 'Review has no title') return !next.some(a => a.view === 'protocol' && a.text.startsWith('Define '));
    if (u.text === 'No eligibility criteria') return !next.some(a => a.text === 'Define eligibility criteria');
    return true;
  });
  const done = includedStudies(s);
  for (const n of s.autoSync?.needs || []) open.push({ view: 'changes', text: `${n.title}: ${n.detail}` });
  const conflicts = s.autoSync?.conflicts || [];
  if (conflicts.length) open.push({ view: 'changes', text: `${conflicts.length} ${conflicts.length === 1 ? 'value' : 'values'} edited here and changed in ${conflicts.length === 1 ? 'its file' : 'their files'}: choose which to keep` });
  const submitted = isSubmitted(s);
  const groups = attentionGroups({ next, open, proposals: proposalTotals(s.proposals, done.map(p => p.id)), fullTexts: done.filter(p => !p.pdf).length });
  const value = { type, next, visible, open, done, groups, submitted, step: nextStep(next, groups) };
  attentionMemo = { version: getVersion(), value, checks: checksKey() };
  return value;
}

/** Where the paper stands, read once per change of the project (the analyses' input checks take about 20 ms for 48 studies). */
let factsMemo = { version: -1, value: null, checks: '' };
function factsOf(s, today) {
  if (factsMemo.version === getVersion() && factsMemo.checks === checksKey() && factsMemo.value) return factsMemo.value;
  const value = factsLib.module().standingFacts(s, today);
  factsMemo = { version: getVersion(), value, checks: checksKey() };
  return value;
}

let shownCtx = null;   // the bar's commands open pages: they go through the context of the last render
/**
 * The title bar (lib/topbar.mjs): the page, the research type as its status, Continue to the stage the next step names as the one primary,
 * and More with Registration draft and Protocol (Project settings when the project has no protocol page). Before a project has a type
 * the page is its setup: no commands.
 */
export function page() {
  const s = get();
  if (!projectMode(s)) return { title: 'New project', actions: [] };
  const { type, step, visible } = attentionOf(s);
  return { title: 'Overview',
    actions: step ? [{ id: 'ov-continue', label: `Continue: ${step.label}`, icon: 'chevron-right', role: 'primary', run: () => shownCtx && activate(step.action, shownCtx) }] : [],
    overflow: [{ id: 'ov-guide', label: 'Getting started', run: () => shownCtx?.go('guide') }, { id: 'ov-registration', label: 'Registration draft', run: () => shownCtx?.go('protocol:registration') },
      { id: 'ov-edit', label: visible.has('protocol') ? 'Protocol' : 'Project settings', run: () => { if (visible.has('protocol')) shownCtx?.go('protocol'); else shownCtx?.go('settings:project'); } }] };
}


export function render(el, ctx) {
  shownCtx = ctx;
  const s = get();
  if (!projectMode(s)) { renderSetup(el, ctx); return; }
  const { type, visible, groups, submitted, next: nextActions } = attentionOf(s);
  const isCase = type.id === 'case-series';
  const isCaseReport = type.id === 'case-report';   // one patient: views/case.mjs draws its part
  const isPrimary = isPrimaryType(type.id);          // a trial, cohort, survey…: its stages, not a pipeline
  const st = stages(s);
  const recent = recentActivity(s, 25).slice(0, RECENT_LIMIT);
  const today = dateValue(new Date());

  const fun = funnel(s);
  const total = fun[0].n || 0;
  // Where the paper stands: a review with records reads its facts (a case series, a case report and a primary study draw their own block)
  const review = !isCaseReport && !isPrimary && !isCase && total > 0;
  const P = review && factsLib.ready() ? factsLib.module() : null;
  const openTasks = normaliseTasks(s.todos).filter(t => !t.done);
  const dated = summarizeProject(s, { today, within: 60, limit: 100 }).due.filter(d => d.kind !== 'task');
  const shownRows = homeRows({ tasks: sortTasks(openTasks), dated });

  const left = isCaseReport ? (caseMod ? caseMod.overviewSection(s) : '') : isPrimary ? studyOverview(st) : !total && !(s.participants || []).length ? `<section class="ov-flow ov-start" aria-label="Get started">
        ${sectionHead('ov-start-head', isCase ? 'Add your first case' : 'Add your first studies')}
        ${uiList({ id: 'ov-start-list', label: 'Ways to begin', attrs: { 'data-ov-list': '' }, rows: (isCase ? START_CASE : START_REVIEW).map(startRow) })}
      </section>` : isCase ? `<section class="ov-flow ov-case" aria-label="Case series">
        <div class="panel-head"><h2>Case series</h2></div>
        ${rows([['Records', (s.papers || []).length], ['Patients', (s.participants || []).length],
          ['Accepted values', Object.keys(s.values || {}).length]])}
      </section>` : (() => { const cards = P ? P.stageCards(factsOf(s, today), visible) : [];
        // the run: every stage a row on one line, its chart beside its words (lib/overview-panel.mjs)
        return `<div class="ov-main"><section class="ov-flow ov-panel" aria-label="Where the paper stands">
        ${sectionHead('ov-progress-head', 'Where the paper stands')}${P ? P.runHtml(cards, { lead: submitted ? 'submission' : '', steps: guideMod ? guideMod.guideSteps(s) : [], next: nextActions?.[0] || null }) : ''}
      </section></div>`; })();

  // Tasks: what is dated first (a task, a milestone, an ethics or registry date, in date order), then what has no date. A dated item
  // that is not a task has no control to complete it: its check keeps the room, hidden, so the titles stay on one edge.
  const taskRow = t => uiRow({ attrs: { 'data-todo-row': t.id, 'data-tk-state': t.priority === 'high' ? 'high' : false },
    check: { checked: false, label: `Done: ${t.text}`, attrs: { 'data-todo': t.id } },
    main: { html: `<button type="button" class="tk-text" data-open="${esc(t.id)}" title="${esc(t.text)}">${titleHtml(t.text)}</button>` },
    cells: [{ col: 'due', kind: 'text', ch: 12, html: dueHtml(t, today) }],
    end: uiRowEnd({ more: { label: `More for ${t.text}`, attrs: { 'data-todo-more': t.id } } }) });
  const datedRow = m => uiRow({ attrs: { 'data-dated-row': m.id, 'data-tk-kind': m.kind },
    check: { checked: false, label: `${DATED_KIND[m.kind] || 'Date'}: ${m.text}`, attrs: { 'data-row-blank': true, disabled: true, 'aria-hidden': 'true', tabindex: '-1' } },
    main: { html: `<button type="button" class="tk-text" data-go="${esc(m.view)}" title="${esc(m.text)}"><span class="tk-kind">${esc(DATED_KIND[m.kind] || 'Date')}</span>${esc(m.text)}</button>` },
    cells: [{ col: 'due', kind: 'text', ch: 12, html: dueHtml({ due: m.date }, today) }],
    end: uiRowEnd({ reserve: true }) });
  const taskRows = shownRows.map(r => r.task ? taskRow(r.task) : datedRow(r.dated));
  const tasksSection = `<section class="ov-tasks" aria-label="Tasks">
          ${sectionHead('ov-tasks-head', 'Tasks', { status: { id: 'ov-tasks-count', text: openTasks.length ? `${openTasks.length} open` : '', ch: 8 },
            actions: visible.has('tasks') ? [{ id: 'ov-all-tasks', label: 'All tasks', icon: 'open', role: 'quiet', plain: true, attrs: { 'data-go': 'tasks' } }] : [] })}
          ${uiBar({ kind: 'tools', form: true, id: 'ov-add', cls: 'ov-add', label: 'Add a task',
            filters: [{ type: 'field', id: 'ov-todo', label: 'New task', placeholder: 'Add a task', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'false' } }] })}
          ${taskRows.length ? uiList({ id: 'ov-todo-list', label: 'Tasks', cols: ['due'], reveal: true, attrs: { 'data-tk-list': true }, rows: taskRows }) : ''}
        </section>`;

  const needs = `<section class="ov-needs" aria-label="Needs attention">
          ${sectionHead('ov-needs-head', 'Needs attention', { status: { id: 'ov-needs-count', text: String(groups.length), ch: 3 },
            actions: groups.length > ATTENTION_LIMIT ? [{ id: 'ov-needs-all', label: 'Show all', role: 'quiet', plain: true, pressed: attentionAll }] : [] })}
          ${groups.length ? uiList({ id: 'ov-needs-list', label: 'Needs attention', attrs: { 'data-ov-list': '' }, rows: groups.map((g, i) => i < ATTENTION_LIMIT || attentionAll ? needRow(g) : needRow(g).replace(/^<div /, '<div hidden data-ov-more-row ')) }) : `<div class="ov-clear">${icon('check', { size: 16 })}<span>Nothing outstanding</span></div>`}
        </section>`;
  // Submission readiness for the target journal (lib/overview-panel.mjs, loaded with the stages)
  const readiness = P ? P.readinessSection(s, factsOf(s, today), `${getVersion()}|${checksKey()}`, ctx.rerender) : '';
  const history = recent.length ? `<section class="ov-history" aria-label="Recent">
        ${sectionHead('ov-history-head', 'Recent')}
        ${uiList({ id: 'ov-history-list', label: 'Recent activity', cols: ['when'], attrs: { 'data-ov-list': '' }, rows: recent.map(eventRow) })}
      </section>` : '';
  // A review's run takes the wide column, beside readiness, Needs attention, Tasks and Recent; any other project keeps its block beside Needs attention.
  el.innerHTML = `<div class="ov">${review ? `<div class="ov-top">${left}
      <div class="ov-col ov-side">${readiness}${needs}${tasksSection}${history}</div>
    </div>` : `
    <div class="ov-top">
      ${left}
      <div class="ov-col ov-side">${needs}</div>
    </div>
    <div class="ov-top ov-row2">
      ${tasksSection}
      ${history ? `<div class="ov-col ov-side">${history}</div>` : ''}
    </div>`}
  </div>`;
  if (isCaseReport) {
    if (caseMod) caseMod.wireOverview(el, ctx);
    else loadCase().then(() => { if (shownCtx === ctx && el.isConnected) render(el, ctx); }, err => console.warn('[case]', err));
  }
  if (review && !factsLib.ready()) factsLib.ensure().then(() => { if (shownCtx === ctx && el.isConnected) render(el, ctx); },
    err => showShellNotice({ id: 'overview-facts', text: err.message, again: true }));
  el.querySelectorAll('[data-share]').forEach(i => i.style.setProperty('--share', i.dataset.share));

  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => ctx.go(b.dataset.go));
  el.querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
    const k = b.dataset.start;
    if (k === 'import-file') PAGES.library().then(L => L.pick({ accept: L.IMPORT_ACCEPT }, f => L.importRecords(f[0], () => { ctx.rerender(); ctx.refreshCounts(); })));
    else if (k === 'import-folder') PAGES.library().then(L => L.pick({ directory: true }, f => L.importFolder(f, () => { ctx.rerender(); ctx.refreshCounts(); })));
    else ctx.go(k);
  });
  // A row or a stage card is one target, wherever in it the pointer lands; the button inside is the same target for the keyboard.
  const panel = P && el.querySelector('#ov-pipeline');
  if (panel) { P.wireStagePanel(el, ctx, PAGES); P.fitStages(panel); watchWidth(panel, () => P.fitStages(panel)); }
  P?.wireReadiness(el, ctx);
  el.querySelectorAll('.ov-need[data-need]').forEach(row => row.onclick = () => activate(groups.find(g => g.id === row.dataset.need)?.action, ctx));
  el.querySelectorAll('.ov-event').forEach(row => row.onclick = () => ctx.go(row.dataset.event));
  // Show all unfolds the rows past the first five in place (owner, 2026-10-22: "Show all works very weird"): no repaint, so the rows
  // above, the heading and the page stay where they are; the toggle stays pressed while they show
  el.querySelector('#ov-needs-all')?.addEventListener('click', e => {
    attentionAll = !attentionAll;
    [...el.querySelectorAll('#ov-needs-list > .ui-row')].slice(ATTENTION_LIMIT).forEach(r => { r.hidden = !attentionAll; });
    e.currentTarget.setAttribute('aria-pressed', String(attentionAll));
  });
  // A pointed-at item that this render no longer shows (resolved, or its count
  // changed) is no longer in focus.
  const shownNow = new Set();
  const point = (sel, kind, text, detail) => el.querySelectorAll(sel).forEach(b => {
    const label = text(b).trim();
    shownNow.add(label);
    const set = () => { pointed = { kind, label, detail: detail(b) }; };
    b.addEventListener('pointerenter', set); b.addEventListener('focusin', set); b.addEventListener('click', set, true);
  });
  point('.ov-st', 'fact', b => b.querySelector('.ov-step-toggle')?.dataset.words || '', b => VIEW_NAMES[b.dataset.stageGo] || '');
  point('.ov-need[data-need]', 'unresolved', b => b.querySelector('.ov-go-name')?.textContent + (b.querySelector('.ui-row-detail')?.textContent ? `: ${b.querySelector('.ui-row-detail').textContent}` : ''),
    b => VIEW_NAMES[String(groups.find(g => g.id === b.dataset.need)?.go).split(':')[0]] || '');
  if (pointed && !shownNow.has(pointed.label)) pointed = null;

  // Tasks. The add field takes Enter; the list is redrawn from the project, so a task added here lands among the undated rows.
  const redo = after => { ctx.refreshCounts?.(); ctx.rerender(); after?.(); };
  const taskById = id => get().todos.find(t => t.id === id);
  el.querySelector('#ov-add').onsubmit = e => {
    e.preventDefault();
    const text = el.querySelector('#ov-todo').value.trim();
    if (!text) return;
    update(x => { x.todos = [...(x.todos || []), makeTask({ text })]; return x; });
    redo(() => el.querySelector('#ov-todo')?.focus());
  };
  el.querySelectorAll('[data-todo-row] [data-todo]').forEach(c => c.onchange = () => {
    update(x => { patchTask(x.todos, c.dataset.todo, { done: c.checked }); return x; });
    redo();
  });
  const openInTasks = async id => { await onPage('tasks', 'focusTask', id); ctx.go('tasks'); };
  el.querySelectorAll('[data-todo-row] [data-open]').forEach(b => b.onclick = () => openInTasks(b.dataset.open));
  el.querySelectorAll('[data-todo-more]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Open in Tasks', icon: 'open', run: () => openInTasks(b.dataset.todoMore) },
    '-',
    { label: 'Remove', icon: 'trash', danger: true, run: () => { update(x => { x.todos = removeTasks(x.todos, [b.dataset.todoMore]).list; return x; }); redo(); } }], { align: 'end', minWidth: 160 }));
  // A date that is not a task opens the page that holds it: a milestone is on the timeline.
  el.querySelectorAll('[data-dated-row]').forEach(row => {
    const go = row.querySelector('[data-go]');
    if (go) go.onclick = async () => { if (row.dataset.tkKind === 'milestone') await onPage('tasks', 'showMode', 'timeline'); ctx.go(go.dataset.go); };
  });
}

const SETUP_STEPS = ['Study', 'Publication', 'Review'];
export const STUDY_CHOICES = Object.fromEntries(RESEARCH_TYPES.map(t => [t.id, [t.id === 'other' ? 'Other research' : t.label, t.blurb]]));
let setupStep = 0, setupDraft = null, setupFile = null;

/** The project brief stays in memory while the three steps are open. */
function renderSetup(el, ctx) {
  const folderName = get().project?.name || activeFolder()?.name || get().paper?.title || '';
  if (!setupDraft && get().project?.setupFrom) setupStep = Math.min(2, Number(get().project.setupFrom) || 0);   // the start screen asked the study step
  setupDraft ||= { name: folderName, researchType: RESEARCH_TYPES.some(t => t.id === get().project?.researchType) ? get().project.researchType : 'systematic-review', question: get().protocol?.title || '', journals: [''], outcome: '', patientData: false };
  const d = setupDraft;
  const chosen = RESEARCH_TYPES.find(t => t.id === d.researchType) || RESEARCH_TYPES[0];
  const typeLabel = chosen.label;
  const journalList = d.journals.map(x => x.trim()).filter(Boolean);
  const typeRows = RESEARCH_TYPES;
  const typeRow = t => `<label class="setup-type${d.researchType === t.id ? ' selected' : ''}">
      <input type="radio" name="researchType" value="${t.id}"${d.researchType === t.id ? ' checked' : ''}>
      <span class="setup-type-copy"><strong>${esc(STUDY_CHOICES[t.id][0])}</strong><span>${esc(STUDY_CHOICES[t.id][1])}</span></span>
      <span class="setup-type-mark" aria-hidden="true"></span></label>`;
  const summary = (label, value) => `<div class="setup-fact"><span>${esc(label)}</span><strong>${esc(value || 'Not set')}</strong></div>`;
  const journalRows = d.journals.map((journal, i) => uiRow({ attrs: { 'data-journal-row': i },
      // The field alone in the row, so Find journal and More sit on its line; its name (first choice or an alternative) is its label and placeholder.
      main: { html: `<input id="setup-journal-${i}" class="setup-journal" data-journal="${i}" maxlength="200" autocomplete="off" aria-label="${i ? `Alternative journal ${i}` : 'First-choice journal'}" placeholder="${i ? `Alternative journal ${i}` : 'First-choice journal'}" value="${esc(journal)}">` },
      end: uiRowEnd({ inline: { id: `setup-find-journal-${i}`, label: 'Find journal', icon: 'search', attrs: { 'data-find-journal': i } },
        more: { label: `More for journal ${i + 1}`, attrs: { 'data-journal-more': i } } }) }));
  const content = setupStep === 0 ? `
    <div class="setup-field-pair">
      <label class="setup-field"><span>Working title</span><input id="project-name" name="name" aria-describedby="project-name-error" required maxlength="160" autocomplete="off" placeholder="Name this project" value="${esc(d.name)}"><span id="project-name-error" class="setup-error" role="alert" hidden></span></label>
      <label class="setup-field"><span><span id="setup-question-label">${esc(questionLabelOf(d.researchType))}</span><small>Optional</small></span><textarea id="project-question" name="question" rows="2" maxlength="1000" placeholder="What do you want to find out?">${esc(d.question)}</textarea></label>
    </div>
    <header class="setup-heading setup-subheading"><h2>Research type</h2></header>
    <fieldset class="setup-type-list" aria-label="Research type">${typeRows.filter(t => DEFAULT_TYPES.includes(t.id)).map(typeRow).join('')}</fieldset>
    ${disclosure({ id: 'setup-more-types', title: 'Other types', count: String(typeRows.length - DEFAULT_TYPES.length), open: !DEFAULT_TYPES.includes(d.researchType), body: `<div class="setup-type-list" role="group" aria-label="Other research types">${typeRows.filter(t => !DEFAULT_TYPES.includes(t.id)).map(typeRow).join('')}</div>` })}` : setupStep === 1 ? `
    <div class="ui-flush">${uiList({ id: 'setup-journals', label: 'Target journals', rows: journalRows })}</div>   <!-- flush rows: the fields start and end on the edges Primary outcome's field does -->
    ${uiBar({ kind: 'tools', label: 'Journals', id: 'setup-journal-tools', actions: [{ id: 'setup-add-journal', label: 'Add journal', icon: 'plus', disabled: d.journals.length >= 10 }] })}
    <div class="setup-outcome"><label class="setup-field"><span>Primary outcome or focus</span><input id="project-outcomes" name="outcome" maxlength="300" autocomplete="off" placeholder="Main result, concept, or theme" value="${esc(d.outcome)}"></label></div>` : `
    <div class="setup-summary">
      ${summary('Research type', typeLabel)}${summary('Project', d.name)}${summary(questionLabelOf(d.researchType).replace(/^Research |^Trial |^Study |^Survey |^Decision /, '').replace(/^\w/, c => c.toUpperCase()), d.question)}
      ${summary('Journals', journalList.join('; '))}${summary('Outcome', d.outcome)}
    </div>
    <div class="setup-material">
      <label class="setup-material-row"><span>Individual patient data</span><input type="checkbox" name="patientData"${d.patientData || chosen.patientData ? ' checked' : ''}></label>
      <div class="setup-material-row"><span>Import records</span>${uiBar({ kind: 'tools', label: 'Import records', id: 'setup-file-bar', message: { id: 'records-name', text: setupFile?.name || 'None selected' }, actions: [{ id: 'pick-records', label: 'Choose file' }] })}
        <input type="file" id="records-file" accept=".ris,.nbib,.txt,.bib,.bibtex,.json,.enw" hidden></div>
      <div class="setup-material-row"><span>AI model</span><strong>${esc(configuredModel() || 'Not connected')}</strong></div>
      ${runOffered(chosen, d) ? `<label class="setup-material-row"><span>Write the paper from the question</span><input type="checkbox" name="paperRun"${d.paperRun ? ' checked' : ''}></label>` : ''}
    </div>`;
  el.innerHTML = `<div class="project-setup">
    <div class="setup-top"><header class="setup-intro"><h2>${['Start a research project', 'Plan your publication', 'Ready to begin'][setupStep]}</h2>
      </header>
    <ol class="setup-progress" aria-label="Setup steps">${SETUP_STEPS.map((label, i) => `<li class="setup-progress-item${i < setupStep ? ' complete' : i === setupStep ? ' current' : ''}"${i === setupStep ? ' aria-current="step"' : ''}><span class="setup-step-number">${i < setupStep ? icon('check') : i + 1}</span>${label}</li>`).join('')}</ol></div>
    <div class="setup-main">
      ${setupStep ? `<header class="setup-heading"><h2>${['', 'Target journals', 'Review project'][setupStep]}</h2></header>` : ''}
      <form id="project-setup-form" novalidate>${content}
        <div class="setup-end">${uiBar({ kind: 'foot', label: 'Setup steps', id: 'setup-foot', start: setupStep ? [{ id: 'setup-back', label: 'Back', icon: 'chevron-left', role: 'quiet' }] : [],
          actions: [{ id: 'setup-next', label: ['Continue to publication', 'Review project', 'Finish setup'][setupStep], icon: 'chevron-right', role: 'primary', type: 'submit' }] })}</div>
      </form>
    </div>
  </div>`;
  const form = el.querySelector('#project-setup-form');
  const saveDraft = () => {
    if (setupStep === 0) {
      d.name = form.elements.namedItem('name').value.trim();
      d.researchType = form.elements.namedItem('researchType').value;
      d.question = form.elements.namedItem('question').value.trim();
      if (d.researchType === 'case-series') d.patientData = true;
    } else if (setupStep === 1) {
      d.journals = [...form.querySelectorAll('[data-journal]')].map(x => x.value);
      d.outcome = form.elements.namedItem('outcome').value.trim();
    } else { d.patientData = form.elements.namedItem('patientData').checked; d.paperRun = !!form.elements.namedItem('paperRun')?.checked; }
  };
  form.querySelectorAll('.setup-type input').forEach(input => input.onchange = () => {
    form.querySelectorAll('.setup-type').forEach(row => row.classList.toggle('selected', row.querySelector('input').checked));
    form.querySelector('#setup-question-label')?.replaceChildren(questionLabelOf(input.value));
  });
  form.addEventListener('input', () => { form.elements.namedItem('name')?.removeAttribute('aria-invalid'); const error = form.querySelector('#project-name-error'); if (error) error.hidden = true; saveDraft(); });
  const suggest = m => { if (form.isConnected) form.querySelectorAll('[data-journal]').forEach(input => m.suggestJournals(input)); };
  if (journalPicker.ready()) suggest(journalPicker.module());
  else journalPicker.ensure().then(suggest, err => showShellNotice({ id: 'journal-lookup', text: err.message, again: true }));
  form.querySelector('#setup-add-journal')?.addEventListener('click', () => {
    saveDraft(); if (d.journals.length < 10) d.journals.push(''); renderSetup(el, ctx);
    [...el.querySelectorAll('[data-journal]')].at(-1)?.focus();
  });
  form.querySelectorAll('[data-find-journal]').forEach(button => button.onclick = async () => {
    saveDraft();
    const i = Number(button.dataset.findJournal);
    let choice;
    try { choice = await (await journalPicker.ensure()).chooseJournal({ current: d.journals[i] }); }
    catch (err) { showShellNotice({ id: 'journal-lookup', text: err.message, again: true }); return; }
    if (choice) { d.journals[i] = choice.label; renderSetup(el, ctx); }
  });
  form.querySelectorAll('[data-journal-more]').forEach(button => button.onclick = () => {
    const i = Number(button.dataset.journalMore);
    showMenu(button, [i
      ? { label: 'Remove journal', icon: 'trash', danger: true, run: () => { saveDraft(); d.journals.splice(i, 1); renderSetup(el, ctx); } }
      : { label: 'Clear journal', icon: 'close', run: () => { saveDraft(); d.journals[0] = ''; renderSetup(el, ctx); } }], { align: 'end' });
  });
  const file = form.querySelector('#records-file');
  form.querySelector('#pick-records')?.addEventListener('click', () => file.click());
  if (file) file.onchange = () => { setupFile = file.files[0] || null; form.querySelector('#records-name').textContent = setupFile?.name || 'None selected'; };
  form.querySelector('#setup-back')?.addEventListener('click', () => { saveDraft(); setupStep--; renderSetup(el, ctx); });
  form.onsubmit = async e => {
    e.preventDefault();
    saveDraft();
    if (setupStep === 0 && !d.name) { const name = form.elements.namedItem('name'), error = form.querySelector('#project-name-error'); error.textContent = 'Enter a working title'; error.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
    if (setupStep < 2) { setupStep++; renderSetup(el, ctx); return; }
    const type = RESEARCH_TYPES.find(t => t.id === d.researchType);
    if (!type) return;
    const journals = [...new Set(d.journals.map(x => x.trim()).filter(Boolean))].slice(0, 10);
    update(s => {
      s.project = { name: d.name, mode: type.mode, researchType: type.id, patientData: d.patientData || !!type.patientData, patientDataManual: !!d.patientData };
      setJournals(s, journals);   // writes project.journals; its target is new here, so the journal's style and profile apply
      s.paper = { ...(s.paper || {}), title: s.paper?.title || d.name };
      if (d.question || d.outcome) s.protocol = { ...(s.protocol || {}), title: d.question,
        pico: { ...(s.protocol?.pico || {}), ...(d.outcome ? { outcome: d.outcome } : {}) }, criteria: s.protocol?.criteria || [] };
      s.paper = { ...(s.paper || {}), title: s.paper?.title || d.name, ...(journals.length ? { journal: journals[0] } : {}) };
      return s;
    });
    if (setupFile) await onPage('library', 'importRecords', setupFile, () => {});
    // A folder project gets the folders of its research type now that it has one.
    await onPage('folder', 'layoutAfterSetup').catch(err => console.warn('[folder layout]', err));
    const startRun = runOffered(type, d) && d.paperRun;
    if (startRun) { const { newRun } = await import('../lib/paper-run.mjs'); update(s => { s.paperRun = newRun({ question: d.question, kind: RUN_KIND[type.id], journal: journals[0] || '' }); return s; }); }
    setupDraft = null; setupFile = null; setupStep = 0;
    ctx.rerender();
    if (startRun) ctx.openChat?.();
  };
}

// a review with a question and a model can be written from the question (lib/paper-run.mjs)
const RUN_KIND = { 'systematic-review': 'systematic review', 'meta-analysis': 'meta-analysis', 'scoping-review': 'scoping review' };
const runOffered = (type, d) => !!RUN_KIND[type?.id] && !!String(d.question || '').trim() && !!configuredModel();
const configuredModel = () => { const a = readModel() || modelFor('chat'); return configured(a) ? (a.model || a.provider) : ''; };

// Getting started's checks give the progress bar its segments (lib/guide-steps.mjs, loaded with the page)
let guideMod = null;
import('../lib/guide-steps.mjs').then(m => { guideMod = m; shownCtx?.rerender?.(); }, () => {});

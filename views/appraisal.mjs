// Appraisal: item judgements for the chosen instrument, and the figures built
// from them. The app records the reviewer's judgement per item; it does not
// propose one, score it, or aggregate items into a number (plan H2, H3, and the
// non-negotiable against automatic risk-of-bias judgements in 1.3).
//
// The instrument belongs to the review, not to the app: a case-series review
// appraises with JBI and has no "overall risk of bias" to give. Judgements are
// stored per instrument, so switching tools never reinterprets an answer that
// was given against a different question.
//
// RoB 2 judges a result and ROBINS-I an outcome: their assessments can be
// made per outcome, the study level being the default that every outcome
// without its own assessment uses. With a second reviewer, A and B answer
// independently (each sees only their own answers), and Reconcile lists the
// domains they judged differently; each needs a resolved value with its
// reason, and the consensus is then confirmed (lib/rob-review.mjs). Figures,
// the list and every other reader use the final judgements.
//
// List · detail · inspector: the list is the included studies, each marked
// with its overall judgement in the instrument's traffic-light colour, or with
// how many items are judged, or how many domains wait to be reconciled; the
// detail is the selected study's assessment; the inspector holds the study,
// the review settings, the reviewers' agreement and the passages filed in support.
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { inRobScope, robScope, robScopeWords, outcomeStudies } from '../lib/rob-scope.mjs';
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_dates$plural as plural } from "../boot.mjs";
import { views_registry$REGISTRY as REGISTRY } from "../boot.mjs";
import { store$get as get, store$update as update, store$projectGeneration as projectGeneration } from "../boot.mjs";
import { schema$allTools as allTools, schema$appraisalTool as appraisalTool, schema$JUDGEMENT_TONE as JUDGEMENT_TONE } from "../boot.mjs";
import { lib_appraisal_extra$currentLevel as currentLevel } from "../boot.mjs";
import { verdictTone, verdictMark } from '../lib/appraisal-mark.mjs';
import { lib_appraisal_custom$answerWith as answerWith, lib_appraisal_custom$toolIdsOf as toolIdsOf, lib_appraisal_custom$ruleOverall as ruleOverall, lib_appraisal_custom$questionKey as questionKey, lib_appraisal_custom$scoreRows as scoreRows, lib_appraisal_custom$scoreMark as scoreMark } from "../boot.mjs";
import { instrumentsOpen, openInstruments, closeInstruments, instrumentsSpec, renderInstruments } from './appraisal-instruments.mjs';
import { trafficLight, summaryBars, analysisWeights, robvisTrafficLight, robvisSummary, robvisTemplateFor, ROBVIS_TEMPLATES } from '../lib/appraisal-fig.mjs';
import { robScreen } from '../lib/rob-screen.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiNotice as uiNotice, lib_ui_actions$uiSwap as uiSwap } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink, lib_ui_components$disclosure as disclosure } from "../boot.mjs";
import { openStudy } from '../lib/study.mjs';
import { lib_screen$studies as studies, lib_screen$screeningStarted as screeningStarted } from "../boot.mjs";
import { lib_workflow$defaultAppraisal as defaultAppraisal } from "../boot.mjs";
import { instrumentFor, instrumentChoice, instrumentReason, chooseInstrument } from '../lib/study-instrument.mjs';
import { derivedRating, drivers } from '../lib/umbrella.mjs';
import { lib_outcomes$shownOutcomes as shownOutcomes, lib_outcomes$analysisOf as analysisOf } from "../boot.mjs";
import { itemsMet, gradeBy, isChecklist, gradeCounts, assessmentRows, isComplete } from '../lib/appraisal-summary.mjs';
import { lib_paging$pageOf as pageOf, lib_paging$pager as pager, lib_paging$wirePager as wirePager } from "../boot.mjs";
import * as sweepModule from '../lib/rob-sweep.mjs';
import { hasGuide, itemGuide, guideNote, setGuideNote } from '../lib/rob-guide.mjs';
import { projectRule, setProjectChecks, severestColumn, severestOf, SEVEREST } from '../lib/rob-overall.mjs';
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { agentMark } from '../lib/agent-card.mjs';
import { lib_rob_review$STUDY as STUDY, lib_rob_review$OVERALL as OVERALL, lib_rob_review$PER_OUTCOME as PER_OUTCOME, lib_rob_review$secondOn as secondOn, lib_rob_review$answersBy as answersBy, lib_rob_review$finalAnswers as finalAnswers, lib_rob_review$effectiveAnswers as effectiveAnswers, lib_rob_review$assessedAt as assessedAt, lib_rob_review$discrepancies as discrepancies, lib_rob_review$consensusState as consensusState, lib_rob_review$resolveDomain as resolveDomain, lib_rob_review$confirmConsensus as confirmConsensus, lib_rob_review$setSecond as setSecond, lib_rob_review$clearLevel as clearLevel, lib_rob_review$startLevel as startLevel, lib_rob_review$kappa as kappa, lib_rob_review$pairsFor as pairsFor, lib_rob_review$contextOf as contextOf, lib_rob_review$setContext as setContext, lib_rob_review$modelOn as modelOn, lib_rob_review$peopleOf as peopleOf } from "../boot.mjs";

import { setModelReader, modelAgreement, readerDone } from '../lib/rob-people.mjs';
import { listsOf as verifyLists, peopleOf as checkPeople } from '../lib/person-checks.mjs';
import { lib_dialog$ask as ask } from "../boot.mjs";

export const usesDocument = true;
export const meta = { title: 'Appraisal', icon: 'appraisal' };

// A case series is appraised with the JBI case-series checklist, an accuracy
// review with QUADAS-2, unless another was chosen.
const toolId = s => s.appraisalTool || defaultAppraisal(s);
// A review of case reports and case series appraises each with its own checklist: a person's choice, the instrument an appraisal was started
// with, the one the study's design takes (a case series JBI, a comparative cohort ROBINS-I, a trial RoB 2), else the review's (lib/study-instrument.mjs).
const toolFor = (s, paperId) => instrumentFor(s, paperId);
// every instrument id, the project's own included: the s.assessments mirror keeps only these
const toolIds = () => toolIdsOf(get());

let pick = null;              // the study in the detail
let listTool = 'all', filterGeneration = -1;
let show = 'all';             // 'open' | 'done' | 'all'
let showFigs = false;
let chartTool = null;         // the instrument the charts draw, when the person chose one
let weighted = false;         // the summary weighted by the pooled analysis, when it has weights
let figLayout = 'house';      // the figures' layout: the house drawing, or robvis's conventions by template
let level = STUDY;            // 'study' or an outcome id: what the form and the figures show
let who = 'a';                // 'a' | 'b' | 'reconcile', with a second reviewer
let showGrid = false;         // every study's items in one table, for a review of many reports
let gridPage = 1, pageGeneration = -1;
// The domain last clicked or focused in the form: what model actions and the
// assistant take the person to be appraising. It belongs to its study.
let focused = null;           // { p, d }
let reveal = null;            // { p, d }: the domain a figure's judgement asked for, shown once the study is drawn
// the one item whose meaning and decisions are open under it ('<tool>|<item>'), else none: pressing another closes it, pressing it again too
// (owner, 25 Oct 2026: "only expand one"); kept while moving between studies
let guideAt = null;
let noteEditing = null;
let guideMore = null;         // the open item whose every answer is shown ('<tool>|<item>')      // the item whose note is being written ('<tool>|<item>'), else none
let shownCtx = null;          // the shell's context of the last render, for the title bar's switch

// The levels an instrument can be judged at in this review: the study, and each outcome for RoB 2 and ROBINS-I.
const levelsOf = (s, tool) => [[STUDY, 'Study level'], ...(PER_OUTCOME.has(tool.id) ? shownOutcomes(s).filter(o => !o.derived || analysisOf(s, o.id)).map(o => [o.id, o.name]) : [])];
const levelNow = (s, tool) => (levelsOf(s, tool).some(([id]) => id === level) ? level : STUDY);
const whoNow = s => (secondOn(s) ? who : 'a');
// Two people and the model (lib/rob-review.mjs modelOn, 2 Nov 2026): a person assessing in their own slot sees neither the other person's
// answers nor the models' readings of the study until their own assessment of it is complete, so the two assessments stay independent.
const blindedFor = (s, p, tool, lvl) => modelOn(s) && whoNow(s) !== 'reconcile' && !readerDone(s, p.id, tool, whoNow(s), lvl);
const firstName = n => String(n || '').split(/\s+/)[0] || n;
const readerName = (s, slot) => peopleOf(s)[slot] || (slot === 'a' ? 'Reviewer A' : 'Reviewer B');

/** The final judgements that apply to a study at the level in view. */
function answers(s, paperId, tool, lvl = levelNow(s, tool)) {
  return effectiveAnswers(s, paperId, tool.id, lvl).answers;
}

/**
 * What the charts draw, per instrument in use, at the study level: `[{ tool, n, done: [{ study, label, values }] }]`, the instruments
 * with a complete assessment only, the most complete first. Tables and figures draws the same two figures from it (one drawing, two places).
 */
export function chartSets(s = get()) {
  const used = new Map();
  for (const x of studies(s)) {
    const t = toolFor(s, x.id), u = used.get(t.id) || { tool: t, n: 0, done: [] }, values = answers(s, x.id, t, STUDY);
    u.n++;
    if (isComplete(t, values)) u.done.push({ study: x.id, label: x.label, values });
    used.set(t.id, u);
  }
  // a figure restricted to the studies of an outcome, or a chosen set, draws those (lib/rob-scope.mjs)
  for (const u of used.values()) u.done = inRobScope(s, u.tool.id, u.done);
  return [...used.values()].filter(u => u.done.length).sort((a, b) => b.done.length - a.done.length || b.n - a.n);
}
/** Opens the page on the charts of one instrument, at the study level (Tables and figures' "Open in Appraisal"). */
export function openCharts(toolId) { showGrid = false; showFigs = true; chartTool = toolId || null; level = STUDY; }

/** The study being appraised, and the domain when a judgement has focus. */
export function focus() {
  const s = get();
  const p = pick && (s.papers || []).find(x => x.id === pick);
  if (!p) return null;
  const tool = toolFor(s, p.id);
  const a = answers(s, p.id, tool);
  const d = focused?.p === p.id ? tool.domains.find(x => x.id === focused.d) : null;
  const judged = tool.domains.filter(x => a[x.id]).map(x => `${x.short} ${a[x.id]}`);
  return { kind: 'study', paperId: p.id, label: p.label, domain: d?.id || null,
    detail: [tool.name, d && `${d.short} ${d.label}${a[d.id] ? `: ${a[d.id]}` : ''}`,
      !d && judged.length && `judged ${judged.join(', ')}`].filter(Boolean).join(', ') };
}

export function assistContext() {
  const s = get(); const tool = appraisalTool(toolId(s), s);
  const byId = new Map((s.papers || []).map(p => [p.id, p]));
  const done = studies(s).map(p => { const a = answers(s, p.id, tool, STUDY); const n = Object.keys(a).length; return n ? `${byId.get(p.id)?.label || p.id}: ${Object.entries(a).slice(0, 8).map(([d, j]) => `${d} ${j}`).join(', ')}` : ''; }).filter(Boolean);
  return [`Appraisal with ${tool.name || tool.id}; domains: ${(tool.domains || []).map(d => d.id || d.name || d).join(', ')}${secondOn(s) ? '; two reviewers' : ''}`,
    done.length ? `Assessed (${done.length}): ${done.slice(0, 12).join(' | ')}` : 'Nothing assessed yet'].join('\n');
}
export const count = (...a) => REGISTRY.appraisal.count(...a);

const columnsOf = tool => [...tool.domains,
  ...(tool.overall ? [{ id: OVERALL, short: 'Overall', label: 'Overall' }] : [])];
// The signalling questions' answers in words (Cochrane's codes: RoB 2, ROBINS-I and its V2); the code stays the stored value and the tooltip
const ANSWER_WORDS = { Y: 'Yes', PY: 'Probably yes', SY: 'Strong yes', WY: 'Weak yes', WN: 'Weak no', SN: 'Strong no', PN: 'Probably no', N: 'No', NI: 'No information', NA: 'Not applicable' };
// A judgement's traffic-light mark: lib/appraisal-mark.mjs, shared with a study's Details.
/** A judgement's control with its mark before it; the select carries the tone so its text takes the colour. */
const verdictField = (v, select) => `<span class="rob-verdict">${verdictMark(v)}${select.replace('<select ', `<select data-tone="${verdictTone(v) || 'empty'}" `)}</span>`;

// ---- list · detail · inspector ----------------------------------------------
function resetListFilter() {
  if (filterGeneration !== projectGeneration()) { listTool = 'all'; filterGeneration = projectGeneration(); }
}
function rows(s) {
  resetListFilter();
  const all = studies(s).filter(p => listTool === 'all' || toolFor(s, p.id).id === listTool);
  if (show === 'all') return all;
  return all.filter(p => { const tool = toolFor(s, p.id); return isComplete(tool, answers(s, p.id, tool)) === (show === 'done'); });
}

// The page's head is the title bar (page()): Appraisal, how many studies, what the page shows (one study, the grid of every study, or the
// charts) and Export in More. The list pane has no head of its own (no title, no count: the bar says both); its one row is the status switch.
const pageShows = s => (showGrid && !secondOn(s) ? 'grid' : showFigs ? 'charts' : 'study');
/** The title bar of the page, a pure function of its state (the tests read it without a shell). */
export function pageSpec({ n, shows, two }, { view = () => {}, exportAll = () => {}, importBook = () => {} } = {}) {
  return { title: 'Appraisal',
    ...(n ? {
      view: { id: 'ap-view', label: 'Show', attr: 'data-ap-view', value: shows, items: [['study', 'Study'], ...(two ? [] : [['grid', 'Grid']]), ['charts', 'Charts']], run: view } } : {}),
    actions: [],
    overflow: n ? [{ id: 'ap-import', label: 'Import from a workbook or JSON…', icon: 'import', run: importBook }, { id: 'ap-export', label: 'Export', icon: 'export', run: exportAll }] : [] };
}
export function page(rerender) {
  const s = get();
  // the sub-page of the review's own instruments: Back to Appraisal, its name and count
  if (instrumentsOpen()) return instrumentsSpec({ back: () => { closeInstruments(); rerender(); } });
  return pageSpec({ n: studies(s).length, shows: pageShows(s), two: secondOn(s) }, {
    // in a single-pane window the switch shows the page, not the list it was pressed over
    view: key => { showGrid = key === 'grid'; showFigs = key === 'charts'; gridPage = 1; shownCtx?.openItem?.(); rerender(); },
    exportAll: exportCsv,
    // a workbook of judgements made outside the app (views/appraisal-import.mjs), loaded on use
    importBook: anchor => import('./appraisal-import.mjs').then(m => m.importWorkbook(anchor, { say: msg => shownCtx?.say?.(msg), rerender: () => { shownCtx?.refreshCounts?.(); rerender(); } })) });
}

export const list = {
  count: false,
  get empty() { return show === 'open' ? 'Nothing to appraise' : show === 'done' ? 'Nothing complete' : screeningStarted(get()) ? 'No included studies' : 'No studies'; },
  /** The list's one tools row: which studies it lists. */
  filters(el, refresh) {
    resetListFilter();
    const s = get(), used = new Set(studies(s).map(p => toolFor(s, p.id).id));
    const options = [['all', 'All instruments'], ...allTools(s).filter(t => used.has(t.id)).map(t => [t.id, t.name])];
    el.innerHTML = uiBar({ kind: 'tools', label: 'Appraisal list', id: 'ap-tools',
      // two selects of one kind: side by side in a wide list, the same two controls stacked in a narrow one
      filters: [{ type: 'select', id: 'ap-show', label: 'Appraisal status', value: show, options: [['all', 'All studies'], ['open', 'To do'], ['done', 'Complete']] },
        { type: 'select', id: 'ap-list-tool', label: 'Instrument', value: listTool, options }] });
    el.querySelector('#ap-list-tool').onchange = e => { listTool = e.target.value; refresh(); };
    el.querySelector('#ap-show').onchange = e => { show = e.target.value; refresh(); };
  },
  // One line a study (Component review 2026-10-21, item 14, after Linear's rows): its name, its overall verdict, then only what is an
  // exception: the instrument when it is not the one most studies use, the count while domains are still open; twenty rows of "JBI case
  // series, 10 of 10" said nothing a row could not. Every verdict shows, Low too: a Low row without its light read as not appraised (owner,
  // 2 Nov 2026). A checklist has no verdict, so its row says how many items were met ("8 of 10 met"), for the same reason (owner, 2026-10-24).
  rowHeight: 40,   // the list pane's one-line row, as Analysis and Protocol: its padding and rule leave 28 px rows 19 px for a 20 px name (list-labels.browser.test.mjs)
  items(s) {
    const listed = rows(s), tools = listed.map(p => toolFor(s, p.id));
    const uses = new Map(); for (const t of tools) uses.set(t.id, (uses.get(t.id) || 0) + 1);
    const common = [...uses].sort((a, b) => b[1] - a[1])[0]?.[0];
    return listed.map((p, i) => {
      const tool = tools[i], lvl = levelNow(s, tool);
      const a = answers(s, p.id, tool, lvl);
      const n = tool.domains.filter(d => a[d.id]).length;
      const verdict = tool.overall ? a[OVERALL] : '';
      // AMSTAR 2's overall is derived from its items, and shown once all are answered.
      const derived = tool.derived ? derivedRating(tool, a) : null, rated = derived?.complete ? derived : null;
      // with two reviewers, domains still to reconcile come first
      const eff = effectiveAnswers(s, p.id, tool.id, lvl).level;
      const open = secondOn(s) ? consensusState(s, p.id, tool, eff).open : 0;
      const tone = verdict ? verdictTone(verdict) : rated?.tone || '';
      const word = verdict || rated?.rating || '';
      // a checklist (JBI) has no overall judgement: its row shows how many items were met, so it never reads as empty
      const score = !word && isChecklist(tool) && n ? itemsMet(a, tool) : null;
      const end = [tool.domains.length && n < tool.domains.length ? `${n} of ${tool.domains.length}` : '',
        // the short label already names the year ("Kaner 2010b"): the year stands apart only beside a full title
        p.label ? '' : p.year || ''].filter(Boolean).join(', ');
      // the instrument on the line under the name, so the name keeps its width: at the row's end it cut "Di Silvestre 2014" and
      // "Gunerbuyuk 2025" to "Di Silvestre…" and "Gunerbuyuk…", which then could not be told apart (owner review, 25 Oct 2026)
      return { id: p.id, title: p.label || p.title, sub: tool.id !== common ? tool.name : '', meta: end,
        mark: open ? `${open} to reconcile` : word || (score ? `${score.met} of ${score.applicable} met` : ''),
        dot: open || !word ? '' : tone,
        markTone: '' };
    });
  },
};
/** Explicit paper result links leave charts even when this paper was already selected. */
// `at.domain`: a risk-of-bias figure's judgement opens the study at that domain (lib/rob-screen.mjs), its row in view and its guide open
export function focusPaper(id, at) { pick = id; listTool = 'all'; show = 'all'; showGrid = false; showFigs = false; focused = null; reveal = at?.domain ? { p: id, d: at.domain } : null; }
export function select(id) { if (id !== pick) { showGrid = false; showFigs = false; } pick = id; }   // a study chosen in the list is what the page shows
/** Arrival from Needs attention (lib/arrive.mjs): the studies still to appraise, through the list's own To do filter; null puts it back. */
let beforeArrive = null;
export function arrive(a) {
  if (!a) { if (beforeArrive) show = beforeArrive; beforeArrive = null; return false; }
  if (a.kind !== 'not-appraised') return false;
  beforeArrive = show; show = 'open'; pick = null; showGrid = false;
  return true;
}
export const arrived = () => show === 'open';
export function selected() { return pick; }
/** The grid and the charts are about every study, not the one picked: a single-pane title bar names the page, not the item. */
export const showsItem = () => pageShows(get()) === 'study';

/**
 * The selected study, the review's reviewers and their agreement, and the passages filed in support. With no study chosen (the grid, the
 * charts, a review with nothing included yet) the review's own settings stay here: reviewers, the instrument, custom instruments.
 */
// The project's risk-of-bias overall rule (.lykos/build.json "checks" "robOverall", lib/rob-overall.mjs): read through the build settings'
// memo, and the inspector drawn again only when the rule changed.
function primeRobRule(ctx) {
  const f = activeFolder(); if (!f) return;
  import('../lib/printed-data.mjs').then(m => m.buildConf(f)).then(conf => { if (setProjectChecks(conf?.checks)) ctx.rerender?.(); }).catch(() => {});
}
export function inspect(ctx) {
  primeRobRule(ctx);
  const s = get(); const p = pick && (s.papers || []).find(x => x.id === pick);
  if (!p) { const tool = appraisalTool(toolId(s), s); return [reviewSection(s, ctx), ...(secondOn(s) && studies(s).length ? [agreementSection(s, tool, levelNow(s, tool))] : [])]; }
  const tool = toolFor(s, p.id), lvl = levelNow(s, tool);
  const a = answers(s, p.id, tool, lvl);
  const n = tool.domains.filter(d => a[d.id]).length;
  // Passages the model actions file are notes headed with the instrument's name.
  const support = (s.notes || []).filter(x => x.paper === p.id && String(x.text || '').startsWith(`${tool.name} `));
  const secs = [{
    title: 'Assessment',
    html: `<dl class="props">
      <dt>Instrument</dt><dd>${esc(tool.name)}</dd>
      <dt>Judged</dt><dd>${n} of ${tool.domains.length}${tool.overall ? (a[OVERALL] ? ', overall' : ', no overall') : ''}</dd>
      </dl>${tool.source?.url ? disclosure({ id: 'assessment-tool-details', title: 'Tool details', body: `<p class="meta">${esc(tool.design)}</p><p class="meta"><a href="${esc(tool.source.url)}" target="_blank" rel="noopener noreferrer">Official tool ↗</a>${tool.source.licence ? ` (${esc(tool.source.licence)})` : ''}</p>${tool.source.note ? `<p class="meta">${esc(tool.source.note)}</p>` : ''}` }) : ''}`,
  }, reviewSection(s, ctx)];
  if (secondOn(s)) secs.push(agreementSection(s, tool, lvl));
  // what the decision log says of this assessment beside its judgements: the result assessed and the scope of the appraisal
  const context = contextOf(s, p.id, tool.id, lvl);
  secs.push({
    title: 'Assessment context',
    html: `<div class="an-settings"><label class="field"><span>Assessed result</span><input data-ctx="target" value="${esc(context.target)}" aria-label="Assessed result" placeholder="${esc(lvl === STUDY ? 'The study as a whole' : 'This outcome')}"></label>
      <label class="field"><span>Scope</span><input data-ctx="scope" value="${esc(context.scope)}" aria-label="Scope of the appraisal"></label></div>`,
    wire: el => el.querySelectorAll('[data-ctx]').forEach(i => i.onchange = () => {
      const v = k => el.querySelector(`[data-ctx="${k}"]`).value;
      update(st => setContext(st, { paperId: p.id, toolId: tool.id, level: lvl, target: v('target'), scope: v('scope') }));
    }),
  });
  secs.push({
    title: 'Support', meta: String(support.length || ''),
    html: support.length ? uiList({ label: 'Support', rows: support.map((x, i) => uiRow({
        main: { html: esc(x.text.slice(tool.name.length + 1)), detail: [x.page ? uiLink({ label: `p. ${x.page}`, attrs: { 'data-page': i } }) : ''], wrap: true } })) })
      : emptyState({ title: 'No passages filed', size: 'inline' }),
    wire: el => el.querySelectorAll('[data-page]').forEach(b => b.onclick = () =>
      ctx.openDocument(p.id, { page: Number(support[+b.dataset.page].page) })),
  });
  return secs;
}

/** The review's settings, the same with or without a study chosen: reviewers, the review's instrument, its custom instruments, a checklist's grading rule. */
function reviewSection(s, ctx) {
  return {
    title: 'Review', html: `<div class="an-settings"><label class="field"><span>Reviewers</span><select data-reviewers aria-label="Reviewers">
        <option value="one"${secondOn(s) ? '' : ' selected'}>One reviewer</option><option value="two"${secondOn(s) && !modelOn(s) ? ' selected' : ''}>Two, independently</option><option value="model"${modelOn(s) ? ' selected' : ''}>Two people and the model</option></select></label>
      <label class="field"><span>Instrument</span><select data-default-tool aria-label="Instrument for the review">${allTools(s).map(t => `<option value="${t.id}"${t.id === toolId(s) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Custom instruments</span><button type="button" data-custom-tools>${esc(customCount(s) ? `${customCount(s)} defined` : 'Define')}</button></label>
      ${isChecklist(appraisalTool(toolId(s), s)) ? `<label class="field"><span>Low above (%)</span><input data-rule="low" class="num" inputmode="numeric" value="${esc(s.appraisalRule?.low ?? '')}" aria-label="Low above percent"></label>
      <label class="field"><span>Moderate from (%)</span><input data-rule="moderate" class="num" inputmode="numeric" value="${esc(s.appraisalRule?.moderate ?? '')}" aria-label="Moderate from percent"></label>` : ''}</div>`,
    wire: el => {
      el.querySelector('[data-reviewers]').onchange = async e => {
        const v = e.target.value;
        if (v === 'model') {
          // the people's names: the risk-of-bias verification list's, else whoever the lists name, asked to confirm
          const named = verifyLists(get()).find(l => l.kind === 'rob')?.people || checkPeople(get()), was = peopleOf(get());
          const a = await ask('Reviewer A', { value: was.a || named[0] || '', placeholder: 'Name', confirm: 'Next' });
          const b = a == null ? null : await ask('Reviewer B', { value: was.b || named[1] || '', placeholder: 'Name', confirm: 'Start' });
          if (a == null || b == null) { ctx.rerender(); return; }
          update(st => setModelReader(st, true, toolIds(), { people: { a, b }, by: 'the model' }));
        } else update(st => { if (modelOn(st)) setModelReader(st, false, toolIds()); return setSecond(st, v === 'two', toolIds()); });
        who = 'a'; ctx.rerender(); ctx.refreshCounts?.();
      };
      el.querySelector('[data-custom-tools]').onclick = () => { openInstruments(); ctx.openItem?.(); ctx.rerender(); };
      el.querySelector('[data-default-tool]').onchange = e => { update(st => { st.appraisalTool = e.target.value; return st; }); focused = null; ctx.rerender(); ctx.refreshCounts?.(); };
      // The review's own rule for grading a checklist: nothing is graded until both cut-offs are given.
      const rule = () => {
        const low = el.querySelector('[data-rule="low"]').value.trim(), mod = el.querySelector('[data-rule="moderate"]').value.trim();
        update(st => { if (low !== '' && mod !== '' && Number.isFinite(+low) && Number.isFinite(+mod)) st.appraisalRule = { low: +low, moderate: +mod, source: 'set in Appraisal' }; else delete st.appraisalRule; return st; });
      };
      el.querySelectorAll('[data-rule]').forEach(i => i.onchange = () => { rule(); ctx.rerender(); });
    },
  };
}

/** Cohen's kappa per domain between the two reviewers, across the included studies at this level. */
function agreementSection(s, tool, lvl) {
  const ids = studies(s).map(p => p.id);
  const rowsHtml = columnsOf(tool).map(d => {
    const k = kappa(pairsFor(s, ids, tool.id, lvl, d.id));
    return `<dt>${esc(d.short)}</dt><dd>${k.n < 2 ? `${k.n} ${k.n === 1 ? 'pair' : 'pairs'}` : k.kappa == null ? `κ undefined; ${k.n} pairs, one category` : `κ ${k.kappa.toFixed(2)}, ${k.n} pairs, ${Math.round(k.po * 100)}% agree`}</dd>`;
  }).join('');
  // with the model as a third reader, each person against the model too
  const vm = modelOn(s) ? modelAgreement(s, ids, tool, lvl) : null;
  const k1 = k => (k.n < 2 ? `${k.n} ${k.n === 1 ? 'pair' : 'pairs'}` : k.kappa == null ? `κ undefined; ${k.n} pairs` : `κ ${k.kappa.toFixed(2)}, ${Math.round(k.po * 100)}% agree`);
  const vsModel = vm ? columnsOf(tool).map(d => `<dt>${esc(d.short)} with the model</dt><dd>${esc(readerName(s, 'a'))} ${k1(vm[d.id]?.a || { n: 0 })}; ${esc(readerName(s, 'b'))} ${k1(vm[d.id]?.b || { n: 0 })}</dd>`).join('') : '';
  return { title: 'Agreement', meta: lvl === STUDY ? 'Study level' : '', html: `<dl class="props">${rowsHtml}${vsModel}</dl>` };
}

function exportCsv() {
  const st = get(), two = secondOn(st);
  const ids = [...new Set(studies(st).map(p => toolFor(st, p.id).id))];
  const tools = ids.map(id => appraisalTool(id, st));
  // one file: every instrument's items side by side under the instrument's own headings, so the file reads as the table it came from
  const cols = tools.flatMap(t => columnsOf(t).map(c => ({ t, c })));
  const heads = c => tools.length > 1 ? `${c.t.name}: ${c.c.label}` : c.c.label;
  const out = [['Study', 'Instrument', 'Level', ...cols.map(heads), ...(tools.some(t => isChecklist(t)) ? ['Items met', 'Items applicable', 'Proportion met (%)', 'Risk of bias'] : []),
    ...(two ? [...cols.map(c => `${heads(c)} (A)`), ...cols.map(c => `${heads(c)} (B)`), 'Consensus'] : [])]];
  for (const p of studies(st)) {
    const tool = toolFor(st, p.id);
    for (const [lvl, name] of levelsOf(st, tool)) {
      if (lvl !== STUDY && !assessedAt(st, p.id, tool.id, lvl)) continue;
      const a = finalAnswers(st, p.id, tool.id, lvl);
      const ra = answersBy(st, p.id, tool.id, lvl, 'a'), rb = answersBy(st, p.id, tool.id, lvl, 'b');
      const m = isChecklist(tool) ? itemsMet(a, tool) : null;
      out.push([p.label, tool.name, name, ...cols.map(x => x.t.id === tool.id ? a[x.c.id] || '' : ''),
        ...(tools.some(t => isChecklist(t)) ? [m?.met ?? '', m?.applicable ?? '', m?.pct == null ? '' : Math.round(m.pct * 10) / 10, m ? gradeBy(m.pct, st.appraisalRule) : ''] : []),
        ...(two ? [...cols.map(x => x.t.id === tool.id ? ra[x.c.id] || '' : ''), ...cols.map(x => x.t.id === tool.id ? rb[x.c.id] || '' : ''), consensusState(st, p.id, tool, lvl).state] : [])]);
    }
  }
  downloadCsv(out, 'appraisal.csv');
}

// ---- the grid: every study's items at once ------------------------------------------
// A review of dozens of reports is appraised by reading each one, and the form asks for one study at a time. The grid is the risk-of-bias table as
// a paper prints it (robvis): one block per instrument, its studies together; a row a study, a column an item; each cell the traffic light's mark
// for its judgement, pressed to choose another from the instrument's levels. A row's items met and grade, or its overall, follow the answers.
const GRID_PAGE = 30;
const cellLabel = (p, d, v) => `${p.label}, ${d.short} ${d.label}: ${v || 'not answered'}`;
const gridCell = (p, tool, d, v) => `<td class="rg-cell"><button type="button" class="rg-dot" data-g="${esc(p.id)}" data-t="${esc(tool.id)}" data-q="${esc(d.id)}" data-v="${esc(v)}" title="${esc(cellLabel(p, d, v))}" aria-label="${esc(cellLabel(p, d, v))}">${verdictMark(v)}</button></td>`;
function summaryCells(s, p, tool, a) {
  if (!isChecklist(tool)) {
    const cell = (v, attr) => `<td class="grid-sum"${attr}><span class="rob-verdict">${verdictMark(v)}<span class="rob-final" data-tone="${verdictTone(v) || 'empty'}">${esc(v || '—')}</span></span></td>`;
    // the project's rule gives Overall; when it is not the instrument's own algorithm, that algorithm's overall stands beside it (lib/rob-overall.mjs)
    return cell(a[OVERALL] || scoreMark(tool, a), ` data-sum="${esc(p.id)}"`) + (severestColumn(tool, projectRule(tool.id)) ? cell(severestOf(tool, a), ' data-severest') : '');
  }
  const m = itemsMet(a, tool), g = gradeBy(m.pct, s.appraisalRule);
  return `<td class="grid-sum num" data-sum="${esc(p.id)}">${m.applicable ? `${m.met} of ${m.applicable}` : ''}</td><td class="grid-grade" data-grade="${esc(p.id)}"><span class="rob-final" data-tone="${verdictTone(g) || 'empty'}">${esc(g || '')}</span></td>`;
}
function gridHtml(s) {
  // studies of one instrument together, the instrument most studies use first; the page turns over that order
  const all = rows(s), count = new Map();
  for (const p of all) { const id = toolFor(s, p.id).id; count.set(id, (count.get(id) || 0) + 1); }
  const order = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  const list = [...all].sort((a, b) => order.indexOf(toolFor(s, a.id).id) - order.indexOf(toolFor(s, b.id).id));
  const view = pageOf(list, gridPage, GRID_PAGE);
  gridPage = view.page;
  const sections = [];
  for (const p of view.items) {
    const tool = toolFor(s, p.id), last = sections.at(-1);
    if (last && last.tool.id === tool.id) last.items.push(p); else sections.push({ tool, items: [p] });
  }
  // the studies the page lists (a trial's further reports and excluded records keep their answers but are not studies here)
  const listed = new Set(studies(s).map(p => p.id)), counts = gradeCounts(assessmentRows(s).filter(r => listed.has(r.paperId)));
  const summary = Object.entries(counts).map(([t, by]) => `${appraisalTool(t, s).name}: ${Object.entries(by).map(([g, n]) => `${n} ${g.toLowerCase()}`).join(', ')}`).join('; ');
  const body = sections.map(({ tool, items }) => { const check = isChecklist(tool);
    return `<table class="rob-grid"><caption><span class="rg-name">${esc(tool.name)}</span><span class="meta">${esc(`${count.get(tool.id)} ${count.get(tool.id) === 1 ? 'study' : 'studies'}`)}</span></caption>
    <thead><tr><th scope="col" class="rg-study">Study</th>${tool.domains.map(d => `<th scope="col" class="rg-code" title="${esc(d.label)}">${esc(d.short)}</th>`).join('')}
      ${check ? '<th scope="col" class="num">Met</th><th scope="col">Grade</th>' : `<th scope="col">Overall</th>${severestColumn(tool, projectRule(tool.id)) ? `<th scope="col" title="${esc(severestColumn(tool, projectRule(tool.id)).label)}">${esc(severestColumn(tool, projectRule(tool.id)).short)}</th>` : ''}`}<th scope="col" class="rg-end"><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${items.map(p => { const a = answers(s, p.id, tool, STUDY);
      return `<tr data-row="${esc(p.id)}"><th scope="row" class="study-cell">${uiLink({ label: p.label, attrs: { 'data-open': p.id } })}</th>${tool.domains.map(d => gridCell(p, tool, d, a[d.id] || '')).join('')}${summaryCells(s, p, tool, a)}
        <td class="rg-end">${check && tool.judgements.includes('Yes') ? `<button type="button" class="quiet rg-fill" data-allyes="${esc(p.id)}" title="Answer the empty items of ${esc(p.label)} with Yes" aria-label="Answer the empty items of ${esc(p.label)} with Yes">${icon('check-square', { size: 14 })}</button>` : ''}</td></tr>`; }).join('')}</tbody></table>`; }).join('');
  // the title bar names the page, the switch says Grid and counts the studies: the panel's head is only the grades, when there are any
  return `<div class="panel">${summary ? `<div class="panel-head"><span class="meta">${esc(summary)}</span></div>` : ''}
    <div class="panel-body tight rg-body">${body || emptyState({ title: 'Nothing to appraise', size: 'inline' })}</div>
    ${pager({ id: 'grid-pager', page: view.page, pages: view.pages, total: list.length, label: 'studies', size: GRID_PAGE })}</div>`;
}
function wireGrid(el, ctx) {
  const refreshRow = (paperId, toolId2) => {
    const st = get(), tool = appraisalTool(toolId2, st), p = (st.papers || []).find(x => x.id === paperId), tr = el.querySelector(`tr[data-row="${CSS.escape(paperId)}"]`);
    if (!p || !tr) return;
    const cells = document.createElement('tbody');
    cells.innerHTML = `<tr>${summaryCells(st, p, tool, answers(st, p.id, tool, STUDY))}</tr>`;
    const fresh = [...cells.firstElementChild.children];
    tr.querySelector('[data-sum]').replaceWith(fresh[0]);
    const g = tr.querySelector('[data-grade]'); if (g && fresh[1]) g.replaceWith(fresh[1]);
    const sv = tr.querySelector('[data-severest]'), fs = fresh.find(x => x.hasAttribute('data-severest')); if (sv && fs) sv.replaceWith(fs);
    // the head's counts move with the answers, the page does not
    const meta = el.querySelector('.panel-head .meta');
    if (meta) { const ids = new Set(studies(st).map(x => x.id)), c = gradeCounts(assessmentRows(st).filter(r => ids.has(r.paperId))); meta.textContent = Object.entries(c).map(([k, by]) => `${appraisalTool(k, st).name}: ${Object.entries(by).map(([x, n]) => `${n} ${x.toLowerCase()}`).join(', ')}`).join('; '); }
  };
  const set = (paperId, toolId2, domain, value) => update(st => answerWith(st, appraisalTool(toolId2, st), { paperId, level: STUDY, who: 'a', domain, value }));
  const paint = (b, v) => { const st = get(), tool = appraisalTool(b.dataset.t, st), d = tool.domains.find(x => x.id === b.dataset.q), p = (st.papers || []).find(x => x.id === b.dataset.g);
    b.dataset.v = v; b.innerHTML = verdictMark(v); if (d && p) { b.title = cellLabel(p, d, v); b.setAttribute('aria-label', cellLabel(p, d, v)); } };
  const choose = (b, v) => { set(b.dataset.g, b.dataset.t, b.dataset.q, v); paint(b, v); refreshRow(b.dataset.g, b.dataset.t); ctx.refreshCounts?.(); };
  el.querySelectorAll('button.rg-dot').forEach(b => b.onclick = () => {
    const tool = appraisalTool(b.dataset.t, get()), d = tool.domains.find(x => x.id === b.dataset.q), levels = d?.judgements || tool.judgements, cur = b.dataset.v;
    showMenu(b, [{ heading: `${d?.short || ''} ${d?.label || ''}`.trim() }, ...levels.map(v => ({ label: v, checked: v === currentLevel(cur), run: () => choose(b, v) })), '-', { label: 'Not answered', checked: !cur, run: () => choose(b, '') }], { align: 'start', minWidth: 220 });
  });
  el.querySelectorAll('[data-allyes]').forEach(b => b.onclick = () => {
    const tr = b.closest('tr');
    for (const dot of tr.querySelectorAll('button.rg-dot')) if (!dot.dataset.v) { set(dot.dataset.g, dot.dataset.t, dot.dataset.q, 'Yes'); paint(dot, 'Yes'); }
    refreshRow(b.dataset.allyes, tr.querySelector('button.rg-dot')?.dataset.t);
    ctx.refreshCounts?.();
  });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { pick = b.dataset.open; showGrid = false; ctx.rerender(); });
  wirePager(el, 'grid-pager', n => { gridPage = n; const host = el.querySelector('#appraisal-grid-region') || el; host.innerHTML = gridHtml(get()); wireGrid(host,ctx); host.querySelector('#grid-pager button:not(:disabled)')?.focus({preventScroll:true}); });
}

// ---- the studies the figures draw (lib/rob-scope.mjs): every study appraised, those contributing to an outcome's syntheses, or a chosen set,
// saved with the instrument's figures in s.robFigures
const scopeValue = (s, tool) => { const c = robScope(s, tool.id); return !c ? 'all' : c.scope === 'outcome' ? `outcome:${c.outcome}` : 'chosen'; };
const scopeOptions = (s, tool) => [['all', 'Every appraised study'], ...(s.outcomes || []).filter(o => o?.id && o.name).map(o => [`outcome:${o.id}`, `Studies in the syntheses of ${o.name}`]),
  ['chosen', robScope(s, tool.id)?.scope === 'chosen' ? 'Chosen studies' : 'Choose studies']];
function scopeSelect(s, tool, appraised) {
  if (!appraised.length) return '';
  return `<select id="fig-scope" aria-label="Studies">${scopeOptions(s, tool).map(([v, l]) => `<option value="${esc(v)}"${v === scopeValue(s, tool) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function wireScope(el, ctx, tool, appraised) {
  const save = c => { update(st => { const all = { ...(st.robFigures || {}) }; if (c) all[tool.id] = c; else delete all[tool.id]; st.robFigures = all; return st; }); ctx.rerender(); };
  // the chosen set: each appraised study checked while the figures draw it
  const choose = at => {
    const kept = new Set(robScope(get(), tool.id)?.studies || appraised.map(r => r.study));
    showMenu(at, appraised.map(r => ({ label: r.label, checked: kept.has(r.study), checkType: 'checkbox', run: () => {
      const next = new Set(kept); if (next.has(r.study)) next.delete(r.study); else next.add(r.study);
      save({ scope: 'chosen', studies: appraised.map(x => x.study).filter(id => next.has(id)) });
    } })));
  };
  el.querySelector('#fig-scope')?.addEventListener('change', async e => {
    const v = e.target.value;
    if (v === 'all') return save(null);
    if (v === 'chosen') return choose(e.target);
    const id = v.slice(8), o = (get().outcomes || []).find(x => x.id === id);
    const { synthesisModel } = await import('../lib/synth-project.mjs'), ids = outcomeStudies(synthesisModel(get()), id);
    save({ scope: 'outcome', outcome: id, label: o?.name || id, studies: appraised.map(r => r.study).filter(x => ids.has(x)) });
  });
}

function figuresHtml(s, tool, done, used = [], appraised = done) {
  const levels = levelsOf(s, tool);
  const pickScope = scopeSelect(s, tool, appraised);
  const pickTool = used.length > 1 ? `<select id="fig-tool" aria-label="Instrument">${used.map(({ t, n, done }) => `<option value="${esc(t.id)}"${t.id === tool.id ? ' selected' : ''}>${esc(`${t.name} (${done} of ${n} complete)`)}</option>`).join('')}</select>` : '';
  const pickLevel = levels.length > 1 ? `<select id="fig-level" aria-label="Level">${levels.map(([id, l]) => `<option value="${esc(id)}"${id === levelNow(s, tool) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '';
  if (!done.length) return `<div class="panel">${uiBar({ kind: 'head', label: 'Figures', id: 'fig-empty-head', cls: 'panel-head', lead: { text: appraised.length ? 'No appraised study in this set' : 'No complete assessment', level: 'p' },
    filters: [...(levels.length > 1 ? [{ type: 'select', id: 'fig-level', label: 'Level', options: levels.map(([id, l]) => [id, l]), value: levelNow(s, tool) }] : []),
      ...(appraised.length ? [{ type: 'select', id: 'fig-scope', label: 'Studies', options: scopeOptions(s, tool), value: scopeValue(s, tool) }] : [])] })}</div>`;
  // Weighting is offered only when the pooled analysis recorded its weights.
  const w = analysisWeights(get().analysis);
  // the weighting is the Summary's view: a select in its head, like the traffic light's level
  const toggle = w ? `<select id="sm-weight" aria-label="Summary weighting">${[[false, 'Unweighted'], [true, 'Weighted']].map(([k, l]) =>
    `<option value="${k}"${k === weighted ? ' selected' : ''}>${l}</option>`).join('')}</select>` : '';
  // the layout is the figures' view, like the instrument: the house drawing, or robvis's template for this instrument
  const pickLayout = `<select id="fig-layout" aria-label="Layout">${[['house', 'House drawing'], ['robvis', `robvis, ${ROBVIS_TEMPLATES[robvisTemplateFor(tool)].label} template`]].map(([k, l]) => `<option value="${k}"${k === figLayout ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `${figurePanel({ title: 'Traffic light', id: 'tl', extra: `${pickTool}${pickLevel}${pickScope}${pickLayout}` })}${figurePanel({ title: 'Summary', id: 'sm', extra: toggle })}`;
}

/** Leaving Appraisal closes the sub-page: the page comes back on its studies. `again`: the page is only repainted. */
export function unmount(again = false) { if (!again) closeInstruments(); }

export function render(el, ctx) {
  shownCtx = ctx;
  // the instruments sub-page is the page alone: the list pane is not drawn beside it (the shell's focus mode), and it comes back with Back
  if (instrumentsOpen()) { ctx.focus?.(true); renderInstruments(el, ctx); return; }
  ctx.focus?.(false);
  if (pageGeneration !== projectGeneration()) { gridPage = 1; pageGeneration = projectGeneration(); }
  const s = get();
  const dflt = appraisalTool(toolId(s), s);
  const all = studies(s);
  if (!all.length) {
    const screening = screeningStarted(s);
    el.innerHTML = emptyState({ icon: 'appraisal', title: screening ? 'No included studies' : 'No studies to appraise',
      actions: [screening ? { id: 'e-go', label: 'Screening', icon: 'screening', primary: true }
                          : { id: 'e-go', label: 'Library', icon: 'library', primary: true }] });
    el.querySelector('#e-go').onclick = () => ctx.go(screening ? 'screening' : 'library');
    return;
  }
  const p = pick && all.find(x => x.id === pick);
  // the study in the detail is judged with its own instrument; the figures draw the review's, over the studies that use it
  // the charts draw one instrument at a time: the one chosen, else the one most studies use (a review mixes JBI, ROBINS-I and RoB 2 by design)
  const used = new Map();
  for (const x of all) { const t = toolFor(s, x.id), u = used.get(t.id) || { t, n: 0, done: 0 }; u.n++; if (isComplete(t, answers(s, x.id, t, levelNow(s, t)))) u.done++; used.set(t.id, u); }
  const byUse = [...used.values()].sort((a, b) => b.done - a.done || b.n - a.n);   // the instrument with the most complete assessments first
  const tool = p ? toolFor(s, p.id) : dflt, figTool = (chartTool && used.get(chartTool)?.t) || byUse[0]?.t || dflt;
  const lvl = levelNow(s, tool), side = whoNow(s), two = secondOn(s);
  // the figures draw the final judgements at the level in view: an outcome's own, else the study's
  const figLvl = levelNow(s, figTool);
  const second = severestColumn(figTool, projectRule(figTool.id));
  const appraised = all.filter(x => toolFor(s, x.id).id === figTool.id).map(x => { const values = answers(s, x.id, figTool, figLvl);
    return { study: x.id, label: x.label, values: second ? { ...values, [SEVEREST]: severestOf(figTool, values) } : values }; }).filter(r => isComplete(figTool, r.values));
  const drawTool = second ? { ...figTool, after: [second] } : figTool;
  // the studies the figures draw: every one appraised, or those the saved choice keeps (lib/rob-scope.mjs)
  const done = inRobScope(s, figTool.id, appraised);
  if (focused && focused.p !== p?.id) focused = null;
  // what the page shows is the title bar's switch: one study's assessment, the grid of every study, or the charts
  const shows = pageShows(s), gridding = shows === 'grid';

  el.innerHTML = shows === 'charts' ? figuresHtml(s, figTool, done, byUse, appraised) : gridding ? `<div id="appraisal-grid-region">${gridHtml(s)}</div>` : p ? detailHtml(s, tool, p, lvl, side, two) : emptyState({ icon: 'appraisal', title: 'No study selected' });
  if (gridding) wireGrid(el, ctx);

  if (shows === 'charts' && done.length) {
    // Drawn here rather than in R: no engine start, no package fetch, no wait.
    // On screen and in the file, the house drawing (FIGURE-STYLE §2); the file is the print copy with its source line.
    const screen = figureTokens(null, { medium: 'screen' }), print = figureTokens(null, { medium: 'export' });
    const source = [robScopeWords(s, figTool.id, done.length) || `${done.length} of ${all.length} studies appraised${two ? ', final judgements' : ''}`];
    const cols = [...figTool.domains, ...(figTool.overall ? [{ id: 'overall', label: 'Overall' }] : []), ...(drawTool.after || [])];
    const judgements = () => [['Study', ...cols.map(d => d.label)], ...done.map(r => [r.label, ...cols.map(d => r.values[d.id] || '')])];
    const robvis = figLayout === 'robvis', fig = robvis ? figTool : drawTool, drawTl = robvis ? robvisTrafficLight : trafficLight, drawSm = robvis ? robvisSummary : summaryBars, suffix = robvis ? '-robvis' : '';
    const w = weighted ? analysisWeights(s.analysis) : null;
    // a study's name selects it in the list and shows its assessment, a judgement at its domain (focusPaper); the page, not Details over it
    const openFromFigure = (id, at) => { focusPaper(id, at); ctx.openItem?.(); ctx.rerender(); };
    // on screen the house layout is the screen figure (lib/rob-screen.mjs), as Submission's page draws it: 12 px type, 16 px marks, its own
    // size; the robvis layout shows robvis's drawing; the file is the print copy either way
    const screenTl = robvis ? drawTl(fig, done, JUDGEMENT_TONE, { style: screen }) : robScreen(fig, done, { style: screen, tones: JUDGEMENT_TONE, part: 'grid' });
    const screenSm = robvis ? drawSm(fig, done, JUDGEMENT_TONE, { weights: w, style: screen }) : robScreen(fig, done, { style: screen, tones: JUDGEMENT_TONE, weights: w, part: 'bars' });
    showFigure(el, 'tl', screenTl, `appraisal-traffic-light${suffix}`,
      { open: openFromFigure, exportSvg: () => drawTl(fig, done, JUDGEMENT_TONE, { style: print, source }), data: judgements });
    // a segment's press lists its studies under the figure (lib/figure-drill.mjs), each opening its judgement
    showFigure(el, 'sm', screenSm, `${w ? 'appraisal-summary-weighted' : 'appraisal-summary'}${suffix}`,
      { open: openFromFigure, exportSvg: () => drawSm(fig, done, JUDGEMENT_TONE, { weights: w, style: print, source }), data: judgements });
    const sm = el.querySelector('#sm-meta');
    if (sm && w) sm.textContent = `${done.filter(r => w.has(r.label)).length} of ${done.length} in the analysis`;
    el.querySelector('#sm-weight')?.addEventListener('change', e => { weighted = e.target.value === 'true'; ctx.rerender(); });
    const m = el.querySelector('#tl-meta'); if (m) m.textContent = robScopeWords(s, figTool.id, done.length) || `${done.length} of ${all.length} complete${two ? ', final judgements' : ''}`;
  }
  el.querySelector('#fig-level')?.addEventListener('change', e => { level = e.target.value; ctx.rerender(); ctx.refreshCounts?.(); });
  el.querySelector('#fig-tool')?.addEventListener('change', e => { chartTool = e.target.value; ctx.rerender(); });
  wireScope(el, ctx, figTool, appraised);
  el.querySelector('#fig-layout')?.addEventListener('change', e => { figLayout = e.target.value === 'robvis' ? 'robvis' : 'house'; ctx.rerender(); });
  if (!p || shows !== 'study') return;

  el.querySelector('#open-doc').onclick = () => openStudy(ctx, p.id);
  const form = el.querySelector('.rob-form');
  const track = e => { const row = e.target.closest?.('.ui-row[data-d]'); if (row) focused = { p: p.id, d: row.dataset.d }; };
  form?.addEventListener('focusin', track);
  form?.addEventListener('pointerdown', track);
  // an item's row opens its meaning and who decided what, one item at a time; the note is written only when asked for. Only the block under
  // the item is drawn again, not the page (owner, 25 Oct 2026: the reveal lagged), and the whole row is the target, not only its name.
  const own = lvl === STUDY || assessedAt(s, p.id, tool.id, lvl), eff = own ? lvl : STUDY;
  const mineNow = () => (side === 'reconcile' ? finalAnswers(get(), p.id, tool.id, eff) : answersBy(get(), p.id, tool.id, eff, side === 'b' ? 'b' : 'a'));
  const placeGuide = (focusNote = false) => {
    if (!form) return;
    form.querySelectorAll('.rob-guide').forEach(x => x.remove());
    form.querySelectorAll('button.rob-ask[aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
    if (!guideAt?.startsWith(`${tool.id}|`)) return;
    const key = guideAt.slice(tool.id.length + 1);
    const b = [...form.querySelectorAll('button.rob-ask')].find(x => x.dataset.guide === key), row = b?.closest('.ui-row');
    if (!row) return;
    b.setAttribute('aria-expanded', 'true');
    row.insertAdjacentHTML('afterend', guideHtml(get(), tool, key, mineNow()[key], key.includes('.'), { p, lvl: eff }));
    const t = row.nextElementSibling?.querySelector('textarea[data-guide-note]');
    if (t) {
      const done = keep => { if (noteEditing === null) return; noteEditing = null; if (keep && t.value.trim() !== guideNote(get(), tool, key)) update(st => setGuideNote(st, tool, key, t.value)); placeGuide(); };
      t.addEventListener('blur', () => done(true));
      t.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      if (focusNote) t.focus();
    }
  };
  form?.addEventListener('click', e => {
    const why = e.target.closest?.('button[data-guide-why]');
    if (why) { const li = why.closest('li'), on = !li.hasAttribute('data-why'); li.toggleAttribute('data-why', on); why.setAttribute('aria-expanded', String(on)); why.textContent = on ? 'Hide why' : 'Why'; return; }
    const moreB = e.target.closest?.('button[data-guide-more]');
    if (moreB) { const k = `${tool.id}|${moreB.dataset.guideMore}`; guideMore = guideMore === k ? null : k; placeGuide(); return; }
    const edit = e.target.closest?.('button[data-guide-edit]');
    if (edit) { noteEditing = `${tool.id}|${edit.dataset.guideEdit}`; placeGuide(true); return; }
    if (e.target.closest?.('select, textarea, input, a, .rob-guide') || (e.target.closest?.('button') && !e.target.closest('button.rob-ask'))) return;
    const b = e.target.closest?.('.ui-row')?.querySelector('button.rob-ask'); if (!b) return;
    const k = `${tool.id}|${b.dataset.guide}`;
    guideAt = guideAt === k ? null : k; noteEditing = null; guideMore = null;
    placeGuide();
  });

  // arrived from a figure's judgement: that domain's row in view, its guide open and its judgement focused
  if (reveal?.p === p.id) {
    const d = reveal.d, row = form?.querySelector(`.ui-row[data-d="${CSS.escape(d)}"]:not(.rob-q)`);
    reveal = null;
    if (row) {
      focused = { p: p.id, d };
      if (row.querySelector(`button.rob-ask[data-guide="${CSS.escape(d)}"]`)) { guideAt = `${tool.id}|${d}`; noteEditing = null; guideMore = null; placeGuide(); }
      row.scrollIntoView({ block: 'nearest' });
      row.querySelector('select')?.focus({ preventScroll: true });
    }
  }

  // the instrument of this study; the review's own is chosen under Review
  el.querySelector('#tool').onchange = e => {
    // kept as the person's choice unless it is what the study takes anyway (its design's, or the review's)
    update(st => chooseInstrument(st, p.id, e.target.value));
    focused = null;
    ctx.rerender(); ctx.refreshCounts();
  };
  el.querySelector('#rob-level')?.addEventListener('change', e => { level = e.target.value; ctx.rerender(); });
  el.querySelectorAll('[data-who]').forEach(b => b.onclick = () => { who = b.dataset.who; ctx.rerender(); });
  // an outcome judged on its own: starts from the study-level answers, each reviewer's own
  el.querySelector('#rob-own')?.addEventListener('click', () => { update(st => startLevel(st, { paperId: p.id, toolId: tool.id, level: lvl, toolIds: toolIds() })); ctx.rerender(); });
  el.querySelector('#rob-study')?.addEventListener('click', () => { update(st => clearLevel(st, { paperId: p.id, toolId: tool.id, level: lvl })); ctx.rerender(); ctx.refreshCounts?.(); });
  el.querySelectorAll('#rob-consensus,#rob-reopen').forEach(b => b.addEventListener('click', () => {
    const on = consensusState(get(), p.id, tool, lvl).state !== 'agreed';
    update(st => confirmConsensus(st, { paperId: p.id, tool, level: lvl, on })); ctx.rerender(); ctx.refreshCounts?.();
  }));

  // a reviewer's answer
  el.querySelectorAll('select[data-d]').forEach(sel => sel.onchange = () => {
    update(st => answerWith(st, tool, { paperId: p.id, level: lvl, who: side === 'b' ? 'b' : 'a', domain: sel.dataset.d, value: sel.value }));
    ctx.refreshCounts();
    ctx.rerender();
  });
  // Reconcile: a resolved value needs its reason, and is kept only with one
  const resolve = row => {
    const d = row.dataset.resolve, value = row.querySelector('select[data-final]').value, reason = row.querySelector('textarea[data-reason]')?.value || '';
    const err = row.querySelector('.rob-error');
    if (value && !reason.trim()) { if (err) { err.hidden = false; err.textContent = 'A reason is needed'; } return; }
    update(st => resolveDomain(st, { paperId: p.id, toolId: tool.id, level: lvl, domain: d, value, reason, toolIds: toolIds() }));
    ctx.refreshCounts(); ctx.rerender();
  };
  el.querySelectorAll('.ui-row[data-resolve]').forEach(row => {
    row.querySelector('select[data-final]').onchange = () => resolve(row);
    row.querySelector('textarea[data-reason]')?.addEventListener('change', () => { if (row.querySelector('select[data-final]').value) resolve(row); });
  });
}

// The detail: the study's head, the level and reviewer bar, and the form for
// the reviewer in view, or the reconciliation of the two.
function detailHtml(s, tool, p, lvl, side, two) {
  const cols = columnsOf(tool), ruled = tool.custom && tool.overallRule === 'worst';
  const own = lvl === STUDY || assessedAt(s, p.id, tool.id, lvl);
  const eff = own ? lvl : STUDY;
  const mine = side === 'reconcile' ? finalAnswers(s, p.id, tool.id, eff) : answersBy(s, p.id, tool.id, eff, side === 'b' ? 'b' : 'a');
  const n = tool.domains.filter(d => mine[d.id]).length;
  const opts = (j, list = tool.judgements) => ['', ...list].map(v =>
    `<option value="${esc(v)}"${v === currentLevel(j) ? ' selected' : ''}${ANSWER_WORDS[v] ? ` title="${esc(v)}"` : ''}>${esc(ANSWER_WORDS[v] || v) || '—'}</option>`).join('');
  const levels = levelsOf(s, tool), c = two ? consensusState(s, p.id, tool, eff) : null;
  const STATE = { empty: 'Not started', waiting: 'Waiting', open: `${c?.open} to reconcile`, ready: 'Ready to confirm', agreed: 'Confirmed' };
  // The level, the reviewer and the consensus are one bar; each control that does not always apply holds its place: the level and the
  // reviewer switch exist for the whole review, "Use study level" is a reserved slot, and the consensus control is present while
  // two reviewers work and enabled while their answers can be confirmed.
  const canConfirm = two && side === 'reconcile' && (c.state === 'ready' || c.state === 'agreed');
  const bar = uiBar({ kind: 'tools', label: 'Assessment', id: 'rob-tools',
    filters: [{ type: 'select', id: 'tool', label: 'Instrument', options: allTools(s).map(t => [t.id, t.name]), value: tool.id },
      ...(levels.length > 1 ? [{ type: 'select', id: 'rob-level', label: 'Level', value: lvl, options: levels }] : [])],
    view: two ? { id: 'rob-who', label: 'Reviewer', attr: 'data-who', value: side, items: [['a', modelOn(s) ? firstName(readerName(s, 'a')) : 'Reviewer A'], ['b', modelOn(s) ? firstName(readerName(s, 'b')) : 'Reviewer B'], ['reconcile', 'Reconcile']] } : undefined,
    status: two ? { id: 'rob-status', text: STATE[c.state] || '', ch: 16 } : undefined,
    actions: [...(levels.length > 1 ? [{ id: 'rob-study', label: 'Use study level', icon: 'undo', presence: 'reserve', hidden: !(lvl !== STUDY && own) }] : []),
      ...(two ? [uiSwap({ id: 'rob-consensus-slot', members: [{ id: 'rob-consensus', label: 'Confirm consensus', role: 'secondary', disabled: !canConfirm, hidden: c.state === 'agreed' }, { id: 'rob-reopen', label: 'Reopen', role: 'secondary', hidden: c.state !== 'agreed' }] })] : [])] });
  const body = !own
    ? uiNotice({ id: 'rob-inherits', label: 'Study-level assessment', text: 'Uses the study-level assessment', actions: [{ id: 'rob-own', label: 'Assess this outcome', icon: 'plus' }] })
    : side === 'reconcile' ? reconcileHtml(s, tool, p, eff, cols, opts)
    : `${uiList({ label: 'Judgements', cls: 'rob-form', cols: ['judgement'], rows: [
      // a domain leads with its judgement and its signalling questions follow under it (owner, 2026-10-23, "review it please": the domain came
      // after its questions); every menu stands behind the same mark slot, so a question's answer and a domain's judgement start on one edge
      ...cols.flatMap(d => [uiRow({ attrs: { 'data-d': d.id }, main: { html: `${askLabel(tool, d.id, `<span class="rob-code">${esc(d.short)}</span>${d.id === OVERALL ? (ruled ? 'Worst domain judgement' : '') : esc(d.label)}`, d.signals ? d.signals.join('; ') : '')}${reasonLine(s, tool, p, d, mine[d.id])}` },
          cells: [d.id === OVERALL && ruled
            ? { col: 'judgement', kind: 'text', ch: 20, html: `<span class="rob-verdict">${verdictMark(mine[OVERALL] || ruleOverall(tool, mine))}<span class="rob-final" data-ruled data-tone="${verdictTone(mine[OVERALL] || ruleOverall(tool, mine)) || 'empty'}">${esc(mine[OVERALL] || ruleOverall(tool, mine) || '—')}</span></span>` }
            : { col: 'judgement', kind: 'control', html: verdictField(mine[d.id], `<select data-d="${esc(d.id)}" aria-label="${esc(d.label)}">${opts(mine[d.id], d.judgements)}</select>`) }] }),
        guideHtml(s, tool, d.id, mine[d.id], false, { p, lvl: eff }),
        ...(d.questions || []).flatMap((q, k) => [uiRow({ cls: 'rob-q', depth: 1, attrs: { 'data-d': d.id },
          main: { html: `${askLabel(tool, questionKey(d.id, q.id), `<span class="rob-code">${esc(`${d.short}.${k + 1}`)}</span>${esc(q.text)}`)}` },
          cells: [{ col: 'judgement', kind: 'control', html: `<span class="rob-verdict"><span class="rob-mark-slot" aria-hidden="true"></span><select data-d="${esc(questionKey(d.id, q.id))}" aria-label="${esc(q.text)}">${opts(mine[questionKey(d.id, q.id)], q.answers)}</select></span>` }] }), guideHtml(s, tool, questionKey(d.id, q.id), mine[questionKey(d.id, q.id)], true, { p, lvl: eff })])]).filter(Boolean),
      ...derivedRow(tool, mine), ...severestRow(tool, mine)] })}${scoreHtml(s, tool, p, eff, mine, two)}${blindedFor(s, p, tool, eff) ? '' : sweepsHtml(s, tool, p)}`;
  return `<div class="panel">
    ${uiBar({ kind: 'head', label: 'Study', id: 'rob-study-head', cls: 'panel-head', lead: { title: p.label, level: 'h2' }, status: { id: 'rob-count', text: `${n} of ${plural(tool.domains.length, 'domain')}`, ch: 16 },
      actions: [{ id: 'open-doc', label: p.pdf ? 'Open' : 'Record', icon: 'file' }] })}
    ${bar}
    <div class="panel-body tight"><p class="meta rob-why" data-rob-why>${esc(instrumentReason(instrumentChoice(s, p.id)))}</p>${body}</div></div>`;
}

// An item's name, a button that opens what it means when the instrument has meanings (lib/rob-guide.mjs); otherwise the plain name.
function askLabel(tool, key, inner, tip = '') {
  if (!hasGuide(tool) || !itemGuide(tool, key, { question: key.includes('.'), rule: projectRule(tool.id) })) return `<span${tip ? ` title="${esc(tip)}"` : ''}>${inner}</span>`;
  const open = guideAt === `${tool.id}|${key}`;
  return `<button type="button" class="rob-ask" data-guide="${esc(key)}" aria-expanded="${open}"${tip ? ` title="${esc(tip)}"` : ''}>${inner}</button>`;
}
// What an item asks and what each answer means for it, as plain lines under its name (owner, 25 Oct 2026: no card, no table, no box that opens
// by itself): the answer recorded here in full ink, the person's note shown as text and edited only when asked for (kept in the project).
function guideHtml(s, tool, key, chosen, question, at = {}) {
  if (guideAt !== `${tool.id}|${key}`) return '';
  const g = itemGuide(tool, key, { question, rule: projectRule(tool.id) }); if (!g) return '';
  const now = currentLevel(chosen) || '';
  const list = question ? g.options.map(o => ({ k: o.code, word: ANSWER_WORDS[o.code] || o.code, meaning: o.meaning }))
    : g.levels.map(l => ({ k: l.level, word: l.level, meaning: l.meaning }));
  // an answer recorded that the question does not offer is shown, and said so, rather than hidden
  if (now && !list.some(o => o.k === now)) list.push({ k: now, word: ANSWER_WORDS[now] || now, meaning: question ? 'Not among the answers this question offers in the official form; check the answer.' : 'Not a level of this instrument.', off: true });
  const label = o => (question ? `<span class="rob-guide-code">${esc(o.k)}</span><b>${esc(o.word)}</b>` : toned(o.word));
  // first what is short: the question, and the answer recorded with what it means; every answer, the hint and the source only when asked for
  // (owner, 25 Oct 2026: not crowded, not all prose, readable in a narrow pane)
  const cur = list.find(o => o.k === now);
  const more = guideMore === `${tool.id}|${key}`;
  const items = list.map(o => `<li${o.k === now ? ' data-chosen' : ''}${o.off ? ' data-off' : ''}><span class="rob-guide-what">${label(o)}</span><span class="rob-guide-mean">${esc(o.meaning)}</span></li>`).join('');
  const note = guideNote(s, tool, key), editing = noteEditing === `${tool.id}|${key}`;
  const noteHtml = editing
    ? `<textarea class="rob-guide-input" rows="3" data-guide-note="${esc(key)}" aria-label="Note on this item" placeholder="What to remember about this item, for every study">${esc(note)}</textarea>`
    : `${note ? `<p class="rob-guide-noted">${esc(note)}</p>` : ''}`;
  const acts = [`<button type="button" class="rob-guide-edit" data-guide-more="${esc(key)}" aria-expanded="${more}">${more ? 'Fewer answers' : question ? 'All answers' : 'All levels'}</button>`,
    editing ? '' : `<button type="button" class="rob-guide-edit" data-guide-edit="${esc(key)}">${note ? 'Edit note' : 'Add a note'}</button>`].join('');
  return `<div class="rob-guide" data-guide-for="${esc(key)}"${question ? ' data-q' : ''}>
    <p class="rob-guide-asks">${esc(g.asks)}</p>${g.when ? `<p class="rob-guide-quiet">${esc(g.when)}</p>` : ''}
    ${cur && !more ? `<ul class="rob-guide-answers" aria-label="The answer recorded"><li data-chosen${cur.off ? ' data-off' : ''}><span class="rob-guide-what">${label(cur)}</span><span class="rob-guide-mean">${esc(cur.meaning)}</span></li></ul>` : ''}
    ${more ? `${g.look ? `<p>${esc(g.look)}</p>` : ''}<ul class="rob-guide-answers" aria-label="${question ? 'What each answer means' : 'What each level means'}">${items}</ul><p class="rob-guide-quiet">${esc(g.source)}</p>` : ''}
    ${at.p ? decisionsHtml(s, tool, at.p, at.lvl, key, question) : ''}
    ${noteHtml ? `<div class="rob-guide-note">${noteHtml}</div>` : ''}
    <p class="rob-guide-acts">${acts}</p></div>`;
}

// a judgement with its light and its colour, as the form's menus show it
const toned = v => `<span class="rob-verdict rob-guide-toned">${verdictMark(v)}<span class="rob-final" data-tone="${verdictTone(v) || 'empty'}">${esc(v)}</span></span>`;
// Who decided what on one item (owner, 25 Oct 2026: "show the model and human decisions under them"): the reviewers' answers in this study's
// record, each model's readings (lib/rob-sweep.mjs; a question's answer, or a domain's judgement with its reason), the review of the domain
// against the full text and other reviewers' notes on it. Plain lines in the meaning's column, one per who.
function decisionsHtml(s, tool, p, lvl, key, question) {
  const [dom, qid] = question ? key.split('.') : [key, ''];
  const word = v => (question ? ANSWER_WORDS[v] || v : v);
  const show = v => (question ? `<b>${esc(word(v))}</b>` : toned(v));
  const lines = [];
  // who (with its app's mark), what it decided, whether that differs from the record, and its reason folded to two lines until pressed
  let recorded = '';
  const line = (who, what, why = '', { by = '', value = '' } = {}) => lines.push(`<li><span class="rob-guide-who">${by ? agentMark(by) : '<span class="rob-guide-mark" aria-hidden="true"></span>'}<span>${esc(who)}</span></span><span class="rob-guide-say"><span class="rob-guide-what">${what}${value && recorded && currentLevel(value) !== recorded ? '<span class="rob-guide-differs" title="Differs from the answer recorded">Differs</span>' : ''}${why ? '<button type="button" class="rob-guide-edit" data-guide-why aria-expanded="false">Why</button>' : ''}</span>${why ? `<span class="rob-guide-why">${esc(why)}</span>` : ''}</span></li>`);
  // the record: reviewer A, and B with the final value when a second reviewer works; how it was made, as the record says
  const rec = s.robReview?.records?.[p.id]?.[tool.id]?.[lvl] || {};
  const two = secondOn(s);
  const va = answersBy(s, p.id, tool.id, lvl, 'a')[key], vb = two ? answersBy(s, p.id, tool.id, lvl, 'b')[key] : '';
  const fin = two ? finalAnswers(s, p.id, tool.id, lvl)[key] : '';
  recorded = currentLevel(fin || va) || '';
  // two people and the model: while a person's own assessment is not complete, only their own answer shows (no other reader's)
  const blind = blindedFor(s, p, tool, lvl), mineOnly = blind ? whoNow(s) : '';
  if (modelOn(s)) {
    if (va && (!blind || mineOnly === 'a')) line(readerName(s, 'a'), show(currentLevel(va)));
    if (vb && (!blind || mineOnly === 'b')) line(readerName(s, 'b'), show(currentLevel(vb)));
    const vm = answersBy(s, p.id, tool.id, lvl, 'model')[key];
    if (vm && !blind) line('The model', show(currentLevel(vm)), '', { by: rec.modelFrom?.by || '' });
    if (blind) return lines.length ? `<div class="rob-guide-decided"><p class="rob-guide-quiet">Yours</p><ul class="rob-guide-answers rob-guide-people">${lines.join('')}</ul></div>` : '';
  } else {
    if (va) line(two ? 'Reviewer A' : 'Recorded', `${show(currentLevel(va))}${rec.doc?.status ? `<span class="rob-guide-also">${esc(String(rec.doc.status))}</span>` : ''}`);
    if (vb) line('Reviewer B', show(currentLevel(vb)));
  }
  if (fin && (fin !== va || fin !== vb)) line('Final', show(currentLevel(fin)), rec.resolved?.[key]?.reason || '');
  // the models' readings, one line per model: its neutral reading first, the strict and lenient ones where they differ
  const sweeps = s.robSweeps ? sweepModule.sweepsOf(s, p.id, tool.id) : {};
  const groups = new Map();
  for (const [k, x] of Object.entries(sweeps)) {
    const [st, who = 'first'] = k.split(':');
    if (!sweepModule.STANCES[st]) continue;
    (groups.get(who) || groups.set(who, { name: shortWho(x?.by), readings: {} }).get(who)).readings[st] = x;
  }
  for (const g of groups.values()) {
    const at = st => { const d = g.readings[st]?.domains?.[dom]; return question ? d?.answers?.[qid] || '' : d?.judgement || ''; };
    const n = at('neutral'), parts = sweepModule.STANCE_IDS.filter(st => st !== 'neutral' && at(st) && at(st) !== n).map(st => `${READING_WORD[st].toLowerCase()} ${word(at(st))}`);
    if (!n && !parts.length) continue;
    const by = g.readings.neutral?.by || Object.values(g.readings)[0]?.by || g.name;
    line(`${g.name}'s reading`, `${n ? show(n) : ''}${parts.length ? `<span class="rob-guide-also">${esc(parts.join(', '))}</span>` : ''}`, question ? '' : g.readings.neutral?.domains?.[dom]?.why || '', { by, value: n });
  }
  // a domain's review against the full text, and other reviewers' notes on it
  if (!question) {
    const a = sweepModule.adjudicationOf(s, p.id, tool.id)[dom];
    if (a) line('Full-text review', a.verdict === a.recorded ? `<span class="rob-guide-also">Kept</span>${toned(a.verdict)}` : `${toned(a.recorded)}<span class="rob-guide-also">to</span>${toned(a.verdict)}`, a.reason || '', { by: a.by || 'Claude', value: a.verdict });
    for (const who of sweepModule.reviewsBy(s)) {
      const n = sweepModule.reviewOfReviewer(s, who, p.id, tool.id)[dom];
      if (n) line(`${shortWho(n.by || who)}'s note`, toned(n.verdict), n.reason || '', { by: n.by || who, value: n.verdict });
    }
  }
  return lines.length ? `<div class="rob-guide-decided"><p class="rob-guide-quiet">Who decided what</p><ul class="rob-guide-answers rob-guide-people">${lines.join('')}</ul></div>` : '';
}

// Reconcile: each domain with A's and B's judgements; where they differ, the
// resolved value and its reason; where they agree, the final judgement.
function reconcileHtml(s, tool, p, lvl, cols, opts) {
  const a = answersBy(s, p.id, tool.id, lvl, 'a'), b = answersBy(s, p.id, tool.id, lvl, 'b');
  const byDomain = new Map(discrepancies(s, p.id, tool, lvl).map(x => [x.domain, x]));
  const final = finalAnswers(s, p.id, tool.id, lvl);
  return uiList({ label: 'Reconciliation', cls: 'rob-form rob-reconcile', cols: ['judgement'], rows: cols.map(d => {
    const x = byDomain.get(d.id);
    const m = modelOn(s) ? answersBy(s, p.id, tool.id, lvl, 'model')[d.id] : '';
    const pair = `<span class="meta rob-pair">${modelOn(s) ? `${esc(firstName(readerName(s, 'a')))} ${esc(a[d.id] || '—')}, ${esc(firstName(readerName(s, 'b')))} ${esc(b[d.id] || '—')}, model ${esc(m || '—')}` : `A ${esc(a[d.id] || '—')}, B ${esc(b[d.id] || '—')}`}</span>`;
    const head = `<span><span class="rob-code">${esc(d.short)}</span>${d.id === OVERALL ? '' : esc(d.label)}</span>`;
    if (!x) return uiRow({ attrs: { 'data-d': d.id }, main: { html: head, detail: [pair] }, cells: [{ col: 'judgement', kind: 'text', ch: 20, html: `<span class="rob-final">${esc(final[d.id] || '—')}</span>` }] });
    if (x.state === 'waiting') return uiRow({ attrs: { 'data-d': d.id }, main: { html: head, detail: [pair] }, cells: [{ col: 'judgement', kind: 'text', ch: 20, html: 'Waiting' }] });
    return uiRow({ cls: 'rob-differ', attrs: { 'data-d': d.id, 'data-resolve': d.id },
      main: { html: `${head}<textarea data-reason rows="2" aria-label="Reason" placeholder="Reason">${esc(x.resolved?.reason || '')}</textarea><span class="cr-error meta rob-error" hidden></span>`, detail: [pair] },
      cells: [{ col: 'judgement', kind: 'control', html: `<select data-final aria-label="Resolved ${esc(d.label)}">${opts(x.resolved?.value || '', d.judgements || tool.judgements)}</select>` }] });
  }) });
}

// The overall an instrument derives from its items (AMSTAR 2), with what drove it.
// The instrument's own algorithm's overall under the project's (lib/rob-overall.mjs severestColumn), read only: it follows the domains.
function severestRow(tool, a) {
  const col = severestColumn(tool, projectRule(tool.id)), v = col ? severestOf(tool, a) : '';
  if (!col) return [];
  return [uiRow({ cls: 'rob-severest', main: { html: `<span class="rob-code">${esc(col.short)}</span>${esc(col.label)}` },
    cells: [{ col: 'judgement', kind: 'text', ch: 20, html: `<span class="rob-verdict">${verdictMark(v)}<span class="rob-final" data-tone="${verdictTone(v) || 'empty'}">${esc(v || '—')}</span></span>` }] })];
}
function derivedRow(tool, a) {
  const o = tool.derived ? derivedRating(tool, a) : null;
  if (!tool.derived) return [];
  return [uiRow({ cls: 'umb-derived', main: { html: '<span class="rob-code">Overall</span>', detail: o ? [esc(drivers(o))] : [] },
    cells: [{ col: 'judgement', kind: 'text', ch: 20, html: `<span class="umb-rating${o?.complete ? ` umb-t-${o.tone}` : ''}">${o ? esc(o.complete ? o.rating : `${o.rating} so far`) : ''}</span>` }] })];
}

const customCount = s => allTools(s).filter(t => t.custom).length;

// Why a domain has its judgement: the reason filed with the passage that supports it (Appraisal's support notes, "<instrument> <domain>:
// <judgement> — "passage" — reason"), the one for the judgement as it stands; nothing when none is filed.
function reasonLine(s, tool, p, d, judgement) {
  if (!judgement || d.id === OVERALL) return '';
  const head = `${tool.name} ${d.short}:`;
  const notes = (s.notes || []).filter(n => n.paper === p.id && n.kind === 'quote' && String(n.text || '').startsWith(head));
  const mine = notes.filter(n => String(n.text).slice(head.length).trim().startsWith(`${judgement} `)).reverse();
  const why = (mine[0] || null) && String(mine[0].text).split(/\s+—\s+/).slice(2).join(' — ').trim();
  return why ? `<span class="rob-reason">${esc(why)}</span>` : '';
}

// The readings of the study (lib/rob-sweep.mjs), by who read it (owner, 25 Oct 2026: "I don't know who said what"): a column per reviewer
// (Claude, DeepSeek, Codex, …) with its neutral judgement and, under it, where its strict and lenient readings land when they differ; the
// recorded judgement first and, last, whether the domain was reviewed against the full text (kept, changed, a change proposed) or still
// waits. Each domain opens to every reviewer's reasons and quotes, the adjudication's reason and other reviewers' notes.
const REVIEW_WORD = { kept: 'Kept after review', changed: 'Changed after review', proposed: 'Change proposed, kept', follows: 'Follows its domains' };
const READING_WORD = { pessimistic: 'Strict', neutral: 'Neutral', optimistic: 'Lenient' };
const shortWho = by => String(by || 'A reviewer').replace(/\s*\(.*\)\s*$/, '').replace(/^deepseek$/i, 'DeepSeek');
function sweepsHtml(s, tool, p) {
  const sweeps = s.robSweeps ? sweepModule.sweepsOf(s, p.id, tool.id) : {};
  const review = s.reviewLedger?.items?.[`rob:${p.id}`];
  if (!Object.keys(sweeps).length && !review) return '';
  const adj = sweepModule.adjudicationOf(s, p.id, tool.id);
  const rows = Object.keys(sweeps).length ? sweepModule.reviewedRows(s, p.id, tool, sweeps, adj, projectRule(tool.id)) : [];
  // the reviewers: a key is the reading ("neutral") or the reading and who ("neutral:deepseek-flash-latest")
  const groups = new Map();
  for (const [k, x] of Object.entries(sweeps)) {
    const [st, who = 'first'] = k.split(':');
    if (!sweepModule.STANCES[st]) continue;
    const g = groups.get(who) || groups.set(who, { name: shortWho(x?.by), full: x?.by || '', readings: {} }).get(who);
    g.readings[st] = x;
  }
  const others = sweepModule.reviewsBy(s).map(who => ({ who, rev: sweepModule.reviewOfReviewer(s, who, p.id, tool.id) })).filter(o => Object.keys(o.rev).length);
  const people = [...groups.values()];
  const mark = j => (j ? `<span class="rob-verdict">${verdictMark(j)}<span>${esc(j)}</span></span>` : '<span class="meta">—</span>');
  const cellOf = (g, d) => {
    const at = st => g.readings[st]?.domains?.[d]?.judgement || '';
    const n = at('neutral') || at('pessimistic') || at('optimistic'), lo = at('pessimistic'), hi = at('optimistic');
    const range = [lo && lo !== n ? `strict ${lo}` : '', hi && hi !== n ? `lenient ${hi}` : ''].filter(Boolean).join(', ');
    // the reader's name rides in its cell: hidden under the column heads in a wide pane, shown where the cells stack in a narrow one
    return `<span class="rob-rd-cell"><span class="rob-rd-name">${esc(g.name)}</span>${mark(n)}${range ? `<span class="rob-rd-range">${esc(range)}</span>` : ''}</span>`;
  };
  const quotes = qs => (qs || []).filter(q => q?.text).map(q => `<q class="rob-rd-quote${q.found === false ? ' rob-rd-unfound' : ''}"${q.found === false ? ' title="Not found in the full text"' : ''}>${esc(q.text)}</q>${q.page != null && q.page !== '' ? `<span class="meta"> p. ${esc(q.page)}${q.ocr ? ', read by text recognition' : ''}</span>` : ''}`).join(' ');
  const detail = r => {
    const lines = [];
    for (const g of people) for (const st of sweepModule.STANCE_IDS) {
      const x = g.readings[st]?.domains?.[r.domain];
      if (!x?.judgement) continue;
      lines.push(`<li><span class="rob-rd-who">${esc(g.name)}, ${esc(READING_WORD[st].toLowerCase())}</span> ${mark(x.judgement)}${x.why ? `<span class="rob-rd-why">${esc(x.why)}</span>` : ''}${x.quotes?.length ? `<span class="rob-rd-quotes">${quotes(x.quotes)}</span>` : ''}</li>`);
    }
    const a = adj[r.domain];
    const review = a ? `<p class="rob-rd-review"><span class="rob-rd-who">Review against the full text${a.by ? `, ${esc(shortWho(a.by))}` : ''}${a.at ? `, ${esc(String(a.at).slice(0, 10))}` : ''}</span> ${a.verdict === a.recorded ? `kept ${esc(a.verdict)}` : `${esc(a.recorded)} to ${esc(a.verdict)}${r.recorded === a.verdict ? '' : ' (not applied)'}`}${a.confidence ? `, ${esc(a.confidence)} confidence` : ''}<span class="rob-rd-why">${esc(a.reason || '')}</span>${a.quotes?.length ? `<span class="rob-rd-quotes">${quotes(a.quotes)}</span>` : ''}</p>` : '';
    const notes = others.map(({ who, rev }) => { const n = rev[r.domain]; if (!n) return '';
      return `<p class="rob-rd-review"><span class="rob-rd-who">${esc(shortWho(n.by || who))}'s note</span> ${mark(n.verdict)} ${n.verdict === r.recorded ? 'agrees' : 'differs'}${n.confidence ? `, ${esc(n.confidence)} confidence` : ''}<span class="rob-rd-why">${esc(n.reason || '')}</span>${n.quotes?.length ? `<span class="rob-rd-quotes">${quotes(n.quotes)}</span>` : ''}</p>`; }).join('');
    return `<ul class="rob-rd-lines">${lines.join('')}</ul>${review}${notes}`;
  };
  const status = r => r.review ? REVIEW_WORD[r.review] : sweepModule.isContested(r) ? 'Not reviewed' : r.state === 'robust' ? 'All agree' : r.state === 'partial' ? '' : 'Within the readings';
  const tone = r => r.review === 'changed' || r.review === 'proposed' ? 'changed' : !r.review && sweepModule.isContested(r) ? 'open' : '';
  const head = `<div class="rob-rd-line rob-rd-cols" data-cols="${people.length}"><span>Domain</span><span>Recorded</span>${people.map(g => `<span title="${esc(g.full)}">${esc(g.name)}</span>`).join('')}<span>Review</span></div>`;
  const body = rows.map(r => `<details class="rob-rd" data-state="${esc(r.state)}"${tone(r) ? ` data-tone="${tone(r)}"` : ''}><summary><span class="rob-rd-line" data-cols="${people.length}"><span class="rob-rd-domain">${esc(r.short)}</span>${mark(r.recorded)}${people.map(g => cellOf(g, r.domain)).join('')}<span class="rob-rd-status">${esc(status(r))}</span></span></summary><div class="rob-rd-detail">${detail(r)}</div></details>`).join('');
  const table = rows.length ? `<div class="rob-readings">${head}${body}</div>` : '';
  const rev = review ? `<p class="meta">Reviewed by ${esc(review.by || 'someone')} on ${esc(String(review.at || '').slice(0, 10))}${review.verdict === 'issue' ? ': issues found' : ''}${review.note ? `. ${esc(review.note)}` : ''}</p>${(review.findings || []).map(f => `<p class="meta">${esc(f.severity ? `${f.severity}: ` : '')}${esc(String(f.text || '').replace(/^./, c => c.toUpperCase()))}</p>`).join('')}` : '';
  return `<div class="rob-score rob-sweeps"><h3 class="rob-score-title">Readings by reviewer</h3>${table}${rev}</div>`;
}


// The score an instrument itself defines (Newcastle–Ottawa stars, MINORS
// points, AGREE II scaled domain scores over every appraiser, the MMAT
// screening step), beside the judgements it follows from.
function scoreHtml(s, tool, p, lvl, mine, two) {
  const appraisals = [two ? finalAnswers(s, p.id, tool.id, lvl) : mine, ...(two && tool.scoring === 'agree' ? [answersBy(s, p.id, tool.id, lvl, 'a'), answersBy(s, p.id, tool.id, lvl, 'b')] : [])];
  // AGREE II scales over the appraisers: with two, A and B; the final answers are not a third appraiser
  if (two && tool.scoring === 'agree') appraisals.shift();
  const sc = scoreRows(tool, appraisals);
  if (!sc) return '';
  return `<div class="rob-score"><h3 class="rob-score-title">${esc(sc.title)}</h3><dl class="props">${sc.rows.map(r =>
    `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}${r.note ? `<div class="meta">${esc(r.note)}</div>` : ''}</dd>`).join('')}</dl></div>`;
}

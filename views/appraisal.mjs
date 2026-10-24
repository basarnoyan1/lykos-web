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
import { showMenu } from '../lib/menu.mjs';
import { inRobScope, robScope, robScopeWords, outcomeStudies } from '../lib/rob-scope.mjs';
import { icon } from '../lib/icons.mjs';
import { plural } from '../lib/dates.mjs';
import { REGISTRY } from './registry.mjs';
import { get, update, projectGeneration } from '../store.mjs';
import { allTools, appraisalTool, JUDGEMENT_TONE } from '../schema.mjs';
import { currentLevel } from '../lib/appraisal-extra.mjs';
import { verdictTone, verdictMark } from '../lib/appraisal-mark.mjs';
import { answerWith, toolIdsOf, ruleOverall, questionKey, scoreRows, scoreMark } from '../lib/appraisal-custom.mjs';
import { instrumentsOpen, openInstruments, closeInstruments, instrumentsSpec, renderInstruments } from './appraisal-instruments.mjs';
import { trafficLight, summaryBars, analysisWeights, robvisTrafficLight, robvisSummary, robvisTemplateFor, ROBVIS_TEMPLATES } from '../lib/appraisal-fig.mjs';
import { robScreen } from '../lib/rob-screen.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiNotice, uiSwap } from '../lib/ui-actions.mjs';
import { uiLink, disclosure } from '../lib/ui-components.mjs';
import { openStudy } from '../lib/study.mjs';
import { studies, screeningStarted } from '../lib/screen.mjs';
import { defaultAppraisal } from '../lib/workflow.mjs';
import { instrumentFor, instrumentChoice, instrumentReason, chooseInstrument } from '../lib/study-instrument.mjs';
import { derivedRating, drivers } from '../lib/umbrella.mjs';
import { shownOutcomes, analysisOf } from '../lib/outcomes.mjs';
import { itemsMet, gradeBy, isChecklist, gradeCounts, assessmentRows, isComplete } from '../lib/appraisal-summary.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { STUDY, OVERALL, PER_OUTCOME, secondOn, answersBy, finalAnswers, effectiveAnswers, assessedAt, discrepancies, consensusState,
  resolveDomain, confirmConsensus, setSecond, clearLevel, startLevel, kappa, pairsFor, contextOf, setContext } from '../lib/rob-review.mjs';

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
let shownCtx = null;          // the shell's context of the last render, for the title bar's switch

// The levels an instrument can be judged at in this review: the study, and each outcome for RoB 2 and ROBINS-I.
const levelsOf = (s, tool) => [[STUDY, 'Study level'], ...(PER_OUTCOME.has(tool.id) ? shownOutcomes(s).filter(o => !o.derived || analysisOf(s, o.id)).map(o => [o.id, o.name]) : [])];
const levelNow = (s, tool) => (levelsOf(s, tool).some(([id]) => id === level) ? level : STUDY);
const whoNow = s => (secondOn(s) ? who : 'a');

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
    overflow: n ? [{ id: 'ap-import', label: 'Import from a workbook…', icon: 'import', run: importBook }, { id: 'ap-export', label: 'Export', icon: 'export', run: exportAll }] : [] };
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
  // One line a study (Component review 2026-10-21, item 14, after Linear's rows): its name, then only what is an exception. The verdict
  // shows when it is not the best one (Serious, High), the instrument when it is not the one most studies use, the count while domains
  // are still open; twenty rows of "JBI case series, 10 of 10" said nothing a row could not.
  rowHeight: 40,
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
      const exception = !!word && tone !== 'good';
      const end = [tool.id !== common ? tool.name : '', tool.domains.length && n < tool.domains.length ? `${n} of ${tool.domains.length}` : '',
        // the short label already names the year ("Kaner 2010b"): the year stands apart only beside a full title
        p.label ? '' : p.year || ''].filter(Boolean).join(', ');
      return { id: p.id, title: p.label || p.title, sub: '', meta: end,
        mark: open ? `${open} to reconcile` : exception ? word : '',
        dot: open || !exception ? '' : tone,
        markTone: '' };
    });
  },
};
/** Explicit paper result links leave charts even when this paper was already selected. */
export function focusPaper(id) { pick = id; listTool = 'all'; show = 'all'; showGrid = false; showFigs = false; focused = null; }
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
export function inspect(ctx) {
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
        <option value="one"${secondOn(s) ? '' : ' selected'}>One reviewer</option><option value="two"${secondOn(s) ? ' selected' : ''}>Two, independently</option></select></label>
      <label class="field"><span>Instrument</span><select data-default-tool aria-label="Instrument for the review">${allTools(s).map(t => `<option value="${t.id}"${t.id === toolId(s) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Custom instruments</span><button type="button" data-custom-tools>${esc(customCount(s) ? `${customCount(s)} defined` : 'Define')}</button></label>
      ${isChecklist(appraisalTool(toolId(s), s)) ? `<label class="field"><span>Low above (%)</span><input data-rule="low" class="num" inputmode="numeric" value="${esc(s.appraisalRule?.low ?? '')}" aria-label="Low above percent"></label>
      <label class="field"><span>Moderate from (%)</span><input data-rule="moderate" class="num" inputmode="numeric" value="${esc(s.appraisalRule?.moderate ?? '')}" aria-label="Moderate from percent"></label>` : ''}</div>`,
    wire: el => {
      el.querySelector('[data-reviewers]').onchange = e => {
        update(st => setSecond(st, e.target.value === 'two', toolIds()));
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
  return { title: 'Agreement', meta: lvl === STUDY ? 'Study level' : '', html: `<dl class="props">${rowsHtml}</dl>` };
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
  if (!isChecklist(tool)) { const v = a[OVERALL] || scoreMark(tool, a); return `<td class="grid-sum" data-sum="${esc(p.id)}"><span class="rob-verdict">${verdictMark(v)}<span class="rob-final" data-tone="${verdictTone(v) || 'empty'}">${esc(v || '—')}</span></span></td>`; }
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
  const counts = gradeCounts(assessmentRows(s));
  const summary = Object.entries(counts).map(([t, by]) => `${appraisalTool(t, s).name}: ${Object.entries(by).map(([g, n]) => `${n} ${g.toLowerCase()}`).join(', ')}`).join('; ');
  const body = sections.map(({ tool, items }) => { const check = isChecklist(tool);
    return `<table class="rob-grid"><caption><span class="rg-name">${esc(tool.name)}</span><span class="meta">${esc(`${count.get(tool.id)} ${count.get(tool.id) === 1 ? 'study' : 'studies'}`)}</span></caption>
    <thead><tr><th scope="col" class="rg-study">Study</th>${tool.domains.map(d => `<th scope="col" class="rg-code" title="${esc(d.label)}">${esc(d.short)}</th>`).join('')}
      ${check ? '<th scope="col" class="num">Met</th><th scope="col">Grade</th>' : '<th scope="col">Overall</th>'}<th scope="col" class="rg-end"><span class="visually-hidden">Actions</span></th></tr></thead>
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
    // the head's counts move with the answers, the page does not
    const meta = el.querySelector('.panel-head .meta');
    if (meta) { const c = gradeCounts(assessmentRows(st)); meta.textContent = Object.entries(c).map(([k, by]) => `${appraisalTool(k, st).name}: ${Object.entries(by).map(([x, n]) => `${n} ${x.toLowerCase()}`).join(', ')}`).join('; '); }
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
  const appraised = all.filter(x => toolFor(s, x.id).id === figTool.id).map(x => ({ study: x.id, label: x.label, values: answers(s, x.id, figTool, figLvl) })).filter(r => isComplete(figTool, r.values));
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
    const judgements = () => [['Study', ...[...figTool.domains, ...(figTool.overall ? [{ id: 'overall', label: 'Overall' }] : [])].map(d => d.label)],
      ...done.map(r => [r.label, ...[...figTool.domains.map(d => d.id), ...(figTool.overall ? ['overall'] : [])].map(id => r.values[id] || '')])];
    const robvis = figLayout === 'robvis', drawTl = robvis ? robvisTrafficLight : trafficLight, drawSm = robvis ? robvisSummary : summaryBars, suffix = robvis ? '-robvis' : '';
    const w = weighted ? analysisWeights(s.analysis) : null;
    // on screen the house layout is the screen figure (lib/rob-screen.mjs), as Submission's page draws it: 12 px type, 16 px marks, its own
    // size; the robvis layout shows robvis's drawing; the file is the print copy either way
    const screenTl = robvis ? drawTl(figTool, done, JUDGEMENT_TONE, { style: screen }) : robScreen(figTool, done, { style: screen, tones: JUDGEMENT_TONE, part: 'grid' });
    const screenSm = robvis ? drawSm(figTool, done, JUDGEMENT_TONE, { weights: w, style: screen }) : robScreen(figTool, done, { style: screen, tones: JUDGEMENT_TONE, weights: w, part: 'bars' });
    showFigure(el, 'tl', screenTl, `appraisal-traffic-light${suffix}`,
      { open: id => openStudy(ctx, id), exportSvg: () => drawTl(figTool, done, JUDGEMENT_TONE, { style: print, source }), data: judgements });
    // a segment's press lists its studies under the figure (lib/figure-drill.mjs), each opening its judgement
    showFigure(el, 'sm', screenSm, `${w ? 'appraisal-summary-weighted' : 'appraisal-summary'}${suffix}`,
      { open: id => openStudy(ctx, id), exportSvg: () => drawSm(figTool, done, JUDGEMENT_TONE, { weights: w, style: print, source }), data: judgements });
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
    view: two ? { id: 'rob-who', label: 'Reviewer', attr: 'data-who', value: side, items: [['a', 'Reviewer A'], ['b', 'Reviewer B'], ['reconcile', 'Reconcile']] } : undefined,
    status: two ? { id: 'rob-status', text: STATE[c.state] || '', ch: 16 } : undefined,
    actions: [...(levels.length > 1 ? [{ id: 'rob-study', label: 'Use study level', icon: 'undo', presence: 'reserve', hidden: !(lvl !== STUDY && own) }] : []),
      ...(two ? [uiSwap({ id: 'rob-consensus-slot', members: [{ id: 'rob-consensus', label: 'Confirm consensus', role: 'secondary', disabled: !canConfirm, hidden: c.state === 'agreed' }, { id: 'rob-reopen', label: 'Reopen', role: 'secondary', hidden: c.state !== 'agreed' }] })] : [])] });
  const body = !own
    ? uiNotice({ id: 'rob-inherits', label: 'Study-level assessment', text: 'Uses the study-level assessment', actions: [{ id: 'rob-own', label: 'Assess this outcome', icon: 'plus' }] })
    : side === 'reconcile' ? reconcileHtml(s, tool, p, eff, cols, opts)
    : `${uiList({ label: 'Judgements', cls: 'rob-form', cols: ['judgement'], rows: [
      // a domain leads with its judgement and its signalling questions follow under it (owner, 2026-10-23, "review it please": the domain came
      // after its questions); every menu stands behind the same mark slot, so a question's answer and a domain's judgement start on one edge
      ...cols.flatMap(d => [uiRow({ attrs: { 'data-d': d.id }, main: { html: `<span${d.signals ? ` title="${esc(d.signals.join('; '))}"` : ''}><span class="rob-code">${esc(d.short)}</span>${d.id === OVERALL ? (ruled ? 'Worst domain judgement' : '') : esc(d.label)}</span>` },
          cells: [d.id === OVERALL && ruled
            ? { col: 'judgement', kind: 'text', ch: 20, html: `<span class="rob-verdict">${verdictMark(mine[OVERALL] || ruleOverall(tool, mine))}<span class="rob-final" data-ruled data-tone="${verdictTone(mine[OVERALL] || ruleOverall(tool, mine)) || 'empty'}">${esc(mine[OVERALL] || ruleOverall(tool, mine) || '—')}</span></span>` }
            : { col: 'judgement', kind: 'control', html: verdictField(mine[d.id], `<select data-d="${esc(d.id)}" aria-label="${esc(d.label)}">${opts(mine[d.id], d.judgements)}</select>`) }] }),
        ...(d.questions || []).map((q, k) => uiRow({ cls: 'rob-q', depth: 1, attrs: { 'data-d': d.id },
          main: { html: `<span><span class="rob-code">${esc(`${d.short}.${k + 1}`)}</span>${esc(q.text)}</span>` },
          cells: [{ col: 'judgement', kind: 'control', html: `<span class="rob-verdict"><span class="rob-mark-slot" aria-hidden="true"></span><select data-d="${esc(questionKey(d.id, q.id))}" aria-label="${esc(q.text)}">${opts(mine[questionKey(d.id, q.id)], q.answers)}</select></span>` }] }))]),
      ...derivedRow(tool, mine)] })}${scoreHtml(s, tool, p, eff, mine, two)}`;
  return `<div class="panel">
    ${uiBar({ kind: 'head', label: 'Study', id: 'rob-study-head', cls: 'panel-head', lead: { title: p.label, level: 'h2' }, status: { id: 'rob-count', text: `${n} of ${plural(tool.domains.length, 'domain')}`, ch: 16 },
      actions: [{ id: 'open-doc', label: p.pdf ? 'Open' : 'Record', icon: 'file' }] })}
    ${bar}
    <div class="panel-body tight"><p class="meta rob-why" data-rob-why>${esc(instrumentReason(instrumentChoice(s, p.id)))}</p>${body}</div></div>`;
}

// Reconcile: each domain with A's and B's judgements; where they differ, the
// resolved value and its reason; where they agree, the final judgement.
function reconcileHtml(s, tool, p, lvl, cols, opts) {
  const a = answersBy(s, p.id, tool.id, lvl, 'a'), b = answersBy(s, p.id, tool.id, lvl, 'b');
  const byDomain = new Map(discrepancies(s, p.id, tool, lvl).map(x => [x.domain, x]));
  const final = finalAnswers(s, p.id, tool.id, lvl);
  return uiList({ label: 'Reconciliation', cls: 'rob-form rob-reconcile', cols: ['judgement'], rows: cols.map(d => {
    const x = byDomain.get(d.id);
    const pair = `<span class="meta rob-pair">A ${esc(a[d.id] || '—')}, B ${esc(b[d.id] || '—')}</span>`;
    const head = `<span><span class="rob-code">${esc(d.short)}</span>${d.id === OVERALL ? '' : esc(d.label)}</span>`;
    if (!x) return uiRow({ attrs: { 'data-d': d.id }, main: { html: head, detail: [pair] }, cells: [{ col: 'judgement', kind: 'text', ch: 20, html: `<span class="rob-final">${esc(final[d.id] || '—')}</span>` }] });
    if (x.state === 'waiting') return uiRow({ attrs: { 'data-d': d.id }, main: { html: head, detail: [pair] }, cells: [{ col: 'judgement', kind: 'text', ch: 20, html: 'Waiting' }] });
    return uiRow({ cls: 'rob-differ', attrs: { 'data-d': d.id, 'data-resolve': d.id },
      main: { html: `${head}<textarea data-reason rows="2" aria-label="Reason" placeholder="Reason">${esc(x.resolved?.reason || '')}</textarea><span class="cr-error meta rob-error" hidden></span>`, detail: [pair] },
      cells: [{ col: 'judgement', kind: 'control', html: `<select data-final aria-label="Resolved ${esc(d.label)}">${opts(x.resolved?.value || '', d.judgements || tool.judgements)}</select>` }] });
  }) });
}

// The overall an instrument derives from its items (AMSTAR 2), with what drove it.
function derivedRow(tool, a) {
  const o = tool.derived ? derivedRating(tool, a) : null;
  if (!tool.derived) return [];
  return [uiRow({ cls: 'umb-derived', main: { html: '<span class="rob-code">Overall</span>', detail: o ? [esc(drivers(o))] : [] },
    cells: [{ col: 'judgement', kind: 'text', ch: 20, html: `<span class="umb-rating${o?.complete ? ` umb-t-${o.tone}` : ''}">${o ? esc(o.complete ? o.rating : `${o.rating} so far`) : ''}</span>` }] })];
}

const customCount = s => allTools(s).filter(t => t.custom).length;

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

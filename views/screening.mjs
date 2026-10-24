// Screening: title/abstract, then full text, with keyboard decisions and reasons.
// Decisions are appended to a log and written at once (lib/screen.mjs). An
// exclusion needs a reason before it is recorded; a reset asks first. With
// dual screening on, each reviewer decides blind and conflicts are resolved
// in the inspector (plan E3, E5). Z takes back this session's last decision.
import { REGISTRY } from './registry.mjs';
import { assessMany } from '../lib/helpers.mjs';
import { num, when } from '../lib/dates.mjs';
import { estimateTokens, assessRecord } from '../lib/assist.mjs';
import { configured } from '../lib/ai.mjs';
import { SCREEN_ASSESS } from '../lib/prompts.mjs';
import { get, update } from '../store.mjs';
import { esc, emptyState, abstractHtml } from '../lib/html.mjs';
import { authorLine, studyCell, journalDisplay } from '../lib/bib.mjs';
import { openStudy } from '../lib/study.mjs';
import { fetchAbstract } from '../lib/sources.mjs';
import { confirmAsk, ask } from '../lib/dialog.mjs';
import { settings, modelFor, secondScreenModel } from '../lib/model-settings.mjs';
import { proposeUnanimous } from '../lib/screen-unanimity.mjs';
import { icon, withIcon } from '../lib/icons.mjs';
import { disclosure, tableRegion } from '../lib/ui-components.mjs';
import { uiBar, uiNotice, uiList, uiRow, uiRowEnd, inspectorActions } from '../lib/ui-actions.mjs';
import { statusOf, pageSpec, disagreementStatus, amendedNotice, footSpec, resolveFootSpec, resolvedFootSpec, subPageSpec, VERDICT_ICON } from './screening-bars.mjs';
import { STAGES, stageOf, queue, decide, decideMany, revert, priorOf, undo, reset, resolve, decisions, isDual, conflicts, agreement, decisionAt, ownDecision, reopen, reviewersOf } from '../lib/screen.mjs';
import { adjudicationQueue } from '../lib/research-copilot.mjs';
import { saveFile } from '../lib/save.mjs';
import { screenMany, agreement as jevAgreement, isJev, reapply } from '../lib/jev.mjs';
import { run as runJob, running, cancel as cancelJob } from '../lib/jobs.mjs';
import { showMenu } from '../lib/menu.mjs';
// named views of the list (plan §3 C6, E1)
import { viewMenuItems, viewLabel } from '../lib/saved-views.mjs';
import { pageList } from '../lib/list-pager.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { pagedList, wirePagedList } from '../lib/paged-list.mjs';
import { termsOf, highlightPattern } from '../lib/screen-highlight.mjs';
import { labelList, labelsOf, labelNames, labelCounts, addLabel, setLabel, renameLabel, removeLabel } from '../lib/screen-labels.mjs';
import { batchesOf, checkSample, addBatches, reassign, removeBatch, drawSample as drawIds, splitIds, unassigned, reviewerSummary, batchProgress } from '../lib/screen-assign.mjs';
import { ensureRanking, rankOrder, scoreOf, ranking, rankingBusy, evaluateRanking, onRanked, MODELS } from '../lib/screen-rank-run.mjs';
let rankedUnsub = null;
let toTop = false;   // ranking just turned on: its first record opens when the ranking arrives
import { sinceLastInclude, kneeRule, remainingFromSample, extraOf, stopPrompt } from '../lib/screen-rank.mjs';
import { validationReport, storeValidation, storeRecallCheck, excludedPool } from '../lib/screen-validation.mjs';
import { importReviewerSheet } from './screening-sheets.mjs';
import { rescreenExcludedDialog } from './screening-rescreen.mjs';
import { LANGUAGE_REASON, nonEnglishIds, languageName, languageCounts, sweepOf, sweepFlagged, clearSweep, dropSweepResult } from '../lib/screening-checks.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const usesDocument = true;
export const meta = { title: 'Screening', icon: 'screening' };
export const count = (...a) => REGISTRY.screening.count(...a);

const REASONS = ['Wrong population', 'Wrong intervention', 'Wrong comparator',
  'Wrong outcome', 'Wrong study design', 'Duplicate', 'Not retrievable'];   // the stock language reason follows these in the menu
const LOG_ROWS = 40;

const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const reviewer = () => settings().reviewerInitials || settings().reviewerName || '';

// Keep the decision and its reason readable; an imported provenance note is
// supplementary material, not part of the verdict or the paper's heading.
/** "28 included, 420 excluded, 12 uncertain": what the stage's decisions came to, for the page that has nothing left to decide. */
function decidedLine(s, pool) {
  const n = { include: 0, exclude: 0, uncertain: 0 };
  for (const p of pool) { const d = decisionOf(s, p.id)?.decision; if (d in n) n[d]++; }
  return [[n.include, 'included'], [n.exclude, 'excluded'], [n.uncertain, 'uncertain']].filter(([k]) => k).map(([k, w]) => `${num(k)} ${w}`).join(', ');
}

/** A verdict as every place shows it: its icon in the verdict colour beside the neutral word. */
const verdictHtml = (v, word = cap(v), tag = 'span') => `<${tag} class="scr-verdict v-${esc(v)}">${VERDICT_ICON[v] ? icon(VERDICT_ICON[v], { size: 14 }) : ''}${esc(word)}</${tag}>`;

function decisionMarkup(decision, id) {
  if (!decision) return '';
  const source = decision.via === 'folder' ? 'Imported decision' : decision.via || '';
  return `<div class="scr-record-decision">
    <div class="scr-decision-summary">${verdictHtml(decision.decision, cap(decision.decision), 'strong')}
      ${source ? `<span class="meta">${esc(source)}</span>` : ''}
      ${decision.by ? `<span class="meta">Recorded by ${esc(decision.by)}</span>` : ''}</div>
    ${decision.reason ? `<p class="scr-decision-reason"><span class="meta">Reason</span> ${esc(decision.reason)}</p>` : ''}
    ${decision.note ? disclosure({ id: `scr-decision-note-${id}`, title: decision.via === 'folder' ? 'Import note' : 'Decision note', body: `<p>${esc(decision.note)}</p>`, className: 'scr-decision-note' }) : ''}
  </div>`;
}

/**
 * What an import carried in with a record from another screening: an independent assessment and the columns of the workbook it came
 * from that hold a decision. The labels are the data's own: nothing here names a reviewer, a tool or a project.
 */
function priorSection(review) {
  if (!review || typeof review !== 'object') return null;
  const ind = review.independent || {};
  const cols = Object.entries(review.workbook || {}).filter(([k, v]) => /decision/i.test(k) && String(v ?? '').trim());
  const rows = [
    ...(ind.verdict || ind.reason ? [uiRow({ main: { html: verdictHtml(String(ind.verdict || 'pending').toLowerCase(), cap(ind.verdict || 'Pending')), detail: [ind.reason, ind.basis].filter(Boolean).map(esc), wrap: true } })] : []),
    ...cols.map(([k, v]) => { const w = String(v).trim(), key = w.toLowerCase();
      return uiRow({ main: { html: VERDICT_ICON[key] ? verdictHtml(key, w) : esc(w), detail: [esc(k)], wrap: true } }); }),
  ];
  return rows.length ? { title: 'Prior assessments', meta: String(rows.length), html: critList('Prior assessments', rows, '') } : null;
}

let stage = 'ta';
let pick = null;
// A proposal batch is a job (lib/jobs.mjs): it runs on after the view is left,
// shows its progress in the status bar, and is stopped from either place.
const batchOf = st => running().find(j => j.kind === 'screen' && j.stage === st) || null;
export function selection() {
  if (show === 'all' || show === 'decided' || show === 'disagreements') { const ids = rows(get()).map(p => p.id); return ids.includes(pick) ? pick : ids[0] || null; }
  const { open } = queue(get(), stage, reviewer());
  const todo = open.filter(p => !skipped.has(p.id));
  if (todo.some(p => p.id === pick)) return pick;
  // no record chosen: the first the list shows, in its order (ranked, check sample first)
  return (show === 'open' ? rows(get()).find(p => !skipped.has(p.id)) : null)?.id || todo[0]?.id || null;
}
/** What the assistant is told about this view: the record on screen and the rules. */
export function assistContext() {
  const s = get(); const { open } = queue(s, stage, reviewer());
  const todo = open.filter(p => !skipped.has(p.id));
  const cur = (pick && (s.papers || []).find(p => p.id === pick)) || todo[0];
  const rules = (s.protocol?.criteria || []).filter(c => stage === 'ft' || c.stage !== 'Full text');
  const prop = cur ? s.proposals?.[stage]?.[cur.id] : null;
  const human = cur ? (stage === 'ft' ? s.fulltext?.[cur.id] : s.screening?.[cur.id]) : null;
  const byId = new Map(rules.map(c => [c.id, c]));
  return [`Screening, ${stageOf(stage).label}: ${open.length} outstanding${queueFilter ? `; list narrowed to ${queueFilter}` : ''}`,
    cur ? `Record on screen: ${cur.label} — ${cur.title}${cur.year ? ` (${cur.journalAbbr || cur.journal || ''} ${cur.year})` : ''}${cur.abstract ? `\nAbstract: ${cur.abstract.slice(0, 1400)}` : '\nNo abstract'}` : 'No record on screen',
    prop ? `Model proposal: ${prop.verdict} (p ${Number(prop.p ?? prop.eligible ?? 0).toFixed(2)}); per rule: ${(prop.criteria || []).map(c => `${c.id} ${c.met === true ? 'yes' : c.met === false ? 'no' : c.met || 'unclear'} ${Number(c.p).toFixed(2)}${byId.get(c.id)?.kind === 'exclude' ? ' (excl)' : ''}`).join(', ')}` : cur ? 'Model proposal: none' : '',
    human ? `Reviewer decision: ${human.decision}${human.reason ? ` (${human.reason})` : ''}${human.by ? ` by ${human.by}` : ''}` : '',
    rules.length ? `Criteria: ${rules.map(c => `${c.id} ${c.text}`).join('; ')}` : ''].filter(Boolean).join('\n');
}             // a record chosen from the queue, else the first
/**
 * The record on screen for a decision, for model actions (lib/aid.mjs). The
 * stage goes with it, because a proposal is kept per stage.
 */
export function focus() {
  const s = get(), id = selection();
  const cur = (s.papers || []).find(p => p.id === id);
  return cur ? { kind: 'record', paperId: cur.id, label: cur.label, detail: stageOf(stage).label, stage } : null;
}
const skipped = new Set();   // put aside this session, shown again next time
// This session's decisions, newest last, each with the decision it replaced,
// so Z (and Undo) can put the last one back and show its record again.
const taken = [];
const TAKEN_MAX = 200;

// The list's own filter (the funnel): by decision, exclusion reason and abstract.
let recFilter = { decision: '', reason: '', abstract: '', label: '', check: '' };
const NO_FILTER = { decision: '', reason: '', abstract: '', label: '', check: '' };
let filterBar = null;   // the filter bar, redrawn when the record filter changes
// Reasons that start with a criterion code ("C2: …") filter by the code; others by their text.
const reasonGroup = r => { const t = String(r || '').trim() || 'No reason'; const m = t.match(/^([A-Z]{1,3}\d{1,2}[a-z]?)\s*[:.–-]\s/); return m ? m[1] : t; };
const OTHER = 'Other reasons';
const isCoded = r => reasonGroup(r) !== (String(r || '').trim() || 'No reason');
const DECISION_NAMES = { include: 'Included', exclude: 'Excluded', uncertain: 'Uncertain', none: 'Not decided' };
/** The record filter as words, for the line under the filter bar. */
function recFilterParts() {
  return [recFilter.decision && `Decision: ${DECISION_NAMES[recFilter.decision]}`,
    recFilter.reason && `Exclusion reason: ${recFilter.reason}`,
    recFilter.abstract && (recFilter.abstract === 'yes' ? 'Has abstract' : 'No abstract'),
    recFilter.label && `Label: ${recFilter.label === 'none' ? 'No label' : labelList(get()).find(l => l.id === recFilter.label)?.name || 'Removed label'}`,
    recFilter.check && `Check: ${CHECK_NAMES[recFilter.check]}`].filter(Boolean);
}
const CHECK_NAMES = { language: 'Non-English', rescreen: 'Re-screen results' };
const recFilterActive = () => !!(recFilter.decision || recFilter.reason || recFilter.abstract || recFilter.label || recFilter.check);
function applyRecFilter(s, list) {
  if (!recFilterActive()) return list;
  const lang = recFilter.check === 'language' ? nonEnglishIds(list) : null;
  const swept = recFilter.check === 'rescreen' ? new Set(sweepFlagged(s, stage)) : null;
  return list.filter(p => {
    if (lang && !lang.has(p.id)) return false;
    if (swept && !swept.has(p.id)) return false;
    const d = decisionOf(s, p.id);
    if (recFilter.decision === 'none' ? d : recFilter.decision && d?.decision !== recFilter.decision) return false;
    if (recFilter.reason && (d?.decision !== 'exclude' || (recFilter.reason === OTHER ? isCoded(d.reason) : reasonGroup(d.reason) !== recFilter.reason))) return false;
    if (recFilter.abstract === 'yes' && !String(p.abstract || '').trim()) return false;
    if (recFilter.abstract === 'no' && String(p.abstract || '').trim()) return false;
    if (recFilter.label) { const on = labelsOf(s, p.id, labelScope(s)); if (recFilter.label === 'none' ? on.length : !on.some(l => l.id === recFilter.label)) return false; }
    return true;
  });
}
let queueFilter = '';        // '', 'include', 'uncertain', 'exclude', or 'sample': what the queue is narrowed to
// A blind check of the model (plan E8): a stratified random sample of proposed
// records, drawn once per stage and kept until cleared, decided by hand; the
// Agreement panel then reads sensitivity and specificity off those decisions.
const SAMPLE_N = 20;
let sample = { stage: '', ids: null };
function drawSample(records, props, stage) {
  const by = { include: [], uncertain: [], exclude: [] };
  for (const p of records) { const v = props[p.id]?.verdict; if (v in by) by[v].push(p.id); }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ids = []; const share = Math.ceil(SAMPLE_N / 3);
  for (const k of ['include', 'uncertain', 'exclude']) ids.push(...shuffle(by[k]).slice(0, share));
  sample = { stage, ids: new Set(shuffle(ids).slice(0, SAMPLE_N)) };
}
// A proposal's answer to a rule, drawn from the registry in a cell of one width.
const MARK = { yes: 'check', no: 'close', unclear: 'dot' };
const markOf = met => MARK[met] ? icon(MARK[met], { size: 14 }) : '';

// ---- highlights (plan E2) ---------------------------------------------------
// Terms the review sets for inclusion and exclusion are marked in the title and
// abstract on screen, in the verdict colours; the reviewer can turn them off.
// A term ending in * matches any ending. Marking is done on the rendered text
// nodes, so nothing the record holds is ever parsed as markup.
const highlights = s => ({ include: [], exclude: [], off: false, ...(s.screeningHighlights || {}) });
function markTerms(roots, re) {
  if (!re) return 0;
  let n = 0;
  for (const root of roots) {
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue; re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment(); let at = 0, m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        frag.append(text.slice(at, m.index));
        const mark = document.createElement('mark');
        mark.className = m[1] ? 'hl-in' : 'hl-ex'; mark.textContent = m[0];
        frag.append(mark); at = m.index + m[0].length; n++;
      }
      frag.append(text.slice(at));
      node.replaceWith(frag);
    }
  }
  return n;
}
// Matrix sort: a column key ('verdict' or a rule id) and a direction. Answers
// order yes, unclear, no, none; verdicts include, uncertain, exclude, none.
let mxSort = { key: '', dir: 1 };
const ANS_ORDER = { yes: 0, unclear: 1, no: 2 }, VER_ORDER = { include: 0, uncertain: 1, exclude: 2 };
function mxSorted(rows, props) {
  if (!mxSort.key) return rows;
  const rank = p => { const pr = props[p.id]; if (!pr) return 9;
    if (mxSort.key === 'verdict') return VER_ORDER[pr.verdict] ?? 9;
    const a = (pr.criteria || []).find(c => c.id === mxSort.key); return a ? (ANS_ORDER[a.met] ?? 9) : 9; };
  // an unanswered record sinks to the bottom whichever way the column sorts
  return rows.map((p, i) => [rank(p), i, p]).sort((a, b) => (a[0] === 9) - (b[0] === 9) || (a[0] - b[0]) * mxSort.dir || a[1] - b[1]).map(x => x[2]);
}
// The sort mark holds its place whether or not the column is sorted, so sorting moves no header.
const sortMark = key => `<span class="mx-mark">${mxSort.key === key ? icon(mxSort.dir === 1 ? 'chevron-down' : 'chevron-up', { size: 12 }) : ''}</span>`;
const sortAria = key => mxSort.key === key ? (mxSort.dir === 1 ? 'ascending' : 'descending') : 'none';
function matrixTable(rows, rules, props, cur, limit) {
  return tableRegion({ label: 'Proposals by criterion', sticky: true, html: `<table>
    <thead><tr><th>Study</th><th class="mx-sort" data-sort="verdict" aria-sort="${sortAria('verdict')}">Proposal${sortMark('verdict')}</th>${rules.map(c => `<th class="mx mx-sort" data-sort="${esc(c.id)}" aria-sort="${sortAria(c.id)}" title="${esc(c.text)}">${esc(c.id)}${sortMark(c.id)}</th>`).join('')}</tr></thead><tbody>
    ${mxSorted(rows, props).slice(0, limit).map(p => { const pr = props[p.id]; const by = new Map((pr?.criteria || []).map(c => [c.id, c]));
      return `<tr data-pick="${esc(p.id)}"${cur && p.id === cur.id ? ' class="sel"' : ''}>
      <td class="scr-mx-study">${studyCell(p, { titleFirst: true })}</td>
      <td class="scr-q-prop d-${esc(pr?.verdict || '')}">${esc(pr ? cap(pr.verdict) : '')}</td>
      ${rules.map(c => { const a = by.get(c.id); return `<td class="mx m-${esc(a?.met || 'none')}" title="${esc(`${c.id} ${a ? cap(a.met) : ''}${a?.p != null ? ` ${a.p.toFixed(2)}` : ''}${a?.note ? `; ${a.note}` : ''}; ${c.text}`)}">${a ? markOf(a.met) : ''}</td>`; }).join('')}</tr>`; }).join('')}
    </tbody></table>` });
}
/** The matrix as CSV: one row per record, the verdict, then each rule's answer and probability. */
function matrixCsv(rows, rules, props) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Label', 'Title', 'Year', 'Proposal', 'p', 'Model', ...rules.flatMap(c => [c.id, `${c.id} p`])];
  const lines = rows.map(p => { const pr = props[p.id]; const by = new Map((pr?.criteria || []).map(c => [c.id, c]));
    return [p.label, p.title, p.year, pr?.verdict || '', pr?.p ?? '', pr?.model || '', ...rules.flatMap(c => { const a = by.get(c.id); return [a?.met || '', a?.p ?? '']; })].map(q).join(','); });
  return [head.map(q).join(','), ...lines].join('\n');
}
/** The Stop entry follows the job without repainting the whole view; the status bar carries the progress bar. */
function tick(st) {
  const j = batchOf(st); const b = document.querySelector('#assess-stop');
  if (!j || !b) return;
  b.textContent = `Stop proposals: ${j.done} of ${j.total}`;
}

// ---- list · detail · inspector ----------------------------------------------
// The list is the stage's records: those still to decide (skipped ones last),
// those decided, or all. A decided row carries its verdict in the verdict's
// colour; a model's proposal is shown in plain text, because it is not one.
// Records still to decide can be narrowed to one proposed verdict, or to a
// blind sample of the proposals (plan E8).
let show = 'open';           // 'open' | 'decided' | 'all'
// Find: the list's search row (title, author or year) is closed until the title bar's Find or ⌘F opens it, and stays open while it narrows the list
let findOpen = false, query = '';
let listRefresh = null;      // the list pane's refresh, for Find
const SHOW_LABEL = { open: 'To decide', decided: 'Decided', all: 'All', disagreements: 'Disagreements' };
/** The records whose title, label, authors or year hold every word of the search (case and accents ignored). */
const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function byText(list) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(p => { const hay = fold(`${p.title || ''} ${p.label || ''} ${authorLine(p.authors)} ${p.year || ''}`); return words.every(w => hay.includes(w)); });
}
const decisionOf = (s, id) => isDual(s) ? ownDecision(s, stage, id, reviewer()) : decisionAt(s, stage, id);
const rulesOf = s => { const criteria = s.protocol?.criteria || []; return stage === 'ft' ? criteria : criteria.filter(c => c.stage !== 'Full text'); };
// Under blind dual screening a reviewer sees and filters by their own labels (plan E3).
const labelScope = s => isDual(s) ? reviewer() : '';

// ---- time on record (plan E8) -------------------------------------------------
// From the moment a record is shown to its decision, less any time the window
// was hidden, capped at ten minutes (a record left open over lunch is not ten
// minutes of reading). Stored with the decision in milliseconds.
const MS_CAP = 10 * 60 * 1000;
let onScreen = { id: null, stage: '', at: 0, hidden: 0, hiddenAt: 0 };
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.hidden) onScreen.hiddenAt = performance.now();
  else if (onScreen.hiddenAt) { onScreen.hidden += performance.now() - onScreen.hiddenAt; onScreen.hiddenAt = 0; }
});
const timeOnRecord = () => Math.max(0, Math.min(MS_CAP, performance.now() - onScreen.at - onScreen.hidden - (onScreen.hiddenAt ? performance.now() - onScreen.hiddenAt : 0)));
const noteDrafts = new Map();   // record id -> a note typed and not yet decided with

// ---- ranking (plan E6) ------------------------------------------------------------
// "Most likely relevant first" orders the records still to decide by a model
// trained on this reviewer's decisions (lib/screen-rank-run.mjs). A random
// check sample, while it has records left, comes first whatever the order.
const rankCfg = s => ({ on: false, model: 'nb', useTerms: false, stopAfter: 0, ...(s.settings?.screeningRank || {}) });
/** The declared terms as extra features: the highlight terms, when the reviewer switched them on for ranking. */
const rankExtra = s => extraOf({ on: rankCfg(s).useTerms, ...highlights(s) });
const setRank = patch => update(st => { st.settings = { ...(st.settings || {}), screeningRank: { ...rankCfg(st), ...patch } }; return st; });
/** The stage's records, every reviewer's, and this reviewer's include/exclude decisions on them. */
function rankInput(s) {
  const pool = queue(s, stage).pool, labels = {};
  for (const p of pool) { const d = decisionOf(s, p.id); if (d?.decision === 'include') labels[p.id] = true; else if (d?.decision === 'exclude') labels[p.id] = false; }
  return { pool, labels };
}
const keepRanked = s => { const { pool, labels } = rankInput(s); ensureRanking(stage, pool, labels, { model: rankCfg(s).model, extra: rankExtra(s) }); };
function orderQueue(s, list) {
  let out = rankCfg(s).on ? rankOrder(stage, list) : list;
  const chk = checkSample(s, stage);
  if (chk) { const ids = new Set(chk.ids); const first = out.filter(p => ids.has(p.id)); if (first.length) out = [...first, ...out.filter(p => !ids.has(p.id))]; }
  return out;
}
// The last ranking evaluation of a stage (plan E8): the inspector's Evaluation section, until another is run.
let evaluation = null;   // { stage, report, ms }
/** The stage's decisions replayed against the ranker (plan E8), in the worker; what it found is the inspector's Evaluation section. */
async function evaluate() {
  const say = msg => (barRerender || shownCtx?.rerender)?.(msg);
  const s = get(); const { pool, labels } = rankInput(s); const cfg = rankCfg(s), st0 = stage;
  const inc = Object.values(labels).filter(Boolean).length, n = Object.keys(labels).length;
  if (inc < 2 || n - inc < 2) { say('Too few decisions to evaluate: at least two includes and two excludes'); return; }
  let r = null;
  await runJob('rank', `Ranking evaluation (${n} decisions)`, async () => { r = await evaluateRanking(pool, labels, cfg.model, rankExtra(s)); return r?.report ? `${r.report.seeds} simulated reviews` : 'Not run'; }).catch(() => {});
  if (!r || r.error || !r.report) { say(`Evaluation did not run: ${r?.error || 'no worker in this window'}`); return; }
  evaluation = { stage: st0, report: r.report, ms: r.ms };
  shownCtx?.openDetails?.(); say('');
}
/** The Evaluation section: the evaluation's readings, each named for what it is. */
function evaluationSection() {
  const e = evaluation.report, ms = evaluation.ms, mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length, f = (x, d = 2) => Number(x).toFixed(d);
  const rows = [
    ['Decisions', `${e.records} (${e.includes} include)`],
    ['Simulated reviews', `${e.seeds}, one include and one exclude as the start, retrained every ${e.every}`],
    ['Screened to 95% recall', `${f(mean(e.work95), 0)} of ${e.screened} (range ${Math.min(...e.work95)}–${Math.max(...e.work95)}); in random order about ${Math.ceil(0.95 * e.screened)}`],
    ['WSS@95', `${f(mean(e.wss95))} (range ${f(Math.min(...e.wss95))}–${f(Math.max(...e.wss95))})`],
    ['Recall after 25%', f(mean([e.recall25]))],
    ...(e.atd ? [
      ['Average time to discovery', `${f(mean(e.atd))} of the records (random order about 0.50)`],
      ['Extra relevant found at 10%', `${f(mean(e.erf10))} more of the relevant records than random order`],
      ['Loss', `${f(mean(e.loss))} (0 best, 1 no better than random)`]] : []),
    ['Held-out AUC', `${f(mean(e.auc))} (5 folds, ${f(Math.min(...e.auc))}–${f(Math.max(...e.auc))})`],
    ['Time', ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`],
  ];
  return { title: 'Evaluation', meta: MODELS[e.model] || '', html: `<div class="scr-kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` };
}

/** Opens the queue on these records only, at title and abstract (the living-review list of new records). */
/** Opens the screening on one of its two stages: 'ta' (title and abstract) or 'ft' (full text). */
export function showStage(k) { stage = k === 'ft' ? 'ft' : 'ta'; pick = null; }
export function focusRecords(ids) { stage = 'ta'; sample = { stage, ids: new Set(ids) }; queueFilter = 'sample'; show = 'open'; pick = null; filterBar?.(); }

/** Arrival from Needs attention (lib/arrive.mjs), through the queue's own filters: the open queue, the uncertain decisions (the record
 * filter), or the new records (the living-review list). Null puts back what was shown before. */
let beforeArrive = null;
export function arrive(a) {
  if (!a) {
    if (beforeArrive) ({ stage, show, queueFilter, sample, recFilter } = beforeArrive);
    beforeArrive = null; pick = null; filterBar?.();
    return false;
  }
  if (!['unscreened', 'uncertain', 'new-records'].includes(a.kind)) return false;
  beforeArrive = { stage, show, queueFilter, sample, recFilter };
  if (a.kind === 'new-records') { if (!a.ids?.length) return false; focusRecords(a.ids); return true; }
  stage = 'ta'; queueFilter = ''; sample = { stage: '', ids: null }; pick = null;
  if (a.kind === 'uncertain') { show = 'all'; recFilter = { ...NO_FILTER, decision: 'uncertain' }; }
  else { show = 'open'; recFilter = { ...NO_FILTER }; }
  filterBar?.();
  return true;
}
export const arrived = () => !!beforeArrive && (recFilter.decision === 'uncertain' || show === 'open');

/** Open the exact checkpoint of a disagreement, without accepting a proposal or changing any decision: an independent
 * disagreement opens the conflict editor in the Disagreements view; another checkpoint keeps its reviewer decision. */
export function focusAdjudication(nextStage, paperId) {
  if (!['ta', 'ft'].includes(nextStage)) throw new Error('Choose title/abstract or full-text screening.');
  const s = get();
  if (!queue(s, nextStage).pool.some(p => p.id === paperId)) throw new Error('This record is no longer eligible for this screening stage.');
  const humanConflict = isDual(s) && conflicts(s, nextStage, { resolved: true }).some(c => c.paper.id === paperId);
  if (!humanConflict && !queue(s, nextStage, reviewer()).pool.some(p => p.id === paperId)) throw new Error('This record is assigned to another reviewer. Switch reviewer before opening its checkpoint.');
  stage = nextStage; pick = paperId; show = humanConflict ? 'disagreements' : 'all'; sub = null;
  queueFilter = ''; sample = { stage: '', ids: null }; recFilter = { ...NO_FILTER };
  skipped.delete(paperId); toTop = false;
  filterBar?.();
  return { stage, paperId, mode: show };
}

// ---- disagreements (plan E5; the adjudication queue of lib/research-copilot.mjs) ----------------------------------------------
// A view of the list: every independent disagreement of the stage, open or resolved, and what else needs a second human look (a
// second review missing, criteria changed since the reviews), each with its reasons. Nothing here decides: an open conflict is
// resolved in the conflict editor, any other record on its own page.
/** The stage's disagreements in the order they want attention: open conflicts, the queue's other records, resolved conflicts. */
function disagreementsOf(s) {
  const all = isDual(s) ? conflicts(s, stage, { resolved: true }) : [];
  const out = new Map(all.filter(c => !c.resolution).map(c => [c.paper.id, { paper: c.paper, conflict: c, reasons: [] }]));
  const byId = new Map((s.papers || []).map(p => [p.id, p])), human = new Set(all.map(c => c.paper.id)), rest = [];
  for (let offset = 0; offset != null;) {
    const q = adjudicationQueue(s, { stage, limit: 100, offset });
    for (const i of q.items) { const had = out.get(i.paperId), p = byId.get(i.paperId);
      if (had) had.reasons = i.reasons.filter(r => r !== 'Independent reviewers disagree');
      else if (p && !human.has(p.id)) rest.push({ paper: p, conflict: null, reasons: i.reasons }); }
    offset = q.nextOffset;
  }
  return [...out.values(), ...rest, ...all.filter(c => c.resolution).map(c => ({ paper: c.paper, conflict: c, reasons: [] }))];
}
/** The Disagreements item of the list's switch: offered under dual screening, or while independent reviews of the stage are kept. */
const disagreementsOffered = s => isDual(s) || Object.keys(s.dual?.[stage] || {}).length > 0;
/** The record the Disagreements view shows: the one chosen, else the first; its entry says whether it is a human conflict. */
function disagreementAt(s) {
  const list = disagreementsOf(s), ids = new Set(rows(s).map(p => p.id));
  return list.find(d => d.paper.id === pick && ids.has(pick)) || list.find(d => ids.has(d.paper.id)) || null;
}

/** The records still to decide, narrowed by the proposal filter. */
function narrowed(s, outstanding) {
  const props = s.proposals?.[stage] || {};
  const tally = { include: 0, uncertain: 0, exclude: 0 };
  for (const p of outstanding) { const v = props[p.id]?.verdict; if (v in tally) tally[v]++; }
  if (queueFilter && queueFilter !== 'sample' && !tally[queueFilter]) queueFilter = '';
  if (queueFilter === 'sample' && (!sample.ids || sample.stage !== stage)) drawSample(outstanding, props, stage);
  let todo = queueFilter === 'sample' ? outstanding.filter(p => sample.ids.has(p.id))
    : queueFilter ? outstanding.filter(p => props[p.id]?.verdict === queueFilter) : outstanding;
  if (queueFilter === 'sample' && !todo.length) { queueFilter = ''; sample = { stage: '', ids: null }; todo = outstanding; }
  return { todo, tally };
}

function rows(s) { return byText(listed(s)); }
function listed(s) {
  if (show === 'disagreements') return applyRecFilter(s, disagreementsOf(s).map(d => d.paper));
  const { pool, open } = queue(s, stage, reviewer());
  const openIds = new Set(open.map(p => p.id));
  if (show === 'open') {
    const { todo } = narrowed(s, orderQueue(s, open.filter(p => !skipped.has(p.id))));
    return applyRecFilter(s, queueFilter ? todo : [...todo, ...open.filter(p => skipped.has(p.id))]);
  }
  return applyRecFilter(s, show === 'decided' ? pool.filter(p => !openIds.has(p.id)) : pool);
}

// The rules a proposal failed, surest first: a met exclusion or an unmet inclusion.
function reasonOf(pr, rules) {
  const ruleOf = id => rules.find(r => r.id === id);
  return (pr?.criteria || [])
    .filter(c => { const k = ruleOf(c.id)?.kind || 'include'; return (k === 'include' && c.met === 'no') || (k === 'exclude' && c.met === 'yes'); })
    .sort((a, b) => Math.abs((b.p ?? 0.5) - 0.5) - Math.abs((a.p ?? 0.5) - 0.5))
    .map(c => `${c.id}: ${ruleOf(c.id)?.text || ''}`);
}

/** A criterion in full, drawn under its row when the row is opened: what it says, what the model is asked, and its answer for the record on screen. */
function critDetail(s, id) {
  const c = (s.protocol?.criteria || []).find(x => x.id === id); if (!c) return '';
  const pr = pick && queueFilter !== 'sample' ? s.proposals?.[stage]?.[pick] : null;
  const a = (pr?.criteria || []).find(x => x.id === c.id);
  const j = (pr?.jev?.criteria || []).find(x => x.id === c.id);
  const rows = [['Criterion', c.text], ['Tested statement', c.question || ''], ['True when', c.yes || ''], ['False when', c.no || ''],
    ...(a ? [['Answer', `${a.met}${a.p != null ? `, ${a.p.toFixed(2)}` : j?.p != null ? `, ${j.p.toFixed(2)}` : ''}${pr?.model ? `, ${pr.model}` : ''}`], ['Note', a.note || '']] : [])].filter(([, v]) => v);
  return `<div class="scr-kv scr-crit-detail">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`;
}

// ---- sub-pages: the decision log and the proposal matrix (DIALOGS #65) ------------------------------------------------------------
// Each is a page of its own with Back in the title bar (screening-bars.mjs subPageSpec): one table at the page's width, its first column
// held while the rest scrolls, paged before it is drawn (every record by every rule was 125,000 cells for 5,000 records, and a hidden
// row still costs its nodes). A row opens its record on the Screening page. The list pane is not drawn while a sub-page is open.
let sub = null;           // null | 'log' | 'matrix'
let logPage = 1, mxPage = 1;
const LOG_PAGE = 50, MX_PAGE = 100;
/** Leaving Screening closes a sub-page: the page comes back on its records. */
export function unmount() { sub = null; }
/** Opens a sub-page from the title bar: in a one-pane window it is the page shown, not the list. */
function openSub(kind) { sub = kind; logPage = 1; mxPage = 1; shownCtx?.openItem?.(); (barRerender || shownCtx?.rerender)?.(); }
/** The matrix's records: those the list shows that hold a proposal of the stage. */
function matrixModel(s) { const props = s.proposals?.[stage] || {}; return { props, rules: rulesOf(s), recs: rows(s).filter(p => props[p.id]) }; }
/** The decision log: this reviewer's decisions on records still in the library (the count in the title bar is the rows below it). */
function logModel(s) { const byId = new Map((s.papers || []).map(p => [p.id, p])); return { byId, scope: labelScope(s), log: decisions(s, { by: reviewer() }).filter(d => byId.has(d.id)) }; }
const exportMatrix = () => { const s = get(), { props, rules, recs } = matrixModel(s); return saveFile(new Blob([matrixCsv(mxSorted(recs, props), rules, props)], { type: 'text/csv' }), `screening-matrix-${stage}.csv`, 'text/csv'); };
const exportLogItems = () => { const s = get(), { byId, scope, log } = logModel(s); return [
  { label: 'Decisions', run: () => saveFile(new Blob([decisionsCsv(s, log, byId, scope)], { type: 'text/csv' }), 'screening-decisions.csv', 'text/csv') },
  { label: 'Log', run: () => saveFile(new Blob([logCsv(s, byId, scope)], { type: 'text/csv' }), 'screening-log.csv', 'text/csv') }]; };
/** Redraws a table and keeps the region where the reader had scrolled it. */
function redrawTable(el, sel, html) {
  const box = el.querySelector(sel), at = box.querySelector('.ui-table-region')?.scrollLeft || 0;
  box.innerHTML = html;
  const region = box.querySelector('.ui-table-region'); if (region) region.scrollLeft = at;
}
/** The sub-page in view, under its title bar. */
function renderSub(el, ctx) {
  menuActions = null; for (const k of Object.keys(recordActs)) delete recordActs[k];
  const s = get();
  const leave = patch => { sub = null; patch(); filterBar?.(); ctx.rerender(); };
  if (sub === 'log') {
    const { byId, scope, log } = logModel(s);
    const secs = ms => ms ? `${Math.round(ms / 1000)} s` : '';
    const note = d => [d.note, d.resolved ? [d.picked ? `Took ${d.picked}` : 'Resolved', d.why].filter(Boolean).join(': ') : ''].filter(Boolean).join('; ');
    const labelText = d => labelNames(s, d.id, scope).join(', ');
    // a column no decision fills is not drawn
    const COLS = [
      { h: 'Study', cell: (d, p) => `<td class="scr-log-title">${esc(p.title || p.label || 'Untitled')}<div class="study-title">${esc(p.label || '')}</div></td>` },
      { h: 'Stage', cell: d => `<td class="nw">${d.stage === 'ft' ? 'Full text' : 'Title'}</td>` },
      { h: 'Decision', cell: d => `<td class="nw d-${esc(d.decision)}">${esc(cap(d.decision))}</td>` },
      { h: 'Reason', cell: d => `<td class="scr-log-reason">${esc(d.reason || '')}</td>`, fill: d => d.reason },
      { h: 'Note', cell: d => `<td class="scr-log-note">${esc(note(d))}</td>`, fill: note },
      { h: 'Labels', cell: d => `<td>${esc(labelText(d))}</td>`, fill: labelText },
      { h: 'By', cell: d => `<td class="nw">${esc(d.by || '')}</td>`, fill: d => d.by },
      { h: 'When', cell: d => `<td class="nw meta">${esc(when(d.at))}</td>`, fill: d => when(d.at) },
      { h: 'Time', cell: d => `<td class="nw meta">${secs(d.ms)}</td>`, fill: d => d.ms },
    ].filter(c => !c.fill || log.some(c.fill));
    const draw = () => { const { items, page, pages } = pageOf(log, logPage, LOG_PAGE); logPage = page;
      const body = items.map(d => { const p = byId.get(d.id); return `<tr data-pick="${esc(p.id)}" data-stage="${esc(d.stage)}">${COLS.map(c => c.cell(d, p)).join('')}</tr>`; }).join('');
      return `${tableRegion({ label: 'Decisions', sticky: true, html: `<table><thead><tr>${COLS.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>` })}${pager({ id: 'scr-log-pager', page, pages, total: log.length, label: 'decisions', size: LOG_PAGE })}`; };
    el.innerHTML = `<div class="panel scr-sub" id="scr-sub" data-scr-sub="log"><div class="panel-body">${log.length ? `<div class="scr-log-wide">${draw()}</div>` : emptyState({ title: 'No decisions', size: 'inline' })}</div></div>`;
    const wire = () => {
      el.querySelectorAll('[data-pick]').forEach(r => r.onclick = () => leave(() => { show = 'all'; pick = r.dataset.pick; if (STAGES.some(x => x.id === r.dataset.stage)) stage = r.dataset.stage; }));
      wirePager(el, 'scr-log-pager', p => { logPage = p; redrawTable(el, '.scr-log-wide', draw()); wire(); });
    };
    wire();
    return;
  }
  const { props, rules, recs } = matrixModel(s);
  const cur = pick ? s.papers.find(p => p.id === pick) : null;
  const draw = () => { const { items, page, pages } = pageOf(mxSorted(recs, props), mxPage, MX_PAGE); mxPage = page;
    return `${matrixTable(items, rules, props, cur, items.length)}${pager({ id: 'scr-mx-pager', page, pages, total: recs.length, label: 'records', size: MX_PAGE })}`; };
  el.innerHTML = `<div class="panel scr-sub" id="scr-sub" data-scr-sub="matrix"><div class="panel-body">${recs.length ? `<div class="scr-mx">${draw()}</div>` : emptyState({ title: 'No proposals in the list', size: 'inline' })}</div></div>`;
  const wire = () => {
    wirePager(el, 'scr-mx-pager', p => { mxPage = p; redrawTable(el, '.scr-mx', draw()); wire(); });
    el.querySelectorAll('[data-pick]').forEach(r => r.onclick = () => leave(() => { pick = r.dataset.pick; }));
    el.querySelectorAll('[data-sort]').forEach(h => h.onclick = () => {
      mxSort = mxSort.key === h.dataset.sort ? { key: h.dataset.sort, dir: -mxSort.dir } : { key: h.dataset.sort, dir: 1 };
      mxPage = 1; redrawTable(el, '.scr-mx', draw()); wire();
    });
  };
  wire();
}
const csvQ = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
/** Every current decision with its labels (plan E1), note and time on record (E8). */
function decisionsCsv(s, log, byId, scope) {
  const head = ['Label', 'Title', 'Year', 'DOI', 'PMID', 'Stage', 'Decision', 'Reason', 'Note', 'Labels', 'By', 'When', 'Seconds on record', 'Resolved', 'Resolution took', 'Resolution reason'];
  return [head.map(csvQ).join(','), ...log.map(d => { const p = byId.get(d.id);
    return [p.label, p.title, p.year, p.doi, p.pmid, d.stage === 'ft' ? 'Full text' : 'Title/abstract', d.decision, d.reason, d.note, labelNames(s, d.id, scope).join('; '), d.by, d.at,
      d.ms ? (d.ms / 1000).toFixed(1) : '', d.resolved ? 'yes' : '', d.picked || '', d.why || ''].map(csvQ).join(','); })].join('\n');
}
/**
 * The screening log as it was written, one row per entry: decisions, undos,
 * agreements, resolutions and reopenings, labels, assignments. Under blind
 * dual screening only the reviewer's own entries and shared ones.
 */
function logCsv(s, byId, scope) {
  const head = ['When', 'Action', 'Stage', 'Label', 'Title', 'Decision', 'Prior', 'Reason', 'Note', 'By', 'Seconds on record', 'Detail'];
  const rows = (s.screeningLog || []).filter(e => !scope || !e.by || e.by === scope || e.action === 'resolve' || e.action === 'reopen' || String(e.by).includes('+'));
  return [head.map(csvQ).join(','), ...rows.map(e => { const p = byId.get(e.id) || {};
    return [e.at, e.action, e.stage === 'ft' ? 'Full text' : e.stage === 'ta' ? 'Title/abstract' : '', p.label || '', p.title || '', e.decision, e.prior, e.reason, e.note, e.by, e.ms ? (e.ms / 1000).toFixed(1) : '',
      [e.label && `label ${e.label}`, e.picked && `took ${e.picked}`, e.settled && `settled ${e.settled}`, e.why, e.batch && `batch ${e.batch}`, e.reviewers && `reviewers ${e.reviewers}`, e.from && `${e.from} → ${e.to}`, e.count != null && `${e.count} records`, e.via].filter(Boolean).join('; ')].map(csvQ).join(','); })].join('\n');
}

// The rules changed after the model answered: every verdict is derived again
// from the stored answers. Only proposals from the decision model qualify;
// a text-model note is kept as it was.
async function reapplyRules() {
  const rules = rulesOf(get());
  const all = Object.entries(get().proposals?.[stage] || {}).filter(([, pr]) => pr.tier === 'jev' || pr.jev);
  if (!all.length) return '';
  const ok = await confirmAsk(`Reapply the rules to ${all.length} ${all.length === 1 ? 'proposal' : 'proposals'}?`, { detail: 'From the stored answers, without a model call', confirm: 'Reapply' });
  if (!ok) return '';
  let changed = 0;
  update(st => {
    for (const [id, pr] of all) {
      const src = pr.jev || pr; const next = reapply(src, rules);
      const fresh = { ...src, ...next, verdict: next.verdict, p: next.p, eligible: next.eligible ?? src.eligible ?? null, criteria: next.criteria, tier: 'jev', at: new Date().toISOString() };
      delete fresh.jev;
      if (next.stale) { delete fresh.adjudication; delete fresh.screeningOutcome; fresh.triageNote = 'Criteria changed. Previous assessments need a new evidence review.'; }
      if (fresh.verdict !== pr.verdict) changed++;
      st.proposals[stage][id] = fresh;
    }
    return st;
  });
  return `${changed} ${changed === 1 ? 'verdict' : 'verdicts'} changed`;
}

// Plan E1: a batch preview with one confirmation. Uncertain proposals are
// never accepted in bulk; an exclusion carries its failed rule as reason.
async function acceptProposals() {
  const s = get(); const rules = rulesOf(s); const me = reviewer();
  if (isDual(s) && !me) return;
  const raw = await ask('Accept proposals at or above', { value: '0.9', placeholder: '0.9', confirm: 'Preview' });
  const thr = Number(raw); if (!(thr > 0 && thr <= 1)) return '';
  const open = new Set(queue(get(), stage, me).open.map(p => p.id));
  const picks = Object.entries(get().proposals?.[stage] || {}).filter(([id, pr]) => open.has(id) && pr.verdict !== 'uncertain' && (pr.p ?? 0) >= thr);
  const inc = picks.filter(([, pr]) => pr.verdict === 'include').length, exc = picks.length - inc;
  if (!picks.length) return `No proposal at or above ${thr}`;
  const ok = await confirmAsk(`Accept ${picks.length} ${picks.length === 1 ? 'proposal' : 'proposals'}?`, { detail: `${inc} include, ${exc} exclude, at or above ${thr}`, confirm: 'Accept' });
  if (!ok) return '';
  // An exclusion carries the rule it failed; without one it says it came from
  // the model, rather than borrowing a reason (it used to read "Wrong population").
  await decideMany(stage, picks.map(([id, pr]) => ({ id, decision: pr.verdict, via: pr.model || '',
    reason: pr.verdict === 'exclude' ? (reasonOf(pr, rules)[0] || pr.exclusionCategory || 'Excluded by model proposal') : '' })), { by: me });
  return '';
}

/** What the proposals offer: narrow the queue to one proposed verdict or a blind sample, and the commands over them. */
function proposalsMenu(anchor, refreshAll, e) {
  const s = get();
  const { open } = queue(s, stage, reviewer());
  const { tally } = narrowed(s, open.filter(p => !skipped.has(p.id)));
  const narrow = v => () => {
    if (v === 'sample' && queueFilter === 'sample') sample = { stage: '', ids: null };   // again: a fresh draw
    queueFilter = v; show = 'open'; pick = null; refreshAll();
  };
  barMenu(anchor, e, [
    { label: 'All proposals', checked: !queueFilter, run: narrow('') },
    ...['include', 'uncertain', 'exclude'].map(v => ({ label: `Proposed ${v}`, meta: String(tally[v]), checked: queueFilter === v, disabled: !tally[v], run: narrow(v) })),
    { label: 'Blind sample', checked: queueFilter === 'sample', run: narrow('sample') },
    '-',
    { label: 'Matrix', icon: 'table', run: () => openSub('matrix') },
    { label: 'Reapply rules', run: async () => refreshAll(await reapplyRules()) },
    { label: 'Accept proposals', run: async () => refreshAll(await acceptProposals()) },
  ]);
}

/** Re-screen excluded: asks which rule to leave out, then runs the sweep as a job (views/screening-rescreen.mjs). */
function rescreen(redrawTools, refreshAll) {
  const s = get(), rules = rulesOf(s);
  const jevCfg = modelFor('decide'), textCfg = modelFor('screen');
  return rescreenExcludedDialog({ stage, stageLabel: stageOf(stage).label, rules, decisionOf: id => decisionOf(get(), id),
    jev: isJev(jevCfg) && configured(jevCfg) && rules.length ? jevCfg : null, text: configured(textCfg) ? textCfg : null,
    onChange: msg => { redrawTools(); refreshAll(msg); } });
}

/** The funnel: decision, exclusion reason, abstract and label narrow the list; the order is chosen here too. */
function filterMenu(anchor, redrawTools, refreshAll) {
  const s = get();
  const { pool } = queue(s, stage, reviewer());
  const decs = pool.map(p => decisionOf(s, p.id));
  const count = f => pool.filter((p, i) => f(p, decs[i])).length;
  const reasonCounts = new Map();
  for (const d of decs) if (d?.decision === 'exclude') { const g = reasonGroup(d.reason); reasonCounts.set(g, (reasonCounts.get(g) || 0) + 1); }
  let reasons = [...reasonCounts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // With criterion codes, the codes are the choices and one-off wordings gather under Other reasons.
  const coded = reasons.filter(r => /^[A-Z]{1,3}\d{1,2}[a-z]?$/.test(r));
  if (coded.length) {
    const other = reasons.filter(r => !coded.includes(r)).reduce((n, r) => n + reasonCounts.get(r), 0);
    reasons = other ? [...coded, OTHER] : coded;
    if (other) reasonCounts.set(OTHER, other);
  }
  const set = patch => () => { recFilter = { ...recFilter, ...patch }; pick = null; refreshAll(); redrawTools(); };
  const item = (label, patch, on, n) => ({ label, meta: String(n), checked: on, run: set(patch) });
  const langN = languageCounts(pool, id => decisionOf(s, id)).flagged, sweep = sweepOf(s, stage);
  showMenu(anchor, [
    { heading: 'Decision' },
    item('Any', { decision: '' }, !recFilter.decision, pool.length),
    item('Included', { decision: 'include' }, recFilter.decision === 'include', count((p, d) => d?.decision === 'include')),
    item('Excluded', { decision: 'exclude' }, recFilter.decision === 'exclude', count((p, d) => d?.decision === 'exclude')),
    item('Uncertain', { decision: 'uncertain' }, recFilter.decision === 'uncertain', count((p, d) => d?.decision === 'uncertain')),
    item('Not decided', { decision: 'none' }, recFilter.decision === 'none', count((p, d) => !d)),
    ...(reasons.length ? ['-', { label: 'Exclusion reason', meta: recFilter.reason || '', submenu: [
      { label: 'Any reason', checked: !recFilter.reason, run: set({ reason: '' }) },
      ...reasons.map(r => ({ label: r, meta: String(reasonCounts.get(r)), checked: recFilter.reason === r, run: set({ reason: r, decision: '' }) }))] }] : []),
    '-', { heading: 'Abstract' },
    item('Any', { abstract: '' }, !recFilter.abstract, pool.length),
    item('Has abstract', { abstract: 'yes' }, recFilter.abstract === 'yes', count(p => String(p.abstract || '').trim())),
    item('No abstract', { abstract: 'no' }, recFilter.abstract === 'no', count(p => !String(p.abstract || '').trim())),
    ...(labelList(s).length ? ['-', { label: 'Label', meta: recFilter.label ? (recFilter.label === 'none' ? 'No label' : labelList(s).find(l => l.id === recFilter.label)?.name || '') : '', submenu: [
      { label: 'Any label', checked: !recFilter.label, run: set({ label: '' }) },
      ...labelList(s).map(l => ({ label: l.name, meta: String(count(p => labelsOf(s, p.id, labelScope(s)).some(x => x.id === l.id))), checked: recFilter.label === l.id, run: set({ label: l.id }) })),
      { label: 'No label', meta: String(count(p => !labelsOf(s, p.id, labelScope(s)).length)), checked: recFilter.label === 'none', run: set({ label: 'none' }) }] }] : []),
    '-', { heading: 'Checks' },
    item(LANGUAGE_REASON, { check: recFilter.check === 'language' ? '' : 'language' }, recFilter.check === 'language', langN),
    ...(sweep ? [item('Re-screen results', { check: recFilter.check === 'rescreen' ? '' : 'rescreen' }, recFilter.check === 'rescreen', sweepFlagged(s, stage).length)] : []),
    ...(sweep ? [{ label: 'Clear re-screen', run: () => { clearSweep(stage); if (recFilter.check === 'rescreen') recFilter = { ...recFilter, check: '' }; pick = null; refreshAll(); redrawTools(); } }] : []),
    '-', { heading: 'Order' },
    { label: 'As listed', checked: !rankCfg(s).on, run: () => { setRank({ on: false }); refreshAll(); } },
    { label: 'Most likely relevant first', checked: rankCfg(s).on, run: () => { setRank({ on: true }); toTop = true; pick = ranking(stage) ? (rows(get())[0]?.id || null) : pick; if (ranking(stage)) toTop = false; refreshAll(); } },
    { label: 'Ranking model', meta: MODELS[rankCfg(s).model], submenu: Object.entries(MODELS).map(([k, name]) => ({ label: name, checked: rankCfg(s).model === k, run: () => { setRank({ model: k }); refreshAll(); } })) },
    { label: 'Rank with highlight terms', meta: highlights(s).include.length + highlights(s).exclude.length ? '' : 'No terms', checked: rankCfg(s).useTerms, run: () => { setRank({ useTerms: !rankCfg(s).useTerms }); refreshAll(); } },
    { label: 'Evaluate ranking', run: () => evaluate() },
    ...(recFilterActive() ? ['-', { label: 'Clear filter', icon: 'close', run: set({ ...NO_FILTER }) }] : []),
  ]);
}

/** What one draw of the list tools was drawn from: the tools are drawn again when a decision changes any of it. */
const toolsKey = s => [stage, show, recFilterActive(), isDual(s), Object.keys(s.proposals?.[stage] || {}).length, Object.keys(s[stageOf(stage).key] || {}).length,
  ...STAGES.map(st => queue(s, st.id, reviewer()).open.length)].join('|');
let toolsDrawn = '';
/** The list head says what it holds in place (it is drawn once per page): the title (which records) and whether the filter narrows. */
function syncHead() {
  const t = document.querySelector('#plist-title > span'); if (t) t.textContent = SHOW_LABEL[show] || 'To decide';
  const f = document.getElementById('scr-filter');
  if (f) { f.setAttribute('aria-pressed', String(recFilterActive())); f.title = recFilterActive() ? `Filter: ${recFilterParts().join(', ')}` : 'Filter'; }
  document.querySelectorAll('[id="page-find"]').forEach(x => x.setAttribute('aria-pressed', String(findOpen || !!query)));
}
function openFind() { findOpen = true; filterBar?.(); document.getElementById('scr-q')?.focus(); }
function closeFind() { const had = !!query; findOpen = false; query = ''; filterBar?.(); if (had) listRefresh?.(); }
/** ⌘F (app.mjs findInView): opens the list's search row and puts the caret in it; false on a sub-page or with no records. */
export function find() {
  if (sub || !get().papers?.length || !filterBar) return false;
  if (findOpen || query) document.getElementById('scr-q')?.focus(); else openFind();
  return true;
}

/** What a saved view of Screening holds: the stage, which records (To decide, Decided, All), the record filter, the search and the proposal narrowing. */
const screeningView = () => ({ stage, show, filter: { ...recFilter }, query, queue: queueFilter });
function applyScreeningView(v) {
  stage = v.stage === 'ft' ? 'ft' : 'ta'; show = SHOW_LABEL[v.show] ? v.show : 'open'; recFilter = { ...NO_FILTER, ...(v.filter || {}) };
  query = String(v.query || ''); queueFilter = ['include', 'uncertain', 'exclude'].includes(v.queue) ? v.queue : ''; pick = null; findOpen = true;
}
export const list = {
  // the title says which records are listed and is the choice of them (To decide, Decided, All, Disagreements): a picker, the count beside it
  get title() { return SHOW_LABEL[show] || 'To decide'; },
  titleMenu(b, refresh) {
    const shows = [['open', 'To decide'], ['decided', 'Decided'], ['all', 'All'], ...(disagreementsOffered(get()) || show === 'disagreements' ? [['disagreements', 'Disagreements']] : [])];
    showMenu(b, shows.map(([k, l]) => ({ label: l, checked: k === show, checkType: 'radio', run: () => { show = k; pick = null; filterBar?.(); refresh(); } })), { align: 'start' });
  },
  get empty() { return query.trim() ? 'No record matches the search' : recFilterActive() ? 'No record matches the filter' : show === 'open' ? (queueFilter ? 'Nothing proposed as that' : 'Nothing to decide') : show === 'decided' ? 'Nothing decided' : show === 'disagreements' ? 'No disagreements' : 'No records'; },
  // the head's one act: the filter (no row of tools under the head; the search row is Find's)
  acts(refresh) {
    return [{ id: 'scr-filter', label: 'Filter', icon: 'filter', iconOnly: true, menu: true, pressed: recFilterActive(), attrs: recFilterActive() ? { title: `Filter: ${recFilterParts().join(', ')}` } : undefined,
      run: b => filterMenu(b, () => filterBar?.(), refresh) }];
  },
  filters(el, refresh) {
    listRefresh = refresh;
    const draw = () => {
      if (!el.isConnected) return;
      syncHead();
      const open = findOpen || !!query, field = el.querySelector('#scr-q');
      if (open && field) return;   // typing: the field is never redrawn, so it keeps its caret
      el.innerHTML = open ? uiBar({ kind: 'tools', label: 'Find records', id: 'scr-find', filters: [{ type: 'search', id: 'scr-q', label: 'Find records by title, author or year', placeholder: 'Title, author or year', value: query }],
        actions: [{ picker: true, id: 'scr-views', label: 'View', icon: 'layers', role: 'quiet', value: viewLabel('screening', screeningView(), !!query || recFilterActive() || show !== 'open' || !!queueFilter), attrs: { 'aria-haspopup': 'menu' } }] }) : '';
      el.querySelector('#scr-views')?.addEventListener('click', e => showMenu(e.currentTarget, viewMenuItems('screening', { current: screeningView(), apply: v => { applyScreeningView(v); filterBar?.(); refresh(); shownCtx?.rerender?.(); },
        ask: (title, value) => ask(title, { value, placeholder: 'Name', confirm: 'Save' }), done: () => { filterBar?.(); } }), { align: 'end', minWidth: 200 }));
      const q = el.querySelector('#scr-q');
      if (!q) return;
      q.oninput = () => { query = q.value; pick = null; refresh(); };
      q.onkeydown = e => { if (e.key === 'Escape' && !q.value) { e.preventDefault(); e.stopPropagation(); closeFind(); } };
    };
    toolsDrawn = toolsKey(get());
    filterBar = draw;
    draw();
  },
  items(s) {
    const props = s.proposals?.[stage] || {};
    const rules = rulesOf(s);
    if (show === 'disagreements') {
      // the reason is the row's detail: the reviewers' verdicts for a conflict, the queue's reasons for any other record
      const byId = new Map(disagreementsOf(s).map(d => [d.paper.id, d]));
      return rows(s).map(p => { const { conflict: c, reasons } = byId.get(p.id);
        return { id: p.id, title: p.title || p.label, sub: [c ? c.decisions.map(d => cap(d.decision)).join(' vs ') : '', ...reasons].filter(Boolean).join('; ') || authorLine(p.authors), meta: p.year || '',
          mark: c ? (c.resolution ? `Resolved: ${cap(c.resolution.decision)}` : 'Conflict') : '', markTone: c?.resolution ? c.resolution.decision : '' }; });
    }
    if (rankCfg(s).on) keepRanked(s);
    const chk = checkSample(s, stage); const inCheck = new Set(chk?.ids || []);
    const sweeps = sweepOf(s, stage)?.results;
    return rows(s).map(p => {
      const d = decisionOf(s, p.id), pr = queueFilter === 'sample' ? null : props[p.id];
      const why = !d && pr?.verdict === 'exclude' ? (reasonOf(pr, rules)[0] || '').split(':')[0] : '';
      const sw = sweeps?.[p.id];
      return { id: p.id, title: p.title || p.label, sub: [authorLine(p.authors), recFilter.check === 'language' ? languageName(p) : ''].filter(Boolean).join('; '), meta: p.year || '',
        mark: d ? (sw && sw.verdict !== 'exclude' ? `${cap(d.decision)}, re-screen ${sw.verdict}` : cap(d.decision)) : pr ? `Proposed ${pr.verdict}${why ? `: ${why}` : ''}` : inCheck.has(p.id) ? 'Check sample' : skipped.has(p.id) ? 'Skipped' : '',
        markTone: d ? d.decision : '' };
    });
  },
};
/** The record in the list, at the stage named ('ft' from a study's "Included at full text" in Details). */
export function focusPaper(id, at = 'ta') { stage = at === 'ft' ? 'ft' : 'ta'; pick = id; show = 'all'; sub = null; queueFilter = ''; sample = { stage: '', ids: null }; recFilter = { ...NO_FILTER }; skipped.delete(id); filterBar?.(); }
export function select(id) { pick = id; }
export function selected() { return pick; }

// ---- the title bar ------------------------------------------------------------------------------------------------------------
// The page's head is the title bar (screening-bars.mjs pageSpec). page() runs before render(): what both need is worked out by recordState.
// The record's own commands (Assess, Propose, Open) close over what render drew, so render hands them to the bar through `recordActs`.
let barRerender = null, shownCtx = null;
const recordActs = {};
/** What the page shows: the stage's pool and queue, the record on screen (none: an empty state) and which model tools it offers. */
function recordState(s, { guess = false } = {}) {
  const dual = isDual(s), me = reviewer();
  const { pool, open } = queue(s, stage, me);
  const outstanding = open.filter(p => !skipped.has(p.id));
  // the title bar is drawn before the list pane chooses its first row in a wide window: it reads that row then, and render() corrects
  // what it did not draw (syncBar)
  const at = pick ?? (guess ? rows(s)[0]?.id : null);
  const cur = pool.find(p => p.id === at) || null;
  const rules = rulesOf(s);
  const jevCfg = modelFor('decide'); const jevOk = isJev(jevCfg) && configured(jevCfg) && rules.length > 0;
  const textOk = configured(modelFor('screen'));
  const batch = batchOf(stage);
  const anyModel = textOk || (isJev(jevCfg) && configured(jevCfg));
  // The model tools are not decisions: they are More entries. Record: assess it. Queue: propose for every record still to decide, or stop.
  const tools = !anyModel ? {} : { criteria: !rules.length, assess: rules.length > 0 && textOk, stop: !!batch,
    propose: !batch && (jevOk || textOk) && rules.length && outstanding.length > (textOk ? 1 : 0) ? `Propose for ${outstanding.length} records` : '', proposeModel: jevOk ? jevCfg.model : modelFor('screen').model };
  return { dual, me, pool, open, outstanding, cur, decided: pool.length - open.length, rules, jevCfg, jevOk, textOk, batch, tools, amended: s.protocol?.amendments?.length > 0 && ['screening', 'fulltext'].some(k => Object.values(s[k] || {}).some(d => d?.needsCriteriaReview)) };   // an amendment says so only while a decision it flagged waits for review
}
/** A menu opened from the title bar: under its button, or, from More (a click the bar forwards), at the bar's end. */
const barMenu = (btn, e, items) => (e?.isTrusted ? showMenu(btn, items) : showMenu(btn?.closest?.('.ui-bar') || document.querySelector('main > .topbar') || btn, items, { align: 'end', matchWidth: false }));

/** The title bar: the stage (a picker), the status words and the record's commands; the page's commands in More. */
export function page(rerender) {
  barRerender = rerender;
  const s = get();
  if (!s.papers?.length) return { title: 'Screening', actions: [] };
  // a sub-page (the decision log, the proposal matrix): Back, its name, its count and Export
  if (sub) return subPageSpec({ kind: sub, count: sub === 'log' ? logModel(s).log.length : matrixModel(s).recs.length },
    { back: () => { sub = null; filterBar?.(); rerender(); }, export: (btn, e) => (sub === 'log' ? barMenu(btn, e, exportLogItems()) : exportMatrix()) });
  const st = recordState(s, { guess: true }), dis = show === 'disagreements' ? disagreementsOf(s) : null;
  const decisions = Object.keys(s[stageOf(stage).key] || {}).length;
  const conflict = dis ? disagreementAt(s)?.conflict || null : null;   // the record shown is a human conflict: the conflict editor
  const repaint = () => { filterBar?.(); rerender(); };
  return pageSpec({
    stages: STAGES.map(x => [x.id, x.id === 'ta' ? 'Title & abstract' : x.label, queue(s, x.id, st.me).open.length || null]), stage,
    status: dis ? disagreementStatus(dis.filter(d => !d.conflict?.resolution).length, dis.length) : statusOf({ decided: st.decided, total: st.pool.length, dual: st.dual, me: st.me, amended: st.amended }),
    undo: !conflict, canUndo: taken.length > 0, needInitials: !conflict && st.dual && !st.me,
    openLabel: (conflict?.paper || st.cur)?.pdf ? 'Open PDF' : 'Open record',
    tools: !conflict && st.cur ? st.tools : {},
    rescreen: decisionsOf(s).some(d => d?.decision === 'exclude'), proposals: Object.keys(s.proposals?.[stage] || {}).length > 0,
    decisions: decisions > 0, clearLabel: `Clear ${stageOf(stage).label.toLowerCase()} decisions`, finding: findOpen || !!query,
  }, {
    find: () => (findOpen || query ? closeFind() : openFind()),
    pick: a => showMenu(a, STAGES.map(x => ({ label: x.id === 'ta' ? 'Title & abstract' : x.label, meta: String(queue(get(), x.id, reviewer()).open.length || ''), checked: x.id === stage, checkType: 'radio',
      run: () => { if (stage === x.id) return; stage = x.id; pick = null; queueFilter = ''; repaint(); } })), { align: 'start', minWidth: 200 }),
    'to-initials': () => shownCtx?.go('settings'),
    'undo-last': () => takeBackLast(),
    'open-doc': () => recordActs.open?.(),
    'assess-criteria': () => shownCtx?.go('protocol'),
    assess: btn => recordActs.assess?.(btn),
    'assess-stop': () => { const j = batchOf(stage); if (j) cancelJob(j.id); },
    'scr-propose': () => recordActs.propose?.(),
    'scr-import-sheet': async () => {
      const result = await importReviewerSheet({ me: { key: reviewer(), names: [settings().reviewerName, settings().reviewerInitials] }, done: repaint, say: msg => rerender(msg) });
      // the import's counts: the bar's message now, a notice over the record until dismissed; with conflicts, the list shows them
      if (result) { imported = result; if (result.conflicts) { show = 'disagreements'; pick = null; sub = null; } filterBar?.(); rerender(result.text); }
    },
    'scr-rescreen': () => rescreen(() => filterBar?.(), rerender),
    'scr-log': () => openSub('log'),
    'scr-proposals': (btn, e) => proposalsMenu(btn, rerender, e),
    'scr-clear': async () => {
      const n = Object.keys(get()[stageOf(stage).key] || {}).length;
      const ok = await confirmAsk(`Clear ${n} ${stageOf(stage).label.toLowerCase()} ${n === 1 ? 'decision' : 'decisions'}?`,
        { detail: stage === 'ta' ? 'Full-text decisions are cleared with them' : '', confirm: 'Clear', danger: true });
      if (!ok) return;
      reset(stage, { by: reviewer() }); pick = null; rerender();
    },
  });
}
/** The record's commands in the title bar answer for the record this render drew: with none drawn they wait, disabled, in their places. */
function syncBar() {
  for (const id of ['open-doc', 'assess', 'scr-propose']) { const b = document.getElementById(id); if (b) b.disabled = !recordActs[{ 'open-doc': 'open', assess: 'assess', 'scr-propose': 'propose' }[id]]; }
}
/** This reviewer's decisions on the stage's pool, for what the page's commands can do. */
const decisionsOf = s => queue(s, stage, reviewer()).pool.map(p => decisionOf(s, p.id));
/** Undo, or Z on a record: the last decision this session is put back and its record shown. */
function takeBackLast() {
  if (!taken.length) return;
  const t = taken.pop();
  revert(t.stage, t.id, t.prior, { by: t.by });
  stage = t.stage; pick = t.id; skipped.delete(t.id);
  if (show === 'decided' && !t.prior) show = 'open';
  filterBar?.();
  (barRerender || shownCtx?.rerender)?.(); shownCtx?.refreshCounts?.();
}

// ---- the inspector ------------------------------------------------------------------------------------------------------------
// Criteria and proposals are rows that open a criterion in full, in place: a quiet first line (the rule, its kind or the model's answer)
// and the text under it; opened, the criterion's statements and the answer for the record on screen. The numbers read as words
// (Agreement, not agree); an answer is Yes, No or Unclear.
const KIND_NAME = { include: 'Inclusion', exclude: 'Exclusion', group: 'Group' };
// The rows opened in place, by list and rule ('elig:C1', 'prop:C1'), and the batches whose history is shown: kept here, because the
// inspector's sections are drawn again on every paint.
const critOpen = new Set(), batchOpen = new Set();
const critRow = (key, id, head, text, s = get()) => { const open = critOpen.has(key);
  return uiRow({ attrs: { 'data-crit-row': key },
    main: { html: `<button type="button" class="scr-crit-open" data-crit="${esc(key)}" aria-expanded="${open}">${esc(head)}</button>${open ? critDetail(s, id) : ''}`, detail: open ? [] : [esc(text)], wrap: true } }); };
/** A press on a criterion row (outside what it opened) opens or closes it; `redraw` draws its list again. */
const wireCrit = (el, redraw) => el.querySelectorAll('[data-crit-row]').forEach(r => r.onclick = e => {
  if (e.target.closest('.scr-crit-detail')) return;
  const k = r.dataset.critRow; if (!critOpen.delete(k)) critOpen.add(k); redraw();
});
const critList = (label, rows, empty) => uiList({ label, rows, empty: emptyState({ title: empty, size: 'inline' }) });
const num2 = x => Number.isFinite(Number(x)) ? Number(x).toFixed(2) : '';

/** The inspector's Details for the record on screen. */
export function inspect(ctx) {
  const s = get(); const cur = s.papers.find(p => p.id === pick);
  const rules = rulesOf(s);
  const secs = [{
    // the head in the list, the list flush (as Labels): Edit criteria beside the title, not a button of its own under the criteria
    html: `<div class="ui-flush">${uiList({ label: 'Eligibility criteria', head: secHead('scr-eligibility-acts', 'Eligibility', [{ id: 'scr-edit-criteria', label: 'Edit criteria', icon: 'criteria-edit' }]),
      rows: rules.map(c => critRow(`elig:${c.id}`, c.id, [KIND_NAME[c.kind] || 'Inclusion', c.id, c.stage === 'Full text' ? 'Full text' : ''].filter(Boolean).join(', '), c.text, s)), empty: emptyState({ title: 'No criteria', size: 'inline' }) })}</div>`,
    wire: el => {
      el.querySelector('#scr-edit-criteria').onclick = () => ctx.go('protocol');
      wireCrit(el, () => (ctx.refreshDetails || ctx.rerender)());
    },
  }];
  const hl = highlights(s);
  secs.push({ title: 'Highlights', meta: hl.off ? 'Off' : String(hl.include.length + hl.exclude.length || ''),
    html: `<div class="scr-hl-form"><label class="field"><span>Include terms</span><input data-hl="include" value="${esc(hl.include.join(', '))}" placeholder="randomi*, cohort" aria-label="Include terms"></label>
      <label class="field"><span>Exclude terms</span><input data-hl="exclude" value="${esc(hl.exclude.join(', '))}" placeholder="animal*, cadaver*" aria-label="Exclude terms"></label>
      <label class="scr-hl-on"><input type="checkbox" data-hl-on${hl.off ? '' : ' checked'}><span>Show highlights</span></label></div>`,
    wire: el => {
      const save = patch => { update(st => { st.screeningHighlights = { ...highlights(st), ...patch }; return st; }); ctx.rerender(); };
      el.querySelectorAll('[data-hl]').forEach(i => i.onchange = () => save({ [i.dataset.hl]: termsOf(i.value) }));
      el.querySelector('[data-hl-on]').onchange = e => save({ off: !e.target.checked });
    } });
  const agree = jevAgreement(s, stage);
  if (agree.n) secs.push({ title: 'Agreement', meta: `n ${agree.n}`,
    html: `<div class="scr-kv"><span>Agreement</span><span>${(agree.agree / agree.n).toFixed(2)}</span>
      ${agree.sensitivity != null ? `<span>Sensitivity</span><span>${agree.sensitivity.toFixed(2)}</span>` : ''}
      ${agree.specificity != null ? `<span>Specificity</span><span>${agree.specificity.toFixed(2)}</span>` : ''}</div>` });
  if (evaluation?.stage === stage) secs.push(evaluationSection());
  if (!cur) return secs;
  const pr = queueFilter === 'sample' ? null : s.proposals?.[stage]?.[cur.id];
  if (pr) {
    const answers = pr.screeningVersion?.startsWith('abstract-screening-v') ? [] : (pr.criteria || []).map(c => {
      const j = pr.jev?.criteria?.find(x => x.id === c.id), r = rules.find(x => x.id === c.id), p = c.p != null ? num2(c.p) : j?.p != null ? num2(j.p) : '';
      return critRow(`prop:${c.id}`, c.id, [cap(c.met || 'unclear'), c.id, p].filter(Boolean).join(', '), c.note || c.quote || r?.text || '', s); });
    secs.push({ title: 'Proposal', meta: pr.model || '',
      html: `<div class="scr-assess-line">${verdictHtml(pr.verdict, pr.screeningOutcome === 'advance' ? 'Full-text review' : cap(pr.verdict))}${pr.p != null && Number.isFinite(Number(pr.p)) ? `<span class="meta">${esc(num2(pr.p))}</span>` : ''}</div>${answers.length ? critList('Answers by criterion', answers, '') : ''}`,
      wire: el => wireCrit(el, () => (ctx.refreshDetails || ctx.rerender)()) });
  }
  const hist = decisions(s, { by: isDual(s) ? reviewer() : '' }).filter(d => d.id === cur.id);
  secs.push({ title: 'Decisions', meta: String(hist.length || ''),
    html: critList('Decisions on this record', hist.map((d, i) => uiRow({ attrs: { 'data-hist': i },
      main: { html: verdictHtml(d.decision), detail: [d.stage === 'ft' ? 'Full text' : 'Title', d.reason, d.by, d.via].filter(Boolean).map(esc), wrap: true },
      end: uiRowEnd({ more: { label: 'Decision actions', attrs: { 'data-undo': i } } }) })), 'Not decided'),
    wire: el => el.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Undo this decision', icon: 'undo', run: () => {
      const d = hist[+b.dataset.undo]; undo(d.stage, d.id, { by: reviewer() }); ctx.rerender(); ctx.refreshCounts(); } }])) });
  { const prior = priorSection(cur.screeningReview); if (prior) secs.push(prior); }
  secs.push(labelSection(s, cur, ctx));
  if (isDual(s)) secs.push(conflictSection(s, ctx), assignmentSection(s, ctx));
  secs.push(stoppingSection(s, ctx, cur));
  secs.push(validationSection(s, ctx));
  return secs;
}

// ---- validation (AI validation feature: lib/screen-validation.mjs) ---------------
// Model proposals against this project's own decisions: the confusion table, the
// figures read from it, lost evidence (relevant records the model proposed to
// exclude) and the random recall check of model-excluded records. Nothing is
// stored until "Record validation" is pressed.
function validationSection(s, ctx) {
  const r = validationReport(s, stage), m = r.metrics, c = r.confusion, l = r.lostEvidence, rc = r.recallCheck, e = rc?.estimate;
  const pc = x => x == null ? '–' : `${(x * 100).toFixed(1)}%`, d2 = x => x == null ? '–' : x.toFixed(2);
  const range = a => a ? `${pc(a[0])} to ${pc(a[1])}` : '';
  const pool = excludedPool(s, stage).length;
  const alt = r.alternative.lostEvidence;
  return {
    html: `${secHead('scr-validation-acts', r.n ? `Validation, n ${r.n}` : 'Validation', [
        { id: 'scr-recall', label: rc ? 'New recall sample' : 'Draw recall sample', disabled: !pool },
        ...(rc && e?.left ? [{ id: 'scr-recall-go', label: 'Screen sample' }] : []),
        { id: 'scr-record', label: 'Record validation', disabled: !(r.n || rc) }])}${r.n ? `<table class="scr-conf-table"><thead><tr><th></th><th>Person include</th><th>Person exclude</th></tr></thead><tbody>
        <tr><td>Model include</td><td>${c.tp}</td><td>${c.fp}</td></tr><tr><td>Model exclude</td><td>${c.fn}</td><td>${c.tn}</td></tr></tbody></table>
      <div class="scr-kv">
        <span>Lost evidence</span><span>${l.share == null ? '–' : `${l.lost} of ${l.relevant} relevant, ${pc(l.share)} (95% CI ${range(l.ci)})`}</span>
        ${c.modelUncertain ? `<span>If uncertain is exclude</span><span>${alt.share == null ? '–' : `${alt.lost} of ${alt.relevant}, ${pc(alt.share)} (95% CI ${range(alt.ci)})`}</span>` : ''}
        <span>Recall</span><span>${pc(m.recall)}</span><span>Specificity</span><span>${pc(m.specificity)}</span>
        <span>Precision</span><span>${pc(m.precision)}</span><span>Accuracy</span><span>${pc(m.accuracy)}</span>
        <span>F1</span><span>${d2(m.f1)}</span><span>Prevalence</span><span>${pc(m.prevalence)}</span>
        <span>MCC</span><span>${d2(m.mcc)}</span><span>Cohen's kappa</span><span>${d2(m.kappa)}</span><span>Gwet's AC1</span><span>${d2(m.ac1)}</span>
        ${c.modelUncertain ? `<span>Model uncertain</span><span>${c.modelUncertain}, read as include</span>` : ''}
        ${c.personUncertain ? `<span>Person uncertain</span><span>${c.personUncertain}, left out</span>` : ''}
      </div>` : emptyState({ title: 'No paired records', size: 'inline' })}
      <div class="scr-kv"><span>Recall check</span><span>${!rc ? `${pool} model-excluded, none drawn` : e?.left ? `${e.left} of ${rc.ids.length} to screen` : e?.share == null ? 'Nothing screened' : `${e.x} of ${e.n} relevant, ${pc(e.share)} (95% CI ${range(e.ci)}), about ${Math.round(e.implied)} of ${e.pool} model-excluded (${Math.floor(e.impliedCi[0])}–${Math.ceil(e.impliedCi[1])})`}</span></div>
`,
    wire: el => {
      el.querySelector('#scr-recall').onclick = async () => {
        const v = await ask(`Random sample of the ${pool} records the model proposed to exclude`, { value: String(Math.min(pool, 50)), confirm: 'Draw' });
        const n = Math.round(Number(v)); if (!(n > 0)) return;
        storeRecallCheck(stage, { n }); ctx.rerender();
      };
      const go = el.querySelector('#scr-recall-go');
      if (go) go.onclick = () => { const chk = get().aiValidation?.screening?.[stage]?.recallCheck; if (!chk) return;
        sample = { stage, ids: new Set(chk.ids) }; queueFilter = 'sample'; show = 'open'; pick = null; filterBar?.(); ctx.rerender(); };
      el.querySelector('#scr-record').onclick = () => { storeValidation(stage); ctx.rerender(); };
    } };
}

// A Details section's head is one row: its title with its commands beside it, quiet, folding into More when the pane is narrow, so no
// section ends in a button of its own (owner, 2026-10-22, on this pane: "did you improve this look"). The section then draws no shell title.
const secHead = (id, title, actions) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h3' }, actions: actions.map(a => ({ role: 'quiet', ...a })) });

// ---- labels (plan E1) -------------------------------------------------------------
// The project's labels, each a checkbox for the record on screen, with its
// count; New label makes one and puts it on the record. Rename and Delete are
// in Manage. Under blind dual screening the checks are the reviewer's own.
function labelSection(s, cur, ctx) {
  const list = labelList(s), mine = new Set(labelsOf(s, cur.id, labelScope(s)).map(l => l.id)), n = labelCounts(s);
  return {
    // the head in the list, the list flush: its title and rows start on the section's edge, as the other sections' do
    html: `<div class="ui-flush">${uiList({ label: 'Labels', id: 'scr-labels', cols: [], windowed: true, head: secHead('scr-label-acts', 'Labels', [{ id: 'scr-label-new', label: 'New label', icon: 'plus' }, ...(list.length ? [{ id: 'scr-label-manage', label: 'Manage', menu: true }] : [])]), empty: emptyState({ title: 'No labels', size: 'inline' }), rows: list.map(l => uiRow({
        check: { checked: mine.has(l.id), label: `Label: ${l.name}`, attrs: { 'data-label': l.id } }, main: { html: `<span class="scr-label-name">${esc(l.name)}</span>` },
        cells: [{ col: 'count', kind: 'text', ch: 4, html: String(n[l.id] || '') }] })) })}</div>`,
    wire: el => {
      el.querySelectorAll('[data-label]').forEach(b => b.onchange = async () => { await setLabel(cur.id, b.dataset.label, b.checked, { by: reviewer() }); ctx.rerender(); });
      const box = el.querySelector('#scr-labels'); if (box) pageList(box, 'scr-labels', ':scope > .ui-row', 12);
      el.querySelector('#scr-label-new').onclick = async () => {
        const name = await ask('New label', { placeholder: 'Label', confirm: 'Add' });
        const l = name?.trim() ? addLabel(name, { by: reviewer() }) : null;
        if (l) { await setLabel(cur.id, l.id, true, { by: reviewer() }); ctx.rerender(); }
      };
      const m = el.querySelector('#scr-label-manage');
      if (m) m.onclick = () => showMenu(m, labelList(get()).map(l => ({ label: l.name, meta: String(labelCounts(get())[l.id] || ''), submenu: [
        { label: 'Rename', run: async () => { const name = await ask('Rename label', { value: l.name, confirm: 'Rename' }); if (name?.trim()) { renameLabel(l.id, name, { by: reviewer() }); ctx.rerender(); } } },
        { label: 'Delete', run: async () => { const k = labelCounts(get())[l.id] || 0;
          const point = undoPoint(); removeLabel(l.id, { by: reviewer() }); if (recFilter.label === l.id) recFilter.label = ''; ctx.rerender();
          offerUndo(point, `Deleted ${l.name}${k ? `, taken off ${k} ${k === 1 ? 'record' : 'records'}` : ''}`, () => ctx.rerender()); } }] })));
    } };
}

// ---- conflicts (plan E5) ----------------------------------------------------------
function conflictSection(s, ctx) {
  const all = conflicts(s, stage, { resolved: true }), open = all.filter(c => !c.resolution).length, kap = agreement(s, stage);
  return { title: 'Conflicts', meta: String(open || ''),
    html: `<div class="scr-kv"><span>Open</span><span>${open}</span><span>Resolved</span><span>${all.length - open}</span>${kap.n ? `<span>Agreement, all records</span><span>κ ${kap.kappa.toFixed(2)} (n ${kap.n})</span>` : ''}</div>
      ${all.length ? inspectorActions({ label: 'Conflict actions', id: 'scr-conflict-acts', actions: [{ id: 'scr-show-conflicts', label: show === 'disagreements' ? 'Showing disagreements' : 'Show disagreements', disabled: show === 'disagreements' }] }) : ''}`,
    wire: el => { const b = el.querySelector('#scr-show-conflicts'); if (b) b.onclick = () => { show = 'disagreements'; pick = null; filterBar?.(); ctx.rerender(); }; } };
}

// ---- assignments (plan E4) --------------------------------------------------------
const pct = (a, b) => b ? `${a} of ${b}` : '0';
function assignmentSection(s, ctx) {
  const bs = batchesOf(s, stage).filter(b => b.kind !== 'check');
  const people = reviewerSummary(s, stage);
  const pool = queue(s, stage).pool.map(p => p.id), left = unassigned(s, stage, pool).length;
  const kindName = { calibration: 'Calibration', split: 'Split', manual: 'Batch' };
  return { title: 'Assignments', meta: bs.length ? String(bs.length) : '',
    html: `${people.length ? `<div class="scr-kv">${people.map(r => `<span>${esc(r.reviewer)}</span><span>${pct(r.decided, r.assigned)}${r.agreement.filter(a => a.n).map(a => `; κ ${a.kappa.toFixed(2)} with ${esc(a.with)} (n ${a.n})`).join('')}</span>`).join('')}</div>` : ''}
      ${bs.length ? uiList({ label: 'Batches', id: 'scr-batches', rows: pagedList('scr-batches', bs, { label: 'batches' }).items.map(b => uiRow({ attrs: { 'data-batch-row': b.id },
          main: { html: `<span class="scr-batch-name">${esc(b.name)}</span>${batchOpen.has(b.id) && b.history?.length ? `<div class="scr-kv scr-batch-history">${b.history.map(h => `<span>${esc(when(h.at))}</span><span>${esc(`${h.from} → ${h.to}${h.by ? ` by ${h.by}` : ''}`)}</span>`).join('')}</div>` : ''}`, wrap: true,
            detail: [b.name.startsWith(kindName[b.kind] || 'Batch') ? '' : kindName[b.kind] || 'Batch', ...batchProgress(s, b).map(r => `${r.reviewer} ${r.state}, ${r.decided} of ${r.assigned}`)].filter(Boolean) },
          end: uiRowEnd({ more: { label: `Actions for ${b.name}`, attrs: { 'data-batch': b.id } } }) })) }) + pagedList('scr-batches', bs, { label: 'batches' }).pager
        : emptyState({ title: 'No batches', size: 'inline' })}
      ${inspectorActions({ label: 'Assignment actions', id: 'scr-assign-acts', actions: [{ id: 'scr-calib', label: 'Calibration batch', menu: true }, { id: 'scr-split', label: `Split ${left} unassigned`, disabled: !left }] })}`,
    wire: el => {
      wirePagedList(el, 'scr-batches', () => (ctx.refreshDetails || ctx.rerender)());
      const me = reviewer();
      const who = async title => { const known = [...new Set([...reviewersOf(get(), stage), ...batchesOf(get()).flatMap(b => b.reviewers), me].filter(Boolean))];
        const v = await ask(title, { value: known.join(', '), placeholder: 'Initials, comma separated', confirm: 'Next' });
        return v == null ? null : [...new Set(v.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean))]; };
      const calib = async strat => {
        const free = unassigned(get(), stage, queue(get(), stage).pool.map(p => p.id));
        if (!free.length) return;
        const nRaw = await ask('Calibration batch size', { value: String(Math.min(30, free.length)), placeholder: '20–50', confirm: 'Next' });
        const n = Math.round(Number(nRaw)); if (!(n > 0)) return;
        const people = await who('Reviewers of the calibration batch'); if (!people?.length) return;
        const seed = Math.floor(Math.random() * 2 ** 31);
        const byId = new Map(get().papers.map(p => [p.id, p]));
        const ids = drawIds(free, n, { seed, strataOf: strat ? id => String(byId.get(id)?.database || byId.get(id)?.source || '') : null });
        addBatches([{ name: `Calibration (${ids.length})`, kind: 'calibration', stage, ids, reviewers: people, seed, ...(strat ? { strata: 'source' } : {}) }], { by: me });
        ctx.rerender(); ctx.refreshCounts();
      };
      const cb = el.querySelector('#scr-calib');
      cb.onclick = () => showMenu(cb, [{ label: 'Random', run: () => calib(false) }, { label: 'Stratified by source', run: () => calib(true) }]);
      el.querySelector('#scr-split').onclick = async () => {
        const free = unassigned(get(), stage, queue(get(), stage).pool.map(p => p.id));
        const people = await who(`Split ${free.length} records between`); if (!people?.length) return;
        const ov = await ask('Also screened by a second reviewer, %', { value: '0', placeholder: '0–100', confirm: 'Split' });
        if (ov == null) return;
        const overlap = Math.max(0, Math.min(100, Number(ov) || 0)) / 100, seed = Math.floor(Math.random() * 2 ** 31);
        addBatches(splitIds(free, people, { seed, overlap }).map(x => ({ name: `${x.reviewer} (${x.ids.length})`, kind: 'split', stage, ids: x.ids, reviewers: [x.reviewer], seed })), { by: me });
        ctx.rerender(); ctx.refreshCounts();
      };
      el.querySelectorAll('[data-batch]').forEach(b => b.onclick = () => {
        const batch = batchesOf(get()).find(x => x.id === b.dataset.batch); if (!batch) return;
        showMenu(b, [
          ...batch.reviewers.map(r => ({ label: `Reassign ${r}`, run: async () => { const to = await ask(`Reassign ${r}'s records to`, { placeholder: 'Initials', confirm: 'Reassign' }); if (to?.trim()) { reassign(batch.id, r, to.trim(), { by: me }); ctx.rerender(); ctx.refreshCounts(); } } })),
          ...(batch.history?.length ? [{ label: batchOpen.has(batch.id) ? 'Hide history' : 'History', run: () => { if (!batchOpen.delete(batch.id)) batchOpen.add(batch.id); (ctx.refreshDetails || ctx.rerender)(); } }] : []),
          '-', { label: 'Remove batch', run: async () => { const point = undoPoint(); removeBatch(batch.id, { by: me }); ctx.rerender(); ctx.refreshCounts();
            offerUndo(point, `Removed ${batch.name}`, () => { ctx.rerender(); ctx.refreshCounts(); }); } }]);
      });
    } };
}

// ---- stopping (plan E8) ----------------------------------------------------------
// Three readings, each named for what it is: records decided since the last
// include; the knee rule (Cormack and Grossman 2016) on the order records were
// decided in; and relevant records left, estimated from a random check sample
// of the records still to screen with a Wilson 95% interval.
function stoppingSection(s, ctx, cur) {
  const pool = queue(s, stage).pool;
  const seq = pool.map(p => decisionOf(s, p.id)).filter(d => d && d.decision !== 'uncertain').sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).map(d => d.decision === 'include' ? 1 : 0);
  const chk = checkSample(s, stage);
  let est = null, chkLeft = 0;
  if (chk) {
    const ds = chk.ids.map(id => decisionOf(s, id)).filter(d => d && d.decision !== 'uncertain');
    chkLeft = chk.ids.length - ds.length;
    const inCheck = new Set(chk.ids);
    const since = pool.filter(p => !inCheck.has(p.id) && decisionOf(s, p.id)?.decision === 'include' && String(decisionOf(s, p.id).at || '') > chk.at).length;
    if (!chkLeft) est = remainingFromSample({ k: ds.length, x: ds.filter(d => d.decision === 'include').length, pool: chk.pool ?? pool.length, foundSince: since });
  }
  const knee = kneeRule(seq), r = ranking(stage);
  const stop = stopPrompt(seq, rankCfg(s).stopAfter);
  const times = pool.map(p => decisionOf(s, p.id)?.ms).filter(Boolean).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  const open = queue(s, stage, reviewer()).open.length;
  // where the record on screen stands: in the check sample, and its place in the ranking (the head used to carry both)
  const openIds = new Set(queue(s, stage, reviewer()).open.map(p => p.id)), rk = rankCfg(s).on && show === 'open' ? r : null;
  const order = rk ? rk.order.filter(id => openIds.has(id)) : [], rankPos = cur ? order.indexOf(cur.id) + 1 : 0, score = rk && cur ? scoreOf(stage, cur.id) : null;
  const here = [cur && chk?.ids.includes(cur.id) && !decisionOf(s, cur.id) ? 'In the check sample' : '', rankPos && score != null ? `Rank ${rankPos} of ${order.length}, score ${score.toFixed(3)}` : ''].filter(Boolean).join('; ');
  return {
    html: `${secHead('scr-stopping-acts', 'Stopping', [{ id: 'scr-check', label: chk ? 'New check sample' : 'Draw check sample', disabled: !open }])}<div class="scr-kv">
      ${here ? `<span>This record</span><span>${esc(here)}</span>` : ''}
      <span>Since last include</span><span>${seq.length ? sinceLastInclude(seq) : 'No decisions'}</span>
      <span>Prompt after</span><span><input inputmode="numeric" class="w-num" data-stop-after value="${rankCfg(s).stopAfter || ''}" placeholder="Off" aria-label="Records in a row without an include"> in a row</span>
      ${stop?.reached ? `<span>Review prompt</span><span>${stop.run} in a row, past ${stop.threshold}</span>` : ''}
      <span>Knee rule</span><span>${knee.ratio == null ? 'No includes yet' : `${knee.met ? 'Met' : 'Not met'}; slope ratio ${knee.ratio.toFixed(1)}, needs ${knee.needed} after 150 screened (${knee.screened}); assumes ranked order`}</span>
      <span>Check sample</span><span>${!chk ? 'None drawn' : chkLeft ? `${chkLeft} of ${chk.ids.length} to screen` : `${est.x} of ${est.k} relevant, about ${Math.round(est.estimate)} left (95% CI ${Math.floor(est.low)}–${Math.ceil(est.high)})`}</span>
      ${r ? `<span>Ranking</span><span>${esc(MODELS[r.trained.model])} on ${r.trained.n} decisions${rankingBusy(stage) ? ', retraining' : ''}</span>` : ''}
      ${median ? `<span>Median time on record</span><span>${(median / 1000).toFixed(median < 10000 ? 1 : 0)} s (n ${times.length})</span>` : ''}
    </div>
`,
    wire: el => { el.querySelector('[data-stop-after]').onchange = e => { setRank({ stopAfter: Math.max(0, Math.floor(Number(e.target.value)) || 0) }); ctx.rerender(); }; el.querySelector('#scr-check').onclick = async () => {
      const openIds = queue(get(), stage, reviewer()).open.map(p => p.id);
      const v = await ask(`Random check sample of the ${openIds.length} records to screen`, { value: String(Math.min(openIds.length, Math.max(20, Math.round(openIds.length * 0.05)))), confirm: 'Draw' });
      const n = Math.round(Number(v)); if (!(n > 0)) return;
      const seed = Math.floor(Math.random() * 2 ** 31);
      addBatches([{ name: `Check sample (${Math.min(n, openIds.length)})`, kind: 'check', stage, ids: drawIds(openIds, n, { seed }), reviewers: [reviewer() || 'Any'], seed, pool: openIds.length }], { by: reviewer() });
      show = 'open'; pick = null; filterBar?.(); ctx.rerender();
    }; } };
}

// ---- the conflicts view (plan E5) ----------------------------------------------
// Both reviewers' decisions side by side, with their reasons and notes, and a
// resolution: one reviewer's call, or a third decision, always with the reason
// for it. The reviewers' own decisions are never changed; a resolution can be
// reopened, and both are in the log.
function renderConflict(el, ctx, s, c) {
  if (!c) {
    el.innerHTML = `<div class="panel scr-rec">${importNotice()}<div class="panel-body">${emptyState({ icon: 'check', title: 'No disagreements', actions: [{ id: 'to-open', label: 'To decide', icon: 'run' }] })}</div></div>`;
    el.querySelector('#to-open').onclick = () => { show = 'open'; pick = null; filterBar?.(); ctx.rerender(); };
    wireImportNotice(el, ctx);
    return;
  }
  pick = c.paper.id;
  const p = c.paper, r = c.resolution, rules = rulesOf(s), me = reviewer();
  const reasons = [...rules.map(x => `${x.id}: ${x.text}`), ...REASONS];
  const takes = [...c.decisions.map(d => [`by:${d.by}`, `Take ${d.by}: ${cap(d.decision)}${d.reason ? ` (${d.reason.split(':')[0]})` : ''}`]), ...['include', 'exclude'].map(v => [`as:${v}`, cap(v)])];
  const foot = r ? uiBar(resolvedFootSpec({ message: `Resolved as ${cap(r.decision)}${r.by ? ` by ${r.by}` : ''}` })) : uiBar(resolveFootSpec({ takes }));
  el.innerHTML = `<div class="panel scr-rec">${importNotice()}
    <div class="panel-body scr-body">
      <h3 class="scr-title">${esc(p.title)}</h3>
      <div class="scr-meta">${esc([stageOf(stage).label, authorLine(p.authors), journalDisplay(p.journal), p.year].filter(Boolean).join('; '))}</div>
      <table class="scr-conf-table"><thead><tr><th>Reviewer</th><th>Decision</th><th>Reason</th><th>Note</th><th>When</th></tr></thead><tbody>
        ${c.decisions.map(d => `<tr><td>${esc(d.by)}</td><td class="d-${esc(d.decision)}">${esc(cap(d.decision))}</td><td>${esc(d.reason || '')}</td><td>${esc(d.note || '')}</td><td class="meta">${esc(when(d.at))}</td></tr>`).join('')}
        ${r ? `<tr class="scr-conf-res"><td>${esc(r.by || '')}</td><td class="d-${esc(r.decision)}">${esc(cap(r.decision))}</td><td>${esc(r.reason || '')}</td><td>${esc([r.picked ? `${r.picked}'s decision` : 'Third decision', r.why].filter(Boolean).join(': '))}</td><td class="meta">${esc(when(r.at))}</td></tr>` : ''}
      </tbody></table>
      ${p.abstract ? `<div class="scr-abs">${abstractHtml(p.abstract)}</div>` : '<div class="scr-abs-none"><span>No abstract</span></div>'}
    </div>
    <div class="scr-footer">${foot}</div>
  </div>`;
  { const hl = highlights(s); if (!hl.off) markTerms([el.querySelector('.scr-title'), el.querySelector('.scr-abs')], highlightPattern(hl.include, hl.exclude)); }
  recordActs.open = () => openStudy(ctx, p.id);
  wireImportNotice(el, ctx);
  el.querySelector('#res-reopen')?.addEventListener('click', async () => {
    const why = await ask('Reason for reopening', { placeholder: 'Reason', confirm: 'Reopen' });
    if (!why?.trim()) return;
    await reopen(stage, p.id, { by: me, why }); ctx.rerender(); ctx.refreshCounts();
  });
  const take = el.querySelector('#res-take'); if (!take) return;
  const why = el.querySelector('#res-why'), go = el.querySelector('#res-go');
  const choice = () => { const [k, v] = take.value.split(':'); const d = k === 'by' ? c.decisions.find(x => x.by === v) : null;
    return { decision: d ? d.decision : v, picked: d ? d.by : '', reason: d ? d.reason || '' : '' }; };
  const check = () => { go.disabled = !why.value.trim(); };
  take.onchange = check; why.oninput = check; check();
  const finish = async (ch, reason) => {
    await resolve(stage, p.id, ch.decision, { reason, by: me, picked: ch.picked, why: why.value });
    const next = conflicts(get(), stage).find(x => x.paper.id !== p.id);
    pick = next?.paper.id || p.id; ctx.rerender(); ctx.refreshCounts();
  };
  // An exclusion needs its reason: a reviewer's own stands, any other is asked for in a menu that stands on Resolve.
  go.onclick = () => {
    const ch = choice(); if (go.disabled) return;
    if (!me) { ctx.go('settings'); return; }
    if (ch.decision !== 'exclude' || ch.reason) { finish(ch, ch.reason); return; }
    const at = go.getBoundingClientRect();
    showMenu({ x: at.left, y: at.top - 4 }, [{ heading: 'Reason for exclusion' }, ...reasons.map(r => ({ label: r, run: () => finish(ch, r) }))], { minWidth: Math.max(240, at.width) });
  };
  why.addEventListener('keydown', e => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });
}

// ---- a reviewer sheet's import (screening-sheets.mjs): its result is a notice at the top of the page until it is dismissed ---------
let imported = null;   // { file, text }
const importNotice = () => imported ? `<div class="scr-amend">${uiNotice({ id: 'scr-imported', label: 'Reviewer sheet imported', text: imported.text, dismissible: true,
  actions: imported.conflicts && show !== 'disagreements' ? [{ id: 'scr-imported-show', label: 'Show disagreements' }] : [] })}</div>` : '';
function wireImportNotice(el, ctx) {
  el.querySelector('#scr-imported-dismiss')?.addEventListener('click', () => { imported = null; ctx.rerender(); });
  el.querySelector('#scr-imported-show')?.addEventListener('click', () => { show = 'disagreements'; pick = null; sub = null; filterBar?.(); ctx.rerender(); });
}

/** The re-screen's answer for an excluded record it would no longer exclude: folded like a proposal, and kept apart from the proposals. */
function sweepMarkup(s, id) {
  const sw = sweepOf(s, stage), r = sw?.results?.[id];
  if (!r || r.verdict === 'exclude') return '';
  return `<details class="scr-proposal">
    <summary><span class="scr-proposal-label">${esc(`Re-screen without ${sw.rule}`)}</span><strong class="scr-verdict v-${esc(r.verdict)}">${esc(cap(r.verdict))}</strong><span class="meta">${esc(sw.model || '')}</span></summary>
    <div class="scr-proposal-detail">${r.note ? `<p>${esc(r.note)}</p>` : ''}<p class="meta">${esc(sw.ruleText ? `${sw.rule}: ${sw.ruleText}` : sw.rule)}</p></div>
  </details>`;
}

/** A model's proposal for the record on screen, folded: its verdict, and why. */
function proposalMarkup(pr, rules) {
  if (!pr) return '';
  const failedRule = pr.verdict === 'exclude' ? reasonOf(pr, rules)[0] || '' : '';
  const failedId = failedRule.split(':')[0];
  const verdict = pr.screeningOutcome === 'advance' ? 'Full-text review' : cap(pr.verdict);
  const passes = Array.isArray(pr.passes) && pr.screeningVersion?.startsWith('abstract-screening-v')
    ? `<details class="scr-passes"><summary>Three saved responses</summary>${pr.passes.map(p => `<p>Pass ${esc(p.pass)}: ${esc(p.action === 'advance' ? 'Full-text review' : cap(p.action || 'Missing answer'))}; ${esc(p.answers?.screening?.choice || p.answers?.exclusion?.choice || 'Missing answer')}${p.lowSupport ? '; Weak exclusion score' : ''}${p.internallyInconsistent ? '; Conflicting answers' : ''}</p>`).join('')}</details>`
    : '';
  return `<details class="scr-proposal">
    <summary><span class="scr-proposal-label">Model proposal</span><strong class="scr-verdict v-${esc(pr.verdict)}">${esc(verdict)}</strong>${failedId ? `<span class="scr-proposal-rule">${esc(failedId)}</span>` : ''}<span class="meta">${pr.crossChecked ? '3 passes, ' : ''}${esc(pr.model || '')}</span></summary>
    <div class="scr-proposal-detail">
      ${pr.p != null && Number.isFinite(Number(pr.p)) ? `<p class="meta">Model score ${esc(Number(pr.p).toFixed(2))}</p>` : ''}
      ${pr.jev?.model ? `<p class="meta">Decision model ${esc(pr.jev.model)}</p>` : ''}
      ${pr.triageNote ? `<p>${esc(pr.triageNote)}</p>` : ''}
      ${pr.adjudication?.reason ? `<p><strong>Independent assessment</strong><br>${esc(pr.adjudication.reason)}</p>` : ''}
      ${pr.adjudication?.basis ? `<p class="meta">${esc(pr.adjudication.basis)}</p>` : ''}
      ${!pr.adjudication?.reason && failedRule ? `<p>${esc(failedRule)}</p>` : ''}
      ${passes}
    </div>
  </details>`;
}

let menuActions = null;   // the record in view's decisions, for the menu bar's Decision menu
/** The menu bar's Decision menu while a record is in view (desktop): the queue's keys as rows. */
export function menus() {
  if (!menuActions) return [];
  const a = menuActions;
  return [{ title: 'Decision', items: [
    { label: 'Include', run: a.include }, { label: 'Exclude…', run: a.exclude }, { label: 'Uncertain', run: a.uncertain }, '-',
    { label: 'Skip', run: a.skip }, { label: 'Open Document', run: a.open }, '-', { label: 'Take Back Last Decision', run: a.undo }] }];
}
export function render(el, ctx) {
  // a sub-page is the page alone: the list pane is not drawn beside it (the shell's focus mode), and it comes back with Back
  if (sub && get().papers.length) { shownCtx = ctx; ctx.focus?.(true); renderSub(el, ctx); return; }
  sub = null; ctx.focus?.(false);
  renderPage(el, ctx); syncBar();
}
function renderPage(el, ctx) {
  menuActions = null; shownCtx = ctx;
  for (const k of Object.keys(recordActs)) delete recordActs[k];
  const s = get();
  // The list tools hold counts and the decision log: when a decision changed any of them they are drawn again.
  if (filterBar && toolsKey(s) !== toolsDrawn) filterBar();
  if (!s.papers.length) {
    el.innerHTML = emptyState({ icon: 'screening', title: 'No records to screen',
      actions: [{ id: 'e-search', label: 'Search', icon: 'search', primary: true },
                { id: 'e-lib', label: 'Import records', icon: 'import' }] });
    el.querySelector('#e-search').onclick = () => ctx.go('search');
    el.querySelector('#e-lib').onclick = () => ctx.go('library');
    return;
  }

  // Disagreements: a human conflict opens the conflict editor; any other record of the view is drawn as in All
  if (show === 'disagreements') { const d = disagreementAt(s); if (!d || d.conflict) { renderConflict(el, ctx, s, d?.conflict); return; } pick = d.paper.id; }
  // The first ranking of a session repaints the record's line (its relevance
  // score), unless the reviewer is typing in this view.
  rankedUnsub?.();
  rankedUnsub = onRanked(st => { if (st === stage && el.isConnected && !el.contains(document.activeElement) && !noteDrafts.size) { rankedUnsub?.(); rankedUnsub = null; setTimeout(() => { if (!el.isConnected) return; if (toTop) { toTop = false; pick = rows(get())[0]?.id || pick; } ctx.rerender(); }, 0); } });
  const { dual, me, pool, open, outstanding, cur, rules, jevCfg, jevOk, textOk, amended } = recordState(s);
  const { todo } = narrowed(s, outstanding);
  const mine = cur ? decisionOf(s, cur.id) : null;
  const abstract = cur?.abstract || '';
  const props = s.proposals?.[stage] || {};

  if (!cur) {
    el.innerHTML = `<div class="panel scr-rec"><div class="panel-body">${emptyState({ icon: 'check',
      // "No included records" only when there are none; a full-text stage with every record assessed has nothing outstanding
      title: show === 'disagreements' && pick ? 'Assigned to another reviewer' : open.length && !todo.length ? `${open.length} skipped` : !open.length ? (stage === 'ta' || pool.length ? 'Nothing outstanding' : 'No included records to assess') : 'Choose a record',
      detail: !open.length && pool.length && show !== 'disagreements' ? decidedLine(s, pool) : '',
      actions: show === 'disagreements' ? [] : open.length && !todo.length ? [{ id: 'unskip', label: 'Show skipped', icon: 'run' }]
        : !open.length && stage === 'ta' && queue(s, 'ft').open.length ? [{ id: 'go-ft', label: 'Full text', icon: 'file', primary: true }]
        : [] })}</div></div>`;   // the list's own Decided tab shows the decided records: no second button for it
    el.querySelector('#unskip')?.addEventListener('click', () => { skipped.clear(); ctx.rerender(); });
    el.querySelector('#go-ft')?.addEventListener('click', () => { stage = 'ft'; pick = null; ctx.rerender(); });
    return;
  }

  if (onScreen.id !== cur.id || onScreen.stage !== stage) onScreen = { id: cur.id, stage, at: performance.now(), hidden: 0, hiddenAt: document.hidden ? performance.now() : 0 };
  const labelText = labelNames(s, cur.id, labelScope(s)).join(', ');
  el.innerHTML = `<div class="panel scr-rec">
      ${amended ? `<div class="scr-amend">${uiNotice(amendedNotice())}</div>` : ''}${importNotice()}
      <div class="panel-body scr-body">
        <div class="scr-record-content">
        <h3 class="scr-title">${esc(cur.title)}</h3>
        <div class="scr-meta">${esc([authorLine(cur.authors), journalDisplay(cur.journal), cur.year, labelText].filter(Boolean).join('; '))}</div>
        ${decisionMarkup(mine, cur.id)}
        ${queueFilter === 'sample' ? '' : proposalMarkup(props[cur.id], rules)}
        ${sweepMarkup(s, cur.id)}
        ${stage === 'ft' && !cur.pdf ? `<div class="scr-abs-none"><span>No full text attached</span>
             <button id="to-library">${withIcon('library', 'Library')}</button></div>` : ''}
        ${abstract
          ? `<div class="scr-abs">${abstractHtml(abstract)}</div>`
          : `<div class="scr-abs-none"><span id="abs-state">${!(cur.doi || cur.pmid) ? 'No abstract saved' : cur.abstractTried ? 'No abstract found' : 'Fetching abstract'}</span>
               ${cur.doi || cur.pmid ? `<button id="fetch-abs"${!cur.abstractTried ? ' hidden' : ''}>${withIcon('download', cur.abstractTried ? 'Try again' : 'Fetch abstract')}</button>` : ''}</div>`}
        <div class="scr-assess" id="assess-out" hidden></div>
        </div>
      </div>
      <div class="scr-footer">${uiBar(footSpec({ mine, note: noteDrafts.get(cur.id) ?? '' }))}</div>
    </div>`;
  tick(stage);
  { const hl = highlights(s); if (!hl.off) markTerms([el.querySelector('.scr-title'), el.querySelector('.scr-abs')], highlightPattern(hl.include, hl.exclude)); }

  el.querySelector('#protocol-changes')?.addEventListener('click', () => ctx.go('protocol'));
  wireImportNotice(el, ctx);
  el.querySelector('#to-library')?.addEventListener('click', () => ctx.go('library'));
  // Assess this record (the title bar's More): the answer is written under the abstract; the bar's entry waits meanwhile.
  recordActs.assess = async b => {
    const out = el.querySelector('#assess-out'); if (!out) return;
    if (b) b.disabled = true; out.hidden = false; out.textContent = 'Assessing';
    try {
      const a = await assessRecord(cur, rules, modelFor('screen')), model = modelFor('screen').model;
      const draw = () => { out.innerHTML = `<div class="scr-assess-line">${verdictHtml(a.verdict)}
          <span class="meta">Proposal: ${esc(model)}</span></div>${critList('Answers by criterion', a.criteria.map(c => critRow(`assess:${c.id}`, c.id, [cap(c.met || 'unclear'), c.id].join(', '), c.note || '')), '')}`;
        wireCrit(out, draw); };
      draw();
    } catch (err) { out.textContent = err.message.slice(0, 120); }
    if (b) b.disabled = false;
  };
  // After a decision or a skip, the next record to decide opens: the one after
  // this in the list, else the one before.
  // The list as shown (stage, status, proposal and record filters), so a
  // decision under a filter moves to the next record the filter shows.
  const shown = rows(s);
  const nextAfter = () => { const i = shown.findIndex(p => p.id === cur.id); return i < 0 ? (todo[0]?.id || null) : (shown[i + 1] || shown[i - 1] || null)?.id || null; };
  const skip = () => { const n = nextAfter(); skipped.add(cur.id); pick = n; ctx.rerender(); };
  // Plan E7: the decision model proposes for the whole queue, eight in
  // flight; what it is unsure of goes to the text model for a note. Without a
  // decision model the text model takes every record. Each result is a
  // proposal, never a decision.
  recordActs.propose = async () => {
    // A text-model proposal that already carries the decision model's result
    // (the second tier) has been through the decision model: not sent again.
    const list = outstanding.filter(p => !props[p.id] || (jevOk && props[p.id].tier !== 'jev' && !props[p.id].jev));
    // what the decision model left uncertain and the text model has not seen
    const pending = jevOk ? outstanding.filter(p => props[p.id]?.tier === 'jev' && props[p.id].verdict === 'uncertain') : [];
    if (!list.length && !pending.length) return;
    const est = list.reduce((a, p) => a + estimateTokens(`${p.title} ${p.abstract || ''} ${rules.map(c => c.question || c.text).join(' ')}`), 0);
    const second = textOk;
    const n = list.length || pending.length;
    // Two models when the project asks for it and no decision model leads: each record costs two calls.
    const other = !jevOk ? secondScreenModel() : null;
    const two = other && configured(other) ? other : null;
    // the shared run preview (lib/run-preview.mjs): where the records go, the model(s), the estimate and the data classes, before anything is sent
    const preview = await import('../lib/run-preview.mjs');
    const ok = await preview.confirmRun({ title: `Propose for ${n} ${n === 1 ? 'record' : 'records'}?`, confirm: 'Propose', items: { n, noun: 'record' }, classes: preview.promptSends(SCREEN_ASSESS),
      cfgs: jevOk ? [jevCfg, ...(second && list.length ? [modelFor('screen')] : [])] : [modelFor('screen'), ...(two ? [two] : [])],
      tokens: list.length ? { inTokens: est * (jevOk ? 3 : two ? 2 : 1), outTokens: null } : null,
      detail: jevOk ? (list.length ? `Three cross-check passes${second ? `; uncertain ones then go to ${modelFor('screen').model}` : ''}` : `${pending.length} uncertain`) : two ? `${num(list.length * 2)} calls, one per record for each model` : '' });
    if (!ok) return;
    const st0 = stage;
    if (two) {
      const cfg = modelFor('screen');
      runJob('screen', `Proposals, two models: ${stageOf(st0).label}`, async h => {
        let done = 0; h.count(0, list.length);
        await proposeUnanimous(list, rules, [cfg, two], { stop: () => h.stopped(), onEach: (r, proposal) => {
          h.count(++done, list.length); tick(st0);
          update(st => { st.proposals = st.proposals || {}; st.proposals[st0] = st.proposals[st0] || {}; st.proposals[st0][r.id] = proposal; return st; });
        } });
        return `${done} of ${list.length}`;
      }, { stage: st0 }).then(() => '', err => `Proposals stopped: ${err.message.slice(0, 120)}`)
        .then(msg => { if (el.isConnected && stage === st0) ctx.rerender(msg); });
      ctx.rerender(); return;
    }
    if (!jevOk) {
      const cfg = modelFor('screen');
      runJob('screen', `Proposals: ${stageOf(st0).label}`, async h => {
        let done = 0; h.count(0, list.length);
        await assessMany(list, rules, cfg, { stop: () => h.stopped(), onEach: (r, a) => {
          h.count(++done, list.length); tick(st0);
          if (a && a.verdict) update(st => { st.proposals = st.proposals || {}; st.proposals[st0] = st.proposals[st0] || {};
            st.proposals[st0][r.id] = { verdict: a.verdict, criteria: a.criteria || [], model: cfg.model, at: new Date().toISOString(), tier: 'llm' }; return st; });
        } });
        return `${done} of ${list.length}`;
      }, { stage: st0 }).then(() => '', err => `Proposals stopped: ${err.message.slice(0, 120)}`)
        .then(msg => { if (el.isConnected && stage === st0) ctx.rerender(msg); });
      ctx.rerender(); return;
    }
    const store = (r, a, tier, extra = {}) => update(st => { st.proposals = st.proposals || {}; st.proposals[st0] = st.proposals[st0] || {};
      st.proposals[st0][r.id] = { verdict: a.verdict, p: a.p ?? null, eligible: a.eligible ?? null, criteria: a.criteria || [], model: tier === 'jev' ? jevCfg.model : modelFor('screen').model, at: new Date().toISOString(), tier, ...(a.passes ? { passes: a.passes, rulesSnapshot: a.rulesSnapshot, crossChecked: a.crossChecked, disagreement: a.disagreement, reviewRequired: a.reviewRequired, screeningStage: a.screeningStage, triageVersion: a.triageVersion, screeningVersion: a.screeningVersion, exclusionCategory: a.exclusionCategory, screeningOutcome: a.screeningOutcome, triageNote: a.triageNote, exclusionCandidates: a.exclusionCandidates } : {}), ...extra }; return st; });
    runJob('screen', `Decision model: ${stageOf(st0).label}`, async h => {
      const unsure = pending.slice(); let done = 0;
      if (list.length) {
        h.count(0, list.length);
        await screenMany(list, rules, jevCfg, { stage: st0, stop: () => h.stopped(), onEach: (r, a) => {
          h.count(++done, list.length); tick(st0);
          if (a && a.verdict) { store(r, a, 'jev'); if (a.verdict === 'uncertain') unsure.push(r); }
        } });
      }
      if (unsure.length && !h.stopped() && second) {
        h.progress(`Text model: ${unsure.length} uncertain`); done = 0; h.count(0, unsure.length); tick(st0);
        await assessMany(unsure, rules, modelFor('screen'), { stop: () => h.stopped(), onEach: (r, a) => {
          h.count(++done, unsure.length); tick(st0);
          if (a && a.verdict) store(r, a, 'llm', { jev: get().proposals?.[st0]?.[r.id] });
        } });
      }
      return `${list.length} screened, ${unsure.length} to the text model`;
    }, { stage: st0 }).then(() => '', err => `Screening stopped: ${err.message.slice(0, 120)}`)
      .then(msg => { if (el.isConnected && stage === st0) ctx.rerender(msg); });
    ctx.rerender();
  };
  el.querySelector('#skip')?.addEventListener('click', skip);
  // No abstract on record but an identifier to fetch it by: fetch it now, once.
  if (!abstract && (cur.doi || cur.pmid) && !cur.abstractTried) {
    const id = cur.id;
    update(st => { const p = st.papers.find(x => x.id === id); if (p) p.abstractTried = true; return st; });
    const same = () => el.isConnected && el.querySelector('.scr-title')?.textContent === cur.title;
    fetchAbstract(cur).then(text => {
      if (text) update(st => { const p = st.papers.find(x => x.id === id); if (p) p.abstract = text; return st; });
      if (same()) ctx.rerender();
    }).catch(err => {
      const n = el.querySelector('#abs-state'), b = el.querySelector('#fetch-abs');
      if (n) n.textContent = `Abstract: ${err.message.slice(0, 60)}`; if (b) b.hidden = false;
    });
  }
  el.querySelector('#fetch-abs')?.addEventListener('click', async () => {
    const b = el.querySelector('#fetch-abs'), n = el.querySelector('#abs-state'); b.disabled = true; n.textContent = 'Fetching abstract';
    const id = cur.id;
    try {
      const text = await fetchAbstract(cur);
      if (!text) { n.textContent = 'No abstract found'; b.disabled = false; return; }
      update(st => { const p = st.papers.find(x => x.id === id); if (p) p.abstract = text; return st; });
      ctx.rerender();
    } catch (err) { n.textContent = `Abstract: ${err.message.slice(0, 60)}`; b.disabled = false; }
  });

  // One decision per render: the record on screen is the one decided, and a
  // held key or a double click cannot decide the next one too.
  let settled = false;
  const commit = (d, reason = '') => {
    if (settled) return;
    if (dual && !me) { ctx.go('settings'); return; }
    settled = true;
    const n = mine ? cur.id : nextAfter();
    taken.push({ stage, id: cur.id, prior: priorOf(s, stage, cur.id, me), by: me });
    if (taken.length > TAKEN_MAX) taken.shift();
    const note = (el.querySelector('#scr-note')?.value || '').trim();
    decide(stage, cur.id, d, { reason, by: me, note, ms: timeOnRecord() });
    dropSweepResult(stage, cur.id);   // decided again: no longer open in the re-screen
    noteDrafts.delete(cur.id);
    pick = n;
    ctx.rerender(); ctx.refreshCounts();
  };
  // Exclude asks for a reason before anything is recorded. The reasons are a menu under the button: it opens over the page, so nothing
  // is drawn between the record and the bar, and Escape or a click outside withdraws it.
  const askReason = () => {
    const anchor = el.querySelector('#scr-exclude'); if (!anchor || settled) return;
    const at = anchor.getBoundingClientRect();   // the bar is at the bottom of the window: the menu stands on it, so the button stays in view
    showMenu({ x: at.left, y: at.top - 4 }, [{ heading: 'Reason for exclusion' }, ...[...rules.map(c => `${c.id}: ${c.text}`), ...REASONS, LANGUAGE_REASON].map(r => ({ label: r, run: () => commit('exclude', r) }))], { minWidth: Math.max(240, at.width) });
  };
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () =>
    b.dataset.d === 'exclude' ? askReason() : commit(b.dataset.d));
  recordActs.open = () => openStudy(ctx, cur.id);
  const noteIn = el.querySelector('#scr-note');
  noteIn.addEventListener('input', () => { if (noteIn.value) noteDrafts.set(cur.id, noteIn.value); else noteDrafts.delete(cur.id); });
  noteIn.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); noteIn.blur(); } });
  // Z: the last decision this session is put back and its record shown (Undo in the title bar does the same).
  const takeBack = () => { if (settled || !taken.length) return; settled = true; takeBackLast(); };

  menuActions = { include: () => commit('include'), exclude: askReason, uncertain: () => commit('uncertain'), skip, open: () => openStudy(ctx, cur.id), undo: takeBack };
  ctx.onKey(e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('.menu')) return;
    const k = e.key.toLowerCase();
    if (k === 'i') commit('include');
    else if (k === 'e') askReason();
    else if (k === 'u') commit('uncertain');
    else if (k === 's') skip();
    else if (k === 'o') openStudy(ctx, cur.id);
    else if (k === 'z') takeBack();
    else if (k === 'n') noteIn.focus();
    else return;
    e.preventDefault();
  });
}

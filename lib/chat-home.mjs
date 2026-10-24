// The chat's home (plan §2, "Chat home"): what the full-width chat shows before its first question while a model is connected.
// One composer serves both: the home draws a title over it (in the log) and, under it, what this project needs now and the recent
// chats (in #assist-home). The first message, or a recent chat, turns the home into the conversation. Loaded when first shown.
//
//   homeAsks     the rows offered: the project's own open work (what blocks first, the submission readiness, the next steps, then
//                gaps), one per page and marked by it, each with its reason from the project as a quiet second line; "What should
//                I do next?" only when nothing specific waits, and one question per stage page for a project with nothing open
//   chatRows     the recent chats, named from their first real exchange (lib/chat-titles.mjs), with what they changed; greetings folded
//   STARTS       the starting points under the composer: the owner's recurring workflows
//   drawHome     the title, the rows and their wiring
import { uiList, uiRow } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { ago } from './dates.mjs';
import { PROJECT_ASK } from './assist-menu.mjs';
import { sessionTitle, sessionTime } from './chat-sessions.mjs';
import { chatTitle, greetingOnly, chatOutcome } from './chat-titles.mjs';
import { uiBar } from './ui-actions.mjs';
import { projectName, researchType } from './workflow.mjs';
import { get, update } from '../store.mjs';
import { unresolved, unchecked } from './progress.mjs';
import { checks } from './progress-gate.mjs';
import { prismaBlank } from '../schema.mjs';
import { nextResearchActions } from './research-workflow.mjs';

/** One question per stage page about the whole project, for a project with nothing open; a page the project does not list is skipped. */
export const HOME_ASK = Object.freeze({
  screening: 'Which records still need a decision?',
  extraction: 'Which fields are still empty?',
  appraisal: 'Which domains are still open?',
  analysis: 'Are any inputs missing?',
  certainty: 'What lowers the certainty most?',
  manuscript: 'Check references against library',
  submissions: 'What is missing for submission?',
});
export const HOME_ASKS_MAX = 4;
export const HOME_RECENT_MAX = 3;

/**
 * Open work as something to ask the assistant (owner, 2026-10-22: "improve the suggestions"): a finding the Overview states ("67 unchecked
 * model notes") reads as the request it implies ("Check the 67 unchecked model notes"). `n` is the item's count, when it has one. A kind not
 * listed keeps its own words; a next step is already a request.
 */
const the = (n, one, many) => (n == null ? `the ${many}` : n === 1 ? `the ${one}` : `the ${n} ${many}`);
export const ASK_LABEL = Object.freeze({
  'no-title': () => 'Suggest a working title', 'no-criteria': () => 'Draft the eligibility criteria',
  'partial-search': () => 'Retrieve the searches that stopped early', 'retraction': n => `Check ${the(n, 'record', 'records')} with retraction notices`,
  'malformed': n => `Fix ${the(n, 'record', 'records')} with broken identifiers`, 'full-text': () => 'Find the missing full texts', 'pdf-check': () => 'Find the missing full texts',
  'evidence-changes': () => 'Show what changed since the baseline', 'new-records': n => `Screen ${the(n, 'new record', 'new records')}`,
  'unscreened': n => `Screen ${the(n, 'remaining record', 'remaining records')}`, 'uncertain': n => `Settle ${the(n, 'uncertain decision', 'uncertain decisions')}`,
  'not-extracted': n => `Extract ${the(n, 'study', 'studies')} not extracted yet`, 'unverified-values': n => `Verify ${the(n, 'unchecked value', 'unchecked values')}`,
  'proposals': n => `Review ${the(n, 'proposed value', 'proposed values')}`, 'fill': () => 'Fill the empty cells from the PDFs',
  'unchecked-notes': n => `Check ${the(n, 'unchecked model note', 'unchecked model notes')}`, 'unchecked-footnotes': n => `Check ${the(n, 'footnote', 'footnotes')}`,
  'not-appraised': n => `Appraise ${the(n, 'study', 'studies')} not appraised yet`, 'analysis-stale': () => 'Rerun the analyses whose data changed',
  'analysis-run': () => 'Run the first analysis', 'prisma-blank': n => `Fill ${the(n, 'blank PRISMA count', 'blank PRISMA counts')}`,
  'reporting': () => 'Complete the PRISMA flow and checklist', 'manuscript-errors': () => 'Fix the manuscript errors', 'manuscript-warnings': () => 'Fix the manuscript warnings',
  'citation-check': () => 'Fix the citation problems', 'figure': () => 'Fix the figure problems', 'start-manuscript': () => 'Draft the manuscript outline',
  'revision-due': () => 'Plan the revision before it is due', 'letter': () => 'Summarise the decision letter', 'chase': () => 'Draft a note to the journal',
});
export const askLabel = item => (!item.step && ASK_LABEL[item.kind] ? ASK_LABEL[item.kind](Number.isFinite(item.n) ? item.n : null) : item.text);

/** What a row sends: the request as the person would type it. The assistant's own instructions already say to do what it can and propose the rest. */
export const askFor = item => askLabel(item);

// a finding that only says the request again ("67 unchecked model notes" under "Check the 67 unchecked model notes") is no reason
const stem = w => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
const restates = (text, label) => { const have = new Set(String(label).split(/\s+/).map(stem)); return String(text).split(/\s+/).map(stem).filter(w => w && !/^\d+$/.test(w)).every(w => have.has(w)); };
/** The studies an item names, as "Akgun 2024, Ozer 2021, 4 more". */
const studiesOf = (ids, papers) => { const names = ids.map(id => papers.find(p => p.id === id)).filter(Boolean).map(p => p.label || p.title || p.id); return names.length ? [names.slice(0, 2).join(', ') + (names.length > 2 ? `, ${names.length - 2} more` : '')] : []; };
// where the finding's own words only count, the project says what it is: the studies the unchecked notes are on, the manuscript's first
// findings (lib/progress-gate.mjs checks, loaded with Needs attention), the PRISMA counts still blank
const findingsOf = (state, sev) => (checks.module()?.manuscriptFindings(state) || []).filter(i => i.severity === sev && !String(i.kind).startsWith('ref-')).map(i => String(i.message || '').split(/(?<=\.)\s/)[0].replace(/\.$/, '')).filter(Boolean);
const KIND_REASON = {
  'unchecked-notes': s => studiesOf([...new Set((s.notes || []).filter(unchecked).map(n => n.paper).filter(Boolean))], s.papers || []),
  'manuscript-warnings': s => findingsOf(s, 'warn').slice(0, 2),
  'manuscript-errors': s => findingsOf(s, 'error').slice(0, 2),
  'prisma-blank': s => { const blank = prismaBlank(s); return blank.length ? [blank.slice(0, 2).map(f => f.label).join(', ') + (blank.length > 2 ? `, ${blank.length - 2} more` : '')] : []; },
};
/** A row's reason as parts (drawn with the row separator): what the request is about, from the project, never the request again. */
function reasonOf(item, open, papers = [], state = {}) {
  if (item.step) { const at = item.text.indexOf(': '); return at > 0 ? [item.text.slice(at + 2)] : []; }
  if (Array.isArray(item.ids) && item.ids.length) return studiesOf(item.ids, papers);
  const own = KIND_REASON[item.kind]?.(state);
  if (own?.length) return own;
  const label = askLabel(item), parts = item.text && !restates(item.text, label) ? [item.text] : [];
  const same = open.filter(u => u.kind === item.kind && u.view === item.view);
  if (item.kind === 'figure' && same.length > 1) parts.push(`${same.length} checks failing`);
  return parts;
}
/** A next step's label: its request before the colon; what it is about is the reason. */
const stepLabel = item => { const at = item.text.indexOf(': '); return at > 0 ? item.text.slice(0, at) : item.text; };

/**
 * The rows under the composer, each { label, ask, icon, title, reason }. `open` is lib/progress.mjs unresolved(), `next`
 * lib/research-workflow.mjs nextResearchActions() and `readiness` lib/overview-facts.mjs readinessFacts() (or null); `views` the rail's keys
 * (work on a page the project does not show is left out); `iconOf(view)` the page's icon.
 */
export function homeAsks({ open = [], next = [], readiness = null, papers = [], state = {}, views = [], iconOf = () => 'draft-question' } = {}) {
  const out = [], shown = new Set(views), seen = new Set();
  const push = row => { if (out.length < HOME_ASKS_MAX && shown.has(row.view) && !seen.has(row.view)) { seen.add(row.view); out.push(row); } };
  const take = item => push({ view: item.view, label: item.step ? stepLabel(item) : askLabel(item), ask: askFor(item), icon: iconOf(item.view), title: item.text, reason: reasonOf(item, open, papers, state) });
  open.filter(u => u.severity === 'block').forEach(take);
  // the submission readiness, when a journal is set and it is held down: what holds it, in its own words
  const caps = (readiness?.caps || []).map(c => c.why).filter(Boolean);
  if (readiness?.journal && readiness.score != null && readiness.score < 80 && caps.length) {
    const view = shown.has('submissions') ? 'submissions' : 'overview';
    push({ view, label: 'Raise the submission readiness', ask: `Raise the submission readiness for ${readiness.journal}: ${caps.slice(0, 3).join('; ')}`, icon: iconOf(view),
      title: `${readiness.letter || ''} ${readiness.word || ''}`.trim(), reason: [`${readiness.letter ? `${readiness.letter}, ` : ''}${readiness.score}`, ...caps.slice(0, 2)] });
  }
  next.map(a => ({ ...a, step: true })).forEach(take);
  open.filter(u => u.severity !== 'block').forEach(take);
  if (!out.length) {
    out.push({ label: PROJECT_ASK, ask: PROJECT_ASK, icon: 'draft-question', reason: [] });
    for (const [view, text] of Object.entries(HOME_ASK)) if (shown.has(view) && out.length < HOME_ASKS_MAX) out.push({ label: text, ask: text, icon: iconOf(view), reason: [] });
  }
  return out;
}

export const RECENT_MAX = 5;
/**
 * The recent chats: those used, most recent first, each { thread, title, outcome, auto } (auto: the title the home gives it, to be kept as its
 * name when the person has not named it). Greeting-only chats and those past `max` are folded under Show all.
 */
export function chatRows(threads = [], state = null, { max = RECENT_MAX, all = false, taken = [] } = {}) {
  const used = threads.filter(t => !t.archivedAt && (t.messages || []).some(m => m.role === 'user')).sort((a, b) => sessionTime(b) - sessionTime(a));
  const rows = used.map(t => {
    const auto = chatTitle(t, state, { taken }), title = t.nameManual ? sessionTitle(t) : auto || sessionTitle(t);
    return { thread: t, title, auto: t.nameManual ? '' : auto, outcome: chatOutcome(t, state, title), greeting: greetingOnly(t) };
  });
  const kept = rows.filter(r => !r.greeting);
  const shown = all ? rows : kept.slice(0, max);
  return { shown, folded: rows.length - shown.length };
}
/** The older form: the used chats, most recent first (the history keeps the rest). */
export const recentChats = (threads = [], max = HOME_RECENT_MAX) => chatRows(threads, null, { max }).shown.map(r => r.thread);

/** The owner's recurring workflows, as starting points under the composer: each sends a first message or opens its flow (app.mjs). */
export const STARTS = Object.freeze([
  Object.freeze({ id: 'paper', label: 'Write a paper from a question', icon: 'flow' }),
  Object.freeze({ id: 'numbers', label: 'Check the manuscript\'s numbers', icon: 'scale' }),
  Object.freeze({ id: 'discussion', label: 'Draft the discussion', icon: 'draft' }),
]);
/** The message the discussion starting point sends. */
export const DISCUSSION_ASK = 'Draft the Discussion: the main findings against the included studies and earlier reviews, the strengths and limitations, and what they mean for practice and research. Write it as tracked paragraphs under the Discussion heading, citing only Library records.';

export const homeTitle = name => `<div class="assist-home-title"><h2 class="empty-title">${esc(name ? `Ask about ${name}` : 'Ask about this project')}</h2></div>`;

/** One home row: the whole row one button, led by its icon, its title over a quiet second line of parts, a time at its end. */
const homeRow = (attrs, key, text, parts = [], end = '') => uiRow({ cls: 'assist-home-row', main: { html:
  `<button type="button" class="assist-home-act${parts.length ? ' assist-home-two' : ''}" ${attrs}>${icon(key, { size: 16 })}<span class="assist-home-text"><span class="assist-home-name">${esc(text)}</span>${parts.length ? `<span class="assist-home-why">${parts.map(p => `<span>${esc(p)}</span>`).join('')}</span>` : ''}</span>${end}</button>` } });

/** The rows under the composer. `disabled` while a reply is being written: a question would wait behind it. */
export function homeBelow({ asks = [], recent = [], folded = 0, all = false, starts = STARTS, now = Date.now(), disabled = false } = {}) {
  const dis = disabled ? ' disabled' : '';
  const askRows = asks.map(a => homeRow(`data-sugg="${esc(a.ask)}"${a.title ? ` title="${esc(a.title)}"` : ''}${dis}`, a.icon, a.label, a.reason || []));
  const chatRowsHtml = recent.map(r => homeRow(`data-home-chat="${esc(r.thread.id)}"`, 'assistant', r.title, r.outcome, `<span class="meta">${esc(ago(sessionTime(r.thread), now))}</span>`));
  const section = (id, head, label, rows, foot = '') => rows.length ? `<section aria-labelledby="${id}"><h3 class="assist-home-label" id="${id}">${head}</h3>${uiList({ label, cls: 'assist-home-list', rows, plain: true })}${foot}</section>` : '';
  const more = folded || all ? uiBar({ kind: 'tools', density: 'dense', label: 'More chats', id: 'assist-home-more', cls: 'assist-home-more',
    actions: [{ id: 'assist-home-all', label: all ? 'Show fewer' : `Show all ${recent.length + folded}`, role: 'quiet', plain: true, keep: true, attrs: { 'data-home-all': '' } }] }) : '';
  const startBar = starts.length ? uiBar({ kind: 'tools', density: 'dense', label: 'Starting points', id: 'assist-home-starts', cls: 'assist-home-starts', plainMore: true,
    actions: starts.map(x => ({ id: `assist-start-${x.id}`, label: x.label, icon: x.icon, role: 'quiet', plain: true, disabled, attrs: { 'data-home-start': x.id } })),
    budget: { n: 3, reason: 'the owner\'s three recurring workflows, each one press' } }) : '';
  return startBar + section('assist-home-asks', 'For this project', 'Suggested questions', askRows) + section('assist-home-recent', 'Recent chats', 'Recent chats', chatRowsHtml, more);
}

/**
 * Runs a starting point. `sh` = { go(view, opts), redraw(), box: the composer's field, send() }: a paper run starts from the project's question
 * (its card over the composer; the person starts each stage), the manuscript opens on its checks (statistics, intervals, percentages), the
 * discussion is asked for. Without a question the composer is given the request's start.
 */
export async function runStart(id, sh, state = get()) {
  if (id === 'numbers') return sh.go('manuscript', { arrive: { kind: 'manuscript-warnings', text: 'Numbers checked across the manuscript: statistics, intervals and percentages', hint: '' } });
  if (id === 'discussion') { sh.box.value = DISCUSSION_ASK; return sh.send(); }
  const question = String(state.protocol?.question || state.protocol?.title || '').trim();
  if (!question) { sh.box.value = 'Write a paper from this question: '; return sh.box.focus(); }
  if (!state.paperRun || state.paperRun.ended) {
    const { newRun } = await import('./paper-run.mjs'), kind = { 'meta-analysis': 'meta-analysis', 'scoping-review': 'scoping review' }[researchType(state).id] || 'systematic review';
    update(st => { st.paperRun = newRun({ question, kind, journal: (st.project?.journals || [])[0] || '' }); return st; });
  }
  sh.redraw();
}

let showAll = false, readinessMod = null, readinessAsked = false;
/**
 * Draws the home into the chat's log (`log`, the title) and the region under the composer (`below`). `ask(text)` sends, `openChat(id)` opens a
 * chat, `start(id)` runs a starting point; the titles the home gives unnamed chats are kept as their names (keepNames).
 */
/** Keeps the titles the home gave chats the person has not named ([[id, name]]) as their names, so the history and the title bar read the same. */
export function keepNames(names) {
  const want = new Map(names);
  update(s => { for (const t of s.threads || []) if (want.has(t.id) && !t.nameManual) { t.name = String(want.get(t.id)).slice(0, 80); t.nameAuto = true; } return s; }, { indexNeutral: true });
}
export function drawHome(opts) {
  const { log, below, state, views, iconOf, sessions = [], busy = false, error = '', ask, openChat, start = () => {}, rename = keepNames } = opts;
  log.innerHTML = homeTitle(projectName(state)) + (error ? `<div class="assist-msg assistant" role="alert">${esc(error)}</div>` : '');
  let readiness = null;
  if (readinessMod) { try { const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; readiness = readinessMod.readinessFacts(state, readinessMod.standingFacts(state, today)); } catch { readiness = null; } }
  else if (!readinessAsked) { readinessAsked = true; import('./overview-facts.mjs').then(m => { readinessMod = m; if (below.isConnected) drawHome(opts); }, () => {}); }
  const asks = homeAsks({ open: unresolved(state), next: nextResearchActions(state), readiness, papers: state.papers || [], state, views, iconOf });
  const { shown, folded } = chatRows(sessions, state, { all: showAll, taken: asks.map(a => a.label) });
  // a chat the person has not named keeps the title the home gave it, so the history and the title bar read the same
  const names = shown.filter(r => r.auto && (r.thread.name !== r.auto || !r.thread.nameAuto)).map(r => [r.thread.id, r.auto]);
  below.innerHTML = homeBelow({ asks, recent: shown, folded, all: showAll, disabled: busy });
  below.querySelectorAll('[data-sugg]').forEach(b => b.onclick = () => ask(b.dataset.sugg));
  below.querySelectorAll('[data-home-chat]').forEach(b => b.onclick = () => openChat(b.dataset.homeChat));
  below.querySelectorAll('[data-home-start]').forEach(b => b.onclick = () => start(b.dataset.homeStart));
  below.querySelector('[data-home-all]')?.addEventListener('click', () => { showAll = !showAll; drawHome(opts); });
  if (names.length) rename(names);
}

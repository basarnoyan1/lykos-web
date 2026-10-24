// Model actions: what a model can do in each view, and the one place their
// results wait for a person.
//
// A view registers actions. An action is one bounded model call (or a few,
// in order) over the project's own facts, and it returns a proposal: a list of
// items, each with the text a person reads, what it rests on (a verbatim quote,
// a page), and an accept() that makes the change. Nothing an action does
// writes to the project; only accept() does, one item at a time, when a person
// chooses it (plan §6: models propose, validated code decides what changes).
//
// Every run is a job (plan §4.2), so it shows in the status bar while it
// works and in the job log afterwards, and its typed proposal is saved in the
// assistant panel's Proposals tab until accepted or discarded.
//
// Documents, abstracts and notes are untrusted input (plan §6). The shared
// SYSTEM_GUARD is prepended to every action's instructions: text inside the
// material is data, never an instruction.
import * as store from '../store.mjs';
const { get, update, subscribe } = store;
import { researchProjectId, proposalSourceSnapshot } from './research-ledger.mjs';
import { applyProposalPayload, describeProposalPayload } from './proposal-handlers.mjs';
import { configured } from './ai.mjs';
import { listeners, modelLookup as modelFor, describe, recordBrief } from './aid-core.mjs';
export { setModelLookup, onChange, hasModel, modelOf, aidReady, aidNeeded, ensureAid, describe, recordBrief } from './aid-core.mjs';   // the part the shell reads before this file has loaded
import * as jobs from './jobs.mjs';
import { SYSTEM_GUARD, projectBrief } from './context.mjs';
export { SYSTEM_GUARD, projectBrief };
import { quoteFound } from './quotes.mjs';
import { recordOutcome } from './ai-outcomes.mjs';
import { actionIcon } from './icons.mjs';
import { uiReview, uiBar, uiSwap, uiList, uiRow, uiStatusLine, CH_STEPS } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { uiLink } from './ui-components.mjs';
import { manuscriptProposalKind, manuscriptProposalLocation, manuscriptChangeSummary, manuscriptProposalPreview, visibleText } from './manuscript-suggestions.mjs';


const registry = new Map();      // view key -> action[]
const entries = [];              // live/restored proposals, newest first

/**
 * action: {
 *   id, label, icon?, task: settings task key ('screen', 'extract', 'appraise', 'write', 'query', 'assist', 'tasks'),
 *   when?(state, context) -> boolean   (offered only when true; context as below),
 *   local?: true   (no model call: runs without a configured model; task 'local'),
 *   optionalModel?: true   (a model call is one step among local ones: the action runs, and files its local findings, without a configured model;
 *     `cfg` is then not configured and the action skips its model step),
 *   brief?: { record?: false, criteria?: false }   (leave out of the brief what the
 *     action sends itself: the focused record, or the eligibility criteria),
 *   run({ state, cfg, signal, selection, focus, document, context, brief, progress }) -> Promise<Proposal>
 *     (brief: the whole context as prompt text — project, view, focus, document, selection)
 * }
 * Proposal: { title, meta?, note?, items: Item[] }
 * Item: { label, detail?, quote?, preview? (trusted HTML the app generated, e.g. lib/output-render.mjs previewHtml), where?: { paperId, locator?, label }, accept?() -> string|void, acceptLabel? }
 *   An item without accept() is information only (a check result, a finding).
 */
export function register(view, actions) {
  const list = registry.get(view) || [];
  for (const a of actions) {
    if (!a?.id || !a.label || typeof a.run !== 'function') throw new Error(`aid: action needs id, label and run (${view})`);
    if (list.some(x => x.id === a.id)) continue;
    list.push({ ...a, icon: actionIcon(a.id, a.icon || 'sparkle') });
  }
  registry.set(view, list);
}

const generation = () => store.projectGeneration?.() ?? get().project;
// until the project is replaced (the store's generation); edits that rewrite `project` (a target journal) keep it
const belongs = e => e.generation === generation();
function persistEntry(entry) {
  if (!belongs(entry)) return;
  const { project, generation: _generation, abort, ...record } = entry;
  record.items = entry.items.map(({ accept, pending, ...it }) => ({ ...it, canAccept: !!accept, pending: false }));
  update(s => { s.aiProposalLedger = [...(s.aiProposalLedger || []).filter(e => e.id !== record.id), structuredClone(record)]; return s; },{indexNeutral:true});
}
// Progress of one action must not serialize every prior proposal and its frozen
// dataset. Only the changed entry needs persistence.
const emit = entry => { if (entry) persistEntry(entry); for (const l of listeners) l(); };
/** The last acceptance's undos, in memory only: { entryId, undos, key, keyAt, generation, verb, done, of, skipped }. */
let lastAccept = null, ticking = false;

/** Actions a view offers right now. */
export function actionsFor(view, ctx = {}) {
  const s = get();
  return (registry.get(view) || []).filter(a => { try { return !a.when || a.when(s, ctx); } catch { return false; } });
}
export const actionViews = () => [...registry].map(([view,actions]) => ({view,actions:actions.length}));
/** Every action id registered for a view, whatever its `when` says now (lib/assist-menu.mjs is held to this). */
export const actionIds = view => (registry.get(view) || []).map(a => a.id);
export function allEntries() {
  const owner = researchProjectId();
  for (const saved of get().aiProposalLedger || []) {
    if (saved.projectId !== owner || entries.some(e => belongs(e) && e.id === saved.id)) continue;
    const e = { ...structuredClone(saved), project: get().project, generation: generation(), abort: new AbortController() };
    if (e.status === 'running') { e.status = 'stopped'; e.error = 'Interrupted. Run this action again.'; }
    e.items = e.items.map(it => ({ ...it, accept: it.canAccept && it.payload ? ({signal}={}) => applyProposalPayload(it.payload, applicationContext(e, signal)) : null,
      ...(it.state === 'open' && it.canAccept && !it.payload ? { result: 'Run this action again to restore its reviewable changes.' } : {}) }));
    entries.push(e);
  }
  return entries.filter(belongs).sort((a,b) => b.at - a.at);
}
/**
 * The suggestions that still wait for a person: open, acceptable and not stale (already done, gone, dismissed). The one count the
 * Proposals tab, the status bar and each entry's head show. `list` defaults to every entry of the project.
 */
export function openItems(list = allEntries(), state = get()) {
  return list.flatMap(e => e.items.filter(i => i.state === 'open' && i.accept && !describeItem(i, state).stale).map(item => ({ entry: e, item })));
}
export const openCount = () => openItems().length;

let seq = 0;
const entryId = () => `e${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2,7)}`;
function assertCurrent(entry, source = true) {
  if (!belongs(entry) || entry.projectId !== get().researchLedger?.projectId) throw new Error('The project was replaced. This proposal cannot change the current project.');
  if (source && entry.sourceSnapshot && entry.sourceSnapshot !== proposalSourceSnapshot(get())) throw new Error('Source data changed since this proposal. Request an updated proposal.');
}
function applicationContext(entry, signal) {
  return { signal, entry, guard: () => assertCurrent(entry), guardBoundary: () => assertCurrent(entry, false),
    checkpoint: async () => {
      assertCurrent(entry); persistEntry(entry);
      await store.persist();
      if (store.saveError()) throw new Error(`Save the proposal before applying it: ${store.saveError()}`);
      assertCurrent(entry);
    } };
}
/**
 * Runs an action and files its proposal. Returns the entry. Errors are kept
 * on the entry and shown there, never thrown at the caller: an action started
 * from a menu has nobody waiting on its promise.
 */
export async function run(view, id, ctx = {}) {
  const action = (registry.get(view) || []).find(a => a.id === id);
  if (!action) throw new Error(`aid: no action ${view}/${id}`);
  const cfg = modelFor(action.task) || {};
  const projectId = researchProjectId();
  const entry = { id: entryId(), projectId, project: get().project, generation: generation(), sourceSnapshot: proposalSourceSnapshot(get()), view, action: id, title: action.label, meta: cfg.model || '',
    status: 'running', progress: '', error: '', note: '', items: [], at: Date.now(), abort: new AbortController() };
  entries.unshift(entry);
  emit(entry);
  if (!action.local && !action.optionalModel && !configured(cfg)) {
    entry.status = 'failed'; entry.error = 'No model is set for this task'; entry.needsModel = true; emit(entry);
    return entry;
  }
  const stop = () => entry.abort.abort();
  const unwatch = subscribe(() => { if (!belongs(entry)) stop(); });
  if (ctx.signal?.aborted) stop(); else ctx.signal?.addEventListener('abort', stop, {once:true});
  const job = jobs.start(action.local ? 'check' : 'model', action.label);
  const progress = text => { entry.progress = String(text || ''); job.progress(text); emit(entry); };
  try {
    // ctx is the context the shell captured when the action was chosen
    // (see describe below); run gets it whole, and its text form ready to send.
    if(entry.abort.signal.aborted)throw new DOMException('Run stopped','AbortError');
    const p = await action.run({ state: get(), cfg, signal: entry.abort.signal, selection: ctx.selection || '',
      focus: ctx.focus || null, document: ctx.document || null, context: ctx, brief: describe(ctx, get(), action.brief), progress });
    if(entry.abort.signal.aborted)throw new DOMException('Run stopped','AbortError');
    entry.title = p?.title || action.label;
    entry.note = p?.note || '';
    entry.prompt = p?.prompt || '';   // the prompt ref the action ran (lib/prompts.mjs promptRef), for the log
    if (p?.meta) entry.meta = [entry.meta, p.meta].filter(Boolean).join(', ');
    entry.items = (p?.items || []).map((it, i) => ({ ...it, id: `${entry.id}-${i}`, state: 'open' }));
    entry.status = 'done';
    job.done(`${entry.items.length} ${entry.items.length === 1 ? 'item' : 'items'}`);
  } catch (err) {
    entry.status = err?.name === 'AbortError' ? 'stopped' : 'failed';
    entry.error = String(err?.message || err).slice(0, 240);
    job.fail(err);
  }
  ctx.signal?.removeEventListener('abort', stop);
  unwatch();
  entry.progress = '';
  emit(entry);
  return entry;
}

/**
 * Files a finished proposal that did not come from a registered action — the
 * chat's propose_changes. Same shape as run() produces; returns the entry.
 */
export function file({ view, title, meta = '', note = '', items = [], prompt = '', sourceSnapshot = proposalSourceSnapshot(get()) }) {
  const projectId = researchProjectId();
  const entry = { id: entryId(), projectId, project: get().project, generation: generation(), sourceSnapshot, view, action: 'chat', title, meta, prompt, status: 'done', progress: '', error: '', note,
    items: [], at: Date.now(), abort: new AbortController() };
  entry.items = items.map((it, i) => ({ ...it, id: `${entry.id}-${i}`, state: 'open' }));
  entries.unshift(entry);
  emit(entry);
  return entry;
}

export function stop(entryId) { allEntries().find(e => e.id === entryId)?.abort.abort(); }

/**
 * Accepts one item: runs its accept() and records what it reported. An accept
 * that writes a file returns a promise; the item says "Saving" until it
 * settles and then what happened, so a failed write never reads as done.
 * An accept that throws, or refuses by returning { refused: '…' }, leaves the
 * item open with the reason shown.
 */
export async function accept(entryId, itemId) {
  allEntries();
  const entry = entries.find(e => e.id === entryId && belongs(e)) || entries.find(e => e.id === entryId);
  const it = entry?.items.find(i => i.id === itemId);
  if (!it || it.state !== 'open' || !it.accept || it.pending) return;
  if (!ticking) lastAccept = null;   // another acceptance: the last one's Undo goes
  if(entry.abort.signal.aborted)entry.abort=new AbortController();
  const unwatch=subscribe(()=>{if(!belongs(entry))entry.abort.abort();});
  const kindOf = () => entry.action === 'chat' ? `chat.${it.op || 'change'}` : `${entry.view}.${entry.action}`;
  const settle = r => {
    if(entry.abort.signal.aborted)throw new Error('Application stopped. No completion is recorded.');
    if (r && typeof r === 'object' && r.refused) { it.result = String(r.refused).slice(0, 160); return; }
    // An op that can take its change back returns { done, undo, key }: the undo is kept in memory for this session only.
    if (r && typeof r === 'object' && 'done' in r) { if (typeof r.undo === 'function') undoOf.set(it.id, { undo: r.undo, key: r.key }); r = r.done; }
    it.result = String(r || ''); it.state = 'accepted';
    recordOutcome({ kind: kindOf(), outcome: 'accepted', model: entry.meta, prompt: entry.prompt, paper: it.where?.paperId || '' });
  };
  try {
    // An op that re-checks the live state itself (a task as it is now) is not refused because the rest of the project moved on.
    assertCurrent(entry, !describeItem(it, get()).live);
    const r = it.accept(applicationContext(entry, entry.abort.signal));
    if (r && typeof r.then === 'function') {
      it.pending = true; it.result = it.pendingLabel||'Saving'; emit(entry);
      try { const out = await r; if (!belongs(entry)) throw new Error('The project was replaced during application. No completion is recorded here.'); settle(out); } finally { it.pending = false; }
    } else settle(r);
    if (it.state === 'accepted' && belongs(entry)) entry.sourceSnapshot = proposalSourceSnapshot(get());
  } catch (err) { it.result = String(err?.message || err).slice(0, 160); }
  finally {unwatch();}
  emit(entry);
}
const undoOf = new Map();   // item id -> { undo, key }, filled by accept, read by acceptTicked
export function discard(entryId, itemId) {
  allEntries();
  const entry = entries.find(e => e.id === entryId && belongs(e));
  const it = entry?.items.find(i => i.id === itemId);
  if (it && it.state === 'open' && !it.pending && belongs(entry)) {
    it.state = 'discarded'; emit(entry);
    recordOutcome({ kind: entry.action === 'chat' ? `chat.${it.op || 'change'}` : `${entry.view}.${entry.action}`, outcome: 'discarded', model: entry.meta, prompt: entry.prompt, paper: it.where?.paperId || '' });
  }
}
export async function acceptAll(entryId) {
  const e = entries.find(x => x.id === entryId && belongs(x));
  // In order, one at a time: later items may depend on earlier ones' writes.
  for (const it of e?.items || []) {
    if (!belongs(e) || e.abort.signal.aborted) break;
    if (it.state !== 'open' || !it.accept) continue;
    await accept(entryId, it.id);
    // A refused or failed prerequisite must leave dependent changes untouched.
    if (it.state !== 'accepted') break;
  }
}
export function remove(entryId) {
  const i = entries.findIndex(e => e.id === entryId && belongs(e));
  if(i>=0&&entries[i].items.some(it=>it.pending))return;
  if (i >= 0) { const e = entries[i]; e.abort.abort(); entries.splice(i, 1); unticked.delete(entryId); if (lastAccept?.entryId === entryId) lastAccept = null; if (belongs(e)) update(s=>{s.aiProposalLedger=(s.aiProposalLedger||[]).filter(x=>x.id!==entryId);return s;}); emit(); }
}

// ---- helpers every action uses ----------------------------------------------
/** The first JSON object or array in a reply, tolerating fences and prose. */
export function jsonOf(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(String(text));
  const body = fenced ? fenced[1] : String(text);
  // The whole body first (the usual reply), then each bracketed span that
  // balances, so a "[C1]" or "{braces}" in prose around the JSON is skipped.
  try { const whole = body.trim(); if (/^[[{]/.test(whole)) return JSON.parse(whole); } catch {}
  let firstError = null;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '{' && body[i] !== '[') continue;
    const end = balancedEnd(body, i);
    if (end < 0) continue;
    try { return JSON.parse(body.slice(i, end + 1)); } catch (e) { firstError ||= e; }
  }
  if (firstError) throw firstError;
  throw new Error('The model returned no JSON');
}
/** The index of the bracket closing the one at `start`, skipping brackets inside strings; -1 when it never closes. */
function balancedEnd(text, start) {
  const stack = [];
  let str = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
  }
  return -1;
}

/**
 * A quote is only shown if it is really in the source: whitespace and case
 * are forgiven, nothing else. A proposal resting on a quote the source does
 * not contain is dropped, because it cannot be checked (plan §5.1).
 */
export const quoteIn = (quote, source) => quoteFound(quote, source);

/** Plain text of a paper's PDF, page by page, for actions that read full text. */
export async function pdfPages(paperId, { maxPages = 40, signal } = {}) {
  const { getBytes } = await import('./files.mjs');
  const { loadPdf } = await import('./anchor.mjs');
  const bytes = await getBytes(paperId);
  if (!bytes) throw new Error('No PDF for this record');
  const { doc, hash } = await loadPdf(bytes);
  const pages = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push({ page: n, text: tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ') });
    }
  } finally { doc.destroy?.(); }
  return { pages, hash, total: doc.numPages };
}

// ---- context: what the person is looking at ---------------------------------
// Every action and the assistant get the same picture: the project in brief,
// the view, what in the view has focus (a record, a cell, a paragraph, a file,
// as the view reports it through an exported focus()), the document open
// beside it and the page shown, and any text selected. The shell assembles it
// (app.mjs: currentContext) at the moment an action is chosen, so an action
// run from a menu acts on what was in front of the person when they chose it.
//
// context = { view, viewTitle, focus?: { kind, paperId?, label?, text?, detail? },
//             document?: { paperId, label, page, pages }, selection? }


// ---- the ledger rows (CASE 3): one call per suggestion, built by the shared review item -----------------------------------------------
// uiReview owns the markup and ui-actions.css the placement: a kind line, a where / change line, Apply and Dismiss in one fixed
// end track, collapsed and expanded. This file decides only what each line says.

/** The longest accept label the fixed end track holds (uiReview refuses more). */
export const ACCEPT_LABEL_MAX = 12;
const SHORT_VERBS = ['Apply', 'Accept', 'Add', 'Replace', 'Use', 'Save', 'Show', 'Mark', 'Put', 'Place', 'Run', 'Set', 'Record'];
/**
 * An accept label the end track holds. Saved proposals persist the label they were made with, so a longer one ('Replace paragraph',
 * 'Save beside the file') is cut to its leading verb when that is a known one and to 'Apply' otherwise; the row's own kind and place
 * lines say what is applied.
 */
export function fitAcceptLabel(label) {
  const text = String(label ?? '').trim();
  if (!text) return 'Apply';
  if (text.length <= ACCEPT_LABEL_MAX) return text;
  const first = text.split(/\s+/)[0];
  return SHORT_VERBS.includes(first) ? first : 'Apply';
}

/** The first line of a detail, whitespace folded, cut at 160 characters. */
const oneLine = text => { const line = String(text ?? '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || ''; return line.length > 160 ? `${line.slice(0, 159)}…` : line; };
/** What the body adds to the second line: the lines after the first, or the whole of a single line too long for the row. */
const detailMore = text => { const t = String(text ?? '').trim(); return t.includes('\n') ? t.split('\n').slice(1).join('\n').trim() : t.length > 160 ? t : ''; };

// ---- what a suggestion says, read when it is drawn ---------------------------------------------------------------------
// A saved proposal keeps the label and detail it was made with; an older build wrote "Update task: …" and the raw patch. The row is
// described from the payload against the project as it is now (lib/proposal-handlers.mjs describers), so it reads in today's words
// and says when there is nothing left to do. Without a describer the saved strings are used, never a stored JSON patch.
const STORED_PREFIX = /^(?:Update task|To do|Remove task): /;
const isJsonObject = t => { const x = String(t ?? '').trim(); if (!/^[[{]/.test(x)) return false; try { const v = JSON.parse(x); return !!v && typeof v === 'object'; } catch { return false; } };
/**
 * { label, detail, acceptLabel, stale, live }: stale is why an open item has nothing left to do ('Already done', 'Task removed', …), else '';
 * live, that its accept checks the live state itself.
 */
export function describeItem(it, state = get()) {
  const d = it?.payload ? describeProposalPayload(it.payload, state) : null;
  return {
    label: d?.label || String(it?.label ?? '').replace(STORED_PREFIX, ''),
    detail: d && d.detail != null ? String(d.detail) : isJsonObject(it?.detail) ? '' : String(it?.detail ?? ''),
    acceptLabel: d?.acceptLabel || it?.acceptLabel || 'Apply',
    stale: it?.state === 'open' ? String(it.stale || d?.stale || '') : '',
    live: !!d?.live,
  };
}

/**
 * One suggestion as a ledger row. `open` is whether it is expanded (the caller keeps the set), `group` the label of the record group
 * the row sits under (a detail equal to it is not repeated). Block ids never reach the text: the helpers name places, and a saved
 * detail passes through visibleText.
 */
export function reviewRowHtml(it, state, { open = false, group = '' } = {}) {
  const said = describeItem(it, state);
  const typed = manuscriptProposalKind(it, state);
  const kind = typed || said.label || 'Suggestion';
  const where = manuscriptProposalLocation(it, state);
  const preview = manuscriptProposalPreview(it, state);
  const detail = said.detail && said.detail !== group ? visibleText(said.detail, state) : '';
  const summary = manuscriptChangeSummary(it, state) || (!typed && !preview && detail ? oneLine(detail) : '');
  const body = [preview,
    !typed && !preview && detailMore(detail) ? `<div class="aid-detail">${esc(detailMore(detail))}</div>` : '',
    it.quote ? `<div class="aid-quote">${esc(it.quote)}</div>` : '',
    it.where ? uiLink({ label: `${it.where.label || 'Source'}${it.where.locator?.page ? `, p. ${it.where.locator.page}` : ''}`, icon: 'file', title: 'Open the source', attrs: { 'data-where': true } }) : ''].filter(Boolean).join('');
  const canAct = it.state === 'open' && it.accept && !said.stale;
  return uiReview({ id: it.id, state: it.state, open, kind, where, summary, ...(!body && String(said.label || '').length >= 180 ? { attrs: { 'data-expandable': '' } } : {}), acceptLabel: canAct ? fitAcceptLabel(said.acceptLabel) : '', pending: !!it.pending, body,
    done: it.state === 'accepted' ? (it.result || 'Accepted') : said.stale ? said.stale : it.state === 'open' && it.result && !it.pending ? it.result : '' });
}

/**
 * The head of one proposal entry: its title, the pending count, Stop / Accept all (one slot, one at a time) and Remove (always last; off
 * while a run is going). `pending` is how many suggestions still wait (openItems): a fixed-width status. A checklist entry
 * (`checklist: { verb, ticked }`) says its verb once, in the primary, with the count of ticked rows ("Mark done 16"): a fixed-width label,
 * so a changing digit moves nothing. The view, model and age are the line under the head (entryStatusLine), never a message that is
 * the first thing to go when the pane is narrow.
 */
// The checklist primary's label slot: as wide as its widest count (every row ticked), measured in its font by the builder (uiBar labels).
const checkLabels = ({ verb, ticked, of = ticked }) => {
  const labels = [...new Set([`${verb} ${ticked}`, `${verb} ${Math.max(of, ticked)}`, `${verb} 0`])];
  return labels.length > 1 ? { labels } : { labelCh: CH_STEPS.find(c => c >= verb.length + 3) ?? 24 };
};
export function reviewEntryHead({ id, title, pending = 0, running = false, canAcceptAll = false, busy = false, checklist = null } = {}) {
  const swap = checklist
    ? [{ id: `all-${id}`, label: `${checklist.verb} ${checklist.ticked}`, role: 'primary', dynamic: true, ...checkLabels(checklist), disabled: busy || !checklist.ticked, attrs: { 'data-all': '', 'data-checklist': '' } }]
    : running || canAcceptAll
      ? [uiSwap({ id: `aid-run-${id}`, members: [{ id: `all-${id}`, label: 'Accept all', attrs: { 'data-all': '' }, disabled: busy, hidden: !canAcceptAll || running }, { id: `stop-${id}`, label: 'Stop', attrs: { 'data-stop': '' }, hidden: !running }] })] : [];
  // A checklist's primary already carries the count: a second number beside it would only crowd the title.
  return uiBar({ kind: 'head', density: 'dense', label: `Proposal: ${title}`, attrs: { 'data-e': id }, lead: { title }, ...(pending > 0 && !checklist ? { status: { id: `aid-pending-${id}`, text: `${pending} pending`, ch: 12 } } : {}),
    actions: [...swap, { id: `rm-${id}`, label: 'Remove', icon: 'close', role: 'quiet', keep: true, disabled: busy || running, attrs: { 'data-rm': '' } }] });
}

/** The title an entry is shown with: an older build called the suggested tasks of Plan the next steps "Next steps". */
export const entryTitle = e => (e?.action === 'plan-next' ? 'Suggested tasks' : e?.title || '');

const PAST = { 'Mark done': 'Marked done', 'Mark to do': 'Marked to do', Add: 'Added', Remove: 'Removed', Label: 'Labelled', Update: 'Updated', Record: 'Recorded', Apply: 'Applied', Accept: 'Accepted', Set: 'Set', Create: 'Created', Assign: 'Assigned' };
/** The past tense of an accept verb, for the line after an acceptance ("Marked done · 14 of 16"). */
export const pastOf = verb => PAST[verb] || (/^Mark /.test(verb) ? verb.replace(/^Mark /, 'Marked ') : 'Accepted');

/**
 * The line under an entry's head: the view, the model and the age; after a checklist acceptance, what it did ("Marked done · 14 of 16
 * · 2 skipped") with Undo while the acceptance can still be taken back, the meta line then the first part to give way.
 */
export function entryStatusLine({ id, meta = '', result = null } = {}) {
  const parts = [];
  if (result) parts.push({ id: `aid-did-${id}`, text: [`${pastOf(result.verb)}: ${result.done} of ${result.of}`, result.skipped ? `${result.skipped} skipped` : ''].filter(Boolean).join(', '), drop: 0 });
  if (meta) parts.push({ id: `aid-meta-${id}`, text: meta, drop: result ? 9 : 0 });
  if (!parts.length) return '';
  return `<div class="aid-entry-line">${uiStatusLine({ id: `aid-line-${id}`, label: 'Proposal status', parts, actions: result?.canUndo ? [{ id: `aid-undo-${id}`, label: 'Undo', attrs: { 'data-undo': '' } }] : [] })}</div>`;
}

// ---- a homogeneous proposal is a checklist --------------------------------------------------------------------------------
// Sixteen "Mark done" rows say the verb sixteen times. When every item of a finished proposal is the same op with the same verb, with
// nothing to preview, quote or open, the verb is said once in the head's primary and each row is a check and the item's own words;
// clearing a check leaves that row out (and, for suggested tasks, Remove then remembers it as dismissed).
const opOf = it => { const op = it?.op || it?.payload?.change?.op || it?.payload?.kind || ''; return op === 'add_todo' ? 'add_task' : op; };
export const CHECKLIST_MIN = 3;
export function isChecklist(entry, state = get()) {
  if (entry?.status !== 'done') return false;
  const items = (entry.items || []).filter(i => i.state !== 'discarded');
  if (items.length < CHECKLIST_MIN) return false;
  const op = opOf(items[0]);
  if (!op) return false;
  const verbs = new Set();
  for (const it of items) {
    if (opOf(it) !== op || it.preview || it.quote || it.where || it.manuscriptEdit) return false;
    const d = describeItem(it, state);
    if (d.detail.includes('\n')) return false;
    verbs.add(d.acceptLabel);
  }
  return verbs.size === 1;
}
/** Whether an entry holds suggested tasks (its Remove then remembers the cleared rows as dismissed). */
export const isTaskSuggestion = entry => (entry?.items || []).some(it => opOf(it) === 'add_task');

const unticked = new Map();   // entry id -> Set of item ids a person cleared; memory only, kept across redraws
export const isTicked = (entryId, itemId) => !unticked.get(entryId)?.has(itemId);
export function tick(entryId, itemId, on) {
  const set = unticked.get(entryId) || new Set();
  if (on) set.delete(itemId); else set.add(itemId);
  unticked.set(entryId, set);
}
/** The labels of an entry's open rows a person cleared (Remove writes them to the dismissed suggestions). */
export function untickedLabels(entryId, state = get()) {
  const e = allEntries().find(x => x.id === entryId);
  return (e?.items || []).filter(it => it.state === 'open' && !isTicked(entryId, it.id)).map(it => describeItem(it, state).label).filter(Boolean);
}

/**
 * Accepts the ticked, open, not stale rows of a checklist entry, in order. A refused row does not stop the others: it is marked stale
 * with its reason and counted as skipped. The undos the ops return are kept for this entry (memory only) until another acceptance,
 * a project switch, or a change to what the acceptance left (the op's key).
 */
export async function acceptTicked(entryId) {
  allEntries();
  const e = entries.find(x => x.id === entryId && belongs(x));
  if (!e) return null;
  const rows = e.items.filter(it => it.state === 'open' && it.accept && !it.pending && isTicked(entryId, it.id) && !describeItem(it, get()).stale);
  const verb = describeItem(rows[0] || e.items[0], get()).acceptLabel;
  const undos = []; let done = 0, skipped = 0, key = null;
  lastAccept = null; ticking = true;
  try { for (const it of rows) {
    if (!belongs(e) || e.abort.signal.aborted) break;
    await accept(entryId, it.id);
    const u = undoOf.get(it.id); undoOf.delete(it.id);
    if (it.state === 'accepted') { done++; if (u) { undos.push({ id: it.id, undo: u.undo }); key = u.key || key; } }
    else { skipped++; it.stale = it.result || 'Changed since'; }
  } } finally { ticking = false; }
  lastAccept = { entryId, undos, key, keyAt: key ? key() : null, generation: generation(), verb, done, of: rows.length, skipped };
  emit(e);
  return lastAccept;
}
/** What the last acceptance of this entry did and whether it can still be undone; null when it was not the last one accepted. */
export function acceptResult(entryId) {
  const a = lastAccept;
  if (!a || a.entryId !== entryId) return null;
  return { verb: a.verb, done: a.done, of: a.of, skipped: a.skipped, canUndo: a.undos.length > 0 && a.generation === generation() && (!a.key || a.key() === a.keyAt) };
}
/** Takes the last acceptance back (newest first) and reopens its rows. */
export function undoAccept(entryId) {
  if (!acceptResult(entryId)?.canUndo) return false;
  const a = lastAccept; lastAccept = null;
  for (const u of [...a.undos].reverse()) u.undo();
  const e = entries.find(x => x.id === entryId);
  for (const u of a.undos) { const it = e?.items.find(i => i.id === u.id); if (it) { it.state = 'open'; it.result = ''; } }
  emit(e);
  return true;
}

/**
 * A checklist entry: the sticky top (head and status line) and one check row per item. Rows keep their place after an acceptance:
 * an accepted row keeps its (checked, disabled) box and dims, a stale row has a blank box and its reason in the end column.
 */
export function checklistHtml(e, state = get(), { meta = '' } = {}) {
  const items = (e.items || []).filter(i => i.state !== 'discarded');
  const said = new Map(items.map(it => [it.id, describeItem(it, state)]));
  const can = it => it.state === 'open' && it.accept && !said.get(it.id).stale;
  const verb = said.get((items.find(can) || items[0]).id).acceptLabel;
  const busy = items.some(i => i.pending);
  const pending = items.filter(can).length, ticked = items.filter(it => can(it) && isTicked(e.id, it.id)).length;
  // A detail every row shares ("Mark as done") is the verb again: it is said once, in the head.
  const details = new Set(items.map(it => said.get(it.id).detail));
  const showDetail = details.size > 1;
  const rows = items.map(it => {
    const d = said.get(it.id), text = d.label || 'Suggestion';
    const st = it.state === 'accepted' ? 'accepted' : d.stale ? 'stale' : 'open';
    const check = st === 'open' && it.accept ? { checked: isTicked(e.id, it.id), label: `Include: ${text}`, attrs: { 'data-tick': it.id, ...(busy ? { disabled: true } : {}) } }
      : st === 'accepted' ? { checked: true, label: `${pastOf(verb)}: ${text}`, attrs: { disabled: true } }
        : { checked: false, label: text, attrs: { 'data-row-blank': true, disabled: true, 'aria-hidden': 'true', tabindex: '-1' } };
    const reason = st === 'stale' ? d.stale : st === 'open' && it.result && !it.pending ? it.result : '';
    return uiRow({ cls: 'aid-check-row', attrs: { 'data-i': it.id, 'data-state': st }, check,
      main: { html: `<span class="aid-check-text" title="${esc(text)}">${esc(text)}</span>`, detail: showDetail && d.detail ? [esc(oneLine(d.detail))] : [] },
      cells: reason ? [{ col: 'state', kind: 'text', html: esc(reason), ch: 14 }] : [] });
  });
  const head = reviewEntryHead({ id: e.id, title: entryTitle(e), pending, busy, checklist: { verb, ticked, of: pending } });
  return `<div class="aid-entry-top">${head}${entryStatusLine({ id: e.id, meta, result: acceptResult(e.id) })}</div>`
    + uiList({ label: entryTitle(e) || 'Suggestions', id: `aid-list-${e.id}`, attrs: { 'data-aid-checklist': '' }, rows });
}

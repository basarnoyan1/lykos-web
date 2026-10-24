// What an answer offers after it is written, loaded with the first conversation drawn (app.mjs `turnUi`): the review of the changes it
// proposed (lib/review-walk.mjs) and what to ask next (lib/chat-followups.mjs), and the shell's part of reviewing and of the writing handle.
export { turnChanges, openChanges, stillOpen, reviewLineHtml, startWalk, closeWalk, walking } from './review-walk.mjs';
export { followUps, followUpsHtml, touchedViews } from './chat-followups.mjs';
import { openChanges as allOpen, stillOpen as isOpen, startWalk as walk } from './review-walk.mjs';
import { uiNotice } from './ui-actions.mjs';

// ---- the shell's part, with what it lends (`sh`: the store, the pages, the ledger, the composer; app.mjs turnShell) ----

async function decideWrite(sh, b, how) {
  const { decideWrite: decide } = await import('./tracked-edit.mjs');
  sh.update(st => { if (st.manuscript?.blocks) st.manuscript.blocks = decide(st.manuscript.blocks, b.write, how); return st; });
  b.decided = how; sh.refreshCounts(); sh.repaint();
}
/** Opens a change where it is: a tracked write at its words, a proposal at its study (and page), else on its page. */
function showChange(sh, c) {
  if (c.kind === 'write') return sh.showWrite(c.block);
  if (c.where?.paperId && sh.get().papers.some(p => p.id === c.where.paperId)) return sh.keepChat(() => sh.openStudy(c.where.paperId, c.where.locator || null));
  return sh.keepChat(() => sh.go(c.view || 'overview'));
}
const keep = (sh, c) => c.kind === 'write' ? decideWrite(sh, c.block, 'accept') : sh.aid.aidNow().accept(c.entryId, c.itemId).then(sh.afterAccept);
const undo = (sh, c) => c.kind === 'write' ? decideWrite(sh, c.block, 'reject') : Promise.resolve(sh.aid.aidNow().discard(c.entryId, c.itemId));

/** Review: the strip over the page walks `changes`; Keep accepts, Undo rejects. */
export async function reviewChanges(changes, sh) {
  if (!changes?.length) return;
  if (changes.some(c => c.kind === 'item')) await sh.aid.ensureAid();
  sh.uncover?.();   // the changes are read on their pages: a chat laid over the page (a narrow window) steps aside
  walk(changes, { host: () => sh.host, show: c => showChange(sh, c), keep: c => keep(sh, c), undo: c => undo(sh, c), say: sh.say, done: sh.redraw,
    refresh: () => changes.filter(c => isOpen(c, sh.get(), sh.aid.aidReady() ? sh.aid.aidNow() : null)) });
}
/** Accept all: each change in order, as Proposals' Accept all does; a refusal stops the rest. */
export async function keepAll(changes, sh) {
  if (changes.some(c => c.kind === 'item')) await sh.aid.ensureAid();
  for (const c of changes) { try { await keep(sh, c); } catch (err) { sh.say(String(err?.message || err)); break; } }
  sh.redraw();
}
/** The writing handle's acts (lib/manuscript-handle.mjs): Revise and Tighten run the manuscript's own actions and are reviewed in place;
 *  Cite and Ask attach the selection and go to the chat. */
export async function handleAct(id, sh) {
  if (id === 'revise' || id === 'tighten') {
    const context = sh.context();
    const entry = await sh.withAid(() => sh.aid.aidNow().run('manuscript', id === 'revise' ? 'revise-paragraph' : 'tighten-selection', context));
    if (!entry) return;
    if (entry.status !== 'done') { sh.say(entry.error || 'Stopped'); return; }
    const changes = allOpen(sh.get(), sh.aid.aidNow()).filter(c => c.entryId === entry.id);
    if (changes.length) reviewChanges(changes, sh); else sh.say(entry.note || 'No change proposed');
    return;
  }
  const { askAboutSelection } = await import('./chat-attach-ui.mjs');
  if (!(await askAboutSelection('manuscript-selection'))) return;
  if (id === 'cite') sh.send('Cite the attached passage: find the Library records that support it and add their citations to its paragraph.');
  else sh.focus();
}

// ---- the conversation's extras, drawn by app.mjs drawAssist once this file is here ----
import { stepSummary } from './assistant-activity.mjs';
import { visibleActivity, elapsedLabel } from './assistant-status.mjs';
import { turnChanges as changesOf, turnDecided, reviewLineHtml } from './review-walk.mjs';
import { followUps as followRows, followUpsHtml as followHtml } from './chat-followups.mjs';

const kTok = n => n == null ? '' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const usageText = u => u ? [u.prompt != null ? `${kTok(u.prompt)} in` : '', u.completion != null ? `${kTok(u.completion)} out` : '', u.cost != null ? `$${u.cost.toFixed(4)}` : 'cost unknown'].filter(Boolean).join(', ') : '';
const ENDED = { interrupted: 'Interrupted', stopped: 'Stopped', error: 'Failed', incomplete: 'Incomplete', budget: 'Budget reached' };
/** The steps' row of an answer: what it did in words (Replit, Base44), how it ended; the count, the time and the tokens are its tooltip. */
export function trailOf(t, papers = []) {
  const n = visibleActivity(t.steps).length, said = n ? stepSummary(t.steps, papers) || `${n} ${n === 1 ? 'step' : 'steps'}` : '', head = ENDED[t.status] || '';
  // a question the person asked of the abstracts says so first (the composer's Reads, research tools review row 10)
  const scope = t.reads === 'abstracts' ? 'Asked of the abstracts' : '', low = x => x && x.charAt(0).toLowerCase() + x.slice(1);
  return { text: head || scope ? [head, scope && (head ? low(scope) : scope), head || scope ? low(said) : said].filter(Boolean).join(', ') : said || 'Answered',
    tip: [n ? `${n} ${n === 1 ? 'step' : 'steps'}` : '', t.durationMs != null ? elapsedLabel(t.durationMs) : '', usageText(t.usage)].filter(Boolean).join(', ') };
}
/** The review line under answer i, when it proposed changes that still wait. */
export const reviewLine = (t, i, state, ledger) => t.role === 'assistant' ? reviewLineHtml(changesOf(t, state, ledger), i, state, turnDecided(t, state)) : '';
/** The follow-ups under the last answer: none while a reply is being written or after one that did not finish. */
export function followUpsAfter(turns, { busy, question, state, views, iconOf }) {
  const i = turns.length - 1, t = turns[i];
  if (busy || t?.role !== 'assistant' || ENDED[t.status]) return '';
  return followHtml(followRows({ turn: t, question, state, views, iconOf }), i);
}
/** Review and Accept all under an answer, and a follow-up's press, which sends it. */
export function wireTurns(log, turns, sh, ledger) {
  log.querySelectorAll('[data-review-walk]').forEach(b => b.addEventListener('click', () => reviewChanges(changesOf(turns[+b.dataset.reviewWalk], sh.get(), ledger), sh)));
  log.querySelectorAll('[data-review-all]').forEach(b => b.addEventListener('click', () => keepAll(changesOf(turns[+b.dataset.reviewAll], sh.get(), ledger), sh)));
  log.querySelectorAll('.assist-followups [data-sugg]').forEach(b => b.addEventListener('click', () => sh.send(b.dataset.sugg)));
  // a change's row: its press walks the changes from it, shown in place; its marks accept or reject it alone
  const change = key => { const [i, k] = key.split(':').map(Number), list = changesOf(turns[i], sh.get(), ledger); return { list, k, c: list[k] }; };
  log.querySelectorAll('[data-review-seen]').forEach(b => b.addEventListener('click', () => { const [i, k] = b.dataset.reviewSeen.split(':').map(Number), c = turnDecided(turns[i], sh.get())[k]; if (c) sh.showWrite(c.block); }));
  log.querySelectorAll('[data-review-show]').forEach(b => b.addEventListener('click', () => { const { list, k } = change(b.dataset.reviewShow); reviewChanges([...list.slice(k), ...list.slice(0, k)], sh); }));
  for (const [attr, decide] of [['reviewKeep', keep], ['reviewUndo', undo]]) log.querySelectorAll(`[data-${attr === 'reviewKeep' ? 'review-keep' : 'review-undo'}]`).forEach(b => b.addEventListener('click', async () => {
    const { c } = change(b.dataset[attr]); if (!c) return;
    b.disabled = true;
    try { if (c.kind === 'item') await sh.aid.ensureAid(); await decide(sh, c); } catch (err) { sh.say(String(err?.message || err)); }
    sh.redraw();
  }));
}
/** The Proposals tab's head: every waiting proposal can be walked on its page, as an answer's are. */
export const walkHeadHtml = n => n ? `<div class="aid-walk">${uiNotice({ id: 'aid-walk', label: 'Waiting proposals', text: `${n} waiting`, actions: [{ id: 'aid-walk-go', label: 'Review in place', icon: 'proposals', attrs: { 'data-walk-all': '' } }] })}</div>` : '';

// ---- a question back to the person (ask_person, lib/chat-tools.mjs): the turn waits on askPerson's promise ----
// The card is the live area's 'choose' block (lib/chat-blocks.mjs): a choice pressed answers it, 1 to 5 in an empty composer pick one (Unify's
// keys), and the composer's words are Other.
let pending = null;
export function askPerson({ question, signal }, sh) {
  return new Promise(resolve => {
    const ask = { done: pick => { if (pending !== ask) return; pending = null; sh.placeholder(''); resolve(pick); } };
    pending?.done(null); pending = ask;
    signal?.addEventListener('abort', () => ask.done(null), { once: true });
    sh.placeholder('Other answer'); sh.notify(question);
  });
}
const openQuestion = run => run?.blocks?.find(b => b.type === 'choose' && !b.picked);
/** Whether the run in view waits on the person. */
export const askWaiting = run => !!pending && !!openQuestion(run);
export function answerAsk(pick) { if (pending && pick?.label) pending.done(pick); }
export const choiceByKey = (run, key) => openQuestion(run)?.choices[+key - 1]?.label || '';
/** The live card's presses. */
export function wireChoices(host, run, focus) {
  const q = openQuestion(run);
  host.querySelectorAll('[data-waiting] [data-choose-pick]').forEach(b => b.addEventListener('click', () => answerAsk({ label: q?.choices[+b.dataset.choosePick]?.label })));
  host.querySelector('[data-waiting] [data-choose-other]')?.addEventListener('click', focus);
}

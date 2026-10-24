// Review where the change is (Snowflake's "1 of 3" with Previous, Next, Undo and Keep; Mintlify's "1 file change" under the answer; owner via the
// Mobbin review, 2026-10-23). An answer that proposed changes ends with one line, "3 changes proposed", with Review and Accept all; Review walks
// the changes one at a time on their own pages: the page opens at the change (a manuscript paragraph's tracked words, a study's record or cell),
// and one strip over the page says which it is and offers Previous, Next, Undo and Keep. Keep is the acceptance (the ledger's accept or the
// tracked change's), Undo the rejection; nothing else here writes. The Proposals tab walks every open proposal the same way.
//
//   turnChanges(turn, state, aid)   the changes an answer made that still wait: its tracked writes and the open items of the proposals it filed
//   openChanges(state, aid)         every open proposal of the project (the Proposals tab's Review in place)
//   reviewLineHtml(changes, i)      the line under answer i
//   startWalk(changes, deps)        the strip, mounted over the page; deps say how to show, keep and undo a change
//
// Loaded with the first answer that proposed something (app.mjs `reviewWalk`).
import { uiBar, uiGroup, uiList, uiRow, uiRowEnd, uiNotice } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { writeOpen, writeParts } from './tracked-edit.mjs';

// the page a change of these ops is made on, where the ledger entry names the page it was filed from
const OP_PAGE = { add_task: 'tasks', update_task: 'tasks', remove_tasks: 'tasks', create_project_note: 'notes', edit_project_note: 'notes' };
const clip = (t, n = 80) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** The open items of ledger entries as changes. `aid` is lib/aid.mjs (or null before it has loaded: then there are none). */
function itemChanges(entries, state, aid) {
  if (!aid) return [];
  return aid.openItems(entries, state).map(({ entry, item }) => ({ id: item.id, kind: 'item', entryId: entry.id, itemId: item.id, view: OP_PAGE[item.op] || entry.view,
    label: clip(aid.describeItem(item, state).label || entry.title, 80), where: item.where || null, blockId: item.payload?.blockId || item.payload?.block || null }));
}

/** The changes an answer made that still wait, in the order it made them: its tracked writes, then its proposals' open items. */
export function turnChanges(turn, state, aid) {
  const blocks = state?.manuscript?.blocks || [];
  const writes = (turn?.blocks || []).filter(b => b.type === 'written' && b.write && writeOpen(blocks, b.write))
    .map(b => ({ id: `write-${b.write}`, kind: 'write', view: b.view || 'manuscript', label: clip(b.label || 'Edited paragraph', 80), block: b }));
  const ids = new Set(turn?.proposals || []);
  const entries = ids.size && aid ? aid.allEntries().filter(e => ids.has(e.id)) : [];
  return [...writes, ...itemChanges(entries, state, aid)];
}
/** The answer's writes already decided (in its rows, or in the manuscript): listed with how they ended, no longer counted. */
export function turnDecided(turn, state) {
  const blocks = state?.manuscript?.blocks || [];
  return (turn?.blocks || []).filter(b => b.type === 'written' && b.write && !writeOpen(blocks, b.write))
    .map(b => ({ id: `write-${b.write}`, kind: 'write', view: b.view || 'manuscript', label: clip(b.label || 'Edited paragraph', 80), block: b, decided: b.decided || '' }));
}
/** What a write took out and put in, read from the page as it is now: its struck and inserted words, the words around them kept short. */
export function writeDiffHtml(c, state) {
  const at = (state?.manuscript?.blocks || []).find(x => x.id === c.block.block);
  const parts = at ? writeParts(at, c.block.write) : [], n = parts.length;
  const near = (t, k) => t.length <= 60 ? t : k === 0 ? `…${t.slice(-30)}` : k === n - 1 ? `${t.slice(0, 30)}…` : `${t.slice(0, 24)}…${t.slice(-24)}`;
  return parts.length ? `<span class="chat-written">${parts.map((x, k) => x.del ? `<del>${esc(x.del)}</del>` : x.ins ? `<ins>${esc(x.ins)}</ins>` : esc(near(x.same, k))).join('')}</span>` : '';
}

/** Whether a change still waits (decided elsewhere meanwhile, it leaves the walk). */
export function stillOpen(c, state, aid) {
  if (c.kind === 'write') return writeOpen(state?.manuscript?.blocks, c.block.write);
  const it = aid?.allEntries().find(e => e.id === c.entryId)?.items.find(i => i.id === c.itemId);
  return !!it && it.state === 'open';
}

/** Every open proposal of the project, newest entry first (the Proposals tab's order). */
export const openChanges = (state, aid) => itemChanges(aid ? aid.allEntries() : [], state, aid);

const said = n => `${n} ${n === 1 ? 'change' : 'changes'} proposed`;
const PAGE = { search: 'Literature', outputs: 'Tables and figures', submissions: 'Submission' };
const pageName = v => PAGE[v] || String(v || 'page').replace(/^./, c => c.toUpperCase());
/** Where a change is, in a few words: the manuscript's section a write sits under, else the page and the study. */
export function whereOf(c, state) {
  if (c.kind === 'write') {
    const bs = state?.manuscript?.blocks || [], i = bs.findIndex(b => b.id === c.block.block);
    const head = i >= 0 ? bs.slice(0, i + 1).reverse().find(b => /^h[1-3]$/.test(b.type) && b.id !== c.block.block)?.text : '';
    return head ? `Manuscript, ${clip(head, 40)}` : 'Manuscript';
  }
  return [pageName(c.view), c.where?.label].filter(Boolean).join(', ');
}
// a change's Accept and Reject: the row end's inline icon action (uiRowEnd), twice. A row end holds one inline action and a More; a change has
// two decisions and nothing else, so the second inline action, built by the same builder, takes the More's place.
const inlineAct = (id, label, ico, attrs) => uiRowEnd({ inline: { id, label, icon: ico, attrs }, more: { label } });
const firstButton = html => html.match(/<button(?![^>]*ui-row-more)[\s\S]*?<\/button>/)?.[0] || '';
const decideEnd = (i, k, label) => inlineAct(`assist-change-keep-${i}-${k}`, `Accept: ${label}`, 'check', { 'data-review-keep': `${i}:${k}` })
  .replace(/<button[^>]*ui-row-more[\s\S]*?<\/button>/, firstButton(inlineAct(`assist-change-undo-${i}-${k}`, `Reject: ${label}`, 'close', { 'data-review-undo': `${i}:${k}` })));
/**
 * The line under an answer that proposed changes, or '' when none waits: "2 changes proposed" with Review and Accept all (one quiet bar on the
 * answer's edge), then each change as a row, what and where, whose press shows it in place, Accept and Reject as icons at its end.
 */
export function reviewLineHtml(changes, i, state = null, decided = []) {
  const n = changes.length; if (!n && !decided.length) return '';
  // the ledger's summary line (uiNotice): its words at 400, its acts quiet and plain, no box
  const bar = n ? uiNotice({ id: `assist-review-${i}`, label: 'Proposed changes', text: said(n),
    actions: [{ id: `assist-review-go-${i}`, label: 'Review', icon: 'proposals', role: 'quiet', plain: true, attrs: { 'data-review-walk': i } },
      ...(n > 1 ? [{ id: `assist-review-all-${i}`, label: 'Accept all', icon: 'check', role: 'quiet', plain: true, attrs: { 'data-review-all': i } }] : [])] }) : '';
  const main = (c, attr) => `<button type="button" class="assist-change-show" ${attr} title="Show it in place"><span class="assist-change-what">${esc(c.label)}</span><span class="assist-change-where">${esc(whereOf(c, state))}</span></button>`;
  // a write's second line is what it took out and put in; a decided one says how it ended
  const rows = [...changes.map((c, k) => uiRow({ cls: 'assist-change', main: { html: main(c, `data-review-show="${i}:${k}"`), detail: c.kind === 'write' ? [writeDiffHtml(c, state)] : [] },
    end: decideEnd(i, k, c.label) })),
    ...decided.map((c, k) => uiRow({ cls: 'assist-change', attrs: { 'data-decided': c.decided || 'page' }, main: { html: main(c, `data-review-seen="${i}:${k}"`), detail: [c.decided === 'accept' ? 'Accepted' : c.decided === 'reject' ? 'Rejected' : 'Decided in the manuscript'] },
      end: uiRowEnd({ reserve: true }) }))];
  return `<div class="assist-review" data-review-turn="${i}">${bar}${uiList({ label: n ? 'Proposed changes' : 'Decided changes', cls: 'assist-change-list', plain: true, rows })}</div>`;
}

/** The strip's markup for change `at` of `n`. */
export function stripHtml(change, at, n) {
  return uiBar({ kind: 'head', density: 'dense', label: 'Review changes', id: 'review-walk-bar',
    lead: { title: change?.label || 'Change' },
    status: { id: 'review-walk-at', text: `${at + 1} of ${n}`, ch: 8 },
    actions: [
      uiGroup({ id: 'review-walk-steps', label: 'Changes', items: [{ id: 'review-walk-prev', label: 'Previous change', icon: 'arrow-up', disabled: n < 2 }, { id: 'review-walk-next', label: 'Next change', icon: 'arrow-down', disabled: n < 2 }] }),
      { id: 'review-walk-undo', label: 'Undo', icon: 'undo', role: 'quiet', keep: true },
      { id: 'review-walk-keep', label: 'Keep', icon: 'check', role: 'primary' },
    ],
    overflow: [{ id: 'review-walk-close', label: 'Stop reviewing' }] });
}

let walk = null;   // { list, at, deps, host }
export const walking = () => !!walk;
export function closeWalk() {
  if (!walk) return;
  const { host, deps } = walk; walk = null;
  host.remove(); deps.done?.();
}

/**
 * Walks `changes` from the first. `deps`: { host(): the element the strip is put in, show(change), keep(change), undo(change): promises;
 * refresh(): the changes still open (re-read after each decision); say(text); done() }.
 */
export function startWalk(changes, deps) {
  closeWalk();
  const list = changes.slice(); if (!list.length) return false;
  const doc = globalThis.document, host = doc.createElement('div');
  host.className = 'review-walk'; host.id = 'review-walk'; host.setAttribute('role', 'region'); host.setAttribute('aria-label', 'Review changes');
  deps.host().append(host);
  // the strip sits at the foot of the page, wherever the page is: CSS anchors it to the page's region (research-views.css, .review-walk)
  walk = { list, at: 0, deps, host };
  host.addEventListener('click', e => {
    const b = e.target.closest?.('button[id]'); if (!b || b.disabled || !walk) return;
    if (b.id === 'review-walk-prev') step(-1);
    else if (b.id === 'review-walk-next') step(1);
    else if (b.id === 'review-walk-keep') decide('keep');
    else if (b.id === 'review-walk-undo') decide('undo');
    else if (b.id === 'review-walk-close') closeWalk();
  });
  host.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeWalk(); } });
  draw(); deps.show(list[0]);
  return true;
}
function draw() {
  if (!walk) return;
  const { list, at, host } = walk;
  host.innerHTML = stripHtml(list[at], at, list.length);
}
function step(by) {
  if (!walk || walk.list.length < 2) return;
  walk.at = (walk.at + by + walk.list.length) % walk.list.length;
  draw(); walk.deps.show(walk.list[walk.at]);
}
async function decide(how) {
  if (!walk) return;
  const w = walk, change = w.list[w.at];
  w.host.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await (how === 'keep' ? w.deps.keep(change) : w.deps.undo(change)); } catch (err) { w.deps.say?.(String(err?.message || err)); }
  if (walk !== w) return;
  // what is still open now: a change decided elsewhere meanwhile leaves the walk too
  const open = new Set((w.deps.refresh?.() || []).map(c => c.id));
  const next = w.list.slice(w.at + 1).concat(w.list.slice(0, w.at)).filter(c => c.id !== change.id && (!w.deps.refresh || open.has(c.id)));
  if (!next.length) { closeWalk(); return; }
  w.list = next; w.at = 0;
  draw(); w.deps.show(w.list[0]);
}

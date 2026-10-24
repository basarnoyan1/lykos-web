// The paper run's card, over the chat's composer (lib/paper-run.mjs holds the run): where the run stands, what the project now holds for
// the stage just done, and the person's choices. While a stage's turn runs the card steps aside: the chat shows the work.
import { get, update } from '../store.mjs';
import { uiBar } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { openCount } from './aid.mjs';
import { starterDocument } from './manuscript.mjs';
import { researchType, projectName } from './workflow.mjs';
import { position, stageNeed, stageFacts, stageBrief, stageMessage, stageTitle, stagePage, startStage, stageEnded, skipStage, endRun } from './paper-run.mjs';

const store = run => update(s => { s.paperRun = run; return s; });
const quote = t => `“${t.length > 90 ? `${t.slice(0, 89)}…` : t}”`;

/**
 * Draws the card into the chat's foot (`ctx.host`), or takes it away when there is no live run. `ctx`: { host, busy(), start(message,
 * brief, page) } from the shell, which sends a stage's turn as the composer sends the person's.
 */
export function drawCard(ctx) {
  const run = get().paperRun, pos = position(run);
  let card = ctx.host.querySelector('#pr-card');
  if (!pos || ctx.busy()) { card?.remove(); return; }
  if (!card) { card = Object.assign(document.createElement('section'), { id: 'pr-card', className: 'pr-card' }); card.setAttribute('aria-label', 'Paper run'); ctx.host.prepend(card); }
  const { now, next } = pos, waiting = now?.status === 'waiting', need = next ? stageNeed(get(), next.id) : '';
  // the head names the stage just done (or, before the first, the question); under it what the stage left, then what comes next or
  // what it needs first
  const line = waiting ? `${stageTitle(now.id)} done` : `A ${run.kind} from ${quote(run.question)}`;
  const open = waiting ? openCount() : 0;
  const facts = waiting ? `${stageFacts(get(), now.id)}${open ? `; ${open} waiting in Proposals` : ''}` : '';
  const then = need || (next ? `${waiting ? 'Next' : 'First'}: ${stageTitle(next.id)}` : 'That was the last stage');
  const shown = waiting ? now : next, step = shown ? `${pos.number(shown)} of ${pos.of}` : '';
  const actions = [
    ...(next ? [{ id: 'pr-go', label: waiting ? 'Continue' : 'Start', icon: 'run', role: 'primary', disabled: !!need }] : [{ id: 'pr-finish', label: 'Finish', icon: 'check', role: 'primary' }]),
    ...(waiting ? [{ id: 'pr-again', label: 'Do again', icon: 'undo', role: 'secondary' }] : [])];
  const more = [...(next ? [{ id: 'pr-skip', label: `Skip ${stageTitle(next.id).toLowerCase()}` }] : []), { id: 'pr-stop', label: 'Stop the run' }];
  card.innerHTML = `${uiBar({ kind: 'head', label: 'Paper run', id: 'pr-head', density: 'dense', lead: { text: line, level: 'p' }, ...(step ? { status: { id: 'pr-step', text: step, ch: 8 } } : {}) })}
    ${facts ? `<p class="meta pr-facts">${esc(facts)}</p>` : ''}<p class="meta pr-facts"${need ? ' data-need' : ''}>${esc(then)}</p>
    ${uiBar({ kind: 'foot', label: 'Paper run choices', id: 'pr-foot', density: 'dense', actions, overflow: more })}`;
  card.onclick = e => {
    const b = e.target.closest?.('[id^="pr-"]:is(button,[role=menuitem])'); if (!b || b.disabled) return;
    const r = get().paperRun, p = position(r); if (!p) return;
    if (b.id === 'pr-go' && p.next && !stageNeed(get(), p.next.id)) return begin(ctx, startStage(r, p.next.id), p.next.id);
    if (b.id === 'pr-again' && p.now) return begin(ctx, startStage(r, p.now.id), p.now.id);
    if (b.id === 'pr-skip' && p.next) { store(skipStage(r, p.next.id)); return drawCard(ctx); }
    if (b.id === 'pr-stop' || b.id === 'pr-finish') { store(endRun(r)); return drawCard(ctx); }
  };
}

function begin(ctx, run, id) {
  store(run);
  // the manuscript stage writes into the sections of the paper's type: a project without a manuscript gets the starter document, as the
  // Manuscript page's own Start a manuscript gives it
  if (id === 'manuscript' && !(get().manuscript?.blocks || []).length)
    update(s => { s.manuscript = { ...(s.manuscript || {}), blocks: starterDocument(researchType(s).id, projectName(s)), snapshot: s.manuscript?.snapshot || {} }; return s; });
  ctx.start(stageMessage(run, id), stageBrief(get(), run, id), stagePage(id));
}

/** A stage's turn ended (answered, stopped or failed): the stage waits for the person, with the answer's opening as its note. */
export function turnEnded(ctx, answer) {
  const run = get().paperRun;
  if (run?.stages?.some(x => x.status === 'running')) store(stageEnded(run, answer));
  drawCard(ctx);
}

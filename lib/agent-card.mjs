// The card that says another program is working in the project folder (lib/agent-activity.mjs reads .lykos/activity.json and
// .lykos/activity/*.json). One head line: who (Claude's own mark for Claude, a neutral program glyph for any other), the name, and the state
// with its time ("Working, 16 min", "Finished 14:02, 22 min", "Waiting for you", "Stopped 14:05"); then what it does, the step only when the
// file names steps ("Step 2 of 4: Drawing Figure 2"), a determinate bar only when how far is known (no bar at all when it is not), and the
// facts only when they say something ("64 of 208 records, about 4 min left"). The card does not open on its own: the status bar's item
// (agentStatusItem) says who is at work and opens it (2 Nov 2026, owner: "this thing opens again and again ... move it to the bottom bar").
// An ended run's card says what was done and which files changed and offers Open changes. The card is not a live region: a separate status
// line announces the start and the end, never each step. Show work, or a press anywhere else on the card, opens Agent work
// (views/agents.mjs) at the agent pressed; a sub-agent or a script whose lead is on the card is named under the lead ("With lykos-apply").
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { readerOf, readerPath } from './agent-icons.mjs';
import { isClaude, agentKind, isReview, activityHeadline, endedWhat, endedHeadline, progressOf, elapsedText, changedText } from './agent-activity.mjs';
import { runTiming, unitsText, leftText, finishText, overText } from './agent-progress.mjs';
import { lib_dates$clock as clockOf } from "../boot.mjs";

export const FADE_AFTER = 8000;
const FADE_MS = 400;
// Claude's mark, the official spark (the path of the Claude app's own mark, 248 units square), in its orange (--claude)
const CLAUDE_RAYS = 'M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z';
/**
 * Who is working, as a 16 px mark: Claude's starburst for Claude; for Codex the app's code glyph, for the app's own model connections
 * (DeepSeek, ChatGPT, a team: "Lykos models") its models glyph, and the program glyph (cpu) for anyone else, so the agents of one card can
 * be told apart at a glance. Codex, ChatGPT and DeepSeek are drawn by their own marks (lib/agent-icons.mjs).
 */
const MARK_ICON = { models: 'models', other: 'cpu' };   // Codex: the terminal glyph (it works in one), not the qualitative coding tag
export function agentMark(by, tool = '') {
  if (typeof tool === 'string' && tool) return `<span class="agent-mark agent-mark-other agent-mark-script" aria-hidden="true">${icon('cpu', { size: 16 })}</span>`;   // a script (lykos-apply) run for an agent: a program's glyph
  const kind = agentKind(by), own = kind === 'claude' ? '' : readerPath(readerOf(by));
  if (own) return `<svg class="agent-mark agent-mark-other" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="${own}"/></svg>`;
  return kind === 'claude'
    ? `<svg class="agent-mark agent-mark-claude" viewBox="0 0 248 248" width="16" height="16" aria-hidden="true" focusable="false"><path d="${CLAUDE_RAYS}"/></svg>`
    : `<span class="agent-mark agent-mark-other agent-mark-${kind}" aria-hidden="true">${kind === 'codex' ? icon('terminal', { size: 16 }) : icon(MARK_ICON[kind], { size: 16 })}</span>`;
}

// who: the mark in the card's first column, the name as the head's title, the card's commands at its end
// the head never stacks: a name, one action and the close fit on one line, and a stacked head put each on a line of its own beside the mark (2026-10-26)
// the state and its time stand in the head's status slot, a fixed width beside the name, so nothing moves as the minutes change
// a long name gives up its model in brackets ("Deepseek (deepseek-flash)" is Deepseek here, whole on Agent work), so the state keeps its place
const shortName = by => (by.length > 14 ? by.replace(/\s*\([^)]*\)\s*$/, '') || by : by);
const head = (by, actions, tool = '', state = '') => agentMark(by, tool) + uiBar({ kind: 'head', id: 'agent-card-head', label: `${by}'s work in the project`, lead: { title: shortName(by), level: 'h2' },
  ...(state ? { status: { id: 'agent-card-state', text: state, ch: 20 } } : {}), actions, stack: false })
  .replace('id="agent-card-state" role="status"', 'id="agent-card-state"');   // not a live region: the start and the end are said once, by the card's own status line
const dismiss = { id: 'agent-card-dismiss', label: 'Dismiss', icon: 'close', role: 'quiet', iconOnly: true, plain: true };
// the spectator page (views/agents.mjs): each agent's step, its log and what is ahead; pressing the card anywhere else opens it too
// an icon, so the head holds the name and the state beside it: Agent work's own glyph, the page it opens
const watch = { id: 'agent-card-watch', label: 'Show work', icon: 'activity', role: 'quiet', iconOnly: true, plain: true };
/** The agents a card shows: a sub-agent or a script whose lead is shown too is counted under its lead, not given a block of its own. */
export function leadsOf(all = []) {
  const ids = new Set(all.map(a => a.id).filter(Boolean));
  return all.filter(a => !(a.parent && a.parent !== a.id && ids.has(a.parent)));
}
const helpersOf = (a, all) => all.filter(b => b !== a && b.parent && b.parent === a.id);
// a lead whose own step counts nothing, with a helper at work that does (a script it ran): the helper's units and time stand for the lead's
function withHelper(a, all) {
  const own = runTiming(a);
  if (own.units || a.need) return a;
  const h = helpersOf(a, all).find(b => runTiming(b).units);
  if (!h) return a;
  const name = runningStep(a), hs = (h.steps || []).find(s => s.state === 'running');
  if (!name || !hs) return { ...a, unit: h.unit, item: h.item, samples: h.samples, done: h.done, total: h.total, need: h.need };
  return { ...a, steps: a.steps.map(s => (s.state === 'running' ? { ...s, ...hs, name: s.name, started: s.started } : s)), need: a.need || h.need };
}
const helpersText = hs => (hs.length ? `With ${hs.length === 1 ? hs[0].tool || hs[0].by : `${hs.length} helpers`}` : '');
// a determinate bar, only when how far is known: drawn from the left to the share (the fill is a transform of --agent-share, set by the caller)
const track = (label, share, text = '') => (share == null ? ''
  : `<div class="agent-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(share * 100)}"${text ? ` aria-valuetext="${esc(text)}"` : ''}><span class="agent-fill"></span></div>`);
// a line of the card that may be cut (the whole in the tooltip)
const line = (text, cls, tip = '') => (text ? `<p class="${cls}" title="${esc(tip || text)}">${esc(text)}</p>` : '');
const sinceText = (a, to) => { const t = Date.parse(a.since); return Number.isFinite(t) ? elapsedText(to - t) : ''; };
const low = t => (t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : '');
const cap = t => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : '');

// How far and how long, in the card's words (2 Nov 2026, owner: "Working" said twice, a bar with no known progress, a grid of empty facts):
// the state and its time at the end of the head ("Working, 16 min"), what it does, the step only when steps are known ("Step 2 of 4: Drawing
// Figure 2"), a bar only when how far is known, and the facts only when they say something ("64 of 208 records, about 4 min left").
const runningStep = a => (a.steps || []).find(s => s.state === 'running')?.name || '';
const stateOf = (a, ended) => (a.state && a.state !== 'running' ? a.state
  : ended ? (a.failed ? 'stopped' : 'ended') : a.need?.kind === 'you' ? 'waiting' : a.need?.kind === 'blocked' ? 'blocked' : 'running');
/**
 * One agent in words, for the card, the Agent work page and the status bar: { state, stateText, what, step, share, facts, finish, open }.
 * `a` is a running activity (lib/agent-activity.mjs activityOf), an ended one (endedOf, with `ended: true`) or a page's agent (agentOf, its own state).
 * state: running, waiting, blocked, ended, stopped or quiet; share: 0..1 when how far is known, else null (no bar is drawn).
 */
export function agentSummary(a, { now = Date.now(), ended = false } = {}) {
  const state = stateOf(a, ended), open = state === 'running' || state === 'waiting' || state === 'blocked' || state === 'quiet';
  const endAt = Date.parse(a.ended || ''), took = Number.isFinite(endAt) ? sinceText(a, endAt) : '';
  const stateText = state === 'running' ? `Working, ${low(sinceText(a, now)) || 'just started'}`
    : state === 'waiting' ? 'Waiting for you'
    : state === 'blocked' ? 'Blocked'
    : state === 'quiet' ? `No word since ${clockOf(a.updated)}`
    : state === 'stopped' ? `Stopped ${clockOf(a.ended)}`
    : `Finished ${clockOf(a.ended)}`;
  const what = state === 'ended' ? endedWhat(a) : activityHeadline(a);
  if (!open) {
    const steps = Array.isArray(a.steps) ? a.steps : [], total = steps.length || a.total || 0;
    const doneN = steps.length ? steps.filter(s => s.state === 'done').length : a.done || 0;
    const facts = state === 'stopped' ? (total ? `${doneN} of ${total} steps done` : '') : [took ? `Took ${low(took)}` : '', low(changedText(a.changed || []))].filter(Boolean).join(', ');
    return { state, stateText, what, step: '', share: null, facts, took: took ? `Took ${low(took)}` : '', finish: '', open };
  }
  const tm = runTiming(a, now), p = progressOf(a), name = runningStep(a), n = (a.steps || []).length;
  // the step, when the card names steps: its place and its name once (1 Nov 2026: "Checking the value proofs: Checking the value proo…")
  const doing = a.current || a.action || '';
  const said = doing && doing !== name && !doing.startsWith(`${name}:`) && doing !== a.what ? doing : '';
  const step = n && name ? `Step ${Math.min(tm.stepAt || 1, n)} of ${n}: ${name}${said ? `, ${low(said)}` : ''}` : said;
  let share = tm.share ?? p.share ?? null;
  if (state === 'quiet') share = null;
  const facts = [];
  if (state === 'blocked') facts.push(a.need?.text || '');
  else if (state === 'running') {
    if (tm.units) facts.push(unitsText(tm.units));
    else if (!n && p.total) facts.push(`${p.done} of ${p.total} done`);
    if (tm.step?.over) facts.push(overText(tm.step.over, tm.step.declared));
    else if (tm.left) facts.push(leftText(tm));
  }
  const text = facts.filter(Boolean).map((x, i) => (i ? low(x) : cap(x))).join(', ');
  return { state, stateText, what, step, share, facts: text, finish: state === 'running' && tm.finishAt ? finishText(tm.finishAt) : '', open };
}
/** { step, count, time, elapsed, share }: the older shape some callers read (the step with its units, "2 of 3", the time left). */
export function cardProgress(a, now = Date.now()) {
  const tm = runTiming(a, now), p = progressOf(a), name = runningStep(a), units = tm.units ? unitsText(tm.units) : '';
  const step = units ? (name && !units.startsWith(name) ? `${name}: ${units}` : units) : a.current && a.current !== name && !a.current.startsWith(`${name}:`) && name ? `${name}: ${a.current}` : a.current || name || '';
  const time = [leftText(tm) === 'Estimating…' ? '' : leftText(tm), tm.finishAt ? low(finishText(tm.finishAt)) : ''].filter(Boolean).join(', ');
  return { share: tm.share ?? p.share, step, count: p.label && a.steps?.length && !units ? `Step ${p.label}` : p.label, time, elapsed: sinceText(a, now), known: tm.share != null };
}
/** "Needs you: Decide the 3 companion reports (Screening)", when any agent at work waits for the person; '' when none does. */
export function needsYouText(all = []) {
  const w = all.filter(a => a?.need?.kind === 'you');
  if (!w.length) return '';
  if (w.length > 1) return `${w.length} agents are waiting for you`;
  return `${w[0].need.text}${w[0].need.where ? ` (${w[0].need.where})` : ''}`;
}
const needLine = all => { const t = needsYouText(all); return t ? `<p class="agent-need" title="${esc(t)}"><span class="agent-need-lead">Needs you</span> <span class="agent-need-text">${esc(t)}</span></p>` : ''; };
// what one agent does, under its head: the activity (two lines at most), the step, the bar, the facts
const bodyOf = (c, label) => `<p class="agent-what" title="${esc(c.what)}">${esc(c.what)}</p>${line(c.step, 'agent-step')}${track(label, c.share, c.facts || c.step)}${line(c.facts, 'agent-facts', [c.facts, low(c.finish)].filter(Boolean).join(', '))}`;

/**
 * The card's inside for a running activity ({ state: 'running', a }) or an ended one ({ state: 'ended', e }); `now` dates the clock.
 * Answers { html, share } (share: the bar's fill 0..1, null when how far is not known: no bar), so the caller sets the fill without a style attribute.
 */
export function agentCardBody(view, now = Date.now()) {
  const all = view.all?.length ? view.all : view.a ? [view.a] : [], leads = view.state === 'running' ? leadsOf(all) : [];
  // several at once (Claude, Codex and the app's models reviewing side by side): one block each, the card's head saying how many
  if (view.state === 'running' && leads.length > 1) {
    const items = leads.map((a, i) => {
      const c = agentSummary(withHelper(a, all), { now }), hs = helpersOf(a, all);
      return { share: c.share, html: `<div class="agent-item" data-i="${i}" data-key="${esc(a.file || '')}" data-state="${c.state}" data-progress="${c.share == null ? 'unknown' : 'known'}">`
        + `${agentMark(a.by, a.tool)}<p class="agent-who"><span class="agent-who-name">${esc(a.by)}</span><span class="agent-state" id="agent-card-state-${i}">${esc(c.stateText)}</span></p>`
        + `${bodyOf(c, c.what)}${line(helpersText(hs), 'agent-note')}</div>` };
    });
    const n = leads.length, editing = all.some(a => !isReview(a) && a.need?.kind !== 'you');
    return { share: null, shares: items.map(x => x.share), html: uiBar({ kind: 'head', id: 'agent-card-head', label: 'Work in the project', lead: { title: `${n} at work`, level: 'h2' }, actions: [watch, dismiss], stack: false })
      + items.map(x => x.html).join('') + (editing ? line('Your edits are held until it finishes', 'agent-note') : '') + needLine(all) };
  }
  if (view.state === 'running') {
    const a = leads[0] || view.a, c = agentSummary(withHelper(a, all), { now }), editing = all.some(x => !isReview(x) && x.need?.kind !== 'you');
    return { share: c.share, state: c.state, html: head(a.by, [watch, dismiss], a.tool, c.stateText)
      + bodyOf(c, c.what) + line(helpersText(helpersOf(a, all)), 'agent-note')
      + (editing ? line('Your edits are held until it finishes', 'agent-note') : '') + needLine(all) };
  }
  const e = view.e, c = agentSummary(e, { now, ended: true }), names = (e.changed || []).map(p => p.split('/').pop());
  // what an ended run did (or that it stopped) and the files it changed, by name; no bar: its end says how far it got
  const what = c.state === 'stopped' ? activityHeadline(e) : c.what;
  const facts = c.state === 'stopped' ? c.facts : names.length ? `${c.facts}: ${names.join(', ')}` : '';
  return { share: null, state: c.state, html: head(e.by, [...(names.length ? [{ id: 'agent-card-changes', label: 'Open changes', icon: 'changes', role: 'quiet', iconOnly: true, plain: true }] : []), dismiss], e.tool, c.stateText)
    + `<p class="agent-what" title="${esc(what)}">${esc(what)}</p>${line(facts, 'agent-facts')}` };
}

/**
 * The status bar's item for the agents at work (2 Nov 2026, owner: the card opened again and again; it lives in the bottom bar now and opens
 * when pressed): one agent's mark, what it does and its time ("Reading searches", "17 min"), a small bar only when how far is known;
 * several are "2 agents working"; one that waits for the person or is blocked says so in the heavier weight. Answers { html, label, attention }
 * or null when nothing runs or has just ended.
 */
export function agentStatusItem(all = [], ended = null, now = Date.now()) {
  const leads = leadsOf(all);
  if (leads.length > 1) {
    const w = leads.filter(a => a.need?.kind === 'you').length, b = leads.filter(a => a.need?.kind === 'blocked').length;
    const text = w ? `${leads.length} agents, ${w} waiting for you` : b ? `${leads.length} agents, ${b} blocked` : `${leads.length} agents working`;
    return { attention: !!(w || b), label: `${leads.map(a => a.by).join(', ')}: ${text}`, html: `<span class="agent-st">${w || b ? '' : '<span class="ui-progress-ring" aria-hidden="true"></span>'}<span class="agent-st-text">${esc(text)}</span></span>` };
  }
  const a = leads[0];
  if (!a && !ended) return null;
  const c = a ? agentSummary(withHelper(a, all), { now }) : agentSummary(ended, { now, ended: true });
  const who = a || ended, attention = c.state === 'waiting' || c.state === 'blocked';
  const text = attention ? c.stateText : c.state === 'running' ? c.what : c.stateText;
  const time = c.state === 'running' ? sinceText(who, now) : '';
  const bit = c.state === 'running' && c.share != null ? `<span class="agent-st-track" aria-hidden="true"><span class="agent-fill"></span></span>` : c.state === 'running' ? '<span class="ui-progress-ring" aria-hidden="true"></span>' : '';
  return { attention, share: c.state === 'running' ? c.share : null, label: `${who.by}: ${[c.what, c.stateText].filter(Boolean).join(', ')}`,
    html: `<span class="agent-st">${agentMark(who.by, who.tool)}<span class="agent-st-text">${esc(text)}</span>${bit}${time ? `<span class="agent-st-time">${esc(time)}</span>` : ''}</span>` };
}

/** What the status line says when an activity starts and when it ends. */
export const startedSay = a => (isReview(a)
  ? `${a.by} is reviewing the project: ${activityHeadline(a)}. You can keep editing.`
  : `${a.by} is editing the project: ${activityHeadline(a)}. Your edits are held until it finishes.`);
export const endedSay = e => `${endedHeadline(e)}.${e.changed.length ? ` ${changedText(e.changed)}.` : ''}`;

// Makes `a` the same as `b` where both have the same shape (text, attributes), so a count moves in place and focus stays; false when the shape differs
const patch = (a, b) => a.childNodes.length === b.childNodes.length && [...a.childNodes].every((x, i) => {
  const y = b.childNodes[i];
  if (x.nodeName !== y.nodeName) return false;
  if (x.nodeType === 3) { if (x.data !== y.data) x.data = y.data; return true; }
  if (x.nodeType !== 1) return true;
  for (const { name, value } of [...y.attributes]) if (name !== 'style' && x.getAttribute(name) !== value) x.setAttribute(name, value);
  for (const { name } of [...x.attributes]) if (name !== 'style' && !y.hasAttribute(name)) x.removeAttribute(name);
  return patch(x, y);
});

const runKey = x => `${x.by}|${x.since}`;

/**
 * The window's corner above the status line, made once: the card first, then the shell's notices (lib/shell-notice.mjs finds its host
 * by id, here inside the corner), so a notice that appears while the card is up stands under it instead of over it.
 */
export function shellCorner(doc = globalThis.document) {
  let c = doc.getElementById('shell-corner');
  if (!c) { c = doc.createElement('div'); c.id = 'shell-corner'; c.className = 'ui-shell-corner'; doc.body.append(c); }
  let n = doc.getElementById('shell-notices');
  if (!n) { n = doc.createElement('div'); n.id = 'shell-notices'; n.className = 'ui-shell-notices'; n.setAttribute('role', 'status'); }
  if (n.parentElement !== c) c.append(n);
  return c;
}

/**
 * The card in a document: `update(next, prev, ended, all)` is lib/agent-activity.mjs's listener. The card does not open on its own (2 Nov 2026,
 * owner: "this thing opens again and again"): the status bar's item (`status()`, a fixed-width part of the status line) says who is at work
 * and opens the card when pressed; Dismiss, or the item pressed again, closes it. `corner()` answers the element the card goes first in;
 * `openChanges()` runs Open changes, `openWork(key)` Show work. Answers { update, open, close, toggle, isOpen, element, stop }.
 */
export function agentCard({ doc = globalThis.document, corner = () => shellCorner(doc), status = () => doc.getElementById('st-agents'), openChanges = () => {}, openWork = () => {}, now = () => Date.now(), fadeAfter = FADE_AFTER } = {}) {
  let card = null, live = null, shownKey = '', shownState = '', endedKey = '', clock = null, fadeT = null, view = null, held = false, opened = false;   // held: its time is up, it waits for the pointer to leave
  let all = [], ended = null, pressedAt = null;
  const reduced = () => !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const say = text => {
    if (!live) { live = doc.createElement('p'); live.id = 'agent-card-live'; live.className = 'visually-hidden'; live.setAttribute('role', 'status'); corner().prepend(live); }
    live.textContent = '';
    doc.defaultView?.setTimeout(() => { live.textContent = text; }, 50);
  };
  // the status bar's item: who is at work, drawn in place in its fixed slot (the part keeps its width, so nothing after it moves)
  let wired = null, drawnItem = '';
  const paintStatus = () => {
    const el = status();
    if (!el) return;
    if (wired !== el) {
      wired = el; drawnItem = '';
      el.setAttribute('aria-haspopup', 'dialog');
      el.addEventListener('click', () => toggle());
    }
    const item = view ? agentStatusItem(view.state === 'running' ? all : [], view.state === 'ended' ? ended : null, now()) : null;
    el.hidden = !item;
    el.setAttribute('aria-expanded', String(!!(item && opened)));
    if (!item) { drawnItem = ''; return; }
    if (drawnItem !== item.html) { el.innerHTML = item.html; drawnItem = item.html; }
    el.title = item.label; el.setAttribute('aria-label', item.label);
    el.toggleAttribute('data-attention', item.attention);
    if (item.share != null) el.style.setProperty('--agent-share', String(item.share)); else el.style.removeProperty('--agent-share');
  };
  // the card stands over the item that opened it, inside the window
  const anchor = () => {
    const el = status(), win = doc.defaultView;
    if (!card || !el || el.hidden || !win) { card?.removeAttribute('data-anchored'); return; }
    const r = el.getBoundingClientRect(), w = Math.min(380, win.innerWidth - 24);
    card.style.setProperty('--agent-card-x', `${Math.max(12, Math.min(r.left, win.innerWidth - w - 12))}px`);
    card.style.setProperty('--agent-card-b', `${Math.max(12, win.innerHeight - r.top + 8)}px`);
    card.setAttribute('data-anchored', '');
  };
  const remove = () => {
    clearTimeout(fadeT); fadeT = null;
    card?.remove(); card = null; held = false;
  };
  const close = () => { opened = false; remove(); paintStatus(); };
  const draw = () => {
    paintStatus();
    if (!view || !opened) return;
    const body = agentCardBody(view, now());
    if (!card) {
      card = doc.createElement('section');
      card.id = 'agent-card'; card.className = 'agent-card';
      // a press whose control was redrawn under it (the card is patched while the agent works) ends on the card itself: it opens nothing
      card.addEventListener('pointerdown', ev => { pressedAt = ev.target; });
      card.addEventListener('click', ev => {
        const lost = pressedAt && !pressedAt.isConnected; pressedAt = null;
        if (ev.target.closest('#agent-card-dismiss')) close();
        else if (lost) return;
        else if (ev.target.closest('#agent-card-changes')) { close(); openChanges(); }
        // Show work, or the card anywhere else: the spectator page, at the agent pressed (a block of a card of several), else the card's
        else if (ev.target.closest('#agent-card-watch') || !ev.target.closest('button, a, input')) {
          const key = ev.target.closest('.agent-item')?.dataset.key || card?.dataset.key || '';
          close(); openWork(key);
        }
      });
      card.addEventListener('keydown', ev => { if (ev.key === 'Escape') { close(); status()?.focus(); } });
      card.addEventListener('mouseleave', () => { if (held) fadeLater(2000); });
      card.addEventListener('focusout', ev => { if (held && !card?.contains(ev.relatedTarget)) fadeLater(2000); });
      const c = corner(), notices = c.querySelector('.ui-shell-notices');
      if (notices) c.insertBefore(card, notices); else c.append(card);
      anchor();
    }
    card.dataset.state = body.state || view.state;
    card.dataset.key = (view.state === 'running' ? (leadsOf(view.all?.length ? view.all : [view.a])[0] || view.a)?.file : view.e?.file) || '';
    card.dataset.progress = body.shares ? 'many' : body.share == null ? 'unknown' : 'known';   // many: each block has its own
    card.setAttribute('aria-label', view.state === 'running' ? (view.all?.length > 1 ? `${view.all.map(a => a.by).join(', ')} are working in the project` : `${view.a.by} is working in the project`) : `${view.e.by} finished in the project`);
    card.removeAttribute('data-fading');
    const next = doc.createElement('div'); next.innerHTML = body.html;
    if (!patch(card, next)) card.innerHTML = body.html;
    card.toggleAttribute('data-many', !!body.shares);
    if (body.share != null) card.style.setProperty('--agent-share', String(body.share));
    else card.style.removeProperty('--agent-share');
    (body.shares || []).forEach((sh, i) => { const it = card.querySelector(`.agent-item[data-i="${i}"]`); if (it && sh != null) it.style.setProperty('--agent-share', String(sh)); });
  };
  const fadeLater = (ms = fadeAfter) => {
    clearTimeout(fadeT); held = false;
    fadeT = doc.defaultView?.setTimeout(() => {
      if (!card || shownState !== 'ended') return;
      if (card.matches(':hover') || card.contains(doc.activeElement)) { held = true; return; }   // being read: it goes once the pointer and focus leave
      if (reduced()) { close(); return; }
      card.setAttribute('data-fading', '');
      fadeT = doc.defaultView?.setTimeout(() => { if (card?.hasAttribute('data-fading')) close(); }, FADE_MS);
    }, ms);
  };
  /** Opens the card on what is shown in the status bar now (nothing when nothing runs or has just ended). */
  function open() { if (!view) return false; opened = true; draw(); if (shownState === 'ended') fadeLater(); return true; }
  function toggle() { if (opened) close(); else open(); }
  function update(next, prev, endedNow, list = next ? [next] : []) {
    if (next) {
      const key = list.length > 1 ? list.map(runKey).join('+') : runKey(next);
      if (key !== shownKey || shownState !== 'running') {
        // a newcomer beside one already shown is announced alone; the card is redrawn with all
        const fresh = list.filter(a => !String(shownKey).split('+').includes(runKey(a)));
        for (const a of fresh.length ? fresh : [next]) say(startedSay(a));
        clearTimeout(fadeT); fadeT = null;
      }
      all = list; ended = null;
      view = { state: 'running', a: next, all: list }; shownKey = key; shownState = 'running';
      draw();
      // the clock: the time so far and the time left move; the card and the item are patched in place, so focus and the pointer stay where they are
      if (!clock) clock = doc.defaultView?.setInterval(() => { if (view?.state === 'running') draw(); }, 15000);
      return;
    }
    if (endedNow) {
      const key = runKey(endedNow);
      if (key === endedKey) return;   // already said
      endedKey = key;
      clearInterval(clock); clock = null;
      all = []; ended = endedNow;
      view = { state: 'ended', e: endedNow }; shownKey = key; shownState = 'ended';
      draw(); say(endedSay(endedNow));
      if (opened) fadeLater();
      return;
    }
    // the file went away or went stale, or the end is old news: nothing to show
    clearInterval(clock); clock = null;
    view = null; all = []; ended = null; shownKey = ''; shownState = '';
    close();
  }
  return { update, open, close, toggle, isOpen: () => opened, element: () => card, stop: () => { clearInterval(clock); clock = null; view = null; close(); } };
}

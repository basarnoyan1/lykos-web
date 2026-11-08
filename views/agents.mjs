// Agent work: what each agent working in the project folder is doing, live (owner, 31 Oct 2026: "clicking the card should show what it
// is doing, step by step"). The corner card (lib/agent-card.mjs) says who and how far; this page is the whole of it. The list pane holds
// the agents, those at work first, each lead followed by its sub-agents and the scripts it ran (lib/agent-activity.mjs agentTree); the page
// is the chosen agent's timeline: who and what, how far and how long (1 Nov 2026: the share weighted by each step's time, the time so far,
// the time left and when it should be done, lib/agent-progress.mjs), what it needs (Needs you, Blocked, Failed), then Steps (one track: done, under way with
// its action, ahead with why), Log (what it read, changed and checked, and what that touched, newest first) and, when it has ended, Changed. Everything is
// read from the cards in .lykos/activity.json and .lykos/activity/*.json (docs/Research_Project_Standard.md §3), every second while the
// page is open; nothing here writes. Patterns: a CI run's job list beside its log, a deployment's live build log, an activity feed of
// sentences (Mobbin, 31 Oct 2026: Browserbase's run timeline, Plane's activity, incident.io's run steps), kept to the app's one type
// scale, neutral ink and hairlines.
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink, lib_ui_components$hangRow as hangRow } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_dates$clock as clock, lib_dates$plural as plural } from "../boot.mjs";
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { lib_folder_poll$pollFolder as pollFolder } from "../boot.mjs";
import { store$get as get } from "../boot.mjs";
import { readAgents, elapsedText, changedText, endedWhat, activityHeadline, isReview, isOpen, logGroups } from '../lib/agent-activity.mjs';
import { runTiming, durationText, rangeText, unitsText, rateText, overText, percentText } from '../lib/agent-progress.mjs';
import { agentMark, agentSummary } from '../lib/agent-card.mjs';

export const meta = { title: 'Agent work', icon: 'activity' };

const LOOK_MS = 1000;           // while the page is open: a look a second (one to a few small files)
const LOG_SHOWN = 12;           // log rows drawn before Show earlier: the steps ahead stay in reach under a long log
const REDRAW_EVERY = 5;         // looks between redraws of an open run with nothing new: the time so far and the time left move
let agents = [], problems = [], pick = '', shown = null, stop = null, drawnIn = null, mine = null, ctxNow = null, sig = '', failing = new Map(), earlier = false, looked = false;
let logFrom = '';               // the log's filter: '' every source, else one agent's or script's name
const opened = new Set();       // the log's groups and folds shown whole

/** Shows another folder than the project's (the fixture and its tests: a folder in the browser's own file system); null goes back. */
export function showFolder(folder) { shown = folder; looked = false; agents = []; problems = []; sig = ''; }
const folderShown = () => shown || activeFolder();

const fresh = () => { earlier = false; logFrom = ''; opened.clear(); };
/** Opens the page on one agent's card (its key, "activity/claude.json"): the corner card's Show work. */
export function show(key) { if (key) pick = key; fresh(); }
export function select(id) { if (id !== pick) fresh(); pick = id; }
export const selected = () => pick;

// a run's state in a word, its tone and glyph (lib/listpane.mjs, research-views.css): working amber (a running job's colour), needs you in
// ink, blocked amber with a warning, done green, failed red, silent grey
const STATE_WORD = { running: 'Working', waiting: 'Needs you', blocked: 'Blocked', ended: 'Done', stopped: 'Failed', quiet: 'No word' };
const STATE_TONE = { running: 'working', waiting: 'waiting', blocked: 'blocked', ended: 'finished', stopped: 'stopped', quiet: 'quiet' };
const nameOf = a => a.tool || a.by;
const leadName = a => agents.find(b => b.id === a.parent)?.by || '';

export const list = {
  title: 'Agents',
  get empty() { return folderShown() ? 'No agent has worked here in the last 12 hours' : 'No project folder'; },
  count: rows => rows.filter(a => isOpen(agents.find(b => b.key === a.id))).length || '',
  items() {
    const at = agents.filter(isOpen), rest = agents.filter(a => !isOpen(a));
    const sub = a => (a.state === 'waiting' ? `Needs you: ${a.need.text}` : a.state === 'blocked' ? `Blocked: ${a.need.text}` : activityHeadline(a));
    const row = a => ({ id: a.key, title: nameOf(a), sub: a.depth ? `For ${leadName(a) || 'its lead'}: ${sub(a)}` : sub(a),
      meta: isOpen(a) ? sinceText(a) : clock(a.ended || a.updated), mark: STATE_WORD[a.state], markTone: STATE_TONE[a.state] });
    return [...(at.length && rest.length ? [{ group: true, id: 'g-now', title: 'At work' }] : []), ...at.map(row),
      ...(rest.length ? [{ group: true, id: 'g-earlier', title: 'Earlier' }] : []), ...rest.map(row)];
  },
};

/** The title bar: the page's name, how many are at work (and how many wait for you), and Open changes in More. */
export function page() {
  const n = agents.filter(isOpen).length, w = agents.filter(a => a.state === 'waiting').length;
  return { title: 'Agent work', status: { text: n ? `${n} at work${w ? `, ${w} need${w === 1 ? 's' : ''} you` : ''}` : '', ch: 24 },
    overflow: [{ id: 'agw-changes', label: 'Open changes', run: () => ctxNow?.go?.('changes') }] };
}

const now = () => Date.now();
const sinceText = (a, to = now()) => { const t = Date.parse(a.since); return Number.isFinite(t) ? elapsedText(to - t) : ''; };
const spanText = (from, to) => { const a = Date.parse(from), b = Date.parse(to); return Number.isFinite(a) && Number.isFinite(b) ? elapsedText(b - a) : ''; };
const KIND = { read: ['book', 'Read'], write: ['rename', 'Changed'], check: ['check', 'Checked'], wait: ['clock', 'Waiting'] };
const cap = t => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : '');

// ---- what a line touched, as links (1 Nov 2026): a record opens in the Library, a file in Files, a part of the project its page ----
const VIEW_OF = { library: 'library', records: 'library', papers: 'library', screening: 'screening', extraction: 'extraction', 'risk of bias': 'appraisal', appraisal: 'appraisal',
  analysis: 'analysis', manuscript: 'manuscript', prisma: 'reporting', reporting: 'reporting', searches: 'search', search: 'search', literature: 'search', files: 'files',
  tables: 'outputs', figures: 'outputs', outputs: 'outputs', 'tables and figures': 'outputs', certainty: 'certainty', protocol: 'protocol', overview: 'overview', changes: 'changes' };
const viewOf = x => VIEW_OF[String(x || '').trim().toLowerCase()] || '';
let paperIndex = null, paperIndexOf = null;
const paperOf = x => {
  const s = get?.(), ps = s?.papers || [];
  if (paperIndexOf !== ps) { paperIndexOf = ps; paperIndex = new Map(); for (const p of ps) { if (p.label) paperIndex.set(String(p.label).toLowerCase(), p.id); paperIndex.set(String(p.id).toLowerCase(), p.id); } }
  return paperIndex.get(String(x || '').trim().toLowerCase()) || '';
};
const isFile = x => /\/|\.[a-z0-9]{2,5}$/i.test(x) && !/^\.lykos\//.test(x) && !/\s\d{4}$/.test(x);
function affectHtml(x) {
  const id = paperOf(x);
  if (id) return uiLink({ label: x, title: `Open ${x} in the Library`, attrs: { 'data-agw-record': id } });
  if (isFile(x)) return uiLink({ label: x.split('/').pop(), title: `Show ${x} in Files`, attrs: { 'data-agw-file': x } });
  const v = viewOf(x);
  if (v) return uiLink({ label: x, title: `Open ${x}`, attrs: { 'data-agw-go': v } });
  return `<span class="agw-plain-ref">${esc(x)}</span>`;
}
const affectsHtml = (xs, max = 8) => (xs.length ? `<p class="agw-affects">${xs.slice(0, max).map(affectHtml).join('<span class="agw-sep">, </span>')}${xs.length > max ? `<span class="agw-sep">, and ${xs.length - max} more</span>` : ''}</p>` : '');

// ---- how far and how long (2 Nov 2026, owner: "Working" said twice, a bar drawn with no known progress, a grid of mostly empty facts) ----
/** The step when steps are known, a determinate bar only when how far is known, and one line of facts only when they say something. */
function progressHtml(a, t, c = agentSummary(a, { now: t })) {
  if (!c.open) return c.took ? `<p class="agw-facts">${esc(c.took)}</p>` : '';   // how long it took; what it changed is under Changed
  if (a.state === 'quiet') return '';
  const step = c.step ? `<p class="agw-step-now" title="${esc(c.step)}">${esc(c.step)}</p>` : '';
  const bar = c.share == null ? '' : `<div class="agw-progress" data-progress="known" data-share="${c.share}">
    <div class="agent-track" role="progressbar" aria-label="${esc(activityHeadline(a))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(c.share * 100)}" aria-valuetext="${esc(percentText(c.share))}"><span class="agent-fill"></span></div></div>`;
  const facts = c.facts && a.state !== 'blocked' ? `<p class="agw-facts"${c.finish ? ` title="${esc(c.finish)}"` : ''}>${esc(c.facts)}</p>` : '';
  return step + bar + facts;
}

// ---- what the run needs, or why it stopped: a part of the page of its own, under the head ----
function needHtml(a) {
  if (a.state === 'waiting') {
    const v = viewOf(a.need.where);
    const where = a.need.where ? `<p class="agw-why">${v ? uiLink({ id: 'agw-need-go', label: `Open ${a.need.where}`, attrs: { 'data-agw-go': v } }) : esc(`In ${a.need.where}`)}</p>` : '';
    return section('need', 'Needs you', `<p class="agw-line agw-need-text">${esc(a.need.text)}</p>${where}${a.need.at ? `<p class="agw-why">${esc(`Waiting since ${clock(a.need.at)}`)}</p>` : ''}`);
  }
  if (a.state === 'blocked') return section('need', 'Blocked', `<p class="agw-line">${esc(a.need.text)}</p>${a.need.at ? `<p class="agw-why">${esc(`Since ${clock(a.need.at)}`)}</p>` : ''}`);
  if (a.state === 'stopped') {
    const step = a.steps.find(s => s.state === 'failed');
    const why = a.reason || step?.reason || 'It stopped without saying why. Its log may tell.';
    return section('need', 'Failed', `<p class="agw-line">${esc(why)}</p>${step ? `<p class="agw-why">${esc(`At ${step.name}`)}</p>` : ''}`);
  }
  return '';
}

// The steps as one track (owner, 31 Oct 2026, a workflow run's step list as the pattern): each step's node hangs in the gutter on a rail,
// done a green check, under way an amber ring, failed a red stop, ahead its figure; the rail is solid below a step done and dotted below the
// rest. The step under way shows its units with a bar of its own, the rate, the time left and when it runs past its estimate; a step done
// says what it took and what it gave; a step ahead says why and how long it should take (declared, or learned from the steps done).
const NODE_WORD = { done: 'Done', running: 'Under way', waiting: 'Ahead', skipped: 'Not run', quiet: 'Last seen', failed: 'Failed' };
function stepsHtml(a, t) {
  const open = isOpen(a) || a.state === 'quiet', named = new Set(a.steps.map(s => s.name));
  const track = [...a.steps, ...a.next.filter(s => !named.has(s.name)).map(s => ({ ...s, state: 'waiting' }))];
  if (!track.length) {
    if (!open) return '';
    const tm = runTiming(a, t);
    if (tm.units) return section('steps', a.state === 'quiet' ? 'Last seen' : 'Now', unitsHtml(a, tm.step, tm.units) + (a.action ? `<p class="agw-doing">${esc(a.action)}</p>` : ''));
    // nothing named: nothing said (2 Nov 2026, owner: "Its card names no step yet." told nothing)
    return a.action && a.action !== a.what ? section('steps', a.state === 'quiet' ? 'Last seen' : 'Now', `<p class="agw-doing">${esc(a.action)}</p>`) : '';
  }
  const tm = runTiming({ ...a, steps: track }, t);
  const row = (s, i) => {
    const tt = tm.timings[i] || {};
    // a run that ended left no step under way: one still marked running when the card closed (stopped mid-step) was not run to its end
    const state = s.state === 'failed' ? 'failed' : !open ? (s.state === 'done' ? 'done' : 'skipped') : a.state === 'quiet' && s.state === 'running' ? 'quiet' : s.state;
    const node = state === 'done' ? icon('check', { size: 12 }) : state === 'failed' ? icon('stop', { size: 12 }) : state === 'running' ? '' : state === 'quiet' ? icon('clock', { size: 12 }) : String(i + 1);
    let ran = '';
    if (state === 'done') ran = s.started && s.ended ? spanText(s.started, s.ended) : '';
    else if (state === 'running' || state === 'quiet') ran = s.started ? `${sinceText({ since: s.started }, t)}${tt.declared ? ` of about ${durationText(tt.declared)}` : ''}` : tt.declared ? `about ${durationText(tt.declared)}` : '';
    else if (state === 'waiting') ran = tt.expected ? `about ${durationText(tt.expected)}` : '';
    else if (state === 'skipped') ran = 'Not run';
    else if (state === 'failed') ran = 'Failed';
    const tip = [s.why, s.started ? `${clock(s.started)}${s.ended ? ` to ${clock(s.ended)}` : ''}` : '', state === 'waiting' && tt.learned ? 'Its time is learned from the steps done' : ''].filter(Boolean).join('. ');
    let body = '';
    if (state === 'running' || state === 'quiet') {
      if (tt.units) body += unitsHtml(a, tt, tt.units);
      if (tt.over) body += `<p class="agw-over">${esc(cap(overText(tt.over, tt.declared)))}</p>`;
      if (a.action && a.action !== s.name) body += `<p class="agw-doing">${esc(a.action)}</p>`;
    } else if (state === 'done' && (s.result || tt.units)) body += `<p class="agw-why agw-result">${esc(s.result || unitsText(tt.units, { item: false }))}</p>`;
    else if (state === 'failed' && s.reason) body += `<p class="agw-fail">${esc(s.reason)}</p>`;
    else if (state === 'waiting' && s.total) body += `<p class="agw-why">${esc(unitsText({ done: 0, total: s.total, unit: s.unit }, { item: false }).replace(/^0 of /, ''))}</p>`;
    return hangRow({ tag: 'li', cls: 'agw-step', attrs: `data-step="${state}"${tip ? ` title="${esc(tip)}"` : ''}`, mark: `<span class="agw-node">${node}</span>`,
      body: `<p class="agw-step-title"><span class="agw-line"><span class="visually-hidden">${esc(NODE_WORD[state] || 'Ahead')}: </span>${esc(s.name)}</span>${ran ? `<span class="agw-when">${esc(ran)}</span>` : ''}</p>${body}` });
  };
  return section('steps', 'Steps', `<ol class="agw-track">${track.map(row).join('')}</ol>`);   // no count: the bar above says how far
}

/** A step's units: its own bar, "64 of 208 records, Shirvalkar 2025", and the rate with the time the step has left. */
function unitsHtml(a, tt, u) {
  const share = u.total ? u.done / u.total : 0;
  const rate = tt?.rate ? rateText(tt.rate, u.unit) : '';
  const left = !isOpen(a) ? '' : tt?.left ? `${rangeText(tt.left)} left` : tt?.estimating ? 'estimating the time left…' : '';
  const pace = [cap(rate), rate ? left : cap(left)].filter(Boolean).join(', ');
  return `<div class="agw-units" data-share="${share}"><div class="agent-track" role="progressbar" aria-label="${esc(`${u.unit || 'Items'} done`)}" aria-valuemin="0" aria-valuemax="${u.total}" aria-valuenow="${u.done}"><span class="agent-fill"></span></div></div>`
    + `<p class="agw-doing agw-units-text">${esc(unitsText(u))}</p>${pace ? `<p class="agw-why">${esc(pace)}</p>` : ''}`;
}

// ---- the log (1 Nov 2026): sentences, newest first; the same act on many things one row with its count; routine lines folded; links to what they touched; a filter by source ----
function logHtml(a) {
  const self = nameOf(a), sources = [...new Set(a.log.map(e => e.from || self))];
  if (logFrom && !sources.includes(logFrom)) logFrom = '';
  const rows = logGroups(a.log, { from: logFrom, self }), shownRows = earlier ? rows : rows.slice(0, LOG_SHOWN);
  if (!a.log.length) return section('log', 'Log', `<p class="agw-quiet">${esc(isOpen(a) ? 'Nothing logged yet. A line appears here when it reads, changes or checks something.' : 'This run kept no log.')}</p>`);
  const filter = sources.length > 1 ? uiBar({ kind: 'tools', id: 'agw-log-tools', label: 'Log', filters: [{ type: 'select', id: 'agw-log-from', label: 'Show lines from', value: logFrom,
    options: [['', 'Every source'], ...sources.map(x => [x, x === self ? `${x} only` : x])] }] }) : '';
  const time = e => `<time class="agw-time" datetime="${esc(e.at)}">${esc(clock(e.at))}</time>`;
  const sub = es => `<ol class="agw-sub">${[...es].reverse().map(e => `<li><span class="agw-time">${esc(clock(e.at))}</span> <span class="agw-sub-text">${esc(e.text)}</span></li>`).join('')}</ol>`;
  const row = g => {
    const key = `${g.kind}|${g.first || g.lines?.[0]?.at}|${g.kind === 'line' ? g.e.text : ''}`, whole = opened.has(key);
    if (g.kind === 'fold') {
      const n = g.lines.length;
      return hangRow({ tag: 'li', cls: 'agw-entry agw-fold', attrs: 'data-kind="routine"', mark: time(g.lines.at(-1)),
        body: `<p class="agw-step-title"><span class="agw-line agw-routine">${uiLink({ label: whole ? `Hide ${plural(n, 'routine line')}` : `${plural(n, 'routine line')}: ${g.lines.at(-1).text}${n > 1 ? ' and more' : ''}`, attrs: { 'data-agw-open-group': key } })}</span></p>${whole ? sub(g.lines) : ''}` });
    }
    const e = g.e, [ico, word] = KIND[e.kind] || ['', ''], from = e.from && e.from !== self ? e.from : '';
    const more = g.more.length ? `<p class="agw-why">${uiLink({ label: whole ? 'Hide the others' : `and ${plural(g.more.length, 'more line')} like it, since ${clock(g.first)}`, attrs: { 'data-agw-open-group': key } })}</p>${whole ? sub(g.more) : ''}` : '';
    // the time and the kind of act hang before the page's edge; the sentence starts on it
    return hangRow({ tag: 'li', cls: 'agw-entry', attrs: `data-kind="${esc(e.kind || '')}"`,
      mark: `${time(e)}${ico ? `<span class="agw-kind">${icon(ico, { size: 14 })}</span>` : ''}`,
      body: `<p class="agw-step-title"><span class="agw-line">${word ? `<span class="visually-hidden">${esc(word)}: </span>` : ''}${esc(e.text)}</span>${from ? `<span class="agw-when">${esc(from)}</span>` : ''}</p>${affectsHtml(g.affects)}${more}` });
  };
  const moreRows = rows.length > LOG_SHOWN && !earlier ? `<p class="agw-more">${uiLink({ id: 'agw-earlier', label: `Show ${plural(rows.length - LOG_SHOWN, 'earlier row')}` })}</p>` : '';
  const body = rows.length ? `<ol class="agw-log" aria-label="What ${esc(self)} did, newest first">${shownRows.map(row).join('')}</ol>${moreRows}` : `<p class="agw-quiet">${esc(`No line from ${logFrom}.`)}</p>`;
  return section('log', 'Log', `${filter}${body}`, plural(a.log.length, 'line'));
}

function changedHtml(a) {
  if (isOpen(a) || a.state === 'quiet') return '';
  const files = a.changed.map(p => hangRow({ tag: 'li', cls: 'agw-file', attrs: `title="${esc(p)}"`, mark: icon('file', { size: 14 }), body: isFile(p) ? uiLink({ label: p, attrs: { 'data-agw-file': p } }) : esc(p) })).join('');
  const notRun = a.steps.filter(s => s.state !== 'done').length;
  const said = a.summary || (a.changed.length ? changedText(a.changed) : isReview(a) ? 'It changed no file: it only read.' : 'It named no file it changed.');
  const body = `<p class="agw-line">${esc(said)}</p>${notRun ? `<p class="agw-why">${esc(`${plural(notRun, 'step')} not run`)}</p>` : ''}${files ? `<ul class="agw-files">${files}</ul>` : ''}`
    + (a.changed.length ? `<p class="agw-more">${uiLink({ id: 'agw-open-changes', label: 'Open changes' })}</p>` : '');
  return section('changed', a.state === 'stopped' ? 'What it changed before it stopped' : 'Changed', body);
}

function helpersHtml(a) {
  const kids = agents.filter(b => b.parent === a.id && b !== a);
  const lead = a.parent ? agents.find(b => b.id === a.parent) : null;
  if (!kids.length && !lead) return '';
  const link = b => hangRow({ tag: 'li', mark: agentMark(b.by, b.tool), body: `<p class="agw-step-title"><span class="agw-line">${uiLink({ label: nameOf(b), attrs: { 'data-agw-open': b.key } })} <span class="agw-why">${esc(activityHeadline(b))}</span></span><span class="agw-when">${esc(STATE_WORD[b.state])}</span></p>` });
  return section('team', kids.length ? 'Working for it' : 'Works for', `<ul class="agw-plain">${lead ? link(lead) : ''}${kids.map(link).join('')}</ul>`);
}

// each part's heading has its glyph in the gutter, its words on the page's edge (lib/ui-components hangRow)
const SECTION_ICON = { steps: 'flow', log: 'list', changed: 'changes', team: 'user', need: 'flag' };
const section = (id, title, body, count = '') => `<section class="agw-sec" id="agw-${id}" aria-labelledby="agw-${id}-h">${hangRow({ tag: 'h3', cls: 'agw-h', attrs: `id="agw-${id}-h"`, mark: SECTION_ICON[id] ? icon(SECTION_ICON[id], { size: 14 }) : '', body: `${esc(title)}${count ? `<span class="agw-count">${esc(count)}</span>` : ''}` })}${body}</section>`;

/** The page for one agent (exported for the tests): its head, then the steps, Log, Changed and who it works with. */
export function detailHtml(a, t = now()) {
  const c = agentSummary(a, { now: t });
  const what = isOpen(a) || a.state === 'quiet' ? activityHeadline(a) : a.state === 'stopped' ? activityHeadline(a) : endedWhat(a);
  // one head line: the mark, the name, and at its end the state with its time ("Working, 16 min", "Finished 14:02, 22 min", "Waiting for you")
  const state = `<span class="agw-state" id="agw-standing" data-state="${esc(a.state)}">${isOpen(a) && a.state === 'running' && c.share == null ? '<span class="ui-progress-ring" aria-hidden="true"></span>' : ''}${esc(c.stateText)}</span>`;
  const head = `<header class="agw-intro">${hangRow({ tag: 'h2', cls: 'agw-who', mark: agentMark(a.by, a.tool), body: `<span class="agw-name">${esc(nameOf(a))}${a.tool ? `<span class="agw-for">${esc(` for ${a.by}`)}</span>` : ''}</span>${state}` })}
    <p class="agw-what"${a.goal ? ` title="${esc(a.goal)}"` : ''}>${esc(what)}</p>
    ${a.goal ? `<p class="agw-goal">${esc(a.goal)}</p>` : ''}${progressHtml(a, t, c)}</header>`;
  return `<div class="agw ui-hang" data-state="${esc(a.state)}">${head}${needHtml(a)}${stepsHtml(a, t)}${logHtml(a)}${changedHtml(a)}${helpersHtml(a)}</div>`;
}

function emptyHtml() {
  const folder = folderShown();
  if (!folder) return emptyState({ icon: 'activity', title: 'No project folder', detail: 'Agents report their work in the project folder. This project is kept in the app, so there is nothing to show.', frame: false });
  if (!looked) return `<p class="agw-quiet agw-loading" role="status">Reading the agents' cards…</p>`;
  return emptyState({ icon: 'activity', title: 'No agent at work',
    detail: 'When Claude, another agent, the app\'s models or a Lykos script works in this folder, its steps and log show here as it goes.', help: true, frame: false });
}

function problemHtml() {
  const stuck = problems.filter(p => (failing.get(p.key) || 0) > 2);
  return stuck.length ? `<p class="agw-problem" role="status">${esc(`Could not read ${stuck.map(p => p.key).join(', ')}: ${stuck[0].reason}. It is read again every second.`)}</p>` : '';
}

/** Draws the chosen agent (or the empty state) into the page, keeping the shell's scroll. */
function draw(el) {
  if (!el) return;
  const a = agents.find(x => x.key === pick) || null;
  el.innerHTML = `${problemHtml()}${a ? detailHtml(a) : `<div class="agw">${emptyHtml()}</div>`}`;
  mine = el.lastElementChild;
  el.querySelectorAll('.agw-progress[data-share], .agw-units[data-share]').forEach(p => p.style.setProperty('--agent-share', p.dataset.share));
}

/** Reads the cards again; answers true when what they say changed. */
async function look(t = now()) {
  const folder = folderShown();
  if (!folder) { looked = true; return false; }
  const r = await readAgents(folder, t);
  for (const p of r.problems) failing.set(p.key, (failing.get(p.key) || 0) + 1);
  for (const k of [...failing.keys()]) if (!r.problems.some(p => p.key === k)) failing.delete(k);
  // a file being written at the moment of the look: keep the agent as it was until it reads again
  const kept = agents.filter(a => r.problems.some(p => p.key === a.key) && !r.agents.some(b => b.key === a.key));
  const next = [...r.agents, ...kept], key = JSON.stringify([next, r.problems.filter(p => (failing.get(p.key) || 0) > 2)]);
  looked = true; agents = next; problems = r.problems;
  if (!pick || !agents.some(a => a.key === pick)) pick = agents[0]?.key || '';
  if (key === sig) return false;
  sig = key; return true;
}

export async function prepare() { await look(); }

export function render(el, ctx) {
  stop?.(); stop = null; drawnIn = el; ctxNow = ctx;
  draw(el);
  wire(el, ctx);
  let ticks = 0;
  const tick = async () => {
    const changed = await look();
    if (drawnIn !== el) return;
    // the shell drew another view in this element: the looks end here and never draw this page over it
    if (!mine?.isConnected || !el.contains(mine)) { stop?.(); stop = null; drawnIn = null; return; }
    if (changed) { ctx?.refreshList?.(); ctx?.chrome?.(); draw(el); wire(el, ctx); }
    else if (++ticks % REDRAW_EVERY === 0) {
      // the time so far and the time left move: an open run is drawn again, unless the reader is in one of its controls (focus stays)
      const a = agents.find(x => x.key === pick), inside = el.contains(globalThis.document?.activeElement) && globalThis.document?.activeElement !== el;
      if (a && (isOpen(a) || a.state === 'quiet') && !inside) { draw(el); wire(el, ctx); }
      else if (a) { const s = el.querySelector('#agw-standing'); if (s && !isOpen(a)) s.textContent = agentSummary(a, { now: now() }).stateText; }
    }
  };
  stop = folderShown() ? pollFolder(paths => (!paths || paths.some(p => p === '*' || p.startsWith('.lykos/activity'))) ? tick() : null, LOOK_MS, { timed: true }) : null;
  if (stop) tick();   // a look at once on every draw, not a second later
}

function wire(el, ctx) {
  el.querySelector('#agw-earlier')?.addEventListener('click', () => { earlier = true; draw(el); wire(el, ctx); });
  el.querySelector('#agw-open-changes')?.addEventListener('click', () => ctx?.go?.('changes'));
  el.querySelectorAll('[data-agw-open]').forEach(b => b.addEventListener('click', () => { select(b.dataset.agwOpen); ctx?.refreshList?.(); draw(el); wire(el, ctx); }));
  const again = () => { draw(el); wire(el, ctx); };
  el.querySelectorAll('[data-agw-open-group]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.agwOpenGroup; if (opened.has(k)) opened.delete(k); else opened.add(k); again(); }));
  el.querySelector('#agw-log-from')?.addEventListener('change', ev => { logFrom = ev.target.value || ''; earlier = false; again(); el.querySelector('#agw-log-from')?.focus(); });
  // what a line touched: a record in the Library, a file in Files, a part of the project its page
  el.querySelectorAll('[data-agw-record]').forEach(b => b.addEventListener('click', () => ctx?.go?.('library', b.dataset.agwRecord)));
  el.querySelectorAll('[data-agw-go]').forEach(b => b.addEventListener('click', () => ctx?.go?.(b.dataset.agwGo)));
  el.querySelectorAll('[data-agw-file]').forEach(b => b.addEventListener('click', async () => {
    try { (await import('./files.mjs')).show(b.dataset.agwFile, { preview: true }); } catch { /* Files opens at its own place */ }
    ctx?.go?.('files');
  }));
}

export function unmount() { stop?.(); stop = null; drawnIn = null; mine = null; }

// Another program editing the project folder says so in `.lykos/activity.json`:
//   { "active": true, "by": "Claude", "what": "Drawing Figures 1-4", "areas": ["Database", "Figures"], "since": ISO, "updated": ISO,
//     "steps": [{ "name": "Drawing Figure 1", "state": "done" }, { "name": "Drawing Figure 2", "state": "running" }, ...] }
//   or, without names, "done": 1, "total": 4, "current": "Drawing Figure 2";
// and when it is done: { "active": false, ..., "ended": ISO, "changed": ["2 Figures/Figure1.png", ...] } ("finished" is read as "ended").
// Evidence table/tools/build/build_all.py of a review writes it; tools/lykos-apply.mjs and tools/lykos-after-build.mjs through
// tools/activity-writer.mjs; any agent can (docs/Research_Project_Standard.md §3). While it is active the window says who is editing,
// what and how far (lib/agent-card.mjs), holds its own saves and does not read the folder in, so the two never overwrite each other;
// when it ends the project is read again from disk and the card says what changed. An activity not updated for STALE_MS is taken as
// ended (a script that stopped without saying so); one that says "staleAfterMin": n (at most 180) is kept for n minutes without an update.
// Steps and counts are optional: an activity without them shows no count; a review with steps shows its count as an edit does ("4 of 8").
// "mode": "review" is an agent that only reads (a review, a check, a sweep): the card says it is reviewing, and the window neither holds
// its saves nor stops reading the folder, since nothing is being written that the two could overwrite.
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { lib_folder_poll$pollFolder as pollFolder } from "../boot.mjs";
import { lib_agent_state$setAgentEditing as setAgentEditing, lib_agent_state$agentEditing as agentEditing } from "../boot.mjs";
import { samplesOf } from './agent-progress.mjs';

export const FILE = '.lykos/activity.json';
/** Reviews (reading only) each write their own file here, so several at once are all shown (tools/activity-writer.mjs reviewFile). */
export const DIR = '.lykos/activity';
export const STALE_MS = 10 * 60 * 1000;
/** The longest an activity may declare it can go without an update ("staleAfterMin"): three hours. */
export const MAX_STALE_MIN = 180;
/**
 * How long this activity may go without an update before it is taken as ended: its own `staleAfterMin` (an agent working for hours
 * between updates, 31 Oct 2026: Claude's review card vanished after 10 minutes), at most MAX_STALE_MIN, else STALE_MS.
 */
export const staleAfter = raw => {
  // a run waiting for the person writes nothing until they act: it stays up as long as an ended card does (1 Nov 2026)
  if (needOf(raw)?.kind === 'you') return WAIT_KEEP_MS;
  const m = Number(raw?.staleAfterMin); return Number.isFinite(m) && m > 0 ? Math.min(m, MAX_STALE_MIN) * 60000 : STALE_MS;
};
/** How long a card waiting for the person stays up without an update: twelve hours. */
export const WAIT_KEEP_MS = 12 * 60 * 60 * 1000;
/**
 * What a run needs before it goes on (1 Nov 2026): { kind: 'you', text, where, at } when it waits for the person (what they must do and
 * where), { kind: 'blocked', text, at } when something else holds it (why); null when it needs nothing. tools/activity-writer.mjs wait, block.
 */
export function needOf(raw) {
  const n = raw?.need;
  if (!n || typeof n !== 'object') return null;
  const kind = n.kind === 'you' ? 'you' : n.kind === 'blocked' ? 'blocked' : '';
  const text = String(n.text ?? '').trim().slice(0, 300);
  if (!kind || !text) return null;
  return { kind, text, where: String(n.where ?? '').trim().slice(0, 80), at: String(n.at || '') };
}
const num0 = v => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 ? +v : null);
/** A step's work units, estimate and result as the file states them (only those it has): { done, total, unit, item, samples, estimateMs, result, reason }. */
export function stepExtras(s) {
  if (!s || typeof s !== 'object') return {};
  const total = num0(s.total), out = {};
  if (total) Object.assign(out, { done: Math.min(Math.floor(num0(s.done) ?? 0), total), total: Math.floor(total) });
  if (out.total && s.unit) out.unit = String(s.unit).trim().slice(0, 30);
  if (s.item) out.item = String(s.item).trim().slice(0, 120);
  const sm = samplesOf(s.samples); if (out.total && sm.length) out.samples = sm;
  const e = num0(s.estimateMs); if (e) out.estimateMs = e;
  if (s.result) out.result = String(s.result).trim().slice(0, 300);
  if (s.reason) out.reason = String(s.reason).trim().slice(0, 300);
  return out;
}
/** How long after its end an ended activity is still news (a window opened later does not announce it). */
export const ENDED_NEWS_MS = 90 * 1000;
const STATES = new Set(['done', 'running', 'waiting', 'failed']);
const listeners = new Set();
const dec = new TextDecoder();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const count = v => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : null);

/** The steps a file states, each { name, state } (an unknown state is waiting), at most 50. */
function stepsOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map(s => (typeof s === 'string' ? { name: str(s, 80), state: 'waiting' }
    : { name: str(s?.name, 80), state: STATES.has(s?.state) ? s.state : 'waiting', ...(s?.started ? { started: String(s.started) } : {}), ...(s?.ended ? { ended: String(s.ended) } : {}), ...stepExtras(s) }));
}

/** A name as a file and an id ("Claude (Opus)" → "claude-opus"), the same rule as tools/activity-writer.mjs slugOf. */
export const slugOf = by => String(by || 'agent').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';

/** What a card says of the whole run beyond its steps: what it needs, its own units (a card without steps), its estimate, why it failed. */
function runExtras(raw) {
  const need = needOf(raw), u = raw.steps?.length ? {} : stepExtras({ done: raw.done, total: raw.total, unit: raw.unit, item: raw.item, samples: raw.samples });
  const e = num0(raw.estimateMs);
  return { ...(need ? { need } : {}), ...(u.unit ? { unit: u.unit } : {}), ...(u.item ? { item: u.item } : {}), ...(u.samples ? { samples: u.samples } : {}),
    ...(e ? { estimateMs: e } : {}), ...(raw.reason ? { reason: str(raw.reason, 300) } : {}) };
}

/** Who, what and where, read the same way for a running and an ended activity; `id` and `parent` tie a sub-agent to its lead, `tool` names a script. */
function base(raw) {
  const areas = (Array.isArray(raw.areas) ? raw.areas : []).map(x => String(x).trim()).filter(Boolean).slice(0, 6);
  const by = str(raw.by, 40) || 'An agent';
  return { by, what: str(raw.what, 120), areas, since: String(raw.since || ''), mode: raw.mode === 'review' ? 'review' : 'edit',
    id: str(raw.id, 60) || slugOf(by), parent: str(raw.parent, 60), tool: str(raw.tool, 40) };
}

/** The activity a file states, or null when it states none that is current (ended, stale or not an activity). */
export function activityOf(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.active === false || raw.ended || raw.finished) return null;
  const t = Date.parse(raw.updated || raw.since || '');
  if (!Number.isFinite(t) || now - t > staleAfter(raw)) return null;
  const a = { ...base(raw), ...runExtras(raw) }, steps = stepsOf(raw.steps);
  // a review an edit ran inside: when that edit ended (the window reads the project in when it changes)
  if (a.mode === 'review' && raw.lastEdit?.ended) a.lastEdit = String(raw.lastEdit.ended);
  if (steps.length) {
    const next = steps.find(s => s.state === 'running');
    return { ...a, steps, done: steps.filter(s => s.state === 'done').length, total: steps.length, current: str(raw.current, 80) || next?.name || '' };
  }
  const total = count(raw.total), done = count(raw.done);
  return { ...a, steps: [], done: total ? Math.min(done ?? 0, total) : null, total: total || null, current: str(raw.current, 80) };
}

/** An activity that ended within ENDED_NEWS_MS ({ by, what, areas, since, ended, changed, total }), or null. */
export function endedOf(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const at = raw.ended || raw.finished || (raw.active === false ? raw.updated : '');
  const t = Date.parse(at || '');
  if (!Number.isFinite(t) || now - t > ENDED_NEWS_MS || t - now > 60000) return null;
  const changed = (Array.isArray(raw.changed) ? raw.changed : []).map(p => str(p, 260)).filter(Boolean).slice(0, 200);
  return { ...base(raw), ended: new Date(t).toISOString(), changed, total: stepsOf(raw.steps).length || count(raw.total) || null,
    ...(raw.failed ? { failed: true, done: stepsOf(raw.steps).filter(s => s.state === 'done').length || count(raw.done) || 0 } : {}) };
}

/** True when an ended activity wrote the project file (an edit, or a review that saved through a change file): the window reads it in.
 *  An edit that ran between two looks (under a second) is never seen running, so its end is the only sign of it. */
export const endedWroteProject = e => !!e && (e.mode !== 'review' || (e.changed || []).some(p => p === '.lykos/project.json'));

/** True when the activity only reads the project (a review): saves are not held for it. */
export const isReview = a => a?.mode === 'review';

/** True when the editor is Claude (its name as agents write it: "Claude", "Claude Code", "Claude (Opus)"): the card shows its mark. */
export const isClaude = by => /^claude\b/i.test(String(by || '').trim());
/** Which mark a name takes: 'claude', 'codex' (OpenAI's Codex), 'models' (the app's own model connections: DeepSeek, ChatGPT, a team) or 'other'. */
export const agentKind = by => { const b = String(by || '').trim(); return isClaude(b) ? 'claude' : /^codex\b/i.test(b) ? 'codex' : /^(lykos models|deepseek|chatgpt|gpt|gemini|jev|mistral|qwen|llama)\b/i.test(b) ? 'models' : 'other'; };

const lowerArea = x => (/^[A-Z][a-z]/.test(x) && !/^[A-Z]{2}/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x);
/** "the database, tables and figures" (the areas as a list in plain words), "the project" when none are named. */
function areaList(areas = []) {
  const words = areas.map(lowerArea);
  return words.length > 1 ? `the ${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words.length ? `the ${words[0]}` : 'the project';
}
/** "Figures 1-4" read as a range: "Figures 1–4". */
const ranges = t => String(t || '').replace(/(\d)\s*-\s*(\d)/g, '$1–$2');

/** "Claude is updating the database, tables and figures" (the areas as a list in plain words). */
export function activityText(a) {
  if (!a) return '';
  return `${a.by} is ${isReview(a) ? 'reviewing' : 'updating'} ${areaList(a.areas)}`;
}

/** What it is doing, in plain words: its own `what` ("Drawing Figures 1–4"), else "Updating the figures". */
export function activityHeadline(a) {
  if (!a) return '';
  return a.what ? ranges(a.what) : `${isReview(a) ? 'Reviewing' : 'Updating'} ${areaList(a.areas)}`;
}

// A verb in -ing as its past ("Drawing" → "Drew", "Updating" → "Updated"): the end says what was done in the words the activity used.
// stem + "ed" is right for the e-dropping verbs too (updat-ing, updat-ed); a consonant before y turns it to "ied" (Applying → Applied).
const IRREGULAR = { drawing: 'drew', redrawing: 'redrew', undoing: 'undid', building: 'built', rebuilding: 'rebuilt', writing: 'wrote', rewriting: 'rewrote',
  making: 'made', running: 'ran', reading: 'read', setting: 'set', putting: 'put', getting: 'got', taking: 'took', bringing: 'brought', finding: 'found', sending: 'sent', cutting: 'cut', splitting: 'split' };
export function pastOf(word) {
  const w = String(word || '').toLowerCase();
  if (!/^[a-z]{3,}ing$/.test(w) || /^(bring|string|spring|swing|thing|nothing|something|during|morning|evening)$/.test(w)) return IRREGULAR[w] || '';
  if (IRREGULAR[w]) return IRREGULAR[w];
  const stem = w.slice(0, -3);
  return /[^aeiou]y$/.test(stem) ? `${stem.slice(0, -1)}ied` : `${stem}ed`;
}

/** "Drew Figures 1–4 from the database", "Updated the figures": what an ended activity did (the card names who above it). */
export function endedWhat(e) {
  if (!e) return '';
  // a run that stopped on an error or an exit (tools/activity-writer.mjs marks it failed) did not do what it set out to
  if (e.failed) return `Stopped: ${ranges(e.what) || (isReview(e) ? 'the review' : 'the update')}`;
  const what = ranges(e.what), [first = '', ...rest] = what.split(' '), colon = first.endsWith(':') ? ':' : '', past = pastOf(first.replace(/:$/, ''));
  if (past) return `${past.charAt(0).toUpperCase()}${past.slice(1)}${colon}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  if (what) return `Finished: ${what}`;
  return `${isReview(e) ? 'Reviewed' : 'Updated'} ${areaList(e.areas)}`;
}

/** "Claude drew Figures 1–4 from the database": the same with who, for the announcement. */
export function endedHeadline(e) {
  if (!e) return '';
  const w = endedWhat(e);
  if (/^Stopped:/.test(w)) return `${e.by} stopped: ${w.slice(9)}`;
  return /^Finished:/.test(w) ? `${e.by} finished: ${w.slice(10)}` : `${e.by} ${w.charAt(0).toLowerCase()}${w.slice(1)}`;
}

/** { done, total, share, label, current }: a determinate share with "2 of 4", or share null when the file gives no count. */
export function progressOf(a) {
  if (!a || !a.total) return { done: null, total: null, share: null, label: '', current: a?.current || '' };
  const done = Math.min(a.done ?? 0, a.total);
  // the step being run is the one counted: "2 of 4" while the second is drawn, the bar at the share already done
  const at = a.current && done < a.total ? done + 1 : done;
  return { done, total: a.total, share: done / a.total, label: `${at} of ${a.total}`, current: a.current || '' };
}

/** Elapsed time in the card's words: "Under 1 min", "1 min", "12 min", "1 h 5 min". */
export function elapsedText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'Under 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** "3 files changed", "1 file changed", "" when the file named none. */
export const changedText = (changed = []) => (changed.length ? `${changed.length} file${changed.length === 1 ? '' : 's'} changed` : '');

/** Calls fn(activity or null, previous, ended or null) when either changes; returns the way to stop. */
export function onAgentActivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** What a folder's activity files state now: { next, ended, running } (see lookOnce). Exported for the tests. */
export async function readActivities(folder, now = Date.now()) {
  const all = [], endedAll = [];
  if (folder) {
    // `file` (the card's file under .lykos) is the key the spectator page opens an agent by (views/agents.mjs)
    const take = (raw, file) => { const a = activityOf(raw, now); if (a) all.push({ ...a, file }); else { const e = endedOf(raw, now); if (e) endedAll.push({ ...e, file }); } };
    try {
      const st = await folder.stat(FILE);
      if (st.exists && !st.dir) take(JSON.parse(dec.decode(await folder.read(FILE))), keyOf(FILE));
    } catch { /* not there, or written half */ }
    try {
      for (const e of (await folder.list(DIR)).filter(x => !x.dir && /\.json$/.test(x.name)).slice(0, 20)) {
        try { take(JSON.parse(dec.decode(await folder.read(`${DIR}/${e.name}`))), keyOf(`${DIR}/${e.name}`)); } catch { /* written half: the next look reads it */ }
      }
    } catch { /* no reviewers' folder */ }
  }
  // the same activity named twice (a review moved to its own file while the old one was still current) is shown once
  const seen = new Set(), running = all.filter(a => { const k = `${a.by}|${a.since}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (isReview(a) - isReview(b)) || String(a.since).localeCompare(String(b.since)));
  const next = running[0] || null, ended = next ? null : endedAll.sort((a, b) => String(b.ended).localeCompare(String(a.ended)))[0] || null;
  return { next, ended, running };
}

let lastKey = '[null,null,[]]', lastShown = null;
/**
 * Reads the activity files once and tells the listeners when what they state changed (exported for the tests; the watcher calls it):
 * fn(next, prev, ended, all). `all` is every running activity (the edit of .lykos/activity.json and each reviewer's .lykos/activity/<who>.json),
 * the edit first; `next` is the first of them; `ended` the newest that ended within ENDED_NEWS_MS when none runs.
 */
export async function lookOnce(now = Date.now()) {
  const { next, ended, running } = await readActivities(activeFolder(), now);
  // alive while someone works (a look a second: it reads one to three small files), quiet otherwise
  const want = running.length ? LIVE_MS : IDLE_MS;
  if (look && want !== pace) { pace = want; pollFolder(look, want, { timed: want === LIVE_MS }); }   // while one runs: timed, so an activity that stops being written is seen to end
  const key = JSON.stringify([next, ended, running]);
  if (key === lastKey) return;
  lastKey = key;
  // a review only reads: it is shown, but the window keeps saving and reading the folder (agent-state holds saves for editors only)
  // an edit that waits for the person does not hold their saves: they may have to act in the window for it to go on
  const editor = running.find(a => !isReview(a) && a.need?.kind !== 'you') || null;
  if (JSON.stringify(agentEditing()) !== JSON.stringify(editor)) setAgentEditing(editor);
  const prev = lastShown; lastShown = next;
  for (const fn of [...listeners]) { try { fn(next, prev, ended, running); } catch { /* one listener does not stop the next */ } }
}

let stop = null, look = null, pace = 0;
const LIVE_MS = 1000, IDLE_MS = 3000;
/** Starts looking at the open folder (idempotent): on each change where the shell watches it (else every 3 s), every second while an activity runs. */
export function watchAgentActivity() { if (!stop) { look = paths => (!paths || paths.some(p => p === '*' || p.startsWith('.lykos/activity'))) ? lookOnce() : null; pace = IDLE_MS; stop = pollFolder(look, pace); } return stop; }

// ---- Every card in full, for the spectator page (views/agents.mjs, 31 Oct 2026) ----
// The card in the corner says who and how far; the page says what each agent is doing, step by step, as it does it. The same files carry
// more for it, every field optional (an old file reads as before; docs/Research_Project_Standard.md §3):
//   "id": "claude-data", "parent": "claude"     who this is, and the lead it works for (a sub-agent, or a script an agent ran)
//   "tool": "lykos-apply"                       a script, by name (the mark is a program's)
//   "goal": "…"                                 what the whole run is for, in a sentence
//   "current": "…"                              the action under way now ("Reading the Scopus export")
//   steps[i].why, .started, .ended              why a step is there, and when it ran
//   "plan": [{ "name", "why" }]                 the steps ahead, when they are not in "steps"
//   "log": [{ "at", "text", "affects": [...], "kind": "read" | "write" | "check" | "wait", "from" }]   what it did, oldest first
//   "summary": "…"                              at the end, what changed, in a sentence
// tools/activity-writer.mjs writes all of it (act.log, act.plan, act.doing; and a shell: `node tools/activity-writer.mjs <folder> log "…"`).
/** The most a card's log keeps (the writer drops the oldest), the steps ahead it shows, and how long an ended card stays on the page. */
export const LOG_MAX = 200;
export const PLAN_MAX = 30;
export const KEEP_ENDED_MS = 12 * 60 * 60 * 1000;
export const LOG_KINDS = ['read', 'write', 'check', 'wait'];
const KIND_SET = new Set(LOG_KINDS);
/** The file a card lives in, as the page names it: "activity.json" for the edit, "activity/claude.json" for a reviewer's. */
export const keyOf = rel => String(rel).replace(/^\.lykos\//, '');
const iso = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const list = (v, n, m) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => str(x, m)).filter(Boolean).slice(0, n);

/** A log as the page shows it: entries with a text, oldest first, at most LOG_MAX; an unknown kind is none. */
export function logOf(raw) {
  return (Array.isArray(raw) ? raw : []).filter(e => e && typeof e === 'object' && str(e.text, 1)).slice(-LOG_MAX)
    .map(e => { const text = str(e.text, 300), said = readableText(text);
      return { at: iso(e.at), text: said || text, affects: list(e.affects, 12, 80), kind: KIND_SET.has(e.kind) ? e.kind : '', from: str(e.from, 40), low: !!e.low || !!said || lowText(text) }; });
}

// A server session's card logged each call by its name ("files ops", "overview"): jargon to anyone reading the page (owner, 1 Nov 2026).
// Those lines read as sentences and count as routine: the page folds them away (tools/mcp/session-card.mjs now writes sentences).
const CALLS = { projects: 'Listed the projects', overview: 'Read the project overview', jobs: 'Looked at the running jobs', 'files ops': 'Read the list of file actions',
  'files help': 'Read the help for file actions', 'files papers': 'Looked at the papers', 'files status': 'Looked at the folder', read: 'Read part of the project', find: 'Searched the project',
  query: 'Searched the project', history: 'Read the history', 'history log': 'Read the history', 'review status': 'Read what is new for review', outputs: 'Read the outputs',
  build: 'Built outputs', write: 'Wrote a file', save_output: 'Saved an output', 'files apply': 'Applied a change file', 'files fulltext': 'Made full texts', 'files search': 'Ran a search',
  'files import': 'Imported records', 'files enrich': 'Looked up record details' };
const MCP_TOOLS = new Set(['projects', 'overview', 'jobs', 'files', 'read', 'find', 'query', 'history', 'review', 'build', 'write', 'outputs', 'save_output']);
/** The sentence for a line that is only a call's name, '' for any other line. */
export function readableText(text) {
  const t = String(text || '').trim();
  if (CALLS[t]) return CALLS[t];
  const [tool, action] = t.split(' ');
  if (!/^[a-z_]+( [a-z_]+)?$/.test(t) || !MCP_TOOLS.has(tool)) return '';
  return `Used ${tool.replace(/_/g, ' ')}${action ? ` (${action.replace(/_/g, ' ')})` : ''}`;
}
// the checker's definitions a run printed after its totals ("In error: Something is wrong: …"): known to the reader, not news
const lowText = t => /^(In error|Not proven|Proven[^:]{0,30}|Contradicted[^:]{0,30}): [A-Z][^:]{0,40}(:|\.)/.test(t) || /^… and \d+ more\b/.test(t);

/** A line's shape, for grouping lines that say the same of different things ("Gruber 2018: saved …", "Smith 2020: saved …"). */
export function shapeOf(text) {
  return String(text || '')
    .replace(/^[A-Z][\p{L}'’-]+(?: (?:et al\.?|and [A-Z][\p{L}'’-]+))? \d{4}[a-z]?\b/u, '‹record›')
    .replace(/(?:[\w .()-]+\/)+[\w .()-]+\.\w{2,5}/g, '‹file›')
    .replace(/\b(NCT\d{8}|10\.\d{4,}\/\S+)/g, '‹id›')
    .replace(/[\d,.]+/g, '#')
    .split(/\s+/).slice(0, 5).join(' ');
}

/**
 * The log as the page shows it (1 Nov 2026): newest first; lines in a row from the same source, of the same kind and shape (each
 * paper saved, each study settled) are one group with its count and what they touched together; routine lines (a call, a definition,
 * a line marked low) in a row are one fold. `from` keeps only that source's lines ('' every line; the card's own name its own lines).
 * Answers [{ kind: 'line', e, more: [entries], affects, at, first }] and [{ kind: 'fold', lines: [entries], at }], newest first.
 */
export function logGroups(log, { from = '', self = '', gapMs = 15 * 60000 } = {}) {
  const src = e => e.from || self;
  const lines = (log || []).filter(e => !from || src(e) === from);
  const out = [];
  for (const e of lines) {   // oldest first: a group grows forward in time
    const last = out.at(-1), t = Date.parse(e.at);
    const near = last && Number.isFinite(t) && Number.isFinite(Date.parse(last.at)) ? t - Date.parse(last.at) <= gapMs : !!last;
    if (e.low) {
      if (last?.kind === 'fold' && near) { last.lines.push(e); last.at = e.at; } else out.push({ kind: 'fold', lines: [e], at: e.at });
      continue;
    }
    if (last?.kind === 'line' && near && src(last.e) === src(e) && last.e.kind === e.kind && shapeOf(last.e.text) === shapeOf(e.text)) {
      last.more.push(last.e); last.e = e; last.at = e.at;
      for (const x of e.affects) if (!last.affects.includes(x)) last.affects.push(x);
      continue;
    }
    out.push({ kind: 'line', e, more: [], affects: [...e.affects], at: e.at, first: e.at });
  }
  return out.reverse();
}

/** The steps with why they are there and when they ran. */
function fullSteps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map(s => (typeof s === 'string' ? { name: str(s, 120), state: 'waiting', why: '', started: '', ended: '' }
    : { name: str(s?.name, 120), state: STATES.has(s?.state) ? s.state : 'waiting', why: str(s?.why, 200), started: iso(s?.started), ended: iso(s?.ended), ...stepExtras(s) })).filter(s => s.name);
}

/**
 * One card in full, or null when it is not a card or ended more than KEEP_ENDED_MS ago: { key, id, parent, tool, by, what, goal, mode,
 * state, since, updated, ended, steps, step, action, next, log, changed, summary, progress, areas }. `state` is running, ended, stopped (it
 * ended on an error) or quiet (no end and no update within its stale time: the program stopped without saying so). `step` is the step
 * running (the first, when several run), `action` what it is doing within it, `next` the steps ahead with why.
 */
export function agentOf(raw, key = '', now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = base(raw), steps = fullSteps(raw.steps), log = logOf(raw.log);
  const endAt = iso(raw.ended || raw.finished || (raw.active === false ? raw.updated || raw.since : ''));
  const updated = iso(raw.updated || raw.since) || (log.at(-1)?.at ?? '');
  const late = !updated || now - Date.parse(updated) > staleAfter(raw), need = needOf(raw);
  // open: running, waiting for the person (what they must do and where), blocked by something else (why); closed: ended, stopped, quiet
  const state = endAt ? (raw.failed ? 'stopped' : 'ended') : late ? 'quiet' : need?.kind === 'you' ? 'waiting' : need?.kind === 'blocked' ? 'blocked' : 'running';
  const last = Date.parse(endAt || updated);
  if (!isOpen({ state }) && (!Number.isFinite(last) || now - last > KEEP_ENDED_MS)) return null;
  const running = steps.filter(s => s.state === 'running'), step = running[0]?.name || '';
  // the writer joins the step and its detail ("Recording the build: Rebuilding"): the action is the part after the step
  const cur = str(raw.current, 200), action = step && cur.startsWith(`${step}: `) ? cur.slice(step.length + 2) : cur === step ? '' : cur;
  const named = new Set(steps.map(s => s.name));
  const next = [...steps.filter(s => s.state === 'waiting').map(({ name, why }) => ({ name, why })),
    ...(Array.isArray(raw.plan) ? raw.plan : []).map(p => (typeof p === 'string' ? { name: str(p, 120), why: '' } : { name: str(p?.name, 120), why: str(p?.why, 200) }))
      .filter(p => p.name && !named.has(p.name))].slice(0, PLAN_MAX);
  const done = steps.filter(s => s.state === 'done').length, total = steps.length || count(raw.total);
  const progress = isOpen({ state }) ? progressOf({ total, done: steps.length ? done : count(raw.done), current: step || cur })
    : { done: steps.length ? done : count(raw.done), total: total || null, share: null, label: '', current: '' };
  const open = isOpen({ state }) || state === 'quiet';   // a card that stopped answering keeps where it was and what was ahead
  if (!isOpen({ state }) && progress.total) progress.share = (progress.done || 0) / progress.total;
  return { key: keyOf(key), ...b, ...runExtras(raw), done: steps.length ? done : count(raw.done), total: total || null,
    goal: str(raw.goal, 400), state, updated, ended: endAt, steps, step: open ? step : '', action: open ? action : '', next: open ? next : [], log,
    changed: list(raw.changed, 200, 260), summary: str(raw.summary, 400), progress };
}

/** True while a run goes on: working, waiting for the person, or blocked (not ended, stopped or quiet). */
export const isOpen = a => a?.state === 'running' || a?.state === 'waiting' || a?.state === 'blocked';

/**
 * The cards in the order the page lists them: those at work first (oldest first), each lead followed by the agents that work for it (its
 * sub-agents, the scripts it ran), then the rest by when they last did something, newest first. Each gets `depth` (0 for a lead) and
 * `children` (how many work for it). A card whose lead is not on the page is a lead itself.
 */
export function agentTree(agents) {
  const byId = new Map(), kids = new Map();
  for (const a of agents) if (!byId.has(a.id)) byId.set(a.id, a);
  const leadOf = a => (a.parent && a.parent !== a.id && byId.has(a.parent) ? a.parent : '');
  for (const a of agents) { const p = leadOf(a); if (p) kids.set(p, [...(kids.get(p) || []), a]); }
  const last = a => a.ended || a.updated || a.since;
  const order = xs => [...xs].sort((a, b) => (isOpen(a) === isOpen(b)
    ? (isOpen(a) ? String(a.since).localeCompare(String(b.since)) : String(last(b)).localeCompare(String(last(a))))
    : isOpen(a) ? -1 : 1));
  const out = [], seen = new Set();
  const walk = (a, depth) => {
    if (seen.has(a.key)) return;
    seen.add(a.key);
    const mine = order(kids.get(a.id) || []);
    out.push({ ...a, depth, children: mine.length });
    for (const k of mine) walk(k, Math.min(depth + 1, 3));
  };
  for (const a of order(agents.filter(a => !leadOf(a)))) walk(a, 0);
  for (const a of order(agents)) walk(a, 0);   // a circle of leads (a names b, b names a): each still listed once
  return out;
}

/**
 * Every card in the folder, in full and in the page's order: { agents, problems }. `problems` names a file that could not be read
 * ({ key, reason }): one being written at the moment of the look reads on the next, so the page shows a problem only when it stays.
 */
export async function readAgents(folder, now = Date.now()) {
  const found = [], problems = [];
  if (!folder) return { agents: [], problems };
  const take = async rel => {
    let text;
    try { text = dec.decode(await folder.read(rel)); } catch { return; }   // gone between the listing and the read
    let raw;
    try { raw = JSON.parse(text); } catch { problems.push({ key: keyOf(rel), reason: 'not readable as JSON' }); return; }
    const a = agentOf(raw, rel, now);
    if (a) found.push(a);
  };
  try { const st = await folder.stat(FILE); if (st.exists && !st.dir) await take(FILE); } catch { /* no edit card */ }
  try { for (const e of (await folder.list(DIR)).filter(x => !x.dir && /\.json$/.test(x.name)).slice(0, 60)) await take(`${DIR}/${e.name}`); } catch { /* no reviewers' folder */ }
  // the same run written twice (a review moved to its own file while the old one was still current): the newer file's copy
  const seen = new Map();
  for (const a of found) { const k = `${a.by}|${a.since}`, was = seen.get(k); if (!was || String(a.updated) > String(was.updated)) seen.set(k, a); }
  return { agents: agentTree([...seen.values()]), problems };
}

/** "Claude, Codex and 2 more": who is at work, for a line that names them. */
export function namesText(agents, max = 2) {
  const names = [...new Set(agents.map(a => a.by))];
  if (names.length <= max + 1) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

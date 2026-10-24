// Another program editing the project folder says so in `.lykos/activity.json`:
//   { "active": true, "by": "Claude", "what": "Drawing Figures 1-4", "areas": ["Database", "Figures"], "since": ISO, "updated": ISO,
//     "steps": [{ "name": "Drawing Figure 1", "state": "done" }, { "name": "Drawing Figure 2", "state": "running" }, ...] }
//   or, without names, "done": 1, "total": 4, "current": "Drawing Figure 2";
// and when it is done: { "active": false, ..., "ended": ISO, "changed": ["2 Figures/Figure1.png", ...] } ("finished" is read as "ended").
// Evidence table/tools/build/build_all.py of a review writes it; tools/lykos-apply.mjs and tools/lykos-after-build.mjs through
// tools/activity-writer.mjs; any agent can (docs/Research_Project_Standard.md §3). While it is active the window says who is editing,
// what and how far (lib/agent-card.mjs), holds its own saves and does not read the folder in, so the two never overwrite each other;
// when it ends the project is read again from disk and the card says what changed. An activity not updated for STALE_MS is taken as
// ended (a script that stopped without saying so). Steps and counts are optional: an activity without them shows no count.
import { activeFolder } from './projects.mjs';
import { pollFolder } from './folder-poll.mjs';
import { setAgentEditing, agentEditing } from './agent-state.mjs';

export const FILE = '.lykos/activity.json';
export const STALE_MS = 10 * 60 * 1000;
/** How long after its end an ended activity is still news (a window opened later does not announce it). */
export const ENDED_NEWS_MS = 90 * 1000;
const STATES = new Set(['done', 'running', 'waiting']);
const listeners = new Set();
const dec = new TextDecoder();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const count = v => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : null);

/** The steps a file states, each { name, state } (an unknown state is waiting), at most 50. */
function stepsOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map(s => (typeof s === 'string' ? { name: str(s, 80), state: 'waiting' } : { name: str(s?.name, 80), state: STATES.has(s?.state) ? s.state : 'waiting' }));
}

/** Who, what and where, read the same way for a running and an ended activity. */
function base(raw) {
  const areas = (Array.isArray(raw.areas) ? raw.areas : []).map(x => String(x).trim()).filter(Boolean).slice(0, 6);
  return { by: str(raw.by, 40) || 'An agent', what: str(raw.what, 120), areas, since: String(raw.since || '') };
}

/** The activity a file states, or null when it states none that is current (ended, stale or not an activity). */
export function activityOf(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.active === false || raw.ended || raw.finished) return null;
  const t = Date.parse(raw.updated || raw.since || '');
  if (!Number.isFinite(t) || now - t > STALE_MS) return null;
  const a = base(raw), steps = stepsOf(raw.steps);
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
  return { ...base(raw), ended: new Date(t).toISOString(), changed, total: stepsOf(raw.steps).length || count(raw.total) || null };
}

/** True when the editor is Claude (its name as agents write it: "Claude", "Claude Code", "Claude (Opus)"): the card shows its mark. */
export const isClaude = by => /^claude\b/i.test(String(by || '').trim());

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
  return `${a.by} is updating ${areaList(a.areas)}`;
}

/** What it is doing, in plain words: its own `what` ("Drawing Figures 1–4"), else "Updating the figures". */
export function activityHeadline(a) {
  if (!a) return '';
  return a.what ? ranges(a.what) : `Updating ${areaList(a.areas)}`;
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
  const what = ranges(e.what), [first = '', ...rest] = what.split(' '), colon = first.endsWith(':') ? ':' : '', past = pastOf(first.replace(/:$/, ''));
  if (past) return `${past.charAt(0).toUpperCase()}${past.slice(1)}${colon}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  if (what) return `Finished: ${what}`;
  return `Updated ${areaList(e.areas)}`;
}

/** "Claude drew Figures 1–4 from the database": the same with who, for the announcement. */
export function endedHeadline(e) {
  if (!e) return '';
  const w = endedWhat(e);
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

let lastKey = '[null,null]';
/** Reads the file once and tells the listeners when what it states changed (exported for the tests; the watcher calls it). */
export async function lookOnce(now = Date.now()) {
  const folder = activeFolder();
  let next = null, ended = null;
  if (folder) {
    try {
      const st = await folder.stat(FILE);
      if (st.exists && !st.dir) { const raw = JSON.parse(dec.decode(await folder.read(FILE))); next = activityOf(raw, now); ended = next ? null : endedOf(raw, now); }
    } catch { next = null; ended = null; }
  }
  const key = JSON.stringify([next, ended]);
  if (key === lastKey) return;
  lastKey = key;
  const prev = agentEditing();
  if (JSON.stringify(prev) !== JSON.stringify(next)) setAgentEditing(next);
  for (const fn of [...listeners]) { try { fn(next, prev, ended); } catch { /* one listener does not stop the next */ } }
}

let stop = null;
/** Starts looking at the open folder every few seconds (idempotent). */
export function watchAgentActivity(every = 3000) { if (!stop) stop = pollFolder(() => lookOnce(), every); return stop; }

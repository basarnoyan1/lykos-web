// The submission tracker (scratchpad plan SUBMISSIONS.md; views/submissions.mjs draws it): each journal the manuscript went to, what
// the journal decided and when, and the next step. One attempt is one journal:
//
//   { id, v: 1, journal: { id, label }, manuscriptId, system, file: { rel, name } | null, coverLetter: { rel, name } | null,
//     chaseOn: 'YYYY-MM-DD' | '', chaseTaskId, notes, events: [{ id, at, kind, ...extra }] }
//
// The status of an attempt is the kind of its last event (no separate status field: one source of truth). Dates are days, never
// times: a journal's decision has a date, not a clock. Elapsed days are computed from a `today` the caller passes, never stored.
// state.submissions is read through normaliseSubmissions on load (store.mjs); absent or malformed is an empty list, and an item
// keeps every key it does not know, so an older app never loses what a newer one wrote.
//
// Nothing here writes on its own: a person's dialog or an accepted proposal does (lib/submission-proposals.mjs). No web lookups,
// no status changed by time. Pure: no store, no clock (ids and the time come in through `opts`).
import { makeTask, normaliseTask, patchTask } from './tasks.mjs';
import { day, plural } from './dates.mjs';

/** Event kinds and their words, in the order the Record outcome menu lists them. No submission-system status words (owner, 2026-10-11). */
export const KINDS = Object.freeze([
  ['planned', 'Planned'], ['submitted', 'Submitted'], ['revise', 'Revision requested'], ['revised', 'Revision sent'],
  ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'], ['published', 'Published'],
]);
const WORD = Object.fromEntries(KINDS);
/** An attempt whose last event is one of these is over: nothing is chased, nothing is due. */
const CLOSED = new Set(['rejected', 'withdrawn', 'accepted', 'published']);
/** An attempt that ended without the paper: the next journal is chosen after it. */
export const ENDED = new Set(['rejected', 'withdrawn']);
const SENT = new Set(['submitted', 'revised']);
const LETTER_KINDS = new Set(['revise', 'rejected', 'accepted']);
export const LETTER_MAX = 100000;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day as YYYY-MM-DD, or ''. */
export function dayOf(v) {
  const m = DAY_RE.exec(String(v ?? '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
const utc = d => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
/** Whole days from one day to another (negative when `to` is earlier), or null when either is not a day. */
const daysBetween = (from, to) => {
  const a = dayOf(from), b = dayOf(to);
  return a && b ? Math.round((utc(b) - utc(a)) / 86400000) : null;
};
const text = (v, max = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const nameOfRel = rel => String(rel).slice(String(rel).lastIndexOf('/') + 1);
/** A file of the project folder as { rel, name }, or null. Nothing is copied: the reference points into the folder. */
export function fileRef(x) {
  if (!x || typeof x !== 'object' || typeof x.rel !== 'string' || !x.rel.trim()) return null;
  return { rel: x.rel, name: typeof x.name === 'string' && x.name ? x.name : nameOfRel(x.rel) };
}
const journalOf = j => {
  if (typeof j === 'string') return { id: '', label: text(j, 200).trim() };
  if (!j || typeof j !== 'object') return { id: '', label: '' };
  return { id: text(j.id, 120), label: text(j.label, 200).trim() };
};

function normaliseEvent(e, i) {
  if (!e || typeof e !== 'object' || !WORD[e.kind]) return null;
  const out = { ...e, id: text(e.id, 80) || `e${i + 1}`, kind: e.kind, at: dayOf(e.at) };
  delete out.desk;
  if (e.kind === 'rejected' && e.desk === true) out.desk = true;
  if ('due' in e) out.due = dayOf(e.due);
  for (const k of ['note', 'roundId', 'doi', 'taskId']) if (k in e) out[k] = text(e[k], 400);
  if ('letter' in e) out.letter = text(e.letter, LETTER_MAX);
  if ('file' in e) out.file = fileRef(e.file);
  return out;
}
/** An attempt as this version reads it, every field present; other fields kept as they were. Null for something that is not one. */
export function normaliseAttempt(x, i = 0) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const events = (Array.isArray(x.events) ? x.events : []).map(normaliseEvent).filter(Boolean);
  return {
    ...x, id: text(x.id, 80) || `sb${i + 1}`, v: 1, journal: journalOf(x.journal),
    manuscriptId: text(x.manuscriptId, 200), system: text(x.system, 200),
    file: fileRef(x.file), coverLetter: fileRef(x.coverLetter),
    chaseOn: dayOf(x.chaseOn), chaseTaskId: text(x.chaseTaskId, 80), notes: text(x.notes, 4000),
    // history reads down: oldest first; a day-less event stays where it was put among the others of no day
    events: events.map((e, n) => [e, n]).sort((a, b) => (a[0].at || '').localeCompare(b[0].at || '') || a[1] - b[1]).map(([e]) => e),
  };
}
/** state.submissions as this version reads it: always a list. */
export const normaliseSubmissions = list => (Array.isArray(list) ? list : []).map(normaliseAttempt).filter(Boolean);

/** The word for an event: a rejection without review says so. */
export const wordOf = e => (e?.kind === 'rejected' && e.desk ? 'Rejected without review' : WORD[e?.kind] || '');
/** Where one attempt stands: the kind of its last event, its word and day. */
export function statusOf(a) {
  const last = a?.events?.at?.(-1);
  return last ? { kind: last.kind, word: wordOf(last), at: last.at || '', desk: !!last.desk } : { kind: '', word: '', at: '', desk: false };
}
export const isClosed = a => CLOSED.has(statusOf(a).kind);
const label = a => a?.journal?.label || 'Untitled journal';
const startOf = a => a?.events?.find(e => e.at)?.at || '';
/** The attempts newest first: by the day each began, then the order they were added. */
export function ordered(list) {
  const all = normaliseSubmissions(list);
  return all.map((a, i) => [a, i]).sort((x, y) => (startOf(y[0]) || '').localeCompare(startOf(x[0]) || '') || y[1] - x[1]).map(([a]) => a);
}
/** The attempt the paper is in now: the latest that is not rejected or withdrawn, else the latest. */
export function current(list) {
  const all = ordered(list);
  return all.find(a => !ENDED.has(statusOf(a).kind)) || all[0] || null;
}
/** Days since the manuscript last went to the journal (submitted or revision sent); null when the attempt is closed, planned or undated. */
export function elapsedDays(a, today) {
  if (!a || isClosed(a)) return null;
  const sent = [...(a.events || [])].reverse().find(e => SENT.has(e.kind));
  if (!sent?.at) return null;
  const n = daysBetween(sent.at, today);
  return n == null || n < 0 ? null : n;
}
/** The revision a journal asked for and not yet sent back: the last revise event with no revised after it. */
export function openRevision(a) {
  const ev = a?.events || [];
  for (let i = ev.length - 1; i >= 0; i--) {
    if (ev[i].kind === 'revised') return null;
    if (ev[i].kind === 'revise') return ev[i];
  }
  return null;
}

/** The head's one line: "Submitted · Neuro-Oncology · 42 d", "Rejected without review · 2 journals", "Published · 10.1093/…", or ''. */
export function summaryLine(list, today) {
  const all = normaliseSubmissions(list);
  const a = current(all);
  if (!a) return '';
  const st = statusOf(a);
  if (!st.kind) return label(a);
  if (ENDED.has(st.kind)) return `${st.word} · ${all.length > 1 ? plural(all.length, 'journal') : label(a)}`;
  if (st.kind === 'published') return `Published · ${a.events.at(-1).doi || label(a)}`;
  if (st.kind === 'accepted' || st.kind === 'planned') return `${st.word} · ${label(a)}`;
  const rev = openRevision(a);
  if (st.kind === 'revise') return `${st.word} · ${label(a)}${rev?.due ? ` · due ${day(rev.due, today)}` : ''}`;
  const n = elapsedDays(a, today);
  return `${st.word} · ${label(a)}${n == null ? '' : ` · ${n} d`}`;
}
/** Status words by key for other readers (All projects): the event kinds, and 'rejected-desk' for a rejection without review. */
export const STATUS_LABELS = Object.freeze({ ...WORD, 'rejected-desk': 'Rejected without review' });
/**
 * Where the paper stands, as data for a project summary (lib/dashboard.mjs): { journal, status, since, due, last, doi } of the current
 * attempt, or null with none. `status` is a key of STATUS_LABELS; `since` the day it was last sent (submitted or revision sent); `due` the
 * open revision's due day; `last` the day of the last event; `doi` once published. Dates are days, ''-filled when absent.
 */
export function submissionSummary(list, today) {
  const a = current(list);
  if (!a) return null;
  const st = statusOf(a), sent = [...a.events].reverse().find(e => SENT.has(e.kind));
  return { journal: label(a), status: st.kind === 'rejected' && st.desk ? 'rejected-desk' : st.kind, since: sent?.at || '',
    due: openRevision(a)?.due || '', last: st.at, doi: st.kind === 'published' ? a.events.at(-1).doi || '' : '', line: summaryLine(list, today) };
}
/** The Overview's Submission stage: { state: 'todo' | 'active' | 'done', line }. */
export function stageOf(list, today) {
  const all = normaliseSubmissions(list);
  if (!all.length) return { state: 'todo', line: 'Not submitted' };
  const k = statusOf(current(all)).kind;
  return { state: k === 'accepted' || k === 'published' ? 'done' : 'active', line: summaryLine(all, today) };
}

/**
 * What needs a person, for the Overview (lib/progress.mjs unresolved()): a revision due or overdue (block), a chase day reached and a
 * decision letter not read into comments (gap). Only open attempts: a closed one asks for nothing. Nothing on elapsed time alone.
 * Each is { severity, view: 'submissions', text, attemptId, go? }.
 */
export function attentionItems(list, today) {
  const out = [];
  for (const a of normaliseSubmissions(list)) {
    if (isClosed(a)) continue;
    const rev = openRevision(a);
    const left = rev?.due ? daysBetween(today, rev.due) : null;
    if (left != null) out.push({ severity: 'block', view: 'submissions', attemptId: a.id,
      text: left > 0 ? `Revision due in ${plural(left, 'day')}` : left === 0 ? 'Revision due today' : `Revision overdue by ${plural(-left, 'day')}` });
    const wait = a.chaseOn ? daysBetween(a.chaseOn, today) : null;
    if (wait != null && wait >= 0 && statusOf(a).kind !== 'planned') out.push({ severity: 'gap', view: 'submissions', attemptId: a.id, text: `Chase ${label(a)} (planned ${day(a.chaseOn, today)})` });
    const unread = [...a.events].reverse().find(e => LETTER_KINDS.has(e.kind) && e.letter?.trim() && !e.roundId);
    if (unread) out.push({ severity: 'gap', view: 'submissions', attemptId: a.id, go: 'submissions:read', text: 'Decision letter not read' });
  }
  return out;
}

// ---- edits (each returns a new list; the view and the proposal handler both use them) ----------------------------------------
const idsOf = opts => ({ newId: opts?.newId || (p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`), now: opts?.now || (() => new Date().toISOString()) });
const cleanEvent = (e, newId) => {
  if (!e || !WORD[e.kind]) throw new Error(`Unknown event kind${e?.kind ? ` "${String(e.kind).slice(0, 40)}"` : ''}. Use one of: ${KINDS.map(([k]) => k).join(', ')}.`);
  const out = normaliseEvent({ ...e, id: e.id || newId('e') }, 0);
  for (const k of Object.keys(out)) if (out[k] === '' && k !== 'at') delete out[k];
  if (out.file === null) delete out.file;
  return out;
};
/** A new attempt with its first event (submitted, or planned for a journal chosen next). */
export function addAttempt(list, { journal, at = '', kind = 'submitted', manuscriptId = '', system = '', file = null, coverLetter = null } = {}, opts) {
  const { newId } = idsOf(opts);
  const a = normaliseAttempt({ id: newId('sb'), journal, manuscriptId, system, file, coverLetter, events: [cleanEvent({ kind, at }, newId)] });
  return [...normaliseSubmissions(list), a];
}
/** Adds an event to an attempt, kept in date order. */
export function addEvent(list, attemptId, event, opts) {
  const { newId } = idsOf(opts);
  const e = cleanEvent(event, newId);
  return normaliseSubmissions(list).map(a => a.id === attemptId ? normaliseAttempt({ ...a, events: [...a.events, e] }) : a);
}
export const patchAttempt = (list, attemptId, patch) => normaliseSubmissions(list).map(a => a.id === attemptId ? normaliseAttempt({ ...a, ...patch, id: a.id }) : a);
export const patchEvent = (list, attemptId, eventId, patch) => normaliseSubmissions(list).map(a => a.id !== attemptId ? a
  : normaliseAttempt({ ...a, events: a.events.map(e => e.id === eventId ? { ...e, ...patch, id: e.id } : e) }));
export const removeEvent = (list, attemptId, eventId) => normaliseSubmissions(list).map(a => a.id !== attemptId ? a : normaliseAttempt({ ...a, events: a.events.filter(e => e.id !== eventId) }));
/** Removes an attempt. Its review rounds stay in reviewRounds (only the link goes); its open tasks go at the next syncTasks. */
export const removeAttempt = (list, attemptId) => normaliseSubmissions(list).filter(a => a.id !== attemptId);

// ---- tasks (lib/tasks.mjs): the chase and the revision, real tasks on the Tasks page -------------------------------------------
/**
 * Keeps the two kinds of task a submission makes in the to-do list: "Chase <journal> about <id>" due on chaseOn, and "Send revision to
 * <journal>" due on the open revision's due day. A changed day patches the task's due; a cleared one removes the open task; a task ticked
 * done clears chaseOn (the attempt keeps chaseTaskId, so a second tick never makes a second task); a revision sent marks its task done;
 * an attempt closed or removed loses its open tasks. Returns { todos, submissions }, new lists; the inputs are not touched.
 * The view and the proposal handler call it after every change of state.submissions, and the shell after the to-do list changes.
 */
export function syncTasks(list, todos, opts) {
  const { newId, now } = idsOf(opts);
  const subs = normaliseSubmissions(list).map(a => structuredClone(a));
  let tasks = (Array.isArray(todos) ? todos : []).filter(t => t && typeof t === 'object').map(t => ({ ...t }));
  const byId = id => tasks.find(t => t.id === id) || null;
  const drop = id => { tasks = tasks.filter(t => t.id !== id); };
  const owned = new Set();
  const ensure = (task, want, link) => {
    const make = () => {
      const t = makeTask({ text: want.text, due: want.due, link }, { id: newId('t'), at: now() });
      t.submissionId = want.submissionId; t.submissionTask = want.kind;
      tasks.push(t); owned.add(t.id); return t;
    };
    if (!task) return make();
    owned.add(task.id);
    if (!task.done && (task.due !== want.due || task.text !== want.text)) patchTask(tasks, task.id, { due: want.due, text: want.text });
    return task;
  };
  for (const a of subs) {
    const name = label(a), link = { view: 'submissions', label: name }, closed = isClosed(a);
    // the chase
    const chase = a.chaseTaskId ? byId(a.chaseTaskId) : null;
    if (chase?.done) { owned.add(chase.id); a.chaseOn = ''; }
    else if (a.chaseOn && !closed) a.chaseTaskId = ensure(chase, { text: a.manuscriptId ? `Chase ${name} about ${a.manuscriptId}` : `Chase ${name}`, due: a.chaseOn, submissionId: a.id, kind: 'chase' }, link).id;
    else if (chase) drop(chase.id);
    // the revision
    for (const e of a.events.filter(x => x.kind === 'revise')) {
      const t = e.taskId ? byId(e.taskId) : null, open = openRevision(a) === e;
      if (t?.done) { owned.add(t.id); continue; }
      if (open && e.due && !closed) e.taskId = ensure(t, { text: `Send revision to ${name}`, due: e.due, submissionId: a.id, kind: 'revision' }, link).id;
      else if (t && !open && !closed) { owned.add(t.id); patchTask(tasks, t.id, { done: true }, { now: () => new Date(now()) }); }
      else if (t) drop(t.id);
    }
  }
  // a task this tracker made for an attempt that is gone (or no longer wants it) goes while it is open
  tasks = tasks.filter(t => !t.submissionId || owned.has(t.id) || normaliseTask(t).done);
  return { todos: tasks, submissions: subs };
}

// ---- the assistant (lib/submission-proposals.mjs files them; lib/chat-tools.mjs exposes them) ----------------------------------
/** The attempts for list_submissions: status, dates, events; letters cut to 2,000 characters. */
export function listForAssistant(list, today) {
  const all = ordered(list);
  return {
    summary: summaryLine(all, today), total: all.length,
    items: all.map(a => ({ id: a.id, journal: label(a), manuscript_id: a.manuscriptId, system: a.system, status: statusOf(a).word,
      file: a.file?.name || '', chase_on: a.chaseOn, elapsed_days: elapsedDays(a, today),
      events: a.events.map(e => ({ id: e.id, kind: e.kind, word: wordOf(e), at: e.at, ...(e.due ? { due: e.due } : {}), ...(e.note ? { note: e.note } : {}),
        ...(e.doi ? { doi: e.doi } : {}), ...(e.letter ? { letter: e.letter.length > 2000 ? `${e.letter.slice(0, 2000)}…` : e.letter } : {}), ...(e.roundId ? { read_into_round: true } : {}) })) })),
    note: 'Recorded by the person. Nothing here was looked up; a proposal needs the quoted email or letter.',
  };
}
/**
 * Validates an assistant's proposal { attemptId?, journal?, event: { kind, at, due?, doi?, note?, letter?, desk? }, source } against the
 * list. Returns { error } with the reason, or { data, label, detail } where data is what applyProposal writes (never chaseOn: a follow-up
 * date is the person's decision) and label reads "Submission · Neuro-Oncology · Rejected · 3 Oct".
 */
export function proposalFor(payload, list, today) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const source = text(p.source, 4000).trim();
  const e = p.event && typeof p.event === 'object' ? p.event : {};
  if (!WORD[e.kind]) return { error: `Unknown event kind "${text(e.kind, 40)}". Use one of: ${KINDS.map(([k]) => k).join(', ')}.` };
  const at = dayOf(e.at);
  if (!at) return { error: 'The event needs its date as YYYY-MM-DD, as the letter or email states it. Do not infer a date.' };
  if (dayOf(today) && at > dayOf(today)) return { error: 'The date is in the future. A decision has happened; use the date the letter or email states.' };
  if ('due' in e && e.due && !dayOf(e.due)) return { error: 'The response due date must be YYYY-MM-DD.' };
  if (source.length < 3) return { error: 'Quote the email or letter the person gave in this chat as source.' };
  const all = normaliseSubmissions(list);
  const a = p.attemptId ? all.find(x => x.id === p.attemptId) : null;
  if (p.attemptId && !a) return { error: `No submission "${text(p.attemptId, 40)}"; use an id from list_submissions.` };
  const journal = a ? a.journal : journalOf(p.journal);
  if (!a && !journal.label) return { error: 'Name the journal for a new submission, or give attemptId from list_submissions.' };
  const event = { kind: e.kind, at };
  if (e.kind === 'rejected' && e.desk === true) event.desk = true;
  if (dayOf(e.due) && e.kind === 'revise') event.due = dayOf(e.due);
  for (const k of ['note', 'doi']) if (typeof e[k] === 'string' && e[k].trim()) event[k] = text(e[k], 400).trim();
  if (typeof e.letter === 'string' && e.letter.trim()) event.letter = text(e.letter, LETTER_MAX);
  const data = { ...(a ? { attemptId: a.id } : { journal }), event, source };
  return { data, label: `Submission · ${journal.label} · ${wordOf(event)} · ${day(at, today)}`, detail: source };
}
/** Writes an accepted proposal: an event on its attempt, or a new attempt starting with it. */
export function applyProposal(list, data, opts) {
  if (data?.attemptId) {
    if (!normaliseSubmissions(list).some(a => a.id === data.attemptId)) throw new Error('That submission was removed. Ask for an updated proposal.');
    return addEvent(list, data.attemptId, data.event, opts);
  }
  const { newId } = idsOf(opts);
  const a = normaliseAttempt({ id: newId('sb'), journal: data.journal, events: [cleanEvent(data.event, newId)] });
  return [...normaliseSubmissions(list), a];
}

// What a project has coming up, small enough to keep for every project on
// this machine, and the cross-project list the start screen and All projects
// draw from it (amendment "Workspace: backup, dashboard, tasks, timeline and
// translation").
//
// A project in the app's storage can be read without opening it; a folder
// project cannot (its folder may need permission, or be on a drive that is
// not connected), so each save keeps this summary of the open project and a
// folder project is shown as it was when it was last open, with that date.
// Nothing here goes to the network. Pure.
import { dueTasks, normaliseTasks } from './tasks.mjs';
import { deadlines as ethicsDeadlines } from './governance-state.mjs';
import { addMonths, normaliseMilestones } from './timeline.mjs';
import { researchType } from './workflow.mjs';

export const SUMMARY_VERSION = 2;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const day = v => { const m = DAY.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const words = s => (s.manuscript?.blocks || []).reduce((a, b) => a + String(b?.text || '').split(/\s+/).filter(Boolean).length, 0);

/**
 * The summary of one project: its name and type, a few counts, and what is
 * due — open tasks with dates, ethics deadlines, the registry results date and
 * the researcher's milestones — within `within` days (overdue included), at
 * most `limit` items, soonest first. Open tasks without a date are counted
 * and the first few kept as open work.
 */
export function summarizeProject(state, { today = new Date().toISOString().slice(0, 10), within = 120, limit = 12, extras = {} } = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const horizon = addDays(today, within);
  const items = [];
  const push = (date, text, kind, view, extra = {}) => { if (date && date <= horizon) items.push({ date, text: String(text).slice(0, 160), kind, view, ...extra }); };
  for (const t of dueTasks(s.todos)) push(t.due, t.text, 'task', 'tasks', t.priority !== 'none' ? { priority: t.priority } : {});
  let ethicsExpiry = '';
  if (s.ethics && typeof s.ethics === 'object') {
    ethicsExpiry = day(s.ethics.expiresAt);
    for (const d of ethicsDeadlines(s.ethics, new Date(`${today}T12:00:00Z`), { within })) if (d.due) push(d.due, d.text, 'ethics', 'protocol:ethics');
  }
  const completion = day(s.registration?.dates?.primaryCompletionAt);
  const resultsDue = completion ? addMonths(completion, 12) : '';
  if (resultsDue && !s.registration?.dates?.resultsPostedAt) push(resultsDue, 'Results due on the registry (12 months after primary completion)', 'registration', 'protocol:registration');
  for (const m of normaliseMilestones(s.milestones)) if (m.date && !m.done && (m.end || m.date) >= addDays(today, -30)) push(m.date, m.label, 'milestone', 'tasks');
  items.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));
  const open = normaliseTasks(s.todos).filter(t => !t.done);
  return {
    v: SUMMARY_VERSION,
    name: String(s.project?.name || s.paper?.title || '').slice(0, 160),
    type: s.project?.researchType ? researchType(s).label : '',
    savedAt: Number(s.savedAt) || 0,
    records: (s.papers || []).length,
    datasets: (s.datasets || []).length,
    words: words(s),
    openTasks: open.length,
    openWork: open.filter(t => !t.due).slice(0, 3).map(t => ({ text: t.text.slice(0, 160), ...(t.priority !== 'none' ? { priority: t.priority } : {}) })),
    ethicsExpiry, resultsDue,
    due: items.slice(0, limit),
    ...progressOf(extras),
  };
}

// ---- version 2: where the work stands (All projects, plans PORTFOLIO.md §2) -----------------------------------------------------
// The heavy inputs (lib/progress.mjs stages, unresolved and recentActivity; lib/submissions.mjs submissionSummary) are computed by the
// caller (lib/dashboard.mjs fullSummary) and handed in as `extras`, so this module stays pure and a summary is never computed on paint.
const COUNT = /^(\d[\d,]*)(?:\s+of\s+(\d[\d,]*))?(?:\s+([A-Za-z][\w-]*))?/;
const toInt = v => (v == null ? null : Number(String(v).replace(/,/g, '')));
/** A stage's one line read as numbers: "41 of 120" → n 41, of 120; "1840 words" → n 1840, unit 'words'; "Not started" → n null. */
export function stageCount(line) {
  const m = COUNT.exec(String(line ?? '').trim());
  if (!m) return { n: null, of: null, unit: '' };
  return { n: toInt(m[1]), of: m[2] ? toInt(m[2]) : null, unit: m[2] ? '' : String(m[3] || '').slice(0, 24) };
}
const STATES = new Set(['todo', 'active', 'done']);
const str = (v, max = 160) => String(v ?? '').slice(0, max);
function progressOf({ stages = [], attention = [], recent = [], submission = null } = {}) {
  const st = (Array.isArray(stages) ? stages : []).filter(x => x && x.key).map(x => ({ key: str(x.key, 40), name: str(x.name, 60), state: STATES.has(x.state) ? x.state : 'todo', ...stageCount(x.line) }));
  const current = (st.find(x => x.state !== 'done') || st.at(-1))?.key || '';
  const sub = submission && typeof submission === 'object' && submission.status ? Object.fromEntries(['journal', 'status', 'since', 'due', 'last', 'doi'].map(k => [k, str(submission[k], 200)])) : null;
  return {
    stages: st, current,
    attention: (Array.isArray(attention) ? attention : []).filter(x => x?.text).slice(0, 3).map(x => ({ text: str(x.text), view: str(x.view, 60), severity: x.severity === 'block' ? 'block' : 'gap' })),
    recent: (Array.isArray(recent) ? recent : []).filter(x => x?.text).slice(0, 5).map(x => ({ text: str(x.text), at: str(x.at, 40), view: str(x.view, 60) })),
    submission: sub,
  };
}

/** Whether a stored value is a summary this version reads: version 2, or a version 1 kept before it (read with no stages and no submission). */
export const isSummary = x => !!x && typeof x === 'object' && (x.v === 1 || x.v === SUMMARY_VERSION) && Array.isArray(x.due);
/** A stored summary in the shape of this version: a version 1 gains empty stages, attention and recent and a null submission. */
export const asCurrent = x => (isSummary(x) ? { stages: [], current: '', attention: [], recent: [], submission: null, ...x } : null);

/**
 * The cross-project list from `[{ id, name, where, summary, stale? }]`: every
 * dated item, overdue first then soonest, then each project's undated open
 * work. Each row `{ projectId, project, where, date, text, kind, view, overdue, stale }`.
 */
export function dashboardRows(entries, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const dated = [], undated = [];
  for (const e of entries || []) {
    if (!isSummary(e.summary)) continue;
    const base = { projectId: e.id, project: e.name || e.summary.name || 'Untitled project', where: e.where || '', stale: Boolean(e.stale) };
    for (const d of e.summary.due) dated.push({ ...base, date: d.date, text: d.text, kind: d.kind, view: d.view, priority: d.priority || '', overdue: d.date < today });
    for (const w of e.summary.openWork || []) undated.push({ ...base, date: '', text: w.text, kind: 'task', view: 'tasks', priority: w.priority || '', overdue: false });
  }
  const PR = { high: 0, low: 1, '': 2 };
  dated.sort((a, b) => (b.overdue - a.overdue) || a.date.localeCompare(b.date) || a.project.localeCompare(b.project));
  undated.sort((a, b) => PR[a.priority] - PR[b.priority] || a.project.localeCompare(b.project));
  return [...dated, ...undated];
}

/** One line per project for All projects: counts and the next dated item. */
export function projectLine(summary, today = new Date().toISOString().slice(0, 10)) {
  if (!isSummary(summary)) return '';
  const next = summary.due.find(d => d.date >= today);
  const overdue = summary.due.filter(d => d.date < today).length;
  return [
    `${summary.records} ${summary.records === 1 ? 'record' : 'records'}`,
    summary.openTasks ? `${summary.openTasks} open ${summary.openTasks === 1 ? 'task' : 'tasks'}` : '',
    overdue ? `${overdue} overdue` : '',
    summary.words ? `${summary.words.toLocaleString('en')} words` : '',
    next ? `next ${next.date}` : '',
  ].filter(Boolean).join(', ');
}

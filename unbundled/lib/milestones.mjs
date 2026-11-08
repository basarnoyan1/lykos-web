// The project's milestones and dates, without the chart (moved out of lib/timeline.mjs on 28 October 2026, which re-exports them): the store's
// normalisers and the Overview's summary read these, and need not load the figure drawing.
import { normaliseTasks } from './tasks.mjs';
import { isPrimaryType } from './research-types.mjs';

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
export const day = v => { const m = DAY.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
export const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date `months` later, clamped to the month's last day (31 Jan + 1 = 28/29 Feb). */
export function addMonths(iso, months) {
  const d = day(iso); if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  const tm = m - 1 + months, ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, mm + 1, 0)).getUTCDate();
  return `${ty}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}
export const ms = iso => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 864e5);

/** Labels a new project's researcher is offered as milestones of their own, by kind of study. */
export function suggestedMilestones(state) {
  return isPrimaryType(state?.project?.researchType)
    ? ['Recruitment start', 'Recruitment end', 'Database lock', 'Analysis', 'Submission']
    : ['Protocol registered', 'Searches complete', 'Screening complete', 'Analysis', 'Submission'];
}

/**
 * Milestones the project already records, as `{ id, label, date, source, view }`,
 * every one read-only here.
 */
export function knownMilestones(state) {
  const s = obj(state), out = [];
  const add = (id, label, date, source, view) => { const d = day(date); if (d) out.push({ id: `known:${id}`, label, date: d, source, view, known: true }); };
  const e = obj(s.ethics);
  add('ethics-approved', 'Ethics approval', e.approvedAt, 'Ethics record', 'protocol:ethics');
  add('ethics-expiry', 'Ethics expiry', e.expiresAt, 'Ethics record', 'protocol:ethics');
  add('ethics-report', 'Annual ethics report', e.annualReportDue, 'Ethics record', 'protocol:ethics');
  (Array.isArray(e.amendments) ? e.amendments : []).forEach((a, i) => add(`amendment-${i}`, `Amendment ${i + 1} approved`, a?.approvedAt, 'Ethics record', 'protocol:ethics'));
  const r = obj(obj(s.registration).dates);
  add('registered', 'Registration', r.registeredAt, 'Registration', 'protocol:registration');
  add('first-enrolment', 'First enrolment', r.firstEnrolmentAt, 'Registration', 'protocol:registration');
  add('primary-completion', 'Primary completion', r.primaryCompletionAt, 'Registration', 'protocol:registration');
  // The registry deadline for results: primary completion plus 12 months (as Registration says).
  if (day(r.primaryCompletionAt)) add('results-due', 'Results due', addMonths(r.primaryCompletionAt, 12), 'Registration', 'protocol:registration');
  const allocated = (Array.isArray(s.allocationLog) ? s.allocationLog : []).filter(x => x?.action === 'allocate' && day(x.at)).map(x => day(x.at)).sort();
  if (allocated.length) {
    add('first-allocation', 'First allocation', allocated[0], 'Allocation', 'analysis');
    if (allocated.length > 1) add('latest-allocation', 'Latest allocation', allocated.at(-1), 'Allocation', 'analysis');
  }
  const searches = (Array.isArray(s.searches) ? s.searches : []).filter(x => day(x?.at) && !x.imported).map(x => day(x.at)).sort();
  if (searches.length) add('last-search', 'Latest search', searches.at(-1), 'Literature', 'search');
  add('analysis', 'Analysis run', s.analysis?.at || s.survival?.at, 'Analysis', 'analysis');
  (Array.isArray(s.reviewRounds) ? s.reviewRounds : []).forEach((x, i) => add(`round-${i}`, `Reviewer comments ${i + 1}${x?.journal ? `: ${x.journal}` : ''}`, x?.at, 'Response to reviewers', 'manuscript'));
  return out;
}

/** The researcher's milestones, cleaned: a label and a date each, an end only after the start. */
export function normaliseMilestones(list) {
  return (Array.isArray(list) ? list : []).filter(m => m && typeof m === 'object' && String(m.label || '').trim()).map(m => {
    const date = day(m.date), end = day(m.end);
    return { id: String(m.id || `m${Math.random().toString(36).slice(2, 8)}`), label: String(m.label).trim().slice(0, 120), date, ...(end && date && end > date ? { end } : {}), ...(m.done ? { done: true } : {}) };
  });
}

/**
 * Everything the chart draws, soonest first: known milestones, the
 * researcher's (undated ones are listed, not drawn), and tasks with both a
 * start and a due date as bars. `{ id, label, date, end?, source, kind, done? }`.
 */
export function timelineItems(state) {
  const s = obj(state);
  const known = knownMilestones(s).map(m => ({ ...m, kind: 'milestone' }));
  const own = normaliseMilestones(s.milestones).map(m => ({ ...m, kind: m.end ? 'span' : 'milestone', source: 'Milestone', own: true }));
  const tasks = normaliseTasks(s.todos).filter(t => t.start && t.due && t.due >= t.start)
    .map(t => ({ id: `task:${t.id}`, label: t.text, date: t.start, end: t.due, kind: 'task', source: 'Task', done: t.done, taskId: t.id }));
  return [...known, ...own, ...tasks].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.label.localeCompare(b.label));
}

/** Slippage of an open milestone whose date has passed: days late, else 0. */
export const daysLate = (m, today) => (!m?.date || m.done || m.known ? 0 : Math.max(0, daysBetween(m.end || m.date, today)));


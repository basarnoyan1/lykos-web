// The project timeline: milestones the project already records (ethics,
// registration, allocation, reviewer rounds, the last search and analysis),
// the researcher's own milestones, and tasks with a start and a due date,
// drawn as a Gantt-style chart over months (amendment "Workspace: backup,
// dashboard, tasks, timeline and translation").
//
// Nothing is forecast: a milestone is a date someone entered or a date the
// project logged. Dates the project holds are read-only here and name where
// they come from; changing one is done where it is kept.
//
//   state.milestones  [{ id, label, date, end?, done? }]   the researcher's own
//
// The SVG is self-contained (house style: grey bars, a dashed rule for today,
// labels wrapped or keyed), like lib/charts.mjs: the same drawing on screen and exported. Pure.
import { figureTokens } from './figure-style.mjs';
import { esc, r1, svgRoot, text, lines, labelColumn, rowHeight, sourceBlock, keyLines, axisLine, hairLine, measure } from './figure-draw.mjs';
import { normaliseTasks } from './tasks.mjs';
import { isPrimaryType } from './research-types.mjs';

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const day = v => { const m = DAY.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date `months` later, clamped to the month's last day (31 Jan + 1 = 28/29 Feb). */
export function addMonths(iso, months) {
  const d = day(iso); if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  const tm = m - 1 + months, ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, mm + 1, 0)).getUTCDate();
  return `${ty}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}
const ms = iso => Date.parse(`${iso}T00:00:00Z`);
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

/**
 * The months a chart spans: from the first of the month of the earliest date
 * (today included) to the first of the month after the latest, at least
 * `min` months. `{ from, to }` as ISO days.
 */
export function timelineRange(dates, today, { min = 6 } = {}) {
  const all = [...dates.map(day).filter(Boolean), day(today)].filter(Boolean).sort();
  const from = `${all[0].slice(0, 7)}-01`;
  let to = addMonths(`${all.at(-1).slice(0, 7)}-01`, 1);
  while (monthsBetween(from, to) < min) to = addMonths(to, 1);
  return { from, to };
}
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * Month boundaries from `from` to `to` (both firsts of a month), each with the
 * label drawn under it: every month when there are 12 or fewer, else every
 * 3rd, 6th or 12th, chosen so at most 12 carry a label. A label names the year
 * on the first labelled tick and on each January.
 */
export function monthTicks(from, to) {
  const n = monthsBetween(from, to), step = n <= 12 ? 1 : n <= 36 ? 3 : n <= 72 ? 6 : 12;
  const out = [];
  let first = true;
  for (let i = 0; i <= n; i++) {
    const iso = addMonths(from, i), [y, m] = iso.split('-').map(Number);
    const labelled = step === 1 || (m - 1) % step === 0;
    out.push({ iso, label: labelled ? `${MONTHS[m - 1]}${first || m === 1 ? ` ${y}` : ''}` : '' });
    if (labelled) first = false;
  }
  return out;
}

/** The token set a figure is drawn with: the caller's, else the house screen set. */
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });

/**
 * The chart: one row per dated item, a label column, months across and a
 * dashed rule for today. Milestones are diamonds; spans and tasks are bars,
 * filled once done and outlined while open. A label wraps to two lines, or is
 * keyed under the chart when it needs more. Returns '' when nothing is dated.
 * `style` is a figureTokens set (the screen set when absent); `width` is in its unit.
 */
export function timelineSvg(items, { width = null, today = new Date().toISOString().slice(0, 10), style = null } = {}) {
  const rows = items.filter(x => day(x.date));
  if (!rows.length) return '';
  const t = tokensOf(style), ls = t.size.label, sm = t.size.small, P = Math.max(t.pad, ls * 0.7), W = Math.round(width ?? t.width.double);
  const col = labelColumn(t, rows.map(r => r.label), Math.max(W * 0.3 - P, ls * 6));
  const labelW = Math.max(col.w, ls * 6), x0 = P + labelW, x1 = W - P - ls * 0.5;
  const { from, to } = timelineRange(rows.flatMap(r => [r.date, r.end]).filter(Boolean), today);
  const span = ms(to) - ms(from), X = iso => x0 + (x1 - x0) * (ms(iso) - ms(from)) / span;
  const showToday = today >= from && today <= to;
  const TOP = P + (showToday ? ls * 1.5 : 0) + sm * 1.6;
  const heights = col.lines.map(l => rowHeight(t, l.length)), total = heights.reduce((n, v) => n + v, 0);
  const lead = ls * 0.3, bottom = TOP + lead + total + lead * 0.5, parts = [], tx = showToday ? X(today) : null;
  // months: a hairline at each month, the name of some under the axis title row; each name starts after the end of the one before it, and below 480 px (or its equivalent) only every other month is named
  const ticks = monthTicks(from, to), narrow = W < 480 * ls / 12;
  let lastEnd = -Infinity, named = 0;
  for (const tk of ticks) {
    const x = X(tk.iso);
    parts.push(hairLine(t, x, TOP, x, bottom));
    if (!tk.label || tk.iso >= to) continue;
    const turn = named++;
    if (narrow && turn % 2) continue;
    const w = measure(t, tk.label, 'small');
    if (x + 3 < lastEnd + 6 || x + 3 + w > W - P) continue;
    if (tx != null && tx > x && tx < x + 3 + w + 3) continue;
    parts.push(text(t, x + 3, TOP - sm * 0.5, tk.label, { role: 'small', cls: 'c-mute' }));
    lastEnd = x + 3 + w;
  }
  parts.push(axisLine(t, x0, TOP, x0, bottom), axisLine(t, x0, TOP, x1, TOP));
  const bh = t.row * 0.45, d = t.row * 0.25;
  let y = TOP + lead;
  rows.forEach((r, i) => {
    const mid = y + heights[i] / 2, tip = `${r.label}, ${r.date}${r.end ? ` to ${r.end}` : ''}${r.source ? `, ${r.source}` : ''}`;
    parts.push(lines(t, P, mid, col.lines[i], { inner: `<title>${esc(tip)}</title>` }));
    if (r.end) {
      const a = X(r.date), b = Math.max(X(r.end), a + t.size.small * 0.25);
      parts.push(r.done
        ? `<rect class="c-bar" x="${r1(a)}" y="${r1(mid - bh / 2)}" width="${r1(b - a)}" height="${r1(bh)}" fill="${t.color.mark}"/>`
        : `<rect class="c-line" x="${r1(a)}" y="${r1(mid - bh / 2)}" width="${r1(b - a)}" height="${r1(bh)}" fill="none" stroke="${t.color.ink}" stroke-width="${t.line.box}"/>`);
    } else {
      const x = X(r.date), solid = r.done || r.known;
      parts.push(`<polygon class="${solid ? 'c-ink' : 'c-line'}" points="${r1(x)},${r1(mid - d)} ${r1(x + d)},${r1(mid)} ${r1(x)},${r1(mid + d)} ${r1(x - d)},${r1(mid)}" fill="${solid ? t.color.ink : 'none'}" stroke="${t.color.ink}" stroke-width="${t.line.box}"/>`);
    }
    y += heights[i];
  });
  if (showToday) {
    const x = X(today), w = measure(t, 'Today', 'label');
    parts.push(`<line class="c-today" x1="${r1(x)}" y1="${r1(P + ls * 1.1)}" x2="${r1(x)}" y2="${r1(bottom)}" stroke="${t.color.ink}" stroke-width="${t.line.null}" stroke-dasharray="${r1(ls * 0.25)} ${r1(ls * 0.25)}"/>`);
    parts.push(text(t, Math.min(x + ls * 0.25, W - P - w), P + ls * 0.9, 'Today', { role: 'head', cls: 'c-ink c-head' }));
  }
  const foot = sourceBlock(t, P, bottom + sm * 0.8, W - 2 * P, keyLines(col.keys));
  parts.push(foot.svg);
  const H = bottom + (foot.h ? sm * 0.8 + foot.h : 0) + P;
  return svgRoot(t, W, H, parts.join(''), { title: 'Project timeline', desc: `${rows.length} dated ${rows.length === 1 ? 'item' : 'items'}, ${from.slice(0, 7)} to ${to.slice(0, 7)}` });
}

/** The timeline as CSV rows, header first; undated milestones are included with an empty date. */
export function timelineCsv(items, today = new Date().toISOString().slice(0, 10)) {
  return [['Milestone', 'Start', 'End', 'Source', 'Done', 'Days late'],
    ...items.map(x => [x.label, x.date || '', x.end || '', x.source || '', x.done ? 'yes' : '', daysLate(x, today) || ''])];
}

/** The house drawings app/lint-figures.mjs checks: a plan with spans, a long label and today inside, and one that needs a key. */
export const __fixture = style => {
  const today = '2026-10-08';
  const items = timelineItems({ milestones: [{ id: 'a', label: 'Ethics approval', date: '2026-07-01', done: true }, { id: 'b', label: 'Recruitment', date: '2026-08-01', end: '2027-01-31', done: true },
    { id: 'c', label: 'Follow-up of the whole cohort at twelve months', date: '2026-11-15', end: '2027-06-30' }, { id: 'd', label: 'Submit', date: '2027-08-20' }] });
  const keyed = timelineItems({ milestones: [{ id: 'k', label: 'A deliberately very long milestone title that needs more than two lines in a narrow label column to be read', date: '2026-09-01' }, { id: 'l', label: 'Lock', date: '2027-01-15' }] });
  return [{ name: 'timelineSvg', svg: timelineSvg(items, { style, today }) }, { name: 'timelineSvg-keyed', svg: timelineSvg(keyed, { style, today, width: style?.unit === 'pt' ? 320 : 420 }) }];
};

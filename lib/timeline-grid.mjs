// The on-screen timeline's scale (views/tasks-timeline.mjs; plan §2, "Tasks › Timeline"): the days a grid spans at a scale of weeks, months or
// quarters, and its header. Everything is a position in percent of the grid's width, so the grid fills its room and grows past it only when
// a scale's day width asks for more: nothing is measured. Kept apart from lib/timeline.mjs, which the shell loads, so this loads with the page. Pure.
import { addMonths, daysBetween } from './timeline.mjs';

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const day = v => { const m = DAY.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = iso => Date.parse(`${iso}T00:00:00Z`);
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** The three scales: the least width of a day (px), the period a step of Earlier or Later moves, and the least span shown. */
export const GRID_ZOOMS = Object.freeze({
  weeks: { dw: 28, step: 7, min: 8 },        // days in the lower band, weekends shaded
  months: { dw: 6, step: 1, min: 6 },        // months over the Mondays
  quarters: { dw: 2, step: 3, min: 4 },      // quarters over the months
});
const addDays = (iso, n) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10);
const weekday = iso => new Date(ms(iso)).getUTCDay();       // 0 Sunday
const monday = iso => addDays(iso, -((weekday(iso) + 6) % 7));
const monthStart = iso => `${iso.slice(0, 7)}-01`;
const quarterStart = iso => `${iso.slice(0, 4)}-${String(Math.floor((Number(iso.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

/**
 * The days a grid spans at a scale: the items' dates and today, a period of air on each side, at least the scale's span, moved by `offset`
 * periods (Earlier and Later). `{ from, to, days }`, `to` exclusive.
 */
export function gridRange(dates, today, zoom = 'months', offset = 0) {
  const z = GRID_ZOOMS[zoom] ? zoom : 'months', all = [...dates.map(day).filter(Boolean), day(today)].filter(Boolean).sort();
  const lo = all[0], hi = all.at(-1);
  let from, to;
  if (z === 'weeks') {
    from = addDays(monday(lo), -7); to = addDays(monday(hi), 14);
    while (daysBetween(from, to) < 7 * GRID_ZOOMS.weeks.min) to = addDays(to, 7);
    from = addDays(from, 7 * offset); to = addDays(to, 7 * offset);
  } else {
    const start = z === 'months' ? monthStart : quarterStart, step = GRID_ZOOMS[z].step;
    from = start(lo); to = addMonths(start(hi), step);
    while (monthsBetween(from, to) < step * GRID_ZOOMS[z].min) to = addMonths(to, step);
    from = addMonths(from, step * offset); to = addMonths(to, step * offset);
  }
  return { from, to, days: daysBetween(from, to), zoom: z };
}

/** Where a day starts in the grid, in percent; `end` gives where it ends (a task's due day is part of its bar). */
const r3 = v => Math.round(v * 1000) / 1000;
export const gridAt = (range, iso, end = false) => r3(((daysBetween(range.from, iso) + (end ? 1 : 0)) / range.days) * 100);
const pct = (range, iso) => gridAt(range, iso);

/**
 * The header and the rules: `top` (months, or quarters) and `sub` (days, Mondays or months) as `{ a, b, label, now }`, `rules` where a top
 * period starts, `today` (percent, or null when out of range), and `weekend` (at the scale of days: the shaded days as stops of one week in
 * percent, else null).
 */
export function gridHeader(range, today) {
  const { from, to, zoom } = range, t = day(today), inside = t >= from && t < to;
  const clip = (a, b) => ({ a: Math.max(0, a), b: Math.min(100, b) });
  const top = [], sub = [];
  const tops = [];
  if (zoom === 'quarters') for (let q = quarterStart(from); q < to; q = addMonths(q, 3)) tops.push([q, addMonths(q, 3), `Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1} ${q.slice(0, 4)}`]);
  else {
    let first = true;
    for (let m = monthStart(from); m < to; m = addMonths(m, 1)) {
      const mi = Number(m.slice(5, 7)) - 1;
      tops.push([m, addMonths(m, 1), zoom === 'weeks' || first || mi === 0 ? `${MONTHS[mi]} ${m.slice(0, 4)}` : MONTHS[mi]]);
      first = false;
    }
  }
  for (const [a, b, label] of tops) top.push({ ...clip(pct(range, a), pct(range, b)), label, now: inside && t >= a && t < b, at: a });
  const near = (iso, before, after) => inside && daysBetween(t, iso) >= -before && daysBetween(t, iso) <= after;
  if (zoom === 'weeks') for (let d = from; d < to; d = addDays(d, 1)) sub.push({ a: pct(range, d), b: gridAt(range, d, true), label: String(Number(d.slice(8))), now: d === t, weekend: [0, 6].includes(weekday(d)) });
  else if (zoom === 'months') for (let d = monday(from) < from ? addDays(monday(from), 7) : monday(from); d < to; d = addDays(d, 7)) { if (!near(d, 4, 3)) sub.push({ a: pct(range, d), label: String(Number(d.slice(8))) }); }
  else for (let m = monthStart(from); m < to; m = addMonths(m, 1)) if (m >= from && !near(m, 14, 10)) sub.push({ a: pct(range, m), label: MONTHS[Number(m.slice(5, 7)) - 1] });
  const rules = top.map(x => x.a).filter(a => a > 0);
  let weekend = null;
  if (zoom === 'weeks') {
    const week = (7 / range.days) * 100, sat = ((6 - weekday(from)) + 7) % 7;    // days from the first day to the first Saturday
    const stops = sat === 6 ? [[0, 1], [6, 7]] : [[sat, sat + 2]];                   // a Sunday first day: its Sunday, then the Saturday
    weekend = { week: r3(week), stops: stops.map(([a, b]) => [r3((a / 7) * week), r3((b / 7) * week)]) };
  }
  return { top, sub, rules, today: inside ? r3(pct(range, t) + 50 / range.days) : null, weekend };
}

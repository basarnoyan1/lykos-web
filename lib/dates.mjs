// The one place the interface formats a time, a time ago and a counted noun (roadmap S6, UI_Guidelines "Dates and counts").
//
//   when(iso)   "7 Oct, 20:22"       a moment: day, month, 24-hour time, no seconds; "7 Oct 2025, 20:22" in another year
//   day(iso)    "7 Oct"              a day; "7 Oct 2025" in another year
//   ago(iso)    "1 h ago"            "just now", "5 min ago", "1 h ago", "3 d ago"; past 30 days the day
//   monthYear / longDay / clock  "October 2026", "Monday 7 October 2026", "20:22"  a calendar's month, a day's accessible name, a time of day
//   plural(n, one, many)  "2 rows"   the count with its noun; thousands grouped with a comma
//
// Nothing here asks the host for a locale: toLocaleString and Intl follow the machine's region, so one page printed "10/7/2026, 8:22:29 PM" beside
// "7 Oct, 20:22". Month names, the 24-hour clock and the grouping are written out, so the text is the same on every machine. Times are the viewer's local time.
// Every function takes a time as an ISO string, a Date or milliseconds, and returns '' for anything else: a view never prints "Invalid Date" or "NaN".
// `now` is a parameter so a test, or a view that draws many rows, reads the clock once.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const two = n => String(n).padStart(2, '0');

/** A Date for a time value, or null. A date with no time ("2026-10-05") is that day here, not UTC midnight, which is the previous evening west of Greenwich. */
export function toDate(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  let d;
  if (value instanceof Date) d = new Date(value.getTime());
  else if (typeof value === 'number') d = new Date(value);
  else if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date(value);
  } else return null;
  return Number.isNaN(d.getTime()) ? null : d;
}

const isDateOnly = value => typeof value === 'string' && DATE_ONLY.test(value.trim());
const nowYear = now => toDate(now)?.getFullYear() ?? new Date().getFullYear();
const dayText = (d, now) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === nowYear(now) ? '' : ` ${d.getFullYear()}`}`;

/** "7 Oct" (the year only when it is not this year). */
export function day(value, now = Date.now()) {
  const d = toDate(value);
  return d ? dayText(d, now) : '';
}

/** "October 2026": the month a calendar shows. */
export function monthYear(value) {
  const d = toDate(value);
  return d ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** "Monday 7 October 2026": a day written out in full, for a control's accessible name. */
export function longDay(value) {
  const d = toDate(value);
  return d ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** "20:22": the clock time alone, 24-hour. */
export function clock(value) {
  const d = toDate(value);
  return d ? `${two(d.getHours())}:${two(d.getMinutes())}` : '';
}

/** "7 Oct, 20:22" (the year only when it is not this year). A date with no time is a day. */
export function when(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '';
  return isDateOnly(value) ? dayText(d, now) : `${dayText(d, now)}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "just now", "5 min ago", "1 h ago", "3 d ago"; thirty days and more is the day; a time more than a minute ahead is a moment ("7 Oct, 20:22"). */
export function ago(value, now = Date.now()) {
  const d = toDate(value), n = toDate(now);
  if (!d || !n) return '';
  const minutes = (n.getTime() - d.getTime()) / 60000;
  if (minutes < -1) return when(value, now);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / 1440)} d ago`;
  return dayText(d, now);
}

/** A number with its thousands grouped by a comma: 1234567 -> "1,234,567". A decimal keeps its own digits. '' for anything that is not a finite number. */
export function num(n) {
  if (typeof n === 'string' && n.trim() !== '') n = Number(n);
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [int, frac] = String(Math.abs(n)).split('.');
  if (/e/i.test(int + (frac || ''))) return String(n);
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

/** The count with its noun: plural(1, 'row') "1 row", plural(2, 'row') "2 rows", plural(2, 'study', 'studies') "2 studies", plural(1234, 'record') "1,234 records". '' when n is not a number. */
export function plural(n, one, many = `${one}s`) {
  const text = num(n);
  return text === '' ? '' : `${text} ${Math.abs(Number(n)) === 1 ? one : many}`;
}

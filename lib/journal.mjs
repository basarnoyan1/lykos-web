// The project journal: dated entries, one a day unless several are allowed,
// listed by ISO week (amendment "Workspace: backup, dashboard, tasks,
// timeline and translation").
//
//   state.journal       [{ id, date, text, at, updated }]
//   state.journalMany   true when a day may hold more than one entry
//
// Kept in the project itself, so a project in the app's storage and one in a
// folder keep it alike and a backup carries it. Pure.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = iso => new Date(`${iso}T00:00:00Z`);
const iso = d => d.toISOString().slice(0, 10);

/** ISO 8601 week of a day: `{ year, week, key: '2026-W40' }` (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(date) {
  const d = utc(date);
  const dow = (d.getUTCDay() + 6) % 7;             // Monday 0
  d.setUTCDate(d.getUTCDate() - dow + 3);           // the Thursday of this week
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}` };
}

/** The Monday and Sunday of the week a day falls in. */
export function weekBounds(date) {
  const d = utc(date), dow = (d.getUTCDay() + 6) % 7;
  const from = new Date(d); from.setUTCDate(d.getUTCDate() - dow);
  const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
  return { from: iso(from), to: iso(to) };
}

const short = (x, year) => { const d = utc(x); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`; };
/** "Week 40 · 28 Sep – 4 Oct 2026". */
export function weekLabel(date) {
  const { week } = isoWeek(date), { from, to } = weekBounds(date);
  return `Week ${week} · ${short(from, from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, true)}`;
}

export function normaliseJournal(list) {
  return (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && DAY.test(String(e.date || '')) && typeof e.text === 'string')
    .map(e => ({ id: String(e.id || `j${e.date}`), date: e.date, text: e.text, at: String(e.at || ''), updated: String(e.updated || e.at || '') }));
}

/**
 * The entry to write in for a day: that day's existing entry, unless several
 * a day are allowed or none exists, when a new one is added. Mutates
 * `state.journal`; answers `{ entry, created }`. Opening the same day twice
 * never makes a second entry by default.
 */
export function entryFor(state, date, { many = Boolean(state.journalMany), text = '', now = new Date() } = {}) {
  if (!DAY.test(String(date))) throw new Error('A journal entry needs a date');
  if (!Array.isArray(state.journal)) state.journal = [];
  if (!many) {
    const found = state.journal.find(e => e && e.date === date);
    if (found) return { entry: found, created: false };
  }
  const at = now.toISOString();
  const entry = { id: `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, text, at, updated: at };
  state.journal.push(entry);
  return { entry, created: true };
}

/** Entries grouped by ISO week, newest week first; within a week newest day first. */
export function byWeek(list) {
  const groups = new Map();
  for (const e of normaliseJournal(list)) {
    const k = isoWeek(e.date).key;
    if (!groups.has(k)) groups.set(k, { key: k, label: weekLabel(e.date), entries: [] });
    groups.get(k).entries.push(e);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
    .map(g => ({ ...g, entries: g.entries.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)) }));
}

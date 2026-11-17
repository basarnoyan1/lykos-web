// Which copies in a project folder's .lykos/backups stay (plan "Footprint" Task 2). Pure: names in, names out.
// The daily copy (`project-<day>.json`, `.json.gz` since October 2026) is kept for today and yesterday (DAILY_DAYS), then the newest of
// each ISO week for 8 weeks (the recent ones count for their week), then the newest of each month. A copy kept before a change
// (`project-before-<what>-<time>.json`, one per change file or migration): the newest BEFORE_KEEP (10) whatever their day, then the newest
// of each day for BEFORE_DAYS (7). A day of model runs wrote a hundred of them, 94 MB of nearly the same project (24 Oct 2026); undo takes
// the newest, and history keeps every state between. Both were 7 and 30 days until 9 Nov 2026: on the Sham folder the seven daily copies
// were 187 MB (27 MB each, every one the whole project) beside a history that holds the same states, and the before-copies older than a
// week held 41 MB of the history's store that nothing else used (owner: "make the project as small as possible").
// A daily copy in a folder that keeps a history is a reference into the history's store (`project-<day>.ref.json`, F4 of
// docs/Lykos_Storage_Design_2026-11.md, 14 Nov 2026): judged by its day like a whole one.
// Any other name (the person's own file, the adoption record project-before-init-<time>.json, the copy lykos compact keeps before the
// move to format 2 or 4, project-before-format-2-<time>, project-before-format-4-<time>) is never dropped. A restore point the rule drops is
// removed only once a commit holds its state (work queue row 40): the writers ask tools/backup-refs.mjs evictable, or keep any point that
// is not a v2 reference (lib/backup-ref.mjs parseRef). The name list stays this short: a list of names always misses the next milestone.
const DAILY = /^project-(\d{4}-\d{2}-\d{2})(?:\.json(?:\.gz)?|\.ref\.json)$/, BEFORE = /^project-before-(?!init-|format-2-|format-4-).*-(\d{4}-\d{2}-\d{2})T/;
const isRef = n => n.endsWith('.ref.json');
export const isDaily = name => DAILY.test(name);
export const dayOf = name => DAILY.exec(name)?.[1] || '';
export const BEFORE_KEEP = 10, BEFORE_DAYS = 7, DAILY_DAYS = 1;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const isoWeek = d => { const x = new Date(Date.parse(d)); x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7)); return `${x.getUTCFullYear()}-W${Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)}`; };

/** `{ keep, drop }` for the file names of a backups folder on `today` (YYYY-MM-DD). */
export function keepBackups(names, today) {
  const keep = new Set(), drop = new Set();
  const daily = names.map(n => [n, DAILY.exec(n)?.[1]]).filter(([, d]) => d)
    .sort((a, b) => b[1].localeCompare(a[1]) || isRef(a[0]) - isRef(b[0]));   // a day kept twice: the whole copy first, it needs nothing else to read
  const weeks = new Set(), months = new Set();
  for (const [n, d] of daily) {
    const age = days(d, today);
    if (!(age >= -1)) { keep.add(n); continue; }   // a date in the future (a clock that was wrong) is kept, not judged
    if (age <= DAILY_DAYS) { keep.add(n); weeks.add(isoWeek(d)); }
    else if (age <= 56) { const w = isoWeek(d); if (weeks.has(w)) drop.add(n); else { weeks.add(w); keep.add(n); } }
    else { const m = d.slice(0, 7); if (months.has(m)) drop.add(n); else { months.add(m); keep.add(n); } }
  }
  for (const n of names) if (!BEFORE.test(n) && !DAILY.test(n)) keep.add(n);
  // newest first: the time is in the name after the day, so the name from the day on sorts by time
  const stamp = n => n.slice(BEFORE.exec(n).index + BEFORE.exec(n)[0].length - 'YYYY-MM-DDT'.length);
  const before = names.filter(n => BEFORE.test(n)).sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const seenDays = new Set();
  before.forEach((n, i) => {
    const d = BEFORE.exec(n)[1];
    if (i < BEFORE_KEEP) { keep.add(n); seenDays.add(d); }
    else if (days(d, today) <= BEFORE_DAYS && !seenDays.has(d)) { keep.add(n); seenDays.add(d); }
    else drop.add(n);
  });
  return { keep: [...keep], drop: [...drop] };
}

/** A kept copy that is still plain JSON and may be compressed in place: the daily and before-migration copies only. */
export const compressible = name => /\.json$/.test(name) && !/\.ref\.json$/.test(name) && (DAILY.test(name) || /^project-before-/.test(name));   // a reference into the history's store (.ref.json) is a few hundred bytes

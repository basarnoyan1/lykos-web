// Which copies in a project folder's .lykos/backups stay (plan "Footprint" Task 2). Pure: names in, names out.
// The daily copy (`project-<day>.json`, `.json.gz` since October 2026) is kept for the last 7 days, then the newest of each ISO
// week for 8 weeks, then the newest of each month. A copy kept before a change (`project-before-<what>-<time>.json`, one per change
// file or migration): the newest BEFORE_KEEP (10) whatever their day, then the newest of each day for 30 days. A day of model runs wrote a
// hundred of them, 94 MB of nearly the same project (24 Oct 2026); undo takes the newest, and history keeps every state between.
// Any other name (the person's own file, the adoption record project-before-init-<time>.json, the copy lykos compact keeps before the
// move to format 2, project-before-format-2-<time>) is never dropped.
const DAILY = /^project-(\d{4}-\d{2}-\d{2})\.json(\.gz)?$/, BEFORE = /^project-before-(?!init-|format-2-).*-(\d{4}-\d{2}-\d{2})T/;
export const BEFORE_KEEP = 10;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const isoWeek = d => { const x = new Date(Date.parse(d)); x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7)); return `${x.getUTCFullYear()}-W${Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)}`; };

/** `{ keep, drop }` for the file names of a backups folder on `today` (YYYY-MM-DD). */
export function keepBackups(names, today) {
  const keep = new Set(), drop = new Set();
  const daily = names.map(n => [n, DAILY.exec(n)?.[1]]).filter(([, d]) => d).sort((a, b) => b[1].localeCompare(a[1]));
  const weeks = new Set(), months = new Set();
  for (const [n, d] of daily) {
    const age = days(d, today);
    if (!(age >= -1)) { keep.add(n); continue; }   // a date in the future (a clock that was wrong) is kept, not judged
    if (age <= 7) keep.add(n);
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
    else if (days(d, today) <= 30 && !seenDays.has(d)) { keep.add(n); seenDays.add(d); }
    else drop.add(n);
  });
  return { keep: [...keep], drop: [...drop] };
}

/** A kept copy that is still plain JSON and may be compressed in place: the daily and before-migration copies only. */
export const compressible = name => /\.json$/.test(name) && !/\.ref\.json$/.test(name) && (DAILY.test(name) || /^project-before-/.test(name));   // a reference into the history's store (.ref.json) is a few hundred bytes

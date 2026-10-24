// Which copies in a project folder's .lykos/backups stay (plan "Footprint" Task 2). Pure: names in, names out.
// The daily copy (`project-<day>.json`, `.json.gz` since October 2026) is kept for the last 7 days, then the newest of each ISO
// week for 8 weeks, then the newest of each month; a copy kept before a migration (`project-before-<what>-<time>.json`) for 30
// days. Any other name (the person's own file, an adoption record) is never dropped.
const DAILY = /^project-(\d{4}-\d{2}-\d{2})\.json(\.gz)?$/, BEFORE = /^project-before-.*-(\d{4}-\d{2}-\d{2})T/;
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
  for (const n of names) { const m = BEFORE.exec(n); if (!m) { if (!DAILY.test(n)) keep.add(n); continue; } (days(m[1], today) <= 30 ? keep : drop).add(n); }
  return { keep: [...keep], drop: [...drop] };
}

/** A kept copy that is still plain JSON and may be compressed in place: the daily and before-migration copies only. */
export const compressible = name => /\.json$/.test(name) && (DAILY.test(name) || BEFORE.test(name));

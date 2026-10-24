// The commit list as History draws it (views/history-tool.mjs): grouped by day ("Today", "Yesterday", "14 Oct"), a run of automatic commits
// folded into one row ("12 automatic commits · 14:02–16:40"), searched by message, file, author and version name (Turkish-aware, foldSearch),
// and the commits between two versions for a comparison.
//
// Pure: it takes the log as lib/vcs.mjs answers it ({ id, at, by, message, files, parent, delta }) and the tags ({ name: id }); the clock is a
// parameter. It names no file, folder or project.
import { day, clock, plural } from './dates.mjs';
import { foldSearch } from './search-ranking.mjs';

export const AUTO_BY = 'Lykos (automatic)';   // who the recorder commits as (lib/vcs-watch.mjs)
export const FOLD_MIN = 2;                    // this many automatic commits in a row fold into one row

export const isAuto = c => c?.by === AUTO_BY;
/** Who made a commit, as the list names them: "You", "Lykos (automatic)", "Claude Code", a script's own name with a capital. */
export function authorOf(by) {
  const s = String(by || '').trim();
  if (!s) return 'Unknown';
  if (s === AUTO_BY) return s;
  if (/^you$/i.test(s)) return 'You';
  if (/^claude[\s_-]*code$/i.test(s)) return 'Claude Code';
  return s[0].toUpperCase() + s.slice(1);
}
/** The first line of a message, and the rest (the commit page shows both). */
export function messageParts(message) {
  const text = String(message || '').replace(/\r\n?/g, '\n').trim();
  const at = text.indexOf('\n');
  return at < 0 ? { title: text, body: '' } : { title: text.slice(0, at).trim(), body: text.slice(at + 1).trim() };
}
export const shortId = id => String(id || '').slice(0, 7);

const two = n => String(n).padStart(2, '0');
/** The local day of a time, "2026-10-16", the key a commit is grouped under. */
export function dayKey(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
/** "Today", "Yesterday", else the day ("14 Oct"; "14 Oct 2025" in another year). */
export function dayLabel(at, now = Date.now()) {
  const k = dayKey(at), today = new Date(now), yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12);
  if (k === dayKey(today)) return 'Today';
  if (k === dayKey(yesterday)) return 'Yesterday';
  return day(at, now);
}

/** The version names of a commit. */
export const tagsOf = (tags, id) => Object.entries(tags || {}).filter(([, v]) => v === id).map(([n]) => n);

/** Whether a commit answers a search: every word of it in the message, a file's path, the author or a version name (accents, ı and İ do not matter). */
export function matches(c, query, tags = {}) {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = foldSearch([c.message, authorOf(c.by), ...(c.files || []), ...tagsOf(tags, c.id), c.id].join('\n'));
  return words.every(w => hay.includes(w));
}

/** "12 automatic commits · 14:02–16:40": the row a run of automatic commits folds into (newest first, as the log is). */
export function runLabel(commits) {
  const times = commits.map(c => clock(c.at)), first = times.at(-1), last = times[0];
  return `${plural(commits.length, 'automatic commit')}, ${first === last ? first : `${first}–${last}`}`;
}

/**
 * The log as days, newest first: [{ key, label, items }], each item `{ kind: 'commit', commit }` or `{ kind: 'run', id, commits, label }` for
 * FOLD_MIN or more automatic commits in a row on one day. A named version never folds (it is a commit a person meant). `query` keeps the
 * commits that match and folds nothing; `only` is 'tags' (named versions) or 'people' (no automatic commits).
 */
export function groupLog(log, { now = Date.now(), query = '', tags = {}, only = '', foldMin = FOLD_MIN } = {}) {
  const named = new Set(Object.values(tags || {}));
  const keep = (log || []).filter(c => matches(c, query, tags) && (only !== 'tags' || named.has(c.id)) && (only !== 'people' || !isAuto(c)));
  const fold = !String(query).trim() && !only;
  const days = [];
  for (const c of keep) {
    const key = dayKey(c.at);
    let d = days.at(-1);
    if (!d || d.key !== key) { d = { key, label: dayLabel(c.at, now), items: [], count: 0 }; days.push(d); }
    d.count++;
    const last = d.items.at(-1), auto = fold && isAuto(c) && !named.has(c.id);
    if (auto && last?.kind === 'auto') last.commits.push(c);
    else d.items.push(auto ? { kind: 'auto', commits: [c] } : { kind: 'commit', commit: c });
  }
  for (const d of days) {
    d.items = d.items.flatMap(it => {
      if (it.kind !== 'auto') return [it];
      if (it.commits.length < foldMin) return it.commits.map(commit => ({ kind: 'commit', commit }));
      return [{ kind: 'run', id: `run:${it.commits[0].id}`, commits: it.commits, label: runLabel(it.commits) }];
    });
  }
  return days;
}

/** A commit's counted change as one figure: lines added and removed, or cells changed, or null. */
export function deltaOf(c) {
  const d = c?.delta || {};
  if (d.a || d.r) return { a: d.a || 0, r: d.r || 0 };
  if (d.c) return { c: d.c };
  return null;
}
/** The counts of a run of commits added up. */
export function sumDeltas(commits) {
  const s = commits.reduce((t, c) => ({ a: t.a + (c.delta?.a || 0), r: t.r + (c.delta?.r || 0), c: t.c + (c.delta?.c || 0) }), { a: 0, r: 0, c: 0 });
  return s.a || s.r ? { a: s.a, r: s.r } : s.c ? { c: s.c } : null;
}

/**
 * The commits a comparison spans, newest first: those after `from` up to and including `to` (`to` 'working': up to the newest). The two may be
 * given in either order: the older is the base. Answers { from, to, commits } with the ids put in order, or null when either is not in the log.
 */
export function rangeOf(log, from, to) {
  const at = id => (id === 'working' ? -1 : log.findIndex(c => c.id === id));
  let a = at(from), b = at(to);
  if ((from !== 'working' && a < 0) || (to !== 'working' && b < 0) || from === to) return null;
  if (a < b) { [from, to] = [to, from]; [a, b] = [b, a]; }   // the log is newest first: the base has the larger index
  return { from, to, commits: log.slice(b < 0 ? 0 : b, a) };
}

// Files that are versions of one another, drawn as one file with a history.
//
// A review folder keeps its versions and never deletes them: "Manuscript_v15_final", "Manuscript_v15_mendeley" and "Manuscript_v16", a
// workbook as "…v12" then "…v13", a download as "name (1)". The names are read by parseVersionFull (lib/folder-map.mjs), the same reader the
// Folder view uses, so the two agree. A group is the newest version with the earlier ones under it; the earlier ones may live in the
// folder itself or in its Archive folders (passed apart).
//
// Not every shared stem is a history: "Table_1" and "Table_2" read as copies of "Table" but are two tables, and a name with no version
// stays its own file. A group needs a version number, a "name (1)" copy, or a plain file with copies of it.
import { parseVersionFull } from './folder-map.mjs';

const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const PAREN_COPY = /\s*\(\d{1,2}\)\.[^.]*$|\s*\(\d{1,2}\)$/;
const info = e => {
  const v = parseVersionFull(e.name);
  return { e, ext: extOf(e.name), group: v.group, rank: v.rank, version: v.version, copy: v.copy, paren: PAREN_COPY.test(e.name), mtime: e.mtime || 0 };
};
// Newest first: the higher version, then the later modification, then the one with fewer copy marks.
const newest = (a, b) => b.rank - a.rank || b.mtime - a.mtime || a.copy - b.copy || a.e.name.localeCompare(b.e.name, undefined, { numeric: true });

/** Whether files that share a stem are one file's versions (see the header). */
function isHistory(members) {
  if (members.length < 2) return false;
  if (members.some(m => m.version > 0 || m.paren)) return true;
  return members.some(m => m.copy === 0) && members.some(m => m.copy > 0);
}

/**
 * `entries` are the folder's entries ({ name, rel, dir?, size?, mtime? }); `archived` the entries of its Archive folders. Returns
 * [{ latest, earlier: [entry…] }] in the order the latest versions stand in `entries`; a folder, or a file with no history, has no earlier.
 * `earlier` is newest first and each entry carries `archived: true` when it came from `archived`.
 */
export function groupVersions(entries = [], archived = []) {
  const list = Array.isArray(entries) ? entries.filter(e => e && typeof e.name === 'string') : [];
  const old = Array.isArray(archived) ? archived.filter(e => e && typeof e.name === 'string' && !e.dir) : [];
  const buckets = new Map();
  const add = (entry, from) => {
    if (entry.dir) return;
    const i = info(entry), key = `${i.ext}|${i.group}`;
    if (!i.group) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ ...i, from });
  };
  list.forEach(e => add(e, 'folder'));
  old.forEach(e => add(e, 'archive'));
  const chosen = new Map();   // rel of the latest -> { earlier }
  const folded = new Set();   // rel of each entry that is shown under another
  for (const members of buckets.values()) {
    if (!members.some(m => m.from === 'folder') || !isHistory(members)) continue;
    const ordered = [...members].sort(newest);
    const top = ordered.find(m => m.from === 'folder');
    const earlier = ordered.filter(m => m !== top).map(m => ({ ...m.e, archived: m.from === 'archive' }));
    chosen.set(top.e.rel ?? top.e.name, { latest: top.e, earlier });
    for (const m of ordered) if (m !== top && m.from === 'folder') folded.add(m.e.rel ?? m.e.name);
  }
  const out = [];
  for (const e of list) {
    const key = e.rel ?? e.name;
    if (folded.has(key)) continue;
    out.push(chosen.get(key) || { latest: e, earlier: [] });
  }
  return out;
}

/** The label of a version for a row: "v16", "v3.4.1", or the copy mark. */
export function versionLabel(name) {
  const v = parseVersionFull(name);
  if (v.version) return `v${v.parts.join('.')}`;
  return v.copy ? 'Copy' : '';
}

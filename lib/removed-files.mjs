// A folder file removed from the project folder (storage design F7). The recorder (lib/vcs-watch.mjs) sees the removal at its settled look,
// before it commits: the newest commit still names the file then, so its entry says what is lost. Graded:
//   all   the entry has a recipe (`r`, a file Lykos made) or the history keeps its bytes: nothing is lost; quiet, not kept
//   part  a reference export (.ris .nbib .enw .ciw): the records are kept in the project, its URLs, notes and database fields are not
//   none  anything else (a PDF, a data sheet): the history keeps its hash, not its bytes, so the notice looks for it in the Trash, by name
//         and size, then hash (main.rs trash_find), and offers to put it back or forget it
// A move (the same bytes at another path) is no removal: lib/vcs.mjs compare() reports it as moved, and the commit's message records it once.
// Each removal is kept in the project's data, `removedFiles`, by `path@hash`: an open warning survives a restart (the commit that follows
// no longer lists the file as deleted), an answered one never warns again, and the same path with other bytes is a removal of its own.
// A removal the command-line tools or the MCP commit (tools/lykos-history.mjs commit, before the app looks) is graded and kept there the same
// way, before that commit writes, without a Trash lookup (Node cannot look in the Trash).
const PART = /\.(ris|nbib|enw|ciw)$/i;
const tracked = p => !!p && !p.startsWith('.lykos/') && !p.includes('#') && p !== 'Lykos project.json';
export const keyOf = (path, h) => `${path}@${h}`;
export const OPEN = 'open';
// Bounded (a bulk removal of thousands of PDFs): at most KEEP removals are kept, the answered ones dropped first, then the oldest open
// ones; a dropped one never comes back, since its commit no longer lists it. At most LOOKUPS Trash lookups a batch (each reads the Trash).
export const KEEP = 500, LOOKUPS = 50;

/** What a removal loses: 'all' (makeable again), 'part' (a reference export), 'none' (only the hash is kept). */
export function gradeOf(path, entry) {
  if (entry?.r || (entry && !entry.hashOnly)) return 'all';   // made again from its recipe, or its bytes kept in the history (restorable there)
  return PART.test(path) ? 'part' : 'none';
}

/** The removals in `status` (repo.status() at the settled look, before its commit), each with its entry in the newest commit, graded. */
export async function removalsOf(repo, status) {
  const out = [];
  for (const path of (status?.deleted || []).filter(tracked)) {
    const e = await repo.entry('HEAD', path).catch(() => null);
    if (!e?.h) continue;
    out.push({ path, h: e.h, s: e.s || 0, grade: gradeOf(path, e) });
  }
  return out;
}

/**
 * Keeps new removals in `st.removedFiles`; one already kept (answered or open) is left as it is, so nothing warns twice. 'all' is kept
 * answered ('quiet'). `trash`: what the Trash lookup answered for a 'none', { readable, found: [{ name, by }] } (names inside the Trash). Returns the keys added.
 */
export function keepRemovals(st, removals, at = new Date().toISOString()) {
  const kept = st.removedFiles && typeof st.removedFiles === 'object' ? st.removedFiles : (st.removedFiles = {});
  const added = [];
  for (const r of removals) {
    const k = keyOf(r.path, r.h);
    if (Object.hasOwn(kept, k)) continue;
    if (r.grade === 'all') continue;   // nothing is lost: not kept at all
    kept[k] = { path: r.path, h: r.h, s: r.s, grade: r.grade, at, answer: OPEN, ...(r.trash ? { trash: r.trash } : {}) };
    added.push(k);
  }
  const keys = Object.keys(kept);
  if (keys.length > KEEP) {
    const order = keys.sort((a, b) => (kept[a].answer === OPEN) - (kept[b].answer === OPEN) || String(kept[a].at).localeCompare(String(kept[b].at)));
    for (const k of order.slice(0, keys.length - KEEP)) delete kept[k];
  }
  return added;
}

/** The removals that still wait for an answer, oldest first. */
export const openRemovals = st => Object.entries(st?.removedFiles || {}).filter(([, v]) => v?.answer === OPEN).map(([key, v]) => ({ key, ...v })).sort((a, b) => String(a.at).localeCompare(String(b.at)));

/** Answers one: 'forgotten', 'put back' or 'returned' (the file is in the folder again). */
export function answerRemoval(st, key, how, at = new Date().toISOString()) {
  const v = st?.removedFiles?.[key];
  if (v) Object.assign(v, { answer: how, answeredAt: at });
  return !!v;
}

/** The notice's text for the open removals (one notice for the batch). */
export function noticeText(open) {
  const base = p => p.split('/').pop();
  if (!open.length) return '';
  if (open.length === 1) {
    const r = open[0];
    const lost = r.grade === 'part' ? 'its records are kept; URLs, notes and database fields are not' : 'the history keeps its fingerprint, not its contents';
    const bin = r.grade !== 'none' ? '' : !r.trash ? '' : !r.trash.readable ? ' The Trash could not be read.' : r.trash.found?.length ? ' It is in the Trash.' : ' It is not in the Trash.';
    return `${base(r.path)} was removed from the folder: ${lost}.${bin}`;
  }
  const inBin = open.filter(r => r.trash?.found?.length).length;
  return `${open.length} files were removed from the folder; the history keeps only their fingerprints${inBin ? `; ${inBin} ${inBin === 1 ? 'is' : 'are'} in the Trash` : ''}.`;
}

// Removals already noted for a folder that is not the open project's (a test's, the fixture's): its state is not the one written.
const noted = new WeakMap();
/**
 * The removals in `status` not yet kept, graded, looked for in the Trash (a 'none' only, where the folder has findInTrash: the desktop's), kept in the project's
 * `removedFiles` when the folder is the open project's, and emitted as `{ folder, removed }`. `store`: { get, update }, the app's by default.
 */
export async function noteRemovals(folder, repo, status, { store = null, emit = () => {} } = {}) {
  if (!store) { const { activeFolder } = await import('./projects.mjs'); if (folder === activeFolder()) store = await import('../store.mjs'); }
  const seen = store ? new Set(Object.keys(store.get().removedFiles || {})) : (noted.get(folder) || noted.set(folder, new Set()).get(folder));
  const fresh = (await removalsOf(repo, status)).filter(r => !seen.has(keyOf(r.path, r.h)));
  if (!fresh.length) return [];
  let lookups = 0;
  for (const r of fresh) {
    if (r.grade === 'none' && folder.findInTrash && lookups++ < LOOKUPS) r.trash = await folder.findInTrash(r.path.split('/').pop(), r.s, r.h).catch(() => ({ readable: false, found: [] }));
    if (!store) seen.add(keyOf(r.path, r.h));
  }
  if (store) store.update(st => { keepRemovals(st, fresh); return st; });
  emit({ folder, removed: fresh });
  return fresh;
}

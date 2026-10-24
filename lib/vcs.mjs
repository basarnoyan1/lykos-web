// The project's history, git-like: commits, status, log, diff, tags and restore, kept in the project folder under .lykos/vcs/.
//
//   objects/<aa>/<hash>   the bytes of a file, once per content (a file that did not change is not stored again)
//   commits/<id>.json     one commit: its parent, who, when, why, and what changed ({ path: entry | null }), plus the links it records
//   index.json            a cache of each file's size and time with its hash, so a scan reads only what moved
//   HEAD                  the id of the newest commit;  tags.json  names for commits ("v19", "Round 19")
//
// A commit never deletes anything and neither does a restore: a file that was deleted comes back, a file that exists now and did not then
// stays, and the current state is committed first so a restore can itself be taken back. A file larger than `maxStore`, or under a
// hash-only folder (papers/, an archive), is recorded by its hash and size alone; it shows in status and log but cannot be restored from here.
//
// Pure apart from the folder it is given (lib/fsys.mjs shape: list, stat, read, writeText, writeBytes, replaceBytes, mkdir). The clock and
// the hash are injectable. It names no file, folder or project.
export const DIR = '.lykos/vcs';
export const STAT_MAX = 2 * 1024 * 1024;   // a file larger than this is committed without counting its changed lines
export const DEFAULTS = Object.freeze({
  maxStore: 25 * 1024 * 1024,
  hashOnly: ['papers/', 'Old versions/', 'Archive/'],   // the papers, and folders that already are the archive of an earlier state
  ignore: ['.lykos/', '.git/', 'node_modules/', '__pycache__/', '.DS_Store', '~$', '.~lock.', 'Thumbs.db', 'Lykos project.json'],
});
import { nativeOf } from './vcs-native.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();

const defaultHash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const parentOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const joinRel = (a, b) => (a ? `${a}/${b}` : b);
const objectPath = h => `${DIR}/objects/${h.slice(0, 2)}/${h}`;
const commitPath = id => `${DIR}/commits/${id}.json`;

/** Whether a path is left out of history: a name or folder prefix of the ignore list, anywhere in the path. */
export function ignored(rel, ignore = DEFAULTS.ignore) {
  const parts = rel.split('/');
  return ignore.some(p => (p.endsWith('/') ? parts.slice(0, -1).includes(p.slice(0, -1)) || rel.startsWith(p) : parts.some(x => x === p || x.startsWith(p))));
}

const manifests = new WeakMap();   // folder -> Map(commit id -> its files): a commit's files are its parent's plus its changes, read once
const queues = new WeakMap();   // one commit at a time per folder in this window: steps of two commits never interleave

/** The history of one folder. `opts`: { now, hash, maxStore, hashOnly, ignore, by, stat }. `stat(path, before, after)` may count what changed in a file (`{ a, r }` lines or `{ c }` cells, lib/vcs-diff.mjs statOf): a commit records it as the entry's `d`. */
export function vcs(folder, opts = {}) {
  const now = opts.now || (() => new Date().toISOString());
  const hash = opts.hash || defaultHash;
  const policy = { ...DEFAULTS, ...Object.fromEntries(['maxStore', 'hashOnly', 'ignore'].filter(k => opts[k] != null).map(k => [k, opts[k]])) };
  const readJson = async rel => { try { const st = await folder.stat(rel); return st.exists ? JSON.parse(dec.decode(await folder.read(rel))) : null; } catch { return null; } };
  const exists = async rel => { try { return (await folder.stat(rel)).exists; } catch { return false; } };
  async function ensureDir(rel) {
    if (!rel || await exists(rel)) return;
    await ensureDir(parentOf(rel));
    await folder.mkdir(rel);
  }
  const writeJson = async (rel, doc) => { await ensureDir(parentOf(rel)); await folder.writeText(rel, JSON.stringify(doc)); };
  // Built documents (lib/package-write.mjs) are named in settings.json `derived`: recorded by their hash, never stored (read per status and commit)
  let derived = [];
  const loadDerived = async () => { derived = (await readJson(`${DIR}/settings.json`))?.derived || []; };
  const storable = (rel, size) => size <= policy.maxStore && !policy.hashOnly.some(p => rel.startsWith(p)) && !derived.some(p => rel.startsWith(p));

  // ---- reading the folder -------------------------------------------------------------------------------------------------------------
  const fast = folder.walk && folder.hashFiles ? folder : nativeOf(folder);   // one call for the whole folder, hashes made natively (vcs-native.mjs)
  async function walk(rel = '', out = []) {
    if (fast && !rel) return (await fast.walk(policy.ignore.filter(p => p.endsWith('/')).map(p => p.slice(0, -1)))).filter(f => !ignored(f.path, policy.ignore));
    for (const e of await folder.list(rel)) {
      const path = e.rel || joinRel(rel, e.name);
      if (ignored(e.dir ? `${path}/` : path, policy.ignore) || ignored(path, policy.ignore)) continue;
      if (e.dir) await walk(path, out); else out.push({ path, size: e.size, mtime: e.mtime });
    }
    return out;
  }
  /** Every tracked file with its hash, rehashing only a file whose size or time moved since the index. */
  // A time within a millisecond is the same time: the shell truncates to the millisecond, Node may round.
  async function scan() {
    const index = (await readJson(`${DIR}/index.json`)) || {}, next = {}, files = {}, need = [];
    let changed = false;
    for (const f of await walk()) {
      const known = index[f.path];
      if (known && known.s === f.size && Math.abs(known.m - f.mtime) <= 1) next[f.path] = { s: f.size, m: known.m, h: known.h };
      else need.push(f);
    }
    if (fast && !opts.hash) for (let i = 0; i < need.length; i += 64) {
      const part = need.slice(i, i + 64), hs = await fast.hashFiles(part.map(f => f.path));
      part.forEach((f, k) => { if (hs[k]) { next[f.path] = { s: f.size, m: f.mtime, h: hs[k] }; changed = true; } });
    } else for (const f of need) {
      try { next[f.path] = { s: f.size, m: f.mtime, h: await hash(await folder.read(f.path)) }; changed = true; } catch { /* unreadable now: the next scan tries again */ }
    }
    for (const p of Object.keys(next)) files[p] = { h: next[p].h, s: next[p].s, m: next[p].m };
    if (changed || Object.keys(index).length !== Object.keys(next).length) await writeJson(`${DIR}/index.json`, next);   // a scan that found nothing new writes nothing
    return files;
  }

  // ---- commits ------------------------------------------------------------------------------------------------------------------------
  const head = async () => { try { const st = await folder.stat(`${DIR}/HEAD`); return st.exists ? dec.decode(await folder.read(`${DIR}/HEAD`)).trim() || null : null; } catch { return null; } };
  const readCommit = id => readJson(commitPath(id));
  const readObject = async h => { const o = objectPath(h); return (await exists(o)) ? folder.read(o) : null; };
  /** The files of a commit: its parents' changes folded in order, a null removing the file. */
  async function manifest(id) {
    if (!id) return {};
    const cache = manifests.get(folder) || new Map();
    manifests.set(folder, cache);
    if (cache.has(id)) return cache.get(id);
    const chain = [];
    let base = {};
    for (let c = await readCommit(id); c; c = c.parent && await readCommit(c.parent)) {
      chain.push(c);
      if (c.parent && cache.has(c.parent)) { base = cache.get(c.parent); break; }
    }
    let files = base;
    for (const c of chain.reverse()) {
      files = { ...files };
      for (const [p, e] of Object.entries(c.changes)) { if (e === null) delete files[p]; else files[p] = e; }
      cache.set(c.id, files);
    }
    return files;
  }
  const resolve = async ref => {
    if (!ref || ref === 'HEAD') return head();
    const tags = (await readJson(`${DIR}/tags.json`)) || {};
    if (tags[ref]) return tags[ref];
    const all = await folder.list(`${DIR}/commits`).catch(() => []);
    const hit = all.map(e => e.name.replace(/\.json$/, '')).filter(n => n === ref || n.startsWith(ref));
    return hit.length === 1 ? hit[0] : null;
  };

  /** What differs between two file sets: added, modified, deleted, and a delete + add of the same content as moved. */
  function compare(before, after) {
    const added = [], modified = [], deleted = [];
    for (const [p, e] of Object.entries(after)) { if (!before[p]) added.push(p); else if (before[p].h !== e.h) modified.push(p); }
    for (const p of Object.keys(before)) if (!after[p]) deleted.push(p);
    const moved = [], byHash = new Map(deleted.map(p => [before[p].h, p]));
    for (const p of [...added]) { const from = byHash.get(after[p].h); if (from && after[p].s > 0) { moved.push({ from, to: p }); byHash.delete(after[p].h); added.splice(added.indexOf(p), 1); deleted.splice(deleted.indexOf(from), 1); } }
    // An added file with the content of another file (one kept before, or another path now) is a copy of it, not new work.
    const owners = new Map();
    for (const [p, e] of Object.entries(before)) if (e.s > 0 && !owners.has(e.h)) owners.set(e.h, p);
    for (const [p, e] of Object.entries(after)) if (e.s > 0 && !added.includes(p) && !owners.has(e.h)) owners.set(e.h, p);
    const copied = {};
    for (const p of added) { const of = owners.get(after[p].h); if (of && of !== p) copied[p] = of; }
    return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort(), moved, copied };
  }

  const api = {
    head, resolve, readCommit, manifest, scan, compare,

    /** What changed in the folder since the newest commit. */
    async status() {
      if (fast?.status && !opts.hash && !opts.ignore && !opts.hashOnly) return fast.status();   // the shell does it all (src-tauri/src/history.rs)
      await loadDerived();   // only the page's own scan reads it (storable): the shell's status is asked every five seconds and needs no read of it
      const id = await head(), before = id ? await manifest(id) : {}, after = await scan();
      return { head: id, ...compare(before, after), files: after };
    },

    /**
     * Records the folder as it is: every changed file, or only `paths`. Stores each new content once. Returns { id, changes } or null
     * when nothing changed. `links` are what this change says about files ({ from, to, kind }): a copy, a split, a rebuild.
     */
    async commit({ message = '', by = opts.by || 'Lykos', paths = null, links = [], tag = '' } = {}) {
      if (fast?.commit && !opts.hash && !opts.ignore && !opts.hashOnly && !opts.maxStore) {
        const made = await fast.commit({ message: String(message), by, paths, links, tag });
        return made ? { id: made.id, changes: (await readCommit(made.id))?.changes || {} } : null;
      }
      await loadDerived();
      const parent = await head(), before = parent ? await manifest(parent) : {}, after = await scan();
      const want = p => !paths || paths.includes(p) || paths.some(x => x.endsWith('/') && p.startsWith(x));
      const changes = {}, stored = [];
      for (const [p, e] of Object.entries(after)) {
        if (!want(p) || (before[p] && before[p].h === e.h)) continue;
        const keep = storable(p, e.s);
        changes[p] = { h: e.h, s: e.s, m: e.m, ...(keep ? {} : { hashOnly: true }) };
        if (keep) stored.push(p);
      }
      for (const p of Object.keys(before)) if (want(p) && !after[p]) changes[p] = null;
      if (!Object.keys(changes).length) return null;
      for (const p of stored) {
        const o = objectPath(changes[p].h);
        if (await exists(o)) continue;
        const bytes = await folder.read(p);
        if (await hash(bytes) !== changes[p].h) { delete changes[p]; continue; }   // the file moved on while committing: it is the next commit's
        await ensureDir(parentOf(o));
        try { await folder.writeBytes(o, bytes); } catch (err) { if (!await exists(o)) throw err; }   // another commit stored the same content first
      }
      if (!Object.keys(changes).length) return null;
      if (opts.stat) for (const p of stored) {
        const e = changes[p];
        if (!e || e.s > STAT_MAX) continue;
        try {
          const was = before[p] ? (before[p].hashOnly ? undefined : await readObject(before[p].h)) : null;   // null: a new file; undefined: an earlier version that was not kept
          if (was === undefined || (was === null && before[p])) continue;
          const d = await opts.stat(p, was, await folder.read(p));
          if (d) e.d = d;
        } catch { /* a count is a courtesy: the commit stands without it */ }
      }
      if ((await head()) !== parent) throw new Error('The history moved while committing; commit again.');
      const at = now();
      const id = (await hash(enc.encode(JSON.stringify({ parent, at, changes })))).slice(0, 10);
      await writeJson(commitPath(id), { v: 1, id, parent, at, by, message: String(message).slice(0, 500), changes, links });
      await ensureDir(DIR); await folder.writeText(`${DIR}/HEAD`, id);
      if (tag) await this.tag(tag, id);
      return { id, changes };
    },

    /** The commits, newest first; with `path`, only those that touched it (or a folder prefix). */
    async log({ path = '', limit = 50 } = {}) {
      const out = [];
      for (let c = await head().then(readCommit); c && out.length < limit; c = c.parent && await readCommit(c.parent)) {
        const touched = Object.keys(c.changes).filter(p => !path || p === path || p.startsWith(path.endsWith('/') ? path : `${path}/`));
        if (!path || touched.length) {
          const files = touched.length ? touched : Object.keys(c.changes), deltas = Object.fromEntries(files.filter(f => c.changes[f]?.d).map(f => [f, c.changes[f].d]));
          const sum = Object.values(deltas).reduce((s, d) => ({ a: s.a + (d.a || 0), r: s.r + (d.r || 0), c: s.c + (d.c || 0) }), { a: 0, r: 0, c: 0 });
          out.push({ id: c.id, at: c.at, by: c.by, message: c.message, files, parent: c.parent, links: c.links || [], deltas, delta: sum });
        }
      }
      return out;
    },

    /** One commit: what it changed against its parent. */
    async show(ref) {
      const id = await resolve(ref), c = id && await readCommit(id);
      if (!c) return null;
      const before = c.parent ? await manifest(c.parent) : {}, after = await manifest(id);
      return { id, at: c.at, by: c.by, message: c.message, parent: c.parent, links: c.links || [], ...compare(before, after) };
    },

    /** The history of one file: each commit that changed it, with the hash it then had. */
    async fileLog(path) {
      const out = [];
      for (let c = await head().then(readCommit); c; c = c.parent && await readCommit(c.parent)) {
        if (Object.hasOwn(c.changes, path)) out.push({ id: c.id, at: c.at, by: c.by, message: c.message, parent: c.parent, deleted: c.changes[path] === null, ...(c.changes[path] || {}) });
      }
      return out;
    },

    /** The bytes of a file at a commit, or null when it was not stored. */
    async read(ref, path) {
      const id = await resolve(ref), e = id && (await manifest(id))[path];
      if (!e || e.hashOnly) return null;
      const o = objectPath(e.h);
      return (await exists(o)) ? folder.read(o) : null;
    },

    /** Between two commits ('working' for the folder as it is): the files that differ. */
    async diff(a, b = 'working') {
      const ia = await resolve(a), before = ia ? await manifest(ia) : {};
      const after = b === 'working' ? await scan() : await manifest(await resolve(b));
      return compare(before, after);
    },

    /** The lines that differ between two texts, or null when either is too long to compare here. */
    textDiff(a, b, { maxLines = 4000 } = {}) { return lineDiff(String(a).split('\n'), String(b).split('\n'), maxLines); },

    /**
     * Brings files back as they were at a commit. The folder is committed first (so this can be undone), nothing is deleted, and a file
     * recorded by hash alone is reported, not restored. Returns { restored, skipped, saved, id }.
     */
    async restore(ref, { paths = null, by = opts.by || 'Lykos' } = {}) {
      const target = await resolve(ref);
      if (!target) throw new Error(`No such commit: ${ref}`);
      const files = await manifest(target), pick = Object.keys(files).filter(p => !paths || paths.includes(p) || paths.some(x => x.endsWith('/') && p.startsWith(x)));
      const saved = await this.commit({ message: `Before restoring ${paths ? paths.length === 1 ? paths[0] : `${paths.length} paths` : 'everything'} from ${target}`, by });
      const restored = [], skipped = [];
      const current = await scan();
      for (const p of pick) {
        if (current[p]?.h === files[p].h) continue;
        const bytes = await this.read(target, p);
        if (!bytes) { skipped.push({ path: p, why: files[p].hashOnly ? 'recorded by hash only' : 'content not stored' }); continue; }
        await ensureDir(parentOf(p));
        if (current[p]) await folder.replaceBytes(p, bytes); else await folder.writeBytes(p, bytes);
        restored.push(p);
      }
      const made = restored.length ? await this.commit({ message: `Restore ${restored.length === 1 ? restored[0] : `${restored.length} files`} from ${target}`, by, links: restored.map(p => ({ from: `${p}@${target}`, to: p, kind: 'restored' })) }) : null;
      return { restored, skipped, saved: saved?.id || null, id: made?.id || null };
    },

    /**
     * Names a commit ("v19"); the same name moves. `note` ("Submitted to IJSS") is kept beside the names in tag-notes.json, so tags.json stays
     * { name: id } as the shell reads it (src-tauri/src/history.rs); an empty note removes it.
     */
    async tag(name, ref = 'HEAD', { note } = {}) {
      const id = await resolve(ref), key = String(name).trim();
      if (!id) throw new Error(`No such commit: ${ref}`);
      if (!key) throw new Error('A version needs a name');
      const tags = (await readJson(`${DIR}/tags.json`)) || {};
      tags[key] = id;
      await writeJson(`${DIR}/tags.json`, tags);
      if (note != null) {
        const notes = (await readJson(`${DIR}/tag-notes.json`)) || {};
        if (String(note).trim()) notes[key] = { note: String(note).trim().slice(0, 300), at: now() }; else delete notes[key];
        await writeJson(`${DIR}/tag-notes.json`, notes);
      }
      return id;
    },
    tags: async () => (await readJson(`${DIR}/tags.json`)) || {},
    /** The notes of the named versions: { name: { note, at } }. */
    tagNotes: async () => (await readJson(`${DIR}/tag-notes.json`)) || {},
    /** Takes a name off its commit (the commit stays). */
    async untag(name) {
      const tags = (await readJson(`${DIR}/tags.json`)) || {}, notes = (await readJson(`${DIR}/tag-notes.json`)) || {};
      if (!Object.hasOwn(tags, name)) return false;
      delete tags[name]; await writeJson(`${DIR}/tags.json`, tags);
      if (Object.hasOwn(notes, name)) { delete notes[name]; await writeJson(`${DIR}/tag-notes.json`, notes); }
      return true;
    },
  };
  const commitNow = api.commit;
  api.commit = args => { const q = (queues.get(folder) || Promise.resolve()).then(() => commitNow.call(api, args)); queues.set(folder, q.catch(() => {})); return q; };
  return api;
}

/** A line diff by longest common subsequence: [{ op: ' ' | '+' | '-', text }]. */
export function lineDiff(a, b, maxLines = 4000) {
  if (a.length > maxLines || b.length > maxLines) return null;
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const x = a.slice(s, ea), y = b.slice(s, eb), n = x.length, m = y.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = a.slice(0, s).map(text => ({ op: ' ', text }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out.concat(a.slice(ea).map(text => ({ op: ' ', text })));
}

// ---- a change in words -------------------------------------------------------------------------------------------------------------------
const folderOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = p => p.slice(p.lastIndexOf('/') + 1);
const files = n => `${n} file${n === 1 ? '' : 's'}`;
/** The folders a list of paths falls in, most first: "116 into Old versions/scratch, 114 into …". */
function folders(paths, word, max) {
  const by = new Map();
  for (const p of paths) { const f = folderOf(p).split('/').slice(0, 2).join('/') || 'the top folder'; by.set(f, (by.get(f) || 0) + 1); }   // two levels name a place well enough
  const top = [...by].sort((a, b) => b[1] - a[1]), shown = top.slice(0, max).map(([f, n]) => `${n} ${word} ${f}`);
  return top.length > max ? [...shown, `${top.length - max} more folders`] : shown;
}

/**
 * What changed, as a commit message a person can read: what was modified (by name), added (and how many are copies), moved (into which
 * folders) and deleted (from which). `changes` is what status, diff or show answer. At most `max` characters.
 */
export function describe(changes, { max = 480 } = {}) {
  const { added = [], modified = [], deleted = [], moved = [], copied = {} } = changes || {};
  const copies = added.filter(p => copied[p]).length, fresh = added.filter(p => !copied[p]);
  const parts = [];
  if (modified.length) parts.push(`Changed ${modified.length === 1 ? nameOf(modified[0]) : `${files(modified.length)}: ${modified.slice(0, 4).map(nameOf).join(', ')}${modified.length > 4 ? ', …' : ''}`}`);
  if (fresh.length) parts.push(`Added ${fresh.length === 1 ? nameOf(fresh[0]) : `${files(fresh.length)} (${folders(fresh, 'in', 2).join(', ')})`}`);
  if (copies) parts.push(`Copied ${files(copies)} (${folders(added.filter(p => copied[p]), 'into', 2).join(', ')})`);
  if (moved.length) parts.push(`Moved ${files(moved.length)} (${folders(moved.map(m => m.to), 'into', 3).join(', ')})`);
  if (deleted.length) parts.push(`Deleted ${deleted.length === 1 ? deleted[0] : `${files(deleted.length)} (${folders(deleted, 'from', 2).join(', ')})`}`);
  const text = parts.join('; ') || 'No change';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

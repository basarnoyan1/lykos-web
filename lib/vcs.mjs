// The project's history, git-like: commits, status, log, diff, tags and restore, kept in the project folder under .lykos/vcs/.
//
//   objects/<aa>/<hash>[.gz]   the bytes of a file, once per content (a file that did not change is not stored again); gzip unless the
//                          format is compressed already (since 24 October 2026; both are read)
//   objects/<aa>/<hash>.parts  a large JSON content (4 MB or more: a project section) as the list of its parts, each an object of its own,
//                          so versions share the parts they have in common (lib/parts.mjs, since 31 October 2026)
//   .lykos/project.json#<key>   the project's data, one entry per top-level section, stored like a file: a commit can be restored with its
//                          data, and an edit stores only the sections it changed (since 24 October 2026; src-tauri/src/history.rs the same).
//                          The sections are the joined project's (its records with their abstracts), however the file keeps them: format 2's
//                          head and section files are read and written through the project's reader (since 31 October 2026).
//                          Format 3 (1 November 2026) is recorded as its file keeps it (project-format.mjs headPieces): each key in
//                          the head, each named section, and `#NAME.I` for chunk I of a chunked section (`k` its kind), the records
//                          without their abstracts and `#$abstracts` beside them. An entry's hash is the head's own sha256 of it, so a
//                          commit reads only the chunk files whose hash moved and joins nothing; a restore joins them (show, diff, log
//                          and read group a section's chunks, and the abstracts with the records, under the section's path)
//   commits/<id>.json     one commit: its parent, who, when, why, and what changed ({ path: entry | null }), plus the links it records
//   index.json            a cache of each file's size and time with its hash, so a scan reads only what moved
//   sections.json         the same for the project's section files: each key's source (its sha256 in the head) and the hash of its joined
//                          text, so a commit reads, gunzips and parses only a section whose file moved (since 31 October 2026). Trusted
//                          as index.json is: the history's own file; one deleted or unreadable makes the next commit read every section.
//                          A section file edited by hand without its sha256 in the head is not read by a commit that skips it: the commit
//                          records what the head names (a reader of the project still finds it stale). Format 2's alone: format 3's
//                          entries are by the head's own hashes, and its first commit empties it
//   HEAD                  the id of the newest commit;  tags.json  names for commits ("v19", "Round 19")
//
// A commit never deletes anything and neither does a restore: a file that was deleted comes back, a file that exists now and did not then
// stays, and the current state is committed first so a restore can itself be taken back. A file larger than `maxStore`, or under a
// hash-only folder (papers/, an archive), is recorded by its hash and size alone; it shows in status and log but cannot be restored from here.
//
// Pure apart from the folder it is given (lib/fsys.mjs shape: list, stat, read, writeText, writeBytes, replaceBytes, mkdir). The clock and
// the hash are injectable, and so is the project file's reader and writer (`project`: { read, write }; by default lib/section-files.mjs
// over the folder, loaded on first use; a Node tool passes tools/project-file.mjs). It names no file, folder or project.
export const DIR = '.lykos/vcs';
export const STAT_MAX = 2 * 1024 * 1024;   // a file larger than this is committed without counting its changed lines
export const DEFAULTS = Object.freeze({
  maxStore: 25 * 1024 * 1024,
  hashOnly: ['papers/', 'Papers/', 'Old versions/', 'Archive/'],   // the papers, and folders that already are the archive of an earlier state
  ignore: ['.lykos/', '.git/', 'node_modules/', '__pycache__/', '.DS_Store', '~$', '.~lock.', 'Thumbs.db', 'Lykos project.json'],
});
import { nativeOf } from './vcs-native.mjs';
import { partable, splitParts, joinParts, readManifest } from './parts.mjs';
import { joinChunks, mergeAbstracts } from './project-format.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();

const defaultHash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const parentOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const joinRel = (a, b) => (a ? `${a}/${b}` : b);
const objectPath = h => `${DIR}/objects/${h.slice(0, 2)}/${h}`;
/** The project file, whose sections the history keeps as `.lykos/project.json#<key>` entries (never files of the folder). */
export const PROJECT = '.lykos/project.json';
export const isSection = p => p.startsWith(`${PROJECT}#`);
// { key: { f: the section's source, h: the hash of its joined text } }: what a commit read each section file as (history.rs the same file)
const SECTION_CACHE = `${DIR}/sections.json`;
const filesOnly = m => Object.fromEntries(Object.entries(m).filter(([p]) => !isSection(p)));
// Format 3 records the project as its file keeps it (project-format.mjs headPieces): `#NAME.I` is chunk I of section NAME (its entry says
// `k`, the chunk's kind: 'map' or 'list'), `#$abstracts` (or its chunks) the records' abstracts. A chunk is the file's detail: wherever a
// person sees the history (show, diff, log, fileLog, read, restore by path) a chunk is shown as its section, and the abstracts as papers.
// A project's top-level keys are names, never NAME.DIGITS, so the path alone tells a chunk.
const keyOf = p => p.slice(PROJECT.length + 1);
/** `values` (assemble's) with format 3's `$abstracts` put back on the records and taken off. */
const withAbstracts = values => {
  if (!Object.hasOwn(values, '$abstracts')) return values;
  const { $abstracts: a, ...rest } = values;
  if (a && typeof a === 'object') mergeAbstracts(rest, a);
  return rest;
};
// a chunk is told by its entry (`k`, its kind); a change that takes an entry off (null) has none, and is told by its path, for display only
const isChunk = (p, e) => (e ? !!e.k : /\.\d+$/.test(p));
/** The path a recorded path (with its entry `e`, when there is one) is shown as: a chunk's section's, the abstracts' the records'; any
 *  other path itself. */
export const shownAs = (p, e) => {
  if (!isSection(p)) return p;
  let k = keyOf(p);
  if (isChunk(p, e)) k = k.replace(/\.\d+$/, '');
  return `${PROJECT}#${k === '$abstracts' ? 'papers' : k}`;
};
/** A JSON value's text with every object's keys sorted: two values of the same data have the same one, whatever their key order. */
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
/** The shown paths a commit's changes touch, each once. */
export const shownPaths = changes => [...new Set(Object.entries(changes).map(([p, e]) => shownAs(p, e)))];
/** How a section is kept in `files`: its member keys, a chunk's index left out ('papers.*,$abstracts.*' or 'papers'). */
const formOf = (files, path) => Object.keys(files).filter(p => shownAs(p, files[p]) === path).map(p => (files[p].k ? keyOf(p).replace(/\.\d+$/, '.*') : keyOf(p))).sort().filter((k, i, a) => a.indexOf(k) === i).join(',');
/** A commit's files as a person sees them (shownAs): the entries of one section as one, whose hash is its members' and whose size their sum. */
function grouped(files) {
  const groups = new Map();
  for (const p of Object.keys(files)) { const to = shownAs(p, files[p]); if (to !== p || groups.has(to)) (groups.get(to) || groups.set(to, []).get(to)).push(p); }
  if (!groups.size) return files;
  const out = {};
  for (const [p, e] of Object.entries(files)) if (!groups.has(shownAs(p, e))) out[p] = e;
  for (const [to, members] of groups) {
    if (Object.hasOwn(files, to) && !members.includes(to)) members.push(to);
    if (members.length === 1 && members[0] === to) { out[to] = files[to]; continue; }
    members.sort();
    out[to] = { h: members.map(p => `${keyOf(p)}:${files[p].h}`).join(','), s: members.reduce((n, p) => n + (files[p].s || 0), 0), m: Math.max(...members.map(p => files[p].m || 0)), parts: members.length };
  }
  return out;
}
// formats that are compressed already, stored as they are (history.rs PACKED)
const PACKED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'gz', 'tgz', '7z', 'mp4', 'mov', 'm4a', 'mp3', 'woff', 'woff2', 'pzfx']);
const extOfPath = p => { const b = p.slice(p.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const gzipBytes = bytes => pipeBytes(bytes, new CompressionStream('gzip'));
const gunzipBytes = bytes => pipeBytes(bytes, new DecompressionStream('gzip'));
const commitPath = id => `${DIR}/commits/${id}.json`;
// The project file read joined (lib/section-files.mjs, loaded with the first use: the history's own graph stays small) and written by the
// app's one writer, the folder backend (lib/projects.mjs folderBackend: the folder's format, its sections, the head's lock and the day's
// copy). read(): the project, or null when there is none; it throws when the file does not read or its sections are from different moments.
let sectionFiles = null;
const sectionsModule = () => (sectionFiles ??= import('./section-files.mjs'));
const STALE = 'The project file changed while restoring; restore again.';
// head(): the project file's hash now (null: there is none); write(state, base) refuses, by throwing, when the file is no longer `base`.
// sections(skip): the read a commit makes, the sections `skip(key, source)` keeps left unread ({ project, sources, skipped }, or null).
const folderProject = folder => ({
  read: async () => ((await folder.stat(PROJECT).catch(() => null))?.exists ? (await sectionsModule()).readFolderProject(folder) : null),
  sections: async skip => ((await folder.stat(PROJECT).catch(() => null))?.exists ? (await sectionsModule()).readFolderSections(folder, skip) : null),
  head: async () => (await sectionsModule()).headHash(folder),
  async write(state, base) {
    // the backend writes only over the file it read; that file must still be `base`, read after it so nothing lands between unseen
    const backend = (await import('./projects.mjs')).folderBackend(folder, 'history-restore', { staleWaits: [] });
    await backend.read();
    if (base !== undefined && await (await sectionsModule()).headHash(folder) !== base) throw new Error(STALE);
    // the commit's project as it is (not the store's export), handed over as the store's save hands it: per section, in the folder's format
    const exported = { ...state, format: backend.fileFormat() };
    delete exported.$sections;
    const abstracts = backend.keepAbstracts ? await backend.keepAbstracts(exported) : null;
    const { sectionParts } = await import('../store.mjs');
    // a restore is a person's choice of an earlier project: its log may be shorter than today's (logShrinks, lib/projects.mjs)
    if ((await backend.write(exported, { parts: sectionParts(exported), abstracts, format: exported.format, logShrinks: true }))?.stale) throw new Error(STALE);
  },
});

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
  const project = opts.project || folderProject(folder);
  const policy = { ...DEFAULTS, ...Object.fromEntries(['maxStore', 'hashOnly', 'ignore'].filter(k => opts[k] != null).map(k => [k, opts[k]])) };
  const readJson = async rel => { try { const st = await folder.stat(rel); return st.exists ? JSON.parse(dec.decode(await folder.read(rel))) : null; } catch { return null; } };
  const exists = async rel => { try { return (await folder.stat(rel)).exists; } catch { return false; } };
  async function ensureDir(rel) {
    if (!rel || await exists(rel)) return;
    await ensureDir(parentOf(rel));
    // two callers (the page's load and the recorder, or a page mounted twice) may both find it missing: the second mkdir is refused as taken, which is fine
    try { await folder.mkdir(rel); } catch (err) { if (!await exists(rel)) throw err; }
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
  const readObject = async h => {
    const o = objectPath(h);
    if (await exists(o)) return folder.read(o);
    if (await exists(`${o}.gz`)) return gunzipBytes(await folder.read(`${o}.gz`));
    // a large JSON content kept in parts (lib/parts.mjs): its parts joined, and checked against its hash
    if (await exists(`${o}.parts`)) {
      const m = readManifest(dec.decode(await folder.read(`${o}.parts`)));
      if (m) {
        const chunks = [];
        for (const p of m.parts) { const c = await readObject(p); if (!c) return null; chunks.push(c); }
        const bytes = joinParts(chunks, m.size);
        if (await hash(bytes) === h) return bytes;
      }
      return null;
    }
    return archivedFile(h);
  };
  // A content history no longer keeps a copy of because a file in papers/, Old versions/ or Archive/ holds it (tools/lykos-compact.mjs):
  // that file, found by its hash in the scan's index and read only if it still has that hash.
  const archivedFile = async h => {
    const index = (await readJson(`${DIR}/index.json`)) || {};
    for (const [p, e] of Object.entries(index)) {
      if (e?.h !== h || !policy.hashOnly.some(x => p.startsWith(x))) continue;
      try { const bytes = await folder.read(p); if (await hash(bytes) === h) return bytes; } catch { /* moved since the scan */ }
    }
    return null;
  };
  const hasObject = async h => (await exists(objectPath(h))) || (await exists(`${objectPath(h)}.gz`)) || exists(`${objectPath(h)}.parts`);
  const storeObject = async (h, bytes, pack) => {
    if (await hasObject(h)) return;
    // a large JSON content (a project section, a project) is kept in parts that later versions share: its parts first, then their list
    const split = pack && partable(bytes) ? splitParts(bytes) : null;
    if (split && split.parts.length > 1) {
      const { parts, manifest } = split, hashes = [];
      for (const p of parts) { const ph = await hash(p); hashes.push(ph); await storeObject(ph, p, true); }
      const o = `${objectPath(h)}.parts`;
      await ensureDir(parentOf(o));
      try { await folder.writeBytes(o, enc.encode(JSON.stringify(manifest(hashes)))); } catch (err) { if (!await hasObject(h)) throw err; }
      return;
    }
    const o = pack ? `${objectPath(h)}.gz` : objectPath(h);
    await ensureDir(parentOf(o));
    try { await folder.writeBytes(o, pack ? await gzipBytes(bytes) : bytes); } catch (err) { if (!await hasObject(h)) throw err; }   // another commit stored the same content first
  };
  /** The joined project's top-level sections, each as its JSON text, with the project file's time; null when there is none or it does not
   *  read now (a sync still bringing its sections: the next commit records them). A section file whose source (project-format.mjs
   *  sectionSources: its sha256 in the head) is the one the section cache says was last read, as the text `before` (the last commit)
   *  records, is not read, gunzipped or parsed: it is in `kept`, unchanged. `sources` and `cache` are for the cache's next state. */
  const sectionsNow = async before => {
    try {
      const st = await folder.stat(PROJECT);
      if (!st.exists) return null;
      const cache = project.sections ? (await readJson(SECTION_CACHE)) || {} : {};
      // a format-3 piece (the reader says `piece`) is the file's own text: its hash in the head is the one its entry records
      const same = (k, source, piece) => (piece ? typeof source === 'string' && before[`${PROJECT}#${k}`]?.h === source
        : cache[k]?.f === source && typeof cache[k].h === 'string' && before[`${PROJECT}#${k}`]?.h === cache[k].h);
      const read = project.sections ? await project.sections(same) : { project: await project.read(), sources: {}, skipped: [] };
      if (read?.pieces) {
        const parts = read.pieces.filter(x => typeof x.text === 'string').map(x => [x.key, enc.encode(x.text), x.kind]);
        return { m: st.mtime || 0, parts, kept: read.skipped || [], sources: {}, cache, pieces: true };
      }
      const data = read?.project;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return { m: st.mtime || 0, parts: Object.entries(data).map(([k, v]) => [k, enc.encode(JSON.stringify(v) ?? 'null')]), kept: read.skipped || [], sources: read.sources || {}, cache };
    } catch { return null; }
  };
  /** The project's data of `members` (section paths of `files`) by top-level key: a section whole, a chunked one joined from its chunks
   *  in order (each by its entry's kind); null when a content is not stored, does not parse, or a chunk is missing. */
  const assemble = async (files, members) => {
    const out = {}, chunks = new Map();
    for (const p of members) {
      const k = keyOf(p), c = files[p].k ? /^(.+)\.(\d+)$/.exec(k) : null, b = await readObject(files[p].h);
      if (!b) return null;
      const t = dec.decode(b);
      if (c) { if (!chunks.has(c[1])) chunks.set(c[1], []); chunks.get(c[1])[Number(c[2])] = { t, k: files[p].k }; continue; }
      try { out[k] = JSON.parse(t); } catch { return null; }
    }
    for (const [name, list] of chunks) {
      if (Array.from(list).some(x => !x)) return null;
      try { out[name] = joinChunks({ kind: list[0].k, chunks: list }, list.map(x => x.t)); } catch { return null; }
    }
    return out;
  };
  /** A section's JSON text as `files` (a manifest) holds it, joined when it is kept by chunks or beside its abstracts; null when it is not
   *  there or not stored. */
  const sectionBytes = async (files, path) => {
    const members = Object.keys(files).filter(p => shownAs(p, files[p]) === path);
    if (members.length === 1 && members[0] === path) return files[path].hashOnly ? null : readObject(files[path].h);
    if (!members.length) return null;
    const values = await assemble(files, members), v = values && withAbstracts(values)[keyOf(path)];
    return v === undefined ? null : enc.encode(JSON.stringify(v));
  };
  /** Whether a section kept in another form in `after` than in `before` (whole and chunks, the move to format 3, a section crossing
   *  CHUNK_MIN) holds the same data: its joined texts are equal. Read only on such a move. */
  const sameData = async (before, after, path) => {
    if (formOf(before, path) === formOf(after, path)) return false;
    const [a, b] = await Promise.all([sectionBytes(before, path), sectionBytes(after, path)]);
    if (!a || !b) return false;
    // the data, not the text: a map joined from its chunks has its keys in bucket order (Ruling 4), the whole one in insertion order
    try { return canonical(JSON.parse(dec.decode(a))) === canonical(JSON.parse(dec.decode(b))); } catch { return false; }
  };
  /** compare, with a section that only changed form and holds the same data taken off `modified`. */
  const compareData = async (before, after) => {
    const r = compare(before, after), keep = [];
    for (const p of r.modified) if (!isSection(p) || !await sameData(before, after, p)) keep.push(p);
    return { ...r, modified: keep };
  };
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

  /** What differs between two file sets: added, modified, deleted, and a delete + add of the same content as moved. The project's data
   *  by section as a person sees it (grouped), never moved or copied. */
  function compare(before, after) {
    before = grouped(before); after = grouped(after);
    const added = [], modified = [], deleted = [];
    for (const [p, e] of Object.entries(after)) { if (!before[p]) added.push(p); else if (before[p].h !== e.h) modified.push(p); }
    for (const p of Object.keys(before)) if (!after[p]) deleted.push(p);
    const moved = [], byHash = new Map(deleted.filter(p => !isSection(p)).map(p => [before[p].h, p]));
    for (const p of [...added]) { const from = !isSection(p) && byHash.get(after[p].h); if (from && after[p].s > 0) { moved.push({ from, to: p }); byHash.delete(after[p].h); added.splice(added.indexOf(p), 1); deleted.splice(deleted.indexOf(from), 1); } }
    // An added file with the content of another file (one kept before, or another path now) is a copy of it, not new work.
    const owners = new Map();
    for (const [p, e] of Object.entries(before)) if (e.s > 0 && !isSection(p) && !owners.has(e.h)) owners.set(e.h, p);
    for (const [p, e] of Object.entries(after)) if (e.s > 0 && !isSection(p) && !added.includes(p) && !owners.has(e.h)) owners.set(e.h, p);
    const copied = {};
    for (const p of added) { const of = !isSection(p) && owners.get(after[p].h); if (of && of !== p) copied[p] = of; }
    return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort(), moved, copied };
  }

  const api = {
    head, resolve, readCommit, manifest, scan, compare,

    /** What changed in the folder since the newest commit. */
    async status() {
      if (fast?.status && !opts.hash && !opts.ignore && !opts.hashOnly) return fast.status();   // the shell does it all (src-tauri/src/history.rs)
      await loadDerived();   // only the page's own scan reads it (storable): the shell's status is asked every five seconds and needs no read of it
      const id = await head(), before = id ? filesOnly(await manifest(id)) : {}, after = await scan();
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
      for (const p of Object.keys(before)) if (!isSection(p) && want(p) && !after[p]) changes[p] = null;
      for (const p of stored) {
        if (await hasObject(changes[p].h)) continue;
        const bytes = await folder.read(p);
        if (await hash(bytes) !== changes[p].h) { delete changes[p]; continue; }   // the file moved on while committing: it is the next commit's
        await storeObject(changes[p].h, bytes, !PACKED.has(extOfPath(p)));
      }
      // the project's data, section by section: only a section whose text changed is stored
      if (want(PROJECT)) {
        const now = await sectionsNow(before);
        if (now) {
          const here = new Set(now.kept.map(k => `${PROJECT}#${k}`)), cache = {};
          if (!now.pieces) for (const k of now.kept) cache[k] = now.cache[k];
          for (const [k, bytes, kind] of now.parts) {
            const p = `${PROJECT}#${k}`, h = await hash(bytes);
            here.add(p);
            if (now.sources[k]) cache[k] = { f: now.sources[k], h };
            if (before[p]?.h === h) continue;
            await storeObject(h, bytes, true);
            changes[p] = { h, s: bytes.length, m: now.m, ...(kind ? { k: kind } : {}) };
          }
          for (const p of Object.keys(before)) if (isSection(p) && !here.has(p)) changes[p] = null;
          // the section cache (what each section file's text hashed to), written when it moved: the content of each is stored by now
          const sorted = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
          // advisory: a cache not written only means the next commit reads those sections again
          if (project.sections && sorted(cache) !== sorted(now.cache)) await writeJson(SECTION_CACHE, JSON.parse(sorted(cache))).catch(() => {});
        }
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
        const touched = shownPaths(c.changes).filter(p => !path || p === path || p.startsWith(path.endsWith('/') ? path : `${path}/`));
        if (!path || touched.length) {
          const files = touched.length ? touched : shownPaths(c.changes), deltas = Object.fromEntries(files.filter(f => c.changes[f]?.d).map(f => [f, c.changes[f].d]));
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
      return { id, at: c.at, by: c.by, message: c.message, parent: c.parent, links: c.links || [], ...await compareData(before, after) };
    },

    /** The history of one file: each commit that changed it, with the hash it then had. */
    async fileLog(path) {
      const out = [];
      for (let c = await head().then(readCommit); c; c = c.parent && await readCommit(c.parent)) {
        if (isSection(path) && Object.entries(c.changes).some(([p, e]) => p !== path && shownAs(p, e) === path)) {
          // a section recorded by chunks, or moving between whole and chunks: its entry is the section's as the commit leaves it, deleted
          // only when nothing of it is left; a move of form that keeps the same data is no change of it
          const files = await manifest(c.id), was = c.parent ? await manifest(c.parent) : {}, e = grouped(files)[path];
          if (e && grouped(was)[path] && await sameData(was, files, path)) continue;
          out.push({ id: c.id, at: c.at, by: c.by, message: c.message, parent: c.parent, deleted: !e, ...(e || {}) });
        } else if (Object.hasOwn(c.changes, path)) out.push({ id: c.id, at: c.at, by: c.by, message: c.message, parent: c.parent, deleted: c.changes[path] === null, ...(c.changes[path] || {}) });
      }
      return out;
    },

    /** The bytes of a file at a commit, or null when it was not stored. A section of the project's data recorded by chunks, or the
     *  records with their abstracts beside them (format 3), reads joined: the section's JSON text, the records with their abstracts. */
    async read(ref, path) {
      const id = await resolve(ref), files = id ? await manifest(id) : {}, e = files[path];
      if (isSection(path)) return sectionBytes(files, path);
      if (!e || e.hashOnly) return null;
      return readObject(e.h);
    },

    /** A file's entry at a commit as a person sees it ({ h, s, m, hashOnly? }; a section recorded by chunks as one), or null. */
    async entry(ref, path) {
      const id = await resolve(ref);
      return (id && grouped(await manifest(id))[path]) || null;
    },

    /** Between two commits ('working' for the folder as it is): the files that differ. */
    async diff(a, b = 'working') {
      const ia = await resolve(a), before = ia ? await manifest(ia) : {};
      const after = b === 'working' ? await scan() : await manifest(await resolve(b));
      return b === 'working' ? compare(filesOnly(before), after) : compareData(before, after);
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
      const files = await manifest(target), pick = Object.keys(files).filter(p => !paths || paths.includes(p) || paths.some(x => x.endsWith('/') && p.startsWith(x)) || (isSection(p) && (paths.includes(PROJECT) || paths.includes(shownAs(p, files[p])))));
      const sections = pick.filter(isSection);
      // the project file as it is before anything is committed: a save after this moment makes the restore's write stale, not lost
      const base = sections.length && project.head ? await project.head() : undefined;
      const saved = await this.commit({ message: `Before restoring ${paths ? paths.length === 1 ? paths[0] : `${paths.length} paths` : 'everything'} from ${target}`, by });
      const restored = [], skipped = [];
      const current = await scan();
      // the project's data: its sections put back together and written through the project's writer, in the folder's format (the app
      // reads it again, lib/agent-activity.mjs). The whole project is the commit's sections alone; some sections go over the project as it is.
      if (sections.length) {
        const whole = !paths || paths.includes(PROJECT);
        // a project file that is there but does not read (a sync still bringing its sections, a half-written head) is never written over:
        // the commit before could not record it, so nothing could take the restore back
        let now = null, unreadable = false;
        try { now = await project.read(); } catch { unreadable = true; }
        const state = whole ? {} : { ...(now || {}) };
        // each section whole, or joined from its chunks (format 3); the abstracts back on the records
        const values = await assemble(files, sections), missing = !values;
        if (values) Object.assign(state, withAbstracts(values));
        // a commit made while format 1 kept the abstracts beside the file has records without any abstract: they keep the ones they have now
        // (a later commit's record without one had none, and stays so)
        if (Array.isArray(state.papers) && Array.isArray(now?.papers) && !state.papers.some(r => typeof r?.abstract === 'string')) {
          const had = new Map(now.papers.filter(r => typeof r?.abstract === 'string').map(r => [r.id, r.abstract]));
          if (had.size) state.papers = state.papers.map(r => (r && typeof r === 'object' && had.has(r.id) ? { ...r, abstract: had.get(r.id) } : r));
        }
        // a commit made before 31 October 2026 of a format-2 folder recorded its head (`$sections`, no large sections): not a whole project
        if (sections.includes(`${PROJECT}#$sections`)) skipped.push({ path: PROJECT, why: 'that commit recorded the project file\'s head, not its sections' });
        else if (missing) skipped.push({ path: PROJECT, why: 'content not stored' });
        else if (unreadable) skipped.push({ path: PROJECT, why: 'the project file could not be read; the folder may still be syncing' });
        else {
          await project.write(state, base);
          restored.push(PROJECT);
        }
      }
      for (const p of pick) {
        if (isSection(p)) continue;
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

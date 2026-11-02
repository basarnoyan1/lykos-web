// The folder backend's reading and writing of a project file's sections (format 2, lib/project-format.mjs; docs/superpowers/specs/
// 2026-10-31-project-sections-design.md): loaded with the first read (lib/projects.mjs folderBackend). A head with `format: 2` names each
// large section, a gzip file in .lykos/project/ named by its hash. Read: the head, then each file it names, checked against its hash.
// Written: the sections whose hash changed, then the head (the caller's commit), then the files no head names once 60 s old.
// Format 3 (docs/superpowers/specs/2026-11-01-chunked-sections-design.md): a large section is in chunk files, each read side by side,
// checked against its own hash and recovered alone; a save writes only the chunks whose file the head on disk does not name.
// A named file that is missing or damaged (another machine's prune, synced) is taken from the history's store or the newest copy in
// .lykos/backups that holds it, and put back; only when neither has it is the read stale (recoverer).
// Also the readers of a folder that is not open (readFolderProject, projectFromFiles), kept here so the shell's first load stays small.
import { store$assertProject as assertProject } from "../boot.mjs";
// FORMAT here is the app's (APP_FORMAT, 3, store.mjs PROJECT_FORMAT): the highest format it reads and keeps
import { sectionFile, APP_FORMAT as FORMAT, WRITE_FORMAT, CHUNKED, CHUNK_MIN, ABSTRACTS, SIDECAR, SECTION_GRACE, PRUNABLE, graceOf, readSidecar, mergeAbstracts, stripAbstracts, namedSections, namedFiles, joinProject, splitParts, isSection, isChunked, chunkFile, chunkSection, chunkTexts, joinChunks, sectionSources, headPieces, sectionTextOf, sectionValueOf, lateLogChunks } from './project-format.mjs';
import { readManifest, joinParts } from './parts.mjs';
import { lib_files$documentHash as documentHash } from "../boot.mjs";
import { lib_gzip$gzipText as gzipText, lib_gzip$textOf as textOf } from "../boot.mjs";
import { lib_timings$timing as timing } from "../boot.mjs";

export { FORMAT, WRITE_FORMAT, ABSTRACTS, CHUNKED, namedSections, mergeAbstracts, lateLogChunks };
/** The first format whose head names section files: a folder of this format or later is written as a head and its files. */
export const SECTIONED = 2;
export const SECTIONS_DIR = '.lykos/project';
const REFRESH_AFTER = SECTION_GRACE / 2;   // a reused file older than this is written again before a head names it
const decode = bytes => new TextDecoder().decode(bytes);
// A turn for the page between sections, once 8 ms of reading went by since the last: not a timer of 0, which WebKit holds 4 ms once timers
// nest (a turn per section made the 44 sections of the ASD review wait about 180 ms, 1 Nov 2026), but a message (setImmediate in Node).
const turn = typeof setImmediate === 'function' ? () => new Promise(r => setImmediate(r)) : typeof MessageChannel === 'function' ? (() => {
  const c = new MessageChannel(), waiting = [];
  c.port1.onmessage = () => waiting.shift()?.();
  return () => new Promise(r => { waiting.push(r); c.port2.postMessage(0); });
})() : () => new Promise(r => setTimeout(r, 0));
let turnAt = 0;
const breathe = async () => { if (performance.now() - turnAt < 8) return; await turn(); turnAt = performance.now(); };
const FILE = '.lykos/project.json';
const parseHead = text => { try { return JSON.parse(text); } catch { throw new Error(`${FILE} could not be read as a project file (it may be incomplete or damaged); it was left as it is`); } };

/** A section the head names is missing or does not match its hash: the head and its sections are from different moments (a sync client
 * still bringing the files). Never opened as an empty project, never saved over. */
export class StaleProject extends Error {
  constructor(message) { super(`${message}; the folder may still be syncing, so the project was left as it is`); this.name = 'StaleProject'; this.stale = true; }
}
const gunzipBytes = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
export const gzipBytes = async data => new Uint8Array(await (await gzipText(data)).arrayBuffer());
/** A folder's file as bytes, or null when it is not there. */
export const fileReader = f => async rel => ((await f.stat(rel).catch(() => null))?.exists ? f.read(rel) : null);
/** The format a head is written in: format 2 stays format 2 and format 3 format 3; format 1, or none, is WRITE_FORMAT, except in a folder
 *  `f` that writes only text (no writeBytes for the gzip section files), which stays format 1. */
export const formatOf = (head, f = null) => (typeof head?.format === 'number' && head.format >= SECTIONED ? (head.format >= CHUNKED ? CHUNKED : SECTIONED) : f && !f.writeBytes ? 1 : WRITE_FORMAT);

/** A head's `$sections` entries as this backend keeps them (name -> entry): { file, sha256, bytes }, or a chunked one's { kind, buckets |
 *  per, chunks }. A section inline in the head is not named: the next save splits it again. */
export const entriesOf = head => new Map(namedSections(head).filter(e => !(e.name in head)).map(({ name, ...e }) => [name, isChunked(e)
  ? { kind: e.kind, ...(e.kind === 'map' ? { buckets: e.buckets } : { per: e.per }), chunks: e.chunks }
  : { file: e.file, sha256: e.sha256, bytes: e.bytes }]));
/** What an entry is, as a text two entries share only when they name the same content: a section's sha256, a chunked one's split and the
 *  sha256 of each chunk (the store's read again compares sections by it, lib/projects.mjs). */
export const entryKey = e => (!e ? null : isChunked(e) ? `${e.kind}/${e.kind === 'map' ? e.buckets : e.per}/${e.chunks.map(c => (Array.isArray(c) ? c[0] : '')).join(',')}` : e.sha256);
/** The names (in .lykos/project/) of every file the entries (name -> entry) name: the sections' and every chunk's (namedFiles). */
const fileNames = entries => namedFiles({ $sections: Object.fromEntries(entries) }).map(e => String(e.file).split('/').pop());
/** The files of a chunked entry, each as sectionText reads it: { name, file, sha256, chunk: { entry, index } }; of an entry with a
 *  `range` ([from, to), joinHead's `ranges`), only those chunks, by their own index. */
const chunksOf = (name, entry) => {
  const all = entry.chunks.map((c, index) => {
    const sha256 = Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '';
    return { name, file: chunkFile(name, index, sha256), sha256, chunk: { entry, index } };
  });
  return entry.range ? all.slice(entry.range[0], entry.range[1]) : all;
};

/** The files of a named section, each as sectionText reads it: a section file's entry, or a chunked one's chunks in order. */
const filesOf = e => (isChunked(e) ? chunksOf(e.name, e) : [e]);
/** What the shell's reads of a head's sections (fsys readSections, main.rs lykosfile POST) are asked for: every file of the sections
 *  `wanted`, in order, as [file, sha256, bytes] (bytes: the head's size of its text, to batch them). */
export const filesWanted = wanted => wanted.flatMap(e => (isChunked(e) ? e.chunks.map((c, i) => { const h = Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '';
  return [chunkFile(e.name, i, h), h, Array.isArray(c) ? c[1] : 0]; }).slice(...(e.range || [0])) : [[e.file, e.sha256, e.bytes]]));
// The files are asked for in batches of about BATCH bytes of text, several at once while the answers not yet taken hold under AHEAD
// bytes, at most INFLIGHT requests (project-prefetch.js asks for the first ones the same way): each answer is dropped once its texts are
// decoded, so the open holds the parsed project, one text and the answers ahead, never every section's text and the whole answer at
// once (1 Nov 2026: one 122 MB answer and 242 MB of strings beside the parsed Sham review).
export const BATCH = 4e6, AHEAD = 128e6, INFLIGHT = 6;
// After a section of COLLECT bytes of text or more the open asks the shell for a collection (mac.rs release_memory): its text and the
// answers it came in are garbage by then, and WebKit, left to itself, held them past the first view (1 Nov 2026, Sham review clones: the
// open's web content footprint 1.15-1.28 GB in format 2 and 1.15-1.21 GB in format 3 with one answer, 0.70-0.87 and 0.59-0.61 GB now).
const COLLECT = 8e6;
const shellCollect = () => globalThis.__TAURI_INTERNALS__?.invoke?.('release_memory', { full: false });
/** The batches of files of these sizes: [from, to) index ranges, each closed before it would pass BATCH (a larger file alone). */
export function batchesOf(sizes) {
  const out = [];
  let from = 0, n = 0;
  sizes.forEach((b, i) => { const s = Number(b) > 0 ? Number(b) : 0; if (i > from && n + s > BATCH) { out.push([from, i]); from = i; n = 0; } n += s; });
  if (sizes.length > from) out.push([from, sizes.length]);
  return out;
}
/** The shell's answer to one batch: the texts one after another, a newline, then their lengths in bytes, comma-separated (-1 for a file
 *  it did not read: missing, damaged, not named as a head names it). Answers { bytes, at: [start or -1], lens } for `n` files, or null
 *  when the answer is not one. */
export function answerOf(buffer, n) {
  const bytes = buffer ? new Uint8Array(buffer) : null;
  const nl = bytes ? bytes.lastIndexOf(10) : -1;
  if (nl < 0) return null;
  const lens = decode(bytes.subarray(nl + 1)).split(',').map(Number);
  if (lens.length !== n || lens.some(l => !Number.isInteger(l) || l < -1)) return null;
  let at = 0;
  const starts = lens.map(l => { if (l < 0) return -1; const s = at; at += l; return s; });
  return at === nl ? { bytes, at: starts, lens } : null;
}
/**
 * The shell's reads of the files `list` ([file, sha256, bytes], filesWanted) through `post(files)` (an answer's ArrayBuffer or null):
 * answers take(i), the text of file i or null (the reader then reads that file itself). `early`: the prefetch's { files, batches,
 * answers } for the same list, its answers taken first. A batch's answer is dropped as soon as its last text is decoded.
 */
export function sectionsReader(post, list, early = null, { inflight = INFLIGHT, ahead: most = AHEAD } = {}) {
  const same = !!early && Array.isArray(early.files) && Array.isArray(early.batches) && Array.isArray(early.answers)
    && early.files.length === list.length && early.files.every((x, i) => x[0] === list[i][0] && x[1] === list[i][1]);
  const batches = same ? early.batches : batchesOf(list.map(x => x[2]));
  const size = batches.map(([a, z]) => { let n = 0; for (let i = a; i < z; i++) n += Number(list[i][2]) > 0 ? Number(list[i][2]) : 0; return n; });
  const of = new Array(list.length);
  batches.forEach(([a, z], b) => { for (let i = a; i < z; i++) of[i] = b; });
  const answers = new Array(batches.length).fill(null), left = batches.map(([a, z]) => z - a);
  let next = 0, ahead = 0, flying = 0;
  const ask = b => {
    const [a, z] = batches[b];
    const p = same && b < early.answers.length ? Promise.resolve(early.answers[b]) : Promise.resolve().then(() => post(list.slice(a, z).map(x => [x[0], x[1]])));
    ahead += size[b]; flying++;
    answers[b] = p.then(buf => answerOf(buf, z - a), () => null).finally(() => { flying--; pump(); });
  };
  // always one asked; more while the answers ahead stay under AHEAD bytes and INFLIGHT requests
  const pump = () => { while (next < batches.length && (ahead === 0 || (ahead + size[next] <= most && flying < inflight))) ask(next++); };
  if (same) while (next < early.answers.length && next < batches.length) ask(next++);
  pump();
  return async i => {
    const b = of[i];
    if (b === undefined) return null;
    while (!answers[b] && next <= b) ask(next++);
    const r = await answers[b], k = i - batches[b][0];
    const t = r && r.at[k] >= 0 ? decode(r.bytes.subarray(r.at[k], r.at[k] + r.lens[k])) : null;
    if (--left[b] === 0) { answers[b] = null; ahead -= size[b]; pump(); }
    return t;
  };
}

async function sectionText(e, readFile, recover) {
  const bytes = typeof e.file === 'string' && /^project\/[^/]+\.json\.gz$/.test(e.file) ? await readFile(`.lykos/${e.file}`).catch(() => null) : null;
  let raw = null, why = 'is not in the folder';
  if (bytes) {
    try { raw = await gunzipBytes(bytes); why = (await documentHash(raw)) === e.sha256 ? null : 'does not match its hash'; } catch { why = 'could not be read'; }
  }
  if (!why) return decode(raw);
  const back = recover ? await recover(e).catch(() => null) : null;
  if (back != null) return back;
  throw new StaleProject(`the project file names ${e.file || 'a file'} for ${e.name}, which ${why}, and neither the history nor a copy holds it`);
}

const OBJECTS = '.lykos/vcs/objects';
/** A content of the history's store (lib/vcs.mjs: plain, gzip or in parts), checked against its hash; null when it is not there. */
async function storedBytes(readFile, h) {
  const o = `${OBJECTS}/${h.slice(0, 2)}/${h}`;
  let b = await readFile(o).catch(() => null);
  if (!b) { const z = await readFile(`${o}.gz`).catch(() => null); b = z && await gunzipBytes(z).catch(() => null); }
  if (!b) {
    const m = await readFile(`${o}.parts`).then(t => t && readManifest(decode(t))).catch(() => null);
    if (m) {
      const chunks = [];
      for (const p of m.parts) { const c = await storedBytes(readFile, p); if (!c) return null; chunks.push(c); }
      try { b = joinParts(chunks, m.size); } catch { return null; }
    }
  }
  return b && (await documentHash(b)) === h ? b : null;
}

/**
 * The recovery of a named section whose file is missing or damaged, for a folder `f`: its text from the history's store (lib/vcs.mjs keeps
 * each top-level key's JSON text by its sha256, the section's own for every section but `papers` and `$abstracts`), else from the newest
 * copy in .lykos/backups that holds it (sectionTextOf; each copy parsed once per read). A chunk (`e.chunk`: { entry, index }) the same
 * way: the store by the chunk's hash, else chunk `index` of the copy's section split as the entry says. The file is put back where the
 * folder can write (its name is its content: the next save, which writes only what changed, then names a file that is there). Answers
 * e => text or null.
 */
export function recoverer(f) {
  const readFile = fileReader(f);
  let copies = null;
  const parsed = [], splits = new Map();
  // a copy's section split as a chunked entry says (chunkTexts), once per copy and section; chunk i by index (Ruling 5)
  const fromCopy = (i, e) => {
    if (!e.chunk) return sectionTextOf(parsed[i], e.name);
    const k = `${i}\n${e.name}`;
    if (!splits.has(k)) { const v = sectionValueOf(parsed[i], e.name); splits.set(k, v === undefined ? null : chunkTexts(v, e.chunk.entry)); }
    return splits.get(k)?.[e.chunk.index];
  };
  return async e => {
    if (typeof e?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) return null;
    let text = null, from = 'the history';
    const stored = await storedBytes(readFile, e.sha256).catch(() => null);
    if (stored) text = decode(stored);
    if (text == null) {
      copies ??= (await f.list('.lykos/backups').catch(() => [])).filter(r => !r.dir && /^project-.+\.json(\.gz)?$/.test(r.name)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      for (let i = 0; i < copies.length && text == null; i++) {
        if (i >= parsed.length) {
          let state = null;
          try {
            const raw = await f.read(`.lykos/backups/${copies[i].name}`);
            let bytes = copies[i].name.endsWith('.gz') ? await gunzipBytes(raw) : raw;
            if (copies[i].name.endsWith('.ref.json')) { const r = JSON.parse(decode(bytes)); bytes = r?.kind === 'lykos-backup-ref' ? await storedBytes(readFile, String(r.h)) : null; }
            state = bytes ? JSON.parse(decode(bytes)) : null;
          } catch { state = null; }
          parsed.push(state);
        }
        const t = parsed[i] && fromCopy(i, e);
        if (t !== undefined && t !== null && (await documentHash(new TextEncoder().encode(t))) === e.sha256) { text = t; from = 'a copy in .lykos/backups'; }
      }
    }
    if (text == null) return null;
    const rel = `.lykos/${e.file}`;
    if (f.writeBytes && typeof e.file === 'string' && e.file.startsWith('project/') && PRUNABLE.test(e.file.slice(8))) {
      try {
        const gz = await gzipBytes(text);
        if ((await f.stat(rel).catch(() => ({}))).exists) { if (f.replaceBytes) await f.replaceBytes(rel, gz); } else await f.writeBytes(rel, gz);
      } catch { /* a folder that cannot take it: the text is enough for this read */ }
    }
    console.warn(`Lykos: ${e.file} was missing or damaged; it was taken from ${from} and put back`);
    return text;
  };
}

/**
 * The project of a parsed head, with `readFile(rel)` (bytes or null; rel from the project folder) for the files beside it: each section a
 * format-2 head names joined in (one inline in the head wins), and the abstracts put back on their records, from `$abstracts` or, when the
 * head names none, from format 1's sidecar (Ruling 3). Answers { project, abstracts: { id: text }, named: whether the head names
 * `$abstracts` }. `withAbstracts: false` leaves them out (a reader of the tasks or counts); `skip`: names of sections not read (left out);
 * `recover` (recoverer(f)): what a missing or damaged section is taken from before the read is stale. `bulk`: the shell's reads (bulkOf);
 * `collect`: asked for after a large section (COLLECT), the shell's collection by default with `bulk`. Throws StaleProject.
 */
export async function joinHead(head, readFile, { withAbstracts = true, skip = null, recover = null, bulk = null, collect = bulk ? shellCollect : null, ranges = null } = {}) {
  const parsed = {};
  let abstracts = null, named = false;
  // read, gunzipped and checked side by side, then parsed one section a task, so no frame waits for the whole project (1 Nov 2026: the
  // 30,210-record project's sections, read one after another and parsed in one go, held the opening's frames 920 ms)
  // a chunked section's chunks are all read side by side too, each checked against its own hash
  // `ranges` ({ name: [from, to) }): of a chunked list, only those chunks, joined in order (the log the open leaves for later, lateSections)
  const wanted = namedSections(head).filter(e => !(e.name in head) && !skip?.has(e.name) && (withAbstracts || e.name !== ABSTRACTS))
    .map(e => (ranges?.[e.name] && isChunked(e) && e.kind === 'list' ? { ...e, range: ranges[e.name] } : e));
  // `bulk` (the shell's reads, bulkOf): each file's text, checked there against its hash, taken one at a time and parsed before the next
  // is decoded, so the open never holds every section's text at once; a file it did not read is read here, so a missing or damaged one
  // is recovered as before. Without it every file is read here, side by side.
  const take = bulk && wanted.length ? bulk(wanted) : null;
  const here = take ? null : wanted.map(e => { const p = Promise.all(filesOf(e).map(c => sectionText(c, readFile, recover))); p.catch(() => {}); return p; });
  for (let i = 0, j = 0; i < wanted.length; i++) {
    if (i) await breathe();   // time-sliced (breathe): a small section costs no turn
    const e = wanted[i], files = filesOf(e), chunked = isChunked(e);
    const texts = here ? await here[i] : null;
    if (here) here[i] = null;
    const items = [], members = [];
    let value, bad = false;
    for (let k = 0; k < files.length; k++, j++) {
      if (k) await breathe();   // between a chunked section's chunks too: 128 of `$abstracts` are read after the first view
      let t = texts ? texts[k] : await take(j).catch(() => null);
      if (texts) texts[k] = null;
      if (t == null) t = await sectionText(files[k], readFile, recover);
      if (bad) continue;
      // a chunked section's value as joinChunks gives it: a list's items in order, a map built from its chunks' entries
      try {
        const v = JSON.parse(t);
        t = null;
        if (!chunked) value = v;
        else if (e.kind === 'list') { if (Array.isArray(v)) for (const x of v) items.push(x); else items.push(v); }
        else if (e.kind === 'map') { for (const m of Object.entries(v)) members.push(m); }
        else throw new Error(`A chunked section of an unknown kind: ${e.kind}`);
      } catch (err) { if (e.name !== ABSTRACTS) throw err; bad = true; }
    }
    if (chunked && !bad) value = e.kind === 'list' ? items : Object.fromEntries(members);
    if (collect && filesWanted([e]).reduce((n, x) => n + (Number(x[2]) || 0), 0) >= COLLECT) await Promise.resolve().then(collect).catch(() => {});
    if (e.name !== ABSTRACTS) { parsed[e.name] = value; continue; }
    named = true;
    abstracts = bad ? null : value;
  }
  // format 1's sidecar files, read only (project-format.mjs SIDECAR): both, the gzip one's over the plain one's (tools/project-file.mjs
  // sidecarAbstracts and project_file.rs read them the same way)
  if (!named && withAbstracts) for (const name of [...SIDECAR].reverse()) {
    const bytes = await readFile(`.lykos/${name}`).catch(() => null);
    if (!bytes) continue;
    let side = {};
    try { side = readSidecar(await textOf(bytes)); } catch { /* textOf: gzip or plain; unreadable adds nothing */ }
    abstracts = { ...(abstracts || {}), ...side };
  }
  const ok = abstracts && typeof abstracts === 'object' && !Array.isArray(abstracts);
  // the records are this reader's own (just parsed): the abstracts go onto them in place
  const project = joinProject(head);
  for (const e of wanted) if (e.name in parsed) project[e.name] = parsed[e.name];
  if (ok) mergeAbstracts(project, abstracts);
  return { project, abstracts: ok ? abstracts : {}, named, damaged: named && !ok };
}

/**
 * The project a folder holds, joined, for a reader that does not open it (the task hub, a folder being added). Refuses what the store
 * refuses (assertProject: foreign or newer), a file that is not JSON, and a head whose sections are not all there (`stale: true`).
 * `withAbstracts: false`: the records without their abstracts (neither format 1's sidecar nor `$abstracts` is read).
 */
export async function readFolderProject(f, { withAbstracts = true } = {}) {
  const head = assertProject(parseHead(decode(await f.read(FILE))), { source: FILE });
  return (await joinHead(head, fileReader(f), { withAbstracts, recover: recoverer(f), bulk: bulkOf(f) })).project;
}
/** A folder's reads of a head's sections (fsys readSections: an answer's bytes or null), as joinHead's `bulk` (sectionsReader); null where
 *  the folder has none. `early`: the prefetch's first answers ({ files, batches, answers }, project-prefetch.js) for the same head's
 *  bytes, taken first when it asked for the same files. */
export function bulkOf(f, early = null, pace = undefined) {
  if (!f.readSections && !early) return null;
  const post = f.readSections ? files => f.readSections(FILE, files) : () => null;
  return wanted => sectionsReader(post, filesWanted(wanted), early, pace);
}
/** The reads of what the open leaves for after the first view (the records' abstracts, the screening log's earlier chunks, lib/projects.mjs
 *  `late`): nobody waits on them, so one batch at a time, after a collection of what the open dropped, which keeps the web view's peak to
 *  the open's own. */
const LATE_PACE = { inflight: 1, ahead: BATCH };
/**
 * What a first read left for after the first view (lib/projects.mjs read `late`; the chunked-sections spec, "Abstracts after the first
 * view", and the open-size brief, "The screening log after the first page"): of `head`, `$abstracts` when `abstracts`, and chunks 0 to
 * `logTo` of the screening log when `logTo` > 0, read once `start()` is called, after a collection of what the open dropped, one batch at
 * a time (LATE_PACE), recovered as the open's sections are and read again on a stale answer after each of `waits` ms. `done(late)` is
 * told first. Answers { start, read: a promise of { abstracts?: { id: text }, log?: [entries] } }.
 */
export function lateSections(f, head, { abstracts = true, logTo = 0 } = {}, waits, done) {
  let go;
  const asked = new Promise(r => { go = r; });
  const keep = new Set([...(abstracts ? [ABSTRACTS] : []), ...(logTo > 0 ? ['screeningLog'] : [])]);
  const skip = new Set(namedSections(head).map(e => e.name).filter(n => !keep.has(n)));
  const read = (async () => {
    await asked;
    await Promise.resolve().then(shellCollect).catch(() => {});
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await joinHead(head, fileReader(f), { recover: recoverer(f), bulk: bulkOf(f, null, LATE_PACE), skip, withAbstracts: abstracts, ...(logTo > 0 ? { ranges: { screeningLog: [0, logTo] } } : {}) });
        const late = {};
        if (abstracts) {
          if (r.damaged) throw new Error('`$abstracts` does not read as JSON');   // never taken as records with no abstracts
          late.abstracts = r.named ? r.abstracts : {};
        }
        if (logTo > 0) {
          if (!Array.isArray(r.project.screeningLog)) throw new Error('the screening log could not be read');
          late.log = r.project.screeningLog;
        }
        done(late);
        return late;
      } catch (err) {
        if (!err?.stale || attempt >= waits.length) throw err;
        await new Promise(r => setTimeout(r, waits[attempt]));
      }
    }
  })();
  read.catch(() => {});
  return { start: () => go(), read };
}

/**
 * The history's read of a folder's project (lib/vcs.mjs): the head once, then only the sections whose source (sectionSources) `skip(key,
 * source)` does not keep, gunzipped and checked. Answers { project (without the skipped keys), sources, skipped }; for a head of format 3,
 * { pieces, sources, skipped } instead (readPieces: the file's own pieces, none joined). Throws as readFolderProject does.
 */
export async function readFolderSections(f, skip = () => false) {
  const head = assertProject(parseHead(decode(await f.read(FILE))), { source: FILE });
  if (head.format >= CHUNKED) return readPieces(f, head, skip);
  const sources = sectionSources(head), skipped = Object.keys(sources).filter(k => skip(k, sources[k]));
  const { project } = await joinHead(head, fileReader(f), { withAbstracts: !skipped.includes('papers'), skip: new Set(skipped), recover: recoverer(f) });
  return { project, sources, skipped };
}

/**
 * A format-3 head's pieces as the history records them (project-format.mjs headPieces): each named section and chunk read, checked and
 * recovered alone, side by side, unless `skip(key, sha, true)` keeps it (its `text` then null, its key in `skipped`); nothing is parsed or
 * joined. Answers { pieces, sources: {}, skipped }.
 */
async function readPieces(f, head, skip) {
  const readFile = fileReader(f), recover = recoverer(f), pieces = headPieces(head), skipped = [];
  await Promise.all(pieces.map(async p => {
    if (p.text !== undefined) return;
    if (skip(p.key, p.sha, true)) { p.text = null; skipped.push(p.key); return; }
    p.text = await sectionText({ name: p.name, file: p.file, sha256: p.sha, ...(p.entry ? { chunk: { entry: p.entry, index: p.index } } : {}) }, readFile, recover);
  }));
  return { pieces, sources: {}, skipped };
}

/** The project of uploaded files (lib/folder-import.mjs): `text` the project file's, `fileAt(rel)` the File at a path inside the project
 * folder, or null. A visible copy is the whole project; a head joins its section files (`stale: true` when the upload lacks one). */
export async function projectFromFiles(text, fileAt) {
  const head = parseHead(text);
  if (!head || typeof head !== 'object' || Array.isArray(head)) return head;
  assertProject(head, { source: FILE });   // a newer format is said as such, not read as a folder still syncing
  return (await joinHead(head, async rel => { const file = fileAt(rel); return file ? new Uint8Array(await file.arrayBuffer()) : null; })).project;
}

/**
 * The records' abstracts taken off the exported records (in place), as `$abstracts` holds them: { next: Map id -> text in record order,
 * text: the section's text when it differs from `written` (the Map the head on disk holds; null when not known), else null }.
 */
export function takeAbstracts(exported, written) {
  const next = new Map();
  exported.papers = stripAbstracts(exported.papers, next).papers;
  let same = !!written && written.size === next.size;
  if (same) for (const [k, v] of next) if (written.get(k) !== v) { same = false; break; }
  return { next, text: same ? null : JSON.stringify(Object.fromEntries(next)) };
}

/**
 * Puts the sections whose hash is not the one the head on disk names (`named`: name -> entry, entriesOf) in place before the head that
 * names them. `parts`: [[key, JSON text]] (store.mjs sectionParts; a null text: the section `named` names, unchanged and neither hashed
 * nor written, store.mjs dirtyParts; a chunked part, store.mjs chunkPart: { kind, buckets | per, texts }, `texts[i]` chunk i's text,
 * or null for the chunk `named`'s entry names at i, neither hashed nor written: the caller checked that entry is the one its texts are
 * of); `abstracts`: the new `$abstracts` text, or null for the one on disk; `format`: the folder's (2 or
 * 3). A head always names `$abstracts`, empty when there are none, so an old format-1 sidecar is never read back in. Format 3: a map or
 * list section of CHUNK_MIN or more is split into chunks (chunkSection, keeping the buckets or per of its entry in `named`), and only the
 * chunks whose file `named` does not name are written: a decision sends one chunk of each section it changed across the IPC.
 * A file already there (named by its content) is kept; one old enough for a prune is written again, so another window's prune does not
 * take it before this head names it. Answers { headText, named } for the commit.
 */
export async function putSections(f, named, parts, abstracts, format = SECTIONED) {
  let t = performance.now();
  const enc = new TextEncoder(), raw = new Map(), rawChunks = new Map(), metas = new Map(), chunked = {};
  const had = new Set(fileNames(named));
  // the files .lykos/project/ holds now, listed once when a section's text is here: a file the head names that went (another machine's
  // prune, synced) is written again by the save that holds its text, so the head never goes on naming a file that is not there
  let listed;
  const present = () => (listed ??= f.list ? f.list(SECTIONS_DIR).then(rows => new Set(rows.filter(r => !r.dir).map(r => r.name)), () => null) : Promise.resolve(null));
  const there = async name => { const p = await present(); return !p || p.has(name); };
  const on = (abstracts == null ? named.get(ABSTRACTS) : abstracts) || '{}';
  const put = async (name, text) => {
    if (format >= CHUNKED && text.length >= CHUNK_MIN) {
      // the section's text is the store's JSON.stringify: parsed back, its chunks are the ones every writer makes of it
      let value;
      try { value = JSON.parse(text); } catch { value = undefined; }
      const c = value === undefined ? null : chunkSection(value, isChunked(named.get(name)) ? named.get(name) : null);
      if (c) {
        const chunks = [];
        for (let i = 0; i < c.texts.length; i++) {
          const bytes = enc.encode(c.texts[i]), sha256 = await documentHash(bytes), file = chunkFile(name, i, sha256);
          chunks.push([sha256, bytes.length]);
          const base = file.split('/').pop();
          if (!had.has(base) || !(await there(base))) rawChunks.set(file, bytes);
        }
        chunked[name] = c.kind === 'map' ? { kind: c.kind, buckets: c.buckets, chunks } : { kind: c.kind, per: c.per, chunks };
        return;
      }
    }
    if (!isSection(name, text, format)) return;
    const bytes = enc.encode(text), sha256 = await documentHash(bytes);
    metas.set(name, { sha256, bytes: bytes.length });
    if (named.get(name)?.sha256 !== sha256 || !(await there(sectionFile(name, sha256).split('/').pop()))) raw.set(name, bytes);
  };
  // a chunked part: only its chunks with a text are hashed (side by side) and, when the head on disk does not name them, written
  const putChunks = async (name, c) => {
    const e = named.get(name);
    const chunks = await Promise.all(c.texts.map(async (t, i) => {
      if (t == null) {
        const kept = isChunked(e) && e.kind === c.kind && e.chunks[i];
        if (!kept) throw new Error(`the save has no text for chunk ${i} of ${name}, and the project file names none`);
        return kept;
      }
      const bytes = enc.encode(t), sha256 = await documentHash(bytes), file = chunkFile(name, i, sha256), base = file.split('/').pop();
      if (!had.has(base) || !(await there(base))) rawChunks.set(file, bytes);
      return [sha256, bytes.length];
    }));
    chunked[name] = c.kind === 'map' ? { kind: c.kind, buckets: c.buckets, chunks } : { kind: c.kind, per: c.per, chunks };
  };
  for (const [name, text] of [...(typeof on === 'string' && on ? [[ABSTRACTS, on]] : []), ...parts]) {
    if (name === 'format' || name === '$sections') continue;
    if (text && typeof text === 'object') {
      if (format < CHUNKED) throw new Error(`a chunked save of ${name} for a format-${format} folder`);
      await putChunks(name, text);
      continue;
    }
    if (text == null) {
      // a section this window wrote and has not changed since (store.mjs dirtyParts): named as the head on disk names it, not written
      const e = named.get(name);
      if (!e) throw new Error(`the save has no text for ${name}, and the project file names none`);
      if (isChunked(e)) chunked[name] = e; else metas.set(name, { sha256: e.sha256, bytes: e.bytes });
      continue;
    }
    await put(name, text);
  }
  const split = splitParts(parts, on, name => metas.get(name), { format, chunked });
  t = timing('save: sections hashed', t);
  const files = [...split.sections.filter(s => raw.has(s.name)).map(s => [`.lykos/${s.file}`, raw.get(s.name)]), ...[...rawChunks].map(([file, bytes]) => [`.lykos/${file}`, bytes])];
  // a few at a time: the first save of a format-3 folder writes every chunk
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(files.slice(i, i + 8).map(async ([rel, bytes]) => {
      const st = await f.stat(rel).catch(() => ({}));
      if (st.exists && st.mtime && Date.now() - st.mtime < REFRESH_AFTER) return;
      const gz = await gzipBytes(bytes);
      if (!st.exists) await f.writeBytes(rel, gz);
      else if (f.replaceBytes) await f.replaceBytes(rel, gz);
    }));
  }
  timing('save: sections written', t);
  const next = new Map(split.sections.map(s => [s.name, { file: s.file, sha256: s.sha256, bytes: s.bytes }]));
  for (const [name, e] of Object.entries(chunked)) next.set(name, e);
  if (on && typeof on === 'object' && !next.has(ABSTRACTS)) next.set(ABSTRACTS, on);
  return { headText: split.headText, named: next };
}

/**
 * The prune (Ruling 25, one rule with tools/project-file.mjs and project_file.rs): a file of .lykos/project/ (PRUNABLE: a section file,
 * or a writer's leftover temporary file, the shell's `.<file>.<uuid>.lykos-tmp` too) that neither this window's head (`named`) nor the
 * head it replaced (`previous`: names) names goes, through removeBackup (the only files a folder removes outright, lib/fsys.mjs), once
 * older than graceOf(name) by max(mtime, ctime), stat'ed just before it goes (another writer may have refreshed it; a sync client keeps
 * the remote mtime, and the ctime is when it arrived), and only when the head on disk, read again just before the removal, does not name
 * it either (another writer's head, one a sync client brought). Each file's stat, head check and removal run under `lock` (the folder's commit).
 */
export async function pruneSections(f, named, previous = new Set(), { lock = fn => fn() } = {}) {
  if (!f.list || !f.removeBackup) return;
  // every file the entries name, a chunked section's each chunk (Task 3 review, finding 5: not namedSections' `file`, which a chunked entry has none of)
  const keep = new Set([...fileNames(named), ...previous]);
  let rows;
  try { rows = await f.list(SECTIONS_DIR); } catch { return; }
  for (const e of rows) {
    if (e.dir || !PRUNABLE.test(e.name) || keep.has(e.name)) continue;
    const rel = `${SECTIONS_DIR}/${e.name}`;
    // a file not yet past its grace is left without the lock (Task 4 re-review, finding A: hundreds of young orphans each took a turn)
    const young = await f.stat(rel).catch(() => null);
    if (!young?.exists || !young.mtime || Date.now() - Math.max(young.mtime, young.ctime || 0) <= graceOf(e.name)) continue;
    // the stat again, the head on disk and the removal under the commit (`lock`, lib/projects.mjs withFolderCommit): a save that
    // refreshes this file and commits a head naming it runs wholly before or wholly after them
    await lock(async () => {
      const st = await f.stat(rel).catch(() => null);
      if (!st?.exists || !st.mtime || Date.now() - Math.max(st.mtime, st.ctime || 0) <= graceOf(e.name)) return;
      let onDisk = null;
      try { onDisk = new Set(namedFiles(JSON.parse(decode(await f.read(FILE)))).map(x => String(x.file).split('/').pop())); } catch { return; }
      if (onDisk.has(e.name)) return;
      await f.removeBackup(rel).catch(() => {});
    });
  }
}

/** The file names the head before (`before`: name -> entry) named that the head just written (`after`) does not: what the next prune
 *  keeps besides the new head's (a reader may still hold that head). */
export function retire(before, after) {
  const keep = new Set(fileNames(after));
  return new Set(fileNames(before).filter(n => !keep.has(n)));
}

/** The hash of a folder's project file as it is (documentHash), or null when there is none: what a restore (lib/vcs.mjs) compares. */
export async function headHash(f) {
  return (await f.stat(FILE).catch(() => ({}))).exists ? documentHash(await f.read(FILE)) : null;
}

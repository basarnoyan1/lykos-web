// Project file format 2 (owner, 31 Oct 2026): .lykos/project.json is a small head; each large section is a gzip file beside it,
// .lykos/project/<name>-<sha12>.json.gz, named by its content hash so a new version never changes a file a head already names.
//   head = the project minus its large sections, plus `format: 2` and `$sections: { name: { file, sha256, bytes } }`.
//   A section present inline in the head wins over `$sections` (a hand edit); the next save splits it again.
//   `$abstracts` ({ id: text }) holds the records' abstracts as a section of its own, however small, made from the records written
//   (Ruling 7: a record without an abstract has none in it), and is named even when empty, so a format-1 sidecar left in the folder is
//   never read back in. A restore and `lykos compact` never lose one (Ruling 23, carryAbstracts).
//   Format 1 (one project.json) is read as it is and written by nothing but a folder that writes only text: one file, the abstracts on
//   their records. Its abstracts sidecar of 31 October 2026 (.lykos/abstracts.json.gz, or .json) is still read where a head names no
//   `$abstracts` (SIDECAR, readSidecar), and written by nothing; `lykos compact --write` folds it into `$abstracts` and moves it out.
// Format 3 (chunked sections, docs/superpowers/specs/2026-11-01-chunked-sections-design.md): the head's shape is format 2's, with
// `format: 3`, SECTION_MIN_3 for a section file, and a section of CHUNK_MIN or more split into chunks. Its `$sections` entry is
//   { kind: 'map', buckets: B, chunks: [[sha256, bytes], …] }  a key in bucket fnv1a32(utf8(key)) % B (B a power of two), or
//   { kind: 'list', per: P, chunks: [[sha256, bytes], …] }     items [i·P, (i+1)·P) in chunk i;
// chunk i is the file chunkFile(name, i, sha256), the gzip of the chunk's JSON text ({…} of its keys in their section order, or […]).
// A writer passes the head it replaces (`previous`) so a section keeps its buckets or per until its average chunk leaves
// [CHUNK_TARGET/4, 4·CHUNK_TARGET] (chunkSection): a decision then changes one chunk, and a rebalance (every chunk rewritten) is rare.
// Every size here is a JSON text's string length (UTF-16 units), as the SECTION_MIN threshold is; `bytes` in an entry is UTF-8.
// Pure: no I/O, no hashing of its own (the caller supplies a synchronous `hash(text) -> sha256 hex`), no gzip. The Node and Rust
// writers and readers (tools/project-file.mjs, the folder backend) do the files and the compression.

// FORMAT, the highest format the Node tools read (tools/project-file.mjs, which joins chunks; project_file.rs's FORMAT is 3 too).
// APP_FORMAT, the app's (lib/section-files.mjs, lib/projects.mjs, store.mjs PROJECT_FORMAT): its folder backend joins chunks too.
export const FORMAT = 3;
export const APP_FORMAT = 3;
export const WRITE_FORMAT = 3;                 // the format a new or format-1 folder is written in (1 November 2026: format 3)
export const CHUNKED = 3;                      // the first format whose large sections are chunked
export const SECTION_MIN = 256 * 1024;         // a section this large or larger goes to its own file (format 2)
export const SECTION_MIN_3 = 4 * 1024;         // the same in format 3: the head holds only what is truly small (1 Nov 2026 tuning)
export const CHUNK_MIN = 1024 * 1024;          // format 3: a map or list section this large or larger is chunked (2 × CHUNK_TARGET)
export const CHUNK_TARGET = 512 * 1024;        // format 3: the size a chunk is made about
export const ABSTRACTS = '$abstracts';
const SKIP = new Set(['format', '$sections']);
/** The prune (Ruling 25): a section file that neither the head just written, nor the head it replaced, nor the head on disk names goes
 *  once older than SECTION_GRACE by max(mtime, ctime) (a writer puts its files in place before its head names them; ctime is when a sync
 *  client brought one, whatever mtime it kept); a writer's leftover temporary file once older than TEMP_GRACE. */
export const SECTION_GRACE = 60_000, TEMP_GRACE = 10 * 60_000;
/** The files of .lykos/project/ a prune may remove: a section file (NAME-SHA12.json.gz) or a chunk file (NAME.I-SHA12.json.gz), or the temporary file of one that a writer which
 *  stopped left: tools/project-file.mjs's and project_file.rs's `<file>.tmp-<pid>[-<n>]`, the shell's `.<file>.<uuid>.lykos-tmp`
 *  (saving.rs). project_file.rs `prunable` is the same rule. */
export const PRUNABLE = /^(?:[^/.][^/]*-[0-9a-f]{12}\.json\.gz(?:\.tmp-[\d-]+)?|\.[^/]+-[0-9a-f]{12}\.json\.gz\.[0-9a-f-]+\.lykos-tmp)$/;
/** How old a prunable file must be before it goes: TEMP_GRACE for a temporary file, else SECTION_GRACE (project_file.rs grace_of). */
export const graceOf = name => (/\.json\.gz\.tmp-[\d-]+$|\.lykos-tmp$/.test(name) ? TEMP_GRACE : SECTION_GRACE);
/** Format 1's abstracts sidecar, in .lykos/ (read only): the gzip one first, then the plain one. */
export const SIDECAR = ['abstracts.json.gz', 'abstracts.json'];

/** The abstracts of a sidecar's text: { id: text }, or {} when it does not read. */
export function readSidecar(text) {
  try { const a = JSON.parse(text); return a?.kind === 'lykos-abstracts' && a.abstracts && typeof a.abstracts === 'object' ? a.abstracts : {}; } catch { return {}; }
}

/** Puts each abstract of `abstracts` ({ id: text }) back on its record; a record that has its own keeps it. Changes `state` in place. */
export function mergeAbstracts(state, abstracts) {
  if (!abstracts || !Array.isArray(state?.papers)) return state;
  for (const p of state.papers) if (p && p.abstract === undefined && typeof p.id === 'string' && typeof abstracts[p.id] === 'string') p.abstract = abstracts[p.id];
  return state;
}

/**
 * Ruling 23 (no write may lose abstracts): each record of `state` that has no abstract takes the one its record in `current` (the project
 * as it is on disk, joined) has. For a restore of a copy whose records carry none (a copy taken before the 31 Oct 2026 flip: the abstracts
 * were in the sidecar). Changes `state` in place; answers how many it put back.
 */
export function carryAbstracts(state, current) {
  if (!Array.isArray(state?.papers) || !Array.isArray(current?.papers)) return 0;
  const had = new Map(current.papers.filter(p => typeof p?.id === 'string' && typeof p.abstract === 'string').map(p => [p.id, p.abstract]));
  let n = 0;
  state.papers = state.papers.map(p => (p && typeof p === 'object' && p.abstract === undefined && had.has(p.id) ? (n++, { ...p, abstract: had.get(p.id) }) : p));
  return n;
}

/** The records without their abstracts; `kept` (a Map, changed in place) gains each record's abstract. Answers { papers, changed }. */
export function stripAbstracts(papers, kept) {
  let changed = false;
  const out = (papers || []).map(p => {
    if (!p || typeof p.abstract !== 'string' || typeof p.id !== 'string') return p;
    if (kept.get(p.id) !== p.abstract) { kept.set(p.id, p.abstract); changed = true; }
    const { abstract, ...rest } = p;
    return rest;
  });
  return { papers: out, changed };
}

// `bytes` in $sections is the UTF-8 length of the section's text (what the file holds uncompressed), so JS and Rust heads agree. Counted
// by hand, not with Buffer or TextEncoder (the module also runs in the browser). The 256 kB threshold uses the string length (UTF-16 units).
export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** The file a section is stored in: project/NAME-SHA12.json.gz (SHA12: the first 12 characters of the hash), relative to .lykos/. */
export const sectionFile = (name, sha256) => `project/${name.replace(/^\$/, '')}-${sha256.slice(0, 12)}.json.gz`;
/** The file chunk `i` of a chunked section is stored in: project/NAME.I-SHA12.json.gz, relative to .lykos/. */
export const chunkFile = (name, i, sha256) => `project/${name.replace(/^\$/, '')}.${i}-${sha256.slice(0, 12)}.json.gz`;
/** Whether a `$sections` entry is a chunked section's (format 3). */
export const isChunked = entry => !!entry && typeof entry === 'object' && Array.isArray(entry.chunks);

/**
 * The screening log after the first view (open-size brief, 1 Nov 2026): of a chunked log (a list entry), the chunks the open leaves for
 * later, 0 to `from`, keeping the last ones, which hold at least LOG_TAIL entries (the Overview's recent work reads the last 200). 0 when
 * nothing is left (a log in one file, or in so few chunks that the tail is all of it). project-prefetch.js asks for the same files.
 */
export const LOG_TAIL = 200;
export function lateLogChunks(entry) {
  if (!isChunked(entry) || entry.kind !== 'list' || !Number.isInteger(entry.per) || entry.per < 1) return 0;
  const n = entry.chunks.length, tail = Math.min(n, Math.ceil(LOG_TAIL / entry.per) + 1);
  return Math.max(0, n - tail);
}

/** FNV-1a, 32 bits, over the UTF-8 bytes of `text` (a lone surrogate as U+FFFD, as TextEncoder does). Answers an unsigned integer. */
export function fnv1a32(text) {
  let h = 0x811c9dc5;
  const byte = b => { h = Math.imul(h ^ b, 16777619); };
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00) c = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00);
    else if (c >= 0xD800 && c < 0xE000) c = 0xFFFD;
    if (c < 0x80) byte(c);
    else if (c < 0x800) { byte(0xC0 | (c >> 6)); byte(0x80 | (c & 63)); }
    else if (c < 0x10000) { byte(0xE0 | (c >> 12)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
    else { byte(0xF0 | (c >> 18)); byte(0x80 | ((c >> 12) & 63)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
  }
  return h >>> 0;
}

const kindOf = value => (Array.isArray(value) ? 'list' : value && typeof value === 'object' ? 'map' : null);
// The bounds, in integers (Rust does the same arithmetic): the average chunk total / chunks is out of [CHUNK_TARGET/4, 4·CHUNK_TARGET].
const outOfBounds = (total, chunks) => total > 4 * CHUNK_TARGET * chunks || 4 * total < CHUNK_TARGET * chunks;

/**
 * A map or list section stringified one key or item at a time: { kind, pieces, total }, `pieces` a map's [key, `"key":value`] in
 * Object.keys order or a list's item texts, `total` the string length of the whole text. Null for anything else, or a value with toJSON
 * (its text is not its pieces'). A map's piece of an undefined value is left out and a list's undefined item (or hole) is `null`, as
 * JSON.stringify does.
 */
function piecesOf(value) {
  const kind = kindOf(value);
  if (!kind || typeof value.toJSON === 'function') return null;
  const pieces = [];
  let total = 2;
  if (kind === 'map') {
    for (const key of Object.keys(value)) {
      const t = JSON.stringify(value[key]);
      if (t === undefined) continue;
      const piece = `${JSON.stringify(key)}:${t}`;
      pieces.push([key, piece]);
      total += piece.length;
    }
  } else {
    for (let i = 0; i < value.length; i++) { const t = JSON.stringify(value[i]) ?? 'null'; pieces.push(t); total += t.length; }
  }
  return { kind, pieces, total: total + Math.max(0, pieces.length - 1) };
}
/** The whole text of piecesOf's pieces: JSON.stringify of the value. */
const wholeText = ({ kind, pieces }) => (kind === 'map' ? `{${pieces.map(p => p[1]).join(',')}}` : `[${pieces.join(',')}]`);

function chunksOf({ kind, pieces, total }, prev) {
  const T = CHUNK_TARGET;
  if (kind === 'map') {
    let buckets = prev?.kind === 'map' && Number.isInteger(prev.buckets) && prev.buckets > 0 && (prev.buckets & (prev.buckets - 1)) === 0 ? prev.buckets : 0;
    if (!buckets || outOfBounds(total, buckets)) for (buckets = 1; total > T * buckets;) buckets *= 2;
    const groups = Array.from({ length: buckets }, () => []);
    for (const [key, piece] of pieces) groups[fnv1a32(key) % buckets].push(piece);
    return { kind, buckets, texts: groups.map(g => `{${g.join(',')}}`) };
  }
  const n = pieces.length, chunks = per => Math.floor((n + per - 1) / per);
  let per = prev?.kind === 'list' && Number.isInteger(prev.per) && prev.per > 0 ? prev.per : 0;
  // fresh: n·T / total rounded half up, at least 1, in integers
  if (!per || outOfBounds(total, chunks(per))) per = Math.max(1, Math.floor((2 * n * T + total) / (2 * total)));
  const texts = [];
  for (let i = 0; i < n; i += per) texts.push(`[${pieces.slice(i, i + per).join(',')}]`);
  return { kind, per, texts };
}

/**
 * The chunks of a section of format 3: { kind: 'map', buckets, texts } or { kind: 'list', per, texts }, `texts` the chunks' JSON texts
 * in order; null when the value is not an object or an array, or its text is under CHUNK_MIN. Every size is the JSON text's string
 * length in UTF-16 units (Rust: `encode_utf16().count()`), as the SECTION_MIN threshold is.
 * `prev` is the section's entry in the head being replaced: its `buckets` or `per` is kept while the average chunk, total / chunks, is
 * within [CHUNK_TARGET/4, 4·CHUNK_TARGET] (integers: not total > 4·T·chunks, not 4·total < T·chunks); else the section is split again:
 * buckets the least power of two with total <= T·buckets; per = max(1, floor((2·n·T + total) / (2·total))).
 * A map key goes to bucket fnv1a32(key) % buckets. Key order (Ruling 4): within a chunk, keys are in JS's own property order, which is
 * the only order a plain object keeps: first the array-index keys (canonical decimal integers 0 to 2^32-2, no leading zero, no sign) in
 * ascending numeric order, then every other key in the section's insertion order. A joined map has the same order over all its keys.
 * A chunk's text is what JSON.stringify gives for its keys or items.
 */
export function chunkSection(value, prev = null) {
  const p = piecesOf(value);
  return p && p.total >= CHUNK_MIN ? chunksOf(p, prev) : null;
}

/**
 * The chunk texts `value` has when split exactly as `entry` (a chunked `$sections` entry) says: its kind and its buckets or per, never
 * split again. What a writer of that entry wrote for this value, for a reader recovering a missing chunk from a copy (the caller takes
 * chunk i by index: a list copy taken before an append still holds the earlier chunks, Ruling 5). Null when the value is not of the
 * entry's kind, or its size is not one a writer makes: a map's buckets a power of two equal to the number of chunks (a damaged head never
 * sizes the split), a list's per an integer of 1 or more (a list split makes at most n chunks). project_file.rs chunk_texts_of is the same rule.
 */
export function chunkTexts(value, entry) {
  const p = isChunked(entry) ? piecesOf(value) : null;
  if (!p || p.kind !== entry.kind) return null;
  const n = entry.chunks.length;
  if (p.kind === 'map') {
    const b = entry.buckets;
    if (!Number.isInteger(b) || b < 1 || b !== n || (b & (b - 1)) !== 0) return null;
    const groups = Array.from({ length: b }, () => []);
    for (const [key, piece] of p.pieces) groups[fnv1a32(key) % b].push(piece);
    return groups.map(g => `{${g.join(',')}}`);
  }
  const per = entry.per;
  if (!Number.isInteger(per) || per < 1) return null;
  const texts = [];
  for (let i = 0; i < p.pieces.length; i += per) texts.push(`[${p.pieces.slice(i, i + per).join(',')}]`);
  return texts;
}

/**
 * Some chunks of `value` split as `layout` says ({ kind: 'map', buckets } or { kind: 'list', per }; never split again): { count, texts },
 * `count` the chunks the value has in that split and `texts[i]` chunk i's JSON text (chunkSection's) where `wanted` (a Set of indexes;
 * null: every chunk) has i, else undefined. Null when the value is not of the layout's kind, has toJSON, or the size is not one a writer
 * makes. For the store's save (store.mjs): only the chunks its edits touched are stringified; a map's keys are each hashed to find them.
 */
export function chunkTextsAt(value, layout, wanted = null) {
  const kind = kindOf(value);
  if (!kind || kind !== layout?.kind || typeof value.toJSON === 'function') return null;
  if (kind === 'map') {
    const b = layout.buckets;
    if (!Number.isInteger(b) || b < 1 || (b & (b - 1)) !== 0) return null;
    const groups = new Array(b);
    for (let i = 0; i < b; i++) if (!wanted || wanted.has(i)) groups[i] = [];
    for (const key of Object.keys(value)) {
      const g = groups[fnv1a32(key) % b];
      if (!g) continue;
      const t = JSON.stringify(value[key]);
      if (t !== undefined) g.push(`${JSON.stringify(key)}:${t}`);
    }
    return { count: b, texts: Array.from(groups, g => (g ? `{${g.join(',')}}` : undefined)) };
  }
  const per = layout.per;
  if (!Number.isInteger(per) || per < 1) return null;
  const n = value.length, count = Math.floor((n + per - 1) / per), texts = new Array(count).fill(undefined);
  for (let c = 0; c < count; c++) {
    if (wanted && !wanted.has(c)) continue;
    const items = [];
    for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) items.push(JSON.stringify(value[i]) ?? 'null');
    texts[c] = `[${items.join(',')}]`;
  }
  return { count, texts };
}

/**
 * Whether chunks of these text lengths (UTF-16, in order) keep their split: chunkSection would split the joined value the same way (its
 * whole text CHUNK_MIN or more, its average chunk in bounds). The whole text's length is worked out from the chunks' (each `{…}` or `[…]`;
 * a map's empty bucket is `{}`), so no text is made.
 */
export function keepsSplit(lens) {
  let sum = 0, full = 0;
  for (const n of lens) { sum += n; if (n > 2) full++; }
  const total = full ? sum - 2 * lens.length + full + 1 : 2;
  return total >= CHUNK_MIN && !outOfBounds(total, lens.length);
}

/**
 * The store's part for a chunked section's save (store.mjs): { kind, buckets | per, texts, from }, `texts[i]` chunk i's text where it
 * moved from `base` ({ entry, chunks: [text | [hash, length]], loaded? }, what the store last read or wrote; `hash` its text hash), null
 * where it is the base's chunk (named as `from`, the entry the base is of, says it). `mark` says which chunks an update touched: 'all',
 * or { all, keys (a map's keys, a list's indexes), from (a list's first index whose length changed) }; none: no chunk is made. Only those
 * are stringified. Without a base every chunk is made in the split `entry` (the head's) says; a base made from a read (`loaded`: the
 * project normalized, not the text on disk) hands every chunk once, and the backend writes those whose hash is not the head's, as format
 * 2 does with a whole section. A section that would be split again (keepsSplit) or is no longer of its kind is its whole text.
 */
export function chunkPart(value, mark, base, entry, hash) {
  const layout = base?.entry || entry;
  if (!layout) return JSON.stringify(value);
  const list = layout.kind === 'list', sendAll = !!base?.loaded;
  let wanted = null;
  if (base && !sendAll && mark !== 'all' && !mark?.all) {
    wanted = new Set();
    const count = base.chunks.length, now = list && Array.isArray(value) ? Math.ceil(value.length / layout.per) : count;
    if (mark) for (const key of mark.keys) wanted.add(list ? Math.floor(key / layout.per) : fnv1a32(key) % layout.buckets);
    if (list) {
      // a list whose length moved: from its first changed index (or, untold, the last chunk both lengths have) to its end
      const from = Math.min(mark ? mark.from : Infinity, now === count ? Infinity : (Math.min(now, count) - 1) * layout.per);
      if (from < Infinity) for (let c = Math.max(0, Math.floor(from / layout.per)); c < now; c++) wanted.add(c);
    }
  }
  const r = chunkTextsAt(value, layout, wanted);
  if (!r) return JSON.stringify(value);
  const texts = new Array(r.count), lens = new Array(r.count);
  for (let i = 0; i < r.count; i++) {
    const t = r.texts[i], old = base?.chunks[i];
    if (t === undefined) { texts[i] = null; lens[i] = typeof old === 'string' ? old.length : old[1]; continue; }
    lens[i] = t.length;
    texts[i] = !sendAll && old !== undefined && !(typeof old === 'string' ? t !== old : t.length !== old[1] || hash(t) !== old[0]) ? null : t;
  }
  if (!keepsSplit(lens)) return JSON.stringify(value);
  return { kind: layout.kind, ...(list ? { per: layout.per } : { buckets: layout.buckets }), texts, from: base ? base.entry : null };
}

/** The value of a chunked section from its entry and its chunks' texts in order (each already checked against its sha256). A map is
 *  built from entries (CreateDataProperty), so a `__proto__` key stays a key. */
export function joinChunks(entry, texts) {
  if (!isChunked(entry) || texts.length !== entry.chunks.length) throw new Error('A chunked section does not have the chunks its entry names');
  if (entry.kind === 'list') return texts.flatMap(t => JSON.parse(t));
  if (entry.kind === 'map') return Object.fromEntries(texts.flatMap(t => Object.entries(JSON.parse(t))));
  throw new Error(`A chunked section of an unknown kind: ${entry.kind}`);
}

/** Every file a head names: [{ name, file, sha256, bytes }], with `index` for a chunk (none for a format-1 head). */
export function namedFiles(head) {
  return namedSections(head).flatMap(e => (isChunked(e)
    ? e.chunks.map(([sha256, bytes], index) => ({ name: e.name, index, file: chunkFile(e.name, index, sha256), sha256, bytes }))
    : [{ name: e.name, file: e.file, sha256: e.sha256, bytes: e.bytes }]));
}

/**
 * Splits a project into its head and its large sections (splitParts over the project stringified one key at a time). `state` is not
 * changed. `format` is the head's (WRITE_FORMAT unless given); from format 3 a section of CHUNK_MIN or more is chunked (chunkSection),
 * keeping the buckets or per of its entry in `previous`, the head this one replaces (on disk, or the last written). Answers { head,
 * headText, sections: [{ name, text, sha256, file, bytes }] (the whole-file sections), files: [{ file, text, sha }] (every file the head
 * names: the sections' and the chunks') }.
 */
export function splitProject(state, hash, { format = WRITE_FORMAT, previous = null } = {}) {
  const kept = new Map(), papers = Array.isArray(state?.papers) ? stripAbstracts(state.papers, kept).papers : state?.papers;
  const before = previous?.$sections && typeof previous.$sections === 'object' ? previous.$sections : {};
  const chunked = {}, chunkFiles = [];
  const text = (name, value) => {
    // format 3: a map or list is stringified once, in pieces; its whole text, when not chunked, is the pieces joined
    const p = format >= CHUNKED ? piecesOf(value) : null;
    if (!p) return JSON.stringify(value);
    if (p.total < CHUNK_MIN) return wholeText(p);
    const c = chunksOf(p, before[name]);
    const chunks = c.texts.map((ct, i) => { const sha = hash(ct); chunkFiles.push({ file: chunkFile(name, i, sha), text: ct, sha }); return [sha, utf8Length(ct)]; });
    chunked[name] = c.kind === 'map' ? { kind: c.kind, buckets: c.buckets, chunks } : { kind: c.kind, per: c.per, chunks };
    return undefined;
  };
  const abstracts = text(ABSTRACTS, Object.fromEntries(kept)) ?? null;
  const parts = Object.entries(state || {}).map(([key, value]) => [key, SKIP.has(key) ? undefined : text(key, key === 'papers' ? papers : value)]);
  const { headText, sections } = splitParts(parts, abstracts, (name, t) => ({ sha256: hash(t), bytes: utf8Length(t) }), { format, chunked });
  const files = [...sections.map(s => ({ file: s.file, text: s.text, sha: s.sha256 })), ...chunkFiles];
  return { head: JSON.parse(headText), headText, sections, files };
}

/**
 * The text a section of this name has in the joined project `state` (a copy kept before a change, the day's copy): what a writer would put
 * in its file. `$abstracts` from the records' abstracts, `papers` without them; undefined when `state` has no such key. For a reader that
 * finds a named file missing (tools/project-file.mjs, lib/section-files.mjs): the text is the section's when its hash is the one named.
 */
export function sectionTextOf(state, name) {
  const v = sectionValueOf(state, name);
  return v === undefined ? undefined : JSON.stringify(v);
}
/** The value whose text sectionTextOf answers (a chunked section's, for chunkTexts); undefined when `state` has no such key. */
export function sectionValueOf(state, name) {
  if (!state || typeof state !== 'object') return undefined;
  if (name === ABSTRACTS || name === 'papers') {
    if (!Array.isArray(state.papers)) return undefined;
    const kept = new Map(), papers = stripAbstracts(state.papers, kept).papers;
    return name === 'papers' ? papers : Object.fromEntries(kept);
  }
  return name in state ? state[name] : undefined;
}

/** Whether a top-level section of this JSON text goes to a file of its own in a head of `format` (`$abstracts` always does). */
export const isSection = (name, text, format = 2) => name === ABSTRACTS || text.length >= (format >= CHUNKED ? SECTION_MIN_3 : SECTION_MIN);

/**
 * splitProject for a project already stringified one top-level key at a time (the app's save, store.mjs sectionParts: `parts` is
 * [[key, JSON text]], the records without their abstracts) and the abstracts: their text ({ id: text }), the `$sections` entry of a file
 * already written ({ file, sha256, bytes }: named as it is, not in `sections`), or null or '' for none. The caller hashes: `meta(name,
 * text)` answers { sha256, bytes } and is asked only for the sections. Nothing is stringified again; the head comes out as text.
 * `format` is the head's (WRITE_FORMAT unless given); `chunked` ({ name: entry }) holds the `$sections` entries of chunked sections, whose
 * chunk files the caller writes: such a key's text in `parts` is not read, and `abstracts` may also be a chunked entry.
 * Answers { headText, sections: [{ name, text, sha256, file, bytes }] }, the head and sections splitProject makes.
 */
export function splitParts(parts, abstracts, meta, { format = WRITE_FORMAT, chunked = {} } = {}) {
  const sections = [], inline = [], named = {};
  const add = (name, text) => {
    const { sha256, bytes } = meta(name, text), file = sectionFile(name, sha256);
    sections.push({ name, text, sha256, file, bytes });
    named[name] = { file, sha256, bytes };
  };
  if (Object.hasOwn(chunked, ABSTRACTS)) named[ABSTRACTS] = chunked[ABSTRACTS];
  else if (typeof abstracts === 'string' && abstracts) add(ABSTRACTS, abstracts);
  else if (isChunked(abstracts)) named[ABSTRACTS] = abstracts;
  else if (abstracts && typeof abstracts === 'object') named[ABSTRACTS] = { file: abstracts.file, sha256: abstracts.sha256, bytes: abstracts.bytes };
  for (const [key, text] of parts) {
    if (SKIP.has(key)) continue;
    if (Object.hasOwn(chunked, key)) { named[key] = chunked[key]; continue; }
    if (text === undefined) continue;
    // a null text: a section file already written, which `meta` knows (store.mjs dirtyParts; lib/section-files.mjs putSections)
    if (text === null || isSection(key, text, format)) add(key, text); else inline.push(`${JSON.stringify(key)}:${text}`);
  }
  inline.push(`"format":${format}`, `"$sections":${JSON.stringify(named)}`);
  return { headText: `{${inline.join(',')}}`, sections };
}

/** The sections a head names: [{ name, file, sha256, bytes }], or for a chunked one [{ name, kind, buckets | per, chunks }] (none for a
 *  format-1 head). namedFiles lists the files. */
export function namedSections(head) {
  const s = head?.$sections;
  return s && typeof s === 'object' ? Object.entries(s).map(([name, e]) => (isChunked(e)
    ? { name, kind: e.kind, ...(e.kind === 'map' ? { buckets: e.buckets } : { per: e.per }), chunks: e.chunks }
    : { name, file: e.file, sha256: e.sha256, bytes: e.bytes })) : [];
}

/**
 * What the history records of a head of format 3 (lib/vcs.mjs, src-tauri/src/history.rs head_pieces, the same rule): the project as the
 * file keeps it, one piece per key. Each key inline in the head is a piece with its JSON `text` (`format` and `$sections` are not); each
 * named section is one piece by the head's `sha256` and `file`, and each chunk of a chunked section one piece `NAME.I` with its `sha`,
 * `file`, `kind`, `index` and `entry`. `papers` is the records without their abstracts and `$abstracts` its own section, as in the file,
 * so a piece is read only when its hash moved and nothing is joined. Throws for a chunked entry whose kind is not map or list. Answers [{ key, name, text? , sha?, file?, kind?, index?, entry? }].
 */
export function headPieces(head) {
  const out = [];
  for (const k of Object.keys(head || {})) if (!SKIP.has(k)) out.push({ key: k, name: k, text: JSON.stringify(head[k]) ?? 'null' });
  for (const e of namedSections(head)) {
    if (e.name in head) continue;
    if (!isChunked(e)) { out.push({ key: e.name, name: e.name, sha: e.sha256, file: e.file }); continue; }
    // a chunked entry of no kind a writer makes (a damaged head): refused, as the joined read refuses it (joinChunks)
    if (e.kind !== 'map' && e.kind !== 'list') throw new Error(`A chunked section of an unknown kind: ${e.name}`);
    e.chunks.forEach((c, index) => {
      const sha = Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '';
      out.push({ key: `${e.name}.${index}`, name: e.name, index, sha, kind: e.kind, file: chunkFile(e.name, index, sha), entry: e });
    });
  }
  return out;
}

/**
 * What each top-level key a head keeps as a section file is read from, as a text that changes whenever the key's joined value can: the
 * section's sha256, and for `papers` its sha256 and `$abstracts`'s joined by `+` (the abstracts go back on the records). A key inline in
 * the head has none, and neither has `papers` in a head that names no `$abstracts` (an old sidecar's abstracts go on them), nor yet a
 * chunked section (format 3: the history by chunk is its own rule). The history
 * (lib/vcs.mjs, src-tauri/src/history.rs) reads again only a key whose source moved since its last commit. Answers { key: source }.
 */
export function sectionSources(head) {
  const named = new Map(namedSections(head).map(e => [e.name, e])), out = {};
  const abstracts = named.get(ABSTRACTS)?.sha256;
  for (const [name, e] of named) {
    if (name === ABSTRACTS || name in head || typeof e.sha256 !== 'string') continue;
    if (name !== 'papers') out[name] = e.sha256;
    else if (typeof abstracts === 'string') out[name] = `${e.sha256}+${abstracts}`;
  }
  return out;
}

/**
 * The project from a head and the text of its sections ({ name: JSON text }, and for a chunked section each chunk's text by its file,
 * { [chunkFile]: JSON text }; a chunked section missing a chunk is left out, as a section missing its text is). A section inline in the
 * head wins; `$abstracts` is put back on the records (also when the head does not name it: a format-1 sidecar's abstracts, as JSON, go
 * in the same way). The head is not changed. A format-1 head joins as itself.
 */
export function joinProject(head, texts = {}) {
  const state = { ...head };
  delete state.$sections;
  if (typeof state.format === 'number' && state.format >= 2) delete state.format;
  const chunksOf = e => {
    const t = e.chunks.map(([sha], i) => texts[chunkFile(e.name, i, sha)]);
    return t.every(x => typeof x === 'string') ? joinChunks(e, t) : undefined;
  };
  let abstracts = null;
  for (const e of namedSections(head)) {
    const { name } = e;
    if (name === ABSTRACTS) {
      if (isChunked(e)) try { abstracts = chunksOf(e) ?? null; } catch { /* an unreadable abstracts section adds nothing */ }
      continue;
    }
    if (name in head) continue;
    if (isChunked(e)) { const v = chunksOf(e); if (v !== undefined) state[name] = v; }
    else if (typeof texts[name] === 'string') state[name] = JSON.parse(texts[name]);
  }
  if (abstracts === null && typeof texts[ABSTRACTS] === 'string') {
    try { abstracts = JSON.parse(texts[ABSTRACTS]); } catch { /* an unreadable abstracts section adds nothing */ }
  }
  if (Array.isArray(state.papers) && abstracts && typeof abstracts === 'object') {
    // the records may be the caller's (inline in the head): merge onto copies
    state.papers = state.papers.map(p => (p && typeof p === 'object' ? { ...p } : p));
    mergeAbstracts(state, abstracts);
  }
  return state;
}

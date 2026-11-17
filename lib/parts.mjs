// A large JSON content stored in parts, so that two versions of a project share what they have in common (owner, 31 Oct 2026: "2.2 GB is
// too bad, there are probably so many duplicates"). Each saved state of a 26,000-record project was a whole copy, 11 to 21 MB compressed,
// in the history and in every backup, while a change touched a few records. Here the bytes are cut, without changing one, after a comma
// between the entries of an object or a list (down to CUT_DEPTH: a top-level section, a record of `papers`, a decision of `screening`), at
// entries their own first bytes choose: an entry added or changed moves only the cuts around it, so the other parts keep their hash and are
// stored once for every version. The content's hash names a small list of its parts (`<hash>.parts`); reading it joins the parts and checks
// the hash. Measured on the 26,152-record project (148 MB): 963 parts of at most 1.3 MB; a decision changed 0.65 MB of them, an edited
// record 0.05 MB, 300 records inserted mid-list 3.6 MB; the `papers` section alone shares 784 of its 786 parts with the whole project.
// app/src-tauri/src/parts.rs is the same cut, byte for byte, so the app's history, the `lykos` CLI and the Node tools share their parts.
// Pure: bytes in, cuts and parts out.

export const PARTS_KIND = 'lykos-parts';
/** A content is cut when it is JSON (an object or a list) of at least SMALL_MIN; a smaller one is stored whole. From PARTS_MIN (a whole
 *  project, a format-2 section) parts are about TARGET; under it (a format-3 chunk, of about 512 kB) about SMALL.TARGET, so a value edited
 *  in a chunk stores the few kB around it and a list shifted by a removed record shares the middle of every chunk it moved (14 Nov 2026,
 *  the Sham clone: a 520 kB `values` bucket was stored whole for four values; three records removed rewrote 172 of 173 `scenarioPapers`
 *  chunks, docs/footprint-2026-11.md "History growth"). */
export const PARTS_MIN = 4 * 1024 * 1024;
export const SMALL_MIN = 64 * 1024;
// a part ends at an entry its own hash chooses (one in TARGET bytes on average), is at least MIN and ends at the first place it can past MAX
const TARGET = 256 * 1024, MIN = 16 * 1024, MAX = 4 * 1024 * 1024, CUT_DEPTH = 4, HEAD = 128;
const SMALL = { TARGET: 32 * 1024, MIN: 4 * 1024, MAX: 512 * 1024 };

/**
 * The places the bytes may be cut: after each comma between entries of an object or a list down to CUT_DEPTH, as
 * [index after the comma, start of the entry that ended]. Strings and escapes are skipped; a content that is not an object or a list
 * at the top answers []. Every structural byte is ASCII, so a cut never falls inside a character.
 */
export function cutPoints(b) {
  let i = 0;
  while (i < b.length && (b[i] === 32 || b[i] === 10 || b[i] === 13 || b[i] === 9)) i++;
  if (b[i] !== 123 && b[i] !== 91) return [];
  const cuts = [], starts = [];
  let depth = 0, inStr = false;
  for (; i < b.length; i++) {
    const c = b[i];
    if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; continue; }
    if (c === 34) { inStr = true; continue; }
    if (c === 123 || c === 91) { depth++; starts[depth] = i + 1; continue; }
    if (c === 125 || c === 93) { depth--; continue; }
    if (c === 44 && depth <= CUT_DEPTH) { cuts.push([i + 1, starts[depth]]); starts[depth] = i + 1; }
  }
  return cuts;
}

/** FNV-1a over the first HEAD bytes of an entry, with its length: what chooses whether the entry ends a part. */
function choice(b, from, to) {
  let h = 0x811c9dc5;
  for (let i = from, end = Math.min(to, from + HEAD); i < end; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return ((h ^ (to - from)) >>> 0) % 65536;
}

/**
 * The bytes in parts: [[from, to]] covering them end to end. An entry ends a part when its choice falls under its share of TARGET: the
 * choice does not depend on where the part began, so an entry added or changed moves only the cuts around it.
 */
export function partRanges(b) {
  const out = [];
  const [target, min, max] = b.length >= PARTS_MIN ? [TARGET, MIN, MAX] : [SMALL.TARGET, SMALL.MIN, SMALL.MAX];
  let start = 0;
  for (const [at, item] of cutPoints(b)) {
    const from = Math.max(item, start), size = at - start;
    if (size < min) continue;
    if (size >= max || choice(b, from, at) < Math.max(1, Math.floor(65536 * (at - from) / target))) { out.push([start, at]); start = at; }
  }
  if (start < b.length) out.push([start, b.length]);
  return out;
}

/** Whether a content is stored in parts: JSON (an object or a list: a project, a project section or chunk) of SMALL_MIN or more. */
export const partable = bytes => bytes.length >= SMALL_MIN && (bytes[0] === 0x7b || bytes[0] === 0x5b);

// A zip (a Word, Excel or PowerPoint file, an archive) cut at its entries (14 Nov 2026, plan §4.15a "History storage"): a script that
// writes a supplement again re-zips the same figures, and each version was stored whole (Sham: 37 versions of a 5.3 MB supplement,
// 197 MB). An entry's compressed bytes of ZIP_ENTRY_MIN or more are a part of their own, the headers and small entries between them
// another, so a version shares every figure that did not change. Nothing is decompressed or rewritten: the parts joined are the file,
// byte for byte, and every reader checks the hash. Any zip this cannot read (zip64, a central directory out of place) is stored whole.
export const ZIP_ENTRY_MIN = 16 * 1024;
/** The ranges of a zip's bytes as parts ([[from, to]] end to end), or null when it is not a zip this cuts (or would make one part). */
export function zipRanges(b) {
  if (!b || b.length < SMALL_MIN || b[0] !== 0x50 || b[1] !== 0x4b || b[2] !== 3 || b[3] !== 4) return null;
  const u16 = i => b[i] | (b[i + 1] << 8), u32 = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = u16(eocd + 10), cd = u32(eocd + 16), data = [];
  let q = cd;
  for (let k = 0; k < n; k++) {
    if (q + 46 > eocd || u32(q) !== 0x02014b50) return null;
    const size = u32(q + 20), lo = u32(q + 42);
    if (size === 0xffffffff || lo === 0xffffffff || lo + 30 > cd || u32(lo) !== 0x04034b50) return null;
    const from = lo + 30 + u16(lo + 26) + u16(lo + 28);
    if (from + size > cd) return null;
    if (size >= ZIP_ENTRY_MIN) data.push([from, from + size]);
    q += 46 + u16(q + 28) + u16(q + 30) + u16(q + 32);
  }
  data.sort((x, y) => x[0] - y[0]);
  const out = [];
  let at = 0;
  for (const [from, to] of data) {
    if (from < at) return null;   // entries that overlap: not a zip this reads
    if (from > at) out.push([at, from]);
    out.push([from, to]);
    at = to;
  }
  if (at < b.length) out.push([at, b.length]);
  return out.length > 1 ? out : null;
}
/** A zip's parts and its manifest (splitParts' shape), or null when zipRanges does not cut it. */
export function splitZip(bytes) {
  const r = zipRanges(bytes);
  return r && { parts: r.map(([a, z]) => bytes.subarray(a, z)), manifest: hashes => ({ kind: PARTS_KIND, v: 1, size: bytes.length, parts: hashes }) };
}

/** Splits bytes into parts: { parts: [Uint8Array], manifest(hashes) }; one part when nothing can be cut (then it is stored whole). */
export function splitParts(bytes) {
  const parts = partRanges(bytes).map(([a, b]) => bytes.subarray(a, b));
  return { parts, manifest: hashes => ({ kind: PARTS_KIND, v: 1, size: bytes.length, parts: hashes }) };
}

/** Joins parts read back (in the manifest's order) into the content's bytes. */
export function joinParts(chunks, size) {
  const out = new Uint8Array(size ?? chunks.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of chunks) { if (at + c.length > out.length) throw new Error('the parts make more bytes than the content had'); out.set(c, at); at += c.length; }
  if (at !== out.length) throw new Error(`the parts make ${at} bytes, the content had ${out.length}`);
  return out;
}

/** A manifest read from `<hash>.parts`, or null when the text is not one. */
export function readManifest(text) {
  try { const m = JSON.parse(text); return m?.kind === PARTS_KIND && Number.isInteger(m.size) && Array.isArray(m.parts) && m.parts.every(h => /^[0-9a-f]{64}$/.test(h)) ? m : null; } catch { return null; }
}

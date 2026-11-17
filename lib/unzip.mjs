// A ZIP reader, for .docx and any other Office file the app is handed.
//
// Zero dependencies: the central directory is a fixed binary layout, and the
// browser decompresses DEFLATE itself through DecompressionStream, which is in
// every WebKit and Chromium the app runs on. zip.mjs writes archives with
// STORE only; reading has to handle DEFLATE, because Word always compresses.

const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;
const utf8 = new TextDecoder();
// Office readers share immutable archive bytes. Reuse directory scans and
// text inflation across value/style/preview passes, without retaining files.
const textArchives = new WeakMap();
const TEXT_CACHE_BYTES = 16 * 1024 * 1024;
export const ARCHIVE_LIMITS = Object.freeze({ maxArchiveBytes: 128 * 1024 * 1024, maxEntries: 10_000, maxEntryBytes: 32 * 1024 * 1024, maxExpandedBytes: 128 * 1024 * 1024 });
const bounded = (value, limit, label) => { if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error(`${label} exceeds the supported archive limit`); };

/** Entries in the archive: `{ name, method, csize, size, offset }`. */
export function entries(buf, options = {}) {
  const limits = { ...ARCHIVE_LIMITS, ...options };
  bounded(buf.byteLength, limits.maxArchiveBytes, 'File size');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The end-of-central-directory record is at the tail, after a comment of
  // up to 65535 bytes; scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = dv.getUint16(eocd + 10, true);
  bounded(count, limits.maxEntries, 'Archive entry count');
  let at = dv.getUint32(eocd + 16, true);
  const out = [], names = new Set(); let expanded = 0;
  for (let n = 0; n < count; n++) {
    if (at < 0 || at + 46 > eocd) throw new Error('central directory damaged');
    if (dv.getUint32(at, true) !== SIG_CEN) throw new Error('central directory damaged');
    const method = dv.getUint16(at + 10, true);
    const csize = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const offset = dv.getUint32(at + 42, true);
    bounded(size, limits.maxEntryBytes, 'Expanded entry size');
    expanded += size; bounded(expanded, limits.maxExpandedBytes, 'Expanded archive size');
    if (at + 46 + nameLen + extraLen + commentLen > eocd || offset + 30 > buf.length) throw new Error('archive entry is outside the file');
    const name = utf8.decode(buf.subarray(at + 46, at + 46 + nameLen));
    if (names.has(name)) throw new Error(`duplicate archive entry: ${name}`);
    names.add(name);
    out.push({ name, method, csize, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(bytes, limit, signal) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    while (true) { if (signal?.aborted) throw new DOMException('Import stopped', 'AbortError'); const { done, value } = await reader.read(); if (done) break; size += value.length; bounded(size, limit, 'Expanded entry size'); chunks.push(value); }
    const out = new Uint8Array(size); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** The bytes of one entry, decompressed. */
export async function read(buf, entry, options = {}) {
  const limits = { ...ARCHIVE_LIMITS, ...options };
  bounded(entry.size, limits.maxEntryBytes, 'Expanded entry size');
  if (options.signal?.aborted) throw new DOMException('Import stopped', 'AbortError');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const at = entry.offset;
  if (dv.getUint32(at, true) !== SIG_LOC) throw new Error(`local header missing for ${entry.name}`);
  // The local header repeats name and extra lengths; the data follows them.
  const nameLen = dv.getUint16(at + 26, true);
  const extraLen = dv.getUint16(at + 28, true);
  const start = at + 30 + nameLen + extraLen;
  if (start + entry.csize > buf.length) throw new Error(`entry data missing for ${entry.name}`);
  const data = buf.subarray(start, start + entry.csize);
  const out = entry.method === 0 ? data : entry.method === 8 ? await inflateRaw(data, Math.min(limits.maxEntryBytes, entry.size), options.signal) : null;
  if (out) { if (out.byteLength !== entry.size) throw new Error(`expanded size mismatch for ${entry.name}`); return out; }
  throw new Error(`unsupported compression ${entry.method} in ${entry.name}`);
}

/** One entry as text, or null when the archive has no such file. */
export async function readText(buf, name, options = {}) {
  let archive = textArchives.get(buf);
  if (!archive) {
    archive = { entries: new Map(entries(buf).map(e => [e.name, e])), text: new Map(), held: 0 };
    textArchives.set(buf, archive);
  }
  const e = archive.entries.get(name);
  if (!e) return null;
  bounded(e.size, options.maxEntryBytes ?? ARCHIVE_LIMITS.maxEntryBytes, 'Expanded text size');
  if (options.signal?.aborted) throw new DOMException('Import stopped', 'AbortError');
  if (archive.text.has(name)) return archive.text.get(name);
  const pending = read(buf, e, options).then(data => utf8.decode(data));
  // Count UTF-16 storage conservatively; larger entries still read normally.
  if (archive.held + e.size * 2 <= TEXT_CACHE_BYTES) {
    archive.held += e.size * 2; archive.text.set(name, pending);
    pending.catch(() => { archive.text.delete(name); archive.held -= e.size * 2; });
  }
  return pending;
}

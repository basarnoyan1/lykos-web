// The history's store packed, as git packs its objects (owner, 14 Nov 2026: "do the optimizations that git do"). The loose store
// (.lykos/vcs/objects/<aa>/<hash>[.gz|.parts|.delta], lib/vcs.mjs) kept one file per content: about 7,500 files on the Sham folder, read
// one by one, and an older version kept as changes was read through its whole chain again for each content. A pack is one file holding
// many contents, with an index for lookup by hash:
//
//   .lykos/vcs/packs/pack-<sha256>.pack   "LYKP", version (u32), count (u32), the entries, then the sha256 of everything before it
//   .lykos/vcs/packs/pack-<sha256>.idx    "LYKI", version, count, fanout (256 × u32: how many hashes start with a byte ≤ i), the hashes
//                                         sorted (32 bytes each), each entry's offset (u64 as two u32) and length (u32), the pack's
//                                         trailer, then the sha256 of the index before it. Big-endian. Written after its pack: a pack
//                                         without an index is not read.
//   .lykos/vcs/packs/cruft-<sha256>.*     the same form, for contents nothing names any more, kept until their grace ends
//                                         (tools/object-pack.mjs; `.times.json` beside it says since when each is unnamed)
//
// An entry: its type (1 byte), the content's size (varint), for a change its bases (varint n, then n × 32 hash bytes), then its payload
// to the entry's end:
//   1 WHOLE  the content, zlib          2 RAW  the content as it is (a format compressed already: a Word file's parts, an image)
//   3 PARTS  a parts list (lib/parts.mjs manifest text), zlib: the parts are contents of their own
//   4 DELTA  the changes from its bases joined (lib/delta.mjs operations), zlib; a base is any content, packed or loose
// Every reader checks a content against its hash, as for the loose store. Readers: lib/vcs.mjs and lib/section-files.mjs (the app),
// tools/object-store.mjs (Node), app/src-tauri/src/pack.rs (the app's native history and the `lykos` CLI). Pure: bytes in and out.

export const PACK_MAGIC = 'LYKP', IDX_MAGIC = 'LYKI', VERSION = 1;
export const WHOLE = 1, RAW = 2, PARTS = 3, DELTA = 4;
export const PACKS_DIR = '.lykos/vcs/packs';
const FANOUT = 12, HASHES = FANOUT + 1024;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export const toHex = (b, at = 0, n = 32) => { let s = ''; for (let i = at; i < at + n; i++) s += HEX[b[i]]; return s; };
export function fromHex(h) { const out = new Uint8Array(h.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
export const isHash = h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
/** A pack's or an index's name in the folder: `pack-<64 hex>.pack|.idx`, `cruft-…`. */
export const packName = n => /^(pack|cruft)-([0-9a-f]{64})\.(pack|idx)$/.exec(n);

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const putU32 = (b, i, x) => { b[i] = x >>> 24; b[i + 1] = (x >>> 16) & 255; b[i + 2] = (x >>> 8) & 255; b[i + 3] = x & 255; };
const ascii = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** An index read back: { count, at(i) hash bytes, find(hex) → { offset, length } | null, hashes() → hex list }; throws on another form. */
export function parseIdx(b) {
  if (b.length < HASHES + 64 || !ascii(b, 0, IDX_MAGIC) || u32(b, 4) !== VERSION) throw new Error('not a Lykos pack index');
  const count = u32(b, 8), OFF = HASHES + 32 * count, LEN = OFF + 8 * count, END = LEN + 4 * count;
  if (b.length !== END + 64 || u32(b, FANOUT + 255 * 4) !== count) throw new Error('a pack index of the wrong length');
  const cmp = (i, k) => { const at = HASHES + 32 * i; for (let j = 0; j < 32; j++) { const d = b[at + j] - k[j]; if (d) return d; } return 0; };
  return {
    count,
    packSum: toHex(b, END, 32),
    find(hex) {
      if (!isHash(hex)) return null;
      const k = fromHex(hex);
      let lo = k[0] ? u32(b, FANOUT + (k[0] - 1) * 4) : 0, hi = u32(b, FANOUT + k[0] * 4) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1, d = cmp(mid, k);
        if (!d) return { offset: u32(b, OFF + 8 * mid) * 0x100000000 + u32(b, OFF + 8 * mid + 4), length: u32(b, LEN + 4 * mid) };
        if (d < 0) lo = mid + 1; else hi = mid - 1;
      }
      return null;
    },
    hashes() { const out = []; for (let i = 0; i < count; i++) out.push(toHex(b, HASHES + 32 * i)); return out; },
  };
}

/** The index of a pack: `entries` [{ h, offset, length }], `packSum` the pack's trailer (hex), `sha` (bytes → hex) for its own trailer. */
export function buildIdx(entries, packSum, sha) {
  const list = [...entries].sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  for (let i = 1; i < list.length; i++) if (list[i].h === list[i - 1].h) throw new Error(`a pack holds ${list[i].h.slice(0, 10)} twice`);
  const n = list.length, OFF = HASHES + 32 * n, LEN = OFF + 8 * n, END = LEN + 4 * n, b = new Uint8Array(END + 64);
  b.set([...IDX_MAGIC].map(c => c.charCodeAt(0)), 0); putU32(b, 4, VERSION); putU32(b, 8, n);
  const fan = new Uint32Array(256);
  list.forEach(({ h }) => fan[parseInt(h.slice(0, 2), 16)]++);
  for (let i = 0, run = 0; i < 256; i++) { run += fan[i]; putU32(b, FANOUT + 4 * i, run); }
  list.forEach(({ h, offset, length }, i) => {
    b.set(fromHex(h), HASHES + 32 * i);
    putU32(b, OFF + 8 * i, Math.floor(offset / 0x100000000)); putU32(b, OFF + 8 * i + 4, offset >>> 0);
    putU32(b, LEN + 4 * i, length);
  });
  b.set(fromHex(packSum), END);
  b.set(fromHex(sha(b.subarray(0, END + 32))), END + 32);
  return b;
}

/** A pack's first 12 bytes. */
export function packHead(count) { const b = new Uint8Array(12); b.set([...PACK_MAGIC].map(c => c.charCodeAt(0)), 0); putU32(b, 4, VERSION); putU32(b, 8, count); return b; }

function varint(x, out) { while (x >= 0x80) { out.push((x % 0x80) | 0x80); x = Math.floor(x / 0x80); } out.push(x); }
/** An entry's bytes: its head (type, size, bases) and its payload (compressed already when the type says so). */
export function encodeEntry(type, size, payload, bases = []) {
  const head = [type];
  varint(size, head);
  if (type === DELTA) { varint(bases.length, head); }
  const b = new Uint8Array(head.length + 32 * (type === DELTA ? bases.length : 0) + payload.length);
  b.set(head, 0);
  let at = head.length;
  if (type === DELTA) for (const h of bases) { b.set(fromHex(h), at); at += 32; }
  b.set(payload, at);
  return b;
}
/** An entry read back: { type, size, bases, payload } (the payload still compressed); throws on another form. */
export function parseEntry(b) {
  let i = 0;
  const varintAt = () => { let x = 0, m = 1, c; do { if (i >= b.length) throw new Error('a pack entry ends early'); c = b[i++]; x += (c & 0x7f) * m; m *= 0x80; } while (c & 0x80); return x; };
  const type = b[i++];
  if (![WHOLE, RAW, PARTS, DELTA].includes(type)) throw new Error(`a pack entry of an unknown type ${type}`);
  const size = varintAt(), bases = [];
  if (type === DELTA) {
    const n = varintAt();
    if (!n || n > 4096 || i + 32 * n > b.length) throw new Error('a pack entry names its bases wrongly');
    for (let k = 0; k < n; k++, i += 32) bases.push(toHex(b, i));
  }
  return { type, size, bases, payload: b.subarray(i) };
}

/** A small store of contents by hash, bounded in bytes, the oldest used out first: the bases a chain of changes reads again. */
export function baseCache(maxBytes = 32 * 1024 * 1024) {
  const m = new Map();
  let bytes = 0;
  return {
    get(h) { const v = m.get(h); if (v) { m.delete(h); m.set(h, v); } return v; },
    put(h, v) {
      if (!v || v.length > maxBytes / 4 || m.has(h)) return;
      m.set(h, v); bytes += v.length;
      for (const [k, x] of m) { if (bytes <= maxBytes) break; m.delete(k); bytes -= x.length; }
    },
    clear() { m.clear(); bytes = 0; },
  };
}

/**
 * A folder's packs read by the app (lib/vcs.mjs, lib/section-files.mjs). `io`: { list(rel) → names, read(rel) → bytes,
 * readRange?(rel, offset, length) → bytes }. Without readRange (a test's folder in memory) a pack is read whole once. The indexes are
 * loaded on the first lookup and listed again when one misses (a repack since). Answers { entry(h) → parseEntry | null }.
 */
export function packReader(io) {
  let list = null, names = '';
  const whole = new Map();
  async function load() {
    let found = [];
    try { found = (await io.list(PACKS_DIR)).map(e => (typeof e === 'string' ? e : e.name)).filter(n => n.endsWith('.idx') && packName(n)).sort(); } catch { /* no packs */ }
    if (list && found.join('\n') === names) return false;
    const old = new Map((list || []).map(p => [p.name, p])), next = [];
    for (const n of found) {
      if (old.has(n)) { next.push(old.get(n)); continue; }
      try { next.push({ name: n, pack: `${PACKS_DIR}/${n.replace(/\.idx$/, '.pack')}`, idx: parseIdx(await io.read(`${PACKS_DIR}/${n}`)) }); } catch { /* being written */ }
    }
    list = next; names = next.map(p => p.name).join('\n'); whole.clear();   // one that did not read is tried again on the next look
    return true;
  }
  const locate = h => { for (const p of list) { const e = p.idx.find(h); if (e) return { pack: p.pack, ...e }; } return null; };
  async function entry(h) {
    if (!isHash(h)) return null;
    if (!list) await load();
    for (let attempt = 0; attempt < 2; attempt++) {
      let loc = locate(h);
      if (!loc && await load()) loc = locate(h);
      if (!loc) return null;
      try {
        let b;
        if (io.readRange) b = await io.readRange(loc.pack, loc.offset, loc.length);
        else { if (!whole.has(loc.pack)) whole.set(loc.pack, await io.read(loc.pack)); b = whole.get(loc.pack).subarray(loc.offset, loc.offset + loc.length); }
        if (b.length !== loc.length) throw new Error('a pack ends early');
        return parseEntry(b);
      } catch (e) { if (attempt || !(await load())) throw e; }   // a repack moved the pack: listed again, then read once more
    }
    return null;
  }
  // listed again each time: a pack a repack has moved since must not make a commit skip storing a content
  async function has(h) { if (!isHash(h)) return false; await load(); return !!locate(h); }
  return { entry, has };
}

/**
 * A packed content read and checked: `entry` the parsed entry, `get(h, depth)` the store's reader (a part or a base may be loose),
 * `inflate` (bytes → bytes, zlib), `hash` (bytes → hex), `cache` a baseCache for the bases of changes. Null when it does not read.
 */
export async function readPacked(h, e, { get, inflate, hash, cache, depth = 0, applyDelta, joinBases, joinParts, readManifest }) {
  let out = null;
  if (e.type === RAW) out = e.payload;
  else if (e.type === WHOLE) out = await inflate(e.payload);
  else if (e.type === PARTS) {
    const m = readManifest(new TextDecoder().decode(await inflate(e.payload)));
    if (!m) return null;
    const chunks = [];
    for (const p of m.parts) { const c = await get(p, depth); if (!c) return null; chunks.push(c); }
    out = joinParts(chunks, m.size);
  } else {
    if (depth >= 64) return null;
    const list = [];
    for (const b of e.bases) { let x = cache?.get(b); if (!x) { x = await get(b, depth + 1); cache?.put(b, x); } if (!x) return null; list.push(x); }
    out = applyDelta(joinBases(list), await inflate(e.payload), e.size);
  }
  return out && out.length === e.size && (await hash(out)) === h ? out : null;
}

/** A folder's packs for the app: { has(h), read(h, get, depth) }, `get` the store's reader for a part or a base; its own base cache. */
export function folderPacks(folder, { hash, cacheBytes } = {}) {
  const reader = packReader({ list: rel => folder.list(rel), read: rel => folder.read(rel), readRange: folder.readRange && ((rel, at, n) => folder.readRange(rel, at, n)) });
  const cache = baseCache(cacheBytes);
  const inflate = async z => new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  return {
    has: h => reader.has(h),
    async read(h, get, depth = 0) {
      const e = await reader.entry(h);
      if (!e) return null;
      const [{ applyDelta, joinBases }, { joinParts, readManifest }] = await Promise.all([import('./delta.mjs'), import('./parts.mjs')]);
      return readPacked(h, e, { get, inflate, hash, cache, depth, applyDelta, joinBases, joinParts, readManifest });
    },
  };
}

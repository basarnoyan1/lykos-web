// A content stored as the changes from another (plan §4.15a "History storage", 9 Nov 2026): the history keeps its newest state whole and
// an older version of a file or a project section as copies from a newer one plus the bytes that differ, so a state that changed a few
// records costs those records, not the whole section again. The form is read by lib/vcs.mjs (the app), tools/object-store.mjs (the Node
// tools) and app/src-tauri/src/parts.rs (the app's native history and the `lykos` CLI); only tools/history-compact.mjs writes it.
//
//   .lykos/vcs/objects/<aa>/<hash>.delta   gzip of a header line {"kind":"lykos-delta","v":1,"base":<hash>,"size":<bytes>} and "\n",
//                                          then operations: 0x00 <varint n> <n bytes> (insert) | 0x01 <varint at> <varint n> (copy
//                                          n bytes of the base from at). The result is checked against its hash by every reader.
//                                          "bases":[<hash>, …] in place of "base": the base is those contents joined in that order (a
//                                          section's newer pieces, or a state's sections for a copy of the whole project).
export const DELTA_KIND = 'lykos-delta';
const B = 16;                       // the base is indexed at every B-th byte; a match is at least B bytes
const P = 0x01000193, PB = powB();  // the rolling hash's multiplier and its B-th power (mod 2^32)
function powB() { let x = 1; for (let i = 0; i < B - 1; i++) x = Math.imul(x, P); return x >>> 0; }
const hashAt = (b, i) => { let h = 0; for (let k = 0; k < B; k++) h = (Math.imul(h, P) + b[i + k]) | 0; return h; };
const slotOf = (h, shift) => Math.imul(h, 0x9e3779b1) >>> shift;

class Out {
  constructor(n) { this.b = new Uint8Array(Math.max(64, n)); this.n = 0; }
  room(k) { if (this.n + k <= this.b.length) return; const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); nb.set(this.b.subarray(0, this.n)); this.b = nb; }
  byte(x) { this.room(1); this.b[this.n++] = x; }
  varint(x) { this.room(10); while (x >= 0x80) { this.b[this.n++] = (x % 0x80) | 0x80; x = Math.floor(x / 0x80); } this.b[this.n++] = x; }
  bytes(src, a, z) { this.room(z - a); this.b.set(src.subarray(a, z), this.n); this.n += z - a; }
  done() { return this.b.slice(0, this.n); }
}

/** The operations that make `target` from `base` (both Uint8Array). `spare` ({}), kept by a caller that encodes many (the repack), holds
 *  the index table between calls: one table of the largest size met, its front used, rather than a new one per call (64 MB for an 87 MB
 *  base, tried against ten candidates). The operations are the same either way. */
export function encodeDelta(base, target, spare = null) {
  const out = new Out(target.length >> 4);
  const blocks = Math.floor(base.length / B);
  const bits = Math.max(10, Math.ceil(Math.log2(blocks * 2 + 1))), shift = 32 - bits;
  if (spare && !(spare.table?.length >= 1 << bits)) spare.table = new Int32Array(1 << bits);
  const table = (spare ? spare.table.subarray(0, 1 << bits) : new Int32Array(1 << bits)).fill(-1);
  for (let k = blocks - 1; k >= 0; k--) table[slotOf(hashAt(base, k * B), shift)] = k * B;   // the earliest block wins a shared slot
  let pending = 0, i = 0;                     // target[pending, i) waits to be inserted
  const flush = z => { if (z > pending) { out.byte(0); out.varint(z - pending); out.bytes(target, pending, z); } };
  let h = target.length >= B ? hashAt(target, 0) : 0;
  while (i + B <= target.length) {
    const at = table[slotOf(h, shift)];
    if (at >= 0 && same(base, at, target, i)) {
      let a = at, s = i, n = B;
      while (a + n < base.length && i + n < target.length && base[a + n] === target[i + n]) n++;
      while (a > 0 && s > pending && base[a - 1] === target[s - 1]) { a--; s--; n++; }   // back into what waits to be inserted
      flush(s);
      out.byte(1); out.varint(a); out.varint(n);
      i = s + n; pending = i;
      if (i + B <= target.length) h = hashAt(target, i);
      continue;
    }
    if (i + B < target.length) h = (Math.imul(h - Math.imul(target[i], PB), P) + target[i + B]) | 0;
    i++;
  }
  flush(target.length);
  return out.done();
}
function same(a, ai, b, bi) { for (let k = 0; k < B; k++) if (a[ai + k] !== b[bi + k]) return false; return true; }

/** The bytes the operations make from `base`; throws when they do not read or do not make `size` bytes. */
export function applyDelta(base, ops, size) {
  const out = new Uint8Array(size);
  let i = 0, at = 0;
  const varint = () => { let x = 0, m = 1, c; do { if (i >= ops.length) throw new Error('the changes end early'); c = ops[i++]; x += (c & 0x7f) * m; m *= 0x80; } while (c & 0x80); return x; };
  while (i < ops.length) {
    const op = ops[i++];
    if (op === 0) { const n = varint(); if (at + n > size || i + n > ops.length) throw new Error('the changes make more bytes than the content had'); out.set(ops.subarray(i, i + n), at); i += n; at += n; }
    else if (op === 1) { const a = varint(), n = varint(); if (a + n > base.length || at + n > size) throw new Error('a copy reaches past its base'); out.set(base.subarray(a, a + n), at); at += n; }
    else throw new Error(`an unknown change ${op}`);
  }
  if (at !== size) throw new Error(`the changes make ${at} bytes, the content had ${size}`);
  return out;
}

const enc = new TextEncoder(), dec = new TextDecoder();
/** The `.delta` file's text before gzip: its header line and the operations. `bases`: the hashes whose contents, joined, are the base. */
export function deltaFile(bases, target, ops) {
  const list = [].concat(bases);
  const head = enc.encode(`${JSON.stringify({ kind: DELTA_KIND, v: 1, ...(list.length === 1 ? { base: list[0] } : { bases: list }), size: target.length })}\n`);
  const b = new Uint8Array(head.length + ops.length); b.set(head); b.set(ops, head.length); return b;
}
/** A `.delta` file read back (after gunzip): { bases, size, ops }, or null when it is not one. */
export function readDeltaFile(bytes) {
  const nl = bytes.indexOf(10);
  if (nl < 0) return null;
  try {
    const h = JSON.parse(dec.decode(bytes.subarray(0, nl)));
    const bases = h?.base != null ? [h.base] : h?.bases;
    return h?.kind === DELTA_KIND && Array.isArray(bases) && bases.length && bases.every(x => /^[0-9a-f]{64}$/.test(x)) && Number.isInteger(h.size) ? { bases, size: h.size, ops: bytes.subarray(nl + 1) } : null;
  } catch { return null; }
}
/** Contents joined into one base. */
export function joinBases(list) {
  if (list.length === 1) return list[0];
  const out = new Uint8Array(list.reduce((a, b) => a + b.length, 0));
  let at = 0; for (const b of list) { out.set(b, at); at += b.length; }
  return out;
}

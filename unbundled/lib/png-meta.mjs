// PNG metadata without a decoder: the size, resolution and text of a figure
// file, read by walking its chunks up to the first IDAT, and the resolution
// written back. Uint8Array only (no Buffer, no DOM), so the same code runs in
// the app and in Node.
//
// A figure from another tool can carry a large ancillary chunk ahead of its
// pHYs (a 5,758-byte caBX in Matplotlib files),
// so the walk steps over chunks by their length and never assumes pHYs sits
// next to IHDR. It stops at the first IDAT: the pixels are never read.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const METRE_PER_INCH = 0.0254;

let table = null;
/** CRC-32 of the bytes, as PNG chunks carry it (an unsigned 32-bit integer). */
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const type4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const latin1 = (b, from, to) => { let s = ''; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s; };
const isPng = b => b instanceof Uint8Array && b.length >= 8 && SIGNATURE.every((v, i) => b[i] === v);

/**
 * Walks the chunks to the first IDAT. Each entry is { type, size, at } with
 * `at` the offset of the chunk's length field; `size` is the data length. The
 * IDAT is the last entry. `truncated` is true when a chunk runs past the end.
 */
function walk(bytes) {
  const chunks = [];
  let at = 8, truncated = false;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) { truncated = true; break; }
    const size = u32(bytes, at), type = type4(bytes, at + 4);
    if (at + 12 + size > bytes.length) { chunks.push({ type, size, at }); truncated = true; break; }
    chunks.push({ type, size, at });
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + size;
  }
  return { chunks, truncated };
}

/**
 * What the file says about itself, up to its first IDAT:
 * `{ width, height, dpi, text, chunks: [{ type, size }] }`. `dpi` comes from
 * pHYs in pixels per metre, rounded to a whole number, and is null when pHYs
 * is absent or its unit is unknown; `text` maps each tEXt keyword (Software,
 * for one) to its Latin-1 text. A file that is not a PNG gives `{ error }`; a
 * file cut short gives `{ error }` together with whatever was read before the
 * cut. Never throws.
 */
export function readPngMeta(bytes) {
  if (!isPng(bytes)) return { error: 'Not a PNG file' };
  const meta = { width: null, height: null, dpi: null, text: {}, chunks: [] };
  const { chunks, truncated } = walk(bytes);
  for (const c of chunks) {
    meta.chunks.push({ type: c.type, size: c.size });
    const body = c.at + 8, whole = body + c.size <= bytes.length;
    if (!whole) continue;
    if (c.type === 'IHDR' && c.size >= 8) { meta.width = u32(bytes, body); meta.height = u32(bytes, body + 4); }
    else if (c.type === 'pHYs' && c.size >= 9 && bytes[body + 8] === 1) meta.dpi = Math.round(u32(bytes, body) * METRE_PER_INCH);
    else if (c.type === 'tEXt') {
      let z = body;
      while (z < body + c.size && bytes[z] !== 0) z++;
      if (z > body && z < body + c.size && !(latin1(bytes, body, z) in meta.text)) meta.text[latin1(bytes, body, z)] = latin1(bytes, z + 1, body + c.size);
    }
  }
  if (truncated) meta.error = 'Truncated PNG file';
  return meta;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * The same image with its resolution set to `dpi`: a pHYs chunk (pixels per
 * metre, 300 dpi is 11811) replaces the file's own or goes in just before the
 * first IDAT. Calling it twice gives identical bytes. A file that is not a PNG,
 * is cut short before its first IDAT, or a dpi that is not positive comes back
 * unchanged.
 */
export function setPngDpi(bytes, dpi) {
  if (!isPng(bytes) || !(Number(dpi) > 0)) return bytes;
  const { chunks } = walk(bytes), idat = chunks.find(c => c.type === 'IDAT');
  if (!idat || idat.at + 12 + idat.size > bytes.length) return bytes;
  const ppm = Math.round(dpi / METRE_PER_INCH), data = new Uint8Array(9), dv = new DataView(data.buffer);
  dv.setUint32(0, ppm); dv.setUint32(4, ppm); data[8] = 1;
  const fresh = chunk('pHYs', data), parts = [bytes.subarray(0, 8)];
  let put = false;
  for (const c of chunks) {
    const end = c.at + 12 + c.size;
    if (c.type === 'pHYs') { if (!put) { parts.push(fresh); put = true; } continue; }
    if (c.type === 'IDAT') { if (!put) { parts.push(fresh); put = true; } parts.push(bytes.subarray(c.at)); break; }
    parts.push(bytes.subarray(c.at, end));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

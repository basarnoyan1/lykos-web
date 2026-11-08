// JPEG metadata without a decoder: the size and resolution of a figure file, read from its segments up to the first frame header (the pixels
// are never decoded), as lib/png-meta.mjs reads a PNG's. Uint8Array only, so the same code runs in the app and in Node. Kept out of
// png-meta.mjs, which the shell loads at start; the folder checks (lib/figure-facts.mjs) are the one reader.

const latin1 = (b, from, to) => { let s = ''; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s; };
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
// the start-of-frame markers that carry the image size (C4, C8 and CC are tables, not frames)
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * The size and resolution of a JPEG, read from its segments up to the first frame header (the pixels are never decoded): `{ width, height,
 * dpi }`, dpi from the JFIF density (dots per inch, or per centimetre converted) or null. A file that is not a JPEG, or ends before its frame
 * header, gives `{ error }` with whatever was read. Never throws.
 */
export function readJpegMeta(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: 'Not a JPEG file' };
  const meta = { width: null, height: null, dpi: null };
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1];
    if (m === 0xff) { i++; continue; }                                        // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }  // markers without a length
    if (m === 0xd9 || m === 0xda) break;                                      // end of image, start of scan: no frame header before it
    const len = u16(bytes, i + 2), body = i + 4;
    if (m === 0xe0 && len >= 14 && latin1(bytes, body, body + 5) === 'JFIF\0' && body + 12 <= bytes.length) {
      const units = bytes[body + 7], x = u16(bytes, body + 8);
      if (x > 0 && units === 1) meta.dpi = x;
      else if (x > 0 && units === 2) meta.dpi = Math.round(x * 2.54);
    }
    if (SOF.has(m)) {
      if (body + 5 > bytes.length) break;
      meta.height = u16(bytes, body + 1); meta.width = u16(bytes, body + 3);
      return meta;
    }
    i = body - 2 + len;
  }
  return { ...meta, error: 'No JPEG frame header' };
}

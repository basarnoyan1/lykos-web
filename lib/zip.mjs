// A minimal ZIP writer. Entries are deflated with the platform's own
// CompressionStream when that makes them smaller, and stored otherwise — a PDF
// or an image inside is already compressed. Stored-only made a re-saved Word
// document seven times its size (157 KB to 1.19 MB); Word and Excel files are
// mostly XML, which deflates well. No npm dependency, no build step.
const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what the format stores. */
function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function deflate(data) {
  if (typeof CompressionStream === 'undefined' || data.length < 64) return null;
  try {
    const out = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(out).arrayBuffer());
    return bytes.length < data.length ? bytes : null;
  } catch { return null; }
}

/**
 * Builds a Blob from `{ name, data }` entries, where data is a string,
 * Uint8Array or Blob. `date` stamps every entry with that time instead of now.
 */
export async function zip(entries, { date: when = null } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  // A fixed time makes the same entries the same bytes (the submission bundle's inner files).
  const { time, date } = dosTime(when || new Date());

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    let data = entry.data;
    if (typeof data === 'string') data = enc.encode(data);
    else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
    const crc = crc32(data);
    const packed = await deflate(data);
    const body = packed || data, method = packed ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // UTF-8 names
    local.setUint16(8, method, true);       // 8 deflated, 0 stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory header
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
                  { type: 'application/zip' });
}

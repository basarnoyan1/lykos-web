// Import safety (plan B3): what a search export's bytes say, read honestly,
// and the file itself kept.
//
// A database export is read from its bytes, not from File.text(), which
// decodes everything as UTF-8 and turns a Windows-1252 "ü" into U+FFFD for
// good. The rules, in order:
//   1. a byte-order mark names the encoding (UTF-8, UTF-16 LE or BE) and is dropped;
//   2. bytes that are valid UTF-8 are UTF-8;
//   3. anything else is Windows-1252 (a superset of Latin-1 for text), the
//      encoding of EndNote, older RIS writers and Excel's "CSV" on Windows;
// then text that was UTF-8 once but went through a Latin-1 or Windows-1252
// reader on its way here ("MÃ¼ller" for "Müller", "â€“" for "–") is repaired,
// sequence by sequence, only where the repaired bytes are valid UTF-8.
//
// Pure apart from sha256Hex (Web Crypto, present in the webview and in Node).

// Windows-1252 bytes 0x80–0x9F; the five it leaves undefined decode to the C1
// control of the same number, as browsers' decoders do.
const CP1252_HIGH = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];
const TO_BYTE = new Map();
for (let b = 0; b < 256; b++) TO_BYTE.set(b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : b, b);

/** Windows-1252 bytes as text. */
export function decodeCp1252(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    out += String.fromCharCode(...Array.from(chunk, b => b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : b));
  }
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const isUtf8 = bytes => { try { utf8.decode(bytes); return true; } catch { return false; } };

// A lead character (bytes C2–F4 read as Windows-1252) followed by the right
// number of continuation characters (bytes 80–BF): one UTF-8 character read
// one byte at a time.
const CONT = `[\\u0080-\\u00BF${CP1252_HIGH.slice(0, 32).filter(c => c > 0xFF).map(c => `\\u${c.toString(16).padStart(4, '0')}`).join('')}]`;
const MOJIBAKE = new RegExp(`[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`, 'g');

/**
 * Text that went through one wrong decode, put back: each run of characters
 * that re-encodes (as Windows-1252) to one valid UTF-8 character becomes that
 * character. Runs that do not are left alone, so "Ã" in real Portuguese text
 * followed by an ordinary letter is untouched. Two passes undo a double
 * decode. Returns the text and how many characters were repaired.
 */
export function repairMojibake(text) {
  let t = String(text ?? ''), fixed = 0;
  for (let pass = 0; pass < 2; pass++) {
    let n = 0;
    t = t.replace(MOJIBAKE, run => {
      const bytes = Uint8Array.from(run, ch => TO_BYTE.get(ch.charCodeAt(0)) ?? 0);
      if (!isUtf8(bytes)) return run;
      const ch = utf8.decode(bytes);
      // a C1 control is never what was meant
      if (/[\u0080-\u009F]/.test(ch)) return run;
      n++; return ch;
    });
    fixed += n;
    if (!n) break;
  }
  return { text: t, fixed };
}

/**
 * An import file's bytes as text: `{ text, encoding, bom, repaired }`.
 * `encoding` is 'utf-8', 'utf-16le', 'utf-16be' or 'windows-1252'.
 */
export function decodeImport(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let text, encoding, bom = false;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { bom = true; encoding = 'utf-8'; text = new TextDecoder('utf-8').decode(bytes.subarray(3)); }
  else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { bom = true; encoding = 'utf-16le'; text = new TextDecoder('utf-16le').decode(bytes.subarray(2)); }
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { bom = true; encoding = 'utf-16be'; text = new TextDecoder('utf-16be').decode(bytes.subarray(2)); }
  else if (looksUtf16(bytes)) { encoding = bytes[1] === 0 ? 'utf-16le' : 'utf-16be'; text = new TextDecoder(encoding).decode(bytes); }
  else if (isUtf8(bytes)) { encoding = 'utf-8'; text = utf8.decode(bytes); }
  else { encoding = 'windows-1252'; text = decodeCp1252(bytes); }
  // a BOM that survived a conversion (UTF-8 BOM read as Windows-1252 is "ï»¿")
  text = text.replace(/^(﻿|ï»¿)+/, () => { bom = true; return ''; });
  const { text: repairedText, fixed } = repairMojibake(text);
  return { text: repairedText, encoding, bom, repaired: fixed };
}

// UTF-16 without a mark: ASCII text leaves every other byte zero.
function looksUtf16(bytes) {
  const n = Math.min(bytes.length, 512) & ~1;
  if (n < 8) return false;
  let even = 0, odd = 0;
  for (let i = 0; i < n; i += 2) { if (!bytes[i]) even++; if (!bytes[i + 1]) odd++; }
  return Math.max(even, odd) > n / 2 * 0.6 && Math.min(even, odd) < n / 2 * 0.05;
}

/** What the decode did, in a few words for the import message; '' when nothing needed saying. */
export function encodingNote({ encoding, repaired }) {
  return [encoding && encoding !== 'utf-8' ? `read as ${encoding === 'windows-1252' ? 'Windows-1252' : encoding.toUpperCase()}` : '',
    repaired ? `${repaired} garbled ${repaired === 1 ? 'character' : 'characters'} repaired` : ''].filter(Boolean).join(', ');
}

/** SHA-256 of bytes, as lowercase hex. */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- keeping the raw file ---------------------------------------------------
/** The folder, under the search stage folder, that holds each imported file as it was. */
export const RAW_DIR = 'Raw imports';
/** App-storage projects keep a compressed copy only up to this many compressed bytes. */
export const RAW_STORE_MAX = 512 * 1024;

/** "2026-09-28 pubmed-result.nbib": the day first, so the folder lists in import order. */
export function rawName(fileName, at = new Date().toISOString()) {
  const clean = String(fileName || 'import').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim() || 'import';
  return `${String(at).slice(0, 10)} ${clean}`;
}

/** A raw copy already made of the same bytes, found by hash in the search log. */
export const rawKept = (s, sha) => (s.searches || []).map(e => e.raw).find(r => r && r.sha256 === sha && r.kept !== 'hash') || null;

/** gzip through the platform's CompressionStream; null where there is none. */
export async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Keeps an imported file's bytes (plan B3) and returns what the search log
 * records: `{ sha256, size, name, encoding, repaired?, kept, rel?|key? }`.
 * A folder project: a copy under "<searchDir>/Raw imports/" (made once per
 * hash), or `rel` when the file already lives in the folder. App storage: a
 * gzip copy through `putFile` when at most RAW_STORE_MAX, else the hash only
 * (`kept: 'hash'`).
 */
export async function keepRawFile({ folder = null, state = {}, name, bytes, decoded = {}, rel = '', at = new Date().toISOString(), searchDir = 'Search', putFile = null }) {
  const sha256 = await sha256Hex(bytes);
  const base = { sha256, size: bytes.length, name, encoding: decoded.encoding || 'utf-8', ...(decoded.repaired ? { repaired: decoded.repaired } : {}) };
  if (folder) {
    if (rel) return { ...base, kept: 'folder', rel };
    const had = rawKept(state, sha256);
    if (had?.rel && (await folder.stat(had.rel).catch(() => ({ exists: false }))).exists) return { ...base, kept: 'folder', rel: had.rel };
    const dir = `${searchDir}/${RAW_DIR}`.replace(/^\/+/, '');
    let p = '';
    for (const seg of dir.split('/')) { p = p ? `${p}/${seg}` : seg; const st = await folder.stat(p); if (!st.exists) await folder.mkdir(p); else if (!st.dir) throw new Error(`${p} is a file, not a folder`); }
    const file = rawName(name, at), dot = file.lastIndexOf('.');
    let to = `${dir}/${file}`;
    for (let n = 2; (await folder.stat(to)).exists; n++) to = `${dir}/${dot > 0 ? `${file.slice(0, dot)} ${n}${file.slice(dot)}` : `${file} ${n}`}`;
    await folder.writeBytes(to, bytes);
    return { ...base, kept: 'folder', rel: to };
  }
  const gz = putFile ? await gzip(bytes) : null;
  if (gz && gz.length <= RAW_STORE_MAX) { await putFile(`raw-import:${sha256}`, new Blob([gz], { type: 'application/gzip' })); return { ...base, kept: 'store', key: `raw-import:${sha256}`, stored: gz.length }; }
  return { ...base, kept: 'hash' };
}

// Object URLs that are given back. A blob URL keeps its bytes alive until it is revoked, and an image drawn from a file on every visit
// (a printed figure on its item page) made a new one each time: the web view held every copy until the window closed. Here a URL is kept
// per key (the file's path), the same bytes reuse it, new bytes replace and revoke it, and past CAP_BYTES or CAP_COUNT the least recently
// used are revoked. An <img> already drawn keeps its pixels when its URL is revoked; only a later load of that URL fails, and a later
// visit asks for the URL again here.
export const CAP_BYTES = 48 * 1048576;
export const CAP_COUNT = 64;
const kept = new Map();   // key -> { url, size, sig }, oldest use first
let total = 0;

const signature = bytes => { const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let h = 2166136261 >>> 0;
  // the length and a sample of the bytes: enough to tell a changed file from the same one, cheap for a large image
  const step = Math.max(1, Math.floor(b.length / 4096));
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  return `${b.length}:${h}`; };

function drop(key) {
  const e = kept.get(key); if (!e) return;
  kept.delete(key); total -= e.size;
  try { URL.revokeObjectURL(e.url); } catch { /* already gone */ }
}

/** The object URL for `bytes` of type `type` under `key`: the same URL while the bytes are the same, a new one (the old revoked) when they change. */
export function blobUrl(key, bytes, type = '') {
  const sig = signature(bytes), had = kept.get(key);
  if (had && had.sig === sig) { kept.delete(key); kept.set(key, had); return had.url; }
  drop(key);
  const url = URL.createObjectURL(new Blob([bytes], type ? { type } : {})), size = bytes.byteLength ?? bytes.length ?? 0;
  kept.set(key, { url, size, sig }); total += size;
  for (const k of kept.keys()) { if (total <= CAP_BYTES && kept.size <= CAP_COUNT) break; if (k !== key) drop(k); }
  return url;
}

/** Revokes every kept URL (a project closed). */
export function revokeAll() { for (const k of [...kept.keys()]) drop(k); }

/** What is kept, for the tests and tools/measure-memory.mjs. */
export const blobUrlStats = () => ({ count: kept.size, bytes: total });

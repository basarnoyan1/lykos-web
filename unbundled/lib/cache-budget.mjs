// What the app may keep of what it can make again, and how it is let go: byte sizes as a person reads them, the limit on stored PDF
// previews (Settings > Storage), a least-recently-used cache measured in bytes (thumbnails in memory), and the plan of what to drop
// from a stored cache that is over its limit. Pure apart from the remembered limit, so it loads in Node.
//
// No timer and no watcher: a cache is checked when something is written to it, which is the only moment it can grow.

const MB = 1048576;

/** "0 B", "840 KB", "12.4 MB", "1.2 GB": the size of a file or a cache. */
export function formatBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < MB) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`;
  return `${(b / (1024 * MB)).toFixed(1)} GB`;
}

// ---- the limit on stored PDF previews -----------------------------------------------------------------------------------------------
// Megabytes; 0 is No limit. A device preference, kept in this browser profile as the R engine's resource policy is (lib/r.mjs).
export const PREVIEW_LIMITS = [50, 100, 250, 500, 0];
export const DEFAULT_PREVIEW_LIMIT = 100;
const LIMIT_KEY = 'lykos.preview-limit';
const storage = () => { try { return typeof document === 'undefined' ? null : globalThis.localStorage || null; } catch { return null; } };

/** A stored or chosen value as one of PREVIEW_LIMITS (megabytes); anything else is the default. */
export function parseLimit(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_PREVIEW_LIMIT;
  const n = Number(value);
  return PREVIEW_LIMITS.includes(n) ? n : DEFAULT_PREVIEW_LIMIT;
}
/** The choices as a select lists them: [megabytes, label]. */
export const limitOptions = () => PREVIEW_LIMITS.map(n => [n, n ? `${n} MB` : 'No limit']);
/** The limit in megabytes (0: none). */
export function previewLimit() { try { return parseLimit(storage()?.getItem(LIMIT_KEY)); } catch { return DEFAULT_PREVIEW_LIMIT; } }
export function setPreviewLimit(value) { const n = parseLimit(value); try { storage()?.setItem(LIMIT_KEY, String(n)); } catch {} return n; }
/** The limit in bytes; Infinity for No limit. */
export const limitBytes = (mb = previewLimit()) => (mb ? mb * MB : Infinity);

// ---- eviction ---------------------------------------------------------------------------------------------------------------------

/**
 * Which entries to drop so a cache fits its limit: the least recently used first (`at`, oldest first), until the rest fit. An entry named
 * in `keep` (the one just written) stays, even when it alone is over the limit. `entries` is `{ key: { bytes, at } }` or `[[key, { bytes, at }]]`.
 */
export function evictionPlan(entries, limit, keep = []) {
  const list = (Array.isArray(entries) ? entries : Object.entries(entries || {})).map(([key, e]) => ({ key, bytes: Math.max(0, Number(e?.bytes) || 0), at: Number(e?.at) || 0 }));
  let total = list.reduce((n, e) => n + e.bytes, 0);
  if (!(total > limit)) return [];
  const held = new Set(keep), out = [];
  for (const e of list.filter(e => !held.has(e.key)).sort((a, b) => a.at - b.at || String(a.key).localeCompare(String(b.key)))) {
    if (total <= limit) break;
    out.push(e.key); total -= e.bytes;
  }
  return out;
}

/**
 * A cache in memory bounded by bytes: get() marks an entry used, set() adds or replaces one and lets the least recently used go until the
 * total fits `max`. `onEvict(key, value)` is told about each one let go (a thumbnail's object URL is revoked there). An entry larger than
 * `max` is not kept.
 */
export function byteLru(max, { onEvict = () => {} } = {}) {
  const map = new Map();
  let total = 0;
  const drop = key => { const e = map.get(key); if (!e) return; map.delete(key); total -= e.bytes; onEvict(key, e.value); };
  return {
    get(key) { const e = map.get(key); if (!e) return undefined; map.delete(key); map.set(key, e); return e.value; },
    has: key => map.has(key),
    set(key, value, bytes) {
      const size = Math.max(0, Number(bytes) || 0);
      if (map.has(key)) { const old = map.get(key); map.delete(key); total -= old.bytes; if (old.value !== value) onEvict(key, old.value); }
      if (size > max) { onEvict(key, value); return false; }
      map.set(key, { value, bytes: size }); total += size;
      while (total > max && map.size > 1) drop(map.keys().next().value);
      return true;
    },
    delete: drop,
    clear() { for (const key of [...map.keys()]) drop(key); },
    get bytes() { return total; },
    get size() { return map.size; },
    keys: () => [...map.keys()],
  };
}

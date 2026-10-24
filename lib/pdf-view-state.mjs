// Where each PDF was left: its page, zoom, rotation and rail view, kept per file in the browser's storage and keyed by the content hash that
// lib/anchor.mjs loadPdf computes, so a moved or renamed file keeps its place and a replaced one starts fresh (plan PDF-OPTIONS §5, T1).
// Nothing is written into the PDF. The storage is injected; with none (or one that throws) the views simply start at page 1.
//
//   { [hash]: { page, zoom: 'width' | 'page' | 'actual' | number, rotation: 0 | 90 | 180 | 270, rail: 'pages' | 'contents', at } }

export const KEY = 'lykos.pdf.view';
export const MAX_ENTRIES = 200;
export const MAX_BYTES = 24 * 1024;
const FITS = ['width', 'page', 'actual'], ROTATIONS = [0, 90, 180, 270], RAILS = ['pages', 'contents'];
const HASH = /^[0-9a-f]{8,64}$/;

/** One entry made safe, or null: anything unknown or out of range is dropped, never guessed. */
export function clean(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const out = {};
  if (Number.isInteger(e.page) && e.page >= 1 && e.page <= 100000) out.page = e.page;
  if (FITS.includes(e.zoom)) out.zoom = e.zoom;
  else if (typeof e.zoom === 'number' && Number.isFinite(e.zoom) && e.zoom >= 0.25 && e.zoom <= 4) out.zoom = Math.round(e.zoom * 1000) / 1000;
  if (ROTATIONS.includes(e.rotation)) out.rotation = e.rotation;
  if (RAILS.includes(e.rail)) out.rail = e.rail;
  out.at = Number.isFinite(e.at) && e.at > 0 ? Math.round(e.at) : 0;
  return Object.keys(out).length > 1 ? out : null;
}

/** The map from stored text: anything that is not a map of clean entries gives the empty map. */
export function restore(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [hash, e] of Object.entries(data)) { const c = HASH.test(hash) ? clean(e) : null; if (c) out[hash] = c; }
  return prune(out);
}

/** At most MAX_ENTRIES entries and MAX_BYTES of text: the least recently used go first. */
export function prune(map) {
  const keep = Object.entries(map || {}).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
  let out = Object.fromEntries(keep);
  while (keep.length && JSON.stringify(out).length > MAX_BYTES) { keep.pop(); out = Object.fromEntries(keep); }
  return out;
}

/** The map with `patch` merged into the entry for `hash`, stamped `now` (a new object; the old one is untouched). */
export function remember(map, hash, patch, now = Date.now()) {
  if (!HASH.test(String(hash))) return map;
  const e = clean({ ...(map?.[hash] || {}), ...patch, at: now });
  return e ? prune({ ...map, [hash]: e }) : map;
}

/** The store over a Storage (localStorage): get and put by hash, each a read and a write of one key; a storage that throws is no storage. */
export function viewStore(storage = globalThis.localStorage) {
  const read = () => { try { return restore(storage?.getItem(KEY)); } catch { return {}; } };
  return {
    get: hash => read()[hash] || null,
    put(hash, patch, now = Date.now()) {
      const next = remember(read(), hash, patch, now);
      try { storage?.setItem(KEY, JSON.stringify(next)); } catch {}
      return next[hash] || null;
    },
  };
}

/** An app-wide choice (the rail open, Match case): a boolean under its own key, `fallback` when unset or unreadable. */
export function flag(key, fallback, storage = globalThis.localStorage) {
  return {
    get: () => { try { const v = storage?.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } },
    set: on => { try { storage?.setItem(key, on ? '1' : '0'); } catch {} },
  };
}

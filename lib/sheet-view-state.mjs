// How each spreadsheet was left: per worksheet, the frozen first row and the frozen columns, the column widths, the hidden columns, the zoom and
// whether text wraps. Kept per file in the browser's storage, keyed by the file's path, in the way lib/pdf-view-state.mjs keeps a PDF's page.
// Nothing is written into the workbook: freezing, hiding and widths are how the sheet is looked at, never part of the file. The storage is
// injected; with none (or one that throws) a sheet simply opens as the file draws it.
//
//   { [file]: { sheets: { [sheet name]: { freezeRows: 0 | 1, freezeCols: 0..MAX_FREEZE, widths: { [column]: px }, hidden: [column], zoom, wrap } }, at } }

export const KEY = 'lykos.sheet.view';
export const MAX_ENTRIES = 100;
export const MAX_BYTES = 48 * 1024;
export const MAX_FREEZE = 8;
const MAX_COLUMN = 16383, MIN_WIDTH = 40, MAX_WIDTH = 1200, MAX_SHEETS = 100, MAX_PER_SHEET = 600;
const fileOk = key => typeof key === 'string' && key.length > 0 && key.length <= 400;

/** One sheet's state made safe: anything unknown or out of range is dropped, never guessed. The empty state is null. */
export function cleanSheet(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const out = {};
  if (e.freezeRows === 1) out.freezeRows = 1;
  if (Number.isInteger(e.freezeCols) && e.freezeCols >= 1 && e.freezeCols <= MAX_FREEZE) out.freezeCols = e.freezeCols;
  if (e.widths && typeof e.widths === 'object' && !Array.isArray(e.widths)) {
    const widths = {};
    for (const [c, w] of Object.entries(e.widths).slice(0, MAX_PER_SHEET)) {
      const col = Number(c);
      if (Number.isInteger(col) && col >= 0 && col <= MAX_COLUMN && Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) widths[col] = Math.round(w);
    }
    if (Object.keys(widths).length) out.widths = widths;
  }
  if (Array.isArray(e.hidden)) {
    const hidden = [...new Set(e.hidden.filter(c => Number.isInteger(c) && c >= 0 && c <= MAX_COLUMN))].sort((a, b) => a - b).slice(0, MAX_PER_SHEET);
    if (hidden.length) out.hidden = hidden;
  }
  if (typeof e.zoom === 'number' && Number.isFinite(e.zoom) && e.zoom >= 0.5 && e.zoom <= 2 && e.zoom !== 1) out.zoom = Math.round(e.zoom * 100) / 100;
  if (e.wrap === true) out.wrap = true;
  return Object.keys(out).length ? out : null;
}

/** One file's entry made safe, or null. */
export function clean(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e) || !e.sheets || typeof e.sheets !== 'object' || Array.isArray(e.sheets)) return null;
  const sheets = {};
  for (const [name, s] of Object.entries(e.sheets).slice(0, MAX_SHEETS)) {
    const c = typeof name === 'string' && name.length <= 80 ? cleanSheet(s) : null;
    if (c) sheets[name] = c;
  }
  return Object.keys(sheets).length ? { sheets, at: Number.isFinite(e.at) && e.at > 0 ? Math.round(e.at) : 0 } : null;
}

/** The map from stored text: anything that is not a map of clean entries gives the empty map. */
export function restore(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [file, e] of Object.entries(data)) { const c = fileOk(file) ? clean(e) : null; if (c) out[file] = c; }
  return prune(out);
}

/** At most MAX_ENTRIES files and MAX_BYTES of text: the least recently used go first. */
export function prune(map) {
  const keep = Object.entries(map || {}).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
  let out = Object.fromEntries(keep);
  while (keep.length && JSON.stringify(out).length > MAX_BYTES) { keep.pop(); out = Object.fromEntries(keep); }
  return out;
}

/** The map with `state` the whole state of one sheet of `file`, stamped `now`; an empty state forgets the sheet (a new object; the old one is untouched). */
export function remember(map, file, sheet, state, now = Date.now()) {
  if (!fileOk(file) || typeof sheet !== 'string' || !sheet || sheet.length > 80) return map;
  const sheets = { ...(map?.[file]?.sheets || {}) };
  const c = cleanSheet(state);
  if (c) sheets[sheet] = c; else delete sheets[sheet];
  const next = { ...map };
  if (Object.keys(sheets).length) next[file] = { sheets, at: now }; else delete next[file];
  return prune(next);
}

/** The store over a Storage (localStorage): the state of one sheet of one file, read and written whole; a storage that throws is no storage. */
export function sheetStore(storage = globalThis.localStorage) {
  const read = () => { try { return restore(storage?.getItem(KEY)); } catch { return {}; } };
  return {
    get: (file, sheet) => read()[file]?.sheets?.[sheet] || null,
    put(file, sheet, state, now = Date.now()) {
      const next = remember(read(), file, sheet, state, now);
      try { storage?.setItem(KEY, JSON.stringify(next)); } catch {}
      return next[file]?.sheets?.[sheet] || null;
    },
  };
}

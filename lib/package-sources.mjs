// What an item of the package is drawn from (plan, package amendment): a figure's PNG or JPEG in the folder, a table's range of a workbook, a document
// generated from the project (the risk-of-bias decision log, lib/rob-log.mjs; the supplementary tables, lib/supplement-doc.mjs), or
// what Lykos holds itself in .lykos/package (a table read from a Word file, an image that matches no folder file), or the project's evidence
// table for chosen studies and fields (lib/package-select.mjs), or a table or figure the app draws (`{ app: key }`, lib/app-items.mjs: the
// caller's `app` loader draws it from the project as it is, at print size). A table's selection (`keep`) is applied to whatever grid it is drawn from.
// `read` is the folder's own by default; an earlier version is rebuilt with History's (lib/package-write.mjs).
import { readPngMeta } from './png-meta.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { evidenceGrid, applyKeep } from './package-select.mjs';
import { markGrid } from './footnotes.mjs';

export const HELD_DIR = '.lykos/package';
/** Documents the package writes from the project itself (`source: { generated }`), loaded on first use: each gives the blocks. */
export const GENERATED = {
  'rob-log': { label: 'Risk-of-bias decision log', blocks: async state => { const m = await import('./rob-log.mjs'); return m.decisionLogBlocks(m.decisionLog(state)); } },
  // the review's own record for verification, with the documentation kept with each assessment (lib/rob-record.mjs)
  'rob-record': { label: 'Risk-of-bias decision log for verification', blocks: async state => (await import('./rob-record.mjs')).robRecordBlocks(state) },
  'supplement': { label: 'Supplementary material', blocks: async state => (await import('./supplement-doc.mjs')).supplementBlocks(state) },
};
const dec = new TextDecoder();
const extOf = p => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

export function imageSize(bytes) {
  const png = readPngMeta(bytes);
  if (!png.error && png.width) return { w: png.width, h: png.height, mime: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8], mime: 'image/jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

export function gridFromRows(rows) {
  const cols = Math.max(1, ...rows.map(r => r.length));
  const longest = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map(r => String(r[c] ?? '').length)));
  const total = longest.reduce((a, x) => a + x, 0);
  return { cols: longest.map(x => Math.round((468 * x) / total)), borders: 'all',
    rows: rows.map((r, i) => ({ header: i === 0, cells: Array.from({ length: cols }, (_, c) => ({ text: String(r[c] ?? '') })) })) };
}
const colNo = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function cut(rows, range) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range || '');
  if (!m) return rows;
  const [c0, r0, c1, r1] = [colNo(m[1].toUpperCase()), Number(m[2]) - 1, colNo(m[3].toUpperCase()), Number(m[4]) - 1];
  return rows.slice(r0, r1 + 1).map(r => r.slice(c0, c1 + 1));
}
const cellValue = c => (c && typeof c === 'object' ? c.v ?? c.text ?? '' : c ?? '');

/** Each item's source by id: `{ image }`, `{ grid }` or `{ error }`. `state` is the project, for evidence table sources; `app(source)` draws an app source. */
export async function loadSources(folder, items, { read: readSource = path => folder.read(path), state = null, app = null } = {}) {
  const out = new Map();
  for (const it of items) {
    const s = it.source || {};
    try {
      // a figure of several drawings of the app (`apps`: a traffic-light plot over its summary), stacked in one figure under one caption
      if (it.kind === 'figure' && Array.isArray(s.apps) && s.apps.length) {
        const got = [];
        for (const k of s.apps) { const g = app ? await app({ ...s, app: k }, it) : { error: 'Drawn by the app: build it in Tables and figures' }; if (!g.image) { got.length = 0; out.set(it.id, g.error ? g : { error: `${k}: not a drawing` }); break; } got.push(g); }
        if (got.length === s.apps.length) out.set(it.id, { image: got[0].image, images: got.map(g => (g.svg ? { ...g.image, svg: g.svg } : g.image)), sigs: Object.fromEntries(s.apps.map((k, i) => [k, got[i].sig]).filter(([, v]) => v)) });
        continue;
      }
      if (s.app) {
        const got = app ? await app(s, it) : { error: 'Drawn by the app: build it in Tables and figures' };
        out.set(it.id, got.grid ? { ...got, grid: applyKeep(got.grid, it.keep) } : got);
        continue;
      }
      if (s.generated) {
        const g = GENERATED[s.generated];
        out.set(it.id, !g ? { error: `Unknown generated document: ${s.generated}` } : state ? { blocks: await g.blocks(state) } : { error: 'The project is not available here' });
        continue;
      }
      if (s.evidence) {
        out.set(it.id, state ? { grid: applyKeep(evidenceGrid(state, s), it.keep) } : { error: 'The evidence table is not available here' });
        continue;
      }
      if (s.held) {
        const bytes = await readSource(`${HELD_DIR}/${s.held}`);
        if (it.kind === 'table') out.set(it.id, { grid: applyKeep(JSON.parse(dec.decode(bytes)), it.keep) });
        else { const size = imageSize(bytes); out.set(it.id, size ? { image: { bytes, ...size } } : { error: 'Needs a PNG or JPEG' }); }
        continue;
      }
      // a figure of several pictures (`paths`: a traffic-light plot over its summary), stacked in one figure under one caption
      if (it.kind === 'figure' && Array.isArray(s.paths) && s.paths.length) {
        const images = [];
        for (const p of s.paths) { let b; try { b = await readSource(p); } catch { images.length = 0; out.set(it.id, { error: `Missing source: ${p}` }); break; } const size = imageSize(b); if (!size) { images.length = 0; out.set(it.id, { error: `${p}: needs a PNG or JPEG` }); break; } images.push({ bytes: b, ...size }); }
        if (images.length === s.paths.length) out.set(it.id, { image: images[0], images });
        continue;
      }
      let bytes;
      try { bytes = await readSource(s.path); } catch { out.set(it.id, { error: `Missing source: ${s.path}` }); continue; }
      if (it.kind === 'figure') { const size = imageSize(bytes); out.set(it.id, size ? { image: { bytes, ...size } } : { error: 'Needs a PNG or JPEG' }); continue; }
      if (['xlsx', 'xls'].includes(extOf(s.path))) {
        const book = await readXlsx(bytes), sheet = book.sheets.find(x => x.name === s.sheet) || book.sheets[0];
        out.set(it.id, { grid: applyKeep(gridFromRows(cut(sheet.rows.map(r => r.map(cellValue)), s.range)), it.keep) });
        continue;
      }
      out.set(it.id, { error: `Cannot read ${s.path} as a table` });
    } catch (err) { out.set(it.id, { error: String(err?.message || err) }); }
  }
  // a table's footnote marks are drawn in the cells that carry them (lib/footnotes.mjs), after its rows and columns are kept
  for (const it of items) { const got = out.get(it.id); if (it.marks?.length && got?.grid) out.set(it.id, { ...got, grid: markGrid(got.grid, it.marks) }); }
  return out;
}

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
/**
 * What a build read, by hash: each folder file by its path, the evidence table's grids as one `evidence` hash (its values are not kept per
 * version), and each drawing of the app by its signature (`app:<key>`, what lib/package-state.mjs partState compares with the data now).
 */
export async function sourceHashes(folder, items, { sources = null } = {}) {
  const out = {};
  for (const it of items) { const p = it.source?.path; if (p && !(p in out)) { try { out[p] = await hex(await folder.read(p)); } catch { out[p] = null; } } }
  for (const it of items) { const k = it.source?.app, sig = sources?.get(it.id)?.sig; if (k && sig) out[`app:${k}`] = sig; }
  for (const it of items) for (const [k, sig] of Object.entries(sources?.get(it.id)?.sigs || {})) out[`app:${k}`] = sig;
  const grids = items.filter(it => it.source?.evidence).map(it => sources?.get(it.id)?.grid).filter(Boolean);
  if (grids.length) out.evidence = await evidenceHash(grids);
  return out;
}
/** The text of evidence table grids, hashed: whether today's values differ from a version's. */
export const evidenceHash = async grids => hex(enc.encode(JSON.stringify(grids.map(g => g.rows.map(r => r.cells.map(c => (c.merged ? '^' : c.text)))))));

// The tables, figures and documents a project's folder holds, for the Tables and figures page: what the researcher and their scripts made, beside
// what Lykos makes. Read from the folder as it is, never stored. Grouped by top-level folder (the folder changed most recently first), the formats of
// one figure in one row ("Figure 1 · PNG · PDF · TIF"), and the archive folders, the papers and the app's own store left out (lib/vcs.mjs DEFAULTS).
//
// It names no project, folder or file: the folders are the project's own, and only the extension says what a file is.
import { DEFAULTS } from './vcs.mjs';
import { nativeOf } from './vcs-native.mjs';

export const KIND_OF = { png: 'Figure', jpg: 'Figure', jpeg: 'Figure', svg: 'Figure', tif: 'Figure', tiff: 'Figure', gif: 'Figure', webp: 'Figure', eps: 'Figure',
  pdf: 'PDF', xlsx: 'Table', xls: 'Table', csv: 'Table', tsv: 'Table', docx: 'Document', pptx: 'Slides', pzfx: 'Prism' };
const SHOW_ORDER = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'pdf', 'tif', 'tiff', 'eps', 'pzfx', 'xlsx', 'xls', 'csv', 'tsv', 'docx', 'pptx'];   // which format opens a row
const SKIP_DIRS = ['.lykos', '.git', 'node_modules', '__pycache__', ...DEFAULTS.hashOnly.map(p => p.replace(/\/$/, ''))];
const extOf = p => { const b = p.slice(p.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const skipped = p => p.split('/').some((part, i, all) => i < all.length - 1 && SKIP_DIRS.includes(part)) || /(^|\/)(~\$|\.~lock\.)/.test(p);

/**
 * The folder's result files as groups: `[{ folder, newest, items: [{ name, place, kind, formats: [ext], open, paths, mtime, size }] }]`. `files` are
 * `{ path, size, mtime }` as a walk gives them. A figure's formats share one row when they share a name and a folder.
 */
export function groupResults(files) {
  const rows = new Map();
  for (const f of files) {
    const ext = extOf(f.path);
    if (!KIND_OF[ext] || skipped(f.path)) continue;
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '', base = f.path.slice(f.path.lastIndexOf('/') + 1, f.path.length - ext.length - 1);
    const key = `${dir}/${base}|${KIND_OF[ext] === 'Figure' || ext === 'pdf' ? 'fig' : ext}`;   // a figure's PNG, PDF and TIFF are one row; a table's xlsx and csv stay apart
    const row = rows.get(key) || { name: base, dir, formats: [], paths: {}, mtime: 0, size: 0 };
    row.formats.push(ext); row.paths[ext] = f.path; row.mtime = Math.max(row.mtime, f.mtime || 0); row.size += f.size || 0;
    rows.set(key, row);
  }
  const groups = new Map();
  for (const r of rows.values()) {
    r.formats.sort((a, b) => SHOW_ORDER.indexOf(a) - SHOW_ORDER.indexOf(b));
    r.open = r.paths[r.formats[0]];
    r.kind = r.formats.some(x => KIND_OF[x] === 'Figure') ? 'Figure' : KIND_OF[r.formats[0]];
    const top = r.dir.split('/')[0] || '';
    r.place = r.dir.split('/').slice(1).join('/');
    if (!groups.has(top)) groups.set(top, { folder: top, newest: 0, items: [] });
    const g = groups.get(top); g.items.push(r); g.newest = Math.max(g.newest, r.mtime);
  }
  for (const g of groups.values()) g.items.sort((a, b) => (a.place ? 1 : 0) - (b.place ? 1 : 0) || a.place.localeCompare(b.place) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [...groups.values()].sort((a, b) => b.newest - a.newest || a.folder.localeCompare(b.folder));
}

async function walk(folder, rel = '', out = []) {
  for (const e of await folder.list(rel)) {
    const path = e.rel || (rel ? `${rel}/${e.name}` : e.name);
    if (e.dir) { if (!SKIP_DIRS.includes(e.name)) await walk(folder, path, out); } else out.push({ path, size: e.size, mtime: e.mtime });
  }
  return out;
}

/** The folder's files outside the archives and the app's store: `[{ path, size, mtime }]`, one native walk in the desktop app. */
export async function projectFiles(folder) {
  const fast = nativeOf(folder);
  return (fast ? await fast.walk(SKIP_DIRS) : await walk(folder)).filter(f => !skipped(f.path));
}

/** The groups for a project folder: one native walk in the desktop app, the folder's own listing elsewhere. */
export async function folderResults(folder) {
  return groupResults(await projectFiles(folder));
}

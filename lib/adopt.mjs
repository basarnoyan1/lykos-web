// What happens to the files around an adoption, on a person's action (plan §4.15d). lib/drift.mjs holds the
// comparison and is pure; this is the part that touches the folder:
//
//   fileFacts(folder, path)               the file's hash, size and time as they are now, or null;
//   observeFiles(folder, adopted)         each adopted file as it is now (read afresh, no cache), for a plan;
//   planWriteBack(folder, state)          the write back plan for the project as it stands (drift.mjs writeBackPlan); writes nothing;
//   adoptFromFolder(folder, entries)      records the entries of an import a person confirmed, with their files' bytes known;
//   applyWriteBack(folder, plan, over, { version })   writes the cells of a confirmed write back plan into the workbooks, then records
//                                         that the file and the app agree there. With `version` the edited workbook is saved as the next
//                                         version of the file and the previous one moves to Archive/<folder>/vN/ (nextVersionPath).
//
// Nothing here runs by itself: no poll, no detector and no watch calls these. A write back is the only thing in Lykos that
// changes a file the project was adopted from, and it changes only the cells its plan names, in an .xlsx, after the
// file's hash (or, when only a stamp was recorded, its stamp) is checked against what the plan was made from.
import { documentHash } from './files.mjs';
import { recordAdoption, readSidecar } from './figure-sidecar.mjs';
import { ensureDir } from './project-folder.mjs';
import { parseVersionFull } from './folder-map.mjs';
import { saveXlsx } from './xlsx-edit.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { parseDelimited } from './spreadsheet.mjs';
import { withFile, afterWriteBack, stampOf, observeWorkbook, writeBackPlan, fileEntry, addAdoption } from './drift.mjs';

const extOf = p => { const b = String(p).slice(String(p).lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const dirOf = p => String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '';
const joinPath = (...parts) => parts.filter(Boolean).join('/');

/**
 * Where a write back puts the next version of a file and where the previous one goes: "T v2.xlsx" becomes "T v3.xlsx" and the old file moves to
 * Archive/<folder>/v2/T v2.xlsx (the convention of lib/folder-map.mjs nextVersion); a name with no version is v1, and the new file is "<name> v2".
 * Answers `{ from, to, next, archive }` (the version numbers, the new path, the archive path).
 */
export function nextVersionPath(path) {
  const base = baseOf(path), dir = dirOf(path), dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
  const { version } = parseVersionFull(base);
  let to = `${stem} v2`, from = 1;
  if (version > 0) {
    const last = [...stem.matchAll(/(v(?:er(?:sion)?)?[\s._-]?)(\d{1,3})(?=[\s._-]|$)/gi)].filter(m => Number(m[2]) === version).at(-1);
    if (last) { to = `${stem.slice(0, last.index)}${last[1]}${version + 1}${stem.slice(last.index + last[0].length)}`; from = version; }
  }
  return { from, to: from + 1, next: joinPath(dir, `${to}${ext}`), archive: joinPath('Archive', dir, `v${from}`, base) };
}

/** `{ hash, size, mtime }` of a file in the folder now, or null when it cannot be read. */
export async function fileFacts(folder, path) {
  try {
    const st = await folder.stat(path);
    if (!st?.exists || st.dir) return null;
    return { hash: await documentHash(await folder.read(path)), size: st.size, mtime: st.mtime };
  } catch { return null; }
}

/** Every adopted file as it is now, in the shape lib/drift.mjs `observe` reads: read afresh (a plan is made from the file as it is, not from a cache). */
export async function observeFiles(folder, adopted) {
  const out = {};
  for (const e of Object.values(adopted?.files || {})) {
    let st;
    try { st = await folder.stat(e.path); } catch { st = null; }
    if (!st?.exists || st.dir) { out[e.path] = { exists: false }; continue; }
    const stamp = stampOf(st.size, st.mtime);
    if (stamp && stamp === e.stamp) { out[e.path] = { exists: true, stamp, unchanged: true }; continue; }
    let bytes;
    try { bytes = await folder.read(e.path); } catch { out[e.path] = { exists: true, stamp, unread: 'unreadable' }; continue; }
    const o = { exists: true, stamp, hash: await documentHash(bytes) };
    if (o.hash !== e.hash && e.cells.length) {
      try {
        const ext = extOf(e.path);
        if (ext === 'xlsx' || ext === 'xlsm') Object.assign(o, observeWorkbook(await readXlsx(bytes), e));
        else if (ext === 'csv' || ext === 'tsv') Object.assign(o, observeWorkbook({ sheets: [{ name: e.cells[0].s, rows: parseDelimited(new TextDecoder().decode(bytes), ext === 'tsv' ? '\t' : ',').rows }] }, e));
      } catch { /* cells that cannot be read are left out, and the plan says so */ }
    }
    out[e.path] = o;
  }
  return out;
}

/** The write back plan for the project as it stands: what the app holds that an adopted workbook does not. Reads; writes nothing. `opts.keys` limits it to those cells. */
export async function planWriteBack(folder, state, over = {}, opts = {}) {
  const a = await readSidecar('adopted', { folder, ...over });
  return writeBackPlan(a.doc, await observeFiles(folder, a.doc), state, opts);
}

/** Records `entries` (lib/drift.mjs) in `.lykos/adopted.json` with each file's hash, size and time read now. Answers what recordAdoption answers. */
export async function adoptFromFolder(folder, entries, over = {}) {
  const list = [];
  for (const e of entries || []) list.push(withFile(e, folder ? await fileFacts(folder, e.path) : null));
  return recordAdoption(list, { ...(folder ? { folder } : {}), ...over });
}

/**
 * Writes a write back plan (lib/drift.mjs `writeBackPlan`) into the folder. Per file: a file that is not an .xlsx, that
 * changed since the plan was made, or that cannot be written is skipped with the reason; the rest are written cell by
 * cell and recorded. Answers `{ written: [{ path, cells }], skipped: [{ path, reason }], recorded }`.
 */
export async function applyWriteBack(folder, plan, over = {}, { version = false } = {}) {
  const written = [], skipped = [];
  if (!folder || folder.can?.write === false || typeof folder.replaceBytes !== 'function') return { written, skipped: (plan?.files || []).map(f => ({ path: f.path, reason: 'The folder cannot be written' })), recorded: null };
  const state = await readSidecar('adopted', { folder, ...over });
  let doc = state.doc;
  const entries = [];
  for (const f of plan?.files || []) {
    const skip = reason => skipped.push({ path: f.path, reason });
    if (!/\.xlsx$/i.test(f.path)) { skip('Only .xlsx workbooks are written back'); continue; }
    let bytes;
    try { bytes = await folder.read(f.path); } catch { skip('The file could not be read'); continue; }
    const st = await folder.stat(f.path);
    if (f.expectHash ? await documentHash(bytes) !== f.expectHash : stampOf(st.size, st.mtime) !== f.expectStamp) { skip('The file changed since the plan was made'); continue; }
    let next;
    try { next = await saveXlsx(bytes, f.changes.map(c => ({ sheet: c.sheet, cell: c.cell, value: c.to }))); }
    catch (err) { skip(`The workbook could not be edited: ${err.message}`); continue; }
    let at = f.path, archived = null;
    if (version) {
      const t = nextVersionPath(f.path);
      if (folder.can?.rename === false || typeof folder.rename !== 'function') { skip('Files cannot be moved in this folder, so the previous version cannot be archived'); continue; }
      if ((await folder.stat(t.next)).exists) { skip(`${baseOf(t.next)} already exists`); continue; }
      if ((await folder.stat(t.archive)).exists) { skip(`The archive already holds ${t.archive}`); continue; }
      try { await ensureDir(folder, dirOf(t.archive)); await folder.writeBytes(t.next, next); } catch { skip('The new version could not be written'); continue; }
      try { await folder.rename(f.path, t.archive); archived = t.archive; } catch { skip(`${baseOf(t.next)} was written, but ${baseOf(f.path)} could not be moved to the archive`); continue; }
      at = t.next;
    } else {
      try { await folder.replaceBytes(f.path, next); } catch { skip('The file could not be written'); continue; }
    }
    const now = await fileFacts(folder, at);
    doc = afterWriteBack(doc, f.path, f.changes, { file: now, refresh: !f.moved });
    if (at !== f.path) {
      // the record follows the file: its cells now belong to the new version
      const { [f.path]: old, ...rest } = doc.files;
      doc = addAdoption({ ...doc, files: rest }, fileEntry({ ...old, path: at, file: old }));
      entries.push(doc.files[at]);
    } else entries.push(doc.files[f.path]);
    written.push({ path: at, ...(at !== f.path ? { from: f.path, archived } : {}), cells: f.changes.length });
  }
  let recorded = null;
  if (entries.length) recorded = await recordAdoption(entries, { folder, ...over }, { remove: written.filter(w => w.from).map(w => w.from) });
  return { written, skipped, recorded };
}

// A project folder on disk: its layout, its guide, the outputs Lykos writes
// into it, and what is already there (plan §4.15a).
//
// The rules live in lib/folder-map.mjs, which is pure; this module does the
// reading and writing through the open folder (lib/fsys.mjs), so it works the
// same on a desktop path and a browser directory handle. Nothing here moves a
// file without a plan the person has seen, and nothing is ever deleted: a new
// version moves the previous one into the archive, and a reorganisation keeps
// an undo log in .lykos/organise/.
import { svgToPng as rasterPng } from './figure-draw.mjs';
import { folderLayout, layoutDirs, resolveLayout, stageOfFolder, headerRow, folderIndex, organisePlan,
  undoMoves, nextVersion, guideText, GUIDE, GUIDE_BEGIN, STATE_DIR, ARCHIVE } from './folder-map.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { entries as zipEntries, read as unzipRead } from './unzip.mjs';
import { parseDelimited } from './spreadsheet.mjs';
import { join, parentOf, baseName } from './fsys.mjs';

const LAYOUT_FILE = `${STATE_DIR}/layout.json`;
const OUTPUTS_FILE = `${STATE_DIR}/outputs.json`;
const enc = new TextEncoder(), dec = new TextDecoder();
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function readJson(folder, rel) {
  try { const st = await folder.stat(rel); if (!st.exists || st.dir) return null; return JSON.parse(dec.decode(await folder.read(rel))); }
  catch { return null; }
}
/** A folder and its parents, each made only when missing. */
export async function ensureDir(folder, rel) {
  if (!rel) return;
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    const st = await folder.stat(p);
    if (st.exists) { if (!st.dir) throw new Error(`${p} is a file, not a folder`); continue; }
    await folder.mkdir(p);
  }
}

// ---- the layout -------------------------------------------------------------
/** Top-level folder names. */
async function topDirs(folder) {
  return (await folder.list('')).filter(e => e.dir && !e.name.startsWith('.')).map(e => e.name);
}

/**
 * The folders this project uses: the standard layout for a folder Lykos laid
 * out (recorded in .lykos/layout.json), otherwise whatever the person's own
 * folder names stand for, with the standard names for what is missing.
 */
export async function projectLayout(folder, typeId = 'other') {
  const saved = await readJson(folder, LAYOUT_FILE);
  const layout = resolveLayout(await topDirs(folder), saved?.type || typeId);
  return { ...layout, laidOut: !!saved };
}

/** Where PDFs attached to a folder project go: the papers folder, or papers/ in a folder Lykos never laid out. */
export async function papersDir(folder, typeId = 'other') {
  const layout = await projectLayout(folder, typeId);
  if (layout.laidOut) return layout.dirFor('papers');
  const dirs = await topDirs(folder);
  return dirs.find(d => ['papers', 'literature'].includes(stageOfFolder(d))) || 'papers';
}

/**
 * Lays out a new project folder for its research type: the numbered stage
 * folders, the paper subfolders, Archive, the layout record and AGENTS.md.
 * Folders that exist are left as they are; nothing is moved.
 */
export async function createLayout(folder, typeId, { name = '', type = '', question = '' } = {}) {
  const layout = folderLayout(typeId);
  for (const dir of layoutDirs(layout)) await ensureDir(folder, dir);
  await folder.writeText(LAYOUT_FILE, JSON.stringify({ version: layout.version, type: layout.type, createdAt: new Date().toISOString() }, null, 2));
  await writeGuide(folder, { name, type, question, typeId });
  return layout;
}

// ---- the guide ----------------------------------------------------------------
/**
 * Writes AGENTS.md, or rewrites Lykos's part of it. A guide a person wrote
 * without Lykos's markers is left alone unless `append` is set (Organise folder
 * asks first); the result says which happened.
 */
export async function writeGuide(folder, { name = '', type = '', question = '', typeId = 'other', studies = 0, append = false } = {}) {
  const st = await folder.stat(GUIDE);
  const existing = st.exists ? dec.decode(await folder.read(GUIDE)) : '';
  if (existing && !existing.includes(GUIDE_BEGIN) && !append) return { written: false, reason: 'AGENTS.md has no Lykos section' };
  const layout = await projectLayout(folder, typeId);
  const log = await readJson(folder, OUTPUTS_FILE) || {};
  const current = Object.values(log).sort((a, b) => a.label.localeCompare(b.label))
    .map(o => ({ label: o.label, path: o.paths.join(', '), version: o.version }));
  const text = guideText({ name: name || folder.name, type, question, layout, current, studies, updated: today() }, existing);
  if (text === existing) return { written: false, reason: 'unchanged' };
  await folder.writeText(GUIDE, text);
  return { written: true };
}

// ---- reading what is there -------------------------------------------------
/** Every file and folder under the root, `.lykos` and hidden entries left out. */
export async function scanFolder(folder, { maxFiles = 5000, maxDepth = 8 } = {}) {
  const out = [];
  const queue = [['', 0]];
  while (queue.length && out.length < maxFiles) {
    const [rel, depth] = queue.shift();
    let rows;
    try { rows = await folder.list(rel); } catch { continue; }
    for (const e of rows) {
      if (e.name.startsWith('.') && !/^\.~lock/.test(e.name)) continue;
      out.push({ path: e.rel, dir: !!e.dir, size: e.size || 0, mtime: e.mtime || 0 });
      if (e.dir && depth < maxDepth) queue.push([e.rel, depth + 1]);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

const peeked = new Map();   // path → { key, sheets } so a rescan reads only what changed
const MAX_PEEK = 40 * 1024 * 1024;
/** Sheet names and header rows of the workbooks and delimited files, read once per version of the file. */
export async function peekTables(folder, entries) {
  for (const e of entries) {
    if (e.dir || !/\.(xlsx|csv|tsv)$/i.test(e.path) || /^~\$/.test(baseName(e.path)) || e.size > MAX_PEEK) continue;
    const key = `${e.size}:${e.mtime}`;
    const hit = peeked.get(e.path);
    if (hit?.key === key) { e.sheets = hit.sheets; continue; }
    try {
      const bytes = await folder.read(e.path);
      let sheets;
      if (/\.xlsx$/i.test(e.path)) sheets = (await readXlsx(bytes)).sheets.map(s => ({ name: s.name, header: headerRow(s.rows).cells, rows: s.rows.length }));
      else {
        const text = dec.decode(bytes.slice(0, 256 * 1024));
        let rows = [];
        try { rows = parseDelimited(text, /\.tsv$/i.test(e.path) ? '\t' : text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',').rows; }
        catch { rows = parseDelimited(text.slice(0, text.lastIndexOf('\n') + 1) || text).rows; }   // a cut-off quoted cell at the end of the peek
        sheets = [{ name: baseName(e.path), header: headerRow(rows).cells, rows: rows.length }];
      }
      e.sheets = sheets;
      peeked.set(e.path, { key, sheets });
    } catch (err) { e.error = String(err?.message || err).slice(0, 120); }
  }
  return entries;
}

const counted = new Map();   // path → { key, records }
const RECORD_MARK = { ris: /^ER\s+-/gm, nbib: /^PMID-/gm, txt: /^PMID-/gm, bib: /^@\w+\s*\{/gm, bibtex: /^@\w+\s*\{/gm, enw: /^%0 /gm };
/** How many records each search export holds, counted by its record markers, once per version of the file. */
export async function countRecords(folder, entries) {
  for (const e of entries) {
    const ext = String(e.path).split('.').pop().toLowerCase();
    if (e.dir || !RECORD_MARK[ext] || e.size > MAX_PEEK) continue;
    if (ext === 'txt' && !/records/i.test(e.path)) continue;
    const key = `${e.size}:${e.mtime}`, hit = counted.get(e.path);
    if (hit?.key === key) { e.records = hit.records; continue; }
    try { e.records = (dec.decode(await folder.read(e.path)).match(RECORD_MARK[ext]) || []).length; counted.set(e.path, { key, records: e.records }); } catch {}
  }
  return entries;
}

/** What Lykos has written into the folder (.lykos/outputs.json): by folder and name, with version and time. */
export const outputsLog = async folder => await readJson(folder, OUTPUTS_FILE) || {};

/** The folder, classified: `folderIndex` over a fresh scan, workbooks peeked, exports counted. */
export async function indexFolder(folder, typeId = 'other') {
  const entries = await countRecords(folder, await peekTables(folder, await scanFolder(folder)));
  const index = folderIndex(entries, { typeId });
  const layout = await projectLayout(folder, typeId);
  const byPath = new Map(entries.map(e => [e.path, e]));
  for (const f of index.files) { const e = byPath.get(f.path); if (e?.records != null) f.records = e.records; const sh = e?.sheets?.find(x => x.name === f.sheet); if (sh?.rows != null) f.rows = Math.max(0, sh.rows - 1); if (sh?.header) f.columns = sh.header.filter(Boolean).length; }
  // What Lykos wrote is its own output, not something to import back.
  const outputs = await outputsLog(folder);
  const written = new Set(Object.values(outputs).flatMap(o => o.paths || []));
  for (const f of index.files) if (written.has(f.path)) Object.assign(f, { role: 'lykos-output', target: null, label: 'Written by Lykos', why: 'listed in .lykos/outputs.json' });
  for (const k of Object.keys(index.byTarget)) index.byTarget[k] = index.byTarget[k].filter(f => f.target);
  return { ...index, layout, entries, outputs };
}

/** The rows of one sheet of a workbook or delimited file in the folder. */
export async function tableRows(folder, path, sheet = '') {
  const bytes = await folder.read(path);
  if (/\.xlsx$/i.test(path)) {
    const wb = await readXlsx(bytes);
    const s = wb.sheets.find(x => x.name === sheet) || wb.sheets[0];
    return { sheet: s?.name || '', rows: s?.rows || [], workbook: wb };
  }
  const text = dec.decode(bytes);
  return { sheet: baseName(path), rows: parseDelimited(text, /\.tsv$/i.test(path) ? '\t' : ',').rows, workbook: null };
}

// ---- organising ------------------------------------------------------------------
/**
 * The plan for bringing the folder to the standard layout, with the moves this
 * folder cannot make marked: a browser without folder move keeps its folders.
 */
export async function planOrganise(folder, typeId) {
  const entries = await scanFolder(folder);
  const plan = organisePlan(entries, { typeId });
  const canDir = folder.can?.renameDir !== false && folder.can?.rename !== false;
  const canFile = folder.can?.rename !== false;
  for (const m of plan.moves) m.blocked = m.dir ? !canDir : !canFile;
  const guideExists = (await folder.stat(GUIDE)).exists;
  plan.guideAppend = guideExists && !dec.decode(await folder.read(GUIDE)).includes(GUIDE_BEGIN);
  return plan;
}

/**
 * Applies a plan the person confirmed: folders created, moves made in order,
 * each recorded as it succeeds in .lykos/organise/<time>.json so a failure
 * part-way leaves a log of exactly what moved. Returns the log's path, what
 * moved and what failed. `onMoved(from, to)` lets the caller follow records
 * whose files moved.
 */
export async function applyOrganise(folder, plan, { onMoved = () => {}, guide = null } = {}) {
  const logPath = `${STATE_DIR}/organise/${stamp()}.json`;
  const log = { at: new Date().toISOString(), moves: [], creates: [], failed: [] };
  const save = () => folder.writeText(logPath, JSON.stringify(log, null, 2));
  await save();
  for (const dir of plan.creates || []) {
    try { await ensureDir(folder, dir); log.creates.push(dir); } catch (err) { log.failed.push({ create: dir, error: String(err?.message || err) }); }
  }
  for (const m of plan.moves || []) {
    if (m.blocked) { log.failed.push({ ...m, error: 'not possible here' }); continue; }
    try {
      if ((await folder.stat(m.to)).exists) throw new Error('destination exists');
      await ensureDir(folder, parentOf(m.to));
      await folder.rename(m.from, m.to);
      log.moves.push({ from: m.from, to: m.to, dir: !!m.dir });
      onMoved(m.from, m.to);
      await save();
    } catch (err) { log.failed.push({ ...m, error: String(err?.message || err).slice(0, 160) }); }
  }
  if (guide) { try { log.guide = await writeGuide(folder, { ...guide, append: true }); } catch (err) { log.failed.push({ guide: true, error: String(err?.message || err) }); } }
  await save();
  return { log: logPath, moved: log.moves.length, failed: log.failed };
}

/** Organisations applied in this folder, newest first. */
export async function organiseLogs(folder) {
  const dir = `${STATE_DIR}/organise`;
  if (!(await folder.stat(dir)).exists) return [];
  const rows = (await folder.list(dir)).filter(e => !e.dir && e.name.endsWith('.json')).sort((a, b) => b.name.localeCompare(a.name));
  const out = [];
  for (const e of rows) { const log = await readJson(folder, e.rel); if (log) out.push({ path: e.rel, ...log }); }
  return out;
}

/** Puts back what one organisation moved, last move first; a move that cannot be reversed is reported. */
export async function undoOrganise(folder, logPath, { onMoved = () => {} } = {}) {
  const log = await readJson(folder, logPath);
  if (!log) throw new Error('That organisation log could not be read');
  if (log.undoneAt) throw new Error('Already undone');
  const failed = [];
  let n = 0;
  for (const m of undoMoves(log.moves || [])) {
    try {
      if ((await folder.stat(m.to)).exists) throw new Error('destination exists');
      await ensureDir(folder, parentOf(m.to));
      await folder.rename(m.from, m.to); n++; onMoved(m.from, m.to);
    } catch (err) { failed.push({ ...m, error: String(err?.message || err).slice(0, 160) }); }
  }
  log.undoneAt = new Date().toISOString(); log.undoFailed = failed;
  await folder.writeText(logPath, JSON.stringify(log, null, 2));
  return { restored: n, failed };
}


// ---- writing outputs ---------------------------------------------------------------
const bytesOf = async data => data instanceof Uint8Array ? data
  : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : enc.encode(String(data ?? ''));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// Workbooks and Word files are zips that carry the time they were written, so
// two writes of the same content differ in bytes; their parts are compared.
export async function sameContent(a, b, ext) {
  if (same(a, b)) return true;
  if (!/^(xlsx|docx|pptx|zip)$/.test(ext)) return false;
  try {
    const [ea, eb] = [zipEntries(a), zipEntries(b)];
    if (ea.length !== eb.length) return false;
    for (let i = 0; i < ea.length; i++) {
      if (ea[i].name !== eb[i].name) return false;
      if (!same(await unzipRead(a, ea[i]), await unzipRead(b, eb[i]))) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * Writes outputs by the version rule. `outputs` are `{ key, stem, ext, data,
 * label? }`; outputs of one stem in one folder are a set with one version. A
 * set identical to the current version is left as it is; otherwise the current
 * files move to Archive/<folder>/vN/ and the new ones are written as v(N+1).
 * The written paths are recorded for AGENTS.md's list of current files.
 */
export async function writeOutputs(folder, outputs, { typeId = 'other' } = {}) {
  const layout = await projectLayout(folder, typeId);
  const sets = new Map();
  for (const o of outputs) {
    const dir = layout.dirFor(o.key);
    const k = `${dir}\u0000${o.stem}`;
    if (!sets.has(k)) sets.set(k, { dir, stem: o.stem, label: o.label || o.stem, kind: o.kind || '', files: [] });
    const set = sets.get(k);
    if (!set.files.some(f => f.ext === o.ext)) set.files.push({ ext: o.ext, data: o.data });
  }
  const log = await readJson(folder, OUTPUTS_FILE) || {};
  const result = { written: [], unchanged: [], archived: [], failed: [] };
  for (const set of sets.values()) {
    try {
      await ensureDir(folder, set.dir);
      const names = (await folder.list(set.dir)).filter(e => !e.dir).map(e => e.name);
      const next = nextVersion(names, set.stem, { archive: layout.archive || ARCHIVE, dir: set.dir });
      const bytes = await Promise.all(set.files.map(f => bytesOf(f.data)));
      // Unchanged: every file of the set exists at the current version with the same bytes.
      if (next.previous && log[`${set.dir}/${set.stem}`]) log[`${set.dir}/${set.stem}`].checkedAt = new Date().toISOString();
      if (next.previous) {
        let unchanged = next.moves.length === set.files.length;
        for (let i = 0; unchanged && i < set.files.length; i++) {
          const rel = join(set.dir, `${set.stem} v${next.previous}.${set.files[i].ext}`);
          const st = await folder.stat(rel);
          unchanged = st.exists && await sameContent(await folder.read(rel), bytes[i], set.files[i].ext);
        }
        if (unchanged) { result.unchanged.push(set.stem); continue; }
      }
      for (const m of next.moves) {
        await ensureDir(folder, parentOf(m.to));
        if ((await folder.stat(m.to)).exists) throw new Error(`${m.to} exists; the earlier version was not replaced`);
        await folder.rename(m.from, m.to);
        result.archived.push(m.to);
      }
      const paths = [];
      for (let i = 0; i < set.files.length; i++) {
        const rel = join(set.dir, next.name(set.files[i].ext));
        await folder.writeBytes(rel, bytes[i]);
        paths.push(rel);
      }
      result.written.push(...paths);
      log[`${set.dir}/${set.stem}`] = { label: set.label, kind: set.kind, paths, version: next.version, at: new Date().toISOString() };
    } catch (err) { result.failed.push({ stem: set.stem, error: String(err?.message || err).slice(0, 160) }); }
  }
  await folder.writeText(OUTPUTS_FILE, JSON.stringify(log, null, 2));
  return result;
}


/** An SVG rasterised to PNG bytes for a figure used outside the app: the one rasteriser (figure-draw.mjs), a house export at 600 dpi on its column, any other figure at three times its size; pHYs written. */
export const svgToPng = svg => rasterPng(svg);


// Adoption on screen (plan §4.15d): what a person sees of the files a project was built from, and what they can do about it.
//
// lib/drift.mjs compares and lib/adopt.mjs touches the folder; this joins them to the app's state for the screens:
//
//   driftReport(folder, state)               the adoption record against the files and the app now, per file;
//   summaryOf(report, path)                  one file's relation to the project, as small facts (lib/file-relations.mjs reads them);
//   differencesOf(report, path)              the cells where the file or the app moved, with both texts in full;
//   planAdoption(folder, path, state)        a dry run of "Adopt this file": what is read, what becomes tracked, what would change. Writes nothing;
//   applyAdoption(folder, path, decisions)   the confirmed adoption: the cells a person took from the file or kept, the baseline recorded;
//   planWrite(folder, path)                  the write back plan (lib/adopt.mjs), limited to one file when asked;
//   applyWrite(folder, plan, keys)           the confirmed write back, for the cells still ticked;
//   locateInFolder(folder, file)             where a file a person picked lives in the project folder, or null;
//   recordImport(folder, entry)              records what an import adopted, keeping the cells an earlier import of the same bytes recorded.
//
// Nothing here runs by itself. The only functions that change anything are applyAdoption (the app's values the person took, and
// the record) and applyWrite (cells of an .xlsx, through lib/adopt.mjs applyWriteBack, after a hash check); both are called from a
// dialog's confirm. A plan is made from the file as it is and carries the stamp it was made from, so a file that moved while a
// dialog was open is refused, not overwritten.
import { get, update } from '../store.mjs';
import { readSidecar, recordAdoption } from './figure-sidecar.mjs';
import { observeFiles, planWriteBack, applyWriteBack, fileFacts, nextVersionPath } from './adopt.mjs';
import * as D from './drift.mjs';
import { readXlsx } from './xlsx-read.mjs';
import { parseDelimited } from './spreadsheet.mjs';
import { documentHash } from './files.mjs';
import { ipdListFromRows, ipdPatchFromText } from './ipd-import.mjs';
import { classifyFile } from './folder-map.mjs';
import { propose, accept } from './proposals.mjs';
import { isLocked, moveEvidencePaths } from './fields.mjs';

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const extOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const SHEET_TYPES = new Set(['xlsx', 'xlsm', 'csv', 'tsv']);
const ARCHIVE_DIR = /^(archive|old versions?|previous versions?|superseded)$/i;

/** What each role is called in a sentence ("Adopted as the evidence table"). */
export const ROLE_NAMES = Object.freeze({ evidence: 'the evidence table', ipd: 'the master list', screening: 'the screening sheet', manuscript: 'the manuscript', other: '' });

// ---- where a picked file lives --------------------------------------------------------------------------------------
/**
 * The path in the project folder of a file a person picked with the system chooser (which gives a name, not a path): a file of the
 * same name and size whose bytes have the same hash. The shallowest copy that is not in an archive folder wins; two such copies
 * are no answer. Bounded: `limit` entries, `depth` levels. Null when the file is not in the folder.
 */
export async function locateInFolder(folder, file, { limit = 4000, depth = 8 } = {}) {
  if (!folder?.list || !file?.name) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await documentHash(bytes);
  const queue = [['', 0]], found = [];
  let seen = 0;
  while (queue.length && seen < limit) {
    const [dir, level] = queue.shift();
    let rows = [];
    try { rows = await folder.list(dir); } catch { continue; }
    for (const e of rows) {
      seen++;
      if (e.dir) { if (level < depth && !e.name.startsWith('.') && e.name !== 'node_modules') queue.push([e.rel, level + 1]); continue; }
      if (e.name !== file.name || (e.size != null && e.size !== bytes.length)) continue;
      try { if (await documentHash(await folder.read(e.rel)) === hash) found.push({ path: e.rel, level, archived: e.rel.split('/').slice(0, -1).some(s => ARCHIVE_DIR.test(s)) }); } catch { /* unreadable: not this one */ }
    }
  }
  const live = found.filter(f => !f.archived);
  const pool = live.length ? live : found;
  if (!pool.length) return null;
  const best = Math.min(...pool.map(f => f.level));
  const top = pool.filter(f => f.level === best);
  return top.length === 1 ? top[0].path : null;
}

/** The sentence an import ends with when its file could not be tracked. */
export const untrackedNote = folder => folder
  ? 'The file is outside the project folder, so changes to it cannot be tracked'
  : 'This project has no folder, so changes to the file cannot be tracked';

/**
 * Records what an import adopted (an entry of lib/drift.mjs) with the file's bytes as they are now. An earlier record of the same
 * bytes keeps the cells this entry does not name (a second import from one workbook adds cells, it does not forget the first).
 * Never throws: a record that cannot be written is reported, the import stands. Answers what recordAdoption answers.
 */
export async function recordImport(folder, entry, over = {}) {
  try {
    if (!folder || !entry?.path) return { ok: false, reason: 'no-folder' };
    const facts = await fileFacts(folder, entry.path);
    if (!facts) return { ok: false, reason: 'unreadable' };
    const side = await readSidecar('adopted', { folder, ...over });
    if (side.readOnly) return { ok: false, readOnly: true, notice: side.notice };
    let next = D.withFile(entry, facts);
    const old = side.doc.files?.[entry.path];
    if (old?.hash && old.hash === facts.hash) {
      const have = new Set(next.cells.map(c => c.k));
      next = D.fileEntry({ ...next, cells: [...next.cells, ...old.cells.filter(c => !have.has(c.k))], file: next });
    }
    return await recordAdoption([next], { folder, ...over });
  } catch (err) { return { ok: false, reason: String(err?.message || err).slice(0, 120) }; }
}

// ---- the report -------------------------------------------------------------------------------------------------------
/** The path a drift finding is about: the first file it cites. */
export function findingPath(f) {
  return (f?.evidence || []).find(e => (e.kind === 'file' || e.kind === 'import') && e.path)?.path || '';
}

/**
 * The adoption record against the folder and the app as they are now. `byPath` has one entry for each adopted file and each file
 * the app cites without a record: `{ path, entry, row, cells, unadopted, findings }`. Reads the files that moved (not the others);
 * writes nothing.
 */
export async function driftReport(folder, state = get(), over = {}) {
  const side = await readSidecar('adopted', { folder, ...over });
  const doc = side.doc;
  const observed = folder ? await observeFiles(folder, doc) : {};
  const app = D.appValues(state, doc);
  const present = new Set();
  for (const p of Object.keys(app.cited)) { try { if ((await folder?.stat(p))?.exists) present.add(p); } catch { /* not there */ } }
  const facts = D.observe(doc, observed, app, { exists: p => present.has(p) });
  const findings = D.findingsOf(facts);
  const byPath = new Map();
  const slot = path => { if (!byPath.has(path)) byPath.set(path, { path, entry: doc.files?.[path] || null, row: null, cells: [], unadopted: null, findings: [] }); return byPath.get(path); };
  for (const e of Object.values(doc.files || {})) slot(e.path);
  for (const r of facts.files) slot(r.path).row = r;
  for (const c of facts.cells) slot(c.file).cells.push(c);
  for (const u of facts.unadopted) slot(u.path).unadopted = u;
  for (const f of findings) { const p = findingPath(f); if (p) slot(p).findings.push(f); }
  return { doc, readOnly: side.readOnly, notice: side.notice, hash: side.hash, folder, observed, app, facts, findings, byPath, state, tracked: Object.keys(doc.files || {}).length };
}

/** One file's relation to the project, as facts: whether it is adopted and as what, whether it moved, how many cells differ, where the app is ahead. */
export function summaryOf(report, path) {
  const s = report?.byPath?.get(path);
  if (!s) return null;
  const e = s.entry, row = s.row;
  const fileCells = s.cells.filter(c => c.fileChanged), ahead = s.cells.filter(c => !c.fileChanged && c.appChanged);
  return {
    path, adopted: !!e, role: e?.role || s.unadopted?.role || '', at: e?.at || '', cells: e?.cells.length || 0,
    state: row?.state || (s.unadopted ? 'unadopted' : 'same'), cellsUnread: !!row?.cellsUnread,
    differ: fileCells.length, ahead: ahead.length, unadopted: s.unadopted ? { n: s.unadopted.n, exists: s.unadopted.exists } : null,
    findings: s.findings.map(f => f.rule),
  };
}

/** The cells of one file that differ, in full: the cell, its name, the three texts (adopted, in the file now, in the app now) and who moved. */
export function differencesOf(report, path) {
  const o = report.observed?.[path];
  return (report.byPath.get(path)?.cells || []).map(c => {
    const file = c.sheetGone ? null : (o?.cells ? D.norm(o.cells[`${String(c.c).toUpperCase()}@${c.s}`]) : null);
    return { k: c.k, name: c.n || `${c.s} ${c.c}`, sheet: c.s, cell: c.c, ref: `${c.s} ${c.c}`, adopted: c.f0, fileText: file == null ? null : file, appText: report.app.values[c.k] ?? '',
      status: c.fileChanged && c.appChanged ? 'both' : c.fileChanged ? 'file' : 'app', sheetGone: !!c.sheetGone, verbatim: !!c.verbatim, fileChanged: !!c.fileChanged, appChanged: !!c.appChanged };
  });
}

// ---- reading a file's cells ---------------------------------------------------------------------------------------------
async function workbookOf(folder, path, bytes) {
  const ext = extOf(path);
  if (ext === 'xlsx' || ext === 'xlsm') return readXlsx(bytes);
  if (ext === 'csv' || ext === 'tsv') return { sheets: [{ name: baseOf(path).replace(/\.\w+$/, ''), rows: parseDelimited(new TextDecoder().decode(bytes), ext === 'tsv' ? '\t' : ',').rows }] };
  return null;
}

const labelOfValue = (state, key, v) => {
  const paper = (state.papers || []).find(p => p.id === v.paper_id);
  const col = (state.templates || []).flatMap(t => t.columns || []).find(c => c.id === v.field_id);
  const arm = v.arm ? ` (arm ${v.arm})` : '';
  return `${paper?.label || 'Study'}: ${col?.label || col?.name || String(v.field_id || key).split('.').pop()}${arm}`;
};

/** The role a file would be adopted as: the one its cells say, else what the folder's own classification of the name gives. */
function roleGuess(path, state, report) {
  const e = report?.doc?.files?.[path];
  if (e) return e.role;
  const cited = report?.app?.cited?.[path];
  if (cited) return cited.role;
  const found = String(classifyFile(path, {}).role || '');
  if (/evidence/.test(found)) return 'evidence';
  if (/ipd|patients/.test(found)) return 'ipd';
  if (/screening/.test(found)) return 'screening';
  if (/manuscript/.test(found)) return 'manuscript';
  return 'other';
}

/**
 * The baseline a file with no record would get: the cells the app's values and patients cite in it, read from the file as it is now.
 * A cell is recorded as an import of the file's present text would have left it, so where the app holds something else the app is
 * "ahead" (shown as edited in the app, to keep or write back) and no difference is hidden.
 */
async function newEntry(folder, path, state, report, facts, bytes, at) {
  const wb = await workbookOf(folder, path, bytes).catch(() => null);
  const role = roleGuess(path, state, report);
  const values = {};
  for (const [k, v] of Object.entries(isObj(state.values) ? state.values : {})) {
    const ev = (v?.evidence || [])[0];
    if (ev?.kind === 'file' && ev.path === path && ev.locator?.cell) values[k] = v;
  }
  let entry = D.fileEntry({ path, role, at, file: facts });
  const notes = [];
  if (wb && Object.keys(values).length) {
    const adopted = D.evidenceAdoption({ path, workbook: wb, values, file: facts, at, role: 'evidence', labelOf: (k, v) => labelOfValue(state, k, v) });
    entry = { ...adopted, cells: adopted.cells.map(c => ({ ...c, h: c.f })) };
    if (role === 'other') entry.role = 'evidence';
  }
  const parts = (state.participants || []).filter(p => p?.src?.file === path);
  if (wb && parts.length) {
    const sheetName = parts[0].src.sheet || wb.sheets[0]?.name;
    const sheet = wb.sheets.find(s => s.name === sheetName) || wb.sheets[0];
    const plan = sheet ? ipdListFromRows(sheet.rows, { file: path, sheet: sheet.name }) : { ok: false };
    if (plan.ok) {
      const byRow = new Map(parts.map(p => [p.src.row, p]));
      const aligned = plan.patients.map(p => byRow.get(p.row));
      const ipd = D.ipdAdoption({ path, sheet: sheet.name, patients: plan.patients, participants: aligned, file: facts, at });
      const byId = new Map(parts.map(p => [p.id, p]));
      const cells = ipd.cells.map(c => {
        const m = /^p:(.+):([a-z_]+)$/.exec(c.k), part = m && byId.get(m[1]);
        const patch = part ? ipdPatchFromText(m[2], c.f, part) : {};
        return { ...c, h: D.norm(patch[m?.[2]] ?? c.f) };
      });
      entry = { ...(Object.keys(values).length ? entry : ipd), cells: [...(Object.keys(values).length ? entry.cells : []), ...cells], role: Object.keys(values).length ? entry.role : 'ipd' };
      const miss = parts.length - aligned.filter(Boolean).length;
      if (miss > 0) notes.push(`${miss} patients entered from this list are not on its rows now`);
    } else notes.push(`The list could not be read as a master list (${plan.reason || 'unknown layout'}); it is tracked by its content`);
  } else if (parts.length) notes.push('The workbook could not be read; it is tracked by its content');
  return { entry: D.fileEntry({ ...entry, file: facts }), notes };
}

// ---- the dry run ----------------------------------------------------------------------------------------------------------
/**
 * What "Adopt this file" would do, from the file as it is now. Answers
 * `{ ok, path, name, kind, role, file, cells, diffs, take, keep, decide, differ, notes, token, entry }` (`diffs` are all the differing cells):
 *   kind 'new'   the file has no record; `entry` is the baseline an import of its present text would leave; `differ` are the cells where the app holds something else;
 *   kind 'moved' the file changed since adoption; `take` are the cells only the file changed (the default is to take them), `keep` the cells only the app
 *                changed (left as they are, with write back still available), `decide` the cells both changed and disagree (a person chooses; until then
 *                the file stays "changed");
 *   kind 'same'  nothing moved; there is nothing to adopt.
 * `token` is the file's hash then; applyAdoption refuses a file that is not that any more. Reads; writes nothing.
 */
export async function planAdoption(folder, path, state = get(), over = {}) {
  const report = await driftReport(folder, state, over);
  if (report.readOnly) return { ok: false, reason: report.notice || 'The adoption record cannot be written over' };
  const st = await folder.stat(path).catch(() => null);
  if (!st?.exists || st.dir) return { ok: false, reason: 'The file is not in the folder' };
  let bytes;
  try { bytes = await folder.read(path); } catch { return { ok: false, reason: 'The file could not be read' }; }
  const file = { hash: await documentHash(bytes), size: st.size, mtime: st.mtime };
  const at = new Date().toISOString();
  const slot = report.byPath.get(path);
  const base = { ok: true, path, name: baseOf(path), ext: extOf(path), file, token: file.hash, notes: [] };
  if (!slot?.entry) {
    const made = await newEntry(folder, path, state, report, file, bytes, at);
    const held = D.appValues(state, { files: { [path]: made.entry } }).values;
    const differ = made.entry.cells.filter(c => held[c.k] !== undefined && held[c.k] !== c.h);
    return { ...base, kind: 'new', role: made.entry.role, cells: made.entry.cells.length, diffs: [], take: [], keep: [], decide: [], differ: differ.length, entry: made.entry, notes: made.notes };
  }
  const e = slot.entry, row = slot.row;
  if (row?.state === 'missing') return { ok: false, reason: 'The file is not in the folder' };
  if (row?.state === 'unread' || row?.cellsUnread) return { ok: false, reason: 'The cells of the file could not be read, so nothing can be compared' };
  const diffs = differencesOf(report, path);
  const take = diffs.filter(d => d.status === 'file'), keep = diffs.filter(d => d.status === 'app'), decide = diffs.filter(d => d.status === 'both');
  const moved = row?.state === 'changed';
  return { ...base, kind: moved || diffs.length ? 'moved' : 'same', role: e.role, cells: e.cells.length, diffs, take, keep, decide, differ: 0, entry: e };
}

// ---- applying a decision to the app -----------------------------------------------------------------------------------------
/** Puts the file's text where the app holds the value for `k` (`v:` an accepted value, `p:` a patient's field). Answers `{ ok }` or `{ ok: false, reason }`; never throws. */
export function takeIntoApp(k, text) {
  try {
    if (k.startsWith('v:')) {
      const key = k.slice(2), v = get().values?.[key];
      if (!v) return { ok: false, reason: 'The app no longer holds this value' };
      if (isLocked(get(), key)) return { ok: false, reason: 'The value is locked; change it by amendment' };
      const fieldId = key.slice(String(v.paper_id).length + 1);
      propose(v.paper_id, { column_id: fieldId, value: text, normalized_value: text, availability: /^NR$/i.test(text) ? 'not_found' : 'present', evidence: v.evidence || [], rationale: '', origin: 'imported', mode: 'verify', verify: null, model: null, run_id: null });
      try { accept(v.paper_id, fieldId); }
      catch (err) { update(s => { delete s.proposals?.[`${v.paper_id}:${fieldId}`]; return s; }); return { ok: false, reason: String(err.message || err).slice(0, 120) }; }
      return get().values?.[key]?.reported_value === text ? { ok: true } : { ok: false, reason: 'The value could not be changed' };
    }
    if (k.startsWith('p:')) {
      const rest = k.slice(2), at = rest.lastIndexOf(':'), id = rest.slice(0, at), field = rest.slice(at + 1);
      const p = (get().participants || []).find(x => x.id === id);
      if (!p) return { ok: false, reason: 'The patient is no longer in the app' };
      const patch = ipdPatchFromText(field, text, p);
      if (!Object.keys(patch).length) return { ok: false, reason: 'This field is not read from the file' };
      update(s => { s.participants = (s.participants || []).map(x => x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x); return s; });
      return { ok: true };
    }
  } catch (err) { return { ok: false, reason: String(err?.message || err).slice(0, 120) }; }
  return { ok: false, reason: 'Unknown value' };
}

/**
 * The record after a person's decisions on the differing cells of a file. `decisions` is `{ [cell key]: 'take' | 'keep' }`; `heldNow(k)`
 * is what the app holds for a key after the takes. A taken cell is the file's text and what the app now holds; a kept cell is the file's
 * text as it is and what the app holds (a kept cell whose sheet is gone is no longer tracked). A cell not decided is left as it was. The file's
 * own hash, size and time become the adopted ones only when no cell is left that the file changed; otherwise the file stays "changed".
 */
export function resolveEntry(entry, diffs, decisions, { heldNow, file }) {
  const by = new Map(diffs.map(d => [d.k, d]));
  const cells = [];
  for (const c of entry.cells) {
    const d = by.get(c.k), choice = d && decisions?.[c.k];
    if (!choice) { cells.push(c); continue; }
    if (choice === 'keep' && d.sheetGone) continue;
    const f = d.fileChanged ? (d.fileText ?? c.f) : c.f;
    cells.push({ ...c, f: D.norm(f), h: D.norm(heldNow(c.k)) });
  }
  const left = diffs.filter(d => d.fileChanged && !decisions?.[d.k]);
  return D.fileEntry({ ...entry, cells, file: left.length ? entry : { ...entry, ...file } });
}

/**
 * Applies what a person confirmed for one file. `decisions` is `{ [cell key]: 'take' | 'keep' }`; a file with no record is adopted as planned. `expect` is the
 * plan's `token`: a file whose hash is not that is refused. Answers `{ ok, took, kept, skipped: [{ k, reason }], left, recorded }` or `{ ok: false, reason }`.
 */
export async function applyAdoption(folder, path, decisions = {}, { expect = null, state, over = {} } = {}) {
  const now = state || get();
  const report = await driftReport(folder, now, over);
  if (report.readOnly) return { ok: false, reason: report.notice || 'The adoption record cannot be written over' };
  const file = await fileFacts(folder, path);
  if (!file) return { ok: false, reason: 'The file is not in the folder' };
  if (expect && file.hash !== expect) return { ok: false, reason: 'The file changed while this was open. Review it again' };
  const slot = report.byPath.get(path);
  if (!slot?.entry) {
    const made = await newEntry(folder, path, now, report, file, await folder.read(path), new Date().toISOString());
    const recorded = await recordAdoption([made.entry], { folder, ...over });
    return recorded.ok ? { ok: true, took: 0, kept: 0, skipped: [], left: 0, recorded } : { ok: false, reason: recorded.notice || 'The record could not be written' };
  }
  if (slot.row?.cellsUnread || slot.row?.state === 'unread') return { ok: false, reason: 'The cells of the file could not be read, so nothing can be compared' };
  const diffs = differencesOf(report, path);
  const chosen = { ...decisions };
  const skipped = [];
  let took = 0, kept = 0;
  for (const d of diffs) {
    const choice = chosen[d.k];
    if (choice === 'take') {
      if (d.fileText == null) { skipped.push({ k: d.k, reason: 'The sheet is not in the file any more' }); delete chosen[d.k]; continue; }
      const r = takeIntoApp(d.k, d.fileText);
      if (!r.ok) { skipped.push({ k: d.k, reason: r.reason }); delete chosen[d.k]; continue; }
      took++;
    } else if (choice === 'keep') kept++;
  }
  const after = D.appValues(get(), report.doc);
  const entry = resolveEntry(slot.entry, diffs, chosen, { heldNow: k => after.values[k] ?? '', file });
  const recorded = await recordAdoption([entry], { folder, ...over });
  if (!recorded.ok) return { ok: false, reason: recorded.notice || 'The record could not be written', took, kept, skipped };
  return { ok: true, took, kept, skipped, left: diffs.filter(d => d.fileChanged && !chosen[d.k]).length, recorded };
}

// ---- write back ---------------------------------------------------------------------------------------------------------------
/** The write back plan for the project, or for one file: the cells the app is ahead in, where the file has not moved. Reads; writes nothing. */
export async function planWrite(folder, path = null, state = get(), over = {}) {
  const plan = await planWriteBack(folder, state, over);
  if (!path) return plan;
  const files = plan.files.filter(f => f.path === path);
  return { files, changes: files.flatMap(f => f.changes.map(c => ({ path: f.path, ...c }))), skipped: plan.skipped.filter(s => s.path === path) };
}

/** Where a write back would put a file's next version and its previous one: `{ next, archive, from, to }` (lib/adopt.mjs nextVersionPath). */
export const versionOf = nextVersionPath;

/**
 * Writes the cells of `plan` whose keys are in `keys` (all, when null), after lib/adopt.mjs has checked each file against the hash the plan was made from.
 * The edited workbook is saved as the next version of the file and the previous one moves to Archive/<folder>/vN/; what in the app named the old path
 * (the values' evidence, the patients' source, the import log) follows to the new one. Answers `{ written: [{ path, from, archived, cells }], skipped, recorded }`.
 */
export async function applyWrite(folder, plan, keys = null, over = {}) {
  const want = keys ? new Set(keys) : null;
  const files = plan.files.map(f => ({ ...f, changes: f.changes.filter(c => !want || want.has(c.k)) })).filter(f => f.changes.length);
  const out = await applyWriteBack(folder, { ...plan, files, changes: files.flatMap(f => f.changes.map(c => ({ path: f.path, ...c }))) }, over, { version: true });
  const moves = Object.fromEntries(out.written.filter(w => w.from).map(w => [w.from, w.path]));
  if (Object.keys(moves).length) {
    moveEvidencePaths(moves);
    update(s => {
      s.participants = (s.participants || []).map(p => p?.src?.file && moves[p.src.file] ? { ...p, src: { ...p.src, file: moves[p.src.file] } } : p);
      const applied = s.folderMap?.applied;
      if (applied) for (const [from, to] of Object.entries(moves)) if (applied[from]) { applied[to] = applied[from]; delete applied[from]; }
      return s;
    });
  }
  return out;
}

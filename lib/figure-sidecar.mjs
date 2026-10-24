// Reading and writing the sidecars, `.lykos/figure-registry.json`, `.lykos/figure-style.json`
// (plan §4.15c.1) and `.lykos/adopted.json`, the record of what the project's files held when
// they were adopted (plan §4.15d, lib/drift.mjs). They hold decisions, so:
//
//   * They are written only by an explicit user action (a caller of
//     writeSidecar in a later package). Nothing here polls, and reading never
//     writes: a detector may call readSidecar as often as it likes.
//   * A write goes through commitSidecar (projects.mjs): one commit lock, a
//     hash check against the file as it was read, and when another window got
//     there first the two copies are merged and committed again.
//   * A file that cannot be understood (damaged, a newer schema, another
//     project's registry) opens read-only with a notice and is never written
//     over.
//   * A folder that cannot be written moves the document to the app's storage
//     (putFile, scoped to the project), and the notice says so.
//   * A project that is not a folder keeps both documents in the app's
//     storage, and reports that folder checks need a project folder.
//
// A read always answers; a problem is a field of the answer, never a throw.
import { get, recoveryOwner } from '../store.mjs';
import { commitSidecar, activeFolder, DIR } from './projects.mjs';
import { putFile, getFile, deleteFile, documentHash } from './files.mjs';
import { SIDECAR_NAMES } from './backup.mjs';
import { validateStyle, SCHEMA as STYLE_SCHEMA } from './figure-style.mjs';
import { openAdopted, emptyAdopted, adoptedText, mergeAdopted, addAdoption } from './drift.mjs';
import { open as openRegistry, merge as mergeRegistry, mergeKeyed, emptyRegistry, registryText, normalise, touch } from './figure-registry.mjs';

/** The two sidecars: the kind a caller names, the file name in `.lykos`, and the text of the notices. */
export const SIDECARS = {
  registry: { name: 'figure-registry', file: 'figure-registry.json', label: 'Registry' },
  style: { name: 'figure-style', file: 'figure-style.json', label: 'Style' },
  adopted: { name: 'adopted', file: 'adopted.json', label: 'Adoption record' },
};
if (Object.values(SIDECARS).map(s => s.name).join() !== SIDECAR_NAMES.join()) throw new Error('backup.mjs and figure-sidecar.mjs name different sidecars');

export const NOTICE_FOLDER_CHECKS = 'Folder checks need a project folder';
export const noticeAppOnly = kind => `${SIDECARS[kind].label} kept in this app only`;
export const sidecarPath = kind => `${DIR}/${SIDECARS[kind].file}`;
/** The style document of a project that has none: Lykos's own neutral look, no profiles, nothing assigned. */
export const defaultStyle = () => ({ schema: STYLE_SCHEMA, active: 'lykos-neutral', profiles: [], assign: {}, fonts: [], history: [] });

const dec = bytes => new TextDecoder().decode(bytes);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const text = (kind, doc) => kind === 'registry' ? registryText(doc) : kind === 'adopted' ? adoptedText(doc) : `${JSON.stringify(doc, null, 2)}\n`;
const fresh = (kind, projectId) => kind === 'registry' ? emptyRegistry(projectId) : kind === 'adopted' ? emptyAdopted(projectId) : defaultStyle();

/** What this project is: its folder (null when it lives in the app), the owner its app-stored files are scoped to, and its id. Reading the id never creates one. */
function context(over = {}) {
  const has = k => Object.hasOwn(over, k);
  return {
    folder: has('folder') ? over.folder : activeFolder(),
    owner: has('owner') ? over.owner : recoveryOwner(),
    projectId: has('projectId') ? over.projectId : (get().researchLedger?.projectId || ''),
  };
}

// ---- app storage ---------------------------------------------------------------------
async function readApp(kind, owner) {
  try {
    const blob = await getFile(SIDECARS[kind].name, { owner });
    return blob ? await blob.text() : null;
  } catch { return null; }
}
const writeApp = (kind, body, owner) => putFile(SIDECARS[kind].name, new Blob([body], { type: 'application/json' }), { owner });

// ---- parsing ---------------------------------------------------------------------------
/** A stored text as `{ doc, readOnly, notice, damaged }`; a text that is not a usable document is damaged and read-only. */
function parse(kind, body, ctx) {
  const file = SIDECARS[kind].file;
  let raw;
  try { raw = JSON.parse(body); } catch { raw = undefined; }
  if (!isObj(raw)) return { doc: fresh(kind, ctx.projectId), readOnly: true, damaged: true, notice: `${DIR}/${file} could not be read as a ${kind} document (it may be incomplete or damaged); it was left as it is` };
  if (kind === 'registry') {
    const o = openRegistry(raw, { projectId: ctx.projectId });
    return { doc: o.registry, readOnly: o.readOnly, damaged: false, notice: o.notice, dropped: o.dropped.length };
  }
  if (kind === 'adopted') {
    const o = openAdopted(raw, { projectId: ctx.projectId });
    return { doc: o.adopted, readOnly: o.readOnly, damaged: false, notice: o.notice, dropped: o.dropped };
  }
  const v = validateStyle(raw);
  if (!v.ok) return { doc: defaultStyle(), readOnly: true, damaged: true, notice: `${DIR}/${file} is not a valid figure style (${v.errors[0]}); it was left as it is` };
  return { doc: v.doc, readOnly: v.readOnly, damaged: false, notice: v.notice };
}

// ---- merge -------------------------------------------------------------------------------
const mapOf = (list, key) => new Map((Array.isArray(list) ? list : []).filter(isObj).map(x => [key(x), x]));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of two style documents: profiles by id, assignments by role, fonts by face, history by entry; a profile or setting both sides changed differently is a conflict and nothing is chosen. */
function mergeStyle(mine, theirs, base) {
  const b = base || {};
  const none = () => null;
  const conflicts = [];
  const keyed = (name, list, key) => {
    const r = mergeKeyed(base && mapOf(b[list], key), mapOf(mine[list], key), mapOf(theirs[list], key), none);
    for (const k of r.conflicts) conflicts.push(`${name}:${k}`);
    return [...r.entries.values()];
  };
  const assign = mergeKeyed(base && new Map(Object.entries(b.assign || {})), new Map(Object.entries(mine.assign || {})), new Map(Object.entries(theirs.assign || {})), none);
  for (const k of assign.conflicts) conflicts.push(`assign:${k}`);
  const out = { ...theirs, ...mine };
  out.profiles = keyed('profile', 'profiles', p => p.id);
  out.fonts = keyed('font', 'fonts', f => `${f.family}|${f.weight}|${f.style || ''}`);
  out.assign = Object.fromEntries([...assign.entries].sort(([x], [y]) => x < y ? -1 : 1));
  out.history = [...mapOf([...(theirs.history || []), ...(mine.history || [])], h => `${h.at}|${h.profile}|${h.hash}`).values()].sort((x, y) => x.at < y.at ? -1 : x.at > y.at ? 1 : 0).slice(-20);
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (['profiles', 'fonts', 'assign', 'history'].includes(k)) continue;
    const x = mine[k], y = theirs[k], o = b[k];
    if (sameJson(x, y)) out[k] = x;
    else if (base && sameJson(x, o)) out[k] = y;
    else if (base && sameJson(y, o)) out[k] = x;
    else { conflicts.push(k); out[k] = y; }
  }
  return { doc: out, conflicts };
}

function mergeDocs(kind, mine, theirs, base) {
  if (kind === 'adopted') { const m = mergeAdopted(mine, theirs); return { doc: m.adopted, conflicts: m.conflicts }; }
  if (kind === 'registry') { const m = mergeRegistry(mine, theirs, base); return { doc: m.registry, conflicts: m.conflicts }; }
  return mergeStyle(mine, theirs, base);
}

// ---- read ----------------------------------------------------------------------------------
/**
 * Reads a sidecar. Answers
 * `{ kind, doc, text, hash, exists, source, readOnly, damaged, notice, notices, folder, folderChecks, appCopy }`:
 * `doc` is always usable (the default document when nothing is stored); `text` is what is stored (null when
 * nothing is); `hash` is the SHA-256 of the folder file as read, the `expectedHash` of a later write; `source`
 * is 'folder', 'app' or 'none'. `over` overrides `{ folder, owner, projectId }` for a project that is not the open one.
 * Never writes and never throws for a missing, unreadable or foreign file.
 */
export async function readSidecar(kind, over = {}, { folderOnly = false } = {}) {
  if (!SIDECARS[kind]) throw new Error(`No such sidecar: ${kind}`);
  const ctx = context(over);
  const path = sidecarPath(kind);
  const notices = [];
  const out = { kind, doc: null, text: null, hash: null, exists: false, source: 'none', readOnly: false, damaged: false, notice: '', notices, folder: !!ctx.folder, folderChecks: !!ctx.folder, appCopy: false };
  const finish = () => { out.notice = notices[0] || ''; return out; };
  if (kind === 'registry' && !ctx.folder) notices.push(NOTICE_FOLDER_CHECKS);
  let folderText = null;
  if (ctx.folder) {
    try {
      const st = await ctx.folder.stat(path);
      if (st.exists && st.dir) {
        Object.assign(out, { doc: fresh(kind, ctx.projectId), readOnly: true, damaged: true, exists: true, source: 'folder' });
        notices.unshift(`${path} is a folder, not a ${kind} document; it was left as it is`);
        return finish();
      }
      if (st.exists) { const bytes = await ctx.folder.read(path); folderText = dec(bytes); out.hash = await documentHash(bytes); }
    } catch { folderText = null; out.hash = null; }
  }
  const appText = folderOnly ? null : await readApp(kind, ctx.owner);
  const note = p => { if (p.notice) notices.unshift(p.notice); out.readOnly = p.readOnly; out.damaged = p.damaged; };
  if (folderText != null) {
    const p = parse(kind, folderText, ctx);
    Object.assign(out, { doc: p.doc, text: folderText, exists: true, source: 'folder' });
    note(p);
    if (appText != null) {
      out.appCopy = true;
      const a = parse(kind, appText, ctx);
      if (!p.readOnly && !a.readOnly && text(kind, a.doc) !== text(kind, p.doc)) {
        // A copy kept in the app while the folder could not be written: both count.
        const merged = mergeDocs(kind, a.doc, p.doc, null);
        out.doc = merged.doc; out.text = text(kind, merged.doc);
        if (merged.conflicts.length) notices.push(`The copy kept in this app and the folder file differ in ${merged.conflicts.length} ${merged.conflicts.length === 1 ? 'place' : 'places'}; the folder file was used there`);
      }
    }
  } else if (appText != null) {
    const p = parse(kind, appText, ctx);
    Object.assign(out, { doc: p.doc, text: appText, exists: true, source: 'app' });
    note(p);
    if (ctx.folder) notices.push(noticeAppOnly(kind));
    out.appCopy = true;
  } else {
    out.doc = fresh(kind, ctx.projectId);
  }
  return finish();
}

/** The stored text of both sidecars of a project, as `[{ name, text }]`, for a backup; a sidecar nothing is stored for is left out. */
export async function sidecarTexts(over = {}) {
  const out = [];
  for (const kind of Object.keys(SIDECARS)) {
    const s = await readSidecar(kind, over);
    if (s.text != null) out.push({ name: SIDECARS[kind].name, text: s.text });
  }
  return out;
}

// ---- write -----------------------------------------------------------------------------------
const checked = (kind, doc, ctx) => {
  if (!isObj(doc)) return { errors: [`The ${kind} must be a JSON object`] };
  if (kind === 'registry') { const r = normalise(doc); if (!r.projectId) r.projectId = ctx.projectId; return { doc: r, errors: [] }; }
  if (kind === 'adopted') {
    const o = openAdopted(doc, { projectId: ctx.projectId });
    if (o.readOnly) return { errors: [o.notice] };
    if (!o.adopted.projectId) o.adopted.projectId = ctx.projectId;
    return { doc: o.adopted, errors: [] };
  }
  const v = validateStyle(doc);
  return v.ok ? { doc: v.doc, errors: [] } : { errors: v.errors };
};

/**
 * Saves a sidecar, on an explicit user action. `state` is what readSidecar answered for it (its `hash` and
 * `doc` are what the write is checked and merged against). Answers
 * `{ ok: true, source, hash?, doc, text, notice?, merged? }`, or `{ ok: false, readOnly | invalid | stale, ... }`:
 *   readOnly  the stored file cannot be written over (damaged, newer schema, another project's);
 *   invalid   the document does not pass its own validation (`errors`);
 *   stale     another window changed the file and the two copies conflict (style only; `conflicts`, `current`).
 * A registry both windows changed is merged (plan §4.15c.1) and committed again, up to three times.
 */
export async function writeSidecar(kind, doc, state, over = {}) {
  if (!SIDECARS[kind]) throw new Error(`No such sidecar: ${kind}`);
  const ctx = context(over);
  if (state?.readOnly) return { ok: false, readOnly: true, notice: state.notice };
  const first = checked(kind, doc, ctx);
  if (first.errors.length) return { ok: false, invalid: true, errors: first.errors };
  let mine = kind === 'registry' ? touch(first.doc, new Date()) : first.doc;
  const keep = (extra = {}) => ({ ok: true, doc: mine, text: text(kind, mine), ...extra });
  const toApp = async notice => {
    await writeApp(kind, text(kind, mine), ctx.owner);
    return keep({ source: 'app', ...(notice ? { notice } : {}) });
  };
  if (!ctx.folder) return toApp('');
  if (ctx.folder.can?.write === false) return toApp(noticeAppOnly(kind));
  let expected = state?.hash ?? null, base = state?.doc ?? null, merged = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let result;
    try { result = await commitSidecar(ctx.folder, sidecarPath(kind), text(kind, mine), expected); }
    catch { return toApp(noticeAppOnly(kind)); }
    if (result.ok) {
      // The folder holds it now; a copy kept in the app while it could not is superseded.
      if (state?.appCopy || merged) await deleteFile(SIDECARS[kind].name, { owner: ctx.owner }).catch(() => {});
      return keep({ source: 'folder', hash: result.hash, ...(merged ? { merged: true } : {}) });
    }
    const current = await readSidecar(kind, over, { folderOnly: true });
    if (current.readOnly) return { ok: false, readOnly: true, notice: current.notice };
    const m = mergeDocs(kind, mine, current.doc, base);
    if (kind === 'style' && m.conflicts.length) return { ok: false, stale: true, conflicts: m.conflicts, current };
    mine = kind === 'registry' ? touch(m.doc, new Date()) : m.doc;
    expected = current.hash; base = current.doc; merged = true;
    if (current.text != null && text(kind, mine) === current.text) return keep({ source: 'folder', hash: current.hash, merged: true, unchanged: true });
  }
  return { ok: false, stale: true, conflicts: [] };
}

// ---- adoption ----------------------------------------------------------------------------------------
/**
 * Records adopted files (`entries` from lib/drift.mjs: fileEntry, evidenceAdoption, ipdAdoption) in
 * `.lykos/adopted.json`, replacing each file's earlier entry. Called at the moment a person adopts a
 * file (an import they confirmed) or confirms a write back; nothing polls. Answers what `writeSidecar`
 * answers, or `{ ok: false, readOnly: true, notice }` for a record that cannot be written over.
 */
export async function recordAdoption(entries, over = {}, { remove = [] } = {}) {
  const state = await readSidecar('adopted', over);
  if (state.readOnly) return { ok: false, readOnly: true, notice: state.notice };
  let doc = state.doc;
  // a file that was saved under a new name (a write back's next version) leaves its old path out of the record
  if (remove.length) doc = { ...doc, files: Object.fromEntries(Object.entries(doc.files || {}).filter(([path]) => !remove.includes(path))) };
  for (const e of entries || []) if (e?.path) doc = addAdoption(doc, e);
  if (text('adopted', doc) === state.text) return { ok: true, unchanged: true, doc, text: state.text, source: state.source, hash: state.hash };
  return writeSidecar('adopted', doc, state, over);
}

/**
 * Puts adoption entries back as they were before an automatic change (lib/folder-sync.mjs undoChange, run by a person's Undo): `before` is
 * `{ [path]: entry | null }`, null removing the entry. Answers what `writeSidecar` answers, or null for a record that cannot be written over.
 */
export async function restoreAdoption(before, over = {}) {
  const state = await readSidecar('adopted', over);
  if (state.readOnly || !before) return null;
  const files = { ...(state.doc.files || {}) };
  for (const [path, e] of Object.entries(before)) { if (e) files[path] = e; else delete files[path]; }
  return writeSidecar('adopted', { ...state.doc, files }, state, over);
}

// ---- restore ---------------------------------------------------------------------------------------
/**
 * Puts the sidecars of a restored backup into the app's storage under `owner` (the restored project's
 * save channel), and answers `{ names, registry, style, decisions }`: the stored documents as they read
 * back, and the registry's decisions, so the caller can say what came back.
 */
export async function restoreSidecars(items, owner, projectId = '') {
  const names = [];
  for (const it of items || []) {
    const kind = Object.keys(SIDECARS).find(k => SIDECARS[k].name === it.name);
    if (!kind) continue;
    await writeApp(kind, String(it.text), owner);
    names.push(it.name);
  }
  const registry = names.includes(SIDECARS.registry.name) ? (await readSidecar('registry', { folder: null, owner, projectId })).doc : null;
  const style = names.includes(SIDECARS.style.name) ? (await readSidecar('style', { folder: null, owner, projectId })).doc : null;
  return { names, registry, style, decisions: registry?.decisions || {} };
}

// A whole project as one file: the project state, every stored file it names
// (PDF copies, manuscript images and assets, kept raw imports) and a manifest
// with the SHA-256 of each entry and the version of Lykos that wrote it
// (amendment "Workspace: backup, dashboard, tasks, timeline and translation").
//
//   <name>.lykos.zip
//     manifest.json   { format: 'lykos-backup', version: 1, createdAt, app, project,
//                       entries: [{ path, sha256, bytes, kind: 'state'|'file'|'sidecar', key?, type?, name? }] }
//     project.json    the project, figures written in, no connection keys
//     files/<key>     one per stored file, named by its storage key
//     sidecars/<name>.json  the figure registry and figure style (decisions the project file does not hold)
//
// Version 1 archives hold no sidecars; one that does is written as version 2.
//
// Reading one checks everything before anything is used: the manifest's
// format and version, that every entry it lists is there with its hash, that
// nothing is there it does not list, and that no path climbs out of the
// archive. A file that fails any check is refused whole.
//
// Pure: bytes in, bytes out (zip.mjs, unzip.mjs, Web Crypto).
import { zip } from './zip.mjs';
import { entries as zipEntries, read as zipRead } from './unzip.mjs';

export const BACKUP_FORMAT = 'lykos-backup';
export const BACKUP_VERSION = 2;
/** The `.lykos` documents a backup carries beside the project (lib/figure-sidecar.mjs): `.lykos/<name>.json`; `adopted` is the record of what the project's files held when they were adopted (lib/drift.mjs). */
export const SIDECAR_NAMES = ['figure-registry', 'figure-style', 'adopted'];
export const sidecarPath = name => `sidecars/${name}.json`;
export const BACKUP_SUFFIX = '.lykos.zip';
const enc = new TextEncoder(), dec = new TextDecoder();
/**
 * The one set of size limits for a backup, used by the writer (buildBackup refuses to produce more) and by the reader
 * (readBackup accepts exactly this much), so a backup that builds always restores. Higher than the Office-file defaults of
 * unzip.mjs because full texts are large; every entry is SHA-256 checked against the manifest. The writer's ZIP fields are
 * 32-bit (no zip64) and the whole archive is held in memory on both sides, which is why the ceiling is 1 GiB.
 */
export const BACKUP_LIMITS = Object.freeze({ maxArchiveBytes: 1024 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024, maxEntryBytes: 256 * 1024 * 1024, maxEntries: 20_000 });
const mb = n => `${Math.ceil(n / (1024 * 1024))} MB`;

export async function sha256(bytes) {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of d) hex += b.toString(16).padStart(2, '0');
  return hex;
}
const toBytes = async data => data instanceof Uint8Array ? data
  : typeof data === 'string' ? enc.encode(data)
  : data && typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer())
  : data instanceof ArrayBuffer ? new Uint8Array(data) : null;

/** The archive path of a stored file's key: `files/` and the key, percent-encoded so any key is one safe name. */
export const filePath = key => `files/${encodeURIComponent(String(key))}`;

/**
 * Which stored files belong to a project: a PDF copy under its paper's id, a
 * manuscript image or asset (`img-…`, `asset-…`), a kept raw import
 * (`raw-import:<sha>`) — any stored key the project's text names. `keys` is
 * every key in the app's file store.
 */
export function projectFileKeys(state, keys) {
  const text = JSON.stringify(state || {});
  const papers = new Set((state?.papers || []).filter(p => p?.pdf && p.pdfMode !== 'link').map(p => p.id));
  return [...new Set(keys.map(String))].filter(k => papers.has(k)
    || (/^(img|asset)-/.test(k) && text.includes(k.replace(/^(img|asset)-/, '')))
    || (/^raw-import:/.test(k) && text.includes(k)))
    .sort();
}

/** A file name for a backup: the project's name made safe, and the day. */
export function backupName(name, now = new Date()) {
  const base = String(name || 'project').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'project';
  return `${base}-${now.toISOString().slice(0, 10)}${BACKUP_SUFFIX}`;
}

/**
 * Builds the backup. `state` is the project as it should be restored (the
 * caller strips keys and writes figures in); `files` are `{ key, data, type }`;
 * `sidecars` are `{ name, text }` for the names in SIDECAR_NAMES, stored as given.
 * Answers `{ blob, manifest }`.
 */
export async function buildBackup({ state, files = [], sidecars = [], app = {}, now = new Date() }) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.papers)) throw new Error('Nothing to back up: not a project');
  const out = [], listed = [];
  const add = async (path, bytes, meta) => { out.push({ name: path, data: bytes }); listed.push({ path, sha256: await sha256(bytes), bytes: bytes.length, ...meta }); };
  await add('project.json', enc.encode(JSON.stringify(state)), { kind: 'state' });
  const seen = new Set();
  for (const f of files) {
    const key = String(f?.key ?? '');
    if (!key || seen.has(key)) continue;
    const bytes = await toBytes(f.data);
    if (!bytes) continue;
    seen.add(key);
    await add(filePath(key), bytes, { kind: 'file', key, ...(f.type ? { type: String(f.type) } : {}) });
  }
  const named = new Set();
  for (const sc of sidecars) {
    const name = String(sc?.name ?? '');
    if (!SIDECAR_NAMES.includes(name) || named.has(name) || typeof sc.text !== 'string') continue;
    named.add(name);
    await add(sidecarPath(name), enc.encode(sc.text), { kind: 'sidecar', name });
  }
  const manifest = {
    format: BACKUP_FORMAT, version: named.size ? BACKUP_VERSION : 1, createdAt: now.toISOString(),
    app: { version: String(app.version || ''), shell: String(app.shell || '') },
    project: { name: String(state.project?.name || state.paper?.title || ''), researchType: String(state.project?.researchType || ''), records: state.papers.length },
    entries: listed,
  };
  // Refuse here, with the numbers, rather than write an archive readBackup would turn away.
  const L = BACKUP_LIMITS, total = listed.reduce((n, e) => n + e.bytes, 0);
  const biggest = listed.reduce((a, e) => e.bytes > (a?.bytes ?? -1) ? e : a, null);
  if (listed.length + 1 > L.maxEntries) throw new Error(`Backup too large to restore: ${listed.length} files exceeds the ${L.maxEntries.toLocaleString('en-US')}-file limit`);
  if (biggest && biggest.bytes > L.maxEntryBytes) throw new Error(`Backup too large to restore: ${biggest.path.slice(0, 60)} is ${mb(biggest.bytes)}, over the ${mb(L.maxEntryBytes)} limit for one file`);
  if (total > L.maxExpandedBytes) throw new Error(`Backup too large to restore: ${mb(total)} of project and full texts exceeds the ${mb(L.maxExpandedBytes)} limit`);
  const blob = await zip([{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }, ...out], { date: now });
  return { blob, manifest };
}

const refuse = why => { throw new Error(`Not restored: ${why}`); };
const safePath = p => typeof p === 'string' && p && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some(x => x === '..' || x === '.' || x === '');

/**
 * Reads and checks a backup. Answers `{ manifest, state, files: [{ key, type, bytes }], sidecars: [{ name, text }] }`
 * or throws with the first thing that is wrong.
 */
export async function readBackup(input) {
  const buf = await toBytes(input);
  if (!buf) refuse('the file could not be read');
  let list;
  try { list = zipEntries(buf, BACKUP_LIMITS); }
  catch (err) { refuse(/limit/.test(err?.message) ? `it is larger than a Lykos backup can be (${err.message})` : 'the file is not a ZIP archive'); }
  const byName = new Map();
  for (const e of list) {
    if (!safePath(e.name)) refuse(`the archive holds an unsafe path (${e.name.slice(0, 80)})`);
    if (byName.has(e.name)) refuse(`the archive holds ${e.name} twice`);
    byName.set(e.name, e);
  }
  const mEntry = byName.get('manifest.json');
  if (!mEntry) refuse('it has no manifest, so it is not a Lykos backup');
  let manifest;
  try { manifest = JSON.parse(dec.decode(await zipRead(buf, mEntry, BACKUP_LIMITS))); } catch { refuse('its manifest is not readable'); }
  if (manifest?.format !== BACKUP_FORMAT) refuse('it is not a Lykos backup');
  if (!(Number(manifest.version) >= 1)) refuse('its manifest has no version');
  if (Number(manifest.version) > BACKUP_VERSION) refuse('it was made by a newer version of Lykos; update Lykos to restore it');
  if (!Array.isArray(manifest.entries)) refuse('its manifest lists no entries');
  const named = new Set(['manifest.json']);
  let state = null;
  const files = [], sidecars = [];
  for (const m of manifest.entries) {
    if (!m || !safePath(m.path)) refuse('its manifest names an unsafe path');
    if (named.has(m.path)) refuse(`its manifest lists ${m.path} twice`);
    named.add(m.path);
    const e = byName.get(m.path);
    if (!e) refuse(`${m.path} is missing`);
    let bytes;
    try { bytes = await zipRead(buf, e, BACKUP_LIMITS); } catch { refuse(`${m.path} could not be read`); }
    bytes = new Uint8Array(bytes);
    if (bytes.length !== Number(m.bytes) || await sha256(bytes) !== String(m.sha256 || '').toLowerCase())
      refuse(`${m.path} does not match its checksum; the file was changed or damaged`);
    if (m.kind === 'state') {
      if (m.path !== 'project.json') refuse('its manifest names an unexpected project file');
      try { state = JSON.parse(dec.decode(bytes)); } catch { refuse('the project in it is not readable'); }
    } else if (m.kind === 'file') {
      if (m.path !== filePath(m.key)) refuse(`${m.path} is not where its key says`);
      files.push({ key: String(m.key), type: String(m.type || ''), bytes });
    } else if (m.kind === 'sidecar' && Number(manifest.version) >= 2) {
      if (!SIDECAR_NAMES.includes(m.name) || m.path !== sidecarPath(m.name)) refuse(`${m.path} is not a figure document Lykos knows`);
      if (sidecars.some(x => x.name === m.name)) refuse(`its manifest lists ${m.name} twice`);
      // Kept as stored: a damaged document restores as damaged (read-only, with its notice) instead of refusing the whole backup.
      sidecars.push({ name: m.name, text: dec.decode(bytes) });
    } else refuse(`its manifest lists an entry of unknown kind (${String(m.kind).slice(0, 20)})`);
  }
  const extra = [...byName.keys()].filter(n => !named.has(n));
  if (extra.length) refuse(`the archive holds ${extra.length === 1 ? 'a file' : `${extra.length} files`} its manifest does not list (${extra[0].slice(0, 60)})`);
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.papers)) refuse('it holds no project');
  return { manifest, state, files, sidecars };
}

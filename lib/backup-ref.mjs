// A daily copy as a reference to a commit (F4 v2 of docs/Lykos_Storage_Design_2026-11.md, 14 Nov 2026). A folder with a history keeps
// a day's copy as `project-<day>.ref.json`:
//
//   {"kind":"lykos-backup-ref","v":2,"commit":"<id>","h":"<sha256>","size":<bytes>,"keys":["project","prisma",…]}
//
// Its bytes are the commit's project data joined, `{"<key>":<the section's text at that commit>,…}` in the order of `keys`, and `h` is
// their sha256. `keys` is the copy's own order (the head's when the copy was made, lib/section-files.mjs and project_file.rs join in it);
// a commit records its sections in the order they were first committed, which differs (Sham, 1 Nov: the second key), so a reference
// without it could not be rebuilt to its hash. Storing the joined bytes instead (v1) shared none of their parts with the store: −19 MB
// against −80 MB on Sham (docs/footprint-2026-11.md, "Satellite stores").
//
// The rebuild reads each section through the history's public reader (lib/vcs.mjs `read`), which joins a section kept by chunks and puts
// the abstracts back on the records, as the restore does. Only commitRef writes: a commit of the project's data, when some of it is not
// committed (work queue row 22, the owner, 15 Nov 2026: "only keep changes"; a copy is never stored, the history keeps the state).
import { vcs, isSection, shownAs, DIR } from './vcs.mjs';
import { AUTO_BY } from './vcs-log.mjs';
import { headPieces } from './project-format.mjs';

export const REF_KIND = 'lykos-backup-ref';
const SECTION = '.lykos/project.json#';
const HEX64 = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{6,64}$/;
const enc = new TextEncoder(), dec = new TextDecoder();

/** The v2 reference `bytes` (or text) hold, checked field by field; null for anything else (a whole copy, a v1 reference, a broken file). */
export function parseRef(bytes) {
  let r;
  try { r = JSON.parse(typeof bytes === 'string' ? bytes : dec.decode(bytes)); } catch { return null; }
  if (!r || typeof r !== 'object' || r.kind !== REF_KIND || r.v !== 2) return null;
  if (typeof r.commit !== 'string' || !COMMIT.test(r.commit) || typeof r.h !== 'string' || !HEX64.test(r.h)) return null;
  if (!Number.isSafeInteger(r.size) || r.size < 2) return null;
  if (!Array.isArray(r.keys) || !r.keys.length || r.keys.some(k => typeof k !== 'string' || !k) || new Set(r.keys).size !== r.keys.length) return null;
  return { kind: REF_KIND, v: 2, commit: r.commit, h: r.h, size: r.size, keys: r.keys };
}

/** Whether a copy the keep rule drops (lib/backup-rule.mjs) may be removed as it is (work queue row 40): a restore point only as a v2
 *  reference (its state is a commit's), any other copy as the rule says. A v1 point or a whole copy before a change stays until a writer
 *  commits its state (tools/backup-refs.mjs evictable); bytes that do not read count as no reference. */
export const mayRemove = (name, bytes) => !String(name).startsWith('project-before-') || (String(name).endsWith('.ref.json') && !!parseRef(bytes));

/** The reference's text, its fields in one order (a reference is compared by its text nowhere, but two writers write the same bytes). */
export const refText = ({ commit, h, size, keys }) => `${JSON.stringify({ kind: REF_KIND, v: 2, commit, h, size, keys })}\n`;

/**
 * The project data of `commit` joined in the order of `keys` (each section's text as the history reads it), or null when a section is not
 * there or its content is not stored. `vcs` is lib/vcs.mjs vcs(folder, …).
 */
export async function joinedAt(vcs, commit, keys) {
  const parts = [enc.encode('{')];
  let size = 2;
  for (let i = 0; i < keys.length; i++) {
    const text = await vcs.read(commit, SECTION + keys[i]);
    if (!text) return null;
    const head = enc.encode(`${i ? ',' : ''}${JSON.stringify(keys[i])}:`);
    parts.push(head, text);
    size += head.length + text.length;
  }
  parts.push(enc.encode('}'));
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * The bytes a v2 reference names, rebuilt from the folder's history and checked against its size and hash (`hash`: bytes → hex sha256).
 * Throws with the reason when the commit or a section is missing or the bytes are not the ones named: a reference never restores
 * anything but its own copy.
 */
export async function refBytes(vcs, ref, { hash }) {
  const bytes = await joinedAt(vcs, ref.commit, ref.keys);
  if (!bytes) throw new Error(`commit ${ref.commit.slice(0, 10)} of this copy is not in the folder's history, or a section of it is not stored`);
  if (bytes.length !== ref.size || await hash(bytes) !== ref.h) throw new Error(`commit ${ref.commit.slice(0, 10)} does not rebuild this copy (its hash differs)`);
  return bytes;
}

/**
 * Whether `commit` can hold the state of a whole copy with the sections `keys`, from the entries alone: every key is a section there, and
 * a section kept whole has the hash of the copy's text of it (`sectionHash(key)` → hex sha256; the caller keeps them, a copy is tried
 * against several commits). A section kept by chunks is not decided here (its entry names its chunks); joinedAt decides. Lets a converter
 * skip the commits that differ without reading their content.
 */
export async function mayHold(vcs, commit, keys, sectionHash) {
  for (const k of keys) {
    const e = await vcs.entry(commit, SECTION + k);
    if (!e) return false;
    if (!e.parts && e.h !== await sectionHash(k)) return false;
  }
  return true;
}

/**
 * A copy of the project's data as it is on disk, kept as a reference (the day's copy, a copy before a change), in two steps. commitNow:
 * the project's data is committed when any of it is not (`paths`: the project file only, so no folder file is recorded or graded here), and
 * answers the commit that holds it (`made`: whether one was made, else HEAD held the state). refAt: the reference naming that commit, every
 * section of it in the commit's order, its bytes rebuilt once here, so a reference that is written always rebuilds. A writer that holds a
 * lock commits under it and makes the reference after (the rebuild reads every section). `repo` is lib/vcs.mjs vcs(folder, …); `hash`:
 * bytes → hex sha256. Both throw with the reason; nothing is written but the commit.
 */
export async function commitNow(repo, { by, message }) {
  const made = await repo.commit({ message, by, paths: ['.lykos/project.json'] });
  const commit = made?.id || await repo.head();
  if (!commit) throw new Error('the folder\'s history has no commit to name');
  return { commit, made: !!made };
}
export async function refAt(repo, commit, { hash }) {
  const files = await repo.manifest(commit);
  const keys = [...new Set(Object.entries(files).filter(([p, e]) => e && isSection(p)).map(([p, e]) => shownAs(p, e).slice(SECTION.length)))];
  if (!keys.length) throw new Error(`commit ${commit.slice(0, 10)} holds no project data`);
  const bytes = await joinedAt(repo, commit, keys);
  if (!bytes) throw new Error(`commit ${commit.slice(0, 10)} does not rebuild the project (a section of it is not stored)`);
  const ref = { kind: REF_KIND, v: 2, commit, h: await hash(bytes), size: bytes.length, keys };
  return { ref, text: refText(ref), bytes };
}
/**
 * `first()` run in a folder that may have no history yet (work queue row 22, the coordinator, 15 Nov 2026: no copies, ever; a folder with no
 * history gets one, for its backups): where the commit `first()` makes starts the history, automatic recording is set off before it
 * (`.lykos/vcs/settings.json` { auto: false }, lib/vcs-watch.mjs autoOn), so the history records nothing by itself until a person turns that on
 * in History. A setting already there is kept. When `first()` throws, the setting written here is taken back (a later Start history records).
 */
export async function forBackups(f, first) {
  const SETTINGS = `${DIR}/settings.json`, here = async p => !!(await f.stat(p).catch(() => null))?.exists;
  if (await here(`${DIR}/HEAD`)) return first();
  // a file that does not read counts as none (autoOn would read it as on), and its text is put back when the commit fails
  let text = null, was = {};
  if (await here(SETTINGS)) {
    text = dec.decode(await f.read(SETTINGS));
    try { const v = JSON.parse(text); was = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { was = {}; }
  }
  if (Object.hasOwn(was, 'auto')) return first();   // the person's own setting: kept
  for (const d of ['.lykos', DIR]) if (!await here(d)) await f.mkdir(d).catch(e => here(d).then(ok => { if (!ok) throw e; }));
  await f.writeText(SETTINGS, JSON.stringify({ ...was, auto: false }));
  try { return await first(); } catch (err) {
    await f.writeText(SETTINGS, text ?? JSON.stringify(was)).catch(() => {});
    throw err;
  }
}
/** Both steps at once (a writer that holds no lock: the tools). */
export async function commitRef(repo, { hash, by, message }) {
  const { commit, made } = await commitNow(repo, { by, message });
  return { ...await refAt(repo, commit, { hash }), commit, made };
}

/**
 * Whether `commit` records the project's data exactly as the head on disk names it, from hashes alone: every piece of the head (a chunk, a
 * whole section, a key kept in the head; project-format.mjs headPieces, as the history records a format-3 or later folder) is a section entry
 * of the commit with that hash, and the commit has no other. False when that does not decide it (format 1 or 2, a head that does not read).
 * A commit that made nothing (lib/vcs.mjs commit answers null) is no proof by itself: it answers null too when the sections did not read.
 */
export async function holdsHead(repo, commit, f, hash) {
  let pieces;
  try { pieces = headPieces(JSON.parse(dec.decode(await f.read('.lykos/project.json')))); } catch { return false; }
  if (!pieces.some(p => p.sha)) return false;
  const want = new Map();
  for (const p of pieces) want.set(SECTION + p.key, p.sha || await hash(enc.encode(p.text)));
  const have = Object.entries(await repo.manifest(commit)).filter(([p, e]) => e && isSection(p));
  return have.length === want.size && have.every(([p, e]) => want.get(p) === e.h);
}
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));

/**
 * The day's copy of a folder (lib/projects.mjs, the day's first save, under its folder lock; a folder with no history gets one, forBackups,
 * and automatic recording off stops no backup): the day's start committed
 * now, before the save writes over it, and the commit checked to hold it (holdsHead; where that does not decide, the commit's state rebuilt
 * and compared with `start()`, the project on disk joined). The reference `refFile` is written once `after()` resolves (the lock released),
 * since its rebuild reads every section. Answers `{ written }`, the promise of that write (in an object: awaiting the answer must not wait
 * for the lock). The recorder may commit in the same moment ("the history moved"): once more, on its history.
 */
export async function keepDay(f, refFile, { hash, after, start }) {
  const repo = vcs(f), now = () => commitNow(repo, { by: AUTO_BY, message: 'Project data' });
  const { commit, made } = await forBackups(f, () => now().catch(err => (/moved/.test(err?.message) ? now() : Promise.reject(err))));
  let checked = null;
  if (!made && !(await holdsHead(repo, commit, f, hash))) {
    checked = await refAt(repo, commit, { hash });
    const disk = await start();
    if (canonical(JSON.parse(dec.decode(checked.bytes))) !== canonical(JSON.parse(typeof disk === 'string' ? disk : dec.decode(disk)))) {
      throw new Error(`the history's newest commit (${commit.slice(0, 10)}) does not hold the project as it is on disk, and it could not be committed`);
    }
  }
  return { written: (async () => { await after(); await f.writeText(refFile, (checked || await refAt(repo, commit, { hash })).text); })() };
}

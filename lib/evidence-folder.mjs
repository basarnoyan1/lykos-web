// Writing the evidence-table exports into a project folder (plan §4.15a,
// evidence exports amendment 2026-09-28), by the folder's own version rule
// when it has one:
//
//   the table's current files carry a version ("…_FINALv12.xlsx",
//   "…_FINALv12_with_sources.xlsx", "…_tables_v12.docx"); the new set is
//   v13 in the same folder; every other v12 file there is carried to v13 as
//   well; the v12 set moves to <archive>/<folder>/v12/; the quick-access
//   copies at the top of the folder are replaced by the new ones, the old
//   copies moving to the archive's copies folder.
//
// A folder without that rule gets the app's own: "<name> vN" in the data
// folder, the current version archived (lib/folder-map.mjs nextVersion).
// `evidencePlan` is pure and returns every write, copy and move for the
// person to see; `applyEvidencePlan` does them, stopping at the first
// failure, and deletes nothing.
import { parseVersion, nextVersion } from './folder-map.mjs';
import { entries as zipEntries, read as unzipRead } from './unzip.mjs';

const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const dirOf = p => String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '';
const join = (...xs) => xs.filter(Boolean).join('/');

/** A file name with its version replaced: "T_FINALv12_with_sources.xlsx" at 13 is "T_FINALv13_with_sources.xlsx". */
export function withVersion(name, n) {
  const i = name.lastIndexOf('.');
  const stem = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : '';
  const all = [...stem.matchAll(/(^|[\s._-]|[a-z](?=v\d)|[A-Z](?=v\d))(v(?:er(?:sion)?)?[\s._-]?)(\d{1,3})(?=$|[\s._-]|\s*\()/gi)];
  const m = all.at(-1);
  if (!m) return `${stem} v${n}${ext}`;
  const at = m.index + m[1].length + m[2].length;
  return `${stem.slice(0, at)}${n}${stem.slice(at + m[3].length)}${ext}`;
}

/**
 * What writing the three exports does. `current` is the table's source file
 * (template.source.file, a path in the folder); `list(dir)` names the files
 * in a folder ({ name, dir }); `archive` is the folder's archive; `files` the
 * new contents by role: publication, sources, word. Returns `{ rule, version,
 * previous, ops, problems }` where each op is `{ op: 'write' | 'copy' |
 * 'move', from?, to, role? }`.
 */
export async function evidencePlan({ current = '', list, archive = 'Archive', dataDir = 'Data', exists = async () => false }) {
  const ops = [], problems = [];
  const dir = dirOf(current), name = baseOf(current);
  const v = current ? parseVersion(name).version : 0;
  const here = current ? await list(dir) : [];
  const convention = v > 0 && here.some(e => !e.dir && e.name === name);
  if (!convention) {
    // The app's rule: one name per output, its current version archived.
    const names = (await list(dataDir)).filter(e => !e.dir).map(e => e.name);
    const sets = [['publication', 'Publication table', 'xlsx'], ['sources', 'Publication table with sources', 'xlsx'], ['word', 'Publication tables', 'docx']];
    let version = 0;
    for (const [role, stem, ext] of sets) {
      const nv = nextVersion(names, stem, { archive, dir: dataDir });
      version = Math.max(version, nv.version);
      for (const m of nv.moves) ops.push({ op: 'move', from: m.from, to: m.to });
      ops.push({ op: 'write', to: join(dataDir, nv.name(ext)), role });
    }
    return finish({ rule: 'app', version, previous: version - 1, ops, problems }, exists);
  }
  const next = v + 1;
  const set = here.filter(e => !e.dir && parseVersion(e.name).version === v).map(e => e.name);
  const sources = set.find(n => /with[\s_-]?sources/i.test(n) && /\.xlsx$/i.test(n));
  const word = set.find(n => /\.docx$/i.test(n) && /tables?/i.test(n));
  const mine = new Map([[name, 'publication'], ...(sources ? [[sources, 'sources']] : []), ...(word ? [[word, 'word']] : [])]);
  const archiveDir = join(archive, dir, `v${v}`);
  // The rest of the set is carried to the new version before the set is archived.
  for (const n of set) if (!mine.has(n)) ops.push({ op: 'copy', from: join(dir, n), to: join(dir, withVersion(n, next)) });
  for (const n of set) ops.push({ op: 'move', from: join(dir, n), to: join(archiveDir, n) });
  ops.push({ op: 'write', to: join(dir, withVersion(name, next)), role: 'publication' });
  ops.push({ op: 'write', to: join(dir, sources ? withVersion(sources, next) : name.replace(/(\.xlsx)$/i, '_with_sources$1').replace(`v${v}`, `v${next}`)), role: 'sources' });
  ops.push({ op: 'write', to: join(dir, word ? withVersion(word, next) : `${parseVersion(name).stem}_tables_v${next}.docx`), role: 'word' });
  // Quick-access copies at the top of the folder: replaced, the old ones archived.
  if (dir) {
    const top = (await list('')).filter(e => !e.dir);
    const copies = (await list(archive).catch(() => [])).find(e => e.dir && /main folder|quick[\s-]?access/i.test(e.name))?.name || 'Quick-access copies';
    for (const e of top) {
      const role = mine.get(e.name);
      if (!role) continue;
      ops.push({ op: 'move', from: e.name, to: join(archive, copies, e.name) });
      ops.push({ op: 'write', to: withVersion(e.name, next), role });
    }
  }
  return finish({ rule: 'folder', version: next, previous: v, dir, archiveDir, ops, problems }, exists);
}

async function finish(plan, exists) {
  const moved = new Set(plan.ops.filter(o => o.op === 'move').map(o => o.from));
  for (const o of plan.ops) if (!moved.has(o.to) && await exists(o.to)) plan.problems.push(`${o.to} already exists`);
  return plan;
}

/** The plan as rows for the preview: what happens to which file. */
export const planRows = plan => plan.ops.map(o => o.op === 'write' ? ['Write', o.to] : o.op === 'copy' ? ['Copy', `${o.from} → ${o.to}`] : ['Move', `${o.from} → ${o.to}`]);

/**
 * Carries out a plan in a folder (lib/fsys.mjs): copies, then moves, then
 * writes, each parent folder made when missing. `files` maps a role to its
 * bytes. Stops at the first failure and says which steps were done.
 */
export async function applyEvidencePlan(folder, plan, files, ensureDir) {
  const done = [];
  const order = [...plan.ops.filter(o => o.op === 'copy'), ...plan.ops.filter(o => o.op === 'move'), ...plan.ops.filter(o => o.op === 'write')];
  try {
    for (const o of order) {
      await ensureDir(folder, dirOf(o.to));
      if ((await folder.stat(o.to)).exists) throw new Error(`${o.to} already exists`);
      if (o.op === 'copy') await folder.writeBytes(o.to, await folder.read(o.from));
      else if (o.op === 'move') await folder.rename(o.from, o.to);
      else await folder.writeBytes(o.to, files[o.role]);
      done.push(o);
    }
  } catch (err) { return { done, failed: String(err?.message || err).slice(0, 200) }; }
  return { done, failed: '' };
}

/** Whether two Office files hold the same parts, whatever the time their zips carry. */
export async function sameParts(a, b) {
  try {
    const [ea, eb] = [zipEntries(a), zipEntries(b)];
    if (ea.length !== eb.length) return false;
    for (let i = 0; i < ea.length; i++) {
      if (ea[i].name !== eb[i].name) return false;
      const [x, y] = [await unzipRead(a, ea[i]), await unzipRead(b, eb[i])];
      if (x.length !== y.length || x.some((c, j) => c !== y[j])) return false;
    }
    return true;
  } catch { return false; }
}

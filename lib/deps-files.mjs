// What a project folder says about its own dependencies, gathered for lib/deps-graph.mjs: the scripts' reads and writes, the cells files
// supplied when they were adopted, and the links commits recorded. It reads and never runs or writes anything.
//
// `folder` is the history adapter (list, read, stat; lib/vcs.mjs). Scripts are read as text and scanned by lib/figure-lineage.mjs.
import { ignored, DEFAULTS } from './vcs.mjs';
import { nativeOf } from './vcs-native.mjs';
import { scanScript, scanProducer } from './figure-lineage.mjs';

export const SCRIPT_EXT = new Set(['py', 'r', 'js', 'mjs', 'cjs']);
export const SCRIPT_MAX = 512 * 1024;      // a script larger than this is not read
export const SKIP = ['Old versions/', 'Archive/'];   // earlier states, not the project's own scripts
const dec = new TextDecoder();
const extOf = p => { const b = p.slice(p.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

export const READ_AT_ONCE = 8;   // scripts read side by side: each read is a round trip to the shell
/**
 * The folder's files `[{ path, size, mtime }]`, ignored ones left out (lib/vcs.mjs ignored). A desktop folder answers in one native call
 * (src-tauri walk_dir, the history scan's own fast path, lib/vcs-native.mjs): folder by folder it was 481 round trips in a row for one
 * project. Any other folder (a browser's directory handle, a test's folder in memory) is listed folder by folder (`walkEach`).
 */
export async function walk(folder) {
  const fast = folder?.walk && folder.hashFiles ? folder : nativeOf(folder);   // as lib/vcs.mjs picks it
  if (fast) {
    const skip = DEFAULTS.ignore.filter(p => p.endsWith('/')).map(p => p.slice(0, -1));
    return (await fast.walk(skip)).filter(f => !ignored(f.path)).map(f => ({ path: f.path, size: f.size, mtime: f.mtime || 0 }));
  }
  return walkEach(folder);
}
/** The folder listed one folder at a time: the way for a folder with no native walk. */
export async function walkEach(folder, rel = '', out = []) {
  for (const e of await folder.list(rel)) {
    const path = e.rel || (rel ? `${rel}/${e.name}` : e.name);
    if (ignored(e.dir ? `${path}/` : path) || ignored(path)) continue;
    if (e.dir) await walkEach(folder, path, out); else out.push({ path, size: e.size, mtime: e.mtime || 0 });
  }
  return out;
}

/** `{ files, times, adopted, scans, links, skipped }`: the folder's files and when each last changed (ms), `.lykos/adopted.json` as written, one scan per root script, the commits' links. */
export async function collectFileFacts(folder, { repo = null, limit = 200 } = {}) {
  const files = await walk(folder), paths = new Set(files.map(f => f.path)), skipped = [];
  let adopted = null;
  try { if ((await folder.stat('.lykos/adopted.json')).exists) adopted = JSON.parse(dec.decode(await folder.read('.lykos/adopted.json'))); } catch { skipped.push('.lykos/adopted.json could not be read'); }

  // the scripts, read READ_AT_ONCE at a time and kept in the folder's order (a scan's order is the graph's)
  const scripts = files.filter(f => SCRIPT_EXT.has(extOf(f.path)) && !SKIP.some(p => f.path.startsWith(p) || f.path.includes(`/${p}`)));
  const got = new Array(scripts.length);
  let next = 0;
  const reader = async () => {
    while (next < scripts.length) {
      const i = next++, f = scripts[i];
      if (f.size > SCRIPT_MAX) { got[i] = { why: `${f.path} is too large to read` }; continue; }
      try { got[i] = { text: dec.decode(await folder.read(f.path)) }; } catch { got[i] = { why: `${f.path} could not be read` }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, scripts.length) }, reader));
  const texts = new Map();
  scripts.forEach((f, i) => { if (got[i].text != null) texts.set(f.path, got[i].text); else skipped.push(got[i].why); });
  const ctx = { files: paths, read: p => texts.get(p) ?? null }, imported = new Set(), scans = [];
  for (const [p, t] of texts) for (const i of scanScript(t, p, ctx).imports) if (i.resolved && i.path) imported.add(i.path);
  for (const p of texts.keys()) {
    if (imported.has(p)) continue;
    const r = scanProducer(p, ctx);
    if (r.inputs.length || r.outputs.length) scans.push({ script: p, inputs: r.inputs, outputs: r.outputs.filter(o => o.ext !== null) });
  }

  const links = [];
  if (repo) for (const c of await repo.log({ limit })) for (const l of c.links || []) links.push({ from: String(l.from).replace(/@[^@/]*$/, ''), to: l.to, kind: l.kind, commit: c.id });
  return { files: paths, times: new Map(files.map(f => [f.path, f.mtime])), adopted, scans, links, skipped };
}

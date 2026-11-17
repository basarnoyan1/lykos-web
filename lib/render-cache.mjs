// The cache an output is rendered into for "Show in folder" (lib/project-folder.mjs writeRenders): outside `.lykos`, which keeps the
// project's data and nothing Lykos can make again (docs/Lykos_Storage_Design_2026-11.md, A; owner, 14 Nov 2026). An adapter rooted at the
// render folder: stat, read, list, writeBytes, ensure, reveal; `where` says the folder in words.
//
// On the desktop the shell names the project's render folder in the per-user cache (main.rs render_cache:
// ~/Library/Caches/Lykos/renders/<project id>, beside O4's figures; 15 Nov 2026), reached as a folder by path (lib/fsys.mjs). In a
// browser tab (the hosted build) they stay where they were, `.lykos/cache/renders` in the folder (RENDERS_DIR), through `within`.
import { RENDERS_DIR } from './project-folder.mjs';
import { lib_native$invoke as invoke } from "../boot.mjs";
import { lib_fsys$folderAtPath as folderAtPath } from "../boot.mjs";

/** An adapter of `folder` (a project folder adapter, lib/fsys.mjs) rooted at `base`, a folder-relative path. */
export function within(folder, base) {
  const at = rel => (rel ? `${base}/${rel}` : base);
  const ensure = async () => {
    let p = '';
    for (const part of base.split('/')) { p = p ? `${p}/${part}` : part; if (!(await folder.stat(p)).exists) await folder.mkdir(p); }
  };
  return {
    where: base,
    stat: rel => folder.stat(at(rel)),
    read: rel => folder.read(at(rel)),
    list: rel => folder.list(at(rel)),
    writeBytes: (rel, bytes) => folder.writeBytes(at(rel), bytes),   // a render replaces the last
    ensure,
    reveal: folder.reveal ? rel => folder.reveal(at(rel)) : null,
  };
}

/** A folder adapter of the per-user render folder as the render cache: a render replaces the last (the shell's write_bytes only creates). */
function cacheAt(f) {
  return {
    where: f.root,
    stat: rel => f.stat(rel),
    read: rel => f.read(rel),
    list: rel => f.list(rel),
    writeBytes: async (rel, bytes) => ((await f.stat(rel)).exists ? f.replaceBytes(rel, bytes) : f.writeBytes(rel, bytes)),
    ensure: async () => {},   // the shell made it
    reveal: f.reveal ? rel => f.reveal(rel) : null,
  };
}

/**
 * The render cache of the open folder project. `idOf()`: the project's id (researchLedger.projectId), made by the caller when it means
 * to write. On the desktop, null while the project has no id (it can have no renders yet); never the project folder.
 */
export async function renderCache(folder, idOf, open = shellRenders) {
  if (folder?.kind !== 'path') return within(folder, RENDERS_DIR);
  const id = await idOf?.();
  return id ? cacheAt(await open(id)) : null;
}

/** The project's render folder in the per-user cache, as a folder the shell reaches by path. */
const shellRenders = async id => folderAtPath(await invoke('render_cache', { project: id }));

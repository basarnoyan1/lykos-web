// A project folder, reached one of two ways: a path the desktop shell reads and
// writes on our behalf (confined to folders the user chose), or a directory
// handle the browser granted. Everything above this module sees one shape and
// works in relative paths with forward slashes; '' is the folder itself.
//
// Only what both routes can do honestly is offered on both. Moving to the
// Trash, showing in the Finder and opening in another application exist only
// in the desktop shell, and `can` says so, so a view never offers them where
// they would fail.
import { inDesktop } from './native.mjs';

const call = (cmd, args, options) => {
  const f = window.__TAURI_INTERNALS__?.invoke;
  if (!f) throw new Error('no native shell');
  return options ? f(cmd, args, options) : f(cmd, args);
};
// File bytes go to the shell as the request body, the path in a header (src-tauri main.rs write_bytes): as { bytes: [...] } every
// byte was a number in a JSON array, about 3.6 times the file in text and many times that in arrays on the way out.
const sendBytes = (cmd, path, bytes) => call(cmd, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { headers: { 'Lykos-Path': encodeURIComponent(path) } });

export const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const parentOf = rel => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
export const baseName = rel => rel.slice(rel.lastIndexOf('/') + 1);
export const extOf = rel => { const b = baseName(rel); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

/** A name the user typed, refused if it could leave its folder or hide itself by accident. */
export function validName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[/\\:\0]/.test(n)) return '';
  return n;
}

/** A copy Lykos writes in a project's .lykos/backups (lib/projects.mjs): the only files a folder removes outright. */
export const backupCopy = rel => /^\.lykos\/backups\/project-[^/]+\.json(\.gz)?$/.test(rel);

// ---- desktop: paths through the shell --------------------------------------
function pathFolder(root) {
  const abs = rel => rel ? `${root}/${rel}` : root;
  return {
    kind: 'path', root, name: baseName(root),
    can: { trash: true, reveal: true, openExternal: true, rename: true, renameDir: true },
    abs,
    async list(rel = '') {
      const rows = await call('list_dir', { dir: abs(rel) });
      return rows.map(([name, dir, size, mtime]) => ({ name, dir, size, mtime, rel: join(rel, name) }));
    },
    async read(rel) { return new Uint8Array(await call('read_file', { path: abs(rel) })); },
    async stat(rel) {
      const [exists, dir, size, mtime] = await call('stat_path', { path: abs(rel) });
      return { exists, dir, size, mtime };
    },
    writeText: (rel, text) => call('write_text', { path: abs(rel), text }),
    commitText: (rel, text, expectedHash) => call('compare_write_text', { path: abs(rel), text, expectedHash }),
    writeBytes: (rel, bytes) => sendBytes('write_bytes', abs(rel), bytes),
    replaceBytes: (rel, bytes) => sendBytes('replace_bytes', abs(rel), bytes),
    mkdir: rel => call('make_dir', { path: abs(rel) }),
    rename: (from, to) => call('rename_path', { from: abs(from), to: abs(to) }),
    trash: rel => call('trash_path', { path: abs(rel) }),
    // Removes one copy the retention rule dropped (lib/backup-rule.mjs); the shell refuses any other file.
    removeBackup: rel => { if (!backupCopy(rel)) throw new Error('not a backup copy'); return call('remove_backup_copy', { path: abs(rel) }); },
    // Empties .lykos/cache (regenerable: text and tables read from the folder's files).
    clearCache: () => call('clear_folder_cache', { root }),
    reveal: rel => call('reveal_path', { path: abs(rel) }),
    openExternal: rel => call('open_path', { path: abs(rel) }),
  };
}

// ---- browser: a granted directory handle ----------------------------------
function handleFolder(handle) {
  async function dirAt(rel, create = false) {
    let d = handle;
    for (const seg of rel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
    return d;
  }
  async function fileAt(rel, create = false) {
    const d = await dirAt(parentOf(rel), create);
    return d.getFileHandle(baseName(rel), { create });
  }
  // Not found, or the wrong kind, is "absent"; anything else — a lock, a
  // lapsed permission — is thrown, never taken for a missing file.
  const absent = err => err?.name === 'NotFoundError' || err?.name === 'TypeMismatchError';
  async function exists(rel) {
    let d;
    try { d = await dirAt(parentOf(rel)); } catch (err) { if (absent(err)) return null; throw err; }
    const name = baseName(rel);
    try { return await d.getFileHandle(name); } catch (err) { if (!absent(err)) throw err; }
    try { return await d.getDirectoryHandle(name); } catch (err) { if (!absent(err)) throw err; }
    return null;
  }
  // move() is a Chromium addition, and Chromium has it for files before
  // folders. Without it there is no rename that does not copy, so none is
  // offered for that kind of entry.
  const canMove = typeof FileSystemFileHandle !== 'undefined' && 'move' in FileSystemFileHandle.prototype;
  const canMoveDir = typeof FileSystemDirectoryHandle !== 'undefined' && 'move' in FileSystemDirectoryHandle.prototype;
  return {
    kind: 'handle', handle, name: handle.name,
    can: { trash: false, reveal: false, openExternal: false, rename: canMove, renameDir: canMoveDir },
    abs: rel => rel,
    async list(rel = '') {
      const d = await dirAt(rel);
      const out = [];
      for await (const h of d.values()) {
        if (h.kind === 'directory') out.push({ name: h.name, dir: true, size: 0, mtime: 0, rel: join(rel, h.name) });
        else {
          const f = await h.getFile().catch(() => null);
          out.push({ name: h.name, dir: false, size: f?.size || 0, mtime: f?.lastModified || 0, rel: join(rel, h.name) });
        }
      }
      return out.sort((a, b) => (b.dir - a.dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    },
    async read(rel) { const f = await (await fileAt(rel)).getFile(); return new Uint8Array(await f.arrayBuffer()); },
    async stat(rel) {
      const h = await exists(rel);
      if (!h) return { exists: false, dir: false, size: 0, mtime: 0 };
      if (h.kind === 'directory') return { exists: true, dir: true, size: 0, mtime: 0 };
      const f = await h.getFile();
      return { exists: true, dir: false, size: f.size, mtime: f.lastModified };
    },
    // createWritable writes to a swap file and replaces the target on close,
    // which is the same guarantee the shell's rename gives.
    async writeText(rel, text) {
      const fh = await fileAt(rel, true);
      const w = await fh.createWritable();
      await w.write(text); await w.close();
      return (await fh.getFile()).lastModified;
    },
    async writeBytes(rel, bytes) {
      if (await exists(rel)) throw new Error('a file with that name exists');
      const fh = await fileAt(rel, true);
      const w = await fh.createWritable();
      await w.write(bytes); await w.close();
      return (await fh.getFile()).lastModified;
    },
    async replaceBytes(rel, bytes) {
      const h = await exists(rel);
      if (!h || h.kind !== 'file') throw new Error('no such file');
      const w = await h.createWritable();
      await w.write(bytes); await w.close();
      return (await h.getFile()).lastModified;
    },
    async removeBackup(rel) {
      if (!backupCopy(rel)) throw new Error('not a backup copy');
      await (await dirAt(parentOf(rel))).removeEntry(baseName(rel));
    },
    async clearCache() {
      let d; try { d = await dirAt('.lykos'); } catch (err) { if (absent(err)) return; throw err; }
      try { await d.removeEntry('cache', { recursive: true }); } catch (err) { if (!absent(err)) throw err; }
    },
    async mkdir(rel) {
      if (await exists(rel)) throw new Error('that name is taken');
      await dirAt(rel, true);
    },
    async rename(from, to) {
      if (!canMove) throw new Error('renaming is not available here');
      if (await exists(to)) throw new Error('that name is taken');
      const h = await exists(from);
      if (!h) throw new Error('not found');
      if (h.kind === 'directory' && !canMoveDir) throw new Error('renaming folders is not available here');
      if (parentOf(from) === parentOf(to)) await h.move(baseName(to));
      else await h.move(await dirAt(parentOf(to)), baseName(to));
    },
  };
}

export const folderAtPath = root => pathFolder(root.replace(/\/+$/, ''));
export const folderFromHandle = handle => handleFolder(handle);

/** `rel`, or `rel` with " 2", " 3"… before its extension: the first name not taken. */
export async function freeName(folder, rel) {
  const dir = parentOf(rel), base = baseName(rel), dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const cand = join(dir, n === 1 ? base : `${stem} ${n}${ext}`);
    if (!(await folder.stat(cand)).exists) return cand;
  }
  throw new Error('no free name');
}

/** Whether this runtime can open a folder as a project at all. */
// The hosted web build keeps projects in the browser only: a folder there is a Chromium-only picker, and in Safari or Firefox a button that
// does nothing, so a tab on https offers no folder projects at all (Open folder, Find projects, a folder as Save location).
// a browser that grants folders (Chrome, Edge) opens them on the site too; Safari and Firefox keep projects in their own storage
export const canOpenFolders = () => inDesktop() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

/** A handle's read-write permission, asking only when a gesture allows it. */
export async function permitted(handle, { ask = false } = {}) {
  if (!handle?.queryPermission) return false;
  let s = await handle.queryPermission({ mode: 'readwrite' });
  if (s === 'prompt' && ask) s = await handle.requestPermission({ mode: 'readwrite' });
  return s === 'granted';
}

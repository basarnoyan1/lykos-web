// Where the assistant may read: the folders the user added, and nothing else.
// On the desktop the shell enforces this; in a browser the boundary is the set
// of directory handles the user granted, which is the same idea.
import { inDesktop, pickFolderNative, chosenFoldersNative, forgetFolderNative, listDirNative, readFileNative } from './native.mjs';
import { putHandle, getHandle, listHandles, deleteHandle, resolveHandle } from './files.mjs';
import { SUPPORTED, extOf } from './filetext.mjs';

export async function roots() {
  if (inDesktop()) return (await chosenFoldersNative()).map(p => ({ path: p, label: p.split('/').pop() || p }));
  const hs = await listHandles();
  return hs.filter(h => h?.kind === 'directory').map(h => ({ path: h.name, label: h.name }));
}

export async function addFolder() {
  if (inDesktop()) return pickFolderNative();
  let dir; try { dir = await window.showDirectoryPicker({ mode: 'read' }); } catch { return null; }
  await putHandle(`dir:${dir.name}`, dir);
  return dir.name;
}

export async function forgetFolder(path) {
  if (inDesktop()) return forgetFolderNative(path);
  return deleteHandle(`dir:${path}`);
}

async function browserDir(path) {
  const [root, ...rest] = path.split('/').filter(Boolean);
  let h = await resolveHandle(await getHandle(`dir:${root}`));
  if (!h) throw new Error('folder not chosen');
  for (const part of rest) {
    if (part === '.' || part === '..' || part.startsWith('.')) throw new Error('path is outside a chosen folder');
    h = await h.getDirectoryHandle(part);
  }
  return h;
}

export async function listDir(path = '') {
  if (!path) return (await roots()).map(r => ({ name: r.label, path: r.path, kind: 'dir', size: 0 }));
  if (inDesktop()) return (await listDirNative(path)).map(e => ({ name: e.name, path: e.path, kind: e.is_dir ? 'dir' : 'file', size: e.size }));
  const dir = await browserDir(path); const out = [];
  for await (const e of dir.values()) {
    if (e.name.startsWith('.')) continue;
    if (e.kind === 'directory') out.push({ name: e.name, path: `${path}/${e.name}`, kind: 'dir', size: 0 });
    else if (SUPPORTED.includes(extOf(e.name))) { const f = await e.getFile(); out.push({ name: e.name, path: `${path}/${e.name}`, kind: 'file', size: f.size }); }
    if (out.length >= 500) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readPath(path) {
  if (inDesktop()) return readFileNative(path);
  const parts = path.split('/').filter(Boolean); const name = parts.pop();
  if (!name || name.startsWith('.') || !SUPPORTED.includes(extOf(name))) throw new Error('file type is not available to the assistant');
  const dir = await browserDir(parts.join('/'));
  const f = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await f.arrayBuffer());
}

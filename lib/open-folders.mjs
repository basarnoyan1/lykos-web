// Folders opened for browsing are independent of the active research project.
import { activeFolder, currentId } from './projects.mjs';
import { folderFromHandle, folderAtPath, baseName } from './fsys.mjs';
import { inDesktop, pickFolderNative } from './native.mjs';
import { saveFile } from './save.mjs';

const opened = new Map();
const storageKey = id => `lykos.openFolders:${id}`;
const roots = () => {
  const id = currentId();
  if (!opened.has(id)) {
    let saved = [];
    if (inDesktop()) try { saved = JSON.parse(localStorage.getItem(storageKey(id)) || '[]'); } catch {}
    const valid = Array.isArray(saved) ? saved.filter(r => typeof r.id === 'string' && r.id.startsWith('@opened-') && typeof r.path === 'string' && r.path.startsWith('/')) : [];
    opened.set(id, valid.map(r => ({ id: r.id, folder: folderAtPath(r.path) })));
  }
  return opened.get(id);
};
function persistRoots() {
  if (!inDesktop()) return;
  try { localStorage.setItem(storageKey(currentId()), JSON.stringify(roots().filter(r => r.folder.kind === 'path').map(r => ({ id: r.id, path: r.folder.root })))); } catch {}
}
export const isOpenedFolder = rel => roots().some(r => rel === r.id || rel.startsWith(`${r.id}/`));
export const isFolderRoot = rel => roots().some(r => rel === r.id);
export function removeOpenedFolder(rel) { const items = roots(), i = items.findIndex(r => r.id === rel); if (i >= 0) { items.splice(i, 1); persistRoots(); } }

/** Shortest unambiguous trailing paths; full paths stay available in tooltips. */
export function folderLabels(paths) {
  const parts = paths.map(p => p.replace(/\/+$/, '').split('/').filter(Boolean));
  let common = 0;
  if (parts.length > 1) while (parts.every(p => p.length > common + 1 && p[common] === parts[0][common])) common++;
  return parts.map((p, i) => {
    const label = parts.length > 1 ? p.slice(common).join('/') : p.at(-1);
    const duplicate = paths.slice(0, i).filter(x => x === paths[i]).length;
    return duplicate ? `${label} (${duplicate + 1})` : label;
  });
}

/** A directory input supplies file snapshots, not permission to overwrite originals. */
export function snapshotFolder(files) {
  const first = files[0]?.webkitRelativePath || files[0]?.name || 'Folder';
  const name = first.split('/')[0], entries = new Map(), contents = new Map();
  entries.set('', { exists: true, dir: true, size: 0, mtime: 0 });
  for (const file of files) {
    const path = file.webkitRelativePath || `${name}/${file.name}`;
    const rel = path.split('/').slice(1).join('/');
    if (!rel || rel.split('/').some(p => p === '..' || p === '.')) continue;
    contents.set(rel, file);
    entries.set(rel, { exists: true, dir: false, size: file.size, mtime: file.lastModified });
    const segments = rel.split('/'); segments.pop();
    while (segments.length) { entries.set(segments.join('/'), { exists: true, dir: true, size: 0, mtime: 0 }); segments.pop(); }
  }
  const folder = {
    kind: 'snapshot', name, download: true, can: { write: false },
    async stat(rel) { return entries.get(rel) || { exists: false }; },
    async list(rel = '') {
      const prefix = rel ? `${rel}/` : '';
      return [...entries].filter(([key]) => key && key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(([key, value]) => ({ ...value, name: baseName(key), rel: key }))
        .sort((a,b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    },
    async read(rel) { const file = contents.get(rel); if (!file) throw new Error('File not found'); return new Uint8Array(await file.arrayBuffer()); },
    async replaceBytes(rel, bytes) {
      if (!contents.has(rel)) throw new Error('File not found');
      if (!await saveFile(bytes, baseName(rel))) throw new Error('Save cancelled');
      const stamp = Date.now();
      contents.set(rel, new Blob([bytes])); entries.set(rel, { exists:true, dir:false, size:bytes.length, mtime:stamp });
      return stamp;
    },
    async writeText(rel, text) { return folder.replaceBytes(rel, new TextEncoder().encode(text)); },
  };
  return folder;
}

function pickSnapshot() {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.webkitdirectory = true; input.multiple = true;
    input.hidden = true; input.setAttribute('aria-label', 'Choose folder'); document.body.append(input);
    const finish = value => { input.remove(); resolve(value); };
    input.onchange = () => finish(input.files.length ? snapshotFolder([...input.files]) : null);
    input.oncancel = () => finish(null);
    input.click();
  });
}

// Embedded browsers may expose showDirectoryPicker but dismiss it immediately.
// A real directory input works there and accurately promises copy-based saving.
export const needsFolderInput = () => !inDesktop();

export async function addOpenedFolder(files = null) {
  let folder;
  if (files) { if (!files.length) return null; folder = snapshotFolder(files); }
  else if (inDesktop()) { const path = await pickFolderNative(); if (path) folder = folderAtPath(path); }
  else if (typeof window.showDirectoryPicker === 'function') {
    try { folder = folderFromHandle(await window.showDirectoryPicker({ mode: 'readwrite' })); }
    catch (error) { if (error.name === 'AbortError') return null; if (['SecurityError','NotAllowedError','NotSupportedError'].includes(error.name)) folder = await pickSnapshot(); else throw error; }
  } else folder = await pickSnapshot();
  if (!folder) return null;
  for (const root of roots()) {
    if ((folder.root && root.folder.root === folder.root) || (folder.handle && root.folder.handle && await folder.handle.isSameEntry(root.folder.handle))) return root;
  }
  const root = { id: `@opened-${crypto.randomUUID()}`, folder };
  roots().push(root); persistRoots(); return root;
}

function resolve(rel = '') {
  const root = roots().find(r => rel === r.id || rel.startsWith(`${r.id}/`));
  return root ? { folder: root.folder, rel: rel.slice(root.id.length).replace(/^\//,''), root } : { folder: activeFolder(), rel };
}
export function displayFilePath(rel) {
  const at = resolve(rel);
  return at.root ? `${at.folder.root || at.folder.name}${at.rel ? `/${at.rel}` : ''}` : rel;
}

/** Virtual roots keep the existing project-relative paths unchanged. */
export function filesFolder(context = '') {
  const project = activeFolder(), items = roots();
  if (!project && !items.length) return null;
  const source = resolve(context).folder;
  const adapter = {
    kind: 'workspace', name: source?.name || 'Files', can: { ...(source?.can || {}), write: !!source && source.can?.write !== false }, download: source?.download,
    abs: rel => { const at = resolve(rel); return at.folder?.abs?.(at.rel) || displayFilePath(rel); },
    async list(rel = '') {
      if (!rel) {
        const labels = folderLabels(items.map(r => r.folder.root || r.folder.name));
        return [...items.map((r,i) => ({name:labels[i],rel:r.id,dir:true,size:0,mtime:0})), ...(project ? await project.list('') : [])];
      }
      const at = resolve(rel); if (!at.folder) throw new Error('Folder not open');
      const rows = await at.folder.list(at.rel);
      return rows.map(e => ({ ...e, rel: at.root ? `${at.root.id}/${e.rel}` : e.rel }));
    },
    async rename(from, to) {
      const a = resolve(from), b = resolve(to);
      if (a.folder !== b.folder || !a.rel || !b.rel) throw new Error('Moving between opened folders is not supported');
      return a.folder.rename(a.rel,b.rel);
    },
  };
  for (const method of ['read','stat','writeText','writeBytes','replaceBytes','mkdir','trash','reveal','openExternal']) adapter[method] = async (rel,...args) => {
    const at = resolve(rel);
    if (method === 'trash' && at.root && !at.rel) throw new Error('Remove this folder from Files instead');
    if (!at.folder?.[method]) throw new Error('This folder supports browsing and saving edited copies');
    return at.folder[method](at.rel,...args);
  };
  return adapter;
}

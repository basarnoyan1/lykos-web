// Import projects from folder…: a folder chosen with the browser's folder upload (every browser has one; nothing is linked, the files
// are copied), searched for the projects in it, at any depth: a project folder (`.lykos/project.json`, or its visible copy `Lykos project.json`
// where the upload left hidden folders out) and an exported project
// (`*.lykos.zip`). The person ticks the ones to bring in; each becomes a project in this app's storage, with the PDFs its records name
// that the folder holds, its rendered figures and its figure documents (lib/figure-sidecar.mjs). Nothing in the folder is changed.
import { normalizeProject, portableState } from '../store.mjs';
import { putFile, documentHash } from './files.mjs';
import { idbFigureStore, isFigureHash } from './figures.mjs';
import { restoreSidecars, SIDECARS } from './figure-sidecar.mjs';
import * as projects from './projects.mjs';
import { BACKUP_SUFFIX } from './backup.mjs';

const PROJECT_FILE = /(?:^|\/)\.lykos\/project\.json$/;
// the project file's visible copy at a project folder's top (lib/projects.mjs VISIBLE_COPY): what a browser that leaves out hidden folders sees
const VISIBLE_FILE = /(?:^|\/)Lykos project\.json$/;
/** A project file's text as data; one that is not JSON is an error that says so, never an empty project. */
const parseProject = text => { try { return JSON.parse(text); } catch { throw new Error('the project file could not be read (it may be incomplete or damaged)'); } };
const pathOf = f => String(f.webkitRelativePath || f.relativePath || f.name || '');
const under = (root, rel) => (root ? `${root}/${rel}` : rel);
const MAX_DEPTH = 6;   // folders below the one chosen; deeper project files are not looked for

// Folders a project search never needs: a version store, packages, and the copies a project keeps of itself.
const SKIP_DIR = /^(?:\.git|node_modules|\.Trash)$/, SKIP_LYKOS = /^(?:backups|cache)$/;

/**
 * The files of a folder the browser granted (showDirectoryPicker: Chrome, Edge), hidden folders included: a folder upload leaves out a
 * hidden folder such as `.lykos`, where a project keeps its data, so the projects in it were not found. Each File carries `relativePath`
 * from the chosen folder's name, as an upload's webkitRelativePath does. `maxDepth` folders down at most.
 */
export async function filesFromHandle(dir, { maxDepth = MAX_DEPTH + 2 } = {}) {
  const out = [];
  const walk = async (h, path, depth, inLykos) => {
    for await (const [name, child] of h.entries()) {
      const rel = `${path}/${name}`;
      if (child.kind === 'directory') {
        if (depth >= maxDepth || SKIP_DIR.test(name) || (inLykos && SKIP_LYKOS.test(name))) continue;
        await walk(child, rel, depth + 1, inLykos || name === '.lykos');
      } else {
        // a file the walk may not read, or one removed meanwhile, is left out and counted (out.skipped), not the end of the import
        let file; try { file = await child.getFile(); } catch { out.skipped = (out.skipped || 0) + 1; continue; }
        Object.defineProperty(file, 'relativePath', { value: rel });
        out.push(file);
      }
    }
  };
  await walk(dir, dir.name, 0, false);
  return out;
}

/**
 * The files of a folder dropped on the page (its entries, DataTransferItem.webkitGetAsEntry, taken in the drop event: every browser), hidden folders included, each with
 * `relativePath` from the dropped folder's name. Null when what was dropped holds no folder. Unreadable files are counted (out.skipped).
 */
export async function filesFromDrop(entries, { maxDepth = MAX_DEPTH + 2 } = {}) {
  const roots = [...(entries || [])].filter(e => e?.isDirectory);
  if (!roots.length) return null;
  const out = [];
  const list = dir => new Promise(resolve => { const r = dir.createReader(), all = []; const next = () => r.readEntries(b => { if (!b.length) resolve(all); else { all.push(...b); next(); } }, () => resolve(all)); next(); });
  const fileOf = e => new Promise(resolve => e.file(resolve, () => resolve(null)));
  const walk = async (dir, path, depth, inLykos) => {
    for (const e of await list(dir)) {
      const rel = `${path}/${e.name}`;
      if (e.isDirectory) { if (depth < maxDepth && !SKIP_DIR.test(e.name) && !(inLykos && SKIP_LYKOS.test(e.name))) await walk(e, rel, depth + 1, inLykos || e.name === '.lykos'); continue; }
      const file = await fileOf(e);
      if (!file) { out.skipped = (out.skipped || 0) + 1; continue; }
      Object.defineProperty(file, 'relativePath', { value: rel });
      out.push(file);
    }
  };
  for (const root of roots) await walk(root, root.name, 0, false);
  return out;
}

/** Whether an upload holds any hidden project folder: none means the browser may have left `.lykos` out. */
export const sawLykos = files => [...files].some(f => /(?:^|\/)\.lykos\//.test(pathOf(f)));

/**
 * The projects in an uploaded folder: `[{ key, kind: 'folder' | 'export', root, file, name, type, records, pdfs, missing }]`, sorted by
 * name. The chosen folder's own name is the first part of every path; `root` is a project folder's path from there. A project file
 * that does not parse is listed with its `error`, never as an empty project.
 */
export async function findProjects(files) {
  const list = [...files];
  const byPath = new Map(list.map(f => [pathOf(f), f]));
  const out = [];
  for (const f of list) {
    const p = pathOf(f), hidden = PROJECT_FILE.test(p), visible = !hidden && VISIBLE_FILE.test(p);
    const root = hidden ? p.slice(0, -'/.lykos/project.json'.length).replace(/^\.lykos\/project\.json$/, '') : visible ? p.slice(0, -'Lykos project.json'.length).replace(/\/$/, '') : '';
    // a folder with both is read from .lykos, the project file itself; the copy stands in only where the hidden folder did not come
    if ((hidden || (visible && !byPath.has(under(root, '.lykos/project.json')))) && p.split('/').length - 2 <= MAX_DEPTH + 1) {
      try {
        const data = parseProject(await f.text());
        const papers = data.papers || [];
        const named = papers.filter(x => x.pdfRel);
        const held = named.filter(x => byPath.has(under(root, x.pdfRel))).length;
        out.push({ key: p, kind: 'folder', root, file: f, name: String(data.project?.name || data.paper?.title || root.split('/').pop() || 'Project'),
          type: String(data.project?.researchType || ''), records: papers.length, pdfs: held, missing: named.length - held });
      } catch (err) { out.push({ key: p, kind: 'folder', root, file: f, name: root.split('/').pop() || 'Project', error: String(err?.message || err) }); }
    } else if (p.endsWith(BACKUP_SUFFIX) && !/\/\.lykos\//.test(`/${p}`)) {
      out.push({ key: p, kind: 'export', root: p.slice(0, p.lastIndexOf('/')), file: f, name: f.name.slice(0, -BACKUP_SUFFIX.length), type: '', records: null, pdfs: null, missing: 0 });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One found project into this app's storage: its project file as the project, the PDFs its records name (copied, the record then
 * holds a copy, not a path), its figures and its figure documents. An export goes through Import project… (lib/project-backup.mjs).
 * Returns `{ id, name, pdfs }`.
 */
export async function importFound(found, files, { onFile = () => {} } = {}) {   // onFile(name): a PDF was read or copied (two steps each)
  if (found.kind === 'export') { const r = await (await import('./project-backup.mjs')).restoreBackupFile(found.file); return { id: r.id, name: r.name, pdfs: r.files }; }
  const byPath = new Map([...files].map(f => [pathOf(f), f]));
  const data = normalizeProject(portableState(parseProject(await found.file.text())), { source: `${found.root}/.lykos/project.json` });
  delete data.saveToken;
  // Each PDF the folder holds is fingerprinted first: the record carries the hash of the bytes copied (a PDF is read by that hash), and
  // the copy is stored under the new project, never the open one, once the project exists.
  const papers = data.papers || [], toCopy = [];
  data.papers = [];
  for (const p of papers) {
    const file = p.pdfRel ? byPath.get(under(found.root, p.pdfRel)) : null;
    const copy = { ...p };
    if (file) { copy.pdf = true; copy.pdfHash = await documentHash(await file.arrayBuffer()); toCopy.push([p.id, file, copy.pdfHash]); onFile(file.name); }
    else if (p.pdfRel || copy.pdfMode === 'link' || copy.pdfMode === 'folder') { copy.pdf = null; delete copy.pdfHash; }
    delete copy.pdfRel; if (copy.pdfMode === 'link' || copy.pdfMode === 'folder') delete copy.pdfMode;
    data.papers.push(copy);
  }
  const name = String(data.project?.name || found.name).slice(0, 160);
  const id = await projects.addAppProject(data, name);
  let pdfs = 0;
  for (const [paperId, file, hash] of toCopy) {
    if (await putFile(paperId, file, { owner: projects.appBackend(id).channel }) !== hash) throw new Error(`the PDF of ${paperId} changed while it was copied`);
    pdfs++; onFile(file.name);
  }
  const owner = projects.appBackend(id).channel, figures = idbFigureStore(owner);
  const dir = `${under(found.root, '.lykos')}/`;
  for (const [p, f] of byPath) {
    if (!p.startsWith(dir)) continue;
    const rest = p.slice(dir.length), fig = /^figures\/([0-9a-f]+)\.svg$/.exec(rest);
    if (fig && isFigureHash(fig[1])) await figures.put(fig[1], await f.text());
  }
  const sidecars = [];
  for (const s of Object.values(SIDECARS)) { const f = byPath.get(`${dir}${s.file}`); if (f) sidecars.push({ name: s.name, text: await f.text() }); }
  if (sidecars.length) await restoreSidecars(sidecars, owner, id);
  return { id, name, pdfs };
}

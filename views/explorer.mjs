// Explorer: the project folder as it is on disk, in the sidebar.
//
// Folders load when they are opened, one level at a time, so a folder of
// thousands of files costs nothing until someone looks inside it. What is
// open is re-listed every few seconds while the explorer is showing and the
// window is in front, and on focus, so a file saved from Word or dropped in
// by the Finder appears without a refresh button being the only way.
//
// A PDF the library already points at is set heavier; opening it
// opens the reader beside the current work. Anything else opens in the File
// view, where what can be done with it is offered by what it is.
import { get, update, subscribe } from '../store.mjs';
import { currentId } from '../lib/projects.mjs';
import { filesFolder, addOpenedFolder, needsFolderInput, removeOpenedFolder, isOpenedFolder, isFolderRoot, displayFilePath } from '../lib/open-folders.mjs';
import { join, parentOf, baseName, extOf, validName, freeName } from '../lib/fsys.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { ask, confirmAsk, formDialog } from '../lib/dialog.mjs';
import { formField } from '../lib/ui-components.mjs';
import { applyOrganise } from '../lib/project-folder.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
// Library and Manuscript load when one of their actions is chosen from the tree.
const library = () => import('./library.mjs'), manuscript = () => import('./manuscript.mjs');
import { copyText } from '../lib/clipboard.mjs';
import { pollFolder } from '../lib/folder-poll.mjs';
import * as ipd from '../lib/ipd.mjs';
import { IMAGE_EXT } from '../lib/image-view.mjs';
import { explorerLoaded } from '../lib/explorer-mount.mjs';

/** The drag type of rows dragged from the folder page: a JSON list of paths. */
export const PATHS = 'application/x-lykos-paths';
const RECORDS = new Set(['ris', 'bib', 'bibtex', 'nbib', 'enw', 'json']);
const TABLES = new Set(['csv', 'tsv']);
const MANUSCRIPTS = new Set(['docx', 'md', 'markdown']);

let host = null, opts = null;
let listing = new Map();         // rel -> entries, for every folder loaded
let expanded = new Set();
let selected = '';
export const selectedFile = () => selected && !findEntry(selected)?.dir ? selected : '';
let showHidden = false;
try { showHidden = localStorage.getItem('lykos.files.hidden') === '1'; } catch {}
/** Whether names that start with a dot (and Office lock files) are listed. One choice for the tree and the folder page. */
export const hiddenShown = () => showHidden;
export function showHiddenFiles(on) {
  showHidden = !!on;
  try { localStorage.setItem('lykos.files.hidden', showHidden ? '1' : '0'); } catch {}
  fileCache = null; draw();
}
let poll = null;
const expandKey = () => `lykos.tree.${currentId()}`;

/** The library record whose PDF is this file, if any. */
export function paperAt(rel) { if (isOpenedFolder(rel)) return null; return get().papers.find(p => p.pdfRel === rel) || null; }
export const kindOf = rel => {
  const x = extOf(rel);
  if (x === 'pdf') return 'pdf';
  if (RECORDS.has(x)) return 'records';
  if (TABLES.has(x)) return 'table';
  if (MANUSCRIPTS.has(x)) return 'manuscript';
  if (IMAGE_EXT.includes(x)) return 'image';
  if (['txt', 'r', 'py', 'log', 'yaml', 'yml', 'xml', 'tex', 'sh', 'do', 'sas', 'sps'].includes(x)) return 'text';
  return 'other';
};

export function mount(el, o) {
  host = el; opts = o;
  try { expanded = new Set(JSON.parse(localStorage.getItem(expandKey()) || '[""]')); } catch { expanded = new Set(['']); }
  expanded.add('');
  el.tabIndex = 0;
  el.setAttribute('role', 'tree');
  el.setAttribute('aria-label', 'Workspace files');
  el.onclick = onClick;
  // A double press keeps the preview tab the first press opened.
  el.ondblclick = e => { const row = e.target.closest('.tree-row'); if (row && !row.dataset.dir && !e.target.closest('.tree-tw')) openEntry(row.dataset.rel); };
  el.oncontextmenu = onContext;
  el.onkeydown = onKey;
  wireDrag(el);
  addEventListener('focus', () => visible() && refresh());
  // Store updates arrive per keystroke; the tree looks at them once a frame.
  let queued = false;
  subscribe(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (visible()) draw(); });
  });
  return refresh();
}

const visible = () => host && !host.hidden && document.visibilityState === 'visible';

export function setVisible(on) {
  poll?.(); poll = null;
  if (!host) return;
  host.hidden = !on;
  if (on) { refresh(); poll = pollFolder(() => visible() && refresh()); }
}

function saveExpanded() { try { localStorage.setItem(expandKey(), JSON.stringify([...expanded])); } catch {} }

/** Re-lists every open folder; repaints only if something changed. */
export async function refresh() {
  const folder = filesFolder();
  if (!host) return;
  if (!folder) { draw(); return; }
  for (const rel of [...expanded]) {
    let rows;
    try { rows = await folder.list(rel); }
    catch { expanded.delete(rel); listing.delete(rel); continue; }
    const sig = r => r.map(e => `${e.name}|${e.dir}|${e.size}|${e.mtime}`).join('\n');
    if (!listing.has(rel) || sig(listing.get(rel)) !== sig(rows)) { listing.set(rel, rows); }
  }
  for (const rel of [...listing.keys()]) if (!expanded.has(rel)) listing.delete(rel);
  draw();
}

// Office writes ~$name beside a document it has open: a lock, not a file.
export const junk = name => name.startsWith('.') || name.startsWith('~$') || name === 'Thumbs.db' || name === 'desktop.ini';
const hidden = e => !showHidden && junk(e.name);

function rows() {
  const out = [];
  (function walk(rel, depth) {
    for (const e of listing.get(rel) || []) {
      if (hidden(e)) continue;
      out.push({ ...e, depth });
      if (e.dir && expanded.has(e.rel)) walk(e.rel, depth + 1);
    }
  })('', 0);
  return out;
}

// What the tree shows, as one string. The tree is redrawn only when this
// changes: a redraw replaces every row, and one between a press and its
// release swallows the click — which the constant project updates of a
// running job made happen often enough that the buttons seemed dead.
let drawn = '';
// A folder's listing is replaced, never edited, so its part of the key is kept per array.
const listingKeys = new WeakMap();
const listingKey = v => {
  let k = listingKeys.get(v);
  if (k === undefined) { k = v.map(e => `${e.name}${e.dir ? '/' : ''}`).join(','); listingKeys.set(v, k); }
  return k;
};
const shownKey = () => {
  const folder = filesFolder();
  let libs = '';
  for (const p of get().papers) if (p.pdfRel) libs += `${p.pdfRel}=${p.label}|`;
  return [folder ? folder.name : '-', selected, showHidden, [...expanded].join(','),
    [...listing].map(([k, v]) => `${k}:${listingKey(v)}`).join(';'), libs].join('\n');
};

function draw({ force = false } = {}) {
  if (!host) return;
  const key = shownKey();
  if (!force && key === drawn && host.firstChild) return;
  drawn = key;
  const folder = filesFolder();
  const keepScroll = host.querySelector('.tree-body')?.scrollTop || 0;
  if (!folder) {
    host.removeAttribute('aria-activedescendant');
    host.innerHTML = `<div class="tree-head">${treeHeadBar([])}</div>
      <div class="tree-none">
        ${folderPicker(false)}
        <button id="tree-open-file">${icon('file')}<span>Open file</span></button>
      </div>`;
    wireFolderPicker();
    host.querySelector('#tree-open-file').onclick = () => opts.openFile();
    return;
  }
  const byRel = new Map(get().papers.filter(p => p.pdfRel).map(p => [p.pdfRel, p]));
  const list = rows();
  host.innerHTML = `<div class="tree-head">${treeHeadBar(headActs())}
      ${needsFolderInput() ? '<input type="file" webkitdirectory multiple data-folder-input hidden aria-label="Add folder">' : ''}
    </div>
    <div class="tree-body" data-rel="">${list.map(e => {
      const paper = !e.dir && byRel.get(e.rel);
      return `<div class="tree-row${e.rel === selected ? ' sel' : ''}${paper ? ' in-lib' : ''} ui-indent" role="treeitem"
        id="tree-entry-${esc(encodeURIComponent(e.rel))}" data-rel="${esc(e.rel)}" data-dir="${e.dir ? 1 : ''}" draggable="true" aria-level="${e.depth + 1}"
        ${e.dir ? `aria-expanded="${expanded.has(e.rel)}"` : ''} aria-selected="${e.rel === selected}"
        style="--depth:${e.depth};--ui-indent-base:var(--s2)" title="${esc(paper ? `${displayFilePath(e.rel)}: ${paper.label}` : displayFilePath(e.rel))}">
        ${e.dir ? `<button class="tree-tw" tabindex="-1" aria-label="${expanded.has(e.rel) ? 'Collapse' : 'Expand'} ${esc(e.name)}">${icon(expanded.has(e.rel) ? 'chevron-down' : 'chevron-right', { size: 12 })}</button>` : '<span class="tree-tw"></span>'}
        ${icon(e.dir ? 'folder' : iconFor(e.rel))}
        <span class="tree-label">${esc(e.name)}</span>
      </div>`;
    }).join('')}</div>`;
  const body = host.querySelector('.tree-body');
  if (!list.some(e => e.rel === selected)) selected = list[0]?.rel || '';
  select(selected);
  wireFolderPicker();
  body.scrollTop = keepScroll;
}

/**
 * What the head's More offers, from the selection now: the folder the selection is in, and the top of the opened folder it belongs to (each a page of
 * its files in the main pane), then the commands that do not depend on it. Each entry is { id, label, checked?, run }; the head bar draws them as its
 * overflow (the engine's More), and a click on one lands in headClick.
 */
function headActs() {
  const list = rows(), canWrite = !!filesFolder(dirOf(selected))?.can.write;
  const sel = selected, here = !sel ? '' : (list.find(x => x.rel === sel)?.dir ? sel : dirOf(sel));
  let top = here; while (top && !isFolderRoot(top) && parentOf(top) && parentOf(top) !== top) top = parentOf(top);
  const root = list.find(x => x.depth === 0)?.rel || '';
  const topRel = top && isFolderRoot(top) ? top : root;
  return [
    topRel && { id: 'tree-open-main', label: 'Open main folder', run: () => openEntry(topRel, { dir: true }) },
    here && here !== topRel && { id: 'tree-open-here', label: 'Open this folder', run: () => openEntry(here, { dir: true }) },
    (topRel || here) && '-',
    { id: 'tree-open-file', label: 'Open file…', run: () => opts.openFile() },
    canWrite && { id: 'tree-new-folder', label: 'New folder', run: () => newFolder(dirOf(selected)) },
    { id: 'tree-add-folder', label: 'Add folder to workspace…', run: () => { const input = host.querySelector('[data-folder-input]'); if (input) input.click(); else openFolder(); } },
    { id: 'tree-collapse', label: 'Collapse all', run: () => { expanded = new Set(['']); saveExpanded(); refresh(); draw(); } },
    '-',
    { id: 'tree-hidden', label: 'Show hidden files', checked: showHidden, run: () => showHiddenFiles(!showHidden) },
  ].filter(Boolean);
}
let headRuns = new Map(), headKey = '';
/** The files head: one head bar (title, More). Its More's entries depend on the selection, so the bar is drawn again when they change (select). */
function treeHeadBar(acts) {
  headRuns = new Map(acts.filter(a => a !== '-').map(a => [a.id, a.run]));
  headKey = acts.map(a => a === '-' ? '-' : `${a.id}:${a.checked ?? ''}`).join('|');
  return uiBar({ kind: 'head', label: 'Files', id: 'tree-bar', density: 'dense', plainMore: true, lead: { title: 'Files', level: 'p', id: 'tree-name' },
    overflow: acts.map(a => a === '-' ? a : { id: a.id, label: a.label, ...(a.checked != null ? { checked: a.checked } : {}) }) });
}
function headSync() {
  const bar = host.querySelector('#tree-bar'); if (!bar || !filesFolder()) return;
  const acts = headActs();
  if (acts.map(a => a === '-' ? '-' : `${a.id}:${a.checked ?? ''}`).join('|') === headKey) { headRuns = new Map(acts.filter(a => a !== '-').map(a => [a.id, a.run])); return; }
  bar.outerHTML = treeHeadBar(acts);
}

function folderPicker(compact) {
  const button = `<button class="${compact ? 'icon' : ''}" data-add-folder title="Add folder" aria-label="Add folder">${icon('folder-plus')}${compact ? '' : '<span>Add folder</span>'}</button>`;
  return needsFolderInput() ? `${button}<input type="file" webkitdirectory multiple data-folder-input hidden aria-label="Add folder">` : button;
}
function wireFolderPicker() {
  const input = host.querySelector('[data-folder-input]');
  if (input) input.onchange = () => { const files = [...input.files]; input.value = ''; openFolder(files); };
  host.querySelector('[data-add-folder]')?.addEventListener('click', () => { if (input) input.click(); else openFolder(); });
}
export async function openFolder(files = null) {
  try {
    const root = await addOpenedFolder(files); if (!root) return;
    expanded.add(''); expanded.add(root.id); fileCache = null;
    await refresh(); draw({ force: true }); select(root.id);
    opts.say(root.folder.download ? 'Folder opened for this session. Edits save as copies.' : 'Folder added');
  } catch (error) { opts.say(`Could not open folder: ${error.message}`); }
}

function iconFor(rel) {
  return { pdf: 'file-pdf', records: 'library', table: 'table', manuscript: 'file-word', image: 'image' }[kindOf(rel)] || 'file';   // a Word file is a document, as in the folder page (not the pencil of editing)
}

/** The folder something is in, or the folder itself. */
function dirOf(rel) {
  if (!rel) return '';
  const e = findEntry(rel);
  return e?.dir ? rel : parentOf(rel);
}
function findEntry(rel) {
  for (const list of listing.values()) { const e = list.find(x => x.rel === rel); if (e) return e; }
  return null;
}

// ---- interaction -----------------------------------------------------------
function onClick(e) {
  const act = e.target.closest('#tree-bar button[id]');
  if (act && headRuns.has(act.id)) { headRuns.get(act.id)(); return; }
  const row = e.target.closest('.tree-row');
  if (!row) return;
  clearTimeout(previewT);
  host.focus({ preventScroll: true });
  select(row.dataset.rel);
  if (row.dataset.dir && e.target.closest('.tree-tw')) { toggle(row.dataset.rel); return; }
  if (row.dataset.dir) toggle(row.dataset.rel, true);
  // The disclosure control expands; the name shows the folder or file in a preview tab (the next one replaces it).
  openEntry(row.dataset.rel, { preview: true, dir: !!row.dataset.dir, side: e.altKey });
}

/** Selects an entry in the tree, opening its folders, as the grid view moves. */
export function reveal(rel) {
  for (let p = parentOf(rel); p; p = parentOf(p)) expanded.add(p);
  saveExpanded(); refresh().then(() => select(rel));
}

function select(rel) {
  selected = rel;
  if (rel) host.setAttribute('aria-activedescendant', `tree-entry-${encodeURIComponent(rel)}`);
  else host.removeAttribute('aria-activedescendant');
  host.querySelectorAll('.tree-row').forEach(r => {
    const on = r.dataset.rel === rel;
    r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on));
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
  headSync();
}

function toggle(rel, open = !expanded.has(rel)) {
  if (open) expanded.add(rel); else expanded.delete(rel);
  saveExpanded();
  if (open) refresh(); else draw();
}

/** Opens an entry in the Files view, as a tab: `preview` for a tab the next preview replaces, `dir` for a folder, `side` for the other group. A PDF in the library opens in the reader there. */
export function openEntry(rel, how = {}) { opts.showFile(rel, how); }

// Moving through the tree with the keys shows each file as it is reached, once
// the keys pause, so holding an arrow does not open every file on the way.
let previewT = null;
function preview(rel) {
  clearTimeout(previewT);
  previewT = setTimeout(() => { if (selected === rel) openEntry(rel, { preview: true, dir: !!findEntry(rel)?.dir }); }, 160);
}

function onKey(e) {
  if (e.target.closest('input,textarea')) return;
  const list = rows();
  const i = list.findIndex(x => x.rel === selected);
  const cur = list[i];
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { select(next.rel); preview(next.rel); }
  } else if (e.key === 'ArrowRight' && cur?.dir) { e.preventDefault(); e.stopPropagation(); toggle(cur.rel, true); }
  else if (e.key === 'ArrowLeft' && cur) {
    e.preventDefault(); e.stopPropagation();
    if (cur.dir && expanded.has(cur.rel)) toggle(cur.rel, false);
    else if (parentOf(cur.rel)) select(parentOf(cur.rel));
  } else if (e.key === 'Enter' && cur) {
    e.preventDefault(); e.stopPropagation();
    if (cur.dir) { toggle(cur.rel); openEntry(cur.rel, { dir: true }); } else openEntry(cur.rel, { side: e.altKey });
  } else if (e.key === 'F2' && cur && filesFolder(cur.rel)?.can[cur.dir ? 'renameDir' : 'rename']) { e.preventDefault(); renameEntry(cur.rel); }
  else if (mod && e.key === 'Backspace' && cur && !isFolderRoot(cur.rel) && filesFolder(cur.rel)?.can.trash) { e.preventDefault(); trashEntry(cur.rel); }
}

function onContext(e) {
  e.preventDefault();
  const row = e.target.closest('.tree-row');
  if (row) select(row.dataset.rel);
  const rel = row?.dataset.rel || '';
  const items = row ? (row.dataset.dir ? folderItems(rel) : fileItems(rel)) : folderItems('');
  showMenu({ x: e.clientX, y: e.clientY }, items);
}

// ---- what can be done with an entry --------------------------------------
/** Commands for a file, by what it is. Shared with the File view. */
export function fileItems(rel) {
  const folder = filesFolder(rel); if (!folder) return [];
  const k = kindOf(rel), paper = k === 'pdf' && paperAt(rel);
  const say = opts.say;
  const asFile = async () => new File([await folder.read(rel)], baseName(rel));
  return [
    { label: 'Open', icon: 'file', run: () => openEntry(rel) },
    { label: 'Open to the side', icon: 'split', run: () => openEntry(rel, { side: true }) },
    k === 'pdf' && !paper && !isOpenedFolder(rel) && { label: 'Add to library', icon: 'library', run: async () => {
      const p = await (await library()).addFolderPdfs([rel], say).catch(err => { say(err.message); return null; });
      opts.changed(); if (p) opts.openDocument(p.id);
    } },
    k === 'records' && { label: 'Import records', icon: 'import', run: async () => { await (await library()).importRecords(await asFile(), say, { rel }); opts.changed(); } },
    k === 'table' && { label: 'Import patient data', icon: 'import', run: async () => {
      const { added, columns } = ipd.fromCsv(new TextDecoder().decode(await folder.read(rel)));
      say(`${added} patients${columns ? `, ${columns} new columns` : ''}`); opts.changed();
    } },
    k === 'manuscript' && { label: 'Open as manuscript', icon: 'manuscript', run: async () => { await (await manuscript()).importManuscript(await asFile(), say); opts.changed(); } },
    '-',
    folder.can.openExternal && { label: 'Open in default app', icon: 'open', run: () => folder.openExternal(rel).catch(err => say(err.message)) },
    folder.can.reveal && { label: 'Reveal in Finder', icon: 'folder', run: () => folder.reveal(rel).catch(err => say(err.message)) },
    { label: 'Copy path', icon: 'copy', run: () => copyPath(rel) },
    '-',
    folder.can.rename && { label: 'Rename', icon: 'manuscript', meta: 'F2', run: () => renameEntry(rel) },
    folder.can.trash && { label: 'Move to Trash', icon: 'trash', meta: '⌘⌫', danger: true, run: () => trashEntry(rel) },
  ].filter(Boolean);
}

export function folderItems(rel) {
  const folder = filesFolder(rel); if (!folder) return [];
  const say = opts.say;
  const root = isFolderRoot(rel);
  const remove = { label: 'Remove folder from Files', icon: 'close', run: async () => { if (await opts.canCloseFolder?.(rel) === false) return; removeOpenedFolder(rel); opts.moved?.(rel, null); selected = ''; expanded.delete(rel); listing.clear(); expanded.add(''); fileCache = null; refresh(); draw({ force: true }); } };
  return [
    rel && { label: 'Open', icon: 'folder', run: () => openEntry(rel, { dir: true }) },
    folder.can.write && { label: 'New folder', icon: 'folder-plus', run: () => newFolder(rel) },
    folder.can.write && { label: 'Add files', icon: 'import', run: () => addFiles(rel) },
    !isOpenedFolder(rel) && { label: 'Add PDFs to library', icon: 'library', run: async () => {
      const rels = await pdfsUnder(rel);
      if (!rels.length) { say('No PDFs outside the library in this folder'); return; }
      await (await library()).addFolderPdfs(rels, say).catch(err => say(err.message)); opts.changed();
    } },
    '-',
    folder.can.reveal && { label: 'Reveal in Finder', icon: 'folder', run: () => folder.reveal(rel).catch(err => say(err.message)) },
    { label: 'Copy path', icon: 'copy', run: () => copyPath(rel) },
    { label: 'Show hidden files', checked: showHidden, run: () => showHiddenFiles(!showHidden) },
    rel && '-',
    root && remove,
    rel && !root && folder.can.renameDir && { label: 'Rename', icon: 'manuscript', meta: 'F2', run: () => renameEntry(rel) },
    rel && !root && folder.can.trash && { label: 'Move to Trash', icon: 'trash', meta: '⌘⌫', danger: true, run: () => trashEntry(rel) },
  ].filter(Boolean);
}

/**
 * Every file in the project folder, for the command palette: hidden entries
 * skipped, depth and count capped so a folder that happens to hold a whole
 * disk does not stall the palette. Kept for a short while between openings.
 */
let fileCache = null;
export async function allFiles({ max = 5000 } = {}) {
  const folder = filesFolder();
  if (!folder) return [];
  if (fileCache && fileCache.folder === folder && Date.now() - fileCache.at < 20000) return fileCache.list;
  const out = [];
  async function walk(r, depth) {
    if (depth > 8 || out.length >= max) return;
    let rows = [];
    try { rows = await folder.list(r); } catch { return; }
    for (const e of rows) {
      if (out.length >= max) return;
      if (junk(e.name)) continue;
      if (e.dir) await walk(e.rel, depth + 1); else out.push(e.rel);
    }
  }
  await walk('', 0);
  fileCache = { folder, at: Date.now(), list: out };
  return out;
}

/** Every PDF below a folder that the library does not point at yet. */
async function pdfsUnder(rel) {
  const folder = filesFolder(), out = [];
  const known = new Set(get().papers.map(p => p.pdfRel).filter(Boolean));
  async function walk(r, depth) {
    if (depth > 8) return;
    for (const e of await folder.list(r)) {
      if (junk(e.name)) continue;
      if (e.dir) await walk(e.rel, depth + 1);
      else if (extOf(e.name) === 'pdf' && !known.has(e.rel)) out.push(e.rel);
    }
  }
  await walk(rel, 0);
  return out;
}

export async function copyPath(rel) {
  const folder = filesFolder();
  const text = folder.abs(rel);
  opts.say(await copyText(text) ? 'Path copied' : text);
}

async function newFolder(inRel) {
  const folder = filesFolder();
  const name = validName(await ask('New folder', { placeholder: 'Name', confirm: 'Create' }));
  if (!name) return;
  const rel = join(inRel, name);
  try { await folder.mkdir(rel); } catch (err) { opts.say(err.message); return; }
  expanded.add(inRel); saveExpanded();
  await refresh(); select(rel);
}

async function renameEntry(rel) {
  const folder = filesFolder();
  const name = validName(await ask('Rename', { value: baseName(rel), confirm: 'Rename' }));
  if (!name || name === baseName(rel)) return;
  await moveEntry(rel, join(parentOf(rel), name));
}

/**
 * Renames or moves, then points every record that named the old path at the
 * new one. A folder carries everything under it, so prefixes move too.
 */
async function moveEntry(from, to) {
  const folder = filesFolder();
  if (to === from || to.startsWith(`${from}/`)) return;
  try { await folder.rename(from, to); } catch (err) { opts.say(err.message); return; }
  followRecords(from, to);
  const moved = [...expanded].filter(x => x === from || x.startsWith(`${from}/`));
  for (const x of moved) { expanded.delete(x); expanded.add(to + x.slice(from.length)); }
  saveExpanded();
  await refresh(); select(to);
  opts.moved?.(from, to);
}

/** The records that name a path follow it to its new one (a PDF the library points at, a folder's PDFs). */
function followRecords(from, to) {
  update(s => {
    let n = 0;
    for (const p of s.papers) {
      if (p.pdfRel === from) { p.pdfRel = to; p.pdfName = baseName(to); n++; }
      else if (p.pdfRel?.startsWith(`${from}/`)) { p.pdfRel = to + p.pdfRel.slice(from.length); n++; }
    }
    return n ? s : null;
  });
}

/** A new name for an entry, from the page's own inline field (no dialog). Resolves to whether it was renamed. */
export async function renameTo(rel, name) {
  const next = validName(name);
  if (!next || next === baseName(rel)) return false;
  const folder = filesFolder(rel);
  if (!folder || (await folder.stat(join(parentOf(rel), next))).exists) { opts.say(`${next} is already there`); return false; }
  await moveEntry(rel, join(parentOf(rel), next));
  return true;
}

/** Several entries to the Trash after one question; the records that name them keep their place. */
export async function trashEntries(rels) {
  if (!rels.length) return false;
  if (rels.length === 1) { await trashEntry(rels[0]); return true; }
  const papers = rels.map(paperAt).filter(Boolean);
  // the question names what goes (the first four, then how many more), and what the records keep
  const names = rels.slice(0, 4).map(baseName).join(', ') + (rels.length > 4 ? ` and ${rels.length - 4} more` : '');
  if (!await confirmAsk(`Move ${rels.length} items to the Trash?`, { detail: `${names}.${papers.length ? ` ${papers.length} of them ${papers.length === 1 ? 'is a PDF a record points at' : 'are PDFs records point at'}; the records stay.` : ''}`, confirm: 'Move to Trash', danger: true })) return false;
  const folder = filesFolder();
  let failed = 0;
  for (const rel of rels) { try { await folder.trash(rel); opts.moved?.(rel, null); } catch (err) { failed++; opts.say(err.message); } }
  selected = '';
  await refresh();
  if (!failed) opts.say(`${rels.length} items moved to the Trash`);
  return true;
}

/**
 * Moves entries into a folder. In the project's own folder the moves are written to the organise log (.lykos/organise), so the Folder view's Undo puts
 * them back; in a folder opened for the session each is a plain rename. A name already there is not overwritten. Resolves to what moved.
 */
export async function moveInto(rels, target) {
  const moved = [];
  const pick = rels.filter(r => r && target !== parentOf(r) && target !== r && !target.startsWith(`${r}/`));
  const project = pick.filter(r => !isOpenedFolder(r) && !isOpenedFolder(target));
  const plan = { creates: [], moves: [] };
  for (const from of project) {
    const to = join(target, baseName(from));
    if ((await filesFolder(from).stat(to)).exists) { opts.say(`${baseName(from)} is already in that folder`); continue; }
    plan.moves.push({ from, to, dir: !!findEntry(from)?.dir });
  }
  if (plan.moves.length) {
    const r = await applyOrganise(filesFolder(''), plan, { onMoved: (a, b) => { followRecords(a, b); moved.push([a, b]); opts.moved?.(a, b); } });
    for (const f of r.failed) opts.say(f.error);
  }
  for (const from of pick.filter(r => !project.includes(r))) {
    const to = join(target, baseName(from));
    try {
      if ((await filesFolder(target).stat(to)).exists) { opts.say(`${baseName(from)} is already in that folder`); continue; }
      await filesFolder(from).rename(from, to); followRecords(from, to); moved.push([from, to]); opts.moved?.(from, to);
    } catch (err) { opts.say(err.message); }
  }
  if (moved.length) { expanded.add(target); saveExpanded(); await refresh(); opts.say(`${moved.length === 1 ? baseName(moved[0][0]) : `${moved.length} items`} moved to ${baseName(target) || 'the top folder'}`); }
  return moved;
}

/** A copy beside the file, with the first name not taken ("name 2.ext"). */
export async function duplicateEntry(rel) {
  const folder = filesFolder(rel);
  try {
    const to = await freeName(folder, rel);
    if ((await folder.stat(rel)).dir) { opts.say('A folder cannot be duplicated here'); return ''; }
    await folder.writeBytes(to, await folder.read(rel));
    await refresh(); opts.changed?.();
    return to;
  } catch (err) { opts.say(err.message); return ''; }
}

/** The names of what is chosen, one per line, to the clipboard. */
export async function copyName(rels) {
  const text = rels.map(baseName).join('\n');
  opts.say(await copyText(text) ? (rels.length === 1 ? 'Name copied' : `${rels.length} names copied`) : text);
}

/** A zip of the chosen files and folders, saved beside the first of them under the first name not taken (Archive.zip, or the one name when one item is chosen). Resolves to its path, or ''. */
export async function compressEntries(rels) {
  const folder = filesFolder(rels[0]);
  if (!folder || !rels.length) return '';
  try {
    const entries = [];
    const add = async (rel, as, depth = 0) => {
      const info = await folder.stat(rel);
      if (!info.dir) { entries.push({ name: as, data: await folder.read(rel) }); return; }
      if (depth > 8) return;
      for (const e of await folder.list(rel)) { if (!junk(e.name)) await add(e.rel, `${as}/${e.name}`, depth + 1); }
    };
    for (const rel of rels) await add(rel, baseName(rel));
    if (!entries.length) { opts.say('Nothing to compress'); return ''; }
    const { zip } = await import('../lib/zip.mjs');
    const blob = await zip(entries);
    const parent = parentOf(rels[0]), stem = rels.length === 1 ? baseName(rels[0]).replace(/\.[^.]+$/, '') : 'Archive';
    const to = await freeName(folder, join(parent, `${stem}.zip`));
    await folder.writeBytes(to, new Uint8Array(await blob.arrayBuffer()));
    await refresh(); opts.changed?.();
    opts.say(`Compressed ${entries.length === 1 ? '1 file' : `${entries.length} files`} to ${baseName(to)}`);
    return to;
  } catch (err) { opts.say(err.message); return ''; }
}

/** Copies of files into a folder (⌘C then ⌘V in the folder page), each under the first name not taken there; folders are not copied. Resolves to the new paths. */
export async function copyInto(rels, target) {
  const out = [], to = filesFolder(target);
  if (!to) return out;
  for (const rel of rels) {
    try {
      const from = filesFolder(rel);
      if ((await from.stat(rel)).dir) { opts.say('A folder cannot be copied here'); continue; }
      const dest = await freeName(to, join(target, baseName(rel)));
      await to.writeBytes(dest, await from.read(rel)); out.push(dest);
    } catch (err) { opts.say(err.message); }
  }
  if (out.length) { await refresh(); opts.changed?.(); }
  return out;
}

/** The folders below a folder (to a depth), for a "Move to" list: `[{ rel, label }]`, the top first. */
export async function foldersBelow(root = '', { depth = 3, max = 400 } = {}) {
  const folder = filesFolder(root), out = [{ rel: root, label: root ? baseName(displayFilePath(root)) : 'Top folder' }];
  if (!folder) return out;
  const queue = [[root, 0]];
  while (queue.length && out.length < max) {
    const [dir, d] = queue.shift();
    let rows = []; try { rows = await folder.list(dir); } catch { continue; }
    for (const e of rows) if (e.dir && !junk(e.name)) { out.push({ rel: e.rel, label: displayFilePath(e.rel).split('/').slice(-(d + 2)).join(' / ') }); if (d + 1 < depth) queue.push([e.rel, d + 1]); }
  }
  return out;
}
/** Asks which folder, with the app's own dialog. Resolves to a folder path or null. */
export async function askFolder(title, { exclude = [] } = {}) {
  const list = (await foldersBelow('')).filter(f => !exclude.some(x => f.rel === x || f.rel.startsWith(`${x}/`)));
  return formDialog({ id: 'explorer-move', title, tier: 'S', confirm: 'Move',
    body: formField('Folder', `<select name="folder">${list.map((f, i) => `<option value="${i}">${esc(f.label)}</option>`).join('')}</select>`),
    submit: form => list[Number(form.elements.folder.value)]?.rel ?? null });
}

async function trashEntry(rel) {
  const folder = filesFolder();
  const paper = paperAt(rel);
  if (!await confirmAsk(`Move ${baseName(rel)} to the Trash?`,
    { detail: paper ? `${paper.label} keeps its record; its PDF will be missing` : '', confirm: 'Move to Trash', danger: true })) return;
  try { await folder.trash(rel); } catch (err) { opts.say(err.message); return; }
  if (selected === rel) selected = '';
  await refresh();
  opts.moved?.(rel, null);
}

/** Copies files chosen with the system picker into a folder of the project. */
function addFiles(inRel) {
  const i = document.createElement('input');
  i.type = 'file'; i.multiple = true;
  i.onchange = () => copyIn([...i.files], inRel);
  i.click();
}

async function copyIn(files, inRel) {
  const folder = filesFolder();
  let n = 0;
  for (const f of files) {
    try {
      const rel = await freeName(folder, join(inRel, f.name));
      await folder.writeBytes(rel, new Uint8Array(await f.arrayBuffer())); n++;
    } catch (err) { opts.say(`${f.name}: ${err.message}`); }
  }
  expanded.add(inRel); saveExpanded();
  await refresh();
  if (n) opts.say(`${n} ${n === 1 ? 'file' : 'files'} added`);
}

// ---- drag and drop ---------------------------------------------------------
// A row dragged onto a folder moves it there. Files dragged in from outside
// the window are copied into the folder they are dropped on; the originals
// stay where they were.
function wireDrag(el) {
  let dragging = null;
  const targetOf = e => {
    const row = e.target.closest('.tree-row');
    if (!row) return e.target.closest('.tree-body') ? '' : null;
    return row.dataset.dir ? row.dataset.rel : parentOf(row.dataset.rel);
  };
  el.addEventListener('dragstart', e => {
    const row = e.target.closest('.tree-row'); if (!row) return;
    if (!filesFolder(row.dataset.rel)?.can[row.dataset.dir ? 'renameDir' : 'rename']) { e.preventDefault(); return; }
    dragging = row.dataset.rel;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.rel);
  });
  el.addEventListener('dragend', () => { dragging = null; mark(null); });
  el.addEventListener('dragover', e => {
    const t = targetOf(e);
    if (t === null || !filesFolder(t)?.can.write || (!dragging && !e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(PATHS))) return;
    if (dragging && (t === dragging || t.startsWith(`${dragging}/`))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragging ? 'move' : 'copy';
    mark(t);
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) mark(null); });
  el.addEventListener('drop', async e => {
    const t = targetOf(e);
    mark(null);
    if (t === null || !filesFolder(t)?.can.write) return;
    e.preventDefault();
    if (dragging) {
      const from = dragging; dragging = null;
      if (parentOf(from) !== t) await moveEntry(from, join(t, baseName(from)));
    } else if (e.dataTransfer.types.includes(PATHS)) {
      let rels = []; try { rels = JSON.parse(e.dataTransfer.getData(PATHS)); } catch {}
      await moveInto(rels, t);
    } else if (e.dataTransfer.files.length) await copyIn([...e.dataTransfer.files], t);
  });
  function mark(rel) {
    el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    if (rel === null) return;
    if (rel === '') el.querySelector('.tree-body')?.classList.add('drop');
    else el.querySelector(`.tree-row[data-rel="${CSS.escape(rel)}"]`)?.classList.add('drop');
  }
}

// The shell mounts the tree when this module arrives (lib/explorer-mount.mjs).
explorerLoaded({ mount, setVisible, selectedFile, allFiles, openEntry });

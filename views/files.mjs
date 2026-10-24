// Files: the project's files and folders, open as tabs.
//
// A file opens in a tab with its own tools (views/file-doc.mjs). The folder page (views/file-browser.mjs) is the first tab, pinned and never closed, and
// it has a history: Back, Forward and Up one folder (lib/folder-history.mjs). With no document open there is no strip at all: the head names the folder.
// One click in the explorer shows a file in a preview tab that the next click replaces; a double click, Enter or an edit keeps it. Several documents
// are open at once, and "Open to the side" makes a second group beside the first.
//
// The tabs are a model (lib/file-tabs.mjs); what a tab costs is a policy, not a count: the active tab of each group, every tab with unsaved
// edits and the two tabs used last stay decoded, and the rest are released and read again when they are chosen. The title bar is the page's head
// (page(), lib/topbar.mjs): Back, Forward and Up, the name of what is shown (a menu of the folders above it), the folder's count, List | Grid,
// Find in folder (the filter row, closed until asked for) and the folder's commands (Add files the primary); everything else is in More.
import { createTabs, restoreTabs, mountedTabs } from '../lib/file-tabs.mjs';
import { createHistory, restoreHistory } from '../lib/folder-history.mjs';
import { currentId, activeFolder } from '../lib/projects.mjs';
import { filesFolder, displayFilePath, isFolderRoot } from '../lib/open-folders.mjs';
import { baseName, parentOf } from '../lib/fsys.mjs';
import { uiDocTabs, focusDocTabs, watchWidth } from '../lib/ui-actions.mjs';
import { groupsStack } from '../lib/bar-modes.mjs';
import { wireDocTabs } from '../lib/doc-tabs.mjs';
import { showMenu } from '../lib/menu.mjs';
import { choiceAsk, confirmAsk } from '../lib/dialog.mjs';
import { fileItems, folderItems, paperAt, reveal, allFiles, showHiddenFiles, hiddenShown, openFolder as addFolder, renameTo, trashEntries, moveInto, duplicateEntry, copyInto, compressEntries, copyName, askFolder, copyPath, kindOf, junk } from './explorer.mjs';
import { imageOrder } from '../lib/image-view.mjs';
import { mountDocument, mountToolTab, typeIcon, FILE_KINDS, size as sizeText } from './file-doc.mjs';
import { mountBrowser, readPreferences, writePreferences, previewOf, fileIcon } from './file-browser.mjs';
import { createAssistantFile } from '../lib/assistant-file.mjs';
import { emptyState, esc } from '../lib/html.mjs';
import { get } from '../store.mjs';
import { loadRelations, relationOf as phraseOf } from '../lib/file-relations.mjs';
import { ROLE_NAMES } from '../lib/adoption.mjs';
import { canWriteBack } from '../lib/drift.mjs';
import { openAdopt, openWriteBack, planDifferences, applyDifferences, differencesSection } from './adoption-dialogs.mjs';
import { inspectorActions, uiList, uiRow } from '../lib/ui-actions.mjs';
import { icon } from '../lib/icons.mjs';
import { day, plural } from '../lib/dates.mjs';
import { documentHash, getBytes } from '../lib/files.mjs';
import { pagedList, wirePagedList, EDITOR_PAGE_SIZE } from '../lib/paged-list.mjs';

export const meta = { title: 'Files', icon: 'file', layout: 'flush' };
export const usesDocument = true;

const TABS_KEY = id => `lykos.files.tabs:${id}`;
const BROWSE_KEY = id => `lykos.files.browse:${id}`;
const PICKED = '@file-';

const BROWSER = '@browser';              // the folder page's tab and host
let projectId = null, tabs = createTabs(), history = createHistory(), browserOn = false;
const hosts = new Map();                 // path -> { key, rel, dir, el, inst, live }
const dirty = new Set(), details = new Map();
let count = '';                          // the folder page's count, the title bar's status ("14 items")
const COUNT_CH = 12;
const pickedFolders = new Map(); let pickedCount = 0;
let surface = null, ctxRef = null, restored = false, restoring = false, pendingNote = null, keysOn = false;
const sections = new Map(), stripReleases = new Map();
const scrolls = new Map();
let unwatchSurface = null, divider = null;
let stepping = false, shownKey = null;     // the history is moving the view; the tab last shown (for the history's steps)
const takePlace = rel => { const n = places.get(rel) || 0; places.delete(rel); return n; };
const places = new Map();                // document path -> the page Back or Forward asked for, read when its tab is drawn
const SPLIT_KEY = 'lykos.files.split';
const SEEN_KEY = id => `lykos.files.seen:${id}`;
// What each file is to the project (lib/file-relations.mjs), read once per page and again after anything that changes it; the row selected in a folder page.
let relations = null, relationsRun = null, relationsAgain = false, visitStart = 0, inVisit = false;
const picked = new Map();                // host key -> { rel, dir }

const isPicked = rel => rel.startsWith(PICKED);
const folderFor = rel => pickedFolders.get(rel) || filesFolder(rel);
const labelOf = rel => baseName(displayFilePath(rel)) || filesFolder(rel)?.name || rel;
const say = text => ctxRef?.say?.(text);
/** What the shown group shows: the folder page (the first tab, or alone when no document is open), or a document. */
function activeTab() {
  const first = tabs.groups[0], g = tabs.group(tabs.focus) || first;
  if (!tabs.count() || (g === first && (browserOn || !g.active))) return { rel: history.current(), dir: true, browser: true };
  return { rel: g.active, dir: false };
}
const hostKey = () => { const a = activeTab(); return a.browser ? BROWSER : a.rel; };
const crumbLabel = rel => rel ? labelOf(rel) : (filesFolder('')?.name || 'Files');

// ---- the project's tabs, remembered ---------------------------------------------------------------------------------------------

function ensureProject() {
  const id = currentId();
  if (id === projectId) return;
  for (const h of hosts.values()) retire(h);
  hosts.clear(); dirty.clear(); details.clear(); picked.clear();
  relations = null; inVisit = false; count = ''; compare = null;
  projectId = id; tabs = createTabs(); history = createHistory(); browserOn = false; restored = false; restoring = false; shownKey = null; places.clear();
  startRestore();
}
function persist() {
  if (!projectId || !restored) return;
  const data = tabs.serialize();
  data.groups = data.groups.map(g => ({ ...g, tabs: g.tabs.filter(t => !isPicked(t.rel)) }));
  try { localStorage.setItem(TABS_KEY(projectId), JSON.stringify(data)); localStorage.setItem(BROWSE_KEY(projectId), JSON.stringify(history.serialize())); } catch {}
}
async function startRestore() {
  if (restoring) return;
  restoring = true;
  const id = projectId;
  let raw = null; try { raw = localStorage.getItem(TABS_KEY(id)); } catch {}
  let browse = null; try { browse = localStorage.getItem(BROWSE_KEY(id)); } catch {}
  const old = restoreTabs(raw), wanted = old.paths().filter(r => !old.isDir(r));
  const kept = restoreHistory(browse), folders = [...new Set(kept.rels())].slice(0, 24);
  const ok = new Set(['']);
  await Promise.all([...wanted.slice(0, 24), ...folders].map(async rel => { try { if ((await folderFor(rel)?.stat(rel))?.exists) ok.add(rel); } catch {} }));
  if (id !== projectId) return;
  const next = restoreTabs(raw, rel => ok.has(rel) && !old.isDir(rel));
  // anything opened while the strip was being restored stays
  for (const rel of tabs.paths()) next.show(rel, { dir: tabs.isDir(rel), preview: tabs.isPreview(rel) });
  tabs = next; restored = true; restoring = false;
  if (history.current() === '' && !history.canBack()) history = restoreHistory(browse, { exists: r => ok.has(r) });
  if (next.dropped.length) say(`${next.dropped.length === 1 ? '1 tab was closed:' : `${next.dropped.length} tabs were closed:`} ${next.dropped.length === 1 ? 'the file is' : 'the files are'} no longer there`);
  if (surface?.isConnected) change({ chrome: true });
}

// ---- the view's API ---------------------------------------------------------------------------------------------------------------

/** Opens a path in a tab. `preview` is a tab the next preview replaces, `side` the other group, `dir` a folder. */
export function show(rel, { preview = false, side = false, dir = false, find = '' } = {}) {
  ensureProject();
  if (dir) { navigate(rel || ''); return; }
  if (!rel) return;
  if (find && !dir) {
    // a search hit: the file opens with the text selected where it can be found
    const note = { anchor: { kind: 'text', start: 0, end: find.length, quote: find, prefix: '', suffix: '' }, quiet: true };
    const h = hosts.get(rel);
    if (h?.live && h.inst) h.inst.ready?.then(() => { try { h.inst.reveal?.(note.anchor); } catch {} });
    else pendingNote = { rel, note };
  }
  tabs.show(rel, { preview, side });
  if (tabs.groupOf(rel) === tabs.groups[0].id) browserOn = false;
  change({ chrome: true });
}

// ---- the folder page: Back, Forward, Up one folder --------------------------------------------------------------------------------

/** Shows a folder in the folder page, as a step of its history; the explorer's tree follows. */
function navigate(rel) {
  history.go(rel); browserOn = true;
  tabs.focusGroup(tabs.groups[0].id);
  folderChanged(); change({ chrome: true, reveal: true });
}
/** The folder page lists another folder: the page is read again (the host is kept, its place is not). */
function folderChanged() { const h = hosts.get(BROWSER); if (h) { retire(h); h.rel = history.current(); } picked.delete(BROWSER); details.delete(BROWSER); count = ''; }
/** The page of the PDF a tab shows (null when it is not drawn, a file with no pages, or not a PDF). */
const pageOf = rel => { const n = hosts.get(rel)?.inst?.pdf?.page?.(); return Number.isInteger(n) ? n : null; };
/** What the history stands on is shown: a folder in the folder page, or a document in its tab at the page it was left on (Back and Forward return there). */
function arrive(at) {
  stepping = true;
  try {
    const doc = at && typeof at === 'object' ? at : null;
    if (doc) {
      if (doc.page) places.set(doc.file, doc.page);
      tabs.show(doc.file, { preview: true }); if (tabs.groupOf(doc.file) === tabs.groups[0].id) browserOn = false;
    } else { browserOn = true; folderChanged(); }
    change({ chrome: true, reveal: true });
    // a tab still drawn goes to its page now that it is shown; one drawn later reads the place when it mounts (mountHost)
    const view = doc && hosts.get(doc.file)?.live ? hosts.get(doc.file).inst?.pdf : null;
    if (view && doc.page) { view.go(doc.page); places.delete(doc.file); }
  } finally { stepping = false; }
}
/** A step of the history: the document being left keeps its page first. */
function stepHistory(move) {
  const a = activeTab(); if (!a.browser) history.mark(pageOf(a.rel), a.rel);
  const to = move(); if (to === null) return false;
  arrive(to); return true;
}
export const goBack = () => stepHistory(() => history.goBack());
export const goForward = () => stepHistory(() => history.goForward());
export function goUp() { const a = activeTab(); if (!a.browser) history.mark(pageOf(a.rel), a.rel); if (history.goUp() === null) return false; arrive(history.current()); return true; }
/** The shown tab changed by any other way (a click, a key, an open): a document is a step of the history, the folder page is its folder. */
function track() {
  const a = activeTab(), key = a.browser ? BROWSER : a.rel;
  if (key === shownKey) return;
  const left = shownKey; shownKey = key;
  if (stepping) return;
  if (left && left !== BROWSER && history.entry().file === left) history.mark(pageOf(left), left);
  if (a.browser) history.go(history.current());
  else if (!isPicked(a.rel) && !toolOf(a.rel)) history.visit(a.rel);
}
export const folderShown = () => history.current();
export const canGo = () => ({ back: history.canBack(), forward: history.canForward(), up: history.canUp() });
/** Opens a path for the explorer, the palette and the notes: a click is a preview, anything else keeps its tab. */
export function open(rel, how = {}) { show(rel, how); }
/**
 * A library paper's PDF in a tab (the document pane's Open full size): its file when it is in the project folder, else (a copy the app keeps, a
 * linked file, a preview) a tab for this session that the reader draws from the library, as it draws the docked pane. No bytes are held here.
 */
export function openPaper(p) {
  if (p.pdfRel && activeFolder()) { show(p.pdfRel); return; }
  const held = [...pickedFolders].find(([, f]) => f.paperId === p.id);
  if (held) { show(held[0]); return; }
  const name = (typeof p.pdfName === 'string' && p.pdfName.trim()) || `${String(p.label || 'Document').replace(/[/\\:]+/g, ' ').trim()}.pdf`;
  const rel = `${PICKED}${++pickedCount}/${/\.pdf$/i.test(name) ? name : `${name}.pdf`}`;
  pickedFolders.set(rel, { name: 'Library', paperId: p.id, stat: async () => ({ exists: true, dir: false, size: p.pdfSize || 0, mtime: 0 }), read: async () => getBytes(p.id) });
  show(rel);
}
/** The file shown, or ''. A folder is not a file. */
export const shown = () => { const a = activeTab(); return a && !a.dir ? a.rel : ''; };
export const headerTitle = () => crumbLabel(activeTab().rel);
// Capture both the adapter and path now; changing pages cannot retarget a turn.
export const assistantSource = () => { const rel = shown(); return rel && !toolOf(rel) ? createAssistantFile(folderFor(rel), rel, { name: baseName(displayFilePath(rel)) }) : null; };
export const navigationState = () => ({ file: shown() && !isPicked(shown()) ? shown() : '' });
export function restoreNavigation(state) { if (state?.file) show(state.file); }

/** What the person is looking at: the file shown, and the record it is the PDF of. */
export function focus() {
  const a = activeTab();
  const h = hosts.get(a.browser ? BROWSER : a.rel);
  if (h?.inst?.focus) { const f = h.inst.focus(); if (f) return f; }
  if (!a.dir && !toolOf(a.rel)) { const p = isPicked(a.rel) ? null : paperAt(a.rel); return { kind: 'file', label: baseName(a.rel), detail: a.rel, ...(p ? { paperId: p.id } : {}) }; }
  return null;
}

/** Whether any open document has edits not saved. */
export function hasUnsaved() { for (const h of hosts.values()) { h.inst?.flush?.(); if (h.live && h.inst?.dirty?.()) return true; } return false; }
const dirtyHosts = pick => [...hosts.values()].filter(h => { h.inst?.flush?.(); return h.live && h.inst?.dirty?.() && pick(h); });

let asking = null;
/**
 * The three-way question for documents with unsaved edits: Save (saves them through their own Save, then goes on), Don't save (their edits are dropped,
 * then it goes on) or Cancel (nothing happens). Resolves true when it may go on. A failed save says why and stays. The dialog is the app's own (a
 * webview's window.confirm can return false without showing anything); a second request while one is open does nothing.
 */
async function settle(list, { verb = 'close' } = {}) {
  if (!list.length) return true;
  if (asking) return false;
  const names = list.map(h => labelOf(h.rel)), one = list.length === 1;
  asking = (async () => {
    const answer = await choiceAsk(one ? `Do you want to save the changes to ${names[0]}?` : `${list.length} files have unsaved changes`, {
      detail: one ? `If you ${verb} without saving, the changes are lost.` : `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}. If you ${verb} without saving, the changes are lost.`,
      choices: [{ id: 'save', label: one ? 'Save' : 'Save all', role: 'primary' }, { id: 'discard', label: 'Don\u2019t save', role: 'destructive' }] });
    if (answer === 'save') {
      for (const h of list) {
        const ok = await h.inst.save();
        if (!ok) {
          // the file stays open with its changes; the one decision left is whether to try the write again
          const again = await confirmAsk(`${labelOf(h.rel)} was not saved`, { detail: `${h.inst.lastError || 'The file could not be written'}. Your changes are still open in their tab.`, confirm: 'Try again' });
          if (again && await h.inst.save()) continue;
          return false;
        }
      }
      return true;
    }
    if (answer === 'discard') { for (const h of list) retire(h); return true; }
    return false;
  })().finally(() => { asking = null; });
  return asking;
}
/** Unsaved edits across every open tab, before the view is left or the app quits. Resolves true when the view may be left. */
export const confirmLeave = () => settle(dirtyHosts(() => true), { verb: 'leave' });
/** Whether a folder the explorer is about to close may go: nothing in it with unsaved edits, or the person decided. */
export const canCloseFolder = rel => settle(dirtyHosts(h => h.rel === rel || h.rel.startsWith(`${rel}/`)), { verb: 'close the folder' });
/** Keeps the tabs on what the explorer renamed or moved; `to` null is a file that is gone. */
export function moved(from, to) {
  tabs.rename(from, to || null);
  if (to) history.rename(from, to); else if (history.drop(from)) browserOn = browserOn || !tabs.count();
  { const h = hosts.get(BROWSER); if (h && h.rel !== history.current()) { retire(h); h.rel = history.current(); count = ''; } }
  for (const h of [...hosts.values()]) if (h.rel === from || h.rel.startsWith(`${from}/`)) { retire(h); hosts.delete(h.key); }
  if (surface?.isConnected) change({ chrome: true });
}

/**
 * A tool in a tab (the Kaplan–Meier digitiser, the table reader): a session tab named for the tool, drawn by `tool.mount` (views/file-doc.mjs mountToolTab).
 * It has no file; its work is kept by the tool, so a tab the page released draws itself again as it was. Closing the tab ends the work.
 */
export function openTool(tool) {
  ensureProject();
  const rel = `${PICKED}${++pickedCount}/${String(tool.label).replace(/[\\/]+/g, ' ')}`;
  pickedFolders.set(rel, { name: 'Tool', tool, stat: async () => ({ exists: true, dir: false, size: 0, mtime: 0 }), read: async () => new Uint8Array() });
  show(rel);
  return rel;
}
const toolOf = rel => pickedFolders.get(rel)?.tool || null;

/** A file chosen with the system picker: a tab for this session only. */
export function pickFile(ready) {
  const input = document.createElement('input'); input.type = 'file';
  input.hidden = true; document.body.append(input);
  input.accept = '.xlsx,.csv,.tsv,.docx,.pdf,.txt,.md,.json,.r,.py,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.tif,.tiff';
  input.onchange = () => {
    const file = input.files?.[0]; input.remove(); if (!file) return;
    let bytes = null, stamp = file.lastModified;
    const opened = { name: 'Opened file', download: true,
      stat: async () => ({ exists: true, dir: false, size: bytes?.length ?? file.size, mtime: stamp }),
      read: async () => bytes ||= new Uint8Array(await file.arrayBuffer()),
      replaceBytes: async (_name, next) => {
        const { saveFile } = await import('../lib/save.mjs');
        if (!await saveFile(next, file.name)) throw new Error('Save cancelled');
        bytes = next; return stamp = Date.now();
      },
      writeText: async (_name, text) => opened.replaceBytes(_name, new TextEncoder().encode(text)),
    };
    const rel = `${PICKED}${++pickedCount}/${file.name}`;
    pickedFolders.set(rel, opened);
    show(rel); ready?.();
  };
  input.oncancel = () => input.remove();
  input.click();
}

export async function openNote(note) {
  const path = note.source.path;
  let rel = shown() && displayFilePath(shown()) === path ? shown() : '';
  if (!rel) {
    const match = (await allFiles()).find(p => displayFilePath(p) === path);
    if (!match) throw new Error('Open this file or its folder in Files, then choose Go to selection again.');
    rel = match;
  }
  pendingNote = { rel, note };
  show(rel);
  const h = hosts.get(rel);
  if (h?.live && h.inst) { pendingNote = null; h.inst.ready?.then(() => h.inst.reveal?.(note.anchor)); }
}

/**
 * Closes the shown tab, asking first when it has unsaved edits. The last tab closing leaves the project's folder page, and never browses to a
 * parent folder. Returns whether a tab closed.
 */
export async function closeFile() { const a = activeTab(); return a.browser ? false : closeTab(a.rel); }

// ---- tab commands --------------------------------------------------------------------------------------------------------------

async function closeTab(rel) {
  if (rel === BROWSER) return false;
  const h = hosts.get(rel);
  h?.inst?.flush?.();
  if (!await settle(h?.live && h.inst?.dirty?.() ? [h] : [])) return false;
  if (!tabs.has(rel)) return true;
  tabs.close(rel);
  if (toolOf(rel)) pickedFolders.delete(rel);
  change({ chrome: true, reveal: true });
  return true;
}
/**
 * Closes several tabs (Close other tabs, Close tabs to the right, Close all): one question for all of those with unsaved edits, through the same
 * dialog as one tab, and none when nothing is edited; Cancel closes none of them. The folder page is never closed.
 */
async function closeMany(rels) {
  const list = rels.filter(rel => rel !== BROWSER && tabs.has(rel));
  if (!list.length) return true;
  if (!await settle(dirtyHosts(h => list.includes(h.rel)))) return false;
  for (const rel of list) { tabs.close(rel); if (toolOf(rel)) pickedFolders.delete(rel); }
  change({ chrome: true, reveal: true });
  return true;
}
/** The tabs of a group in strip order, the folder page first in the first group (it is drawn first and never closes). */
const stripOrder = g => [...(g === tabs.groups[0] ? [BROWSER] : []), ...g.tabs.map(t => t.rel)];
/** Close other tabs, Close tabs to the right (of `rel` in its strip), Close saved and Close all, for a tab's menu and the strip's More. */
const closeItems = (g, rel) => {
  const order = stripOrder(g), at = order.indexOf(rel), docs = order.filter(r => r !== BROWSER);
  const others = docs.filter(r => r !== rel), right = at < 0 ? [] : order.slice(at + 1);
  return [
    { label: 'Close other tabs', disabled: !others.length, run: () => closeMany(others) },
    { label: 'Close tabs to the right', disabled: !right.length, run: () => closeMany(right) },
    { label: 'Close saved', disabled: !docs.some(r => !dirty.has(r)), run: () => closeMany(docs.filter(r => !dirty.has(r))) },
    { label: 'Close all', disabled: !docs.length, run: () => closeMany(docs) },
  ];
};

const browserShown = () => !!activeTab().browser;
/** The keyboard and menu commands of the tabs and the folder page. Returns whether it did something. */
export function command(name) {
  if (name === 'back') return goBack();
  if (name === 'forward') return goForward();
  if (name === 'up') return browserShown() && goUp();
  if (name === 'find') { const inst = browserShown() && hosts.get(BROWSER)?.inst; if (!inst?.openFilter) return false; inst.openFilter(); return true; }
  if (name === 'close') { const a = activeTab(); if (a.browser) return false; closeTab(a.rel); return true; }
  if (name === 'reopen') { const rel = tabs.reopen(); if (rel) change({ chrome: true, reveal: true }); return !!rel; }
  if (!tabs.count()) return false;
  if (name === 'next' || name === 'prev') { tabs.activate(tabs.step(name === 'next' ? 1 : -1)); change({ chrome: true, reveal: true }); return true; }
  if (name === 'cycle' || name === 'cycle-back') { tabs.activate(tabs.cycle(name === 'cycle' ? 1 : -1)); change({ chrome: true, reveal: true }); return true; }
  if (name === 'side') { const a = activeTab(); if (!a.browser) { tabs.show(a.rel, { side: true }); change({ chrome: true }); } return true; }
  return false;
}

function onKey(e) {
  if (!surface?.isConnected || e.defaultPrevented) return;
  const mod = e.metaKey, ctrl = e.ctrlKey;
  let name = '';
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') name = 'close';
  else if (mod && e.shiftKey && !e.altKey && e.code === 'BracketRight') name = 'next';
  else if (mod && e.shiftKey && !e.altKey && e.code === 'BracketLeft') name = 'prev';
  else if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') name = 'reopen';
  else if (ctrl && !mod && !e.altKey && e.key === 'Tab') name = e.shiftKey ? 'cycle-back' : 'cycle';
  // ⌘F on the folder page opens its filter row, when the keyboard is in the page or nowhere in particular (a document's ⌘F is its own, and so is
  // that of the reader docked beside the page or of the chat); not while a dialog asks
  else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !document.querySelector('dialog[open], .chat-expanded') && surface.getClientRects().length
    && (surface.contains(e.target) || e.target === document.body || e.target === document.documentElement || e.target.closest?.('main > .topbar'))) name = 'find';
  else if (mod && !e.shiftKey && !e.altKey && !e.target.closest?.('input,textarea,[contenteditable="true"]')) name = e.code === 'BracketLeft' ? 'back' : e.code === 'BracketRight' ? 'forward' : e.code === 'ArrowUp' ? 'up' : '';
  if (name && command(name)) { e.preventDefault(); e.stopPropagation(); }
}

// ---- menus --------------------------------------------------------------------------------------------------------------------------

// A tab's menu (a right click) and the strip's More close tabs of that strip: the tab itself (its menu only), the others, those to its right, the
// saved ones, all of them.
const tabMenu = rel => {
  const others = tabs.groups.length > 1, g = tabs.group(tabs.groupOf(rel)) || tabs.groups[0];
  return [
    { label: 'Close', meta: '⌘W', run: () => closeTab(rel) },
    ...closeItems(g, rel),
    '-',
    { label: others ? 'Move to the other group' : 'Open to the side', icon: 'split', run: () => { tabs.activate(rel); tabs.show(rel, { side: true }); change({ chrome: true }); } },
    tabs.isPreview(rel) && { label: 'Keep open', run: () => { tabs.pin(rel); change({}); } },
    '-',
    ...(isPicked(rel) ? [] : fileItems(rel).filter(x => x === '-' || (x.label !== 'Open' && x.label !== 'Open to the side'))),
  ].filter(Boolean).filter((x, i, a) => !(x === '-' && (a[i - 1] === '-' || i === a.length - 1 || i === 0)));
};
const stripMenu = (g, shownRel) => {
  const rel = shownRel === BROWSER ? '' : shownRel;
  return [
    ...closeItems(g, shownRel),
    '-',
    rel && { label: tabs.groups.length > 1 ? 'Move to the other group' : 'Open to the side', icon: 'split', run: () => command('side') },
    '-',
    { label: 'Reopen closed tab', meta: '⌘⇧T', run: () => command('reopen') },
    rel && tabs.isPreview(rel) && { label: 'Keep open', run: () => { tabs.pin(rel); change({}); } },
  ].filter(Boolean);
};

function toggleHidden() {
  showHiddenFiles(!hiddenShown());
  for (const h of hosts.values()) h.inst?.redraw?.();
  change({ chrome: true });
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Menu items as the title bar's More declares them: each with an id, its command bound by id. */
function entries(items, prefix) {
  const out = []; let n = 0;
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { if (out.length && out.at(-1) !== '-') out.push('-'); continue; }
    out.push({ id: `${prefix}-${n++}-${slug(it.label)}`.slice(0, 60), label: it.label, ...(it.danger ? { danger: true } : {}), ...(typeof it.checked === 'boolean' ? { checked: it.checked } : {}), ...(it.disabled ? { disabled: true } : {}), run: it.run });
  }
  while (out.at(-1) === '-') out.pop();
  return out;
}

// The folder's own commands are the title bar's acts (Add files the primary, New folder beside it); the rest of the folder's menu is More.
const FOLDER_ACTS = { 'New folder': { id: 'files-new-folder', role: 'secondary' }, 'Add files': { id: 'files-add', role: 'primary' } };
function folderPage(rel) {
  // The two view choices read as what pressing them does, not as checks: a check lit in More would look like something wrong.
  const n = hosts.get(BROWSER)?.inst?.hidden?.() || 0;
  const hide = { label: hiddenShown() ? 'Hide hidden files' : n ? `Show ${plural(n, 'hidden file')}` : 'Show hidden files', run: toggleHidden };
  const group = { label: readPreferences().group ? 'List every version' : 'Group versions', run: () => { for (const h of hosts.values()) h.inst?.setGroup?.(!readPreferences().group); change({ chrome: true }); } };
  const first = { label: readPreferences().foldersFirst ? 'Sort folders with files' : 'Folders first', run: () => { for (const h of hosts.values()) h.inst?.setFoldersFirst?.(!readPreferences().foldersFirst); change({ chrome: true }); } };
  const items = folderItems(rel).filter(x => x === '-' || (x.label !== 'Open' && x.label !== 'Show hidden files'));
  const acts = items.filter(x => x !== '-' && FOLDER_ACTS[x.label]).map(x => ({ ...FOLDER_ACTS[x.label], label: x.label, icon: x.icon, run: x.run }));
  const more = [{ label: 'Open file…', icon: 'file', run: () => pickFile() }, ...items.filter(x => x === '-' || !FOLDER_ACTS[x.label]), '-', first, group, hide];
  return { acts, more };
}

/** The folders above what is shown, nearest first, up to the top: the title's menu (a document's own folder comes first). */
function foldersAbove(a) {
  const out = [];
  if (isPicked(a.rel) || (a.dir && !a.rel)) return out;
  for (let r = parentOf(a.rel); ; r = parentOf(r)) { if (isPicked(r)) break; out.push(r); if (!r) break; }
  return out;
}
// Find in folder: the folder page's filter row, closed until it is asked for. A quiet icon that is pressed (a fill) while the row is open, which it
// stays while it narrows the list, so a filtered list always says so; it never folds into More (⌘F is in its tooltip).
const FIND = 'page-find';   // the title bar's Find (lib/topbar.mjs)
const filterOf = () => hosts.get(BROWSER)?.inst?.filter?.() || { open: false, active: false };
const findSpec = () => ({ label: 'Find in folder', pressed: filterOf().open, run: () => hosts.get(BROWSER)?.inst?.toggleFilter?.() });
/** The row opened or closed: the title bar's button says so in place (an attribute, as the inspector toggle's), so nothing is drawn again under the keyboard. */
function filterShown(open) {
  if (!surface?.isConnected || !activeTab().browser) return;
  document.querySelectorAll(`[id="${FIND}"]`).forEach(b => b.setAttribute('aria-pressed', String(!!open)));
}
/** List or Grid, from the title bar: the folder page draws it, and the bar shows the choice. */
function setView(key, rerender) {
  const h = hosts.get(BROWSER);
  if (h?.inst?.setView) h.inst.setView(key); else writePreferences({ ...readPreferences(), view: key });
  if (ctxRef?.fileChrome) ctxRef.fileChrome(); else rerender?.();
}

/**
 * The Files page's head (lib/topbar.mjs): Back, Forward and Up, the name of what is shown with the folders above it as its menu, and, for the folder
 * page, its count, List | Grid and its commands. For a document, More holds what can be done with the file; its tools are under its tab.
 */
export function page(rerender) {
  ensureProject();
  const a = activeTab(), can = canGo(), above = foldersAbove(a);
  const nav = [
    { id: 'files-back', label: 'Back', icon: 'chevron-left', kbd: '⌘[', disabled: !can.back, run: () => { goBack(); } },
    { id: 'files-forward', label: 'Forward', icon: 'chevron-right', kbd: '⌘]', fold: 1, keep: false, disabled: !can.forward, run: () => { goForward(); } },
    { id: 'files-up', label: 'Up one folder', icon: 'arrow-up', kbd: '⌘↑', disabled: !can.up, run: () => { goUp(); } },
  ];
  // the path from the top, each folder going there, the last part the title and its menu (the path popover); the top alone is a plain title
  const tip = r => displayFilePath(r) || crumbLabel(r);
  const crumbs = above.length ? [...above].reverse().map(r => ({ id: r || '@top', label: crumbLabel(r), tip: tip(r), run: () => navigate(r) }))
    .concat({ id: a.dir ? a.rel : `@doc:${a.rel}`, label: crumbLabel(a.rel), tip: tip(a.rel) }) : null;
  const head = { title: `${crumbLabel(a.rel)}`, nav,
    ...(crumbs ? { crumbs, titleNoun: 'folder', titleMenu: anchor => showMenu(anchor, above.map(r => ({ label: crumbLabel(r), icon: 'folder', run: () => navigate(r) }))) } : {}) };
  if (!a.dir) {
    return { ...head, actions: [], overflow: entries([
      ...(isPicked(a.rel) ? [] : fileItems(a.rel).filter(x => x === '-' || x.label !== 'Open')),
      '-',
      tabs.isPreview(a.rel) && { label: 'Keep open', run: () => { tabs.pin(a.rel); change({ chrome: true }); } },
      { label: 'Close tab', run: () => { closeFile(); } },
    ], 'files-more') };
  }
  const { acts, more } = folderPage(a.rel);
  // a selection is a state and stays beside the title ('3 selected'); the folder's item count does not (Component review 2026-10-21, item 1)
  return { ...head, ...(/selected$/.test(count) ? { status: { text: count, ch: COUNT_CH } } : {}),
    view: { id: 'files-view', label: 'View', attr: 'data-view', value: readPreferences().view, items: [['list', 'List'], ['grid', 'Grid']], run: key => setView(key, rerender) },
    ...(folderFor(a.rel) ? { find: findSpec() } : {}), actions: acts, overflow: entries(more, 'files-more') };
}
/** The folder page's count, written into the title bar's status in place; the bar is drawn again when it has no status slot yet. */
function setCount(text) {
  text = /selected$/.test(text || '') ? text : '';
  if (text === count) return;
  count = text;
  if (!surface?.isConnected || !activeTab().browser) return;
  const el = document.getElementById('topbar-status');
  if (el && count) { el.textContent = count; return; }
  if (ctxRef?.fileChrome) ctxRef.fileChrome(); else ctxRef?.status?.(count ? { text: count, ch: COUNT_CH } : null);
}
// ---- adoption: the Overview's rows, the inspector, the actions -----------------------------------------------------------------

let drift = null;                         // a drift row asked for: shown at the next render
/**
 * Where a drift row of the Overview leads (go('files:<rule>:<path>')): the folder page of the file, the file selected and the inspector open; for
 * a row about cells or a value that rests on an unadopted file, the dialog that settles it opens as well.
 */
export function openDrift(spec) {
  const m = /^(D[1-5]):(.+)$/s.exec(String(spec || ''));
  if (!m) return;
  ensureProject();
  const [, rule, path] = m, dir = parentOf(path);
  drift = { rule, path, dir };
  navigate(dir);
}
async function runDrift({ rule, path, dir }) {
  const h = hosts.get(BROWSER);
  h?.inst?.select?.(path, { reveal: true });
  picked.set(BROWSER, { rel: path, dir: false });
  ctxRef?.openDetails?.();
  const exists = await filesFolder('')?.stat(path).then(s => s.exists && !s.dir).catch(() => false);
  if (!exists) { say(`${baseName(path)} is no longer in the folder`); return; }
  if (rule === 'D2') await act('diff', path);
  else if (rule === 'D5') await act('write', path);
  else if (rule === 'D4') await act('adopt', path);
}
/** One of the three flows for a file; what it changed is read again afterwards, and the figure checks run once more. Compare is the inspector's section Differences. */
async function act(kind, rel) {
  const folder = filesFolder('');
  if (!folder) return;
  if (kind === 'diff') { await startCompare(folder, rel); return; }
  const run = kind === 'adopt' ? openAdopt : openWriteBack;
  let r = await run(folder, rel, { say });
  if (r?.next === 'write') r = await openWriteBack(folder, rel, { say });
  await afterAdoption(r);
}
async function afterAdoption(r) {
  if (r?.moved) {
    moved(r.moved.from, r.moved.to);
    for (const [k, p] of picked) if (p.rel === r.moved.from) picked.set(k, { ...p, rel: r.moved.to });
    for (const h of hosts.values()) h.inst?.refresh?.();      // the folder page lists the new version and not the old
    hosts.get(hostKey())?.inst?.select?.(r.moved.to, { reveal: true });
  }
  if (r?.changed) {
    await refreshRelations();
    import('../lib/figure-watch.mjs').then(m => m.checkNow?.()).catch(() => {});
    ctxRef?.refreshCounts?.();
  }
}

// ---- Compare: the inspector section Differences -------------------------------------------------------------------------------
// The cells where the file or the app moved, one choice each, paged. The choices live here, in the module, because the inspector is drawn again
// on every change; a choice updates the count and the Apply act in place and never redraws the list under the pointer.
let compare = null;                       // { rel, found: { diffs, writable, token }, choice: Map, page }
async function startCompare(folder, rel) {
  const found = await planDifferences(folder, rel, { say });
  if (!found) return;
  compare = { rel, found, choice: new Map(), page: 1 };
  ctxRef?.openDetails?.(); ctxRef?.refreshDetails?.();
}
const closeCompare = () => { compare = null; ctxRef?.refreshDetails?.(); };
async function finishCompare(next) {
  const c = compare;
  if (!c) return;
  const folder = filesFolder('');
  compare = null; ctxRef?.refreshDetails?.();
  if (!folder) return;
  await afterAdoption(next === 'write' ? await openWriteBack(folder, c.rel, { say }) : await applyDifferences(folder, c.rel, c.found, c.choice, { say }));
}
/** The file or folder the inspector is about: the row selected in a folder page, or the file shown. */
function inspected() {
  const a = activeTab();
  if (a && !a.dir) return { rel: a.rel, dir: false };
  const p = picked.get(hostKey());
  return p?.rel ? p : null;
}
const NOTES_MAX = 5;
const prop = (k, v, strong = false) => v ? `<dt>${esc(k)}</dt><dd${strong ? ' class="fv-rel" data-strong' : ''}>${esc(v)}</dd>` : '';
const statusOf = a => !a ? '' : a.state === 'unread' ? 'Could not be read' : a.state === 'changed' ? `Changed since adoption${a.cellsUnread ? '; its cells could not be read' : a.differ ? `; ${plural(a.differ, 'cell')} differ` : '; no adopted cell differs'}`
  : a.ahead ? `The app is ahead in ${plural(a.ahead, 'cell')}` : a.differ ? `${plural(a.differ, 'cell')} differ from the record` : 'As adopted';

/** The project's dependency graph for the inspector (lib/deps-graph.mjs), built once a minute at most: `{ has(id), text(id) }`. */
let graphCache = null;
async function graphFor(root) {
  if (graphCache?.root === root && Date.now() - graphCache.at < 60000) return graphCache.api;
  const [deps, files, watch, store] = await Promise.all([import('../lib/deps-graph.mjs'), import('../lib/deps-files.mjs'), import('../lib/vcs-watch.mjs'), import('../store.mjs')]);
  const g = deps.buildGraph(store.get(), await files.collectFileFacts(root, { repo: watch.repoOf(root) }));
  graphCache = { root, at: Date.now(), api: { has: id => g.nodes.has(id), text: id => deps.usedText(g, id).replace(/^Used in n/, 'N').replace(/^Used in /, '') } };
  return graphCache.api;
}
/** The inspector for the selected file: what it looks like, what it is, what it is to the project, its versions and notes, and what can be done about it. */
export function inspect() {
  const pick = inspected();
  if (!pick || toolOf(pick.rel)) return [];
  const { rel, dir } = pick;
  if (compare && compare.rel !== rel) compare = null;       // a comparison belongs to the file it was made for
  const browser = [...hosts.values()].find(h => h.inst?.entryOf && h.inst.entryOf(rel))?.inst?.entryOf(rel) || null;
  const e = browser?.entry || null, shownHere = shown() === rel;
  const path = displayFilePath(rel) || rel, name = baseName(path) || labelOf(rel);
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const kind = dir ? 'Folder' : FILE_KINDS[ext] || (ext ? ext.toUpperCase() : 'File');
  const tab = dirty.has(rel) ? 'dirty' : tabs.has(rel) ? 'open' : '';
  const facts = !dir && !isPicked(rel) ? relations?.of(rel, { size: e?.size, mtime: e?.mtime, tab }) : null;
  const sum = facts?.adoption || null;
  const folder = folderFor(rel);
  const secs = [];

  if (!dir) secs.push({ title: 'Preview', meta: name, html: '<div class="fv-prev" data-prev aria-live="polite"></div>',
    wire: async el => {
      const box = el.querySelector('[data-prev]');
      let st = e; if (!st) { try { st = await folder.stat(rel); } catch { st = null; } }
      const p = st && folder ? await previewOf(folder, rel, { size: st.size, mtime: st.mtime }) : null;
      if (!box.isConnected) return;
      if (!p) { el.closest('.insp-sec')?.remove(); return; }
      box.innerHTML = p.type === 'image' ? `<img src="${esc(p.url)}" alt="First page of ${esc(name)}">`
        : p.type === 'sheets' ? `<dl class="props">${p.sheets.map(s => `<dt>${esc(s.name)}</dt><dd>${esc(`${plural(s.rows, 'row')}, ${plural(s.cols, 'column')}`)}</dd>`).join('')}</dl>`
        : `<div class="fv-prev-text">${p.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
    } });

  // an open PDF adds what it is: title, authors, DOI, pages, version, the pages with no text (views/pdf-file.mjs, lib/pdf-props.mjs)
  const pdfLines = dir ? [] : hosts.get(rel)?.inst?.pdf?.props?.() || [];
  const found = dir ? null : hosts.get(rel)?.inst?.pdf?.lookup?.section?.();
  if (found) secs.push(found);
  secs.push({ title: 'Details', html: `<dl class="props">${prop('Where', path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Project folder')}${prop('Kind', kind)}${dir ? '' : `${prop('Size', e ? sizeText(e.size || 0) : '')}${prop('Modified', e?.mtime ? day(e.mtime) : '')}<dt data-late-size${e ? ' hidden' : ''}>Size</dt><dd data-late-size${e ? ' hidden' : ''}></dd><dt>Fingerprint</dt><dd class="fv-hash" data-hash title="SHA-256"></dd>`}${pdfLines.map(([k, v, strong]) => `<dt>${esc(k)}</dt><dd${strong ? ' class="fv-pdf-fact" data-strong' : ''}>${esc(v)}</dd>`).join('')}</dl>`,
    wire: async el => {
      if (dir || !folder) return;
      try {
        const st = e || await folder.stat(rel);
        if (!e && st?.exists) { for (const x of el.querySelectorAll('[data-late-size]')) x.hidden = false; el.querySelector('dd[data-late-size]').textContent = `${sizeText(st.size || 0)}${st.mtime ? `, ${day(st.mtime)}` : ''}`; }
        if ((st?.size || 0) <= 8 * 1048576) { const h = await documentHash(await folder.read(rel)); const d = el.querySelector('[data-hash]'); if (d?.isConnected) { d.textContent = `${h.slice(0, 8)}…${h.slice(-6)}`; d.title = `SHA-256 ${h}`; } }
        else el.querySelector('[data-hash]')?.previousElementSibling?.remove(), el.querySelector('[data-hash]')?.remove();
      } catch { el.querySelector('[data-hash]')?.previousElementSibling?.remove(); el.querySelector('[data-hash]')?.remove(); }
    } });

  if (!dir && facts) {
    const entry = relations.report?.byPath.get(rel);
    const finds = entry?.findings || [];
    const fmt = x => x?.at ? ` ${day(x.at)}` : '';
    const adoption = sum?.adopted ? `Adopted${fmt(sum)}${ROLE_NAMES[sum.role] ? ` as ${ROLE_NAMES[sum.role]}` : ''}` : sum?.unadopted ? 'Not adopted; values rest on it' : 'Not adopted';
    const status = statusOf(sum?.adopted ? sum : null), strongStatus = sum?.adopted && (sum.state === 'changed' || sum.state === 'unread' || sum.ahead || sum.differ);
    const used = facts.figures?.length ? facts.figures.join(', ') : '';
    const btn = (id, label, role = 'secondary') => ({ id, label, role });
    const ok = sum && !relations.report?.readOnly;
    const needsAdopt = ok && (!sum.adopted || sum.state === 'changed');
    const needsLook = ok && sum.adopted && (sum.differ + sum.ahead) > 0;
    const canWrite = ok && sum.adopted && sum.ahead > 0 && canWriteBack(sum.role) && /\.xlsx$/i.test(rel);
    const primary = needsAdopt && (sum.unadopted || (sum.state === 'changed' && !sum.differ)) ? 'fv-adopt' : needsLook && sum.differ ? 'fv-diff' : canWrite ? 'fv-writeback' : '';
    const acts = [needsAdopt && btn('fv-adopt', 'Adopt this file', primary === 'fv-adopt' ? 'primary' : 'secondary'), needsLook && btn('fv-diff', 'Compare', primary === 'fv-diff' ? 'primary' : 'secondary'),
      canWrite && btn('fv-writeback', 'Write back to workbook', primary === 'fv-writeback' ? 'primary' : 'secondary'),
      ok && !sum.adopted && !needsAdopt && btn('fv-adopt', 'Adopt this file')].filter(Boolean);
    secs.push({ title: 'In the project', meta: '',
      html: `<dl class="props">${prop('Adoption', adoption)}${prop('Status', status, strongStatus)}${sum?.adopted && sum.cells ? prop('Tracked', plural(sum.cells, 'cell')) : ''}${prop('Open', tab ? (tab === 'dirty' ? 'Yes; unsaved edits' : 'Yes') : '')}${prop('In the library', facts.library ? `As ${facts.library}` : '')}${facts.applied ? prop('Imported', day(facts.applied.at)) : ''}${prop('Written by Lykos', facts.written)}${prop('Used by', used)}${finds.length ? `<dt>Checks</dt><dd class="fv-checks">${finds.slice(0, 4).map(f => `<span>${esc(f.text)}</span>`).join('')}${finds.length > 4 ? `<span>and ${plural(finds.length - 4, 'more check')}</span>` : ''}</dd>` : ''}</dl>${relations.report?.readOnly ? `<p class="meta">${esc(relations.report.notice)}</p>` : ''}${acts.length ? inspectorActions({ label: 'Adoption actions', id: 'fv-adopt-acts', actions: acts }) : ''}`,
      wire: el => {
        el.querySelector('#fv-adopt')?.addEventListener('click', () => act('adopt', rel));
        el.querySelector('#fv-diff')?.addEventListener('click', () => act('diff', rel));
        el.querySelector('#fv-writeback')?.addEventListener('click', () => act('write', rel));
      } });
  }

  // This file in the project's history and dependencies (views/changes.mjs): its recorded versions and what a change to it reaches, read when shown
  if (!dir && !isPicked(rel) && filesFolder('')) secs.push({ title: 'This file', meta: '', html: '<dl class="props" data-this-file><dt>History</dt><dd>Reading…</dd></dl>',
    wire: async el => {
      const box = el.querySelector('[data-this-file]'), root = filesFolder('');
      try {
        const watch = await import('../lib/vcs-watch.mjs'), dates = await import('../lib/dates.mjs');
        const versions = await watch.repoOf(root).fileLog(rel), last = versions[0];
        const graph = await graphFor(root), reach = graph.has(`file:${rel}`) ? graph.text(`file:${rel}`) : 'Nothing the project records';
        if (!box.isConnected) return;
        box.innerHTML = `${prop('History', versions.length ? `${plural(versions.length, 'version')}, last ${dates.ago(Date.parse(last.at))}${last.by === watch.BY ? ' (recorded automatically)' : ` by ${last.by}`}` : 'Not recorded yet')}${prop('Used in', reach)}`;
        box.insertAdjacentHTML('afterend', inspectorActions({ label: 'This file', id: 'fv-this-file', actions: [{ id: 'fv-file-history', label: 'Show history', icon: 'changes' }, { id: 'fv-file-deps', label: 'Where it is used', icon: 'branch', role: 'secondary' }] }));
        el.querySelector('#fv-file-history')?.addEventListener('click', async () => { (await import('./changes.mjs')).fileHistory(rel); ctxRef?.go?.('changes'); });
        el.querySelector('#fv-file-deps')?.addEventListener('click', async () => { (await import('./changes.mjs')).focus(`file:${rel}`); ctxRef?.go?.('changes'); });
      } catch { if (box.isConnected) box.innerHTML = prop('History', 'Could not be read'); }
    } });

  if (!dir && compare) secs.push(differencesSection(compare, { refresh: () => ctxRef?.refreshDetails?.(), cancel: closeCompare, finish: finishCompare }));

  const group = browser?.group;
  if (group?.earlier.length) {
    const versions = [group.latest, ...group.earlier];
    secs.push({ title: 'Versions', meta: String(versions.length),
      html: uiList({ id: 'fv-versions', label: 'Versions of this file', rows: pagedList('fv-versions', versions, { label: 'versions', size: EDITOR_PAGE_SIZE }).items.map(v => uiRow({ cls: v.rel === rel ? 'fv-sel' : '', attrs: { 'data-open': v.rel },
        main: { html: `<button type="button" class="fv-entry" data-open="${esc(v.rel)}" title="${esc(v.name)}">${fileIcon(v.rel)}<span class="fv-entry-name">${esc(v.name)}</span></button>`, detail: [esc(sizeText(v.size || 0)), v.mtime ? esc(day(v.mtime)) : '', v === group.latest ? 'Latest' : v.archived ? 'Archive' : ''].filter(Boolean) } })) }) + pagedList('fv-versions', versions, { label: 'versions', size: EDITOR_PAGE_SIZE }).pager,
      wire: el => { wirePagedList(el, 'fv-versions', () => ctxRef?.refreshDetails?.()); el.querySelectorAll('button[data-open]').forEach(b => b.addEventListener('click', () => show(b.dataset.open, { preview: true }))); } });
  }

  if (!dir) {
    const mine = (get().fileNotes || []).filter(n => n.source?.path === path);
    if (mine.length) secs.push({ title: 'Notes', meta: String(mine.length),
      html: uiList({ id: 'fv-notes', label: 'Notes on this file', rows: mine.slice(0, NOTES_MAX).map(n => uiRow({ attrs: { 'data-note': n.id }, main: { html: `<button type="button" class="fv-entry" data-note="${esc(n.id)}"><span class="fv-entry-name">${esc(n.text)}</span></button>`, detail: [esc(day(n.at)), n.done ? 'Done' : ''].filter(Boolean) } })) }),
      wire: el => el.querySelectorAll('button[data-note]').forEach(b => b.addEventListener('click', () => { const n = mine.find(x => x.id === b.dataset.note); if (n) openNote(n).catch(err => say(err.message)); })) });
  }

  const doOpen = !shownHere || dir;
  if (doOpen && folder) secs.push({ html: inspectorActions({ label: 'File actions', id: 'fv-insp-acts', actions: [{ id: 'fv-open-side', label: 'Open to the side', role: 'secondary', disabled: dir }, { id: 'fv-open', label: dir ? 'Open folder' : 'Open', role: 'secondary' }] }),
    wire: el => {
      el.querySelector('#fv-open')?.addEventListener('click', () => show(rel, { dir }));
      el.querySelector('#fv-open-side')?.addEventListener('click', () => show(rel, { side: true }));
    } });
  return secs;
}

// ---- drawing -----------------------------------------------------------------------------------------------------------------------

export function render(el, ctx) {
  ctxRef = ctx;
  ensureProject();
  // "New since your last visit" is judged against the end of the visit before this one, and holds for the whole of this one.
  if (!inVisit) { inVisit = true; try { visitStart = Number(localStorage.getItem(SEEN_KEY(projectId))) || 0; } catch { visitStart = 0; } }
  retireDom();
  surface = document.createElement('div'); surface.className = 'fv-surface';
  el.replaceChildren(); el.append(surface);
  // Two groups sit side by side and stack when the surface is narrower than 1000px.
  const stack = () => surface?.toggleAttribute('data-stacked', groupsStack(surface.clientWidth));
  unwatchSurface?.(); unwatchSurface = watchWidth(surface, stack); stack();
  if (!keysOn) { document.addEventListener('keydown', onKey, true); keysOn = true; }
  change({ chrome: false });
  requestAnimationFrame(() => restoreScrolls());
  ctx.detail?.(details.get(hostKey()) || '');
  if (drift) { const d = drift; drift = null; refreshRelations().then(() => runDrift(d)); }
}

/** A repaint keeps the decoded documents; leaving the view releases them all. */
export function unmount(repaint = false) {
  if (repaint) {
    scrolls.clear();
    for (const h of hosts.values()) scrolls.set(h.key, [...h.el.querySelectorAll('*')].filter(n => n.scrollTop || n.scrollLeft).map(n => [n, n.scrollTop, n.scrollLeft]));
  } else {
    for (const h of hosts.values()) retire(h);
    hosts.clear(); dirty.clear(); scrolls.clear(); picked.clear();
    if (projectId) try { localStorage.setItem(SEEN_KEY(projectId), String(Date.now())); } catch {}
    inVisit = false;
    if (keysOn) { document.removeEventListener('keydown', onKey, true); keysOn = false; }
    retireDom();
  }
  unwatchSurface?.(); unwatchSurface = null;
  surface = null;
}
const restoreScrolls = () => { for (const [key, list] of scrolls) { if (hosts.has(key)) for (const [n, top, left] of list) { n.scrollTop = top; n.scrollLeft = left; } } scrolls.clear(); };
function retireDom() { for (const f of stripReleases.values()) f(); stripReleases.clear(); sections.clear(); }
function retire(h) { try { h.inst?.release?.(); } catch {} h.live = false; h.inst = null; dirty.delete(h.rel); }

function makeSection(id) {
  const sec = document.createElement('section');
  sec.className = 'fv-group'; sec.dataset.group = id;
  sec.innerHTML = '<div class="fv-strip"></div><div class="fv-hosts"></div>';
  sec.addEventListener('pointerdown', () => { if (id !== 'root' && tabs.focus !== id) { tabs.focusGroup(id); markFocus(); } }, true);
  return sec;
}
const markFocus = () => {
  for (const [id, sec] of sections) {
    sec.toggleAttribute('data-focused', id === tabs.focus);
    focusDocTabs(sec.querySelector('.ui-tabs'), id === tabs.focus);
  }
};

function ensureHost(key) {
  let h = hosts.get(key);
  if (!h) {
    const el = document.createElement('div'); el.className = 'fv-host'; el.dataset.host = key;
    h = { key, rel: key === BROWSER ? history.current() : key, dir: key === BROWSER, el, inst: null, live: false };
    hosts.set(key, h);
  }
  if (key === BROWSER && h.rel !== history.current()) { retire(h); h.rel = history.current(); count = ''; }
  return h;
}
function mountHost(h) {
  if (h.live) return;
  h.live = true;
  const rel = h.rel, folder = folderFor(rel);
  if (!folder) {
    // no folder at all (the explorer offers the same two): choose one, or open a single file
    h.el.innerHTML = h.dir ? noFolderPage() : emptyState({ icon: 'warn', title: 'Folder not open' });
    h.el.querySelector('#fv-add-folder')?.addEventListener('click', () => addFolder());
    h.el.querySelector('#fv-open-file')?.addEventListener('click', () => pickFile());
    return;
  }
  if (h.dir) {
    const real = rel;
    h.inst = mountBrowser(h.el, {
      rel: real, folder,
      open: (r, how) => browse(h, r, how),
      menu: (r, dir) => (dir ? folderItems(r) : fileItems(r)),
      relation: (r, e) => relationOf(r, e),
      ops: browserOps,
      onSelect: (r, dir) => { if (r) picked.set(h.key, { rel: r, dir }); else picked.delete(h.key); ctxRef?.refreshDetails?.(); },
      onPreview: () => ctxRef?.openDetails?.(),
      onStatus: setCount, onFilter: filterShown, say,
    });
    refreshRelations();
    return;
  }
  const tool = toolOf(rel);
  if (tool) { h.inst = mountToolTab(h.el, { rel, tool, ctx: ctxRef, say, onClose: () => closeTab(rel) }); return; }
  const note = pendingNote?.rel === rel ? pendingNote.note : null;
  if (note) pendingNote = null;
  h.inst = mountDocument(h.el, {
    rel, folder, ctx: ctxRef, picked: isPicked(rel), note, page: takePlace(rel),
    onDirty: on => { if (on) dirty.add(rel); else dirty.delete(rel); drawStrips(); },
    // the title bar's path already says where the file is: the message keeps its size and date
    onDetail: text => setDetail(h.key, isPicked(rel) ? text : text.split(/ \u00b7 |, /).slice(1).join(', ') || text),   // lint-allow-dot: reads labels saved before 2026-10-20
    say, onClose: () => closeTab(rel),
    // an image steps through the images of its folder in this tab, in the order the folder page lists them
    ...(kindOf(rel) === 'image' && !isPicked(rel) ? { siblings: () => imagesBeside(rel), step: to => stepTab(rel, to), autofocus: stepped.delete(rel) } : {}),
  });
}
const stepped = new Set();                // an image shown by stepping from another: it takes the keyboard when it is up
async function imagesBeside(rel) {
  const folder = folderFor(rel); if (!folder?.list) return [];
  return imageOrder(await folder.list(parentOf(rel)), readPreferences(), e => hiddenShown() || !junk(e.name));
}
/** The tab of `from` shows `to` in its place (an image's previous or next). */
function stepTab(from, to) {
  if (!tabs.has(from) || !to) return;
  stepped.add(to);
  tabs.replace(from, to);
  if (tabs.groupOf(to) === tabs.groups[0].id) browserOn = false;
  change({ chrome: true, reveal: true });
}
/** What the folder page can do to its rows (the explorer's commands: the tree and the page share them). */
const browserOps = {
  can: (rel, dir) => { const f = filesFolder(rel), root = isFolderRoot(rel); return { rename: !!f?.can[dir ? 'renameDir' : 'rename'] && !root, trash: !!f?.can.trash && !root, reveal: !!f?.can.reveal, write: !!f?.can.write }; },
  rename: renameTo,
  trash: trashEntries,
  moveInto,
  moveTo: rels => askFolder(rels.length === 1 ? `Move ${baseName(rels[0])} to` : `Move ${rels.length} items to`, { exclude: rels }),
  duplicate: duplicateEntry,
  copyInto,
  reveal: rel => filesFolder(rel)?.reveal(rel).catch(err => say(err.message)),
  copyPath,
  copyName,
  compress: compressEntries,
};
const noFolderPage = () => emptyState({ icon: 'folder', title: 'No folder open', actions: [{ id: 'fv-add-folder', label: 'Open folder…', icon: 'folder-plus', primary: true }, { id: 'fv-open-file', label: 'Open file…', icon: 'file' }] });
const setDetail = (key, text) => { details.set(key, text); if (key === hostKey() && surface?.isConnected) ctxRef?.detail?.(text); };

/** What a file is to the project, in one phrase (lib/file-relations.mjs): `{ text, strong }`. Until the page's facts are read, only the tab and the library are known. */
function relationOf(rel, entry = {}) {
  const tab = dirty.has(rel) ? 'dirty' : tabs.has(rel) ? 'open' : '';
  if (relations) return relations.phrase(rel, { size: entry.size, mtime: entry.mtime, tab });
  return phraseOf({ tab, library: paperAt(rel)?.label || '' });
}

/** Reads what the project knows of its files again (the record against the folder, what Lykos wrote, the registry), then redraws the rows and the inspector. */
export async function refreshRelations() {
  if (relationsRun) { relationsAgain = true; return relationsRun; }
  relationsRun = (async () => {
    do {
      relationsAgain = false;
      const folder = filesFolder(''), id = projectId;
      let next = null;
      if (folder?.list) { try { next = await loadRelations(folder, get(), { seenAt: visitStart }); } catch { next = null; } }
      if (id === projectId) relations = next;
      for (const h of hosts.values()) h.inst?.repaint?.();
      ctxRef?.refreshDetails?.();
    } while (relationsAgain);
  })().finally(() => { relationsRun = null; });
  return relationsRun;
}

function browse(h, rel, { dir = false, side = false, find = '' } = {}) {
  if (dir) { navigate(rel); return; }
  show(rel, { side, find });
}

/** Reconciles the page with the model: groups, strips, the hosts that exist, the one shown in each group, and the title bar. */
function change({ chrome = true, reveal: select = false } = {}) {
  if (!surface?.isConnected) { persist(); return; }
  const has = tabs.count() > 0;
  const want = has ? tabs.groups : [{ id: 'root', tabs: [], active: '' }];
  surface.dataset.groups = String(want.length);
  for (const [id, sec] of sections) if (!want.some(g => g.id === id)) { sec.remove(); sections.delete(id); stripReleases.get(id)?.(); stripReleases.delete(id); }
  const keep = new Set(), shownKey = new Map();
  want.forEach((g, i) => {
    let sec = sections.get(g.id);
    if (!sec) { sec = makeSection(g.id); sections.set(g.id, sec); }
    const place = surface.querySelectorAll(':scope > .fv-group')[i];
    if (place !== sec) surface.insertBefore(sec, place || null);
    sec.querySelector('.fv-strip').hidden = !has;
    const box = sec.querySelector('.fv-hosts');
    const keys = [...(i === 0 ? [BROWSER] : []), ...g.tabs.map(t => t.rel)];
    const active = i === 0 && (!has || browserOn || !g.active) ? BROWSER : g.active;
    shownKey.set(g.id, active);
    for (const key of keys) {
      const h = ensureHost(key);
      keep.add(key);
      if (h.el.parentElement !== box) box.append(h.el);
      const on = key === active;
      h.el.hidden = !on; h.el.inert = !on;
    }
  });
  for (const h of [...hosts.values()]) if (!keep.has(h.key)) { retire(h); h.el.remove(); hosts.delete(h.key); }
  placeDivider(want.length === 2);
  drawStrips();
  for (const g of want) { const h = hosts.get(shownKey.get(g.id)); if (h) mountHost(h); }
  const policy = mountedTabs(tabs, rel => dirty.has(rel) && hosts.get(rel)?.live);
  for (const h of hosts.values()) if (h.live && h.key !== BROWSER && !policy.has(h.rel)) retire(h);
  markFocus();
  track();
  persist();
  if (select) { const a = activeTab(); if (a.rel && !isPicked(a.rel)) reveal(a.rel); }
  if (chrome) { ctxRef?.fileChrome?.(); ctxRef?.detail?.(details.get(hostKey()) || ''); }
}

/** The handle between two groups: dragged or moved with the arrow keys, its place remembered. */
function placeDivider(two) {
  if (!two) { divider?.remove(); divider = null; return; }
  if (!divider || !surface.contains(divider)) {
    divider = document.createElement('div'); divider.className = 'fv-divider'; divider.setAttribute('role', 'separator'); divider.tabIndex = 0; divider.setAttribute('aria-label', 'Resize groups');
    let saved = 0.5; try { const v = parseFloat(localStorage.getItem(SPLIT_KEY)); if (v >= 0.2 && v <= 0.8) saved = v; } catch {}
    const set = (v, keep = true) => {
      const f = Math.min(0.8, Math.max(0.2, v));
      surface.style.setProperty('--fv-split', `${(f * 100).toFixed(1)}%`);
      divider.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      if (keep) try { localStorage.setItem(SPLIT_KEY, String(f)); } catch {}
    };
    set(saved, false);
    divider.addEventListener('pointerdown', e => {
      e.preventDefault(); divider.setPointerCapture(e.pointerId); divider.classList.add('dragging');
      const move = ev => { const r = surface.getBoundingClientRect(), stacked = surface.hasAttribute('data-stacked'); set(stacked ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width); };
      const up = () => { divider.classList.remove('dragging'); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', up); divider.removeEventListener('pointercancel', up); };
      divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', up); divider.addEventListener('pointercancel', up);
    });
    divider.addEventListener('keydown', e => {
      const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
      if (step) { e.preventDefault(); set((Number(divider.getAttribute('aria-valuenow')) || 50) / 100 + step); }
    });
  }
  const second = surface.querySelectorAll(':scope > .fv-group')[1];
  if (second && divider.nextElementSibling !== second) surface.insertBefore(divider, second);
}

function drawStrips() {
  if (!surface?.isConnected || !tabs.count()) return;
  tabs.groups.forEach((g, gi) => {
    const sec = sections.get(g.id); if (!sec) return;
    stripReleases.get(g.id)?.();
    const first = gi === 0;
    const docs = g.tabs.map(t => ({ id: t.rel, label: labelOf(t.rel), icon: toolOf(t.rel)?.icon || typeIcon(t.rel, false), path: isPicked(t.rel) ? labelOf(t.rel) : displayFilePath(t.rel) || labelOf(t.rel), dirty: dirty.has(t.rel), preview: t.preview }));
    // the folder page is the first tab of the first group: pinned, never closed, named for the folder it shows
    const list = first ? [{ id: BROWSER, label: crumbLabel(history.current()), icon: 'folder', path: displayFilePath(history.current()) || crumbLabel(''), pinned: true }, ...docs] : docs;
    const active = first && (browserOn || !g.active) ? BROWSER : g.active;
    const strip = sec.querySelector('.fv-strip');
    strip.innerHTML = uiDocTabs({ id: `fv-tabs-${g.id}`, label: 'Open documents', tabs: list, active, focused: tabs.focus === g.id });
    const group = g;
    stripReleases.set(g.id, wireDocTabs(strip.firstElementChild, {
      tabs: list, active,
      select: rel => selectTab(group.id, rel),
      close: rel => closeTab(rel),
      pin: rel => { if (rel !== BROWSER) { tabs.pin(rel); change({ chrome: false }); } },
      step: d => { const i = list.findIndex(t => t.id === active); selectTab(group.id, list[(i + d + list.length) % list.length].id); },
      more: anchor => showMenu(anchor, stripMenu(tabs.group(group.id) || group, active)),
      context: (rel, e) => { if (rel !== BROWSER) showMenu({ x: e.clientX, y: e.clientY }, tabMenu(rel)); },
      drop: (p, before) => dropOnStrip(group.id, p, before),
    }));
  });
}
function selectTab(groupId, rel) {
  tabs.focusGroup(groupId);
  if (rel === BROWSER) browserOn = true;
  else { tabs.activate(rel); if (groupId === tabs.groups[0].id) browserOn = false; }
  change({ chrome: true, reveal: true });
}

/** A tab dragged onto a strip moves there (before the tab it was dropped on); a file dragged from the explorer opens there. */
function dropOnStrip(groupId, { id, tab }, before) {
  if (tab && tabs.has(id)) {
    const to = tabs.group(groupId); if (!to) return;
    if (id === BROWSER) return;
    const index = before && before !== BROWSER ? to.tabs.findIndex(t => t.rel === before) : before === BROWSER ? 0 : to.tabs.length;
    tabs.move(id, groupId, index < 0 ? to.tabs.length : index);
    if (groupId === tabs.groups[0].id) browserOn = false;
  } else if (id) {
    tabs.focusGroup(groupId); tabs.show(id); if (groupId === tabs.groups[0].id) browserOn = false;
  }
  change({ chrome: true });
}

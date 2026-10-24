// One open document of the Files view: what a file shows follows from what the file is.
//
// A PDF in the library opens in the reader, with its notes and anchors; any other PDF scrolls, its pages drawn as they come near and released
// when far, so a long document costs a few pages of memory. A Word file is laid out as pages and edited as text, saved paragraph by paragraph;
// workbooks and delimited files open in the spreadsheet; text and source files open in an editor and save in place (⌘S), refusing to write over a
// copy that changed on disk. Each document carries its own tools bar under the tab strip, built with the shared builders.
//
// `mountDocument` returns an instance, so several documents are open at once: nothing here is module state except the reader, which assumes it is
// the only one on the page (at most one reader is mounted; a second library PDF opens as a plain PDF).
import { markdownDocument } from '../lib/markdown-doc.mjs';
import { fileText } from '../lib/filetext.mjs';
import { baseName, parentOf } from '../lib/fsys.mjs';
import { displayFilePath } from '../lib/open-folders.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { kindOf, paperAt, fileItems } from './explorer.mjs';
import { TEXT_EXT } from '../lib/workspace.mjs';
import { get, update } from '../store.mjs';
import { askText } from '../lib/dialog.mjs';
import { textAnchor, locateAnchor, addFileNote } from '../lib/file-notes.mjs';
import { position, parseDelimited, writeDelimited } from '../lib/spreadsheet.mjs';
import { mountSpreadsheet } from './spreadsheet.mjs';
import { mountPdfFile } from './pdf-file.mjs';
import { openXlsx, saveXlsx } from '../lib/xlsx-edit.mjs';
import { openDocx, saveDocx } from '../lib/docx-edit.mjs';
import { previewDocx } from '../lib/docx-preview.mjs';
import { renderDocxPages } from '../lib/docx-pages.mjs';
import { COMMENT_W, commentColumn, commentAnchor, positionColumn, markComment as markCommentShown } from '../lib/comment-column.mjs';
import { uiBar, uiGroup } from '../lib/ui-actions.mjs';
import { wireRuns } from '../lib/topbar.mjs';
import { when as dateWhen } from '../lib/dates.mjs';
import { forEditor, forFile, hasBom, analyse } from '../lib/line-endings.mjs';
import * as reader from './reader.mjs';
import { isJsonFile, jsonMode } from './file-json.mjs';
import { imageViewer } from './image-viewer.mjs';

const TEXT_MAX = 256 * 1024;      // shown of a file too large to edit
const EDIT_MAX = 4 * 1024 * 1024;  // edited whole, or not at all
let seq = 0;
let readerOwner = null;            // the instance that has the reader mounted

/** The icon of a file's type, for its tab and its rows. */
export function typeIcon(rel, dir = false) {
  if (dir) return 'folder';
  const k = kindOf(rel), x = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  if (x === 'docx' || x === 'doc' || x === 'odt' || x === 'rtf') return 'manuscript';
  if (x === 'xlsx' || x === 'xls' || k === 'table') return 'table';
  if (k === 'pdf') return 'file-pdf';
  if (k === 'image') return 'image';
  if (x === 'md' || x === 'markdown' || x === 'txt' || k === 'text') return 'note';
  return 'file';
}
export const FILE_KINDS = { docx: 'Word document', doc: 'Word document', odt: 'Word document', rtf: 'Rich text', xlsx: 'Spreadsheet', xls: 'Spreadsheet', csv: 'CSV', tsv: 'TSV', pdf: 'PDF', md: 'Markdown', markdown: 'Markdown', txt: 'Text', pptx: 'Slides',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image', svg: 'Image', bmp: 'Image', avif: 'Image', tif: 'Image', tiff: 'Image', json: 'JSON', jsonl: 'JSON Lines', ndjson: 'JSON Lines', geojson: 'GeoJSON', r: 'R script', py: 'Python script' };

export const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/**
 * Mounts the document `rel` of `folder` into `host`.
 * @param {HTMLElement} host
 * @param {object} o
 * @param {string} o.rel
 * @param {object} o.folder        the folder adapter (lib/open-folders.mjs filesFolder) or a picked file
 * @param {object} o.ctx           the shell context (go, closeDocument, ...)
 * @param {(on: boolean) => void} o.onDirty    called when the unsaved state changes
 * @param {(text: string) => void} o.onDetail  the line under the name: where, size, modified
 * @param {(text: string) => void} o.say       a short report in the title bar
 * @param {() => void} o.onClose               the reader's own Close
 * @param {object|null} o.note                 a note whose selection to show once the file is up
 * @param {() => Promise<object[]>} [o.siblings]  an image's folder: its images in the folder page's order
 * @param {(rel: string) => void} [o.step]     an image: show another image of its folder in this tab
 * @param {boolean} [o.autofocus]              give the document the keyboard once it is up (an image stepped to)
 */
export function mountDocument(host, { rel, folder, ctx, onDirty = () => {}, onDetail = () => {}, say = () => {}, onClose = () => {}, note = null, picked = false, siblings = null, step = null, autofocus = false, page = 0 }) {
  const uid = `fd${++seq}`;
  let live = true;
  const inst = {
    rel, uid, kind: kindOf(rel), ready: null,
    urls: [], releasers: [],
    dirty: () => false, flush() {}, focus: () => null, reveal: () => false, save: async () => {},
    release() {
      live = false;
      inst.releasers.splice(0).reverse().forEach(f => { try { f(); } catch {} });
      inst.urls.splice(0).forEach(URL.revokeObjectURL);
      if (readerOwner === inst) { reader.unmount(); readerOwner = null; }
      host.replaceChildren();
    },
  };
  const isLive = () => live;
  host.classList.add('fv-host');
  host.innerHTML = `<div class="fv-body" aria-busy="true"><div class="fv-loading" role="status"><span class="fv-loading-spinner" aria-hidden="true"></span><span>Opening ${esc(baseName(displayFilePath(rel)))}…</span></div></div>`;
  const ops = { uid, inst, host, rel, folder, ctx, onDirty, onDetail, say, onClose, isLive, picked, siblings, step, autofocus, page };
  inst.ready = open(ops, note).catch(err => { if (live) { body(host).removeAttribute('aria-busy'); body(host).innerHTML = `<div class="note">${esc(err?.message || String(err))}</div>`; } });
  return inst;
}

const body = host => host.querySelector(':scope > .fv-body');

/**
 * Mounts a tool into `host`: a tab of the Files view that is not a file (the Kaplan–Meier digitiser, the table reader). `tool.mount(ops, { body, placeTools })`
 * draws it, its tools bar under the tab as a document's is; the tool keeps its own work, so a tab the page released draws itself again as it was.
 * `ops` is the document's: `uid`, `inst`, `ctx`, `say`, `onClose`, `isLive`.
 */
/** Whether a tool tab of this width puts its settings under the work and not beside it. */
export const toolStacks = width => width < 720;

export function mountToolTab(host, { rel, tool, ctx, say = () => {}, onClose = () => {} }) {
  const uid = `fd${++seq}`;
  let live = true;
  const inst = {
    rel, uid, kind: 'tool', ready: null, urls: [], releasers: [],
    dirty: () => false, flush() {}, focus: () => null, reveal: () => false, save: async () => true,
    release() {
      live = false;
      inst.releasers.splice(0).reverse().forEach(f => { try { f(); } catch {} });
      host.replaceChildren();
    },
  };
  host.classList.add('fv-host', 'fv-tool');
  host.innerHTML = '<div class="fv-body"></div>';
  const ops = { uid, inst, host, rel, ctx, say, onClose, isLive: () => live };
  inst.ready = Promise.resolve().then(() => live && tool.mount(ops, { body: body(host), placeTools: (o, spec, run) => placeTools(o, spec, run) }));
  return inst;
}

/** The tools bar of a document: built from the shared builders, its commands bound by id. */
function placeTools(ops, spec, run) {
  const { host, uid } = ops;
  host.querySelector(':scope > .fv-top')?.remove();
  const wrap = document.createElement('div'); wrap.className = 'fv-top';
  wrap.innerHTML = uiBar({ kind: 'tools', density: 'dense', id: `${uid}-tools`, ...spec, actions: strip(spec.actions), overflow: strip(spec.overflow) });
  host.prepend(wrap);
  wireRuns(wrap, [...(spec.actions || []).filter(a => a && typeof a === 'object' && typeof a.run === 'function'), ...(spec.overflow || []).filter(a => a && typeof a === 'object')]);
  run?.(wrap);
  return wrap;
}
const strip = list => (list || []).map(x => (x && typeof x === 'object' && !x.__ui ? (({ run, ...spec }) => spec)(x) : x));

async function open(ops, pendingNote) {
  const { host, rel, folder, ctx, inst, isLive } = ops;
  // Give the shell and loading status a paint before decoding local files.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  if (!isLive()) return;
  let st;
  try { st = await folder.stat(rel); } catch (err) { if (isLive()) body(host).innerHTML = `<div class="note">${esc(err.message)}</div>`; return; }
  if (!isLive()) return;
  if (!st.exists) { body(host).removeAttribute('aria-busy'); body(host).innerHTML = emptyState({ icon: 'warn', title: 'File not found' }); return; }
  // a session tab (a picked file, a library paper opened full size) is named by its source, not by its made-up folder; a size not known is left out
  ops.detail = [(!ops.picked && parentOf(displayFilePath(rel))) || folder.name, st.size ? size(st.size) : '', modified(st.mtime)].filter(Boolean).join(', ');
  ops.onDetail(ops.detail);
  const k = kindOf(rel), x = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  // a library paper opened full size from the document pane (files.openPaper) is a session tab that names its paper
  const paper = k === 'pdf' && (ops.picked ? folder.paperId && get().papers.find(p => p.id === folder.paperId) : paperAt(rel));
  const b = body(host);
  if (paper && !readerOwner) {
    // One viewer: the reader, here. A dock showing the same paper closes.
    ctx?.closeDocument?.();
    host.classList.add('fv-reader'); b.removeAttribute('aria-busy'); b.innerHTML = '';
    readerOwner = inst;
    reader.mount(b, { ...ctx, paperId: paper.id, closeDocument: ops.onClose });
    inst.focus = () => ({ kind: 'file', label: baseName(rel), detail: rel, paperId: paper.id });
    return;
  }
  const editable = TEXT_EXT.has(x) && x !== 'csv' && x !== 'tsv';
  const asText = ['odt', 'rtf', 'pptx'].includes(x);   // read as text (lib/filetext.mjs): paragraphs, or a slide at a time
  if (!['pdf', 'image', 'table'].includes(k) && !editable && x !== 'docx' && x !== 'xlsx' && !asText) { b.removeAttribute('aria-busy'); b.innerHTML = emptyState({ icon: 'file', title: 'Preview unavailable for this file type' }); return; }
  const bytes = await folder.read(rel);
  if (!isLive()) return;
  const status = b.querySelector('.fv-loading>span:last-child');
  if (status) status.textContent = x === 'xlsx' ? 'Preparing worksheets…' : x === 'docx' ? 'Preparing document…' : 'Preparing preview…';
  inst.focus = () => { const p = ops.picked ? null : paperAt(rel); return { kind: 'file', label: baseName(rel), detail: rel, ...(p ? { paperId: p.id } : {}) }; };
  let notes = null;
  if (k === 'pdf') notes = await pdfScroll(ops, bytes);
  else if (x === 'docx') notes = await docxEditor(ops, bytes, st);
  else if (x === 'xlsx' || x === 'csv' || x === 'tsv') notes = await spreadsheetEditor(ops, bytes, st, x);
  else if ((x === 'md' || x === 'markdown') && bytes.length <= EDIT_MAX) notes = markdownView(ops, bytes, st);
  else if (asText) {
    try { const ft = await fileText(rel, bytes); if (!isLive()) return; b.innerHTML = `<article class="fv-md">${ft.text.split(/\n{2,}|\n(?=\[\[slide)/).map(p => p.startsWith('[[slide') ? `<h3>${esc(p.slice(2, p.indexOf(']]')))}</h3>${p.slice(p.indexOf(']]') + 2).trim().split('\n').map(l => `<p>${esc(l)}</p>`).join('')}` : p.split('\n').map(l => `<p>${esc(l)}</p>`).join('')).join('')}</article>`; }
    catch (err) { b.innerHTML = emptyState({ icon: 'file', title: 'Could not read this file', detail: String(err.message || err) }); }
  } else if (editable && bytes.length <= EDIT_MAX) notes = editor(ops, bytes, st);
  else if (k === 'image') await imageViewer(ops, bytes, { body: b, placeTools });
  else {
    const text = new TextDecoder().decode(bytes.subarray(0, TEXT_MAX));
    b.innerHTML = `<pre class="fv-text">${esc(text)}</pre>${bytes.length > TEXT_MAX ? `<div class="meta fv-more">${size(TEXT_MAX)} of ${size(bytes.length)}</div>` : ''}`;
  }
  b.removeAttribute('aria-busy');
  if (notes && pendingNote) {
    try { const done = notes.reveal(pendingNote.anchor); if (!pendingNote.quiet) ops.say(typeof done === 'string' ? done : done ? 'Saved selection highlighted.' : 'The original selection changed or is ambiguous. The note keeps its original quote.'); }
    catch { if (!pendingNote.quiet) ops.say('The saved selection is no longer available.'); }
  }
}

const modified = ms => ms ? dateWhen(ms) : '';

/**
 * File PDFs scroll under one compact strip (views/pdf-file.mjs). A note made from a selection belongs to the file, as the other documents' notes do;
 * a library record of the file names its quotations; More holds the file's own commands (the explorer's Add to library, Reveal, Open).
 */
async function pdfScroll(ops, bytes) {
  const { host, inst, isLive, rel, folder, ctx } = ops;
  host.classList.add('fv-pdf-reader');
  const paper = ops.picked ? (folder.paperId && get().papers.find(p => p.id === folder.paperId)) : paperAt(rel);
  const add = !ops.picked && fileItems(rel).find(i => i?.label === 'Add to library');
  const dispose = await mountPdfFile(body(host), bytes, isLive, { uid: ops.uid, page: ops.page, name: baseName(displayFilePath(rel)), ctx,
    source: paper ? { label: paper.label || '', year: paper.year || '' } : null,
    noteSource: ops.picked ? null : { path: displayFilePath(rel), label: baseName(rel) },
    actions: { ...(add ? { add: add.run } : {}), ...(folder.can?.reveal ? { reveal: () => folder.reveal(rel) } : {}), ...(folder.can?.openExternal ? { open: () => folder.openExternal(rel) } : {}) } });
  if (!isLive()) { dispose(); return null; }
  inst.releasers.push(dispose);
  inst.pdf = dispose.view;
  // a note's place (Notes, Go to selection): the page with the quotation marked
  const reveal = a => dispose.view.reveal(a);
  inst.reveal = reveal;
  return { reveal };
}

/**
 * The Save command of a document's tools bar: one label, Save, enabled while there is something to save, and ⌘S. Where the file stands (Unsaved
 * changes, Saving, Saved) is the title bar's message, after the line that names its size and date, and not a control.
 */
function saveControls(ops, { dirty, write, stamp, saveEl }) {
  const { host, folder, rel, inst } = ops;
  let saving = false, current = stamp, lastDirty = false, done = false, shown = null;
  const paint = error => {
    const d = dirty();
    if (d) done = false;
    saveEl.disabled = saving || !d;
    saveEl.title = `${folder.download ? 'Save a copy' : 'Save'} (⌘S)`;
    if (d !== lastDirty) { lastDirty = d; ops.onDirty(d); }
    const state = saving ? 'Saving…' : d ? 'Unsaved changes' : done ? 'Saved' : '';
    if (state !== shown) { shown = state; ops.onDetail([ops.detail, state].filter(Boolean).join(', ')); }
    if (error) ops.say(error);
  };
  async function doSave() {
    if (saving || !dirty()) return !dirty();
    saving = true; paint();
    let error = '';
    try {
      const now = await folder.stat(rel);
      if (!now.exists || now.mtime !== current) throw new Error('Changed on disk. Reopen the file before saving.');
      current = await write(); done = true;
    } catch (err) { error = String(err?.message || err).slice(0, 100); }
    finally { saving = false; inst.lastError = error; paint(error); }
    return !dirty();
  }
  saveEl.onclick = doSave;
  body(host).addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); doSave(); }
  });
  inst.dirty = dirty; inst.save = doSave;
  paint();
  return paint;
}
const saveAct = ops => ({ id: `${ops.uid}-save`, label: 'Save', icon: 'save', role: 'secondary', keep: true, fold: 0, disabled: true, kbd: '⌘S' });
const noteOverflow = ops => [{ id: `${ops.uid}-note`, label: 'Add note' }, { id: `${ops.uid}-todo`, label: 'Add edit TODO' }, '-', { id: `${ops.uid}-notes`, label: 'Notes' }];

/** Markdown reads rendered; Edit shows its text in the editor, and back shows the edited text rendered. */
function markdownView(ops, bytes, st) {
  const { host } = ops, b = body(host);
  const notes = editor(ops, bytes, st, { edit: true });
  const ta = b.querySelector('textarea.fv-edit');
  const view = document.createElement('article'); view.className = 'fv-md';
  b.prepend(view);
  const toggle = host.querySelector(`[id="${ops.uid}-edit"]`);
  const show = editing => {
    toggle.setAttribute('aria-pressed', String(editing));
    b.classList.toggle('fv-editing', editing);
    ta.hidden = !editing; view.hidden = editing;
    if (editing) ta.focus(); else view.innerHTML = markdownDocument(ta.value);
  };
  toggle.onclick = () => show(toggle.getAttribute('aria-pressed') !== 'true');
  show(false);
  return notes;
}

/** A text or source file, edited whole and saved in place. */
function editor(ops, bytes, st, { edit = false } = {}) {
  const { host, folder, rel } = ops, b = body(host);
  // A textarea holds LF whatever the file had: the file's own line ending and byte order mark are kept and put back on save, and "edited" is measured
  // against what the textarea holds right after the file is put in it, so an untouched file is never edited.
  const text = new TextDecoder().decode(bytes), style = { ...analyse(text), bom: hasBom(bytes) };
  b.classList.add('fv-editing');
  b.innerHTML = `<textarea class="fv-edit" spellcheck="false" autocomplete="off" aria-label="${esc(baseName(rel))}"></textarea>`;
  const ta = b.querySelector('textarea'); ta.value = forEditor(text);
  let saved = ta.value;
  // a JSON file adds its status, Text | Tree, Format and the options to the bar (views/file-json.mjs)
  const json = !edit && isJsonFile(rel) ? jsonMode(ops, { ta, b }) : null;
  const actions = [...(edit ? [{ id: `${ops.uid}-edit`, label: 'Edit', icon: 'note', role: 'secondary', pressed: false }] : []), ...(json?.actions || []), saveAct(ops)];
  const noteHooks = noteHandlers(ops, () => textAnchor(ta.value, ta.selectionStart, ta.selectionEnd), a => { const found = locateAnchor(ta.value, a); if (!found) return false; ta.focus(); ta.setSelectionRange(found.start, found.end); return true; });
  const bar = placeTools(ops, { label: json ? 'JSON file tools' : 'Text file tools', ...(json?.spec || {}), actions, overflow: [...(json?.overflow || []), ...noteOverflow(ops).map(withRun(noteHooks))] });
  const paint = saveControls(ops, {
    stamp: st.mtime, saveEl: bar.querySelector(`[id="${ops.uid}-save"]`),
    dirty: () => ta.value !== saved,
    write: async () => { const now = ta.value; const t = await folder.writeText(rel, forFile(now, style)); saved = now; return t; },
  });
  noteHooks.wire(bar);
  ta.addEventListener('input', () => paint());
  json?.wire(bar);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); paint(); }
  });
  return noteHooks;
}

/**
 * Structured Word preview with an explicit paragraph text editing mode. Saving rewrites only the paragraphs that changed; styles, tables, figures
 * and everything else in the file are left as they were (lib/docx-edit.mjs).
 */
async function docxEditor(ops, bytes, st) {
  const { host, folder, rel, inst, isLive } = ops, b = body(host);
  let current = bytes;
  const previewUrls = [];
  const results = await Promise.allSettled([openDocx(bytes), previewDocx(bytes, (data, type) => {
    const url = URL.createObjectURL(new Blob([data], { type })); previewUrls.push(url); return url;
  })]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) { previewUrls.forEach(URL.revokeObjectURL); throw failed.reason; }
  const [d, preview] = results.map(r => r.value);
  if (!isLive()) { previewUrls.forEach(URL.revokeObjectURL); return null; }
  inst.urls.push(...previewUrls);
  host.classList.add('fv-word');
  b.classList.add('fv-word-body');
  const u = ops.uid;
  b.innerHTML = `<div class="fv-doc-scroll" tabindex="0" aria-label="Document pages">
    <div class="fv-doc-stage"><div class="fv-doc-layout" role="document" aria-label="${esc(baseName(rel))}"></div><article class="fv-doc" aria-label="${esc(baseName(rel))}"${preview.pageStyle} hidden>${preview.html}</article></div>
  </div>`;
  const page = b.querySelector('.fv-doc'), viewport = b.querySelector('.fv-doc-scroll'), stage = b.querySelector('.fv-doc-stage');
  let zoom = 1, fit = true, editing = false;
  const changed = new Map(), original = new Map();
  const noteHooks = noteHandlers(ops, () => {
    const sel = getSelection(); if (!sel?.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0), p = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).closest('.fv-p');
    if (!p || !p.contains(range.endContainer)) return null;
    const before = range.cloneRange(); before.selectNodeContents(p); before.setEnd(range.startContainer, range.startOffset);
    return textAnchor(p.textContent, before.toString().length, before.toString().length + range.toString().length, { paragraph: +p.dataset.i });
  }, a => {
    const ps = [...b.querySelectorAll('.fv-p')]; const candidates = ps.map(p => ({ p, at: locateAnchor(p.textContent, a) })).filter(x => x.at); const found = candidates.find(x => +x.p.dataset.i === a.paragraph) || (candidates.length === 1 ? candidates[0] : null); if (!found) return false;
    const walker = document.createTreeWalker(found.p, NodeFilter.SHOW_TEXT), r = document.createRange(); let node, offset = 0, start = false;
    while (node = walker.nextNode()) { const end = offset + node.length; if (!start && found.at.start <= end) { r.setStart(node, found.at.start - offset); start = true; } if (found.at.end <= end) { r.setEnd(node, found.at.end - offset); break; } offset = end; }
    found.p.focus(); getSelection().removeAllRanges(); getSelection().addRange(r); found.p.scrollIntoView({ block: 'nearest' }); return true;
  });
  const bar = placeTools(ops, {
    label: 'Word document tools',
    actions: [
      uiGroup({ id: `${u}-zoom`, label: 'Zoom', fold: 4, items: [{ id: `${u}-zoom-out`, label: 'Zoom out', icon: 'minus' }, { readout: '100%', id: `${u}-zoom-level`, label: 'Zoom level', ch: 6 }, { id: `${u}-zoom-in`, label: 'Zoom in', icon: 'plus' }] }),
      { id: `${u}-fit`, label: 'Fit width', icon: 'fit', role: 'quiet', fold: 5 },
      { id: `${u}-edit`, label: 'Edit text', icon: 'manuscript', role: 'secondary', pressed: false },
      saveAct(ops),
    ],
    overflow: noteOverflow(ops).map(withRun(noteHooks)),
    budget: { n: 4, reason: 'a Word file: zoom, fit, edit and save' },
  });
  const q = id => bar.querySelector(`[id="${u}-${id}"]`);
  // Read, the file is laid out as the Manuscript view lays it out (lib/docx-pages.mjs);
  // editing its text uses the structured page, which saves only the paragraphs changed.
  const layout = b.querySelector('.fv-doc-layout');
  let layoutWidth = preview.width, comments = [];
  const showLayout = on => { layout.hidden = !on; page.hidden = on; if (!on) placeComments(); };
  // The file's comments stand in the editor's column beside the pages, read-only, each level with the text its range covers in the laid-out pages.
  const commentsShown = () => !layout.hidden && comments.length > 0;
  const placeComments = () => {
    viewport.querySelector(':scope > .ms-comments')?.remove();
    viewport.classList.toggle('has-comments', commentsShown());
    viewport.dataset.reserve = String(commentsShown() ? COMMENT_W : 0);
    if (!commentsShown()) return;
    const col = commentColumn(comments);
    viewport.append(col);
    col.querySelectorAll('[data-cm-card]').forEach(card => { card.onclick = () => {
      markCommentShown(viewport, layout, card.dataset.cmCard);
      commentAnchor(layout, card.dataset.cmCard)?.scrollIntoView({ block: 'nearest' });
    }; });
    positionColumn(viewport, layout);
  };
  layout.addEventListener('click', e => {
    const at = e.target.closest?.('.tc-cm[data-cm],.tok.comment[data-comment]');
    if (!at) return;
    const id = at.dataset.comment || at.dataset.cm.split(' ')[0];
    markCommentShown(viewport, layout, id);
    viewport.querySelector(`[data-cm-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  });
  const drawLayout = async () => {
    showLayout(true);
    try { const r = await renderDocxPages(layout, current); inst.urls.push(...r.urls); layoutWidth = r.width; comments = r.comments || []; }
    catch { showLayout(false); }
    setZoom();
    placeComments();
  };
  const setZoom = () => {
    const width = layout.hidden ? preview.width : layoutWidth;
    // With comments, the column takes its width at the right and the pages are centred in the rest.
    const reserve = commentsShown() ? COMMENT_W : 0;
    viewport.style.setProperty('--fv-reserve', `${reserve}px`);
    if (fit) zoom = Math.min(1, Math.max(.25, (viewport.clientWidth - 48 - reserve) / width));
    // The laid-out pages are painted smaller or larger, never re-flowed: a CSS zoom sets their text again at each scale, and a line a little taller
    // than the one the cuts were made with runs the page's last row past its foot.
    if (layout.hidden) { page.style.zoom = zoom; stage.style.height = ''; }
    else {
      layout.style.setProperty('--fv-layout-w', `${layoutWidth}px`); layout.style.transform = `scale(${zoom})`;
      stage.style.height = `${layout.offsetHeight * zoom}px`;
    }
    stage.style.width = `${width * zoom}px`;
    positionColumn(viewport, layout);
    const level = q('zoom-level'); if (level) level.textContent = `${Math.round(zoom * 100)}%`;
    q('zoom-out').disabled = zoom <= .25;
    q('zoom-in').disabled = zoom >= 2;
    q('fit').setAttribute('aria-pressed', String(fit));
  };
  for (const [id, delta] of [['zoom-out', -.1], ['zoom-in', .1]]) q(id).onclick = () => { fit = false; zoom = Math.min(2, Math.max(.25, zoom + delta)); setZoom(); };
  q('fit').onclick = () => { fit = true; setZoom(); };
  q('edit').onclick = e => {
    editing = !editing; page.classList.toggle('is-editing', editing);
    // Editing shows the structured page; done, the laid-out pages come back once nothing is unsaved.
    if (editing) { showLayout(false); setZoom(); } else if (!changed.size) drawLayout();
    // The page is one editing host, so a selection runs across paragraphs as in Word.
    page.contentEditable = editing ? 'plaintext-only' : 'false'; page.spellcheck = editing;
    e.currentTarget.setAttribute('aria-pressed', String(editing));
  };
  page.addEventListener('pointerdown', () => { if (!editing) viewport.focus({ preventScroll: true }); });
  viewport.addEventListener('keydown', e => {
    if (!editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopPropagation();
      const range = document.createRange(); range.selectNodeContents(page);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }
  });
  const resize = new ResizeObserver(setZoom); resize.observe(viewport); setZoom();
  inst.releasers.push(() => resize.disconnect());
  noteHooks.wire(bar);
  // Paragraph i -> new text, or null when its element is gone (merged into another by a deletion across paragraphs). Found by comparing the page with
  // the file after each edit, so the browser's own undo stays correct.
  const fixed = new Set(d.paragraphs.filter(p => p.fixed).map(p => p.i));
  const paint = saveControls(ops, {
    stamp: st.mtime, saveEl: q('save'),
    dirty: () => changed.size > 0,
    write: async () => {
      const edits = [...changed].map(([i, text]) => text === null ? { i, remove: true } : { i, text });
      const out = await saveDocx(current, edits);
      const next = out instanceof Uint8Array ? out : new Uint8Array(await out.arrayBuffer());
      const t = await folder.replaceBytes(rel, next);
      current = next;
      // A removed paragraph leaves the file, and those after it move up one.
      const gone = edits.filter(x => x.remove && !fixed.has(x.i)).map(x => x.i);
      for (const x of edits) if (!gone.includes(x.i)) original.set(x.i, x.remove ? '' : x.text);
      if (gone.length) {
        const shift = i => i - gone.filter(g => g < i).length;
        const kept = [...original].filter(([i]) => !gone.includes(i)), keptFixed = [...fixed];
        original.clear(); kept.forEach(([i, text]) => original.set(shift(i), text));
        fixed.clear(); keptFixed.forEach(i => fixed.add(shift(i)));
        page.querySelectorAll('.fv-p[data-i]').forEach(p => { p.dataset.i = shift(+p.dataset.i); });
      }
      changed.clear();
      if (!editing) drawLayout();
      return t;
    },
  });
  // Text as saved: runs, tabs, and line breaks; images and other non-text parts add nothing.
  const textOf = node => [...node.childNodes].map(c => c.nodeType === 3 ? c.data : c.nodeName === 'BR' ? '\n'
    : c.nodeType === 1 && c.getAttribute('contenteditable') !== 'false' ? textOf(c) : '').join('');
  const pageText = () => {
    const seen = new Map();
    for (const p of page.querySelectorAll('.fv-p[data-i]')) {
      const i = +p.dataset.i, text = textOf(p).replace(/\n$/, '');
      seen.set(i, seen.has(i) ? `${seen.get(i)}\n${text}` : text);
    }
    return seen;
  };
  // The baseline is the page as drawn, not the file's text: a paragraph the preview renders slightly differently, or not at all, is never "changed".
  for (const [i, text] of pageText()) original.set(i, text);
  const sync = () => {
    const seen = pageText();
    changed.clear();
    for (const [i, text] of original) {
      if (!seen.has(i)) { if (text || !fixed.has(i)) changed.set(i, null); }
      else if (seen.get(i) !== text) changed.set(i, seen.get(i));
    }
    paint();
  };
  page.addEventListener('beforeinput', e => {
    if (!editing) return;
    const target = e.getTargetRanges?.()[0], sel = getSelection();
    const range = document.createRange();
    if (target) { range.setStart(target.startContainer, target.startOffset); range.setEnd(target.endContainer, target.endOffset); }
    else if (sel?.rangeCount) range.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    else return;
    const at = range.startContainer, hostP = (at.nodeType === 1 ? at : at.parentElement)?.closest('.fv-p');
    // Text typed between tables or pages has no paragraph to belong to, and a figure cannot be deleted here: saving keeps it, so the page must too.
    if (e.inputType.startsWith('insert') && !hostP) e.preventDefault();
    else if (e.inputType.startsWith('delete') && [...page.querySelectorAll('img')].some(img => range.intersectsNode(img))) e.preventDefault();
  });
  page.addEventListener('input', sync);
  await drawLayout();
  return noteHooks;
}

/** One selection-aware editor for Excel workbooks, CSV and TSV files. */
async function spreadsheetEditor(ops, bytes, st, ext) {
  const { host, folder, rel, inst, isLive } = ops, b = body(host);
  let current = bytes, format = null;
  if (ext !== 'xlsx' && bytes.length > EDIT_MAX) throw new Error('This delimited file is too large to edit here (4 MB limit).');
  const wb = ext === 'xlsx' ? await openXlsx(bytes) : (() => {
    format = parseDelimited(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), ext === 'tsv' ? '\t' : ',');
    return { sheets: [{ name: baseName(rel), rows: format.rows, formulas: {} }] };
  })();
  if (!isLive()) return null;
  let paint = () => {};
  host.classList.add('fv-workbook');
  let viewer = null;
  const noteHooks = noteHandlers(ops, () => viewer.selection(), a => viewer.revealSelection(a));
  // The sheet draws its own one row of commands (find, filter, history, download, Ask AI and one More): Save and the note commands are entries of that
  // More, and where the file stands is the title bar's line, so no row of the document's own stands above the formula bar.
  viewer = mountSpreadsheet(b, wb, { name: rel, onDirtyChange: () => paint(), say: ops.say, restore: () => ops.onDetail([ops.detail, viewer.dirty() ? 'Unsaved changes' : ''].filter(Boolean).join(', ')),
    tools: { overflow: [{ id: `${ops.uid}-save`, label: 'Save', disabled: true }, ...noteOverflow(ops).map(withRun(noteHooks))], wire: bar => noteHooks.wire(bar) } });
  inst.releasers.push(() => viewer.dispose());
  inst.flush = () => viewer.flush();
  inst.focus = () => viewer.focus();
  paint = saveControls(ops, {
    stamp: st.mtime, saveEl: viewer.bar.querySelector(`[id="${ops.uid}-save"]`),
    dirty: () => viewer.dirty(),
    write: async () => {
      viewer.flush();
      const edits = viewer.model.edits();
      let next;
      if (ext === 'xlsx') next = await saveXlsx(current, edits);
      else {
        const rows = wb.sheets[0].rows.map(row => [...row]);
        for (const e of edits) { const p = position(e.cell); (rows[p.row] ||= [])[p.col] = e.value; }
        // Fill sparse cells so their positions are preserved in delimited output.
        for (let r = 0; r < rows.length; r++) rows[r] = Array.from(rows[r] || [], value => value ?? '');
        next = new TextEncoder().encode(writeDelimited(rows, format));
      }
      const stamp = await folder.replaceBytes(rel, next);
      current = next; viewer.model.saved(edits);
      return stamp;
    },
  });
  b.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { viewer.flush(); paint(); }
  }, true);
  const flushed = inst.dirty;
  inst.dirty = () => { viewer.flush(); return flushed(); };
  return noteHooks;
}

// ---- notes ----------------------------------------------------------------------------------------------------------------

const withRun = hooks => entry => (entry === '-' ? entry : { ...entry, run: hooks.run(entry.id) });

/**
 * The note commands of a document (Add note, Add edit TODO, Notes), kept in the tools bar's More. The selection is taken when More is pressed,
 * before focus moves, and again by ⌘⇧M.
 */
function noteHandlers(ops, capture, revealAnchor) {
  const { host, uid, ctx, say, rel } = ops;
  let anchor = null;
  const snapshot = () => { try { anchor = capture(); } catch (err) { say(err.message); anchor = null; } };
  const save = async isTodo => {
    if (!anchor) snapshot();
    if (!anchor || anchor.kind === 'text' && !anchor.quote) { say('Select text in one paragraph or select cells first.'); return; }
    const held = anchor, text = await askText(isTodo ? 'Add edit TODO' : 'Add note', { placeholder: isTodo ? 'Describe the edit to make' : 'Write a note about this selection' }); anchor = null;
    if (!text?.trim()) return;
    update(s => { addFileNote(s, { text, anchor: held, source: { path: displayFilePath(rel), label: baseName(rel) }, todo: isTodo }); return s; });
    say(isTodo ? 'Edit TODO saved in Notes and project tasks.' : 'Note saved in Notes.');
  };
  const hooks = {
    run: id => id === `${uid}-note` ? () => save(false) : id === `${uid}-todo` ? () => save(true) : id === `${uid}-notes` ? () => ctx.go('notes') : () => {},
    reveal: a => revealAnchor(a),
    wire(bar) {
      bar.addEventListener('pointerdown', () => snapshot(), true);
      host.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); snapshot(); save(false); } });
    },
  };
  ops.inst.reveal = a => hooks.reveal(a);
  return hooks;
}

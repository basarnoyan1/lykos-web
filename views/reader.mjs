// Reader: PDF with evidence anchoring. Selecting text and naming a field
// produces a value carrying its exact wording, a document hash, a page and the
// rectangles it came from (plan 5.1, F4).
//
// The pane is a head (the docked pane only), the document strip, the page column and one permanent foot (views/reader-bars.mjs declares them
// all). The foot is one region of five bars that replace each other, so opening a selection, a mark or a region never moves the page. What used to be
// drawn above the viewer, the notes and the suggested values, lives in the inspector's Details (`inspect`), and what an action reports is the foot's
// message; nothing is inserted between the strip and the page.
import { previewArticle } from '../lib/preview-cache.mjs';
import { retrievePaper } from '../lib/paper-download.mjs';
import { get, getVersion, update } from '../store.mjs';
import { fields, setAnchoredValue } from '../lib/fields.mjs';
import { loadPdf, renderPage, captureSelection, drawHighlights, normalise, rectToBox,
         locateQuote } from '../lib/anchor.mjs';
import { configured, suggestValues } from '../lib/ai.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { getBytes, getHandle } from '../lib/files.mjs';
import { saveFile } from '../lib/save.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { inDesktop, inHostedTab, revealPathNative, openPathNative } from '../lib/native.mjs';
import { formatReference } from '../lib/cite.mjs';
import { unchecked, checkedStamp } from '../lib/progress.mjs';
import { readPath } from '../lib/folders.mjs';
import { fileText } from '../lib/filetext.mjs';
import { evidenceLabel } from '../lib/evidence.mjs';
import { addQuote } from '../lib/qes.mjs';
import { ask } from '../lib/dialog.mjs';
import { researchType } from '../lib/workflow.mjs';
import { journalContext } from '../lib/journal-context.mjs';
import { attachRegion } from './reader-region.mjs';
import { ocrItems, textContentFrom, ocrAvailable } from '../lib/ocr.mjs';
import { annotationsOf, addAnnotation, editAnnotation, removeAnnotation, importAnnotations, dismissImport, importOffer, KIND_LABEL, pdfToBox, fromPdfAnnotations } from '../lib/annotations.mjs';
import { index as docIndex } from '../lib/doctext.mjs';
import { queuePaper } from '../lib/fulltext-index.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiReview, uiReviewList, regionShow, watchWidth } from '../lib/ui-actions.mjs';
import { FOOT_STATES, assignSpec, footHtml, headSpec, noteFormSpec, noteKindLabel, stripSpec, topHtml, railHtml } from './reader-bars.mjs';
import { pdfText, attachFind, attachRail, drawHits, isKey } from './pdf-tools.mjs';
import { createLookup } from './reference-lookup.mjs';
import { flag } from '../lib/pdf-view-state.mjs';
import { quoteWithCite, showQuote, cite, pageLabel } from '../lib/pdf-cite.mjs';
import { attachClearSelection } from '../lib/pdf-clear-select.mjs';
import { labels as printedLabels } from '../lib/pdf-outline.mjs';
import { STEPS, fitScale, stepScale, landTop, placeBox, sizeStage } from '../lib/reader-geometry.mjs';
import { pagedList, wirePagedList, EDITOR_PAGE_SIZE } from '../lib/paged-list.mjs';

const qualitative = () => researchType(get()).id === 'qualitative-review';

export const meta = { title: 'Reader', icon: 'book' };

let host = null, ctxRef = null;

/** Opens a document beside the current work. */
export function mount(el, ctx) { host = el; ctxRef = ctx; drawReader(el, ctx); }
// The fixture page draws every registered module with render(host, ctx); a pane has no other entry.
export const render = mount;
export function unmount() {
  mountEpoch++; io?.disconnect(); widthOff?.(); regionApi?.detach?.(); regionApi = null; widthOff = null;
  find?.dispose(); rail?.dispose(); find = null; rail = null; lookup?.reset(); lookup = null;
  doc?.destroy?.(); doc = null; stages.clear(); sugg = []; sections = () => [];
  const c = ctxRef; host = null; ctxRef = null;
  c?.refreshDetails?.();
}
export function reflow() { if (host && doc) showCurrent(); }
/** What the reader shows, for model actions and the assistant: the paper and the page. */
export function focus() {
  if (!host || !paperId) return null;
  const p = get().papers.find(x => x.id === paperId);
  // The page shown is the one mostly in view; a selection may sit on the next
  // one down, and evidence taken from it belongs to the page it is on.
  let selectionPage = null;
  const sel = getSelection?.();
  if (sel?.rangeCount && host.contains(sel.anchorNode))
    for (const [n, st] of stages) if (st.el.contains(sel.anchorNode)) { selectionPage = n; break; }
  return { paperId, label: p?.label || '', page, pages, selectionPage };
}
export function context() { return host && paperId ? { paper_id: paperId, page, selected_text: pending?.text || '' } : null; }
/** The inspector's sections for the open document: the suggested values, when there are any, and the notes. The shell asks on every draw of Details. */
export function inspect() { return host && paperId ? sections() : []; }

// A view can be re-mounted while its previous mount is still loading a PDF.
// Two concurrent loads deadlock the PDF.js worker, so each mount takes an
// epoch, abandons its work as soon as a newer mount exists, and destroys the
// document it opened.
let mountEpoch = 0;
let doc = null, hash = null, pages = 1, page = 1, pending = null, paperId = null, io = null, widthOff = null, regionApi = null;
// Find and the page rail are the Files viewer's (views/pdf-tools.mjs), attached to each document once it is open; `pageLabels` the printed numbers.
let find = null, rail = null, pageLabels = null, lookup = null;   // lookup: Look up reference, its result a section of the inspector (views/reference-lookup.mjs)
const readerRail = flag('lykos.pdf-previews', true);
// Zoom is explicit and remembered: `fitMode` tracks the pane (width or page); `custom` is a scale chosen with the zoom buttons, which holds
// until Fit is chosen again, so the page does not silently resize when the window changes.
// `actual` says the 100% came from Actual size, so the picker reads it; a zoom that steps onto 100% reads Custom.
let fitMode = 'width', custom = null, actual = false;
// Open full size closes the docked pane and opens the same paper in a Files tab; the reader that draws it there lands on this page (the zoom above
// is the module's and carries over by itself).
let landing = null;
// Pages are laid out in one scrolling column. Each page has its own stage and,
// once rendered, its own viewport; locators convert through the viewport of
// the page they belong to, never a global one.
const stages = new Map();      // page -> { el, viewport }
const stageFor = n => stages.get(n)?.el || null;
const viewportFor = n => stages.get(n)?.viewport || null;
let showCurrent = () => {};
let sections = () => [];       // the inspector's sections, rebuilt by each mount
let sugg = [];                 // values the model suggested for this document, waiting for a person
let suggSeq = 0;
let noteDraft = { paper: null, kind: 'quote', text: '' };   // what was typed in the note form: a redraw of Details must not lose it
const openSugg = new Set();

/** The text of a message slot, and its tooltip (the slot clips long text). */
const setMsg = (el, text = '') => { if (!el) return; el.textContent = text; el.title = text; };

/** A quote from a docx, xlsx or text file: the file's text with the located span marked. */
async function renderFileEvidence(el, ctx) {
  // a quoted file replaces a PDF that may still be open here: its width watcher and its tools go with it (a later layout would find no strip)
  mountEpoch++; io?.disconnect(); widthOff?.(); widthOff = null; find?.dispose(); rail?.dispose(); find = null; rail = null;
  const { file, locator, quote } = ctx.locator, name = file.split('/').pop();
  el.innerHTML = `<div class="reader">${ctx.head === false ? '' : `<div class="reader-top">${uiBar(headSpec({ title: name, detail: evidenceLabel({ kind: 'file', path: file, locator }).slice(name.length).trim() }))}</div>`}
    <div class="file-evidence" id="file-text" tabindex="0" role="region" aria-label="Quoted file">Reading</div></div>`;
  const close = el.querySelector('#close'); if (close) close.onclick = () => ctx.closeDocument();
  try {
    const bytes = await readPath(file);
    const ft = await fileText(file.split('/').pop(), bytes);
    const at = quote ? ft.text.indexOf(quote) : -1;
    const box = el.querySelector('#file-text');
    box.innerHTML = at >= 0 ? `${esc(ft.text.slice(0, at))}<mark>${esc(quote)}</mark>${esc(ft.text.slice(at + quote.length))}` : esc(ft.text);
    box.querySelector('mark')?.scrollIntoView({ block: 'center' });
  } catch (err) { el.querySelector('#file-text').textContent = `Could not read the file: ${err.message}`; }
}

function drawReader(el, ctx) {
  if (ctx.locator?.file) { renderFileEvidence(el, ctx); return; }
  const mine = ++mountEpoch;
  io?.disconnect(); widthOff?.(); regionApi?.detach?.(); regionApi = null; stages.clear(); pending = null; sugg = []; openSugg.clear();
  find?.dispose(); rail?.dispose(); find = null; rail = null; pageLabels = null; lookup?.reset(); lookup = null;
  const live = () => mine === mountEpoch;
  if (doc) { doc.destroy?.(); doc = null; }
  const papers = get().papers || [];
  const want = papers.find(p => p.id === ctx.paperId) || papers.find(p => p.pdf || p.pdfRetrieval?.status === 'preview');
  if (!want) {
    el.innerHTML = emptyState({ icon: 'paperclip', title: 'No document attached',
      actions: [{ id: 'e-lib', label: 'Library', icon: 'library' }] });
    el.querySelector('#e-lib').onclick = () => ctx.go?.('library');
    return;
  }
  if (noteDraft.paper !== want.id) noteDraft = { paper: want.id, kind: 'quote', text: '' };
  const docked = !!ctx.head;
  el.innerHTML = `<div class="reader">
    ${docked ? `<div class="reader-top">${uiBar(headSpec({ title: want.label || want.title || 'Document', pdf: true }))}</div>` : ''}
    <div class="reader-strip">${topHtml('rd', stripSpec({ ocr: ocrAvailable(), suggest: configured(modelFor('extract')) }))}</div>
    <div class="fv-pdf-workspace"><div id="viewer" tabindex="0" role="region" aria-label="Document pages"></div></div>
    <div class="reader-end">${footHtml({ qualitative: qualitative() })}</div>
  </div>`;

  const q = id => el.querySelector(`#${id}`);
  const viewer = q('viewer'), footRegion = q('rd-foot');
  const stripEl = {
    prev: q('rd-prev'), next: q('rd-next'), page: q('rd-page'), of: q('rd-of'), out: q('rd-zoom-out'), level: q('rd-zoom-level'),
    in: q('rd-zoom-in'), fit: q('rd-fit'),
  };
  // Without a document the page controls say nothing and press nothing.
  const FIT_LABEL = { width: 'Fit width', page: 'Fit page', actual: 'Actual size', custom: 'Custom' };
  const toolIds = ['rd-region', 'rd-tables', 'rd-ocr', 'rd-suggest'];
  let natural = null;   // page 1 at scale 1, for placeholder heights and fit
  let layoutScale = 1;  // the scale the pages in the column were laid out and drawn at

  // ---- the foot: five bars in one cell; the state is derived, never stored twice ----
  let editing = null, regionOn = false, offerOpen = false;
  function footState() { return regionOn ? 'region' : editing ? 'annotate' : pending ? 'assign' : offerOpen ? 'offer' : 'idle'; }
  // The foot lies over the page column's lower edge and is drawn only while it has something to say or do: an idle foot with no message
  // would be a dead band above the status bar, and a foot in flow would move the pages when a selection brings it up.
  const footEnd = footRegion.closest('.reader-end');
  const quietFoot = () => { const quiet = footState() === 'idle' && !q('rd-say')?.textContent; if (footEnd.hidden !== quiet) footEnd.hidden = quiet; };
  function paintFoot() { const s = footState(); regionShow(footRegion, FOOT_STATES.indexOf(s)); footRegion.dataset.state = s; quietFoot(); }
  /** What an action reports, in the idle bar (and in the region bar while a box is drawn: the other bars have their own words). */
  function say(text = '') { setMsg(q('rd-say'), text); if (regionOn && text) setMsg(q('rd-region-info'), text); quietFoot(); }

  const innerSize = () => {
    const cs = getComputedStyle(viewer);
    return { w: viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: viewer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
  };
  const scaleNow = () => { const s = innerSize(); return custom ?? fitScale({ mode: fitMode, avail: s.w, availH: s.h, natural }); };

  /** The strip's readouts and the controls that cannot be pressed now. */
  function syncStrip() {
    const open = !!doc, scale = open ? (custom ?? layoutScale) : 0;
    if (document.activeElement !== stripEl.page) stripEl.page.value = open ? String(page) : '1';
    stripEl.page.max = String(open ? pages : 999);
    stripEl.page.disabled = !open;
    stripEl.prev.disabled = !open || page <= 1; stripEl.next.disabled = !open || page >= pages;
    stripEl.of.textContent = open ? `of ${pages}` : '';
    stripEl.level.textContent = open ? `${Math.round(scale * 100)}%` : '';
    stripEl.out.disabled = !open || scale <= STEPS[0] + 1e-6; stripEl.in.disabled = !open || scale >= STEPS.at(-1) - 1e-6;
    const value = stripEl.fit.querySelector('.ui-picker-value'), label = FIT_LABEL[custom == null ? fitMode : actual && custom === 1 ? 'actual' : 'custom'];
    if (value && value.textContent !== label) { value.textContent = label; stripEl.fit.setAttribute('aria-label', `Fit: ${label}`); }
    stripEl.fit.disabled = !open;
    for (const id of ['rd-region', 'rd-tables', 'rd-find', 'rd-previews']) { const b = q(id); if (b) b.disabled = !open; }
    rail?.follow();
    const notes = q('rd-notes'); if (notes) notes.disabled = !paperId;
  }
  syncStrip();

  // ---- the docked pane's head: the ways out of a preview (views/reader-bars.mjs headSpec). Nothing is kept: the bytes are read when asked for. ----
  const paperNow = () => get().papers.find(x => x.id === (paperId || want.id)) || want;
  const fileName = p => {
    const named = typeof p.pdfName === 'string' && p.pdfName.trim() ? p.pdfName.trim() : p.pdfRel ? p.pdfRel.split('/').pop() : String(p.label || p.title || 'Document').replace(/[/\\:]+/g, ' ').trim().slice(0, 120);
    return /\.pdf$/i.test(named) ? named : `${named}.pdf`;
  };
  /** The file on disk, when there is one: in the project folder, or a linked file in a folder the person chose. A copy the app keeps has none. */
  async function onDisk(p) {
    const folder = activeFolder();
    if (p.pdfRel && folder?.kind === 'path') return { path: folder.abs(p.pdfRel), reveal: () => folder.reveal(p.pdfRel), open: () => folder.openExternal(p.pdfRel) };
    if (p.pdfMode === 'copy' || p.pdfRel || !inDesktop()) return null;
    const handle = await getHandle(p.id).catch(() => null);
    return handle?.path ? { path: handle.path, reveal: () => revealPathNative(handle.path), open: () => openPathNative(handle.path) } : null;
  }
  async function saveCopy() {
    const b = q('rd-save-copy');
    if (!b || b.disabled || !doc) return;
    const p = paperNow(), target = doc;
    b.disabled = true;
    try {
      const bytes = await getBytes(p.id).catch(() => null) || await target.getData();
      const where = await saveFile(bytes, fileName(p), 'application/pdf');
      if (live() && where) say(`Copy saved: ${where}`);
    } catch (err) { if (live()) say(`Not saved: ${err.message || err}`); }
    finally { if (live()) b.disabled = !doc; }
  }
  async function openFull() {
    if (!doc || q('rd-full')?.disabled) return;
    const p = paperNow(), at = page;
    ctx.closeDocument?.();
    landing = { paperId: p.id, page: at };
    const files = await import('./files.mjs');
    files.openPaper(p);
    ctx.go?.('files');
  }
  if (docked) {
    const copy = (text, done) => navigator.clipboard.writeText(text).then(() => say(done), () => say(text));
    q('rd-full').onclick = openFull;
    q('rd-save-copy').onclick = saveCopy;
    q('rd-copy-citation').onclick = () => {
      copy(formatReference(paperNow(), journalContext(get()).referenceStyle), 'Citation copied');
    };
    onDisk(want).then(file => {
      if (!file || !live()) return;
      for (const id of ['rd-reveal', 'rd-open-default', 'rd-copy-path']) q(id).disabled = false;
      const fail = err => say(String(err?.message || err));
      q('rd-reveal').onclick = () => Promise.resolve().then(file.reveal).catch(fail);
      q('rd-open-default').onclick = () => Promise.resolve().then(file.open).catch(fail);
      q('rd-copy-path').onclick = () => copy(file.path, 'Path copied');
    }, () => {});
    // ⌘↵ opens the file full size and ⌘S saves a copy, while the pane has the keyboard (a field of the foot keeps its own Enter).
    el.querySelector('.reader').addEventListener('keydown', e => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === 'Enter' && !e.target.closest?.('.reader-end')) { e.preventDefault(); e.stopPropagation(); openFull(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); saveCopy(); }
    });
  }

  /** Words in the page column itself, for the time before there is a page or when there cannot be one. */
  function viewerNote(text) {
    viewer.dataset.empty = '';
    viewer.innerHTML = `<div class="reader-state" role="status">${esc(text)}</div>`;
  }
  function failed(err) {
    const noPdf = /desktop app/.test(err.message);
    viewer.dataset.empty = '';
    viewer.innerHTML = `<div class="reader-state">${emptyState({ icon: 'file-pdf', title: noPdf ? 'No PDF for this paper' : 'The PDF could not be opened',
      detail: noPdf ? 'Papers are retrieved in the desktop app.' : String(err.message || err).slice(0, 200),
      // a browser tab cannot retrieve papers: the state says so and offers nothing to press
      actions: inHostedTab() ? [] : [{ id: 'rd-recover', label: 'Find PDF', icon: 'search' }, { id: 'rd-read-text', label: 'Read text', icon: 'book' }] })}</div>`;
    const report = e => { viewer.querySelector('.empty-detail')?.replaceChildren(String(e.message || e).slice(0, 200)); };
    for (const [id, opts] of [['rd-recover', {}], ['rd-read-text', { allowText: true }]]) {
      const b = q(id); if (!b) continue;
      b.onclick = async () => {
        b.disabled = true;
        try { await retrievePaper(paperId || want.id, opts); if (live()) drawReader(el, ctx); }
        catch (e) { if (live()) report(e); }
        finally { b.disabled = false; }
      };
    }
  }

  // ---- notes and suggested values: the inspector's sections ----
  const notesOf = () => (get().notes || []).filter(n => n.paper === paperId);
  const refreshDetails = () => ctx.refreshDetails?.();
  lookup = createLookup({ ctx, name: () => { const p = paperNow(); return p.label || p.title || ''; } });
  sections = () => {
    const secs = [], found = lookup?.section();
    if (found) secs.push(found);
    if (sugg.length) secs.push({ title: 'Suggested values', meta: String(sugg.length), html: suggestionsHtml(), wire: wireSuggestions });
    const all = notesOf();
    secs.push({ title: 'Notes', meta: all.length ? String(all.length) : '', html: notesHtml(all), wire: wireNotes });
    return secs;
  };

  /**
   * Notes on the document. A direct quotation, a paraphrase and the reader's
   * own interpretation are different things and stay labelled as such (plan
   * D6) — collapsing them is how a reader's inference ends up cited as what a
   * paper said. A quote taken from a selection keeps its anchor.
   */
  const noteRow = n => uiRow({ cls: 'rd-note', attrs: { 'data-note': n.id, 'data-kind': n.kind },
    main: { html: `<span class="rd-note-text">${esc(n.text)}</span>`,
      detail: [noteKindLabel(n.kind), n.page ? `Page ${n.page}` : n.source || '', unchecked(n) ? 'Not checked' : ''], wrap: true },
    end: uiRowEnd({ more: { label: `More for ${noteKindLabel(n.kind).toLowerCase()}`, attrs: { 'data-note-more': n.id } } }) });
  const notesHtml = all => `${uiBar(noteFormSpec({ kind: noteDraft.kind }))}${all.length ? (pg => uiList({ label: 'Notes on this document', id: 'rd-notes', rows: pg.items.map(noteRow) }) + pg.pager)(pagedList('rd-notes', all, { label: 'notes', size: EDITOR_PAGE_SIZE })) : ''}`;

  function addNote(box) {
    const text = box.querySelector('#rd-note-text').value.trim();
    const kind = box.querySelector('#rd-note-kind').value;
    if (!text && !pending) return;
    // A quotation with a selection open takes the selected text and its anchor.
    const useSel = kind === 'quote' && pending;
    update(s2 => {
      s2.notes = [...(s2.notes || []), {
        id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, paper: paperId, kind,
        text: useSel ? pending.text : text,
        page: useSel ? pending.page : page,
        rects: useSel ? pending.rects : null,
        document_version: hash, at: new Date().toISOString(),
      }];
      return s2;
    });
    if (useSel) clearPending();
    noteDraft.text = '';
    ctx.refreshCounts(); refreshDetails();
  }
  function wireNotes(box) {
    wirePagedList(box, 'rd-notes', refreshDetails);
    const kind = box.querySelector('#rd-note-kind'), text = box.querySelector('#rd-note-text');
    kind.value = noteDraft.kind; text.value = noteDraft.text;
    kind.onchange = () => { noteDraft.kind = kind.value; };
    text.oninput = () => { noteDraft.text = text.value; };
    box.querySelector('#rd-note-form').addEventListener('submit', e => { e.preventDefault(); addNote(box); });
    box.querySelectorAll('[data-note-more]').forEach(b => b.onclick = () => {
      const n = (get().notes || []).find(x => x.id === b.dataset.noteMore);
      if (!n) return;
      showMenu(b, [
        ...(n.rects ? [{ label: 'Show on the page', run: async () => { await show(n.page); drawHighlights(stageFor(n.page), n.rects, 'hl-pending', viewportFor(n.page)); } }] : []),
        ...(unchecked(n) ? [{ label: 'Mark checked', run: () => {
          update(s2 => { const x = (s2.notes || []).find(y => y.id === n.id); if (x) Object.assign(x, checkedStamp()); return s2; });
          ctx.refreshCounts(); refreshDetails(); } }] : []),
        '-',
        { label: 'Delete', danger: true, run: () => {
          update(s2 => { s2.notes = (s2.notes || []).filter(x => x.id !== n.id); return s2; });
          ctx.refreshCounts(); refreshDetails(); } },
      ]);
    });
  }

  /**
   * Asks the model for values on this page, then keeps only the proposals whose
   * quote can actually be found in the document. One that cannot be located is
   * dropped rather than shown: without an anchor there is nothing to check it
   * against, and an unverifiable number is the thing this app exists to avoid.
   */
  async function suggest() {
    const btn = q('rd-suggest');
    const requestedPage = page;
    const wanted = () => live() && page === requestedPage;
    const report = t => { if (wanted()) say(t); };
    btn.disabled = true;
    report('Reading page');
    try {
      const stage = stageFor(page), viewport = viewportFor(page);
      if (!stage || !viewport) { report('Page not rendered yet'); btn.disabled = false; return; }
      const pageText = [...stage.querySelectorAll('.textlayer span')]
        .map(s2 => s2.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (!pageText) { report('No text on this page'); btn.disabled = false; return; }
      report('Asking model');
      const proposals = await suggestValues(modelFor('extract'), { pageText, fields: fields() });
      if (!wanted()) throw new DOMException('Preview changed', 'AbortError');
      const located = [];
      for (const pr of proposals) {
        const cap = locateQuote(stage, viewport, pr.quote);
        if (cap) located.push({ ...pr, cap, page: requestedPage, uid: ++suggSeq });
      }
      const dropped = proposals.length - located.length;
      report(dropped ? `${dropped} proposal${dropped > 1 ? 's' : ''} not found on the page` : located.length ? '' : 'No values suggested for this page');
      sugg = located; openSugg.clear();
      refreshDetails();
      if (located.length) ctx.openDetails?.();
    } catch (err) {
      report(err.message.slice(0, 120));
    }
    btn.disabled = !configured(modelFor('extract'));
  }

  const suggestionsHtml = () => uiReviewList({ label: 'Suggested values', items: sugg.map(s2 => {
    const f = fields().find(x => x.id === s2.field);
    const existing = get().values[`${paperId}:${s2.field}`];
    return uiReview({ id: `rd-sg-${s2.uid}`, kind: f?.label ?? s2.field, where: existing ? `Replaces ${String(existing.normalized_value ?? existing.reported_value).slice(0, 18)}` : '',
      summary: s2.value, open: openSugg.has(s2.uid), body: `<div class="rd-quote">${esc(s2.cap.text)}</div>`, acceptLabel: existing ? 'Replace' : 'Accept', dismissLabel: 'Reject',
      attrs: { 'data-sugg': s2.uid } });
  }) });
  async function showSuggestion(s2) {
    if (page !== s2.page) await show(s2.page);
    drawHighlights(stageFor(s2.page), s2.cap.rects, 'hl-pending', viewportFor(s2.page));
  }
  function wireSuggestions(box) {
    box.querySelectorAll('.ui-review').forEach(row => {
      const s2 = sugg.find(x => String(x.uid) === row.dataset.sugg);
      if (!s2) return;
      const head = row.querySelector('.ui-review-head'), body = row.querySelector('.ui-review-body');
      head.onclick = () => {
        const open = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(open)); body.hidden = !open;
        if (open) { openSugg.add(s2.uid); showSuggestion(s2); } else openSugg.delete(s2.uid);
      };
      row.querySelector('[data-accept]').onclick = () => {
        const { normalized_value, ok } = normalise(s2.field, s2.value, fields());
        commit(s2.field, {
          reported_value: s2.cap.text,
          normalized_value: ok ? normalized_value : s2.value,
          // The model read it; a person accepted it. Both are recorded.
          origin: 'inferred',
          extractor: `model:${modelFor('extract').model ?? 'unknown'}`,
          rects: s2.cap.rects,
          ocr: s2.cap.ocr,
        });
        sugg = sugg.filter(x => x !== s2); openSugg.delete(s2.uid);
        drawExisting(); ctx.refreshCounts(); refreshDetails();
      };
      row.querySelector('[data-discard]').onclick = () => { sugg = sugg.filter(x => x !== s2); openSugg.delete(s2.uid); refreshDetails(); };
    });
  }

  /** One place that writes a value, whether a person or a model proposed it. */
  function commit(field, { reported_value, normalized_value, origin, extractor, rects, ocr = false }) {
    setAnchoredValue(paperId, field, { reported_value, normalized_value, origin, extractor,
      evidence: [{ kind: 'text', document_version: hash, page: pending?.page ?? page, quote: reported_value, rects, ...(ocr ? { ocr: true, reviewRequired: true } : {}) }] });
  }

  // ---- the strip ----
  stripEl.prev.onclick = () => page > 1 && show(page - 1);
  stripEl.next.onclick = () => page < pages && show(page + 1);
  stripEl.page.onchange = e => show(Math.min(pages, Math.max(1, parseInt(e.target.value, 10) || 1)));
  stripEl.page.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); stripEl.page.onchange({ target: stripEl.page }); viewer.focus(); } };
  stripEl.in.onclick = () => { custom = stepScale(scaleNow(), 1); actual = false; layout(page); };
  stripEl.out.onclick = () => { custom = stepScale(scaleNow(), -1); actual = false; layout(page); };
  stripEl.fit.addEventListener('ui-pick', e => {
    // every choice applies, the current one too (the engine's picker menu dispatches it each time)
    const v = e.detail?.value; custom = v === 'actual' ? 1 : null; actual = v === 'actual'; if (v === 'width' || v === 'page') fitMode = v;
    layout(page);
  });
  q('rd-suggest').onclick = suggest;
  q('rd-notes').onclick = () => ctx.openDetails?.();

  // Page keys work anywhere in the view that is not a text field.
  ctx.onKey(e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); page < pages && show(page + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); page > 1 && show(page - 1); }
  });

  // ---- the assign bar: a selection becomes a value ----
  let chosenField = null;
  const existingOf = id => get().values[`${paperId}:${id}`];
  const shownValue = v => String(v.normalized_value ?? v.reported_value).slice(0, 18);
  const assignPane = () => footRegion.children[FOOT_STATES.indexOf('assign')];   // the region's panes are its children, in FOOT_STATES order
  /** Field options carry their current value and the first empty field is preselected: the bar is drawn again for each selection, with them. */
  function fillFields() {
    const list = fields();
    chosenField = (list.find(f => !existingOf(f.id)) ?? list[0])?.id ?? null;
    assignPane().innerHTML = uiBar(assignSpec({ qualitative: qualitative(), fieldValue: list.find(f => f.id === chosenField)?.label ?? '',
      fieldOptions: list.map(f => { const v = existingOf(f.id); return [f.id, v ? `${f.label} (${shownValue(v)})` : f.label]; }) }));
    paintField();
  }
  /** The picker shows the chosen field; Accept reads Replace, with what it replaces, while that field holds a value. */
  function paintField() {
    const f = fields().find(x => x.id === chosenField), v = f && existingOf(f.id);
    const pick = q('rd-field'), accept = q('rd-accept'), replace = q('rd-replace');
    const value = pick.querySelector('.ui-picker-value'); if (value) value.textContent = f?.label ?? '';
    pick.setAttribute('aria-label', `Extraction field: ${f?.label ?? ''}`);
    accept.hidden = !!v; replace.hidden = !v;
    if (v) { const tip = `Replaces ${shownValue(v)}`; replace.title = tip; replace.setAttribute('aria-label', tip); }
  }
  // the bar is redrawn, so its buttons are heard from the foot
  footRegion.addEventListener('ui-pick', e => { if (e.target.id !== 'rd-field') return; chosenField = e.detail?.value ?? chosenField; paintField(); });
  footRegion.addEventListener('click', async e => {
    const id = e.target.closest('button')?.id;
    if (id === 'rd-accept' || id === 'rd-replace') accept();
    else if (id === 'rd-cancel') clearPending();
    else if (id === 'rd-hl') annotate('highlight');
    else if (id === 'rd-ul') annotate('underline');
    else if (id === 'rd-code') codeSelection();
    else if (id === 'rd-copy-quote') copyQuote();
    else if (id === 'rd-lookup') lookupSelection();
  });
  /** The selection as a reference to look up on Crossref (views/reference-lookup.mjs): asked for here, answered in the inspector. */
  function lookupSelection() {
    if (!pending) return;
    const text = pending.text;
    clearPending();
    lookup.run(text);
  }
  /** The selection as a quotation with its source, `"…" (Okafor 2019, p. 4)`, the page as printed on it (lib/pdf-cite.mjs). */
  async function copyQuote() {
    if (!pending) return;
    const p = paperNow(), src = { label: p.label || '', year: p.year || '', fileName: fileName(p), page: pending.page, pageLabel: pageLabel(pageLabels, pending.page) };
    try { await navigator.clipboard.writeText(quoteWithCite(pending.text, src)); clearPending(); say(`Quote copied (${cite(src)})`); }
    catch (err) { say(`Not copied: ${err?.message || err}`); }
  }
  // Find (⌘F, ⌘G and ⇧⌘G, Esc), the page field (⌥⌘G) and Copy quote (⇧⌘C), while the reader has the keyboard.
  el.querySelector('.reader').addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && isKey(e, 'c') && pending && !e.target.closest?.('input,textarea')) { e.preventDefault(); copyQuote(); return; }
    // Esc puts a selection away, as Cancel does (Find, when open, takes the first Esc)
    if (e.key === 'Escape' && pending && !(find?.isOpen()) && !e.defaultPrevented && !e.target.closest?.('input,textarea,[contenteditable="true"]')) { e.preventDefault(); e.stopPropagation(); clearPending(); return; }
    if (!find) return;
    if (mod && !e.altKey && !e.shiftKey && isKey(e, 'f')) { e.preventDefault(); e.stopPropagation(); find.open(String(getSelection() || '').replace(/\s+/g, ' ').trim() || null); }
    else if (mod && e.altKey && isKey(e, 'g')) { e.preventDefault(); stripEl.page.focus(); stripEl.page.select(); }
    else if (mod && !e.altKey && isKey(e, 'g')) { e.preventDefault(); if (find.isOpen()) find.step(e.shiftKey ? -1 : 1); else find.open(); }
    else if (e.key === 'Escape' && find.isOpen() && !e.defaultPrevented) { e.preventDefault(); find.close(); }
  });
  // In a qualitative synthesis the selection can be coded: the quote keeps
  // this page, its rectangles and the document hash (lib/qes.mjs).
  async function codeSelection() {
    if (!pending) return;
    const taken = { text: pending.text, page: pending.page, rects: pending.rects, paper: paperId, hash };
    const label = await ask('Code', { placeholder: 'Code label', confirm: 'Code' });
    if (!label?.trim()) return;
    update(s2 => { addQuote(s2, { code: label, paper: taken.paper, text: taken.text,
      locator: { page: taken.page, rects: taken.rects, document_version: taken.hash } }); return s2; });
    clearPending(); ctx.refreshCounts();
    if (document.querySelector('#view .qes')) ctx.rerender();
  }
  function clearPending() {
    pending = null;
    viewer.querySelectorAll('.hl-pending').forEach(e => e.remove());
    getSelection().removeAllRanges();
    paintFoot();
  }
  function accept() {
    if (!pending) { say('Select text in the page first.'); return; }
    const field = chosenField;
    if (!field) return;
    const { normalized_value, ok, why } = normalise(field, pending.text, fields());
    if (!ok) { setMsg(q('rd-sel'), why); return; }
    commit(field, {
      reported_value: pending.text, normalized_value,
      origin: 'reported', extractor: 'human:selection', rects: pending.rects, ocr: pending.ocr,
    });
    clearPending();
    drawExisting();
    ctx.refreshCounts();
    say(why || '');
  }

  /** Values already anchored on the page in view, so the reader shows the work
   *  done rather than only the selection in progress. */
  let highlightedVersion = -1, highlightedPaper = '', highlightedHash = '', byPage = new Map();
  function indexedHighlights() {
    const version = getVersion();
    if (version === highlightedVersion && paperId === highlightedPaper && hash === highlightedHash) return byPage;
    byPage = new Map(); highlightedVersion = version; highlightedPaper = paperId; highlightedHash = hash;
    const labels = new Map(fields().map(f => [f.id, f.label]));
    for (const [key, v] of Object.entries(get().values)) {
      if (!key.startsWith(paperId + ':')) continue;
      const title = `${labels.get(v.field_id) || v.field_id}: ${v.reported_value}`;
      for (const e of v.evidence || []) {
        if (e.kind !== 'text' || e.document_version !== hash) continue;
        const hits = byPage.get(e.page) || [];
        for (const rect of e.rects || []) hits.push({ rect, title });
        byPage.set(e.page, hits);
      }
    }
    return byPage;
  }
  function drawExisting() {
    const pagesWithHighlights = indexedHighlights();
    for (const [n, st] of stages) {
      if (!st.viewport) continue;
      if (find) drawHits(st.el, st.viewport, find.hitsOn(n));
      st.el.querySelectorAll('.hl').forEach(e => e.remove());
      const fragment = document.createDocumentFragment();
      for (const { rect, title } of pagesWithHighlights.get(n) || []) {
        const d = document.createElement('div');
        d.className = 'hl'; d.title = title;
        placeBox(d, rectToBox(rect, st.el, st.viewport));
        fragment.appendChild(d);
      }
      st.el.appendChild(fragment);
    }
    drawAnnotations();
  }

  // ---- annotations: highlight, underline, area clip (lib/annotations.mjs) ----
  // Drawn from PDF units on every render, so they follow zoom exactly. Marks
  // made on another version of the file are not drawn on this one.
  function drawAnnotations() {
    const mine = annotationsOf(get(), paperId).filter(a => !a.document_version || a.document_version === hash);
    for (const [n, st] of stages) {
      st.el.querySelectorAll('.ann').forEach(e => e.remove());
      if (!st.viewport) continue;
      const fragment = document.createDocumentFragment();
      for (const a of mine) {
        if (a.page !== n) continue;
        for (const r of a.rects) {
          const d = document.createElement('div');
          d.className = `ann ann-${a.kind}${a.id === editing ? ' on' : ''}`;
          d.dataset.ann = a.id;
          d.title = [KIND_LABEL[a.kind], a.comment || a.text].filter(Boolean).join(': ').slice(0, 200);
          placeBox(d, pdfToBox(r, st.viewport));
          fragment.appendChild(d);
        }
      }
      st.el.appendChild(fragment);
    }
  }
  function annotate(kind) {
    if (!pending) { say('Select text in the page first.'); return; }
    const taken = pending;
    let made = null;
    update(s2 => { made = addAnnotation(s2, paperId, { kind, page: taken.page, rects: taken.rects, text: taken.text, document_version: hash }); return s2; });
    clearPending();
    ctx.refreshCounts?.();
    if (kind === 'highlight') openAnnotation(made.id, true); else drawAnnotations();
  }
  function openAnnotation(id, focusComment = false) {
    const a = annotationsOf(get(), paperId).find(x => x.id === id);
    if (!a) return;
    editing = id;
    setMsg(q('rd-ann-info'), `${a.imported ? 'Imported ' + KIND_LABEL[a.kind].toLowerCase() : KIND_LABEL[a.kind]}, p. ${a.page}`);
    q('rd-comment').value = a.comment || '';
    paintFoot();
    drawAnnotations();
    if (focusComment) q('rd-comment').focus();
  }
  function closeAnnotation() { editing = null; paintFoot(); drawAnnotations(); }
  q('rd-ann-close').onclick = closeAnnotation;
  q('rd-ann-save').onclick = () => {
    if (!editing) return;
    const comment = q('rd-comment').value;
    update(s2 => { editAnnotation(s2, paperId, editing, { comment }); return s2; });
    closeAnnotation();
  };
  q('rd-comment').onkeydown = e => { if (e.key === 'Enter') q('rd-ann-save').click(); if (e.key === 'Escape') closeAnnotation(); };
  q('rd-ann-del').onclick = () => {
    if (!editing) return;
    const id = editing;
    update(s2 => { removeAnnotation(s2, paperId, id); return s2; });
    closeAnnotation(); ctx.refreshCounts?.();
  };
  // A click (not a drag that selects) on a mark opens it. The marks themselves
  // let clicks through, so text under a highlight can still be selected.
  viewer.addEventListener('click', e => {
    if (viewer.classList.contains('region-mode')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const stageEl = e.target.closest?.('.stage');
    if (!stageEl) return;
    const hit = [...stageEl.querySelectorAll('.ann')].find(d => {
      const r = d.getBoundingClientRect();
      return e.clientX >= r.left - 1 && e.clientX <= r.right + 1 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    });
    if (hit) openAnnotation(hit.dataset.ann);
  });
  // a click on clear space puts the selection away, as in the Files viewer (lib/pdf-clear-select.mjs)
  attachClearSelection(viewer, { active: () => !!pending, clear: clearPending, skip: () => viewer.classList.contains('region-mode') });
  /** An area drawn with the region tool, kept as a clip of the page. */
  function clipArea(region) {
    let made = null;
    update(s2 => { made = addAnnotation(s2, paperId, { kind: 'area', page: region.page, rects: [region.rect], text: '', document_version: hash }); return s2; });
    ctx.refreshCounts?.();
    openAnnotation(made.id, true);
  }

  /**
   * The file's own annotations — highlights and notes made in another reader —
   * offered once per paper. Nothing is imported without asking.
   */
  async function offerImport() {
    const id = paperId, target = doc, version = hash;
    const still = () => live() && doc === target && paperId === id;
    const rec = get().annotationImports?.[id];
    if (rec && (rec.status === 'dismissed' || rec.hash === version)) return;
    const found = [];
    let items = null;
    for (let n = 1; n <= pages; n++) {
      if (!still()) return;
      const list = await (await target.getPage(n)).getAnnotations().catch(() => []);
      if (!list.some(a => ['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Text', 'Popup'].includes(a.subtype))) continue;
      items ||= await docIndex(id).catch(() => null);
      found.push(...fromPdfAnnotations(n, list, items?.pages?.[n - 1]?.items || []));
    }
    if (!still() || !importOffer(get(), id, version, found.length)) return;
    setMsg(q('rd-offer-info'), `${found.length} annotation${found.length === 1 ? '' : 's'} in the file`);
    offerOpen = true; paintFoot();
    q('rd-import-go').onclick = () => {
      let n = 0;
      update(s2 => { n = importAnnotations(s2, id, found, version); return s2; });
      offerOpen = false; paintFoot();
      say(n === found.length ? '' : `${found.length - n} already present`);
      drawAnnotations(); ctx.refreshCounts?.();
    };
    q('rd-import-no').onclick = () => {
      update(s2 => { dismissImport(s2, id, version, found.length); return s2; });
      offerOpen = false; paintFoot();
    };
  }

  viewer.addEventListener('mouseup', () => {
    const sel = getSelection();
    const node = sel?.anchorNode;
    const stageEl = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('.stage');
    if (!stageEl) return;
    const n = Number(stageEl.dataset.page);
    const cap = captureSelection(stageEl, viewportFor(n));
    if (!cap) return;
    pending = { ...cap, page: n, doc_hash: hash, paper: paperId };
    editing = null; say('');
    fillFields();
    showQuote(q('rd-sel'), cap.text);
    paintFoot();
    viewer.querySelectorAll('.hl-pending').forEach(e => e.remove());
    drawHighlights(stageEl, cap.rects, 'hl-pending', viewportFor(n));
    drawExisting();
  });

  // The engine hears the column's width (the sidebar, the inspector, the window) and calls back once it changes. Re-rendering the pages wipes the
  // text layer, which destroys a selection the user is part-way through making, so it is only drawn again when the width actually changed.
  // Seeded with the current width so the call the engine makes when the column first has one is a no-op: otherwise every open draws twice.
  let t, lastWidth = Math.round(viewer.clientWidth);
  widthOff = watchWidth(viewer, () => {
    const w = Math.round(viewer.clientWidth);
    if (!w || w === lastWidth || !live()) return;
    lastWidth = w;
    clearTimeout(t);
    t = setTimeout(() => live() && doc && layout(page), 150);
  });

  // regions: digitise a curve, read a table (views/reader-region.mjs)
  regionApi = attachRegion(el, ctx, { viewer, doc: () => doc, hash: () => hash, paperId: () => paperId, page: () => page, stageFor, viewportFor, live, rerender: () => showCurrent(),
    clip: clipArea, say, foot: on => { regionOn = on; paintFoot(); } });

  showCurrent = () => layout(page);
  viewerNote('Opening PDF…');
  paintFoot();
  open(want).catch(err => {
    if (!live()) return;
    paperId = want.id;
    failed(err);
    syncStrip();
    refreshDetails();
    console.error('[reader] open failed', err);
  });

  async function open(p) {
    let article = previewArticle(p.id);
    let bytes = await getBytes(p.id);
    if (!bytes && !article) {
      viewerNote('Finding a preview…');
      await retrievePaper(p.id, { isWanted: live }); bytes = await getBytes(p.id); article = previewArticle(p.id);
      if (!live()) return;
    }
    if (article) {
      if (!live()) return;
      paperId = p.id;
      delete viewer.dataset.empty;
      for (const id of toolIds) { const b = q(id); if (b) b.disabled = true; }
      viewer.innerHTML = `<article class="article-preview"><h1>${esc(article.title || p.title)}</h1><p class="article-source">Text version (Europe PMC), ${uiLink({ id: 'rd-find-pdf', label: 'Find PDF' })}</p>${article.blocks.map(b => b.kind === 'heading' ? `<h2>${esc(b.text)}</h2>` : b.kind === 'table' ? `<div class="article-table"><table>${b.rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>` : `<p>${esc(b.text)}</p>`).join('')}</article>`;
      q('rd-find-pdf').onclick = async e => {
        const b = e.currentTarget; b.disabled = true;
        try { await retrievePaper(p.id); if (live()) drawReader(el, ctx); }
        catch (err) { if (live()) { b.disabled = false; b.title = String(err.message || err).slice(0, 200); } }
      };
      syncStrip(); refreshDetails();
      return;
    }
    if (!bytes) throw new Error(p.pdfMode === 'link' ? `linked file could not be read${p.pdfName ? ` (${p.pdfName})` : ''}` : 'document not found in storage');
    const loaded = await loadPdf(bytes);
    if (!live()) { loaded.doc.destroy?.(); return; }
    doc = loaded.doc; hash = loaded.hash; pages = loaded.pages; paperId = p.id;
    for (const id of ['rd-full', 'rd-save-copy']) { const b = q(id); if (b) b.disabled = false; }
    queuePaper(p.id);
    const first = await doc.getPage(1);
    natural = first.getViewport({ scale: 1 });
    if (!live()) return;
    attachTools();
    refreshDetails();
    const loc = ctx.locator || (landing?.paperId === p.id ? { page: Math.min(pages, landing.page) } : null);
    landing = null;
    await layout(loc?.page || 1);
    if (loc?.page) {
      await renderStage(loc.page);
      const st = stages.get(loc.page);
      if (st?.viewport) {
        const precise = loc.quote ? locateQuote(st.el, st.viewport, loc.quote, loc.nth || 0) : null;
        const anchorRects = precise?.rects?.length ? precise.rects : loc.rects;
        if (anchorRects?.length) {
          drawHighlights(st.el, anchorRects, 'hl-pending', st.viewport);
          const box = rectToBox(anchorRects[0], st.el, st.viewport);
          viewer.scrollTop = Math.max(0, st.el.offsetTop + box.top - viewer.clientHeight / 2);
        } else if (loc.kind === 'image') {
          // a figure: outline the region when the model named one, else the page itself is the evidence
          if (loc.region) drawHighlights(st.el, [loc.region], 'hl-region', st.viewport);
          viewer.scrollTop = landTop(st.el.offsetTop, loc.page);
        }
        st.el.querySelector('.hl-pending, .hl-region')?.classList.add('hl-flash');
      }
    }
    offerImport().catch(err => console.warn('[reader] annotations not read', err));
  }

  /**
   * Find and the page rail for the document just opened (views/pdf-tools.mjs): the text is read when find first opens; the rail lies over the
   * page's left edge (the reader's pane is a column beside the work) and closes on a choice.
   */
  function attachTools() {
    const target = doc, mine = () => live() && doc === target;
    const text = pdfText(target, { live: mine, ocr: m => ocrItems(hash, m).then(it => (it ? textContentFrom(it) : null)) });
    viewer.insertAdjacentHTML('beforebegin', railHtml({ p: 'rd', pages, view: 'pages' }));
    rail = attachRail(el, { p: 'rd', doc: target, current: () => page, go: n => show(n), live: mine, openFlag: readerRail, focusPage: () => viewer.focus({ preventScroll: true }) });
    find = attachFind(el, { p: 'rd', text, current: () => page, focusPage: () => viewer.focus({ preventScroll: true }),
      redraw: ns => { for (const n of ns) { const st = stages.get(n); if (st?.viewport) drawHits(st.el, st.viewport, find.hitsOn(n)); } },
      reveal: async (hit, rects) => {
        await show(hit.page);
        const st = stages.get(hit.page);
        if (st?.viewport && rects[0]) viewer.scrollTop = Math.max(0, st.el.offsetTop + rectToBox(rects[0], st.el, st.viewport).top - viewer.clientHeight / 3);
      } });
    target.getPageLabels().then(l => { if (mine()) pageLabels = printedLabels(l); }, () => {});
  }

  /**
   * Lay every page out as a column of placeholders sized from page 1, so the
   * scrollbar is right before anything is drawn, then render pages as they
   * come near. `at` is the page to land on.
   */
  async function layout(at = page) {
    if (!live() || !doc) return;
    io?.disconnect();
    stages.clear();
    delete viewer.dataset.empty;
    viewer.innerHTML = '';
    layoutScale = scaleNow();
    const w = natural.width * layoutScale, h = natural.height * layoutScale;
    for (let n = 1; n <= pages; n++) {
      const el2 = document.createElement('div');
      el2.className = 'stage';
      el2.dataset.page = String(n);
      sizeStage(el2, w, h);
      viewer.appendChild(el2);
      el2.textContent = 'Loading page…';
      stages.set(n, { el: el2, viewport: null });
    }
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const n = Number(e.target.dataset.page);
        if (e.isIntersecting && stages.get(n)?.el === e.target) renderStage(n);
        else unrenderStage(n);
      }
    }, { root: viewer, rootMargin: '150% 0px' });
    for (const st of stages.values()) io.observe(st.el);
    syncStrip();
    await show(at);
  }

  const rendering = new Map();
  async function renderStage(n) {
    const st = stages.get(n);
    if (!st || st.viewport || !doc) return;
    if (rendering.has(st)) return rendering.get(st);
    const target = doc;
    const job = (async () => {
      const vp = await renderPage(target, n, st.el, null,
        () => live() && doc === target && stages.get(n) === st,
        layoutScale, m => ocrItems(hash, m).then(it => (it ? textContentFrom(it) : null)));
      if (!live() || stages.get(n) !== st) return;
      if (vp) {
        st.viewport = vp;
        // the real size replaces the estimate, which only matters for pages
        // whose size differs from page 1
        sizeStage(st.el, vp.width, vp.height);
      }
      drawExisting();
    })();
    rendering.set(st, job);
    try { await job; }
    catch (err) {
      if (live() && stages.get(n) === st) {
        st.el.innerHTML = `<div class="reader-page-error" role="alert"><span>Page ${n} could not load.</span><button type="button" data-retry>Retry</button></div>`;
        st.el.querySelector('[data-retry]').onclick = () => renderStage(n);
        say(`Page ${n}: ${err.message || err}`);
      }
    } finally { rendering.delete(st); }
  }
  function unrenderStage(n) {
    const st = stages.get(n);
    if (!st || !st.viewport) return;
    if (pending?.page === n) return;          // a selection in progress stays drawn
    st.el.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; });
    st.el.textContent = 'Loading page…';
    st.viewport = null;
  }

  /** Go to a page: scroll it into view, rendering it if needed. Page 1 lands at the top of the column, with nothing of it under the strip. */
  async function show(n) {
    if (!live() || !doc) return;
    n = Math.min(pages, Math.max(1, n));
    if (pending && pending.page !== n) clearPending();
    page = n;
    const st = stages.get(n);
    if (!st) return;
    viewer.scrollTop = landTop(st.el.offsetTop, n);
    await renderStage(n);
    if (live()) syncStrip();
  }

  // The page indicator follows the scroll: the page nearest the centre of the
  // view is the current one.
  let scrollT = null;
  viewer.addEventListener('scroll', () => {
    if (scrollT) return;
    scrollT = requestAnimationFrame(() => {
      scrollT = null;
      // the page under the upper third of the view, which is where reading happens
      const mid = viewer.scrollTop + viewer.clientHeight * 0.35;
      let best = page, dist = Infinity;
      for (const [n, st] of stages) {
        const c = st.el.offsetTop + st.el.offsetHeight / 2;
        const d2 = Math.abs(c - mid);
        if (d2 < dist) { dist = d2; best = n; }
      }
      if (best !== page) { page = best; syncStrip(); }
    });
  }, { passive: true });
}

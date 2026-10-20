import { createLookup } from './reference-lookup.mjs';
import { loadPdf, renderPage, captureSelection } from '../lib/anchor.mjs';
import { fitScale, stepScale, STEPS, sizeStage } from '../lib/reader-geometry.mjs';
import { regionShow, watchWidth } from '../lib/ui-actions.mjs';
import { viewStore, flag } from '../lib/pdf-view-state.mjs';
import { attachClearSelection } from '../lib/pdf-clear-select.mjs';
import { quoteText, showQuote, quoteWithCite, cite, pageLabel, pageFromText, pageDetail } from '../lib/pdf-cite.mjs';
import { labels as printedLabels } from '../lib/pdf-outline.mjs';
import { pdfProps } from '../lib/pdf-props.mjs';
import { annotationsOf, addAnnotation, editAnnotation, removeAnnotation, KIND_LABEL, pdfToBox } from '../lib/annotations.mjs';
import { addFileNote } from '../lib/file-notes.mjs';
import { askText } from '../lib/dialog.mjs';
import { ocrItems, textContentFrom, ocrAvailable, recognisePage } from '../lib/ocr.mjs';
import { get, update } from '../store.mjs';
import { FIT_LABEL, PDF_FOOT, pdfFileHtml } from './pdf-file-bars.mjs';
import { pdfText, attachFind, attachRail, drawBoxes, drawHits, isKey } from './pdf-tools.mjs';

export { FIT_LABEL };
// The rail's openness is the app's (remembered across files); where each file was left is the file's (lib/pdf-view-state.mjs, by content hash).
const railOpen = flag('lykos.pdf-previews', true), DOCK_MIN = 560;
const setMsg = (el, text = '') => { if (!el) return; el.textContent = text; el.title = text; };

/**
 * Continuous PDF reading with bounded page rendering (plan PDF-OPTIONS): the strip (or the find bar in its place), the rail (Pages | Contents), a
 * page column drawn near the view and released far from it, a render that cannot be seen any more cancelled, and one foot over the column's lower
 * edge for what a selection or a mark offers. Returns the function that closes it, which lets the PDF.js document go (its worker-side copy too);
 * the function carries `view` (reveal a note's place, the Details lines, counters for the benchmark). `load` is PDF.js's open, replaceable in a test.
 *
 * o.page        the page to open on (the Files history returns to where a document was left); without it the file opens where it was last left
 * o.name        the file's name (a quotation from a file with no record cites it); o.source { label, year } a library record when there is one
 * o.noteSource  { path, label }: where a note made from a selection belongs (lib/file-notes.mjs); without it Note is not offered
 * o.actions     { add, reveal, open, details } the file's commands in More, each drawn only when given
 * o.ctx         the shell (refreshDetails after the Details lines change)
 */
export async function mountPdfFile(body, bytes, isCurrent, { uid = 'pdf', page: startAt = 0, load = loadPdf, name = '', source = null, noteSource = null, actions = {}, ctx = null } = {}) {
  const loaded = await load(bytes);
  const { doc } = loaded, hash = loaded.hash || '', OPS = loaded.OPS || null;
  let disposed = false, revision = 0, current = 1, zoom = 1, mode = 'page', rotation = 0, frame = 0;
  const live = () => !disposed && isCurrent();
  if (!live()) { doc.destroy(); return () => {}; }
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  if (!live()) { doc.destroy(); return () => {}; }
  // the printed page labels ("iv", "S12"), read before the strip is drawn: a file that has them gets a page field that takes text
  let labels = printedLabels(await doc.getPageLabels().catch(() => null)), meta = null;
  if (!live()) { doc.destroy(); return () => {}; }
  const views = viewStore(), saved = hash ? views.get(hash) : null;
  if (saved) {
    if (typeof saved.zoom === 'number') { mode = 'custom'; zoom = saved.zoom; } else if (saved.zoom) mode = saved.zoom;
    rotation = saved.rotation || 0;
  }
  const remember = patch => { if (hash) views.put(hash, patch); };
  const U = uid, q = n => body.querySelector(`[id="${U}-${n}"]`);
  const ocr = ocrAvailable() && !!hash;
  body.classList.add('fv-pdf-body');
  body.innerHTML = pdfFileHtml({ p: U, pages: doc.numPages, previews: railOpen.get(), labelled: !!labels, labels, fit: mode, view: saved?.rail || 'pages', matchCase: flag('lykos.pdf.find', false).get(),
    can: { add: !!actions.add, ocr, reveal: !!actions.reveal, open: !!actions.open } });
  const scroll = body.querySelector('.fv-pdf-scroll'), column = body.querySelector('.fv-pdf'), workspace = body.querySelector('.fv-pdf-workspace');
  const footBox = body.querySelector('.fv-pdf-end'), footRegion = q('foot');
  column.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="fv-page" data-page="${i + 1}" role="region" aria-label="Page ${i + 1}"></div>`).join('');
  const fitPick = q('fit'), pageInput = q('page');
  const states = [...column.children].map((el, i) => ({ el, n: i + 1, width: first.width, height: first.height, drawn: false, token: 0, vp: null, task: null }));
  const stats = { renders: 0, stale: 0, cancelled: 0 };
  const dims = s => (rotation % 180 ? [s.height, s.width] : [s.width, s.height]);
  const sizeOf = s => { const [w, h] = dims(s); sizeStage(s.el, w * zoom, h * zoom); };
  const textFor = hash ? m => ocrItems(hash, m).then(it => (it ? textContentFrom(it) : null)) : null;

  // ---- the strip ----
  const sync = () => {
    if (document.activeElement !== pageInput) pageInput.value = pageLabel(labels, current);
    pageInput.title = labels ? pageDetail(labels, current, doc.numPages) : '';
    q('prev').disabled = current === 1;
    q('next').disabled = current === doc.numPages;
    const level = q('zoom-level'); if (level) level.textContent = `${Math.round(zoom * 100)}%`;
    q('zoom-out').disabled = zoom <= STEPS[0] + 1e-6;
    q('zoom-in').disabled = zoom >= STEPS.at(-1) - 1e-6;
    const value = fitPick.querySelector('.ui-picker-value'); if (value && value.textContent !== FIT_LABEL[mode]) { value.textContent = FIT_LABEL[mode]; fitPick.setAttribute('aria-label', `Fit: ${FIT_LABEL[mode]}`); }
    rail.follow();
  };
  let kept = 0;
  const keepPage = () => { if (current !== kept) { kept = current; remember({ page: current }); } };
  /** Scrolls so page n (and, given a rectangle in PDF units, that place on it, in the upper third) is in view. */
  async function land(n, rect = null) {
    const s = states[Math.max(1, Math.min(doc.numPages, n)) - 1];
    let y = s.el.offsetTop - states[0].el.offsetTop;
    if (rect) {
      const pg = s.vp ? null : await doc.getPage(s.n), vp = s.vp || pg.getViewport({ scale: zoom, rotation: ((pg.rotate || 0) + rotation) % 360 });
      if (!live()) return;
      const box = pdfToBox(rect, vp);
      y = s.el.offsetTop + box.top - scroll.clientHeight / 3;
      // sideways only as far as the hit needs (a page wider than the column): its right end in, its left end never out
      const x = s.el.offsetLeft + box.left;
      scroll.scrollLeft = Math.max(0, Math.min(x - 24, Math.max(scroll.scrollLeft, x + box.width + 24 - scroll.clientWidth)));
    }
    current = s.n;
    scroll.scrollTop = Math.max(0, y);
    sync(); schedule();
  }
  const go = n => { land(Math.max(1, Math.min(doc.numPages, Math.round(Number(n) || 1)))); };

  // ---- pages: drawn near the view, released far from it; a render nobody will see is cancelled ----
  const queue = []; let busy = false;
  function release(s) {
    s.task?.cancel(); s.task = null;
    s.el.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; });
    s.el.replaceChildren(); s.vp = null;
  }
  async function pump() {
    if (busy) return; busy = true;
    try {
      while (queue.length && live()) {
        const { state, version, token } = queue.shift();
        const valid = () => live() && revision === version && state.token === token;
        if (!valid()) continue;
        try {
          const page = await doc.getPage(state.n); if (!valid()) continue;
          const natural = page.getViewport({ scale: 1, rotation: page.rotate }); state.width = natural.width; state.height = natural.height; sizeOf(state);
          const vp = await renderPage(doc, state.n, state.el, null, valid, zoom, textFor, { rotation, onTask: t => { state.task = t; } });
          state.task = null;
          if (!valid()) { if (vp) stats.stale++; continue; }
          stats.renders++;
          state.vp = vp; sizeOf(state); decorate(state);
        } catch (error) {
          state.task = null;
          if (!valid()) { stats.cancelled++; continue; }
          state.el.innerHTML = '<div class="reader-page-error" role="alert"><span>Page could not load.</span><button type="button" data-retry>Retry</button></div>';
          state.el.querySelector('[data-retry]').onclick = () => { state.drawn = false; schedule(); };
        }
      }
    } finally { busy = false; }
  }
  function schedule() {
    frame = 0;
    if (!live()) return;
    const y = scroll.scrollTop, h = scroll.clientHeight, origin = states[0].el.offsetTop;
    let best = current, distance = Infinity;
    for (const s of states) {
      const top = s.el.offsetTop - origin, bottom = top + s.el.offsetHeight;
      // the page that fills most of the view (the largest visible share; the upper one on a tie), so the rail and the page field name what is read
      const d = -(Math.min(bottom, y + h) - Math.max(top, y));
      if (d < distance - 0.5) { distance = d; best = s.n; }
      if (bottom >= y - h && top <= y + 2 * h) { if (!s.drawn) { s.drawn = true; queue.push({ state: s, version: revision, token: ++s.token }); } }
      else if ((bottom < y - 3 * h || top > y + 4 * h) && s.drawn) { s.drawn = false; s.token++; release(s); }
    }
    current = best;
    queue.sort((a, b) => Math.abs(a.state.n - best) - Math.abs(b.state.n - best));
    sync(); keepPage(); pump();
  }
  // the room a fitted page has: the column less its padding (the top's twice: the foot's extra room at the end is for scrolling, not for fitting)
  const innerSize = () => {
    const cs = getComputedStyle(scroll);
    return { w: scroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: scroll.clientHeight - 2 * parseFloat(cs.paddingTop) };
  };
  let laid = { w: -1, h: -1 };
  function layout(preserve = true) {
    if (!live()) return;
    const s = states[current - 1], offset = (scroll.scrollTop - (s.el.offsetTop - states[0].el.offsetTop)) / Math.max(1, s.el.offsetHeight);
    if (mode === 'actual') zoom = 1;
    else if (mode !== 'custom') { const [w, h] = dims(states[0]), room = innerSize(); zoom = fitScale({ mode, avail: room.w, availH: room.h, natural: { width: w, height: h } }); }
    laid = { w: scroll.clientWidth, h: scroll.clientHeight };
    revision++; queue.length = 0;
    for (const st of states) { st.token++; st.drawn = false; release(st); sizeOf(st); }
    if (preserve) scroll.scrollTop = s.el.offsetTop - states[0].el.offsetTop + Math.max(0, offset) * s.el.offsetHeight;
    sync(); schedule();
  }
  const setZoom = (next, how) => { mode = how; zoom = next; remember({ zoom: how === 'custom' ? zoom : how }); layout(); };
  const step = dir => setZoom(stepScale(zoom, dir), 'custom');

  // ---- the text: read once, from the page in view outward, after the first page is drawn ----
  const text = pdfText(doc, { live, ocr: textFor });
  const redraw = pages => { for (const n of pages) { const s = states[n - 1]; if (s?.vp) drawHits(s.el, s.vp, find.hitsOn(n)); } };
  const find = attachFind(body, { p: U, text, current: () => current, redraw, focusPage: () => scroll.focus({ preventScroll: true }),
    reveal: (hit, rects) => land(hit.page, rects[0] || null) });
  // the rail docks only where the page keeps 420 px beside it (the workspace at least DOCK_MIN wide); narrower, its toggle lays it over the page
  const rail = attachRail(body, { p: U, doc, current: () => current, go, live, view: saved?.rail || 'pages', openFlag: railOpen, dock: () => workspace.clientWidth >= DOCK_MIN,
    store: v => remember({ rail: v }), focusPage: () => scroll.focus({ preventScroll: true }) });

  // ---- marks, the selection and the foot (views/reader-bars.mjs selectSpec, annotateSpec) ----
  const key = hash ? `pdf:${hash}` : '';
  let pending = null, editing = null, flash = null, idleText = '';
  const footState = () => (editing ? 'annotate' : pending ? 'select' : 'idle');
  function paintFoot() {
    const st = footState();
    regionShow(footRegion, PDF_FOOT.indexOf(st)); footRegion.dataset.state = st;
    const quiet = st === 'idle' && !q('say').textContent;
    if (footBox.hidden !== quiet) footBox.hidden = quiet;
  }
  /** What an action reports, in the idle bar; the file's standing notice (scanned pages) comes back when it is cleared. */
  const say = (t = '') => { setMsg(q('say'), t || idleText); paintFoot(); };
  const marksOn = n => annotationsOf(get(), key).filter(a => a.page === n && (!a.document_version || a.document_version === hash))
    .map(a => ({ rects: a.rects, cls: `ann-${a.kind}`, on: a.id === editing, data: { ann: a.id }, title: [KIND_LABEL[a.kind], a.comment || a.text].filter(Boolean).join(': ').slice(0, 200) }));
  function decorate(s) {
    if (!s.vp) return;
    if (key) drawBoxes(s.el, s.vp, marksOn(s.n), 'ann');
    drawHits(s.el, s.vp, find.hitsOn(s.n));
    drawBoxes(s.el, s.vp, [...(pending?.page === s.n ? [{ rects: pending.rects }] : []), ...(flash?.page === s.n ? [{ rects: flash.rects, cls: 'hl-flash' }] : [])], 'hl-pending');
  }
  const decorateAll = () => states.forEach(decorate);
  function clearPending() { const was = pending?.page; pending = null; getSelection()?.removeAllRanges(); if (was) decorate(states[was - 1]); paintFoot(); }
  const citeOf = page => ({ label: source?.label || '', year: source?.year || '', fileName: name, page, pageLabel: pageLabel(labels, page) });
  async function copyQuote() {
    if (!pending) return;
    const textOut = quoteWithCite(pending.text, citeOf(pending.page)), where = cite(citeOf(pending.page));
    try { await navigator.clipboard.writeText(textOut); clearPending(); say(`Quote copied (${where})`); }
    catch (err) { say(`Not copied: ${err?.message || err}`); }
  }
  function mark(kind) {
    if (!pending || !key) return;
    const taken = pending; let made = null;
    update(s => { made = addAnnotation(s, key, { kind, page: taken.page, rects: taken.rects, text: taken.text, document_version: hash }); return s; });
    clearPending();
    if (kind === 'highlight') openMark(made.id, true); else decorate(states[taken.page - 1]);
  }
  async function noteFrom() {
    if (!pending || !noteSource) return;
    const taken = pending;
    const textIn = await askText('Note', { placeholder: 'Write a note about this quotation' });
    if (!textIn?.trim() || !live()) return;
    update(s => { addFileNote(s, { text: textIn, source: { ...noteSource }, anchor: { kind: 'pdf', page: taken.page, quote: quoteText(taken.text), rects: taken.rects, document_version: hash } }); return s; });
    clearPending(); say('Note saved in Notes.');
    ctx?.refreshDetails?.();
  }
  function openMark(id, focusComment = false) {
    const a = annotationsOf(get(), key).find(x => x.id === id); if (!a) return;
    editing = id; pending = null;
    setMsg(q('ann-info'), `${KIND_LABEL[a.kind]} · p. ${pageLabel(labels, a.page)}`);
    q('comment').value = a.comment || '';
    paintFoot(); decorate(states[a.page - 1]);
    if (focusComment) q('comment').focus();
  }
  function closeMark() { const a = annotationsOf(get(), key).find(x => x.id === editing); editing = null; paintFoot(); if (a) decorate(states[a.page - 1]); scroll.focus({ preventScroll: true }); }
  q('ann-close').onclick = closeMark;
  q('ann-save').onclick = () => { if (!editing) return; const comment = q('comment').value; update(s => { editAnnotation(s, key, editing, { comment }); return s; }); closeMark(); };
  q('ann-del').onclick = () => { if (!editing) return; const id = editing; update(s => { removeAnnotation(s, key, id); return s; }); closeMark(); };
  q('comment').onkeydown = e => { if (e.key === 'Enter') q('ann-save').click(); if (e.key === 'Escape') { e.stopPropagation(); closeMark(); } };
  q('copy-quote').onclick = copyQuote;
  q('hl').onclick = () => mark('highlight');
  q('ul').onclick = () => mark('underline');
  q('note').onclick = noteFrom;
  if (!noteSource) { q('note').disabled = true; q('note').title = 'Notes belong to a file in a project folder'; }
  q('hl').disabled = q('ul').disabled = !key;
  q('cancel').onclick = clearPending;
  q('find-sel').onclick = () => { const t = pending?.text; clearPending(); find.open(t); };
  // Look up reference: the selection goes to Crossref when asked; the answer is a section of the Files inspector (views/reference-lookup.mjs)
  const lookup = createLookup({ ctx, name: () => name });
  q('lookup').onclick = () => { const t = pending?.text; clearPending(); if (t) lookup.run(t); };
  scroll.addEventListener('mouseup', e => {
    const sel = getSelection(), node = sel?.anchorNode, pageEl = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.fv-page');
    const s = pageEl && scroll.contains(pageEl) ? states[+pageEl.dataset.page - 1] : null;
    const cap = s?.vp ? captureSelection(pageEl, s.vp) : null;
    if (cap) { const was = pending?.page; pending = { ...cap, page: s.n }; editing = null; showQuote(q('sel'), cap.text); paintFoot(); if (was && was !== s.n) decorate(states[was - 1]); decorate(s); return; }
    // a click (not a drag that selects) on a mark opens it; the marks let clicks through, so text under them stays selectable
    const stage = e.target.closest?.('.fv-page'); if (!stage || !key) return;
    const hit = [...stage.querySelectorAll('.ann')].find(d => { const r = d.getBoundingClientRect(); return e.clientX >= r.left - 1 && e.clientX <= r.right + 1 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2; });
    if (hit) openMark(hit.dataset.ann);
  });

  // a click on clear space (a margin, the gap between pages, a figure, beside the pages) puts the selection away (lib/pdf-clear-select.mjs, shared with the reader)
  attachClearSelection(scroll, { active: () => !!pending, clear: clearPending });

  // ---- More ----
  const rotate = dir => { rotation = (rotation + dir * 90 + 360) % 360; remember({ rotation }); layout(); say(rotation ? `Rotated ${rotation}°` : ''); };
  q('rot-cw').onclick = () => rotate(1);
  q('rot-ccw').onclick = () => rotate(-1);
  const run = fn => () => Promise.resolve().then(fn).catch(err => say(String(err?.message || err)));
  if (q('add')) q('add').onclick = run(actions.add);
  if (q('reveal')) q('reveal').onclick = run(actions.reveal);
  if (q('open-default')) q('open-default').onclick = run(actions.open);
  q('details').onclick = () => (actions.details ? actions.details() : ctx?.openDetails?.());
  let reading = false;
  const syncOcr = () => { const b = q('ocr'); if (b) { b.disabled = reading || !text.noText.size; b.title = b.disabled && !reading ? 'Every page has text' : ''; } };
  if (q('ocr')) q('ocr').onclick = async () => {
    if (reading || !text.noText.size) return;
    reading = true; syncOcr();
    const todo = [...text.noText].sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
    let words = 0;
    try {
      for (let i = 0; i < todo.length && live(); i++) {
        say(`Reading page ${todo[i]} (${i + 1} of ${todo.length})`);
        words += await recognisePage(doc, hash, todo[i], [], { isCurrent: live, OPS });
        find.forget(todo[i]); await text.again(todo[i]);
        const s = states[todo[i] - 1]; if (s.drawn) { s.drawn = false; release(s); }
      }
      if (live()) { idleText = scanNotice(); say(`${words} words recognised on ${todo.length} page${todo.length === 1 ? '' : 's'}. Check recognised text against the page.`); schedule(); }
    } catch (err) { if (live()) say(String(err?.message || err).slice(0, 140)); }
    finally { reading = false; if (live()) { syncOcr(); ctx?.refreshDetails?.(); } }
  };
  const scanNotice = () => (text.noText.size ? `Scanned pages: no text on ${text.noText.size} of ${doc.numPages}.${ocr ? ' Recognise text is in More.' : ''}` : '');
  text.on(pg => { if (pg !== 0 || !live()) return; idleText = scanNotice(); if (!q('say').textContent) say(''); syncOcr(); ctx?.refreshDetails?.(); });

  // ---- the strip's controls and the keys ----
  q('prev').onclick = () => go(current - 1);
  q('next').onclick = () => go(current + 1);
  q('zoom-out').onclick = () => step(-1);
  q('zoom-in').onclick = () => step(1);
  // Every choice applies, the current one too: Fit width again re-fits a page that was scrolled sideways or a pane that changed.
  fitPick.addEventListener('ui-pick', e => { const v = e.detail?.value; if (!['width', 'page', 'actual'].includes(v)) return; mode = v; remember({ zoom: v }); layout(); });
  // Pinch (a trackpad sends it as ctrl+wheel) and ctrl or cmd with the wheel step the zoom like the buttons, one step per gesture beat.
  let wheelAt = -1e9;
  scroll.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); if (e.timeStamp - wheelAt < 160) return; wheelAt = e.timeStamp; step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  // a file with printed labels takes what is printed ("iv", "S12") as well as a position; text that is neither leaves the page where it was
  const goTyped = () => {
    if (!labels) { go(pageInput.value); return; }
    const n = pageFromText(labels, doc.numPages, pageInput.value);
    if (n) go(n); else { pageInput.value = pageLabel(labels, current); say('No page has that label'); }
  };
  pageInput.onchange = goTyped;
  pageInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); goTyped(); scroll.focus({ preventScroll: true }); } };
  scroll.onscroll = () => { if (!frame) frame = requestAnimationFrame(schedule); };
  const selected = () => String(getSelection() || '').replace(/\s+/g, ' ').trim();
  body.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey, field = e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (mod && !e.altKey && !e.shiftKey && isKey(e, 'f')) { e.preventDefault(); e.stopPropagation(); find.open(selected() || null); return; }
    if (mod && e.altKey && isKey(e, 'g')) { e.preventDefault(); pageInput.focus(); pageInput.select(); return; }
    if (mod && !e.altKey && isKey(e, 'g')) { e.preventDefault(); if (find.isOpen()) find.step(e.shiftKey ? -1 : 1); else find.open(); return; }
    if (mod && !e.altKey && !e.shiftKey && isKey(e, 'e') && !field && selected()) { e.preventDefault(); find.open(selected()); return; }
    if (mod && e.shiftKey && isKey(e, 'c') && pending && !field) { e.preventDefault(); copyQuote(); return; }
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (find.isOpen()) { e.preventDefault(); find.close(); }
      else if (pending) { e.preventDefault(); clearPending(); }
      else if (editing) { e.preventDefault(); closeMark(); }
    }
  });
  scroll.onkeydown = e => {
    if (e.target.closest('input,textarea,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['PageDown', 'ArrowRight', 'PageUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { e.preventDefault(); go(e.key === 'Home' ? 1 : e.key === 'End' ? doc.numPages : current + (['PageDown', 'ArrowRight'].includes(e.key) ? 1 : -1)); }
    else if (['+', '=', '-', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') { mode = 'actual'; remember({ zoom: 'actual' }); layout(); } else step(e.key === '-' ? -1 : 1); }
  };

  // The engine hears the column's width (the sidebar, the inspector, the window, the rail) and calls back once it changes, and once when the column
  // first has its size (the bars above it are fitted by then): a fitted page fits again only when the room it was fitted to is not the room it has.
  const offScroll = watchWidth(scroll, () => {
    if (!live() || !scroll.clientWidth) return;
    const moved = scroll.clientWidth !== laid.w || (mode === 'page' && scroll.clientHeight !== laid.h);
    if (moved && (mode === 'width' || mode === 'page')) layout(); else schedule();
  });
  const offBox = watchWidth(workspace, () => { if (live()) rail.paint(); });

  layout(false);
  // where the history asked to return (Back, Forward), else where the file was left
  const start = startAt > 0 ? startAt : saved?.page || 1;
  if (start > 1) await land(Math.min(doc.numPages, start));
  // after the first page: the metadata, then the text (find, scanned pages, Details), one page at a time
  (async () => {
    meta = await doc.getMetadata().catch(() => null);
    if (live()) text.start(current);
  })();

  const view = {
    /** A note's place ({ kind: 'pdf', page, rects }): the page comes into view with the quotation marked. True, or what is not as it was. */
    reveal(a) {
      if (a?.kind !== 'pdf' || !Number.isInteger(a.page)) return false;
      const was = flash?.page; flash = { page: a.page, rects: a.rects || [] };
      if (was) decorate(states[was - 1]);
      land(a.page, a.rects?.[0] || null).then(() => { const s = states[a.page - 1]; if (s?.vp) decorate(s); });
      return a.document_version && hash && a.document_version !== hash ? 'The file changed since this note was made: its place may differ.' : true;
    },
    /** The Details lines (lib/pdf-props.mjs) from what has been read so far. */
    props: () => pdfProps({ info: meta?.info || {}, xmp: meta?.metadata ? k => meta.metadata.get(k) : null, firstPage: (text.runs[0] || []).map(r => r.str).join(' '),
      pages: doc.numPages, noText: text.done ? [...text.noText] : null }),
    stats: () => ({ ...stats, canvases: column.querySelectorAll('canvas').length, ...rail.stats(), find: find.state(), page: current, zoom, rotation, mode, idle: !busy && !queue.length && !frame }),
    find, text, go, land, lookup,
    /** The page in view (from 1): the Files history keeps it with the entry. */
    page: () => current,
  };
  const dispose = () => { disposed = true; lookup.reset(); revision++; queue.length = 0; cancelAnimationFrame(frame); offScroll(); offBox(); rail.dispose(); find.dispose(); states.forEach(release); doc.destroy(); };
  dispose.view = view;
  return dispose;
}

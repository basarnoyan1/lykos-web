// Evidence anchoring over a PDF.js text layer.
//
// An anchor is the smallest honest record of "this value came from here":
// document version hash, page, the exact excerpt, and normalised rectangles so
// the highlight survives zoom. Plan section 5.1 requires reported_value and
// source_locator to travel together; this is the locator half.
//
// Nothing here parses structure. No GROBID, no Docling, no model. A human
// selects text and says what it is -- which is the point: the product thesis
// is demonstrable without any of the heavy machinery.
// PDF.js is 450 KB. It is loaded the first time a document is opened, not at
// startup, where it was half of everything the app fetched before first paint.
import { appUrl } from './app-url.mjs';
import { installCompat, compatWorker } from './pdfjs-compat.mjs';
import { placeBox, sizeStage } from './reader-geometry.mjs';
import { pageTextQuality, selectTextLayer } from './pdf-text-quality.mjs';
let pdfjsP = null;
// An engine without Map.getOrInsertComputed gets it first, in the page and in
// the worker (lib/pdfjs-compat.mjs); otherwise no page is drawn.
const pdfjsLib = () => pdfjsP || (pdfjsP = (async () => {
  installCompat();
  const m = await import(appUrl('pdfjs/build/pdf.min.mjs'));
  const src = appUrl('pdfjs/build/pdf.worker.min.mjs');
  const port = await compatWorker(src).catch(() => null);
  if (port) m.GlobalWorkerOptions.workerPort = port; else m.GlobalWorkerOptions.workerSrc = src;
  return m;
})());

export async function loadPdf(source) {
  const bytes = source instanceof Uint8Array
    ? source
    : new Uint8Array(await (await fetch(source)).arrayBuffer());
  // Content hash = the DocumentVersion identity in plan C5. Anchors are bound
  // to it, so a replaced file invalidates rather than silently re-points them.
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    // Base-14 metrics and CMaps. Without them a non-embedded font is measured
    // with a substitute, so the text layer and the canvas disagree on width.
    standardFontDataUrl: appUrl('pdfjs/standard_fonts/'),
    cMapUrl: appUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    wasmUrl: appUrl('pdfjs/wasm/'),
  });
  // A file PDF.js cannot open still holds a worker-side document until its task is destroyed.
  const doc = await task.promise.catch(error => { task.destroy(); throw error; });
  // Recent PDF.js versions moved destruction from the document to its loading
  // task. Keep one cleanup contract for viewers and background file readers.
  if (typeof doc.destroy !== 'function') doc.destroy = () => task.destroy();
  return { doc, hash, pages: doc.numPages, OPS: pdfjs.OPS };
}

/** Renders one page and a positioned text layer that real selection works on.
 *
 * Builds into a detached element and swaps in one shot. Mutating the live
 * container in stages lets two concurrent renders interleave — one appends its
 * canvas, the other clears the text layer — leaving a page that looks fine but
 * cannot be selected. `isCurrent` lets a superseded render discard its work
 * instead of clobbering a newer one; `onTask` lets it cancel the drawing itself.
 */
export async function renderPage(doc, pageNo, container, fitWidth = null,
                                 isCurrent = () => true, absoluteScale = null, textFor = null,
                                 { rotation = 0, onTask = null } = {}) {
  const page = await doc.getPage(pageNo);
  if (!isCurrent()) return null;
  const natural = page.getViewport({ scale: 1 });
  // A hidden or not-yet-laid-out container reports zero width, which would make
  // the scale zero or negative and render nothing at all.
  const usable = fitWidth && fitWidth > 0 ? Math.max(320, fitWidth) : null;
  const scale = absoluteScale ?? (usable ? Math.min(2, usable / natural.width) : 1.4);
  // `rotation` turns the view (a sideways scan, a landscape table) on top of the page's own /Rotate; nothing is written into the file.
  const viewport = rotation ? page.getViewport({ scale, rotation: ((page.rotate || 0) + rotation) % 360 }) : page.getViewport({ scale });

  const frag = document.createElement('div');
  const canvas = document.createElement('canvas');
  // Keep high zoom and Retina pages below WebKit's canvas memory limits.
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2,
    Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
    8192 / viewport.width, 8192 / viewport.height);
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  frag.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Not enough memory to draw this page");
  ctx.scale(ratio, ratio);

  // `onTask` hears the render task, so a viewer whose zoom moved on can cancel a drawing nobody will see (it then rejects, and the caller drops it).
  const task = page.render({ canvasContext: ctx, viewport });
  onTask?.(task);
  let [, content] = await Promise.all([
    task.promise,
    page.getTextContent().catch(() => null),
  ]);
  // A page that is a picture has no text of its own; recognised text (lib/ocr.mjs), when there is
  // any, is drawn as the text layer in its place.
  const pdfjs = await pdfjsLib();
  const quality = await pageTextQuality(page, content, pdfjs.OPS);
  viewport.textQuality = quality; viewport.noText = quality.needsOcr;
  if (quality.needsOcr && textFor) {
    const alt = await textFor(pageNo).catch(() => null);
    const selected = selectTextLayer(content, alt, quality);
    if (selected !== content) { content = selected; viewport.recognised = true; }
  }
  if (!isCurrent()) { viewport.naturalWidth = natural.width; return viewport; }

  // PDF.js's own TextLayer, not a hand-rolled one. Positioning glyph runs by
  // hand is an approximation, and a selection taken from an approximate layer
  // does not line up with the glyphs actually painted on the canvas — which is
  // what the reader sees. This is the same class the official viewer uses.
  const layer = document.createElement('div');
  layer.className = 'textlayer';
  // TextLayer lays its spans out in PDF units multiplied by this variable. It
  // is not derived from the viewport, so without it the layer renders at PDF
  // scale and drifts further from the canvas across every line — which is what
  // made selections and highlights land beside the glyphs rather than on them.
  layer.style.setProperty('--scale-factor', scale);
  layer.style.setProperty('--total-scale-factor', scale);
  pdfjs.setLayerDimensions(layer, viewport);
  if (content) {
  const textLayer = new pdfjs.TextLayer({
    textContentSource: content,
    container: layer,
    viewport,
  });
  try { await textLayer.render(); frag.appendChild(layer); }
  catch (err) { console.warn('[reader] Text selection unavailable', err); }
  }

  if (!isCurrent()) { viewport.naturalWidth = natural.width; return viewport; }
  sizeStage(container, viewport.width, viewport.height);   // the stage's rule sizes the canvas to it
  container.replaceChildren(...frag.childNodes);

  viewport.naturalWidth = natural.width;
  return viewport;
}

/**
 * A page as a picture only, `width` CSS pixels wide (a file tile, the page-previews rail): no text layer, drawn at the screen's density
 * up to 2, and the page's parsed resources let go after. The caller's style sizes it. Returns the canvas, or null when superseded.
 */
export async function renderThumbnail(doc, pageNo, width, isCurrent = () => true) {
  const page = await doc.getPage(pageNo);
  if (!isCurrent()) return null;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: width * ratio / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Not enough memory to draw this page');
  try { await page.render({ canvasContext: ctx, viewport }).promise; } finally { page.cleanup?.(); }
  return isCurrent() ? canvas : null;
}

/**
 * Captures the current selection as rectangles in PDF user space.
 *
 * Screen-relative fractions drift whenever the page is re-rendered at another
 * scale, and a locator that depends on how the document happened to be
 * displayed is not a source locator. Page coordinates are the document's own,
 * so an anchor survives zoom, resize and re-render exactly.
 */
export function captureSelection(container, viewport) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const base = container.getBoundingClientRect();
  const bw = parseFloat(getComputedStyle(container).borderLeftWidth) || 0;
  const bt = parseFloat(getComputedStyle(container).borderTopWidth) || 0;
  const toPdf = (x, y) => viewport
    ? viewport.convertToPdfPoint(x, y)
    : [x / base.width, y / base.height];
  const rects = [...sel.getRangeAt(0).getClientRects()]
    .filter(r => r.width > 1 && r.height > 1)
    .map(r => {
      const [x1, y1] = toPdf(r.left - base.left - bw, r.top - base.top - bt);
      const [x2, y2] = toPdf(r.right - base.left - bw, r.bottom - base.top - bt);
      return { x1, y1, x2, y2 };
    });
  return rects.length ? { text, rects, space: viewport ? 'pdf' : 'box', ...(viewport?.recognised ? { ocr: true, reviewRequired: true } : {}) } : null;
}

/** Converts a stored locator rectangle back to pixels in the current render.
 *
 * Absolutely-positioned children are placed against the padding box, while
 * getBoundingClientRect() includes the border, so the border width has to come
 * out or every highlight sits one pixel low and right. */
export function rectToBox(r, container, viewport) {
  const base = container.getBoundingClientRect();
  if (r.x1 === undefined) {                    // locators stored before page space
    return { left: r.x * base.width, top: r.y * base.height,
             width: r.w * base.width, height: r.h * base.height };
  }
  const [ax, ay] = viewport.convertToViewportPoint(r.x1, r.y1);
  const [bx, by] = viewport.convertToViewportPoint(r.x2, r.y2);
  return { left: Math.min(ax, bx), top: Math.min(ay, by),
           width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function drawHighlights(container, rects, className = 'hl', viewport = null, title = '') {
  // Only this class is cleared, so a pending selection and the values already
  // recorded on the page can be shown at the same time.
  container.querySelectorAll('.' + className).forEach(e => e.remove());
  for (const r of rects) {
    const box = rectToBox(r, container, viewport);
    const d = document.createElement('div');
    d.className = className;
    if (title) d.title = title;
    placeBox(d, box);
    container.appendChild(d);
  }
}

/** Normalises a reported excerpt to a typed value, without discarding the original. */
export function normalise(field, reported, fields) {
  const def = fields.find(f => f.id === field);
  if (def?.type !== 'integer') return { normalized_value: reported, ok: true };
  const nums = reported.match(/\d+/g);
  if (!nums) return { normalized_value: null, ok: false, why: 'Selection contains no number.' };
  if (nums.length > 1) return { normalized_value: Number(nums[0]), ok: true,
    why: `Selection contains ${nums.length} numbers. Took the first.` };
  return { normalized_value: Number(nums[0]), ok: true };
}

/**
 * Finds a quote in the rendered text layer and returns a selection-shaped
 * capture for it, or null when the quote is not on the page.
 *
 * A model proposal is only usable if it can be located in the document: the
 * anchor is what makes it checkable (plan F4). Whitespace is normalised on both
 * sides because a PDF's text runs break lines where the layout did, not where
 * the sentence does.
 */
export function locateQuote(container, viewport, quote, nth = 0) {
  const spans = [...container.querySelectorAll('.textlayer span')];
  if (!spans.length) return null;

  const norm = t => t.replace(/\s+/g, ' ');
  const needle = norm(quote).trim().toLowerCase();
  if (!needle) return null;

  // Flatten the layer into one string, remembering where each span landed.
  let flat = '';
  const map = [];
  for (const span of spans) {
    const text = norm(span.textContent);
    map.push({ span, start: flat.length, end: flat.length + text.length });
    flat += text + ' ';
  }
  // nth: a later occurrence on the page (a search snippet says which); the first when there are fewer
  const lower = flat.toLowerCase();
  let at = lower.indexOf(needle);
  if (at < 0) return null;
  for (let k = 0, next; k < nth && (next = lower.indexOf(needle, at + 1)) >= 0; k++) at = next;
  const end = at + needle.length;

  const range = document.createRange();
  const edge = (offset, which) => {
    const hit = map.find(m => offset >= m.start && offset <= m.end);
    if (!hit || !hit.span.firstChild) return false;
    const local = Math.max(0, Math.min(hit.span.firstChild.length, offset - hit.start));
    which === 'start' ? range.setStart(hit.span.firstChild, local)
                      : range.setEnd(hit.span.firstChild, local);
    return true;
  };
  if (!edge(at, 'start') || !edge(end, 'end')) return null;

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const cap = captureSelection(container, viewport);
  sel.removeAllRanges();
  return cap;
}

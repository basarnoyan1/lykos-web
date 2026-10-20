// Text for a scanned page (plan §4.5a).
//
// A page that is a picture has no text layer, so nothing on it can be found,
// quoted or anchored. In the desktop app the page is drawn to an image, sent to
// macOS Vision (src-tauri/src/ocr_vision.rs), and what comes back, each word
// with its box, is kept beside the document (keyed by its hash) in the same
// item structure the document index uses (lib/doctext.mjs). From then on the
// reader draws a text layer over the picture and search, quotes and anchors
// work as on any page. Recognised text is a reading of the picture, never the
// author's text: the items carry `ocr: true`, and a quote anchored on them
// says so.
import { inDesktop } from './native.mjs';
import { getDocText, putDocText } from './files.mjs';
import { projectGeneration, recoveryOwner } from '../store.mjs';
import { textLayerQuality, pageTextQuality } from './pdf-text-quality.mjs';

export const ENGINE = 'macOS Vision';
export const ocrAvailable = () => inDesktop();
const key = hash => `ocr:${hash}`;
const mem = new Map(), MEM_MAX = 32;   // hash -> { pages: { [n]: { items, at } } }, the most recent few

/** A page drawn at a resolution fit for reading small print, as PNG bytes. */
export async function pagePng(page, { dpi = 220, maxPixels = 24_000_000 } = {}) {
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, Math.sqrt(maxPixels / (natural.width * natural.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport, background: 'rgb(255,255,255)' }).promise;
  const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('could not encode the page'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Vision on an encoded image: [{ text, x, y, w, h, confidence, words }] in fractions of the image, origin top left. */
export async function recognise(bytes, languages = []) {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Text recognition is in the desktop app');
  return invoke('ocr_image', bytes, { headers: { 'x-languages': languages.join(',') } });
}

/**
 * Recognised words as document-index items in the page's units (PDF points,
 * origin at the bottom left): { str, x, y, w, h, angle, ocr }, y the bottom of
 * the box. `view` is the page's [x0, y0, x1, y1].
 */
export function itemsFrom(lines, view = [0, 0, 612, 792]) {
  const W = view[2] - view[0], H = view[3] - view[1];
  const items = [];
  for (const line of lines) {
    const words = line.words?.length ? line.words : [{ text: line.text, x: line.x, y: line.y, w: line.w, h: line.h, confidence: line.confidence }];
    words.forEach((w, i) => {
      if (!w.text?.trim()) return;
      items.push({ str: w.text, x: view[0] + w.x * W, y: view[1] + H - (w.y + w.h) * H, w: w.w * W, h: w.h * H, angle: 0, ocr: true,
        confidence: Math.round((w.confidence ?? 0) * 100) / 100, eol: i === words.length - 1 });
    });
  }
  return items;
}

/** The same items as the text content pdf.js's TextLayer draws (invisible text over the picture). */
export function textContentFrom(items) {
  return {
    items: items.map(i => ({ str: i.str + (i.eol ? '' : ' '), dir: 'ltr', transform: [0.85 * i.h, 0, 0, 0.85 * i.h, i.x, i.y], width: i.w, height: i.h, fontName: 'ocr', hasEOL: Boolean(i.eol) })),
    styles: { ocr: { fontFamily: 'sans-serif', ascent: 0.95, descent: -0.25, vertical: false } },
    lang: null,
  };
}

async function load(hash) {
  if (!mem.has(hash)) { mem.set(hash, (await getDocText(key(hash)).catch(() => null)) || { hash, engine: ENGINE, pages: {} }); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); }
  return mem.get(hash);
}

/** The recognised items of a page, or null. */
export async function ocrItems(hash, n) { return (await load(hash)).pages[n]?.items || null; }

/** Keep what was recognised on a page. */
export async function saveOcr(hash, n, items, { isCurrent = () => true, quality = null } = {}) {
  const previous = await load(hash);
  if (!isCurrent()) throw new Error('The project or document changed during text recognition.');
  const o = { ...previous, pages: { ...previous.pages, [n]: { items, at: new Date().toISOString(), quality, reviewRequired: true } } };
  await putDocText(key(hash), o);
  if (!isCurrent()) throw new Error('The project or document changed during text recognition.');
  mem.set(hash, o);
}

/** Pages with no usable article text, including watermark-only scans. */
export async function pagesWithoutText(doc, { OPS, isCurrent = () => true } = {}) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (!isCurrent()) throw new Error('The project or document changed during text recognition.');
    const page = await doc.getPage(n), content = await page.getTextContent().catch(() => null);
    const quality = await pageTextQuality(page, content, OPS);
    if (!isCurrent()) throw new Error('The project or document changed during text recognition.');
    if (quality.needsOcr) out.push(n);
  }
  return out;
}

/** Recognise one page of an open document and keep the result; returns the number of words. */
export async function recognisePage(doc, hash, n, languages = [], { isCurrent = () => true, render = pagePng, recognizer = recognise, quality = null, OPS } = {}) {
  const generation = projectGeneration(), owner = recoveryOwner();
  const live = () => generation === projectGeneration() && owner === recoveryOwner() && isCurrent();
  const check = () => { if (!live()) throw new Error('The project or document changed during text recognition.'); };
  const page = await doc.getPage(n);
  if (!quality && page.getTextContent) quality = await pageTextQuality(page, await page.getTextContent().catch(() => null), OPS);
  check(); const image = await render(page); check();
  const lines = await recognizer(image, languages); check();
  const items = itemsFrom(lines, page.view);
  await saveOcr(hash, n, items, { isCurrent: live, quality });
  return items.length;
}

/** Keep valid native text; overlay unusable scan text without losing its original layer. */
export async function withOcr(idx, hash, flatten) {
  const o = await load(hash);
  const ns = Object.keys(o.pages).map(Number).filter(n => {
    const p = idx.pages[n - 1];
    return p && !p.ocr && ((p.textQuality || textLayerQuality(p.items, { view: p.view })).needsOcr || o.pages[n].quality?.needsOcr) && o.pages[n].items?.length;
  });
  if (!ns.length) return idx;
  const pages = idx.pages.map((p, i) => ns.includes(i + 1) ? {
    ...p, nativeText: p.text, nativeItems: p.items,
    text: flatten(o.pages[i + 1].items, { dehyphen: true }).text, items: o.pages[i + 1].items, ocr: true,
    ocrInfo: { engine: o.engine || ENGINE, at: o.pages[i + 1].at, reviewRequired: true, quality: o.pages[i + 1].quality || p.textQuality || textLayerQuality(p.items, { view: p.view }) },
  } : p);
  return { ...idx, pages };
}

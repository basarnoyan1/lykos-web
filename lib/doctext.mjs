// The document index: every page's text with item positions, built once per
// document hash without rendering, so a quote can be located — page and
// rectangles in PDF user space — whether or not the reader has drawn the page.
// This is what lets a model's proposal for page 9 be checked and shown while
// the reader is on page 1 (plan F4, D4).
import { loadPdf } from './anchor.mjs';
import { getBytes, getDocText, putDocText } from './files.mjs';
import { get, recoveryOwner, projectGeneration } from '../store.mjs';
import { withOcr } from './ocr.mjs';
import { pageTextQuality } from './pdf-text-quality.mjs';

const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', ' ': ' ' };
export const normaliseText = s => String(s || '').replace(/-\s*\n\s*(?=[a-z])/gi, '').replace(/[ﬁﬂﬀﬃﬄ“”‘’–— ]/g, c => LIG[c]).replace(/\s+/g, ' ').trim();

/** Items joined into one string, each remembering where it landed. */
export function flatten(items, { dehyphen = false } = {}) {
  let text = ''; const spans = [];
  items.forEach((item, i) => {
    let s = normaliseText(item.str);
    if (!s) return;
    const next = items[i + 1] ? normaliseText(items[i + 1].str) : '';
    const joinTight = dehyphen && /[a-z]-$/i.test(s) && /^[a-z]/.test(next);
    if (joinTight) s = s.slice(0, -1);
    spans.push({ start: text.length, end: text.length + s.length, i, length: s.length });
    text += s + (joinTight ? '' : ' ');
  });
  return { text, spans };
}

// A text item can be a whole line. Restrict the rectangle to the matched
// characters; the item width gives an approximation when glyph widths differ.
const rectOf = (it, from, to, length) => {
  const angle = it.angle || 0, dx = Math.cos(angle) * it.w, dy = Math.sin(angle) * it.w;
  const nx = -Math.sin(angle) * it.h, ny = Math.cos(angle) * it.h;
  const a = from / length, b = to / length;
  const xs = [it.x + dx * a, it.x + dx * b, it.x + dx * a + nx, it.x + dx * b + nx];
  const ys = [it.y + dy * a, it.y + dy * b, it.y + dy * a + ny, it.y + dy * b + ny];
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
};

const flattened = new WeakMap();
function pageTextIndex(page, dehyphen) {
  let entry = flattened.get(page);
  if (!entry) { entry = {}; flattened.set(page, entry); }
  const key = dehyphen ? 'joined' : 'plain';
  return entry[key] ||= (() => { const r = flatten(page.items || [], { dehyphen }); return { ...r, lower: r.text.toLowerCase() }; })();
}

/** Where a quote is: 1-based page and the rectangles of the items it spans. */
export function locateIn(pages, quote) {
  const needle = normaliseText(quote).toLowerCase();
  if (needle.length < 2) return null;
  for (const [k, page] of pages.entries()) {
    for (const dehyphen of [false, true]) {
      const { text, spans, lower } = pageTextIndex(page, dehyphen);
      const at = lower.indexOf(needle);
      if (at < 0) continue;
      const end = at + needle.length;
      let lo = 0, hi = spans.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid].end <= at) lo = mid + 1; else hi = mid; }
      const hit = [];
      for (let i = lo; i < spans.length && spans[i].start < end; i++) hit.push(spans[i]);
      if (!hit.length) continue;
      return { page: k + 1, rects: hit.map(sp => rectOf(page.items[sp.i], Math.max(0, at - sp.start), Math.min(sp.length, end - sp.start), sp.length)), text: text.slice(at, end),
        ...(page.ocr || hit.some(sp => page.items[sp.i].ocr) ? { ocr: true, reviewRequired: true } : {}) };
    }
  }
  return null;
}

/** Up to `max` matches of a query with 200 characters of context. */
export function findIn(pages, query, max = 20) {
  const q = normaliseText(query).toLowerCase(); const out = [];
  if (!q) return out;
  for (const [k, page] of pages.entries()) {
    const { text, lower } = pageTextIndex(page, true);
    let from = 0;
    while (out.length < max) {
      const at = lower.indexOf(q, from); if (at < 0) break;
      out.push({ page: k + 1, context: text.slice(Math.max(0, at - 90), at + q.length + 110) });
      from = at + q.length;
    }
    if (out.length >= max) break;
  }
  return out;
}

// ---- browser side ---------------------------------------------------------
// paperId -> index, for the session: the most recent few, so a full-text pass over
// hundreds of PDFs does not keep every page's positioned text in memory.
const mem = new Map(), MEM_MAX = 16;
const memoryKey = paperId => JSON.stringify([recoveryOwner(), projectGeneration(), paperId]);
const remember = (k, v) => { mem.delete(k); mem.set(k, v); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };
async function build(bytes) {
  const { doc, hash, OPS } = await loadPdf(bytes);
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(i => i.str && i.str.trim()).map(i => {
        const [a, b, , d, e, f] = i.transform || [1, 0, 0, 1, 0, 0];
        return { str: i.str, x: e, y: f, w: i.width ?? Math.hypot(a, b) * i.str.length * 0.5, h: i.height ?? Math.hypot(b, d), angle: Math.atan2(b, a) };
      });
      const textQuality = await pageTextQuality(page, content, OPS);
      pages.push({ text: flatten(items, { dehyphen: true }).text, items, view: page.view, textQuality });
    }
    return { hash, pages, builtAt: new Date().toISOString() };
  } finally { doc.destroy?.(); }
}

export async function index(paperId, { fresh = false } = {}) {
  const key = memoryKey(paperId), generation = projectGeneration();
  const cached = mem.get(key);
  const knownHash = get().papers.find(p => p.id === paperId)?.pdfHash;
  if (cached && !fresh && (!knownHash || knownHash.startsWith(cached.hash))) return cached;
  const bytes = await getBytes(paperId);
  if (!bytes) throw new Error('document unreachable');
  const hashHex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  if (generation !== projectGeneration()) throw new Error('The project changed while its document index was being read.');
  if (cached?.hash === hashHex) return cached;
  let idx = await getDocText(hashHex).catch(() => null);
  if (!idx) { idx = await build(bytes); await putDocText(hashHex, idx).catch(() => {}); }
  // pages that are pictures take their recognised text, where there is some (lib/ocr.mjs)
  idx = await withOcr(idx, hashHex, flatten);
  if (generation !== projectGeneration()) throw new Error('The project changed while its document index was being read.');
  if (get().papers.find(p => p.id === paperId)?.pdfHash !== knownHash)
    throw new Error('The document version changed while its index was being read.');
  remember(key, idx);
  return idx;
}

/** Drop the session's index of a paper, so recognised text is read in afresh. */
export const refreshIndex = paperId => mem.delete(memoryKey(paperId));

export function pageText(idx, from = 1, to = idx.pages.length) {
  const a = Math.max(1, from), b = Math.min(idx.pages.length, to);
  const out = [];
  for (let n = a; n <= b; n++) out.push(`[[page ${n}]]\n${idx.pages[n - 1].text}`);
  return out.join('\n\n');
}

export async function locate(paperId, quote) {
  const idx = await index(paperId);
  const r = locateIn(idx.pages, quote);
  return r ? { page: r.page, rects: r.rects, document_version: idx.hash, ...(r.ocr ? { ocr: true, reviewRequired: true } : {}) } : null;
}

/** A page drawn to a PNG data URL, for a vision model. */
export async function pageImage(paperId, pageNo, maxWidth = 1200) {
  const bytes = await getBytes(paperId);
  if (!bytes) throw new Error('document unreachable');
  const { doc } = await loadPdf(bytes);
  try {
    const page = await doc.getPage(pageNo);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, maxWidth / natural.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally { doc.destroy?.(); }
}

// PDF annotations: highlights, underlines, strike-outs, notes and area clips a
// reader makes on a paper, kept with the project (plan §4.7, "PDF annotations
// and full-text search", 2026-09-29).
//
// state.annotations[paperId] = [{ id, page, kind, rects, text, comment, at,
//   document_version, imported?, author? }]
// Rectangles are in PDF user space ({x1, y1, x2, y2}, origin bottom left), the
// same space evidence anchors use (lib/anchor.mjs), so a mark survives zoom,
// resize and re-render exactly. There is no colour: one neutral style.
//
// state.annotationImports[paperId] = { hash, found, status: 'imported'|'dismissed', at }
// records that the file's own annotations were offered, so the offer is made once.
//
// Everything here is pure except for crypto.randomUUID.
import { normaliseText } from './doctext.mjs';

export const KINDS = ['highlight', 'underline', 'strikeout', 'area', 'note'];
export const KIND_LABEL = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', area: 'Area clip', note: 'Note' };

const finite = n => typeof n === 'number' && Number.isFinite(n);
/** A rectangle with x1 < x2 and y1 < y2, or null. */
export function normRect(r) {
  if (!r || ![r.x1, r.y1, r.x2, r.y2].every(finite)) return null;
  return { x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2), x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2) };
}

/** A box in viewport pixels ({left, top, width, height}) to PDF units, through a PDF.js viewport. */
export function boxToPdf(box, viewport) {
  const [x1, y1] = viewport.convertToPdfPoint(box.left, box.top);
  const [x2, y2] = viewport.convertToPdfPoint(box.left + box.width, box.top + box.height);
  return normRect({ x1, y1, x2, y2 });
}
/** A PDF-unit rectangle to a box in viewport pixels, at whatever zoom the viewport has. */
export function pdfToBox(rect, viewport) {
  const [ax, ay] = viewport.convertToViewportPoint(rect.x1, rect.y1);
  const [bx, by] = viewport.convertToViewportPoint(rect.x2, rect.y2);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/**
 * QuadPoints of a markup annotation to rectangles. PDF.js gives either a flat
 * array (eight numbers per quad) or, in older builds, arrays of four {x, y}.
 */
export function quadsToRects(quads) {
  if (!quads) return [];
  const out = [];
  if (Array.isArray(quads) && quads.length && Array.isArray(quads[0])) {
    for (const q of quads) { const r = normRect({ x1: Math.min(...q.map(p => p.x)), y1: Math.min(...q.map(p => p.y)), x2: Math.max(...q.map(p => p.x)), y2: Math.max(...q.map(p => p.y)) }); if (r) out.push(r); }
    return out;
  }
  const a = Array.from(quads);
  for (let i = 0; i + 7 < a.length; i += 8) {
    const xs = [a[i], a[i + 2], a[i + 4], a[i + 6]], ys = [a[i + 1], a[i + 3], a[i + 5], a[i + 7]];
    const r = normRect({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
    if (r) out.push(r);
  }
  return out;
}

/**
 * The words of a page under some rectangles. Items are lib/doctext.mjs page
 * items ({str, x, y, w, h}); an item that crosses a rectangle's edge gives the
 * share of its characters inside, which is exact for monospaced runs and close
 * for the rest.
 */
export function textInRects(items, rects) {
  const parts = [];
  for (const r0 of rects || []) {
    const r = normRect(r0); if (!r) continue;
    const line = [];
    for (const it of items || []) {
      if (!it?.str) continue;
      const cy = it.y + (it.h || 0) / 2;
      if (cy < r.y1 - 1 || cy > r.y2 + 1) continue;
      const w = it.w || 0, x1 = it.x, x2 = it.x + w;
      if (x2 < r.x1 || x1 > r.x2) continue;
      const n = it.str.length;
      const from = w > 0 ? Math.max(0, Math.round(((r.x1 - x1) / w) * n)) : 0;
      const to = w > 0 ? Math.min(n, Math.round(((r.x2 - x1) / w) * n)) : n;
      if (to > from) line.push({ x: x1, s: it.str.slice(from, to) });
    }
    line.sort((a, b) => a.x - b.x);
    parts.push(line.map(p => p.s).join(' '));
  }
  return normaliseText(parts.join(' '));
}

const str = v => (typeof v === 'string' ? v : v?.str || '').trim();
const MARKUP = { Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', Squiggly: 'underline' };

/**
 * A page's embedded annotations, as PDF.js getAnnotations() returns them, to
 * annotation drafts. Markup (Highlight, Underline, StrikeOut, Squiggly) keeps
 * its quads and the words under them; Text (a sticky note) and a Popup whose
 * parent is not itself imported keep their contents as a note. Links, widgets
 * and the rest are not annotations a reader made.
 */
export function fromPdfAnnotations(pageNo, list, items = []) {
  const out = [];
  const markupIds = new Set((list || []).filter(a => MARKUP[a?.subtype] || a?.subtype === 'Text').map(a => a.id));
  for (const a of list || []) {
    const kind = MARKUP[a?.subtype] || (a?.subtype === 'Text' ? 'note' : a?.subtype === 'Popup' && !markupIds.has(a.parentId) ? 'note' : null);
    if (!kind) continue;
    const comment = str(a.contentsObj) || str(a.contents);
    let rects = kind === 'note' ? [normRect({ x1: a.rect?.[0], y1: a.rect?.[1], x2: a.rect?.[2], y2: a.rect?.[3] })].filter(Boolean) : quadsToRects(a.quadPoints);
    if (!rects.length && a.rect) rects = [normRect({ x1: a.rect[0], y1: a.rect[1], x2: a.rect[2], y2: a.rect[3] })].filter(Boolean);
    if (!rects.length) continue;
    if (kind === 'note' && !comment) continue;
    out.push({ kind, page: pageNo, rects, text: kind === 'note' ? '' : textInRects(items, rects), comment,
      imported: true, author: str(a.titleObj) || str(a.title) || '', source_id: a.id ? String(a.id) : '' });
  }
  return out;
}

// ---- project state ---------------------------------------------------------

export const annotationsOf = (s, paperId) => (Array.isArray(s?.annotations?.[paperId]) ? s.annotations[paperId] : []);
const newId = () => `an-${(globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`).slice(0, 13)}`;

/** A clean annotation from a draft, or an Error naming what is missing. */
export function cleanAnnotation(d) {
  const kind = KINDS.includes(d?.kind) ? d.kind : null;
  if (!kind) throw new Error(`Unknown annotation kind: ${d?.kind}`);
  const page = Number(d.page);
  if (!Number.isInteger(page) || page < 1) throw new Error('An annotation needs a page');
  const rects = (d.rects || []).map(normRect).filter(Boolean);
  if (!rects.length) throw new Error('An annotation needs a place on the page');
  const a = { id: d.id || newId(), page, kind, rects, text: String(d.text || '').trim(), comment: String(d.comment || '').trim(), at: d.at || new Date().toISOString() };
  if (d.document_version) a.document_version = String(d.document_version);
  if (d.imported) { a.imported = true; if (d.author) a.author = String(d.author); if (d.source_id) a.source_id = String(d.source_id); }
  return a;
}

export function addAnnotation(s, paperId, draft) {
  const a = cleanAnnotation(draft);
  s.annotations = { ...(s.annotations && typeof s.annotations === 'object' ? s.annotations : {}) };
  s.annotations[paperId] = [...annotationsOf(s, paperId), a];
  return a;
}
export function editAnnotation(s, paperId, id, patch) {
  const a = annotationsOf(s, paperId).find(x => x.id === id);
  if (!a) return null;
  if ('comment' in patch) a.comment = String(patch.comment || '').trim();
  if ('kind' in patch && ['highlight', 'underline', 'strikeout'].includes(patch.kind) && ['highlight', 'underline', 'strikeout'].includes(a.kind)) a.kind = patch.kind;
  a.edited = new Date().toISOString();
  return a;
}
export function removeAnnotation(s, paperId, id) {
  const list = annotationsOf(s, paperId), next = list.filter(x => x.id !== id);
  if (next.length === list.length) return false;
  s.annotations = { ...s.annotations, [paperId]: next };
  if (!next.length) delete s.annotations[paperId];
  return true;
}

/** Reading order: by page, then top to bottom, then left to right. */
export function sortAnnotations(list) {
  const top = a => Math.max(...a.rects.map(r => r.y2)), left = a => Math.min(...a.rects.map(r => r.x1));
  return [...list].sort((a, b) => a.page - b.page || top(b) - top(a) || left(a) - left(b));
}

// ---- the file's own annotations ------------------------------------------------

/** Whether to offer importing the file's annotations: some were found and nothing was decided for this file. */
export function importOffer(s, paperId, hash, found) {
  if (!found) return false;
  const rec = s?.annotationImports?.[paperId];
  return !rec || (rec.hash !== hash && rec.status !== 'dismissed');
}

const sameRects = (a, b) => a.length === b.length && a.every((r, i) => ['x1', 'y1', 'x2', 'y2'].every(k => Math.abs(r[k] - b[i][k]) < 0.5));
/** Adds the drafts not already present (same page, kind and place); records the import. Returns the number added. */
export function importAnnotations(s, paperId, drafts, hash) {
  const have = annotationsOf(s, paperId);
  let n = 0;
  for (const d of drafts) {
    const rects = d.rects.map(normRect).filter(Boolean);
    if (have.some(a => a.page === d.page && a.kind === d.kind && sameRects(a.rects, rects))) continue;
    addAnnotation(s, paperId, { ...d, document_version: hash, imported: true });
    n++;
  }
  s.annotationImports = { ...(s.annotationImports || {}), [paperId]: { hash, found: drafts.length, status: 'imported', added: n, at: new Date().toISOString() } };
  return n;
}
export function dismissImport(s, paperId, hash, found) {
  s.annotationImports = { ...(s.annotationImports || {}), [paperId]: { hash, found, status: 'dismissed', at: new Date().toISOString() } };
}

// ---- a literature note from a paper's annotations ------------------------------

const citeOf = p => [p?.label || p?.title || 'Untitled paper', p?.year && !String(p?.label || '').includes(String(p.year)) ? `(${p.year})` : ''].filter(Boolean).join(' ');

/**
 * The text of a literature note: the paper, then each annotation in reading
 * order as a quotation with its page, and the comment under it. An area clip
 * is named by its page; its image goes with the export, not the note.
 */
export function annotationNoteText(paper, list) {
  const lines = [`Literature note: ${citeOf(paper)}${paper?.title && paper.title !== paper.label ? `. ${paper.title}` : ''}`];
  for (const a of sortAnnotations(list)) {
    const where = `p. ${a.page}`;
    if (a.kind === 'area') lines.push('', `[Area clip, ${where}]`);
    else if (a.kind === 'note') lines.push('', `[Note, ${where}]`);
    else lines.push('', `"${a.text || '(no text under the mark)'}" (${where})${a.kind === 'highlight' ? '' : ` [${KIND_LABEL[a.kind].toLowerCase()}]`}`);
    if (a.comment) lines.push(`  ${a.comment}`);
  }
  return lines.join('\n');
}

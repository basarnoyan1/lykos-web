// A PDF's outline (its bookmarks) as the rows of the rail's Contents: title, page and depth, in reading order (plan PDF-OPTIONS §3, T3).
// PDF.js gives the outline as a tree whose destinations are names or explicit arrays; `resolve` (the viewer's, over the open document) turns
// one into a page number. A row whose destination cannot be resolved is left out; its children keep their place. Pure apart from `resolve`.
// The Tables group beside it lists the tables the page finder (lib/table-detect.mjs) detects, page by page; `findTables` below is its scan.

/** The outline tree flattened: [{ title, page, depth }]. No outline gives []. `max` bounds a pathological outline. */
export async function flattenOutline(outline, resolve, { max = 2000 } = {}) {
  const rows = [];
  const walk = async (items, depth) => {
    for (const it of Array.isArray(items) ? items : []) {
      if (rows.length >= max) return;
      const title = String(it?.title ?? '').replace(/\s+/g, ' ').trim();
      let page = null;
      if (title && it?.dest != null) { try { page = await resolve(it.dest); } catch { page = null; } }
      if (title && Number.isInteger(page) && page >= 1) rows.push({ title, page, depth: Math.min(depth, 3) });
      if (it?.items?.length) await walk(it.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return rows;
}

/** A resolver over a PDF.js document: a named destination is looked up, an explicit one's first entry is the page's reference (or its index). */
export const pdfResolver = doc => async dest => {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  const ref = Array.isArray(explicit) ? explicit[0] : null;
  if (ref == null) return null;
  if (Number.isInteger(ref)) return ref + 1;
  return (await doc.getPageIndex(ref)) + 1;
};

/** The row of the section page `page` is in: the last row that starts on or before it, or -1 before the first. */
export function sectionAt(rows, page) {
  let at = -1;
  for (let i = 0; i < (rows || []).length; i++) if (rows[i].page <= page && (at < 0 || rows[i].page >= rows[at].page)) at = i;
  return at;
}

/** Page labels as PDF.js gives them (null, or one per page): kept only when one of them says something other than its own number. */
export function labels(pageLabels) {
  if (!Array.isArray(pageLabels) || !pageLabels.length) return null;
  return pageLabels.some((l, i) => String(l ?? '').trim() && String(l).trim() !== String(i + 1)) ? pageLabels.map(l => String(l ?? '')) : null;
}

/** The title of a detected table in the Contents: its caption ("Table 2. Baseline characteristics") on one line, or "Untitled table". */
export const tableTitle = caption => String(caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled table';

/**
 * Tables of a document for the Contents' Tables group: [{ title, page }] in reading order (page by page, top to bottom on a page). `detect(n)`
 * gives the tables found on page n as detectTables does ([{ caption }]); a page it fails on has none. The scan waits `pause()` between pages
 * (the viewer gives the browser a frame), stops when `live()` turns false, and calls `onFound(list)` with the list so far each time a page
 * adds to it, so the group can appear as soon as the first table is known. `max` bounds a pathological document.
 */
export async function findTables(pages, detect, { live = () => true, pause = async () => {}, onFound = () => {}, max = 400 } = {}) {
  const out = [];
  for (let n = 1; n <= pages && out.length < max; n++) {
    if (!live()) return out;
    let found = [];
    try { found = await detect(n); } catch { found = []; }
    if (!live()) return out;
    const before = out.length;
    for (const t of Array.isArray(found) ? found : []) if (out.length < max) out.push({ title: tableTitle(t?.caption), page: n });
    if (out.length > before) onFound(out.slice());
    await pause();
  }
  return out;
}

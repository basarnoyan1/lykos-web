// What an open PDF is, as the lines of the Files inspector's Details (plan PDF-OPTIONS §2 Document properties, T7): title, authors and DOI from the
// file's own metadata (or the DOI printed on page one), pages, PDF version and how much of it has text. Never a dialog. Pure: the viewer reads the
// metadata and the text with PDF.js and gives them here.

const DOI = /\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/i;
const cleanDoi = d => d.replace(/[.,;:)\]]+$/, '').replace(/\.pdf$/i, '');
const str = v => String((Array.isArray(v) ? v[0] : v) ?? '').replace(/\s+/g, ' ').trim();

/** A range of page numbers in few words: "3", "3 and 7", "2-5, 9". */
export function pageList(ns) {
  const s = [...new Set(ns || [])].filter(Number.isInteger).sort((a, b) => a - b);
  const runs = [];
  for (const n of s) { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
  const parts = runs.map(([a, b]) => (a === b ? String(a) : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`));
  return parts.length === 2 && runs.every(([a, b]) => a === b) ? parts.join(' and ') : parts.join(', ');
}

/**
 * The Details lines: `[label, value, strong?]`, a line left out when its value is unknown. `info` is PDF.js getMetadata().info, `xmp` a getter of
 * XMP keys (or null), `firstPage` page one's text, `noText` the pages with no text (null while not read). A scanned page is the one fact drawn
 * heavier: it changes what can be quoted and found.
 */
export function pdfProps({ info = {}, xmp = null, firstPage = '', pages = 0, noText = null } = {}) {
  const x = k => { try { return xmp ? xmp(k) : null; } catch { return null; } };
  const title = str(x('dc:title') ?? info.Title), authors = str(x('dc:creator') ?? info.Author);
  let doi = '';
  for (const c of [x('prism:doi'), x('dc:identifier'), info.doi, info.DOI, info.Subject, info.Keywords, firstPage].filter(Boolean).map(String)) {
    const m = c.match(DOI); if (m) { doi = cleanDoi(m[1]); break; }
  }
  const lines = [];
  if (title) lines.push(['Title', title.slice(0, 300)]);
  if (authors) lines.push(['Authors', authors.slice(0, 300)]);
  if (doi) lines.push(['DOI', doi]);
  if (pages) lines.push(['Pages', String(pages)]);
  if (info.PDFFormatVersion) lines.push(['PDF version', String(info.PDFFormatVersion)]);
  if (Array.isArray(noText) && pages) {
    const n = noText.length;
    lines.push(['Text', n ? `On ${pages - n} of ${pages} pages` : `On all ${pages} pages`]);
    if (n) lines.push(['Scanned', `${n === 1 ? 'Page' : 'Pages'} ${pageList(noText)}`, true]);
  }
  return lines;
}

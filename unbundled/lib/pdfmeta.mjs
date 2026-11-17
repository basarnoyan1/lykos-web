// What a PDF is, read from the PDF.
//
// A file named "1-s2.0-S0046817715000891-main.pdf" is a paper; the name says
// nothing about which. The paper says so itself: a DOI on its first page, or
// failing that its title, set in the largest type on the page. The bytes say
// whether two files are the same file. Identification goes in that order —
// hash, DOI, title — and the caller matches each against the library before
// asking a registry, so a paper already in the project is never created twice.
import { loadPdf } from './anchor.mjs';

const DOI = /\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/i;

export const sha256 = async bytes =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

/** Text items of a page with their font height, in reading order. */
async function items(doc, n) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  return content.items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ str: it.str, h: Math.abs(it.transform?.[3] || it.height || 0), y: it.transform?.[5] || 0 }));
}

/** A DOI's trailing punctuation is never part of it. */
const cleanDoi = d => d.replace(/[.,;:)\]]+$/, '').replace(/\.pdf$/i, '');

/**
 * The title: the run of items in the largest type on page one, joined. Journal
 * mastheads are large too, so a candidate needs at least three words and is
 * skipped if it is all capitals with no lowercase at all.
 */
function guessTitle(page1) {
  if (!page1.length) return '';
  const sizes = [...new Set(page1.map(i => Math.round(i.h * 2) / 2))].sort((a, b) => b - a);
  for (const size of sizes.slice(0, 4)) {
    const run = page1.filter(i => Math.round(i.h * 2) / 2 === size);
    const text = run.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    const words = text.split(' ').filter(Boolean);
    if (words.length < 3 || words.length > 60) continue;
    if (!/[a-z]/.test(text)) continue;
    // Download stamps and mastheads are often the largest type on a scan.
    if (/downloaded from|by guest|https?:\/\/|www\.|©|copyright|all rights reserved|\bvol(ume)?\b.*\bno\b/i.test(text)) continue;
    if (/^(original|research|review|case|article|brief|clinical)\s+(article|report|paper)$/i.test(text)) continue;
    return text.slice(0, 300);
  }
  return '';
}

/**
 * Identify a PDF: `{ hash, doi, title, pages, text }`.
 * `text` is the first two pages' text, kept so the caller can search it or
 * show it; `doi` is null when none is printed, which is common for older
 * papers and for scans with no text layer.
 */
export async function identify(bytes, { name = '' } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hash = await sha256(buf);
  let doc = null;
  try {
    ({ doc } = await loadPdf(buf));
    // 1. The file's own metadata: publishers write the DOI into XMP or the
    //    Info dictionary. Milliseconds, and exact when present.
    let doi = null, title = '', from = null;
    try {
      const md = await doc.getMetadata();
      const info = md?.info || {};
      const xmp = md?.metadata;
      const x = k => { try { return xmp?.get?.(k) ?? null; } catch { return null; } };
      const cands = [x('prism:doi'), x('pdfx:doi'), x('crossmark:doi'), x('dc:identifier'), info.doi, info.DOI, info.Subject, info.Keywords]
        .filter(Boolean).map(String);
      for (const c of cands) { const m = c.match(DOI); if (m) { doi = cleanDoi(m[1]); from = 'metadata'; break; } }
      const t = x('dc:title') ?? info.Title;
      const tt = String((Array.isArray(t) ? t[0] : t) || '').trim();
      if (plausibleTitle(tt)) title = tt.slice(0, 300);
    } catch { /* no metadata; fall through to the page */ }
    // 2. The first pages, only when the metadata did not settle it.
    // 2. The first pages: for the DOI when the metadata had none, and always
    //    for a second opinion on the title — the page's own heading is often
    //    right where the metadata is stale.
    let text = '', pageTitle = '';
    {
      const p1 = await items(doc, 1);
      const p2 = !doi && doc.numPages > 1 ? await items(doc, 2) : [];
      text = [...p1, ...p2].map(i => i.str).join(' ').replace(/\s+/g, ' ');
      if (!doi) {
        const labelled = text.match(/\b(?:doi|DOI|https?:\/\/(?:dx\.)?doi\.org\/)\s*:?\s*(10\.\d{4,9}\/[^\s"'<>)\]]+)/);
        const m = labelled?.[1] || text.match(DOI)?.[1];
        if (m) { doi = cleanDoi(m); from = 'page'; }
      }
      pageTitle = guessTitle(p1);
    }
    return { hash, doi: doi || null, from, title: title || pageTitle, titles: [...new Set([title, pageTitle].filter(Boolean))],
      pages: doc.numPages, text: text.slice(0, 6000), hint: { ...(filenameHint(name) || {}), ...(textHint(text) || {}) } };
  } catch {
    return { hash, doi: null, from: null, title: '', pages: 0, text: '', hint: filenameHint(name) };
  } finally {
    doc?.destroy?.();
  }
}

/** A title has words, not just a volume number and a date. */
function plausibleTitle(t) {
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 60) return false;
  if (!/[a-z]/.test(t)) return false;
  if (/[#]|^\s*v(ol)?\.?\s*\d|^(untitled|microsoft word|doi|manuscript)\b|\.(doc|docx|pdf|indd|qxd|tex)$/i.test(t)) return false;
  const digits = (t.match(/\d/g) || []).length;
  return digits < t.length * 0.25;
}

/**
 * What a publisher's file name says. Elsevier names files by PII
 * ("1-s2.0-S0046817715000891-main"), Wolters Kluwer by the DOI suffix
 * ("00005072-199803000-00009"), Wiley by the DOI's tail ("j.1365-2990.2005.00551.x"),
 * and many by a bare DOI. These are hints for the registry, never facts.
 */
/**
 * A scanned article often carries only the publisher's watermark as text —
 * "academic.oup.com/jnen/article/57/3/283/…" — which names the journal by
 * its slug and the volume, issue and first page. That is enough to find it.
 */
export function textHint(text) {
  const t = String(text || '').slice(0, 4000);
  let m;
  if ((m = t.match(/academic\.oup\.com\/([a-z]+)\/article(?:-abstract)?\/(\d+)\/(\d+)\/(\d+)\//i)))
    return { vip: { slug: m[1].toLowerCase(), volume: m[2], issue: m[3], page: m[4] } };
  return null;
}

export function filenameHint(name) {
  const stem = String(name || '').replace(/\.pdf$/i, '').replace(/\s*\(\d+\)$/, '').trim();
  if (!stem) return null;
  let m;
  if ((m = stem.match(/^1-s2\.0-(S\d{15,16}[A-Z0-9]?)(?:-main)?$/i))) return { pii: m[1].toUpperCase() };
  if ((m = stem.match(/(10\.\d{4,9}[_\/][^\s]+)/))) return { doi: m[1].replace('_', '/') };
  if (/^\d{8}-\d{9}-\d{5}$/.test(stem)) return { doiSuffix: stem, prefixes: ['10.1097', '10.1227'] };
  if (/^j\.\d{4}-\d{4}\.\d{4}\.\d+\.x$/i.test(stem)) return { doiSuffix: stem, prefixes: ['10.1111', '10.1046'] };
  if (/^s\d{5}-\d{3}-\d{4,5}-[\dx]$/i.test(stem)) return { doiSuffix: stem, prefixes: ['10.1007'] };
  return null;
}

/** Title similarity in [0,1]: Dice over word bigrams of normalised text. */
export function similarity(a, b) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const grams = w => { const g = new Set(); for (let i = 0; i < w.length - 1; i++) g.add(w[i] + ' ' + w[i + 1]); return g; };
  const A = grams(norm(a)), B = grams(norm(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const g of A) if (B.has(g)) n++;
  return (2 * n) / (A.size + B.size);
}

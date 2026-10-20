// The part of the record-quality check that the Overview needs on every paint (its count of records with a malformed identifier or no title):
// lib/library-quality.mjs holds the rest (the issue list, the fixes and the journal spellings), loads with the Library's checks and re-exports these.
import { titleKey } from './search-library.mjs';
import { codePoint } from './xml.mjs';

export const DOI = /^10\.\d{4,9}\/\S+$/;
// A tag is a name followed by an attribute list, "/" or ">": "<i>", "<br/>",
// '<a href="x">'. PubMed's ASCII "<or=" for ≤ and a bracketed "<IL-6>" are
// text, and a pattern that took any "<letter…>" span for a tag deleted the
// words between two comparators.
export const TAG = '<\\/?[a-z][a-z0-9]*(?:\\s[^<>]*)?\\/?>';
export const TAGS = new RegExp(TAG, 'gi');
export const paperId = (p, i) => p.id ?? p.key ?? String(i);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Entities decoded and tags removed: "Neuropathology &amp; <i>Experimental</i>" stored as text. */
export function plainText(s) {
  return String(s ?? '').replace(TAGS, '')
    .replace(/&([a-z]+);|&#x([0-9a-f]+);|&#(\d+);/gi, (m, n, hx, dc) => n ? (ENT[n.toLowerCase()] ?? m) : codePoint(parseInt(hx || dc, hx ? 16 : 10)));
}

/**
 * The records with a fault that breaks lookups and citations: no title, or a
 * DOI or PMID that is not one. The same three rules as checkRecords, without
 * the text checks, so the Overview can count them on every paint.
 */
export function brokenRecords(papers) {
  const out = [];
  (papers || []).forEach((p, i) => {
    const title = plainText(String(p.title ?? ''));
    const doi = String(p.doi ?? '').trim(), pmid = String(p.pmid ?? '').trim();
    if (!/[\p{L}\p{N}]/u.test(title) || titleKey(title) === 'untitled' || (doi && !DOI.test(doi)) || (pmid && !/^\d+$/.test(pmid))) out.push(paperId(p, i));
  });
  return out;
}


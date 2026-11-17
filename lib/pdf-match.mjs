// Which record a PDF is (F21, 9 Nov 2026), from what the file says of itself before what it is called: its DOI (the file's metadata,
// then the first pages), its PMID, its DOI's suffix in the file name
// (publisher downloads), its title, normalized (lib/record-match.mjs normTitle), the record's source link in the file name, and only then the record's label in the file
// name. Each step answers only when one record fits; when several do, the next step is tried, and if none answers the first step's
// candidates come back so the caller can say why. Used by Library's PDF import (views/library.mjs placeFile) and `lykos-papers link`.
import { normDoi, normTitle, pmidOf } from './record-match.mjs';

const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>\]]+/gi;
const PMID_IN_TEXT = /\bPMID\s*:?\s*(\d{5,9})\b/gi;
const words = s => ` ${String(s || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * @param {object[]} papers  the records a file may be
 * @param {{ doi?: string, pmid?: string, title?: string, titles?: string[], text?: string, name?: string }} facts  what the PDF gave
 * @returns {{ paper: object|null, by: 'doi'|'pmid'|'name-doi'|'title'|'name-link'|'label'|null, candidates: object[] }}
 */
export function matchPdf(papers = [], facts = {}) {
  const text = String(facts.text || '');
  const joined = text.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2');   // a title hyphenated over a line break
  const fileDoi = normDoi(facts.doi);
  const textDois = new Set((text.match(DOI_IN_TEXT) || []).map(normDoi).filter(Boolean));
  const pmids = new Set([String(facts.pmid || '').trim(), ...[...text.matchAll(PMID_IN_TEXT)].map(m => m[1])].filter(Boolean));
  const titles = [facts.title, ...(facts.titles || [])].map(normTitle).filter(t => t.length >= 12);
  // the first pages as letters and digits only: a title split or hyphenated by the PDF's layout still reads as itself
  const compact = t => normTitle(t).replace(/ /g, '');
  const body = compact(joined);
  const name = words(facts.name);
  // the file name as letters and digits, URL escapes undone: publishers name downloads by the DOI's suffix or the PDF's address
  let raw = String(facts.name || '').replace(/\.pdf$/i, '').replace(/ \(\d+\)$/, '');
  try { raw = decodeURIComponent(raw); } catch { /* left as named */ }
  const alnum = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const stem = alnum(raw);
  const named = normTitle(raw.replace(/[-_]+/g, ' '));   // "an-incidentally-detected-….pdf"
  const suffix = p => { const d = normDoi(p.doi); return d ? alnum(d.slice(d.indexOf('/') + 1)) : ''; };
  const linkStem = p => [p.url, p.pdfUrl, p.key].map(u => alnum(String(u || '').replace(/[-.]pdf$/i, '').split(/[/-]/).slice(-1)[0] || ''));

  const steps = [
    ['doi', p => { const d = normDoi(p.doi); return Boolean(d) && (fileDoi ? d === fileDoi : textDois.has(d)); }],
    ['pmid', p => { const id = pmidOf(p); return Boolean(id) && pmids.has(id); }],
    ['name-doi', p => { const x = suffix(p); return x.length >= 8 && stem.includes(x); }],
    ['title', p => { const t = normTitle(p.title); return t.length >= 12 && (titles.includes(t) || named === t); }],
    ['title', p => { const t = normTitle(p.title); return t.length >= 20 && body.includes(compact(p.title)); }],
    ['name-link', p => stem.length >= 8 && linkStem(p).includes(stem)],
    ['label', p => { const l = words(p.label); return l.trim().length >= 3 && name.includes(l); }],
  ];
  let first = null;
  for (const [by, fits] of steps) {
    let hit = papers.filter(fits);
    // a title the page holds only as part of a longer matching title ("Tumors of the third ventricle" inside "…: CT and MR
    // findings") is not the paper
    if (by === 'title' && hit.length > 1) hit = hit.filter(p => !hit.some(q => q !== p && compact(q.title).length > compact(p.title).length && compact(q.title).includes(compact(p.title))));
    if (hit.length === 1) return { paper: hit[0], by, candidates: hit };
    if (hit.length > 1 && !first) first = hit;
  }
  return { paper: null, by: null, candidates: first || [] };
}

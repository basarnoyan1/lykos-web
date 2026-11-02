// DOI markers in a Word document to Mendeley Cite citations, and back (the DOI to Mendeley page, cite/index.html).
//
// A draft cites as "(doi:10.1007/BF01404145; doi:10.2176/nmc.30.738)". Each marker becomes Mendeley Cite's own content control
// (lib/mendeley-cite.mjs), numbered in the order of first citation, with the works' CSL data from Crossref, and the typed reference
// list becomes the add-in's bibliography. Everything else in the package is kept byte for byte. Word splits text into runs at will,
// so markers are found in the paragraph's text and the runs they cover are split; a marker that crosses a link, a tracked change or
// another control is left as it is and reported. Pure, apart from fetchWork.
import { entries, read } from './unzip.mjs';
import { zip } from './zip.mjs';
import { stableUuid, mendeleyCitation, mendeleyTag, mendeleyParts, MENDELEY_STYLES } from './mendeley-cite.mjs';
import { lib_cite$formatReference as formatReference, lib_cite$inText as inText } from "../boot.mjs";
import { parseEntry, compareWork, normTitle } from './reference-list.mjs';
import { lib_bib_names$familyName as familyName } from "../boot.mjs";

// ---- markers --------------------------------------------------------------------------------------------------------------------
export const BRACKETS = { round: ['(', ')'], square: ['[', ']'], curly: ['{', '}'], none: ['', ''] };
export const PREFIXES = { any: String.raw`(?:doi:\s*|DOI:?\s*|https?://(?:dx\.)?doi\.org/)?`, doi: String.raw`(?:doi|DOI):\s*`, link: String.raw`https?://(?:dx\.)?doi\.org/`, bare: '' };
export const SEPARATORS = { any: '[;,]', semicolon: ';', comma: ',' };
export const DEFAULT_MARKER = Object.freeze({ brackets: 'round', prefix: 'any', separator: 'any' });
// A DOI runs to whitespace, a separator or a bracket; a balanced pair of brackets inside it is kept ("10.1016/S0140-6736(20)30183-5").
// U+FFFC stands for a run's picture or field, so no marker reaches over one.
const DOI_BODY = String.raw`10\.\d{4,9}/(?:[^\s;,()\[\]{}<>"￼]|\([^\s()￼]*\))+`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A work is cited by its DOI or by its PubMed id ("PMID: 12345678", whatever the DOI prefix setting): an id is a DOI or "pmid:12345678".
const PMID_BODY = String.raw`PMID:?\s*(\d{1,9})(?![\d/])`;
// capture: the DOI in group 1, the PubMed id in group 2; without, the same token for the marker's own pattern
const doiToken = (m, capture = true) => {
  const g = capture ? '(' : '(?:';
  return `(?:${PREFIXES[m.prefix] ?? PREFIXES.any}${g}${DOI_BODY})|${capture ? PMID_BODY : PMID_BODY.replace('(\\d', '(?:\\d')})`;
};
const idOf = x => (x[1] ? cleanDoi(x[1]) : `pmid:${x[2]}`);
/** A PubMed id ("pmid:12345678") rather than a DOI. */
export const isPmid = id => /^pmid:\d+$/i.test(String(id || ''));
/** The marker as a RegExp: an opening bracket, DOIs or PubMed ids between separators, a closing bracket. */
export function markerRegExp(marker = DEFAULT_MARKER) {
  const m = { ...DEFAULT_MARKER, ...marker }, [o, c] = BRACKETS[m.brackets] || BRACKETS.round, sep = SEPARATORS[m.separator] || SEPARATORS.any;
  const tok = doiToken(m, false);
  return new RegExp(`${esc(o)}[ \\u00a0]*${tok}(?:[ \\u00a0]*${sep}[ \\u00a0]*${tok})*[ \\u00a0]*${esc(c)}`, 'gi');
}
export const cleanDoi = d => String(d || '').trim().replace(/[.,;:]+$/, '');
/** A DOI as a key: DOIs ignore case. */
export const doiKey = d => cleanDoi(d).toLowerCase();
/** Markers in a text: `[{ start, end, dois }]` (`dois` are ids: DOIs and "pmid:N"). Without brackets a DOI's closing full stop is the sentence's. */
export function findMarkers(text, marker = DEFAULT_MARKER) {
  const out = [], inner = new RegExp(doiToken({ ...DEFAULT_MARKER, ...marker, prefix: 'any' }), 'gi');
  for (const m of String(text).matchAll(markerRegExp(marker))) {
    let s = m[0];
    if ((marker.brackets || DEFAULT_MARKER.brackets) === 'none') s = s.replace(/[.,;:]+$/, '');
    const dois = [...s.matchAll(inner)].map(idOf);
    if (dois.length) out.push({ start: m.index, end: m.index + s.length, dois });
  }
  return out;
}
const ANY_DOI = new RegExp(`(?:doi:\\s*|https?://(?:dx\\.)?doi\\.org/)?(${DOI_BODY})`, 'gi');
const doisIn = text => [...String(text).matchAll(ANY_DOI)].map(m => cleanDoi(m[1]));

// ---- citation styles ------------------------------------------------------------------------------------------------------------
// How each style shows a citation before Mendeley Cite refreshes it: numbers in the order of first citation (sorted in a citation,
// three or more in a row as a range) or author and year. `bib` is lib/cite.mjs's formatter for the reference list.
export const STYLES = {
  ama: { label: 'AMA 11th', sup: true, delim: ',', bib: 'ama' },
  vancouver: { label: 'Vancouver', open: '(', close: ')', delim: ',', bib: 'vancouver' },
  'vancouver-superscript': { label: 'Vancouver (superscript)', sup: true, delim: ',', bib: 'vancouver' },
  apa: { label: 'APA 7th', authorDate: true, bib: 'apa' },
  harvard: { label: 'Harvard (Cite Them Right)', authorDate: true, bib: 'harvard' },
};
export const styleOf = id => (id && typeof id === 'object' ? id : STYLES[id] || STYLES.ama);
/**
 * A journal's own style from the style catalog (assets/journals/zotero-catalog.json: `{ id, label, format }`): Mendeley Cite gets its CSL
 * id and applies its exact rules when it refreshes; until then the document shows `numbers` (superscript, [1] or (1)) for a numbered
 * style, author and year for an author-date one. A footnote style shows superscript numbers, as its note marks are.
 */
export function journalStyle(j, numbers = 'sup') {
  const mendeley = { id: `https://www.zotero.org/styles/${j.id}`, title: j.label, format: j.format === 'author-date' ? 'author-date' : 'numeric' };
  if (j.format === 'author-date' || j.format === 'author' || j.format === 'label') return { label: j.label, authorDate: true, bib: 'apa', mendeley };
  if (numbers === 'brackets') return { label: j.label, open: '[', close: ']', delim: ',', bib: 'vancouver', mendeley };
  if (numbers === 'parens') return { label: j.label, open: '(', close: ')', delim: ',', bib: 'vancouver', mendeley };
  return { label: j.label, sup: true, delim: ',', bib: 'ama', mendeley };
}
/** "1,3–5" from [5, 1, 4, 3]. */
export function numberText(nums, delim = ',') {
  const s = [...new Set(nums)].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < s.length;) {
    let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    if (j - i >= 2) parts.push(`${s[i]}–${s[j]}`); else for (let k = i; k <= j; k++) parts.push(String(s[k]));
    i = j + 1;
  }
  return parts.join(delim);
}
/** What a citation shows in a style: `nums` its works' numbers, `records` its works. */
export function citationText(style, nums, records) {
  const st = styleOf(style);
  if (st.authorDate) {
    const parts = records.map(r => (r?.title ? inText(r, st.bib) : r?.doi ? `doi:${r.doi}` : r?.pmid ? `PMID ${r.pmid}` : '?')).sort((a, b) => a.localeCompare(b));
    return `(${parts.join('; ')})`;
  }
  return `${st.open || ''}${numberText(nums, st.delim)}${st.close || ''}`;
}
/** One reference list line. */
export function referenceText(style, n, record) {
  const st = styleOf(style), r = { ...record, journal: String((st.bib === 'ama' || st.bib === 'vancouver' ? record.journalAbbr || record.journal : record.journal) || '').replace(/\.$/, '') };
  const body = record.title ? formatReference(r, st.bib) : record.doi ? `doi:${record.doi}` : `PMID ${record.pmid}`;
  return st.authorDate ? body : `${n}. ${body}`;
}

// ---- works ----------------------------------------------------------------------------------------------------------------------
const CSL_TYPE = { 'journal-article': 'article-journal', 'book-chapter': 'chapter', 'proceedings-article': 'paper-conference', 'posted-content': 'article', 'reference-entry': 'entry', 'dissertation': 'thesis', 'monograph': 'book', 'edited-book': 'book' };
const KEEP = ['type', 'title', 'author', 'editor', 'container-title', 'container-title-short', 'DOI', 'URL', 'ISSN', 'issued', 'page', 'volume', 'issue', 'publisher', 'PMID'];
const plain = s => String(Array.isArray(s) ? s[0] ?? '' : s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// names as Mendeley keeps them (its own saves carry the three flags)
const people = list => (list || []).map(a => (a.family ? { family: plain(a.family), given: plain(a.given), 'parse-names': false, 'dropping-particle': '', 'non-dropping-particle': '' } : a.name || a.literal ? { literal: plain(a.name || a.literal) } : null)).filter(Boolean);
/** Crossref's work, or a CSL item from doi.org, as Mendeley's item data (no reference lists, licences or links). */
export function cslOf(w, doi) {
  const it = { type: CSL_TYPE[w.type] || (/^[a-z-]+$/.test(w.type || '') && !/^journal/.test(w.type) ? w.type : 'article-journal') };
  it.id = stableUuid(doiKey(w.DOI || doi));
  for (const k of KEEP.slice(1)) {
    const v = w[k];
    if (k === 'author' || k === 'editor') { const p = people(v); if (p.length) it[k] = p; }
    // the issue's year, as a journal prints it, before Crossref's earliest date (the online one)
    else if (k === 'issued') { const d = [w['published-print'], v, w['published-online']].map(x => x?.['date-parts']?.[0]).find(x => x?.[0]); if (d) it.issued = { 'date-parts': [d.filter(x => x != null)] }; }
    else if (k === 'ISSN') { const s = plain(v); if (s) it.ISSN = s; }
    else if (v != null && plain(v)) it[k] = plain(v);
  }
  if (!it['container-title-short'] && plain(w['short-container-title'])) it['container-title-short'] = plain(w['short-container-title']);
  it.DOI = doiKey(it.DOI || doi) === doiKey(doi) ? cleanDoi(doi) : cleanDoi(it.DOI || doi);   // as the document writes it
  it.URL = `https://doi.org/${it.DOI}`;
  return it;
}
/** A CSL item as a Lykos record (lib/cite.mjs formats it, lib/bib-export.mjs writes it). */
export function recordOf(csl) {
  return {
    title: csl.title || '', authors: (csl.author || []).map(a => a.literal || [a.family, a.given].filter(Boolean).join(', ')),
    journal: csl['container-title'] || '', journalAbbr: csl['container-title-short'] || '', year: String(csl.issued?.['date-parts']?.[0]?.[0] || ''),
    volume: csl.volume || '', issue: csl.issue || '', pages: csl.page || '', doi: csl.DOI || '', pmid: csl.PMID || '', url: csl.URL || '',
  };
}
/**
 * A typed list entry ("12. doi:10.x — Author A. Title. …") as a CSL item, for a DOI the registries do not answer. A Vancouver or AMA entry
 * is read directly (authors up to the first full stop after initials, so "van Hille PT" stays an author); any other through parseEntry.
 */
export function cslFromEntry(text, doi) {
  const lead = String(text).replace(/^\s*\d{1,3}[.)]\s*/, '').replace(new RegExp(`^(?:doi:\\s*)?${DOI_BODY}\\s*[—–-]\\s*`, 'i'), '');
  const it = { type: 'article-journal', id: stableUuid(doiKey(doi)) };
  const v = /^(.*?\b[A-Z]{1,3}(?:,? et al(?:;[^.]+)?)?)\.\s+(.+?[?!.])\s+([^;]+?)\.?\s+(\d{4})[^;]*;\s*([^(:\s]+)?(?:\(([^)]+)\))?(?::\s*([^\s.]+))?/.exec(lead);
  if (v) {
    it.title = v[2].replace(/\.$/, '');
    // "Kirollos RW" -> Kirollos, R. W. (dotted, so the formatter keeps both initials); a group after "et al;" is an author too
    it.author = v[1].split(/,\s*|;\s*/).map(n => n.trim()).filter(n => n && !/^et al\.?$/i.test(n)).map(n => { const m = /^(.*)\s+([A-Z]{1,3})$/.exec(n); return m ? { family: m[1], given: m[2].split('').join('. ') + '.' } : { literal: n }; });
    it['container-title'] = v[3].replace(/\.?\s*(?:published online|epub)\b.*$/i, '').replace(/^.*\.\s+(?=[A-Z])/, '');
    it.issued = { 'date-parts': [[Number(v[4])]] };
    for (const [k, x] of [['volume', v[5]], ['issue', v[6]], ['page', v[7]]]) if (x) it[k] = x;
  } else {
    const e = parseEntry(lead);
    Object.assign(it, { title: e.title, author: e.authors.map(a => { const f = familyName(a); return { family: f, given: a.slice(f.length).replace(/^[,\s]+/, '') }; }) });
    const journal = e.journal.replace(/\.?\s*(?:published online|epub)\b.*$/i, '');
    if (journal) it['container-title'] = journal;
    const year = e.year || /\b(19|20)\d{2}\b/.exec(lead.slice(lead.search(/published online|epub/i) + 1))?.[0];
    if (year) it.issued = { 'date-parts': [[Number(year)]] };
    for (const [k, x] of [['volume', e.volume], ['issue', e.issue], ['page', e.pages]]) if (x) it[k] = x;
  }
  return withId(it, doi);
}
// an item's identifier fields from the id it is cited by
const withId = (it, id) => (isPmid(id) ? Object.assign(it, { PMID: id.slice(5), URL: `https://pubmed.ncbi.nlm.nih.gov/${id.slice(5)}/` }) : Object.assign(it, { DOI: cleanDoi(id), URL: `https://doi.org/${cleanDoi(id)}` }));
/**
 * One DOI's work: `{ csl, source }` from Crossref, else from doi.org (DataCite and the other agencies), else null. `fetchImpl` is
 * the page's fetch; both services answer a browser directly.
 */
export async function fetchWork(doi, { fetchImpl = fetch, signal, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (isPmid(doi)) return pubmedWork(doi.slice(5), { fetchImpl, signal, wait });
  const d = cleanDoi(doi);
  // Crossref answers 429 when asked too fast and now and then 5xx: three tries, as long apart as it asks
  for (let attempt = 1; attempt <= 3; attempt++) {
    let r;
    try { r = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(d)}`, { signal }); } catch (e) { if (e?.name === 'AbortError') throw e; await wait(500 * attempt); continue; }
    if (r.ok) { const j = await r.json(); return { csl: cslOf(j.message || {}, d), source: 'Crossref', notices: noticesOf(j.message || {}), meta: metaOf(j.message || {}) }; }
    if (r.status !== 429 && r.status < 500) break;
    await wait(Math.min(5000, Number(r.headers?.get?.('retry-after')) * 1000 || 800 * attempt));
  }
  try {
    const r = await fetchImpl(`https://doi.org/${d}`, { signal, headers: { Accept: 'application/vnd.citationstyles.csl+json' } });
    if (r.ok) return { csl: cslOf(await r.json(), d), source: 'doi.org' };
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  return null;
}
/**
 * A work cited by its PubMed id: PubMed's summary gives its DOI, and the DOI's registry record is the work (with the id kept as PMID); a
 * work without a DOI, or one the registries do not answer, is PubMed's summary itself.
 */
async function pubmedWork(pmid, { fetchImpl, signal, wait }) {
  let sum = null;
  for (let attempt = 1; attempt <= 3 && !sum; attempt++) {
    let r;
    try { r = await fetchImpl(`${EUTILS}esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`, { signal }); } catch (e) { if (e?.name === 'AbortError') throw e; await wait(500 * attempt); continue; }
    if (r.ok) { sum = (await r.json())?.result?.[pmid] || null; break; }
    if (r.status !== 429 && r.status < 500) break;
    await wait(800 * attempt);
  }
  if (!sum || sum.error) return null;
  const doi = (sum.articleids || []).find(a => a.idtype === 'doi')?.value;
  const w = doi ? await fetchWork(doi, { fetchImpl, signal, wait }) : null;
  if (w) { w.csl.PMID = pmid; return w; }
  return { csl: cslFromPubmed(sum, pmid, doi), source: 'PubMed' };
}
/** PubMed's summary of a work as a CSL item: "Brockmann MA" as Brockmann, M. A., the journal's name and NLM abbreviation, the print year. */
export function cslFromPubmed(sum, pmid, doi) {
  const it = { type: 'article-journal', id: stableUuid(doi ? doiKey(doi) : `pmid:${pmid}`), title: plain(sum.title).replace(/\.$/, '') };
  const names = (sum.authors || []).filter(a => !a.authtype || a.authtype === 'Author').map(a => { const m = /^(.*\S)\s+([A-Z]{1,4})$/.exec(a.name || ''); return m ? { family: m[1], given: m[2].split('').join('. ') + '.' } : { literal: a.name }; });
  if (names.length) it.author = names;
  if (sum.fulljournalname) it['container-title'] = plain(sum.fulljournalname);
  if (sum.source) it['container-title-short'] = plain(sum.source);
  const year = /\b(1[89]|20)\d{2}\b/.exec(sum.pubdate || sum.epubdate || '')?.[0];
  if (year) it.issued = { 'date-parts': [[Number(year)]] };
  for (const [k, v] of [['volume', sum.volume], ['issue', sum.issue], ['page', sum.pages]]) if (v) it[k] = String(v);
  it.PMID = String(pmid);
  if (doi) { it.DOI = cleanDoi(doi); it.URL = `https://doi.org/${it.DOI}`; } else it.URL = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return it;
}
const unJats = t => String(t || '').replace(/<jats:title>[^<]*<\/jats:title>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const dateParts = x => x?.['date-parts']?.[0]?.filter(v => v != null) || null;
/**
 * What Crossref says about a work beyond what a citation carries, kept beside the work and never written into the file: its type, the
 * abstract the publisher deposited, publisher and ISSNs, the print and online dates, how often it is cited (Crossref's count) and how many
 * references it has, its licence and its full text's address, and its subjects.
 */
// A web address from Crossref, or '' (a link the page opens: no javascript: or data: address).
const webUrl = u => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

export function metaOf(m) {
  const lic = (m.license || []).find(l => l['content-version'] === 'vor') || (m.license || [])[0];
  const page = (m.link || []).find(l => l['content-type'] === 'text/html') || (m.link || []).find(l => l['content-type'] !== 'unspecified') || (m.link || [])[0];
  return { type: m.type || '', abstract: unJats(m.abstract), publisher: m.publisher || '', issn: m.ISSN || [], print: dateParts(m['published-print']), online: dateParts(m['published-online']),
    citedBy: m['is-referenced-by-count'] ?? null, references: m['reference-count'] || m['references-count'] || 0, license: webUrl(lic?.URL), fulltext: webUrl(page?.URL) || webUrl(m.resource?.primary?.URL), subjects: m.subject || [] };
}
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const unXml = t => String(t || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(x?)([0-9a-f]+);/gi, (m, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/**
 * PubMed's record of a DOI, when it has exactly one: `{ pmid, pmcid, types, mesh, abstract: [{ label, text }] }` (types without the plain
 * 'Journal Article'; the abstract's parts with their labels, as a structured abstract has them). Two requests to NCBI's E-utilities.
 */
export async function pubmedOf(doi, { fetchImpl = fetch, signal } = {}) {
  // a work cited by its PubMed id needs no search
  const found = isPmid(doi) ? null : await (await fetchImpl(`${EUTILS}esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(cleanDoi(doi))}%5Bdoi%5D`, { signal })).json();
  const pmid = isPmid(doi) ? doi.slice(5) : found?.esearchresult?.count === '1' ? found.esearchresult.idlist?.[0] : null;
  if (!pmid) return { pmid: '' };
  const x = await (await fetchImpl(`${EUTILS}efetch.fcgi?db=pubmed&retmode=xml&id=${pmid}`, { signal })).text();
  return {
    pmid, pmcid: /<ArticleId IdType="pmc">([^<]+)</.exec(x)?.[1] || '',
    types: [...x.matchAll(/<PublicationType[^>]*>([^<]+)</g)].map(m => unXml(m[1])).filter(t => t !== 'Journal Article'),
    mesh: [...x.matchAll(/<DescriptorName[^>]*>([^<]+)</g)].map(m => unXml(m[1])),
    abstract: [...x.matchAll(/<AbstractText(?:[^>]*\sLabel="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m => ({ label: m[1] ? m[1].charAt(0) + m[1].slice(1).toLowerCase() : '', text: unXml(m[2]) })),
  };
}
const NOTICE = /^(retraction|partial_retraction|withdrawal|removal|expression_of_concern|correction|erratum|corrigendum)$/;
/**
 * What Crossref says happened to a work since (its `updated-by`, Retraction Watch's data among it): `[{ type, label, doi, year }]`,
 * retractions first. A retracted or withdrawn work cited as evidence is the error a reviewer finds first.
 */
export function noticesOf(m) {
  const rank = t => (/retraction|withdrawal|removal/.test(t) ? 0 : t === 'expression_of_concern' ? 1 : 2);
  return (m['updated-by'] || []).filter(u => NOTICE.test(u.type || '')).map(u => ({ type: u.type, label: u.label || u.type.replace(/_/g, ' '), doi: u.DOI || '', year: u.updated?.['date-parts']?.[0]?.[0] || '' }))
    .sort((a, b) => rank(a.type) - rank(b.type));
}
export const isRetracted = notices => (notices || []).some(n => /retraction|withdrawal|removal/.test(n.type) && n.type !== 'partial_retraction');
/** The typed list against the citations: entries never cited, and cited DOIs the list does not hold. Empty without a typed list. */
export function listChecks(scan, works = new Map()) {
  if (!scan?.refList) return { notCited: [], notListed: [] };
  // a work is listed under the id it is cited by, or under its other id (a PubMed id's DOI, a DOI's PubMed id) once its record is known
  const ids = d => { const c = works.get(doiKey(d)); return [doiKey(d), c?.DOI && doiKey(c.DOI), c?.PMID && `pmid:${c.PMID}`].filter(Boolean); };
  const cited = new Set(scan.dois.flatMap(ids)), byText = new Map();
  for (const [k, text] of scan.refList.entries) byText.set(text, [...(byText.get(text) || []), k]);   // an entry with a DOI and a PMID is one entry
  return { notCited: [...byText].filter(([, ks]) => !ks.some(k => cited.has(k))).map(([text, ks]) => ({ doi: ks[0], text })), notListed: scan.dois.filter(d => !ids(d).some(k => scan.refList.entries.has(k))) };
}
/** The typed list entry of a work: under the id it is cited by, or its other id. */
export function entryFor(scan, id, csl) {
  const e = scan?.refList?.entries;
  return e ? e.get(doiKey(id)) || (csl?.DOI && e.get(doiKey(csl.DOI))) || (csl?.PMID && e.get(`pmid:${csl.PMID}`)) || '' : '';
}

// NLM's journal abbreviations (assets/journals/nlm-journals.json: [title, abbreviation, iso?]) by title: Crossref's short titles are often
// odd ("SPI" for J Neurosurg Spine) or missing. Titles are compared without case, punctuation or a leading "The".
const titleKey = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();
/** A Map from a journal's title key to its NLM abbreviation. */
export function nlmIndex(rows) {
  const out = new Map();
  // a title also by its name before " : " and without what it gives in brackets ("Cerebellum (London, England)" is The Cerebellum)
  const bare = t => String(t || '').replace(/\s*\([^)]*\)/g, ' ');
  for (const [title, abbr] of rows || []) if (abbr) for (const k of [titleKey(title), titleKey(String(title).split(' : ')[0]), titleKey(bare(title))]) if (k && !out.has(k)) out.set(k, abbr);
  return out;
}
/** The NLM abbreviation of a journal title, or ''. */
export const nlmAbbr = (index, title) => index?.get(titleKey(title)) || index?.get(titleKey(String(title || '').replace(/\s*\([^)]*\)/g, ' '))) || '';

/** Several DOIs, `limit` at a time; `onWork(doi, work)` hears each answer. Answers a Map doi -> work or null. */
export async function fetchWorks(dois, { limit = 2, onWork, ...opts } = {}) {
  const out = new Map(), queue = [...dois];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) { const d = queue.shift(); const w = await fetchWork(d, opts); out.set(d, w); onWork?.(d, w); }
  }));
  return out;
}
/**
 * The DOI a typed list entry most likely means, for a DOI no registry knows or one whose record is another work: Crossref's bibliographic
 * search on the entry's words, and the first answer the entry agrees with (the checks below find no wrong title, author or year in it).
 * Answers `{ doi, csl }` or null. One request.
 */
export async function suggestDoi(entry, { fetchImpl = fetch, signal, not = '' } = {}) {
  const words = String(entry || '').replace(/^\s*\d{1,3}[.)]\s*/, '').replace(new RegExp(`(?:doi:\\s*)?${DOI_BODY}`, 'gi'), ' ').replace(/PMID:?\s*\d+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (words.length < 20) return null;
  const select = 'DOI,title,author,issued,published-print,published-online,container-title,short-container-title,volume,issue,page,type';
  let found;
  try {
    const r = await fetchImpl(`https://api.crossref.org/works?rows=5&select=${select}&query.bibliographic=${encodeURIComponent(words.slice(0, 400))}`, { signal });
    if (!r.ok) return null;
    found = (await r.json())?.message?.items || [];
  } catch (e) { if (e?.name === 'AbortError') throw e; return null; }
  for (const item of found) {
    if (!item.DOI || doiKey(item.DOI) === doiKey(not)) continue;
    const csl = cslOf(item, item.DOI);
    if (csl.title && !checkEntry(entry, csl).some(i => i.severity !== 'note')) return { doi: cleanDoi(item.DOI), csl };
  }
  return null;
}
// a correction notice's own title ("Correction to: …", "Erratum") cited in place of the article it corrects
const NOTICE_TITLE = /^(?:correction|erratum|corrigendum|retraction(?: note)?)\b(?:\s*(?:to|:)\b)?/i;
export const isNoticeTitle = t => NOTICE_TITLE.test(String(t || '').trim());
/**
 * Works cited under two ids that are one work: `[{ keys: [a, b], keep, same }]` in the order of first citation. `same` is true when both
 * resolve to one DOI (a PubMed id and the DOI of its article): numbered once without asking. Otherwise the titles and first authors agree
 * (a preprint and its article, or two DOIs for one paper) and `keep` is the published one, else the first cited.
 */
export function duplicateWorks(ids, works) {
  const out = [], firstAuthor = c => normTitle((c.author || [])[0]?.family || (c.author || [])[0]?.literal || '');
  const keys = [...new Set(ids.map(doiKey))].filter(k => works.get(k));
  // each work's title and first author once, not once per pair
  const t = new Map(keys.map(k => [k, normTitle(works.get(k).title || '')])), fa = new Map(keys.map(k => [k, firstAuthor(works.get(k))]));
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = works.get(keys[i]), b = works.get(keys[j]);
    const same = !!a.DOI && !!b.DOI && doiKey(a.DOI) === doiKey(b.DOI);
    const alike = !same && t.get(keys[i]).length > 20 && t.get(keys[i]) === t.get(keys[j]) && fa.get(keys[i]) === fa.get(keys[j]) && !isNoticeTitle(a.title);
    if (!same && !alike) continue;
    const preprint = c => c.type === 'article' || c.type === 'posted-content';
    const keep = same || preprint(a) === preprint(b) ? keys[i] : preprint(a) ? keys[j] : keys[i];
    out.push({ keys: [keys[i], keys[j]], keep, same });
  }
  return out;
}
const entryOf = text => parseEntry(String(text).replace(/^\s*\d{1,3}[.)]\s*/, '').replace(new RegExp(`^(?:doi:\\s*)?${DOI_BODY}\\s*[—–-]\\s*`, 'i'), ''));
const pageEnd = p => { const [a, b = ''] = String(p || '').split(/\s*[-–]\s*/); return b && b.length < a.length ? a.slice(0, a.length - b.length) + b : b; };
/**
 * What the registry says against the typed list entry: lib/reference-list.mjs's checks (wrong DOI, author, year, volume, first page),
 * and the number of authors and the last page. An entry whose words hold the registry's title is not a wrong DOI, whatever the parser
 * made of its authors.
 */
export function checkEntry(text, csl) {
  if (!csl) return [];
  if (isNoticeTitle(csl.title) && !isNoticeTitle(entryOf(text || '').title)) return [{ kind: 'ref-notice', severity: 'warn', field: 'record', entry: text ? 'the article' : '', registry: 'a correction notice', text: 'A correction notice, not the article' }];
  if (!text) return [];
  const e = entryOf(text), r = recordOf(csl), fams = (csl.author || []).map(a => a.family || a.literal || '');
  const head = normTitle(r.title).split(' ').slice(0, 6).join(' ');
  if (head && normTitle(text).includes(head)) e.title = r.title;
  const out = compareWork(e, { title: r.title, families: fams, year: r.year, volume: r.volume, pages: r.pages });
  // the authors as typed: the names before the first full stop of a Vancouver or AMA entry
  const lead = String(text).replace(/^\s*\d{1,3}[.)]\s*/, '').replace(new RegExp(`^(?:doi:\\s*)?${DOI_BODY}\\s*[—–-]\\s*`, 'i'), '');
  const listed = e.form === 'vancouver' ? lead.slice(0, lead.search(/\.\s/)).split(/,\s*/).filter(n => n.trim() && !/^et al/i.test(n.trim())).length : 0;
  const etAl = /\bet al\b/i.test(text);
  if (listed && fams.length && !etAl && listed !== fams.length) out.push({ kind: 'ref-authors', severity: 'warn', field: 'authors', entry: String(listed), registry: String(fams.length) });
  if (e.year && r.year && e.year !== r.year && !out.some(o => o.field === 'year')) out.push({ kind: 'ref-year', severity: 'note', field: 'year', entry: e.year, registry: r.year });
  if (pageEnd(e.pages) && pageEnd(r.pages) && pageEnd(e.pages) !== pageEnd(r.pages)) out.push({ kind: 'ref-details', severity: 'note', field: 'last page', entry: e.pages, registry: r.pages });
  for (const [field, a, b] of [['volume', e.volume, r.volume], ['issue', e.issue, r.issue], ['pages', e.pages, r.pages]]) if (a && !b) out.push({ kind: 'ref-missing', severity: 'note', field, entry: a, registry: '' });
  return out;
}
/**
 * The typed list entry's journal abbreviation (the registry's is often missing or odd, "SPI"), and the volume, issue and pages the
 * registry lacks. Answers the item and the fields taken.
 */
export function fillFromEntry(csl, text) {
  if (!csl || !text) return { csl, filled: [] };
  const e = entryOf(text), out = { ...csl }, filled = [];
  // the journal as the list abbreviates it: the last sentence before the year, with no "Published online" or date in it
  const abbr = e.journal.replace(/\.?\s*(?:published online|epub)\b.*$/i, '').split(/\.\s+/).pop().replace(/\.$/, '').trim();
  if (abbr && !/\d/.test(abbr) && abbr.split(/\s+/).length <= 8 && abbr !== out['container-title-short']) { out['container-title-short'] = abbr; filled.push('journal'); }
  for (const [k, v] of [['volume', e.volume], ['issue', e.issue], ['page', e.pages]]) if (v && !out[k]) { out[k] = v; filled.push(k === 'page' ? 'pages' : k); }
  return { csl: out, filled };
}

/**
 * A registry record whose text was damaged on its way in ("K\uFFFDnig" for "König"): each damaged word is taken from the typed list
 * entry where the entry has it. Answers the item, repaired, and the words it repaired.
 */
export function repairCsl(csl, entryText) {
  const fixed = [];
  if (!csl || !entryText || !JSON.stringify(csl).includes('\uFFFD')) return { csl, fixed };
  const fix = s => String(s).replace(/[^\s,.;:()]*\uFFFD[^\s,.;:()]*/g, w => {
    const re = new RegExp(`(?<![\\p{L}])${w.split('\uFFFD').map(esc).join('\\p{L}{1,2}')}(?![\\p{L}])`, 'u'), m = re.exec(entryText);
    if (m) fixed.push(m[0]);
    return m ? m[0] : w;
  });
  const out = { ...csl };
  for (const k of ['title', 'container-title', 'container-title-short', 'publisher']) if (out[k]?.includes('\uFFFD')) out[k] = fix(out[k]);
  for (const k of ['author', 'editor']) if (out[k]) out[k] = out[k].map(a => Object.fromEntries(Object.entries(a).map(([f, v]) => [f, typeof v === 'string' && v.includes('\uFFFD') ? fix(v) : v])));
  return { csl: out, fixed };
}

// ---- the package ----------------------------------------------------------------------------------------------------------------
/** A .docx as `{ files: [{ name, data }], text(name) }`. */
export async function openDocx(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const list = entries(buf).filter(e => !e.name.endsWith('/'));
  const files = [];
  for (const e of list) files.push({ name: e.name, data: await read(buf, e) });
  if (!files.some(f => f.name === 'word/document.xml')) throw new Error('This file has no Word document inside');
  const dec = new TextDecoder();
  return { files, text: name => { const f = files.find(x => x.name === name); return f ? (typeof f.data === 'string' ? f.data : dec.decode(f.data)) : null; } };
}

// ---- paragraphs and runs --------------------------------------------------------------------------------------------------------
const unxml = s => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (m, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e.toLowerCase()] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The outermost paragraphs of a part: `[{ start, end, inner, nested }]` (`nested`: it holds a text box's paragraphs). */
export function paragraphs(doc) {
  const out = [], re = /<(\/?)w:p(?=[\s>/])([^>]*?)(\/?)>/g;
  let depth = 0, open = null, nested = false;
  for (let m; (m = re.exec(doc));) {
    if (m[3]) { if (!depth) out.push({ start: m.index, end: re.lastIndex, open: m[0], inner: '', nested: false }); continue; }
    if (!m[1]) { if (!depth) { open = m; nested = false; } else nested = true; depth++; continue; }
    if (--depth === 0 && open) { const head = open.index + open[0].length; out.push({ start: open.index, end: re.lastIndex, open: open[0], inner: doc.slice(head, m.index), nested }); open = null; }
    if (depth < 0) depth = 0;
  }
  return out;
}
const HARMLESS = /^<w:(proofErr|bookmarkStart|bookmarkEnd|permStart|permEnd|commentRangeStart|commentRangeEnd)\b/;
/**
 * A paragraph's inner XML as tokens and its text. A run is `{ run: true, xml, attrs, rPr, text, plain, s, e }`, `plain` when it holds only
 * text, tabs and breaks (so it can be split); a picture or a field counts as one U+FFFC. Other tags are `{ tag, xml }`. `tag` of a
 * Mendeley citation's opening carries its data.
 */
export function tokens(inner) {
  const out = [], re = /<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>|<[^>]+>|[^<]+/g;
  let text = '', inDel = 0;
  for (const m of inner.matchAll(re)) {
    const x = m[0];
    if (/^<w:r\b/.test(x)) {
      const head = /^<w:r\b([^>]*?)\/?>/.exec(x), body = x.endsWith('/>') && !x.includes('</w:r>') ? '' : x.slice(head[0].length, -6);
      const rPr = /^\s*<w:rPr>[\s\S]*?<\/w:rPr>|^\s*<w:rPr\/>/.exec(body)?.[0] || '';
      let t = '', plainRun = true;
      for (const c of body.slice(rPr.length).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\s*\/>|<w:(tab|cr|lastRenderedPageBreak|softHyphen)\s*\/>|<w:br(\s[^>]*)?\/>|<[^>]+>/g)) {
        if (c[1] != null) t += unxml(c[1]);
        else if (/^<w:t\b/.test(c[0])) continue;
        else if (c[2] === 'tab') t += '\t';
        else if (c[2] === 'cr') t += '\n';
        else if (c[2]) continue;
        else if (/^<w:br\b/.test(c[0])) { if (/w:type="(page|column)"/.test(c[3] || '')) { t += '￼'; plainRun = false; } else t += '\n'; }
        else if (/^<\//.test(c[0])) continue;
        else { t += '￼'; plainRun = false; }
      }
      if (inDel) { t = ''; plainRun = false; }
      out.push({ run: true, xml: x, attrs: head[1].replace(/\/$/, ''), rPr: rPr.trim(), text: t, plain: plainRun, s: text.length, e: text.length + t.length });
      text += t;
    } else if (x.startsWith('<')) {
      if (/^<w:del\b(?![^>]*\/>)/.test(x)) inDel++; else if (/^<\/w:del>/.test(x)) inDel = Math.max(0, inDel - 1);
      out.push({ tag: x });
    } else out.push({ tag: x });
  }
  return { list: out, text };
}
const SUP_AFTER = /<w:(rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)\b/;
/** A run's properties with its vertical alignment set (schema order: before rtl, cs, em, lang …). */
export function withVertAlign(rPr, align) {
  let p = (rPr || '').replace(/<w:vertAlign\b[^>]*\/>/g, '').replace(/^<w:rPr\/>$/, '<w:rPr></w:rPr>');
  if (!align) return p === '<w:rPr></w:rPr>' ? '' : p;
  if (!p) p = '<w:rPr></w:rPr>';
  const v = `<w:vertAlign w:val="${align}"/>`, at = p.search(SUP_AFTER);
  return at >= 0 ? p.slice(0, at) + v + p.slice(at) : p.replace('</w:rPr>', `${v}</w:rPr>`);
}
const runOf = (attrs, rPr, text) => {
  if (!text) return '';
  const body = text.split(/(\t|\n)/).filter(Boolean).map(x => (x === '\t' ? '<w:tab/>' : x === '\n' ? '<w:br/>' : `<w:t xml:space="preserve">${xml(x)}</w:t>`)).join('');
  return `<w:r${attrs || ''}>${rPr || ''}${body}</w:r>`;
};
// a content control as Word and Mendeley Cite save one: the run's properties, the tag, an id (a signed 32-bit number, here from the tag)
const sdtId = tag => { let h = 0x811c9dc5; for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193); return h | 0; };
const sdt = (tag, inner, rPr = '') => `<w:sdt><w:sdtPr>${rPr}<w:tag w:val="${xml(tag)}"/><w:id w:val="${sdtId(tag)}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

/**
 * Applies replacements to a paragraph: `reps` are `{ start, end, before, xml }` in the paragraph's text, sorted, each over plain runs
 * of one container. Runs no replacement touches keep their XML.
 */
function rewrite(list, reps) {
  let out = '';
  for (const tok of list) {
    if (!tok.run) { out += tok.tag; continue; }
    const hit = reps.filter(r => r.start < tok.e && r.end > tok.s);
    // a run a replacement covers is dropped with it; an empty one inside a replacement too
    if (!hit.length) { if (!(tok.s === tok.e && reps.some(r => tok.s > r.start && tok.s < r.end))) out += tok.xml; continue; }
    let at = tok.s;
    for (const r of hit) {
      if (r.start > at) out += runOf(tok.attrs, tok.rPr, tok.text.slice(at - tok.s, r.start - tok.s));
      if (r.start >= tok.s) out += runOf(tok.attrs, withVertAlign(tok.rPr, ''), r.before || '') + r.xml;
      at = Math.max(at, Math.min(r.end, tok.e));
    }
    if (at < tok.e) out += runOf(tok.attrs, tok.rPr, tok.text.slice(at - tok.s));
  }
  return out;
}
/** The runs a span of text covers can be rewritten: all plain, with nothing but bookmarks and proofing marks between them. */
function rewritable(list, start, end) {
  let first = -1, last = -1;
  list.forEach((t, i) => { if (t.run && t.e > start && t.s < end) { if (first < 0) first = i; last = i; } });
  if (first < 0) return false;
  for (let i = first; i <= last; i++) {
    const t = list[i];
    if (t.run ? !t.plain && t.e > t.s : t.tag.startsWith('<') && !HARMLESS.test(t.tag)) return false;
  }
  return true;
}

// ---- the reference list ---------------------------------------------------------------------------------------------------------
const REF_HEAD = /^\s*(references?|bibliography|literature cited|works cited|reference list|reference dois\b.*)\s*:?\s*$/i;
const allBold = list => { const runs = list.filter(t => t.run && t.text.trim()); return runs.length > 0 && runs.every(t => /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(t.rPr)); };
const styleIdOf = p => /<w:pStyle w:val="([^"]+)"/.exec(p.inner)?.[1] || '';
const isHeadingPara = (p, list) => /^(heading|title)/i.test(styleIdOf(p)) || allBold(list);
/** The typed reference list: the heading's paragraph and the numbered or DOI-bearing paragraphs after it. */
function findRefList(paras, toks) {
  for (let i = paras.length - 1; i >= 0; i--) {
    if (!REF_HEAD.test(toks[i].text)) continue;
    const items = [];
    for (let j = i + 1; j < paras.length; j++) {
      const t = toks[j].text.trim();
      if (!t) { items.push(j); continue; }
      if (/^\[?\d{1,3}[.)\]]\s/.test(t) || ((doisIn(t).length || /PMID:?\s*\d/i.test(t)) && !isHeadingPara(paras[j], toks[j].list))) items.push(j); else break;
    }
    while (items.length && !toks[items[items.length - 1]].text.trim()) items.pop();
    if (items.length) return { heading: i, items };
  }
  return null;
}

// ---- tables and figures ---------------------------------------------------------------------------------------------------------
// ICMJE, AMA and Vancouver number a reference first cited in a table or a figure legend where the text first mentions that table or figure,
// not where it stands in the file (tables and legends usually come after the references). A table is a w:tbl with its caption ("Table 2",
// "Table 2. Outcomes") just before it, in its first cell or just after it, and the notes under it; a legend is a paragraph that opens
// "Figure 1." / "Fig. 1:" / "FIG. 1." A caption with no table (a table pasted as a picture) is one when its label is punctuated.
const NUM = String.raw`(?:S?\d+|[IVX]+)`;
const CAPTION = new RegExp(`^\\s*(table|fig(?:ure)?\\.?)\\s*(${NUM})(?![A-Za-z\\d])\\s*([.:|—–-])?`, 'i');
const NOTE_LINE = /^\s*(?:abbreviations?|notes?|sources?|[a-z]\s|[*†‡§¶#])/i;
const floatKey = (kind, n) => `${/^t/i.test(kind) ? 'table' : 'figure'}:${n.toUpperCase()}`;
const floatLabel = key => `${key.startsWith('table') ? 'Table' : 'Figure'} ${key.split(':')[1]}`;
/** Top-level tables as [start, end] offsets. */
function tableSpans(doc) {
  const out = [], re = /<(\/?)w:tbl>/g;
  let depth = 0, at = 0;
  for (let m; (m = re.exec(doc));) { if (!m[1]) { if (!depth) at = m.index; depth++; } else if (--depth === 0) out.push([at, re.lastIndex]); }
  return out;
}
/** The document's tables and legends: Map key ("table:2", "figure:1") -> its paragraphs' indexes. */
function floatsOf(doc, paras, toks) {
  const out = new Map(), taken = new Set(), text = i => toks[i]?.text.trim() || '';
  const add = (key, list) => { if (!out.has(key)) out.set(key, []); for (const i of list) if (!taken.has(i)) { taken.add(i); out.get(key).push(i); } };
  for (const [s, e] of tableSpans(doc)) {
    const inside = paras.map((p, i) => (p.start >= s && p.start < e ? i : -1)).filter(i => i >= 0);
    if (!inside.length) continue;
    let before = inside[0] - 1; while (before >= 0 && !text(before)) before--;
    let after = inside[inside.length - 1] + 1; while (after < paras.length && !text(after)) after++;
    const cap = [before, inside[0], after].find(i => i >= 0 && i < paras.length && /^t/i.test(CAPTION.exec(text(i))?.[1] || ''));
    if (cap == null) continue;
    const notes = [];
    for (let j = inside[inside.length - 1] + 1; j < paras.length && notes.length < 6; j++) { if (!text(j)) continue; if (j !== cap && NOTE_LINE.test(text(j))) notes.push(j); else break; }
    add(floatKey('table', CAPTION.exec(text(cap))[2]), [cap, ...inside, ...notes]);
  }
  paras.forEach((p, i) => {
    const m = CAPTION.exec(text(i));
    if (m && m[3] && !taken.has(i) && !/^[ivx]+$/.test(m[2])) add(floatKey(m[1], m[2]), [i]);
  });
  return out;
}
const PART = String.raw`(?:S?\d+[A-Za-z]?|[IVX]+)`;   // a panel letter only after a number ("2A"), so "figure in" is no figure
const MENTION = new RegExp(`\\b(tables?|fig(?:ure)?s?\\.?)\\s*(${PART}(?:\\s*(?:,|and|&|[–-]|to)\\s*${PART})*)(?![A-Za-z\\d])`, 'gi');
/** The tables and figures a text mentions: `[{ key, at }]` ("Figures 1–3" is three; "Fig. 2A" is figure 2; "Table I" in capitals only). */
export function mentionsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(MENTION)) {
    const parts = m[2].split(/\s*(,|and|&|[–-]|to)\s*/);
    for (let i = 0; i < parts.length; i += 2) {
      const n = parts[i].replace(/(\d)[A-Za-z]$/, '$1');
      if (/^[ivx]+$/i.test(n) && n !== n.toUpperCase()) continue;
      const range = /[–-]|to/.test(parts[i - 1] || '') && /^\d+$/.test(n) && /^\d+$/.test(parts[i - 2]?.replace(/[A-Za-z]$/, '') || '');
      if (range) for (let k = Number(parts[i - 2].replace(/[A-Za-z]$/, '')) + 1; k < Number(n); k++) out.push({ key: floatKey(m[1], String(k)), at: m.index });
      out.push({ key: floatKey(m[1], n), at: m.index });
    }
  }
  return out;
}

// ---- reading a document ---------------------------------------------------------------------------------------------------------
const decodeTag = tag => {
  const i = tag.indexOf('_v3_');
  if (i < 0) return null;
  try { const bin = atob(tag.slice(i + 4)); return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))); } catch { return null; }
};
/**
 * What a document cites: `{ markers: [{ para, start, end, dois, ok }], dois (in the order of first citation), loose (DOIs in the text
 * outside a marker), refList: { heading, items, entries: Map doi -> text } | null, mendeley: [{ items, text }], firstIn: Map key -> "Table 2"
 * (works first cited in a table or legend), unmentioned: ["Table 3"] (a table or figure with citations the text never mentions) }`.
 * The order of first citation reads a table's or legend's citations where the text first mentions it.
 */
export function scanDocument(doc, { marker = DEFAULT_MARKER } = {}) {
  const paras = paragraphs(doc), toks = paras.map(p => tokens(p.inner));
  const refList = findRefList(paras, toks), refSet = new Set(refList?.items || []);
  const markers = [], seen = new Set(), dois = [], loose = [], mendeley = [], firstIn = new Map();
  const floats = floatsOf(doc, paras, toks), floatAt = new Map([...floats].flatMap(([k, list]) => list.map(i => [i, k])));
  paras.forEach((p, i) => {
    for (const t of toks[i].list) if (t.tag?.startsWith('<w:tag ') && /MENDELEY_CITATION/.test(t.tag)) {
      const data = decodeTag(/w:val="([^"]+)"/.exec(t.tag)?.[1] || '');
      if (data) mendeley.push({ para: i, items: (data.citationItems || []).map(c => c.itemData || {}), text: data.manualOverride?.citeprocText || '' });
    }
    if (refSet.has(i) || (refList && i === refList.heading)) return;
    const text = toks[i].text, found = findMarkers(text, marker);
    for (const m of found) markers.push({ para: i, ...m, ok: !p.nested && rewritable(toks[i].list, m.start, m.end) });
    const covered = (s) => found.some(m => s >= m.start && s < m.end);
    for (const m of text.matchAll(ANY_DOI)) if (!covered(m.index)) loose.push({ para: i, doi: cleanDoi(m[1]), at: m.index });
  });
  // the order of first citation: the text's markers in turn, and a table's or legend's at the text's first mention of it; one the text
  // never mentions keeps its place in the file
  const byPara = new Map();
  for (const m of markers) { if (!byPara.has(m.para)) byPara.set(m.para, []); byPara.get(m.para).push(m); }
  const body = i => !floatAt.has(i) && !refSet.has(i) && !(refList && i === refList.heading);
  const firstMention = new Map();
  paras.forEach((p, i) => { if (body(i)) for (const { key, at } of mentionsIn(toks[i].text)) if (floats.has(key) && !firstMention.has(key)) firstMention.set(key, { para: i, at }); });
  const done = new Set(), cites = new Set(), unmentioned = [];
  const take = (m, label) => { for (const d of m.dois) if (!seen.has(doiKey(d))) { seen.add(doiKey(d)); dois.push(d); if (label) firstIn.set(doiKey(d), label); } };
  const runFloat = key => { done.add(key); for (const i of floats.get(key)) for (const m of byPara.get(i) || []) { cites.add(key); take(m, floatLabel(key)); } };
  paras.forEach((p, i) => {
    const fk = floatAt.get(i);
    if (fk) { if (!done.has(fk)) { const mentioned = firstMention.has(fk); if (!mentioned) runFloat(fk); if (!mentioned && cites.has(fk)) unmentioned.push(floatLabel(fk)); } return; }
    if (!body(i)) return;
    const events = [...(byPara.get(i) || []).map(m => ({ at: m.start, m })), ...[...firstMention].filter(([, v]) => v.para === i).map(([key, v]) => ({ at: v.at, key }))];
    for (const e of events.sort((a, b) => a.at - b.at)) if (e.m) take(e.m); else if (!done.has(e.key)) runFloat(e.key);
  });
  const entries = new Map();
  if (refList) for (const j of refList.items) {
    const t = toks[j].text.trim(), d = doisIn(t)[0], pm = /PMID:?\s*(\d{1,9})/i.exec(t)?.[1];
    for (const k of [d && doiKey(d), pm && `pmid:${pm}`]) if (k && !entries.has(k)) entries.set(k, t);
  }
  return { markers, dois, loose, refList: refList && { ...refList, entries }, mendeley, paragraphs: paras.length, firstIn, unmentioned };
}

// ---- converting -----------------------------------------------------------------------------------------------------------------
const fallbackCsl = id => withId({ type: 'article-journal', id: stableUuid(doiKey(id)), title: '' }, id);
/** A paragraph's properties with a hanging indent of 640 twips (Mendeley's numbered list) and no list numbering or other indent. */
function withHanging(pPr) {
  let p = (pPr || '<w:pPr></w:pPr>').replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, '').replace(/<w:ind\b[^>]*\/>/, '');
  // schema order: w:ind comes after spacing and before contextualSpacing, jc, outlineLvl, rPr …
  const at = p.search(/<w:(contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/);
  const ind = '<w:ind w:left="640" w:hanging="640"/>';
  return at >= 0 ? p.slice(0, at) + ind + p.slice(at) : p.replace('</w:pPr>', `${ind}</w:pPr>`);
}

/**
 * DOI markers to Mendeley Cite citations in document.xml. `works` is a Map doiKey -> CSL item (a DOI without one is cited by its DOI
 * alone). `refs`: 'auto' replaces the typed list (else adds one at the end), 'end' adds one, 'none' leaves the list to the add-in.
 * `same` is a Map key -> key: ids cited for one work (duplicateWorks), cited as the second's work under one number.
 * Answers `{ doc, citations (each with the `keys` it cites), numbers: Map key -> n, converted, skipped, bibliography: [line], bibKeys }`.
 */
export function convertDocument(doc, { works = new Map(), style = 'ama', marker = DEFAULT_MARKER, refs = 'auto', heading = 'References', punctuation = true, same = new Map() } = {}) {
  const st = styleOf(style), scan = scanDocument(doc, { marker });
  const paras = paragraphs(doc), toks = paras.map(p => tokens(p.inner));
  const canon = d => same.get(doiKey(d)) || doiKey(d);
  const first = new Map();   // each work's key -> the id as the document first wrote it
  for (const d of scan.dois) if (!first.has(canon(d))) first.set(canon(d), same.has(doiKey(d)) ? scan.dois.find(x => doiKey(x) === canon(d)) || d : d);
  const order = [...first.keys()], at1 = new Map(order.map((k, i) => [k, i + 1]));
  const numbers = new Map(scan.dois.map(d => [doiKey(d), at1.get(canon(d))]));
  const item = d => works.get(canon(d)) || works.get(doiKey(d)) || fallbackCsl(first.get(canon(d)) || d);
  const citations = [], byPara = new Map();
  let skipped = 0;
  for (const m of scan.markers) {
    if (!m.ok) { skipped++; continue; }
    const text = toks[m.para].text, items = [...new Map(m.dois.map(d => [canon(d), d])).values()].map(item);
    let { start, end } = m, before = '';
    if (st.sup) {
      while (start > 0 && /[  ]/.test(text[start - 1])) start--;
      if (punctuation) { const p = /^[.,]+/.exec(text.slice(end))?.[0] || ''; if (p && rewritable(toks[m.para].list, start, end + p.length)) { before = p; end += p.length; } }
    }
    if (!rewritable(toks[m.para].list, start, end)) { start = m.start; end = m.end; before = ''; }
    const shown = citationText(style, m.dois.map(d => numbers.get(doiKey(d))), items.map(recordOf));
    // as Mendeley Cite saves a citation: its text as citeproc's HTML, no flags it does not write, and in the document's list its tag
    const c = mendeleyCitation(items, shown, `${m.para}|${m.start}`);
    c.manualOverride.citeprocText = st.sup ? `<sup>${shown}</sup>` : shown;
    c.citationItems = c.citationItems.map(({ id, itemData, isTemporary }) => ({ id, itemData, isTemporary }));
    const tag = mendeleyTag(c);
    citations.push({ ...c, citationTag: tag, keys: m.dois.map(doiKey) });
    const startTok = toks[m.para].list.find(t => t.run && t.s <= start && t.e > start);
    const rPr = withVertAlign(startTok?.rPr || '', st.sup ? 'superscript' : '');
    if (!byPara.has(m.para)) byPara.set(m.para, []);
    byPara.get(m.para).push({ start, end, before, xml: sdt(tag, runOf('', rPr, shown), rPr) });
  }
  // the reference list, in the order of first citation (author and year: by first author)
  const ordered = order.map(k => ({ d: first.get(k), r: recordOf(item(first.get(k))) }));
  if (st.authorDate) ordered.sort((a, b) => (a.r.authors[0] || a.d).localeCompare(b.r.authors[0] || b.d) || String(a.r.year).localeCompare(String(b.r.year)));
  const bibliography = ordered.map(({ d, r }) => referenceText(style, numbers.get(doiKey(d)), r));
  const mode = refs === 'auto' ? (scan.refList ? 'replace' : 'end') : refs;
  let out = '', at = 0, bibXml = '';
  const firstItem = scan.refList ? paras[scan.refList.items[0]] : null;
  const itemPPr = firstItem ? /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(firstItem.inner)?.[0] || '' : '';
  // a numbered entry as Mendeley Cite lays it out: the number, a tab, the reference, on a hanging indent
  const bibPPr = st.authorDate ? itemPPr.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, '') : withHanging(itemPPr);
  const bibParas = (bibliography.length ? bibliography : ['']).map(line => `<w:p>${bibPPr}${runOf('', '', st.authorDate ? line : line.replace(/^(\d+\.)\s+/, '$1\t'))}</w:p>`).join('');
  if (mode !== 'none' && order.length) bibXml = sdt('MENDELEY_BIBLIOGRAPHY', bibParas);
  const headingPara = (p, list) => {
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p?.inner || '')?.[0] || '', r = list?.find(t => t.run && t.text.trim());
    return `${p ? p.open : '<w:p>'}${pPr}${runOf(r?.attrs || '', r?.rPr || '<w:rPr><w:b/><w:bCs/></w:rPr>', heading)}</w:p>`;
  };
  paras.forEach((p, i) => {
    out += doc.slice(at, p.start); at = p.end;
    if (mode === 'replace' && scan.refList && bibXml) {
      if (i === scan.refList.heading) { out += heading ? headingPara(p, toks[i].list) : doc.slice(p.start, p.end); return; }
      if (scan.refList.items.includes(i)) { if (i === scan.refList.items[0]) out += bibXml; return; }
    }
    const reps = byPara.get(i);
    out += reps ? `${p.open}${rewrite(toks[i].list, reps.sort((a, b) => a.start - b.start))}</w:p>` : doc.slice(p.start, p.end);
  });
  out += doc.slice(at);
  if (mode === 'end' && bibXml) {
    const close = out.lastIndexOf('</w:body>'), sect = out.lastIndexOf('<w:sectPr', close);
    const where = sect > Math.max(out.lastIndexOf('</w:p>', close), out.lastIndexOf('</w:tbl>', close)) ? sect : close;
    out = out.slice(0, where) + (heading ? headingPara(null, null) : '') + bibXml + out.slice(where);
  }
  // the title page's "Number of references" follows the list the file now carries
  const count = referenceCount(out), listed = mode === 'none' ? null : order.length;
  const doc2 = count && listed != null && count.value !== listed ? setReferenceCount(out, listed) : out;
  return { doc: doc2, citations, numbers, converted: citations.length, skipped, bibliography, bibKeys: ordered.map(o => canon(o.d)), scan, mode, count: count && { was: count.value, now: listed ?? count.value } };
}

/** Mendeley Cite citations back to DOI markers, and its bibliography to plain paragraphs. Answers `{ doc, reverted }`. */
export function revertDocument(doc, { marker = DEFAULT_MARKER } = {}) {
  const m = { ...DEFAULT_MARKER, ...marker }, [o, c] = BRACKETS[m.brackets] || BRACKETS.round;
  const pre = m.prefix === 'link' ? 'https://doi.org/' : m.prefix === 'bare' ? '' : 'doi:', sep = m.separator === 'comma' ? ', ' : '; ';
  let reverted = 0, out = '', at = 0;
  const SDT = /<w:sdt>\s*<w:sdtPr>([\s\S]*?)<\/w:sdtPr>(\s*<w:sdtEndPr\s*\/>|\s*<w:sdtEndPr>[\s\S]*?<\/w:sdtEndPr>)?\s*<w:sdtContent>([\s\S]*?)<\/w:sdtContent>\s*<\/w:sdt>/g;
  for (const x of doc.matchAll(SDT)) {
    const [all, pr, , content] = x;
    out += doc.slice(at, x.index); at = x.index + all.length;
    const tag = /<w:tag w:val="([^"]+)"/.exec(pr)?.[1] || '';
    if (tag === 'MENDELEY_BIBLIOGRAPHY') { out += content; continue; }
    if (!tag.startsWith('MENDELEY_CITATION')) { out += all; continue; }
    // a work with no DOI goes back to its PubMed id
    const data = decodeTag(tag), ids = (data?.citationItems || []).map(it => (it.itemData?.DOI ? pre + cleanDoi(it.itemData.DOI) : it.itemData?.PMID ? `PMID: ${it.itemData.PMID}` : '')).filter(Boolean);
    if (!ids.length) { out += all; continue; }
    reverted++;
    const r = /<w:r\b[^>]*>(\s*<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(content);
    // a superscript number stands after the full stop or comma it cites (convertDocument moved it there); its marker goes back before it,
    // as it was typed: "surgery.¹" becomes "surgery (doi:…)." The punctuation is taken from the end of the text just before, in this paragraph.
    let after = '';
    if (/<w:vertAlign w:val="superscript"\/>/.test(r?.[1] || '')) {
      const t = out.lastIndexOf('</w:t>'), p = Math.max(out.lastIndexOf('<w:p>'), out.lastIndexOf('<w:p '));
      const open = out.lastIndexOf('>', t - 1) + 1, text = t > p ? out.slice(open, t) : '';
      const punct = /[.,;:]+$/.exec(text)?.[0] || '';
      if (punct && !/<w:t[ >]|<w:tab\/>|<w:br\/>/.test(out.slice(t + 6))) { out = out.slice(0, t - punct.length) + out.slice(t); after = punct; }
    }
    // a space before the marker unless the text before it ends with one (a number in brackets kept it)
    const t = out.lastIndexOf('</w:t>'), p = Math.max(out.lastIndexOf('<w:p>'), out.lastIndexOf('<w:p '));
    const spaced = t > p && /[\s\u00a0]$/.test(out.slice(out.lastIndexOf('>', t - 1) + 1, t));
    out += runOf('', withVertAlign(r?.[1]?.trim() || '', ''), `${spaced ? '' : ' '}${o}${ids.join(sep)}${c}${after}`);
  }
  out += doc.slice(at);
  return { doc: out, reverted };
}

/**
 * The converted document with its citations and bibliography as plain text: Mendeley Cite's controls taken away, their text kept where it
 * stands. Journals ask for this at submission ("remove field codes"); writeDocx with `citations: null` then drops the add-in's part too.
 */
export function plainDocument(doc) {
  let unwrapped = 0;
  const out = doc.replace(/<w:sdt>\s*<w:sdtPr>([\s\S]*?)<\/w:sdtPr>(\s*<w:sdtEndPr\s*\/>|\s*<w:sdtEndPr>[\s\S]*?<\/w:sdtEndPr>)?\s*<w:sdtContent>([\s\S]*?)<\/w:sdtContent>\s*<\/w:sdt>/g, (all, pr, endPr, content) =>
    /<w:tag w:val="MENDELEY_(?:CITATION|BIBLIOGRAPHY)/.test(pr) ? (unwrapped++, content) : all);
  return { doc: out, unwrapped };
}

// The title page's own count ("Number of references: 21"): read, and set to the reference list's length in the converted file.
const COUNT_LINE = /^\s*(?:number of references|references)\s*:\s*(\d+)\s*$/i;
/** `{ para, value }` of the paragraph that states the number of references, or null. */
export function referenceCount(doc) {
  const paras = paragraphs(doc);
  for (let i = 0; i < paras.length; i++) { const m = COUNT_LINE.exec(tokens(paras[i].inner).text); if (m) return { para: i, value: Number(m[1]) }; }
  return null;
}
/** The document with that paragraph's number set to `n` (the run that holds the digits is changed, the rest kept). */
export function setReferenceCount(doc, n) {
  const at = referenceCount(doc); if (!at || at.value === n) return doc;
  const p = paragraphs(doc)[at.para];
  const inner = p.inner.replace(/(<w:t(?:\s[^>]*)?>[^<]*?)(\d+)(\s*<\/w:t>)(?![\s\S]*<w:t(?:\s[^>]*)?>[^<]*\d)/, (m, a, d, b) => `${a}${n}${b}`);
  return doc.slice(0, p.start) + p.open + inner + '</w:p>' + doc.slice(p.end);
}

// ---- writing the package --------------------------------------------------------------------------------------------------------
const MENDELEY_EXT = /wa104382081/i;
/**
 * The package with a new document.xml and Mendeley Cite's web extension (style, locale, citations): an existing Mendeley extension is
 * replaced, another add-in's is kept. `citations: null` removes Mendeley's extension. Answers a Blob.
 */
export async function writeDocx(pkg, doc, { citations = [], style = 'ama' } = {}) {
  const files = pkg.files.map(f => ({ ...f })), dec = new TextDecoder();
  const get = name => files.find(f => f.name === name);
  const textOf = f => (typeof f.data === 'string' ? f.data : dec.decode(f.data));
  const put = (name, data) => { const f = get(name); if (f) f.data = data; else files.push({ name, data }); };
  const drop = name => { const i = files.findIndex(f => f.name === name); if (i >= 0) files.splice(i, 1); };
  put('word/document.xml', doc);
  // Mendeley's extension, wherever an earlier save put it
  const mine = files.filter(f => /^word\/webextensions\/webextension\d*\.xml$/.test(f.name) && MENDELEY_EXT.test(textOf(f))).map(f => f.name);
  const panesRels = get('word/webextensions/_rels/taskpanes.xml.rels');
  const types = get('[Content_Types].xml'), rootRels = get('_rels/.rels');
  if (citations === null) {
    for (const n of mine) drop(n);
    if (panesRels) {
      const left = textOf(panesRels).replace(/<Relationship\b[^>]*Target="([^"]+)"[^>]*\/>/g, (r, t) => (mine.includes(`word/webextensions/${t}`) ? '' : r));
      if (!/<Relationship\b/.test(left)) {
        drop('word/webextensions/taskpanes.xml'); drop('word/webextensions/_rels/taskpanes.xml.rels');
        if (rootRels) put('_rels/.rels', textOf(rootRels).replace(/<Relationship\b[^>]*webextensiontaskpanes[^>]*\/>/g, ''));
        if (types) put('[Content_Types].xml', textOf(types).replace(/<Override PartName="\/word\/webextensions\/[^"]+"[^>]*\/>/g, ''));
      } else put('word/webextensions/_rels/taskpanes.xml.rels', left);
    }
    return zip(files);
  }
  const parts = mendeleyParts(citations, { style: style?.mendeley || (MENDELEY_STYLES[style] ? style : 'ama'), modified: Date.now() });
  const ext = parts.parts.find(p => p.name.endsWith('webextension1.xml')).data;
  if (mine.length) { put(mine[0], ext); return zip(files); }
  if (panesRels) {
    // another add-in is there: Mendeley's extension beside it
    let n = 1; while (get(`word/webextensions/webextension${n}.xml`)) n++;
    const name = `webextension${n}.xml`, rels = textOf(panesRels);
    let id = 1; while (rels.includes(`Id="rId${id}"`)) id++;
    put(`word/webextensions/${name}`, ext);
    put('word/webextensions/_rels/taskpanes.xml.rels', rels.replace('</Relationships>', `<Relationship Id="rId${id}" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="${name}"/></Relationships>`));
    const panes = get('word/webextensions/taskpanes.xml');
    if (panes) put('word/webextensions/taskpanes.xml', textOf(panes).replace('</wetp:taskpanes>', `<wetp:taskpane dockstate="right" visibility="0" width="350" row="${n}"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${id}"/></wetp:taskpane></wetp:taskpanes>`));
    if (types && !textOf(types).includes(`/word/webextensions/${name}`)) put('[Content_Types].xml', textOf(types).replace('</Types>', `<Override PartName="/word/webextensions/${name}" ContentType="application/vnd.ms-office.webextension+xml"/></Types>`));
    return zip(files);
  }
  for (const p of parts.parts) put(p.name, p.data);
  if (rootRels) {
    const rels = textOf(rootRels);
    let id = 1; while (rels.includes(`Id="rIdMendeley${id}"`)) id++;
    put('_rels/.rels', rels.replace('</Relationships>', `${parts.rootRel.replace('Id="rId2"', `Id="rIdMendeley${id}"`)}</Relationships>`));
  }
  if (types) {
    let t = textOf(types);
    for (const [part, ct] of parts.overrides) if (!t.includes(`PartName="${part}"`)) t = t.replace('</Types>', `<Override PartName="${part}" ContentType="${ct}"/></Types>`);
    put('[Content_Types].xml', t);
  }
  return zip(files);
}

// ---- preview --------------------------------------------------------------------------------------------------------------------
/**
 * A part's paragraphs for reading: `[{ heading, segs: [{ t, b, i, sup, sub, cite }] }]`. `cite` marks a DOI marker (`{ dois }`) or a
 * Mendeley citation (`{ dois, text }`); a paragraph in a Mendeley bibliography has `bib`.
 */
export function previewOf(doc, { marker = DEFAULT_MARKER } = {}) {
  const out = [], bibRanges = [];
  for (const m of doc.matchAll(/<w:sdt>\s*<w:sdtPr>(?:(?!<\/w:sdtPr>)[\s\S])*?<w:tag w:val="MENDELEY_BIBLIOGRAPHY"\/>[\s\S]*?<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/g)) bibRanges.push([m.index, m.index + m[0].length]);
  for (const p of paragraphs(doc)) {
    const { list, text } = tokens(p.inner), segs = [];
    let cite = null;
    for (const t of list) {
      if (!t.run) {
        if (/^<w:tag w:val="MENDELEY_CITATION/.test(t.tag)) { const d = decodeTag(/w:val="([^"]+)"/.exec(t.tag)[1]); cite = { dois: (d?.citationItems || []).map(x => x.itemData?.DOI).filter(Boolean), mendeley: true }; }
        else if (/^<\/w:sdt>/.test(t.tag)) cite = null;
        continue;
      }
      if (!t.text) continue;
      const f = { b: /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(t.rPr), i: /<w:i(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(t.rPr), sup: /w:vertAlign w:val="superscript"/.test(t.rPr), sub: /w:vertAlign w:val="subscript"/.test(t.rPr) };
      segs.push({ t: t.text.replace(/￼/g, ''), s: t.s, ...f, ...(cite ? { cite } : {}) });
    }
    // DOI markers: split the segments at their edges
    const marks = cite ? [] : findMarkers(text, marker);
    const split = [];
    for (const s of segs) {
      if (s.cite || !marks.length) { split.push(s); continue; }
      let at = 0;
      for (const m of marks) {
        const a = Math.max(m.start - s.s, at), b = Math.min(m.end - s.s, s.t.length);
        if (b <= a) continue;
        if (a > at) split.push({ ...s, t: s.t.slice(at, a) });
        split.push({ ...s, t: s.t.slice(a, b), cite: { dois: m.dois } });
        at = b;
      }
      if (at < s.t.length) split.push({ ...s, t: s.t.slice(at) });
    }
    out.push({ heading: isHeadingPara(p, list) && text.length < 200, bib: bibRanges.some(([a, b]) => p.start >= a && p.end <= b), segs: split.map(({ s, ...x }) => x) });
  }
  return out;
}

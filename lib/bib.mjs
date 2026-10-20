import { codePoint } from './xml.mjs';
import { normalizeLanguage, nonEnglishLanguage } from './languages.mjs';
import { sniffFormat, sniffIdentifiers, parseExtra } from './ref-import-extra.mjs';
// Minimal RIS / BibTeX / CSL-JSON reader.
// Enough to get real records in without a dependency; it keeps the raw entry so
// nothing is lost when the parser does not understand a field (plan B3).
/**
 * Authors as a list, whatever shape the record arrived in. Importers and
 * hand-edited projects supply a single string as often as an array, and a
 * record that is merely awkward must not take a whole view down with it.
 */
export function authorList(authors) {
  if (Array.isArray(authors)) return authors.filter(Boolean);
  if (typeof authors === 'string') {
    const one = authors.trim();
    // "Smith, John A." is one author: a single comma with no initials before it
    // is the family-name comma, not a separator between "Smith J, Jones K".
    if ((one.match(/,/g) || []).length === 1 && !/;|\s+and\s+/.test(one) && !/\s[A-Z]{1,3}\.?\s*,/.test(one)) return [one];
    return one.split(/;|\s+and\s+|,\s*(?=[A-Z][a-z]+\s)/)
      .map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Author list in the form a reader expects in a table: one name, two joined,
 * three or more as first author et al. The full list stays on the record.
 */
export function authorLine(authors = []) {
  const a = authorList(authors).map(n => initials(n));
  if (!a.length) return '';
  if (a.length <= 2) return a.join(', ');
  return `${a.slice(0, 2).join(', ')}, et al.`;
}

/** "ODA" as a registry sends it is "Oda" as a journal prints it. */
const caseFamily = f => /^[A-Z][A-Z' -]{2,}$/.test(f) ? f.toLowerCase().replace(/(^|[ '-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : f;

/** "Brat DJ" from "Brat, D J" / "Brat DJ" / "Daniel J Brat" (ICMJE form). */
export function initials(name, { comma = false, dots = false } = {}) {
  const s = String(name).trim();
  let family, given;
  if (s.includes(',')) [family, given] = s.split(',').map(x => x.trim());
  else {
    const parts = s.split(/\s+/);
    // "Brat DJ" (family first, initials after) vs "Daniel J Brat" (given first)
    const last = parts[parts.length - 1];
    if (parts.length > 1 && /^[A-Z]{1,3}$/.test(last)) { family = parts.slice(0, -1).join(' '); given = last; }
    else { family = last; given = parts.slice(0, -1).join(' '); }
  }
  const ini = (given || '').split(/[\s.]+/).filter(Boolean).map(g => g[0].toUpperCase());
  const init = dots ? ini.map(i => `${i}.`).join(' ') : ini.join('');
  family = caseFamily(family || '');
  return comma ? `${family}${init ? `, ${init}` : ''}` : `${family}${init ? ` ${init}` : ''}`;
}

/** The family name alone: "van der Berg" from "van der Berg, J" or "J van der Berg". */
export const familyName = name => initials(name, { comma: true }).split(',')[0].trim();


/**
 * How a study is identified wherever it appears: the short citation a reader
 * recognises, with the title beneath it. One treatment everywhere, so the same
 * study does not read as "Aronson 1948" in one table and a long title in the
 * next.
 */
export function studyCell(p, { open = false, titleFirst = false, titleLine = true } = {}) {
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const label = esc(p.label || p.title || 'Untitled');
  const title = titleLine && p.title && p.title !== p.label ? esc(p.title) : '';
  // A library reads by title with the study identifier beneath; an analysis
  // table reads by identifier, where a row is narrow and the title is a tooltip.
  const body = titleFirst && title
    ? `<span class="study-label">${title}</span><div class="study-title">${label}</div>`
    : `<span class="study-label">${label}</span>${title ? `<div class="study-title">${title}</div>` : ''}`;
  // The whole cell is the target, not just the label: a reader aiming at a
  // study aims at its name and its title together. Without a document it opens
  // the record instead of doing nothing, so the affordance never lies.
  return open
    ? `<button class="study study-open" data-open="${esc(p.id)}"
        title="${esc(p.title || p.label || '')}">${body}${nonEnglishLanguage(p.language) ? `<span class="paper-language">${esc(nonEnglishLanguage(p.language))}</span>` : ''}</button>`
    : `<div class="study">${body}</div>`;
}

export function parseRecords(text, filename = '') {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  const ext = String(filename).split('.').pop().toLowerCase();
  if (/<records>\s*<record[\s>]/.test(t.slice(0, 4000))) return endnoteXml(t);
  if (/^<\?xml|<PubmedArticleSet|<PubmedArticle[\s>]/.test(t.slice(0, 2000))) return pubmedXml(t);
  if (t.startsWith('[') || t.startsWith('{')) return csl(t);
  if (/^\s*@\w+\s*[{(]/m.test(t)) return bibtex(t);
  // PubMed's MEDLINE export (.nbib, .txt) shares "AU  - " with RIS, so it is recognised first, by PMID.
  if (/^PMID-\s*\d/m.test(t) && !/^TY\s+-\s+/m.test(t)) return medline(t);
  // Web of Science, Ovid, Cochrane and RefWorks exports (lib/ref-import-extra.mjs); Ovid's short form also writes "AU  - ", so before RIS.
  const extra = sniffFormat(t, { identifiers: false });
  if (extra) return parseExtra(t, extra);
  if (/^(TY|T1|AU)\s+-\s+/m.test(t)) return ris(t);
  if (/^%[0TA] \S/m.test(t)) return refer(t);
  if (ext === 'csv' || ext === 'tsv' || looksTabular(t)) return tabular(t);
  // A list of DOIs, PMIDs, PMCIDs or trial numbers: the caller looks them up.
  if (sniffIdentifiers(t)) return parseExtra(t, 'identifiers');
  return { records: [], format: ext || 'unknown', errors: 1 };
}

// A record's key decides whether two imports are the same record: its DOI,
// else its PMID (the forms search results use, lib/sources.mjs recordKey),
// else a hash of title, year and first author. It used to be the record's
// position in the file plus a title prefix, so the first record of two
// different files could share a key when their titles began alike, and the
// second was silently dropped as "already in the library".
const cleanDoi = d => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
export function hash64(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
export function importKey({ doi, pmid, title, year, authors }) {
  const d = cleanDoi(doi);
  if (d) return `doi-${d.toLowerCase()}`;
  const m = String(pmid || '').trim();
  if (/^\d+$/.test(m)) return `pmid-${m}`;
  const norm = v => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `rec-${hash64([norm(title), String(year || ''), norm(authorList(authors)[0] || '')].join('|'))}`;
}

const mk = (i, { title, year, journal, journalAbbr, authors, raw, language, database, doi, pmid, abstract, accession, url, volume, issue, pages, keywords, mesh }) => {
  const d = cleanDoi(doi), list = authorList(authors), t = String(title || '').replace(/\s+/g, ' ').trim();
  return {
    key: importKey({ doi: d, pmid, title: t, year, authors: list }),
    label: shortLabel(list, year, t),
    title: t || 'Untitled', year: year || '', journal: journal || '',
    authors: list, language: normalizeLanguage(language), raw,
    ...(database ? { database } : {}),
    // Carried when the export has them: a DOI is what de-duplicates a record
    // across databases, and screening reads the abstract.
    ...(d ? { doi: d } : {}), ...(pmid ? { pmid: String(pmid).trim() } : {}), ...(abstract ? { abstract } : {}), ...(accession ? { accession } : {}),
    ...(journalAbbr ? { journalAbbr } : {}), ...(keywords?.length ? { keywords } : {}), ...(mesh?.length ? { mesh } : {}),
    ...(url ? { url } : {}), ...(volume ? { volume } : {}), ...(issue ? { issue } : {}), ...(pages ? { pages } : {}),
  };
};

function shortLabel(authors, year, title) {
  const first = (authors && authors[0]) || '';
  const surname = first ? familyName(first) : '';
  if (surname && year) return `${surname} ${year}`;
  return (title || 'Untitled').slice(0, 40);
}

function ris(t) {
  const records = []; let cur = null, errors = 0, last = null;
  const close = () => { if (cur && (cur.title || cur.authors.length || cur.doi)) records.push(cur); cur = null; last = null; };
  for (const line of t.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,3}-\s?(.*)$/.exec(line);
    if (!m) {
      // A value wrapped onto the next line (EndNote and some databases do this): part of the field before it.
      if (cur && last && line.trim()) {
        if (last === 'author') cur.authors[cur.authors.length - 1] += ` ${line.trim()}`;
        else if (last === 'keyword') cur.keywords[cur.keywords.length - 1] += ` ${line.trim()}`;
        else if (last) cur[last] = `${cur[last] || ''} ${line.trim()}`.trim();
        cur.raw.push(line);
      } else if (line.trim() && !cur) errors++;
      continue;
    }
    const tag = m[1], val = (m[2] || '').trim();
    if (tag === 'TY') { close(); cur = { authors: [], keywords: [], raw: [] }; }
    if (!cur) cur = { authors: [], keywords: [], raw: [] };   // an export that drops TY: the record starts at its first tag
    cur.raw.push(line);
    last = null;
    if (tag === 'TI' || tag === 'T1') { cur.title = cur.title ? cur.title : val; last = 'title'; }
    else if ((tag === 'PY' || tag === 'Y1' || tag === 'DA') && !cur.year) cur.year = (val.match(/\d{4}/) || [''])[0];
    else if (tag === 'JO' || tag === 'JF' || tag === 'T2') { if (!cur.journal) { cur.journal = val; last = 'journal'; } }
    else if ((tag === 'JA' || tag === 'J2') && val) cur.journalAbbr ||= val;
    else if (tag === 'LA') cur.language = val;
    else if ((tag === 'DB' || tag === 'DP') && val) cur.database ||= val;   // the database the export came from
    else if ((tag === 'AU' || tag === 'A1') && val) { cur.authors.push(val); last = 'author'; }
    else if (tag === 'DO' && val) cur.doi ||= cleanDoi(val);
    else if ((tag === 'AB' || tag === 'N2') && val) { cur.abstract = cur.abstract ? `${cur.abstract}\n${val}` : val; last = 'abstract'; }
    else if (tag === 'AN' && val) cur.accession ||= val;
    else if (tag === 'KW' && val) { cur.keywords.push(val); last = 'keyword'; }
    else if ((tag === 'UR' || tag === 'L2') && val) cur.url ||= val;
    else if (tag === 'VL') cur.volume = val;
    else if (tag === 'IS') cur.issue = val;
    else if (tag === 'SP') cur.pages = val;
    else if (tag === 'EP' && cur.pages && val) cur.pages = `${cur.pages}-${val}`;
    else if (tag === 'ER') close();
  }
  close();   // a last record without its ER line is still a record
  for (const r of records) {
    // PubMed's RIS puts the PMID in AN; a DOI can also arrive only in the URL.
    if (/pubmed/i.test(r.database || '') && /^\d+$/.test(r.accession || '')) r.pmid = r.accession;
    if (!r.doi) { const d = /doi\.org\/(10\.\S+)/i.exec(r.url || '')?.[1]; if (d) r.doi = d; }
  }
  return { records: records.map((r, i) => mk(i, r)), format: 'RIS', errors };
}

// PubMed MEDLINE format: four-character tags, a value after "- ", long values
// continued on lines indented by six spaces, a blank line between records.
function medline(t) {
  const records = [];
  for (const block of t.split(/\r?\n\s*\r?\n(?=PMID-)/)) {
    const fields = [];
    for (const line of block.split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9]{0,3})\s*-\s?(.*)$/.exec(line);
      if (m) fields.push([m[1], m[2].trim()]);
      else if (/^\s{2,}\S/.test(line) && fields.length) fields.at(-1)[1] += ` ${line.trim()}`;
    }
    if (!fields.some(([k]) => k === 'PMID')) continue;
    const r = { authors: [], keywords: [], raw: block.split(/\r?\n/), database: 'PubMed' };
    for (const [k, v] of fields) {
      if (k === 'TI') r.title = v;
      else if (k === 'AB') r.abstract = v;
      else if (k === 'FAU') r.authors.push(v);
      else if (k === 'AU' && !fields.some(([x]) => x === 'FAU')) r.authors.push(v);
      else if (k === 'DP') r.year = (v.match(/\d{4}/) || [''])[0];
      else if (k === 'JT') r.journal = v;
      else if (k === 'TA') { r.journalAbbr ||= v; if (!r.journal) r.journal = v; }
      else if (k === 'LA') r.language ||= v;
      else if (k === 'PMID') r.accession = v;
      else if ((k === 'LID' || k === 'AID') && /\[doi\]/.test(v)) r.doi ||= v.replace(/\s*\[doi\].*$/, '').trim();
      else if (k === 'OT') r.keywords.push(v);
      else if (k === 'MH') { r.keywords.push(v); (r.mesh ||= []).push(v.split('/')[0].replace(/^\*/, '').trim()); }
      else if (k === 'VI') r.volume = v;
      else if (k === 'IP') r.issue = v;
      else if (k === 'PG') r.pages = v;
    }
    r.pmid = r.accession;
    records.push(r);
  }
  return { records: records.map((r, i) => mk(i, r)), format: 'MEDLINE', errors: 0 };
}

// LaTeX in BibTeX values: braces that protect case, escaped specials and
// accent commands ({\"u}, \'{e}, \c{c}) become the characters they stand for.
const ACCENT = { '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨' };
const LETTER = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', oe: 'œ', OE: 'Œ', i: 'ı' };
export function latexText(v) {
  let s = String(v ?? '');
  s = s.replace(/\\([`'"^~=.uvHck])\s*\{?\\?([A-Za-z])\}?/g, (m, a, ch) => ch + ACCENT[a]);
  s = s.replace(/\\(ss|ae|AE|aa|AA|oe|OE|o|O|l|L|i)(?![A-Za-z])\s?/g, (m, w) => LETTER[w]);
  s = s.replace(/\\([&%$#_{}])/g, '$1').replace(/\\textendash\b|--/g, '–').replace(/~/g, ' ');
  s = s.replace(/\\(?:emph|textit|textbf|mathrm|textsc)\s*/g, '');
  return s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().normalize('NFC');
}

function bibtex(t) {
  const out = [];
  // Brace matching, not a regex: entries nest braces and may or may not end
  // with a newline, which a lazy pattern gets wrong either way.
  const re = /@(\w+)\s*([{(])/g;
  let m, errors = 0;
  while ((m = re.exec(t))) {
    const open = m[2], shut = open === '{' ? '}' : ')';
    let depth = 1, i = re.lastIndex;
    while (i < t.length && depth > 0) {
      if (t[i] === open) depth++;
      else if (t[i] === shut) depth--;
      i++;
    }
    const kind = m[1].toLowerCase();
    re.lastIndex = i;
    // @string, @preamble and @comment define things; they are not references.
    if (kind === 'string' || kind === 'preamble' || kind === 'comment') continue;
    if (depth > 0) { errors++; break; }   // an entry the file never closes
    const entry = t.slice(m.index + m[0].length, i - 1);
    const body = entry.slice(entry.indexOf(',') + 1);
    const f = {};
    // Values nest braces too ("A {BCG} trial"), so match them the same way.
    const fre = /([\w-]+)\s*=\s*/g;
    let fm;
    while ((fm = fre.exec(body))) {
      let j = fre.lastIndex, val = '';
      if (body[j] === '{') {
        let d = 1; j++;
        const start = j;
        while (j < body.length && d > 0) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') d--;
          j++;
        }
        val = body.slice(start, j - 1);
      } else if (body[j] === '"') {
        const start = ++j;
        while (j < body.length && body[j] !== '"') j++;
        val = body.slice(start, j++);
      } else {
        const start = j;
        while (j < body.length && body[j] !== ',') j++;
        val = body.slice(start, j);
      }
      f[fm[1].toLowerCase()] = val.replace(/\s+/g, ' ').trim();
      fre.lastIndex = j;
    }
    const x = k => latexText(f[k] || '');
    out.push({ language: x('language') || x('langid'), title: x('title'), year: (f.year || f.date || '').match(/\d{4}/)?.[0] || '', journal: x('journal') || x('journaltitle') || x('booktitle'),
               authors: (f.author || '').split(/\s+and\s+/i).map(latexText).filter(Boolean),
               doi: x('doi'), pmid: x('pmid'), abstract: x('abstract'), url: x('url'), volume: x('volume'), issue: x('number') || x('issue'), pages: x('pages').replace(/–/g, '-'),
               keywords: x('keywords').split(/[;,]\s*/).filter(Boolean),
               raw: t.slice(m.index, i) });
  }
  return { records: out.map((r, i) => mk(i, r)), format: 'BibTeX', errors };
}

function csl(t) {
  let j; try { j = JSON.parse(t); } catch { return { records: [], format: 'CSL-JSON', errors: 1 }; }
  const arr = (Array.isArray(j) ? j : j?.items && Array.isArray(j.items) ? j.items : [j]).filter(r => r && typeof r === 'object');
  const out = arr.map(r => ({
    language: r.language, title: Array.isArray(r.title) ? r.title[0] : r.title,
    year: String(r.issued?.['date-parts']?.[0]?.[0] ?? String(r.issued?.raw || r.issued?.literal || '').match(/\d{4}/)?.[0] ?? ''),
    journal: Array.isArray(r['container-title']) ? r['container-title'][0] : r['container-title'],
    journalAbbr: Array.isArray(r['container-title-short']) ? r['container-title-short'][0] : r['container-title-short'] || r.journalAbbreviation,
    authors: (r.author || []).map(a => a.literal || [a.family, a.given].filter(Boolean).join(', ')).filter(Boolean),
    doi: r.DOI || r.doi, pmid: r.PMID || r.pmid, abstract: r.abstract, url: r.URL || r.url,
    volume: r.volume, issue: r.issue, pages: r.page,
    raw: r,
  }));
  return { records: out.map((r, i) => mk(i, r)), format: 'CSL-JSON', errors: 0 };
}

// ---- EndNote tagged (.enw, refer): "%T Title", "%A Author", a blank line between records.
function refer(t) {
  const records = [];
  for (const block of t.split(/\r?\n\s*\r?\n/)) {
    const r = { authors: [], keywords: [], raw: block.split(/\r?\n/) }; let last = null;
    for (const line of r.raw) {
      const m = /^%(\S)\s?(.*)$/.exec(line);
      if (!m) { if (last && line.trim()) r[last] = `${r[last]} ${line.trim()}`; continue; }
      const [, k, v0] = m, v = v0.trim(); last = null;
      if (k === 'T') { r.title = v; last = 'title'; }
      else if (k === 'A') r.authors.push(v);
      else if (k === 'D') r.year = (v.match(/\d{4}/) || [''])[0];
      else if (k === 'J' || k === 'B') r.journal ||= v;
      else if (k === 'R') r.doi = v;
      else if (k === 'X') { r.abstract = v; last = 'abstract'; }
      else if (k === 'V') r.volume = v; else if (k === 'N') r.issue = v; else if (k === 'P') r.pages = v;
      else if (k === 'K') r.keywords.push(...v.split(/[;\r]/).map(x => x.trim()).filter(Boolean));
      else if (k === 'U') r.url ||= v; else if (k === 'G') r.language = v; else if (k === 'M') r.accession = v;
    }
    if (r.title || r.authors.length) records.push(r);
  }
  return { records: records.map((r, i) => mk(i, r)), format: 'EndNote', errors: 0 };
}

// ---- PubMed XML (efetch, "Send to: File, XML") -------------------------------
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi,
  (m, e, d, h) => e ? XML_ENT[e.toLowerCase()] : codePoint(d ? Number(d) : parseInt(h, 16))).replace(/\s+/g, ' ').trim();
const tagIn = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? m[1] : ''; };
const tagsIn = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))];
function pubmedXml(t) {
  const records = []; let errors = 0;
  for (const [, art] of tagsIn(t, 'PubmedArticle')) {
    const pmid = xmlText(tagIn(art, 'PMID'));
    const title = xmlText(tagIn(art, 'ArticleTitle') || tagIn(art, 'VernacularTitle'));
    if (!pmid && !title) { errors++; continue; }
    const authors = tagsIn(tagIn(art, 'AuthorList'), 'Author').map(([, a]) => {
      const coll = xmlText(tagIn(a, 'CollectiveName'));
      if (coll) return coll;
      const last = xmlText(tagIn(a, 'LastName')), fore = xmlText(tagIn(a, 'ForeName')) || xmlText(tagIn(a, 'Initials'));
      return [last, fore].filter(Boolean).join(', ');
    }).filter(Boolean);
    const abs = tagsIn(tagIn(art, 'Abstract'), 'AbstractText').map(([whole, body]) => {
      const label = /Label="([^"]+)"/.exec(whole.slice(0, whole.indexOf('>')))?.[1];
      return `${label ? `${label}: ` : ''}${xmlText(body)}`;
    }).join('\n');
    const date = tagIn(art, 'PubDate');
    const year = xmlText(tagIn(date, 'Year')) || (xmlText(tagIn(date, 'MedlineDate')).match(/\d{4}/) || [''])[0];
    const doi = /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/.exec(art)?.[1] || /<ELocationID EIdType="doi"[^>]*>([^<]+)</.exec(art)?.[1] || '';
    records.push({ title, authors, abstract: abs, year, pmid, accession: pmid, doi: xmlText(doi), database: 'PubMed',
      journal: xmlText(tagIn(tagIn(art, 'Journal'), 'Title')), journalAbbr: xmlText(tagIn(art, 'ISOAbbreviation')),
      language: xmlText(tagIn(art, 'Language')), volume: xmlText(tagIn(art, 'Volume')), issue: xmlText(tagIn(art, 'Issue')),
      pages: xmlText(tagIn(art, 'MedlinePgn')), keywords: tagsIn(art, 'Keyword').map(([, k]) => xmlText(k)).filter(Boolean),
      mesh: tagsIn(tagIn(art, 'MeshHeadingList'), 'DescriptorName').map(([, d]) => xmlText(d)).filter(Boolean),
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '', raw: art.length > 20000 ? art.slice(0, 20000) : art });
  }
  return { records: records.map((r, i) => mk(i, r)), format: 'PubMed XML', errors };
}

// ---- EndNote XML ("Export, XML") ---------------------------------------------
// Each record's text sits inside <style> runs, which xmlText strips. EndNote's
// own tags are read by name; a field a library did not fill is simply absent.
function endnoteXml(t) {
  const records = []; let errors = 0;
  for (const [, rec] of t.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const title = xmlText(tagIn(tagIn(rec, 'titles'), 'title'));
    if (!title) { errors++; continue; }
    const authors = tagsIn(tagIn(tagIn(rec, 'contributors'), 'authors'), 'author').map(([, a]) => xmlText(a)).filter(Boolean);
    const dates = tagIn(rec, 'dates');
    const year = (xmlText(tagIn(dates, 'year')).match(/\d{4}/) || [''])[0];
    const periodical = tagIn(rec, 'periodical');
    const pages = xmlText(tagIn(rec, 'pages'));
    records.push({ title, authors, year,
      journal: xmlText(tagIn(periodical, 'full-title')) || xmlText(tagIn(tagIn(rec, 'titles'), 'secondary-title')),
      journalAbbr: xmlText(tagIn(periodical, 'abbr-1')),
      doi: xmlText(tagIn(rec, 'electronic-resource-num')), accession: xmlText(tagIn(rec, 'accession-num')),
      abstract: xmlText(tagIn(rec, 'abstract')), volume: xmlText(tagIn(rec, 'volume')), issue: xmlText(tagIn(rec, 'number')), pages,
      language: xmlText(tagIn(rec, 'language')), database: xmlText(tagIn(rec, 'remote-database-name')),
      url: xmlText(tagIn(tagIn(tagIn(rec, 'urls'), 'related-urls'), 'url')),
      keywords: tagsIn(tagIn(rec, 'keywords'), 'keyword').map(([, k]) => xmlText(k)).filter(Boolean),
      raw: rec.length > 20000 ? rec.slice(0, 20000) : rec });
  }
  for (const r of records) if (/pubmed|medline/i.test(r.database || '') && /^\d+$/.test(r.accession || '')) r.pmid = r.accession;
  return { records: records.map((r, i) => mk(i, r)), format: 'EndNote XML', errors };
}

// ---- CSV and tab-delimited exports -------------------------------------------
// Columns are mapped by their headers, as Rayyan, Covidence, Scopus, Web of
// Science (tab-delimited, two-letter tags) and EndNote name them.
const COLS = {
  title: ['title', 'article title', 'document title', 'ti', 'primary title'],
  authors: ['authors', 'author', 'author full names', 'author(s)', 'au', 'af'],
  year: ['year', 'publication year', 'published year', 'py', 'pubyear', 'date'],
  journal: ['journal', 'source title', 'source', 'journal/book', 'so', 'secondary title', 'publication title', 'journal title'],
  journalAbbr: ['journal abbreviation', 'abbreviated source title', 'j9', 'ji'],
  doi: ['doi', 'di'], pmid: ['pmid', 'pubmed id', 'pm', 'pubmed_id'],
  abstract: ['abstract', 'ab'], volume: ['volume', 'vl'], issue: ['issue', 'number', 'is'],
  pages: ['pages', 'page', 'pg'], pageStart: ['page start', 'bp'], pageEnd: ['page end', 'ep'],
  language: ['language', 'language of original document', 'la'], url: ['url', 'link'],
  keywords: ['keywords', 'author keywords', 'de', 'tags'],
};
function splitRows(text, delim, limits = {}) {
  const rows = []; let row = [], cell = '', q = false, cells = 0;
  const pushCell = () => { if (row.length >= (limits.maxColumns ?? Infinity) || ++cells > (limits.maxCells ?? Infinity)) throw new Error('The table exceeds the supported column or cell limit'); row.push(cell); cell = ''; };
  const pushRow = () => { if (rows.length >= (limits.maxRows ?? Infinity)) throw new Error('The table exceeds the supported row limit'); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushCell(); pushRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) { pushCell(); pushRow(); }
  return rows.filter(r => r.some(c => c.trim()));
}
const headerOf = line => line.toLowerCase().replace(/^﻿/, '').split(/[,\t;]/).map(h => h.replace(/^"|"$/g, '').trim());
function looksTabular(t) {
  const head = headerOf(t.split(/\r?\n/, 1)[0] || '');
  return head.length > 2 && head.some(h => COLS.title.includes(h));
}
/** A delimited text as rows of cells; the delimiter (tab, semicolon or comma) is the one its header uses most. */
export function parseDelimited(t, limits = {}) {
  const text = String(t ?? '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  return { rows: splitRows(text, delim, limits), delim };
}
function tabular(t) {
  const { rows, delim } = parseDelimited(t);
  return recordsFromRows(rows, delim === '\t' ? 'Tab-delimited' : 'CSV');
}
/** Rows of cells (a CSV, or a worksheet) whose header names the columns as the databases do; the first row is the header. */
export function recordsFromRows(rows, format = 'Spreadsheet') {
  rows = (rows || []).map(r => (r || []).map(c => String(c ?? ''))).filter(r => r.some(c => c.trim()));
  if (rows.length < 2) return { records: [], format, errors: rows.length ? 1 : 0 };
  const head = rows[0].map(h => h.replace(/^﻿/, '').trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(COLS)) { const i = head.findIndex(h => names.includes(h)); if (i >= 0) col[k] = i; }
  if (col.title == null) return { records: [], format, errors: rows.length - 1 };
  const get = (r, k) => col[k] == null ? '' : String(r[col[k]] ?? '').trim();
  let errors = 0; const out = [];
  for (const r of rows.slice(1)) {
    const title = get(r, 'title');
    if (!title) { errors++; continue; }
    const rawAuthors = get(r, 'authors');
    const authors = rawAuthors.includes(';') ? rawAuthors.split(';').map(x => x.trim()).filter(Boolean) : authorList(rawAuthors);
    const pages = get(r, 'pages') || [get(r, 'pageStart'), get(r, 'pageEnd')].filter(Boolean).join('-');
    out.push({ title, authors, year: (get(r, 'year').match(/\d{4}/) || [''])[0], journal: get(r, 'journal'), journalAbbr: get(r, 'journalAbbr'),
      doi: get(r, 'doi'), pmid: get(r, 'pmid').replace(/\D/g, ''), abstract: get(r, 'abstract'), volume: get(r, 'volume'), issue: get(r, 'issue'), pages,
      language: get(r, 'language'), url: get(r, 'url'), keywords: get(r, 'keywords').split(/;\s*/).filter(Boolean),
      raw: Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])) });
  }
  return { records: out.map((r, i) => mk(i, r)), format, errors };
}
/** Whether a header row names a title column, as a records export does. */
export const looksLikeRecords = head => (head || []).map(h => String(h ?? '').trim().toLowerCase()).some(h => COLS.title.includes(h));

// ---- journal names, short ---------------------------------------------------
// Registries that carry the ISO abbreviation (PubMed, Europe PMC, Crossref)
// supply it on the record. When none is present a title is shortened by the
// usual word forms — enough to read a table, not a substitute for the
// abbreviation a journal publishes.
const J_WORDS = {
  journal: 'J', journals: 'J', neurosurgery: 'Neurosurg', neurosurgical: 'Neurosurg', neurology: 'Neurol', neurological: 'Neurol',
  oncology: 'Oncol', 'neuro-oncology': 'Neuro Oncol', pathology: 'Pathol', neuropathology: 'Neuropathol', clinical: 'Clin',
  experimental: 'Exp', american: 'Am', british: 'Br', european: 'Eur', international: 'Int', medicine: 'Med', medical: 'Med',
  surgery: 'Surg', surgical: 'Surg', radiology: 'Radiol', neuroradiology: 'Neuroradiol', radiation: 'Radiat', radiotherapy: 'Radiother',
  pediatric: 'Pediatr', paediatric: 'Paediatr', research: 'Res', review: 'Rev', reviews: 'Rev', annals: 'Ann', archives: 'Arch',
  proceedings: 'Proc', science: 'Sci', sciences: 'Sci', biology: 'Biol', biological: 'Biol', reports: 'Rep', report: 'Rep',
  neurochirurgica: 'Neurochir', 'child\u2019s': 'Childs', "child's": 'Childs', nervous: 'Nerv', system: 'Syst', therapy: 'Ther',
  therapeutics: 'Ther', diagnostic: 'Diagn', stereotactic: 'Stereotact', functional: 'Funct', endocrinology: 'Endocrinol',
  endocrine: 'Endocr', practice: 'Pract', molecular: 'Mol', cellular: 'Cell', histopathology: 'Histopathol', ophthalmology: 'Ophthalmol',
  frontiers: 'Front', interdisciplinary: 'Interdiscip', neurosciences: 'Neurosci', neuroscience: 'Neurosci', national: 'Natl', academy: 'Acad', association: 'Assoc', society: 'Soc', psychiatry: 'Psychiatry',
  psychiatric: 'Psychiatr', physiology: 'Physiol', pharmacology: 'Pharmacol', microbiology: 'Microbiol', immunology: 'Immunol',
  genetics: 'Genet', epidemiology: 'Epidemiol', biochemistry: 'Biochem', chemistry: 'Chem', physics: 'Phys', engineering: 'Eng',
  quarterly: 'Q', bulletin: 'Bull', letters: 'Lett', communications: 'Commun', investigation: 'Invest', investigative: 'Invest',
  disease: 'Dis', diseases: 'Dis', disorders: 'Disord', magnetic: 'Magn', resonance: 'Reson', imaging: 'Imaging', treatment: 'Treat',
  management: 'Manag', education: 'Educ', health: 'Health', public: 'Public', family: 'Fam', general: 'Gen', internal: 'Intern',
  emergency: 'Emerg', critical: 'Crit', care: 'Care', anesthesia: 'Anesth', anaesthesia: 'Anaesth', analgesia: 'Analg',
  transplantation: 'Transplant', hematology: 'Hematol', haematology: 'Haematol', nephrology: 'Nephrol', urology: 'Urol',
  gynecology: 'Gynecol', obstetrics: 'Obstet', dermatology: 'Dermatol', rheumatology: 'Rheumatol', cardiology: 'Cardiol',
  cardiovascular: 'Cardiovasc', respiratory: 'Respir', gastroenterology: 'Gastroenterol', hepatology: 'Hepatol',
  orthopaedic: 'Orthop', orthopedic: 'Orthop', rehabilitation: 'Rehabil', otolaryngology: 'Otolaryngol', spine: 'Spine',
  spinal: 'Spinal', cord: 'Cord', tumor: 'Tumor', tumour: 'Tumour', cancer: 'Cancer', brain: 'Brain', childs: 'Childs',
};
const J_DROP = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'de', 'la', 'des', 'et', 'und', 'der', 'die', 'das', 'le', 'a', 'an', '&']);
export function abbreviateJournal(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const out = [];
  for (const w of words) {
    const bare = w.replace(/[.,;:()]/g, ''); const k = bare.toLowerCase();
    if (J_DROP.has(k)) continue;
    out.push(J_WORDS[k] ? J_WORDS[k] : bare);
  }
  return out.join(' ');
}
/** The short journal name for a table cell; the full one belongs in its title attribute. */
export const journalShort = p => p?.journalAbbr || abbreviateJournal(p?.journal || '');

const JOURNAL_ACRONYMS = new Set(['JAMA','BMJ','BMC','PLOS','PNAS','NEJM','JMIR','JBJS','AJNR','AJR','AJSM','JACC','JCI','JCO','IEEE','ACM','ACS','RSC','EMBO','FEBS','FASEB','AIDS','HIV','DNA','RNA','USA','UK','EU','NPJ']);
/** Readable display for capitalized database exports; never alters metadata. */
export function journalDisplay(name) {
  const text=String(name||'').trim();
  if (!text) return text;
  if (text === 'PLOS ONE') return text;
  let word=0;
  return text.replace(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu, token => {
    const first=word++===0,lower=token.toLowerCase();
    if (/\p{Ll}/u.test(token)) return token;
    if (JOURNAL_ACRONYMS.has(token)) return token;
    if (!first && J_DROP.has(lower)) return lower;
    return lower.charAt(0).toUpperCase()+lower.slice(1);
  });
}

// More record formats in (plan B3): Web of Science tagged text, Ovid
// MEDLINE/Embase, the Cochrane Library's CENTRAL export, RefWorks tagged, and
// a plain list of identifiers or links. Each parser returns what
// lib/bib.mjs parseRecords returns — { records, format, errors } — with
// records in the same shape, so the library imports them without branching.
//
// Every record keeps its raw lines, so a field the parser does not read is
// still there. Where an export names the database it came from, the record
// says so (`database`), and PRISMA counts it under that name.
//
// The item-type and study-design helpers at the end read any record: one of
// these, or one lib/bib.mjs parsed (RIS TY, MEDLINE PT, CSL type, BibTeX
// entry type, Scopus/WoS spreadsheet columns).
import { authorList, familyName, importKey } from './bib.mjs';
import { normalizeLanguage } from './languages.mjs';

const cleanDoi = d => String(d || '').trim()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '').trim();
const yearOf = v => (String(v ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || [''])[0];
const squash = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const splitList = v => String(v || '').split(/\s*;\s*/).map(x => x.trim()).filter(Boolean);
const uniq = xs => [...new Set(xs.filter(Boolean))];
const pagesOf = (start, end) => {
  const s = squash(start), e = squash(end);
  return s && e && e !== s ? `${s}-${e}` : s || e;
};

/**
 * One record in the shape lib/bib.mjs builds: a key that de-duplicates across
 * imports (DOI, else PMID, else title/year/first author), a short label, and
 * only the fields the source supplied. `type` is the normalised item type.
 */
export function extraRecord(r) {
  const doi = cleanDoi(r.doi), authors = authorList(r.authors).map(squash).filter(Boolean);
  const title = squash(r.title), year = yearOf(r.year);
  const pmid = String(r.pmid || '').replace(/\D/g, '');
  const first = authors[0] ? familyName(authors[0]) : '';
  const out = {
    key: r.key || importKey({ doi, pmid, title, year, authors }),
    label: first && year ? `${first} ${year}` : (title || 'Untitled').slice(0, 40),
    title: title || 'Untitled', year, journal: squash(r.journal), authors,
    language: normalizeLanguage(r.language), raw: r.raw ?? null,
  };
  const opt = {
    database: r.database, doi, pmid, abstract: String(r.abstract || '').trim(), accession: squash(r.accession),
    journalAbbr: squash(r.journalAbbr), url: squash(r.url), volume: squash(r.volume), issue: squash(r.issue), pages: squash(r.pages),
    publisher: squash(r.publisher), isbn: squash(r.isbn), source: r.source,
  };
  for (const [k, v] of Object.entries(opt)) if (v) out[k] = v;
  const kw = uniq((r.keywords || []).map(squash)), mesh = uniq((r.mesh || []).map(squash)), pt = uniq((r.pubTypes || []).map(squash));
  if (kw.length) out.keywords = kw;
  if (mesh.length) out.mesh = mesh;
  if (pt.length) out.pubTypes = pt;
  const eds = authorList(r.editors).map(squash).filter(Boolean);
  if (eds.length) out.editors = eds;
  const type = normaliseType({ ...out, sourceType: r.sourceType });
  if (type) out.type = type;
  if (r.sourceType) out.sourceType = squash(r.sourceType);
  return out;
}

// ---- Web of Science plain text (.ciw, .txt) -----------------------------------
// "FN Clarivate Analytics Web of Science", then two-letter tags; a value
// continues on lines indented by three spaces; "ER" ends a record, "EF" the file.
const WOS_MULTI = new Set(['AU', 'AF', 'CA', 'C1', 'CR', 'BE', 'BF']);
export const sniffWos = t => /^﻿?FN (Clarivate|Thomson|ISI)/m.test(t)
  || (/^PT [JBSP]\s*$/m.test(t) && /^(AU|TI) \S/m.test(t) && /^ER\s*$/m.test(t))
  || /^UT (WOS|ISI):/m.test(t);

export function parseWos(text) {
  const records = []; let errors = 0, cur = null, last = null;
  const close = () => {
    if (!cur) return;
    if (cur.f.TI || cur.f.AU) records.push(wosRecord(cur)); else errors++;
    cur = null; last = null;
  };
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^(FN|VR|EF)\b/.test(line)) { if (/^EF/.test(line)) close(); continue; }
    if (/^ER\s*$/.test(line)) { close(); continue; }
    const m = /^([A-Z][A-Z0-9]) (.*)$/.exec(line);
    if (m) {
      if (!cur) cur = { f: {}, raw: [] };
      cur.raw.push(line);
      const [, tag, v] = m; last = tag;
      if (WOS_MULTI.has(tag)) (cur.f[tag] ||= []).push(v.trim());
      else cur.f[tag] = cur.f[tag] ? `${cur.f[tag]} ${v.trim()}` : v.trim();
      continue;
    }
    if (/^ {2,3}\S/.test(line) && cur && last) {
      cur.raw.push(line);
      const v = line.trim();
      if (WOS_MULTI.has(last)) cur.f[last].push(v);
      else cur.f[last] = `${cur.f[last]} ${v}`;
      continue;
    }
    if (line.trim() && !cur) errors++;
  }
  close();
  return { records, format: 'Web of Science', errors };
}

function wosRecord({ f, raw }) {
  const dt = splitList(f.DT);
  return extraRecord({
    title: f.TI, authors: (f.AF?.length ? f.AF : f.AU || []).concat(f.CA || []),
    journal: f.SO, journalAbbr: f.JI || f.J9, year: f.PY || f.EA || f.PD,
    volume: f.VL, issue: f.IS, pages: pagesOf(f.BP, f.EP) || f.AR, doi: f.DI, pmid: f.PM,
    abstract: f.AB, accession: f.UT, language: f.LA, publisher: f.PU, isbn: f.BN,
    keywords: [...splitList(f.DE), ...splitList(f.ID)], pubTypes: dt,
    sourceType: `WOS ${f.PT || ''}${dt.length ? `; ${dt.join('; ')}` : ''}`.trim(),
    database: 'Web of Science', raw,
  });
}

// ---- Ovid MEDLINE / Embase -------------------------------------------------------
// Two display forms. Short: "AU  - Smith J" (or "AU - ...") with records
// begun by "<1>" or "1." lines. Long: a field name on its own line with the
// value indented beneath it, or "Field Name: value" on one line. The long
// names are mapped to the short tags and read by one reader.
const OVID_LONG = {
  'unique identifier': 'UI', 'accession number': 'AN', 'embase accession number': 'AN', 'pubmed id': 'PM', 'pmid': 'PM', 'medline pmid': 'PM',
  'authors': 'AU', 'author': 'AU', 'authors full name': 'FA', 'author names full': 'FA', 'full author name': 'FA', 'title': 'TI',
  'source': 'SO', 'year of publication': 'YR', 'publication year': 'YR', 'abstract': 'AB', 'digital object identifier': 'DO', 'doi': 'DO',
  'journal name': 'JN', 'journal title': 'JN', 'volume': 'VO', 'issue/part': 'IP', 'issue': 'IP', 'page': 'PG', 'pages': 'PG',
  'mesh subject headings': 'MH', 'medical subject headings': 'MH', 'emtree heading': 'SH', 'emtree headings': 'SH', 'publication type': 'PT',
  'language': 'LG', 'keyword heading': 'KW', 'keywords': 'KW', 'author keywords': 'KW', 'url': 'UR', 'database': 'DB',
  'date of publication': 'DP', 'publisher': 'PB', 'isbn': 'IB',
};
const OVID_SEP = /^\s*(?:<\d+>|\d+\.)\s*$/;
const OVID_SHORT = /^([A-Z][A-Za-z0-9]{1,3})\s{1,3}-\s?(.*)$/;
const ovidLong = line => {
  const m = /^([A-Za-z][A-Za-z /-]{1,40}?)\s*:\s*(.*)$/.exec(line);
  if (m && OVID_LONG[m[1].trim().toLowerCase()]) return [OVID_LONG[m[1].trim().toLowerCase()], m[2]];
  const k = line.trim().toLowerCase();
  return !/^\s/.test(line) && OVID_LONG[k] ? [OVID_LONG[k], null] : null;
};
export const sniffOvid = t => {
  if (/^TY\s+-\s/m.test(t) || /^PMID-\s*\d/m.test(t)) return false;
  if (/^(VN|DB)\s+-\s.*\b(Ovid|Embase|MEDLINE)/im.test(t)) return true;
  const sep = t.split(/\r?\n/).some(l => OVID_SEP.test(l));
  if (sep && /^(SO|YR|UI|JN)\s{1,3}-\s/m.test(t) && /^(TI|AU)\s{1,3}-\s/m.test(t)) return true;
  // the long form: "Unique Identifier" / "Source" field names on lines of their own
  return /^(Unique Identifier|Accession Number)\s*:?\s*$/m.test(t) && /^Source\s*:?\s*$/m.test(t)
    || /^Unique Identifier\s*:\s*\d/m.test(t) && /^Source\s*:/m.test(t);
};

export function parseOvid(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const short = lines.some(l => OVID_SHORT.test(l));
  const tagOf = l => /^\s/.test(l) ? '' : (OVID_SHORT.exec(l)?.[1] || (!short && ovidLong(l)?.[0]) || '').toUpperCase();
  const blocks = []; let cur = [], first = '';
  const hasSep = lines.some(l => OVID_SEP.test(l));
  for (const l of lines) {
    if (hasSep && OVID_SEP.test(l)) { if (cur.length) blocks.push(cur); cur = []; first = ''; continue; }
    // no numbered separators: a record starts again where its first field repeats
    const tag = tagOf(l);
    if (!hasSep && tag && first && tag === first && !OVID_REPEAT.has(tag)) { blocks.push(cur); cur = []; first = ''; }
    if (tag && !first) first = tag;
    cur.push(l);
  }
  if (cur.length) blocks.push(cur);
  const records = []; let errors = 0;
  for (const block of blocks) {
    const fields = []; let last = null, mode = '';
    for (const line of block) {
      if (!line.trim()) continue;
      const s = !/^\s/.test(line) && OVID_SHORT.exec(line);
      if (s) { last = [s[1].toUpperCase(), s[2].trim()]; fields.push(last); mode = 'short'; continue; }
      const l = !short && !/^\s/.test(line) && ovidLong(line);
      if (l) {
        if (l[1] != null) { last = [l[0], l[1].trim()]; fields.push(last); mode = 'inline'; }
        else { last = [l[0], null]; mode = 'label'; }
        continue;
      }
      if (!last) continue;
      // under a field name each line of a repeated field is one value; anything else wraps
      const v = line.trim();
      if (last[1] == null) { last[1] = v; fields.push(last); }
      else if (mode === 'label' && OVID_REPEAT.has(last[0])) { last = [last[0], v]; fields.push(last); }
      else last[1] = `${last[1]} ${v}`;
    }
    if (!fields.some(([k]) => k === 'TI' || k === 'AU')) { if (block.some(l => l.trim())) errors++; continue; }
    records.push(ovidRecord(fields, block));
  }
  return { records, format: 'Ovid', errors };
}
const OVID_REPEAT = new Set(['AU', 'FA', 'MH', 'SH', 'KW', 'PT']);

/** "Spine. 45(3):123-130, 2020 Feb 01." or Embase's "Spine. 45 (3) (pp 123-130), 2020." */
export function ovidSource(so) {
  const s = squash(so);
  const m = /^(.*?)\.\s+(?:Vol\.?\s*)?([\w-]+)\s*(?:\(([^)]*)\))?\s*(?::\s*([^,]+)|\(pp\s*([^)]*)\))?,?\s*(.*)$/.exec(s);
  if (!m || !/\d/.test(m[2])) return { journal: s.replace(/\.$/, ''), year: yearOf(s) };
  return { journal: m[1].trim(), volume: m[2], issue: m[3] ? m[3].replace(/^Issue\s*/i, '').trim() : '', pages: (m[4] || m[5] || '').replace(/\.$/, '').trim(), year: yearOf(m[6]) };
}
const ovidAuthors = vals => vals.flatMap(v => v.includes(';') ? v.split(';') : [v]).map(x => x.trim().replace(/\.$/, '')).filter(Boolean);
const ovidHeading = h => h.replace(/^\*/, '').split('/')[0].replace(/\s*\[[^\]]*\]\s*$/, '').trim();

function ovidRecord(fields, block) {
  const one = k => fields.find(([x]) => x === k)?.[1] || '';
  const all = k => fields.filter(([x]) => x === k).map(([, v]) => v).filter(Boolean);
  const db = one('DB');
  const so = ovidSource(one('SO'));
  const small = v => /^\d{1,8}$/.test(String(v || '').trim()) ? String(v).trim() : '';
  const medline = /medline|pubmed/i.test(db) || (!db && small(one('UI')));
  const pmid = small(one('PM')) || small(one('UI')) || (medline ? small(one('AN')) : '');
  const mesh = all('MH').map(ovidHeading);
  const emtree = all('SH').map(ovidHeading);
  const pts = all('PT').flatMap(splitList);
  return extraRecord({
    title: one('TI').replace(/(\s*\[(?:Review|Comment|Editorial|Letter|\d+ refs)\])+\s*$/i, '').trim(),
    authors: ovidAuthors(all('FA').length ? all('FA') : all('AU')),
    journal: one('JN') || so.journal, year: one('YR') || yearOf(one('DP')) || so.year,
    volume: one('VO') || so.volume, issue: one('IP') || so.issue, pages: one('PG') || so.pages,
    doi: one('DO'), pmid, accession: one('AN') || one('UI'), abstract: one('AB'),
    language: one('LG'), url: one('UR'), publisher: one('PB'), isbn: one('IB'),
    keywords: [...all('KW').flatMap(splitList), ...mesh, ...emtree], mesh, pubTypes: pts,
    sourceType: pts.length ? `OVID ${pts.join('; ')}` : '',
    database: /embase/i.test(db) ? 'Embase' : db ? db.replace(/\s*<[^>]*>\s*/g, ' ').trim() : 'Ovid', raw: block,
  });
}

// ---- Cochrane Library (CENTRAL) plain text ---------------------------------------
// "Record #1 of 12", then "TAG: value" lines. A value wraps onto untagged lines.
export const sniffCochrane = t => /^Record #\d+ of \d+/m.test(t) || (/^ID: CN-\d+/m.test(t) && /^TI: /m.test(t));
const CO_TAG = /^([A-Z]{2,3}):\s?(.*)$/;
export function parseCochrane(text) {
  const t = String(text).replace(/^﻿/, '');
  const blocks = /^Record #\d+ of \d+/m.test(t) ? t.split(/^Record #\d+ of \d+.*$/m).slice(1) : t.split(/\r?\n\s*\r?\n(?=ID: )/);
  const records = []; let errors = 0;
  for (const block of blocks) {
    const raw = block.split(/\r?\n/).filter(l => l.trim());
    const fields = [];
    for (const line of raw) {
      const m = CO_TAG.exec(line);
      if (m) fields.push([m[1], m[2].trim()]);
      else if (fields.length) fields.at(-1)[1] += ` ${line.trim()}`;
    }
    if (!fields.some(([k]) => k === 'TI')) { if (raw.length) errors++; continue; }
    const one = k => fields.find(([x]) => x === k)?.[1] || '';
    const all = k => fields.filter(([x]) => x === k).map(([, v]) => v);
    const pmid = (/(\d{1,8})/.exec(one('PM')) || [])[1] || '';
    const kw = all('KY').flatMap(splitList).map(ovidHeading);
    const pts = all('PT').flatMap(splitList);
    const so = one('SO');
    records.push(extraRecord({
      title: one('TI'), authors: all('AU').flatMap(v => v.includes(';') ? v.split(';') : [v]),
      journal: so, year: one('YR'), volume: one('VL'), issue: one('NO'), pages: one('PG'),
      doi: one('DOI'), pmid, accession: one('ID'), abstract: one('AB'), url: one('US'), language: one('LA'),
      keywords: kw, mesh: pmid ? kw : [], pubTypes: pts,
      sourceType: pts.length ? `CENTRAL ${pts.join('; ')}` : '',
      database: 'Cochrane CENTRAL', raw,
    }));
  }
  return { records, format: 'Cochrane CENTRAL', errors };
}

// ---- RefWorks tagged ----------------------------------------------------------
// "RT Journal Article" opens a record; two-character tags, a space, the value.
export const sniffRefworks = t => /^RT \S/m.test(t) && /^(A1|T1) \S/m.test(t);
export function parseRefworks(text) {
  const blocks = String(text).replace(/^﻿/, '').split(/^(?=RT \S)/m).filter(b => /^RT /.test(b));
  const records = []; let errors = 0;
  for (const block of blocks) {
    const raw = block.split(/\r?\n/).filter(l => l.trim());
    const fields = [];
    for (const line of raw) {
      const m = /^([A-Z][A-Z0-9]) (.*)$/.exec(line);
      if (m) fields.push([m[1], m[2].trim()]);
      else if (fields.length) fields.at(-1)[1] += ` ${line.trim()}`;
    }
    const one = k => fields.find(([x]) => x === k)?.[1] || '';
    const all = k => fields.filter(([x]) => x === k).map(([, v]) => v);
    if (!one('T1') && !all('A1').length) { errors++; continue; }
    const rt = one('RT');
    const chapter = /section|chapter/i.test(rt);
    records.push(extraRecord({
      title: one('T1'), authors: all('A1').flatMap(v => v.includes(';') ? v.split(';') : [v]),
      journal: one('JF') || (chapter ? one('T2') : '') || one('JO') || one('T2'), journalAbbr: one('JO') && one('JF') ? one('JO') : one('JA'),
      year: one('YR') || yearOf(one('FD')), volume: one('VO'), issue: one('IS'), pages: pagesOf(one('SP'), one('OP')),
      doi: one('DO'), abstract: one('AB'), url: one('UL') || one('LK'), language: one('LA'), accession: one('AN'),
      pmid: /pubmed|medline/i.test(one('DB') || one('DS')) && /^\d{1,8}$/.test(one('AN')) ? one('AN') : '',
      publisher: one('PB'), isbn: /^[\d-]{10,17}X?$/i.test(one('SN')) && !/^\d{4}-\d{3}[\dX]$/i.test(one('SN')) ? one('SN') : '',
      keywords: all('K1').flatMap(splitList), sourceType: `RT ${rt}`,
      database: one('DB') || one('DS') || 'RefWorks', raw,
    }));
  }
  return { records, format: 'RefWorks', errors };
}

// ---- identifiers and links -----------------------------------------------------
const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>]+/g;
/** A DOI as it ends in running text: trailing punctuation dropped, a closing bracket kept only when it closes one. */
function trimDoi(d) {
  let s = decodeURIComponentSafe(d).replace(/[?#].*$/, '');
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:'"\]>}]+$/, '');
    if (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
    s = s.replace(/\/(full|abstract|pdf|epdf|html)$/i, '');
    if (s === before) return s;
  }
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
const isbnOk = raw => {
  const d = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(d)) { let s = 0; for (let i = 0; i < 10; i++) s += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i); return s % 11 === 0 ? d : ''; }
  if (/^97[89]\d{10}$/.test(d)) { let s = 0; for (let i = 0; i < 13; i++) s += Number(d[i]) * (i % 2 ? 3 : 1); return s % 10 === 0 ? d : ''; }
  return '';
};

/**
 * Identifiers in pasted text or a file of them, one per line or mixed with
 * prose: DOIs (bare, "doi:", doi.org and publisher /doi/ links), PMIDs
 * ("PMID: 123", PubMed links, or a line that is only a number), PMCIDs,
 * ClinicalTrials.gov NCT numbers, ISBNs (checksum-valid) and any other link.
 * Each list is de-duplicated (DOIs ignoring case) and keeps first-seen order.
 */
export function extractIdentifiers(text) {
  const s = String(text || '');
  const dois = [], pmids = [], pmcids = [], nctIds = [], isbns = [], urls = [];
  const push = (list, v, fold = x => x) => { if (v && !list.some(x => fold(x) === fold(v))) list.push(v); };
  const lower = x => x.toLowerCase();
  let rest = s.replace(/https?:\/\/[^\s"<>]+/gi, u0 => {
    let url = u0;
    for (;;) {
      const before = url;
      url = url.replace(/[.,;:'"\]>}]+$/, '');
      if (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
      if (url === before) break;
    }
    let m;
    if ((m = /(?:doi\.org|\/doi(?:\/(?:full|abs|abstract|pdf|epdf|epub))?)\/(10\.\d{4,9}\/.+)$/i.exec(url))) push(dois, trimDoi(m[1]), lower);
    else if ((m = /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,8})\b/i.exec(url))) push(pmids, m[1]);
    else if ((m = /(?:ncbi\.nlm\.nih\.gov\/pmc\/articles|pmc\.ncbi\.nlm\.nih\.gov\/articles|europepmc\.org\/article\/PMC|europepmc\.org\/abstract\/PMC)\/(PMC\d+)/i.exec(url))) push(pmcids, m[1].toUpperCase());
    else if ((m = /europepmc\.org\/(?:article|abstract)\/MED\/(\d{1,8})\b/i.exec(url))) push(pmids, m[1]);
    else if ((m = /clinicaltrials\.gov\/.*?(NCT\d{8})\b/i.exec(url))) push(nctIds, m[1].toUpperCase());
    else if ((m = /\/(10\.\d{4,9}\/[^?#\s]+)/.exec(url))) push(dois, trimDoi(m[1]), lower);
    else push(urls, url);
    return ' ';
  });
  rest = rest.replace(/\b(?:doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/gi, (m, d) => { push(dois, trimDoi(d), lower); return ' '; });
  rest = rest.replace(/\bPMCID\s*:?\s*(?:PMC)?(\d{4,9})\b|\bPMC(\d{4,9})\b/gi, (m, a, b) => { push(pmcids, `PMC${a || b}`); return ' '; });
  rest = rest.replace(/\b(?:PMID|PubMed\s*ID)\s*[:#]?\s*(\d{1,8})\b/gi, (m, id) => { push(pmids, id); return ' '; });
  for (const m of rest.matchAll(/\b(NCT\d{8})\b/gi)) push(nctIds, m[1].toUpperCase());
  for (const m of rest.matchAll(/\bISBN(?:-1[03])?:?\s*([\d][\d\s-]{8,16}[\dXx])\b/g)) { const v = isbnOk(m[1]); if (v) push(isbns, v); }
  for (const m of rest.matchAll(/\b(97[89][-\s]?\d{1,5}[-\s]\d{1,7}[-\s]\d{1,7}[-\s]\d)\b/g)) { const v = isbnOk(m[1]); if (v) push(isbns, v); }
  for (const line of rest.split(/\r?\n/)) { const m = /^\s*(\d{1,8})\s*[.,;]?\s*$/.exec(line); if (m) push(pmids, m[1]); }
  return { dois, pmids, pmcids, nctIds, isbns, urls };
}
const idCount = ids => Object.values(ids).reduce((n, l) => n + l.length, 0);

/**
 * A text that is a list of identifiers or links: most of its lines carry one
 * and it has no tagged-record structure.
 */
export function sniffIdentifiers(t) {
  const lines = String(t || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length || lines.length > 20000) return false;
  if (/^(TY|AU|PT|FN|RT|TI|PMID)\s*-?\s/m.test(t) && !/^\s*(10\.|https?:|PMID)/i.test(lines[0])) return false;
  const hits = lines.filter(l => idCount(extractIdentifiers(l)) > 0).length;
  return hits >= Math.max(1, Math.ceil(lines.length * 0.6));
}

// ---- dispatch -------------------------------------------------------------------
/**
 * Which of these formats a text is in, or null. The tagged formats are
 * checked before RIS (Ovid's short form also writes "AU  - "); an identifier
 * list is best checked last, after every record format has declined it, so
 * `identifiers: false` leaves it out.
 */
export function sniffFormat(text, { identifiers = true } = {}) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) return null;
  const head = t.slice(0, 20000);
  if (sniffWos(head)) return 'wos';
  if (sniffCochrane(head)) return 'cochrane';
  if (sniffRefworks(head)) return 'refworks';
  if (sniffOvid(head)) return 'ovid';
  if (identifiers && sniffIdentifiers(t)) return 'identifiers';
  return null;
}

/**
 * Parse a text in whichever of these formats it is. An identifier list has no
 * records until they are looked up (lib/ref-lookup.mjs recordsFromIdentifiers):
 * it returns no records and the identifiers found.
 */
export function parseExtra(text, format = sniffFormat(text)) {
  const t = String(text || '').replace(/^﻿/, '');
  switch (format) {
    case 'wos': return parseWos(t);
    case 'ovid': return parseOvid(t);
    case 'cochrane': return parseCochrane(t);
    case 'refworks': return parseRefworks(t);
    case 'identifiers': return { records: [], format: 'Identifiers', errors: 0, identifiers: extractIdentifiers(t) };
    default: return { records: [], format: 'unknown', errors: 1 };
  }
}

// ---- item types ------------------------------------------------------------------
export const ITEM_TYPES = ['article', 'review', 'trial-registration', 'guideline', 'preprint', 'book', 'chapter', 'conference',
  'thesis', 'report', 'dataset', 'letter', 'editorial', 'other'];

const PREPRINT_SERVERS = /\b(medrxiv|biorxiv|arxiv|chemrxiv|psyarxiv|socarxiv|osf preprints|research square|ssrn|preprints\.org|preprints|authorea|scielo preprints|zenodo|jmir preprints|sneak peek|techrxiv|qeios)\b/i;
const PREPRINT_DOI = /^10\.(1101|21203\/rs|2139\/ssrn|48550\/arxiv|31219\/osf|20944\/preprints|26434\/chemrxiv|22541\/au|31234\/osf|2196\/preprints)/i;
const REGISTRY_URL = /clinicaltrials\.gov|isrctn\.com|trialsearch\.who\.int|anzctr\.org\.au|chictr\.org|clinicaltrialsregister\.eu|euclinicaltrials\.eu|drks\.de|ctri\.nic\.in|umin\.ac\.jp\/ctr|jrct\.niph|irct\.ir|trialregister\.nl|pactr\.samrc|ensaiosclinicos\.gov\.br|cris\.nih\.go\.kr|who\.int\/trialsearch/i;
const REGISTRY_ID = /^(NCT\d{8}|ISRCTN\d{8}|ACTRN\d{14}|ChiCTR[\w-]+|DRKS\d{8}|CTRI\/[\d/]+|EUCTR[\d-]+\w*|\d{4}-\d{6}-\d{2}|jRCT\w+|UMIN\d+|IRCT\w+|NL\d{3,5}|NTR\d+|PACTR\d+|KCT\d+|RBR-\w+)$/i;
const REGISTRY_NAME = /^(ClinicalTrials\.gov|ISRCTN|ICTRP|WHO ICTRP|ANZCTR|ChiCTR|EU Clinical Trials Register|EU CTR|CTIS|DRKS|CTRI|jRCT|UMIN-CTR|IRCT|Netherlands Trial Register|PACTR|CRIS|ReBEC)\b/i;

/** The item-type phrases each source writes, mapped to one list. */
const RIS_TY = {
  JOUR: 'article', JFULL: 'article', MGZN: 'article', INPR: 'article', EJOUR: 'article', ABST: 'conference', SER: 'article',
  BOOK: 'book', EBOOK: 'book', EDBOOK: 'book', CHAP: 'chapter', ECHAP: 'chapter', CONF: 'conference', CPAPER: 'conference',
  THES: 'thesis', RPRT: 'report', GOVDOC: 'report', STAND: 'report', DATA: 'dataset', DBASE: 'dataset', AGGR: 'dataset',
  NEWS: 'other', ELEC: 'other', WEB: 'other', GEN: 'other', UNPB: 'other', PAT: 'other', CTLG: 'other', PCOMM: 'letter', ENCYC: 'chapter', DICT: 'chapter',
};
const CSL_TYPE = {
  'article-journal': 'article', 'journal-article': 'article', book: 'book', 'edited-book': 'book', monograph: 'book', 'reference-book': 'book',
  chapter: 'chapter', 'book-chapter': 'chapter', 'book-section': 'chapter', 'book-part': 'chapter', 'reference-entry': 'chapter', 'entry-encyclopedia': 'chapter', 'entry-dictionary': 'chapter',
  'paper-conference': 'conference', 'proceedings-article': 'conference', proceedings: 'conference', thesis: 'thesis', dissertation: 'thesis',
  report: 'report', 'report-component': 'report', standard: 'report', dataset: 'dataset', 'posted-content': 'preprint', preprint: 'preprint',
  'article-magazine': 'other', 'article-newspaper': 'other', webpage: 'other', post: 'other', 'post-weblog': 'other', 'peer-review': 'other',
};
const BIBTEX_TYPE = {
  article: 'article', book: 'book', booklet: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'conference', conference: 'conference',
  proceedings: 'conference', phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report', dataset: 'dataset',
  misc: 'other', unpublished: 'other', online: 'other', manual: 'report',
};
/** Publication types (PubMed, Embase, WoS DT, CENTRAL PT) that name what an item is; first match wins. */
const PT_TYPE = [
  [/^(practice guideline|guideline|consensus development conference(, nih)?)$/i, 'guideline'],
  [/^preprint$/i, 'preprint'],
  [/^(systematic review|meta-analysis|review|scoping review|short survey|conference review|review; early access)$/i, 'review'],
  [/^(editorial|editorial material)$/i, 'editorial'],
  [/^(letter|comment|note|correspondence)$/i, 'letter'],
  [/^(trial registry record|clinical trial protocol registration|registry record)$/i, 'trial-registration'],
  [/^(meeting abstract|conference abstract|conference paper|proceedings paper|congress|conference proceeding|conference proceedings)$/i, 'conference'],
  [/^(book chapter|chapter)$/i, 'chapter'],
  [/^book$/i, 'book'],
  [/^(dataset|data paper|data set)$/i, 'dataset'],
  [/^(dissertation|thesis)$/i, 'thesis'],
  [/^(technical report|report)$/i, 'report'],
];
const REFWORKS_TYPE = [
  [/journal/i, 'article'], [/book,\s*section|chapter/i, 'chapter'], [/book|monograph/i, 'book'], [/conference|proceedings/i, 'conference'],
  [/dissertation|thesis/i, 'thesis'], [/report/i, 'report'], [/data/i, 'dataset'], [/abstract/i, 'conference'],
];
const WOS_PT = { J: 'article', B: 'book', S: 'article', P: 'other' };

/** Where a record says its type: its RIS TY, BibTeX entry, CSL/Crossref type, EndNote ref-type, a spreadsheet's document-type column. */
function declaredType(p) {
  const raw = p.raw;
  if (typeof p.sourceType === 'string' && p.sourceType) return p.sourceType;
  if (Array.isArray(raw)) {
    const ty = raw.map(String).find(l => /^TY\s+-\s/.test(l));
    if (ty) return `RIS ${ty.replace(/^TY\s+-\s*/, '').trim()}`;
  } else if (raw && typeof raw === 'object') {
    if (raw.type) return `CSL ${raw.type}`;
    const col = raw['document type'] ?? raw.dt ?? raw['publication type'] ?? raw['item type'] ?? raw['reference type'];
    if (col) return `DT ${col}`;
  } else if (typeof raw === 'string') {
    const bib = /^\s*@(\w+)\s*[{(]/.exec(raw);
    if (bib) return `BIBTEX ${bib[1]}`;
    const en = /<ref-type name="([^"]+)"/.exec(raw);
    if (en) return `RT ${en[1]}`;
  }
  return '';
}

/** Publication types a record carries, from its own list or its raw MEDLINE lines / PubMed XML. */
function rawPubTypes(p) {
  const out = [...(Array.isArray(p.pubTypes) ? p.pubTypes : [])];
  const raw = p.raw;
  if (Array.isArray(raw)) for (const l of raw) { const m = /^PT\s*-\s*(.+)$/.exec(String(l)); if (m) out.push(m[1].trim()); }
  else if (typeof raw === 'string') for (const m of raw.matchAll(/<PublicationType\b[^>]*>([^<]+)<\/PublicationType>/g)) out.push(m[1].trim());
  else if (raw && typeof raw === 'object' && typeof raw['document type'] === 'string') out.push(...splitList(raw['document type']));
  return uniq(out);
}

const isRegistration = p => {
  const ids = [p.accession, p.nct, p.key && String(p.key).replace(/^nct-/, '')].filter(Boolean).map(String);
  return /^nct-/.test(String(p.key || '')) || REGISTRY_URL.test(`${p.url || ''} ${p.journal || ''}`)
    || REGISTRY_NAME.test(String(p.journal || '').trim()) || REGISTRY_NAME.test(String(p.source || '').trim())
    || (ids.some(x => REGISTRY_ID.test(x)) && !p.doi && !p.pmid);
};
const isPreprint = p => PREPRINT_DOI.test(cleanDoi(p.doi)) && !/^10\.1101\/(gad|gr|lm|pdb|cshperspect|sqb|mcs|rna)\b/i.test(cleanDoi(p.doi))
  || PREPRINT_SERVERS.test(String(p.journal || '')) || PREPRINT_SERVERS.test(String(p.publisher || '')) && !p.journal;

/**
 * One item type for a record, from whatever its source said: RIS TY, PubMed
 * or Embase publication types, Web of Science PT/DT, a CSL or Crossref type,
 * a BibTeX entry type, a RefWorks RT. A trial register's record is a
 * 'trial-registration' whatever it was exported as; a preprint server's is a
 * 'preprint'. A journal item's publication types refine it to review,
 * guideline, editorial or letter.
 */
export function normaliseType(p = {}) {
  if (p.type && ITEM_TYPES.includes(p.type) && !p.sourceType) return p.type;
  const declared = declaredType(p);
  const [kind, ...rest] = declared.split(' '); const value = rest.join(' ').trim();
  let base = '';
  const ptList = rawPubTypes(p);
  if (kind === 'RIS') base = RIS_TY[value.toUpperCase()] || 'other';
  else if (kind === 'CSL') base = value === 'article' ? (p.journal ? 'article' : 'preprint') : CSL_TYPE[value] || (/review/.test(value) ? 'other' : '');
  else if (kind === 'BIBTEX') base = BIBTEX_TYPE[value.toLowerCase()] || 'other';
  else if (kind === 'WOS') { base = WOS_PT[value[0]] || 'article'; ptList.push(...value.split(';').slice(1).map(x => x.trim())); }
  else if (kind === 'RT') base = (REFWORKS_TYPE.find(([re]) => re.test(value)) || [null, 'other'])[1];
  else if (kind === 'OVID' || kind === 'CENTRAL' || kind === 'DT') ptList.push(...splitList(value));
  else if (p.type && CSL_TYPE[p.type]) base = CSL_TYPE[p.type];
  if (isRegistration(p) || ptList.some(x => /^(trial registry record)$/i.test(x))) return 'trial-registration';
  if (base === 'book' || base === 'chapter' || base === 'thesis' || base === 'dataset') return base;
  if (isPreprint(p) || ptList.some(x => /^preprint$/i.test(x))) return 'preprint';
  for (const [re, t] of PT_TYPE) if (ptList.some(x => re.test(x.trim()))) {
    if (t === 'review' && ptList.some(x => /^(practice guideline|guideline)$/i.test(x))) return 'guideline';
    if (t === 'letter' && ptList.some(x => /^(journal article|article|randomized controlled trial|clinical trial)$/i.test(x)) && !ptList.some(x => /^letter$/i.test(x))) continue;
    return t;
  }
  if (base) return base;
  if (p.journal || p.doi || p.pmid) return 'article';
  return 'other';
}

// ---- study designs ---------------------------------------------------------------
export const DESIGN_TAGS = ['Randomized Controlled Trial', 'Meta-Analysis', 'Systematic Review', 'Cohort Studies', 'Case Reports',
  'Observational Study', 'Clinical Trial', 'Review', 'Guideline'];
const DESIGN_FROM = [
  [/^randomi[sz]ed controlled trial$/i, 'Randomized Controlled Trial'],
  [/^(equivalence trial|pragmatic clinical trial|controlled clinical trial|clinical trial(, phase (i|ii|iii|iv))?|clinical trial, veterinary|adaptive clinical trial|multicenter study and clinical trial)$/i, 'Clinical Trial'],
  [/^meta-?analysis$/i, 'Meta-Analysis'],
  [/^systematic review$/i, 'Systematic Review'],
  [/^cohort studies$/i, 'Cohort Studies'],
  [/^case reports?$/i, 'Case Reports'],
  [/^observational study$/i, 'Observational Study'],
  [/^review$/i, 'Review'],
  [/^(practice guideline|guideline)$/i, 'Guideline'],
];
/**
 * Study-design tags from a record's publication types (PubMed, Embase,
 * CENTRAL, WoS document type) and its MeSH headings, in DESIGN_TAGS order.
 * A heading "about" a design ("Randomized Controlled Trials as Topic") is not
 * the design, and is not read as one.
 */
export function publicationTypes(p = {}) {
  const found = new Set();
  const terms = [...rawPubTypes(p), ...(Array.isArray(p.mesh) ? p.mesh : [])].map(x => String(x).replace(/^\*/, '').split('/')[0].trim());
  const decl = declaredType(p);
  if (/^WOS /.test(decl)) terms.push(...decl.split(';').slice(1).map(x => x.trim()));
  for (const t of terms) {
    if (/as topic$/i.test(t)) continue;
    for (const [re, tag] of DESIGN_FROM) if (re.test(t)) found.add(tag);
  }
  return DESIGN_TAGS.filter(t => found.has(t));
}

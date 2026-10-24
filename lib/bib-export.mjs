// Records out, in the forms reference managers and co-authors read.
//
// RIS and BibTeX carry what the record holds and nothing it does not; a field
// the record lacks is omitted, never filled with a placeholder. CSV is the
// flat form for a spreadsheet.
import { authorList, familyName } from './bib.mjs';

// "123-130", "123–130" (en dash) and "123--130" (BibTeX) are one range.
const pageParts = pages => String(pages).trim().split(/\s*(?:--|[–—-])\s*/).filter(Boolean);
const risAuthors = p => authorList(p.authors).map(a => `AU  - ${a}`).join('\n');
export function toRis(papers) {
  return papers.map(p => [
    'TY  - JOUR',
    p.title ? `TI  - ${p.title}` : '',
    risAuthors(p),
    p.journal ? `JO  - ${p.journal}` : '', p.journalAbbr ? `JA  - ${p.journalAbbr}` : '',
    p.year ? `PY  - ${p.year}` : '', p.volume ? `VL  - ${p.volume}` : '', p.issue ? `IS  - ${p.issue}` : '',
    p.pages ? `SP  - ${pageParts(p.pages)[0]}` : '', p.pages && pageParts(p.pages).length > 1 ? `EP  - ${pageParts(p.pages).pop()}` : '',
    p.doi ? `DO  - ${p.doi}` : '', p.pmid ? `AN  - ${p.pmid}` : '', p.url ? `UR  - ${p.url}` : '',
    p.abstract ? `AB  - ${p.abstract.replace(/\s+/g, ' ')}` : '',
    p.language ? `LA  - ${p.language}` : '',
    p.label ? `ID  - ${p.label}` : '',
    'ER  - ',
  ].filter(Boolean).join('\n')).join('\n\n') + '\n';
}

const bibKey = p => `${(authorList(p.authors)[0] ? familyName(authorList(p.authors)[0]) : 'anon').toLowerCase().replace(/[^a-z]/g, '')}${p.year || ''}${(p.title || '').split(/\s+/).find(w => w.length > 3) || ''}`.replace(/[^a-z0-9]/gi, '');
// Prose fields: every character BibTeX reads as markup. Links and identifiers keep the narrower set (an underscore in a URL is data).
const TEX = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
const bibEsc = s => String(s).replace(/[\\~^]|([{}&%$#_])/g, (m, c) => c ? `\\${c}` : TEX[m]);
const bibLink = s => String(s).replace(/([{}&%])/g, '\\$1');
export function toBibtex(papers) {
  const seen = new Map();
  return papers.map(p => {
    let key = bibKey(p); const n = seen.get(key) || 0; seen.set(key, n + 1); if (n) key += String.fromCharCode(96 + n);
    const f = [
      ['language', p.language], ['title', p.title], ['author', authorList(p.authors).join(' and ')], ['journal', p.journal], ['year', p.year],
      ['volume', p.volume], ['number', p.issue], ['pages', p.pages], ['doi', p.doi], ['pmid', p.pmid], ['url', p.url],
    ].filter(([, v]) => v).map(([k, v]) => `  ${k} = {${['doi', 'pmid', 'url'].includes(k) ? bibLink(v) : bibEsc(v)}}`);
    return `@article{${key},\n${f.join(',\n')}\n}`;
  }).join('\n\n') + '\n';
}

export function toCsv(papers) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['label', 'title', 'authors', 'journal', 'journal_abbr', 'year', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url', 'source', 'language'];
  return [head.join(','), ...papers.map(p => [p.label, p.title, authorList(p.authors).join('; '), p.journal, p.journalAbbr, p.year, p.volume, p.issue, p.pages, p.doi, p.pmid, p.url, p.source, p.language].map(cell).join(','))].join('\n') + '\n';
}

// ---- reference managers: CSL-JSON (Zotero, Mendeley, Pandoc) and EndNote XML -------------------------------------------------------
/** "Smith J" and "Smith, John" as { family, given }. */
function splitAuthor(a) {
  const t = String(a).trim();
  if (t.includes(',')) { const [family, ...rest] = t.split(','); return { family: family.trim(), given: rest.join(',').trim() }; }
  const m = /^(.+?)\s+([A-Z]{1,4}\.?(?:\s*[A-Z]\.?)*)$/.exec(t);
  return m ? { family: m[1], given: m[2] } : { family: t, given: '' };
}
export function toCslJson(papers) {
  return JSON.stringify(papers.map(p => {
    const item = { id: p.label || p.id || p.key, type: 'article-journal', title: p.title || '', author: authorList(p.authors).map(splitAuthor),
      'container-title': p.journal || '', volume: p.volume || '', issue: p.issue || '', page: p.pages || '', DOI: p.doi || '', PMID: p.pmid || '', URL: p.url || '',
      abstract: p.abstract || '', language: p.language || '' };
    if (p.year) item.issued = { 'date-parts': [[Number(p.year) || String(p.year)]] };
    return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));
  }), null, 2) + '\n';
}

const xe = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function toEndnoteXml(papers) {
  const el = (n, v) => (v ? `<${n}>${xe(v)}</${n}>` : '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>\n${papers.map(p => `<record><ref-type name="Journal Article">17</ref-type>`
    + `<contributors><authors>${authorList(p.authors).map(a => `<author>${xe(a)}</author>`).join('')}</authors></contributors>`
    + `<titles>${el('title', p.title)}${el('secondary-title', p.journal)}</titles>`
    + `<periodical>${el('full-title', p.journal)}${el('abbr-1', p.journalAbbr)}</periodical>`
    + `${el('pages', p.pages)}${el('volume', p.volume)}${el('number', p.issue)}${p.year ? `<dates><year>${xe(p.year)}</year></dates>` : ''}`
    + `${el('abstract', p.abstract)}${el('accession-num', p.pmid)}${el('electronic-resource-num', p.doi)}${el('language', p.language)}`
    + `${p.url ? `<urls><related-urls><url>${xe(p.url)}</url></related-urls></urls>` : ''}${el('label', p.label)}</record>`).join('\n')}\n</records></xml>\n`;
}

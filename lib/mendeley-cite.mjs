// Citations and reference lists Mendeley Cite (the Word add-in) reads as its own. Mendeley Cite keeps each citation in a content control
// whose tag is `MENDELEY_CITATION_v3_` + base64 of the citation as CSL JSON (the works cited, with their bibliographic data, and the text
// shown), the list in a control tagged `MENDELEY_BIBLIOGRAPHY`, and the document's style, locale and citations as properties of its web
// extension (word/webextensions). A document written with these opens in the add-in with its citations linked, so a person can refresh,
// restyle or add to them there. lib/docx.mjs reads the same controls back. Pure: no store, no view.
import { lib_bib_names$authorList as authorList, lib_bib_names$familyName as familyName } from "../boot.mjs";

/** A stable UUID-shaped id from a text (FNV-1a over four seeds): the same record gives the same id in every build. */
export function stableUuid(text) {
  const h = seed => { let x = (0x811c9dc5 ^ seed) >>> 0; for (const ch of String(text)) { x ^= ch.codePointAt(0); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, '0'); };
  const s = [1, 2, 3, 4].map(h).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** One author as CSL: \"Di Silvestre, Mario\" -> { family: 'Di Silvestre', given: 'Mario' }. */
export function cslAuthor(name) {
  const n = String(name || '').trim(), fam = familyName(n);
  const given = n.includes(',') ? n.slice(n.indexOf(',') + 1).trim() : n.slice(fam.length).trim();
  return { family: fam, given, 'parse-names': false, 'dropping-particle': '', 'non-dropping-particle': '' };
}

/** A library record as Mendeley's CSL item data. Fields a record lacks are left out. */
export function cslItem(p) {
  const id = stableUuid(p.key || p.id || p.doi || p.title);
  const it = { type: 'article-journal', id, title: String(p.title || '').trim(), author: authorList(p.authors).map(cslAuthor) };
  const put = (k, v) => { if (v != null && String(v).trim() !== '') it[k] = String(v).trim(); };
  put('container-title', p.journal); put('container-title-short', p.journalAbbr);
  put('DOI', p.doi); put('PMID', p.pmid);
  if (p.doi) it.URL = `https://doi.org/${String(p.doi).toLowerCase()}`;
  if (/^\d{4}/.test(String(p.year || ''))) it.issued = { 'date-parts': [[Number(String(p.year).slice(0, 4))]] };
  put('page', p.pages); put('issue', p.issue); put('volume', p.volume);
  return it;
}

/** One citation as Mendeley Cite stores it: `items` CSL item data, `text` what it shows (\"1\", \"[1]\"). */
export function mendeleyCitation(items, text, seed) {
  return {
    citationID: `MENDELEY_CITATION_${stableUuid(`${seed}|${items.map(i => i.id).join(',')}`)}`,
    properties: { noteIndex: 0 }, isEdited: false,
    manualOverride: { isManuallyOverridden: false, citeprocText: String(text), manualOverrideText: '' },
    citationItems: items.map(itemData => ({ id: itemData.id, itemData, isTemporary: false, 'suppress-author': false, composite: false, 'author-only': false })),
  };
}

const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
/** The content control tag of a citation. */
export const mendeleyTag = c => `MENDELEY_CITATION_v3_${b64(JSON.stringify(c))}`;

/** Citation styles Mendeley Cite knows (CSL repository ids), by the app's style id. */
export const MENDELEY_STYLES = {
  ama: { id: 'https://www.zotero.org/styles/american-medical-association', title: 'American Medical Association 11th edition', format: 'numeric' },
  vancouver: { id: 'https://www.zotero.org/styles/vancouver', title: 'Vancouver', format: 'numeric' },
  'vancouver-superscript': { id: 'https://www.zotero.org/styles/vancouver-superscript', title: 'Vancouver (superscript)', format: 'numeric' },
  apa: { id: 'https://www.zotero.org/styles/apa', title: 'American Psychological Association 7th edition', format: 'author-date' },
  harvard: { id: 'https://www.zotero.org/styles/harvard-cite-them-right', title: 'Cite Them Right 12th edition - Harvard', format: 'author-date' },
};

const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * The add-in's parts: its task pane and its web extension with the document's citations, style and locale. Answers `{ parts, rootRel,
 * overrides }` for the package writer: the parts' files, the package relationship to the task panes, and their content types.
 */
export function mendeleyParts(citations, { style = 'ama', locale = 'en-US', modified = 0 } = {}) {
  const st = style && typeof style === 'object' ? style : MENDELEY_STYLES[style] || MENDELEY_STYLES.ama;   // a key, or a style of the catalog ({ id, title, format })
  const props = [
    ['MENDELEY_BIBLIOGRAPHY_IS_DIRTY', 'false'],
    ['MENDELEY_BIBLIOGRAPHY_LAST_MODIFIED', String(modified || 0)],
    ['MENDELEY_CITATIONS', JSON.stringify(citations)],
    ['MENDELEY_CITATIONS_LOCALE_CODE', JSON.stringify(locale)],
    ['MENDELEY_CITATIONS_STYLE', JSON.stringify({ ...st, defaultLocale: locale, isLocaleCodeValid: true })],
  ];
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const ext = `${XML}<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{39C8D315-CF3D-AE41-A718-0743AF5586EE}"><we:reference id="wa104382081" version="1.55.1.0" store="en-US" storeType="OMEX"/><we:alternateReferences><we:reference id="WA104382081" version="1.55.1.0" store="WA104382081" storeType="OMEX"/></we:alternateReferences><we:properties>${props.map(([n, v]) => `<we:property name="${n}" value="${attr(v)}"/>`).join('')}</we:properties><we:bindings/><we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></we:webextension>`;
  const panes = `${XML}<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane dockstate="right" visibility="0" width="350" row="0"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></wetp:taskpane></wetp:taskpanes>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>`;
  return {
    parts: [{ name: 'word/webextensions/taskpanes.xml', data: panes }, { name: 'word/webextensions/_rels/taskpanes.xml.rels', data: rels }, { name: 'word/webextensions/webextension1.xml', data: ext }],
    rootRel: '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes" Target="word/webextensions/taskpanes.xml"/>',
    overrides: [['/word/webextensions/taskpanes.xml', 'application/vnd.ms-office.webextensiontaskpanes+xml'], ['/word/webextensions/webextension1.xml', 'application/vnd.ms-office.webextension+xml']],
  };
}

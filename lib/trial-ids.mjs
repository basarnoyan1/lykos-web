// Trial registration numbers a record names (1 Nov 2026). The Cochrane Library's RIS of a register's entry (CENTRAL takes them from
// ClinicalTrials.gov and WHO ICTRP) carries no DOI or PMID: its accession is the CN- number, and the registration number sits in
// JA (the register's link: "https://clinicaltrials.gov/show/NCT01973764", "https://trialsearch.who.int/Trial2.aspx?TrialID=ISRCTN45687883"),
// in C3 ("CTgov NCT01973764", "ICTRP EUCTR2009‐012338‐56‐FR") and as the only author ("NCT01973764,"). Read from there, the CENTRAL copy
// of a ClinicalTrials.gov record is keyed by its NCT number (lib/bib.mjs) and matched to the register's record (lib/record-match.mjs).

// one registration number as written by any register or database: Unicode hyphens as "-", no trailing comma, JPRN- (ICTRP's prefix
// for the Japanese registers) and EudraCT's "eudract_number:" out
export function normTrialId(v) {
  let t = String(v ?? '').replace(/[‐-―−­]/g, '-').trim().replace(/[.,;:]+$/, '');
  t = t.replace(/^eudract_number:\s*/i, '').replace(/^JPRN-(?=(?:UMIN|jRCT|JapicCTI|JMA))/i, '');
  return /^[A-Za-z0-9][A-Za-z0-9/._-]{4,40}$/.test(t) && /\d/.test(t) ? t : '';
}
/** The form two numbers are compared in (registers differ in case: "jRCTs…", "JRCTS…"). */
export const trialIdKey = v => normTrialId(v).toUpperCase();

const NCT = /^NCT\d{8}$/i;
// a registration number standing alone (an accession, an author): the registers' own patterns, so a word or a CN- number is not one
const REGISTRY_ID = /^(?:NCT\d{8}|ISRCTN\d{8}|ACTRN\d{14}|ChiCTR(?:-[A-Z]{2,4}-)?\d{6,}|DRKS\d{8}|CTRI\/\d{4}\/\d{2,3}\/\d{3,}|EUCTR\d{4}-\d{6}-\d{2}(?:-[A-Za-z/-]+)?|CTIS\d{4}-\d{6}-\d{2}-\d{2}|\d{4}-\d{6}-\d{2}(?:-[A-Z]{2})?|jRCTs?\d{9,}|UMIN\d{9}|IRCT\d{8,}N\d{1,3}|NL-OMON\d+|NL\d{3,5}|NTR\d{3,}|PACTR\d{15}|KCT\d{7}|RBR-[0-9a-z]{6,8}|TCTR\d{11}|SLCTR\/\d{4}\/\d{3}|PER-\d{3}-\d{2}|ITMCTR\d{10})$/i;
export const isTrialId = v => REGISTRY_ID.test(normTrialId(v));
// a register's link: the number in its path or query
const LINKS = [
  /clinicaltrials\.?gov\/(?:study|show|ct2\/show)\/(NCT\d{8})\b/i,
  /trialsearch\.who\.int\/Trial2?\.aspx\?TrialID=([^&#\s]+)/i,
  /who\.int\/trialsearch\/Trial2?\.aspx\?TrialID=([^&#\s]+)/i,
  /isrctn\.com\/(ISRCTN\d{8})\b/i,
  /clinicaltrialsregister\.eu\/ctr-search\/search\?query=eudract_number:([0-9‐-]+(?:[‐-][A-Z]{2})?)/i,
];
const fromLink = v => { for (const re of LINKS) { const m = re.exec(String(v || '')); if (m) { try { return normTrialId(decodeURIComponent(m[1])); } catch { return normTrialId(m[1]); } } } return ''; };
// CENTRAL's C3 source line: "CTgov NCT…", "ICTRP …" (PUBMED, EMBASE and CINAHL lines name a database's record, not a registration)
const fromC3 = v => { const m = /^(?:CTgov|ICTRP)\s+(\S+)/.exec(String(v || '').trim()); return m ? normTrialId(m[1]) : ''; };

/**
 * The registration numbers a record names, each once, in the order found: its trialIds, its key (nct-…), its accession and only author
 * when they are a registration number, its links (JA, journal, url) and CENTRAL's C3 lines when its raw lines are still there. A
 * record with a DOI or a PMID is a report, not a registration, and names none here (its abstract's "NCT…" is a link, not its identity).
 */
export function trialIdsOf(p = {}) {
  if (String(p.doi || '').trim() || /^\d+$/.test(String(p.pmid || '').trim())) return [];
  const out = [], seen = new Set();
  const add = v => { const t = normTrialId(v), k = t.toUpperCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } };
  for (const v of Array.isArray(p.trialIds) ? p.trialIds : []) add(v);
  const key = String(p.key || p.id || '');
  if (/^nct-NCT\d{8}$/i.test(key)) add(key.slice(4));
  if (isTrialId(p.accession)) add(p.accession);
  const authors = Array.isArray(p.authors) ? p.authors : [];
  if (authors.length === 1 && isTrialId(authors[0])) add(authors[0]);
  for (const v of [p.journalAbbr, p.journal, p.url]) add(fromLink(v));
  for (const line of Array.isArray(p.raw) ? p.raw : []) {
    const m = /^(C3|JA)\s+-\s?(.*)$/.exec(String(line).trim());
    if (m) add(m[1] === 'C3' ? fromC3(m[2]) : fromLink(m[2]));
  }
  // an EU CTR entry is one member state's ("EUCTR2011-003669-14-ES"; ICTRP lists each country's apart): the bare EudraCT number its
  // link gives is left out beside it, so the country entries of one trial do not read as one record
  const country = new Set(out.map(t => /^EUCTR(\d{4}-\d{6}-\d{2})-/i.exec(t)?.[1]).filter(Boolean));
  return out.filter(t => !(/^\d{4}-\d{6}-\d{2}(?:-[A-Z]{2})?$/i.test(t) && country.has(t.slice(0, 14))));
}
/** The record's NCT number, if it names one (ClinicalTrials.gov's, or another register's or CENTRAL's copy of it). */
export const nctIn = p => (trialIdsOf(p).find(t => NCT.test(t)) || '').toUpperCase();
/** The registration numbers a RIS record's lines give (C3, JA, a lone author), for the import to keep as the record's trialIds. */
export function risTrialIds({ c3 = [], journalAbbr = '', journal = '', url = '', authors = [], accession = '' } = {}) {
  return trialIdsOf({ raw: c3.map(v => `C3  - ${v}`), journalAbbr, journal, url, authors, accession });
}

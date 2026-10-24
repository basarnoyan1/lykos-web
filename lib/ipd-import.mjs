// A patient-level review's master list, read into the project (plan §IPD
// import, §PRISMA-IPD).
//
// Some reviews keep one workbook with a row per patient and, on every row, the
// review's own decision about the report the patient came from: the first
// author, year, DOI and title; the case number; Include or Exclude with the
// reason; the patient's extent of resection, follow-up, event status and
// adjuvant treatment; and helper columns the review's scripts read. Reading
// that as a screening sheet loses the patients; reading it as a patient table
// keeps 185 excluded reports as "patients". This module reads it as both:
//
//   records     one per report (the DOI, else the PMID, else the title, as
//               the library keys them)
//   decisions   the report's Include / Exclude and its reason, recorded at
//               the full-text stage, only where the project has none
//   patients    one per Include row, with the study it came from
//   columns     the patient columns the workbook needs, with the analysis
//               roles set (group, time, event)
//
// Nothing is guessed: a follow-up that is not a number, an event status that
// says neither, an extent of resection or adjuvant treatment of an unknown
// form leaves the cell as the workbook has it and is counted in `notes`, and
// the workbook's own helper columns (a follow-up in months, an event flag) are
// checked against what is read from its text, not trusted over it.
//
// Pure: rows in, plain objects out. `applyIpdList` mutates a project state it
// is handed, so the app calls it inside `update` and the initialiser on its
// own copy.
import { DEFAULT_COLUMNS } from './ipd.mjs';
import { importKey, authorList, familyName } from './bib.mjs';
import { libraryIndex } from './search-library.mjs';
import { ipdAdoption, refOf } from './drift.mjs';
import { inferType, columnIdOf } from './ipd-merge.mjs';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cell = (r, i) => i >= 0 ? String(r?.[i] ?? '').trim() : '';
/** "6 · Include / Exclude", "5-Case no" and "10-Adjuvant treatment( RT, SRS)" without the number in front. */
const plain = h => fold(h).replace(/^\s*\d+\s*[·.\-–:)]?\s*/, '').trim();
const find = (header, ...res) => { for (const re of res) { const i = header.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };

/** The column positions of a master list, by what the headers say; -1 where the workbook has none. */
export function ipdColumnsOf(headerRow = []) {
  const h = headerRow.map(plain);
  const raw = headerRow.map(x => fold(x).trim());
  return {
    author: find(h, /^first author/, /^author/), year: find(h, /^year/), doi: find(h, /^doi/, /link/), title: find(h, /^article title/, /^title/),
    caseNo: find(h, /^case ?(no|#|number)/), decision: find(h, /^include ?\/ ?exclude/, /^decision/),
    eor: find(h, /^eor\b/, /extent of resection/), follow: find(h, /^follow.?up/), status: find(h, /^event status/, /^status/),
    adjuvant: find(h, /^adjuvant/), journal: find(h, /^journal/), pmid: find(h, /^pmid/), reason: find(h, /^reason for exclusion/, /^reason/),
    basis: find(h, /^source of the/),
    key: find(raw, /^h_?paper ?key$/), fuMonths: find(raw, /^h_?fu_?months$/), fuEvent: find(raw, /^h_?fu_?event$/),
  };
}

/** Whether a header is a master list: a decision, a title, and at least three of the outcome columns. */
export function looksLikeIpdList(headerRow = []) {
  const c = ipdColumnsOf(headerRow);
  return c.decision >= 0 && c.title >= 0 && [c.eor, c.follow, c.status, c.adjuvant].filter(i => i >= 0).length >= 3;
}

// ---- cells ---------------------------------------------------------------------------
export const EOR_LEVELS = ['GTR', 'STR', 'PR', 'Bx'];
/** GTR, STR, PR or Bx from how a workbook writes it; anything else is left for a person. */
export function eorOf(text) {
  const t = fold(text).trim();
  if (!t) return '';
  if (/^(gtr|gross|total|complete)/.test(t)) return 'GTR';
  if (/^(str|subtotal|sub-total)/.test(t)) return 'STR';
  if (/^(pr\b|partial|near|debulk)/.test(t)) return 'PR';
  if (/^(bx|biops)/.test(t)) return 'Bx';
  return '';
}
export const ADJUVANT_LEVELS = ['None', 'RT', 'SRS'];
/** None, RT or SRS; a patient with both is SRS (the review's rule, said in the notes). `chemo` and `other` are returned as they are, so nothing is folded into a strategy it is not. */
export function adjuvantOf(text) {
  const t = fold(text).trim();
  if (!t || /^(none|no\b|nil|-|n\/a|no adjuvant|observation)/.test(t)) return t ? { value: 'None' } : { value: '' };
  const srs = /srs|radiosurg|gamma ?knife|cyber ?knife|\bgk\b/.test(t), rt = /(^|[^a-z])(rt|xrt|ebrt)([^a-z]|$)|radiother|fraction/.test(t);
  if (srs && rt) return { value: 'SRS', both: true };
  if (srs) return { value: 'SRS' };
  if (rt) return { value: 'RT' };
  if (/chemo|temozolomide/.test(t)) return { value: 'Chemo' };
  return { value: '', unknown: true };
}
export const STRATEGIES = ['GTR alone', 'Incomplete resection alone', 'Incomplete + RT', 'Incomplete + SRS'];
/** The four mutually exclusive strategies of a resection-and-adjuvant review; a combination outside them keeps its own name, so it is counted, not merged. */
export function strategyOf(eor, adjuvant) {
  if (!eor || !adjuvant) return '';
  const inc = eor !== 'GTR';
  if (adjuvant === 'None') return inc ? STRATEGIES[1] : STRATEGIES[0];
  return `${inc ? 'Incomplete' : 'GTR'} + ${adjuvant}`;
}
/** "90 RF" is 90 months and the code RF; the number is what is analysed, the code is kept as recorded. */
export function followUpOf(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:months?|mo\.?|m)?\s*([A-Za-z]{0,4})\s*$/i.exec(String(text ?? ''));
  return m ? { months: Number(m[1].replace(',', '.')), code: m[2].toUpperCase() } : { months: null, code: '' };
}
/** 1 for a progression, recurrence or tumour-attributed death; 0 for no recurrence; null when the words say neither. */
export function eventOf(text) {
  const t = fold(text).trim();
  if (!t) return null;
  if (/^(no (recurrence|progression|evidence|event|regrowth|growth|relapse)|stable|censored|alive|disease[- ]free|without (recurrence|progression))/.test(t)) return 0;
  if (/progress|recurr|regrowth|growth|relapse|tumou?r[- ]attributed|died of the tumou?r|death due to (the )?tumou?r/.test(t)) return 1;
  return null;
}

// ---- the plan ------------------------------------------------------------------------
/** The patient columns this workbook feeds: the defaults, with what a resection-and-adjuvant review adds, and the roles the analysis reads. */
export function ipdColumnSet() {
  const by = new Map(DEFAULT_COLUMNS.map(c => [c.id, c]));
  const pick = id => ({ ...by.get(id) });
  return [
    pick('label'),
    { id: 'year', name: 'Publication year', type: 'number' },
    { id: 'case_no', name: 'Case no.', type: 'text' },
    { id: 'eor', name: 'Extent of resection', type: 'category', levels: EOR_LEVELS },
    { id: 'adjuvant', name: 'Adjuvant treatment', type: 'category', levels: ADJUVANT_LEVELS },
    { ...pick('strategy'), levels: STRATEGIES, role: 'group' },
    { ...pick('time'), role: 'time' },
    { ...pick('event'), role: 'event' },
    pick('outcome'),
    { id: 'fu_code', name: 'Follow-up code', type: 'text' },
    pick('age'), pick('sex'), pick('dose'), pick('volume'),
  ];
}

const isPresentCase = author => /^(present|current|our|institutional)\b/i.test(String(author).trim());

/**
 * A master list's rows as records, decisions, patients and the columns they
 * need. `rows` include the header (the first row with cells); rows below it
 * that carry no Include or Exclude (the helper columns' formulas run on for
 * hundreds of empty rows) are not patients or records.
 */
export function ipdListFromRows(rows = [], { file = '', sheet = '' } = {}) {
  const hi = rows.findIndex(r => (r || []).filter(c => String(c ?? '').trim()).length >= 4);
  if (hi < 0) return { ok: false, reason: 'No header row' };
  const c = ipdColumnsOf(rows[hi]);
  if (c.decision < 0 || c.title < 0) return { ok: false, reason: 'The header has no include/exclude decision and title columns' };
  const notes = {}, checks = { fuMismatch: 0, eventMismatch: 0 };
  // Any other column the workbook has (a dose, an intent, a date of radiosurgery added to the list) comes along as a patient column, by its
  // header; the workbook's helper columns (H_...) and the report-level ones (journal, PMID, reason, the source of a cell) do not.
  const used = new Set(Object.values(c).filter(i => i >= 0));
  const taken = new Set(ipdColumnSet().map(x => x.id));
  const extras = rows[hi].map((h, i) => ({ h: String(h ?? '').trim(), i })).filter(x => x.h && !used.has(x.i) && !/^h_/i.test(x.h))
    .map(x => ({ ...x, id: columnIdOf(x.h.replace(/^\s*\d+\s*[·.\-–:)]?\s*/, ''), taken), name: x.h.replace(/^\s*\d+\s*[·.\-–:)]?\s*/, '') }));
  const records = new Map();          // key → record
  const decisions = new Map();        // key → { decision, reason }
  const patients = [];
  const bump = (k, n = 1) => { notes[k] = (notes[k] || 0) + n; };
  const seen = new Map();             // key → number of patient rows so far, for case labels
  let rowsRead = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dec = fold(cell(r, c.decision)).trim();
    if (!/^(include|exclude)/.test(dec) || !cell(r, c.author)) continue;
    rowsRead++;
    const decision = dec.startsWith('include') ? 'include' : 'exclude';
    const authorCell = cell(r, c.author), year = cell(r, c.year).slice(0, 4);
    const institutional = isPresentCase(authorCell);
    const doiRaw = cell(r, c.doi);
    const doi = /^https?:\/\/(dx\.)?doi\.org\//i.test(doiRaw) || /^10\.\d{4,}\//.test(doiRaw) ? doiRaw : '';
    const rec = institutional
      ? { key: 'present-case', title: 'Institutional patient (present case)', authors: [], year: year || '', journal: '', label: 'Present case', institutional: true }
      : (() => {
        const authors = authorList([authorCell]);
        const title = cell(r, c.title);
        const k = cell(r, c.key) ? `sheet-${fold(cell(r, c.key)).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90)}` : '';
        const key = doi ? importKey({ doi, title, year, authors }) : k || importKey({ title, year, authors, pmid: cell(r, c.pmid) });
        return { key, title: title || 'Untitled', authors, year, journal: cell(r, c.journal), ...(doi ? { doi: doiRaw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase() } : {}),
          ...(cell(r, c.pmid) ? { pmid: cell(r, c.pmid).replace(/\.0$/, '') } : {}), ...(!doi && /^https?:\/\//i.test(doiRaw) ? { url: doiRaw } : {}),
          label: `${authors[0] ? familyName(authors[0]) : 'Study'} ${year}`.trim() };
      })();
    if (!records.has(rec.key)) records.set(rec.key, rec);
    if (!decisions.has(rec.key)) decisions.set(rec.key, { decision, reason: decision === 'exclude' ? cell(r, c.reason) : '' });
    else if (decisions.get(rec.key).decision !== decision) bump('a report with both include and exclude rows');
    if (decision !== 'include') continue;

    // ---- the patient
    const eorText = cell(r, c.eor), eor = eorOf(eorText);
    const adj = adjuvantOf(cell(r, c.adjuvant));
    if (eorText && !eor) bump('an extent of resection of an unknown form');
    if (adj.unknown) bump('an adjuvant treatment of an unknown form');
    if (adj.both) bump('a patient with both RT and SRS, put in SRS');
    const fu = followUpOf(cell(r, c.follow));
    let months = fu.months;
    if (c.fuMonths >= 0 && cell(r, c.fuMonths) !== '') {
      const helper = Number(cell(r, c.fuMonths));
      if (Number.isFinite(helper)) { if (months == null) { months = helper; bump('a follow-up read from the helper column, its own text not being a number'); } else if (Math.abs(helper - months) > 1e-9) checks.fuMismatch++; }
    }
    if (months == null && cell(r, c.follow) && !Number.isFinite(Number(cell(r, c.fuMonths) || NaN))) bump('a follow-up that is not a number');
    const statusText = cell(r, c.status);
    let event = eventOf(statusText);
    if (c.fuEvent >= 0 && cell(r, c.fuEvent) !== '') {
      const helper = Number(cell(r, c.fuEvent));
      if (helper === 0 || helper === 1) { if (event == null) { event = helper; if (statusText) bump('an event status read from the helper column, its words saying neither'); } else if (helper !== event) checks.eventMismatch++; }
    }
    if (event == null && statusText) bump('an event status that says neither');
    const n = (seen.get(rec.key) || 0) + 1; seen.set(rec.key, n);
    const caseNo = cell(r, c.caseNo);
    // The cells these fields were read from, as the workbook has them: what a later comparison with the file starts from (plan §4.15d).
    const raw = {};
    for (const [field, col] of [['case_no', c.caseNo], ['year', c.year], ['eor', c.eor], ['adjuvant', c.adjuvant], ['time', c.follow], ['outcome', c.status]]) if (col >= 0) raw[field] = { c: refOf(i, col), t: cell(r, col) };
    patients.push({ key: rec.key, row: i + 1, raw, cells: {
      label: caseNo && caseNo !== '1' ? `${rec.label}, case ${caseNo}` : rec.label,
      year: rec.year, case_no: caseNo, eor: eor || eorText, adjuvant: adj.value || cell(r, c.adjuvant),
      strategy: strategyOf(eor, adj.value), time: months == null ? '' : String(months), event: event == null ? '' : String(event),
      outcome: statusText, fu_code: fu.code, ...Object.fromEntries(extras.map(x => [x.id, cell(r, x.i)]).filter(([, v]) => v !== '')) } });
  }
  // A report with several patients gets a case number in every label, the first included.
  const perKey = new Map(); for (const p of patients) perKey.set(p.key, (perKey.get(p.key) || 0) + 1);
  for (const p of patients) if (perKey.get(p.key) > 1 && !/(?: ·|,) case [^·,]+$/.test(p.cells.label)) p.cells.label = `${records.get(p.key).label}, case ${p.cells.case_no || 1}`;
  const list = [...records.values()];
  // Two reports by the same first author in the same year are told apart as a library does: "Yao 2020a", "Yao 2020b".
  const byLabel = new Map();
  for (const r of list) byLabel.set(r.label, [...(byLabel.get(r.label) || []), r]);
  for (const group of byLabel.values()) if (group.length > 1) group.forEach((r, i) => { r.label = `${r.label}${String.fromCharCode(97 + i)}`; });
  for (const p of patients) p.cells.label = p.cells.label.replace(/^.*?(?=(?: ·|,) case [^·,]+$|$)/, records.get(p.key).label);
  const included = list.filter(x => decisions.get(x.key)?.decision === 'include');
  const extraCols = extras.filter(x => patients.some(p => p.cells[x.id] != null)).map(x => ({ id: x.id, name: x.name, type: inferType(patients.map(p => p.cells[x.id])) }));
  return { ok: true, file, sheet, header: rows[hi], columns: [...ipdColumnSet(), ...extraCols], records: list, decisions, patients, checks,
    notes: Object.entries(notes).map(([what, n]) => `${n} × ${what}`),
    counts: { rows: rowsRead, reports: list.filter(x => !x.institutional).length, included: included.filter(x => !x.institutional).length, excluded: list.length - included.length,
      institutional: list.filter(x => x.institutional).length, patients: patients.length } };
}

/**
 * The participant fields a master-list cell gives, read as the import reads them: what "take the file's value" puts in the app.
 * `p` is the participant (the strategy depends on its other half). The cell's text is the baseline of a later comparison; the
 * fields derived from it (strategy, event, follow-up code) move with it. A helper column the import also consulted is not read here.
 */
export function ipdPatchFromText(field, text, p = {}) {
  const t = String(text ?? '').trim();
  if (field === 'case_no') return { case_no: t };
  if (field === 'year') return { year: t.slice(0, 4) };
  if (field === 'eor') { const eor = eorOf(t); return { eor: eor || t, strategy: strategyOf(eor, adjuvantOf(p.adjuvant).value) }; }
  if (field === 'adjuvant') { const adj = adjuvantOf(t); return { adjuvant: adj.value || t, strategy: strategyOf(eorOf(p.eor), adj.value) }; }
  if (field === 'time') { const fu = followUpOf(t); return { time: fu.months == null ? '' : String(fu.months), fu_code: fu.code }; }
  if (field === 'outcome') { const ev = eventOf(t); return { outcome: t, event: ev == null ? '' : String(ev) }; }
  return {};
}

const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };

/**
 * The plan into a project state (mutating it, inside `update` or on a copy).
 * Records the library already holds are matched by DOI, PMID or key, and a
 * decision already made is never replaced. The patients of an earlier import
 * of the same workbook are replaced by this one's; patients entered another
 * way are kept. Returns what was done, in counts.
 */
export function applyIpdList(state, plan, { now = new Date().toISOString(), by = 'list', via = 'folder' } = {}) {
  if (!plan?.ok) return { ok: false, reason: plan?.reason || 'Nothing to apply' };
  const index = libraryIndex(state.papers || []);
  const idOf = new Map();
  let created = 0, matched = 0;
  for (const rec of plan.records) {
    let p = index.find(rec);
    if (p) matched++;
    else {
      p = { ...rec, id: rec.key, pdf: null, source: rec.institutional ? 'institutional' : 'IPD master list', ...(plan.file ? { importFile: plan.file.split('/').pop() } : {}) };
      delete p.institutional; if (rec.institutional) p.institutional = true;
      state.papers = [...(state.papers || []), p]; index.add(p); created++;
    }
    idOf.set(rec.key, p.id);
  }
  state.screening ||= {}; state.fulltext ||= {}; state.screeningLog ||= [];
  const stage = 'Decided in the review\'s master list, which does not separate title/abstract from full text';
  let included = 0, excluded = 0, kept = 0;
  for (const [key, d] of plan.decisions) {
    const id = idOf.get(key); if (!id) continue;
    if (plan.records.find(r => r.key === key)?.institutional) continue;   // the review's own patient is no report that was screened
    if (state.fulltext[id] || state.screening[id]?.decision === 'exclude') { kept++; continue; }
    state.screening[id] = state.screening[id] || { decision: 'include', reason: '', at: now, by, via, note: stage };
    state.fulltext[id] = { decision: d.decision, reason: d.reason || '', at: now, by, via, note: stage };
    state.screeningLog.push({ action: 'decide', stage: 'ft', id, decision: d.decision, reason: d.reason || '', by, via, at: now, source: plan.file });
    if (d.decision === 'include') included++; else excluded++;
  }
  // columns: what the project has stays; what the list needs is added, and a role is given only where none has it
  const have = new Map((state.ipdColumns || []).map(x => [x.id, x]));
  const cols = [...(state.ipdColumns?.length ? state.ipdColumns : [])];
  const usedRoles = new Set(cols.filter(x => x.role).map(x => x.role));
  for (const col of plan.columns) {
    if (have.has(col.id)) continue;
    const add = { ...col };
    if (add.role && usedRoles.has(add.role)) delete add.role;
    if (add.role) usedRoles.add(add.role);
    cols.push(add);
  }
  state.ipdColumns = cols;
  const src = { file: plan.file, sheet: plan.sheet };
  // a patient read again keeps what was added to it another way (a merged column, a typed cell); the workbook's own cells are its
  const earlier = new Map((state.participants || []).filter(x => x.src?.file === plan.file && x.src?.sheet === plan.sheet).map(x => [x.id, x]));
  const fresh = plan.patients.map(p => { const id = `ipd-${hash(`${p.key}|${p.cells.case_no}|${p.row}`)}`;
    return { ...(earlier.get(id) || {}), id, study_id: idOf.get(p.key) || null, ...p.cells, src: { ...src, row: p.row }, updatedAt: now }; });
  const before = (state.participants || []).filter(x => x.src?.file === plan.file && x.src?.sheet === plan.sheet).length;
  state.participants = [...(state.participants || []).filter(x => !(x.src?.file === plan.file && x.src?.sheet === plan.sheet)), ...fresh];
  state.project = { ...(state.project || {}), patientData: true };
  // What the workbook held for each patient, to compare with later; the caller adds the file's hash, size and time (drift.mjs withFile) and records it.
  const adoption = ipdAdoption({ path: plan.file, sheet: plan.sheet, patients: plan.patients, participants: fresh, at: now });
  return { ok: true, records: { created, matched }, decisions: { included, excluded, kept }, patients: fresh.length, replaced: before, adoption };
}

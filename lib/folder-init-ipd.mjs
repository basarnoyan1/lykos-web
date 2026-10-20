// What folder setup reads beyond a screening workbook and an evidence table,
// for a patient-level review (plan §4.15a, §IPD import): the master list that
// holds the patients and the review's decisions, the reference lists saved
// beside the manuscript, the supplement's search strategies and appraisal
// tables, and the counts a filled PRISMA-IPD diagram states. Each takes the
// project state being built and says what it did in the report; none is
// guessed, and what cannot be matched is listed, not attached to the nearest.
import { ipdListFromRows, applyIpdList } from './ipd-import.mjs';
import { docxTables } from './docx-tables.mjs';
import { searchTables, appraisalTables, studyLabel } from './supplement-import.mjs';
import { importReferences, libraryIndex } from './search-library.mjs';
import { parseRecords, familyName } from './bib.mjs';
import { ipdFromText } from './prisma-ipd.mjs';
import { assessmentRows, gradeDisagreements } from './appraisal-summary.mjs';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const titleKey = t => fold(t).replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 120);
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);

/** The master list, applied: patients, columns, the reports and the review's decision on each. */
export function applyPatientList(state, wb, file, { now, by = 'list', report, adopt = null }) {
  const sheet = (wb.sheets.find(s => s.name === file.sheet) || wb.sheets[0]);
  const plan = ipdListFromRows(sheet?.rows || [], { file: file.path, sheet: sheet?.name || '' });
  if (!plan.ok) { report.warnings.push(`${file.path}: ${plan.reason}`); return null; }
  const r = applyIpdList(state, plan, { now, by, via: 'folder' });
  if (adopt && r.adoption) adopt.push(r.adoption);
  const out = { path: file.path, sheet: plan.sheet, ...plan.counts, created: r.records.created, matched: r.records.matched, decisions: r.decisions.included + r.decisions.excluded,
    kept: r.decisions.kept, notes: plan.notes, checks: plan.checks };
  for (const n of plan.notes) report.warnings.push(`${file.path}: ${n} left as written`);
  if (plan.checks.fuMismatch || plan.checks.eventMismatch) report.warnings.push(`${file.path}: the helper columns disagree with the text on ${plan.checks.fuMismatch} follow-ups and ${plan.checks.eventMismatch} events; the text was used`);
  return out;
}

/** Reference lists (.ris, .bib) into the library, not as a search: what is held gains missing fields, the rest is added as references. */
export function applyReferenceFiles(state, lists, { now, report }) {
  const out = [];
  for (const { path, text } of lists) {
    const { records } = parseRecords(text, baseOf(path));
    if (!records.length) { report.warnings.push(`${path}: no records read`); continue; }
    const r = importReferences(state, records, baseOf(path), { at: now });
    out.push({ path, records: records.length, ...r });
  }
  return out;
}

/** The record a supplement row cites: by the key it cites, then by DOI or title, then by first author and year among what the library holds. */
function paperFor(state, row, supp) {
  const index = libraryIndex(state.papers || []);
  const cited = row.cites.map(k => (supp.records || []).find(r => r.key === k)).filter(Boolean);
  for (const r of cited) {
    const hit = index.find(r) || (r.title && (state.papers || []).find(p => titleKey(p.title) === titleKey(r.title)));
    if (hit) return hit;
  }
  const lab = studyLabel(row.study);
  if (lab) {
    const fam = fold(lab.family);
    const hits = (state.papers || []).filter(p => String(p.year) === lab.year && (p.authors || []).slice(0, 1).some(a => fold(familyName(a)) === fam));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/**
 * The supplement's search strategies as the search log, and its JBI tables as
 * assessments. Where a project holds patients, the search whose caption speaks
 * of the pooled patient analysis is the review's flow, and any other is kept in
 * the log as its own search, left out of the flow's counts.
 */
export function applySupplement(state, supp, file, { now, report }) {
  const tables = docxTables(supp);
  const out = { path: file.path, tables: tables.length, searches: [], appraisal: [] };
  const found = searchTables(tables);
  const pooled = found.find(t => /pooled|individual|patient/i.test(t.caption));
  const primary = state.project?.patientData && pooled ? pooled : found[0];
  const keep = (state.searches || []).filter(s => !(s.imported && s.file === file.path));
  const added = [];
  for (const t of found) {
    const isPrimary = t === primary;
    for (const s of t.searches) added.push({ source: s.source, kind: 'database', query: s.query, at: `${s.day || now.slice(0, 10)}T12:00:00.000Z`, status: 'complete',
      retrieved: Number.isFinite(s.retrieved) ? s.retrieved : null, total: Number.isFinite(s.retrieved) ? s.retrieved : null, imported: true, file: file.path,
      table: t.caption.slice(0, 120), ...(isPrimary ? {} : { exploratory: true, purpose: `${t.caption.slice(0, 120)}: a separate search with its own flow, not counted in this project's` }) });
    out.searches.push({ table: t.caption.slice(0, 80), n: t.searches.length, total: t.total, stated: t.totalStated, primary: isPrimary });
    if (t.totalStated != null && t.totalStated !== t.total) report.warnings.push(`${file.path}: ${t.caption.slice(0, 40)}… states a total of ${t.totalStated}, its rows make ${t.total}`);
  }
  if (added.length) {
    state.searches = [...keep, ...added];
    const days = (primary?.searches || []).map(s => s.day).filter(Boolean).sort();
    if (days.length) state.searchStrategy = { ...(state.searchStrategy || {}), lastSearched: days.at(-1) };
  }
  // ---- appraisal: JBI answers per report
  const tools = appraisalTables(tables);
  const rule = /low\s*\(\s*>\s*(\d+)\s*%\s*\)[^.]*?moderate\s*\(\s*(\d+)\s*[–-]\s*(\d+)\s*%\s*\)[^.]*?high\s*\(\s*<\s*(\d+)\s*%\s*\)/i.exec((supp.blocks || []).map(b => b.text || '').join('\n'));
  state.assessments ||= {};
  let n = 0;
  const byTool = {}, stated = new Map();
  for (const t of tools) {
    let matched = 0; const unmatched = [];
    for (const row of t.rows) {
      const paper = paperFor(state, row, supp);
      if (!paper) { unmatched.push(row.study); continue; }
      const cur = state.assessments[paper.id]?.[t.tool];
      if (cur && Object.keys(cur).length) continue;   // an assessment already made is never replaced
      state.assessments[paper.id] = { ...(state.assessments[paper.id] || {}), [t.tool]: row.answers };
      state.appraisalByStudy = { ...(state.appraisalByStudy || {}), [paper.id]: t.tool };
      if (row.grade) stated.set(paper.id, row.grade);
      matched++; n++;
    }
    byTool[t.tool] = (byTool[t.tool] || 0) + matched;
    out.appraisal.push({ table: t.caption.slice(0, 80), tool: t.tool, rows: t.rows.length, matched, unmatched, unread: t.unread.length });
    for (const u of unmatched) report.warnings.push(`${file.path}: appraisal row "${u}" matches no record`);
    if (t.warning) report.warnings.push(`${file.path}: ${t.caption.slice(0, 40)}: ${t.warning}`);
  }
  if (n) {
    // the project's instrument is the one most studies were appraised with; the others are per study
    const top = Object.entries(byTool).sort((a, b) => b[1] - a[1])[0][0];
    if (!state.appraisalTool) state.appraisalTool = top;
    for (const [pid, tool] of Object.entries(state.appraisalByStudy || {})) if (tool === state.appraisalTool) delete state.appraisalByStudy[pid];
    if (!Object.keys(state.appraisalByStudy || {}).length) delete state.appraisalByStudy;
    if (rule && !state.appraisalRule) state.appraisalRule = { low: Number(rule[1]), moderate: Number(rule[2]), source: `${baseOf(file.path)}: proportion of applicable items answered Yes` };
  }
  out.assessments = n;
  // The grades the tables state, against the rule applied to the same answers: a grade that does not follow from its items is said.
  if (n && state.appraisalRule) {
    const diff = gradeDisagreements(assessmentRows(state), stated);
    out.gradeCheck = { stated: stated.size, differ: diff.length };
    for (const d of diff) report.warnings.push(`${file.path}: ${d.study} is graded ${d.stated}, its answers (${d.met} of ${d.applicable} met) give ${d.computed} under the stated rule`);
  }
  return out;
}

/**
 * Counts a filled PRISMA-IPD diagram states that the project cannot count for
 * itself (patients in studies that gave only aggregates, patients left out by
 * the review's rule, records found by other sources), entered by hand with the
 * file and the diagram's own words as the explanation. What the project can
 * derive is not taken from the file: the file may be older than the list.
 */
export function applyIpdCounts(state, text, path, { report }) {
  const found = ipdFromText(text);
  const hand = {}, notes = {};
  for (const k of ['identified_other', 'notprovided_participants', 'excluded_participants']) if (found[k]) {
    hand[k] = found[k].n; notes[`ipd:${k}`] = `From ${baseOf(path)}: "${found[k].phrase}"`;
  }
  if (Object.keys(hand).length) {
    state.prismaIpd = { ...(state.prismaIpd || {}), ...hand };
    state.prismaNotes = { ...(state.prismaNotes || {}), ...notes };
  }
  return { path, found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.n])), entered: hand };
}

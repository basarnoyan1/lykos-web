// What the app exports from a project, as bytes, in one place (2026-10-25): the views' Export menus build their files here, and so do
// tools/lykos-export.mjs and the MCP server's build tool (step { export, file }), so a file made from a shell is the file the window makes.
// Each export takes the project state and answers { bytes, what }; `template` names an extraction table (id or name; the first when left out).
import { toRis, toBibtex, toCsv, toCslJson, toEndnoteXml } from './bib-export.mjs';
import { lib_late_abstracts$whenReady as whenReady } from "../boot.mjs";
import { toRisWithDecisions, toCsvWithDecisions } from './ref-export-extra.mjs';
import { compile as compileStrategy, toMarkdownAll, toBlocksAll } from './prisma-s.mjs';
import { reviewsOf, scoped } from './reviews.mjs';
import { summaryOfFindings, toBlocks as sofBlocks, gradeTable, gradeTableBlocks } from './sof.mjs';
import { characteristics, toCsv as charCsv, toBlocks as charBlocks } from './characteristics.mjs';
import { codebookRows, codebookCsv, codebookBlocks } from './codebook.mjs';
import { evidenceModel, publicationWorkbook, wordDocument, sourcesWorkbook, nextRound } from './evidence-export.mjs';
import { robWorkbookSheets } from './rob-record.mjs';
import { revmanFromState, writeRevman } from './revman.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { writeDocx } from './docx-write.mjs';
import { lib_declarations$titlePage as titlePage, lib_declarations$normalizeDeclarations as normalizeDeclarations } from "../boot.mjs";
import { coverLetter } from './cover-letter.mjs';
import { responseLetter } from './reviewer-response.mjs';
import { titlePageAuthors, titlePageCounts } from './manuscript-submission.mjs';
import { keywordList } from './submission-checks.mjs';
import { targetJournal } from './journal-context.mjs';
import { lib_journal_profile_state$normalizeReviewRounds as normalizeReviewRounds } from "../boot.mjs";
import { activeProfile } from './journal-profiles.mjs';
import { lib_workflow$researchType as researchType } from "../boot.mjs";
import { lib_research_types$questionFrameOf as questionFrameOf } from "../boot.mjs";
import { decisionsCsv, logCsv } from './screening-export.mjs';

const text = t => new TextEncoder().encode(t);
const bytesOf = async b => (typeof b === 'string' ? text(b) : b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));
/** A Word file of blocks, as the views write their tables (no citations, no results). */
export const docxOf = (blocks, section = null) => writeDocx({ blocks, section, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
const LANDSCAPE = { orient: 'landscape', pageW: 842, pageH: 595, top: 54, right: 54, bottom: 54, left: 54 };

/** Each review's search strategies as PRISMA-S reports them; one review when none ran a search. */
export function strategyReports(s) {
  const list = reviewsOf(s), many = list.length > 1;
  const reps = list.map(r => ({ ...compileStrategy(scoped(s, r.id)), review: many ? r.name : '' }));
  const used = reps.filter(r => r.databases.length || r.citation.length);
  return used.length ? used : reps.slice(0, 1);
}
/** The extraction table an export reads: by id or name, else the first. */
export function templateFor(s, which) {
  const ts = s.templates || [];
  const t = which ? ts.find(x => x.id === which || x.name === which) : ts[0];
  if (!t) throw new Error(which ? `No extraction table ${which}` : 'The project has no extraction table');
  return t;
}
/** Protocol › Registration draft: the review question, eligibility criteria, sources and methods, for a registry form a person fills. */
export function protocolDraftBlocks(s2) {
  const pp = s2.protocol || {}, pico = pp.pico || {}, pa = s2.paper || {};
  let n = 0; const id = () => `r${++n}`;
  const blocks = [{ id: id(), type: 'title', text: pp.title || pa.title || `${researchType(s2).label} protocol` },
    { id: id(), type: 'p', text: `Registration draft prepared ${new Date().toISOString().slice(0, 10)}${pa.registration ? `. Registration: ${pa.registration}` : '. Not yet registered.'}` },
    ...(pa.authors || []).length ? [{ id: id(), type: 'p', text: `Review team: ${(pa.authors || []).map(a => a.name).filter(Boolean).join(', ')}` }] : [],
    { id: id(), type: 'h1', text: 'Review question' },
    ...questionFrameOf(researchType(s2).id).map(f => [f.label, pico[f.id] || (f.id === 'design' ? pico.designs : '')]).filter(([, v]) => v).map(([k, v]) => ({ id: id(), type: 'p', text: `${k}: ${v}` })),
    { id: id(), type: 'h1', text: 'Eligibility criteria' },
    ...(pp.criteria || []).map(c => ({ id: id(), type: 'p', text: `${c.id} (${c.stage}): ${c.text}` })),
    { id: id(), type: 'h1', text: 'Information sources and search strategy' },
    { id: id(), type: 'p', text: (s2.searches || []).length ? [...new Set((s2.searches || []).map(r => r.source || 'PubMed'))].join(', ') : '[to be added]' },
    { id: id(), type: 'h1', text: 'Selection, extraction and synthesis' },
    { id: id(), type: 'p', text: `Screening: ${s2.settings?.dualScreening ? 'two reviewers, blinded, conflicts resolved by discussion' : 'one reviewer'}. Extraction fields: ${(s2.customFields || []).length + 10}. Effect measure: ${s2.settings?.measure || 'RR'}; heterogeneity estimator: ${s2.settings?.method || 'REML'}. Certainty: GRADE.` }];
  return blocks;
}
/** Manuscript › Submission: the title page (warnings: what it could not fill), the cover letter, the response to a review round. */
export function titlePageOf(s) {
  const blocks = s.manuscript?.blocks || [], profile = activeProfile(s.journalProfile);
  return titlePage({ paper: s.paper || {}, authors: titlePageAuthors(s.paper), keywords: keywordList(blocks), counts: titlePageCounts(blocks, s.manuscript?.assets || [], s.manuscript || {}),
    ...(profile?.runningTitleChars ? { runningTitleLimit: profile.runningTitleChars } : {}) });
}
export const coverLetterOf = s => coverLetter({ paper: s.paper || {}, authors: titlePageAuthors(s.paper), journal: targetJournal(s) || undefined,
  researchType: researchType(s).id, declarations: normalizeDeclarations(s.declarations, s.paper) });
export function responseLetterOf(s, round = null) {
  const rounds = normalizeReviewRounds(s.reviewRounds), r = round ? rounds.find(x => x.id === round) : rounds.at(-1);
  if (!r) throw new Error(round ? `No review round ${round}` : 'No review round: add the reviewers\' comments in Manuscript › Submission first');
  return responseLetter(r.points, { title: s.paper?.title || '', journal: r.journal, manuscriptId: r.manuscriptId });
}
const records = n => `${n} record${n === 1 ? '' : 's'}`;

export const EXPORTS = {
  'library-ris': { ext: 'ris', label: 'Library (RIS)', make: s => ({ bytes: text(toRis(s.papers || [])), what: records((s.papers || []).length) }) },
  'library-bibtex': { ext: 'bib', label: 'Library (BibTeX)', make: s => ({ bytes: text(toBibtex(s.papers || [])), what: records((s.papers || []).length) }) },
  'library-csv': { ext: 'csv', label: 'Library (CSV)', make: s => ({ bytes: text(toCsv(s.papers || [])), what: records((s.papers || []).length) }) },
  'library-csl': { ext: 'json', label: 'Library (CSL JSON)', make: s => ({ bytes: text(toCslJson(s.papers || [])), what: records((s.papers || []).length) }) },
  'library-endnote': { ext: 'xml', label: 'Library (EndNote XML)', make: s => ({ bytes: text(toEndnoteXml(s.papers || [])), what: records((s.papers || []).length) }) },
  'library-ris-decisions': { ext: 'ris', label: 'Library with decisions (RIS)', make: s => ({ bytes: text(toRisWithDecisions(s.papers || [], s)), what: records((s.papers || []).length) }) },
  'library-csv-decisions': { ext: 'csv', label: 'Library with decisions (CSV)', make: s => ({ bytes: text(toCsvWithDecisions(s.papers || [], s)), what: records((s.papers || []).length) }) },
  'screening-decisions': { ext: 'csv', label: 'Screening decisions (CSV)', make: (s, o) => ({ bytes: text(decisionsCsv(s, o.by || '')), what: 'every current decision' }) },
  'screening-log': { ext: 'csv', label: 'Screening log (CSV)', make: (s, o) => ({ bytes: text(logCsv(s, o.by || '')), what: 'every entry' }) },
  'search-strategies': { ext: 'docx', label: 'Search strategies (Word)', make: async s => { const r = strategyReports(s); return { bytes: await bytesOf(await docxOf(toBlocksAll(r))), what: `${r.reduce((n, x) => n + x.databases.length, 0)} databases` }; } },
  'search-strategies-md': { ext: 'md', label: 'Search strategies (Markdown)', make: s => ({ bytes: text(toMarkdownAll(strategyReports(s))), what: 'markdown' }) },
  'summary-of-findings': { ext: 'docx', label: 'Summary of findings (Word)', make: async s => { const t = summaryOfFindings(s); return { bytes: await bytesOf(await docxOf(sofBlocks(t))), what: `${t.rows?.length ?? 0} outcomes` }; } },
  'grade-table': { ext: 'docx', label: 'GRADE evidence profile (Word)', make: async s => { const t = gradeTable(s); return { bytes: await bytesOf(await docxOf(gradeTableBlocks(t), LANDSCAPE)), what: `${t.rows?.length ?? 0} outcomes` }; } },
  'characteristics': { ext: 'docx', label: 'Table 1, characteristics (Word)', make: async s => { const t = characteristics(s); if (!t.rows.length) throw new Error('No included studies with extracted values'); return { bytes: await bytesOf(await docxOf(charBlocks(t), { pageW: 792, pageH: 612 })), what: `${t.rows.length} studies` }; } },
  'characteristics-csv': { ext: 'csv', label: 'Table 1, characteristics (CSV)', make: s => { const t = characteristics(s); if (!t.rows.length) throw new Error('No included studies with extracted values'); return { bytes: text(charCsv(t)), what: `${t.rows.length} studies` }; } },
  'codebook': { ext: 'docx', label: 'Extraction codebook (Word)', make: async (s, o) => { const rows = codebookRows(s, templateFor(s, o.template).columns || []); return { bytes: await bytesOf(await docxOf(codebookBlocks(rows), { pageW: 842, pageH: 595 })), what: `${rows.length} fields` }; } },
  'codebook-csv': { ext: 'csv', label: 'Extraction codebook (CSV)', make: (s, o) => { const rows = codebookRows(s, templateFor(s, o.template).columns || []); return { bytes: text(codebookCsv(rows)), what: `${rows.length} fields` }; } },
  'evidence-table': { ext: 'xlsx', label: 'Publication table (Excel)', make: async (s, o) => ({ bytes: await bytesOf(await publicationWorkbook(evidenceModel(s, templateFor(s, o.template).id))), what: templateFor(s, o.template).name }) },
  'evidence-sources': { ext: 'xlsx', label: 'Publication table with sources (Excel)', make: async (s, o) => { const m = evidenceModel(s, templateFor(s, o.template).id), r = nextRound(m);
    return { bytes: await bytesOf(await sourcesWorkbook(m, { rounds: r.rounds, snapshot: r.snapshot })), what: `${templateFor(s, o.template).name}, with sources` }; } },
  'evidence-word': { ext: 'docx', label: 'Evidence tables (Word)', make: async (s, o) => ({ bytes: await bytesOf(await wordDocument(evidenceModel(s, templateFor(s, o.template).id))), what: templateFor(s, o.template).name }) },
  'rob-workbook': { ext: 'xlsx', label: 'Risk-of-bias workbook (Excel)', make: async s => { const sheets = robWorkbookSheets(s); return { bytes: await bytesOf(await writeXlsx(sheets, { font: 'Arial', size: 10 })), what: `${sheets.length} sheets` }; } },
  'protocol-draft': { ext: 'docx', label: 'Protocol registration draft (Word)', make: async s => { const b = protocolDraftBlocks(s); return { bytes: await bytesOf(await docxOf(b)), what: `${b.length} paragraphs` }; } },
  'title-page': { ext: 'docx', label: 'Title page (Word)', make: async s => { const { blocks, warnings } = titlePageOf(s); return { bytes: await bytesOf(await docxOf(blocks)), what: warnings.length ? warnings.map(w => w.text).join('; ') : 'complete' }; } },
  'cover-letter': { ext: 'docx', label: 'Cover letter (Word)', make: async s => ({ bytes: await bytesOf(await docxOf(coverLetterOf(s))), what: 'replace the bracketed placeholders' }) },
  'response-letter': { ext: 'docx', label: 'Response to reviewers (Word)', make: async (s, o) => ({ bytes: await bytesOf(await docxOf(responseLetterOf(s, o.round))), what: 'the latest review round' }) },
  'revman': { ext: 'rm5', label: 'RevMan file', make: s => { const { doc, skipped } = revmanFromState(s); return { bytes: text(writeRevman(doc)), what: `${skipped.length ? `${skipped.length} skipped` : 'every included study'}` }; } },
};

/** One export of the project: { bytes, what, ext }. */
export async function exportProject(s, kind, opts = {}) {
  const e = EXPORTS[kind];
  if (!e) throw new Error(`No export ${kind}. Exports: ${Object.keys(EXPORTS).join(', ')}`);
  { const ready = whenReady(); if (ready) await ready; }   // the late abstracts (lib/late-abstracts.mjs)
  return { ...(await e.make(s, opts)), ext: e.ext };
}

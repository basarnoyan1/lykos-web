// What Lykos writes into a project folder (plan §4.15a): the submission
// bundle's files (lib/bundle.mjs), each in the folder for what it is, plus the
// forms a co-author opens directly — the screening sheet and the evidence
// table as workbooks, the characteristics table as a Word table, the PRISMA
// flow as a PNG, and the library as BibTeX. Every output is written by the
// version rule in lib/project-folder.mjs.
import { get } from '../store.mjs';
import { bundleEntries } from './bundle.mjs';
import { fields } from './fields.mjs';
import { characteristics, toBlocks } from './characteristics.mjs';
import { writeDocx } from './docx-write.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { toRis, toBibtex } from './bib-export.mjs';
import { studies as includedOf, screeningStarted } from './screen.mjs';
import { researchType, projectName } from './workflow.mjs';
import { writeOutputs, writeGuide, svgToPng } from './project-folder.mjs';
import { outputFor } from './folder-map.mjs';
import { migrateValue } from './evidence.mjs';
import { decisionsSheet } from './screening-sheet.mjs';

const valueText = v => { if (!v) return ''; const m = migrateValue(v); return String(m.reported_value ?? m.normalized_value ?? ''); };

/** The study's ID: its number in the papers folder when it has one, else its place among the included studies. */
export const studyNo = (p, i) => Number(p.folderNo) || i + 1;

/** The evidence table: one row per included study, every field with a value as a column. */
export function evidenceTable(s = get()) {
  const list = (screeningStarted(s) ? includedOf(s) : s.papers || []).map((p, i) => ({ p, no: studyNo(p, i) })).sort((a, b) => a.no - b.no);
  const all = fields(s).filter(f => list.some(({ p }) => s.values?.[`${p.id}:${f.id}`]));
  const head = ['ID', 'Study', 'Year', 'DOI', ...all.map(f => f.label)];
  const rows = list.map(({ p, no }) => [no, p.label || p.title || p.id, String(p.year || ''), p.doi || '', ...all.map(f => valueText(s.values?.[`${p.id}:${f.id}`]))]);
  return { head, rows, fields: all, studies: list.map(x => x.p) };
}

/**
 * The screening sheet: every reviewer's and every model's columns in the convention a team keeps by hand, the decision cells filled
 * (lib/screening-sheet.mjs), then the log and the criteria. It reads back through "Import reviewer sheet" to the same state.
 */
export function screeningSheet(s = get()) {
  const labelOf = new Map((s.papers || []).map(p => [p.id, p.label]));
  const log = [['At', 'Action', 'Stage', 'Record', 'Decision', 'Prior', 'Reason', 'Reviewer'],
    ...(s.screeningLog || []).map(e => [e.at, e.action, e.stage, labelOf.get(e.id) || e.id || '', e.decision || '', e.prior || '', e.reason || '', e.by || ''])];
  const criteria = [['ID', 'Kind', 'Stage', 'Criterion', 'Tested statement', 'True when', 'False when'],
    ...(s.protocol?.criteria || []).map(c => [c.id, c.kind || '', c.stage || '', c.text || '', c.question || '', c.yes || '', c.no || ''])];
  return [decisionsSheet(s), { name: 'Log', rows: log }, { name: 'Criteria', rows: criteria }];
}

// What can be written, by output, for the per-output buttons. Each returns
// `{ key, stem, ext, data, label }` entries; an output with nothing to write
// returns none.
export const OUTPUT_KINDS = [
  { id: 'library', label: 'Library (RIS, BibTeX, CSV)' },
  { id: 'screening', label: 'Screening sheet' },
  { id: 'evidence', label: 'Evidence table' },
  // written by views/evidence-exports.mjs after a preview, by the folder's version rule
  { id: 'evidence-tables', label: 'Publication tables (Excel, with sources, Word)' },
  { id: 'characteristics', label: 'Characteristics table' },
  { id: 'prisma', label: 'PRISMA flow' },
  { id: 'analysis', label: 'Analysis results and figures' },
  { id: 'reporting', label: 'Checklist, protocol and search log' },
  { id: 'manuscript', label: 'Manuscript draft and supplement' },
];

/** Whether the project has anything for each output kind yet: the view ticks those by default. */
export function availableKinds(s = get()) {
  const papers = (s.papers || []).length, decided = Object.keys(s.screening || {}).length + Object.keys(s.fulltext || {}).length;
  return {
    library: papers > 0, screening: papers > 0, evidence: evidenceTable(s).fields.length > 0,
    'evidence-tables': (s.templates || []).some(t => t.orientation === 'studies-rows' && Object.keys(s.values || {}).some(k => k.includes(`:${t.id}.`))), characteristics: characteristics(s).rows.length > 0 && decided > 0,
    prisma: decided > 0 || (s.searches || []).length > 0, analysis: !!(s.analysis || Object.keys(s.assessments || {}).length || s.dta || s.evidenceMap),
    reporting: !!(s.protocol || (s.searches || []).length), manuscript: (s.manuscript?.blocks || []).some(b => String(b.text || '').trim()),
  };
}

// Which bundle entries belong to which output kind.
const KIND_OF_ENTRY = [
  [/^(references\.ris|records\.csv)$/, 'library'],
  [/^screening-/, 'screening'],
  [/^(extracted-values|codebook|report-links)\.csv$/, 'evidence'],
  [/^prisma\//, 'prisma'],
  [/^(appraisal|analysis|charting|dta|umbrella|synthesis|characteristics|patients)(\/|\.csv$)/, 'analysis'],
  [/^(.+-checklist\.csv|protocol\.md|search-log\.csv|case\/)/, 'reporting'],
  [/^(manuscript\/|ai-use\.md)/, 'manuscript'],
];
const kindOfEntry = name => KIND_OF_ENTRY.find(([re]) => re.test(name))?.[1] || null;

/** Every output for the open project, or those of the kinds in `only`. */
export async function collectOutputs(only = null) {
  const s = get();
  const want = k => !only || only.includes(k);
  const { entries } = await bundleEntries();
  // The bundle's characteristics.csv lists fields by study; the folder gets the evidence table instead.
  // Each output carries its kind, for the view's "last written".
  const out = entries.filter(e => e.name !== 'characteristics.csv' && want(kindOfEntry(e.name)))
    .map(e => { const o = outputFor(e.name); return o && { ...o, data: e.data, kind: kindOfEntry(e.name) }; }).filter(Boolean);
  if (want('library') && (s.papers || []).length) out.push({ key: 'search', stem: 'Library', ext: 'bib', data: toBibtex(s.papers), kind: 'library' });
  if (want('library')) {
    const inc = screeningStarted(s) ? includedOf(s) : [];
    if (inc.length) out.push({ key: 'manuscript', stem: 'Included studies', ext: 'ris', data: toRis(inc), kind: 'library' }, { key: 'manuscript', stem: 'Included studies', ext: 'bib', data: toBibtex(inc), kind: 'library' });
  }
  if (want('screening') && (s.papers || []).length) out.push({ key: 'screening', stem: 'Screening sheet', ext: 'xlsx', data: await writeXlsx(screeningSheet(s)), kind: 'screening' });
  if (want('evidence')) {
    const t = evidenceTable(s);
    if (t.rows.length && t.fields.length) {
      const csv = [t.head, ...t.rows].map(r => r.map(v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(',')).join('\n') + '\n';
      const values = entries.find(e => e.name === 'extracted-values.csv');
      const codebook = [['Field', 'Label', 'Type'], ...t.fields.map(f => [f.id, f.label, f.type || ''])];
      out.push({ key: 'data', stem: 'Evidence table', ext: 'xlsx', data: await writeXlsx([
        { name: 'Table', rows: [t.head, ...t.rows] },
        { name: 'Codebook', rows: codebook },
        ...(values ? [{ name: 'Extracted values', rows: values.data.trim().split('\n').length > 1 ? parseCsvRows(values.data) : [] }] : []),
      ]), kind: 'evidence' }, { key: 'data', stem: 'Evidence table', ext: 'csv', data: csv, kind: 'evidence' });
    }
  }
  if (want('characteristics')) {
    const t = characteristics(s);
    if (t.rows.length) out.push({ key: 'manuscript', stem: 'Characteristics table', ext: 'docx',
      data: await writeDocx({ blocks: toBlocks(t), renderCite: () => '', renderResult: () => null, references: [] }), kind: 'characteristics' });
  }
  if (want('prisma')) {
    const svg = entries.find(e => e.name === 'prisma/flow-diagram.svg');
    const png = svg && await svgToPng(svg.data).catch(() => null);
    if (png) out.push({ key: 'screening', stem: 'PRISMA flow', ext: 'png', data: png, kind: 'prisma' });
  }
  return out;
}

// The extracted-values CSV back into rows for its sheet (quoted cells, embedded newlines).
function parseCsvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Writes the project's outputs into its folder, and brings AGENTS.md's list
 * of current files up to date. Returns what was written, left unchanged
 * (identical to the current version), archived, or failed.
 */
export async function writeProjectOutputs(folder, only = null) {
  const s = get();
  const typeId = researchType(s).id;
  const outputs = await collectOutputs(only);
  const result = await writeOutputs(folder, outputs, { typeId });
  result.guide = await refreshGuide(folder, s);
  return result;
}

/**
 * The Lykos part of the folder's guide (AGENTS.md, between its markers) as the project stands: name, research type, question, included
 * studies and the outputs Lykos wrote. Written only when it differs and only inside the markers; a guide without them is left alone.
 * Runs with each folder sync (lib/vcs-watch.mjs) as well as after outputs are written, so the guide an agent reads first is not weeks old.
 */
export async function refreshGuide(folder, s = get()) {
  const inc = screeningStarted(s) ? includedOf(s).length : 0;
  return writeGuide(folder, { name: projectName(s), type: researchType(s).label, question: s.protocol?.title || s.paper?.title || '', typeId: researchType(s).id, studies: inc })
    .catch(err => ({ written: false, reason: err.message }));
}

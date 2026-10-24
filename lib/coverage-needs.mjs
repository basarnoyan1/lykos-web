// Integration checks (plan §4.15e, 2026-10-17): what the project folder holds that the project record does not.
//
// A review written with files and scripts beside the app leaves its criteria in a protocol, its decisions in a screening
// sheet, its risk of bias in a workbook, its GRADE in a JSON file and its submissions in a log, while the app's record of
// the same stage is empty. Each rule here pairs one empty stage of the record (lib/coverage-state.mjs counts) with the
// file in the folder that holds that stage's work, and names both: the finding is the step that brings the work into the
// app, and it closes when the record holds it. The rules read only the facts lib/figure-facts.mjs collects (file rows
// with their roles, twins, the reduced state); they never read a file, a clock or the store.
//
//   coverageRules(ctx) -> descriptor[]    one per rule that fires, in the shape lib/figure-needs.mjs `add` takes:
//                                         { rule, subject, severity, text, evidence, members?, action, generatable, extra: { view } }
//
// `view` is the page the Overview row opens (the stage whose record is empty). Severity is 'gap' when a person's step
// brings the work in, 'info' when the finding only describes where the work is done.
import { isAuditReport } from './audit-findings.mjs';

export const COVERAGE_RULES = Object.freeze({
  C1: 'coverage', C2: 'coverage', C3: 'coverage', C4: 'coverage', C5: 'coverage', C6: 'coverage',
  C7: 'coverage', C8: 'coverage', C9: 'coverage', C10: 'coverage', C11: 'coverage', C12: 'coverage', C13: 'coverage', C14: 'coverage', C15: 'coverage',
});
/** Scripts in the folder from which the work is said to be done outside the app. */
export const SCRIPT_MIN = 5;
/** Files that exist twice from which the duplication is reported. */
export const TWIN_MIN = 3;
/** A guide longer than this is cut when the MCP serves it (tools/mcp/resources.mjs GUIDE_MAX): agents read its first part only. */
export const GUIDE_BYTES = 16384;

const arr = v => Array.isArray(v) ? v : [];
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const baseOf = p => String(p).slice(String(p).lastIndexOf('/') + 1);
const dirOf = p => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) : '');
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const short = (name, n = 36) => (name.length > n ? `${name.slice(0, n - 1)}…` : name);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const file = path => ({ kind: 'file', path });

const WORKBOOK = new Set(['xlsx', 'xls', 'csv', 'tsv']);
const DOC = new Set(['docx', 'doc', 'pdf', 'md', 'txt']);
const ROB_NAME = /bias|\brob\b|rob[ _-]?2|robins|apprais|minors|newcastle|ottawa|\bjbi\b|quality[ _-]?assess/i;
const GRADE_NAME = /\bgrade\b|certainty|summary[ _-]?of[ _-]?findings|\bsof\b/i;
const PRISMA_NAME = /prisma|flow[ _-]?(diagram|chart)/i;
const SUBMISSION_NAME = /submission|cover[ _-]?letter|response[ _-]?to[ _-]?(the[ _-]?)?review|decision[ _-]?letter|reviewer[ _-]?comments|rebuttal/i;
const DECISION_SHEET = /screen|eleme|decision|literature[ _-]?index|index\.csv$/i;
const CRITERIA_NAME = /elig|criteria|protocol|prospero|inclusion/i;
const SYNC_SCRIPT = /lykos/i;
const FOREST_NAME = /forest|funnel|meta[ _-]?analy|revman/i;

/** The live file rows (not archived, older, scratch or a copy), by path. */
const liveRows = ctx => [...arr(ctx.live)].sort((a, b) => byText(a.path, b.path));
const named = (rows, re, exts = null) => rows.filter(r => re.test(baseOf(r.path)) && (!exts || exts.has(r.ext)));
const withRole = (rows, ...roles) => rows.filter(r => roles.includes(r.role));
/** The newest of rows (by date when the folder's dates can be trusted, else the last by name). */
const newest = (ctx, rows) => (!rows.length ? null : ctx.timeOn ? [...rows].sort((a, b) => (ctx.ms(b) || 0) - (ctx.ms(a) || 0) || byText(a.path, b.path))[0] : rows[rows.length - 1]);

/** The descriptors of the integration rules that fire for these facts. */
export function coverageRules(ctx) {
  const c = isObj(ctx?.state?.coverage) ? ctx.state.coverage : null;
  if (!c || ctx.facts?.hasFolder === false) return [];
  const rows = liveRows(ctx), out = [];
  const add = (rule, subject, severity, view, text, evidence, extra = {}) => out.push({
    rule, subject, severity, text, evidence: evidence.map(e => (typeof e === 'string' ? file(e) : e)), action: ['open-folder'], generatable: 'no', extra: { view }, ...extra,
  });
  const lead = (ctx2, list) => newest(ctx2, list);

  // C1 — criteria: the record has none while a protocol or eligibility document is in the folder.
  if (c.criteria === 0 && c.papers > 0) {
    const docs = [...withRole(rows, 'protocol'), ...named(rows.filter(r => r.role !== 'protocol'), CRITERIA_NAME, DOC)];
    const f = lead(ctx, docs);
    if (f) add('C1', 'criteria', 'gap', 'protocol', `No eligibility criteria recorded; ${short(baseOf(f.path))} is in the folder`, docs.slice(0, 3).map(r => r.path));
  }
  // C2 — screening: records wait while a sheet of decisions is in the folder.
  const sheets = [...withRole(rows, 'screening-sheet'), ...named(rows.filter(r => r.role !== 'screening-sheet'), DECISION_SHEET, WORKBOOK)];
  if (sheets.length && c.taWaiting > 0) {
    const f = lead(ctx, sheets);
    add('C2', 'title-abstract', 'gap', 'screening', `${plural(c.taWaiting, 'record waits', 'records wait')} at title/abstract; ${short(baseOf(f.path))} holds decisions`, sheets.slice(0, 3).map(r => r.path));
  } else if (sheets.length && c.ftWaiting > 0) {
    const f = lead(ctx, sheets);
    add('C2', 'full-text', 'gap', 'screening', `${plural(c.ftWaiting, 'record waits', 'records wait')} at full text; ${short(baseOf(f.path))} holds decisions`, sheets.slice(0, 3).map(r => r.path));
  }
  // C3 — extraction: included studies with no value while an evidence table is in the folder.
  if (c.included > 0 && c.values === 0) {
    const tables = withRole(rows, 'evidence-table');
    const f = lead(ctx, tables);
    if (f) add('C3', 'values', 'gap', 'extraction', `${plural(c.included, 'included study has', 'included studies have')} no value; ${short(baseOf(f.path))} is in the folder`, tables.slice(0, 3).map(r => r.path));
  }
  // C4 — appraisal: not every included study is appraised while a risk-of-bias workbook is in the folder.
  if (c.included > 0 && c.assessed < c.included) {
    const books = named(rows, ROB_NAME, WORKBOOK);
    const f = lead(ctx, books);
    if (f) add('C4', 'appraisal', 'gap', 'appraisal', `${c.assessed} of ${plural(c.included, 'included study', 'included studies')} appraised; ${short(baseOf(f.path), 30)} is in the folder`, books.slice(0, 3).map(r => r.path));
  }
  // C5 — certainty: no outcome rated while a GRADE file is in the folder.
  if (c.rated === 0) {
    const grade = named(rows, GRADE_NAME, new Set(['json', 'docx', 'xlsx', 'csv']));
    const f = lead(ctx, grade);
    if (f) add('C5', 'grade', 'gap', 'certainty', `No certainty rated in the app; ${short(baseOf(f.path))} is in the folder`, grade.slice(0, 3).map(r => r.path));
  }
  // C6 — reporting: no PRISMA count recorded while a flow diagram or its report is in the folder.
  if (c.prismaFilled === 0 && c.papers > 0) {
    const prisma = [...withRole(rows, 'prisma-flow', 'prisma-report'), ...named(rows.filter(r => !['prisma-flow', 'prisma-report'].includes(r.role)), PRISMA_NAME)];
    const f = lead(ctx, prisma);
    if (f) add('C6', 'prisma', 'gap', 'reporting', `No PRISMA counts recorded; ${short(baseOf(f.path))} is in the folder`, prisma.slice(0, 3).map(r => r.path));
  }
  // C7 — submission: none recorded while a submission log, cover letter or decision letter is in the folder.
  if (c.submissions === 0) {
    const subs = [...withRole(rows, 'cover-letter', 'reviewer-comments'), ...named(rows.filter(r => !['cover-letter', 'reviewer-comments'].includes(r.role)), SUBMISSION_NAME, DOC)];
    const f = lead(ctx, subs);
    if (f) add('C7', 'submission', 'gap', 'submissions', `No submission recorded; ${short(baseOf(f.path))} is in the folder`, subs.slice(0, 3).map(r => r.path));
  }
  // C8 — scripts: the outputs are built by scripts beside the app; a script that writes the app's record says the record is elsewhere.
  const scripts = withRole(rows, 'script').filter(r => !/^\.lykos(\/|$)/.test(r.path));
  const sync = scripts.filter(r => SYNC_SCRIPT.test(baseOf(r.path)));
  if (sync.length) {
    add('C8', 'sync', 'gap', 'outputs', `${short(baseOf(sync[0].path))} writes the app's record from files; the record is kept outside the app`, sync.slice(0, 3).map(r => r.path), { members: sync.map(r => r.path) });
  } else if (scripts.length >= SCRIPT_MIN) {
    const dirs = new Map();
    for (const r of scripts) { const d = dirOf(r.path).split('/')[0] || '.'; dirs.set(d, (dirs.get(d) || 0) + 1); }
    const top = [...dirs].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0][0];
    add('C8', 'scripts', 'info', 'outputs', `${plural(scripts.length, 'script builds', 'scripts build')} outputs outside the app, mostly in ${short(top, 28)}`, scripts.slice(0, 3).map(r => r.path), { members: scripts.map(r => r.path) });
  }
  // C9 — searches: none recorded while database exports are in the folder.
  if (c.searches === 0) {
    const exports = withRole(rows, 'search-export');
    if (exports.length) add('C9', 'searches', 'gap', 'search', `No search recorded; ${plural(exports.length, 'database export is', 'database exports are')} in the folder`, exports.slice(0, 3).map(r => r.path), { members: exports.map(r => r.path) });
  }
  // C10 — patient data: none recorded while a patient workbook is in the folder.
  if (c.participants === 0) {
    const pats = withRole(rows, 'patient-data');
    const f = lead(ctx, pats);
    if (f) add('C10', 'participants', 'gap', 'patients', `No patient recorded; ${short(baseOf(f.path))} is in the folder`, pats.slice(0, 3).map(r => r.path));
  }
  // C11 — manuscript: none in the app while a manuscript file is in the folder.
  if (c.manuscriptBlocks === 0) {
    const ms = withRole(rows, 'manuscript').filter(r => ['docx', 'doc', 'md'].includes(r.ext));
    const f = lead(ctx, ms);
    if (f) add('C11', 'manuscript', 'gap', 'manuscript', `No manuscript in the app; ${short(baseOf(f.path))} is in the folder`, ms.slice(0, 3).map(r => r.path));
  }
  // C12 — analysis: forest or funnel figures in the folder while the app ran no analysis.
  if (c.analyses === 0) {
    const plots = named(rows.filter(r => r.role !== 'script'), FOREST_NAME, new Set(['png', 'svg', 'pdf', 'tif', 'tiff', 'jpg', 'jpeg']));
    if (plots.length) add('C12', 'plots', 'info', 'analysis', `${plural(plots.length, 'forest or funnel plot comes', 'forest or funnel plots come')} from outside the app`, plots.slice(0, 3).map(r => r.path), { members: plots.map(r => r.path) });
  }
  // C13 — copies: the same file kept in two places (the twins the facts list), from TWIN_MIN pairs.
  // folders the project declares as copies of its working files (figure registry `copies`, e.g. "2 Figures") hold twins on purpose
  const copyDirs = arr(ctx.facts?.sidecars?.registry?.doc?.copies).filter(d => typeof d === 'string' && d);
  const declared = p => copyDirs.some(d => p === d || p.startsWith(`${d.replace(/\/+$/, '')}/`));
  const twins = arr(ctx.facts?.twins).filter(t => arr(t.paths).length > 1 && !t.paths.some(p => /(^|\/)(archive|old versions?)(\/|$)/i.test(p)) && !t.paths.some(declared));
  if (twins.length >= TWIN_MIN) {
    const paths = twins.flatMap(t => t.paths).sort(byText);
    add('C13', 'twins', 'info', 'outputs', `${plural(twins.length, 'file is', 'files are')} kept in two places of the folder`, twins.slice(0, 3).map(t => t.paths[0]), { members: paths });
  }
  // C15 — audits: a report in an audit or review folder whose findings no task came from (Tasks › More › Import findings from an audit).
  const imported = new Set(arr(c.auditSources));
  const reports = rows.filter(r => isAuditReport(r.path) && !imported.has(r.path));
  if (reports.length) add('C15', 'audits', 'gap', 'tasks', `${reports.length === 1 ? `${short(baseOf(reports[0].path))} has` : `${reports.length} audit reports have`} findings not in Tasks`, reports.slice(0, 3).map(r => r.path), { members: reports.map(r => r.path) });
  // C14 — the guide: longer than an agent is given at once, so its later rules are read only on request.
  const guide = rows.find(r => r.role === 'guide' && !r.path.includes('/'));
  if (guide && guide.size > GUIDE_BYTES) add('C14', 'guide', 'info', 'outputs', `${baseOf(guide.path)} is ${Math.round(guide.size / 1024)} KB; agents are given its first 16 KB`, [guide.path]);
  return out;
}

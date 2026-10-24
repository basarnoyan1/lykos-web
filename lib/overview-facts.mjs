// What "Where the paper stands" reads from a review (plan §2, Home page): the screening, the evidence table, risk of bias by instrument,
// the pooled analyses, their certainty, the package, the manuscript and the submission, as plain facts and the numbers each stage's chart
// draws. lib/overview-stages.mjs turns them into stage cards and lib/overview-panel.mjs draws them. Nothing is stored and nothing here
// draws; each fact is read from the same functions as the page it opens, so the two cannot differ.
import { funnel, includedStudies } from './progress.mjs';
import { JUDGEMENT_TONE } from '../schema.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { isComplete, isChecklist, itemsMet, gradeBy } from './appraisal-summary.mjs';
import { effectiveAnswers, STUDY } from './rob-review.mjs';
import { shownOutcomes, analysisOf } from './outcomes.mjs';
import { measureOf, isRatio } from './effect-measures.mjs';
import { checks, inputs } from './progress-gate.mjs';
import { partState } from './package-state.mjs';
import { normaliseSubmissions, summaryLine, ordered, statusOf } from './submissions.mjs';
import { targetJournal } from './workflow.mjs';
import { prismaData } from './prisma-counts.mjs';
import { certainty } from './grade.mjs';
import { toRate } from './grade-rated.mjs';
import { analysisUse } from './paper-use.mjs';
import { structureCounts } from './manuscript-structure.mjs';
import { activeProfile } from './journal-profile-state.mjs';
import { when } from './dates.mjs';
import { cellState } from './extraction-summary.mjs';
import { readinessReport } from './submission-checks.mjs';
import { declaredStatements } from './manuscript-submission.mjs';
import { readinessScore } from './readiness-score.mjs';
import { unchecked } from './progress.mjs';
import { researchType } from './workflow.mjs';
import { prismaNeeded } from '../schema.mjs';
import { checklistOf, checklistStates } from './checklist-core.mjs';   // not lib/checklist.mjs: its `supported` loads the analysis checks
import { standingOf } from './journal-standing.mjs';

const baseOf = p => String(p || '').slice(String(p || '').lastIndexOf('/') + 1);
/** The field of a value's key ("paper:template.column@arm1" -> "template.column"). */
const fieldOf = key => key.slice(key.indexOf(':') + 1).replace(/[@#].*$/, '');
const num = n => Number(n || 0).toLocaleString('en');

/**
 * Screening as one PRISMA-like line ("467 identified → 460 screened → 167 full text → 48 included") from lib/progress.mjs funnel(), the
 * merged duplicates among the identified; `left` is what is not screened or assessed, of `of`.
 */
/**
 * The records behind each screening step, for a press on its bar (owner, 2026-10-22: "every graph interactive"): every record; those with a
 * title and abstract decision; those assessed at full text; the included studies. The bar's figure is the funnel's own count.
 */
export function screeningIds(s) {
  const papers = s.papers || [], done = d => d === 'include' || d === 'exclude';
  return { identified: papers.map(p => p.id), screened: papers.filter(p => done(s.screening?.[p.id]?.decision)).map(p => p.id),
    'full text': papers.filter(p => done(s.fulltext?.[p.id]?.decision)).map(p => p.id), included: includedStudies(s).map(p => p.id) };
}
export function screeningLine(fun = [], duplicates = 0) {
  const by = Object.fromEntries((fun || []).map(f => [f.name, f]));
  const n = x => Math.max(0, Number(x) || 0);
  const steps = [['identified', n(by.Identified?.n) + n(duplicates)], ['screened', n(by.Screened?.n)], ['full text', n(by['Full text']?.n)], ['included', n(by.Included?.n)]];
  const taLeft = Math.max(0, n(by.Screened?.pool) - n(by.Screened?.n)), ftLeft = Math.max(0, n(by['Full text']?.pool) - n(by['Full text']?.n));
  return { steps, text: steps.map(([w, k]) => `${num(k)} ${w}`).join(' → '), left: taLeft + ftLeft, of: n(by.Screened?.pool) + n(by['Full text']?.pool) };
}

/** The reasons reports were excluded at full text, from PRISMA's "Reason, n; Reason, n", the most frequent first. */
export function exclusionReasons(text) {
  const out = [];
  for (const part of String(text || '').split(';')) {
    const m = /^(.*?),\s*(\d+)\s*$/.exec(part.trim());
    if (m && m[1].trim() && Number(m[2]) > 0) out.push({ reason: m[1].trim(), n: Number(m[2]) });
  }
  return out.sort((a, b) => b.n - a.n);
}

// A cell a table holds but the paper does not report: the evidence table writes it as NR or NA rather than leaving it empty.
const NOT_REPORTED = /^(?:nr|not reported|none reported)$/i;   // NA is a value, as Extraction counts it
const textOf = v => String(v?.reported_value ?? v?.value ?? v?.normalized_value ?? '').trim();

/**
 * The evidence table: its tables by the values they hold (the fullest first), how many of the included studies it holds values for, how
 * many values, and when the fullest table's source file was last read: its import, or a folder sync of it (s.autoSync.log), whichever is
 * newer. `collections` are the review's top-level collections (Table 1, Table 2 …) with the included studies each holds, `unfiled` the
 * included studies in none; `cells` counts each study's field of the tables in use once (its arms together): with a value (NA included), NR, or empty.
 */
export function evidenceFacts(s, included, now = Date.now()) {
  const inc = new Set(included.map(p => p.id)), tableOf = new Map(), per = new Map(), held = new Set(), cell = new Map();
  for (const t of s.templates || []) for (const c of t.columns || []) tableOf.set(c.id, t.id);
  let values = 0;
  const maps = s.extractionSummary?.fields || {};
  for (const [key, v] of Object.entries(s.values || {})) {
    const paperId = key.slice(0, key.indexOf(':'));
    if (!v || !inc.has(paperId)) continue;
    values++; held.add(paperId);
    const field = fieldOf(key), t = tableOf.get(field);
    if (t) per.set(t, (per.get(t) || 0) + 1);
    // a cell is read as Extraction reads it (lib/extraction-summary.mjs cellState, with the summary's groupings), so both pages give one share
    const state = NOT_REPORTED.test(textOf(v)) ? 'not_reported' : cellState(v, maps[field] || null), at = `${paperId}:${field}`;
    if (state === 'present') cell.set(at, 'filled');
    else if (state === 'not_reported' && cell.get(at) !== 'filled') cell.set(at, 'nr');
  }
  const tables = (s.templates || []).filter(t => per.get(t.id)).sort((a, b) => per.get(b.id) - per.get(a.id));
  const main = tables[0];
  const synced = main ? (s.autoSync?.log || []).filter(e => typeof e?.key === 'string' && e.key.endsWith(`:${main.id}`)).map(e => e.at) : [];
  const at = [main?.source?.importedAt, ...synced].filter(Boolean).sort().at(-1);
  const file = baseOf(main?.source?.file);
  const columns = tables.reduce((n, t) => n + (t.columns || []).length, 0), total = columns * included.length;
  let filled = 0, nr = 0;
  for (const [k, state] of cell) if (tableOf.has(k.slice(k.indexOf(':') + 1))) { if (state === 'filled') filled++; else nr++; }
  const filed = new Set(), collections = [];
  for (const c of (s.collections || []).filter(c => c && !c.parent)) {
    const members = (c.members || []).filter(id => inc.has(id));
    if (!members.length) continue;
    members.forEach(id => filed.add(id));
    collections.push({ name: c.name || 'Untitled collection', n: members.length, ids: members });
  }
  collections.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { tables: tables.map(t => t.name || 'Untitled table'), studies: held.size, of: included.length, values,
    read: at ? `read ${when(at, now)}${file ? ` from ${file}` : ''}` : '',
    collections, unfiled: collections.length ? included.length - filed.size : 0,
    cells: { filled, nr, empty: Math.max(0, total - filled - nr), total } };
}

const TONE_RANK = { good: 0, unclear: 1, bad: 2, critical: 3, none: 4 };
const WORST = new Set(['Critical', 'Very high']);
/** The traffic-light tone of a judgement (lib/appraisal-mark.mjs verdictTone, the same table); a level that qualifies a known one ("Low (except …)") takes its tone. */
export const toneOf = level => !level ? 'none' : WORST.has(level) ? 'critical' : JUDGEMENT_TONE[level] || JUDGEMENT_TONE[String(level).replace(/\s*\(.*$/, '')] || 'none';
const ITEM_ORDER = ['Yes', 'Partial yes', 'Unclear', "Can't tell", 'No', 'Not applicable'];

/**
 * Risk of bias: the included studies by the instrument each is appraised with (most used first), how many assessments are complete as
 * Appraisal counts them, and for each instrument the stack its summary bar draws: the studies by their overall judgement in the
 * instrument's own levels where it asks for one (unit 'studies'); for a checklist, the studies by the grade the review's stated rule gives
 * (s.appraisalRule); else every item across its studies by answer (unit 'items'). Segments are { level, tone, n } in traffic-light order; a study
 * not yet judged is a segment of its own, 'Not judged'.
 */
export function appraisalFacts(s, included) {
  const by = new Map();
  let complete = 0;
  for (const p of included) {
    const tool = instrumentFor(s, p.id);
    const e = by.get(tool.id) || { id: tool.id, name: tool.name || tool.id, n: 0, complete: 0, tool, counts: new Map(), ids: new Map() };
    const answers = effectiveAnswers(s, p.id, tool.id, STUDY).answers;
    const done = isComplete(tool, answers);
    e.n++; if (done) { e.complete++; complete++; }
    const add = (level, k = 1) => { e.counts.set(level, (e.counts.get(level) || 0) + k); (e.ids.get(level) || e.ids.set(level, new Set()).get(level)).add(p.id); };
    if (tool.overall) add(answers.overall || 'Not judged');
    else if (isChecklist(tool) && s.appraisalRule) { const m = itemsMet(answers, tool); add(m.unanswered ? 'Not judged' : gradeBy(m.pct, s.appraisalRule) || 'Not judged'); }
    else for (const d of tool.domains) add(answers[d.id] || 'Not judged');
    by.set(tool.id, e);
  }
  const instruments = [...by.values()].sort((a, b) => b.n - a.n).map(({ tool, counts, ids, ...e }) => {
    const unit = tool.overall || (isChecklist(tool) && s.appraisalRule) ? 'studies' : 'items';
    const order = [...(tool.judgements || []), ...ITEM_ORDER];
    const segments = [...counts].map(([level, n]) => ({ level, n, tone: level === 'Not judged' ? 'none' : toneOf(level), ids: [...(ids.get(level) || [])] }))
      .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || (a.level === 'Not judged') - (b.level === 'Not judged') || order.indexOf(a.level) - order.indexOf(b.level));
    return { ...e, unit, segments };
  });
  return { instruments, complete, of: included.length };
}

/**
 * The pooled analyses: how many are current, changed since their inputs, without an input record, or not yet checked (the checks not
 * loaded), counted over the analyses the paper uses; how many the paper does not use (lib/paper-use.mjs: nothing past their results reads
 * them), whatever their state; outcomes not run. `rows` are the analyses that ran, each { id, name, measure, kind, est, lo, hi, k, status,
 * used }: kind is 'percent' for a proportion, 'ratio' for a ratio measure and 'difference' for the rest, so the forest can put each on its
 * own scale.
 */
export function analysisFacts(s) {
  const out = { current: 0, changed: 0, untracked: 0, unknown: 0, unused: 0, notRun: 0, rows: [] };
  const use = (shownOutcomes(s).some(o => analysisOf(s, o.id)) && analysisUse(s)) || new Map();
  for (const o of shownOutcomes(s)) {
    const a = analysisOf(s, o.id);
    if (!a) { out.notRun++; continue; }
    const st = inputs.pooledInputStatus(s, a, o.id);
    const status = ['current', 'stale', 'untracked'].includes(st) ? st : 'unknown', used = use.get(o.id)?.used !== false;
    if (!used) out.unused++;
    else if (status === 'current') out.current++; else if (status === 'stale') out.changed++; else if (status === 'untracked') out.untracked++; else out.unknown++;
    const measure = a.measure || o.measure, est = Number(a.estimate ?? a.est), lo = Number(a.lo), hi = Number(a.hi);
    const kind = measureOf(measure).family === 'proportion' ? 'percent' : isRatio(measure) ? 'ratio' : 'difference';
    out.rows.push({ id: o.id, name: o.name || 'Outcome', measure, kind, est, lo, hi, k: Number(a.k ?? a.studies) || null, status, used });
  }
  return out;
}

/** Certainty: each GRADE row with its level (an override wins, as the Summary of findings prints it), and the analysed outcomes no row rates yet. */
export function certaintyFacts(s) {
  const rows = (s.grade || []).filter(Boolean).map(g => ({ name: String(g.name || '').trim() || 'Unnamed outcome', level: certainty(g).final, rated: certainty(g).rated }));
  return { rows, toRate: toRate(s).map(o => o.name || 'Outcome') };
}

/**
 * The manuscript: its words, its errors and warnings once the manuscript checks are here (lib/progress-gate.mjs; the reference list's own
 * checks are not counted), the main text's words by section as the journal counts them (lib/manuscript-structure.mjs), and the journal
 * profile's limit on them when it states one.
 */
export function manuscriptFacts(s) {
  const blocks = s.manuscript?.blocks || [];
  const words = blocks.reduce((n, b) => n + String(b.text || '').split(/\s+/).filter(Boolean).length, 0);
  const all = blocks.length ? checks.module()?.manuscriptFindings(s) : null;
  const issues = all ? all.filter(i => !String(i.kind || '').startsWith('ref-')) : null;
  const main = blocks.length ? structureCounts(blocks).main : { words: 0, sections: [] };
  return { words, errors: issues ? issues.filter(i => i.severity === 'error').length : 0, warnings: issues ? issues.filter(i => i.severity === 'warn').length : null,
    main: main.words, sections: main.sections.filter(x => x.words > 0).map(x => ({ name: x.name, words: x.words })), limit: activeProfile(s.journalProfile)?.wordLimit || null };
}

// A manuscript of another kind than the project's (a Perspective, an editorial, a letter, a case report): its sections and citations say nothing
// about the review's readiness. A review project's manuscript is one titled as none of those that has Methods or Results.
// (lib/manuscript-fit.mjs, light, so the manuscript's numbering and Submission › Files read it too)
export { manuscriptFit } from './manuscript-fit.mjs';
import { manuscriptFit } from './manuscript-fit.mjs';

/**
 * The PRISMA counts a flow diagram of this review needs: its database branch and the branches it draws. Optional boxes (registers, automation,
 * other removals) count only when filled; the other methods' sources (websites, organisations, citation searching) are one requirement, met
 * by any of them, as a review fills the sources it used.
 */
export { prismaNeeded } from '../schema.mjs';   // the PRISMA counts the flow asks for, as progress (Needs attention) counts them too

/**
 * Submission readiness for the target journal (lib/readiness-score.mjs), from the stages' own facts `f`, the Submission page's readiness checks
 * of the manuscript against the journal's profile (the same report its inspector shows), the reporting checklist, the journal's standing
 * (lib/journal-standing.mjs) and whether the manuscript is the review at all.
 */
export function readinessFacts(s, f) {
  const sc = f.screening, ev = f.evidence, rob = f.appraisal, an = f.analyses, ce = f.certainty;
  const blocks = s.manuscript?.blocks || [];
  const profile = activeProfile(s.journalProfile), type = researchType(s);
  const issues = blocks.length ? checks.module()?.manuscriptFindings(s) || [] : [];
  const report = blocks.length ? readinessReport({ blocks, assets: [], notes: s.manuscript?.notes || {}, section: s.manuscript?.section || null, profile, researchType: type.id,
    checks: issues, declarations: declaredStatements(s.declarations, s.paper, type.id) }) : null;
  // what a model wrote into the review's data: values, GRADE footnotes and patient rows (reading notes are not the paper's)
  const footnotes = (s.grade || []).flatMap(g => Object.values(g?.explanations || {}));
  const written = [...Object.values(s.values || {}), ...footnotes, ...(s.participants || [])].filter(x => String(x?.extractor || '').startsWith('model:'));
  const rated = ce ? ce.rows.filter(r => r.rated !== false).length : 0;
  const cl = checklistOf(s), st = checklistStates(s);
  const fit = manuscriptFit(s, type.id, type.label), standing = standingOf(s);
  const score = readinessScore({
    screening: sc ? { identified: sc.steps?.[0]?.[1] || 0, left: sc.left || 0 } : null,
    cells: ev?.cells || null,
    appraisal: rob ? { complete: rob.complete, of: rob.of } : null,
    analyses: an ? { current: an.current, stale: an.changed + an.untracked + an.unknown, notRun: an.notRun, unused: an.unused || 0 } : null,
    certainty: ce ? { rated, of: ce.rows.length + ce.toRate.length } : null,
    prisma: prismaNeeded(s),
    checklist: cl?.items?.length ? { done: cl.items.filter(([n]) => st[n]?.state === 'done').length, na: cl.items.filter(([n]) => st[n]?.state === 'na').length, total: cl.items.length } : null,
    report, profile: !!profile, fit, standing, registered: !!String(s.paper?.registration || s.protocol?.registration || '').trim(),
    models: { written: written.length, unchecked: written.filter(unchecked).length } });
  // `report`: the journal checks it weighed, which Submission › Files scores the manuscript by (lib/file-quality.mjs), so the two agree
  return { ...score, journal: targetJournal(s), standing, fit, checklistName: cl?.name || '', report };
}

/** Everything the stages read, for the review `s` on the day `today` (YYYY-MM-DD). */
export function standingFacts(s, today, now = Date.now()) {
  const included = includedStudies(s);
  const subs = normaliseSubmissions(s.submissions);
  return {
    screening: { ...screeningLine(funnel(s), (s.merged || []).length), reasons: exclusionReasons(prismaData(s).dbr_excluded), ids: screeningIds(s) },
    evidence: included.length ? evidenceFacts(s, included, now) : null,
    appraisal: included.length ? appraisalFacts(s, included) : null,
    analyses: analysisFacts(s),
    certainty: certaintyFacts(s),
    package: (s.package?.parts || []).map(p => ({ name: p.name, state: partState(s.package, p, { state: s }).state })),
    manuscript: manuscriptFacts(s),
    submission: { line: subs.length ? summaryLine(subs, today) : '', target: targetJournal(s),
      attempts: ordered(subs).slice(0, 3).map(a => { const st = statusOf(a); return { journal: a.journal?.label || 'Untitled journal', kind: st.kind, word: st.word }; }) },
  };
}

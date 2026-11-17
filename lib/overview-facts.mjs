// What "Where the paper stands" reads from a review (plan §2, Home page): the screening, the evidence table, risk of bias by instrument,
// the pooled analyses, their certainty, the package, the manuscript and the submission, as plain facts and the numbers each stage's chart
// draws. lib/overview-stages.mjs turns them into stage cards and lib/overview-panel.mjs draws them. Nothing is stored and nothing here
// draws; each fact is read from the same functions as the page it opens, so the two cannot differ.
import { lib_progress$funnel as funnel, lib_progress$includedStudies as includedStudies } from "../boot.mjs";
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";
import { schema$JUDGEMENT_TONE as JUDGEMENT_TONE } from "../boot.mjs";
import { instrumentFor } from './study-instrument.mjs';
import { isChecklist, itemsMet, gradeBy } from './appraisal-summary.mjs';
import { lib_outcomes$shownOutcomes as shownOutcomes, lib_outcomes$analysisOf as analysisOf } from "../boot.mjs";
import { lib_effect_measures$measureOf as measureOf, lib_effect_measures$isRatio as isRatio } from "../boot.mjs";
import { lib_progress_gate$checks as checks, lib_progress_gate$inputs as inputs } from "../boot.mjs";
import { partState } from './package-state.mjs';
import { lib_submissions$normaliseSubmissions as normaliseSubmissions, lib_submissions$summaryLine as summaryLine, lib_submissions$ordered as ordered, lib_submissions$statusOf as statusOf } from "../boot.mjs";
import { lib_workflow$targetJournal as targetJournal } from "../boot.mjs";
import { prismaData } from './prisma-counts.mjs';
import { certainty } from './grade.mjs';
import { toRate } from './grade-rated.mjs';
import { analysisUse } from './paper-use.mjs';
import { structureCounts } from './manuscript-structure.mjs';
import { activeProfile } from './journal-profiles.mjs';
import { profileFor } from './journal-context.mjs';
import { lib_dates$when as when } from "../boot.mjs";
import { cellState } from './extraction-summary.mjs';
import { readinessReport } from './submission-checks.mjs';
import { declaredStatements } from './manuscript-submission.mjs';
import { readinessScore } from './readiness-score.mjs';
import { lib_progress$unchecked as unchecked } from "../boot.mjs";
import { lib_workflow$researchType as researchType } from "../boot.mjs";
import { schema$prismaNeeded as prismaNeeded } from "../boot.mjs";
import { checklistOf, checklistStates } from './checklist-core.mjs';   // not lib/checklist.mjs: its `supported` loads the analysis checks
import { standingOf } from './journal-standing.mjs';
import { reviewStudies, studyAppraisal, personChecks, externalOutputs } from './review-state.mjs';
import { lib_workflow$projectMode as projectMode, lib_workflow$modeSections as modeSections } from "../boot.mjs";
import { projectRule } from './rob-overall.mjs';
import { ownerDraft, heldNow, textOf as fieldText } from './protocol-fields.mjs';

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
  // the same sets the funnel counts (lib/review-counts.mjs): a stage's decided records, and the included studies
  const c = reviewCounts(s), decided = st => { const open = new Set(st.ids.toDecide); return st.ids.records.filter(id => !open.has(id)); };
  return { identified: (s.papers || []).map(p => p.id), screened: decided(c.ta), 'full text': decided(c.ft), included: includedStudies(s).map(p => p.id) };
}
export function screeningLine(fun = [], duplicates = 0, studies = null) {
  const by = Object.fromEntries((fun || []).map(f => [f.name, f]));
  const n = x => Math.max(0, Number(x) || 0);
  // `studies`: a review's included trials (lib/review-state.mjs), which the included step then counts in place of the funnel's records
  const steps = [['identified', n(by.Identified?.n) + n(duplicates)], ['screened', n(by.Screened?.n)], ['full text', n(by['Full text']?.n)], ['included', studies ?? n(by.Included?.n)]];
  const taLeft = Math.max(0, n(by.Screened?.pool) - n(by.Screened?.n)), ftLeft = Math.max(0, n(by['Full text']?.pool) - n(by['Full text']?.n));
  return { steps, text: steps.map(([w, k]) => `${num(k)} ${w}`).join(' → '), left: taLeft + ftLeft, of: n(by.Screened?.pool) + n(by['Full text']?.pool) };
}

/**
 * Screening as a review's trials (lib/review-state.mjs reviewStudies): the included step is the studies; what is left to decide is the
 * records not screened (or uncertain) at title and abstract and the includes waiting for a full-text decision; records uncertain at full
 * text and those awaiting classification are said apart, not as screening left.
 */
export function reviewScreening(r, c = null) {
  // `c`: lib/review-counts.mjs, whose to decide is Screening's own (no decision yet, or uncertain) at each stage (1 Nov 2026: this said
  // 208 to decide where Screening's full-text list held 265, the 208 waiting and 57 uncertain)
  const taOpen = c ? c.ta.toDecide : r.taOpen.length, ftOpen = c ? c.ft.toDecide : r.waiting.length;
  return { included: r.studies.length, reports: r.reports.length, noPdf: r.provisional.length, waiting: r.waiting.length, taOpen, ftOpen,
    ftUncertain: r.ftUncertain.length, awaiting: r.awaiting.length, left: taOpen + ftOpen };
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
  // an outcome entry's columns are not a study's cells: Extraction counts their statistics per instrument (views/extraction-hub.mjs
  // hubCounts), and they are alternatives (SD, SE or IQR), so one left blank is no gap (Sham, 17 Nov 2026: 3,210 cells read as empty)
  const studyColumns = t => (t.columns || []).filter(c => c.group !== 'outcome');
  for (const t of s.templates || []) for (const c of studyColumns(t)) tableOf.set(c.id, t.id);
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
  const columns = tables.reduce((n, t) => n + studyColumns(t).length, 0), total = columns * included.length;
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
export function appraisalFacts(s, included, { checks = null } = {}) {
  const by = new Map();
  let complete = 0, derived = 0;
  for (const p of included) {
    // the overall a study's domains give by the project's rule when none was recorded (31 Oct 2026: 110 RoB 2 assessments with every
    // domain judged and no overall read "Not started"); the MCP overview counts the same (lib/review-state.mjs studyAppraisal)
    const a = studyAppraisal(s, p.id, checks ? { checks } : { rule: projectRule(instrumentFor(s, p.id).id) }), tool = a.tool, answers = a.answers;
    const e = by.get(tool.id) || { id: tool.id, name: tool.name || tool.id, n: 0, complete: 0, tool, counts: new Map(), ids: new Map() };
    const done = a.complete;
    e.n++; if (done) { e.complete++; complete++; if (a.derived) derived++; }
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
  return { instruments, complete, of: included.length, derived };
}

/**
 * The pooled analyses: how many are current, changed since their inputs, without an input record, or not yet checked (the checks not
 * loaded), counted over the analyses the paper uses; how many the paper does not use (lib/paper-use.mjs: nothing past their results reads
 * them), whatever their state; outcomes not run. `rows` are the analyses that ran, each { id, name, measure, kind, est, lo, hi, k, status,
 * used }: kind is 'percent' for a proportion, 'ratio' for a ratio measure and 'difference' for the rest, so the forest can put each on its
 * own scale.
 */
export function analysisFacts(s, { everyUsed = false } = {}) {
  const out = { current: 0, changed: 0, untracked: 0, unknown: 0, unused: 0, notRun: 0, rows: [] };
  // `everyUsed`: the manuscript is not the review's (lib/manuscript-fit.mjs), so which analyses the paper uses cannot be read from it: all count
  const use = (!everyUsed && shownOutcomes(s).some(o => analysisOf(s, o.id)) && analysisUse(s)) || new Map();
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
export { schema$prismaNeeded as prismaNeeded } from "../boot.mjs";   // the PRISMA counts the flow asks for, as progress (Needs attention) counts them too

/**
 * Submission readiness for the target journal (lib/readiness-score.mjs), from the stages' own facts `f`, the Submission page's readiness checks
 * of the manuscript against the journal's profile (the same report its inspector shows), the reporting checklist, the journal's standing
 * (lib/journal-standing.mjs) and whether the manuscript is the review at all.
 */
export function readinessFacts(s, f) {
  const sc = f.screening, ev = f.evidence, rob = f.appraisal, an = f.analyses, ce = f.certainty;
  const blocks = s.manuscript?.blocks || [];
  // the target journal's profile when the project keeps none (lib/journal-context.mjs profileFor)
  const profile = profileFor(s), type = researchType(s);
  const issues = blocks.length ? checks.module()?.manuscriptFindings(s) || [] : [];
  // a manuscript built outside Lykos (lib/review-state.mjs externalOutputs) is scored by the journal checks run on it when it was registered
  // (tools/lykos-register.mjs: the same readinessReport, on the Word file's blocks); the Manuscript page's own wins when it has text
  const xm = f.manuscript?.external || null, xa = f.analyses?.external || null;
  const report = blocks.length ? readinessReport({ blocks, assets: [], notes: s.manuscript?.notes || {}, section: s.manuscript?.section || null, profile, researchType: type.id,
    checks: issues, declarations: declaredStatements(s.declarations, s.paper, type.id) }) : xm?.journal?.sections?.length ? { sections: xm.journal.sections } : null;
  // what a model wrote into the review's data: values, GRADE footnotes and patient rows (reading notes are not the paper's)
  const footnotes = (s.grade || []).flatMap(g => Object.values(g?.explanations || {}));
  const written = [...Object.values(s.values || {}), ...footnotes, ...(s.participants || [])].filter(x => String(x?.extractor || '').startsWith('model:'));
  const rated = ce ? ce.rows.filter(r => r.rated !== false).length : 0;
  const cl = checklistOf(s), st = checklistStates(s);
  const fit = !blocks.length && report ? { ok: true } : manuscriptFit(s, type.id, type.label), standing = standingOf(s);
  // a manuscript that is not the review yet (an earlier paper being rewritten) says nothing about which analyses the review uses: all are scored
  const anAll = !fit.ok && an ? analysisFacts(s, { everyUsed: true }) : an;
  // analyses run by the project's scripts count as the paper's analyses: current while the data did not change after the run; an outcome
  // set up in Lykos and not run there is then not an analysis missing
  const external = xa ? { current: (xa.stale ? 0 : xa.analyses || 1) + (anAll?.current || 0), stale: (xa.stale ? xa.analyses || 1 : 0) + (anAll ? anAll.changed + anAll.untracked : 0), notRun: 0, unused: anAll?.unused || 0 } : null;
  // a registered checklist (its Location column filled per item) stands for the reporting checklist while the app's has nothing recorded
  const xcl = (xm?.checklists || []).find(c => cl?.name && String(c.name || '').toLowerCase() === cl.name.toLowerCase()) || (xm?.checklists || [])[0] || null;
  const inApp = cl?.items?.length ? { done: cl.items.filter(([n]) => st[n]?.state === 'done').length, na: cl.items.filter(([n]) => st[n]?.state === 'na').length, total: cl.items.length } : null;
  const score = readinessScore({
    screening: sc ? { identified: sc.steps?.[0]?.[1] || 0, left: sc.left || 0 } : null,
    cells: ev?.cells || null,
    appraisal: rob ? { complete: rob.complete, of: rob.of } : null,
    // an analysis whose input check has not loaded yet is unknown, not changed: the part is not assessed until it is (28 Oct 2026: a caller
    // without the checks scored the ASD review 71 for "8 analyses changed since run", 87 with them)
    analyses: external || (anAll && !anAll.unknown ? { current: anAll.current, stale: anAll.changed + anAll.untracked, notRun: anAll.notRun, unused: anAll.unused || 0 } : null),
    // analyses run outside with no GRADE row: one outcome not rated, so certainty is not taken as met for want of outcomes to rate
    certainty: ce ? { rated, of: Math.max(ce.rows.length + ce.toRate.length, xa && !ce.rows.length ? 1 : 0) } : null,
    prisma: prismaNeeded(s, prismaData(s)),   // the counts the diagram draws, derived or entered
    checklist: xcl?.items && !(inApp && inApp.done + inApp.na) ? { done: xcl.located || 0, na: xcl.na || 0, total: xcl.items, file: xcl.file } : inApp,
    report, profile: !!profile, profileName: profile?.name || '', fit, standing, registered: !!String(s.paper?.registration || s.protocol?.registration || '').trim(),
    models: { written: written.length, unchecked: written.filter(unchecked).length }, persons: f.checks || null });
  // `report`: the journal checks it weighed, which Submission › Files scores the manuscript by (lib/file-quality.mjs), so the two agree
  // the journal checks of a registered manuscript say which file and when they were run on
  const from = xm && !blocks.length && report ? xm.file : '';
  if (from) { const j = score.parts.find(p => p.id === 'journal'); if (j?.assessed) j.detail = `${j.detail} (checked on ${from.slice(from.lastIndexOf('/') + 1)}, ${xm.days?.built || String(xm.builtAt).slice(0, 10)})`; }
  return { ...score, journal: targetJournal(s), standing, fit, checklistName: cl?.name || '', report, ...(from ? { reportFrom: from } : {}) };
}

/** Everything the stages read, for the review `s` on the day `today` (YYYY-MM-DD). */
/**
 * The protocol's card (plan W13, finding 6): its criteria by kind, its registration, its last version and what waits for the owner: the
 * changes an agent made, held for them (lib/held-changes.mjs, counted in lib/protocol-fields.mjs heldNow), and their own edits since the
 * last version (ownerDraft). { criteria, include, exclude, registration, version, held, edited, since }.
 */
export function protocolFacts(s) {
  const criteria = (s.protocol?.criteria || []).filter(c => c && fieldText(c.text).trim());
  const draft = ownerDraft(s);
  return { criteria: criteria.length, include: criteria.filter(c => (c.kind || 'include') === 'include').length, exclude: criteria.filter(c => c.kind === 'exclude').length,
    registration: fieldText(s.paper?.registration).trim(), version: (s.protocolVersions || []).at(-1)?.v || 0, held: heldNow().length,
    edited: draft ? draft.rows.length : 0, since: draft?.since || 0 };
}

// What each card of standingFacts reads of the project, as top-level sections (a list, or a function of the project where the list depends on it):
// the Overview keeps a card through edits to the other sections (cardKeeper, views/overview.mjs). app/test/memo-sections.test.mjs fails a card that
// reads a section outside its list. A card with no entry is kept by the project's version, because it reads most of the project: analyses and
// certainty (lib/paper-use.mjs builds the graph of the whole project once its module is loaded), manuscript (the manuscript checks, once
// lib/progress-checks.mjs is loaded), package (an item drawn by the app), checks (lib/person-checks.mjs). `FACT_IGNORED` names what a card's
// computation reads and its answer does not depend on (Screening's funnel also counts the extracted and the appraised); a test shows an edit to
// those leaves the answer as it was. The review's studies, which several cards ask for, read the project's mode, papers, screening and fulltext.
// Not project sections: the day, the checks' state and the robustness rule (views/overview.mjs adds them to every card's key), and the held
// changes the folder holds, which the Protocol card counts.
const STUDIES = s => ['papers', 'screening', 'fulltext', ...modeSections(s)];
export const FACT_SECTIONS = {
  protocol: () => ['protocol', 'paper', 'protocolVersions', 'eligibilityRules'],
  screening: s => ['merged', 'searches', 'prisma', 'settings', 'protocol', ...STUDIES(s)],
  evidence: s => ['values', 'templates', 'extractionSummary', 'collections', 'autoSync', ...STUDIES(s)],
  appraisal: s => ['robReview', 'appraisalByStudy', 'assessments', 'appraisalTool', 'values', 'templates', 'customInstruments', 'appraisalRule', ...STUDIES(s)],
  submission: () => ['submissions', 'project', 'paper'],
};
export const FACT_IGNORED = {
  screening: ['values', 'templates', 'analysis', 'survival', 'outcomes', 'multiArm', 'customFields', 'proposals', 'assessments', 'appraisalByStudy', 'appraisalTool', 'robReview', 'customInstruments'],
};
export const FACT_CARDS = ['protocol', 'screening', 'evidence', 'appraisal', 'analyses', 'certainty', 'package', 'manuscript', 'checks', 'submission'];

/**
 * Keeps the cards of standingFacts: a card is answered again while the versions of the sections it reads (`sectionsAt`: store.sectionsVersion)
 * and what `extra(name)` says ({ text, same }: a text, and a value compared by identity) are the same. Pure: the store is handed in.
 */
export function cardKeeper(sectionsAt, versionAt, extra = () => ({ text: '', same: null })) {
  let held = new Map();
  // `sections` null: the card is kept by the project's version
  const keyOf = (name, sections) => { const e = extra(name); return { at: `${sections ? sectionsAt(...sections) : `v${versionAt()}`}|${e.text}`, same: e.same }; };
  return {
    keep(name, sections, compute) {
      const k = keyOf(name, sections), hit = held.get(name);
      if (hit && hit.at === k.at && hit.same === k.same) return hit.value;
      const value = compute(); held.set(name, { ...k, value }); return value;
    },
    /** The key of all the cards named now: the same while none of them would be worked out again (`sameKey`). */
    key(names, sectionsOf) { const ks = names.map(n => keyOf(n, sectionsOf(n))); return { at: ks.map(k => k.at).join('~'), same: ks.map(k => k.same) }; },
    clear() { held = new Map(); },
  };
}

/** Whether two keys of `cardKeeper().key` are the same. */
export const sameKey = (a, b) => !!a && !!b && a.at === b.at && a.same.length === b.same.length && a.same.every((x, i) => x === b.same[i]);

export function standingFacts(s, today, now = Date.now(), { checks: buildChecks = null, keep = null } = {}) {
  // `keep(name, sections, compute)`: the Overview's cardKeeper; with none every card is worked out
  const kept = (name, compute) => (keep ? keep(name, FACT_SECTIONS[name]?.(s) ?? null, compute) : compute());
  // a review counts its trials, not its records (lib/review-state.mjs): linked reports apart, and a record waiting for its full text is not included.
  // Each card asks for them itself (review-studies.mjs perVersion keeps the answer): which sections a card reads is then its own list.
  const reviewOf = () => (projectMode(s) === 'workspace' ? null : reviewStudies(s));
  const includedOf = review => (review ? review.studies : includedStudies(s));
  let external;   // the registered outputs, worked out once for the cards that ask
  const extOf = (review, included) => (review ? (external ??= externalOutputs(s, included, now)) : {});
  return {
    protocol: kept('protocol', () => protocolFacts(s)),
    screening: kept('screening', () => {
      const review = reviewOf(), included = includedOf(review), ids = screeningIds(s);
      if (review) ids.included = included.map(p => p.id);
      return { ...screeningLine(funnel(s), (s.merged || []).length, review?.studies.length), ...(review ? reviewScreening(review, reviewCounts(s)) : {}), reasons: exclusionReasons(prismaData(s).dbr_excluded), ids };
    }),
    evidence: kept('evidence', () => { const included = includedOf(reviewOf()); return included.length ? evidenceFacts(s, included, now) : null; }),
    appraisal: kept('appraisal', () => { const included = includedOf(reviewOf()); return included.length ? appraisalFacts(s, included, { checks: buildChecks }) : null; }),
    analyses: kept('analyses', () => { const review = reviewOf(); return { ...analysisFacts(s), external: extOf(review, includedOf(review)).analysis || null }; }),
    certainty: kept('certainty', () => certaintyFacts(s)),
    package: kept('package', () => (s.package?.parts || []).map(p => ({ name: p.name, state: partState(s.package, p, { state: s }).state }))),
    manuscript: kept('manuscript', () => { const review = reviewOf(); return { ...manuscriptFacts(s), external: extOf(review, includedOf(review)).manuscript || null }; }),
    checks: kept('checks', () => { const review = reviewOf(); return review ? personChecks(s, includedOf(review)) : null; }),
    submission: kept('submission', () => {
      const subs = normaliseSubmissions(s.submissions);
      return { line: subs.length ? summaryLine(subs, today) : '', target: targetJournal(s),
        attempts: ordered(subs).slice(0, 3).map(a => { const st = statusOf(a); return { journal: a.journal?.label || 'Untitled journal', kind: st.kind, word: st.word }; }) };
    }),
  };
}

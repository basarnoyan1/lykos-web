// The full submission bundle (plan K3): what a journal asks for beside the
// manuscript, from what the project holds.
//
//   prisma/          the PRISMA 2020 flow, its counts with where each came from
//                    (K1: a count entered by hand carries its explanation), and
//                    the checklist as a Word table
//   search/          the search strategies as PRISMA-S reports them
//   certainty/       (the Summary of Findings table and evidence profile: lib/bundle.mjs, in every bundle)
//   analysis/scripts the exact R each saved analysis ran, with the lockfile:
//                    the vendored runtime's and packages' versions and hashes
//   tables-and-figures/  each saved output, its spec and its files
//   screening/       the studies excluded at full text, with reasons
//   data/            the data extraction table and its codebook
//   references/      retractions and corrections: each included or cited record, when and
//                    where it was checked for notices, and what was found (lib/integrity.mjs)
//
// Everything here is read from the project; nothing is invented, and what is
// missing is said in unresolved.md by the bundle (lib/bundle.mjs), which also
// writes the manifest with each file's SHA-256.
import { PRISMA_GROUPS, PRISMA_FIELDS } from '../schema.mjs';
import { derive } from './prisma-counts.mjs';
import { checklistOf, checklistStates, STATES, supported } from './checklist.mjs';
import { compile as compileStrategy, toMarkdown as strategyMarkdown, toBlocks as strategyBlocks } from './prisma-s.mjs';
import { gradeTable, gradeTableMarkdown, gradeTableBlocks } from './sof.mjs';
import { manuscriptParts } from './docx-write-doc.mjs';
import { zip } from './zip.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { authorList } from './bib.mjs';
import { PRIMARY, outcomes, analysisOf } from './outcomes.mjs';
import { researchType } from './workflow.mjs';
import { isReviewType } from './research-types.mjs';
import { dtaInputs, dtaStatus, rCode as dtaCode } from './dta.mjs';
import { nmaInputs, nmaStatus, buildNetwork, rCode as nmaCode } from './nma.mjs';
import { currentSpec } from './output-spec.mjs';
import { outputFiles, outputStem } from './output-render.mjs';
import { evidenceTable } from './folder-outputs.mjs';
import { evidenceModel, publicationSheet } from './evidence-export.mjs';
import { entries as zipList, read as zipRead } from './unzip.mjs';
import { analysisReplay, analysisSvg, resultCsv, savedAnalyses } from './dataset-analysis.mjs';
import { loadReplayEngine, verifyReplayEngine, REPLAY_RUNNER } from './primary-replay.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { researchRecords } from './research-ledger.mjs';
import { advancedInputStatus } from './advanced-primary.mjs';
import { rocSvg, decisionCurveSvg } from './clinical-plots.mjs';
import { figureTokens } from './figure-style.mjs';
import { propensityStatus, propensityRows, propensityBalanceRows } from './propensity.mjs';
import { reportedRecords, retractionReport } from './integrity.mjs';

const csvCell = v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
export const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';

// Every Word and Excel file inside the bundle is stamped with one fixed time,
// so the same content makes the same bytes and an unchanged bundle is seen as
// unchanged (lib/bundle.mjs fingerprint).
export const FIXED_TIME = new Date(2020, 0, 1, 0, 0, 0);
const docx = blocks => zip(manuscriptParts({ blocks, renderCite: () => '', renderResult: () => null, references: [] }), { date: FIXED_TIME });

// ---- K1: the PRISMA counts and where each came from ------------------------------------

/**
 * Every flow count with its source: from the project (derived from screening
 * and the search log), entered by hand, or blank. A count entered by hand
 * shows the project's own count beside it when there is one, and the
 * explanation the reviewer gave (`s.prismaNotes`).
 */
export function prismaCountRows(s) {
  const derived = derive(s), entered = s.prisma || {}, notes = s.prismaNotes || {};
  // A label two phases share ("Reports sought for retrieval") is named with its phase.
  const shared = new Set(PRISMA_FIELDS.map(f => f.label).filter((l, i, all) => all.indexOf(l) !== i));
  const phaseOf = id => PRISMA_GROUPS.find(g => g.fields.some(f => f.id === id))?.phase || '';
  return PRISMA_FIELDS.map(f => {
    const hand = isHandEntered(entered[f.id], derived[f.id]);
    const value = hand ? entered[f.id] : derived[f.id];
    return {
      id: f.id, label: shared.has(f.label) ? `${f.label} (${phaseOf(f.id).toLowerCase()})` : f.label, count: value ?? '',
      source: hand ? 'Entered by hand' : value !== undefined && value !== '' ? 'From the project' : '',
      project: hand && derived[f.id] !== undefined ? derived[f.id] : '',
      explanation: hand ? String(notes[f.id] || '').trim() : '',
      hand,
    };
  });
}

/**
 * Whether a stored count was entered by hand: a value that differs from the
 * project's own count, or one the project has no count for. A stored value
 * equal to the project's (an import that wrote both) is the project's.
 */
export const isHandEntered = (entered, derived) => entered !== undefined && String(entered).trim() !== ''
  && String(entered).trim() !== String(derived ?? '').trim();
/** The ids of the counts entered by hand. */
export function handEnteredIds(s) {
  const derived = derive(s), entered = s.prisma || {};
  return PRISMA_FIELDS.filter(f => isHandEntered(entered[f.id], derived[f.id])).map(f => f.id);
}

/** Counts entered by hand that have no explanation (plan K1: an adjustment must be explained). */
export const unexplainedCounts = s => prismaCountRows(s).filter(r => r.hand && !r.explanation);

export function prismaCountsCsv(s) {
  return csv([['field', 'label', 'count', 'source', 'project_count', 'explanation'],
    ...prismaCountRows(s).map(r => [r.id, r.label, r.count, r.source, r.project, r.hand ? r.explanation || 'No explanation given' : ''])]);
}

/** The counts entered by hand, each with the project's count and why, for a reader of the bundle. */
export function handCountsMarkdown(s) {
  const rows = prismaCountRows(s).filter(r => r.hand);
  if (!rows.length) return null;
  const out = ['# PRISMA counts entered by hand', ''];
  for (const g of PRISMA_GROUPS) {
    const mine = rows.filter(r => g.fields.some(f => f.id === r.id));
    if (!mine.length) continue;
    out.push(`## ${g.phase}`, '');
    for (const r of mine) out.push(`- **${r.label}**: ${r.count}${r.project !== '' ? ` (the project counts ${r.project})` : ''}. ${r.explanation || 'No explanation given.'}`);
    out.push('');
  }
  return out.join('\n');
}

// ---- the checklist -----------------------------------------------------------------------

/** The project's reporting checklist, every item, with its state, where it is reported and what supports it. */
export function checklistRows(s) {
  const list = checklistOf(s), states = checklistStates(s), sup = supported(s);
  return list.items.map(([n, name, text]) => {
    const c = states[n] || {};
    return [n, name, text, STATES.find(x => x[0] === (c.state || ''))?.[1] || 'Not reviewed', c.where || '', sup[n] || ''];
  });
}
export const CHECKLIST_HEAD = ['Item', 'Name', 'Description', 'State', 'Where reported', 'Supported by'];

const checklistDocx = s => {
  const list = checklistOf(s);
  return docx([{ id: 'c1', type: 'p', text: `${list.name} checklist`, runs: [{ t: `${list.name} checklist`, b: true, sz: 14 }] },
    { id: 'c2', type: 'table', header: true, rows: [CHECKLIST_HEAD, ...checklistRows(s)] }]);
};

// ---- excluded studies ------------------------------------------------------------------------

/**
 * The reports assessed at full text and excluded, with the reviewer's reason:
 * what PRISMA 2020 item 16b and the flow's "reports excluded, with reasons"
 * ask for. A report not retrieved is listed as such, not as excluded.
 */
export function excludedStudies(s) {
  const ft = s.fulltext || {};
  return (s.papers || []).filter(p => ft[p.id]?.decision === 'exclude').map(p => {
    const d = ft[p.id];
    return { label: p.label || '', authors: authorList(p.authors).join('; '), year: String(p.year || ''), title: p.title || '',
      journal: p.journal || '', doi: p.doi || '', pmid: p.pmid || '',
      category: /not retriev/i.test(d.reason || '') ? 'Not retrieved' : 'Excluded', reason: d.reason || '', by: d.by || '', at: d.at || '' };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.reason.localeCompare(b.reason) || a.label.localeCompare(b.label));
}
const EXCLUDED_HEAD = ['Study', 'Authors', 'Year', 'Title', 'Journal', 'DOI', 'PMID', 'Category', 'Reason', 'Reviewer', 'Decided'];
const excludedRow = r => [r.label, r.authors, r.year, r.title, r.journal, r.doi, r.pmid, r.category, r.reason, r.by, r.at];

// ---- analysis scripts ---------------------------------------------------------------------------

/** Completed chat messages retain independent survival results, including archived chats. */
export function chatSurvivalRecords(s) {
  const threads = [...new Set(researchRecords(s,{type:'survival'}).map(r=>r.threadId))];
  return researchRecords(s,{type:'survival'}).map(r=>({...r,blockIndex:r.blockIndex,
    directory:`analysis/chat-survival/thread-${threads.indexOf(r.threadId)+1}-${slug(r.threadId||'chat')}/turn-${r.turn}/block-${r.blockIndex}`,
    currentSourceStatus:r.block.analysis?survivalInputStatus(s,r.block.analysis):'untracked'}));
}

/** The saved analyses and the R each ran: kept with the result (lib/r.mjs), or generated again for the same inputs where the code is a pure function of them. */
export function analysisScripts(s) {
  const out = [], missing = [];
  const header = (title, rs, how) => [`# ${title}`, `# ${how}`, rs?.at ? `# Run at ${rs.at}` : '',
    rs?.r ? `# ${rs.r}` : '', rs?.packages ? `# Packages: ${Object.entries(rs.packages).map(([p, v]) => `${p} ${v}`.trim()).join(', ')}` : '', ''].filter((l, i, all) => l || i === all.length - 1).join('\n');
  for (const o of outcomes(s)) {
    const a = analysisOf(s, o.id);
    if (!a) continue;
    const name = o.id === PRIMARY ? 'primary-outcome' : `${o.id}-${slug(o.name)}`;
    if (a.rScript?.code) out.push({ name: `analysis/scripts/${name}.R`, packages: Object.keys(a.rScript.packages || {}), rScript: a.rScript,
      data: `${header(`${o.name}${a.timepoint ? ` at ${a.timepoint}` : ''}: ${a.measure}, ${a.method}`, a.rScript, 'The code Lykos ran in WebR for this result.')}\n${a.rScript.code.trim()}\n` });
    else missing.push(`The R script of ${o.name} was not kept with its result: run the analysis again to include it.`);
  }
  const type = researchType(s).id;
  if (type === 'dta-review' && s.dta) {
    if (dtaStatus(s) === 'current') out.push({ name: 'analysis/scripts/accuracy.R', packages: ['metafor'],
      data: `${header(`Diagnostic accuracy: ${s.dta.method || 'REML'}`, null, 'The code Lykos runs in WebR for these inputs (library(metafor) attached first).')}\nlibrary(metafor)\n${dtaCode(dtaInputs(s).ready, { method: s.dta.method || 'REML' }).trim()}\n` });
    else missing.push('The accuracy analysis is out of date, so its script is not included.');
  }
  if (s.nma?.result) {
    if (nmaStatus(s) === 'current') { const inp = nmaInputs(s); out.push({ name: 'analysis/scripts/network.R', packages: ['metafor'],
      data: `${header(`Network meta-analysis: ${inp.measure}`, null, 'The code Lykos runs in WebR for these inputs (library(metafor) attached first).')}\nlibrary(metafor)\n${nmaCode(buildNetwork(inp.ready, inp.measure, inp.order)).trim()}\n` }); }
    else missing.push('The network meta-analysis is out of date, so its script is not included.');
  }
  if (s.survival) {
    const ext = s.survival.ext;
    const stages = ext ? ['km', 'reverse', 'tests', 'rmst', 'cox'].filter(stage => ext[stage]) : [];
    for (const stage of stages) {
      const rs = ext[stage].rScript;
      if (rs?.code) out.push({ name: `analysis/scripts/survival-${stage}.R`, packages: Object.keys(rs.packages || {}), rScript: rs,
        data: `${header(`Survival analysis: ${stage}`, rs, 'The exact code Lykos ran for this saved stage; its data are embedded in the script.')}\n${rs.code.trim()}\n` });
      else missing.push(`The survival ${stage} stage has no saved R script: rerun it to include the code.`);
    }
    if (!stages.length) {
      const rs = s.survival.rScript;
      if (rs?.code) out.push({ name: 'analysis/scripts/survival.R', packages: Object.keys(rs.packages || {}), rScript: rs,
        data: `${header('Survival analysis', rs, 'The exact code Lykos ran for this saved result.')}\n${rs.code.trim()}\n` });
      else missing.push('The saved survival result has no kept R scripts: rerun the survival analysis to include them.');
    }
    for (const [stage, why] of Object.entries(ext?.stages || {})) missing.push(`Survival ${stage} was not estimated: ${why}`);
  }
  for (const a of s.advancedAnalyses || []) {
    const rs = a.rScript || a.result?.rScript;
    if (rs?.code) out.push({ name: `analysis/scripts/advanced-${slug(a.id)}.R`, packages: Object.keys(rs.packages || {}), rScript: rs,
      data: `${header(`Advanced analysis: ${a.kind || a.title || a.id}`, rs, 'The exact code Lykos ran for this saved result.')}\n${rs.code.trim()}\n` });
    else missing.push(`Advanced analysis ${a.id} has no saved executable R script.`);
  }
  for (const record of chatSurvivalRecords(s)) {
    const rs = record.block.analysis?.ext?.km?.rScript;
    if (rs?.code) out.push({ name: `${record.directory}/km.R`, packages: Object.keys(rs.packages || {}), rScript: rs,
      data: `${header('Chat Kaplan–Meier analysis', rs, 'The exact code Lykos ran for this saved chat result; its analyzed data are embedded in the script.')}\n${rs.code.trim()}\n` });
    else missing.push(`Chat survival result ${record.threadId || 'chat'}, turn ${record.turn}, block ${record.blockIndex} has no saved executable R script.`);
  }
  return { scripts: out, missing };
}

/** Frozen primary results travel with both the working set and full bundle. */
export async function primaryAnalysisEntries(s, { replayEngine } = {}) {
  const entries = [], missing = [], list = savedAnalyses(s), recipes = [];
  const json = value => JSON.stringify(value, null, 2) + '\n';
  for (const a of list) {
    const recipe = analysisReplay(a, s), name = `${slug(a.id)}.json`;
    recipes.push({ a, recipe, name });
    entries.push({ name: `analysis/replay/results/${name}`, data: json(recipe) },
      { name: `analysis/primary/${slug(a.id)}.csv`, data: resultCsv(a.result) });
    if (a.result.prediction) {
      const prediction = a.result.prediction, dir = `analysis/models/${slug(a.id)}`;
      entries.push({ name: `${dir}/model.json`, data: json(prediction.model) }, { name: `${dir}/performance.json`, data: json(prediction.performance) },
        { name: `${dir}/validation-predictions.csv`, data: csv([['Source row (0-based)', 'Row ID', 'Split unit', 'Observed', 'Predicted'], ...prediction.predictions.map(r => [r.index, r.rowId, r.unit, r.observed, r.predicted])]) },
        { name: `${dir}/population.json`, data: json(prediction.population) });
      if (prediction.model.family === 'binary') entries.push({ name: `${dir}/validation-roc.svg`, data: rocSvg(prediction.performance.validation.auc, { title: 'Validation ROC', style: figureTokens(null, { medium: 'export' }) }) },
        { name: `${dir}/validation-decision-curve.svg`, data: decisionCurveSvg(prediction.performance.validation.decisionCurve, { title: 'Validation decision curve', style: figureTokens(null, { medium: 'export' }) }) });
    }
    if (a.result.plot) {
      try { const svg = analysisSvg(a.result.plot, { style: figureTokens(null, { medium: 'export' }) }); if (svg) entries.push({ name: `analysis/primary/${slug(a.id)}.svg`, data: svg }); }
      catch (err) { missing.push(`The figure for ${a.id} could not be exported: ${String(err?.message || err).slice(0, 120)}`); }
    }
    if (!recipe.data) missing.push(`Primary analysis ${a.id} has no frozen input rows: rerun and keep it before replay.`);
    if (!a.implementation?.engineFingerprint) missing.push(`Primary analysis ${a.id} has no recorded source fingerprint: rerun and keep it for an exact executable replay.`);
    if (recipe.currentSourceStatus !== 'current') missing.push(`Primary analysis ${a.id} uses earlier inputs. Its frozen recipe retains the original result; current project data have changed or are unavailable.`);
  }
  for (const a of s.propensityAnalyses || []) {
    const recipe = { format: 'lykos-propensity-analysis', version: 1, saved: structuredClone(a), implementation: a.implementation || null };
    const name = `propensity-${slug(a.id)}.json`;
    recipes.push({ a, recipe, name }); entries.push({ name: `analysis/replay/results/${name}`, data: json(recipe) });
    if (!a.frozenData) missing.push(`Propensity design ${a.id} has no frozen input rows.`);
    if (!a.implementation?.engineFingerprint) missing.push(`Propensity design ${a.id} has no recorded source fingerprint; rerun it for an exact executable replay.`);
  }
  if (recipes.length) {
    let pack = null;
    try { pack = await (replayEngine === undefined ? loadReplayEngine() : verifyReplayEngine(replayEngine)); }
    catch (err) { missing.push(`Primary executable replay source could not be included: ${String(err?.message || err).slice(0, 150)}`); }
    const exact = pack && recipes.filter(({ a, recipe }) => (recipe.data || recipe.saved?.frozenData) && a.implementation?.engineFingerprint === pack.fingerprint);
    if (exact?.length) {
      for (const f of pack.files) entries.push({ name: `analysis/replay/engine/${f.name}`, data: f.text });
      entries.push({ name: 'analysis/replay/engine.json', data: json({ ...pack, files: pack.files.map(({ name, sha256 }) => ({ name, sha256 })) }) },
        { name: 'analysis/replay/run.mjs', data: REPLAY_RUNNER });
    }
    for (const { a } of recipes) if (pack && a.implementation?.engineFingerprint && a.implementation.engineFingerprint !== pack.fingerprint)
      missing.push(`Primary analysis ${a.id} was computed with another source pack. The matching original engine is unavailable; rerun and keep it with this build to export an exact replay.`);
    const runnable = exact ? exact.map(({ name }) => name) : [];
    entries.push({ name: 'analysis/replay/README.md', data: ['# Primary analysis replay', '',
      'Each results/ JSON records the saved result, frozen input columns, settings, row population, and source fingerprint. It does not fetch current project data.', '',
      runnable.length ? 'Use Node.js 20 or later. From this folder, run one of:' : 'No result in this export has both frozen input rows and a matching source pack. See unresolved.md; rebuild the app, rerun, and keep the analysis.', '',
      ...runnable.map(name => `- \`node run.mjs ${name}\``), '',
      'The runner verifies every source checksum, recomputes from the frozen inputs, writes <id>.replayed.json, and exits with an error if the recalculated JSON differs from the saved result. No packages or network connection are needed.', '',
      'Prediction-performance analyses evaluate supplied probabilities; their prediction-source setting is researcher-provided provenance and is not proof of independent model development or validation.', ''].join('\n') });
  }
  if (s.survival) {
    const ext = s.survival.ext;
    entries.push({ name: 'analysis/survival/result.json', data: json(s.survival) });
    if (ext?.inputRows && ext.inputSpec) entries.push({ name: 'analysis/survival/inputs.json', data: json({ rows: ext.inputRows, spec: ext.inputSpec,
      effectiveSpec: ext.spec, inputSnapshot: ext.inputSnapshot || null, population: ext.population || null, currentSourceStatus: survivalInputStatus(s) }) });
    else missing.push('The saved survival analysis has no original input snapshot. Its original rows and analysis population cannot be reconstructed from current patient data.');
    if (survivalInputStatus(s) !== 'current') missing.push(`The saved survival analysis is ${survivalInputStatus(s)} against the current patient data. Re-run before reporting a current analysis.`);
  }
  for (const record of chatSurvivalRecords(s)) {
    const { block, directory, ...source } = record, result = block.analysis || null, ext = result?.ext;
    entries.push({ name: `${directory}/result.json`, data: json({ format: 'lykos-chat-survival', version: 1, ...source, title: block.title || '', result }) },
      { name: `${directory}/inputs.json`, data: json({ frozenInput: block.frozenInput || null, rows: ext?.inputRows || null,
        requestedSpec: ext?.inputSpec || null, effectiveSpec: ext?.spec || null, inputSnapshot: ext?.inputSnapshot || null, population: ext?.population || null,
        currentSourceStatus: record.currentSourceStatus }) });
    if (result?.plot) entries.push({ name: `${directory}/curve.svg`, data: result.plot });
    if (!block.frozenInput?.columns || !block.frozenInput?.participants || !ext?.inputRows || !ext?.inputSpec || !ext?.inputSnapshot)
      missing.push(`Chat survival result ${record.threadId || 'chat'}, turn ${record.turn}, block ${record.blockIndex} does not retain its complete original inputs. Rerun it to include its raw cohort, columns and analysis snapshot.`);
    if (record.currentSourceStatus !== 'current') missing.push(`Chat survival result ${record.threadId || 'chat'}, turn ${record.turn}, block ${record.blockIndex} is ${record.currentSourceStatus} against current patient data; the export retains the saved result and original inputs.`);
  }
  for (const a of s.advancedAnalyses || []) {
    entries.push({ name: `analysis/advanced/${slug(a.id)}.json`, data: json({ ...a, currentSourceStatus: advancedInputStatus(a, s) }) });
    if (!a.frozenData) missing.push(`Advanced analysis ${a.id} has no frozen input rows.`);
    if (advancedInputStatus(a, s) !== 'current') missing.push(`Advanced analysis ${a.id} is ${advancedInputStatus(a, s)} against its source dataset; the export retains its saved inputs and result.`);
  }
  for (const a of s.propensityAnalyses || []) {
    const status = propensityStatus(a, (s.datasets || []).find(d => d.id === a.datasetId)), dir = `analysis/propensity/${slug(a.id)}`;
    entries.push({ name: `${dir}/design.json`, data: json({ ...a, currentSourceStatus: status }) },
      { name: `${dir}/rows.csv`, data: csv(propensityRows(a)) }, { name: `${dir}/balance.csv`, data: csv(propensityBalanceRows(a)) });
    if (status !== 'current') missing.push(`Propensity design ${a.id} is ${status} against its current dataset; saved inputs and weights remain in the export.`);
  }
  return { entries, missing };
}

/**
 * The lockfile for the scripts: the R and WebR versions and every vendored
 * package the scripts attach, with its dependencies, as vendor.lock.json pins
 * them (version, source and SHA-256), and the versions R reported at run time.
 */
export function scriptLockfile(scripts, lock) {
  const used = [...new Set(scripts.flatMap(x => x.packages || []))].sort();
  const ran = {};
  for (const x of scripts) for (const [p, v] of Object.entries(x.rScript?.packages || {})) if (v) (ran[p] ||= new Set()).add(v);
  const rVersions = [...new Set(scripts.map(x => x.rScript?.r).filter(Boolean))];
  if (!lock) return { r: rVersions, packagesAtRun: Object.fromEntries(Object.entries(ran).map(([p, v]) => [p, [...v]])), lockfile: null };
  const closure = [...new Set(used.flatMap(p => lock.targets?.[p] || [p]))].sort();
  return {
    r: rVersions.length ? rVersions : [lock.rVersion ? `R ${lock.rVersion}` : ''].filter(Boolean),
    webr: lock.webr ? { version: lock.webr.version, url: lock.webr.url, sha256: lock.webr.sha256 } : null,
    packagesAtRun: Object.fromEntries(Object.entries(ran).map(([p, v]) => [p, [...v]])),
    packages: Object.fromEntries(closure.filter(n => lock.rPackages?.[n]).map(n => [n, { version: lock.rPackages[n].version, url: lock.rPackages[n].url, sha256: lock.rPackages[n].sha256 }])),
    lockfileGenerated: lock.generated || '',
  };
}

// ---- the entries ------------------------------------------------------------------------------------

/**
 * The files only the full bundle carries, as `{ name, data }`, and what is
 * missing. `lock` is vendor.lock.json (null when it cannot be read);
 * `svgToPng` rasterises a figure in the app (absent under node).
 */
export async function submissionEntries(s, { lock = null, svgToPng = null, replayEngine } = {}) {
  const entries = [], missing = [];
  const research = { format:'lykos-research-ledger',version:1,records:researchRecords(s),
    proposals:s.aiProposalLedger||[],claims:s.evidenceClaims||[],baselines:s.evidenceBaselines||[],adjudicationDrafts:s.adjudicationDrafts||[] };
  if(research.records.length||research.proposals.length||research.claims.length||research.baselines.length||research.adjudicationDrafts.length)
    entries.push({name:'research/ledger.json',data:JSON.stringify(research,null,2)+'\n'});
  const type = researchType(s).id;
  const primary = await primaryAnalysisEntries(s, { replayEngine });
  entries.push(...primary.entries); missing.push(...primary.missing);

  // PRISMA: counts entered by hand, and the checklist as a Word table.
  const review = isReviewType(type) || !s.project?.researchType;
  if (type !== 'case-report') {
    const hand = review ? handCountsMarkdown(s) : '';
    if (hand) entries.push({ name: 'prisma/counts-entered-by-hand.md', data: hand });
    entries.push({ name: `${review ? 'prisma' : 'reporting'}/${checklistOf(s).id}-checklist.docx`, data: await checklistDocx(s) });
  }

  // PRISMA-S search strategies.
  const strat = compileStrategy(s);
  if (strat.databases.length) {
    entries.push({ name: 'search/search-strategies-prisma-s.md', data: strategyMarkdown(strat) },
      { name: 'search/search-strategies-prisma-s.docx', data: await docx(strategyBlocks(strat)) });
  } else if (review) missing.push('No search strategies: the search log has no database runs.');

  // Summary of Findings: its files are in every bundle (lib/bundle.mjs, with the evidence profile and SWiM); here the same rows in the layout a
  // journal's supplement prints (Batch 13 item 1), and the absence of any rated outcome.
  if ((s.grade || []).length) {
    const gt = gradeTable(s);
    entries.push({ name: 'certainty/grade-table.md', data: gradeTableMarkdown(gt) }, { name: 'certainty/grade-table.docx', data: await docx(gradeTableBlocks(gt)) });
  } else if (['meta-analysis', 'systematic-review', 'umbrella-review'].includes(type) || !s.project?.researchType) missing.push('No Summary of Findings: no outcome has a GRADE assessment.');

  // Analysis scripts and their lockfile.
  const { scripts, missing: noScript } = analysisScripts(s);
  missing.push(...noScript);
  if (scripts.length) {
    entries.push(...scripts.map(({ name, data }) => ({ name, data })));
    entries.push({ name: 'analysis/scripts/lockfile.json', data: JSON.stringify(scriptLockfile(scripts, lock), null, 2) + '\n' });
    if (!lock) missing.push('vendor.lock.json could not be read, so the lockfile lists only the versions R reported.');
  }

  // Saved tables and figures, each with its spec.
  for (const entry of s.outputs || []) {
    const spec = currentSpec(entry);
    if (!spec) continue;
    const dir = `tables-and-figures/${slug(outputStem(spec))}`;
    entries.push({ name: `${dir}/spec.json`, data: JSON.stringify({ ...spec, version: entry.versions?.length || 1 }, null, 2) + '\n' });
    try {
      const { files, skipped } = await outputFiles(s, spec, null, { svgToPng });
      for (const f of files) entries.push({ name: `${dir}/${slug(outputStem(spec))}.${f.ext}`, data: /^(xlsx|docx)$/.test(f.ext) ? await zipFixed(f.data) : f.data });
      if (skipped?.length) missing.push(`${outputStem(spec)}: ${skipped.join(', ').toUpperCase()} not written here.`);
    } catch (err) { missing.push(`${outputStem(spec)} could not be drawn: ${String(err?.message || err).slice(0, 120)}`); }
  }

  // Studies excluded at full text, with reasons.
  const excluded = excludedStudies(s);
  if (excluded.length) {
    entries.push({ name: 'screening/excluded-studies-with-reasons.csv', data: csv([EXCLUDED_HEAD, ...excluded.map(excludedRow)]) },
      { name: 'screening/excluded-studies-with-reasons.docx', data: await docx([
        { id: 'x1', type: 'p', text: 'Studies excluded at full text, with reasons', runs: [{ t: 'Studies excluded at full text, with reasons', b: true, sz: 14 }] },
        { id: 'x2', type: 'table', header: true, rows: [['Study', 'Title', 'Reason'], ...excluded.map(r => [[r.label, r.year && !r.label.includes(r.year) ? r.year : ''].filter(Boolean).join(' '), r.title, r.category === 'Not retrieved' ? `Not retrieved${r.reason && !/^not retriev/i.test(r.reason) ? `: ${r.reason}` : ''}` : r.reason || 'No reason recorded'])] }]) });
    const blank = excluded.filter(r => r.category === 'Excluded' && !r.reason).length;
    if (blank) missing.push(`${blank} full-text ${blank === 1 ? 'exclusion has' : 'exclusions have'} no reason.`);
  } else if (Object.keys(s.fulltext || {}).length) missing.push('No full-text exclusions recorded.');

  // Retractions and corrections: the stored checks of the records the submission rests on, nothing looked up at export.
  const reported = reportedRecords(s);
  if (reported.length) {
    const rc = retractionReport(reported);
    entries.push({ name: 'references/retractions-and-corrections.csv', data: csv([rc.head, ...rc.rows]) },
      { name: 'references/retractions-and-corrections.md', data: rc.markdown });
    if (rc.never) missing.push(`${rc.never} included or cited ${rc.never === 1 ? 'record was' : 'records were'} never checked for retraction notices (Library, Check, Check retractions).`);
  }

  // The data extraction table: the extraction fields per included study, and
  // each evidence table as its publication table (one row per arm) with its columns.
  const t = evidenceTable(s);
  let tables = 0;
  if (t.rows.length && t.fields.length) {
    tables++;
    entries.push({ name: 'data/data-extraction-table.csv', data: csv([t.head, ...t.rows]) },
      { name: 'data/data-extraction-table.xlsx', data: await zipFixed(await writeXlsx([{ name: 'Table', rows: [t.head, ...t.rows] },
        { name: 'Codebook', rows: [['Field', 'Label', 'Type'], ...t.fields.map(f => [f.id, f.label, f.type || ''])] }])) });
  }
  for (const tpl of s.templates || []) {
    if (!Object.keys(s.values || {}).some(k => k.includes(`:${tpl.id}.`))) continue;
    let model;
    try { model = evidenceModel(s, tpl.id); } catch { continue; }
    if (!model.studies.length) continue;
    tables++;
    const sheet = publicationSheet(model), name = `data/data-extraction-${slug(tpl.name || tpl.id)}`;
    entries.push({ name: `${name}.csv`, data: csv(sheet.rows) },
      { name: `${name}.xlsx`, data: await zipFixed(await writeXlsx([sheet, { name: 'Columns', rows: [['Column', 'Label', 'Type', 'Definition'],
        ...model.columns.map(c => [c.id, c.label, c.type || '', c.definition || c.description || ''])] }])) });
  }
  if (!tables && review) missing.push('No data extraction table: no values extracted for the included studies.');

  return { entries, missing };
}

/** A workbook's parts written again with the fixed time, so identical content is identical bytes. */
export async function zipFixed(blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  for (const e of zipList(bytes)) parts.push({ name: e.name, data: await zipRead(bytes, e) });
  return zip(parts, { date: FIXED_TIME });
}

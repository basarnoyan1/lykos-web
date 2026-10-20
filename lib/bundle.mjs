// The submission bundle (plan K3).
//
// Everything the project can account for, in formats a journal or a coauthor
// can open, plus a manifest saying what is in it and an honest list of what is
// still missing. A bundle that quietly omits its gaps is worse than no bundle:
// the point is that a reader can tell what was done and what was not.
import { appUrl } from './app-url.mjs';
import { get, recoveryOwner } from '../store.mjs';
import { toRows as datasetRows } from './datasets.mjs';
import { allTools, appraisalTool, PRISMA_GROUPS, JUDGEMENT_TONE } from '../schema.mjs';
import { prismaFlow } from './prisma-flow.mjs';
import { figureTokens } from './figure-style.mjs';
import { prismaData } from './prisma-counts.mjs';
import { prismaIpdFlow, prismaIpdData, ipdCountRows } from './prisma-ipd.mjs';
import { zip } from './zip.mjs';
import { saveFile } from './save.mjs';
import { collections } from './collections.mjs';
import { authorList } from './bib.mjs';
import { renderText, toMarkdown, citationContext, compactNumbers } from './manuscript.mjs';
import { inlineMarkdown } from './markdown.mjs';
import { formatReference, inText } from './cite.mjs';
import { results as allResults } from './results.mjs';
import { getFile } from './files.mjs';
import { migrateValue } from './evidence.mjs';
import { researchType, defaultAppraisal } from './workflow.mjs';
import { journalContext } from './journal-context.mjs';
import { isPrimaryType } from './research-types.mjs';
import { checklistOf, supported } from './checklist.mjs';
import { caseBundle } from './case-report.mjs';
import { INPUTS, measureOf } from './effect-measures.mjs';
import { fitR } from './pooled-model.mjs';
import { PRIMARY, outcomes, analysisOf, fieldFor } from './outcomes.mjs';
import { figureFor, hasFigure } from './figures.mjs';
import { evidenceMap, evidenceMapRows, evidenceMapSvg, mapFields } from './evidence-map.mjs';
import { trafficLight, summaryBars, analysisWeights } from './appraisal-fig.mjs';
import { publicationsByYear, chartableFields, chartableColumns, patientColumnChart } from './charts.mjs';
import { detectCharacteristic, selectedVisual, renderCharacteristic, visualNote, visualTitle } from './characteristic-visuals.mjs';
import { studies as includedOf, screeningStarted } from './screen.mjs';
import { DEFAULT_COLUMNS } from './ipd.mjs';
import { dtaInputs, dtaStatus, summary, csvRows, forestSvg, srocSvg, resultLine } from './dta.mjs';
import { umbrellaOf, reviewsOf, cca, matrixRows, ccaRows, amstarRows, resultRows, ccaHeatSvg, citationMatrixSvg } from './umbrella.mjs';
import { readQes, codesCsvRows, themesCsvRows, themeMatrix, matrixRows as qesMatrixRows, matrixSvg as qesMatrixSvg } from './qes.mjs';
import { summaryOfQualitativeFindings, soqfCsvRows } from './cerqual.mjs';
import { aiUseMarkdown, aiUseRecord } from './ai-use.mjs';
import { submissionEntries, primaryAnalysisEntries, analysisScripts, scriptLockfile, prismaCountsCsv, unexplainedCounts, checklistRows, CHECKLIST_HEAD, csv as csvOf } from './submission.mjs';
import { dataDictionary, patientDataset } from './dataset-analysis.mjs';
import { trialExport } from './trial-operations.mjs';
import { participantFlow, participantFlowRows, participantFlowSvg } from './participant-flow.mjs';
import { projectLayout, writeOutputs } from './project-folder.mjs';
import { entries as zipList, read as zipRead } from './unzip.mjs';
import { settingsOf } from './app-settings.mjs';
import { fields } from './fields.mjs';
import { summaryOfFindings, toMarkdown as sofMarkdown, toBlocks as sofBlocks } from './sof.mjs';
import { profileOf } from './evidence-profile.mjs';
import { toCsv as profileCsv } from './grade-profile.mjs';
import { swimOf, swimRows, swimCsv } from './swim-state.mjs';
import { harvestPlotSvg, SWIM_ITEMS } from './swim.mjs';
import { writeDocx } from './docx-write.mjs';

// Every figure in a bundle is the print copy of the house style (FIGURE-STYLE §2): export tokens, journal-column width.
const printStyle = () => figureTokens(null, { medium: 'export' });

const csv = rows => rows.map(r => r.map(v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

const stamp = () => new Date().toISOString();
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field';

// Markdown cannot retain Word pagination. Keep the actual body, anchored notes
// and defined running content readable, using the same citation order as Word.
// The saved project retains the complete editable document; this reading copy
// includes only content used by the exported document.
function manuscriptMarkdown(ms, usedNotes, inline, resolved = false) {
  const blocks = ms.blocks || [];
  const markdown = (items, noteAnchors = false) => toMarkdown(items.filter(b => b.type !== 'bib'), {
    lists: ms.lists || {}, text: b => inline(b, noteAnchors),
  }).trim();
  const parts = [markdown(blocks, true)];
  if (usedNotes.length) {
    parts.push(resolved ? usedNotes.map(({ note }, i) => {
      const body = inline(note, false).trim();
      return `[^lykos-note-${i + 1}]: ${note.kind === 'end' ? 'Endnote. ' : ''}${body.replace(/\n/g, '\n    ')}`;
    }).join('\n\n') : `## Notes\n\n${usedNotes.map(({ id, note }) =>
      `### ${note.kind === 'end' ? 'Endnote' : 'Footnote'} ${id}\n\n${inline(note, false)}`).join('\n\n')}`);
  }
  const sections = [...blocks.filter(b => b.props?.section).map(b => b.props.section), ms.section || {}];
  sections.forEach((section, i) => {
    for (const kind of ['header', 'footer']) for (const suffix of ['', 'First', 'Even']) {
      const part = section?.[kind + suffix];
      if (!part) continue;
      const content = part.blocks?.length ? markdown(part.blocks) : inline({ text: part.text || '' }, false).trim();
      if (content) parts.push(`## Section ${i + 1} ${suffix ? `${suffix.toLowerCase()} ` : ''}${kind}\n\n${content}`);
    }
  });
  return parts.filter(Boolean).join('\n\n').trim() + '\n';
}

/** The bundle as a zip, for the Export bundle buttons: the full submission bundle (plan K3) unless `full` is false. */
export async function buildBundle({ full = true, lock = null, svgToPng = null, replayEngine, source, owner } = {}) {
  const { entries, missing, manifest } = await bundleEntries({ full, lock, svgToPng, replayEngine, source, owner });
  return { blob: await zip(entries), files: entries.map(e => e.name), missing, manifest };
}

/**
 * Every file the bundle holds, as `{ name, data }`, and what is still
 * missing; also what "Write to project folder" writes (lib/project-folder.mjs),
 * which asks for the working set without `full`. With `full` the bundle adds
 * the rest of plan K3 (lib/submission.mjs): the checklist as a Word table, the
 * PRISMA-S strategies, the Summary of Findings, the analysis scripts with
 * their lockfile, the saved tables and figures with their specs, the studies
 * excluded at full text with reasons and the data extraction table.
 */
export async function bundleEntries({ full = false, lock = null, svgToPng = null, replayEngine, source = get(), owner = recoveryOwner() } = {}) {
  // The archive is one revision, even if a background job finishes while
  // figures, attachments or checksums are being read.
  const s = structuredClone(source);
  const papers = s.papers || [];
  const labelOf = new Map(papers.map(p => [p.id, p.label]));
  const values = s.values || {};
  const entries = [];
  const missing = [];

  // --- records -----------------------------------------------------------
  entries.push({ name: 'references.ris', data: risOf(papers) });
  entries.push({ name: 'records.csv', data: csv([
    ['id', 'label', 'title', 'authors', 'year', 'journal', 'doi', 'pmid', 'pdf'],
    ...papers.map(p => [p.id, p.label, p.title, authorList(p.authors).join('; '),
      p.year, p.journal, p.doi, p.pmid, p.pdf ? (p.pdfMode || 'yes') : '']),
  ]) });

  // --- characteristics and the codebook that explains them ----------------
  entries.push({ name: 'characteristics.csv', data: csv([
    ['Field', ...papers.map(p => p.label)],
    ...fields(s).map(f => [f.label, ...papers.map(p => {
      const v = values[`${p.id}:${f.id}`];
      return v ? (f.type === 'integer' ? v.normalized_value : v.reported_value) : '';
    })]),
  ]) });

  // Every accepted value with its provenance — the reason the table can be trusted.
  entries.push({ name: 'extracted-values.csv', data: csv([
    ['study', 'field', 'reported_value', 'normalized_value', 'origin', 'availability',
     'verification', 'page', 'document_version', 'extractor', 'verified_at', 'evidence_json'],
    ...Object.entries(values).map(([key, raw]) => {
      const v = migrateValue(raw);
      const first = v.evidence?.find(e => e.kind === 'text' || e.kind === 'image');
      return [v.study_id || v.paper_id || key.split(':')[0], v.field_id,
        v.reported_value, v.normalized_value, v.origin, v.availability,
        v.verification, first?.page || v.source_locator?.page,
        first?.document_version || v.source_locator?.document_version,
        v.extractor, v.verified_at, JSON.stringify(v.evidence || [])];
    }),
  ]) });

  // The researcher's own datasets, one CSV each (lib/datasets.mjs).
  for (const d of s.datasets || []) {
    const stem = `dataset-${encodeURIComponent(String(d.id))}-${slug(d.name)}`;
    entries.push({ name: `datasets/${stem}.csv`, data: csv(datasetRows(d)) },
      { name: `datasets/${stem}-dictionary.json`, data: JSON.stringify(dataDictionary(d), null, 2) + '\n' });
  }
  const pd = patientDataset(s);
  if (pd) entries.push({ name: 'patients/data-dictionary.json', data: JSON.stringify(dataDictionary(pd), null, 2) + '\n' });
  if (s.trialOperations) {
    try { entries.push({ name: 'trial/operations.json', data: JSON.stringify(trialExport(s), null, 2) + '\n' }); }
    catch (err) { entries.push({ name: 'trial/operations.json', data: JSON.stringify(s.trialOperations, null, 2) + '\n' }); missing.push(`Trial operations derived population could not be exported: ${String(err?.message || err).slice(0, 120)}`); }
  }
  if ((s.imagingMeasurements || []).length) entries.push({ name: 'imaging/measurements.json', data: JSON.stringify(s.imagingMeasurements, null, 2) + '\n' });
  entries.push({ name: 'codebook.csv', data: csv([
    ['field', 'label', 'type', 'analysis_role'],
    ...fields(s).map(f => [f.id, f.label, f.type, f.analysis || (f.custom ? 'custom' : '')]),
  ]) });

  // --- the review's own record -------------------------------------------
  if (s.protocol) {
    entries.push({ name: 'protocol.md', data: protocolDoc(s.protocol) });
  if ((s.protocolVersions || []).length) entries.push({ name: 'protocol-versions.json', data: JSON.stringify(s.protocolVersions, null, 2) });
  if ((s.links || []).length) entries.push({ name: 'report-links.csv', data: csv([['from', 'relation', 'to'], ...s.links.map(l => [labelOf.get(l.a) || l.a, l.kind, labelOf.get(l.b) || l.b])]) });
  } else missing.push('No protocol recorded.');
  // The reporting checklist, every item with its state, where it is reported and what supports it (plan K2).
  entries.push({ name: `${checklistOf(s).id}-checklist.csv`, data: csvOf([CHECKLIST_HEAD, ...checklistRows(s)]) });
  { const open = checklistRows(s).filter(r => r[3] === 'Not reviewed').length; if (open) missing.push(`${open} ${checklistOf(s).name} checklist ${open === 1 ? 'item is' : 'items are'} not reviewed.`); }

  if ((s.searches || []).length) {
    entries.push({ name: 'search-log.csv', data: csv([
      ['run_at', 'source', 'query', 'records_found', 'records_retrieved', 'status'],
      ...s.searches.map(r => [r.at, r.source, r.query, r.total, r.retrieved, r.status]),
    ]) });
    const partial = s.searches.filter(r => r.status !== 'complete');
    if (partial.length) missing.push(
      `${partial.length} search ${partial.length === 1 ? 'run' : 'runs'} retrieved fewer records than were reported found.`);
  } else missing.push('No searches recorded; records were imported rather than searched.');

  const screening = s.screening || {};
  if (Object.keys(screening).length) {
    const stages = [['title-abstract', screening], ['full-text', s.fulltext || {}]];
    entries.push({ name: 'screening-decisions.csv', data: csv([
      ['study', 'stage', 'decision', 'reason', 'reviewer', 'decided_at'],
      ...stages.flatMap(([stage, d]) => papers.filter(p => d[p.id]).map(p =>
        [p.label, stage, d[p.id].decision, d[p.id].reason, d[p.id].by || '', d[p.id].at])),
    ]) });
    if ((s.screeningLog || []).length) entries.push({ name: 'screening-log.csv', data: csv([
      ['at', 'action', 'stage', 'study', 'decision', 'prior', 'reason', 'reviewer', 'count'],
      ...s.screeningLog.map(e => [e.at, e.action, e.stage, labelOf.get(e.id) || e.id || '',
        e.decision || '', e.prior || '', e.reason || '', e.by || '', e.count ?? '']),
    ]) });
    const undecided = papers.filter(p => !screening[p.id]).length;
    const uncertain = Object.values(screening).filter(d => d.decision === 'uncertain').length;
    if (undecided) missing.push(`${undecided} ${undecided === 1 ? 'record was' : 'records were'} never screened.`);
    if (uncertain) missing.push(`${uncertain} screening ${uncertain === 1 ? 'decision' : 'decisions'} left uncertain.`);
  } else missing.push('No screening decisions recorded.');

  // --- appraisal ----------------------------------------------------------
  // Exported against the instrument the review actually used, and named after
  // it: a JBI checklist is not a risk-of-bias table and must not be filed as one.
  const assessments = s.assessments || {};
  const tool = appraisalTool(s.appraisalTool || defaultAppraisal(s), s);
  const byInstrument = k => allTools(s).some(t => t.id === k);
  const answersFor = id => {
    const a = assessments[id];
    if (!a) return null;
    if (a[tool.id]) return a[tool.id];
    if (tool.id !== 'rob2') return null;
    const flat = Object.fromEntries(Object.entries(a).filter(([k]) => !byInstrument(k)));
    return Object.keys(flat).length ? flat : null;
  };
  const cols = [...tool.domains, ...(tool.overall ? [{ id: 'overall', label: 'Overall' }] : [])];
  const assessed = papers.filter(p => answersFor(p.id));
  if (assessed.length) {
    entries.push({ name: 'appraisal.csv', data: csv([
      ['study', 'instrument', ...cols.map(d => d.label)],
      ...papers.map(p => {
        const a = answersFor(p.id) || {};
        return [p.label, tool.name, ...cols.map(d => a[d.id] || '')];
      }),
    ]) });
    // The figures are drawn from complete assessments only, as the Appraisal view draws them.
    const complete = assessed.map(p => ({ label: p.label, values: answersFor(p.id) }))
      .filter(r => cols.every(d => r.values[d.id]));
    if (complete.length) {
      entries.push({ name: 'appraisal/traffic-light.svg', data: trafficLight(tool, complete, JUDGEMENT_TONE, { style: printStyle() }) },
        { name: 'appraisal/summary.svg', data: summaryBars(tool, complete, JUDGEMENT_TONE, { style: printStyle() }) });
      const w = analysisWeights(s.analysis);
      if (w) entries.push({ name: 'appraisal/summary-weighted.svg', data: summaryBars(tool, complete, JUDGEMENT_TONE, { weights: w, style: printStyle() }) });
    }
    const incomplete = assessed.filter(p => {
      const a = answersFor(p.id);
      return !cols.every(d => a[d.id]);
    }).length;
    if (incomplete) missing.push(`${incomplete} ${tool.name} assessment${incomplete === 1 ? '' : 's'} incomplete.`);
    const none = papers.length - assessed.length;
    if (none > 0) missing.push(`${none} stud${none === 1 ? 'y' : 'ies'} with no ${tool.name} assessment.`);
  } else missing.push(`No ${tool.name} assessments recorded.`);

  // --- analysis: one folder per outcome (the primary's at analysis/) ------
  const pooled = outcomes(s).map(o => [o, analysisOf(s, o.id)]).filter(([, a]) => a);
  for (const [o, a] of pooled) {
    const dir = o.id === PRIMARY ? 'analysis' : `analysis/${o.id}-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
    entries.push({ name: `${dir}/result.txt`, data:
      `Outcome           ${o.name}\nMeasure           ${a.measure}\nEstimator         ${a.method}\n` +
      `Studies (k)       ${a.k}\nPooled estimate   ${num(a.estimate)} [${num(a.lo)}, ${num(a.hi)}]\n` +
      `I-squared         ${num(a.i2, 1)}%\nTau-squared       ${num(a.tau2, 4)}\n` +
      `Q                 ${num(a.q)} (p = ${num(a.qp, 3)})\nRun at            ${a.at}\n` });
    const forest = await figureFor(a, 'svg');   // inline or stored (lib/figures.mjs)
    if (forest) entries.push({ name: `${dir}/forest.svg`, data: forest });
    else if (hasFigure(a, 'svg')) missing.push(`Forest plot of ${o.name}: not found on this computer; run the analysis again.`);
    // The inputs of the measure that was pooled, named by escalc's arguments.
    const cols = INPUTS[measureOf(a.measure).family].map(([f, arg]) => [fieldFor(f, o.id), arg]);
    const reported = measureOf(a.measure).family === 'reported';
    entries.push({ name: `${dir}/input.csv`, data: csv(reported ? [
      ['study', 'estimate_natural_scale', 'se_analysis_scale'],
      ...(a.values || []).map((v,i) => [a.labels?.[i] || a.papers?.[i] || '', ...v]),
    ] : [
      ['study', ...cols.map(([, arg]) => arg)],
      ...papers.filter(p => cols.every(([f]) => values[`${p.id}:${f}`]))
        .map(p => [p.label, ...cols.map(([f]) => values[`${p.id}:${f}`].normalized_value)]),
    ]) });
    if (reported) entries.push(
      { name: `${dir}/reported-models.json`, data: JSON.stringify({ identities: a.reportedIdentities || [], mixedAdjustmentPlan: a.reportedMixReason || '', inputSnapshot: a.inputSnapshot }, null, 2) },
      { name: `${dir}/model.R`, data: `library(metafor)\n${fitR({ measure:a.measure, method:a.method, test:a.test, values:a.values || [] })}\nprint(r)\n` });
  }
  // Only a review that pools pairwise effects is missing one without it (older projects have no type).
  if (!pooled.length && (researchType(s).id === 'meta-analysis' || !s.project?.researchType)) missing.push('No analysis has been run.');
  // A scoping review's synthesis is its evidence map.
  const mapPair = researchType(s).id === 'scoping-review' ? mapFields(s) : {};
  if (mapPair.row && mapPair.col) {
    const map = evidenceMap(s, mapPair.row, mapPair.col);
    if (map) entries.push({ name: 'charting/evidence-map.csv', data: csv(evidenceMapRows(map)) }, { name: 'charting/evidence-map.svg', data: evidenceMapSvg(map, { style: printStyle() }) });
  }
  // A diagnostic accuracy review's synthesis: the per-study table, the saved
  // result when it is current, and both figures drawn from them.
  if (researchType(s).id === 'dta-review') {
    const { ready, tables } = dtaInputs(s), current = s.dta && dtaStatus(s) === 'current', sm = current ? summary(s.dta.biv) : null;
    if (tables.length) entries.push({ name: 'dta/all-tables.csv', data: csv(csvRows(tables)) });
    if (ready.length) entries.push({ name: 'dta/studies.csv', data: csv(csvRows(ready)) },
      { name: 'dta/paired-forest.svg', data: forestSvg(ready, { pooled: sm ? { label: 'Summary (bivariate)', sens: sm.sens, spec: sm.spec } : null, style: printStyle() }) });
    if (current) entries.push({ name: 'dta/result.txt', data: `${resultLine(s.dta)}\nRun at ${s.dta.at}\n` }, { name: 'dta/sroc.svg', data: srocSvg(ready, s.dta, { style: printStyle() }) });
    else missing.push(s.dta ? 'The accuracy analysis is out of date: its inputs changed.' : 'No accuracy analysis has been run.');
  }
  // An umbrella review's synthesis: overlap of primary studies, AMSTAR 2 per
  // review, and the results summary with its evidence classes.
  if (researchType(s).id === 'umbrella-review') {
    const umb = umbrellaOf(s), reviews = reviewsOf(s), all = cca(umb.matrix, reviews.map(r => r.id));
    if (all.r) entries.push({ name: 'umbrella/citation-matrix.csv', data: csv(matrixRows(umb, reviews)) },
      { name: 'umbrella/cca.csv', data: csv(ccaRows(umb, reviews)) }, { name: 'umbrella/citation-matrix.svg', data: citationMatrixSvg(umb, reviews, { style: printStyle() }) });
    if (all.pct != null) entries.push({ name: 'umbrella/cca-heatmap.svg', data: ccaHeatSvg(umb, reviews, { style: printStyle() }) });
    else missing.push('No primary study overlap recorded across two or more reviews.');
    if (reviews.length) entries.push({ name: 'umbrella/amstar2.csv', data: csv(amstarRows(s, reviews)) });
    if (umb.results.length) entries.push({ name: 'umbrella/results-summary.csv', data: csv(resultRows(s, reviews)) });
    else missing.push('No results summary recorded.');
  }
  // A qualitative synthesis: coded quotes, themes, sources × themes, and the
  // Summary of Qualitative Findings with its CERQual assessments.
  if (researchType(s).id === 'qualitative-review') {
    const q = readQes(s);
    if (q.quotes.length) entries.push({ name: 'synthesis/codes.csv', data: csv(codesCsvRows(s)) });
    else missing.push('No coded quotes recorded.');
    if (q.descriptive.length || q.analytical.length) entries.push({ name: 'synthesis/themes.csv', data: csv(themesCsvRows(s)) });
    const lv = q.analytical.length ? 'analytical' : q.descriptive.length ? 'descriptive' : null;
    if (lv) { const m = themeMatrix(s, lv); entries.push({ name: `synthesis/sources-by-${lv}-themes.csv`, data: csv(qesMatrixRows(m)) }, { name: `synthesis/sources-by-${lv}-themes.svg`, data: qesMatrixSvg(m, { style: printStyle() }) }); }
    if (q.analytical.length) {
      const t = summaryOfQualitativeFindings(s);
      entries.push({ name: 'synthesis/summary-of-qualitative-findings.csv', data: csv(soqfCsvRows(t)) });
      const open = t.rows.filter(r => r.gaps.length).length;
      if (open) missing.push(`${open} CERQual ${open === 1 ? 'assessment is' : 'assessments are'} incomplete.`);
    } else missing.push('No analytical themes recorded.');
  }

  // --- characteristics: the included studies, and the patients -----------
  if (screeningStarted(s)) {
    const inc = includedOf(s);
    if (inc.length) {
      entries.push({ name: 'characteristics/publications-per-year.svg', data: publicationsByYear(inc, { style: printStyle() }) });
      for (const f of chartableFields(s, inc)) {
        const profile=detectCharacteristic(s,f,inc),view=selectedVisual(profile,s.characteristicViews?.[f.id]);
        // the figure's source line: the field and the view drawn, then what the data allow (the screen card's caption without its N)
        const source = [`${f.label} · ${visualTitle(view.mode || profile.mode)} · ${visualNote(profile, view)}`];
        entries.push({ name: `characteristics/studies-by-${slug(f.label)}.svg`, data: renderCharacteristic(profile, view, { style: printStyle(), source, title: `Included studies by ${f.label.split(' · ')[0].toLowerCase()}`, max: Infinity, offset: 0, exportNotes: true }) });
      }
    }
  }
  const patients = s.participants || [];
  if (patients.length) {
    const cols = s.ipdColumns || DEFAULT_COLUMNS;
    for (const c of chartableColumns(patients, cols)) entries.push({ name: `patients/${slug(c.name || c.id)}.svg`, data: patientColumnChart(patients, c, { style: printStyle() }) });
  }

  // --- reporting ----------------------------------------------------------
  const prisma = prismaData(s);
  entries.push({ name: 'prisma/flow-diagram.svg',
    // the arms the Reporting page draws, in the house export (FIGURE-STYLE §2)
    data: prismaFlow(prisma, { previous: false, other: false, ...(s.prismaArms || {}), style: printStyle() }) });
  // Each count with where it came from; one entered by hand with its explanation (plan K1).
  entries.push({ name: 'prisma/counts.csv', data: prismaCountsCsv(s) });
  // A patient-level review's own flow, drawn from the patients and decisions as they are when the bundle is made.
  if (patients.length) {
    entries.push({ name: 'prisma/ipd-flow-diagram.svg', data: prismaIpdFlow(prismaIpdData(s), { style: printStyle() }) });
    entries.push({ name: 'prisma/ipd-counts.csv', data: csvOf([['field', 'label', 'count', 'source', 'project_count', 'explanation'],
      ...ipdCountRows(s).map(r => [r.id, r.label, r.count, r.source, r.project, r.explanation])]) });
  }
  const blanks = PRISMA_GROUPS.flatMap(g => g.fields).filter(f => !f.reasonLabel && !prisma[f.id]).length;
  if (blanks) missing.push(`${blanks} PRISMA ${blanks === 1 ? 'count is' : 'counts are'} not filled in.`);
  { const why = unexplainedCounts(s); if (why.length) missing.push(`${why.length} PRISMA ${why.length === 1 ? 'count' : 'counts'} entered by hand without an explanation: ${why.map(r => r.label).join('; ')}.`); }

  // --- notes and collections ---------------------------------------------
  if ((s.notes || []).length) {
    entries.push({ name: 'notes.csv', data: csv([
      ['study', 'kind', 'text', 'page', 'anchored', 'at'],
      ...s.notes.map(n => [
        papers.find(p => p.id === n.paper)?.label ?? n.paper,
        n.kind, n.text, n.page, n.rects ? 'yes' : 'no', n.at]),
    ]) });
  }
  if (collections().length) {
    entries.push({ name: 'collections.csv', data: csv([
      ['collection', 'parent', 'study'],
      ...collections().flatMap(c => (c.members || []).map(m => [
        c.name, collections().find(x => x.id === c.parent)?.name ?? '',
        papers.find(p => p.id === m)?.label ?? m])),
    ]) });
  }

  // --- AI use, stated rather than left to be discovered -------------------
  // --- manuscript ---------------------------------------------------------
  // With tokens resolved, because the bundle is read rather than edited, and a
  // reference list containing only what the manuscript actually cites.
  const ms = s.manuscript || {}, msBlocks = ms.blocks || [];
  const { numbers, usedNotes } = citationContext(msBlocks, ms);
  const sourceMarkdown = manuscriptMarkdown(ms, usedNotes, b => inlineMarkdown(b));
  if (sourceMarkdown.trim()) {
    const byKey = new Map(papers.map(p => [p.key, p]));
    const resByKey = new Map(allResults(s).map(r => [r.key, r]));
    const numbered = journalContext(s).citationStyle === 'numbered';
    const renderOptions = {
      cite: group => {
        if (numbered) {
          const nums = group.filter(c => byKey.has(c.key)).map(c => numbers.get(c.key)).filter(Boolean);
          const missing = group.filter(c => !byKey.has(c.key)).map(c => `@${c.key}`);
          return `[${[nums.length ? compactNumbers(nums) : '', ...missing].filter(Boolean).join(',')}]`;
        }
        return `(${group.map(c => { const p = byKey.get(c.key); return p ? inText(p) : `@${c.key}`; }).join('; ')})`;
      },
      result: r => resByKey.get(r.key)?.text ?? null,
    };
    const noteLabels = new Map(usedNotes.map(({ id }, i) => [id, `[^lykos-note-${i + 1}]`]));
    const body = manuscriptMarkdown(ms, usedNotes, (b, noteAnchors) => inlineMarkdown(b, run => {
      if (run.cite) return renderOptions.cite(run.cite.map(key => ({ key })));
      const text = String(run.t || '').replace(/\{\{fn:([A-Za-z0-9._-]+)\}\}/g,
        (token, id) => noteAnchors ? noteLabels.get(id) || token : token);
      return renderText(text, renderOptions);
    }), true);
    const keys = [...numbers.keys()].filter(key => byKey.has(key)).sort(numbered
      ? (a, b) => numbers.get(a) - numbers.get(b)
      : (a, b) => String(byKey.get(a).label).localeCompare(String(byKey.get(b).label)));
    const refs = keys.map((k, i) =>
      `${numbered ? numbers.get(k) : i + 1}. ${formatReference(byKey.get(k), journalContext(s).referenceStyle)}`);
    entries.push({ name: 'manuscript/manuscript.md',
      data: refs.length ? `${body}\n## References\n\n${refs.join('\n')}\n` : body });
    // The source text keeps the tokens, so the document can be edited again.
    const supplementName = a => `${slug(a.kind || 'supplement')}-${encodeURIComponent(String(a.id))}-${encodeURIComponent(String(a.name || 'file'))}`;
    for (const a of s.manuscript?.assets || []) {
      const blob = a.fileHash ? await getFile(`asset-${a.id}`, { owner, expectedHash: a.fileHash }).catch(() => null) : null;
      if (blob) entries.push({ name: `manuscript/supplements/${supplementName(a)}`, data: blob });
      else missing.push(a.fileHash ? `Manuscript supplement ${a.name || a.id} could not be read from this project's attachments.` : `Manuscript supplement ${a.name || a.id} has no verified version; reattach the intended file before export.`);
    }
    if ((s.manuscript?.assets || []).length)
      entries.push({ name: 'manuscript/supplements/captions.csv', data: csv([['file', 'kind', 'caption'],
        ...s.manuscript.assets.map(a => [supplementName(a), a.kind, a.caption || ''])]) });
    entries.push({ name: 'manuscript/manuscript-source.md',
      data: sourceMarkdown });

    const unresolved = [...numbers.keys()].filter(key => !byKey.has(key));
    if (unresolved.length)
      missing.push(`${unresolved.length} cited work${unresolved.length === 1 ? '' : 's'} in the manuscript ${unresolved.length === 1 ? 'has' : 'have'} no record.`);
  } else missing.push('No manuscript text.');

  // --- case report (lib/case-report.mjs) ---------------------------------
  // One patient: the case, its timeline and the CARE checklist take the place
  // of the review's flow, screening and appraisal, which it does not have.
  if (researchType(s).id === 'case-report') {
    const c = caseBundle(s, csv), list = checklistOf(s), cl = s[list.key] || {}, sup = supported(s);
    for (let i = entries.length - 1; i >= 0; i--) if (/^prisma\/|-checklist\.csv$/.test(entries[i].name)) entries.splice(i, 1);
    const review = /^(No protocol|No searches|No screening|No .* assessments recorded|\d+ PRISMA)/;
    missing.splice(0, missing.length, ...missing.filter(m => !review.test(m)), ...c.missing);
    entries.push(...c.entries, { name: 'case/care-checklist.csv', data: csv([['item', 'name', 'state', 'where', 'supported_by'],
      ...list.items.map(([n, name]) => [n, name, cl[n]?.state || '', cl[n]?.where || '', sup[n] || ''])]) });
  }

  // --- a primary study (lib/research-types.mjs) -------------------------------
  // Its own data, protocol and checklist: the review's search, screening,
  // appraisal and extraction files are not asked of it.
  if (isPrimaryType(researchType(s).id)) {
    const review = /^(No searches|No screening|No .* assessments recorded|\d+ PRISMA|No analysis has been run|No data extraction|No search strategies)/;
    missing.splice(0, missing.length, ...missing.filter(m => !review.test(m)));
    for (let i = entries.length - 1; i >= 0; i--) if (/^(prisma\/|search-log\.csv|screening-|characteristics\.csv|extracted-values\.csv|references\.ris|records\.csv)/.test(entries[i].name) && !(s.papers || []).length) entries.splice(i, 1);
    for (let i = entries.length - 1; i >= 0; i--) if (/^prisma\//.test(entries[i].name)) entries.splice(i, 1);
    try {
      const flow = participantFlow(s);
      if (flow.rows.some(r => r.value != null)) entries.push({ name: 'reporting/participant-flow.json', data: JSON.stringify(flow, null, 2) + '\n' },
        { name: 'reporting/participant-flow.csv', data: csv(participantFlowRows(s)) }, { name: 'reporting/participant-flow.svg', data: participantFlowSvg(s, { style: printStyle() }) });
      missing.push(...flow.issues.map(issue => `Participant flow: ${issue}`));
    } catch (err) { missing.push(`Participant flow could not be exported: ${String(err?.message || err).slice(0, 120)}`); }
    if (!(s.datasets || []).length && !(s.participants || []).length) missing.push('No data: no dataset imported and no patient data entered.');
  }
  entries.push({ name: 'ai-use.md', data: aiDisclosure(s, values) });
  // --- AI use record (feature: ai-use) ---------------------------------------
  // The structured record generated from the model-call log (lib/ai-use.mjs), beside the per-value note above.
  entries.push({ name: 'ai-use/ai-use.md', data: aiUseMarkdown(s) },
    { name: 'ai-use/ai-use.json', data: JSON.stringify(aiUseRecord(s), null, 2) + '\n' });
  // --- end AI use record ---------------------------------------------------------

  // --- the rest of the submission bundle (plan K3) --------------------------
  if (full) {
    const extra = await submissionEntries(s, { lock, svgToPng, replayEngine, owner });
    entries.push(...extra.entries); missing.push(...extra.missing);
    // Every figure an analysis drew, not only its forest plot.
    for (const [o, a] of pooled) {
      const funnel = await figureFor(a, 'funnel');
      if (funnel) entries.push({ name: `${o.id === PRIMARY ? 'analysis' : `analysis/${o.id}-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`}/funnel.svg`, data: funnel });
    }
  }
  else {
    const extra = await primaryAnalysisEntries(s, { replayEngine });
    entries.push(...extra.entries); missing.push(...extra.missing);
    const { scripts, missing: noScript } = analysisScripts(s);
    // Exact scripts are part of the working record too, not only the full ZIP.
    entries.push(...scripts.map(({ name, data }) => ({ name, data }))); missing.push(...noScript);
    if (scripts.length) entries.push({ name: 'analysis/scripts/lockfile.json', data: JSON.stringify(scriptLockfile(scripts, lock), null, 2) + '\n' });
  }

  // --- certainty: the Summary of findings and the GRADE evidence profile (plan H5, K3) --------------
  const graded = (s.grade || []).filter(o => o && typeof o === 'object');
  if (graded.length) {
    const sof = summaryOfFindings(s), table = sofBlocks(sof).find(b => b.type === 'table');
    entries.push({ name: 'certainty/summary-of-findings.csv', data: csv([...table.rows, ...sof.notes.map((n, i) => [`${String.fromCharCode(97 + i)}.`, n])]) },
      { name: 'certainty/summary-of-findings.md', data: sofMarkdown(sof) },
      { name: 'certainty/summary-of-findings.docx', data: await writeDocx({ blocks: sofBlocks(sof), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] }) },
      { name: 'certainty/evidence-profile.csv', data: profileCsv(profileOf(s)) });
    const unnamed = graded.filter(o => !String(o.name || '').trim()).length;
    if (unnamed) missing.push(`${unnamed} GRADE ${unnamed === 1 ? 'row has' : 'rows have'} no outcome name.`);
  }
  // --- synthesis without meta-analysis: the effect direction table, its sign tests and the harvest plot (SWiM; Campbell et al. 2020) --------------
  const sw = swimOf(s);
  if (sw.outcomes.length) {
    const rows = swimRows(s);
    entries.push({ name: 'swim/effect-direction.csv', data: csv(swimCsv(rows)) },
      { name: 'swim/harvest-plot.svg', data: harvestPlotSvg(rows, { weight: sw.weight || undefined, title: 'Harvest plot', style: printStyle() }) },
      { name: 'swim/reporting-items.csv', data: csv([['Item', 'Section', 'Name', 'Where reported'], ...SWIM_ITEMS.map(it => [it.id, it.section, it.name, sw.items[it.id] || ''])]) });
    const empty = sw.outcomes.filter(o => !rows.some(r => r.outcome === String(o.name || '').trim()));
    if (empty.length) missing.push(`SWiM: ${empty.map(o => o.name || 'an unnamed domain').join(', ')} ${empty.length === 1 ? 'has' : 'have'} no study with a direction of effect.`);
  }

  // --- manifest and gaps --------------------------------------------------
  entries.push({ name: 'unresolved.md', data:
    `# Unresolved\n\n` +
    (missing.length
      ? missing.map(m => `- ${m}`).join('\n') + '\n'
      : 'Nothing outstanding was detected. This is not a statement that the review is complete.\n') });

  // Each file's size and SHA-256, so a reader can check what they received;
  // the fingerprint over them says whether two bundles hold the same files.
  const files = [];
  const paths = new Set();
  for (const e of entries) {
    if (paths.has(e.name)) throw new Error(`The bundle contains duplicate file paths: ${e.name}`);
    paths.add(e.name);
  }
  for (const e of entries) { const bytes = await bytesOf(e.data); files.push({ name: e.name, bytes: bytes.length, sha256: await sha256(bytes) }); }
  const manifest = {
    generated: stamp(),
    application: 'Lykos',
    project: s.project?.name || '',
    counts: {
      records: papers.length,
      extracted_values: Object.keys(values).length,
      screening_decisions: Object.keys(screening).length,
      assessments: Object.keys(assessments).length,
      searches: (s.searches || []).length,
      notes: (s.notes || []).length,
    },
    fingerprint: await sha256(new TextEncoder().encode(files.map(f => `${f.name}\u0000${f.sha256}`).join('\n'))),
    files,
    unresolved: missing,
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  return { entries, missing, manifest };
}

const enc = new TextEncoder();
const bytesOf = async data => data instanceof Uint8Array ? data : typeof Blob !== 'undefined' && data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : enc.encode(String(data ?? ''));
async function sha256(bytes) {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = ''; for (const b of d) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** vendor.lock.json as the build carries it, or null (under node, or when it cannot be read). */
async function readLock() {
  try { const r = await fetch(appUrl('vendor.lock.json')); return r.ok ? await r.json() : null; } catch { return null; }
}

const BUNDLE_STEM = 'Submission bundle';
/**
 * Export the full bundle: into the project folder by the version rule
 * (lib/project-folder.mjs writeOutputs: "Submission bundle vN.zip", the
 * previous version to the archive), or as a download for a project in the
 * app's storage. A bundle whose files are the same as the current version's
 * (by the manifest's fingerprint) is not written again.
 * Returns { written, archived, unchanged, saved, failed, missing }.
 */
export async function exportBundle({ folder = null, typeId = 'other', svgToPng = null } = {}) {
  const source = structuredClone(get()), owner = recoveryOwner();
  const lock = await readLock();
  const { blob, missing, manifest } = await buildBundle({ full: true, lock, svgToPng, source, owner });
  if (!folder) {
    await saveFile(blob, `${String(source.project?.name || 'lykos').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lykos'}-bundle.zip`, 'application/zip');
    return { saved: true, missing };
  }
  const dir = (await projectLayout(folder, typeId)).dirFor('manuscript');
  const current = await latestBundle(folder, dir);
  if (current && current.fingerprint === manifest.fingerprint) return { unchanged: current.path, missing };
  const r = await writeOutputs(folder, [{ key: 'manuscript', stem: BUNDLE_STEM, ext: 'zip', data: blob, label: BUNDLE_STEM, kind: 'bundle' }], { typeId });
  return { written: r.written, archived: r.archived, failed: r.failed, missing };
}

/** The bundle at the highest version in a folder and its manifest's fingerprint, or null. */
async function latestBundle(folder, dir) {
  try {
    const names = (await folder.list(dir)).filter(e => !e.dir).map(e => e.name);
    const top = names.map(n => [n, /^Submission bundle v(\d+)\.zip$/.exec(n)]).filter(([, m]) => m).sort((a, b) => Number(b[1][1]) - Number(a[1][1]))[0];
    if (!top) return null;
    const path = `${dir}/${top[0]}`, bytes = await folder.read(path);
    const entry = zipList(bytes).find(e => e.name === 'manifest.json');
    const manifest = entry && JSON.parse(new TextDecoder().decode(await zipRead(bytes, entry)));
    return { path, fingerprint: manifest?.fingerprint || null };
  } catch { return null; }
}

const num = (v, d = 3) => (v == null ? '' : Number(v).toFixed(d));

function risOf(papers) {
  return papers.map(p => [
    'TY  - JOUR',
    ...authorList(p.authors).map(a => `AU  - ${a}`),
    p.title ? `TI  - ${p.title}` : '',
    p.year ? `PY  - ${p.year}` : '',
    p.journal ? `JO  - ${p.journal}` : '',
    p.doi ? `DO  - ${p.doi}` : '',
    p.pmid ? `AN  - ${p.pmid}` : '',
    'ER  - ',
  ].filter(Boolean).join('\n')).join('\n\n') + '\n';
}

function protocolDoc(p) {
  const pico = Object.entries(p.pico || {})
    .map(([k, v]) => `- **${k}**: ${v || '—'}`).join('\n');
  const crit = (p.criteria || [])
    .map(c => `- **${c.id}** (${c.stage}): ${c.text || '—'}`).join('\n');
  return `# ${p.title || 'Untitled review'}\n\n## Question\n\n${pico || '—'}\n\n` +
         `## Eligibility criteria\n\n${crit || '—'}\n`;
}

/**
 * Which values a model proposed and which a person selected. Cochrane and
 * partners ask for AI use to be disclosed and accountable; this is the record
 * that supports that, and it is generated rather than written from memory.
 */
function aiDisclosure(s, values) {
  const byModel = {};
  for (const v of Object.values(values)) {
    const key = v.extractor || 'unknown';
    (byModel[key] ||= []).push(v);
  }
  const cfg = settingsOf(s).ai;
  const lines = Object.entries(byModel).map(([who, vs]) =>
    `- \`${who}\` — ${vs.length} ${vs.length === 1 ? 'value' : 'values'} accepted (${vs.map(v => v.field_id).join(', ')})`);
  return `# AI use\n\n` +
    `Configured provider at export: ${cfg?.provider ? `${cfg.provider}, model \`${cfg.model}\`` : 'none'}.\n\n` +
    `## How each accepted value was produced\n\n${lines.join('\n') || '- No values recorded.'}\n\n` +
    `Values marked \`model:\` were proposed by a model from a quoted passage and ` +
    `accepted by a person. Every accepted value carries the page and rectangles ` +
    `it came from, in \`extracted-values.csv\`.\n`;
}

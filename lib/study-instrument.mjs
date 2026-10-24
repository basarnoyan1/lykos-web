// The instrument a study is appraised with (plan H2; amendment "An appraisal instrument from the study's design", 2026-10-17).
//
// A review mixes designs: a case series is appraised with the JBI case-series checklist, a comparative cohort with ROBINS-I, a trial with
// RoB 2. Which one a study takes is decided here, in this order:
//
//   1. a person's choice for the study (`s.appraisalByStudy[paperId]`, Appraisal's Instrument select, a workbook import);
//   2. an appraisal already started: the instrument that holds its answers (the design's, else the review's, else the first), so an answer
//      is never hidden by a design read later;
//   3. the study's design: the design text extracted for it (Study data's Design, or a table's "Study design" column) with its arms and
//      patients, read as a kind of study, and the instrument whose declared design (`tool.design`) is that kind: the review's own instrument
//      when it is one, else the one the review already uses most, else one the review team defined (a custom ROBINS-I V2), else the usual one;
//   4. the review's instrument (`s.appraisalTool`, else the research type's default).
//
// Nothing is stored: a design filled in after inclusion changes the empty checklist, and from the first answer the instrument holds.
// Pure over the state; no store, no clock.
import { allTools, appraisalTool, APPRAISAL_TOOLS } from '../schema.mjs';
import { defaultAppraisal } from './workflow.mjs';
import { armsOf, cellKey } from './arms.mjs';

const lower = t => String(t ?? '').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * The kinds of study the rule knows, in the order they are tried: `designs` are the `tool.design` texts that fit the kind (the instruments'
 * own declarations), `usual` the instrument taken when the review has no other that fits.
 */
export const DESIGN_KINDS = Object.freeze([
  { id: 'review', name: 'Systematic review', usual: 'amstar2', designs: ['systematic reviews', 'systematic reviews and research syntheses'] },
  { id: 'accuracy', name: 'Diagnostic accuracy study', usual: 'quadas-2', designs: ['diagnostic accuracy studies'] },
  { id: 'prediction', name: 'Prediction model study', usual: 'probast', designs: ['prediction model studies'] },
  { id: 'qualitative', name: 'Qualitative study', usual: 'casp-qual', designs: ['qualitative studies'] },
  { id: 'case-report', name: 'Case report', usual: 'jbi-case-report', designs: ['case reports'] },
  { id: 'trial', name: 'Randomised trial', usual: 'rob2', designs: ['randomised trials', 'randomised controlled trials'] },
  { id: 'case-control', name: 'Case–control study', usual: 'jbi-case-control', designs: ['case-control studies'] },
  { id: 'cross-sectional', name: 'Cross-sectional study', usual: 'jbi-cross-sectional', designs: ['analytical cross-sectional studies'] },
  { id: 'case-series', name: 'Case series', usual: 'jbi-case-series', designs: ['case series'] },
  { id: 'comparative', name: 'Comparative non-randomised study', usual: 'robins-i',
    designs: ['non-randomised studies of interventions', 'non-randomised studies', 'quasi-experimental studies', 'cohort studies', 'non-randomised surgical studies'] },
]);
const KIND = new Map(DESIGN_KINDS.map(k => [k.id, k]));

const NON_RANDOM = /\bnon[- ]?randomi[sz]ed|\bquasi|\bnot randomi[sz]ed|\bpseudo[- ]?randomi/;
const OBSERVED = /cohort|registry|observational|retrospective|prospective|interventional|comparative|non[- ]?randomi[sz]ed|quasi|chart review|before[- ]and[- ]after|pre[- ]?post|single[- ]arm|single[- ]group|longitudinal|follow[- ]up study/;

/**
 * The kind of study a design text describes, with its arms (2 compared groups or more, 1, or null when not known) and patients (a count
 * or null): a kind id of DESIGN_KINDS, or '' when the text does not say. A cohort, registry or other observational design is comparative
 * with two arms or more and a case series with one; with the arms unknown it is not decided.
 */
export function designKind(text, { arms = null, patients = null } = {}) {
  const t = lower(text);
  if (!t) return '';
  if (/systematic review|meta-analys|umbrella review|scoping review/.test(t)) return 'review';
  if (/diagnostic|test accuracy|sensitivity and specificity/.test(t)) return 'accuracy';
  if (/prediction model|prognostic model|risk model/.test(t)) return 'prediction';
  if (/qualitative|focus group|interview study|ethnograph|phenomenolog|grounded theory/.test(t)) return 'qualitative';
  if (/case report|single[- ](patient|case)\b/.test(t) || patients === 1) return 'case-report';
  if (/\brct\b|randomi[sz]ed|randomly (allocated|assigned)/.test(t) && !NON_RANDOM.test(t)) return 'trial';
  if (/case[- ]control/.test(t)) return 'case-control';
  if (/cross[- ]sectional|prevalence survey/.test(t)) return 'cross-sectional';
  if (/case series/.test(t)) return 'case-series';
  const single = /single[- ](arm|group)|non[- ]?comparative|uncontrolled/.test(t), compared = /\bversus\b|\bvs\.?\b|comparative|controlled|matched|two[- ]arm/.test(t);
  if (OBSERVED.test(t) || single || compared) {
    const n = single ? 1 : arms ?? (compared ? 2 : null);
    return n == null ? '' : n >= 2 ? 'comparative' : 'case-series';
  }
  return '';
}

// ---- reading a study's design from its extraction --------------------------------------------------------------------------------------
const textOf = v => (v == null ? '' : String(v.reported_value ?? v.normalized_value ?? v.value ?? '').trim());
const NR = /^(nr|na|n\/a|not reported|not applicable|unclear)$/i;
const DESIGN_COL = c => /^(study )?design$/i.test(String(c.label || c.name || '').trim()) || /(^|[._])(study_)?design$/i.test(String(c.id || ''));
const ARM_COL = c => /^arm\b/i.test(String(c.label || '').trim()) || /(^|[._])arm(_n)?$/i.test(String(c.id || ''));
const colsMemo = new WeakMap();
/** A table's design column and arm column, found once per table. */
function columnsOf(t) {
  if (!colsMemo.has(t)) colsMemo.set(t, { design: (t.columns || []).find(DESIGN_COL) || null, arm: (t.columns || []).find(ARM_COL) || null });
  return colsMemo.get(t);
}
/** The patients a cell says ("NA (n=68)", "Arm 1 (n=32)", "n = 1"), or null. */
const patientsIn = text => { const m = /\bn\s*=\s*(\d+)/i.exec(String(text || '')); return m ? Number(m[1]) : null; };
const builtIn = (s, p, id) => textOf(s.values?.[cellKey(p, id)]);

/**
 * What the extraction says about a study's design: `{ text, arms, patients }`, or null when no design is extracted. The text is the first
 * one found (Study data's Design, then each table's design column); arms come from the table's arms (a table that lays out arms and lists
 * none for the study holds one) or from Study data's control-arm inputs; patients from the arm column's "n =" when the study has one arm.
 */
export function designOf(s, paperId) {
  let text = builtIn(s, paperId, 'design'), arms = null, patients = null;
  for (const t of s.templates || []) {
    const { design, arm } = columnsOf(t);
    if (!design && !arm) continue;
    const here = design ? textOf(s.values?.[cellKey(paperId, design.id)]) : '';
    const has = here || (arm && s.values?.[cellKey(paperId, arm.id)]);
    if (!text && here) text = here;
    if (!has) continue;
    const list = armsOf(t, paperId);
    if (list) arms = Math.max(arms || 0, list.length);
    else if (t.arms && typeof t.arms === 'object' && arms == null) {
      arms = 1;
      if (arm) patients = patientsIn(textOf(s.values?.[cellKey(paperId, arm.id)]));
    }
  }
  if (!text || NR.test(text)) return null;
  if (arms == null) {
    // Study data: inputs for a control arm say the study compares two groups; single-group inputs, one
    const control = ['events_c', 'n_c', 'mean_c', 'sd_c', 'comparator'].some(id => { const v = builtIn(s, paperId, id); return v && !NR.test(v); });
    const single = ['events', 'n', 'mean'].some(id => builtIn(s, paperId, id));
    arms = control ? 2 : single ? 1 : null;
    if (arms === 1) patients = Number(builtIn(s, paperId, 'n')) || null;
  }
  return { text, arms, patients };
}

// ---- the instrument ----------------------------------------------------------------------------------------------------------------------
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const any = v => isObj(v) && Object.values(v).some(Boolean);
/** The instruments holding answers for a study: its stored final answers, either reviewer's, or the flat shape of the first RoB 2 records. */
export function startedWith(s, paperId) {
  const ids = new Set(allTools(s).map(t => t.id)), out = new Set();
  const rec = s.assessments?.[paperId];
  if (isObj(rec)) {
    for (const [k, v] of Object.entries(rec)) if (ids.has(k) && any(v)) out.add(k);
    if (Object.entries(rec).some(([k, v]) => !ids.has(k) && v)) out.add('rob2');
  }
  for (const [k, levels] of Object.entries(s.robReview?.records?.[paperId] || {})) {
    if (isObj(levels) && Object.values(levels).some(r => any(r?.a) || any(r?.b) || any(r?.resolved))) out.add(k);
  }
  return [...out];
}

/** The review's own instrument: chosen under Appraisal › Review, else the research type's. */
export const reviewInstrument = s => s.appraisalTool || defaultAppraisal(s);

/** Whether an instrument's declared design is the kind's; a review team's own instrument also by its name (a custom "ROBINS-I V2"). */
const fits = (kind, tool) => kind.designs.includes(lower(tool.design))
  || (tool.custom && lower(tool.name).startsWith(lower(APPRAISAL_TOOLS.find(t => t.id === kind.usual)?.name)));

/** How many studies a person gave each instrument, for "the one the review already uses most". */
const usageMemo = new WeakMap();
function usage(s) {
  const by = s.appraisalByStudy;
  if (!isObj(by)) return new Map();
  if (!usageMemo.has(by)) { const m = new Map(); for (const id of Object.values(by)) m.set(id, (m.get(id) || 0) + 1); usageMemo.set(by, m); }
  return usageMemo.get(by);
}

/** The instrument for a kind of study in this review: the review's own when it fits, the most used that fits, a custom one, the usual one. */
export function instrumentForKind(s, kindId) {
  const kind = KIND.get(kindId);
  if (!kind) return null;
  const tools = allTools(s), fitting = tools.filter(t => fits(kind, t));
  const own = reviewInstrument(s);
  if (fitting.some(t => t.id === own)) return own;
  const used = usage(s), best = fitting.filter(t => used.get(t.id)).sort((a, b) => used.get(b.id) - used.get(a.id))[0];
  if (best) return best.id;
  return fitting.find(t => t.custom)?.id || kind.usual;
}

/**
 * Which instrument a study takes and why: `{ id, how, design }`, `how` one of 'chosen' (a person chose it for the study), 'started' (an
 * appraisal holds answers with it), 'design' (read from `design`: `{ text, arms, patients, kind }`) or 'review' (the review's own).
 */
export function instrumentChoice(s, paperId) {
  const own = paperId != null ? s.appraisalByStudy?.[paperId] : null;
  if (own) return { id: own, how: 'chosen', design: null };
  const review = reviewInstrument(s);
  if (paperId == null) return { id: review, how: 'review', design: null };
  const d = designOf(s, paperId), kind = d ? designKind(d.text, d) : '';
  const fromDesign = kind ? instrumentForKind(s, kind) : null;
  const started = startedWith(s, paperId);
  if (started.length) {
    const id = [fromDesign, review].find(x => x && started.includes(x)) || started[0];
    return { id, how: 'started', design: null };
  }
  if (fromDesign) return { id: fromDesign, how: 'design', design: { ...d, kind } };
  return { id: review, how: 'review', design: null };
}

/** The instrument a study is appraised with, as a tool (schema.mjs shape). Without a study, the review's. */
export const instrumentFor = (s, paperId) => appraisalTool(instrumentChoice(s, paperId).id, s);

const ARMS = { 1: 'one arm', 2: 'two arms', 3: 'three arms', 4: 'four arms' };
/** Why a study has its instrument, in one quiet line: "From design: Retrospective cohort, one arm", "Chosen for this study". */
export function instrumentReason(choice) {
  if (!choice) return '';
  if (choice.how === 'chosen') return 'Chosen for this study';
  if (choice.how === 'started') return 'Answers given with this instrument';
  if (choice.how === 'review') return "The review's instrument";
  const d = choice.design, text = d.text.split('\n')[0].trim();
  // the arms are said when they decided between a case series and a comparative study
  const armsSaid = ['case-series', 'comparative'].includes(d.kind) && d.arms && !/case series/i.test(text) ? `, ${ARMS[d.arms] || `${d.arms} arms`}` : '';
  const one = d.kind === 'case-report' && d.patients === 1 && !/case report/i.test(text) ? ', one patient' : '';
  return `From design: ${text}${armsSaid}${one}`;
}

/**
 * Sets a person's choice for a study: kept only when it differs from what the study would take without one, so choosing the instrument the
 * design gives returns the study to following its design. Mutates and returns the state.
 */
export function chooseInstrument(st, paperId, toolId) {
  const by = { ...(st.appraisalByStudy || {}) };
  delete by[paperId];
  const auto = instrumentChoice({ ...st, appraisalByStudy: by }, paperId).id;
  if (toolId && toolId !== auto) by[paperId] = toolId;
  if (Object.keys(by).length) st.appraisalByStudy = by; else delete st.appraisalByStudy;
  return st;
}

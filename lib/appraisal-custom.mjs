// The appraisal view's glue for instruments the review team defines
// (lib/custom-instrument.mjs) and for the scores the shipped instruments
// define (lib/appraisal-extra.mjs). Pure: the view and the tests call it with
// the state.
//
// A custom instrument's questions are answered beside its domains, under the
// key `domain.question` in the same answers map, so they travel with the
// assessment (reviewers, levels, the mirror in s.assessments) without a
// second store. The domain judgement stays the reviewer's. With the "worst"
// rule the overall is the least favourable domain judgement, written as the
// overall answer whenever a domain changes, so every reader (list, figures,
// exports) sees it; "manual" leaves the overall to the reviewer.
import { allTools, customTools, APPRAISAL_TOOLS } from '../schema.mjs';
import { overallFrom, toolId, validate } from './custom-instrument.mjs';
import { scoreOf, agreeScores, mmatScreen } from './appraisal-extra.mjs';
import { setAnswer, OVERALL } from './rob-review.mjs';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);

/** The stored list as a list of definitions: objects with an id, the first of each id kept. */
export function normalizeInstruments(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(x => plain(x) && typeof x.id === 'string' && x.id.trim() && !seen.has(x.id) && seen.add(x.id));
}

/** Ids a definition may not take: the shipped instruments', and the project's others. */
export function reservedIds(s, own = '') {
  return [...APPRAISAL_TOOLS.map(t => t.id), ...(s?.customInstruments || []).map(i => String(i?.id || '')).filter(id => id && id !== own)];
}

const slug = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** An unused instrument id from a name. */
export function freeId(s, name = '') {
  const taken = new Set(reservedIds(s).flatMap(id => [id, toolId(id)]));
  const base = slug(name) || 'instrument';
  for (let n = 1; ; n++) { const id = n === 1 ? base : `${base}-${n}`; if (!taken.has(id) && !taken.has(toolId(id))) return id; }
}

/** A new definition to edit: three ranked levels, one domain, the worst-domain overall. */
export const blankInstrument = s => ({
  id: freeId(s), name: '', design: '',
  judgements: ['Low', 'Some concerns', 'High'], unranked: [],
  domains: [{ id: 'd1', name: '', questions: [] }],
  overall: 'worst',
});

/** A copy under a free id, named as a copy. */
export function duplicateInstrument(s, inst) {
  const copy = structuredClone(inst);
  copy.name = `${String(inst.name || '').trim()} (copy)`;
  copy.id = freeId(s, copy.name);
  return copy;
}

/** Problems with a definition as it would be saved in this project. */
export const checkInstrument = (s, inst, own = '') => validate(inst, { reserved: reservedIds(s, own) });

/** Adds or replaces (by `own`, the id it was saved under) a definition; the caller has validated it. */
export function saveInstrument(st, inst, own = '') {
  const list = normalizeInstruments(st.customInstruments);
  const at = own ? list.findIndex(x => x.id === own) : -1;
  st.customInstruments = at >= 0 ? list.map((x, i) => (i === at ? inst : x)) : [...list, inst];
  return st;
}

/** Studies with answers under an instrument. */
export const studiesUsing = (s, id) => Object.entries(s.assessments || {}).filter(([, rec]) => rec && rec[toolId(id)] && Object.keys(rec[toolId(id)]).length).map(([pid]) => pid);

/** Removes a definition with every answer given under it, and every choice of it. */
export function removeInstrument(st, id) {
  const tid = toolId(id);
  st.customInstruments = normalizeInstruments(st.customInstruments).filter(x => x.id !== id);
  for (const rec of Object.values(st.assessments || {})) if (rec && typeof rec === 'object') delete rec[tid];
  for (const [pid, rec] of Object.entries(st.assessments || {})) if (!rec || !Object.keys(rec).length) delete st.assessments[pid];
  const records = st.robReview?.records || {};
  for (const [pid, byTool] of Object.entries(records)) { if (byTool) delete byTool[tid]; if (!byTool || !Object.keys(byTool).length) delete records[pid]; }
  if (st.appraisalTool === tid) delete st.appraisalTool;
  if (st.appraisalByStudy) {
    for (const [pid, t] of Object.entries(st.appraisalByStudy)) if (t === tid) delete st.appraisalByStudy[pid];
    if (!Object.keys(st.appraisalByStudy).length) delete st.appraisalByStudy;
  }
  return st;
}

// ---- answering ------------------------------------------------------------------

/** The key a question's answer is kept under. */
export const questionKey = (domainId, questionId) => `${domainId}.${questionId}`;

/** The overall a custom instrument's rule gives for these answers: a level, or '' (manual, none, incomplete). */
export function ruleOverall(tool, answers = {}) {
  if (!tool?.custom || tool.overallRule !== 'worst') return '';
  try { return overallFrom(answers, 'worst', tool).value || ''; } catch { return ''; }
}

/** The instrument ids a write keeps in the s.assessments mirror (every instrument, the project's own included). */
export const toolIdsOf = s => allTools(s).map(t => t.id);

/**
 * One reviewer's answer, and with the "worst" rule the overall that follows
 * from that reviewer's domain judgements at the same level.
 */
export function answerWith(st, tool, { paperId, level, who = 'a', domain, value }) {
  const toolIds = toolIdsOf(st);
  setAnswer(st, { paperId, toolId: tool.id, level, who, domain, value, toolIds });
  if (tool.custom && tool.overallRule === 'worst' && domain !== OVERALL && tool.domains.some(d => d.id === domain)) {
    const r = st.robReview?.records?.[paperId]?.[tool.id]?.[level];
    const mine = (who === 'b' ? r?.b : r?.a) || {};
    const next = ruleOverall(tool, mine);
    if ((mine[OVERALL] || '') !== next) setAnswer(st, { paperId, toolId: tool.id, level, who, domain: OVERALL, value: next, toolIds });
  }
  return st;
}

// ---- scores -------------------------------------------------------------------------

const pct = x => (x == null ? '' : `${x}%`);

/**
 * What an instrument's own scoring says about a study, as rows of
 * { label, value, note? } for the detail. `appraisals` is every appraiser's
 * answers (reviewers A and B with two), the first being the final ones used
 * for star and point totals. Null when the instrument defines no score and
 * no screening step.
 */
export function scoreRows(tool, appraisals = []) {
  const answers = appraisals[0] || {};
  if (tool?.id?.startsWith('mmat-')) {
    const m = mmatScreen(answers);
    return { title: 'Screening', rows: [{ label: 'S1 and S2', value: m.proceed ? 'Proceed' : m.failed.length ? 'Do not proceed' : 'Not answered', note: m.reason || 'No overall score: report each criterion' }] };
  }
  if (tool?.scoring === 'agree') {
    const list = appraisals.filter(a => a && Object.keys(a).length);
    const scores = agreeScores(list.length ? list : [answers]);
    const n = Math.max(1, list.length);
    return { title: 'Scaled domain scores', rows: scores.map(d => ({ label: `${d.domain}. ${d.name}`, value: d.complete ? pct(d.pct) : `${d.items} items`, note: d.complete ? `${d.obtained} of ${d.max} · ${n} ${n === 1 ? 'appraiser' : 'appraisers'}` : '' })) };
  }
  const sc = scoreOf(tool, answers);
  if (!sc) return null;
  if (tool.scoring === 'nos') {
    const third = sc.third === 'exposure' ? 'Exposure' : 'Outcome';
    return { title: 'Stars', rows: [
      { label: 'Total', value: `${sc.total} of ${sc.max}`, note: sc.complete ? '' : `${sc.unanswered} unanswered` },
      { label: 'Selection', value: `${sc.selection} of 4` },
      { label: 'Comparability', value: `${sc.comparability} of 2` },
      { label: third, value: `${sc[sc.third]} of 3` },
      ...(sc.convention ? [{ label: 'AHRQ convention', value: sc.convention, note: sc.conventionNote }] : []),
    ] };
  }
  if (tool.scoring === 'minors') {
    return { title: 'Points', rows: [{ label: 'Total', value: `${sc.total} of ${sc.max}`, note: `${sc.comparative ? 'Comparative' : 'Non-comparative'}${sc.complete ? '' : ` · ${sc.unanswered} unanswered`}` }] };
  }
  return null;
}

/** A short score for a list row or a grid cell, or ''. */
export function scoreMark(tool, answers = {}) {
  if (tool?.scoring === 'nos' || tool?.scoring === 'minors') {
    const sc = scoreOf(tool, answers);
    if (!sc || sc.unanswered) return '';
    return tool.scoring === 'nos' ? `${sc.total} of 9 stars` : `${sc.total} of ${sc.max}`;
  }
  return '';
}

export { customTools };

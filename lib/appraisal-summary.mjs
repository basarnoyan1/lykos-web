// Appraisal summarised the way a review reports it (plan H3, K3): one row per
// study and instrument, an answer per item, the items met of those that apply,
// and a grade only where the review has stated a rule for it.
//
// The app records the reviewer's answers and does not judge (plan §1.3). A
// checklist such as JBI's has no official overall grade; a review that grades
// "low (>70% of applicable items met), moderate (50–70%), high (<50%)" states
// that in its methods, and that statement is kept in `s.appraisalRule`
// ({ low, moderate }). Without one, no grade is shown: the counts are.
//
// Pure over the project state.
import { allTools, appraisalTool } from '../schema.mjs';
import { instrumentFor } from './study-instrument.mjs';

const YES = 'Yes', NA = 'Not applicable';

/** Items met among those that apply: "Yes" is met, "Unclear" and "No" are not, "Not applicable" leaves the denominator. */
export function itemsMet(answers = {}, tool) {
  const ids = tool.domains.map(d => d.id);
  let met = 0, applicable = 0, unanswered = 0;
  for (const id of ids) {
    const a = answers[id];
    if (!a) { unanswered++; continue; }
    if (a === NA) continue;
    applicable++;
    if (a === YES) met++;
  }
  return { met, applicable, unanswered, pct: applicable ? (met / applicable) * 100 : null };
}

/** The grade a stated rule gives a proportion: Low above `low`, Moderate from `moderate` up to `low`, High below; '' with no rule or no proportion. */
export function gradeBy(pct, rule) {
  if (pct == null || !rule || !Number.isFinite(Number(rule.low)) || !Number.isFinite(Number(rule.moderate))) return '';
  return pct > rule.low ? 'Low' : pct >= rule.moderate ? 'Moderate' : 'High';
}

/** Whether an instrument answers Yes/No items (so a proportion means something). */
export const isChecklist = tool => (tool.judgements || []).includes(YES);

/** Whether an assessment is complete: every domain judged, and the overall judgement where the instrument asks for one (Appraisal's Complete). */
export const isComplete = (tool, answers = {}) => tool.domains.every(d => answers[d.id]) && (!tool.overall || Boolean(answers.overall));

/** The instrument a study is appraised with (lib/study-instrument.mjs: its own, the one started, its design's, the review's); without a study, the review's. */
export const toolOf = (s, paperId, fallback) => (paperId != null ? instrumentFor(s, paperId) : appraisalTool(s.appraisalTool || fallback || 'rob2', s));

/**
 * Every assessment as a row: `{ paperId, study, tool, toolName, answers, overall, met, applicable, pct, grade }`,
 * in the order of the project's papers; an instrument a study was assessed
 * with and any other with answers each give a row.
 */
export function assessmentRows(s) {
  const rows = [];
  const byId = new Map((s.papers || []).map(p => [p.id, p]));
  for (const p of s.papers || []) {
    const rec = s.assessments?.[p.id];
    if (!rec || typeof rec !== 'object') continue;
    for (const tool of allTools(s)) {
      const answers = rec[tool.id];
      if (!answers || typeof answers !== 'object' || !Object.keys(answers).length) continue;
      const m = isChecklist(tool) ? itemsMet(answers, tool) : { met: null, applicable: null, unanswered: 0, pct: null };
      rows.push({ paperId: p.id, study: byId.get(p.id)?.label || p.title || p.id, tool: tool.id, toolName: tool.name, design: tool.design, answers,
        byShort: Object.fromEntries(tool.domains.map(d => [d.short, answers[d.id] || ''])),
        overall: answers.overall || '', met: m.met, applicable: m.applicable, pct: m.pct, grade: isChecklist(tool) ? gradeBy(m.pct, s.appraisalRule) : (answers.overall || '') });
    }
  }
  return rows;
}

/** Counts by grade (or by overall judgement) per instrument, for a sentence like "low in 10 reports and moderate in 1". */
export function gradeCounts(rows) {
  const by = {};
  for (const r of rows) { const k = r.grade || 'Not graded'; (by[r.tool] ||= {})[k] = (by[r.tool][k] || 0) + 1; }
  return by;
}

/**
 * Where the grades the review reported differ from the rule applied to its
 * own answers: `[{ study, stated, computed, met, applicable }]`, so a table
 * whose grade does not follow from its items is seen before it is published.
 */
export function gradeDisagreements(rows, stated) {
  const out = [];
  for (const r of rows) {
    const g = stated.get?.(r.paperId);
    if (g && r.grade && g.toLowerCase() !== r.grade.toLowerCase()) out.push({ study: r.study, stated: g, computed: r.grade, met: r.met, applicable: r.applicable });
  }
  return out;
}

/** The columns a wide appraisal table needs: each instrument's item shorts in order, unioned across the instruments in use. */
export function itemColumns(rows, s) {
  const seen = new Map();
  for (const r of rows) for (const d of appraisalTool(r.tool, s).domains) if (!seen.has(d.short)) seen.set(d.short, { id: d.short, short: d.short });
  return [...seen.values()].sort((a, b) => (parseInt(a.short.slice(1), 10) || 0) - (parseInt(b.short.slice(1), 10) || 0) || a.short.localeCompare(b.short));
}

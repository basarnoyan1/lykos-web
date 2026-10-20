// Synthesis without meta-analysis in the project (plan H5; lib/swim.mjs holds
// the statistics and the figure).
//
//   s.swim = {
//     outcomes: [{ id, name, outcomeId }],            // outcome domains, in order; outcomeId names the outcome (lib/outcome-links.mjs)
//     cells: { [paperId]: { [outcomeId]: direction } }, // 'benefit' | 'harm' | 'no clear' | 'mixed'
//     n: { [paperId]: '120' },                         // sample size, optional
//     items: { [swimItemId]: 'where reported' },       // the SWiM reporting aid
//     weight: 'n' | 'rob' | 'equal' | '',              // harvest plot bar height; '' picks n when any is given
//   }
//
// A study's risk of bias is not typed here: it is read from its appraisal
// (the overall judgement, or a checklist's grade under the review's rule).
// Pure.
import { effectDirection, robLevel } from './swim-core.mjs';
import { normalizeSwim } from './swim-normalize.mjs';
import { scoreOf } from './appraisal-extra.mjs';
import { assessmentRows, toolOf } from './appraisal-summary.mjs';

export { normalizeSwim };

export const swimOf = s => normalizeSwim(s?.swim);

/**
 * A study's risk of bias from its appraisal with its own instrument: the
 * overall, the checklist grade under the review's rule, or the Newcastle–Ottawa
 * convention; '' when not assessed or when the instrument's overall is not a
 * risk-of-bias judgement (AGREE II rates a guideline, not bias).
 */
export function robOf(s, paperId, rows = assessmentRows(s)) {
  const tool = toolOf(s, paperId);
  const r = rows.find(x => x.paperId === paperId && x.tool === tool.id);
  if (!r) return '';
  if (tool.scoring === 'nos') return scoreOf(tool, r.answers)?.convention || '';
  const g = r.grade || '';
  return tool.custom || robLevel(g) ? g : '';
}

/** The rows lib/swim.mjs reads: one per study and outcome domain with a direction, labelled by the study. */
export function swimRows(s, papers) {
  const sw = swimOf(s), rows = assessmentRows(s);
  const list = papers || (s.papers || []).filter(p => sw.cells[p.id]);
  const out = [];
  for (const p of list) for (const o of sw.outcomes) {
    const direction = sw.cells[p.id]?.[o.id];
    if (!direction || !o.name.trim()) continue;
    const n = Number(sw.n[p.id]);
    out.push({ study: p.label || p.id, outcome: o.name.trim(), direction, n: sw.n[p.id] != null && Number.isFinite(n) ? n : null, rob: robOf(s, p.id, rows) });
  }
  return out;
}

const pText = p => (p == null ? '' : p < 0.001 ? '< 0.001' : p.toFixed(3));

/** The effect direction table as CSV rows: studies × outcomes, then per outcome the votes and the sign test. */
export function swimCsv(rows) {
  const ed = effectDirection(rows);
  const out = [['Study', 'n', 'Risk of bias', ...ed.outcomes]];
  for (const t of ed.table) out.push([t.study, t.n ?? '', t.rob, ...ed.outcomes.map(o => t.directions[o] || '')]);
  out.push([]);
  out.push(['Outcome', 'Studies', 'Benefit', 'Harm', 'No clear', 'Mixed', 'Sign test p']);
  for (const o of ed.byOutcome) out.push([o.outcome, o.k, o.votes.benefit, o.votes.harm, o.votes['no clear'], o.votes.mixed, pText(o.signTest.p)]);
  return out;
}

export { pText as signP };

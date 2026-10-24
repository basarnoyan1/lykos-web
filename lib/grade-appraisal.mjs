// What the appraisals say about the studies of one outcome, set beside GRADE's risk-of-bias domain (plan H5, amended 2026-10-17): how
// many of the outcome's studies each instrument judged, and how. Information only: the domain's rating stays the reviewer's (§1.3), and
// nothing here weighs the studies or proposes a rating.
//
// An outcome's studies are the ones its result pooled; without a result, the ones given a direction in its SWiM domain; without either,
// the included studies. Pure over the state; `included` is the list of included studies (lib/screen.mjs studies()).
import { analysisOf, timepointsOf, slotId } from './outcomes.mjs';
import { assessmentRows, toolOf } from './appraisal-summary.mjs';
import { scoreOf } from './appraisal-extra.mjs';
import { robLevel } from './swim-core.mjs';
import { usesOf } from './outcome-links.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `{ basis: 'pooled' | 'synthesis' | 'included', ids: [paperId] }`: the studies the outcome's evidence comes from. */
export function outcomeStudies(s, outcomeId, included = []) {
  const papers = s.papers || [], byLabel = new Map(papers.map(p => [p.label, p.id])), known = new Set(papers.map(p => p.id));
  const pooled = new Set();
  for (const t of timepointsOf(s, outcomeId)) {
    const a = analysisOf(s, slotId(outcomeId, t.id));
    if (!a) continue;
    // a result read per arm keeps its units, a study's id with its arm (lib/pooled-r.mjs); a pairwise one its labels
    const units = (Array.isArray(a.units) ? a.units : []).map(u => String(u).replace(/@arm\d+$/, '')).filter(id => known.has(id));
    for (const id of units.length ? units : (a.labels || []).map(l => byLabel.get(l)).filter(Boolean)) pooled.add(id);
  }
  if (pooled.size) return { basis: 'pooled', ids: [...pooled] };
  const cells = s.swim?.cells || {}, domains = usesOf(s, outcomeId).swim.map(d => d.id);
  const judged = Object.keys(cells).filter(pid => known.has(pid) && domains.some(d => cells[pid]?.[d]));
  if (judged.length) return { basis: 'synthesis', ids: judged };
  return { basis: 'included', ids: included.map(p => p.id) };
}

const BASIS = { pooled: 'pooled', synthesis: 'in the synthesis', included: 'included' };

/**
 * `[[label, text]]` for the risk-of-bias domain of a GRADE row reporting `outcomeId`: the studies first, then one line per instrument,
 * e.g. ['JBI case series', '3 of 12 with concerns · Low 9, Moderate 2, High 1']. A checklist the review gave no grading rule reads
 * by the items met. [] when there are no studies.
 */
export function appraisalFacts(s, outcomeId, included = []) {
  const { basis, ids } = outcomeStudies(s, outcomeId, included);
  if (!ids.length) return [];
  const rows = assessmentRows(s), by = new Map();
  for (const pid of ids) {
    const tool = toolOf(s, pid), r = rows.find(x => x.paperId === pid && x.tool === tool.id);
    const g = by.get(tool.id) || { name: tool.name, n: 0, judged: {}, concerns: 0, low: 0, pcts: [], ungraded: 0 };
    g.n++;
    if (r) {
      const word = tool.scoring === 'nos' ? scoreOf(tool, r.answers)?.convention || '' : r.grade || '';
      if (word) {
        g.judged[word] = (g.judged[word] || 0) + 1;
        const level = robLevel(word);
        if (level === 'low') g.low++; else if (level) g.concerns++;
      } else if (r.pct != null) { g.ungraded++; g.pcts.push(r.pct); }
      else g.ungraded++;
    }
    by.set(tool.id, g);
  }
  const out = [['Studies', `${ids.length} ${BASIS[basis]}`]];
  for (const g of [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))) {
    const words = Object.entries(g.judged), judged = words.reduce((a, [, k]) => a + k, 0), seen = judged + g.ungraded;
    const parts = [];
    if (judged) parts.push(`${g.concerns} of ${g.n} with concerns`, words.map(([w, k]) => `${w} ${k}`).join(', '));
    if (g.pcts.length) {
      const lo = Math.round(Math.min(...g.pcts)), hi = Math.round(Math.max(...g.pcts));
      parts.push(`${plural(g.pcts.length, 'study', 'studies')} with no overall: items met ${lo === hi ? `${lo}%` : `${lo}–${hi}%`}`);
    } else if (g.ungraded) parts.push(`${plural(g.ungraded, 'study', 'studies')} with no overall`);
    if (seen < g.n) parts.push(`${g.n - seen} not appraised`);
    out.push([g.name, parts.join('; ')]);
  }
  return out;
}

// GRADE-CERQual (Lewin et al. 2018): confidence in each review finding of a
// qualitative evidence synthesis, and the Summary of Qualitative Findings
// table it produces.
//
// A finding is an analytical theme (lib/qes.mjs). The reviewer judges four
// components and then the overall confidence. CERQual has no arithmetic from
// components to confidence, so nothing here computes one. The overall level is
// the reviewer's own choice and exists only once every component is judged: a
// finding with a component left unjudged has no overall confidence ('' here,
// "Not judged" on screen), whatever was stored before. A level below High needs
// a written explanation.
//
// Stored on the analytical theme as `cerqual`:
//   { components: { [id]: { concern, explanation } }, confidence, explanation }
import { readQes, qesOf, sourcesOf, labelOf } from './qes.mjs';

export const COMPONENTS = [
  { id: 'limitations', label: 'Methodological limitations' },
  { id: 'coherence', label: 'Coherence' },
  { id: 'adequacy', label: 'Adequacy of data' },
  { id: 'relevance', label: 'Relevance' },
];
export const CONCERNS = ['No or very minor concerns', 'Minor concerns', 'Moderate concerns', 'Serious concerns'];
export const CONFIDENCE = ['High', 'Moderate', 'Low', 'Very low'];
export const START = 'High';

/**
 * A finding's assessment with every component present. `judged` is how many of the four components carry a concern; `complete` is all
 * four. `confidence` is the overall level, '' (not judged) until the reviewer has chosen one and every component is judged. `assessed`
 * is true exactly when there is an overall confidence to report.
 */
export function assessmentOf(theme) {
  const c = theme?.cerqual || {};
  const components = Object.fromEntries(COMPONENTS.map(x => [x.id, { concern: '', explanation: '', ...(c.components?.[x.id] || {}) }]));
  const judged = COMPONENTS.filter(x => components[x.id].concern).length, complete = judged === COMPONENTS.length;
  const confidence = complete && CONFIDENCE.includes(c.confidence) ? c.confidence : '';
  return { components, judged, complete, confidence, chosen: Boolean(c.confidence), explanation: c.explanation || '', assessed: Boolean(confidence) };
}

/** What still stops an assessment from being reportable, in words. */
export function gaps(theme) {
  const a = assessmentOf(theme), out = [];
  for (const x of COMPONENTS) if (!a.components[x.id].concern) out.push(`${x.label} not judged`);
  if (a.complete && !a.confidence) out.push('Overall confidence not judged');
  if (a.confidence && a.confidence !== START && !a.explanation.trim()) out.push('Explanation needed');
  return out;
}

export function setComponent(s, themeId, componentId, patch) {
  const t = qesOf(s).analytical.find(x => x.id === themeId);
  if (!t || !COMPONENTS.some(x => x.id === componentId)) return;
  const c = t.cerqual ||= {}; c.components ||= {};
  c.components[componentId] = { ...(c.components[componentId] || {}), ...patch };
}

export function setConfidence(s, themeId, patch) {
  const t = qesOf(s).analytical.find(x => x.id === themeId); if (!t) return;
  if (patch.confidence != null && patch.confidence !== '' && !CONFIDENCE.includes(patch.confidence)) return;
  t.cerqual = { ...(t.cerqual || {}), ...patch };
}

const lower = t => t.charAt(0).toLowerCase() + t.slice(1);
/** The components with a concern recorded, as "Coherence: minor concerns (why)". */
function componentLine(a) {
  return COMPONENTS.filter(x => a.components[x.id].concern).map(x => {
    const { concern, explanation } = a.components[x.id];
    return `${x.label}: ${lower(concern)}${explanation.trim() ? ` (${explanation.trim()})` : ''}`;
  }).join('; ');
}

/**
 * The Summary of Qualitative Findings: one row per analytical theme, with the
 * studies contributing to it filled from its codes.
 */
export function summaryOfQualitativeFindings(s) {
  const q = readQes(s);
  const rows = q.analytical.map(t => {
    const a = assessmentOf(t), studies = sourcesOf(s, 'analytical', t.id).map(id => labelOf(s, id));
    return { id: t.id, theme: t.label, finding: (t.statement || '').trim() || t.label, studies,
      confidence: a.assessed ? `${a.confidence} confidence` : 'Not assessed',
      explanation: [a.explanation.trim(), componentLine(a)].filter(Boolean).join('. '),
      components: a.components, gaps: gaps(t) };
  });
  return { title: s.protocol?.title || s.paper?.title || 'Summary of qualitative findings',
    columns: ['Summary of review finding', 'Studies contributing', 'CERQual assessment of confidence', 'Explanation of CERQual assessment'], rows };
}

const cells = r => [r.finding, r.studies.join('; '), r.confidence, r.explanation];

export function soqfCsvRows(t) {
  return [['theme', ...t.columns, ...COMPONENTS.flatMap(x => [`${x.label} concerns`, `${x.label} explanation`])],
    ...t.rows.map(r => [r.theme, ...cells(r), ...COMPONENTS.flatMap(x => [r.components[x.id].concern, r.components[x.id].explanation])])];
}

export function soqfMarkdown(t) {
  const out = [`# Summary of qualitative findings — ${t.title}`, '', `| # | ${t.columns.join(' | ')} |`, `| --- | ${t.columns.map(() => '---').join(' | ')} |`];
  t.rows.forEach((r, i) => out.push(`| ${i + 1} | ${cells(r).map(v => String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ')).join(' | ')} |`));
  out.push('', 'Confidence assessed with GRADE-CERQual.');
  return out.join('\n');
}

/** Blocks for the Word writer (lib/docx-write.mjs): a title, one table, a source line. */
export function soqfBlocks(t) {
  let n = 0; const id = () => `q${++n}`;
  return [{ id: id(), type: 'title', text: `Summary of qualitative findings: ${t.title}` },
    { id: id(), type: 'table', header: true, rows: [['#', ...t.columns], ...t.rows.map((r, i) => [String(i + 1), ...cells(r).map(String)])] },
    { id: id(), type: 'p', text: 'Confidence assessed with GRADE-CERQual.' }];
}

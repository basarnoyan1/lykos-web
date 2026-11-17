// Which studies a risk-of-bias figure draws (plan §2, "Appraisal figures: the studies a figure draws"): every study its instrument has
// appraised, the studies that contribute to an outcome's syntheses (a printed ROBINS-I figure of the "Any failure" comparisons: 7 of 12),
// or a set the person chose. Saved with the figure, by instrument: s.robFigures[toolId] = { scope: 'outcome' | 'chosen', outcome, label,
// studies }. The study ids are kept, so every page that draws the figure (Appraisal, Tables and figures, Submission, the printed check)
// draws the same studies without running the syntheses; Appraisal resolves an outcome's studies again when the person chooses it.
// A package item may carry its own (`it.robScope`, the same shape): the printed figure it stands for draws those studies whatever Appraisal's
// charts draw (Figure S2, the 7 ROBINS-I studies of "Any failure"); lib/folder-sync.mjs finds it from the print's shares when it has none.

const valid = c => (c && (c.scope === 'outcome' || c.scope === 'chosen') && Array.isArray(c.studies) ? c : null);
/** The saved choice for an instrument's figures, or null (every appraised study); a package item's own (`item`) first. */
export const robScope = (s, toolId, item = null) => valid(item?.robScope) || valid(s?.robFigures?.[toolId]);

/** The complete assessments a figure draws: `done` ([{ study, … }]) kept to the chosen studies, in their own order. */
export function inRobScope(s, toolId, done, item = null) {
  const c = robScope(s, toolId, item);
  if (!c) return done;
  const keep = new Set(c.studies);
  return done.filter(r => keep.has(r.study));
}

/** The words for the source line: "7 studies contributing to Any failure", "5 chosen studies"; '' for every study. */
export function robScopeWords(s, toolId, n, item = null) {
  const c = robScope(s, toolId, item);
  if (!c) return '';
  const studies = `${n} ${n === 1 ? 'study' : 'studies'}`;
  return c.scope === 'outcome' ? `${studies} contributing to ${c.label || 'the outcome'}` : `${n} chosen ${n === 1 ? 'study' : 'studies'}`;
}

/**
 * The studies that contribute to an outcome's syntheses: every study with a row in a comparative synthesis of the outcome (lib/synth-project.mjs
 * synthesisModel's records), else in any of its syntheses. `model` is that model.
 */
export function outcomeStudies(model, outcomeId) {
  const recs = (model?.records || []).filter(r => r.outcomeId === outcomeId);
  const rowsOf = list => new Set(list.flatMap(r => (r.rows || []).map(x => x.sid)).filter(Boolean));
  const comparative = rowsOf(recs.filter(r => r.family !== 'Proportions'));
  return comparative.size ? comparative : rowsOf(recs);
}

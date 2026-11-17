// The Library's sets: the records a review sorts by its own decisions, in the words the Overview uses (plan §2, "A study in Details" and
// the Library). A study is one row per trial; a linked report is a further report of an included study; Uncertain is what full text
// left undecided (the Overview's "uncertain at full text"). Pure over the state; the Library draws the menu and keeps the choice.
import { lib_review_studies$reviewStudies as reviewStudies } from "../boot.mjs";
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";
import { lib_screen$screeningStarted as screeningStarted, lib_screen$isIncluded as isIncluded, lib_screen$finalDecision as finalDecision } from "../boot.mjs";
import { lib_workflow$projectMode as projectMode } from "../boot.mjs";

const workspace = s => projectMode(s) === 'workspace';

/** id → { name, papers(s) }, in the menu's order. */
export const SETS = {
  'auto:studies': { name: 'Included studies',
    papers: s => !screeningStarted(s) ? [] : workspace(s) ? (s.papers || []).filter(p => isIncluded(s, p.id)) : reviewStudies(s).studies },
  'auto:reports': { name: 'Linked reports',
    papers: s => screeningStarted(s) && !workspace(s) ? reviewStudies(s).reports : [] },
  'auto:uncertain': { name: s => reviewStudies(s).ftStage ? 'Uncertain at full text' : 'Uncertain',
    papers: s => !screeningStarted(s) ? [] : reviewStudies(s).ftStage ? reviewStudies(s).ftUncertain
      : (s.papers || []).filter(p => finalDecision(s, p.id)?.decision === 'uncertain') },
  'auto:excluded': { name: 'Excluded',
    papers: s => (s.papers || []).filter(p => finalDecision(s, p.id)?.decision === 'exclude') },
};
/** The set a saved view or a link named before the studies were told from their reports. */
export const SET_ALIAS = { 'auto:included': 'auto:studies' };

export const setId = id => (SETS[id] ? id : SET_ALIAS[id] || null);
export const setName = (s, id) => { const n = SETS[setId(id)]?.name; return typeof n === 'function' ? n(s) : n || ''; };
export const setPapers = (s, id) => SETS[setId(id)]?.papers(s) || [];

/** The sets that hold anything: [{ id, name, papers }]. */
export const librarySets = s => Object.keys(SETS).map(id => ({ id, name: setName(s, id), papers: setPapers(s, id) })).filter(x => x.papers.length);

/**
 * The set the Library opens on when the person has not chosen one: the included studies once title and abstract screening has nothing left
 * to decide, else null (all records).
 */
export function defaultSetId(s) {
  if (!screeningStarted(s) || workspace(s) || reviewCounts(s).ta.toDecide) return null;
  return reviewStudies(s).studies.length ? 'auto:studies' : null;
}

/** The first set that holds a record, in the menu's order: where the list should go to show it. null: only All records does. */
export function setHolding(s, paperId) {
  for (const id of Object.keys(SETS)) if (setPapers(s, id).some(p => p.id === paperId)) return id;
  return null;
}

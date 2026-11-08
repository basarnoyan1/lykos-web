// A protocol scenario's PRISMA flow (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Goal 4; Ruling 4, 2 Nov 2026).
// A scenario branches off the main protocol's flow at the first step its choice can change: a search added or left out changes what
// was identified, so the whole flow is the scenario's; a criterion removed, reworded or added at title and abstract changes what is
// screened out (and, since a removed or reworded criterion re-asks uncited exclusions, any of those does); a criterion added at full text
// only changes the full-text assessment. Before that step the flow is main's as main reports it (its counts entered by hand among them);
// from it on every count is derived from the scenario's view, so the flow is one base, never a mix per count. Where the scenario's
// identification is its own, the duplicates removed are what balances it: identified less the records the scenario holds from databases
// and registers (lib/prisma-counts.mjs identification), as PRISMA reads them.
import { schema$PRISMA_FIELDS as PRISMA_FIELDS } from "../boot.mjs";
import { prismaData, derive, identification, flowArms } from './prisma-counts.mjs';
import { scoped, MAIN } from './reviews.mjs';
import { scenarioView } from './scenarios.mjs';
import { scenarioOf, keptRuns, MAIN_PROTOCOL } from './scenario-runs.mjs';
import { lib_review_counts$reviewCounts as reviewCounts } from "../boot.mjs";
import { lib_rules_key$criterionStage as criterionStage } from "../boot.mjs";

const ALL = PRISMA_FIELDS.map(f => f.id);
// a previous version's counts are the earlier review's: no scenario of this one changes them
const PREVIOUS = new Set(['previous_studies', 'previous_reports', 'total_studies', 'total_reports']);
const AFTER = {
  identification: ALL.filter(k => !PREVIOUS.has(k)),
  screening: ['records_screened', 'records_excluded', 'dbr_sought_reports', 'dbr_notretrieved_reports', 'dbr_assessed', 'dbr_excluded',
    'other_sought_reports', 'other_notretrieved_reports', 'other_assessed', 'other_excluded', 'new_studies', 'new_reports'],
  eligibility: ['dbr_assessed', 'dbr_excluded', 'other_assessed', 'other_excluded', 'new_studies', 'new_reports'],
};
const LABEL = { identification: 'identification', screening: 'records screened', eligibility: 'reports assessed' };

/**
 * Where a scenario's flow leaves main's: { step: 'identification' | 'screening' | 'eligibility' | null, label, keys: the counts from it on }.
 * null (an empty scenario) is main's flow throughout.
 */
export function scenarioBranch(s, id) {
  const sc = scenarioOf(s, id);
  if (!sc) return { step: null, label: '', keys: [] };
  // the runs it keeps against main's (a scenario of another review: whether it adds or leaves out any)
  const differs = () => { const kept = keptRuns(s, sc.id), base = keptRuns(s, MAIN_PROTOCOL); return kept.size !== base.size || [...kept].some(r => !base.has(r)); };
  const searches = sc.searches.add.length > 0 || (sc.review === MAIN ? differs() : sc.searches.remove.length > 0);
  const mainIds = new Set((s.protocol?.criteria || []).map(c => String(c.id)));
  const touched = [...sc.criteria.remove, ...Object.keys(sc.criteria.change)].some(c => mainIds.has(String(c)));
  // its own decisions change the flow too (final review I2): one at title and abstract from records screened on, one at full text from reports assessed
  const lane = s.scenarioScreening?.[sc.id] || {}, own = st => Object.keys(lane[st] || {}).length > 0;
  const step = searches ? 'identification' : touched || sc.criteria.add.some(c => criterionStage(c) === 'ta') || own('ta') ? 'screening'
    : sc.criteria.add.length || own('ft') ? 'eligibility' : null;
  return { step, label: step ? LABEL[step] : '', keys: step ? AFTER[step] : [] };
}

/**
 * The project the scenario's flow counts: its view, with `prisma` holding main's counts (as main shows them, by hand or derived) for the
 * steps before its branch point and nothing from it on, so prismaData gives main's then the scenario's derived counts; `branch` says where.
 */
export function scenarioPrisma(s, id) {
  const sc = scenarioOf(s, id), view = scenarioView(s, id), branch = scenarioBranch(s, id);
  return { ...view, prisma: countsOn(s, sc.review, view, branch), prismaNotes: {}, branch };
}

/** The counts a flow takes by hand: main's, as main reports them, before the branch point; and the duplicates that balance an identification of its own. */
function countsOn(s, review, view, branch) {
  const main = prismaData(scoped(s, review)), after = new Set(branch.keys), prisma = {};
  for (const k of ALL) if (!after.has(k) && main[k] !== undefined && main[k] !== '') prisma[k] = main[k];
  if (branch.step === 'identification') {
    const id0 = identification(view), identified = id0.rows.reduce((a, r) => a + r.count, 0);
    if (id0.rows.length && identified >= id0.unique) prisma.duplicates = identified - id0.unique;
  }
  return prisma;
}

/**
 * Main's flow on a scenario's basis (final review I3): main's reported counts before the scenario's branch point and, from it on, main's counts
 * derived as the scenario's are, so a difference from the branch on sets like against like, never a derived count against one entered by hand.
 * The PRISMA counts, as prismaData gives them.
 */
export function mainOnBasis(s, id) {
  const sc = scenarioOf(s, id), branch = scenarioBranch(s, id), main = scoped(s, sc ? sc.review : MAIN);
  if (!branch.step) return prismaData(main);
  return { ...derive(main), ...countsOn(s, sc.review, main, branch) };
}

const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const listSum = v => String(v || '').split(';').reduce((a, part) => a + num(part.split(',').pop()), 0);

/**
 * The flow's arithmetic, as the diagram reads it: [{ step, left, right }] for each equation that does not hold. `pending` is what is still
 * to decide ({ ta, ft }: pendingOf), which a step has not yet counted.
 * identified − duplicates − automation − other = screened + to decide at title and abstract; screened − excluded = sought;
 * sought − not retrieved = assessed + to decide at full text; assessed − excluded (both columns) = included reports.
 */
export function flowBalance(d, pending = { ta: 0, ft: 0 }) {
  const out = [], eq = (step, left, right) => { if (left !== right) out.push({ step, left, right }); };
  eq('identification', num(d.database_results) + num(d.register_results) - num(d.duplicates) - num(d.excluded_automatic) - num(d.excluded_other), num(d.records_screened) + pending.ta);
  eq('screening', num(d.records_screened) - num(d.records_excluded), num(d.dbr_sought_reports));
  eq('retrieval', num(d.dbr_sought_reports) - num(d.dbr_notretrieved_reports), num(d.dbr_assessed) + pending.ft);
  eq('included', num(d.dbr_assessed) - listSum(d.dbr_excluded) + num(d.other_assessed) - listSum(d.other_excluded), num(d.new_reports) || num(d.new_studies));
  return out;
}

/** What a view still has to decide in the databases' and registers' column (the one flowBalance checks): { ta, ft }. */
export function pendingOf(view) {
  const c = reviewCounts(view), { methodOf } = flowArms(view), byId = new Map((view.papers || []).map(p => [p.id, p]));
  const inDb = ids => ids.filter(id => byId.has(id) && methodOf(byId.get(id)).method === 'database');
  // at full text: a report sought and neither included nor excluded there (to decide, uncertain or awaiting), none recorded as not retrieved
  const open = id => !['include', 'exclude'].includes(view.fulltext?.[id]?.decision) && byId.get(id)?.pdfRetrieval?.status !== 'not-retrieved';
  return { ta: inDb(c.ta.ids.toDecide).length, ft: inDb(c.ft.ids.records).filter(open).length };
}


// GRADE certainty of evidence, per outcome.
//
// The reviewer rates each domain; the certainty level then follows from GRADE's
// own arithmetic, which is deterministic and part of the instrument (this is
// what GRADEpro does). The app does not rate any domain on the reviewer's
// behalf — the rule in plan 1.3 is against inventing judgements, not against
// applying the instrument to judgements that were made.
//
// An explicit override is allowed, because GRADE guidance itself permits
// departing from the arithmetic; it requires a reason, which is stored with it.

export const LEVELS = ['Very low', 'Low', 'Moderate', 'High'];

// Starting certainty is set by study design, not chosen freely.
export const DESIGNS = [
  { id: 'rct',           label: 'Randomised trials',  start: 'High' },
  { id: 'observational', label: 'Observational',      start: 'Low'  },
];

export const DOWNGRADE = [
  { id: 'rob',          label: 'Risk of bias' },
  { id: 'inconsistency', label: 'Inconsistency' },
  { id: 'indirectness', label: 'Indirectness' },
  { id: 'imprecision',  label: 'Imprecision' },
  { id: 'publication',  label: 'Publication bias' },
];

export const DOWNGRADE_RATINGS = [
  { value: 'none',     label: 'Not serious',  steps: 0 },
  { value: 'serious',  label: 'Serious',      steps: -1 },
  { value: 'veryserious', label: 'Very serious', steps: -2 },
];

// Only ever applied to observational evidence, per GRADE.
export const UPGRADE = [
  { id: 'large',     label: 'Large effect' },
  { id: 'dose',      label: 'Dose–response' },
  { id: 'confounding', label: 'Residual confounding' },
];

export const UPGRADE_RATINGS = [
  { value: 'none',  label: 'No',       steps: 0 },
  { value: 'one',   label: '+1',       steps: 1 },
  { value: 'two',   label: '+2',       steps: 2 },
];

const stepsOf = (ratings, id, table) =>
  table.find(r => r.value === ratings?.[id])?.steps ?? 0;

/** What an outcome no one has rated shows wherever a level would be: the list, the Summary of findings, the profile, the exports, the Overview. */
export const NOT_RATED = 'Not rated';
/**
 * Whether a person has rated the outcome: judged a domain or set the level. An empty row (one made when the outcome was named) has no
 * certainty yet; GRADE's starting level for its design is not a rating anybody made.
 */
export const isRated = outcome => Boolean(outcome?.override) || Object.values(outcome?.ratings || {}).some(Boolean);

/**
 * The certainty an outcome's ratings imply, and the steps that produced it.
 * `final` is NOT_RATED until a person rates the outcome (isRated); `level` is what the ratings give, for the choice that keeps it.
 * Upgrades count only when nothing has been downgraded, which is GRADE's rule:
 * evidence already rated down for bias is not rated back up for effect size.
 */
export function certainty(outcome) {
  const design = DESIGNS.find(d => d.id === outcome.design) || DESIGNS[1];
  const start = LEVELS.indexOf(design.start);

  const down = DOWNGRADE.reduce((a, d) => a + stepsOf(outcome.ratings, d.id, DOWNGRADE_RATINGS), 0);
  const canUpgrade = design.id === 'observational' && down === 0;
  const up = canUpgrade
    ? UPGRADE.reduce((a, d) => a + stepsOf(outcome.ratings, d.id, UPGRADE_RATINGS), 0)
    : 0;

  const index = Math.max(0, Math.min(LEVELS.length - 1, start + down + up));
  const rated = isRated(outcome);
  return {
    rated,
    level: LEVELS[index],
    start: design.start,
    down, up, canUpgrade,
    overridden: Boolean(outcome.override),
    final: rated ? outcome.override || LEVELS[index] : NOT_RATED,
  };
}

/** The domains a reader needs told about: everything rated below "not serious". */
/** The domains an outcome was rated down on: { id, label, reason } each. */
export function downgrades(outcome) {
  return DOWNGRADE
    .filter(d => stepsOf(outcome.ratings, d.id, DOWNGRADE_RATINGS) < 0)
    .map(d => {
      const r = DOWNGRADE_RATINGS.find(x => x.value === outcome.ratings[d.id]);
      return { id: d.id, label: d.label, reason: `${d.label.toLowerCase()} (${r.label.toLowerCase()})` };
    });
}
export const reasons = outcome => downgrades(outcome).map(d => d.reason);
/**
 * A domain's footnote text. A person's footnote is a string; one a model
 * drafted is { text, extractor: 'model:…', verification } until a person
 * edits or checks it, so it is counted as unverified like any model output.
 */
export const explanationText = x => typeof x === 'string' ? x : String(x?.text || '');

export const blankOutcome = (name = '') => ({
  id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  name, design: 'observational', ratings: {}, studies: '', participants: '',
  effect: '', absolute: '', comment: '', override: '', overrideReason: '',
  analysisOutcome: '',   // the pooled outcome this row reports: its id, 'none', or '' to match by name
});

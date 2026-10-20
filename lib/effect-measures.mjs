// Effect measures a pooled analysis can estimate, and the extracted inputs
// each needs. Binary outcomes pool 2×2 counts; continuous outcomes pool
// arm means, SDs and sizes. metafor's escalc computes the effect sizes: "SMD"
// there is Hedges' g, bias-corrected (Viechtbauer 2010, metafor manual).
export const MEASURES = [
  { id: 'RR',  label: 'Risk ratio',                  family: 'binary',     ratio: true },
  { id: 'OR',  label: 'Odds ratio',                  family: 'binary',     ratio: true },
  { id: 'RD',  label: 'Risk difference',             family: 'binary',     ratio: false },
  { id: 'MD',  label: 'Mean difference',             family: 'continuous', ratio: false },
  { id: 'SMD', label: "Standardised mean difference (Hedges' g)", family: 'continuous', ratio: false },
  // Reported as a ratio with its 95% CI; pooled on the log scale by generic
  // inverse variance: yi = log(HR), SE = (log upper − log lower) / (2 · 1.96).
  { id: 'HR',  label: 'Hazard ratio',                family: 'generic',    ratio: true, escalc: 'GEN' },
  // Estimates from a fitted model, rather than reconstructed arm counts.
  ...[
    ['OR-report', 'Odds ratio', true, 'OR'], ['RR-report', 'Risk ratio', true, 'RR'],
    ['HR-report', 'Hazard ratio', true, 'HR'], ['MD-report', 'Mean difference', false, 'MD'],
    ['SMD-report', 'Standardised mean difference', false, 'SMD'],
    ['BETA', 'Regression coefficient', false, 'coefficient'],
  ].map(([id, label, ratio, short]) => ({ id, label: `${label} · reported estimate`, family: 'reported', ratio, short, escalc: 'GEN' })),
  { id: 'IRR', label: 'Incidence rate ratio',        family: 'rate',       ratio: true },
  // Single-group and association measures: pooled on a transformed scale
  // (logit proportion, Fisher's z) and shown back on the natural one.
  { id: 'PR',  label: 'Proportion (single group)',   family: 'proportion', ratio: false, escalc: 'PLO', back: 'transf.ilogit' },
  // Freeman–Tukey double arcsine: offered with its warning (lib/heterogeneity.mjs FT_WARNING). The back-transformation
  // ipft_hm is defined by the model's R (lib/pooled-model.mjs) with the harmonic mean of the rows' sample sizes.
  { id: 'PFT', label: 'Proportion (single group, Freeman–Tukey)', family: 'proportion', ratio: false, escalc: 'PFT', back: 'ipft_hm', warning: 'freeman-tukey' },
  { id: 'MN',  label: 'Mean (single group)',         family: 'single-mean', ratio: false },
  { id: 'COR', label: 'Correlation (r)',             family: 'correlation', ratio: false, escalc: 'ZCOR', back: 'transf.ztor' },
];

// Extraction field ids per family, in escalc's argument order.
export const INPUTS = {
  binary:     [['events_t', 'ai'], ['n_t', 'n1i'], ['events_c', 'ci'], ['n_c', 'n2i']],
  continuous: [['mean_t', 'm1i'], ['sd_t', 'sd1i'], ['n_t', 'n1i'], ['mean_c', 'm2i'], ['sd_c', 'sd2i'], ['n_c', 'n2i']],
  generic:    [['hr', 'est'], ['hr_lo', 'lo'], ['hr_hi', 'hi']],
  reported:   [['effect_estimate', 'yi'], ['effect_se', 'sei']],
  rate:       [['events_t', 'x1i'], ['time_t', 't1i'], ['events_c', 'x2i'], ['time_c', 't2i']],
  proportion: [['events', 'xi'], ['n', 'ni']],
  'single-mean': [['mean', 'mi'], ['sd', 'sdi'], ['n', 'ni']],
  correlation: [['r', 'ri'], ['n', 'ni']],
};

export const measureOf = id => MEASURES.find(m => m.id === id) || MEASURES[0];
export const inputFields = id => INPUTS[measureOf(id).family].map(([f]) => f);
export const REPORTED_FIELDS = ['effect_estimate', 'effect_se', 'effect_lo', 'effect_hi', 'effect_confidence', 'effect_df',
  'effect_uncertainty', 'effect_population', 'effect_contrast', 'effect_adjustment_type', 'effect_adjustment', 'effect_source'];
/** Extraction retains the original uncertainty and the identity of a reported model. */
export const extractionFields = id => measureOf(id).family === 'reported' ? REPORTED_FIELDS : inputFields(id);
export const effectName = id => measureOf(id).short || measureOf(id).id;
/** Ratios are pooled on the log scale and shown back-transformed; differences are not. */
export const isRatio = id => measureOf(id).ratio;
/** The value meaning "no difference between arms"; a single-group proportion or mean has none. */
export const noEffect = id => (isRatio(id) ? 1 : ['proportion', 'single-mean'].includes(measureOf(id).family) ? null : 0);
/** The R function taking a pooled value back to the scale it is reported on: exp for ratios, and the measure's own otherwise. */
export const backTransform = id => (isRatio(id) ? 'exp' : measureOf(id).back || null);
/** escalc's name for the measure. */
export const escalcName = id => measureOf(id).escalc || measureOf(id).id;

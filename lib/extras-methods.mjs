// The "Methods used" rows contributed by the sensitivity analyses run on a saved result (a.extras). Each analysis states
// what it did and that it left the pooled estimate alone; a result that has not run one contributes nothing.
const REPORT = 'A sensitivity analysis: the pooled estimate is unchanged';

/** [label, text] rows for the analyses present in `a.extras`. */
export function extrasMethods(a = {}) {
  const x = a.extras || {}, rows = [];
  if (x.bias) rows.push(['Small-study effects', `Egger, Begg, Harbord, Peters and Rücker tests, PET and PEESE, selection models (REML), Mathur–VanderWeele and limit meta-analysis, k = ${x.bias.k}. ${REPORT}.`]);
  if (x.fragility) {
    const f = x.fragility;
    rows.push(['Fragility index', `Exploratory. Walsh et al. 2014 for each trial (Fisher's exact test, either arm, either direction, at α = ${f.alpha ?? 0.05}); Atal et al. 2019 for the pooled result (greedy, one event status changed at a time, the result's own estimator and interval test${f.limit ? `, at most ${f.limit} changes` : ''}). The fragility quotient is the index over all participants. ${REPORT}.`]);
  }
  if (x.lfk) rows.push(['LFK index and Doi plot', `Exploratory (Furuya-Kanamori et al. 2018). Not a test: Schwarzer, Rücker and Semaca 2024 found its false positive rate depends on the number and size of studies and on heterogeneity. ${REPORT}.`]);
  if (x.gosh) rows.push(['GOSH', `${x.gosh.exhaustive ? 'All subsets' : `A seeded sample of ${x.gosh.requested}`} of the studies refitted with ${x.gosh.method}. ${REPORT}.`]);
  if (x.dependence) rows.push(['Dependent effects', `Cluster: ${x.dependence.clusterField}; assumed correlation ${x.dependence.rho}. ${REPORT}.`]);
  if (x.missing) rows.push(['Missing outcome data', `Informative missingness odds ratios (Higgins, White and Wood 2008) and the uncertainty interval of Gamble and Hollis 2005; pooled by ${x.missing.settings?.method}. ${REPORT}.`]);
  return rows;
}

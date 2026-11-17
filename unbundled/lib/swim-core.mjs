// The pure part of lib/swim.mjs: the directions, the combining rule, the sign test, the effect-direction rows, the risk-of-bias level and the nine reporting
// items. lib/swim-state.mjs (read by the store on every load) imports these; the harvest plot drawing stays in lib/swim.mjs and loads with the page that draws it.

export const DIRECTIONS = ['benefit', 'harm', 'no clear', 'mixed'];
const MARK = { benefit: '▲', harm: '▼', 'no clear': '◄►', mixed: '◄►' };

/**
 * Several results in one study and outcome domain combine by the rule of
 * Thomson & Thomas: 70% or more in one direction gives that direction;
 * otherwise the domain is mixed. Results with no clear direction count in the
 * denominator; only when every result is "no clear" is the domain "no clear".
 */
export function combineDirections(list) {
  const d = list.filter(x => DIRECTIONS.includes(x));
  if (!d.length) return '';
  if (d.length === 1) return d[0];
  if (d.every(x => x === 'no clear')) return 'no clear';
  for (const x of ['benefit', 'harm']) if (d.filter(y => y === x).length / d.length >= 0.7) return x;
  return 'mixed';
}

const lchoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };

/**
 * Exact two-sided sign test: `benefit` of `n` studies with a clear direction,
 * against 0.5. p = min(1, 2 · P(X ≤ min(benefit, harm))).
 */
export function signTest(benefit, harm) {
  const n = benefit + harm;
  if (!n) return { n: 0, benefit, harm, p: null };
  const m = Math.min(benefit, harm);
  let tail = 0;
  for (let k = 0; k <= m; k++) tail += Math.exp(lchoose(n, k) - n * Math.LN2);
  return { n, benefit, harm, p: Math.min(1, 2 * tail) };
}

/**
 * The effect direction table: one row per study, a direction per outcome
 * domain, with per-outcome vote counts and a sign test on benefit against harm
 * (studies with no clear or mixed direction are left out of the test, as in
 * the effect direction plot).
 * rows: [{ study, outcome, direction, n?, rob? }]
 */
export function effectDirection(rows = []) {
  const studies = [], outcomes = [];
  const cells = new Map(), meta = new Map();
  for (const r of rows) {
    const study = String(r?.study ?? '').trim(), outcome = String(r?.outcome ?? '').trim();
    if (!study || !outcome || !DIRECTIONS.includes(r.direction)) continue;
    if (!studies.includes(study)) studies.push(study);
    if (!outcomes.includes(outcome)) outcomes.push(outcome);
    const key = `${study}\u0000${outcome}`;
    (cells.get(key) || cells.set(key, []).get(key)).push(r.direction);
    const m = meta.get(study) || meta.set(study, {}).get(study);
    if (m.n == null && Number.isFinite(Number(r.n)) && r.n !== '' && r.n != null) m.n = Number(r.n);
    if (m.rob == null && r.rob) m.rob = String(r.rob);
  }
  const table = studies.map(study => ({
    study, n: meta.get(study).n ?? null, rob: meta.get(study).rob ?? '',
    directions: Object.fromEntries(outcomes.map(o => [o, combineDirections(cells.get(`${study}\u0000${o}`) || [])])),
    results: Object.fromEntries(outcomes.map(o => [o, (cells.get(`${study}\u0000${o}`) || []).length])),
  }));
  const byOutcome = outcomes.map(outcome => {
    const v = { benefit: 0, harm: 0, 'no clear': 0, mixed: 0 };
    for (const t of table) if (t.directions[outcome]) v[t.directions[outcome]]++;
    const k = v.benefit + v.harm + v['no clear'] + v.mixed;
    return { outcome, k, votes: v, signTest: signTest(v.benefit, v.harm),
      text: `${v.benefit} of ${k} studies favour the intervention, ${v.harm} favour the comparator, ${v['no clear'] + v.mixed} show no clear or mixed direction` };
  });
  const votes = { benefit: 0, harm: 0, 'no clear': 0, mixed: 0 };
  for (const o of byOutcome) for (const k of DIRECTIONS) votes[k] += o.votes[k];
  return { studies, outcomes, table, byOutcome, votes, marks: MARK };
}


/** Risk-of-bias level of a judgement in any shipped instrument's vocabulary: 'low' | 'some' | 'high' | ''. */
export function robLevel(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return '';
  if (/^(low|good)$/.test(t)) return 'low';
  if (/^(high|very high|serious|critical|poor)$/.test(t)) return 'high';
  if (/^(some concerns|moderate|unclear|fair|can't tell)$/.test(t)) return 'some';
  return '';
}

// ---- reporting items ----------------------------------------------------------------------------
// The nine SWiM items: names as published, descriptions our own paraphrase (plan H6).
export const SWIM_ITEMS = [
  { id: '1', section: 'Methods', name: 'Grouping studies for synthesis', text: 'Say how studies were grouped for synthesis and why, and justify any change to the planned grouping.' },
  { id: '2', section: 'Methods', name: 'Describe the standardised metric and transformation methods used', text: 'Name the common metric used to compare results across studies and how reported results were converted to it.' },
  { id: '3', section: 'Methods', name: 'Describe the synthesis methods', text: 'State the method used to combine results and why it suits the data available.' },
  { id: '4', section: 'Methods', name: 'Criteria used to prioritise results for summary and synthesis', text: 'Explain any rule for giving some studies or results more weight or prominence, such as design or risk of bias.' },
  { id: '5', section: 'Methods', name: 'Investigation of heterogeneity in reported effects', text: 'Describe how differences in effects between studies were explored, and note that such analyses were planned or not.' },
  { id: '6', section: 'Methods', name: 'Certainty of evidence', text: 'Describe how the certainty of each synthesised finding was judged.' },
  { id: '7', section: 'Methods', name: 'Data presentation methods', text: 'Describe the tables and figures used to show the data and the results of the synthesis.' },
  { id: '8', section: 'Results', name: 'Reporting results', text: 'Give the synthesis findings for each grouping, with the studies contributing to each, linked to the tables and figures.' },
  { id: '9', section: 'Discussion', name: 'Limitations of the synthesis', text: 'Discuss what the chosen synthesis method and the data available limit in the conclusions.' },
];

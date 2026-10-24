// A GRADE row reports one pooled outcome. The row links to it by choice, or
// by having the same name; the numbers the Summary of findings needs from the
// analysis (studies, participants, relative effect) are filled from its saved
// result, and the row remembers which result it was filled from.
import { analysisOf } from './outcomes.mjs';
import { studyInputs } from './analysis-inputs.mjs';
import { measureOf, effectName } from './effect-measures.mjs';
import { blankOutcome } from './grade.mjs';
import { linkedOutcome, toRate } from './grade-rated.mjs';
// which outcome a row reports and which analysed outcomes no row reports (pooledSummary is null exactly when there is no result)
export { linkedOutcome, toRate };

const sig = x => String(Number(Number(x).toPrecision(3))).replace(/^-/, '−');
// Where the arm sizes sit among a measure's inputs; a reported ratio has none.
const ARM_SIZES = { binary: [1, 3], continuous: [2, 5], generic: [], reported: [], rate: [], proportion: [1], 'single-mean': [2], correlation: [1] };

/** What the linked result supplies to the row; null when the outcome has no result yet. */
export function pooledSummary(s, outcome) {
  const a = outcome && analysisOf(s, outcome.id);
  if (!a) return null;
  const family = measureOf(a.measure).family, labels = new Set(a.labels || []);
  const pooledPapers = (s.papers || []).filter(p => labels.has(p.label));
  const sizes = ARM_SIZES[family].length ? pooledPapers.map(p => studyInputs(s, p.id, a.measure, outcome.id))
    .map(v => ARM_SIZES[family].reduce((n, i) => n + (Number(v[i]) || 0), 0)) : [];
  // a result read per arm from a table's text keeps its denominators (lib/pooled-r.mjs)
  const armN = Array.isArray(a.ni) ? a.ni.map(Number) : null;
  // a pairwise result counts its rows' arms itself, a split control once (lib/multi-arm.mjs)
  const participants = Number.isFinite(Number(a.participants)) && a.participants != null ? String(Math.round(Number(a.participants))) : armN ? (armN.every(n => n > 0) ? String(armN.reduce((x, y) => x + y, 0)) : '')
    : sizes.length && sizes.every(n => n > 0) ? String(sizes.reduce((x, y) => x + y, 0)) : '';
  const est = a.estimate ?? a.est;
  // a single-group proportion is read as a percentage, not as "PR 0.0963"
  const pc = x => `${(Number(x) * 100).toFixed(1)}%`;
  return {
    studies: String(a.studies ?? a.k ?? ''),
    participants,
    effect: family === 'proportion' ? `Proportion ${pc(est)} (${pc(a.lo)} to ${pc(a.hi)})` : `${effectName(a.measure)} ${sig(est)} (${sig(a.lo)} to ${sig(a.hi)})`,
    measure: effectName(a.measure), estimate: Number(est), lo: Number(a.lo), hi: Number(a.hi),
    family,
    identity: JSON.stringify([outcome.id, a.at, a.measure, a.k, est, a.lo, a.hi]),
  };
}

/** The row's labels for the absolute columns: risks for binary outcomes and ratios, means for continuous ones. */
export const absoluteLabels = family => (family === 'continuous'
  ? ['Mean with comparator', 'Difference with intervention']
  : ['Risk with comparator', 'Risk with intervention']);

// ---- anticipated absolute effects (plan H5) -----------------------------------
// GRADE's Summary of findings states, for a comparator risk the reviewer
// assumes, the risk with the intervention implied by the pooled relative
// effect and its interval, per 1,000 (GRADE Handbook 5.2; the formulas are
// GRADEpro's): risk ratio r = RR · CR; odds ratio r = OR · CR / (1 − CR + OR · CR);
// hazard ratio r = 1 − (1 − CR)^HR; risk difference r = CR + RD. The assumed
// risk is the reviewer's, never computed here.

/** A comparator risk as typed: "200 per 1000", "20%", "0.2", "20 per 100". Null when unreadable or outside 0–1. */
export function parseRisk(text) {
  const t = String(text ?? '').replace(/[\s,]/g, '').toLowerCase();
  let m, r = null;
  if ((m = /^(\d+(?:\.\d+)?)per(\d+)$/.exec(t))) r = Number(m[1]) / Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)%$/.exec(t))) r = Number(m[1]) / 100;
  else if ((m = /^(0?\.\d+|0|1)$/.exec(t))) r = Number(m[1]);
  return r != null && r >= 0 && r <= 1 && Number.isFinite(r) ? r : null;
}

/** A relative effect as the Summary of findings writes it: "RR 0.70 (0.53 to 0.92)". */
export function parseEffect(text) {
  const m = /\b(RR|OR|HR|RD)\s+(-?[\d.]+)\s*\(\s*(-?[\d.]+)\s*(?:to|,|–|-)\s*(-?[\d.]+)\s*\)/i.exec(String(text ?? '').replace(/\u2212/g, '-'));
  return m ? { measure: m[1].toUpperCase(), estimate: Number(m[2]), lo: Number(m[3]), hi: Number(m[4]) } : null;
}

const riskWith = (measure, x, cr) => measure === 'RR' ? x * cr
  : measure === 'OR' ? x * cr / (1 - cr + x * cr)
  : measure === 'HR' ? 1 - Math.pow(1 - cr, x)
  : measure === 'RD' ? cr + x : NaN;

/** The measures an absolute effect can be derived from. */
export const ABSOLUTE_MEASURES = ['RR', 'OR', 'HR', 'RD'];

/**
 * The risk with the intervention and the difference, per 1,000, for an
 * assumed comparator risk (0–1). Null for a measure without a formula.
 */
export function absoluteEffect({ measure, estimate, lo, hi }, cr) {
  if (!ABSOLUTE_MEASURES.includes(measure) || cr == null || ![estimate, lo, hi].every(Number.isFinite)) return null;
  const clamp = r => Math.min(1, Math.max(0, r));
  const [r, rl, rh] = [estimate, lo, hi].map(x => clamp(riskWith(measure, x, cr)));
  const per = x => Math.round(x * 1000);
  const d = x => per(x - cr);
  const dir = x => (x === 0 ? '0 fewer' : x < 0 ? `${-x} fewer` : `${x} more`);
  const [a, b] = [d(Math.min(rl, rh)), d(Math.max(rl, rh))];
  return {
    risk: r, riskLo: Math.min(rl, rh), riskHi: Math.max(rl, rh),
    intervention: `${per(r)} per 1,000 (${per(Math.min(rl, rh))} to ${per(Math.max(rl, rh))})`,
    difference: `${dir(d(r))} per 1,000 (from ${dir(a)} to ${dir(b)})`,
    comparator: `${per(cr)} per 1,000`,
  };
}

// ---- publication bias, as information for the domain ---------------------------------------------------
// GRADE's publication-bias domain is judged by the reviewer. What the small-study analyses of the linked
// result found is listed beside it as information: nothing here rates the domain or changes a rating.
const pv = p => (Number(p) < 0.001 ? '<0.001' : Number(p).toFixed(3));

/** [label, text] rows from a result's saved small-study analysis (a.extras.bias), or from what stopped it; [] when it holds none. */
export function publicationBiasFacts(a) {
  if (!a) return [];
  const b = a.extras?.bias, k = Number(a.k);
  if (!b) return Number.isFinite(k) && k < 10 ? [['Small-study analyses', `Not run: ${k} studies, 10 needed`]] : [];
  const rows = [];
  const tests = (b.tests || []).filter(t => Number.isFinite(Number(t.p)));
  if (tests.length) rows.push(['Funnel plot asymmetry', tests.map(t => `${t.name.replace(/ \(.*\)/, '')} p = ${pv(t.p)}`).join('; ')]);
  const sel = (b.selection || []).filter(s => s.ok && Number.isFinite(Number(s.est)));
  if (sel.length) { const e = sel.map(s => Number(s.est)), lo = Math.min(...e, Number(a.estimate)), hi = Math.max(...e, Number(a.estimate));
    rows.push(['Selection models', `${sel.length} of 3 fitted; ${a.measure} ${lo.toFixed(2)} to ${hi.toFixed(2)} with the pooled ${Number(a.estimate).toFixed(2)}`]); }
  const v = b.mvw?.common?.sCI;
  if (v) rows.push(['Selection ratio to bring the interval to the null', v.eta == null ? 'Not possible' : Number(v.eta).toFixed(1)]);
  return rows;
}

/** Adds a GRADE row for each outcome toRate gives, filled from its result as a row named after it is. Returns the rows added. */
export function rateAnalysed(st) {
  const added = toRate(st).map(o => {
    const p = pooledSummary(st, o);
    return { ...blankOutcome(o.name), analysisOutcome: o.id, studies: p.studies, participants: p.participants || '', effect: p.effect, filledFrom: p.identity };
  });
  st.grade = [...(st.grade || []), ...added];
  return added;
}

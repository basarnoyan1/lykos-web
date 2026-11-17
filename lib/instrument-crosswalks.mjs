// Instrument crosswalks (plan G3a, G6; W3): how a value on one outcome scale is expressed on a related one (UPDRS-III on MDS-UPDRS-III,
// HAM-D on MADRS). An entry is { id, label, from, to, method, params, range, covariate?, source }: `from` and `to` are instrument codes
// (lib/instruments.mjs), `range` the [lowest, highest] source value the crosswalk holds for (empty: the source scale's own range), `source`
// { citation, doi, pmid, table, checked, needs, note }. Methods (CROSSWALK_METHODS):
//   linear          params { intercept, slope }: y = intercept + slope × x
//   table           params { points: [[x, y], …] }: y read off the table, linear between its rows (an equipercentile table, say)
//   stratified      params { strata: { [stratum]: { intercept, slope } }, overall? }: a linear formula per level of a covariate (the Hoehn
//                   and Yahr group for Goetz 2012), applied with an arm's own mix of those levels
//   percent-change  params { baseline: [[x, y], …], percent: 'equal' | [[p, q], …] }: the baseline read off a table of totals, the
//                   percent change from baseline kept (or read off its own table), the change rebuilt from the two
// Built-in coefficients are entered only from the papers, with the place and date they were checked: an entry whose paper has not been
// read has empty parameters and says it needs the paper (`source.needs`), and converts nothing. A project adds entries, or fills in a
// built-in one's parameters, in s.crosswalks. A conversion is a derivation (plan G6): it never overwrites a reported value, and its
// result carries { crosswalk, inputs, formula, assumptions }. The change synthesis offers converted arms only as a sensitivity analysis
// beside the same-scale pools (convertedPools); they never enter the primary pool. Pure: no store.
import { instrumentOf } from './instruments.mjs';

const str = v => String(v ?? '').trim();
const fold = t => str(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
const fin = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const g = x => String(Number(Number(x).toPrecision(4)));
const pctText = x => `${Math.round(x * 100)}%`;

export const CROSSWALK_METHODS = Object.freeze([
  { id: 'linear', label: 'Linear formula' },
  { id: 'table', label: 'Table lookup' },
  { id: 'stratified', label: 'Formula per covariate level' },
  { id: 'percent-change', label: 'Percent-change equivalence' }]);
const METHOD_IDS = new Set(CROSSWALK_METHODS.map(m => m.id));

/** The Hoehn and Yahr groups of Goetz 2012 (I/II, III, IV/V); a stage written as a number (2.5) falls in the group whose stages hold it. */
const HOEHN_YAHR = Object.freeze({ id: 'hoehn-yahr', label: 'Hoehn and Yahr stage', names: ['Hoehn and Yahr', 'Hoehn & Yahr', 'H&Y', 'H & Y'],
  strata: Object.freeze([{ id: 'I-II', label: 'I/II', stages: [1, 2.5] }, { id: 'III', label: 'III', stages: [3, 3] }, { id: 'IV-V', label: 'IV/V', stages: [4, 5] }]) });

/** The built-in crosswalks. Each source was checked in PubMed on 7 Nov 2026; parameters only where the paper's text was read. */
export const BUILT_IN_CROSSWALKS = Object.freeze([
  Object.freeze({ id: 'goetz-2012', label: 'Goetz 2012', from: 'UPDRS-III', to: 'MDS-UPDRS-III', method: 'stratified', covariate: HOEHN_YAHR,
    params: { strata: {}, overall: null }, range: null,
    source: { citation: "Goetz CG, Stebbins GT, Tilley BC. Calibration of unified Parkinson's disease rating scale scores to Movement Disorder Society-unified Parkinson's disease rating scale scores. Mov Disord. 2012;27(10):1239-1242.",
      doi: '10.1002/mds.25122', pmid: '22886777', table: '', checked: '', needs: 'the paper',
      note: 'Regression weights and intercepts for three Hoehn and Yahr groups (I/II, III, IV/V), fitted on the scores of 875 patients; Part III concordance 0.97 (abstract). The formulas are in the full text, not yet read.' } }),
  Object.freeze({ id: 'hentz-2015', label: 'Hentz 2015', from: 'UPDRS-III', to: 'MDS-UPDRS-III', method: 'linear', params: { intercept: 7, slope: 1 }, range: null,
    source: { citation: "Hentz JG, Mehta SH, Shill HA, Driver-Dunckley E, Beach TG, Adler CH. Simplified conversion method for unified Parkinson's disease rating scale motor examinations. Mov Disord. 2015;30(14):1967-1970.",
      doi: '10.1002/mds.26435', pmid: '26779608', table: 'Abstract', checked: '2026-11-07', needs: '',
      note: 'The abstract: 7 points added to the UPDRS III total approximate the MDS-UPDRS III total (intraclass correlation 0.96; within 3 points half the time, within 9 points 95% of the time). With a slope of 1 a change score is unchanged.' } }),
  Object.freeze({ id: 'leucht-2018', label: 'Leucht 2018', from: 'HAM-D17', to: 'MADRS', method: 'percent-change', params: { baseline: [], percent: 'equal' }, range: null,
    source: { citation: 'Leucht S, Fennema H, Engel RR, Kaspers-Janssen M, Szegedi A. Translating the HAM-D into the MADRS and vice versa with equipercentile linking. J Affect Disord. 2018;226:326-331.',
      doi: '10.1016/j.jad.2017.09.042', pmid: '29031182', table: '', checked: '', needs: 'the paper',
      note: 'Equipercentile linking of 4,388 patients in 31 mirtazapine trials; a percent improvement from baseline was about the same on both scales (abstract). The table of totals, and which HAM-D version was linked, are in the full text, not yet read.' } }),
]);
const BUILT = new Map(BUILT_IN_CROSSWALKS.map(x => [x.id, x]));

// ---- entries --------------------------------------------------------------------------------------------------------------------------
const pair = p => (Array.isArray(p) && p.length === 2 && fin(p[0]) && fin(p[1]) ? [Number(p[0]), Number(p[1])] : null);
const points = x => (Array.isArray(x) ? x.map(pair).filter(Boolean) : []);
const line = x => (x && fin(x.intercept) && fin(x.slope) && Number(x.slope) !== 0 ? { intercept: Number(x.intercept), slope: Number(x.slope) } : null);
function normParams(method, p = {}) {
  if (method === 'linear') return line(p) || { intercept: null, slope: null };
  if (method === 'table') return { points: points(p.points) };
  if (method === 'stratified') return { strata: Object.fromEntries(Object.entries(p.strata || {}).map(([k, v]) => [str(k), line(v)]).filter(([, v]) => v)), overall: line(p.overall) };
  if (method === 'percent-change') return { baseline: points(p.baseline), percent: p.percent === 'equal' || p.percent == null ? 'equal' : points(p.percent) };
  return {};
}
const normCovariate = c => (c && typeof c === 'object' ? { id: str(c.id), label: str(c.label), names: (c.names || []).map(str).filter(Boolean),
  strata: (c.strata || []).map(z => ({ id: str(z.id), label: str(z.label) || str(z.id), stages: pair(z.stages) })).filter(z => z.id && z.stages) } : null);
/**
 * An entry as stored: known keys, numbers or null. Does not validate (see crosswalkProblems). An entry with a built-in id keeps the built-in's
 * scales, method and levels, so a project that only fills in the coefficients states just those.
 */
export function normalizeCrosswalk(input = {}) {
  const b = BUILT.get(str(input?.id)), x = b ? { ...input, from: b.from, to: b.to, method: b.method, covariate: b.covariate } : input;
  const method = METHOD_IDS.has(x.method) ? x.method : '', src = x.source || {}, covariate = normCovariate(x.covariate);
  return { id: str(x.id), label: str(x.label).slice(0, 60), from: str(x.from), to: str(x.to), method, params: normParams(method, x.params),
    range: pair(x.range), ...(covariate ? { covariate } : {}),
    source: Object.fromEntries(['citation', 'doi', 'pmid', 'table', 'checked', 'needs', 'note'].map(k => [k, str(src[k]).slice(0, 600)])) };
}
const ascending = ps => ps.every((p, i) => i === 0 || p[0] > ps[i - 1][0]);
/** Rising or falling throughout (ties allowed, an equipercentile table repeats a value), and not flat. */
const monotone = ps => { const d = Math.sign(ps.at(-1)[1] - ps[0][1]); return d !== 0 && ps.every((p, i) => i === 0 || Math.sign(p[1] - ps[i - 1][1]) * d >= 0); };
/** What is wrong with an entry, as sentences; [] when it can be saved. Empty parameters are allowed: the entry then needs its coefficients. */
export function crosswalkProblems(x) {
  const out = [];
  if (!/^[a-z0-9][a-z0-9._-]{0,59}$/i.test(x.id || '')) out.push('The crosswalk needs an id of letters, digits, “_”, “.” or “-”.');
  if (!x.from || !x.to || x.from === x.to) out.push(`${x.id || 'The crosswalk'}: choose two different scales.`);
  if (!x.method) out.push(`${x.id || 'The crosswalk'}: choose a method.`);
  if (x.method === 'stratified' && !x.covariate?.strata?.length) out.push(`${x.id}: a formula per level needs the levels.`);
  for (const ps of [x.params?.points, x.params?.baseline, Array.isArray(x.params?.percent) ? x.params.percent : null].filter(p => p?.length))
    if (!ascending(ps) || !monotone(ps)) out.push(`${x.id}: a table's rows must rise on the first scale and move one way on the second.`);
  if (x.range && !(x.range[0] < x.range[1])) out.push(`${x.id}: the lowest value must be below the highest.`);
  return out;
}

const cache = new WeakMap(), NONE = [];
/** A project entry (normalized) over the built-in one of its id: parameters the project fills in, its range and the source fields it states replace the built-in's. */
function merged(b, p) {
  if (!b) return { ...p, label: p.label || p.id, builtIn: false };
  const filled = hasCoefficients(p), src = Object.fromEntries(Object.entries(p.source).filter(([, v]) => v));
  return { ...b, label: p.label || b.label, params: filled ? p.params : b.params, range: p.range ?? b.range,
    source: { ...b.source, ...src, ...(filled && !src.needs ? { needs: '' } : {}) }, builtIn: true, extended: true };
}
/** The crosswalks of a project: the built-in list with the project's own entries (s.crosswalks) over it. Entries with problems are skipped. */
export function crosswalks(s) {
  const own = Array.isArray(s?.crosswalks) ? s.crosswalks : NONE;
  if (cache.has(own)) return cache.get(own);
  const map = new Map(BUILT_IN_CROSSWALKS.map(x => [x.id, { ...x, builtIn: true }]));
  for (const p of own.map(normalizeCrosswalk)) {
    const m = merged(BUILT.get(p.id), p);
    if (!crosswalkProblems(m).length) map.set(p.id, m);
  }
  const out = [...map.values()];
  cache.set(own, out);
  return out;
}
export const crosswalkOf = (s, id) => (id ? crosswalks(s).find(x => x.id === id) || null : null);
/** The crosswalks from one scale to another, built-in first in their order. */
export const crosswalksFor = (s, from, to) => crosswalks(s).filter(x => x.from === from && (!to || x.to === to));

/** Adds or replaces a project entry. Reducer. Returns '' or why it was refused. */
export function putCrosswalk(s, input) {
  const x = normalizeCrosswalk(input), b = BUILT.get(x.id), problems = crosswalkProblems(b ? merged(b, x) : x);
  if (problems.length) return problems[0];
  const cur = Array.isArray(s.crosswalks) ? s.crosswalks : [];
  s.crosswalks = cur.some(y => str(y.id) === x.id) ? cur.map(y => (str(y.id) === x.id ? x : y)) : [...cur, x];
  return '';
}

/** Whether an entry's coefficients are entered: a stratified one needs every level's formula, or its overall one. */
export function hasCoefficients(x) {
  const p = x?.params || {};
  if (x?.method === 'linear') return !!line(p);
  if (x?.method === 'table') return points(p.points).length >= 2;
  if (x?.method === 'stratified') return !!line(p.overall) || (!!x.covariate?.strata?.length && x.covariate.strata.every(z => line(p.strata?.[z.id])));
  if (x?.method === 'percent-change') return points(p.baseline).length >= 2 && (p.percent === 'equal' || points(p.percent).length >= 2);
  return false;
}
/** What a crosswalk still needs, in words: { ready, words }. */
export function crosswalkState(x) {
  if (!x) return { ready: false, words: 'No crosswalk' };
  if (!hasCoefficients(x)) return { ready: false, words: `Needs coefficients${x.source?.needs ? ` from ${x.source.needs}` : ''}` };
  return { ready: true, words: x.method === 'stratified' ? `Converts an arm with its ${x.covariate.label} mix` : 'Coefficients entered' };
}

// ---- a study arm's covariate --------------------------------------------------------------------------------------------------------
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
/** A level label as stages: "III" → [3, 3], "I/II" or "1-2" → [1, 2], "2.5" → [2.5, 2.5]; null when it is not one. */
function stagesOf(label) {
  const ps = str(label).split(/\s*[/–-]\s*/).map(p => ROMAN[p.toLowerCase()] ?? (fin(p) ? Number(p) : NaN));
  return ps.length && ps.length <= 2 && !ps.some(Number.isNaN) ? [Math.min(...ps), Math.max(...ps)] : null;
}
/**
 * An arm's mix of a covariate's levels from its text: "I/II: 12; III: 20; IV/V: 3" (counts) or "III: 60%, IV: 40%" (percents); a level is
 * the covariate's label for it or a stage within it (2.5 falls in I/II). Returns { [level]: share } summing to 1, or null for any other text
 * (a mean stage, a range from the criteria): a conversion then has no mix to use.
 */
export function covariateMix(text, covariate) {
  const strata = covariate?.strata || [], parts = str(text).split(/[;,\n]+/).map(str).filter(Boolean);
  if (!parts.length || !strata.length) return null;
  const sums = {}, kinds = new Set();
  for (const p of parts) {
    const m = /(?:^|[\s(])([0-9.]+|[ivx]+)(?:\s*[/–-]\s*([0-9.]+|[ivx]+))?\s*[:=]\s*(?:n\s*=\s*)?(\d+(?:\.\d+)?)\s*(%)?$/i.exec(p);
    const span = m && stagesOf(m[2] ? `${m[1]}/${m[2]}` : m[1]), z = span && strata.find(x => span[0] >= x.stages[0] && span[1] <= x.stages[1]);
    if (!z) return null;
    sums[z.id] = (sums[z.id] || 0) + Number(m[3]); kinds.add(m[4] ? '%' : 'n');
  }
  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  if (kinds.size > 1 || !(total > 0)) return null;
  return Object.fromEntries(Object.entries(sums).filter(([, v]) => v > 0).map(([k, v]) => [k, v / total]));
}

// ---- when a value may be converted ---------------------------------------------------------------------------------------------------
const no = reason => ({ ok: false, via: '', reason, flags: [] });
const yes = (via, flags = []) => ({ ok: true, via, reason: '', flags });
/**
 * Whether an arm's values may be converted by a crosswalk (W3; the owner may change this rule). `row` is a change row
 * (lib/change-rows.mjs: instrument, location, baseline_mean, end_mean, change_used) with `covariate`, the arm's mix of the crosswalk's
 * levels (covariateMix) or null. Returns { ok, via: 'formula' | 'levels' | 'overall', reason: why not, flags: the approximations it carries }.
 * Without the arm's mix a stratified crosswalk converts nothing, unless the paper gives an overall formula, which is then used and flagged.
 */
export function crosswalkApplies(row, x) {
  if (!x || row?.instrument !== x.from) return no('another scale');
  if (!hasCoefficients(x)) return no('the crosswalk needs its coefficients');
  if (row.location && row.location !== 'mean') return no('not a mean');
  const [lo, hi] = rangeOf(x);
  if ([row.baseline_mean, row.end_mean].some(m => fin(m) && (m < lo || m > hi))) return no('a mean outside the range the crosswalk holds for');
  if (x.method !== 'linear' && x.method !== 'stratified' && !fin(row.baseline_mean)) return no('no baseline mean');
  if (x.method === 'percent-change' && !fin(row.change_used) && !fin(row.end_mean)) return no('no change from baseline');
  if (x.method !== 'stratified') return yes('formula');
  const mix = row.covariate, has = z => !!line(x.params.strata?.[z]);
  if (mix && Object.keys(mix).every(has)) return yes('levels');
  if (line(x.params.overall)) return yes('overall', [`overall formula: the arm's ${x.covariate.label} mix is ${mix ? 'outside the levels with a formula' : 'not reported'}`]);
  return no(mix ? `no formula for ${x.covariate.label} ${Object.keys(mix).filter(z => !has(z)).map(z => x.covariate.strata.find(s => s.id === z)?.label || z).join(', ')}` : `no ${x.covariate.label} mix`);
}
/** The source values a crosswalk holds for: its own range, else the table's first and last rows, else none (−∞ to ∞). */
function rangeOf(x) {
  if (x.range) return x.range;
  const ps = x.method === 'table' ? x.params.points : x.method === 'percent-change' ? x.params.baseline : null;
  return ps?.length >= 2 ? [ps[0][0], ps.at(-1)[0]] : [-Infinity, Infinity];
}

// ---- conversion -----------------------------------------------------------------------------------------------------------------------
/** A table read at x, linear between its rows, with its slope there: { y, slope }. x outside the table is refused by crosswalkApplies. */
function lookup(ps, x) {
  let i = ps.findIndex((p, k) => k > 0 && x <= p[0]); if (i < 0) i = ps.length - 1;
  const [x0, y0] = ps[i - 1], [x1, y1] = ps[i], slope = (y1 - y0) / (x1 - x0);
  return { y: y0 + slope * (x - x0), slope };
}
const scaled = (v, k) => (fin(v) ? Number(v) * k : v ?? null);
/**
 * The arm's values on the crosswalk's target scale, or { error }. Returns { values: { baseline_mean, baseline_sd, end_mean, end_sd,
 * change_mean, change_used, change_sd }, sign (−1 when the target runs the other way), derivation: { crosswalk, from, to, method, inputs,
 * formula, assumptions } }. The arm's own values are not changed. Call only when crosswalkApplies says it may.
 */
export function convertArm(row, x) {
  const ok = crosswalkApplies(row, x);
  if (!ok.ok) return { error: ok.reason };
  const inputs = Object.fromEntries(['baseline_mean', 'baseline_sd', 'end_mean', 'end_sd', 'change_mean', 'change_used', 'change_sd'].filter(k => fin(row[k])).map(k => [k, Number(row[k])]));
  const assumptions = ['A formula fitted on patients’ scores, applied to an arm’s mean', ...ok.flags];
  const base = { crosswalk: x.id, from: x.from, to: x.to, method: x.method, inputs };
  let a, b, formula;
  if (x.method === 'linear') ({ intercept: a, slope: b } = x.params);
  if (x.method === 'stratified') {
    const mix = ok.via === 'levels' ? row.covariate : null, f = z => x.params.strata[z];
    if (mix) {
      a = Object.entries(mix).reduce((t, [z, w]) => t + w * f(z).intercept, 0); b = Object.entries(mix).reduce((t, [z, w]) => t + w * f(z).slope, 0);
      base.inputs.covariate = mix;
      assumptions.push(`Each ${x.covariate.label} group’s mean taken as the arm’s mean`, 'SDs scaled by the mix-weighted slope');
      formula = `${x.covariate.label} ${Object.entries(mix).map(([z, w]) => `${x.covariate.strata.find(s => s.id === z)?.label || z} ${pctText(w)}`).join(', ')}: intercept ${g(a)}, slope ${g(b)}`;
    } else ({ intercept: a, slope: b } = x.params.overall);
  }
  if (a != null) {
    const m = v => (fin(v) ? a + b * Number(v) : null);
    formula = `${x.to} = ${g(a)} + ${g(b)} × ${x.from}${formula ? ` (${formula})` : ''}; change × ${g(b)}; SD × ${g(Math.abs(b))}`;
    return { sign: Math.sign(b), derivation: { ...base, formula, assumptions },
      values: { baseline_mean: m(row.baseline_mean), end_mean: m(row.end_mean), change_mean: scaled(row.change_mean, b), change_used: scaled(row.change_used, b),
        baseline_sd: scaled(row.baseline_sd, Math.abs(b)), end_sd: scaled(row.end_sd, Math.abs(b)), change_sd: scaled(row.change_sd, Math.abs(b)) } };
  }
  // a table: the means read off it; a change as the difference of two read values; SDs by the table's slope at the baseline
  const ps = x.method === 'table' ? x.params.points : x.params.baseline, bm = Number(row.baseline_mean), B = lookup(ps, bm);
  const ch = fin(row.change_used) ? Number(row.change_used) : fin(row.end_mean) ? Number(row.end_mean) - bm : null;
  let change, end;
  if (x.method === 'table') {
    end = fin(row.end_mean) ? lookup(ps, Number(row.end_mean)).y : ch != null ? lookup(ps, bm + ch).y : null;
    change = end != null ? end - B.y : null;
    formula = `${x.to} read off the table of ${ps.length} rows, linear between rows; change = table(end) − table(baseline); baseline and end SD × the table’s slope at the baseline (${g(B.slope)}); change SD × converted over reported change`;
    assumptions.push('A non-linear table applied to a mean', 'SDs scaled by the table’s slope at the baseline mean');
  } else {
    const p = ch != null && bm !== 0 ? ch / bm : null, q = p == null ? null : x.params.percent === 'equal' ? p : lookup(x.params.percent, p).y;
    change = q == null ? null : q * B.y; end = change == null ? null : B.y + change;
    formula = `${x.to} baseline read off the table of totals (${g(bm)} → ${g(B.y)}); percent change ${x.params.percent === 'equal' ? 'kept' : 'read off its table'} (${p == null ? 'none' : `${g(100 * p)}%`}); change = percent × baseline; baseline and end SD × the table’s slope at the baseline (${g(B.slope)}); change SD × converted over reported change`;
    assumptions.push(x.params.percent === 'equal' ? 'A percent change from baseline taken as the same on both scales' : 'A percent change read off its table', 'SDs scaled by the table’s slope at the baseline mean');
  }
  const k = Math.abs(B.slope), r = ch ? Math.abs((change ?? 0) / ch) : k;
  return { sign: Math.sign(B.slope), derivation: { ...base, formula, assumptions },
    values: { baseline_mean: B.y, end_mean: end, change_mean: fin(row.change_mean) ? change : null, change_used: fin(row.change_used) ? change : null,
      baseline_sd: scaled(row.baseline_sd, k), end_sd: scaled(row.end_sd, k), change_sd: scaled(row.change_sd, r) } };
}

// ---- the synthesis --------------------------------------------------------------------------------------------------------------------
/** The columns of a project that hold a covariate: a column whose label names it (“Hoehn and Yahr stage mix”). */
const covariateColumns = (s, cov) => {
  const names = [cov.label, ...(cov.names || [])].map(fold).filter(Boolean);
  return (s.templates || []).flatMap(t => t.columns || []).filter(c => names.some(n => fold(c.label).includes(n))).map(c => c.id);
};
/** Each study's and arm's mix of a covariate's levels: { [paper_id]: mix, [`${paper_id}@${arm}`]: mix }, from the columns that name it. */
function covariatesOf(s, cov) {
  const cols = covariateColumns(s, cov), out = {};
  if (!cols.length) return out;
  for (const [k, v] of Object.entries(s.values || {})) {
    const col = cols.find(c => k.includes(`:${c}`) && (k.endsWith(`:${c}`) || k.includes(`:${c}@`)));
    if (!col || !v || v.availability === 'not_found') continue;
    const mix = covariateMix(typeof v.normalized_value === 'string' ? v.normalized_value : v.reported_value, cov);
    if (!mix) continue;
    const at = k.lastIndexOf(`:${col}`), pid = k.slice(0, at), arm = k.slice(at + col.length + 2);
    out[arm ? `${pid}@${arm}` : pid] = mix;
  }
  return out;
}
const conversions = scales => Object.entries(scales || {}).filter(([, d]) => d?.use === 'convert' && d.to);
/** The crosswalk a decision to convert uses: the one it names, else (a decision made before it named one, or one since removed) the pair's first. */
function decisionCrosswalk(s, from, d) {
  const named = crosswalkOf(s, d.crosswalk);
  return named && named.from === from && named.to === d.to ? named : crosswalksFor(s, from, d.to)[0] || null;
}
/** The columns the conversions read besides an arm's own values (the covariate columns of stratified crosswalks), for the values a run rests on. */
export const conversionFields = (s, scales = s?.synthesis?.scales) =>
  [...new Set(conversions(scales).map(([from, d]) => decisionCrosswalk(s, from, d)).filter(x => x?.method === 'stratified').flatMap(x => covariateColumns(s, x.covariate)))];
/**
 * What the change synthesis needs to convert the scales a review decided to convert (s.synthesis.scales { use: 'convert', to, crosswalk? }):
 * [{ from, to, crosswalk: the entry with its range resolved, or null, covariates? }], or null when no scale is converted. Carried in the
 * plan (lib/change-synthesis.mjs changePlan), so the worker, which has only the rows and the plan, converts the same way.
 */
export function conversionPlan(s, scales = s?.synthesis?.scales) {
  const out = [];
  for (const [from, d] of conversions(scales)) {
    const x = decisionCrosswalk(s, from, d);
    if (!x) { out.push({ from, to: d.to, crosswalk: null }); continue; }
    const src = instrumentOf(s, from), range = x.range || (fin(src?.min) && fin(src?.max) ? [src.min, src.max] : null);
    out.push({ from, to: d.to, crosswalk: { ...x, range }, ...(x.method === 'stratified' ? { covariates: covariatesOf(s, x.covariate) } : {}) });
  }
  return out.length ? out : null;
}
const finite = r => r.yi != null && Number.isFinite(r.yi) && r.vi > 0;
/**
 * The "converted to X" sensitivity analyses: for each converted scale, its target's same-scale rows with the arms the crosswalk may convert
 * (crosswalkApplies), converted (convertArm) and given new effects. `rows` are the synthesis' rows with effects (the primary set and the
 * scales kept for sensitivity analyses); `effects(rows)` computes a row's effects (lib/change-synthesis.mjs withEffects), `pool(rows)` fits.
 * Returns [{ from, to, crosswalk, state, own, converted, out: { [reason]: arms }, trials, rows, pool }]; pool null under minTrials or
 * while the crosswalk needs its coefficients. Converted rows carry `converted_from` and `derivation`, and no `ix` of their own.
 */
export function convertedPools(conversions, rows = [], { effects, pool, minTrials = 3 } = {}) {
  return (conversions || []).map(c => {
    const x = c.crosswalk, base = { from: c.from, to: c.to, crosswalk: x?.id || null, label: x?.label || '', state: crosswalkState(x).words };
    const own = rows.filter(r => r.instrument === c.to && finite(r)), out = {}, conv = [];
    if (!x || !hasCoefficients(x)) return { ...base, own: own.length, converted: 0, out, trials: 0, rows: [], pool: null };
    for (const r of rows.filter(y => y.instrument === c.from)) {
      const row = { ...r, covariate: c.covariates?.[`${r.paper_id}@${r.arm}`] || c.covariates?.[r.paper_id] || null }, k = convertArm(row, x);
      if (k.error) { out[k.error] = (out[k.error] || 0) + 1; continue; }
      // the effects are the converted values' own (effects() gives them): none is kept from the arm as reported
      conv.push({ ...r, yi: null, vi: null, yi_fb: null, vi_fb: null, ...k.values, dir: r.dir == null ? r.dir : r.dir * k.sign, instrument: c.to, converted_from: c.from, derivation: k.derivation });
    }
    const made = effects(conv).map(r => ({ ...r, ix: null }));
    for (const r of made.filter(y => !finite(y))) out['no effect after conversion'] = (out['no effect after conversion'] || 0) + 1;
    const all = [...own, ...made.filter(finite)], trials = new Set(all.map(r => r.trial)).size;
    return { ...base, own: own.length, converted: all.length - own.length, out, trials, rows: all, pool: trials >= minTrials && all.length ? pool(all) : null };
  });
}

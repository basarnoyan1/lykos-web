// What a model is asked to read for the analysis inputs, and the checks its
// answers pass before a person sees them.
//
// The model restates what a paper writes; it never computes (plan §1.3). A
// paper that reports a standard error or a 95% CI of an arm mean instead of
// its SD is common, and the SD follows from it by a fixed formula (Cochrane
// Handbook 6.5.2.2), so the model is asked for what the paper states and the
// SD is derived here, with the derivation kept as the value's provenance.
//
// Every check is mechanical: a count cannot exceed its arm, an SD is positive,
// a hazard ratio lies inside its own interval, a category value is one of the
// field's options. A value that fails is dropped with its reason, not shown.
import { splitField, fieldFor, outcomeById } from './outcomes.mjs';
import { extractionFields, measureOf } from './effect-measures.mjs';
import { cellNumber } from './fields.mjs';

const numeric = f => f && (f.type === 'number' || f.type === 'integer');

// One line each, only for the fields a call asks about.
export const DEFINITIONS = {
  events_t: 'participants with the event, intervention arm; a count, not a percentage',
  n_t: 'participants analysed, intervention arm',
  events_c: 'participants with the event, control arm; a count, not a percentage',
  n_c: 'participants analysed, control arm',
  mean_t: 'arithmetic mean, intervention arm; not a median',
  sd_t: 'standard deviation, intervention arm; not an SE, CI, IQR or range',
  mean_c: 'arithmetic mean, control arm; not a median',
  sd_c: 'standard deviation, control arm; not an SE, CI, IQR or range',
  hr: 'hazard ratio, intervention versus control, as reported',
  hr_lo: 'lower bound of that hazard ratio\'s 95% CI',
  tp: 'index test positive and reference standard positive; a count of patients (or the stated unit)',
  fp: 'index test positive and reference standard negative; a count',
  fn: 'index test negative and reference standard positive; a count',
  tn: 'index test negative and reference standard negative; a count',
  hr_hi: 'upper bound of that hazard ratio\'s 95% CI',
  effect_estimate: 'one compatible reported model estimate, on its natural scale; never reconstruct or calculate it',
  effect_se: 'reported standard error of this estimate; for OR, RR and HR, only the SE of its natural logarithm',
  effect_lo: 'reported confidence interval lower limit for this exact model, on the estimate scale',
  effect_hi: 'reported confidence interval upper limit for this exact model, on the estimate scale',
  effect_confidence: 'confidence level of this interval as a percentage, for example 95; do not infer it',
  effect_df: 'degrees of freedom used for this model confidence interval, only if stated',
  effect_uncertainty: 'SE if its analysis-scale standard error is reported; CI if a symmetric confidence interval is reported',
  effect_population: 'population and analysis subset that produced this estimate, including matching or weighting',
  effect_contrast: 'intervention, reference category and direction of comparison, or predictor increment and units for a coefficient',
  effect_adjustment_type: 'adjusted or unadjusted, as stated for this model',
  effect_adjustment: 'model name and exact covariates or adjustment used for this estimate',
  effect_source: 'table, model number, figure or text location for this exact estimate',
  time_t: 'total person-time at risk, intervention arm, in the unit reported',
  time_c: 'total person-time at risk, control arm, in the unit reported',
  events: 'participants with the event, single group; a count, not a percentage',
  n: 'participants analysed, single group',
  mean: 'arithmetic mean, single group; not a median',
  sd: 'standard deviation, single group; not an SE, CI, IQR or range',
  r: 'correlation coefficient r; not r², not a slope',
};

// The SD fields a stand-in may be offered for, and the arm each belongs to.
const armOf = base => (base === 'sd' ? '' : /^sd_(t|c)$/.exec(base)?.[1] ?? null);
const inArm = (name, arm) => (arm ? `${name}_${arm}` : name);

// Stated in place of an SD; each names the SD it stands for.
const AUX = [
  ['se', 'standard error of the arm mean, only where no SD is given'],
  ['mlo', 'lower 95% CI bound of the arm mean, only where no SD or SE is given'],
  ['mhi', 'upper 95% CI bound of the arm mean, only where no SD or SE is given'],
];

/**
 * Whether a field is one the analysis can use now: a plain field always; an
 * analysis input only when its outcome's measure takes it. An input of a
 * measure no longer in use may still show in the grid because some study
 * holds a value, but asking a model for it again is wasted work.
 */
export function inUse(s, f) {
  // an accuracy review's 2×2 counts belong to no outcome's measure (lib/dta.mjs)
  if (!f?.analysis || f.family === 'dta') return true;
  const { base, outcomeId } = splitField(f.id);
  return extractionFields(outcomeById(s, outcomeId).measure).includes(base);
}

/** The requested fields, with an SE and a mean CI offered beside each SD. */
export function withAux(FS) {
  const out = [...FS];
  for (const f of FS) {
    const { base, outcomeId } = splitField(f.id);
    const arm = armOf(base);
    if (arm == null) continue;
    for (const [kind, what] of AUX)
      out.push({ id: fieldFor(inArm(kind, arm), outcomeId), type: 'number', label: `${kind === 'se' ? 'SE' : kind === 'mlo' ? 'Mean, lower 95% CI' : 'Mean, upper 95% CI'} · ${f.label}`,
        aux: kind, target: f.id, definition: what });
  }
  return out;
}

/**
 * The field list a prompt carries: id, type, label, and for analysis inputs
 * a definition, grouped under the outcome and measure they belong to.
 */
export function fieldLines(FS, s) {
  const plain = FS.filter(f => (!f.analysis || f.family === 'dta') && !f.aux);
  const line = f => `- ${f.id} (${f.type}): ${f.label}${f.options?.length ? ` [${f.options.join(' | ')}]` : ''}${f.definition || DEFINITIONS[splitField(f.id).base] ? ` — ${f.definition || DEFINITIONS[splitField(f.id).base]}` : ''}`;
  const out = plain.map(line);
  const byOutcome = new Map();
  for (const f of FS.filter(x => (x.analysis && x.family !== 'dta') || x.aux)) {
    const o = splitField(f.id).outcomeId;
    if (!byOutcome.has(o)) byOutcome.set(o, []);
    byOutcome.get(o).push(f);
  }
  for (const [o, list] of byOutcome) {
    const oc = outcomeById(s, o);
    out.push(`Outcome "${oc.name}" (${measureOf(oc.measure).label}):`, ...list.map(line));
  }
  return out.join('\n');
}

// ---- Student t quantile, for an SD from a small sample's CI ----------------
// Regularised incomplete beta by continued fraction (Lentz), then bisection.

function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -t + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const tiny = 1e-300; let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
/** P(T ≤ t) for Student's t with df degrees of freedom. */
export function tCdf(t, df) {
  const p = 0.5 * ibeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - p : p;
}
/** The t quantile, as R's qt(p, df). */
export function tQuantile(p, df) {
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---- checks ------------------------------------------------------------------
const MEDIAN = /\bmedian\b/i, MEAN = /\bmean\b|\baverage\b/i;
const NOT_SD = /\bs\.?e\.?m?\b|standard error|\biqr\b|interquartile|\brange\b|\bci\b|confidence interval/i;
const SD = /\bs\.?d\.?\b|standard deviation|±/i;
const OTHER_LEVEL = /\b(?:90|99|80)\s*%/;

const num = (v, f) => cellNumber(v, f?.type || 'number');

/**
 * The values kept after the mechanical checks, and those dropped with why.
 * `vals` are already quote-checked ({ field, value, quote }); `known(id)` is
 * a number the study already holds for a field, or undefined.
 */
export function checkValues(vals, FS, known = () => undefined) {
  const byId = new Map(FS.map(f => [f.id, f]));
  const kept = [], dropped = [];
  const drop = (v, reason) => dropped.push({ field: v.field, reason });
  const first = new Map();
  for (const v of vals) {
    const f = byId.get(v.field); if (!f) { drop(v, 'unknown field'); continue; }
    if (first.has(v.field)) continue;
    let value = v.value;
    if (f.type === 'category' && f.options?.length) {
      const hit = f.options.find(o => o.toLowerCase() === String(value).trim().toLowerCase());
      if (!hit) { drop(v, 'not one of the options'); continue; }
      value = hit;
    }
    if (numeric(f)) {
      const n = num(value, f), base = splitField(f.id).base;
      if (!Number.isFinite(n)) { drop(v, 'not a number'); continue; }
      if (f.type === 'integer' && (!Number.isInteger(n) || n < 0)) { drop(v, 'not a whole count'); continue; }
      if (/^n(_[tc])?$/.test(base) && n < 1) { drop(v, 'an arm of no one'); continue; }
      if (/^(sd|se|time)(_[tc])?$/.test(base) && !(n > 0)) { drop(v, 'not positive'); continue; }
      if (/^hr/.test(base) && !(n > 0)) { drop(v, 'a ratio must be positive'); continue; }
      if (base === 'r' && !(n >= -1 && n <= 1)) { drop(v, 'a correlation lies between −1 and 1'); continue; }
      if (/^mean(_[tc])?$/.test(base) && MEDIAN.test(v.quote) && !MEAN.test(v.quote)) { drop(v, 'a median, not a mean'); continue; }
      if (/^sd(_[tc])?$/.test(base) && NOT_SD.test(v.quote) && !SD.test(v.quote)) { drop(v, 'not stated as an SD'); continue; }
      if (/^(hr_lo|hr_hi|mlo|mhi)(_[tc])?$/.test(base) && OTHER_LEVEL.test(v.quote)) { drop(v, 'not a 95% interval'); continue; }
    }
    first.set(v.field, { ...v, value });
  }
  // Relations between fields, each against the proposal or what the study holds.
  const valOf = id => first.has(id) ? num(first.get(id).value, byId.get(id)) : known(id);
  const bad = new Map();
  for (const [id] of first) {
    const { base, outcomeId } = splitField(id);
    const other = b => fieldFor(b, outcomeId);
    const m = /^events(?:_(t|c))?$/.exec(base);
    if (m) { const n = valOf(other(inArm('n', m[1]))); if (Number.isFinite(n) && valOf(id) > n) bad.set(id, `more events than participants (${n})`); }
    const nm = /^n(?:_(t|c))?$/.exec(base);
    if (nm) { const e = valOf(other(inArm('events', nm[1]))); if (Number.isFinite(e) && e > valOf(id)) bad.set(id, `fewer participants than events (${e})`); }
    if (/^hr(_lo|_hi)?$/.test(base)) {
      const hr = valOf(other('hr')), lo = valOf(other('hr_lo')), hi = valOf(other('hr_hi'));
      const ok = [hr, lo, hi].filter(Number.isFinite).length < 2 ||
        ((!Number.isFinite(lo) || !Number.isFinite(hi) || lo < hi) && (!Number.isFinite(hr) || ((!Number.isFinite(lo) || lo <= hr) && (!Number.isFinite(hi) || hr <= hi))));
      if (!ok) bad.set(id, 'hazard ratio outside its interval');
    }
    const cm = /^(mlo|mhi)(?:_(t|c))?$/.exec(base);
    if (cm) { const lo = valOf(other(inArm('mlo', cm[2]))), hi = valOf(other(inArm('mhi', cm[2]))); if (Number.isFinite(lo) && Number.isFinite(hi) && !(lo < hi)) bad.set(id, 'interval bounds reversed'); }
  }
  for (const [id, v] of first) { if (bad.has(id)) drop(v, bad.get(id)); else kept.push(v); }
  return { kept, dropped };
}

const round = x => String(Number(x.toPrecision(6)));

/**
 * SDs derived from what the paper states instead: SD = SE·√n, or from a 95%
 * CI of the mean, SD = √n·(upper − lower)/(2·q), q = 1.96 from 60 in the arm,
 * else Student's t with n − 1 df (Cochrane Handbook 6.5.2.2). Only for an SD
 * the model did not read directly; the arm size comes from the proposal or
 * from the study. Returns the kept values without the stand-ins, plus the
 * derived SDs, each with its derivation.
 */
export function deriveSD(kept, FS, known = () => undefined) {
  const byId = new Map(FS.map(f => [f.id, f]));
  const have = new Map(kept.map(v => [v.field, v]));
  const out = kept.filter(v => !byId.get(v.field)?.aux);
  const unused = [];
  for (const f of FS.filter(x => x.aux === 'se')) {
    const sd = f.target; if (have.has(sd)) continue;
    const { outcomeId } = splitField(f.id), arm = armOf(splitField(sd).base);
    const nId = fieldFor(inArm('n', arm), outcomeId);
    const n = have.has(nId) ? num(have.get(nId).value, byId.get(nId) || { type: 'integer' }) : known(nId);
    const se = have.get(f.id), lo = have.get(fieldFor(inArm('mlo', arm), outcomeId)), hi = have.get(fieldFor(inArm('mhi', arm), outcomeId));
    if (!(se || (lo && hi))) continue;
    if (!(Number.isFinite(n) && n >= 2)) { unused.push(byId.get(sd)?.label || sd); continue; }
    let value, derivation, quote;
    if (se) {
      const x = num(se.value);
      value = x * Math.sqrt(n); quote = se.quote;
      derivation = `SD = SE × √n = ${se.value} × √${n}`;
    } else {
      const a = num(lo.value), b = num(hi.value);
      const q = n >= 60 ? 1.96 : tQuantile(0.975, n - 1);
      value = Math.sqrt(n) * (b - a) / (2 * q); quote = lo.quote === hi.quote ? lo.quote : `${lo.quote} … ${hi.quote}`;
      derivation = `SD = √n × (upper − lower) / (2 × ${n >= 60 ? '1.96' : `t(0.975, ${n - 1}) = ${q.toFixed(4)}`}) = √${n} × (${hi.value} − ${lo.value}) / ${(2 * q).toFixed(4)}`;
    }
    out.push({ field: sd, value: round(value), quote: quote.slice(0, 400), derivation: `${derivation} (Cochrane Handbook 6.5.2.2)`, page: (se || lo).page });
  }
  return { values: out, unused };
}

/**
 * An SD computed by hand from what a paper reports for an arm mean (plan G6,
 * Cochrane Handbook 6.5.2.2): a standard error ("0.42", "SE 0.42"), or a 95%
 * CI of the mean ("1.2 to 3.4", "1.2–3.4", "−0.5, 2.1"), with the arm's n.
 * The same formulas as deriveSD; returns `{ value, derivation }`, or
 * `{ error }` naming what is missing. Pure.
 */
export function sdFrom(text, n) {
  const t = String(text ?? '').replace(/−/g, '-').trim();
  if (!(Number.isFinite(n) && n >= 2)) return { error: 'The arm needs its n (2 or more) first' };
  const N = '(-?\\d+(?:[.,]\\d+)?)';
  const ci = new RegExp(`^(?:95\\s*%?\\s*)?(?:ci\\s*)?\\(?${N}\\s*(?:to|–|—|,|;|\\s-\\s|-(?=\\d)|\\.\\.)\\s*${N}\\)?$`, 'i').exec(t);
  const se = new RegExp(`^(?:se(?:m)?\\s*[:=]?\\s*)?${N}$`, 'i').exec(t);
  const read = x => Number(x.replace(',', '.'));
  if (ci) {
    const [lo, hi] = [read(ci[1]), read(ci[2])];
    if (!(lo < hi)) return { error: 'The interval’s lower bound must be below its upper bound' };
    const q = n >= 60 ? 1.96 : tQuantile(0.975, n - 1);
    const value = Math.sqrt(n) * (hi - lo) / (2 * q);
    return { value, derivation: `SD = √n × (upper − lower) / (2 × ${n >= 60 ? '1.96' : `t(0.975, ${n - 1}) = ${q.toFixed(4)}`}) = √${n} × (${hi} − ${lo}) / ${(2 * q).toFixed(4)} (Cochrane Handbook 6.5.2.2)` };
  }
  if (se) {
    const x = read(se[1]);
    if (!(x > 0)) return { error: 'A standard error is above zero' };
    return { value: x * Math.sqrt(n), derivation: `SD = SE × √n = ${x} × √${n} (Cochrane Handbook 6.5.2.2)` };
  }
  return { error: 'Enter a standard error, or a 95% CI as lower to upper' };
}

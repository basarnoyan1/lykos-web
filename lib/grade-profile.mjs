// A full GRADE evidence profile (GRADE Handbook 5; GRADEpro's layout): per
// outcome, the number of studies and their design, the judgement on each of
// the five domains for rating down and the three for rating up, each with its
// footnote, the number of patients, the relative and absolute effects, the
// certainty and the importance. Footnotes are numbered in order of first use
// down the table, and identical text shares a number.
//
// The ratings are the reviewer's (lib/grade.mjs holds the vocabulary and the
// arithmetic). analysisFacts() lists what a linked pooled result says about
// inconsistency, imprecision and publication bias, as suggestions with their
// reasons — it never sets a rating (plan §1.3).
//
// dtaSummary() gives the per-1,000 consequences of a test's accuracy that a
// diagnostic Summary of findings reports.
import { certainty, DOWNGRADE, DOWNGRADE_RATINGS, UPGRADE, UPGRADE_RATINGS, explanationText } from './grade.mjs';
import { parseRisk, parseEffect, absoluteEffect, ABSOLUTE_MEASURES } from './grade-link.mjs';
import { noEffect, isRatio } from './effect-measures.mjs';

export const COLUMNS = [
  '№ of studies', 'Study design', 'Risk of bias', 'Inconsistency', 'Indirectness', 'Imprecision',
  'Publication bias', 'Other considerations', '№ of patients, intervention', '№ of patients, comparator',
  'Relative effect (95% CI)', 'Absolute effect (95% CI)', 'Certainty', 'Importance',
];
export const IMPORTANCE = ['Critical', 'Important', 'Not important'];
const DESIGN_TEXT = { rct: 'Randomised trials', observational: 'Observational studies' };
const SYMBOLS = { High: '⨁⨁⨁⨁', Moderate: '⨁⨁⨁◯', Low: '⨁⨁◯◯', 'Very low': '⨁◯◯◯' };
// GRADEpro's words for a rating up, in "Other considerations".
const UP_TEXT = { large: 'strong association', dose: 'dose–response gradient', confounding: 'plausible confounding would change the effect' };
const LEVEL_WORD = { serious: 'one level', veryserious: 'two levels', one: 'one level', two: 'two levels' };

const num = x => {
  const v = Number(x);
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v), s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace(/^-/, '−');
};

/** An effect as { measure, estimate, lo, hi } from an object or "RR 0.70 (0.53 to 0.92)"; null when unreadable. */
export function readEffect(e) {
  if (!e) return null;
  if (typeof e === 'string') {
    const p = parseEffect(e);
    if (p) return p;
    const m = /\b(MD|SMD)\s+(-?[\d.]+)\s*\(\s*(-?[\d.]+)\s*(?:to|,|–)\s*(-?[\d.]+)\s*\)/i.exec(e.replace(/−/g, '-'));
    return m ? { measure: m[1].toUpperCase(), estimate: Number(m[2]), lo: Number(m[3]), hi: Number(m[4]) } : null;
  }
  const out = { measure: String(e.measure || '').toUpperCase(), estimate: Number(e.estimate ?? e.est), lo: Number(e.lo), hi: Number(e.hi) };
  return out.measure && [out.estimate, out.lo, out.hi].every(Number.isFinite) ? out : null;
}
const effectText = e => `${e.measure} ${num(e.estimate)} (${num(e.lo)} to ${num(e.hi)})`;

/** Baseline risks as [{ label, risk }], from a number, text, or a list of either or of { label, risk }. */
function baselines(o) {
  const raw = o.baselineRisk ?? o.comparatorRisk;
  const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
  return list.map(x => {
    const label = typeof x === 'object' && x ? String(x.label || '') : '';
    const v = typeof x === 'object' && x ? x.risk : x;
    const risk = typeof v === 'number' ? (v >= 0 && v <= 1 ? v : null) : parseRisk(v);
    return { label, risk };
  }).filter(b => b.risk != null);
}

/**
 * The evidence profile for a list of GRADE outcome rows (the shape of
 * s.grade in lib/grade.mjs), each optionally with `effect` (object or text),
 * `baselineRisk`, `events: { intervention, comparator }` and `importance`.
 * Returns { columns, rows, footnotes, missing } — `missing` names the domains
 * rated down or up without a written explanation.
 */
export function evidenceProfile(outcomes = []) {
  const footnotes = [], missing = [];
  const note = text => {
    const t = String(text || '').trim();
    if (!t) return null;
    let i = footnotes.indexOf(t);
    if (i < 0) { footnotes.push(t); i = footnotes.length - 1; }
    return i + 1;
  };
  const rows = outcomes.map(o => {
    const r = o.ratings || {};
    const c = certainty(o);
    const domains = {};
    for (const d of DOWNGRADE) {
      const value = DOWNGRADE_RATINGS.some(x => x.value === r[d.id]) ? r[d.id] : 'none';
      const rating = DOWNGRADE_RATINGS.find(x => x.value === value);
      const written = explanationText(o.explanations?.[d.id]).trim();
      if (value !== 'none' && !written) missing.push({ outcome: o.name || '', domain: d.label });
      const text = written || (value !== 'none' ? `Rated down ${LEVEL_WORD[value]} for ${d.label.toLowerCase()}.` : '');
      domains[d.id] = { judgement: rating.label, value, note: note(text) };
    }
    const ups = [];
    for (const u of UPGRADE) {
      const value = UPGRADE_RATINGS.some(x => x.value === r[u.id]) ? r[u.id] : 'none';
      if (value === 'none') continue;
      const written = explanationText(o.explanations?.[u.id]).trim();
      if (!written) missing.push({ outcome: o.name || '', domain: u.label });
      ups.push({ id: u.id, value, text: UP_TEXT[u.id], counted: c.canUpgrade,
        note: note(written || `Rated up ${LEVEL_WORD[value]} for ${u.label.toLowerCase()}.`) });
    }
    const overrideNote = c.overridden ? note(o.overrideReason || 'Certainty set by the reviewer without a stated reason.') : null;
    const eff = readEffect(o.effect);
    let relative = '', absolute = '';
    if (eff && ABSOLUTE_MEASURES.includes(eff.measure) && eff.measure !== 'RD') {
      relative = effectText(eff);
      absolute = baselines(o).map(b => {
        const a = absoluteEffect(eff, b.risk);
        return a ? `${b.label ? `${b.label}: ` : ''}${a.difference}` : '';
      }).filter(Boolean).join('; ');
    } else if (eff) {
      // a difference has no relative effect; a risk difference reads per 1,000
      absolute = eff.measure === 'RD'
        ? (() => { const d = x => Math.round(x * 1000), w = x => (x === 0 ? '0 fewer' : x < 0 ? `${-x} fewer` : `${x} more`);
            return `${w(d(eff.estimate))} per 1,000 (from ${w(d(Math.min(eff.lo, eff.hi)))} to ${w(d(Math.max(eff.lo, eff.hi)))})`; })()
        : effectText(eff);
    } else if (typeof o.effect === 'string') relative = o.effect;
    const importance = IMPORTANCE.includes(o.importance) ? o.importance : '';
    return {
      outcome: o.name || '',
      studies: String(o.studies ?? ''),
      design: DESIGN_TEXT[o.design] || DESIGN_TEXT.observational,
      domains,
      other: ups.length ? ups.map(u => `${u.text}${u.counted ? '' : ' (not counted: already rated down)'}`).join('; ') : 'None',
      otherNotes: ups.map(u => u.note).filter(Boolean),
      patients: { intervention: String(o.events?.intervention ?? ''), comparator: String(o.events?.comparator ?? '') },
      relative, absolute,
      certainty: c.final, symbols: SYMBOLS[c.final] || '', overrideNote,
      importance,
    };
  });
  return { columns: COLUMNS, rows, footnotes, missing };
}

const marks = list => { const l = list.filter(Boolean); return l.length ? ` [${l.join(',')}]` : ''; };

/** One row's cells, in COLUMNS order, with footnote numbers in brackets. */
export function profileCells(r) {
  const dom = id => `${r.domains[id].judgement}${marks([r.domains[id].note])}`;
  return [
    r.studies, r.design, dom('rob'), dom('inconsistency'), dom('indirectness'), dom('imprecision'), dom('publication'),
    `${r.other}${marks(r.otherNotes)}`, r.patients.intervention, r.patients.comparator,
    r.relative, r.absolute, `${r.symbols} ${r.certainty}${marks([r.overrideNote])}`.trim(), r.importance,
  ];
}

/** Blocks for the Word writer: a title, the table with the outcome as its first column, and the numbered footnotes. */
export function toBlocks(profile, { title = 'GRADE evidence profile' } = {}) {
  let n = 0; const id = () => `ep${++n}`;
  return [
    { id: id(), type: 'title', text: title },
    { id: id(), type: 'table', header: true, rows: [['Outcome', ...profile.columns], ...profile.rows.map(r => [r.outcome, ...profileCells(r)])] },
    ...profile.footnotes.map((t, i) => ({ id: id(), type: 'p', text: `${i + 1}. ${t}` })),
  ];
}

const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The profile as CSV: a header, one line per outcome, then one line per footnote. */
export function toCsv(profile) {
  const lines = [['Outcome', ...profile.columns], ...profile.rows.map(r => [r.outcome, ...profileCells(r)])];
  if (profile.footnotes.length) lines.push([], ...profile.footnotes.map((t, i) => [`Footnote ${i + 1}`, t]));
  return lines.map(l => l.map(csvCell).join(',')).join('\n') + '\n';
}

// ---- diagnostic accuracy per 1,000 tested --------------------------------------------------------

const readProp = x => {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return x >= 0 && x <= 1 ? { estimate: x, lo: x, hi: x } : null;
  if (typeof x === 'object') {
    const e = Number(x.estimate ?? x.est), lo = Number(x.lo ?? e), hi = Number(x.hi ?? e);
    return [e, lo, hi].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? { estimate: e, lo: Math.min(lo, hi), hi: Math.max(lo, hi) } : null;
  }
  const r = parseRisk(x);
  return r == null ? null : { estimate: r, lo: r, hi: r };
};

/**
 * True and false positives and negatives per 1,000 people tested, at each
 * prevalence, with ranges from the confidence intervals of sensitivity and
 * specificity: TP = sens · p, FN = (1 − sens) · p, TN = spec · (1 − p),
 * FP = (1 − spec) · (1 − p), each × 1,000 and rounded.
 */
export function dtaSummary({ sensitivity, specificity, prevalences = [] } = {}) {
  const se = readProp(sensitivity), sp = readProp(specificity);
  if (!se || !sp) return [];
  const r = x => Math.round(x * 1000);
  return prevalences.map(readProp).filter(Boolean).map(({ estimate: p }) => {
    const tp = { value: r(se.estimate * p), lo: r(se.lo * p), hi: r(se.hi * p) };
    const fn = { value: r((1 - se.estimate) * p), lo: r((1 - se.hi) * p), hi: r((1 - se.lo) * p) };
    const tn = { value: r(sp.estimate * (1 - p)), lo: r(sp.lo * (1 - p)), hi: r(sp.hi * (1 - p)) };
    const fp = { value: r((1 - sp.estimate) * (1 - p)), lo: r((1 - sp.hi) * (1 - p)), hi: r((1 - sp.lo) * (1 - p)) };
    const t = x => (x.lo === x.hi ? `${x.value}` : `${x.value} (${x.lo} to ${x.hi})`);
    return { prevalence: p, perThousand: r(p), tp, fn, tn, fp,
      text: { tp: t(tp), fn: t(fn), tn: t(tn), fp: t(fp) } };
  });
}

// ---- facts from a linked analysis, as suggestions ---------------------------------------------------

/** The standard normal quantile (Acklam's rational approximation, relative error below 1.2e-9). */
export function qnorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) return -qnorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The optimal information size: the total sample a single adequately
 * powered trial would need. Binary: { controlRisk, rrr } — the relative risk
 * reduction to detect; continuous: { sd, delta }. alpha 0.05 two-sided and
 * power 0.8 unless given. Returns { total, perGroup, calculation }.
 */
export function optimalInformationSize({ controlRisk, rrr, sd, delta, alpha = 0.05, power = 0.8 } = {}) {
  const za = qnorm(1 - alpha / 2), zb = qnorm(power), z2 = (za + zb) ** 2;
  const f = x => Number(x.toFixed(3));
  if (controlRisk > 0 && controlRisk < 1 && rrr > 0 && rrr < 1) {
    const p1 = controlRisk, p2 = controlRisk * (1 - rrr);
    const perGroup = Math.ceil(z2 * (p1 * (1 - p1) + p2 * (1 - p2)) / (p1 - p2) ** 2);
    return { total: 2 * perGroup, perGroup,
      calculation: `n per group = (${f(za)} + ${f(zb)})² × [${f(p1)} × ${f(1 - p1)} + ${f(p2)} × ${f(1 - p2)}] / (${f(p1)} − ${f(p2)})² = ${perGroup}; total ${2 * perGroup} (α ${alpha} two-sided, power ${power}, relative risk reduction ${rrr})` };
  }
  if (sd > 0 && delta > 0) {
    const perGroup = Math.ceil(2 * z2 * sd ** 2 / delta ** 2);
    return { total: 2 * perGroup, perGroup,
      calculation: `n per group = 2 × (${f(za)} + ${f(zb)})² × ${sd}² / ${delta}² = ${perGroup}; total ${2 * perGroup} (α ${alpha} two-sided, power ${power})` };
  }
  return null;
}

const crosses = (lo, hi, v) => Number.isFinite(lo) && Number.isFinite(hi) && Number.isFinite(v) && Math.min(lo, hi) < v && v < Math.max(lo, hi);
const pText = p => (p < 0.001 ? '< 0.001' : `= ${Number(p).toFixed(3)}`);
const suggestion = (signals, domain) => signals.length
  ? `Consider whether to rate down for ${domain}: ${signals.join('; ')}.`
  : `Nothing in the pooled result points to rating down for ${domain}; the judgement is the reviewer's.`;

/**
 * What a saved pooled result (`a`: estimate, lo, hi, measure, k, i2, tau2,
 * pi_lo, pi_hi, participants, extras.bias.tests) says for three GRADE domains.
 * options: threshold — a decision threshold on the effect scale (a number,
 * or [low, high]); ois — optimalInformationSize() inputs; participants.
 * Returns { inconsistency, imprecision, publication }, each
 * { facts: [[label, text]], signals: [text], suggestion }. None of it is a rating.
 */
export function analysisFacts(a, { threshold, ois, participants } = {}) {
  if (!a) return null;
  const nullValue = a.measure ? noEffect(a.measure) : null;
  const k = Number(a.k), lo = Number(a.lo), hi = Number(a.hi);
  const thresholds = (Array.isArray(threshold) ? threshold : threshold == null ? [] : [threshold]).map(Number).filter(Number.isFinite);

  // inconsistency
  const inc = { facts: [], signals: [] };
  if (Number.isFinite(Number(a.i2)) && a.i2 != null) {
    inc.facts.push(['I²', `${Number(a.i2).toFixed(1)}%`]);
    if (Number(a.i2) >= 50) inc.signals.push(`I² is ${Number(a.i2).toFixed(0)}% (Cochrane Handbook bands: 50–90% may be substantial, 75–100% considerable)`);
  }
  if (Number.isFinite(Number(a.tau2)) && a.tau2 != null) inc.facts.push(['τ²', Number(a.tau2).toFixed(4)]);
  if (Number.isFinite(Number(a.qp)) && a.qp != null) inc.facts.push(['Q test', `p ${pText(Number(a.qp))}`]);
  const plo = Number(a.pi_lo), phi = Number(a.pi_hi);
  if (a.pi_lo != null && a.pi_hi != null && Number.isFinite(plo) && Number.isFinite(phi)) {
    inc.facts.push(['95% prediction interval', `${num(plo)} to ${num(phi)}`]);
    if (nullValue != null && crosses(plo, phi, nullValue) && !crosses(lo, hi, nullValue)) inc.signals.push('the prediction interval crosses the null although the confidence interval does not');
    for (const t of thresholds) if (crosses(plo, phi, t)) inc.signals.push(`the prediction interval crosses the threshold ${num(t)}`);
  }
  inc.suggestion = suggestion(inc.signals, 'inconsistency');

  // imprecision
  const imp = { facts: [], signals: [] };
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    imp.facts.push(['95% confidence interval', `${a.measure || ''} ${num(lo)} to ${num(hi)}`.trim()]);
    if (nullValue != null && crosses(lo, hi, nullValue)) imp.signals.push(`the confidence interval includes no effect (${nullValue})`);
    for (const t of thresholds) if (crosses(lo, hi, t)) imp.signals.push(`the confidence interval crosses the threshold ${num(t)}`);
  }
  const n = Number(participants ?? a.participants);
  const size = ois ? optimalInformationSize(ois) : null;
  if (size) {
    imp.facts.push(['Optimal information size', size.calculation]);
    if (Number.isFinite(n) && n > 0) {
      imp.facts.push(['Participants', String(n)]);
      if (n < size.total) imp.signals.push(`${n} participants is fewer than the optimal information size of ${size.total}`);
    }
  }
  imp.suggestion = suggestion(imp.signals, 'imprecision');

  // publication bias
  const pub = { facts: [], signals: [] };
  if (Number.isFinite(k) && k < 10) pub.facts.push(['Funnel plot asymmetry', `Not tested: ${k} studies; tests need at least 10 to have useful power`]);
  else {
    const egger = (a.extras?.bias?.tests || []).find(t => /^egger/i.test(String(t.name)) && Number.isFinite(Number(t.p)));
    if (egger) {
      pub.facts.push(["Egger's test", `p ${pText(Number(egger.p))} (${k} studies)`]);
      if (Number(egger.p) < 0.1) pub.signals.push(`Egger's test p ${pText(Number(egger.p))} suggests small-study effects, which publication bias is one explanation of`);
    } else pub.facts.push(["Egger's test", 'Not run for this result']);
  }
  pub.suggestion = suggestion(pub.signals, 'publication bias');

  return { inconsistency: inc, imprecision: imp, publication: pub, ratio: a.measure ? isRatio(a.measure) : null };
}

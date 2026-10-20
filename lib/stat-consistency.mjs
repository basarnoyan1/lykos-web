// Statistical-reporting consistency over running text (RESEARCH-GAPS R5, plan §2 "numbers a reader can check").
//
// Pure functions: no model, no network. Three readings, each of which stays silent unless the
// pattern is matched in full and unambiguous (a missed finding costs less than a false one):
//
//   (a) a test statistic with its degrees of freedom and a reported P ("t(28) = 2.20, p = .04",
//       "F(2, 45) = 3.10, p = .05", "χ²(3) = 7.8, p = .05", "r(28) = .45, p = .01", "z = 2.1, p = .04"):
//       P is recomputed with the distribution functions of lib/dist.mjs (two-sided; halved if the
//       sentence says one-sided or one-tailed). The reported P is inconsistent when no value inside
//       the rounding interval of the test statistic gives a P that rounds to the reported one, and
//       the inconsistency is a decision error when significance at .05 flips.
//   (b) "estimate (95% CI lo–hi), P" for ratios (OR, RR, HR, …) and differences: the P implied by the
//       interval (normal approximation, on the log scale for ratios) against the reported P, and an
//       interval that does not contain its estimate.
//   (c) "12 of 40 (30%)", "12/40 (30%)", "30% (12/40)": the percentage recomputed from the stated
//       denominator, with rounding (or truncation) tolerance.
//
// Findings are { kind, severity: 'warn', sentence, text, at, recomputed, message }. `text` is the
// matched span and `at` its offset in the input, so a view can select it.
import { pnorm, qnorm, pt, pchisq, pbeta } from './dist.mjs';

const ALPHA = 0.05;
const EPS = 1e-12;
const NUM = String.raw`[−-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const toNum = s => Number(String(s).replace('−', '-'));
const decimals = s => (String(s).split('.')[1] || '').length;
const half = s => 0.5 * 10 ** -decimals(s);

// ---- reported P --------------------------------------------------------------------------------
const P_TAIL = String.raw`[pP]\s*(?:-?\s*value)?\s*(<=|>=|≤|≥|=|<|>)\s*(0?\.\d+|[01](?:\.0+)?)(?!\d|\.\d|[eE])`;
const OP = { '<=': '≤', '>=': '≥' };
const reportedP = (op, text) => ({ op: OP[op] || op, value: Number(text), text, half: half(text) });

/** Whether some P in [lo, hi] is what the reported P says (rounding of the reported value included). */
function fits(rep, [lo, hi]) {
  const { op, value, half: h } = rep;
  switch (op) {
    case '=': return lo <= value + h + EPS && hi >= value - h - EPS;
    case '<': return lo < value;
    case '≤': return lo <= value + EPS;
    case '>': return hi > value;
    case '≥': return hi >= value - EPS;
    default: return true;
  }
}

/** Whether the reported P claims significance at ALPHA: true, false, or null when it does not say. */
function claimsSignificant({ op, value }) {
  if (op === '=') return value < ALPHA;
  if (op === '<' || op === '≤') return value <= ALPHA ? true : null;
  return value >= ALPHA ? false : null;
}
const isSignificant = ([lo, hi]) => (hi < ALPHA ? true : lo >= ALPHA ? false : null);

const span2 = (lo, hi) => (/[−-]/.test(lo + hi) ? `${lo} to ${hi}` : `${lo}–${hi}`);
const repLabel = rep => `P ${rep.op} ${rep.text}`;
const fmtP = p => (p < 1e-4 ? 'P < 0.0001' : p < 0.01 ? `P = ${p.toFixed(4)}` : `P = ${p.toFixed(3)}`);
const fmtNum = x => String(Number(x.toPrecision(4)));

// ---- sentences ---------------------------------------------------------------------------------
const ABBREV_BEFORE = /(?:\b(?:et al|vs|Fig|Figs|Eq|e\.g|i\.e|approx|ca|No|Dr|cf)|\b[A-Z])$/;

/** [{ start, end }] of each sentence; a full stop after a known abbreviation or a single capital does not end one. */
function sentenceSpans(text) {
  const spans = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?]+\s+(?=[A-Z(\[“"‘'0-9])/g)) {
    if (ABBREV_BEFORE.test(text.slice(Math.max(0, m.index - 8), m.index))) continue;
    spans.push({ start, end: m.index + m[0].length });
    start = m.index + m[0].length;
  }
  spans.push({ start, end: text.length });
  return spans;
}

// ---- (a) test statistics -----------------------------------------------------------------------
// p(x, args) is the two-sided P at |statistic| = x; it never increases with x.
const TESTS = [
  { name: 't', head: String.raw`(?<![A-Za-z])t\s*\(\s*(\d+(?:\.\d+)?)\s*\)`, label: (a, s) => `t(${a[0]}) = ${s}`,
    valid: a => a[0] > 0, p: (x, [df]) => 2 * pt(-x, df) },
  { name: 'F', head: String.raw`(?<![A-Za-z])F\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)`, label: (a, s) => `F(${a[0]}, ${a[1]}) = ${s}`,
    valid: a => a[0] > 0 && a[1] > 0, nonNegative: true, p: (x, [d1, d2]) => pbeta(d2 / (d2 + d1 * x), d2 / 2, d1 / 2) },
  { name: 'χ²', head: String.raw`(?:χ\s*[²2]|χ\^2|X\s*[²2]|[Cc]hi[\s-]?(?:square[d]?|2))\s*\(\s*(\d+)(?:\s*,\s*[Nn]\s*=\s*[\d,]+)?\s*\)`, label: (a, s) => `χ²(${a[0]}) = ${s}`,
    valid: a => a[0] > 0, nonNegative: true, p: (x, [df]) => 1 - pchisq(x, df) },
  { name: 'r', head: String.raw`(?<![A-Za-z])r\s*\(\s*(\d+)\s*\)`, label: (a, s) => `r(${a[0]}) = ${s}`,
    valid: a => a[0] > 0, correlation: true, p: (x, [df]) => (x >= 1 ? 0 : 2 * pt(-x * Math.sqrt(df / (1 - x * x)), df)) },
  { name: 'z', head: String.raw`(?<![A-Za-z])[zZ]`, label: (a, s) => `z = ${s}`, valid: () => true, p: x => 2 * pnorm(-x) },
].map(t => ({ ...t, re: new RegExp(`${t.head}\\s*=\\s*(${NUM})\\s*[,;(]?\\s*${P_TAIL}`, 'g') }));

const ONE_SIDED = /\b(?:one|1)[\s-]*(?:sided|tailed|tail)\b/i;

function testFindings(text, sentences) {
  const out = [];
  for (const t of TESTS) {
    for (const m of text.matchAll(t.re)) {
      const nArgs = t.name === 'F' ? 2 : t.name === 'z' ? 0 : 1;
      const args = m.slice(1, 1 + nArgs).map(Number);
      const statText = m[1 + nArgs], stat = toNum(statText);
      const rep = reportedP(m[2 + nArgs], m[3 + nArgs]);
      if (!Number.isFinite(stat) || !t.valid(args) || (t.nonNegative && stat < 0)) continue;
      if (t.correlation && Math.abs(stat) > 1) continue;
      const x = Math.abs(stat), h = half(statText);
      const range = k => [t.p(x + h, args) * k, Math.min(1, t.p(Math.max(0, x - h), args) * k)];
      const point = k => Math.min(1, t.p(x, args) * k);
      const sentence = sentences.find(s => m.index >= s.start && m.index < s.end);
      const one = ONE_SIDED.test(text.slice(sentence.start, sentence.end));
      if (!(range(1)[0] >= 0) || Number.isNaN(point(1))) continue;
      if (fits(rep, range(1)) || (one && fits(rep, range(0.5)))) continue;
      const used = one ? 0.5 : 1;
      const decision = claimsSignificant(rep), actual = isSignificant(range(used));
      const flips = decision !== null && actual !== null && decision !== actual;
      const p = point(used);
      const span = m[0].replace(/\s*[,;(]?\s*$/, '');
      out.push({
        kind: flips ? 'decision' : 'p-value', severity: 'warn',
        sentence: text.slice(sentence.start, sentence.end).trim(), text: span, at: m.index,
        recomputed: { test: t.name, df: args, statistic: stat, p, pRange: range(used), oneSided: one, reported: { op: rep.op, value: rep.value } },
        message: `${t.label(args, statText)}, ${repLabel(rep)}: recomputed ${fmtP(p)}${flips ? `, which changes significance at ${String(ALPHA).replace(/^0/, '')}` : ''}`,
      });
    }
  }
  return out;
}

// ---- (b) estimate, interval, P -----------------------------------------------------------------
const RATIO = String.raw`(?<![A-Za-z])(?:aOR|aHR|aRR|OR|RR|HR|IRR|RRR|(?:[Oo]dds|[Rr]isk|[Hh]azard|[Rr]ate)\s+ratio)`;
const DIFF = String.raw`(?<![A-Za-z])(?:SMD|MD|RD|(?:(?:[Mm]ean|[Rr]isk|[Mm]edian|[Ss]tandardi[sz]ed mean)\s+)?[Dd]ifference|β|[Bb]eta)`;
const CI_BODY = String.raw`\s*(?:[:=,]|of|was|were|is)?\s*(${NUM})\s*[(\[,]\s*(?:(\d{2}(?:\.\d)?)\s*%\s*)?(?:CI|confidence interval)\s*[:=,]?\s*(?:of\s+)?(${NUM})\s*(?:to|[–—-]|,|;)\s*(${NUM})`;
const CI_RE = [
  { ratio: true, re: new RegExp(`(${RATIO})${CI_BODY}(?:[)\\]]?\\s*[,;(]?\\s*${P_TAIL})?`, 'g') },
  { ratio: false, re: new RegExp(`(${DIFF})${CI_BODY}(?:[)\\]]?\\s*[,;(]?\\s*${P_TAIL})?`, 'g') },
];

function ciFindings(text, sentences) {
  const out = [];
  for (const { ratio, re } of CI_RE) {
    for (const m of text.matchAll(re)) {
      const [, label, estT, levelT, loT, hiT, op, pText] = m;
      const est = toNum(estT), lo = toNum(loT), hi = toNum(hiT);
      const he = half(estT), hl = half(loT), hh = half(hiT);
      if (!(lo < hi)) continue;
      if (ratio && !(est > 0 && lo > 0 && hi > 0)) continue;
      const sentence = sentences.find(s => m.index >= s.start && m.index < s.end);
      const base = { severity: 'warn', sentence: text.slice(sentence.start, sentence.end).trim(), at: m.index };
      const span = m[0].replace(/\s*[,;(]?\s*$/, '');
      // an interval that does not contain its estimate, beyond what rounding explains
      if (est < lo - he - hl - EPS || est > hi + he + hh + EPS) {
        out.push({ ...base, kind: 'ci-estimate', text: span, recomputed: { estimate: est, lo, hi },
          message: `${label} ${estT} is outside its interval ${span2(loT, hiT)}` });
        continue;
      }
      if (!op) continue;
      const rep = reportedP(op, pText);
      const level = levelT ? Number(levelT) / 100 : 0.95;
      if (!(level > 0.5 && level < 1)) continue;
      const zc = qnorm(1 - (1 - level) / 2);
      const g = ratio ? v => Math.log(Math.max(v, 1e-300)) : v => v;
      const zs = [];
      for (const de of [-he, he]) for (const dl of [-hl, hl]) for (const dh of [-hh, hh]) {
        const e = est + de, l = lo + dl, u = hi + dh;
        if (ratio && !(e > 0 && l > 0 && u > 0)) continue;
        const se = (g(u) - g(l)) / (2 * zc);
        if (se > 0) zs.push(Math.abs(g(e)) / se);
      }
      if (!zs.length) continue;
      // The interval may come from a t distribution; allow a margin of 0.1 on the z scale.
      const zLow = Math.max(0, Math.min(...zs) - 0.1), zHigh = Math.max(...zs) + 0.1;
      const range = [2 * pnorm(-zHigh), 2 * pnorm(-zLow)];
      if (fits(rep, range)) continue;
      const mid = 2 * pnorm(-Math.abs(g(est)) / ((g(hi) - g(lo)) / (2 * zc)));
      out.push({ ...base, kind: 'ci-p', text: span, recomputed: { p: mid, pRange: range, level, reported: { op: rep.op, value: rep.value } },
        message: `${label} ${estT} (${span2(loT, hiT)}), ${repLabel(rep)}: the interval implies ${fmtP(mid)}` });
    }
  }
  return out;
}

// ---- (c) counts and percentages ----------------------------------------------------------------
const COUNT = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
const FRACTION = String.raw`(${COUNT})\s*(?:of|out of|/)\s*(${COUNT})`;
const PERCENT_RES = [
  { re: new RegExp(String.raw`(?<![\d.,/])${FRACTION}\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)`, 'g'), order: ['n', 'N', 'pct'] },
  { re: new RegExp(String.raw`(?<![\d.,])(\d+(?:\.\d+)?)\s*%\s*\(\s*(?:n\s*=\s*)?${FRACTION}\s*\)`, 'g'), order: ['pct', 'n', 'N'] },
];

function percentFindings(text, sentences) {
  const out = [];
  for (const { re, order } of PERCENT_RES) {
    for (const m of text.matchAll(re)) {
      const v = {};
      order.forEach((k, i) => { v[k] = m[1 + i]; });
      const n = Number(v.n.replace(/,/g, '')), N = Number(v.N.replace(/,/g, '')), pct = Number(v.pct);
      if (!(N > 0) || n > N) continue;
      const exact = 100 * n / N, unit = 10 ** -decimals(v.pct);
      const rounded = Math.abs(exact - pct) <= unit / 2 + EPS;
      const truncated = exact - pct >= -EPS && exact - pct < unit + EPS;
      if (rounded || truncated) continue;
      const sentence = sentences.find(s => m.index >= s.start && m.index < s.end);
      out.push({ kind: 'percentage', severity: 'warn', sentence: text.slice(sentence.start, sentence.end).trim(), text: m[0], at: m.index,
        recomputed: { n, N, percent: exact, reported: pct },
        message: `${m[0]}: ${v.n} of ${v.N} is ${fmtNum(exact)}%` });
    }
  }
  return out;
}

/**
 * Findings in one text, in order of position. Silent on anything it cannot read in full.
 * @returns {{kind: 'p-value'|'decision'|'ci-p'|'ci-estimate'|'percentage', severity: 'warn', sentence: string, text: string, at: number, recomputed: object, message: string}[]}
 */
export function statFindings(text) {
  const t = String(text || '');
  if (!/[=%]/.test(t)) return [];
  const sentences = sentenceSpans(t);
  return [...testFindings(t, sentences), ...ciFindings(t, sentences), ...percentFindings(t, sentences)].sort((a, b) => a.at - b.at);
}

/** The two-sided P of a test statistic, as this module recomputes it: { test: 't'|'F'|'χ²'|'r'|'z', statistic, df }. */
export function recomputeP({ test, statistic, df = [] }) {
  const t = TESTS.find(x => x.name === test);
  if (!t) return NaN;
  const d = [].concat(df).map(Number);
  return t.p(Math.abs(statistic), d);
}

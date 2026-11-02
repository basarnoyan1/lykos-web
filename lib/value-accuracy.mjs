// Accuracy of extracted values (2026-10-25): what makes a value settled, so a second reading of a paper never reopens what is already proven.
// A value is settled when it is unchanged since its check and either agrees with a quote found verbatim in the full text, or was decided by a
// reviewer (`settled`: kept under a convention, derived, confirmed) with the reason recorded. A later check cannot reopen a settled value on
// its own word: a disagreement is kept beside it as a challenge only when its quote is in the text, and dropped otherwise. Beside that, the
// mechanical checks a model cannot be trusted with: counts against their percentages and denominators, ranges and intervals against their
// estimates, numbers that are not in the paper (derived or misread), values read off a figure. The two readings of a table (text layer and
// page image) are compared cell by cell. Nothing here changes a value: every finding is settled in Extraction or by `lykos verify settle`.

import { parseCountText } from './count-text.mjs';
import { ocrPageOf } from './quotes.mjs';

const normAlnum = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** True when a quote is in the text word for word (case, spacing, punctuation and line breaks aside; "…" or "..." may join pieces). */
export function quoteFound(quote, text, hay = normAlnum(text)) {
  const q = String(quote || '').trim();
  if (!q) return false;
  const whole = normAlnum(q);
  if (whole && hay.includes(whole)) return true;
  if (!/\.\.\.|…|\[[^\]]*\]/.test(q)) return false;
  const parts = q.split(/\.\.\.|…|\[[^\]]*\]/).map(normAlnum).filter(p => p.length >= 5);
  return parts.some(p => p.length >= 12) && parts.every(p => hay.includes(p));
}

/** The page read by text recognition a quote is on (its page in the text, else `given`), or null (tools/fulltext.mjs ocrPagesOf). */
export const ocrQuotePage = (quote, text, ocrPages, given = null) => ocrPageOf(quote, text, ocrPages, given, (q, page) => quoteFound(q, page));

/** A fingerprint of a full text (words and numbers only), so a proof made against one text is checked again when the text changes. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (const ch of normAlnum(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// the constants a derivation may use without finding them in the paper: unit conversions and percentages
const CONSTANTS = new Set(['1', '2', '10', '12', '24', '52', '60', '100', '365', '365.25', '1000', '30.44', '30.4', '2.54']);
const roundTo = (x, d) => Number((Math.round(x * 10 ** d + 1e-9 * Math.sign(x)) / 10 ** d).toFixed(d));
/**
 * A derivation checked by arithmetic, never by a model. `how` is one step or several (";" or a new line between them); a step is an
 * expression and the numbers it gives, each joined by "=" or "→": "6.1 × 12 = 73.2", "3.49 × 12 = 41.88 → 41.9", "63.65 → 63.7",
 * "round(43.41, 1) = 43.4", "2.38 cm × 10 = 23.8 mm" (unit words are ignored). Only + − × ÷, brackets and round(x[, d]); every number of an
 * expression must be in the paper, a unit constant, or given by an earlier step; each number after "=" or "→" must be the one before it
 * rounded to its decimals. Answers { ok, gives: [numbers the steps prove] } or { problem }.
 */
export function checkDerivation(how, value, text, paperNumbers = numbersOf(text)) {
  const steps = String(how || '').split(/[;\n]+/).map(x => x.trim()).filter(Boolean), gives = [];
  if (!steps.length) return { problem: 'no derivation' };
  for (const step of steps) {
    const parts = step.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\b(?!round\b)[A-Za-zµ°]+\b|[°%]/g, ' ').split(/=|→|->/).map(x => x.trim());
    const expr = parts[0], claims = parts.slice(1);
    if (!expr || !/^[\d.\s+\-*/(),]*$/.test(expr.replace(/round/g, ''))) return { problem: `"${step}" is not arithmetic of numbers (+ − × ÷, brackets, round)` };
    const absent = [...expr.replace(/round/g, '').matchAll(/\d+(?:\.\d+)?/g)].map(m => String(Number(m[0]))).filter(n => !CONSTANTS.has(n) && !paperNumbers.has(n) && !gives.includes(n));
    // a rounding precision written as round(x, d) is not a number of the paper
    const precisions = [...expr.matchAll(/round\([^,()]+,\s*(\d+)\s*\)/g)].map(m => m[1]);
    const missing = absent.filter(n => !precisions.includes(n));
    if (missing.length) return { problem: `${missing.join(', ')} in "${step}" not in the paper` };
    if (claims.some(c => !/^-?\d+(?:\.\d+)?$/.test(c))) return { problem: `"${step}": only a number may follow "=" or "→"` };
    let x;
    try { x = Function('round', `"use strict"; return (${expr});`)((v, d) => (d == null ? (claims[0] != null ? roundTo(v, decimals(claims[0])) : v) : roundTo(v, d))); } catch { return { problem: `"${step}" does not evaluate` }; }
    if (!Number.isFinite(x)) return { problem: `"${step}" is not a number` };
    for (const c of claims) {
      if (Math.abs(roundTo(x, decimals(c)) - Number(c)) > 1e-9) return { problem: `"${step}": ${+x.toFixed(6)} does not give ${c}` };
      x = Number(c); gives.push(String(Number(c)));
    }
    if (!claims.length) gives.push(String(x));
  }
  return { ok: true, gives };
}

/** What a settled value rests on: "quote" (found in the text), "derivation" (arithmetic checked), "decision" (a reviewer's judgement: an axiom), "nr". */
export function proofOf(field, value) {
  if (field?.settled) return field.settled.decision === 'derived' ? 'derivation' : field.settled.found ? 'quote' : 'decision';
  if (field?.verdict === 'not-in-paper' && NR.test(value)) return 'nr';
  return 'quote';
}

const NR = /^(NR|NA|not reported|not applicable)\b/i;
/**
 * The state of one value: "settled" (proven by a found quote or a recorded decision), "challenged" (settled, and a later check disputes it with
 * a quote found in the text), "needs-quote" (agreed, but the quote is missing or not in the text), "open" (disagreement or not in the paper,
 * not yet decided), "stale" (changed since its check), "unchecked".
 */
export function valueState(field, value, hash = null) {
  if (!field) return 'unchecked';
  if (field.recorded !== value) return 'stale';
  if (hash && field.settled?.textHash && field.settled.textHash !== hash) return 'stale';   // the full text changed since the decision
  if (field.settled) return field.challenge ? 'challenged' : 'settled';
  if (field.verdict === 'agree') return field.quote && field.found !== false ? (field.challenge ? 'challenged' : 'settled') : 'needs-quote';
  if (field.verdict === 'not-in-paper' && NR.test(value)) return 'settled';
  return 'open';
}

/**
 * A new check merged into the last one: a settled value stays as it was (a disagreement with a found quote is kept beside it as `challenge`, one
 * without is dropped and counted); everything else takes the new check. Answers { fields, kept, challenged, dropped }.
 */
export function mergeCheck(prevFields = {}, nextFields = {}, values = [], text = '') {
  const hay = normAlnum(text), fields = {}, out = { kept: 0, challenged: 0, dropped: 0 };
  for (const v of values) {
    const p = prevFields[v.key], n = nextFields[v.key];
    const st = valueState(p, v.value);
    if (st === 'settled' || st === 'challenged') {
      fields[v.key] = { ...p };
      if (n && n.verdict !== 'agree' && n.verdict !== p.verdict) {
        if (n.quote && quoteFound(n.quote, text, hay)) { fields[v.key].challenge = { verdict: n.verdict, ...(n.correct ? { correct: n.correct } : {}), why: n.why || '', quote: n.quote, ...(n.page != null ? { page: n.page } : {}), by: n.by || '', at: n.at || '' }; out.challenged++; }
        else out.dropped++;
      }
      out.kept++;
    } else if (n) fields[v.key] = { ...n, ...(n.quote ? { found: quoteFound(n.quote, text, hay) } : {}) };
    else if (p) fields[v.key] = p;
  }
  return { fields, ...out };
}

const DECISIONS = new Set(['confirmed', 'kept', 'derived', 'not-in-paper', 'figure']);
/**
 * A reviewer's decision on a value, checked before it is recorded: `confirmed` and `figure` need a quote found in the text; `kept` (under the
 * table's conventions), `derived` (arithmetic from reported values, given in `how`) and `not-in-paper` need the reason. Answers { field } or { problem }.
 */
export function settleField(prev, value, d, text, by, at = new Date().toISOString()) {
  const decision = String(d?.decision || '').trim().toLowerCase();
  if (!DECISIONS.has(decision)) return { problem: `decision "${d?.decision}" (use ${[...DECISIONS].join(', ')})` };
  if (d.value != null && String(d.value) !== value) return { problem: `the value is now ${JSON.stringify(value)}, not ${JSON.stringify(String(d.value))}` };
  const why = String(d.why || '').trim();
  if (!why) return { problem: 'no reason' };
  if (decision === 'derived') {
    if (!String(d.how || '').trim()) return { problem: 'derived needs "how" (the arithmetic from the reported values)' };
    const nums = numbersOf(text), c = checkDerivation(d.how, value, text, nums);
    if (c.problem) return { problem: `the derivation fails: ${c.problem}` };
    const given = c.gives.map(g => String(Math.abs(Number(g))));   // a value's numbers are read without their sign: −6.6 is given by "27.2 − 33.8 = −6.6"
    const left = numbersNotInPaper(value, nums).filter(m => !given.includes(String(Number(m.replace(',', '.')))));
    if (left.length) return { problem: `the derivation does not give ${left.join(', ')}` };
  }
  const quote = String(d.quote || '').trim(), found = quote ? quoteFound(quote, text) : false;
  if ((decision === 'confirmed' || decision === 'figure') && !found) return { problem: quote ? 'the quote is not in the full text' : 'no quote' };
  if (quote && !found) return { problem: 'the quote is not in the full text' };
  const base = prev && prev.recorded === value ? { ...prev } : { verdict: decision === 'not-in-paper' ? 'not-in-paper' : 'agree', recorded: value };
  delete base.challenge;
  return { field: { ...base, settled: { decision, why: why.slice(0, 600), ...(d.how ? { how: String(d.how).slice(0, 300) } : {}), ...(d.rule ? { rule: String(d.rule).slice(0, 200) } : {}), ...(quote ? { quote: quote.slice(0, 1200), found } : {}), ...(d.page != null ? { page: d.page } : {}), ...(text ? { textHash: fingerprint(text) } : {}), by, at } } };
}

// ---- mechanical checks of one value ----------------------------------------------------------------------------------------------------

const num = t => Number(String(t).replace(/[−–]/g, '-').replace(',', '.'));
const decimals = t => (String(t).split(/[.,]/)[1] || '').length;
/** True when some count k of n gives the percentage p as written (rounded to its decimals). */
export function percentFits(p, n, places = decimals(p)) {
  const P = num(p), f = 10 ** places;
  if (!(n > 0) || !Number.isFinite(P)) return true;
  for (let k = 0; k <= n; k++) {
    const x = (100 * k) / n;
    if (Math.abs(Math.round(x * f + 1e-9) / f - P) < 1e-9) return true;
  }
  return false;
}

/** The arm size a value belongs to, from the arm label ("Arm 1 (n=32)") or the Arm (n) value. */
export const armSize = label => { const m = String(label || '').match(/\bn\s*=\s*(\d+)/i); return m ? Number(m[1]) : null; };

/**
 * The checks of one value that need no reading: [{ kind, level: "error"|"check", text }]. `n` the arm size when known. A count with its
 * percentage that do not match, a count above its denominator, a percentage that no count of the arm gives, an estimate outside its range
 * or interval.
 */
export function valueChecks(value, { n = null, paper = false } = {}) {
  const v = String(value || ''), out = [], used = [];
  for (const m of v.matchAll(/(\d+)\s*\/\s*(\d+)\s*\(\s*[≤≥<>]?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/g)) {
    const [k, N, p] = [Number(m[1]), Number(m[2]), m[3]];
    used.push([m.index, m.index + m[0].length]);
    if (k > N) out.push({ kind: 'count', level: 'error', text: `${m[0]}: the count is larger than its denominator` });
    else if (Math.abs((100 * k) / N - num(p)) > 0.5 * 10 ** -decimals(p) + 0.051) out.push({ kind: 'percent', level: 'error', text: `${m[0]}: ${k}/${N} is ${((100 * k) / N).toFixed(1)}%` });
  }
  // the reverse order a table often prints, "15.4% (1/26)": the same comparison
  for (const m of v.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/g)) {
    const [p, k, N] = [m[1], Number(m[2]), Number(m[3])];
    used.push([m.index, m.index + m[0].length]);
    if (k > N) out.push({ kind: 'count', level: 'error', text: `${m[0]}: the count is larger than its denominator` });
    else if (N > 0 && Math.abs((100 * k) / N - num(p)) > 0.5 * 10 ** -decimals(p) + 0.051) out.push({ kind: 'percent', level: 'error', text: `${m[0]}: ${k}/${N} is ${((100 * k) / N).toFixed(1)}%` });
  }
  // in a paper's text layer a slash joins anything (DOIs, dates, table columns): only the value's own counts are compared
  if (!paper) for (const m of v.matchAll(/(?<![\d/])(\d+)\s*\/\s*(\d+)(?![\d/])/g)) if (Number(m[1]) > Number(m[2]) && !used.some(([a, b]) => m.index >= a && m.index < b)) out.push({ kind: 'count', level: 'error', text: `${m[0]}: the count is larger than its denominator` });
  if (n && !/\b(whole|entire|overall|total) (cohort|series|sample|population)\b/i.test(v)) for (const m of v.matchAll(/(?<![\d.,/])(\d+(?:[.,]\d+)?)\s*%\s*(female|male|women|men|of patients)?/gi)) {
    if (used.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (/^(female|male|women|men)$/i.test(m[2] || '') && !percentFits(m[1], n)) out.push({ kind: 'percent', level: 'check', text: `${m[0]}: no count out of ${n} gives ${m[1]}%` });
  }
  const rangeWord = paper ? '(?:range|IQR|95\\s*%\\s*CI|CI)' : '(?:range|IQR|95\\s*%\\s*CI|CI)?';
  for (const m of v.matchAll(new RegExp(`(?<!±\\s*)(?<!\\bof\\s+)(?<![\\d.,])(-?\\d+(?:[.,]\\d+)?)\\s*\\(\\s*${rangeWord}[:\\s]*(-?\\d+(?:[.,]\\d+)?)\\s*(?:–|—|-|to)\\s*(-?\\d+(?:[.,]\\d+)?)\\s*\\)`, 'gi'))) {
    const [x, a, b] = [num(m[1]), num(m[2]), num(m[3])];
    if (a <= b && (x < a || x > b)) out.push({ kind: 'range', level: 'error', text: `${m[0]}: the estimate is outside its range or interval` });
  }
  for (const m of v.matchAll(/±\s*-\s*\d/g)) out.push({ kind: 'sd', level: 'error', text: `${m[0]}: a negative SD` });
  return out;
}

/**
 * The numbers of a text as values, for "is this number in the paper": "2,38" and "2.38" alike, "1,417" also as 1417, and each decimal also
 * as it rounds to fewer decimals (62.18 gives 62.2 and 62), since a table may round what the paper reports.
 */
export function numbersOf(text) {
  const set = new Set();
  // each rounding half up, as roundTo and a table do (toFixed would give 7.85 → 7.8 from the binary value)
  const add = t => { const x = Number(t); if (!Number.isFinite(x)) return; set.add(String(x)); const d = (String(t).split('.')[1] || '').length; for (let k = 0; k < d; k++) set.add(String(roundTo(x, k))); };
  for (const m of String(text || '').normalize('NFKC').matchAll(/\d+(?:[.,·]\d+)*/g)) {
    const t = m[0];
    add(t.replace(/[,·]/g, '.').replace(/\.(?=.*\.)/g, ''));
    add(t.replace(/,/g, '').replace('·', '.'));
    for (const piece of t.split(/[.,·]/)) add(piece);
  }
  return set;
}

/** The decimal numbers of a value that are not in the paper: derived (should say so) or misread. Whole numbers are too common to tell. */
export function numbersNotInPaper(value, paperNumbers) {
  const out = [], v = String(value || '').normalize('NFKC');
  // the percentage of a count over its denominator is arithmetic that valueChecks compares; it is not looked for in the paper
  const pct = [...v.matchAll(/\d+\s*\/\s*\d+\s*\(\s*[≤≥<>]?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/g)].map(m => [m.index, m.index + m[0].length]);
  for (const m of v.matchAll(/\d+[.,]\d+/g)) {
    if (pct.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const x = String(Number(m[0].replace(',', '.')));
    if (!paperNumbers.has(x) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/** A value read off a figure must say so (≈); a check that read it from a figure while the value has no ≈ is listed. */
export function figureRead(value, field) {
  const approx = /≈|~\s*\d/.test(String(value || ''));
  const said = /\b((read|estimated|taken|measured) (off|from) (the )?(plot|graph|chart|figure|fig\.)|digiti[sz]ed|from the (plot|graph|chart))/i.test(`${field?.why || ''} ${field?.settled?.why || ''}`);
  return approx || said ? { approx, said } : null;
}

/** Paper-internal discrepancies (reported as the paper's, never fixed): n/N (p%) that do not match, intervals that miss their estimate. */
export function paperChecks(text) {
  const out = [];
  const pages = String(text || '').split('\f');
  pages.forEach((pg, i) => {
    for (const c of valueChecks(pg.replace(/\s+/g, ' '), { paper: true })) if (c.level === 'error') out.push({ page: i + 1, ...c });
  });
  return out;
}

// ---- tables read twice -----------------------------------------------------------------------------------------------------------------

const cellNorm = c => String(c ?? '').normalize('NFKC').replace(/[−–—]/g, '-').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim().toLowerCase();
/**
 * Two readings of one table compared cell by cell: `a`, `b` { rows: [[cell, …], …] } (the text layer's and the page image's). Answers
 * [{ row, col, a, b }] for every cell that differs, a missing cell included.
 */
export function compareTables(a, b) {
  const ra = a?.rows || [], rb = b?.rows || [], out = [];
  for (let r = 0; r < Math.max(ra.length, rb.length); r++) {
    const x = ra[r] || [], y = rb[r] || [];
    for (let c = 0; c < Math.max(x.length, y.length); c++) if (cellNorm(x[c]) !== cellNorm(y[c])) out.push({ row: r + 1, col: c + 1, a: x[c] ?? '(missing)', b: y[c] ?? '(missing)' });
  }
  return out;
}

/** The pages of a full text (form feeds) that carry a table caption: [{ page, captions }]. */
export function tablePages(text) {
  return String(text || '').split('\f').map((pg, i) => ({ page: i + 1, captions: [...new Set([...pg.matchAll(/^\s*(Table\s+[0-9IVX]+[a-z]?)\b/gim)].map(m => m[1].replace(/\s+/g, ' ')))] })).filter(x => x.captions.length);
}

/** One study's audit: every value's state and its mechanical findings. `values` from valuesToCheck; `field(key)` its stored check; `countFields`
 * the columns read as counts. Each value: { key, value, state, proof, checks, missing, unproven (what its proof does not show), figure }. */
export function auditStudy({ values, fields = {}, text = '', arms = [], countFields = null, ocrPages = [] }) {
  const nums = numbersOf(text), hash = text ? fingerprint(text) : null, sizes = new Map(arms.map(a => [a.id, armSize(a.label)])), out = [];
  for (const v of values) {
    // the proof is checked against the text now, not taken from the record
    const f0 = fields[v.key], f = f0?.quote && text ? { ...f0, found: quoteFound(f0.quote, text) } : f0, state = valueState(f, v.value, hash), n = sizes.get(v.arm) || (arms.length ? null : armSize(values.find(x => /arm_n/.test(x.key))?.value));
    const checks = NR.test(v.value) ? [] : valueChecks(v.value, { n });
    let missing = text && !NR.test(v.value) && (!f?.settled || f.settled.decision === 'derived') ? numbersNotInPaper(v.value, nums) : [];
    const fig = figureRead(v.value, f);
    // a derivation must prove every number of the value that is not in the paper; one that proves nothing needed is left alone
    // a recorded derivation is checked every time, needed or not: a value counted as derived must rest on arithmetic that holds
    if (f?.settled?.decision === 'derived' && text) {
      const d = checkDerivation(f.settled.how, v.value, text, nums);
      if (d.problem) checks.push({ kind: 'derivation', level: 'error', text: `the recorded derivation fails: ${d.problem}` });
      else missing = missing.filter(m => !d.gives.includes(String(Number(m.replace(',', '.')))));
    }
    // a column the synthesis counts from (`countFields`: the text-counts columns) must read as counts, or its tables and figures show NR
    for (const c of NR.test(v.value) || !countFields?.has(v.field) ? [] : unreadableCounts(v.value)) checks.push({ kind: 'count-text', level: 'error', text: `"${c.text}" is not readable as a count (${c.reason}); a table or figure built from it shows NR` });
    const proof = state === 'settled' ? proofOf(f, v.value) : '';
    const unproven = proof === 'quote' || proof === 'derivation' ? proofGaps(v.value, f, { n, text }) : [];
    // a quote from a page read by text recognition is less certain: its page, so the proof is counted apart (ocrPage)
    const pq = proof === 'quote' ? (f.settled?.found ? f.settled : f) : null, ocrPage = pq?.quote && text ? ocrQuotePage(pq.quote, text, ocrPages, pq.page) : null;
    out.push({ key: v.key, value: v.value, state, proof, checks, missing, unproven, figure: fig && fig.said && !fig.approx ? 'read from a figure without ≈' : '', field: f, ...(ocrPage != null ? { ocrPage } : {}) });
  }
  return out;
}

// ---- what a proof shows ----------------------------------------------------------------------------------------------------------------

const WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, double: 2 };
/** A text with its English number words as digits ("forty-five" 45, "Twelve" 12), so a quote that spells a count shows it. */
export function numberWordsAsDigits(text) {
  const w = Object.keys(WORDS).join('|');
  return String(text || '').replace(new RegExp(`\\b(${w})(?:[\\s-]+(one|two|three|four|five|six|seven|eight|nine))?\\b`, 'gi'), (m, a, b) => {
    const x = WORDS[a.toLowerCase()], y = b ? WORDS[b.toLowerCase()] : 0;
    return ` ${x >= 20 && x % 10 === 0 ? x + y : x}${b && !(x >= 20 && x % 10 === 0) ? ` ${y}` : ''} `;
  });
}

/**
 * The parts of a value its proof must show: each number, and each label that carries a number (L3, T11, S1, Q4, D2), checked as the label.
 * Left out: the percentage of an n/N (recomputed by valueChecks) and an arm's index ("Arm 1"). Answers { numbers: ["59", "62.2"], labels: ["L3"] }.
 */
export function valueParts(value) {
  let v = String(value || '').normalize('NFKC');
  v = v.replace(/(\d+\s*\/\s*\d+)\s*\(\s*[≤≥<>]?\s*\d+(?:[.,]\d+)?\s*%\s*\)/g, '$1').replace(/\bArm\s+\d+\b/gi, ' ');
  const labels = [...new Set([...v.matchAll(/\b([A-Z]{1,2})(\d{1,2})\b/g)].map(m => m[0]))];
  v = v.replace(/\b[A-Z]{1,2}\d{1,2}\b/g, ' ');
  const numbers = [...new Set([...v.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => String(Number(m[0].replace(',', '.')))))];
  return { numbers, labels };
}

const NEGATION = /\b(no|none|not|nor|neither|without|never|nil|absent|free of)\b|n't\b/i;
/**
 * The numbers and labels of a settled value that its proof does not show. Shown: in a quote of its check or its decision that is found in
 * the text (number words count), given or used by its recorded derivation, a denominator that is the arm's size (proven by the arm's own
 * value), a zero the quote states as an absence ("no screw loosening") or that a named table convention gives (`settled.rule`, listed with
 * the axioms), or the lower end of a scale ("0–100"). A quote that does not show a
 * number proves something else; the value is listed until a quote or a derivation shows it. Answers ["59", "L3"].
 */
export function proofGaps(value, field, { n = null, text = '' } = {}) {
  if (!field || NR.test(String(value || ''))) return [];
  const st = field.settled || {};
  const quotes = [field.quote, st.quote].filter(q => q && (!text || quoteFound(q, text)));
  const shown = numbersOf(numberWordsAsDigits(quotes.join(' \n ')));
  if (st.decision === 'derived' && st.how) {
    for (const m of String(st.how).matchAll(/\d+(?:[.,]\d+)?/g)) { const x = String(Number(m[0].replace(',', '.'))); shown.add(x); for (const k of [0, 1, 2]) shown.add(String(roundTo(Number(x), k))); }
  }
  const qn = normAlnum(quotes.join(' '));
  // a number read off a figure (≈) is proven by the figure decision and its legend, not by a quote of the number
  const v0 = String(value || '').normalize('NFKC'), v = st.decision === 'figure' ? v0.replace(/≈\s*[-−–+±]?\s*\d+(?:[.,]\d+)?/g, ' ')   /* a sign or ± after ≈ is part of the read (31 Oct 2026: "≈−1.25" was not seen as one) */ : v0, { numbers, labels } = valueParts(v);
  const dens = new Set([...v.matchAll(/\d+\s*\/\s*(\d+)/g)].map(m => m[1]));
  const scaleLow = /(^|[^\d.])0\s*[–-]\s*\d/.test(v);
  // a figure decision reads what only the figure prints (a flow diagram's counts): a number absent from the whole text is the figure's
  const paperNums = st.decision === 'figure' && text ? numbersOf(text) : null;
  const gaps = numbers.filter(x => {
    if (shown.has(x) || (paperNums && !paperNums.has(x))) return false;
    if (n && x === String(n) && dens.has(x)) return false;
    // a zero the paper states as an absence, or one a named table convention gives ("rule": complications reported in full, the event not among them)
    if (x === '0' && (NEGATION.test(quotes.join(' ')) || scaleLow || st.rule)) return false;
    return true;
  });
  // a thoracic level may be written T11 or Th11
  for (const l of labels) if (!qn.includes(normAlnum(l)) && !(/^T\d/.test(l) && qn.includes(`th${l.slice(1)}`))) gaps.push(l);
  return gaps;
}

/** The segments of a value that name a count ("PJK 1/25 (4.0%), counted among …") but that count-text cannot read; a bound is meant. */
export function unreadableCounts(value) {
  const { items, unreadable } = parseCountText(value);
  return [...items, ...unreadable].filter(i => i.status !== 'count' && i.status !== 'missing' && /\d+\s*\/\s*\d+/.test(i.text) && !/bound/.test(i.reason || ''));
}

// ---- proof import --------------------------------------------------------------------------------------------------------------------

/**
 * Proof import (31 Oct 2026, plan item 1): the decision a value's own source quotes make, or why they make none. A workbook imported with a
 * "— Source:" quote in each cell keeps those quotes as the value's evidence (folder-init.mjs); before, they were never checked, so every
 * value read as unchecked and a model was paid to find what the extractor had already quoted. `record` the stored value (its `evidence`),
 * `value` its text, `arm` "arm1"… or ''. Only a quote found verbatim in the text counts, and the quotes must show every number and label of
 * the value (proofGaps), and for a value without numbers name one of its words; otherwise nothing is decided and the value stays for the
 * audit. Answers { decision: { decision: 'confirmed', why, quote, page } } or { skip: 'nr' | 'judgement' | 'no-quote' | 'not-found' | 'gaps', gaps? }.
 */
const JUDGEMENT = /^(yes|no|unclear|none|partly|partial|probably (yes|no)|not (stated|done|assessed|tested|blinded))\b/i;
export function evidenceProof(record, value, text, { arm = '', n = null } = {}) {
  const v = String(value ?? '');
  if (NR.test(v.trim())) return { skip: 'nr' };
  // a judgement (yes, no, unclear, none) or an absence is the reviewer's reading of the whole paper: a quote cannot prove it
  if (JUDGEMENT.test(v.trim())) return { skip: 'judgement' };
  const armNo = /^arm(\d+)$/.exec(arm || '')?.[1];
  const ev = (record?.evidence || []).filter((e, i) => i > 0 && e?.quote && !e.title && (!armNo || e.arm == null || String(e.arm) === armNo));
  if (!ev.length) return { skip: 'no-quote' };
  const hay = normAlnum(text), found = [...new Set(ev.map(e => String(e.quote).trim()).filter(q => quoteFound(q, text, hay)))];
  if (!found.length) return { skip: 'not-found' };
  // the fewest found quotes that show every number: one first, then all of them joined (each still found on its own)
  const gapsOf = qs => proofGaps(v, { settled: { decision: 'confirmed', quote: qs.join(' … '), found: true } }, { n, text: '' });
  let use = found.find(q => !gapsOf([q]).length && quoteFound(q, text, hay)), gaps = [];
  if (!use) { gaps = gapsOf(found); if (gaps.length) return { skip: 'gaps', gaps }; use = found.join(' … '); }
  if (!valueParts(v).numbers.length) {
    // a value of words: at least two thirds of its words outside brackets (4 letters or more) are in the quote
    const words = [...new Set(v.normalize('NFKC').replace(/\([^)]*\)/g, ' ').toLowerCase().match(/\p{L}{4,}/gu) || [])];
    const qn = normAlnum(use), seen = words.filter(w => qn.includes(normAlnum(w)));
    if (words.length && seen.length * 3 < words.length * 2) return { skip: 'gaps', gaps: words.filter(w => !seen.includes(w)) };
  }
  const pages = String(text || '').split('\f'), first = String(use).split(' … ')[0];
  const at = pages.findIndex(pg => quoteFound(first, pg));
  const cells = ev.filter(e => use.includes(String(e.quote).trim())).map(e => e.locator?.cell).filter(Boolean);
  return { decision: { decision: 'confirmed', why: `The extraction's own source quote${cells.length > 1 ? 's' : ''} (${ev[0].path?.split('/').pop() || 'evidence'}${cells.length ? `, ${cells.join(', ')}` : ''}) found word for word in the full text (proof import)`, quote: use, ...(at >= 0 ? { page: at + 1 } : {}) } };
}

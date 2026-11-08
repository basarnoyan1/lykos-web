// Derivations proposed (28 Oct 2026): the arithmetic behind a value computed from other cells of the same study, written in the form a
// reviewer's `derived` decision takes (lib/value-accuracy.mjs checkDerivation: "100 × 19 ÷ 42 = 45.24 → 45"), so the proof checker can check
// it. Before, each was written by hand. Only proposed: lykos-proof propose-derivations writes them as a change file a person applies, and a
// value that already has a decision (a person's text) is never proposed again.
//
// What is proposed, for a value that is one number (a percentage, or a count) whose number the paper does not state:
//   a percentage   100 × k ÷ n, k and n numbers of other cells of the same arm (or the study), n the arm's size when it is one of them
//   a count        p × n ÷ 100, p a percentage cell of the same arm and n its size; or the sum of the arms' values of the same column
// The intermediate result is written with as many decimals as keep the final rounding the one a direct rounding gives (45.4545 is written
// 45.45, not 45.5, which would round to 46). A value that more than one derivation gives is listed as ambiguous and not proposed.
// Pure: the values, the stored checks and the full text in, proposals out.
// Written as settle_value with ifUndecided (lib/change-file.mjs), so a decision a person records between proposing and applying is kept.
import { checkDerivation, numbersOf, settleField, checkFor } from './value-accuracy.mjs';

const ONE = /^\s*(\d+(?:[.,]\d+)?)\s*(%?)\s*$/;
const decimals = t => (String(t).split(/[.,]/)[1] || '').length;
const roundTo = (x, d) => Number((Math.round(x * 10 ** d + 1e-9 * Math.sign(x)) / 10 ** d).toFixed(d));
const numOf = t => Number(String(t).replace(',', '.'));
const armSize = label => { const m = String(label || '').match(/\bn\s*=\s*(\d+)/i); return m ? Number(m[1]) : null; };
const isPercentColumn = v => /%|percent|proportion|rate/i.test(`${v.label || ''} ${v.key || ''}`);

/** The steps that give `target` (as written) from the exact value x: "= x' → target", with x' rounded far enough that its rounding is x's. */
export function roundingSteps(expr, x, target) {
  const d = decimals(target), want = roundTo(x, d);
  if (Math.abs(want - numOf(target)) > 1e-9) return null;
  if (Math.abs(x - want) < 1e-9) return `${expr} = ${target}`;
  for (let e = d + 1; e <= d + 4; e++) {
    const mid = roundTo(x, e);
    if (Math.abs(roundTo(mid, d) - want) < 1e-9) return Math.abs(mid - x) < 1e-9 ? `${expr} = ${mid.toFixed(e).replace(/\.?0+$/, '') || '0'} → ${target}` : `${expr} = ${mid.toFixed(e)} → ${target}`;
  }
  return null;
}

/**
 * The derivations to propose for one study. `values` [{ key, field, arm, label, value }] (lib/value-check.mjs valuesToCheck), `fields` the
 * stored checks by key (s.valueChecks.studies[id].fields), `text` the full text, `arms` [{ id, label }]. Answers [{ key, value, how, why,
 * field: the check record to store }] and `skipped` [{ key, reason }] for values a derivation would fit but that are left to a person.
 */
export function proposeDerivations({ values = [], fields = {}, text = '', arms = [], by = 'Lykos', at = new Date().toISOString() }) {
  const out = [], skipped = [];
  if (!text) return { proposals: out, skipped };
  const nums = numbersOf(text), sizes = new Map(arms.map(a => [a.id, armSize(a.label)]));
  const single = values.map(v => ({ ...v, m: ONE.exec(String(v.value || '')) })).filter(v => v.m);
  // a percentage is stated when the text has it with its sign ("45%", "45.0 %"); a count when the text has the number
  const stated = (v, pct) => (pct ? new RegExp(`(?<![\\d.,])${v.m[1].replace(/[.,]/, '[.,]')}(?:[.,]0+)?\\s*%`).test(text) : nums.has(String(numOf(v.m[1]))));
  for (const v of single) {
    const f = fields[v.key];
    if (f?.settled) continue;   // a person's decision (and its text) stays as it is
    const pct = v.m[2] === '%' || isPercentColumn(v), target = v.m[1];
    if (stated(v, pct)) continue;
    // the numbers this value may come from: the other single-number cells of its arm, the study-level ones, and the arm's size
    const near = single.filter(w => w.key !== v.key && (w.arm === v.arm || !w.arm) && w.m[2] !== '%' && !isPercentColumn(w) && nums.has(String(numOf(w.m[1]))));
    const n = sizes.get(v.arm) || null;
    const cands = [];
    if (pct) {
      const denominators = [...new Map([...near.map(w => [numOf(w.m[1]), w.label]), ...(n ? [[n, 'the arm size']] : [])]).entries()].filter(([x]) => Number.isInteger(x) && x > 0 && nums.has(String(x)));
      for (const w of near) {
        const k = numOf(w.m[1]);
        if (!Number.isInteger(k)) continue;
        for (const [N, nLabel] of denominators) {
          if (N === k || k > N) continue;
          const how = roundingSteps(`100 × ${k} ÷ ${N}`, (100 * k) / N, target);
          if (how) cands.push({ how, why: `${v.label}: ${w.label} ${k} of ${nLabel === 'the arm size' ? `the arm's ${N}` : `${nLabel} ${N}`}, as a percentage`, n: N === n });
        }
      }
    } else if (Number.isInteger(numOf(target))) {
      // a count from the arm's percentage and its size
      for (const w of single.filter(w => w.key !== v.key && (w.arm === v.arm || !w.arm) && (w.m[2] === '%' || isPercentColumn(w)) && nums.has(String(numOf(w.m[1]))))) {
        if (!n || !nums.has(String(n))) continue;
        const how = roundingSteps(`${w.m[1].replace(',', '.')} × ${n} ÷ 100`, (numOf(w.m[1]) * n) / 100, target);
        if (how) cands.push({ how, why: `${v.label}: ${w.label} ${w.m[1]}% of the arm's ${n}`, n: true });
      }
      // a study-level count as the sum of its arms' counts in the same column
      if (!v.arm) {
        const parts = single.filter(w => w.field === v.field && w.arm && w.m[2] !== '%' && nums.has(String(numOf(w.m[1]))));
        if (parts.length > 1 && parts.every(w => Number.isInteger(numOf(w.m[1]))) && parts.reduce((a, w) => a + numOf(w.m[1]), 0) === numOf(target)) {
          cands.push({ how: `${parts.map(w => numOf(w.m[1])).join(' + ')} = ${target}`, why: `${v.label}: the sum of the arms' values (${parts.map(w => w.arm).join(', ')})`, n: true });
        }
      }
    }
    // the arm's size as denominator is preferred; otherwise a value two derivations give is left to a person
    const best = cands.some(c => c.n) ? cands.filter(c => c.n) : cands;
    const distinct = [...new Map(best.map(c => [c.how, c])).values()];
    if (!distinct.length) continue;
    if (distinct.length > 1) { skipped.push({ key: v.key, value: v.value, reason: `${distinct.length} derivations fit (${distinct.slice(0, 3).map(c => c.how).join('; ')})` }); continue; }
    const c = distinct[0], check = checkDerivation(c.how, v.value, text, nums);
    if (check.problem) { skipped.push({ key: v.key, value: v.value, reason: check.problem }); continue; }
    const r = settleField(checkFor(f, v.value, v.qualifier), v.value, { decision: 'derived', why: `${c.why} (proposed by Lykos)`, how: c.how }, text, by, at);
    if (r.problem) { skipped.push({ key: v.key, value: v.value, reason: r.problem }); continue; }
    out.push({ key: v.key, value: v.value, how: c.how, why: r.field.settled.why, field: r.field });
  }
  return { proposals: out, skipped };
}

/** A proposal as the change op that records it (settleOp): settle_value with ifUndecided, which leaves a decision recorded meanwhile, or a value changed since. */
export const settleOp = (paperId, p, by = 'Lykos', at = new Date().toISOString()) => ({ op: 'settle_value', paper: paperId, key: p.key, value: p.value, decision: 'derived', why: p.why, how: p.how,
  ...(p.field?.settled?.textHash ? { textHash: p.field.settled.textHash } : {}), by, at, ifUndecided: true });

/**
 * The derivation proposed for one cell of the extraction table, or null (the app's Details panel offers it as a review row). `cell` is the
 * value's key ("paper:t.women_pct@arm1"); `valuesOf(s, template, paperId)` lib/value-check.mjs valuesToCheck. Answers { key, value, how, why,
 * field, op } with op the settle_value change that records it.
 */
export function cellDerivation(s, template, paperId, cell, text, valuesOf, by = 'Lykos') {
  if (!template || !text) return null;
  const values = valuesOf(s, template, paperId), v = values.find(x => `${paperId}:${x.field}${x.arm ? `@${x.arm}` : ''}` === cell);
  if (!v) return null;
  const { proposals } = proposeDerivations({ values, fields: s.valueChecks?.studies?.[paperId]?.fields || {}, text, arms: template.arms?.[paperId] || [], by });
  const p = proposals.find(x => x.key === v.key);
  return p ? { ...p, op: settleOp(paperId, p, by) } : null;
}

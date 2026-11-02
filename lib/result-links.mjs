// Typed results in the manuscript: an estimate with its confidence interval
// written as plain text where a linked result could stand (plan J7). Found
// and matched here, in code, with no model call: a match can be converted to
// live tokens, and a pooled-looking number that differs from the result it
// names is reported.
const NUM = String.raw`[−-]?\d+(?:\.\d+)?`;
// estimate, then an optional bracket and "95% CI", then lower, a separator, upper.
const RE = new RegExp(String.raw`(?<![\w.])(${NUM})(%?)(\s*(?:[(\[]|,|;)?\s*(?:95\s*%\s*(?:CI|CrI|confidence interval)\s*[:,]?\s*|CI\s*[:,]?\s*)?)(${NUM})%?(\s*(?:to|–|—|-|,)\s*)(${NUM})%?(\s*[)\]])?`, 'g');
const CI_WORD = /95\s*%\s*(?:CI|CrI|confidence interval)|\bCI\b/i;
const value = t => Number(String(t).replace('−', '-'));
const decimals = t => (String(t).split('.')[1] || '').length;

const MEASURES = [
  ['SMD', /\bSMD\b|standardi[sz]ed mean difference|Hedges'?\s*g\b/i],
  ['MD', /\bMD\b|(?<!standardi[sz]ed )mean difference/i],
  ['HR', /\bHR\b|hazard ratio/i],
  ['RR', /\bRR\b|risk ratio|relative risk/i],
  ['OR', /\bOR\b|odds ratio/i],
  ['RD', /\bRD\b|risk difference/i],
];
const POOLED = /pooled|overall|summary|combined|meta-analy|across (?:the )?(?:\d+ |all )?(?:included )?(?:studies|trials)/i;

/** Estimate-with-interval spans in a text, token text masked so none is found inside one. */
export function typedIntervals(text) {
  const masked = String(text || '').replace(/\{\{[^}]*\}\}|\[@[^\]]*\]/g, m => ' '.repeat(m.length));
  const out = [];
  for (const m of masked.matchAll(RE)) {
    const [whole, e, pctE, mid, lo, sep, hi, close] = m;
    const open = /[(\[]/.test(mid);
    // An interval, not any three numbers: named as a CI or bracketed, and
    // holding the estimate.
    if (!CI_WORD.test(mid) && !(open && close)) continue;
    if (open && !close && !CI_WORD.test(mid)) continue;
    const [E, L, H] = [value(e), value(lo), value(hi)];
    if (!(L < H && L <= E && E <= H)) continue;
    const start = m.index;
    const loStart = start + e.length + pctE.length + mid.length;
    const hiEnd = loStart + whole.slice(e.length + pctE.length + mid.length).length - (close || '').length;
    out.push({ start, end: start + whole.length, text: whole, values: [E, L, H], digits: [decimals(e), decimals(lo), decimals(hi)],
      estimate: [start, start + e.length], interval: [loStart, hiEnd], balanced: !open || Boolean(close), percent: Boolean(pctE) });
  }
  return out;
}

/** The three numbers of a result, as computed where it keeps them, else as it displays. */
function tripleOf(r) {
  if (Array.isArray(r.raw) && r.raw.length === 3 && r.raw.every(x => Number.isFinite(Number(x)))) return { v: r.raw.map(Number), exact: true };
  const nums = [...String(r.text || '').replace(/\b95\s*%\s*(?=CI)/g, ' ').matchAll(new RegExp(NUM, 'g'))].map(x => value(x[0]));
  return nums.length === 3 && /\bCI\b| to /.test(r.text) ? { v: nums, exact: false } : null;
}

/** Whether a typed triple states a result's numbers, at the precision typed. */
function states(c, t) {
  const scale = c.percent && t.exact ? 100 : 1;
  return c.values.every((x, i) => Math.abs(t.v[i] * scale - x) <= 0.5 * 10 ** -c.digits[i] + 1e-9);
}

/** Results a typed interval could stand for: those with an estimate and its interval. */
export function linkableResults(resultList) {
  return resultList.map(r => ({ r, t: tripleOf(r) })).filter(x => x.t);
}

/**
 * The measure named just before an estimate: the last one in the words before
 * it, with no other number between ("MD −2.5 …; I² 45% (…)" names no measure
 * for the second interval).
 */
function measureBefore(before) {
  let best = null;
  for (const [id, re] of MEASURES) {
    for (const m of before.matchAll(new RegExp(re.source, 'gi'))) {
      const end = m.index + m[0].length;
      if (!best || end > best.end) best = { id, end };
    }
  }
  if (!best) return null;
  const tail = before.slice(best.end);
  return tail.length <= 30 && !/[\d²τχ]/.test(tail) ? best.id : null;
}
const sentenceAround = (text, i) => {
  const a = Math.max(text.lastIndexOf('. ', i), text.lastIndexOf('\n', i)) + 1;
  const b = text.indexOf('. ', i);
  return text.slice(a, b < 0 ? text.length : b + 1);
};

/**
 * Every typed interval in the manuscript, each matched to the result it
 * states, or found to contradict the one pooled result it names, or neither.
 * A contradiction is claimed only for a sentence that speaks of a pooled
 * estimate, names a measure, and leaves one result of that measure (by the
 * outcome's name where several share it): a study's own estimate quoted in
 * the discussion is not a pooled result.
 */
export function typedResults(blocks, resultList) {
  const cands = linkableResults(resultList);
  const pooled = cands.filter(x => /^pooled\./.test(x.r.key) && /\.full$/.test(x.r.key));
  const out = [];
  for (const b of blocks || []) {
    if (!/^(p|quote|li)$/.test(b.type || 'p')) continue;
    const text = String(b.text || '');
    for (const c of typedIntervals(text)) {
      const match = cands.filter(x => states(c, x.t));
      if (match.length) {
        // The pooled .full entry is preferred where two results state the same numbers.
        const best = match.find(x => /\.full$/.test(x.r.key)) || match[0];
        out.push({ blockId: b.id, ...c, match: best.r });
        continue;
      }
      const sentence = sentenceAround(text, c.start);
      const before = text.slice(Math.max(0, c.start - 60), c.start);
      const m = measureBefore(before);
      if (!m || !POOLED.test(sentence)) { out.push({ blockId: b.id, ...c }); continue; }
      let same = pooled.filter(x => new RegExp(`^${m} with CI$`).test(x.r.label));
      if (same.length > 1) {
        const named = same.filter(x => { const o = /(?:·|:|,) (.+)$/.exec(x.r.group)?.[1]; return o && text.toLowerCase().includes(o.toLowerCase()); });
        same = named.length === 1 ? named : [];
      }
      out.push({ blockId: b.id, ...c, ...(same.length === 1 ? { contradicts: same[0].r } : {}) });
    }
  }
  return out;
}

/**
 * The text with a typed result replaced by links. A pooled result keeps the
 * author's own wording around it: the estimate becomes {{….estimate}} and the
 * bounds {{….ci}}. Any other result replaces the whole span, only where its
 * brackets are balanced. Returns null when no link can be made.
 */
export function linkedText(text, hit, resultList) {
  const key = hit.match?.key; if (!key) return null;
  const has = k => resultList.some(r => r.key === k);
  const base = key.replace(/\.full$/, '');
  if (/\.full$/.test(key) && has(`${base}.estimate`) && has(`${base}.ci`)) {
    const [es, ee] = hit.estimate, [ls, le] = hit.interval;
    return { text: `${text.slice(0, es)}{{${base}.estimate}}${text.slice(ee, ls)}{{${base}.ci}}${text.slice(le)}`, keys: [`${base}.estimate`, `${base}.ci`] };
  }
  if (!hit.balanced) return null;
  return { text: `${text.slice(0, hit.start)}{{${key}}}${text.slice(hit.end)}`, keys: [key] };
}

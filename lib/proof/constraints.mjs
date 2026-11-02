// What a paper states about itself, read as constraints that must hold together, and the smallest sets of its own statements that cannot
// all be true (its contradictions). Each constraint is checked in code: a count over its denominator against its percentage, a mean
// inside its range, the women and men adding up to the patients, percentages of a split adding to 100, the same total or the same mean
// follow-up stated in two places. A conflict lists every passage involved, with its page and section; the checker never chooses between
// them. Which reading a review follows is a decision for a person, recorded once (a "conflict" decision), and then it is an axiom.
import { OWN_ZONES, sentenceFlags, snippet } from './text-index.mjs';

const roundTo = (x, d) => Math.round(x * 10 ** d + 1e-9 * Math.sign(x)) / 10 ** d;
const dec = s => (String(s).split(/[.,]/)[1] || '').length;
const num = s => Number(String(s).replace(',', '.'));
const W = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const wordNum = s => { const t = String(s).toLowerCase().split(/[- ]/); const a = W[t[0]], b = t[1] ? W[t[1]] : 0; return a == null ? Number(s) : a + (b || 0); };
const NUMW = `(\\d+|(?:${Object.keys(W).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;

/** The constraints a paper's own text states, and those that fail: [{ kind, level, text, places: [{ page, zone, text }] }]. */
export function paperConstraints(ix) {
  const out = [], own = si => si >= 0 && OWN_ZONES.has(ix.sents[si].zone) && !sentenceFlags(ix, si)?.attributed;
  const place = (si, at) => ({ page: ix.sents[si].page, zone: ix.sents[si].zone, text: snippet(ix, si, at) });
  const add = (kind, level, text, places) => { const key = `${kind}|${text}`; if (!out.some(o => `${o.kind}|${o.text}` === key)) out.push({ kind, level, text, places }); };
  const totals = [];
  ix.sents.forEach((S, si) => {
    if (!own(si)) return;
    const x = ix.t.slice(S.s, S.e).replace(/\s+/g, ' ');
    // n/N (p%) and p% (n/N)
    for (const m of x.matchAll(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)|(\d+(?:[.,]\d+)?)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/g)) {
      const k = Number(m[1] ?? m[5]), n = Number(m[2] ?? m[6]), p = m[3] ?? m[4];
      if (k > n) add('count', 'conflict', `${m[0]}: the count is larger than its denominator`, [place(si, S.s + m.index)]);
      else if (n > 0 && Math.abs(roundTo(100 * k / n, dec(p)) - num(p)) > 0.5 * 10 ** -dec(p) + 0.051 && Math.abs(Math.floor(1000 * k / n) / 10 - num(p)) > 0.051) add('percent', 'conflict', `${m[0]}: ${k}/${n} is ${roundTo(100 * k / n, 1)}%`, [place(si, S.s + m.index)]);
    }
    // a mean outside its own range: "62.18 ± 15.42 (range: 49–85)" checks 62.18, not 15.42
    for (const m of x.matchAll(/(?<![±\d.,])(\d+(?:[.,]\d+)?)\s*(?:±\s*\d+(?:[.,]\d+)?\s*)?(?:years?|months?|mm|°|points?)?\s*\(\s*range[:,]?\s*(\d+(?:[.,]\d+)?)\s*(?:°|mm|years?|months?)?\s*(?:–|-|to)\s*(\d+(?:[.,]\d+)?)/gi)) {
      const [v, a, b] = [num(m[1]), num(m[2]), num(m[3])];
      if (a <= b && (v < a || v > b) && !/\bof\s*$/.test(x.slice(Math.max(0, m.index - 4), m.index))) add('range', 'conflict', `${m[0]}…): the mean is outside its range`, [place(si, S.s + m.index)]);
    }
    // women and men against the total in the same sentence
    const wm = x.match(new RegExp(`${NUMW}\\s+(?:\\(\\s*\\d+(?:[.,]\\d+)?\\s*%\\s*\\)\\s*)?(women|females?|men|males?)\\b[^.;]{0,40}?\\b(?:and|,)\\s+${NUMW}\\s+(?:\\(\\s*\\d+(?:[.,]\\d+)?\\s*%\\s*\\)\\s*)?(women|females?|men|males?)\\b`, 'i'));
    const tot = x.match(new RegExp(`\\b${NUMW}\\s+(?:consecutive |elderly |adult )?(?:patients|cases|subjects|participants)\\b`, 'i'));
    if (wm && tot && /wom|fem/i.test(wm[2]) !== /wom|fem/i.test(wm[4])) {
      const a = wordNum(wm[1]), b = wordNum(wm[3]), n = wordNum(tot[1]);
      if (Number.isFinite(a + b + n) && a + b !== n && a + b > 0) add('sex', 'conflict', `${wm[0]} add up to ${a + b}, not the ${n} patients of the same sentence`, [place(si, S.s + (wm.index || 0))]);
    }
    // a split given in percentages: "17 (68%) women and 8 (32%) men" must add to 100
    const pp = [...x.matchAll(/(\d+(?:[.,]\d+)?)\s*%\s*\)?\s*(?:were\s+)?(women|females?|men|males?)\b/gi)];
    if (pp.length === 2 && /wom|fem/i.test(pp[0][2]) !== /wom|fem/i.test(pp[1][2])) {
      const s2 = num(pp[0][1]) + num(pp[1][1]);
      if (Math.abs(s2 - 100) > 1.05) add('split', 'conflict', `${pp[0][0]} and ${pp[1][0]} add up to ${roundTo(s2, 1)}%`, [place(si, S.s + pp[0].index)]);
    }
    // totals stated with an inclusion verb, for the cross-section comparison below
    for (const m of x.matchAll(new RegExp(`\\b${NUMW}\\s+(?:consecutive |elderly |adult )?(?:patients|cases|subjects|participants)\\b[^.;]{0,30}\\b(?:were|was)\\s+(?:included|enrolled|analy[sz]ed|reviewed|treated|operated)|\\b(?:included|enrolled|total of|comprised)\\s+${NUMW}\\s+(?:consecutive |elderly |adult )?(?:patients|cases|subjects|participants)\\b`, 'gi'))) {
      const n = wordNum(m[1] || m[2]);
      if (Number.isFinite(n) && n > 1) totals.push({ n, si, at: S.s + m.index, zone: S.zone });
    }
    // mean follow-up in months or years
    for (const m of x.matchAll(/\b(?:mean|average)\s+(?:duration of\s+)?follow[- ]?up(?:\s+(?:period|time|duration))?\s+(?:was|of|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:±\s*\d+(?:[.,]\d+)?\s*)?(years?|months?|mo)\b/gi)) {
      const v = num(m[1]) * (/^y/i.test(m[2]) ? 12 : 1);
      (ix._fu ||= []).push({ v, raw: `${m[1]} ${m[2]}`, d: /^y/i.test(m[2]) ? dec(m[1]) : dec(m[1]), years: /^y/i.test(m[2]), si, at: S.s + m.index, zone: S.zone });
    }
  });
  // the same total in the abstract and in the body
  const absT = totals.filter(t => t.zone === 'abstract'), bodyT = totals.filter(t => t.zone !== 'abstract');
  if (absT.length && bodyT.length) {
    const a = new Set(absT.map(t => t.n)), b = new Set(bodyT.map(t => t.n));
    if (![...a].some(n => b.has(n))) add('total', 'check', `the abstract gives ${[...a].join(', ')} patients and the body ${[...b].join(', ')}`, [...absT.slice(0, 1), ...bodyT.slice(0, 2)].map(t => place(t.si, t.at)));
  }
  // the same mean follow-up in two places (years rounded to their decimals count as the same)
  const fu = ix._fu || [];
  for (let i = 0; i < fu.length; i++) for (let j = i + 1; j < fu.length; j++) {
    const A = fu[i], B = fu[j];
    const tol = Math.max(A.years ? 12 * 0.5 * 10 ** -A.d : 0.5 * 10 ** -A.d, B.years ? 12 * 0.5 * 10 ** -B.d : 0.5 * 10 ** -B.d) + 0.05;
    if (Math.abs(A.v - B.v) > tol) add('follow-up', A.zone === B.zone ? 'check' : 'conflict', `mean follow-up ${A.raw} (${A.zone}) and ${B.raw} (${B.zone})`, [place(A.si, A.at), place(B.si, B.at)]);
  }
  delete ix._fu;
  return out;
}

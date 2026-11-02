// The proof kernel. Every claim of a cell (claims.mjs) gets a proof built only from inference rules this file checks, with premises that are
// either passages of the paper (located in the index, with their page and zone) or named axioms (a reviewer's decision, a table convention).
// The rules:
//   source      the number is in the paper in exactly this form, in the study's own text, next to the measure it is about
//   rounded     a number of the paper rounded to the decimals the claim writes (62.18 → 62.2)
//   table       the number is in a table region whose caption or rows name the measure (the text layer lost the cell's row)
//   converted   a number of the paper times a unit factor (cm → mm, years → months); the unit is an interpretation, listed as one
//   arith       the percentage of a count over its denominator, recomputed
//   arm-size    a denominator that is the arm's size
//   absence     a zero the paper states as an absence ("no screw loosening was observed")
//   quote       in a quote recorded for the value, found in the study's own text, with the number in its exact form
//   derivation  given by a derivation the checker evaluates (value-accuracy.mjs checkDerivation)
//   axiom       a reviewer's decision or a named table convention (listed as axioms; a proof that rests on one says so)
// Beside the proof, the kernel looks for what makes a claim doubtful: a negated or hedged source, a passage attributed to another study,
// a source only in editorial comments, references or another article, a measure outside its valid range, a median where the column wants a
// mean, an earlier timepoint than the column's, a denominator of levels or screws, and other values the paper gives for the same measure
// (a contradiction when the abstract and the results disagree).
import { MEASURE } from './lexicon.mjs';
import { OWN_ZONES, NOT_STUDY, NOT_OWN_WORDS, sentenceFlags, snippet, zoneAt, zonesIn, sourceName, pageAt } from './text-index.mjs';
import { claimsOf, columnKind, LEVEL, measureIn } from './claims.mjs';
import { hash, hashOf } from './hash.mjs';
import { checkDerivation } from '../value-accuracy.mjs';

export const KERNEL_VERSION = 'kernel-2026-10-31.13';

// unit factors: a derivation built only from them uses nothing the paper says
// the treatment words of an arm's label ("Arm 1 (n=26)\nTwo-stage stabilization with uncemented screws" → two-stage, uncemented, …)
const ARM_STOP = new Set('arm with without and the stabilization stabilisation surgery group patients conventional standard single stage'.split(' '));
const armWordsOf = t => String(t || '').split('\n').slice(1).join(' ').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !ARM_STOP.has(w)).map(w => w.slice(0, 6));
const SMALL_CONSTANTS = new Set(['10', '12', '24', '52', '60', '100', '365', '365.25', '1000', '30.44', '30.4', '2.54']);
const roundTo = (x, d) => Math.round(x * 10 ** d + 1e-9 * Math.sign(x)) / 10 ** d;
const eq = (a, b) => Math.abs(a - b) < 1e-9;
const NR = /^(NR|NA|not reported|not applicable)$/i;

/** How a number of the paper matches a claimed value: 'exact', 'rounded' (the paper has more decimals), 'sign' (only the sign differs), or ''. */
export function matchNumber(cv, cdec, x) {
  if (eq(x.v, cv)) return 'exact';
  if (x.dec > cdec && eq(roundTo(x.v, cdec), cv)) return 'rounded';
  if (cv !== 0 && (eq(x.v, -cv) || (x.dec > cdec && eq(roundTo(x.v, cdec), -cv)))) return 'sign';
  return '';
}

// ---- locating quotes ----------------------------------------------------------------------------------------------------------------
function alnumMap(ix) {
  if (ix._alnum) return ix._alnum;
  let s = ''; const pos = [];
  for (let i = 0; i < ix.t.length; i++) { const c = ix.t[i]; if (/[\p{L}\p{N}]/u.test(c)) { s += c.toLowerCase(); pos.push(i); } }
  return (ix._alnum = { s, pos });
}
/** Where a quote stands in the text: [{ s, e }] for each piece ("…" may join pieces), or null when it is not there. */
export function locateQuote(ix, quote) {
  const A = alnumMap(ix), q = String(quote || '').normalize('NFKC');
  // the whole quote first, as the audit's quoteFound does: a bracket is often the paper's own ("16 [7–25]", a median and its range in
  // Fontaine 2010's Table 2), not an elision
  const whole = q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (whole) { const k = A.s.indexOf(whole); if (k >= 0) return [{ s: A.pos[k], e: A.pos[k + whole.length - 1] + 1 }]; }
  const split = /\.\.\.|…|\[[^\]]*\]/.test(q);
  const pieces = (split ? q.split(/\.\.\.|…|\[[^\]]*\]/) : [q]).map(p => p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter(p => p.length >= (split ? 5 : 1));
  if (!pieces.length) return null;
  const out = [];
  for (const p of pieces) { const k = A.s.indexOf(p); if (k < 0) return null; out.push({ s: A.pos[k], e: A.pos[k + p.length - 1] + 1 }); }
  return out;
}

// ---- anchoring a number ------------------------------------------------------------------------------------------------------------
// the measures a number could belong to in its sentence: the nearest mention wins, so "Of the 3 patients who underwent revision, 2 showed
// no screw loosening" ties 3 to revision, not to loosening
function nearestMeasure(ix, cand) {
  if (cand.sent < 0) return null;
  let best = null;
  for (const [id, hits] of Object.entries(ix.mentions)) {
    if (id === 'patients' || id === 'complication' || id.startsWith('adhoc:')) continue;
    for (const h of hits) if (h.sent === cand.sent) { const d = h.s > cand.s ? h.s - cand.e : cand.s - h.e; if (!best || d < best.d) best = { id, d, h }; }
  }
  return best;
}
// a measure the lexicon does not know ("extension to S1", "iliac fixation"): its content words, searched once per paper
const ADHOC_STOP = new Set('with without the and for from into onto over under mean median range patients patient cases case all both each only also were was rate'.split(' '));
export function adhocMeasure(ix, phrase) {
  const levels = [...String(phrase || '').matchAll(LEVEL)].map(m => m[0]);
  // content words, and abbreviations of two or more capitals (PSO, ALIF)
  const w = String(phrase || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(x => (x.length >= 4 || /^[A-Z]{2,}$/.test(x)) && !ADHOC_STOP.has(x.toLowerCase()) && !/\d/.test(x)).map(x => x.toLowerCase());
  if (!w.length && !levels.length) return '';
  const id = `adhoc:${[...w, ...levels].join(' ')}`;
  if (!ix.mentions[id]) {
    // a word by its stem (extension, extended), a level as written or with the second letter dropped (L4–L5, L4-5)
    const stem = x => { const y = x.replace(/(?:ments?|ings?|ed|es|s)$/, ''); return y.length >= 3 ? y : x; };
    const parts = [...w.map(x => `\\b${(x.length >= 7 ? x.slice(0, 5) : stem(x)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ...levels.map(l => `\\b${l}\\b`)];
    const re = new RegExp(parts.join('|'), 'gi'), hits = [];
    // a phrase of several words is mentioned where all its words stand within a short span ("iliac fixation", not "iliac level")
    const each = parts.map(p => new RegExp(p, 'i'));
    for (const m of ix.t.matchAll(re)) {
      if (each.length > 1) { const win = ix.t.slice(Math.max(0, m.index - 60), m.index + 60); if (!each.every(r => r.test(win))) continue; } const L = lineIndex(ix, m.index); const line = ix.lines[L] || {}; hits.push({ s: m.index, e: m.index + m[0].length, sent: sentIndex(ix, m.index), line: L, zone: line.table ? 'table' : line.zone, table: line.table || '', page: line.page }); }
    ix.mentions[id] = hits;
  }
  return id;
}
function lineIndex(ix, off) { let lo = 0, hi = ix.lines.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= off) lo = m; else hi = m - 1; } return lo; }
function sentIndex(ix, off) { let lo = 0, hi = ix.sents.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ix.sents[m].s <= off) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 && off <= ix.sents[r].e ? r : -1; }

function mentionNear(ix, measure, cand) {
  const hits = ix.mentions[measure] || [];
  let best = 0, where = null;
  const nm = cand.zone === 'table' ? null : nearestMeasure(ix, cand);
  for (const h of hits) {
    let sc = 0;
    if (cand.sent >= 0 && h.sent === cand.sent) {
      const d = h.s > cand.s ? h.s - cand.e : cand.s - h.e;
      // another measure of the same kind nearer to the number owns it ("Of the 3 patients who underwent revision, 2 showed no screw loosening")
      const owned = nm && nm.id !== measure && nm.d < d - 2 && MEASURE[nm.id]?.kind === MEASURE[measure]?.kind;
      sc = owned ? 0 : d <= 90 ? 3 : 2;
    }
    // a measure in a neighbouring sentence cannot claim a number its own sentence gives to another measure of the same kind
    else if (cand.zone !== 'table' && Math.abs(h.s - cand.s) <= 150 && h.zone === cand.zone && !(nm && nm.id !== measure && MEASURE[nm.id]?.kind === MEASURE[measure]?.kind)) sc = 2;
    else if (cand.table && h.table === cand.table) sc = 1;
    if (sc > best) { best = sc; where = h; if (sc === 3) break; }
  }
  return { near: best, mention: where };
}

/**
 * The places a claimed number stands in the paper, best first: [{ num, match, near, score, zone, page, flags, why[] }], and the places that
 * do not count (out of scope: references, comments, other articles; attributed to another study).
 */
export function anchorNumber(ix, claim, cv, cdec, opts = {}) {
  const { pct = false, role = claim.role, count = false } = opts;
  const out = [], outside = [], denomMismatch = [];
  for (const x of ix.nums) {
    let match = '';
    for (const val of x.vals) { match = matchNumber(cv, cdec, val); if (match) break; }
    // a count is a whole number, and not a percentage or a duration: 28.8 is not 29 patients, "6 (3%)" is not 3, "after 6 weeks" is not 6
    if (match && (count || claim.type === 'count') && (match !== 'exact' || x.pct || (x.vals[0]?.dec ?? 0) > 0 || /^\s*(?:weeks?|months?|years?|days?|hours?|h|min|mm|cm|°|mg|mL|ml|kg|points?)\b/i.test(ix.t.slice(x.e, x.e + 10)))) match = '';
    // "1 (1.8%)" is one of about 55: it proves 1/52 only if its percentage is one of 52
    if (match && claim.type === 'count' && claim.N) { const p = ix.t.slice(x.e, x.e + 14).match(/^\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/); if (p) { const pv = Number(p[1].replace(',', '.')), d = (p[1].split(/[.,]/)[1] || '').length; if (Math.abs(100 * cv / claim.N - pv) > 0.5 * 10 ** -d + 0.051) { match = ''; if (claim.measure && mentionNear(ix, claim.measure, x).near >= 2) denomMismatch.push({ num: x, p: p[1] }); } } }
    // "2/26" is two of 26: it proves 2/27 only if 26 is 27
    if (match && claim.type === 'count' && claim.N != null) { const d = ix.t.slice(x.e, x.e + 8).match(/^\s*\/\s*(\d+)/); if (d && Number(d[1]) !== claim.N) match = ''; }
    // a number of levels, screws or patients is one followed by that word ("18 levels", not "18 patients"; "2 levels", not "*2")
    if (match && claim.unit && /^(levels|screws|patients)$/.test(claim.unit)) { const w = claim.unit === 'levels' ? /^\s*[-‐]?\s*(?:levels?|segments?|segmental|vertebrae)\b/i : claim.unit === 'screws' ? /^\s*screws?\b/i : /^\s*(?:patients?|cases?)\b/i; if (!w.test(ix.t.slice(x.e, x.e + 20)) && !(claim.type === 'stat' && claim.unit === 'levels' && /\b(?:number of|mean|average)\b[^.;]{0,30}\b(?:levels|segments|vertebrae)\s+(?:was|were|of|:)\s*$/i.test(ix.t.slice(Math.max(0, x.s - 70), x.s)))) match = ''; }
    // a percentage is proven only by a percentage ("75-year-old" is not 75%)
    if (match && pct && !x.pct && !/^\s*(?:per ?cent|percent)\b/i.test(ix.t.slice(x.e, x.e + 10))) match = '';
    // a mean is not a count: "8(32.0%)" is eight patients, not a score of 8.0; and a source with fewer decimals than the claim is weaker
    if (match && !(count || claim.type === 'count') && !pct && /^\s*\(\s*\d+(?:[.,]\d+)?\s*%/.test(ix.t.slice(x.e, x.e + 12))) match = '';
    if (!match || x.label || (x.word && !(Number.isInteger(cv) && cv <= 100 && (count || cdec === 0)))) continue;
    const fl = sentenceFlags(ix, x.sent) || {};
    if (NOT_STUDY.has(x.zone)) { outside.push({ num: x, zone: x.zone, page: x.page }); continue; }
    if (fl.attributed && !OWN_ZONES.has(x.zone)) { outside.push({ num: x, zone: x.zone, page: x.page, attributed: true }); continue; }
    // one patient's case does not give the cohort's mean or proportion
    if (fl.individual && claim.type !== 'count' && claim.type !== 'identity') { outside.push({ num: x, zone: x.zone, page: x.page, individual: true }); continue; }
    const { near, mention } = claim.measure ? mentionNear(ix, claim.measure, x) : { near: 0, mention: null };
    let score = near + (OWN_ZONES.has(x.zone) ? 1 : 0);
    const why = [];
    if (match === 'rounded') why.push('rounded');
    if (match === 'exact' && (x.vals[0]?.dec ?? 0) < cdec) score -= 1;
    if (match === 'sign') { score -= 1; why.push('sign not in the text layer'); }
    if (role === 'pre' && x.zone !== 'table') { if (fl.times?.includes('pre')) score += 1; else if (fl.times?.some(t => t === 'post' || t === 'final')) { const after = ix.t.slice(x.s, Math.min(ix.t.length, x.s + 40)); if (!/→|\bto\b/.test(after)) score -= 1; } }
    if (role === 'post' && x.zone !== 'table') { if (fl.times?.some(t => t === 'post' || t === 'final')) score += 1; }
    // in a final-follow-up column, a value said to be at the paper's latest time outranks one at an earlier time
    if (role === 'post' && opts.latest) { const lt = localTime(ix, x); if (lt != null) score += lt >= opts.latest - 0.5 ? 1 : -1; }
    // a site named next to the number (VAS back, VAS leg) must be the claim's
    if (claim.qual?.site && x.zone !== 'table') { const around = ix.t.slice(Math.max(0, x.s - 60), x.s); const w = (around.match(/\b(back|leg|neck|arm)\b/gi) || []).pop(); if (w) score += w.toLowerCase() === claim.qual.site ? 1 : -2; }
    if (pct && !x.pct) score -= 1;
    if (!pct && x.pct && !count) score -= 2;
    if (x.pm && !pct && !claim.spread) { score -= 3; why.push('a standard deviation'); }
    if (fl.attributed) { score -= 2; why.push('attributed to another study'); }
    if (x.zone === 'discussion' || x.zone === 'introduction') { why.push(`in the ${x.zone}`); if (!fl.own) score -= 1; }
    // the arm: a number beside the other arm's treatment words and not this arm's is the other arm's ("double-segment PLIF (PLIF group)")
    if (opts.armWords?.length && opts.otherArmWords?.length && x.zone !== 'table') {
      // the arm word nearest the number decides
      const lo = Math.max(0, x.s - 60), win = ix.t.slice(lo, x.e + 60).toLowerCase(), at = x.s - lo;
      const dist = ws => Math.min(...ws.flatMap(w => { const out = []; let k = win.indexOf(w); while (k >= 0) { out.push(Math.abs(k - at)); k = win.indexOf(w, k + 1); } return out; }), 1e9);
      const dm = dist(opts.armWords), dt = dist(opts.otherArmWords);
      if (dt < 1e9 && dt < dm) { score -= 3; why.push("beside the other arm's name"); }
    }
    out.push({ num: x, match, near, score, zone: x.zone, page: x.page, flags: fl, mention, why });
  }
  out.sort((a, b) => b.score - a.score || (a.match === 'exact' ? -1 : 1) || a.num.s - b.num.s);
  return { best: out[0] || null, all: out, outside, denomMismatch };
}

const strength = a => (!a ? 'none' : a.near >= 2 && a.score >= 3 ? 'strong' : a.near === 1 ? 'table' : a.score >= 1 ? 'weak' : 'none');
const place = (ix, a) => ({ page: a.num.page, zone: a.zone, at: a.num.s, text: snippet(ix, a.num.sent, a.num.s), ...(sourceName(ix, a.num.s) ? { source: sourceName(ix, a.num.s) } : {}) });

// other values the paper gives for the same measure, compared only like for like: the same scope (the whole cohort, unless the sentence is
// about one arm), the same role (before or after), the same statistic (not a change score, a threshold or a standard deviation) and the
// same unit after conversion. A difference on every known dimension is a contradiction when the abstract and the body disagree.
const TO_MONTHS = { year: 12, years: 12, yr: 12, yrs: 12, y: 12, month: 1, months: 1, mo: 1, week: 1 / 4.345, weeks: 1 / 4.345, day: 1 / 30.44, days: 1 / 30.44 };
function otherValues(ix, claim, cv, cdec, chosen, ctx) {
  if (!claim.measure || claim.qual?.subgroup || claim.bound || claim.approx) return [];
  if (ctx.multiArm && !claim.qual?.cohort) return [];
  const M = MEASURE[claim.measure];
  if (!M || /proportion|count|event/.test(M.kind) || claim.measure === 'patients') return [];
  const out = [], seen = new Set();
  const allowPct = M.range && M.range[1] === 100 && M.kind === 'score';
  const otherMention = (a, b) => Object.entries(ix.mentions).some(([id, hs]) => id !== claim.measure && id !== 'patients' && hs.some(x => x.s >= a && x.e <= b));
  for (const h of ix.mentions[claim.measure] || []) {
    if (!OWN_ZONES.has(h.zone) || h.zone === 'table' || h.sent < 0 || seen.has(h.sent)) continue;
    // "35–75 years old, had motor symptoms for 5 or more years": the age is the number before "years old", never one after it (Whone 2019)
    if (/^(?:years?[- ]old|year-old)$/i.test(ix.t.slice(h.s, h.e))) continue;
    // like for like within one report: a companion or a registry record reports its own analysis set and times
    if (ix.sources && chosen?.num && h.src !== chosen.num.src) continue;
    const fl = sentenceFlags(ix, h.sent);
    if (fl.attributed || fl.definition) continue;
    const S = ix.sents[h.sent], text = ix.t.slice(S.s, S.e);
    // how the measure was taken, or who left the study, is not a result
    if (/\b(assessed|measured|evaluated|recorded|obtained|calculated|graded|scored) (with|using|by|as|at|only)\b|\b(dropped out|lost to follow|withdr[ae]w|excluded|inclusion|exclusion)\b/i.test(text)) continue;
    // a sentence about a change (a difference, a decline, an improvement of so many points) does not state a level
    if (/\b(difference|declin\w*|reduction of|improvement of|decrease of|increase of|change of|gain of|by \d)/i.test(text)) continue;
    // a part of the cohort (a group, an arm, a subtype, the patients with an event) or an order to map ("respectively")
    if (/\b(group|arm|subgroup|type|level|class|grade|patients? with|cohort [AB12]|respectively|position)\b/i.test(text) && !/\ball (?:the )?patients\b|\boverall\b|\bwhole\b|\bentire\b/i.test(text)) continue;
    if (Object.entries(ix.mentions).some(([id, hs]) => MEASURE[id]?.kind === 'event' && id !== claim.measure && hs.some(x => x.sent === h.sent))) continue;
    const after = ix.nums.filter(x => x.sent === h.sent && x.s > h.e && x.s - h.e < 90 && (!x.pct || allowPct) && !x.pm && !x.word && !(x.vals[0].v >= 1900 && x.vals[0].v <= 2100));
    const ok = x => {
      const pre = ix.t.slice(Math.max(S.s, x.s - 30), x.s), post = ix.t.slice(x.e, Math.min(S.e, x.e + 14));
      if (/[pP]\s*[<=>\\]\s*$/.test(pre) || /\bby\s*$/i.test(pre) || /\b(?:over|under|above|below|older|younger|than|exceed\w*|at least|up to|more|less|minimum|maximum|between|ranged? from|range of|aged)\b[^\d]{0,14}$/i.test(pre) || /[≥≤<>]\s*$/.test(pre)) return false;
      if (/\b(?:Fig(?:ure)?|Table|grade|class|type|level|stage|n\s*=)\.?\s*$/i.test(pre) || (/\(\s*$/.test(pre) && /^\s*[–-]\s*\d/.test(post)) || (/[([]\s*$/.test(pre) && /^\s*[)\]]/.test(post) && x.vals[0].dec === 0)) return false;
      // either end of a range ("12–37", "range 28 to 80"), but not a change "from 70.0 to 20.5"
      const fromTo = /\bfrom\s+-?[\d.,]+\s*[°%]?\s*(?:\([^)]*\)\s*)?(?:to|→)\s*$/i.test(pre);
      if (!fromTo && (/\d\s*[°%]?\s*(?:[–-]|to)\s*$/.test(ix.t.slice(Math.max(0, x.s - 7), x.s)) || /^\s*[°%]?\s*(?:[–-]|to)\s*\d/.test(post) && /\(\s*(?:range)?[,:]?\s*$/i.test(pre))) return false;
      if (/^\s*(?:points?|percent|patients|cases|levels|screws|segments)\b/i.test(post) || (M.kind !== 'time' && /^\s*[-‐–]?\s*(?:months?|years?|weeks?|days?|mo|y|yr|th)\b/i.test(post)) || /^\s*\(\s*%\s*\)/.test(post) || /\b(?:improv|reduc|decreas|increas|chang|differ|gain|correct|declin|drop|fell|fall|rose|rise)\w*\s+(?:by|of)\s*$/i.test(pre)) return false;
      return true;
    };
    // before: the first number after the mention, close and with no other measure between; after: the number after a "to", "→" or "compared to" that follows it
    const first = after.find(x => x.s - h.e <= 30 && !otherMention(h.e, x.s));
    if (!first || !ok(first)) continue;
    let x = first;
    if (claim.role === 'post') {
      x = after.filter(y => y.s > first.e && y.s - first.e < 70).find(y => /^[^\d]{0,40}(?:\bto\b|→|compared (?:to|with)|\bvs\.?|\bversus\b)[^\d]{0,25}$/i.test(ix.t.slice(first.e, y.s)) && !otherMention(first.e, y.s) && ok(y))
        // "16.9° before surgery, 10.9° after surgery": a number followed by an after-surgery phrase
        || [first, ...after.filter(y => y.s > first.e && y.s - first.e < 120)].find(y => /^\s*[°%]?\s*(?:\([^)]{0,40}\)\s*)?(?:after (?:the )?surgery|postoperative(?:ly)?|at (?:the )?(?:final|last) follow[- ]?up)\b/i.test(ix.t.slice(y.e, y.e + 70)) && !otherMention(h.e, y.s) && ok(y));
      if (!x || !ok(x)) continue;
    } else if (claim.role === 'pre' && !(fl.times.includes('pre') || /^[^\d]{0,40}(?:\bto\b|→)/.test(ix.t.slice(first.e, first.e + 60)))) continue;
    seen.add(h.sent);
    if (chosen && x.s === chosen.num.s) continue;
    // a final-follow-up column: the number the same sentence gives "at last follow-up" is the final value; one "after surgery" is an earlier time
    const FINAL = /^\s*[°%]?\s*(?:\([^)]{0,40}\)\s*)?[,;]?\s*at (?:the )?(?:final|last|latest) follow[- ]?up\b/i;
    if (ctx.finalColumn && claim.role === 'post' && !FINAL.test(ix.t.slice(x.e, x.e + 70)) && ix.nums.some(n => n.sent === h.sent && n.vals.some(q => matchNumber(cv, cdec, q)) && FINAL.test(ix.t.slice(n.e, n.e + 70)))) continue;
    const post = ix.t.slice(x.e, Math.min(S.e, x.e + 14));
    let v = x.vals[0].v, vdec = x.vals[0].dec;
    if (M.kind === 'time') {
      const u = (post.match(/^\s*(years?|yrs?|y|months?|mo|weeks?|days?)\b/i) || [])[1];
      if (!u) continue;
      const f = TO_MONTHS[u.toLowerCase()] || 1;
      if (f !== 1) { v = v * f; vdec = Math.max(1, cdec); }
    }
    if (M.kind === 'distance' && claim.unit === 'mm' && /^\s*cm\b/i.test(post)) { v *= 10; vdec = Math.max(0, vdec - 1); }
    // the same value written to fewer decimals, rounded or cut ("66.2" for 66.26), is the same value
    const precise = chosen?.num?.vals?.[0]?.v, pd = chosen?.num?.vals?.[0]?.dec ?? cdec;
    const same = eq(roundTo(v, cdec), cv) || eq(roundTo(cv, Math.min(vdec, cdec)), roundTo(v, Math.min(vdec, cdec))) || (M.kind === 'time' && Math.abs(v - cv) <= Math.max(0.6, cv * 0.01))
      || (precise != null && pd > vdec && (eq(roundTo(precise, vdec), v) || eq(Math.trunc(precise * 10 ** vdec) / 10 ** vdec, v)));
    if (same) continue;
    // VAS for the back is not VAS for the leg
    if (claim.qual?.site) { const near = ix.t.slice(Math.max(S.s, h.s - 25), Math.min(S.e, x.s)); const sites = near.match(/\b(back|leg|neck|arm)\b/gi) || []; if (sites.length && !sites.some(w => w.toLowerCase() === claim.qual.site)) continue; if (!sites.length && /\b(back|leg|neck|arm)\b/i.test(text)) continue; }
    if (M.range && (v < M.range[0] || v > M.range[1])) continue;
    out.push({ v: x.raw + (v !== x.vals[0].v ? ` (${roundTo(v, 1)} ${claim.unit || ''})`.replace(/ \)/, ')') : ''), page: x.page, zone: h.zone, text: snippet(ix, h.sent, x.s) });
  }
  return out;
}

// a spread beside its estimate: the number right after the estimate, joined by ± or SD (or in brackets after it), in the study's own words;
// an interval's limit where the paper gives an interval. Pushes the premise and answers true, or false.
const SPREAD_GAP = /^\s*(?:\(\s*)?(?:±|\+\/-|SD|SE|SEM|s\.d\.|standard deviation)\s*[:=,]?\s*$|^\s*\(\s*$/i;
export function besideEstimate(ix, c, P) {
  const ok = (v, dec, x) => x.vals.some(q => { const m = matchNumber(v, dec, q); return m === 'exact' || m === 'rounded'; });
  for (let i = 0; i < ix.nums.length; i++) {
    const x = ix.nums[i];
    if (x.word || x.label || NOT_STUDY.has(x.zone) || !ok(c.v, c.dec, x)) continue;
    if (c.spread === 'ci') {
      const around = ix.t.slice(Math.max(0, x.s - 70), Math.min(ix.t.length, x.e + 40));
      if (!/\bCI\b|confidence interval|\b9[059]\s*%/i.test(around)) continue;
      P.rule = 'source'; P.premises.push({ kind: 'source', page: x.page, zone: x.zone, at: x.s, text: snippet(ix, x.sent, x.s), how: 'a limit of the interval the paper gives' });
      return true;
    }
    if (c.est == null) { if (x.pm) { P.rule = 'source'; P.premises.push({ kind: 'source', page: x.page, zone: x.zone, at: x.s, text: snippet(ix, x.sent, x.s), how: 'a spread the paper writes after ±' }); return true; } continue; }
    const e = ix.nums[i - 1];
    if (!e || e.word || x.s - e.e > 25 || !ok(c.est, c.estDec ?? 0, e) || !SPREAD_GAP.test(ix.t.slice(e.e, x.s))) continue;
    P.rule = 'source'; P.premises.push({ kind: 'source', page: x.page, zone: x.zone, at: x.s, text: snippet(ix, x.sent, x.s), how: `the spread beside its estimate ${e.raw}` });
    return true;
  }
  return false;
}

// ---- proving one claim ---------------------------------------------------------------------------------------------------------------
function proveClaim(ix, c0, ctx) {
  const P = { rule: '', premises: [], strength: '', findings: [] };
  // a claim about something the lexicon does not name is anchored by the words of its own label
  let c = c0.unit === 'levels' && /stat|range/.test(c0.type) ? { ...c0, measure: 'levels' } : !c0.measure && (c0.label || c0.unit) && /count|stat|range|percent/.test(c0.type) ? { ...c0, measure: adhocMeasure(ix, c0.label || '') } : c0;
  // a number of an outcome's columns (O1 change mean, O1 percent change) with no measure of its own is about that outcome: the outcome the
  // row names (its O1 outcome cell, "Y-BOCS total score") ties it, as a measure the paper mentions (31 Oct 2026)
  if (ctx.hintMeasure && /count|stat|range|percent/.test(c.type) && (!c.measure || (c.measure.startsWith('adhoc:') && !(ix.mentions[c.measure] || []).length))) c = { ...c, measure: ctx.hintMeasure, hinted: true };
  const F = (level, kind, text, extra = {}) => P.findings.push({ level, kind, text, ...extra });
  const M = MEASURE[c.measure];
  // a number the trial's sources hold that the kernel cannot tie to its measure (a measure the lexicon does not know, a registry line),
  // kept by a reviewer with a recorded reason: the value rests on that decision (an axiom, listed), not on the kernel's reading. A number
  // in none of the sources stays unproven: a decision does not put it there.
  const keptFound = P => {
    if (P.ok || ctx.decision !== 'kept' || P.findings.some(f => f.level === 'error') || !P.findings.some(f => f.kind === 'weak' || f.kind === 'table-cell')) return;
    P.findings = P.findings.filter(f => !['weak', 'table-cell', 'quote', 'missing'].includes(f.kind)); P.rule = 'axiom'; P.axiom = `kept${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: 'kept (the number is in the sources)' }); P.ok = true;
  };
  const quoteHas = (v, dec) => ctx.quoteNums.some(q => matchNumber(v, dec, q) === 'exact' || matchNumber(v, dec, q) === 'rounded');
  const derived = v => ctx.derivedGives.some(g => eq(Number(g), v));
  // a recorded quote proves a number only as a source would: the number inside the quote, tied to the claim's measure (or, for a phrase
  // the lexicon does not know, the quote is the reviewer's own pointer to it), never a number the quote gives to something else
  const viaQuote = (v, dec, opts = {}) => {
    if (!ctx.quoteSpans.length || !quoteHas(v, dec)) return false;
    const A = anchorNumber(ix, c, v, dec, opts), inside = A.all.filter(a => ctx.quoteSpans.some(q => a.num.s >= q.s && a.num.e <= q.e));
    const tied = inside.find(a => a.near >= 2 || (!MEASURE[c.measure] && a.near >= 1) || !c.measure);
    // or a short quote (at most four sentences, chosen by a reviewer) that names the measure and holds this number once: the quote ties them
    const shortQ = q => q.e - q.s <= 600 && ix.sents.filter(S => S.e > q.s && S.s < q.e).length <= 4;
    // (a phrase of the cell's own words, which the paper need not repeat, is tied by the quote alone)
    const tiedQ = !tied && c.measure && inside.length === 1 && ctx.quoteSpans.some(q => shortQ(q) && inside[0].num.s >= q.s && inside[0].num.e <= q.e && (c.measure.startsWith('adhoc:') || (ix.mentions[c.measure] || []).some(h => h.s >= q.s && h.e <= q.e))) ? inside[0] : null;
    if (tiedQ) { P.rule = 'quote'; P.premises.push({ kind: 'quote', zone: tiedQ.zone, page: tiedQ.page, at: tiedQ.num.s, text: snippet(ix, tiedQ.num.sent, tiedQ.num.s), how: 'the quote names the measure and holds this number once' }); return true; }
    if (tied) { P.rule = 'quote'; P.premises.push({ kind: 'quote', zone: tied.zone, page: tied.page, at: tied.num.s, text: snippet(ix, tied.num.sent, tied.num.s) }); return true; }
    if (inside.length) F('unproven', 'quote', `the recorded quote shows ${v}, but not as ${MEASURE[c.measure]?.label || c.measure}`, { at: place(ix, inside[0]) });
    // a number of the reviewer's quote in a passage the kernel reads as about another study (a table's cells run into prose that cites
    // others: Fontaine 2010's Table 2): proven by the quote, on that reading, which is listed
    const attr = !inside.length && A.outside.find(o => o.attributed && ctx.quoteSpans.some(q => o.num.s >= q.s && o.num.e <= q.e));
    if (attr) { P.rule = 'quote'; P.premises.push({ kind: 'quote', zone: attr.zone, page: attr.page, at: attr.num.s, text: snippet(ix, attr.num.sent, attr.num.s) }); F('interpretation', 'attributed', `${v}: the passage reads as about another study; the recorded quote places it in this study`, { at: place(ix, { ...attr, why: [] }) }); return true; }
    return false;
  };
  const viaDerivation = v => { if (derived(v)) { P.rule = 'derivation'; P.premises.push({ kind: 'derivation', how: ctx.how }); return true; } return false; };
  // a table read twice (text layer and page image, agreeing): the number in a row named by the measure, or a count of the rows that name it
  const MEASURE_ANY = t => Object.values(MEASURE).some(M => M.re && M.kind !== 'demographic' && M.re.test(t));
  const viaTable = (v, dec) => {
    for (const T of ctx.tables || []) {
      // a label broken over two lines ("Proximal junctional" / "kyphosis"): a row of one lowercase word or phrase after a row of values continues its label
      const rowsM = [];
      for (const r of T.rows) {
        const cells = r.map(x => String(x ?? '')), filled = cells.filter(x => x.trim() && x !== '·');
        const prev = rowsM[rowsM.length - 1];
        if (prev && filled.length === 1 && /^[a-z(]/.test(filled[0].trim()) && !/\d/.test(filled[0]) && prev.slice(1).some(x => /\d/.test(String(x ?? '')))) { const k = cells.findIndex(x => x.trim() && x !== '·'); prev[k] = `${String(prev[k] ?? '').trim()} ${filled[0].trim()}`; continue; }
        rowsM.push([...r]);
      }
      // a known measure by its pattern; a phrase the lexicon does not know only when every one of its words is in the label
      const adhoc = c.measure?.startsWith('adhoc:') ? c.measure.slice(6).split(' ').filter(w => !/^(level|segment|vertebra)$/.test(w)) : null;
      let re = c.measure && MEASURE[c.measure] ? MEASURE[c.measure].re : adhoc?.length ? { test: s => adhoc.every(w => new RegExp(`\\b${w.slice(0, 5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(s)) } : null;
      if (!re) continue;
      const re0 = re, abbrs = ix.abbr?.[c.measure] || [];
      if (abbrs.length) re = { test: x => re0.test(x) || abbrs.some(ab => new RegExp(`\\b${ab}\\b`).test(x)) };
      // the header: every row above the first row of numbers, joined per column ("Scoliotic Cobb Angle" over "Postop" over "(Mean + SD)")
      const isNum = x => /(?<![A-Za-z])\d/.test(String(x ?? '')) && !/\bn\s*=|^\s*[A-Za-z]{2,}|^\s*\d+\s*[-‐]?\s*(?:months?|mos?|years?|yrs?|y|weeks?|wks?|days?|h|hours?)\b/i.test(String(x ?? ''));
      const fd = rowsM.findIndex(r => r.slice(1).some(isNum)), firstData = fd < 0 ? 1 : fd;
      // a section row just above the first row of numbers ("VAS" over "Single-Stage") names those rows; it is not part of the header
      const isSection = r => { const f = r.map((x, k) => [k, String(x ?? '').trim()]).filter(([, x]) => x && x !== '·'); return f.length === 1 && f[0][0] === 0 && !/\d/.test(f[0][1]); };
      let headEnd = firstData; while (headEnd > 1 && isSection(rowsM[headEnd - 1])) headEnd--;
      const section0 = headEnd < firstData ? String(rowsM[firstData - 1][0]) : '';
      const width = Math.max(...rowsM.map(r => r.length));
      const head = Array.from({ length: width }, (_, k) => rowsM.slice(0, headEnd).map(r => String(r[k] ?? '')).filter(x => x.trim() && x !== '·').join(' '));
      // a caption's title is often on its own line under "Table 2": read it from the paper's text
      let capText = `${T.caption || ''} ${captionOf(ix, T.table)}`;
      // no caption: the table the text layer places this table's numbers in, on the same page ("Table IV")
      if (!/^\s*Table\s/i.test(T.caption || '') && !/^Table\s/i.test(T.table || '')) {
        const raws = new Set(rowsM.slice(firstData).flatMap(r => r.slice(1)).map(x => (String(x ?? '').match(/\d+(?:[.,]\d+)?/) || [])[0]).filter(x => x && x.length >= 3));
        const tabs = {}; for (const n of ix.nums) if (n.page === T.page && n.table && raws.has(n.raw)) tabs[n.table] = (tabs[n.table] || 0) + 1;
        const best = Object.entries(tabs).sort((x, y) => y[1] - x[1])[0];
        if (best && best[1] >= Math.min(2, raws.size)) capText += ` ${captionOf(ix, best[0])}`;
      }
      // in a final-follow-up column, a row at an earlier time than another row of the same measure is not the final value
      const timeOf = s => (/\bearly\b|\bimmediate/i.test(s) ? 0.5 : monthsOf(s));
      // the rows of this measure: those its label names, or every row when the caption or the header names it
      const tableWide = re.test(capText) || head.some(x => re.test(x));
      const rowTimes = rowsM.slice(1).filter(r => tableWide || re.test(String(r[0] || ''))).map(r => timeOf(r.join(' '))).filter(x => x != null);
      const lastTime = rowTimes.length ? Math.max(...rowTimes) : null;

      // a section row (a label over empty cells: "VAS", then "Single-Stage", "Two-Stage") names the measure of the rows under it
      let section = section0;
      const blank = x => /^\s*[·\-–—]?\s*$/.test(String(x ?? ''));
      for (const [ri, row] of rowsM.entries()) {
        if (ri < firstData) continue;
        // a section row: text in the first columns, the value columns empty ("VAS", "Dynamic group", "age in yrs")
        const filled = row.map((x, k) => [k, String(x ?? '')]).filter(([, x]) => !blank(x));
        if (filled.length && !filled.some(([, x]) => isNum(x)) && filled[filled.length - 1][0] < width - 1 && row.slice(filled[filled.length - 1][0] + 1).every(blank)) { section = filled[filled.length - 1][1]; continue; }
        const labelOf = ci => { const before = row.slice(0, ci).map(x => String(x ?? '')).filter(x => !blank(x) && !isNum(x) && x.length <= 80); return before.length ? before[before.length - 1] : String(row[0] || ''); };
        let label = String(row[0] || '');
        for (const [ci, cell] of row.entries()) {
          if (ci === 0) continue;
          label = labelOf(ci);
          const rowLabels = row.slice(0, ci).map(x => String(x ?? '')).filter(x => !blank(x) && !isNum(x) && x.length <= 80).join(' ');
          // the cell's numbers, not the digits of a level (L2) or a label; for a count, only the cell's first number (n of "20/29", "8 (66.7%)")
          const nums = [...String(cell || '').replace(/(\d),(\d)/g, '$1.$2').matchAll(/(?<![A-Za-z\d.])-?\d+(?:\.\d+)?/g)].map(m => ({ v: Number(m[0]), dec: (m[0].split('.')[1] || '').length }));
          // a cell's first number is its estimate; what follows is its spread (± SD, a range, an interval) or the percentage of a count
          const pctNums = [...String(cell || '').replace(/(\d),(\d)/g, '$1.$2').matchAll(/(?<![A-Za-z\d.])(-?\d+(?:\.\d+)?)\s*%/g)].map(m => ({ v: Number(m[1]), dec: (m[1].split('.')[1] || '').length }));
          // a cell that is a range ("1-20") gives no estimate
          const pctParen = /\(\s*%\s*\)|n\s*\(\s*%\s*\)/i.test(`${label} ${head[ci] || ''}`) ? [...String(cell || '').replace(/(\d),(\d)/g, '$1.$2').matchAll(/\(\s*(\d+(?:\.\d+)?)\s*%?\s*\)/g)].map(m => ({ v: Number(m[1]), dec: (m[1].split('.')[1] || '').length })) : [];
          // a count written as its percentage with the fraction after it ("48%(12/25)"): the fraction's numerator, when its denominator is the claim's
          const frac = String(cell || '').match(/^\s*\d+(?:[.,]\d+)?\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
          const cand = c.type === 'count' && frac ? (c.N == null || Number(frac[2]) === c.N ? [{ v: Number(frac[1]), dec: 0 }] : []) : c.type === 'percent' ? [...pctNums, ...pctParen] : /^\s*-?\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*$/.test(String(cell || '')) ? [] : nums.slice(0, 1);
          // a count (and a group size, n) is a whole number the cell gives exactly: 27.5 is not 28 patients, 30.0 months is not 30 patients
          const hit = cand.find(x => (c.type === 'count' || c.role === 'n' ? matchNumber(v, dec, x) === 'exact' && x.dec === 0 && Number.isInteger(x.v) : matchNumber(v, dec, x) === 'exact' || matchNumber(v, dec, x) === 'rounded'));
          if (!hit) continue;
          // the measure named by the row or the column; by the caption alone only when nothing else must be told apart (no site, no arm, a labelled row)
          const qualWords = [...String(c.label || '').matchAll(/\(([^)]+)\)/g)].flatMap(m => m[1].split(/\s+/)).filter(w => w.length >= 2 && !/^(?:of|in|at|the|and)$/i.test(w));
          const named = re.test(label) || re.test(rowLabels) || (section && re.test(section) && !MEASURE_ANY(label)) || re.test(head[ci] || '') || (qualWords.length >= 2 && qualWords.every(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${capText} ${rowLabels}`))) || (re.test(capText) && c.type !== 'count' && label.trim() && !c.qual?.site);
          if (!named) continue;
          // the role in the row or the column's header (pre / post) must not contradict the claim's, and a header that gives a group size
          // ("OI-Focused (n = 12)") must be the arm's
          const h = head[ci] || '', rowText = row.filter((_, k) => k !== ci).join(' ') + ' ' + h;
          if (c.role === 'pre' && /post|final|last|follow|\bmonths?\b|\byears?\b/i.test(rowText) && !/\bpre/i.test(rowText)) continue;
          if (c.role === 'post' && /\bpre/i.test(rowText) && !/post|final|last|follow|\bmonths?\b|\byears?\b/i.test(rowText)) continue;
          const hn = (h.match(/\bn\s*=\s*(\d+)/i) || [])[1];
          if (hn && ctx.armN && Number(hn) !== ctx.armN) continue;
          // a column of group sizes ("N") in the row must give the arm's size
          const nCol = head.findIndex(x => /^\s*n\s*$/i.test(x));
          if (nCol > 0 && nCol !== ci && ctx.armN && /^\d+$/.test(String(row[nCol] || '').trim()) && Number(row[nCol]) !== ctx.armN) continue;
          if (ctx.finalColumn && c.role === 'post' && lastTime != null) { const t = timeOf(rowText); if (t != null && t < lastTime - 0.5) continue; }
          // the same for times in the columns' headers ("Postoperative (3 Months)" beside "24 Months")
          if (ctx.finalColumn && c.role === 'post') { const ht = head.map(timeOf).filter(x => x != null), t = timeOf(h); if (t != null && ht.length && t < Math.max(...ht) - 0.5) continue; }
          // the arm: a column headed by the other arm's treatment words is not this arm's ("Fusion Group" for the dynamic arm)
          if (ctx.armWords?.length && ctx.otherArmWords?.length) {
            const hw = String(h).toLowerCase(), mine = ctx.armWords.some(w => hw.includes(w)), theirs = ctx.otherArmWords.some(w => hw.includes(w));
            if (theirs && !mine) continue;
            // and a row labelled by the other arm ("Single-Stage" under "VAS") is not this arm's
            const lw = `${rowLabels} ${section}`.toLowerCase(), lMine = ctx.armWords.some(w => lw.includes(w)), lTheirs = ctx.otherArmWords.some(w => lw.includes(w));
            if (lTheirs && !lMine) continue;
          }
          if (c.qual?.site && /\b(back|leg|neck|arm)\b/i.test(label + h) && !new RegExp(`\\b${c.qual.site}\\b`, 'i').test(label + h)) continue;
          // the table's own count against its own percentage and the group size in its header ("1 (1.8%)" under "n = 52" is 1.9%)
          if (c.type === 'count') { const pp = String(cell).match(/\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/), N = hn ? Number(hn) : c.N; if (pp && N) { const d = (pp[1].split('.')[1] || '').length; if (Math.abs(100 * v / N - Number(pp[1])) > 0.5 * 10 ** -d + 0.051) F('interpretation', 'paper-percent', `${T.table} gives ${String(cell).trim()} for a group of ${N}: ${v}/${N} is ${Math.round(1000 * v / N) / 10}% (the paper's own arithmetic)`, { at: { page: T.page, zone: 'table', text: `${T.table}, row "${label.slice(0, 60)}"` } }); } }
          // read twice (PDF and page image) or read once from the PDF's own text positions (exact characters, one route)
          P.rule = T.route === 'pdf' ? 'table-geometry' : 'table-read'; P.premises.push({ kind: 'table', page: T.page, zone: 'table', text: `${T.table}, row ${ri + 1} "${label.slice(0, 50)}", column ${ci + 1} "${h.slice(0, 40)}": ${String(cell).slice(0, 40)}` });
          return true;
        }
      }
      if (c.type === 'count') {
        const rows = rowsM.slice(1).filter(r => re.test(r.join(' ')));
        if (rows.length === v && T.route !== 'pdf') { P.rule = 'table-count'; P.premises.push({ kind: 'table', page: T.page, zone: 'table', text: `${T.table}: ${rows.length} rows name ${MEASURE[c.measure]?.label || c.measure}` }); return true; }
      }
    }
    return false;
  };
  const plausible = (v, dec) => {
    // a change, a difference or a percent change of a measure can be negative or beyond its range; a spread is not a value of it
    // a measure taken from the outcome's name is matched by its words, not known by its scale (a Neuro-QoL T-score is no bone T-score)
    if (!M?.range || c.approx || c.spread || c.hinted || /change|differen|decrement|improvement|reduction/i.test(ctx.columnText || '')) return;
    const [lo, hi] = M.range;
    if (c.measure === 'vas' && v > 10 && !/100/.test(c.qual?.scale || '') && !ctx.cellScale100) F('warn', 'scale', `VAS ${v} is above 10: the cell should name the 0–100 scale`);
    if (c.measure === 'sva' && c.unit === 'cm') return;
    if (v < lo || v > hi) F('error', 'range', `${M.label} ${v} is outside its valid range ${lo} to ${hi}`);
  };
  const doubt = (a, label) => {
    if (!a) return;
    const fl = a.flags || {};
    const x = a.num, pre = ix.t.slice(Math.max(0, x.s - 22), x.s), post = ix.t.slice(x.e, x.e + 40);
    // a hedge on this number ("approximately 30", "up to 9", "< 5"), not elsewhere in the sentence
    const hedge = pre.match(/(\b(?:approximately|approx\.?|about|around|nearly|almost|roughly|up to|at least|at most|more than|less than|over|under|>|<|≥|≤|~|≈)\s*)$/i);
    if (hedge && !c.bound && !c.approx && a.zone !== 'table') F('interpretation', 'hedged', `${label}: the paper says "${hedge[1].trim()} ${x.raw}"`, { at: place(ix, a) });
    // a count of levels, screws or segments is not a count of patients
    const unit = c.type === 'count' && post.match(/^\s*(?:\([^)]*\)\s*)?(?:of (?:the |all )?\d+ )?(levels?|segments?|screws?|rods?|dis[ck]s?|sides?|implants?|vertebrae)\b/i);
    if (unit) F('interpretation', 'denominator', `${label}: the paper counts ${unit[1].toLowerCase()} here, not patients`, { at: place(ix, a) });
    if (c.type !== 'count' && fl.stats?.includes('median') && !fl.stats.includes('mean') && c.qual?.stat !== 'median' && ctx.wantsMean) F('interpretation', 'statistic', `${label}: the paper gives a median here; the column asks for a mean`, { at: place(ix, a) });
    // final follow-up: a value measured at a time earlier than the latest the paper reports for the same measure (the time said nearest
    // before the number, so "at 6 months (17.12 …), maintained at 9 months (17.11 …)" reads 17.11 as the 9-month value)
    if (ctx.finalColumn && c.role === 'post' && !c.qual?.time && !fl.times?.includes('final')) {
      const mo = localTime(ix, x), latest = latestTime(ix, c.measure);
      if (mo != null && latest && latest.mo > mo + 0.5) F('interpretation', 'timepoint', `${label}: measured at ${Math.round(mo * 10) / 10} months; the paper also reports ${M?.label || c.measure} at ${latest.text.replace(/^at /i, '')} (p. ${latest.page})`, { at: place(ix, a) });
    }
    if (a.why.includes('sign not in the text layer')) F('warn', 'sign', `${label}: the minus sign is not in the text layer; check the page image`, { at: place(ix, a) });
    if (a.zone === 'discussion' || a.zone === 'introduction') F('warn', 'zone', `${label}: found only in the ${a.zone}`, { at: place(ix, a) });
  };
  const anchor = (v, dec, label, opts = {}) => {
    if (ctx.finalColumn && c.role === 'post' && c.measure) { const lt = latestTime(ix, c.measure); if (lt) opts = { ...opts, latest: lt.mo }; }
    if (ctx.armWords?.length) opts = { ...opts, armWords: ctx.armWords, otherArmWords: ctx.otherArmWords };
    const A = anchorNumber(ix, c, v, dec, opts);
    // a "sentence" of bare numbers (a table's cells read out of order: "19.1 ± 2.2", "8 (25.0) 6 (18.7) …") has no row or column:
    // it is not a source; the table proves the cell (read from the PDF's positions, or twice) or nothing does. The next strong place that
    // is a sentence is (31 Oct 2026: a registry line "(7 patients in 5 years))" hid the main report's own sentence)
    const fragment = a => { const S = ix.sents[a.num.sent]; return (S ? (ix.t.slice(S.s, S.e).match(/[A-Za-z]{3,}/g) || []).length : 9) < 3; };
    if (strength(A.best) === 'strong' && fragment(A.best)) { const alt = A.all.find(a => strength(a) === 'strong' && !fragment(a)); if (alt) A.best = alt; }
    let s = strength(A.best);
    if (s === 'strong' && A.best?.num && fragment(A.best)) s = 'fragment';
    if (s === 'strong') {
      P.rule = A.best.match === 'rounded' ? 'rounded' : s === 'table' ? 'table' : 'source';
      P.strength = s;
      P.premises.push({ kind: 'source', ...place(ix, A.best), match: A.best.match });
      doubt(A.best, label);
      // the polarity of an event count: "no screw loosening" cannot prove 3 loosened screws
      if (c.type === 'count' && v > 0 && A.best.flags?.negated && A.best.mention && A.best.near === 3) {
        const S = ix.sents[A.best.num.sent], seg = ix.t.slice(S.s, S.e), m = A.best.mention, x = A.best.num;
        const negBefore = /\b(no|not|without|none|never|neither|nor|free of|absence of)\b[^.;,]{0,40}$/i.test(ix.t.slice(S.s, m.s));
        const between = ix.t.slice(Math.min(x.e, m.e), Math.max(x.s, m.s));
        // the number and the negated mention in one clause: "no screw loosening (3 patients)" cannot prove three
        if (negBefore && !/[;,]|\b(and|but|while|whereas)\b/.test(between) && !/\b(except|but|apart from|other than|only)\b/i.test(seg)) F('error', 'polarity', `${label}: the passage negates ${M?.label || c.measure}`, { at: place(ix, A.best) });
      }
      const others = otherValues(ix, c, v, dec, A.best, ctx);
      for (const o of others) {
        const contra = (o.zone === 'abstract') !== (A.best.zone === 'abstract') && OWN_ZONES.has(A.best.zone);
        F(contra ? 'conflict' : 'interpretation', contra ? 'contradiction' : 'other-value', `${label}: the paper also gives ${o.v} for ${M?.label || c.measure}${contra ? ` (${o.zone} p. ${o.page} vs ${A.best.zone} p. ${A.best.page})` : ''}`, { at: o });
      }
      return true;
    }
    if (viaTable(v, dec) || viaQuote(v, dec, opts) || viaDerivation(v)) return true;
    // a number in a table that names the measure somewhere, its row lost in the text layer: the table must be read (pdf-tables or table-read)
    if (s === 'table') { P.premises.push({ kind: 'weak', ...place(ix, A.best) }); F('unproven', 'table-cell', `${label}: in ${A.best.num.table || 'a table'} (p. ${A.best.page}), but its row and column are lost in the text; read the table`, { at: place(ix, A.best) }); return false; }
    // a unit conversion the kernel can check: cm → mm, years → months, days or weeks → months
    for (const [f, unitHow] of conversions(c)) {
      const src = roundTo(v / f, 6), A2 = anchorNumber(ix, c, src, Math.max(0, dec - Math.round(Math.log10(f))), opts);
      const cands = A2.all.filter(a => a.near >= 1 && a.score >= 2);
      const near2 = cands.length ? cands : (() => {
        // the paper may give more decimals: look for numbers that times f round to v
        const hits = [];
        for (const x of ix.nums) for (const val of x.vals) if (!x.word && !NOT_STUDY.has(x.zone) && eq(roundTo(val.v * f, dec), v) && val.dec >= 1) {
          const { near } = mentionNear(ix, c.measure, x);
          if (near >= 1) hits.push({ num: x, near, score: near + 1, zone: x.zone, page: x.page, flags: sentenceFlags(ix, x.sent) || {}, why: [], match: 'converted' });
        }
        return hits.sort((a, b) => b.score - a.score);
      })();
      if (near2.length) {
        P.rule = 'converted'; P.strength = near2[0].near >= 2 ? 'strong' : 'table';
        P.premises.push({ kind: 'source', ...place(ix, near2[0]), match: 'converted', how: `${near2[0].num.raw} ${unitHow}` });
        F('interpretation', 'unit', `${label}: converted (${near2[0].num.raw} ${unitHow}); the paper's unit is assumed`, { at: place(ix, near2[0]) });
        return true;
      }
    }
    // the paper counts this many with a percentage of another denominator: a reading, not this value
    if (A.denomMismatch?.length && !A.all.some(a => a.near >= 2)) { const d = A.denomMismatch[0]; F('interpretation', 'denominator', `${label}: the paper gives ${d.num.raw} (${d.p}%), a percentage of another denominator than ${c.N}`, { at: { page: d.num.page, zone: d.num.zone, text: snippet(ix, d.num.sent, d.num.s) } }); }
    if (A.outside.length && !A.all.length) {
      const o = A.outside[0];
      F(o.individual ? 'unproven' : 'error', 'scope', `${label}: found only ${o.individual ? 'in an illustrative case (one patient), not as the cohort\'s value' : o.attributed ? 'in a passage about another study' : `in ${o.zone === 'other-article' ? 'another article in the PDF' : o.zone === 'commentary' ? 'an editorial or reviewer comment' : `the ${o.zone}`}`} (p. ${o.page})`);
    } else if (A.best) {
      P.premises.push({ kind: 'weak', ...place(ix, A.best) });
      F('unproven', 'weak', `${label}: the number is in the paper, but not next to ${M?.label || 'the measure'}`, { at: place(ix, A.best) });
    } else F('unproven', 'missing', `${label}: not in the paper`);
    return false;
  };

  switch (c.type) {
    case 'count': {
      if (c.n > c.N) F('error', 'count', `${c.n}/${c.N}: the count is larger than its denominator`);
      if (c.pct != null && !c.pctBound && Math.abs(roundTo(100 * c.n / c.N, c.pctDec) - c.pct) > 1e-9) F('error', 'percent', `${c.n}/${c.N} is ${roundTo(100 * c.n / c.N, Math.max(1, c.pctDec))}%, not ${c.pct}%`);
      // the denominator
      const denom = ctx.armN && c.N === ctx.armN ? { rule: 'arm-size' } : ctx.cohortN && c.N === ctx.cohortN ? { rule: 'arm-size' } : null;
      let nOk = false, dOk = !!denom;
      if (!dOk) { const sub = { ...c, measure: 'patients' }; const A = anchorNumber(ix, sub, c.N, 0, { count: true }); if (A.best && A.best.score >= 1) dOk = true; else if (quoteHas(c.N, 0)) dOk = true; }
      if (!dOk) F('unproven', 'denominator', `denominator ${c.N}: neither the arm's size nor in the paper`);
      // the count
      if (c.n === 0) {
        const stated = absenceStated(ix, c.measure);
        if (stated) { nOk = true; P.rule = 'absence'; P.premises.push({ kind: 'source', ...stated }); }
        else if (ctx.rule || ctx.quoteNegates) { nOk = true; P.rule = ctx.rule ? 'axiom' : 'quote'; P.premises.push(ctx.rule ? { kind: 'axiom', name: ctx.rule } : { kind: 'quote', zone: ctx.quoteZone }); if (ctx.rule) P.axiom = ctx.rule; }
        else if (anchor(0, 0, `${c.label || M?.label || 'count'} 0`, { count: true })) nOk = true;
        else { P.findings = P.findings.filter(f => f.kind !== 'missing' && f.kind !== 'weak'); F('unproven', 'zero', `${c.label || M?.label || 'count'} 0/${c.N}: the paper does not state the absence; a zero needs a stated absence or a named convention`); }
      } else nOk = anchor(c.n, 0, `${c.label || M?.label || 'count'} ${c.n}/${c.N}`, { count: true });
      // a count a reviewer kept under a table convention or a reading of the paper (its reason recorded): an axiom, listed
      if (!nOk && c.n > 0 && ctx.decision === 'kept') { P.findings = P.findings.filter(f => !['missing', 'weak', 'quote'].includes(f.kind)); P.rule = 'axiom'; P.axiom = `kept${ctx.rule ? ` (${ctx.rule})` : ''}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: 'kept' }); nOk = true; }
      P.ok = nOk && dOk && !P.findings.some(f => f.level === 'error');
      if (!P.rule && P.ok) P.rule = denom ? 'arm-size' : 'source';
      return P;
    }
    case 'stat': {
      if (c.role === 'n') {
        P.ok = anchor(c.v, 0, `n=${c.v}`, { count: true });
        // a group's size as its header gives it ("PSS (n = 28)"), when the paper's groups have different sizes: the group is this arm
        if (!P.ok && ctx.multiArm) {
          const hdr = ix.nums.filter(x => x.vals[0].v === c.v && x.vals[0].dec === 0 && OWN_ZONES.has(x.zone) && /\(\s*n\s*=\s*$/i.test(ix.t.slice(Math.max(0, x.s - 8), x.s)));
          const others = new Set(ix.nums.filter(x => /\(\s*n\s*=\s*$/i.test(ix.t.slice(Math.max(0, x.s - 8), x.s)) && x.vals[0].v !== c.v).map(x => x.vals[0].v));
          if (hdr.length && others.size && !others.has(c.v)) { P.findings = P.findings.filter(f => !['missing', 'weak', 'quote'].includes(f.kind)); P.rule = 'source'; P.premises.push({ kind: 'source', ...place(ix, { num: hdr[0], zone: hdr[0].zone, page: hdr[0].page }), how: 'a group header gives this size; the other groups have other sizes' }); P.ok = true; }
        }
        keptFound(P);
        return P;
      }
      plausible(c.v, c.dec);
      if (c.approx) {
        if (ctx.figure) { P.rule = 'axiom'; P.axiom = 'figure read'; P.premises.push({ kind: 'axiom', name: 'figure read' }); P.ok = true; return P; }
        const ok = anchor(c.v, c.dec, `≈${c.v}`);
        if (!ok) { P.findings = P.findings.filter(f => f.kind !== 'missing'); F('unproven', 'figure', `≈${c.v}: read from a figure; record a figure decision with the legend`); }
        P.ok = ok; return P;
      }
      // a spread is proven where the paper writes it beside its estimate ("39.4 ± 13.5", "39.4 (SD 13.5)"), or an interval's limit where the
      // paper gives an interval; else as any number next to its measure
      if (c.spread && besideEstimate(ix, c, P)) { P.ok = true; return P; }
      P.ok = anchor(c.v, c.dec, `${M?.label || c.measure || 'value'}${c.role ? ` ${c.role === 'pre' ? 'before' : 'after'}` : ''}${c.spread ? ` ${c.spread === 'ci' ? 'interval limit' : c.spread.toUpperCase()}` : ''} ${c.v}${c.unit || ''}`, c.spread ? { spread: true } : {});
      // a number a figure prints (a data label), under a figure decision whose quote holds it: the figure read is the premise
      if (!P.ok && ctx.figure && quoteHas(c.v, c.dec)) { P.findings = P.findings.filter(f => !['missing', 'weak', 'quote'].includes(f.kind)); P.rule = 'axiom'; P.axiom = 'figure read (a number the figure prints)'; P.premises.push({ kind: 'axiom', name: 'figure read' }); P.ok = true; }
      keptFound(P);
      return P;
    }
    case 'percent': {
      // a share of the arm (women, responders) is k of n; a percent change of a score, a threshold ("≥50% reduction") or an interval is not
      const proportion = !c.threshold && !/\b(?:change|reduction|improvement|decrease|increase|differen\w*|relative|percent_change)\b|_change\b/i.test(`${ctx.columnText} ${c.label || ''}`);
      if (c.v > 100 && proportion) F('error', 'percent', `${c.v}% is above 100%`);
      const n = proportion ? ctx.armN || ctx.cohortN : null;
      let ok = anchor(c.v, c.dec, `${c.v}% ${M?.label || ''}`.trim(), { pct: true });
      if (!ok && n) {
        // the percentage of a count the paper gives: k of n
        for (let k = 0; k <= n; k++) if (eq(roundTo(100 * k / n, c.dec), c.v)) {
          const A = anchorNumber(ix, { ...c, type: 'count' }, k, 0, { count: true });
          if (strength(A.best) === 'strong') { P.findings = P.findings.filter(f => f.kind !== 'missing' && f.kind !== 'weak'); P.rule = 'arith'; P.premises.push({ kind: 'source', ...place(ix, A.best), how: `${k}/${n} = ${roundTo(100 * k / n, 1)}%` }); ok = true; break; }
        }
        if (!ok && !Array.from({ length: n + 1 }, (_, k) => eq(roundTo(100 * k / n, c.dec), c.v)).some(Boolean)) F('error', 'percent', `${c.v}%: no count out of ${n} gives it`);
      }
      P.ok = ok && !P.findings.some(f => f.level === 'error');
      keptFound(P);
      return P;
    }
    case 'range': {
      // the range as the paper writes it ("3–5 levels", "three to five levels", "between 3 and 5")
      const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
      const alt = v => (Number.isInteger(v) && v <= 12 ? `(?:${v}|${W[v]})` : String(v).replace('.', '[.,]'));
      const re = new RegExp(`\\b${alt(c.lo)}\\s*(?:°\\s*)?(?:–|-|to|and)\\s*${alt(c.hi)}\\b`, 'gi');
      // and about the same thing: its unit right after it ("3–6 levels", "4–6 months") or the measure in the same sentence
      const unitRe = c.unit === 'levels' ? /^\s*(?:\)\s*)?(?:-?\s*)?(?:levels?|segments?|vertebrae)\b/i : c.unit ? new RegExp(`^\\s*(?:\\)\\s*)?${c.unit === 'mo' ? '(?:months?|mo)' : c.unit === 'y' ? '(?:years?|y)' : c.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
      const hit = [...ix.t.matchAll(re)].find(m => {
        if (NOT_STUDY.has(zoneAt(ix, m.index)) || /\n/.test(m[0])) return false;
        const after = ix.t.slice(m.index + m[0].length, m.index + m[0].length + 30);
        if (unitRe && unitRe.test(after)) return true;
        // the measure right after the range, or just before it in the same sentence ("mean age 49.3 years (range, 40–69)")
        return !!c.measure && (ix.mentions[c.measure] || []).some(h => (h.s >= m.index + m[0].length && h.s - (m.index + m[0].length) <= 30) || (h.e <= m.index && m.index - h.e <= 60 && h.sent === sentIndex(ix, m.index) && h.sent >= 0));
      });
      if (hit) { P.rule = 'source'; P.strength = 'strong'; P.premises.push({ kind: 'source', page: pageAt(ix, hit.index), zone: zoneAt(ix, hit.index), at: hit.index, text: snippet(ix, sentIndex(ix, hit.index), hit.index) }); P.ok = true; return P; }
      // a range of levels as the paper's own distribution gives it: one sentence (or one table) of the study's own that counts patients
      // at each number of levels ("3 levels in 18 patients, … and 6 levels in 4"), whose smallest and largest numbers are the range's ends
      if (c.unit === 'levels') {
        const WN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
        const kOf = s => WN[s.toLowerCase()] ?? Number(s);
        const spans = [...ix.sents.map(S => ({ s: S.s, e: S.e, zone: S.zone, table: false }))];
        const tabs = new Map(); for (const L of ix.lines) if (L.table) { const T = tabs.get(L.table) || { s: L.s, e: L.e, zone: L.zone, table: true }; T.e = L.e; tabs.set(L.table, T); }
        spans.push(...tabs.values());
        // a table that counts patients per number of levels ("Surgical levels" then rows 7, 8, 9, 10 with a count per group): the arm's column
        // is the one whose counts add up to the arm's size; its smallest and largest levels with patients are the range's ends
        for (const T of ctx.tables || []) {
          const R = T.rows.map(r => r.map(x => String(x ?? '').trim()));
          const i0 = R.findIndex(r => /\b(?:levels|segments)\b/i.test(r[0]) && r.slice(1).every(x => !/\d/.test(x)));
          if (i0 < 0) continue;
          const body = []; for (const r of R.slice(i0 + 1)) { if (!/^\d{1,2}$/.test(r[0])) break; body.push(r); }
          if (body.length < 2) continue;
          const width = Math.max(...body.map(r => r.length));
          for (let k = 1; k < width; k++) {
            const cnt = body.map(r => /^\d+$/.test(r[k] || '') ? Number(r[k]) : 0), sum = cnt.reduce((a, b) => a + b, 0);
            if (!ctx.armN || sum !== (ctx.multiArm ? ctx.armN : ctx.cohortN || ctx.armN)) continue;
            const ks = body.filter((r, j) => cnt[j] > 0).map(r => Number(r[0]));
            if (Math.min(...ks) === c.lo && Math.max(...ks) === c.hi) { P.rule = T.route === 'pdf' ? 'table-geometry' : 'table-read'; P.premises.push({ kind: 'table', page: T.page, zone: 'table', text: `${T.table}: patients by number of levels, column ${k + 1} (${sum} patients): ${body.map((r, j) => `${r[0]}: ${cnt[j]}`).join(', ')}` }); P.ok = true; return P; }
          }
        }
        // a recorded quote is a passage too (its pieces joined), so a distribution split by a figure on the page can still be read
        if (ctx.quoteSpans.length) spans.push({ s: ctx.quoteSpans[0].s, e: ctx.quoteSpans[0].e, zone: zoneAt(ix, ctx.quoteSpans[0].s), table: false, text: ctx.quoteSpans.map(q => ix.t.slice(q.s, q.e)).join(' ') });
        const VERT = v => { const m = String(v).toUpperCase().match(/^([TLS])(\d{1,2})$/); return m ? ({ T: 0, L: 12, S: 17 })[m[1]] + Number(m[2]) : NaN; };
        const levelsIn = x => {
          const ks = [...x.matchAll(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[-‐]?\s*(?:levels?|segments?)\b/gi)].map(m => kOf(m[1]));
          // a table row of numbers of levels: "Surgical levels 4 5 6 7 8", or "No. instrumented segments 2 12 (80) 3 3 (20)"
          for (const m of x.matchAll(/\b(?:levels|segments)\s+((?:\d{1,2}\s+){2,}\d{1,2})\b/gi)) { const r = m[1].trim().split(/\s+/).map(Number); if (r.every((v, i) => !i || v === r[i - 1] + 1)) ks.push(...r); }
          for (const m of x.matchAll(/\b(?:levels|segments)\s+((?:\d{1,2}\s+\d+\s*\(\s*\d+(?:\.\d+)?%?\s*\)\s*){2,})/gi)) { ks.push(...[...m[1].matchAll(/(\d{1,2})\s+\d+\s*\(/g)].map(q => Number(q[1]))); ks.counted = true; }
          const out = ks.filter(Number.isFinite); out.counted = !!ks.counted; return out;
        };
        // vertebral spans with their counts ("L1–L4 in 3", "L2–L5 2(8.0%)"): a span from L1 to S1 is five levels
        const spansIn = x => [...x.matchAll(/\b([TLS]\d{1,2})\s*[–-]\s*([TLS]?\d{1,2})\s*(?:in\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\d+\s*\()/g)].map(m => { const a = VERT(m[1]), b = VERT(/^\d/.test(m[2]) ? m[1][0] + m[2] : m[2]); return b - a; }).filter(k => k > 0 && k < 20);
        const dist = spans.find(S => {
          if (NOT_STUDY.has(S.zone) || NOT_STUDY.has(zoneAt(ix, S.s))) return false;
          const x = (S.text ?? ix.t.slice(S.s, S.e)).replace(/\s+/g, ' ');
          let ks = levelsIn(x);
          if (new Set(ks).size < 2) { ks = spansIn(x); if (new Set(ks).size < 3) return false; }
          else if (!S.table && !ks.counted && new Set(ks).size < 3 && !/\bin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:patients?|cases?)\b|\bin\s+\d+\s*\(/i.test(x)) return false;
          return Math.min(...ks) === c.lo && Math.max(...ks) === c.hi;
        });
        // an arm's range read from a distribution that names no arm is the whole cohort's: a reading
        // whose patients? the counts of the distribution add up to this arm's size (its own), or to the cohort's (the whole cohort's)
        const WN2 = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
        const distText = dist ? (dist.text ?? ix.t.slice(dist.s, dist.e)).replace(/\s+/g, ' ') : '';
        const sums = [];
        { const xs = [...distText.matchAll(/\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:patients?|cases?)\b/gi)].map(m => WN2[m[1].toLowerCase()] ?? Number(m[1])); if (xs.length >= 2) sums.push(xs.reduce((a, b) => a + b, 0)); }
        { const cols = [...distText.matchAll(/\b[TLS]\d{1,2}\s*[–-]\s*[TLS]?\d{1,2}\s+(\d+)\s*\([^)]*\)\s*(\d+)\s*\(/g)]; if (cols.length >= 2) sums.push(cols.reduce((a, m) => a + Number(m[1]), 0), cols.reduce((a, m) => a + Number(m[2]), 0)); }
        { const ws = [...distText.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+patients\s+had\s+involvement\b/gi)]; const W3 = { ...WN2, thirteen: 13, fourteen: 14, fifteen: 15 }; if (ws.length >= 2) sums.push(ws.reduce((a, m) => a + (W3[m[1].toLowerCase()] ?? Number(m[1])), 0)); }
        const ownArm = ctx.armN && sums.includes(ctx.armN), wholeCohort = !ownArm && ctx.cohortN && sums.includes(ctx.cohortN);
        if (dist && ctx.multiArm && !c.qual?.cohort && !(ctx.settled && ctx.why) && (wholeCohort || (!ownArm && !sums.length && !dist.table && !ctx.armWords.some(w => new RegExp(`\\b${w}`, 'i').test((dist.text ?? '') + ix.t.slice(Math.max(0, dist.s - 400), dist.e)))))) F('interpretation', 'arm', `${c.lo}–${c.hi} levels: ${wholeCohort ? `the paper's distribution is for the whole cohort (${ctx.cohortN}), not this arm` : 'the paper\'s distribution does not name this arm'}`, { at: { page: pageAt(ix, dist.s), zone: zoneAt(ix, dist.s), text: (dist.text ?? ix.t.slice(dist.s, dist.e)).replace(/\s+/g, ' ').slice(0, 220) } });
        if (dist) { P.rule = 'source'; P.strength = 'strong'; P.premises.push({ kind: 'source', page: pageAt(ix, dist.s), zone: zoneAt(ix, dist.s), at: dist.s, text: ix.t.slice(dist.s, Math.min(dist.e, dist.s + 220)).replace(/\s+/g, ' '), how: `the smallest and largest numbers of levels the paper counts patients at are ${c.lo} and ${c.hi}` }); P.ok = true; return P; }
      }
      // the two ends found apart do not prove a range; a quote or a derivation that gives both does
      if (ctx.quoteSpans.some(q => re.test(ix.t.slice(q.s, q.e).replace(/\s+/g, ' ')) && !(re.lastIndex = 0))) { P.rule = 'quote'; P.premises.push({ kind: 'quote' }); P.ok = true; return P; }
      if (viaDerivation(c.lo) && viaDerivation(c.hi)) { P.ok = true; return P; }
      if (ctx.decision) { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; return P; }
      F('unproven', 'range', `${c.lo}–${c.hi}${c.unit ? ` ${c.unit}` : ''}: the paper does not state this range; a derivation (from a table's counts) or a decision proves it`);
      P.ok = false; return P;
    }
    case 'identity': {
      // the first author in the paper's front matter (or on a page header) and the year among its first page's numbers or headers
      const head = ix.t.slice(0, Math.min(ix.t.length, (ix.pageStarts[1] || 4000) + 600));
      const ok = c.role === 'author' ? new RegExp(`\\b${c.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ı/g, '[iı]')}`, 'i').test(head.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i'))
        : new RegExp(`\\b${c.label}\\b`).test(head) || ix.lines.some(L => /\b(19|20)\d\d\b/.test(ix.t.slice(L.s, L.e)) && ix.t.slice(L.s, L.e).includes(c.label) && L.s < 8000);
      if (ok) { P.rule = 'source'; P.premises.push({ kind: 'source', zone: 'front', page: 1 }); P.ok = true; }
      else { F('unproven', 'identity', `${c.role === 'author' ? 'first author' : 'year'} ${c.label} is not on the paper's first page`); P.ok = false; }
      return P;
    }
    case 'level': {
      const re = new RegExp(`\\b${c.label.replace(/^T(\d)/, 'T(?:h)?$1')}\\b`);
      const hit = [...ix.t.matchAll(new RegExp(re.source, 'g'))].find(m => !NOT_STUDY.has(zoneAt(ix, m.index)));
      if (hit) { P.rule = 'source'; P.premises.push({ kind: 'source', page: pageAt(ix, hit.index), zone: zoneAt(ix, hit.index), at: hit.index, text: snippet(ix, sentIndex(ix, hit.index), hit.index) }); P.ok = true; }
      else { F('unproven', 'missing', `level ${c.label}: not in the paper`); P.ok = false; }
      return P;
    }
    case 'term': {
      // a brand's own casing (BalanC is not "balance"), whole words; a name that is also a common word (Transition, Legacy) only beside a device word
      const mixed = /[a-z][A-Z]|^[A-Z]{2,}$/.test(c.label), common = /^(Transition|Legacy|Agile|Satori|Isobar|Graf|Wallis)$/i.test(c.label);
      const re = new RegExp(`\\b${c.label.replace(/[-\s]/g, '[-\\s]?')}\\b`, mixed ? 'g' : 'gi');
      const hit = [...ix.t.matchAll(re)].find(m => !NOT_STUDY.has(zoneAt(ix, m.index)) && (!common || /®|™|\b(system|rod|device|implant|stabili[sz]\w*|screw|Globus|Medtronic|Zimmer|Scient|Paradigm)\b/i.test(ix.t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))));
      if (hit) { P.rule = 'source'; P.premises.push({ kind: 'source', page: pageAt(ix, hit.index), zone: zoneAt(ix, hit.index), at: hit.index, text: snippet(ix, sentIndex(ix, hit.index), hit.index) }); P.ok = true; return P; }
      // a name the paper spells differently (Safinaz, Saphinaz): found, with the spelling listed
      const near = c.label.length >= 5 ? [...ix.t.matchAll(/\b[\p{L}][\p{L}-]{3,}\b/gu)].find(m => !NOT_STUDY.has(zoneAt(ix, m.index)) && Math.abs(m[0].length - c.label.length) <= 2 && m[0].toLowerCase() !== c.label.toLowerCase() && editDistance(m[0].toLowerCase(), c.label.toLowerCase()) <= (c.label.length >= 7 ? 2 : 1)) : null;
      if (near) { P.rule = 'source'; P.premises.push({ kind: 'source', page: pageAt(ix, near.index), zone: zoneAt(ix, near.index), at: near.index, text: snippet(ix, sentIndex(ix, near.index), near.index) }); P.ok = true; if (!(ctx.settled && ctx.why)) F('interpretation', 'spelling', `"${c.label}" is spelled "${near[0]}" in the paper`, { at: { page: pageAt(ix, near.index), zone: zoneAt(ix, near.index), text: snippet(ix, sentIndex(ix, near.index), near.index) } }); return P; }
      if (ctx.decision) { P.rule = 'axiom'; P.axiom = ctx.decision; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else { F('unproven', 'missing', `"${c.label}" is not in the paper`); P.ok = false; }
      return P;
    }
    case 'absent': {
      if (ctx.decision === 'not-in-paper' || ctx.decision === 'kept') { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else if (ctx.verdict === 'not-in-paper' || ctx.verdict === 'agree') { P.rule = 'axiom'; P.axiom = 'NR checked by a reviewer'; P.premises.push({ kind: 'axiom', name: 'NR checked by a reviewer' }); P.ok = true; }
      else { F('unproven', 'absence', `${c.label || M?.label || 'value'} ${c.text}: no reviewer decision that the paper does not report it`); P.ok = false; }
      // the paper may report it after all: numbers next to the measure in the results
      if (c.measure && c.text === 'NR') {
        // a small whole number right after the event, tied to it and to nothing nearer
        const hits = (ix.mentions[c.measure] || []).filter(h => (h.zone === 'results' || h.zone === 'table') && ix.nums.some(x => x.sent === h.sent && x.sent >= 0 && !x.label && !x.pct && x.vals[0].dec === 0 && x.vals[0].v < 1000 && Math.abs(x.s - h.s) < 50 && !/[pP]\s*[<=>\\]\s*$/.test(ix.t.slice(Math.max(0, x.s - 5), x.s)) && nearestMeasure(ix, x)?.id === c.measure));
        if (hits.length) F('interpretation', 'maybe-reported', `${c.label || M.label} NR: the results mention ${M.label} with numbers (p. ${hits[0].page}); check that it is not reported`, { at: { page: hits[0].page, zone: hits[0].zone, text: snippet(ix, hits[0].sent, hits[0].s) } });
      }
      return P;
    }
    case 'paraphrase': {
      const best = bestSentence(ix, c.text);
      if (best && best.overlap >= 0.34) {
        P.rule = 'source'; P.strength = best.overlap >= 0.5 ? 'strong' : 'weak'; P.premises.push({ kind: 'source', page: best.page, zone: best.zone, text: best.text, overlap: Math.round(best.overlap * 100) / 100 }); P.ok = true;
        // polarity and hedging are read against the passage the reviewer quoted (when it is found in the study's own text), else the closest one;
        // a reading a reviewer settled with a reason (a recorded decision) is decided, not open
        const ref = ctx.quoteSpans.length ? { ...best, text: ctx.quoteSpans.map(q => ix.t.slice(q.s, q.e)).join(' ').replace(/\s+/g, ' ') } : best;
        const NEG = /\b(no|not|without|neither|nor|never)\b/i, HEDGE = /\b(may|might|could|appears?|seems?|suggests?|possibly|potentially)\b/i;
        const open = !(ctx.settled && ctx.why);
        if (open && NEG.test(c.text) !== NEG.test(ref.text) && best.overlap >= 0.5) F('interpretation', 'polarity', `the conclusion and ${ref === best ? 'the closest passage' : 'the quoted passage'} differ in negation`, { at: ref });
        if (open && HEDGE.test(ref.text) && !HEDGE.test(c.text)) F('interpretation', 'hedge', `the paper hedges this conclusion ("${ref.text.match(HEDGE)[0]}"); the cell does not`, { at: ref });
        if (!open) P.premises.push({ kind: 'axiom', name: `reading settled by a reviewer: ${ctx.why}` });
      } else if (ctx.decision || ctx.verdict === 'agree') { P.rule = 'axiom'; P.axiom = ctx.decision || 'paraphrase checked by a reviewer'; P.premises.push({ kind: 'axiom', name: P.axiom }); P.ok = true; }
      else { F('unproven', 'paraphrase', 'no passage of the abstract, results or conclusion says this'); P.ok = false; }
      return P;
    }
    case 'identifier': {
      // a registration number as it is written, letters and digits ("NCT00142259", "ClinicalTrials. gov number, NCT00142259."), in any of the
      // trial's sources and any part of them but references, comments and another article (a funding statement or a registry record counts)
      const A = alnumMap(ix), key = c.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      let k = A.s.indexOf(key), hit = null;
      while (k >= 0 && hit == null) { const off = A.pos[k]; if (!/\d/.test(A.s[k + key.length] || '') && !/\d/.test(A.s[k - 1] || '') && !NOT_OWN_WORDS.has(zoneAt(ix, off))) hit = off; else k = A.s.indexOf(key, k + 1); }
      if (hit != null) { P.rule = 'source'; P.premises.push({ kind: 'source', page: pageAt(ix, hit), zone: zoneAt(ix, hit), at: hit, text: snippet(ix, sentIndex(ix, hit), hit) }); P.ok = true; }
      else if (ctx.decision) { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else { F('unproven', 'missing', `${c.label} is not in the trial's reports or registry records`); P.ok = false; }
      return P;
    }
    case 'pointer': {
      // where a value was read: the table or figure must be one of the trial's sources' own captions; a registry record must be among them
      let hit = null;
      if (c.what === 'registry') { const r = (ix.sources || []).find(x => x.kind === 'registry'); if (r) hit = { at: r.start, how: `the registry record ${r.name} is among the trial's sources` }; }
      else {
        const num = c.label.split(' ')[1], bare = num.replace(/(?<=\d)[A-Za-z]$/, '');
        const reOf = n => (c.what === 'figure' ? new RegExp(`^\\s*(?:Supplementa(?:l|ry)\\s+|e)?(?:Fig(?:ure)?\\.?|FIGURE)\\s*${n}\\b`, 'i') : new RegExp(`^\\s*(?:Supplementa(?:l|ry)\\s+|e)?(?:Table|TABLE)\\s*${n}\\b`));
        const find = re => ix.lines.find(x => !NOT_OWN_WORDS.has(x.zone) && re.test(ix.t.slice(x.s, x.e)));
        // a panel ("Figure 6A") is in its figure; a sub-table ("Table 2A") under its own caption or its table's
        const L = find(reOf(num)) || (bare !== num ? find(reOf(bare)) : null);
        if (L) hit = { at: L.s, text: ix.t.slice(L.s, L.e).trim().slice(0, 200) };
      }
      if (hit) { P.rule = 'source'; P.premises.push({ kind: 'source', page: pageAt(ix, hit.at), zone: zoneAt(ix, hit.at), at: hit.at, ...(hit.text ? { text: hit.text } : {}), ...(hit.how ? { how: hit.how } : {}) }); P.ok = true; }
      else if (ctx.decision) { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else { F('unproven', 'pointer', `${c.label} is not in the trial's sources`); P.ok = false; }
      return P;
    }
    case 'report': {
      // a report named in the cell is a record linked to the trial (its reportOf), by its label
      const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const hit = (ctx.reports || []).find(r => fold(r) === fold(c.label));
      if (hit) { P.rule = 'record'; P.premises.push({ kind: 'record', name: hit, how: 'a record linked to this trial' }); P.ok = true; }
      else if (ctx.decision) { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else { F('unproven', 'report', `${c.label} is not a record linked to this trial`); P.ok = false; }
      return P;
    }
    default: {   // judgement: a category the review assigns
      if (ctx.decision) { P.rule = 'axiom'; P.axiom = `${ctx.decision}${ctx.why ? `: ${ctx.why}` : ''}`; P.premises.push({ kind: 'axiom', name: ctx.decision }); P.ok = true; }
      else if (ctx.verdict === 'agree' && ctx.quoteZone) { P.rule = 'judgement'; P.premises.push({ kind: 'quote', zone: ctx.quoteZone }); P.axiom = 'category assigned by a reviewer, with a quote'; P.ok = true; }
      else if (ctx.verdict === 'agree') { P.rule = 'judgement'; P.axiom = 'category assigned by a reviewer'; P.premises.push({ kind: 'axiom', name: P.axiom }); P.ok = true; }
      else { F('unproven', 'judgement', 'a category without a reviewer decision'); P.ok = false; }
      return P;
    }
  }
}

const WORDN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12, eighteen: 18, 'twenty-four': 24 };
/** Months in a stated time ("at 12 months", "2-year follow-up"), or null. */
export function monthsOf(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?|one|two|three|four|five|six|twelve|eighteen|twenty-four)(?:st|nd|rd|th)?\s*[-‐]?\s*(?:postoperative )?(months?|years?|weeks?|mo|yrs?|y|m)\b/i);
  if (!m) return null;
  const n = WORDN[m[1].toLowerCase()] ?? Number(m[1]), u = m[2].toLowerCase();
  return /^y/.test(u) ? n * 12 : /^w/.test(u) ? n / 4.345 : n;
}
/** The time said nearest before a number in its sentence ("at 9 months (17.11 vs 21.54)"), in months, or null. */
export function localTime(ix, x) {
  const S = ix.sents[x.sent];
  if (!S) return null;
  const before = ix.t.slice(S.s, x.s), re = new RegExp(TIME_RE.source, 'gi');
  let last = null;
  for (const m of before.matchAll(re)) last = m[0];
  return last ? monthsOf(last) : null;
}
const TIME_RE = /\b(?:at|after|by)\s+(?:the\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|six|twelve|eighteen|twenty-four)(?:st|nd|rd|th)?[- ]?(?:postoperative )?(?:months?|years?|weeks?|mo|yrs?)\b|\b(?:\d+|one|two|three|six|twelve)(?:st|nd|rd|th)?[- ](?:months?|years?|weeks?)[- ](?:postoperative(?:ly)?|follow[- ]?up|visit)\b/;

/** The latest stated time at which the paper reports a measure: { mo, text, page } or null. */
export function latestTime(ix, measure) {
  let best = null;
  for (const h of ix.mentions[measure] || []) {
    if (!OWN_ZONES.has(h.zone) || h.sent < 0) continue;
    if (sentenceFlags(ix, h.sent).attributed) continue;
    const S = ix.sents[h.sent], text = ix.t.slice(S.s, S.e);
    // every time the sentence names ("at 1, 6, and 9 months postoperatively" names 9)
    for (const m of text.matchAll(new RegExp(TIME_RE.source, 'gi'))) { const mo = monthsOf(m[0]); if (mo != null && mo <= 600 && (!best || mo > best.mo)) best = { mo, text: m[0], page: h.page }; }
    for (const m of text.matchAll(/\b(?:at|and)\s+((?:\d+,\s*)*\d+,?\s*(?:and|or)\s+\d+)\s+(months?|years?)\b/gi)) { const n = Math.max(...m[1].match(/\d+/g).map(Number)), mo = /^y/i.test(m[2]) ? n * 12 : n; if (!best || mo > best.mo) best = { mo, text: `${n} ${m[2]}`, page: h.page }; }
  }
  return best;
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The text after a table's caption in the paper ("Table 2" then its title line), up to a blank line. */
function captionOf(ix, table) {
  if (!table || !/^Table\s/i.test(table)) return '';
  ix._cap ||= {};
  if (ix._cap[table] != null) return ix._cap[table];
  // the caption line itself (a line that starts with "Table 2"), then the next two lines that have text (its title may follow a blank line)
  const re = new RegExp(`^\\s*${table.replace(/\s+/g, '\\s+')}\\b`, 'i');
  const i = ix.lines.findIndex(L => re.test(ix.t.slice(L.s, L.e)));
  if (i < 0) return (ix._cap[table] = '');
  const parts = [ix.t.slice(ix.lines[i].s, ix.lines[i].e)];
  for (let k = i + 1; k < ix.lines.length && parts.length < 3; k++) { const x = ix.t.slice(ix.lines[k].s, ix.lines[k].e).trim(); if (x) parts.push(x); }
  return (ix._cap[table] = parts.join(' ').replace(/\s+/g, ' ').slice(0, 240));
}


function conversions(c) {
  const M = MEASURE[c.measure];
  if (!M) return [];
  if (M.kind === 'distance' && (c.unit === 'mm' || !c.unit)) return [[10, '× 10 (cm → mm)']];
  if (M.kind === 'time' && (c.unit === 'mo' || !c.unit)) return [[12, '× 12 (years → months)'], [1 / 30.44, '÷ 30.44 (days → months)'], [12 / 52.18, '÷ 4.35 (weeks → months)']];
  return [];
}

/** A sentence of the study's own text that states the event did not occur: { page, zone, text } or null. */
export function absenceStated(ix, measure) {
  for (const h of ix.mentions[measure] || []) {
    if (!OWN_ZONES.has(h.zone) && h.zone !== 'discussion') continue;
    const fl = sentenceFlags(ix, h.sent);
    if (!fl || fl.attributed) continue;
    const S = ix.sents[h.sent], before = ix.t.slice(Math.max(S.s, h.s - 60), h.s), after = ix.t.slice(h.e, Math.min(S.e, h.e + 60));
    if (/\b(no|none of the|without|neither|nor|free of|absence of|zero)\b[^.;]{0,45}$/i.test(before) || /^[^.;]{0,40}\b(was|were) (not|never) (observed|seen|found|detected|noted|recorded)\b|^[^.;]{0,25}\b(did not|didn't) (occur|develop)\b|^[^.;]{0,30}\(\s*0\s*(?:%|\/)/i.test(after)) {
      if (/\b(except|but|apart from|other than|only)\b/i.test(ix.t.slice(S.s, S.e))) continue;
      return { page: h.page, zone: h.zone, text: snippet(ix, h.sent, h.s) };
    }
  }
  return null;
}

const STOPW = new Set('the a an of and or in on with to for was were is are be by as at from that this than which its it their there these those has have had not no but also our we study patients patient group groups compared after before during between both all more less'.split(' '));
const words = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPW.has(w));
/** The sentence of the abstract, results, discussion end or conclusion that shares the most content words with a phrase. */
export function bestSentence(ix, phrase) {
  const want = new Set(words(phrase));
  if (!want.size) return null;
  let best = null;
  ix.sents.forEach((S, i) => {
    if (!['abstract', 'conclusion', 'results', 'discussion'].includes(S.zone)) return;
    if (sentenceFlags(ix, i)?.attributed || sentenceFlags(ix, i)?.individual) return;   // another study's conclusion, or one patient's story, is not this one's
    const have = new Set(words(ix.t.slice(S.s, S.e)));
    let k = 0; for (const w of want) if (have.has(w) || [...have].some(h => h.length > 4 && w.length > 4 && (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5))))) k++;
    const overlap = k / want.size;
    if (!best || overlap > best.overlap) best = { overlap, page: S.page, zone: S.zone, text: snippet(ix, i, null, 300), sent: i };
  });
  return best;
}

/**
 * The proof of one value: its claims, each claim's rule and premises, the findings, the value's status and its hash (the Merkle node of
 * everything it was made from). `field` the stored check of the value (valueChecks: verdict, quote, settled); `armN` the arm's size;
 * `column` the extraction column.
 */
/** The measure an outcome's name gives ("Y-BOCS total score" Y-BOCS, "UPDRS-III motor score, medication-OFF" UPDRS): a measure the lexicon
 *  knows, else the first abbreviation of the name the paper mentions, else its first two content words; '' when the paper mentions none. */
export function hintMeasure(ix, text) {
  const t = String(text || '').replace(/\([^)]*\)/g, m => (/[A-Z]{2}/.test(m) ? m : ' '));
  if (!t.trim()) return '';
  const known = measureIn(t);
  if (known && known !== 'patients' && MEASURE[known]?.kind !== 'age' && (ix.mentions[known] || []).length) return known;
  const skip = /^(?:NR|NA|SD|SE|IQR|CI|OFF|ON|II|III|IV|VI|MED|TOTAL|AND|OR)$/;
  for (const a of t.match(/\b[A-Z][A-Za-z0-9]*(?:-[A-Z0-9]+)*\b/g) || []) {
    if (!/[A-Z].*[A-Z]/.test(a) || skip.test(a)) continue;
    const id = adhocMeasure(ix, a.split('-').filter(x => /[A-Z]{2}/.test(x)).join(' ') || a);
    if (id && (ix.mentions[id] || []).length) return id;
  }
  const words = t.split(/[,;:(]/)[0].replace(/[^\p{L}\s-]/gu, ' ').split(/[\s-]+/).filter(w => w.length >= 4 && !/^(?:score|scale|total|change|from|baseline|mean|with|rated|rating)$/i.test(w)).slice(0, 2);
  const id = words.length ? adhocMeasure(ix, words.join(' ')) : '';
  return id && (ix.mentions[id] || []).length ? id : '';
}

export function proveValue({ ix, value, column, field = null, armN = null, cohortN = null, tables = [], armText = '', otherArmText = '', reports = [], outcome = '' }) {
  const v = String(value ?? '');
  const st = field?.settled || {};
  // the quote the value rests on: a settled decision's own (a check's quote it replaced is not the proof: Paul 2015's NR values were
  // settled as not in the paper and still read with the model's quote), else a check that agrees with this value
  // settled by a decision (its quote, or none); beside it a check that agreed with this value, whose quote supports it where it is found
  const proofQuotes = field?.settled ? [st.quote].filter(Boolean) : [];
  const support = field?.quote && field.verdict === 'agree' && field.recorded === v && field.quote !== st.quote ? [field.quote] : [];
  const supportAt = support.map(q => ({ q, at: locateQuote(ix, q) }));
  const quotes = [...proofQuotes, ...(field?.settled ? supportAt.filter(x => x.at).map(x => x.q) : support)];
  const located = quotes.map(q => ({ q, at: supportAt.find(x => x.q === q)?.at || locateQuote(ix, q) })).filter(x => x.at);
  // a quote is the paper's own words unless every line it covers is references, comments or another article
  const ownLoc = located.filter(x => x.at.some(p => [...zonesIn(ix, p.s, p.e)].some(z => !NOT_OWN_WORDS.has(z))));
  const quoteZone = ownLoc.length ? zoneAt(ix, ownLoc[0].at[0].s) : '';
  const quoteNums = ownLoc.flatMap(x => x.at.flatMap(p => ix.nums.filter(n => n.s >= p.s && n.e <= p.e).flatMap(n => n.vals)));
  const der = st.decision === 'derived' && st.how ? checkDerivation(st.how, v, ix.t) : null;
  const vacuous = der?.ok && ![...String(st.how || '').split('=')[0].matchAll(/\d+(?:[.,]\d+)?/g)].some(m => !SMALL_CONSTANTS.has(String(Number(m[0].replace(',', '.')))));
  const ctx = {
    armN, cohortN, quoteNums, quoteZone, quoteSpans: ownLoc.flatMap(x => x.at), tables,
    armWords: armWordsOf(armText), otherArmWords: armWordsOf(otherArmText).filter(w => !armWordsOf(armText).includes(w)), how: st.how || '', derivedGives: der?.ok && !vacuous ? der.gives : [],
    settled: st.decision || '', figure: st.decision === 'figure', decision: st.decision && st.decision !== 'derived' && st.decision !== 'confirmed' ? st.decision : '', why: st.why || '', rule: st.rule || '',
    verdict: field?.recorded === v ? field?.verdict : '', quoteNegates: ownLoc.some(x => /\b(no|none|not|without|never|neither)\b/i.test(x.q)),
    wantsMean: /\bmean\b/i.test(column?.guidance || column?.label || '') || /age/i.test(column?.label || ''), finalColumn: /final/i.test(`${column?.id || ''} ${column?.label || ''} ${column?.guidance || ''}`),
    cellScale100: /0\s*[–-]\s*100/.test(v), reports, columnText: `${column?.id || ''} ${column?.label || ''}`, hintMeasure: outcome && /_(?:baseline_mean|baseline_sd|end_mean|end_sd|change_mean|change_sd|percent_change)$/.test(String(column?.id || '')) ? hintMeasure(ix, outcome) : '',
    multiArm: !!(armN && cohortN && armN !== cohortN),
  };
  const findings = [];
  if (quotes.length && !located.length) findings.push({ level: 'error', kind: 'quote', text: `the recorded quote is not in the full text${ix.sources?.length > 1 ? " or the trial's other sources" : ''}` });
  else if (located.length < quotes.length) findings.push({ level: 'warn', kind: 'quote', text: "one of the value's recorded quotes is not in the full text word for word" });
  if (located.length && !ownLoc.length) { const z = zoneAt(ix, located[0].at[0].s), src = sourceName(ix, located[0].at[0].s); findings.push({ level: 'error', kind: 'scope', text: `the recorded quote is only in ${z === 'other-article' ? 'another article bound into the PDF' : z === 'commentary' ? 'an editorial or reviewer comment' : `the ${z}`}${src ? ` of ${src}` : ''}` }); }
  if (der && der.problem) findings.push({ level: 'error', kind: 'derivation', text: `the recorded derivation fails: ${der.problem}` });
  if (vacuous) findings.push({ level: 'unproven', kind: 'derivation', text: `the recorded derivation "${st.how}" uses no number of the paper, so it proves nothing about it` });
  if (NR.test(v.trim())) {
    const c = { id: '0', type: 'absent', measure: '', text: v.trim().toUpperCase(), seg: 0, qual: {} };
    const P = proveClaim(ix, c, ctx);
    return finish(v, column, [{ claim: c, proof: P }], findings, field);
  }
  // in a final-follow-up column a lone outcome value is the value after surgery
  const claims = claimsOf(v, column, { kind: columnKind(column) }).map(c => (ctx.finalColumn && c.type === 'stat' && !c.role && /score|angle|distance|index/.test(MEASURE[c.measure]?.kind || '') ? { ...c, role: 'post' } : c));
  // the outcome's name ties a number only where the claim's own reading does not prove it (a quote that holds the number proves it as before)
  const proved = claims.map(c => { const P0 = proveClaim(ix, c, { ...ctx, hintMeasure: '' }); if (P0.ok || !ctx.hintMeasure) return { claim: c, proof: P0 }; const P1 = proveClaim(ix, c, ctx); return { claim: c, proof: P1.ok ? P1 : P0 }; });
  // each premise names the source it stands in (a linked report, a registry record), the main report by none
  if (ix.sources?.length) for (const p of proved) for (const q of p.proof.premises) if (q.at != null && !q.source) { const n = sourceName(ix, q.at); if (n) q.source = n; }
  return finish(v, column, proved, findings, field);
}

function finish(value, column, proved, findings, field) {
  const all = [...findings, ...proved.flatMap(p => p.proof.findings)];
  const unproven = proved.filter(p => !p.proof.ok);
  const axioms = proved.filter(p => p.proof.ok && (p.proof.rule === 'axiom' || p.proof.rule === 'judgement')).map(p => p.proof.axiom || p.proof.rule);
  const status = all.some(f => f.level === 'error') ? 'error' : unproven.length ? 'unproven' : all.some(f => f.level === 'conflict') ? 'conflict' : axioms.length ? 'axiom' : all.some(f => f.level === 'interpretation') ? 'interpretation' : 'proven';
  const node = { value, column: column?.id || '', claims: proved.map(p => ({ c: p.claim, rule: p.proof.rule, ok: !!p.proof.ok, premises: p.proof.premises.map(x => ({ ...x, text: undefined })) })), findings: all.map(f => ({ level: f.level, kind: f.kind, text: f.text })) };
  return { status, claims: proved, findings: all, axioms, hash: hashOf(node), settledBy: field?.settled?.decision || '' };
}

export { hash };

/**
 * The passages a reader (a model or a person) needs to check some values, instead of the whole paper: for each claim the places its number
 * stands, the sentences that mention its measure in the study's own text, the passage closest to a conclusion; each with its neighbours,
 * merged and in page order. Answers { text, chars, passages }.
 */
export function excerptsFor(ix, values, { neighbours = 1, perMeasure = 3 } = {}) {
  const pick = new Set();
  const addSent = si => { if (si == null || si < 0) return; for (let k = si - neighbours; k <= si + neighbours; k++) if (k >= 0 && k < ix.sents.length && !NOT_STUDY.has(ix.sents[k].zone)) pick.add(k); };
  for (const { value, column } of values) {
    for (const c0 of claimsOf(value, column, { kind: columnKind(column) })) {
      const c = !c0.measure && (c0.label || c0.unit) ? { ...c0, measure: adhocMeasure(ix, `${c0.label || ''} ${c0.unit === 'levels' ? 'level segment' : ''}`) } : c0;
      const nums = c.type === 'count' ? [[c.n, 0]] : c.type === 'range' ? [[c.lo, c.dec], [c.hi, c.dec]] : c.v != null ? [[c.v, c.dec || 0]] : [];
      for (const [v, d] of nums) { const A = anchorNumber(ix, c, v, d, { count: c.type === 'count' }); for (const a of A.all.slice(0, 2)) addSent(a.num.sent); }
      if (c.measure) (ix.mentions[c.measure] || []).filter(h => OWN_ZONES.has(h.zone)).slice(0, perMeasure).forEach(h => addSent(h.sent));
      if (c.type === 'paraphrase' || c.type === 'judgement') { const b = bestSentence(ix, c.text); if (b) addSent(b.sent); }
    }
  }
  const order = [...pick].sort((a, b) => a - b), parts = [];
  let last = -9, page = 0;
  for (const si of order) {
    const S = ix.sents[si];
    if (si !== last + 1) parts.push(`\n[p. ${S.page}, ${S.zone}]`);
    else if (S.page !== page) parts.push(`[p. ${S.page}]`);
    parts.push(ix.t.slice(S.s, S.e).replace(/\s+/g, ' ').trim());
    last = si; page = S.page;
  }
  const text = parts.join(' ').trim();
  return { text, chars: text.length, passages: order.length };
}

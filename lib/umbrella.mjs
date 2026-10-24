// An umbrella review (overview of systematic reviews): its sources are
// systematic reviews, so the synthesis is about the reviews themselves —
// how far their primary studies overlap, how much confidence each review
// deserves (AMSTAR 2), and how credible each reported association is.
//
// Stored as s.umbrella = {
//   primary: [{ id, label, doi }],          the distinct primary studies
//   matrix:  { [reviewPaperId]: [primaryId] }, which review included which
//   results: [{ id, outcome, review, measure, est, lo, hi, k, cases, participants,
//               i2, piLo, piHi, p, sse, esb, largest, grade }],
// }
// Nothing here is estimated from primary data: the reviews' own reported
// numbers are tabulated and graded by explicit criteria (plan §1.1).
import { studies } from './screen.mjs';
import { appraisalTool } from '../schema.mjs';
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text, r1, esc, axisLine, measure, matrixFrame, drawHeads, headBaseline, rowLabel, footBlock, emptyFigure, legendRow, sourceOf } from './figure-kit.mjs';

// ---- primary studies: parsing and de-duplication ------------------------------

const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
/** A DOI in a line of text, lower-cased, without trailing punctuation. */
export const doiOf = text => {
  const m = String(text || '').match(DOI);
  return m ? m[1].replace(/[.,;:)\]]+$/, '').toLowerCase() : '';
};
/** A label compared ignoring case, accents, punctuation and spacing ("Smith 2019" = "smith, 2019."). */
export const normLabel = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/https?:\/\/(dx\.)?doi\.org\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Pasted text as entries: one per non-empty line, list markers stripped. */
export function parsePrimaryList(text) {
  return String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean)
    .map(line => {
      const doi = doiOf(line);
      const rest = line.replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/[^\s"<>]+/i, '').replace(/[\s,;·-]+$/, '').trim();
      return { label: rest || doi, doi };
    }).filter(e => e.label);
}

const empty = () => ({ primary: [], matrix: {}, results: [] });
export const umbrellaOf = s => ({ ...empty(), ...(s.umbrella || {}) });

/** The existing primary study an entry is: same DOI, or (either lacking a DOI) the same normalised label. */
export function findPrimary(primary, entry) {
  const doi = entry.doi || doiOf(entry.label), key = normLabel(entry.label);
  return primary.find(p => doi && p.doi && p.doi === doi)
    || primary.find(p => (!doi || !p.doi) && key && normLabel(p.label) === key) || null;
}

/**
 * Adds a pasted list to one review's inclusions, merging with primary studies
 * already known. Pure: returns a new umbrella object and what happened.
 */
export function addInclusions(umb, reviewId, text) {
  const out = { ...empty(), ...umb, primary: [...(umb.primary || [])], matrix: { ...(umb.matrix || {}) } };
  const mine = new Set(out.matrix[reviewId] || []);
  let n = out.primary.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0), 0);
  let added = 0, matched = 0, repeated = 0;
  for (const e of parsePrimaryList(text)) {
    let p = findPrimary(out.primary, e);
    if (p) {
      matched++;
      if (e.doi && !p.doi) { p = { ...p, doi: e.doi }; out.primary = out.primary.map(x => (x.id === p.id ? p : x)); }
    } else {
      p = { id: `ps${++n}`, label: e.label, doi: e.doi };
      out.primary.push(p); added++;
    }
    if (mine.has(p.id)) repeated++; else mine.add(p.id);
  }
  out.matrix[reviewId] = [...mine];
  return { umbrella: out, added, matched, repeated };
}

/** Includes or removes one primary study from one review. Pure. */
export function setInclusion(umb, reviewId, primaryId, on) {
  const list = new Set(umb.matrix?.[reviewId] || []);
  if (on) list.add(primaryId); else list.delete(primaryId);
  return { ...umb, matrix: { ...(umb.matrix || {}), [reviewId]: [...list] } };
}

/** Removes a primary study everywhere. Pure. */
export function removePrimary(umb, primaryId) {
  const matrix = Object.fromEntries(Object.entries(umb.matrix || {}).map(([k, v]) => [k, v.filter(x => x !== primaryId)]));
  return { ...umb, primary: (umb.primary || []).filter(p => p.id !== primaryId), matrix };
}

// ---- overlap: the corrected covered area (Pieper et al. 2014) ---------------------

/**
 * CCA = (N − r) / (r·c − r) for the given reviews: N inclusions counted with
 * repeats, r distinct primary studies, c reviews. Returned as a percentage;
 * null when it is undefined (fewer than two reviews, or no primary study).
 */
export function cca(matrix, reviewIds) {
  const lists = reviewIds.map(id => [...new Set(matrix?.[id] || [])]);
  const N = lists.reduce((t, l) => t + l.length, 0);
  const r = new Set(lists.flat()).size, c = reviewIds.length;
  const pct = c > 1 && r > 0 ? 100 * (N - r) / (r * c - r) : null;
  return { N, r, c, pct, band: bandOf(pct) };
}

// The conventional reading (Pieper et al. 2014). Their bands are 0–5, 6–10,
// 11–15 and >15 on whole percentages; on a continuous value the lower edge of
// each band is taken as closed: [0, 5) slight, [5, 10) moderate, [10, 15] high.
export function bandOf(pct) {
  if (pct == null || !Number.isFinite(pct)) return '';
  if (pct < 5) return 'Slight';
  if (pct < 10) return 'Moderate';
  if (pct <= 15) return 'High';
  return 'Very high';
}

/** Pairwise CCA: cells[i][j] for reviews i and j (null on the diagonal). */
export function pairwiseCca(matrix, reviewIds) {
  return reviewIds.map((a, i) => reviewIds.map((b, j) => (i === j ? null : cca(matrix, [a, b]))));
}

/** The reviews of an umbrella review: its included sources, in library order. */
export const reviewsOf = s => studies(s);

/** Primary studies that at least one review includes, most-included first. */
export function citationRows(umb, reviews) {
  const counts = new Map();
  for (const r of reviews) for (const id of new Set(umb.matrix?.[r.id] || [])) counts.set(id, (counts.get(id) || 0) + 1);
  return (umb.primary || []).map(p => ({ ...p, n: counts.get(p.id) || 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

// ---- AMSTAR 2: the overall confidence, derived by the published rule ---------------

/**
 * Shea et al. 2017: a "No" on a critical item is a critical flaw, on another
 * item a non-critical weakness. "Partial yes" and "No meta-analysis" are
 * neither. High: no critical flaw and at most one weakness; Moderate: more
 * than one weakness; Low: one critical flaw; Critically low: more than one.
 * `complete` is false until every item is answered; the rating is then
 * provisional on what has been answered.
 */
export function amstarOverall(answers = {}) {
  const tool = appraisalTool('amstar2');
  const flaws = [], weaknesses = [];
  for (const d of tool.domains) if (answers[d.id] === 'No') (d.critical ? flaws : weaknesses).push(d.short);
  const rating = flaws.length > 1 ? 'Critically low' : flaws.length === 1 ? 'Low' : weaknesses.length > 1 ? 'Moderate' : 'High';
  const complete = tool.domains.every(d => answers[d.id]);
  return { rating, complete, flaws, weaknesses };
}
export const RATING_TONE = { 'High': 'good', 'Moderate': 'unclear', 'Low': 'bad', 'Critically low': 'bad' };

/** The derived overall of an instrument that has one, or null. */
export function derivedRating(tool, answers) {
  if (tool?.id !== 'amstar2' || !answers || !Object.keys(answers).length) return null;
  const o = amstarOverall(answers);
  return { ...o, tone: RATING_TONE[o.rating] };
}

/** A review's AMSTAR 2 answers, if any. */
export const amstarOf = (s, reviewId) => s.assessments?.[reviewId]?.amstar2 || null;
/** One line naming what drove a rating. */
const items = l => `${l.length === 1 ? 'item' : 'items'} ${l.join(', ')}`;
export const drivers = o => [o.flaws.length ? `Critical ${o.flaws.length === 1 ? 'flaw' : 'flaws'}: ${items(o.flaws)}` : 'No critical flaw',
  o.weaknesses.length ? `non-critical ${o.weaknesses.length === 1 ? 'weakness' : 'weaknesses'}: ${items(o.weaknesses)}` : 'no non-critical weakness'].join('; ');

// ---- credibility of an association (evidence classes) --------------------------------

export const MEASURES = [
  ['OR', 'Odds ratio', 'ratio'], ['RR', 'Risk ratio', 'ratio'], ['HR', 'Hazard ratio', 'ratio'],
  ['IRR', 'Incidence rate ratio', 'ratio'], ['MD', 'Mean difference', 'difference'],
  ['SMD', 'Standardised mean difference', 'difference'], ['COR', 'Correlation', 'difference'],
];
const scaleOf = m => MEASURES.find(x => x[0] === m)?.[2] || 'ratio';
export const nullOf = m => (scaleOf(m) === 'ratio' ? 1 : 0);
export const Z975 = 1.959963984540054;

// Complementary error function (Numerical Recipes erfcc): fractional error
// below 1.2e-7 everywhere, which holds in the far tail that p < 10⁻⁶ reaches.
export function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/**
 * The two-sided p of a summary estimate recovered from its 95% CI (on the log
 * scale for a ratio), when the review did not report one.
 */
export function pFromCi(measure, est, lo, hi) {
  const ratio = scaleOf(measure) === 'ratio';
  if (![est, lo, hi].every(Number.isFinite) || (ratio && Math.min(est, lo, hi) <= 0) || !(hi > lo)) return null;
  const g = ratio ? Math.log : x => x;
  const se = (g(hi) - g(lo)) / (2 * Z975);
  const z = (g(est) - g(nullOf(measure))) / se;
  return erfc(Math.abs(z) / Math.SQRT2);
}

const num = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const yes = v => (v === 'yes' ? true : v === 'no' ? false : null);

// Criteria as used by Ioannidis and by Fusar-Poli & Radua (2018). A criterion
// not reported by the review is not met; the table says which.
export const CRITERIA = [
  ['cases', '>1000 cases'], ['p6', 'P < 10⁻⁶'], ['p3', 'P < 10⁻³'], ['p05', 'P < 0.05'],
  ['i2', 'I² < 50%'], ['pi', 'PI excludes null'], ['sse', 'No small-study effects'],
  ['esb', 'No excess significance'], ['largest', 'Largest study significant'],
];

/** Each criterion as true, false or null (not reported), with the p used. */
export function criteriaOf(row) {
  const m = row.measure || 'OR', nul = nullOf(m);
  const est = num(row.est), lo = num(row.lo), hi = num(row.hi);
  const p = num(row.p) ?? pFromCi(m, est, lo, hi);
  // Cases for a binary outcome; for a continuous measure every participant counts.
  const cases = num(row.cases) ?? (scaleOf(m) === 'difference' ? num(row.participants) : null);
  const piLo = num(row.piLo), piHi = num(row.piHi), i2 = num(row.i2);
  const sse = yes(row.sse), esb = yes(row.esb);
  return {
    p,
    cases: cases == null ? null : cases > 1000,
    p6: p == null ? null : p < 1e-6,
    p3: p == null ? null : p < 1e-3,
    p05: p == null ? null : p < 0.05,
    i2: i2 == null ? null : i2 < 50,
    pi: piLo == null || piHi == null ? null : piLo > nul || piHi < nul,
    sse: sse == null ? null : !sse,
    esb: esb == null ? null : !esb,
    largest: yes(row.largest),
  };
}

/**
 * Class I convincing: >1000 cases, P < 10⁻⁶, I² < 50%, PI excluding the null,
 * no small-study effects, no excess significance. Class II highly suggestive:
 * >1000 cases, P < 10⁻⁶, largest study significant. Class III suggestive:
 * >1000 cases, P < 10⁻³. Class IV weak: P < 0.05. NS: P ≥ 0.05. No P and no
 * CI to recover it from: not graded ('').
 */
export function evidenceClass(row) {
  const c = criteriaOf(row), ok = k => c[k] === true;
  if (c.p == null) return { cls: '', criteria: c };
  let cls = 'NS';
  if (ok('cases') && ok('p6') && ok('i2') && ok('pi') && ok('sse') && ok('esb')) cls = 'I';
  else if (ok('cases') && ok('p6') && ok('largest')) cls = 'II';
  else if (ok('cases') && ok('p3')) cls = 'III';
  else if (ok('p05')) cls = 'IV';
  return { cls, criteria: c };
}
export const CLASS_LABEL = { I: 'Class I', II: 'Class II', III: 'Class III', IV: 'Class IV', NS: 'NS' };
export const GRADE_LEVELS = ['High', 'Moderate', 'Low', 'Very low'];

/** A p-value as a reader quotes it: 3 significant figures, exponent below 0.001. */
export function fmtP(p) {
  if (p == null) return '';
  if (p < 1e-3) { const [m, e] = p.toExponential(1).split('e'); return `${m}×10${sup(e)}`; }
  return p < 0.01 ? p.toFixed(3) : p.toFixed(2);
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = e => String(Number(e)).split('').map(ch => SUP[ch] ?? ch).join('');

// ---- exports: CSV rows -----------------------------------------------------------------

const pct1 = v => (v == null ? '' : v.toFixed(1));

export function matrixRows(umb, reviews) {
  return [['Primary study', 'DOI', ...reviews.map(r => r.label), 'Reviews including'],
    ...citationRows(umb, reviews).map(p => [p.label, p.doi || '',
      ...reviews.map(r => ((umb.matrix?.[r.id] || []).includes(p.id) ? 1 : '')), p.n])];
}

export function ccaRows(umb, reviews) {
  const ids = reviews.map(r => r.id), all = cca(umb.matrix, ids), pair = pairwiseCca(umb.matrix, ids);
  const out = [['Reviews', 'N', 'r', 'c', 'CCA %', 'Overlap']];
  out.push(['All', all.N, all.r, all.c, pct1(all.pct), all.band]);
  reviews.forEach((a, i) => reviews.forEach((b, j) => {
    if (j <= i) return; const x = pair[i][j];
    out.push([`${a.label}, ${b.label}`, x.N, x.r, x.c, pct1(x.pct), x.band]);
  }));
  return out;
}

export function amstarRows(s, reviews) {
  const tool = appraisalTool('amstar2');
  return [['Review', ...tool.domains.map(d => `Item ${d.short}${d.critical ? ' (critical)' : ''}`), 'Overall confidence', 'Complete', 'Critical flaws', 'Non-critical weaknesses'],
    ...reviews.map(r => {
      const a = amstarOf(s, r.id) || {}, o = Object.keys(a).length ? amstarOverall(a) : null;
      return [r.label, ...tool.domains.map(d => a[d.id] || ''), o?.rating || '', o ? (o.complete ? 'yes' : 'no') : '',
        o?.flaws.join(' ') || '', o?.weaknesses.join(' ') || ''];
    })];
}

export function resultRows(s, reviews) {
  const byId = new Map(reviews.map(r => [r.id, r]));
  const rows = umbrellaOf(s).results || [];
  return [['Outcome', 'Review', 'Measure', 'Estimate', 'Lower 95% CI', 'Upper 95% CI', 'k', 'Cases', 'Participants', 'I² %',
    'PI lower', 'PI upper', 'P', 'Small-study effects', 'Excess significance', 'Largest study significant', 'AMSTAR 2',
    'Evidence class', ...CRITERIA.map(([, l]) => l), 'GRADE'],
  ...sortedResults(rows).map(r => {
    const { cls, criteria } = evidenceClass(r), a = amstarOf(s, r.review);
    return [r.outcome || '', byId.get(r.review)?.label || '', r.measure || '', r.est ?? '', r.lo ?? '', r.hi ?? '', r.k ?? '',
      r.cases ?? '', r.participants ?? '', r.i2 ?? '', r.piLo ?? '', r.piHi ?? '', criteria.p == null ? '' : criteria.p.toPrecision(3),
      r.sse || '', r.esb || '', r.largest || '', a ? amstarOverall(a).rating : '', CLASS_LABEL[cls] || '',
      ...CRITERIA.map(([k]) => (criteria[k] == null ? '' : criteria[k] ? 'met' : 'not met')), r.grade || ''];
  })];
}
export const sortedResults = rows => [...rows].sort((a, b) => String(a.outcome || '').localeCompare(String(b.outcome || '')));

// ---- figures ---------------------------------------------------------------------------
// The house style (FIGURE-STYLE §2): tokens for every colour and size, row labels that wrap to two lines or become a
// key, column heads that never rotate, and the source block under the drawing. `style` is figureTokens (the export set
// unless given).

export const heatStep = pct => (pct == null ? 0 : pct < 5 ? 1 : pct < 10 ? 2 : pct <= 15 ? 3 : 4);
const BAND_NAMES = ['Not defined', 'Slight <5', 'Moderate 5–10', 'High 10–15', 'Very high >15'];

/** Pairwise CCA as a heat map: reviews on both axes, the percentage in each cell, one grey ramp keyed by the conventional bands. */
export function ccaHeatSvg(umb, reviews, { style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' }), title = 'Pairwise corrected covered area';
  if (!reviews?.length) return emptyFigure(t, { title, message: 'No review is included yet.', width, source });
  const labels = reviews.map(r => r.label), ids = reviews.map(r => r.id), pair = pairwiseCca(umb?.matrix, ids), n = reviews.length;
  const f = matrixFrame(t, { rows: labels, cols: labels, width, cell: t.row * 2.2 }), { P, ls } = f;
  const all = cca(umb?.matrix, ids), parts = [], body = [], inset = t.unit === 'pt' ? 0.5 : 1;
  let y = drawHeads(t, parts, f, labels), used = new Set();
  reviews.forEach((r, i) => {
    const h = Math.max(f.rowH(i), t.row * 1.5), cy = y + h / 2;
    body.push(rowLabel(t, f, i, cy, r.label));
    pair[i].forEach((c, j) => {
      const x = f.cx[j], rect = (cls, fill) => `<rect class="${cls}" x="${r1(x + inset)}" y="${r1(y + inset)}" width="${r1(f.cw[j] - 2 * inset)}" height="${r1(h - 2 * inset)}" fill="${fill}">`;
      if (i === j) { body.push(`${rect('c-band', t.color.band)}<title>${esc(r.label)}</title></rect>`); return; }
      const step = heatStep(c?.pct), say = c?.pct == null ? 'not defined' : `${c.pct.toFixed(1)}% (${c.band.toLowerCase()})`;
      used.add(step);
      body.push(`${rect(`c-seq${step}`, t.seq[step])}<title>${esc(`${r.label}, ${reviews[j].label}: ${say}`)}</title></rect>`);
      if (c?.pct != null) body.push(text(t, x + f.cw[j] / 2, cy + ls * 0.35, c.pct.toFixed(1), { anchor: 'middle', cls: step >= 3 ? 'c-on-heat' : 'c-ink', color: step >= 3 ? t.color.page : t.color.ink, attrs: 'pointer-events="none"' }));
    });
    y += h;
  });
  parts.push(...body);
  const key = legendRow(t, parts, y, f.w, BAND_NAMES.map((label, step) => ({ cls: `c-seq${step}`, fill: t.seq[step], label })).filter((_, step) => step > 0 ? true : used.has(0)));
  const line = `CCA %, all ${n} reviews ${all.pct == null ? 'not defined' : `${all.pct.toFixed(1)}% (${all.band.toLowerCase()})`}; N ${all.N}, r ${all.r}`;
  const h = footBlock(t, parts, key, f.w, { source: [line, ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: line });
}

/** The citation matrix: a row per primary study, a column per review, a filled square where included, the count last. */
export function citationMatrixSvg(umb, reviews, { max = 120, style = null, width = null, source = [] } = {}) {
  const t = style || figureTokens(null, { medium: 'export' }), title = 'Citation matrix';
  const rows = citationRows(umb || {}, reviews || []).filter(p => p.n).slice(0, max);
  if (!reviews?.length || !rows.length) return emptyFigure(t, { title, message: 'No primary study is included by a review yet.', width, source });
  const labels = reviews.map(r => r.label), nW = measure(t, 'n', 'head') + t.size.label * 1.2;
  const f = matrixFrame(t, { rows: rows.map(p => p.label), cols: labels, width, cell: t.row, side: nW }), { P, ls } = f;
  const all = cca(umb.matrix, reviews.map(r => r.id)), parts = [], body = [], mk = Math.min(t.row * 0.5, ...f.cw.map(c => c * 0.6));
  let y = drawHeads(t, parts, f, labels);
  const nx = f.right - ls * 0.6;
  parts.push(text(t, nx, headBaseline(f), 'n', { anchor: 'end', role: 'head', cls: 'c-ink c-head' }));
  rows.forEach((p, i) => {
    const h = f.rowH(i), cy = y + h / 2;
    if (i % 2) parts.push(`<rect class="c-band" x="${r1(P)}" y="${r1(y)}" width="${r1(f.right - P)}" height="${r1(h)}" fill="${t.color.band}"/>`);
    body.push(rowLabel(t, f, i, cy, p.label));
    reviews.forEach((r, j) => {
      if (!(umb.matrix?.[r.id] || []).includes(p.id)) return;
      body.push(`<rect class="c-bar" x="${r1(f.cx[j] + f.cw[j] / 2 - mk / 2)}" y="${r1(cy - mk / 2)}" width="${r1(mk)}" height="${r1(mk)}" fill="${t.color.mark}"><title>${esc(`${p.label}, ${r.label}: included`)}</title></rect>`);
    });
    body.push(text(t, nx, cy + ls * 0.35, String(p.n), { anchor: 'end', cls: 'c-mute', color: t.color.ink2 }));
    y += h;
  });
  parts.push(...body, axisLine(t, P, y, f.right, y));
  const line = `${all.r} primary studies, ${all.N} inclusions, ${reviews.length} reviews${rows.length === max ? `, first ${max} shown` : ''}`;
  const h = footBlock(t, parts, y, f.w, { source: [line, ...sourceOf(source)], keys: f.keys });
  return svgRoot(t, f.w, h, parts.join(''), { title, desc: line });
}

/** The drawings app/lint-figures.mjs checks: three reviews with long names, a shared and a lone primary study, and the empty matrix. */
export const __fixture = style => {
  const reviews = [{ id: 'A', label: 'Aldermere 2012: exercise for depression' }, { id: 'B', label: 'Ibarra-Montoya 2019' }, { id: 'C', label: 'Kowalczyk-Nowak 2016 network synthesis' }];
  const primary = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ id, label: `${id.toUpperCase()} Trialist et al. ${2000 + id.charCodeAt(1)}: a randomized trial with a long title`, doi: '' }));
  const umb = { primary, matrix: { A: ['p1', 'p2', 'p3'], B: ['p2', 'p3', 'p4'], C: ['p1', 'p4', 'p5'] }, results: [] };
  return [{ name: 'ccaHeatSvg', svg: ccaHeatSvg(umb, reviews, { style }) }, { name: 'citationMatrixSvg', svg: citationMatrixSvg(umb, reviews, { style }) },
    { name: 'citationMatrixSvg-empty', svg: citationMatrixSvg({ primary: [], matrix: {} }, reviews, { style }) }];
};

// A table cell as typed atomic claims. "Cobb 19.7 → 3.5°; SVA 23.8 → 22.7 mm" is four claims (Cobb before 19.7, Cobb after 3.5, SVA before
// 23.8 mm, SVA after 22.7 mm) and two pairing links; "Screw loosening 4/48 (8.3%)" is a count claim whose percentage is arithmetic the
// kernel recomputes. Each claim carries what it is about (measure, role, unit, statistic, subgroup, whole cohort or arm) so a source can be
// judged against it, not only matched by its digits. Cells without numbers become term claims (named devices and systems that must be in
// the paper), absence claims (NR), paraphrase claims (an author's conclusion) or judgement claims (a category the review assigns).
import { pointersIn, kindWord } from './pointers.mjs';
import { MEASURES, MEASURE } from './lexicon.mjs';
import { P_LEAD } from './statistic.mjs';
// a cell's own p-value: the forms statistic.mjs's pValueAt reads, "p < 0.05", "P: 0.03", "P-value 0.03", "p for trend 0.03" (work queue row 23)
const P_CLAIM = new RegExp(String.raw`${P_LEAD}\s*[:=]?\s*$`, 'i');

const UNIT_RE = /^(mm|cm|°|deg|degrees?|y|yrs?|years?|mo|months?|wk|weeks?|d|days?|min|h|hrs?|mL|ml|cc|L|kg|%|points?|levels?)\b/i;
const UNIT_NORM = { deg: '°', degree: '°', degrees: '°', yr: 'y', yrs: 'y', year: 'y', years: 'y', month: 'mo', months: 'mo', week: 'wk', weeks: 'wk', day: 'd', days: 'd', hr: 'h', hrs: 'h', ml: 'mL', point: 'points', level: 'levels' };
const unitOf = s => { const m = String(s || '').trim().match(UNIT_RE); if (!m) return ''; const u = m[1]; return UNIT_NORM[u.toLowerCase()] || u; };
// named implant systems and devices are checked as terms that must be in the paper
const NAMED = /\b(Dynesys|Orthrus|Safinaz|Cosmic|COSMIC|BalanC|KAPSS|Waveflex|Isobar|Accuflex|NFlex|DSS|Graf|Wallis|Coflex|X-?STOP|Agile|Stabilimax|TOPS|CD[- ]Horizon|Legacy|PEEK|DTO|Bioflex|Twinflex|Elaspine|Transition|Satori|TSRH|Moss[- ]Miami|USS|Xia|Expedium)\b/;
export const LEVEL = /\b(?:C[1-7]|Th?(?:1[0-2]|[1-9])|L[1-5]|S[1-2])\b/g;
const NR_SEG = /^(?:(.*?)\s+)?(NR|NA|not reported|not applicable)\b(.*)$/i;
// trial registration numbers: an identifier, never a quantity ("NCT00142259" is not 142259)
export const TRIAL_ID = /\b(?:NCT\s?\d{8}|ACTRN\s?\d{14}|ISRCTN\s?\d{8}|DRKS\s?\d{8}|ChiCTR[-\w]*\d{6,}|NTR\s?\d{3,5}|NL\s?\d{4,6}|jRCT\w*\d{7,}|UMIN\d{9}|CTRI\/\d{4}\/\d{2,3}\/\d+|IRCT\w*\d{6,}|RBR-[0-9a-z]{6,10}|KCT\d{7}|TCTR\d{11}|PACTR\d{15}|EudraCT\s*(?:number|no\.?|n°)?\s*:?\s*\d{4}-\d{6}-\d{2}|\d{4}-\d{6}-\d{2})\b/gi;
const normId = x => String(x).replace(/^EudraCT\s*(?:number|no\.?|n°)?\s*:?\s*/i, '').replace(/\s+/g, '').toUpperCase();
// a spread written beside its estimate: "39.4 (SD 13.5)", "39.4 ± 13.5", "12 (IQR 8–15)", "−9.5 (95% CI −20.7 to 40.5)"
const SPREAD = /(-?\d+(?:[.,]\d+)?)\s*(?:\(\s*|,\s*|;\s*)?(±|\+\/-|SD|SE|SEM|s\.d\.|standard deviation)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/gi;
// (a Bayesian report's credible interval is an interval too: "95% CrI −3.65 to −0.33", Hamani 2021; work queue row 19)
const INTERVAL = /\b(9[059])\s*%\s*(?:CI|CrI|confidence interval|credible interval)\b\s*[:=]?\s*(?:\(\s*)?(≈\s*)?(-?\d+(?:[.,]\d+)?)\s*(?:to|–|-|,)\s*(≈\s*)?(-?\d+(?:[.,]\d+)?)/gi;
// a percentage that defines a responder or a threshold ("≥50% reduction", "a 30% improvement"), not a share of the arm
const THRESHOLD_AFTER = /^\s*(?:or (?:more|greater|higher)\s*)?(?:reduction|improvement|decrease|increase|decline|drop|change|response|relief|fewer|less|lower)\b/i;

/** The measure a phrase names (the longest lexicon match wins), or ''. */
export function measureIn(phrase) {
  let best = '', len = 0;
  for (const M of MEASURES) { const m = String(phrase || '').match(M.re); if (m && m[0].length > len) { best = M.id; len = m[0].length; } }
  return best;
}

/** The measure a column is about, from its label ("Follow-up (mo)" follow-up, "Age; sex" age). */
export function columnMeasure(label) {
  const l = String(label || '');
  if (/\bfollow[- ]?up\b/i.test(l)) return 'followup';
  if (/^age\b/i.test(l)) return 'age';
  return measureIn(l);
}

// a column of durations or periods: a number of years in it is a time, not an age ("up to 1 year if no stable response")
const DURATION_COL = /week|month|duration|time|period|phase|follow|stimulation|interval|delay/i;
// a segment that gives individual patients' values ("individual 12, 30", "5 weeks and 10 weeks in two patients", "patients 1 and 2")
const PER_PATIENT = /\bindividual\b|\bin (?:one|two|three|four|five|\d+) (?:patients?|participants?|subjects?|cases?)\b|\b(?:patients?|subjects?|cases?) \d+(?:\s*(?:,|and)\s*\d+)*\b/i;
const num = s => Number(String(s).replace('−', '-').replace(',', '.'));
const decOf = s => (String(s).split(/[.,]/)[1] || '').length;

/**
 * The claims of one cell. `column` { id, label, guidance }; `kind`: 'numeric' | 'judgement' | 'paraphrase' | 'terms' decides how a cell
 * without numbers is read. Answers [{ id, type, measure, role, v, dec, n, N, pct, lo, hi, unit, approx, bound, label, text, seg, qual }].
 */
export function claimsOf(value, column = {}, { kind = null } = {}) {
  const v = String(value ?? '').normalize('NFKC').replace(/[−–](?=\.?\d)/g, m => (m === '−' ? '-' : m)).trim(), out = [], colM = columnMeasure(column.label);
  const k = kind || columnKind(column);
  if (!v) return out;
  // the spread the value itself names ("L 0.0181; R 0.0193 (SE)"): it types every lone spread of the cell
  const declSpread = /\bSEM?\b|standard error/i.test(v) && !/\bSD\b|standard deviation/i.test(v) ? 'se' : /\bSD\b|standard deviation/i.test(v) && !/\bSEM?\b|standard error/i.test(v) ? 'sd' : '';
  // the study's identity: first author and year must be the paper's (the country is a judgement)
  if (/^study$/i.test(String(column.id || '').split('.').pop())) {
    const m = v.match(/^([^\s,]+(?:[- ][A-Z][^\s,]*)?)\s+et al\.?,?\s*((?:19|20)\d\d)[a-z]?/i) || v.match(/^([^\s,]+),?\s*((?:19|20)\d\d)/);
    if (m) return [{ id: 'author', type: 'identity', role: 'author', label: m[1] }, { id: 'year', type: 'identity', role: 'year', label: m[2] }];
  }
  // an author's conclusion is one claim: its words and its numbers are checked against one passage
  if (k === 'paraphrase') return [{ id: '0', type: 'paraphrase', text: v, seg: 0, qual: {} }];
  // a pointer to where a value was read ("Table 1 (Mueller 2008); Figure 2 right panel", "ClinicalTrials.gov posted results"): each table,
  // figure or registry it names must be in one of the trial's sources; the rest of the cell is the reviewer's note
  if (k === 'pointer') {
    // proof/pointers.mjs: "Table 2", "Table S2", "eTable 2", "Appendix B", "Online Resource 1" (a pointer without a number names
    // nothing to look for: any caption would do)
    for (const m of pointersIn(v).filter(x => x.what !== 'material' && x.num)) {
      out.push({ id: m.part ? `p${m.index}.${m.part}` : `p${m.index}`, type: 'pointer', what: m.what, label: `${kindWord(m.what)}${m.num ? ` ${m.num}` : ''}`, supplement: m.supplement, seg: 0, qual: {} });
      // "Figure 6A" is panel A of Figure 6, "Table 2A" a table of its own or part of Table 2: the caption is looked for both ways
    }
    if (/clinicaltrials\.gov|registry|posted results|NCT\d{8}/i.test(v)) out.push({ id: 'reg', type: 'pointer', what: 'registry', label: 'registry record', seg: 0, qual: {} });
    return out.length ? out : [{ id: '0', type: 'judgement', text: v, seg: 0, qual: {} }];
  }
  // the reports of a trial ("Mueller 2008 (quality-of-life companion report)"): each one named must be a record linked to the trial
  if (k === 'reports') {
    for (const m of v.matchAll(/\b([A-Z][\p{L}'’-]+(?:[ -](?:[A-Z][\p{L}'’-]+|van|de|da|von|der))*)\s*(?:et al\.?,?\s*)?((?:19|20)\d\d[a-z]?)\b/gu)) out.push({ id: `r${m.index}`, type: 'report', label: `${m[1]} ${m[2]}`, seg: 0, qual: {} });
    return out.length ? out : [{ id: '0', type: 'judgement', text: v, seg: 0, qual: {} }];
  }
  // registration numbers are identifiers, checked as they are written (letters and digits), never as numbers
  let rest = v;
  for (const m of v.matchAll(TRIAL_ID)) { out.push({ id: `id${m.index}`, type: 'identifier', label: normId(m[0]), seg: 0, qual: {} }); }
  rest = rest.replace(TRIAL_ID, ' ');
  if (out.length && !/\d/.test(rest.replace(/\((?:[^()]*)\)/g, ' '))) return out;
  // a misprint the cell quotes ("printed as '265%' in the text layer") is a note about the paper, not a value
  const v2 = notesOut(rest.replace(/(?<=[\s(])['‘"“][^'’"”\n]{1,40}['’"”](?=[\s),;.:]|$)/g, m => (/\d/.test(m) ? ' ' : m)));
  const segs = v2.split(/;\s*/).map(s => s.trim()).filter(Boolean);
  let lastMeasure = '';
  segs.forEach((seg, si) => {
    const site = (seg.match(/\b(back|leg|neck|arm|low back|radicular|axial)\b/i) || [])[1]?.toLowerCase() || '';
    const qual = { site, cohort: /\b(whole|entire|overall|total) (cohort|series|sample|population)\b/i.test(seg) || /\(whole cohort\)/i.test(v), subgroup: (seg.match(/\bin ((?:Silva|Berjano|Lenke|type|level|group|subgroup|patients with)[^,;()]*)/i) || [])[1] || '',
      scale: (seg.match(/\(\s*(?:VAS|NRS|ODI)?\s*(0\s*[–-]\s*(?:10|100|50))\s*\)/i) || [])[1] || '', time: (seg.match(/\((\d+\s*(?:mo|months?|y|years?))\)/i) || [])[1] || '', stat: /\bmedian\b/i.test(seg) ? 'median' : /\bmean\b/i.test(seg) ? 'mean' : '', ...(PER_PATIENT.test(seg) ? { perPatient: true } : {}) };
    // NR / NA segments: an absence claim about the measure named before them
    const nr = seg.match(NR_SEG);
    if (nr && !/\d/.test(nr[1] || '') && !/\d/.test(nr[3] || '')) {
      const m = measureIn(nr[1] || '') || colM;
      out.push({ id: `${si}`, type: 'absent', measure: m, label: (nr[1] || '').trim(), text: nr[2].toUpperCase(), seg: si, qual });
      return;
    }
    const clean = seg.replace(/\bArm\s+\d+\b(?![.,]\d)/gi, ' ').replace(/\(\s*(?:VAS|NRS|ODI)?\s*0\s*[–-]\s*(?:10|100|50)\s*\)/gi, ' ').replace(/\((\d+\s*(?:mo|months?|y|years?))\)/gi, ' ');
    const firstNum = clean.search(/[≈~≥≤<>]?\s*-?\d/);
    const label = firstNum > 0 ? clean.slice(0, firstNum).trim() : firstNum < 0 ? clean : '';
    const trail = clean.replace(/[^A-Za-z]+$/, '').match(/([A-Za-z][A-Za-z -]*)$/)?.[1] || '';
    // "48.6 → 20.6 in patients with decompression" continues the measure before it; "patients" names who, not what
    const lm = measureIn(label);
    let measure = (lm && !(lm === 'patients' && lastMeasure) ? lm : '') || (firstNum >= 0 && !(lastMeasure && ['levels', 'patients'].includes(measureIn(trail))) ? measureIn(trail) : '') || (firstNum === 0 && lastMeasure && (!measureIn(trail) || ['levels', 'patients'].includes(measureIn(trail))) ? lastMeasure : '') || colM;
    if (/\bfemale|wom[ae]n\b/i.test(seg)) measure = 'female';
    // "patients" names who a value is about ("0 (single male patient)", "≈22 (week 0, patient 1)"); it is the measure only of a column of
    // numbers of patients (Randomized (n), Arm (n), O1 baseline n)
    if (measure === 'patients' && !/\(n\)|\bn$|\bnumber\b|randomi[sz]ed|enrolled|participants|patients|sample/i.test(column.label || '')) measure = colM === 'patients' ? '' : colM;
    if (firstNum < 0) {
      // a cell part without numbers
      for (const m of seg.matchAll(LEVEL)) out.push({ id: `${si}.L${m.index}`, type: 'level', label: m[0], seg: si, qual });
      const named = [...new Set([...seg.matchAll(new RegExp(NAMED.source, 'g'))].map(m => m[0]))];
      for (const n of named) out.push({ id: `${si}.T${n}`, type: 'term', label: n, seg: si, qual });
      if (!named.length && !out.some(c => c.seg === si)) out.push({ id: `${si}`, type: k === 'paraphrase' ? 'paraphrase' : 'judgement', text: seg, seg: si, qual });
      return;
    }
    lastMeasure = measure || lastMeasure;
    const used = [];
    const mark = (a, b) => used.push([a, b]);
    const isUsed = i => used.some(([a, b]) => i >= a && i < b);
    // subgroup labels ("in Silva–Lenke level 3", "Berjano–Lamartina types 1, 2, 3 and 4", "grade IV") name groups, they are not values
    for (const m of clean.matchAll(/\b(?:levels?|types?|grades?|class(?:es)?|groups?|stages?|zones?|Lenke)\s+[0-9IVX]+(?:\s*(?:,|and|or|–|-)\s*[0-9IVX]+)*/gi)) mark(m.index, m.index + m[0].length);
    // a confidence level is not a percentage of anything ("95% CI"); the interval's limits are spread of the estimate before them
    for (const m of clean.matchAll(INTERVAL)) {
      mark(m.index, m.index + m[0].length);
      for (const [x, ap, tag] of [[m[3], m[2], 'lo'], [m[5], m[4], 'hi']]) out.push({ id: `${si}.ci${tag}${m.index}`, type: 'stat', measure, role: '', spread: 'ci', v: num(x), dec: decOf(x), unit: '', approx: !!ap, seg: si, qual });
    }
    for (const m of clean.matchAll(/\b9[059]\s*%\s*(?:CI|CrI|confidence interval|credible interval|prediction interval)s?\b/gi)) mark(m.index, m.index + m[0].length);
    // a needle's gauge ("fluoroscopy-guided 20G") names a size, it is not a quantity
    for (const m of clean.matchAll(/\b\d+\s?G\b/g)) mark(m.index, m.index + m[0].length);
    // an ordinal names a position ("when the 60th patient had a second GTCS"), it is not a quantity
    for (const m of clean.matchAll(/\b\d+(?:st|nd|rd|th)\b/gi)) mark(m.index, m.index + m[0].length);
    // a figure's or table's number names it ("no dispersion for the end value (Figure 1 has no error bars)"), it is not a value
    for (const m of clean.matchAll(/\b(?:Fig(?:ure)?s?\.?|Tables?|Supplementa(?:ry|l)\s+(?:Tables?|Fig(?:ure)?s?\.?))\s*S?\d+[A-Za-z]?(?:\s*(?:,|and|&)\s*S?\d+[A-Za-z]?)*\b/gi)) mark(m.index, m.index + m[0].length);
    // and a patient's or subject's number names that person ("2 (patients 1 and 5)", "patient no. 9")
    for (const m of clean.matchAll(/\b(?:patients?|subjects?|participants?|cases?)\s+(?:no\.?\s*)?\d+(?:\s*(?:,|and|&|–|-)\s*\d+)*\b/gi)) mark(m.index, m.index + m[0].length);
    // who a value is about ("44.6 (the 14 randomized)") and how long a phase lasted ("after the 4-week sham") describe it, they are not values,
    // except in a column of group sizes or of durations (17 Nov 2026)
    if (!/\b(?:arm|n|size|randomi[sz]ed|enrol(?:l?ed)?|sample|patients?|participants?)\b/i.test(`${column.id || ''} ${column.label || ''}`.replace(/[_.]/g, ' '))) for (const m of clean.matchAll(/\b(?:the|all|of the)\s+\d+\s+(?:randomi[sz]ed|enrolled|implanted|included|analy[sz]ed|patients|participants|subjects)\b/gi)) mark(m.index, m.index + m[0].length);
    if (!/week|month|day|year|duration|time|period|phase|follow/i.test(`${column.id || ''} ${column.label || ''}`)) for (const m of clean.matchAll(/\b\d+-(?:day|week|month|year)\b/gi)) mark(m.index, m.index + m[0].length);
    // a number that is part of a name ("QOLIE-89", "SF-36", "HAMD17", "EQ-5D", "Sz6") is not a value
    for (const m of clean.matchAll(/(?<=[A-Za-z])-?\d+(?:[.,]\d+)?[A-Za-z]?\b/g)) mark(m.index, m.index + m[0].length);
    // "45.0 (9.3)" in a column of means or ages is a mean and its SD
    if (/\bmean\b|^age\b/i.test(column.label || '')) for (const m of clean.matchAll(/(-?\d+(?:[.,]\d+)?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*\)/g)) {
      const at = m.index + m[0].lastIndexOf(m[2]);
      if (isUsed(at)) continue;
      mark(at, at + m[2].length);
      out.push({ id: `${si}.sd${at}`, type: 'stat', measure, role: '', spread: declSpread || 'sd', est: num(m[1]), estDec: decOf(m[1]), v: num(m[2]), dec: decOf(m[2]), unit: '', seg: si, qual });
    }
    // an estimate's spread ("39.4 (SD 13.5)", "39.4 ± 13.5"): the spread is proven beside its estimate, it is not another value of the measure
    for (const m of clean.matchAll(SPREAD)) {
      const at = m.index + m[0].lastIndexOf(m[3]);
      if (isUsed(at)) continue;
      mark(at, at + m[3].length);
      out.push({ id: `${si}.sd${at}`, type: 'stat', measure, role: '', spread: /^(?:SE|SEM)$/i.test(m[2]) ? 'se' : /^[±+]/.test(m[2]) ? declSpread || 'sd' : 'sd', est: num(m[1]), estDec: decOf(m[1]), v: num(m[3]), dec: decOf(m[3]), unit: '', seg: si, qual });
    }
    // counts n/N with an optional percentage
    for (const m of clean.matchAll(/(\d+)\s*\/\s*(\d+)(?:\s*\(\s*([≤≥<>]?)\s*(\d+(?:[.,]\d+)?)\s*%\s*[),;])?/g)) {
      mark(m.index, m.index + m[0].length);
      const before = clean.slice(Math.max(0, m.index - 40), m.index), segLabel = (before.match(/([A-Za-z][A-Za-z -]*?)\s*(?:in up to|in|up to)?\s*$/) || [])[1] || label;
      const em = measureIn(segLabel) || measure;
      out.push({ id: `${si}.c${m.index}`, type: 'count', measure: em, n: Number(m[1]), N: Number(m[2]), ...(m[4] ? { pct: num(m[4]), pctDec: decOf(m[4]), pctBound: m[3] || '' } : {}), bound: /up to|at least|≥|≤/.test(clean.slice(Math.max(0, m.index - 12), m.index)) ? 'bound' : '', label: segLabel.trim(), seg: si, qual });
    }
    // "7 of 16" is a count as n/N is
    // ("Day 14 of the 2-week sham period" is a day of a period: the count is at most its denominator, which is no duration)
    for (const m of clean.matchAll(/\b(\d+)\s+of\s+(?:the\s+|all\s+)?(\d+)\b(?![-‐\s]*(?:weeks?|months?|days?|years?|hours?|h\b|min|mg|mm))/g)) {
      if (isUsed(m.index) || Number(m[1]) > Number(m[2]) || /\b(?:day|week|month|year|visit|session|cycle)\s*$/i.test(clean.slice(Math.max(0, m.index - 8), m.index))) continue;
      mark(m.index, m.index + m[0].length);
      out.push({ id: `${si}.c${m.index}`, type: 'count', measure, n: Number(m[1]), N: Number(m[2]), bound: '', label: label.trim(), seg: si, qual });
    }
    // arm size "n=32"
    // (a decimal is kept, so "n=3.2" is a finding and not n=3 with a stray 2)
    // (a thousands comma is no decimal: "n=1,234"; 15 Nov 2026, review)
    for (const m of clean.matchAll(/\bn\s*=\s*(\d{1,3}(?:,\d{3})+(?![\d.])|\d+(?:[.,]\d+)?)/gi)) { mark(m.index, m.index + m[0].length); const th = /^\d{1,3}(?:,\d{3})+$/.test(m[1]); out.push({ id: `${si}.n${m.index}`, type: 'stat', measure: 'patients', role: 'n', v: th ? Number(m[1].replace(/,/g, '')) : num(m[1]), dec: th ? 0 : decOf(m[1]), unit: '', seg: si, qual }); }
    // levels (T12–S1)
    for (const m of clean.matchAll(LEVEL)) { mark(m.index, m.index + m[0].length); out.push({ id: `${si}.L${m.index}`, type: 'level', label: m[0], seg: si, qual }); }
    // pairs a → b (each may be approximate)
    for (const m of clean.matchAll(/(≈\s*)?(-?\d+(?:[.,]\d+)?)\s*(°|mm|cm|%)?\s*→\s*(≈\s*)?(-?\d+(?:[.,]\d+)?)\s*(°|mm|cm|%)?/g)) {
      if (isUsed(m.index)) continue;
      mark(m.index, m.index + m[0].length);
      const after = clean.slice(m.index + m[0].length), unit = m[3] || m[6] || unitOf(after) || (measure && MEASURE[measure]?.kind === 'angle' ? '°' : '');
      out.push({ id: `${si}.p${m.index}a`, type: 'stat', measure, role: 'pre', v: num(m[2]), dec: decOf(m[2]), unit, approx: !!m[1], pair: `${si}.p${m.index}`, seg: si, qual });
      out.push({ id: `${si}.p${m.index}b`, type: 'stat', measure, role: 'post', v: num(m[5]), dec: decOf(m[5]), unit, approx: !!m[4], pair: `${si}.p${m.index}`, seg: si, qual });
    }
    // ranges a–b
    for (const m of clean.matchAll(/(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z°%]+)?/g)) {
      if (isUsed(m.index)) continue;
      mark(m.index, m.index + m[0].length);
      out.push({ id: `${si}.r${m.index}`, type: 'range', measure: measureIn(m[3] || '') || measure, lo: num(m[1]), hi: num(m[2]), dec: Math.max(decOf(m[1]), decOf(m[2])), unit: unitOf(m[3] || ''), seg: si, qual });
    }
    // single numbers: bounds, percentages, statistics
    for (const m of clean.matchAll(/(≈|~|≥|≤|<|>|up to )?\s*(-?(?:\d+(?:[.,]\d+)?|(?<![\d.])\.\d+))\s*(%|[A-Za-z°]+)?/g)) {
      const at = m.index + (m[0].length - m[0].trimStart().length);
      if (isUsed(at) || isUsed(m.index + m[0].indexOf(m[2]))) continue;
      const after = clean.slice(m.index + m[0].length - (m[3] || '').length);
      const unit = m[3] === '%' ? '%' : unitOf(after) || (column.label && /\(mo\)/.test(column.label) ? 'mo' : '');
      const pre = m[1] ? m[1].trim() : '';
      const before = clean.slice(Math.max(0, m.index - 30), m.index).replace(/.*?(?:\band\b|,)\s*/i, '');
      // "18 levels in 16 patients": a count of levels, whatever word ends the segment
      const own = unit === 'levels' ? 'levels' : null;
      const threshold = unit === '%' && (THRESHOLD_AFTER.test(clean.slice(m.index + m[0].length)) || /[≥≤<>]|up to/.test(pre));
      // a column of a spread (O1 baseline SD, O1 change SD): its lone number is a spread, which the paper writes after ± or SD
      // (an SE column's number is an SE, and so is one of a value that says "(SE)": 15 Nov 2026, statistic typing)
      const spreadCol = (/\bSD\b|standard deviation|\bSE\b/i.test(column.label || '') || /^(?:sd|se)$/.test(column.stat || '')) && !m[1] ? { spread: declSpread || (column.stat === 'se' || (/\bSE\b/.test(column.label || '') && !/\bSD\b/.test(column.label || '')) ? 'se' : 'sd') } : {};
      // a p-value ("p < 0.05", or a number in a p-value column) is proven only by a number the paper prints as a p-value (work queue row 23)
      const pvalue = P_CLAIM.test(clean.slice(Math.max(0, m.index - 12), m.index + m[0].indexOf(m[2])).replace(/[<>≤≥=]\s*$/, '')) ? 'cell' : /(?:^|[._ ])p[-_ ]?values?(?:$|[._ ])/i.test(`${column.id || ''} ${column.label || ''}`) ? 'column' : '';
      out.push({ id: `${si}.s${m.index}`, label: before.trim(), type: unit === '%' ? 'percent' : 'stat', ...(threshold ? { threshold: true } : {}), ...(pvalue ? { pvalue } : {}), ...spreadCol, measure: own ?? (unit === '%' && /female|wom[ae]n/i.test(after) ? 'female' : measure || (unit === 'y' && !DURATION_COL.test(`${column.id || ''} ${column.label || ''}`) ? 'age' : colM)), role: '', v: num(m[2]), dec: decOf(m[2]), unit, approx: pre === '≈' || pre === '~', bound: /[≥≤<>]|up to/.test(pre) ? pre : '', seg: si, qual });
    }
  });
  return out;
}

// a reviewer's note in brackets ("7/52 (13.5%; FMMS improvement ≥10 points at month 6; 7 with unknown status)", "163 (registry enrollment;
// all started the study)") says what the value is; its numbers are not more values of the cell. A bracket is a note when it holds a ";"
// or two words of four letters or more that are not a statistic's name; what it starts with, a percentage, a spread or an n, is kept.
const STAT_WORDS = /^(?:mean|median|range|interquartile|standard|deviation|error|confidence|interval|participants?|patients?|total|whole|cohort|months?|years?|weeks?|days?)$/i;
const NOTE_LEAD = /^\s*(?:[≈~≥≤<>]?\s*-?\d+(?:[.,]\d+)?\s*%|(?:SD|SE|SEM|IQR|range|9[059]\s*%\s*CI)\s*[:=]?\s*[≈~]?\s*-?\d+(?:[.,]\d+)?(?:\s*(?:to|–|-)\s*[≈~]?\s*-?\d+(?:[.,]\d+)?)?|n\s*=\s*\d+)/i;
export function notesOut(v) {
  let out = '', depth = 0, start = -1;
  const s = String(v || '');
  // only a value that is a number (or NR) has notes: in a description ("Weekly urinary cocaine tests (number positive of the 4 weekly
  // tests …)") the bracket is part of what it says
  const outside = s.replace(/\([^()]*\)/g, ' ');
  if (!/\d/.test(outside) && !/^\s*(?:NR|NA|not reported|not applicable)\b/i.test(outside)) return s;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') { if (depth === 0) start = i; depth++; continue; }
    if (c === ')' && depth > 0) {
      depth--;
      if (depth === 0) {
        const inner = s.slice(start + 1, i), words = (inner.match(/\p{L}{4,}/gu) || []).filter(w => !STAT_WORDS.test(w));
        // a note of several parts keeps those that are the value's statistic: "(median; IQR −62.9 to −21.6)" is a median with its IQR
        // (15 Nov 2026, seeded-error corpus: the IQR's numbers and the word median were dropped with the note)
        const parts = inner.split(';').map(x => x.trim()), stat = parts.filter(x => /^(?:median|mean)$/i.test(x) || (x.match(NOTE_LEAD)?.[0].trim() === x));
        // (a range written with "to" is read as one: "range 47 to 89" is a range, not two values)
        if (/\d/.test(inner) && inner.includes(';') && stat.length && stat.some(x => /\d/.test(x))) out += `(${stat.map(x => x.replace(/(?<![-−\d.,])(\d+(?:[.,]\d+)?)\s+to\s+(?=\d)/g, '$1–')).join('; ')})`;
        // (a threshold keeps its word: "(>25% reduction in BFMDRS movement score)" is "(>25% reduction)", a responder's definition, not the
        // count's percentage; 15 Nov 2026, a shifted decimal ">2.5%" was taken as the count's own percentage and not checked)
        else if (/\d/.test(inner) && (inner.includes(';') || words.length >= 2)) { const lead = inner.match(NOTE_LEAD), thr = lead && /%$/.test(lead[0].trim()) ? inner.slice(lead[0].length).match(THRESHOLD_AFTER) : null; out += lead ? `(${lead[0].trim()}${thr ? ` ${thr[0].trim()}` : ''})` : ' '; }
        else out += `(${inner})`;
      }
      continue;
    }
    if (depth === 0) out += c;
  }
  if (depth > 0) out += s.slice(start);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** How a column's cells are read: numbers, a category the review assigns, an author's conclusion, or named terms. */
export function columnKind(column = {}) {
  const id = String(column.id || '').split('.').pop(), l = String(column.label || '');
  if (/outcome_of_study|conclusion|author-defined/i.test(id + l)) return 'paraphrase';
  if (/(?:^|_)source$/i.test(id) || /^(?:O\d+ )?source$/i.test(l)) return 'pointer';
  if (/^reports?$/i.test(id) || /^reports?$/i.test(l)) return 'reports';
  if (/class|intent|design|deformity|component|main_table|fusion_technique|population|rationale|staging|confounding/i.test(id)) return 'judgement';
  return 'numeric';
}

// The quality of each submission file and of the paper (plan §2, "Submission files, structured: quality"). Four dimensions, each a list of
// checks the app already makes, scored out of 100 and shown as the Make cards' three bars (barsOf: 85 three, 60 two, 35 one), with the
// readiness grade's word (lib/readiness-score.mjs):
//   complete     completeness and compliance: the journal's requirements of the readiness report, captions, footnotes, limits, callouts,
//                built and current; for the paper, Submission readiness itself (the Overview's score is this dimension)
//   consistent   consistency with the data: linked values against the analyses (both values), numbers of the Abstract and Results among
//                the project's results, drawings against the data they were built from
//   methods      methodological quality: reporting checklist coverage, certainty rated, risk of bias assessed and used, sensitivity
//                analyses; for a pooled analysis, the Make grade (lib/make-stats.mjs grade: studies, events, I², precision)
//   clarity      clarity: for a table, labelled columns, defined abbreviations, a size the page holds; for a figure, the figure lint
//                (lib/figure-lint.mjs) and the resolution rule of the figure needs (Y5); for the text, section balance, long sentences and
//                paragraphs, abbreviations used before they are defined, passive voice (deterministic, no model)
// A check is `{ id, label, state: 'ok' | 'warn' | 'missing' | 'na', w, detail, go }` (`go`: the view that fixes it); a dimension's score is
// its checks' weighted share (ok 1, warn ½, missing 0; na left out); the overall score is the dimensions' weighted mean. The reviewer view
// (a model's critique, views/submission-files.mjs) is stored beside these and never enters them. Pure.
import { gradeOf, journalItems } from './readiness-score.mjs';
import { grade as makeGrade } from './make-stats.mjs';
import { checkSvg, paletteOf, figureContent, styleSummary } from './figure-lint.mjs';

export const DIMENSIONS = Object.freeze([['complete', 'Completeness and compliance', 0.35], ['consistent', 'Consistency with the data', 0.25],
  ['methods', 'Methodological quality', 0.2], ['clarity', 'Clarity', 0.2]]);
const SHARE = { ok: 1, warn: 0.5, missing: 0 };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A check. `share` (0–1) stands for the state where a check is a proportion. */
export const check = (id, label, state, { w = 1, detail = '', go = null, share = null, quiet = false } = {}) => ({ id, label, state, w, detail, go, ...(share != null ? { share } : {}), ...(quiet ? { quiet } : {}) });
const byShare = (s, { ok = 0.9, warn = 0.5 } = {}) => (s >= ok ? 'ok' : s >= warn ? 'warn' : 'missing');
/**
 * Three bars for a score out of 100, one mapping for the strip, the table and the pane (owner, 2026-10-23): 85 and over three (good), 60 to 84
 * two (caution), 35 to 59 one (bad), under 35 none. The bars' tone follows their count (.mk-bars), as the Make grade's does.
 */
export const barsOf = pct => (pct == null ? null : pct >= 85 ? 3 : pct >= 60 ? 2 : pct >= 35 ? 1 : 0);
const TONE = ['bad', 'bad', 'unclear', 'good'];
/** A score out of 100: `{ pct, bars, tone, letter, word }` (the word is the readiness grade's), or null when nothing was assessed. */
/** Whether each study an item names is one record of the library: an unmatched or ambiguous label is listed (lib/package-cites.mjs unsettled). */
const studiesCheck = f => fixCheck('references', 'Studies found in the library', f.unresolved?.length ? (f.unresolved.length <= 2 ? 'warn' : 'missing') : 'ok', { w: 1, detail: (f.unresolved || []).slice(0, 6).join('; '), fix: 'Add or settle them in the Library', go: 'library' });
export function scored(pct) {
  if (pct == null) return null;
  const g = gradeOf(pct), b = barsOf(pct);
  return { pct, bars: b, letter: g.letter, word: g.word, tone: TONE[b] };
}
/** A dimension from its checks: the weighted share of those that apply. */
export function dimension(id, checks) {
  const live = checks.filter(c => c && c.state !== 'na'), w = live.reduce((t, c) => t + c.w, 0);
  const pct = w ? Math.round(100 * live.reduce((t, c) => t + c.w * (c.share ?? SHARE[c.state] ?? 0), 0) / w) : null;
  const [, label] = DIMENSIONS.find(([d]) => d === id) || [id, id];
  return { id, label, checks: checks.filter(c => c && !c.quiet), ...(scored(pct) || { pct: null, bars: null, word: 'Not assessed' }) };   // a quiet check counts, unlisted
}
/** The overall score: the dimensions' weighted mean, over those assessed. */
export function overallOf(dims) {
  const live = dims.filter(d => d.pct != null), w = live.reduce((t, d) => t + weightOf(d.id), 0);
  return scored(w ? Math.round(live.reduce((t, d) => t + weightOf(d.id) * d.pct, 0) / w) : null) || { pct: null, bars: null, word: 'Not assessed' };
}
const weightOf = id => DIMENSIONS.find(([d]) => d === id)?.[2] ?? 0;
export const failing = dim => dim.checks.filter(c => c.state === 'warn' || c.state === 'missing');

// ---- the manuscript --------------------------------------------------------------------------------------------------------------------
/** The journal's requirements of the readiness report (the same items the readiness score weighs) and the reporting checklist. */
/** A manuscript that is not the review's: its one line, in place of every check of the main text. */
export const unfitCheck = reason => [check('unfit', 'Not the review\'s manuscript', 'na', { detail: String(reason || '').replace(/^./, c => c.toUpperCase()) })];
export function manuscriptComplete({ report = null, checklist = null, fit = null, registration = null, grade = null } = {}) {
  if (fit && !fit.ok) return unfitCheck(fit.reason);
  const out = journalItems(report).map((it, i) => check(`journal-${i}`, it.label, it.state === 'ok' ? 'ok' : it.state === 'warn' ? 'warn' : 'missing', { w: it.w, detail: it.section, go: 'manuscript' }));
  if (checklist?.total) {
    const s = (checklist.done + checklist.na) / checklist.total;
    out.push(check('checklist', `${checklist.name || 'Reporting checklist'} items reported`, byShare(s), { w: 3, share: s, detail: `${checklist.done + checklist.na} of ${checklist.total}`, go: 'reporting' }));
  }
  // a review's protocol registration (PROSPERO, OSF, a trial registry): its number in the text, not only recorded in the project
  if (registration) out.push(fixCheck('registration', 'Registration number in the Methods', registration.inText ? 'ok' : registration.recorded ? 'warn' : 'missing',
    { w: 2, detail: registration.inText ? registration.inText : registration.recorded ? `${registration.recorded} is recorded but not in the text` : 'No registration recorded or written', fix: registration.recorded ? `Write ${registration.recorded} in the Methods` : 'Record the registration and write its number in the Methods', go: 'manuscript' }));
  // the certainty of each pooled outcome rated (GRADE) and said in the text
  if (grade?.of) out.push(fixCheck('grade', 'GRADE certainty stated for each outcome', grade.rated >= grade.of && grade.stated ? 'ok' : grade.stated || grade.rated ? 'warn' : 'missing',
    { w: 2, detail: `${grade.rated} of ${grade.of} rated${grade.stated ? '; the text states certainty' : '; the text does not state certainty'}`, fix: grade.rated < grade.of ? 'Rate each outcome in Certainty' : 'State each outcome\'s certainty in the Results', go: grade.rated < grade.of ? 'certainty' : 'manuscript' }));
  return out;
}
/**
 * The text against the data: `issues` (lib/manuscript-checks.mjs: a linked value that changed, with both values; a result not found; an
 * analysis to run again), `unsupported` (lib/review-checks.mjs 'facts': numbers of the Abstract and Results not among the project's results,
 * `[{ blockId, text }]`), `stale` (labels of the text's tables and figures drawn from data that changed since).
 */
export function manuscriptConsistent({ issues = [], unsupported = [], paragraphs = 0, stale = [], fit = null } = {}) {
  if (fit && !fit.ok) return unfitCheck(fit.reason);
  const of = k => issues.filter(i => i.kind === k);
  const changed = of('stale'), missing = of('result'), rerun = of('source-stale');
  return [
    check('values', 'Linked values match the analyses', changed.length ? 'missing' : 'ok', { w: 3, detail: changed.map(i => i.message).join('; '), go: 'manuscript' }),
    check('results', 'Every linked result exists', missing.length ? 'missing' : 'ok', { w: 2, detail: missing.map(i => i.message).join('; '), go: 'manuscript' }),
    check('analyses', 'Analyses behind the text are current', rerun.length ? 'warn' : 'ok', { w: 2, detail: rerun.map(i => i.message).join('; '), go: 'analysis' }),
    paragraphs ? check('numbers', 'Numbers in the Abstract and Results come from the project', unsupported.length === 0 ? 'ok' : unsupported.length / paragraphs <= 0.25 ? 'warn' : 'missing',
      { w: 2, detail: unsupported.map(u => u.text.replace(/^Not among the project's results: /, '')).join('; '), go: 'manuscript' })
      : check('numbers', 'Numbers in the Abstract and Results come from the project', 'na', { detail: 'No Abstract or Results paragraph' }),
    check('drawings', 'Tables and figures in the text drawn from current data', stale.length ? 'warn' : 'ok', { w: 1, detail: stale.join(', '), go: 'manuscript' }),
  ];
}

const words = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(w => /[\p{L}\d]/u.test(w)).length;
const SECTION = [['introduction', /^(introduction|background)\b/i], ['methods', /^(methods?|materials and methods|patients and methods)\b/i], ['results', /^results?\b/i], ['discussion', /^(discussion|conclusions?)\b/i]];
// common abbreviations a reader is not expected to see defined: statistics, units, registries, reporting guidelines
const KNOWN = new Set(['CI', 'OR', 'RR', 'HR', 'SD', 'SE', 'IQR', 'MD', 'SMD', 'US', 'UK', 'USA', 'EU', 'DNA', 'RNA', 'MRI', 'CT', 'PET', 'HIV', 'COVID', 'PRISMA', 'GRADE',
  'CONSORT', 'STROBE', 'CARE', 'MOOSE', 'JBI', 'ROBINS', 'AMSTAR', 'PROSPERO', 'NA', 'NR', 'ID', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII']);
const ABBR = /\b([A-Z][A-Z0-9]{1,6})s?\b/g;
/** Abbreviations used before (or without) a definition "words (ABBR)" or "ABBR (words)", in order of first use. */
// all-caps words that are English, search syntax or device names written in capitals, not abbreviations to define (the quality review's list)
const PLAIN = new Set(['VERY', 'LOW', 'HIGH', 'NOT', 'AND', 'OR', 'NEAR', 'ABS', 'KEY', 'TITLE', 'TI', 'AB', 'ALL', 'ANY', 'NO', 'YES', 'MODERATE', 'SERIOUS', 'CRITICAL', 'NONE', 'TOTAL', 'MESH', 'EMTREE', 'WITH', 'FOR', 'THE', 'OF', 'IN']);
export function undefinedAbbreviations(texts, { skip = null } = {}) {
  const defined = new Set(skip || []), out = [];
  for (const t of texts) {
    const text = String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, ' ');
    for (const m of text.matchAll(/\(([A-Z][A-Za-z0-9]{1,6})s?\)|\b([A-Z][A-Z0-9]{1,6})s?\s+\(/g)) defined.add(m[1] || m[2]);
    for (const m of text.matchAll(ABBR)) {
      const a = m[1];
      if (KNOWN.has(a) || PLAIN.has(a) || defined.has(a) || /^\d/.test(a) || /^[A-Z]\d{1,2}$/.test(a) || out.includes(a)) continue;   // a spinal level or a grid cell (L4, S1), not an abbreviation
      // defined right here: "adjacent segment disease (ASD)" or "ASD (adjacent segment disease)"
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2), before = text.slice(Math.max(0, m.index - 1), m.index);
      if (before === '(' || after.startsWith(' (')) { defined.add(a); continue; }
      out.push(a);
    }
  }
  return out;
}
/** The text's clarity, deterministic: section balance, long sentences and paragraphs, abbreviations used before they are defined, passive voice. */
export function manuscriptClarity(blocks = [], { splitter = t => String(t).split(/(?<=[.!?])\s+(?=[A-Z])/), fit = null, skip = null } = {}) {
  if (fit && !fit.ok) return unfitCheck(fit.reason);
  let section = '', abstract = false;
  const paras = [];
  for (const b of blocks) {
    if (/^h[1-4]$/.test(b.type)) { const t = String(b.text || '').trim(); section = SECTION.find(([, re]) => re.test(t))?.[0] || (/^abstract$/i.test(t) ? 'abstract' : section && !/^h2$/.test(b.type) ? section : ''); abstract = section === 'abstract'; continue; }
    if (b.type !== 'p' && b.type !== 'quote') continue;
    if (/^\s*(?:Supplementary\s+)?(?:Table|Figure|Fig\.)\s+S?\d+\s*[.:|]/.test(b.text || '')) continue;   // a legend
    const n = words(b.text);
    if (n && !abstract) paras.push({ b, n, section });
  }
  const out = [];
  const sent = paras.flatMap(p => splitter(String(p.b.text || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, '')).map(s => ({ s, n: words(s) })));
  const long = sent.filter(x => x.n > 40), lp = sent.length ? long.length / sent.length : 0;
  // long sentences and paragraphs inform; they weigh half (the quality review): a journal does not return a paper for them
  out.push(sent.length ? fixCheck('sentences', 'Sentences of 40 words or fewer', lp <= 0.05 ? 'ok' : lp <= 0.15 ? 'warn' : 'missing', { w: 0.5, go: 'manuscript', detail: long.length ? `${plural(long.length, 'sentence')} over 40 words of ${sent.length}` : '', fix: 'Split the longest sentences' })
    : check('sentences', 'Sentences of 40 words or fewer', 'na', { detail: 'text' }));
  const longP = paras.filter(p => p.n > 250);
  out.push(paras.length ? fixCheck('paragraphs', 'Paragraphs of 250 words or fewer', longP.length === 0 ? 'ok' : longP.length <= 2 ? 'warn' : 'missing', { w: 0.5, go: 'manuscript', detail: longP.length ? `${plural(longP.length, 'paragraph')} over 250 words` : '', fix: 'Split the longest paragraphs' })
    : check('paragraphs', 'Paragraphs of 250 words or fewer', 'na', { detail: 'text' }));
  const undef = undefinedAbbreviations(paras.map(p => p.b.text), { skip });
  out.push(fixCheck('abbreviations', 'Abbreviations defined at first use', undef.length === 0 ? 'ok' : undef.length <= 3 ? 'warn' : 'missing', { w: 1, go: 'manuscript', detail: undef.slice(0, 12).join(', '), fix: `Define ${undef.slice(0, 3).join(', ')} where first used` }));
  return out;
}

// ---- the paper's methods ---------------------------------------------------------------------------------------------------------------
/**
 * `checklist` { name, done, na, total }; `certainty` { rated, of }; `appraisal` { complete, of }; `analyses` the pooled analyses
 * (lib/outcomes.mjs analysisOf: k, i2, moderator…); `robUsed`: risk of bias enters a sensitivity analysis or the certainty rating.
 */
export function paperMethods({ certainty = null, appraisal = null, analyses = [], searches = [], today = new Date() } = {}) {
  const out = [];
  if (certainty?.of) { const v = certainty.rated / certainty.of; out.push(fixCheck('certainty', 'Certainty rated for each outcome', byShare(v, { ok: 1 }), { w: 3, share: v, detail: `${certainty.rated} of ${certainty.of} outcomes`, fix: 'Rate each outcome with GRADE or SWiM', go: 'certainty' })); }
  else out.push(fixCheck('certainty', 'Certainty rated for each outcome', 'missing', { w: 3, detail: 'No outcome rated with GRADE or SWiM', fix: 'Rate each outcome with GRADE or SWiM', go: 'certainty' }));
  if (appraisal?.of) { const v = appraisal.complete / appraisal.of; out.push(fixCheck('rob', 'Risk of bias assessed for every study', byShare(v, { ok: 1 }), { w: 2, share: v, detail: `${appraisal.complete} of ${appraisal.of} studies`, fix: 'Appraise the remaining studies', go: 'appraisal' })); }
  else out.push(check('rob', 'Risk of bias assessed for every study', 'na', { detail: 'included studies' }));
  const pooled = analyses.filter(a => a && a.estimate != null);
  if (pooled.length) {
    const sens = pooled.filter(a => a.mod_kind || a.moderator || Object.keys(a).some(k => /^(loo|leave|sensitiv|influence)/i.test(k)));
    out.push(fixCheck('sensitivity', 'Sensitivity or subgroup analyses', sens.length ? 'ok' : 'warn', { w: 1, detail: `${sens.length} of ${plural(pooled.length, 'analysis', 'analyses')}`, fix: 'Add a leave-one-out or subgroup analysis', go: 'analysis' }));
    const het = pooled.filter(a => a.i2 != null);
    out.push(fixCheck('heterogeneity', 'Heterogeneity reported', het.length === pooled.length ? 'ok' : het.length ? 'warn' : 'missing', { w: 1, detail: `${het.length} of ${pooled.length}`, fix: 'Report I² for each pooled analysis', go: 'analysis' }));
    const big = pooled.filter(a => (a.k || 0) >= 10), egger = big.filter(a => Object.keys(a).some(k => /egger|funnel|pubbias|regtest/i.test(k)));
    out.push(big.length ? fixCheck('pubbias', 'Publication bias assessed where k ≥ 10', egger.length === big.length ? 'ok' : 'warn', { w: 1, detail: `${egger.length} of ${big.length}`, fix: 'Add a funnel plot and Egger test', go: 'analysis' })
      : check('pubbias', 'Publication bias assessed where k ≥ 10', 'na', { detail: 'ten or more studies' }));
  } else out.push(check('sensitivity', 'Sensitivity or subgroup analyses', 'na', { detail: 'a pooled analysis' }));
  const last = (searches || []).map(x => Date.parse(x.date || x.at || x.ranAt || '')).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (last) { const months = (today - last) / (30.4 * 24 * 3600e3); out.push(fixCheck('search', 'Search within 12 months', months <= 12 ? 'ok' : 'warn', { w: 1, detail: `${Math.round(months)} months ago`, fix: 'Run the searches again', go: 'search' })); }
  return out;
}
/** A pooled analysis by the Make grade (studies, events, agreement, precision): one check per criterion, 3 of 3 as ok. */
export function analysisMethods(a, { ratio = false } = {}) {
  if (!a || a.estimate == null || !Number.isFinite(a.k)) return [check('analysis', 'A pooled analysis', 'na', { detail: 'Not drawn from a pooled analysis' })];
  const rows = Array.from({ length: a.k }, (_, i) => ({ events: Array.isArray(a.xi) ? a.xi[i] : 1 }));
  const fit = { i2: a.i2, lo: a.lo, hi: a.hi, estimate: a.estimate, text: '' };
  const g = makeGrade({ rows, kept: a.k, fit, ratio: ratio && a.lo > 0, events: Array.isArray(a.xi) });
  return g.rows.map((r, i) => check(`grade-${i}`, r.label, r.score >= 3 ? 'ok' : r.score === 2 ? 'warn' : 'missing', { w: 1, share: r.score / 3, detail: r.value, go: 'analysis' }));
}

// ---- tables and figures ----------------------------------------------------------------------------------------------------------------
const PORTRAIT_COLUMNS = 8, LANDSCAPE_COLUMNS = 12, ROWS = 50;
/** A check that fails says what to do (`fix`), shown as its second line; `detail` says what was found. */
export const fixCheck = (id, label, state, { fix = '', ...o } = {}) => ({ ...check(id, label, state, o), ...(fix && state !== 'ok' && state !== 'na' ? { fix } : {}) });
/**
 * A table's or figure's checks by dimension (the quality review of 2026-10-23, its tables per kind). `f`: `{ item, label, kind, supplementary,
 * cited (true, false; null when the manuscript is not the review's), order (false when cited out of order), grid, svg, tokens, measure, widthIn,
 * png ({ width }) with resolution ({ widthIn, dpi }), dataCurrent, analysis, ratio, unresolved, limit, included }`. The build state is the
 * Status column's, never a check; a check that cannot be assessed folds into one line per dimension (collapseNa).
 */
export function itemQuality(f) {
  const it = f.item || {}, table = f.kind === 'table', go = 'submission';
  const title = String(it.title || '').trim(), legend = String(it.legend || '').trim();
  const cited = f.cited == null ? check('cited', 'Cited in the text, in order', 'na', { detail: 'The manuscript in the app is not the review\'s' })
    : fixCheck('cited', f.supplementary ? 'Cited from the main text' : 'Cited in the text, in order', !f.cited ? 'missing' : f.order === false ? 'warn' : 'ok',
      { w: 2, detail: !f.cited ? `No "${f.label}" in the manuscript` : f.order === false ? f.orderDetail || 'Cited out of order' : '', fix: !f.cited ? `Cite ${f.label} in the text` : 'Number the items in the order the text cites them', go: 'manuscript' });
  const complete = [cited,
    f.limit?.max && !f.supplementary ? fixCheck('limit', 'Within the journal\'s tables and figures', f.limit.count <= f.limit.max ? 'ok' : 'warn', { w: 1, detail: `${f.limit.count} of ${f.limit.max}`, fix: 'Move one to the supplement', go: 'outputs' }) : null];
  const consistent = [f.dataCurrent == null ? null : fixCheck('data', 'Drawn from current data', f.dataCurrent ? 'ok' : 'missing', { w: 1, detail: f.dataCurrent ? '' : 'The data changed since the build', fix: 'Build it again in Tables and figures', go: 'outputs' })];
  // a picture in the folder read back (lib/printed-data.mjs): what it prints against the app's data; the printed file is the truth
  const pc = f.printed?.compare;
  if (pc) consistent.push(fixCheck('printed', 'Printed values agree with the app', !pc.mismatches.length ? 'ok' : pc.mismatches.length <= 2 ? 'warn' : 'missing',
    { w: 2, detail: pc.mismatches.length ? pc.mismatches.slice(0, 3).map(m => `${m.study}, ${m.field}: ${m.app} in the app, ${m.printed} printed`).join('; ') : `${pc.matched} ${(pc.unit || ['study', 'studies'])[pc.matched === 1 ? 0 : 1]} read from ${String(f.printed.printedFile || f.printed.file || '').split('/').pop()}`,
      fix: 'Settle each difference in Syntheses or in the printed file', go: 'syntheses' }));
  else if (f.printed && f.printed.source !== 'app') consistent.push(check('printed', 'Printed values agree with the app', 'na', { detail: f.printed.label }));
  // built in the app beside the person's file: the build set against the printed version it stands in for (lib/build-in-app.mjs)
  if (f.built) consistent.push(fixCheck('built', 'Built version agrees with the printed one', f.built.ok ? 'ok' : 'missing', { w: 2, detail: f.built.detail, fix: 'Choose a source for each difference, then build again', go: 'submission' }));
  const methods = analysisMethods(f.analysis, { ratio: f.ratio });
  // a figure whose rows or marks name studies: each one found in the library, once (a label two records answer is said, never guessed)
  if (!table && f.studies) complete.push(studiesCheck(f));
  // a reference to an item no longer in the package reads "[missing item]" wherever the caption or a note is shown
  if (f.missingRefs?.length) complete.push(fixCheck('xrefs', 'References to other items', 'missing', { w: 1, detail: `${f.missingRefs.length} ${f.missingRefs.length === 1 ? 'reference points' : 'references point'} to an item no longer in the package`, fix: 'Point it at an item, or remove it', go: 'submission' }));
  const clarity = [];
  if (table) {
    complete.unshift(fixCheck('caption', 'Title', !title ? 'missing' : /\.$/.test(title) && title.split(/\s+/).length > 25 ? 'warn' : 'ok', { w: 2, detail: title ? '' : 'No title', fix: 'Write its title', go }));
    complete.push(studiesCheck(f));
    if (f.grid?.rows?.length) {
      const head = f.grid.rows[0].cells.filter(c => !c?.merged), heads = head.map(c => String(c?.text ?? '').trim()), body = f.grid.rows.slice(1), cols = head.length, rows = body.length;
      const empty = heads.filter(h => !h).length;
      clarity.push(fixCheck('headers', 'Every column labelled', empty === 0 ? 'ok' : empty === 1 ? 'warn' : 'missing', { w: 2, detail: empty ? `${plural(empty, 'column')} without a header` : '', fix: 'Name each column', go: 'outputs' }));
      // numeric columns: a unit or % in the header; one count of decimals (ranges and intervals aside)
      const cell = (r, c) => String(r.cells[c]?.text ?? '').trim(), isNum = v => /^[-–]?\d+(\.\d+)?%?$/.test(v);
      const numeric = heads.map((h, c) => { const v = body.map(r => cell(r, c)).filter(Boolean); return v.length >= 3 && v.filter(isNum).length / v.length >= 0.8; });
      const noUnit = heads.filter((h, c) => h && numeric[c] && !/(\(|%|\bn\b|\bmo\b|months?|years?|days?|score|kg|mm|cm|°|\bno\.?\b|number|count)/i.test(h));
      clarity.push(fixCheck('units', 'Units in the headers', noUnit.length === 0 ? 'ok' : noUnit.length === 1 ? 'warn' : 'missing', { w: 1, detail: noUnit.slice(0, 4).join(', '), fix: 'Give each numeric column its unit', go: 'outputs' }));
      const mixed = heads.filter((h, c) => numeric[c] && new Set(body.map(r => cell(r, c)).filter(isNum).map(v => (v.replace('%', '').split('.')[1] || '').length)).size > 1);
      clarity.push(fixCheck('decimals', 'Consistent decimals', mixed.length === 0 ? 'ok' : mixed.length === 1 ? 'warn' : 'missing', { w: 1, detail: mixed.slice(0, 4).join(', '), fix: 'Use one number of decimals per column', go: 'outputs' }));
      const text = [it.title, ...f.grid.rows.flatMap(r => r.cells.map(c => (c?.merged ? '' : c?.text ?? '')))], notes = [it.legend, ...(it.notes || [])].join(' ');
      const marks = it.marks || [], unnoted = marks.filter(m => !(it.notes || []).includes(`${m.mark} ${m.text}`));
      const undef = undefinedAbbreviations(text, { skip: f.skipWords }).filter(a => !new RegExp(`\\b${a}\\b`).test(notes));
      // a search strategy's capitals are its syntax (TITLE-ABS-KEY, NEAR), not abbreviations
      const missingDefs = [...(/search strateg/i.test(title) ? [] : undef), ...unnoted.map(m => `mark ${m.mark}`)];
      clarity.push(fixCheck('abbreviations', 'Abbreviations and marks defined', missingDefs.length === 0 ? 'ok' : missingDefs.length <= 2 ? 'warn' : 'missing',
        { w: 2, detail: missingDefs.slice(0, 8).join(', '), fix: `Define ${missingDefs.slice(0, 3).join(', ')} in a footnote`, go }));
      const maxCols = it.orient === 'landscape' ? LANDSCAPE_COLUMNS : PORTRAIT_COLUMNS;
      clarity.push(fixCheck('size', 'Fits the page', cols <= maxCols && rows <= ROWS ? 'ok' : cols <= LANDSCAPE_COLUMNS && rows <= ROWS ? 'warn' : 'missing',
        { w: 1, detail: `${cols} columns, ${rows} rows`, fix: cols > maxCols && cols <= LANDSCAPE_COLUMNS ? 'Set it landscape' : 'Split it, or move it to the supplement', go: 'outputs' }));
      // the n of its title against its studies: one study per named first cell, its further arms continuing under an empty one
      const n = Number((/\(n\s*=\s*(\d+)\)|\b(\d+) included stud/i.exec(title) || []).slice(1).find(Boolean));
      const studies = new Set(body.map(r => cell(r, 0).trim()).filter(Boolean)).size;
      if (Number.isFinite(n) && n > 0) consistent.push(fixCheck('counts', 'Counts agree', n === studies ? 'ok' : Math.abs(n - studies) <= 1 ? 'warn' : 'missing',
        { w: 1, detail: `${n} in the title, ${studies} studies`, fix: 'Check the count in the title against the studies', go: 'extraction' }));
      // a table of "the N included studies" against the studies the review includes
      const said = Number((/\b(\d+) included stud/i.exec(title) || [])[1]);
      if (Number.isFinite(said) && said > 0 && Number.isFinite(f.included)) consistent.push(fixCheck('review-count', 'Count agrees with the review', said === f.included ? 'ok' : 'missing',
        { w: 1, detail: `${said} in the title, ${f.included} included in the review`, fix: 'Check the title against Screening\'s included studies', go: 'screening' }));
    } else clarity.push(check('grid', 'The table read', 'na', { detail: 'its rows' }));
  } else {
    complete.unshift(fixCheck('caption', 'Caption', title && legend ? 'ok' : title ? 'warn' : 'missing', { w: 2, detail: !title ? 'No title' : legend ? '' : 'No legend', fix: title ? 'Write its legend' : 'Write its caption', go }));
    if (f.svg) {
      const c = figureContent(f.svg, { widthIn: f.widthIn });
      if (c.minPt != null) clarity.push(fixCheck('legible', 'Legible at print width', c.minPt >= 7 ? 'ok' : c.minPt >= 6 ? 'warn' : 'missing',
        { w: 3, detail: `Smallest text ${c.minPt} pt at ${f.widthIn} in`, fix: 'Print it wider, or draw its text larger', go: 'outputs' }));
      else clarity.push(check('legible', 'Legible at print width', 'na', { detail: 'the print width' }));
      clarity.push(fixCheck('axis', 'Axis titled', c.axisTitle ? 'ok' : 'warn', { w: 1, fix: 'Title its axis, with the unit', go: 'outputs' }));
      const legendAbbr = undefinedAbbreviations(c.texts, { skip: f.skipWords }).filter(a => !new RegExp(`\\b${a}\\b`).test(legend));
      clarity.push(fixCheck('abbreviations', 'Abbreviations defined in the legend', legendAbbr.length === 0 ? 'ok' : legendAbbr.length <= 2 ? 'warn' : 'missing',
        { w: 1, detail: legendAbbr.slice(0, 8).join(', '), fix: `Define ${legendAbbr.slice(0, 3).join(', ')} in the legend`, go }));
      clarity.push(fixCheck('hues', 'Color-blind safe', !c.redGreen ? 'ok' : 'warn', { w: 1, detail: c.redGreen ? 'Red and green carry meaning' : '', fix: 'Use the figure style\'s palette, or add marks', go: 'outputs' }));
      if (f.tokens) {
        const fonts = [...f.svg.matchAll(/\sfont-family="([^"]*)"/g)].map(m => m[1].replace(/&quot;/g, '"')), foreign = fonts.length > 0 && fonts.every(x => x !== f.tokens.font);
        if (foreign) clarity.push(check('style', 'Figure style matches the journal', 'na', { detail: `drawn in another profile (${fonts[0]}): style not checked` }));
        else {
          const found = checkSvg(f.svg, { t: f.tokens, palette: paletteOf([f.tokens]), measure: f.measure || ((x, size) => String(x).length * size * 0.5) }).filter(x => x.rule !== 'F7' && x.rule !== 'F8');
          const said = styleSummary(found), bad = found.some(x => x.rule === 'F6' || x.rule === 'F1');
          clarity.push(fixCheck('style', 'Figure style matches the journal', !found.length ? 'ok' : bad ? 'missing' : 'warn', { w: 1, detail: said, fix: 'Draw it again in the figure style', go: 'outputs' }));
        }
      }
      if (f.forest) {
        const parts = [c.weights, c.heterogeneity, c.favors, c.measure || c.model].filter(Boolean).length;
        clarity.push(fixCheck('forest', 'Weights, heterogeneity, favors labels, measure', parts === 4 ? 'ok' : parts >= 2 ? 'warn' : 'missing',
          { w: 2, detail: `${parts} of 4`, fix: 'Draw it from Syntheses with its parts', go: 'outputs' }));
      }
    } else if (f.png?.width && f.resolution?.widthIn) {
      const implied = f.png.width / f.resolution.widthIn;
      clarity.push(fixCheck('legible', 'Legible at print width', Math.round(implied) >= f.resolution.dpi ? 'ok' : Math.round(implied) >= 300 ? 'warn' : 'missing',
        { w: 3, detail: `${Math.round(implied)} dpi at ${f.resolution.widthIn} in`, fix: `Export it at ${f.resolution.dpi} dpi`, go: 'outputs' }));
    } else clarity.push(check('drawing', 'The drawing read', 'na', { detail: 'the figure\'s source' }));
  }
  return dimensions({ complete, consistent, methods, clarity });
}
/** Checks that cannot be assessed fold into one line per dimension: "3 checks need the figure's source". */
export function collapseNa(checks) {
  const na = checks.filter(c => c && c.state === 'na'), live = checks.filter(c => c && c.state !== 'na');
  if (na.length <= 1) return checks.filter(Boolean);
  const why = [...new Set(na.map(c => c.detail).filter(Boolean))];
  return [...live, check('unassessed', `${plural(na.length, 'check')} not assessed`, 'na', { detail: why.length === 1 ? `They need ${why[0]}` : why.slice(0, 3).join('; ') })];
}
/** The other files: present, and a required statement filled. */
export function documentQuality(row) {
  return dimensions({ complete: [check('present', row.id.startsWith('req-') ? 'Statement filled' : 'File present', row.state === 'built' ? 'ok' : 'missing', { w: 1, detail: row.file || '', go: row.id.startsWith('req-') ? 'manuscript' : 'submission' })] });
}
/** The dimensions from their checks, and the overall score. */
export function dimensions(by) {
  const dims = DIMENSIONS.map(([id]) => dimension(id, collapseNa(by[id] || [])));
  return { dims, overall: overallOf(dims) };
}

/**
 * The paper: completeness is Submission readiness itself (`readiness`, lib/readiness-score.mjs: its parts as checks, its score as the
 * dimension's), so the Overview and Submission show one number; consistency and clarity add each table's and figure's to the text's; methods
 * are the paper's. `items`: the itemQuality of every table and figure.
 */
export function paperQuality({ readiness = null, consistent = [], methods = [], clarity = [], items = [] } = {}) {
  const parts = (readiness?.parts || []).map(p => check(`part-${p.id}`, p.label, !p.assessed ? 'na' : p.got >= 0.9 * p.max ? 'ok' : p.got >= 0.5 * p.max ? 'warn' : 'missing',
    { w: p.max, share: p.assessed ? p.got / p.max : null, detail: p.detail, go: p.go }));
  // every item assessed counts, weighing half; those that fall short are listed, each once, and one that meets them counts unlisted
  const fromItems = (dim, label) => items.map(x => ({ x, d: x.q.dims.find(d => d.id === dim) })).filter(({ d }) => d?.pct != null)
    .map(({ x, d }) => check(`${dim}-${x.id}`, `${x.label}: ${label}`, d.pct >= 85 ? 'ok' : d.pct >= 60 ? 'warn' : 'missing', { w: 0.5, share: d.pct / 100, detail: failing(d).map(c => c.label).join(', '), go: 'submission', ...(d.pct >= 85 ? { quiet: true } : {}) }));
  const dims = DIMENSIONS.map(([id]) => {
    if (id === 'complete') {
      const d = dimension('complete', parts);
      // the readiness score itself, with its caps, where it is graded; its share of the points it could assess where it is not
      const pct = readiness ? (readiness.graded ? readiness.score : readiness.pct) : null;
      return { ...d, ...(scored(pct) || { pct: null, bars: null, word: 'Not assessed' }) };
    }
    if (id === 'consistent') return dimension(id, collapseNa([...consistent, ...fromItems('consistent', 'data')]));
    if (id === 'clarity') return dimension(id, collapseNa([...clarity, ...fromItems('clarity', 'clarity')]));
    return dimension(id, collapseNa(methods));
  });
  return { dims, overall: overallOf(dims) };
}

// ---- the reviewer view: a model's critique on request, kept as dated reviews --------------------------------------------------------------
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A reply read into `{ major, minor, scores }` (each score 0–3 with its reason), or `{ error }` when it is not in the form asked for. */
export function parseReview(text) {
  const s = String(text || ''), a = s.indexOf('{'), z = s.lastIndexOf('}');
  let d = null;
  try { d = a >= 0 ? JSON.parse(s.slice(a, z + 1)) : null; } catch { d = null; }
  if (!d || typeof d !== 'object') return { error: 'The model did not answer in the expected form' };
  const issues = (list, n) => (Array.isArray(list) ? list : []).filter(x => x && clip(x.text, 1)).slice(0, n).map(x => ({ text: clip(x.text, 240), where: clip(x.where, 80) }));
  const scores = {};
  for (const [id] of DIMENSIONS) {
    const v = d.scores?.[id], n = Number(v?.score ?? v);
    if (Number.isFinite(n)) scores[id] = { score: Math.max(0, Math.min(3, Math.round(n))), reason: clip(v?.reason, 240) };
  }
  return { major: issues(d.major, 6), minor: issues(d.minor, 8), scores };
}
/** The request: the reviewer prompt and the item as text, with the app's failing checks so the model does not repeat them. */
export function reviewMessages(prompt, { label, body, quality }) {
  const failingText = (quality?.dims || []).flatMap(dm => failing(dm).map(c => `- ${dm.label}: ${c.label}${c.detail ? ` (${clip(c.detail, 120)})` : ''}`)).join('\n') || '- none';
  const scoresText = (quality?.dims || []).map(dm => `${dm.id}: ${dm.bars ?? 'not assessed'} of 3`).join(', ');
  return [{ role: 'system', content: prompt.text }, { role: 'user', content: `<<item>>\n${label}\n${body}\n<</item>>\n<<app-checks>>\nScores: ${scoresText}\nFailing:\n${failingText}\n<</app-checks>>` }];
}
/** The reviews kept, newest first, at most 12 per target. */
export function normaliseReviews(list) {
  const out = [], per = new Map();
  for (const r of (Array.isArray(list) ? list : []).filter(r => r && r.target && r.at).sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    const n = per.get(r.target) || 0;
    if (n >= 12) continue;
    per.set(r.target, n + 1); out.push(r);
  }
  return out;
}
/** A review's mean score out of 100, for its row beside the deterministic ones. */
export const reviewScore = r => { const v = Object.values(r?.scores || {}).map(x => x.score); return v.length ? scored(Math.round(100 * v.reduce((a, x) => a + x, 0) / (3 * v.length))) : null; };

// Full-text eligibility under several candidate rules at once (2026-10-27: the app's models asked which studies to include under which
// criteria). A model, or any reviewer who writes the same JSON, does not judge a rule: it establishes facts about the
// study's own patients (the construct, staging, deformity, the population), each yes / no / unclear with verbatim quotes. The rules are
// then evaluated by code from those facts, so every rule is applied to every study the same way, and two reviewers can be compared fact by
// fact. Rules are configuration (a JSON file), written in disjunctive form over facts:
//   { "facts": [{ "id", "text" }], "general": ["adult", "!excluded_population"], "rules": [{ "id", "name", "text", "any": [["a", "b"], ["c"]] }],
//     "thresholds": [{ "fact": "deformity", "any": [{ "measure": "cobb", "op": ">=", "value": 10, "unit": "°" }, …], "decides": false }] }
// A rule includes when every general literal holds and one of its groups holds entirely; "!x" is the negation of fact x. Three-valued
// (Kleene) logic: an unclear fact can make a rule unsure, never include.
// A threshold (28 Oct 2026: Cobb ≥10°, PI–LL >10°, SVA >40 mm, PT >20° were judged by the models as yes / no facts) is checked by code
// against the alignment values the reviewer listed: yes when one value meets a criterion, no when values were listed and none does,
// unclear when none was listed. It is shown beside the reviewer's answer; with "decides": true it replaces that answer when it is not unclear.
import { textForSweep, markOcrQuote } from './rob-sweep.mjs';

const rulesOf = r => (r?.read ? r : readRules(r));
export const ANSWERS = Object.freeze(['yes', 'no', 'unclear']);
export const ELIG_PROMPT_V = 1;
const VERDICT = { yes: 'include', no: 'exclude', unclear: 'unsure' };

/** The rules file checked: answers { facts, general, rules, problems } (problems: unknown facts, empty groups, duplicate ids). */
export function readRules(cfg) {
  const problems = [], facts = (cfg?.facts || []).map(f => ({ id: String(f.id || '').trim(), text: String(f.text || '').trim() })).filter(f => f.id);
  const ids = new Set(facts.map(f => f.id));
  if (ids.size !== facts.length) problems.push('a fact id is used twice');
  const known = lit => { const id = String(lit).replace(/^!/, ''); if (!ids.has(id)) problems.push(`unknown fact ${id}`); return String(lit); };
  const general = (cfg?.general || []).map(known);
  const seen = new Set(), rules = (cfg?.rules || []).map(r => {
    const id = String(r.id || '').trim();
    if (!id || seen.has(id)) problems.push(`rule id ${id || '(none)'} missing or used twice`); seen.add(id);
    const any = (r.any || []).map(g => (Array.isArray(g) ? g : [g]).map(known));
    if (!any.length || any.some(g => !g.length)) problems.push(`rule ${id}: an empty group`);
    return { id, name: String(r.name || id), text: String(r.text || ''), any, general: r.general === false ? [] : general };
  });
  const OPS = ['>=', '>', '<=', '<'];
  const thresholds = (cfg?.thresholds || []).map(t => {
    const fact = String(t.fact || '').trim();
    if (!ids.has(fact)) problems.push(`threshold: unknown fact ${fact || '(none)'}`);
    const any = (t.any || []).map(c => ({ measure: String(c.measure || '').trim().toLowerCase(), op: String(c.op || '>='), value: Number(c.value), unit: String(c.unit || '') }));
    if (!any.length) problems.push(`threshold ${fact}: no criterion`);
    for (const c of any) if (!c.measure || !OPS.includes(c.op) || !Number.isFinite(c.value)) problems.push(`threshold ${fact}: a criterion needs measure, op (${OPS.join(' ')}) and a number`);
    return { fact, any, decides: t.decides === true };
  });
  return { read: true, facts, general, rules, thresholds, problems };
}

/** The full text with its pages marked ("[page 3]"), from pdftotext's form feeds, then as a sweep reads it (references left out, cut). */
export function textForEligibility(text, max = 90000) {
  const pages = String(text || '').split('\f');
  const marked = pages.length > 1 ? pages.map((p, i) => (p.trim() ? `[page ${i + 1}]\n${p}` : '')).filter(Boolean).join('\n') : String(text || '');
  return textForSweep(marked, max);
}

/** The messages for one study: instructions and facts first (the same for every study and model), the text, then the study's name. */
export function eligibilityPrompt({ rules, study, text, max = 90000 }) {
  const R = rulesOf(rules);
  const system = `You are an experienced systematic reviewer establishing facts about one study from its full text, for an eligibility decision made later by fixed rules.
Answer every fact about the patients of THIS study (not the literature it cites, not the Discussion's general remarks, not a single illustrative case), and where a fact names the dynamic or hybrid arm, about that arm only.
Each answer is "yes", "no" or "unclear": yes when the text shows it, no when the text shows otherwise or the study plainly cannot have it, unclear when the text does not settle it. Give a reason of one or two sentences and up to three quotes copied exactly from the text, each with the page from the nearest "[page N]" mark. Never invent or tidy a quote.
Also list every alignment value the text reports before surgery (Cobb angle, PI–LL, SVA, pelvic tilt, lumbar lordosis, pelvic incidence), with its arm and whether it describes that arm or the whole cohort.
Reply with one JSON object only: {"facts": {"<fact id>": {"answer": "yes|no|unclear", "why": "<reason>", "quotes": [{"text": "<verbatim>", "page": <number or null>}]}}, "values": [{"measure": "<name>", "value": "<as printed>", "arm": "<arm>", "level": "arm|cohort", "quote": "<verbatim>", "page": <number or null>}]}`;
  const list = R.facts.map(f => `- ${f.id}: ${f.text}`).join('\n');
  const user = `Facts to establish:\n${list}\n\nFull text:\n${textForEligibility(text, max)}\n\nStudy: ${study}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** A reviewer's reply (text or object) read as far as it is right: { facts: { id: { answer, why, quotes } }, values, problems }. */
export function parseEligibility(raw, rules) {
  const R = rulesOf(rules);
  let o = raw;
  if (typeof raw === 'string') { const m = raw.match(/\{[\s\S]*\}/); try { o = JSON.parse(m ? m[0] : raw); } catch { return { facts: {}, values: [], problems: ['not JSON'] }; } }
  const src = o?.facts || {}, facts = {}, problems = [];
  const quotes = qs => (Array.isArray(qs) ? qs : []).slice(0, 5).map(q => (typeof q === 'string' ? { text: q } : { text: String(q?.text || ''), ...(q?.page != null && q.page !== '' ? { page: Number(q.page) || q.page } : {}) })).filter(q => q.text.trim());
  for (const f of R.facts) {
    const x = src[f.id];
    if (!x) { problems.push(`${f.id}: missing`); continue; }
    const a = String(x.answer ?? x).trim().toLowerCase();
    if (!ANSWERS.includes(a)) { problems.push(`${f.id}: answer "${x.answer}" is not yes, no or unclear`); continue; }
    facts[f.id] = { answer: a, why: String(x.why || '').trim().slice(0, 1200), quotes: quotes(x.quotes) };
  }
  const values = (Array.isArray(o?.values) ? o.values : []).slice(0, 40).map(v => ({ measure: String(v?.measure || ''), value: String(v?.value ?? ''), arm: String(v?.arm || ''), level: v?.level === 'cohort' ? 'cohort' : 'arm', quote: String(v?.quote || ''), ...(v?.page != null && v.page !== '' ? { page: Number(v.page) || v.page } : {}) })).filter(v => v.measure && v.value);
  return { facts, values, problems };
}

const norm = t => String(t || '').normalize('NFKC').replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/**
 * Marks each quote (facts and values) found in the full text or not, whitespace and dashes aside; answers how many were not found. A quote on
 * a page read by text recognition (`ocrPages`, tools/fulltext.mjs ocrPagesOf) is marked `ocr` with that page, counted apart in quotesOcr.
 */
export function checkEligibilityQuotes(review, text, ocrPages = []) {
  const hay = norm(text);
  let missing = 0, ocr = 0;
  for (const f of Object.values(review.facts || {})) for (const q of f.quotes || []) { q.found = hay.includes(norm(q.text)); if (!q.found) missing++; if (markOcrQuote(q, q.text, text, ocrPages)) ocr++; }
  for (const v of review.values || []) if (v.quote) { v.found = hay.includes(norm(v.quote)); if (!v.found) missing++; if (markOcrQuote(v, v.quote, text, ocrPages)) ocr++; }
  if (ocr) review.quotesOcr = ocr; else delete review.quotesOcr;
  return missing;
}

const litValue = (facts, lit) => {
  const neg = lit.startsWith('!'), a = facts?.[lit.slice(neg ? 1 : 0)]?.answer || 'unclear';
  return a === 'unclear' ? 'unclear' : (a === 'yes') !== neg ? 'yes' : 'no';
};
const and = vs => (vs.includes('no') ? 'no' : vs.every(v => v === 'yes') ? 'yes' : 'unclear');
const or = vs => (vs.includes('yes') ? 'yes' : vs.length && vs.every(v => v === 'no') ? 'no' : 'unclear');

/**
 * One rule applied to one study's facts: { verdict: include | exclude | unsure, why } (why: the general literals that fail or are
 * unclear, else the route that includes, else that no route holds).
 */
export function applyRule(facts, rule) {
  const gen = rule.general.map(l => [l, litValue(facts, l)]), g = and(gen.map(x => x[1]));
  const routes = rule.any.map(grp => [grp, and(grp.map(l => litValue(facts, l)))]), r = or(routes.map(x => x[1]));
  const v = and([g, r]);
  const shown = grp => grp.join(' + ');
  let why;
  if (g === 'no') why = `fails ${gen.filter(x => x[1] === 'no').map(x => x[0]).join(', ')}`;
  else if (v === 'yes') why = `route ${shown(routes.find(x => x[1] === 'yes')[0])}`;
  else if (r === 'no') why = 'no inclusion route holds';
  else if (g === 'unclear') why = `unclear: ${gen.filter(x => x[1] === 'unclear').map(x => x[0]).join(', ')}`;
  else why = `route unclear: ${routes.filter(x => x[1] === 'unclear').map(x => shown(x[0])).join('; ')}`;
  return { verdict: VERDICT[v], why };
}

const MEASURE_NORM = m => String(m || '').normalize('NFKC').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
/** The number a printed value starts with ("45.2 ± 10.1" 45.2, "−12,5" -12.5), in the criterion's unit (cm read as mm for "mm"); NaN when none. */
export function printedNumber(text, unit = '') {
  const m = String(text || '').replace(/[−–]/g, '-').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return NaN;
  const n = Number(m[0].replace(',', '.'));
  return unit === 'mm' && /\bcm\b/i.test(String(text)) ? n * 10 : n;
}
const meets = (n, c) => (c.op === '>=' ? n >= c.value : c.op === '>' ? n > c.value : c.op === '<=' ? n <= c.value : n < c.value);
const criterionOf = (t, measure) => { const m = MEASURE_NORM(measure); return t.any.find(c => c.measure.split('|').some(x => m.includes(MEASURE_NORM(x)))); };

/**
 * The thresholds checked against one review's listed values: { [fact]: { answer: yes | no | unclear, values: [{ measure, value, arm, level,
 * criterion, meets }] } }. Arm-level values are read first; the cohort's only when no arm value matches a criterion.
 */
export function thresholdFacts(review, rules) {
  const R = rulesOf(rules), out = {};
  for (const t of R.thresholds || []) {
    const matched = lvl => (review?.values || []).filter(v => v.level === lvl).map(v => ({ v, c: criterionOf(t, v.measure) })).filter(x => x.c);
    const use = matched('arm').length ? matched('arm') : matched('cohort');
    const values = use.map(({ v, c }) => { const n = printedNumber(v.value, c.unit); return { measure: v.measure, value: v.value, arm: v.arm, level: v.level, criterion: `${c.measure.split('|')[0]} ${c.op} ${c.value}${c.unit ? ` ${c.unit}` : ''}`, meets: Number.isFinite(n) ? meets(n, c) : null }; });
    const read = values.filter(x => x.meets != null);
    out[t.fact] = { answer: read.some(x => x.meets) ? 'yes' : read.length ? 'no' : 'unclear', values, decides: t.decides };
  }
  return out;
}

/** The facts a rule is applied to: the reviewer's, with each deciding threshold's answer in place of theirs where it is not unclear. */
export function factsWithThresholds(review, rules) {
  const facts = { ...(review?.facts || {}) };
  for (const [id, t] of Object.entries(thresholdFacts(review, rules))) if (t.decides && t.answer !== 'unclear') facts[id] = { ...(facts[id] || {}), answer: t.answer, why: `values: ${t.values.filter(v => v.meets != null).map(v => `${v.measure} ${v.value}`).join(', ')}`, byThreshold: true };
  return facts;
}

/** Where a threshold and the reviewer's own answer differ: [{ fact, said, values: answer, shown: the values read }]. */
export function thresholdDisagreements(review, rules) {
  return Object.entries(thresholdFacts(review, rules)).filter(([id, t]) => t.answer !== 'unclear' && (review?.facts?.[id]?.answer || 'unclear') !== t.answer)
    .map(([id, t]) => ({ fact: id, said: review?.facts?.[id]?.answer || 'unclear', values: t.answer, shown: t.values.map(v => `${v.measure} ${v.value}${v.meets == null ? '' : v.meets ? ' (meets)' : ' (does not)'}`).join('; ') }));
}

/** Every rule for one review: { [rule id]: { verdict, why } }. */
export const applyRules = (facts, rules) => Object.fromEntries((rulesOf(rules)).rules.map(r => [r.id, applyRule(facts, r)]));

/**
 * Several reviewers of one study side by side: { rules: { id: { by: { who: verdict }, agreed: verdict | '' } }, facts: { id: { by, agreed } } }
 * (agreed is empty when they differ; a fact one reviewer did not answer counts as unclear).
 */
export function compareEligibility(reviews, rules) {
  const R = rulesOf(rules), who = Object.keys(reviews || {});
  const same = by => { const v = Object.values(by); return v.length && v.every(x => x === v[0]) ? v[0] : ''; };
  const out = { rules: {}, facts: {} };
  for (const r of R.rules) { const by = Object.fromEntries(who.map(w => [w, reviews[w].verdicts?.[r.id]?.verdict || applyRule(factsWithThresholds(reviews[w], R), r).verdict])); out.rules[r.id] = { by, agreed: same(by) }; }
  for (const f of R.facts) { const by = Object.fromEntries(who.map(w => [w, reviews[w].facts?.[f.id]?.answer || 'unclear'])); out.facts[f.id] = { by, agreed: same(by) }; }
  return out;
}

/** FNV-1a, 32 bits, hex. */
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
/** What a review was made from (prompt version, facts, text, model): a recheck sends a study again only when this changed. Rules are not in it: they are re-applied by code. */
export function eligibilityFingerprint({ rules, text, model = '', max = 90000 }) {
  const R = rulesOf(rules), t = textForEligibility(text, max);
  return `v${ELIG_PROMPT_V}-${fnv(JSON.stringify(R.facts))}-${fnv(t)}-${fnv(String(model))}`;
}

// ---- attached to the records (28 Oct 2026: the results file could not be reviewed study by study in the app) ------------------------------
// `lykos-eligibility attach` writes the reviews into the project (s.eligibilityReview: { at, studies: { [paper id]: { study, source,
// reviews } } }) by a change file; Screening's inspector draws them for the record on screen with the project's rules (s.eligibilityRules).

const VERDICT_WORD = { include: 'include', exclude: 'exclude', unsure: 'uncertain' };
/** The reviews of a results file keyed by record: { value, unmatched } (a study matches a record by its label, case and accents aside). */
export function attachable(results, papers, at = new Date().toISOString()) {
  const key = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const byLabel = new Map((papers || []).filter(p => p.label).map(p => [key(p.label), p]));
  const studies = {}, unmatched = [];
  for (const [study, r] of Object.entries(results?.studies || {})) {
    const p = byLabel.get(key(study));
    if (!p) { unmatched.push(study); continue; }
    // kept small in the project file: a reason of 160 characters, two quotes of 200 each, the values without their quotes (the results file
    // keeps the whole review)
    const cut = (t, n = 300) => (String(t || '').length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ''));
    const facts = rv => Object.fromEntries(Object.entries(rv.facts || {}).map(([id, f]) => [id, { answer: f.answer, why: cut(f.why, 160), quotes: (f.quotes || []).slice(0, 2).map(q => ({ text: cut(q.text, 200), ...(q.page != null ? { page: q.page } : {}), ...(q.found != null ? { found: q.found } : {}), ...(q.ocr ? { ocr: true } : {}) })) }]));
    const values = rv => (rv.values || []).map(v => ({ measure: v.measure, value: v.value, arm: v.arm, level: v.level }));
    const reviews = Object.fromEntries(Object.entries(r.reviews || {}).map(([w, rv]) => [w, { by: rv.by || w, model: rv.model || '', at: rv.at || '', facts: facts(rv), values: values(rv), quotesMissing: rv.quotesMissing ?? null, ...(rv.quotesOcr ? { quotesOcr: rv.quotesOcr } : {}) }]));
    // a reason and quotes once per answer to a fact: the first reviewer who gave that answer keeps them, the others the answer alone (four
    // reviewers of 52 studies kept in full were a megabyte; the agreeing evidence repeats)
    const seen = new Set();
    for (const rv of Object.values(reviews)) for (const [id, f] of Object.entries(rv.facts)) {
      const k = `${id}\u0000${f.answer}`;
      if (seen.has(k)) rv.facts[id] = { answer: f.answer }; else seen.add(k);
    }
    studies[p.id] = { study, source: r.source || '', reviews };
  }
  return { value: { at, studies }, unmatched };
}

/**
 * What the inspector shows for one record, or null: { study, source, reviewers, rules: [{ id, name, text, by: { who: verdict }, agreed,
 * why }], facts: [{ id, text, by: { who: { answer, why, quotes } }, agreed, threshold }], problems } (verdicts as Screening words: include,
 * exclude, uncertain; agreed is '' when the reviewers differ).
 */
export function recordEligibility(s, paperId) {
  const st = s?.eligibilityReview?.studies?.[paperId];
  if (!st || !s.eligibilityRules) return null;
  const R = readRules(s.eligibilityRules), reviewers = Object.keys(st.reviews || {});
  const same = vs => (vs.length && vs.every(v => v === vs[0]) ? vs[0] : '');
  const applied = Object.fromEntries(reviewers.map(w => [w, applyRules(factsWithThresholds(st.reviews[w], R), R)]));
  const thresholds = Object.fromEntries(reviewers.map(w => [w, thresholdFacts(st.reviews[w], R)]));
  const rules = R.rules.map(r => {
    const by = Object.fromEntries(reviewers.map(w => [w, VERDICT_WORD[applied[w][r.id].verdict]]));
    return { id: r.id, name: r.name, text: r.text, by, agreed: same(Object.values(by)), why: Object.fromEntries(reviewers.map(w => [w, applied[w][r.id].why])) };
  });
  const facts = R.facts.map(f => {
    const by = Object.fromEntries(reviewers.map(w => [w, st.reviews[w].facts?.[f.id] || { answer: 'unclear', why: '', quotes: [] }]));
    const t = reviewers.map(w => thresholds[w][f.id]).find(Boolean) || null;
    return { id: f.id, text: f.text, by, agreed: same(Object.values(by).map(x => x.answer)), threshold: t && { answer: t.answer, decides: t.decides, values: t.values } };
  });
  const quotesOcr = reviewers.reduce((n, w) => n + (st.reviews[w].quotesOcr || 0), 0);   // quotes from pages read by text recognition, counted apart
  return { study: st.study, source: st.source, reviewers, rules, facts, problems: R.problems, quotesOcr };
}

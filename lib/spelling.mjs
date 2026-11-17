// A project's spelling (25 Oct 2026). `state.journalProfile.variety` ('us' or 'uk', Manuscript › Submission › Spelling) is the spelling the
// project writes in. With 'us', what Lykos itself writes into an output (the risk-of-bias plots' titles and keys, the risk-of-bias workbook's and
// decision log's headings and reasons, any figure's labels) is given in American spelling, and the output checks list a British spelling left in
// a table, a note, a figure or a workbook. A passage quoted from a paper (inside quotation marks, or a column of quotations) is the paper's own
// words and is never changed or listed; nor are the proper names a project keeps (build.json "checks": { "spellingKeep": [...] }).
import { SPELLING_PAIRS } from './submission-checks.mjs';

/** The spelling a project writes in: 'us', 'uk' or null. */
export const varietyOf = s => (['us', 'uk'].includes(s?.journalProfile?.variety) ? s.journalProfile.variety : null);

const ISE_STEMS = 'random|organ|optim|character|standard|minim|maxim|util|recogn|hospital|immun|categor|summar|general|normal|stabil|visual|catheter|emphas|priorit';
// British → American, each a whole-word pattern and its replacement; the case of the first letter (or of the whole word) is kept
const RULES = [
  [/\bjudgements?\b/gi, m => m.replace(/ement/i, 'ment')],
  [new RegExp(`\\b(${ISE_STEMS})is(e|ed|es|ing|ation|ations|er|ers|able)\\b`, 'gi'), (m, a, b) => `${a}iz${b}`],
  [/\b(analy|paraly)s(e|ed|es|ing|er|ers)\b/gi, (m, a, b) => `${a}z${b}`],
  [/\b(fav|col|behavi|lab|hum|neighb|hon|vap|harb|od|rum|tum)our(s|ed|ing|ite|ites|able|ably|ful|al)?\b/gi, (m, a, b = '') => `${a}or${b}`],
  [/\bcentred\b/gi, () => 'centered'], [/\bcentre(s?)\b/gi, (m, a) => `center${a}`],
  [/\b(fib|tit|(?:milli|centi|kilo|micro|deci)?(?:met|lit))re(s?)\b/gi, (m, a, b) => `${a}er${b}`],
  [/\b(label|model|signal|travel|cancel|counsel|fuel|channel)l(ed|ing|er|ers|or|ors)\b/gi, (m, a, b) => `${a}${b}`],
  [/\benrolment(s?)\b/gi, (m, a) => `enrollment${a}`], [/\bcatalogue(s?)\b/gi, (m, a) => `catalog${a}`], [/\bprogramme(s?)\b/gi, (m, a) => `program${a}`],
  [/\bageing\b/gi, () => 'aging'], [/\bartefact(s?)\b/gi, (m, a) => `artifact${a}`], [/\bdefence\b/gi, () => 'defense'], [/\baluminium\b/gi, () => 'aluminum'],
  [/\bmould(s?)\b/gi, (m, a) => `mold${a}`], [/\bmanoeuvre(s?)\b/gi, (m, a) => `maneuver${a}`],
  [/\bhaem(?=[a-z])/gi, () => 'hem'], [/\b(an|leuk|isch|septic|hypergly|hypogly|gly)aemi/gi, (m, a) => `${a}emi`],
  [/\boedema/gi, () => 'edema'], [/\bpaediatric/gi, () => 'pediatric'], [/\boesophag/gi, () => 'esophag'], [/\borthopaedic/gi, () => 'orthopedic'],
  [/\banaesthe/gi, () => 'anesthe'], [/\baetiolog/gi, () => 'etiolog'], [/\b(dysp|ap)noea\b/gi, (m, a) => `${a}nea`], [/\bdiarrhoea/gi, () => 'diarrhea'],
  [/\bgynaecolog/gi, () => 'gynecolog'], [/\bfoet(us|uses|al)\b/gi, (m, a) => `fet${a}`], [/\boestr/gi, () => 'estr'], [/\bcaesarean/gi, () => 'cesarean'],
  [/\bcoeliac/gi, () => 'celiac'], [/\bsulph/gi, () => 'sulf'], [/\bleucocyt/gi, () => 'leukocyt'], [/\bfaec(al|es)\b/gi, (m, a) => `fec${a}`], [/\bgonorrhoea/gi, () => 'gonorrhea'],
];
const caseLike = (from, to) => (from === from.toUpperCase() && from.length > 1 ? to.toUpperCase() : /^[A-Z]/.test(from) ? to[0].toUpperCase() + to.slice(1) : to);

// the parts of a text Lykos may change: outside quotation marks and outside the kept names
// double quotes, curly single quotes, and straight single quotes that open after a space or bracket and close before punctuation (not apostrophes)
const QUOTED = /(“[^”]*”|"[^"\n]*"|‘[^’]*’|(?<=^|[\s(\[])'[^'\n]+?'(?=[\s.,;:)\]]|$))/g;
function eachFree(text, keep, f) {
  const k = (keep || []).filter(Boolean).sort((a, b) => b.length - a.length);
  const keepRe = k.length ? new RegExp(`(${k.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g') : null;
  return String(text ?? '').split(QUOTED).map((part, i) => (i % 2 ? part : keepRe ? part.split(keepRe).map((p, j) => (j % 2 ? p : f(p))).join('') : f(part))).join('');
}

/** A text in American spelling, quoted passages and the kept names left as they are. */
export function toAmerican(text, { keep = [] } = {}) {
  return eachFree(text, keep, part => RULES.reduce((t, [re, to]) => t.replace(re, (...m) => caseLike(m[0], to(...m))), part));
}

/** A text in the project's spelling: American when the project writes American, otherwise unchanged. */
export const inVariety = (text, variety, opts) => (variety === 'us' ? toAmerican(text, opts) : text);

const UK = SPELLING_PAIRS.map(([uk]) => new RegExp(`\\b(?:${uk})\\b`, 'gi'));
/** The British spellings of a text (outside quotation marks and the kept names): ["judgement", "favours"]. */
export function britishSpellings(text, { keep = [] } = {}) {
  const out = [];
  eachFree(text, keep, part => { for (const re of [...UK, /\bjudgements?\b/gi]) { re.lastIndex = 0; for (const m of part.matchAll(re)) out.push(m[0]); } return part; });
  return [...new Set(out)];
}

/** An SVG's text (its <text>, <tspan> and <title> content) in American spelling. */
export const svgToAmerican = (svg, opts) => String(svg ?? '').replace(/>([^<]+)</g, (m, t) => `>${toAmerican(t, opts)}<`);

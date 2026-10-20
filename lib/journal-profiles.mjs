// Journal profiles: the limits and requirements a manuscript is checked
// against before submission (lib/submission-checks.mjs).
//
// No named journal's limits are stored here. A journal's instructions for
// authors change without notice, and nothing in this app can verify them, so
// a profile for a named journal is built by the author: typed in
// (`customProfile`) or read from instructions pasted from the journal's site
// (`profileFromText`), with the sentence each value came from kept beside it.
// The generic profiles below are defined by reporting conventions, not by any
// journal: they carry the abstract headings and statements the convention
// asks for, and no word, reference or figure limits, because a convention
// does not set them. `source.checked` is null on every built-in profile: the
// URL names where the convention is published, not a page read on a date.
//
// Pure data and text: nothing here imports the store or a view.

import { blankBlock } from './manuscript.mjs';

export const REFERENCE_STYLES = ['vancouver', 'ama', 'apa', 'harvard', 'nlm'];

/** Statements a journal may require, by key, with the headings they go under. */
export const REQUIREMENTS = [
  { id: 'coi', label: 'Conflicts of interest' },
  { id: 'funding', label: 'Funding' },
  { id: 'dataAvailability', label: 'Data availability' },
  { id: 'ethics', label: 'Ethics approval' },
  { id: 'consent', label: 'Patient consent' },
  { id: 'registration', label: 'Registration' },
  { id: 'credit', label: 'Author contributions' },
  { id: 'orcid', label: 'ORCID iDs' },
];
const REQUIREMENT_IDS = new Set(REQUIREMENTS.map(r => r.id));

// ---- structured abstracts --------------------------------------------------
//
// Each set lists the headings an abstract is written under and, where the
// convention itemises more than it heads, what each heading covers. The
// headings are the ones the convention names; `aliases` are the other names
// journals commonly print for the same part, used when checking an abstract.

export const STRUCTURED_ABSTRACTS = {
  imrad: {
    id: 'imrad', label: 'IMRaD',
    headings: ['Background', 'Methods', 'Results', 'Conclusions'],
    aliases: { Background: ['Introduction', 'Objective', 'Objectives', 'Aim', 'Aims', 'Purpose', 'Context'], Methods: ['Materials and methods', 'Patients and methods', 'Design'], Results: ['Findings'], Conclusions: ['Conclusion', 'Interpretation'] },
    source: { name: 'Common four-heading form', url: null },
  },
  haynes: {
    id: 'haynes', label: 'Eight-heading (Haynes et al. 1990)',
    // The classic 1990 form ("More informative abstracts revisited", Ann Intern
    // Med 1990). Journals that still use it have often adapted it since.
    classic: true,
    headings: ['Objective', 'Design', 'Setting', 'Participants', 'Interventions', 'Measurements', 'Results', 'Conclusion'],
    aliases: { Objective: ['Objectives'], Participants: ['Patients', 'Subjects'], Interventions: ['Intervention'], Measurements: ['Main outcome measures', 'Main outcomes and measures', 'Outcome measures'], Conclusion: ['Conclusions'] },
    source: { name: 'Haynes RB, Mulrow CD, Huth EJ, Altman DG, Gardner MJ. More informative abstracts revisited. Ann Intern Med. 1990', url: null },
  },
  consort: {
    id: 'consort', label: 'CONSORT for Abstracts',
    // CONSORT for Abstracts itemises rather than prescribes headings; these are
    // its groups, with the items each covers.
    headings: ['Trial design', 'Methods', 'Results', 'Conclusions', 'Trial registration', 'Funding'],
    covers: {
      Methods: ['Participants', 'Interventions', 'Objective', 'Outcome', 'Randomisation', 'Blinding'],
      Results: ['Numbers randomised', 'Recruitment', 'Numbers analysed', 'Outcome', 'Harms'],
    },
    aliases: { 'Trial design': ['Design', 'Background'], Conclusions: ['Conclusion', 'Interpretation'], 'Trial registration': ['Registration'] },
    source: { name: 'CONSORT for Abstracts (Hopewell et al. 2008); CONSORT 2025 revised the main checklist, so check the items against the current version', url: 'https://www.equator-network.org/' },
  },
  prisma: {
    id: 'prisma', label: 'PRISMA 2020 for Abstracts',
    headings: ['Background', 'Methods', 'Results', 'Discussion', 'Funding', 'Registration'],
    covers: {
      Background: ['Objectives'],
      Methods: ['Eligibility criteria', 'Information sources', 'Risk of bias', 'Synthesis of results'],
      Results: ['Included studies', 'Synthesis of results'],
      Discussion: ['Limitations of evidence', 'Interpretation'],
    },
    aliases: { Background: ['Objective', 'Objectives', 'Introduction'], Discussion: ['Conclusions', 'Conclusion', 'Interpretation'], Registration: ['Protocol registration', 'Systematic review registration', 'PROSPERO registration'] },
    source: { name: 'PRISMA 2020 for Abstracts (Page et al. 2021)', url: 'https://www.prisma-statement.org/' },
  },
  care: {
    id: 'care', label: 'CARE',
    // CARE item 3: what is unique, the main symptoms and findings, the main
    // diagnoses, interventions and outcomes, and the take-away lesson. The
    // headings match the case report starter in lib/manuscript.mjs.
    headings: ['Introduction', 'Case presentation', 'Conclusions'],
    covers: {
      Introduction: ['What is unique about the case'],
      'Case presentation': ['Main symptoms and clinical findings', 'Main diagnoses, interventions and outcomes'],
      Conclusions: ['The main take-away lesson'],
    },
    aliases: { Introduction: ['Background'], 'Case presentation': ['Case report', 'Case description', 'Case summary'], Conclusions: ['Conclusion'] },
    source: { name: 'CARE guidelines (Gagnier et al. 2013)', url: 'https://www.care-statement.org/' },
  },
};

/** Every name an abstract heading goes by in the sets above, lower-cased, keyed by the heading. */
export function headingNames(heading) {
  const out = new Set([String(heading).toLowerCase()]);
  for (const set of Object.values(STRUCTURED_ABSTRACTS))
    for (const [h, as] of Object.entries(set.aliases || {}))
      if (h.toLowerCase() === String(heading).toLowerCase()) for (const a of as) out.add(a.toLowerCase());
  return [...out];
}

/**
 * The blocks to insert for a profile's structured abstract: an Abstract
 * heading, then a subheading and an empty paragraph per abstract heading.
 * An unstructured abstract is the heading and one paragraph.
 */
export function abstractTemplate(profile, { withHeading = true } = {}) {
  const heads = profile?.abstractStructured && profile.abstractHeadings?.length ? profile.abstractHeadings : [];
  return [
    ...(withHeading ? [blankBlock('h2', 'Abstract')] : []),
    ...(heads.length ? heads.flatMap(h => [blankBlock('h3', h), blankBlock('p', '')]) : [blankBlock('p', '')]),
  ];
}

// ---- profiles --------------------------------------------------------------

const DEFAULT_NOTE = 'Set word, abstract, reference and figure limits from the journal’s instructions for authors.';

/** Profiles defined by reporting conventions, not by a journal. No limits are set. */
export const GENERIC_PROFILES = [
  { id: 'imrad-original', name: 'Original article (IMRaD)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.imrad.headings],
    referenceStyle: 'vancouver', requires: ['coi', 'funding', 'ethics', 'dataAvailability', 'credit'],
    notes: `A structured Background, Methods, Results, Conclusions abstract. The statements are those ICMJE recommends disclosing; the reference style is a default. ${DEFAULT_NOTE}`,
    source: { url: 'https://www.icmje.org/recommendations/', checked: null } },
  { id: 'consort-abstract', name: 'Randomised trial (CONSORT abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.consort.headings],
    referenceStyle: 'vancouver', requires: ['registration', 'funding', 'coi', 'ethics', 'dataAvailability', 'credit'],
    notes: `Abstract grouped as CONSORT for Abstracts itemises it; CONSORT asks for trial registration and funding. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.consort.source.url, checked: null } },
  { id: 'prisma-abstract', name: 'Systematic review (PRISMA 2020 abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.prisma.headings],
    referenceStyle: 'vancouver', requires: ['registration', 'funding', 'coi', 'dataAvailability', 'credit'],
    notes: `Abstract as PRISMA 2020 for Abstracts groups it; PRISMA 2020 asks for registration, support, competing interests and data availability. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.prisma.source.url, checked: null } },
  { id: 'case-report', name: 'Case report (CARE abstract)', abstractStructured: true, abstractHeadings: [...STRUCTURED_ABSTRACTS.care.headings],
    referenceStyle: 'vancouver', requires: ['consent', 'coi', 'funding', 'credit'],
    notes: `Abstract in the three parts of CARE item 3; CARE asks for the patient’s informed consent. ${DEFAULT_NOTE}`,
    source: { url: STRUCTURED_ABSTRACTS.care.source.url, checked: null } },
  { id: 'letter', name: 'Letter', abstractStructured: false, abstractHeadings: null,
    referenceStyle: 'vancouver', requires: ['coi'],
    notes: `Many journals publish letters without an abstract. ${DEFAULT_NOTE}`,
    source: { url: null, checked: null } },
];

/**
 * Profiles for a named journal, with the limits its instructions for authors
 * state. Empty on purpose: an entry is added only from instructions that were
 * read, with `source: { url, checked }` naming the page and the date (and
 * validateProfile holds it to that). A preset (lib/journal-presets.mjs) may
 * name one by `profile`.
 */
export const JOURNAL_PROFILES = [];

export const profileById = id => GENERIC_PROFILES.find(p => p.id === id) || JOURNAL_PROFILES.find(p => p.id === id) || null;

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const LIMITS = ['wordLimit', 'abstractLimit', 'referenceLimit', 'figureTableLimit', 'titleLimitChars', 'runningTitleChars'];
const isCount = v => Number.isInteger(v) && v > 0;
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** What is wrong with a profile, as sentences; empty when it is valid. */
export function validateProfile(p) {
  const out = [];
  if (!p || typeof p !== 'object') return ['A profile is an object'];
  if (!String(p.id || '').trim()) out.push('A profile needs an id');
  if (!String(p.name || '').trim()) out.push('A profile needs a name');
  for (const k of LIMITS) if (p[k] != null && !isCount(p[k])) out.push(`${k} must be a whole number above zero`);
  if (!REFERENCE_STYLES.includes(p.referenceStyle)) out.push(`referenceStyle must be one of ${REFERENCE_STYLES.join(', ')}`);
  if (typeof p.abstractStructured !== 'boolean') out.push('abstractStructured must be true or false');
  if (p.abstractHeadings != null) {
    if (!Array.isArray(p.abstractHeadings) || p.abstractHeadings.some(h => typeof h !== 'string' || !h.trim())) out.push('abstractHeadings must be a list of headings');
    else if (new Set(p.abstractHeadings.map(h => h.trim().toLowerCase())).size !== p.abstractHeadings.length) out.push('abstractHeadings repeats a heading');
  }
  if (p.abstractStructured && !p.abstractHeadings?.length) out.push('A structured abstract needs its headings');
  if (p.keywords != null) {
    const { min, max } = p.keywords;
    if (min != null && !(Number.isInteger(min) && min >= 0)) out.push('keywords.min must be a whole number');
    if (max != null && !isCount(max)) out.push('keywords.max must be a whole number above zero');
    if (min != null && max != null && min > max) out.push('keywords.min is above keywords.max');
  }
  if (!Array.isArray(p.requires)) out.push('requires must be a list');
  else for (const r of p.requires) if (!REQUIREMENT_IDS.has(r)) out.push(`Unknown requirement '${r}'`);
  if (p.source != null) {
    if (p.source.url != null && !/^https?:\/\/\S+$/.test(p.source.url)) out.push('source.url must be a web address');
    if (p.source.checked != null && !isDate(p.source.checked)) out.push('source.checked must be a date as YYYY-MM-DD');
  }
  return out;
}

/**
 * A profile from the author's own fields, with defaults for what they leave
 * out. Throws with every problem listed (`err.problems`) when it is invalid.
 */
export function customProfile(fields = {}) {
  const f = { ...fields };
  const headings = Array.isArray(f.abstractHeadings) ? f.abstractHeadings.map(h => String(h).trim()).filter(Boolean)
    : typeof f.abstractHeadings === 'string' ? splitHeadings(f.abstractHeadings) : null;
  const p = {
    id: f.id || (f.name ? `custom-${slug(f.name)}` : ''),
    name: String(f.name || '').trim(),
    ...(f.publisher ? { publisher: String(f.publisher).trim() } : {}),
    ...Object.fromEntries(LIMITS.filter(k => f[k] != null && f[k] !== '').map(k => [k, typeof f[k] === 'string' ? Number(f[k].replace(/[,\s]/g, '')) : f[k]])),
    abstractHeadings: headings?.length ? headings : null,
    abstractStructured: f.abstractStructured ?? Boolean(headings?.length),
    referenceStyle: String(f.referenceStyle || 'vancouver').toLowerCase(),
    ...(f.keywords ? { keywords: { min: f.keywords.min ?? null, max: f.keywords.max ?? null } } : {}),
    requires: [...new Set(f.requires || [])],
    notes: String(f.notes || ''),
    source: { url: f.source?.url || null, checked: f.source?.checked || null },
  };
  const problems = validateProfile(p);
  if (problems.length) { const e = new Error(`Invalid journal profile: ${problems.join('; ')}`); e.problems = problems; throw e; }
  return p;
}

// ---- reading instructions for authors --------------------------------------

const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM = String.raw`(\d{1,3}(?:[,   ]\d{3})+|\d+|(?:${Object.keys(SMALL).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
function toNumber(s) {
  const t = String(s).toLowerCase().trim();
  if (/^\d/.test(t)) return Number(t.replace(/[,   ]/g, ''));
  const [a, b] = t.split(/[- ]/);
  return (SMALL[a] || 0) + (SMALL[b] || 0) || null;
}
// "not exceed", "no more than", "a maximum of", "up to", "limited to", "at most", "should be under"
const CAP = String.raw`(?:(?:should|must|may|shall|will|cannot|can)\s+not\s+exceed|not\s+(?:to\s+)?exceed(?:ing)?|do(?:es)?\s+not\s+exceed|no\s+(?:more|longer)\s+than|not\s+more\s+than|(?:a\s+|the\s+)?max(?:imum|\.)?(?:\s+(?:length|of))*|up\s+to|limited\s+to|(?:is\s+)?limit(?:ed)?\s+(?:of|to)|at\s+most|fewer\s+than|less\s+than|under|within)`;

/** Split pasted text into sentences, keeping "e.g." and decimal points whole. */
export function sentencesOf(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n|\n(?=\s*[-•*\d]+[.)]?\s)|(?<!\b(?:e\.g|i\.e|approx|incl|max|min|no|vs|Fig|etc)\.)(?<=[.!?])\s+(?=[A-Z(“"])/)
    .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function splitHeadings(list) {
  return String(list).replace(/[“”"']/g, '').replace(/\.$/, '')
    .split(/\s*(?:,|;|\band\b|•)\s*/i).map(s => s.replace(/^(?:and|or)\s+/i, '').replace(/^[:\s(]+|[)\s]+$/g, '').trim()).filter(s => s && s.length <= 40)
    .map(s => s[0].toUpperCase() + s.slice(1));
}

const EXCLUDING = /\b(?:exclud\w*|not\s+includ\w*|without|except|apart\s+from|besides)\b/i;

/** Which counted thing a number-with-unit belongs to, from the words around it. */
function subjectOf(before, after, unit) {
  const clause = before.split(/[;:]|,\s|\.\s|\b(?:and|while|whereas|with)\s+(?=an?\s|the\s)/i).pop();
  const near = clause.slice(-80);
  const mentions = (re) => { const m = near.match(re); if (!m) return false; const pre = near.slice(0, m.index).split(/\s+/).slice(-3).join(' '); return !EXCLUDING.test(pre); };
  if (unit === 'char') {
    if (/\b(running|short)\s+(title|head)|\brunning\s+head/i.test(near) || /^\s*(?:\(?including spaces\)?\s*)?(?:for\s+the\s+)?(?:running|short)\s+(?:title|head)/i.test(after)) return 'runningTitleChars';
    if (/\btitle\b/i.test(near) || /^\s*(?:\(?including spaces\)?\s*)?(?:for\s+the\s+)?title/i.test(after)) return 'titleLimitChars';
    return null;
  }
  if (/^\s*(?:\)|\s)?(?:structured\s+|unstructured\s+)?(abstract|summary)\b/i.test(after)) return 'abstractLimit';
  if (mentions(/\b(abstract|summary)\b/i)) return 'abstractLimit';
  // "Abstract: unstructured, maximum 200 words" names its subject as a label
  if (/^\s*(?:the\s+)?(abstract|summary)\s*[:\u2013\u2014-]/i.test(before) && !/\b(manuscript|main\s+text|text|article|paper|body)\b/i.test(near)) return 'abstractLimit';
  // "The abstract must be structured ..., and no more than 250 words": the
  // clause names nothing counted, so the sentence's subject is what is limited
  if (/^\s*(?:the\s+|an?\s+|your\s+)?(?:structured\s+|unstructured\s+)?(abstract|summary)\b/i.test(before)
    && !/\b(abstract|summary|title|manuscript|main\s+text|text|article|paper|body|word\s+count)\b/i.test(clause)) return 'abstractLimit';
  if (mentions(/\b(title)\b/i) && !/\b(manuscript|text|article|paper)\b/i.test(near)) return null;
  return 'wordLimit';
}

/**
 * Limits and requirements read from pasted instructions for authors.
 * Returns `{ profile, evidence, conflicts }`: a partial profile, the sentence
 * each value came from (`[{ field, value, sentence }]`), and the fields for
 * which the text gave more than one value (instructions often list several
 * article types). The first value found is used; the author confirms.
 */
export function profileFromText(text) {
  const evidence = [];
  const add = (field, value, sentence) => { if (value != null && !evidence.some(e => e.field === field && JSON.stringify(e.value) === JSON.stringify(value) && e.sentence === sentence)) evidence.push({ field, value, sentence }); };
  for (const s of sentencesOf(text)) {
    // words and characters: find each "N words" and decide what it limits
    for (const m of s.matchAll(new RegExp(String.raw`${NUM}(?:\s*|-)(words?|characters?|chars?)\b`, 'gi'))) {
      const n = toNumber(m[1]); if (!n) continue;
      const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
      const unit = /^char/i.test(m[2]) ? 'char' : 'word';
      // a number must be stated as a limit ("up to", "no more than", "N-word limit", "maximum")
      const capped = new RegExp(`${CAP}\\s*(?:of\\s+|about\\s+|\\(\\s*)?$`, 'i').test(before)
        || /^\s*(?:or\s+(?:less|fewer)|\(?\s*max(?:imum)?\b|limit)/i.test(after)
        || /^-?\s*words?\s+(?:limit|maximum)/i.test(m[0].slice(m[1].length) + after)
        || /^-words?$/i.test(m[0].slice(m[1].length)) && /^\s*(?:structured\s+|unstructured\s+)?(?:abstract|summary)\b/i.test(after)
        || /\b(?:limit|maximum|length)\b[^.]{0,25}$/i.test(before);
      if (!capped || /\b(at\s+least|minimum\s+of|min\.)\s*$/i.test(before)) continue;
      const field = subjectOf(before, after, unit);
      if (field) add(field, n, s);
    }
    // references
    for (const m of s.matchAll(new RegExp(String.raw`${NUM}\s+(?:references|citations|refs\b)`, 'gi'))) {
      const n = toNumber(m[1]); const before = s.slice(0, m.index);
      if (n && (new RegExp(`${CAP}\\s*$`, 'i').test(before) || /^\s*(?:or\s+fewer|max)/i.test(s.slice(m.index + m[0].length)))) add('referenceLimit', n, s);
    }
    const refCap = s.match(new RegExp(String.raw`\b(?:references?|reference\s+list|citations)\b[^.]{0,40}?${CAP}\s*${NUM}(?!\s*(?:words?|characters?|figures?|tables?))`, 'i'));
    if (refCap) add('referenceLimit', toNumber(refCap[1]), s);
    // figures and tables, together
    const ft = s.match(new RegExp(String.raw`${CAP}\s*(?:a\s+(?:total|combined\s+total)\s+of\s+)?${NUM}\s+(?:(?:figures?|illustrations?)\s*(?:and\/or|and|\/|or|plus|\+)\s*tables?|tables?\s*(?:and\/or|and|\/|or|plus|\+)\s*(?:figures?|illustrations?)|display\s+items|figures?\s+(?:or|and)\s+tables?\s+combined)`, 'i'))
      || s.match(new RegExp(String.raw`\b(?:figures?\s*(?:and\/or|and|\/|or)\s*tables?|tables?\s*(?:and\/or|and|\/|or)\s*figures?|display\s+items)\b[^.]{0,30}?${CAP}\s*${NUM}`, 'i'));
    if (ft) add('figureTableLimit', toNumber(ft[1]), s);
    // keywords: "3 to 6 keywords", "between 3 and 6 key words", "up to 6 keywords"
    const kr = s.match(new RegExp(String.raw`(?:between\s+)?${NUM}\s*(?:to|-|–|and)\s*${NUM}\s+key\s?words?`, 'i'));
    if (kr) add('keywords', { min: toNumber(kr[1]), max: toNumber(kr[2]) }, s);
    else {
      const kmax = s.match(new RegExp(String.raw`${CAP}\s*${NUM}\s+key\s?words?`, 'i')) || s.match(new RegExp(String.raw`key\s?words?[^.]{0,30}?${CAP}\s*${NUM}`, 'i'));
      if (kmax) add('keywords', { min: null, max: toNumber(kmax[1]) }, s);
      const kmin = s.match(new RegExp(String.raw`(?:at\s+least|a\s+minimum\s+of)\s*${NUM}\s+key\s?words?`, 'i'));
      if (kmin) add('keywords', { min: toNumber(kmin[1]), max: null }, s);
    }
    // abstract form
    if (/\bunstructured\s+abstract|\babstract\b[^.]{0,20}\bunstructured\b|\babstract\b[^.]{0,40}\bshould\s+not\s+be\s+structured|\bnon-structured\s+abstract/i.test(s)) add('abstractStructured', false, s);
    else if (/\bstructured\s+(?:abstract|summary)|\babstract\b[^.]{0,40}\bstructured\b/i.test(s)) add('abstractStructured', true, s);
    const hl = s.match(/\b(?:sub)?headings?\s*(?:of|:|as\s+follows:?|such\s+as|including)?\s*[:(]?\s*((?:[“"']?[A-Z][A-Za-z/ -]{1,38}[”"']?\s*(?:,|;|\band\b|•)\s*){2,}[“"']?[A-Z][A-Za-z/ -]{1,38}[”"']?)/)
      || (/\bstructured\s+(?:abstract|summary)/i.test(s) && s.match(/\bstructured\s+(?:abstract|summary)[^(]{0,30}\(\s*([^)]+)\)/i));
    if (hl) { const heads = splitHeadings(hl[1]); if (heads.length >= 2) add('abstractHeadings', heads, s); }
    // reference style, named
    const style = s.match(/\b(Vancouver|AMA|American Medical Association|APA|American Psychological Association|Harvard|NLM|National Library of Medicine)\b[^.]{0,40}\b(?:style|format|system|manual)|\b(?:style|format)\b[^.]{0,30}\b(Vancouver|AMA|APA|Harvard|NLM)\b/i);
    if (style && /\breferenc|\bcitation|\bbibliograph/i.test(s)) {
      const name = (style[1] || style[2]).toLowerCase();
      add('referenceStyle', name.startsWith('american medical') ? 'ama' : name.startsWith('american psych') ? 'apa' : name.startsWith('national library') ? 'nlm' : name, s);
    }
    // statements the instructions mention
    const req = [
      ['coi', /\b(conflicts?\s+of\s+interests?|competing\s+interests?|declarations?\s+of\s+interests?|ICMJE\s+disclosure)/i],
      ['funding', /\b(funding|financial\s+support|sources?\s+of\s+support)\b/i],
      ['dataAvailability', /\b(data\s+availability|data\s+sharing|availability\s+of\s+data)\b/i],
      ['ethics', /\b(ethics\s+(?:committee|approval|statement)|ethical\s+approval|institutional\s+review\s+board|\bIRB\b|research\s+ethics)/i],
      ['consent', /\b(informed\s+consent|patient\s+consent|consent\s+(?:for|to)\s+publication)\b/i],
      ['registration', /\b(trial\s+registration|registered\s+in\s+a\s+(?:public\s+)?(?:trial\s+)?registry|prospectively\s+registered|registration\s+number|PROSPERO)\b/i],
      ['credit', /\b(CRediT|author(?:s'|s)?\s+contributions?|contributorship)\b/i],
      ['orcid', /\bORCID\b/i],
    ];
    for (const [id, re] of req) if (re.test(s)) add(`requires:${id}`, true, s);
  }
  const conflicts = [];
  const profile = {};
  for (const e of evidence) {
    if (e.field.startsWith('requires:')) { (profile.requires ||= []).includes(e.field.slice(9)) || profile.requires.push(e.field.slice(9)); continue; }
    if (!(e.field in profile)) profile[e.field] = e.value;
    else if (JSON.stringify(profile[e.field]) !== JSON.stringify(e.value) && !conflicts.includes(e.field)) conflicts.push(e.field);
  }
  if (profile.abstractHeadings && profile.abstractStructured == null) profile.abstractStructured = true;
  return { profile, evidence, conflicts };
}

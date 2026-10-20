// Further appraisal instruments, in the APPRAISAL_TOOLS shape (schema.mjs),
// with the scoring each instrument itself defines.
//
// Licensing (plan H6): every item keeps the instrument's official name and
// numbering, and its wording here is our own short paraphrase — never the
// published question text, which a reviewer reads from the source linked on
// each instrument. No permission has been recorded for any of them.
//
// Scoring is applied only where the instrument defines it: Newcastle–Ottawa
// stars, MINORS points and AGREE II scaled domain scores. Anything beyond the
// instrument (the Newcastle–Ottawa good/fair/poor conversion) is labelled as
// a convention. MMAT, QUIPS, RoB 1 and the JBI checklists define no score, so
// none is computed (plan H3).
//
// Pure data and functions; no imports, so schema.mjs can import this file.

const YNU = ['Yes', 'No', 'Unclear', 'Not applicable'];
const YNC = ['Yes', 'No', "Can't tell"];
const JBI_SOURCE = { url: 'https://jbi.global/critical-appraisal-tools', note: 'Item numbers as in the JBI checklist (2017–2020 editions); labels are our own paraphrase; no licence stated, use questions go to JBI' };

const items = (list, { prefix = 'q', short = n => `Q${n}` } = {}) =>
  list.map((label, i) => ({ id: `${prefix}${i + 1}`, short: short(i + 1), label }));

// ---- Newcastle–Ottawa Scale ---------------------------------------------------
// Wells et al., OHRI. Selection (four items, one star each), comparability
// (one item, up to two stars) and outcome or exposure (three items, one star
// each): nine stars at most.

const STAR = 'Star', TWO = 'Two stars', NONE = 'No star';
const oneStar = (id, short, label, group) => ({ id, short, label, group, stars: 1, judgements: [STAR, NONE] });
const twoStar = (id, short, label, group) => ({ id, short, label, group, stars: 2, judgements: [TWO, STAR, NONE] });
const NOS_SOURCE = { url: 'https://www.ohri.ca/programs/clinical_epidemiology/oxford.asp', note: 'Item names and star allocation as in the scale; labels are our own paraphrase; the good/fair/poor conversion is a convention (AHRQ), not part of the scale' };

const nosCohort = {
  id: 'nos-cohort',
  name: 'Newcastle–Ottawa, cohort',
  design: 'Cohort studies',
  judgements: [TWO, STAR, NONE],
  source: NOS_SOURCE,
  overall: false,
  scoring: 'nos',
  domains: [
    oneStar('s1', 'S1', 'Selection · exposed cohort represents the target population', 'selection'),
    oneStar('s2', 'S2', 'Selection · non-exposed cohort drawn from the same source', 'selection'),
    oneStar('s3', 'S3', 'Selection · exposure ascertained from a secure record or interview', 'selection'),
    oneStar('s4', 'S4', 'Selection · outcome shown to be absent at the start', 'selection'),
    twoStar('c1', 'C1', 'Comparability · cohorts comparable on the key factor, and on another', 'comparability'),
    oneStar('o1', 'O1', 'Outcome · assessed independently, blind, or by record linkage', 'outcome'),
    oneStar('o2', 'O2', 'Outcome · follow-up long enough for outcomes to occur', 'outcome'),
    oneStar('o3', 'O3', 'Outcome · follow-up complete, or losses unlikely to bias', 'outcome'),
  ],
};

const nosCaseControl = {
  id: 'nos-case-control',
  name: 'Newcastle–Ottawa, case–control',
  design: 'Case–control studies',
  judgements: [TWO, STAR, NONE],
  source: NOS_SOURCE,
  overall: false,
  scoring: 'nos',
  domains: [
    oneStar('s1', 'S1', 'Selection · case definition adequate, independently validated', 'selection'),
    oneStar('s2', 'S2', 'Selection · cases consecutive or clearly representative', 'selection'),
    oneStar('s3', 'S3', 'Selection · controls drawn from the community', 'selection'),
    oneStar('s4', 'S4', 'Selection · controls free of the disease by history', 'selection'),
    twoStar('c1', 'C1', 'Comparability · cases and controls comparable on the key factor, and on another', 'comparability'),
    oneStar('e1', 'E1', 'Exposure · ascertained from a secure record or blinded interview', 'exposure'),
    oneStar('e2', 'E2', 'Exposure · same ascertainment for cases and controls', 'exposure'),
    oneStar('e3', 'E3', 'Exposure · non-response rate the same in both groups', 'exposure'),
  ],
};

const NOS_MAX = { selection: 4, comparability: 2, outcome: 3, exposure: 3 };
const starsOf = (d, v) => (v === TWO ? Math.min(2, d.stars) : v === STAR ? 1 : 0);

/**
 * Stars per Newcastle–Ottawa domain and in total. `third` is 'outcome' for a
 * cohort study and 'exposure' for a case–control study. `convention` is the
 * AHRQ good/fair/poor conversion — widely used, but not part of the scale —
 * and is '' until every item is answered.
 */
export function nosScore(tool, answers = {}) {
  const third = tool.id === 'nos-case-control' ? 'exposure' : 'outcome';
  const by = { selection: 0, comparability: 0, [third]: 0 };
  let unanswered = 0;
  for (const d of tool.domains) {
    const v = answers[d.id];
    if (!v) unanswered++;
    by[d.group] += starsOf(d, v);
  }
  const total = by.selection + by.comparability + by[third];
  const complete = unanswered === 0;
  return {
    selection: by.selection, comparability: by.comparability, [third]: by[third], third,
    total, max: 9, unanswered, complete,
    convention: complete ? nosConvention(by.selection, by.comparability, by[third]) : '',
    conventionNote: 'Good/fair/poor thresholds are the AHRQ convention, not part of the Newcastle–Ottawa Scale',
  };
}

/** The AHRQ conversion: good 3–4 / 1–2 / 2–3 stars; fair 2 / 1–2 / 2–3; poor otherwise. */
export function nosConvention(selection, comparability, third) {
  if (selection <= 1 || comparability === 0 || third <= 1) return 'Poor';
  return selection >= 3 ? 'Good' : 'Fair';
}

// ---- MINORS --------------------------------------------------------------------
// Slim et al. 2003: twelve items scored 0 (not reported), 1 (reported but
// inadequate) or 2 (reported and adequate). The first eight apply to every
// study (ideal 16); items 9–12 only to comparative studies (ideal 24).

const MINORS_LEVELS = ['Reported, adequate', 'Reported, inadequate', 'Not reported'];
const MINORS_POINTS = { 'Reported, adequate': 2, 'Reported, inadequate': 1, 'Not reported': 0 };
const minors = {
  id: 'minors',
  name: 'MINORS',
  design: 'Non-randomised surgical studies',
  judgements: [...MINORS_LEVELS, 'Not applicable'],
  source: { url: 'https://doi.org/10.1046/j.1445-2197.2003.02748.x', note: 'Slim et al. ANZ J Surg 2003;73:712–6. Item numbers and 0/1/2 scoring as published; labels are our own paraphrase' },
  overall: false,
  scoring: 'minors',
  domains: [
    'Aim of the study clearly stated',
    'Consecutive patients included',
    'Data collected prospectively',
    'Endpoints suit the aim',
    'Endpoint assessed without bias',
    'Follow-up long enough for the aim',
    'Loss to follow-up under 5%',
    'Study size calculated in advance',
    'Control group adequate · comparative only',
    'Groups contemporary · comparative only',
    'Groups equivalent at baseline · comparative only',
    'Statistical analysis adequate · comparative only',
  ].map((label, i) => ({ id: `q${i + 1}`, short: String(i + 1), label, comparative: i >= 8,
    judgements: i >= 8 ? [...MINORS_LEVELS, 'Not applicable'] : MINORS_LEVELS })),
};

/**
 * MINORS points. A study is comparative when `comparative` says so, or else
 * when any of items 9–12 has an answer other than "Not applicable". The
 * maximum is 16 for a non-comparative study and 24 for a comparative one.
 */
export function minorsScore(answers = {}, { comparative } = {}) {
  const comp = comparative ?? minors.domains.some(d => d.comparative && answers[d.id] && answers[d.id] !== 'Not applicable');
  const used = minors.domains.filter(d => comp || !d.comparative);
  let total = 0, unanswered = 0;
  const points = {};
  for (const d of used) {
    const v = answers[d.id];
    if (!(v in MINORS_POINTS)) { unanswered++; continue; }
    points[d.id] = MINORS_POINTS[v];
    total += MINORS_POINTS[v];
  }
  return { comparative: comp, total, max: used.length * 2, items: used.length, points, unanswered, complete: unanswered === 0 };
}

// ---- Cochrane RoB 1 (2011) ---------------------------------------------------------
const rob1 = {
  id: 'rob1',
  name: 'RoB 1 (2011)',
  design: 'Randomised trials',
  judgements: ['Low', 'Unclear', 'High'],
  source: { url: 'https://doi.org/10.1136/bmj.d5928', note: 'Higgins et al. BMJ 2011;343:d5928. Domain names and judgement levels; the summary across domains is the reviewer’s (Handbook 5.1, 8.7)' },
  overall: true,
  domains: [
    'Random sequence generation (selection bias)',
    'Allocation concealment (selection bias)',
    'Blinding of participants and personnel (performance bias)',
    'Blinding of outcome assessment (detection bias)',
    'Incomplete outcome data (attrition bias)',
    'Selective reporting (reporting bias)',
    'Other bias',
  ].map((label, i) => ({ id: `d${i + 1}`, short: `D${i + 1}`, label })),
};

// ---- MMAT 2018 ---------------------------------------------------------------------
// Hong et al. 2018: two screening questions for every study, then five
// criteria for its category. The MMAT discourages an overall score: each
// criterion is reported, so these instruments have no overall and no total.
// A mixed-methods study is appraised on 5.1–5.5 and the qualitative criteria
// here, and on its quantitative component with the matching MMAT category.

const MMAT_SOURCE = { url: 'https://mixedmethodsappraisaltoolpublic.pbworks.com/', note: 'Hong et al. MMAT version 2018. Criterion numbers as published; labels are our own paraphrase. No overall score by design: report each criterion' };
const SCREEN = [
  { id: 's1', short: 'S1', label: 'Screening · research questions are clear' },
  { id: 's2', short: 'S2', label: 'Screening · the data collected can answer them' },
];
const MMAT = {
  1: ['Qualitative studies', 'qual', [
    'Qualitative approach suits the question',
    'Data collection adequate for the question',
    'Findings adequately derived from the data',
    'Interpretation substantiated by the data',
    'Coherent from data sources to interpretation']],
  2: ['Randomised controlled trials', 'rct', [
    'Randomisation appropriately performed',
    'Groups comparable at baseline',
    'Outcome data complete',
    'Outcome assessors blinded',
    'Participants adhered to the assigned intervention']],
  3: ['Non-randomised studies', 'nrs', [
    'Participants represent the target population',
    'Outcome and exposure measured appropriately',
    'Outcome data complete',
    'Confounders accounted for in design and analysis',
    'Intervention delivered as intended']],
  4: ['Quantitative descriptive studies', 'desc', [
    'Sampling strategy relevant to the question',
    'Sample represents the target population',
    'Measurements appropriate',
    'Risk of non-response bias low',
    'Statistical analysis appropriate']],
  5: ['Mixed methods studies', 'mixed', [
    'Rationale for a mixed methods design given',
    'Components effectively integrated',
    'Integration outputs adequately interpreted',
    'Divergences between components addressed',
    'Each component meets its tradition’s criteria']],
};
const mmatCriteria = n => MMAT[n][2].map((label, i) => ({ id: `c${n}_${i + 1}`, short: `${n}.${i + 1}`, label }));
const mmatTools = [1, 2, 3, 4, 5].map(n => ({
  id: `mmat-${MMAT[n][1]}`,
  name: `MMAT, ${MMAT[n][0].toLowerCase()}`,
  design: MMAT[n][0],
  judgements: YNC,
  source: MMAT_SOURCE,
  overall: false,
  noScore: true,
  domains: [...SCREEN, ...(n === 5 ? mmatCriteria(1) : []), ...mmatCriteria(n)],
}));

/** Whether MMAT appraisal can proceed: both screening questions answered Yes. */
export function mmatScreen(answers = {}) {
  const failed = SCREEN.filter(d => answers[d.id] && answers[d.id] !== 'Yes').map(d => d.short);
  const open = SCREEN.filter(d => !answers[d.id]).map(d => d.short);
  return { proceed: !failed.length && !open.length, failed, open,
    reason: failed.length ? `${failed.join(' and ')} not answered Yes: the MMAT advises that further appraisal may not be feasible` : open.length ? 'Screening questions unanswered' : '' };
}

// ---- QUIPS ------------------------------------------------------------------------------
const quips = {
  id: 'quips',
  name: 'QUIPS',
  design: 'Prognostic factor studies',
  judgements: ['Low', 'Moderate', 'High'],
  source: { url: 'https://doi.org/10.7326/0003-4819-158-4-201302190-00009', note: 'Hayden et al. Ann Intern Med 2013;158:280–6. Domain names and risk levels; the prompting items are in the published tool' },
  overall: false,
  domains: [
    'Study participation',
    'Study attrition',
    'Prognostic factor measurement',
    'Outcome measurement',
    'Study confounding',
    'Statistical analysis and reporting',
  ].map((label, i) => ({ id: `d${i + 1}`, short: `D${i + 1}`, label })),
};

// ---- JBI checklists ---------------------------------------------------------------------
// The JBI case report and case series checklists are in schema.mjs already.
const jbi = (id, name, design, list) => ({ id, name, design, judgements: YNU, overall: false, source: JBI_SOURCE, domains: items(list) });
const jbiTools = [
  jbi('jbi-rct', 'JBI randomised controlled trial', 'Randomised trials', [
    'True randomisation used',
    'Allocation concealed',
    'Groups similar at baseline',
    'Participants blinded to assignment',
    'Those delivering treatment blinded',
    'Outcome assessors blinded',
    'Groups treated alike apart from the intervention',
    'Follow-up complete, or losses described and analysed',
    'Analysed in the groups randomised',
    'Outcomes measured the same way in each group',
    'Outcomes measured reliably',
    'Statistical analysis appropriate',
    'Trial design appropriate, deviations accounted for',
  ]),
  jbi('jbi-quasi', 'JBI quasi-experimental', 'Quasi-experimental studies', [
    'Cause and effect clearly distinguished',
    'Participants in comparisons similar',
    'Similar care apart from the intervention',
    'A control group',
    'Outcome measured more than once before and after',
    'Follow-up complete, or losses described and analysed',
    'Outcomes measured the same way in each comparison',
    'Outcomes measured reliably',
    'Statistical analysis appropriate',
  ]),
  jbi('jbi-cohort', 'JBI cohort', 'Cohort studies', [
    'Groups similar and from the same population',
    'Exposure measured alike to assign groups',
    'Exposure measured validly and reliably',
    'Confounders identified',
    'Strategies for confounding stated',
    'Participants free of the outcome at the start',
    'Outcomes measured validly and reliably',
    'Follow-up reported and long enough',
    'Follow-up complete, or losses described and explored',
    'Strategies for incomplete follow-up used',
    'Statistical analysis appropriate',
  ]),
  jbi('jbi-case-control', 'JBI case–control', 'Case–control studies', [
    'Groups comparable apart from the condition',
    'Cases and controls matched appropriately',
    'Same criteria to identify cases and controls',
    'Exposure measured in a standard, valid, reliable way',
    'Exposure measured alike for cases and controls',
    'Confounders identified',
    'Strategies for confounding stated',
    'Outcomes assessed in a standard, valid, reliable way',
    'Exposure period long enough to matter',
    'Statistical analysis appropriate',
  ]),
  jbi('jbi-cross-sectional', 'JBI analytical cross-sectional', 'Analytical cross-sectional studies', [
    'Inclusion criteria clearly defined',
    'Subjects and setting described in detail',
    'Exposure measured validly and reliably',
    'Objective, standard criteria for the condition',
    'Confounders identified',
    'Strategies for confounding stated',
    'Outcomes measured validly and reliably',
    'Statistical analysis appropriate',
  ]),
  jbi('jbi-prevalence', 'JBI prevalence', 'Prevalence studies', [
    'Sample frame suits the target population',
    'Participants sampled appropriately',
    'Sample size adequate',
    'Subjects and setting described in detail',
    'Analysis covers the identified sample sufficiently',
    'Valid methods to identify the condition',
    'Condition measured in a standard, reliable way for all',
    'Statistical analysis appropriate',
    'Response rate adequate, or low response managed',
  ]),
  jbi('jbi-qual', 'JBI qualitative', 'Qualitative studies', [
    'Philosophical perspective fits the methodology',
    'Methodology fits the question or objectives',
    'Methodology fits the data collection',
    'Methodology fits the representation and analysis of data',
    'Methodology fits the interpretation of results',
    'Researcher located culturally or theoretically',
    'Researcher’s influence addressed, and the reverse',
    'Participants and their voices adequately represented',
    'Ethical by current criteria, with approval',
    'Conclusions flow from the analysis',
  ]),
  jbi('jbi-sr', 'JBI systematic reviews', 'Systematic reviews and research syntheses', [
    'Review question clearly stated',
    'Inclusion criteria suit the question',
    'Search strategy appropriate',
    'Sources searched adequate',
    'Appraisal criteria appropriate',
    'Appraisal by two or more reviewers independently',
    'Methods to minimise extraction errors',
    'Methods to combine studies appropriate',
    'Likelihood of publication bias assessed',
    'Recommendations supported by the data',
    'Directives for new research appropriate',
  ]),
];

// ---- AGREE II ----------------------------------------------------------------------------
// 23 items in six domains, each rated 1 (strongly disagree) to 7 (strongly
// agree), and two overall assessments: the guideline's overall quality (1–7,
// kept as the instrument's overall) and whether it is recommended for use.
// A domain score is scaled over all appraisers:
//   (obtained − minimum possible) / (maximum possible − minimum possible),
// where minimum = 1 × items × appraisers and maximum = 7 × items × appraisers.

export const AGREE_DOMAINS = [
  { n: 1, name: 'Scope and purpose' },
  { n: 2, name: 'Stakeholder involvement' },
  { n: 3, name: 'Rigour of development' },
  { n: 4, name: 'Clarity of presentation' },
  { n: 5, name: 'Applicability' },
  { n: 6, name: 'Editorial independence' },
];
const AGREE_LEVELS = ['7 · Strongly agree', '6', '5', '4', '3', '2', '1 · Strongly disagree'];
const AGREE_ITEMS = [
  [1, 'Overall objectives described'],
  [1, 'Health questions described'],
  [1, 'Population to whom it applies described'],
  [2, 'Group includes all relevant professions'],
  [2, 'Views of the target population sought'],
  [2, 'Target users defined'],
  [3, 'Evidence searched systematically'],
  [3, 'Evidence selection criteria described'],
  [3, 'Strengths and limits of the evidence described'],
  [3, 'Methods for forming recommendations described'],
  [3, 'Benefits, side effects and risks considered'],
  [3, 'Recommendations explicitly linked to evidence'],
  [3, 'Externally reviewed before publication'],
  [3, 'Updating procedure given'],
  [4, 'Recommendations specific and unambiguous'],
  [4, 'Management options presented'],
  [4, 'Key recommendations easy to find'],
  [5, 'Facilitators and barriers described'],
  [5, 'Advice or tools for practice provided'],
  [5, 'Resource implications considered'],
  [5, 'Monitoring or auditing criteria given'],
  [6, 'Funder’s views did not influence content'],
  [6, 'Competing interests recorded and addressed'],
];
const agree = {
  id: 'agree-ii',
  name: 'AGREE II',
  design: 'Clinical practice guidelines',
  judgements: AGREE_LEVELS,
  source: { url: 'https://www.agreetrust.org/resource-centre/agree-ii/', note: 'Item numbers, domains and the 1–7 scale as published; labels are our own paraphrase; reuse terms to be confirmed' },
  overall: true,
  scoring: 'agree',
  domains: [
    ...AGREE_ITEMS.map(([dn, label], i) => ({ id: `i${i + 1}`, short: String(i + 1), group: dn,
      label: `${AGREE_DOMAINS[dn - 1].name} · ${label}` })),
    { id: 'recommend', short: 'Rec', label: 'Overall assessment · recommended for use', judgements: ['Yes', 'Yes with modifications', 'No'] },
  ],
};

/** An AGREE II rating (label or number) as its number 1–7, or null. */
export const agreeValue = v => { const n = parseInt(String(v ?? ''), 10); return n >= 1 && n <= 7 ? n : null; };

/**
 * Scaled AGREE II domain scores over several appraisers. `appraisals` is an
 * array of answer maps, one per appraiser ({ i1: '5', … } or numbers). A
 * domain is scored only when every appraiser rated every item in it.
 * Returns [{ domain, name, items, appraisers, obtained, min, max, scaled, pct }].
 */
export function agreeScores(appraisals = []) {
  const n = appraisals.length;
  return AGREE_DOMAINS.map(({ n: dn, name }) => {
    const ids = agree.domains.filter(d => d.group === dn).map(d => d.id);
    const values = appraisals.flatMap(a => ids.map(id => agreeValue(a?.[id])));
    const complete = n > 0 && values.every(v => v != null);
    const obtained = values.reduce((t, v) => t + (v || 0), 0);
    const min = 1 * ids.length * n, max = 7 * ids.length * n;
    const scaled = complete ? (obtained - min) / (max - min) : null;
    return { domain: dn, name, items: ids.length, appraisers: n, obtained, min, max, complete, scaled,
      pct: scaled == null ? null : Math.round(scaled * 1000) / 10 };
  });
}

// ---- the set, and the tones their judgement levels need ------------------------------------

export const EXTRA_TOOLS = [nosCohort, nosCaseControl, minors, rob1, ...mmatTools, quips, ...jbiTools, agree];

/**
 * Judgement levels these instruments add to schema.mjs's JUDGEMENT_TONE.
 * Stars and MINORS points read as favourable to unfavourable, as they are
 * scored. AGREE II has no traffic-light convention, so its levels are neutral.
 */
export const EXTRA_JUDGEMENT_TONE = {
  [STAR]: 'good', [TWO]: 'good', [NONE]: 'bad',
  'Reported, adequate': 'good', 'Reported, inadequate': 'unclear', 'Not reported': 'bad',
  ...Object.fromEntries(AGREE_LEVELS.map(l => [l, 'none'])),
  'Yes with modifications': 'unclear',
};

/** The score an instrument defines for one study's answers, or null when it defines none. */
export function scoreOf(tool, answers) {
  if (tool?.scoring === 'nos') return nosScore(tool, answers);
  if (tool?.scoring === 'minors') return minorsScore(answers);
  if (tool?.scoring === 'agree') return agreeScores([answers]);
  return null;
}

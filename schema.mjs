import { toTool } from './lib/custom-instrument.mjs';
import { EXTRA_TOOLS, EXTRA_JUDGEMENT_TONE } from './lib/appraisal-extra.mjs';
// Extraction schema. Fields marked `analysis` map onto metafor's escalc inputs,
// so a completed table drives a meta-analysis without re-entry (plan I1).
// Field guidance for the built-in extraction fields: what the field is (guide, at most 24 words) and one example of a value.
// The values a field accepts are not written here: they come from its type, unit and limits (lib/field-guide.mjs).
const GUIDES = {
  design: ['Study design as the authors describe it, for example randomised trial, cohort study or case-control study.', 'Parallel-group randomised trial'],
  population: ['Who was studied: the participants, the setting and the main eligibility features, as reported.', 'Adults aged 18 or older with type 2 diabetes'],
  intervention: ['What was given: the intervention, with dose, route and duration.', 'Drug X 10 mg orally once daily for 12 weeks'],
  comparator: ['What the intervention was compared with, such as placebo, usual care or another treatment, with dose and duration if given.', 'Placebo tablet once daily for 12 weeks'],
  outcome: ['The outcome as the authors define it, with the measure or scale, and the time point.', 'Death from any cause at 12 months'],
  events_t: ['Participants with the event in the treated arm. A count, not a percentage.', '14'],
  n_t: ['Participants analysed in the treated arm. Use the number in the analysis, which can differ from the number randomised.', '120'],
  events_c: ['Participants with the event in the control arm. A count, not a percentage.', '22'],
  n_c: ['Participants analysed in the control arm. Use the number in the analysis, which can differ from the number randomised.', '118'],
  mean_t: ['Arithmetic mean of the outcome in the treated arm, in the unit reported. Not a median.', '5.2'],
  sd_t: ['Standard deviation in the treated arm. Not a standard error, confidence interval, interquartile range or range.', '1.8'],
  mean_c: ['Arithmetic mean of the outcome in the control arm, in the unit reported. Not a median.', '6.1'],
  sd_c: ['Standard deviation in the control arm. Not a standard error, confidence interval, interquartile range or range.', '2.0'],
  hr: ['Hazard ratio of the intervention against the control, as reported.', '0.75'],
  hr_lo: ['Lower limit of the reported 95% confidence interval of the hazard ratio.', '0.60'],
  hr_hi: ['Upper limit of the reported 95% confidence interval of the hazard ratio.', '0.94'],
  effect_estimate: ['One reported model estimate, on its natural scale, such as an odds ratio or a mean difference. Copy it; never calculate it.', '1.35'],
  effect_se: ['Reported standard error of this estimate. For ratios, only the standard error of its natural logarithm.', '0.12'],
  effect_lo: ['Reported lower limit of the confidence interval for this estimate, on the same scale as the estimate.', '1.05'],
  effect_hi: ['Reported upper limit of the confidence interval for this estimate, on the same scale as the estimate.', '1.74'],
  effect_confidence: ['Confidence level of the reported interval, as a percentage. Leave it empty when the paper does not state it.', '95'],
  effect_df: ['Degrees of freedom used for the reported confidence interval. Only if stated.', '28'],
  effect_uncertainty: ['Which uncertainty was reported for this estimate: SE for a standard error, CI for a confidence interval.', 'CI'],
  effect_population: ['Population and analysis subset that produced this estimate, including any matching or weighting.', 'Per-protocol population'],
  effect_contrast: ['What is compared: the intervention against its reference and the direction, or the predictor increment and its unit.', 'Treated versus control'],
  effect_adjustment_type: ['Whether this estimate is adjusted or unadjusted, as the paper states.', 'Adjusted'],
  effect_adjustment: ['Name of the model and the covariates used to adjust this estimate.', 'Cox model adjusted for age and sex'],
  effect_source: ['Where this estimate appears in the paper: table, model number, figure or text location.', 'Table 3, model 2'],
  time_t: ['Total person-time at risk in the treated arm, in the unit reported.', '420 person-years'],
  time_c: ['Total person-time at risk in the control arm, in the unit reported.', '455 person-years'],
  events: ['Participants with the event in a single group. A count, not a percentage.', '31'],
  n: ['Participants analysed in a single group.', '250'],
  mean: ['Arithmetic mean of the outcome in a single group, in the unit reported. Not a median.', '4.7'],
  sd: ['Standard deviation in a single group. Not a standard error, confidence interval, interquartile range or range.', '1.3'],
  r: ['Correlation coefficient r as reported, between -1 and 1. Not r squared and not a regression slope.', '0.42'],
  followup: ['Length of follow-up as reported. Say whether it is the mean, median or maximum, and give the unit.', 'Median 24 months'],
  dta_index: ['The test being evaluated (the index test), with its name or technique as reported.', 'Rapid antigen test'],
  dta_reference: ['The test taken as the truth, against which the index test is judged.', 'Culture'],
  dta_threshold: ['The cut-off at which the index test is called positive, with its unit.', 'Cut-off of 5 ng/mL'],
  dta_population: ['Who was tested: the participants, the setting and how they were selected.', 'Adults presenting to an emergency department'],
  dta_source: ['Where the 2×2 counts appear in the paper: table, figure or text location.', 'Table 2'],
  tp: ['Index test positive and reference standard positive. A count of patients, or of the unit stated.', '86'],
  fp: ['Index test positive and reference standard negative. A count of patients, or of the unit stated.', '12'],
  fn: ['Index test negative and reference standard positive. A count of patients, or of the unit stated.', '9'],
  tn: ['Index test negative and reference standard negative. A count of patients, or of the unit stated.', '193'],
  umb_studies: ['Number of primary studies the review included, as it reports.', '24'],
  umb_designs: ['Designs of the primary studies the review included.', 'Randomised trials and cohort studies'],
  umb_search: ['Date of the review\'s last literature search, as reported.', 'March 2023'],
  umb_synthesis: ['How the review combined results: meta-analysis, narrative synthesis or another method.', 'Random-effects meta-analysis'],
  qual_setting: ['Where and in what context the study took place, as reported.', 'Outpatient clinics in two hospitals'],
  qual_collection: ['How the data were gathered: interviews, focus groups, observation or documents.', 'Semi-structured interviews'],
  qual_analysis: ['How the data were analysed, naming the approach as the authors do.', 'Thematic analysis'],
};

export const FIELDS = [
  { id: 'design',       label: 'Design',             type: 'text' },
  { id: 'population',   label: 'Population',         type: 'text' },
  { id: 'intervention', label: 'Intervention',       type: 'text' },
  { id: 'comparator',   label: 'Comparator',         type: 'text' },
  { id: 'outcome',      label: 'Outcome definition', type: 'text' },
  { id: 'events_t',     label: 'Events, treated',    type: 'integer', analysis: 'ai'  },
  { id: 'n_t',          label: 'N, treated',         type: 'integer', analysis: 'n1i' },
  { id: 'events_c',     label: 'Events, control',    type: 'integer', analysis: 'ci'  },
  { id: 'n_c',          label: 'N, control',         type: 'integer', analysis: 'n2i' },
  { id: 'mean_t',       label: 'Mean, treated',      type: 'number',  analysis: 'm1i' },
  { id: 'sd_t',         label: 'SD, treated',        type: 'number',  analysis: 'sd1i' },
  { id: 'mean_c',       label: 'Mean, control',      type: 'number',  analysis: 'm2i' },
  { id: 'sd_c',         label: 'SD, control',        type: 'number',  analysis: 'sd2i' },
  { id: 'hr',           label: 'Hazard ratio',       type: 'number',  analysis: 'est' },
  { id: 'hr_lo',        label: 'HR, lower 95% CI',   type: 'number',  analysis: 'lo' },
  { id: 'hr_hi',        label: 'HR, upper 95% CI',   type: 'number',  analysis: 'hi' },
  { id: 'effect_estimate', label: 'Reported estimate', type: 'number', analysis: 'yi' },
  { id: 'effect_se', label: 'SE (log scale for ratios)', type: 'number', analysis: 'sei' },
  { id: 'effect_lo', label: 'Reported CI, lower', type: 'number', analysis: 'lo' },
  { id: 'effect_hi', label: 'Reported CI, upper', type: 'number', analysis: 'hi' },
  { id: 'effect_confidence', label: 'Reported CI level (%)', type: 'number', analysis: 'confidence' },
  { id: 'effect_df', label: 'Reported CI degrees of freedom (optional)', type: 'number', analysis: 'df' },
  { id: 'effect_uncertainty', label: 'Uncertainty input (SE or CI)', type: 'text', analysis: 'uncertainty' },
  { id: 'effect_population', label: 'Estimate population', type: 'text', analysis: 'population' },
  { id: 'effect_contrast', label: 'Estimate contrast / coefficient unit', type: 'text', analysis: 'contrast' },
  { id: 'effect_adjustment_type', label: 'Estimate type (adjusted or unadjusted)', type: 'text', analysis: 'adjustment_type' },
  { id: 'effect_adjustment', label: 'Model / adjustment variables', type: 'text', analysis: 'adjustment' },
  { id: 'effect_source', label: 'Estimate source / table / model', type: 'text', analysis: 'source' },
  { id: 'time_t',       label: 'Person-time, treated', type: 'number', analysis: 't1i' },
  { id: 'time_c',       label: 'Person-time, control', type: 'number', analysis: 't2i' },
  { id: 'events',       label: 'Events',             type: 'integer', analysis: 'xi' },
  { id: 'n',            label: 'N',                  type: 'integer', analysis: 'ni' },
  { id: 'mean',         label: 'Mean',               type: 'number',  analysis: 'mi' },
  { id: 'sd',           label: 'SD',                 type: 'number',  analysis: 'sdi' },
  { id: 'r',            label: 'Correlation r',      type: 'number',  analysis: 'ri' },
  { id: 'followup',     label: 'Follow-up',          type: 'text' },
  // Diagnostic test accuracy (family 'dta'): the index test against the
  // reference standard, as a 2×2 table. Shown only in an accuracy review, or
  // where a value exists (lib/fields.mjs); pooled by lib/dta.mjs.
  { id: 'dta_index',     label: 'Index test',         type: 'text',    family: 'dta' },
  { id: 'dta_reference', label: 'Reference standard', type: 'text',    family: 'dta' },
  { id: 'dta_threshold', label: 'Threshold',          type: 'text',    family: 'dta' },
  { id: 'dta_population', label: 'Test population', type: 'text', family: 'dta' },
  { id: 'dta_source', label: 'Test source / table', type: 'text', family: 'dta' },
  { id: 'tp',            label: 'True positives',     type: 'integer', family: 'dta', analysis: 'tp' },
  { id: 'fp',            label: 'False positives',    type: 'integer', family: 'dta', analysis: 'fp' },
  { id: 'fn',            label: 'False negatives',    type: 'integer', family: 'dta', analysis: 'fn' },
  { id: 'tn',            label: 'True negatives',     type: 'integer', family: 'dta', analysis: 'tn' },
  // Umbrella review (family 'umbrella'): what describes an included systematic
  // review. Shown only in an umbrella review, or where a value exists.
  { id: 'umb_studies',   label: 'Primary studies included', type: 'integer', family: 'umbrella' },
  { id: 'umb_designs',   label: 'Primary study designs',    type: 'text',    family: 'umbrella' },
  { id: 'umb_search',    label: 'Last search date',         type: 'text',    family: 'umbrella' },
  { id: 'umb_synthesis', label: 'Synthesis method',         type: 'text',    family: 'umbrella' },
  // Qualitative evidence synthesis (family 'qual'): how a primary qualitative
  // study gathered and analysed its data. Shown only in that review type, or
  // where a value exists (lib/fields.mjs).
  { id: 'qual_setting',    label: 'Setting',            type: 'text', family: 'qual' },
  { id: 'qual_collection', label: 'Data collection',    type: 'text', family: 'qual' },
  { id: 'qual_analysis',   label: 'Analysis approach',  type: 'text', family: 'qual' },
].map(f => (GUIDES[f.id] ? { ...f, guide: GUIDES[f.id][0], example: GUIDES[f.id][1] } : f));

// RoB 2 domains. The judgement vocabulary is the instrument's own; the app does
// not invent levels or aggregate them into a score (plan H2, H3).
export const ROB2_DOMAINS = [
  { id: 'd1', label: 'Randomisation process' },
  { id: 'd2', label: 'Deviations from intended interventions' },
  { id: 'd3', label: 'Missing outcome data' },
  { id: 'd4', label: 'Measurement of the outcome' },
  { id: 'd5', label: 'Selection of the reported result' },
];
export const ROB2_JUDGEMENTS = ['Low', 'Some concerns', 'High', 'No information'];

// Appraisal instruments. Each carries its own item list and its own judgement
// vocabulary: an instrument designed for randomised trials cannot be
// applied to a case series, and the app must not blur the two (plan H2).
// `short` is the column header; `label` is the instrument's own wording.
export const APPRAISAL_TOOLS = [
  {
    id: 'rob2',
    name: 'RoB 2',
    design: 'Randomised trials',
    judgements: ROB2_JUDGEMENTS,
    source: { url: 'https://www.riskofbias.info/welcome/rob-2-0-tool', licence: 'CC BY-NC-ND 4.0', note: 'Domain names and judgement levels only; the signalling questions are in the official tool' },
    overall: true,
    domains: ROB2_DOMAINS.map((d, i) => ({ ...d, short: `D${i + 1}` })),
  },
  {
    id: 'robins-i',
    name: 'ROBINS-I',
    design: 'Non-randomised studies of interventions',
    judgements: ['Low', 'Moderate', 'Serious', 'Critical', 'No information'],
    source: { url: 'https://www.riskofbias.info/welcome/home', licence: 'CC BY-NC-ND 4.0', note: 'Domain names and judgement levels only; the signalling questions are in the official tool' },
    overall: true,
    domains: [
      { id: 'd1', short: 'D1', label: 'Confounding' },
      { id: 'd2', short: 'D2', label: 'Selection of participants' },
      { id: 'd3', short: 'D3', label: 'Classification of interventions' },
      { id: 'd4', short: 'D4', label: 'Deviations from intended interventions' },
      { id: 'd5', short: 'D5', label: 'Missing data' },
      { id: 'd6', short: 'D6', label: 'Measurement of outcomes' },
      { id: 'd7', short: 'D7', label: 'Selection of the reported result' },
    ],
  },
  {
    id: 'jbi-case-report',
    name: 'JBI case report',
    design: 'Case reports',
    judgements: ['Yes', 'No', 'Unclear', 'Not applicable'],
    overall: false,
    source: { url: 'https://jbi.global/critical-appraisal-tools', note: 'Item labels are short paraphrases; read the official checklist for the questions' },
    domains: [
      { id: 'q1', short: 'Q1', label: 'Patient demographics described' },
      { id: 'q2', short: 'Q2', label: 'History and timeline described' },
      { id: 'q3', short: 'Q3', label: 'Condition on presentation described' },
      { id: 'q4', short: 'Q4', label: 'Diagnostics and results described' },
      { id: 'q5', short: 'Q5', label: 'Intervention described' },
      { id: 'q6', short: 'Q6', label: 'Condition after intervention described' },
      { id: 'q7', short: 'Q7', label: 'Adverse events described' },
      { id: 'q8', short: 'Q8', label: 'Takeaway lessons' },
    ],
  },
  {
    id: 'jbi-case-series',
    name: 'JBI case series',
    design: 'Case series',
    judgements: ['Yes', 'No', 'Unclear', 'Not applicable'],
    overall: false,
    source: { url: 'https://jbi.global/critical-appraisal-tools', note: 'Item labels are short paraphrases; read the official checklist for the questions' },
    domains: [
      { id: 'q1', short: 'Q1', label: 'Inclusion criteria clear' },
      { id: 'q2', short: 'Q2', label: 'Condition measured reliably' },
      { id: 'q3', short: 'Q3', label: 'Condition identified by valid methods' },
      { id: 'q4', short: 'Q4', label: 'Consecutive inclusion' },
      { id: 'q5', short: 'Q5', label: 'Complete inclusion' },
      { id: 'q6', short: 'Q6', label: 'Demographics reported' },
      { id: 'q7', short: 'Q7', label: 'Clinical information reported' },
      { id: 'q8', short: 'Q8', label: 'Outcomes or follow-up reported' },
      { id: 'q9', short: 'Q9', label: 'Site demographics reported' },
      { id: 'q10', short: 'Q10', label: 'Statistical analysis appropriate' },
    ],
  },
  // QUADAS-2 (Whiting et al. 2011): four domains, each judged for risk of bias
  // and the first three for applicability. The domain names are the tool's;
  // the item wording here is our own paraphrase, not the published signalling
  // questions (plan H6), which a reviewer should read from the source.
  {
    id: 'quadas-2',
    name: 'QUADAS-2',
    design: 'Diagnostic accuracy studies',
    judgements: ['Low', 'High', 'Unclear'],
    source: { url: 'https://www.bristol.ac.uk/population-health-sciences/projects/quadas/', note: 'Own paraphrase of the domains; the signalling questions are in the official tool' },
    overall: false,
    domains: [
      { id: 'd1', short: 'D1', label: 'Patient selection, risk of bias: enrolment, exclusions and design that could distort accuracy',
        signals: ['Consecutive or random enrolment', 'Case–control sampling avoided', 'No inappropriate exclusions'] },
      { id: 'd2', short: 'D2', label: 'Index test, risk of bias: conduct or reading of the test that could distort accuracy',
        signals: ['Read without knowledge of the reference result', 'Threshold fixed in advance'] },
      { id: 'd3', short: 'D3', label: 'Reference standard, risk of bias: how the target condition was established',
        signals: ['Likely to classify the condition correctly', 'Read without knowledge of the index result'] },
      { id: 'd4', short: 'D4', label: 'Flow and timing, risk of bias: interval, verification and analysis of all patients',
        signals: ['Suitable interval between tests', 'Same reference standard for everyone', 'All enrolled patients analysed'] },
      { id: 'a1', short: 'A1', label: 'Patient selection, applicability: patients and setting against the review question' },
      { id: 'a2', short: 'A2', label: 'Index test, applicability: test, conduct or reading against the review question' },
      { id: 'a3', short: 'A3', label: 'Reference standard, applicability: condition as defined against the review question' },
    ],
  },
  // AMSTAR 2 (Shea et al. 2017): 16 items for appraising a systematic review,
  // seven of them critical. Item wording is our own paraphrase (plan H6). The
  // overall confidence is not judged by hand: lib/umbrella.mjs derives it from
  // the items by the published rule. "Partial yes" exists only on items 2, 4,
  // 7, 8 and 9; "No meta-analysis" only on 11, 12 and 15.
  {
    id: 'amstar2',
    name: 'AMSTAR 2',
    design: 'Systematic reviews',
    judgements: ['Yes', 'Partial yes', 'No', 'No meta-analysis'],
    source: { url: 'https://amstar.ca/', note: 'Own paraphrase of the items; the questions are in the official tool' },
    overall: false,
    derived: true,
    domains: [
      ['1', 'Question and inclusion criteria cover the PICO components'],
      ['2', 'Methods set in a protocol before the review, deviations justified', 'partial', true],
      ['3', 'Choice of included study designs explained'],
      ['4', 'Literature search comprehensive', 'partial', true],
      ['5', 'Study selection done in duplicate'],
      ['6', 'Data extraction done in duplicate'],
      ['7', 'Excluded studies listed with reasons', 'partial', true],
      ['8', 'Included studies described in adequate detail', 'partial'],
      ['9', 'Risk of bias in included studies assessed with a suitable method', 'partial', true],
      ['10', 'Funding sources of included studies reported'],
      ['11', 'Statistical combination of results appropriate', 'ma', true],
      ['12', 'Effect of risk of bias on pooled results assessed', 'ma'],
      ['13', 'Risk of bias considered when interpreting results', '', true],
      ['14', 'Heterogeneity explained and discussed'],
      ['15', 'Publication bias investigated and its likely effect discussed', 'ma', true],
      ['16', 'Conflicts of interest and review funding reported'],
    ].map(([n, label, extra, critical]) => ({ id: `q${n}`, short: n, critical: Boolean(critical),
      label: critical ? `${label} (critical)` : label,
      judgements: ['Yes', ...(extra === 'partial' ? ['Partial yes'] : []), 'No', ...(extra === 'ma' ? ['No meta-analysis'] : [])] })),
  },
  // CASP qualitative studies checklist: ten questions, each answered Yes, No
  // or Can't tell, with no score. The topics are CASP's; the wording is our
  // own paraphrase (plan H6), not the published questions and hints.
  {
    id: 'casp-qual',
    name: 'CASP qualitative',
    design: 'Qualitative studies',
    judgements: ['Yes', 'No', "Can't tell"],
    source: { url: 'https://casp-uk.net/casp-tools-checklists/qualitative-studies-checklist/', note: 'Own paraphrase of the topics; the questions are in the official checklist' },
    overall: false,
    domains: [
      ['Aims', 'the purpose of the research and why it matters are stated'],
      ['Methodology', 'a qualitative approach suits what the study set out to learn'],
      ['Design', 'the chosen design fits the aims, and the choice is justified'],
      ['Recruitment', 'participants were selected in a way that serves the aims'],
      ['Data collection', 'data were gathered in a way that addresses the question'],
      ['Reflexivity', 'the researchers considered their own influence on the study'],
      ['Ethics', 'ethical issues were identified and handled'],
      ['Analysis', 'the analysis is described and sufficiently rigorous'],
      ['Findings', 'findings are stated clearly and discussed against the evidence'],
      ['Value', 'the study says what it adds to knowledge, practice or research'],
    ].map(([topic, text], i) => ({ id: `q${i + 1}`, short: `Q${i + 1}`, label: `${topic}: ${text}` })),
  },
  // Instruments whose terms do not let the app reproduce their items (plan H6,
  // docs/Related_Work_Review.md section 3): each holds the reviewer's own
  // judgement per domain, under the instrument's name, with a link to the
  // official tool and no question text. `judgementOnly` marks them.
  {
    id: 'rob-me',
    name: 'ROB-ME',
    design: 'Missing evidence in a synthesis',
    judgements: ['Low', 'Some concerns', 'High', 'No information'],
    overall: true,
    judgementOnly: true,
    source: { url: 'https://www.riskofbias.info/welcome/rob-me-tool', licence: 'CC BY-NC-ND 4.0', note: 'Judgement only; the signalling questions are in the official tool (Page et al. BMJ 2023;383:e076754)' },
    domains: [
      { id: 'd1', short: 'D1', label: 'Missing results within studies' },
      { id: 'd2', short: 'D2', label: 'Missing studies' },
    ],
  },
  {
    id: 'robins-e',
    name: 'ROBINS-E',
    design: 'Non-randomised studies of exposures',
    judgements: ['Low', 'Some concerns', 'High', 'Very high', 'No information'],
    overall: true,
    judgementOnly: true,
    source: { url: 'https://www.riskofbias.info/welcome/robins-e-tool', licence: 'CC BY-NC-ND 4.0', note: 'Judgement only; the signalling questions are in the official tool' },
    domains: [
      { id: 'd1', short: 'D1', label: 'Confounding' },
      { id: 'd2', short: 'D2', label: 'Measurement of the exposure' },
      { id: 'd3', short: 'D3', label: 'Selection of participants' },
      { id: 'd4', short: 'D4', label: 'Post-exposure interventions' },
      { id: 'd5', short: 'D5', label: 'Missing data' },
      { id: 'd6', short: 'D6', label: 'Measurement of the outcome' },
      { id: 'd7', short: 'D7', label: 'Selection of the reported result' },
    ],
  },
  {
    id: 'robis',
    name: 'ROBIS',
    design: 'Systematic reviews, risk of bias',
    judgements: ['Low', 'High', 'Unclear'],
    overall: true,
    judgementOnly: true,
    source: { url: 'https://www.bristol.ac.uk/population-health-sciences/projects/robis/robis-tool/', note: 'Judgement only; no reuse terms stated, so no question text' },
    domains: [
      { id: 'd1', short: 'D1', label: 'Study eligibility criteria' },
      { id: 'd2', short: 'D2', label: 'Identification and selection of studies' },
      { id: 'd3', short: 'D3', label: 'Data collection and study appraisal' },
      { id: 'd4', short: 'D4', label: 'Synthesis and findings' },
    ],
  },
  {
    id: 'probast',
    name: 'PROBAST',
    design: 'Prediction model studies',
    judgements: ['Low', 'High', 'Unclear'],
    overall: true,
    judgementOnly: true,
    source: { url: 'https://www.probast.org/', note: 'Judgement only; no reuse terms stated, so no question text' },
    domains: [
      { id: 'd1', short: 'D1', label: 'Participants' },
      { id: 'd2', short: 'D2', label: 'Predictors' },
      { id: 'd3', short: 'D3', label: 'Outcome' },
      { id: 'd4', short: 'D4', label: 'Analysis' },
    ],
  },
  // Newcastle–Ottawa, MINORS, RoB 1, MMAT, QUIPS, JBI and AGREE II (lib/appraisal-extra.mjs).
  ...EXTRA_TOOLS,
];

// Instruments the review team defines (lib/custom-instrument.mjs) live in
// the project, as s.customInstruments. Readers that are handed the state pass
// it; the rest see the open project through the getter the store registers,
// so every tool list and lookup includes them. An invalid definition, or one
// whose id a shipped instrument holds, is left out rather than thrown.
let toolState = () => null;
/** The store registers how to read the open project (store.mjs). */
export const useToolState = fn => { toolState = typeof fn === 'function' ? fn : () => null; };
const customCache = new WeakMap();   // list -> { refs, tools }
/** The project's own instruments in the APPRAISAL_TOOLS shape. */
export function customTools(s) {
  const st = s && typeof s === 'object' ? s : toolState();
  const list = st?.customInstruments;
  if (!Array.isArray(list) || !list.length) return [];
  const hit = customCache.get(list);
  if (hit && hit.refs.length === list.length && hit.refs.every((x, i) => x === list[i])) return hit.tools;
  const tools = [];
  for (const inst of list) {
    let t; try { t = toTool(inst); } catch { continue; }
    if (!APPRAISAL_TOOLS.some(x => x.id === t.id) && !tools.some(x => x.id === t.id)) tools.push(t);
  }
  customCache.set(list, { refs: [...list], tools });
  return tools;
}
/** Every instrument the project can appraise with: the shipped ones, then its own. */
export const allTools = s => { const c = customTools(s); return c.length ? [...APPRAISAL_TOOLS, ...c] : APPRAISAL_TOOLS; };
/** An instrument by id, the project's own included; RoB 2 when none matches. */
export const appraisalTool = (id, s) => APPRAISAL_TOOLS.find(t => t.id === id) || customTools(s).find(t => t.id === id) || APPRAISAL_TOOLS[0];

// Judgement colours are the instruments' own convention: green favourable,
// red unfavourable, amber uncertain, grey absent.
export const JUDGEMENT_TONE = {
  'Low': 'good', 'Yes': 'good',
  'Some concerns': 'unclear', 'Moderate': 'unclear', 'Unclear': 'unclear',
  'High': 'bad', 'Very high': 'bad', 'Serious': 'bad', 'Critical': 'bad', 'No': 'bad',
  'No information': 'none', 'Not applicable': 'none', 'Not assessed': 'none',
  'Low (except for concerns about uncontrolled confounding)': 'good',
  'Partial yes': 'unclear', 'No meta-analysis': 'none',
  ...EXTRA_JUDGEMENT_TONE,
  "Can't tell": 'unclear',
};

// Grouped by the phase each count belongs to, so the form reads in the same
// order as the diagram it produces.
// PRISMA 2020 has three optional arms. Every field the flow diagram can draw is
// declared here; `arm` decides which of them a given review shows, so a review
// that did no citation searching never sees those rows (plan K1).
export const PRISMA_GROUPS = [
  { phase: 'Identification', fields: [
    { id: 'database_results', label: 'Records identified from databases' },
    { id: 'database_specific_results', label: 'Records per database', text: true, reasonLabel: 'Database' },
    { id: 'register_results', label: 'Records identified from registers' },
    { id: 'register_specific_results', label: 'Records per register', text: true, reasonLabel: 'Register' },
    { id: 'duplicates',       label: 'Duplicate records removed' },
    { id: 'excluded_automatic', label: 'Records marked ineligible by automation' },
    { id: 'excluded_other',   label: 'Records removed for other reasons' },
  ]},
  { phase: 'Screening', fields: [
    { id: 'records_screened', label: 'Records screened' },
    { id: 'records_excluded', label: 'Records excluded' },
    { id: 'dbr_sought_reports', label: 'Reports sought for retrieval' },
    { id: 'dbr_notretrieved_reports', label: 'Reports not retrieved' },
    { id: 'dbr_assessed',     label: 'Reports assessed for eligibility' },
    { id: 'dbr_excluded',     label: 'Reports excluded, with reasons', text: true },
  ]},
  { phase: 'Other methods', arm: 'other', fields: [
    { id: 'website_results',      label: 'Records identified from websites' },
    { id: 'organisation_results', label: 'Records identified from organisations' },
    { id: 'citations_results',    label: 'Records identified by citation searching' },
    { id: 'other_sought_reports', label: 'Reports sought for retrieval' },
    { id: 'other_notretrieved_reports', label: 'Reports not retrieved' },
    { id: 'other_assessed',       label: 'Reports assessed for eligibility' },
    { id: 'other_excluded',       label: 'Reports excluded, with reasons', text: true },
  ]},
  { phase: 'Included', fields: [
    { id: 'new_studies',      label: 'Studies included in review' },
    { id: 'new_reports',      label: 'Reports of included studies' },
  ]},
  { phase: 'Previous version', arm: 'previous', fields: [
    { id: 'previous_studies', label: 'Studies included in previous version' },
    { id: 'previous_reports', label: 'Reports of studies in previous version' },
    { id: 'total_studies',    label: 'Total studies included in review' },
    { id: 'total_reports',    label: 'Reports of total included studies' },
  ]},
];

/**
 * The PRISMA counts the flow diagram asks for: the branches it draws (an arm only when switched on), the optional counts only when given, and
 * the other-methods sources as one count met by any of them. Readiness and Needs attention both count these (lib/overview-facts.mjs, lib/progress.mjs).
 */
const OPTIONAL_PRISMA = new Set(['register_results', 'register_specific_results', 'excluded_automatic', 'excluded_other']);
const OTHER_SOURCES = new Set(['website_results', 'organisation_results', 'citations_results']);
export function prismaNeeded(s) {
  const arms = s.prismaArms || {}, filled = f => s.prisma?.[f.id] != null && s.prisma[f.id] !== '';
  const fields = PRISMA_GROUPS.filter(g => !g.arm || arms[g.arm]).flatMap(g => g.fields).filter(f => !OPTIONAL_PRISMA.has(f.id) || filled(f));
  const own = fields.filter(f => !OTHER_SOURCES.has(f.id)), other = fields.filter(f => OTHER_SOURCES.has(f.id));
  const otherMet = other.length ? (other.some(filled) ? 1 : 0) : 0;
  return { filled: own.filter(filled).length + otherMet, total: own.length + (other.length ? 1 : 0) };
}
/** The counts of prismaNeeded still blank, as fields (the other-methods sources as their first, Records identified from websites). */
export function prismaBlank(s) {
  const arms = s.prismaArms || {}, filled = f => s.prisma?.[f.id] != null && s.prisma[f.id] !== '';
  const fields = PRISMA_GROUPS.filter(g => !g.arm || arms[g.arm]).flatMap(g => g.fields).filter(f => !OPTIONAL_PRISMA.has(f.id) || filled(f));
  const other = fields.filter(f => OTHER_SOURCES.has(f.id));
  return [...fields.filter(f => !OTHER_SOURCES.has(f.id) && !filled(f)), ...(other.length && !other.some(filled) ? [other[0]] : [])];
}

export const PRISMA_FIELDS = PRISMA_GROUPS.flatMap(g => g.fields);

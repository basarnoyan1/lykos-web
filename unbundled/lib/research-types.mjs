// The research types, in one place (research types amendment of 2026-09-29).
// Each entry says everything a type needs: its label and blurb for the start
// screen and setup, the workflow mode, the kind (a review of studies, a
// patient study, a primary study of the researcher's own, or a guideline),
// the views it shows, the stage folders of its project, the frame of its
// question in the protocol, the reporting checklist it is written against,
// and what of the project vouches for that checklist's items. Everything
// else reads from here; adding a type is adding an entry.
//
// Two flags say what modules once listed by name (plan W7): `pools`, its
// outcomes are pooled, so it synthesises without meta-analysis only when a
// project has a SWiM domain (lib/outcome-links.mjs); `registers`, its
// reporting guideline asks where the protocol was registered, so a
// submission needs the statement (lib/submission-checks.mjs).
//
// Pure data: nothing here imports the store or a view.

const REVIEW_LAYOUT = ['protocol', 'search', 'screening', 'papers', 'data', 'rob', 'analysis', 'manuscript', 'supplement'];
const PRIMARY_LAYOUT = ['protocol', 'literature', 'data', 'analysis', 'manuscript', 'supplement'];

// Question frames; the stored keys stay the same across types, so a project
// that changes type keeps what was written (views/protocol.mjs).
const PICO = [
  { id: 'population', label: 'Population' }, { id: 'intervention', label: 'Intervention' },
  { id: 'comparator', label: 'Comparator' }, { id: 'outcome', label: 'Primary outcome' }, { id: 'design', label: 'Eligible designs' },
];
const frame = (...rows) => rows.map(([id, label]) => ({ id, label }));
const PRIMARY_VIEWS = ['overview', 'protocol', 'search', 'library', 'datasets', 'analysis', 'advancedAnalysis', 'manuscript', 'outputs', 'reporting', 'notes', 'notifications'];
// A study with free-text data codes it in the coding workspace (views/coding.mjs), beside its datasets.
const CODING_VIEWS = PRIMARY_VIEWS.flatMap(k => (k === 'datasets' ? ['datasets', 'coding'] : [k]));

export const RESEARCH_TYPES = [
  // ---- reviews of evidence -------------------------------------------------
  { id: 'systematic-review', label: 'Systematic review', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic',
    short: 'Find, screen and synthesise studies', blurb: 'Find, screen and synthesise published evidence', layout: REVIEW_LAYOUT, checklist: 'prisma-2020' },
  { id: 'meta-analysis', brief: 'Meta-analysis', label: 'Systematic review with meta-analysis', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic',
    short: 'Pool study results statistically', blurb: 'Find, screen and pool published evidence statistically', layout: REVIEW_LAYOUT, checklist: 'prisma-2020' },
  { id: 'rapid-review', label: 'Rapid review', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic',
    short: 'A systematic review with stated shortcuts', blurb: 'A systematic review completed with stated shortcuts (fewer sources, single screening), reported against PRISMA 2020', layout: REVIEW_LAYOUT, checklist: 'prisma-2020' },
  { id: 'scoping-review', label: 'Scoping review', kind: 'review', group: 'Reviews of evidence', mode: 'scoping',
    short: 'Map and chart the evidence', blurb: 'Map the literature and chart available evidence', layout: ['protocol', 'search', 'screening', 'papers', 'charting', 'manuscript', 'supplement'], checklist: 'prisma-scr',
    question: frame(['population', 'Population'], ['intervention', 'Concept'], ['comparator', 'Context'], ['design', 'Evidence sources']) },
  { id: 'umbrella-review', label: 'Umbrella review', kind: 'review', pools: true, group: 'Reviews of evidence', mode: 'systematic', appraisal: 'amstar2',
    short: 'Appraise and compare reviews', blurb: 'Appraise systematic reviews, their overlap and the credibility of their findings', layout: REVIEW_LAYOUT, checklist: 'prior' },
  { id: 'qualitative-review', brief: 'Qualitative synthesis', label: 'Qualitative evidence synthesis', kind: 'review', group: 'Reviews of evidence', mode: 'systematic', appraisal: 'casp-qual',
    short: 'Code and theme qualitative findings', blurb: 'Code, theme and interpret findings from qualitative studies',
    layout: ['protocol', 'search', 'screening', 'papers', 'data', 'synthesis', 'manuscript', 'supplement'], checklist: 'entreq',
    // SPIDER (Cooke et al. 2012); research type has its own key, as PICO has nothing it would overwrite
    question: frame(['population', 'Sample'], ['intervention', 'Phenomenon of interest'], ['design', 'Design'], ['outcome', 'Evaluation'], ['research', 'Research type']) },
  { id: 'dta-review', brief: 'DTA review', label: 'Diagnostic test accuracy review', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic', appraisal: 'quadas-2',
    short: 'Pool test sensitivity and specificity', blurb: 'Pool sensitivity and specificity of a test against a reference standard', layout: REVIEW_LAYOUT, checklist: 'prisma-dta' },
  { id: 'nma-review', label: 'Network meta-analysis', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic',
    short: 'Compare several treatments at once', blurb: 'Compare several treatments at once from direct and indirect evidence', layout: REVIEW_LAYOUT, checklist: 'prisma-nma' },

  // Studies of studies (plan W7): trials or reviews sampled from the literature are the unit. The usual analysis compares trials with and
  // without a characteristic as a ratio of odds ratios, in two steps (lib/ror.mjs, the `ror` analysis of a dataset). No reporting
  // guideline is final (MISTIC is in development), so PRISMA 2020 is its checklist.
  { id: 'meta-research', brief: 'Meta-research', label: 'Meta-research study', kind: 'review', pools: true, registers: true, group: 'Reviews of evidence', mode: 'systematic',
    short: 'Studies as the unit: methods, bias, reporting', blurb: 'Study how research is done and reported, or how a trial characteristic changes its results, with studies as the unit',
    layout: REVIEW_LAYOUT, checklist: 'prisma-2020', questionLabel: 'Research question',
    question: frame(['population', 'Studies sampled'], ['intervention', 'Study characteristic'], ['comparator', 'Comparison'], ['outcome', 'Outcome or effect measure'], ['design', 'Sampling frame and sources']) },

  // ---- studies of the researcher's own ------------------------------------
  { id: 'rct', brief: 'Randomised trial', label: 'Randomised controlled trial', kind: 'primary', registers: true, group: 'Primary studies', mode: 'workspace', patientData: true,
    short: 'Design, run and report a trial', blurb: 'Plan a trial, size it, allocate participants, keep the data and report against CONSORT',
    layout: PRIMARY_LAYOUT, checklist: 'consort-2025', views: PRIMARY_VIEWS.flatMap(k => k === 'datasets' ? [k, 'trialOperations'] : [k]), questionLabel: 'Trial question',
    question: frame(['population', 'Population'], ['intervention', 'Intervention'], ['comparator', 'Comparator'], ['outcome', 'Primary and secondary outcomes'], ['design', 'Trial design and allocation']),
    vouch: { question: ['2b'], criteria: ['4a'], versions: ['24'], registration: ['23'], datasets: ['15'], analysis: ['12a'], sampleSize: ['7a'] } },
  { id: 'cohort-study', label: 'Observational study', kind: 'primary', group: 'Primary studies', mode: 'workspace', patientData: true,
    short: 'Cohort, case-control or cross-sectional', blurb: 'A cohort, case-control or cross-sectional study of your own data, reported against STROBE',
    layout: PRIMARY_LAYOUT, checklist: 'strobe', views: PRIMARY_VIEWS, questionLabel: 'Study question',
    question: frame(['population', 'Population'], ['intervention', 'Exposure'], ['comparator', 'Comparator'], ['outcome', 'Outcomes'], ['design', 'Design and setting']),
    vouch: { question: ['3'], criteria: ['6a'], datasets: ['14a'], analysis: ['12a'], sampleSize: ['10'] } },
  { id: 'diagnostic-study', brief: 'Diagnostic accuracy', label: 'Diagnostic accuracy study', kind: 'primary', registers: true, group: 'Primary studies', mode: 'workspace', patientData: true,
    short: 'An index test against a reference standard', blurb: 'Measure the accuracy of an index test against a reference standard in your own patients, reported against STARD',
    layout: PRIMARY_LAYOUT, checklist: 'stard', views: PRIMARY_VIEWS, questionLabel: 'Study question',
    question: frame(['population', 'Population'], ['intervention', 'Index test'], ['comparator', 'Reference standard'], ['outcome', 'Target condition'], ['design', 'Design and sampling']),
    vouch: { question: ['4'], criteria: ['6'], versions: ['29'], registration: ['28'], datasets: ['20'], analysis: ['14'], sampleSize: ['18'] } },
  { id: 'prognostic-model', label: 'Prediction model study', kind: 'primary', group: 'Primary studies', mode: 'workspace', patientData: true,
    short: 'Develop or validate a risk model', blurb: 'Develop, validate or update a multivariable prediction model, reported against TRIPOD',
    layout: PRIMARY_LAYOUT, checklist: 'tripod-ai', views: PRIMARY_VIEWS, questionLabel: 'Study question',
    question: frame(['population', 'Population and setting'], ['intervention', 'Predictors'], ['outcome', 'Outcome predicted'], ['comparator', 'Existing models'], ['design', 'Development or validation']),
    vouch: { question: ['3b'], criteria: ['5b'], versions: ['21'], datasets: ['13b'], analysis: ['10b'], sampleSize: ['8'] } },
  { id: 'survey-study', label: 'Survey study', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'A questionnaire study', blurb: 'A questionnaire given to a defined population, its responses as a dataset, reported against CROSS',
    layout: PRIMARY_LAYOUT, checklist: 'cross', views: CODING_VIEWS, questionLabel: 'Survey aim',
    question: frame(['population', 'Target population'], ['intervention', 'Instrument'], ['outcome', 'Measures'], ['comparator', 'Comparison groups'], ['design', 'Design and administration']),
    vouch: { question: ['3'], criteria: ['6d'], datasets: ['11'], analysis: ['9a'], sampleSize: ['6c'] } },
  { id: 'qualitative-study', label: 'Qualitative study', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'Interviews, focus groups, observation', blurb: 'Interviews, focus groups or observation, analysed for themes and reported against SRQR',
    layout: PRIMARY_LAYOUT, checklist: 'srqr', views: CODING_VIEWS, questionLabel: 'Research question',
    question: frame(['population', 'Sample'], ['intervention', 'Phenomenon of interest'], ['design', 'Approach and design'], ['outcome', 'Evaluation'], ['research', 'Setting']),
    vouch: { question: ['S4'], criteria: ['S8'], datasets: ['S12'], analysis: ['S14'], corpus: ['S12'], pseudonymised: ['S13'], coding: ['S14'], coders: ['S15'], exemplars: ['S17'] } },
  { id: 'qi-project', brief: 'Quality improvement', label: 'Quality improvement project', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'Change a process and measure it', blurb: 'An intervention to improve care in one setting, with measures over time, reported against SQUIRE',
    layout: PRIMARY_LAYOUT, checklist: 'squire', views: PRIMARY_VIEWS, questionLabel: 'Aim',
    question: frame(['population', 'Setting and population'], ['intervention', 'Intervention (the change)'], ['comparator', 'Baseline'], ['outcome', 'Measures'], ['design', 'Improvement method']),
    vouch: { question: ['6'], criteria: ['7'], datasets: ['13b'], analysis: ['11'] } },
  { id: 'economic-evaluation', label: 'Economic evaluation', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'Costs and outcomes compared', blurb: 'Compare the costs and outcomes of alternatives, from a trial or a model, reported against CHEERS',
    layout: PRIMARY_LAYOUT, checklist: 'cheers', views: PRIMARY_VIEWS, questionLabel: 'Decision question',
    question: frame(['population', 'Population'], ['intervention', 'Intervention'], ['comparator', 'Comparators'], ['outcome', 'Outcomes and costs'], ['design', 'Perspective and horizon']),
    vouch: { question: ['3'], criteria: ['5'], versions: ['4'], datasets: ['22'], analysis: ['17'] } },
  { id: 'animal-study', label: 'Preclinical animal study', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'An experiment in animals', blurb: 'A controlled experiment in animals, its groups, allocation and analysis, reported against ARRIVE 2.0',
    layout: PRIMARY_LAYOUT, checklist: 'arrive', views: PRIMARY_VIEWS, questionLabel: 'Research question',
    question: frame(['population', 'Species, strain and sex'], ['intervention', 'Intervention'], ['comparator', 'Control'], ['outcome', 'Outcome measures'], ['design', 'Experimental unit and design']),
    vouch: { question: ['13'], criteria: ['3a'], versions: ['19'], datasets: ['10a'], analysis: ['7a'], sampleSize: ['2b'] } },
  // Cadaveric dissection, morphometry and anatomical imaging (plan W7): measurements in a dataset, with the
  // agreement and paired analyses Datasets already has; AQUA item numbers in the vouch map
  { id: 'anatomical-study', brief: 'Anatomical study', label: 'Anatomical or cadaveric study', kind: 'primary', group: 'Primary studies', mode: 'workspace',
    short: 'Dissection, morphometry or anatomical imaging', blurb: 'Measure anatomy in cadavers, in images or during surgery, reported against the AQUA checklist',
    layout: PRIMARY_LAYOUT, checklist: 'aqua', views: PRIMARY_VIEWS, questionLabel: 'Research question',
    question: frame(['population', 'Specimens or subjects'], ['intervention', 'Structure or region'], ['outcome', 'Measurements'], ['comparator', 'Comparisons'], ['design', 'Method and setting']),
    vouch: { question: ['4'], criteria: ['8'], datasets: ['17'], analysis: ['15'], sampleSize: ['7'] } },

  // ---- patient studies ----------------------------------------------------
  // A series of one's own patients, reported against PROCESS 2023 (plan W7, review problem 4); a pooled review of published
  // cases chooses PRISMA 2020 with PRISMA-IPD instead (lib/checklist-choice.mjs). PROCESS item numbers in the vouch map.
  { id: 'case-series', label: 'Case series', kind: 'patients', group: 'Patient studies', mode: 'workspace', patientData: true, appraisal: 'jbi-case-series',
    short: 'Patient data, observations, outcomes', blurb: 'A series of your own patients, their data and outcomes, reported against PROCESS', layout: ['protocol', 'patients', 'literature', 'analysis', 'manuscript', 'supplement'], checklist: 'process',
    questionLabel: 'Study objective',
    question: frame(['population', 'Population'], ['intervention', 'Intervention or exposure'], ['outcome', 'Outcomes'], ['design', 'Setting and period']),
    vouch: { question: ['5'], criteria: ['6e'], registration: ['6a'], datasets: ['7a'], analysis: ['7c'] } },
  { id: 'case-report', label: 'Case report', kind: 'patients', group: 'Patient studies', mode: 'workspace',
    short: 'One patient, reported against CARE', blurb: "Describe one patient's presentation, diagnosis, treatment and outcome", layout: ['case', 'images', 'literature', 'manuscript'], checklist: 'care',
    questionLabel: 'Case focus' },

  // ---- guidance and everything else ---------------------------------------
  { id: 'guideline', brief: 'Practice guideline', label: 'Clinical practice guideline', kind: 'primary', group: 'Guidance', mode: 'workspace',
    short: 'Recommendations from the evidence', blurb: 'Questions, the evidence behind each, and graded recommendations, reported against RIGHT',
    layout: PRIMARY_LAYOUT, checklist: 'right', views: PRIMARY_VIEWS, questionLabel: 'Scope',
    question: frame(['population', 'Target population'], ['intervention', 'Interventions covered'], ['comparator', 'Alternatives'], ['outcome', 'Outcomes that matter'], ['design', 'Users and settings']),
    vouch: { question: ['6'], criteria: ['10a'], versions: ['20'], analysis: ['12'] } },
  // A panel rates statements over rounds (plan W7): each round a dataset, panelists as rows and statements as
  // columns, read by the consensus analysis (lib/consensus.mjs); ACCORD item numbers in the vouch map
  { id: 'consensus-study', brief: 'Consensus study', label: 'Delphi or consensus study', kind: 'primary', group: 'Guidance', mode: 'workspace',
    short: 'Delphi rounds or a consensus panel', blurb: 'A panel rates statements over rounds until it agrees, reported against ACCORD',
    layout: PRIMARY_LAYOUT, checklist: 'accord', views: PRIMARY_VIEWS, questionLabel: 'Aim',
    question: frame(['population', 'Panel'], ['intervention', 'Statements or topics'], ['comparator', 'Rating scale'], ['outcome', 'Definition of consensus'], ['design', 'Method and rounds']),
    vouch: { question: ['I2'], criteria: ['M3'], registration: ['M1'], versions: ['R2'], datasets: ['R3'], analysis: ['M15'] } },
  { id: 'other', brief: 'Literature workspace', label: 'Other / literature workspace', kind: 'other', group: 'Other', mode: 'workspace',
    short: 'Literature and writing', blurb: 'A flexible workspace for literature and writing', layout: ['literature', 'data', 'manuscript'], checklist: 'prisma-2020' },
];

/** The types a new project offers first (the researcher's own: reviews and case reports); the rest are one disclosure away (A21). */
export const DEFAULT_TYPES = ['systematic-review', 'meta-analysis', 'scoping-review', 'case-series', 'case-report'];
export const typeById = id => RESEARCH_TYPES.find(t => t.id === id) || null;
/** The start screen's groups, in registry order. */
export const TYPE_GROUPS = [...new Set(RESEARCH_TYPES.map(t => t.group))].map(g => [g, RESEARCH_TYPES.filter(t => t.group === g).map(t => t.id)]);
export const isPrimaryType = t => (typeof t === 'string' ? typeById(t) : t)?.kind === 'primary';
export const isReviewType = t => (typeof t === 'string' ? typeById(t) : t)?.kind === 'review';
export const questionFrameOf = t => (typeof t === 'string' ? typeById(t) : t)?.question || PICO;
export const questionLabelOf = t => (typeof t === 'string' ? typeById(t) : t)?.questionLabel || 'Research question';
export const layoutOf = id => typeById(id)?.layout || typeById('other').layout;

/** The type's name where a line is short (the title bar's status: 24 characters at most): its brief name, else its label. */
export const typeBrief = type => type?.brief || type?.label || '';

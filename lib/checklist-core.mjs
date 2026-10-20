// The reporting checklists, which one a project is held to and its item states: what the Overview's readiness score reads
// (lib/overview-facts.mjs), without the analysis modules lib/checklist.mjs reaches for `supported` (lib/progress-gate.mjs loads those on use).
import { researchType } from './workflow.mjs';
import { LSR_ITEMS } from './living.mjs';
import { PRIMARY_CHECKLISTS } from './checklists-primary.mjs';
import { EXTRA_CHECKLISTS } from './checklists-extra.mjs';
import { applied, composeChecklist } from './checklist-choice.mjs';
import { RESEARCH_TYPES } from './research-types.mjs';
// PRISMA 2020 checklist (plan K2): the 27 items, each with a state and where
// in the manuscript it is reported. Item titles from the PRISMA 2020
// statement (Page et al. 2021, CC BY 4.0). A search log can support an item;
// only a person can say the manuscript reports it.
export const PRISMA_2020 = [
  ['1', 'Title', 'Identify the report as a systematic review'],
  ['2', 'Abstract', 'See the PRISMA 2020 for Abstracts checklist'],
  ['3', 'Rationale', 'Describe the rationale for the review in the context of existing knowledge'],
  ['4', 'Objectives', 'Provide an explicit statement of the objective(s) or question(s) the review addresses'],
  ['5', 'Eligibility criteria', 'Specify the inclusion and exclusion criteria and how studies were grouped for the syntheses'],
  ['6', 'Information sources', 'Specify all databases, registers, websites, organisations, reference lists and other sources searched or consulted, with the date each was last searched'],
  ['7', 'Search strategy', 'Present the full search strategies for all databases, registers and websites, including any filters and limits used'],
  ['8', 'Selection process', 'Specify the methods used to decide whether a study met the inclusion criteria, including how many reviewers screened each record and whether they worked independently'],
  ['9', 'Data collection process', 'Specify the methods used to collect data from reports, including how many reviewers collected data and whether they worked independently'],
  ['10a', 'Data items: outcomes', 'List and define all outcomes for which data were sought'],
  ['10b', 'Data items: other variables', 'List and define all other variables for which data were sought'],
  ['11', 'Study risk of bias assessment', 'Specify the methods used to assess risk of bias in the included studies'],
  ['12', 'Effect measures', 'Specify for each outcome the effect measure(s) used in the synthesis or presentation of results'],
  ['13a', 'Synthesis: eligibility', 'Describe the processes used to decide which studies were eligible for each synthesis'],
  ['13b', 'Synthesis: data preparation', 'Describe any methods required to prepare the data for presentation or synthesis'],
  ['13c', 'Synthesis: tabulation', 'Describe any methods used to tabulate or visually display results of individual studies and syntheses'],
  ['13d', 'Synthesis: methods', 'Describe any methods used to synthesise results and provide a rationale for the choice(s)'],
  ['13e', 'Synthesis: heterogeneity', 'Describe any methods used to explore possible causes of heterogeneity among study results'],
  ['13f', 'Synthesis: sensitivity', 'Describe any sensitivity analyses conducted to assess robustness of the synthesised results'],
  ['14', 'Reporting bias assessment', 'Describe any methods used to assess risk of bias due to missing results in a synthesis'],
  ['15', 'Certainty assessment', 'Describe any methods used to assess certainty (or confidence) in the body of evidence for an outcome'],
  ['16a', 'Study selection: flow', 'Describe the results of the search and selection process, ideally using a flow diagram'],
  ['16b', 'Study selection: excluded', 'Cite studies that might appear to meet the inclusion criteria but were excluded, and explain why'],
  ['17', 'Study characteristics', 'Cite each included study and present its characteristics'],
  ['18', 'Risk of bias in studies', 'Present assessments of risk of bias for each included study'],
  ['19', 'Results of individual studies', 'For all outcomes, present for each study the summary statistics and an effect estimate with its precision'],
  ['20a', 'Results of syntheses: characteristics', 'For each synthesis, briefly summarise the characteristics and risk of bias among contributing studies'],
  ['20b', 'Results of syntheses: results', 'Present results of all statistical syntheses conducted'],
  ['20c', 'Results of syntheses: heterogeneity', 'Present results of all investigations of possible causes of heterogeneity among study results'],
  ['20d', 'Results of syntheses: sensitivity', 'Present results of all sensitivity analyses conducted'],
  ['21', 'Reporting biases', 'Present assessments of risk of bias due to missing results for each synthesis assessed'],
  ['22', 'Certainty of evidence', 'Present assessments of certainty in the body of evidence for each outcome assessed'],
  ['23a', 'Discussion: interpretation', 'Provide a general interpretation of the results in the context of other evidence'],
  ['23b', 'Discussion: limitations of evidence', 'Discuss any limitations of the evidence included in the review'],
  ['23c', 'Discussion: limitations of process', 'Discuss any limitations of the review processes used'],
  ['23d', 'Discussion: implications', 'Discuss implications of the results for practice, policy, and future research'],
  ['24a', 'Registration', 'Provide registration information for the review, or state that the review was not registered'],
  ['24b', 'Protocol', 'Indicate where the review protocol can be accessed, or state that a protocol was not prepared'],
  ['24c', 'Amendments', 'Describe and explain any amendments to information provided at registration or in the protocol'],
  ['25', 'Support', 'Describe sources of financial or non-financial support for the review, and the role of the funders'],
  ['26', 'Competing interests', 'Declare any competing interests of review authors'],
  ['27', 'Availability of data', 'Report which of the following are publicly available and where: data collection forms, extracted data, analytic code, other materials'],
];
// PRISMA-ScR (Tricco et al. 2018): 20 essential items and 2 optional ones.
// Item names follow the extension; descriptions are summarised here.
export const PRISMA_SCR = [
  ['1', 'Title', 'Identify the report as a scoping review'],
  ['2', 'Structured summary', 'Summarise background, objectives, eligibility criteria, sources of evidence, charting methods, results and conclusions'],
  ['3', 'Rationale', 'Describe the rationale in the context of what is already known, and why a scoping review suits the questions'],
  ['4', 'Objectives', 'State the questions and objectives, with their key elements (population or participants, concepts, context)'],
  ['5', 'Protocol and registration', 'Say whether a protocol exists and where it can be accessed, with registration information if available'],
  ['6', 'Eligibility criteria', 'Specify the characteristics of sources of evidence used as eligibility criteria, with a rationale'],
  ['7', 'Information sources', 'Describe all information sources searched, with the date each was last searched'],
  ['8', 'Search', 'Present the full electronic search strategy for at least one database, including any limits used'],
  ['9', 'Selection of sources of evidence', 'State the process for selecting sources of evidence, i.e. screening and eligibility'],
  ['10', 'Data charting process', 'Describe how data were charted: the forms used, whether calibrated, and whether charted independently or in duplicate'],
  ['11', 'Data items', 'List and define all variables for which data were sought, and any assumptions made'],
  ['12', 'Critical appraisal of individual sources of evidence (optional)', 'If done, give the rationale, and describe the methods and how the information was used'],
  ['13', 'Synthesis of results', 'Describe the methods of handling and summarising the charted data'],
  ['14', 'Selection of sources of evidence', 'Give the numbers screened, assessed for eligibility and included, with reasons for exclusion at each stage, ideally in a flow diagram'],
  ['15', 'Characteristics of sources of evidence', 'For each source of evidence, present the characteristics for which data were charted, with citations'],
  ['16', 'Critical appraisal within sources of evidence (optional)', 'If done, present data on the critical appraisal of included sources of evidence'],
  ['17', 'Results of individual sources of evidence', 'For each included source, present the charted data relevant to the questions and objectives'],
  ['18', 'Synthesis of results', 'Summarise or present the charting results as they relate to the questions and objectives'],
  ['19', 'Summary of evidence', 'Summarise the main results, how they relate to the objectives, and their relevance to key groups'],
  ['20', 'Limitations', 'Discuss the limitations of the scoping review process'],
  ['21', 'Conclusions', 'Give a general interpretation of the results with respect to the questions and objectives, and potential implications and next steps'],
  ['22', 'Funding', 'Describe sources of funding for the included sources of evidence and for the scoping review, and the role of the funders'],
];

// PRISMA-DTA (McInnes et al. 2018): 27 items. Items 15 and 22 of PRISMA 2009
// are not part of it; D1 and D2 are its own. Item names follow the extension;
// descriptions are summarised here in our own words.
export const PRISMA_DTA = [
  ['1', 'Title', 'Identify the report as a systematic review, with or without meta-analysis, of diagnostic test accuracy studies'],
  ['2', 'Abstract', 'See the PRISMA-DTA for Abstracts checklist'],
  ['3', 'Rationale', 'Describe the rationale for the review in the context of what is already known'],
  ['D1', 'Clinical role of index test', 'State the clinical background, the intended use and role of the index test, and any minimally acceptable accuracy'],
  ['4', 'Objectives', 'State the question addressed, with the participants, index test(s) and target condition(s)'],
  ['5', 'Protocol and registration', 'Say whether a protocol exists and where it can be accessed, with registration information if available'],
  ['6', 'Eligibility criteria', 'Specify the study characteristics and report characteristics used as criteria for eligibility, with a rationale'],
  ['7', 'Information sources', 'Describe all information sources searched, with the date each was last searched'],
  ['8', 'Search', 'Present the full search strategy for at least one database, including any limits, so it can be repeated'],
  ['9', 'Study selection', 'State the process for selecting studies: screening, eligibility and inclusion'],
  ['10', 'Data collection process', 'Describe how data were extracted from reports, including any independent or duplicate extraction'],
  ['11', 'Definitions for data extraction', 'Define the target condition, index test(s), reference standard(s) and other characteristics as extracted'],
  ['12', 'Risk of bias and applicability', 'Describe the methods for assessing risk of bias and concerns about applicability in individual studies'],
  ['13', 'Diagnostic accuracy measures', 'State the principal accuracy measures (e.g. sensitivity, specificity) and the unit of assessment'],
  ['14', 'Synthesis of results', 'Describe how data were handled and combined, and how variability between studies was described'],
  ['D2', 'Meta-analysis', 'Report the statistical methods used for any meta-analysis'],
  ['16', 'Additional analyses', 'Describe any additional analyses, such as sensitivity analyses, subgroups or meta-regression, and whether pre-specified'],
  ['17', 'Study selection', 'Give the numbers screened, assessed and included, with reasons for exclusion, ideally in a flow diagram'],
  ['18', 'Study characteristics', 'For each included study, present its characteristics, with citations'],
  ['19', 'Risk of bias and applicability', 'Present the risk of bias and applicability judgements for each study'],
  ['20', 'Results of individual studies', 'For each study, report the 2×2 counts and accuracy estimates with confidence intervals, ideally with a forest or ROC plot'],
  ['21', 'Synthesis of results', 'Describe test accuracy and its variability; for a meta-analysis, give results with confidence intervals'],
  ['23', 'Additional analysis', 'Give the results of any additional analyses'],
  ['24', 'Summary', 'Summarise the main findings, including the strength of the evidence'],
  ['25', 'Limitations', 'Discuss limitations from the included studies and from the review process'],
  ['26', 'Conclusions', 'Interpret the results in the context of other evidence, with implications for practice and future research'],
  ['27', 'Funding', 'Describe sources of funding and other support, and the role of the funders'],
];

// PRIOR (Gates et al. 2022), for overviews of reviews: 27 items, several with
// sub-items. Item names follow the statement; descriptions are summarised
// here in our own words.
export const PRIOR = [
  ['1', 'Title', 'Identify the report as an overview of reviews'],
  ['2', 'Abstract', 'Summarise the purpose, methods and results of the overview accurately and in full'],
  ['3', 'Rationale', 'Explain why the overview was done, given what is already known'],
  ['4', 'Objectives', 'State the objectives or questions the overview addresses'],
  ['5a', 'Eligibility criteria', 'Give the inclusion and exclusion criteria, and say whether supplemental primary studies were included and why'],
  ['5b', 'Eligibility criteria: systematic review', "Define what counted as a 'systematic review' for inclusion"],
  ['6', 'Information sources', 'List every source searched or consulted for reviews and any supplemental primary studies, with the date of the last search'],
  ['7', 'Search strategy', 'Give the full search strategies so they can be repeated, with any filters and limits'],
  ['8a', 'Selection process', 'Describe how reviews and any supplemental primary studies were judged against the criteria'],
  ['8b', 'Selection process: review overlap', 'Describe how reviews overlapping in population, intervention, comparator or outcome were found and handled at selection'],
  ['9a', 'Data collection process', 'Describe how data were collected from reports'],
  ['9b', 'Data collection process: primary study overlap', 'Describe how primary study overlap was found and handled per comparison and outcome, and how it was shown or quantified'],
  ['9c', 'Data collection process: discrepant data', 'Describe how discrepant data across reviews were handled'],
  ['10', 'Data items', 'List and define the variables and outcomes sought, with assumptions and how missing or unclear data were handled'],
  ['11a', 'Risk of bias assessment: systematic reviews', 'Describe how risk of bias or methodological quality of the included reviews was assessed'],
  ['11b', 'Risk of bias assessment: primary studies', 'Describe how risk of bias of the primary studies was taken from the reviews or assessed anew, and justify gaps left unassessed'],
  ['11c', 'Risk of bias assessment: supplemental primary studies', 'Describe how risk of bias of any supplemental primary studies was assessed'],
  ['12a', 'Synthesis methods', 'Describe how results were summarised or synthesised, and why'],
  ['12b', 'Synthesis methods: heterogeneity', 'Describe any exploration of causes of heterogeneity among results'],
  ['12c', 'Synthesis methods: sensitivity', 'Describe any sensitivity analyses of the synthesised results'],
  ['13', 'Reporting bias assessment', 'Describe how risk of bias from missing results was collected or assessed, at review and study level'],
  ['14', 'Certainty assessment', 'Describe how certainty in the body of evidence for an outcome was collected or assessed'],
  ['15a', 'Systematic review and supplemental primary study selection', 'Report the numbers screened, assessed and included, ideally in a flow diagram'],
  ['15b', 'Systematic review and supplemental primary study selection: excluded', 'List studies that seem eligible but were excluded, with the main reason'],
  ['16', 'Characteristics of systematic reviews and supplemental primary studies', 'Cite each included review and supplemental primary study and present its characteristics'],
  ['17', 'Primary study overlap', 'Describe how far primary studies overlap across the included reviews'],
  ['18a', 'Risk of bias in systematic reviews', 'Present the risk of bias or methodological quality of each included review'],
  ['18b', 'Risk of bias in primary studies', 'Present the risk of bias of the primary studies, as collected from the reviews or assessed anew'],
  ['18c', 'Risk of bias in supplemental primary studies', 'Present the risk of bias of any supplemental primary studies'],
  ['19a', 'Summary or synthesis of results', 'Summarise the evidence for every outcome; for meta-analyses give each estimate, its precision and heterogeneity'],
  ['19b', 'Summary or synthesis of results: heterogeneity', 'Present results of investigations of heterogeneity in meta-analyses'],
  ['19c', 'Summary or synthesis of results: sensitivity', 'Present results of sensitivity analyses of synthesised results'],
  ['20', 'Reporting biases', 'Present the risk of bias from missing studies, analyses or results for each summary or synthesis'],
  ['21', 'Certainty of evidence', 'Present certainty in the body of evidence for each outcome, collected or assessed anew'],
  ['22a', 'Discussion: summary', 'Summarise the main findings, including discrepancies between reviews'],
  ['22b', 'Discussion: interpretation', 'Interpret the results in the context of other evidence'],
  ['22c', 'Discussion: limitations', 'Discuss limitations of the evidence and of the overview methods'],
  ['22d', 'Discussion: implications', 'Discuss implications for practice, policy and future research, and relevance to users'],
  ['23a', 'Registration and protocol: registration', 'Give registration details, or state that the overview was not registered'],
  ['23b', 'Registration and protocol: protocol', 'Say where the protocol can be accessed, or that none was prepared'],
  ['23c', 'Registration and protocol: amendments', 'Describe and explain amendments to the registration or protocol, and when they were made'],
  ['24', 'Support', 'Describe financial or other support and the role of funders'],
  ['25', 'Competing interests', 'Declare competing interests of the authors'],
  ['26a', 'Author information: contact', 'Give contact details for the corresponding author'],
  ['26b', 'Author information: contributions', 'Describe author contributions and name the guarantor'],
  ['27', 'Availability of data and other materials', 'Report which forms, collected data, code and other materials are available, where, and on what terms'],
];

// The checklist a project reports against follows its research type. Each
// keeps its own states: item numbers overlap, and a project that changes type
// must not carry "reported" from one checklist to the other.
// ENTREQ (Tong et al. 2012): 21 items for reporting a synthesis of
// qualitative research. Item names are ENTREQ's; the descriptions are our own
// short wording, not the statement's text.
export const ENTREQ = [
  ['1', 'Aim', 'State the research question the synthesis addresses'],
  ['2', 'Synthesis methodology', 'Name the synthesis method used and why it suits the question'],
  ['3', 'Approach to searching', 'Say whether the search was pre-planned and comprehensive or aimed at saturation'],
  ['4', 'Inclusion criteria', 'Give the inclusion and exclusion criteria, such as population, language, year and study type'],
  ['5', 'Data sources', 'List every source searched: databases, grey literature, hand searching, reference lists, experts'],
  ['6', 'Electronic search strategy', 'Give the literature search, with terms and limits, for each database'],
  ['7', 'Study screening methods', 'Describe how records were screened, and by how many reviewers'],
  ['8', 'Study characteristics', 'Present the characteristics of the included studies'],
  ['9', 'Study selection results', 'Give the numbers screened and included, with reasons for exclusion, ideally in a flow diagram'],
  ['10', 'Rationale for appraisal', 'Explain why and how the included studies were appraised'],
  ['11', 'Appraisal items', 'Name the tool or criteria used to appraise the studies'],
  ['12', 'Appraisal process', 'Say whether appraisal was done by more than one reviewer, independently, and how disagreements were settled'],
  ['13', 'Appraisal results', 'Present the appraisal results and whether any study was weighted or excluded because of them'],
  ['14', 'Data extraction', 'Say which parts of each study were treated as data and how they were extracted'],
  ['15', 'Software', 'Name any software used'],
  ['16', 'Number of reviewers', 'Say who coded and analysed the data'],
  ['17', 'Coding', 'Describe the coding process, such as line-by-line coding of findings'],
  ['18', 'Study comparison', 'Describe how findings were compared across studies'],
  ['19', 'Derivation of themes', 'Explain whether themes were derived inductively or deductively, and how'],
  ['20', 'Quotations', 'Give quotations from the primary studies to illustrate themes, saying whose words they are'],
  ['21', 'Synthesis output', 'Present rich, compelling findings that go beyond a summary of the primary studies, such as new interpretations or models'],
];

export const CHECKLISTS = {
  'prisma-2020': { id: 'prisma-2020', name: 'PRISMA 2020', items: PRISMA_2020, key: 'checklist', review: 'systematic review' },
  'prisma-scr': { id: 'prisma-scr', name: 'PRISMA-ScR', items: PRISMA_SCR, key: 'checklistScr', review: 'scoping review' },
  'prisma-dta': { id: 'prisma-dta', name: 'PRISMA-DTA', items: PRISMA_DTA, key: 'checklistDta', review: 'diagnostic test accuracy review' },
  prior: { id: 'prior', name: 'PRIOR', items: PRIOR, key: 'checklistPrior', review: 'overview of reviews' },
};
// Which checklist a type reports against (lib/research-types.mjs); filled below once every checklist is defined.
const CHECKLIST_BY_TYPE = {};
CHECKLISTS.entreq = { id: 'entreq', name: 'ENTREQ', items: ENTREQ, key: 'checklistEntreq', review: 'qualitative evidence synthesis' };
CHECKLIST_BY_TYPE['qualitative-review'] = 'entreq';
// PRISMA-NMA (Hutton et al. 2015): the 27 PRISMA items with network-specific
// wording, and five new items S1–S5. Item names follow the extension;
// descriptions are summarised here in our own words.
export const PRISMA_NMA = [
  ['1', 'Title', 'Identify the report as a systematic review incorporating a network meta-analysis'],
  ['2', 'Structured summary', 'Summarise background, objectives, methods, results and conclusions, including the network and how treatments were compared'],
  ['3', 'Rationale', 'Describe the rationale, and why a network meta-analysis suits the question'],
  ['4', 'Objectives', 'State the questions addressed, with participants, interventions, comparisons, outcomes and study design'],
  ['5', 'Protocol and registration', 'Say whether a protocol exists and where it can be accessed, with registration information'],
  ['6', 'Eligibility criteria', 'Specify study and report characteristics used for eligibility, including how treatments were grouped into network nodes'],
  ['7', 'Information sources', 'Describe all information sources searched, with the date each was last searched'],
  ['8', 'Search', 'Present the full search strategy for at least one database, including limits, so it can be repeated'],
  ['9', 'Study selection', 'State the process for selecting studies: screening, eligibility and inclusion'],
  ['10', 'Data collection process', 'Describe how data were extracted and confirmed with investigators where done'],
  ['11', 'Data items', 'List and define the variables sought and any assumptions or simplifications made'],
  ['S1', 'Geometry of the network', 'Describe how the network of treatments was explored, and any changes to it'],
  ['12', 'Risk of bias within individual studies', 'Describe the methods used to assess risk of bias in individual studies and how this was used'],
  ['13', 'Summary measures', 'State the principal summary measures, and any additional ones such as treatment rankings'],
  ['14', 'Planned methods of analysis', 'Describe how data were handled and combined in the network, including the model and how heterogeneity was handled'],
  ['S2', 'Assessment of inconsistency', 'Describe the methods used to evaluate agreement between direct and indirect evidence'],
  ['15', 'Risk of bias across studies', 'Describe any assessment of bias that may affect the cumulative evidence, such as publication bias'],
  ['16', 'Additional analyses', 'Describe any additional analyses, such as sensitivity analyses or meta-regression, and whether pre-specified'],
  ['17', 'Study selection', 'Give the numbers screened, assessed and included, with reasons for exclusion, ideally in a flow diagram'],
  ['S3', 'Presentation of network structure', 'Present a network graph of the included studies'],
  ['S4', 'Summary of network geometry', 'Briefly describe the network: which treatments were compared directly, and how often'],
  ['18', 'Study characteristics', 'For each study, present its characteristics, with citations'],
  ['19', 'Risk of bias within studies', 'Present risk of bias data for each study'],
  ['20', 'Results of individual studies', 'For each study, present the data for each arm and the effect estimates with confidence intervals'],
  ['21', 'Synthesis of results', 'Present results of each network meta-analysis with confidence intervals, such as a league table, and any ranking'],
  ['S5', 'Exploration for inconsistency', 'Describe the results of investigating inconsistency, such as tests of consistency'],
  ['22', 'Risk of bias across studies', 'Present the results of any assessment of bias across studies'],
  ['23', 'Results of additional analyses', 'Give the results of any additional analyses'],
  ['24', 'Summary of evidence', 'Summarise the main findings, including the strength of evidence for each outcome'],
  ['25', 'Limitations', 'Discuss limitations at study, outcome and review level'],
  ['26', 'Conclusions', 'Interpret the results in the context of other evidence, with implications for research'],
  ['27', 'Funding', 'Describe sources of funding and other support, and the role of the funders'],
];
CHECKLISTS['prisma-nma'] = { id: 'prisma-nma', name: 'PRISMA-NMA', items: PRISMA_NMA, key: 'checklistNma', review: 'network meta-analysis' };
CHECKLIST_BY_TYPE['nma-review'] = 'prisma-nma';
// CARE (Gagnier et al. 2013), for a case report: 13 items, several with
// sub-items. Item names follow the checklist; descriptions are our own short
// wording. The case record and the manuscript vouch for items through
// caseSupported (lib/case-report.mjs).
export const CARE = [
  ['1', 'Title', 'Name the main diagnosis or intervention, followed by the words "case report"'],
  ['2', 'Keywords', 'Give two to five keywords naming the diagnoses or interventions, including "case report"'],
  ['3a', 'Abstract: introduction', 'Say what is unique about the case and what it adds to the literature'],
  ['3b', 'Abstract: main symptoms and findings', "Summarise the patient's main symptoms and important clinical findings"],
  ['3c', 'Abstract: diagnoses, interventions and outcomes', 'Give the main diagnoses, therapeutic interventions and outcomes'],
  ['3d', 'Abstract: conclusion', 'State the main take-away lesson of the case'],
  ['4', 'Introduction', 'Explain briefly why the case is unique, with references where useful'],
  ['5a', 'Patient information: demographics', 'Give de-identified patient-specific information'],
  ['5b', 'Patient information: main concerns', "Describe the patient's primary concerns and symptoms"],
  ['5c', 'Patient information: history', 'Give the medical, family and psychosocial history, with relevant genetic information and comorbidities'],
  ['5d', 'Patient information: past interventions', 'Describe relevant past interventions and their outcomes'],
  ['6', 'Clinical findings', 'Describe the physical examination and other important clinical findings'],
  ['7', 'Timeline', 'Present historical and current information from this episode of care as a timeline'],
  ['8a', 'Diagnostic assessment: testing', 'Describe the diagnostic methods, such as examination, laboratory tests, imaging and questionnaires'],
  ['8b', 'Diagnostic assessment: challenges', 'Describe diagnostic challenges, such as access to testing, cost or cultural factors'],
  ['8c', 'Diagnostic assessment: diagnosis', 'Give the diagnosis and the other diagnoses considered'],
  ['8d', 'Diagnostic assessment: prognosis', 'Give prognostic characteristics, such as staging, where they apply'],
  ['9a', 'Therapeutic intervention: types', 'Name the types of intervention, such as pharmacological, surgical, preventive or self-care'],
  ['9b', 'Therapeutic intervention: administration', 'Describe how the intervention was given: dose, strength and duration'],
  ['9c', 'Therapeutic intervention: changes', 'Describe any changes to the intervention, with the reason for each'],
  ['10a', 'Follow-up and outcomes: assessed outcomes', 'Give clinician-assessed and, where available, patient-assessed outcomes'],
  ['10b', 'Follow-up and outcomes: test results', 'Give important follow-up diagnostic and other test results'],
  ['10c', 'Follow-up and outcomes: adherence and tolerability', 'Describe adherence to and tolerability of the intervention, and how they were assessed'],
  ['10d', 'Follow-up and outcomes: adverse events', 'Describe adverse and unanticipated events'],
  ['11a', 'Discussion: strengths and limitations', 'Discuss the strengths and the limitations of how the case was managed and reported'],
  ['11b', 'Discussion: literature', 'Discuss the relevant medical literature, with references'],
  ['11c', 'Discussion: rationale', 'Give the scientific rationale for the conclusions, including an assessment of possible causes'],
  ['11d', 'Discussion: take-away lessons', 'State the main take-away lessons in a one-paragraph conclusion, without references'],
  ['12', 'Patient perspective', 'Give the patient\'s own perspective on the care they received, where they are willing to share it'],
  ['13', 'Informed consent', 'State whether the patient gave informed consent for publication, and provide it if asked'],
];
CHECKLISTS.care = { id: 'care', name: 'CARE', items: CARE, key: 'checklistCare', review: 'case report' };
// Primary studies and guidelines: CONSORT, STROBE, STARD, TRIPOD, CROSS, SRQR, SQUIRE, CHEERS, ARRIVE, RIGHT (lib/checklists-primary.mjs).
Object.assign(CHECKLISTS, PRIMARY_CHECKLISTS);
// Alternatives, protocol and abstract checklists, extensions and add-ons (lib/checklists-extra.mjs), chosen per project (lib/checklist-choice.mjs).
Object.assign(CHECKLISTS, EXTRA_CHECKLISTS);
for (const t of RESEARCH_TYPES) if (CHECKLISTS[t.checklist]) CHECKLIST_BY_TYPE[t.id] = t.checklist;
export const checklistOf = s => {
  const choice = applied(s);
  const base = CHECKLISTS[choice.checklist] || CHECKLISTS[CHECKLIST_BY_TYPE[researchType(s).id] || 'prisma-2020'];
  const list = choice.extensions.length || choice.addons.length ? composeChecklist(base, choice.extensions, choice.addons) : base;
  // A living review adds its own reporting topics to the checklist in use (lib/living.mjs).
  return s.living?.on && list.id !== 'care' ? { ...list, items: [...list.items, ...LSR_ITEMS] } : list;
};
/** This project's item states for its own checklist. */
export const checklistStates = s => s[checklistOf(s).key] || {};

export const STATES = [['', 'Not reviewed'], ['done', 'Reported'], ['na', 'Not applicable']];

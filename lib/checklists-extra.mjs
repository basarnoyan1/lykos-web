// Further reporting checklists: main alternatives, protocol and abstract
// checklists, extensions that add to or modify a base checklist, and add-ons
// that apply across designs (checklist chooser, lib/checklist-choice.mjs).
// Item numbers and short names follow each published checklist; every
// description is a one-sentence paraphrase in our own words, never the
// official wording (plan H6). Checklists whose item list we could not confirm
// are left out rather than guessed.
//
// An extension item carries a fourth element: the base item number it
// modifies, or, for an item the extension adds, the base item it follows.
// Pure data: nothing here imports the store, a view or lib/checklist.mjs.

// ---- main alternatives -----------------------------------------------------

// CONSORT 2025 (Hopewell et al. 2025), the revised checklist for a randomised
// trial: 30 items, with a new open science section.
const CONSORT_2025 = [
  ['1a', 'Title', 'Make clear in the title that the trial randomised participants'],
  ['1b', 'Abstract', 'Give a structured summary following the abstract checklist'],
  ['2', 'Trial registration', 'Name the registry, the trial number and when it was registered'],
  ['3', 'Protocol and statistical analysis plan', 'Say where the protocol and analysis plan can be read'],
  ['4', 'Data sharing', 'Say whether and how de-identified participant data, code and other materials can be obtained'],
  ['5a', 'Funding', 'Give the sources of funding and support and what part funders played'],
  ['5b', 'Conflicts of interest', 'Declare the financial and other interests of the authors'],
  ['6', 'Background and rationale', 'Set out the scientific background and why the trial was worth doing'],
  ['7', 'Objectives', 'State the specific objectives, covering both benefits and harms'],
  ['8', 'Patient and public involvement', 'Describe how patients or the public took part in designing, running or reporting the trial'],
  ['9', 'Trial design', 'Describe the design, its allocation ratio and its framework, such as superiority or non-inferiority'],
  ['10', 'Changes to trial protocol', 'Report important changes made after the trial started, with the reasons'],
  ['11', 'Trial setting', 'Describe the settings and places where the trial ran'],
  ['12a', 'Eligibility: participants', 'Give the criteria that decided who could take part'],
  ['12b', 'Eligibility: sites and providers', 'Where relevant, give the criteria for sites and for the people delivering interventions'],
  ['13', 'Intervention and comparator', 'Describe what each group received in enough detail for someone else to repeat it'],
  ['14', 'Outcomes', 'Define each prespecified primary and secondary outcome, how it was measured, summarised and when'],
  ['15', 'Harms', 'Explain how harms were defined and how they were assessed'],
  ['16a', 'Sample size', 'Explain how the target size was reached, including the assumptions behind it'],
  ['16b', 'Interim analyses and stopping', 'Describe any interim analyses and the rules for stopping early'],
  ['17a', 'Sequence generation', 'Say who produced the allocation sequence and by what method'],
  ['17b', 'Type of randomisation', 'Describe the kind of randomisation and any restriction such as stratification or blocks'],
  ['18', 'Allocation concealment', 'Explain how the sequence was kept hidden until each participant was assigned'],
  ['19', 'Implementation', 'Say whether those enrolling and assigning participants could see the sequence'],
  ['20a', 'Blinding: who', 'State which people were kept unaware of assignment after it was made'],
  ['20b', 'Blinding: how', 'Where blinding was used, describe how and how alike the interventions were'],
  ['21a', 'Statistical methods', 'Give the methods used to compare groups on primary and secondary outcomes, harms included'],
  ['21b', 'Analysis population', 'Define who was included in each analysis and in which group they were counted'],
  ['21c', 'Missing data', 'Explain how missing data were dealt with in the analysis'],
  ['21d', 'Additional analyses', 'Give the methods for further analyses, marking which were planned in advance'],
  ['22a', 'Participant flow', 'For each group, give the numbers randomised, treated as intended and analysed, ideally in a diagram'],
  ['22b', 'Losses and exclusions', 'For each group, report losses and exclusions after randomisation, with reasons'],
  ['23a', 'Recruitment', 'Give the dates of recruitment and follow-up'],
  ['23b', 'Trial end', 'Where relevant, explain why the trial ended or was stopped'],
  ['24a', 'Intervention delivery', 'Describe how the intervention and comparator were actually given'],
  ['24b', 'Concomitant care', 'Describe other care participants received during the trial'],
  ['25', 'Baseline data', 'Tabulate baseline demographic and clinical characteristics for each group'],
  ['26', 'Outcomes and estimation', 'For each outcome and group, give numbers analysed, results, the effect estimate with its precision and, for binary outcomes, absolute and relative effects'],
  ['27', 'Harms', 'Report all harms or unintended events in each group'],
  ['28', 'Ancillary analyses', 'Report any other analyses, such as subgroup or sensitivity analyses, marking which were planned'],
  ['29', 'Interpretation', 'Interpret the results in line with the findings, weighing benefits against harms and other evidence'],
  ['30', 'Limitations', 'Discuss sources of bias, imprecision and limits to generalisability'],
];

// TRIPOD+AI (Collins et al. 2024), for prediction models built with
// regression or machine learning: 27 items.
const TRIPOD_AI = [
  ['1', 'Title', 'Identify the study as developing or evaluating a prediction model, naming the population and outcome'],
  ['2', 'Abstract', 'Give a structured summary following the abstract checklist'],
  ['3a', 'Background: context', 'Describe the healthcare setting and why the model is needed, citing existing models'],
  ['3b', 'Background: intended use', 'Describe the target population and the part the model is meant to play in care'],
  ['3c', 'Background: inequalities', 'Describe any known health inequalities between groups relevant to the model'],
  ['4', 'Objectives', 'State whether the study develops, evaluates, or does both'],
  ['5a', 'Data sources', 'Describe where the development and evaluation data came from and why they suit the purpose'],
  ['5b', 'Dates', 'Give the dates of data collection, including start and end of accrual and follow-up'],
  ['6a', 'Setting', 'Describe the setting, such as primary or hospital care, with the number and location of centres'],
  ['6b', 'Eligibility', 'Give the criteria that decided which participants were included'],
  ['6c', 'Treatments', 'Describe any treatments received and how they were handled in development or evaluation'],
  ['7', 'Data preparation', 'Describe any preprocessing and quality checking of the data, and whether it was alike across groups'],
  ['8a', 'Outcome', 'Define the predicted outcome, its time horizon and how and when it was assessed'],
  ['8b', 'Outcome assessors', 'Where assessing the outcome needs judgement, describe the qualifications and demographics of the assessors'],
  ['8c', 'Outcome blinding', 'Report any steps taken to keep outcome assessment unaware of predictor values'],
  ['9a', 'Predictor choice', 'Explain how the initial predictors were chosen and any preselection before modelling'],
  ['9b', 'Predictor definition', 'Define every predictor, with how and when it was measured'],
  ['9c', 'Predictor assessors', 'Where measuring predictors needs judgement, describe the assessors and any blinding'],
  ['10', 'Sample size', 'Explain how the study size was reached, separately for development and evaluation'],
  ['11', 'Missing data', 'Describe how missing data were handled and why that approach was chosen'],
  ['12a', 'Data use', 'Describe how the data were split or used for development and for evaluation'],
  ['12b', 'Predictor handling', 'Describe how predictors were handled, including any transformation or scaling'],
  ['12c', 'Model building', 'Specify the model type, how it was built and tuned, and how it was internally validated'],
  ['12d', 'Heterogeneity', 'Describe how differences in estimates and performance across clusters were handled'],
  ['12e', 'Performance measures', 'Specify the measures and plots used to judge performance and to compare models'],
  ['12f', 'Model updating', 'Describe any updating of the model after evaluation, such as recalibration'],
  ['12g', 'Calculating predictions', 'For external evaluation, describe how predictions were produced for the new data'],
  ['13', 'Class imbalance', 'If class imbalance methods were used, say why and how, and how calibration was restored'],
  ['14', 'Fairness', 'Describe any methods used to examine how fair the model is across groups'],
  ['15', 'Model output', 'Specify what the model outputs, such as probabilities or classes, and any thresholds'],
  ['16', 'Training versus evaluation', 'Identify differences between development and evaluation data in setting, eligibility, outcome and predictors'],
  ['17', 'Ethical approval', 'Name the ethics committee that approved the study and describe consent or its waiver'],
  ['18a', 'Funding', 'Give the funding sources and what part funders played'],
  ['18b', 'Conflicts of interest', 'Declare the interests of each author'],
  ['18c', 'Protocol', 'Say where the study protocol can be read, or that there was none'],
  ['18d', 'Registration', 'Give the registry and number, or say the study was not registered'],
  ['18e', 'Data sharing', 'Say whether and how the study data can be obtained'],
  ['18f', 'Code sharing', 'Say whether and how the analysis code can be obtained'],
  ['19', 'Patient and public involvement', 'Describe how patients or the public were involved, or say they were not'],
  ['20a', 'Participant flow', 'Describe the flow of participants, with numbers with and without the outcome and follow-up time'],
  ['20b', 'Participant characteristics', 'Describe participants overall and by relevant groups, with missing data for predictors and outcome'],
  ['20c', 'Comparing data sets', 'For evaluation, compare the distribution of key predictors with the development data'],
  ['21', 'Numbers and events', 'Give the numbers of participants and outcome events in each analysis'],
  ['22', 'Full model', 'Give the full model or explain how to obtain it, so that predictions can be made for new people'],
  ['23a', 'Model performance', 'Report performance estimates with confidence intervals, including for key subgroups'],
  ['23b', 'Performance heterogeneity', 'Report results of any analysis of how performance varies across clusters'],
  ['24', 'Model updating results', 'Report the results of any model updating, including the updated model'],
  ['25', 'Interpretation', 'Interpret the main results, including fairness, in light of the objectives and earlier work'],
  ['26', 'Limitations', 'Discuss the limitations of the study and their effect on the results'],
  ['27a', 'Usability: input data', 'Describe how poor quality or missing input data should be handled when the model is used'],
  ['27b', 'Usability: users', 'Say whether users need to interact with the data or know about it before the model is used'],
  ['27c', 'Future research', 'Discuss next steps for research, noting how far the model can be generalised'],
];

// COREQ (Tong, Sainsbury, Craig 2007), for interviews and focus groups: 32
// items in three domains.
const COREQ = [
  ['1', 'Interviewer or facilitator', 'Say which author or authors ran the interviews or focus groups'],
  ['2', 'Credentials', "Give the researcher's credentials, such as a degree"],
  ['3', 'Occupation', 'Give what the researcher did for a living at the time of the study'],
  ['4', 'Gender', 'State the gender of the researcher'],
  ['5', 'Experience and training', 'Describe the experience or training the researcher had'],
  ['6', 'Relationship established', 'Say whether a relationship existed with participants before the study began'],
  ['7', 'Participant knowledge of the interviewer', 'Describe what participants knew about the researcher, such as their goals'],
  ['8', 'Interviewer characteristics', 'Report characteristics of the interviewer, such as biases, assumptions or interest in the topic'],
  ['9', 'Methodological orientation', 'Name the methodological approach behind the study, such as grounded theory or phenomenology'],
  ['10', 'Sampling', 'Describe how participants were chosen, such as purposive or snowball sampling'],
  ['11', 'Method of approach', 'Describe how participants were contacted, such as in person, by phone or by email'],
  ['12', 'Sample size', 'Give how many people took part'],
  ['13', 'Non-participation', 'Say how many declined or dropped out, and why'],
  ['14', 'Setting of data collection', 'Say where the data were collected, such as at home or in a clinic'],
  ['15', 'Presence of non-participants', 'Say whether anyone besides participants and researchers was present'],
  ['16', 'Description of sample', 'Describe the main characteristics of the sample, such as demographics and dates'],
  ['17', 'Interview guide', 'Say whether questions or prompts were provided by the authors and whether they were piloted'],
  ['18', 'Repeat interviews', 'Say whether any interviews were repeated and, if so, how many'],
  ['19', 'Audio or visual recording', 'Say whether audio or video recording was used to collect the data'],
  ['20', 'Field notes', 'Say whether field notes were made during or after each interview or group'],
  ['21', 'Duration', 'Give how long the interviews or focus groups lasted'],
  ['22', 'Data saturation', 'Say whether saturation was discussed'],
  ['23', 'Transcripts returned', 'Say whether transcripts went back to participants for comment or correction'],
  ['24', 'Number of coders', 'Give how many people coded the data'],
  ['25', 'Coding tree', 'Say whether a description of the coding tree is provided'],
  ['26', 'Derivation of themes', 'Say whether themes were set in advance or arose from the data'],
  ['27', 'Software', 'Name any software used to manage the data'],
  ['28', 'Participant checking', 'Say whether participants gave feedback on the findings'],
  ['29', 'Quotations presented', 'Say whether quotations illustrate the themes and whether each is identified, such as by participant number'],
  ['30', 'Data and findings consistent', 'Show that the data presented agree with the findings'],
  ['31', 'Clarity of major themes', 'Present the major themes clearly'],
  ['32', 'Clarity of minor themes', 'Describe diverse cases or discuss minor themes'],
];

// eMERGe (France et al. 2019), for a meta-ethnography: 19 items across the
// seven phases of the method.
const EMERGE = [
  ['1', 'Rationale and context', 'Describe the gap in research or knowledge the synthesis fills and its wider context'],
  ['2', 'Aims', 'State the aims of the synthesis'],
  ['3', 'Focus', 'Describe the review question and how it was shaped and refined'],
  ['4', 'Rationale for meta-ethnography', 'Explain why meta-ethnography suits the question and the evidence'],
  ['5', 'Search strategy', 'Describe the approach to searching and why it was chosen'],
  ['6', 'Search processes', 'Describe the sources, terms and dates of the searches'],
  ['7', 'Selecting primary studies', 'Describe how studies were chosen, including criteria and any appraisal'],
  ['8', 'Outcome of study selection', 'Report the number of studies screened and included, with reasons for exclusion'],
  ['9', 'Reading and data extraction', 'Describe how the studies were read and which data were taken from them'],
  ['10', 'Characteristics of included studies', 'Describe the included studies and their contexts'],
  ['11', 'Determining how studies relate', 'Describe how the relationships between studies were worked out'],
  ['12', 'Outcome of relating studies', 'Describe how the studies were found to relate to each other'],
  ['13', 'Process of translation', 'Describe the methods used to translate concepts across studies'],
  ['14', 'Outcome of translation', 'Describe the translations made, with the concepts behind them'],
  ['15', 'Synthesis process', 'Describe how the translations were brought together into a synthesis'],
  ['16', 'Outcome of synthesis', 'Present the new interpretations or model the synthesis produced'],
  ['17', 'Summary of findings', 'Summarise the main findings and how they relate to existing knowledge'],
  ['18', 'Strengths, limitations and reflexivity', 'Reflect on the strengths and weaknesses of the synthesis and on the influence of the reviewers'],
  ['19', 'Recommendations and conclusions', 'Set out the implications for practice, policy and further research'],
];

// TREND (Des Jarlais et al. 2004), for non-randomised evaluations of
// behavioural and public health interventions: 22 items.
const TREND = [
  ['1', 'Title and abstract', 'Say how units were allocated to interventions and give a structured summary'],
  ['2', 'Background', 'Give the scientific background and the theory behind the intervention'],
  ['3', 'Participants', 'Give the eligibility criteria, recruitment method, and settings and places of data collection'],
  ['4', 'Interventions', 'Describe what each condition delivered, including how, when, where and by whom'],
  ['5', 'Objectives', 'State the specific objectives and hypotheses'],
  ['6', 'Outcomes', 'Define the primary and secondary outcomes and how they were measured'],
  ['7', 'Sample size', 'Explain how the sample size was worked out'],
  ['8', 'Assignment method', 'Describe the unit of assignment and how units were assigned, including steps to reduce bias'],
  ['9', 'Blinding', 'Say whether participants, providers and assessors were unaware of assignment, and how'],
  ['10', 'Unit of analysis', 'Describe the smallest unit analysed and any method used to account for a difference from the unit assigned'],
  ['11', 'Statistical methods', 'Give the methods used to compare groups and for any additional analyses'],
  ['12', 'Participant flow', 'Report the flow of participants through each stage, ideally in a diagram'],
  ['13', 'Recruitment', 'Give the dates of recruitment and follow-up'],
  ['14', 'Baseline data', 'Report the baseline characteristics of each group'],
  ['15', 'Baseline equivalence', 'Compare the groups at baseline and describe any methods used to control for differences'],
  ['16', 'Numbers analysed', 'Give the number in each group included in each analysis'],
  ['17', 'Outcomes and estimation', 'For each outcome, give results per group with the effect size and its precision'],
  ['18', 'Ancillary analyses', 'Report other analyses, such as subgroups, marking which were planned'],
  ['19', 'Adverse events', 'Report all important adverse events or unintended effects in each group'],
  ['20', 'Interpretation', 'Interpret the results with the study hypotheses, sources of bias and imprecision in mind'],
  ['21', 'Generalisability', 'Discuss how far the findings apply beyond the study population and setting'],
  ['22', 'Overall evidence', 'Interpret the results in the light of current evidence and theory'],
];

// ---- protocols -------------------------------------------------------------

// SPIRIT 2013 (Chan et al. 2013), for a trial protocol: 33 items.
const SPIRIT_2013 = [
  ['1', 'Title', 'Give a descriptive title naming the design, population, interventions and, if relevant, the acronym'],
  ['2a', 'Trial registration', 'Give the trial identifier and the name of the registry, or where it will be registered'],
  ['2b', 'Registration data set', 'Include every item of the WHO trial registration data set'],
  ['3', 'Protocol version', 'Give the date and version of the protocol'],
  ['4', 'Funding', 'Give the sources and kinds of financial, material and other support'],
  ['5a', 'Roles: contributors', 'Name the protocol contributors and what each one did'],
  ['5b', 'Roles: sponsor', 'Give the name and contact details of the trial sponsor'],
  ['5c', 'Roles: sponsor and funder', 'Describe any part the sponsor and funders play in design, conduct, analysis and reporting'],
  ['5d', 'Roles: committees', 'Describe the make-up, roles and responsibilities of the committees and groups overseeing the trial'],
  ['6a', 'Background and rationale', 'Set out the question and why the trial is worth doing, summarising relevant studies'],
  ['6b', 'Choice of comparators', 'Explain why each comparator was chosen'],
  ['7', 'Objectives', 'State the specific objectives or hypotheses'],
  ['8', 'Trial design', 'Describe the design, allocation ratio and framework, such as superiority or equivalence'],
  ['9', 'Study setting', 'Describe the settings and the countries where data will be collected'],
  ['10', 'Eligibility criteria', 'Give the criteria for participants and, where relevant, for sites and those delivering interventions'],
  ['11a', 'Interventions', 'Describe each intervention in enough detail to be repeated, including how and when it is given'],
  ['11b', 'Modifying interventions', 'Give the criteria for stopping or changing an assigned intervention for a participant'],
  ['11c', 'Adherence', 'Describe how adherence will be encouraged and checked'],
  ['11d', 'Concomitant care', 'Say what other care or interventions are allowed or forbidden during the trial'],
  ['12', 'Outcomes', 'Define the primary, secondary and other outcomes, with the measure, metric, aggregation and time point'],
  ['13', 'Participant timeline', 'Give the schedule of enrolment, interventions, assessments and visits, ideally as a diagram'],
  ['14', 'Sample size', 'Give the planned number of participants and how it was calculated'],
  ['15', 'Recruitment', 'Describe how enough participants will be recruited to reach the target'],
  ['16a', 'Sequence generation', 'Describe how the allocation sequence will be generated and any restriction'],
  ['16b', 'Allocation concealment', 'Describe how the sequence will be kept hidden until assignment'],
  ['16c', 'Implementation', 'Say who will generate the sequence, enrol participants and assign them'],
  ['17a', 'Blinding', 'Say who will be kept unaware of assignment after it is made, and how'],
  ['17b', 'Emergency unblinding', 'Where blinded, say when unblinding is allowed and how it is done'],
  ['18a', 'Data collection methods', 'Describe how outcome and other data will be collected, with the instruments used'],
  ['18b', 'Retention', 'Describe plans to keep participants in follow-up and what will be collected from those who stop'],
  ['19', 'Data management', 'Describe how data will be entered, coded, secured and stored, with any quality checks'],
  ['20a', 'Statistical methods', 'Give the methods for analysing primary and secondary outcomes'],
  ['20b', 'Additional analyses', 'Give the methods for any further analyses, such as subgroup or adjusted analyses'],
  ['20c', 'Analysis population and missing data', 'Define the population analysed and any methods for missing data'],
  ['21a', 'Data monitoring committee', 'Describe the data monitoring committee, or explain why none is needed'],
  ['21b', 'Interim analyses', 'Describe any interim analyses and stopping rules, with who sees the results and decides'],
  ['22', 'Harms', 'Describe how adverse events and other unintended effects will be collected, assessed and reported'],
  ['23', 'Auditing', 'Describe how often and by what process trial conduct will be audited, if at all'],
  ['24', 'Research ethics approval', 'Describe plans for seeking ethics committee approval'],
  ['25', 'Protocol amendments', 'Describe how important changes to the protocol will be communicated to interested parties'],
  ['26a', 'Consent', 'Say who will obtain consent from participants or their surrogates, and how'],
  ['26b', 'Consent for ancillary studies', 'Describe any further consent for collecting and using data and samples in other studies'],
  ['27', 'Confidentiality', 'Describe how personal information will be collected, shared and protected'],
  ['28', 'Declaration of interests', 'Declare the interests of the principal investigators for the trial as a whole and each site'],
  ['29', 'Access to data', 'Say who will have access to the final data set and any limits on that access'],
  ['30', 'Ancillary and post-trial care', 'Describe any provision for care after the trial and compensation for harm'],
  ['31a', 'Dissemination policy', 'Describe plans for sharing results with participants, professionals, the public and others'],
  ['31b', 'Authorship', 'Give the criteria for authorship and any intended use of professional writers'],
  ['31c', 'Reproducible research', 'Describe any plans to give public access to the protocol, participant data and code'],
  ['32', 'Informed consent materials', 'Provide the consent form and other information given to participants'],
  ['33', 'Biological specimens', 'Describe plans for collecting, testing and storing any biological samples'],
];

// PRISMA-P 2015 (Moher et al. 2015), for a systematic review protocol: 17
// items, several with sub-items.
const PRISMA_P = [
  ['1a', 'Identification', 'Identify the document as a protocol of a systematic review'],
  ['1b', 'Update', 'If the protocol is for an update of an earlier review, say so'],
  ['2', 'Registration', 'Give the registry, such as PROSPERO, and the registration number, if registered'],
  ['3a', 'Authors: contact', 'Give the names, affiliations and emails of all authors, with the corresponding author'],
  ['3b', 'Authors: contributions', 'Describe what each author contributed and name the guarantor of the review'],
  ['4', 'Amendments', 'If the protocol amends an earlier one, say what changed, otherwise state how changes will be recorded'],
  ['5a', 'Support: sources', 'Give the financial or other sources of support'],
  ['5b', 'Support: sponsor', 'Name the funder or sponsor'],
  ['5c', 'Support: role of sponsor', 'Describe any part funders, sponsors or institutions play in developing the protocol'],
  ['6', 'Rationale', 'Explain why the review is needed given what is already known'],
  ['7', 'Objectives', 'State the question the review will answer, with reference to participants, interventions, comparators and outcomes'],
  ['8', 'Eligibility criteria', 'Give the study and report characteristics, such as design, setting, time frame and language, that decide inclusion'],
  ['9', 'Information sources', 'List the databases, registers and other sources to be searched, with planned coverage dates'],
  ['10', 'Search strategy', 'Present a draft search for at least one database, with its limits, so it could be repeated'],
  ['11a', 'Data management', 'Describe how records and data will be handled during the review'],
  ['11b', 'Selection process', 'Describe how studies will be selected through each phase, such as screening and eligibility'],
  ['11c', 'Data collection process', 'Describe how data will be extracted, such as independently in duplicate, and how investigators will be contacted'],
  ['12', 'Data items', 'List and define the variables to be collected, with any planned assumptions and simplifications'],
  ['13', 'Outcomes and prioritisation', 'List and define the outcomes to be collected, with main and additional outcomes and reasons'],
  ['14', 'Risk of bias in individual studies', 'Describe the methods planned for judging risk of bias and how it will be used in synthesis'],
  ['15a', 'Synthesis: criteria', 'Describe when data will be synthesised quantitatively'],
  ['15b', 'Synthesis: methods', 'If a quantitative synthesis is planned, describe the summary measures, pooling methods and heterogeneity checks'],
  ['15c', 'Synthesis: additional analyses', 'Describe any planned additional analyses, such as sensitivity or subgroup analyses and meta-regression'],
  ['15d', 'Synthesis: narrative', 'If a quantitative synthesis is not suitable, describe the planned summary'],
  ['16', 'Meta-biases', 'Describe how cumulative bias, such as publication bias or selective reporting, will be assessed'],
  ['17', 'Confidence in cumulative evidence', 'Describe how the strength of the body of evidence will be judged, such as with GRADE'],
];

// ---- abstracts -------------------------------------------------------------

// CONSORT for Abstracts (Hopewell et al. 2008). The published list names its
// items without numbers; they are numbered here in its order.
const CONSORT_ABSTRACT = [
  ['1', 'Title', 'Identify the study as randomised'],
  ['2', 'Authors', 'Give contact details for the corresponding author, for conference abstracts'],
  ['3', 'Trial design', 'Describe the trial design, such as parallel, cluster or non-inferiority'],
  ['4', 'Participants', 'Give the eligibility criteria and the settings where data were collected'],
  ['5', 'Interventions', 'Describe what each group was meant to receive'],
  ['6', 'Objective', 'State the specific objective or hypothesis'],
  ['7', 'Outcome', 'Define the primary outcome for this report'],
  ['8', 'Randomisation', 'Describe how participants were allocated to interventions'],
  ['9', 'Blinding', 'Say whether participants, care givers and outcome assessors were unaware of group assignment'],
  ['10', 'Numbers randomised', 'Give the number randomised to each group'],
  ['11', 'Recruitment', 'Report the trial status'],
  ['12', 'Numbers analysed', 'Give the number analysed in each group'],
  ['13', 'Outcome', 'For the primary outcome, give the result per group with the effect size and its precision'],
  ['14', 'Harms', 'Report important adverse events or side effects'],
  ['15', 'Conclusions', 'Give a general interpretation of the results'],
  ['16', 'Trial registration', 'Give the registration number and the name of the registry'],
  ['17', 'Funding', 'Name the source of funding'],
];

// PRISMA 2020 for Abstracts (Page et al. 2021): 12 items.
const PRISMA_ABSTRACT = [
  ['1', 'Title', 'Identify the report as a systematic review'],
  ['2', 'Objectives', 'Give an explicit statement of the main objective or question'],
  ['3', 'Eligibility criteria', 'Give the inclusion and exclusion criteria'],
  ['4', 'Information sources', 'Name the main sources searched and the date each was last searched'],
  ['5', 'Risk of bias', 'Name the methods used to judge risk of bias in the included studies'],
  ['6', 'Synthesis of results', 'Name the methods used to present and combine results'],
  ['7', 'Included studies', 'Give the number of studies and participants included and their relevant characteristics'],
  ['8', 'Synthesis of results', 'Present results for the main outcomes, with the number of studies and participants and, if pooled, the estimate and its interval'],
  ['9', 'Limitations of evidence', 'Summarise the main limitations of the evidence, such as risk of bias, inconsistency and imprecision'],
  ['10', 'Interpretation', 'Give a general interpretation of the results and their main implications'],
  ['11', 'Funding', 'Name the main source of funding for the review'],
  ['12', 'Registration', 'Give the register name and registration number'],
];

// ---- extensions (the fourth element is the base item modified or followed) ----

// CONSORT extension for cluster randomised trials (Campbell et al. 2012), on CONSORT 2010.
const CONSORT_CLUSTER = [
  ['1a', 'Title', 'Identify the trial as cluster randomised in the title', '1a'],
  ['2a', 'Rationale for cluster design', 'Explain why a cluster design was used', '2a'],
  ['2b', 'Level of objectives', 'Say whether the objectives concern the cluster level, the individual level or both', '2b'],
  ['3a', 'Definition of cluster', 'Define the cluster and describe how the design applies to it', '3a'],
  ['4a', 'Eligibility of clusters', 'Give the eligibility criteria for clusters as well as for participants', '4a'],
  ['5', 'Level of interventions', 'Say whether interventions act at the cluster level, the individual level or both', '5'],
  ['6a', 'Level of outcomes', 'Say whether outcome measures relate to the cluster level, the individual level or both', '6a'],
  ['7a', 'Sample size for clusters', 'Give the number of clusters, their expected size and the intracluster correlation or coefficient of variation assumed', '7a'],
  ['8b', 'Stratification and matching', 'Describe any stratification or matching of clusters', '8b'],
  ['9', 'Concealment by level', 'Say whether allocation was concealed at the cluster level, the individual level or both', '9'],
  ['10a', 'Who assigned clusters', 'Say who generated the sequence, who enrolled clusters and who assigned them', '10'],
  ['10b', 'Inclusion of individuals', 'Describe how individuals came to be included in clusters, such as by complete enumeration or sampling', '10'],
  ['10c', 'Consent', 'Say from whom consent was sought and whether before or after randomisation', '10'],
  ['12a', 'Accounting for clustering', 'Describe how the analysis took clustering into account', '12a'],
  ['13a', 'Flow of clusters', 'For each group, give the numbers of clusters as well as participants at each stage', '13a'],
  ['13b', 'Losses of clusters', 'For each group, report losses and exclusions of both clusters and participants, with reasons', '13b'],
  ['15', 'Baseline by level', 'Give baseline characteristics at the individual level and, where relevant, the cluster level', '15'],
  ['16', 'Clusters analysed', 'For each group, give the number of clusters included in each analysis', '16'],
  ['17a', 'Results by level', 'Give results at the cluster or individual level as relevant, with the intracluster correlation for each primary outcome', '17a'],
  ['21', 'Generalisability', 'Discuss how far the findings apply to clusters, to individuals or to both', '21'],
];

// CONSORT extension for non-inferiority and equivalence trials (Piaggio et al. 2012), on CONSORT 2010.
const CONSORT_NONINFERIORITY = [
  ['1a', 'Title', 'Identify the trial as non-inferiority or equivalence in the title', '1a'],
  ['2a', 'Rationale for the design', 'Explain why a non-inferiority or equivalence design was chosen', '2a'],
  ['2b', 'Hypotheses and margin', 'State the non-inferiority or equivalence hypothesis, naming the margin and why it was chosen', '2b'],
  ['4a', 'Similarity of participants', 'Say whether participants resemble those in the trials that showed the reference treatment works', '4a'],
  ['5', 'Similarity of reference treatment', 'Say whether the reference treatment matches the one shown to work in earlier trials', '5'],
  ['6a', 'Similarity of outcomes', 'Say whether the outcomes match those of the trials that showed the reference treatment works', '6a'],
  ['7a', 'Sample size from the margin', 'Explain whether the sample size was calculated for a non-inferiority or equivalence margin', '7a'],
  ['12a', 'Confidence interval approach', 'Say whether a one-sided or two-sided confidence interval was used', '12a'],
  ['17a', 'Results against the margin', 'For outcomes tested for non-inferiority or equivalence, show the intervals against the margin, ideally in a figure', '17a'],
  ['22', 'Interpretation against the hypothesis', 'Interpret the results with the non-inferiority or equivalence hypothesis in mind', '22'],
];

// CONSORT extension for randomised pilot and feasibility trials (Eldridge et al. 2016), on CONSORT 2010.
const CONSORT_PILOT = [
  ['1a', 'Title', 'Identify the study as a randomised pilot or feasibility trial in the title', '1a'],
  ['2a', 'Rationale for the pilot', 'Give the background for the future definitive trial and the reasons for piloting it', '2a'],
  ['2b', 'Pilot objectives', 'State the objectives or research questions of the pilot', '2b'],
  ['3a', 'Pilot design', 'Describe the design of the pilot, including its allocation ratio', '3a'],
  ['4c', 'Identification and consent', 'Describe how participants were identified and how their consent was obtained', '4b'],
  ['6a', 'Pilot assessments', 'Define the prespecified assessments or measurements that address each pilot objective', '6a'],
  ['6c', 'Progression criteria', 'Give any criteria used to decide whether or how to go on to the definitive trial', '6b'],
  ['7a', 'Rationale for numbers', 'Explain why the pilot included the number of participants it did', '7a'],
  ['12', 'Methods for pilot objectives', 'Give the qualitative or quantitative methods used to address each pilot objective', '12a'],
  ['13a', 'Pilot flow', 'For each group, give the numbers approached, assessed, randomised, treated and assessed for each objective', '13a'],
  ['17', 'Results for pilot objectives', 'For each objective, report the results, with any estimate of uncertainty, per group where relevant', '17a'],
  ['19a', 'Unintended consequences', 'Report any other important unintended consequences of the trial', '19'],
  ['22a', 'Implications for progression', 'Discuss what the pilot means for going on to a definitive trial, including any changes needed', '22'],
  ['24', 'Pilot protocol', 'Say where the pilot protocol can be read', '24'],
  ['26', 'Ethical approval', 'Name the ethics committee that approved the pilot and give the reference number', '25'],
];

// CONSORT extension for harms (Ioannidis et al. 2004). Its ten
// recommendations are numbered 1 to 10; the fourth element is the CONSORT
// 2010 item each recommendation sits against.
const CONSORT_HARMS = [
  ['1', 'Title and abstract', 'Mention harms in the title or abstract if the trial collected data on them', '1a'],
  ['2', 'Introduction', 'Say in the introduction whether the trial addresses both benefits and harms', '2b'],
  ['3', 'Defining harms', 'Define the adverse events recorded, with any grading or classification used', '6a'],
  ['4', 'Collecting harms', 'Describe how, when and by whom information on harms was collected', '6a'],
  ['5', 'Analysing harms', 'Describe the plans for presenting and analysing harms, including handling of recurrent events', '12a'],
  ['6', 'Withdrawals for harms', 'For each group, report withdrawals due to harms and the experience of those who withdrew', '13b'],
  ['7', 'Denominators', 'Give the denominators used for analyses of harms', '16'],
  ['8', 'Harms per group', 'For each group, present the absolute risk of each adverse event by type, grade and seriousness', '19'],
  ['9', 'Subgroups and exploratory analyses', 'Describe any subgroup or exploratory analyses of harms', '18'],
  ['10', 'Balanced discussion', 'Discuss benefits and harms together, with the limits of the harms data', '22'],
];

// CONSORT PRO extension (Calvert et al. 2013), for patient-reported outcomes, on CONSORT 2010.
const CONSORT_PRO = [
  ['P1b', 'PRO in the abstract', 'Name the patient-reported outcome as primary or secondary in the abstract', '1b'],
  ['P2b', 'PRO hypothesis', 'State the hypothesis for the patient-reported outcome and the domains that matter', '2b'],
  ['P6a', 'PRO instrument validity', 'Give or cite evidence that the instrument is valid and reliable', '6a'],
  ['P6b', 'PRO administration', 'Say who completed the instrument and how it was administered', '6a'],
  ['P12a', 'PRO missing data', 'Describe the statistical approaches for dealing with missing patient-reported data', '12a'],
  ['P20', 'PRO limitations and generalisability', 'Discuss limitations specific to the patient-reported outcome and what it means for generalisability and practice', '20'],
];

// CONSORT-AI (Liu et al. 2020), for trials of interventions with an AI component, on CONSORT 2010.
const CONSORT_AI = [
  ['1a,b(i)', 'AI in title or abstract', 'Say in the title or abstract that the intervention involves artificial intelligence or machine learning, naming the model type', '1b'],
  ['1a,b(ii)', 'Intended use', 'State the intended use of the AI intervention in the title or abstract', '1b'],
  ['2a(i)', 'Clinical pathway', 'Explain the intended use of the AI intervention within its clinical pathway, with its purpose and intended users', '2a'],
  ['4a(i)', 'Participant eligibility', 'Give the inclusion and exclusion criteria at the level of participants', '4a'],
  ['4a(ii)', 'Input data eligibility', 'Give the inclusion and exclusion criteria at the level of the input data', '4a'],
  ['4b(i)', 'Integration into the setting', 'Describe how the AI intervention was fitted into the trial setting, including any onsite or offsite needs', '4b'],
  ['5(i)', 'Algorithm version', 'Name the version of the algorithm used', '5'],
  ['5(ii)', 'Input data acquisition', 'Describe how input data were obtained and chosen for the AI intervention', '5'],
  ['5(iii)', 'Poor or missing input', 'Describe how poor quality or unavailable input data were assessed and handled', '5'],
  ['5(iv)', 'Human and AI interaction', 'Say whether people interacted with the input data and what expertise users needed', '5'],
  ['5(v)', 'AI output', 'Specify what the AI intervention produced as output', '5'],
  ['5(vi)', 'Use of the output', 'Explain how the output fed into decisions or other parts of clinical practice', '5'],
  ['19(i)', 'Performance errors', 'Report any analysis of performance errors and how errors were identified', '19'],
  ['25(i)', 'Access to the AI', 'Say whether and how the AI intervention or its code can be obtained, with any restrictions', '25'],
];

// SPIRIT-AI (Cruz Rivera et al. 2020), for protocols of trials with an AI component, on SPIRIT 2013.
const SPIRIT_AI = [
  ['1(i)', 'AI in the title', 'Say in the title or abstract that the intervention involves artificial intelligence or machine learning, naming the model type', '1'],
  ['1(ii)', 'Intended use', 'State the intended use of the AI intervention', '1'],
  ['6a(i)', 'Clinical pathway', 'Explain the intended use of the AI intervention within its clinical pathway, with its purpose and intended users', '6a'],
  ['6a(ii)', 'Prior evidence', 'Describe the existing evidence for the AI intervention, citing earlier development or validation', '6a'],
  ['9(i)', 'Integration into the setting', 'Describe how the AI intervention will be fitted into the trial setting, including any onsite or offsite needs', '9'],
  ['10(i)', 'Participant eligibility', 'Give the inclusion and exclusion criteria at the level of participants', '10'],
  ['10(ii)', 'Input data eligibility', 'Give the inclusion and exclusion criteria at the level of the input data', '10'],
  ['11a(i)', 'Algorithm version', 'Name the version of the algorithm to be used', '11a'],
  ['11a(ii)', 'Input data acquisition', 'Describe how input data will be obtained and chosen', '11a'],
  ['11a(iii)', 'Poor or missing input', 'Describe how poor quality or unavailable input data will be assessed and handled', '11a'],
  ['11a(iv)', 'Human and AI interaction', 'Say whether people will interact with the input data and what expertise users need', '11a'],
  ['11a(v)', 'AI output', 'Specify what the AI intervention will produce as output', '11a'],
  ['11a(vi)', 'Use of the output', 'Explain how the output will feed into decisions or other parts of clinical practice', '11a'],
  ['22(i)', 'Performance errors', 'Describe any plans to identify and analyse performance errors, or explain why there are none', '22'],
  ['29(i)', 'Access to the AI', 'Say whether and how the AI intervention or its code can be obtained, with any restrictions', '29'],
];

// RECORD (Benchimol et al. 2015), for studies using routinely collected health
// data, on STROBE.
const RECORD = [
  ['1.1', 'Type of data', 'Name the type of data used, and the databases where possible, in the title or abstract', '1a'],
  ['1.2', 'Region and time frame', 'Give the geographic region and time frame of the study in the title or abstract', '1a'],
  ['1.3', 'Linkage in the abstract', 'If databases were linked, say so in the title or abstract', '1a'],
  ['6.1', 'Selecting the population', 'Describe how the study population was selected, such as the codes or algorithms used', '6a'],
  ['6.2', 'Validating the selection', 'Cite any validation of the codes or algorithms used to select the population, or explain their absence', '6a'],
  ['6.3', 'Linkage flow', 'If data were linked, show the linkage and the numbers at each stage, ideally in a diagram', '6a'],
  ['7.1', 'Codes and algorithms', 'Give a full list of the codes and algorithms used to classify exposures, outcomes, confounders and effect modifiers', '7'],
  ['12.1', 'Database access', 'Say how far the investigators could reach the database population used to build the study population', '12a'],
  ['12.2', 'Data cleaning', 'Describe any data cleaning methods used', '12a'],
  ['12.3', 'Linkage methods', 'Say whether and how databases were linked across individuals, institutions or other units, and how well', '12a'],
  ['13.1', 'Selection in detail', 'Describe the selection of people in the study population in detail, ideally in a flow diagram', '13a'],
  ['19.1', 'Data not made for the question', 'Discuss what follows from using data not collected for this question, such as misclassification and unmeasured confounding', '19'],
  ['22.1', 'Supplementary access', 'Say how to obtain any protocol, raw data or code', '22'],
];

// PRISMA-S (Rethlefsen et al. 2021), for reporting literature searches: 16
// items, placed against PRISMA 2020's sources (6), search (7) and flow (16a).
const PRISMA_S = [
  ['1', 'Database name', 'Name each database searched, with the platform used for it', '6'],
  ['2', 'Multi-database searching', 'If databases were searched together on one platform, name the platform and each database', '6'],
  ['3', 'Study registries', 'List any study registries searched', '6'],
  ['4', 'Online resources and browsing', 'Describe online or print sources searched or browsed, such as websites, journals or conference proceedings', '6'],
  ['5', 'Citation searching', 'Say whether references or citations of included studies were followed up', '6'],
  ['6', 'Contacts', 'Say whether authors, experts or manufacturers were contacted to find more studies', '6'],
  ['7', 'Other methods', 'Describe any other search methods used', '6'],
  ['8', 'Full search strategies', 'Give each search strategy exactly as run, for every source', '7'],
  ['9', 'Limits and restrictions', 'State any limits such as date or language and justify them', '7'],
  ['10', 'Search filters', 'Say whether published search filters were used and cite them, noting any changes', '7'],
  ['11', 'Prior work', 'Say whether earlier search strategies were reused or adapted, and cite them', '7'],
  ['12', 'Updates', 'Describe any update searches and how they were run', '7'],
  ['13', 'Dates of searches', 'Give when each search was last run for every source', '6'],
  ['14', 'Peer review', 'Describe any peer review of the search strategy', '7'],
  ['15', 'Total records', 'Give the total number of records found in each source before deduplication', '16a'],
  ['16', 'Deduplication', 'Describe how duplicate records were removed, including any software used', '7'],
];

// PRISMA-IPD (Stewart et al. 2015), for reviews of individual participant
// data: its three added items A1 to A3, placed against PRISMA 2020.
const PRISMA_IPD = [
  ['A1', 'IPD integrity', 'Describe how the individual participant data were checked, such as for sequence generation, data consistency and completeness', '9'],
  ['A2', 'Exploring variation in effects', 'Describe the methods used to explore how effects vary by study or participant characteristics', '13e'],
  ['A3', 'IPD integrity results', 'Report any important issues found when checking the individual participant data, or state that none were found', '17'],
];

// ---- add-ons ---------------------------------------------------------------

// TIDieR (Hoffmann et al. 2014), for describing an intervention: 12 items.
const TIDIER = [
  ['1', 'Brief name', 'Give a name or phrase that describes the intervention'],
  ['2', 'Why', 'Describe the rationale, theory or goal behind the essential elements of the intervention'],
  ['3', 'What: materials', 'Describe any physical or informational materials used and where they can be obtained'],
  ['4', 'What: procedures', 'Describe each procedure, activity or process used, including enabling or support activities'],
  ['5', 'Who provided', 'Describe each type of provider, with their expertise, background and any training given'],
  ['6', 'How', 'Describe how the intervention was delivered, such as face to face or online, and to individuals or groups'],
  ['7', 'Where', 'Describe the places where the intervention took place, with any infrastructure or features needed'],
  ['8', 'When and how much', 'Give the number of sessions, their schedule, length, intensity or dose over what period'],
  ['9', 'Tailoring', 'If the intervention was meant to be personalised or adapted, describe what, why, when and how'],
  ['10', 'Modifications', 'If the intervention changed during the study, describe what, why, when and how'],
  ['11', 'How well: planned', 'If adherence or fidelity was assessed, describe how and by whom, with any strategies to maintain it'],
  ['12', 'How well: actual', 'If adherence or fidelity was assessed, describe how far the intervention was delivered as planned'],
];

// GRIPP2 short form (Staniszewska et al. 2017), for patient and public involvement: 5 items.
const GRIPP2_SF = [
  ['1', 'Aim', 'Report the aim of patient and public involvement in the study'],
  ['2', 'Methods', 'Describe the methods used for patient and public involvement'],
  ['3', 'Results', 'Report what the involvement changed or contributed, positive and negative'],
  ['4', 'Discussion and conclusions', 'Comment on how far involvement influenced the study overall, positively and negatively'],
  ['5', 'Reflections', 'Reflect critically on what went well and what did not, so others can learn from it'],
];

const EQUATOR = slug => `https://www.equator-network.org/reporting-guidelines/${slug}/`;

/** The further checklists by id, with the state key each keeps in the project. */
export const EXTRA_CHECKLISTS = {
  'consort-2025': { id: 'consort-2025', name: 'CONSORT 2025', year: 2025, kind: 'main', extends: null, items: CONSORT_2025, key: 'checklistConsort2025', review: 'randomised trial', source: { url: EQUATOR('consort') } },
  'tripod-ai': { id: 'tripod-ai', name: 'TRIPOD+AI', year: 2024, kind: 'main', extends: null, items: TRIPOD_AI, key: 'checklistTripodAi', review: 'prediction model study', source: { url: null } },
  coreq: { id: 'coreq', name: 'COREQ', year: 2007, kind: 'main', extends: null, items: COREQ, key: 'checklistCoreq', review: 'qualitative study', source: { url: EQUATOR('coreq') } },
  emerge: { id: 'emerge', name: 'eMERGe', year: 2019, kind: 'main', extends: null, items: EMERGE, key: 'checklistEmerge', review: 'meta-ethnography', source: { url: null } },
  trend: { id: 'trend', name: 'TREND', year: 2004, kind: 'main', extends: null, items: TREND, key: 'checklistTrend', review: 'non-randomised intervention evaluation', source: { url: null } },

  'spirit-2013': { id: 'spirit-2013', name: 'SPIRIT 2013', year: 2013, kind: 'protocol', extends: null, items: SPIRIT_2013, key: 'checklistSpirit2013', review: 'trial protocol', source: { url: EQUATOR('spirit-2013-statement-defining-standard-protocol-items-for-clinical-trials') } },
  'prisma-p': { id: 'prisma-p', name: 'PRISMA-P 2015', year: 2015, kind: 'protocol', extends: null, items: PRISMA_P, key: 'checklistPrismaP', review: 'systematic review protocol', source: { url: null } },

  'consort-abstract': { id: 'consort-abstract', name: 'CONSORT for Abstracts', year: 2008, kind: 'abstract', extends: 'consort', items: CONSORT_ABSTRACT, key: 'checklistConsortAbstract', review: 'trial abstract', source: { url: null } },
  'prisma-abstract': { id: 'prisma-abstract', name: 'PRISMA 2020 for Abstracts', year: 2021, kind: 'abstract', extends: 'prisma-2020', items: PRISMA_ABSTRACT, key: 'checklistPrismaAbstract', review: 'systematic review abstract', source: { url: null } },

  'consort-cluster': { id: 'consort-cluster', name: 'CONSORT Cluster', prefix: 'cluster', year: 2012, kind: 'extension', extends: 'consort', items: CONSORT_CLUSTER, key: 'checklistConsortCluster', review: 'cluster randomised trial', source: { url: null } },
  'consort-noninferiority': { id: 'consort-noninferiority', name: 'CONSORT Non-inferiority', prefix: 'ni', year: 2012, kind: 'extension', extends: 'consort', items: CONSORT_NONINFERIORITY, key: 'checklistConsortNi', review: 'non-inferiority or equivalence trial', source: { url: null } },
  'consort-pilot': { id: 'consort-pilot', name: 'CONSORT Pilot and feasibility', prefix: 'pilot', year: 2016, kind: 'extension', extends: 'consort', items: CONSORT_PILOT, key: 'checklistConsortPilot', review: 'pilot or feasibility trial', source: { url: null } },
  'consort-harms': { id: 'consort-harms', name: 'CONSORT Harms 2004', prefix: 'harms', year: 2004, kind: 'extension', extends: 'consort', items: CONSORT_HARMS, key: 'checklistConsortHarms', review: 'trial reporting harms', source: { url: null } },
  'consort-pro': { id: 'consort-pro', name: 'CONSORT PRO', prefix: 'pro', year: 2013, kind: 'extension', extends: 'consort', items: CONSORT_PRO, key: 'checklistConsortPro', review: 'trial with patient-reported outcomes', source: { url: null } },
  'consort-ai': { id: 'consort-ai', name: 'CONSORT-AI', prefix: 'consort-ai', year: 2020, kind: 'extension', extends: 'consort', items: CONSORT_AI, key: 'checklistConsortAi', review: 'trial of an AI intervention', source: { url: null } },
  'spirit-ai': { id: 'spirit-ai', name: 'SPIRIT-AI', prefix: 'spirit-ai', year: 2020, kind: 'extension', extends: 'spirit-2013', items: SPIRIT_AI, key: 'checklistSpiritAi', review: 'protocol of a trial of an AI intervention', source: { url: null } },
  record: { id: 'record', name: 'RECORD', prefix: 'record', year: 2015, kind: 'extension', extends: 'strobe', items: RECORD, key: 'checklistRecord', review: 'study of routinely collected data', source: { url: null } },
  'prisma-s': { id: 'prisma-s', name: 'PRISMA-S', prefix: 'prisma-s', year: 2021, kind: 'extension', extends: 'prisma-2020', items: PRISMA_S, key: 'checklistPrismaS', review: 'literature search', source: { url: null } },
  'prisma-ipd': { id: 'prisma-ipd', name: 'PRISMA-IPD', prefix: 'ipd', year: 2015, kind: 'extension', extends: 'prisma-2020', items: PRISMA_IPD, key: 'checklistPrismaIpd', review: 'individual participant data review', source: { url: null } },

  tidier: { id: 'tidier', name: 'TIDieR', prefix: 'tidier', year: 2014, kind: 'addon', extends: null, items: TIDIER, key: 'checklistTidier', review: 'intervention description', source: { url: null } },
  'gripp2-sf': { id: 'gripp2-sf', name: 'GRIPP2 short form', prefix: 'gripp2', year: 2017, kind: 'addon', extends: null, items: GRIPP2_SF, key: 'checklistGripp2', review: 'patient and public involvement', source: { url: null } },
};

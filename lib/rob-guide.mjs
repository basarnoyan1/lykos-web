// What each appraisal question and answer means (owner, 25 Oct 2026: "a place for me to see and remember for the appraisal results what does
// that question and that answer mean"). Our own short paraphrases of the official guidance, never its text (the tools are CC BY-NC-ND; read the
// official forms for the wording): ROBINS-I V2 draft of 20 November 2025 (Domain 1 variant A, the intention-to-treat effect), RoB 2 of 22 August
// 2019, and the JBI checklist for case series (2020). Checked twice against those documents (the ASD project's Evidence table/tools/rob_guidance).
// The person's own note on an item is kept in the project (robGuideNotes), so it is there on every study and for every reviewer.

import { ruleText } from './rob-overall.mjs';

// The answer codes as the guidance uses them, in general; an item's own `codes` say what a code means for that question.
export const ANSWER_MEANING = {
  Y: 'Firm evidence in the report.',
  PY: 'A judgement, not stated outright; counts the same as Yes.',
  PN: 'A judgement, not stated outright; counts the same as No.',
  N: 'Firm evidence in the report.',
  NI: 'Too little reported even for a probable answer. If the question looks for a problem, this counts as no sign of it; if it asks for something a report should give, it raises concern.',
  NA: 'Not asked: it follows only a certain answer to an earlier question.',
  WY: 'Yes, but the problem is limited.',
  SY: 'Yes, and the problem is large.',
  WN: 'No, but what is missing probably does not bias the result much.',
  SN: 'No, and what is missing probably biases the result substantially.',
};

const ROBINS_V2_LEVELS = {
  'Low (except for concerns about uncontrolled confounding)': 'Domain 1 only: confounding is very well handled, but in an observational study it can never be ruled out.',
  Low: 'Little or no concern about bias in this domain.',
  Moderate: 'Some concern, though it is not clear the bias is important.',
  Serious: 'Important problems in this domain give a serious risk of bias.',
  Critical: 'The study is very problematic in this domain; such a result should generally be left out of syntheses.',
  'Not assessed': 'Not appraised for this result.',
};
const ROB2_LEVELS = {
  Low: 'Low risk of bias in this domain.',
  'Some concerns': 'Some concerns in this domain; any domain with some concerns makes the result at least some concerns overall.',
  High: 'High risk of bias; one high domain makes the result high overall.',
  'No information': 'Not enough reported to judge.',
};
const JBI_LEVELS = {
  Yes: 'The report shows the item is met.',
  No: 'The report shows the item is not met; JBI notes any No weakens the case series.',
  Unclear: 'The report does not say enough to tell. (JBI gives no rule of its own for Unclear; this is the common reading.)',
  'Not applicable': 'The item does not apply to this study. (JBI gives no rule of its own; this is the common reading.)',
};

const YN = ['Y', 'PY', 'PN', 'N', 'NI'];
const YNA = ['NA', 'Y', 'PY', 'PN', 'N', 'NI'];

// ROBINS-I V2, the project's question ids (1-1, 2-3 …) under the domain ids d1–d6
const ROBINS_V2 = {
  d1: { asks: 'Whether the groups differ in prognostic factors that also decided who got which treatment, and whether the analysis dealt with them (by design, stratification, regression, matching, weighting).',
    look: 'Start from the review’s list of important confounders, then what this study measured and adjusted for. The answers come from that evaluation.' },
  'd1.1-1': { asks: 'Did the authors control for all the important confounders that needed controlling?',
    options: ['Y', 'PY', 'WN', 'SN', 'NI'],
    look: 'Yes if every important confounder that needed control was controlled appropriately (or, very rarely, there are none and the result is unadjusted).',
    codes: { WN: 'Most were controlled and what was left out probably does not matter much (for example it is closely tied to something adjusted for).', SN: 'At least one important confounder that should have been controlled was not, and that probably changes the result materially.' } },
  'd1.1-2': { asks: 'Were the confounders that were controlled measured validly and reliably?', when: 'Asked if Y, PY or WN to 1.1.',
    options: ['NA', 'Y', 'PY', 'WN', 'SN', 'NI'],
    look: 'Adjustment only helps if the variables really capture the confounder; with no word on validity, judge how subjective the measure is.',
    codes: { WN: 'Not fully, but measurement error in the confounders is probably small.', SN: 'No, and measurement error in the confounders is probably substantial.' } },
  'd1.1-3': { asks: 'Did the authors adjust for anything measured after the treatment started that the treatment could have changed?', when: 'Asked if Y, PY or WN to 1.1.',
    options: YNA, look: 'Adjusting for a mediator or for a common effect of treatment and outcome (over-adjustment) biases the result, so Yes here is a problem.' },
  'd1.1-4': { asks: 'Do negative controls, a bias analysis or other considerations suggest serious confounding left over?',
    options: ['Y', 'PY', 'PN', 'N'], look: 'No if the study used no negative controls and nothing else points to leftover confounding. Yes only when such evidence shows the result is materially confounded.' },
  d2: { asks: 'Whether people were put in the right treatment group, including timing problems that create immortal time (time in which the outcome cannot happen because of how groups were defined).',
    look: 'The first three questions are about whether the strategies could be told apart at the start of follow-up; the last two about misclassification related, or unrelated, to the outcome.' },
  'd2.2-1': { asks: 'Could the treatment strategies be told apart at the moment follow-up would have started in the target trial?',
    options: YN, look: 'No when group membership depends on what happens later (for example surgery within 6 months): one group then has time in which the outcome cannot occur.' },
  'd2.2-2': { asks: 'Did all or nearly all outcome events happen after the strategies could be told apart?', when: 'Asked if N, PN or NI to 2.1.',
    options: YNA, look: 'If the period of uncertainty is short against the whole follow-up, few events fall in it and the bias stays small.' },
  'd2.2-3': { asks: 'Did the analysis avoid the problem of strategies that cannot be told apart at the start?', when: 'Asked if N, PN or NI to 2.2.',
    options: ['NA', 'SY', 'WY', 'PN', 'N', 'NI'], look: 'Methods such as clone–censor–weight or the g-formula, or a landmark analysis, can avoid it.',
    codes: { SY: 'Yes, fully: the predictors of treatment during follow-up were measured and used properly, or a landmark analysis started follow-up after the groups could be told apart.', WY: 'Yes, partly: a suitable method was used but probably did not fully adjust for what predicts treatment later.' } },
  'd2.2-4': { asks: 'Was the group a person was put in influenced by knowing their outcome or their risk of it?',
    options: ['SY', 'WY', 'PN', 'N', 'NI'], look: 'Likely when group was decided from information gathered after follow-up began (recall, records lost when someone died); unlikely when it came from records made at or before the start.',
    codes: { SY: 'Yes, and the effect on classification was probably substantial.', WY: 'Yes, but the effect was probably not substantial.' } },
  'd2.2-5': { asks: 'Were other classification errors, unrelated to the outcome, likely?',
    options: YN, look: 'Treatment missing from the records, or poorly defined treatments. Correct classification for about 95% of people is often enough. Such errors usually pull the result toward no effect.' },
  d3: { asks: 'Whether the people, follow-up time or events in the analysis were chosen in a way tied to both the treatment and the outcome (selection bias), as opposed to missing data, which is Domain 4.',
    look: 'Part A: follow-up starting late (prevalent users) and immortal time. Part B: other selection on things seen after treatment began. Part C: whether the analysis corrected it and how severe it is.' },
  'd3.3-1': { asks: 'Did follow-up in the analysis begin when the compared strategies began?',
    options: ['Y', 'PY', 'WN', 'SN', 'NI'], look: 'Yes if all events and follow-up time after the start of both strategies are in the analysis. Starting later (a landmark analysis, prevalent users) loses the early events.',
    codes: { WN: 'No, but the bias from the late start is probably small.', SN: 'No, and the bias is probably substantial: the effect likely differs between the left-out and kept follow-up, or much of the early follow-up or events was left out. (The draft’s explanation writes “SY” at this point; with the options offered it can only mean SN.)' } },
  'd3.3-2': { asks: 'Were outcome events in some period after treatment started left out of the analysis?', when: 'Asked if Y or PY to 3.1.',
    options: YN, look: 'A period in which outcomes were not looked for, or events were dropped, is immortal time; Yes here is a problem.' },
  'd3.3-3': { asks: 'Was entry into the study or the analysis decided by characteristics seen after treatment started (beyond 3.1 and 3.2)?',
    options: YN, look: 'No if selection used only things known before treatment (those are a confounding matter). Not about exclusion for missing data.' },
  'd3.3-4': { asks: 'Were those post-treatment selection variables related to, or caused by, the treatment?', when: 'Asked if Y or PY to 3.3.',
    options: YNA, look: 'Selection bias needs selection to be linked to both treatment and outcome; this is the treatment half.' },
  'd3.3-5': { asks: 'Were those selection variables influenced by the outcome or by a cause of it?', when: 'Asked if Y or PY to 3.4.',
    options: YNA, look: 'The outcome half: Yes here, after Yes to 3.4, means selection was tied to both.' },
  'd3.3-6': { asks: 'Did the analysis probably correct for all the selection biases found above?', when: 'Asked if SN to 3.1 or Y/PY to 3.5.',
    options: YNA, look: 'Yes only if a proper method (for example inverse-probability weights, modelling missing follow-up) was used and its assumptions are believable. Impossible when the follow-up data simply do not exist.' },
  'd3.3-7': { asks: 'Did sensitivity analyses show the likely effect of those selection biases was small?', when: 'Asked if N, PN or NI to 3.6.', options: YNA },
  'd3.3-8': { asks: 'Were the selection biases so severe that the result should not go into a quantitative synthesis?', when: 'Asked if N, PN or NI to 3.7.',
    options: YNA, look: 'Separates Serious from Critical. Answer N, PN or NI unless there is clear evidence the bias was severe.' },
  d4: { asks: 'Bias from data missing on the treatment, the outcome or the confounders, judged against an analysis with all the data intended.',
    look: 'No single acceptable percentage exists. The questions follow the kind of analysis: complete cases, imputation, or another method, then whether there is evidence the result was not biased.' },
  'd4.4-1': { asks: 'Were data on the treatment received complete for all or nearly all participants?',
    options: YN, look: '“Nearly all”: so few left out that it could not matter. Imputed values count as missing. NI only when the report says nothing about missing data, which usually means high risk.' },
  'd4.4-2': { asks: 'Were outcome data complete for all or nearly all participants?',
    options: YN, look: 'For continuous outcomes about 95% (perhaps 90%) is often enough; for events, compare the number missing with the number of events. Imputed values count as missing.' },
  'd4.4-3': { asks: 'Were data on the important confounders complete for all or nearly all participants?', options: YN, look: 'As 4.1 and 4.2, for the confounders.' },
  'd4.4-4': { asks: 'Is the result from a complete-case analysis (only people with all the data)?', when: 'Asked if N, PN or NI to 4.1, 4.2 or 4.3.', options: YNA },
  'd4.4-5': { asks: 'Was leaving people out for missing data probably related to their true outcome?', when: 'Asked if Y, PY or NI to 4.4.',
    options: YNA, look: 'Yes when the share missing differs by group, reasons for missing point to the outcome, or the setting makes it likely (sicker people miss visits). No when people were lost for documented reasons unrelated to the outcome.' },
  'd4.4-6': { asks: 'Do the variables in the analysis model explain the link between the outcome and being missing?', when: 'Asked if Y, PY or NI to 4.5.',
    options: ['NA', 'Y', 'PY', 'WN', 'SN', 'NI'], look: 'If every variable that plausibly explains why data are missing is in the complete-case model, the bias is low.',
    codes: { WN: 'No, but this probably does not lead to substantial bias.', SN: 'No, and the bias is probably substantial.' } },
  'd4.4-7': { asks: 'Was the analysis based on imputing the missing values (single or multiple imputation)?', when: 'Asked if N or PN to 4.4.', options: ['NA', 'Y', 'PY', 'PN', 'NI'] },
  'd4.4-8': { asks: 'Is it reasonable to think the data were missing at random (MAR) or completely at random (MCAR)?', when: 'Asked if Y or PY to 4.7.',
    options: YNA, look: 'MCAR: missing for reasons unrelated to anything. MAR: differences explained by observed data. Answer N or PN only if there is reason to think they are missing not at random; otherwise Y or PY.' },
  'd4.4-9': { asks: 'Was the imputation done properly?', when: 'Asked if Y or PY to 4.8.',
    options: ['NA', 'Y', 'PY', 'WN', 'SN', 'NI'], look: 'Yes for multiple imputation that included all predictors of missingness and all variables of the main analysis. Simple methods (last observation carried forward, a mean) get WN or SN.',
    codes: { WN: 'No, but this probably does not lead to substantial bias.', SN: 'No, and the bias would not be substantially reduced.' } },
  'd4.4-10': { asks: 'Was another suitable method used to correct for missing data (for example inverse-probability weighting, full-information maximum likelihood)?', when: 'Asked if N, PN or NI to 4.7.',
    options: ['NA', 'Y', 'PY', 'WN', 'SN', 'NI'], look: 'Weighting is only valid if the weighting model is right; a statistician may be needed.',
    codes: { WN: 'No, but this probably does not lead to substantial bias.', SN: 'No, and the bias would not be substantially reduced.' } },
  'd4.4-11': { asks: 'Is there evidence the result was not biased by the missing data?', when: 'Asked when data were incomplete and the analysis above did not settle it (PN/N/NI to 4.1–4.3 and Y/PY/NI to 4.5, or WN/SN/NI to 4.9 or 4.10).',
    options: ['NA', 'Y', 'PY', 'PN', 'N'], look: 'Evidence: methods that stay unbiased under plausible missingness, or sensitivity analyses that barely move the result. Agreement with a simple imputation or a weighting is not reassurance by itself.' },
  d5: { asks: 'Whether the outcome was measured or found differently depending on the treatment (detection bias).',
    look: 'Error unrelated to treatment costs precision but not bias; error related to treatment biases the result. Awareness of treatment matters most for subjective outcomes.' },
  'd5.5-1': { asks: 'Could the measurement or detection of the outcome have differed between the groups?',
    options: YN, look: 'Comparable means the same methods and thresholds at comparable times. Extra visits in one group give more chances to find events.' },
  'd5.5-2': { asks: 'Did the outcome assessors know which treatment each person received?',
    options: YN, look: 'No if assessors were blinded, or simply unaware. When patients rate their own outcome (pain, questionnaires) they are the assessor, and in observational studies this is usually Yes.' },
  'd5.5-3': { asks: 'Could knowing the treatment have influenced how the outcome was assessed?', when: 'Asked if Y, PY or NI to 5.2.',
    options: ['NA', 'SY', 'WY', 'PN', 'N', 'NI'], look: 'Possible for patient-reported outcomes, observer outcomes needing judgement and outcomes that are a clinician’s decision; unlikely for death or laboratory values.',
    codes: { SY: 'Yes, to a large extent: knowledge was likely to sway the assessment (strong belief in or preference for a treatment).', WY: 'Yes, to a small extent: it could have, but there is no reason to think it did.' } },
  d6: { asks: 'Whether the result was picked from several measurements, analyses or subgroups because of what it showed.',
    look: 'The best evidence against selection is a pre-specified, public analysis plan that matches the report; such plans are rare for non-randomized studies, so a low judgement is uncommon. Without one, compare the Methods with the Results.' },
  'd6.6-1': { asks: 'Was the result reported as a pre-specified analysis plan said it would be?',
    options: YN, look: 'The plan must be detailed and fixed before the authors saw the outcome data.' },
  'd6.6-2': { asks: 'Was the result probably chosen, on the basis of what it showed, from several measurements of the outcome (scales, definitions, time points)?',
    options: YN, look: 'Y/PY: clear evidence (usually a protocol) that it was measured several ways but only some are reported, unjustified. N/PN: everything intended is reported, or there is only one way to measure it. NI: no plan available and more than one way was possible.' },
  'd6.6-3': { asks: 'Was the result probably chosen from several analyses of the data (adjusted or not, change or final value, cut-points, covariate sets, missing-data methods)?',
    options: YN, look: 'As 6.2, for analyses: Y/PY with clear evidence of several analyses and selective reporting; N/PN when all intended analyses are reported or only one was possible; NI when the intentions are unknown.' },
  'd6.6-4': { asks: 'Was the result probably chosen from several subgroups (or from a cohort trimmed in different ways)?',
    options: YN, look: 'As 6.2, for subgroups; an unusually defined subgroup can be a sign of selection.' },
  overall: { asks: 'The risk of bias of the result as a whole.',
    look: 'By default the worst domain. Several Moderate domains can add up to Serious, and several Serious ones to Critical; overriding the default needs a stated reason.' },
};

// RoB 2 (one randomised trial in the ASD review): the app keeps its five domains, not the signalling questions
const ROB2 = {
  d1: { asks: 'Bias from how people were randomised: was the sequence random, was it concealed until assignment, and do baseline differences suggest a problem?' },
  d2: { asks: 'Bias from deviations from the intended treatment: did people or carers know the assignment, did that lead to deviations, and was a suitable analysis (for example intention-to-treat) used?' },
  d3: { asks: 'Bias from missing outcome data: were outcomes available for nearly all randomised people, and if not, could missingness depend on the true outcome?' },
  d4: { asks: 'Bias in measuring the outcome: was the method suitable and the same in both groups, did assessors know the treatment, and could that have swayed the result?' },
  d5: { asks: 'Bias in selecting the reported result: was it analysed as pre-specified, or picked from several measurements or analyses?' },
  overall: { asks: 'The result as a whole: Low only if every domain is Low; High if any domain is High, or several have some concerns that together lower confidence substantially.' },
};

// JBI case series (2020), items q1–q10
const JBI_SERIES = {
  q1: { asks: 'Were there clear criteria for who was included in the series?', look: 'Inclusion (and where relevant exclusion) criteria stated in enough detail, such as disease stage or risk level.' },
  q2: { asks: 'Was the condition measured in a standard, reliable way for all participants?', look: 'The method is described, applied the same way to everyone, and repeatable.' },
  q3: { asks: 'Were valid methods used to identify the condition in all participants?', look: 'Accepted definitions or diagnostic criteria point to Yes; observer- or self-reported scales risk over- or under-reporting; check that the tools are validated.' },
  q4: { asks: 'Were participants included consecutively?', look: 'For example: all patients seen at the clinic over a stated period, rather than just a number of cases.' },
  q5: { asks: 'Was inclusion complete?', look: 'All eligible patients over a defined period were included, rather than a count with no account of who was left out.' },
  q6: { asks: 'Were the participants’ demographics clearly reported?', look: 'Age, sex, education, region, ethnicity, time period, as relevant.' },
  q7: { asks: 'Was the participants’ clinical information clearly reported?', look: 'Disease status and stage, comorbidities, earlier treatments, test results.' },
  q8: { asks: 'Were the outcomes or follow-up results clearly reported?', look: 'The condition after treatment (symptoms present or not), with adverse and unexpected events documented, especially for a new treatment.' },
  q9: { asks: 'Was the demographic information of the presenting site or clinic clearly reported?', look: 'Enough about where the cases came from for others to judge whether they match their own population.' },
  q10: { asks: 'Was the statistical analysis appropriate?', look: 'Whether a better method existed, and whether the methods are described well enough to tell.' },
};

const BY_TOOL = [
  { match: t => t.id === 'robins-i-v2' || t.id === 'custom-robins-i-v2' || /^ROBINS-I V2$/i.test(t.name || ''), items: ROBINS_V2, levels: ROBINS_V2_LEVELS, codes: true,
    source: 'Paraphrased from ROBINS-I V2 (draft of 20 November 2025, Domain 1 variant A). The official form has the exact wording.' },
  { match: t => t.id === 'rob2', items: ROB2, levels: ROB2_LEVELS, source: 'Paraphrased from RoB 2 (22 August 2019). The official tool has the signalling questions.' },
  { match: t => t.id === 'jbi-case-series', items: JBI_SERIES, levels: JBI_LEVELS, source: 'Paraphrased from the JBI checklist for case series (2020).' },
];

const guideOf = tool => tool && BY_TOOL.find(g => g.match(tool));
/** Whether the instrument has meanings here. */
export const hasGuide = tool => !!guideOf(tool);

/** The meaning of one item (a domain id, 'overall', or a question key `d1.1-1`) of an instrument, or null:
 *  { asks, look?, when?, options: [{ code, meaning }], levels?: [{ level, meaning }], source }. `rule` the project's overall rule
 *  (lib/rob-overall.mjs robOverallRule): one that fixes the overall is what the overall's guide says. */
export function itemGuide(tool, key, { question = false, rule = null } = {}) {
  const g = guideOf(tool); if (!g) return null;
  const it = key === 'overall' && rule?.id && rule.id !== 'worst-domain' && g.items.overall
    ? { ...g.items.overall, asks: `The result as a whole, by this project's rule: ${ruleText(rule)}.` } : g.items[key];
  if (!it) return null;
  // a question asked only after some answer to an earlier one can be Not applicable even where the form prints no NA (3.2: asked if Y/PY to 3.1)
  const opts = question ? [...(it.when && !(it.options || []).includes('NA') ? ['NA'] : []), ...(it.options || [])] : [];
  return {
    asks: it.asks, look: it.look || '', when: it.when || '',
    options: opts.map(code => ({ code, meaning: it.codes?.[code] || ANSWER_MEANING[code] || '' })),
    levels: question ? [] : Object.entries(g.levels).filter(([lv]) => !tool.judgements || tool.judgements.includes(lv)).map(([level, meaning]) => ({ level, meaning })),
    source: g.source,
  };
}

// ---- the person's own notes, kept in the project ----
const noteTool = tool => tool.id;
/** The note on an item, or ''. */
export const guideNote = (s, tool, key) => String(s?.robGuideNotes?.[noteTool(tool)]?.[key]?.text || '');
/** Sets (or clears, when empty) the note on an item; returns the state changed in place, as update() expects. */
export function setGuideNote(st, tool, key, text, at = new Date().toISOString()) {
  const t = String(text || '').trim(), id = noteTool(tool);
  st.robGuideNotes ||= {};
  if (!t) { if (st.robGuideNotes[id]) { delete st.robGuideNotes[id][key]; if (!Object.keys(st.robGuideNotes[id]).length) delete st.robGuideNotes[id]; } }
  else (st.robGuideNotes[id] ||= {})[key] = { text: t, at };
  if (!Object.keys(st.robGuideNotes).length) delete st.robGuideNotes;
  return st;
}

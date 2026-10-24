// Registration forms: what a registry asks for, filled from the project.
//
// A registration is a human act on the registry's own site (plan A5). What the
// app can do is lay out the registry's fields, fill what the project already
// knows (the protocol's question and criteria, the paper's authors, the search
// sources, the appraisal tool, the analysis settings), and list what is left.
//
// Registry forms change without notice and nothing here can verify them. Each
// form carries `source: { name, url, checked: null }`: the URL names where the
// form is published, not a page read on a date. A field's `hint` is guidance in
// our own words, and a rule a registry is said to apply (a results deadline, a
// type of review it will not register) is a hint to check, never a fact.
//
// Registration stores nothing new: dates and registry details the app has no
// other home for are read from `state.registration` when present
// ({ registeredAt, firstEnrolmentAt, primaryCompletionAt, countries, sponsor,
// recruitmentStatus, secondaryIds }).
//
// Pure: nothing here imports the store or a view.
import { blankBlock } from './manuscript.mjs';
import { typeById, questionFrameOf } from './research-types.mjs';
import { statements, longDate } from './declarations.mjs';
import { APPRAISAL_TOOLS } from '../schema.mjs';
import { addMonths } from './governance-state.mjs';
export { addMonths };

const unchecked = (name, url) => ({ name, url, checked: null });

// ---- WHO Trial Registration Data Set --------------------------------------------
// The 24 items of the WHO TRDS (version 1.3.1 as we know it). `byRegistry`
// marks what the registry assigns, so it is never on the researcher's list.
// `atRegistration: false` marks items completed later (completion, results).
const WHO_SOURCE = unchecked('WHO Trial Registration Data Set', 'https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set');
export const WHO_TRDS = [
  { id: 'who1', n: 1, label: 'Primary registry and trial identifying number', group: 'Identification', required: true, byRegistry: true, src: 'registrationId', hint: 'Assigned by the registry when the record is accepted.' },
  { id: 'who2', n: 2, label: 'Date of registration in primary registry', group: 'Identification', required: true, byRegistry: true, src: 'registeredAt', hint: 'Assigned by the registry.' },
  { id: 'who3', n: 3, label: 'Secondary identifying numbers', group: 'Identification', required: false, src: 'secondaryIds', hint: 'Sponsor protocol number, other registries, funder grant number.' },
  { id: 'who4', n: 4, label: 'Source(s) of monetary or material support', group: 'Sponsors and contacts', required: true, src: 'funding', hint: 'Every funder, and material support such as donated drug.' },
  { id: 'who5', n: 5, label: 'Primary sponsor', group: 'Sponsors and contacts', required: true, src: 'sponsor', hint: 'The institution that takes responsibility for the trial.' },
  { id: 'who6', n: 6, label: 'Secondary sponsor(s)', group: 'Sponsors and contacts', required: false, src: 'secondarySponsor', hint: 'Others who share responsibility, if any.' },
  { id: 'who7', n: 7, label: 'Contact for public queries', group: 'Sponsors and contacts', required: true, src: 'contact', hint: 'A named person or office with an email address.' },
  { id: 'who8', n: 8, label: 'Contact for scientific queries', group: 'Sponsors and contacts', required: true, src: 'contact', hint: 'The principal investigator, usually.' },
  { id: 'who9', n: 9, label: 'Public title', group: 'Titles', required: true, src: 'publicTitle', hint: 'Plain language, for a lay reader.' },
  { id: 'who10', n: 10, label: 'Scientific title', group: 'Titles', required: true, src: 'scientificTitle', hint: 'Names the population, intervention, comparator and design.' },
  { id: 'who11', n: 11, label: 'Countries of recruitment', group: 'Recruitment', required: true, src: 'countries', hint: 'Every country, planned or actual.' },
  { id: 'who12', n: 12, label: 'Health condition(s) or problem(s) studied', group: 'Design', required: true, src: 'condition', hint: 'The condition, with a controlled term where the registry offers one.' },
  { id: 'who13', n: 13, label: 'Intervention(s)', group: 'Design', required: true, src: 'interventions', hint: 'Each arm: name, dose, duration, and the comparator.' },
  { id: 'who14', n: 14, label: 'Key inclusion and exclusion criteria', group: 'Design', required: true, src: 'criteria', hint: 'Age, sex and the clinical criteria.' },
  { id: 'who15', n: 15, label: 'Study type', group: 'Design', required: true, src: 'studyType', hint: 'Interventional or observational; allocation, masking, assignment, purpose, phase.' },
  { id: 'who16', n: 16, label: 'Date of first enrolment', group: 'Recruitment', required: true, src: 'firstEnrolmentAt', hint: 'Anticipated or actual.' },
  { id: 'who17', n: 17, label: 'Sample size', group: 'Recruitment', required: true, src: 'sampleSize', hint: 'The target number, and later the actual number.' },
  { id: 'who18', n: 18, label: 'Recruitment status', group: 'Recruitment', required: true, src: 'recruitmentStatus', hint: 'Pending, recruiting, suspended, complete or other.' },
  { id: 'who19', n: 19, label: 'Primary outcome(s)', group: 'Outcomes', required: true, src: 'primaryOutcome', hint: 'Name, metric or method of measurement, and timepoint.' },
  { id: 'who20', n: 20, label: 'Key secondary outcomes', group: 'Outcomes', required: true, src: 'secondaryOutcomes', hint: 'As for the primary outcome.' },
  { id: 'who21', n: 21, label: 'Ethics review', group: 'Ethics and results', required: true, src: 'ethics', hint: 'Status, date of approval and the committee with its contact.' },
  { id: 'who22', n: 22, label: 'Completion date', group: 'Ethics and results', required: false, atRegistration: false, src: 'primaryCompletionAt', hint: 'Date of last follow-up of the last participant, anticipated or actual.' },
  { id: 'who23', n: 23, label: 'Summary results', group: 'Ethics and results', required: false, atRegistration: false, src: null, hint: 'Added after the trial: results, dates, baseline, flow, adverse events, outcome measures.' },
  { id: 'who24', n: 24, label: 'IPD sharing statement', group: 'Ethics and results', required: true, src: 'dataSharing', hint: 'Whether individual participant data will be shared, and how.' },
];

// ClinicalTrials.gov PRS module each WHO item goes in (our reading of the
// PRS data element definitions; not checked against the live form).
export const CTGOV_GROUPS = {
  who1: 'Study Identification', who2: 'Study Status', who3: 'Study Identification',
  who4: 'Sponsor/Collaborators', who5: 'Sponsor/Collaborators', who6: 'Sponsor/Collaborators',
  who7: 'Contacts/Locations', who8: 'Contacts/Locations', who9: 'Study Identification', who10: 'Study Identification',
  who11: 'Contacts/Locations', who12: 'Conditions', who13: 'Arms/Interventions', who14: 'Eligibility',
  who15: 'Study Design', who16: 'Study Status', who17: 'Study Design', who18: 'Study Status',
  who19: 'Outcome Measures', who20: 'Outcome Measures', who21: 'Oversight', who22: 'Study Status',
  who23: 'Results', who24: 'IPD Sharing Statement',
};
export const CTGOV_ORDER = ['Study Identification', 'Study Status', 'Sponsor/Collaborators', 'Oversight', 'Conditions', 'Study Design',
  'Arms/Interventions', 'Outcome Measures', 'Eligibility', 'Contacts/Locations', 'IPD Sharing Statement', 'Results'];

// ISRCTN record sections, likewise our reading and unchecked.
export const ISRCTN_GROUPS = {
  who1: 'Study information', who2: 'Study information', who3: 'Study information',
  who4: 'Funders', who5: 'Sponsor information', who6: 'Sponsor information',
  who7: 'Contact information', who8: 'Contact information', who9: 'Study information', who10: 'Study information',
  who11: 'Locations', who12: 'Study information', who13: 'Study information', who14: 'Eligibility',
  who15: 'Study information', who16: 'Eligibility', who17: 'Eligibility', who18: 'Study information',
  who19: 'Study information', who20: 'Study information', who21: 'Study information', who22: 'Study information',
  who23: 'Results and publications', who24: 'Results and publications',
};
export const ISRCTN_ORDER = ['Contact information', 'Study information', 'Eligibility', 'Locations', 'Sponsor information', 'Funders', 'Results and publications'];

// ---- PROSPERO -------------------------------------------------------------------
// The main fields of a PROSPERO record as the form stood before its 2025
// revision; the current form may group or name them differently.
const P = (id, label, group, required, src, hint = '') => ({ id, label, group, required, src, hint });
export const PROSPERO_FIELDS = [
  P('pr-title', 'Review title', 'Title and timescale', true, 'scientificTitle', 'States the intervention or exposure, population and outcome.'),
  P('pr-title-orig', 'Original language title', 'Title and timescale', false, null, 'Only for a review not conducted in English.'),
  P('pr-start', 'Anticipated or actual start date', 'Title and timescale', true, 'startAt'),
  P('pr-end', 'Anticipated completion date', 'Title and timescale', true, 'endAt'),
  P('pr-stage', 'Stage of review at time of submission', 'Title and timescale', true, 'reviewStage', 'Registration is meant to precede data extraction.'),
  P('pr-contact', 'Named contact', 'Review team', true, 'contactName'),
  P('pr-email', 'Named contact email', 'Review team', true, 'contactEmail'),
  P('pr-affiliation', 'Organisational affiliation of the review', 'Review team', true, 'contactAffiliation'),
  P('pr-team', 'Review team members and their affiliations', 'Review team', true, 'team'),
  P('pr-funding', 'Funding sources/sponsors', 'Review team', true, 'funding'),
  P('pr-coi', 'Conflicts of interest', 'Review team', true, 'conflicts'),
  P('pr-collab', 'Collaborators', 'Review team', false, null),
  P('pr-question', 'Review question', 'Methods', true, 'question'),
  P('pr-searches', 'Searches', 'Methods', true, 'searches', 'Databases, dates covered, language or other limits.'),
  P('pr-strategy', 'URL to search strategy', 'Methods', false, null),
  P('pr-condition', 'Condition or domain being studied', 'Methods', true, 'condition'),
  P('pr-population', 'Participants/population', 'Methods', true, 'population'),
  P('pr-intervention', 'Intervention(s), exposure(s)', 'Methods', true, 'intervention'),
  P('pr-comparator', 'Comparator(s)/control', 'Methods', true, 'comparator'),
  P('pr-designs', 'Types of study to be included', 'Methods', true, 'designs'),
  P('pr-context', 'Context', 'Methods', false, 'context'),
  P('pr-main-outcomes', 'Main outcome(s)', 'Methods', true, 'primaryOutcome', 'With timing and effect measures.'),
  P('pr-add-outcomes', 'Additional outcome(s)', 'Methods', true, 'secondaryOutcomes'),
  P('pr-extraction', 'Data extraction (selection and coding)', 'Methods', true, 'selection'),
  P('pr-rob', 'Risk of bias (quality) assessment', 'Methods', true, 'appraisal'),
  P('pr-synthesis', 'Strategy for data synthesis', 'Methods', true, 'synthesis'),
  P('pr-subgroups', 'Analysis of subgroups or subsets', 'Methods', true, 'subgroups'),
  P('pr-type', 'Type and method of review', 'General information', true, 'studyType'),
  P('pr-language', 'Language', 'General information', true, 'language'),
  P('pr-country', 'Country', 'General information', true, 'country'),
  P('pr-other-reg', 'Other registration details', 'General information', false, null),
  P('pr-protocol', 'Reference and/or URL for published protocol', 'General information', false, null),
  P('pr-dissemination', 'Dissemination plans', 'General information', false, null),
  P('pr-keywords', 'Keywords', 'General information', false, 'keywords'),
  P('pr-existing', 'Details of any existing review of the same topic by the same authors', 'General information', false, null),
  P('pr-status', 'Current review status', 'General information', true, 'reviewStage'),
  P('pr-additional', 'Any additional information', 'General information', false, null),
];

// ---- INPLASY, laid out as PRISMA-P 2015 ------------------------------------------
// INPLASY asks for a protocol following PRISMA-P; each field names its item.
const I = (id, prismaP, label, group, required, src, hint = '') => ({ id, prismaP, label, group, required, src, hint });
export const INPLASY_FIELDS = [
  I('in-title', '1a', 'Identification (title)', 'Administrative information', true, 'scientificTitle', 'Identifies the report as a protocol of a systematic review.'),
  I('in-update', '1b', 'Update', 'Administrative information', false, null),
  I('in-registration', '2', 'Registration', 'Administrative information', false, 'registrationId'),
  I('in-contact', '3a', 'Authors: contact', 'Administrative information', true, 'contact'),
  I('in-contrib', '3b', 'Authors: contributions', 'Administrative information', true, 'team'),
  I('in-amend', '4', 'Amendments', 'Administrative information', false, 'amendments'),
  I('in-sources', '5a', 'Support: sources', 'Administrative information', true, 'funding'),
  I('in-sponsor', '5b', 'Support: sponsor', 'Administrative information', false, 'sponsor'),
  I('in-role', '5c', 'Support: role of sponsor or funder', 'Administrative information', false, null),
  I('in-rationale', '6', 'Rationale', 'Introduction', true, null),
  I('in-objectives', '7', 'Objectives', 'Introduction', true, 'question'),
  I('in-eligibility', '8', 'Eligibility criteria', 'Methods', true, 'criteria'),
  I('in-sources-info', '9', 'Information sources', 'Methods', true, 'searches'),
  I('in-search', '10', 'Search strategy', 'Methods', true, null, 'The draft strategy for at least one database.'),
  I('in-data-mgmt', '11a', 'Study records: data management', 'Methods', false, null),
  I('in-selection', '11b', 'Study records: selection process', 'Methods', true, 'selection'),
  I('in-collection', '11c', 'Study records: data collection process', 'Methods', true, null),
  I('in-items', '12', 'Data items', 'Methods', true, null),
  I('in-outcomes', '13', 'Outcomes and prioritisation', 'Methods', true, 'primaryOutcome'),
  I('in-rob', '14', 'Risk of bias in individual studies', 'Methods', true, 'appraisal'),
  I('in-synthesis', '15a', 'Data synthesis', 'Methods', true, 'synthesis'),
  I('in-additional', '15c', 'Additional analyses', 'Methods', false, 'subgroups'),
  I('in-meta-bias', '16', 'Meta-bias(es)', 'Methods', true, null),
  I('in-confidence', '17', 'Confidence in cumulative evidence', 'Methods', true, 'certainty'),
];

// ---- OSF and AsPredicted ----------------------------------------------------------
const O = (id, label, group, required, src, hint = '') => ({ id, label, group, required, src, hint });
export const OSF_PREREG = [
  O('osf-title', 'Title', 'Study information', true, 'scientificTitle'),
  O('osf-authors', 'Authors', 'Study information', true, 'team'),
  O('osf-description', 'Description', 'Study information', true, 'question'),
  O('osf-hypotheses', 'Hypotheses', 'Study information', true, 'hypotheses', 'Each hypothesis, with its direction where one is predicted.'),
  O('osf-type', 'Study type', 'Design plan', true, 'studyType'),
  O('osf-blinding', 'Blinding', 'Design plan', true, null),
  O('osf-design', 'Study design', 'Design plan', true, 'design'),
  O('osf-randomisation', 'Randomisation', 'Design plan', false, null),
  O('osf-existing', 'Existing data', 'Sampling plan', true, null, 'Whether any data exist, and whether anyone has seen them.'),
  O('osf-collection', 'Data collection procedures', 'Sampling plan', true, 'population'),
  O('osf-size', 'Sample size', 'Sampling plan', true, 'sampleSize'),
  O('osf-size-rationale', 'Sample size rationale', 'Sampling plan', false, 'sampleSize'),
  O('osf-stopping', 'Stopping rule', 'Sampling plan', false, null),
  O('osf-manipulated', 'Manipulated variables', 'Variables', false, 'intervention'),
  O('osf-measured', 'Measured variables', 'Variables', true, 'outcomes'),
  O('osf-indices', 'Indices', 'Variables', false, null),
  O('osf-models', 'Statistical models', 'Analysis plan', true, 'synthesis'),
  O('osf-transformations', 'Transformations', 'Analysis plan', false, null),
  O('osf-inference', 'Inference criteria', 'Analysis plan', true, null, 'The threshold or criterion for each decision.'),
  O('osf-exclusion', 'Data exclusion', 'Analysis plan', true, null),
  O('osf-missing', 'Missing data', 'Analysis plan', true, null),
  O('osf-exploratory', 'Exploratory analysis', 'Analysis plan', false, null),
  O('osf-other', 'Other', 'Other', false, null),
];

// The eight AsPredicted questions, in our words.
export const ASPREDICTED = [
  O('ap-1', 'Have any data been collected for this study already?', 'Questions', true, null),
  O('ap-2', 'What is the main question or hypothesis?', 'Questions', true, 'question'),
  O('ap-3', 'The key dependent variable(s) and how they will be measured', 'Questions', true, 'primaryOutcome'),
  O('ap-4', 'How many and which conditions participants will be assigned to', 'Questions', true, 'conditions'),
  O('ap-5', 'Exactly which analyses will test the main question', 'Questions', true, 'synthesis'),
  O('ap-6', 'How outliers will be defined and handled, and the rules for excluding observations', 'Questions', true, null),
  O('ap-7', 'How many observations will be collected, or what will determine sample size', 'Questions', true, 'sampleSize'),
  O('ap-8', 'Anything else to pre-register', 'Questions', false, null),
];

/** A Registered Report's stages; `state.paper.registeredReport` holds one id. */
export const REGISTERED_REPORT_STAGES = [
  { id: '', label: 'Not a Registered Report' },
  { id: 'stage-1', label: 'Stage 1: protocol reviewed before data are collected' },
  { id: 'stage-2', label: 'Stage 2: full paper after in-principle acceptance' },
];

const regroup = (map, order) => [...WHO_TRDS].map(f => ({ ...f, group: map[f.id] || f.group }))
  .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.n - b.n);

export const FORMS = {
  who: { id: 'who', label: 'WHO Trial Registration Data Set', registry: 'Any WHO primary registry', source: WHO_SOURCE, fields: WHO_TRDS },
  ctgov: { id: 'ctgov', label: 'ClinicalTrials.gov', registry: 'ClinicalTrials.gov', source: unchecked('ClinicalTrials.gov PRS data element definitions', 'https://clinicaltrials.gov/policy/protocol-definitions'), fields: regroup(CTGOV_GROUPS, CTGOV_ORDER) },
  isrctn: { id: 'isrctn', label: 'ISRCTN', registry: 'ISRCTN', source: unchecked('ISRCTN registry', 'https://www.isrctn.com/'), fields: regroup(ISRCTN_GROUPS, ISRCTN_ORDER) },
  prospero: { id: 'prospero', label: 'PROSPERO', registry: 'PROSPERO', source: unchecked('PROSPERO registration form', 'https://www.crd.york.ac.uk/prospero/'), fields: PROSPERO_FIELDS },
  inplasy: { id: 'inplasy', label: 'INPLASY', registry: 'INPLASY', source: unchecked('INPLASY protocol form (PRISMA-P 2015 items)', 'https://inplasy.com/'), fields: INPLASY_FIELDS },
  osf: { id: 'osf', label: 'OSF Preregistration', registry: 'OSF Registries', source: unchecked('OSF Preregistration template', 'https://osf.io/registries'), fields: OSF_PREREG, registeredReport: true },
  aspredicted: { id: 'aspredicted', label: 'AsPredicted', registry: 'AsPredicted', source: unchecked('AsPredicted', 'https://aspredicted.org/'), fields: ASPREDICTED },
};
export const formById = id => (typeof id === 'object' && id ? id : FORMS[id]) || null;

const TRIALS = new Set(['rct']);
const NONE = new Set(['guideline', 'case-report', 'other']);
/**
 * The registration forms that fit a research type, most usual first:
 * `[{ id, label, hint? }]`. A hint is a registry rule to check, not a fact.
 */
export function formFor(researchTypeId) {
  const t = typeById(researchTypeId);
  const f = (id, hint) => ({ id, label: FORMS[id].label, ...(hint ? { hint: { text: hint, source: FORMS[id].source.url, checked: null } } : {}) });
  if (!t || NONE.has(t.id)) return [];
  if (TRIALS.has(t.id)) return [f('who'), f('ctgov'), f('isrctn')];
  if (t.kind === 'review') {
    if (t.id === 'scoping-review') return [f('osf'), f('inplasy'),
      f('prospero', 'PROSPERO has been reported not to accept scoping reviews; check its current inclusion criteria.')];
    return [f('prospero'), f('inplasy'), f('osf')];
  }
  return [f('osf'), f('aspredicted')];
}

// ---- deriving values ---------------------------------------------------------------

const has = v => !!String(v ?? '').trim();
const join = xs => xs.filter(has).join('; ');
const TOOL_LABELS = { rob2: 'RoB 2', 'robins-i': 'ROBINS-I', 'robins-e': 'ROBINS-E', 'quadas-2': 'QUADAS-2', amstar2: 'AMSTAR 2', 'casp-qual': 'CASP qualitative checklist', 'jbi-case-series': 'JBI checklist for case series', nos: 'Newcastle–Ottawa Scale' };

function corresponding(s) {
  const pa = s.paper || {}, authors = (pa.authors || []).filter(a => has(a?.name));
  return authors.find(a => a.corresponding) || authors.find(a => a.name === pa.correspondingAuthor) || authors[0] || null;
}

/** What each source key reads from the project: `[value, from]` or null. */
function sources(s) {
  const t = typeById(s.project?.researchType) || null;
  const p = s.protocol || {}, pico = p.pico || {}, pa = s.paper || {}, reg = s.registration || {};
  const decl = s.declarations || {}, frame = questionFrameOf(t?.id || 'systematic-review');
  const label = id => frame.find(f => f.id === id)?.label || id;
  const crit = kind => (p.criteria || []).filter(c => (c.kind || 'include') === kind && has(c.text)).map(c => c.text.trim());
  const extra = (s.outcomes || []).filter(o => o.id !== 'primary' && has(o.name)).map(o => o.name.trim());
  const c = corresponding(s);
  const searchSources = [...new Set((s.searches || []).map(r => r.source).filter(has))];
  const tool = s.appraisalTool || t?.appraisal || '';
  const funders = (decl.funding || []).filter(f => has(f.funder)).map(f => `${f.funder.trim()}${has(f.grant) ? ` (${f.grant.trim()})` : ''}`);
  const eth = s.ethics || {}, dEth = decl.ethics || {};
  const committee = eth.committee || dEth.committee, ref = eth.reference || dEth.reference, approved = eth.approvedAt || dEth.date;
  const synthesis = t?.kind === 'review'
    ? (s.settings?.measure || s.analysis?.measure ? `Effect measure ${s.settings?.measure || s.analysis?.measure}; random-effects model, ${s.settings?.method || s.analysis?.method || 'REML'} estimator of between-study variance.` : '')
    : (s.sap?.analyses || []).filter(a => has(a.method)).map(a => `${a.outcome ? `${a.outcome}: ` : ''}${a.method}`).join('; ');
  const dataStatement = has(decl.dataAvailability?.choice) || has(decl.dataAvailability?.text) ? statements(decl, []).dataAvailability : '';
  const inclusion = crit('include'), exclusion = crit('exclude');
  const v = (value, from) => has(value) ? [String(value).trim(), from] : null;
  return {
    registrationId: v(pa.registration, 'paper.registration'),
    registeredAt: v(reg.registeredAt, 'registration.registeredAt'),
    secondaryIds: v(Array.isArray(reg.secondaryIds) ? reg.secondaryIds.join('; ') : reg.secondaryIds, 'registration.secondaryIds'),
    funding: decl.noFunding ? v('No specific funding.', 'declarations.noFunding') : v(join(funders), 'declarations.funding'),
    sponsor: v(reg.sponsor, 'registration.sponsor'),
    secondarySponsor: v(reg.secondarySponsor, 'registration.secondarySponsor'),
    contact: c ? v([c.name, c.email, c.affiliation].filter(has).join(', '), 'paper.authors') : null,
    contactName: c ? v(c.name, 'paper.authors') : null,
    contactEmail: c ? v(c.email, 'paper.authors') : null,
    contactAffiliation: c ? v(c.affiliation, 'paper.authors') : null,
    team: v((pa.authors || []).filter(a => has(a?.name)).map(a => has(a.affiliation) ? `${a.name} (${a.affiliation})` : a.name).join('; '), 'paper.authors'),
    publicTitle: v(pa.publicTitle || pa.title, pa.publicTitle ? 'paper.publicTitle' : 'paper.title'),
    scientificTitle: v(pa.title || p.title, pa.title ? 'paper.title' : 'protocol.title'),
    question: v(p.title, 'protocol.title'),
    countries: v(Array.isArray(reg.countries) ? reg.countries.join(', ') : reg.countries, 'registration.countries'),
    country: v(Array.isArray(reg.countries) ? reg.countries.join(', ') : reg.countries, 'registration.countries'),
    condition: v(pico.condition || pico.population, pico.condition ? 'protocol.pico.condition' : 'protocol.pico.population'),
    population: v(pico.population, 'protocol.pico.population'),
    intervention: v(pico.intervention, 'protocol.pico.intervention'),
    comparator: v(pico.comparator, 'protocol.pico.comparator'),
    interventions: v([has(pico.intervention) && `${label('intervention')}: ${pico.intervention.trim()}`, has(pico.comparator) && `${label('comparator')}: ${pico.comparator.trim()}`].filter(Boolean).join('. '), 'protocol.pico'),
    conditions: v([pico.intervention, pico.comparator].filter(has).join('; '), 'protocol.pico'),
    criteria: v([inclusion.length && `Inclusion: ${inclusion.join('; ')}`, exclusion.length && `Exclusion: ${exclusion.join('; ')}`].filter(Boolean).join('. '), 'protocol.criteria'),
    designs: v(pico.design || pico.designs, 'protocol.pico.design'),
    design: v(pico.design || pico.designs, 'protocol.pico.design'),
    context: v(pico.context || pico.research, 'protocol.pico'),
    studyType: t ? v(t.label, 'project.researchType') : null,
    firstEnrolmentAt: v(reg.firstEnrolmentAt, 'registration.firstEnrolmentAt'),
    primaryCompletionAt: v(reg.primaryCompletionAt, 'registration.primaryCompletionAt'),
    startAt: v(reg.startAt, 'registration.startAt'),
    endAt: v(reg.endAt || reg.primaryCompletionAt, 'registration.endAt'),
    reviewStage: v(reg.reviewStage, 'registration.reviewStage'),
    sampleSize: v(p.sampleSize, 'protocol.sampleSize'),
    recruitmentStatus: v(reg.recruitmentStatus, 'registration.recruitmentStatus'),
    primaryOutcome: v(pico.outcome, 'protocol.pico.outcome'),
    secondaryOutcomes: v(extra.join('; '), 'outcomes'),
    outcomes: v([pico.outcome, ...extra].filter(has).join('; '), 'protocol.pico.outcome'),
    ethics: v(committee ? `Approved by ${committee}${ref ? `, reference ${ref}` : ''}${approved ? `, ${longDate(approved)}` : ''}.` : '', 'ethics'),
    dataSharing: v(dataStatement, 'declarations.dataAvailability'),
    conflicts: v((decl.conflicts || []).length && (decl.conflicts || []).every(x => x?.kind === 'none') ? 'None declared.' : '', 'declarations.conflicts'),
    searches: v(searchSources.join(', '), 'searches'),
    selection: s.settings && 'dualScreening' in s.settings ? v(s.settings.dualScreening ? 'Two reviewers screen independently; conflicts are resolved by discussion.' : 'One reviewer screens.', 'settings.dualScreening') : null,
    appraisal: v(TOOL_LABELS[tool] || APPRAISAL_TOOLS.find(t => t.id === tool)?.name || tool, s.appraisalTool ? 'appraisalTool' : 'project.researchType'),
    synthesis: v(synthesis, t?.kind === 'review' ? 'settings' : 'sap.analyses'),
    subgroups: v((s.sap?.subgroups || []).join('; '), 'sap.subgroups'),
    certainty: t?.kind === 'review' ? v('GRADE', 'project.researchType') : null,
    amendments: v((s.protocolVersions || []).filter(x => has(x.note)).map(x => `v${x.v} ${String(x.at || '').slice(0, 10)}: ${x.note}`).join('; '), 'protocolVersions'),
    keywords: v(Array.isArray(pa.keywords) ? pa.keywords.join('; ') : pa.keywords, 'paper.keywords'),
    language: v(pa.language, 'paper.language'),
    hypotheses: v(p.hypotheses, 'protocol.hypotheses'),
  };
}

/**
 * The form's fields filled from the project:
 * `{ values: { fieldId: { value, from } }, missing: [fieldId] }`.
 * `missing` lists required fields with nothing behind them, leaving out what
 * the registry assigns and what is completed after registration.
 */
export function derive(state, formId) {
  const form = formById(formId);
  if (!form) throw new Error(`Unknown registration form: ${formId}`);
  const src = sources(state || {});
  const vals = {}, missing = [];
  for (const f of form.fields) {
    const hit = f.src ? src[f.src] : null;
    if (hit) vals[f.id] = { value: hit[0], from: hit[1] };
    else if (f.required && !f.byRegistry && f.atRegistration !== false) missing.push(f.id);
  }
  if (form.registeredReport && has(state?.paper?.registeredReport)) {
    const stage = REGISTERED_REPORT_STAGES.find(x => x.id === state.paper.registeredReport);
    if (stage?.id) vals.registeredReport = { value: stage.label, from: 'paper.registeredReport' };
  }
  return { values: vals, missing };
}

const valueOf = x => (x && typeof x === 'object' ? x.value : x) ?? '';
/** Required fields with no value, as `[{ id, label, group }]`; registry-assigned and later items are left out. */
export function toComplete(form, values = {}) {
  const f = formById(form);
  return f.fields.filter(x => x.required && !x.byRegistry && x.atRegistration !== false && !has(valueOf(values[x.id])))
    .map(x => ({ id: x.id, label: x.label, group: x.group }));
}
const groupsOf = fields => [...new Set(fields.map(f => f.group))];
const fieldLabel = f => f.prismaP ? `${f.label} (PRISMA-P ${f.prismaP})` : f.n ? `${f.n}. ${f.label}` : f.label;

/** The form as Markdown: a section per group, each field and its value, then what is left to complete. */
export function toMarkdown(form, values = {}) {
  const f = formById(form);
  const out = [`# ${f.label} registration draft`, `Fields as published by ${f.source.name} (${f.source.url}); not checked against the live form.`];
  if (values.registeredReport) out.push(`Registered Report: ${valueOf(values.registeredReport)}`);
  for (const g of groupsOf(f.fields)) {
    out.push(`## ${g}`);
    for (const x of f.fields.filter(y => y.group === g)) {
      const v = valueOf(values[x.id]);
      out.push(`**${fieldLabel(x)}**${x.required ? '' : ' (optional)'}\n\n${has(v) ? v : x.byRegistry ? '_Assigned by the registry._' : '_[to complete]_'}`);
    }
  }
  const todo = toComplete(f, values);
  if (todo.length) out.push('## To complete', todo.map(x => `- ${x.label} (${x.group})`).join('\n'));
  return out.join('\n\n') + '\n';
}

/** The form as manuscript blocks, in the same order as `toMarkdown`. */
export function toBlocks(form, values = {}) {
  const f = formById(form);
  const out = [blankBlock('h1', `${f.label} registration draft`),
    blankBlock('p', `Fields as published by ${f.source.name} (${f.source.url}); not checked against the live form.`)];
  if (values.registeredReport) out.push(blankBlock('p', `Registered Report: ${valueOf(values.registeredReport)}`));
  for (const g of groupsOf(f.fields)) {
    out.push(blankBlock('h2', g));
    for (const x of f.fields.filter(y => y.group === g)) {
      const v = valueOf(values[x.id]);
      out.push(blankBlock('h3', fieldLabel(x)), blankBlock('p', has(v) ? v : x.byRegistry ? 'Assigned by the registry.' : '[to complete]'));
    }
  }
  const todo = toComplete(f, values);
  if (todo.length) out.push(blankBlock('h2', 'To complete'), ...todo.map(x => blankBlock('p', `${x.label} (${x.group})`)));
  return out;
}

// ---- dates -----------------------------------------------------------------------

// Identifier shapes, used only to name the registry in a sentence.
const REGISTRIES = [
  [/^NCT\d{8}$/i, 'ClinicalTrials.gov'], [/^ISRCTN\d+$/i, 'ISRCTN'], [/^CRD\d+$/i, 'PROSPERO'], [/^INPLASY\d+/i, 'INPLASY'],
  [/osf\.io\//i, 'OSF Registries'], [/^ACTRN\d+/i, 'ANZCTR'], [/^DRKS\d+/i, 'DRKS'], [/^ChiCTR/i, 'ChiCTR'], [/^CTRI\//i, 'CTRI'],
  [/^jRCT/i, 'jRCT'], [/^UMIN\d+/i, 'UMIN-CTR'], [/^PACTR\d+/i, 'PACTR'], [/^IRCT\d+/i, 'IRCT'],
  [/^\d{4}-\d{6}-\d{2}$/, 'EU Clinical Trials Register'], [/^\d{4}-\d{6}-\d{2}-\d{2}$/, 'CTIS'], [/aspredicted\.org/i, 'AsPredicted'],
];
/** The registry an identifier looks like it belongs to, or ''. A pattern match, not a lookup. */
export function registryOf(id) {
  const s = String(id || '').trim().replace(/^(?:PROSPERO\s+|ClinicalTrials\.gov\s+)/i, '');
  return REGISTRIES.find(([re]) => re.test(s))?.[1] || '';
}

const day = d => { if (!has(d)) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d instanceof Date ? d.toISOString() : String(d)); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
/**
 * Whether registration was prospective, when results fall due, and the
 * methods sentence: `{ prospective, note, resultsDue, sentence }`.
 * `prospective` is null when either date is missing. `resultsDue` is
 * `{ date, label }` or null; the 12-month rule is a common registry rule,
 * stated as such.
 */
export function registrationDates({ registeredAt, firstEnrolmentAt, primaryCompletionAt, registry = '', id = '' } = {}) {
  const r = day(registeredAt), e = day(firstEnrolmentAt), c = day(primaryCompletionAt);
  const prospective = r && e ? r <= e : null;
  const note = prospective == null
    ? (r ? 'Date of first enrolment not recorded.' : 'Date of registration not recorded.')
    : prospective ? 'Registered on or before the first participant was enrolled (prospective).'
      : 'Registered after the first participant was enrolled (retrospective); say so in the paper, with the reason.';
  const resultsDue = c ? { date: addMonths(c, 12), label: 'Primary completion plus 12 months: a common registry rule; check the registry.' } : null;
  const name = registry || registryOf(id);
  const sentence = has(id) || r
    ? `This study was registered${name ? ` with ${name}` : ''}${has(id) ? ` (${String(id).trim()})` : ''}${r ? ` on ${longDate(r)}` : ''}${prospective === true ? ', before enrolment of the first participant' : prospective === false ? ', after enrolment of the first participant' : ''}.`
    : '[Registration: name the registry, the identifier and the date of registration.]';
  return { prospective, note, resultsDue, sentence };
}

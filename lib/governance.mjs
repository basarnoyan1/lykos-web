// Study governance: the ethics approval and its deadlines, the protocol
// synopsis, the participant information sheet and consent form, the data
// availability statement, the data management plan, and the statistical
// analysis plan with its deviations.
//
// Everything here drafts from what the project holds. What the project does not
// hold is a [bracketed] placeholder for the researcher, never a sentence the app
// made up. Nothing here is legal or regulatory advice: a committee's or
// funder's current template and the law that applies are the researcher's to
// check, and every template below names its source with `checked: null`.
//
// The ethics record lives at `state.ethics` (below). Deadlines are returned as
// items for the caller to put on the to-do list (lib/actions.mjs addTodo);
// nothing here writes to the store.
//
// Pure: nothing here imports the store or a view.
import { blankBlock } from './manuscript.mjs';
import { typeById, questionFrameOf } from './research-types.mjs';
import { statements, longDate, DATA_CHOICES } from './declarations.mjs';
import { blankEthics, normalizeEthics, deadlines } from './governance-state.mjs';
export { blankEthics, normalizeEthics, deadlines };

const has = v => !!String(v ?? '').trim();
const trim = v => String(v ?? '').trim();
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d instanceof Date ? d.toISOString() : String(d ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const H1 = t => blankBlock('h1', t), H2 = t => blankBlock('h2', t), H3 = t => blankBlock('h3', t), Pp = t => blankBlock('p', t);
const typeOf = s => typeById(s?.project?.researchType) || null;
const frameLabel = (s, id) => questionFrameOf(typeOf(s)?.id || 'rct').find(f => f.id === id)?.label || id;

// ---- ethics ---------------------------------------------------------------------

/** Problems as `[{ level: 'error'|'warning', key, text }]`. */
export function validateEthics(record) {
  const r = normalizeEthics(record), out = [];
  const add = (level, key, text) => out.push({ level, key, text });
  if (!has(r.committee)) add('error', 'committee', 'Name the approving committee.');
  if (!has(r.reference)) add('warning', 'reference', 'Add the approval reference number.');
  for (const k of ['approvedAt', 'expiresAt', 'annualReportDue'])
    if (has(r[k]) && !day(r[k])) add('error', k, `${k} is not a date (YYYY-MM-DD).`);
  if (!has(r.approvedAt)) add('error', 'approvedAt', 'Add the date of approval.');
  if (day(r.approvedAt) && day(r.expiresAt) && day(r.expiresAt) <= day(r.approvedAt)) add('error', 'expiresAt', 'Expiry is on or before approval.');
  r.amendments.forEach((a, i) => {
    if (!has(a.text)) add('warning', `amendments.${i}`, `Amendment ${i + 1} has no description.`);
    if (has(a.at) && !day(a.at)) add('error', `amendments.${i}`, `Amendment ${i + 1}: date is not YYYY-MM-DD.`);
    if (day(a.at) && day(a.approvedAt) && day(a.approvedAt) < day(a.at)) add('error', `amendments.${i}`, `Amendment ${i + 1} is approved before it was submitted.`);
  });
  return out;
}

const ethicsSentence = s => {
  const e = normalizeEthics(s.ethics || {}), d = s.declarations?.ethics || {};
  const committee = trim(e.committee || d.committee), ref = trim(e.reference || d.reference), at = day(e.approvedAt || d.date);
  if (!committee) return '[Ethics: the approving committee, reference and date, or that approval is pending.]';
  return `Approved by ${committee}${ref ? `, reference ${ref}` : ''}${at ? `, on ${longDate(at)}` : ''}.${has(e.conditions) ? ` Conditions: ${trim(e.conditions)}` : ''}`;
};

// ---- protocol synopsis ---------------------------------------------------------------

const criteriaOf = (s, kind) => (s.protocol?.criteria || []).filter(c => (c.kind || 'include') === kind && has(c.text)).map(c => trim(c.text));
const extraOutcomes = s => (s.outcomes || []).filter(o => o.id !== 'primary' && has(o.name)).map(o => trim(o.name));
const plannedText = s => (s.sap?.analyses || []).filter(a => has(a.method)).map(a => `${has(a.outcome) ? `${trim(a.outcome)}: ` : ''}${trim(a.method)}`);

/** A one-page protocol synopsis as manuscript blocks, filled from the protocol. */
export function protocolSynopsis(state) {
  const s = state || {}, p = s.protocol || {}, pico = p.pico || {}, t = typeOf(s);
  const or = (v, ph) => has(v) ? trim(v) : ph;
  const inc = criteriaOf(s, 'include'), exc = criteriaOf(s, 'exclude');
  const planned = plannedText(s);
  const analysis = planned.length ? planned.join('; ') + '.'
    : t?.kind === 'review' && (s.settings?.measure || s.settings?.method) ? `Effect measure ${s.settings?.measure || '[measure]'}; ${s.settings?.method || '[estimator]'} random-effects model.`
      : '[Analysis summary: the primary analysis, its population and model.]';
  return [
    H1(or(s.paper?.title || p.title, '[Study title]')),
    H2('Background'), Pp('[Background: one or two sentences on why this study is needed.]'),
    H2('Objectives'), Pp(or(p.title, '[Primary objective]')),
    H2('Design'), Pp([t?.label, pico.design || pico.designs].filter(has).map(trim).join('. ') || '[Design]'),
    H2('Population and eligibility'), Pp(or(pico.population, '[Population]')),
    ...(inc.length ? [Pp(`Inclusion: ${inc.join('; ')}.`)] : [Pp('[Inclusion criteria]')]),
    ...(exc.length ? [Pp(`Exclusion: ${exc.join('; ')}.`)] : []),
    H2(frameLabel(s, 'intervention') === 'Intervention' ? 'Interventions' : frameLabel(s, 'intervention')),
    Pp([has(pico.intervention) && `${frameLabel(s, 'intervention')}: ${trim(pico.intervention)}`, has(pico.comparator) && `${frameLabel(s, 'comparator')}: ${trim(pico.comparator)}`].filter(Boolean).join('. ') || '[Interventions and comparator]'),
    H2('Outcomes'), Pp(`Primary: ${or(pico.outcome, '[primary outcome, measure and timepoint]')}`),
    ...(extraOutcomes(s).length ? [Pp(`Secondary: ${extraOutcomes(s).join('; ')}`)] : []),
    H2('Sample size'), Pp(or(p.sampleSize, '[Sample size: the calculation, its assumptions and the target number.]')),
    H2('Statistical analysis'), Pp(analysis),
    H2('Timeline'), Pp('[Timeline: start of recruitment, end of follow-up, analysis and reporting.]'),
    H2('Ethics'), Pp(ethicsSentence(s)),
  ];
}

// ---- participant information and consent -------------------------------------------------

const DATA_PROTECTION = '[Data protection: adapt this paragraph to the law that applies to your study and to your institution’s template, for example the EU General Data Protection Regulation (GDPR) or Türkiye’s Personal Data Protection Law (KVKK). Name the data controller, the legal basis for processing, what personal data are collected, who will see them, where and for how long they are kept, whether they leave the country, and how participants can ask to see, correct or delete them.]';

/**
 * A participant information sheet and consent form as manuscript blocks.
 * `kind`: 'adult' (the participant), 'parent' (a parent for their child) or
 * 'assent' (a child, in simpler words). `style`: 'who' follows the section
 * order of the WHO research ethics committee's informed consent templates as
 * we know them; 'plain' puts each section as the question a reader asks.
 */
export function consentDocument({ state, kind = 'adult', style = 'who' } = {}) {
  const s = state || {}, p = s.protocol || {}, pico = p.pico || {}, t = typeOf(s);
  const you = kind === 'parent' ? 'your child' : 'you', your = kind === 'parent' ? 'your child’s' : 'your';
  const You = you[0].toUpperCase() + you.slice(1);
  const pa = s.paper || {}, authors = (pa.authors || []).filter(a => has(a?.name));
  const lead = authors.find(a => a.name === pa.correspondingAuthor) || authors[0] || null;
  const title = has(pa.publicTitle) ? trim(pa.publicTitle) : has(pa.title) ? trim(pa.title) : has(p.title) ? trim(p.title) : '[Study title in plain words]';
  const randomised = t?.id === 'rct';
  const e = normalizeEthics(s.ethics || {});
  const committee = trim(e.committee || s.declarations?.ethics?.committee);
  const simple = kind === 'assent';

  const purpose = simple
    ? `We want to find out ${has(p.title) ? `more about this question: ${trim(p.title)}` : '[what the study wants to find out, in words a child understands]'}.`
    : `This study asks: ${has(p.title) ? trim(p.title).replace(/\?*$/, '?') : '[the study question in plain words]'} ${has(pico.population) ? `We are asking ${kind === 'parent' ? 'parents of children' : 'people'} in this group to take part: ${trim(pico.population)}.` : '[Who is being asked to take part, and why.]'}`;
  const happens = [
    has(pico.intervention) ? `${randomised ? `If ${you} take${kind === 'parent' ? 's' : ''} part, ${you} will be put into one of the study groups by chance, like tossing a coin. ` : ''}${frameLabel(s, 'intervention')}: ${trim(pico.intervention)}.${has(pico.comparator) ? ` ${frameLabel(s, 'comparator')}: ${trim(pico.comparator)}.` : ''}` : '[What will happen: visits, tests, treatments, and which group is which.]',
    '[How long taking part lasts, how many visits, and how long each takes.]',
  ].join(' ');
  const risks = '[Risks and discomforts: each known risk, how likely it is, and what will be done about it.]';
  const benefits = '[Benefits: any benefit to the participant, or state that there may be none, and the benefit to others.]';
  const alternatives = kind === 'assent' ? '[What happens if you do not take part: your usual care stays the same.]' : `[Alternatives: the care or treatment ${you} can have without taking part.]`;
  const confidentiality = `The information collected about ${you} will be kept private. ${simple ? 'Only the study team will know it is about you.' : `Records will carry a code instead of ${your} name, and only the study team and the bodies that check the study will see them.`}`;
  const voluntary = simple
    ? 'You do not have to be in this study. You can say no, or stop at any time, and nobody will be upset with you.'
    : `Taking part is voluntary. ${You} may refuse or withdraw at any time, without giving a reason, and ${your} care will not be affected. [What happens to data already collected on withdrawal.]`;
  const contacts = [
    lead ? `Study contact: ${lead.name}${has(lead.email) ? `, ${trim(lead.email)}` : ''}${has(lead.affiliation) ? `, ${trim(lead.affiliation)}` : ''}.` : '[Study contact: name, phone and email.]',
    committee ? `This study was reviewed by ${committee}${has(e.reference) ? ` (reference ${trim(e.reference)})` : ''}. [Committee contact details.]` : '[Ethics committee: name and contact details.]',
  ].join(' ');
  const signer = kind === 'parent' ? 'Name of parent or guardian' : kind === 'assent' ? 'Name of child' : 'Name of participant';
  const statement = kind === 'assent'
    ? 'I have been told about this study and I understand it. I agree to take part.'
    : kind === 'parent'
      ? 'I have read the information above, or it has been read to me. I have had the chance to ask questions and they have been answered. I agree that my child may take part in this study.'
      : 'I have read the information above, or it has been read to me. I have had the chance to ask questions and they have been answered. I consent voluntarily to take part in this study.';
  const signatures = [statement, `${signer}: ________________`, 'Signature: ________________', 'Date: ________________',
    ...(kind === 'parent' ? ['Name of child: ________________'] : []),
    'Name of person taking consent: ________________', 'Signature: ________________', 'Date: ________________'];

  const PLAIN = { purpose: 'Why is this study being done?', happens: 'What will happen if I take part?', risks: 'Could taking part cause harm or discomfort?',
    benefits: 'Could taking part help?', alternatives: 'What else could I do?', confidentiality: 'Who will see my information?',
    dataProtection: 'How is my personal data protected?', voluntary: 'Do I have to take part? Can I stop?', contacts: 'Who can I contact?', signatures: 'Consent' };
  const WHO = { purpose: 'Purpose of the research', happens: 'Procedures and duration', risks: 'Risks and discomforts', benefits: 'Benefits',
    alternatives: 'Alternatives to participation', confidentiality: 'Confidentiality', dataProtection: 'Data protection',
    voluntary: 'Voluntary participation and the right to withdraw', contacts: 'Who to contact', signatures: 'Certificate of consent' };
  const head = style === 'plain' ? PLAIN : WHO;
  const heading = kind === 'assent' ? 'Assent form' : kind === 'parent' ? 'Parent information sheet and consent form' : 'Participant information sheet and consent form';
  const blocks = [H1(`${heading}: ${title}`)];
  if (style === 'who') blocks.push(H2('Part I: Information sheet'));
  const sec = (k, text) => blocks.push((style === 'who' ? H3 : H2)(head[k]), Pp(text));
  sec('purpose', purpose); sec('happens', happens); sec('risks', risks); sec('benefits', benefits); sec('alternatives', alternatives);
  sec('confidentiality', confidentiality);
  if (kind !== 'assent') sec('dataProtection', DATA_PROTECTION);
  sec('voluntary', voluntary); sec('contacts', contacts);
  if (style === 'who') blocks.push(H2('Part II: Certificate of consent'));
  else blocks.push(H2(head.signatures));
  blocks.push(...signatures.map(Pp));
  return blocks;
}

// ---- readability ------------------------------------------------------------------

const VOWELS_EN = /[aeiouy]+/g, VOWELS_TR = /[aeıioöuü]/gi;
function syllablesEn(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (stripped.match(VOWELS_EN) || []).length);
}
/**
 * Reading ease and sentence length for the plain-language check:
 * `{ words, sentences, syllables, wordsPerSentence, readingEase, formula }`.
 * English uses Flesch reading ease with a vowel-group syllable count (an
 * approximation); `lang: 'tr'` uses Ateşman's adaptation, where a Turkish
 * syllable is a vowel. Higher is easier; either is a prompt to look, not a
 * verdict. Empty text gives nulls.
 */
export function readability(text, { lang = 'en' } = {}) {
  const t = String(text ?? '').replace(/\[[^\]]*\]/g, ' ').trim();
  const words = t.match(/[\p{L}\p{N}’'-]+/gu)?.filter(w => /\p{L}|\p{N}/u.test(w)) || [];
  const sentences = Math.max(words.length ? 1 : 0, t.split(/[.!?]+(?:\s|$)/).filter(x => /[\p{L}\p{N}]/u.test(x)).length);
  const syllables = words.reduce((n, w) => n + (lang === 'tr' ? Math.max(1, (w.match(VOWELS_TR) || []).length) : syllablesEn(w)), 0);
  if (!words.length) return { words: 0, sentences: 0, syllables: 0, wordsPerSentence: null, readingEase: null, formula: lang === 'tr' ? 'Ateşman' : 'Flesch' };
  const wps = words.length / sentences, spw = syllables / words.length;
  const ease = lang === 'tr' ? 198.825 - 40.175 * spw - 2.610 * wps : 206.835 - 1.015 * wps - 84.6 * spw;
  const r1 = x => Math.round(x * 10) / 10;
  return { words: words.length, sentences, syllables, wordsPerSentence: r1(wps), readingEase: r1(ease), formula: lang === 'tr' ? 'Ateşman' : 'Flesch' };
}

// ---- data availability ------------------------------------------------------------
// The templates are lib/declarations.mjs's, so the statement here and the one in
// the manuscript's declarations are the same sentence.

export { DATA_CHOICES };
export const DATA_CHOICE_LABELS = { repository: 'In a repository', 'on request': 'On request', 'in paper': 'In the paper', 'not available': 'Not available', 'not applicable': 'Not applicable' };
/** The data availability statement for `{ choice, repository, doi, conditions, text }`. */
export function dataAvailabilityStatement(record = {}) {
  return statements({ dataAvailability: { ...record } }, []).dataAvailability;
}

// ---- data management plan -----------------------------------------------------------------

export const DMP_TEMPLATES = {
  nih: { label: 'NIH Data Management and Sharing Plan', source: { name: 'NIH NOT-OD-21-014 (six plan elements)', url: 'https://grants.nih.gov/grants/guide/notice-files/NOT-OD-21-014.html', checked: null },
    sections: [['types', 'Element 1: Data type'], ['tools', 'Element 2: Related tools, software and/or code'], ['standards', 'Element 3: Standards'],
      ['preservation', 'Element 4: Data preservation, access and associated timelines'], ['access', 'Element 5: Access, distribution or reuse considerations'],
      ['oversight', 'Element 6: Oversight of data management and sharing']] },
  horizon: { label: 'Horizon Europe Data Management Plan', source: { name: 'Horizon Europe DMP template', url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/', checked: null },
    sections: [['types', '1. Data summary'], ['findable', '2.1 FAIR: making data findable, including provisions for metadata'], ['preservation', '2.2 FAIR: making data accessible'],
      ['standards', '2.3 FAIR: making data interoperable'], ['access', '2.4 FAIR: increasing data reuse'], ['tools', '3. Other research outputs'],
      ['resources', '4. Allocation of resources'], ['security', '5. Data security'], ['ethics', '6. Ethics'], ['other', '7. Other issues']] },
  // TÜBİTAK's official DMP template was not verified: this is the generic
  // outline under its name, to be checked against the call's own form.
  tubitak: { label: 'Data management plan (TÜBİTAK; generic outline, official template not verified)', source: { name: 'Generic outline; check the call documents', url: 'https://www.tubitak.gov.tr/', checked: null }, generic: true },
  generic: { label: 'Data management plan', source: { name: 'Generic outline', url: '', checked: null }, generic: true },
};
const GENERIC_SECTIONS = [['types', 'Data description'], ['collection', 'Data collection'], ['standards', 'Documentation and metadata'],
  ['security', 'Storage, backup and security'], ['ethics', 'Ethics and legal compliance'], ['access', 'Data sharing and access'],
  ['preservation', 'Preservation and retention'], ['oversight', 'Responsibilities and resources']];

/** One line per dataset: its name, rows, columns and column types. */
export function datasetSummary(state) {
  return (state?.datasets || []).map(d => {
    const cols = d.columns || [], types = {};
    for (const c of cols) types[c.type || 'text'] = (types[c.type || 'text'] || 0) + 1;
    const typeText = Object.entries(types).map(([k, n]) => `${n} ${k}`).join(', ');
    const n = (d.rows || []).length;
    return `${d.name || d.id}: ${n} row${n === 1 ? '' : 's'}, ${cols.length} column${cols.length === 1 ? '' : 's'}${typeText ? ` (${typeText})` : ''}.`;
  });
}

/** A data management plan as manuscript blocks, under the chosen template's headings. */
export function dataManagementPlan({ state, template = 'generic' } = {}) {
  const s = state || {}, tpl = DMP_TEMPLATES[template];
  if (!tpl) throw new Error(`Unknown data management plan template: ${template}`);
  const sets = datasetSummary(s), t = typeOf(s), decl = s.declarations || {};
  const participants = t && (t.patientData || ['primary', 'patients'].includes(t.kind)) && t.id !== 'guideline';
  const dataStatement = has(decl.dataAvailability?.choice) || has(decl.dataAvailability?.text) ? statements(decl, []).dataAvailability : '';
  const body = {
    types: [...(sets.length ? sets : ['[The datasets this study will produce: what, how many records, what format.]']),
      ...(participants ? ['[State whether the data are identifiable, pseudonymised or anonymised.]'] : [])],
    collection: [has(s.protocol?.pico?.design) ? `Design: ${trim(s.protocol.pico.design)}.` : '[How data are collected and entered.]', '[Quality control during collection.]'],
    tools: ['Analyses are run and kept in the project, with the R scripts each analysis ran. [Other software and code, and where the code will be shared.]'],
    standards: ['[Data standards, controlled vocabularies and the codebook that describes each variable.]'],
    findable: ['[Persistent identifier (DOI), metadata standard and keywords.]'],
    preservation: [dataStatement || '[Where the data will be deposited, when, and for how long.]', 'Retention: [how long the data are kept after the study ends, and the rule that sets it].'],
    access: [dataStatement || '[Who may access the data, on what terms, and any restrictions.]', ...(participants ? ['[Consent for sharing and any conditions set by the ethics committee.]'] : [])],
    security: ['[Where data are stored, who has access, backup, and encryption.]'],
    ethics: [ethicsSentence(s), ...(participants ? [DATA_PROTECTION] : [])],
    resources: ['[Costs of data management and sharing, and who pays them.]'],
    oversight: [`Responsible: ${(s.paper?.authors || []).find(a => a.name === s.paper?.correspondingAuthor)?.name || '[named person]'}. [How compliance with this plan is monitored.]`],
    other: ['[Other national, funder or institutional requirements.]'],
  };
  const sections = tpl.generic ? GENERIC_SECTIONS : tpl.sections;
  return [H1(tpl.label), Pp(`Headings from ${tpl.source.name}; check the funder’s current template.`),
    ...sections.flatMap(([k, h]) => [H2(h), ...(body[k] || ['[To complete]']).map(Pp)])];
}

// ---- statistical analysis plan ------------------------------------------------------------
// Headings follow Gamble et al., JAMA 2017;318(23):2337–2343 (guidelines for
// the content of statistical analysis plans in clinical trials), in our words.

/** The analyses the plan names: `state.sap.analyses`, else one line per outcome with the method to fill. */
export function plannedAnalyses(state) {
  const s = state || {};
  const given = (s.sap?.analyses || []).filter(a => has(a.outcome) || has(a.method)).map(a => ({ outcome: trim(a.outcome), method: trim(a.method), ...(a.population ? { population: a.population } : {}) }));
  if (given.length) return given;
  return [s.protocol?.pico?.outcome, ...extraOutcomes(s)].filter(has).map(o => ({ outcome: trim(o), method: '' }));
}

export function statisticalAnalysisPlan(state) {
  const s = state || {}, p = s.protocol || {}, pico = p.pico || {}, t = typeOf(s), pa = s.paper || {};
  const versions = s.protocolVersions || [];
  const plan = plannedAnalyses(s);
  const sec = (h, ...ps) => [H3(h), ...ps.map(Pp)];
  return [
    H1(`Statistical analysis plan${has(pa.title || p.title) ? `: ${trim(pa.title || p.title)}` : ''}`),
    H2('1. Administrative information'),
    ...sec('Title and trial registration', `${has(pa.title || p.title) ? trim(pa.title || p.title) : '[Title]'}. Registration: ${has(pa.registration) ? trim(pa.registration) : '[registry and identifier]'}.`),
    ...sec('SAP version', '[SAP version and date.]'),
    ...sec('Protocol version', versions.length ? `Protocol version ${versions.at(-1).v}, ${String(versions.at(-1).at || '').slice(0, 10)}.` : '[Protocol version this SAP refers to.]'),
    ...sec('SAP revisions', '[Each revision, its date and reason, and when it was made relative to unblinding.]'),
    ...sec('Roles and responsibility', `${(pa.authors || []).filter(a => has(a?.name)).map(a => a.name).join(', ') || '[Names and roles of those writing the SAP.]'}`),
    ...sec('Signatures', '[Senior statistician, chief investigator, and the person writing the SAP.]'),
    H2('2. Introduction'),
    ...sec('Background and rationale', '[Background and rationale, briefly.]'),
    ...sec('Objectives', has(p.title) ? trim(p.title) : '[Objectives and hypotheses.]'),
    H2('3. Study methods'),
    ...sec('Trial design', [t?.label, pico.design].filter(has).map(trim).join('. ') || '[Design, allocation ratio and framework.]'),
    ...sec('Randomisation', '[Randomisation method, stratification and blocking.]'),
    ...sec('Sample size', has(p.sampleSize) ? trim(p.sampleSize) : '[Sample size calculation.]'),
    ...sec('Framework', '[Superiority, equivalence or non-inferiority, with the margin.]'),
    ...sec('Statistical interim analyses and stopping guidance', '[Interim analyses, stopping rules and adjustment, or none planned.]'),
    ...sec('Timing of final analysis', '[When the final analysis will be done.]'),
    ...sec('Timing of outcome assessments', '[Timepoints, with windows.]'),
    H2('4. Statistical principles'),
    ...sec('Confidence intervals and P values', '[Level of significance, sidedness, and any adjustment for multiplicity.]'),
    ...sec('Adherence and protocol deviations', '[Definition of adherence and how deviations are summarised.]'),
    ...sec('Analysis populations', '[Intention-to-treat, per-protocol and safety populations.]'),
    H2('5. Trial population'),
    ...sec('Screening data', '[Screening data to be summarised.]'),
    ...sec('Eligibility', [criteriaOf(s, 'include').length && `Inclusion: ${criteriaOf(s, 'include').join('; ')}.`, criteriaOf(s, 'exclude').length && `Exclusion: ${criteriaOf(s, 'exclude').join('; ')}.`].filter(Boolean).join(' ') || '[Eligibility criteria.]'),
    ...sec('Recruitment', '[CONSORT flow diagram contents.]'),
    ...sec('Withdrawal and follow-up', '[Level and timing of withdrawal, and how it is presented.]'),
    ...sec('Baseline patient characteristics', '[Characteristics, and how they are summarised by group.]'),
    H2('6. Analysis'),
    ...sec('Outcome definitions', `Primary: ${has(pico.outcome) ? trim(pico.outcome) : '[primary outcome, measure and timepoint]'}.`, ...(extraOutcomes(s).length ? [`Secondary: ${extraOutcomes(s).join('; ')}.`] : [])),
    ...sec('Analysis methods', ...(plan.length ? plan.map(a => `${a.outcome || '[outcome]'}: ${a.method || '[method, effect measure and adjustment]'}.`) : ['[Analysis method for each outcome.]'])),
    ...sec('Missing data', '[How missing data are reported and handled.]'),
    ...sec('Additional analyses', (s.sap?.subgroups || []).length ? `Subgroups: ${s.sap.subgroups.join('; ')}.` : '[Subgroup and sensitivity analyses.]'),
    ...sec('Harms', '[Adverse events: how they are coded and summarised.]'),
    ...sec('Statistical software', '[Software and versions.]'),
    ...sec('References', '[Non-standard methods referenced.]'),
  ];
}

// ---- deviations ---------------------------------------------------------------------------

const norm = v => trim(v).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const near = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/**
 * What was run, from the project: the pooled outcomes (`state.analysis`,
 * `state.analyses`) and the kept dataset analyses (`state.datasetAnalyses`):
 * `[{ outcome, method, source }]`.
 */
export function executedAnalyses(state) {
  const s = state || {}, out = [];
  const outcomeName = id => (s.outcomes || []).find(o => o.id === id)?.name || (id === 'primary' ? s.protocol?.pico?.outcome || 'Primary outcome' : id);
  const methodOf = a => [a?.measure, a?.method || a?.model].filter(has).join(', ');
  if (s.analysis) out.push({ outcome: trim(outcomeName('primary')), method: methodOf(s.analysis), source: 'analysis', outcomeId: 'primary' });
  for (const [slot, a] of Object.entries(s.analyses || {})) if (a) out.push({ outcome: trim(outcomeName(String(slot).split('#')[0])), method: methodOf(a), source: `analyses.${slot}`, outcomeId: String(slot).split('#')[0] });
  for (const a of s.datasetAnalyses || []) {
    const d = (s.datasets || []).find(x => x.id === a.datasetId);
    const inp = a.inputs || {};
    const col = [inp.y, inp.test, inp.score, inp.x, inp.row].find(v => typeof v === 'string' && v);
    const label = d?.columns?.find(c => c.id === col)?.label || col || a.kind;
    out.push({ outcome: trim(label), method: trim(a.method || a.result?.method || a.kind), source: `datasetAnalyses.${a.id}` });
  }
  return out;
}

/**
 * Planned against executed, one row each:
 * `[{ outcome, planned, executed, status: 'as planned'|'changed'|'not done'|'not planned' }]`.
 * `sap` is `{ analyses }`, a list, or a state; `executed` a list or a state.
 * A planned row and a pooled result that name one outcome by id (lib/outcome-links.mjs) are the same outcome; otherwise outcomes and
 * methods match when one names the other (case and punctuation aside), so a match is a prompt to check, not a proof.
 */
export function sapDeviations(sap, executed) {
  const planned = Array.isArray(sap) ? sap : Array.isArray(sap?.analyses) ? sap.analyses : sap?.protocol || sap?.sap ? plannedAnalyses(sap) : [];
  const done = Array.isArray(executed) ? executed : executedAnalyses(executed);
  const { rows, unplanned } = matchPlan(planned, done);
  return [...rows.map(r => ({ outcome: trim(r.p.outcome), planned: trim(r.p.method), executed: r.status === 'not done' ? '' : trim(done[r.at].method), status: r.status })),
    ...unplanned.map(i => ({ outcome: trim(done[i].outcome), planned: '', executed: trim(done[i].method), status: 'not planned' }))];
}

/** Each planned row against what was run: `{ rows: [{ p, status, at, same }], unplanned }`, `same` every run its outcome names, `at` the one it is compared with, `unplanned` the runs no row names (indexes into `done`). */
function matchPlan(planned, done) {
  const used = new Set();
  const rows = planned.map(p => {
    // by the shared outcome id when the row and a run carry one (lib/outcome-links.mjs), else by name
    const byId = p.outcomeId && p.outcomeId !== 'none' && done.some(e => e.outcomeId === p.outcomeId);
    const same = done.map((e, i) => [e, i]).filter(([e]) => (byId ? e.outcomeId === p.outcomeId : near(e.outcome, p.outcome)));
    if (!same.length) return { p, status: 'not done', at: -1, same: [] };
    const hit = same.find(([e]) => near(e.method, p.method)) || null;
    same.forEach(([, k]) => used.add(k));
    return { p, status: hit ? 'as planned' : 'changed', at: (hit || same[0])[1], same: same.map(([, k]) => k) };
  });
  return { rows, unplanned: done.map((_, i) => i).filter(i => !used.has(i)) };
}

/**
 * The stored plan's rows (`state.sap.analyses`, not the plan the protocol implies) and the analyses each names, for the dependency graph:
 * `{ rows: [{ outcome, method, status, sources }], unplanned: [source] }`, a source as executedAnalyses gives it (`analysis`, `analyses.<slot>`,
 * `datasetAnalyses.<id>`). Matched by name as sapDeviations matches, so a link is a prompt to check, not a proof.
 */
export function sapLinks(state) {
  const s = state || {};
  const planned = (Array.isArray(s.sap?.analyses) ? s.sap.analyses : []).filter(a => a && (has(a.outcome) || has(a.method)));
  if (!planned.length) return { rows: [], unplanned: [] };
  const done = executedAnalyses(s), { rows, unplanned } = matchPlan(planned, done);
  return { rows: rows.map(r => ({ outcome: trim(r.p.outcome), method: trim(r.p.method), status: r.status, sources: r.same.map(i => done[i].source) })), unplanned: unplanned.map(i => done[i].source) };
}

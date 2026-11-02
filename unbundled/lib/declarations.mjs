// Manuscript declarations: author contributions (CRediT), ICMJE authorship,
// competing interests, funding, ethics, consent, data availability, AI use,
// acknowledgements and registration, kept as one record at state.declarations,
// and the title page built from the paper's authors.
//
// Everything here is written from what the authors entered. Where a statement
// a journal requires has nothing behind it, the text is a [bracketed]
// placeholder for the author to replace, never a sentence the app made up.
//
// Pure: nothing here imports the store or a view.
import { newId } from './manuscript.mjs';
import { typeById } from './research-types.mjs';

// ---- CRediT ------------------------------------------------------------------
// The Contributor Roles Taxonomy (NISO Z39.104-2022), in its own order and with
// its own names; the dash in the two writing roles is an en dash.
export const CREDIT_ROLES = [
  { id: 'conceptualization', name: 'Conceptualization' },
  { id: 'data-curation', name: 'Data curation' },
  { id: 'formal-analysis', name: 'Formal analysis' },
  { id: 'funding-acquisition', name: 'Funding acquisition' },
  { id: 'investigation', name: 'Investigation' },
  { id: 'methodology', name: 'Methodology' },
  { id: 'project-administration', name: 'Project administration' },
  { id: 'resources', name: 'Resources' },
  { id: 'software', name: 'Software' },
  { id: 'supervision', name: 'Supervision' },
  { id: 'validation', name: 'Validation' },
  { id: 'visualization', name: 'Visualization' },
  { id: 'writing-original-draft', name: 'Writing – original draft' },
  { id: 'writing-review-editing', name: 'Writing – review & editing' },
];
export const CREDIT_DEGREES = ['lead', 'equal', 'supporting'];

const fold = s => String(s || '').toLowerCase().replace(/[‐-―-]/g, ' ').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
/** A CRediT role by id or by name (any dash, "&" or "and"); null for anything else. */
export function creditRole(role) {
  const f = fold(role);
  return CREDIT_ROLES.find(r => r.id === role || fold(r.name) === f || fold(r.id) === f) || null;
}

// ICMJE, "Defining the Role of Authors and Contributors": an author meets all four.
export const ICMJE_CRITERIA = [
  { id: 'c1', label: 'Substantial contributions to the conception or design of the work, or the acquisition, analysis or interpretation of data' },
  { id: 'c2', label: 'Drafting the work or reviewing it critically for important intellectual content' },
  { id: 'c3', label: 'Final approval of the version to be published' },
  { id: 'c4', label: 'Agreement to be accountable for all aspects of the work' },
];

export const CONFLICT_KINDS = ['none', 'financial', 'nonfinancial'];
export const CONSENT_TYPES = ['written', 'waived', 'not applicable'];
export const DATA_CHOICES = ['repository', 'on request', 'in paper', 'not available', 'not applicable'];

// ---- the record ----------------------------------------------------------------

/** An empty declarations record; the registration is the paper's. */
export function blankDeclarations(paper = {}) {
  return {
    contributions: {}, icmje: {}, conflicts: [], funding: [], noFunding: false,
    ethics: { committee: '', reference: '', date: '', waiver: false, text: '' },
    consent: { type: '', text: '' },
    dataAvailability: { choice: '', repository: '', doi: '', conditions: '', text: '' },
    aiUse: '', acknowledgements: '',
    trialRegistration: String(paper?.registration || ''),
  };
}

/** A stored record with every field present; the registration is always read from the paper when one is given. */
export function normalizeDeclarations(decl = {}, paper) {
  const b = blankDeclarations(paper);
  const d = decl || {};
  return {
    ...b, ...d,
    contributions: { ...(d.contributions || {}) },
    icmje: { ...(d.icmje || {}) },
    conflicts: [...(d.conflicts || [])],
    funding: [...(d.funding || [])],
    noFunding: !!d.noFunding,
    ethics: { ...b.ethics, ...(d.ethics || {}) },
    consent: { ...b.consent, ...(d.consent || {}) },
    dataAvailability: { ...b.dataAvailability, ...(d.dataAvailability || {}) },
    trialRegistration: paper ? String(paper.registration || '') : String(d.trialRegistration || ''),
  };
}

const nameOf = a => String((typeof a === 'string' ? a : a?.name) || '').trim();
const namesOf = authors => (authors || []).map(nameOf).filter(Boolean);
const has = s => !!String(s ?? '').trim();
const typeOf = t => (typeof t === 'string' ? typeById(t) : t) || null;

// Studies of people need an ethics statement and a consent statement. A guideline
// and an economic evaluation may use no participant data (a model), so for them a
// missing statement is a flag; an animal study needs approval but not consent.
const NO_PARTICIPANTS = new Set(['guideline']);
const MAYBE_PARTICIPANTS = new Set(['economic-evaluation']);
function ethicsNeed(researchType) {
  const t = typeOf(researchType);
  if (!t || !['primary', 'patients'].includes(t.kind) || NO_PARTICIPANTS.has(t.id)) return null;
  return MAYBE_PARTICIPANTS.has(t.id) ? 'warning' : 'error';
}
function consentNeed(researchType) {
  const need = ethicsNeed(researchType);
  return typeOf(researchType)?.id === 'animal-study' ? null : need;
}
const ethicsGiven = e => !!e && (has(e.text) || has(e.committee) || e.waiver);
const consentGiven = c => !!c && (has(c.type) || has(c.text));
const dataGiven = d => !!d && (has(d.choice) || has(d.text));
const fundingGiven = decl => decl.noFunding || (decl.funding || []).some(f => has(f.funder) || has(f.text));

/**
 * What is missing or doubtful, as `[{ level: 'error'|'warning', key, author?, text }]`.
 * An error is a statement a journal requires and does not have; a warning is a
 * flag for the authors to look at (an ICMJE criterion not met does not stop
 * anything — that person may belong in the acknowledgements).
 * `researchType` (an id or entry of lib/research-types.mjs) decides whether
 * ethics and consent are required.
 */
export function validate(decl, authors, { researchType = null } = {}) {
  const d = normalizeDeclarations(decl);
  const names = namesOf(authors);
  const out = [];
  const push = (level, key, text, author) => out.push({ level, key, ...(author ? { author } : {}), text });
  for (const n of names) {
    const roles = (d.contributions[n] || []).filter(r => creditRole(r?.role));
    if (!roles.length) push('error', 'contributions', `${n} has no CRediT role`, n);
  }
  for (const n of names) {
    const c = d.icmje[n] || {};
    const missing = ICMJE_CRITERIA.filter(k => !c[k.id]).map(k => Number(k.id.slice(1)));
    if (missing.length) push('warning', 'icmje', `${n} does not meet ICMJE criteri${missing.length === 1 ? 'on' : 'a'} ${missing.join(', ')}; consider the acknowledgements instead of authorship`, n);
  }
  for (const n of names) {
    const c = d.conflicts.find(x => x?.author === n);
    if (!c || !CONFLICT_KINDS.includes(c.kind)) push('error', 'conflicts', `No competing-interests statement for ${n}`, n);
    else if (c.kind !== 'none' && !has(c.text)) push('error', 'conflicts', `${n} declares ${c.kind === 'financial' ? 'a financial' : 'a non-financial'} interest without describing it`, n);
  }
  const known = new Set(names);
  const stale = new Set([...Object.keys(d.contributions), ...Object.keys(d.icmje), ...d.conflicts.map(c => c?.author)].filter(n => n && !known.has(n)));
  for (const n of stale) push('warning', 'authors', `${n} has declarations but is not an author`, n);
  if (!fundingGiven(d)) push('error', 'funding', 'Funding is neither stated nor declared as none');
  const eNeed = ethicsNeed(researchType);
  if (eNeed && !ethicsGiven(d.ethics)) push(eNeed, 'ethics', 'No ethics approval or waiver is stated');
  const cNeed = consentNeed(researchType);
  if (cNeed && !consentGiven(d.consent)) push(cNeed, 'consent', 'No consent statement');
  if (!dataGiven(d.dataAvailability)) push('error', 'dataAvailability', 'No data availability statement');
  return out;
}

// ---- statements ------------------------------------------------------------------

const initials = name => name.split(/[\s.]+/).filter(Boolean).map(w => w.split('-').map(p => p[0]?.toUpperCase() || '').join('-')).join('');
const list = xs => xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`;
const sentence = s => { const t = String(s || '').trim(); return !t ? '' : /[.!?)\]]$/.test(t) ? t : `${t}.`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-09-29" as "29 September 2026"; anything else as written. */
export function longDate(d) {
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

function contributionsText(d, names, style) {
  if (!names.length) return '[Author contributions: list each author with their CRediT roles.]';
  const label = n => style === 'icmje' ? initials(n) : n;
  const lines = names.map(n => {
    const given = (d.contributions[n] || []).map(r => ({ role: creditRole(r?.role), degree: CREDIT_DEGREES.includes(r?.degree) ? r.degree : '' })).filter(r => r.role);
    const roles = CREDIT_ROLES.map(role => given.find(g => g.role === role)).filter(Boolean)
      .map(g => g.degree ? `${g.role.name} (${g.degree})` : g.role.name);
    return `${label(n)}: ${roles.length ? roles.join(', ') : `[CRediT roles for ${n}]`}.`;
  });
  // Said only when every author has recorded criteria 3 and 4.
  const allApproved = names.every(n => d.icmje[n]?.c3 && d.icmje[n]?.c4);
  if (allApproved) lines.push(names.length === 1
    ? 'The author approved the final version of the manuscript and agrees to be accountable for all aspects of the work.'
    : 'All authors approved the final version of the manuscript and agree to be accountable for all aspects of the work.');
  return lines.join(' ');
}

function conflictsText(d, names) {
  if (!names.length) return '[Competing interests statement.]';
  const by = n => d.conflicts.find(c => c?.author === n);
  if (names.every(n => by(n)?.kind === 'none'))
    return names.length === 1 ? 'The author declares no competing interests.' : 'The authors declare no competing interests.';
  const none = names.filter(n => by(n)?.kind === 'none');
  const out = [];
  for (const n of names) {
    const c = by(n);
    if (!c || !CONFLICT_KINDS.includes(c.kind)) { out.push(`[Competing interests of ${n}.]`); continue; }
    if (c.kind === 'none') continue;
    out.push(`${n} declares ${c.kind === 'financial' ? 'financial' : 'non-financial'} interests: ${has(c.text) ? sentence(c.text) : `[describe the interests of ${n}.]`}`);
  }
  if (none.length) out.push(`${list(none)} declare${none.length === 1 ? 's' : ''} no competing interests.`);
  return out.join(' ');
}

function fundingText(d) {
  if (d.noFunding) return 'This research received no specific grant from any funding agency in the public, commercial or not-for-profit sectors.';
  const rows = d.funding.filter(f => has(f.funder));
  if (!rows.length) return '[Funding: name each funder and grant number, or state that the work received no specific funding.]';
  const parts = rows.map(f => `${f.funder.trim()}${has(f.grant) ? ` (grant ${f.grant.trim()})` : ''}${has(f.recipient) ? ` to ${f.recipient.trim()}` : ''}`);
  const out = [`This work was supported by ${list(parts)}.`];
  const roles = rows.filter(f => has(f.role)).map(f => sentence(f.role));
  out.push(roles.length ? roles.join(' ') : '[State the role of the funder in study design, data collection, analysis and interpretation, writing, and the decision to submit, or that it had none.]');
  return out.join(' ');
}

function ethicsText(d, researchType) {
  const e = d.ethics;
  const t = typeOf(researchType);
  const ref = [has(e.reference) ? `reference ${e.reference.trim()}` : '', has(e.date) ? longDate(e.date) : ''].filter(Boolean).join('; ');
  const out = [];
  if (e.waiver) out.push(`${has(e.committee) ? `${e.committee.trim()} waived the requirement for ethical approval` : 'The requirement for ethical approval was waived'}${ref ? ` (${ref})` : ''}.`);
  else if (has(e.committee)) out.push(`This study was approved by ${e.committee.trim()}${ref ? ` (${ref})` : ''}.`);
  if (has(e.text)) out.push(sentence(e.text));
  if (out.length) return out.join(' ');
  if (t?.kind === 'review') return '[Ethics: state whether approval was required for this review of published studies.]';
  return '[Ethics: name the approving committee, the reference number and the date, or state why approval was not required.]';
}

function consentText(d, researchType) {
  const c = d.consent;
  const t = typeOf(researchType);
  const whom = t?.id === 'case-report' ? 'the patient for publication of this case report and any accompanying images' : 'all participants';
  const out = [];
  if (c.type === 'written') out.push(`Written informed consent was obtained from ${whom}.`);
  else if (c.type === 'waived') out.push(`The requirement for informed consent was waived${has(d.ethics.committee) ? ` by ${d.ethics.committee.trim()}` : ''}.`);
  else if (c.type === 'not applicable') out.push('Not applicable.');
  if (has(c.text)) out.push(sentence(c.text));
  if (out.length) return out.join(' ');
  return consentNeed(researchType) ? '[Consent: state how informed consent was obtained, or who waived it.]' : '';
}

// The standard templates (the forms ICMJE's data sharing statements and most
// publishers' policies give).
function dataText(d) {
  const a = d.dataAvailability;
  if (has(a.text)) return sentence(a.text);
  const cond = has(a.conditions) ? ` ${sentence(a.conditions)}` : '';
  switch (a.choice) {
    case 'repository':
      return `The data that support the findings of this study are openly available in ${has(a.repository) ? a.repository.trim() : '[repository name]'}${has(a.doi) ? ` at ${a.doi.trim()}` : ' at [DOI or accession number]'}.${cond}`;
    case 'on request':
      return `The data that support the findings of this study are available from the corresponding author upon reasonable request.${cond}`;
    case 'in paper':
      return `All data generated or analysed during this study are included in this article and its supplementary information files.${cond}`;
    case 'not available':
      return `The data that support the findings of this study are not publicly available${has(a.conditions) ? ` because ${a.conditions.trim().replace(/^because\s+/i, '').replace(/\.$/, '')}` : ' because [reason, for example participant privacy]'}.`;
    case 'not applicable':
      return 'Data sharing is not applicable to this article as no new data were created or analysed in this study.';
    default:
      return '[Data availability: state where the data can be found, on what conditions, or why they cannot be shared.]';
  }
}

function registrationText(d, researchType) {
  const reg = String(d.trialRegistration || '').trim();
  if (!reg) return '';
  const t = typeOf(researchType);
  const what = t?.id === 'rct' ? 'This trial was registered' : t?.kind === 'review' ? 'The review protocol was registered' : 'This study was registered';
  return `${what}: ${reg.replace(/\.$/, '')}.`;
}

/**
 * Ready-to-insert statements. `style: 'plain'` names authors in full;
 * 'icmje' uses their initials, as most ICMJE-journal contribution statements do.
 * A required statement with nothing entered is a [bracketed] placeholder; an
 * optional one (AI use, acknowledgements, registration) is '' when empty.
 */
export function statements(decl, authors, { style = 'plain', researchType = null } = {}) {
  const d = normalizeDeclarations(decl);
  const names = namesOf(authors);
  return {
    contributions: contributionsText(d, names, style),
    conflicts: conflictsText(d, names),
    funding: fundingText(d),
    ethics: ethicsText(d, researchType),
    consent: consentText(d, researchType),
    dataAvailability: dataText(d),
    aiUse: has(d.aiUse) ? sentence(d.aiUse) : '',
    acknowledgements: has(d.acknowledgements) ? sentence(d.acknowledgements) : '',
    registration: registrationText(d, researchType),
  };
}

// Headings the manuscript structure already recognises as back matter
// (lib/manuscript-structure.mjs), in the order most journals print them.
export const STATEMENT_HEADINGS = [
  ['acknowledgements', 'Acknowledgements'],
  ['contributions', 'Author contributions'],
  ['funding', 'Funding'],
  ['conflicts', 'Competing interests'],
  ['ethics', 'Ethics approval'],
  ['consent', 'Informed consent'],
  ['registration', 'Registration'],
  ['dataAvailability', 'Data availability'],
  ['aiUse', 'Use of artificial intelligence'],
];

const block = (type, text, runs) => ({ id: newId(), type, text, ...(runs ? { runs } : {}) });

/** The statements as manuscript blocks, an h2 and a paragraph each, for the end of the manuscript; empty optional ones are left out. */
export function statementBlocks(decl, authors, opts = {}) {
  const s = statements(decl, authors, opts);
  return STATEMENT_HEADINGS.filter(([k]) => s[k]).flatMap(([k, h]) => [block('h2', h), block('p', s[k])]);
}

// ---- title page --------------------------------------------------------------------

const SYMBOLS = ['*', '†', '‡', '§', '¶'];
const affiliationsOf = a => (Array.isArray(a?.affiliations) ? a.affiliations : String(a?.affiliation || '').split(/\s*;\s*/))
  .map(x => String(x || '').trim()).filter(Boolean);

/**
 * The title page as `{ blocks, warnings }`.
 *
 * `authors` default to `paper.authors`: `{ name, affiliation (";"-separated) or
 * affiliations[], email?, orcid?, corresponding?, equal?, address? }`.
 * `affiliations` optionally overrides them by author name ({ [name]: string[] }).
 * Affiliations are numbered in order of first appearance, so two authors at one
 * institution share its number. The corresponding author (author.corresponding,
 * else paper.correspondingAuthor) takes the first footnote symbol; equal
 * contribution the next. `correspondence` ({ name, address, email, phone })
 * overrides the corresponding author's details. `runningTitle` is warned about
 * over `runningTitleLimit` characters (default 50, counting spaces).
 * `counts` is { abstract, main, tables, figures, references } as the caller
 * measured them; `keywords` a list or a ";"-separated string.
 */
export function titlePage({ paper = {}, authors, affiliations = null, correspondence = null, runningTitle = '', runningTitleLimit = 50, keywords = [], counts = null } = {}) {
  const warnings = [];
  const people = (authors || paper.authors || []).filter(a => nameOf(a));
  const affOf = a => (affiliations?.[nameOf(a)] ? [].concat(affiliations[nameOf(a)]).map(x => String(x).trim()).filter(Boolean) : affiliationsOf(a));
  const numbers = new Map();
  for (const a of people) for (const x of affOf(a)) if (!numbers.has(x)) numbers.set(x, numbers.size + 1);

  const correspondingName = people.find(a => a.corresponding)?.name || paper.correspondingAuthor || '';
  const corresponding = people.find(a => nameOf(a) === String(correspondingName).trim()) || null;
  if (people.length && !corresponding && !correspondence?.name) warnings.push({ key: 'corresponding', text: 'No corresponding author is marked' });
  const equal = people.filter(a => a.equal || a.equalContribution);
  if (equal.length === 1) warnings.push({ key: 'equal', text: `${nameOf(equal[0])} is the only author marked as contributing equally` });
  const notes = [];
  if (corresponding || correspondence?.name) notes.push({ key: 'corresponding', text: 'Corresponding author.' });
  if (equal.length) notes.push({ key: 'equal', text: `${list(equal.map(nameOf))} contributed equally to this work.` });
  notes.forEach((n, i) => { n.symbol = SYMBOLS[i]; });
  const sym = key => notes.find(n => n.key === key)?.symbol || '';

  const blocks = [block('h1', String(paper.title || '').trim() || '[Title]')];
  if (people.length) {
    const runs = [];
    people.forEach((a, i) => {
      if (i) runs.push({ t: ', ' });
      runs.push({ t: nameOf(a) });
      const nums = affOf(a).map(x => numbers.get(x)).join(',');
      const marks = (a === corresponding ? sym('corresponding') : '') + (equal.includes(a) ? sym('equal') : '');
      const sup = nums + marks;
      if (sup) runs.push({ t: sup, sup: true });
    });
    blocks.push(block('p', runs.map(r => r.t).join(''), runs));
  } else blocks.push(block('p', '[Authors]'));
  const missingAff = people.filter(a => !affOf(a).length).map(nameOf);
  if (missingAff.length) warnings.push({ key: 'affiliations', text: `No affiliation for ${list(missingAff)}` });

  for (const [aff, n] of numbers) blocks.push(block('p', `${n} ${aff}`, [{ t: String(n), sup: true }, { t: ` ${aff}` }]));
  for (const n of notes) blocks.push(block('p', `${n.symbol} ${n.text}`, [{ t: n.symbol, sup: true }, { t: ` ${n.text}` }]));

  // Correspondence: the corresponding author's details, overridden field by field.
  const c = { name: nameOf(corresponding), address: corresponding?.address || affOf(corresponding || {})[0] || '', email: corresponding?.email || '', phone: corresponding?.phone || '', ...(correspondence || {}) };
  if (has(c.name)) {
    const parts = [`Correspondence: ${c.name.trim()}`, has(c.address) ? c.address.trim() : '[postal address]', `email: ${has(c.email) ? c.email.trim() : '[email]'}`];
    if (has(c.phone)) parts.push(`telephone: ${c.phone.trim()}`);
    blocks.push(block('p', `${parts.join(', ')}.`));
    if (!has(c.email)) warnings.push({ key: 'email', text: `No email for the corresponding author, ${c.name.trim()}` });
  }

  const rt = String(runningTitle || '').trim();
  if (rt) {
    blocks.push(block('p', `Running title: ${rt}`));
    if (runningTitleLimit && rt.length > runningTitleLimit)
      warnings.push({ key: 'runningTitle', text: `The running title is ${rt.length} characters, over the limit of ${runningTitleLimit}` });
  }

  if (counts) {
    const n = x => Number(x).toLocaleString('en-US');
    const parts = [];
    if (counts.abstract != null) parts.push(`abstract ${n(counts.abstract)}`);
    if (counts.main != null) parts.push(`main text ${n(counts.main)}`);
    const tail = [['tables', 'Tables'], ['figures', 'Figures'], ['references', 'References']].filter(([k]) => counts[k] != null).map(([k, l]) => `${l}: ${n(counts[k])}`);
    const text = [parts.length ? `Word count: ${parts.join('; ')}` : '', ...tail].filter(Boolean).join('. ');
    if (text) blocks.push(block('p', `${text}.`));
  }

  const kw = (Array.isArray(keywords) ? keywords : String(keywords || '').split(/\s*[;,]\s*/)).map(k => String(k).trim()).filter(Boolean);
  if (kw.length) blocks.push(block('p', `Keywords: ${kw.join('; ')}`));
  return { blocks, warnings };
}

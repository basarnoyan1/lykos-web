// A submission cover letter as manuscript blocks.
//
// The letter says only what the project records (title, journal, authors,
// declarations, registration, preprint) and the standard declarations a
// journal asks the submitting author to make. What the study found and why it
// suits the journal is the authors' to write, so those sentences are
// [bracketed] placeholders; nothing here summarises or praises the work.
//
// Pure: nothing here imports the store or a view.
import { newId } from './manuscript.mjs';
import { typeById } from './research-types.mjs';
import { statements, longDate } from './declarations.mjs';

const block = (type, text, runs) => ({ id: newId(), type, text, ...(runs ? { runs } : {}) });
const has = s => !!String(s ?? '').trim();
const clean = s => String(s ?? '').trim();

// The article type a journal would file the manuscript under, from the research type.
const ARTICLE_TYPE = { 'case-report': 'case report', 'case-series': 'case series', guideline: 'clinical practice guideline', 'qi-project': 'quality improvement report' };
/** "a systematic review", "an original research article"; a placeholder for a type that names none. */
export function articleType(researchType) {
  const t = typeof researchType === 'string' ? typeById(researchType) : researchType;
  const name = !t || t.kind === 'other' ? '' : ARTICLE_TYPE[t.id] || (t.kind === 'review' ? t.label.toLowerCase() : 'original research article');
  if (!name) return '[article type]';
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

const nameOf = a => clean(typeof a === 'string' ? a : a?.name);
/** The corresponding author: `corresponding` on an author, else paper.correspondingAuthor, else the first author. */
export function correspondingAuthor(paper = {}, authors = paper.authors || []) {
  const people = (authors || []).filter(a => nameOf(a));
  return people.find(a => a.corresponding) || people.find(a => nameOf(a) === clean(paper.correspondingAuthor)) || people[0] || null;
}

const person = r => typeof r === 'string' ? { name: r } : (r || {});
function reviewerLine(r, excluded) {
  const p = person(r);
  const who = [clean(p.name) || '[name]', clean(p.affiliation), clean(p.email)].filter(Boolean).join(', ');
  const reason = clean(p.reason);
  if (excluded) return `${who}. Reason: ${reason || '[reason]'}`;
  return reason ? `${who}. ${reason}` : who;
}

/**
 * The letter as blocks: date, salutation, the submission, the findings and fit
 * (placeholders), highlights if given, the standard statements, reviewer
 * suggestions and exclusions, and the sign-off.
 *
 * `authors` default to paper.authors. `journal` defaults to paper.journal.
 * `editor` is a name as it should follow "Dear" ("Dr Jane Roe"); without one
 * the letter opens "Dear Editor,". `declarations` is state.declarations; its
 * competing-interests statement is quoted. `highlights` are the authors' own
 * sentences. Reviewers are names or { name, affiliation, email, reason }.
 * `preprint` is a string (server and DOI) or { server, doi }. `date` is a Date
 * or an ISO date; today when omitted.
 */
export function coverLetter({ paper = {}, authors, journal, editor = '', researchType = null, declarations = null, highlights = [], suggestedReviewers = [], excludedReviewers = [], preprint = null, date = new Date() } = {}) {
  const people = (authors || paper.authors || []).filter(a => nameOf(a));
  const title = clean(paper.title) || '[manuscript title]';
  const venue = clean(journal ?? paper.journal) || '[journal]';
  const out = [];
  const p = text => out.push(block('p', text));

  p(longDate(date));
  p(has(editor) ? `Dear ${clean(editor)},` : 'Dear Editor,');
  p(`Please consider our manuscript entitled “${title}” for publication as ${articleType(researchType)} in ${venue}.`);
  p(`[State the question the study addresses and its main finding in one or two sentences.] [Explain why the work matters to the readers of ${venue}.]`);
  const hl = (highlights || []).map(clean).filter(Boolean);
  if (hl.length) {
    p('The main points of the manuscript are:');
    hl.forEach(h => p(`• ${h}`));
  }

  // The standard declarations of a submission.
  const pre = typeof preprint === 'string' ? clean(preprint) : [clean(preprint?.server), clean(preprint?.doi)].filter(Boolean).join(', ');
  p(pre
    ? `This manuscript has not been published in a peer-reviewed journal and is not under consideration for publication elsewhere. A preprint has been posted (${pre}).`
    : 'This manuscript has not been published and is not under consideration for publication elsewhere.');
  p(people.length > 1
    ? `All authors have read and approved the manuscript and agree with its submission to ${venue}.`
    : `The author has approved the manuscript and its submission to ${venue}.`);
  p(declarations ? statements(declarations, people, { researchType }).conflicts : '[Competing interests statement.]');
  const reg = clean(paper.registration);
  if (reg) {
    const t = typeof researchType === 'string' ? typeById(researchType) : researchType;
    p(`${t?.id === 'rct' ? 'The trial was registered' : t?.kind === 'review' ? 'The review protocol was registered' : 'The study was registered'}: ${reg.replace(/\.$/, '')}.`);
  }

  const sug = (suggestedReviewers || []).filter(r => has(person(r).name));
  if (sug.length) {
    p('We suggest the following reviewers:');
    sug.forEach(r => p(`• ${reviewerLine(r, false)}`));
  }
  const exc = (excludedReviewers || []).filter(r => has(person(r).name));
  if (exc.length) {
    p('We ask that the following not review this manuscript:');
    exc.forEach(r => p(`• ${reviewerLine(r, true)}`));
  }

  p('Thank you for considering our manuscript.');
  p('Sincerely,');
  const c = correspondingAuthor(paper, people);
  if (c) {
    const aff = Array.isArray(c.affiliations) ? c.affiliations[0] : clean(c.affiliation).split(/\s*;\s*/)[0];
    const lines = [nameOf(c), aff, c.address, c.email ? `Email: ${clean(c.email)}` : 'Email: [email]', c.orcid ? `ORCID: ${clean(c.orcid)}` : ''].map(clean).filter(Boolean);
    lines.forEach(l => p(l));
    if (people.length > 1) p('On behalf of all authors');
  } else p('[Corresponding author name, affiliation and email]');
  return out;
}

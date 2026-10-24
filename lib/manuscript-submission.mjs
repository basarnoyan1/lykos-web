// Where the submission modules meet the manuscript and the project: the stored
// journal profile, the declarations as readiness counts them, the review
// rounds, and the edits the Manuscript view makes with them (abstract
// headings, declaration statements placed before the reference list).
//
// Pure: the view (views/manuscript-submission.mjs) calls these with the
// document's blocks and the project's records and commits what comes back.
import { abstractTemplate } from './journal-profiles.mjs';
import { normalizePoint } from './journal-profile-state.mjs';
export { VARIETIES, normalizeJournalProfile, activeProfile, normalizeReviewRounds } from './journal-profile-state.mjs';
import { submissionRoles, countsAgainstProfile } from './submission-checks.mjs';
import { normalizeDeclarations, validate } from './declarations.mjs';
import { splitComments } from './reviewer-response.mjs';
import { newId } from './manuscript.mjs';

const HEADING = /^h[1-3]$/;
const level = b => HEADING.test(b?.type) ? Number(b.type[1]) : 0;
const plain = t => String(t || '').replace(/\[@[^\]]*\]|\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim();
const bare = t => plain(t).replace(/^((\d+(\.\d+)*|[IVXLC]+)[.)]?\s+)/, '').replace(/[.:]\s*$/, '').trim();
const REFERENCES = /^(references?|reference list|bibliography|literature cited|works cited)$/i;
const ABSTRACT = /^(abstract|summary|structured abstract)$/i;
const KEYWORDS = /^(key ?words?|index terms)\s*[:.]/i;
// ---- declarations as readiness counts them -----------------------------------

const has = s => !!String(s ?? '').trim();

/**
 * Which statements the declarations already make, by requirement id
 * (lib/journal-profiles.mjs REQUIREMENTS), for readinessReport. A statement
 * counts when validate() finds nothing wrong with it and something was entered.
 */
export function declaredStatements(decl, paper = {}, researchType = null) {
  const authors = (paper?.authors || []).filter(a => has(a?.name ?? a));
  const d = normalizeDeclarations(decl, paper);
  const issues = validate(d, authors, { researchType });
  const clear = key => !issues.some(i => i.key === key && i.level === 'error');
  return {
    coi: authors.length > 0 && clear('conflicts'),
    funding: clear('funding'),
    dataAvailability: clear('dataAvailability') && (has(d.dataAvailability.choice) || has(d.dataAvailability.text)),
    ethics: has(d.ethics.committee) || has(d.ethics.text) || !!d.ethics.waiver,
    consent: has(d.consent.type) || has(d.consent.text),
    credit: authors.length > 0 && clear('contributions'),
    registration: has(d.trialRegistration),
    orcid: authors.length > 0 && authors.every(a => has(a?.orcid)),
  };
}

// ---- review rounds -------------------------------------------------------------

/** A new round from a pasted decision letter: its comments, each with empty response fields. */
export function roundFromLetter(text, { journal = '', manuscriptId = '', at = new Date().toISOString() } = {}) {
  return { id: newId(), at, journal: String(journal || ''), manuscriptId: String(manuscriptId || ''),
    points: splitComments(text).map(p => normalizePoint({ ...p, id: newId() })) };
}

// ---- placing blocks ----------------------------------------------------------------

/**
 * Where the back matter goes: before the reference list (the generated list,
 * with the References heading right above it, or a References heading), else
 * at the end.
 */
export function beforeReferences(blocks) {
  const bib = blocks.findIndex(b => b.type === 'bib');
  if (bib >= 0) {
    let at = bib;
    while (at > 0 && blocks[at - 1].type === 'p' && !plain(blocks[at - 1].text)) at--;
    return at > 0 && level(blocks[at - 1]) && REFERENCES.test(bare(blocks[at - 1].text)) ? at - 1 : bib;
  }
  const head = blocks.findIndex(b => level(b) && REFERENCES.test(bare(b.text)));
  return head >= 0 ? head : blocks.length;
}

/** A heading's section: from the heading up to the next heading or reference list. */
function sectionEnd(blocks, i) {
  let j = i + 1;
  while (j < blocks.length && !level(blocks[j]) && blocks[j].type !== 'bib') j++;
  return j;
}

/**
 * The sections already in the document under any of these headings, as
 * [start, end) ranges. Headings inside the abstract are not statements: a
 * CONSORT or PRISMA abstract has its own "Funding" and "Registration" parts.
 */
export function sectionsHeaded(blocks, headings) {
  const names = new Set(headings.map(h => h.toLowerCase()));
  const roles = submissionRoles(blocks);
  const out = [];
  blocks.forEach((b, i) => { if (level(b) && roles[i] !== 'abstract' && names.has(bare(b.text).toLowerCase())) out.push([i, sectionEnd(blocks, i)]); });
  return out;
}

const headingsOf = made => made.filter(b => level(b)).map(b => bare(b.text));

/** The headings of `made` the document already has, in document order. */
export function existingStatements(blocks, made) {
  return sectionsHeaded(blocks, headingsOf(made)).map(([i]) => bare(blocks[i].text));
}

/**
 * The document with the statement blocks placed before the reference list.
 * With `replace`, sections under the same headings are taken out first, so a
 * second insertion replaces the first rather than repeating it.
 * Returns { blocks, removed } (removed: the headings taken out).
 */
export function insertStatements(blocks, made, { replace = true } = {}) {
  let out = [...blocks];
  const removed = [];
  if (replace) {
    const ranges = sectionsHeaded(out, headingsOf(made));
    for (const [a, b] of [...ranges].reverse()) { removed.unshift(bare(out[a].text)); out.splice(a, b - a); }
  }
  const at = beforeReferences(out);
  out.splice(at, 0, ...made);
  return { blocks: out, removed };
}

// ---- abstract headings ------------------------------------------------------------

/** The Abstract heading's index and its section's end, or null. */
function abstractSection(blocks) {
  const i = blocks.findIndex(b => level(b) && ABSTRACT.test(bare(b.text)));
  if (i < 0) return null;
  let j = i + 1;
  while (j < blocks.length && !(level(blocks[j]) && level(blocks[j]) <= level(blocks[i])) && blocks[j].type !== 'bib') j++;
  return { at: i, end: j };
}

/** Whether the document has an abstract with any words in it. */
export function hasAbstract(blocks) {
  const sec = abstractSection(blocks);
  if (sec) return blocks.slice(sec.at + 1, sec.end).some(b => plain(b.text) && !level(b) && !KEYWORDS.test(plain(b.text)));
  const roles = submissionRoles(blocks);
  return blocks.some((b, i) => roles[i] === 'abstract' && plain(b.text));
}

/** Whether abstract headings can go in: no abstract text, and no headings already under Abstract. */
export function canInsertAbstract(blocks) {
  if (hasAbstract(blocks)) return false;
  const sec = abstractSection(blocks);
  return !sec || !blocks.slice(sec.at + 1, sec.end).some(b => level(b));
}

/**
 * The document with the profile's abstract headings inserted: under an empty
 * Abstract heading when there is one, else as a new Abstract section after the
 * title, authors and affiliations. Null when the document already has an
 * abstract with text or headings, which is never overwritten or repeated.
 * Returns { blocks, focusId } (focusId: the first empty paragraph to type in).
 */
export function insertAbstract(blocks, profile) {
  if (!canInsertAbstract(blocks)) return null;
  const sec = abstractSection(blocks);
  const out = [...blocks];
  let made;
  if (sec) {
    // An empty Abstract heading keeps its level; the parts go one level below it.
    const sub = `h${Math.min(3, level(out[sec.at]) + 1)}`;
    made = abstractTemplate(profile, { withHeading: false }).map(b => HEADING.test(b.type) ? { ...b, type: sub } : b);
    // its empty paragraphs give way; a keywords line under it stays
    const kept = out.slice(sec.at + 1, sec.end).filter(b => plain(b.text) || b.type !== 'p');
    out.splice(sec.at + 1, sec.end - sec.at - 1, ...made, ...kept);
  } else {
    const roles = submissionRoles(blocks);
    let at = 0;
    while (at < out.length && (out[at].type === 'h1' || ['title', 'authors', 'affiliations'].includes(roles[at]))) at++;
    made = abstractTemplate(profile);
    out.splice(at, 0, ...made);
  }
  return { blocks: out, focusId: made.find(b => b.type === 'p')?.id || null };
}

// ---- the paper's people, for the title page and a blinded copy ----------------------

/**
 * The counts a title page states, measured as the submission checks measure
 * them: abstract and main-text words, references, and figures and tables
 * (main assets and those placed in the document).
 */
export function titlePageCounts(blocks, assets = [], { notes = {}, section = null } = {}) {
  const rows = countsAgainstProfile(blocks, {}, { assets, notes, section });
  const v = what => rows.find(r => r.what === what)?.value ?? 0;
  const main = kind => assets.filter(a => a.kind === kind).length + blocks.filter(b => b.type === kind).length;
  return { abstract: v('Abstract words'), main: v('Words in main text'), tables: main('table'), figures: main('figure'), references: v('References') };
}

/** Author names and affiliations as blindedCopy takes them. */
export function blindingInputs(paper = {}) {
  const authors = (paper?.authors || []).map(a => String(a?.name ?? a ?? '').trim()).filter(Boolean);
  const affiliations = [...new Set((paper?.authors || []).flatMap(a => String(a?.affiliation || '').split(/\s*;\s*/)).map(s => s.trim()).filter(Boolean))];
  return { authors, affiliations };
}

/** The paper's authors as the title page takes them, the corresponding author marked. */
export function titlePageAuthors(paper = {}) {
  return (paper?.authors || []).filter(a => String(a?.name || '').trim())
    .map(a => ({ ...a, ...(paper.correspondingAuthor && a.name === paper.correspondingAuthor ? { corresponding: true } : {}) }));
}

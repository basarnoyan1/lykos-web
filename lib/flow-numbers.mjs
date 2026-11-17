// The flow numbers a manuscript states, as the PRISMA figure draws them and as the project counts them (Fable review F8, 8 Nov 2026: ASD's
// 512, 178 and 21 appeared in three places and nothing compared them). Read from the same counts as the figure's rows (lib/submission.mjs
// prismaCountRows, which lib/review-flow.mjs reviewCountRows gives): the project's own (derive) and a count entered by hand over it. Kept
// apart from those so the manuscript's checks load nothing more than they did (review-flow.mjs reaches 130 more modules through
// submission.mjs); lib/manuscript-checks.mjs flowNumberRows reads them against the text.
import { derive } from './prisma-counts.mjs';
import { reviewOf, scoped } from './reviews.mjs';

// The flow numbers by the PRISMA 2020 counts that make each: [id, label, databases and registers, other methods]. Records screened adds
// the records found by other methods, since Screening screens them too (PRISMA draws them straight to "sought").
const OTHER_RECORDS = ['website_results', 'organisation_results', 'citations_results', 'other_sources_results'];
const FLOW_NUMBERS = [
  ['identified', 'Records identified', ['database_results', 'register_results'], OTHER_RECORDS],
  ['duplicates', 'Duplicate records removed', ['duplicates'], []],
  ['screened', 'Records screened', ['records_screened'], OTHER_RECORDS],
  ['sought', 'Reports sought for retrieval', ['dbr_sought_reports'], ['other_sought_reports']],
  ['assessed', 'Reports assessed for eligibility', ['dbr_assessed'], ['other_assessed']],
  ['studies', 'Studies included', ['new_studies'], []],
  ['reports', 'Reports of included studies', ['new_reports'], []],
];
// ---- the words ------------------------------------------------------------------------------------------------------------
// What a number in a text counts in the flow, by the words after it and, for some phrasings, before it: [before or null, after or null],
// both to fit. The first box that fits wins, so "sought" comes before the bare "full-text reports" of assessed. One set for the
// manuscript's paragraphs (lib/manuscript-checks.mjs, which still holds its own copy) and the built Word file's checked numbers
// (lib/cross-checks.mjs). "4493 records found" is a search strategy's count of one database (a supplement's eMethods), not a box: "found" is
// not read. "studies included patients with" is a subset, so "were" stays required after studies and reports.
export const FLOW_WORDS = [
  ['identified', [[null, /^\s*(?:(?:unique|deduplicated)\s+)?(?:records?|citations?)\s+(?:were\s+)?identified\b/i], [null, /^\s*(?:were\s+)?identified\b/i],
    [/\b(?:searches|search)\s+(?:identified|returned|yielded)\s+(?:a\s+total\s+of\s+)?$/i, /^\s*(?:(?:unique|potentially\s+relevant)\s+)?(?:records?|citations?|references?|articles?)\b/i],
    [/\b(?:searches|search)\s+(?:identified|returned|yielded)\s+$/i, null]]],
  ['duplicates', [[null, /^\s*duplicate(?:s|\s+(?:records?|reports?|citations?))\b/i]]],
  ['screened', [[null, /^\s*(?:(?:unique|deduplicated|remaining|database|databases|and|registry|register|registers)\s+){0,4}(?:records?|titles?(?:\s+and\s+abstracts?)?|citations?|articles?)\s+(?:were\s+)?screened\b/i],
    [null, /^\s*screened\s+records?\b/i],
    [/\bscreened\s+(?:the\s+)?(?:titles?\s+and\s+abstracts?\s+of\s+)?$/i, /^\s*(?:(?:unique|deduplicated|remaining)\s+)?(?:records?|titles?|citations?|articles?|abstracts?)\b/i],
    [/\bwe\s+screened\s+$/i, null]]],
  ['sought', [[null, /^\s*(?:full[- ]text\s+)?(?:reports?|articles?|papers?|records?)\s+(?:were\s+)?sought\b/i]]],
  // a bare "records were assessed" is the full-text box only with its stage named ("for risk of bias" or "at the title stage" is not it)
  ['assessed', [[null, /^\s*(?:reports?|articles?|papers?|records?)\s+(?:were\s+)?(?:assessed|reviewed|read)\s+(?:in\s+full(?:[- ]text)?|for\s+(?:full[- ]text\s+)?eligibility|(?:at|as)\s+(?:the\s+)?full[- ]text)\b/i],
    [null, /^\s*full[- ]text\s+(?:reports?|articles?|records?|papers?)\b(?!\s+(?:were\s+)?sought)/i],
    [null, /^\s*were\s+assessed\s+(?:in\s+full(?:[- ]text)?|for\s+eligibility|at\s+full[- ]text)\b/i]]],
  ['studies', [[null, /^\s*(?:randomi[sz]ed\s+(?:controlled\s+)?)?(?:trials|studies|RCTs)\s+were\s+included\b/i], [null, /^\s*included\s+(?:trials|studies|RCTs)\b/i],
    [/\b(?:we\s+)?included\s+(?:a\s+total\s+of\s+)?$/i, /^\s*(?:randomi[sz]ed\s+(?:controlled\s+)?)?(?:trials|studies|RCTs)\b/i]]],
  ['reports', [[null, /^\s*reports?\s+(?:of\s+\d[\d,]*\s+(?:trials|studies)\s+)?were\s+included\b/i], [null, /^\s*included\s+reports\b/i]]],
];
// what follows a box's words and makes it a subset or a method, not the box: "were included in the meta-analysis", "were screened by two reviewers"
// (15 Nov 2026) a clause that names a part of the box ("the 47 included studies that could not enter the primary analysis", "studies not
// pooled", "outside the primary analysis") counts a subset, not the box
export const NOT_BOX = /^\s*(?:by\b|in\s+duplicate|independently|twice|again|in\s+(?:the|a|an|each)\s+(?!(?:systematic\s+)?review\b)|in\s+(?:primary|meta|pooled|sensitivity|subgroup)|for\s+(?:the\s+)?(?:primary|meta|pooled|analysis)|(?:that|which|who|whose)\s+(?:\w+\s+){0,2}not\b|(?:not|never)\s+(?:in|pooled|entered|entering|included\s+in|analysed|analyzed)\b|outside\b|excluded\s+from\b)/i;
/** The box a number counts, by the text before it (about 40 characters) and after it (about 80): its id in FLOW_WORDS, or null. */
export function flowBoxAt(before, after) {
  const b = String(before || ''), a = String(after || '');
  const box = FLOW_WORDS.find(([, ways]) => ways.some(([pre, post]) => {
    if (pre && !pre.test(b)) return false;
    if (!post) return !!pre;
    const x = post.exec(a);
    return x && !NOT_BOX.test(a.slice(x.index + x[0].length));
  }));
  return box ? box[0] : null;
}

const blank = v => v == null || String(v).trim() === '';
// a count, or the sum of a "name, n; name, n" list (other sources by name), or null
const countOf = v => {
  if (blank(v)) return null;
  if (Number.isFinite(Number(v))) return Number(v);
  const xs = String(v).split(';').map(x => Number(x.slice(x.lastIndexOf(',') + 1).trim())).filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
};

/**
 * [{ id, label, project, figure }]: `figure` as the figure draws it (a count entered by hand wins), `project` as the project counts it, each
 * { total, parts } with parts [databases and registers, other methods] when both columns hold one. A number neither has is left out; a
 * PRISMA-IPD review has none yet.
 */
export function reviewFlowNumbers(s, id) {
  const r = reviewOf(s, id);
  if (r.template === 'prisma-ipd') return [];
  const st = scoped(s, r.id), d = derive(st), entered = st.prisma || {};
  const figureOf = f => countOf(blank(entered[f]) ? d[f] : entered[f]), projectOf = f => countOf(d[f]);
  const side = (read, db, other) => {
    const sum = fields => { const v = fields.map(read).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
    const a = sum(db), b = sum(other);
    return a == null && b == null ? null : { total: (a ?? 0) + (b ?? 0), parts: a != null && b ? [a, b] : null };
  };
  return FLOW_NUMBERS.map(([key, label, db, other]) => ({ id: key, label, project: side(projectOf, db, other), figure: side(figureOf, db, other) }))
    .filter(x => x.project || x.figure);
}

// Reviews within one project (plan §2, Reporting): a paper may report several reviews, each with its own
// searches, counts, included set, template and figure (say a PRISMA-IPD review and a PRISMA 2020 review).
// The main review's counts stay in s.prisma, s.prismaIpd, s.prismaNotes and s.prismaArms, so a one-review
// project is unchanged; a further review is an entry of s.reviews with its own counts, and a search is its
// own when the log entry says `review: <id>`. `scoped(s, id)` is the project as one review sees it, so every
// PRISMA function reads that review unchanged. No imports: the query layer reads `ownRun` from here.

export const MAIN = 'main';
export const TEMPLATES = [['prisma-2020', 'PRISMA 2020'], ['prisma-ipd', 'PRISMA-IPD']];
export const templateName = id => TEMPLATES.find(([k]) => k === id)?.[1] || 'PRISMA 2020';
const RECORDS = ['library', 'hand'];

/** A search the main review counts: one no other review has claimed. */
export const ownRun = r => !r?.review || r.review === MAIN;

/** The main review's template when none is chosen: PRISMA-IPD once the PRISMA-IPD extension is reported, else PRISMA 2020. */
const defaultTemplate = s => (s.checklistChoice?.extensions || []).includes('prisma-ipd') ? 'prisma-ipd' : 'prisma-2020';

/** Every review, the main one first: { id, name, template, records, main }. */
export function reviewsOf(s) {
  const list = Array.isArray(s?.reviews) ? s.reviews : [];
  const own = list.find(r => r.id === MAIN) || {};
  const main = { id: MAIN, name: own.name || (list.some(r => r.id !== MAIN) ? 'Main review' : 'Review'), template: own.template || defaultTemplate(s || {}), records: 'library', main: true };
  return [main, ...list.filter(r => r.id && r.id !== MAIN).map(r => ({ id: r.id, name: r.name || 'Untitled review', template: r.template || 'prisma-2020',
    records: RECORDS.includes(r.records) ? r.records : 'hand', main: false }))];
}
export const reviewOf = (s, id) => reviewsOf(s).find(r => r.id === id) || reviewsOf(s)[0];
/** The review a search belongs to (an unknown id is the main review's). */
export const runReview = (s, run) => (ownRun(run) || !reviewsOf(s).some(r => r.id === run.review)) ? MAIN : run.review;

/** The searches of one review, in log order, with their index in the log. */
export function runsOf(s, id) {
  return (s.searches || []).map((r, i) => ({ r, i })).filter(({ r }) => runReview(s, r) === (reviewOf(s, id).id));
}

const EMPTY_RECORDS = { papers: [], screening: {}, fulltext: {}, merged: [], participants: [], survival: undefined };
/** The project as one review sees it. The main review is the project itself, less the searches other reviews claim. */
export function scoped(s, id = MAIN) {
  const r = reviewOf(s, id);
  if (r.main) {
    const known = new Set(reviewsOf(s).map(x => x.id));
    const searches = (s.searches || []).filter(x => ownRun(x) || !known.has(x.review));
    return searches.length === (s.searches || []).length ? s : { ...s, searches };
  }
  const own = s.reviews.find(x => x.id === r.id);
  // A search a review claims is one of its protocol searches, whatever the log called it before (an imported table marks another review's searches exploratory).
  const searches = (s.searches || []).filter(x => x.review === r.id).map(x => ({ ...x, review: undefined, exploratory: false }));
  return { ...s, ...(r.records === 'hand' ? EMPTY_RECORDS : {}), searches,
    prisma: own.prisma || {}, prismaIpd: own.prismaIpd || {}, prismaNotes: own.notes || {}, prismaArms: own.arms || {}, searchStrategy: { ...(s.searchStrategy || {}), ...(own.searchStrategy || {}) } };
}

const KEY = { prisma: 'prisma', prismaIpd: 'prismaIpd', prismaNotes: 'notes', prismaArms: 'arms', searchStrategy: 'searchStrategy' };
/** Writes one of a review's own keys (prisma, prismaIpd, prismaNotes, prismaArms, searchStrategy) into the project state `st`. */
export function setReviewKey(st, id, key, value) {
  if (!KEY[key]) throw new Error(`not a review key: ${key}`);
  const r = reviewOf(st, id);
  if (r.main) { st[key] = value; return st; }
  st.reviews = st.reviews.map(x => x.id === r.id ? { ...x, [KEY[key]]: value } : x);
  return st;
}
/** Reads a review's own key from the project state, as `scoped` gives it. */
export const reviewKey = (st, id, key) => scoped(st, id)[key] || {};

const newId = st => { let n = (st.reviews || []).length + 1; while ((st.reviews || []).some(r => r.id === `r${n}`)) n++; return `r${n}`; };
/** Adds a review (counts entered by hand until its records are the library's) and returns its id. */
export function addReview(st, { name = '', template = 'prisma-2020', records = 'hand' } = {}) {
  const id = newId(st);
  st.reviews = [...(st.reviews || []), { id, name: name || `Review ${reviewsOf(st).length + 1}`, template, records }];
  return id;
}
/** Names, template or records of a review; the main review keeps its entry for name and template only. */
export function editReview(st, id, patch) {
  const r = reviewOf(st, id), list = st.reviews || [];
  const keep = r.main ? ['name', 'template'] : ['name', 'template', 'records'];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => keep.includes(k)));
  st.reviews = list.some(x => x.id === r.id) ? list.map(x => x.id === r.id ? { ...x, ...clean } : x) : [{ id: MAIN, ...clean }, ...list];
  return st;
}
/** Removes a review: its searches go back to the main review; its counts go with it. */
export function removeReview(st, id) {
  if (id === MAIN) return st;
  st.reviews = (st.reviews || []).filter(x => x.id !== id);
  st.searches = (st.searches || []).map(x => x.review === id ? (({ review, ...rest }) => rest)(x) : x);
  return st;
}
/** Gives the search at `index` of the log to a review (MAIN gives it back). */
export function assignSearch(st, index, id) {
  st.searches = (st.searches || []).map((x, i) => {
    if (i !== index) return x;
    if (id === MAIN) { const { review, ...rest } = x; return rest; }
    return { ...x, review: id };
  });
  return st;
}

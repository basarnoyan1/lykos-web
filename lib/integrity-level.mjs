// What a retraction or correction notice means for a record: the part of lib/integrity.mjs the Overview's progress checks read on every paint.
// lib/integrity.mjs (the Crossref and PubMed lookups, the report) loads with the Library's checks and re-exports these.

/** What a notice means for the record: 'retraction' (also partial, withdrawal, removal), 'concern', or 'correction' (everything else). */
export const noticeLevel = type => (/concern/i.test(type || '') ? 'concern' : /retract|withdraw|remov/i.test(type || '') ? 'retraction' : 'correction');
export const RANK = { retraction: 0, concern: 1, correction: 2 };
const LEVEL_LABEL = { retraction: 'Retracted', concern: 'Expression of concern', correction: 'Corrected' };
export const levelLabel = level => LEVEL_LABEL[level] || '';
/** The most serious level among a record's notices, or '' when it has none. */
export const recordLevel = p => (p?.integrity?.notices || []).map(n => noticeLevel(n.type)).sort((a, b) => RANK[a] - RANK[b])[0] || '';

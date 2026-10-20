// PRESS peer review of a search strategy (McGowan et al. 2016): six domains, a
// judgement and comments for each, the reviewer and the date. The form is
// attached to a search-log entry (`press`), so it travels with the strategy it
// reviewed and is exported with it.
//
// The six domain names are those of the published guideline. The prompts under
// each are written for Lykos in its own words and are not the guideline's
// checklist text: the article is under a licence that does not allow
// adaptation, so the checklist itself is cited, not copied. A completed form
// records that a reviewer went through the six domains; it does not certify
// the strategy.
export const PRESS_CITATION = {
  text: 'McGowan J, Sampson M, Salzwedel DM, Cogo E, Foerster V, Lefebvre C. PRESS Peer Review of Electronic Search Strategies: 2015 Guideline Statement. J Clin Epidemiol. 2016;75:40-46.',
  doi: '10.1016/j.jclinepi.2016.01.021', pmid: '27005575', url: 'https://doi.org/10.1016/j.jclinepi.2016.01.021',
};

export const PRESS_DOMAINS = [
  { id: 'question', name: 'Translation of the research question',
    prompt: 'Do the concepts in the strategy match the question, with none missing, none needless, and none too broad or too narrow?' },
  { id: 'operators', name: 'Boolean and proximity operators',
    prompt: 'Is the AND, OR and NOT logic right and bracketed as intended, and are proximity operators used as this database reads them?' },
  { id: 'headings', name: 'Subject headings',
    prompt: 'Are the controlled terms the right ones for this database, exploded or focused on purpose, with relevant headings not left out?' },
  { id: 'textwords', name: 'Text word searching',
    prompt: 'Are synonyms, spellings, plurals, acronyms and truncation covered, in the fields where they belong?' },
  { id: 'syntax', name: 'Spelling, syntax and line numbers',
    prompt: 'Are spelling, field tags and line references correct, with each line combining the lines it should?' },
  { id: 'limits', name: 'Limits and filters',
    prompt: 'Are date, language, publication type and design limits justified, applied correctly, and any published filter cited?' },
];

export const STATES = [['', 'Not reviewed'], ['none', 'No revision'], ['revise', 'Revision suggested']];
const stateLabel = v => STATES.find(([k]) => k === v)?.[1] || 'Not reviewed';

export const blankReview = (reviewer = '') => ({ reviewer, date: '', summary: '', domains: Object.fromEntries(PRESS_DOMAINS.map(d => [d.id, { state: '', comment: '' }])) });

/** The form on a search-log entry, or a blank one. */
export const reviewOf = entry => ({ ...blankReview(), ...(entry?.press || {}), domains: { ...blankReview().domains, ...(entry?.press?.domains || {}) } });

/** A completed form: a reviewer, a date, and a judgement on every domain. */
export const isComplete = r => Boolean(r?.reviewer?.trim() && r?.date && PRESS_DOMAINS.every(d => r.domains?.[d.id]?.state));
export const revisions = r => PRESS_DOMAINS.filter(d => r?.domains?.[d.id]?.state === 'revise').length;

const clip = (v, n) => String(v ?? '').slice(0, n);
/** Sets fields of the form on a log entry, inside a store update. Field lengths are bounded. */
export function setReview(state, index, patch) {
  const e = (state.searches || [])[index];
  if (!e) return false;
  const r = reviewOf(e);
  if ('reviewer' in patch) r.reviewer = clip(patch.reviewer, 200);
  if ('date' in patch) r.date = /^\d{4}-\d{2}-\d{2}$/.test(patch.date) ? patch.date : '';
  if ('summary' in patch) r.summary = clip(patch.summary, 4000);
  for (const [id, d] of Object.entries(patch.domains || {})) {
    if (!r.domains[id]) continue;
    if ('state' in d && STATES.some(([k]) => k === d.state)) r.domains[id].state = d.state;
    if ('comment' in d) r.domains[id].comment = clip(d.comment, 4000);
  }
  e.press = r;
  // the search-strategy report says whether the strategy was peer reviewed
  if (isComplete(r)) state.searchStrategy = { ...(state.searchStrategy || {}), press: true };
  return true;
}

const head = (entry, r) => [`PRESS peer review of a search strategy`, `${entry?.source || 'PubMed'}, searched ${(entry?.at || '').slice(0, 10) || 'date not recorded'}`, `Reviewer: ${r.reviewer || 'not recorded'}${r.date ? `, ${r.date}` : ''}`];

export function toMarkdown(entry) {
  const r = reviewOf(entry), [t, s, w] = head(entry, r);
  const out = [`# ${t}`, '', s, '', w, '', 'Query:', '', '```', entry?.query || '', '```', ''];
  for (const d of PRESS_DOMAINS) { const x = r.domains[d.id]; out.push(`## ${d.name}`, '', `${stateLabel(x.state)}${x.comment ? `. ${x.comment}` : ''}`, ''); }
  if (r.summary) out.push('## Summary', '', r.summary, '');
  out.push(`Checklist: ${PRESS_CITATION.text} doi:${PRESS_CITATION.doi}`);
  return out.join('\n');
}

export function toBlocks(entry) {
  const r = reviewOf(entry), [t, s, w] = head(entry, r); let n = 0; const id = () => `press${++n}`;
  return [
    { id: id(), type: 'title', text: t },
    { id: id(), type: 'p', text: `${s}. ${w}.` },
    { id: id(), type: 'p', text: `Query: ${entry?.query || ''}` },
    { id: id(), type: 'table', header: true, rows: [['Domain', 'Judgement', 'Comments'], ...PRESS_DOMAINS.map(d => [d.name, stateLabel(r.domains[d.id].state), r.domains[d.id].comment])] },
    ...(r.summary ? [{ id: id(), type: 'p', text: `Summary: ${r.summary}` }] : []),
    { id: id(), type: 'p', text: `Checklist: ${PRESS_CITATION.text} doi:${PRESS_CITATION.doi}` },
  ];
}

export const toCsvRows = entry => { const r = reviewOf(entry); return [['Domain', 'Judgement', 'Comments'], ...PRESS_DOMAINS.map(d => [d.name, stateLabel(r.domains[d.id].state), r.domains[d.id].comment]), ['Reviewer', r.reviewer, r.date], ['Summary', '', r.summary]]; };

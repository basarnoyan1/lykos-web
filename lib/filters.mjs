// Study-design filters for a PubMed strategy.
//
// Two kinds, kept apart on purpose.
//
// INSERTABLE: single PubMed field expressions in PubMed's own search syntax
// (publication types, the systematic-review subset, MeSH and language tags).
// They are the National Library of Medicine's vocabulary, not any author's
// filter. Each was run in a live PubMed search on 2026-09-29 and returned
// records without a warning (test/search-strategy.test.mjs holds the list).
//
// PUBLISHED: validated filters other groups designed. Their text is
// copyrighted and none of the pages read on 2026-09-29 grants a licence to
// reproduce it in software, so they are listed with what they are for and where
// to get them, and the strategy is left for the reviewer to copy from the
// source. The Cochrane Highly Sensitive Search Strategy for randomised trials
// (Technical Supplement to Chapter 4, Box 3.a and 3.b, PubMed format) is one:
// the supplement carries "Copyright 2024 The Cochrane Collaboration", and
// Cochrane's website terms reserve all rights and bar commercial reuse.
export const NLM = 'PubMed search syntax (National Library of Medicine)';

export const INSERTABLE = [
  { id: 'rct-pt', group: 'Publication type', label: 'Randomized controlled trial', text: 'randomized controlled trial[pt]' },
  { id: 'ct-pt', group: 'Publication type', label: 'Clinical trial', text: 'clinical trial[pt]' },
  { id: 'ma-pt', group: 'Publication type', label: 'Meta-analysis', text: 'meta-analysis[pt]' },
  { id: 'sr-pt', group: 'Publication type', label: 'Systematic review', text: 'systematic review[pt]' },
  { id: 'sr-sb', group: 'Subset', label: 'Systematic reviews subset', text: 'systematic[sb]' },
  { id: 'obs-pt', group: 'Publication type', label: 'Observational study', text: 'observational study[pt]' },
  { id: 'cohort-mh', group: 'MeSH', label: 'Cohort studies', text: 'cohort studies[mh]' },
  { id: 'cc-mh', group: 'MeSH', label: 'Case-control studies', text: 'case-control studies[mh]' },
  { id: 'cr-pt', group: 'Publication type', label: 'Case reports', text: 'case reports[pt]' },
  { id: 'humans', group: 'Limit', label: 'Humans', text: 'humans[mh]' },
  { id: 'english', group: 'Limit', label: 'English', text: 'english[la]' },
  // PubMed's Clinical Queries, by the names PubMed itself files them under: the strategies stay PubMed's and are not reproduced here.
  // Each tag answered on 2026-10-19 (esearch counts from 0.68 to 10.3 million records).
  ...[['therapy', 'Therapy'], ['diagnosis', 'Diagnosis'], ['etiology', 'Etiology'], ['prognosis', 'Prognosis'], ['clinical prediction guides', 'Clinical prediction guides']]
    .flatMap(([tag, name]) => ['broad', 'narrow'].map(scope => ({ id: `cq-${tag.replaceAll(' ', '-')}-${scope}`, group: 'Clinical Queries',
      label: `${name}, ${scope}`, text: `${tag}/${scope}[filter]` }))),
].map(f => ({ ...f, source: NLM, field: f.text.match(/\[(\w+)\]$/)?.[1] }));

export const PUBLISHED = [
  { id: 'cochrane-hsss', name: 'Cochrane Highly Sensitive Search Strategy for randomized trials',
    use: 'Randomized trials in MEDLINE, sensitivity-maximizing and sensitivity- and precision-maximizing versions',
    citation: 'Lefebvre C, Glanville J, Briscoe S, et al. Technical Supplement to Chapter 4: Searching for and selecting studies. In: Higgins JPT, Thomas J, Chandler J, et al, editors. Cochrane Handbook for Systematic Reviews of Interventions version 6.5. Cochrane; 2024.',
    url: 'https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04-technical-supplement-searching-and-selecting-studies',
    terms: 'Copyright The Cochrane Collaboration; no licence to reproduce it here was found' },
  { id: 'clinical-queries', name: 'PubMed Clinical Queries (Haynes filters)',
    use: 'Clinical study categories in PubMed, broad and narrow',
    citation: 'Haynes RB, et al. Clinical Queries filters, as maintained by the National Library of Medicine in PubMed.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/clinical/', terms: 'PubMed\u2019s own filters, inserted by name from Add filter', builtIn: true },
  { id: 'sign', name: 'SIGN search filters',
    use: 'Study-design filters for MEDLINE, Embase and others',
    citation: 'Scottish Intercollegiate Guidelines Network. Search filters.',
    url: 'https://www.sign.ac.uk/using-our-guidelines/methodology/search-filters/', terms: 'Terms of reuse not read' },
  { id: 'issg', name: 'ISSG Search Filter Resource',
    use: 'A register of design filters with their performance and how to cite each',
    citation: 'InterTASC Information Specialists’ Sub-Group. Search Filter Resource.',
    url: 'https://sites.google.com/a/york.ac.uk/issg-search-filters-resource/home', terms: 'Each filter has its own terms' },
];

/** A filter ANDed onto a query as one bracketed clause. An empty query gives the filter alone. */
export function withFilter(query, text) {
  const q = String(query || '').trim();
  return q ? `(${q}) AND ${text}` : text;
}

// A person's own copy of a published filter, pasted from its source: the text no licence lets Lykos carry, kept in the project
// (s.filterCopies) so the search that used it can be reproduced from the project alone.
/** The saved copy of published filter `id`, or null. */
export const filterCopy = (s, id) => (s.filterCopies?.[id]?.text ? s.filterCopies[id] : null);
/** Keeps `text` as this project's copy of filter `id`; an empty text removes it. */
export function setFilterCopy(s, id, text, at = new Date().toISOString()) {
  const t = String(text || '').trim();
  const next = { ...(s.filterCopies || {}) };
  if (t) next[id] = { text: t, at }; else delete next[id];
  s.filterCopies = next;
  return s;
}

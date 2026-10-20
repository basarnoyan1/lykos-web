// Where a "Needs attention" row lands, and what the page says on arrival (plan §2, "Progress").
//
// Every attention item names a kind (lib/progress.mjs unresolved(), the next actions of lib/research-workflow.mjs). This table says, for
// each kind, what to do about it in one plain sentence and, where the destination can narrow its own list to the offending items, that
// it does. The shell (app.mjs go(view, { arrive })) hands the arrival to the destination view's arrive() hook, which reuses that view's
// own filter state, and draws one quiet notice under the page's head: what is wrong, whether the list shows only those items, what to
// do, and at most one direct fix. The notice and the narrowing last until the person leaves the page or presses Show all or Dismiss.
// Nothing here is stored. Pure: tested in test/arrive.test.mjs, which also fails when a kind has no entry here.

/**
 * kind → { hint, narrow?, fix? }. `hint` is what to do, as a sentence. `narrow` means the destination can show only the offending
 * items (it still decides: its arrive() hook says whether it did). `fix` is the label of the one direct action the notice offers (the
 * page's arriveFirst()); a row that already opened the first item (a proposal, a run, a paper) lands without it.
 */
export const ARRIVE = Object.freeze({
  // protocol
  'no-title': { hint: 'Give the project a working title.' },
  'no-criteria': { hint: 'Add the inclusion and exclusion criteria.' },
  'ethics': { hint: 'Update the approval or report before its date.' },
  // literature and library
  'partial-search': { hint: 'Run it again to retrieve every record.' },
  'retraction': { hint: 'Decide if each record stays.', narrow: true },
  'malformed': { hint: 'Correct the identifier or add the title.' },
  'unidentified': { hint: 'Identify each file or enter its details.', narrow: true },
  'pdf-check': { hint: 'Attach each PDF or note why not.', narrow: true },
  'full-text': { hint: 'Attach the PDF of each study.' },
  'evidence-changes': { hint: 'Review what each change affects.' },
  // screening
  'new-records': { hint: 'Screen them before the rest.', narrow: true },
  'unscreened': { hint: 'Decide each record in turn.', narrow: true },
  'uncertain': { hint: 'Include or exclude each one.', narrow: true },
  // extraction
  'not-extracted': { hint: 'Open a study and enter its values.', narrow: true, fix: 'Open the first' },
  'unverified-values': { hint: 'Check each value against its source.', narrow: true, fix: 'Open the first' },
  'proposals': { hint: 'Accept or reject each proposed value.', narrow: true },
  'fill': { hint: 'Fill the empty cells from each PDF.' },
  // patient data, notes, certainty
  'unchecked-patients': { hint: 'Check each row against its source.' },
  'missing-time': { hint: 'Add the follow-up time and event for each.' },
  'unchecked-notes': { hint: 'Check each note against its source.' },
  'unchecked-footnotes': { hint: 'Check each footnote, then mark it checked.' },
  // appraisal
  'not-appraised': { hint: 'Open a study and judge each domain.', narrow: true },
  // analysis
  'analysis-stale': { hint: 'Run the analysis again on the current inputs.' },
  'analysis-untracked': { hint: 'Run it once to record its inputs.' },
  'analysis-run': { hint: 'Choose the outcome and run the analysis.' },
  'sample-size': { hint: 'Set the planned sample size.' },
  'data': { hint: 'Import the data or enter the first rows.' },
  'trial': { hint: 'Resolve it on the Trial operations page.' },
  'visits-overdue': { hint: 'Record each visit or reschedule it.' },
  // writing and reporting
  'start-manuscript': { hint: 'Start from the outline of the review.' },
  'manuscript-errors': { hint: 'The checks list each one with its place.' },
  'manuscript-warnings': { hint: 'The checks list each one with its place.' },
  'citation-check': { hint: 'Each finding opens its citation or entry.' },
  'prisma-blank': { hint: 'Fill each blank count in the flow.' },
  'reporting': { hint: 'Complete the flow counts and the checklist.' },
  'case': { hint: 'Complete it on the Case page.' },
  // submission
  'revision-due': { hint: 'Send the revision before the due date.' },
  'chase': { hint: 'Write to the journal, then record the reply.' },
  'letter': { hint: 'Read it and record the reviewers’ comments.' },
  // figures and files
  'figure': { hint: 'Each check names the figure and what to do.' },
  'drift': { hint: 'Compare the file and settle the change.' },
  'coverage': { hint: 'Bring the file’s work into this page.' },
  // the review's own next steps that have no row of their own
  'protocol': { hint: 'Write it here in plain words.' },
  'first-search': { hint: 'Search a database or import a reference file.' },
});

/** The kind of each of the review's next actions (lib/research-workflow.mjs nextResearchActions, kind → arrival kind). */
export const NEXT_KIND = Object.freeze({
  protocol: 'protocol', search: 'first-search', screening: 'unscreened', full_text: 'full-text', review: 'proposals', fill: 'fill',
  complete: 'fill', appraisal: 'not-appraised', analysis: 'analysis-run', manuscript: 'start-manuscript', reporting: 'reporting', data: 'data',
});
/** A next action's arrival kind: its kind's, except the one analysis action that is about the plan, not a run. */
export const nextKind = a => (a?.kind === 'analysis' && /sample size/i.test(a.text || '') ? 'sample-size' : NEXT_KIND[a?.kind]);

/** The longest notice text, in characters: one line at the page's usual width, two at the narrowest. */
export const NOTICE_MAX = 100;

const sentence = t => { const s = String(t || '').trim().replace(/[.\s]+$/, ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

/**
 * The arrival for one attention item `{ kind, text, view, go, ids }` (or a next action, whose `kind` is mapped through NEXT_KIND), or
 * null for an item of no known kind. `{ kind, text, hint, narrow, fix, ids }`: `text` is what is wrong, as a sentence.
 */
export function arriveOf(item, { next = false } = {}) {
  if (!item) return null;
  const kind = next ? nextKind(item) : item.kind;
  const def = ARRIVE[kind];
  if (!def) return null;
  const out = { kind, text: sentence(item.text), hint: def.hint, narrow: !!def.narrow };
  if (def.fix) out.fix = def.fix;
  if (Array.isArray(item.ids) && item.ids.length) out.ids = item.ids.slice();
  return out;
}

/**
 * What the notice says: what is wrong, whether the page shows only those items (`narrowed`, the view's answer), what to do. Never longer
 * than NOTICE_MAX: "Showing them" goes first (Show all beside it says as much), then a long item text is cut at a word with an
 * ellipsis; the hint is kept whole.
 */
export function arrivalText(a, narrowed = false) {
  if (!a) return '';
  const said = (lead, shown) => `${lead}.${shown ? ' Showing them.' : ''} ${a.hint}`;
  // the whole sentence; then without "Showing them" (the notice's Show all says the list is narrowed); then the lead cut at a word
  if (said(a.text, narrowed).length <= NOTICE_MAX) return said(a.text, narrowed);
  if (said(a.text, false).length <= NOTICE_MAX) return said(a.text, false);
  const room = NOTICE_MAX - said('', false).length - 1;
  return said(`${a.text.slice(0, Math.max(0, room)).replace(/\s+\S*$/, '')}\u2026`, false).replace('\u2026.', '\u2026');
}

/** The full sentence a row's hover title gives: what is wrong and what to do, with no limit. */
export const arrivalTitle = a => (a ? `${a.text}. ${a.hint}` : '');

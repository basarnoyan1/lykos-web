// The Library's check and duplicate pages: a page of their own in place of the list while one is open. Its head is the shell's title bar
// (views/library.mjs page(): Back to Library, the page's name, its commands); the page draws what is under it.
// This file holds the frame every such page shares, the duplicate review and the evidence changes as markup built from plain values
// (no store, no DOM), so a test renders them under Node. views/library-checks.mjs draws the other check pages in the same frame and
// gives the evidence changes their values; views/library.mjs owns the state and the handlers.
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { authorLine, journalDisplay } from '../lib/bib.mjs';
import { pager } from '../lib/paging.mjs';
import { uiList, uiRow, uiRowEnd, uiStatusLine } from '../lib/ui-actions.mjs';
import { disclosure, uiLink } from '../lib/ui-components.mjs';
import { plural, num, when } from '../lib/dates.mjs';

export const PAIRS_PER_PAGE = 8;   // a stacked pair is about 320px tall, so a page of eight stays under 3000px at the narrowest width
/** The two records of a pair sit side by side while the list is wide enough for both (about 220px each, and the row's Merge and More); below that they stack. */
export const pairsStack = width => width < 560;

/**
 * A page that replaces the list, under the title bar that names it: its one tools row (if it has one), one line of counts, then the body,
 * in the Library's own order. `parts` are the status line's counts ({ id, text, drop }: the highest drop leaves first); `tools` and `notices`
 * are markup (uiBar kind tools, uiNotice).
 */
export function pageFrame({ kind, title, parts = [], tools = '', notices = '', body }) {
  return `<div class="lib-page" id="lib-page" data-lib-page="${esc(kind)}">
    ${tools}
    ${parts.length ? uiStatusLine({ id: 'lib-page-meta', label: `${title}, counts`, parts }) : ''}
    ${notices}${body}
  </div>`;
}

/** A record named as a link that shows it in the inspector (the page's handlers read data-check-open). */
export const recordLink = (p, fallback = 'Removed') => p
  ? uiLink({ label: p.title || p.label || 'Untitled reference', cls: 'lib-record-link', attrs: { 'data-check-open': p.id } })
  : `<span class="meta">${esc(fallback)}</span>`;

const identifiers = p => [p.doi ? `DOI ${p.doi}` : '', p.pmid ? `PMID ${p.pmid}` : '', p.pdf ? 'PDF' : ''].filter(Boolean).join(', ');
const published = p => [authorLine(p.authors), journalDisplay(p.journal), p.year].filter(Boolean).join('; ');
const MATCH = { exact: 'Identifier match', likely: 'Likely match', possible: 'Possible match' };

/** One side of a pair or one record of a history row: its name as a link, then what tells it apart. */
const side = (role, p, { link = true } = {}) => `<span class="lib-dupe-side">${role ? `<span class="meta lib-dupe-role">${esc(role)}</span>` : ''}${link ? recordLink(p) : `<span>${esc(p.title || p.label || 'Untitled reference')}</span>`}`
  + `<span class="meta">${esc(published(p))}</span><span class="meta">${esc(identifiers(p))}</span></span>`;

/** The pair as a list row: Keep, Remove and Why side by side, Merge, and More for the rest. `swapped` keeps the other record. */
export function pairRow(pr, i, { swapped = false } = {}) {
  const keep = swapped ? pr.b : pr.a, drop = swapped ? pr.a : pr.b;
  return uiRow({ attrs: { 'data-pair-a': pr.a.id, 'data-pair-b': pr.b.id },
    main: { html: `<span class="lib-dupe-pair">${side('Keep', keep)}${side('Remove', drop)}</span>`, detail: [`Why: ${MATCH[pr.strength] || 'Possible match'}`, pr.reason || ''], wrap: true },
    end: uiRowEnd({ primary: { id: `dupe-merge-${i}`, label: 'Merge', attrs: { 'data-merge': true, 'data-keep': keep.id, 'data-dup': drop.id } },
      more: { label: `More for ${keep.label || keep.title || 'this pair'}`, attrs: { 'data-pair-more': i } } }) });
}

const historyRow = (record, i, kind, attrs) => uiRow({
  main: { html: record },
  end: uiRowEnd({ primary: { id: `dupe-${kind}-${i}`, label: kind === 'merged' ? 'Undo merge' : 'Undo', attrs },
    more: { label: `More for ${kind === 'merged' ? 'merged record' : 'decision'} ${i + 1}`, attrs: { 'data-history-more': kind, ...Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'data-unmerge' && k !== 'data-undo-distinct')) } } }) });

/**
 * The duplicate review. model: { view (lib/dedup.mjs duplicateReview), error, swapped: Set of 'aId|bId', merged, distinct (state lists),
 * mergedView, distinctView (pageOf of each), byId: Map, open: { merged, distinct } }.
 */
export function duplicatesPage(model) {
  const { view, merged, distinct, mergedView, distinctView, byId, open = {}, swapped = new Set() } = model;
  const counts = view.counts, total = view.total;
  const parts = total == null ? [{ id: 'dupe-count', text: 'Finding candidates', drop: 0 }] : [
    { id: 'dupe-count', text: plural(total, 'pair'), drop: 0 },
    ...(counts ? [{ id: 'dupe-exact', text: `${num(counts.exact)} by identifier`, drop: 3 }, { id: 'dupe-likely', text: `${num(counts.likely)} likely`, drop: 4 }, { id: 'dupe-possible', text: `${num(counts.possible)} possible`, drop: 2 }] : []),
    { id: 'dupe-distinct-count', text: `${num(distinct.length)} marked distinct`, drop: 5 }];
  const rows = view.pending ? [] : view.items.map((pr, i) => pairRow(pr, i, { swapped: swapped.has(`${pr.a.id}|${pr.b.id}`) }));
  const empty = view.pending ? '<p class="meta" role="status">Preparing review page…</p>'
    : view.error ? emptyState({ icon: 'warn', title: 'Review stopped' })
    : emptyState({ icon: 'check', title: 'No candidates' });
  const notice = model.error || view.error ? `<p class="lib-dupe-error" role="alert">${esc(model.error || view.error)}</p>` : '';
  const history = (id, title, list, pageView, pagerId, label, rowsOf) => list.length
    ? disclosure({ id, title, count: list.length, open: !!open[id === 'dupe-merged' ? 'merged' : 'distinct'],
      body: `${uiList({ id: `${id}-rows`, label: title, rows: rowsOf })}${pager({ id: pagerId, page: pageView.page, pages: pageView.pages, total: list.length, label, size: PAIRS_PER_PAGE })}` }) : '';
  const mergedRows = (mergedView?.items || []).map((mm, i) => historyRow(side('', mm.dup, { link: false }), i, 'merged', { 'data-unmerge': true, 'data-keep': mm.keepId, 'data-dup': mm.dup.id }));
  const distinctRows = (distinctView?.items || []).map((item, i) => historyRow(`<span class="lib-dupe-side"><span>${esc(byId.get(item.a)?.title || item.a)}</span><span>${esc(byId.get(item.b)?.title || item.b)}</span></span>`, i, 'distinct', { 'data-undo-distinct': true, 'data-a': item.a, 'data-b': item.b }));
  const body = `${notice}<div id="dupe-candidate-region" aria-busy="${!!view.pending}">${uiList({ id: 'dupe-rows', label: 'Duplicate pairs', rows, empty })}${!view.pending && total != null ? pager({ id: 'dupe-pager', page: view.page, pages: view.pages, total, label: 'pairs', size: PAIRS_PER_PAGE }) : ''}</div>`
    + history('dupe-merged', 'Merged', merged, mergedView, 'dupe-merged-pager', 'merges', mergedRows)
    + history('dupe-distinct', 'Distinct', distinct, distinctView, 'dupe-distinct-pager', 'decisions', distinctRows);
  return pageFrame({ kind: 'duplicates', title: 'Duplicates', parts, body });
}

/**
 * What changed since the last evidence baseline kept and the work it reaches (lib/research-copilot.mjs evidenceImpact). model: { impact,
 * changes, affected (pageOf of impact.changes and impact.affected), size (rows a page), describe(item) → { html, detail } (a row's
 * name and what tells it apart), open: { [disclosure id]: bool }, notices }.
 */
export function changesPage({ impact, changes, affected, size, describe, open = {}, notices = '' }) {
  const base = impact.baseline;
  const parts = base ? [{ id: 'ev-baseline', text: `Baseline ${when(base.at)}`, drop: 0 }, { id: 'ev-changes-n', text: plural(impact.changes.length, 'change'), drop: 1 },
    { id: 'ev-affected-n', text: `${num(impact.affected.length)} affected`, drop: 2 }] : [{ id: 'ev-baseline', text: 'No baseline', drop: 0 }];
  const group = (id, title, list, view, label) => (list.length ? disclosure({ id, title, count: list.length, open: open[id] ?? true,
    body: `${uiList({ id: `${id}-rows`, label: title, rows: view.items.map(item => uiRow({ main: { ...describe(item), wrap: true } })) })}${pager({ id: `${id}-pager`, page: view.page, pages: view.pages, total: list.length, label, size })}` }) : '');
  const body = !base ? emptyState({ icon: 'backup', title: 'No baseline', help: true, detail: 'Capture a baseline once the evidence is reviewed; later changes to records, values and results are listed against it' })
    : `${impact.changes.length ? '' : emptyState({ title: 'No changes since the baseline', size: 'inline' })}${group('ev-changes', 'Changes', impact.changes, changes, 'changes')}${group('ev-affected', 'Affected work', impact.affected, affected, 'items')}`;
  return pageFrame({ kind: 'changes', title: 'Evidence changes', parts, notices, body });
}

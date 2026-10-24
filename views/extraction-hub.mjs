// Extraction's Overview: where the table stands before its cells. What is filled, what a model proposed and waits for a person, which
// fields and which studies still have gaps; each row opens its place (a field's summary, a study's row in the table). The Model extraction
// section's Fill asks a model for values; the counts are the data summary's: the included studies and every field of the table.
import { esc, emptyState } from '../lib/html.mjs';
import { uiList, uiRow, uiBar } from '../lib/ui-actions.mjs';
import { plural, num } from '../lib/dates.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { key as cellKey } from '../lib/proposals.mjs';
import { studyCell, armIndex } from '../lib/extraction-summary.mjs';
import { modelName } from '../lib/model-names.mjs';
import { readableLabel } from '../lib/label-text.mjs';
import { pagedList, wirePagedLists } from '../lib/paged-list.mjs';

/**
 * The counts the page draws, from the table model: { studies, fields, cells, filled, nr, pending, empty, fieldRows, studyRows }. A cell is read as the
 * data summary reads it (lib/extraction-summary.mjs studyCell: its own value, else its arms', with the project's groupings), so a field shows
 * here the count its summary shows: present is filled, not reported is its own count, a missing cell with a proposal waits, the rest are empty.
 */
export function hubCounts({ st, cols, counted, pend }) {
  const V = st.values || {}, maps = st.extractionSummary?.fields || {}, arms = armIndex(V);
  const fieldRows = cols.map(c => ({ id: c.id, label: c.label, unit: c.unit, filled: 0, nr: 0, pending: 0 }));
  const studyRows = counted.map(p => ({ id: p.id, label: p.label || p.title || 'Untitled', empty: 0, pending: 0 }));
  let filled = 0, nr = 0, pending = 0;
  studyRows.forEach((s, i) => cols.forEach((c, j) => {
    const k = cellKey(counted[i].id, c.id), f = fieldRows[j], { state } = studyCell(V, arms, k, maps[c.id] || null);
    if (state === 'present') { filled++; f.filled++; }
    else if (state === 'not_reported') { nr++; f.nr++; }
    else if (pend.has(k)) { pending++; f.pending++; s.pending++; }
    else s.empty++;
  }));
  const cells = counted.length * cols.length;
  return { studies: counted.length, fields: cols.length, cells, filled, nr, pending, empty: cells - filled - nr - pending,
    fieldRows: fieldRows.sort((a, b) => a.filled - b.filled || a.label.localeCompare(b.label)),
    studyRows: studyRows.filter(s => s.empty || s.pending).sort((a, b) => b.empty - a.empty || b.pending - a.pending) };
}

const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);
/** A share as a meter: neutral fill, the number beside it carries the value. */
const meter = (n, of, w = 80) => `<svg class="syn-mini syn-meter" width="${w}" height="8" viewBox="0 0 ${w} 8" aria-hidden="true"><rect class="syn-meter-bg" width="${w}" height="8" rx="2"/><rect class="syn-meter-fg" width="${(w * n) / Math.max(1, of)}" height="8" rx="2"/></svg>`;
const parts = xs => xs.filter(Boolean).map(esc);

/** The page's HTML from its counts and what a run can do: { model, running, clean, rules, disagreements }. */
export function hubHtml(h, run = {}) {
  if (!h.studies) return emptyState({ icon: 'extraction', title: 'No studies yet', size: 'inline' });
  const prog = `<dl class="props ext-hub-props">
    <dt>Cells with a value</dt><dd><span class="ext-hub-meter">${meter(h.filled, h.cells, 160)}<span><strong>${num(h.filled)}</strong> of ${num(h.cells)} (${pct(h.filled, h.cells)}%)</span></span></dd>
    <dt>Studies</dt><dd>${num(h.studies)} included, ${num(h.studies - h.studyRows.filter(s => s.empty).length)} complete</dd>
    <dt>Fields</dt><dd>${num(h.fields)}, ${num(h.fieldRows.filter(f => f.filled + f.nr === h.studies).length)} complete</dd>
    ${h.nr ? `<dt>Not reported</dt><dd>${num(h.nr)} cells</dd>` : ''}
    ${run.rules ? `<dt>Rules</dt><dd>${esc(run.rules)}</dd>` : ''}
    ${run.disagreements ? `<dt>Disagreements</dt><dd>${plural(run.disagreements, 'cell')}</dd>` : ''}</dl>`;
  const model = `<dl class="props ext-hub-props">
    <dt>Model</dt><dd>${run.model ? `<span title="${esc(run.model)}">${esc(modelName(run.model))}</span>` : '<span class="meta">Not connected</span>'}</dd>
    <dt>Empty cells</dt><dd>${num(h.empty)}${h.empty ? ` in ${plural(h.studyRows.filter(s => s.empty).length, 'study', 'studies')}` : ''}</dd>
    <dt>Waiting for review</dt><dd>${plural(h.pending, 'proposal')}${run.clean ? `, ${num(run.clean)} clean` : ''}</dd></dl>
    ${uiBar({ kind: 'foot', label: 'Model extraction', id: 'ext-hub-acts', actions: [
      { id: 'ext-hub-fill', label: 'Fill empty cells', icon: 'run', role: 'primary', disabled: !!run.running || !h.empty },
      { id: 'ext-hub-review', label: 'Review proposals', icon: 'checklist', disabled: !h.pending },
      { id: 'ext-hub-clean', label: 'Accept clean', icon: 'check', disabled: !run.clean }] })}`;
  // one line per field and per study: the name, then its columns ending on the list's rule (a second line of counts left the right half empty)
  const fields = uiList({ label: 'Fields by completeness', cols: ['note', 'meter', 'count'], rows: h.fieldRows.map(f => uiRow({ attrs: { 'data-hub-field': f.id },
    main: { html: esc(readableLabel(f.unit ? `${f.label} (${f.unit})` : f.label)) },
    cells: [{ col: 'note', kind: 'text', ch: 16, html: (parts([f.nr ? `${f.nr} not reported` : '', f.pending ? `${f.pending} waiting` : '']).join(', ')) },
      { col: 'meter', kind: 'visual', html: meter(f.filled, h.studies) }, { col: 'count', kind: 'text', ch: 8, html: esc(`${f.filled} of ${h.studies}`) }] })) });
  const studyPage = pagedList('ext-hub-studies', h.studyRows, { label: 'studies' });   // fifty a page, the page kept across redraws
  const studies = uiList({ label: 'Studies with gaps', cols: ['note', 'count'], rows: studyPage.items.map(s => uiRow({ attrs: { 'data-hub-study': s.id },
    main: { html: esc(s.label) },
    cells: [{ col: 'note', kind: 'text', ch: 12, html: esc(s.pending ? `${s.pending} waiting` : '') }, { col: 'count', kind: 'text', ch: 8, html: esc(s.empty ? `${s.empty} empty` : '') }] })),
    empty: emptyState({ icon: 'check', title: 'Every study complete', size: 'inline' }) }) + studyPage.pager;
  return `<div class="ext-hub" role="region" aria-label="Extraction overview">
    <section class="syn-sec"><h3>Progress</h3>${prog}</section>
    <section class="syn-sec"><h3>Model extraction</h3>${model}</section>
    <div class="ext-hub-cols">
      <section class="syn-sec"><h3>Fields</h3>${fields}</section>
      <section class="syn-sec"><h3>Studies with gaps</h3>${studies}</section>
    </div></div>`;
}

/** Draws the page and wires its rows and actions to `on`: { fill(anchor), review(), clean(), field(id), study(id) }. */
export function renderHub(el, h, run, on) {
  el.innerHTML = hubHtml(h, run);
  const cols = el.querySelector('.ext-hub-cols'); if (cols) fitSplit(cols, 760);
  el.querySelector('#ext-hub-fill')?.addEventListener('click', e => on.fill(e.currentTarget));
  el.querySelector('#ext-hub-review')?.addEventListener('click', () => on.review());
  el.querySelector('#ext-hub-clean')?.addEventListener('click', () => on.clean());
  el.querySelectorAll('[data-hub-field]').forEach(r => r.addEventListener('click', () => on.field(r.dataset.hubField)));
  el.querySelectorAll('[data-hub-study]').forEach(r => r.addEventListener('click', () => on.study(r.dataset.hubStudy)));
  wirePagedLists(el, () => renderHub(el, h, run, on));
}

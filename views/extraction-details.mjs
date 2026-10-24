// The Details panel of one extraction cell (data summary plan §8, stage 5): what the cell holds as structure, where it came from, where it sits
// among the other studies, what the review found and what the field is. The words and numbers are lib/extraction-details.mjs (which reads the
// summary engine); this file draws them with the shared builders and wires the links, the notes and the cell's decisions (./evidence.mjs).
// It depends on nothing of the grid: the panel is its own column of rows, whatever width the pane gives it. Nothing here writes a value;
// Apply on a review note files a cell proposal, which a person still accepts.
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiList, uiRow, uiReview, uiReviewList } from '../lib/ui-actions.mjs';
import { disclosure, uiLink, countHeading } from '../lib/ui-components.mjs';
import { evidenceLabel } from '../lib/evidence.mjs';
import { fieldGuide, guideHtml } from '../lib/field-guide.mjs';
import { notesFor } from '../lib/extraction-summary-state.mjs';
import { setNoteState } from '../lib/extraction-summary-store.mjs';
import { REVIEW_KINDS } from '../lib/extraction-review.mjs';
import { propose } from '../lib/proposals.mjs';
import { statusOf, valueStructure, placement, fieldSummaryOf, numericPlace, along, noteRows, pageLabel } from '../lib/extraction-details.mjs';
import { splitField } from '../lib/outcomes.mjs';
import { plural, num } from '../lib/dates.mjs';
import { evidenceFoot, wireDecision } from './evidence.mjs';

// What the reader opened, kept across the redraws of the panel (a press, a key and every edit draw it again).
const kept = { definition: false, notes: new Set() };
const NOTES_OPEN = 3;   // a cell with this many notes or fewer shows each note's quote at once

const heading = title => countHeading({ title, count: '' });
/** One section of the panel: its heading and its content, nothing when it has none. */
const section = (title, html) => (html ? `<div class="ev-sec">${heading(title)}${html}</div>` : '');
const place = e => (e.kind === 'text' && Number(e.page) === 0 ? 'abstract' : evidenceLabel(e));

/** A value (the accepted one or the proposal) as structure: its parts as rows, one row, or its text. */
function valueHtml(x, fs, mapping, label) {
  const v = valueStructure(fs, x, mapping);
  if (v.type === 'none') return '';
  if (v.type === 'text') return `<div class="ev-value" data-ev-value="text">${esc(v.text)}</div>`;
  const status = v.rows.some(r => r.status);
  const rows = v.rows.map(r => uiRow({ main: { html: esc(r.label), detail: r.groups?.length ? [esc(r.groups.join(', '))] : [], wrap: true },
    cells: status ? [{ col: 'status', kind: 'visual', html: esc(r.status) }] : [] }));
  return uiList({ id: `ev-value-${label.toLowerCase().replace(/\W+/g, '-')}`, label, cols: status ? ['status'] : [], cls: 'ev-parts', attrs: { 'data-ev-value': v.type }, rows });
}

/** The sources of the cell, each once, in the order the panel lists them: [{ e, label }]. A proposal's first, as before. */
function sourcesOf(proposal, value) {
  const seen = new Set(), out = [];
  for (const e of [...(proposal?.evidence || []), ...(value?.evidence || [])]) {
    const k = JSON.stringify([e.kind, e.page, e.quote, e.path, e.locator, e.doc_id]);
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}

/**
 * A source in a file: the file's name as the link, wrapping after its _ . - so a long name stays inside the panel, and where in the file (a
 * sheet and its cell, a paragraph, a line) on a quiet line of its own under it.
 */
function fileSource(e, i) {
  const l = e.locator || {}, name = String(e.path || '').split(/[\\/]/).pop() || 'File';
  const where = l.sheet != null && l.cell ? `${l.sheet}, cell ${l.cell}` : l.paragraph != null ? `Paragraph ${l.paragraph}` : l.line != null ? `Line ${l.line}` : '';
  return `${uiLink({ label: name, breaks: true, cls: 'ev-src-link', title: 'Open the file here', attrs: { 'data-ev': i } })}${where ? `<div class="meta ev-src-where">${esc(where)}</div>` : ''}`;
}

/** The numbers' strip: the field's range as a line, its interquartile range as a box, the median as a mark and this study as a taller tick. Percent coordinates, no hue. */
function stripHtml(n) {
  const at = x => `${along(n, x).toFixed(2)}%`;
  const label = `Range ${n.min} to ${n.max}, median ${n.median}, interquartile range ${n.q1} to ${n.q3}, this study ${n.value}`;
  return `<div class="ev-strip-wrap"><svg class="ev-strip" role="img" aria-label="${esc(label)}" height="28" focusable="false">
    <line class="ev-strip-range" x1="0%" x2="100%" y1="14" y2="14"/>
    <rect class="ev-strip-iqr" x="${at(n.q1)}" width="${(along(n, n.q3) - along(n, n.q1)).toFixed(2)}%" y="8" height="12"/>
    <line class="ev-strip-median" x1="${at(n.median)}" x2="${at(n.median)}" y1="8" y2="20"/>
    <line class="ev-strip-here" x1="${at(n.value)}" x2="${at(n.value)}" y1="3" y2="25"/></svg></div>`;
}

/** Where the value sits among the other studies; `reg` collects the lists the counts open. Empty when the summary has nothing to say. */
function amongHtml(pl, o, reg) {
  if (!pl) return '';
  if (pl.notNumber) return section('Among the other studies', '<div class="meta">Not a number</div>');
  const label = o.column.label || o.columnId;
  const counted = r => {
    const id = `l${reg.size}`; reg.set(id, { fieldId: o.columnId, fieldLabel: label, label: r.label, items: r.studies.map(s => ({ paperId: s.paperId, cell: s.cell })) });
    return uiLink({ label: r.words || num(r.n), title: `Show the ${plural(r.n, 'study', 'studies')}`, attrs: { 'data-ev-list': id, 'aria-label': `${plural(r.n, 'study', 'studies')}: ${r.label}, ${label}` } });
  };
  let body = '';
  if (pl.numeric) {
    body = `${stripHtml(pl.numeric)}${uiList({ id: 'ev-among-numbers', label: `Numbers of ${label}`, cols: ['value'],
      rows: numericPlace(pl.numeric).map(([k, v]) => uiRow({ main: { html: esc(k) }, cells: [{ col: 'value', kind: 'visual', html: esc(v) }] })) })}`;
  } else if (pl.reported && pl.rows?.length) {
    // each part of the cell with the studies that report it (a marker that says "not given" is no report): "Reported in 3 of 48"; the words open the list
    const rows = pl.rows.map(r => uiRow({ attrs: r.here ? { 'data-here': '' } : {}, main: { html: r.here ? `<span class="ev-here">${esc(r.label)}</span>` : esc(r.label) },
      cells: [{ col: 'count', kind: 'control', html: r.n ? counted({ ...r, words: `Reported in ${num(r.n)} of ${num(r.of)}` })
        : `<button type="button" class="ui-link link" disabled>${esc(`Reported in 0 of ${num(r.of)}`)}</button>` }] }));
    body = uiList({ id: 'ev-among', label: `Studies reporting each part, ${label}`, cols: ['count'], rows });
  } else if (pl.rows?.length) {
    const rows = pl.rows.map(r => uiRow({ attrs: r.here ? { 'data-here': '' } : {}, main: { html: r.here ? `<span class="ev-here">${esc(r.label)}</span>` : esc(r.label) },
      cells: [{ col: 'pct', kind: 'visual', html: esc(r.pct) }, { col: 'count', kind: 'control', html: counted(r) }] }));
    const of = pl.state === 'present' ? `Percentages of the ${plural(pl.of, 'study', 'studies')} with a value` : `Percentages of all ${plural(pl.of, 'study', 'studies')}`;
    body = `<div class="meta">${esc(of)}</div>${uiList({ id: 'ev-among', label: `Studies by value, ${label}`, cols: ['pct', 'count'], rows })}${pl.hidden ? `<div class="meta">${esc(`+${pl.hidden} more in the summary`)}</div>` : ''}`;
  } else return '';
  return section('Among the other studies', `${body}${uiLink({ label: 'Open in summary', attrs: { 'data-ev-summary': '' } })}`);
}

/** The review notes of the cell as review rows: Dismiss, and Apply for a value the text states. */
function notesHtml(rows, o) {
  if (!rows.length) return '';
  const items = rows.map(r => {
    const link = r.quote ? `<div class="ev-quote">${esc(r.quote)}</div>${r.page != null ? uiLink({ label: pageLabel(r.page), title: 'Open the paper here', attrs: { 'data-ev-note-source': r.id } }) : ''}` : '';
    return uiReview({ id: r.id, kind: r.label, summary: r.text, acceptLabel: r.canApply ? 'Apply' : '', dismissLabel: 'Dismiss', body: link,
      open: kept.notes.has(r.id) || (rows.length <= NOTES_OPEN && !!r.quote) });
  });
  return section('Review notes', uiReviewList({ label: 'Review notes for this cell', items }));
}

/** What the extractor said and what was done to the value afterwards: rationale, derivation, lock, amendments. */
function historyHtml(proposal, value) {
  const part = (x, last) => !x ? '' : `${x.rationale ? `<div class="ev-rationale">${esc(x.rationale)}</div>` : ''}${x.derivation ? `<div class="meta">${esc(x.derivation)}</div>` : ''}${last && x.locked ? `<div class="meta">Locked ${esc(String(x.locked.at || '').slice(0, 10))}</div>` : ''}`
    + (last ? (x.amendments || []).map(m => `<div class="ev-item ev-amend"><span class="meta">Amended ${esc(String(m.at || '').slice(0, 10))}</span><div class="ev-quote">${esc(`“${m.from ?? ''}” → “${m.to}”: ${m.reason}`)}</div></div>`).join('') : '');
  return part(proposal, false) + part(value, true);
}

/**
 * Draws the panel into `host`. `o`: { paperId, columnId, column, value, proposal, ctx, onChange, onEdit, studies (the table's rows), templateId,
 * mapping (the field's approved grouping), disagree (reasons), rules (broken rules of the cell), openList(drill), openSummary(fieldId) }.
 */
export function renderDetails(host, o) {
  const { paperId, columnId, column, value, proposal, ctx } = o, st = get(), paper = st.papers.find(p => p.id === paperId), cell = `${paperId}:${columnId}`;
  const notes = notesFor(st.extractionSummary, cell, value), empty = !value && !proposal;
  const fs = fieldSummaryOf({ column, columnId, studies: o.studies, values: st.values || {}, proposals: st.proposals || {}, mapping: o.mapping });
  const status = statusOf({ value, proposal, notes: notes.length, rules: o.rules || 0, disagree: o.disagree || [] });
  const both = !!value && !!proposal, sources = sourcesOf(proposal, value);
  const reg = new Map();
  const guide = fieldGuide(column);
  const study = paper?.label || '';
  const sourceRows = sources.length ? uiList({ id: 'ev-sources', label: 'Sources of this value', cols: ['src'], rows: sources.map((e, i) => uiRow({
      main: { html: e.quote && ['text', 'file', 'abstract'].includes(e.kind) ? `<span class="ev-quote">${esc(e.quote)}</span>` : `<span class="meta">${e.kind === 'image' ? 'Figure' : 'No quote'}</span>` },
      cells: [{ col: 'src', kind: 'control', html: e.kind === 'file' ? fileSource(e, i) : uiLink({ label: place(e), title: 'Open the paper here', attrs: { 'data-ev': i } }) }] })) }) : '<div class="meta">No source</div>';
  host.hidden = false; host.classList.add('ui-flush');   // lists and headings start at the panel's own left edge
  host.innerHTML = `<div class="ev-sec"><div class="ev-title"><span title="${esc(study)}">${esc(study)}</span><span class="meta" title="${esc(column.label)}">${esc(column.label)}</span></div>
      <div class="ev-status" data-ev-status="${status.key}">${esc(status.text)}</div></div>
    ${both ? section('Proposed', valueHtml(proposal, fs, o.mapping, 'Proposed value')) + section('Accepted', valueHtml(value, fs, o.mapping, 'Accepted value'))
      : `<div class="ev-sec">${valueHtml(proposal || value, fs, o.mapping, 'Value')}</div>`}
    ${empty ? '' : section('Source', `${sourceRows}${historyHtml(proposal, value)}`)}
    ${amongHtml(placement(fs, cell), { ...o, column }, reg)}
    ${notesHtml(noteRows(notes, REVIEW_KINDS, paperId, { empty }), o)}
    ${guide ? disclosure({ id: 'ev-definition', title: 'Field definition', open: kept.definition, body: guideHtml({ ...guide, label: '' }) }) : ''}
    ${evidenceFoot({ proposal, value, sd: !!/^sd(_t|_c)?$/.exec(splitField(columnId).base), pdf: !!paper?.pdf })}`;
  wireDecision(host, o);

  host.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => {
    const e = sources[+b.dataset.ev];
    if (e.kind === 'file') ctx.openDocument(paperId, { file: e.path, locator: e.locator, quote: e.quote });
    else ctx.openDocument(e.doc_id || paperId, { page: e.kind === 'abstract' ? 0 : e.page, rects: e.rects || [], quote: e.quote || '', kind: e.kind, region: e.region || null });
  });
  host.querySelectorAll('[data-ev-list]').forEach(b => b.onclick = () => { const d = reg.get(b.dataset.evList); if (d) o.openList?.(d); });
  host.querySelector('[data-ev-summary]')?.addEventListener('click', () => o.openSummary?.());
  host.querySelector('#ev-definition')?.addEventListener('toggle', e => { kept.definition = e.target.open; });

  const rows = new Map(noteRows(notes, REVIEW_KINDS, paperId, { empty }).map(r => [r.id, r]));
  host.querySelectorAll('[data-ev-note-source]').forEach(b => b.onclick = () => { const r = rows.get(b.dataset.evNoteSource); if (r) ctx.openDocument(r.doc, { page: r.page, rects: [], quote: r.quote }); });
  host.querySelectorAll('.ui-review').forEach(el => {
    const r = rows.get(el.dataset.i); if (!r) return;
    el.querySelector('[data-more]')?.addEventListener('click', e => {
      const b = e.currentTarget, open = b.getAttribute('aria-expanded') !== 'true', body = el.querySelector('.ui-review-body');
      b.setAttribute('aria-expanded', String(open)); if (body) body.hidden = !open;
      if (open) kept.notes.add(r.id); else kept.notes.delete(r.id);
    });
    el.querySelector('[data-discard]')?.addEventListener('click', () => { setNoteState(cell, r.id, 'dismissed'); ctx.refreshDetails?.(); });
    el.querySelector('[data-accept]')?.addEventListener('click', () => {
      if (st.proposals?.[cell] || get().values?.[cell]) { ctx.say?.('This cell has a value or a proposal now; review again'); return; }
      const evidence = r.page === 0 ? [{ kind: 'abstract', quote: r.quote }] : [{ kind: 'text', page: r.page, rects: [], quote: r.quote, ...(r.doc && r.doc !== paperId ? { doc_id: r.doc } : {}) }];
      propose(paperId, { column_id: columnId, value: r.value, normalized_value: r.value, availability: 'present', evidence, rationale: 'Found in the text by Review data', origin: 'model', mode: 'review', model: null });
      setNoteState(cell, r.id, 'applied');
      o.onChange();
    });
  });
}

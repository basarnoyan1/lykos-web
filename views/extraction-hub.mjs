// Extraction's Overview: where the table stands before its cells. What is decided (a value, or not reported), what a model proposed and waits
// for a person, what verification still has open (the proof checker's state, else the reviewers' records) and the fields, least done first;
// each row opens its place (a field's summary, a study's row in the table). The Model extraction section appears only while a model has
// something to act on; the counts are the data summary's: the included studies and every field of the table.
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink, lib_ui_components$countHeading as countHeading } from "../boot.mjs";
import { valueKey } from '../lib/proof-state.mjs';
import { recordedIs } from '../lib/value-accuracy.mjs';
import { lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";
import { key as cellKey } from '../lib/proposals.mjs';
import { studyCell, armIndex } from '../lib/extraction-summary.mjs';
import { lib_model_names$modelName as modelName } from "../boot.mjs";
import { lib_label_text$readableLabel as readableLabel } from "../boot.mjs";
import { pagedList, wirePagedLists } from '../lib/paged-list.mjs';
import { fitSplit } from '../lib/split-fit.mjs';
import { categoryOf, CATEGORIES, instrumentCoverage, hasOutcomeRows } from '../lib/outcome-store.mjs';
import { scaleTitleOf } from '../lib/scale-names.mjs';

const OPEN_PAGE_SIZE = 8;     // the top of the list of studies, not a table of them: the rest is a page away
const FIELDS_BAR_MIN = 540;
const HUB_SPLIT = 1200;       // the hub's width from which its fields stand beside progress and verification (W6 review, 6 Nov 2026)
const FIELDS_PAGE_SIZE = 24;   // one compact line a field: a page is a screen and a half

/**
 * The counts the page draws, from the table model: { studies, fields, cells, filled, nr, pending, empty, values, unsettled, fieldRows, studyRows,
 * unsettledRows }. A cell is read as the data summary reads it (lib/extraction-summary.mjs studyCell: its own value, else its arms', with the
 * project's groupings), so a field shows here the count its summary shows: present is filled, not reported is its own count (a decision, as a
 * value is), a missing cell with a proposal waits, the rest are empty. A value is settled when a reviewer's record (valueChecks) agrees with it.
 */
export function hubCounts({ st, cols: all, counted, pend, templateId = null }) {
  const V = st.values || {}, maps = st.extractionSummary?.fields || {}, arms = armIndex(V), checks = st.valueChecks?.studies || {};
  // an outcome entry's statistics are counted per instrument (lib/outcome-store.mjs instrumentCoverage), not as a study's cells
  const t = (st.templates || []).find(x => x.id === templateId) || (st.templates || []).find(x => (x.columns || []).some(c => c.id === all[0]?.id)) || null;
  const cols = all.filter(c => c.group !== 'outcome'), outcomes = hasOutcomeRows(t) ? instrumentCoverage(st, t, { studies: counted.map(p => p.id) }) : [];
  const fieldRows = cols.map(c => ({ id: c.id, label: c.label, unit: c.unit, category: categoryOf(c), filled: 0, nr: 0, pending: 0, empty: 0 }));
  const studyRows = counted.map(p => ({ id: p.id, label: p.label || p.title || 'Untitled', empty: 0, pending: 0, unsettled: 0 }));
  const settled = (pid, { cell, v }) => { const rec = checks[pid]?.fields?.[valueKey(cell.slice(cell.indexOf(':') + 1))];
    return !!rec && (!!rec.settled || rec.verdict === 'agree' || rec.verdict === 'not-in-paper') && recordedIs(String(rec.recorded ?? ''), String(v?.reported_value ?? ''), v?.qualifier); };
  let filled = 0, nr = 0, pending = 0, values = 0, unsettled = 0;
  studyRows.forEach((s, i) => cols.forEach((c, j) => {
    const k = cellKey(counted[i].id, c.id), f = fieldRows[j], { state, cells } = studyCell(V, arms, k, maps[c.id] || null);
    if (state === 'present') {
      filled++; f.filled++; values++;
      if (!cells.every(x => settled(s.id, x))) { unsettled++; s.unsettled++; }
    }
    else if (state === 'not_reported') { nr++; f.nr++; }
    else if (pend.has(k)) { pending++; f.pending++; s.pending++; }
    else { s.empty++; f.empty++; }
  }));
  const cells = counted.length * cols.length;
  return { studies: counted.length, fields: cols.length, cells, filled, nr, pending, empty: cells - filled - nr - pending, values, unsettled,
    // what needs work first: the fields with the most empty cells, then the least reported
    fieldRows: fieldRows.sort((a, b) => b.empty - a.empty || b.pending - a.pending || a.filled / Math.max(1, counted.length) - b.filled / Math.max(1, counted.length) || a.label.localeCompare(b.label)),
    studyRows: studyRows.filter(s => s.empty || s.pending).sort((a, b) => b.empty - a.empty || b.pending - a.pending),
    unsettledRows: studyRows.filter(s => s.unsettled).sort((a, b) => b.unsettled - a.unsettled || a.label.localeCompare(b.label)),
    // each scale with its whole name (lib/scale-names.mjs), for its heading's tooltip
    outcomes: outcomes.map(g => ({ ...g, title: g.instrument ? scaleTitleOf(st, g.instrument) : g.label })) };
}

/** A share as a meter: neutral fills, the numbers beside it carry the values. `a` is the first part (a value), `b` the second (not reported). */
const meter = (a, of, w = 80, b = 0, fluid = false) => { const x = (w * a) / Math.max(1, of), y = (w * b) / Math.max(1, of);
  return `<svg class="syn-mini syn-meter" width="${w}" height="8" viewBox="0 0 ${w} 8"${fluid ? ' preserveAspectRatio="none"' : ''} aria-hidden="true"><rect class="syn-meter-bg" width="${w}" height="8" rx="2"/>${b ? `<rect class="syn-meter-nr" width="${x + y}" height="8" rx="2"/>` : ''}<rect class="syn-meter-fg" width="${x}" height="8" rx="2"/></svg>`; };
const parts = xs => xs.filter(Boolean).map(esc);
const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;

/** The Model extraction section: only what a model has to act on, each as a count and an action; '' when there is none. */
function modelSection(h, run) {
  const acts = [
    h.empty && { id: 'ext-hub-fill', label: 'Fill empty cells', icon: 'run', disabled: !!run.running },
    h.pending && { id: 'ext-hub-review', label: 'Review proposals', icon: 'checklist' },
    run.clean && { id: 'ext-hub-clean', label: 'Accept clean', icon: 'check' }].filter(Boolean).map((a, i) => ({ ...a, ...(i === 0 ? { role: 'primary' } : {}) }));
  if (!acts.length) return '';
  const props = [
    h.empty ? row('Model', run.model ? `<span title="${esc(run.model)}">${esc(modelName(run.model))}</span>` : '<span class="meta">Not connected</span>') : '',
    h.empty ? row('Empty cells', `${num(h.empty)} in ${plural(h.studyRows.filter(s => s.empty).length, 'study', 'studies')}`) : '',
    h.pending ? row('Waiting for review', `${plural(h.pending, 'proposal')}${run.clean ? `, ${num(run.clean)} clean` : ''}`) : ''].join('');
  return `<section class="syn-sec"><h3>Model extraction</h3>${props ? `<dl class="props ext-hub-props">${props}</dl>` : ''}
    ${uiBar({ kind: 'foot', label: 'Model extraction', id: 'ext-hub-acts', actions: acts })}</section>`;
}

/**
 * What verification still has open: the studies with the most open values, from the proof checker's findings (run.proof, lib/proof-state.mjs
 * openValues) when it has run, else the reviewers' records of the values. A section of its own, titled with its count; '' with nothing open.
 */
function openStudiesSection(h, run) {
  const p = run.proof, items = p ? p.rows : h.unsettledRows;
  if (!items.length) return '';
  const page = pagedList('ext-hub-open', items, { label: 'studies', size: OPEN_PAGE_SIZE });
  const list = uiList({ label: 'Open values by study', cols: ['count'], rows: page.items.map(s => {
    const why = p && (s.error || s.contradicted) ? parts([s.error && `${num(s.error)} in error`, s.contradicted && `${num(s.contradicted)} contradicted by the paper`, s.unproven && `${num(s.unproven)} not proven`]).join(', ') : '';
    return uiRow({ main: { html: uiLink({ label: s.label, title: why, attrs: { 'data-hub-study': s.id, ...(s.at ? { 'data-hub-at': s.at } : {}) } }) },
      cells: [{ col: 'count', kind: 'text', ch: 8, html: esc(num(p ? s.open : s.unsettled)) }] }); }) });
  return `<section class="syn-sec">${countHeading({ title: 'Open values by study', count: num(items.length), countLabel: 'Studies' })}<div class="ui-flush">${list}</div>${page.pager}</section>`;
}

/**
 * The list's lines in category order (each line names its category in `group`), each category's fields least done first; under Outcomes
 * each instrument (most studied first; `sub` names it with its study count) and the statistics its studies report, by time point ("Change SD").
 */
export function fieldItems(h) {
  const out = [];
  for (const c of CATEGORIES) {
    out.push(...h.fieldRows.filter(f => (f.category || 'study') === c.id).map(f => ({ ...f, group: c.label })));
    if (c.id !== 'outcomes') continue;
    for (const g of h.outcomes || []) {
      const sub = `${g.label}, ${plural(g.studies, 'study', 'studies')}`, subTitle = g.title || g.label;
      out.push(...g.points.flatMap(p => p.stats).filter(x => x.reported + x.derived + x.nr > 0)
        .map(x => ({ stat: true, group: c.label, sub, subTitle, instrument: g.label, label: x.label, filled: x.reported + x.derived, nr: x.nr, empty: x.empty, pending: 0, of: g.studies })));
    }
  }
  return out;
}
/** The fields, one compact line each, their columns aligned down the list (a subgrid, as the Overview's stages are): name, bar, counts. */
function fieldsSection(h) {
  const waiting = h.pending > 0, page = pagedList('ext-hub-fields', fieldItems(h), { label: 'fields', size: FIELDS_PAGE_SIZE });
  const n = x => (x ? num(x) : '');
  const cell = (cls, html) => `<span class="ext-hub-n ${cls}">${html}</span>`;
  // a page holds fields only; each page names the category (and the instrument) its fields stand under
  const heads = (f, i) => { const prev = page.items[i - 1], out = [];
    if (!prev || prev.group !== f.group) out.push(`<p class="ext-hub-fgroup" role="listitem">${esc(f.group)}</p>`);
    if (f.sub && (!prev || prev.sub !== f.sub || prev.group !== f.group)) out.push(`<p class="ext-hub-fgroup ext-hub-fsub" role="listitem" title="${esc(f.subTitle || f.sub)}">${esc(f.sub)}</p>`);
    return out.join(''); };
  const rows = page.items.map((f, i) => heads(f, i) + line(f)).join('');
  function line(f) {
    const name = f.stat ? f.label : readableLabel(f.unit ? `${f.label} (${f.unit})` : f.label), of = f.of || h.studies;
    const counts = `${cell('rep', num(f.filled))}${cell('nr', n(f.nr))}${cell('emp', n(f.empty))}${waiting ? cell('wait', n(f.pending)) : ''}`;
    const title = esc(`${f.stat ? `${f.instrument}, ${name}` : name}: ${f.filled} reported, ${f.nr} not reported, ${f.empty} empty${f.pending ? `, ${f.pending} waiting` : ''}${f.stat ? ` of ${plural(of, 'study', 'studies')}` : ''}`);
    // an outcome statistic counts studies of its instrument; its row opens nothing of its own
    if (f.stat) return `<div class="ext-hub-frow ext-hub-fstat" role="listitem" title="${title}"><span class="ext-hub-fname">${esc(name)}</span><span class="ext-hub-fbar">${meter(f.filled, of, 96, f.nr, true)}</span>${counts}</div>`;
    return `<button type="button" class="ext-hub-frow" role="listitem" data-hub-field="${esc(f.id)}" title="${title}">`
      + `<span class="ext-hub-fname">${esc(name)}</span><span class="ext-hub-fbar">${meter(f.filled, of, 96, f.nr, true)}</span>${counts}</button>`; }
  return `<section class="syn-sec"><h3>Fields</h3><div class="ext-hub-fields" role="list" aria-label="Fields, least done first"${waiting ? ' data-waiting' : ''}>
    <div class="ext-hub-fhead" aria-hidden="true"><span>Field</span><span class="ext-hub-fbar"></span>${cell('rep', 'Reported')}${cell('nr', 'Not reported')}${cell('emp', 'Empty')}${waiting ? cell('wait', 'Waiting') : ''}</div>${rows}</div>${page.pager}</section>`;
}

/**
 * The three progress rows: what is decided, what the checker or a reviewer has settled, what a person checked. Each is "done of base unit" with a
 * meter and what is left; its base differs (cells, values, checks or studies), so each says so in its detail and title.
 */
function progressRows(h, run) {
  const p = run.proof, pc = run.people?.items ? run.people : null, rows = [];
  const decided = h.filled + h.nr, open = [h.empty && `${num(h.empty)} empty`, h.pending && `${num(h.pending)} waiting for review`].filter(Boolean).join(', ');
  const studiesDone = h.studies - h.studyRows.filter(s => s.empty).length;
  rows.push({ label: 'Cells decided', base: h.cells, unit: 'cells', done: decided, parts: [h.filled, h.nr],
    detail: `${num(h.filled)} with a value, ${num(h.nr)} not reported${open ? `; ${open}` : ''}; ${num(studiesDone)} of ${plural(h.studies, 'study', 'studies')} and ${num(h.fieldRows.filter(f => f.filled + f.nr === h.studies).length)} of ${plural(h.fields, 'field', 'fields')} complete`,
    title: `A cell is one study's field: ${num(h.studies)} studies × ${num(h.fields)} fields. Outcome statistics are counted per scale under Fields.`,
    open: { kind: 'cells', title: 'Open the study with the most cells left' } });
  if (p) {
    const left = p.unproven + p.error + p.contradicted, open2 = [p.unproven && `${num(p.unproven)} not proven`, p.error && `${num(p.error)} in error`, p.contradicted && `${num(p.contradicted)} contradicted by the paper`].filter(Boolean);
    rows.push({ label: 'Proven by the checker', base: p.values, unit: 'values', done: Math.max(0, p.values - left), left, detail: open2.length ? open2.join(', ') : 'Nothing open',
      title: 'A value is one extracted value with its proof in the paper; the checker marks it proven, not proven, in error or contradicted.',
      open: { kind: 'values', title: 'Open the study with the most open values' } });
  } else if (h.values) rows.push({ label: 'Agreed by a reviewer', base: h.values, unit: 'values', done: h.values - h.unsettled, left: h.unsettled,
    // what is open is the row's Left: the detail does not say it again
    detail: h.unsettled ? '' : 'Nothing open', title: 'A value counts when a reviewer\'s record agrees with it as it stands now.',
    open: { kind: 'values', title: 'Open the study with the most open values' } });
  if (pc) {
    const vl = (pc.lists || []).filter(l => l.kind === 'value');
    if (vl.length) { const asked = vl.reduce((n, l) => n + l.asked, 0), done = vl.reduce((n, l) => n + l.done, 0), next = vl.find(l => l.done < l.asked);
      // the checks are made in Screening › Verify: the Left opens the first value list with checks left (W13, finding 1)
      rows.push({ label: 'Checked by a person', base: asked, unit: 'checks', done, detail: vl.map(l => `${l.id} ${l.name}: ${num(l.done)} of ${num(l.asked)}`).join('; '),
        title: 'Checks a person was asked to make on extracted values, over all value lists.',
        open: next && { kind: 'person-check', list: next.id, title: `Check ${next.id} ${next.name} in Screening › Verify` } }); }
    else { const d = pc.data || { n: pc.items, checked: pc.checked };
      rows.push({ label: 'Checked by a person', base: d.n, unit: 'studies', done: d.checked, detail: `${num(d.checked)} of ${num(d.n)} studies have their extracted values checked`,
        title: 'Studies whose extracted values a person has checked.' }); }
  }
  return rows.map(r => ({ ...r, left: r.left ?? Math.max(0, r.base - r.done) }));
}
// the base the rows count from comes first, on the rows' own columns: the included studies (lib/review-counts.mjs, never the records)
const progressHtml = (rows, studies) => `<div class="ext-hub-prog" role="list" aria-label="Progress">
  <div class="ext-hub-pbase" role="listitem"><span class="ext-hub-pname">Studies</span><span class="ext-hub-pbase-v">${esc(`${num(studies)} included`)}</span></div>
  <div class="ext-hub-phead" aria-hidden="true"><span></span><span></span><span class="ext-hub-n">Done</span><span class="ext-hub-n">Left</span></div>${rows.map(r =>
  `<div class="ext-hub-prow" role="listitem" title="${esc(r.title)}"><span class="ext-hub-pname">${esc(r.label)}</span><span class="ext-hub-fbar">${meter(r.parts ? r.parts[0] : r.done, r.base, 160, r.parts ? r.parts[1] : 0, true)}</span>`
  + `<span class="ext-hub-n">${esc(`${num(r.done)} of ${num(r.base)} ${r.unit}`)}</span><span class="ext-hub-n ext-hub-left">${leftHtml(r)}</span><span class="ext-hub-pdetail">${esc(r.detail)}</span></div>`).join('')}</div>`;
// what is left opens where it is worked: a study of the table, or a list in Screening › Verify; a row with nowhere to go keeps a figure
const leftHtml = r => (!r.left ? '' : r.open ? uiLink({ label: num(r.left), title: r.open.title, attrs: { 'data-hub-left': r.open.kind, 'data-hub-list': r.open.list } }) : esc(num(r.left)));
/** The study a Left opens: the one with the most cells left, or the most open values (the first row of Open values by study). */
const leftStudy = (h, run, kind) => (kind === 'cells' ? h.studyRows[0] : (run.proof ? run.proof.rows : h.unsettledRows)[0]) || null;

/** The page's HTML from its counts and what a run can do: { model, running, clean, rules, disagreements, proof, people }. */
export function hubHtml(h, run = {}) {
  if (!h.studies) return emptyState({ icon: 'extraction', title: 'No studies yet', size: 'inline' });
  const props = [run.rules ? row('Rules', esc(run.rules)) : '', run.disagreements ? row('Disagreements', plural(run.disagreements, 'cell')) : ''].join('');
  return `<div class="ext-hub" role="region" aria-label="Extraction overview">
    <section class="syn-sec"><h3>Progress</h3>${progressHtml(progressRows(h, run), h.studies)}${props ? `<dl class="props ext-hub-props">${props}</dl>` : ''}</section>
    ${modelSection(h, run)}${openStudiesSection(h, run)}${fieldsSection(h)}</div>`;
}

/** Draws the page and wires its rows and actions to `on`: { fill(anchor), review(), clean(), field(id), study(id, at), left(kind, list) }; `at` is the value key
 * of the study's row, when it has one; `left` opens a person check's list. */
export function renderHub(el, h, run, on) {
  el.innerHTML = hubHtml(h, run);
  fitSplit(el, HUB_SPLIT);   // two columns once the host holds both (measured on the host: the hub's own one-column cap would hold it narrow; W6 review)
  const fields = el.querySelector('.ext-hub-fields'); if (fields) fitSplit(fields, FIELDS_BAR_MIN);   // too narrow for a bar beside the counts: the bar goes, the counts stay
  el.querySelector('#ext-hub-fill')?.addEventListener('click', e => on.fill(e.currentTarget));
  el.querySelector('#ext-hub-review')?.addEventListener('click', () => on.review());
  el.querySelector('#ext-hub-clean')?.addEventListener('click', () => on.clean());
  el.querySelectorAll('[data-hub-field]').forEach(r => r.addEventListener('click', () => on.field(r.dataset.hubField)));
  el.querySelectorAll('[data-hub-study]').forEach(r => r.addEventListener('click', () => on.study(r.dataset.hubStudy, r.dataset.hubAt || '')));
  el.querySelectorAll('[data-hub-left]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.hubLeft, first = kind === 'person-check' ? null : leftStudy(h, run, kind);
    if (kind === 'person-check') on.left?.(kind, b.dataset.hubList || ''); else if (first) on.study(first.id, first.at || '');
  }));
  wirePagedLists(el, () => renderHub(el, h, run, on));
}

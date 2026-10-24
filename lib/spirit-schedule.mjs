// The SPIRIT schedule of enrolment, interventions and assessments (SPIRIT 2013
// item 13 and its figure): timepoints across, what happens down, a mark where
// a row happens at a timepoint.
//
//   { timepoints: [{ id, label, window }],
//     rows: [{ id, section: 'enrolment'|'interventions'|'assessments', label, marks: { [timepointId]: 'x'|'' } }] }
//
// Every helper returns a new schedule; nothing is changed in place. The figure
// is a self-contained SVG in the manner of lib/output-charts.mjs: house
// style (a token set, the c-* classes taking the app's theme on screen): a
// banded heading per section, grey rules, labels wrapped or keyed, never cut.
//
// Pure: nothing here imports the store or a view.
import { newId } from './manuscript.mjs';
import { figureTokens } from './figure-style.mjs';
import { esc, r1, svgRoot, text, lines, wrapText, labelColumn, rowHeight, sourceBlock, keyLines, axisLine, hairLine, measure, GAP, LINE } from './figure-draw.mjs';

export const SECTIONS = [
  { id: 'enrolment', label: 'Enrolment' },
  { id: 'interventions', label: 'Interventions' },
  { id: 'assessments', label: 'Assessments' },
];
const SECTION_IDS = SECTIONS.map(s => s.id);

let seq = 0;
const uid = p => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const clone = s => ({ timepoints: (s?.timepoints || []).map(t => ({ ...t })), rows: (s?.rows || []).map(r => ({ ...r, marks: { ...(r.marks || {}) } })) });

/** The SPIRIT figure's usual starting shape, with [bracketed] labels to replace. */
export function blankSchedule() {
  const tp = [['t-enrol', 'Enrolment', '-t1'], ['t-alloc', 'Allocation', '0'], ['t-1', 't1', ''], ['t-2', 't2', ''], ['t-close', 'Close-out', 'tx']]
    .map(([id, label, window]) => ({ id, label, window }));
  const row = (id, section, label, on) => ({ id, section, label, marks: Object.fromEntries(tp.map(t => [t.id, on.includes(t.id) ? 'x' : ''])) });
  return { timepoints: tp, rows: [
    row('r-eligibility', 'enrolment', 'Eligibility screen', ['t-enrol']),
    row('r-consent', 'enrolment', 'Informed consent', ['t-enrol']),
    row('r-allocation', 'enrolment', 'Allocation', ['t-alloc']),
    row('r-int-a', 'interventions', '[Intervention A]', ['t-1', 't-2']),
    row('r-int-b', 'interventions', '[Intervention B]', ['t-1', 't-2']),
    row('r-baseline', 'assessments', '[Baseline variables]', ['t-enrol', 't-alloc']),
    row('r-outcomes', 'assessments', '[Outcome variables]', ['t-1', 't-2', 't-close']),
  ] };
}

/** Adds a timepoint at `index` (default last); every row gets an empty mark for it. */
export function addTimepoint(schedule, { label = '', window = '', id = uid('t') } = {}, index = null) {
  const s = clone(schedule);
  const at = index == null ? s.timepoints.length : Math.max(0, Math.min(index, s.timepoints.length));
  s.timepoints.splice(at, 0, { id, label, window });
  for (const r of s.rows) r.marks[id] = '';
  return s;
}
export function removeTimepoint(schedule, id) {
  const s = clone(schedule);
  s.timepoints = s.timepoints.filter(t => t.id !== id);
  for (const r of s.rows) delete r.marks[id];
  return s;
}
const shift = (list, i, delta) => {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list]; [out[i], out[j]] = [out[j], out[i]]; return out;
};
/** Moves a timepoint one or more places left (negative) or right. */
export function moveTimepoint(schedule, id, delta) {
  const s = clone(schedule);
  s.timepoints = shift(s.timepoints, s.timepoints.findIndex(t => t.id === id), delta);
  return s;
}
export function updateTimepoint(schedule, id, patch) {
  const s = clone(schedule);
  s.timepoints = s.timepoints.map(t => t.id === id ? { ...t, ...patch, id } : t);
  return s;
}

/** Adds a row at the end of its section. */
export function addRow(schedule, { section = 'assessments', label = '', id = uid('r'), marks = {} } = {}) {
  if (!SECTION_IDS.includes(section)) throw new Error(`Unknown section: ${section}`);
  const s = clone(schedule);
  const row = { id, section, label, marks: Object.fromEntries(s.timepoints.map(t => [t.id, marks[t.id] === 'x' ? 'x' : ''])) };
  const lastOfSection = s.rows.map(r => r.section).lastIndexOf(section);
  const at = lastOfSection >= 0 ? lastOfSection + 1
    : s.rows.findIndex(r => SECTION_IDS.indexOf(r.section) > SECTION_IDS.indexOf(section));
  s.rows.splice(at < 0 ? s.rows.length : at, 0, row);
  return s;
}
export function removeRow(schedule, id) {
  const s = clone(schedule);
  s.rows = s.rows.filter(r => r.id !== id);
  return s;
}
/** Moves a row within its section; it never crosses into another. */
export function moveRow(schedule, id, delta) {
  const s = clone(schedule);
  const i = s.rows.findIndex(r => r.id === id);
  if (i < 0) return s;
  const same = s.rows.map((r, k) => [r, k]).filter(([r]) => r.section === s.rows[i].section).map(([, k]) => k);
  const pos = same.indexOf(i), to = same[pos + delta];
  if (to == null) return s;
  [s.rows[i], s.rows[to]] = [s.rows[to], s.rows[i]];
  return s;
}
export function updateRow(schedule, id, patch) {
  const s = clone(schedule);
  s.rows = s.rows.map(r => r.id === id ? { ...r, ...patch, id, marks: { ...r.marks, ...(patch.marks || {}) } } : r);
  return s;
}
/** Sets or clears one mark; `on` undefined toggles it. */
export function setMark(schedule, rowId, timepointId, on) {
  const s = clone(schedule);
  const r = s.rows.find(x => x.id === rowId);
  if (r && s.timepoints.some(t => t.id === timepointId)) r.marks[timepointId] = (on ?? r.marks[timepointId] !== 'x') ? 'x' : '';
  return s;
}

/** Problems as `[{ level: 'error'|'warning', key, text }]`. */
export function validateSchedule(schedule) {
  const out = [];
  const tp = schedule?.timepoints || [], rows = schedule?.rows || [];
  const add = (level, key, text) => out.push({ level, key, text });
  if (!tp.length) add('error', 'timepoints', 'No timepoints.');
  if (!rows.length) add('error', 'rows', 'No rows.');
  const dup = xs => xs.filter((x, i) => xs.indexOf(x) !== i);
  for (const id of new Set(dup(tp.map(t => t.id)))) add('error', id, `Timepoint id ${id} is used twice.`);
  for (const id of new Set(dup(rows.map(r => r.id)))) add('error', id, `Row id ${id} is used twice.`);
  tp.forEach((t, i) => { if (!String(t.label || '').trim()) add('error', t.id, `Timepoint ${i + 1} has no label.`); });
  const ids = new Set(tp.map(t => t.id));
  for (const r of rows) {
    if (!SECTION_IDS.includes(r.section)) add('error', r.id, `Row ${r.label || r.id} has an unknown section.`);
    if (!String(r.label || '').trim()) add('error', r.id, 'A row has no label.');
    else if (/^\[.*\]$/.test(r.label.trim())) add('warning', r.id, `Replace the placeholder ${r.label.trim()}.`);
    for (const [k, v] of Object.entries(r.marks || {})) {
      if (!ids.has(k)) add('warning', r.id, `Row ${r.label || r.id} marks a timepoint that no longer exists.`);
      else if (v !== 'x' && v !== '') add('error', r.id, `Row ${r.label || r.id} has a mark other than x.`);
    }
    if (String(r.label || '').trim() && !tp.some(t => r.marks?.[t.id] === 'x')) add('warning', r.id, `${r.label} is not marked at any timepoint.`);
  }
  // rows out of section order would draw one section twice
  const order = rows.map(r => SECTION_IDS.indexOf(r.section)).filter(i => i >= 0);
  if (order.some((x, i) => i && x < order[i - 1])) add('warning', 'rows', 'Rows are not grouped by section.');
  return out;
}

const headerOf = t => [t.label, t.window].filter(x => String(x || '').trim()).join(' ');
/** Rows in section order, with the section each starts. */
function ordered(schedule) {
  const rows = schedule.rows || [];
  return SECTIONS.map(sec => ({ sec, rows: rows.filter(r => r.section === sec.id) })).filter(g => g.rows.length);
}

const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV: a header of timepoints, then Section,Row,marks… */
export function toCsv(schedule) {
  const tp = schedule.timepoints || [];
  const lines = [['Section', 'Row', ...tp.map(headerOf)]];
  for (const { sec, rows } of ordered(schedule)) for (const r of rows) lines.push([sec.label, r.label, ...tp.map(t => r.marks?.[t.id] === 'x' ? 'X' : '')]);
  return lines.map(l => l.map(csvCell).join(',')).join('\n') + '\n';
}

/**
 * The schedule as a manuscript table block (the grid shape lib/markdown.mjs
 * writes): a header row of timepoints, a row naming each section, then its rows.
 * A caption paragraph comes first.
 */
export function toBlocks(schedule, { caption = 'Schedule of enrolment, interventions and assessments' } = {}) {
  const tp = schedule.timepoints || [];
  const cols = tp.length + 1;
  const cell = t => ({ runs: [{ t: String(t ?? '') }], text: String(t ?? '') });
  const bold = t => ({ runs: [{ t: String(t ?? ''), b: true }], text: String(t ?? '') });
  const rows = [{ header: true, cells: [cell(''), ...tp.map(t => cell(headerOf(t)))] }];
  for (const { sec, rows: rs } of ordered(schedule)) {
    rows.push({ cells: [bold(sec.label), ...tp.map(() => cell(''))] });
    for (const r of rs) rows.push({ cells: [cell(r.label), ...tp.map(t => cell(r.marks?.[t.id] === 'x' ? 'X' : ''))] });
  }
  const first = Math.round(468 * 0.34), rest = tp.length ? Math.round((468 - first) / tp.length) : 0;
  const grid = { cols: [first, ...Array(cols - 1).fill(rest)], borders: 'all', rows };
  return [
    { id: newId(), type: 'p', text: caption },
    { id: newId(), type: 'table', styleId: 'Table', grid, text: rows.map(r => r.cells.map(c => c.text).join('\t')).join('\n') },
  ];
}

// ---- the figure -----------------------------------------------------------------
/** The token set a figure is drawn with: the caller's, else the house screen set. */
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });

/**
 * The SPIRIT figure as SVG (house style, FIGURE-STYLE §2): rows × timepoints, a
 * mark where a row happens, a banded heading per section. Row labels wrap to two
 * lines, or become a key under the figure; a timepoint's name and window wrap in
 * its column. `style` is a figureTokens set (the screen set when absent); `width`
 * the width to fit in its unit (the figure widens only when its columns need it).
 */
export function scheduleSvg(schedule, { title = 'Schedule of enrolment, interventions and assessments', width = null, style = null } = {}) {
  const t = tokensOf(style), ls = t.size.label, P = Math.max(t.pad, ls), line = ls * LINE, target = width ?? t.width.double;
  const tp = schedule.timepoints || [], groups = ordered(schedule), rowsN = groups.reduce((n, g) => n + g.rows.length, 0);
  const none = !tp.length || !rowsN;
  if (none) {
    const w = Math.max(target, ls * 20), note = wrapText(t, 'Add at least one timepoint and one row to draw the schedule.', w - 2 * P);
    return svgRoot(t, w, 2 * P + note.length * line, lines(t, P, P + (note.length * line) / 2, note, { cls: 'c-mute' }), { title, desc: `${tp.length} timepoints, ${rowsN} rows` });
  }
  const indent = ls;
  // the label column: row labels at most two lines, within 40 % of the width
  const col = labelColumn(t, groups.flatMap(g => g.rows.map(r => r.label || '')), Math.max(target * 0.4 - indent - P, ls * 6));
  const secW = Math.max(0, ...groups.map(g => measure(t, g.sec.label, 'head')));
  const labelW = Math.max(col.w + indent, secW + ls, ls * 8);
  // the columns: wide enough for the longest word of a heading; as wide as the target allows, never narrower than that
  const word = x => Math.max(0, ...String(x || '').split(/\s+/).map(w => measure(t, w)));
  const minCol = Math.max(ls * 4, ...tp.flatMap(x => [word(x.label), word(x.window)]).map(v => v + ls * GAP * 2));
  const colW = tp.length ? Math.max(minCol, Math.min((target - 2 * P - labelW) / tp.length, ls * 9)) : 0;
  const w = 2 * P + labelW + colW * tp.length, x0 = P + labelW;
  const heads = tp.map(x => ({ label: wrapText(t, x.label || '', colW - ls * GAP).slice(0, 3), window: String(x.window || '').trim() ? wrapText(t, x.window, colW - ls * GAP, 'small').slice(0, 2) : [] }));
  const headH = Math.max(line, ...heads.map(h => h.label.length * line + h.window.length * t.size.small * LINE)) + ls * 0.5;
  const parts = [];
  tp.forEach((x, i) => {
    const cx = x0 + colW * i + colW / 2, h = heads[i];
    h.label.forEach((l, j) => parts.push(text(t, cx, P + ls + j * line, l, { anchor: 'middle', role: 'head', cls: 'c-ink c-head' })));
    h.window.forEach((l, j) => parts.push(text(t, cx, P + ls + h.label.length * line + j * t.size.small * LINE, l, { anchor: 'middle', role: 'small', cls: 'c-mute' })));
  });
  let y = P + headH;
  parts.push(axisLine(t, P, y, w - P, y));
  let keyed = 0;
  for (const g of groups) {
    parts.push(`<rect class="c-band" x="${r1(P)}" y="${r1(y)}" width="${r1(w - 2 * P)}" height="${r1(t.row)}" fill="${t.color.band}"/>`,
      text(t, P + ls * GAP, y + t.row / 2 + ls * 0.35, g.sec.label, { role: 'head', cls: 'c-ink c-head', attrs: `data-section="${g.sec.id}"` }));
    y += t.row;
    g.rows.forEach((r, ri) => {
      const ln = col.lines[keyed++], h = rowHeight(t, ln.length), mid = y + h / 2;
      if (ri) parts.push(hairLine(t, P, y, w - P, y));
      parts.push(lines(t, P + indent, mid, ln, { attrs: `data-row-label="${esc(r.id)}"` }));
      tp.forEach((x, i) => {
        if (r.marks?.[x.id] === 'x') parts.push(text(t, x0 + colW * i + colW / 2, mid + ls * 0.35, '×', { anchor: 'middle', cls: 'c-ink c-mark', attrs: `data-row="${esc(r.id)}" data-timepoint="${esc(x.id)}"` }));
      });
      y += h;
    });
    parts.push(axisLine(t, P, y, w - P, y));
  }
  const foot = sourceBlock(t, P, y + ls * 0.6, w - 2 * P, keyLines(col.keys));
  parts.push(foot.svg);
  const h = y + (foot.h ? ls * 0.6 + foot.h : 0) + P;
  const sections = groups.map(g => `${g.sec.label} ${g.rows.length}`).join(', ');
  return svgRoot(t, w, h, parts.join(''), { title, desc: `${tp.length} timepoints, ${rowsN} rows${sections ? ` (${sections})` : ''}` });
}

/** The house drawing app/lint-figures.mjs checks: the starting schedule, and one with long labels and an empty one. */
export const __fixture = style => {
  const long = addRow(addTimepoint(blankSchedule(), { id: 't-12', label: 'Month 12 follow-up visit', window: '+/- 14 days' }), { id: 'r-long', section: 'assessments', label: 'Patient-reported physical function, pain interference and health-related quality of life questionnaires (long form)' });
  return [{ name: 'scheduleSvg', svg: scheduleSvg(blankSchedule(), { style }) }, { name: 'scheduleSvg-long', svg: scheduleSvg(long, { style }) }, { name: 'scheduleSvg-empty', svg: scheduleSvg({ timepoints: [], rows: [] }, { style }) }];
};

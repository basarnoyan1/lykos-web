// What a column of the Extraction grid says about itself, from the data summary's counts (lib/extraction-summary.mjs `summarise`): the
// values a column's head menu offers as filters, with their counts (research tools review, rows 2 and 3, 2026-10-23); the line under the
// column (how many studies hold a value, a number's median and IQR, a category's most held level and its share); the studies a set of
// column filters keeps; and the grid's order of studies by one column. Pure: field summaries and studies in, words and ids out.
import { histogramBins } from './charts.mjs';
import { fmt, levelRows, percent, levelText } from './extraction-summary-view.mjs';
import { NOT_GIVEN } from './extraction-measures.mjs';
import { num } from './dates.mjs';

const paperOfCell = cell => String(cell).slice(0, String(cell).indexOf(':'));
const idsOf = list => [...new Set((list || []).map(x => x.paperId || paperOfCell(x.cell || x)))];

/**
 * A field's values as choices: [{ key, label, ids }], most held first. A category's levels (and, where several open with the same words,
 * those words as one choice first), a measure reported or not, a number's ranges (three numbers or more), else "Has a value".
 * `states: true` adds the studies that do not report the field ("Not reported", a word the table uses for it included) and those with no
 * value yet ("Empty"), last: the column menu offers them; the data summary's filter does not.
 */
export function columnChoices(f, { states = false } = {}) {
  const out = valueChoices(f);
  if (!states) return out;
  const nr = idsOf([...(f.states.not_reported?.studies || []), ...Object.entries(f.states).filter(([k]) => k.startsWith('written:')).flatMap(([, s]) => s.studies)]);
  return [...out.filter(c => c.key !== 'has'), ...(nr.length ? [{ key: 's:nr', label: NOT_GIVEN, ids: nr }] : []),
    ...(f.states.missing?.n ? [{ key: 's:empty', label: 'Empty', ids: idsOf(f.states.missing.studies) }] : [])];
}
function valueChoices(f) {
  if (f.kind === 'measures') return f.measures.measures.flatMap(m => [{ key: `m:${m.key}`, label: `${m.name} reported`, ids: idsOf(m.studies) }, ...(m.unreported.length ? [{ key: `u:${m.key}`, label: `${m.name} ${NOT_GIVEN.toLowerCase()}`, ids: idsOf(m.unreported) }] : [])]);
  if (f.kind === 'numeric' && f.numeric?.values?.length >= 3) {
    const vals = f.numeric.values, bins = histogramBins(vals.map(x => x.value)), unit = f.unit ? ` ${f.unit}` : '';
    return bins.map((b, j) => ({ key: `n:${j}`, label: `${fmt(b.lo)} to ${fmt(b.hi)}${unit}`, ids: idsOf(vals.filter(x => x.value >= b.lo && (x.value < b.hi || (j === bins.length - 1 && x.value <= b.hi)))) }));
  }
  const levels = f.kind === 'categorical' || f.kind === 'multi' ? levelRows(f).flatMap(l => [{ key: `l:${l.key}`, label: l.label, ids: idsOf(l.studies) }, ...(l.sub || []).map(x => ({ key: `l:${l.key}/${x.key}`, label: `${l.label}: ${x.label}`, ids: idsOf(x.studies) }))]) : [];
  if (!levels.length) return f.states.present.n ? [{ key: 'has', label: 'Has a value', ids: idsOf(f.states.present.studies) }] : [];
  // levels that open with the same words ("Two-stage; part B at 6 mo", "Two-stage for scores under 1.5") are also one choice, first
  const leadOf = label => String(label).split(/\s*(?:[;(,:]|\s(?:for|with|in|at)\s)/)[0].trim();
  const leads = new Map(); for (const l of levels) { const k = leadOf(l.label).toLowerCase(); if (k && k !== l.label.toLowerCase()) (leads.get(k) || leads.set(k, []).get(k)).push(l); }
  const grouped = Array.from(leads, ([, ls]) => ls).filter(ls => ls.length >= 2 || levels.some(l => l.label.toLowerCase() === leadOf(ls[0].label).toLowerCase()))
    .map(ls => { const lead = leadOf(ls[0].label), same = levels.filter(l => leadOf(l.label).toLowerCase() === lead.toLowerCase());
      return { key: `g:${lead.toLowerCase()}`, label: `${lead}, any`, ids: [...new Set(same.flatMap(l => l.ids))] }; });
  return [...grouped, ...levels];
}

/**
 * The studies a set of column filters keeps. `filters` { [fieldId]: [choice key] }; `summaries` the field summaries over every study.
 * Values of one column are either-or, columns are all-of (the data summary's rule). A key no longer offered (a value edited away) keeps
 * nothing for its column. Returns null when no filter is set.
 */
export function keptByColumns(filters = {}, summaries = []) {
  const byId = new Map(summaries.map(f => [f.id, f]));
  let kept = null;
  for (const [fieldId, keys] of Object.entries(filters || {})) {
    if (!keys?.length) continue;
    const f = byId.get(fieldId); if (!f) continue;
    const choices = columnChoices(f, { states: true }), any = new Set(choices.filter(c => keys.includes(c.key)).flatMap(c => c.ids));
    kept = kept ? new Set([...kept].filter(id => any.has(id))) : any;
  }
  return kept;
}
/** The filters with one choice of a column turned on or off; a column with no choice left is dropped. */
export function toggleFilter(filters = {}, fieldId, key) {
  const now = new Set(filters[fieldId] || []);
  if (now.has(key)) now.delete(key); else now.add(key);
  const next = { ...filters };
  if (now.size) next[fieldId] = [...now]; else delete next[fieldId];
  return next;
}
export const filterCount = filters => Object.values(filters || {}).filter(k => k?.length).length;

/**
 * The line under a column: `count` ("18 of 21") and `stat` (a number's "Median 24 (IQR 18 to 36)", a category's most held level and its
 * share of the studies with a value, "Retrospective cohort 64%"), `title` both in full. A free text or a measure has its count only.
 */
export function columnFooter(f) {
  if (!f) return { count: '', stat: '', title: '' };
  const has = f.states.present.n, count = `${num(has)} of ${num(f.studyCount)}`;
  let stat = '';
  // three significant figures: a footer is read at a glance (the summary page and its tooltip keep four)
  const r3 = x => fmt(Number(Number(x).toPrecision(3)));
  if (f.kind === 'numeric' && f.numeric?.n) stat = f.numeric.n >= 2 ? `Median ${r3(f.numeric.median)} (IQR ${r3(f.numeric.q1)} to ${r3(f.numeric.q3)})` : `Value ${r3(f.numeric.median)}`;
  else if ((f.kind === 'categorical' || f.kind === 'multi') && has) {
    const top = levelRows(f)[0];
    if (top && top.n >= 2) stat = `${levelText(top.label)} ${percent(top.n, has)}`;
  }
  return { count, stat, title: [`${count} studies hold a value`, stat].filter(Boolean).join('\n') };
}

/**
 * The studies in one column's order: numbers as numbers, text in reading order; a study with no value comes last whichever way. `textOf(p)`
 * is what the cell shows. Stable: equal values keep the table's order.
 */
export function sortStudies(papers, { dir = 1, numeric = false } = {}, textOf) {
  const key = p => { const t = String(textOf(p) ?? '').trim(); if (!t || t === 'NR') return null; if (numeric) { const n = Number(t.replace(/,/g, '')); return Number.isFinite(n) ? n : t; } return t; };
  const rows = papers.map((p, i) => ({ p, i, k: key(p) }));
  rows.sort((a, b) => {
    if (a.k == null || b.k == null) return (a.k == null) - (b.k == null) || a.i - b.i;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : typeof a.k === 'number' ? -1 : typeof b.k === 'number' ? 1 : String(a.k).localeCompare(String(b.k), undefined, { numeric: true, sensitivity: 'base' });
    return c * dir || a.i - b.i;
  });
  return rows.map(r => r.p);
}

/** Whether a column names its rows by a number or code (#, No., ID): such a column is drawn first, as a spreadsheet's row number is. */
export const isIdColumn = c => /^(#|no\.?|n°|number|id|identifier|study id|record id|ref(erence)? (no\.?|id)|ref\.? ?no\.?)$/i.test(String(c?.label || '').trim());

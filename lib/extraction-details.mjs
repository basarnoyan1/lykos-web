// What the Details panel of one extraction cell says (data summary plan §8, stage 5), as plain data and strings. Pure: no store, no DOM, so a
// test builds the same words for any project. It names no field, level, status word or review topic: every word comes from the summary of the
// cell's field (lib/extraction-summary.mjs), from the project's own mapping or from the value record; the only words written here are the
// interface's own ("Accepted", "Needs review", "percentile").
import { summarise, partsOf, placeNumeric } from './extraction-summary.mjs';
import { notGiven } from './not-given.mjs';
import { percent, fmt, stateRows, stateLabel } from './extraction-summary-view.mjs';
import { shortModel } from './ai.mjs';
import { day, plural, num } from './dates.mjs';

/** "62nd": an ordinal for a percentile. */
export function ordinal(n) {
  const k = Math.abs(Math.round(n)), last = k % 100;
  if (last >= 11 && last <= 13) return `${k}th`;
  return `${k}${({ 1: 'st', 2: 'nd', 3: 'rd' })[k % 10] || 'th'}`;
}

/** A source's place in words: a page, or the abstract (page 0). */
export const pageLabel = page => (Number(page) === 0 ? 'abstract' : `p. ${page}`);

/** Where a value came from, from its extractor: by hand, a model, an import; '' when the record says nothing. */
function byWhom(v) {
  const x = String(v?.extractor || '');
  if (!x) return '';
  if (/^manual/.test(x)) return /derived/.test(x) ? 'derived by hand' : /edited/.test(x) ? 'edited by hand' : 'entered by hand';
  if (/^model:/.test(x)) return `from ${shortModel(x.slice(6).replace(/ \(edited\)$/, ''))}${/\(edited\)/.test(x) ? ', edited' : ''}`;
  if (/^import/.test(x)) return 'from an import';
  return x;
}

/**
 * The cell's status as one plain line. `key` is 'accepted' (a value a person holds), 'reported' (a model or an import reported it and no one has
 * accepted it yet), 'review' (it needs a second look: a rule is broken, a disagreement, an open review note, or a value no one verified) or
 * 'empty'. `reasons` are the interface's words for what needs a look; `notes`, `rules` are counts, `disagree` a list of reasons.
 */
export function statusOf({ value = null, proposal = null, notes = 0, rules = 0, disagree = [] } = {}) {
  const reasons = [];
  if (rules) reasons.push(rules === 1 ? 'a rule is broken' : `${rules} rules are broken`);
  if (disagree.length) reasons.push(...disagree.map(d => String(d).replace(/^./, c => c.toLowerCase())));
  if (notes) reasons.push(plural(notes, 'review note'));
  const unverified = !!value && !!value.verification && !['accepted', 'verified'].includes(value.verification);
  if (unverified) reasons.push('not verified');
  if (reasons.length && (value || proposal)) return { key: 'review', text: `Needs review: ${reasons.join(', ')}`, reasons };
  if (proposal && !value) {
    const by = proposal.origin === 'imported' ? 'an import' : proposal.model ? shortModel(proposal.model) : proposal.origin === 'chat' ? 'the assistant' : 'a model';
    return { key: 'reported', text: `Reported by ${by}, not yet accepted`, reasons };
  }
  if (proposal && value) return { key: 'reported', text: 'Accepted value; a different one is reported and waits', reasons };
  if (!value) return { key: 'empty', text: reasons.length ? `Needs review: ${reasons.join(', ')}` : 'No value', reasons };
  const when = day(value.verified_at || value.at), by = byWhom(value);
  return { key: 'accepted', text: ['Accepted', value.locked ? 'locked' : '', by, when].filter(Boolean).join(', '), reasons };
}

/**
 * The value as structure. A multi-valued field's value is its parts as rows (label, and the status its marker means); one value of a
 * categorical or number field is one row (with the field's unit); free text stays text. `fs` is the field's summary (or null).
 * { type: 'none' | 'parts' | 'single' | 'text', rows?, text? }
 */
export function valueStructure(fs, x, mapping = null) {
  const available = x?.availability === 'not_found' ? 'not_found' : 'present';
  const text = String(x?.reported_value ?? x?.value ?? '').trim();
  if (available === 'not_found') return { type: 'single', rows: [{ label: 'Not reported', status: '' }] };
  if (!text) return { type: 'none' };
  if (fs?.kind === 'multi') {
    const parts = partsOf(text, { markers: fs.markers, mapping });
    if (parts.length >= 2) return { type: 'parts', rows: parts.map(p => ({ label: asLabel(p.label), status: p.status, groups: p.groups })) };
  }
  if (fs?.kind === 'free' || fs?.kind === 'label' || !fs) return { type: 'text', text };
  return { type: 'single', rows: [{ label: text, status: fs?.unit && fs.kind === 'numeric' ? fs.unit : '' }] };
}

/**
 * A part cut from a list as a label of its own: its first letter a capital (the second part of "Alpha x, beta y" reads "Beta"). Only a word
 * written all in small letters is changed, so "pH" and "eGFR" stay as written.
 */
export const asLabel = text => String(text ?? '').replace(/^(\p{Ll})(?=[\p{Ll}'’-]*(?:[^\p{L}]|$))/u, c => c.toUpperCase());

/** Where this cell's value sits among the other studies of its field. See `placement`. */
const OTHERS = 3;    // the largest other levels shown beside the cell's own
const HERE_MAX = 8;  // the cell's own levels shown at most (a long composite value)

/**
 * The cell's place among the studies, from the field's summary:
 *   { kind, state, total }  and, by what the cell holds,
 *   rows [{ key, label, n, pct, here, studies, depth? }]   levels (the cell's own first, then the largest others) or, for a cell with no value, the states
 *   numeric { n, median, q1, q3, min, max, value, p, percentile }   a number among the numbers
 *   hidden  the levels not listed
 * Counts are of studies; `pct` is of the studies that hold a value (of all studies for a state). null when the summary has nothing to say.
 */
export function placement(fs, cell) {
  if (!fs || fs.kind === 'label') return null;   // a study's name or identifier has no place among the others
  const state = Object.keys(fs.states).find(k => fs.states[k].studies.some(s => s.cell === cell)) || 'missing';
  const out = { kind: fs.kind, state, total: fs.states.present.n, studyCount: fs.studyCount };
  if (state !== 'present') {
    out.rows = stateRows(fs).map(s => ({ key: s.key, label: s.label, n: s.n, pct: percent(s.n, fs.studyCount), here: s.key === state, studies: s.studies }));
    if (!out.rows.some(r => r.here)) out.rows.push({ key: state, label: stateLabel(state), n: fs.states[state]?.n || 0, pct: percent(fs.states[state]?.n || 0, fs.studyCount), here: true, studies: fs.states[state]?.studies || [] });
    out.of = fs.studyCount;
    return out;
  }
  if (fs.kind === 'numeric') {
    const d = fs.numeric, mine = d.values.find(v => v.cell === cell), at = mine ? placeNumeric(d, mine.value) : null;
    if (!mine) { out.notNumber = true; return out; }
    out.numeric = { n: d.n, median: d.median, q1: d.q1, q3: d.q3, min: d.min, max: d.max, value: mine.value, p: at?.p ?? null, percentile: at ? Math.round(100 * at.p) : null };
    return out;
  }
  const has = fs.states.present.n;
  // A part with status markers ("Alpha +", "Alpha" and a marker that says it is not given) is in nearly every cell: what tells the studies apart
  // is how many report it. A marker that says the value is not given (./not-given.mjs) does not count; the share is of every study of the table.
  if (fs.kind === 'multi' && fs.levels.some(l => l.sub?.length)) {
    const reported = l => { const ids = new Set(); for (const s of l.sub?.length ? l.sub.filter(x => !notGiven(x.key) && !notGiven(x.label)) : notGiven(l.key) ? [] : [l]) for (const x of s.studies) ids.add(x.paperId); return [...ids]; };
    const row = (l, here) => { const ids = new Set(reported(l)); return { key: l.key, label: asLabel(l.label), n: ids.size, of: fs.studyCount, reported: true, here, studies: l.studies.filter(x => ids.has(x.paperId)) }; };
    const own = fs.levels.filter(l => l.studies.some(s => s.cell === cell)).map(l => row(l, true)).sort((a, b) => b.n - a.n);   // the most reported first
    const rest = fs.levels.filter(l => l.n > 0 && !l.studies.some(s => s.cell === cell)).map(l => row(l, false)).sort((a, b) => b.n - a.n).slice(0, OTHERS);
    out.rows = [...own.slice(0, HERE_MAX), ...rest];
    out.hidden = Math.max(0, fs.levels.filter(l => l.n > 0).length - out.rows.length);
    out.of = fs.studyCount; out.reported = true;
    return out;
  }
  const row = l => ({ key: l.key, label: fs.kind === 'multi' ? asLabel(l.label) : l.label, n: l.n, pct: percent(l.n, has), studies: l.studies });
  const own = fs.levels.filter(l => l.studies.some(s => s.cell === cell)).map(l => ({ ...row(l), here: true }));
  const rest = fs.levels.filter(l => l.n > 0 && !l.studies.some(s => s.cell === cell)).sort((a, b) => b.n - a.n).slice(0, OTHERS).map(l => ({ ...row(l), here: false }));
  out.rows = [...own.slice(0, HERE_MAX), ...rest];
  out.hidden = Math.max(0, fs.levels.filter(l => l.n > 0).length - out.rows.length);
  out.of = has;
  // every listed level held by every study with a value says nothing about this one: nothing to show
  if (out.rows.length && out.rows.every(r => r.n === has)) out.rows = [];
  return out.rows.length ? out : { ...out, rows: [] };
}

/** The field's summary for one cell, from the project's own values: just that field, through the same engine the summary page uses. */
export function fieldSummaryOf({ column, columnId, studies, values, proposals = {}, mapping = null }) {
  const field = { id: columnId, label: column.label || columnId, type: column.type, options: column.options, allowed: column.allowed, unit: column.unit };
  return summarise({ fields: [field], studies: studies.map(p => ({ id: p.id, label: p.label })), values, proposals, mappings: mapping ? { [columnId]: mapping } : {} }).fields[0];
}

/** The numeric statistics as rows [label, text] for a cell's strip, with this study's value and place. */
export function numericPlace(n) {
  if (!n) return [];
  return [['This study', fmt(n.value)], ...(n.percentile != null && n.n > 1 ? [['Place', `${ordinal(n.percentile)} percentile of ${num(n.n)} studies`]] : []),
    ['Median (IQR)', `${fmt(n.median)} (${fmt(n.q1)} to ${fmt(n.q3)})`], ['Range', `${fmt(n.min)} to ${fmt(n.max)}`]];
}

/** Share (0 to 100) of a number along its field's range, for the strip; clamped. */
export const along = (n, x) => (n.max > n.min ? Math.max(0, Math.min(100, 100 * (x - n.min) / (n.max - n.min))) : 50);

/**
 * The review notes of a cell as rows: the label is the kind's words (`kinds`, lib/extraction-review.mjs REVIEW_KINDS), the text the note's own.
 * Apply is offered for kind 'stated' only, when the note holds the value it found and the cell is empty (`empty`).
 */
export function noteRows(notes, kinds, paperId, { empty = true } = {}) {
  return (notes || []).map(n => ({ id: n.id, kind: n.kind, label: kinds[n.kind] || n.kind, text: n.text || '', quote: n.quote || '', page: n.page ?? null, doc: n.docId || paperId,
    canApply: empty && n.kind === 'stated' && String(n.value ?? '').trim() !== '', value: n.value ?? '' }));
}

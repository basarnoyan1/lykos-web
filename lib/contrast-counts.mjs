// A comparison of two arms read from an evidence table's text (plan §I, comparative analysis amendment 2026-10-17).
//
// The single-group reading (lib/derived-counts.mjs) gives one proportion per arm. A comparison gives one row per study: the
// events and patients of the arm on one side (treated) and of the arm on the other (control), for a risk ratio, odds ratio or
// risk difference pooled as any other two-arm outcome.
//
//   outcome.derived = {
//     kind: 'arm-contrast',
//     template: 't_…',
//     columns: ['t_….mechanical_failure_revision', 't_….asd_pjk'],   // the text columns the events are named in
//     items: ['screw loosening', 'asd', …],     // the event's accepted names; an arm's events are the largest count among them
//     studyItems: { [paperId]: ['revision'] },  // a study whose event is named otherwise: its own list replaces `items`
//     arms: { column: 't_….arm_n', treated: 'Dynamic', control: 'Rigid', treatedTerm: 'dynamic', controlTerm: 'rigid',
//             set: { 'paperId@arm1': 'treated' | 'control' | 'none' } },
//     nColumn: 't_….arm_n',                     // optional: the arm's size, "Arm 1 (n=32)"
//     subgroup: { column, levels: [[text, level]] } | null,
//     totals: false,                            // optional: the forest without its pooled estimate (RevMan's "no totals")
//   }
//
// The arms. An arm is on a side when its text in `arms.column` names that side's term and not the other's ("Dynesys dynamic
// stabilization" is dynamic; "Rigid–dynamic construct" is neither), unless a person set it (`set`, by paper and arm id, so a
// corrected cell keeps the choice). A study is compared when exactly one arm is on each side.
//
// The events. Several items may describe one event ("any failure": loosening, breakage, adjacent segment disease). Where a
// paper does not report how they overlap, a patient is counted once by taking the largest count (the convention of the review
// this was built for). An item not reported is left out; an arm with none of the items reported is not reported; an item that
// cannot be read (a bound, a count without a denominator, a count stated for the whole study) makes the arm unreadable, since the
// largest count could be the one not read. Nothing is copied: the counts are read from the cells every time, and each names the
// cell it came from.
import { armsOf, cellKey } from './arms.mjs';
import { parseCountText, armSize, itemKey } from './count-text.mjs';
import { studiesOf, subgroupLevel, armName } from './derived-counts.mjs';

export const CONTRAST = 'arm-contrast';
export const isContrast = d => d?.kind === CONTRAST;
const textOf = v => (v == null ? '' : String(v.reported_value ?? v.normalized_value ?? ''));
const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (term) => (term ? new RegExp(`(^|[^\\p{L}])${escRe(tidy(term))}(?=$|[^\\p{L}])`, 'iu') : null);
/** The columns a comparison reads its events from. */
export const columnsOf = d => (Array.isArray(d?.columns) ? d.columns : d?.column ? [d.column] : []).filter(Boolean);
/** The items a study's events are read from: its own list, else the outcome's. */
export const itemsFor = (d, paperId) => (Array.isArray(d?.studyItems?.[paperId]) ? d.studyItems[paperId] : d?.items || []).map(itemKey);

/** The side an arm is on: what a person set, else what its text names; null when it names both sides or neither. */
export function armSide(arms, paperId, armId, text) {
  const set = arms?.set?.[`${paperId}@${armId}`];
  if (set) return set === 'none' ? null : set;
  const t = names(arms?.treatedTerm)?.test(text) || false, c = names(arms?.controlTerm)?.test(text) || false;
  return t && !c ? 'treated' : c && !t ? 'control' : null;
}

/**
 * One arm's events: the largest count among the items, from the arm's own cells (a shared cell's count describes the whole
 * study). `{ status, events, n, item, key, text, reason }`, status 'count', 'missing' or 'unreadable'.
 */
export function armEvents(s, d, paperId, armId, items, armN) {
  const want = new Set(items), hits = [], texts = [];
  for (const col of columnsOf(d)) {
    const own = armId ? s.values?.[cellKey(paperId, col, armId)] : null, plain = s.values?.[cellKey(paperId, col)];
    const text = textOf(own || plain), key = own ? cellKey(paperId, col, armId) : cellKey(paperId, col);
    if (tidy(text)) texts.push(tidy(text));
    for (const it of parseCountText(text).items) if (want.has(it.key)) hits.push({ ...it, cell: key, shared: !!armId && !own });
  }
  const out = { text: texts.join(' · '), key: hits[0]?.cell || cellKey(paperId, columnsOf(d)[0] || '', armId) };
  const twice = hits.find((h, i) => hits.findIndex(x => x.key === h.key) !== i);
  if (twice) return { ...out, status: 'unreadable', key: twice.cell, reason: `${twice.name}: listed more than once` };
  const bad = hits.find(h => h.status === 'unreadable' || (h.status === 'count' && h.shared));
  if (bad) return { ...out, status: 'unreadable', key: bad.cell, reason: `${bad.name}: ${bad.status === 'count' ? 'stated for the whole study, not per arm' : bad.reason}` };
  const counts = hits.filter(h => h.status === 'count');
  if (!counts.length) return { ...out, status: 'missing', reason: hits.length ? hits.map(h => `${h.name} ${h.reason}`).join('; ') : 'not listed' };
  const top = counts.reduce((a, b) => (b.events > a.events ? b : a));
  if (armN != null && top.n > armN) return { ...out, status: 'unreadable', key: top.cell, reason: `${top.name}: denominator ${top.n} exceeds the arm's n = ${armN}` };
  return { ...out, status: 'count', events: top.events, n: top.n, item: top.name, key: top.cell, items: counts.map(h => h.name) };
}

/**
 * Every study a comparison reads, with its two arms and its counts or the reason it has none. A unit:
 * `{ id, paperId, label, status, reason, key, treated, control, subgroupRaw, subgroup, values, aside }`, status 'count',
 * 'missing' or 'unreadable'; `treated` and `control` are armEvents() with the arm's id and label. Studies with arms on one side
 * only are counted in `oneSided`, not listed: they are not this comparison.
 */
export function contrastUnits(s, d) {
  const template = (s.templates || []).find(t => t.id === d?.template);
  if (!template || !d?.arms?.column) return { units: [], oneSided: [] };
  const units = [], oneSided = [];
  const cell = (pid, col, arm) => textOf(s.values?.[cellKey(pid, col, arm)] || s.values?.[cellKey(pid, col)]);
  for (const p of studiesOf(s, template)) {
    const arms = armsOf(template, p.id);
    if (!arms) continue;
    const sides = arms.map(a => armSide(d.arms, p.id, a.id, cell(p.id, d.arms.column, a.id)));
    const t = arms.filter((_, i) => sides[i] === 'treated'), c = arms.filter((_, i) => sides[i] === 'control');
    const aside = arms.some(a => d.arms.set?.[`${p.id}@${a.id}`] === 'none');
    const label = p.label || p.id;
    if (!t.length && !c.length && !aside) continue;
    if (!t.length || !c.length) { (aside ? units : oneSided).push({ id: p.id, paperId: p.id, label, status: 'aside', reason: aside ? 'set aside' : `no ${(t.length ? d.arms.control : d.arms.treated) || 'arm'} arm`, aside, key: cellKey(p.id, d.arms.column, arms[0].id) }); continue; }
    const items = itemsFor(d, p.id);
    const read = (a, side) => {
      const i = arms.indexOf(a), armN = d.nColumn ? armSize(cell(p.id, d.nColumn, a.id)) ?? armSize(a.label) : armSize(a.label);
      return { ...armEvents(s, d, p.id, a.id, items, armN), arm: a.id, armLabel: armName(a.label, i), side, sideLabel: d.arms[side] || armName(a.label, i) };
    };
    const sub = d.subgroup?.column ? [tidy(cell(p.id, d.subgroup.column, t[0].id)), tidy(cell(p.id, d.subgroup.column, c[0].id))] : ['', ''];
    const subgroupRaw = sub[0] === sub[1] ? sub[0] : [sub[0] || 'NR', sub[1] || 'NR'].join(' vs ');
    const unit = { id: p.id, paperId: p.id, label, subgroupRaw, subgroup: subgroupLevel(d.subgroup, subgroupRaw), aside };
    if (t.length > 1 || c.length > 1) { units.push({ ...unit, status: 'unreadable', reason: `${t.length > 1 ? t.length : c.length} ${(t.length > 1 ? d.arms.treated : d.arms.control) || ''} arms`.replace(/\s+/g, ' '), key: cellKey(p.id, d.arms.column, (t.length > 1 ? t : c)[1].id) }); continue; }
    const tr = read(t[0], 'treated'), co = read(c[0], 'control');
    const worst = [tr, co].find(x => x.status === 'unreadable') || [tr, co].find(x => x.status === 'missing');
    if (worst) { units.push({ ...unit, treated: tr, control: co, status: worst.status, key: worst.key, reason: `${worst.sideLabel}: ${worst.reason}` }); continue; }
    units.push({ ...unit, treated: tr, control: co, status: 'count', key: tr.key, reason: '', values: [tr.events, tr.n, co.events, co.n] });
  }
  units.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { units, oneSided };
}

/**
 * The inputs of a comparison in the shape pooledInputs returns: `ready` (both arms counted), `incomplete` (an arm not reported),
 * `invalid` (unreadable), `aside`, the units as pairwise rows (`{ id, paper, label, values }`), and a snapshot that changes when a
 * count, a cell it came from, a side, a subgroup (when one is used) or the rule changes.
 */
export function contrastInputs(s, d, moderator = '', measure = 'RR') {
  const { units: all, oneSided } = contrastUnits(s, d);
  const paper = id => (s.papers || []).find(p => p.id === id) || { id };
  const ready = all.filter(u => u.status === 'count'), incomplete = all.filter(u => u.status === 'missing');
  const invalid = all.filter(u => u.status === 'unreadable'), aside = all.filter(u => u.status === 'aside');
  const units = ready.map(u => ({ ...u, paper: paper(u.paperId) }));
  const rows = ready.map(u => [u.id, u.label, ...u.values, u.treated.key, u.control.key, moderator ? u.subgroup ?? '' : '']);
  const pending = [...incomplete, ...invalid, ...aside].map(u => [u.id, u.status, u.reason]).sort((a, b) => a[0].localeCompare(b[0]));
  const rule = { kind: CONTRAST, template: d.template, columns: columnsOf(d), items: (d.items || []).map(itemKey), studyItems: d.studyItems || {},
    arms: d.arms || null, nColumn: d.nColumn || '', ...(moderator ? { subgroup: d.subgroup || null } : {}) };
  return { ready: ready.map(u => paper(u.paperId)), incomplete, invalid, aside, oneSided, all, units, measure,
    snapshot: JSON.stringify({ family: 'contrast', derived: rule, moderator, rows, pending }) };
}

/** The item names a comparison's arms use, with how often each is a count: for choosing the event. */
export function contrastItems(s, d) {
  const template = (s.templates || []).find(t => t.id === d?.template), by = new Map();
  if (!template) return [];
  for (const p of studiesOf(s, template)) for (const a of armsOf(template, p.id) || []) for (const col of columnsOf(d)) {
    const v = s.values?.[cellKey(p.id, col, a.id)];
    for (const i of parseCountText(textOf(v)).items) {
      const e = by.get(i.key) || { key: i.key, name: i.name, count: 0 };
      if (i.status === 'count') e.count++;
      by.set(i.key, e);
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** The items a study's arms name in the comparison's columns, in the order first named: for setting that study's own list. */
export function studyItemNames(s, d, paperId) {
  const template = (s.templates || []).find(t => t.id === d?.template), out = new Map();
  for (const a of armsOf(template, paperId) || []) for (const col of columnsOf(d)) {
    const v = s.values?.[cellKey(paperId, col, a.id)] || s.values?.[cellKey(paperId, col)];
    for (const i of parseCountText(textOf(v)).items) if (!out.has(i.key)) out.set(i.key, i.name);
  }
  return [...out].map(([key, name]) => ({ key, name }));
}

/** A new comparison on a table: its first arm column for the sides, its text columns for the events, nothing chosen yet. */
export function startContrast(template) {
  const arm = (template?.armColumns || [])[0] || '';
  return { kind: CONTRAST, template: template?.id || '', columns: [], items: [], studyItems: {}, nColumn: arm,
    arms: { column: arm, treated: 'Treated', control: 'Control', treatedTerm: '', controlTerm: '', set: {} }, subgroup: null };
}

/**
 * What a comparison still needs before it can run, read from its rule as it is: '' when nothing. The event columns, then the events (none
 * chosen is the usual case for a comparison Tables and figures made from a figure), then an arm column and words that set a study's arms on two sides.
 */
export function stillToDo(s, d) {
  if (!columnsOf(d).length) return 'Choose the event columns';
  if (!(d?.items || []).length) return 'Choose the events';
  if (!contrastUnits(s, d).units.some(u => u.status !== 'aside')) return 'Choose the arm column and the sides\' words';
  return '';
}

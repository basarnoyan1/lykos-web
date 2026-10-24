// A printed comparison the app draws itself (views/outputs.mjs drawPrinted): a figure of the paper the app does not draw yet, whose caption sets two sides against each other ("Any failure with
// dynamic versus rigid stabilization"), made a comparison of two arms read from the evidence table's text (lib/contrast-counts.mjs), the
// way a person would make it in Analysis, with what the project already says filled in and nothing invented:
//
//   sides         the caption's two sides (lib/paper-items.mjs captionSides): the first treated, the second control; their words lower case,
//                 in the spelling the arm column writes them ("single stage" or "single-stage", whichever its cells use);
//   arm column    the evidence table's text column whose cells set one arm on each side in the most studies (the template's first arm
//                 column when none does);
//   event columns the columns the project's outcomes already read their counts from (a count outcome's `derived.column`), else none;
//   events        the items of those columns the caption or its legend names (a phrase as written, a list sharing its last word, "screw or
//                 rod breakage", or the initials of a phrase, "adjacent-segment disease" for ASD), never one it names as left out
//                 ("revision surgery was not part of the outcome"); none when it names none ("Any failure"), for the person to choose.
//
// Nothing is run: Run needs the person and R. Pure: the project in, the plan and the outcome out.
import { addOutcome } from './outcomes.mjs';
import { startContrast, contrastUnits, contrastItems, columnsOf, isContrast } from './contrast-counts.mjs';
import { captionSides, captionTitle } from './paper-items.mjs';

const low = t => String(t || '').toLowerCase();
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const flat = t => low(t).replace(/[-‐–]/g, ' ').replace(/\s+/g, ' ').trim();
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The spellings a term may be written in: as the caption has it, with its hyphens as spaces, with its spaces as hyphens. */
export function termForms(term) {
  const t = low(term).replace(/[‐–]/g, '-').replace(/\s+/g, ' ').trim();
  return [...new Set([t, t.replace(/-/g, ' '), t.replace(/ /g, '-')])].filter(Boolean);
}

/** The table a comparison reads: the one the project's outcomes read from, else the first with arms, else the first. */
export function tableFor(s) {
  const list = s.templates || [], used = new Map();
  for (const o of s.outcomes || []) if (o?.derived?.template) used.set(o.derived.template, (used.get(o.derived.template) || 0) + 1);
  const best = [...used].sort((a, b) => b[1] - a[1]).map(([id]) => list.find(t => t.id === id)).find(Boolean);
  return best || list.find(t => (t.armColumns || []).length) || list[0] || null;
}

const compared = (s, d) => contrastUnits(s, d).units.filter(u => u.status !== 'aside').length;
/**
 * The arm column and the spelling of each side's word: every text column of the table (its arm columns first), each spelling of the two
 * words, the one that sets one arm on each side in the most studies. `{ column, treatedTerm, controlTerm, compared, ranked }`; `ranked`
 * lists each column that compares any study, the most first. With none, the table's first arm column and the words as the caption writes them.
 */
export function armColumnFor(s, tpl, sides) {
  const arms = tpl?.armColumns || [], text = (tpl?.columns || []).filter(c => !c.type || c.type === 'text').map(c => c.id);
  const cols = arms.length ? arms.filter(id => text.includes(id)) : text;
  const tf = termForms(sides.treated), cf = termForms(sides.control), base = startContrast(tpl);
  const ranked = [];
  for (const column of cols) {
    let top = null;
    for (const treatedTerm of tf) for (const controlTerm of cf) {
      const n = compared(s, { ...base, arms: { ...base.arms, column, treatedTerm, controlTerm } });
      if (n > (top?.compared || 0)) top = { column, treatedTerm, controlTerm, compared: n };
    }
    if (top) ranked.push(top);
  }
  ranked.sort((a, b) => b.compared - a.compared || cols.indexOf(a.column) - cols.indexOf(b.column));
  return ranked[0] ? { ...ranked[0], ranked } : { column: base.arms.column, treatedTerm: tf[0], controlTerm: cf[0], compared: 0, ranked };
}

/** The columns the project's outcomes read their counts from on this table, in the table's order; none when no outcome reads its text. */
export function eventColumnsOf(s, tpl) {
  const read = new Set();
  for (const o of s.outcomes || []) {
    const d = o?.derived;
    if (!d || d.template !== tpl?.id) continue;
    if (isContrast(d)) columnsOf(d).forEach(c => read.add(c));
    else if (d.column) read.add(d.column);
  }
  return (tpl?.columns || []).map(c => c.id).filter(id => read.has(id));
}

const NEGATED = /\b(not|no|without|except|excluding|excluded|exclusive of)\b/i;
/** The clauses of a caption that say what something is, not what it is not: split at full stops, semicolons and colons. */
const clauses = text => String(text || '').split(/[.;:]\s+|[.;:]$|\n+/).map(flat).filter(c => c && !NEGATED.test(c));
/** Whether a clause names an item: the phrase, a list sharing its last word ("screw or rod breakage"), or its initials ("asd"). */
function names(clause, key) {
  const k = flat(key), words = k.split(' ');
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(k)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(clause)) return true;
  if (words.length === 2) {
    const [a, b] = words.map(escRe), W = '[\\p{L}\\p{N}]+';
    // "screw or rod breakage", "screw, rod or cord breakage"; "screw loosening or breakage"
    if (new RegExp(`(^|[^\\p{L}])${a}(?:\\s*,\\s*${W}|\\s+(?:or|and)\\s+${W}){1,3}\\s+${b}(?=$|[^\\p{L}])`, 'u').test(clause)) return true;
    if (new RegExp(`(^|[^\\p{L}])${a}\\s+${W}(?:\\s*,\\s*${W})*\\s*,?\\s+(?:or|and)\\s+${b}(?=$|[^\\p{L}])`, 'u').test(clause)) return true;
  }
  if (/^[a-z]{3,5}$/.test(k)) {
    const ws = clause.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (let i = 0; i + k.length <= ws.length; i++) if (ws.slice(i, i + k.length).map(w => w[0]).join('') === k) return true;
  }
  return false;
}
/** The item keys of `items` (`[{ key }]`) that the text names, in their order; a clause that says "not", "no" or "without" names none. */
export function namedItems(items, text) {
  const cs = clauses(text);
  return (items || []).filter(i => cs.some(c => names(c, i.key))).map(i => i.key);
}

/** The measure a caption says: odds ratios, risk differences, else risk ratios. */
export const measureIn = text => (/odds ratio/i.test(text) ? 'OR' : /risk difference/i.test(text) ? 'RD' : 'RR');

/**
 * An item's caption and legend, with the legend of the figure it refers to ("Any failure is defined as in Figure 2"): the text its events
 * are read from. `items` are the page's items (lib/paper-items.mjs).
 */
export function legendOf(it, items = []) {
  const own = [captionTitle(it), it?.legend || ''].filter(Boolean).join('. ');
  const refs = [...own.matchAll(/\bas (?:defined )?in (Figure S?\d+)/gi)].map(m => m[1]);
  const more = refs.map(label => items.find(x => x !== it && low(x.label) === low(label))?.legend || '').filter(Boolean);
  return [own, ...more].join('\n');
}

/**
 * What the app makes of a caption, before anything is written: `{ name, measure, definition, derived, found }` or null when the
 * caption sets no two sides against each other or the project has no table. `found` says what was read from where (the report and the
 * inspector's Set up section): `{ label, sides, armColumn, compared, ranked, columns, items, studiesWithItems }`.
 */
export function planFromCaption(s, { label = '', caption = '', legend = '' } = {}) {
  const sides = captionSides(caption), tpl = tableFor(s);
  if (!sides || !tpl) return null;
  const arm = armColumnFor(s, tpl, sides), columns = eventColumnsOf(s, tpl);
  const treated = cap(low(sides.treated)), control = cap(low(sides.control));
  const base = startContrast(tpl);
  const derived = { ...base, columns, arms: { ...base.arms, column: arm.column, treated, control, treatedTerm: arm.treatedTerm, controlTerm: arm.controlTerm, set: {} } };
  const items = columns.length ? namedItems(contrastItems(s, derived), [caption, legend].join('\n')) : [];
  derived.items = items;
  derived.from = { label, sides: 'caption', columns: columns.length ? 'outcomes' : '', items: items.length ? 'legend' : '' };
  const counted = items.length ? contrastUnits(s, derived).units.filter(u => u.status === 'count').length : 0;
  // a caption that names its outcome after a colon ("…arms: Instrument failure") puts it in the name, so two comparisons of the same arms differ
  const what = String(caption).split(':').slice(1).join(':').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  return { name: `${treated} vs ${low(sides.control)}${what && what.length <= 60 ? `: ${low(what)}` : ''}`, measure: measureIn(`${caption} ${legend}`), definition: String(caption).trim(), derived,
    found: { label, sides: [treated, control], armColumn: arm.column, terms: [arm.treatedTerm, arm.controlTerm], compared: arm.compared, ranked: arm.ranked,
      columns, items, counted } };
}

/** Writes the plan: a new outcome (Add outcome), then its comparison rule. Returns the outcome's id. */
export function applyPlan(st, plan) {
  // an outcome of this name already there is set up again, not added a second time (owner, 2026-10-22: seven "Two-stage vs single-stage")
  const key = String(plan.name).replace(/\s+/g, ' ').trim().toLowerCase();
  const oid = (st.outcomes || []).find(o => String(o.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === key)?.id || addOutcome(st, plan.name, plan.measure);
  st.outcomes = st.outcomes.map(o => (o.id === oid ? { ...o, definition: plan.definition, derived: plan.derived } : o));
  return oid;
}

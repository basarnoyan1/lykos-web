// Outcomes a review pools. The first is the project's primary outcome: its
// inputs use the plain field ids and its result is `s.analysis`, exactly as
// before outcomes existed, so every page reading them keeps working. Each
// further outcome has its own name, effect measure, inputs (`field__<id>`)
// and result (`s.analyses[id]`).
import { measureOf } from './effect-measures.mjs';

export const PRIMARY = 'primary';

// An outcome's name is a short label used everywhere it is shown: list rows,
// headings, extraction field labels ("Events, treated · Revision"). What the
// outcome means in full belongs to its definition. A name that is really a
// definition — the protocol's outcome sentence, or a stored name that lists
// several things — is shown by a short name derived from it, and the full
// text is kept as the definition; nothing stored is changed or lost.
const MAX_NAME = 40;
const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
/** Whether a name reads as a definition rather than a label: long, or a list. */
export const isLongName = t => tidy(t).length > MAX_NAME || (tidy(t).match(/[,;]/g) || []).length >= 2;
/** The short name for a text: itself when short, else its first phrase (a primary outcome's list is "Primary outcome"). */
export function shortOutcomeName(text, id = '') {
  const t = tidy(text);
  if (!t) return id === PRIMARY ? 'Primary outcome' : '';
  if (!isLongName(t)) return t;
  if (id === PRIMARY) return 'Primary outcome';
  const first = tidy(t.split(/[,;(]/)[0]);
  if (first && first.length <= MAX_NAME) return first;
  const cut = t.slice(0, MAX_NAME + 1).replace(/\s+\S*$/, '');
  return cut || t.slice(0, MAX_NAME);
}

export function outcomes(s) {
  const extra = (s.outcomes || []).filter(o => o.id !== PRIMARY);
  const primary = (s.outcomes || []).find(o => o.id === PRIMARY);
  const pico = tidy(s.protocol?.pico?.outcome);
  const stored = tidy(primary?.name);
  // a name a person typed (named) is theirs, at any length; only a name that
  // came from elsewhere and reads as a definition is shortened. A definition
  // is listed only when it says more than the name.
  const withDef = (name, def) => ({ name, ...(def && def !== name ? { definition: def } : {}) });
  const shown = (o, fallback) => { const n = tidy(o.name);
    return o.named ? withDef(n || fallback, tidy(o.definition)) : withDef(shortOutcomeName(n, o.id) || fallback, tidy(o.definition) || (isLongName(n) ? n : '')); };
  const first = { id: PRIMARY, ...(primary?.derived ? { derived: primary.derived } : {}), ...(primary?.hidden ? { hidden: true } : {}),
    ...(primary?.timepoints?.length ? { timepoints: primary.timepoints } : {}),
    ...withDef(primary?.named && stored ? stored : shortOutcomeName(stored || pico, PRIMARY),
      tidy(primary?.definition) || (!primary?.named && isLongName(stored) ? stored : '') || pico),
    measure: measureOf(s.settings?.measure || s.analysis?.measure).id };
  return [first, ...extra.map((o, i) => { const { definition: _d, ...rest } = o; return { ...rest, ...shown(o, `Outcome ${i + 2}`), measure: measureOf(o.measure).id }; })];
}
/** The outcomes the Analysis view offers: every outcome not hidden. */
export const shownOutcomes = s => outcomes(s).filter(o => !o.hidden);
/** Hides an outcome from Analysis and its inputs from Extraction; its values and result stay. */
export function setOutcomeHidden(st, outcomeId, hidden) {
  const list = st.outcomes || [];
  const has = list.some(o => o.id === outcomeId);
  const patch = o => { const { hidden: _h, ...rest } = o; return hidden ? { ...rest, hidden: true } : rest; };
  st.outcomes = has ? list.map(o => (o.id === outcomeId ? patch(o) : o)) : [...list, patch({ id: outcomeId })];
  return st;
}
/** Sets what an outcome means in full; the name stays the short label. */
export function setOutcomeDefinition(st, outcomeId, text) {
  const clean = tidy(text), list = st.outcomes || [];
  const patch = o => { const { definition: _d, ...rest } = o; return clean ? { ...rest, definition: clean } : rest; };
  st.outcomes = list.some(o => o.id === outcomeId) ? list.map(o => (o.id === outcomeId ? patch(o) : o)) : [...list, patch({ id: outcomeId })];
  return st;
}
export const outcomeById = (s, id) => { const o = parseSlot(id).outcomeId; return outcomes(s).find(x => x.id === o) || outcomes(s)[0]; };

// ---- timepoints (plan G3) ------------------------------------------------------
// An outcome measured at several times keeps one set of inputs and one result
// per timepoint. Its first timepoint ('t1') uses the keys the outcome always
// had, so data entered before timepoints existed is its first timepoint,
// unchanged; a further one adds `#tN` to the field id ("mean_t__o2#t2") and
// keeps its result at `s.analyses['o2#t2']`. A slot names an outcome at a
// timepoint: the outcome id alone for the first, `${outcomeId}#${tp}` after.
export const FIRST_TP = 't1';
/** The timepoints of an outcome, at least one. */
export function timepointsOf(s, outcomeId) {
  const o = (s.outcomes || []).find(x => x.id === parseSlot(outcomeId).outcomeId);
  const list = Array.isArray(o?.timepoints) ? o.timepoints.filter(t => t && /^t\d+$/.test(t.id)) : [];
  return list.length ? list : [{ id: FIRST_TP, label: '' }];
}
/** The slot of an outcome at a timepoint. */
export const slotId = (outcomeId, tp = FIRST_TP) => (!tp || tp === FIRST_TP ? outcomeId : `${outcomeId}#${tp}`);
/** A slot's outcome and timepoint. */
export function parseSlot(slot) {
  const m = /^(.+)#(t\d+)$/.exec(String(slot ?? PRIMARY));
  return m ? { outcomeId: m[1], tp: m[2] } : { outcomeId: String(slot ?? PRIMARY), tp: FIRST_TP };
}
/** "12 months", or '' for an outcome with one unnamed timepoint. */
export const timepointLabel = (s, slot) => { const { outcomeId, tp } = parseSlot(slot); const t = timepointsOf(s, outcomeId).find(x => x.id === tp); return t?.label || (tp === FIRST_TP ? '' : tp); };

const patchOutcome = (st, outcomeId, fn) => {
  const list = st.outcomes || [];
  st.outcomes = list.some(o => o.id === outcomeId) ? list.map(o => (o.id === outcomeId ? fn(o) : o)) : [...list, fn({ id: outcomeId })];
  return st;
};
/** Adds a timepoint; the first is named too when the outcome had one unnamed timepoint. */
export function addTimepoint(st, outcomeId, label, firstLabel = '') {
  let id = null;
  patchOutcome(st, outcomeId, o => {
    const list = o.timepoints?.length ? [...o.timepoints] : [{ id: FIRST_TP, label: String(firstLabel || '').trim() || 'Timepoint 1' }];
    let n = list.length + 1; while (list.some(t => t.id === `t${n}`)) n++;
    id = `t${n}`;
    return { ...o, timepoints: [...list, { id, label: String(label || '').trim() || `Timepoint ${n}` }] };
  });
  return id;
}
export function renameTimepoint(st, outcomeId, tp, label) {
  const clean = String(label || '').trim(); if (!clean) return st;
  return patchOutcome(st, outcomeId, o => ({ ...o, timepoints: (o.timepoints?.length ? o.timepoints : [{ id: FIRST_TP, label: '' }]).map(t => (t.id === tp ? { ...t, label: clean } : t)) }));
}
/** Removes a further timepoint with its inputs and result; the first stays. */
export function removeTimepoint(st, outcomeId, tp) {
  if (tp === FIRST_TP) return st;
  patchOutcome(st, outcomeId, o => ({ ...o, timepoints: (o.timepoints || []).filter(t => t.id !== tp) }));
  const re = new RegExp(`${outcomeId === PRIMARY ? '' : `__${outcomeId}`}#${tp}(@arm\\d+)?$`);
  for (const k of Object.keys(st.values || {})) {
    const field = k.slice(k.indexOf(':') + 1);
    if (re.test(field) && (outcomeId !== PRIMARY || !/__o[a-z0-9]+#/.test(field))) delete st.values[k];
  }
  if (st.analyses) delete st.analyses[slotId(outcomeId, tp)];
  return st;
}

/** The extraction field holding `base` for an outcome, or an outcome at a timepoint (a slot). */
export const fieldFor = (base, slot = PRIMARY) => {
  const { outcomeId, tp } = parseSlot(slot);
  return `${outcomeId === PRIMARY ? base : `${base}__${outcomeId}`}${tp === FIRST_TP ? '' : `#${tp}`}`;
};
/** The slot a per-outcome field id belongs to, and its base field. */
export function splitField(id) {
  const t = /^(.+)#(t\d+)$/.exec(String(id)), rest = t ? t[1] : String(id), tp = t ? t[2] : FIRST_TP;
  const m = /^(.+)__(o[a-z0-9]+)$/.exec(rest);
  return m ? { base: m[1], outcomeId: slotId(m[2], tp) } : { base: rest, outcomeId: slotId(PRIMARY, tp) };
}
export const analysisOf = (s, slot = PRIMARY) => (slot === PRIMARY ? s.analysis : s.analyses?.[slot]) || null;

/** Stores a result for an outcome or a slot; the primary's first timepoint stays at `s.analysis`. */
export function setAnalysis(st, slot, a) {
  if (slot === PRIMARY) st.analysis = a;
  else st.analyses = { ...(st.analyses || {}), [slot]: a };
  return st;
}
/** Sets an outcome's measure; the primary's is the project default in settings. */
export function setOutcomeMeasure(st, outcomeId, measure) {
  if (outcomeId === PRIMARY) st.settings = { ...(st.settings || {}), measure };
  else st.outcomes = (st.outcomes || []).map(o => (o.id === outcomeId ? { ...o, measure } : o));
  return st;
}
export function addOutcome(st, name, measure = 'RR') {
  const taken = new Set((st.outcomes || []).map(o => o.id));
  let n = taken.size + 2; while (taken.has(`o${n}`)) n++;
  const id = `o${n}`;
  st.outcomes = [...(st.outcomes || []), { id, name: String(name).trim() || `Outcome ${n}`, named: true, measure: measureOf(measure).id }];
  return id;
}
export function renameOutcome(st, outcomeId, name) {
  const clean = tidy(name); if (!clean) return st;
  // the text the outcome was known by, when it was a definition, stays as its definition
  const was = outcomes(st).find(o => o.id === outcomeId);
  const keep = o => (o.definition || !was?.definition ? {} : { definition: was.definition });
  const list = st.outcomes || [];
  st.outcomes = list.some(o => o.id === outcomeId) ? list.map(o => (o.id === outcomeId ? { ...o, ...keep(o), name: clean, named: true } : o))
    : [...list, { id: outcomeId, ...keep({}), name: clean, named: true }];   // the primary's name is stored the first time it is changed
  return st;
}
/**
 * Outcomes that repeat an earlier one (every field but the id and the figure it was read from) and hold nothing of their own (no result, no value): what a
 * repeated Apply left behind. The first of each set is kept. Removing them (removeOutcome) loses nothing.
 */
export function duplicateOutcomes(st) {
  const seen = new Set(), out = [];
  for (const o of st.outcomes || []) {
    // the figure a comparison was read from is not part of what it is: the same caption under six figures is one analysis
    const { id, ...rest } = o, key = JSON.stringify(rest.derived?.from ? { ...rest, derived: { ...rest.derived, from: { ...rest.derived.from, label: '' } } } : rest);
    if (!seen.has(key)) { seen.add(key); continue; }
    const holds = Object.keys(st.analyses || {}).some(k => k === id || k.startsWith(`${id}#`)) || Object.keys(st.values || {}).some(k => new RegExp(`__${id}(#|@|$)`).test(k));
    if (id !== PRIMARY && !holds) out.push(id);
  }
  return out;
}
/** Removes a further outcome with its inputs, timepoints, arm inputs and results; the primary cannot be removed. */
export function removeOutcome(st, outcomeId) {
  if (outcomeId === PRIMARY) return st;
  st.outcomes = (st.outcomes || []).filter(o => o.id !== outcomeId);
  if (st.analyses) for (const k of Object.keys(st.analyses)) if (k === outcomeId || k.startsWith(`${outcomeId}#`)) delete st.analyses[k];
  const re = new RegExp(`__${outcomeId}(#t\\d+)?(@arm\\d+)?$`);
  for (const k of Object.keys(st.values || {})) if (re.test(k)) delete st.values[k];
  return st;
}
/**
 * The manuscript result keys of a slot's pooled effect: pooled.* for the
 * primary, pooled.<id>.* for others, and `.tN` added for a later timepoint
 * (pooled.t2.*, pooled.o2.t2.*).
 */
export const resultPrefix = slot => { const { outcomeId, tp } = parseSlot(slot);
  return `${outcomeId === PRIMARY ? 'pooled' : `pooled.${outcomeId}`}${tp === FIRST_TP ? '' : `.${tp}`}`; };

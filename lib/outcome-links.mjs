// One outcome, one id (plan H5, amended 2026-10-17). `s.outcomes` (lib/outcomes.mjs) is the review's list of outcomes: each has an id, a
// name, an effect measure and, here, a priority and a direction of benefit. Everything else that names an outcome refers to one of them:
//
//   the protocol        its outcome sentence is the primary outcome's definition (lib/outcomes.mjs outcomes())
//   the analysis plan   a row's `outcomeId` (state.sap.analyses)
//   Analysis            the outcome itself: its inputs are its extraction fields (`field__<id>`), its result `s.analyses[id]`
//   Certainty           a GRADE row's `analysisOutcome`
//   SWiM                an outcome domain's `outcomeId`
//
// Naming an outcome in any of these places finds the outcome of that name or makes one, and a new outcome is set up everywhere at once:
// a GRADE row and a SWiM domain, empty, so it is ready wherever the person goes next. Renaming it in one place renames it in all.
//
// Projects from before the id kept these as names. linkOutcomes() stores the id each one resolves to: its stored link, else the one
// outcome of the same name; a name that matches no outcome becomes a hidden one (Analysis lists it under Add outcome, its inputs stay out
// of Extraction), and a name that matches two is left alone and listed by outcomeLinkIssues() for the person. Nothing is merged.
// Pure over the state: the views call these inside update().
import { outcomes, addOutcome, renameOutcome, removeOutcome, setOutcomeHidden, PRIMARY } from './outcomes.mjs';
import { normalizeSwim } from './swim-normalize.mjs';
import { blankOutcome } from './grade.mjs';

/** A link the person removed: the referent names no outcome and is not linked again by its name. */
export const NONE = 'none';
export const PRIORITIES = [['primary', 'Primary'], ['secondary', 'Secondary']];
export const BENEFIT = [['', 'Not stated'], ['higher', 'Higher is better'], ['lower', 'Lower is better']];

const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
/** A name as compared: case, accents, punctuation and spacing aside. */
export const outcomeKey = t => tidy(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The outcomes a name names: by name, or by the full text an outcome is defined by (the protocol's sentence for the primary). */
export function sameName(s, text) {
  const k = outcomeKey(text);
  if (!k) return [];
  return outcomes(s).filter(o => outcomeKey(o.name) === k || (o.definition && outcomeKey(o.definition) === k));
}

// ---- the places an outcome is named --------------------------------------------------------------------------------------------
// Each kind says how to read and write a referent's name and link, so linking, renaming and naming are written once.
const KINDS = {
  grade: { label: 'Certainty', list: s => (Array.isArray(s.grade) ? s.grade : []), name: x => x.name, setName: (x, t) => { x.name = t; },
    link: x => x.analysisOutcome, setLink: (x, id) => { x.analysisOutcome = id; }, key: (x, i) => x.id || `row${i + 1}` },
  swim: { label: 'Synthesis without meta-analysis', list: s => (Array.isArray(s.swim?.outcomes) ? s.swim.outcomes : []), name: x => x.name, setName: (x, t) => { x.name = t; },
    link: x => x.outcomeId, setLink: (x, id) => { x.outcomeId = id; }, key: x => x.id },
  sap: { label: 'Analysis plan', list: s => (Array.isArray(s.sap?.analyses) ? s.sap.analyses : []), name: x => x.outcome, setName: (x, t) => { x.outcome = t; },
    link: x => x.outcomeId, setLink: (x, id) => { x.outcomeId = id; }, key: (x, i) => String(i) },
};
export const PLACES = Object.keys(KINDS);
const isObj = x => x && typeof x === 'object';
const known = (s, id) => !!id && id !== NONE && outcomes(s).some(o => o.id === id);

/** The outcome id a referent names: its stored link, else the one outcome of its name; '' when unlinked, removed or ambiguous. */
export function outcomeIdOf(s, kind, x) {
  const k = KINDS[kind], stored = k.link(x);
  if (stored === NONE) return '';
  if (known(s, stored)) return stored;
  const m = sameName(s, k.name(x));
  return m.length === 1 ? m[0].id : '';
}

/** What names outcome `id`: `{ grade: [rows], swim: [domains], sap: [rows] }`. */
export function usesOf(s, id) {
  const out = {};
  for (const kind of PLACES) out[kind] = KINDS[kind].list(s).filter(x => isObj(x) && outcomeIdOf(s, kind, x) === id);
  return out;
}

/** An outcome's stored entry, or {} for the primary before anything about it was stored. */
const entryOf = (s, id) => (s.outcomes || []).find(o => o.id === id) || {};
/** Primary or secondary: what the person chose, else primary for the review's primary outcome. */
export const priorityOf = (s, id) => entryOf(s, id).priority || (id === PRIMARY ? 'primary' : 'secondary');
/** 'higher', 'lower' or '' (not stated). */
export const benefitOf = (s, id) => entryOf(s, id).benefit || '';

/** Sets an outcome's priority or direction of benefit; '' clears one. */
export function setOutcomeFacts(st, id, patch) {
  const apply = o => {
    const next = { ...o };
    for (const k of ['priority', 'benefit']) if (k in patch) { if (patch[k]) next[k] = patch[k]; else delete next[k]; }
    return next;
  };
  const list = st.outcomes || [];
  st.outcomes = list.some(o => o.id === id) ? list.map(o => (o.id === id ? apply(o) : o)) : [...list, apply({ id })];
  return st;
}

// ---- linking what was named before the id ---------------------------------------------------------------------------------------

/**
 * What linkOutcomes() would do, without doing it: `{ link: n, create: n, ambiguous: [...] }`, where an ambiguous entry is
 * `{ kind, place, name, candidates: [{ id, name }] }`. Read by the views to decide whether there is anything to store.
 */
export function planLinks(s) {
  let link = 0, create = 0;
  const ambiguous = [];
  for (const kind of PLACES) KINDS[kind].list(s).forEach(x => {
    if (!isObj(x)) return;
    const k = KINDS[kind], stored = k.link(x), name = tidy(k.name(x));
    if (stored === NONE || known(s, stored) || !name) return;
    const m = sameName(s, name);
    if (m.length === 1) link++;
    else if (!m.length) create++;
    else ambiguous.push({ kind, place: k.label, name, candidates: m.map(o => ({ id: o.id, name: o.name })) });
  });
  return { link, create, ambiguous };
}

/**
 * Stores the outcome id of everything that names an outcome by name only: the one outcome of that name, or a new hidden outcome when none
 * has it (two places naming the same new outcome make one). A name two outcomes share is left unlinked. Returns
 * `{ linked: [{ kind, name, id }], created: [{ name, id }], ambiguous }`; running it again changes nothing.
 */
export function linkOutcomes(st) {
  const report = { linked: [], created: [], ambiguous: [] };
  for (const kind of PLACES) for (const x of KINDS[kind].list(st)) {
    if (!isObj(x)) continue;
    const k = KINDS[kind], stored = k.link(x), name = tidy(k.name(x));
    if (stored === NONE || known(st, stored) || !name) continue;
    const m = sameName(st, name);
    if (m.length > 1) { report.ambiguous.push({ kind, place: k.label, name, candidates: m.map(o => ({ id: o.id, name: o.name })) }); continue; }
    let id = m[0]?.id;
    if (!id) {
      id = addOutcome(st, name, st.settings?.measure || 'RR');
      setOutcomeHidden(st, id, true);
      report.created.push({ name, id });
    }
    k.setLink(x, id);
    report.linked.push({ kind, name, id });
  }
  return report;
}

/** linkOutcomes() through the store, only when there is something to store (a view calls it as it opens). */
export function ensureLinked(get, update) {
  const p = planLinks(get());
  if (!p.link && !p.create) return null;
  let r = null;
  update(st => { r = linkOutcomes(st); return st; });
  return r;
}

/**
 * What the person should look at: a name two outcomes share, a place naming such a name, and two GRADE rows reporting one outcome.
 * `[{ text }]`, plain sentences; nothing here changes a link.
 */
export function outcomeLinkIssues(s) {
  const out = [];
  const byKey = new Map();
  for (const o of outcomes(s)) { const k = outcomeKey(o.name); if (k) byKey.set(k, [...(byKey.get(k) || []), o]); }
  for (const list of byKey.values()) if (list.length > 1) out.push({ text: `${list.length} outcomes are named ${list[0].name}` });
  for (const a of planLinks(s).ambiguous) out.push({ text: `${a.name} in ${a.place} could be ${a.candidates.length} outcomes` });
  const rows = new Map();
  for (const g of KINDS.grade.list(s)) { if (!isObj(g)) continue; const id = outcomeIdOf(s, 'grade', g); if (id) rows.set(id, (rows.get(id) || 0) + 1); }
  for (const [id, n] of rows) if (n > 1) out.push({ text: `${n} GRADE rows rate ${outcomes(s).find(o => o.id === id)?.name || id}` });
  return out;
}

// ---- making, naming, renaming and removing -----------------------------------------------------------------------------------------

// a project with no SWiM yet starts one here; normalizeSwim keeps each domain's link
const swimOfSt = st => { st.swim = normalizeSwim(st.swim); return st.swim; };
const domainId = sw => { for (let n = sw.outcomes.length + 1; ; n++) if (!sw.outcomes.some(o => o.id === `o${n}`)) return `o${n}`; };
const nameOf = (st, id) => outcomes(st).find(o => o.id === id)?.name || '';

// The research types whose outcomes are pooled (lib/fields.mjs, lib/workflow.mjs): a review of one of these synthesises without
// meta-analysis only when it says so, by having a SWiM domain.
const POOLING = new Set(['meta-analysis', 'systematic-review', 'rapid-review', 'nma-review', 'dta-review', 'umbrella-review']);
/**
 * Whether SWiM is in use, so a new outcome gets its domain: the project has SWiM domains, or its type does not pool. A pooling review
 * with no domain does not sprout SWiM columns (a review with no type pools, as lib/fields.mjs reads it).
 */
export function swimInUse(s) {
  const type = s.project?.researchType;
  return (Array.isArray(s.swim?.outcomes) && s.swim.outcomes.length > 0) || Boolean(type && !POOLING.has(type));
}

/**
 * Sets an outcome up where it is not yet: a GRADE row (empty, linked) and, where SWiM is in use, a SWiM domain (empty, linked). A row or
 * domain that already has the outcome's name is linked, not doubled. Returns `{ gradeId, domainId }` of what it made ('' where none).
 */
export function setUpOutcome(st, id, { grade = true, swim = swimInUse(st) } = {}) {
  const uses = usesOf(st, id), name = nameOf(st, id), made = { gradeId: '', domainId: '' };
  for (const kind of PLACES) for (const x of uses[kind]) if (KINDS[kind].link(x) !== id) KINDS[kind].setLink(x, id);
  if (grade && !uses.grade.length) {
    const row = { ...blankOutcome(name), analysisOutcome: id };
    st.grade = [...(st.grade || []), row];
    made.gradeId = row.id;
  }
  if (swim && !uses.swim.length) {
    const sw = swimOfSt(st), d = { id: domainId(sw), name, outcomeId: id };
    sw.outcomes.push(d);
    made.domainId = d.id;
  }
  return made;
}

/**
 * An outcome named somewhere: the one outcome of that name, else a new one set up everywhere. Returns `{ id, created }`, or
 * `{ id: '', ambiguous: [outcomes] }` when two outcomes have the name.
 */
export function outcomeNamed(st, name, { measure, setUp = true } = {}) {
  const t = tidy(name), m = sameName(st, t);
  if (m.length > 1) return { id: '', ambiguous: m };
  if (m.length === 1) return { id: m[0].id, created: false };
  const id = addOutcome(st, t, measure || st.settings?.measure || 'RR');
  if (setUp) setUpOutcome(st, id);
  return { id, created: true };
}

/** Analysis's Add outcome: the outcome of that name, shown again if it was hidden, else a new one set up everywhere. Returns its id. */
export function addOutcomeNamed(st, name, measure) {
  const r = outcomeNamed(st, name, { measure });
  if (r.id) { setOutcomeHidden(st, r.id, false); return r.id; }
  const id = addOutcome(st, tidy(name), measure || st.settings?.measure || 'RR');
  setUpOutcome(st, id);
  return id;
}

/** Renames an outcome and every place that names it. */
export function renameEverywhere(st, id, name) {
  const t = tidy(name);
  if (!t) return st;
  linkOutcomes(st);   // a place still linked by the old name keeps its outcome
  renameOutcome(st, id, t);
  for (const kind of PLACES) for (const x of KINDS[kind].list(st)) if (isObj(x) && KINDS[kind].link(x) === id) KINDS[kind].setName(x, t);
  return st;
}

/** Points a place at an outcome (or NONE), taking the outcome's name. */
export function linkPlace(st, kind, key, id) {
  const k = KINDS[kind], x = k.list(st).find((y, i) => isObj(y) && k.key(y, i) === key);
  if (!x) return st;
  k.setLink(x, id);
  if (id && id !== NONE) k.setName(x, nameOf(st, id));
  return st;
}

/**
 * The person typed a name into a place (a GRADE row's name, a SWiM domain's head, a plan row's outcome). The place's text is that name;
 * then: an outcome it was linked to is renamed everywhere, unless the name is another outcome's, which the place now names instead;
 * an unlinked place links to the outcome of that name, or makes the outcome and sets it up. Returns
 * `{ renamed | relinked | linked | created: id }`, `{ ambiguous: [outcomes] }` or {} for an empty name.
 */
export function nameAt(st, kind, key, text) {
  const k = KINDS[kind], x = k.list(st).find((y, i) => isObj(y) && k.key(y, i) === key);
  if (!x) return {};
  const t = tidy(text);
  k.setName(x, t);
  if (!t) return {};
  const stored = k.link(x), cur = known(st, stored) ? stored : '', m = sameName(st, t);
  if (cur) {
    if (m.length === 1 && m[0].id !== cur) { linkPlace(st, kind, key, m[0].id); return { relinked: m[0].id }; }
    renameEverywhere(st, cur, t);
    return { renamed: cur };
  }
  if (m.length > 1) return { ambiguous: m };
  if (m.length === 1) { linkPlace(st, kind, key, m[0].id); return { linked: m[0].id }; }
  const id = addOutcome(st, t, st.settings?.measure || 'RR');
  k.setLink(x, id);
  setUpOutcome(st, id);
  return { created: id };
}

const blankRow = g => !Object.values(g.ratings || {}).some(Boolean) && !['effect', 'studies', 'participants', 'comment', 'override', 'absolute', 'comparatorRisk'].some(f => tidy(g[f]))
  && !Object.values(g.explanations || {}).some(e => tidy(typeof e === 'string' ? e : e?.text)) && !Object.values(g.events || {}).some(e => tidy(e));

/**
 * Removes an outcome (lib/outcomes.mjs removeOutcome: its inputs and results) and what was set up for it and never used: an empty GRADE
 * row, a SWiM domain with no direction. A row or domain the person filled in stays, unlinked (NONE), as does a plan row.
 */
export function removeEverywhere(st, id) {
  if (id === PRIMARY) return st;
  linkOutcomes(st);
  const cells = st.swim?.cells || {};
  const used = d => Object.values(cells).some(r => r && r[d.id]);
  st.grade = (st.grade || []).flatMap(g => (isObj(g) && g.analysisOutcome === id ? (blankRow(g) ? [] : [{ ...g, analysisOutcome: NONE }]) : [g]));
  if (st.swim && Array.isArray(st.swim.outcomes)) st.swim.outcomes = st.swim.outcomes.flatMap(d => (isObj(d) && d.outcomeId === id ? (used(d) ? [{ ...d, outcomeId: NONE }] : []) : [d]));
  for (const r of KINDS.sap.list(st)) if (isObj(r) && r.outcomeId === id) r.outcomeId = NONE;
  removeOutcome(st, id);
  return st;
}

/** The outcomes a place can be linked to, for a menu: `[{ id, name, checked }]` with Not linked first. */
export function linkChoices(s, kind, x) {
  const cur = x ? outcomeIdOf(s, kind, x) : '';
  return [{ id: NONE, name: 'Not linked', checked: !cur }, ...outcomes(s).map(o => ({ id: o.id, name: o.name, checked: o.id === cur }))];
}

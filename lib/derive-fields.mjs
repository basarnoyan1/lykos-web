// Derived fields: new category columns read out of the text a table column already holds.
//
// A review's table keeps what each paper says in words ("Dynesys or Safinaz with PEEK rods; mean 4.6 levels"). Words cannot be
// filtered, grouped or counted. A model reads the distinct texts of ONE column and proposes the attributes they state (stage 1, the
// scheme: a label and its levels per attribute), then files each text under those levels (stage 2, the assignment). A level is kept
// only when the quote the model gives for it is in the text it read; an attribute a text does not state stays empty, never guessed.
// Each attribute is a proposal a person accepts on its own: it becomes an ordinary column of the same table (the grid, the query
// layer, Tables and figures and the exports read it like any other), and every value keeps the words it came from and the mark
// that a model derived it.
//
// Pure apart from `ask`, which the caller injects (lib/ai.mjs `complete` in the app, a scripted model in the tests). It names no
// field, device, comorbidity or vocabulary: the attributes and levels come out of the texts.
import { cellKey, armsOf } from './arms.mjs';
import { get, update } from '../store.mjs';
import { templateById, saveTemplate } from './templates.mjs';
import { addField, setAnchoredValue, isLocked } from './fields.mjs';

export const SCHEME_TEXTS = 150;      // distinct texts the scheme call reads at most
export const TEXT_CHARS = 400;        // a longer text is sent clipped to this
export const BATCH_TEXTS = 40;        // texts in one assignment call at most
export const BATCH_CHARS = 14000;     // characters of text in one assignment call at most
export const MAX_FIELDS = 8;
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 12;
export const LABEL_MAX = 60;
export const LEVEL_MAX = 40;
export const MAX_CALLS = 12;          // a run that would take more is refused before it starts

const textOf = v => (v ? String(v.reported_value ?? v.normalized_value ?? '').trim() : '');
export const fold = t => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** True when the quote is in the text, folded for case, accents and spacing. A short value such as "Cosmic" is a valid quote. */
export const quoted = (quote, source) => { const q = fold(quote); return q.length >= 2 && fold(source).includes(q); };
/** A short stable token of a text, to see whether it changed between the proposal and its acceptance. */
export function hashOf(text) { let h = 2166136261; const t = String(text ?? ''); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/**
 * What the column holds, one unit per cell the table has: a study, or an arm of a study when the column differs between arms.
 * `papers` are the studies of the table. Empty cells are not units.
 */
export function sourceUnits(s, templateId, columnId, papers) {
  const tpl = templateId === 'default' ? null : templateById(templateId, s);
  const armColumn = new Set(tpl?.armColumns || []).has(columnId);
  const units = [];
  for (const p of papers) {
    const plain = textOf(s.values?.[cellKey(p.id, columnId)]);
    const arms = armColumn ? armsOf(tpl, p.id) : null;
    if (arms) {
      for (const a of arms) {
        const own = textOf(s.values?.[cellKey(p.id, columnId, a.id)]);
        const text = own || plain;
        if (text) units.push({ paperId: p.id, arm: a.id, label: `${p.label}, ${a.label.replace(/\s*\(n=.*$/i, '') || a.id}`, text });
      }
    } else if (plain) units.push({ paperId: p.id, arm: null, label: p.label, text: plain });
  }
  return units;
}

/** The distinct texts of the units, each once with the units that hold it, so a repeated text is read once. */
export function distinctTexts(units) {
  const map = new Map();
  for (const u of units) { const e = map.get(u.text) || { text: u.text, units: [] }; e.units.push(u); map.set(u.text, e); }
  return [...map.values()].map((e, i) => ({ n: i + 1, ...e }));
}
export const clip = t => (t.length > TEXT_CHARS ? `${t.slice(0, TEXT_CHARS)}…` : t);

/** The assignment calls a set of texts needs, and the first problem that stops the run, if any. */
export function plan(texts) {
  const batches = []; let cur = [], chars = 0;
  for (const t of texts) {
    const len = clip(t.text).length + 8;
    if (cur.length && (cur.length >= BATCH_TEXTS || chars + len > BATCH_CHARS)) { batches.push(cur); cur = []; chars = 0; }
    cur.push(t); chars += len;
  }
  if (cur.length) batches.push(cur);
  const calls = batches.length + 1;
  return { batches, calls, problem: calls > MAX_CALLS ? `This column has ${texts.length} distinct texts; reading them takes ${calls} calls and the limit is ${MAX_CALLS}. Derive from a smaller table.` : '' };
}

/** The scheme call's reply as attributes: a label and its levels each. Anything outside the limits is dropped, not repaired. */
export function validateScheme(reply) {
  const out = [], seen = new Set();
  for (const f of Array.isArray(reply?.fields) ? reply.fields : []) {
    const label = String(f?.label ?? '').trim().replace(/\s+/g, ' ');
    if (!label || label.length > LABEL_MAX || seen.has(fold(label))) continue;
    const levels = []; const lv = new Set();
    for (const o of Array.isArray(f?.options) ? f.options : []) {
      const t = String(o ?? '').trim().replace(/\s+/g, ' ').replace(/;/g, ',');
      if (t && t.length <= LEVEL_MAX && !lv.has(fold(t))) { lv.add(fold(t)); levels.push(t); }
    }
    if (levels.length < MIN_LEVELS || levels.length > MAX_LEVELS) continue;
    seen.add(fold(label));
    out.push({ label, options: levels, multiple: f?.multiple === true, definition: String(f?.definition ?? '').trim().slice(0, 300) });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/**
 * An assignment call's reply, kept only where it is supported: the attribute is one of the scheme's, the level is one of its levels
 * (matched ignoring case), and the quote is in the text of that item. Returns the kept values and how many were dropped.
 */
export function validateAssignment(reply, scheme, batch) {
  const byN = new Map(batch.map(t => [t.n, t]));
  const byLabel = new Map(scheme.map(f => [fold(f.label), f]));
  const kept = []; let dropped = 0; const taken = new Set();
  for (const item of Array.isArray(reply?.items) ? reply.items : []) {
    const t = byN.get(Number(item?.n));
    const values = Array.isArray(item?.values) ? item.values : [];
    if (!t) { dropped += values.length || 1; continue; }
    for (const v of values) {
      const f = byLabel.get(fold(v?.field));
      // one level with its quote, or for a multi-valued attribute a list of them: every level the text states, each with its own words
      const asked = Array.isArray(v?.levels) ? v.levels : [{ value: v?.value, quote: v?.quote }];
      if (!f || taken.has(`${t.n}|${f.label}`)) { dropped += asked.length || 1; continue; }
      const levels = [];
      for (const l of asked) {
        const level = f.options.find(o => fold(o) === fold(l?.value));
        if (level && quoted(l?.quote, t.text) && !levels.some(x => x.value === level) && (f.multiple || !levels.length)) levels.push({ value: level, quote: String(l.quote).trim().slice(0, 300) });
        else dropped++;
      }
      if (!levels.length) continue;
      taken.add(`${t.n}|${f.label}`);
      kept.push({ n: t.n, field: f.label, values: levels.map(l => l.value), quote: levels.map(l => l.quote).join(' | ') });
    }
  }
  return { kept, dropped };
}

/** The proposal for each attribute: its levels with their counts, the units filled of those read, and the cells to write. */
export function proposals(scheme, texts, kept, units) {
  const unitsOf = new Map(texts.map(t => [t.n, t.units]));
  const textsOf = new Map(units.map(u => [`${u.paperId}@${u.arm || ''}`, u.text]));
  return scheme.map(f => {
    const mine = kept.filter(k => k.field === f.label);
    const cells = mine.flatMap(k => unitsOf.get(k.n).map(u => ({ paperId: u.paperId, arm: u.arm, label: u.label, levels: k.values, value: k.values.join('; '), quote: k.quote, src: hashOf(u.text) })));
    const counts = f.options.map(o => {
      const own = cells.filter(c => c.levels.includes(o));
      const examples = [...new Set(own.map(c => textsOf.get(`${c.paperId}@${c.arm || ''}`)))].slice(0, 3).map(x => (x.length > 60 ? `${x.slice(0, 60)}…` : x));
      return { level: o, count: own.length, examples };
    });
    return { label: f.label, options: f.options, multiple: f.multiple, definition: f.definition, cells, counts, filled: cells.length, total: units.length };
  });
}

/** A level no unit takes is no level. The accepted column holds only the levels that occur, in the order the model gave them. */
export const usedLevels = p => p.counts.filter(c => c.count > 0).map(c => c.level);

/**
 * Adds a column to a table (or a custom field of the default table) and returns its id, or null. A multi-valued column is a text column
 * whose levels are read apart (a category column would flag "A; B" as not a level); one that differs by arm joins the table's arm columns.
 * The caller has checked the label is free.
 */
export function addTableColumn({ templateId, label, options, multiple = false, type = null, definition = '', why = '', derivedFrom = '', armCells = false }) {
  const kind = type || (multiple ? 'text' : 'category');
  const s = get();
  if (templateId === 'default') {
    const id = addField({ label, type: kind, options, definition });
    if (id && multiple) update(st => { const f = (st.customFields || []).find(x => x.id === id); if (f) { f.multiple = true; f.options = options; } return st; });
    return id;
  }
  const tpl = templateById(templateId, s);
  if (!tpl) return null;
  const base = fold(label).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column';
  const ids = new Set(tpl.columns.map(c => c.id));
  let key = base, n = 1; while (ids.has(`${tpl.id}.${key}`)) key = `${base}_${++n}`;
  const id = `${tpl.id}.${key}`;
  const column = { id, label, type: kind, guidance: definition, examples: '', why, ...(kind === 'category' || multiple ? { options } : {}), ...(multiple ? { multiple: true } : {}), ...(derivedFrom ? { derivedFrom } : {}) };
  saveTemplate({ ...tpl, columns: [...tpl.columns, column], ...(armCells ? { armColumns: [...new Set([...(tpl.armColumns || []), id])] } : {}) });
  return id;
}

/**
 * Adds the proposed attribute as a column of the table and writes its values. A cell whose source text changed since the proposal, or
 * a locked cell, is left alone and counted. Returns a sentence, or { refused } when nothing can be written.
 */
export function applyDerived({ templateId, sourceColumnId, sourceLabel, label, options, multiple = false, definition = '', cells, model = '', prompt = '' }) {
  const s = get();
  const tpl = templateId === 'default' ? null : templateById(templateId, s);
  if (templateId !== 'default' && !tpl) return { refused: 'The table this was read from is gone.' };
  const taken = (tpl ? tpl.columns : s.customFields || []).some(c => fold(c.label) === fold(label));
  if (taken) return { refused: `A column named ${label} is already in this table.` };
  const levels = options.filter(o => cells.some(c => (c.levels || [c.value]).includes(o)));
  if (levels.length < 1) return { refused: 'No value was left to write.' };
  const current = new Map(sourceUnits(s, templateId, sourceColumnId, (s.papers || []).filter(p => cells.some(c => c.paperId === p.id))).map(u => [`${u.paperId}@${u.arm || ''}`, hashOf(u.text)]));
  const id = addTableColumn({ templateId, label, options: levels, multiple, definition, why: `Derived from ${sourceLabel}`, derivedFrom: sourceColumnId, armCells: cells.some(c => c.arm) });
  if (!id) return { refused: 'The column could not be added.' };
  let written = 0, changed = 0, locked = 0;
  for (const c of cells) {
    if (current.get(`${c.paperId}@${c.arm || ''}`) !== c.src) { changed++; continue; }
    const cellId = c.arm ? `${id}@${c.arm}` : id;
    if (isLocked(get(), `${c.paperId}:${cellId}`)) { locked++; continue; }
    if (setAnchoredValue(c.paperId, cellId, { reported_value: c.value, normalized_value: c.value, origin: 'derived', extractor: `model:${model || 'unknown'}`,
      evidence: [], rationale: `${sourceLabel}: “${c.quote}”`, derivation: `Read from ${sourceLabel}: “${c.quote}”`, proposed_by: { model: model || null, run_id: prompt || null } })) written++;
  }
  const left = [changed && `${changed} source ${changed === 1 ? 'text' : 'texts'} changed`, locked && `${locked} locked`].filter(Boolean).join(', ');
  return `${label}: column added with ${written} ${written === 1 ? 'value' : 'values'}${left ? ` (${left}, left empty)` : ''}`;
}

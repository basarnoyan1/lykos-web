// The local review of extracted data (design note 2026-10-13 §5, stage 4, layer 1): free, deterministic, run in the browser on every press of
// Review data, with no model and no connection.
//
// Pure. It takes the project's extraction schema (the field list), its studies, its values, the text it can read of each study (a PDF's pages,
// an abstract as page 0) and the findings of the project's own rules (lib/cell-rules.mjs checkTable), and returns findings. It names no field,
// topic, unit or category: what a value may be comes from the field's own declared type, range, unit, levels and pattern; what counts as
// repeated or odd comes from the data (the other studies' cells, the quartiles of the field); a missing value is looked for by the words of the
// field's own label. A test proves this by renaming a whole project (test/extraction-review.test.mjs) and by scanning this source.
//
// A finding is a fact with a source anchor, never a change: nothing here writes a value. The few findings a model might settle (a quote that is
// not on its page, an outlier, an empty cell whose paper seems to state a value) carry `ask`, the exact material a model may be asked about
// (lib/extraction-review-model.mjs); everything else is final as it stands.
import { quoteFound, fold } from './quotes.mjs';
import { numberInQuote, numbersIn } from './numbers.mjs';
import { quantile } from './describe.mjs';
import { splitCellId } from './arms.mjs';
import { valueKey } from './extraction-summary.mjs';

/** Thresholds on the shape of data and of text (shares, counts, characters), never on a vocabulary. They are returned so a test or a person sees what decided. */
export const REVIEW_LIMITS = Object.freeze({
  minQuote: 8,            // a quote shorter than this cannot be matched (lib/quotes.mjs) and is not checked
  minOutlierN: 8,         // an outlier is looked for in a number field with at least this many values
  fence: 1.5,             // beyond q1 - fence * IQR or q3 + fence * IQR (R's type 7 quartiles, lib/describe.mjs quantile)
  minTuple: 3,            // two studies repeat each other when this many number fields hold the same numbers
  minTextChars: 60,       // a text repeated across studies is worth a note when it is at least this long
  passageChars: 3000,     // what a model may be shown of one page
  candidates: 3,          // sentences offered for one empty cell
  sentenceChars: 300,
  labelShare: 0.6,        // share of a label's words a sentence must hold to be a candidate for that field
  labelWordChars: 4,      // words of a label shorter than this are not used to find a sentence
});

/** What each kind of finding says in a few words (the interface's own words; the field and the value come from the project). */
export const REVIEW_KINDS = Object.freeze({
  contradicted: 'The text states something else',
  stated: 'The text states a value for this cell',
  quote: 'Quote not found on its page',
  'quote-page': 'Quote is on another page',
  number: 'Quote does not state the number',
  type: 'Not a valid value for its type',
  range: 'Outside the field\'s range',
  unit: 'Unit differs from the field\'s',
  allowed: 'Not an allowed value',
  pattern: 'Does not match the field\'s pattern',
  rule: 'Breaks a project rule',
  duplicate: 'Repeated in another study',
  conflict: 'Contradicts another cell of the study',
  disagree: 'Extraction disagreement',
  outlier: 'Far from the other studies',
  missing: 'Empty, but the text may state it',
});

const text = v => String(v?.reported_value ?? v?.normalized_value ?? '').trim();
const isNumeric = f => f && (f.type === 'number' || f.type === 'integer');
const levelsOf = f => (f?.options?.length ? f.options : f?.allowed?.length ? f.allowed : []).map(String);
const present = v => !!v && v.availability !== 'not_found' && text(v) !== '';
const numberOf = v => {
  const raw = v?.normalized_value ?? v?.reported_value;
  const n = raw == null || String(raw).trim() === '' || typeof raw === 'boolean' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : NaN;
};
/** "5 cm": one number and one trailing word. The word is read as a unit, whatever it is. */
const NUMBER_AND_WORD = /^\s*[-+−]?\d[\d.,]*\s*([^\d\s()[\]±,;:=<>/]+)\s*$/u;

// ---- sources -----------------------------------------------------------------------------------------------------------------------------

/** A study's readable text: `pages` is Map(page -> text) (page 0 is the abstract); `complete` says every page was read. */
export const sourceOf = (sources, docId) => (sources instanceof Map ? sources.get(docId) : sources?.[docId]) || null;

/** The part of a page a model is shown: a window around the value (or the quote's first words), at most `chars`. */
export function windowOf(page, { value = '', quote = '' } = {}, chars = REVIEW_LIMITS.passageChars) {
  const t = String(page || '');
  if (t.length <= chars) return t;
  const lower = t.toLowerCase();
  const tries = [String(value).trim(), String(quote).trim().split(/\s+/).slice(0, 4).join(' '), String(quote).trim().slice(0, 20)].filter(s => s.length >= 2);
  let at = -1;
  for (const s of tries) { at = lower.indexOf(s.toLowerCase()); if (at >= 0) break; }
  if (at < 0) return t.slice(0, chars);
  const from = Math.max(0, Math.min(at - Math.floor(chars / 3), t.length - chars));
  return t.slice(from, from + chars);
}

/** The page of a document that holds a quote, searching the cited page first and then the others; null when none does. */
function pageOfQuote(pages, quote, cited) {
  if (cited != null && pages.has(cited) && quoteFound(quote, pages.get(cited))) return cited;
  for (const [n, t] of pages) if (n !== cited && quoteFound(quote, t)) return n;
  return null;
}

// ---- the cells -----------------------------------------------------------------------------------------------------------------------------

/** Every cell of the table's studies: { key, paperId, fieldId, field, arm, v }. A cell of an arm belongs to its column. */
function cellsOf({ fields, studies, values }) {
  const byId = new Map(fields.map(f => [f.id, f])), ids = new Set(studies.map(s => s.id)), out = [];
  for (const [key, v] of Object.entries(values || {})) {
    const at = key.indexOf(':'); if (at < 1) continue;
    const paperId = key.slice(0, at); if (!ids.has(paperId)) continue;
    const { columnId, arm } = splitCellId(key.slice(at + 1));
    const field = byId.get(key.slice(at + 1)) || byId.get(columnId); if (!field) continue;
    out.push({ key, paperId, fieldId: key.slice(at + 1), field, arm, v });
  }
  return out;
}

// ---- the checks -----------------------------------------------------------------------------------------------------------------------------

/** What the field itself says a value may be, applied to one present cell: type, range, unit, allowed values, pattern. */
function declared(c) {
  const { field: f, v } = c, t = text(v), out = [];
  const fail = (kind, why) => out.push({ kind, text: why });
  if (isNumeric(f)) {
    const word = NUMBER_AND_WORD.exec(t)?.[1];
    const n = numberOf(v);
    if (word && f.unit && fold(word) !== fold(f.unit) && fold(word) !== fold(`${f.unit}s`)) return [{ kind: 'unit', text: `${word} where the field is in ${f.unit}` }];
    if (!Number.isFinite(n)) return [{ kind: 'type', text: f.type === 'integer' ? 'Not a single whole number' : 'Not a single number' }];
    if (f.type === 'integer' && !Number.isInteger(n)) fail('type', 'Not a whole number');
    if (Number.isFinite(f.min) && n < f.min) fail('range', `Below ${f.min}${f.unit ? ` ${f.unit}` : ''}`);
    if (Number.isFinite(f.max) && n > f.max) fail('range', `Above ${f.max}${f.unit ? ` ${f.unit}` : ''}`);
    return out;
  }
  const levels = levelsOf(f);
  if (levels.length && !levels.some(l => valueKey(l) === valueKey(t))) fail('allowed', `Not one of ${levels.length === 1 ? 'the level' : `the ${levels.length} levels`} the field allows`);
  if (f.pattern) { try { if (!new RegExp(f.pattern).test(t)) fail('pattern', 'Does not match the field\'s pattern'); } catch { /* an invalid pattern is the field editor's to report */ } }
  return out;
}

/** The anchor a finding shows: the first piece of evidence a person can open (text on a page, or the abstract as page 0). */
function anchorOf(v) {
  for (const e of v?.evidence || []) if ((e.kind === 'text' || e.kind === 'abstract' || !e.kind) && (e.quote || e.page != null)) return { doc: e.doc_id || null, page: e.kind === 'abstract' ? 0 : Number(e.page) || null, quote: String(e.quote || '') };
  return null;
}

/** Sentences of a page, each with its page; a sentence is cut at the characters given. */
function sentencesOf(pages, chars) {
  const out = [];
  for (const [page, t] of pages) for (const s of String(t).split(/(?<=[.!?])\s+(?=[\p{Lu}\d(\[])/u)) { const x = s.trim(); if (x.length >= 12) out.push({ page, text: x.length > chars ? `${x.slice(0, chars - 1)}…` : x }); }
  return out;
}
const wordsOf = label => [...new Set(fold(label).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];

/** The sentences of a study that a field's own label points at, and that hold a number (a number field) or a declared level (a field with levels). */
function candidatesFor(f, sentences, limits) {
  const numeric = isNumeric(f), levels = levelsOf(f).map(fold).filter(l => l.length >= 3);
  if (!numeric && !levels.length) return [];
  let words = wordsOf(f.label || f.id).filter(w => w.length >= limits.labelWordChars);
  if (!words.length) return [];
  const need = Math.max(1, Math.ceil(words.length * limits.labelShare));
  const unit = f.unit ? fold(f.unit) : '';
  const scored = [];
  for (const s of sentences) {
    const low = fold(s.text), hit = words.filter(w => low.includes(w)).length;
    if (hit < need) continue;
    if (numeric ? !numbersIn(s.text).length : !levels.some(l => low.includes(l))) continue;
    scored.push({ ...s, score: hit + (unit && low.includes(unit) ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limits.candidates).map(({ page, text: t }) => ({ page, text: t }));
}

/**
 * Reviews the extracted data of a table.
 *   fields       [{ id, label, type, options?, allowed?, unit?, min?, max?, pattern? }]
 *   studies      [{ id, label }]
 *   values       { 'paperId:fieldId': record }
 *   sources      Map(docId -> { pages: Map(page -> text), complete?: bool, hash? })   the text that could be read; a study without an entry is unchecked
 *   ruleCells    Map(cellKey -> [{ rule, message, found?, hint? }])   the project's rules over the whole table (cell-rules.mjs checkTable().cells)
 *   disagreements [{ key, reasons: [text] }]   the extraction disagreements (research-copilot adjudicationQueue)
 * Returns { findings, counts, checked, unchecked, limits }; a finding is
 *   { kind, cell, paperId, fieldId, label, study, text, value?, quote?, page?, doc?, ask? }
 * where `ask` (only on a quote that fails, an outlier, an empty cell with candidate sentences) is what a model may be shown.
 */
export function reviewTable({ fields, studies, values = {}, sources = new Map(), ruleCells = new Map(), disagreements = [], limits = REVIEW_LIMITS }) {
  const cells = cellsOf({ fields, studies, values }), label = new Map(studies.map(s => [s.id, s.label])), findings = [];
  const add = (c, kind, why, extra = {}) => findings.push({ kind, cell: c.key, paperId: c.paperId, fieldId: c.fieldId, label: c.field.label || c.field.id, study: label.get(c.paperId) || c.paperId, text: why, value: c.v ? text(c.v) : '', ...extra });
  let checked = 0, unchecked = 0;

  // 1. the quoted source passage against the text, and the declared type, range, unit, levels and pattern
  for (const c of cells) {
    if (!present(c.v)) continue;
    for (const d of declared(c)) add(c, d.kind, d.text);
    for (const e of c.v.evidence || []) {
      if (!(e.kind === 'text' || e.kind === 'abstract') || String(e.quote || '').trim().length < limits.minQuote) continue;
      const doc = e.doc_id || c.paperId, src = sourceOf(sources, doc), cited = e.kind === 'abstract' ? 0 : Number(e.page);
      if (!src?.pages?.size || (e.kind !== 'abstract' && !Number.isFinite(cited))) { unchecked++; continue; }
      checked++;
      const quote = String(e.quote).trim(), page = src.pages.get(cited);
      const statesNumber = isNumeric(c.field) && Number.isFinite(numberOf(c.v)) && !numberInQuote(String(numberOf(c.v)), quote);
      if (page != null && quoteFound(quote, page)) {
        if (statesNumber) add(c, 'number', 'The quoted passage does not contain the number', { quote, page: cited, doc, ask: { kind: 'verify', passage: windowOf(page, { value: text(c.v), quote }, limits.passageChars), page: cited } });
        break;   // one quote that holds is enough for the cell
      }
      const elsewhere = pageOfQuote(src.pages, quote, page == null ? null : cited);
      if (elsewhere != null) { add(c, 'quote-page', `The quote is on ${elsewhere === 0 ? 'the abstract' : `page ${elsewhere}`}, not ${cited === 0 ? 'the abstract' : `page ${cited}`}`, { quote, page: elsewhere, doc }); break; }
      const shown = page != null ? cited : [...src.pages.keys()][0];
      add(c, 'quote', src.complete === false ? 'The quote is not in the pages read' : 'The quote is not in the extracted text', { quote, page: cited, doc,
        ask: { kind: 'verify', passage: windowOf(src.pages.get(shown) || '', { value: text(c.v), quote }, limits.passageChars), page: shown } });
      break;
    }
  }

  // 2. the project's own rules, over the whole table (the field-stated ones are the declared checks above)
  const byKey = new Map(cells.map(c => [c.key, c]));
  for (const [key, list] of ruleCells) {
    const c = byKey.get(key); if (!c) continue;
    for (const f of list) if (!f.rule?.field) add(c, 'rule', [f.message, f.found && f.found !== f.message ? f.found : ''].filter(Boolean).join(': '));
  }

  // 3. repeated across studies, from the data itself
  const numericIn = new Map();   // paperId -> Map(fieldId -> { n, c })
  for (const c of cells) if (isNumeric(c.field) && present(c.v) && Number.isFinite(numberOf(c.v)) && !c.arm) {
    if (!numericIn.has(c.paperId)) numericIn.set(c.paperId, new Map());
    numericIn.get(c.paperId).set(c.fieldId, { n: numberOf(c.v), c });
  }
  const tuples = new Map();
  for (const [paperId, m] of numericIn) {
    if (m.size < limits.minTuple) continue;
    const sig = [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, x]) => `${id}=${x.n}`).join('|');
    (tuples.get(sig) || tuples.set(sig, []).get(sig)).push(paperId);
  }
  for (const [, group] of tuples) {
    if (group.length < 2) continue;
    for (const paperId of group) {
      const first = [...numericIn.get(paperId).values()][0].c, others = group.filter(x => x !== paperId).map(x => label.get(x) || x);
      add(first, 'duplicate', `Same ${numericIn.get(paperId).size} numbers as ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` and ${others.length - 2} more` : ''}`);
    }
  }
  const texts = new Map();   // fieldId + folded text -> [cells]
  for (const c of cells) {
    if (isNumeric(c.field) || !present(c.v) || c.arm) continue;
    const k = valueKey(text(c.v)); if (k.length < limits.minTextChars) continue;
    (texts.get(`${c.fieldId}\n${k}`) || texts.set(`${c.fieldId}\n${k}`, []).get(`${c.fieldId}\n${k}`)).push(c);
  }
  for (const [, group] of texts) {
    const papers = new Set(group.map(c => c.paperId));
    if (papers.size < 2) continue;
    for (const c of group) { const others = [...papers].filter(x => x !== c.paperId).map(x => label.get(x) || x); add(c, 'duplicate', `Same text as ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` and ${others.length - 2} more` : ''}`); }
  }

  // 4. a study-level value of a field with declared levels that an arm of the same study contradicts
  for (const c of cells) {
    if (!c.arm || !present(c.v) || !levelsOf(c.field).length) continue;
    const base = byKey.get(`${c.paperId}:${c.field.id}`);
    if (base && present(base.v) && valueKey(text(base.v)) !== valueKey(text(c.v))) add(c, 'conflict', `${c.arm} says ${text(c.v)}, the study-level cell says ${text(base.v)}`);
  }

  // 5. extraction disagreements, as the grid lists them
  for (const d of disagreements) {
    const c = byKey.get(d.key); if (!c) continue;
    add(c, 'disagree', (d.reasons || []).join('; '));
  }

  // 6. numbers far from the other studies' (the field's own quartiles)
  const perField = new Map();
  for (const c of cells) if (isNumeric(c.field) && present(c.v) && Number.isFinite(numberOf(c.v)) && !c.arm) (perField.get(c.fieldId) || perField.set(c.fieldId, []).get(c.fieldId)).push(c);
  for (const list of perField.values()) {
    if (list.length < limits.minOutlierN) continue;
    const sorted = list.map(c => numberOf(c.v)).sort((a, b) => a - b), q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
    if (!(iqr > 0)) continue;
    const lo = q1 - limits.fence * iqr, hi = q3 + limits.fence * iqr;
    for (const c of list) {
      const n = numberOf(c.v); if (n >= lo && n <= hi) continue;
      const a = anchorOf(c.v), doc = a?.doc || c.paperId, pages = sourceOf(sources, doc)?.pages;
      const page = a && pages?.get(a.page);
      add(c, 'outlier', `${n} lies outside ${lo.toPrecision(4) * 1} to ${hi.toPrecision(4) * 1}, the usual spread of the ${list.length} studies (quartiles ${q1.toPrecision(4) * 1} and ${q3.toPrecision(4) * 1})`,
        { ...(a ? { quote: a.quote, page: a.page, doc } : {}), ...(page ? { ask: { kind: 'explain', passage: windowOf(page, { value: text(c.v), quote: a.quote }, limits.passageChars), page: a.page } } : {}) });
    }
  }

  // 7. an empty or not-reported cell whose paper has a sentence that points at the field
  const sentenceCache = new Map(), held = new Set(cells.filter(c => present(c.v)).map(c => `${c.paperId}:${c.field.id}`));
  for (const p of studies) {
    const src = sourceOf(sources, p.id); if (!src?.pages?.size) continue;
    for (const f of fields) {
      if (held.has(`${p.id}:${f.id}`) || f.id.includes('@')) continue;
      if (!sentenceCache.has(p.id)) sentenceCache.set(p.id, sentencesOf(src.pages, limits.sentenceChars));
      const cand = candidatesFor(f, sentenceCache.get(p.id), limits); if (!cand.length) continue;
      const key = `${p.id}:${f.id}`, v = values[key];
      findings.push({ kind: 'missing', cell: key, paperId: p.id, fieldId: f.id, label: f.label || f.id, study: p.label, value: '', text: v?.availability === 'not_found' ? 'Marked not reported, but the text may state it' : 'Empty, but the text may state it',
        quote: cand[0].text, page: cand[0].page, doc: p.id, ask: { kind: 'find', candidates: cand } });
    }
  }

  const counts = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return { findings, counts, checked, unchecked, limits };
}

/** The items a model may be asked about, in table order: the findings that carry `ask`. */
export const residualOf = result => result.findings.filter(f => f.ask);

/** The counts in words for the run notice, in reading order: "Quote not found on its page: 38 · Far from the other studies: 4"; the kinds are the interface's, the numbers the project's. */
export function countsText(counts, kinds = REVIEW_KINDS) {
  return Object.keys(kinds).filter(k => counts[k] > 0).map(k => `${kinds[k]}: ${counts[k]}`).join(' · ');
}

// AI normalisation of the extraction data summary (design note 2026-10-13 §4, stage 3).
//
// Counting is exact and local first (lib/extraction-summary.mjs). What no rule can count is the residual: the parts of a multi-valued
// field and the free texts. This module asks a model about each distinct residual value ONCE per field, in batches, and turns the answer
// into a grouping (categories) the person approves. Nothing it returns changes a cell: the grouping only decides how texts are counted.
//
// Pure apart from the `ask` function the caller injects (lib/ai.mjs `complete` in the app, a scripted model in the tests). It names no
// field, device, vocabulary, category or topic: the prompt takes the field's own label, type, allowed values and instructions from the
// schema (lib/prompts-views.mjs `extractionNormalise`) and the categories come out of the items.
//
// Every token figure here is an ESTIMATE by the rule of lib/assist.mjs (characters / 4 plus 120 per call; a reply is assumed to take 24
// tokens per item). It is not a measurement of any model. What a run really used is read from the provider's usage and recorded beside
// the estimate (`used`), and a run that cannot read it says so (`reported: false`).
import { summarise, toNormalise, valueKey } from './extraction-summary.mjs';
import { messagesOf, extractionNormalise } from './prompts-views.mjs';
import { promptRef } from './prompts.mjs';
import { withContext } from './context.mjs';
import { budgetProblem } from './chat-budget.mjs';
import { num } from './dates.mjs';

export const SCHEMA = 1;
/** The default budget of one run, the owner's decision (note §11 Q3): 20 calls and 60,000 tokens. */
export const RUN_BUDGET_DEFAULT = Object.freeze({ calls: 20, tokens: 60000 });
export const BATCH_ITEMS = 150;        // items in one call at most (a model's output room)
export const ITEM_CHARS = 400;         // a longer value is sent clipped to this
export const REPLY_PER_ITEM = 24;      // tokens a reply is assumed to take per item
export const CALL_OVERHEAD = 120;      // the fixed overhead per call of lib/assist.mjs estimateTokens
export const CATEGORY_LABEL_MAX = 80;
export const STATUS_MAX = 60;
export const EXISTING_MAX = 40;        // categories already held that a prompt lists
/** The owner's rule (note §11 Q4): a cheaper model is suggested only after this many approved mappings and an eval run at or above this score. */
export const SUGGEST_MIN_ITEMS = 30;
export const SUGGEST_MIN_SCORE = 0.95;

/** The tokens of a text by the app's one rule (lib/assist.mjs estimateTokens): an estimate. */
export const tokensOfChars = chars => Math.ceil(chars / 4) + CALL_OVERHEAD;

// ---- the run budget ---------------------------------------------------------------------------------------------------------------------

/** The budget a run takes: the project's setting (Settings > AI > Models, `summaryBudget`), else the built-in default. */
export const runBudgetOf = cfg => ({ calls: Number(cfg?.summaryBudget?.calls) || RUN_BUDGET_DEFAULT.calls, tokens: Number(cfg?.summaryBudget?.tokens) || RUN_BUDGET_DEFAULT.tokens });
/** What is wrong with a budget ('' when it is within the bounds the chat's budget shares), worded for a run. */
export const runBudgetProblem = b => budgetProblem(b).replace('Calls per turn', 'Calls per run');

/** Whether an estimate fits a budget: { ok, problems: [text] }, each problem saying by how much. */
export function checkBudget(totals, budget) {
  const problems = [];
  if (totals.calls > budget.calls) problems.push(`${num(totals.calls)} calls estimated, ${num(totals.calls - budget.calls)} over the limit of ${num(budget.calls)}`);
  const tokens = totals.inTokens + totals.outTokens;
  if (tokens > budget.tokens) problems.push(`${num(tokens)} tokens estimated, ${num(tokens - budget.tokens)} over the limit of ${num(budget.tokens)}`);
  return { ok: !problems.length, problems };
}

// ---- the field's definition, hashes and the cache key -----------------------------------------------------------------------------------

const clean = v => String(v ?? '').trim();
/** What the model is told about a field, from the schema alone: label, type, unit, allowed values, definition and instructions. */
export function fieldDescription(c = {}) {
  const allowed = (c.options?.length ? c.options : c.allowed?.length ? c.allowed : []).map(String);
  return { label: clean(c.label || c.id), type: clean(c.type || 'text'), unit: clean(c.unit), allowed,
    definition: clean(c.definition || c.guide || c.guidance), instructions: clean(c.instructions) };
}
export const definitionText = c => JSON.stringify(fieldDescription(c));

/** SHA-256 as hex, through WebCrypto (the browser and Node 20+). Not `hashText` of lib/prompts.mjs: that is 32 bits, and a collision would return another value's answer. */
export async function sha256Hex(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const short = async text => (await sha256Hex(text)).slice(0, 24);
/** The hash of a field's definition: a mapping approved under another one is stale. */
export const definitionHash = c => short(definitionText(c));
/** The cache key of one answer: SHA-256 of the canonical JSON of (prompt, field definition, value, model, schema), 24 hex characters. */
export const cacheKey = ({ prompt, def, value, model }) => short(JSON.stringify({ prompt, def, value, model, schema: SCHEMA }));

/** The fields whose approved grouping was made under another definition than the field has now. */
export async function staleFields(fields, mappings = {}) {
  const out = new Set();
  for (const f of fields || []) {
    const m = mappings[f.id];
    if (m?.definitionHash && (Object.keys(m.cells || {}).length || Object.keys(m.categories || {}).length) && m.definitionHash !== await definitionHash(f)) out.add(f.id);
  }
  return out;
}

// ---- what is asked ------------------------------------------------------------------------------------------------------------------------

const clip = t => (t.length > ITEM_CHARS ? `${t.slice(0, ITEM_CHARS - 1)}…` : t);
const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const catId = label => valueKey(label);

/** The messages one call sends, after the app's guard is added (lib/ai.mjs complete adds it the same way), so the estimate counts what goes out. */
export function callMessages(field, existing, items, markers) {
  return withContext(messagesOf(extractionNormalise, { field: fieldDescription(field), existing, items: items.map(i => clip(i.text)), markers: markers.map(m => m.text) }),
    undefined, {}, { guard: extractionNormalise.guard, withBrief: false });
}
export const charsOf = messages => messages.reduce((n, m) => n + String(m.content || '').length, 0);

/**
 * The plan of a run, computed without a model call. Per field (a multi-valued or free-text one with something to ask): the items and markers
 * to send, those the cache already answers, the calls, and the estimated input and output tokens. A field whose mapping is stale is asked
 * again in full (its definition changed, so its cache keys miss); a field already grouped is asked only about what is not.
 *   input: { fields, studies, values, proposals, mappings, cache, model, fieldIds? }
 */
export async function planRun({ fields, studies, values = {}, proposals = {}, mappings = {}, cache = {}, model = '', fieldIds = null }) {
  const stale = await staleFields(fields, mappings);
  // a stale field is read as if its grouping were not there (its states and marker meanings are the person's facts and stay)
  const effective = Object.fromEntries(Object.entries(mappings).map(([id, m]) => [id, stale.has(id) ? { ...m, cells: {}, categories: {} } : m]));
  const input = { fields, studies, values, proposals };
  const read = summarise({ ...input, mappings: effective });
  const byId = new Map(fields.map(f => [f.id, f]));
  const prompt = promptRef(extractionNormalise), out = [];
  for (const fs of read.fields) {
    if (fieldIds && !fieldIds.includes(fs.id)) continue;
    const f = byId.get(fs.id), m = effective[fs.id] || null;
    const ask = toNormalise(fs);
    if (!ask.items.length && !ask.markers.length) continue;
    // a marker already given its meaning shows up again under that meaning: it is not asked twice
    const meant = new Set([...Object.keys(m?.markers || {}), ...Object.values(m?.markers || {}).map(valueKey)]);
    const markerList = ask.markers.filter(x => !meant.has(x.key));
    const def = definitionText(f), defHash = await definitionHash(f);
    const keyed = async (list, tag) => Promise.all(list.map(async x => ({ ...x, cacheKey: await cacheKey({ prompt, def, value: `${tag}:${x.key}`, model }) })));
    const items = await keyed(ask.items, 'i'), markers = await keyed(markerList, 'm');
    const hit = x => cache[x.cacheKey] !== undefined;
    const sendItems = items.filter(x => !hit(x)), sendMarkers = markers.filter(x => !hit(x));
    const cachedItems = items.filter(hit), cachedMarkers = markers.filter(hit);
    // categories the field already holds, and those the cached answers use, are offered to the model so that it reuses their labels
    const existing = [...new Set([...Object.values(m?.categories || {}).map(c => c.label), ...[...cachedItems].flatMap(x => cache[x.cacheKey].out?.cats || [])])].slice(0, EXISTING_MAX);
    const batches = chunk(sendItems, BATCH_ITEMS);
    if (!batches.length && sendMarkers.length) batches.push([]);
    let inTokens = 0, outTokens = 0;
    const calls = batches.map((b, k) => {
      const mk = k === 0 ? sendMarkers : [];
      const estIn = tokensOfChars(charsOf(callMessages(f, existing, b, mk))), estOut = (b.length + mk.length) * REPLY_PER_ITEM;
      inTokens += estIn; outTokens += estOut;
      return { items: b, markers: mk, inTokens: estIn, outTokens: estOut };
    });
    out.push({ id: fs.id, label: fs.label, kind: fs.kind, stale: stale.has(fs.id), existing, def, defHash, items, markers, sendItems, sendMarkers, cachedItems, cachedMarkers,
      calls, inTokens, outTokens, askedItems: sendItems.length + sendMarkers.length, cachedCount: cachedItems.length + cachedMarkers.length });
  }
  const totals = out.reduce((t, f) => ({ fields: t.fields + 1, calls: t.calls + f.calls.length, inTokens: t.inTokens + f.inTokens, outTokens: t.outTokens + f.outTokens,
    asked: t.asked + f.askedItems, cached: t.cached + f.cachedCount }), { fields: 0, calls: 0, inTokens: 0, outTokens: 0, asked: 0, cached: 0 });
  const recount = (fieldId, mapping) => summarise({ ...input, fields: fields.filter(f => f.id === fieldId), mappings: { [fieldId]: mapping } }).fields[0];
  return { prompt, model, stale, effective, cache, fields: out, totals, recount, studyCount: read.studyCount, field: id => byId.get(id) };
}

// ---- reading the reply -------------------------------------------------------------------------------------------------------------------

/** The first JSON object in a reply, tolerating a fence and prose around it; null when there is none. */
export function parseReply(text) {
  const body = (/```(?:json)?\s*([\s\S]*?)```/.exec(String(text)) || [, String(text)])[1];
  const tries = [body.trim()];
  const a = body.indexOf('{'), z = body.lastIndexOf('}');
  if (a >= 0 && z > a) tries.push(body.slice(a, z + 1));
  for (const t of tries) { try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* the next try */ } }
  return null;
}

/**
 * Checks a reply against what was asked and keeps only what holds. A reply whose shape is wrong (not an object, no `items` list) is invalid
 * as a whole (`ok: false`, so the caller may retry once). Otherwise: an item or marker number that was not asked is dropped, so is an item
 * given twice, a category id that was not declared, an empty or over-long label, and a category no item uses. What stays:
 *   { ok, items: Map(i -> { cats: [label], status }), markers: Map(i -> meaning), dropped }
 * An item the reply leaves out is not an error: its meaning was unclear, and it stays uncounted.
 */
export function validateReply(reply, { items, markers }) {
  if (!reply || typeof reply !== 'object' || !Array.isArray(reply.items)) return { ok: false, items: new Map(), markers: new Map(), dropped: 0 };
  let dropped = 0;
  const labels = new Map();
  for (const c of Array.isArray(reply.categories) ? reply.categories : []) {
    const id = clean(c?.id), label = clean(c?.label).replace(/\s+/g, ' ');
    if (!id || !label || label.length > CATEGORY_LABEL_MAX || labels.has(id)) { dropped++; continue; }
    labels.set(id, label);
  }
  const got = new Map();
  for (const x of reply.items) {
    const i = x?.i;
    if (!Number.isInteger(i) || i < 0 || i >= items || got.has(i)) { dropped++; continue; }
    const cats = [...new Set((Array.isArray(x.categories) ? x.categories : []).map(id => labels.get(clean(id))).filter(Boolean))].slice(0, 6);
    if (!cats.length) { dropped++; continue; }
    const status = clean(x.status).replace(/\s+/g, ' ');
    got.set(i, { cats, ...(status && status.length <= STATUS_MAX ? { status } : {}) });
  }
  const meanings = new Map();
  for (const x of Array.isArray(reply.markers) ? reply.markers : []) {
    const i = x?.i, meaning = clean(x?.meaning).replace(/\s+/g, ' ');
    if (!Number.isInteger(i) || i < 0 || i >= markers || meanings.has(i) || !meaning || meaning.length > STATUS_MAX) { dropped++; continue; }
    meanings.set(i, meaning);
  }
  return { ok: true, items: got, markers: meanings, dropped };
}

// ---- running ------------------------------------------------------------------------------------------------------------------------------

const bytesOf = v => { try { return JSON.stringify(v).length; } catch { return 0; } };

/**
 * Turns the answers (fresh and cached) of one field into the additions to its grouping: categories (id = the folded label, so the same
 * label from two runs is one category), the cells (item key -> categories and status) and the markers' meanings. Entries the grouping
 * already holds are left out. Pure.
 */
export function additionsFrom(answers, markerAnswers, held = null) {
  const categories = {}, cells = {}, markers = {};
  for (const [key, a] of answers) {
    if (!a.cats?.length || held?.cells?.[key]) continue;
    cells[key] = a.cats.map(label => {
      const id = catId(label);
      if (!held?.categories?.[id]) categories[id] = { label, from: 'model' };
      return { category: id, ...(a.status ? { status: a.status } : {}) };
    });
  }
  for (const [key, meaning] of markerAnswers) if (meaning && !held?.markers?.[key]) markers[key] = meaning;
  return { categories, cells, markers };
}

/**
 * Checks that a grouping only counts: the field keeps the same studies with a value, and every cell of a grouped item sits in the studies of
 * the category it was given. `before` and `after` are the field summaries without and with the additions. Returns '' or the reason it failed.
 */
export function reconcile(before, after, grouped) {
  for (const k of ['present', 'missing', 'not_reported']) if (before.states[k].n !== after.states[k].n) return `the studies with a value changed (${k})`;
  const owner = cell => cell.slice(0, cell.indexOf(':'));
  const levels = new Map(after.levels.map(l => [l.key, new Set(l.studies.map(s => s.paperId))]));
  for (const g of grouped) for (const id of g.categories) {
    const held = levels.get(`c:${id}`);
    if (!held) return 'a category has no studies';
    for (const cell of g.cells) if (!held.has(owner(cell))) return 'a grouped value is missing from its category';
  }
  return '';
}

/**
 * The run budget of one run, shared by every run on the Data summary (Normalise, Review data): what has been used, whether the next call fits,
 * what stopped the run, and the accounting of a reply (the provider's usage when it reports one, else the call's estimate, said so in `reported`).
 */
export function budgetTracker(budget) {
  const used = { calls: 0, inTokens: 0, outTokens: 0, reported: true };
  return { used,
    room: est => used.calls + 1 <= budget.calls && used.inTokens + used.outTokens + est <= budget.tokens,
    limit: () => (used.calls >= budget.calls ? 'the call limit' : 'the token limit'),
    spend(reply, call) {
      used.calls++;
      if (reply.usage && reply.usage.prompt != null && reply.usage.completion != null) { used.inTokens += reply.usage.prompt; used.outTokens += reply.usage.completion; }
      else { used.reported = false; used.inTokens += call.inTokens; used.outTokens += call.outTokens; }
    } };
}

/**
 * Runs a plan. `ask(messages, { maxTokens, signal })` returns { text, usage } (usage: { prompt, completion } or null when the provider does
 * not report it). Per field, in order: the items the cache answers cost nothing; the rest go in batches, one call each, checked locally; a
 * reply of the wrong shape is asked once more. Before every call the budget is checked: a call that would take the run past its calls or its
 * tokens is not sent, and neither are the fields after it (they are listed in `skipped`). Cancelling through `signal` throws AbortError.
 *   returns { fields: [{ id, label, add, grouped, asked, cached, dropped, calls, note }], puts, touched, used, skipped, stopped }
 */
export async function runPlan({ plan, ask, budget, signal, progress = () => {}, now = () => new Date().toISOString(), model = '' }) {
  const { used, room, limit, spend } = budgetTracker(budget);
  const puts = {}, touched = [], results = [], skipped = [];
  let stopped = '';
  for (const [n, f] of plan.fields.entries()) {
    if (stopped) { skipped.push(f.id); continue; }
    if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
    progress(`${f.label}: field ${n + 1} of ${plan.fields.length}`);
    const answers = new Map(), markerAnswers = new Map();
    let dropped = 0, calls = 0, failed = '';
    for (const x of f.cachedItems) { const hit = plan.cache[x.cacheKey]; touched.push(x.cacheKey); if (hit.out?.cats?.length) answers.set(x.key, hit.out); }
    for (const x of f.cachedMarkers) { const hit = plan.cache[x.cacheKey]; touched.push(x.cacheKey); if (hit.out?.meaning) markerAnswers.set(x.key, hit.out.meaning); }
    for (const call of f.calls) {
      if (stopped) break;
      let again = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!room(call.inTokens + call.outTokens)) { stopped = limit(); break; }
        if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
        const messages = callMessages(plan.field(f.id), f.existing, call.items, call.markers);
        const reply = await ask(messages, { maxTokens: Math.min(8000, 400 + REPLY_PER_ITEM * 2 * (call.items.length + call.markers.length)), signal });
        spend(reply, call); calls++;
        const checked = validateReply(parseReply(reply.text), { items: call.items.length, markers: call.markers.length });
        if (!checked.ok) { if (attempt === 0) { again = true; continue; } failed = 'the reply was not in the expected form'; break; }
        dropped += checked.dropped;
        const at = now();
        call.items.forEach((x, i) => {
          const a = checked.items.get(i);
          // an item the reply left out was unclear: it is remembered as asked, so it is not asked again
          puts[x.cacheKey] = { out: a ? { cats: a.cats, ...(a.status ? { status: a.status } : {}) } : { cats: [] }, at, bytes: 0 };
          if (a) answers.set(x.key, a);
        });
        call.markers.forEach((x, i) => {
          const meaning = checked.markers.get(i);
          puts[x.cacheKey] = { out: meaning ? { meaning } : {}, at, bytes: 0 };
          if (meaning) markerAnswers.set(x.key, meaning);
        });
        again = false; break;
      }
      if (again && !failed && !stopped) failed = 'the reply was not in the expected form';
    }
    if (stopped && calls < f.calls.length) skipped.push(f.id);   // asked in part: the rest of its values wait for another run
    for (const e of Object.values(puts)) e.bytes ||= bytesOf(e.out);
    // the grouping, checked against the counts before it is offered
    const held = plan.effective[f.id] || null;
    const add = additionsFrom(answers, markerAnswers, held);
    const groupedItems = [...answers].filter(([key]) => add.cells[key]).map(([key]) => ({ categories: add.cells[key].map(c => c.category), cells: (f.items.find(x => x.key === key) || f.items[0]).cells }));
    let note = failed;
    if (!note && (Object.keys(add.cells).length || Object.keys(add.markers).length)) {
      const merged = { ...(held || {}), categories: { ...(held?.categories || {}), ...add.categories }, cells: { ...(held?.cells || {}), ...add.cells }, markers: { ...(held?.markers || {}), ...add.markers } };
      const problem = reconcile(plan.recount(f.id, held || {}), plan.recount(f.id, merged), groupedItems);
      if (problem) { note = `not offered: ${problem}`; add.categories = {}; add.cells = {}; add.markers = {}; }
    }
    results.push({ id: f.id, label: f.label, add, stale: f.stale, asked: f.askedItems, cached: f.cachedCount, dropped, calls, note,
      grouped: Object.keys(add.cells).length, categories: Object.keys(add.categories).length });
  }
  return { fields: results, puts, touched, used, skipped, stopped };
}

/** The additions a field's run produced are worth offering when they group something or give a marker a meaning. */
export const offers = r => Object.keys(r.add.cells).length > 0 || Object.keys(r.add.markers).length > 0;

// ---- when a cheaper model may be suggested ---------------------------------------------------------------------------------------------------

/** The approved groupings: how many texts a person has approved a model's grouping for (the gold of the eval task, bench/ai/eval). */
export function approvedItems(mappings = {}) {
  let n = 0;
  for (const m of Object.values(mappings)) if (Object.values(m.categories || {}).some(c => c.from === 'model') || m.model) n += Object.keys(m.cells || {}).length;
  return n;
}
/**
 * The owner's rule (note §11 Q4): a cheaper model is suggested only after at least SUGGEST_MIN_ITEMS approved items exist and a recorded eval
 * run of that model on them reaches SUGGEST_MIN_SCORE. `evals` are run records { kind: 'eval', model, items, score, at }. Returns the best
 * such record that is not the model in use, else null. No saving is stated: only what the run scored.
 */
export function cheaperModelSuggestion({ mappings, evals = [], current = '' }) {
  if (approvedItems(mappings) < SUGGEST_MIN_ITEMS) return null;
  const ok = evals.filter(e => e?.kind === 'eval' && e.model && e.model !== current && e.items >= SUGGEST_MIN_ITEMS && e.score >= SUGGEST_MIN_SCORE);
  return ok.sort((a, b) => b.score - a.score || String(b.at).localeCompare(String(a.at)))[0] || null;
}

// The model step of Review data (design note 2026-10-13 §5, stage 4, layer 2): only what the local review could not settle, asked of the text
// of one study at a time, with a run budget, a SHA-256 answer cache and every quote searched for in the study's own text.
//
// Pure apart from the `ask` function the caller injects (lib/ai.mjs `complete` in the app, a scripted model in the tests). It names no field,
// topic or category: the prompt (lib/prompts-views.mjs `extractionReview`) takes each field's own description, and the items come from
// lib/extraction-review.mjs. What it shares with Normalise is imported, not copied: the estimate rule, the budget, the cache key and the reply
// reader (lib/extraction-normalise.mjs).
//
// Every token figure here is an ESTIMATE by the rule of lib/assist.mjs (characters / 4 plus 120 per call; a reply is assumed to take
// REVIEW_REPLY_PER_ITEM tokens per item). It is not a measurement of any model; what a run really used is read from the provider's usage.
import { definitionText, cacheKey, charsOf, tokensOfChars, parseReply, budgetTracker, ITEM_CHARS, fieldDescription } from './extraction-normalise.mjs';
import { messagesOf, extractionReview } from './prompts-views.mjs';
import { promptRef } from './prompts.mjs';
import { withContext } from './context.mjs';
import { quoteFound, fold } from './quotes.mjs';
import { numberInQuote } from './numbers.mjs';
import { sourceOf } from './extraction-review.mjs';

export const SAMPLE_DEFAULT = 10;           // studies asked in a first run (the owner's decision, note §11 Q5)
export const ITEMS_PER_CALL = 12;           // items of one study in one call at most
export const REVIEW_REPLY_PER_ITEM = 60;    // tokens a reply is assumed to take per item (an estimate)
export const NOTE_MAX = 160;
const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const numeric = f => f && (f.type === 'number' || f.type === 'integer');
const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const levelsOf = f => (f?.options?.length ? f.options : f?.allowed?.length ? f.allowed : []).map(String);

/** What goes into a call: the study's items with their material, and the description of each field once. */
export function callMessages(study, fieldList, items) {
  const fields = [...new Set(items.map(i => i.finding.fieldId))].map(id => ({ id, ...fieldDescription(fieldList.get(id) || {}) }));
  return withContext(messagesOf(extractionReview, { study: study.label, fields, items: items.map(i => ({ field: i.finding.fieldId, kind: i.finding.ask.kind, value: clip(i.finding.value, ITEM_CHARS), quote: clip(i.finding.quote || '', ITEM_CHARS),
    page: i.finding.ask.page, passage: i.finding.ask.passage || '', candidates: i.finding.ask.candidates || [] })) }),
  undefined, {}, { guard: extractionReview.guard, withBrief: false });
}

/** A sample of the studies: the first `n` in table order that have something to ask (n = 0 or Infinity: all of them). */
const sampleOf = (studies, n) => (n > 0 && Number.isFinite(n) ? studies.slice(0, n) : studies);

/**
 * The plan of the model step, computed without a model call.
 *   residual   the findings that carry `ask` (lib/extraction-review.mjs residualOf), in table order
 *   fields     the table's columns; studies the table's studies (order and labels)
 *   cache      extractionSummary.cache
 * Returns { prompt, model, studies, forSample(n) } where forSample(n) -> { studies, calls, totals } for the first n studies that have items.
 * A call holds at most ITEMS_PER_CALL items of one study; items the cache answers are not sent.
 */
export async function planReview({ residual, fields, studies, cache = {}, model = '' }) {
  const prompt = promptRef(extractionReview), fieldList = new Map(fields.map(f => [f.id, f]));
  const byStudy = new Map();
  for (const f of residual) (byStudy.get(f.paperId) || byStudy.set(f.paperId, []).get(f.paperId)).push(f);
  const order = studies.filter(s => byStudy.has(s.id));
  const keyed = [];
  for (const s of order) {
    const items = [];
    for (const finding of byStudy.get(s.id)) {
      const field = fieldList.get(finding.fieldId) || fieldList.get(finding.fieldId.replace(/@arm\d+$/, ''));
      const key = await cacheKey({ prompt, def: definitionText(field || {}), model,
        value: JSON.stringify([finding.ask.kind, finding.value, finding.quote || '', finding.ask.page ?? '', finding.ask.passage || '', finding.ask.candidates || []]) });
      items.push({ finding, key, cached: cache[key] !== undefined });
    }
    keyed.push({ paperId: s.id, label: s.label, items });
  }
  // a field of an arm is described by its column
  const describe = new Map(fieldList); for (const f of residual) if (!describe.has(f.fieldId)) describe.set(f.fieldId, fieldList.get(f.fieldId.replace(/@arm\d+$/, '')));
  function forSample(n) {
    const chosen = sampleOf(keyed, n), calls = [];
    let cached = 0, items = 0;
    for (const s of chosen) {
      items += s.items.length; cached += s.items.filter(i => i.cached).length;
      for (const part of chunk(s.items.filter(i => !i.cached), ITEMS_PER_CALL)) {
        const inTokens = tokensOfChars(charsOf(callMessages(s, describe, part))), outTokens = part.length * REVIEW_REPLY_PER_ITEM;
        calls.push({ paperId: s.paperId, label: s.label, items: part, inTokens, outTokens });
      }
    }
    const totals = calls.reduce((t, c) => ({ ...t, calls: t.calls + 1, inTokens: t.inTokens + c.inTokens, outTokens: t.outTokens + c.outTokens, asked: t.asked + c.items.length }), { studies: chosen.length, items, cached, calls: 0, inTokens: 0, outTokens: 0, asked: 0 });
    return { studies: chosen, calls, totals };
  }
  return { prompt, model, studies: keyed, studyCount: keyed.length, itemCount: keyed.reduce((n, s) => n + s.items.length, 0), describe, forSample };
}

// ---- reading the reply --------------------------------------------------------------------------------------------------------------------

const STATUSES = { verify: ['supported', 'contradicted'], explain: ['supported', 'contradicted'], find: ['stated'] };

/** Whether a quote states the number a value stores, as a number and not as characters inside a longer one. */
function statesNumber(value, quote) {
  const n = Number(String(value).replace(/−/g, '-').replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(n) && numberInQuote(String(n), quote);
}

/**
 * Checks one claim of a reply against what was asked and the study's own text. Returns the outcome to keep, or null when it is dropped:
 *   { s: 'supported' | 'contradicted' | 'stated', value?, page?, quote?, note? }
 * A status the task does not allow, a page the study has no text for, a quote that is not on that page (lib/quotes.mjs, the rule `check-values`
 * uses), a number the quote does not state, a value that is not a declared level: dropped. A 'supported' note survives only with a verified quote.
 */
export function checkClaim(c, item, field, src) {
  const ask = item.finding.ask, s = String(c?.status || '');
  if (!(STATUSES[ask.kind] || []).includes(s)) return null;
  const page = parseInt(c.page, 10), quote = String(c.quote || '').trim(), pages = src?.pages;
  const onPage = Number.isFinite(page) && pages?.has(page) && quote && quoteFound(quote, pages.get(page));
  const note = clip(String(c.note || '').replace(/\s+/g, ' ').trim(), NOTE_MAX);
  if (s === 'supported') return { s, ...(note && onPage ? { note, page, quote: clip(quote, 400) } : {}) };
  if (!onPage) return null;
  if (s === 'contradicted') return { s, page, quote: clip(quote, 400), ...(note ? { note } : {}) };
  const value = String(c.value ?? '').trim();
  if (!value) return null;
  if (numeric(field) && !statesNumber(value, quote)) return null;
  const levels = levelsOf(field);
  if (levels.length && !levels.some(l => fold(l) === fold(value))) return null;
  return { s, value: clip(value, 300), page, quote: clip(quote, 400) };
}

// ---- running ------------------------------------------------------------------------------------------------------------------------------

/**
 * Runs the sampled plan. `ask(messages, { maxTokens, signal })` returns { text, usage }. Cached items cost nothing. Before every call the budget is
 * checked: a call that would pass it is not sent, nor are the studies after it (`skipped`). A reply of the wrong shape is asked once more.
 *   returns { results: [{ finding, outcome }], puts, touched, used, skipped, stopped, dropped, unclear, calls }
 * An outcome is { s: 'supported'|'contradicted'|'stated'|'none', ... }: 'none' is an item the reply left out or whose claim failed its check.
 */
export async function runReview({ sample, plan, ask, budget, sources, cache = {}, signal, progress = () => {}, now = () => new Date().toISOString() }) {
  const { used, room, limit, spend } = budgetTracker(budget);
  const results = [], puts = {}, touched = [], skipped = [];
  let stopped = '', dropped = 0, unclear = 0, calls = 0;
  const order = sample.studies;
  for (const [n, s] of order.entries()) {
    if (stopped) { skipped.push(s.paperId); continue; }
    if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
    progress(`${s.label}: study ${n + 1} of ${order.length}`);
    for (const i of s.items.filter(x => x.cached)) { touched.push(i.key); results.push({ finding: i.finding, outcome: cache[i.key].out }); }
    const mine = sample.calls.filter(c => c.paperId === s.paperId);
    let done = 0;
    for (const call of mine) {
      if (stopped) break;
      let reply = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!room(call.inTokens + call.outTokens)) { stopped = limit(); break; }
        if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
        const messages = callMessages(s, plan.describe, call.items);
        const got = await ask(messages, { maxTokens: Math.min(6000, 300 + 2 * REVIEW_REPLY_PER_ITEM * call.items.length), signal });
        spend(got, call); calls++;
        const parsed = parseReply(got.text);
        if (parsed && Array.isArray(parsed.checks)) { reply = parsed; break; }
      }
      if (!reply) { if (!stopped) { unclear += call.items.length; done++; } continue; }
      done++;
      const at = now(), claims = new Map();
      for (const c of reply.checks) {
        const item = call.items.find(x => x.finding.fieldId === c?.field);
        if (!item || claims.has(item.key)) { dropped++; continue; }
        const field = plan.describe.get(item.finding.fieldId), out = checkClaim(c, item, field, sourceOf(sources, item.finding.doc || item.finding.paperId));
        if (!out) { dropped++; continue; }
        claims.set(item.key, out);
      }
      for (const item of call.items) {
        const outcome = claims.get(item.key) || { s: 'none' };
        if (outcome.s === 'none') unclear++;
        // an item the reply left out, or whose claim failed its check, is remembered as asked, so it is not asked again
        puts[item.key] = { out: outcome, at, bytes: 0 };
        results.push({ finding: item.finding, outcome });
      }
    }
    if (stopped && done < mine.length) skipped.push(s.paperId);   // asked in part: the rest of its items wait for another run
  }
  for (const e of Object.values(puts)) e.bytes ||= JSON.stringify(e.out).length;
  return { results, puts, touched, used, skipped, stopped, dropped, unclear, calls };
}

// ---- settling -----------------------------------------------------------------------------------------------------------------------------

/**
 * Puts the model's verified answers back on the local findings. `results` is runReview's [{ finding, outcome }]; a finding the model was not
 * asked about (no model, outside the sample, over the budget) stands as the local review left it.
 *   supported   a quote that was in doubt is settled: the finding goes (counted); an outlier stays, with the passage's reason when it gave one
 *   contradicted the finding becomes 'contradicted', anchored on the quote the model gave (found in the text)
 *   stated      an empty cell's finding becomes 'stated', with a value and quote to propose
 *   none        an item the model left out: a quote or outlier finding stands; a candidate sentence nobody confirmed goes (the model looked)
 * Returns { findings, supported, looked }.
 */
export function settleFindings(findings, results = []) {
  const outcomeOf = new Map(results.map(r => [r.finding, r.outcome]));
  const out = []; let supported = 0, looked = 0;
  for (const f of findings) {
    const o = outcomeOf.get(f);
    if (!f.ask || !o) { out.push(f); continue; }
    const { ask, ...rest } = f;
    if (o.s === 'contradicted') out.push({ ...rest, kind: 'contradicted', text: o.note || 'The text states a different value', quote: o.quote, page: o.page, ask: undefined });
    else if (o.s === 'stated') out.push({ ...rest, kind: 'stated', text: `The text states ${o.value}`, quote: o.quote, page: o.page, proposal: { value: o.value, quote: o.quote, page: o.page }, ask: undefined });
    else if (o.s === 'supported') {
      if (f.kind === 'outlier') out.push({ ...rest, ...(o.note ? { text: `${f.text}. The text: ${o.note}`, quote: o.quote, page: o.page } : {}), ask: undefined });
      else supported++;
    } else if (ask.kind === 'find') looked++;
    else out.push({ ...rest, ask: undefined });
  }
  return { findings: out, supported, looked };
}

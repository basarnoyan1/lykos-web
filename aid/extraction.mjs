import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the extraction view (lib/aid.mjs).
//
// Values a model reads are proposals with the words they came from. Accepted,
// they are stored the way the view's "From abstracts" and the reader's
// suggestions store them: extractor "model:<id>", verification "accepted", so
// they count as unverified until a person checks them against the source
// (plan §1.3: no model-generated number enters an analysis unverified).
import { register, jsonOf, quoteIn, pdfPages } from '../lib/aid.mjs';
import { complete, configured } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { get } from '../store.mjs';
import { fields, cellNumber, setAnchoredValue } from '../lib/fields.mjs';
import { numberInQuote } from '../lib/numbers.mjs';
import { studies } from '../lib/screen.mjs';
import { researchType } from '../lib/workflow.mjs';
import { inUse, withAux, fieldLines, checkValues, deriveSD } from '../lib/extraction-check.mjs';
import { planRun, runPlan, offers, RUN_BUDGET_DEFAULT } from '../lib/extraction-normalise.mjs';
import { num } from '../lib/dates.mjs';
import { applyMapping, cachePut, cacheTouch, recordRun, fileReviewRun, setNoteState } from '../lib/extraction-summary-store.mjs';
import { valueHash } from '../lib/extraction-summary-state.mjs';
import { reviewTable, residualOf, REVIEW_KINDS, countsText } from '../lib/extraction-review.mjs';
import { planReview, runReview, settleFindings } from '../lib/extraction-review-model.mjs';
import { adjudicationQueue } from '../lib/research-copilot.mjs';
import { templateById, columnsOf } from '../lib/templates.mjs';
import { splitCellId } from '../lib/arms.mjs';
import * as DF from '../lib/derive-fields.mjs';
import { esc } from '../lib/html.mjs';
import { rulesOf, checkTable } from '../lib/cell-rules.mjs';
import { propose } from '../lib/proposals.mjs';

const MAX_STUDIES = 15;
const PAGE_BATCH = 24000;     // characters of full text per call
// Abstracts read together in one call: the instructions, field list and brief
// are sent once for the batch rather than once per study.
const ABSTRACT_BATCH = 12000; // characters of title and abstract per call
const ABSTRACT_STUDIES = 5;   // studies per call at most
const numeric = f => f && (f.type === 'number' || f.type === 'integer');

const paperOf = (s, f) => (f?.paperId && (f.kind === 'study' || f.kind === 'cell') ? (s.papers || []).find(p => p.id === f.paperId) : null) || null;
const has = (s, p, f) => Boolean(s.values?.[`${p.id}:${f.id}`]);

/**
 * The fields to read for a study: a focused empty cell is the one field asked
 * about; otherwise every field of the study still empty. An analysis input
 * of a measure no outcome pools with is not asked for.
 */
export function wanted(s, p, focus) {
  const FS = fields(s);
  const cell = focus?.kind === 'cell' && focus.paperId === p.id ? FS.find(f => f.id === focus.fieldId) : null;
  if (cell && !has(s, p, cell)) return [cell];
  return FS.filter(f => !has(s, p, f) && inUse(s, f));
}
/** Fields a scoping review charts: its words and categories, not numbers. */
const charted = (s, p) => wanted(s, p, null).filter(f => !f.analysis && (f.type === 'text' || f.type === 'category'));

/** A number the study already holds for a field, for the checks between fields. */
const knownOf = (s, p) => id => { const n = Number(s.values?.[`${p.id}:${id}`]?.normalized_value); return Number.isFinite(n) ? n : undefined; };

/**
 * Quote-checked values through the mechanical checks, with SDs derived where
 * the paper gives an SE or a mean's CI instead. Returns what to show and a
 * short account of what was dropped.
 */
export function settle(s, p, vals, FS) {
  const { kept, dropped } = checkValues(vals, FS, knownOf(s, p));
  const { values, unused } = deriveSD(kept, FS, knownOf(s, p));
  return { values, failed: dropped.map(d => `${FS.find(f => f.id === d.field)?.label || d.field}: ${d.reason}`), unused };
}

/**
 * Whether a quote states the value's number, read as the cell will store it:
 * as a number, not as characters ("45" is not in "145 patients"), and with a
 * comma read in the quote as it is read in the cell ("0,72" is 0.72 in both).
 */
export function statesNumber(value, quote, type) {
  const num = cellNumber(value, type);
  if (!Number.isFinite(num)) return false;
  if (numberInQuote(String(num), quote)) return true;
  return (String(quote).match(/[-\u2212]?\d+(?:,\d+)+(?:\.\d+)?/g) || [])
    .some(t => Math.abs(Math.abs(cellNumber(t, type)) - Math.abs(num)) <= 1e-9 * Math.max(1, Math.abs(num)));
}

/**
 * A value is kept only if its quote is in the source, and a number only if
 * the quote states it: a model may restate a number, never compute one.
 */
export function keepValue(x, FS, source) {
  const f = FS.find(z => z.id === x?.field);
  const value = String(x?.value ?? '').trim();
  const quote = String(x?.quote || '').trim();
  if (!f || !value || !quoteIn(quote, source)) return null;
  if (numeric(f) && !statesNumber(value, quote, f.type)) return null;
  return { field: f.id, value: value.slice(0, 300), quote: quote.slice(0, 400) };
}

/** Full text in batches of pages, each page marked, for one call per batch. */
export function pageBatches(pages, limit = PAGE_BATCH) {
  const out = []; let cur = [], n = 0;
  for (const pg of pages) {
    const text = pg.text.slice(0, limit);
    if (cur.length && n + text.length > limit) { out.push(cur); cur = []; n = 0; }
    cur.push({ page: pg.page, text }); n += text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
export const pagesText = batch => batch.map(pg => `[page ${pg.page}]\n${pg.text}`).join('\n\n');

/**
 * Full-text values kept: the quote must be on the page the model names, so
 * the page stored as the value's source is the page that says it. The first
 * page to state a field wins.
 */
export function keepOnPage(got, FS, pages) {
  const byPage = new Map(pages.map(pg => [pg.page, pg.text]));
  const kept = new Map(); let dropped = 0;
  for (const x of got || []) {
    const page = parseInt(x?.page, 10);
    const v = byPage.has(page) ? keepValue(x, FS, byPage.get(page)) : null;
    if (!v) { dropped++; continue; }
    if (!kept.has(v.field)) kept.set(v.field, { ...v, page });
  }
  return { kept: [...kept.values()], dropped };
}

/** One value as the grid stores a model-read one, its number read as manual entry reads it. */
function valueRecord(p, f, x, cfg, extra) {
  const num = numeric(f) ? cellNumber(x.value, f.type) : NaN;
  return { paper_id: p.id, field_id: f.id, reported_value: x.value,
    normalized_value: Number.isFinite(num) ? (f.type === 'integer' ? Math.round(num) : num) : x.value,
    extractor: `model:${cfg.model}`, quote: x.quote, verification: 'accepted', at: new Date().toISOString(), ...extra };
}

/**
 * What a cell holds, as a token to compare: '' for nothing. A proposal
 * records it when the model is asked; accepting it later must find the same,
 * or the proposal would silently replace what a person entered or verified
 * in the meantime.
 */
export const heldBy = v => v ? JSON.stringify([v.at || '', v.reported_value ?? '', v.verification || '']) : '';
const heldNow = (p, f) => heldBy(get().values?.[`${p.id}:${f.id}`]);

/** Stores a proposal's value, or refuses when the cell changed since the proposal or is verified. */
export function store(p, f, rec, was = '') {
  const now = get().values?.[`${p.id}:${f.id}`];
  if (heldBy(now) !== was) return { refused: `${f.label} was set since; read it again` };
  if (now?.verification === 'verified') return { refused: `${f.label} is verified` };
  const loc = rec.source_locator;
  const evidence = loc?.page
    ? [{ kind: 'text', document_version: loc.document_version, page: loc.page, rects: loc.rects || [], quote: rec.quote }]
    : rec.quote ? [{ kind: 'abstract', quote: rec.quote }] : [];
  setAnchoredValue(p.id, f.id, { reported_value: rec.reported_value, normalized_value: rec.normalized_value,
    origin: rec.origin, extractor: rec.extractor, availability: rec.availability || 'present', evidence,
    ...(rec.derivation ? { derivation: rec.derivation, rationale: rec.derivation } : {}) });
  return `${p.label}: ${f.label} ${now ? 'replaced' : 'set'}`;
}

/** Studies grouped for one call each, by the characters of their title and abstract. */
export function abstractBatches(targets, limit = ABSTRACT_BATCH, most = ABSTRACT_STUDIES) {
  const out = []; let cur = [], n = 0;
  for (const p of targets) {
    const len = Math.min(6000, (p.abstract || '').length) + (p.title || '').length;
    if (cur.length && (n + len > limit || cur.length >= most)) { out.push(cur); cur = []; n = 0; }
    cur.push(p); n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The item a person accepts, for one value of one study. */
function valueItem(p, f, v, cfg, extra, was) {
  return {
    label: `${f.label}: ${v.value}`,
    detail: [p.label, v.derivation].filter(Boolean).join(': '),
    quote: v.quote,
    acceptLabel: 'Set value',
    ...proposeValue({ paper: { id: p.id, label: p.label }, field: { id: f.id, label: f.label }, record: valueRecord(p, f, v, cfg, { ...extra, ...(v.derivation ? { origin: 'derived', derivation: v.derivation } : {}) }), was }),
  };
}

/**
 * Reads the title and abstract of several studies, a batch per call. Each
 * study's values are checked against its own title and abstract only.
 * `FSof(p)` names the fields to ask of a study.
 */
async function readAbstracts({ state, cfg, signal, brief, progress, targets, FSof, prompt = P.extractionReadAbstract }) {
  const items = []; let dropped = 0, failed = 0, silent = 0; const checks = [];
  const batches = abstractBatches(targets);
  for (const [bi, batch] of batches.entries()) {
    if (batches.length > 1) progress(`${bi + 1} of ${batches.length}`);
    const asked = new Map(batch.map(p => [p.id, withAux(FSof(p))]));
    // The field list once for the batch; a study asked for fewer says which.
    const union = [...new Map(batch.flatMap(p => asked.get(p.id)).map(f => [f.id, f])).values()];
    const one = batch.length === 1;
    const tag = i => `S${i + 1}`;
    const studies = batch.map((p, i) => {
      const own = asked.get(p.id);
      return { tag: tag(i), label: p.label, fieldsNote: own.length < union.length ? `Fields for this study: ${own.map(f => f.id).join(', ')}` : '',
        title: p.title || '', abstract: (p.abstract || '').slice(0, 6000) };
    });
    let reply;
    try {
      reply = jsonOf(await complete(cfg, P.messagesOf(prompt, { brief, fields: fieldLines(union, state), studies }),
        { prompt, signal, temperature: 0, maxTokens: Math.min(3000, 250 + 650 * batch.length), json: true }));
    } catch (err) {
      // A batch that fails is reported, not fatal, unless it is the only one.
      if (err?.name === 'AbortError' || batches.length === 1) throw err;
      failed += batch.length; continue;
    }
    const byTag = new Map();
    if (one && Array.isArray(reply?.values)) byTag.set(tag(0), reply.values);
    for (const x of Array.isArray(reply?.studies) ? reply.studies : []) if (x && Array.isArray(x.values)) byTag.set(String(x.study || '').replace(/[[\]]/g, '').trim(), x.values);
    for (const [i, p] of batch.entries()) {
      // A study the reply leaves out is not answered, not "nothing stated".
      const got = byTag.get(tag(i));
      if (!got) { silent++; continue; }
      const FS = asked.get(p.id);
      const source = `${p.title || ''}\n\n${p.abstract || ''}`;
      const quoted = [];
      for (const x of got) { const v = keepValue(x, FS, source); if (v) quoted.push(v); else dropped++; }
      const { values, failed: why } = settle(state, p, quoted, FS);
      checks.push(...why.map(w => `${p.label} ${w}`));
      for (const v of values) {
        const f = FS.find(z => z.id === v.field);
        items.push(valueItem(p, f, v, cfg, { origin: 'model', source: 'abstract' }, heldNow(p, f)));
      }
    }
  }
  return { prompt: promptRef(prompt), items, note: [silent && (targets.length === 1 ? 'No answer from the model' : `${silent} not answered`),
    dropped && `${dropped} dropped: quote not in abstract`, failed && `${failed} not read`,
    checks.length && `${checks.length} failed checks: ${checks.slice(0, 4).join('; ')}${checks.length > 4 ? '; …' : ''}`].filter(Boolean).join('; ') };
}

const proposeValue = durableAction('extracted-value', ({ paper, field, record, was }) => {
  return store(paper, field, record, was);
});

// An empty cell the review found a value for in the paper's text: accepting files a CELL PROPOSAL (pending in the grid, with the quote and its
// page), never a value. Refused when the cell holds something now that it did not hold when the review ran.
const proposeCell = durableAction('review-propose', ({ paperId, paperLabel, fieldId, fieldLabel, value, quote, page, doc, hash, was, model, runId, noteId }) => {
  const cell = `${paperId}:${fieldId}`;
  if (heldBy(get().values?.[cell]) !== was) return { refused: `${fieldLabel} was set since; review again` };
  if (get().proposals?.[cell]) return { refused: `${fieldLabel} already has a proposal` };
  const evidence = page === 0 ? [{ kind: 'abstract', quote }] : [{ kind: 'text', document_version: hash || undefined, page, rects: [], quote, ...(doc && doc !== paperId ? { doc_id: doc } : {}) }];
  propose(paperId, { column_id: fieldId, value, normalized_value: value, availability: 'present', evidence, rationale: 'Found in the text by Review data', origin: 'model', mode: 'review', model: model || null, run_id: runId });
  if (noteId) setNoteState(cell, noteId, 'applied');
  return `${paperLabel}: ${fieldLabel} proposed`;
}, ({ paperLabel, fieldLabel, value }) => ({ label: `${fieldLabel}: ${value}`, detail: `${paperLabel}: found in the text, proposed to the cell`, acceptLabel: 'Propose' }));

const REVIEW_PAGES = 60;       // pages of one paper the review reads at most
const REVIEW_ITEMS = 300;      // findings one proposal lists at most; the rest are in the cells' notes

/** The text that can be read of each study of the table (page 0 is the abstract), and how many papers could not be read. `reader(paperId, opts)` is pdfPages unless a caller supplies one. */
async function readSources({ state, studies, reader, signal, progress }) {
  const papers = new Map((state.papers || []).map(p => [p.id, p])), sources = new Map();
  const todo = studies.filter(s => papers.get(s.id)?.pdf).length;
  let unreadable = 0, n = 0;
  for (const s of studies) {
    const p = papers.get(s.id); if (!p) continue;
    const pages = new Map(); let complete = true, hash = '';
    if (p.abstract) pages.set(0, `${p.title || ''}\n${p.abstract}`);
    if (p.pdf) {
      progress(`Reading papers: ${++n} of ${todo}`);
      try {
        const r = await reader(p.id, { signal, maxPages: REVIEW_PAGES });
        for (const pg of r.pages) if (String(pg.text).trim()) pages.set(pg.page, pg.text);
        complete = r.pages.length >= r.total; hash = r.hash || '';
      } catch (err) { if (err?.name === 'AbortError') throw err; unreadable++; }
    }
    if (pages.size) sources.set(p.id, { pages, complete, hash });
  }
  return { sources, unreadable };
}
/** The extraction disagreements of the whole table, every page of the queue. */
function allDisagreements(state) {
  const out = [];
  for (let offset = 0; offset != null;) { const q = adjudicationQueue(state, { stage: 'extraction', limit: 100, offset }); out.push(...q.items.map(i => ({ key: i.key, reasons: i.reasons }))); offset = q.nextOffset; }
  return out;
}

// A model's grouping of one field's texts, as a proposal: accepting it adds the categories and the texts' categories to the project's mapping
// (lib/extraction-summary-state.mjs applyMapping). It reads and writes no value: the grouping only decides how texts are counted.
const proposeMapping = durableAction('normalise-mapping', ({ fieldId, add, replace }) => {
  applyMapping(fieldId, add, { replace });
  return `${Object.keys(add.cells || {}).length} texts grouped`;
}, ({ label, categories, grouped }) => ({ label: `${label}: grouping`, detail: `${categories} new ${categories === 1 ? 'category' : 'categories'} for ${grouped} ${grouped === 1 ? 'text' : 'texts'}`, acceptLabel: 'Accept' }));

/** One model call for the normalisation: the reply's text and the usage the provider reported for it (null when it did not). */
async function askOnce(cfg, messages, { maxTokens, signal, prompt = P.extractionNormalise }) {
  const before = get().aiCalls?.[0];
  const text = await complete(cfg, messages, { prompt, signal, temperature: 0, maxTokens, json: true });
  const last = get().aiCalls?.[0];
  return { text, usage: last && last !== before ? last.usage : null };
}

// Derived fields (lib/derive-fields.mjs): the focused cell's column is read, its attributes become columns a person accepts one by one.
const deriveFocus = (s, f) => {
  if (f?.kind !== 'cell' || !f.templateId) return null;
  const col = columnsOf(f.templateId, s).find(c => c.id === splitCellId(f.fieldId).columnId);
  return col && (col.type === 'text' || col.type === 'category') ? { templateId: f.templateId, col } : null;
};
const proposeDerived = durableAction('derived-field', data => DF.applyDerived(data));
const deriveDetail = p => `${p.filled} of ${p.total} read; ${p.counts.filter(c => c.count).map(c => `${c.level} ${c.count}`).join(', ')}`;
const derivePreview = p => `<div class="out-table-wrap"><table class="out-table"><thead><tr><th>Level</th><th>Cells</th><th>Read from</th></tr></thead><tbody>${p.counts.filter(c => c.count).map(c => `<tr><td>${esc(c.level)}</td><td>${c.count}</td><td>${c.examples.map(esc).join('; ')}</td></tr>`).join('')}</tbody></table></div>`;

register('extraction', [
  {
    // The Data summary's Normalise: for each chosen multi-valued or free-text field, each distinct value not yet counted is sent once, in a
    // batch, never per cell and never with a paper's text. Offered only from that page (`ctx.summary`), whose dialog shows the estimate and
    // the budget first; it is listed in the assistant's runs for the registry's sake and never offered from a menu.
    id: 'normalise-fields',
    label: 'Normalise fields',
    icon: 'classify',
    task: 'extract',
    when: (s, ctx) => ctx?.summary === true,
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, context, progress }) {
      const asked = context?.normalise;
      if (!asked?.fields) throw new Error('Press Normalise on the Data summary');
      const mem = state.extractionSummary || {};
      const plan = await planRun({ fields: asked.fields, studies: asked.studies, values: state.values || {}, proposals: state.proposals || {}, mappings: mem.fields || {},
        cache: mem.cache || {}, model: cfg.model || '', fieldIds: asked.fieldIds || null });
      const budget = asked.budget || RUN_BUDGET_DEFAULT;
      const res = await runPlan({ plan, budget, signal, progress, model: cfg.model || '', ask: (messages, o) => askOnce(cfg, messages, o) });
      cachePut(res.puts); cacheTouch(res.touched);
      const id = `run-${Date.now().toString(36)}`;
      recordRun({ id, at: new Date().toISOString(), kind: 'normalise', model: cfg.model || '', fieldIds: plan.fields.map(f => f.id),
        estimate: { inTokens: plan.totals.inTokens, outTokens: plan.totals.outTokens, calls: plan.totals.calls },
        used: { inTokens: res.used.inTokens, outTokens: res.used.outTokens, calls: res.used.calls, reported: res.used.reported },
        cached: plan.totals.cached, skipped: res.skipped });
      const offered = res.fields.filter(offers);
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      return {
        prompt: promptRef(P.extractionNormalise),
        title: `${n(offered.length, 'grouping', 'groupings')} proposed`,
        note: [`${n(res.fields.reduce((t, f) => t + f.asked, 0), 'value', 'values')} asked in ${n(res.used.calls, 'call', 'calls')}, ${res.fields.reduce((t, f) => t + f.cached, 0)} answered from the cache`,
          res.used.calls && `${num(res.used.inTokens + res.used.outTokens)} tokens ${res.used.reported ? 'used' : 'estimated, not reported by the provider'}`,
          res.stopped && `stopped at ${res.stopped} of the run budget`,
          res.skipped.length && `not asked: ${res.skipped.map(id => plan.field(id)?.label || id).join(', ')}`,
          ...res.fields.filter(f => f.note).map(f => `${f.label}: ${f.note}`),
          res.fields.some(f => f.dropped) && `${res.fields.reduce((t, f) => t + f.dropped, 0)} dropped: not in the expected form`].filter(Boolean).join('; '),
        items: offered.map(r => ({
          label: `${r.label}: grouping`,
          detail: `${n(r.categories, 'new category', 'new categories')} for ${n(r.grouped, 'text', 'texts')}`,
          field: r.id,
          acceptLabel: 'Accept',
          ...proposeMapping({ fieldId: r.id, add: { ...r.add, definitionHash: plan.fields.find(f => f.id === r.id)?.defHash || '', model: cfg.model || '' }, replace: r.stale,
            label: r.label, categories: r.categories, grouped: r.grouped }),
        })),
      };
    },
  },
  {
    // The Data summary's Review data: the local review (free, deterministic, no model) always runs and files its findings; the model step asks
    // first (`context.review.confirm` shows the exact local counts and the estimate), samples the studies it is told to, honours the run budget
    // and is searched for every quote it gives. Everything lands as items of one proposal with source anchors and as notes on the cells
    // (extractionSummary.review); an item that offers a value for an empty cell files a cell proposal. Nothing here changes an accepted value.
    id: 'review-data',
    label: 'Review data',
    icon: 'check',
    task: 'extract',
    optionalModel: true,
    when: (s, ctx) => ctx?.summary === true,
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, context, progress }) {
      const asked = context?.review;
      if (!asked?.fields) throw new Error('Press Review data on the Data summary');
      const mem = state.extractionSummary || {};
      const { sources, unreadable } = await readSources({ state, studies: asked.studies, reader: asked.reader || pdfPages, signal, progress });
      progress('Checking the values');
      const template = asked.templateId ? templateById(asked.templateId, state) : null;
      const rules = template ? rulesOf({ ...template, columns: asked.fields }, state) : null;
      const ruleCells = rules ? checkTable(state.values || {}, { ...template, columns: asked.fields }, rules).cells : new Map();
      const local = reviewTable({ fields: asked.fields, studies: asked.studies, values: state.values || {}, sources, ruleCells, disagreements: allDisagreements(state) });
      const residual = residualOf(local);
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      let findings = local.findings, step = '', prompt = '';
      const runId = `review-${Date.now().toString(36)}`;
      // the model step: only with a connection, only after the person has seen the counts and the estimate, only for the sample they chose
      if (!residual.length) step = 'Nothing is left for the model';
      else if (!configured(cfg)) step = 'No model is set for Extraction: only the local review ran';
      else if (!asked.confirm) step = 'The model step was not requested';
      else {
        const plan = await planReview({ residual, fields: asked.fields, studies: asked.studies, cache: mem.cache || {}, model: cfg.model || '' });
        const pick = await asked.confirm({ counts: local.counts, unchecked: local.unchecked, unreadable, plan, model: cfg.model || '' });
        if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
        if (!pick) step = 'The model step was skipped';
        else {
          const sample = plan.forSample(pick.sample);
          const budget = pick.budget || RUN_BUDGET_DEFAULT;
          const res = await runReview({ sample, plan, budget, sources, cache: mem.cache || {}, signal, progress, model: cfg.model || '',
            ask: (messages, o) => askOnce(cfg, messages, { ...o, prompt: P.extractionReview }) });
          cachePut(res.puts); cacheTouch(res.touched);
          const settled = settleFindings(local.findings, res.results);
          findings = settled.findings;
          if (res.calls) prompt = promptRef(P.extractionReview);
          recordRun({ id: runId, at: new Date().toISOString(), kind: 'review', model: cfg.model || '', fieldIds: [],
            estimate: { inTokens: sample.totals.inTokens, outTokens: sample.totals.outTokens, calls: sample.totals.calls },
            used: { inTokens: res.used.inTokens, outTokens: res.used.outTokens, calls: res.used.calls, reported: res.used.reported },
            cached: sample.totals.cached, skipped: res.skipped });
          step = [`Model: ${n(sample.totals.studies, 'study', 'studies')} of ${plan.studyCount} with something to ask, ${n(res.used.calls, 'call', 'calls')}, ${sample.totals.cached} answered from the cache`,
            res.used.calls && `${num(res.used.inTokens + res.used.outTokens)} tokens ${res.used.reported ? 'used' : 'estimated, not reported by the provider'}`,
            settled.supported && `${settled.supported} supported by the text`,
            res.dropped && `${res.dropped} dropped: quote not in source`,
            res.stopped && `stopped at ${res.stopped} of the run budget`,
            plan.studyCount > sample.totals.studies && `${n(plan.studyCount - sample.totals.studies, 'study', 'studies')} outside the sample`,
            res.skipped.length && `${n(res.skipped.length, 'study', 'studies')} not asked`].filter(Boolean).join('; ');
        }
      }
      // the findings, in the order a reader meets them: what the text contradicts, then by kind, then table order
      const order = Object.keys(REVIEW_KINDS), at = new Map(asked.studies.map((x, i) => [x.id, i]));
      findings = findings.map((f, i) => ({ f, i })).sort((a, b) => order.indexOf(a.f.kind) - order.indexOf(b.f.kind) || (at.get(a.f.paperId) ?? 0) - (at.get(b.f.paperId) ?? 0) || a.i - b.i).map(x => x.f);
      const ids = new Map(findings.map((f, i) => [f, `${runId}-${i}`]));
      const byCell = {};
      for (const f of findings) (byCell[f.cell] ||= []).push({ id: ids.get(f), kind: f.kind, text: f.text, ...(f.quote ? { quote: f.quote } : {}), ...(f.page != null ? { page: f.page } : {}),
        ...(f.proposal ? { value: String(f.proposal.value) } : {}),   // what a 'stated' note found, so Details can offer it as a cell proposal
        ...(f.doc && f.doc !== f.paperId ? { docId: f.doc } : {}), state: 'open', runId, valueHash: valueHash(state.values?.[f.cell]), at: new Date().toISOString() });
      fileReviewRun(byCell, { runId });
      const cutOff = Math.max(0, findings.length - REVIEW_ITEMS);
      const counts = {}; for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + 1;
      return {
        prompt,
        title: `${n(findings.length, 'finding', 'findings')} in the extracted data`,
        note: [countsText(counts) || 'Nothing found',
          local.unchecked && `${n(local.unchecked, 'quote', 'quotes')} could not be checked: no text`,
          unreadable && `${n(unreadable, 'paper', 'papers')} could not be read`,
          step, cutOff && `${cutOff} more are in the cells' notes`].filter(Boolean).join('; '),
        items: findings.slice(0, REVIEW_ITEMS).map(f => ({
          label: `${f.label}: ${REVIEW_KINDS[f.kind]}`,
          detail: `${f.study}: ${f.text}`,
          ...(f.quote ? { quote: f.quote } : {}),
          ...(f.page != null ? { where: { paperId: f.doc || f.paperId, locator: { page: f.page }, label: f.page === 0 ? `${f.study}, abstract` : f.study } } : {}),
          cell: f.cell, field: f.fieldId, finding: f.kind,
          ...(f.proposal ? { acceptLabel: 'Propose', ...proposeCell({ paperId: f.paperId, paperLabel: f.study, fieldId: f.fieldId, fieldLabel: f.label, value: f.proposal.value, quote: f.proposal.quote, page: f.proposal.page,
            doc: f.doc || f.paperId, hash: sources.get(f.doc || f.paperId)?.hash || '', was: heldBy(state.values?.[f.cell]), model: cfg.model || '', runId, noteId: ids.get(f) }) } : {}),
        })),
      };
    },
  },
  {
    // One column's texts in, attributes out: each becomes a column of the table (filter, group, count, pivot) once a person accepts it.
    id: 'derive-fields',
    label: 'Derive fields from this column',
    icon: 'fanout',
    task: 'extract',
    when: (s, ctx) => Boolean(deriveFocus(s, ctx?.focus)),
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, progress }) {
      const { templateId, col } = deriveFocus(state, focus);
      const units = DF.sourceUnits(state, templateId, col.id, studies(state));
      if (units.length < 4) return { title: col.label, items: [], note: `Only ${units.length} ${units.length === 1 ? 'text' : 'texts'} in this column; there is not enough to derive from.` };
      const texts = DF.distinctTexts(units), pl = DF.plan(texts);
      if (pl.problem) throw new Error(pl.problem);
      const list = ts => ts.map(x => `[${x.n}] ${DF.clip(x.text)}`).join('\n');
      progress('attributes');
      const scheme = DF.validateScheme(jsonOf((await askOnce(cfg, P.messagesOf(P.extractionDeriveScheme, { column: col.label, texts: list(texts.slice(0, DF.SCHEME_TEXTS)) }),
        { maxTokens: P.extractionDeriveScheme.maxTokens, signal, prompt: P.extractionDeriveScheme })).text));
      if (!scheme.length) return { prompt: promptRef(P.extractionDeriveScheme), title: col.label, items: [], note: 'The texts state no attribute that recurs with distinct levels.' };
      const schemeText = scheme.map(f => `- ${f.label}${f.multiple ? ' (multiple)' : ''}: ${f.options.join(' | ')}`).join('\n');
      const kept = []; let dropped = 0;
      for (const [i, batch] of pl.batches.entries()) {
        progress(`${i + 1} of ${pl.batches.length}`);
        const out = DF.validateAssignment(jsonOf((await askOnce(cfg, P.messagesOf(P.extractionDeriveAssign, { column: col.label, scheme: schemeText, texts: list(batch) }),
          { maxTokens: P.extractionDeriveAssign.maxTokens, signal, prompt: P.extractionDeriveAssign })).text), scheme, batch);
        kept.push(...out.kept); dropped += out.dropped;
      }
      const props = DF.proposals(scheme, texts, kept, units).filter(p => p.filled > 0);
      const prompt = promptRef(P.extractionDeriveAssign);
      return {
        prompt, title: `${props.length} ${props.length === 1 ? 'column' : 'columns'} from ${col.label}`,
        note: [`${texts.length} distinct texts of ${units.length} read in ${pl.calls} calls`, texts.length > DF.SCHEME_TEXTS && `attributes chosen from the first ${DF.SCHEME_TEXTS} texts`,
          dropped && `${dropped} values dropped: not a level or not in the text`, 'a text that does not state an attribute is left empty'].filter(Boolean).join('; '),
        items: props.map(p => ({ label: p.label, detail: deriveDetail(p), preview: derivePreview(p), acceptLabel: 'Add column',
          ...proposeDerived({ templateId, sourceColumnId: col.id, sourceLabel: col.label, label: p.label, options: DF.usedLevels(p), multiple: p.multiple, definition: p.definition,
            cells: p.cells, model: cfg.model || '', prompt }) })),
      };
    },
  },
  {
    id: 'read-abstract',
    label: 'Read from abstract',
    icon: 'sparkle',
    task: 'extract',
    when: (s, ctx) => {
      const p = paperOf(s, ctx?.focus);
      if (p) return Boolean(p.abstract && wanted(s, p, ctx.focus).length);
      return studies(s).some(q => q.abstract && wanted(s, q, null).length);
    },
    // The study's title and abstract are in the request already.
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, brief, progress }) {
      const one = paperOf(state, focus);
      const targets = one ? [one] : studies(state).filter(q => q.abstract && wanted(state, q, null).length).slice(0, MAX_STUDIES);
      const { items, note, prompt } = await readAbstracts({ state, cfg, signal, brief, progress, targets, FSof: p => wanted(state, p, one ? focus : null) });
      return {
        prompt,
        title: one ? `${one.label} from abstract` : `${targets.length} ${targets.length === 1 ? 'abstract' : 'abstracts'}`,
        note,
        items,
      };
    },
  },
  {
    // A scoping review charts what each source says: its words and
    // categories, across the sources, from their abstracts.
    id: 'chart-sources',
    label: 'Chart sources from abstracts',
    icon: 'sparkle',
    task: 'extract',
    when: s => researchType(s).id === 'scoping-review' && studies(s).some(q => q.abstract && charted(s, q).length),
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, brief, progress }) {
      const targets = studies(state).filter(q => q.abstract && charted(state, q).length).slice(0, MAX_STUDIES);
      const { items, note, prompt } = await readAbstracts({ state, cfg, signal, brief, progress, targets, FSof: p => charted(state, p), prompt: P.extractionChartSources });
      return { prompt, title: `${targets.length} ${targets.length === 1 ? 'source' : 'sources'} charted`, note, items };
    },
  },
  {
    id: 'read-fulltext',
    label: 'Read from full text',
    icon: 'file',
    task: 'extract',
    when: (s, ctx) => { const p = paperOf(s, ctx?.focus); return Boolean(p?.pdf && wanted(s, p, ctx.focus).length); },
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, brief, progress }) {
      const p = paperOf(state, focus);
      const FS = withAux(wanted(state, p, focus));
      progress('Reading PDF');
      const { pages, hash, total } = await pdfPages(p.id, { signal });
      const batches = pageBatches(pages.filter(pg => pg.text.trim()));
      if (!batches.length) throw new Error('No text in this PDF');
      const found = []; let silent = 0;
      for (const [i, batch] of batches.entries()) {
        progress(`Pages ${batch[0].page}–${batch[batch.length - 1].page} of ${total}`);
        const reply = jsonOf(await complete(cfg, P.messagesOf(P.extractionReadFulltext, { brief, fields: fieldLines(FS, state), study: p.label,
          part: batches.length > 1 ? `part ${i + 1} of ${batches.length}` : '', pages: pagesText(batch) }),
        { prompt: P.extractionReadFulltext, signal, temperature: 0, json: true }));
        if (Array.isArray(reply?.values)) found.push(...reply.values); else silent++;
      }
      const { kept, dropped } = keepOnPage(found, FS, pages);
      const { values, failed: why } = settle(state, p, kept, FS);
      const was = new Map(FS.map(f => [f.id, heldNow(p, f)]));
      return {
        prompt: promptRef(P.extractionReadFulltext),
        title: `${p.label} from full text`,
        note: [silent && (silent === batches.length ? 'No answer from the model' : `${silent} of ${batches.length} parts not answered`),
          pages.length < total && `Pages 1–${pages.length} of ${total} read`, dropped && `${dropped} dropped: quote not on page`,
          why.length && `${why.length} failed checks: ${why.slice(0, 4).join('; ')}${why.length > 4 ? '; …' : ''}`].filter(Boolean).join('; '),
        items: values.map(v => {
          const f = FS.find(z => z.id === v.field);
          const locator = { document_version: hash, page: v.page, rects: [] };
          return {
            label: `${f.label}: ${v.value}`,
            detail: v.derivation || undefined,
            quote: v.quote,
            where: { paperId: p.id, locator: { page: v.page }, label: `${p.label}, p. ${v.page}` },
            acceptLabel: 'Set value',
            // "inferred" as the reader stores a model suggestion, so the cell
            // opens the page it was read from; "derived" when computed from it.
            ...proposeValue({ paper: { id: p.id, label: p.label }, field: { id: f.id, label: f.label }, record: valueRecord(p, f, v, cfg, { origin: v.derivation ? 'derived' : 'inferred', availability: 'present', source: 'full text', source_locator: locator, ...(v.derivation ? { derivation: v.derivation } : {}) }), was: was.get(f.id) }),
          };
        }),
      };
    },
  },
  {
    id: 'check-values',
    label: 'Check values against source',
    icon: 'check',
    task: 'extract',
    when: (s, ctx) => { const p = paperOf(s, ctx?.focus); return Boolean(p && (p.abstract || p.pdf) && fields(s).some(f => has(s, p, f))); },
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, brief, progress }) {
      const p = paperOf(state, focus);
      const FS = fields(state).filter(f => has(state, p, f));
      const vals = FS.map(f => ({ f, v: state.values[`${p.id}:${f.id}`] }));
      // The abstract counts as page 0, so one rule places every quote.
      let pages = p.abstract ? [{ page: 0, text: `${p.title || ''}\n${p.abstract}` }] : [];
      let total = 0;
      if (p.pdf) {
        progress('Reading PDF');
        try { const r = await pdfPages(p.id, { signal }); pages = pages.concat(r.pages.filter(pg => pg.text.trim())); total = r.total; }
        catch (err) { if (err?.name === 'AbortError' || !p.abstract) throw err; }
      }
      const batch = pageBatches(pages, 40000)[0] || [];
      const source = batch.map(pg => pg.page === 0 ? `[abstract]\n${pg.text}` : `[page ${pg.page}]\n${pg.text}`).join('\n\n');
      const out = await complete(cfg, P.messagesOf(P.extractionCheckValues, { brief, study: p.label, source,
        values: vals.map(({ f, v }) => `- ${f.id} (${f.label}): ${v.reported_value}`).join('\n') }),
      { prompt: P.extractionCheckValues, signal, temperature: 0, maxTokens: 300 + 80 * vals.length, json: true });
      const byPage = new Map(batch.map(pg => [pg.page, pg.text]));
      const all = batch.map(pg => pg.text).join('\n');
      const items = []; let dropped = 0;
      // Only a value the reply rules on counts as checked; a value it skips,
      // or a reply with no checks at all, is said to be unchecked.
      const checks = jsonOf(out).checks;
      const ruled = new Map();
      for (const c of Array.isArray(checks) ? checks : []) {
        const hit = vals.find(x => x.f.id === c?.field);
        if (!hit || ruled.has(hit.f.id) || !['supported', 'contradicted', 'unstated'].includes(c.status)) continue;
        ruled.set(hit.f.id, c.status);
        if (c.status === 'supported') continue;
        const page = parseInt(c.page, 10);
        const quote = String(c.quote || '').trim();
        if (c.status === 'contradicted' && !(byPage.has(page) && quoteIn(quote, byPage.get(page)))) { dropped++; continue; }
        // A value whose own quote is in the text is stated there, whatever the model says.
        if (c.status === 'unstated' && hit.v.quote && quoteIn(hit.v.quote, all)) { dropped++; continue; }
        items.push({
          label: `${hit.f.label}: ${hit.v.reported_value} ${c.status === 'contradicted' ? 'contradicted' : 'not stated'}`,
          detail: String(c.note || '').slice(0, 160) || undefined,
          quote: c.status === 'contradicted' ? quote.slice(0, 400) : undefined,
          where: c.status === 'contradicted' && page > 0 ? { paperId: p.id, locator: { page }, label: `${p.label}, p. ${page}` } : undefined,
        });
      }
      const read = batch.filter(pg => pg.page > 0).length;
      const supported = [...ruled.values()].filter(x => x === 'supported').length;
      const unchecked = vals.filter(x => !ruled.has(x.f.id)).map(x => x.f.label);
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      return {
        prompt: promptRef(P.extractionCheckValues),
        title: `${p.label} values checked`,
        note: [!ruled.size && 'No answer from the model',
          supported && n(supported, 'value supported', 'values supported'),
          unchecked.length && `${n(unchecked.length, 'value', 'values')} not checked: ${unchecked.slice(0, 6).join(', ')}${unchecked.length > 6 ? ', …' : ''}`,
          total && read < total && `Pages 1–${read} of ${total} read`,
          dropped && `${dropped} dropped: quote not in source`].filter(Boolean).join('; '),
        items,
      };
    },
  },
]);

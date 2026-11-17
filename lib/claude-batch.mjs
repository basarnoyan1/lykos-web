// Bulk Claude runs through Anthropic's Message Batches API (plan §6.3, batch mode, 13 November 2026).
//
// A batch costs half of every token, cache reads and writes included, and most finish within an hour (24 hours at
// most). It suits work nobody waits on: proposals for a screening queue (and a second model's or the text model's pass
// over it), values read from abstracts, a check of extracted values against the full texts. Chat, Act and anything a
// person waits on stay one request at a time (lib/ai.mjs). This module loads when such a run starts, or when a project
// opens with a batch still out (app.mjs); it is not on the startup graph.
//
// The run is kept in the project (`claudeBatches`), so it survives closing Lykos: the batch id, the records it covers
// (a request's custom_id is `r<index>` into `ids`), what the kind needs to rebuild a request and apply an answer
// (`ctx`), and what has been applied. On open the run is followed again; results are applied by custom_id, in the
// order they come; an expired or errored request, or one that thought through its whole cap, is sent once more in a
// batch of its own; a request the API refused as invalid, or that Claude declined, is not. Cost is at batch price.
//
// The requests are the ones the synchronous path sends (lib/ai.mjs complete): the same context, the same egress check,
// the same body (lib/anthropic-request.mjs claudeBody), without `stream`, which a batch request cannot carry.
// The shell sends them (src-tauri claude_batch.rs: create, status, cancel, and the results streamed to a channel); a
// page outside the desktop shell has no batch mode.
import { store$get as get, store$update as update, store$withSections as withSections, store$projectGeneration as projectGeneration, store$persist as persist } from "../boot.mjs";
import { lib_jobs$run as runJob, lib_jobs$jobs as jobs } from "../boot.mjs";
import { guardSend, recordModelCall, modelInfo } from './ai.mjs';
import { lib_context$withContext as withContext, lib_context$BRIEF_LEVELS as BRIEF_LEVELS } from "../boot.mjs";
import { promptById } from './prompts.mjs';
import { lib_model_effort$reasoningOptions as reasoningOptions } from "../boot.mjs";
import { claudeBody, claudeError } from './anthropic-request.mjs';
import { lib_anthropic$ANTHROPIC_BASE as ANTHROPIC_BASE, lib_anthropic$claudeHeaders as claudeHeaders, lib_anthropic$claudeWorkspace as claudeWorkspace, lib_anthropic$claudeUsage as claudeUsage } from "../boot.mjs";
import { lib_model_settings$profiles as profiles } from "../boot.mjs";
import { assessRequest, assessReply } from './assist.mjs';
import { abstractRequest, abstractReply } from './helpers.mjs';
import { unanimousProposal } from './screen-unanimity.mjs';
import { valuesToCheck, valuesToAsk, checkParts, checkPrompt, parseCheck, checkCheckQuotes } from './value-check.mjs';
import { mergeCheck } from './value-accuracy.mjs';
import { lib_late_abstracts$whenReady as whenReady } from "../boot.mjs";

/** The API's limits for one batch. */
export const MAX_REQUESTS = 100000, MAX_BYTES = 256 << 20;
/** The first status check a minute after sending, then half as long again each time, at most every ten minutes. */
export const FIRST_POLL = 60e3, MAX_POLL = 600e3;
/** A run another window has not looked at for this long is taken over. */
const STALE = 15 * 60e3;
const KEEP = 50;
const WINDOW = Math.random().toString(36).slice(2, 10);
const following = new Set();
const unfollow = id => { following.delete(id); if (!following.size) texts = { run: null, byId: new Map() }; };
const runs = s => s.claudeBatches || [];
const entryOf = id => runs(get()).find(e => e.id === id) || null;
// Run bookkeeping is not a research input (as lib/jobs.mjs); applied answers are.
const patch = (id, fn) => update(s => { const e = runs(s).find(x => x.id === id); if (e) fn(e); return s; }, { indexNeutral: true });

// ---- What a kind of run sends and how its answer lands. ----

/** The lane a screening proposal is written to (views/screening.mjs propLane: main's proposals, or a scenario's). */
function propLane(st, at, sc) {
  if (!sc) { st.proposals = st.proposals || {}; st.proposals[at] = st.proposals[at] || {}; return st.proposals[at]; }
  return (((st.scenarioProposals ||= {})[sc] ||= {})[at] ||= {});
}
const stampOf = ctx => (ctx.scenario ? { fingerprint: ctx.fingerprint } : {});
const screenKind = {
  job: 'screen',
  sections: ctx => (ctx.scenario ? ['scenarioProposals'] : []),
  async records(ids, ctx) {
    const want = new Set(ids), out = new Map();
    for (const p of get().papers || []) if (want.has(p.id)) out.set(p.id, p);
    if (out.size < want.size && ctx.scenario)
      await withSections('scenarioPapers', () => { for (const p of get().scenarioPapers || []) if (want.has(p.id) && !out.has(p.id)) out.set(p.id, p); });
    return out;
  },
  request: (record, ctx) => assessRequest(record, ctx.rules),
  parse: (text, record, ctx) => assessReply(text, record, ctx.rules),
};

/** A screening answer as a pair run keeps it until the batch answers: the verdict and the criteria not met (the rest are met). */
export const keptAnswer = a => [a.verdict, (a.criteria || []).filter(c => c.met !== 'yes')];
const answerOf = ([verdict, issues], rules) => ({ verdict, criteria: rules.map(c => issues.find(i => i.id === String(c.id)) || { id: String(c.id), met: 'yes', note: '' }) });

/** A value-check request id: the study and the part of its values (`<study>~<n>`). */
export const checkId = (study, n) => `${study}~${n}`;
const studyOfCheck = id => id.slice(0, id.lastIndexOf('~'));
// The full texts of the run last read: a run's answers come in several groups, each needing the texts of its studies.
let texts = { run: null, byId: new Map() };

export const KINDS = {
  // Title and abstract proposals from the text model (views/screening.mjs Propose); ctx = { stage, scenario, rules, fingerprint }.
  screen: {
    ...screenKind,
    apply(st, id, a, ctx, model, at) {
      if (!a?.verdict) return false;
      propLane(st, ctx.stage, ctx.scenario)[id] = { verdict: a.verdict, criteria: a.criteria || [], model, at, tier: 'llm', ...stampOf(ctx) };
      return true;
    },
  },
  // Two-model proposals (views/screening.mjs, the `two` path): one model answered at once and its answers wait in `ctx.items`
  // ({ [id]: keptAnswer }); the batch is the other model, `ctx.models[ctx.at]`. A record's proposal is made when both have answered
  // (lib/screen-unanimity.mjs unanimousProposal); a record the first model failed on is not in the batch.
  // ctx = { stage, scenario, rules, fingerprint, models: [first, second], at: 0 | 1, items }.
  'screen-pair': {
    ...screenKind,
    apply(st, id, a, ctx, model, at) {
      const kept = ctx.items?.[id];
      if (!a?.verdict || !kept) return false;
      const answers = [];
      answers[ctx.at] = a; answers[1 - ctx.at] = answerOf(kept, ctx.rules);
      propLane(st, ctx.stage, ctx.scenario)[id] = { ...unanimousProposal(answers, ctx.models, at), ...stampOf(ctx) };
      return true;
    },
  },
  // The text model's pass over what the decision model left uncertain (views/screening.mjs, the decision-model path): its proposal
  // replaces the decision model's in the lane and carries it as `jev`, as the synchronous pass does. ctx as `screen`.
  'screen-unsure': {
    ...screenKind,
    apply(st, id, a, ctx, model, at) {
      if (!a?.verdict) return false;
      const lane = propLane(st, ctx.stage, ctx.scenario), prev = lane[id], jev = prev?.tier === 'jev' ? prev : prev?.jev;
      lane[id] = { verdict: a.verdict, p: null, eligible: null, criteria: a.criteria || [], model, at, tier: 'llm', ...stampOf(ctx), ...(jev ? { jev } : {}) };
      return true;
    },
  },
  // Values read from abstracts (views/extraction-fill.mjs fillAbstracts): proposals with the phrase they came from; a cell already
  // held or proposed is left alone. ctx = { templateId, columns: [{ id, type, label, options }] }.
  'abstract-extract': {
    job: 'extract',
    sections: () => [],
    async records(ids) {
      const want = new Set(ids), out = new Map();
      for (const p of get().papers || []) if (want.has(p.id)) out.set(p.id, p);
      return out;
    },
    request: (record, ctx) => abstractRequest(record, ctx.columns),
    parse: (text, record, ctx) => abstractReply(text, record, ctx.columns),
    apply(st, id, found, ctx, model, at) {
      if (!Array.isArray(found)) return false;
      st.proposals ||= {};
      for (const x of found) {
        const c = ctx.columns.find(f => f.id === x.field), k = `${id}:${x.field}`;
        if (!c || st.values?.[k] || st.proposals[k]) continue;
        st.proposals[k] = { column_id: c.id, value: x.value, normalized_value: x.value, availability: 'present', evidence: [{ kind: 'abstract', quote: x.quote }],
          rationale: `From the abstract: “${x.quote}”`, origin: 'model', mode: 'fill', model, run_id: null, paper_id: id, at };
      }
      return true;
    },
  },
  // A check of extracted values against the full text (lib/value-check.mjs; lib/flow-runner.mjs, the block "Check extracted values"):
  // one request per part of a study's values (`checkId`). The values sent are kept in `ctx.items` ({ [id]: { label, values: [{ key, value,
  // qualifier }] } })
  // so a value changed while the batch was out is recorded as checked at what was sent, and so shows as stale. A part's answer is
  // merged into the study's last check (lib/value-accuracy.mjs mergeCheck), so a settled value stays settled.
  // ctx = { templateId, by, sentAt, items }.
  'value-check': {
    job: 'extract',
    sections: () => [],
    async records(ids, ctx, applying = false) {
      const out = new Map(), s = get(), template = (s.templates || []).find(t => t.id === ctx.templateId);
      if (!template) return out;
      const [R, doc] = await Promise.all([import('./rob-sweep-run.mjs'), import('./doctext.mjs')]);
      const textOf = R.sweepText() || (async x => doc.pageText(await doc.index(x.id)));
      if (texts.run !== ctx.sentAt) texts = { run: ctx.sentAt, byId: new Map() };
      const studies = new Map(R.sweepStudies(s).map(x => [x.id, x]));
      for (const id of ids) {
        const sent = ctx.items?.[id]?.values, sid = studyOfCheck(id);
        if (!sent) continue;
        const study = studies.get(sid) || { id: sid, label: ctx.items[id].label || sid };
        // a full text that cannot be read is skipped when sending, but when applying it keeps the run out (applyLines: the next open
        // tries again), so an answer paid for is not dropped for a read that failed; a read that failed is not kept
        if (!texts.byId.has(sid)) {
          let text = '';
          try { text = String((await textOf(study)) || ''); } catch (err) { if (applying) throw err; continue; }
          texts.byId.set(sid, text);
        }
        const text = texts.byId.get(sid);
        if (!text.trim()) { if (applying) throw new Error(`The full text of ${study.label} is not available to check the answer against.`); continue; }
        const all = valuesToCheck(s, template, sid), byKey = new Map(all.map(v => [v.key, v]));
        const part = sent.map(x => { const v = byKey.get(x.key) || {};
          return { key: x.key, field: v.field || '', arm: v.arm || '', label: v.label || x.key, guidance: v.guidance || '', value: x.value, ...(x.qualifier ? { qualifier: x.qualifier } : {}) }; });
        out.set(id, { id, study, template, text, all, part });
      }
      return out;
    },
    request: rec => ({ messages: checkPrompt({ template: rec.template, study: rec.study.label, values: rec.part, text: rec.text, arms: rec.template.arms?.[rec.study.id] || [] }),
      options: { maxTokens: 12000, json: true, context: false, task: 'extract' } }),
    parse(text, rec) {
      const c = parseCheck(text, rec.part);
      if (!Object.keys(c.fields).length) throw new Error(c.problems[0] || 'no value in the answer');
      checkCheckQuotes(c, rec.text);
      return { ...c, study: rec.study.id, all: rec.all, text: rec.text };
    },
    apply(st, id, c, ctx, model, at) {
      if (!c?.fields) return false;
      const vc = st.valueChecks ||= { v: 1, studies: {} }, studies = vc.studies ||= {}, prev = studies[c.study];
      for (const f of Object.values(c.fields)) Object.assign(f, { by: ctx.by, at });
      const m = mergeCheck(prev?.fields || {}, c.fields, c.all, c.text);
      // the parts of one study answer apart: an earlier part's problems in this run are kept beside this one's
      const earlier = prev && prev.by === ctx.by && prev.model === model && String(prev.at) >= String(ctx.sentAt) ? prev.problems || [] : [];
      const problems = [...earlier, ...c.problems].slice(0, 20);
      studies[c.study] = { by: ctx.by, model, at, template: ctx.templateId, fields: m.fields, ...(problems.length ? { problems } : {}) };
      return true;
    },
  },
};

/**
 * A value-check batch for `studies` ([{ id, label }]) of the extraction table `template`: the requests (one per part of a study's
 * values still to ask) and the run's ctx. Answers { records, ctx }, records empty when nothing is to be asked.
 */
export function valueCheckRun(s, template, studies, { by, again = false, size = 60 } = {}) {
  const records = [], items = {};
  for (const x of studies) {
    const { values } = valuesToAsk(s, template, x.id, { again });
    checkParts(values, size).forEach((part, n) => {
      const id = checkId(x.id, n);
      records.push({ id }); items[id] = { label: x.label || '', values: part.map(v => ({ key: v.key, value: v.value, ...(v.qualifier ? { qualifier: v.qualifier } : {}) })) };
    });
  }
  return { records, ctx: { templateId: template.id, by, sentAt: new Date().toISOString(), items } };
}

// ---- The shell. ----

let seq = 0;
const shell = () => { const t = globalThis.window?.__TAURI_INTERNALS__; if (!t?.invoke) throw new Error('Batch mode needs the desktop app.'); return t; };
const rid = () => `batch-${Date.now().toString(36)}-${++seq}`;
const baseOf = cfg => String(cfg.base || ANTHROPIC_BASE).replace(/\/+$/, '');
const headersOf = cfg => Object.entries(claudeHeaders(cfg.key, false, claudeWorkspace(cfg)));
/** The transport: `send(cfg, op, batchId, body)` → { status, text }; `results(cfg, batchId, onLines)` → { status, lines, text }. Tests pass their own. */
export const shellIo = {
  send: (cfg, op, batchId = null, body = null) => shell().invoke('ai_batch_send', { requestId: rid(), base: baseOf(cfg), op, batchId, headers: headersOf(cfg), body }),
  async results(cfg, batchId, onLines) {
    const t = shell(); let got = 0, wake = null;
    // A Tauri channel by hand (the app carries no @tauri-apps/api): each message is { message: string[], index }, the last { end: true }.
    const id = t.transformCallback(raw => {
      const lines = raw && typeof raw === 'object' && 'message' in raw ? raw.message : raw;
      if (Array.isArray(lines)) { got += lines.length; onLines(lines); }
      wake?.();
    });
    try {
      const end = await t.invoke('ai_batch_results', { requestId: rid(), base: baseOf(cfg), batchId, headers: headersOf(cfg), onLines: { toJSON: () => `__CHANNEL__:${id}` } });
      // a large message is fetched after the command has answered: wait for every line the shell counted
      const until = Date.now() + 30e3;
      while (got < (end?.lines || 0) && Date.now() < until) await new Promise(r => { wake = r; setTimeout(r, 250); });
      if (got < (end?.lines || 0)) throw new Error(`The batch results arrived incomplete (${got} of ${end.lines} lines).`);
      return end;
    } finally { t.unregisterCallback?.(id); }
  },
};
const wait = (ms, stopped) => new Promise(resolve => {
  const t0 = Date.now(); const tick = () => (stopped() || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, Math.min(1000, ms)));
  tick();
});

// ---- Requests. ----

/** The Messages body for one batch request: what lib/ai.mjs complete would send, without `stream`. Runs the egress check. */
export async function batchBody(cfg, messages, opts = {}) {
  const def = typeof opts.prompt === 'string' ? promptById(opts.prompt) : opts.prompt || null;
  const level = def?.brief ?? 'full';
  // as lib/ai.mjs complete: `context: false` sends neither guard nor brief
  if (opts.context !== false) messages = withContext(messages, undefined, BRIEF_LEVELS[level] || {}, { guard: def?.guard || 'standard', withBrief: level !== 'none' });
  const maxTokens = opts.maxTokens ?? def?.maxTokens ?? 800;
  const meta = { prompt: def, task: opts.task || def?.task || '', sends: opts.sends };
  await guardSend(cfg, messages, meta);
  // lib/ai.mjs effortFor: an effort only when the person chose one or the cap is large
  const effort = cfg.effort || maxTokens >= 8000 ? reasoningOptions(cfg, modelInfo(cfg, cfg.model))?.effort : '';
  const body = claudeBody(cfg.model, messages, { json: !!opts.json, maxTokens, effort });
  delete body.stream;
  return body;
}

async function submit(entry, indexes, cfg, io, doubled = new Set()) {
  const kind = KINDS[entry.kind];
  const records = await kind.records(indexes.map(i => entry.ids[i]), entry.ctx);
  const requests = [];
  for (const i of indexes) {
    const record = records.get(entry.ids[i]);
    if (!record) continue;
    const { messages, options } = kind.request(record, entry.ctx);
    const params = await batchBody(cfg, messages, doubled.has(i) ? { ...options, maxTokens: options.maxTokens * 2 } : options);
    requests.push({ custom_id: `r${i}`, params });
  }
  if (!requests.length) return null;
  if (requests.length > MAX_REQUESTS) throw new Error(`A batch holds at most ${MAX_REQUESTS.toLocaleString('en-US')} requests; this run has ${requests.length.toLocaleString('en-US')}.`);
  const payload = JSON.stringify({ requests });
  if (payload.length > MAX_BYTES) throw new Error('This run is larger than a batch may be (256 MB); run it in parts.');
  const res = await io.send(cfg, 'create', null, payload);
  if (!(res.status >= 200 && res.status < 300)) throw claudeError(res.status, res.text);
  const b = JSON.parse(res.text);
  if (typeof b?.id !== 'string' || !b.id) throw new Error('Anthropic did not return a batch id.');
  return { batchId: b.id, expiresAt: b.expires_at || null, sent: requests.length, missing: indexes.length - requests.length };
}

/** The connection a run was sent with, as it is now (the key may have been replaced since). */
function cfgOf(e) {
  const p = profiles().find(x => x.id === e.profileId);
  if (!p || p.provider !== 'anthropic') throw new Error('The Claude connection this batch was sent with is no longer in Settings.');
  return { ...p, model: e.model };
}

// ---- Results. ----

const textOf = msg => (Array.isArray(msg?.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text || '').join('') : '');
const sum = (a, b) => (a == null || b == null ? null : a + b);

/**
 * Applies one group of result lines: each answer by its custom_id, skipping any already applied (a results download
 * interrupted and read again counts nothing twice). One store write for the answers and one call record for the usage.
 */
async function applyLines(id, lines) {
  const e0 = entryOf(id); if (!e0) return;
  // a run followed again on open: its answers are checked against the abstracts (a quote found), so they are read first
  { const ready = whenReady(); if (ready) await ready; }
  const kind = KINDS[e0.kind], at = new Date().toISOString();
  const rows = [];
  for (const line of lines) { try { const r = JSON.parse(line); if (typeof r?.custom_id === 'string') rows.push(r); } catch { /* not a result line */ } }
  const idx = rows.map(r => (/^r(\d+)$/.exec(r.custom_id) ? +r.custom_id.slice(1) : -1));
  const records = await kind.records(idx.filter(i => i >= 0 && i < e0.ids.length).map(i => e0.ids[i]), e0.ctx, true);
  const sections = kind.sections(e0.ctx);
  if (sections.length) await withSections(sections, () => {});
  let usage = { prompt: 0, completion: 0, cost: 0, cached: 0, cacheWrite: 0, estimated: true }, counted = 0;
  const outcome = [];   // [index, 'applied' | 'retry' | 'retry-double' | 'failed', value]
  const got = new Set(e0.got || []);
  rows.forEach((r, n) => {
    const i = idx[n];
    if (i < 0 || i >= e0.ids.length || got.has(i)) return;
    got.add(i);
    const res = r.result || {};
    if (res.type === 'succeeded') {
      const msg = res.message || {}, u = claudeUsage(msg.model || e0.model, msg.usage, true), text = textOf(msg);
      usage = { prompt: sum(usage.prompt, u.prompt), completion: sum(usage.completion, u.completion), cost: sum(usage.cost, u.cost),
        cached: (usage.cached || 0) + (u.cached || 0), cacheWrite: (usage.cacheWrite || 0) + (u.cacheWrite || 0), estimated: true };
      counted++;
      if (msg.stop_reason === 'refusal') return outcome.push([i, 'failed']);
      if (msg.stop_reason === 'max_tokens' && !text.trim()) return outcome.push([i, 'retry-double']);
      const record = records.get(e0.ids[i]);
      try { return outcome.push([i, record ? 'applied' : 'failed', record ? kind.parse(text, record, e0.ctx) : null]); }
      catch { return outcome.push([i, 'failed']); }
    }
    if (res.type === 'errored') {
      const type = String(res.error?.error?.type || res.error?.type || '');
      return outcome.push([i, /invalid_request/.test(type) ? 'failed' : 'retry']);
    }
    if (res.type === 'expired') return outcome.push([i, 'retry']);
    return outcome.push([i, 'failed']);   // canceled: the person stopped the run
  });
  if (!outcome.length) return;
  update(s => {
    const e = runs(s).find(x => x.id === id); if (!e) return s;
    const done = new Set(e.got || []);
    for (const [i, what, value] of outcome) {
      if (done.has(i)) continue;
      done.add(i);
      if (what === 'applied' && kind.apply(s, e.ids[i], value, e.ctx, e.model, at)) e.applied = (e.applied || 0) + 1;
      else if (what.startsWith('retry') && e.round === 1) (e.retry ||= []).push(what === 'retry-double' ? -1 - i : i);
      else e.failed = (e.failed || 0) + 1;
    }
    e.got = [...done];
    const t = e.usage ||= { prompt: 0, completion: 0, cost: 0 };
    t.prompt = sum(t.prompt, usage.prompt); t.completion = sum(t.completion, usage.completion); t.cost = sum(t.cost, usage.cost);
    return s;
  });
  if (counted) recordModelCall({ provider: 'anthropic', id: e0.profileId, model: e0.model }, usage, 'done', { prompt: null, task: `${e0.kind} batch` });
}

/** One run's state in words: applied of total, failed, and the cost at batch price when it is known. */
export function batchSummary(e) {
  if (!e) return '';
  const n = e.total || e.ids?.length || 0, cost = e.usage?.cost;
  return [`${e.applied || 0} of ${n}`, e.failed ? `${e.failed} failed` : '', cost != null ? `$${cost.toFixed(2)} at batch price` : ''].filter(Boolean).join(', ');
}

// ---- The run. ----

// Saved at once, not at the next debounced save: a batch id lost to a crash is a batch paid for and never read.
const saveNow = () => persist().catch(err => console.warn('[batch]', err?.message || err));
const transient = err => { err.transient = true; return err; };

async function follow(id, h, { io, sleep, now }) {
  let delay = FIRST_POLL, errors = 0;
  // Stop is the person's (the job's own flag); a project replaced or merged from disk only ends this window's following
  // (jobs.mjs stopped() says both): the run stays out and is followed again on the next open, never cancelled for it.
  const generation = projectGeneration();
  const stopAsked = () => !!jobs().find(j => j.id === h.id)?.stop;
  const moved = () => projectGeneration() !== generation;
  for (;;) {
    if (moved()) throw transient(new Error('The project changed; the batch is followed again when it is opened.'));
    const e = entryOf(id);
    if (!e || e.status !== 'pending') return batchSummary(e);
    if (e.owner !== WINDOW) return batchSummary(e);   // another window took the run over
    const cfg = cfgOf(e);
    if (stopAsked() && !e.cancelAsked) {
      // a cancel that fails is asked again on the next turn; the run is never left failed while its batch goes on
      const c = await io.send(cfg, 'cancel', e.batchId).catch(err => ({ status: 0, text: String(err?.message || err) }));
      if (c.status >= 200 && c.status < 300) patch(id, x => { x.cancelAsked = true; });
    }
    // a connection that failed (the shell's error, status 0) is as an overloaded API: asked again later
    const res = await io.send(cfg, 'status', e.batchId).catch(err => ({ status: 0, text: String(err?.message || err) }));
    if (!(res.status >= 200 && res.status < 300)) {
      // a key or batch the API no longer accepts ends the run; anything else is asked again, five times, and then the run waits
      // for the next open (it stays out, and the batch with it)
      if ([400, 401, 403, 404].includes(res.status)) throw claudeError(res.status, res.text);
      if (++errors > 5) { const err = res.status ? claudeError(res.status, res.text) : new Error(res.text); err.transient = true; throw err; }
      await sleep(delay, () => false); continue;
    }
    errors = 0;
    const b = JSON.parse(res.text), c = b.request_counts || {};
    const total = ['processing', 'succeeded', 'errored', 'canceled', 'expired'].reduce((a, k) => a + (c[k] || 0), 0);
    h.count(total - (c.processing || 0), total);
    patch(id, x => { x.seenAt = new Date(now()).toISOString(); });
    if (b.processing_status !== 'ended') {
      h.progress(`${e.round === 1 ? 'Batch' : 'Batch, sent again'}: ${total - (c.processing || 0)} of ${total} answered`);
      await sleep(delay, () => moved() || (stopAsked() && !entryOf(id)?.cancelAsked)); delay = Math.min(delay * 1.5, MAX_POLL);
      continue;
    }
    h.progress('Applying the answers');
    // A results download that fails (the connection, a timeout, a server error, lines missing) leaves the run out: the next
    // open reads the results again, and what was applied (`got`) is not applied or counted twice.
    let chain = Promise.resolve();
    const end = await io.results(cfg, e.batchId, lines => { chain = chain.then(() => applyLines(id, lines)); }).catch(err => { throw transient(err); });
    // an answer that cannot be applied now (the abstracts or a full text not read) leaves the run out too: the next open reads
    // the results again, and `got` keeps what was applied from being applied twice
    await chain.catch(err => { throw transient(err); });
    if (!(end.status >= 200 && end.status < 300)) { const err = claudeError(end.status, end.text); throw [401, 403, 404].includes(end.status) ? err : transient(err); }
    const after = entryOf(id);
    const retry = after.cancelAsked ? [] : after.retry || [];
    if (retry.length) {
      const indexes = retry.map(i => (i < 0 ? -1 - i : i)), doubled = new Set(retry.filter(i => i < 0).map(i => -1 - i));
      const sent = await submit(after, indexes, cfg, io, doubled);
      patch(id, x => {
        x.round = 2; x.retry = []; x.got = [];
        if (sent) { x.batchId = sent.batchId; x.expiresAt = sent.expiresAt; x.batches = [...(x.batches || []), sent.batchId]; x.failed = (x.failed || 0) + sent.missing; }
        else x.failed = (x.failed || 0) + indexes.length;
      });
      if (sent) { await saveNow(); delay = FIRST_POLL; continue; }
    }
    patch(id, x => { x.status = x.cancelAsked ? 'stopped' : 'done'; x.endedAt = new Date(now()).toISOString(); x.total = x.ids.length; delete x.ids; delete x.got; delete x.retry; if (x.ctx) delete x.ctx.items; });
    return batchSummary(entryOf(id));
  }
}

// the stage lets Screening find the run (views/screening.mjs batchOf): Propose is not offered twice and Stop is shown
const jobMeta = ctx => ({ batch: true, ...(ctx?.stage ? { stage: ctx.stage } : {}) });
const options = o => ({ io: o.io || shellIo, sleep: o.sleep || wait, now: o.now || Date.now });
const failRun = id => err => { patch(id, x => { if (x.status === 'pending' && !err?.transient && !/stopped/.test(String(err?.message))) { x.status = 'failed'; x.error = String(err?.message || err).slice(0, 300); x.endedAt = new Date().toISOString(); } }); throw err; };

/**
 * Starts a batch run of `kind` over `records` on the connection `cfg`, as a background job labelled `label`. The run is
 * recorded once the batch exists, so a failed send leaves nothing behind. Resolves to the job's summary.
 */
export async function startBatch(kind, cfg, records, ctx, { label, ...o } = {}) {
  const { io, sleep, now } = options(o);
  if (!KINDS[kind]) throw new Error(`No batch run of kind ${kind}.`);
  const id = `cb-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  following.add(id);
  return runJob(KINDS[kind].job, label, async h => {
    { const ready = whenReady(); if (ready) await ready; }   // the late abstracts: never sent on a title alone
    h.progress('Sending the batch');
    const entry = { id, kind, label, profileId: cfg.id, model: cfg.model, status: 'pending', createdAt: new Date(now()).toISOString(), round: 1,
      ids: records.map(r => r.id), ctx, got: [], retry: [], applied: 0, failed: 0, usage: { prompt: 0, completion: 0, cost: 0 }, owner: WINDOW };
    const sent = await submit(entry, entry.ids.map((_, i) => i), cfg, io);
    if (!sent) return '0 sent';
    update(s => {
      const done = runs(s).filter(e => e.status !== 'pending'), keep = new Set(done.slice(-KEEP).map(e => e.id));
      s.claudeBatches = [...runs(s).filter(e => e.status === 'pending' || keep.has(e.id)),
        { ...entry, failed: sent.missing, batchId: sent.batchId, batches: [sent.batchId], expiresAt: sent.expiresAt, seenAt: new Date(now()).toISOString() }];
      return s;
    }, { indexNeutral: true });
    await saveNow();
    return follow(id, h, { io, sleep, now }).catch(failRun(id));
  }, jobMeta(ctx)).finally(() => unfollow(id));
}

/**
 * Follows again every run the project still has out: on open (app.mjs), and after a window that held a run went quiet.
 * A run another window looked at in the last quarter hour is left to it and checked again when that time is up.
 */
export function resumeBatches(o = {}) {
  const opts = options(o), out = [];
  for (const e of runs(get()).filter(x => x.status === 'pending' && !following.has(x.id))) {
    const quiet = opts.now() - Date.parse(e.seenAt || 0);
    if (e.owner && e.owner !== WINDOW && quiet < STALE) { if (!o.once) setTimeout(() => resumeBatches(o), STALE - quiet + 1000); continue; }
    following.add(e.id);
    patch(e.id, x => { x.owner = WINDOW; });
    out.push(runJob(KINDS[e.kind]?.job || 'screen', `${e.label} (resumed)`, h => follow(e.id, h, opts).catch(failRun(e.id)), jobMeta(e.ctx))
      .catch(err => console.warn('[batch]', err?.message || err)).finally(() => unfollow(e.id)));
  }
  return Promise.all(out);
}

// Unanimity screening (plan §1.3: proposals only).
//
// The same records go through two or more configurations (different models
// and/or prompt variants; the caller passes them). A record every
// configuration proposes to include, or every one proposes to exclude, is
// routed 'auto': it may be shown as a PROPOSAL without asking a person to look
// at it first. Any disagreement, any 'uncertain' and any failed call routes it
// to a person. Nothing is decided here; the app never records a decision from
// this. Whether unanimity is more accurate than one model is NOT measured by
// this module: it changes what a person is asked to look at, and only a
// person's sample (screen-validation.mjs) says what it costs in lost evidence.
import { assessMany } from './helpers.mjs';

/**
 * records: [{ id, title, abstract }]; configs: two or more model configs.
 * With the default `assess`, each config runs through assessMany, which keeps
 * its per-record cache. A custom `assess(record, rules, cfg, { signal })` is
 * called directly (tests, prompt variants). Returns one row per record, in
 * order: { id, verdict, verdicts, unanimous, route } where `verdict` is the
 * shared verdict when unanimous, else null.
 */
export async function screenUnanimous(records, rules, configs, { assess = null, concurrency = 4, signal, onEach = () => {} } = {}) {
  if (!Array.isArray(configs) || configs.length < 2) throw new Error('Unanimity needs two or more model configurations');
  const verdicts = new Map(records.map(r => [r.id, Array(configs.length).fill(null)]));
  const emit = new Set();
  const settle = r => {
    const vs = verdicts.get(r.id); if (emit.has(r.id) || vs.some(v => v === null)) return;
    emit.add(r.id); onEach(r, row(r.id, vs));
  };
  await Promise.all(configs.map(async (cfg, i) => {
    if (!assess) {
      const byId = new Map(records.map(r => [r.id, r]));
      await assessMany(records, rules, cfg, { concurrency, signal, onEach: (r, a) => { verdicts.get(r.id)[i] = a && a.verdict ? a.verdict : 'error'; settle(byId.get(r.id)); } });
      return;
    }
    const queue = records.slice();
    const worker = async () => {
      while (queue.length && !signal?.aborted) {
        const r = queue.shift();
        let v = 'error';
        try { v = (await assess(r, rules, cfg, { signal }))?.verdict || 'error'; } catch { /* a failed call sends the record to a person */ }
        verdicts.get(r.id)[i] = v; settle(r);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, records.length)) }, worker));
  }));
  return records.map(r => row(r.id, verdicts.get(r.id).map(v => v ?? 'error')));
}

function row(id, vs) {
  const unanimous = vs.every(v => v === 'include') || vs.every(v => v === 'exclude');
  return { id, verdict: unanimous ? vs[0] : null, verdicts: vs, unanimous, route: unanimous ? 'auto' : 'person' };
}

const FATAL = /401|403|No model/;

/**
 * The proposals two configurations make for a batch, in the shape the screening view stores
 * (plan §1.3: a proposal, never a decision). A record both propose to include, or both to
 * exclude, carries that verdict; any other record is 'uncertain', which the person sees as
 * theirs to decide, with each model's own verdict kept in `unanimity`. Every record costs
 * one call per configuration. A record either call failed on gets no proposal and stays
 * outstanding; a credential failure ends the run with that error, as a single-model run does.
 *
 * `onEach(record, proposal)` is called as each record settles; `stop()` ends the run.
 */
export async function proposeUnanimous(records, rules, configs, { assess = null, stop = () => false, onEach = () => {}, concurrency = 4, now = () => new Date().toISOString() } = {}) {
  const one = assess || (await import('./assist.mjs')).assessRecord;
  const ac = new AbortController();
  const full = new Map();
  let fatal = null;
  const call = async (record, criteria, cfg, { signal }) => {
    if (stop()) { ac.abort(); throw new Error('stopped'); }
    try {
      const a = await one(record, criteria, cfg, { signal });
      full.set(`${configs.indexOf(cfg)}:${record.id}`, a);
      return a;
    } catch (err) {
      if (FATAL.test(String(err))) { fatal = err; ac.abort(); }
      throw err;
    }
  };
  await screenUnanimous(records, rules, configs, { assess: call, concurrency, signal: ac.signal, onEach: (record, row) => {
    if (ac.signal.aborted || row.verdicts.includes('error')) return;
    const mine = configs.map((_, i) => full.get(`${i}:${record.id}`)).filter(Boolean);
    const from = row.unanimous ? mine[0] : mine.find(a => a.verdict !== 'include') || mine[0];
    onEach(record, {
      verdict: row.unanimous ? row.verdict : 'uncertain', criteria: from?.criteria || [],
      model: configs.map(c => c.model).join(' + '), at: now(), tier: 'llm',
      unanimity: { models: configs.map(c => c.model), verdicts: row.verdicts, agreed: row.unanimous },
    });
  } });
  if (fatal) throw fatal;
}

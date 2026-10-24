// Model help for each step of the review.
//
// Every helper is one bounded call: short instructions, the project's own
// facts as the only material, a cap on output, JSON where the answer is
// structured. Each returns a proposal; the view shows it and a person accepts
// or discards it. Nothing here writes to the project (plan §6). Risk-of-bias
// judgements are deliberately absent (plan 1.3: no automatic appraisal).
import { complete, configured } from './ai.mjs';
import { assessRecord } from './assist.mjs';
import { structuredPatientRows } from './tabular.mjs';
import { MEASURES } from './effect-measures.mjs';
import { rulesKey } from './rules-key.mjs';
import { PROTOCOL_SUGGEST, EXTRACT_ABSTRACT, TEXT_DRAFT, PATIENTS_PARSE, fence } from './prompts.mjs';
import { clipAbstract } from './text-clip.mjs';

const need = cfg => { if (!configured(cfg)) throw new Error('No model configured for this task'); };
const jsonOf = out => { const m = String(out).match(/[\[{][\s\S]*[\]}]/); if (!m) throw new Error('No JSON in the reply'); return JSON.parse(m[0]); };

/** PICO and eligibility criteria proposed from what the protocol already says. */
export async function suggestProtocol(protocol, cfg, { signal } = {}) {
  need(cfg);
  const p = protocol || {}; const pico = p.pico || {};
  const given = [`Title: ${p.title || ''}`, ...Object.entries(pico).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ...(p.criteria || []).filter(c => c.text).map(c => `Criterion (${c.stage}): ${c.text}`)].join('\n');
  if (!given.replace('Title: ', '').trim()) throw new Error('Give the review a title first');
  const out = await complete(cfg, [
    { role: 'system', content: PROTOCOL_SUGGEST.text },
    { role: 'user', content: given.slice(0, 2000) },
  ], { signal, temperature: 0, json: true, prompt: PROTOCOL_SUGGEST });
  const j = jsonOf(out);
  return { pico: j.pico || {}, criteria: (j.criteria || []).filter(c => c && c.text).slice(0, 6)
    .map(c => ({ text: String(c.text).slice(0, 200), stage: /full/i.test(c.stage) ? 'Full text' : 'Title/abstract' })) };
}

// Text-model screening results this session, by what was sent: the same
// record under the same criteria and model is not asked twice.
const assessed = new Map();
const assessKey = (r, rules, cfg) => rulesKey(JSON.stringify([cfg.provider || '', cfg.model || '', r.title || '', (r.abstract || '').slice(0, 2500), rules.map(c => [c.id, c.text])]));
export const forgetAssessments = () => assessed.clear();

/**
 * Screening proposals for many records, one call each, in order, stopping
 * when asked. `onEach(record, proposal | error)` reports progress.
 */
export async function assessMany(records, rules, cfg, { onEach = () => {}, stop = () => false, signal, concurrency = 4 } = {}) {
  need(cfg);
  const out = []; const queue = records.slice(); let fatal = null;
  // A few in flight at once (plan 6.5: a user-approved batch within provider
  // rules); a credential failure stops every worker, a single bad record does not.
  const worker = async () => {
    while (queue.length && !fatal && !stop() && !signal?.aborted) {
      const r = queue.shift();
      try {
        const key = assessKey(r, rules, cfg);
        const a = assessed.get(key) || await assessRecord(r, rules, cfg, { signal });
        assessed.set(key, a); if (assessed.size > 5000) assessed.delete(assessed.keys().next().value);
        out.push({ id: r.id, ...a }); onEach(r, a);
      }
      catch (err) { onEach(r, err); if (/401|403|No model/.test(String(err))) fatal = err; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, records.length)) }, worker));
  if (fatal) throw fatal;
  return out;
}

/** Field values read from a record's title and abstract, each with the phrase it came from. */
export async function extractFromAbstract(record, fields, cfg, { signal } = {}) {
  need(cfg);
  const text = `${record.title || ''}\n\n${record.abstract || ''}`.trim();
  if (!record.abstract) throw new Error('No abstract on record');
  const list = fields.map(f => `- ${f.id} (${f.type}): ${f.label}${f.options?.length ? ` [${f.options.join(' | ')}]` : ''}`).join('\n');
  const out = await complete(cfg, [
    { role: 'system', content: EXTRACT_ABSTRACT.text(list) },
    { role: 'user', content: fence('record', `${record.title || ''}\n\n${clipAbstract(record.abstract || '', 6000)}`) },
  ], { signal, temperature: 0, json: true, prompt: EXTRACT_ABSTRACT });
  const got = jsonOf(out);
  // JSON mode returns an object; the array is its first array-valued member
  const arr = Array.isArray(got) ? got : Object.values(got || {}).find(Array.isArray) || [];
  const ids = new Set(fields.map(f => f.id));
  return arr.filter(x => x && ids.has(x.field) && x.value != null && String(x.value).trim())
    .map(x => ({ field: x.field, value: String(x.value).trim().slice(0, 300), quote: String(x.quote || '').trim().slice(0, 300) }))
    .filter(x => x.quote && text.toLowerCase().includes(x.quote.toLowerCase()));
}

/**
 * The pooled result as the lines a model is given, numbers formatted as the
 * view shows them. Exported so a caller can check a reply against exactly
 * these lines: a number the reply holds and they do not was made up.
 */
// The model a result came from, as a methods section names it.
export const modelName = method => (method === 'EE' ? 'common-effect (inverse-variance)' : method === 'DL' ? 'random-effects (DerSimonian–Laird)'
  : method === 'MH' ? 'common-effect (Mantel–Haenszel)' : method === 'PETO' ? "common-effect (Peto's one-step odds ratio)" : `random-effects (${method || 'REML'})`);
const common = a => a.method === 'EE' || a.method === 'MH' || a.method === 'PETO';
// How the result was reached beyond the model, as a methods sentence reports
// it: the Hartung–Knapp adjustment when used, and the zero-event handling
// (0.5 correction, studies with no events in either arm left out) as recorded.
const methodNotes = a => [
  !common(a) && a.test === 'knha' ? 'Confidence intervals used the Hartung–Knapp adjustment.' : '',
  a.zeroEvents ? `Zero events: ${String(a.zeroEvents).replace(/\.$/, '')}.` : '',
  // studies with several treated arms: the comparison chosen or the shared control split (Cochrane Handbook 23.3.4)
  a.multiArm ? `Multi-arm studies: ${String(a.multiArm).replace(/\.$/, '')}.` : '',
].filter(Boolean);

export function resultFacts(a) {
  const f = x => Number(x).toFixed(2);
  // A p value that rounds to 0.000 is reported as < 0.001, as a journal would.
  const p = x => Number(x) < 0.001 ? '< 0.001' : Number(x).toFixed(3);
  return [
    `Pooled ${a.measure}${a.outcomeName ? ` for ${a.outcomeName}` : ''} (${modelName(a.method)}${!common(a) && a.test === 'knha' ? ', Hartung–Knapp' : ''}, k = ${a.k}): ${f(a.estimate)} (95% CI ${f(a.lo)} to ${f(a.hi)})`,
    a.zeroEvents ? `Zero events: ${a.zeroEvents}` : '',
    a.multiArm ? `Multi-arm studies: ${a.multiArm}` : '',
    `I² ${Number(a.i2).toFixed(1)}%${common(a) ? '' : `, τ² ${Number(a.tau2).toFixed(4)}`}, Q ${f(a.q)} (p ${p(a.qp)})`,
    a.pi_lo != null ? `95% prediction interval ${f(a.pi_lo)} to ${f(a.pi_hi)}` : '',
    a.egger_z != null ? `Egger's test z ${f(a.egger_z)}, p ${p(a.egger_p)}${a.k < 10 ? ' (k < 10)' : ''}` : '',
    a.mod_kind === 'group' ? `Subgroups by ${a.moderatorLabel}: test for differences Q ${f(a.qm)} p ${p(a.qmp)}` : '',
    a.mod_kind === 'numeric' ? `Meta-regression on ${a.moderatorLabel}: ${a.measure} per unit ${f(a.slope)} (${f(a.slope_lo)} to ${f(a.slope_hi)}), p ${p(a.slope_p)}` : '',
    `Studies: ${(a.labels || []).join(', ')}`,
  ].filter(Boolean).join('\n');
}

/**
 * A results paragraph from the pooled numbers — the numbers as computed,
 * nothing added. Written from the numbers, not by a model: nothing to invent
 * and nothing to wait for. `cfg` and the options are accepted for callers
 * that pass them.
 */
export async function interpretResult(a, cfg, { signal } = {}) {
  const f = x => Number(x).toFixed(2);
  const numeric = ['k', 'estimate', 'lo', 'hi', 'i2', 'q', 'qp', ...(common(a) ? [] : ['tau2'])];
  const finite = x => x != null && x !== '' && Number.isFinite(Number(x));
  if (numeric.some(k => !finite(a[k])) || !String(a.method || '').trim() || !String(a.measure || '').trim())
    throw new Error('Analysis is missing a required result');
  const parts = [
    `${a.k} studies were pooled using a ${modelName(a.method)} model to estimate ${a.measure} ${f(a.estimate)} (95% CI ${f(a.lo)} to ${f(a.hi)}).`,
    `Heterogeneity was I² ${Number(a.i2).toFixed(1)}%${common(a) ? ',' : `, τ² ${Number(a.tau2).toFixed(4)},`} and Q ${f(a.q)} (p ${Number(a.qp).toFixed(3)}).`,
    ...methodNotes(a),
  ];
  if (finite(a.pi_lo) && finite(a.pi_hi)) parts.push(`The 95% prediction interval was ${f(a.pi_lo)} to ${f(a.pi_hi)}.`);
  if (finite(a.egger_z) && finite(a.egger_p)) parts.push(`Egger's test gave z ${f(a.egger_z)} (p ${Number(a.egger_p).toFixed(3)}${a.k < 10 ? '; fewer than 10 studies' : ''}).`);
  if (a.mod_kind === 'group' && finite(a.qm) && finite(a.qmp) && a.moderatorLabel) parts.push(`The subgroup test for ${a.moderatorLabel} gave Q ${f(a.qm)} (p ${Number(a.qmp).toFixed(3)}).`);
  if (a.mod_kind === 'numeric' && [a.slope, a.slope_p, a.slope_lo, a.slope_hi].every(finite) && a.moderatorLabel) parts.push(`Meta-regression on ${a.moderatorLabel} gave ${a.measure} per unit ${f(a.slope)} (95% CI ${f(a.slope_lo)} to ${f(a.slope_hi)}; p ${Number(a.slope_p).toFixed(3)}).`);
  return parts.join(' ');
}

/** A calculated results paragraph whose numbers remain linked to the analysis. */
export function linkedResultParagraph(a, prefix = 'pooled') {
  if (!a || !MEASURES.some(m => m.id === a.measure)) throw new Error('Run a pooled analysis first');
  return linkedPooledText(a).replace(/\{\{pooled\./g, `{{${prefix}.`);
}
function linkedPooledText(a) {
  const parts = [
    `Across {{pooled.k}} studies, the {{pooled.method}} pooled ${a.measure}${a.outcomeName ? ` for ${a.outcomeName.toLowerCase()}` : ''} was {{pooled.full}}.`,
    common(a) ? 'Heterogeneity was I² {{pooled.i2}} and Q {{pooled.q}} (p {{pooled.qp}}).' : 'Heterogeneity was I² {{pooled.i2}}, τ² {{pooled.tau2}}, and Q {{pooled.q}} (p {{pooled.qp}}).',
  ];
  if (a.pi_lo != null && a.pi_hi != null) parts.push('The 95% prediction interval was {{pooled.pi}}.');
  parts.push(...methodNotes(a));
  return parts.join(' ');
}

/** A section drafted from the project's own facts, to be edited, never final. */
export async function draftSection(name, facts, cfg, { signal, instructions = '' } = {}) {
  need(cfg);
  const guide = String(instructions || '').trim().slice(0, 1200);
  const out = await complete(cfg, [
    { role: 'system', content: TEXT_DRAFT.text(name) },
    { role: 'user', content: guide ? `Project facts:\n${fence('facts', String(facts).slice(0, 5000))}\n\nAdditional author instructions:\n${guide}` : fence('facts', String(facts).slice(0, 5000)) },
  ], { signal, temperature: 0.1, prompt: TEXT_DRAFT });
  return out.trim();
}

/** Patient rows read from pasted text (a table, a paragraph), in the review's columns. */
export async function parsePatients(text, columns, cfg, { signal, guard = '', brief = '' } = {}) {
  const direct = structuredPatientRows(text, columns);
  if (direct) { Object.defineProperty(direct, 'source', { value: 'table' }); return direct; }
  need(cfg);
  const cols = columns.map(c => `- ${c.id} (${c.type}${c.levels ? `: ${c.levels.join(' | ')}` : ''}): ${c.name}`).join('\n');
  const out = await complete(cfg, [
    { role: 'system', content: `${guard ? `${guard}\n` : ''}${PATIENTS_PARSE.text(cols)}` },
    { role: 'user', content: brief ? `${brief}\n\nText to read:\n${fence('pasted', String(text).slice(0, 8000))}` : fence('pasted', String(text).slice(0, 8000)) },
  ], { signal, temperature: 0, json: true, prompt: PATIENTS_PARSE });
  const j = jsonOf(out);
  const ids = new Set(columns.map(c => c.id));
  return (j.rows || []).filter(r => r && typeof r === 'object').slice(0, 200)
    .map(r => Object.fromEntries(Object.entries(r).filter(([k]) => ids.has(k))));
}

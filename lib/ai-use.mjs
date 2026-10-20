// The project's "AI use" record: what the app logged about model calls, put in
// the form a methods section or a journal's AI-disclosure statement asks for.
// It reads only what the app already recorded (state.aiCalls, aiCallTotals,
// aiModelTotals, aiOutcomes, proposals, values, aiValidation, aiUse) and
// invents nothing: what was not recorded stays "not recorded".
//
// The disclosures follow the shared items of the joint position statement of
// Cochrane, Campbell, JBI and CEE (2025) and of RAISE. PRISMA-trAIce is a
// proposal, not an endorsed standard.
//
// Pure over the state, except setAiUseNote, which writes through update().
import { update } from '../store.mjs';
import { promptById, promptRef } from './prompts.mjs';

export const NOT_RECORDED = 'not recorded';
export const NOTE_FIELDS = [['limitations', 'Limitations'], ['funding', 'Funding'], ['conflicts', 'Conflicts of interest'], ['other', 'Other notes']];
export const NOTE_MAX = 2000;
export const STANDARD_NOTE = 'PRISMA-trAIce is a proposal, not an endorsed standard.';

/** Stage of the review a prompt serves; anything not listed is "other". */
const STAGE_BY_PROMPT = {
  'screen.assess': 'screening', 'criteria.structure': 'screening',
  extract: 'extraction', 'extract.page': 'extraction', 'extract.abstract': 'extraction', 'patients.parse': 'extraction', 'cells.fix': 'extraction',
  'text.revise': 'drafting', 'text.draft': 'drafting', 'protocol.suggest': 'drafting',
  'query.draft': 'search',
  chat: 'chat', 'chat.summary': 'chat', 'run.summary': 'chat', 'sheet.ask': 'chat',
};
const STAGE_BY_TASK = { screen: 'screening', fill: 'extraction', extract: 'extraction', write: 'drafting', query: 'search', chat: 'chat', compact: 'chat', assess: 'appraisal', rob: 'appraisal' };
export const STAGES = ['screening', 'extraction', 'appraisal', 'drafting', 'search', 'chat', 'other'];
export function stageOf(id, task = '') {
  if (STAGE_BY_PROMPT[id]) return STAGE_BY_PROMPT[id];
  if (/^(rob|appraisal|assess)\b/.test(id)) return 'appraisal';
  return STAGE_BY_TASK[task] || 'other';
}

const day = at => /^\d{4}-\d{2}-\d{2}/.test(String(at || '')) ? String(at).slice(0, 10) : null;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function parseRef(ref) {
  const m = /^(.+?)@(\d+)#([0-9a-f]+)$/.exec(String(ref || ''));
  return m ? { id: m[1], version: Number(m[2]), hash: m[3] } : null;
}
const count = n => Number.isFinite(n) ? n : 0;

/** Every call, model and route, from the detailed log; totals from the counters. */
function modelSection(state) {
  const calls = state.aiCalls || [];
  const total = count(state.aiCallTotals?.calls);
  const trimmed = total > calls.length;
  const groups = new Map();
  for (const c of calls) {
    const route = c.route === 'local' || c.route === 'cloud' ? c.route : null;
    const k = JSON.stringify([c.model || '', c.provider || '', route]);
    const g = groups.get(k) || { model: c.model || NOT_RECORDED, provider: c.provider || NOT_RECORDED, route, first: null, last: null, calls: 0, failed: 0 };
    const d = day(c.at);
    if (d) { if (!g.first || d < g.first) g.first = d; if (!g.last || d > g.last) g.last = d; }
    g.calls++; if (c.status === 'failed') g.failed++;
    groups.set(k, g);
  }
  const totals = new Map((state.aiModelTotals || []).map(g => [`${g.model || ''}\n${g.provider || ''}`, count(g.calls)]));
  const rows = [...groups.values()].sort((a, b) => cmp(a.model, b.model) || cmp(a.provider, b.provider) || cmp(String(a.route), String(b.route))).map(g => ({
    ...g, route: g.route || NOT_RECORDED,
    // When the log was trimmed, the first date of what is left is not the first use.
    first: trimmed ? null : g.first, callsAll: trimmed ? (totals.get(`${g.model === NOT_RECORDED ? '' : g.model}\n${g.provider === NOT_RECORDED ? '' : g.provider}`) ?? null) : g.calls,
  }));
  const routes = { local: 0, cloud: 0, unknown: 0 };
  for (const c of calls) routes[c.route === 'local' || c.route === 'cloud' ? c.route : 'unknown']++;
  return { rows, total: Math.max(total, calls.length), detailed: calls.length, trimmed, routes, startedAt: day(state.aiUsageStartedAt) };
}

const paramsOf = p => ({ temperature: '0 (fixed in the code)', maxTokens: p.maxTokens ?? NOT_RECORDED, jsonMode: NOT_RECORDED, seed: 'not set' });
const templateOf = p => typeof p.text === 'function'
  ? { kind: 'function source', text: p.text.toString(), note: 'This prompt is built from the review\'s data by a function; the source of that function is given, not a rendered example.' }
  : { kind: 'text', text: String(p.text), note: '' };

function promptSection(state) {
  const groups = new Map();
  for (const c of state.aiCalls || []) {
    const ref = parseRef(c.prompt);
    const id = ref?.id || (c.task ? `(task: ${c.task})` : '(no prompt recorded)');
    const g = groups.get(id) || { id, stage: stageOf(ref?.id || '', c.task), calls: 0, versions: new Map(), tasks: new Set() };
    g.calls++; if (c.task) g.tasks.add(c.task);
    if (ref) { const k = `${ref.version}#${ref.hash}`; g.versions.set(k, { version: ref.version, hash: ref.hash, calls: (g.versions.get(k)?.calls || 0) + 1 }); }
    groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => b.calls - a.calls || cmp(a.id, b.id)).map(g => {
    const def = promptById(g.id);
    const current = def ? promptRef(def) : null;
    const versions = [...g.versions.values()].sort((a, b) => a.version - b.version || cmp(a.hash, b.hash)).map(v => {
      const same = !!current && current === `${g.id}@${v.version}#${v.hash}`;
      return { ...v, reproducible: same, status: same ? 'wording identical to this build' : 'the wording has changed since; this build cannot reproduce it' };
    });
    const out = { id: g.id, stage: g.stage, calls: g.calls, versions };
    if (versions.length === 0) out.note = 'No prompt reference was recorded for these calls.';
    const match = versions.find(v => v.reproducible);
    if (def && match) Object.assign(out, { template: templateOf(def), parameters: paramsOf(def) });
    return out;
  });
}

const DECIDED = { include: 'include', exclude: 'exclude' };
function proposalAgreement(state, stage, decisions) {
  const t = { stage, proposals: 0, agreed: 0, different: 0, undecided: 0, noVerdict: 0 };
  for (const [id, p] of Object.entries(state.proposals?.[stage] || {})) {
    if (!p || typeof p !== 'object') continue;
    t.proposals++;
    // Two-model proposals (lib/screen-unanimity.mjs): each record went to both models, and a record they disagree on is uncertain.
    if (Array.isArray(p.unanimity?.models)) {
      const u = t.twoModels ||= { records: 0, agreed: 0, disagreed: 0, models: [] };
      u.records++; if (p.unanimity.agreed) u.agreed++; else u.disagreed++;
      for (const m of p.unanimity.models) if (m && !u.models.includes(m)) u.models.push(m);
    }
    const v = DECIDED[p.verdict];
    if (!v) { t.noVerdict++; continue; }
    const h = DECIDED[decisions?.[id]?.decision];
    if (!h) t.undecided++; else if (h === v) t.agreed++; else t.different++;
  }
  return t;
}

function oversightSection(state) {
  const kinds = Object.entries(state.aiOutcomes?.byKind || {}).sort(([a], [b]) => cmp(a, b)).map(([kind, k]) => ({ kind, accepted: count(k.accepted), edited: count(k.edited), discarded: count(k.discarded) }));
  const screening = [proposalAgreement(state, 'ta', state.screening), proposalAgreement(state, 'ft', state.fulltext)].filter(t => t.proposals);
  let modelValues = 0, verified = 0;
  for (const v of Object.values(state.values || {})) {
    if (!v || !String(v.extractor || '').startsWith('model:')) continue;
    modelValues++; if (v.verification === 'verified') verified++;
  }
  // changes the assistant proposed and a person accepted are logged one by one with the model and the prompt version (lib/changes.mjs)
  return { outcomes: kinds, screening, extraction: { modelValues, verified, notVerified: modelValues - verified }, assistantChangesLogged: count((state.aiChanges || []).length) };
}

const METRICS = ['sensitivity', 'specificity', 'recall', 'precision', 'agreement', 'kappa', 'accuracy', 'workSaved'];
function validationSection(state) {
  const v = state.aiValidation?.screening;
  const stages = ['ta', 'ft'].map(stage => {
    const r = v && typeof v === 'object' ? v[stage] : null;
    if (!r || typeof r !== 'object') return { stage, done: false };
    const metrics = {};
    for (const [k, val] of Object.entries(r)) if (METRICS.includes(k) && (typeof val === 'number' || (typeof val === 'string' && val))) metrics[k] = val;
    return { stage, done: true, at: day(r.at), n: Number.isFinite(r.n) ? r.n : null, metrics };
  });
  return { screening: stages };
}

const clean = t => String(t ?? '').slice(0, NOTE_MAX);
export const aiUseNotes = state => Object.fromEntries(NOTE_FIELDS.map(([k]) => [k, clean(state.aiUse?.[k])]));

/** Write one of the person's free-text fields. */
export function setAiUseNote(field, text) {
  if (!NOTE_FIELDS.some(([k]) => k === field)) throw new Error(`Unknown AI-use field: ${field}`);
  update(s => { s.aiUse = { ...(s.aiUse || {}), [field]: clean(text) }; return s; });
}

export function aiUseRecord(state) {
  const models = modelSection(state);
  return {
    used: models.total > 0,
    standardNote: STANDARD_NOTE,
    models,
    prompts: promptSection(state),
    oversight: oversightSection(state),
    validation: validationSection(state),
    localOnlySetting: !!state.settings?.aiLocalOnly,
    notes: aiUseNotes(state),
  };
}

// ---- display and export --------------------------------------------------------
const STAGE_NAME = { ta: 'Title and abstract', ft: 'Full text' };
const cell = v => v == null || v === '' ? NOT_RECORDED : String(v);
const noun = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Tables as { id, title, head, rows, note }. */
export function aiUseRows(state) {
  const r = aiUseRecord(state), out = [];
  if (!r.used) return out;
  const m = r.models;
  out.push({ id: 'models', title: 'Models', head: m.trimmed ? ['Model', 'Provider', 'Route', 'Last used', 'Calls in detail', 'All calls', 'Failed in detail'] : ['Model', 'Provider', 'Route', 'First used', 'Last used', 'Calls', 'Failed'],
    rows: m.rows.map(x => m.trimmed ? [x.model, x.provider, x.route, cell(x.last), x.calls, cell(x.callsAll), x.failed] : [x.model, x.provider, x.route, cell(x.first), cell(x.last), x.calls, x.failed]),
    note: m.trimmed ? `Per-call detail covers only the most recent ${m.detailed} of ${m.total} calls; earlier dates are not recorded.` : '' });
  out.push({ id: 'prompts', title: 'Prompts', head: ['Prompt', 'Stage', 'Calls', 'Versions seen', 'Wording'],
    rows: r.prompts.map(p => [p.id, p.stage, p.calls, p.versions.map(v => `v${v.version} #${v.hash}`).join(', ') || NOT_RECORDED,
      p.versions.length ? p.versions.map(v => v.reproducible ? 'reproducible' : 'changed since').join(', ') : NOT_RECORDED]), note: '' });
  const o = r.oversight;
  const human = [];
  for (const k of o.outcomes) human.push([`Proposals: ${k.kind}`, `${k.accepted} accepted, ${k.edited} edited, ${k.discarded} discarded`]);
  for (const s of o.screening) human.push([`Screening: ${STAGE_NAME[s.stage]}`, `${s.agreed} agreed with the reviewer, ${s.different} different, ${s.undecided} not yet decided${s.noVerdict ? `, ${s.noVerdict} without include or exclude` : ''}`]);
  for (const s of o.screening) if (s.twoModels) human.push([`Two-model screening: ${STAGE_NAME[s.stage]}`, `${s.twoModels.records} records, each assessed by ${s.twoModels.models.join(' and ')} (two calls per record); both proposed include or both exclude for ${s.twoModels.agreed}; ${s.twoModels.disagreed} left uncertain for a person`]);
  if (o.assistantChangesLogged) human.push(['Assistant changes accepted (log holds the latest 1000)', `${o.assistantChangesLogged}, each logged with the model and prompt version`]);
  human.push(['Extracted values from a model', o.extraction.modelValues ? `${o.extraction.verified} of ${o.extraction.modelValues} verified by a person` : 'none']);
  out.push({ id: 'oversight', title: 'Human oversight', head: ['Item', 'Count'], rows: human, note: '' });
  out.push({ id: 'validation', title: 'Validation on a sample from this review', head: ['Stage', 'Status'],
    rows: r.validation.screening.map(v => [STAGE_NAME[v.stage], v.done ? [v.at && `done ${v.at}`, v.n != null && `n = ${v.n}`, ...Object.entries(v.metrics).map(([k, x]) => `${k} ${x}`)].filter(Boolean).join(', ') || 'done' : 'not done']), note: '' });
  return out;
}

const esc = t => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = t => `| ${t.head.join(' | ')} |\n|${t.head.map(() => '---').join('|')}|\n${t.rows.map(r => `| ${r.map(esc).join(' | ')} |`).join('\n')}`;

export function aiUseMethodsText(state) {
  const r = aiUseRecord(state);
  if (!r.used) return 'No AI model was used in this review.';
  const m = r.models, para = [];
  const list = m.rows.map(x => `${x.model} (${x.provider}, ${x.route === NOT_RECORDED ? 'route not recorded' : `${x.route} route`}${x.last ? `, last used ${x.last}` : ''})`);
  const seen = [...new Set(list)];
  const span = m.trimmed ? `The log holds the dates of the most recent ${m.detailed} of ${m.total} calls` : m.rows.some(x => x.first) ? (a => a[0] === a[1] ? `Calls were made on ${a[0]}` : `Calls were made between ${a[0]} and ${a[1]}`)([m.rows.map(x => x.first).filter(Boolean).sort()[0], m.rows.map(x => x.last).filter(Boolean).sort().pop()]) : '';
  const route = m.routes.cloud ? `${noun(m.routes.cloud, 'call')} went to a cloud provider${m.routes.local ? ` and ${m.routes.local} stayed on this computer` : ''}` : m.routes.local && !m.routes.unknown ? 'All calls stayed on this computer (local models)' : `The route of ${noun(m.routes.unknown, 'call')} was not recorded`;
  para.push(`AI language models were used through the Lykos application: ${seen.join('; ')}. ${noun(m.total, 'model call')} ${m.total === 1 ? 'was' : 'were'} logged. ${route}.${span ? ` ${span}.` : ''}`);
  if (r.localOnlySetting) para[0] += ' The project was set to allow local models only.';
  if (r.prompts.length) {
    const byStage = {};
    for (const p of r.prompts) (byStage[p.stage] ||= []).push(p);
    const parts = STAGES.filter(s => byStage[s]).map(s => `${s} (${byStage[s].map(p => `${p.id.startsWith('(') ? 'calls without a recorded prompt' : p.id}${p.versions.length ? ` ${p.versions.map(v => `v${v.version}`).join('/')}` : ''}, ${noun(p.calls, 'call')}`).join('; ')})`);
    para.push(`Purposes and prompts, by stage: ${parts.join('; ')}. Each prompt is identified by its identifier, version and hash in the supplementary AI-use record.`);
  }
  const o = r.oversight, h = [];
  for (const s of o.screening) h.push(`${STAGE_NAME[s.stage].toLowerCase()} screening: of ${noun(s.proposals, 'model proposal')}, ${s.agreed} matched the reviewer's decision, ${s.different} differed and ${s.undecided} had no reviewer decision`);
  for (const s of o.screening) if (s.twoModels) h.push(`${STAGE_NAME[s.stage].toLowerCase()} screening used two models on ${noun(s.twoModels.records, 'record')} (${s.twoModels.models.join(' and ')}): both proposed include or both exclude for ${s.twoModels.agreed}, and the other ${s.twoModels.disagreed} were left uncertain for a person, at twice the calls of one model`);
  const t = o.outcomes.reduce((a, k) => ({ a: a.a + k.accepted, e: a.e + k.edited, d: a.d + k.discarded }), { a: 0, e: 0, d: 0 });
  if (o.outcomes.length) h.push(`of the model output people acted on, ${t.a} ${t.a === 1 ? 'item was' : 'items were'} accepted, ${t.e} edited and ${t.d} discarded`);
  if (o.extraction.modelValues) h.push(`${o.extraction.verified} of ${noun(o.extraction.modelValues, 'model-extracted value')} ${o.extraction.verified === 1 ? 'was' : 'were'} verified by a person`);
  para.push(h.length ? `Human oversight: ${h.join('; ')}.` : 'No accepted, edited or discarded model output was recorded.');
  const vs = r.validation.screening.filter(v => v.done);
  para.push(vs.length ? `Validation on a sample from this review was done for ${vs.map(v => `${STAGE_NAME[v.stage].toLowerCase()} screening${v.n != null ? ` (n = ${v.n})` : ''}`).join(' and ')}.` : 'No validation of model performance on a sample from this review was recorded.');
  if (r.notes.limitations.trim()) para.push(`Limitations: ${r.notes.limitations.trim()}`);
  return para.join('\n\n');
}

export function aiUseMarkdown(state) {
  const r = aiUseRecord(state);
  const parts = ['# AI use', '', `_${STANDARD_NOTE} The record lists what the application logged; values not logged are shown as "${NOT_RECORDED}"._`, '', '## Methods text', '', aiUseMethodsText(state)];
  for (const t of aiUseRows(state)) {
    parts.push('', `## ${t.title}`, '', table(t));
    if (t.note) parts.push('', t.note);
  }
  if (r.used) {
    parts.push('', '## Prompt templates');
    const shown = r.prompts.filter(p => p.template);
    if (!shown.length) parts.push('', 'No recorded prompt matches the wording of this build, so no template text is reproduced.');
    for (const p of r.prompts) {
      parts.push('', `### ${p.id}`, '');
      if (p.template) parts.push(`Parameters: temperature ${p.parameters.temperature}; maximum output tokens ${p.parameters.maxTokens}; JSON mode ${p.parameters.jsonMode}; seed ${p.parameters.seed}.`, '', p.template.note || 'Template text:', '', '```', p.template.text, '```');
      else parts.push(p.versions.some(v => !v.reproducible) ? 'The wording has changed since these calls; this build cannot reproduce it.' : (p.note || 'No template is registered under this identifier in this build.'));
    }
  }
  const filled = NOTE_FIELDS.filter(([k]) => r.notes[k].trim());
  if (filled.length) for (const [k, label] of filled) parts.push('', `## ${label}`, '', r.notes[k].trim());
  return parts.join('\n') + '\n';
}

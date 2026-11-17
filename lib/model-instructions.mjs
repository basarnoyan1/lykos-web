// The instructions given to models, and the runs that used them (2 Nov 2026). A model's screening, extraction or risk-of-bias decision
// should say what it was told: the brief or prompt, the model and its version, when. The app's own model calls name their built-in prompt
// by id, version and hash (s.aiCalls, lib/ai-use.mjs); work done outside the app (an agent's screening rounds with a written brief, a
// command-line sweep) is recorded here, in the project, so the record's decision detail and the AI-use statement can show it.
//
//   s.modelInstructions = { v: 1,
//     items: { [id]: { id, name, stage, text, hash, file?, fileAt?, reconstructed?, how?, at, by } },
//     runs:  { [id]: { id, instruction, stage, name?, models: [{ name, version?, from? }], records: [ids], at?, by?, file?, reconstructed?, how? } } }
//
// stage: ta | ft (screening at title and abstract, full text), extraction, rob (risk of bias), eligibility, other. An instruction's id is
// its text's fingerprint, so the same brief used in two rounds is one instruction with two runs. `reconstructed` marks what was read back
// from files after the work (a BRIEF.md beside the decisions it produced), not recorded when the model ran; the detail and the statement
// say so. Pure: state in, state or facts out.
import { fingerprint } from './fingerprint.mjs';

export const STAGES = Object.freeze(['ta', 'ft', 'extraction', 'rob', 'eligibility', 'other']);
export const STAGE_NAME = Object.freeze({ ta: 'Title and abstract screening', ft: 'Full-text screening', extraction: 'Data extraction and checking', rob: 'Risk of bias', eligibility: 'Eligibility review', other: 'Other' });
const str = v => (v == null ? '' : String(v));
export const instructionId = text => `ins-${fingerprint(str(text))}`;

const store = s => (s.modelInstructions && typeof s.modelInstructions === 'object' ? s.modelInstructions : null);
export const instructionsOf = s => Object.values(store(s)?.items || {});
export const runsOf = s => Object.values(store(s)?.runs || {}).sort((a, b) => str(a.at).localeCompare(str(b.at)) || str(a.id).localeCompare(str(b.id)));
export const instructionById = (s, id) => store(s)?.items?.[id] || null;

const ensure = st => {
  st.modelInstructions = { v: 1, items: {}, runs: {}, ...(st.modelInstructions || {}) };
  st.modelInstructions.items = { ...st.modelInstructions.items }; st.modelInstructions.runs = { ...st.modelInstructions.runs };
  return st.modelInstructions;
};
/** Records an instruction (the same text again is the same instruction: its fields are kept, a new file noted). Returns its id. */
export function putInstruction(st, { name, stage = 'other', text, file = '', fileAt = '', reconstructed = false, how = '', at = new Date().toISOString(), by = '' }) {
  const t = str(text);
  if (!t.trim()) throw new Error('an instruction needs its text');
  if (!STAGES.includes(stage)) throw new Error(`stage is ${STAGES.join(', ')}`);
  const v = ensure(st), id = instructionId(t), was = v.items[id];
  v.items[id] = was ? { ...was, files: [...new Set([...(was.files || [was.file].filter(Boolean)), file].filter(Boolean))] }
    : { id, name: str(name).trim() || STAGE_NAME[stage], stage, text: t, hash: id.slice(4), ...(file ? { file, files: [file] } : {}), ...(fileAt ? { fileAt } : {}),
      ...(reconstructed ? { reconstructed: true } : {}), ...(how ? { how: str(how) } : {}), at, ...(by ? { by } : {}) };
  return id;
}
/** Records a run of a model under an instruction: the records it decided, the models (name and version as known). */
export function putRun(st, { id = '', instruction, stage, name = '', models = [], records = [], at = '', by = '', file = '', reconstructed = false, how = '' }) {
  const v = ensure(st);
  if (!v.items[instruction]) throw new Error(`no instruction ${instruction}`);
  const st2 = stage || v.items[instruction].stage;
  if (!STAGES.includes(st2)) throw new Error(`stage is ${STAGES.join(', ')}`);
  const rid = id || `run-${fingerprint([instruction, st2, file, [...records].sort()])}`;
  v.runs[rid] = { id: rid, instruction, stage: st2, ...(name ? { name } : {}), models: (models || []).map(m => (typeof m === 'string' ? { name: m } : { ...m })).filter(m => m.name || m.notRecorded),
    records: [...new Set(records.map(str))], ...(at ? { at } : {}), ...(by ? { by } : {}), ...(file ? { file } : {}), ...(reconstructed ? { reconstructed: true } : {}), ...(how ? { how } : {}) };
  return rid;
}

// which runs decided a record at a stage, indexed once per runs object
const index = new WeakMap();
const keyOf = (stage, id) => `${stage}\n${id}`;
/** The runs that decided a record at a stage, each with its instruction: [{ run, instruction }]. */
export function runsFor(s, stage, recordId) {
  const runs = store(s)?.runs;
  if (!runs) return [];
  let ix = index.get(runs);
  if (!ix) {
    ix = new Map();
    for (const r of Object.values(runs)) for (const id of r.records || []) { const k = keyOf(r.stage, id); if (!ix.has(k)) ix.set(k, []); ix.get(k).push(r); }
    index.set(runs, ix);
  }
  const own = stage === 'ta' || stage === 'ft' ? modelsInNotes(s, stage, [recordId]) : null;
  // the record's own note decides when it names a model, or when the run's models were counted from the notes; a run recorded by hand speaks for all
  const mine = run => own && (own.length || (run.models || []).some(m => Number.isFinite(m.records)));
  return (ix.get(keyOf(stage, recordId)) || []).map(run => ({ run, instruction: instructionById(s, run.instruction), ...(mine(run) ? { recordModels: own } : {}) })).filter(x => x.instruction);
}
/** A model as the record names it: "Claude (version not recorded)", "Claude Opus", "GPT-5 (2025-08-07)", "no model named". */
export const modelLabel = m => (m.notRecorded ? 'no model named' : `${m.name}${m.version ? ` (${m.version})` : m.versionRecorded === false ? ' (version not recorded)' : ''}`);
const andList = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
/**
 * The models of a run or an instruction in words. Models counted per record (records: n, as modelsInNotes counts them) say how many
 * records each names: "Claude (version not recorded) in 20,455 records, Claude Opus in 1 record and Claude Sonnet in 1 record";
 * otherwise "Claude Opus and Claude Sonnet", or "model not recorded".
 */
export const modelsText = models => {
  const list = (models || []).filter(m => m && (m.name || m.notRecorded));
  if (list.some(m => Number.isFinite(m.records))) {
    const by = new Map();
    for (const m of list) by.set(modelLabel(m), (by.get(modelLabel(m)) || 0) + (Number(m.records) || 0));
    const rows = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return rows.length ? andList(rows.map(([l, n]) => `${l} in ${n.toLocaleString('en')} ${n === 1 ? 'record' : 'records'}`)) : 'model not recorded';
  }
  const names = [...new Set(list.map(modelLabel))];
  return names.length ? andList(names) : 'model not recorded';
};
/** One line for a record's decision detail: what the model was told, by whom, and whether it was recorded or read back from files. */
export function runLine({ run, instruction, recordModels }) {
  const when = str(run.at).slice(0, 10);
  const src = instruction.reconstructed ? `reconstructed from ${instruction.file || 'files'}` : 'recorded with the run';
  // a record's own line names the models its own note names, not the run's
  const models = recordModels ? (recordModels.length ? modelsText(recordModels.map(({ records, ...m }) => m)) : 'no model named in its note') : modelsText(run.models);
  return `${instruction.name}${when ? `, ${when}` : ''}; ${models}; ${src}`;
}

/**
 * For the AI-use statement: each instruction with its runs, the records they decided and the models, by stage:
 * [{ id, name, stage, stageName, runs, records, models, reconstructed, file, text, hash }].
 */
export function instructionsUsed(s) {
  const out = [];
  for (const ins of instructionsOf(s)) {
    const runs = runsOf(s).filter(r => r.instruction === ins.id), records = new Set(), models = [];
    for (const r of runs) { for (const id of r.records || []) records.add(`${r.stage}\n${id}`); for (const m of r.models || []) {
      const was = models.find(x => x.name === m.name && x.version === m.version && x.versionRecorded === m.versionRecorded && Boolean(x.notRecorded) === Boolean(m.notRecorded));
      if (!was) models.push({ ...m }); else if (Number.isFinite(m.records)) was.records = (was.records || 0) + m.records;
    } }
    out.push({ id: ins.id, name: ins.name, stage: ins.stage, stageName: STAGE_NAME[ins.stage] || ins.stage, runs: runs.length, records: records.size, models,
      reconstructed: Boolean(ins.reconstructed), file: ins.file || '', files: ins.files || [], text: ins.text, hash: ins.hash, how: ins.how || '' });
  }
  return out.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.name.localeCompare(b.name));
}

// ---- reading briefs back from a folder of work files ---------------------------------------------------------------------------------
/** Whether a file name is an instruction given to a model (BRIEF.md, prompt.md, instructions.txt, …). */
export const isBriefName = name => /^(brief|prompt|instructions?|system[-_ ]?prompt)([-_ .][^/]*)?\.(md|txt)$/i.test(str(name)) || /[-_ ](brief|prompt)\.(md|txt)$/i.test(str(name));
/** The stage a brief serves, from its folder's name and its first lines. */
export function stageOfBrief(folder, text) {
  const f = str(folder).toLowerCase(), head = str(text).slice(0, 400).toLowerCase();
  // the folder's name first (a value review's brief speaks of full texts), then the brief's own opening
  const byFolder = [[/(^|[-_/])rob([-_/]|$)|risk.of.bias/, 'rob'], [/(^|[-_/])ta[-_]|title.?abstract/, 'ta'], [/(^|[-_/])ft[-_]|full.?text/, 'ft'],
    [/value|extract/, 'extraction'], [/eligib/, 'eligibility']].find(([re]) => re.test(f));
  if (byFolder) return byFolder[1];
  const byHead = [[/risk of bias|rob 2/, 'rob'], [/title and abstract|title\/abstract/, 'ta'], [/extract|value review/, 'extraction'], [/eligibility/, 'eligibility'], [/full.text screening/, 'ft']].find(([re]) => re.test(head));
  return byHead ? byHead[1] : 'other';
}
/** A brief's name: its first heading, else the file's folder. */
export const briefName = (text, folder) => (/^#\s+(.+)$/m.exec(str(text)) || [])[1]?.trim() || `Instructions in ${folder}`;
/**
 * The record ids a run's output files name: the keys (or `id`/`paper` fields) of each JSON file beside the brief that are records of the
 * project (by id, else by label). `files` is [{ name, json }].
 */
export function recordsInOutputs(s, files) {
  const ids = new Set((s.papers || []).map(p => p.id)), byLabel = new Map((s.papers || []).filter(p => p.label).map(p => [str(p.label).toLowerCase(), p.id]));
  const found = new Set();
  const take = k => { const t = str(k); if (ids.has(t)) found.add(t); else if (byLabel.has(t.toLowerCase())) found.add(byLabel.get(t.toLowerCase())); };
  for (const { json } of files) {
    if (Array.isArray(json)) { for (const x of json) if (x && typeof x === 'object') take(x.id || x.paper || x.record || x.study || ''); continue; }
    if (json && typeof json === 'object') for (const k of Object.keys(json)) take(k);
  }
  return [...found];
}
// a model family as a note names it, with the tier and version it gives ("Claude Opus 4.5", "GPT-5", "Claude A" is Claude, reviewer A)
const MODEL_IN_TEXT = /\b(Claude|ChatGPT|GPT|Codex|Gemini|DeepSeek|Llama|Mistral|Qwen)(?:[\s-]+(Opus|Sonnet|Haiku|Pro|Flash|mini))?(?:[\s-]?(\d+(?:[.-]\d+)*[a-z]?))?\b/gi;
const FAMILY = { claude: 'Claude', chatgpt: 'ChatGPT', gpt: 'GPT', codex: 'Codex', gemini: 'Gemini', deepseek: 'DeepSeek', llama: 'Llama', mistral: 'Mistral', qwen: 'Qwen' };
/** The models one note names: [{ name, version?, versionRecorded }], once each ("Reviewer A (Claude Opus)" is Claude Opus). */
export function modelsOfNote(note) {
  const out = new Map(), text = str(note);
  const named = [...text.matchAll(/Reviewer [AB] \(([^)]{3,40})\)/g)].map(m => m[1]);
  for (const part of named.length ? named : [text]) for (const m of part.matchAll(MODEL_IN_TEXT)) {
    const tier = m[2] ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : '', family = FAMILY[m[1].toLowerCase()];
    const name = family === 'GPT' && m[3] ? `GPT-${m[3]}` : `${family}${tier ? ` ${tier}` : ''}`, version = family === 'GPT' ? '' : m[3] || '';
    const recorded = Boolean(tier || version || (family === 'GPT' && m[3]));
    const k = `${name}\n${version}`;
    if (!out.has(k)) out.set(k, { name, ...(version ? { version } : {}), versionRecorded: recorded });
  }
  // "Claude" beside "Claude Opus" in the same note is the same model, not a second one whose version is unknown
  const vals = [...out.values()];
  return vals.filter(m => m.versionRecorded || !vals.some(o => o !== m && o.versionRecorded && o.name.startsWith(m.name)));
}
/**
 * The models a stage's decisions name in their notes for these records, counted per record: [{ name, version?, versionRecorded, records,
 * from }], most records first, and { notRecorded: true, records } for the records whose note names no model.
 */
export function modelsInNotes(s, stage, records) {
  const key = stage === 'ft' ? 'fulltext' : 'screening', counts = new Map();
  let none = 0;
  for (const id of records) {
    const ms = modelsOfNote(s[key]?.[id]?.note);
    if (!ms.length) { none++; continue; }
    for (const m of ms) { const k = `${m.name}\n${m.version || ''}\n${m.versionRecorded}`; const c = counts.get(k) || { ...m, records: 0, from: 'the decisions\' notes' }; c.records++; counts.set(k, c); }
  }
  const out = [...counts.values()].sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
  return none && out.length ? [...out, { name: '', notRecorded: true, records: none, from: 'the decisions\' notes' }] : out;
}

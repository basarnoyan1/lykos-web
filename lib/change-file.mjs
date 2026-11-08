// A change file: how an agent (Claude or another) changes a project's data without a script of its own. The agent writes one JSON file
// and applies it with the `lykos` command line (cli/, Rust: `lykos apply <folder> <file>`) or, where that is not installed,
// `node tools/lykos-apply.mjs <folder> <file>`: under the project lock, with the editing card up (lib/agent-activity.mjs), a copy of the
// project in .lykos/backups first, and a record in .lykos/inbox/applied/ (`--undo` takes it back). The two tools apply the same ops with
// the same messages (cli/tests/golden.mjs). Pure of the store and the DOM: `applyChanges(state, file)` returns the next state or the errors.
//
//   { "kind": "lykos-changes", "v": 1, "by": "Claude", "what": "Hudson 2011 arm size", "changes": [ { "op": "set_value", ... }, ... ] }
//
// Every change applies or none does. Ops (CHANGE_FILE_OPS below documents each one's fields):
//   set_value, remove_value, set_prisma, set_protocol, set_criterion, add_amendment, add_task, update_task, remove_notes, remove_results, move_file, attach_pdf, screen, appraise, merge_records, distinct_records,
//   update_record, set_arm_facets, fill_arm_facets, set_overlap, renumber_studies, report_of, not_retrieved, set_journal, set_eligibility_rules, put_value, add_note, set_if, settle_value, set_item_text,
//   log_search, update_search, set_scenario, assign_run, propose_outcome_rows, accept_outcome_rows, decide_scale, put_instrument, put_crosswalk, set, unset
//   (decide_scale, put_instrument and put_crosswalk, 7 Nov 2026, Scales' decisions and the project's scales and crosswalks; Node applies them)
//   (put_records and remove_records, 31 Oct 2026, a list of records changed record by record; not in the Rust `lykos apply`: Node applies them)
//   (set_scenario and assign_run, 1 Nov 2026, a protocol scenario and its runs, and `screen` with `scenario` into its overlay; not in the
//   Rust `lykos apply` either)
//   (save_output, 3 Nov 2026, a table or figure spec saved as the app saves an accepted proposal; the Rust `lykos apply` hands it to Node;
//   the MCP's save_output writes one when the app is not connected: tools/mcp/outputs.mjs)
//   (log_search and update_search, 31 Oct 2026, a search run and its database, version and warnings; not in the Rust `lykos apply`)
//   (add_note, set_if and settle_value, 28 Oct 2026, never write over newer work: lykos-import's risk-of-bias imports and lykos verify
//   propose-derivations write them; the Rust `lykos apply` lacks them too)
//   (the six before set, 28 Oct 2026, are not in the Rust `lykos apply` either: tools/lykos-apply.mjs applies them)
//   set_item_text {item: Package item id, label ("Table 2", "Figure S1") or title, field: title | legend | caption | notes, text}: a Package
//   item's own words, checked against its kind (notes are a table's; a figure has a title and a legend; caption is the legend, the text after
//   the label and title); before (28 Oct 2026) an agent wrote them by a raw `set` path into package.items
//   (screen, appraise and the duplicates' two, 2026-10-25, record a decision as the Screening, Appraisal and Duplicates views do, through lib/screen.mjs, lib/rob-review.mjs and lib/dedup-core.mjs;
//   the Rust `lykos apply` does not have them, so a change file with them goes through tools/lykos-apply.mjs; nor convert_item, 2026-10-26,
//   a Package figure made a table or a table a figure through lib/package.mjs convertItem)

import { lib_screen$applyDecision as applyDecision, lib_screen$STAGES as STAGES } from "../boot.mjs";
import { lib_rob_review$setAnswer as setAnswer, lib_rob_review$secondOn as secondOn, lib_rob_review$modelOn as modelOn, lib_rob_review$STUDY as STUDY } from "../boot.mjs";
import { schema$allTools as allTools, schema$appraisalTool as appraisalTool } from "../boot.mjs";
import { markDistinctIn } from './dedup-core.mjs';
import { mergeRecords } from './dedup-merge.mjs';
import { convertItem, labels } from './package.mjs';
import { readRules } from './eligibility-review.mjs';
import { isIdLabel } from './id-column.mjs';
import { setJournals } from './journal-context.mjs';
import { database, DATABASES } from './databases.mjs';
import { runName } from './prisma-counts.mjs';
import { findRun, readWarnings, runLabel, isPlaceholderQuery } from './search-runs.mjs';
import { lib_search_library$addMainRecords as addMainRecords, lib_search_library$separateRecords as separateRecords } from "../boot.mjs";
import { decideScenario, addScenario, editScenario, removeScenario, dropScenarioEntries, assignRun } from './scenarios.mjs';
import { scenarioOf, MAIN_PROTOCOL } from './scenario-runs.mjs';
import { putLists, setListPeople, recordCheck, removeCheck, reconcile } from './person-checks.mjs';
import { setModelReader } from './rob-people.mjs';
import { putInstruction, putRun, instructionId } from './model-instructions.mjs';
import { validateSpec, saveOutput, outputById, currentSpec, specKey } from './output-spec.mjs';
import { proposeOutcomeRows, acceptOutcomeRows, wideColumns } from './outcome-migrate.mjs';
import { recordedIs } from './value-accuracy.mjs';
import { decideScale } from './scales.mjs';
import { scaleDecision, decisionWords } from './scale-names.mjs';
import { instrumentOf, putInstrument } from './instruments.mjs';
import { putCrosswalk, normalizeCrosswalk, hasCoefficients, crosswalkState, crosswalkOf } from './instrument-crosswalks.mjs';
import { governed } from './protocol-fields.mjs';

export const KIND = 'lykos-changes';
/** A record's fields update_record may change (its id, key and PDF are the app's: attach_pdf and merge_records change those). */
export const RECORD_FIELDS = ['title', 'authors', 'journal', 'journalAbbr', 'year', 'volume', 'issue', 'pages', 'doi', 'pmid', 'pmcid', 'url', 'abstract', 'language', 'label', 'publisher', 'affiliations'];
// fill_arm_facets reads the synthesis model (lib/synth-project.mjs, which reads the store); a caller that has it loaded hands it in, so this
// module stays pure of the store for the Rust golden tests and the views
let fillArms = null;
export const useSynthesis = fn => { fillArms = fn; };
const PICO = ['population', 'intervention', 'comparator', 'outcome', 'design', 'language'];
const LOCKED = new Set(['savedAt', 'saveToken', 'format']);
const now = () => new Date().toISOString();
const str = v => (v == null ? '' : String(v));

/**
 * The record a reference names: its id, key, DOI or label ("Hudson 2011"). Main's records; with `scenario`, also those only a protocol
 * scenario's runs found (s.scenarioPapers), main's first.
 */
/** A table by id or name; the first with numbered outcome columns when none is named. */
function tableFor(s, ref) {
  const ts = s.templates || [], r = str(ref).trim();
  const t = r ? ts.find(x => x.id === r || str(x.name).toLowerCase() === r.toLowerCase()) : ts.find(x => wideColumns(x).length) || ts[0];
  if (!t) throw new Error(r ? `no table ${r}` : 'no table');
  return t;
}
export function paperRef(s, ref, { scenario = false } = {}) {
  const r = str(ref).trim(), low = r.toLowerCase(), papers = scenario ? [...(s.papers || []), ...(s.scenarioPapers || [])] : s.papers || [];
  return papers.find(p => p.id === r || p.key === r) || papers.find(p => str(p.doi).toLowerCase() === low || str(p.label).toLowerCase() === low) || null;
}

/** A value's key from { key } or { paper, field, arm }: "paper:field" or "paper:field@armN". */
function valueKey(s, c) {
  if (c.key) { const id = str(c.key).slice(0, str(c.key).indexOf(':')); if (!paperRef(s, id)) throw new Error(`no record ${id}`); return str(c.key); }
  const p = paperRef(s, c.paper); if (!p) throw new Error(`no record ${c.paper}`);
  if (!c.field) throw new Error('set_value needs key, or paper and field');
  const field = str(c.field).includes('.') || !c.template ? str(c.field) : `${c.template}.${c.field}`;
  return `${p.id}:${field}${c.arm ? `@${/^arm/.test(c.arm) ? c.arm : `arm${c.arm}`}` : ''}`;
}

export const CHANGE_FILE_OPS = {
  set_value: { doc: '{key: "paper:field[@armN]" | paper + field (+ template, arm), value, note?, source?, evidence?: [{kind, ...}]}', does: (s, c) => {
    const k = valueKey(s, c), was = s.values[k], text = str(c.value), paper = k.slice(0, k.indexOf(':')), field = k.slice(k.indexOf(':') + 1).replace(/@.*$/, '');
    const at = now();
    s.values[k] = { ...(was || { paper_id: paper, study_id: paper, field_id: field, origin: 'imported', extractor: 'agent' }), reported_value: text, normalized_value: text,
      availability: /^(nr|not reported)$/i.test(text) ? 'not_found' : 'present', verification: 'accepted', at, verified_at: at,
      ...(c.note ? { note: str(c.note) } : {}), ...(c.source ? { source: str(c.source) } : {}), ...(c.evidence ? { evidence: c.evidence } : {}) };
    return `${k}: ${was ? `${str(was.reported_value)} → ` : ''}${text}`;
  } },
  remove_value: { doc: '{key: "paper:field[@armN]" | paper + field (+ template, arm)}: removes the value (a value for the study whose arms now have their own, or one entered in error)', does: (s, c) => {
    const k = valueKey(s, c), was = s.values?.[k];
    if (!was) throw new Error(`no value ${k}`);
    delete s.values[k];
    return `${k} removed (was ${str(was.reported_value)})`;
  } },
  set_prisma: { doc: '{field: PRISMA field id (records_screened, new_reports …), value?, note?: why a count was entered by hand}', does: (s, c) => {
    if (!c.field) throw new Error('set_prisma needs field');
    s.prisma ||= {};
    if ('value' in c) s.prisma[c.field] = str(c.value);
    if ('note' in c) { s.prismaNotes ||= {}; if (str(c.note).trim()) s.prismaNotes[c.field] = str(c.note); else delete s.prismaNotes[c.field]; }
    return `PRISMA ${c.field}${'value' in c ? ` = ${str(c.value)}` : ''}${c.note ? ' (explained)' : ''}`;
  } },
  set_protocol: { doc: `{field: title | ${PICO.join(' | ')}, value}`, does: (s, c) => {
    s.protocol ||= { pico: {}, criteria: [], amendments: [] };
    if (c.field === 'title') s.protocol.title = str(c.value);
    else if (PICO.includes(c.field)) { s.protocol.pico ||= {}; s.protocol.pico[c.field] = str(c.value); }
    else throw new Error(`no protocol field ${c.field}`);
    return `Protocol ${c.field}`;
  } },
  set_criterion: { doc: '{id: C1 | E19 …, kind?: include | exclude | group, text?, question?, yes?, no?, stage?}; adds it when new', does: (s, c) => {
    if (!c.id) throw new Error('set_criterion needs id');
    s.protocol ||= { pico: {}, criteria: [], amendments: [] }; s.protocol.criteria ||= [];
    const fields = Object.fromEntries(['kind', 'text', 'question', 'yes', 'no', 'stage'].filter(f => f in c).map(f => [f, str(c[f])]));
    const i = s.protocol.criteria.findIndex(x => x.id === c.id);
    if (i < 0) { if (!fields.text || !fields.kind) throw new Error(`a new criterion ${c.id} needs kind and text`); s.protocol.criteria.push({ id: str(c.id), ...fields }); }
    else s.protocol.criteria[i] = { ...s.protocol.criteria[i], ...fields };
    return `Criterion ${c.id}${i < 0 ? ' added' : ''}`;
  } },
  add_amendment: { doc: '{note, source?}', does: (s, c) => {
    if (!str(c.note).trim()) throw new Error('add_amendment needs note');
    s.protocol ||= { pico: {}, criteria: [], amendments: [] }; s.protocol.amendments ||= [];
    s.protocol.amendments.push({ at: now(), note: str(c.note), ...(c.source ? { source: str(c.source) } : {}) });
    return 'Protocol amendment';
  } },
  add_task: { doc: '{text, notes?, due?: YYYY-MM-DD, priority?: none | low | high}', does: (s, c) => {
    if (!str(c.text).trim()) throw new Error('add_task needs text');
    s.todos ||= [];
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    s.todos.push({ id, text: str(c.text), done: false, due: str(c.due), at: now(), ...(c.notes ? { notes: str(c.notes) } : {}), ...(c.priority ? { priority: str(c.priority) } : {}) });
    return `Task: ${str(c.text).slice(0, 60)}`;
  } },
  update_task: { doc: '{id, text?, notes?, done?: true | false, due?}', does: (s, c) => {
    const t = (s.todos || []).find(x => x.id === c.id); if (!t) throw new Error(`no task ${c.id}`);
    for (const f of ['text', 'notes', 'due']) if (f in c) t[f] = str(c[f]);
    if ('done' in c) t.done = !!c.done;
    return `Task ${c.id}`;
  } },
  remove_notes: { doc: '{ids?: [note ids], extractor?: "model:" (prefix of who wrote them), contains?: text, papers?: [records]}: notes that match every filter given', does: (s, c) => {
    if (!c.ids && !c.extractor && !c.contains && !c.papers) throw new Error('remove_notes needs at least one filter');
    const ids = c.ids && new Set(c.ids), papers = c.papers && new Set(c.papers.map(r => paperRef(s, r)?.id || r));
    const hit = n => (!ids || ids.has(n.id)) && (!c.extractor || String(n.extractor || '').startsWith(c.extractor)) && (!c.contains || String(n.text || '').includes(c.contains)) && (!papers || papers.has(n.paper));
    const before = (s.notes || []).length; s.notes = (s.notes || []).filter(n => !hit(n));
    return `${before - s.notes.length} notes removed`;
  } },
  remove_results: { doc: '{ids?: [result ids], origin?: "chat"}: saved results off the Outputs list (the chats keep their answers)', does: (s, c) => {
    const ids = new Set(c.ids || []), before = (s.results || []).length;
    if (!ids.size && !c.origin) throw new Error('remove_results needs ids or origin');
    s.results = (s.results || []).filter(r => !(ids.has(r.id) || (c.origin && r.origin === c.origin)));
    return `${before - s.results.length} saved results removed`;
  } },
  convert_item: { doc: '{item: Package item id, part?: part id or name to move it to, variants?: [variant ids or names of that part], lines?: true | false (a SWiM sheet\'s sign test and ranges)}: a figure made a table or a table a figure; it keeps its id, so references follow it', does: (s, c) => {
    if (!s.package?.items?.[str(c.item)]) throw new Error(`no Package item ${str(c.item)}`);
    const part = c.part == null ? null : (s.package.parts || []).find(p => p.id === str(c.part) || p.name === str(c.part))?.id || str(c.part);
    const r = convertItem(s.package, str(c.item), { part, variants: c.variants || [], ...(typeof c.lines === 'boolean' ? { lines: c.lines } : {}), at: now() });
    return `${r.item.title || r.item.id}: ${r.from} made a ${r.to}, now ${labels(s.package).get(r.item.id) || 'unnumbered'} of ${r.part.name}`;
  } },
  move_file: { doc: '{from, to}: every reference to a file by its path (a value\'s evidence, a table\'s source, a Package part\'s file) names its new path; past builds and earlier sources keep the path they had', does: (s, c) => {
    const from = str(c.from), to = str(c.to);
    if (!from || !to) throw new Error('move_file needs from and to');
    if (from === to) throw new Error('from and to are the same path');
    let n = 0;
    const fix = v => { if (v === from) { n++; return to; } if (v.endsWith(`:${from}`)) { n++; return v.slice(0, v.length - from.length) + to; } return v; };
    const visit = o => {
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const x = o[i]; if (typeof x === 'string') o[i] = fix(x); else if (x && typeof x === 'object') visit(x); } return; }
      for (const k of Object.keys(o)) { if (k === 'builds' || k === 'was') continue; const x = o[k]; if (typeof x === 'string') o[k] = fix(x); else if (x && typeof x === 'object') visit(x); }
    };
    visit(s);
    if (!n) throw new Error(`nothing names ${from}`);
    return `${n} reference${n === 1 ? '' : 's'} to ${from} now name${n === 1 ? 's' : ''} ${to}`;
  } },
  attach_pdf: { doc: '{paper, file: the PDF\'s path in the folder, hash: its SHA-256, size?, folderNo?, retrieval?: {provider, url, doi}}: the record\'s PDF is that file (lykos-papers downloads it first; the file must already be in the folder)', does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`no record ${c.paper}`);
    const file = str(c.file), hash = str(c.hash);
    if (!/\.pdf$/i.test(file) || file.startsWith('/') || file.split('/').includes('..')) throw new Error('attach_pdf needs file: a .pdf path inside the folder');
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('attach_pdf needs hash: the SHA-256 of the file, in hex');
    const was = p.pdfRel;
    Object.assign(p, { pdf: true, pdfName: file.split('/').pop(), pdfRel: file, pdfMode: 'folder', pdfHash: hash, ...(c.size ? { pdfSize: Number(c.size) } : {}), ...(c.folderNo ? { folderNo: str(c.folderNo) } : {}) });
    p.pdfRetrieval = { ...(c.retrieval || {}), status: 'attached', at: now() };
    return `${p.label || p.id}: PDF ${was && was !== file ? `${was} → ` : ''}${file}`;
  } },
  screen: { doc: '{paper, decision: include | exclude | uncertain, stage?: ta | ft (ta when left out), reason: required for exclude, by?: reviewer initials (required with two screeners), note?, scenario?: a protocol scenario\'s id (sc1): the decision goes into that scenario only, never main\'s}', does: (s, c) => {
    const p = paperRef(s, c.paper, { scenario: c.scenario != null }); if (!p) throw new Error(`screen: no record ${str(c.paper)}`);
    const stage = str(c.stage || 'ta');
    if (!STAGES.some(x => x.id === stage)) throw new Error(`screen: stage is ${STAGES.map(x => x.id).join(' or ')}`);
    if (!['include', 'exclude', 'uncertain'].includes(c.decision)) throw new Error('screen: decision is include, exclude or uncertain');
    const at = `${c.decision} at ${stage === 'ft' ? 'full text' : 'title and abstract'}${c.reason ? ` (${str(c.reason)})` : ''}`;
    // with a scenario its overlay only (spec Settled 8): main's decisions are not read but for what the entry was made against
    if (c.scenario != null) {
      const r = decideScenario(s, str(c.scenario), stage, p.id, c.decision, { reason: str(c.reason), by: str(c.by), via: 'change file', note: str(c.note) });
      return `${p.label || p.id}: ${at} in scenario ${str(c.scenario)}${r === 'dropped' ? ', as the main decision it inherits (no entry of its own)' : ''}`;
    }
    applyDecision(s, stage, p.id, c.decision, { reason: str(c.reason), by: str(c.by), via: 'change file', note: str(c.note) });
    return `${p.label || p.id}: ${at}`;
  } },
  appraise: { doc: '{paper, domain: id or short name (D1), or overall, judgement: one of the instrument\'s levels, or "" to clear it, tool?: instrument id (the project\'s when left out), reviewer?: a | b | model (b only with two appraisers; model, the default, with two people and the model)}', does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`appraise: no record ${str(c.paper)}`);
    const tools = allTools(s), tool = c.tool ? tools.find(t => t.id === c.tool) : appraisalTool(s.appraisalTool || 'rob2', s);
    if (!tool) throw new Error(`appraise: tool is one of ${tools.map(t => t.id).join(', ')}`);
    // the overall judgement of an instrument that has one (RoB 2, ROBINS-I) is recorded as the Appraisal view records it, under "overall"
    const domain = tool.domains.find(d => d.id === c.domain || d.short === c.domain)
      || (tool.overall && /^overall$/i.test(str(c.domain)) ? { id: 'overall', short: 'Overall' } : null);
    if (!domain) throw new Error(`appraise: ${tool.name} domains are ${tool.domains.map(d => `${d.id} (${d.short})`).join(', ')}${tool.overall ? ', overall' : ''}`);
    const value = str(c.judgement);
    if (value && !tool.judgements.includes(value)) throw new Error(`appraise: ${tool.name} judgements are ${tool.judgements.join(', ')}`);
    // with two people and the model (lib/rob-review.mjs modelOn) a change file writes the model's answers unless it names a person's slot
    const who = str(c.reviewer || (modelOn(s) ? 'model' : 'a')).toLowerCase();
    if (who === 'model' ? !modelOn(s) : who !== 'a' && (who !== 'b' || !secondOn(s))) throw new Error(modelOn(s) ? 'appraise: reviewer is model, a or b' : secondOn(s) ? 'appraise: reviewer is a or b' : 'appraise: one appraiser here, so reviewer is a');
    setAnswer(s, { paperId: p.id, toolId: tool.id, level: STUDY, who, domain: domain.id, value, toolIds: tools.map(t => t.id) });
    return `${p.label || p.id}: ${tool.name} ${domain.short} ${value || 'cleared'}${who === 'b' ? ' (reviewer B)' : who === 'model' ? ' (the model)' : ''}`;
  } },
  merge_records: { doc: '{keep, duplicate}: the duplicate record merged into the one kept, as Library › Duplicates merges (screening decisions follow: each stage keeps the more advanced, a conflict noted; refused while values or other linked work would be lost)', does: (s, c) => {
    const k = paperRef(s, c.keep), d = paperRef(s, c.duplicate);
    if (!k || !d) throw new Error(`merge_records: no record ${!k ? str(c.keep) : str(c.duplicate)}`);
    mergeRecords(s, k.id, d.id);
    return `${d.label || d.id} merged into ${k.label || k.id}`;
  } },
  distinct_records: { doc: '{a, b}: two records that are not duplicates, never proposed as such again while both stay as they are', does: (s, c) => {
    const a = paperRef(s, c.a), b = paperRef(s, c.b);
    if (!a || !b || !markDistinctIn(s, a.id, b.id)) throw new Error(`distinct_records: no record ${!a ? str(c.a) : str(c.b)}`);
    return `${a.label || a.id} and ${b.label || b.id} are different records`;
  } },
  // ---- 28 Oct 2026: what an agent did by a raw `set` path or a script of its own before (a record by its array index, the arms' facets,
  // the overlap groups, the studies' numbers) ----
  update_record: { doc: `{paper, fields: {${RECORD_FIELDS.join(', ')}}}: a record's bibliographic fields by the record, not its place in the list (an empty string clears one)`, does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`update_record: no record ${str(c.paper)}`);
    const f = c.fields && typeof c.fields === 'object' ? c.fields : null;
    if (!f || !Object.keys(f).length) throw new Error('update_record needs fields');
    const bad = Object.keys(f).filter(k => !RECORD_FIELDS.includes(k));
    if (bad.length) throw new Error(`update_record: ${bad.join(', ')} not a record field here (${RECORD_FIELDS.join(', ')})`);
    if ('authors' in f && !(Array.isArray(f.authors) && f.authors.every(a => typeof a === 'string'))) throw new Error('update_record: authors is a list of names');
    if ('affiliations' in f && f.affiliations !== '' && !(Array.isArray(f.affiliations) && f.affiliations.every(a => typeof a === 'string'))) throw new Error('update_record: affiliations is a list of institutions');
    const said = [];
    for (const [k, v] of Object.entries(f)) {
      const was = p[k];
      if (v === '' || v == null || (Array.isArray(v) && !v.length)) delete p[k]; else p[k] = Array.isArray(v) ? v.map(String) : str(v);
      said.push(`${k}${was != null && was !== '' ? ` ${JSON.stringify(was)} →` : ''} ${JSON.stringify(p[k] ?? '')}`);
    }
    return `${p.label || p.id}: ${said.join('; ')}`;
  } },
  set_arm_facets: { doc: '{paper, arm?: 1 | 2 | "arm1" (none for a study of one arm), facets?: {facet id: level id}, role?: I | C, fu?: months}: an arm\'s stored synthesis levels (the evidence map, the SWiM sheets and the forests read them); checked against s.synthesis.facets', does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`set_arm_facets: no record ${str(c.paper)}`);
    const arm = c.arm == null || c.arm === '' ? '' : /^arm/.test(str(c.arm)) ? str(c.arm) : `arm${str(c.arm)}`;
    const key = `${p.id}@${arm}`, facets = Array.isArray(s.synthesis?.facets) ? s.synthesis.facets : [];
    for (const [fid, lv] of Object.entries(c.facets || {})) {
      const f = facets.find(x => x.id === fid);
      if (!f) throw new Error(`set_arm_facets: no facet ${fid} (${facets.map(x => x.id).join(', ') || 'none defined'})`);
      if (Array.isArray(f.levels) && lv != null && lv !== '' && !f.levels.some(l => l.id === lv)) throw new Error(`set_arm_facets: ${fid} levels are ${f.levels.map(l => l.id).join(', ')}`);
    }
    if (c.role != null && !['I', 'C'].includes(c.role)) throw new Error('set_arm_facets: role is I or C');
    if (c.fu != null && !Number.isFinite(Number(c.fu))) throw new Error('set_arm_facets: fu is a number of months');
    s.synthesis ||= {}; s.synthesis.arms ||= {};
    const was = s.synthesis.arms[key] || {};
    const levels = { ...(was.facets || {}) };
    for (const [fid, lv] of Object.entries(c.facets || {})) { if (lv == null || lv === '') delete levels[fid]; else levels[fid] = lv; }
    s.synthesis.arms[key] = { ...was, role: c.role || was.role || (arm === 'arm2' ? 'C' : 'I'), facets: levels, ...(c.fu != null ? { fu: Number(c.fu) } : {}) };
    return `${p.label || p.id}${arm ? ` ${arm}` : ''}: ${Object.entries(levels).map(([k, v]) => `${k} ${v}`).join(', ') || 'no levels'}`;
  } },
  propose_outcome_rows: { doc: '{template?: table id or name (the first with numbered outcome columns)}: each value of the numbered outcome columns (o1_outcome … o3_source) proposed at its outcome entry\'s statistic (lib/outcome-migrate.mjs); nothing moves until accepted', does: (s, c) => {
    const t = tableFor(s, c.template); const plan = proposeOutcomeRows(s, t.id);
    return `${t.name || t.id}: ${Object.keys(plan.proposals).length} values proposed as outcome rows in ${Object.values(plan.entries).flat().length} entries${plan.pending.length ? `, ${plan.pending.length} left (another proposal waits)` : ''}`;
  } },
  accept_outcome_rows: { doc: '{template?, decision: who decided and why ("Decided by Claude on the owner\'s instruction")}: accepts every outcome-row proposal of the table, moving each value with its evidence and proof, and records the decision', does: (s, c) => {
    if (!str(c.decision).trim()) throw new Error('accept_outcome_rows needs decision: who decided and why');
    const t = tableFor(s, c.template), r = acceptOutcomeRows(s, t.id, { by: str(c.by || 'agent'), decision: str(c.decision).trim() });
    return `${t.name || t.id}: ${r.moved} values moved to outcome rows (${r.refiled} filed under another statistic, ${r.notReported} "NR" read as not reported), ${r.removed.length} numbered columns removed${r.left ? `, ${r.left} left` : ''}`;
  } },
  // outcome scales and crosswalks (plan G3a, G3b; B1, 7 Nov 2026): what Scales does in the app, for an agent's change file
  decide_scale: { doc: '{scale: instrument code, use: own | convert | sensitivity | exclude, to?: the code to convert to, crosswalk?: its id (the pair\'s first otherwise), why: who decided and why}: what the review does with an outcome scale, as Scales › Decision does (lib/scales.mjs decideScale); "own" removes the decision. On a governed protocol the decision files the scale\'s amendment, so an agent\'s file is held for the owner', does: (s, c) => {
    const code = str(c.scale).trim(), x = instrumentOf(s, code);
    if (!x) throw new Error(`decide_scale: no scale ${JSON.stringify(code)} (codes: the built-in list and s.instruments)`);
    if (!str(c.why).trim()) throw new Error('decide_scale needs why: who decided and why');
    const r = decideScale(s, code, { use: str(c.use).trim(), to: str(c.to).trim(), crosswalk: str(c.crosswalk).trim() }, { by: str(c.by || 'agent'), why: str(c.why).trim() });
    if (r.error) throw new Error(`decide_scale: ${r.error}`);
    return `${x.label}: ${decisionWords(s, scaleDecision(s, code))}${r.filed ? ' (the amendment is filed)' : ''}`;
  } },
  put_instrument: { doc: '{instrument: {code, label, name?, aliases?, domain?, min?, max?, higher?: better | worse, rater?, indications?}}: adds a project scale, or extends a built-in one by its code, as Scales › Add scale does (lib/instruments.mjs putInstrument)', does: (s, c) => {
    const why = putInstrument(s, c.instrument || {});
    if (why) throw new Error(`put_instrument: ${why}`);
    return `${str(c.instrument?.label || c.instrument?.code)}: in the project's scales`;
  } },
  put_crosswalk: { doc: '{crosswalk: {id, from, to, method: linear | table | stratified | percent-change, params, range?, covariate?, source: {citation, doi?, pmid?, table, checked, needs?, note?}}}: adds a project crosswalk, or fills in a built-in one\'s coefficients by its id (lib/instrument-crosswalks.mjs putCrosswalk). Coefficients are copied from the paper only (G6): an entry that holds them needs source.table (where in the paper) and source.checked (the date read)', does: (s, c) => {
    const x = normalizeCrosswalk(c.crosswalk || {});
    if (hasCoefficients(x) && !(x.source.table && x.source.checked)) throw new Error(`put_crosswalk: ${x.id || 'the crosswalk'}'s coefficients need source.table (where in the paper) and source.checked (the date they were read)`);
    const why = putCrosswalk(s, c.crosswalk || {});
    if (why) throw new Error(`put_crosswalk: ${why}`);
    const w = crosswalkState(crosswalkOf(s, x.id));
    return `${x.id}: ${w.words.charAt(0).toLowerCase()}${w.words.slice(1)}`;
  } },
  fill_arm_facets: { doc: '{only?: "empty" | "all"}: every arm\'s synthesis levels from the facets\' rules, as Syntheses › Fill empty levels from the rules does ("all" proposes them again over the stored ones)', does: (s, c) => {
    if (!fillArms) throw new Error('fill_arm_facets needs lib/synth-project.mjs (tools/lykos-apply.mjs loads it)');
    const only = c.only === 'all' ? 'all' : 'empty', before = JSON.stringify(s.synthesis?.arms || {});
    const next = fillArms(s, { only });
    const added = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify((s.synthesis?.arms || {})[k]));
    s.synthesis = { ...(s.synthesis || {}), arms: next };
    return before === JSON.stringify(next) ? 'synthesis arms: nothing to fill' : `synthesis arms: ${added.length} filled from the rules (${added.slice(0, 8).join(', ')}${added.length > 8 ? ', …' : ''})`;
  } },
  set_overlap: { doc: '{id, studies: [records], keep?: record kept in pooled counts, note?}: studies that share patients (the synthesis counts them once); studies: [] removes the group', does: (s, c) => {
    const id = str(c.id).trim(); if (!id) throw new Error('set_overlap needs id');
    if (!Array.isArray(c.studies)) throw new Error('set_overlap needs studies: a list of records');
    const ids = c.studies.map(r => { const p = paperRef(s, r); if (!p) throw new Error(`set_overlap: no record ${str(r)}`); return p.id; });
    s.synthesis ||= {}; const groups = (s.synthesis.overlap || []).filter(g => g.id !== id);
    if (!ids.length) { s.synthesis.overlap = groups; return `overlap ${id} removed`; }
    if (ids.length < 2) throw new Error('set_overlap: a group is two studies or more');
    const keep = c.keep != null ? paperRef(s, c.keep)?.id : undefined;
    if (c.keep != null && !ids.includes(keep)) throw new Error('set_overlap: keep is one of the group\'s studies');
    s.synthesis.overlap = [...groups, { id, studies: ids, ...(keep ? { keep } : {}), ...(c.note ? { note: str(c.note) } : {}) }];
    return `overlap ${id}: ${ids.map(x => paperRef(s, x)?.label || x).join(', ')}${keep ? ` (${paperRef(s, keep)?.label || keep} kept)` : ''}`;
  } },
  renumber_studies: { doc: '{order: [records], template?: table id or name}: the studies numbered 1, 2, … in this order: the table\'s ID column and each record\'s folder number (the PDFs are renamed by `lykos-papers rename`)', does: (s, c) => {
    if (!Array.isArray(c.order) || !c.order.length) throw new Error('renumber_studies needs order: the records, in their new order');
    const ts = s.templates || [], t = c.template ? ts.find(x => x.id === c.template || x.name === c.template) : ts.find(x => (x.columns || []).some(col => isIdLabel(col.label)));
    if (!t) throw new Error(c.template ? `renumber_studies: no table ${str(c.template)}` : 'renumber_studies: no table with an ID column');
    const col = (t.columns || []).find(x => isIdLabel(x.label));
    if (!col) throw new Error(`renumber_studies: ${t.name || t.id} has no ID column`);
    const ps = c.order.map(r => { const p = paperRef(s, r); if (!p) throw new Error(`renumber_studies: no record ${str(r)}`); return p; });
    if (new Set(ps.map(p => p.id)).size !== ps.length) throw new Error('renumber_studies: a record is listed twice');
    const at = now(), moved = [];
    ps.forEach((p, i) => {
      const no = String(i + 1), k = `${p.id}:${col.id}`, was = s.values[k];
      if (str(was?.reported_value) !== no || str(p.folderNo) !== no) moved.push(`${p.label || p.id} ${str(was?.reported_value) || str(p.folderNo) || '–'}→${no}`);
      s.values[k] = { ...(was || { paper_id: p.id, study_id: p.id, field_id: col.id, origin: 'imported', extractor: 'agent' }), reported_value: no, normalized_value: no, availability: 'present', verification: 'accepted', at, verified_at: at,
        ...(c.note ? { note: str(c.note) } : {}) };
      p.folderNo = no;
    });
    return `${ps.length} studies numbered${moved.length ? `: ${moved.slice(0, 12).join(', ')}${moved.length > 12 ? ', …' : ''}` : ' (unchanged)'}`;
  } },
  // 31 Oct 2026 (plan items 3 and 4): a companion report linked to its trial, so PRISMA counts studies and reports from the record, and a
  // paper the review could not obtain recorded as not retrieved, with its reason, instead of an exclusion reason that reads /not retriev/
  report_of: { doc: '{paper, of: the trial\'s main report (record), or "" to unlink}: the record is a further report of that trial (PRISMA counts it as a report, not a study)', does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`report_of: no record ${str(c.paper)}`);
    if (!str(c.of)) { delete p.reportOf; return `${p.label || p.id}: no longer a report of another trial`; }
    const t = paperRef(s, c.of); if (!t) throw new Error(`report_of: no record ${str(c.of)}`);
    if (t.id === p.id) throw new Error('report_of: a record cannot be a report of itself');
    if (t.reportOf) throw new Error(`report_of: ${t.label || t.id} is itself a report of another record; link to the main report`);
    for (const q of s.papers || []) if (q.reportOf === p.id) q.reportOf = t.id;   // its own companions follow it to the main report
    p.reportOf = t.id;
    return `${p.label || p.id}: a report of ${t.label || t.id}`;
  } },
  not_retrieved: { doc: '{paper, reason, undo?: true}: the report could not be obtained (PRISMA "reports not retrieved"); undo clears it', does: (s, c) => {
    const p = paperRef(s, c.paper); if (!p) throw new Error(`not_retrieved: no record ${str(c.paper)}`);
    if (c.undo) { if (p.pdfRetrieval?.status === 'not-retrieved') { const { reason, ...rest } = p.pdfRetrieval; p.pdfRetrieval = { ...rest, status: rest.was || 'unavailable' }; delete p.pdfRetrieval.was; } return `${p.label || p.id}: retrieval open again`; }
    if (!str(c.reason)) throw new Error('not_retrieved needs a reason (author did not answer, no library access, …)');
    p.pdfRetrieval = { ...(p.pdfRetrieval || {}), was: p.pdfRetrieval?.status || '', status: 'not-retrieved', reason: str(c.reason), at: now() };
    return `${p.label || p.id}: not retrieved (${str(c.reason)})`;
  } },
  set_journal: { doc: '{journals: [target, others…]}: the target journal (first) and the others; the reference style and journal profile follow the target as when it is chosen in the app', does: (s, c) => {
    const list = (Array.isArray(c.journals) ? c.journals : [c.journals]).map(str).filter(Boolean);
    if (!list.length) throw new Error('set_journal needs journals: the target first');
    const before = s.project?.journals || [];
    Object.assign(s, setJournals(s, list));
    return `journals: ${(s.project?.journals || []).join(', ')}${before.length ? ` (was ${before.join(', ')})` : ''}${s.journalProfile?.id ? `; profile ${s.journalProfile.id}` : ''}`;
  } },
  put_value: { doc: '{key: "paper:field[@armN]", record: {...}}: a value record as a tool computed it, whole (lykos-import writes an import this way, key by key, so a value changed meanwhile by someone else is not written over with the rest)', does: (s, c) => {
    const k = str(c.key), id = k.slice(0, k.indexOf(':'));
    if (!k.includes(':') || !paperRef(s, id)) throw new Error(`put_value: no record ${id || k}`);
    if (!c.record || typeof c.record !== 'object' || Array.isArray(c.record)) throw new Error('put_value needs record: the value record');
    if (s.values[k]?.locked) throw new Error(`put_value: ${k} is locked`);
    const was = s.values[k]; s.values[k] = c.record;
    return `${k}: ${was ? `${str(was.reported_value)} → ` : ''}${str(c.record.reported_value)}`;
  } },
  // 28 Oct 2026: three ops that cannot write over newer work. An import set the whole notes list and whole entries of robReview and
  // assessments, and a proposed derivation set a value's whole check record, so a note added or a decision recorded between writing the
  // change file and applying it was lost. Each of these leaves what is there now and says so; applied twice, the second does nothing.
  add_note: { doc: '{note: {id?, paper, text, kind?, page?, extractor?, verification?, at?}}: appends one note; one with the same id, or the same record and text, already there is left as it is (skipped)', does: (s, c) => {
    const n = c.note;
    if (!n || typeof n !== 'object' || Array.isArray(n) || !str(n.text).trim()) throw new Error('add_note needs note: {paper, text}');
    const p = paperRef(s, n.paper);
    if (n.paper != null && n.paper !== '' && !p) throw new Error(`add_note: no record ${n.paper}`);
    const note = { ...n, ...(p ? { paper: p.id } : {}), id: str(n.id) || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: n.at || now() };
    const there = (s.notes || []).find(x => x.id === note.id || (x.paper === note.paper && x.text === note.text));
    if (there) return `note ${note.id}: already there (skipped)`;
    s.notes = [...(s.notes || []), note];
    return `note added${p ? ` to ${p.label || p.id}` : ''}`;
  } },
  set_if: { doc: '{path, was?, value?}: sets a field (removes it when value is left out) only while it still holds `was` (left out: while the field is absent); a field changed since is kept and reported (skipped)', does: (s, c) => {
    const at = Array.isArray(c.path) ? c.path.join('.') : '';
    if (!('value' in c)) { try { walk(s, c.path, false); } catch (e) { if (/^no /.test(e.message)) return `${at}: already so`; throw e; } }
    const { parent, last } = walk(s, c.path, true), cur = parent[last];
    if (same(cur, c.value)) return `${at}: already so`;
    if (!same(cur, c.was)) return `${at}: changed since the change file was written; kept (skipped)`;
    if ('value' in c) parent[last] = c.value; else if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last];
    return `${at} ${'value' in c ? 'set' : 'removed'}`;
  } },
  settle_value: { doc: '{paper, key: the check key ("arm_n@arm1", as valueChecks keeps it) or "paper:field[@armN]", decision: confirmed | kept | derived | not-in-paper | figure, why, how? (derived), rule?, quote?, found?, page?, textHash?, value?: the value it was made for, by?, at?, ifUndecided?: true}: a reviewer\'s decision on an extracted value (lykos verify settle); with ifUndecided a value that has a decision, or has changed, is left as it is and reported (skipped)', does: (s, c) => {
    const raw = str(c.key), pid = c.paper != null ? paperRef(s, c.paper)?.id : raw.includes(':') ? paperRef(s, raw.slice(0, raw.indexOf(':')))?.id : null;
    if (!pid) throw new Error(`settle_value: no record ${str(c.paper) || raw}`);
    const shortOf = k => { const f = k.slice(k.indexOf(':') + 1), col = f.split('@')[0], arm = f.includes('@') ? f.slice(f.indexOf('@')) : ''; return `${col.slice(col.indexOf('.') + 1)}${arm}`; };
    const vkey = raw.includes(':') ? raw : Object.keys(s.values || {}).find(k => k.startsWith(`${pid}:`) && shortOf(k) === raw);
    if (!vkey || !s.values?.[vkey]) throw new Error(`settle_value: no value ${raw} for ${pid}`);
    const key = shortOf(vkey), value = str(s.values[vkey].reported_value), decision = str(c.decision).trim().toLowerCase();
    if (!['confirmed', 'kept', 'derived', 'not-in-paper', 'figure'].includes(decision)) throw new Error(`settle_value: decision "${str(c.decision)}" (use confirmed, kept, derived, not-in-paper, figure)`);
    if (!str(c.why).trim()) throw new Error('settle_value needs why');
    if (decision === 'derived' && !str(c.how).trim()) throw new Error('settle_value: derived needs how (the arithmetic)');
    const prev = s.valueChecks?.studies?.[pid]?.fields?.[key];
    if (c.value != null && str(c.value) !== value) {
      if (c.ifUndecided) return `${pid} ${key}: the value is now ${JSON.stringify(value)}, not ${JSON.stringify(str(c.value))}; left as it is (skipped)`;
      throw new Error(`settle_value: ${pid} ${key} is now ${JSON.stringify(value)}, not ${JSON.stringify(str(c.value))}`);
    }
    const same = !!prev && recordedIs(prev.recorded, value, s.values[vkey].qualifier);   // a check recorded with the value's qualifier in brackets is this value's
    if (c.ifUndecided && prev?.settled && same) return `${pid} ${key}: already decided (${prev.settled.decision} by ${prev.settled.by || 'a reviewer'}); kept (skipped)`;
    const base = same ? { ...prev, recorded: value } : { verdict: decision === 'not-in-paper' ? 'not-in-paper' : 'agree', recorded: value };
    delete base.challenge;
    const quote = str(c.quote).trim();
    base.settled = { decision, why: str(c.why).trim().slice(0, 600), ...(c.how ? { how: str(c.how).slice(0, 300) } : {}), ...(c.rule ? { rule: str(c.rule).slice(0, 200) } : {}),
      ...(quote ? { quote: quote.slice(0, 1200), found: !!c.found } : {}), ...(c.page != null ? { page: c.page } : {}), ...(c.textHash ? { textHash: str(c.textHash) } : {}), by: str(c.by) || 'a reviewer', at: c.at || now() };
    s.valueChecks ||= { v: 1, studies: {} }; s.valueChecks.studies ||= {};
    const st = s.valueChecks.studies[pid] ||= { fields: {} }; st.fields ||= {};
    st.fields[key] = base;
    return `${pid} ${key}: ${decision}${prev?.settled ? ` (was ${prev.settled.decision})` : ''}`;
  } },
  set_eligibility_rules: { doc: '{rules: {facts: [{id, text}], general?: [fact ids], rules: [{id, name, text, any: [[fact ids, "!" for not]], criterion?}], thresholds?: [{fact, any: [{measure, op, value, unit?}], decides?}]}}: the eligibility rules in the form the eligibility review applies them (lib/eligibility-review.mjs); a change of rule re-reads the recorded facts (lykos-eligibility moves)', does: (s, c) => {
    const r = readRules(c.rules || {});
    if (r.problems.length) throw new Error(`set_eligibility_rules: ${r.problems.join('; ')}`);
    if (!r.rules.length) throw new Error('set_eligibility_rules needs at least one rule');
    const was = s.eligibilityRules;
    s.eligibilityRules = { facts: c.rules.facts, ...(c.rules.general ? { general: c.rules.general } : {}), rules: c.rules.rules, ...(c.rules.thresholds ? { thresholds: c.rules.thresholds } : {}), at: now(), ...(was ? { previous: { at: was.at, rules: (was.rules || []).map(x => x.id) } } : {}) };
    return `eligibility rules: ${r.facts.length} facts, ${r.rules.map(x => x.id).join(', ')}${was ? ' (replacing the earlier set)' : ''}`;
  } },
  set_item_text: { doc: '{item: Package item id, label ("Table 2") or title, field: title | legend | caption | notes, text: a text (notes: one per line, or a list)}: a Package item\'s title, legend or notes, checked against its kind', does: (s, c) => {
    const { id, it, label } = packageItem(s, c.item), kind = it.kind in ITEM_TEXT ? it.kind : 'other', allowed = ITEM_TEXT[kind];
    const field = str(c.field) === 'caption' ? 'legend' : str(c.field);
    if (!allowed.includes(field)) throw new Error(`set_item_text: ${label} is a ${kind === 'other' ? 'document' : kind}; its fields are ${allowed.map(f => (f === 'legend' ? 'legend (caption)' : f)).join(', ')}, not ${str(c.field) || 'none'}`);
    if (!('text' in c)) throw new Error('set_item_text needs text');
    const next = field === 'notes' ? (Array.isArray(c.text) ? c.text.map(str) : str(c.text).split(/\r?\n/)).map(t => t.trim()).filter(Boolean) : str(c.text);
    const was = it[field];
    if (field === 'notes' && !Array.isArray(c.text) && typeof c.text !== 'string') throw new Error('set_item_text: notes are a text, one note per line, or a list of notes');
    s.package.items[id] = { ...it, [field]: next };
    const show = v => JSON.stringify(Array.isArray(v) ? v.join(' | ') : str(v)).slice(0, 80);
    return `${label} ${field}: ${was != null && str(was) !== '' && !(Array.isArray(was) && !was.length) ? `${show(was)} → ` : ''}${show(next)}`;
  } },
  // 31 Oct 2026: a search run's database, version, name and warnings (lib/search-runs.mjs), and a run logged by hand. Before, a re-run
  // imported from its file was logged under the file's name and counted in PRISMA as a database of its own, and there was nowhere to
  // keep what the database's page warned of.
  log_search: { doc: '{source: database name or id, date: YYYY-MM-DD, query, found?: records the database reported, retrieved?: records brought in (default found), version?, name?, file?, queryFile?, note?, warnings?: [as the page showed them; [] when it showed none], inPrisma?: false for a run whose records were not brought in (not in the flow), previousVersion?: true for a search of the review\'s previous version}: logs a search run', does: (s, c) => {
    const name = str(c.source).trim(), date = str(c.date).trim(), query = str(c.query).trim();
    if (!name) throw new Error('log_search needs source: the database');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('log_search needs date: YYYY-MM-DD');
    if (!query) throw new Error('log_search needs query: the strategy as run');
    if (isPlaceholderQuery(query)) throw new Error('log_search: query is the strategy as run, not the file it was imported from');
    const num = (k, v) => { if (v == null || v === '') return null; if (!/^\d+$/.test(str(v).replace(/[,\s]/g, ''))) throw new Error(`log_search: ${k} is a whole number`); return Number(str(v).replace(/[,\s]/g, '')); };
    const found = num('found', c.found), retrieved = c.retrieved != null ? num('retrieved', c.retrieved) : found;
    const db = database(name), at = `${date}T12:00:00.000Z`;
    if ((s.searches || []).some(r => r.at === at && runName(r) === (db?.name || name) && r.query === query)) return `${db?.name || name} ${date}: already logged (skipped)`;
    const w = readWarnings(c.warnings);
    const entry = { source: db?.name || name, kind: db?.kind || 'database', ...(db ? { database: db.id } : {}), query, at, date, total: found, retrieved, status: 'complete', outside: true,
      ...(c.version ? { version: str(c.version) } : {}), ...(c.name ? { name: str(c.name) } : {}), ...(c.file ? { file: str(c.file) } : {}), ...(c.queryFile ? { queryFile: str(c.queryFile) } : {}),
      ...(c.note ? { note: str(c.note) } : {}), ...(w ? { warnings: w } : {}), ...(c.inPrisma === false ? { exploratory: true } : {}), ...(c.previousVersion ? { previousVersion: true } : {}) };
    s.searches = [...(s.searches || []), entry];
    return `search logged: ${runLabel(entry)} ${date}${found != null ? `, ${found} records` : ''}${entry.exploratory ? ' (not in the flow)' : ''}${w?.length ? `, ${w.length} warning${w.length === 1 ? '' : 's'}` : ''}`;
  } },
  update_search: { doc: '{run: index, time (at), name or file of a search run, database?: name or id (a re-run logged under its file\'s name), version?, name?, note?, query?: the strategy as it ran ("" clears it), queryFile?: the file in the folder that holds it, warnings?: [as the page showed them; [] when it showed none; null to clear], previousVersion?: true|false}: corrects a search run\'s database, version, name, query or warnings; its counts and records are not changed', does: (s, c) => {
    const { run, index } = findRun(s, c.run);
    const before = runLabel(run), done = [];
    if ('database' in c) {
      const db = database(c.database);
      if (!db) throw new Error(`update_search: ${str(c.database)} is not a database Lykos knows (${DATABASES.map(d => d.name).join(', ')})`);
      // the run is named by its database; the name it was logged under (a file's) stays as its own name
      if (run.source !== db.name) { if (!run.name && run.source && database(run.source)?.name !== run.source && database(run.source)?.id === db.id && run.source !== db.fullName) run.name = run.source; run.source = db.name; }
      run.database = db.id; run.kind = run.kind && !['database', 'register'].includes(run.kind) ? run.kind : db.kind; done.push(`database ${db.name}`);
    }
    for (const k of ['version', 'name', 'note']) if (k in c) { if (str(c[k]).trim()) run[k] = str(c[k]).trim(); else delete run[k]; done.push(`${k} ${str(c[k]).trim() || 'cleared'}`); }
    // the query as it ran (2 Nov 2026): an import from a file logged "Imported from <file>" in its place (lib/search-runs.mjs runQuery)
    if ('query' in c) {
      const q = str(c.query).trim();
      if (isPlaceholderQuery(q)) throw new Error(`update_search: "${q.slice(0, 60)}" names a file, not a query`);
      if (q) run.query = q; else delete run.query;
      done.push(q ? `query (${q.length} characters)` : 'query cleared');
    }
    if ('queryFile' in c) { const f = str(c.queryFile).trim(); if (f) run.queryFile = f; else delete run.queryFile; done.push(`query file ${f || 'cleared'}`); }
    if ('warnings' in c) {
      const w = c.warnings === null ? null : readWarnings(c.warnings);
      if (w == null) delete run.warnings; else run.warnings = w;
      done.push(w == null ? 'warnings not recorded' : w.length ? `${w.length} warning${w.length === 1 ? '' : 's'}` : 'no warnings shown');
    }
    if ('previousVersion' in c) { if (c.previousVersion) run.previousVersion = true; else delete run.previousVersion; done.push(c.previousVersion ? 'previous version' : 'this version'); }
    if (!done.length) throw new Error('update_search: nothing to change (database, version, name, note, query, queryFile, warnings, previousVersion)');
    return `search ${index} (${before}${run.at ? `, ${String(run.at).slice(0, 10)}` : ''}): ${done.join(', ')}`;
  } },
  // a list of records (papers, each with its id) changed record by record (31 Oct 2026): an import set the whole list, 100 MB a change file,
  // kept in inbox/applied after it was applied
  put_records: { doc: '{path: ["papers"], records: [{id, …}]}: each record replaces the one with its id, or joins the end of the list', does: (s, c) => {
    const { parent, last } = walk(s, c.path, true), list = parent[last] ||= [];
    if (!Array.isArray(list) || !Array.isArray(c.records)) throw new Error('put_records needs a list at path and records');
    if (list === s.scenarioPapers) { const main = new Set((s.papers || []).map(p => p?.id)), r = c.records.find(x => main.has(x?.id)); if (r) throw new Error(`put_records: ${r.id} is one of main's records (one record per id in main's and a scenario's)`); }
    const at = new Map(list.map((r, i) => [r?.id, i]));
    let added = 0, replaced = 0;
    for (const r of c.records) {
      if (!r || typeof r.id !== 'string' || !r.id) throw new Error('put_records: every record needs its id');
      const i = at.get(r.id);
      // main's records through the one place that keeps an id out of a scenario's records too (lib/search-library.mjs addMainRecords)
      if (i == null) { at.set(r.id, list.length); if (list === s.papers) addMainRecords(s, [r]); else list.push(r); added++; } else { list[i] = r; replaced++; }
    }
    return `${c.path.join('.')}: ${[added && `${added} added`, replaced && `${replaced} replaced`].filter(Boolean).join(', ') || 'unchanged'}`;
  } },
  remove_records: { doc: '{path: ["papers"], ids: [id, …]}: removes the records with these ids from the list', does: (s, c) => {
    const { parent, last } = walk(s, c.path, false), list = parent[last];
    if (!Array.isArray(list) || !Array.isArray(c.ids)) throw new Error('remove_records needs a list at path and ids');
    const ids = new Set(c.ids), keep = list.filter(r => !ids.has(r?.id));
    parent[last] = keep;
    // a record leaving the pool takes its scenario decisions with it (no scenario count names a missing record)
    if (parent === s && (last === 'papers' || last === 'scenarioPapers')) dropScenarioEntries(s, list.filter(r => ids.has(r?.id)).map(r => r.id));
    return `${c.path.join('.')}: ${list.length - keep.length} removed`;
  } },
  // 31 Oct 2026: analyses and a manuscript the project's own scripts build (R, a Word build) are the review's state too; the Overview and
  // Submission readiness read them (lib/review-state.mjs externalOutputs). tools/lykos-register.mjs reads the files and writes this op.
  register_output: { doc: '{kind: analysis | manuscript, file, builtAt: ISO time, ...what tools/lykos-register.mjs read of it}: an analysis run or a manuscript built outside Lykos; the one before goes to its history', does: (s, c) => {
    const kind = str(c.kind), file = str(c.file).trim();
    if (!['analysis', 'manuscript'].includes(kind)) throw new Error('register_output: kind is analysis or manuscript');
    if (!file || /^(\/|~)|(^|\/)\.\.(\/|$)/.test(file)) throw new Error('register_output needs file: a path in the project folder');
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(str(c.builtAt))) throw new Error('register_output needs builtAt: when the file was built (ISO)');
    const entry = { ...c, kind, file, registeredAt: new Date().toISOString() };
    delete entry.op;
    const x = s.externalOutputs && typeof s.externalOutputs === 'object' ? s.externalOutputs : (s.externalOutputs = {});
    if (x[kind]) x.history = [...(Array.isArray(x.history) ? x.history : []), x[kind]].slice(-20);
    x[kind] = entry;
    return `${kind} registered: ${file}`;
  } },
  save_output: { doc: '{spec: an output spec (lib/output-spec.mjs), message?, author?}: saves a table or figure spec as a new version of its output, exactly as the app does when a proposal is accepted (validated against the project; the same spec twice is no new version); it draws and writes nothing', does: (s, c) => {
    const v = validateSpec(c.spec, s);
    if (!v.ok) throw new Error(`save_output: ${v.errors.join(' | ')}`);
    const before = currentSpec(outputById(s, v.spec.id));
    if (before && specKey(before) === specKey(v.spec)) return `${v.spec.id}: unchanged (already v${outputById(s, v.spec.id).versions.at(-1).n})`;
    const { version } = saveOutput(s, v.spec, { author: str(c.author) || 'Agent', message: str(c.message) });
    return `${v.spec.id}: ${v.spec.title} saved as v${version.n}${version.n > 1 ? ` (${version.summary})` : ''}`;
  } },
  // protocol scenarios (1 Nov 2026, spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md): a scenario of the protocol, its
  // decisions written by `screen` with `scenario`
  set_scenario: { doc: '{id?: sc1 … (left out: a new scenario), name (required for a new one), reason?, review?: a review id (main when left out; a new one only), searches?: {add?: [run ids], remove?: [run ids | "db:<database id>"]}, criteria?: {add?: [{id, kind, stage, text}], remove?: [criterion ids], change?: {criterion id: text}}, remove?: true}: makes, changes or removes a protocol scenario (its runs and the records only they found stay); answers its id', does: (s, c) => {
    if (c.remove === true) {
      if (c.id == null) throw new Error('set_scenario: remove needs the scenario\'s id');
      const name = scenarioOf(s, str(c.id) === MAIN_PROTOCOL ? '' : str(c.id))?.name, r = removeScenario(s, str(c.id));
      const ids = r.records.length > 12 ? `${r.records.slice(0, 12).join(', ')}, …` : r.records.join(', ');
      return `scenario ${str(c.id)} (${name}) removed${r.runs.length || r.records.length ? `; its ${r.runs.length} search runs and the ${r.records.length} records only they found are kept, for you to decide on (assign_run makes a run main's)${ids ? `: ${ids}` : ''}` : ''}`;
    }
    const patch = Object.fromEntries(['name', 'reason', 'searches', 'criteria'].filter(k => k in c).map(k => [k, c[k]]));
    const extra = Object.keys(c).find(k => !['op', 'id', 'review', 'remove', ...Object.keys(patch)].includes(k));
    if (extra) throw new Error(`set_scenario: ${extra} is not a scenario field (name, reason, review, searches, criteria, remove)`);
    if (c.id != null) {
      if ('review' in c) throw new Error('set_scenario: a scenario\'s review is set when it is made');
      editScenario(s, str(c.id), patch);
      return `scenario ${str(c.id)} (${scenarioOf(s, str(c.id)).name}) changed: ${Object.keys(patch).join(', ') || 'nothing'}`;
    }
    const id = addScenario(s, { name: c.name, reason: c.reason, ...(c.review ? { review: str(c.review) } : {}) });
    const { name, reason, ...rest } = patch;
    if (Object.keys(rest).length) editScenario(s, id, rest);
    return `scenario ${id} (${str(c.name).trim()}) added`;
  } },
  assign_run: { doc: '{run: a run id or its place in the search log (main\'s runs, then the scenarios\'), scenario?: "main"}: a run imported for a protocol scenario becomes main\'s, with every record it found and its merges (a main run is never moved into a scenario: set_scenario searches.remove leaves it out)', does: (s, c) => {
    if (c.run == null) throw new Error('assign_run needs run');
    const r = assignRun(s, typeof c.run === 'number' ? c.run : str(c.run), c.scenario == null ? MAIN_PROTOCOL : str(c.scenario));
    return `search run ${r.run} is main's: ${r.records.length} record${r.records.length === 1 ? '' : 's'} and ${r.merges} duplicate${r.merges === 1 ? '' : 's'} with it`;
  } },
  // person checks (lib/person-checks.mjs, 2 Nov 2026): the lists to verify are set by anyone; a check, its removal and a reconciliation
  // are a person's own and refused from an agent (PERSON_OPS, tools/lykos-apply.mjs under LYKOS_AGENT)
  set_verification_lists: { doc: '{lists: [{id, name, kind: ta | ft | value | rob | study, people: [names], blinded?, sampleOf?, rate?, items: [{id: "ft:<record>" | "value:<key>" …, stratum?, rank?}], source?}], draw?}: verification lists, as `lykos review <folder> lists load <csv>` or `lists draw` give them (a list with the same id is replaced; checks stay)', does: (s, c) => {
    if (!Array.isArray(c.lists) || !c.lists.length) throw new Error('lists must be a non-empty list');
    putLists(s, c.lists, { draw: c.draw });
    return `${c.lists.length} verification list${c.lists.length === 1 ? '' : 's'}: ${c.lists.map(l => `${l.id} (${(l.items || []).length})`).join(', ')}`;
  } },
  set_list_people: { doc: '{list: id, people?: [names], blinded?: true | false}: who checks a verification list, and whether they see each other\'s checks before their own', does: (s, c) => {
    const l = setListPeople(s, str(c.list), { people: c.people, blinded: c.blinded });
    return `${l.id}: ${l.people.join(', ') || 'no one named'}${l.blinded ? ', blinded' : ''}`;
  } },
  person_check: { doc: '{item: "ta:<record>" | "ft:<record>" | "value:<record>:<field>[@armN]" | "study:<record>", person, decision?: include | exclude | uncertain (a screening item), reason? (exclude), verdict?: agree | disagree | unsure (a value), value?: the correct value, note?, list?}: a person\'s own check; never from an agent', does: (s, c) => {
    const e = recordCheck(s, { item: str(c.item), person: str(c.person), decision: str(c.decision), reason: str(c.reason), verdict: str(c.verdict), value: str(c.value), note: str(c.note), list: str(c.list), ...(c.at ? { at: str(c.at) } : {}) });
    return `${str(c.item)}: ${e.by} ${e.decision || e.verdict}${e.reason ? ` (${e.reason})` : ''}`;
  } },
  remove_person_check: { doc: '{item, person}: takes a person\'s check back; never from an agent', does: (s, c) => {
    if (!removeCheck(s, { item: str(c.item), person: str(c.person) })) throw new Error(`${str(c.person)} has no check of ${str(c.item)}`);
    return `${str(c.item)}: ${str(c.person)}'s check taken back`;
  } },
  reconcile_check: { doc: '{item, by, decision? | verdict?, reason?, value?, note: why}: the pair\'s final word on an item they checked differently; never from an agent', does: (s, c) => {
    const e = reconcile(s, { item: str(c.item), by: str(c.by), decision: str(c.decision), reason: str(c.reason), verdict: str(c.verdict), value: str(c.value), note: str(c.note) });
    return `${str(c.item)}: reconciled as ${e.decision || e.verdict}`;
  } },
  set_rob_readers: { doc: '{on: true | false, people?: {a: name, b: name}}: risk of bias by two people and the model; on moves each record\'s reviewer A answers (the model\'s) to the model\'s own slot', does: (s, c) => {
    setModelReader(s, Boolean(c.on), allTools(s).map(t => t.id), { people: c.people || null, by: str(c.by) });
    return c.on ? `two people${c.people ? ` (${str(c.people.a)}, ${str(c.people.b)})` : ''} and the model` : 'the model reader off';
  } },
  record_instruction: { doc: '{name, stage: ta | ft | extraction | rob | eligibility | other, text, file?, fileAt?, reconstructed?: true (read back from files after the work), how?}: an instruction given to a model; answers its id (ins-<hash>)', does: (s, c) => {
    const id = putInstruction(s, { name: str(c.name), stage: str(c.stage || 'other'), text: str(c.text), file: str(c.file), fileAt: str(c.fileAt), reconstructed: Boolean(c.reconstructed), how: str(c.how), ...(c.at ? { at: str(c.at) } : {}), by: str(c.by) });
    return `${id}: ${str(c.name) || 'instruction'}`;
  } },
  record_model_run: { doc: '{instruction: id or the text it was given, stage?, name?, models: [{name, version?}], records: [record ids or labels], at?, file?, reconstructed?, how?}: a model run under an instruction and the records it decided', does: (s, c) => {
    const ins = str(c.instruction).startsWith('ins-') ? str(c.instruction) : instructionId(str(c.instruction));
    const recs = (c.records || []).map(r => paperRef(s, r)?.id || '').filter(Boolean);
    if ((c.records || []).length && !recs.length) throw new Error('none of the records is in the project');
    const id = putRun(s, { id: str(c.id), instruction: ins, stage: str(c.stage), name: str(c.name), models: c.models || [], records: recs, at: str(c.at), by: str(c.by), file: str(c.file), reconstructed: Boolean(c.reconstructed), how: str(c.how) });
    return `${id}: ${recs.length} record${recs.length === 1 ? '' : 's'}`;
  } },
  set: { doc: '{path: ["synthesis", "settings", "signExcludeCritical"], value}: any other field, by its path from the top of the project', does: (s, c) => {
    const { parent, last } = walk(s, c.path, true); parent[last] = c.value;
    // records set whole (the tools' write-back sets a changed section): an id in both main's and a scenario's is kept apart as on load
    // (lib/search-library.mjs separateRecords, which says so); the Rust `lykos apply` hands such a set to Node
    if (Array.isArray(c.path) && ['papers', 'scenarioPapers'].includes(c.path[0])) separateRecords(s);
    return `${c.path.join('.')} set`;
  } },
  unset: { doc: '{path}: removes a field (an entry of an object; an array entry by its index)', does: (s, c) => {
    const { parent, last } = walk(s, c.path, false);
    if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last];
    return `${c.path.join('.')} removed`;
  } },
};

// the words each kind of Package item has: a table its notes too; a document item (a generated log) only its title
const ITEM_TEXT = { table: ['title', 'legend', 'notes'], figure: ['title', 'legend'], other: ['title'] };
/** The Package item a reference names: its id, its label now ("Table 2", "Figure S1") or its title; one only. */
function packageItem(s, ref) {
  const items = s.package?.items || {}, r = str(ref).trim(), low = r.toLowerCase().replace(/\s+/g, ' ');
  if (!r) throw new Error('set_item_text needs item: a Package item id, label or title');
  if (!s.package || !Object.keys(items).length) throw new Error('set_item_text: the project has no Package items');
  const L = labels(s.package);
  const found = items[r] ? [r] : (() => { const byLabel = Object.keys(items).filter(id => str(L.get(id)).toLowerCase() === low); return byLabel.length ? byLabel : Object.keys(items).filter(id => str(items[id].title).trim().toLowerCase() === low); })();
  if (found.length > 1) throw new Error(`set_item_text: ${r} names ${found.length} items (${found.map(id => id).join(', ')}); give the item's id`);
  if (!found.length) throw new Error(`set_item_text: no Package item ${r} (items: ${Object.keys(items).slice(0, 12).map(id => L.get(id) || id).join(', ')}${Object.keys(items).length > 12 ? ', …' : ''})`);
  const id = found[0];
  return { id, it: items[id], label: L.get(id) || items[id].title || id };
}

// two values alike whatever the order of their keys (a change file read back from JSON keeps its own order)
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(y => [y, x[y]])) : x));
const same = (a, b) => canon(a) === canon(b);

function walk(s, path, make) {
  if (!Array.isArray(path) || !path.length) throw new Error('path must be a non-empty list');
  if (LOCKED.has(path[0])) throw new Error(`${path[0]} is the app's own`);
  if (path[0] === 'values' && path.length > 1) throw new Error('use set_value for values (it keeps the value record whole)');
  let o = s;
  for (const k of path.slice(0, -1)) {
    if (o[k] == null) { if (!make) throw new Error(`no ${path.join('.')}`); o[k] = {}; }
    if (typeof o[k] !== 'object') throw new Error(`${k} in ${path.join('.')} is not an object`);
    o = o[k];
  }
  if (!make && !(path.at(-1) in o)) throw new Error(`no ${path.join('.')}`);
  return { parent: o, last: path.at(-1) };
}

/** Ops a person records for themselves: an agent's change file (the MCP server, the app's assistant, LYKOS_AGENT) cannot carry them. */
export const PERSON_OPS = Object.freeze(['person_check', 'remove_person_check', 'reconcile_check']);
/** The change of a file only a person may make, or null: a person op, or a raw set/unset into the people's checks. */
export function personOnly(f) {
  return (f?.changes || []).find(c => PERSON_OPS.includes(c?.op)
    || ((c?.op === 'set' || c?.op === 'unset' || c?.op === 'set_if') && Array.isArray(c.path) && c.path[0] === 'verification' && (c.path[1] === 'checks' || c.path[1] === 'reconciled' || c.path.length === 1))) || null;
}

/**
 * Ops that change what the review is: its question, criteria, amendments and eligibility rules. An agent's file that holds one is not
 * applied but held in .lykos/inbox/held/ until the owner accepts it in the app or at their own terminal (tools/lykos-apply.mjs --accept).
 * 2 Nov 2026: an agent withdrew the English-only criterion "on the owner's instruction", which the owner had never given.
 */
export const OWNER_OPS = Object.freeze(['set_protocol', 'set_criterion', 'add_amendment', 'set_eligibility_rules']);
const OWNER_PATHS = ['protocol', 'eligibilityRules'];
// a protocol scenario (protocol.scenarios, lib/scenarios.mjs) is an alternative the owner explores, not the review's protocol
const withoutScenarios = p => JSON.stringify(p && typeof p === 'object' ? { ...p, scenarios: undefined } : p ?? null);
/**
 * The change of a file only the owner may accept, or null: an owner op, or a raw set/unset into the protocol or the eligibility rules.
 * A write into protocol.scenarios is not one; a whole `protocol` written back (lykos-flow writes each top-level key a run changed) is one
 * only where it differs from `current` (the project, or a function answering it) outside the scenarios, and always when `current` is not given.
 */
export function ownerOnly(f, current) {
  let now;
  const protocolNow = () => { now ??= { s: typeof current === 'function' ? current() : current }; return now.s?.protocol; };
  return (f?.changes || []).find(c => {
    if (OWNER_OPS.includes(c?.op)) return true;
    // a scale decision on a governed protocol files an amendment (lib/scales.mjs): the owner's, as add_amendment is; so is one written by a
    // raw set into synthesis.scales, and one in a file whose other changes may govern the protocol (a version, a registration)
    if (scaleWrite(c)) {
      if (!current || (f.changes || []).some(x => ['set', 'unset', 'set_if'].includes(x?.op) && Array.isArray(x.path) && ['protocol', 'protocolVersions', 'paper'].includes(x.path[0]))) return true;
      now ??= { s: typeof current === 'function' ? current() : current };
      return governed(now.s || {}) && (c.op === 'decide_scale' || c.path.length > 1 || JSON.stringify(c.value?.scales ?? null) !== JSON.stringify(now.s?.synthesis?.scales ?? null));
    }
    if (!['set', 'unset', 'set_if'].includes(c?.op) || !Array.isArray(c.path) || !OWNER_PATHS.includes(c.path[0])) return false;
    if (c.path[0] === 'protocol' && c.path[1] === 'scenarios') return false;
    if (c.path[0] === 'protocol' && c.path.length === 1 && c.op !== 'unset' && current) return withoutScenarios(c.value) !== withoutScenarios(protocolNow());
    return true;
  }) || null;
}

/** A change that decides a scale: decide_scale, or a raw set, unset or set_if into synthesis.scales (or the whole synthesis). */
export const scaleWrite = c => c?.op === 'decide_scale' || (['set', 'unset', 'set_if'].includes(c?.op) && Array.isArray(c.path) && c.path[0] === 'synthesis' && (c.path.length === 1 || c.path[1] === 'scales'));

/** Whether a parsed file is a change file, and what is wrong with it if not. */
export function checkFile(f) {
  if (!f || typeof f !== 'object' || f.kind !== KIND) return `not a change file (kind must be "${KIND}")`;
  if (!Array.isArray(f.changes) || !f.changes.length) return 'changes must be a non-empty list';
  const bad = f.changes.find(c => !CHANGE_FILE_OPS[c?.op]);
  return bad ? `unknown op ${bad?.op} (ops: ${Object.keys(CHANGE_FILE_OPS).join(', ')})` : '';
}

/** Applies every change of a file to a copy of the state: { state, applied: [lines] } or { errors: [lines] } (nothing applied). */
export function applyChanges(state, file) {
  const problem = checkFile(file);
  if (problem) return { errors: [problem] };
  const s = structuredClone(state); s.values ||= {};
  const applied = [], errors = [];
  file.changes.forEach((c, i) => { try { applied.push(CHANGE_FILE_OPS[c.op].does(s, c)); } catch (e) { errors.push(`change ${i + 1} (${c.op}): ${e.message}`); } });
  return errors.length ? { errors } : { state: s, applied };
}

/**
 * Applies a file that applyChanges has just applied without errors to `s` itself, in place: the app's store, whose proxy records which
 * parts changed, so an accepted change saves those parts only (lib/held-changes.mjs). Answers the lines.
 */
export function applyInPlace(s, file) {
  s.values ||= {};
  return file.changes.map(c => CHANGE_FILE_OPS[c.op].does(s, c));
}

const NOUN = { propose_outcome_rows: 'outcome-row proposal', accept_outcome_rows: 'outcome-row acceptance', decide_scale: 'scale decision', put_instrument: 'project scale', put_crosswalk: 'crosswalk', set_value: 'value', remove_value: 'value removal', set_prisma: 'PRISMA count', set_protocol: 'protocol field', set_criterion: 'criterion', add_amendment: 'amendment',
  add_task: 'task', update_task: 'task', remove_notes: 'note removal', remove_results: 'result removal', convert_item: 'Package item', move_file: 'file move', attach_pdf: 'PDF',
  screen: 'screening decision', appraise: 'appraisal answer', merge_records: 'merge', distinct_records: 'record pair', update_record: 'record', put_records: 'record batch', remove_records: 'record removal', set_arm_facets: 'arm\'s levels',
  fill_arm_facets: 'fill of the arms\' levels', set_overlap: 'overlap group', renumber_studies: 'study order', report_of: 'report link', not_retrieved: 'unretrieved report', set_journal: 'journal choice', set_eligibility_rules: 'eligibility rule set', put_value: 'value', add_note: 'note', set_if: 'field', settle_value: 'value decision', set_item_text: 'item text', log_search: 'search run', update_search: 'search run', register_output: 'registered output', save_output: 'output', set_scenario: 'scenario', assign_run: 'scenario run',
  set_verification_lists: 'verification list set', set_list_people: 'list\'s people', person_check: 'person check', remove_person_check: 'check removal', reconcile_check: 'reconciliation',
  set_rob_readers: 'risk-of-bias readers', record_instruction: 'model instruction', record_model_run: 'model run', set: 'field', unset: 'field removal' };
const plural = (n, w) => (n === 1 ? w : /'s levels$/.test(w) ? w.replace(/'s levels$/, 's\' levels') : /y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
/**
 * What a change file does, for its card and its record: its own `what` (or `label`, `title`), else its ops counted ("Changing 12 values and
 * 3 screening decisions"). Before (28 Oct 2026) a file without `what` showed "Applying: Change file 1".
 */
export function changeFileWhat(f) {
  const own = str(f?.what || f?.label || f?.title).trim();
  if (own) return own;
  const counts = new Map();
  for (const c of f?.changes || []) { const k = NOUN[c?.op] || 'change'; counts.set(k, (counts.get(k) || 0) + 1); }
  const parts = [...counts].map(([w, n]) => `${n} ${plural(n, w)}`);
  return parts.length ? `Changing ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}` : 'Changing the project';
}

/** The ops as one text, for an agent: `node tools/lykos-apply.mjs --ops`. */
export const opsText = () => Object.entries(CHANGE_FILE_OPS).map(([n, o]) => `${n} ${o.doc}`).join('\n');

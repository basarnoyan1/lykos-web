// Batch extraction: every study of a review in one run, rules before models.
//
// A review of 67 studies cannot be read one chat per PDF. This module reads the
// remaining ones, in two tiers, and keeps the second tier for what needs it:
//
//   1. plan      which studies x columns are still empty. A cell that holds a
//                value, a pending proposal or a lock is never asked for again,
//                so a stopped or crashed run is resumed by running it again.
//   2. cheap     one run per study (lib/agent.mjs runFill) with the model the
//                person assigned to "Fill and verify". Its proposals already
//                carry a quote found in the PDF and passed the numeric gate.
//   3. QA        before any other model sees the results, the app checks every
//                proposed cell against the table's cell rules (lib/cell-rules.mjs
//                rulesOf, checkTable, requiredMissing), the numeric gate
//                (lib/numeric-gate.mjs gateProposal) and the evidence it has to
//                carry. For patient rows the rules are lib/patient-rules.mjs
//                (extent of resection against imaging, follow-up after death,
//                no follow-up, no MRI). A cell with nothing wrong is stamped
//                `qa: clean`; the rest are exceptions with the sentence of each
//                rule they broke.
//   4. escalate  only the exceptions go to the stronger model (the one assigned
//                to "Extraction", when it is a different model), once, each with
//                what was found wrong. Whatever still fails is left for a person.
//
// Nothing is verified here. A clean cell stays a proposal, only stamped; it
// reaches the table when a person accepts it (lib/proposals.mjs accept). Patient
// rows wait in `ipdProposals` (lib/ipd.mjs) and join the participants the same
// way, each with the quote behind every cell.
//
// The run is dependency-injected (`deps`) so a test can drive it with a fake model;
// the defaults are the real ones.
import { get, update } from '../store.mjs';
import { columnsOf, templateById } from './templates.mjs';
import { studies as studiesOf } from './screen.mjs';
import { rulesOf, checkTable, requiredMissing, parseCellKey, countRules, ruleDetail, kindLabel, active } from './cell-rules.mjs';
import { gateProposal } from './numeric-gate.mjs';
import { propose as storePropose, isUnsupported } from './proposals.mjs';
import { runFill, runVerify } from './agent.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { writeOutputs } from './project-folder.mjs';
import { columns as ipdColumns, proposeParticipants, patchParticipantProposal } from './ipd.mjs';
import { checkPatient, withPatientColumns, patientRuleList, patientRulesOf, conventionRows, conventionsPrompt } from './patient-rules.mjs';
import { markRead, settledPapers } from './case-intake.mjs';
import { definePrompt, fence, GUARDS } from './prompts.mjs';
import { completeTools, modelInfo, parseJsonArray } from './ai.mjs';
import { index as docIndex, pageText, locateIn } from './doctext.mjs';
import { stripReferences } from './text-clip.mjs';

const DEFAULT_BUDGET = { calls: 40, tokens: 150000 };
const MAX_WIDTH = 4;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cellKey = (paperId, columnId) => `${paperId}:${columnId}`;
const stampOf = (status, reasons, tier, escalated) => ({ status, reasons, tier, escalated: !!escalated, at: new Date().toISOString() });
/** A stamp that says what the proposal already carries is not written again: a project of 67 studies would otherwise repaint for every cell of every sweep. */
const sameStamp = (a, b) => !!a && a.status === b.status && a.tier === b.tier && !!a.escalated === !!b.escalated && JSON.stringify(a.reasons) === JSON.stringify(b.reasons);

// ---- planning --------------------------------------------------------------------------

/** The studies a scope names: 'included' (the included studies, or every record before screening starts), 'all', or 'selected' (`paperIds`). */
export function poolOf(state, { scope = 'included', paperIds = null } = {}) {
  const papers = state.papers || [];
  if (scope === 'selected') { const ids = new Set(paperIds || []); return papers.filter(p => ids.has(p.id)); }
  return scope === 'all' ? papers : studiesOf(state);
}

/** A proposal no rule check has stamped, or one the rules flagged that no stronger model has looked at: work for a resumed batch. */
const needsQa = p => !p?.qa || (p.qa.status === 'exception' && !p.qa.escalated);
const valueHeld = v => !!v && (v.availability === 'not_found' || String(v.reported_value ?? '').trim() !== '');
/** paper id -> Set of column ids having a value (held), a pending proposal, or a lock, read in one pass over the project. */
function cellStatus(state) {
  const held = new Map(), proposed = new Map(), locked = new Map();
  const add = (map, key) => { const k = parseCellKey(key); if (!k) return; if (!map.has(k.paperId)) map.set(k.paperId, new Set()); map.get(k.paperId).add(k.columnId); };
  for (const [key, v] of Object.entries(state.values || {})) { if (v?.locked) add(locked, key); if (valueHeld(v)) add(held, key); }
  for (const key of Object.keys(state.proposals || {})) add(proposed, key);
  return { held, proposed, locked };
}

/**
 * What a table batch would ask for: { tasks: [{ paperId, label, columnIds, itemIds }], papers, cells, carried, skipped }.
 * `columnIds` are the cells still empty (what the model is asked for); `carried` counts pending model proposals that no rule
 * check has stamped yet, or that it flagged and no stronger model has seen (an earlier run was stopped): they are checked, with no
 * model call, and join the exceptions.
 */
export function planCells(state, { templateId = 'default', scope = 'included', paperIds = null, columnIds = null } = {}) {
  const columns = columnsOf(templateId, state).filter(c => !c.derived && (!columnIds?.length || columnIds.includes(c.id)));
  const status = cellStatus(state);
  const skipped = { held: 0, proposed: 0, locked: 0, noPdf: 0 };
  const tasks = [];
  const unstamped = new Map();
  const wanted = new Set(columns.map(c => c.id));
  for (const [key, p] of Object.entries(state.proposals || {})) {
    const k = parseCellKey(key);
    if (!k || !wanted.has(k.columnId) || !needsQa(p) || (p?.origin && p.origin !== 'model')) continue;
    if (!unstamped.has(k.paperId)) unstamped.set(k.paperId, new Set());
    unstamped.get(k.paperId).add(k.columnId);
  }
  let carried = 0;
  for (const p of poolOf(state, { scope, paperIds })) {
    const pending = [...(unstamped.get(p.id) || [])];
    carried += pending.length;
    if (!p.pdf) { skipped.noPdf++; if (pending.length) tasks.push({ paperId: p.id, label: p.label || p.title || p.id, columnIds: [], itemIds: pending }); continue; }
    const want = [];
    for (const c of columns) {
      if (status.locked.get(p.id)?.has(c.id)) { skipped.locked++; continue; }
      if (status.held.get(p.id)?.has(c.id)) { skipped.held++; continue; }
      if (status.proposed.get(p.id)?.has(c.id)) { skipped.proposed++; continue; }
      want.push(c.id);
    }
    if (want.length || pending.length) tasks.push({ paperId: p.id, label: p.label || p.title || p.id, columnIds: want, itemIds: [...new Set([...want, ...pending])] });
  }
  const fresh = tasks.filter(t => t.columnIds.length);
  return { mode: 'cells', templateId, scope, tasks, papers: fresh.length, cells: fresh.reduce((n, t) => n + t.columnIds.length, 0), carried, skipped, columns: columns.length };
}

/** What a patient batch would ask for: every study of the scope with a PDF and no patient (accepted or proposed) yet. */
export function planPatients(state, { scope = 'included', paperIds = null } = {}) {
  const have = new Set([...(state.participants || []).map(p => p.study_id), ...(state.ipdProposals || []).map(p => p.study_id), ...settledPapers(state)]);   // settled: the intake queue left it out or has read it
  const skipped = { held: 0, proposed: 0, locked: 0, noPdf: 0 };
  const tasks = [];
  let carried = 0;
  const unstamped = new Map();
  for (const p of state.ipdProposals || []) if (needsQa(p)) { if (!unstamped.has(p.study_id)) unstamped.set(p.study_id, []); unstamped.get(p.study_id).push(p.id); }
  for (const p of poolOf(state, { scope, paperIds })) {
    const pending = unstamped.get(p.id) || [];
    carried += pending.length;
    const label = p.label || p.title || p.id;
    if (have.has(p.id)) { skipped.proposed++; if (pending.length) tasks.push({ paperId: p.id, label, columnIds: [], itemIds: pending }); continue; }
    if (!p.pdf) { skipped.noPdf++; continue; }
    tasks.push({ paperId: p.id, label, columnIds: ['*'], itemIds: [] });
  }
  const fresh = tasks.filter(t => t.columnIds.length);
  return { mode: 'patients', scope, tasks, papers: fresh.length, cells: null, carried, skipped };
}

export const planOf = (state, opts = {}) => opts.mode === 'patients' ? planPatients(state, opts) : planCells(state, opts);

/**
 * A dry run: what a batch would do, with no model called. Model runs are exact (one per study with something missing);
 * model calls are bounded by the run budget, not predicted; escalation depends on what the rules flag, which is unknown until
 * the first tier has run.
 */
export function dryRun(opts = {}, { state = get(), budget = DEFAULT_BUDGET, cheapModel = '', strongModel = '' } = {}) {
  const plan = planOf(state, opts);
  const labels = new Map(columnsOf(opts.templateId || 'default', state).map(c => [c.id, c.label]));
  const fresh = plan.tasks.filter(t => t.columnIds.length);
  return {
    mode: plan.mode, scope: plan.scope, papers: plan.papers, cells: plan.cells, carried: plan.carried, skipped: plan.skipped,
    modelRuns: plan.papers, maxModelCalls: plan.papers * (budget.calls || DEFAULT_BUDGET.calls),
    cheapModel, escalation: strongModel ? { model: strongModel, runs: 'only for studies with a flagged cell, at most one run each' } : null,
    list: fresh.map(t => ({ paperId: t.paperId, label: t.label, columns: t.columnIds[0] === '*' ? ['patients'] : t.columnIds.map(id => labels.get(id) || id) })),
  };
}

// ---- rule QA ---------------------------------------------------------------------------

const textOfProposal = p => p?.availability === 'not_found' ? 'NR' : String(p?.value ?? '');
const GATE_LABEL = { 'number-not-in-quote': 'Number not in its quote', 'number-computed': 'Number computed, not stated', 'count-over-denominator': 'Count above its denominator', 'count-over-arm-size': 'Count above the arm size',
  percentage: 'Percentage does not follow from the counts', 'ambiguous-scalar': 'More than one number in the value', unit: 'Unit', 'time-point': 'Time point', denominator: 'Denominator' };
const gateLabel = kind => GATE_LABEL[kind] || 'Numeric gate';
const reasonOf = f => ({ source: 'rule', id: f.rule.id, label: String(f.rule.message || kindLabel(f.rule.kind) || 'Rule').slice(0, 80), message: f.found ? `${f.message}: ${clip(f.found, 80)}${f.hint ? ` (${f.hint})` : ''}` : f.message });

/**
 * The rule check of the proposed cells of one study: Map(column id -> { status, reasons, value, key }) over `task.itemIds`.
 *   clean       a proposal that breaks no rule, passes the gate and carries a quote
 *   exception   a proposal that does not, or a required cell no one proposed
 *   unproposed  a cell the run left empty that no rule requires
 * Pure over `state`: it asks no model. The table's other pending proposals count as values, so a rule that compares a cell with
 * the rest of its column (a spelling, a unique label) sees them.
 */
export function qaCells(state, templateId, task) {
  const template = templateById(templateId, state), columns = columnsOf(templateId, state);
  const byId = new Map(columns.map(c => [c.id, c]));
  const merged = { ...(state.values || {}) };
  for (const [key, p] of Object.entries(state.proposals || {})) {
    const k = parseCellKey(key);
    if (k && byId.has(k.columnId)) merged[key] = { reported_value: textOfProposal(p), availability: p.availability };
  }
  const rules = template && rulesOf({ ...template, columns }, state);
  const found = rules && countRules(rules) ? checkTable(merged, { ...template, columns }, rules) : { cells: new Map() };
  const paper = (state.papers || []).find(p => p.id === task.paperId);
  const missing = new Set(requiredMissing(merged, paper ? [paper] : [{ id: task.paperId }], columns).map(m => m.key));
  const out = new Map();
  for (const columnId of task.itemIds) {
    const key = cellKey(task.paperId, columnId), p = state.proposals?.[key], column = byId.get(columnId);
    const label = column?.label || columnId;
    if (!p) {
      const required = missing.has(key);
      out.set(columnId, { key, label, value: '', status: required ? 'exception' : 'unproposed', reasons: required ? [{ source: 'required', id: 'f:required', label: 'Required value missing', message: 'Required, and the model proposed no value' }] : [] });
      continue;
    }
    const reasons = (found.cells.get(key) || []).map(reasonOf);
    for (const f of gateProposal(p, { columns }).findings) reasons.push({ source: 'gate', id: f.kind, label: gateLabel(f.kind), message: f.message });
    for (const f of p.findings || []) if (!reasons.some(r => r.source === 'gate' && r.message === f.message)) reasons.push({ source: 'gate', id: f.kind, label: gateLabel(f.kind), message: f.message });
    if (isUnsupported(p)) reasons.push({ source: 'evidence', id: 'unsupported', label: 'No quote located', message: 'No quote from the paper was located for this value' });
    if (p.availability === 'conflicting') reasons.push({ source: 'model', id: 'conflicting', label: 'Conflicting values', message: 'The paper states conflicting values' });
    out.set(columnId, { key, label, value: textOfProposal(p), status: reasons.length ? 'exception' : 'clean', reasons });
  }
  return out;
}

/** The core cells of a patient row that carry a value and so need a quote. */
const NO_QUOTE_NEEDED = new Set(['label', 'case_no', 'year', 'strategy']);

/** The rule check of the proposed patient rows of one study: Map(proposal id -> { status, reasons, value }). */
export function qaPatients(state, task, { columns = null } = {}) {
  const cols = withPatientColumns(columns || state.ipdColumns || ipdColumns()).map(c => ({ id: c.id, label: c.name || c.id, type: c.type, unit: c.unit }));
  const out = new Map();
  for (const id of task.itemIds) {
    const p = (state.ipdProposals || []).find(x => x.id === id); if (!p) continue;
    const reasons = checkPatient(p.cells, patientRulesOf(state)).map(r => ({ source: 'rule', id: r.id, label: r.rule, message: r.message, columns: r.columns }));
    for (const [column, value] of Object.entries(p.cells || {})) {
      if (NO_QUOTE_NEEDED.has(column) || String(value ?? '').trim() === '') continue;
      const quotes = (p.evidence?.[column] || []).filter(e => e?.quote);
      if (!quotes.length) { reasons.push({ source: 'evidence', id: 'unsupported', label: 'No quote located', message: `No quote from the report was located for ${cols.find(c => c.id === column)?.label || column}`, columns: [column] }); continue; }
      if (!['number', 'integer'].includes(cols.find(c => c.id === column)?.type)) continue;   // a coded cell (progression 0/1, a level) states no number of its own
      for (const f of gateProposal({ column_id: column, value: String(value), availability: 'present', evidence: quotes.map(e => ({ kind: 'text', quote: e.quote })) }, { columns: cols }).findings)
        reasons.push({ source: 'gate', id: f.kind, label: gateLabel(f.kind), message: `${cols.find(c => c.id === column)?.label || column}: ${f.message}`, columns: [column] });
    }
    out.set(id, { key: id, label: p.cells?.label || p.cells?.case_no || 'patient', value: '', status: reasons.length ? 'exception' : 'clean', reasons, cells: p.cells });
  }
  return out;
}

// ---- adapters: what differs between a table of cells and a list of patients ------------------

const sumUsage = (acc, u) => {
  if (!u) { acc.known = false; return acc; }
  if (!Number.isFinite(u.prompt) || !Number.isFinite(u.completion)) acc.known = false;
  acc.prompt += u.prompt || 0; acc.completion += u.completion || 0;
  if (u.cost != null) acc.cost = (acc.cost || 0) + u.cost;
  return acc;
};
const newUsage = () => ({ prompt: 0, completion: 0, cost: null, known: true });

function cellsAdapter(opts, deps) {
  const { templateId = 'default' } = opts;
  return {
    mode: 'cells',
    plan: state => planCells(state, opts),
    qa: (state, task) => qaCells(state, templateId, task),
    stamp(task, results, { tier, escalated }) {
      for (const r of results.values()) {
        const p = deps.state().proposals?.[r.key];
        const qa = stampOf(r.status === 'clean' ? 'clean' : 'exception', r.reasons, tier, escalated);
        if (p && !sameStamp(p.qa, qa)) deps.propose(task.paperId, { ...p, qa });
      }
    },
    async fill(task, io) {
      const run = await deps.fill({ paperId: task.paperId, templateId, cfg: io.tier.cfg, model: io.tier.model, budget: io.budget, signal: io.signal, onStep: io.onStep, onRunStart: io.onRunStart, only: task.columnIds });
      return { run: { id: run?.id, status: run?.status, error: run?.error, usage: run?.usage } };
    },
    async recheck(task, flagged, io) {
      const text = Object.fromEntries(flagged.map(f => [f.itemId, `${f.value || '(no value proposed)'} - flagged: ${f.reasons.map(r => r.message).join('; ')}`]));
      const run = await deps.recheck({ paperId: task.paperId, templateId, cfg: io.tier.cfg, model: io.tier.model, budget: io.budget, signal: io.signal, onStep: io.onStep, onRunStart: io.onRunStart, only: flagged.map(f => f.itemId), flagged: text });
      return { run: { id: run?.id, status: run?.status, error: run?.error, usage: run?.usage } };
    },
  };
}

function patientsAdapter(opts, deps) {
  return {
    mode: 'patients',
    plan: state => planPatients(state, opts),
    qa: (state, task) => qaPatients(state, task),
    stamp(task, results, { tier, escalated }) {
      for (const [id, r] of results) {
        const qa = stampOf(r.status === 'clean' ? 'clean' : 'exception', r.reasons, tier, escalated);
        if (!sameStamp((deps.state().ipdProposals || []).find(x => x.id === id)?.qa, qa)) deps.patchPatient(id, p => { p.qa = { ...qa, ...(p.qa?.prior ? { prior: p.qa.prior } : {}) }; });
      }
    },
    async fill(task, io) {
      const read = await deps.extractPatients({ paperId: task.paperId, cfg: io.tier.cfg, model: io.tier.model, budget: io.budget, signal: io.signal, columns: withPatientColumns(ipdColumns()) });
      if (read.rows?.length) task.itemIds = deps.proposePatients(task.paperId, read.rows, { model: io.tier.model, run_id: read.id || null });
      if (read.reason === 'done') deps.noteRead?.(task.paperId, read.rows?.length || 0);   // the intake queue remembers a report was read, even when it holds no patient
      return { run: { id: read.id, status: read.reason === 'done' ? 'done' : read.reason || 'error', error: read.error, usage: read.usage } };
    },
    async recheck(task, flagged, io) {
      const read = await deps.recheckPatients({ paperId: task.paperId, cfg: io.tier.cfg, model: io.tier.model, budget: io.budget, signal: io.signal,
        flagged: flagged.map(f => ({ id: f.itemId, cells: f.cells, reasons: f.reasons.map(r => r.message) })), columns: withPatientColumns(ipdColumns()) });
      for (const row of read.rows || []) deps.patchPatient(row.id, p => { p.qa = { ...(p.qa || {}), prior: { cells: p.cells, evidence: p.evidence } }; p.cells = { ...p.cells, ...row.cells }; p.evidence = { ...p.evidence, ...row.evidence }; p.model = io.tier.model; });
      return { run: { id: read.id, status: read.reason === 'done' ? 'done' : read.reason || 'error', error: read.error, usage: read.usage } };
    },
  };
}

// ---- the record of a batch ---------------------------------------------------------------
// A batch is one entry of `state.runs` (kind 'batch', beside the per-study runs the cell tier writes): what it was asked to do and
// the report it ended with, so it shows in the earlier runs of the Fill panel and in Patients, and its report can be opened again.
// It carries no `usage`: the calls it made are already counted by the model-call log and by the runs of its studies.
const storeStartRecord = rec => update(s => { s.runs = [rec, ...(s.runs || [])].slice(0, 300); return s; });
const storePatchRecord = (id, fn) => update(s => { const r = (s.runs || []).find(x => x.id === id); if (r) fn(r); return s; });
const EXCEPTIONS_KEPT = 400;

/** How often each rule fired, from the open exceptions: Map(reason id -> { id, label, n }). One count per cell or row, whatever its number of findings of that rule. */
function tallyRules(list) {
  const out = new Map();
  for (const o of list) for (const id of new Set(o.reasons.map(r => r.id))) {
    const r = o.reasons.find(x => x.id === id), e = out.get(id) || { id, label: r.label || clip(r.message, 80), n: 0 };
    e.n++; out.set(id, e);
  }
  return out;
}
/** The report as the record keeps it: counts, the rules that fired, what is left to review (at most EXCEPTIONS_KEPT), tokens only when every call reported them. */
export function compactReport(r, { flagged = null } = {}) {
  const left = tallyRules((r.exceptions || []).map(e => ({ reasons: e.reasons })));
  const first = flagged || new Map();
  const rules = [...new Set([...first.keys(), ...left.keys()])].map(id => ({ id, label: (first.get(id) || left.get(id)).label, flagged: first.get(id)?.n || 0, left: left.get(id)?.n || 0 }))
    .sort((a, b) => b.flagged - a.flagged || b.left - a.left || a.label.localeCompare(b.label));
  return { mode: r.mode, templateId: r.templateId, scope: r.scope, papers: r.papers, studies: r.studies, cells: r.cells, carried: r.carried, clean: r.clean, escalated: r.escalated, fixed: r.fixed,
    remaining: r.remaining, unproposed: r.unproposed, escalation: r.escalation, stopped: !!r.stopped, errors: (r.errors || []).slice(0, 20), rules,
    tokens: r.tokens?.known ? { prompt: r.tokens.prompt, completion: r.tokens.completion, ...(r.tokens.cost != null ? { cost: r.tokens.cost } : {}) } : null,
    exceptionsTotal: (r.exceptions || []).length,
    exceptions: (r.exceptions || []).slice(0, EXCEPTIONS_KEPT).map(e => ({ paperId: e.paperId, paper: e.paper, itemId: e.itemId, label: e.label, value: clip(e.value, 160), escalated: !!e.escalated,
      reasons: e.reasons.map(x => ({ id: x.id, label: x.label || '', message: clip(x.message, 240), source: x.source })) })) };
}

// ---- the run ----------------------------------------------------------------------------

async function pool(items, width, fn, stopped) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
    while (!stopped()) { const i = next++; if (i >= items.length) return; await fn(items[i], i); }
  }));
}

const sameModel = (a, b) => !!a && !!b && a.cfg?.id === b.cfg?.id && a.cfg?.provider === b.cfg?.provider && a.model === b.model;

/**
 * Runs a batch. `opts`:
 *   mode 'cells' | 'patients'; templateId (cells); scope 'included' | 'all' | 'selected'; paperIds; columnIds
 *   cheap { cfg, model }; strong { cfg, model } or null (no escalation); budget { calls, tokens } per run
 *   concurrency (1-4); signal; onStep; onRunStart
 * `h` is a job handle (lib/jobs.mjs): count(done, total), progress(text), stopped().
 * Returns the report; see `reportLine`. A stopped batch returns what it has, stamped, with `stopped: true`.
 */
export async function runBatch(opts = {}, h = null, deps = {}) {
  const d = { state: get, fill: runFill, recheck: runVerify, propose: storePropose, patchPatient: patchParticipantProposal, proposePatients: proposeParticipants,
    extractPatients: extractPatientRow, recheckPatients: recheckPatientRows, startRecord: storeStartRecord, patchRecord: storePatchRecord, noteRead: markRead, ...deps };
  if (!opts.cheap?.cfg) throw new Error('No model is set for extraction');
  const adapter = opts.mode === 'patients' ? patientsAdapter(opts, d) : cellsAdapter(opts, d);
  const strong = opts.strong && !sameModel(opts.strong, opts.cheap) ? opts.strong : null;
  const budget = opts.budget || DEFAULT_BUDGET;
  const width = Math.max(1, Math.min(MAX_WIDTH, Number(opts.concurrency) || 1));
  const ctl = new AbortController();
  opts.signal?.addEventListener?.('abort', () => ctl.abort());
  const stopped = () => !!(h?.stopped?.() || opts.signal?.aborted || ctl.signal.aborted);
  const watcher = setInterval(() => { if (stopped()) ctl.abort(); }, 150); watcher.unref?.();
  const io = tier => ({ tier, budget, signal: ctl.signal, onStep: opts.onStep, onRunStart: opts.onRunStart });
  const startedAt = new Date().toISOString();
  const usage = { cheap: newUsage(), strong: newUsage() };
  const errors = [], runs = [];
  const outcomes = new Map();   // `${paperId}\u0000${itemId}` -> final result
  const read = new Set();       // studies whose first-tier run ended, or that already held proposals: only these have results to check
  let escalatedN = 0, done = 0, total = 0;
  const tick = text => { h?.count?.(done, total); if (text) h?.progress?.(text); };
  const recordId = `batch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let recorded = false;

  // One place checks a study's results against the rules, and one place stamps them. Every other step goes through here.
  const assess = (task, tier, escalated, only = null) => {
    const sub = only ? { ...task, itemIds: only } : task;
    const results = adapter.qa(d.state(), sub);
    adapter.stamp(sub, results, { tier, escalated });
    for (const [itemId, r] of results) outcomes.set(`${task.paperId}\u0000${itemId}`, { ...r, paperId: task.paperId, paper: task.label, itemId, escalated: escalated || outcomes.get(`${task.paperId}\u0000${itemId}`)?.escalated || false });
    return results;
  };

  try {
    const plan = adapter.plan(d.state());
    const tasks = plan.tasks;
    const fresh = tasks.filter(t => t.columnIds.length);
    total = fresh.length; tick(`${fresh.length} studies`);
    if (tasks.length) {
      d.startRecord({ id: recordId, kind: 'batch', mode: adapter.mode, paper_id: null, template_id: adapter.mode === 'patients' ? 'patients' : (opts.templateId || 'default'), scope: opts.scope || 'included',
        model: opts.cheap.model || '', strong: strong?.model || null, startedAt, endedAt: null, status: 'running', report: null, error: null });
      recorded = true;
    }

    // 1. the cheap tier, one run per study
    await pool(fresh, width, async task => {
      try {
        const { run } = await adapter.fill(task, io(opts.cheap));
        read.add(task.paperId);
        runs.push({ id: run.id, paperId: task.paperId, tier: 'cheap', status: run.status, error: run.error || null });
        sumUsage(usage.cheap, run.usage);
        if (run.error && run.status !== 'done') errors.push({ paperId: task.paperId, paper: task.label, error: clip(run.error, 200) });
      } catch (err) {
        if (err?.name === 'AbortError' || stopped()) return;
        errors.push({ paperId: task.paperId, paper: task.label, error: clip(err?.message || err, 200) });
        done++; tick(`${done} of ${total} studies`);
        return;
      }
      assess(task, 'cheap', false);                    // QA before anything else touches the study's results
      done++; tick(`${done} of ${total} studies`);
    }, stopped);
    // proposals left by an earlier run, never checked; and the rules that compare a cell with the rest of its column see the whole batch
    for (const task of tasks) if (task.itemIds.length && (read.has(task.paperId) || !task.columnIds.length)) assess(task, 'cheap', false);

    // 2. escalation: only exceptions, once
    const open = () => [...outcomes.values()].filter(o => o.status === 'exception');
    const firstTier = tallyRules(open());
    const flaggedBy = new Map();
    for (const o of open()) { if (!flaggedBy.has(o.paperId)) flaggedBy.set(o.paperId, []); flaggedBy.get(o.paperId).push(o); }
    const escalation = strong && !stopped() ? [...flaggedBy.entries()] : [];
    total += escalation.length; tick();
    await pool(escalation, width, async ([paperId, flagged]) => {
      const task = tasks.find(t => t.paperId === paperId);
      escalatedN += flagged.length;
      try {
        const { run } = await adapter.recheck(task, flagged.map(o => ({ itemId: o.itemId, value: o.value, reasons: o.reasons, cells: o.cells })), io(strong));
        runs.push({ id: run.id, paperId, tier: 'strong', status: run.status, error: run.error || null });
        sumUsage(usage.strong, run.usage);
        if (run.error && run.status !== 'done') errors.push({ paperId, paper: task.label, error: clip(run.error, 200), tier: 'strong' });
      } catch (err) {
        if (!(err?.name === 'AbortError' || stopped())) errors.push({ paperId, paper: task.label, error: clip(err?.message || err, 200), tier: 'strong' });
      }
      assess(task, 'strong', true, flagged.map(o => o.itemId));   // the stronger model's answer is checked by the same rules
      done++; tick(`${done} of ${total} studies`);
    }, stopped);
    const fixed = [...outcomes.values()].filter(o => o.escalated && o.status === 'clean').length;

    const all = [...outcomes.values()];
    const exceptions = all.filter(o => o.status === 'exception');
    const tokens = { cheap: { ...usage.cheap }, strong: { ...usage.strong },
      prompt: usage.cheap.prompt + usage.strong.prompt, completion: usage.cheap.completion + usage.strong.completion,
      cost: usage.cheap.cost == null && usage.strong.cost == null ? null : (usage.cheap.cost || 0) + (usage.strong.cost || 0),
      known: usage.cheap.known && usage.strong.known };
    const report = {
      id: recorded ? recordId : null,
      mode: adapter.mode, templateId: opts.templateId || null, scope: opts.scope || 'included', startedAt, endedAt: new Date().toISOString(),
      papers: fresh.length, studies: tasks.length, cells: all.filter(o => o.status !== 'unproposed').length, carried: plan.carried,
      clean: all.filter(o => o.status === 'clean').length, escalated: escalatedN, fixed, remaining: exceptions.length,
      unproposed: all.filter(o => o.status === 'unproposed').length,
      escalation: strong ? strong.model : (opts.strong ? 'off: the Extraction model is the Fill model' : 'off'),
      stopped: stopped(), skipped: plan.skipped, errors, runs, tokens,
      exceptions: exceptions.map(o => ({ paperId: o.paperId, paper: o.paper, itemId: o.itemId, label: o.label, value: o.value, reasons: o.reasons, escalated: o.escalated })),
    };
    report.rules = compactReport(report, { flagged: firstTier }).rules;
    if (recorded) d.patchRecord(recordId, r => { r.endedAt = report.endedAt; r.status = report.stopped ? 'stopped' : 'done'; r.report = compactReport(report, { flagged: firstTier }); });
    return report;
  } catch (err) {
    if (recorded) d.patchRecord(recordId, r => { r.endedAt = new Date().toISOString(); r.status = err?.name === 'AbortError' ? 'stopped' : 'error'; r.error = clip(err?.message || err, 200); });
    throw err;
  } finally { clearInterval(watcher); }
}

/** One line for a person: "12 studies, 340 cells: 301 clean, 8 fixed by the stronger model, 31 left to review". */
export function reportLine(r) {
  if (!r) return '';
  const unit = r.mode === 'patients' ? 'patients' : 'cells';
  const parts = [`${r.papers} ${r.papers === 1 ? 'study' : 'studies'}, ${r.cells} ${unit}: ${r.clean} clean`];
  if (r.escalated) parts.push(`${r.escalated} sent to the stronger model, ${r.fixed} fixed`);
  parts.push(`${r.remaining} to review`);
  if (r.unproposed) parts.push(`${r.unproposed} left empty`);
  if (r.errors?.length) parts.push(`${r.errors.length} failed`);
  if (r.stopped) parts.push('stopped');
  return parts.join(', ');
}

// ---- patients: reading rows from a report -------------------------------------------------

export const PATIENT_EXTRACT = definePrompt({ id: 'extract.patients', version: 1, task: 'fill', guard: 'none', brief: 'none', maxTokens: 4000,
  text: `${GUARDS.full}

You read one report and list the individual patients it describes, one row each. A case report is one row; a series gives a row for each patient it describes one by one. If the report gives only group totals, reply [].
Reply with a JSON array only. Each element: {"case_no": the report's case number or "", "cells": {column id: value as text}, "evidence": {column id: a verbatim quote that states the value}}.
Rules: quote the report verbatim for every cell you fill; leave a cell out rather than guess; never compute a value the report does not state. "eor" is GTR, STR, PR or Bx as the report describes the resection; "event" is 1 for progression, recurrence or tumour-attributed death and 0 for none; "time" is follow-up in months; "outcome" is the patient's status in the report's own words; "imaging" is what the postoperative imaging showed, in the report's words, and its modality; "death" is months from surgery to death when the patient died.` });

const patientCodebook = columns => `Patient columns (use the id as the key):\n${columns.map(c => `- ${c.id} - ${c.name || c.label || c.id}${c.type && c.type !== 'text' ? ` (${c.type})` : ''}${c.levels?.length ? `: ${c.levels.join(', ')}` : ''}`).join('\n')}`;

const conventionMessage = text => text ? [{ role: 'system', content: text }] : [];

/** A report's text for a request: references left out, cut at a page boundary when it would not fit. */
function documentText(idx, contextLength) {
  const ctx = contextLength || 128000;
  let text = stripReferences(pageText(idx));
  if (text.length / 4 > ctx / 2) {
    let kept = '';
    for (const part of text.split(/\n\n(?=\[\[page \d+\]\])/)) { if ((kept + part).length > ctx) break; kept += (kept ? '\n\n' : '') + part; }
    text = kept;
  }
  return text;
}

/** Quotes of one reply row, found in the report: { cells, evidence }. A quote that is not in the report is dropped, and its cell then fails QA as unsupported. */
function groundRow(raw, idx, paperId) {
  const cells = {}, evidence = {};
  for (const [column, value] of Object.entries(raw?.cells && typeof raw.cells === 'object' ? raw.cells : {})) {
    const v = String(value ?? '').trim(); if (!v) continue;
    cells[column] = v;
    const quote = String(raw.evidence?.[column] ?? '').trim();
    const hit = quote && locateIn(idx.pages, quote);
    if (hit) evidence[column] = [{ kind: 'text', doc_id: paperId, document_version: idx.hash, page: hit.page, quote, rects: hit.rects }];
  }
  if (raw?.case_no != null && String(raw.case_no).trim()) cells.case_no = String(raw.case_no).trim();
  return { cells, evidence };
}

async function readReply(out, idx, paperId) {
  const rows = parseJsonArray(typeof out.message?.content === 'string' ? out.message.content : '');
  return rows.filter(r => r && typeof r === 'object').map(r => ({ id: r.id, ...groundRow(r, idx, paperId) }));
}

/** The default reader of patients: one request, the report's text and the patient codebook in, rows with quotes out. */
export async function extractPatientRow({ paperId, cfg, model, budget = DEFAULT_BUDGET, signal, columns, conventions = conventionsPrompt(get()), completeCall = completeTools, index = docIndex }) {
  const idx = await index(paperId, { fresh: true });
  const paper = (get().papers || []).find(p => p.id === paperId) || { id: paperId, label: paperId };
  const info = modelInfo(cfg, model);
  const messages = [{ role: 'system', content: PATIENT_EXTRACT.text }, { role: 'system', content: patientCodebook(columns) }, ...conventionMessage(conventions),
    { role: 'user', content: [`Report: ${paper.label}${paper.title ? ` - ${paper.title}` : ''}; document id ${paper.id}; ${idx.pages.length} pages.`, fence('document', documentText(idx, info.context), { id: paper.id })].join('\n\n') }];
  const out = await completeCall({ ...cfg, model }, messages, { tools: [], signal, maxTokens: Math.min(4000, Math.max(500, budget.tokens - 1000)), prompt: PATIENT_EXTRACT, task: 'fill' });
  if (signal?.aborted) return { reason: 'stopped', usage: out.usage };
  if (out.finish === 'length') return { reason: 'error', usage: out.usage, error: 'The provider stopped before the patient list was complete' };
  const rows = (await readReply(out, idx, paperId)).filter(r => Object.keys(r.cells).length);
  return { reason: 'done', usage: out.usage, rows };
}

/** The stronger model re-reads only the flagged rows, each with what the rules found, and returns corrected cells with quotes. */
export async function recheckPatientRows({ paperId, cfg, model, budget = DEFAULT_BUDGET, signal, flagged, columns, conventions = conventionsPrompt(get()), completeCall = completeTools, index = docIndex }) {
  const idx = await index(paperId, { fresh: true });
  const info = modelInfo(cfg, model);
  const task = `These rows were extracted from the report below and failed checks. For each, read the report again and return the row with its cells corrected where the report supports a correction, with a verbatim quote per changed cell. Keep "id". Leave a cell as it is when the report supports it. Reply with a JSON array only: [{"id": ..., "cells": {...}, "evidence": {...}}].`;
  const messages = [{ role: 'system', content: PATIENT_EXTRACT.text }, { role: 'system', content: patientCodebook(columns) }, ...conventionMessage(conventions),
    { role: 'user', content: [task, fence('rows', JSON.stringify(flagged)), fence('document', documentText(idx, info.context), { id: paperId })].join('\n\n') }];
  const out = await completeCall({ ...cfg, model }, messages, { tools: [], signal, maxTokens: Math.min(4000, Math.max(500, budget.tokens - 1000)), prompt: PATIENT_EXTRACT, task: 'fill' });
  if (signal?.aborted) return { reason: 'stopped', usage: out.usage };
  const ids = new Set(flagged.map(f => f.id));
  return { reason: 'done', usage: out.usage, rows: (await readReply(out, idx, paperId)).filter(r => ids.has(r.id)) };
}

// ---- the master list --------------------------------------------------------------------

const authorOf = p => { const a = Array.isArray(p.authors) ? p.authors[0] : ''; const name = typeof a === 'string' ? a : a?.family || a?.name || ''; return String(name).split(/[,\s]/)[0] || String(p.label || '').replace(/\s*\d{4}.*$/, ''); };
const quoteText = list => (list || []).filter(e => e?.quote).map(e => `${e.page ? `p. ${e.page}: ` : ''}"${clip(e.quote, 300)}"`).join(' | ');
const statusLabel = o => o === 'clean' ? 'unchecked, rules passed' : o === 'exception' ? 'unchecked, rules broken' : 'unchecked';

/** The rule list of a table, for a person or another model to review the sheet against. */
export function rulesListing(state, templateId = 'default') {
  const template = templateById(templateId, state); if (!template) return [];
  const columns = columnsOf(templateId, state), label = id => columns.find(c => c.id === id)?.label || id;
  const rules = rulesOf({ ...template, columns }, state);
  const rows = [];
  for (const r of active(rules?.general)) rows.push(['Every text column', kindLabel(r.kind), r.message || '', ruleDetail(r) || '']);
  for (const [column, list] of Object.entries(rules?.columns || {})) for (const r of active(list)) rows.push([label(column), kindLabel(r.kind), r.message || '', ruleDetail(r) || '']);
  rows.push(['Numbers', 'Numeric gate', 'A number must appear in its quote; a count cannot exceed its denominator; a percentage must follow from its counts', '']);
  return rows;
}

/**
 * The master list of a batch as sheets, readable by a person and by another model:
 *   cells      Master list (one row per study), Cells (one row per cell: value, status, rules broken, quote, page, model),
 *              Exceptions, Rules, Report
 *   patients   Master list in the review's own master-list header (readable by lib/ipd-import.mjs), Rules, Report
 */
export function masterListSheets(state, opts = {}, report = null) {
  const reportRows = report ? [['Item', 'Value'], ['Studies', report.papers], ['Cells', report.cells], ['Clean', report.clean], ['Sent to the stronger model', report.escalated], ['Fixed there', report.fixed],
    ['Left to review', report.remaining], ['Left empty', report.unproposed], ['Escalation model', report.escalation], ['Stopped', report.stopped ? 'yes' : 'no'],
    ['Tokens', report.tokens?.known ? report.tokens.prompt + report.tokens.completion : 'not reported by every call'], ['Written', report.endedAt]] : [['Item', 'Value'], ['Report', 'no batch has run in this session']];
  if (opts.mode === 'patients') return patientSheets(state, opts, reportRows);
  const templateId = opts.templateId || 'default';
  const columns = columnsOf(templateId, state).filter(c => !c.derived);
  const papers = poolOf(state, opts).sort((a, b) => (Number(a.folderNo) || 1e9) - (Number(b.folderNo) || 1e9));
  const head = ['ID', 'Study', 'Year', 'DOI', ...columns.map(c => c.label)];
  const master = [head], cells = [['Study', 'Column', 'Value', 'Status', 'Rules broken', 'Quote', 'Page', 'Model']];
  const exceptions = [['Study', 'Column', 'Value', 'Rules broken', 'Sent to the stronger model']];
  papers.forEach((p, i) => {
    const row = [Number(p.folderNo) || i + 1, p.label || p.title || p.id, String(p.year || ''), p.doi || ''];
    for (const c of columns) {
      const key = cellKey(p.id, c.id), v = state.values?.[key], pr = state.proposals?.[key];
      if (valueHeld(v)) { const text = v.availability === 'not_found' ? 'NR' : String(v.reported_value ?? ''); row.push(text); cells.push([p.label, c.label, text, 'accepted', '', quoteText(v.evidence), v.evidence?.find(e => e.page)?.page ?? '', String(v.extractor || '')]); }
      else if (pr) {
        const text = textOfProposal(pr), why = (pr.qa?.reasons || []).map(r => r.message).join('; ');
        row.push(text); cells.push([p.label, c.label, text, statusLabel(pr.qa?.status), why, quoteText(pr.evidence), pr.evidence?.find(e => e.page)?.page ?? '', pr.model || '']);
        if (pr.qa?.status === 'exception') exceptions.push([p.label, c.label, text, why, pr.qa.escalated ? 'yes' : 'no']);
      } else {
        row.push('');
        const missed = (report?.exceptions || []).find(e => e.paperId === p.id && e.itemId === c.id && !e.value);
        if (missed) exceptions.push([p.label, c.label, '', missed.reasons.map(r => r.message).join('; '), missed.escalated ? 'yes' : 'no']);
      }
    }
    master.push(row);
  });
  return [{ name: 'Master list', rows: master }, { name: 'Cells', rows: cells }, { name: 'Exceptions', rows: exceptions },
    { name: 'Rules', rows: [['Where', 'Kind', 'Statement', 'Detail'], ...rulesListing(state, templateId)] }, { name: 'Report', rows: reportRows }];
}

const MASTER_HEAD = ['Include / Exclude', 'First author', 'Year', 'DOI', 'Article title', 'Case no', 'EOR', 'Follow-up (months)', 'Event status', 'Adjuvant treatment', 'Postoperative imaging', 'Months to death',
  'Review status', 'Rules broken', 'Quote: EOR', 'Quote: follow-up', 'Quote: event status', 'Quote: adjuvant treatment', 'Quote: imaging', 'Model', 'h_fu_months', 'h_fu_event'];

function patientSheets(state, opts, reportRows) {
  const byId = new Map((state.papers || []).map(p => [p.id, p]));
  const pool0 = new Set(poolOf(state, opts).map(p => p.id));
  const rows = [MASTER_HEAD];
  const add = (studyId, cells, evidence, status, reasons, model) => {
    const p = byId.get(studyId); if (!p || !pool0.has(studyId)) return;
    const c = cells || {}, ev = evidence || {};
    const status0 = c.outcome || (c.event === '1' ? 'Progression' : c.event === '0' ? 'No progression' : '');
    rows.push(['Include', authorOf(p), String(p.year || ''), p.doi || '', p.title || '', c.case_no || '', c.eor || '', c.time || '', status0, c.adjuvant || '', c.imaging || '', c.death || '',
      status, (reasons || []).map(r => r.message).join('; '), quoteText(ev.eor), quoteText(ev.time), quoteText(ev.event || ev.outcome), quoteText(ev.adjuvant), quoteText(ev.imaging), model || '', c.time || '', c.event ?? '']);
  };
  for (const p of state.participants || []) add(p.study_id, p, p.evidence, 'accepted', [], p.extractor || '');
  for (const p of state.ipdProposals || []) add(p.study_id, p.cells, p.evidence, statusLabel(p.qa?.status || 'unchecked'), p.qa?.reasons, p.model || '');
  const exceptions = [['Study', 'Case no', 'Rules broken', 'Sent to the stronger model']];
  for (const p of state.ipdProposals || []) if (p.qa?.status === 'exception' && pool0.has(p.study_id)) exceptions.push([byId.get(p.study_id)?.label || p.study_id, p.cells?.case_no || '', (p.qa.reasons || []).map(r => r.message).join('; '), p.qa.escalated ? 'yes' : 'no']);
  const rules = [['Rule', 'Statement', 'Cells', 'Checked', 'Message'], ...patientRuleList(state).map(r => [r.label, r.statement, r.columns, r.on ? 'yes' : 'no', r.message]),
    ['Numeric gate', 'A number must appear in its quote; a count cannot exceed its denominator', 'every numeric cell', 'yes', ''],
    ['Evidence', 'Every filled cell needs a quote located in the report', 'every cell', 'yes', '']];
  return [{ name: 'Master list', rows }, { name: 'Exceptions', rows: exceptions }, { name: 'Rules', rows: rules }, { name: 'Report', rows: reportRows }];
}

/**
 * Writes the master list into the project folder by the folder's version rule (lib/project-folder.mjs writeOutputs): the first
 * time as "... v1.xlsx", a changed list as v2 with v1 moved to the archive, an identical list not at all. Nothing is overwritten.
 */
export async function exportMasterList(folder, state, opts = {}, report = null, { typeId = 'other', writeOut = writeOutputs } = {}) {
  const sheets = masterListSheets(state, opts, report);
  const stem = opts.mode === 'patients' ? 'Patient master list' : 'Extraction master list';
  const data = await writeXlsx(sheets);
  return writeOut(folder, [{ key: 'data', stem, ext: 'xlsx', data, label: stem, kind: 'extraction' }], { typeId });
}

// ---- the rules file -----------------------------------------------------------------------------------------------------

const wrapText = (text, indent = '   ') => String(text).replace(/\s+/g, ' ').trim().replace(/(.{1,92})(\s+|$)/g, (_, line) => `${indent}${line}\n`).replace(/\n$/, '');

/**
 * Every rule of a patient extraction as plain text, for another model or a person to review the master list against: the checks over a
 * row (on or off, the sentence, the cells), the conventions the prompt is told, then the two checks no one switches off. It depends only
 * on the project's settings, so an unchanged set is not written again.
 */
export function patientRulesText(state = get()) {
  const checks = patientRuleList(state), conventions = conventionRows(state);
  const out = ['LYKOS PATIENT EXTRACTION: RULES', `${state.project?.name ? `Project: ${state.project.name}\n` : ''}These are the rules each extracted patient row is checked against, and the conventions the model that reads a report is told. Review the master list against them; a row that breaks one is marked in its Rules broken column.`];
  out.push(`CHECKS OVER A ROW (${checks.filter(c => c.on).length} of ${checks.length} on)\n\n${checks.map((c, i) => `${i + 1}. ${c.label}: ${c.on ? 'on' : 'off'}\n${wrapText(c.message ? `${c.message}. ${c.statement}` : c.statement)}\n   Applies to: ${c.columns}`).join('\n\n')}`);
  out.push(`CONVENTIONS FOR THE MODEL (${conventions.filter(c => c.on).length} of ${conventions.length} on)\n\n${conventions.map((c, i) => `${i + 1}. ${c.label}: ${c.on ? 'on' : 'off'}${c.custom ? ' (worded for this project)' : ''}\n${wrapText(c.text)}\n   Applies to: ${c.columns.join(', ')}`).join('\n\n')}`);
  out.push(`ALWAYS APPLIED\n\n1. Numeric gate\n${wrapText('A number must appear in its quote; a count cannot exceed its denominator.')}\n2. Evidence\n${wrapText('Every filled cell needs a quote located in the report; a cell without one is flagged.')}\n3. Escalation\n${wrapText('Only a row that breaks a rule goes to the stronger model, once. Nothing is accepted without a person.')}`);
  return `${out.join('\n\n')}\n`;
}

/** Writes the rules file into the project folder by the folder's version rule (v1, then v2 with v1 archived; an unchanged set is not written again). */
export function exportRulesFile(folder, state, { typeId = 'other', writeOut = writeOutputs } = {}) {
  return writeOut(folder, [{ key: 'data', stem: 'Patient extraction rules', ext: 'txt', data: patientRulesText(state), label: 'Patient extraction rules', kind: 'extraction' }], { typeId });
}

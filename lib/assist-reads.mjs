// The assistant's read tools for each part of a review (chat tool groups
// screening, extraction, appraisal, analysis, manuscript, search, files).
//
// Each is a pure read of the project state, bounded and compact: what a
// reviewer would open three views to find, in one answer. None changes the
// project; the matching changes are ops in lib/change-ops.mjs. Every answer is
// data the model reads, never instructions, and says what it left out.
import { decisionAt, isDual, queue, conflicts } from './screen.mjs';
import { labelList, labelCounts, labelNames } from './screen-labels.mjs';
import { batchesOf, batchProgress, checkSample } from './screen-assign.mjs';
import { recordText, tfidf } from './screen-rank.mjs';
import { columnsOf, templates, templateById } from './templates.mjs';
import { rulesOf, rulesFor, checkValue, active } from './cell-rules.mjs';
import { researchType } from './workflow.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { appraisalTool } from '../schema.mjs';
import { effectiveAnswers, secondOn, recordOf as robRecord } from './rob-review.mjs';
import { outcomes as outcomeList, analysisOf, timepointsOf, slotId, PRIMARY } from './outcomes.mjs';
import { pooledInputs, pooledInputStatus } from './analysis-inputs.mjs';
import { results as savedResults } from './results.mjs';
import { analysisRegistry, readAnalysisResult } from './research-copilot.mjs';
import { checkManuscript } from './manuscript-checks.mjs';
import { checkCitations, registryKey, citationSummary } from './reference-list.mjs';
import { hashText, wordCount, citations } from './manuscript.mjs';
import { checklistOf, checklistStates, supported as checklistSupported } from './checklist.mjs';
import { translateQuery, TRANSLATION_TARGETS } from './query-translate.mjs';
import { clipAbstract } from './text-clip.mjs';
import { paperOf } from './change-ops.mjs';
import { missedValues } from './numeric-gate.mjs';
import { whereIs } from './assistant-help.mjs';
import { activeFolder } from './projects.mjs';

const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const short = p => ({ id: p.id, label: p.label, year: p.year });
const need = (p, ref) => { if (!p) throw new Error(`no record "${clip(ref, 60)}" in the library; use an id from query_library`); return p; };

// ---- screening -------------------------------------------------------------------------------------------------
const rulesAt = (s, stage) => (s.protocol?.criteria || []).filter(c => c.text && (stage === 'ft' || c.stage !== 'Full text'));

export function screeningStatus(s, { stage = 'ta', criteria = false } = {}) {
  if (!['ta', 'ft'].includes(stage)) throw new Error('stage must be ta or ft');
  const papers = s.papers || [];
  const pool = stage === 'ft' ? papers.filter(p => decisionAt(s, 'ta', p.id)?.decision === 'include') : papers;
  const tally = { include: 0, exclude: 0, uncertain: 0, undecided: 0 };
  for (const p of pool) { const d = decisionAt(s, stage, p.id); tally[!d || d.needsCriteriaReview ? 'undecided' : d.decision]++; }
  const props = s.proposals?.[stage] || {};
  const proposed = { include: 0, exclude: 0, uncertain: 0 }, vs = { agree: 0, differ: 0, undecided: 0 };
  for (const p of pool) {
    const pr = props[p.id]; if (!pr?.verdict || !(pr.verdict in proposed)) continue;
    proposed[pr.verdict]++;
    const d = decisionAt(s, stage, p.id);
    if (!d || d.needsCriteriaReview) vs.undecided++; else if (d.decision === pr.verdict) vs.agree++; else vs.differ++;
  }
  const counts = labelCounts(s);
  return {
    stage, records: pool.length, decisions: tally, open: queue(s, stage).open.length,
    model_proposals: { ...proposed, versus_decisions: vs, note: 'Proposals are model output, not decisions.' },
    dual: isDual(s), ...(isDual(s) ? { conflicts_open: conflicts(s, stage).length, conflicts_resolved: conflicts(s, stage, { resolved: true }).length } : {}),
    labels: labelList(s).map(l => ({ id: l.id, name: l.name, records: counts[l.id] || 0 })),
    batches: batchesOf(s, stage).slice(0, 12).map(b => ({ name: b.name, kind: b.kind, records: b.ids.length, progress: batchProgress(s, b).map(x => `${x.reviewer} ${x.decided}/${x.assigned}`).join(', ') })),
    check_sample: (() => { const c = checkSample(s, stage); return c ? { records: c.ids.length, decided: c.ids.filter(id => decisionAt(s, stage, id)).length } : null; })(),
    criteria_count: rulesAt(s, stage).length,
    ...(criteria ? { criteria: rulesAt(s, stage).map(c => ({ id: c.id, kind: c.kind || 'include', text: clip(c.text, 160) })) } : { criteria: 'in the project brief; pass criteria: true to list them here' }),
  };
}

export function screeningRecord(s, { paper, stage = 'ta', criteria = false } = {}) {
  const p = need(paperOf(paper, s), paper);
  if (!['ta', 'ft'].includes(stage)) throw new Error('stage must be ta or ft');
  const d = decisionAt(s, stage, p.id), pr = s.proposals?.[stage]?.[p.id];
  const dual = s.dual?.[stage]?.[p.id];
  return {
    record: { ...short(p), title: clip(p.title, 300), authors: (p.authors || []).slice(0, 4).map(a => typeof a === 'string' ? a : a.name), journal: clip(p.journal, 100), doi: p.doi || '',
      language: p.language || p.lang || undefined, abstract: clipAbstract(p.abstract, 1800) || '(no abstract)', pdf_attached: Boolean(p.pdf) },
    decision: d ? { decision: d.decision, reason: d.reason || undefined, note: d.note || undefined, by: d.by || undefined, at: String(d.at || '').slice(0, 10), needs_criteria_review: d.needsCriteriaReview || undefined } : null,
    ...(dual ? { reviewers: Object.entries(dual).map(([by, x]) => ({ by, decision: x.decision, reason: x.reason || undefined })) } : {}),
    model_proposal: pr ? { verdict: pr.verdict, model: pr.model, tier: pr.tier, p: pr.p ?? undefined,
      criteria: (pr.criteria || []).filter(c => c.met && c.met !== 'yes').map(c => ({ id: c.id, met: c.met, note: c.note || undefined, quote: c.quote || undefined })), note: 'Model output; check each quote in the record.' } : null,
    labels: labelNames(s, p.id), notes: (s.notes || []).filter(n => n.paper === p.id).slice(-4).map(n => ({ kind: n.kind, page: n.page || undefined, text: clip(n.text, 220) })),
    criteria: criteria ? rulesAt(s, stage).map(c => ({ id: c.id, kind: c.kind || 'include', text: clip(c.text, 240), ...(c.question ? { question: clip(c.question, 200) } : {}) })) : 'in the project brief; pass criteria: true to list them here',
    history: (s.screeningLog || []).filter(e => e.id === p.id).slice(-6).map(e => ({ action: e.action, stage: e.stage, decision: e.decision, by: e.by || undefined, at: String(e.at || '').slice(0, 10), reason: e.reason || undefined })),
  };
}

let simCache = { key: '', feats: null };
export function similarRecords(s, { paper, limit = 8 } = {}) {
  const p = need(paperOf(paper, s), paper);
  const papers = (s.papers || []).slice(0, 30000);
  const key = `${papers.length}:${papers[0]?.id}:${papers.at(-1)?.id}`;
  if (simCache.key !== key) simCache = { key, feats: tfidf(papers.map(recordText)) };
  const { rows } = simCache.feats;
  const at = papers.findIndex(x => x.id === p.id);
  if (at < 0) throw new Error('record is not in the first 30,000 records');
  const t = rows[at], w = new Map(); t.idx.forEach((j, k) => w.set(j, t.val[k]));
  const scored = [];
  for (let i = 0; i < rows.length; i++) { if (i === at) continue; let d = 0; const r = rows[i]; for (let k = 0; k < r.idx.length; k++) { const x = w.get(r.idx[k]); if (x) d += x * r.val[k]; } if (d > 0) scored.push([d, i]); }
  scored.sort((a, b) => b[0] - a[0]);
  const n = Math.max(1, Math.min(15, Math.floor(Number(limit)) || 8));
  return { of: short(p), method: 'TF-IDF cosine over title and abstract (a lexical match, not a judgement of relevance)',
    similar: scored.slice(0, n).map(([d, i]) => { const q = papers[i]; const dec = s.screening?.[q.id]; return { ...short(q), title: clip(q.title, 120), similarity: Math.round(d * 100) / 100, screening: dec && !dec.needsCriteriaReview ? dec.decision : 'undecided' }; }) };
}

// ---- extraction --------------------------------------------------------------------------------------------------
function columnRef(template, ref) {
  const cols = columnsOf(template);
  const r = String(ref || '').toLowerCase();
  return cols.find(c => c.id === ref) || cols.find(c => String(c.label || '').toLowerCase() === r) || cols.find(c => c.id.endsWith(`.${ref}`)) || null;
}
export async function cellContext(s, { paper, column, template } = {}) {
  const p = need(paperOf(paper, s), paper);
  const tid = template || (String(column).includes('.') ? String(column).split('.')[0] : 'default');
  const t = templateById(tid, s); if (!t) throw new Error(`no table "${clip(tid, 60)}"; tables: ${templates(s).map(x => x.id).join(', ')}`);
  const col = columnRef(tid, column); if (!col) throw new Error(`no column "${clip(column, 60)}" in ${t.name}; columns: ${columnsOf(tid).map(c => c.id).slice(0, 40).join(', ')}`);
  const key = `${p.id}:${col.id}`, v = s.values?.[key], pr = s.proposals?.[key];
  const rules = rulesOf(t, s), text = v ? (v.availability === 'not_found' && v.reported_value == null ? 'NR' : v.reported_value) : null;
  return {
    record: short(p), table: t.name, column: { id: col.id, label: col.label, type: col.type || 'text', unit: col.unit || undefined, definition: clip(col.definition || col.guidance, 300) || undefined,
      instructions: clip(col.instructions, 300) || undefined, examples: clip(col.examples, 200) || undefined, allowed: col.options?.length ? col.options : col.allowed || undefined },
    accepted: v ? { value: clip(text, 400), availability: v.availability, origin: v.origin, verification: v.verification, locked: v.locked || undefined,
      evidence: (v.evidence || []).slice(0, 3).map(e => ({ kind: e.kind, page: e.page ?? e.locator?.page, quote: clip(e.quote, 240) })) } : null,
    proposal: pr ? { value: clip(pr.value, 400), availability: pr.availability, model: pr.model, rationale: clip(pr.rationale, 200), findings: pr.findings?.map(f => f.message),
      evidence: (pr.evidence || []).slice(0, 3).map(e => ({ page: e.page, quote: clip(e.quote, 240) })) } : null,
    rule_findings: text ? checkValue(text, rules, col).slice(0, 6).map(f => f.message) : [],
    column_rules: rules ? active(rulesFor(rules, col)).slice(0, 8).map(r => clip(r.message, 140)) : [],
    abstract: p.abstract ? clipAbstract(p.abstract, 900) : undefined,
    next: p.pdf ? 'Read the paper with read_document (documents group) before proposing a value.' : 'No PDF is attached; only the abstract is available.',
  };
}

export async function missedValuesTool(s, { paper, template } = {}, { index } = {}) {
  const p = need(paperOf(paper, s), paper);
  const tid = template || 'default', cols = columnsOf(tid);
  if (!p.pdf) throw new Error('no PDF is attached to this record; the check reads the paper\'s text');
  const idx = await index(p.id);
  const values = Object.fromEntries(Object.entries(s.values || {}).filter(([k]) => k.startsWith(`${p.id}:`)).map(([k, v]) => [k.slice(p.id.length + 1), v]));
  const proposals = Object.entries(s.proposals || {}).filter(([k]) => k.startsWith(`${p.id}:`)).map(([k, v]) => ({ ...v, column_id: k.slice(p.id.length + 1) }));
  const list = missedValues({ columns: cols, proposals, values, pages: idx.pages.map((pg, i) => ({ page: i + 1, text: pg.text })) });
  return { record: short(p), table: tid, places_to_look: list, note: 'A deterministic search of the paper for fields with no value: places to look, not claims. Most fields without a numeric cue cannot be searched this way.' };
}

// ---- appraisal -----------------------------------------------------------------------------------------------------
export function appraisalStatus(s, { paper, level = 'study', tool: requestedTool } = {}) {
  const selected = paper ? need(paperOf(paper, s), paper) : null;
  const tool = requestedTool ? appraisalTool(requestedTool, s) : instrumentFor(s, selected?.id);
  const base = { tool: tool.id, name: tool.name, design: tool.design, judgements: tool.judgements, domains: tool.domains.map(d => ({ id: d.id, short: d.short, label: clip(d.label, 90) })), second_reviewer: secondOn(s) };
  if (!paper) {
    const inc = (s.papers || []).filter(p => (s.fulltext?.[p.id] || s.screening?.[p.id])?.decision === 'include');
    const studyTool = p => (requestedTool ? appraisalTool(requestedTool, s) : instrumentFor(s, p.id));
    const assessed = inc.filter(p => Object.keys(effectiveAnswers(s, p.id, studyTool(p).id, level).answers || {}).length);
    return { ...base, level, instruments: [...new Set(inc.map(p => studyTool(p).id))], included: inc.length, assessed: assessed.length, not_assessed: inc.filter(p => !assessed.includes(p)).slice(0, 25).map(short) };
  }
  const p = selected, effective = effectiveAnswers(s, p.id, tool.id, level);
  return { ...base, level, effective_level: effective.level, inherited: effective.level !== level, record: short(p), judgements_made: effective.answers || {}, has_record: Boolean(robRecord(s, p.id, tool.id, level)),
    notes: (s.notes || []).filter(n => n.paper === p.id).slice(-8).map(n => ({ kind: n.kind, page: n.page || undefined, text: clip(n.text, 200), verification: n.verification })),
    text: p.pdf || p.pdfRel || p.pdfRetrieval?.status === 'preview' ? 'PDF attached: read pages with read_document.' : p.abstract ? 'Abstract only.' : 'No text.' };
}

// ---- analysis -------------------------------------------------------------------------------------------------------
export function analysisResult(s, { outcome, id, includeScript=false } = {}) {
  if (id) return readAnalysisResult(s, { id, includeScript });
  const outs = outcomeList(s);
  const pick = outcome ? outs.filter(o => o.id === outcome || String(o.name).toLowerCase() === String(outcome).toLowerCase()) : outs;
  if (outcome && !pick.length) throw new Error(`no outcome "${clip(outcome, 60)}"; outcomes: ${outs.map(o => `${o.id} (${o.name})`).join(', ')}`);
  const shown = pick.slice(0, 8).map(o => timepointsOf(s, o.id).map(t => {
    const slot = slotId(o.id, t.id), a = analysisOf(s, slot);
    return { outcome: o.id, name: o.name, timepoint: t.label || t.id, measure: a?.measure || o.measure, result: a ? {
      estimate: a.estimate ?? a.est, ci: [a.lo, a.hi], k: a.k, method: a.method, i2: a.i2, tau2: a.tau2, prediction_interval: a.pi_lo != null ? [a.pi_lo, a.pi_hi] : undefined,
      model_note: a.dependence ? `dependence: ${a.dependence}` : undefined, inputs: pooledInputStatus(s, a, o.id) } : null,
      studies: a?.labels?.slice(0, 60) };
  })).flat();
  const linked = savedResults(s).filter(r => r.key.startsWith('pooled')).slice(0, 12).map(r => ({ token: `{{${r.key}}}`, text: r.text }));
  return { outcomes: shown, analyses: analysisRegistry(s), result_tokens: savedResults(s).map(r=>({token:`{{${r.key}}}`,text:r.text,status:r.inputStatus||'current'})), note: 'Numbers come from saved results. Use {{tokens}} in the manuscript; stale or untracked results require rerunning or provenance review.' };
}
export function analysisInputs(s, { outcome = PRIMARY, measure } = {}) {
  const o = outcomeList(s).find(x => x.id === outcome || String(x.name).toLowerCase() === String(outcome).toLowerCase());
  if (!o) throw new Error(`no outcome "${clip(outcome, 60)}"`);
  const m = measure || o.measure || s.analysis?.measure || s.settings?.measure || 'RR';
  const r = pooledInputs(s, '', m, o.id);
  const label = u => u.label || u.paper?.label || '';
  return { outcome: o.id, name: o.name, measure: m, ready: r.units.length, studies_ready: r.units.slice(0, 40).map(label),
    incomplete: (r.incomplete || []).slice(0, 25).map(x => ({ study: x.label || x.paper?.label || x.id || '', missing: x.missing || x.fields || undefined })),
    invalid: (r.invalid || []).slice(0, 15).map(x => ({ study: x.label || x.paper?.label || x.id || '', why: x.why || x.reason || undefined })),
    note: 'Inputs are read from accepted extraction values. Running the model happens in Analysis.' };
}

// ---- manuscript --------------------------------------------------------------------------------------------------------
const textOf = b => b.text ?? (b.runs || []).map(r => r.t).join('');
export function manuscriptOutline(s, { offset = 0, limit = 40 } = {}) {
  const blocks = s.manuscript?.blocks || [], off = Math.max(0, Math.floor(offset) || 0), n = Math.max(1, Math.min(80, Math.floor(limit) || 40));
  return { total: blocks.length, offset: off, next_offset: off + n < blocks.length ? off + n : null,
    blocks: blocks.slice(off, off + n).map(b => ({ id: b.id, type: b.type, words: wordCount(textOf(b)), start: clip(textOf(b), 90), citations: citations(textOf(b)).length || undefined })) };
}
export function manuscriptRead(s, { block, section, offset = 0, limit = 40 } = {}) {
  const blocks = s.manuscript?.blocks || [];
  let picked;
  if (block) { const i = blocks.findIndex(b => b.id === block); if (i < 0) throw new Error('no such block; read manuscript_outline for ids'); picked = [blocks[i]]; }
  else if (section) {
    const i = blocks.findIndex(b => /^h[1-3]$/.test(b.type) && textOf(b).toLowerCase().includes(String(section).toLowerCase())); if (i < 0) throw new Error(`no heading containing "${clip(section, 40)}"`);
    let j = i + 1; while (j < blocks.length && !(/^h[1-3]$/.test(blocks[j].type) && blocks[j].type <= blocks[i].type)) j++;
    picked = blocks.slice(i, j);
  } else picked = blocks;
  const off = Math.max(0, Math.floor(offset) || 0), count = Math.max(1, Math.min(80, Math.floor(limit) || 40));
  const total = picked.length; picked = picked.slice(off, off + count);
  let used = 0; const out = [];
  for (const b of picked) { const t = textOf(b); if (out.length && used + t.length > 14000) break; used += t.length; out.push({ id: b.id, type: b.type, hash: hashText(t), text: t }); }
  return { blocks: out, total, offset: off, next_offset: off + out.length < total ? off + out.length : null, truncated: off + out.length < total || undefined, note: 'Citation markers [@key] and result tokens {{key}} are kept as written; keep them in any edit. Drafts are not source evidence.' };
}
export function checkManuscriptTool(s) {
  const issues = checkManuscript(s.manuscript?.blocks || [], { library: s.papers || [], results: savedResults(s), snapshot: {} });
  return { issues: issues.slice(0, 40).map(i => ({ level: i.level || i.severity, kind: i.kind, message: clip(i.message, 200), block: i.blockId, text: i.text })), total: issues.length };
}
/**
 * check_citations: the typed reference list against its citations, the library and the registries' saved answers
 * (lib/reference-list.mjs). Counts, then at most 30 findings, worst first; runs no lookup.
 */
export function checkCitationsTool(s) {
  const blocks = s.manuscript?.blocks || [];
  const cc = s.manuscript?.citationCheck || {};
  const r = checkCitations(blocks, { library: s.papers || [], citationCheck: cc });
  if (!r.list.typed) return { entries: 0, note: 'No typed reference list: the manuscript cites library records ([@key]) or has no References section. check_manuscript covers cited records.' };
  const order = { error: 0, warn: 1, note: 2 };
  const issues = [...r.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const keys = r.list.entries.map(registryKey).filter(Boolean);
  const dates = keys.map(k => cc.registry?.[k]?.at).filter(Boolean).sort();
  return { ...citationSummary(r), registry: { identifiers: keys.length, answered: dates.length, last_checked: dates.at(-1)?.slice(0, 10) || null },
    issues: issues.slice(0, 30).map(i => ({ level: i.severity, kind: i.kind, message: clip(i.message, 200), block: i.blockId })), total: issues.length,
    note: 'Registry results are as saved by the last Check identifiers in Manuscript > Checks; "not in the library" is not an error. Fixes are proposed there (Propose fixes), never applied here.' };
}
export function reportStatus(s) {
  const list = checklistOf(s), st = checklistStates(s), sup = checklistSupported(s);
  const rows = list.items.map(([n, name]) => ({ item: n, name: clip(name, 60), state: st[n]?.state || '', where: st[n]?.where || undefined, supported_by: sup[n] || undefined }));
  return { checklist: list.name, reported: rows.filter(r => r.state === 'done').length, items: rows.length, not_reviewed: rows.filter(r => !r.state).map(r => `${r.item} ${r.name}`).slice(0, 30),
    reviewed: rows.filter(r => r.state).slice(0, 30), note: '"supported_by" names a project artefact that vouches for an item; it is not a reviewer\'s decision.' };
}

// ---- search --------------------------------------------------------------------------------------------------------------
export function searchHistory(s) {
  const runs = (s.searches || []);
  return { runs: runs.slice(-15).map((r, i) => ({ n: runs.length - Math.min(15, runs.length) + i + 1, source: r.source, kind: r.kind, at: String(r.at || '').slice(0, 10), total: r.total, retrieved: r.retrieved, status: r.status,
    query: clip(r.query, 300), gap: Number(r.total) > Number(r.retrieved) ? `${Number(r.total) - Number(r.retrieved)} not retrieved` : undefined })),
    records_in_library: (s.papers || []).length, note: 'total is what the source reports; retrieved is what was brought in; a gap means the run stopped early or the source limits results.' };
}
export function translateQueryTool(_s, { query, target } = {}) {
  if (!TRANSLATION_TARGETS.includes(target)) throw new Error(`target must be one of ${TRANSLATION_TARGETS.join(', ')}`);
  const r = translateQuery(String(query || ''), target);
  return { ...r, note: 'Deterministic translation of a PubMed strategy: read the notes, they say where meaning changed. It has not been run.' };
}

// ---- files ---------------------------------------------------------------------------------------------------------------
export async function folderPlan(s) {
  const folder = activeFolder();
  if (!folder) throw new Error('this project has no project folder');
  const { planOrganise } = await import('./project-folder.mjs');
  const plan = await planOrganise(folder, researchType(s).id);
  return { type: researchType(s).label, creates: (plan.creates || []).slice(0, 20), moves: (plan.moves || []).slice(0, 30).map(m => ({ from: m.from, to: m.to, blocked: m.blocked || undefined })), moves_total: (plan.moves || []).length,
    note: 'A plan, not an action: applying it (with undo) is done in the Project folder view, which also follows moved files.' };
}

export const where = (_s, { query } = {}) => ({ places: whereIs(query) });

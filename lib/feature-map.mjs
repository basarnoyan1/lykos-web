// The assistant's map of Lykos (owner, 2026-10-22: "a compact index of every feature and cheap reads, so the assistant stops searching the
// project for simple tasks"). One entry per feature: the page that holds it, the words a person uses for it, what it holds, a few facts read
// straight from the saved project, and the reads that go deeper. The chat's `features` tool answers from here in one call: "did we send the
// paper", "how many tasks are open", "where are the PRISMA counts" no longer start a search of the library.
//
// Pure, apart from the clock: every fact comes from the state handed in, through the same functions the pages use (the Overview's
// standingFacts, the Submission list, the readiness score), so what the assistant says is what the page shows. Loaded with the chat engine.
import { standingFacts, readinessFacts } from './overview-facts.mjs';
import { listForAssistant } from './submissions.mjs';
import { normaliseTasks, statusOf } from './tasks.mjs';
import { visibleNotifications } from './notifications.mjs';
import { foldSearch } from './search-ranking.mjs';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clip = (v, n = 120) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const count = v => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

/**
 * `f` is the facts of one feature, `S(s)` the Overview's facts (computed once per call, only when a matched feature needs them).
 * `more` names the reads that go deeper, as the assistant calls them.
 */
export const FEATURES = Object.freeze([
  { id: 'protocol', name: 'Protocol', page: 'Protocol', words: 'protocol question pico population intervention comparator outcome criteria eligibility inclusion exclusion objective title registration prospero register',
    holds: 'the review question, PICO, eligibility criteria and registration',
    f: s => ({ title: clip(s.protocol?.title || s.paper?.title, 200) || 'none', pico: Object.entries(s.protocol?.pico || {}).filter(([, v]) => v).map(([k]) => k),
      criteria: count(s.protocol?.criteria), registered: s.registration?.dates?.registeredAt || s.registration?.values?.id || 'not recorded' }),
    more: ['read_project protocol'] },
  { id: 'searches', name: 'Literature searches', page: 'Literature', words: 'search searches database databases pubmed embase scopus web science query strategy string log run rerun hits',
    holds: 'each database search: its query, when it ran, how many records it found',
    f: s => ({ searches: (s.searches || []).slice(-6).map(r => ({ source: r.source || r.kind || '', ran: r.date || r.ranAt || r.at || '', hits: r.count ?? r.total ?? null, status: r.status || 'done' })), total: count(s.searches) }),
    more: ['search_history', 'read_project searches'] },
  { id: 'library', name: 'Library', page: 'Library', words: 'library records references papers studies pdf pdfs full text attached missing duplicates retraction doi',
    holds: 'every record: its reference, its PDF, duplicates and retraction notices',
    f: s => { const p = s.papers || []; return { records: p.length, with_pdf: p.filter(x => x.pdf || x.pdfRel).length, without_pdf: p.filter(x => !(x.pdf || x.pdfRel)).length }; },
    more: ['query_library', 'inspect_records'] },
  { id: 'screening', name: 'Screening', page: 'Screening', words: 'screening screen screened decisions include included exclude excluded uncertain conflicts title abstract full text reasons prisma funnel',
    holds: 'title and abstract and full-text decisions, exclusion reasons, conflicts',
    f: (s, S) => { const x = S(s).screening; return { flow: x?.text || '', to_decide: x?.left ?? null, top_exclusion_reasons: (x?.reasons || []).slice(0, 3).map(r => `${clip(r.reason, 60)}: ${r.n}`) }; },
    more: ['screening_status'] },
  { id: 'extraction', name: 'Extraction', page: 'Extraction', words: 'extraction extract evidence table tables data values cells fields columns empty filled verified unverified proposals proposed',
    holds: 'the evidence tables: each study\'s values, what is empty, not reported or waiting to be checked',
    f: (s, S) => { const e = S(s).evidence; return { tables: (e?.tables || []).map(t => t.name || t.label || t.id).slice(0, 4), studies: e?.studies ?? 0, of: e?.of ?? 0, cells: e?.cells || null, pending_proposals: count(s.proposals) }; },
    more: ['query_project', 'missed_values'] },
  { id: 'patients', name: 'Patient data', page: 'Patient data', words: 'patient patients participants individual ipd cases case series follow up survival kaplan meier recurrence progression',
    holds: 'individual patient rows, their columns and which carry time, event and group',
    f: s => ({ patients: count(s.participants), columns: (s.ipdColumns || []).map(c => c.name).slice(0, 14), roles: Object.fromEntries((s.ipdColumns || []).filter(c => c.role).map(c => [c.role, c.name])) }),
    more: ['describe_data', 'query_project', 'kaplan_meier'] },
  { id: 'appraisal', name: 'Risk of bias', page: 'Appraisal', words: 'appraisal appraise risk bias rob robins jbi quality judgement judgements domain domains tool instrument',
    holds: 'risk-of-bias judgements by instrument and study',
    f: (s, S) => ({ instruments: (S(s).appraisal?.instruments || []).map(i => ({ name: i.name, studies: i.n, complete: i.complete, levels: (i.segments || []).map(g => `${g.level}: ${g.n}`) })) }),
    more: ['appraisal_status'] },
  { id: 'analysis', name: 'Analyses', page: 'Analysis', words: 'analysis analyses meta pooled pool forest plot funnel heterogeneity estimate proportion outcome outcomes stale rerun',
    holds: 'pooled analyses, their estimates, and whether their data changed since they ran',
    f: (s, S) => { const a = S(s).analyses; return { current: a?.current ?? 0, changed: a?.changed ?? 0, not_run: a?.notRun ?? 0, not_used_in_paper: a?.unused ?? 0, outcomes: (s.outcomes || []).map(o => o.name).slice(0, 10) }; },
    more: ['analysis_result', 'analysis_inputs'] },
  { id: 'certainty', name: 'Certainty (GRADE)', page: 'Certainty', words: 'certainty grade evidence quality summary findings sof downgrade imprecision inconsistency',
    holds: 'GRADE ratings for each outcome',
    f: (s, S) => { const c = S(s).certainty; return { rated: (c?.rows || []).map(r => `${clip(r.name || r.outcome, 40)}: ${r.level || r.certainty || ''}`).slice(0, 8), to_rate: (c?.toRate || []).length }; },
    more: ['read_project certainty'] },
  { id: 'outputs', name: 'Tables and figures', page: 'Tables and figures', words: 'table tables figure figures chart graph plot outputs package export characteristics',
    holds: 'the tables and figures made for the paper and the submission package',
    f: (s, S) => ({ outputs: (s.outputs || []).map(o => clip(o.title || o.name || o.id, 60)).slice(0, 8), package_parts: (S(s).package || []).length }),
    more: ['list_outputs'] },
  { id: 'manuscript', name: 'Manuscript', page: 'Manuscript', words: 'manuscript paper draft write writing words word count sections introduction methods results discussion abstract references citations limit',
    holds: 'the paper\'s text, its sections and word counts, and the manuscript checks',
    f: (s, S) => { const m = S(s).manuscript; return { words: m?.words ?? 0, main_text: m?.main ?? null, limit: m?.limit ?? null, errors: m?.errors ?? null, warnings: m?.warnings ?? null, sections: (m?.sections || []).map(x => `${x.name}: ${x.words}`).slice(0, 10) }; },
    more: ['manuscript_outline', 'check_manuscript', 'check_citations'] },
  { id: 'reporting', name: 'Reporting (PRISMA)', page: 'Reporting', words: 'reporting prisma flow diagram counts checklist items blank declarations statements funding ethics conflicts',
    holds: 'the PRISMA flow counts and the reporting checklist',
    f: s => ({ prisma_counts_filled: Object.values(s.prisma || {}).filter(v => v !== '' && v != null).length, declarations: Object.keys(s.declarations || {}).length }),
    more: ['report_status', 'read_project reporting'] },
  { id: 'submissions', name: 'Submission', page: 'Submission', words: 'submit submitted submission send sent journal journals decision rejected accepted revision revise reviewers letter portal resubmit target',
    holds: 'each journal tried, its decision and letters, and the target journal',
    f: (s, S) => { const d = S(s).submission, all = listForAssistant(s.submissions, localDay()); return { summary: all.summary || d?.line || 'No journal attempt recorded', target: d?.target || '', attempts: all.items.map(a => ({ journal: a.journal, status: a.status, days: a.elapsed_days })) }; },
    more: ['read_project submissions'] },
  { id: 'readiness', name: 'Submission readiness', page: 'Overview, Submission readiness', words: 'readiness ready score acceptance accepted chance grade journal requirements desk reject',
    holds: 'the app\'s score of how ready the paper is for the target journal, what holds it down, each part',
    f: (s, S) => { const r = readinessFacts(s, S(s)); return { journal: r.journal || null, score: r.score, grade: r.letter, verdict: r.word, held_down_by: r.caps.map(c => c.why), parts: r.parts.map(p => `${p.label}: ${p.assessed ? `${p.got} of ${p.max}` : 'not assessed'}`) }; },
    more: ['review_status'] },
  { id: 'tasks', name: 'Tasks', page: 'Tasks', words: 'task tasks todo todos to do due deadline overdue milestone plan reminders',
    holds: 'the project\'s tasks with due dates and status',
    f: s => { const t = normaliseTasks(s.todos), open = t.filter(x => statusOf(x) !== 'done'), today = localDay();
      return { open: open.length, overdue: open.filter(x => x.due && x.due < today).length, next: open.filter(x => x.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3).map(x => `${clip(x.text, 60)} (${x.due})`), undated: open.filter(x => !x.due).slice(0, 3).map(x => clip(x.text, 60)) }; },
    more: ['read_project tasks'] },
  { id: 'notes', name: 'Notes', page: 'Notes', words: 'note notes meeting journal memo source notes annotations model notes unchecked',
    holds: 'the project\'s notes, and the notes on sources (a model\'s notes waiting to be checked among them)',
    f: s => ({ project_notes: count(s.projectNotes), latest: (s.projectNotes || []).slice(-3).map(n => clip(n.title, 60)), source_notes: count(s.notes) }),
    more: ['read_project notes', 'search_project'] },
  { id: 'workflows', name: 'Workflows', page: 'Workflows', words: 'workflow workflows pipeline automation automate run runs scheduled schedule',
    holds: 'saved workflows and their runs',
    f: s => ({ workflows: (s.workflows || []).map(w => clip(w.name, 50)).slice(0, 8), last_run: (() => { const r = (s.workflowRuns || []).at(-1); return r ? `${clip(r.name, 50)}: ${r.status || ''}` : 'none'; })() }),
    more: ['inspect_workflow'] },
  { id: 'files', name: 'Project folder', page: 'Files', words: 'file files folder folders drive data spreadsheet xlsx csv word docx document documents pdf path',
    holds: 'the project folder and its files',
    f: s => ({ mapped_folders: Object.keys(s.folderMap || {}).length }),
    more: ['list_folder', 'read_file', 'grep', 'folder_plan'] },
  { id: 'notifications', name: 'Notifications', page: 'Notifications', words: 'notification notifications alert alerts new hits failed completed',
    holds: 'what finished, failed or changed in the background',
    f: s => { const v = visibleNotifications(s); return { unread: v.filter(n => !n.read).length, latest: v.slice(0, 3).map(n => clip(n.title, 60)) }; },
    more: ['read_project notifications'] },
  { id: 'models', name: 'Models and usage', page: 'Settings, Models and Usage', words: 'model models ai cost costs spend spent usage tokens budget provider claude openai key',
    holds: 'the connected models and what the assistant has cost',
    f: s => { const t = s.aiCallTotals || {}; return { calls: t.calls ?? count(s.aiCalls), cost_usd: t.cost != null ? Math.round(t.cost * 100) / 100 : null, since: s.aiUsageStartedAt || '' }; },
    more: [] },
]);

const words = q => (foldSearch(String(q || '')).match(/[\p{L}\p{N}]{3,}/gu) || []);
const stem = w => w.slice(0, Math.max(4, Math.min(w.length, 6)));
const INDEX = FEATURES.map(x => ({ x, stems: new Set(`${x.id} ${x.name} ${x.words}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu).map(stem)) }));

/** The features a question is about, best first: a word of the question that begins like one of a feature's words counts once. */
export function matchFeatures(query, limit = 2) {
  const qs = [...new Set(words(query).map(stem))];
  return INDEX.map(({ x, stems }) => ({ x, n: qs.filter(w => stems.has(w)).length })).filter(m => m.n).sort((a, b) => b.n - a.n).slice(0, limit).map(m => m.x);
}

/** The whole map in one line per feature, for a question it cannot place. */
export const featureIndex = () => FEATURES.map(x => `${x.id}: ${x.holds}`);

/**
 * The answer of the `features` tool: for each matched feature its page, what it holds, its facts now and where to read more; with no match,
 * the index. A fact that fails to compute says so instead of failing the call.
 */
export function features(state, { query = '', id = '' } = {}) {
  let memo = null;
  const S = s => (memo ??= standingFacts(s, localDay()));
  const picked = id ? FEATURES.filter(x => x.id === id) : matchFeatures(query);
  if (!picked.length) return { matched: [], index: featureIndex(), note: 'No feature matched; call again with an id from the index.' };
  return { matched: picked.map(x => {
    let facts; try { facts = x.f(state, S); } catch { facts = { unavailable: 'could not be read now; use the deeper reads' }; }   // no error text: it may quote project data
    return { id: x.id, page: x.page, holds: x.holds, facts, more: x.more };
  }) };
}

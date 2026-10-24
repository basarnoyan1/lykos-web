// Detailed tool titles, inputs and results load with the chat activity renderer.
import { visibleActivity } from './assistant-status.mjs';
export { elapsedLabel, visibleActivity } from './assistant-status.mjs';
// Presentation of observable agent work, never private model reasoning.
const titles = {
  plan_research: 'Update research plan', verify_research: 'Check research work', read_research_state: 'Read saved research work', create_artifact: 'Create deliverable', read_artifact: 'Read deliverable',
  present_answer: 'Structure answer', present_actions: 'Suggest actions', query_library: 'Filter library', inspect_records: 'Compare studies', review_status: 'Check review progress',
  discover_tools: 'Load tools', search_literature: 'Search literature', lookup_reference: 'Look up reference',
  search_web: 'Search web', read_web_page: 'Read web page',
  inspect_workflow: 'Inspect workflow', read_conversation: 'Read conversation', repeated_calls: 'Repeated requests',
  features: 'Look up feature', read_project: 'Read project', search_project: 'Search project', list_documents: 'List documents',
  read_document: 'Read document', read_open_file: 'Read open file', find_text: 'Find in documents', view_page: 'View page',
  list_folder: 'Browse folder', read_file: 'Read file', grep: 'Search files',
  propose_changes: 'Propose changes', propose_cell: 'Propose value', finish: 'Complete answer', ask_person: 'Ask you', open_page: 'Open page',
  compact: 'Condense earlier context', text: 'Response', plan: 'Plan', budget: 'Tool budget reached', no_progress: 'No further progress',
};
export function describeActivity(step, papers = []) {
  let args = {};
  try { args = typeof step.args === 'string' ? JSON.parse(step.args) : step.args || {}; } catch {}
  const paper = papers.find(p => p.id === args.doc_id);
  const source = args.section ? String(args.section).replace(/_/g, ' ')
    : args.path || (args.doc_id ? paper?.label || args.doc_id : '') || args.query || args.url || args.column || '';
  const pages = args.page ? `p. ${args.page}` : args.from ? `p. ${args.from}${args.to && args.to !== args.from ? `–${args.to}` : ''}` : '';
  return { title: titles[step.name] || String(step.name || 'Working').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    detail: [source, pages].filter(Boolean).join(', ').slice(0, 240),
    failed: step.type === 'error' || /^error:/i.test(step.result || '') };
}
/**
 * One line for the status bar and the live head: the tool at work (and how
 * many ran together), or how far the turn has got between model calls.
 */
export function progressText(run, papers = []) {
  if (!run) return '';
  if (run.stopping) return 'Stopping…';
  const a = run.active, done = visibleActivity(run.steps).length;
  if (a?.name === 'ask_person') return 'Waiting for your answer';
  if (a?.type === 'tool') {
    const info = describeActivity(a, papers);
    return a.parallel > 1 ? `${info.title}, ${a.parallel} requests at once` : [info.title, info.detail].filter(Boolean).join(': ');
  }
  if (a?.type === 'compact') return 'Condensing context';
  return done ? `Reviewing ${done} ${done === 1 ? 'result' : 'results'}` : 'Preparing response';
}

export function activityResult(step) {
  const text = String(step.result || '').trim();
  if ((!text && step.type === 'error') || /^error:\s*(?:undefined|null)?$/i.test(text)) return 'The request failed without an error message.';
  if (/^0 documents$/.test(text)) return 'No attached documents';
  if (/^0 entries in roots$/.test(text)) return 'No folders connected';
  const read = text.match(/^([^:]+): (\d+) of (\d+) items$/);
  if (read) return `${read[2]} of ${read[3]} ${read[1] === 'library' ? 'records' : 'items'} read`;
  return text || 'Completed';
}

export function activityInputs(step, papers = []) {
  let args;
  try { args = typeof step.args === 'string' ? JSON.parse(step.args) : step.args; } catch { return []; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  const labels = { section: 'Section', doc_id: 'Document', path: 'File or folder', query: 'Search', url: 'URL', from: 'From page', to: 'To page', page: 'Page', offset: 'Offset', limit: 'Limit', column: 'Field', pattern: 'File pattern' };
  return Object.entries(args).map(([key, value]) => ({
    label: labels[key] || key.replace(/_/g, ' '),
    value: key === 'doc_id' ? papers.find(p => p.id === value)?.label || String(value)
      : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''),
  }));
}

/** What the model said it would check, most recent first; '' when it said nothing. */
export const latestPlan = steps => [...(steps || [])].reverse().find(s => s.name === 'plan')?.result || '';

// ---- What a turn did, in words (owner via the Mobbin review, 2026-10-23: Replit and Base44 say "read, edited, ran", not "4 actions") ----
// The steps' summary row reads "Read 3 studies, queried the extraction, proposed 2 changes": each phrase from the kind of step and what it
// touched, in the order the work first did it, at most four phrases, with a failed step last. The count of steps, the time and the tokens are
// the row's tooltip. Pure: the steps and the project's records in, the words out.
const argsOf = s => { try { const a = typeof s.args === 'string' ? JSON.parse(s.args || '{}') : s.args || {}; return a && typeof a === 'object' ? a : {}; } catch { return {}; } };
const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DATA_FROM = { studies: 'extraction', extraction: 'extraction', values: 'extraction', patients: 'patient data', participants: 'patient data', library: 'library', records: 'library', screening: 'screening', appraisal: 'appraisal', outcomes: 'outcomes' };
const SOURCE_NAME = { pubmed: 'PubMed', epmc: 'Europe PMC', openalex: 'OpenAlex', crossref: 'Crossref', ctgov: 'ClinicalTrials.gov' };
const PAGE_NAME = { search: 'Literature' };
const READS = new Set(['read_document', 'view_page', 'find_text', 'inspect_records', 'screening_record', 'cell_context', 'similar_records', 'missed_values']);
// what a read retrieved, by scope (research tools review row 9): a document's pages are its full text; a record's view is its title and abstract
const FULL_TEXT = new Set(['read_document', 'view_page', 'find_text', 'missed_values']);
/** "Chen 2019, Ortiz 2021 and Ali 2020", the first three named and the rest counted. */
const named = (ids, papers) => { const n = ids.map(id => papers.find(p => p.id === id)?.label || id), head = n.slice(0, 3), more = n.length - head.length;
  return more ? `${head.join(', ')} and ${more} more` : head.length > 1 ? `${head.slice(0, -1).join(', ')} and ${head.at(-1)}` : head[0] || ''; };
const PROJECT_READS = new Set(['read_project', 'search_project', 'review_status', 'features', 'where_is', 'screening_status', 'appraisal_status', 'analysis_inputs', 'analysis_result', 'analysis_readiness', 'report_status', 'list_outputs', 'list_submissions', 'search_history']);
const MANUSCRIPT_READS = new Set(['manuscript_outline', 'manuscript_read', 'check_manuscript', 'check_citations', 'audit_claims', 'claim_ledger']);
const FILE_READS = new Set(['list_folder', 'read_file', 'grep', 'folder_plan', 'read_open_file']);
const ONE_CHANGE = new Set(['propose_value', 'propose_cell', 'propose_manuscript_update', 'propose_output', 'propose_analysis', 'propose_submission', 'propose_adjudication', 'propose_app_interaction', 'run_app_action']);

/** The phrases of a turn's steps, in order: [{ key, text }]. */
export function stepPhrases(steps = [], papers = []) {
  const shown = visibleActivity(steps), phrases = new Map();
  const add = (key, text) => { const at = phrases.get(key); phrases.set(key, { key, at: at ? at.at : phrases.size, text }); };
  const full = new Set(), abstracts = new Set(), docs = new Set(), files = new Set(), sources = new Set(), froms = new Set();
  let changes = 0, asked = 0, failed = 0, drafts = 0;
  const known = id => (papers || []).some(p => p.id === id);
  for (const s of shown) {
    const name = s.name, a = argsOf(s);
    if (describeActivity(s, papers).failed) { failed++; continue; }
    if (READS.has(name)) {
      const into = FULL_TEXT.has(name) ? full : abstracts;
      for (const id of [a.doc_id, a.paper_id, a.paper, ...(Array.isArray(a.ids) ? a.ids : []), ...(Array.isArray(a.doc_ids) ? a.doc_ids : [])].filter(Boolean)) (known(id) ? into : docs).add(id);
      // the scope and the studies by name: "read the full text of 3 studies: Chen 2019, Ortiz 2021 and Ali 2020"
      if (full.size) add('studies', `read the full text of ${counted(full.size, 'study', 'studies')}: ${named([...full], papers)}`);
      if (abstracts.size) add('abstracts', `read the abstracts of ${counted(abstracts.size, 'study', 'studies')}: ${named([...abstracts], papers)}`);
      if (!full.size && !abstracts.size) add('studies', docs.size ? `read ${counted(docs.size, 'document')}` : FULL_TEXT.has(name) ? 'searched the full texts' : 'read the studies');
    } else if (name === 'query_project' || name === 'describe_data') {
      const from = DATA_FROM[String(a.query?.from || a.template || '').toLowerCase()];
      if (from) froms.add(from);
      add('query', froms.size === 1 ? `queried the ${[...froms][0]}` : froms.size ? `queried the ${[...froms].slice(0, 2).join(' and ')}` : 'queried the project data');
    } else if (name === 'query_library') add('library', 'searched the library');
    else if (PROJECT_READS.has(name)) add('project', 'read the project');
    else if (MANUSCRIPT_READS.has(name)) add('manuscript', 'read the manuscript');
    else if (name === 'search_literature') { sources.add(SOURCE_NAME[a.source] || 'the literature'); add('literature', `searched ${[...sources].slice(0, 2).join(' and ')}`); }
    else if (name === 'lookup_reference') add('literature', sources.size ? `searched ${[...sources].slice(0, 2).join(' and ')}` : 'looked up references');
    else if (name === 'search_web' || name === 'read_web_page') add('web', 'searched the web');
    else if (FILE_READS.has(name)) { if (a.path && name !== 'list_folder') files.add(a.path); add('files', files.size ? `read ${counted(files.size, 'file')}` : 'browsed the folder'); }
    else if (name === 'propose_changes') { changes += Array.isArray(a.changes) ? a.changes.length : 1; add('changes', `proposed ${counted(changes, 'change')}`); }
    else if (ONE_CHANGE.has(name)) { changes += 1; add('changes', `proposed ${counted(changes, 'change')}`); }
    else if (name === 'create_artifact') { drafts++; add('drafts', drafts === 1 ? 'drafted a document' : `drafted ${drafts} documents`); }
    else if (name === 'kaplan_meier') add('survival', 'drew a survival curve');
    else if (name === 'open_page') add(`open-${a.page}`, `opened ${PAGE_NAME[a.page] || String(a.page || 'a page').replace(/^./, c => c.toUpperCase())}`);
    else if (name === 'ask_person') { asked++; add('asked', asked === 1 ? 'asked you' : `asked you ${asked} questions`); }
    else if (name === 'plan_research') add('plan', 'planned the work');
    else if (name === 'start_paper_run') add('run', 'started a paper run');
  }
  const out = [...phrases.values()].sort((x, y) => x.at - y.at).map(({ key, text }) => ({ key, text }));
  if (failed) out.push({ key: 'failed', text: `${counted(failed, 'step')} failed` });
  return out;
}

/** The summary row: the phrases joined as one sentence, at most four (a failed step is always said); '' when the turn did nothing to say. */
export function stepSummary(steps = [], papers = []) {
  const all = stepPhrases(steps, papers), failed = all.find(p => p.key === 'failed'), rest = all.filter(p => p !== failed);
  const shown = [...rest.slice(0, failed ? 3 : 4), ...(failed ? [failed] : [])].map(p => p.text);
  if (!shown.length) return '';
  const text = shown.join(shown.some(t => t.includes(':')) ? '; ' : ', ');   // a phrase that names its studies is kept apart from the next
  return text.charAt(0).toUpperCase() + text.slice(1);
}

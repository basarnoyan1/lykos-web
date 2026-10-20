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
  read_project: 'Read project', search_project: 'Search project', list_documents: 'List documents',
  read_document: 'Read document', read_open_file: 'Read open file', find_text: 'Find in documents', view_page: 'View page',
  list_folder: 'Browse folder', read_file: 'Read file', grep: 'Search files',
  propose_changes: 'Propose changes', propose_cell: 'Propose value', finish: 'Complete answer',
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
    detail: [source, pages].filter(Boolean).join(' · ').slice(0, 240),
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
  if (a?.type === 'tool') {
    const info = describeActivity(a, papers);
    return [info.title, a.parallel > 1 ? `${a.parallel} requests at once` : info.detail].filter(Boolean).join(' · ');
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

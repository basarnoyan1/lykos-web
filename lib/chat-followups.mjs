// After an answer, what to ask next (Unify's three follow-ups as ruled rows; owner via the Mobbin review, 2026-10-23): up to three requests
// the project's open work implies, as on the home (lib/chat-home.mjs), the pages the answer worked in first. Never stock questions: a
// project with nothing open gets none. A press sends the request as the person would type it.
//
//   touchedViews(turn)      the pages an answer worked in, from its steps and the changes it proposed, in the order it first touched them
//   followUps(...)          the rows: { label, ask, icon, title }
//   followUpsHtml(rows, i)  the rows under answer i (the home's rows, plain)
//
// Loaded with the conversation (app.mjs `followUpsMod`).
import { uiList, uiRow } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { askLabel } from './chat-home.mjs';
import { unresolved } from './progress.mjs';
import { nextResearchActions } from './research-workflow.mjs';

export const FOLLOW_UPS_MAX = 3;

// the page a tool reads or an op writes; a tool that is not about one page (the project, the web) names none
const TOOL_VIEW = {
  screening_status: 'screening', screening_record: 'screening', similar_records: 'screening', adjudication_queue: 'screening',
  cell_context: 'extraction', missed_values: 'extraction', propose_value: 'extraction', propose_cell: 'extraction',
  appraisal_status: 'appraisal', analysis_inputs: 'analysis', analysis_result: 'analysis', analysis_readiness: 'analysis', propose_analysis: 'analysis', kaplan_meier: 'analysis',
  manuscript_outline: 'manuscript', manuscript_read: 'manuscript', check_manuscript: 'manuscript', check_citations: 'manuscript', audit_claims: 'manuscript', propose_manuscript_update: 'manuscript',
  query_library: 'library', inspect_records: 'library', retraction_status: 'library', open_access_status: 'library',
  search_history: 'search', translate_query: 'search', report_status: 'reporting', list_submissions: 'submissions', propose_submission: 'submissions',
  list_outputs: 'outputs', propose_output: 'outputs',
};
const OP_VIEW = {
  screen: 'screening', label: 'screening', assign_screening: 'screening', add_field: 'extraction', set_arms: 'extraction', appraise: 'appraisal',
  set_outcome: 'analysis', edit_paragraph: 'manuscript', insert_paragraph: 'manuscript', insert_manuscript_output: 'manuscript',
  set_protocol: 'protocol', add_criterion: 'protocol', edit_criterion: 'protocol', set_target_journal: 'submissions', set_report_item: 'reporting',
  set_search_query: 'search', run_search: 'search', add_task: 'tasks', update_task: 'tasks', create_project_note: 'notes',
};
const argsOf = s => { try { const a = typeof s.args === 'string' ? JSON.parse(s.args || '{}') : s.args || {}; return a && typeof a === 'object' ? a : {}; } catch { return {}; } };

/** The pages an answer worked in, in the order it first touched them. */
export function touchedViews(turn) {
  const out = [];
  const add = v => { if (v && !out.includes(v)) out.push(v); };
  for (const s of turn?.steps || []) {
    const a = argsOf(s);
    if (s.name === 'open_page') add(a.page);
    else if (s.name === 'propose_changes') for (const c of Array.isArray(a.changes) ? a.changes : []) add(OP_VIEW[c?.op]);
    else add(TOOL_VIEW[s.name]);
  }
  for (const b of turn?.blocks || []) if (b.type === 'written') add(b.view || 'manuscript');
  return out;
}

/**
 * The follow-ups for an answer: the open work (what blocks first, then the next steps, then the gaps), one per page, the pages the answer
 * worked in first, the question just asked and the work the answer's own proposals already wait on left out. `views` is the rail's keys.
 */
export function followUps({ turn, question = '', state, views = [], iconOf = () => 'draft-question', open = unresolved(state), next = nextResearchActions(state) } = {}) {
  const shown = new Set(views), touched = touchedViews(turn), asked = String(question).trim().toLowerCase();
  const items = [...open.filter(u => u.severity === 'block'), ...next.map(a => ({ ...a, step: true })), ...open.filter(u => u.severity !== 'block')];
  const seen = new Set(), rows = [];
  for (const item of items) {
    if (!shown.has(item.view) || seen.has(item.view)) continue;
    const label = askLabel(item);
    if (!label || label.toLowerCase() === asked) continue;
    // the proposals the answer just filed are its review line's, not a follow-up's
    if (item.kind === 'proposals' && (turn?.proposals || []).length) continue;
    seen.add(item.view);
    rows.push({ label, ask: label, icon: iconOf(item.view), title: item.text || label, view: item.view });
  }
  const rank = v => { const i = touched.indexOf(v); return i < 0 ? touched.length : i; };
  return rows.map((r, k) => [r, k]).sort(([a, i], [b, j]) => rank(a.view) - rank(b.view) || i - j).map(([r]) => r).slice(0, FOLLOW_UPS_MAX);
}

/** The rows under answer i, as the home's rows (one button each, led by the page's icon), plain, the icons on the answer's edge; '' when none. */
export function followUpsHtml(rows, i, { disabled = false } = {}) {
  if (!rows.length) return '';
  return uiList({ label: 'Suggested next steps', cls: 'assist-followups', plain: true, attrs: { 'data-followups': i },
    rows: rows.map(r => uiRow({ cls: 'assist-home-row', main: { html: `<button type="button" class="assist-home-act" data-sugg="${esc(r.ask)}" title="${esc(r.title)}"${disabled ? ' disabled' : ''}>${icon(r.icon, { size: 16 })}<span>${esc(r.label)}</span></button>` } })) });
}

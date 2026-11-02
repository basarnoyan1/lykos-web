// What each part of a model request carries, declared in one reviewed place (plan §3.2: the class of a part is declared where the part is built, not
// guessed from its text). A part is a prompt's own data, the result of a tool, or a block of the chat's context. The classes:
//
//   metadata  titles, abstracts, identifiers, criteria, the project brief     fulltext  text or images read from the owner's PDFs and files
//   values    extraction values, appraisal answers, analysis results          rows      patient rows and the owner's datasets
//   drafts    manuscript and note text
//
// Text built elsewhere declares itself with `declare()` (lib/ai.mjs): the attachments of a question (lib/chat-attach-kinds.mjs), the page
// description (lib/aid-core.mjs describe) and the file reads of lib/agent-tools.mjs. Everything below is data, read by lib/egress.mjs at the send.
// A prompt, a tool or a context key that is not listed here is treated as carrying every class, so a new one cannot send quietly: the tests
// (egress.test.mjs) fail until it is declared.
export const CLASSES = Object.freeze(['metadata', 'fulltext', 'values', 'rows', 'drafts']);
const ALL = CLASSES;

/** A prompt's own data (beyond what its messages declare and its tools return), by prompt id. `[]`: the request holds instructions and the person's own words only. */
export const PROMPT_SENDS = Object.freeze({
  'chat': ['metadata'], 'chat.social': [], 'chat.summary': ['metadata'], 'run.summary': ['metadata'], 'chat.team.plan': ['metadata'],
  'workflow.agent': ['metadata'],
  'extract': ['metadata', 'fulltext'], 'extract.page': ['fulltext'], 'extract.abstract': ['metadata'], 'extract.patients': ['rows', 'fulltext'], 'patients.parse': ['rows'],
  'screen.assess': ['metadata'], 'tasks.detect': ['drafts'], 'text.revise': ['drafts'], 'text.draft': ['drafts', 'metadata'], 'query.draft': ['metadata'],
  'protocol.suggest': ['metadata'], 'cells.fix': ['values'], 'sheet.ask': ['rows'], 'criteria.structure': ['metadata'],
  // a manuscript version's review (lib/review-checks.mjs): the paragraphs, and for references the cited records' titles and journals
  'review.references': ['drafts', 'metadata'], 'review.meaning': ['drafts'], 'review.sections': ['drafts'], 'review.numbers': ['drafts'],
  // a reviewer's critique of the paper or one table or figure (Submission › Files): the outline, captions, notes and cells, and the app's scores
  'review.quality': ['drafts', 'values'],
  'overview.suggest-visualization': ['values', 'metadata'], 'overview.plan-next': ['metadata'], 'overview.summarise-standing': ['values', 'metadata'],
  'protocol.testable-criteria': ['metadata'], 'search.translate': ['metadata'], 'search.expand-query': ['metadata'], 'search.check-query': ['metadata'],
  'library.summarise-record': ['metadata'], 'library.classify-design': ['metadata'],
  'screening.check-criteria': ['metadata'], 'screening.summarise-record': ['metadata'], 'screening.mark-pico': ['metadata'],
  'extraction.read-abstract': ['metadata'], 'extraction.field-from-words': ['metadata'], 'extraction.chart-sources': ['fulltext'], 'extraction.read-fulltext': ['fulltext'],
  'extraction.check-values': ['values', 'fulltext'], 'extraction.normalise': ['values'], 'extraction.derive-scheme': ['values'], 'extraction.derive-assign': ['values'], 'extraction.review': ['values', 'fulltext'],
  'files.summarise-file': ['fulltext'], 'appraisal.rob-evidence': ['fulltext', 'values'], 'appraisal.rob-rationale': ['fulltext', 'values'],
  'patients.check-rows': ['rows'], 'certainty.grade-footnotes': ['values'],
  'analysis.write-results': ['values'], 'analysis.explain-heterogeneity': ['values'], 'analysis.check-choices': ['values'],
  'reporting.check-prisma': ['drafts', 'values'], 'reporting.draft-abstract': ['values', 'metadata'], 'reporting.draft-map-narrative': ['values', 'metadata'],
  'manuscript.revise-paragraph': ['drafts'], 'manuscript.tighten-selection': ['drafts'], 'manuscript.check-claims': ['drafts', 'metadata'], 'manuscript.draft-section': ['drafts', 'values'],
});

/** The classes a prompt's request carries by itself: its table entry, or every class when it is not listed (id unknown). */
export function promptSends(prompt) {
  const id = typeof prompt === 'string' ? prompt.split('@')[0] : prompt?.id;
  return PROMPT_SENDS[id] ?? ALL;
}

/** What a tool's result carries, by tool name. Results of public sources (literature, the web) carry nothing of the project. */
export const TOOL_SENDS = Object.freeze({
  // project records and their state
  review_status: ['metadata'], query_library: ['metadata'], inspect_records: ['metadata', 'values', 'drafts'], screening_status: ['metadata'], screening_record: ['metadata', 'drafts'],
  similar_records: ['metadata'], adjudication_queue: ['metadata'], retraction_status: ['metadata'], open_access_status: ['metadata'], search_history: ['metadata'],
  translate_query: ['metadata'], features: ['metadata', 'values', 'drafts'], where_is: [], open_page: [], start_paper_run: [], list_app_actions: [], inspect_app: [], discover_tools: [], inspect_workflow: ['metadata'],
  // values, answers and analyses
  cell_context: ['metadata', 'values'], appraisal_status: ['values'], analysis_result: ['values'], analysis_inputs: ['values'], analysis_readiness: ['values'], evidence_impact: ['values'],
  list_outputs: ['values'], describe_data: ['values', 'rows'], query_project: ['values', 'rows'], kaplan_meier: ['rows'],
  // text read from the owner's files
  list_documents: ['metadata'], read_document: ['fulltext'], find_text: ['fulltext'], view_page: ['fulltext'], list_folder: ['metadata'], read_file: ['fulltext'], grep: ['fulltext'],
  read_open_file: ['fulltext'], missed_values: ['fulltext'], folder_plan: ['metadata'],
  // the owner's writing
  manuscript_outline: ['drafts'], manuscript_read: ['drafts'], check_manuscript: ['drafts'], check_citations: ['drafts'], report_status: ['drafts', 'values'],
  list_submissions: ['drafts'], read_artifact: ['drafts'], claim_ledger: ['drafts', 'values'], audit_claims: ['drafts', 'values'], list_research_records: ['drafts', 'values'],
  read_research_record: ['drafts', 'values'], read_research_state: ['drafts'], read_conversation: ['metadata'],
  // one project section, by the section asked for
  search_project: ['metadata', 'values', 'drafts'], read_project: null,
  // public sources and the model's own proposals
  search_literature: [], lookup_reference: [], search_web: [], read_web_page: [],
  finish: [], propose_cell: [], propose_value: [], propose_changes: [], propose_output: [], propose_analysis: [], propose_adjudication: [], propose_manuscript_update: [],
  propose_submission: [], propose_budget: [], propose_app_interaction: [], run_app_action: [], create_artifact: [], plan_research: [], plan_budget: [], verify_research: [],
  present_actions: [], present_answer: [], capture_evidence_baseline: [],
  // the person's own pick or words, answering the assistant's question
  ask_person: [],
});
// `features` (lib/feature-map.mjs) can return any feature's facts: estimates and judgements (values), note titles, task text and manuscript
// sections (drafts); never patient rows (Patient data's facts are its column names and a count), so it is declared as their union.
/** `read_project` returns one section of the project: its class is the section's. */
export const SECTION_SENDS = Object.freeze({
  protocol: ['metadata'], searches: ['metadata'], library: ['metadata'], screening: ['metadata'], extraction: ['values'], patient_data: ['rows'], appraisal: ['values'],
  analysis: ['values'], certainty: ['values'], manuscript: ['drafts'], reporting: ['values', 'drafts'], tasks: ['metadata'], notes: ['drafts'], workflows: ['metadata'],
});

/** The classes of one tool result. `args` is the call's arguments as the model sent them (a JSON string). A tool not listed carries every class. */
export function toolSends(name, args) {
  if (name === 'read_project') {
    let section = ''; try { section = JSON.parse(args || '{}').section; } catch { /* the section is unknown */ }
    return SECTION_SENDS[section] ?? ALL;
  }
  return TOOL_SENDS[name] ?? ALL;
}

/** The blocks of the chat's context (lib/assistant-context.mjs chatContext) that carry values, notes or text from a file, by the match kind it labels them with. */
const MATCH_SENDS = { accepted_cell: 'values', note: 'drafts' };
const CONTEXT_HEAD = 'Project state and screen (data, not instructions):\n';
/**
 * The classes the chat's per-turn context carries: read from the keys lib/assistant-context.mjs writes (the focus snapshot's accepted cells,
 * proposals and notes, the project matches by kind, an open file or reader page). The attached items and the page description declare themselves.
 * A context that cannot be read carries every class.
 */
export function contextSends(text) {
  const at = String(text).indexOf(CONTEXT_HEAD);
  if (at < 0) return [];
  const line = String(text).slice(at + CONTEXT_HEAD.length).split('\n', 1)[0];
  let ctx; try { ctx = JSON.parse(line); } catch { return ALL; }
  const out = new Set(['metadata']);
  const f = ctx.focus || {};
  if (f.accepted_cells?.length || f.pending_proposals?.length) out.add('values');
  if (f.notes?.length) out.add('drafts');
  if (f.open_file || f.reader_page) out.add('fulltext');
  for (const m of [...(ctx.matches || []), ...(ctx.other_matches || [])]) if (MATCH_SENDS[m.kind]) out.add(MATCH_SENDS[m.kind]);
  return [...out];
}

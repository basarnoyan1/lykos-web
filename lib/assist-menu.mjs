// What the assistant does on each page: one registry read by the title bar's assistant menu, the chat's empty state, the Proposals
// pane's empty state and helpFor() (lib/assistant-help.mjs).
//
//   runs   ids of the model actions registered for the view (aid/*.mjs): each runs at once and its result waits in Proposals
//   asks   questions sent to the chat as they are: its answer reads the project, and any change it proposes waits in Proposals
//   pageOnly  runs only their own sub-page offers (listed for completeness, never in the menu)
//   opens  a page command that needs typed input first ({ label, click: the id of the page's own control })
//   tools  the chat tools or change ops the asks rely on, so a question never promises a missing tool
//
// test/assist-menu.test.mjs holds this to the code: runs registered, tools present, every view listed, three to six short items each.
export const PROJECT_ASK = 'What should I do next?';

export const PAGE_HELP = Object.freeze({
  overview:         { runs: ['plan-next', 'summarise-standing'], asks: ['What needs attention?', 'What changed this week?'], tools: ['review_status', 'read_project'] },
  protocol:         { runs: ['testable-criteria'], asks: ['Turn the title into a PICO', 'Which designs are eligible?', 'Suggest eligibility criteria'], tools: ['read_project', 'set_protocol', 'add_criterion'] },
  search:           { runs: ['expand-query', 'check-query', 'translate-pubmed', 'translate-epmc'], asks: ['Translate this query for Embase', 'Which searches are not logged?'], tools: ['translate_query', 'search_history'] },
  library:          { runs: ['summarise-record', 'classify-design'], asks: ['Which records are duplicates?', 'Which records lack a full text?'], tools: ['query_library', 'inspect_records'] },
  screening:        { runs: ['check-criteria', 'summarise-record', 'mark-pico'], asks: ['Does this record meet criteria?', 'Which criterion excludes it?'], tools: ['screening_status', 'screening_record'] },
  extraction:       { runs: ['read-fulltext', 'check-values', 'chart-sources', 'read-abstract', 'derive-fields', 'normalise-fields', 'review-data'], pageOnly: ['normalise-fields', 'review-data'], asks: ['Which fields are still empty?'], tools: ['cell_context', 'missed_values'] },
  patients:         { runs: ['read-selection', 'check-rows'], asks: ['How should I code the outcome?', 'Which columns does this need?'], tools: ['describe_data', 'query_project'] },
  appraisal:        { runs: ['rob-evidence', 'rob-rationale'], asks: ['Which tool fits this design?', 'Which domains are still open?'], tools: ['appraisal_status'] },
  analysis:         { runs: ['write-results', 'explain-heterogeneity', 'check-choices'], asks: ['Are any inputs missing?'], tools: ['analysis_inputs', 'analysis_result'] },
  certainty:        { runs: ['grade-footnotes'], asks: ['Justify the certainty rating', 'Which GRADE domains apply here?', 'What lowers the certainty most?'], tools: ['analysis_result', 'read_project'] },
  manuscript:       { runs: ['revise-paragraph', 'check-claims', 'draft-section', 'link-results', 'tighten-selection'], asks: ['Check references against library'], tools: ['check_manuscript', 'manuscript_outline'] },
  outputs:          { runs: ['suggest-visualization'], asks: ['Which table shows this best?', 'Which figures should I make?'], tools: ['list_outputs', 'describe_data'] },
  reporting:        { runs: ['check-prisma', 'draft-abstract', 'draft-map-narrative'], asks: ['Which PRISMA items are blank?'], tools: ['report_status'] },
  submissions:      { runs: [], asks: ['What is missing for submission?', 'Which journal fits this paper?', 'Draft the cover letter'], tools: ['list_submissions', 'report_status'] },
  files:            { runs: ['summarise-file'], asks: ['What is in this folder?', 'Which files go with which stage?'], tools: ['list_folder', 'read_file', 'folder_plan'] },
  folder:           { runs: [], asks: ['What is in this folder?', 'Which files go with which stage?', 'Which files are not in place?'], tools: ['list_folder', 'folder_plan'] },
  tasks:            { runs: [], opens: [{ label: 'Suggest tasks from text…', click: 'tk-suggest' }], asks: ['Which tasks are overdue?', 'Which tasks block others?'], tools: ['read_project', 'review_status', 'add_task'] },
  notes:            { runs: [], asks: ['Summarise my recent notes', 'Which notes name a study?', 'Draft a note from this chat'], tools: ['read_project', 'search_project', 'create_project_note'] },
  workflows:        { runs: [], asks: ['Set up a screening workflow', 'Why did the last run fail?', 'Which workflows are scheduled?'], tools: ['inspect_workflow', 'save_workflow'] },
  dashboard:        { runs: [], asks: ['What needs attention here?', 'What is due this week?', 'What changed this week?'], tools: ['review_status', 'read_project'] },
  changes:          { runs: [], asks: ['What changed today?', 'What does this affect?', 'Which outputs are stale?'], tools: ['read_project'] },
  notifications:    { runs: [], asks: ['What changed since last time?', 'Which alerts need action?', 'Summarise the new search hits'], tools: ['read_project', 'search_history'] },
  case:             { runs: [], asks: ['Which CARE items are missing?', 'Draft the timeline paragraph', 'Check the case against CARE'], tools: ['report_status', 'read_project'] },
  datasets:         { runs: [], asks: ['Describe this dataset', 'Which columns have gaps?', 'Which analysis fits these data?'], tools: ['describe_data', 'query_project', 'analysis_readiness'] },
  coding:           { runs: [], asks: ['Which codes overlap?', 'Summarise the themes so far', 'Which transcripts are not coded?'], tools: ['read_project', 'search_project'] },
  trialOperations:  { runs: [], asks: ['What is the recruitment status?', 'Which visits are overdue?', 'Summarise the deviations'], tools: ['read_project', 'query_project'] },
  imaging:          { runs: [], asks: ['Which images lack a reading?', 'Summarise the readings so far', 'Which studies have images?'], tools: ['read_project', 'query_project'] },
  advancedAnalysis: { runs: [], asks: ['Which method fits these data?', 'Are the assumptions checked?', 'Explain this result'], tools: ['analysis_readiness', 'analysis_result'] },
  dta:              { runs: [], asks: ['Which studies lack a 2x2 table?', 'Explain the summary ROC curve', 'Is there threshold variation?'], tools: ['analysis_inputs', 'analysis_result'] },
  umbrella:         { runs: [], asks: ['Which reviews overlap?', 'Summarise the review evidence', 'Which reviews are low quality?'], tools: ['query_library', 'read_project'] },
  synthesis:        { runs: [], asks: ['Summarise the themes so far', 'Which findings lack support?', 'Draft a CERQual summary'], tools: ['read_project', 'search_project'] },
  nma:              { runs: [], asks: ['Is the network connected?', 'Which comparisons are indirect?', 'Explain the ranking'], tools: ['analysis_inputs', 'analysis_result'] },
  confidence:       { runs: [], asks: ['Justify the confidence rating', 'Which components lower it?', 'Draft the CERQual footnotes'], tools: ['read_project'] },
});

const blank = { runs: [], asks: [], opens: [], tools: [] };
/** A page's entry ({ runs, asks, opens, tools }); a page without one (Settings, Start) asks only the project-wide question. */
export const pageHelp = view => ({ ...blank, ...(PAGE_HELP[view] || { asks: [PROJECT_ASK] }) });

/**
 * What the assistant menu and the empty states show for a page now: the runs the view offers in this state (`available`, the actions
 * aid.actionsFor returns, in the registry's order), the page commands, and the questions (with the project-wide one last in the chat).
 */
export function pageMenu(view, available = []) {
  const help = pageHelp(view), byId = new Map(available.map(a => [a.id, a]));
  return { runs: help.runs.map(id => byId.get(id)).filter(Boolean), opens: help.opens, asks: help.asks };
}

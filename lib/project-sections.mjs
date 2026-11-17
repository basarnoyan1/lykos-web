// The review-state sections a reader pages (lib/project-memory.mjs readProjectSection), on their own so a caller that only names them
// (the MCP server's tool list) does not load the readers and the many modules behind them.
export const PROJECT_SECTIONS = ['protocol', 'searches', 'library', 'screening', 'extraction', 'patient_data',
  'appraisal', 'analysis', 'certainty', 'manuscript', 'reporting', 'tasks', 'notes', 'workflows',
  'submissions', 'datasets', 'proposals', 'notifications', 'synthesis'];

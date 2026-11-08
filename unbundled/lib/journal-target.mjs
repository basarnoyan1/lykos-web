// The target journal as the project keeps it: project.journals[0], with paper.journal mirroring it for older readers. What follows from it (the
// reference style, the journal profile) is worked out in lib/journal-context.mjs, which re-exports these; the shell names the target through
// lib/workflow.mjs without loading the journal presets and profiles.
export const targetJournal = s => s.project?.journals?.[0] || s.paper?.journal || '';
export const otherJournals = s => (s.project?.journals || []).slice(1);

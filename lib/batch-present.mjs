// Whether a batch extraction has left anything the shell shows: proposed patient rows, stamped cell proposals, or a stopped batch to resume.
// The answer is read from the project alone, so the shell can leave views/batch-control.mjs and views/batch-proposals.mjs unloaded until
// it is true. Each is a necessary condition of what those modules draw: batchProposalCount and batchEntryHtml are empty without the first
// two (patientCounts reads ipdProposals, stampedCells the `qa` stamp), and resumableBatch is null without the third (its own first test).
export function batchPresent(state) {
  if ((state.ipdProposals || []).length) return true;
  for (const p of Object.values(state.proposals || {})) if (p?.qa) return true;
  const job = (state.jobs || []).find(j => j.kind === 'extract' && j.batch);
  return !!job && !job.dismissed && ['stopped', 'failed'].includes(job.status);
}

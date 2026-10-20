import { validateArtifact, artifactFormats } from './research-artifacts.mjs';

/** Checks observable structure and progress, not the scientific truth of prose. */
export function checkResearch(blocks = [], observations = []) {
  const issues = [], artifacts = blocks.filter(b => b.type === 'artifact');
  const plan = blocks.find(b => b.type === 'plan')?.plan;
  const add = (severity, check, detail) => issues.push({ severity, check, detail });
  for (const b of artifacts) {
    try { validateArtifact(b.artifact); } catch (e) { add('error', b.title || 'Deliverable', e.message); }
    if (!b.artifact.sources?.length) add('warning', b.title || b.artifact.title, 'No sources listed. Cite evidence or label this as an unsourced draft.');
    if (b.artifact.sections.some(s => s.type === 'table' && !s.rows?.length)) add('warning', b.artifact.title, 'A table has no rows. Label the template or supply verified data.');
  }
  const unfinished = (plan?.steps || []).filter(s => ['pending', 'active'].includes(s.status));
  for (const step of unfinished) add('error', step.title, 'This step is unfinished. Execute it, or mark it blocked with the observed reason.');
  for (const step of (plan?.steps || []).filter(s => s.status === 'blocked')) {
    if (!step.detail?.trim()) add('error', step.title, 'A blocked step needs a reason so the work can resume.');
  }
  const completed = (plan?.steps || []).filter(s => s.status === 'done');
  if (completed.length && !observations.some(o => o.ok && !['plan_research', 'discover_tools', 'verify_research'].includes(o.name))) add('warning', 'Completion evidence', 'Completed steps have no successful work tools in this turn. Inspect earlier results before claiming completion.');
  const latest = new Map();
  for (const o of observations) latest.set(`${o.name} ${o.key || ''}`, o);
  const errors = [...latest.values()].filter(o => !o.ok && o.name !== 'verify_research');
  for (const error of errors.slice(-6)) add('warning', error.name, `Unresolved tool result: ${String(error.result || '').slice(0, 220)}`);
  return { scope: 'Structural and execution checks only; sources, claims and scientific methods require their own evidence review.',
    canFinish: !issues.some(i => i.severity === 'error'), issues: issues.slice(0, 30),
    counts: { successfulTools: observations.filter(o => o.ok).length, failedTools: observations.filter(o => !o.ok).length, artifacts: artifacts.length, completedSteps: completed.length, blockedSteps: plan?.steps.filter(s => s.status === 'blocked').length || 0, unfinishedSteps: unfinished.length },
    artifacts: artifacts.map(b => ({ title: b.artifact.title, formats: artifactFormats(b.artifact), status: 'draft' })) };
}

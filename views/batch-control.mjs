// Running a batch extraction (lib/extract-batch.mjs) from wherever the person is: Extraction's Fill popover, Patient intake, or the status bar.
//
// The batch is a job (lib/jobs.mjs) that carries what it was asked to do (`batch`: mode, table, studies), so a batch that was stopped, or
// that the app closed on, can be taken up again without the Fill panel: the plan skips every cell and row that already holds a value or
// a proposal, so running the same request again asks only for what is left.
import { get, update } from '../store.mjs';
import { stopRun } from '../lib/agent.mjs';
import { configured } from '../lib/ai.mjs';
import { modelFor, settings } from '../lib/model-settings.mjs';
import { run as runJob, running as runningJobs, cancel as cancelJob } from '../lib/jobs.mjs';
import { runBatch, reportLine, planOf } from '../lib/extract-batch.mjs';

/** The batch's state, kept outside any page: a run in progress rebuilds the view that started it. */
export const batch = { mode: 'cells', scope: 'included', running: false, summary: '', report: null };
export const runningIds = new Set();
const trackRun = id => runningIds.add(id);

/** The Fill model reads every study; the Extraction model re-reads only what the rules flagged, when it is another model. */
export function batchSetup() {
  const cfg = modelFor('fill'); if (!configured(cfg)) return null;
  const s = settings();
  const m = modelFor('extract');
  return { cfg, budget: { calls: s.agent?.calls || 40, tokens: s.agent?.tokens || 150000 }, parallel: Math.max(1, Math.min(4, s.agent?.parallel || 1)),
    strong: configured(m) && !(m.id === cfg.id && m.model === cfg.model) ? { cfg: m, model: m.model } : null };
}

/**
 * Runs a batch as a job and keeps its report in `batch`. `after` is called when its state changes (the panel repaints its bar);
 * `ctx` repaints the view and the counts when it ends. Returns the report, or null when it could not start or stopped with an error.
 */
export async function startBatch(ctx, request, after = () => {}) {
  const setup = batchSetup();
  if (!setup) { batch.summary = 'No model configured'; after(); return null; }
  const { mode, scope, templateId } = request;
  batch.running = true; batch.summary = ''; batch.report = null; after();
  let report = null;
  try {
    await runJob('extract', mode === 'patients' ? 'Extract patient rows' : 'Fill table cells', async job => {
      // the page that started it follows the count and the steps (views/extraction-fill.mjs); the job's own count reaches the status bar
      const h = request.onCount ? { ...job, count: (done, total) => { job.count(done, total); request.onCount(done, total); } } : job;
      report = await runBatch({ mode, templateId, scope, paperIds: request.paperIds || null, cheap: { cfg: setup.cfg, model: request.model || setup.cfg.model }, strong: setup.strong,
        budget: request.budget || setup.budget, concurrency: setup.parallel, onRunStart: trackRun, onStep: request.onStep }, h);
      batch.report = report; batch.summary = reportLine(report);
      // a stopped batch ends its job as stopped, not done: that is what makes it something to resume
      if (report.stopped) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
      return { summary: batch.summary };
    }, { batch: { mode, templateId: templateId || null, scope, paperIds: request.paperIds || null } });
  } catch (err) { if (err?.name === 'AbortError' && report) batch.summary = reportLine(report); else { batch.summary = `Stopped: ${String(err?.message || err).slice(0, 120)}`; report = null; } }
  finally { batch.running = false; ctx?.rerender?.(); ctx?.refreshCounts?.(); after(); }
  return report;
}

/** Asks the running batch to stop: the job, and the model runs of the studies under way. */
export function stopBatch() {
  for (const j of runningJobs()) if (j.kind === 'extract') cancelJob(j.id);
  for (const id of runningIds) stopRun(id);
}

/**
 * A batch that stopped, failed or was interrupted and still has work: { job, left, carried, mode }, else null. `left` is the studies
 * the plan would read now, `carried` the proposed rows or cells that no rule check has stamped. Asked of the plan, not remembered.
 */
export function resumableBatch(state = get()) {
  if (runningJobs().some(j => j.kind === 'extract')) return null;
  const job = (state.jobs || []).find(j => j.kind === 'extract' && j.batch);
  if (!job || job.dismissed || !['stopped', 'failed'].includes(job.status)) return null;
  try {
    const plan = planOf(state, { ...job.batch, templateId: job.batch.templateId || 'default' });
    return plan.papers || plan.carried ? { job, left: plan.papers, carried: plan.carried, mode: job.batch.mode } : null;
  } catch { return null; }
}

/** Runs the stopped batch's request again; what it already read is not asked for again. */
export function resumeBatch(ctx) {
  const r = resumableBatch(); if (!r) return null;
  return startBatch(ctx, r.job.batch);
}

/** Stops offering to resume the latest batch (it stays in the job log). */
export function dismissBatch() {
  const r = resumableBatch(); if (!r) return;
  update(s => { const j = (s.jobs || []).find(x => x.id === r.job.id); if (j) j.dismissed = true; return s; }, { indexNeutral: true });
}

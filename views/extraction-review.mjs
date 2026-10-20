// Review data, on the Data summary page (design note 2026-10-13 §5, stage 4): the dialog that shows what the local review found and what asking a
// model would cost, before anything is sent; and the run (the `review-data` action of aid/extraction.mjs through lib/aid.mjs, so it can be
// stopped and its findings wait in Proposals). The local review has run by the time the dialog opens: free, and exact. The model step asks
// first, samples the studies chosen here (ten by default) and honours the run budget. Nothing here writes a value.
//
// Every token figure the dialog shows is an ESTIMATE (lib/extraction-review-model.mjs). What a run used is read from the provider.
import { ensureAid, aidNow } from '../lib/aid-core.mjs';
import { checkBudget, runBudgetOf, runBudgetProblem } from '../lib/extraction-normalise.mjs';
import { extractionReview } from '../lib/prompts-views.mjs';
import { promptSends } from '../lib/egress-declared.mjs';
import { SAMPLE_DEFAULT } from '../lib/extraction-review-model.mjs';
import { REVIEW_KINDS } from '../lib/extraction-review.mjs';
import { reviewRows, reviewScope, reviewStatus } from '../lib/extraction-summary-view.mjs';
import { claimRun, releaseRun, setLastRun } from './extraction-normalise.mjs';
import { runPreview } from '../lib/run-preview.mjs';
import { formField } from '../lib/ui-components.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { modelFor, settings } from '../lib/model-settings.mjs';
import { esc } from '../lib/html.mjs';
import { plural, num } from '../lib/dates.mjs';

/** The table as a run reads it: its columns (the schema) and its studies. */
const inputs = model => ({ fields: model.cols, studies: model.all.map(p => ({ id: p.id, label: p.label })), templateId: model.templateId });

/**
 * The model step's dialog. `info` is what the action hands over once the local review is done: { counts, unchecked, unreadable, plan, model }.
 * Resolves to { sample, budget } to go on, or null to keep the local findings only.
 */
async function chooseSample(info) {
  const { countInput, budgetNumber } = await import('../lib/chat-budget.mjs');
  const { plan } = info, start = runBudgetOf(settings()), first = Math.min(SAMPLE_DEFAULT, plan.studyCount);
  const rows = reviewRows(info.counts, REVIEW_KINDS).map(([label, n]) => uiRow({ main: { html: esc(label) }, cells: [{ col: 'count', kind: 'visual', html: esc(num(n)) }] }));
  const body = `${uiList({ id: 'rv-found', label: 'Found without the model', cols: ['count'], rows })}
    <p class="meta">${esc(reviewScope(plan.itemCount, plan.studyCount))}</p>
    ${formField('Studies to check', countInput('studies', first))}${formField('Calls in this run', countInput('calls', start.calls))}${formField('Tokens in this run', countInput('tokens', start.tokens))}
    <p class="meta" role="status" id="rv-status"></p>`;
  const read = d => {
    const form = d.querySelector('form');
    const studies = budgetNumber(form.elements.studies.value), budget = { calls: budgetNumber(form.elements.calls.value), tokens: budgetNumber(form.elements.tokens.value) };
    const wrongSample = !Number.isInteger(studies) || studies < 1 || studies > plan.studyCount ? `Studies: 1 to ${num(plan.studyCount)}` : '';
    const wrong = wrongSample || runBudgetProblem(budget);
    const totals = wrong ? null : plan.forSample(studies).totals;
    return { studies, budget, wrong, totals, check: wrong ? { ok: false, problems: [wrong] } : checkBudget(totals, budget) };
  };
  return runPreview({ id: 'extraction-review', title: 'Review data', confirm: 'Run', cancel: 'Skip model', body, cfgs: [info.cfg], classes: promptSends(extractionReview),
    onMount: (d, close, preview) => {
      const status = d.querySelector('#rv-status'), ok = d.querySelector('[type=submit]');
      const update = () => {
        const r = read(d);
        preview.revise({ items: r.totals ? { n: r.totals.asked, noun: 'item' } : null, tokens: r.totals?.calls ? { inTokens: r.totals.inTokens, outTokens: r.totals.outTokens } : null })
        status.textContent = r.wrong || reviewStatus(r.totals, r.budget, r.check.problems);
        ok.disabled = !r.check.ok;
        ok.title = ok.disabled ? 'Choose fewer studies or raise the budget' : '';
      };
      d.addEventListener('input', update); d.addEventListener('change', update); update();
    },
    submit: (form, d) => { const r = read(d); return r.check.ok ? { sample: r.studies, budget: r.budget } : undefined; } });
}

/** What the model step did, in a few words for the page's notice; '' when there was nothing to say (nothing was left for it). */
function noticeStep(entry, sent) {
  if (sent) return `${plural(sent.sample, 'study', 'studies')} sent to the model`;
  const note = String(entry.note || '');
  return /No model is set/.test(note) ? 'No model is set' : /was skipped/.test(note) ? 'Model step skipped' : '';
}

/**
 * Review data, from the title bar's More: the local review runs at once; if it leaves anything a model could settle and a model is set, the
 * dialog shows the exact counts and the estimate and asks; then the run files its findings in Proposals and its notes on the cells.
 * `onChange` repaints the page and its title bar (the act is Stop while a run goes).
 */
export async function startReview(ctx, model, onChange) {
  const run = claimRun('review'); if (!run) return;
  onChange();
  let entry = null, failure = '', sent = null;
  try {
    await ensureAid();
    entry = await aidNow().run('extraction', 'review-data', { view: 'extraction', viewTitle: 'Extraction', summary: true, signal: run.abort.signal,
      review: { ...inputs(model), confirm: async info => { sent = await chooseSample({ ...info, cfg: modelFor('extract') }); return sent; } } });
  } catch (err) { failure = String(err?.message || err); }
  releaseRun();
  // the notice is short (two lines at the narrowest width): the findings and the whole account are the proposal's, in Proposals
  const found = entry?.items?.length || 0;
  setLastRun(entry ? { title: entry.status === 'done' ? '' : entry.status === 'stopped' ? 'Review stopped' : 'Review failed',
    note: entry.status === 'done' ? [found ? `${plural(found, 'finding')} in Proposals` : 'No findings', noticeStep(entry, sent)].filter(Boolean).join('. ') : entry.error }
    : { title: 'Review failed', note: failure });
  onChange();
}

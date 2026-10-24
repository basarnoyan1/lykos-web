// Normalise, on the Data summary page (design note 2026-10-13 §4, stage 3): what a run would send and cost, asked before it starts; the run
// itself (the `normalise-fields` action of aid/extraction.mjs through lib/aid.mjs, so it can be stopped and its proposals wait in the ledger);
// and the groupings it proposed that wait for a person. The page (./extraction-summary.mjs) draws them. Nothing here writes a value: a run
// files a proposal, and an accepted one only decides how texts are counted.
//
// Every token figure the dialog shows is an ESTIMATE (lib/extraction-normalise.mjs), and says so. What a run used is read from the provider.
import { ensureAid, aidReady, aidNow } from '../lib/aid-core.mjs';
import { planRun, checkBudget, runBudgetOf, runBudgetProblem, cheaperModelSuggestion } from '../lib/extraction-normalise.mjs';
import { extractionNormalise } from '../lib/prompts-views.mjs';
import { promptSends } from '../lib/egress-declared.mjs';
import { planDetail, planStatus } from '../lib/extraction-summary-view.mjs';
import { runPreview } from '../lib/run-preview.mjs';
import { formField } from '../lib/ui-components.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { modelFor, settings } from '../lib/model-settings.mjs';
import { configured } from '../lib/ai.mjs';
import { esc } from '../lib/html.mjs';
import { num } from '../lib/dates.mjs';

let current = null;       // { abort, kind } while a run of the Data summary is going (Normalise or Review data: one at a time)
let last = null;          // { title, note } of the latest run, until it is dismissed
export const normaliseRunning = () => !!current;
export const stopNormalise = () => current?.abort.abort();
/** What the title bar says while a run goes (the status slot is 24 characters). */
export const runningText = () => (current?.kind === 'review' ? 'Reviewing the data' : 'Asking the model');
/** Takes the one run slot of the page; null when a run is already going. Review data shares Normalise's slot, Stop and notice. */
export function claimRun(kind) { if (current) return null; current = { abort: new AbortController(), kind }; return current; }
export const releaseRun = () => { current = null; };
export const setLastRun = run => { last = run; };
export const lastRun = () => last;
export const clearLastRun = () => { last = null; };

/** The table as a run reads it: its columns (the schema) and its studies. */
const inputs = model => ({ fields: model.cols, studies: model.all.map(p => ({ id: p.id, label: p.label })) });

/** What Normalise would do now, without a model call. */
export function planFor(model, cfg) {
  const mem = model.st.extractionSummary || {};
  return planRun({ ...inputs(model), values: model.st.values || {}, proposals: model.st.proposals || {}, mappings: mem.fields || {}, cache: mem.cache || {}, model: cfg?.model || '' });
}

// ---- the dialog: the estimate and the confirmation, before anything is sent -------------------------------------------------------------------

async function chooseRun(plan, cfg, mem) {
  const { countInput, budgetNumber } = await import('../lib/chat-budget.mjs');
  const start = runBudgetOf(settings());
  const rows = plan.fields.map(f => uiRow({ check: { checked: true, label: `Normalise ${f.label}`, attrs: { 'data-nf': f.id } }, main: { html: esc(f.label), detail: planDetail(f).map(esc), wrap: true } }));
  const better = cheaperModelSuggestion({ mappings: mem?.fields || {}, evals: (mem?.runs || []).filter(r => r.kind === 'eval'), current: cfg.model });
  const body = `${uiList({ id: 'nf-fields', label: 'Fields to normalise', rows })}
    ${formField('Calls in this run', countInput('calls', start.calls))}${formField('Tokens in this run', countInput('tokens', start.tokens))}
    <p class="meta" role="status" id="nf-status"></p>
    ${better ? `<p class="meta">Eval run: ${esc(better.model)} scored ${Math.round(better.score * 100)}% on ${num(better.items)} groupings</p>` : ''}`;
  const read = d => {
    const form = d.querySelector('form'), chosen = plan.fields.filter(f => d.querySelector(`[data-nf="${CSS.escape(f.id)}"]`)?.checked);
    const totals = chosen.reduce((t, f) => ({ fields: t.fields + 1, calls: t.calls + f.calls.length, inTokens: t.inTokens + f.inTokens, outTokens: t.outTokens + f.outTokens }), { fields: 0, calls: 0, inTokens: 0, outTokens: 0 });
    const budget = { calls: budgetNumber(form.elements.calls.value), tokens: budgetNumber(form.elements.tokens.value) };
    const wrong = runBudgetProblem(budget);
    return { chosen, totals, budget, wrong, check: wrong ? { ok: false, problems: [wrong] } : checkBudget(totals, budget) };
  };
  // The shared run preview (lib/run-preview.mjs) shows where the run goes, the model, the data classes and the estimate; the fields below are this page's own.
  return runPreview({ id: 'extraction-normalise', title: 'Normalise fields', confirm: 'Run', body, cfgs: [cfg], classes: promptSends(extractionNormalise),
    onMount: (d, close, preview) => {
      const status = d.querySelector('#nf-status'), ok = d.querySelector('[type=submit]');
      const update = () => {
        const r = read(d);
        preview.revise({ items: { n: r.chosen.reduce((n, f) => n + f.askedItems, 0), noun: 'value' }, tokens: r.totals.calls ? { inTokens: r.totals.inTokens, outTokens: r.totals.outTokens } : null })
        status.textContent = r.wrong || planStatus(r.totals, r.budget, r.check.problems);
        ok.disabled = !r.chosen.length || !r.check.ok;
        ok.title = ok.disabled ? (r.chosen.length ? 'Raise the budget or choose fewer fields' : 'Choose a field') : '';
      };
      d.addEventListener('input', update); d.addEventListener('change', update); update();
    },
    submit: (form, d) => { const r = read(d); return r.chosen.length && r.check.ok ? { fieldIds: r.chosen.map(f => f.id), budget: r.budget } : undefined; } });
}

/**
 * Normalise, from the title bar: the plan and its estimate in a dialog, then the run. `onChange` repaints the page and its title bar (the
 * primary is Stop while a run goes). The model's grouping arrives as proposals in the ledger, listed by the page and by Proposals.
 */
export async function startNormalise(ctx, model, onChange) {
  if (current) return;
  const cfg = modelFor('extract');
  if (!configured(cfg)) { ctx.say?.('No model is set for Extraction. Choose one in Settings, AI.'); return; }
  const plan = await planFor(model, cfg);
  if (!plan.fields.length) { ctx.say?.('Nothing to ask: every value is counted or grouped'); return; }
  const pick = await chooseRun(plan, cfg, model.st.extractionSummary);
  if (!pick) return;
  claimRun('normalise'); onChange();
  let entry = null, failure = '';
  try {
    await ensureAid();
    entry = await aidNow().run('extraction', 'normalise-fields', { view: 'extraction', viewTitle: 'Extraction', summary: true, signal: current.abort.signal,
      normalise: { ...inputs(model), fieldIds: pick.fieldIds, budget: pick.budget } });
  } catch (err) { failure = String(err?.message || err); }
  releaseRun();
  last = entry ? { title: entry.status === 'done' ? '' : entry.status === 'stopped' ? 'Normalise stopped' : 'Normalise failed', note: entry.status === 'done' ? entry.note : entry.error }
    : { title: 'Normalise failed', note: failure };
  onChange();
}

// ---- the proposals the page lists ---------------------------------------------------------------------------------------------------------------

/** The open grouping proposals, newest first, one per field: Map(fieldId -> { entry, item }). Empty until the assistant's actions have loaded. */
export function proposalsByField() {
  const out = new Map();
  if (!aidReady()) return out;
  for (const x of aidNow().openItems()) if (x.entry.view === 'extraction' && x.entry.action === 'normalise-fields' && x.item.field && !out.has(x.item.field)) out.set(x.item.field, x);
  return out;
}
export const acceptProposal = ({ entry, item }) => aidNow().accept(entry.id, item.id);
export const discardProposal = ({ entry, item }) => aidNow().discard(entry.id, item.id);

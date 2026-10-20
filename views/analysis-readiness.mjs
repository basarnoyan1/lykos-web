// Analysis readiness (DIALOGS #11, §4.1): a check of the analysis a page has already configured (Datasets > Analyse, the patient
// table there, Advanced analysis), never a second form. The page's head offers Check readiness and shows the verdict as its status;
// the inspector's Details section "Readiness" lists the issues, the declared design, the assumptions and the SAP comparison, and
// holds the one act, Propose frozen analysis. The report lives here per page (sections are redrawn on every paint) and is dropped
// when the page's inputs or the project's source data change, so a stale report is never proposed.
import { get, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { sentenceLabel, disclosure } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';
import { inspectorActions } from '../lib/ui-actions.mjs';
import { analysisReadiness, proposeAnalysis } from '../lib/research-copilot.mjs';
import { proposalSourceSnapshot } from '../lib/research-ledger.mjs';

const scalar = value => value == null ? 'Not available' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
/** Human-readable computed fields; the complete object remains in Export. */
export function resultFields(value, depth = 0) {
  if (!value || typeof value !== 'object') return esc(scalar(value));
  if (depth >= 4) return `<span class="meta">${Array.isArray(value) ? value.length : 'Nested'} entries · see Export</span>`;
  const rows = Object.entries(value), shown = rows.slice(0, 25);
  // a list of names and values (the inspector's props), so a long value wraps in the pane instead of running past it
  return `${rows.length > 25 ? `<p class="meta">First 25 of ${rows.length}</p>` : ''}<dl class="props">${shown.map(([key, item]) => `<dt>${esc(Array.isArray(value) ? Number(key) + 1 : sentenceLabel(key))}</dt><dd>${item && typeof item === 'object' ? `<details class="ui-disclosure"><summary>${Array.isArray(item) ? plural(item.length, 'entry', 'entries') : 'Fields'}</summary>${resultFields(item, depth + 1)}</details>` : esc(scalar(item))}</dd>`).join('')}</dl>`;
}

const DESIGN = [['clustered', 'Clustered observations'], ['repeated', 'Repeated observations'], ['competingRisks', 'Competing events']];
const REPLACED = 'The project was replaced. Check readiness again from its page.';
const SOURCE_CHANGED = 'Source data changed. Check readiness again.';
let generation = null;
const checks = new Map();   // page key -> { design, report, args, source, message, filed }
function entry(key) {
  if (generation !== projectGeneration()) { generation = projectGeneration(); checks.clear(); }
  if (!checks.has(key)) checks.set(key, { design: {}, report: null, args: '', source: '', message: '', filed: false });
  return checks.get(key);
}
const withDesign = (c, args) => ({ ...args, design: { ...c.design } });
/** The report while it still describes what the page shows; a change of the source data drops it and says so. */
function fresh(c, args) {
  if (!c.report) return null;
  if (c.source !== proposalSourceSnapshot(get())) { Object.assign(c, { report: null, filed: false, message: SOURCE_CHANGED }); return null; }
  if (c.args !== JSON.stringify(withDesign(c, args))) { Object.assign(c, { report: null, filed: false, message: '' }); return null; }
  return c.report;
}
const errorsOf = r => r.issues.filter(i => i.severity === 'error').length;

/** The verdict as the page head's status, or null while nothing has been checked (the page keeps its own status). */
export function readinessStatus(key, args) {
  const r = fresh(entry(key), args());
  if (!r) return null;
  return { text: r.ready ? 'Ready for review' : `${plural(errorsOf(r), 'input')} need${errorsOf(r) === 1 ? 's' : ''} attention`, ch: 24 };
}

/** Runs the check on the page's current analysis. Throws when the project was replaced since the page was drawn. */
export function checkReadiness(key, args, drawn = projectGeneration()) {
  if (drawn !== projectGeneration()) throw new Error(REPLACED);
  const c = entry(key), state = get(), a = withDesign(c, args());
  Object.assign(c, { report: analysisReadiness(state, a), args: JSON.stringify(a), source: proposalSourceSnapshot(state), message: '', filed: false });
  return c.report;
}

/** The page head's act. `after` repaints the page (and with it the status and the inspector), and shows Details. */
export function readinessAct(key, args, { after, say }) {
  const drawn = projectGeneration();
  return { id: 'readiness-check', label: 'Check readiness', icon: 'check-square', run: () => {
    try { checkReadiness(key, args, drawn); after(); } catch (error) { say?.(error.message); }
  } };
}

/** The inspector's Details section. `args` reads the page's analysis when it is called, not when the section was drawn. */
export function readinessSection(key, args, ctx) {
  const c = entry(key), r = fresh(c, args()), drawn = projectGeneration();
  const html = `${r?.issues.length ? `<dl class="props" data-readiness-issues>${r.issues.map(i => `<dt>${esc(sentenceLabel(i.severity))}</dt><dd>${esc(i.detail)}</dd>`).join('')}</dl>` : ''}
    <div class="an-settings" role="group" aria-labelledby="readiness-design-label"><span id="readiness-design-label" class="meta">Design</span>${DESIGN.map(([k, l]) => `<label class="cr-check"><input type="checkbox" data-design="${k}"${c.design[k] ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
    ${r ? disclosure({ title: 'Assumptions', count: r.assumptions.length, body: `<ul>${r.assumptions.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` }) : ''}
    ${r?.sapCheck?.length ? disclosure({ title: 'SAP comparison', count: r.sapCheck.length, body: resultFields(r.sapCheck) }) : ''}
    <p class="meta" data-readiness-status role="status" aria-live="polite">${esc(c.message)}</p>
    ${inspectorActions({ id: 'readiness-acts', label: 'Readiness actions', actions: [c.filed
      ? { id: 'readiness-review', label: 'Review proposal', attrs: { 'data-readiness-review': '' } }
      : { id: 'readiness-propose', label: 'Propose frozen analysis', role: 'primary', disabled: !r?.ready, attrs: { 'data-readiness-propose': '' } }] })}`;
  return { title: 'Readiness', meta: r ? r.ready ? 'Ready' : plural(errorsOf(r), 'issue') : 'Not checked', html, wire: el => {
    const say = text => { c.message = text; const n = el.querySelector('[data-readiness-status]'); if (n) n.textContent = text; };
    el.querySelectorAll('[data-design]').forEach(box => box.onchange = () => {
      c.design[box.dataset.design] = box.checked;
      if (!c.report) return;
      ctx.rerender(); document.querySelector(`[data-design="${box.dataset.design}"]`)?.focus();
    });
    el.querySelector('[data-readiness-review]')?.addEventListener('click', () => ctx.openProposals?.());
    el.querySelector('[data-readiness-propose]')?.addEventListener('click', e => {
      try {
        if (drawn !== projectGeneration()) throw new Error(REPLACED);
        if (!fresh(c, args())) { e.currentTarget.disabled = true; throw new Error(c.message || SOURCE_CHANGED); }
        proposeAnalysis(get(), withDesign(c, args()));
        Object.assign(c, { filed: true, message: 'Proposal saved for your review' });
        ctx.rerender();
      } catch (error) { say(error.message); }
    });
  } };
}

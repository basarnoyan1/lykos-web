// The one preview every model run that spends tokens or leaves this machine shows before it starts (plan §3.4, stage 2). It says where the run goes
// (this Mac, or a named host), which model, how many items, the estimated tokens and cost where the price is known (always labelled estimates), the
// data classes involved and the budget; and, when the connection may not yet receive a class, asks once to allow it and records the answer on the
// connection (lib/egress.mjs). Built from formDialog, so a page's own fields (a budget, a sample) sit in the same dialog: Normalise and Review data
// pass theirs as `body`. Loaded when a run is about to start.
import { formDialog, formValues } from './dialog.mjs';
import { uiList, uiRow } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { num, plural } from './dates.mjs';
import { routeOf, modelInfo, PROVIDERS } from './ai.mjs';
import { CLASSES, LABELS, classPhrase, hostOfCfg, missingFor } from './egress.mjs';
import { allowClasses } from './egress-scope.mjs';
import { profiles } from './model-settings.mjs';
export { promptSends } from './egress-declared.mjs';

const modelOf = c => c.model || PROVIDERS[c.provider]?.defaultModel || nameOf(c);
const nameOf = cfg => cfg?.label || cfg?.model || PROVIDERS[cfg?.provider]?.label || 'this connection';
/** Dollars as a person reads an estimate: two decimals above a cent, else "under 1 cent". */
const dollars = v => (v < 0.01 ? 'under 1 cent' : `$${v.toFixed(2)}`);

/**
 * What a run would do, as rows of { key, label, detail: [lines] } plus the classes a connection may not yet receive. Pure.
 *   cfgs     the connections the run uses (one, or two for a second model)
 *   items    how many things are sent and what they are: { n, noun, nouns } (omitted when not known)
 *   tokens   { inTokens, outTokens }, the app's own estimate (omitted when not known)
 *   classes  the data classes the run carries
 *   budget   { calls, tokens, per? } the run stops at, in all or per `per` (omitted when none)
 */
export function runFacts({ cfgs = [], items = null, tokens = null, classes: asked = [], budget = null } = {}) {
  const list = cfgs.filter(Boolean), same = new Set(), classes = CLASSES.filter(c => asked.includes(c));   // the classes in their one order
  const where = list.map(c => (routeOf(c) === 'local' ? `${modelOf(c)} on this Mac. Nothing leaves this machine` : `${modelOf(c)} at ${hostOfCfg(c) || 'a remote host'} (cloud)`)).filter(x => !same.has(x) && same.add(x));
  const rows = [{ key: 'where', label: 'Sent to', detail: where.length ? where : ['No model is set'] }];
  const run = [];
  if (items) run.push(items.n === 1 ? `1 ${items.noun}` : plural(items.n, items.noun, items.nouns || `${items.noun}s`));
  if (tokens) {
    run.push(`About ${num(tokens.inTokens)} tokens in${tokens.outTokens == null ? '' : ` and ${num(tokens.outTokens)} out`} (estimate)`);
    const one = list.length === 1 && routeOf(list[0]) === 'cloud' ? modelInfo(list[0]) : null;
    if (one && one.promptPrice != null && one.completionPrice != null && tokens.outTokens != null) run.push(`About ${dollars((tokens.inTokens * one.promptPrice + tokens.outTokens * one.completionPrice) / 1e6)} (estimate from list prices)`);
    else if (one) run.push('Cost not known for this model');
  }
  if (budget) run.push(`${plural(budget.calls, 'call')} and ${num(budget.tokens)} tokens at most${budget.per ? ` per ${budget.per}` : ''}`);
  if (run.length) rows.push({ key: 'run', label: 'This run', detail: run });
  const missing = [...new Set(list.flatMap(c => missingFor(c, classes)))];
  rows.push({ key: 'data', label: 'Data sent', detail: classes.length ? [classes.map(c => LABELS[c]).join(', '), ...(missing.length ? [`Not yet allowed: ${missing.map(c => LABELS[c]).join(', ')}`] : [])] : ['No project data'] });
  return { rows, missing };
}

const rowsHtml = facts => facts.rows.map(r => uiRow({ attrs: { 'data-rp': r.key }, main: { html: esc(r.label), detail: r.detail.map(esc), wrap: true } }));
/** The facts as the list the dialog shows (also usable inside a page). */
export const previewHtml = facts => uiList({ id: 'rp-facts', label: 'What this run sends', rows: rowsHtml(facts) });

const allowHtml = (facts, cfgs) => uiList({ id: 'rp-allow', label: 'Allow data classes', rows: [uiRow({
  check: { checked: false, label: `Allow ${classPhrase(facts.missing)} for ${cfgs.map(nameOf)[0]}`, attrs: { 'data-rp-allow': '' } },
  main: { html: esc(`Allow ${classPhrase(facts.missing)}`), detail: [`for ${nameOf(cfgs.find(c => missingFor(c, facts.missing).length) || cfgs[0])}. Change it in Settings > Models`], wrap: true } })] });

/**
 * Shows the preview and asks. Resolves to what `submit` returns (true when the page has no fields of its own), or null when cancelled.
 *   id, title, detail, confirm, cancel   the dialog (formDialog)
 *   body       the page's own fields, below the facts
 *   onMount    (dialog, close, preview) after the dialog is drawn; `preview.revise(patch)` re-draws the facts when the page's own fields change the run
 * A connection that may not yet receive a class of the run shows one check to allow it; the run cannot start until it is checked, and the answer is
 * saved on the connection when the run is confirmed. Cancelling saves nothing.
 */
export async function runPreview({ id = 'run-preview', title, detail = '', tier = 'M', confirm = 'Run', cancel = 'Cancel', cfgs = [], items = null, tokens = null, classes = [], budget = null, body = '', onMount = null, submit = null } = {}) {
  let spec = { items, tokens, budget }, facts = runFacts({ cfgs, classes, ...spec });
  const live = cfgs.filter(Boolean);
  // the body scrolls while the head and the foot stay (the recipe, as planDialog does): the facts and a page's own fields can pass the dialog's height
  const html = () => `<div class="ask-scroll">${previewHtml(facts)}${facts.missing.length ? allowHtml(facts, live) : ''}${body}</div>`;
  return formDialog({ id, title, detail, tier, confirm, cancel, body: html(),
    onMount: (d, close) => {
      const preview = { facts: () => facts, revise(patch) {
        spec = { ...spec, ...patch }; facts = runFacts({ cfgs, classes, ...spec });
        const at = d.querySelector('#rp-facts'); if (at) at.outerHTML = previewHtml(facts);
      } };
      onMount?.(d, close, preview);
    },
    submit: async (form, d) => {
      const missing = facts.missing;
      const box = d.querySelector('[data-rp-allow]');
      if (missing.length && !box?.checked) {
        if (!d.querySelector('#rp-needed')) d.querySelector('#rp-allow').insertAdjacentHTML('afterend', `<p class="meta" id="rp-needed" role="alert">${esc(`Allow ${classPhrase(missing)} to run this`)}</p>`);
        box?.focus(); return undefined;
      }
      const v = submit ? await submit(form, d) : formValues(form);
      if (v === undefined) return undefined;
      for (const c of live) { const need = missingFor(c, classes); if (need.length) allowClasses(c, need); }
      return v === null ? true : v;
    } });
}

/** A run with no fields of its own: resolves true to go on, false when cancelled. */
export const confirmRun = async spec => (await runPreview({ ...spec, submit: () => true })) === true;

/**
 * Before a chat message goes: the connection as it is, at once, when it may receive everything the message carries (the brief and the attached items);
 * else the preview asks, once, to allow what it may not yet receive, and the answer is the connection with that saved; false when cancelled. The classes
 * of the tools the model calls later are checked when they are sent.
 */
export async function askBeforeSend(cfg, attached = []) {
  const classes = [...new Set(['metadata', ...attached.map(a => a.dataClass)])];
  if (!missingFor(cfg, classes).length) return cfg;
  const ok = await confirmRun({ title: `Send to ${nameOf(cfg)}?`, confirm: 'Send', cfgs: [cfg], classes, items: attached.length ? { n: attached.length, noun: 'attached item' } : null });
  return ok && { ...cfg, sends: profiles().find(p => p.id === cfg.id)?.sends ?? cfg.sends };
}

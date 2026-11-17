// What a model run that spends tokens or leaves this machine asks before it starts (plan §3.4, stage 2; amended 31 Oct 2026). A run whose
// connections may already receive every data class it carries starts at once: a confirm that asks nothing was a dialog between the person and a
// press they had decided on. A connection that may not yet receive a class asks once, in words that name the connections and the data
// ("Allow Jev to receive records and the project brief?"), with where the run goes, its size and estimate under the question; its primary
// ("Allow and propose") allows and runs, the answer saved on each connection that needed it (lib/egress.mjs). A run with fields of its own (a
// budget, a sample: Normalise, Review data, Re-screen) is a dialog whatever it asks, the facts above its fields. Loaded when a run is about to start.
import { lib_dialog$formDialog as formDialog, lib_dialog$formValues as formValues } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_dates$num as num, lib_dates$plural as plural } from "../boot.mjs";
import { routeOf, modelInfo, PROVIDERS } from './ai.mjs';
import { CLASSES, LABELS, classPhrase, hostOfCfg, missingFor } from './egress.mjs';
import { allowClasses } from './egress-scope.mjs';
import { lib_model_settings$profiles as profiles } from "../boot.mjs";
export { promptSends } from './egress-declared.mjs';

const modelOf = c => c.model || PROVIDERS[c.provider]?.defaultModel || nameOf(c);
const nameOf = cfg => cfg?.label || cfg?.model || PROVIDERS[cfg?.provider]?.label || 'this connection';
/** Dollars as a person reads an estimate: two decimals above a cent, else "under 1 cent". */
const dollars = v => (v < 0.01 ? 'under 1 cent' : `$${v.toFixed(2)}`);

/**
 * What a run would do, as rows of { key, label, detail: [lines] } plus the classes a connection may not yet receive. Pure.
 *   cfgs     the connections the run uses (one, or two for a second model)
 *   items    how many things are sent and what they are: { n, noun, nouns } (omitted when not known)
 *   tokens   { inTokens, outTokens, to? }, the app's own estimate (omitted when not known); `to` names the model it is for when the run has two
 *   classes  the data classes the run carries
 *   budget   { calls, tokens, per? } the run stops at, in all or per `per` (omitted when none)
 *   roles    each connection's part of the run, in the order of `cfgs` (omitted when it has one part)
 */
export function runFacts({ cfgs = [], roles = [], items = null, tokens = null, classes: asked = [], budget = null } = {}) {
  const list = cfgs.filter(Boolean), same = new Set(), classes = CLASSES.filter(c => asked.includes(c));   // the classes in their one order
  // one line a connection, its part of the run after it when the caller names one ("every record, three cross-check passes")
  const where = list.map((c, i) => `${routeOf(c) === 'local' ? `${modelOf(c)} on this Mac. Nothing leaves this machine` : `${modelOf(c)} at ${hostOfCfg(c) || 'a remote host'} (cloud)`}${roles[i] ? `: ${roles[i]}` : ''}`).filter(x => !same.has(x) && same.add(x));
  const rows = [{ key: 'where', label: 'Sent to', detail: where.length ? where : ['No model is set'] }];
  const run = [];
  if (items) run.push(items.n === 1 ? `1 ${items.noun}` : plural(items.n, items.noun, items.nouns || `${items.noun}s`));
  if (tokens) {
    run.push(`About ${num(tokens.inTokens)} tokens in${tokens.outTokens == null ? '' : ` and ${num(tokens.outTokens)} out`}${tokens.to ? ` to ${tokens.to}` : ''} (estimate)`);
    const one = list.length === 1 && routeOf(list[0]) === 'cloud' ? modelInfo(list[0]) : null;
    if (one && one.promptPrice != null && one.completionPrice != null && tokens.outTokens != null) run.push(`About ${dollars((tokens.inTokens * one.promptPrice + tokens.outTokens * one.completionPrice) / 1e6)} (estimate from list prices)`);
    else if (one) run.push('Cost not known for this model');
  }
  if (budget) run.push(`${plural(budget.calls, 'call')} and ${num(budget.tokens)} tokens at most${budget.per ? ` per ${budget.per}` : ''}`);
  if (run.length) rows.push({ key: 'run', label: 'This run', detail: run });
  const missing = [...new Set(list.flatMap(c => missingFor(c, classes)))];
  rows.push({ key: 'data', label: 'Data sent', detail: classes.length ? [classes.map(c => LABELS[c]).join(', ')] : ['No project data'] });
  return { rows, missing };
}

// where the run goes: a connection a line (two read as a list, not one run-on line); the other facts on one line each
const rowsHtml = facts => facts.rows.map(r => uiRow({ attrs: { 'data-rp': r.key }, main: { html: esc(r.label), detail: r.key === 'where' ? [r.detail.map(esc).join('<br>')] : r.detail.map(esc), wrap: true } }));
/** The facts as the list the dialog shows (also usable inside a page). */
export const previewHtml = facts => uiList({ id: 'rp-facts', label: 'What this run sends', rows: rowsHtml(facts) });

/** The connections a class still waits on, by name: "Jev and claude-sonnet-5-5". */
const waitingOn = (cfgs, missing) => { const n = [...new Set(cfgs.filter(c => missingFor(c, missing).length).map(nameOf))]; return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`; };

/**
 * Asks before a run. Resolves to what `submit` returns (true when the page has no fields of its own), or null when cancelled.
 *   id, title, detail, confirm, cancel   the dialog (formDialog); while a class waits to be allowed the title is that question, and `title`
 *              (its "?" dropped) names the run under it
 *   body       the page's own fields, below the facts
 *   onMount    (dialog, close, preview) after the dialog is drawn; `preview.revise(patch)` re-draws the facts when the page's own fields change the run
 * The answer is saved on each connection that needed it when the run is confirmed; cancelling saves nothing.
 */
export async function runPreview({ id = 'run-preview', title, detail = '', tier = 'M', confirm = 'Run', cancel = 'Cancel', cfgs = [], roles = [], items = null, tokens = null, classes = [], budget = null, body = '', onMount = null, submit = null } = {}) {
  let spec = { items, tokens, budget, roles }, facts = runFacts({ cfgs, classes, ...spec });
  const live = cfgs.filter(Boolean), missing = facts.missing;
  const asking = missing.length > 0;
  const head = asking ? `Allow ${waitingOn(live, missing)} to receive ${classPhrase(missing)}?` : title;
  const sub = asking ? [String(title || '').replace(/\?$/, ''), detail].filter(Boolean).join('. ') : detail;
  const verb = asking ? `Allow and ${String(confirm).charAt(0).toLowerCase()}${String(confirm).slice(1)}` : confirm;
  // the body scrolls while the head and the foot stay (the recipe, as planDialog does): the facts and a page's own fields can pass the dialog's height
  const html = () => `<div class="ask-scroll">${previewHtml(facts)}${asking ? `<p class="meta" id="rp-saved">${esc('Saved for these connections. Settings › Models changes it.')}</p>` : ''}${body}</div>`;
  return formDialog({ id, title: head, detail: sub, tier, confirm: verb, cancel, body: html(),
    onMount: (d, close) => {
      const preview = { facts: () => facts, revise(patch) {
        spec = { ...spec, ...patch }; facts = runFacts({ cfgs, classes, ...spec });
        const at = d.querySelector('#rp-facts'); if (at) at.outerHTML = previewHtml(facts);
      } };
      onMount?.(d, close, preview);
    },
    submit: async (form, d) => {
      const v = submit ? await submit(form, d) : formValues(form);
      if (v === undefined) return undefined;
      for (const c of live) { const need = missingFor(c, classes); if (need.length) allowClasses(c, need); }
      return v === null ? true : v;
    } });
}

/** A run with no fields of its own: true at once when every connection may receive what it carries, else the one question; false when cancelled. */
export async function confirmRun(spec) {
  if (!runFacts({ cfgs: spec.cfgs || [], classes: spec.classes || [] }).missing.length) return true;
  return (await runPreview({ ...spec, submit: () => true })) === true;
}

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

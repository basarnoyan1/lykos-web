// Screening › Re-screen excluded: a false-negative sweep. The records excluded at a stage are assessed again with one rule left out;
// a record that would no longer be excluded is listed for a second look. The answers are proposals, kept apart from the review's own
// (lib/screening-checks.mjs); nothing is decided here. With a protocol scenario shown, the sweep reads the exclusions the scenario asks
// again under its own criteria (sweepScenario) and keeps its answers in the scenario's overlay; the page offers them as its decisions.
import { store$get as get } from "../boot.mjs";
import { lib_late_abstracts$whenReady as whenReady } from "../boot.mjs";
import { scenarioView, reaskedExclusions } from '../lib/scenarios.mjs';
import { scenarioOf } from '../lib/scenario-runs.mjs';
import { lib_rules_key$criteriaAt as criteriaAt, lib_rules_key$rulesKey as rulesKey } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_dates$num as num, lib_dates$plural as plural } from "../boot.mjs";
import { estimateTokens } from '../lib/assist.mjs';
import { assessMany } from '../lib/helpers.mjs';
import { runPreview, promptSends } from '../lib/run-preview.mjs';
import { SCREEN_ASSESS } from '../lib/prompts.mjs';
import { lib_ui_components$formField as formField } from "../boot.mjs";
import { screenMany } from '../lib/jev.mjs';
import { lib_jobs$run as runJob } from "../boot.mjs";
import { sweepScope, mostCitedRule, rescreenExcluded, commitSweep, sweepOf, sweepFlagged, sweepResult } from '../lib/screening-checks.mjs';

/**
 * What a scenario's sweep reads at a stage: { records: the exclusions it asks again (main's exclusions whose reason it re-asks, none of
 * its own decision), rules: its criteria at the stage, rule: the criteria it removes or rewords, as the sweep's name }.
 */
const scopes = new WeakMap();   // per view (kept per project version, lib/scenarios.mjs) and stage: the title bar asks on every draw
export function scenarioSweepScope(s, scenario, stage) {
  const view = scenarioView(s, scenario), held = scopes.get(view) || new Map();
  if (!held.has(stage)) { held.set(stage, scopeOf(s, scenario, stage, view)); scopes.set(view, held); }
  return held.get(stage);
}
function scopeOf(s, scenario, stage, view) {
  // the view marked them as it was made (final review I5: judging every record again took most of the picker's time on Screening)
  const sc = scenarioOf(s, scenario), records = reaskedExclusions(view, stage);
  const rules = criteriaAt(view.protocol?.criteria || [], stage).filter(r => r.kind !== 'group');
  return { records, rules, rule: [...sc.criteria.remove, ...Object.keys(sc.criteria.change)].join(', ') || sc.name || sc.id };
}

/** The fingerprint of a scenario's criteria at a stage, as its sweep stores it. */
export const sweepRulesKey = (s, scenario, stage) => rulesKey(scenarioSweepScope(s, scenario, stage).rules);

/**
 * A scenario's sweep: waits for the late abstracts (lib/late-abstracts.mjs whenReady) before the engine reads a record, then reads the
 * scope from the project as it is then, and keeps the answers in the scenario's overlay (commitSweep with `scenario`); main's sweeps are
 * not touched. `engine(records, rules, onEach)` as rescreenExcluded's. Answers { scope, results }.
 */
export async function sweepScenario({ scenario, stage, engine, model = '', onProgress = () => {} }) {
  await whenReady();
  const { records, rules, rule } = scenarioSweepScope(get(), scenario, stage), results = {};
  await engine(records, rules, (record, answer) => {
    if (!answer || !answer.verdict) return;
    results[record.id] = sweepResult(answer);
    onProgress(Object.keys(results).length, records.length);
  });
  const out = { scope: records.map(p => p.id), results };
  // the fingerprint of the criteria it read under: an answer is accepted only while the scenario's criteria are still these
  commitSweep(stage, { ruleId: rule, ruleText: '', model, ...out, fingerprint: rulesKey(rules) }, { scenario });
  return out;
}

/** The scenario's sweep from the page: one confirmation with what it reads and costs, then a job (as the main sweep's). */
async function scenarioSweepDialog({ scenario, stage, stageLabel, jev, text, onChange }) {
  const s = get(), { records, rules } = scenarioSweepScope(s, scenario, stage);
  if (!rules.length) { onChange('Nothing to re-screen: this scenario has no criteria at this stage'); return; }
  if (!jev && !text) { onChange('Nothing to re-screen: choose a decision or screening model in Settings'); return; }
  const model = jev ? jev.model : text.model, sweep = sweepOf(s, stage, scenario);
  const tokens = records.reduce((a, p) => a + estimateTokens(`${p.title} ${p.abstract || ''} ${rules.map(c => c.question || c.text).join(' ')}`), 0) * (jev ? 3 : 1);
  const go = await runPreview({ id: 'rescreen', tier: 'S', title: 'Re-screen excluded', detail: sweep ? `${stageLabel}, replaces the scenario's re-screen` : stageLabel, confirm: 'Re-screen',
    cfgs: [jev || text], classes: promptSends(SCREEN_ASSESS),
    body: `<p class="meta" role="status">${esc(records.length ? `${plural(records.length, 'exclusion')} this scenario asks again, read under its criteria, ${model}, ~${num(tokens)} tokens` : 'No exclusion to ask again')}</p>`,
    submit: (form, d) => (d.querySelector('[type=submit]').disabled ? undefined : true),
    onMount: (d, close, preview) => {
      preview.revise({ items: records.length ? { n: records.length, noun: 'excluded record' } : null, tokens: records.length ? { inTokens: tokens, outTokens: null } : null });
      d.querySelector('[type=submit]').disabled = !records.length;
    } });
  if (!go) return;
  const engine = (rs, rules2, onEach, stop) => (jev ? screenMany(rs, rules2, jev, { stage, stop, skipDecided: false, onEach }) : assessMany(rs, rules2, text, { stop, onEach }));
  runJob('screen', `Re-screen for scenario, ${stageLabel}`, async h => {
    h.count(0, records.length);
    const out = await sweepScenario({ scenario, stage, model, onProgress: (n, t) => h.count(n, t), engine: (rs, rules2, onEach) => engine(rs, rules2, onEach, () => h.stopped()) });
    return `${sweepFlagged(get(), stage, scenario).length} of ${out.scope.length} no longer excluded`;
  }, { stage }).then(() => {
    const sw = sweepOf(get(), stage, scenario), all = Object.keys(sw?.results || {}).length;
    return `${plural(all, 'record')} read again under this scenario's criteria. Re-screen results lists them`;
  }, err => `Re-screen stopped: ${String(err?.message || err).slice(0, 120)}`)
    .then(onChange);
  onChange();
}

/**
 * Asks which rule to leave out, then runs the sweep as a job. `stage` and `stageLabel` name the stage; `rules` are the rules asked at it;
 * `decisionOf(id)` is the reviewer's decision; `jev` / `text` are the models that can assess (either may be null); `onChange(message)`
 * repaints, with what the sweep found or why it did not run as the page's message. Resolves when the dialog closes (the job runs on).
 */
export async function rescreenExcludedDialog({ stage, stageLabel, rules, decisionOf, jev = null, text = null, onChange = () => {}, scenario = null }) {
  if (scenario) return scenarioSweepDialog({ scenario, stage, stageLabel, jev, text, onChange });
  const s = get(), papers = s.papers || [];
  const choices = rules.filter(r => r.kind !== 'group');
  if (!choices.length) { onChange('Nothing to re-screen: add eligibility criteria in the protocol first'); return; }
  if (!jev && !text) { onChange('Nothing to re-screen: choose a decision or screening model in Settings'); return; }
  const model = jev ? jev.model : text.model;
  const sweep = sweepOf(s, stage), first = mostCitedRule(papers, decisionOf, choices) || choices[0].id;
  const ruleSelect = `<select name="rule" data-rule>${choices.map(r => `<option value="${esc(r.id)}"${r.id === first ? ' selected' : ''}>${esc(`${r.id}: ${String(r.text || r.question || '').slice(0, 90)}`)}</option>`).join('')}</select>`;
  // one rule and Re-screen (DIALOGS §3, tier S): the line under the field says what the sweep would read and cost
  const pick = await runPreview({ id: 'rescreen', tier: 'S', title: 'Re-screen excluded', detail: sweep ? `${stageLabel}, replaces the re-screen without ${sweep.rule}` : stageLabel, confirm: 'Re-screen',
    cfgs: [jev || text], classes: promptSends(SCREEN_ASSESS),
    body: `${formField('Leave out', ruleSelect)}<p class="meta" data-line role="status"></p>`,
    submit: (form, d) => (d.querySelector('[type=submit]').disabled ? undefined : form.elements.rule.value),
    onMount: (d, close, preview) => {
      const sel = d.querySelector('[data-rule]'), line = d.querySelector('[data-line]'), ok = d.querySelector('[type=submit]');
      const refresh = () => {
        const scope = sweepScope(papers, decisionOf, sel.value);
        const tokens = scope.reduce((a, p) => a + estimateTokens(`${p.title} ${p.abstract || ''} ${rules.map(c => c.question || c.text).join(' ')}`), 0);
        preview.revise({ items: scope.length ? { n: scope.length, noun: 'excluded record' } : null, tokens: scope.length ? { inTokens: tokens * (jev ? 3 : 1), outTokens: null } : null });
        line.textContent = scope.length ? `${plural(scope.length, 'excluded record')} to read again, ${model}, ~${num(tokens * (jev ? 3 : 1))} tokens${jev ? ', three cross-check passes' : ''}` : 'No excluded record names this rule';
        ok.disabled = !scope.length;
      };
      sel.onchange = refresh; refresh();
    } });
  if (!pick) return;
  const ruleId = pick, rule = choices.find(r => r.id === ruleId);
  const engine = async (records, rs, onEach, stop) => {
    if (jev) return screenMany(records, rs, jev, { stage, stop, skipDecided: false, onEach });
    return assessMany(records, rs, text, { stop, onEach });
  };
  const total = sweepScope(papers, decisionOf, ruleId).length;
  runJob('screen', `Re-screen without ${ruleId}, ${stageLabel}`, async h => {
    h.count(0, total);
    const out = await rescreenExcluded({ papers, decisionOf, rules, ruleId, onProgress: (n, t) => h.count(n, t),
      engine: (records, rs, onEach) => engine(records, rs, onEach, () => h.stopped()) });
    commitSweep(stage, { ruleId, ruleText: String(rule?.text || ''), model, scope: out.scope, results: out.results });
    return `${sweepFlagged(get(), stage).length} of ${out.scope.length} no longer excluded`;
  }, { stage }).then(() => {
    const n = sweepFlagged(get(), stage).length, all = Object.keys(sweepOf(get(), stage)?.results || {}).length;
    return `${n ? `${plural(n, 'record')} would no longer be excluded` : 'Every exclusion stands'} without ${ruleId}, of ${plural(all, 'record')} read again${n ? '. Filter › Re-screen results lists them' : ''}`;
  }, err => `Re-screen stopped: ${String(err?.message || err).slice(0, 120)}`)
    .then(onChange);
  onChange();
}

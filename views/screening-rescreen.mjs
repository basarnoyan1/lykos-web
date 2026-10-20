// Screening › Re-screen excluded: a false-negative sweep. The records excluded at a stage are assessed again with one rule left out;
// a record that would no longer be excluded is listed for a second look. The answers are proposals, kept apart from the review's own
// (lib/screening-checks.mjs); nothing is decided here.
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { num, plural } from '../lib/dates.mjs';
import { estimateTokens } from '../lib/assist.mjs';
import { assessMany } from '../lib/helpers.mjs';
import { runPreview, promptSends } from '../lib/run-preview.mjs';
import { SCREEN_ASSESS } from '../lib/prompts.mjs';
import { formField } from '../lib/ui-components.mjs';
import { screenMany } from '../lib/jev.mjs';
import { run as runJob } from '../lib/jobs.mjs';
import { sweepScope, mostCitedRule, rescreenExcluded, commitSweep, sweepOf, sweepFlagged } from '../lib/screening-checks.mjs';

/**
 * Asks which rule to leave out, then runs the sweep as a job. `stage` and `stageLabel` name the stage; `rules` are the rules asked at it;
 * `decisionOf(id)` is the reviewer's decision; `jev` / `text` are the models that can assess (either may be null); `onChange(message)`
 * repaints, with what the sweep found or why it did not run as the page's message. Resolves when the dialog closes (the job runs on).
 */
export async function rescreenExcludedDialog({ stage, stageLabel, rules, decisionOf, jev = null, text = null, onChange = () => {} }) {
  const s = get(), papers = s.papers || [];
  const choices = rules.filter(r => r.kind !== 'group');
  if (!choices.length) { onChange('Nothing to re-screen: add eligibility criteria in the protocol first'); return; }
  if (!jev && !text) { onChange('Nothing to re-screen: choose a decision or screening model in Settings'); return; }
  const model = jev ? jev.model : text.model;
  const sweep = sweepOf(s, stage), first = mostCitedRule(papers, decisionOf, choices) || choices[0].id;
  const ruleSelect = `<select name="rule" data-rule>${choices.map(r => `<option value="${esc(r.id)}"${r.id === first ? ' selected' : ''}>${esc(`${r.id} · ${String(r.text || r.question || '').slice(0, 90)}`)}</option>`).join('')}</select>`;
  // one rule and Re-screen (DIALOGS §3, tier S): the line under the field says what the sweep would read and cost
  const pick = await runPreview({ id: 'rescreen', tier: 'S', title: 'Re-screen excluded', detail: sweep ? `${stageLabel} · replaces the re-screen without ${sweep.rule}` : stageLabel, confirm: 'Re-screen',
    cfgs: [jev || text], classes: promptSends(SCREEN_ASSESS),
    body: `${formField('Leave out', ruleSelect)}<p class="meta" data-line role="status"></p>`,
    submit: (form, d) => (d.querySelector('[type=submit]').disabled ? undefined : form.elements.rule.value),
    onMount: (d, close, preview) => {
      const sel = d.querySelector('[data-rule]'), line = d.querySelector('[data-line]'), ok = d.querySelector('[type=submit]');
      const refresh = () => {
        const scope = sweepScope(papers, decisionOf, sel.value);
        const tokens = scope.reduce((a, p) => a + estimateTokens(`${p.title} ${p.abstract || ''} ${rules.map(c => c.question || c.text).join(' ')}`), 0);
        preview.revise({ items: scope.length ? { n: scope.length, noun: 'excluded record' } : null, tokens: scope.length ? { inTokens: tokens * (jev ? 3 : 1), outTokens: null } : null });
        line.textContent = scope.length ? `${plural(scope.length, 'excluded record')} to read again · ${model} · ~${num(tokens * (jev ? 3 : 1))} tokens${jev ? ' · three cross-check passes' : ''}` : 'No excluded record names this rule';
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
  runJob('screen', `Re-screen without ${ruleId} · ${stageLabel}`, async h => {
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

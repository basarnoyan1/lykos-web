import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the overview view (lib/aid.mjs).
//
// Both actions read the same material the overview shows: the unresolved
// list and the funnel from lib/progress.mjs, the to-do list, and the brief.
// Nothing is computed by the model. A number it writes must be one of the
// numbers in that material, checked here; a step or a summary stating any
// other number is not offered.
import { withoutLabels } from '../lib/numbers.mjs';
import { register, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { unresolved, funnel } from '../lib/progress.mjs';
import '../lib/changes.mjs';   // the add_task op and its payload handler
import { applyProposalPayload } from '../lib/proposal-handlers.mjs';
import { cleanSuggestion, suggestionState, suggestionDetail, addSuggested } from '../lib/task-suggest.mjs';
import { results as allResults } from '../lib/results.mjs';
import { unsupported } from '../lib/numbers.mjs';
import { update } from '../store.mjs';

/** The project's state as the overview shows it, as prompt text. */
export function standing(s) {
  const open = unresolved(s);
  const todos = (s.todos || []).filter(t => !t.done);
  const res = allResults(s).filter(r => !/\.method$/.test(r.key)).slice(0, 20);
  // The pooled effect as stored by the analysis view (`estimate`), which
  // results.mjs does not list under that name; two places, as it displays.
  const a = s.analysis, f = v => (Number.isFinite(Number(v)) ? Number(v).toFixed(2).replace(/\.?0+$/, '') : '?');
  return [
    `Searches: ${(s.searches || []).map(r => `${r.source || 'PubMed'} "${r.query}" → ${r.total ?? '?'}`).join('; ') || 'none recorded'}`,
    `PRISMA counts: ${Object.entries(s.prisma || {}).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}`,
    a?.estimate != null ? `Pooled ${a.measure || 'effect'} (${a.method || ''}, k = ${a.k ?? '?'}): ${f(a.estimate)} (95% CI ${f(a.lo)} to ${f(a.hi)})` : '',
    `Funnel:\n${funnel(s).map(f => `  ${f.name}: ${f.n ?? '—'}${f.pool != null ? ` of ${f.pool}` : ''}${f.line ? ` (${f.line})` : ''}`).join('\n')}`,
    `Unresolved:\n${open.length ? open.map(u => `  ${u.severity === 'block' ? '[blocks] ' : ''}${u.text}`).join('\n') : '  none'}`,
    `Open to-dos:\n${todos.length ? todos.slice(0, 20).map(t => `  ${t.text}${t.due ? ` (due ${t.due})` : ''}`).join('\n') : '  none'}`,
    res.length ? `Saved results:\n${res.map(r => `  ${r.label}: ${r.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * Numbers in a text that the project facts do not contain, each once. The
 * facts are the standing and the item in focus, never the brief or the
 * instructions, whose numbers ("at most 6 steps") would vouch for an
 * invented one.
 */
export function strayNumbers(text, facts) {
  return [...new Set(unsupported(text, facts))];
}

export { withoutLabels } from '../lib/numbers.mjs';

/** The facts a proposal's numbers must come from: the standing and the item in focus. */
const factsOf = (material, context) => [material, context?.focus?.label, context?.focus?.detail].filter(Boolean).join('\n');

const proposeStanding = durableAction('standing-note', ({ text, model }) => {
  // A project note: the same shape as a reader note, with no record
  // or page, and marked as the model's so it is not taken for the
  // author's own words.
  update(s => {
    s.notes = [...(s.notes || []), { id: `n${Date.now().toString(36)}`, paper: null, kind: 'comment', text,
      page: null, rects: null, origin: 'model', extractor: `model:${model || ''}`, at: new Date().toISOString() }];
    return s;
});
return 'Added to notes';
});

// Proposals saved by an older build ("Next steps", rows "1. …", Add to do): they read and apply as suggested tasks.
durableAction('todo', ({ text }) => addSuggested({ text }, { source: 'plan' }),
  ({ text }, state) => ({ label: text, detail: '', acceptLabel: 'Add', live: true, ...(suggestionState(text, state) ? { stale: suggestionState(text, state) } : {}) }));

/** A suggested task as a proposal item: the add_task change, so it reads, dedupes, notes its source and undoes as every suggestion does. */
export function suggestionItem(x, { model = '', source = 'plan' } = {}) {
  const change = { op: 'add_task', text: x.text, ...(x.due ? { due: x.due } : {}), ...(x.priority && x.priority !== 'none' ? { priority: x.priority } : {}), ...(x.link ? { link: x.link } : {}), ...(x.why ? { why: x.why } : {}) };
  const payload = { kind: 'change', change, model, source };
  return { label: x.text, detail: suggestionDetail(x), acceptLabel: 'Add', op: 'add_task', payload, accept: ctx => applyProposalPayload(payload, ctx) };
}

register('overview', [
  {
    id: 'plan-next',
    label: 'Plan the next steps',
    icon: 'run',
    task: 'tasks',
    async run({ state, cfg, signal, brief, context }) {
      const material = standing(state);
      const out = await complete(cfg, P.messagesOf(P.overviewPlanNext, { brief, material }), { prompt: P.overviewPlanNext, signal, temperature: 0, json: true });
      // Not offered again: what an open task already says, and what a person dismissed before.
      const steps = (jsonOf(out).steps || []).filter(x => x?.text && String(x.text).trim())
        .map(x => cleanSuggestion({ text: String(x.text).trim().slice(0, 200), why: String(x.why || '').trim().slice(0, 160) }))
        .filter(x => !x.error && !suggestionState(x.text, state));
      const ok = steps.filter(x => !strayNumbers(withoutLabels(`${x.text} ${x.why}`, state.papers), factsOf(material, context)).length).slice(0, 6);
      const dropped = steps.length - ok.length;
      return {
        title: 'Suggested tasks',
        prompt: promptRef(P.overviewPlanNext),
        note: dropped > 0 ? `${dropped} ${dropped === 1 ? 'step' : 'steps'} with a number not in the project left out` : '',
        items: ok.map(x => suggestionItem(x, { model: cfg.model, source: 'plan' })),
      };
    },
  },
  {
    id: 'summarise-standing',
    label: 'Summarise where it stands',
    icon: 'file',
    task: 'assist',
    async run({ state, cfg, signal, brief, context }) {
      const material = standing(state);
      const out = await complete(cfg, P.messagesOf(P.overviewSummariseStanding, { brief, material }), { prompt: P.overviewSummariseStanding, signal, temperature: 0 });
      const prompt = promptRef(P.overviewSummariseStanding);
      const text = out.trim();
      if (!text) return { title: 'Where it stands', note: 'No summary returned', items: [], prompt };
      const stray = strayNumbers(withoutLabels(text, state.papers), factsOf(material, context));
      return {
        title: 'Where it stands',
        prompt,
        items: [{
          label: text,
          detail: stray.length ? `Not in the project: ${stray.join(', ')}` : '',
          acceptLabel: 'Add to notes',
          ...(stray.length ? { accept: null } : proposeStanding({ text, model: cfg.model })),
        }],
      };
    },
  },
]);

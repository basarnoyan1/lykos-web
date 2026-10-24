import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the screening view (lib/aid.mjs).
//
// Every action here works on the record on screen for a decision, and none
// of them decides it (plan §1.3: no model-driven exclusion). The most any
// accept() does is place a proposal beside the record, the same proposal the
// view's own "All" assessment stores; the decision stays with the keyboard.
import { register, jsonOf, quoteIn } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { update } from '../store.mjs';
import { stageOf } from '../lib/screen.mjs';
import { unsupported } from '../lib/numbers.mjs';

const MET = { yes: 'met', no: 'not met', unclear: 'unclear' };
const PICO = ['population', 'intervention', 'comparator', 'outcome', 'design'];
const cap = t => String(t).charAt(0).toUpperCase() + String(t).slice(1);

const recordOf = (s, f) => (f?.kind === 'record' && f.paperId ? (s.papers || []).find(p => p.id === f.paperId) : null) || null;
// The rules the view shows for a stage: full-text criteria wait for full text.
const rulesFor = (s, stage) => (s.protocol?.criteria || []).filter(c => c.text && (stage === 'ft' || c.stage !== 'Full text'));
// What a screener sees of a record, and so all a quote may come from.
const sourceOf = p => `${p.title || ''}\n${p.abstract || ''}`;
// Every number a line states must be in the record: a model restates, it does not compute.
const numbersFrom = (line, source) => !unsupported(line, source).length;
const NO_ANSWER = 'No answer from the model';

/**
 * The verdict placed beside the record rests only on the criteria whose
 * evidence survived the quote check: any rule not met proposes exclusion,
 * every rule met proposes inclusion, anything else is uncertain. Deriving it
 * here, rather than taking the model's word, keeps a dropped claim from
 * steering the proposal.
 */
export function verdictOf(kept, rules) {
  if (kept.some(c => c.met === 'no')) return 'exclude';
  if (rules.length && rules.every(r => kept.some(c => c.id === r.id && c.met === 'yes'))) return 'include';
  return 'uncertain';
}

/**
 * Criterion checks the record supports: a met or not-met claim must quote the
 * record. A criterion the reply leaves out is returned as not assessed, so it
 * is named rather than silently missing.
 */
export function keepChecks(got, rules, source) {
  const ids = new Set(rules.map(r => r.id));
  const kept = [], dropped = [];
  const seen = new Set();
  for (const c of got || []) {
    const id = String(c?.id || ''); if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    const met = ['yes', 'no', 'unclear'].includes(c.met) ? c.met : 'unclear';
    const quote = String(c.quote || '').trim().slice(0, 400);
    if (quote && !quoteIn(quote, source)) { dropped.push(id); continue; }
    if (met !== 'unclear' && !quote) { dropped.push(id); continue; }
    kept.push({ id, met, note: String(c.note || '').slice(0, 120), quote });
  }
  return { kept, dropped, skipped: rules.map(r => r.id).filter(id => !seen.has(id)) };
}

const proposeScreening = durableAction('screening', ({ stage, paperId, verdict, criteria, model }) => {
  update(st => {
    st.proposals = st.proposals || {}; st.proposals[stage] = st.proposals[stage] || {};
    st.proposals[stage][paperId] = { verdict, criteria: criteria, model: model, at: new Date().toISOString() };
    return st;
});
return 'Shown beside record';
});

register('screening', [
  {
    id: 'check-criteria',
    label: 'Check against criteria',
    icon: 'screening',
    task: 'screen',
    when: (s, ctx) => { const p = recordOf(s, ctx?.focus); return Boolean(p && rulesFor(s, ctx.focus.stage).length); },
    // The record and the criteria are both in the request below.
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, brief }) {
      const p = recordOf(state, focus);
      const stage = focus.stage || 'ta';
      const rules = rulesFor(state, stage);
      const out = await complete(cfg, P.messagesOf(P.screeningCheck, { brief, stage: stageOf(stage).label, criteria: rules,
        record: `Title: ${p.title || ''}\nAbstract: ${(p.abstract || '').slice(0, 4000) || '(none)'}` }),
      { prompt: P.screeningCheck, signal, temperature: 0, maxTokens: 300 + 140 * rules.length, json: true });
      const reply = jsonOf(out).criteria;
      const { kept, dropped, skipped } = keepChecks(reply, rules, sourceOf(p));
      const byId = new Map(rules.map(r => [r.id, r]));
      const verdict = verdictOf(kept, rules);
      const items = kept.map(c => ({
        label: `${c.id} ${MET[c.met]}`,
        detail: [byId.get(c.id).text, c.note].filter(Boolean).join('\n'),
        quote: c.quote || undefined,
      })).concat(skipped.map(id => ({ label: `${id} not assessed`, detail: byId.get(id).text })));
      if (kept.length) items.unshift({
        label: `${cap(verdict)}: ${p.label}`,
        detail: [...kept.map(c => `${c.id} ${MET[c.met]}`), ...skipped.map(id => `${id} not assessed`)].join(', '),
        acceptLabel: 'Show beside record',
        // Stored exactly as the view's own assessment stores a proposal, so
        // the record's header shows it; no decision is written.
        ...proposeScreening({ stage, paperId: p.id, verdict, criteria: kept.map(({ id, met, note }) => ({ id, met, note })), model: cfg.model }),
      });
      return {
        title: `${p.label} against criteria`,
        prompt: promptRef(P.screeningCheck),
        note: [!Array.isArray(reply) || !reply.length ? NO_ANSWER : '', dropped.length && `${dropped.join(', ')} dropped: quote not in record`].filter(Boolean).join('; '),
        items,
      };
    },
  },
  {
    id: 'summarise-record',
    label: 'Summarise in two lines',
    icon: 'sparkle',
    task: 'assist',
    when: (s, ctx) => Boolean(recordOf(s, ctx?.focus)?.abstract),
    brief: { record: false },
    async run({ state, cfg, signal, focus, brief }) {
      const p = recordOf(state, focus);
      const source = sourceOf(p);
      const out = await complete(cfg, P.messagesOf(P.screeningSummarise, { brief, record: `Title: ${p.title || ''}\nAbstract: ${p.abstract.slice(0, 4000)}` }),
        { prompt: P.screeningSummarise, signal, temperature: 0, json: true });
      const reply = jsonOf(out).lines;
      const lines = (Array.isArray(reply) ? reply : []).slice(0, 2);
      const kept = lines.filter(l => l?.text && quoteIn(l.quote, source) && numbersFrom(l.text, source));
      return {
        title: `${p.label} in two lines`,
        prompt: promptRef(P.screeningSummarise),
        note: !lines.length ? NO_ANSWER : kept.length < lines.length ? `${lines.length - kept.length} dropped: not in record` : '',
        items: kept.map(l => ({ label: String(l.text).trim().slice(0, 240), quote: String(l.quote).trim() })),
      };
    },
  },
  {
    id: 'mark-pico',
    label: 'Mark PICO in abstract',
    icon: 'sparkle',
    task: 'screen',
    when: (s, ctx) => Boolean(recordOf(s, ctx?.focus)?.abstract),
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, focus, brief }) {
      const p = recordOf(state, focus);
      const source = sourceOf(p);
      const out = await complete(cfg, P.messagesOf(P.screeningPico, { brief, record: `Title: ${p.title || ''}\nAbstract: ${p.abstract.slice(0, 4000)}` }),
        { prompt: P.screeningPico, signal, temperature: 0, json: true });
      const reply = jsonOf(out).spans;
      const spans = (Array.isArray(reply) ? reply : []).filter(x => PICO.includes(x?.element));
      const kept = spans.filter(x => quoteIn(x.quote, source))
        .sort((a, b) => PICO.indexOf(a.element) - PICO.indexOf(b.element));
      return {
        title: `PICO in ${p.label}`,
        prompt: promptRef(P.screeningPico),
        note: !Array.isArray(reply) ? NO_ANSWER : kept.length < spans.length ? `${spans.length - kept.length} dropped: quote not in record` : '',
        items: kept.map(x => ({ label: cap(x.element), quote: String(x.quote).trim().slice(0, 400) })),
      };
    },
  },
]);

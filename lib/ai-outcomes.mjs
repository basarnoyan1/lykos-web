// What people did with model output: accepted, discarded, or accepted after
// editing. Kept as counters by kind plus a bounded log, so the AI-use record
// (lib/ai-use.mjs) can say how many proposals a person confirmed or overrode
// without reading every proposal again. A kind is the action that produced the
// output ("screening.check-criteria", "extraction.read-abstract", "cell",
// "chat.screen"); nothing here changes the project's science.
import { update } from '../store.mjs';

export const OUTCOMES = ['accepted', 'discarded', 'edited'];
const LOG_MAX = 2000;

export function recordOutcome({ kind, outcome, model = '', prompt = '', paper = '' }) {
  if (!kind || !OUTCOMES.includes(outcome)) return;
  const at = new Date().toISOString();
  update(s => {
    const o = s.aiOutcomes && typeof s.aiOutcomes === 'object' ? s.aiOutcomes : (s.aiOutcomes = { byKind: {}, log: [] });
    o.byKind ||= {}; o.log ||= [];
    const k = o.byKind[kind] ||= { accepted: 0, discarded: 0, edited: 0 };
    k[outcome]++;
    o.log = [{ at, kind, outcome, model: String(model).slice(0, 120), prompt: String(prompt).slice(0, 120), ...(paper ? { paper } : {}) }, ...o.log].slice(0, LOG_MAX);
    return s;
  });
}

/** Totals over every kind, or over the kinds whose name starts with `prefix`. */
export function outcomeTotals(state, prefix = '') {
  const t = { accepted: 0, discarded: 0, edited: 0 };
  for (const [kind, k] of Object.entries(state.aiOutcomes?.byKind || {})) if (kind.startsWith(prefix)) for (const o of OUTCOMES) t[o] += k[o] || 0;
  return t;
}

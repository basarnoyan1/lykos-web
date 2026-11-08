// One status per extracted value, read the same way by the value audit (lykos verify audit, lib/value-accuracy.mjs), the proof kernel
// (lykos verify proof, lib/proof/kernel.mjs) and the app (31 Oct 2026). Before, the audit said every value of the sham review was settled
// while the kernel said 732 were in error: the audit counts what a reviewer recorded (a quote found once, a decision), the kernel what it
// can prove from the trial's sources now. Both are true and they answer different questions, so the status shown is the kernel's, and the
// reviewer's record is said beside it: "settled by a reviewer, not proven by the checker" is a value to read, not a settled one.

/** The kernel's statuses, worst first, each with its label and a plain explanation (at most 24 words). */
export const STATUSES = ['error', 'conflict', 'unproven', 'interpretation', 'axiom', 'proven'];
export const STATUS = {
  proven: { label: 'Proven from the sources', plain: "Every number is in the trial's own reports or registry record, next to what it measures." },
  interpretation: { label: 'Proven on a reading', plain: 'Proven if the paper is read one way (a unit, a time point, a denominator); the reading is listed.' },
  axiom: { label: 'Rests on a decision', plain: 'A reviewer decided it with a recorded reason (a convention, a judgement, a value kept); the decision is listed, not re-proved.' },
  unproven: { label: 'Not proven', plain: 'No passage of the sources and no recorded decision proves it yet: it needs a quote, a derivation or a decision.' },
  conflict: { label: 'Contradicted by the paper', plain: 'The paper gives this differently in two places; a person decides which holds.' },
  error: { label: 'In error', plain: 'Something is wrong: its quote is not in the sources or is another work\'s words, a number is impossible, or its arithmetic fails.' },
  stale: { label: 'Not checked since it changed', plain: 'The value changed after the last proof check; run the check again.' },
  none: { label: 'Not checked', plain: 'The proof checker has not read this value yet.' },
};

/** What a reviewer recorded for a value, in a few words: "settled: kept", "quote found", "" when nothing. */
export function recordOf(field, value) {
  if (!field || field.recorded !== value) return '';
  const st = field.settled;
  if (st) return st.decision === 'confirmed' ? 'settled with a quote' : st.decision === 'derived' ? 'settled by a derivation' : st.decision === 'figure' ? 'settled as a figure read' : st.decision === 'not-in-paper' ? 'settled as not in the paper' : `settled: ${st.decision}`;
  if (field.verdict === 'agree') return field.quote && field.found !== false ? 'agreed with a quote' : 'agreed, no quote found';
  return field.verdict ? `checked: ${field.verdict}` : '';
}

/**
 * The status of one value: the kernel's entry (state.json's studies[id].values[key]: { value, status, findings, proof }) when it is of this
 * value, else 'stale' or 'none'; with the reviewer's record. Answers { key, label, plain, record, findings: [text], premises: [text] }.
 */
export function reconcile(entry, field, value) {
  const v = String(value ?? '');
  const key = !entry ? 'none' : String(entry.value ?? '') !== v ? 'stale' : STATUS[entry.status] ? entry.status : 'none';
  const record = recordOf(field, v);
  const findings = key === entry?.status ? (entry.findings || []).filter(f => f.level !== 'warn').map(f => `${f.text}${f.at ? ` (${[f.at.source, f.at.page ? `p. ${f.at.page}` : ''].filter(Boolean).join(', ')})` : ''}`) : [];
  const premises = key === entry?.status ? (entry.proof || []).filter(c => c.ok).map(c => `${c.claim?.text || ''}: ${c.rule}${c.axiom ? ` (${c.axiom.slice(0, 120)})` : ''}${(c.premises || []).filter(p => p.page || p.source).slice(0, 1).map(p => ` — ${[p.source, p.page ? `p. ${p.page}` : ''].filter(Boolean).join(', ')}`).join('')}`) : [];
  // a reviewer's settlement the kernel cannot prove is said as such: it is not a settled value
  const label = key === 'unproven' && /^settled/.test(record) ? 'Settled by a reviewer, not proven' : key === 'error' && /^settled/.test(record) ? 'Settled by a reviewer, in error' : STATUS[key].label;
  return { key, label, plain: STATUS[key].plain, record, findings, premises };
}

/** Counts of a kernel state's statuses: { proven, interpretation, axiom, unproven, conflict, error } from its totals. */
export const countsOf = totals => Object.fromEntries(STATUSES.map(k => [k, totals?.byStatus?.[k] || 0]));

/** The one line every display gives (the card, the audit, the proof command): the kernel's counts in plain words. */
export function summaryLine(totals) {
  const n = countsOf(totals), all = totals?.values ?? STATUSES.reduce((a, k) => a + n[k], 0);
  return `${all} values: ${n.proven} proven from the sources, ${n.interpretation} proven on a reading, ${n.axiom} resting on a decision, ${n.unproven} not proven, ${n.conflict} contradicted by the paper, ${n.error} in error`;
}

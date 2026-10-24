// A project's own acceptance checks (plan §4.15g, item 10): each is a result key (lib/results.mjs: a Syntheses value, a pooled estimate, a PRISMA
// count) and the text it must read. They are kept in the project (s.synthesis.checks), run each time the Syntheses page is drawn and after
// Overview's Rebuild changed, and a check that no longer holds is listed with what it reads now. Nothing is changed by a failing check.
import { results } from './results.mjs';

export const checksOf = s => s?.synthesis?.checks || [];

/** Every check with what its key reads now: [{ key, expect, label, got, pass }]. */
export function runChecks(s) {
  const now = new Map(results(s).map(r => [r.key, r.text]));
  return checksOf(s).map(c => ({ ...c, got: now.get(c.key) ?? null, pass: now.get(c.key) === c.expect }));
}

/** The values of one Syntheses combination as checks, each expecting what it reads now (Keep as checks). */
export function checksNow(s, code, outcomeId) {
  const p = `synth.${String(code).toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${outcomeId}.`;
  return results(s).filter(r => r.key.startsWith(p)).map(r => ({ key: r.key, expect: r.text, label: `${r.group}: ${r.label}` }));
}

/** `checks` added to the project's, a key already kept replaced by the new one. */
export function withChecks(s, checks) {
  const keys = new Set(checks.map(c => c.key));
  return [...checksOf(s).filter(c => !keys.has(c.key)), ...checks];
}

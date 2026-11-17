// A project's own acceptance checks (plan §4.15g, item 10): each is a result key (lib/results.mjs: a Syntheses value, a pooled estimate, a PRISMA
// count) and the text it must read. They are kept in the project (s.synthesis.checks), run each time the Syntheses page is drawn and after
// Overview's Rebuild changed, and a check that no longer holds is listed with what it reads now. Nothing is changed by a failing check.
import { results } from './results.mjs';

export const checksOf = s => s?.synthesis?.checks || [];

/** Every check with what its key reads now: [{ key, expect, label, got, pass }]. */
export function runChecks(s) {
  // the results registry is read only for a project that keeps checks (the Syntheses title bar asks on every draw)
  if (!checksOf(s).length) return [];
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

/**
 * The checks after a deliberate data change: those picked (every failing one, unless `pick` takes a check) expect what they read now.
 * Answers { checks, changed: [{ key, was, now }], gone: [keys that read nothing now, left as they are] } (lykos-checks keep and
 * Syntheses › Keep failing checks).
 */
export function checksKeptAgain(s, pick = c => !c.pass) {
  const ran = runChecks(s).filter(pick), changed = [], gone = [];
  for (const c of ran) { if (c.got == null) gone.push(c.key); else if (c.got !== c.expect) changed.push({ key: c.key, was: c.expect, now: c.got }); }
  const by = new Map(changed.map(c => [c.key, c.now]));
  return { checks: checksOf(s).map(c => (by.has(c.key) ? { ...c, expect: by.get(c.key) } : c)), changed, gone };
}

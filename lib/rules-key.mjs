// Which version of the screening rules a proposal was made under. The rules
// were stored whole on every proposal (12.6 KB each, 461 identical copies in
// the review's project) and whole again in every run's snapshot of the
// proposals it replaced — 50 MB of a project whose records are 2 MB. The only
// question ever asked of them is "are these the rules now in force?", so a
// proposal keeps a fingerprint and a run keeps one full copy for the record.
// A stored value may still be the old JSON text; both compare the same way.

// FNV-1a over the text, twice with different offsets: 16 hex digits.
function fnv(text, h) {
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const hash = text => `rk:${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}`;

/** The fingerprint of rules given as the rule list, its JSON text, or a fingerprint already. */
export function rulesKey(rules) {
  if (typeof rules === 'string') return rules.startsWith('rk:') ? rules : hash(rules);
  return hash(JSON.stringify(rules || []));
}
/** Whether two stored or current rule sets are the same rules. */
export const sameRules = (a, b) => rulesKey(a) === rulesKey(b);

/**
 * Shrinks what an older project carried: proposals keep a fingerprint, runs
 * keep one copy of their rules, and only the latest run and the latest batch
 * keep the snapshot they replaced. Returns the state, changed in place.
 */
export function compactScreening(s) {
  const fp = p => { if (p && typeof p.rulesSnapshot === 'string' && !p.rulesSnapshot.startsWith('rk:')) p.rulesSnapshot = rulesKey(p.rulesSnapshot); };
  const eachProposal = (map, fn) => { for (const stage of Object.values(map || {})) if (stage && typeof stage === 'object') for (const p of Object.values(stage)) { fn(p); fn(p?.jev); } };
  eachProposal(s.proposals, fp);
  const runs = s.jevRuns || [];
  runs.forEach((r, i) => {
    if (typeof r.rulesSnapshot === 'string' && !r.rulesSnapshot.startsWith('rk:')) { r.rules = r.rules || r.rulesSnapshot; r.rulesSnapshot = rulesKey(r.rulesSnapshot); }
    if (i < runs.length - 1) delete r.before;
    else if (r.before) for (const p of Object.values(r.before)) { fp(p); fp(p?.jev); }
  });
  const batches = s.screeningBatches || [];
  batches.forEach((b, i) => { if (i < batches.length - 1) delete b.before; });
  return s;
}

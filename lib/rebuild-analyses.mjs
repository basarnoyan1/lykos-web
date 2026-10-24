// The inclusion cascade's rebuild (plan §4.15g, item 1, approved 21 October 2026): every saved analysis whose inputs changed since it ran (the included
// studies, a cell, a phrase an outcome reads) is run again from the table, with the settings it was run with. A pooled proportion is pooled in
// JavaScript where that gives metafor's numbers (lib/meta-pool.mjs); a comparison between arms runs as Analysis runs it; anything else is listed for
// Analysis. Results are saved with the Q-based I² (lib/i2-q.mjs). Nothing is deleted: a result that cannot be rebuilt stays, marked changed.
import { outcomes, analysisOf, PRIMARY } from './outcomes.mjs';
import { pooledInputs, pooledInputStatus } from './analysis-inputs.mjs';
import { handlesProportion, poolProportion } from './meta-pool.mjs';
import { isContrast } from './contrast-counts.mjs';
import { saveAnalysis } from './i2-q.mjs';

/** The saved analyses whose inputs changed: [{ id, name, kind: 'proportion' | 'contrast' | 'other' }], hidden outcomes left out. */
export function changedAnalyses(s) {
  const out = [];
  for (const o of outcomes(s)) {
    const a = analysisOf(s, o.id);
    if (!a || o.hidden) continue;
    const status = pooledInputStatus(s, a, o.id);
    if (status !== 'stale' && status !== 'untracked') continue;
    const d = (s.outcomes || []).find(x => x.id === o.id)?.derived;
    out.push({ id: o.id, name: o.name, kind: isContrast(d) ? 'contrast' : d && a.derived ? 'proportion' : 'other' });
  }
  return out;
}

/** A pooled proportion run again with its own settings (model, transformation, subgroup): the result, or null where JavaScript does not give metafor's numbers. */
export function rebuildProportion(s, oid) {
  const a = analysisOf(s, oid), d = (s.outcomes || []).find(x => x.id === oid)?.derived, mod = a.moderator || '';
  const inputs = pooledInputs(s, mod, 'PR', oid), transform = a.measure === 'PFT' ? 'PFT' : 'PLO', method = a.method || 'REML';
  const rows = inputs.ready.map(u => ({ label: u.label, study: u.paperId, events: u.events, n: u.n, level: u.subgroup }));
  const order = [...new Set((d?.subgroup?.levels || []).map(([, l]) => String(l)))];
  if (!handlesProportion({ method, transform }, rows)) return null;
  const res = poolProportion(rows, { method, subgroups: !!mod, order, transform });
  if (!res) return null;
  return { ...res, measure: a.measure, method, derived: true, settings: a.settings, labels: rows.map(r => r.label), units: inputs.ready.map(u => u.id), sources: inputs.ready.map(u => u.key),
    levels: rows.map(r => (r.level == null ? null : String(r.level))), zeroEvents: a.zeroEvents, moderator: mod, moderatorLabel: a.moderatorLabel || '', inputSnapshot: inputs.snapshot,
    outcomeId: oid, outcomeName: a.outcomeName, engine: 'js', rebuilt: new Date().toISOString(), at: new Date().toISOString() };
}

/**
 * Runs every changed analysis again, then the project's checks: `{ rebuilt: [name], left: [{ id, name, reason }], failing: [check] }`. `store` is { get, update }; a comparison between arms is run by
 * `runOne` (runComparison in views/analysis-comparative.mjs), given so this file needs no page.
 */
export async function rebuildChanged({ get, update }, { runOne = null } = {}) {
  const rebuilt = [], left = [];
  for (const c of changedAnalyses(get())) {
    if (c.kind === 'proportion') {
      const res = rebuildProportion(get(), c.id);
      if (res) { update(st => saveAnalysis(st, c.id === PRIMARY ? PRIMARY : c.id, res)); rebuilt.push(c.name); }
      else left.push({ ...c, reason: 'Its model is fitted in R: run it in Analysis' });
    } else if (c.kind === 'contrast' && runOne) {
      const r = await runOne(c.id).catch(err => ({ ok: false, reason: err.message }));
      if (r?.ok === false) left.push({ ...c, reason: r.reason || 'Not run' }); else rebuilt.push(c.name);
    } else left.push({ ...c, reason: 'Run it in Analysis' });
  }
  // the project's own acceptance checks run after every rebuild (lib/synth-checks.mjs)
  const failing = (await import('./synth-checks.mjs')).runChecks(get()).filter(r => !r.pass);
  return { rebuilt, left, failing };
}

/** The Overview card's Rebuild changed: runs them all, then opens Syntheses when a check of the project no longer holds, else in Analysis the first one only R can fit, or redraws Overview. */
export async function fromOverview(ctx, pages) {
  const [{ get, update }, cmp] = await Promise.all([import('../store.mjs'), import('../views/analysis-comparative.mjs')]);
  const { left, failing } = await rebuildChanged({ get, update }, { runOne: cmp.runComparison });
  if (failing.length) { ctx.go('syntheses'); return; }
  if (left.length) { (await pages.analysis()).selectOutcome(left[0].id); ctx.go('analysis'); return; }
  ctx.rerender();
}

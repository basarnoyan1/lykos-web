// The proof chain of a manuscript's number (plan W9c 6; spec "Proven links", 2026-11-07): the run output it came from, the values that
// output reads (the first eight, each with its study and value), each value's proof as the checker found it (the kernel's state,
// .lykos/proofs/state.json.gz, in the words of lib/proof/reconcile.mjs) and the passage that proves it (its quote and page). A record
// number rests on the value ids the check found for it. Pure: the reader (views/manuscript-reader.mjs) reads the run and the checker's
// state when the number's card opens, and draws this.
import { outputValueIds } from './run-reads.mjs';
import { cellProof, valueKey } from './proof-state.mjs';

export const CHAIN_MAX = 8;

/**
 * The chain of the check row `ck`: { output: { id, title, level, text } | null, values: [{ key, pid, study, field, value, status, quote,
 * page }], total }, or null when the number rests on no value ids. `check` the structured check (its runs' value sets), `run` the recorded
 * run (its outputs' titles and texts), `s` the project, `proofs` the checker's state, `names` Map(field id -> label).
 */
export function proofChain(ck, { check = null, run = null, s = {}, proofs = null, names = new Map() } = {}) {
  const src = ck?.source || {};
  let output = null, ids = [];
  if (src.run && src.outputs?.length && check?.runs?.[src.run]) {
    const id = src.outputs[0], o = (run?.outputs || []).find(x => x.id === id);
    output = { id, title: o?.title || id, level: o?.level || '', text: o?.text || '' };
    ids = outputValueIds(check.runs[src.run], id);
  } else if (Array.isArray(src.valueIds)) ids = src.valueIds;
  if (!ids.length) return null;
  const labels = new Map((s.papers || []).map(p => [p.id, p.label || p.title || p.id]));
  const values = ids.slice(0, CHAIN_MAX).map(key => {
    const pid = key.slice(0, key.indexOf(':')), col = key.slice(pid.length + 1), [base, arm] = col.split('@'), vk = valueKey(col);
    const v = s.values?.[key], value = String(v?.reported_value ?? v?.normalized_value ?? '');
    const pr = cellProof(proofs, s, pid, col, value), field = s.valueChecks?.studies?.[pid]?.fields?.[vk];
    // the passage: the reviewer's settled quote and page, else the first premise of the checker's proof that names a page
    const premise = (proofs?.studies?.[pid]?.values?.[vk]?.proof || []).flatMap(c => c.premises || []).find(x => x?.page);
    return { key, pid, study: labels.get(pid) || pid, field: `${names.get(base) || base.slice(base.indexOf('.') + 1)}${arm ? `, ${arm.replace(/^arm/, 'arm ')}` : ''}`,
      value, status: pr ? pr.label : 'Not checked', quote: field?.settled?.quote || field?.quote || premise?.quote || '',
      page: Number(field?.settled?.page || field?.page || premise?.page) || 0 };
  });
  return { output, values, total: ids.length };
}

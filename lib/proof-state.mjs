// The proof checker's state in the app (31 Oct 2026): `.lykos/proofs/state.json.gz`, written by tools/lykos-proof.mjs (lykos verify proof,
// and after every change file applied), read once per change of the file and shown per value in the extraction details with the same words
// the command line uses (lib/proof/reconcile.mjs). Nothing is proved here: the app shows what the checker found, beside what was recorded.
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { lib_gzip$textOf as textOf } from "../boot.mjs";
import { reconcile } from './proof/reconcile.mjs';
import { checkFor } from './value-accuracy.mjs';

export const STATE_FILE = '.lykos/proofs/state.json.gz';
let cache = { key: '', state: null }, loading = null;
const waiting = new Set();

/** The state as last read, or null; looks at the file again (once at a time) and calls `then` when a new state was read. */
export function proofState(then = null, folder = activeFolder()) {
  if (then) waiting.add(then);
  if (folder && !loading) loading = (async () => {
    let changed = false;
    try {
      const st = await folder.stat(STATE_FILE);
      if (!st?.exists || st.dir) { changed = !!cache.state; cache = { key: '', state: null }; return; }
      const key = `${st.mtime ?? ''}:${st.size ?? ''}`;
      if (key === cache.key) return;
      cache = { key, state: JSON.parse(await textOf(await folder.read(STATE_FILE))) };
      changed = true;
    } catch { /* unreadable or half written: the next look reads it */ } finally {
      loading = null;
      const fns = [...waiting]; waiting.clear();
      if (changed) for (const f of fns) { try { f(); } catch { /* a closed panel */ } }
    }
  })();
  return cache.state;
}

/** The state once it is read: what proofState reads now (the file looked at again), awaited; null when there is none. */
export async function proofStateReady(folder = activeFolder()) {
  proofState(null, folder);
  if (loading) await loading.catch(() => {});
  return cache.state;
}

/** The value key of a cell as the checks name it ("age", "o1_end_mean@arm1") from its column id ("t_x.o1_end_mean@arm1"). */
export function valueKey(columnId) {
  const [base, arm] = String(columnId || '').split('@');
  return `${base.slice(base.indexOf('.') + 1)}${arm ? `@${arm}` : ''}`;
}

/** The reconciled status of one cell, or null when the checker has no state for its study. */
export function cellProof(state, s, paperId, columnId, value) {
  const st = state?.studies?.[paperId];
  if (!st) return null;
  const key = valueKey(columnId);
  const v = String(value ?? ''), field = checkFor(s?.valueChecks?.studies?.[paperId]?.fields?.[key], v, s?.values?.[`${paperId}:${columnId}`]?.qualifier);
  return reconcile(st.values?.[key], field, v);
}

/**
 * What is still open in the checker's state, over `studies` ([{ id, label }]): values not proven, in error or contradicted, and the paper's own
 * contradictions (`paper` findings of level conflict). { values, unproven, error, contradicted, rows: [{ id, label, error, unproven, contradicted,
 * open, at }] }, the rows the studies with something open, most open first; `at` is the value key to open (the worst first). Null with no state.
 */
export function openValues(state, studies) {
  if (!state?.studies) return null;
  const out = { values: 0, unproven: 0, error: 0, contradicted: 0, rows: [] };
  let seen = 0;
  for (const p of studies) {
    const st = state.studies[p.id];
    if (!st) continue;
    const row = { id: p.id, label: p.label, error: 0, unproven: 0, contradicted: 0, open: 0, at: '' };
    let rank = 0;
    for (const [key, v] of Object.entries(st.values || {})) {
      seen++;
      const r = v.status === 'error' ? 3 : v.status === 'conflict' ? 2 : v.status === 'unproven' ? 1 : 0;
      if (!r) continue;
      if (r === 3) row.error++; else if (r === 2) row.contradicted++; else row.unproven++;
      if (r > rank) { rank = r; row.at = key; }
    }
    row.contradicted += (st.paper || []).filter(f => f.level === 'conflict').length;
    row.open = row.error + row.unproven + row.contradicted;
    out.error += row.error; out.unproven += row.unproven; out.contradicted += row.contradicted;
    if (row.open) out.rows.push(row);
  }
  out.rows.sort((a, z) => z.open - a.open || z.error - a.error || String(a.label).localeCompare(String(z.label)));
  return { ...out, values: seen };
}

/** Test seam: forget what was read. */
export const _reset = () => { cache = { key: '', state: null }; loading = null; waiting.clear(); };

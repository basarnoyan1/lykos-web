// The proof checker's state in the app (31 Oct 2026): `.lykos/proofs/state.json.gz`, written by tools/lykos-proof.mjs (lykos verify proof,
// and after every change file applied), read once per change of the file and shown per value in the extraction details with the same words
// the command line uses (lib/proof/reconcile.mjs). Nothing is proved here: the app shows what the checker found, beside what was recorded.
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { lib_gzip$textOf as textOf } from "../boot.mjs";
import { reconcile } from './proof/reconcile.mjs';

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
  return reconcile(st.values?.[key], s?.valueChecks?.studies?.[paperId]?.fields?.[key], String(value ?? ''));
}

/** Test seam: forget what was read. */
export const _reset = () => { cache = { key: '', state: null }; loading = null; waiting.clear(); };

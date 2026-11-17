// What a project's .lykos folder may weigh (owner, 14 Nov 2026: "almost never pass 500mb even 250mb if possible for now and for the
// future"). The folder is measured by store; the total is held to TARGET, never past LIMIT, and each store has a share of TARGET so a
// report can say which one is over. Measured on clones of the three projects the same day (docs/footprint-2026-11.md, ".lykos budget"):
// Sham 1,001 MB before, 403 MB after the keep-all compact with Word files by their entries; ASD 91 MB; glioma 5 MB.
// Pure: sizes in, a verdict and lines out. tools/lykos-tidy.mjs reports it and repacks (tools/history-thin.mjs, keep-all) at REPACK_AT.

export const MB = 1e6;
export const TARGET = 250 * MB, LIMIT = 500 * MB;
/** A repack (every commit kept) runs when the folder passes this share of TARGET. */
export const REPACK_AT = 0.8;
/** Each store's share of TARGET, in bytes. `project` is the working state; `vcs` its history; the rest are copies, records and caches. */
export const SHARES = Object.freeze({
  vcs: 150 * MB, project: 40 * MB, backups: 15 * MB, inbox: 10 * MB, fulltext: 15 * MB, cache: 10 * MB, other: 10 * MB,
});
/** The store a top-level entry of .lykos belongs to. */
export const storeOf = name => (Object.hasOwn(SHARES, name) && name !== 'other' ? name : 'other');

/**
 * The verdict for `sizes` ({ <top-level entry of .lykos>: bytes }): { total, state: 'under' | 'near' | 'over-target' | 'over-limit',
 * repack, stores: [{ store, bytes, share, over }] }. `near` from REPACK_AT of TARGET, when a repack is due.
 */
export function budget(sizes) {
  const by = {};
  for (const [name, bytes] of Object.entries(sizes || {})) { const s = storeOf(name); by[s] = (by[s] || 0) + (Number(bytes) || 0); }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const stores = Object.keys(SHARES).map(store => ({ store, bytes: by[store] || 0, share: SHARES[store], over: (by[store] || 0) > SHARES[store] }));
  const state = total > LIMIT ? 'over-limit' : total > TARGET ? 'over-target' : total >= REPACK_AT * TARGET ? 'near' : 'under';
  return { total, state, repack: state !== 'under', stores };
}

const mb = n => `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
/** Lines for a person: the total against the target, then each store over its share. */
export function budgetLines(v) {
  const head = { under: 'within its budget', near: 'near its budget', 'over-target': 'over its budget', 'over-limit': 'over its limit' }[v.state];
  return [`.lykos ${mb(v.total)} of ${mb(TARGET)} (limit ${mb(LIMIT)}): ${head}`,
    ...v.stores.filter(s => s.over).map(s => `  ${s.store} ${mb(s.bytes)}, its share ${mb(s.share)}`)];
}

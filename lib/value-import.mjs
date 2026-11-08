// Accepted values written by a migration of a whole table (lib/evidence-update.mjs: a newer version of the evidence table replacing what the earlier
// file supplied, and removing what it gave a study the table no longer has). One of the two places besides lib/fields.mjs that may write accepted values (app/lint-src.mjs VALUE_WRITERS), loaded only when
// a table is updated so the start-up graph does not carry it.

/** `keep`, then `incoming` over them; a locked value is never replaced. */
export function replaceValues(st, keep, incoming) {
  const locked = Object.fromEntries(Object.entries(st.values || {}).filter(([, v]) => v?.locked));
  st.values = { ...keep, ...incoming, ...locked };
  return st;
}

/** Removes these value keys (the values a table's file gave a study the table no longer has); a locked value stays. */
export function removeValues(st, keys) {
  const drop = new Set(keys);
  st.values = Object.fromEntries(Object.entries(st.values || {}).filter(([k, v]) => !drop.has(k) || v?.locked));
  return st;
}

/** One value as a file now gives it (lib/data-follow.mjs: a cell the app never edited follows its file); a locked value stays. */
export function setValue(st, key, value) {
  if (st.values?.[key]?.locked) return st;
  st.values = { ...(st.values || {}), [key]: value };
  return st;
}

/**
 * The incoming values (a table's newer file) that give a value as it already was take the existing record in their place, its checks, notes
 * and quotes kept, the newer file's cell added to its evidence and the replaced file's cell dropped. Answers how many (28 Oct 2026).
 */
export function keepUnchanged(current = {}, incoming = {}, replacedFile = '') {
  let n = 0;
  for (const [k, nv] of Object.entries(incoming)) {
    const old = current[k];
    if (!old || String(old.reported_value ?? '') !== String(nv?.reported_value ?? '')) continue;
    const fileEv = (nv.evidence || []).filter(e => e?.kind === 'file'), files = new Set(fileEv.map(e => e.path));
    incoming[k] = { ...old, evidence: [...fileEv, ...(old.evidence || []).filter(e => !(e?.kind === 'file' && (files.has(e.path) || e.path === replacedFile)))] };
    n++;
  }
  return n;
}

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

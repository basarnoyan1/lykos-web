// Versions of a kept thing (plan §2, "One registry", 2026-10-23): a list of immutable entries `{ n, at, author, message, summary, [field] }`
// where `field` holds what was kept (an output's spec, an analysis's result). A save that keeps what the latest version holds adds nothing;
// restoring adds a version. Shared by output specs (lib/output-spec.mjs) and kept results (lib/result-versions.mjs). Pure.

/** JSON with every object's keys sorted, so two objects that hold the same compare equal whatever their key order. */
export const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));

/**
 * Adds a version holding `value` unless it keeps what the latest holds (`key(value)` compares them). Returns `{ versions, version }`; version
 * is null when nothing changed. `summarize(before, after)` words the change ('Created' for the first); `summary` overrides it (a restore).
 */
export function recordVersion(list = [], value, { field = 'data', key = stable, summarize = () => 'Changed', summary = '', author = 'You', message = '', at = new Date().toISOString(), restoredFrom, limit = 50 } = {}) {
  const last = list.at(-1);
  if (last && key(last[field]) === key(value)) return { versions: list, version: null };
  const version = { n: (last?.n || 0) + 1, at, author: String(author || 'You').slice(0, 80), message: String(message || '').trim().slice(0, 160),
    summary: summary || (last ? summarize(last[field], value) : 'Created'), [field]: structuredClone(value), ...(restoredFrom ? { restoredFrom } : {}) };
  return { versions: [...list, version].slice(-limit), version };
}

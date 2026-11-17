// The journal directory the journal search reads: every journal in NCBI's databases (assets/journals/nlm-journals.json, NLM's
// list, tools/build-journal-directory.mjs) joined with the Zotero style catalog (assets/journals/zotero-catalog.json), whose
// entries carry a citation format and fields. A journal in both is one entry: the catalog's, with NLM's abbreviations as aliases.
// A journal only NLM lists has no format (`format: null`): the app knows its name, not its style. Pure: no fetch, no DOM.
import { journalKey } from './journal-presets.mjs';

/** Catalog entries and NLM rows ([title, abbreviation, iso?]) as one list of `{ id, label, format, fields, aliases, abbr }`. */
export function mergeDirectory(catalog, rows) {
  const out = catalog.map(e => ({ ...e })), byKey = new Map();
  for (const e of out) if (!byKey.has(journalKey(e.label))) byKey.set(journalKey(e.label), e);
  const seen = new Set();
  for (const [title, abbr, iso] of rows) {
    const key = journalKey(title), short = key.split(' : ')[0];
    // "Journal of the American Medical Informatics Association : JAMIA" is the catalog's "Journal of the American Medical Informatics Association"
    const hit = byKey.get(key) || byKey.get(journalKey(title.split(' : ')[0])) || byKey.get(short);
    const aliases = [abbr, iso].filter(Boolean);
    if (hit) { hit.abbr ||= abbr; hit.aliases = [...new Set([...(hit.aliases || []), ...aliases])]; continue; }
    const id = `nlm:${abbr || title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: title, format: null, fields: [], aliases, abbr });
  }
  return out;
}

/** The directory in name order, once (presets included): a search then sorts its matches by a number alone, name order kept within each. */
export const byName = list => { const by = new Intl.Collator('en').compare; return list.sort((a, b) => by(a.label, b.label)); };

/**
 * The entries matching `query` (every word in the name, id or an abbreviation; case and punctuation do not matter), best first:
 * the name or an abbreviation exactly, then a name that starts with the query, then the rest; a journal with a known format before
 * one without at each step, then by name (the order byName gives). Each entry's search text is worked out once.
 */
export function rankJournals(entries, query) {
  const q = journalKey(query), tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return entries;
  const scored = [];
  for (const j of entries) {
    const hay = j._hay ||= journalKey(`${j.label} ${j.id} ${(j.aliases || []).join(' ')}`);
    if (!tokens.every(t => hay.includes(t))) continue;
    const name = j._key ||= journalKey(j.label);
    const exact = name === q || (j.aliases || []).some(a => journalKey(a) === q);
    scored.push([exact ? 0 : name.startsWith(q) ? 1 : 2, j.format ? 0 : 1, j]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(s => s[2]);   // entries come in name order (byName)
}

import { reasonCode } from './screening-checks.mjs';

/** Keep the PRISMA export format while editing reasons as labelled rows. */
export function parseReasons(value = '') {
  return String(value).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const comma = part.lastIndexOf(',');
    if (comma < 0) return { reason: part, count: '' };
    return { reason: part.slice(0, comma).trim(), count: part.slice(comma + 1).trim() };
  });
}
export function formatReasons(rows) {
  return rows.map(({ reason, count }) => ({ reason: String(reason).trim(), count: String(count).trim() }))
    .filter(row => row.reason || row.count)
    .map(row => row.count ? `${row.reason}, ${row.count}` : row.reason).join('; ');
}

/**
 * Exclusions by reason as PRISMA's "Reports excluded" counts them: one group per criterion a reason names (lib/screening-checks.mjs
 * reasonCode: "E1: Not randomized…" and a bare "E1" are one reason), else one per reason as written. A group is named by the spelling its
 * exclusions use most (ties: the first met); a code always written alone by the protocol's words for it ("E2: <criterion>"), or by the code
 * when the protocol has none. Groups in the order first met: [{ name, items }]. 8 Nov 2026 (Fable review F4): the Sham review's full text
 * held "E1: Not randomized to a sham condition" 100 times and "E1" 3 times, and the flow drew two reasons.
 */
export function reasonGroups(items, reasonOf, criteria = []) {
  const groups = new Map();
  for (const item of items) {
    const reason = String(reasonOf(item) ?? '').trim() || 'Other', key = reasonCode(reason) || reason;
    if (!groups.has(key)) groups.set(key, { key, items: [], spellings: new Map() });
    const g = groups.get(key);
    g.items.push(item);
    if (reason !== key) g.spellings.set(reason, (g.spellings.get(reason) || 0) + 1);
  }
  const words = new Map((Array.isArray(criteria) ? criteria : []).filter(c => c?.id != null && String(c.text || '').trim())
    .map(c => [String(c.id), String(c.text).trim().replace(/\.$/, '')]));
  return [...groups.values()].map(g => {
    let name = '';
    for (const [spelling, n] of g.spellings) if (!name || n > g.spellings.get(name)) name = spelling;
    if (!name) name = words.has(g.key) ? `${g.key}: ${words.get(g.key)}` : g.key;
    return { name: name.replace(/;/g, ','), items: g.items };
  });
}

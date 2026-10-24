// Counted events read from free text (plan §I, pooled proportions amendment
// 2026-09-28). An evidence table often states several complications in one
// cell: "Screw loosening 3/68 (4.4%); implant breakage 0/68; revision NR".
// This reads each named item into events and a denominator, and nothing more:
//
// - "NR", "NA", "not reported", "not measured" and an item the text does not
//   name are missing, never zero;
// - a percentage without a count is kept as a percentage; it becomes a count
//   only when the caller supplies the exact denominator and exactly one whole
//   count reproduces the percentage at its stated precision;
// - a bound ("in at least 1/31", "up to 9/26"), a count without a
//   denominator, a percentage that contradicts its count, and anything else
//   are listed as unreadable, with the text and the reason.
//
// Pure and dependency-free: the analysis, the tests and the setup scripts
// read the same rules.

const MISSING = /^(nr|n\/r|na|n\/a|not reported|not measured|not assessed|not stated|not available|unknown|—|–|-)$/i;
const BOUND = /^(in\s+)?(at least|at most|up to|more than|less than|over|under|≥|≤|>|<|~|approx\.?|approximately|about|around)\s*/i;

/** An item's name as a key: lower case, single spaces. */
export const itemKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Whether a cell shared by the arms gives its counts for each arm ("(each arm)", "in both arms", "per group"). */
export const eachArm = text => /\b(?:each|both|per|every)\s+(?:arms?|groups?|cohorts?)\b|\bin\s+(?:each|both|all)\s+(?:arms|groups|cohorts)\b/i.test(String(text ?? ''));
/** A study arm's size from its label: "Arm 1 (n=32)" or "NA (n=68)" → 32, 68; null when not stated. */
export function armSize(text) {
  const m = /\(\s*n\s*=\s*(\d+)\s*\)/i.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// "4.4" → 1 decimal: the precision a percentage was reported at.
const decimals = p => (String(p).split('.')[1] || '').length;
const agrees = (events, n, pct) => Math.abs((100 * events) / n - Number(pct)) <= 0.5 * 10 ** -decimals(pct) + 1e-9;

/**
 * One segment's value ("3/68 (4.4%)", "NR", "2.5%"), read. `n` is an exact
 * denominator to turn a lone percentage into a count, or null.
 */
function readValue(raw, n) {
  const t = raw.trim().replace(/ | /g, ' ').replace(/\s*\((?:in\s+)?(?:each|both|per|every)\s+(?:arms?|groups?|cohorts?)\)\s*$/i, '');
  if (!t) return { status: 'missing', reason: 'empty' };
  if (MISSING.test(t)) return { status: 'missing', reason: t.toUpperCase() === t ? t : t.toLowerCase() };
  if (BOUND.test(t)) return { status: 'unreadable', reason: 'a bound, not an exact count' };
  let m = /^(\d+)\s*\/\s*(\d+)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?$/.exec(t);
  if (m) {
    const events = Number(m[1]), den = Number(m[2]), pct = m[3] ?? null;
    if (den < 1) return { status: 'unreadable', reason: 'denominator is zero' };
    if (events > den) return { status: 'unreadable', reason: 'more events than the denominator' };
    if (pct != null && !agrees(events, den, pct)) return { status: 'unreadable', reason: `${pct}% does not match ${events}/${den}` };
    return { status: 'count', events, n: den, percent: pct == null ? null : Number(pct) };
  }
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) {
    const pct = Number(m[1]);
    if (Number.isSafeInteger(n) && n > 0) {
      const fits = [];
      for (let k = 0; k <= n; k++) if (agrees(k, n, m[1])) fits.push(k);
      if (fits.length === 1) return { status: 'count', events: fits[0], n, percent: pct, fromPercent: true };
      return { status: 'unreadable', percent: pct, reason: fits.length ? `${m[1]}% fits more than one count of ${n}` : `${m[1]}% is not a whole count of ${n}` };
    }
    return { status: 'unreadable', percent: pct, reason: 'a percentage without a count' };
  }
  if (/^\d+$/.test(t)) return { status: 'unreadable', reason: 'a count without a denominator' };
  return { status: 'unreadable', reason: 'not a count' };
}

/**
 * Every item a text names, in order. Each is `{ name, key, text, status,
 * events, n, percent, reason }`, status 'count', 'missing' or 'unreadable'.
 * Segments split on ";" and new lines; a segment is a name followed by its
 * value. `unreadable` lists the segments with no name at all.
 */
export function parseCountText(text, { n = null } = {}) {
  const items = [], unreadable = [];
  for (const seg of String(text ?? '').split(/[;\n]+/)) {
    const s = seg.trim();
    if (!s || MISSING.test(s)) continue;   // a cell that is only "NR" names no item
    // the name: words up to the first number, bound, percentage or missing marker
    const m = /^([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ\s\-/'()]*?)\s*(?::\s*)?((?:in\s+)?(?:at least|at most|up to|more than|less than|≥|≤|>|<|~)?\s*\d.*|NR|N\/R|NA|N\/A|not\s+\w+.*|—|–)$/i.exec(s);
    if (!m) {
      // a name with nothing after it, or no name at all
      if (/^[A-Za-z]/.test(s) && !/\d/.test(s)) items.push({ name: s, key: itemKey(s), text: s, status: 'unreadable', reason: 'no value' });
      else unreadable.push({ text: s, reason: 'no item name' });
      continue;
    }
    const name = m[1].trim();
    items.push({ name, key: itemKey(name), text: s, ...readValue(m[2], n) });
  }
  return { items, unreadable };
}

/**
 * One item of a text: its count, or why there is none. `status` is 'count',
 * 'missing' (NR, not measured, or not named at all) or 'unreadable'.
 * `names` lists the item's accepted names; a text naming it twice is
 * unreadable, since the two cannot be told apart.
 */
export function countFor(text, names, { n = null } = {}) {
  const want = new Set((Array.isArray(names) ? names : [names]).map(itemKey));
  const { items } = parseCountText(text, { n });
  const hits = items.filter(i => want.has(i.key));
  if (!hits.length) return { status: 'missing', reason: String(text ?? '').trim() ? 'not listed' : 'empty', text: '' };
  if (hits.length > 1) return { status: 'unreadable', reason: 'listed more than once', text: hits.map(h => h.text).join('; ') };
  const { name, key, ...rest } = hits[0];
  return rest;
}

/** The item names a set of texts uses, with how often each is a count: for choosing an outcome. */
export function itemsIn(texts) {
  const by = new Map();
  for (const t of texts) for (const i of parseCountText(t).items) {
    const e = by.get(i.key) || { key: i.key, name: i.name, count: 0, missing: 0, unreadable: 0 };
    e[i.status === 'count' ? 'count' : i.status]++;
    by.set(i.key, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

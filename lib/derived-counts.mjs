// Pooled-proportion inputs read from an evidence table's text (plan §I,
// pooled proportions amendment 2026-09-28).
//
// An outcome may take its events and denominators from a text column of an
// extraction table instead of from numeric extraction fields:
//
//   outcome.derived = {
//     kind: 'text-counts',
//     template: 't_…',             // the table
//     column: 't_….mechanical_failure_revision',
//     items: ['revision'],         // the item's accepted names in that text
//     unit: 'arm',                 // each study arm is a row of the analysis
//     nColumn: 't_….arm_n',        // optional: "Arm 1 (n=32)", the arm's size
//     fromPercent: false,          // a lone percentage becomes a count only when true
//     subgroup: { column: 't_….surgical_intent', levels: [['Non-fusion', 'Non-fusion'], …] },
//   }
//
// Nothing is copied: the counts are read from the cells every time, so the
// analysis follows the table, a changed cell makes a saved result stale, and
// every row names the cell it came from. The same cell always reads the
// same way (lib/count-text.mjs), so a re-run is deterministic.
import { armsOf, cellKey, armLabel } from './arms.mjs';
import { countFor, armSize } from './count-text.mjs';
import { isIncluded } from './screen.mjs';

const textOf = v => (v == null ? '' : String(v.reported_value ?? v.normalized_value ?? ''));
const tidy = t => String(t ?? '').replace(/\s+/g, ' ').trim();
/** The label of an arm without its size: "Arm 1 (n=32)" → "Arm 1". */
export const armName = (label, i) => armLabel(label, i).replace(/\s*\(n\s*=.*$/i, '').trim() || `Arm ${i + 1}`;

/** The subgroup an arm's text falls in: its mapped level, or null (not reported or not mapped). */
export function subgroupLevel(sub, raw) {
  const t = tidy(raw);
  if (!sub || !t || /^(nr|na|not reported)$/i.test(t)) return null;
  if (!Array.isArray(sub.levels) || !sub.levels.length) return t;   // no map: each text is its own level
  const hit = sub.levels.find(([from]) => tidy(from).toLowerCase() === t.toLowerCase());
  return hit ? String(hit[1]) : null;
}

/** The studies a derived outcome reads: those in scope (included, once screening has decisions) with a row in the table. */
export function studiesOf(s, template) {
  const papers = s.papers || [];
  const decided = papers.some(p => s.screening?.[p.id] || s.fulltext?.[p.id]);
  const ids = new Set((template?.columns || []).map(c => c.id));
  const has = new Set();
  for (const k of Object.keys(s.values || {})) {
    const i = k.indexOf(':'); if (i < 0) continue;
    const col = k.slice(i + 1).replace(/@arm\d+$/, '');
    if (ids.has(col)) has.add(k.slice(0, i));
  }
  return papers.filter(p => has.has(p.id) && (!decided || isIncluded(s, p.id))).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every unit (arm, or study) of a derived outcome with its count or the
 * reason it has none. Each unit: `{ id, paperId, arm, label, key, text,
 * armN, subgroupRaw, subgroup, status, events, n, reason }`, status 'count',
 * 'missing' or 'unreadable'.
 */
export function derivedUnits(s, derived) {
  const template = (s.templates || []).find(t => t.id === derived?.template);
  if (!template) return [];
  const out = [];
  for (const p of studiesOf(s, template)) {
    const arms = derived.unit === 'study' ? null : armsOf(template, p.id);
    (arms || [null]).forEach((a, i) => {
      const arm = a?.id || null;
      const own = arm ? s.values?.[cellKey(p.id, derived.column, arm)] : null;
      const plain = s.values?.[cellKey(p.id, derived.column)];
      const key = own ? cellKey(p.id, derived.column, arm) : cellKey(p.id, derived.column);
      const text = textOf(own || plain);
      const cell = col => textOf(s.values?.[cellKey(p.id, col, arm)] || s.values?.[cellKey(p.id, col)]);
      const armN = derived.nColumn ? armSize(cell(derived.nColumn)) ?? armSize(a?.label) : armSize(a?.label);
      const subgroupRaw = derived.subgroup?.column ? tidy(cell(derived.subgroup.column)) : '';
      const c = countFor(text, derived.items || [], { n: derived.fromPercent ? armN : null });
      const unit = { id: arm ? `${p.id}@${arm}` : p.id, paperId: p.id, arm,
        label: arm ? `${p.label || p.id} · ${armName(a.label, i)}` : (p.label || p.id),
        key, text: tidy(text), armN, subgroupRaw, subgroup: subgroupLevel(derived.subgroup, subgroupRaw),
        status: c.status, events: c.events ?? null, n: c.n ?? null, reason: c.reason || '',
        ...(c.fromPercent ? { derivation: `${c.percent}% of n = ${c.n}` } : {}) };
      // A count stated once for a study with several arms describes the
      // whole cohort, not an arm; so does a denominator larger than the arm.
      // Neither is a count of this arm: no events or n are kept for it.
      if (unit.status === 'count' && arm && !own) Object.assign(unit, { status: 'unreadable', reason: 'stated for the whole study, not per arm', events: null, n: null });
      else if (unit.status === 'count' && arm && armN != null && unit.n > armN) Object.assign(unit, { status: 'unreadable', reason: `denominator ${unit.n} exceeds the arm's n = ${armN}`, events: null, n: null });
      out.push(unit);
    });
  }
  // by label, as a reader looks for a study; the id settles equal labels
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * The inputs of a derived outcome, in the shape `pooledInputs` returns:
 * `ready` (units with a count), `incomplete` (missing), `invalid`
 * (unreadable) and a snapshot that changes whenever a count, a unit's
 * subgroup (when one is used) or the rule that reads them changes.
 */
export function derivedInputs(s, derived, moderator = '') {
  const units = derivedUnits(s, derived);
  const ready = units.filter(u => u.status === 'count');
  const incomplete = units.filter(u => u.status === 'missing');
  const invalid = units.filter(u => u.status === 'unreadable');
  const rows = ready.map(u => [u.id, u.label, u.events, u.n, u.key, moderator ? u.subgroup ?? '' : '']);
  const pending = [...incomplete, ...invalid].map(u => [u.id, u.status, u.reason]).sort((a, b) => a[0].localeCompare(b[0]));
  const rule = { kind: derived.kind, template: derived.template, column: derived.column, items: derived.items, unit: derived.unit || 'arm',
    nColumn: derived.nColumn || '', fromPercent: !!derived.fromPercent, ...(moderator ? { subgroup: derived.subgroup || null } : {}) };
  return { ready, incomplete, invalid, units, measure: 'PR', unit: derived.unit || 'arm',
    studies: new Set(ready.map(u => u.paperId)).size,
    snapshot: JSON.stringify({ family: 'proportion', derived: rule, moderator, rows, pending }) };
}

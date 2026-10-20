// The Analysis page's input grid (views/analysis-grid.mjs): the studies a pooled effect is run on, as rows, and the effect measure's
// inputs (events and totals per arm, means, SDs and sizes, an estimate and its interval), as columns. A study with several treated arms
// has a row per arm: its treated inputs are the arm's own cells, the shared control's the same cells on every arm's row. Every cell is
// the extraction value of that study and field (one source of truth, plan I1); what is typed in one is written through
// lib/cell-write.mjs exactly as Extraction writes it. Pure over the state.
import { FIELDS } from '../schema.mjs';
import { inputFields, measureOf } from './effect-measures.mjs';
import { fieldFor, PRIMARY } from './outcomes.mjs';
import { multiArmOf, armsApply, TREATED, armFieldId } from './multi-arm.mjs';
import { poolEligible, pooledInputs } from './analysis-inputs.mjs';
import { cellNumber } from './fields.mjs';
import { cellText } from './cell-write.mjs';
import { day } from './dates.mjs';

const schemaField = base => FIELDS.find(f => f.id === base) || { id: base, label: base, type: 'number' };
/** Whether the grid is how a measure's inputs are entered: a reported model has its own per-study form. */
export const gridApplies = measure => measureOf(measure).family !== 'reported';

/** Why a locked value cannot be typed over: when and by whom it was locked, and where it changes. */
export const lockReason = v => (v?.locked ? `Locked${v.locked.at ? ` ${day(v.locked.at)}` : ''}${v.locked.by ? ` by ${v.locked.by}` : ''}: amend it in Extraction` : '');

/**
 * The grid of an outcome at a timepoint (`slot`) for `measure`. `double` is the extractor whose entries are shown ('A' or 'B'),
 * 'compare', or null. Returns { columns: [{ base, label, type }], rows: [{ id, paperId, paper, arm, label, state, cells }] }; a cell is
 * { key, paperId, fieldId, type, text, proposed, readOnly, why, shared }.
 */
export function inputGrid(s, measure, slot = PRIMARY, { double = null } = {}) {
  const bases = inputFields(measure), family = measureOf(measure).family;
  const columns = bases.map(base => { const f = schemaField(base); return { base, label: f.label, type: f.type }; });
  const pin = pooledInputs(s, '', measure, slot);
  const stateOf = new Map([...pin.incomplete.map(p => [p.id, 'incomplete']), ...pin.invalid.map(p => [p.id, 'invalid'])]);
  const rows = [];
  for (const paper of poolEligible(s)) {
    const m = armsApply(measure) ? multiArmOf(s, paper.id) : null;
    const arms = m ? m.arms : [null];
    arms.forEach((arm, i) => {
      const cells = columns.map(c => {
        const treated = TREATED[family]?.includes(c.base);
        const fieldId = arm && treated ? armFieldId(fieldFor(c.base, slot), arm.id) : fieldFor(c.base, slot);
        return cellOf(s, paper.id, fieldId, c.type, double, { shared: Boolean(m) && !treated && i > 0 });
      });
      rows.push({ id: arm ? `${paper.id}@${arm.id}` : paper.id, paperId: paper.id, paper, arm: arm?.id || null,
        label: arm ? `${paper.label || paper.id} · ${arm.label || arm.id}` : paper.label || paper.id, state: stateOf.get(paper.id) || 'ready', cells });
    });
  }
  return { columns, rows };
}

function cellOf(s, paperId, fieldId, type, double, { shared }) {
  const key = `${paperId}:${fieldId}`, v = s.values?.[key], pr = s.proposals?.[key];
  const base = { key, paperId, fieldId, type, shared };
  if (v?.locked) return { ...base, text: cellText(v), proposed: false, readOnly: true, why: lockReason(v) };
  if (double) {
    const e = s.doubleExtraction?.entries?.[key] || {};
    if (double === 'compare') {
      const text = v ? cellText(v) : e.A || e.B ? `${e.A?.value ?? '—'} · ${e.B?.value ?? '—'}` : '';
      return { ...base, text, proposed: false, readOnly: true, why: 'Comparing entries: choose the final value in Extraction' };
    }
    const own = e[double];
    return { ...base, text: own ? own.value : v ? cellText(v) : pr ? String(pr.value ?? '') : '', proposed: !own && !v && Boolean(pr), readOnly: false, why: '' };
  }
  return { ...base, text: v ? cellText(v) : pr ? String(pr.value ?? '') : '', proposed: !v && Boolean(pr), readOnly: false, why: '' };
}

/** Whether a typed text can be an input of this type: '' when it can ("NR" and an empty cell too), else what to type instead. */
export function checkInput(text, type) {
  const t = String(text ?? '').trim();
  if (!t || /^nr$/i.test(t)) return '';
  const n = cellNumber(t, type);
  if (type === 'integer') return Number.isSafeInteger(n) && n >= 0 ? '' : 'Enter a whole number, or NR';
  return Number.isFinite(n) ? '' : 'Enter a number, or NR';
}

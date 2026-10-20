// The decisions of a cell's Details panel (./extraction-details.mjs draws the panel): the foot bar is the human gate, Reject at the start,
// Edit and Accept at the end, the rest in its More, and `wireDecision` is what each of its buttons does.
import { inspectorActions } from '../lib/ui-actions.mjs';
import { ask, askText } from '../lib/dialog.mjs';
import { accept, reject, notReported } from '../lib/proposals.mjs';
import { get } from '../store.mjs';
import { setAnchoredValue, cellNumber, amendValue } from '../lib/fields.mjs';
import { sdFrom } from '../lib/extraction-check.mjs';
import { splitField, fieldFor } from '../lib/outcomes.mjs';
import { acceptedCount } from '../lib/analysis-inputs.mjs';

/** The foot of a cell's panel, by what the cell holds: a proposal is decided, an accepted value edited, a locked one amended. */
export function evidenceFoot({ proposal, value, sd = false, pdf = false }) {
  const open = { id: 'ev-open', label: 'Open PDF', disabled: !pdf };
  const derive = sd ? [{ id: 'ev-sd', label: 'Derive SD' }] : [];
  const spec = value?.locked ? { actions: [{ id: 'ev-amend', label: 'Amend' }], overflow: [open] }
    : proposal ? { start: [{ id: 'ev-reject', label: 'Reject', role: 'destructive' }], actions: [{ id: 'ev-edit', label: 'Edit' }, { id: 'ev-accept', label: 'Accept', icon: 'check', role: 'primary' }],
        overflow: [{ id: 'ev-nr', label: 'Not reported' }, ...derive, open] }
    : value ? { actions: [{ id: 'ev-edit-value', label: 'Edit' }], overflow: [{ id: 'ev-nr', label: 'Not reported' }, ...derive, open] }
    : { actions: [{ id: 'ev-nr', label: 'Not reported' }], overflow: [...derive, open] };
  return inspectorActions({ label: 'Decide this cell', id: 'ev-foot', ...spec });
}

/**
 * The foot's buttons, in `host`. `onEdit(initial)` edits the cell in place in the grid and returns true; when it cannot (the panel lies over the
 * grid) the value is typed in a one-field dialog instead.
 */
export function wireDecision(host, { paperId, columnId, column, value, proposal, ctx, onChange, onEdit = () => false }) {
  // an SD a paper gives only as an SE or a 95% CI of the mean is derived here,
  // by the stated formula, with the arm's n (plan G6)
  const { base, outcomeId } = splitField(columnId), sdArm = /^sd(_t|_c)?$/.exec(base);
  host.querySelector('#ev-accept')?.addEventListener('click', () => { try { accept(paperId, columnId); } catch (err) { ctx.say?.(err.message); return; } onChange(); });
  host.querySelector('#ev-edit')?.addEventListener('click', async () => {
    if (onEdit()) return;
    const v = await ask(column.label, { value: proposal.value, confirm: 'Accept' });
    if (v != null) { try { accept(paperId, columnId, { editedValue: v }); } catch (err) { ctx.say?.(err.message); return; } onChange(); }
  });
  host.querySelector('#ev-reject')?.addEventListener('click', async () => { const why = await ask('Reason', { placeholder: 'Why it is rejected', confirm: 'Reject' }); if (why != null) { reject(paperId, columnId, why); onChange(); } });
  host.querySelector('#ev-nr')?.addEventListener('click', () => { notReported(paperId, columnId); onChange(); });
  // a locked value changes only by an amendment with its reason, which is logged (plan G4)
  host.querySelector('#ev-amend')?.addEventListener('click', async () => {
    const text = await askText(`${column.label} · amended value`, { value: String(value.reported_value ?? ''), confirm: 'Next' });
    if (text == null || !text.trim() || text.trim() === String(value.reported_value ?? '')) return;
    const why = await ask('Reason for the amendment', { placeholder: 'Why the locked value changes', confirm: 'Amend' });
    if (!why?.trim()) return;
    amendValue(paperId, columnId, text, why); onChange();
  });
  host.querySelector('#ev-sd')?.addEventListener('click', async () => {
    const nId = fieldFor(`n${sdArm[1] || ''}`, outcomeId), n = acceptedCount(get().values?.[`${paperId}:${nId}`]);
    const text = await ask(`${column.label} from an SE or a 95% CI`, { placeholder: 'SE, or lower to upper', confirm: 'Derive' });
    if (text == null) return;
    const r = sdFrom(text, n);
    if (r.error) { ctx.say?.(r.error); return; }
    const shown = String(Number(r.value.toPrecision(6)));
    setAnchoredValue(paperId, columnId, { reported_value: shown, normalized_value: Number(shown), origin: 'derived', extractor: 'manual (derived)',
      evidence: value?.evidence || [], rationale: `Derived from ${text.trim()} with n = ${n}`, derivation: r.derivation });
    onChange();
  });
  // An accepted value corrected by hand keeps its evidence; the rationale says what it was.
  host.querySelector('#ev-edit-value')?.addEventListener('click', async () => {
    if (onEdit()) return;
    const was = String(value.reported_value ?? '');
    const v = await askText(column.label, { value: was, confirm: 'Save' });
    if (v == null || v.trim() === was) return;
    // a number column keeps a number, read as a typed cell is ("0,72", "1,234")
    const numeric = column.type === 'number' || column.type === 'integer', n = numeric ? cellNumber(v, column.type) : NaN;
    setAnchoredValue(paperId, columnId, { reported_value: v.trim(), normalized_value: Number.isFinite(n) ? (column.type === 'integer' ? Math.round(n) : n) : v.trim(), origin: 'manual', extractor: 'manual (edited)',
      evidence: value.evidence || [], rationale: `Edited by hand; was “${was.slice(0, 200)}”` });
    onChange();
  });
  host.querySelector('#ev-open')?.addEventListener('click', () => ctx.openDocument(paperId, null));
}

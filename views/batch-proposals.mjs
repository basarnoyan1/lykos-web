// What a batch extraction left waiting, as a person meets it outside its own page: one entry in the assistant panel's Proposals tab, the
// count on the status bar, and the one bulk action, "accept the clean ones", asked with a count and confirmed (lib/batch-review.mjs).
import { uiBar, uiDecisionRow } from '../lib/ui-actions.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { num, plural } from '../lib/dates.mjs';
import { get } from '../store.mjs';
import { templateById, templates } from '../lib/templates.mjs';
import { patientCounts, acceptableClean, acceptCleanRows, stampedCells, cellCounts, acceptableCells, acceptCleanCells } from '../lib/batch-review.mjs';

/** How many proposals a batch left: patient rows plus stamped cell proposals. */
export const batchProposalCount = (state = get()) => (state.ipdProposals || []).length + stampedCells(state).length;

/** Asks, with the count in front of the person, whether to accept every clean patient row; accepts them when told to. Returns a sentence, or null when nothing was done. */
export async function confirmAcceptCleanRows() {
  const counts = patientCounts(), n = acceptableClean().length; if (!n) return null;
  const left = counts.total - n;
  if (!await confirmAsk(`Accept ${plural(n, 'clean row')}?`, { detail: `${plural(n, 'patient')} join the patient table with their quotes. ${left ? `${plural(left, 'row')} with a broken rule or no check stay in Proposed.` : 'No row is left.'}`, confirm: `Accept ${num(n)}` })) return null;
  const r = acceptCleanRows();
  return `${plural(r.accepted, 'patient')} added`;
}

/** The same for the table cells a batch proposed: one table (`templateId`) or all of them. */
export async function confirmAcceptCleanCells(templateId = null) {
  const counts = cellCounts(get(), templateId), n = acceptableCells(get(), templateId).length; if (!n) return null;
  const left = counts.proposed - n, where = templateId ? (templateById(templateId)?.name || 'this table') : 'every table';
  if (!await confirmAsk(`Accept ${plural(n, 'clean cell')}?`, { detail: `${plural(n, 'value')} in ${where} are accepted with their quotes. ${left ? `${plural(left, 'cell')} with a broken rule or no check stay proposed.` : 'No cell is left.'}`, confirm: `Accept ${num(n)}` })) return null;
  const r = acceptCleanCells(templateId);
  return `${plural(r.accepted, 'value')} accepted${r.skipped ? `, ${num(r.skipped)} left for a person (not one clear number)` : ''}`;
}

const cellTables = state => { const by = new Map(); for (const c of stampedCells(state)) { const id = c.columnId.includes('.') ? c.columnId.split('.')[0] : 'default'; by.set(id, (by.get(id) || 0) + 1); } return by; };

/** The Proposals tab's entry for a batch: a row for the patient rows and one for the cells of each table, each to open or to accept clean. '' when there is none. */
export function batchEntryHtml(state = get()) {
  const rows = [], p = patientCounts(state);
  if (p.total) rows.push(uiDecisionRow({ id: 'bxp-patients', kind: 'Patient rows', summary: `${num(p.clean)} clean, ${num(p.exception)} to review${p.unchecked ? `, ${num(p.unchecked)} unchecked` : ''}`,
    choices: [{ id: 'bxp-patients-open', label: 'Open', icon: 'open', attrs: { 'data-bxp': 'patients-open' } }, { id: 'bxp-patients-accept', label: 'Accept clean', icon: 'check-square', disabled: !acceptableClean(state).length, attrs: { 'data-bxp': 'patients-accept' } }] }));
  for (const [tid] of cellTables(state)) {
    const c = cellCounts(state, tid), name = templates(state).find(t => t.id === tid)?.name || tid;
    rows.push(uiDecisionRow({ id: `bxp-cells-${tid}`, kind: `Cells: ${name}`, summary: `${num(c.clean)} clean, ${num(c.exception)} to review${c.unchecked ? `, ${num(c.unchecked)} unchecked` : ''}`,
      choices: [{ id: `bxp-cells-${tid}-open`, label: 'Open', icon: 'open', attrs: { 'data-bxp': 'cells-open', 'data-bxp-table': tid } },
        { id: `bxp-cells-${tid}-accept`, label: 'Accept clean', icon: 'check-square', disabled: !acceptableCells(state, tid).length, attrs: { 'data-bxp': 'cells-accept', 'data-bxp-table': tid } }] }));
  }
  if (!rows.length) return '';
  return `<div class="aid-entry" data-e="batch">${uiBar({ kind: 'head', density: 'dense', label: 'Proposal: Batch extraction', id: 'bxp-head', lead: { title: 'Batch extraction' } })}${rows.join('')}</div>`;
}

/** A signature of what the entry shows, so the tab is drawn again only when it changed. */
export const batchEntryKey = (state = get()) => { const p = patientCounts(state); return `${p.total}.${p.clean}.${p.exception}|${[...cellTables(state)].map(([id]) => `${id}:${cellCounts(state, id).clean}.${cellCounts(state, id).exception}`).join(',')}`; };

/** Wires the entry's buttons. `go` takes the person to the patients or to a table; `done` is called after an acceptance. */
export function wireBatchEntry(root, { openPatients, openTable, done }) {
  root.querySelectorAll('[data-bxp]').forEach(b => b.onclick = async () => {
    const what = b.dataset.bxp, table = b.dataset.bxpTable || null;
    if (what === 'patients-open') openPatients();
    else if (what === 'cells-open') openTable(table);
    else if (what === 'patients-accept') { if (await confirmAcceptCleanRows()) done(); }
    else if (what === 'cells-accept') { if (await confirmAcceptCleanCells(table)) done(); }
  });
}

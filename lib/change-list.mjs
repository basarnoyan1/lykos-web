// The change syntheses as the Syntheses page lists them (lib/change-list-items.mjs changeListOf), from a project: made once per set of
// inputs (lib/change-records.mjs), or taken from the worker's answer for those inputs (lib/change-run.mjs). Kept apart from
// lib/change-records.mjs, which the query layer reaches: only Syntheses › Change loads this.
import { changeInputs, changeModel, madeOf } from './change-records.mjs';
import { changeListOf } from './change-list-items.mjs';

/** The project's change syntheses in their groups ([{ group, items }]: lib/change-list-items.mjs). A project without a plan has none. */
export function changeList(s) {
  const inputs = changeInputs(s);
  if (!inputs) return [];
  const e = madeOf(inputs);
  return (e.list ||= changeListOf(changeModel(s)));
}

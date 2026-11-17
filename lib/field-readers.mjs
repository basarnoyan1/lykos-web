// What in a project reads an extraction field (Sham, 13 Nov 2026: two indication fields and nothing said which one the analysis and the Scales
// page read; docs/Sham_Needs_Review_2026-11.md, "The Data summary"). Pure: it reads the project state and returns lines for the Data summary.
//
// Three readers are known by their settings: the change synthesis (its pools' grouping, its subgroups and its meta-regression terms name a
// field by its id, or by the id without the table's prefix, as lib/change-synthesis.mjs reads them), the Scales page and its instrument map
// (lib/outcome-rows.mjs mapFields) and the saved outputs, whose specs name a field by its label or its id.
import { outcomeTable, mapFields } from './outcome-rows.mjs';
import { lib_dates$plural as plural } from "../boot.mjs";

/** Whether `name` (a setting's field name) names the column `id` of table `t`. */
const names = (name, id, t) => !!name && (name === id || `${t?.id}.${name}` === id);

/** Every string in a value, depth first. */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/**
 * What reads field `field` ({ id, label }) of table `templateId`: [{ who, what, detail? }] in a fixed order (the change synthesis, Scales, saved
 * outputs). Empty when nothing names it.
 */
export function fieldReaders(st, templateId, field) {
  const t = (st?.templates || []).find(x => x.id === templateId) || null, id = field?.id || '', out = [];
  if (!t || !id) return out;
  const plan = st.synthesis?.change;
  if (plan) {
    const roles = [];
    if (names(plan.by || 'indication_class', id, t)) roles.push('the pools by class');
    const subs = (plan.subgroups || []).filter(g => names(g.by, id, t));
    if (subs.length) roles.push(plural(subs.length, 'subgroup analysis', 'subgroup analyses'));
    const terms = (plan.moderators?.terms || []).filter(x => names(x.var, id, t));
    if (terms.length) roles.push(plural(terms.length, 'meta-regression term'));
    if (roles.length) out.push({ who: 'Change synthesis', what: roles.join(', ') });
  }
  const ot = outcomeTable(st);
  if (ot && ot.id === t.id) {
    const F = mapFields(st, ot);
    if (F.indication === id) out.push({ who: 'Scales', what: 'the indication of each scale\'s studies' });
    if (F.procedure === id) out.push({ who: 'Scales', what: 'the procedure in the instrument map' });
  }
  const short = id.startsWith(`${t.id}.`) ? id.slice(t.id.length + 1) : id, keys = new Set([id, short, field.label].filter(Boolean));
  const saved = (st.outputs || []).map(o => o.versions?.at(-1)?.spec).filter(spec => spec && strings(spec.query).concat(strings(spec.columns), strings(spec.groupRowsBy)).some(s => keys.has(s)));
  if (saved.length) out.push({ who: 'Saved outputs', what: plural(saved.length, 'output'), detail: saved.slice(0, 3).map(s => s.title || s.id).join('; ') + (saved.length > 3 ? `; ${plural(saved.length - 3, 'other')}` : '') });
  return out;
}

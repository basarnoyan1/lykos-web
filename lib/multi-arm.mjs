// Studies with more than two arms in a pairwise analysis (plan G3, I4;
// Cochrane Handbook 23.3.4).
//
// A pairwise analysis compares one treated group with one control. A study
// with two treated arms and one shared control (two doses against placebo)
// cannot enter twice with the same control: its participants would be counted
// twice and the two comparisons are correlated. Per study the reviewer either
// chooses the comparison that fits the review question, or splits the shared
// control group between the comparisons (Handbook 23.3.4: its events and total
// are divided for a dichotomous outcome, its total for a continuous one, the
// mean and SD unchanged). The choice and its reason are recorded with the
// study and with every result it produced.
//
// `s.multiArm[paperId] = { arms: [{ id: 'arm1', label }, { id: 'arm2', label }, …],
//   control: 'Placebo', handling: 'arm1' | 'arm2' | … | 'split', reason }`.
// The first treated arm keeps the plain input keys (`events_t`, `mean_t__o2`),
// so a study's values from before it had arms are its first arm; a further
// arm's inputs carry `@armN` ("events_t@arm2", "mean_t__o2#t2@arm2").
// The control inputs (events_c, n_c, …) are shared and keep the plain keys.
//
// Pure: the analysis view, the extraction fields and the tests share it.
import { measureOf } from './effect-measures.mjs';

// The inputs that belong to a treated arm, per family; the rest are the
// shared control's. A reported ratio (HR) is itself a contrast: all three of
// its inputs are per arm, and it cannot be split.
export const TREATED = {
  binary: ['events_t', 'n_t'],
  continuous: ['mean_t', 'sd_t', 'n_t'],
  rate: ['events_t', 'time_t'],
  generic: ['hr', 'hr_lo', 'hr_hi'],
};
// What a split divides: a count or a size of the shared control, never a mean or an SD.
const SPLIT = { binary: ['events_c', 'n_c'], continuous: ['n_c'], rate: ['events_c', 'time_c'] };

/** Whether a measure's studies can have several treated arms here (two-group measures). */
export const armsApply = measure => measureOf(measure).family in TREATED;
/** Whether a split of the shared control is defined for the measure (not for a reported ratio). */
export const canSplit = measure => measureOf(measure).family in SPLIT;

/** A study's multi-arm record, when it has two treated arms or more; else null. */
export function multiArmOf(s, paperId) {
  const m = s.multiArm?.[paperId];
  return m && Array.isArray(m.arms) && m.arms.length > 1 ? m : null;
}
/** The most treated arms any study has (1 when none has several). */
export const maxArms = s => Math.max(1, ...Object.keys(s.multiArm || {}).map(id => multiArmOf(s, id)?.arms.length || 1));

/** The value key of an input for an arm: the plain key for the first arm and for control inputs. */
export const armFieldId = (fieldId, arm) => (!arm || arm === 'arm1' ? fieldId : `${fieldId}@${arm}`);

/** The handling a study's rows follow for this measure: a chosen arm, or 'split'. */
export function handlingOf(m, measure) {
  if (!m) return null;
  if (m.handling === 'split' && canSplit(measure)) return 'split';
  return m.arms.some(a => a.id === m.handling) ? m.handling : m.arms[0].id;
}

/** The label of a study's row for one comparison: "Trial 2018 · High dose vs Placebo". */
export function contrastLabel(paper, m, armId, split = false) {
  const arm = m.arms.find(a => a.id === armId);
  const name = arm?.label || armId;
  return `${paper.label || paper.id} · ${name}${m.control ? ` vs ${m.control}` : ''}${split ? ' (control split)' : ''}`;
}

/**
 * The comparisons a study contributes: `read(fieldId)` reads an accepted
 * input (null missing, NaN unreadable); `fields` are the measure's input
 * field ids in its order (already for the outcome and timepoint). Returns
 * [{ contrast, split, values }], one row for a two-arm study or a chosen
 * comparison, one per arm with inputs when the control is split (divided by
 * the number of arms that enter).
 */
export function contrastRows(s, paperId, measure, fields, bases, read) {
  const m = multiArmOf(s, paperId);
  const family = measureOf(measure).family;
  const own = arm => fields.map((f, i) => read(TREATED[family]?.includes(bases[i]) ? armFieldId(f, arm) : f));
  const how = armsApply(measure) ? handlingOf(m, measure) : null;
  if (!how) return [{ contrast: null, split: false, values: fields.map(read) }];
  if (how !== 'split') return [{ contrast: how, split: false, values: own(how) }];
  // arms without any treated input stay out of the split; one with part of its inputs is kept, so it shows as incomplete
  const treatedIdx = bases.map((b, i) => (TREATED[family].includes(b) ? i : -1)).filter(i => i >= 0);
  const entering = m.arms.map(a => ({ arm: a.id, values: own(a.id) })).filter(r => treatedIdx.some(i => r.values[i] != null));
  const k = entering.length || 1;
  const divide = SPLIT[family] || [];
  return entering.map(r => ({ contrast: r.arm, split: k > 1,
    values: r.values.map((v, i) => (k > 1 && divide.includes(bases[i]) && Number.isFinite(v) ? v / k : v)) }));
}

/** The sentence a result records for its multi-arm studies; '' when none. */
export function multiArmText(s, papers, measure) {
  const out = [];
  for (const p of papers) {
    const m = multiArmOf(s, p.id); if (!m) continue;
    const how = handlingOf(m, measure);
    const arm = m.arms.find(a => a.id === how);
    const control = m.control || 'the control arm';
    const text = how === 'split'
      ? `${p.label}: ${m.arms.map(a => a.label || a.id).join(' and ')} each compared with ${control}, the shared ${control} group split between the comparisons${measureOf(measure).family === 'continuous' ? ' (its total divided; mean and SD unchanged)' : ' (its events and total divided)'}`
      : `${p.label}: ${arm?.label || how} compared with ${control}; ${m.arms.filter(a => a.id !== how).map(a => a.label || a.id).join(', ')} not used`;
    out.push(`${text}${m.reason ? ` (${m.reason})` : ''}`);
  }
  return out.join('; ');
}

// ---- editing (reducers for update()) ---------------------------------------------

/** Declares a study's treated arms; the first keeps the study's existing values. */
export function setArms(st, paperId, labels, control = '') {
  const clean = labels.map(l => String(l || '').trim());
  st.multiArm = { ...(st.multiArm || {}) };
  if (clean.length < 2) { delete st.multiArm[paperId]; return st; }
  const was = st.multiArm[paperId] || {};
  st.multiArm[paperId] = { ...was, arms: clean.map((label, i) => ({ id: `arm${i + 1}`, label: label || `Arm ${i + 1}` })),
    control: String(control ?? was.control ?? '').trim(), handling: was.handling || 'arm1', reason: was.reason || '' };
  return st;
}
export function setHandling(st, paperId, handling, reason) {
  const m = st.multiArm?.[paperId]; if (!m) return st;
  st.multiArm = { ...st.multiArm, [paperId]: { ...m, ...(handling != null ? { handling } : {}), ...(reason != null ? { reason: String(reason).trim() } : {}) } };
  return st;
}

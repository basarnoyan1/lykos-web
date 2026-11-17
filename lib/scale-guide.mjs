// What the Scales page answers (owner, 13 Nov 2026: "it is hard to find like which scales do we use for what, how do we calculate that SMCR,
// which scales are used in which papers"; docs/Sham_Needs_Review_2026-11.md, items 1 and 2). Read from the review's own data and engine,
// never recomputed here: the scales and their studies from lib/scales.mjs scalesInUse, the arms and their SMCR from the change synthesis'
// rows and sets (lib/change-rows.mjs changeRows, lib/change-synthesis.mjs changeSets after the scale decisions), so a number on the page is
// the number the run pools. Pure: no store, no DOM; app/test/scale-guide.test.mjs checks it.
import { changeSets, withScaleDecisions, matchRow } from './change-synthesis.mjs';
import { scalePoolReadiness, reasonOf, OUT_REASONS } from './scales.mjs';
import { instrumentOf } from './instruments.mjs';

const memo = new WeakMap();
/** An arm row's identity across the two sets (the rows as recorded, and as the scale decisions leave them). */
export const armKey = a => `${a.paper_id}|${a.arm}|${a.outcome_slot}`;
/**
 * The synthesis' sets, made once per set of inputs ({ rows, plan } of lib/change-records.mjs changeInputs): `all` lists every arm as recorded
 * (an excluded scale's arms too, so its studies still show); `prim` and `sens` hold the keys of the arms the run pools after the decisions.
 */
export function guideSets(inputs) {
  if (!inputs?.rows?.arms) return null;
  let m = memo.get(inputs);
  if (!m) {
    const assumedR = inputs.plan?.assumedR ?? 0.5, scales = inputs.plan?.scales || {};
    const raw = changeSets(inputs.rows, { assumedR }), rows = withScaleDecisions(inputs.rows, scales);
    const decided = rows === inputs.rows ? raw : changeSets(rows, { assumedR });
    m = { assumedR, scales, all: raw.all, prim: new Set(decided.prim.map(armKey)), sens: new Set(decided.sens.map(armKey)),
      readiness: scalePoolReadiness(inputs.rows, { assumedR }) };
    memo.set(inputs, m);
  }
  return m;
}

/** A scale's role in the analyses, in words: its decision, and for a pooled scale how many of its studies enter the primary pool. */
export function roleWords(x, g, s = null) {
  const d = x.decision || { use: 'own' };
  if (d.use === 'exclude') return 'Excluded';
  if (d.use === 'sensitivity') return 'Sensitivity analyses only';
  if (d.use === 'convert') return `Converted to ${(s && instrumentOf(s, d.to)?.label) || d.to || 'another scale'}`;
  const r = g?.readiness?.[x.code];
  return r ? `Pooled: ${r.enter} of ${x.studies} in the primary pool` : 'Pooled on its own';
}

/**
 * The list the page draws, filtered: { scales, indications, domains, total }. `scales` are scalesInUse's entries with `role`; `indications`
 * the levels of the indication field the scales serve ([{ code, label }]) and `domains` what they measure, each for the filter's options.
 * `filter`: { indication, domain }, '' for any.
 */
export function scaleGuide(u, g, s = null, filter = {}) {
  const all = (u?.scales || []).map(x => ({ ...x, role: roleWords(x, g, s) }));
  const ind = new Map(), dom = new Set();
  for (const x of all) { for (const i of x.byIndication || []) if (!ind.has(i.code)) ind.set(i.code, i.label); if (x.domain) dom.add(x.domain); }
  const fi = filter.indication || '', fd = filter.domain || '';
  const scales = all.filter(x => (!fi || (x.byIndication || []).some(i => i.code === fi)) && (!fd || x.domain === fd));
  return { scales, total: all.length, indications: [...ind].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label)),
    domains: [...dom].sort((a, b) => a.localeCompare(b)) };
}

const ROLE_ORDER = { sham: 0, active: 1 };
/** Where an arm stands in the analyses: { primary, words }. */
export function armStanding(a, g) {
  const k = armKey(a);
  if (g.prim.has(k)) return { primary: true, words: 'In the primary pool' };
  if (g.sens.has(k)) return { primary: false, words: 'Sensitivity analyses only' };
  if (a.arm_role === 'active') return { primary: false, words: 'Active arm: not in the sham pool' };
  // an arm whose label names no role (lib/change-rows.mjs roles) is neither arm
  if (a.arm_role !== 'sham') return { primary: false, words: 'Not pooled: arm role not identified' };
  const use = g.scales?.[a.instrument]?.use;
  if (use === 'exclude') return { primary: false, words: 'Scale excluded' };
  if (use === 'convert') return { primary: false, words: 'Converted to another scale' };
  const why = reasonOf([a]);
  return { primary: false, words: `Not pooled: ${OUT_REASONS[why] || why}` };
}

/** Every arm of a scale, by study: [{ paper_id, trial, arms: [arm row with `standing`] }], studies by name, sham arms first. */
export function scaleStudies(g, code) {
  if (!g || !code) return [];
  const by = new Map();
  for (const a of g.all) {
    if (a.instrument !== code) continue;
    if (!by.has(a.paper_id)) by.set(a.paper_id, { paper_id: a.paper_id, trial: a.trial, arms: [] });
    by.get(a.paper_id).arms.push({ ...a, standing: armStanding(a, g) });
  }
  for (const st of by.values()) st.arms.sort((x, y) => (ROLE_ORDER[x.arm_role] ?? 2) - (ROLE_ORDER[y.arm_role] ?? 2) || String(x.outcome_slot).localeCompare(String(y.outcome_slot), 'en', { numeric: true }));
  return [...by.values()].sort((a, b) => String(a.trial).localeCompare(String(b.trial)));
}

/**
 * The scales a study reports and what enters the primary analysis: [{ instrument, outcome_slot, outcome, arms }], by slot. Each arm row
 * carries `standing`; `primary` is true on the outcomes of which a sham arm enters the primary pool.
 */
export function studyScales(g, paperId) {
  if (!g) return [];
  const by = new Map();
  for (const a of g.all) {
    if (a.paper_id !== paperId) continue;
    const k = a.outcome_slot;
    if (!by.has(k)) by.set(k, { outcome_slot: k, outcome: a.outcome, instrument: a.instrument || '', arms: [], primary: false });
    const o = by.get(k), standing = armStanding(a, g);
    o.arms.push({ ...a, standing });
    if (standing.primary) o.primary = true;
  }
  return [...by.values()].sort((a, b) => String(a.outcome_slot).localeCompare(String(b.outcome_slot), 'en', { numeric: true }));
}

// the field a source cell holds, from its key ("p1:t.o1_baseline_sd@arm1", or an outcome entry's "p1:t.out_baseline_sd~o1@arm1")
const FIELD = /(?:^|[._])(baseline|end|change)_(mean|sd|se|n|iqr|ci|range|median)(?=$|~|@)/;
const fieldOf = key => { const m = FIELD.exec(String(key).slice(String(key).indexOf(':') + 1)); return m ? `${m[1]}_${m[2]}` : ''; };
/** The source cell of a field of an arm row: { key, column } (column: the cell's id after the study's, as Extraction opens it), or null. */
export function sourceCell(a, ...fields) {
  for (const f of fields) {
    const key = (a.source_keys || []).find(k => fieldOf(k) === f);
    if (key) return { key, column: key.slice(key.indexOf(':') + 1) };
  }
  return null;
}
// a set's filter without its SD, correlation and scale-range tests: what the set asks of a row besides them
const SD_KEY = /sd|r_trial|range|bound|restricted/i;
function beside(w) {
  if (!w || typeof w !== 'object') return w;
  const out = {};
  for (const [k, v] of Object.entries(w)) {
    if (SD_KEY.test(k)) continue;
    if (k === 'all' || k === 'any') { const list = v.map(beside).filter(x => x && Object.keys(x).length); if (list.length) out[k] = list; }
    else if (k === 'not') { const x = beside(v); if (x && Object.keys(x).length) out.not = x; }
    else out[k] = v;
  }
  return out;
}
const flagOf = (a, name) => String(a.flags || '').split(/;\s*|\n/).map(x => x.trim()).find(x => x.startsWith(`${name}:`))?.slice(name.length + 1).trim() || '';
const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const fmt = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '' : Number(x).toFixed(d).replace(/\.?0+$/, '') || '0');

/**
 * How one arm's SMCR was made, read from its row: { formula, inputs, result, rules, alternatives }.
 * inputs: [{ id, label, value, how, cell }] (cell: sourceCell, the place a person opens to see the value); result: { yi, vi, J } or null;
 * rules: the lines that chose the change, the SD, n and r; alternatives: the plan's sensitivity sets that choose another SD, correlation
 * or row by its SD ({ code, title, value?: number, kept?: boolean }), each read from the arm's own variant or the set's own filter.
 */
export function smcrWorking(a, g, plan = {}) {
  const assumedR = g?.assumedR ?? 0.5, dir = a.dir, sign = dir === -1 ? 'lower is better, so the change is reversed' : dir === 1 ? 'higher is better' : 'direction not known';
  const changeHow = a.change_source === 'printed change' ? 'The printed mean change'
    : a.change_source === 'end minus baseline' ? `End mean ${fmt(a.end_mean)} minus baseline mean ${fmt(a.baseline_mean)}` : 'No usable mean change';
  const seNote = flagOf(a, 'baseline_sd'), sdHow = a.baseline_sd == null ? 'No baseline SD' : a.baseline_sd_converted ? `From the SE: ${seNote || 'SE × √n'}` : seNote ? `Reported; ${seNote}` : 'Reported as an SD';
  const nHow = { 'end n': 'Patients at the end time point', 'baseline n': 'Patients at baseline (no end n)', 'arm label': 'The arm’s label (no n in the cells)' }[a.n_source] || 'Not reported';
  const rHow = a.r_trial != null ? 'From the trial: (SD baseline² + SD end² − SD change²) ÷ (2 × SD baseline × SD end)' : `Assumed ${assumedR}: the trial gives no SD of the change`;
  const inputs = [
    { id: 'change', label: 'Mean change', value: a.change_used, how: changeHow, cell: a.change_source === 'printed change' ? sourceCell(a, 'change_mean') : sourceCell(a, 'end_mean', 'baseline_mean') },
    { id: 'sd', label: 'Baseline SD', value: a.baseline_sd, how: sdHow, cell: sourceCell(a, 'baseline_sd', 'baseline_se') },
    { id: 'n', label: 'n', value: a.n, how: nHow, cell: sourceCell(a, 'end_n', 'baseline_n') },
    { id: 'dir', label: 'Direction', value: dir, how: sign, cell: null },
    { id: 'r', label: 'Pre–post r', value: a.r_prim ?? a.r_trial ?? null, how: rHow, cell: a.r_trial != null ? sourceCell(a, 'change_sd') : null }];
  const ok = a.yi != null && Number.isFinite(a.yi) && a.change_used && a.baseline_sd > 0 && dir;
  const result = a.yi != null && Number.isFinite(a.yi) ? { yi: r2(a.yi), vi: a.vi, J: ok ? a.yi / (dir * a.change_used / a.baseline_sd) : null } : null;
  const rules = [
    'The change is the printed mean change from the pre-operative baseline; when none is printed, or its sign disagrees with end minus baseline, end minus baseline.',
    'The SD is the arm’s own baseline SD; an SE is converted with the arm’s n only when the cell says SE. An arm without a baseline SD has no SMCR in the primary pool.',
    `r changes only the variance. It is taken from the trial when its three SDs give −1 < r < 1, else ${assumedR}.`,
    'An arm of fewer than 3 patients, or of unknown direction, has no SMCR.'];
  const alternatives = [], pooled = a.yi != null && Number.isFinite(a.yi);
  for (const def of pooled ? plan.sensitivity || [] : []) {
    if (!def?.code) continue;
    // a set of other trials (a class's own row) does not concern this arm: its filter without the SD and correlation tests must hold
    if (!matchRow(a, beside(def.where))) continue;
    const text = JSON.stringify([def.where || null, def.excludeTrialsWhere || null]);
    if (def.effect) { const v = a[`yi${def.effect}`]; alternatives.push({ code: def.code, title: def.title || def.code, value: v == null ? null : r2(v) }); continue; }
    if (def.add === 'end-sd') { alternatives.push({ code: def.code, title: def.title || def.code, value: a.yi_fb == null ? null : r2(a.yi_fb) }); continue; }
    if (/sd|r_trial|range|bound/i.test(text)) {
      const kept = matchRow(a, def.where) && !(def.excludeTrialsWhere && matchRow(a, def.excludeTrialsWhere));
      alternatives.push({ code: def.code, title: def.title || def.code, kept });
    }
  }
  return {
    formula: ['SMCR = J × direction × mean change ÷ baseline SD', 'J = Hedges’ correction for n − 1 degrees of freedom', 'variance = 2(1 − r) ÷ n + SMCR² ÷ 2n'],
    inputs, result, rules, alternatives };
}

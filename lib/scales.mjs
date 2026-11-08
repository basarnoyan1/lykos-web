// Scales (plan G3a; W10, owner 7 Nov 2026: "we need a place to also decide on the scales or at least to see the scales that we used in the
// app"). For every scale a project's outcomes are coded to: the studies and arms that use it, by indication (the instrument map, read per
// scale), the usual scales of each indication that no study used, what the change synthesis can pool of it, and what the review decided to
// do with it. Names and facts are the registry's (lib/instruments.mjs and the project's own entries, s.instruments). Decisions are
// s.synthesis.scales ({ [code]: { use, to?, at } }, SCALE_USES), read by the change synthesis (lib/change-synthesis.mjs withScaleDecisions).
// On a governed protocol (a version, a registration or an amendment) a decision is filed as an amendment, which Protocol › Changes lists as
// the owner's edit until a version records it: never a silent change. Loaded on first use (it reads the change synthesis). Pure: no store.
import { instrumentOf, registryIndication, usualInstruments, INDICATIONS } from './instruments.mjs';
import { crosswalksFor } from './instrument-crosswalks.mjs';
import { scaleDecision, decisionWords, SCALE_USES } from './scale-names.mjs';
import { outcomeTable, outcomeRows, mapFields, studyLevel } from './outcome-rows.mjs';
import { changeSets } from './change-synthesis.mjs';
import { governed } from './protocol-fields.mjs';
import { lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";

const str = v => String(v ?? '').trim();
const NONE = { code: '', label: 'Indication not recorded', term: null, parents: [] };

/**
 * The scales of a project's outcome table: { table, fields, scales, unused, uncoded }. `scales` lists each scale its included studies' outcomes
 * are coded to, most studies first, then the project's own scales no study uses yet: the registry entry with { known, studies, arms,
 * byIndication: [{ code, label, studies, arms }], decision }. `unused` lists, per registry indication the review reaches, the scales that
 * usually serve it and that no study used. `uncoded` counts the studies with outcomes none of which is coded to a scale. `fields` are the instrument map's.
 */
export function scalesInUse(s, { table = null, fields = null } = {}) {
  const t = outcomeTable(s, table);
  if (!t) return { table: null, fields: { indication: '', procedure: '' }, scales: [], unused: [], uncoded: 0 };
  const F = fields || mapFields(s, t), V = s.values || {}, by = new Map(), indOf = new Map(), usedIn = new Map(), seen = new Set(), coded = new Set();
  for (const r of outcomeRows(s, { table: t.id })) {
    seen.add(r.paper_id);
    if (!r.instrument) continue;
    coded.add(r.paper_id);
    if (!indOf.has(r.paper_id)) indOf.set(r.paper_id, studyLevel(s, t, V, r.paper_id, F.indication) || NONE);
    const ind = indOf.get(r.paper_id), arm = `${r.paper_id}@${r.arm || ''}`;
    if (!by.has(r.instrument)) by.set(r.instrument, { studies: new Set(), arms: new Set(), ind: new Map() });
    const g = by.get(r.instrument);
    if (!g.ind.has(ind.code)) g.ind.set(ind.code, { code: ind.code, label: ind.label, studies: new Set(), arms: new Set() });
    const gi = g.ind.get(ind.code);
    g.studies.add(r.paper_id); g.arms.add(arm); gi.studies.add(r.paper_id); gi.arms.add(arm);
    if (!usedIn.has(ind.code)) usedIn.set(ind.code, { ind, codes: new Set() });
    usedIn.get(ind.code).codes.add(r.instrument);
  }
  const entry = (code, g) => {
    const x = instrumentOf(s, code);
    return { ...(x || { code, label: code, name: '', domain: '', min: null, max: null, higher: null, rater: '', aliases: [], indications: [], builtIn: false }),
      known: !!x, studies: g ? g.studies.size : 0, arms: g ? g.arms.size : 0,
      byIndication: g ? [...g.ind.values()].map(i => ({ code: i.code, label: i.label, studies: i.studies.size, arms: i.arms.size }))
        .sort((a, b) => b.studies - a.studies || a.label.localeCompare(b.label)) : [],
      decision: scaleDecision(s, code) };
  };
  const used = [...by.entries()].map(([code, g]) => entry(code, g)).sort((a, b) => b.studies - a.studies || a.label.localeCompare(b.label));
  // the project's own scales that no study uses yet stay listed, so they can be edited
  const own = (Array.isArray(s.instruments) ? s.instruments : []).map(x => str(x?.code)).filter(c => c && !by.has(c) && instrumentOf(s, c));
  const scales = [...used, ...[...new Set(own)].map(c => entry(c, null)).sort((a, b) => a.label.localeCompare(b.label))];
  // the registry's indications the review reaches: those its indication levels name, and those the scales its studies used usually serve (a
  // class such as "Movement disorder" names none, its UPDRS-III serves Parkinson's disease); for each, its usual scales that no study used
  const reached = new Set();
  for (const { ind } of usedIn.values()) { const reg = ind.term ? registryIndication(ind.term, ind.parents) : registryIndication(ind.label); if (reg) reached.add(reg); }
  for (const x of used) for (const c of x.indications || []) reached.add(c);
  const unused = [...reached].map(code => ({ indication: { code, label: INDICATIONS.find(i => i.code === code)?.label || code },
    scales: usualInstruments(s, code).filter(x => !by.has(x.code)).map(x => ({ code: x.code, label: x.label })) }))
    .filter(x => x.scales.length).sort((a, b) => a.indication.label.localeCompare(b.indication.label));
  return { table: t.id, fields: F, scales, unused, uncoded: [...seen].filter(p => !coded.has(p)).length };
}

// ---- decisions -----------------------------------------------------------------------------------------------------------------------
const SOURCE = 'scales:';
const same = (a, b) => a.use === b.use && (a.to || '') === (b.to || '') && (a.crosswalk || '') === (b.crosswalk || '');
const recordedKey = a => `${a?.at}\u0000${a?.note}`;

/**
 * Records what the review does with a scale (a reducer on the store's draft): next is { use, to?, crosswalk? } (lib/scale-names.mjs SCALE_USES); 'own'
 * removes the stored decision; `by` and `why` are kept with it when given. Returns { error: '' | why it was refused, filed: whether an amendment was filed, rewritten or withdrawn }.
 */
export function decideScale(s, code, next, { at = new Date().toISOString(), by = '', why = '' } = {}) {
  const use = next?.use;
  if (!SCALE_USES.some(u => u.id === use)) return { error: 'Choose what to do with the scale.', filed: false };
  if (use === 'convert' && (!next.to || next.to === code || !instrumentOf(s, next.to))) return { error: 'Choose the scale to convert to.', filed: false };
  // a conversion names its crosswalk (W3): the one chosen when it is for this pair, else the pair's first; none when the pair has none
  const xs = use === 'convert' ? crosswalksFor(s, code, next.to) : [], cw = (xs.find(x => x.id === next.crosswalk) || xs[0])?.id;
  const want = { use, ...(use === 'convert' ? { to: next.to, ...(cw ? { crosswalk: cw } : {}) } : {}) };
  if (same(scaleDecision(s, code), want)) return { error: '', filed: false };
  const wasGoverned = governed(s);
  s.synthesis ||= {};
  const all = { ...(s.synthesis.scales || {}) };
  // who decided and why, when a change file says so (change-file.mjs decide_scale); the app's radios record the time only
  if (use === 'own') delete all[code]; else all[code] = { ...want, at, ...(by ? { by: String(by).slice(0, 80) } : {}), ...(why ? { why: String(why).slice(0, 600) } : {}) };
  s.synthesis.scales = all;
  return { error: '', filed: wasGoverned ? fileAmendment(s, code, want, at) : false };
}
/**
 * One open amendment per scale: written when the decision leaves what the last version recorded (pooled on its own when no version
 * recorded one), rewritten while it waits, withdrawn when the decision returns to it. Returns whether the amendments changed.
 */
function fileAmendment(s, code, want, at) {
  s.protocol ||= { pico: {}, criteria: [], amendments: [] };
  const list = [...(s.protocol.amendments || [])], src = `${SOURCE}${code}`;
  const recorded = new Set(((s.protocolVersions || []).at(-1)?.protocol?.amendments || []).map(recordedKey));
  const open = list.findIndex(a => a?.source === src && !recorded.has(recordedKey(a)));
  const last = [...list].reverse().find(a => a?.source === src && recorded.has(recordedKey(a)));
  const registered = last?.decision?.use ? last.decision : { use: 'own' };
  if (same(registered, want)) {
    if (open < 0) return false;
    list.splice(open, 1); s.protocol.amendments = list; return true;
  }
  const x = instrumentOf(s, code), name = x?.name && x.name !== x.label ? ` (${x.name})` : '';
  const note = `Outcome scales: ${x?.label || code}${name} is ${decisionWords(s, want)}; it was ${decisionWords(s, registered)}.`;
  const a = { at, note, source: src, decision: want };
  if (open >= 0) list[open] = a; else list.push(a);
  s.protocol.amendments = list;
  return true;
}

// ---- what the change synthesis can pool --------------------------------------------------------------------------------------------
export const OUT_REASONS = Object.freeze({ unread: 'not read by the analysis', sham: 'no sham arm', overlap: 'same patients as another study',
  withdrawal: 'randomized withdrawal', direction: 'direction not known', change: 'no mean change', sd: 'no baseline SD', n: 'fewer than 3 patients',
  model: 'model-based change with a baseline SD from an SE', effect: 'effect not computable' });
/** Why none of a study's arms of a scale enters the primary pool: the first reason its sham arms give (a key of OUT_REASONS). */
function reasonOf(arms) {
  const sham = arms.filter(a => a.arm_role === 'sham');
  if (!sham.length) return 'sham';
  const own = sham.filter(a => !a.overlap_secondary);
  if (!own.length) return 'overlap';
  const a = own.find(x => x.design !== 'randomized-withdrawal');
  if (!a) return 'withdrawal';
  if (a.dir == null) return 'direction';
  if (a.change_used == null) return 'change';
  if (!(a.baseline_sd > 0)) return 'sd';
  if (a.n == null || a.n <= 2) return 'n';
  if (a.ls_mean_change && a.baseline_sd_converted) return 'model';
  return 'effect';
}
/**
 * What the change synthesis can pool of each scale, by the synthesis' own sets (lib/change-synthesis.mjs changeSets) over its rows before
 * any decision (lib/change-records.mjs changeInputs rows): { [code]: { studies, enter, change: { printed, computed }, baselineSd: { sd, se },
 * r: { trial, assumed }, out: { [reason]: n } } }, counted per study. A study enters when one of its sham arms of the scale is in the
 * primary set; its counts are that arm's. A study that does not enter is counted once, under the first reason its arms give.
 */
export function scalePoolReadiness(rows, { assumedR = 0.5 } = {}) {
  if (!rows?.arms?.length) return {};
  const sets = changeSets(rows, { assumedR }), prim = new Set(sets.prim), by = new Map();
  for (const a of sets.all) {
    if (!a.instrument) continue;
    if (!by.has(a.instrument)) by.set(a.instrument, new Map());
    const g = by.get(a.instrument);
    if (!g.has(a.paper_id)) g.set(a.paper_id, []);
    g.get(a.paper_id).push(a);
  }
  const out = {};
  for (const [code, studies] of by) {
    const o = { studies: studies.size, enter: 0, change: { printed: 0, computed: 0 }, baselineSd: { sd: 0, se: 0 }, r: { trial: 0, assumed: 0 }, out: {} };
    for (const arms of studies.values()) {
      const a = arms.find(x => prim.has(x));
      if (!a) { const why = reasonOf(arms); o.out[why] = (o.out[why] || 0) + 1; continue; }
      o.enter++;
      o.change[a.change_source === 'printed change' ? 'printed' : 'computed']++;
      o.baselineSd[a.baseline_sd_converted ? 'se' : 'sd']++;
      o.r[a.r_trial != null ? 'trial' : 'assumed']++;
    }
    out[code] = o;
  }
  return out;
}
/**
 * The key line of a scale: "Can enter the pool: 13 of 15 studies. Change: 10 printed, 3 end minus baseline. Baseline SD: 11 reported, 2 from
 * an SE. Correlation: 3 from the trial, 10 assumed 0.5. Not entering: 1 no baseline SD, 1 randomized withdrawal." `of` is the scale's
 * studies as the summary counts them; a study the analysis does not read is counted as such. '' without readiness.
 */
export function readinessText(o, of, { assumedR = 0.5 } = {}) {
  if (!o && !of) return '';
  const r = o || { studies: 0, enter: 0, change: {}, baselineSd: {}, r: {}, out: {} }, total = Math.max(of || 0, r.studies);
  const out = { ...r.out }; if (total > r.studies) out.unread = total - r.studies;
  const list = (pairs) => pairs.filter(([n]) => n > 0).map(([n, w]) => `${num(n)} ${w}`).join(', ');
  const parts = [`Can enter the pool: ${num(r.enter)} of ${plural(total, 'study', 'studies')}`];
  if (r.enter) {
    parts.push(`Change: ${list([[r.change.printed, 'printed'], [r.change.computed, 'end minus baseline']])}`);
    parts.push(`Baseline SD: ${list([[r.baselineSd.sd, 'reported'], [r.baselineSd.se, 'from an SE']])}`);
    parts.push(`Correlation: ${list([[r.r.trial, 'from the trial'], [r.r.assumed, `assumed ${assumedR}`]])}`);
  }
  const outs = Object.entries(out).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (outs.length) parts.push(`Not entering: ${outs.map(([k, n]) => `${num(n)} ${OUT_REASONS[k] || k}`).join(', ')}`);
  return `${parts.join('. ')}.`;
}

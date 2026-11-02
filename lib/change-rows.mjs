// Within-arm change rows read from an evidence table written as text (plan §4.15g, the "Change" family of Syntheses): one row per study ×
// outcome slot × arm with the numbers a standardized mean change needs, each read by a stated rule from its cell, and the flags a sensitivity
// analysis selects on. A port of the sham-response review's tidy builder and analysis-dataset step (Analysis/Scripts/01-build-tidy.mjs,
// cells.mjs, 02-derive-dataset.mjs and 02b-s10-medians.mjs of 1 Nov 2026), so the review's syntheses run in Lykos from the record and follow
// every changed cell. The reading rules for numbers in text (a leading number, "≈" for a figure read, SD or SE from the cell or the slot's
// dispersion field, medians, ranges, IQRs, responders k/n) are general; what is the project's own (arm roles, designs, classes, registry
// wording, primary endpoints, role overrides) is configuration, `s.synthesis.change.rows` (CHANGE_ROWS_DEFAULTS lists the keys). Pure:
// app/test/change-rows.test.mjs checks each rule with fixed cells.
import { derivedOverall, projectRule } from './rob-overall.mjs';
import { qnorm } from './dist.mjs';

// ---- reading numbers in cells (cells.mjs) -----------------------------------------------------------------------------------------
export const isMissing = s => !s || /^(NR|NA|not reported|not applicable)\b/i.test(String(s).trim());
const toAscii = s => String(s).replace(/[−–]/g, '-');
const NUM = '[−\\-–+]?\\d+(?:\\.\\d+)?';
/** The leading number of a cell: { v, approx, label, raw } or null. Accepts "≈−3.5 (...)", "median 7", "12 (SE)", "29.7 days ...". */
export function leadNumber(s) {
  const m = String(s).trim().match(new RegExp(`^(?:(median|mean|Mean|Median)\\s+)?(≈)?\\s?(${NUM})(?![\\d/])`));
  if (!m) return null;
  return { v: Number(toAscii(m[3]).replace('+', '')), approx: !!m[2], label: (m[1] || '').toLowerCase(), raw: m[3] };
}
/** Weeks from the first duration in a time text: { weeks, token, factor, n } or null. */
export function weeksOf(s) {
  const t = String(s);
  const pats = [[/(\d+(?:\.\d+)?)[- ](?:weeks?|wk)\b/i, 1], [/\bweek[- ](\d+(?:\.\d+)?)/i, 1], [/(\d+(?:\.\d+)?)[- ]months?\b/i, 52.143 / 12],
    [/\bmonth[- ](\d+(?:\.\d+)?)/i, 52.143 / 12], [/(\d+(?:\.\d+)?)[- ]days?\b/i, 1 / 7], [/\bday[- ](\d+(?:\.\d+)?)/i, 1 / 7]];
  let best = null;
  for (const [rx, f] of pats) { const m = t.match(rx); if (m && (best == null || m.index < best.i)) best = { i: m.index, n: Number(m[1]), f, token: m[0] }; }
  return best ? { weeks: Math.round(best.n * best.f * 100) / 100, token: best.token, factor: best.f, n: best.n } : null;
}
/** A dispersion field cut at its top-level semicolons. */
export function segments(d) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(d)) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function segType(s) {
  if (/probably SD|behaves as SE|type not stated|unstated type|^half-width|^≈/.test(s)) return 'unclear';
  if (/^SD\b/.test(s)) return 'SD'; if (/^SE\b/.test(s)) return 'SE'; if (/^IQR/.test(s)) return 'IQR';
  if (/^range/i.test(s)) return 'range'; if (/^95% CI/.test(s)) return 'CI'; if (/^None/i.test(s) || /^no dispersion/i.test(s)) return 'none';
  return 'unclear';
}
function segScope(s) {
  const t = s.replace(/percentage change|percent change/gi, ' '), sc = [];
  if (/baseline/i.test(t)) sc.push('baseline');
  if (/\bend\b|ON month/i.test(t)) sc.push('end');
  if (/change|improvement|reduction|decline/i.test(t)) sc.push('change');
  return sc;
}
/** The dispersion type the slot's dispersion field gives a column (baseline, end, change): SD, SE, IQR, range, CI, none, unclear, or ''. */
export function dispFor(d, col) {
  if (isMissing(d)) return '';
  const segs = segments(d).map(s => ({ s, type: segType(s), scope: segScope(s) }));
  const scoped = segs.find(x => x.scope.includes(col)); if (scoped) return scoped.type;
  const unscoped = segs.find(x => !x.scope.length); if (unscoped) return unscoped.type;
  return '';
}
/** An SD column's cell: { sd, type, approx, conv, computed, note, se?, n? }; an SE becomes an SD by √n only when n is known exactly. */
export function sdCell(text, col, disp, n, nKnown) {
  const out = { sd: null, type: 'none', approx: false, conv: false, computed: false, note: '' };
  if (isMissing(text)) return out;
  if (/IQR/.test(text)) return { ...out, type: 'IQR' };
  if (/\bCI\b/.test(text)) return { ...out, type: 'CI' };
  if (/\brange\b/.test(text) || /^≈?[−\-–]?\d+(\.\d+)?\s?(–|to)\s?≈?[−\-–+]?\d/.test(text)) return { ...out, type: 'range' };
  if (/^L /.test(text)) return { ...out, type: 'unclear', note: 'left and right values' };
  if (/behaves as SE|type not stated|half-length/.test(text)) return { ...out, type: 'unclear', note: 'error bar type unclear' };
  const ln = leadNumber(text);
  if (!ln) return { ...out, type: 'unclear' };
  out.approx = ln.approx; out.computed = /computed|SD of the/.test(text);
  let type = /\(SE\)|\bSEM\b|\(SE,|\bSE\b/.test(text) ? 'SE' : /\(SD of|computed/.test(text) ? 'SD' : null;
  if (!type) {
    const d = dispFor(disp, col), scoped = segments(disp).some(x => segScope(x).includes(col));
    if (d === '') { type = 'SD'; out.note = 'dispersion field NR; read as SD (column)'; }
    else if (d === 'SE' && !scoped) return { ...out, type: 'unclear', note: 'bare number; the dispersion field says SE for the whole slot but the cell does not (SD or SE unclear)' };
    else type = d;
  }
  out.type = type;
  if (type === 'SD') { out.sd = ln.v; return out; }
  if (type === 'SE') {
    if (n != null && nKnown) Object.assign(out, { sd: Math.round(ln.v * Math.sqrt(n) * 10000) / 10000, conv: true, se: ln.v, n });
    else out.note = 'SE without a usable n';
    return out;
  }
  out.note = `number in SD column but dispersion field says ${type}`;
  return out;
}
/** A mean column's cell: { v, approx, f: [flags] }. A rate per month, several values, a single patient or a percent of baseline is flagged. */
export function meanCell(text) {
  const f = [];
  if (isMissing(text)) return { v: null, f };
  if (/^L /.test(text) || /first patient\); /.test(text) || /^\d+ (of \d+ )?positive/.test(text) || /^Pooled/.test(text)) return { v: null, f: ['several values or not a mean'] };
  if (/decline,? (points|%) per month|per month\)$/.test(text) && /decline/.test(text)) return { v: null, f: ['rate of decline per month, not a change from baseline'] };
  if (/^≈?[−\-–+]?\d+(\.\d+)? per month\b/.test(text)) return { v: null, f: ['rate of decline per month, not a change from baseline (rate per month)'] };
  const ln = leadNumber(text); if (!ln) return { v: null, f: ['not a number'] };
  if (/median/i.test(text) && !/mean of/i.test(text) && !/^≈?[−\-–+]?\d+(\.\d+)? \(mean/i.test(text) || ln.label === 'median') f.push('median');
  if (/LS mean|MMRM|regression coefficient/.test(text)) f.push('model-based');
  if (/% of (each patient's )?.*baseline/.test(text)) f.push('percent of baseline scale');
  if (/\(patient \d|\bN\d\b|patient \d\)/.test(text)) f.push('single patient');
  return { v: ln.v, approx: ln.approx, f };
}
export function nCell(text) {
  if (isMissing(text)) return { n: null, known: false, f: [] };
  const a = text.match(/^(\d+) assessments in (\d+) patients/);
  if (a) return { n: Number(a[2]), known: true, f: ['n: assessments pooled; patients given'] };
  const ln = leadNumber(text); if (!ln || !Number.isInteger(ln.v)) return { n: null, known: false, f: ['n not a count'] };
  return { n: ln.v, known: !ln.approx, approx: ln.approx, f: [] };
}
export function respondersCell(text) {
  if (isMissing(text)) return { k: null, n: null, def: '' };
  let m = text.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (m) return { k: Number(m[1]), n: Number(m[2]), def: m[3].replace(/^\((.*)\)$/, '$1').replace(/^;\s*/, '').trim() };
  m = text.match(/^(\d+) \((.*)\)$/);
  if (m && !/%\s*\(/.test(text)) return { k: Number(m[1]), n: null, def: m[2] };
  return { k: null, n: null, def: '', f: 'responders not as k/n' };
}
export function percentCell(text, dir, slotSigned) {
  if (isMissing(text)) return { v: null, basis: 'NA' };
  if (/of baseline/.test(text)) return { v: null, basis: 'NA', f: 'percent of baseline, not a percent change' };
  const ln = leadNumber(text); if (!ln) return { v: null, basis: 'NA', f: 'percent change not a number' };
  const flags = []; if (ln.label === 'median' || /\(median/.test(text)) flags.push('percent change median');
  const lower = /^Lower/.test(dir), signed = /^[≈]?[−\-–+]/.test(ln.raw ? text.replace(/^(median |mean )/i, '') : text);
  let flip = false, basis = 'signed change';
  if (/positive = (pain )?reduction|negative = (pain )?increase/.test(text)) { flip = true; basis = 'improvement positive (sign flipped)'; }
  else if (/negative = reduction/.test(text) || signed) basis = 'signed change';
  else if (/percent change|percentage change/.test(text) || slotSigned) basis = 'signed change';
  else if (/reduction/.test(text)) { flip = true; basis = 'reduction positive (sign flipped)'; }
  else if (/improvement/.test(text)) { flip = lower; basis = lower ? 'improvement positive (sign flipped)' : 'improvement positive (higher is better, sign kept)'; }
  else return { v: null, basis: 'NA', f: 'percent change sign convention not stated' };
  return { v: flip ? -ln.v : ln.v, approx: ln.approx, basis, flip, flags };
}

// ---- the project's own rules ------------------------------------------------------------------------------------------------------
/**
 * The configuration keys and their defaults. Patterns are regular-expression sources, or { pattern, flags }; roles are tried in order.
 * `design.withdrawal` reads the design column; `design.withdrawalStudies` names studies instead (the review's list before the design column
 * coded it). `levels.<facet>` maps a column's text to a level by the first matching pattern ('NA' when none matches).
 */
export const CHANGE_ROWS_DEFAULTS = Object.freeze({
  table: null, slots: ['o1', 'o2', 'o3'],
  fields: { study: 'study', id: 'column', reports: 'reports', registration: 'registration', design: 'design', randomized: 'randomized_n',
    indicationClass: 'indication_class', procedureClass: 'procedure_class', shamType: 'sham_type', blindedWeeks: 'sham_phase_weeks',
    weeksToSham: 'weeks_surgery_to_sham', openLabel: 'pre_randomization_open_stimulation', funding: 'funding', primaryMet: 'primary_endpoint_met',
    sae: 'serious_adverse_events' },
  roles: [], defaultRole: 'active', roleOverrides: {}, pairs: {}, subtherapeutic: null,
  design: { withdrawal: null, withdrawalStudies: [], crossover: '^Crossover', nOf1MaxRandomized: 2 },
  levels: {}, registry: { only: [], sourced: [], supplemented: [] }, primaryEndpoint: {},
  rob: { instrument: 'rob2', domains: ['d1', 'd2', 'd3', 'd4', 'd5'], rule: null },
});
const rx = (p, flags = '') => (p == null ? null : typeof p === 'string' ? new RegExp(p, flags) : new RegExp(p.pattern, p.flags || ''));
const anyOf = (list, s) => (list || []).some(p => rx(p).test(s));
/** The configuration with its defaults filled in. */
export function changeRowsConfig(cfg = {}) {
  const d = CHANGE_ROWS_DEFAULTS;
  return { ...d, ...cfg, fields: { ...d.fields, ...(cfg.fields || {}) }, design: { ...d.design, ...(cfg.design || {}) }, registry: { ...d.registry, ...(cfg.registry || {}) },
    rob: { ...d.rob, ...(cfg.rob || {}) }, levels: { ...(cfg.levels || {}) }, roleOverrides: { ...(cfg.roleOverrides || {}) }, pairs: { ...(cfg.pairs || {}) } };
}
const levelOf = (rules, text) => { for (const [p, level] of rules || []) if (rx(p).test(text)) return level; return 'NA'; };

function period(r) {
  if (r.design !== 'crossover' && r.design !== 'n-of-1') return 'NA';
  const t = `${r.arm_label} ${r.time_text}`;
  if (/pooled|both sequences|all patients|all participants|off periods each|each blinded|each \d|of each/i.test(t)) return 'all periods';
  if (/Period I\b|period 1\b|first period|first crossover period|first 3-month|sham in the first period/i.test(t)) return 'first period';
  return 'not stated';
}
const num = x => (x === null || x === undefined || x === '' || Number.isNaN(x)) ? null : Number(x);
const flagHas = (r, re) => re.test(r.flags || '');

/** Several arms combined into one group (Cochrane Handbook 6.5.2.10): { n, m, sd, k } or null. */
export function combineArms(list, mKey, sdKey) {
  const ok = list.filter(a => a.n > 0 && a[mKey] != null && a[sdKey] != null);
  if (!ok.length) return null;
  let N = ok[0].n, M = ok[0][mKey], SD = ok[0][sdKey];
  for (const a of ok.slice(1)) {
    const N2 = N + a.n, M2 = (N * M + a.n * a[mKey]) / N2;
    SD = Math.sqrt(((N - 1) * SD ** 2 + (a.n - 1) * a[sdKey] ** 2 + N * a.n / N2 * (M - a[mKey]) ** 2) / (N2 - 1));
    N = N2; M = M2;
  }
  return { n: N, m: M, sd: SD, k: ok.length };
}

/** The cells of one included study's arms and slots, read into tidy rows. */
function studyRowsOf(s, cfg, id, r, arms, overlapOf, helpers) {
  const F = cfg.fields, { roleOf, sub, regOnly, regSourced, regSupp, withdrawal, withdrawalList, crossover, robTool, robRule } = helpers;
  const pp = (s.papers || []).find(p => p.id === id), g0 = f => r[f]?.v ?? '', out = [];
  const study = regOnly(g0(F.reports)) ? (g0(F.registration).match(/NCT\d{8}/) || [g0(F.study)])[0] : g0(F.study) || pp.label;
  const designRec = g0(F.design), randN = leadNumber(g0(F.randomized))?.v;
  const isRW = withdrawalList.has(study) || (withdrawal ? withdrawal.test(designRec) : false);
  const design = isRW ? 'randomized-withdrawal' : crossover.test(designRec) ? (randN != null && randN <= cfg.design.nOf1MaxRandomized ? 'n-of-1' : 'crossover') : 'parallel';
  const rob = s.assessments?.[id]?.[cfg.rob.instrument];
  const robOverall = rob ? (derivedOverall(robTool, rob, robRule).value ?? 'NA') : 'NA', robAlgorithm = rob ? (derivedOverall(robTool, rob).value ?? 'NA') : 'NA';
  const bw = g0(F.blindedWeeks), blinded = /^≈?\d+(\.\d+)?(\s|$)/.test(bw) && !/^\S+ to /.test(bw) ? leadNumber(bw) : null;
  const wsRaw = g0(F.weeksToSham), ws = /^≈?\d+(\.\d+)?( \((?![^)]*(sequence|first|second|if |or \d))[^)]*\))?$/.test(wsRaw) ? leadNumber(wsRaw) : null;
  const ol = g0(F.openLabel), fund = g0(F.funding), pem = g0(F.primaryMet);
  for (const a of arms) {
    const role = cfg.roleOverrides[`${study}|${a.id}`] ?? roleOf(a.label);
    for (const o of cfg.slots) {
      const cell = f => r[`${o}_${f}@${a.id}`] ?? { v: '', key: '' };
      const outcome = cell('outcome').v;
      if (isMissing(outcome)) continue;
      const flags = [], use = f => cell(f).v;
      const dir = use('direction'), rater = use('rater'), disp = use('dispersion');
      const bm = meanCell(use('baseline_mean')), em = meanCell(use('end_mean')), cm = meanCell(use('change_mean'));
      const bn = nCell(use('baseline_n')), en = nCell(use('end_n'));
      const bsd = sdCell(use('baseline_sd'), 'baseline', disp, bn.n, bn.known), esd = sdCell(use('end_sd'), 'end', disp, en.n, en.known);
      const csd = sdCell(use('change_sd'), 'change', disp, en.n ?? bn.n, en.n != null ? en.known : bn.known);
      for (const [nm, x] of [['baseline_mean', bm], ['end_mean', em], ['change_mean', cm]]) for (const f of x.f || []) flags.push(`${nm}: ${f}`);
      for (const [nm, x] of [['baseline_sd', bsd], ['end_sd', esd], ['change_sd', csd]]) { if (x.note) flags.push(`${nm}: ${x.note}`); if (x.conv) flags.push(`${nm}: SE ${x.se} x sqrt(${x.n})`); }
      for (const [nm, x] of [['baseline_n', bn], ['end_n', en]]) for (const f of x.f) flags.push(`${nm}: ${f}`);
      const ctext = cell('change_mean').v;
      let change = cm.v, flipped = false;
      if (change != null && /improvement|decrease from baseline/.test(ctext) && !/end − baseline|minus/.test(ctext)
        && (/decrease from baseline/.test(ctext) || /^Lower/.test(dir))) { change = -change; flipped = true; flags.push('change_mean: printed as improvement (positive = decrease); sign flipped to end − baseline'); }
      if (/not from the pre-operative baseline|from the start of the blinded phase|month 1 to month 4/.test(ctext)) flags.push('change_mean: from the start of the blinded phase, not the pre-operative baseline');
      if (change != null && bm.v != null && em.v != null) {
        const d = em.v - bm.v;
        if (Math.abs(d) > 0.05 && Math.sign(d) !== Math.sign(change) && Math.abs(Math.abs(change) - Math.abs(d)) <= Math.max(0.15, 0.1 * Math.abs(d)))
          flags.push('change_mean: sign opposite to end − baseline (looks improvement-positive; convention not stated in the cell)');
        else if (Math.abs(d - change) > Math.max(0.15, 0.06 * Math.abs(d))) flags.push(`change_mean: differs from end − baseline (${Math.round(d * 100) / 100})`);
      }
      const slotSigned = arms.some(b => /^≈?[−\-–+]/.test((r[`${o}_percent_change@${b.id}`]?.v || '').trim()));
      const pc = percentCell(use('percent_change'), dir, slotSigned);
      if (pc.f) flags.push(`percent_change: ${pc.f}`);
      for (const f of pc.flags || []) flags.push(f);
      const rs = respondersCell(use('responders'));
      if (rs.f) flags.push(rs.f);
      const time = use('time'), tw = weeksOf(time);
      if (tw) flags.push(`timepoint from "${tw.token}"`);
      const bt = use('baseline_timing');
      const btiming = /^Pre-operative/.test(bt) ? 'pre-operative' : /^Post-operative/.test(bt) ? 'post-operative' : isMissing(bt) && !/^NA/.test(bt) ? 'NA' : 'other';
      const anyMean = [bm, em, cm].some(x => x.v != null);
      const loc = !anyMean ? 'NA' : [bm, em, cm].some(x => (x.f || []).includes('median')) || /medians|median and (IQR|interquartile)|values are medians/i.test(disp) ? 'median'
        : /^(IQR|range)\b/.test(disp) && !/mean/i.test(disp) ? 'unclear' : 'mean';
      if (loc === 'unclear') flags.push('location: dispersion is IQR or range and the cells do not say mean or median');
      const ipdTexts = ['baseline_mean', 'baseline_sd', 'end_mean', 'end_sd', 'change_mean', 'change_sd', 'percent_change', 'responders'].map(f => cell(f).v);
      const approxAny = [bm, em, cm].some(x => x.approx) || [bsd, esd, csd].some(x => x.sd != null && x.approx) || (pc.v != null && pc.approx);
      if (role === 'NA') flags.push('arm labels NR in the table: sham arm not identified');
      out.push({
        paper_id: id, study_id: Number(g0(F.id)), trial: study, arm: a.id, arm_label: a.label, arm_role: role, design, design_recorded: designRec,
        indication_class: g0(F.indicationClass), procedure_class: levelOf(cfg.levels.procedure_class, g0(F.procedureClass)), sham_type: levelOf(cfg.levels.sham_type, g0(F.shamType)),
        outcome_slot: o, outcome, outcome_type: /^Clinician/.test(rater) ? 'clinician-rated' : /^Patient/.test(rater) ? 'patient-reported' : /^Objective/.test(rater) ? 'objective' : 'NA',
        is_seizure_count: /seizure|GTCS|FIAS|\bFAS\b/i.test(outcome) && !/severity|LSSS|Liverpool/i.test(outcome),
        direction: /^Lower/.test(dir) ? 'lower_better' : /^Higher/.test(dir) ? 'higher_better' : 'NA', time_text: time, timepoint_weeks: tw ? tw.weeks : null,
        baseline_mean: bm.v, baseline_sd: bsd.sd, baseline_n: bn.n, baseline_timing: btiming, end_mean: em.v, end_sd: esd.sd, end_n: en.n, change_mean: change, change_sd: csd.sd,
        location: loc, se_converted: [bsd, esd, csd].some(x => x.conv), baseline_sd_converted: bsd.conv, change_sign_flipped: flipped,
        responders_k: rs.k, responders_n: rs.n, responder_definition: rs.def, percent_change: pc.v, percent_change_basis: pc.basis,
        is_primary_endpoint: cfg.primaryEndpoint[`${study}|${o}`] ?? null, figure_read: approxAny,
        computed_from_ipd: ipdTexts.some(x => /computed|SD of the \d+|SD of the (four|five|six)|mean of (the )?(\d+|four|five|six) (individual|per-patient|printed per-patient)|mean of per-patient|mean of figure reads/i.test(x)),
        blinded_weeks: blinded ? blinded.v : null, weeks_surgery_to_sham: ws ? ws.v : null, open_label_before: /^Yes/.test(ol) ? 'yes' : /^No/.test(ol) ? 'no' : 'NA',
        funding: /^Mixed/.test(fund) ? 'mixed' : /^Non-industry/.test(fund) ? 'non-industry' : /^Industry/.test(fund) ? 'industry' : 'NA',
        registry_only: regOnly(g0(F.reports)), registry_sourced: regSourced(g0(F.reports)), registry_supplemented: regSupp(g0(F.reports)),
        rob_overall: robOverall, rob_overall_algorithm: robAlgorithm, subtherapeutic_control: role === 'sham' && !!sub && sub.test(a.label),
        overlap_group: overlapOf[id]?.group ?? '', overlap_secondary: !!overlapOf[id]?.secondary, ls_mean_change: (cm.f || []).includes('model-based'),
        year: Number((pp?.year || String(study).match(/\d{4}/)?.[0]) ?? '') || null, primary_endpoint_met: /^Yes/.test(pem) ? 'yes' : /^No/.test(pem) ? 'no' : null,
        sae_cell: String(r[`${F.sae}@${a.id}`]?.v ?? ''), flags: flags.join('; '),
      });
    }
  }
  return out;
}

/**
 * The rows of a project: { arms (one per study × slot × arm, with every derived quantity), pairs (one per study × slot × sham arm, with its
 * matched active group), medians (sham medians with both quartiles, converted), table, config }. `s` is the project state.
 */
export function changeRows(s, config = s?.synthesis?.change?.rows || {}) {
  const cfg = changeRowsConfig(config);
  const t = (s.templates || []).find(x => x.id === cfg.table) || (s.templates || [])[0];
  if (!t) return { arms: [], pairs: [], medians: [], table: null, config: cfg };
  const T = t.id, papers = new Set((s.papers || []).filter(p => !p.reportOf).map(p => p.id)), by = {}, pre = `:${T}.`;
  for (const [k, v] of Object.entries(s.values || {})) {
    const i = k.indexOf(pre); if (i < 0) continue;
    (by[k.slice(0, i)] ??= {})[k.slice(i + pre.length)] = { v: String(v?.reported_value ?? '').trim(), key: k };
  }
  const overlapOf = {};
  for (const g of s.synthesis?.overlap || []) for (const id of g.studies) overlapOf[id] = { group: g.id, secondary: id !== g.keep };
  const roles = cfg.roles.map(x => ({ role: x.role, re: rx(x.pattern, x.flags || '') }));
  const helpers = {
    roleOf: l => (roles.find(x => x.re.test(l))?.role ?? cfg.defaultRole), sub: cfg.subtherapeutic ? rx(cfg.subtherapeutic, 'i') : null,
    regOnly: x => anyOf(cfg.registry.only, x), withdrawal: cfg.design.withdrawal ? rx(cfg.design.withdrawal) : null,
    withdrawalList: new Set(cfg.design.withdrawalStudies || []), crossover: rx(cfg.design.crossover),
    robTool: { id: cfg.rob.instrument, domains: cfg.rob.domains.map(id => ({ id })) }, robRule: cfg.rob.rule || projectRule(cfg.rob.instrument) };
  helpers.regSourced = x => helpers.regOnly(x) || anyOf(cfg.registry.sourced, x);
  helpers.regSupp = x => !helpers.regSourced(x) && anyOf(cfg.registry.supplemented, x);
  const rows = [];
  for (const [id, r] of Object.entries(by)) {
    if (!papers.has(id) || s.fulltext?.[id]?.decision !== 'include') continue;
    rows.push(...studyRowsOf(s, cfg, id, r, t.arms?.[id] || [], overlapOf, helpers));
  }
  rows.sort((a, b) => a.study_id - b.study_id || a.outcome_slot.localeCompare(b.outcome_slot) || a.arm.localeCompare(b.arm));
  const arms = rows.map(deriveArm);
  return { arms, pairs: pairRows(arms, cfg.pairs), medians: medianRows(arms, by), table: T, config: cfg };
}

// ---- the analysis quantities (02-derive-dataset.mjs) -----------------------------------------------------------------------------
function deriveArm(r) {
  const dir = r.direction === 'lower_better' ? -1 : r.direction === 'higher_better' ? 1 : null;
  const bm = num(r.baseline_mean), em = num(r.end_mean), cm = num(r.change_mean);
  const meanOk = r.location === 'mean' && !flagHas(r, /baseline_mean: percent of baseline scale|single patient|several values/);
  // the printed change unless its sign is opposite to end − baseline or it is not from the pre-operative baseline; then end − baseline
  let change = null, change_source = 'none';
  const cmBad = flagHas(r, /change_mean: (sign opposite|from the start of the blinded phase|rate of decline|several values|not a number|median)/);
  const opposite = cm != null && bm != null && em != null && Math.abs(em - bm) > 0.05 && Math.sign(cm) !== Math.sign(em - bm);
  if (meanOk && cm != null && !cmBad && !opposite) { change = cm; change_source = 'printed change'; }
  else if (meanOk && bm != null && em != null && !flagHas(r, /(baseline|end)_mean: (median|several|not a number)/)) { change = Math.round((em - bm) * 1e6) / 1e6; change_source = 'end minus baseline'; }
  const n = num(r.end_n) ?? num(r.baseline_n) ?? num((r.arm_label.match(/\bn=(\d+)/) || [])[1]);
  const n_source = num(r.end_n) != null ? 'end n' : num(r.baseline_n) != null ? 'baseline n' : n != null ? 'arm label' : 'none';
  const bsd = num(r.baseline_sd), esd = num(r.end_sd), csd = num(r.change_sd);
  // the pre–post correlation from the trial: r = (sb² + se² − sc²) / (2 sb se), used when −1 < r < 1
  let r_trial = null;
  if (bsd > 0 && esd > 0 && csd > 0) { const x = (bsd ** 2 + esd ** 2 - csd ** 2) / (2 * bsd * esd); if (x > -1 && x < 1) r_trial = Math.round(x * 1e4) / 1e4; }
  // a least-squares mean change is used only with a printed (not SE-converted) baseline SD
  const smcr_ok = dir != null && change != null && bsd > 0 && n != null && n > 2 && !(r.ls_mean_change && r.baseline_sd_converted);
  return { ...r, design_recorded: /^Delayed/.test(r.design_recorded) ? 'delayed activation' : r.design_recorded.toLowerCase(),
    design3: r.design === 'crossover' ? 'crossover' : /^Delayed/.test(r.design_recorded) ? 'delayed activation' : r.design,
    crossover_period: period(r), outcome_type_seizure_pr: r.is_seizure_count ? 'patient-reported' : r.outcome_type, dir, n, n_source,
    change_used: change, change_source, r_trial, smcr_ok, restricted_baseline_sd: bsd > 0 && Math.max(esd || 0, csd || 0) > 2 * bsd,
    post_operative_baseline: r.baseline_timing === 'post-operative', industry: r.funding === 'industry' || r.funding === 'mixed' ? 1 : r.funding === 'non-industry' ? 0 : null };
}

function pairRows(arms, PAIR) {
  const pairs = [];
  for (const s of arms.filter(a => a.arm_role === 'sham')) {
    const pool = arms.filter(a => a.trial === s.trial && a.outcome_slot === s.outcome_slot && a.arm_role === 'active' && (!PAIR[`${s.trial}|${s.arm}`] || PAIR[`${s.trial}|${s.arm}`].includes(a.arm)));
    if (!pool.length) continue;
    const ch = pool.filter(a => a.smcr_ok && a.baseline_mean != null), chOne = pool.filter(a => a.smcr_ok);
    let act = null;
    if (ch.length) {
      const bs = combineArms(ch, 'baseline_mean', 'baseline_sd'), N = ch.reduce((t, a) => t + a.n, 0);
      act = { n: N, change: ch.reduce((t, a) => t + a.n * a.change_used, 0) / N, bsd: bs.sd, arms: ch.map(a => a.arm).join('+'), r_trial: ch.length === 1 ? ch[0].r_trial : null };
    } else if (chOne.length) {
      const a = [...chOne].sort((x, y) => y.n - x.n)[0];
      act = { n: a.n, change: a.change_used, bsd: a.baseline_sd, arms: a.arm, r_trial: a.r_trial };
    }
    const endA = combineArms(pool.filter(a => a.location === 'mean' && !a.se_converted), 'end_mean', 'end_sd');
    pairs.push({ trial: s.trial, paper_id: s.paper_id, outcome_slot: s.outcome_slot, sham_arm: s.arm, dir: s.dir, design: s.design, design_recorded: s.design_recorded,
      indication_class: s.indication_class, sham_n: s.n, sham_change: s.change_used, sham_bsd: s.baseline_sd, sham_smcr_ok: s.smcr_ok, overlap_secondary: s.overlap_secondary,
      sham_end_mean: s.location === 'mean' && !s.se_converted ? s.end_mean : null, sham_end_sd: s.location === 'mean' && !s.se_converted ? s.end_sd : null,
      active_arms: act?.arms ?? null, active_n: act?.n ?? null, active_change: act?.change ?? null, active_bsd: act?.bsd ?? null, active_r_trial: act?.r_trial ?? null,
      active_end_arms: endA?.k ?? null, active_end_n: endA?.n ?? null, active_end_mean: endA?.m ?? null, active_end_sd: endA?.sd ?? null });
  }
  return pairs;
}

// ---- medians with quartiles (02b-s10-medians.mjs) --------------------------------------------------------------------------------
const normQ = x => String(x ?? '').replace(/[−–]/g, '-').replace(/≈/g, '');
const numsOf = x => (normQ(x).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
function quartiles(cellText, disp, col) {
  const t = normQ(cellText); if (!t || /^NR\b|^NA\b/.test(t)) return null;
  if (/\brange\b|\bCI\b|\bCrI\b|credible|confidence/i.test(t)) return null;
  const iqrHere = /IQR|interquartile/i.test(t);
  const segs = String(disp).split(';').map(x => x.trim()).filter(Boolean);
  const named = segs.find(x => new RegExp(col, 'i').test(x)), plain = segs.find(x => !/baseline|\bend\b|change/i.test(x)), seg = named ?? plain ?? '';
  const iqrDisp = /IQR|interquartile/i.test(seg) && !/\brange\b|\bCI\b|credible/i.test(seg);
  if (!iqrHere && !iqrDisp) return null;
  const m = t.replace(/^IQR\s*/i, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const q1 = Number(m[1]), q3 = Number(m[2]);
  return q3 >= q1 ? { q1, q3, of_improvement: /of the improvement|of the reduction/i.test(t) } : null;
}
/** Luo 2018: the mean from the median and quartiles. */
export const luoMean = (m, q1, q3, n) => (0.7 + 0.39 / n) * (q1 + q3) / 2 + (0.3 - 0.39 / n) * m;
/** Wan 2014: the SD from the quartiles. */
export const wanSd = (q1, q3, n) => (q3 - q1) / (2 * qnorm((0.75 * n - 0.125) / (n + 0.25)));
function medianRows(arms, by) {
  const out = [];
  for (const r of arms) {
    if (r.arm_role !== 'sham' || r.location !== 'median' || r.design === 'randomized-withdrawal') continue;
    const cell = f => String(by[r.paper_id]?.[`${r.outcome_slot}_${f}@${r.arm}`]?.v ?? ''), disp = cell('dispersion');
    const bq = quartiles(cell('baseline_sd'), disp, 'baseline'), eq = quartiles(cell('end_sd'), disp, 'end'), cq = quartiles(cell('change_sd'), disp, 'change');
    const bm = r.baseline_mean, em = r.end_mean, cm = r.change_mean, nB = r.baseline_n ?? r.end_n, nE = r.end_n ?? r.baseline_n;
    if (!/median/i.test(cell('baseline_mean')) && !/Median \(IQR\)|medians/i.test(disp)) continue;
    if (!bq || bm == null || r.dir == null || !(nB > 2) || (!(cq && cm != null) && !(eq && em != null))) continue;
    let c_q1 = null, c_q3 = null, c_m = null;
    if (cq && cm != null) {
      // the change cell's own number as recorded (end − baseline); a quartile pair printed for the improvement is turned round
      c_m = numsOf(cell('change_mean'))[0];
      if (cq.of_improvement) { c_q1 = -cq.q3; c_q3 = -cq.q1; } else { c_q1 = cq.q1; c_q3 = cq.q3; }
      if (!(c_m >= c_q1 && c_m <= c_q3)) continue;
    }
    const b_mean = luoMean(bm, bq.q1, bq.q3, nB), b_sd = wanSd(bq.q1, bq.q3, nB);
    const e_mean = eq && em != null ? luoMean(em, eq.q1, eq.q3, nE) : null;
    out.push({ trial: r.trial, paper_id: r.paper_id, arm: r.arm, outcome_slot: r.outcome_slot, indication_class: r.indication_class, dir: r.dir, n: nE, b_sd,
      c_mean: c_m != null ? luoMean(c_m, c_q1, c_q3, nE) : e_mean - b_mean, change_basis: c_m != null ? 'median change with quartiles' : 'converted end minus converted baseline' });
  }
  return out;
}

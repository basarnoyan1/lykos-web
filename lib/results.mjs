// The project's results, addressable by key, for insertion into the manuscript.
//
// Plan J7: a number reaches the manuscript as a link to the object that
// produced it, never retyped. Each entry carries the stored value and the text
// it displays as, kept apart, so changing how a figure is rounded never changes
// what was computed. When the underlying analysis is re-run the value changes
// and every block that links to it is marked stale.
import { get } from '../store.mjs';
import { allTools, appraisalTool } from '../schema.mjs';
import { certainty } from './grade.mjs';
import { pooledInputStatus } from './analysis-inputs.mjs';
import { prismaData } from './prisma-counts.mjs';
import { ipdCountRows } from './prisma-ipd.mjs';
import { PRIMARY, outcomes, analysisOf, resultPrefix, timepointsOf, slotId } from './outcomes.mjs';
import { caseResults } from './case-report.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { savedAnalyses, isStale } from './dataset-analysis-core.mjs';
import { advancedInputStatus } from './advanced-primary.mjs';
import { swimOf, swimRows } from './swim-state.mjs';
import { effectDirection } from './swim-core.mjs';

// Missing (null, undefined, '') stays missing: Number(null) is 0, not absent.
const num = (v, d = 2) =>
  v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : null;

// A p-value below the reporting floor is written as an inequality, which is a
// statement about precision, not a rounded number.
const pval = v => {
  if(v == null || v === '')return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 0.001 ? '<0.001' : n.toFixed(3);
};

const pct = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : null);

const entry = (key, group, label, raw, text) =>
  (text == null || text === '' ? null : { key, group, label, raw, text });

/**
 * Every result the project currently holds, flattened.
 * Recomputed from state on each call: the registry is a view of the project,
 * not a second copy of it.
 */
export function results(s = get()) {
  const out = [];
  const add = (...a) => { const e = entry(...a); if (e) out.push(e); };

  // ---- pooled effect, one group per outcome --------------------------------
  // The primary outcome keeps the keys pooled.*; a further outcome's are
  // pooled.<id>.*, grouped under its name.
  // one group per outcome and timepoint (plan G3): a later timepoint's keys add `.tN`
  for (const o of outcomes(s)) for (const t of timepointsOf(s, o.id)) {
    const slot = slotId(o.id, t.id), several = timepointsOf(s, o.id).length > 1;
    const a = analysisOf(s, slot);
    if (!a) continue;
    const name = o.id === PRIMARY ? (several ? `Pooled effect · ${o.name}` : 'Pooled effect') : `Pooled effect · ${o.name}`;
    const p = resultPrefix(slot), group = several ? `${name} · ${t.label || t.id}` : name, from = out.length;
    // The analysis view stores the pooled value as `estimate` (the R output's
    // name); an older project may still carry `est`.
    const est = a.estimate ?? a.est;
    const m = a.measure || 'effect';
    add(`${p}.estimate`, group, `Pooled ${m}`, est, num(est));
    add(`${p}.ci`, group, '95% CI',
      [a.lo, a.hi], num(a.lo) && num(a.hi) ? `${num(a.lo)} to ${num(a.hi)}` : null);
    add(`${p}.full`, group, `${m} with CI`, [est, a.lo, a.hi],
      num(est) && num(a.lo) && num(a.hi) ? `${num(est)} (95% CI ${num(a.lo)} to ${num(a.hi)})` : null);
    add(`${p}.i2`, group, 'I²', a.i2, num(a.i2, 1) != null ? `${num(a.i2, 1)}%` : null);
    if (!['EE', 'MH', 'PETO'].includes(a.method)) add(`${p}.tau2`, group, 'tau²', a.tau2, num(a.tau2, 3));
    // Q-profile intervals of τ² and I², where the run computed them (lib/heterogeneity.mjs)
    if (a.tau2_lo != null && a.tau2_hi != null) add(`${p}.tau2_ci`, group, '95% CI of tau²', [a.tau2_lo, a.tau2_hi], `${num(a.tau2_lo, 3)} to ${num(a.tau2_hi, 3)}`);
    if (a.i2_lo != null && a.i2_hi != null) add(`${p}.i2_ci`, group, '95% CI of I²', [a.i2_lo, a.i2_hi], `${num(a.i2_lo, 1)}% to ${num(a.i2_hi, 1)}%`);
    add(`${p}.q`, group, 'Q', a.q, num(a.q, 2));
    add(`${p}.qp`, group, 'Q p-value', a.qp, pval(a.qp));
    // arms read from a table's text are the rows of the model; the studies they come from are counted apart
    add(`${p}.k`, group, a.derived ? 'Arms pooled' : 'Studies pooled', a.k, a.k != null ? String(a.k) : null);
    if (a.derived) add(`${p}.studies`, group, 'Studies pooled', a.studies, a.studies != null ? String(a.studies) : null);
    add(`${p}.method`, group, 'Estimator', a.method, { EE: 'common-effect', MH: 'Mantel–Haenszel', PETO: 'Peto' }[a.method] || a.method || null);
    if (a.pi_lo != null && a.pi_hi != null) add(`${p}.pi`, group, '95% prediction interval', [a.pi_lo, a.pi_hi],
      num(a.pi_lo) && num(a.pi_hi) ? `${num(a.pi_lo)} to ${num(a.pi_hi)}` : null);
    // A linked result stays visible so a reviewer can inspect it, but its
    // origin status follows changes to the accepted inputs and study decisions.
    const inputStatus = pooledInputStatus(s, a, slot);
    for (const r of out.slice(from)) r.inputStatus = inputStatus;
  }

  // ---- time to event ------------------------------------------------------
  const sv = s.survival;
  if (sv) {
    const from = out.length;
    add('survival.n', 'Time to event', 'Patients analysed', sv.n, sv.n != null ? String(sv.n) : null);
    add('survival.events', 'Time to event', 'Events', sv.events,
      sv.events != null ? String(sv.events) : null);
    add('survival.logrank_p', 'Time to event', 'Log-rank p', sv.km?.logrankP, pval(sv.km?.logrankP));
    add('survival.gehan_p', 'Time to event', 'Gehan–Breslow–Wilcoxon p',
      sv.km?.gehanP, pval(sv.km?.gehanP));

    // Landmark survival per group, which is what a results paragraph quotes.
    const km = sv.km || {};
    const arr = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const groups = arr(km.groups);
    const strata = arr(km.strata), sTime = arr(km.sTime);
    const sSurv = arr(km.sSurv), sLo = arr(km.sLower), sUp = arr(km.sUpper);
    for (const g of groups) {
      for (const t of arr(km.atTimes)) {
        const i = strata.findIndex((st2, j) => String(st2).includes(g) && sTime[j] === t);
        if (i < 0) continue;
        const slug = `${slugify(g)}.${t}mo`;
        // A collapsed interval carries no information, so it is not offered.
        const degenerate = sLo[i] == null || Number.isNaN(sLo[i]) ||
          (sLo[i] === sUp[i] && sSurv[i] === sLo[i]);
        add(`survival.${slug}`, 'Time to event', `${g}, ${t} months`, sSurv[i],
          degenerate ? pct(sSurv[i])
            : `${pct(sSurv[i])} (95% CI ${pct(sLo[i])} to ${pct(sUp[i])})`);
      }
    }

    // Cox, per comparison against the reference group.
    const cox = sv.cox;
    if (cox) {
      const terms = arr(cox.terms), hr = arr(cox.hr);
      const lo = arr(cox.lower), up = arr(cox.upper), p = arr(cox.p);
      terms.forEach((term, i) => {
        const slug = slugify(term);
        add(`cox.${slug}.hr`, 'Cox regression', `HR, ${term}`, hr[i],
          num(hr[i], 2) && num(lo[i], 2)
            ? `${num(hr[i], 2)} (95% CI ${num(lo[i], 2)} to ${num(up[i], 2)})` : num(hr[i], 2));
        add(`cox.${slug}.p`, 'Cox regression', `p, ${term}`, p[i], pval(p[i]));
      });
      add('cox.ph_p', 'Cox regression', 'Proportional hazards p', cox.phP, pval(cox.phP));
      add('cox.epv', 'Cox regression', 'Events per variable', cox.epv, num(cox.epv, 1));
      add('cox.reference', 'Cox regression', 'Reference group', cox.reference, cox.reference || null);
    }
    for (const r of out.slice(from)) r.inputStatus = survivalInputStatus(s);
  }

  // Saved primary results are addressable from their own immutable run id.
  // Edits to source rows invalidate linked sentences even if rounded numbers
  // happen to stay the same after a change.
  for (const a of savedAnalyses(s)) {
    const from = out.length, prefix = `dataset.${a.id}`, group = a.result.title || a.kind;
    const n = typeof a.result.n === 'object' ? a.result.n?.used : a.result.n;
    add(`${prefix}.n`, group, 'Rows analysed', n, n == null ? null : String(n));
    const dropped = typeof a.result.n === 'object' ? a.result.n?.dropped : null;
    if (Number.isFinite(dropped)) add(`${prefix}.excluded`, group, 'Rows excluded', dropped, String(dropped));
    add(`${prefix}.sentence`, group, 'Results text', a.result.sentence, a.result.sentence);
    for (const r of out.slice(from)) r.inputStatus = isStale(a, s) ? 'stale' : 'current';
  }
  for (const a of s.advancedAnalyses || []) {
    const from = out.length, prefix = `advanced.${a.id}`, group = a.result.title;
    add(`${prefix}.n`, group, 'Rows analysed', a.population.used, String(a.population.used));
    add(`${prefix}.excluded`, group, 'Rows excluded', a.population.dropped, String(a.population.dropped));
    if (Number.isFinite(a.population.subjects)) add(`${prefix}.subjects`, group, 'Participants analysed', a.population.subjects, String(a.population.subjects));
    for (const c of a.result.coefficients || []) {
      const key = slugify(c.term), ratio = ['ordinal', 'recurrent'].includes(a.kind), measure = a.kind === 'ordinal' ? 'OR' : a.kind === 'recurrent' ? 'HR' : 'Coefficient';
      const convert=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?(ratio?Math.exp(Number(v)):Number(v)):null;
      const effect=convert(c.estimate),lo=convert(c.lo),hi=convert(c.hi);
      add(`${prefix}.${key}.effect`, group, `${measure}, ${c.term}`, effect, num(effect));
      add(`${prefix}.${key}.full`, group, `${measure} with CI, ${c.term}`, [effect, lo, hi], [effect,lo,hi].every(v=>v!=null&&Number.isFinite(v))?`${num(effect)} (95% CI ${num(lo)} to ${num(hi)})`:null);
      add(`${prefix}.${key}.p`, group, `p, ${c.term}`, c.p, pval(c.p));
    }
    const rows = value => value == null ? [] : Array.isArray(value) ? value : [value];
    rows(a.result.diagnostics?.omnibus).forEach((c, index) => {
      const key = `${prefix}.omnibus.${index + 1}`, label = `${c.group} · ${String(c.effect).replace(/arm/g, 'Group').replace(/visit/g, 'Time')}`;
      add(`${key}.statistic`, group, `${a.kind === 'rm-anova' ? 'F' : 'Friedman χ²'}, ${label}`, c.statistic, num(c.statistic));
      add(`${key}.df`, group, `df, ${label}`, c.df, num(c.df, 0));
      add(`${key}.residualDf`, group, `Residual df, ${label}`, c.residualDf, num(c.residualDf, 0));
      add(`${key}.p`, group, `Omnibus p, ${label}`, c.p, pval(c.p));
    });
    rows(a.result.diagnostics?.posthoc).forEach((c, index) => {
      const key = `${prefix}.posthoc.${index + 1}`, label = `${c.group} · ${c.first} − ${c.second}`;
      add(`${key}.difference`, group, `${a.kind === 'rm-anova' ? 'Mean' : 'Descriptive median'} paired difference, ${label}`, c.difference, num(c.difference));
      if (a.kind === 'rm-anova') add(`${key}.ci`, group, `Simultaneous 95% interval, ${label}`, [c.lower, c.upper], c.lower != null && c.upper != null && num(c.lower) != null && num(c.upper) != null ? `${num(c.lower)} to ${num(c.upper)}` : null);
      add(`${key}.rawP`, group, `Raw paired p, ${label}`, c.p, pval(c.p));
      add(`${key}.adjustedP`, group, `Bonferroni p, ${label}`, c.adjustedP, pval(c.adjustedP));
      add(`${key}.pairs`, group, `Pairs, ${label}`, c.n, num(c.n, 0));
      add(`${key}.comparisons`, group, `Multiplicity family size, ${label}`, c.familyComparisons, num(c.familyComparisons, 0));
    });
    for (const r of out.slice(from)) r.inputStatus = advancedInputStatus(a, s);
  }

  // ---- case report (lib/case-report.mjs) -------------------------------------
  // One patient's facts, so the manuscript links them rather than retyping.
  if (s.project?.researchType === 'case-report') {
    for (const [key, label, raw, text] of caseResults(s)) add(key, 'Case', label, raw, text);
    return out;
  }

  // ---- PRISMA -------------------------------------------------------------
  const pr = prismaData(s);
  const prismaLabels = {
    database_results: 'Records from databases', register_results: 'Records from registers',
    duplicates: 'Duplicates removed', records_screened: 'Records screened',
    records_excluded: 'Records excluded', dbr_assessed: 'Reports assessed',
    new_studies: 'Studies included', new_reports: 'Reports of included studies',
  };
  for (const [k, label] of Object.entries(prismaLabels))
    add(`prisma.${k}`, 'PRISMA', label, pr[k], pr[k] != null && pr[k] !== '' ? String(pr[k]) : null);

  // A patient-level review's flow (lib/prisma-ipd.mjs), read from the patients and decisions on record.
  if ((s.participants || []).length)
    for (const r of ipdCountRows(s)) add(`ipd.${r.id}`, 'PRISMA-IPD', r.label, r.count, String(r.count));

  // ---- certainty, and the Summary of findings' cells of each outcome ----------------------------------------
  for (const o of s.grade || []) {
    if (!o.name) continue;
    const c = certainty(o), k = slugify(o.name), group = `Summary of findings · ${o.name}`;
    add(`certainty.${k}`, 'Certainty', `Certainty, ${o.name}`, c.rated ? c.final : null, c.rated ? c.final : null);   // an unrated row has no level to cite
    add(`sof.${k}.relative`, group, 'Relative effect (95% CI)', o.effect, o.effect || null);
    add(`sof.${k}.absolute`, group, 'Risk with intervention', o.absolute, o.absolute || null);
    add(`sof.${k}.comparator`, group, 'Risk with comparator', o.comparatorRisk, o.comparatorRisk || null);
    const n = [o.participants, o.studies].some(Boolean) ? `${o.participants || '—'} (${o.studies || '—'} studies)` : null;
    add(`sof.${k}.participants`, group, 'Participants (studies)', n, n);
  }

  // ---- synthesis without meta-analysis: each outcome domain's directions and its sign test (lib/swim.mjs) ----------------------
  const sw = swimOf(s);
  if (sw.outcomes.length) for (const d of effectDirection(swimRows(s)).byOutcome) {
    const k = slugify(d.outcome), group = `SWiM · ${d.outcome}`;
    add(`swim.${k}.directions`, group, 'Direction of effect', d.votes, d.text);
    add(`swim.${k}.studies`, group, 'Studies', d.k, String(d.k));
    add(`swim.${k}.sign_p`, group, 'Sign test p', d.signTest.p, pval(d.signTest.p));
  }

  // ---- appraisal ----------------------------------------------------------
  const tool = appraisalTool(s.appraisalTool || 'rob2', s);
  const byInstrument = k => allTools(s).some(t => t.id === k);
  const assessed = Object.values(s.assessments || {}).filter(rec => {
    if (rec[tool.id]) return true;
    return tool.id === 'rob2' && Object.keys(rec).some(k => !byInstrument(k));
  }).length;
  add('appraisal.instrument', 'Appraisal', 'Instrument', tool.name, tool.name);
  add('appraisal.assessed', 'Appraisal', 'Studies appraised', assessed,
    assessed ? String(assessed) : null);

  return out;
}

export const slugify = t => String(t).toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/**
 * A drafted section as blocks, with any saved result the draft quotes
 * verbatim turned into a link to that result (plan J7: a number reaches the
 * manuscript as a link, never retyped), longest display text first so a
 * full estimate with its interval wins over its parts.
 */
export function draftBlocks(text, resultList) {
  const byText = resultList.filter(r => r.text && r.text.length >= 3 && /\d/.test(r.text))
    .sort((a, b) => b.text.length - a.text.length);
  const linked = new Map();
  const paras = String(text || '').split(/\n\s*\n|\n/).map(t => t.trim()).filter(Boolean).map(t => {
    for (const r of byText) {
      // Only where the result stands as a whole number: "0.8" is not linked
      // inside "0.80", which would leave a stray digit beside the live value.
      const esc = r.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\d.])${esc}(?![\\d]|\\.\\d)`, 'g');
      if (!re.test(t)) continue;
      t = t.replace(re, `{{${r.key}}}`);
      linked.set(r.key, r.text);
    }
    return t;
  });
  return { paras, linked };
}

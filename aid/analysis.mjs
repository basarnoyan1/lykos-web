import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the analysis view (lib/aid.mjs).
//
// Every number here comes from a saved result: the pooled analysis the R
// engine wrote to state.analysis, or the time-to-event analysis in
// state.survival. The model restates those numbers and never computes one
// (plan 1.3). A reply is checked for that in code: a number it holds that the
// material it was given does not hold is treated as invented, and the reply is
// dropped rather than shown.
import { register, SYSTEM_GUARD, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { interpretResult, resultFacts, modelName } from '../lib/helpers.mjs';
import { blankBlock } from '../lib/manuscript.mjs';
import { unsupported } from '../lib/numbers.mjs';
import { draftBlocks, results } from '../lib/results.mjs';
import { get, update } from '../store.mjs';
import { measureOf, noEffect } from '../lib/effect-measures.mjs';
import { PRIMARY, analysisOf, fieldFor } from '../lib/outcomes.mjs';
import { sensitivityFacts } from '../lib/sensitivity.mjs';

// ---- numbers ----------------------------------------------------------------
// One reader of numbers for every action (lib/numbers.mjs): signs count, so
// -0.12 does not vouch for 0.12. Re-exported under the names this file used to
// define, for any caller that still imports them from here.
export { numbersIn, unsupported as unsupportedNumbers } from '../lib/numbers.mjs';

/**
 * The saved results draftBlocks may link in `text`: those whose display text
 * appears only as a whole number there. draftBlocks matches display text as a
 * plain substring, so "0.8" would be linked inside "0.80" and "0.031" inside
 * "0.0312", leaving a stray digit beside a live value; a result written that
 * way is left as typed text instead.
 */
export function linkable(text, list) {
  const t = String(text || '');
  return list.filter(r => {
    const esc = String(r.text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!esc) return false;
    const all = t.split(r.text).length - 1;
    const whole = [...t.matchAll(new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`, 'g'))].length;
    return all > 0 && all === whole;
  });
}

// ---- facts ------------------------------------------------------------------
const arr = v => (Array.isArray(v) ? v : Array.isArray(v?.values) ? v.values : v == null ? [] : [v]);
const pv = v => (v == null || Number.isNaN(Number(v)) ? 'not computed' : Number(v) < 0.001 ? '< 0.001' : Number(v).toFixed(3));
const pct = v => (v == null || Number.isNaN(Number(v)) ? 'not estimable' : `${(Number(v) * 100).toFixed(1)}%`);

/**
 * The saved time-to-event result as lines, formatted as the view shows them
 * (survival as a percentage to one decimal, hazard ratios to three), with the
 * two cautions the view states beside a Cox model.
 */
export function survivalFacts(r) {
  if (!r?.km) return '';
  const km = r.km;
  const times = arr(km.atTimes), strata = arr(km.strata), groups = arr(km.groups);
  const sTime = arr(km.sTime), sSurv = arr(km.sSurv), sLo = arr(km.sLower), sUp = arr(km.sUpper);
  const at = (g, t) => {
    for (let i = 0; i < sTime.length; i++)
      if ((strata.length ? String(strata[i]).includes(g) : true) && sTime[i] === t) return i;
    return -1;
  };
  const lines = [`Kaplan–Meier, freedom from event: ${r.n} patients, ${r.events} events`];
  groups.forEach((g, gi) => {
    const med = arr(km.median)[gi];
    const marks = times.map(t => {
      const i = at(g, t); if (i < 0) return '';
      const same = sLo[i] == null || (sLo[i] === sUp[i] && sSurv[i] === sLo[i]);
      return `${t} months ${pct(sSurv[i])}${same ? '' : ` (95% CI ${pct(sLo[i])} to ${pct(sUp[i])})`}`;
    }).filter(Boolean);
    lines.push(`${g}: n ${arr(km.n)[gi] ?? '?'}, events ${arr(km.events)[gi] ?? '?'}, median ${Number.isFinite(med) ? `${med} months` : 'not reached'}${marks.length ? `; ${marks.join('; ')}` : ''}`);
  });
  if (groups.length > 1) lines.push(`Log-rank p ${pv(km.logrankP)}; Gehan–Breslow–Wilcoxon p ${pv(km.gehanP)}`);
  if (r.pair) arr(r.pair.a).forEach((a, i) =>
    lines.push(`${a} vs ${arr(r.pair.b)[i]}: p ${pv(arr(r.pair.p)[i])}, Holm–Šídák adjusted p ${pv(arr(r.pair.padj)[i])}`));
  if (r.cox) {
    const c = r.cox;
    lines.push(`Cox regression, reference ${c.reference}, Efron ties:`);
    arr(c.terms).forEach((t, i) => lines.push(`  ${t}: HR ${Number(arr(c.hr)[i]).toFixed(3)} (95% CI ${Number(arr(c.lower)[i]).toFixed(3)} to ${Number(arr(c.upper)[i]).toFixed(3)}), p ${pv(arr(c.p)[i])}`));
    lines.push(`Events per variable ${Number(c.epv).toFixed(1)}; proportional-hazards test p ${pv(c.phP)}`);
    if (Number(c.epv) < 10) lines.push('Fewer than 10 events per variable: the Cox model is exploratory');
    if (Number(c.phP) < 0.05) lines.push('Proportional hazards rejected: the hazard ratio does not describe these data');
  }
  return lines.join('\n');
}

/** Subgroups, meta-regression and leave-one-out, as the view tabulates them. */
function exploreFacts(a) {
  const f = (x, d = 2) => Number(x).toFixed(d);
  // Cumulative, trim-and-fill and influence results, as numbers only.
  const lines = [...sensitivityFacts(a)];
  if (a.mod_kind === 'group') {
    const lv = arr(a.mod_levels), k = arr(a.mod_k), est = arr(a.mod_est), lo = arr(a.mod_lo), hi = arr(a.mod_hi), i2 = arr(a.mod_i2);
    lines.push(`Subgroups by ${a.moderatorLabel} (test for differences Q ${f(a.qm)}, df ${a.qm_df}, p ${pv(a.qmp)}):`);
    lv.forEach((l, i) => lines.push(`  ${l}: k ${k[i]}, ${a.measure} ${f(est[i])} (95% CI ${f(lo[i])} to ${f(hi[i])}), I² ${f(i2[i], 1)}%`));
  } else if (a.mod_kind === 'numeric' && a.r2 != null) {
    lines.push(`Meta-regression on ${a.moderatorLabel}: R² ${f(a.r2, 1)}% of heterogeneity explained`);
  }
  const est = arr(a.loo_est);
  if (est.length) {
    lines.push('Leave one out (study omitted: pooled estimate, I²):');
    est.forEach((e, i) => lines.push(`  ${(a.labels || [])[i] || `Study ${i + 1}`}: ${f(e)} (95% CI ${f(arr(a.loo_lo)[i])} to ${f(arr(a.loo_hi)[i])}), I² ${f(arr(a.loo_i2)[i], 1)}%`));
  }
  return lines.join('\n');
}

// ---- what is shown ------------------------------------------------------------
// The view reports its mode in focus(): which analysis the person is looking
// at decides which result an action works from.
// A pooled mode is 'pairwise' (the primary outcome) or 'pairwise:<outcome id>';
// every action and check works from that outcome's own result and inputs.
const modeOf = ctx => ctx?.focus?.mode || '';
const isPair = mode => mode === 'pairwise' || String(mode || '').startsWith('pairwise:');
const outcomeIdOf = mode => (String(mode || '').startsWith('pairwise:') ? mode.slice(9) : PRIMARY);
const pooled = (s, mode = 'pairwise') => { const a = analysisOf(s, outcomeIdOf(mode)); return a && Number(a.k) >= 2 ? a : null; };
const survival = s => (s.survival?.km ? s.survival : null);

/**
 * The results paragraphs go at the end of the Results section, the first
 * filling its first empty paragraph when it has one; with no Results heading,
 * at the end. Takes one text or a list of paragraphs.
 */
export function insertResults(blocks, paras) {
  const list = (Array.isArray(paras) ? paras : [paras]).filter(Boolean);
  const at = blocks.findIndex(x => /^h/.test(x.type) && /results/i.test(x.text));
  if (at < 0) { blocks.push(...list.map(t => blankBlock('p', t))); return; }
  let end = at + 1;
  while (end < blocks.length && !/^h/.test(blocks[end].type)) {
    if (blocks[end].type === 'p' && !String(blocks[end].text || '').trim()) {
      blocks[end].text = list[0];
      blocks.splice(end + 1, 0, ...list.slice(1).map(t => blankBlock('p', t)));
      return;
    }
    end++;
  }
  blocks.splice(end, 0, ...list.map(t => blankBlock('p', t)));
}

/**
 * Which saved result a paragraph was written from: when it was computed and
 * what it said. A re-run changes this, and a paragraph written from the old
 * result must not be placed.
 */
export function resultIdentity(s, mode) {
  if (isPair(mode)) {
    const a = analysisOf(s, outcomeIdOf(mode)) || {};
    return JSON.stringify([outcomeIdOf(mode), a.at, a.measure, a.k, a.estimate, a.lo, a.hi]);
  }
  const r = s.survival || {};
  return JSON.stringify([r.at, r.n, r.events, r.km?.logrankP, r.km?.sSurv]);
}

/** The value that means no effect for a measure, which findings may name. */
const nullOf = a => noEffect(a?.measure);

/** Methodological cautions that need no model: each tied to the saved numbers. */
export function mechanicalCautions(s, mode) {
  const out = [];
  const f = (x, d = 2) => Number(x).toFixed(d);
  if (isPair(mode) && pooled(s, mode)) {
    const a = pooled(s, mode), k = Number(a.k), oid = outcomeIdOf(mode);
    const nullValue = noEffect(a.measure);
    if (a.egger_z != null && k < 10)
      out.push({ label: `Egger's test with k = ${k}`, detail: `z ${f(a.egger_z)}, p ${pv(a.egger_p)}: too few studies; do not interpret.` });
    if (k < 5 && a.method !== 'EE')
      out.push({ label: `τ² from k = ${k} studies`, detail: `τ² ${f(a.tau2, 4)}, 95% CI ${f(a.lo)} to ${f(a.hi)}: check with Hartung–Knapp.` });
    // A common-effect model assumes every study estimates one true effect; clear
    // heterogeneity says they do not, and its CI is then too narrow.
    if (a.method === 'EE' && (Number(a.i2) >= 25 || Number(a.qp) < 0.1))
      out.push({ label: `Common-effect model with I² ${f(a.i2, 1)}%`, detail: `Q ${f(a.q)}, p ${pv(a.qp)}: the studies disagree more than chance; report a random-effects model.` });
    if (a.method === 'DL' && k < 10)
      out.push({ label: 'DerSimonian–Laird with few studies', detail: `k = ${k}: use REML.` });
    if (a.pi_lo != null && k < 3)
      out.push({ label: 'Prediction interval from k = 2', detail: `${f(a.pi_lo)} to ${f(a.pi_hi)}: do not interpret.` });
    if (Number(a.i2) >= 50 && k < 10)
      out.push({ label: `I² ${f(a.i2, 1)}% from k = ${k}`, detail: 'Imprecise: report its confidence interval.' });
    // A study whose omission moves the interval across the null carries the result.
    const est = arr(a.loo_est), lo = arr(a.loo_lo), hi = arr(a.loo_hi);
    // A single-group proportion or mean has no null value to cross.
    const spans = (l, h) => nullValue != null && Number(l) <= nullValue && Number(h) >= nullValue;
    est.forEach((e, i) => {
      if (spans(lo[i], hi[i]) !== spans(a.lo, a.hi))
        out.push({ label: `Omitting ${(a.labels || [])[i] || `study ${i + 1}`}`, detail: `${a.measure} ${f(e)} (95% CI ${f(lo[i])} to ${f(hi[i])}) without it, ${f(a.estimate)} (${f(a.lo)} to ${f(a.hi)}) with it: report as a sensitivity result.` });
    });
    // Events and totals as extracted, per study: what the effect measure has to work with.
    const papers = (s.papers || []).filter(p => (a.labels || []).includes(p.label));
    const val = (p, id) => s.values?.[`${p.id}:${fieldFor(id, oid)}`]?.normalized_value;
    for (const p of papers) {
      const et = val(p, 'events_t'), nt = val(p, 'n_t'), ec = val(p, 'events_c'), nc = val(p, 'n_c');
      if (measureOf(a.measure).family !== 'binary') continue;   // the checks below are for event counts
      if (Number(et) === 0 && Number(ec) === 0 && a.measure !== 'RD')
        out.push({ label: `${p.label}: no events in either arm`, detail: `${et}/${nt} and ${ec}/${nc}: no information for ${a.measure}; report it separately.`, where: { paperId: p.id, label: p.label } });
      else if (a.measure === 'OR' && Number(nc) > 0 && Number(ec) / Number(nc) > 0.2)
        out.push({ label: `${p.label}: common outcome`, detail: `${ec}/${nc} control events: the odds ratio overstates the risk ratio; report RR.`, where: { paperId: p.id, label: p.label } });
    }
  }
  if (mode === 'survival' && survival(s)) {
    const r = s.survival, km = r.km;
    if (Number(r.events) < 10)
      out.push({ label: `${r.events} events in total`, detail: `${r.n} patients: report group comparisons as descriptive.` });
    arr(km.groups).forEach((g, gi) => {
      const n = Number(arr(km.n)[gi]);
      if (n < 5) out.push({ label: `${g}: n ${n}`, detail: 'Curve and median unstable; report descriptively.' });
    });
    if (r.cox && Number(r.cox.epv) < 10)
      out.push({ label: `${Number(r.cox.epv).toFixed(1)} events per variable`, detail: 'Fewer than 10: report the Cox model as exploratory.' });
    if (r.cox && Number(r.cox.phP) < 0.05)
      out.push({ label: `Proportional hazards p ${pv(r.cox.phP)}`, detail: 'Rejected: report the curves and landmark estimates, not one hazard ratio.' });
  }
  return out;
}

/** Keeps the findings whose numbers all come from the material; counts the rest. */
function supported(list, material) {
  const kept = [], dropped = [];
  for (const x of list) (unsupported(`${x.label} ${x.detail || ''}`, ...material).length ? dropped : kept).push(x);
  return { kept, dropped: dropped.length };
}

const proposeResults = durableAction('analysis-results', ({ mode, ran, paras, linked }) => {
  if (resultIdentity(get(), mode) !== ran) return { refused: 'The analysis was re-run; write the paragraph again' };
  update(st => {
    st.manuscript = st.manuscript || { blocks: [], snapshot: {} };
    insertResults(st.manuscript.blocks, paras);
    // The value each link was made at, so a later re-run marks it stale.
    st.manuscript.snapshot = { ...(st.manuscript.snapshot || {}), ...Object.fromEntries(linked) };
    return st;
});
return 'Added to Results';
});

register('analysis', [
  {
    id: 'write-results',
    label: 'Write results paragraph',
    icon: 'manuscript',
    task: 'write',
    when: (s, ctx) => (isPair(modeOf(ctx)) && !!pooled(s, modeOf(ctx))) || (modeOf(ctx) === 'survival' && !!survival(s)),
    async run({ cfg, signal, brief, context }) {
      const s = get();
      const mode = modeOf(context);
      const ran = resultIdentity(s, mode);
      let text, facts, prompt;
      if (isPair(mode)) {
        facts = resultFacts(pooled(s, mode));
        text = await interpretResult(pooled(s, mode), cfg, { signal, guard: SYSTEM_GUARD, brief });
      } else {
        facts = survivalFacts(s.survival);
        text = (await complete(cfg, P.messagesOf(P.analysisWriteResults, { brief, facts }), { prompt: P.analysisWriteResults, signal, temperature: 0 })).trim();
        prompt = promptRef(P.analysisWriteResults);
      }
      // Checked against the result alone: the brief's counts ("included 12")
      // and the instructions are not evidence for a number in the paragraph.
      const bad = unsupported(text, facts);
      if (!text || bad.length) return { title: 'Results paragraph', items: [], prompt,
        note: text ? `Dropped: the reply held numbers not in the result (${[...new Set(bad)].slice(0, 6).join(', ')})` : 'The model returned no text' };
      // Saved results quoted verbatim become links to them (plan J7).
      const { paras, linked } = draftBlocks(text, linkable(text, results(s)));
      return {
        title: 'Results paragraph',
        prompt,
        items: [{
          label: text,
          detail: [isPair(mode) ? `Pooled ${pooled(s, mode).measure}${pooled(s, mode).outcomeName ? ` · ${pooled(s, mode).outcomeName}` : ''}, k = ${pooled(s, mode).k}` : `Time to event, ${s.survival.n} patients`,
            linked.size ? `${linked.size} linked ${linked.size === 1 ? 'result' : 'results'}` : ''].filter(Boolean).join(' · '),
          acceptLabel: 'Add to Results',
          ...proposeResults({ mode, ran, paras, linked: [...linked] }),
        }],
      };
    },
  },
  {
    id: 'explain-heterogeneity',
    label: 'Explain heterogeneity',
    icon: 'analysis',
    task: 'assist',
    when: (s, ctx) => isPair(modeOf(ctx)) && !!pooled(s, modeOf(ctx)),
    async run({ cfg, signal, brief, context }) {
      const a = pooled(get(), modeOf(context));
      const facts = [resultFacts(a), exploreFacts(a), (nullOf(a) != null && `No effect: ${a.measure} ${nullOf(a)}`)].filter(Boolean).join('\n');
      const out = await complete(cfg, P.messagesOf(P.analysisHeterogeneity, { brief, facts }), { prompt: P.analysisHeterogeneity, signal, temperature: 0, json: true });
      const got = (jsonOf(out).findings || []).filter(x => x?.label)
        .map(x => ({ label: String(x.label).slice(0, 160), detail: String(x.detail || '').slice(0, 500) }));
      const { kept, dropped } = supported(got, [facts]);
      return { title: 'Heterogeneity', prompt: promptRef(P.analysisHeterogeneity), items: kept,
        note: [!got.length && 'No findings', dropped && `${dropped} dropped for numbers not in the result`].filter(Boolean).join(' · ') };
    },
  },
  {
    id: 'check-choices',
    label: 'Check analysis choices',
    icon: 'analysis',
    task: 'assist',
    when: (s, ctx) => (isPair(modeOf(ctx)) && !!pooled(s, modeOf(ctx))) || (modeOf(ctx) === 'survival' && !!survival(s)),
    async run({ cfg, signal, brief, context }) {
      const s = get();
      const mode = modeOf(context);
      const found = mechanicalCautions(s, mode);
      const a = isPair(mode) ? pooled(s, mode) : null;
      const facts = a
        ? [`Measure ${a.measure}; ${modelName(a.method)} model${nullOf(a) != null ? `; no effect at ${nullOf(a)}` : ''}`, resultFacts(a), exploreFacts(a)].filter(Boolean).join('\n')
        : survivalFacts(s.survival);
      // The model is asked only for what the rules above do not already cover.
      const out = await complete(cfg, P.messagesOf(P.analysisChoices, { brief, facts, found: found.map(x => `- ${x.label}: ${x.detail}`).join('\n') }),
        { prompt: P.analysisChoices, signal, temperature: 0, json: true });
      const got = (jsonOf(out).cautions || []).filter(x => x?.label)
        .map(x => ({ label: String(x.label).slice(0, 160), detail: String(x.detail || '').slice(0, 500) }));
      const { kept, dropped } = supported(got, [facts, found.map(x => `${x.label} ${x.detail}`).join('\n')]);
      const items = [...found, ...kept];
      return { title: 'Analysis choices', prompt: promptRef(P.analysisChoices), items,
        note: [!items.length && 'No cautions', dropped && `${dropped} dropped for numbers not in the result`].filter(Boolean).join(' · ') };
    },
  },
]);

import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the certainty view (lib/aid.mjs).
//
// The reviewer rates every GRADE domain; a model only puts into words why a
// domain the reviewer rated down was rated down, from the numbers the project
// already holds. It restates those numbers, never computes one, and a
// footnote carrying a number that is not in the material is dropped. accept()
// writes text only; ratings, design and override are never touched.
//
// A domain's footnote lives in outcome.explanations[domainId], which the
// summary of findings (lib/sof.mjs) prints as the table's footnotes. A person's
// footnote is a plain string; an accepted draft is filed as
// { text, extractor: 'model:…', verification: 'accepted', at }, so it counts as
// unverified until a person checks or edits it. A footnote a person wrote is
// never drafted over.
import { register, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { get, update } from '../store.mjs';
import { DESIGNS, DOWNGRADE, DOWNGRADE_RATINGS, certainty, explanationText } from '../lib/grade.mjs';
import { appraisalTool } from '../schema.mjs';
import { linkedOutcome } from '../lib/grade-link.mjs';
import { analysisOf } from '../lib/outcomes.mjs';

const downgraded = o => DOWNGRADE.filter(d => (DOWNGRADE_RATINGS.find(r => r.value === o.ratings?.[d.id])?.steps ?? 0) < 0);
const ratingLabel = (o, d) => DOWNGRADE_RATINGS.find(r => r.value === o.ratings?.[d.id])?.label || '';

// A footnote belongs to a person when they typed it (a string) or checked a
// draft (verification 'verified'); either way no model writes over it.
export const personOwned = x => typeof x === 'string' ? Boolean(x.trim())
  : Boolean(x) && x.verification === 'verified' && Boolean(explanationText(x).trim());

const isFocused = (o, focus) => focus?.kind === 'outcome' && focus.outcomeId === o.id;

/**
 * The domains of one outcome a run drafts for. With the outcome in focus,
 * every downgraded domain but those a person has written, so an earlier draft
 * can be redrafted; otherwise only downgraded domains with no footnote yet.
 */
export function drafting(o, focus) {
  return downgraded(o).filter(d => isFocused(o, focus)
    ? !personOwned(o.explanations?.[d.id])
    : !explanationText(o.explanations?.[d.id]).trim());
}

// The outcomes an action covers: the focused one, otherwise every outcome
// with a domain to draft for.
export function targets(s, focus) {
  const list = s.grade || [];
  const one = focus?.kind === 'outcome' && list.find(o => o.id === focus.outcomeId);
  if (one) return drafting(one, focus).length ? [one] : [];
  return list.filter(o => drafting(o, focus).length);
}

// Three significant figures, as the analysis view shows them; a p-value below
// the reporting floor is written as an inequality, never as zero.
const fmt = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? String(Number(Number(v).toPrecision(3))) : null);
const pfmt = v => (fmt(v) == null ? null : Number(v) < 0.001 ? '<0.001' : String(Number(Number(v).toFixed(3))));

/**
 * The numbers a footnote may cite, as text: the outcome's own row, the pooled
 * analysis, and how the included studies were judged per appraisal domain.
 * The counts here are tallies made by this code, not by the model.
 */
export function material(s, outcomes, focus = null) {
  // Each row's own pooled outcome; a row linked to none falls back to the
  // primary result, as before outcomes existed.
  const sources = [...new Map(outcomes.map(o => linkedOutcome(s, o)).filter(Boolean).map(x => [x.id, x])).values()];
  const pooledOf = (a, name) => a ? [
    `Pooled analysis${name ? ` for ${name}` : ''} (${a.measure || 'effect'}, ${a.method || 'estimator not recorded'})`,
    fmt(a.estimate ?? a.est) && `  estimate ${fmt(a.estimate ?? a.est)}, 95% CI ${fmt(a.lo)} to ${fmt(a.hi)}`,
    fmt(a.pi_lo) && `  95% prediction interval ${fmt(a.pi_lo)} to ${fmt(a.pi_hi)}`,
    fmt(a.i2) && `  I² ${fmt(a.i2)}%`, fmt(a.tau2) && `  tau² ${fmt(a.tau2)}`,
    pfmt(a.qp) && `  heterogeneity Q ${fmt(a.q)}, p ${pfmt(a.qp)}`,
    fmt(a.k) && `  studies pooled ${fmt(a.k)}${(a.labels || []).length ? ` (${a.labels.join(', ')})` : ''}`,
    pfmt(a.egger_p) && `  Egger test p ${pfmt(a.egger_p)}`,
  ].filter(Boolean).join('\n') : `Pooled analysis${name ? ` for ${name}` : ''}: none run`;
  const pooled = sources.length ? sources.map(x => pooledOf(analysisOf(s, x.id), x.name)).join('\n\n') : pooledOf(s.analysis, '');

  const tool = appraisalTool(s.appraisalTool || 'rob2', s);
  const byStudy = Object.values(s.assessments || {}).map(rec => rec[tool.id] || (tool.id === 'rob2'
    ? Object.fromEntries(Object.entries(rec).filter(([, v]) => typeof v === 'string')) : {}))
    .filter(r => Object.keys(r).length);
  const cols = [...tool.domains, ...(tool.overall ? [{ id: 'overall', short: 'Overall', label: 'Overall' }] : [])];
  const appraisal = byStudy.length ? [`Appraisal (${tool.name}, ${byStudy.length} studies judged)`,
    ...cols.map(d => {
      const tally = tool.judgements.map(j => [j, byStudy.filter(r => r[d.id] === j).length]).filter(([, n]) => n);
      return tally.length ? `  ${d.short} ${d.label}: ${tally.map(([j, n]) => `${j} ${n}`).join(', ')}` : '';
    }).filter(Boolean)].join('\n') : 'Appraisal: none recorded';

  const rows = outcomes.map(o => [
    `Outcome ${o.id}: ${o.name || 'unnamed'}${linkedOutcome(s, o) ? ` (pooled as ${linkedOutcome(s, o).name})` : ''}`,
    `  design ${DESIGNS.find(d => d.id === o.design)?.label || o.design}; certainty ${certainty(o).final}`,
    `  rated down: ${downgraded(o).map(d => `${d.id} ${d.label} (${ratingLabel(o, d)})`).join('; ')}`,
    `  footnotes wanted: ${drafting(o, focus).map(d => d.id).join(', ')}`,
    o.participants && `  participants ${o.participants}`, o.studies && `  studies ${o.studies}`,
    o.effect && `  relative effect ${o.effect}`, o.comparatorRisk && `  risk with comparator ${o.comparatorRisk}`,
    o.absolute && `  risk with intervention ${o.absolute}`,
  ].filter(Boolean).join('\n'));
  return [rows.join('\n\n'), pooled, appraisal].join('\n\n');
}

/**
 * Why an accepted draft may not be filed, or "". The draft answered the rating the
 * domain had when the model read it; a changed rating, a domain no longer
 * rated down, a removed outcome or a footnote a person has since written
 * each leave the project as it is.
 */
export function footnoteRefusal(st, { outcomeId, domain, rating }) {
  const o = (st.grade || []).find(x => x.id === outcomeId);
  const d = DOWNGRADE.find(x => x.id === domain);
  if (!o) return 'Outcome removed';
  if (!downgraded(o).some(x => x.id === domain)) return `${d.label} no longer rated down`;
  if (o.ratings?.[domain] !== rating) return `${d.label} rating changed since; run again`;
  if (personOwned(o.explanations?.[domain])) return `${d.label} has a footnote a person wrote`;
  return '';
}

export function fileFootnote(st, { outcomeId, domain, text, model }) {
  st.grade = (st.grade || []).map(o => o.id !== outcomeId ? o : { ...o, explanations: { ...(o.explanations || {}),
    [domain]: { text, extractor: `model:${model || 'unknown'}`, verification: 'accepted', at: new Date().toISOString() } } });
  return st;
}

/**
 * Every number in a footnote must appear in the material. Numbers are compared
 * as written after trimming trailing zeros, so "0.50" matches "0.5"; a number
 * the model derived (a difference, a percentage it worked out) does not.
 */
export function numbersIn(text, source) {
  const norm = n => String(Number(n.replace(/,/g, '')));
  const have = new Set((String(source).match(/\d[\d,]*(\.\d+)?/g) || []).map(norm));
  return (String(text).match(/\d[\d,]*(\.\d+)?/g) || []).every(n => have.has(norm(n)));
}

/** Keeps drafted footnotes for domains asked for, whose numbers are all in the material. */
export function keepFootnotes(reply, outcomes, source, focus = null) {
  const byId = new Map(outcomes.map(o => [o.id, o]));
  const out = [];
  for (const f of reply?.footnotes || []) {
    const o = byId.get(String(f?.outcome || ''));
    const d = o && drafting(o, focus).find(x => x.id === String(f.domain || ''));
    const text = String(f?.text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!d || !text || !numbersIn(text, source)) continue;
    if (out.some(x => x.o.id === o.id && x.d.id === d.id)) continue;
    // The rating as the model read it, so accept can tell whether it still stands.
    out.push({ o, d, text, rating: o.ratings?.[d.id] });
  }
  return out;
}

const proposeFootnote = durableAction('grade-footnote', ({ at, label }) => {
  // Only the footnote is written; the rating is never touched.

  const no = footnoteRefusal(get(), at);
  if (no) return { refused: no };
  update(st => fileFootnote(st, at));
  return `${label} footnote set`;
});

register('certainty', [
  {
    id: 'grade-footnotes',
    label: 'Draft GRADE footnotes',
    icon: 'certainty',
    task: 'write',
    when: (s, ctx) => targets(s, ctx?.focus).length > 0,
    async run({ cfg, signal, brief, focus }) {
      const s = get();
      const list = targets(s, focus);
      if (!list.length) return { title: 'GRADE footnotes', note: 'No outcome rated down', items: [] };
      const source = material(s, list, focus);
      const out = await complete(cfg, P.messagesOf(P.certaintyFootnotes, { brief, material: source }), { prompt: P.certaintyFootnotes, signal, temperature: 0, json: true });
      const got = jsonOf(out).footnotes || [];
      const kept = keepFootnotes({ footnotes: got }, list, source, focus);
      return {
        prompt: promptRef(P.certaintyFootnotes),
        title: list.length === 1 ? `Footnotes: ${list[0].name || 'outcome'}` : 'GRADE footnotes',
        note: !got.length ? 'No answer from the model'
          : kept.length === got.length ? '' : `${got.length - kept.length} dropped: a number not in the project, or a domain not asked for`,
        items: kept.map(({ o, d, text, rating }) => ({
          label: `${o.name || 'Outcome'}: ${d.label}`,
          detail: text,
          acceptLabel: 'Use as footnote',
          ...proposeFootnote({ at: { outcomeId: o.id, domain: d.id, rating, text, model: cfg.model }, label: d.label }),
        })),
      };
    },
  },
]);

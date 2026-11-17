// Risk-of-bias sweeps (2026-10-24): the same study appraised three times with the review's own instrument, from a pessimistic, a neutral and
// an optimistic reading, so a judgement can be seen to hold (all three agree) or to depend on how a gap in the report is read. A sweep is
// one reviewer's (a person's, Claude's or a model's) answers, judgements, reasons and verbatim quotes for every domain. The project keeps
// them in `robSweeps` ({ v: 1, studies: { [record]: { [instrument]: { [stance]: sweep } } } }), written by change files
// (tools/lykos-rob-sweep.mjs record or run), and Appraisal's detail shows them beside the recorded assessment.
// A key is the stance, or the stance and who swept it ("neutral:sonnet") when a team sweeps.
// A sweep: { by, model?, at, stance, domains: { [domain]: { judgement, answers?: { [question]: answer }, why, quotes: [{ text, page?, found? }] } } }.
// Pure: prompts, parsing, quote checks and the comparison; the model call is the caller's (lib/ai.mjs complete, or any reviewer's file).
import { lib_rob_review$OVERALL as OVERALL, lib_rob_review$finalAnswers as finalAnswers, lib_rob_review$STUDY as STUDY } from "../boot.mjs";
import { ocrPageOf } from './quotes.mjs';
import { derivedOverall, rankOf } from './rob-overall.mjs';
export { rankOf };

export const STANCES = Object.freeze({
  pessimistic: { label: 'Pessimistic', rule: 'Read the report strictly. Where information is missing, unclear or only implied, choose the answer that implies more risk of bias (for example "Probably no" over "No information" when good practice is not stated). Treat any plausible imbalance in prognostic factors between the arms as uncontrolled confounding.' },
  neutral: { label: 'Neutral', rule: 'Follow the instrument\'s guidance literally. Answer from what the report states; use "No information" (or Unclear) where it is silent, and let the instrument\'s algorithm decide the judgement.' },
  optimistic: { label: 'Optimistic', rule: 'Give the authors the benefit of the doubt where the report reasonably implies good practice (a standard protocol, consecutive patients, objective outcomes, complete follow-up tables). Reserve higher risk for problems the report shows, not for what it leaves unsaid. Arms comparable at baseline on the important prognostic factors may justify a lower confounding judgement even without statistical adjustment.' },
});
export const STANCE_IDS = Object.keys(STANCES);

const domainsOf = tool => [...tool.domains, ...(tool.overall ? [{ id: OVERALL, short: 'Overall', label: 'Overall judgement' }] : [])];
const judgementsOf = (tool, d) => d.judgements || tool.judgements || [];

/** The version of the prompt below: a sweep made with another one is made again on a recheck (sweepFingerprint). */
export const SWEEP_PROMPT_V = 2;

/**
 * The full text as a sweep reads it: whitespace runs collapsed and the reference list left out (the last "References" heading in the
 * second half of the text; a report's references cost a fifth to a third of its tokens and decide no domain), cut to `max` characters.
 */
export function textForSweep(text, max = 90000) {
  let t = String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const heads = [...t.matchAll(/\n\s*(references|bibliography|literature cited)\s*:?\s*\n/gi)];
  const last = heads.at(-1);
  if (last && last.index > t.length * 0.5) t = t.slice(0, last.index).trim();
  return t.slice(0, max);
}

/**
 * The messages that ask a model (or tell a reviewer) for one sweep of one study. Everything that is the same for the three readings of a
 * study (the instructions, the instrument, the target and the text) comes first and the reading last, so a provider that caches a
 * prompt's beginning (DeepSeek by itself, Claude with cache_control) reads the text once per study, not once per reading.
 */
export function sweepPrompt({ tool, study, text, stance, target = null, max = 90000 }) {
  const st = STANCES[stance];
  if (!st) throw new Error(`no stance ${stance}: use ${STANCE_IDS.join(', ')}`);
  const lines = domainsOf(tool).map(d => {
    const qs = (d.questions || []).map(q => `    ${q.id}: ${q.text} [${(q.answers || []).join(', ')}]`).join('\n');
    return `- ${d.id} (${d.short || d.id}) ${d.label || ''}: judgement one of [${judgementsOf(tool, d).join(' | ')}]${qs ? `\n  signalling questions:\n${qs}` : ''}`;
  }).join('\n');
  const goal = target ? Object.entries(target).filter(([, v]) => v && typeof v === 'string').map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  const system = `You are an experienced systematic reviewer appraising one study with ${tool.name}, from the reading named at the end of the request.
Answer every domain. For each, give the signalling answers (when the domain has questions), the judgement, a reason of one to three sentences that names what in the report decided it, and up to three verbatim quotes from the text (copied exactly, with the page when the text shows it). Never invent a quote: if the report is silent, say so in the reason and give no quote.
Reply with one JSON object only: {"domains": {"<domain id>": {"answers": {"<question id>": "<answer>"}, "judgement": "<judgement>", "why": "<reason>", "quotes": [{"text": "<verbatim>", "page": <number or null>}]}}}`;
  const user = `Instrument domains:\n${lines}\n\n${goal ? `What is appraised (the review's target, keep to it):\n${goal}\n\n` : ''}Study: ${study}\n\nFull text:\n${textForSweep(text, max)}\n\nReading: ${st.label}. ${st.rule}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** FNV-1a, 32 bits, hex: a short, stable hash of a string (not for security). */
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
/**
 * What a sweep was made from: the prompt version, the instrument's domains, questions and judgements, the target, the text it read and
 * the model. A recheck makes a sweep again only when this changed (the text was corrected, the target or the instrument changed, a new
 * prompt), so a review that changed nothing costs nothing.
 */
export function sweepFingerprint({ tool, text, target = null, model = '', max = 90000 }) {
  const inst = domainsOf(tool).map(d => [d.id, judgementsOf(tool, d), (d.questions || []).map(q => [q.id, q.text, q.answers])]);
  const t = textForSweep(text, max);
  return `v${SWEEP_PROMPT_V}-${fnv(JSON.stringify([tool.id || tool.name, inst]))}-${fnv(JSON.stringify(target || {}))}-${fnv(t)}${fnv(t.split('').reverse().join(''))}-${fnv(String(model))}`;
}

/** A sweep from a model's or reviewer's JSON (text or object): only known domains, answers and judgements; problems listed. */
export function parseSweep(raw, tool) {
  let o = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    try { o = JSON.parse(m ? m[0] : raw); } catch { return { domains: {}, problems: ['not JSON'] }; }
  }
  const src = o?.domains || o || {}, domains = {}, problems = [];
  for (const d of domainsOf(tool)) {
    const x = src[d.id] || src[d.short] || src[String(d.short || '').toLowerCase()];
    if (!x) { problems.push(`${d.id}: missing`); continue; }
    const allowed = judgementsOf(tool, d);
    const judgement = allowed.find(j => j.toLowerCase() === String(x.judgement || '').trim().toLowerCase()) || '';
    if (!judgement) problems.push(`${d.id}: judgement "${x.judgement}" is not one of the instrument's`);
    const answers = {};
    for (const q of d.questions || []) {
      const a = String(x.answers?.[q.id] ?? '').trim().toUpperCase();
      if (a && (q.answers || []).includes(a)) answers[q.id] = a; else if (a) problems.push(`${d.id}.${q.id}: answer "${a}" is not allowed`);
    }
    const quotes = (Array.isArray(x.quotes) ? x.quotes : []).slice(0, 5).map(q => (typeof q === 'string' ? { text: q } : { text: String(q?.text || ''), ...(q?.page != null && q.page !== '' ? { page: Number(q.page) || q.page } : {}) })).filter(q => q.text.trim());
    domains[d.id] = { judgement, ...(Object.keys(answers).length ? { answers } : {}), why: String(x.why || x.reason || '').trim().slice(0, 1200), quotes };
  }
  return { domains, problems };
}

const norm = t => String(t || '').normalize('NFKC').replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const onPage = (quote, page) => norm(page).includes(norm(quote));
/** Marks `q` (a quote object; its words `quote`) as read by text recognition when its page is one of `ocrPages`: sets ocr and page, answers true. */
export function markOcrQuote(q, quote, text, ocrPages) {
  const p = ocrPageOf(quote, text, ocrPages, q.page, onPage);
  if (p == null) { delete q.ocr; return false; }
  q.ocr = true; q.page = p; return true;
}
/**
 * Marks each quote found (verbatim, whitespace and dashes aside) in the full text or not; answers the count not found. A quote on a page read
 * by text recognition (`ocrPages`) is marked `ocr`, counted apart in sweep.quotesOcr.
 */
export function checkQuotes(sweep, text, ocrPages = []) {
  const hay = norm(text);
  let missing = 0, ocr = 0;
  for (const d of Object.values(sweep.domains || {})) for (const q of d.quotes || []) { q.found = hay.includes(norm(q.text)); if (!q.found) missing++; if (markOcrQuote(q, q.text, text, ocrPages)) ocr++; }
  if (ocr) sweep.quotesOcr = ocr; else delete sweep.quotesOcr;
  return missing;
}

/**
 * The recorded assessment beside the sweeps, domain by domain: [{ domain, short, label, recorded, sweeps: { [stance]: judgement },
 * spread (ranks apart, 0 when they agree), state: 'robust' | 'depends' | 'outside' (the recorded is beyond every sweep) | 'partial' }].
 * `rule` the project's overall rule (lib/rob-overall.mjs robOverallRule): where it fixes the overall, a sweep's overall is the one its own
 * domains give under it, not the one it wrote.
 */
export function compareSweeps(s, paperId, tool, sweeps = {}, rule = undefined) {
  const rec = finalAnswers(s, paperId, tool.id, STUDY), out = [];
  // a key is a stance ("neutral") or a stance and who swept it ("neutral:sonnet"): a team's sweeps of one stance sit together
  const keys = Object.keys(sweeps).filter(k => STANCES[k.split(':')[0]]);
  for (const d of domainsOf(tool)) {
    const by = {}, ranks = [];
    for (const k of keys) {
      const j = d.id === OVERALL ? sweepOverall(tool, sweeps[k], rule) : sweeps[k]?.domains?.[d.id]?.judgement;
      if (!j) continue;
      const st = k.split(':')[0];
      (by[st] ||= []).includes(j) || by[st].push(j);
      const r = rankOf(tool, j); if (r != null) ranks.push(r);
    }
    const r = rankOf(tool, rec[d.id]);
    const spread = ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0;
    const state = ranks.length < 2 ? 'partial' : r != null && (r < Math.min(...ranks) || r > Math.max(...ranks)) ? 'outside' : spread ? 'depends' : 'robust';
    out.push({ domain: d.id, short: d.short || d.id, label: d.label || '', recorded: rec[d.id] || '', sweeps: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.join(' / ')])), spread, state });
  }
  return out;
}

/** A sweep's overall: under a rule that fixes it, the one its domains give (its own while a domain is missing); else what it wrote. */
function sweepOverall(tool, sweep, rule) {
  const own = sweep?.domains?.[OVERALL]?.judgement || '';
  if (!rule) return own;
  const d = derivedOverall(tool, Object.fromEntries(tool.domains.map(x => [x.id, sweep?.domains?.[x.id]?.judgement])), rule);
  return d.exact && d.value ? d.value : own;
}

export const sweepsOf = (s, paperId, toolId) => s.robSweeps?.studies?.[paperId]?.[toolId] || {};

/**
 * What the adjudication against the full text decided for each contested domain of a study: { [domain]: { verdict, recorded, confidence,
 * reason, at, by } } (robSweeps.adjudicated, recorded by `lykos sweep <folder> adjudicate`). A judgement that is outside every sweep or
 * depends on the reading and has one was reviewed; compareSweeps reports it as 'kept' (the verdict is the recorded judgement) or 'changed'.
 */
export const adjudicationOf = (s, paperId, toolId) => s.robSweeps?.adjudicated?.[paperId]?.[toolId] || {};

/**
 * Another reviewer's own review beside it (a second model such as Codex, a co-author): robSweeps.reviews[reviewer][paper][tool][domain] =
 * { verdict, recorded, confidence, reason, quotes, by, at }. It never changes what is recorded; it is read next to it, agreeing or not.
 */
export const reviewsBy = s => Object.keys(s.robSweeps?.reviews || {});
export const reviewOfReviewer = (s, reviewer, paperId, toolId) => s.robSweeps?.reviews?.[reviewer]?.[paperId]?.[toolId] || {};
/** A reviewer's word on one row: '' (not reviewed), 'agrees' (its verdict is what is recorded), 'differs'. */
export const agreementOf = (row, rev) => { const a = rev?.[row.domain]; return !a ? '' : a.verdict === row.recorded ? 'agrees' : 'differs'; };

/**
 * A judgement that needs a reviewer's look: recorded outside every sweep, or depending on the reading with a neutral reading (any model's)
 * that is not what is recorded. One where every neutral reading is the recorded judgement, and only the pessimistic or optimistic one is
 * apart, is the reading's own range, not a disagreement.
 */
export function isContested(row) {
  if (row.state === 'outside') return true;
  if (row.state !== 'depends') return false;
  const neutral = String(row.sweeps?.neutral || '').split(' / ').filter(Boolean);
  return neutral.length > 0 && neutral.some(j => j !== row.recorded);
}

/** The review of one compared row: '' (none), 'kept' (the verdict is what is recorded now), 'changed' (recorded now as the verdict), 'proposed' (a verdict not applied, low confidence). */
export function reviewOf(row, adj) {
  const a = adj?.[row.domain];
  if (!a) return '';
  if (a.verdict === row.recorded) return a.recorded === a.verdict ? 'kept' : 'changed';
  return 'proposed';
}

/**
 * compareSweeps with each row's review (reviewOf), and an overall judgement that is what the study's recorded domains give under the
 * project's rule (lib/rob-overall.mjs derivedOverall; by default the worst domain) marked 'follows': it is not judged on its own, so a
 * sweep that reads it differently is answered by the review of the domains.
 */
export function reviewedRows(s, paperId, tool, sweeps, adj, rule = undefined) {
  const rows = compareSweeps(s, paperId, tool, sweeps, rule).map(r => ({ ...r, review: reviewOf(r, adj) }));
  const isOverall = r => /^overall$/i.test(r.domain) || /^overall$/i.test(r.short);
  const doms = Object.fromEntries(rows.filter(r => !isOverall(r)).map(r => [r.domain, r.recorded]));
  const given = derivedOverall(tool, doms, rule || undefined);
  const follows = j => (given.exact ? j === given.value : rankOf(tool, j) != null && rankOf(tool, j) === rankOf(tool, given.value));
  for (const r of rows) if (isOverall(r) && !r.review && given.value && follows(r.recorded)) r.review = 'follows';
  return rows;
}

/** Across the studies of an instrument, for one domain: how many each stance puts at each judgement, and how many the recorded does. */
export function domainTally(s, tool, domain, paperIds, rule = undefined) {
  const t = { recorded: {}, ...Object.fromEntries(STANCE_IDS.map(x => [x, {}])) };
  for (const id of paperIds) {
    const row = compareSweeps(s, id, tool, sweepsOf(s, id, tool.id), rule).find(r => r.domain === domain);
    if (!row) continue;
    if (row.recorded) t.recorded[row.recorded] = (t.recorded[row.recorded] || 0) + 1;
    for (const [st, js] of Object.entries(row.sweeps)) for (const j of js.split(' / ')) t[st][j] = (t[st][j] || 0) + 1;
  }
  return t;
}

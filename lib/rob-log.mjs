// The risk-of-bias decision log (Batch 13 item 4; plan H3, §4.4): per included study, the instrument, the target result, each domain's
// judgement with the passages that support it and their pages, the signalling answers, the overall judgement, the assessment scope and
// the author-verification status, read from the appraisal state and written as a document of the package (lib/package-sources.mjs
// `generated: 'rob-log'`). Pure over the project state: nothing is judged here, nothing is drafted; a judgement with no passage is
// listed as resting on no quotation, as the review's own log does, and a passage a model filed and nobody checked is said to be so.
import { allTools } from '../schema.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { includedStudies } from './progress.mjs';
import { outcomes } from './outcomes.mjs';
import { STUDY, OVERALL, finalAnswers, assessedAt, consensusState, secondOn, contextOf, recordOf } from './rob-review.mjs';

const str = v => (v == null ? '' : String(v)).trim();
const esc = s => str(s);
export const NO_QUOTATION = 'No quotation: the judgement rests on the absence of information';

/** A support note's parts: "ROBINS-I V2 D1: Serious — "passage" — rationale" → { judgement, quote, rationale }. */
export function parseSupport(text, head) {
  const rest = str(text).slice(head.length).replace(/^:\s*/, '');
  const parts = rest.split(/\s+—\s+/);
  const judgement = str(parts[0]);
  let quote = '', rationale = '';
  for (const p of parts.slice(1)) { const q = /^["“](.*)["”]$/s.exec(str(p)); if (q && !quote) quote = q[1]; else rationale = rationale ? `${rationale} — ${p}` : str(p); }
  return { judgement, quote, rationale };
}

/** The verification status of a level's assessment, in words a reader of the log can check. */
export function verificationText(s, paperId, tool, level, supports) {
  const c = consensusState(s, paperId, tool, level);
  const drafted = supports.filter(x => x.drafted).length;
  const base = c.state === 'agreed' ? `Consensus of two reviewers confirmed${c.at ? ` ${String(c.at).slice(0, 10)}` : ''}`
    : c.state === 'ready' ? 'Both reviewers answered; consensus not confirmed'
    : c.state === 'open' ? `Two reviewers; ${c.open} ${c.open === 1 ? 'domain' : 'domains'} to reconcile`
    : c.state === 'waiting' ? 'Second reviewer pending'
    : c.state === 'empty' ? 'Not assessed'
    : 'One reviewer; not independently verified';
  return drafted ? `${base}; ${drafted} ${drafted === 1 ? 'passage' : 'passages'} filed by a model and not checked` : base;
}

const levelsOf = (s, paperId, toolId) => {
  const rec = s.robReview?.records?.[paperId]?.[toolId] || {};
  const own = Object.keys(rec).filter(l => assessedAt(s, paperId, toolId, l));
  if (!own.length && Object.keys(s.assessments?.[paperId]?.[toolId] || {}).length) own.push(STUDY);
  return own.sort((a, b) => (a === STUDY ? -1 : b === STUDY ? 1 : 0));
};

/**
 * The log: `{ title, studies: [{ id, label, instrument, levels: [{ level, target, scope, context, judgements: [{ id, short, label,
 * judgement, support: [{ quote, page, rationale, drafted }], questions: [{ code, text, answer }] }], overall, verification }] }],
 * counts: { studies, assessed, instruments } }`. Studies in label order; a study with no assessment is listed with none.
 */
export function decisionLog(s) {
  const tools = allTools(s), byId = new Map(tools.map(t => [t.id, t]));
  const names = new Map(outcomes(s).map(o => [o.id, o.name]));
  const notes = s.notes || [];
  const studies = [...includedStudies(s)].sort((a, b) => str(a.label).localeCompare(str(b.label))).map(p => {
    const tool = byId.get(instrumentFor(s, p.id)?.id) || instrumentFor(s, p.id);
    const cols = [...tool.domains, ...(tool.overall ? [{ id: OVERALL, short: 'Overall', label: 'Overall' }] : [])];
    const mine = notes.filter(n => n.paper === p.id && str(n.text).startsWith(`${tool.name} `));
    const contextNotes = mine.filter(n => /^Assessment context:/.test(str(n.text).slice(tool.name.length + 1))).map(n => str(n.text).slice(tool.name.length + 1).replace(/^Assessment context:\s*/, ''));
    const levels = levelsOf(s, p.id, tool.id).map(level => {
      const final = finalAnswers(s, p.id, tool.id, level), ctx = contextOf(s, p.id, tool.id, level);
      const supportsAll = [];
      const judgements = cols.map(d => {
        const head = `${tool.name} ${d.short}`;
        const support = mine.filter(n => n.kind === 'quote' && str(n.text).startsWith(`${head}:`)).map(n => {
          const x = parseSupport(n.text, head);
          return { quote: x.quote, page: str(n.page), rationale: x.rationale, judgement: x.judgement, drafted: /^model:/.test(str(n.extractor)) && n.verification !== 'verified' };
        });
        supportsAll.push(...support);
        const questions = (d.questions || []).map((q, k) => ({ code: `${d.short}.${k + 1}`, text: str(q.text), answer: str(final[`${d.id}.${q.id}`]) })).filter(q => q.answer);
        return { id: d.id, short: d.short, label: d.label, judgement: str(final[d.id]), support, questions };
      });
      return { level, target: str(ctx.target) || (level !== STUDY ? names.get(level) || level : ''), scope: str(ctx.scope), context: contextNotes.join('\n'),
        judgements, overall: str(final[OVERALL]), verification: verificationText(s, p.id, tool, level, supportsAll) };
    });
    return { id: p.id, label: str(p.label), instrument: { id: tool.id, name: tool.name }, pdf: str(p.pdf), levels };
  });
  const instruments = [...new Set(studies.filter(x => x.levels.length).map(x => x.instrument.name))];
  return { title: 'Risk-of-bias assessment: decision log', studies, counts: { studies: studies.length, assessed: studies.filter(x => x.levels.length).length, instruments },
    twoReviewers: secondOn(s) };
}

// ---- as a document ------------------------------------------------------------------------------------------------------------
let n = 0;
const bid = () => `rl${(n++).toString(36)}`;
const para = (text, props = {}, styleId = 'Normal') => ({ id: bid(), type: 'p', styleId, props, text, runs: [{ t: text }] });
const heading = (text, type) => ({ id: bid(), type, text, runs: [{ t: text }] });
const cell = (text, b = false) => ({ runs: [{ t: str(text), ...(b ? { b: true } : {}) }] });
const table = (cols, head, rows, { header = true } = {}) => ({ id: bid(), type: 'table', text: '', grid: { cols, borders: 'all',
  rows: [{ header, cells: head.map(h => cell(h, true)) }, ...rows.map(r => ({ header: false, cells: r.map(c => (c && typeof c === 'object' && c.runs ? c : cell(c))) }))] } });
const shown = v => v || '—';

/** The log as the package's blocks: a title, how to read it, the results at a glance, then one section per study with its tables. */
export function decisionLogBlocks(log) {
  n = 0;
  const out = [heading(log.title, 'title')];
  out.push(para(`${log.counts.assessed} of ${log.counts.studies} included studies appraised${log.counts.instruments.length ? ` with ${log.counts.instruments.join(', ')}` : ''}. Every judgement is listed with the passages filed for it and their PDF pages; a judgement without a passage rests on the absence of information. ${log.twoReviewers ? 'Two reviewers answered independently; each study says where its reconciliation stands.' : 'One reviewer answered; no judgement is independently verified.'}`));
  out.push(heading('Results at a glance', 'h1'));
  out.push(table([30, 130, 110, 110, 150], ['ID', 'Study', 'Instrument', 'Overall', 'Verification'],
    log.studies.map((x, i) => { const lv = x.levels[0]; return [String(i + 1), x.label, x.instrument.name, lv ? shown(lv.overall || `${lv.judgements.filter(j => j.judgement && j.id !== OVERALL).length} of ${lv.judgements.filter(j => j.id !== OVERALL).length} judged`) : 'Not assessed', lv ? lv.verification : '—']; })));
  log.studies.forEach((x, i) => {
    out.push({ ...heading(`${i + 1}. ${x.label} (${x.instrument.name})`, 'h1'), props: { pageBreakBefore: true } });
    if (!x.levels.length) { out.push(para('Not assessed.')); return; }
    for (const lv of x.levels) {
      if (x.levels.length > 1 || lv.level !== STUDY) out.push(heading(lv.level === STUDY ? 'Study level' : `Result: ${lv.target}`, 'h2'));
      const facts = [['Assessed result', lv.target || 'The study as a whole'], ['Scope', lv.scope], ['Overall judgement', lv.overall], ['Verification', lv.verification], ['Assessment context', lv.context]].filter(([, v]) => v);
      for (const [k, v] of facts) out.push({ ...para(`${k}: ${v}`), runs: [{ t: `${k}: `, b: true }, { t: v }] });
      out.push(table([110, 60, 170, 30, 160], ['Domain', 'Judgement', 'Supporting text (as cited)', 'PDF p.', 'Reason'],
        lv.judgements.map(j => {
          const quotes = j.support.length ? j.support.map(q => q.quote ? `“${q.quote}”` : NO_QUOTATION).join('\n') : (j.judgement ? NO_QUOTATION : '');
          const pages = [...new Set(j.support.map(q => q.page).filter(Boolean))].join(', ');
          const reasons = j.support.map(q => [q.rationale, q.drafted ? '(filed by a model, not checked)' : ''].filter(Boolean).join(' ')).filter(Boolean).join('\n');
          return [`${j.short} ${j.label}`, cell(shown(j.judgement), true), quotes, pages, reasons];
        })));
      const qs = lv.judgements.flatMap(j => j.questions);
      if (qs.length) {
        out.push(para('Signalling questions', { keepNext: true }));
        out.push(table([50, 380, 100], ['Item', 'Question', 'Answer'], qs.map(q => [q.code, q.text, q.answer])));
      }
    }
  });
  return out;
}

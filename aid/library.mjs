import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the library view (lib/aid.mjs).
//
// Both actions read a record's title and abstract, nothing else, and every
// claim they make rests on a phrase the abstract contains; a claim whose
// quote is not in the record is dropped before anyone sees it (plan §5.1).
import { register, jsonOf, quoteIn, recordBrief } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { fieldById, setAnchoredValue } from '../lib/fields.mjs';
import { get, update } from '../store.mjs';

const focused = (s, ctx) => ctx?.focus?.kind === 'record' && ctx.focus.paperId
  ? (s.papers || []).find(p => p.id === ctx.focus.paperId) || null : null;
const sourceText = p => `${p.title || ''}\n\n${p.abstract || ''}`;

export const DESIGNS = ['RCT', 'prospective cohort', 'retrospective cohort', 'case series', 'case-control',
  'cross-sectional', 'systematic review', 'other'];
const BATCH = 20;
const NO_ANSWER = 'No answer from the model';

/**
 * What a cell holds, as a token to compare: '' for nothing. Recorded when the
 * model is asked, so accepting later cannot silently replace a value a person
 * entered or verified in the meantime.
 */
export const heldBy = v => v ? JSON.stringify([v.at || '', v.reported_value ?? '', v.verification || '']) : '';

/**
 * Keeps the parts of a summary reply that the abstract supports: findings
 * whose quote is in it, and the summary itself only when at least one finding
 * survived, since a summary with nothing verifiable under it is not checked.
 */
export function keepSummary(reply, p) {
  const src = sourceText(p);
  const findings = (Array.isArray(reply?.findings) ? reply.findings : [])
    .filter(f => f && f.text && quoteIn(f.quote, src))
    .slice(0, 3)
    .map(f => ({ text: String(f.text).trim().slice(0, 300), quote: String(f.quote).trim().slice(0, 400) }));
  const summary = findings.length ? String(reply?.summary || '').trim().slice(0, 800) : '';
  return { findings, summary };
}

/** A design as the list names it, or '' when the reply's is not on the list. */
const designOf = x => { const d = String(x || '').trim().toLowerCase(); return d === 'rct' ? 'RCT' : DESIGNS.includes(d) ? d : ''; };

/** Keeps the design proposals whose record exists, whose design is on the list and whose quote is in that record. */
export function keepDesigns(reply, papers) {
  const byId = new Map(papers.map(p => [p.id, p]));
  return (Array.isArray(reply?.designs) ? reply.designs : [])
    .filter(d => d && byId.has(d.id) && designOf(d.design) && quoteIn(d.quote, sourceText(byId.get(d.id))))
    .map(d => ({ paper: byId.get(d.id), design: designOf(d.design), quote: String(d.quote).trim().slice(0, 400) }));
}

/** Records with an abstract and no design value yet: the ones classifying helps. */
const unclassified = s => (s.papers || []).filter(p => p.abstract && !s.values?.[`${p.id}:design`]?.reported_value);

const proposeSummary = durableAction('library-note', ({ paperId, summary, model }) => {
  // Shaped as the reader's notes are; a paraphrase of the
  // abstract, with no page and no anchor because none was read.
  update(s => {
    s.notes = [...(s.notes || []), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, paper: paperId, kind: 'paraphrase',
      text: summary, page: null, rects: null, document_version: null, source: 'abstract',
      extractor: `model:${model || 'unknown'}`, at: new Date().toISOString() }];
    return s;
});
return 'Added to notes';
});

const proposeDesign = durableAction('study-design', ({ paper, field, design, quote, was, model }) => {
  const cur = get().values?.[`${paper.id}:${field.id}`];
  if (heldBy(cur) !== was) return { refused: `${field.label} was set since; read it again` };
  if (cur?.verification === 'verified') return { refused: `${field.label} is verified` };
  // Stored as extraction's "From abstracts" stores a model-read
  // value, so it counts as unverified until checked at source.
  setAnchoredValue(paper.id, field.id, { reported_value: design, normalized_value: design,
    origin: 'model', extractor: `model:${model || 'unknown'}`, evidence: [{ kind: 'abstract', quote: quote }] });
  return `${paper.label}: design set`;
});

register('library', [
  {
    id: 'summarise-record',
    label: 'Summarise this record',
    icon: 'library',
    task: 'assist',
    when: (s, ctx) => !!focused(s, ctx)?.abstract,
    // The record is sent below, fenced, so the brief carries only its label.
    brief: { record: false, criteria: false },
    async run({ state, cfg, signal, brief, context }) {
      const p = focused(state, context);
      const out = await complete(cfg, P.messagesOf(P.librarySummarise, { brief, record: recordBrief(p) }), { prompt: P.librarySummarise, signal, temperature: 0, json: true });
      const reply = jsonOf(out);
      const { findings, summary } = keepSummary(reply, p);
      const where = { paperId: p.id, label: p.label };
      const answered = Array.isArray(reply?.findings) && reply.findings.length;
      return {
        title: `Summary of ${p.label}`,
        prompt: promptRef(P.librarySummarise),
        note: !answered ? NO_ANSWER : findings.length ? '' : 'Nothing in the reply could be found in the abstract',
        items: [
          ...findings.map(f => ({ label: f.text, quote: f.quote, where })),
          ...(summary ? [{
            label: summary,
            detail: 'Note on the record',
            where,
            acceptLabel: 'Add to notes',
            ...proposeSummary({ paperId: p.id, summary, model: cfg.model }),
          }] : []),
        ],
      };
    },
  },
  {
    id: 'classify-design',
    label: 'Classify study design',
    icon: 'table',
    task: 'extract',
    // The focused record, or else the records still without a design.
    when: (s, ctx) => { const p = focused(s, ctx); return p ? !!p.abstract : unclassified(s).length > 0; },
    async run({ state, cfg, signal, brief, context, progress }) {
      const one = focused(state, context);
      const targets = one ? [one] : unclassified(state).slice(0, BATCH);
      const field = fieldById('design', state);
      if (!field) throw new Error('This project has no Design field');
      progress(`${targets.length} ${targets.length === 1 ? 'record' : 'records'}`);
      const out = await complete(cfg, P.messagesOf(P.libraryClassify, { brief, designs: DESIGNS, records: targets.map(p => ({ id: p.id, text: recordBrief(p) })) }),
        { prompt: P.libraryClassify, signal, temperature: 0, maxTokens: 300 + 120 * targets.length, json: true });
      const reply = jsonOf(out);
      const got = keepDesigns(reply, targets);
      const offered = Array.isArray(reply?.designs) ? reply.designs.length : 0;
      // The model is told to leave out a record it cannot classify; those are
      // counted, so a partial reply does not read as the whole batch done.
      const left = targets.length - new Set(got.map(d => d.paper.id)).size;
      return {
        prompt: promptRef(P.libraryClassify),
        title: one ? `Design of ${one.label}` : `Designs of ${targets.length} records`,
        note: [!Array.isArray(reply?.designs) ? NO_ANSWER : !got.length && 'No design could be read from the abstracts',
          got.length && left && `${left} not classified`,
          offered > got.length && `${offered - got.length} dropped: quote not in record`].filter(Boolean).join('; '),
        items: got.map(d => {
          const cell = get().values?.[`${d.paper.id}:${field.id}`];
          const now = cell?.reported_value, was = heldBy(cell);
          return {
            label: `${d.paper.label}: ${d.design}`,
            detail: now ? `Now: ${now}` : '',
            quote: d.quote,
            where: { paperId: d.paper.id, label: d.paper.label },
            acceptLabel: 'Set design',
            ...proposeDesign({ paper: { id: d.paper.id, label: d.paper.label }, field: { id: field.id, label: field.label }, design: d.design, quote: d.quote, was, model: cfg.model }),
          };
        }),
      };
    },
  },
]);

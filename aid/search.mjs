import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the search view (lib/aid.mjs).
//
// Every action works on the query in the box and the source chosen beside it,
// as the view reports them through focus(). A proposed query is only put in
// the box on accept; it never runs, because a search is a recorded action the
// person issues (plan B1, B6).
import { register, jsonOf } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { parseQuery } from '../lib/boolean.mjs';
import { SOURCES } from '../lib/sources.mjs';

const queryOf = ctx => String(ctx?.focus?.kind === 'query' ? ctx.focus.text || '' : '').trim();
const sourceOfCtx = ctx => SOURCES.find(o => o.id === ctx?.focus?.source) || SOURCES[0];
const hasPico = s => Object.values(s.protocol?.pico || {}).some(v => String(v || '').trim());

// What each source's query language is, so a model writing for it is told
// the syntax rather than left to guess it.
const SYNTAX = {
  pubmed: 'PubMed: AND/OR/NOT in capitals, parentheses, "quoted phrases", truncation with *, field tags such as [tiab], [ti], [mh] (MeSH, explodes by default), [mh:noexp], [pt].',
  epmc: 'Europe PMC: AND/OR/NOT in capitals, parentheses, "quoted phrases", truncation with *, fields as prefixes: TITLE:, ABSTRACT:, KW:, AUTH:, JOURNAL:, PUB_TYPE:; MeSH through MESH_HEADING:"term"; no [tag] suffixes.',
  openalex: 'OpenAlex: plain words and "quoted phrases" with AND/OR/NOT in capitals and parentheses; no field tags, no MeSH.',
  crossref: 'Crossref: plain words only, ranked by relevance; no boolean operators, no field tags, no MeSH.',
  ctgov: 'ClinicalTrials.gov: condition and intervention words, AND/OR/NOT in capitals, parentheses, "quoted phrases"; no field tags, no MeSH.',
};

/** Parser problems in a query, or '' when it reads cleanly. */
function problems(q) {
  const { errors } = parseQuery(q);
  // Mixing is judged with the field tags taken out: the parser reads
  // `spinal fusion[tiab]` as two terms joined by an implied AND, which would
  // make every tagged phrase inside an OR group look mixed.
  const { tree } = parseQuery(String(q).replace(/\[[^\]]*\]/g, ''));
  let mixed = false;
  const walk = n => { if (!n || n.term != null) return; if (n.mixed) mixed = true; n.children.forEach(walk); };
  walk(tree);
  return [...errors, ...(mixed ? ['AND and OR mixed at one level without parentheses'] : [])].join('; ');
}

/** The words of a query, without operators, tags or quotes, for checking a rewrite kept them. */
const words = q => (String(q || '').replace(/\[[^\]]*\]|\b[A-Z_]+:/g, ' ').toLowerCase()
  .replace(/\b(and|or|not)\b/g, ' ').match(/[a-z0-9][a-z0-9'-]{2,}/g) || []);

/** A reply's query, cleaned; '' when there is none. */
const NO_ANSWER = 'No answer from the model';
const cleanQuery = x => String(x || '').replace(/^```[a-z]*\n?|```$/g, '').replace(/\s+/g, ' ').trim().slice(0, 4000);

/**
 * Keeps a proposed query only if it parses and, when it expands an existing
 * one, still contains every word of it: an expansion that silently drops a
 * concept is a different search, not a broader one.
 */
export function checkExpansion(original, proposed) {
  const q = cleanQuery(proposed);
  if (!q) return { ok: false, why: 'No query in the reply' };
  const bad = problems(q);
  if (bad) return { ok: false, why: `Proposed query does not parse: ${bad}` };
  const have = new Set(words(q));
  const lost = [...new Set(words(original))].filter(w => !have.has(w));
  if (lost.length) return { ok: false, why: `Proposed query drops ${lost.slice(0, 6).join(', ')}` };
  return { ok: true, query: q };
}

const translateTo = target => ({
  id: `translate-${target}`,
  label: `Translate for ${SOURCES.find(o => o.id === target)?.name || target}`,
  icon: 'search',
  task: 'query',
  when: (s, ctx) => !!queryOf(ctx) && sourceOfCtx(ctx).id !== target,
  async run({ cfg, signal, brief, context }) {
    const from = sourceOfCtx(context), to = SOURCES.find(o => o.id === target);
    const query = queryOf(context);
    const out = await complete(cfg, P.messagesOf(P.searchTranslate, { brief, from: from.name, to: to.name, syntax: SYNTAX[target] || to.name, query }),
      { prompt: P.searchTranslate, signal, temperature: 0, json: true });
    const prompt = promptRef(P.searchTranslate);
    const got = jsonOf(out);
    const q = cleanQuery(got.query);
    if (!q) return { title: `Translation for ${to.name}`, note: NO_ANSWER, items: [], prompt };
    const bad = problems(q);
    if (bad) return { title: `Translation for ${to.name}`, note: `Not usable: ${bad}`, items: [], prompt };
    const changes = (Array.isArray(got.changes) ? got.changes : []).map(c => String(c).slice(0, 160)).filter(Boolean);
    return {
      title: `Translation for ${to.name}`,
      prompt,
      items: [{
        label: q,
        detail: [`From ${from.name}: ${query}`, ...changes].join('\n'),
        acceptLabel: `Use for ${to.name}`,
        ...proposeQuery({ query: q, source: target, message: `${to.name} query in the box` }),
      }],
    };
  },
});

const proposeQuery = durableAction('query', async ({ query, source, message }) => {
  (await import('../views/search.mjs')).loadQuery(query, source); return message;   // the Literature page loads on first use
});

register('search', [
  {
    id: 'expand-query',
    label: 'Add synonyms and MeSH',
    icon: 'search',
    task: 'query',
    when: (s, ctx) => !!queryOf(ctx) || hasPico(s),
    async run({ cfg, signal, brief, context, selection }) {
      const src = sourceOfCtx(context);
      const query = queryOf(context);
      // A selection inside the query narrows the expansion to that concept.
      const part = selection && query.includes(selection.trim()) ? selection.trim() : '';
      // The selection is the person's text, so the prompt puts it in their message, not the instructions.
      const out = await complete(cfg, P.messagesOf(P.searchExpand, { brief, source: src.name, syntax: SYNTAX[src.id] || src.name, query, part,
        mesh: src.id === 'pubmed' || src.id === 'epmc' }), { prompt: P.searchExpand, signal, temperature: 0, json: true });
      const prompt = promptRef(P.searchExpand);
      const got = jsonOf(out);
      if (!cleanQuery(got.query)) return { title: 'Expanded query', note: NO_ANSWER, items: [], prompt };
      const check = checkExpansion(query, got.query);
      if (!check.ok) return { title: 'Expanded query', note: check.why, items: [], prompt };
      if (query && check.query === query) return { title: 'Expanded query', note: 'Nothing to add', items: [], prompt };
      const concepts = (Array.isArray(got.concepts) ? got.concepts : [])
        .filter(c => c && c.concept && Array.isArray(c.added) && c.added.length)
        .map(c => `${String(c.concept).slice(0, 60)}: ${c.added.slice(0, 20).map(String).join(', ')}`);
      return {
        title: query ? 'Expanded query' : 'Query from the PICO',
        prompt,
        items: [{
          label: check.query,
          detail: [query && `Now: ${query}`, ...concepts].filter(Boolean).join('\n'),
          acceptLabel: 'Put in the box',
          ...proposeQuery({ query: check.query, source: src.id, message: 'Query in the box' }),
        }],
      };
    },
  },
  {
    id: 'check-query',
    label: 'Check strategy against PICO',
    icon: 'check',
    task: 'query',
    when: (s, ctx) => !!queryOf(ctx),
    async run({ cfg, signal, brief, context }) {
      const src = sourceOfCtx(context);
      const query = queryOf(context);
      // What the parser already knows is stated without asking a model.
      const parsed = problems(query);
      const out = await complete(cfg, P.messagesOf(P.searchCheck, { brief, source: src.name, syntax: SYNTAX[src.id] || src.name, query }),
        { prompt: P.searchCheck, signal, temperature: 0, json: true });
      // A reply without a findings list is no answer; only an empty list says the query is sound.
      const reply = jsonOf(out).findings;
      const got = Array.isArray(reply) ? reply : [];
      const items = [
        ...(parsed ? [{ label: `Structure: ${parsed}` }] : []),
        ...got.filter(f => f && f.problem).slice(0, 12).map(f => ({
          label: String(f.problem).slice(0, 240),
          detail: [f.kind && String(f.kind).slice(0, 20), f.fix && `Fix: ${String(f.fix).slice(0, 240)}`].filter(Boolean).join(' · '),
        })),
      ];
      return { title: 'Strategy check', prompt: promptRef(P.searchCheck), note: !Array.isArray(reply) ? NO_ANSWER : items.length ? '' : 'No problems found', items };
    },
  },
  translateTo('epmc'),
  translateTo('pubmed'),
]);

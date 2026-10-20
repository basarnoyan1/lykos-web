import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the manuscript view (lib/aid.mjs).
//
// The subject of every action here is the block with the caret, as the view
// reports it through focus(): { kind: 'block', blockId, blockType, section,
// text }. The text is the block's source, citation and result tokens intact,
// so what the model is shown is exactly what accept() will find and replace.
//
// Each proposal is made against a hash of the text it read. accept() applies
// it only while the block still holds that text (plan J5: a suggestion is
// never applied blind to text that has changed since).
import { draftBlocks as _draftBlocks } from '../lib/results.mjs';
import { register, jsonOf, quoteIn, recordBrief } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { projectContext, diffWords } from '../lib/assist.mjs';
import { blankBlock, hashText, citations, resultTokens } from '../lib/manuscript.mjs';
import { results as allResults } from '../lib/results.mjs';
import { funnel } from '../lib/progress.mjs';
import { numbersIn, unsupported, numbersChanged } from '../lib/numbers.mjs';
import { isIncluded } from '../lib/screen.mjs';
import { withoutLabels } from '../lib/numbers.mjs';
import { get, update } from '../store.mjs';
import { typedResults, linkedText, linkableResults } from '../lib/result-links.mjs';

const blocksOf = s => s.manuscript?.blocks || [];
const heading = b => /^h[1-3]$/.test(b?.type || '');
const focusBlock = (s, ctx) => {
  const f = ctx?.focus;
  return f?.kind === 'block' && f.blockId ? blocksOf(s).find(b => b.id === f.blockId) || null : null;
};

/**
 * The section a block sits in: the nearest heading above it (or the block
 * itself when it is one) and the blocks up to the next heading of the same
 * or a higher level.
 */
export function sectionOf(blocks, blockId) {
  const i = blocks.findIndex(b => b.id === blockId);
  if (i < 0) return null;
  let h = i;
  while (h >= 0 && !heading(blocks[h])) h--;
  const end = nextHeading(blocks, h + 1, h < 0 ? 'h9' : blocks[h].type);
  return { heading: h < 0 ? null : blocks[h], start: h, end, body: blocks.slice(h + 1, end) };
}
function nextHeading(blocks, from, level) {
  let j = from;
  while (j < blocks.length && !(heading(blocks[j]) && blocks[j].type <= level)) j++;
  return j;
}
const sectionEmpty = sec => sec && sec.body.every(b => !String(b.text || '').trim());

// ---- numbers, checked in code ---------------------------------------------
// A number in the manuscript is either a linked result token, or text a person
// typed. The checks below compare typed numbers with the values the project
// holds; the model is never asked whether two numbers agree. What counts as a
// number (signs, thousands, names like PRISMA 2020) is lib/numbers.mjs's
// decision, shared with every other action.

/**
 * Every number the project holds, with where it comes from: the saved
 * results as they display, the PRISMA counts, the funnel counts, and the
 * abstracts of the included and the cited records.
 */
export function savedNumbers(s, citedKeys = []) {
  const map = new Map();   // numeric value -> first source label
  const put = (text, where) => { for (const { value } of numbersIn(text)) if (!map.has(value)) map.set(value, where); };
  for (const r of allResults(s)) put(r.text, `${r.label} (${r.key})`);
  // results.mjs reads the pooled estimate as `est`; the analysis view stores
  // `estimate`. Until they agree the estimate is taken from where it is stored,
  // shown to two places as results.mjs shows every effect.
  const a = s.analysis;
  if (a) for (const [k, l] of [['estimate', `Pooled ${a.measure || 'effect'}`], ['lo', 'CI lower'], ['hi', 'CI upper']])
    if (Number.isFinite(Number(a[k]))) put(Number(a[k]).toFixed(2).replace(/\.?0+$/, ''), l);
  for (const [k, v] of Object.entries(s.prisma || {})) put(String(v), `PRISMA ${k}`);
  for (const f of funnel(s)) if (f.n != null) put(String(f.n), `${f.name} count`);
  const cited = new Set(citedKeys);
  for (const p of s.papers || []) if (cited.has(p.key) || isIncluded(s, p.id)) put(`${p.title || ''} ${p.abstract || ''}`, `${p.label} abstract`);
  return map;
}

/** The typed numbers of a text, each found in the project or not. */
export function checkNumbers(text, known) {
  return numbersIn(text).map(n => ({ n: n.text, where: known.get(n.value) || '' }));
}

// ---- the text changes accept() makes ---------------------------------------

/** Replaces a block's whole text, as the view's own revise/accept does. */
function replaceBlock(blockId, hash, text) {
  const b = blocksOf(get()).find(x => x.id === blockId);
  if (!b) throw new Error('The paragraph is gone');
  if (hashText(b.text) !== hash) throw new Error('The paragraph changed since; revise again');
  update(s => { const x = s.manuscript.blocks.find(y => y.id === blockId); if (x) { x.text = text; x.runs = [{ t: text }]; } return s; });
}

/**
 * Replaces one exact substring of a block. Formatting survives when the
 * substring lies inside one text run; a selection across runs loses its
 * formatting, as a whole-paragraph revision does.
 */
export function replaceIn(b, from, to) {
  const at = b.text.indexOf(from);
  if (at < 0 || b.text.indexOf(from, at + 1) >= 0) return null;
  const text = b.text.slice(0, at) + to + b.text.slice(at + from.length);
  const rs = b.runs?.length ? b.runs : null;
  const hit = rs ? rs.filter(r => !r.cite && String(r.t || '').includes(from)) : [];
  const runs = hit.length === 1 ? rs.map(r => (r === hit[0] ? { ...r, t: r.t.replace(from, to) } : r)) : [{ t: text }];
  return { text, runs };
}

export { draftBlocks } from '../lib/results.mjs';

// ---- the facts a section is drafted from -----------------------------------
function draftFacts(s) {
  const res = allResults(s);
  return [projectContext(s),
    `Protocol: ${JSON.stringify({ title: s.protocol?.title, ...(s.protocol?.pico || {}), criteria: (s.protocol?.criteria || []).map(c => `${c.stage}: ${c.text}`) })}`,
    `Searches: ${(s.searches || []).map(r => `${r.source || 'PubMed'} "${r.query}" ${r.at ? r.at.slice(0, 10) : ''} → ${r.total ?? '?'}`).join('; ') || 'none recorded'}`,
    `PRISMA counts: ${JSON.stringify(s.prisma || {})}`,
    `Funnel: ${funnel(s).map(f => `${f.name} ${f.n ?? '—'}`).join('; ')}`,
    res.length ? `Saved results:\n${res.map(r => `  ${r.label}: ${r.text}`).join('\n')}` : 'Saved results: none',
  ].join('\n').slice(0, 6000);
}


/**
 * The typed-results check as proposal items: a typed estimate that states a
 * saved result is offered as links; one that differs from the pooled result
 * its sentence names is reported. No model is asked (plan J7).
 */
export function resultLinkItems(s) {
  const blocks = blocksOf(s), res = allResults(s);
  const hits = typedResults(blocks, res);
  const items = [];
  let plain = 0;
  for (const h of hits) {
    const b = blocks.find(x => x.id === h.blockId);
    const where = String(b.text).slice(Math.max(0, h.start - 50), h.end + 10).trim();
    if (h.match) {
      const link = linkedText(b.text, h, res);
      const hash = hashText(b.text);
      items.push({
        label: `${h.text.trim()}: ${h.match.group} · ${h.match.label}`,
        detail: link ? `Typed; ${link.keys.map(k => `{{${k}}}`).join(' and ')} would keep it current` : 'Typed; the span cannot be linked as written',
        quote: where,
        acceptLabel: 'Link result',
        ...(link ? proposeLinks({ blockId: b.id, hash, start: h.start, end: h.end, link, snapshot: Object.fromEntries(link.keys.map(k => [k, res.find(r => r.key === k)?.text])) }) : { accept: null }),
      });
    } else if (h.contradicts) {
      items.push({ label: `${h.text.trim()} differs from ${h.contradicts.group} · ${h.contradicts.label}: ${h.contradicts.text}`, quote: where });
    } else plain++;
  }
  return { items, plain, results: linkableResults(res).length };
}

const proposeSelection = durableAction('manuscript-selection', ({ blockId, sel, to }) => {
  const now = blocksOf(get()).find(x => x.id === blockId);
  if (!now) throw new Error('The paragraph is gone');
  const next = replaceIn(now, sel, to);
  if (!next) throw new Error('The selected text changed since; select it again');
  update(s => { const x = s.manuscript.blocks.find(y => y.id === blockId); if (x) Object.assign(x, next); return s; });
  return 'Selection replaced';
});

const proposeSection = durableAction('manuscript-section', ({ headingId, empty, paras, linked, name }) => {
  let ok = false;
  update(s => {
    const bs = s.manuscript?.blocks || [];
    const now = sectionOf(bs, headingId);
    if (!now?.heading) return s;
    const add = paras.map(t => blankBlock('p', t));
    // An empty section's blank paragraphs are placeholders; the draft takes their place.
    if (empty && sectionEmpty(now)) bs.splice(now.start + 1, now.end - now.start - 1, ...add);
    else bs.splice(now.end, 0, ...add);
    // Linking a result records the value it was linked at, as the
    // insert panel does, so a later re-run marks it stale (plan J7).
    s.manuscript.snapshot = { ...(s.manuscript.snapshot || {}), ...Object.fromEntries(linked) };
    ok = true;
    return s;
});
if (!ok) throw new Error(`The ${name} heading is gone`);
return `${paras.length} ${paras.length === 1 ? 'paragraph' : 'paragraphs'} inserted`;
});

const proposeParagraph = durableAction('manuscript-paragraph', ({ blockId, hash, revised }) => {
  replaceBlock(blockId, hash, revised); return 'Paragraph replaced';
});

const proposeLinks = durableAction('manuscript-links', ({ blockId, hash, start, end, link, snapshot }) => {
  const now = blocksOf(get()).find(x => x.id === blockId);
  if (!now) return { refused: 'The paragraph is gone' };
  if (hashText(now.text) !== hash) return { refused: 'The paragraph changed since; check again' };
  const span = now.text.slice(start, end);
  const next = replaceIn(now, span, link.text.slice(start, link.text.length - (now.text.length - end)));
  update(st => {
    const x = st.manuscript.blocks.find(y => y.id === blockId);
    if (x) { if (next) Object.assign(x, next); else { x.text = link.text; x.runs = [{ t: link.text }]; } }
    // The value each link was made at, so a later re-run marks it stale.
    st.manuscript.snapshot = { ...(st.manuscript.snapshot || {}), ...snapshot };
    return st;
});
return 'Linked';
});

register('manuscript', [
  {
    id: 'link-results',
    label: 'Link typed results',
    icon: 'check',
    task: 'local',
    local: true,
    when: s => blocksOf(s).some(b => /\d/.test(b.text || '')) && linkableResults(allResults(s)).length > 0,
    async run({ state }) {
      const { items, plain } = resultLinkItems(state);
      return {
        title: 'Typed results',
        note: [!items.length && 'No typed result found', plain && `${plain} other ${plain === 1 ? 'interval' : 'intervals'} not matched to a result`].filter(Boolean).join(' · '),
        items,
      };
    },
  },
  {
    id: 'revise-paragraph',
    label: 'Revise this paragraph',
    icon: 'manuscript',
    task: 'write',
    when: (s, ctx) => { const b = focusBlock(s, ctx); return Boolean(b && !heading(b) && b.text.trim()); },
    async run({ state, cfg, signal, brief, context }) {
      const b = focusBlock(state, context);
      if (!b) throw new Error('No paragraph in focus');
      // The instructions are lib/assist.mjs reviseParagraph's, with the guard
      // and the context added; that helper takes the paragraph alone.
      const out = await complete(cfg, P.messagesOf(P.manuscriptRevise, { brief, paragraph: b.text.slice(0, 4000) }),
        { prompt: P.manuscriptRevise, signal, temperature: 0, maxTokens: Math.min(1200, Math.ceil(b.text.length / 3) + 80) });
      const prompt = promptRef(P.manuscriptRevise);
      const revised = unwrap(out);
      const lost = tokensLost(b.text, revised);
      const changed = numbersChanged(b.text, revised);
      const hash = hashText(b.text);
      if (!revised || revised === b.text) return { title: 'Paragraph revised', note: 'No change proposed', items: [], prompt };
      return {
        title: 'Paragraph revised',
        prompt,
        note: lost.length ? `Dropped ${lost.join(', ')}` : '',
        items: [{
          label: revised,
          detail: changed ? `Numbers changed: ${changed}` : changeSummary(b.text, revised),
          acceptLabel: 'Replace paragraph',
          // A revision that drops a citation or a linked result, or changes a
          // number, is shown, not offered.
          ...(lost.length || changed ? { accept: null } : proposeParagraph({ blockId: b.id, hash, revised })),
        }],
      };
    },
  },
  {
    id: 'tighten-selection',
    label: 'Tighten the selection',
    icon: 'manuscript',
    task: 'write',
    when: (s, ctx) => { const b = focusBlock(s, ctx); const sel = String(ctx?.selection || '').trim(); return Boolean(b && sel.length >= 8 && b.text.includes(sel)); },
    async run({ state, cfg, signal, brief, context }) {
      const b = focusBlock(state, context);
      const sel = String(context.selection || '').trim();
      if (!b || !b.text.includes(sel)) throw new Error('The selection is not inside the paragraph in focus');
      const out = await complete(cfg, P.messagesOf(P.manuscriptTighten, { brief, paragraph: b.text.slice(0, 4000), passage: sel }),
        { prompt: P.manuscriptTighten, signal, temperature: 0, maxTokens: Math.min(800, Math.ceil(sel.length / 3) + 60) });
      const prompt = promptRef(P.manuscriptTighten);
      const to = unwrap(out);
      const lost = tokensLost(sel, to);
      const changed = numbersChanged(sel, to);
      if (!to || to === sel) return { title: 'Selection tightened', note: 'No change proposed', items: [], prompt };
      return {
        title: 'Selection tightened',
        prompt,
        note: lost.length ? `Dropped ${lost.join(', ')}` : '',
        items: [{
          label: to,
          detail: changed ? `Numbers changed: ${changed}` : `${sel.split(/\s+/).length} → ${to.split(/\s+/).length} words`,
          acceptLabel: 'Replace selection',
          ...(lost.length || changed ? { accept: null } : proposeSelection({ blockId: b.id, sel, to })),
        }],
      };
    },
  },
  {
    id: 'check-claims',
    label: 'Check claims against evidence',
    icon: 'check',
    task: 'write',
    when: (s, ctx) => { const b = focusBlock(s, ctx); return Boolean(b && !heading(b) && b.text.trim()); },
    async run({ state, cfg, signal, brief, context }) {
      const b = focusBlock(state, context);
      if (!b) throw new Error('No paragraph in focus');
      const citedKeys = citations(b.text).map(c => c.key);
      const res = allResults(state);
      const linked = resultTokens(b.text).map(r => r.key);
      const papers = (state.papers || []).filter(p => citedKeys.includes(p.key) || isIncluded(state, p.id)).slice(0, 25);
      const material = papers.map(p => `[${p.key}] ${recordBrief(p).slice(0, 1600)}`).join('\n\n');
      const out = await complete(cfg, P.messagesOf(P.manuscriptClaims, { brief, paragraph: b.text.slice(0, 4000), records: material,
        results: res.map(r => `${r.key}: ${r.label} = ${r.text}`).join('\n') }),
      { prompt: P.manuscriptClaims, signal, temperature: 0, json: true });
      const known = savedNumbers(state, citedKeys);
      const items = claimItems(jsonOf(out).claims || [], { paragraph: b.text, known,
        keys: new Set([...papers.map(p => p.key), ...res.map(r => r.key)]), papers, results: res });
      return {
        title: 'Claims checked',
        prompt: promptRef(P.manuscriptClaims),
        note: linked.length ? `${linked.length} linked ${linked.length === 1 ? 'result' : 'results'} not rechecked` : '',
        items,
      };
    },
  },
  {
    id: 'draft-section',
    label: 'Draft this section',
    icon: 'manuscript',
    task: 'write',
    when: (s, ctx) => {
      const b = focusBlock(s, ctx); if (!b) return false;
      const sec = sectionOf(blocksOf(s), b.id);
      return Boolean(sec?.heading?.text.trim() && sec.heading.type !== 'h1' && (heading(b) || sectionEmpty(sec)));
    },
    async run({ state, cfg, signal, brief, context }) {
      const b = focusBlock(state, context);
      const sec = b && sectionOf(blocksOf(state), b.id);
      if (!sec?.heading) throw new Error('No section in focus');
      const name = sec.heading.text.trim();
      const facts = draftFacts(state);
      // The instructions are lib/helpers.mjs draftSection's, with the guard
      // and the context added; that helper takes the facts alone.
      const out = await complete(cfg, P.messagesOf(P.manuscriptDraftSection, { brief, name, facts }), { prompt: P.manuscriptDraftSection, signal, temperature: 0.1 });
      const prompt = promptRef(P.manuscriptDraftSection);
      const text = out.trim();
      if (!text) return { title: `${name} drafted`, note: 'No draft returned', items: [], prompt };
      // Numbers a draft states must be ones the facts contain; any other is
      // named. The facts alone vouch: the brief and the instructions carry
      // numbers ("at most 350 words", counts of other things) that would pass
      // an invented one.
      const stray = [...new Set(unsupported(withoutLabels(text, state.papers), facts))];
      const { paras, linked } = _draftBlocks(text, allResults(state));
      const headingId = sec.heading.id, empty = sectionEmpty(sec);
      return {
        title: `${name} drafted`,
        prompt,
        items: [{
          label: text,
          detail: [`${paras.length} ${paras.length === 1 ? 'paragraph' : 'paragraphs'}`,
            linked.size ? `${linked.size} linked ${linked.size === 1 ? 'result' : 'results'}` : '',
            stray.length ? `Not in the facts: ${stray.join(', ')}` : ''].filter(Boolean).join(' · '),
          // Whole words only: a long heading gives way to the generic label.
          acceptLabel: name.length <= 24 ? `Insert in ${name}` : 'Insert in section',
          ...(stray.length ? { accept: null } : proposeSection({ headingId, empty, paras, linked: [...linked], name })),
        }],
      };
    },
  },
]);

/** A model's reply with any <data> wrapper it echoed, or quotation marks around the whole, taken off. */
const unwrap = out => String(out).trim().replace(/^<data[^>]*>\s*|\s*<\/data>$/g, '').replace(/^"""\s*|\s*"""$/g, '').trim();

/** Citation and result tokens present in one text and missing from another. */
function tokensLost(before, after) {
  const toks = t => [...String(t).matchAll(/\[@[^\]]*\]|\{\{[^}]*\}\}/g)].map(m => m[0]);
  const now = toks(after);
  return toks(before).filter(t => !now.includes(t));
}

/** "12 words removed, 3 added" from the word difference. */
function changeSummary(a, b) {
  let del = 0, ins = 0;
  for (const w of diffWords(a, b)) { if (w.del != null && w.del.trim()) del++; if (w.ins != null && w.ins.trim()) ins++; }
  return `${del} ${del === 1 ? 'word' : 'words'} removed, ${ins} added`;
}

/**
 * The model's claim verdicts, kept only where the claim is really in the
 * paragraph. Every typed number in a claim is looked up in the project; one
 * that is not there overrides whatever the model said, and one that is there
 * is named with its source. Evidence is shown under one source record and
 * only when that record's own text contains it: evidence copied from another
 * record, or from nowhere, is left out rather than shown under the wrong
 * study. A claim resting on saved results alone has its evidence checked
 * against those results.
 */
export function claimItems(claims, { paragraph, known, keys, papers, results = [] }) {
  const VERDICT = { supported: 'Supported', contradicted: 'Contradicted', 'not addressed': 'Not addressed' };
  return claims.filter(c => c && quoteIn(c.quote, paragraph)).slice(0, 12).map(c => {
    const nums = checkNumbers(withoutLabels(c.quote, papers), known);
    const missing = nums.filter(x => !x.where).map(x => x.n);
    const sources = (Array.isArray(c.sources) ? c.sources : []).map(String).filter(k => keys.has(k));
    const verdict = missing.length ? `Not in the project: ${missing.join(', ')}` : VERDICT[String(c.verdict).toLowerCase()] || 'Not addressed';
    const cited = papers.filter(p => sources.includes(p.key));
    const ev = String(c.evidence || '').trim();
    // The record the evidence is shown under: the cited one that holds it,
    // else the first cited one, which then shows no evidence.
    const paper = (ev && cited.find(p => quoteIn(ev, recordBrief(p)))) || cited[0];
    const own = paper ? recordBrief(paper) : results.filter(r => sources.includes(r.key)).map(r => `${r.label} ${r.text}`).join('\n');
    const evidence = ev && own && quoteIn(ev, own) ? `“${ev.slice(0, 300)}”` : '';
    return {
      label: [verdict, sources.length ? sources.join(', ') : ''].filter(Boolean).join(' · '),
      quote: String(c.quote),
      detail: [c.why && String(c.why).slice(0, 160), evidence,
        ...nums.filter(x => x.where).map(x => `${x.n}: ${x.where}`)].filter(Boolean).join('\n'),
      ...(paper ? { where: { paperId: paper.id, label: paper.label } } : {}),
    };
  });
}
